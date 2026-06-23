from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query

from dbconn import get_connection
from idempotency import begin_idempotent
from modules.auth.service import get_current_manager, get_current_shipment_viewer
from modules.balances.schemas import (
    BalanceListResponse,
    BalanceSummaryResponse,
    BalanceZonesResponse,
    PlannableListResponse,
    QualityChangeCreate,
    StockEntryCreate,
    WriteOffCreate,
    ZoneRelocationCreate,
    ZoneRelocationListResponse,
)
from modules.balances.service import (
    create_quality_change,
    create_stock_entry,
    create_write_off,
    create_zone_relocation,
    get_balances,
    get_balances_by_zone,
    get_balances_summary,
    get_plannable_items,
    list_zone_relocations,
)

router = APIRouter(tags=["balances"])


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
    user=Depends(get_current_manager),
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


@router.post("/balances/write-offs")
def create_write_off_op(payload: WriteOffCreate, user=Depends(get_current_manager)):
    with get_connection() as conn:
        create_write_off(conn, payload, str(user["id"]))
    return {"message": "ok"}


@router.post("/balances/quality-changes")
def create_quality_change_op(payload: QualityChangeCreate, user=Depends(get_current_manager)):
    with get_connection() as conn:
        create_quality_change(conn, payload, str(user["id"]))
    return {"message": "ok"}


@router.post("/balances/stock-entry")
def create_stock_entry_op(payload: StockEntryCreate, user=Depends(get_current_manager)):
    """Историческое заведение остатков (то, что лежало до системы) — без документа."""
    with get_connection() as conn:
        n = create_stock_entry(conn, payload, str(user["id"]))
    return {"message": str(n)}


@router.get("/balances/relocations", response_model=ZoneRelocationListResponse)
def list_relocations(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(get_current_manager),
):
    with get_connection() as conn:
        return list_zone_relocations(conn, page=page, limit=limit, client_id=client_id, search=search)
