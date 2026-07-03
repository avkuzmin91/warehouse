from __future__ import annotations

from pydantic import BaseModel, Field


class ExtraIncomeCreate(BaseModel):
    entry_date:  str                          # YYYY-MM-DD — бизнес-дата работы
    client_id:   str
    category_id: str
    qty:         int | None = Field(default=None, ge=1)   # справочно (шт.)
    amount_kop:  int = Field(ge=1)            # копейки
    comment:     str | None = None


class ExtraIncomeUpdate(BaseModel):
    entry_date:  str
    client_id:   str
    category_id: str
    qty:         int | None = Field(default=None, ge=1)
    amount_kop:  int = Field(ge=1)
    comment:     str | None = None


class ExtraIncomeListItem(BaseModel):
    id:             str
    entry_date:     str
    client_id:      str
    client_name:    str | None = None
    category_id:    str | None = None
    category_name:  str | None = None
    qty:            int | None = None
    amount_kop:     int
    comment:        str | None = None
    invoice_id:     str | None = None       # активный счёт, куда входит запись
    invoice_number: str | None = None
    created_at:     str


class ExtraIncomeListResponse(BaseModel):
    items: list[ExtraIncomeListItem]
    total: int
    page:  int
    limit: int


class ExtraIncomeSummaryResponse(BaseModel):
    total_amount:     int    # копейки, по текущим фильтрам
    total_count:      int
    uninvoiced_amount: int   # из них ещё не в счёте
    uninvoiced_count:  int


class ExtraIncomeDictItem(BaseModel):
    id:   str
    name: str


class ExtraIncomeDictCreate(BaseModel):
    name: str


class ExtraIncomeDictUpdate(BaseModel):
    name: str


class MessageResponse(BaseModel):
    message: str
