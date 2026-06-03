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
    since: str | None = None


class TasksResponse(BaseModel):
    items: list[TaskItem]
    total: int
