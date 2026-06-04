from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends

from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.dashboard.schemas import DashboardTodayResponse, DashboardTodayStats
from modules.dashboard.service import day_stats

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/today", response_model=DashboardTodayResponse)
def dashboard_today(user=Depends(get_current_manager)):
    today = date.today()
    with get_connection() as conn:
        today_stats = day_stats(conn, today)
        yesterday_stats = day_stats(conn, today - timedelta(days=1))
    return DashboardTodayResponse(
        today=DashboardTodayStats(**today_stats),
        yesterday=DashboardTodayStats(**yesterday_stats),
    )
