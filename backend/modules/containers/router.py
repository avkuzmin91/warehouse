from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query

from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import (
    get_current_manager,
    get_current_shipment_viewer,
    get_current_stock_operator,
)

from .schemas import (
    ContainerBatchCreate,
    ContainerBatchResult,
    ContainerDetailResponse,
    ContainerItem,
    ContainerLabelsResponse,
    ContainerListResponse,
    ContainerLookupResponse,
    ContainerMoveRequest,
)
from .service import (
    container_contents,
    container_item,
    container_labels,
    create_containers,
    list_container_ops,
    list_containers,
    lookup_container,
    move_placed_container,
)

router = APIRouter(tags=["containers"])


@router.get("/containers", response_model=ContainerListResponse)
def list_containers_endpoint(
    user=Depends(get_current_shipment_viewer),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: str | None = Query(None),
    client_id: str | None = Query(None),
    doc_id: str | None = Query(None),
    zone_id: str | None = Query(None),
    search: str | None = Query(None),
):
    _ = user
    with get_connection() as conn:
        return list_containers(
            conn, page=page, limit=limit, status=status, client_id=client_id,
            doc_id=doc_id, zone_id=zone_id, search=search,
        )


@router.post("/containers", response_model=ContainerBatchResult)
def create_containers_endpoint(
    payload: ContainerBatchCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    """Завести пачку пустых коробов под печать этикеток."""
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "containers_create")
        if not proceed:
            return stored
        items = create_containers(conn, payload.count, uid)
        result = ContainerBatchResult(items=items)
        finish_idempotent(conn, x_request_id, result.model_dump())
        conn.commit()
    return result


@router.get("/containers/labels", response_model=ContainerLabelsResponse)
def container_labels_endpoint(
    user=Depends(get_current_manager),
    ids: str = Query(..., description="Список id коробов через запятую"),
):
    _ = user
    id_list = [s for s in (ids or "").split(",") if s.strip()]
    with get_connection() as conn:
        return container_labels(conn, id_list)


@router.get("/containers/by-code/{code}", response_model=ContainerLookupResponse)
def lookup_container_endpoint(code: str, user=Depends(get_current_stock_operator)):
    """Скан этикетки короба: QR/номер → короб. found=false, если не найден."""
    _ = user
    with get_connection() as conn:
        return lookup_container(conn, code)


@router.get("/containers/{container_id}", response_model=ContainerDetailResponse)
def get_container_endpoint(container_id: str, user=Depends(get_current_shipment_viewer)):
    _ = user
    with get_connection() as conn:
        return ContainerDetailResponse(
            doc=container_item(conn, container_id),
            contents=container_contents(conn, container_id),
            ops=list_container_ops(conn, container_id),
        )


@router.post("/containers/{container_id}/move", response_model=ContainerItem)
def move_container_endpoint(
    container_id: str,
    payload: ContainerMoveRequest,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    """Перенос размещённого короба в другую ячейку (скан короба → скан ячейки)."""
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "container_move")
        if not proceed:
            return stored
        item = move_placed_container(conn, container_id, payload.zone_id, uid)
        finish_idempotent(conn, x_request_id, item.model_dump())
        conn.commit()
    return item
