from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


class CalendarException(BaseModel):
    id: str
    cal_date: str
    is_working: bool
    reason: str | None = None


class CalendarMonthResponse(BaseModel):
    year: int
    month: int
    working_days: int
    items: list[CalendarException]


class CalendarMonthSlim(BaseModel):
    month: int
    working_days: int
    items: list[CalendarException]


class CalendarYearResponse(BaseModel):
    year: int
    working_days: int
    months: list[CalendarMonthSlim]


class SetCalendarDayRequest(BaseModel):
    cal_date: str
    is_working: bool = False
    reason: str | None = None


class BulkApplyRequest(BaseModel):
    dates: list[str] = Field(min_length=1)
    mode: str
    reason: str | None = None
