from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from dbconn import get_connection
from modules.auth.service import get_current_warehouse

from .schemas import ScanContextDoc, ScanContextResponse
from .service import location_context, product_context

router = APIRouter(tags=["scan"])


@router.get("/scan/context", response_model=ScanContextResponse)
def scan_context(
    product_id: str | None = Query(None),
    location_id: str | None = Query(None),
    user=Depends(get_current_warehouse),
):
    """Справочник скана: живые документы, в которых участвует отсканированный объект.

    Ровно один из product_id / location_id. Role-фильтр не применяется — это контекст
    объекта, а не личная очередь задач (её отдаёт /tasks).
    """
    _ = user
    if bool(product_id) == bool(location_id):
        raise HTTPException(status_code=400, detail="Укажите ровно один из product_id / location_id")
    with get_connection() as conn:
        docs = product_context(conn, product_id) if product_id else location_context(conn, location_id)
    return ScanContextResponse(documents=[ScanContextDoc(**d) for d in docs])
