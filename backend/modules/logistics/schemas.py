from __future__ import annotations

from pydantic import BaseModel, Field


class TripDocCreate(BaseModel):
    direction: str | None = None  # inbound | outbound (по умолчанию inbound)
    cargo_type: str | None = None  # good | defect (для рейса отгрузки; по умолчанию good)
    origin_id: str | None = None
    origin_name: str | None = None
    carrier_id: str | None = None
    carrier_name: str | None = None
    vehicle_type_id: str | None = None
    vehicle_type_name: str | None = None
    vehicle_number: str | None = None
    transport_ordered_at: str | None = None
    eta: str | None = None
    cost_estimate: float | None = None
    comment: str | None = None
    receipt_doc_ids: list[str] = []
    dispatch_doc_ids: list[str] = []


class TripDocUpdate(BaseModel):
    origin_id: str | None = None
    origin_name: str | None = None
    carrier_id: str | None = None
    carrier_name: str | None = None
    vehicle_type_id: str | None = None
    vehicle_type_name: str | None = None
    vehicle_number: str | None = None
    transport_ordered_at: str | None = None
    eta: str | None = None
    cost_estimate: float | None = None
    comment: str | None = None


class TripCarrierUpdate(BaseModel):
    carrier_id: str | None = None
    carrier_name: str | None = None


class TripReceiptLineAlloc(BaseModel):
    line_id: str
    qty: int = Field(ge=1)


class TripReceiptLinkItem(BaseModel):
    receipt_doc_id: str
    allocations: list[TripReceiptLineAlloc] = Field(default_factory=list)


class TripLinkPayload(BaseModel):
    items: list[TripReceiptLinkItem] = Field(default_factory=list)


class TripDispatchLineAlloc(BaseModel):
    line_id: str
    qty: int = Field(ge=1)


class TripDispatchLinkItem(BaseModel):
    dispatch_doc_id: str
    allocations: list[TripDispatchLineAlloc] = Field(default_factory=list)


class TripDispatchLinkPayload(BaseModel):
    items: list[TripDispatchLinkItem] = Field(default_factory=list)


class TripArrivalPayload(BaseModel):
    arrived_at: str | None = None


class TripUnloadPlacement(BaseModel):
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    qty: int = Field(ge=0)


class TripUnloadReceiptLine(BaseModel):
    line_id: str                       # receipt_line_id
    accepted_qty: int = Field(ge=0)    # принято этим рейсом по строке (= сумме placements)
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    # Раскладка принятого по нескольким ячейкам. Пусто → одна ячейка (accepted_qty в
    # storage_zone_id), как было исторически.
    placements: list[TripUnloadPlacement] = Field(default_factory=list)


class TripUnloadPayload(BaseModel):
    unload_started_at: str | None = None
    unload_finished_at: str | None = None
    load_factor: str | None = None  # full | partial
    # Приёмка inbound-рейса: фактически принятое по строкам аллокации (пусто для
    # outbound и для рейсов без поступлений — приём проводится по умолчанию).
    receipt_lines: list[TripUnloadReceiptLine] = Field(default_factory=list)


class TripCostPayload(BaseModel):
    logistics_cost_actual: float | None = Field(default=None, ge=0)
    waiting_cost: float | None = Field(default=None, ge=0)
    waiting_minutes: int | None = Field(default=None, ge=0)


class TripExecutionPayload(BaseModel):
    arrived_at: str | None = None
    unload_started_at: str | None = None
    unload_finished_at: str | None = None
    load_factor: str | None = None


class TripDocResponse(BaseModel):
    id: str
    trip_number: str
    direction: str
    cargo_type: str = "good"
    status: str
    assignee_role: str | None = None
    origin_id: str | None = None
    origin_name: str | None = None
    carrier_id: str | None = None
    carrier_name: str | None = None
    vehicle_type_id: str | None = None
    vehicle_type_name: str | None = None
    vehicle_number: str | None = None
    transport_ordered_at: str | None = None
    eta: str | None = None
    cost_estimate: float | None = None
    comment: str | None = None
    arrived_at: str | None = None
    unload_started_at: str | None = None
    unload_finished_at: str | None = None
    load_factor: str | None = None
    logistics_cost_actual: float | None = None
    waiting_cost: float | None = None
    waiting_minutes: int | None = None
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None


class TripReceiptAllocItem(BaseModel):
    line_id: str
    product_sku: str | None = None
    product_name: str | None = None
    variant: str | None = None
    qty: int = 0           # привозит этот рейс
    planned_qty: int = 0   # план по строке
    accepted_qty: int = 0  # принято всего (по всем рейсам)
    received_qty: int = 0  # принято кладовщиком в этом рейсе (нетто журнала по trip_id)
    storage_zone_id: str | None = None    # место хранения строки (план/факт)
    storage_zone_name: str | None = None


class TripReceiptItem(BaseModel):
    line_id: str
    receipt_doc_id: str
    receipt_number: str | None = None
    receipt_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    allocated_qty: int = 0
    received_qty: int = 0  # принято в этом рейсе по всему поступлению
    allocations: list[TripReceiptAllocItem] = Field(default_factory=list)


class TripDispatchAllocItem(BaseModel):
    line_id: str
    product_sku: str | None = None
    product_name: str | None = None
    variant: str | None = None
    qty: int = 0          # увозит этот рейс
    line_qty: int = 0     # план по строке
    shipped_qty: int = 0  # отгружено всего (по всем рейсам)


class TripDispatchItem(BaseModel):
    line_id: str
    dispatch_doc_id: str
    dispatch_number: str | None = None
    dispatch_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    allocated_qty: int = 0
    allocations: list[TripDispatchAllocItem] = Field(default_factory=list)


class TripOpResponse(BaseModel):
    id: str
    trip_id: str
    op_type: str
    comment: str | None = None
    created_at: str
    created_by: str | None = None
    created_by_email: str | None = None


class TripDetailResponse(BaseModel):
    doc: TripDocResponse
    receipts: list[TripReceiptItem] = Field(default_factory=list)
    dispatches: list[TripDispatchItem] = Field(default_factory=list)
    ops: list[TripOpResponse]


class TripListItem(BaseModel):
    id: str
    trip_number: str
    direction: str
    cargo_type: str = "good"
    status: str
    origin_name: str | None = None
    carrier_name: str | None = None
    vehicle_type_name: str | None = None
    vehicle_number: str | None = None
    eta: str | None = None
    arrived_at: str | None = None
    cost_estimate: float | None = None
    logistics_cost_actual: float | None = None
    created_at: str
    receipts_count: int = 0
    items_qty: int = 0
    client_names: list[str] = []


class TripListResponse(BaseModel):
    items: list[TripListItem]
    total: int
    page: int
    limit: int
