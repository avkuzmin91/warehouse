from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from dbconn import get_connection
from modules.auth.service import get_current_warehouse

from .schemas import ScanContextDoc, ScanContextResponse
from .service import location_context, variant_context

router = APIRouter(tags=["scan"])


@router.get("/scan/context", response_model=ScanContextResponse)
def scan_context(
    variant_id: str | None = Query(None),
    location_id: str | None = Query(None),
    user=Depends(get_current_warehouse),
):
    """Справочник скана: живые документы, в которых участвует отсканированный объект.

    Ровно один из variant_id / location_id. Role-фильтр не применяется — это контекст
    объекта, а не личная очередь задач (её отдаёт /tasks).
    """
    _ = user
    if bool(variant_id) == bool(location_id):
        raise HTTPException(status_code=400, detail="Укажите ровно один из variant_id / location_id")
    with get_connection() as conn:
        docs = variant_context(conn, variant_id) if variant_id else location_context(conn, location_id)
    return ScanContextResponse(documents=[ScanContextDoc(**d) for d in docs])
