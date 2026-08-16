from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from config import INV_Q_DEFECT, INV_Q_GOOD
from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import get_current_manager, get_current_shipment_viewer, get_current_stock_operator
from modules.balances.schemas import (
    BalanceGroupedResponse,
    BalanceListResponse,
    BalanceSummaryResponse,
    BalanceZonesResponse,
    PlannableListResponse,
    QualityChangeCreate,
    StockEntryCreate,
    StockHistoryResponse,
    TurnoverListResponse,
    WriteOffCreate,
    ZoneRelocationBulkCreate,
    ZoneRelocationCreate,
    ZoneRelocationListResponse,
)
from modules.balances.service import (
    create_quality_change,
    create_stock_entry,
    create_write_off,
    create_zone_relocation,
    create_zone_relocations_bulk,
    get_balances,
    get_balances_by_zone,
    get_balances_grouped,
    get_balances_summary,
    get_plannable_items,
    get_stock_history,
    get_turnover,
    list_zone_relocations,
    reverse_write_off,
)
from utils import validate_business_date

router = APIRouter(tags=["balances"])


def _validate_slice_quality(quality: str | None) -> str | None:
    """Срез оборота по качеству: значение инлайнится в SQL, поэтому только словарь."""
    q = (quality or "").strip() or None
    if q and q not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise HTTPException(status_code=400, detail="Некорректное качество")
    return q


@router.get("/balances", response_model=BalanceListResponse)
def list_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    has_defect: bool = Query(False),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances(
            conn,
            page=page,
            limit=limit,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
            has_defect=has_defect,
        )


@router.get("/balances/grouped", response_model=BalanceGroupedResponse)
def list_balances_grouped(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    has_defect: bool = Query(False),
    user=Depends(get_current_shipment_viewer),
):
    """Остатки группами «артикул × клиент»: агрегаты + варианты, страница по группам."""
    with get_connection() as conn:
        return get_balances_grouped(
            conn,
            page=page,
            limit=limit,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
            has_defect=has_defect,
        )


@router.get("/balances/summary", response_model=BalanceSummaryResponse)
def balances_summary(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    has_defect: bool = Query(False),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances_summary(
            conn,
            client_id=client_id,
            search=search,
            has_defect=has_defect,
        )


@router.get("/balances/plannable", response_model=PlannableListResponse)
def list_plannable_items(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    cargo_type: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    user=Depends(get_current_shipment_viewer),
):
    """Позиции для планирования отгрузки: остаток на складе + товар в пути."""
    with get_connection() as conn:
        return get_plannable_items(
            conn,
            client_id=client_id,
            search=search,
            cargo_type=cargo_type,
            limit=limit,
        )


@router.get("/balances/zones", response_model=BalanceZonesResponse)
def list_balances_by_zone(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    location: str | None = Query(None),
    op_status: str | None = Query(None),
    quality: str | None = Query(None),
    page: int | None = Query(None, ge=1),
    limit: int | None = Query(None, ge=1, le=500),
    only_positive: bool = Query(True),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances_by_zone(
            conn,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
            location=location,
            op_status=op_status,
            quality=quality,
            page=page,
            limit=limit,
        )


@router.post("/balances/relocations")
def create_relocation(
    payload: ZoneRelocationCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "balance_relocation", response={"message": "ok"}
        )
        if not proceed:
            return stored
        create_zone_relocation(conn, payload, uid)
    return {"message": "ok"}


@router.post("/balances/relocations/bulk")
def create_relocations_bulk(
    payload: ZoneRelocationBulkCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    """Массовая консолидация: разные позиции (только «На хранении») в одно место, одна транзакция."""
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "balance_relocation_bulk")
        if not proceed:
            return stored
        moved = create_zone_relocations_bulk(conn, payload, uid)
        result = {"message": "ok", "moved": moved}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/balances/write-offs")
def create_write_off_op(
    payload: WriteOffCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "balance_write_off", response={"message": "ok"}
        )
        if not proceed:
            return stored
        create_write_off(conn, payload, uid)
    return {"message": "ok"}


@router.post("/balances/write-offs/{relocation_id}/undo")
def undo_write_off_op(
    relocation_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "balance_write_off_undo", response={"message": "ok"}
        )
        if not proceed:
            return stored
        reverse_write_off(conn, relocation_id, uid)
    return {"message": "ok"}


@router.post("/balances/quality-changes")
def create_quality_change_op(
    payload: QualityChangeCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "balance_quality_change", response={"message": "ok"}
        )
        if not proceed:
            return stored
        create_quality_change(conn, payload, uid)
    return {"message": "ok"}


@router.post("/balances/stock-entry")
def create_stock_entry_op(
    payload: StockEntryCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    """Историческое заведение остатков (то, что лежало до системы) — без документа."""
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "balance_stock_entry")
        if not proceed:
            return stored
        n = create_stock_entry(conn, payload, uid)
        result = {"message": str(n)}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.get("/balances/turnover", response_model=TurnoverListResponse)
def stock_turnover(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    only_moved: bool = Query(False),
    quality: str | None = Query(None),
    user=Depends(get_current_shipment_viewer),
):
    """Оборот запаса: остаток на начало → приход/отгрузка/списание → остаток на конец."""
    d_from = validate_business_date(date_from, field_ru="Дата с")
    d_to = validate_business_date(date_to, field_ru="Дата по")
    if d_from and d_to and d_from > d_to:
        raise HTTPException(status_code=400, detail="Дата «с» позже даты «по»")
    q = _validate_slice_quality(quality)
    with get_connection() as conn:
        return get_turnover(
            conn,
            page=page,
            limit=limit,
            client_id=client_id,
            search=search,
            date_from=d_from,
            date_to=d_to,
            only_moved=only_moved,
            quality=q,
        )


@router.get("/balances/turnover/history", response_model=StockHistoryResponse)
def stock_history(
    product_id: str = Query(...),
    client_id: str | None = Query(None),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    quality: str | None = Query(None),
    user=Depends(get_current_shipment_viewer),
):
    """Хронология событий позиции: как остаток пришёл к текущему значению."""
    d_from = validate_business_date(date_from, field_ru="Дата с")
    d_to = validate_business_date(date_to, field_ru="Дата по")
    q = _validate_slice_quality(quality)
    with get_connection() as conn:
        return get_stock_history(
            conn,
            product_id=product_id,
            client_id=(client_id or "").strip() or None,
            color_id=(color_id or "").strip() or None,
            size_id=(size_id or "").strip() or None,
            date_from=d_from,
            date_to=d_to,
            quality=q,
        )


@router.get("/balances/relocations", response_model=ZoneRelocationListResponse)
def list_relocations(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return list_zone_relocations(conn, page=page, limit=limit, client_id=client_id, search=search)
