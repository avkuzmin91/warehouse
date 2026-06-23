from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from modules.auth.service import get_current_admin, get_current_warehouse
from modules.dictionaries.schemas import MessageResponse

from .schemas import (
    LocationBulkCreateRequest,
    LocationBulkResult,
    LocationCreateRequest,
    LocationItem,
    LocationLabelsResponse,
    LocationListResponse,
    LocationLookupResponse,
)
from .service import (
    bulk_create_locations,
    create_location,
    delete_location,
    list_location_labels,
    list_locations,
    lookup_location,
)

router = APIRouter(tags=["locations"])


@router.get("/locations", response_model=LocationListResponse)
def list_locations_endpoint(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    room: str | None = Query(None),
    rack: str | None = Query(None),
    search: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_locations(
        page, limit, room=room, rack=rack, search=search, include_deleted=include_deleted
    )


@router.post("/locations", response_model=LocationItem)
def create_location_endpoint(payload: LocationCreateRequest, admin=Depends(get_current_admin)):
    return create_location(payload, admin["id"])


@router.post("/locations/bulk", response_model=LocationBulkResult)
def bulk_create_locations_endpoint(payload: LocationBulkCreateRequest, admin=Depends(get_current_admin)):
    return bulk_create_locations(payload, admin["id"])


@router.get("/locations/labels", response_model=LocationLabelsResponse)
def location_labels_endpoint(
    admin=Depends(get_current_admin),
    room: str | None = Query(None),
    rack: str | None = Query(None),
    ids: str | None = Query(None, description="Список id мест через запятую — печать только выбранных"),
):
    _ = admin
    id_list = [s for s in (ids or "").split(",") if s.strip()] or None
    return list_location_labels(room=room, rack=rack, ids=id_list)


@router.get("/locations/by-code/{code}", response_model=LocationLookupResponse)
def lookup_location_endpoint(code: str, user=Depends(get_current_warehouse)):
    """Сканер кладовщика: QR/код места → запись справочника. found=false, если не найдено."""
    _ = user
    return lookup_location(code)


@router.delete("/locations/{loc_id}", response_model=MessageResponse)
def delete_location_endpoint(loc_id: str, admin=Depends(get_current_admin)):
    return delete_location(loc_id, admin["id"])
