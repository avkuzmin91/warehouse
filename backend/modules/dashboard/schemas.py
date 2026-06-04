from __future__ import annotations

from pydantic import BaseModel


class DashboardTodayStats(BaseModel):
    receipt_docs: int   # поступлений с плановым прибытием сегодня
    accepted: int       # принято товара сегодня (по дате операции приёмки)
    shipped: int        # отгружено сегодня (по дате перехода в shipped)
    defects: int        # браков зафиксировано сегодня (по дате операции)


class DashboardTodayResponse(BaseModel):
    today: DashboardTodayStats
    yesterday: DashboardTodayStats
