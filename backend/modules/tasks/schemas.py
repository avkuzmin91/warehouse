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
    since: str | None = None
    priority_rank: int | None = None  # только для отгрузок


class TasksResponse(BaseModel):
    items: list[TaskItem]
    total: int
