from __future__ import annotations

from pydantic import BaseModel, Field


class DictionaryBaseItem(BaseModel):
    id: str
    name: str
    color_hex: str | None = None
    rent_monthly_kopecks: int | None = None
    is_packing_zone: bool = False
    is_shipping_zone: bool = False
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = None
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class ProductTypeDictionaryItem(DictionaryBaseItem):
    requires_color: bool
    requires_size: bool


class DictionaryCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    color_hex: str | None = None
    rent_monthly_kopecks: int | None = Field(default=None, ge=0)
    is_active: bool = False


class DictionaryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    color_hex: str | None = None
    rent_monthly_kopecks: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    is_deleted: bool | None = None


class ClientStoreItem(BaseModel):
    id: str
    client_id: str
    name: str
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = None
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class ClientStoreCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = True


class ClientStoreUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None


class ProductTypeCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = False
    requires_color: bool = False
    requires_size: bool = False


class ProductTypeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None
    requires_color: bool | None = None
    requires_size: bool | None = None


class SizeItem(BaseModel):
    id: str
    name: str
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = None
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class SizeCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = True


class SizeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None


class DictionaryListResponse(BaseModel):
    items: list[DictionaryBaseItem]
    total: int
    page: int
    limit: int


class ProductTypeListResponse(BaseModel):
    items: list[ProductTypeDictionaryItem]
    total: int
    page: int
    limit: int


class SizeListResponse(BaseModel):
    items: list[SizeItem]
    total: int
    page: int
    limit: int


class RecordActualityFilterItem(BaseModel):
    id: str
    name: str


class MessageResponse(BaseModel):
    message: str
