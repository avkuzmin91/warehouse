from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.expenses.service import ensure_analytics_window, validate_date
from modules.pnl.schemas import (
    IncomeAnalyticsResponse,
    LogisticsAnalyticsResponse,
    MonthlyPnlResponse,
    PnlDayResponse,
    PnlResponse,
    TripProfitabilityResponse,
)
from modules.pnl.service import (
    income_analytics,
    logistics_analytics,
    pnl_day_detail,
    pnl_monthly,
    pnl_report,
    trip_profitability,
)
from security import can_view_salary, ensure_finance_access

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
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = pnl_report(conn, date_from=df, date_to=dt, client_id=(client_id or None))
    return PnlResponse(**data)


@router.get("/pnl/monthly", response_model=MonthlyPnlResponse)
def get_pnl_monthly(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Помесячная финмодель по факту: упаковано шт., средний доход на упаковку, доход по
    источникам, расход по категориям, EBITDA и маржа — колонками по месяцам. Считается тем
    же расчётом, что и дневной P&L, поэтому сумма месяцев сходится с /pnl в том же окне.
    Видна финансовым ролям (админ/менеджер)."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = pnl_monthly(conn, date_from=df, date_to=dt, client_id=(client_id or None))
    return MonthlyPnlResponse(**data)


@router.get("/pnl/income", response_model=IncomeAnalyticsResponse)
def get_income_analytics(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Аналитика доходов по дням (зеркало аналитики расходов): потоки дохода (упаковка,
    логистика, палеты) с посуточной динамикой и разрезом по клиентам. Доход считается тем же
    расчётом, что и в P&L. Видна финансовым ролям (админ/менеджер)."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = income_analytics(conn, date_from=df, date_to=dt, client_id=(client_id or None))
    return IncomeAnalyticsResponse(**data)


@router.get("/pnl/day", response_model=PnlDayResponse)
def get_pnl_day(
    date:      str = Query(...),
    date_from: str = Query(...),
    date_to:   str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Детализация одного дня P&L: из чего сложился доход и расход. Окно [date_from..date_to]
    графика передаётся, чтобы атрибуция логистики/палет совпала со столбиком. Оклад окладников
    раскрывается по сотрудникам только администратору (can_view_salary)."""
    day = validate_date(date)
    df = validate_date(date_from)
    dt = validate_date(date_to)
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = pnl_day_detail(
            conn, day=day, date_from=df, date_to=dt,
            client_id=(client_id or None), can_view_salary=can_view_salary(user),
        )
    return PnlDayResponse(**data)


@router.get("/pnl/trips", response_model=TripProfitabilityResponse)
def get_trip_profitability(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Рентабельность рейсов в окне (по факту прибытия): доход рейса (логистика клиента,
    доля документа по перевезённому количеству) против фактической себестоимости рейса."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = trip_profitability(conn, date_from=df, date_to=dt, client_id=client_id)
    return TripProfitabilityResponse(**data)


@router.get("/pnl/logistics", response_model=LogisticsAnalyticsResponse)
def get_logistics_analytics(
    date_from:       str = Query(...),
    date_to:         str = Query(...),
    client_id:       str | None = Query(None),
    direction:       str | None = Query(None),
    vehicle_type_id: str | None = Query(None),
    carrier_id:      str | None = Query(None),
    user=Depends(_get_finance),
):
    """Аналитика логистики (по факту прибытия): количество рейсов поступлений/отгрузок,
    потрачено (себестоимость + простой) и заработано (логистика клиента) — динамика по
    дням и разрезы по типам кузова и перевозчикам. База расчёта дохода — та же, что
    в «Рентабельности рейсов»."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    ensure_analytics_window(df, dt)
    with get_connection() as conn:
        data = logistics_analytics(
            conn, date_from=df, date_to=dt, client_id=(client_id or None),
            direction=(direction or None), vehicle_type_id=(vehicle_type_id or None),
            carrier_id=(carrier_id or None),
        )
    return LogisticsAnalyticsResponse(**data)
