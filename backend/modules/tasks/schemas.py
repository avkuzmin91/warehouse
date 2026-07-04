from __future__ import annotations

from pydantic import BaseModel


class TaskItem(BaseModel):
    kind: str
    title: str
    doc_type: str  # trip | receipt
    doc_id: str
    doc_number: str
    status: str
    role: str
    direction: str | None = None  # для рейсов: inbound | outbound
    eta: str | None = None  # для рейсов: плановое прибытие транспорта
    vehicle_number: str | None = None  # для рейсов: госномер машины
    since: str | None = None
    priority_rank: int | None = None  # только для отгрузок
    is_read: bool = False


class TasksResponse(BaseModel):
    items: list[TaskItem]
    total: int
    unread: int = 0


class TaskReadPayload(BaseModel):
    kind: str
    doc_id: str
