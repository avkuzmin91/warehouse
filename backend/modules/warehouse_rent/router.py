from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status

from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.timesheet.service import business_today
from security import FORBIDDEN_DETAIL

from .schemas import (
    MessageResponse,
    RentRateHistoryEntry,
    SetRentRateRequest,
    WarehouseRentDetail,
)
from .service import (
    add_rent_rate,
    delete_rent_rate,
    load_rent_history,
    rent_rate_for_event,
)

router = APIRouter(tags=["warehouse-rent"])


def _get_strict_admin(user=Depends(get_current_user)):
    """Строго admin — ставка аренды «Наших складов», как и сам справочник."""
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAIL)
    return user


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


def _load_warehouse(conn, warehouse_id: str):
    wh = conn.execute(
        "SELECT id, name FROM own_warehouses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (warehouse_id,),
    ).fetchone()
    if not wh:
        raise HTTPException(status_code=404, detail="Склад не найден")
    return wh


@router.get("/own-warehouses/{warehouse_id}/rent-rates", response_model=WarehouseRentDetail)
def get_warehouse_rent(warehouse_id: str, admin=Depends(_get_strict_admin)):
    _ = admin
    today = business_today().isoformat()
    with get_connection() as conn:
        wh = _load_warehouse(conn, warehouse_id)
        history = load_rent_history(conn, warehouse_id)
        current = rent_rate_for_event(conn, warehouse_id, today)
    return WarehouseRentDetail(
        warehouse_id=str(wh["id"]),
        warehouse_name=str(wh["name"]),
        rent_monthly_kopecks=current,
        history=[RentRateHistoryEntry(**e) for e in history],
    )


@router.post("/own-warehouses/{warehouse_id}/rent-rates", response_model=MessageResponse)
def set_warehouse_rent(warehouse_id: str, body: SetRentRateRequest, admin=Depends(_get_strict_admin)):
    uid = str(admin["id"])
    today = business_today().isoformat()
    effective_from = _validate_date(body.effective_from) if body.effective_from else today
    with get_connection() as conn:
        _load_warehouse(conn, warehouse_id)
        add_rent_rate(
            conn, warehouse_id=warehouse_id, rent_monthly_kopecks=body.rent_monthly_kopecks,
            effective_from=effective_from, user_id=uid, today_iso=today, note=body.note,
        )
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/own-warehouses/{warehouse_id}/rent-rates/{rate_id}", response_model=MessageResponse)
def remove_warehouse_rent_rate(warehouse_id: str, rate_id: str, admin=Depends(_get_strict_admin)):
    _ = admin
    today = business_today().isoformat()
    with get_connection() as conn:
        _load_warehouse(conn, warehouse_id)
        if not delete_rent_rate(conn, warehouse_id=warehouse_id, rate_id=rate_id, today_iso=today):
            raise HTTPException(status_code=404, detail="Запись ставки не найдена")
        conn.commit()
    return MessageResponse(message="ok")
