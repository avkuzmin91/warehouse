from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_manager, get_current_shipment_viewer
from modules.balances.schemas import (
    BalanceListResponse,
    BalanceSummaryResponse,
    BalanceZonesResponse,
    QualityChangeCreate,
    ZoneRelocationCreate,
    ZoneRelocationListResponse,
)
from modules.balances.service import (
    create_quality_change,
    create_zone_relocation,
    get_balances,
    get_balances_by_zone,
    get_balances_summary,
    list_zone_relocations,
)

router = APIRouter(tags=["balances"])


@router.get("/balances", response_model=BalanceListResponse)
def list_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    has_defect: bool = Query(False),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances(
            conn,
            page=page,
            limit=limit,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
            has_defect=has_defect,
        )


@router.get("/balances/summary", response_model=BalanceSummaryResponse)
def balances_summary(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    has_defect: bool = Query(False),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances_summary(
            conn,
            client_id=client_id,
            search=search,
            has_defect=has_defect,
        )


@router.get("/balances/zones", response_model=BalanceZonesResponse)
def list_balances_by_zone(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    user=Depends(get_current_shipment_viewer),
):
    with get_connection() as conn:
        return get_balances_by_zone(
            conn,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
        )


@router.post("/balances/relocations")
def create_relocation(payload: ZoneRelocationCreate, user=Depends(get_current_manager)):
    with get_connection() as conn:
        create_zone_relocation(conn, payload, str(user["id"]))
    return {"message": "ok"}


@router.post("/balances/quality-changes")
def create_quality_change_op(payload: QualityChangeCreate, user=Depends(get_current_manager)):
    with get_connection() as conn:
        create_quality_change(conn, payload, str(user["id"]))
    return {"message": "ok"}


@router.get("/balances/relocations", response_model=ZoneRelocationListResponse)
def list_relocations(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(get_current_manager),
):
    with get_connection() as conn:
        return list_zone_relocations(conn, page=page, limit=limit, client_id=client_id, search=search)
