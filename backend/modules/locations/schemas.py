from __future__ import annotations

from pydantic import BaseModel, Field


class LocationItem(BaseModel):
    id: str
    code: str  # = unloading_zones.name, человекочитаемый адрес «1-А-10-1» (или имя служебной зоны)
    room: str | None = None
    rack: str | None = None
    section: str | None = None
    floor: str | None = None
    kind: str  # 'cell' — адресная ячейка, 'special' — служебная зона / разовое место
    is_packing_zone: bool = False
    is_shipping_zone: bool = False
    is_active: bool
    is_deleted: bool = False
    created_at: str


class LocationListResponse(BaseModel):
    items: list[LocationItem]
    total: int
    page: int
    limit: int


class LocationCreateRequest(BaseModel):
    room: str = Field(min_length=1)
    rack: str = Field(min_length=1)
    section: int = Field(ge=1, le=99)
    floor: int = Field(ge=1, le=9)
    is_active: bool = True


class LocationBulkCreateRequest(BaseModel):
    room: str = Field(min_length=1)
    racks: list[str] = Field(min_length=1)
    sections: int = Field(ge=1, le=99)
    floors: int = Field(ge=1, le=9)
    is_active: bool = True


class LocationBulkResult(BaseModel):
    created: int
    skipped: int


class LocationLookupResponse(BaseModel):
    found: bool
    location: LocationItem | None = None


class LocationLabel(BaseModel):
    id: str
    code: str
    payload: str  # содержимое QR: «wms:loc:<id>»
    qr_svg: str
    kind: str  # 'cell' — адресная ячейка (со стрелкой), 'special' — служебная зона
    room: str | None = None
    rack: str | None = None
    section: str | None = None
    floor: str | None = None


class LocationLabelsResponse(BaseModel):
    items: list[LocationLabel]
