from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_dashboard_user
from modules.dashboard.schemas import (
    DashboardTodayResponse,
    DashboardTodayStats,
    OperationalPlanResponse,
)
from modules.dashboard.service import day_stats, operational_plan
from modules.timesheet.service import business_today

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/today", response_model=DashboardTodayResponse)
def dashboard_today(user=Depends(get_current_dashboard_user)):
    today = business_today()
    with get_connection() as conn:
        today_stats = day_stats(conn, today)
        yesterday_stats = day_stats(conn, today - timedelta(days=1))
    return DashboardTodayResponse(
        today=DashboardTodayStats(**today_stats),
        yesterday=DashboardTodayStats(**yesterday_stats),
    )


@router.get("/dashboard/operational-plan", response_model=OperationalPlanResponse)
def dashboard_operational_plan(
    receipts_limit: int = Query(20, ge=1, le=100),
    shipments_limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_dashboard_user),
):
    with get_connection() as conn:
        data = operational_plan(conn, receipts_limit=receipts_limit, shipments_limit=shipments_limit)
    return OperationalPlanResponse(**data)
