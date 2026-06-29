from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from dbconn import get_connection
from modules.auth.service import get_current_manager

from .schemas import CalendarMonthResponse, MessageResponse, SetCalendarDayRequest
from .service import delete_day, list_month, set_day

router = APIRouter(tags=["production-calendar"])


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


@router.get("/production-calendar", response_model=CalendarMonthResponse)
def get_calendar_month(
    user=Depends(get_current_manager),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
):
    _ = user
    with get_connection() as conn:
        data = list_month(conn, year, month)
    return CalendarMonthResponse(**data)


@router.post("/production-calendar", response_model=MessageResponse)
def set_calendar_day(body: SetCalendarDayRequest, user=Depends(get_current_manager)):
    uid = str(user["id"])
    cal_date = _validate_date(body.cal_date)
    with get_connection() as conn:
        set_day(conn, cal_date=cal_date, is_working=body.is_working, reason=body.reason, uid=uid)
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/production-calendar/{cal_date}", response_model=MessageResponse)
def delete_calendar_day(cal_date: str, user=Depends(get_current_manager)):
    _ = user
    iso = _validate_date(cal_date)
    with get_connection() as conn:
        if not delete_day(conn, iso):
            raise HTTPException(status_code=404, detail="Исключение календаря не найдено")
        conn.commit()
    return MessageResponse(message="ok")
