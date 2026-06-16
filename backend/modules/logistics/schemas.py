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
    shipment_doc_ids: list[str] = []


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


class TripReceiptLineAlloc(BaseModel):
    line_id: str
    qty: int = Field(ge=1)


class TripReceiptLinkItem(BaseModel):
    receipt_doc_id: str
    allocations: list[TripReceiptLineAlloc] = Field(default_factory=list)


class TripLinkPayload(BaseModel):
    items: list[TripReceiptLinkItem] = Field(default_factory=list)


class TripShipmentLineAlloc(BaseModel):
    line_id: str
    qty: int = Field(ge=1)


class TripShipmentLinkItem(BaseModel):
    shipment_doc_id: str
    allocations: list[TripShipmentLineAlloc] = Field(default_factory=list)


class TripShipmentLinkPayload(BaseModel):
    items: list[TripShipmentLinkItem] = Field(default_factory=list)


class TripArrivalPayload(BaseModel):
    arrived_at: str | None = None


class TripUnloadPayload(BaseModel):
    unload_started_at: str | None = None
    unload_finished_at: str | None = None
    load_factor: str | None = None  # full | partial


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


class TripReceiptItem(BaseModel):
    line_id: str
    receipt_doc_id: str
    receipt_number: str | None = None
    receipt_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    allocated_qty: int = 0
    allocations: list[TripReceiptAllocItem] = Field(default_factory=list)


class TripShipmentAllocItem(BaseModel):
    line_id: str
    product_sku: str | None = None
    product_name: str | None = None
    variant: str | None = None
    qty: int = 0          # увозит этот рейс
    line_qty: int = 0     # план по строке
    shipped_qty: int = 0  # отгружено всего (по всем рейсам)


class TripShipmentItem(BaseModel):
    line_id: str
    shipment_doc_id: str
    shipment_number: str | None = None
    shipment_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    allocated_qty: int = 0
    allocations: list[TripShipmentAllocItem] = Field(default_factory=list)


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
    shipments: list[TripShipmentItem] = Field(default_factory=list)
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
    eta: str | None = None
    arrived_at: str | None = None
    cost_estimate: float | None = None
    logistics_cost_actual: float | None = None
    created_at: str
    receipts_count: int = 0


class TripListResponse(BaseModel):
    items: list[TripListItem]
    total: int
    page: int
    limit: int
