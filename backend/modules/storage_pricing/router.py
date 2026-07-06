from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from config import STORAGE_UNIT_LABELS, STORAGE_UNITS
from dbconn import get_connection, ci_like_substring_param
from modules.auth.service import get_current_manager
from modules.timesheet.service import business_today
from security import ensure_finance_access

from .schemas import (
    ClientStoragePriceDetail,
    ClientStoragePriceItem,
    ClientStoragePricesResponse,
    MessageResponse,
    SetStoragePriceRequest,
    StorageChargeDetailResponse,
    StorageClientDaysResponse,
    StoragePriceHistoryEntry,
    StorageReportResponse,
)
from .service import (
    add_storage_price,
    billing_start,
    current_storage_prices,
    delete_storage_price,
    load_storage_price_history,
    storage_charge_detail,
    storage_client_days,
    storage_record_on,
    storage_report,
)

router = APIRouter(tags=["storage-pricing"])


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


# ── Справочник тарифов ────────────────────────────────────────────────────────

@router.get("/storage-pricing/clients", response_model=ClientStoragePricesResponse)
def list_storage_priced_clients(
    user=Depends(_get_finance),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    missing_only: bool = Query(False),
):
    _ = user
    today = business_today().isoformat()
    conds = ["COALESCE(c.is_deleted, 0) = 0"]
    params: list = []
    if search and search.strip():
        conds.append("fold_ci(c.name) LIKE ?")
        params.append(ci_like_substring_param(search))
    if missing_only:
        conds.append(
            "NOT EXISTS (SELECT 1 FROM client_storage_prices pp "
            "WHERE pp.client_id = c.id AND COALESCE(pp.is_deleted, 0) = 0)"
        )
    where = " AND ".join(conds)
    offset = (page - 1) * limit
    with get_connection() as conn:
        total = int(conn.execute(
            f"SELECT COUNT(*) AS n FROM clients c WHERE {where}", params
        ).fetchone()["n"])
        rows = conn.execute(
            f"SELECT c.id, c.name FROM clients c WHERE {where} "
            f"ORDER BY LOWER(c.name) ASC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        priced = current_storage_prices(conn, [str(r["id"]) for r in rows], today)
    items = []
    for r in rows:
        rec = priced.get(str(r["id"]))
        items.append(ClientStoragePriceItem(
            client_id=str(r["id"]),
            client_name=str(r["name"]),
            unit=(str(rec["unit"]) if rec else None),
            unit_label=(STORAGE_UNIT_LABELS.get(str(rec["unit"])) if rec else None),
            price_kop=(int(rec["price_kop"]) if rec else None),
            free_days=(int(rec["free_days"]) if rec else None),
            has_price=rec is not None,
        ))
    return ClientStoragePricesResponse(items=items, total=total, page=page, limit=limit)


@router.get("/storage-pricing/clients/{client_id}", response_model=ClientStoragePriceDetail)
def get_client_storage_prices(client_id: str, user=Depends(_get_finance)):
    _ = user
    today = business_today().isoformat()
    with get_connection() as conn:
        client = conn.execute(
            "SELECT id, name FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (client_id,),
        ).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        history = load_storage_price_history(conn, client_id)
    rec = storage_record_on(history, today)
    return ClientStoragePriceDetail(
        client_id=str(client["id"]),
        client_name=str(client["name"]),
        unit=(str(rec["unit"]) if rec else None),
        price_kop=(int(rec["price_kop"]) if rec else None),
        free_days=(int(rec["free_days"]) if rec else None),
        billing_start=billing_start(history),
        history=[StoragePriceHistoryEntry(**e) for e in history],
    )


@router.post("/storage-pricing/clients/{client_id}/prices", response_model=MessageResponse)
def set_client_storage_price(client_id: str, body: SetStoragePriceRequest, user=Depends(_get_finance)):
    uid = str(user["id"])
    unit = str(body.unit or "").strip()
    if unit not in STORAGE_UNITS:
        raise HTTPException(status_code=400, detail="Укажите единицу тарификации (штука / короб / палета)")
    effective_from = _validate_date(body.effective_from) if body.effective_from else business_today().isoformat()
    with get_connection() as conn:
        client = conn.execute(
            "SELECT id FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (client_id,)
        ).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        add_storage_price(
            conn, client_id=client_id, unit=unit, price_kop=body.price_kop,
            free_days=body.free_days, effective_from=effective_from, user_id=uid, note=body.note,
        )
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/storage-pricing/clients/{client_id}/prices/{price_id}", response_model=MessageResponse)
def delete_client_storage_price(client_id: str, price_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        if not delete_storage_price(conn, client_id=client_id, price_id=price_id):
            raise HTTPException(status_code=404, detail="Запись тарифа не найдена")
        conn.commit()
    return MessageResponse(message="ok")


# ── Отчёт «Хранение» ─────────────────────────────────────────────────────────

@router.get("/storage-pricing/report", response_model=StorageReportResponse)
def get_storage_report(
    user=Depends(_get_finance),
    date_from: str = Query(...),
    date_to: str = Query(...),
    client_id: str | None = Query(None),
):
    _ = user
    df = _validate_date(date_from)
    dt = _validate_date(date_to)
    with get_connection() as conn:
        data = storage_report(conn, date_from=df, date_to=dt, client_id=client_id)
    return StorageReportResponse(**data)


@router.get("/storage-pricing/report/{client_id}/days", response_model=StorageClientDaysResponse)
def get_storage_client_days(
    client_id: str,
    user=Depends(_get_finance),
    date_from: str = Query(...),
    date_to: str = Query(...),
):
    _ = user
    df = _validate_date(date_from)
    dt = _validate_date(date_to)
    with get_connection() as conn:
        items = storage_client_days(conn, client_id=client_id, date_from=df, date_to=dt)
    return StorageClientDaysResponse(items=items)


@router.get("/storage-pricing/charges/{charge_id}", response_model=StorageChargeDetailResponse)
def get_storage_charge_detail(charge_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        data = storage_charge_detail(conn, charge_id)
    if not data:
        raise HTTPException(status_code=404, detail="Начисление не найдено")
    return StorageChargeDetailResponse(**data)
