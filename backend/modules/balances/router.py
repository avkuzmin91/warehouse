from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.balances.schemas import BalanceListResponse, BalanceZonesResponse
from modules.balances.service import get_balances, get_balances_by_zone

router = APIRouter(tags=["balances"])


@router.get("/balances", response_model=BalanceListResponse)
def list_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    has_defect: bool = Query(False),
    user=Depends(lambda: None),  # placeholder — заменяется на get_current_manager в app.py
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


@router.get("/balances/zones", response_model=BalanceZonesResponse)
def list_balances_by_zone(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    user=Depends(lambda: None),  # placeholder — как у /balances
):
    with get_connection() as conn:
        return get_balances_by_zone(
            conn,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
        )
