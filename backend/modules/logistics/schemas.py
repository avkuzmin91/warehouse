from __future__ import annotations

from pydantic import BaseModel, Field


class TripDocCreate(BaseModel):
    direction: str | None = None  # inbound | outbound (по умолчанию inbound)
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


class TripLinkPayload(BaseModel):
    receipt_doc_ids: list[str] = Field(default_factory=list)


class TripShipmentLinkPayload(BaseModel):
    shipment_doc_ids: list[str] = Field(default_factory=list)


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


class TripReceiptItem(BaseModel):
    line_id: str
    receipt_doc_id: str
    receipt_number: str | None = None
    receipt_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None


class TripShipmentItem(BaseModel):
    line_id: str
    shipment_doc_id: str
    shipment_number: str | None = None
    shipment_status: str | None = None
    client_id: str | None = None
    client_name: str | None = None


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
