from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_dashboard_user
from modules.dashboard.schemas import (
    DashboardTodayResponse,
    DashboardTodayStats,
    OperationalPlanResponse,
)
from modules.dashboard.service import day_stats, operational_plan

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/today", response_model=DashboardTodayResponse)
def dashboard_today(user=Depends(get_current_dashboard_user)):
    today = date.today()
    with get_connection() as conn:
        today_stats = day_stats(conn, today)
        yesterday_stats = day_stats(conn, today - timedelta(days=1))
    return DashboardTodayResponse(
        today=DashboardTodayStats(**today_stats),
        yesterday=DashboardTodayStats(**yesterday_stats),
    )


@router.get("/dashboard/operational-plan", response_model=OperationalPlanResponse)
def dashboard_operational_plan(
    limit: int = Query(8, ge=1, le=20),
    horizon_days: int = Query(7, ge=0, le=31),
    user=Depends(get_current_dashboard_user),
):
    with get_connection() as conn:
        data = operational_plan(conn, limit=limit, horizon_days=horizon_days)
    return OperationalPlanResponse(**data)
