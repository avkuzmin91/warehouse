from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


class RentRateHistoryEntry(BaseModel):
    id: str
    rent_monthly_kopecks: int
    effective_from: str
    note: str | None = None
    created_at: str
    created_by: str | None = None


class WarehouseRentDetail(BaseModel):
    warehouse_id: str
    warehouse_name: str
    rent_monthly_kopecks: int | None = None
    history: list[RentRateHistoryEntry]


class SetRentRateRequest(BaseModel):
    rent_monthly_kopecks: int = Field(ge=0)
    effective_from: str | None = None
    note: str | None = None
