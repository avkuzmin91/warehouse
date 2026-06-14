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


class OperationalPlanItem(BaseModel):
    type: str
    id: str
    doc_number: str
    status: str
    date: str | None = None
    date_kind: str
    client_name: str | None = None
    destination: str | None = None
    sku_count: int
    total_qty: int
    progress_qty: int | None = None
    overdue: bool
    priority: str
    priority_rank: int | None = None
    exception: str | None = None


class OperationalPlanTotals(BaseModel):
    receipts: int
    shipments: int
    overdue: int


class OperationalPlanResponse(BaseModel):
    receipts: list[OperationalPlanItem]
    shipments: list[OperationalPlanItem]
    exceptions: list[OperationalPlanItem]
    totals: OperationalPlanTotals
