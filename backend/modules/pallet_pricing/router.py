from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from dbconn import get_connection, ci_like_substring_param
from modules.auth.service import get_current_manager
from modules.timesheet.service import business_today
from security import ensure_finance_access

from .schemas import (
    ClientPalletPriceDetail,
    ClientPalletPriceItem,
    ClientPalletPricesResponse,
    MessageResponse,
    PalletPriceHistoryEntry,
    SetPalletPriceRequest,
)
from .service import (
    add_pallet_price,
    current_pallet_prices,
    delete_pallet_price,
    load_pallet_price_history,
    price_on,
)

router = APIRouter(tags=["pallet-pricing"])


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


@router.get("/pallet-pricing/clients", response_model=ClientPalletPricesResponse)
def list_pallet_priced_clients(
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
            "NOT EXISTS (SELECT 1 FROM client_pallet_prices pp "
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
        priced = current_pallet_prices(conn, [str(r["id"]) for r in rows], today)
    items = [
        ClientPalletPriceItem(
            client_id=str(r["id"]),
            client_name=str(r["name"]),
            price_kop=priced.get(str(r["id"])),
            has_price=str(r["id"]) in priced,
        )
        for r in rows
    ]
    return ClientPalletPricesResponse(items=items, total=total, page=page, limit=limit)


@router.get("/pallet-pricing/clients/{client_id}", response_model=ClientPalletPriceDetail)
def get_client_pallet_prices(client_id: str, user=Depends(_get_finance)):
    _ = user
    today = business_today().isoformat()
    with get_connection() as conn:
        client = conn.execute(
            "SELECT id, name FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (client_id,),
        ).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        history = load_pallet_price_history(conn, client_id)
    return ClientPalletPriceDetail(
        client_id=str(client["id"]),
        client_name=str(client["name"]),
        price_kop=price_on(history, today),
        history=[PalletPriceHistoryEntry(**e) for e in history],
    )


@router.post("/pallet-pricing/clients/{client_id}/prices", response_model=MessageResponse)
def set_client_pallet_price(client_id: str, body: SetPalletPriceRequest, user=Depends(_get_finance)):
    uid = str(user["id"])
    effective_from = _validate_date(body.effective_from) if body.effective_from else business_today().isoformat()
    with get_connection() as conn:
        client = conn.execute(
            "SELECT id FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (client_id,)
        ).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        add_pallet_price(conn, client_id=client_id, price_kop=body.price_kop,
                         effective_from=effective_from, user_id=uid, note=body.note)
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/pallet-pricing/clients/{client_id}/prices/{price_id}", response_model=MessageResponse)
def delete_client_pallet_price(client_id: str, price_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        if not delete_pallet_price(conn, client_id=client_id, price_id=price_id):
            raise HTTPException(status_code=404, detail="Запись цены не найдена")
        conn.commit()
    return MessageResponse(message="ok")
