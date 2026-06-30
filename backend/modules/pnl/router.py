from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.expenses.service import validate_date
from modules.pnl.schemas import PnlResponse, TripProfitabilityResponse
from modules.pnl.service import pnl_report, trip_profitability
from security import ensure_finance_access

router = APIRouter(tags=["pnl"])


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


@router.get("/pnl", response_model=PnlResponse)
def get_pnl(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Финрезультат «доходы vs расходы» по дням: доход (упаковка, логистика, палеты)
    против расхода (вся аналитика расходов), нарастающий итог прибыли и маржа.
    Видна финансовым ролям (админ/менеджер), как и аналитика расходов."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    with get_connection() as conn:
        data = pnl_report(conn, date_from=df, date_to=dt, client_id=(client_id or None))
    return PnlResponse(**data)


@router.get("/pnl/trips", response_model=TripProfitabilityResponse)
def get_trip_profitability(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    user=Depends(_get_finance),
):
    """Рентабельность рейсов в окне (по факту прибытия): доход рейса (логистика клиента
    + палеты) против фактической себестоимости рейса."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    with get_connection() as conn:
        data = trip_profitability(conn, date_from=df, date_to=dt)
    return TripProfitabilityResponse(**data)
