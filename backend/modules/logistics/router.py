from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from idempotency import begin_idempotent, finish_idempotent
from config import (
    DISPATCH_CARGO_DEFECT,
    DISPATCH_CARGO_GOOD,
    INV_OP_INTAKE,
    INV_OP_STORAGE,
    TRIP_DIRECTION_INBOUND,
    TRIP_DIRECTION_OUTBOUND,
    TRIP_LOAD_FULL,
    TRIP_LOAD_PARTIAL,
    TRIP_OP_ARRIVAL,
    TRIP_OP_CANCEL,
    TRIP_OP_CLOSE,
    TRIP_OP_COST_ACTUAL,
    TRIP_OP_DEPARTURE,
    TRIP_OP_DOC_CREATE,
    TRIP_OP_DOC_UPDATE,
    TRIP_OP_HANDOFF,
    TRIP_OP_LOAD_DONE,
    TRIP_OP_RECEIPT_UNLINK,
    TRIP_OP_SHIPMENT_UNLINK,
    TRIP_OP_UNLOAD_DONE,
    TRIP_STATUS_ASSIGNEE_ROLE,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_CANCELLED,
    TRIP_STATUS_CLOSED,
    TRIP_STATUS_COSTING,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_UNLOADING,
    TRIP_STATUSES_ALL,
    trip_status_ru,
)
from dbconn import get_connection
from modules.auth.service import (
    get_current_document_creator,
    get_current_manager,
    get_current_warehouse,
)
from modules.logistics.schemas import (
    TripArrivalPayload,
    TripCarrierUpdate,
    TripCostPayload,
    TripDetailResponse,
    TripDispatchAllocItem,
    TripDispatchItem,
    TripDispatchLinkPayload,
    TripDocCreate,
    TripDocResponse,
    TripDocUpdate,
    TripExecutionPayload,
    TripLinkPayload,
    TripListItem,
    TripListResponse,
    TripOpResponse,
    TripReceiptAllocItem,
    TripReceiptItem,
    TripUnloadPayload,
)
from modules.logistics.service import (
    assert_dispatches_ready_for_load,
    cascade_dispatches_to_shipped,
    link_dispatches,
    link_receipts,
    list_trips_aggregated,
    next_trip_number,
    receive_receipts_for_trip,
    reverse_dispatch_consume_for_trip,
    reverse_receipt_intake_for_trip,
    sync_actual_arrival,
    sync_actual_ship_date,
)
from modules.expenses.service import (
    reattribute_trip_logistics_carrier,
    upsert_trip_logistics_expense,
)
from security import can_view_costs, ensure_cost_access, is_admin

router = APIRouter(tags=["logistics"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


_BUSINESS_TZ = ZoneInfo("Europe/Moscow")


def _business_now() -> str:
    """Настенное московское время события (YYYY-MM-DDTHH:mm) — единый базис с вводом пользователя.

    Дата-часть `arrived_at` арендуется аналитикой P&L для дневной атрибуции дохода.
    UTC-fallback увёл бы прибытие, отмеченное ночью по МСК (00:00–02:59), на предыдущий
    день, а у границы окна — в предыдущий отчётный период."""
    return datetime.now(_BUSINESS_TZ).strftime("%Y-%m-%dT%H:%M")


def _dt_value(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _ensure_unload_period(unload_started_at: str | None, unload_finished_at: str | None, noun: str = "разгрузки") -> None:
    start = _dt_value(unload_started_at)
    finish = _dt_value(unload_finished_at)
    if start is not None and finish is not None and finish < start:
        raise HTTPException(status_code=400, detail=f"Окончание {noun} не может быть раньше начала {noun}")


def _ensure_trip_manager_edit_access(user) -> None:
    if not can_view_costs(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")


def _doc_response(row, *, show_costs: bool = True) -> TripDocResponse:
    return TripDocResponse(
        id=str(row["id"]),
        trip_number=str(row["trip_number"]),
        direction=str(row["direction"]),
        cargo_type=str(row["cargo_type"] or DISPATCH_CARGO_GOOD),
        status=str(row["status"]),
        assignee_role=row["assignee_role"],
        origin_id=row["origin_id"],
        origin_name=row["origin_name"],
        carrier_id=row["carrier_id"],
        carrier_name=row["carrier_name"],
        vehicle_type_id=row["vehicle_type_id"],
        vehicle_type_name=row["vehicle_type_name"],
        vehicle_number=row["vehicle_number"],
        transport_ordered_at=row["transport_ordered_at"],
        eta=row["eta"],
        cost_estimate=float(row["cost_estimate"]) if show_costs and row["cost_estimate"] is not None else None,
        comment=row["comment"],
        arrived_at=row["arrived_at"],
        unload_started_at=row["unload_started_at"],
        unload_finished_at=row["unload_finished_at"],
        load_factor=row["load_factor"],
        logistics_cost_actual=float(row["logistics_cost_actual"]) if show_costs and row["logistics_cost_actual"] is not None else None,
        waiting_cost=float(row["waiting_cost"]) if show_costs and row["waiting_cost"] is not None else None,
        waiting_minutes=int(row["waiting_minutes"]) if row["waiting_minutes"] is not None else None,
        created_at=str(row["created_at"]),
        created_by=row["created_by"],
        updated_at=row["updated_at"],
    )


def _fetch_doc(conn, trip_id: str):
    row = conn.execute(
        "SELECT * FROM trip_docs WHERE id = ? AND is_deleted = 0", (trip_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Рейс не найден")
    return row


@router.post("/trips")
def create_trip(
    payload: TripDocCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_document_creator),
):
    if payload.cost_estimate is not None:
        ensure_cost_access(user)
    direction = (payload.direction or TRIP_DIRECTION_INBOUND).strip()
    if direction not in (TRIP_DIRECTION_INBOUND, TRIP_DIRECTION_OUTBOUND):
        raise HTTPException(status_code=400, detail="Недопустимое направление рейса")
    # Тип груза значим только для рейса отгрузки; поступления всегда 'good'.
    if direction == TRIP_DIRECTION_OUTBOUND:
        cargo_type = (payload.cargo_type or DISPATCH_CARGO_GOOD).strip()
        if cargo_type not in (DISPATCH_CARGO_GOOD, DISPATCH_CARGO_DEFECT):
            raise HTTPException(status_code=400, detail="Недопустимый тип груза рейса")
    else:
        cargo_type = DISPATCH_CARGO_GOOD
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "trip_create")
        if not proceed:
            return stored
        trip_id = str(uuid4())
        trip_num = next_trip_number(conn)
        now = _now()
        conn.execute(
            """
            INSERT INTO trip_docs
              (id, trip_number, direction, cargo_type, status, assignee_role,
               origin_id, origin_name, carrier_id, carrier_name,
               vehicle_type_id, vehicle_type_name, vehicle_number, transport_ordered_at, eta,
               cost_estimate, comment, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                trip_id, trip_num, direction, cargo_type, TRIP_STATUS_DRAFT,
                TRIP_STATUS_ASSIGNEE_ROLE.get(TRIP_STATUS_DRAFT),
                (payload.origin_id or "").strip() or None,
                (payload.origin_name or "").strip() or None,
                (payload.carrier_id or "").strip() or None,
                (payload.carrier_name or "").strip() or None,
                (payload.vehicle_type_id or "").strip() or None,
                (payload.vehicle_type_name or "").strip() or None,
                (payload.vehicle_number or "").strip() or None,
                (payload.transport_ordered_at or "").strip() or None,
                (payload.eta or "").strip() or None,
                payload.cost_estimate,
                (payload.comment or "").strip() or None,
                now, uid,
            ),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_DOC_CREATE, f"Рейс {trip_num} создан", now, uid),
        )
        if direction == TRIP_DIRECTION_OUTBOUND:
            if payload.dispatch_doc_ids:
                link_dispatches(
                    conn, trip_id,
                    [{"dispatch_doc_id": sid, "allocations": []} for sid in payload.dispatch_doc_ids],
                    uid,
                )
        elif payload.receipt_doc_ids:
            link_receipts(
                conn, trip_id,
                [{"receipt_doc_id": rid, "allocations": []} for rid in payload.receipt_doc_ids],
                uid,
            )
        result = {"message": trip_id}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.get("/trips", response_model=TripListResponse)
def list_trips(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    direction: str | None = Query(None),
    status: str | None = Query(None),
    statuses: list[str] | None = Query(None),
    carrier_id: str | None = Query(None),
    search: str | None = Query(None),
    eta_from: str | None = Query(None),
    eta_to: str | None = Query(None),
    user=Depends(get_current_manager),
):
    if direction and direction not in (TRIP_DIRECTION_INBOUND, TRIP_DIRECTION_OUTBOUND):
        direction = None
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        total, rows = list_trips_aggregated(
            conn, page=page, limit=limit, direction=direction, status=status, statuses=statuses,
            carrier_id=carrier_id, search=search, eta_from=eta_from, eta_to=eta_to,
            statuses_all=TRIP_STATUSES_ALL,
        )
    items = [
        TripListItem(
            id=str(r["id"]),
            trip_number=str(r["trip_number"]),
            direction=str(r["direction"]),
            cargo_type=str(r["cargo_type"] or DISPATCH_CARGO_GOOD),
            status=str(r["status"]),
            origin_name=r["origin_name"],
            carrier_name=r["carrier_name"],
            vehicle_type_name=r["vehicle_type_name"],
            vehicle_number=r["vehicle_number"],
            eta=r["eta"],
            arrived_at=r["arrived_at"],
            cost_estimate=float(r["cost_estimate"]) if show_costs and r["cost_estimate"] is not None else None,
            logistics_cost_actual=float(r["logistics_cost_actual"]) if show_costs and r["logistics_cost_actual"] is not None else None,
            created_at=str(r["created_at"]),
            receipts_count=int(r["receipts_count"] or 0),
            items_qty=int(r["items_qty"] or 0),
            client_names=[str(n) for n in (r["client_names"] or []) if n],
        )
        for r in rows
    ]
    return TripListResponse(items=items, total=total, page=page, limit=limit)


@router.get("/trips/{trip_id}", response_model=TripDetailResponse)
def get_trip(trip_id: str, user=Depends(get_current_manager)):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        is_outbound = str(doc_row["direction"]) == TRIP_DIRECTION_OUTBOUND
        receipt_rows = []
        dispatch_rows = []
        alloc_rows = []
        recv_alloc_rows = []
        recv_by_line: dict[str, int] = {}
        if is_outbound:
            dispatch_rows = conn.execute(
                """
                SELECT l.id AS line_id, l.dispatch_doc_id, l.client_id, l.client_name,
                       s.doc_number AS dispatch_number, s.status AS dispatch_status
                FROM trip_lines l
                LEFT JOIN dispatch_docs s ON s.id = l.dispatch_doc_id
                WHERE l.trip_id = ? AND l.is_deleted = 0
                ORDER BY l.created_at
                """,
                (trip_id,),
            ).fetchall()
            alloc_rows = conn.execute(
                """
                SELECT ta.trip_line_id, ta.qty,
                       sl.id AS dispatch_line_id,
                       COALESCE(NULLIF(sl.product_sku, ''), p.sku) AS product_sku,
                       COALESCE(NULLIF(sl.product_name, ''), p.name) AS product_name,
                       sl.color_name, sl.size_name, sl.qty AS line_qty, sl.shipped_qty
                FROM trip_alloc ta
                JOIN trip_lines l ON l.id = ta.trip_line_id
                JOIN dispatch_lines sl ON sl.id = ta.dispatch_line_id
                LEFT JOIN products p ON p.id = sl.product_id
                WHERE l.trip_id = ? AND COALESCE(ta.is_deleted, 0) = 0 AND l.is_deleted = 0
                ORDER BY sl.product_sku
                """,
                (trip_id,),
            ).fetchall()
        else:
            receipt_rows = conn.execute(
                """
                SELECT l.id AS line_id, l.receipt_doc_id, l.client_id, l.client_name,
                       r.doc_number AS receipt_number, r.status AS receipt_status
                FROM trip_lines l
                LEFT JOIN receipt_docs r ON r.id = l.receipt_doc_id
                WHERE l.trip_id = ? AND l.is_deleted = 0
                ORDER BY l.created_at
                """,
                (trip_id,),
            ).fetchall()
            recv_alloc_rows = conn.execute(
                """
                SELECT ta.trip_line_id, ta.qty,
                       rl.id AS receipt_line_id,
                       COALESCE(NULLIF(rl.product_sku, ''), p.sku) AS product_sku,
                       COALESCE(NULLIF(rl.product_name, ''), p.name) AS product_name,
                       rl.color_name, rl.size_name, rl.planned_qty, rl.accepted_qty,
                       rl.storage_zone_id, rl.storage_zone_name
                FROM trip_alloc ta
                JOIN trip_lines l ON l.id = ta.trip_line_id
                JOIN receipt_lines rl ON rl.id = ta.receipt_line_id
                LEFT JOIN products p ON p.id = rl.product_id
                WHERE l.trip_id = ? AND COALESCE(ta.is_deleted, 0) = 0 AND l.is_deleted = 0
                ORDER BY rl.product_sku
                """,
                (trip_id,),
            ).fetchall()
            # Принято кладовщиком фактически в этом рейсе = нетто журнала по строке:
            # приход приёмки (intake→storage) минус сторно при отмене рейса (storage→intake).
            recv_net_rows = conn.execute(
                """
                SELECT receipt_line_id,
                       COALESCE(SUM(CASE WHEN from_op = ? AND to_op = ? THEN qty ELSE 0 END), 0)
                     - COALESCE(SUM(CASE WHEN from_op = ? AND to_op = ? THEN qty ELSE 0 END), 0) AS net
                FROM zone_relocations
                WHERE trip_id = ? AND receipt_line_id IS NOT NULL
                GROUP BY receipt_line_id
                """,
                (INV_OP_INTAKE, INV_OP_STORAGE, INV_OP_STORAGE, INV_OP_INTAKE, trip_id),
            ).fetchall()
            recv_by_line = {str(r["receipt_line_id"]): int(r["net"] or 0) for r in recv_net_rows}
        ops_rows = conn.execute(
            "SELECT o.*, u.email AS user_email FROM trip_ops o "
            "LEFT JOIN users u ON u.id = o.created_by WHERE o.trip_id = ? ORDER BY o.created_at DESC",
            (trip_id,),
        ).fetchall()

    recv_alloc_by_line: dict[str, list[TripReceiptAllocItem]] = {}
    for a in recv_alloc_rows:
        variant = " · ".join(x for x in [a["color_name"], a["size_name"]] if x) or None
        recv_alloc_by_line.setdefault(str(a["trip_line_id"]), []).append(
            TripReceiptAllocItem(
                line_id=str(a["receipt_line_id"]),
                product_sku=a["product_sku"],
                product_name=a["product_name"],
                variant=variant,
                qty=int(a["qty"] or 0),
                planned_qty=int(a["planned_qty"] or 0),
                accepted_qty=int(a["accepted_qty"] or 0),
                received_qty=recv_by_line.get(str(a["receipt_line_id"]), 0),
                storage_zone_id=a["storage_zone_id"],
                storage_zone_name=a["storage_zone_name"],
            )
        )
    receipts = [
        TripReceiptItem(
            line_id=str(r["line_id"]),
            receipt_doc_id=str(r["receipt_doc_id"]),
            receipt_number=r["receipt_number"],
            receipt_status=r["receipt_status"],
            client_id=r["client_id"],
            client_name=r["client_name"],
            allocations=recv_alloc_by_line.get(str(r["line_id"]), []),
            allocated_qty=sum(al.qty for al in recv_alloc_by_line.get(str(r["line_id"]), [])),
            received_qty=sum(al.received_qty for al in recv_alloc_by_line.get(str(r["line_id"]), [])),
        )
        for r in receipt_rows
    ]
    alloc_by_line: dict[str, list[TripDispatchAllocItem]] = {}
    for a in alloc_rows:
        variant = " · ".join(x for x in [a["color_name"], a["size_name"]] if x) or None
        alloc_by_line.setdefault(str(a["trip_line_id"]), []).append(
            TripDispatchAllocItem(
                line_id=str(a["dispatch_line_id"]),
                product_sku=a["product_sku"],
                product_name=a["product_name"],
                variant=variant,
                qty=int(a["qty"] or 0),
                line_qty=int(a["line_qty"] or 0),
                shipped_qty=int(a["shipped_qty"] or 0),
            )
        )
    dispatches = [
        TripDispatchItem(
            line_id=str(s["line_id"]),
            dispatch_doc_id=str(s["dispatch_doc_id"]),
            dispatch_number=s["dispatch_number"],
            dispatch_status=s["dispatch_status"],
            client_id=s["client_id"],
            client_name=s["client_name"],
            allocations=alloc_by_line.get(str(s["line_id"]), []),
            allocated_qty=sum(al.qty for al in alloc_by_line.get(str(s["line_id"]), [])),
        )
        for s in dispatch_rows
    ]
    ops = [
        TripOpResponse(
            id=str(o["id"]),
            trip_id=trip_id,
            op_type=str(o["op_type"]),
            comment=o["comment"],
            created_at=str(o["created_at"]),
            created_by=o["created_by"],
            created_by_email=o["user_email"],
        )
        for o in ops_rows
    ]
    return TripDetailResponse(
        doc=_doc_response(doc_row, show_costs=show_costs),
        receipts=receipts, dispatches=dispatches, ops=ops,
    )


@router.patch("/trips/{trip_id}")
def update_trip(trip_id: str, payload: TripDocUpdate, user=Depends(get_current_manager)):
    _ensure_trip_manager_edit_access(user)
    if "cost_estimate" in payload.model_fields_set:
        ensure_cost_access(user)
    uid = str(user["id"])
    editable = {TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING, TRIP_STATUS_COSTING}
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) not in editable:
            raise HTTPException(status_code=400, detail="Рейс в этом статусе нельзя редактировать")

        updates: list[str] = []
        params: list = []
        for col in (
            "origin_id", "origin_name", "carrier_id", "carrier_name",
            "vehicle_type_id", "vehicle_type_name", "vehicle_number", "transport_ordered_at", "eta", "comment",
        ):
            val = getattr(payload, col)
            if val is not None:
                updates.append(f"{col} = ?")
                params.append((val or "").strip() or None)
        if payload.cost_estimate is not None:
            updates.append("cost_estimate = ?")
            params.append(payload.cost_estimate)

        if updates:
            now = _now()
            updates.append("updated_at = ?")
            params.append(now)
            params.append(trip_id)
            conn.execute(f"UPDATE trip_docs SET {', '.join(updates)} WHERE id = ?", params)
            conn.execute(
                "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), trip_id, TRIP_OP_DOC_UPDATE, "Карточка рейса изменена", now, uid),
            )
            conn.commit()
    return {"message": "ok"}


@router.patch("/trips/{trip_id}/carrier")
def update_trip_carrier(trip_id: str, payload: TripCarrierUpdate, user=Depends(get_current_manager)):
    """Смена перевозчика у закрытого рейса (только админ). Логистический расход рейса и его
    учёт в «Задолженности по перевозчикам» переезжают на нового перевозчика — но лишь пока
    расход не оплачивается (иначе 400, чтобы не искажать историю платежей)."""
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    uid = str(user["id"])
    carrier_id = (payload.carrier_id or "").strip() or None
    carrier_name = (payload.carrier_name or "").strip() or None
    if not carrier_id:
        raise HTTPException(status_code=400, detail="Укажите перевозчика")
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_CLOSED:
            raise HTTPException(status_code=400, detail="Сменить перевозчика можно только у закрытого рейса")
        if str(doc_row["carrier_id"] or "") == carrier_id:
            return {"message": "ok"}
        old_name = doc_row["carrier_name"] or "—"
        # Сначала переносим расход (валидация «не оплачивается» — до записи в рейс).
        reattribute_trip_logistics_carrier(
            conn, trip_id, carrier_id=carrier_id, carrier_name=carrier_name, uid=uid
        )
        now = _now()
        conn.execute(
            "UPDATE trip_docs SET carrier_id = ?, carrier_name = ?, updated_at = ? WHERE id = ?",
            (carrier_id, carrier_name, now, trip_id),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_DOC_UPDATE,
             f"Перевозчик изменён: {old_name} → {carrier_name or '—'}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/trips/{trip_id}/receipts")
def link_trip_receipts(trip_id: str, payload: TripLinkPayload, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["direction"]) == TRIP_DIRECTION_OUTBOUND:
            raise HTTPException(status_code=400, detail="Поступления можно привязать только к рейсу поступления")
        if str(doc_row["status"]) not in (TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL):
            raise HTTPException(status_code=400, detail="Привязать поступления можно до начала разгрузки")
        items = [
            {
                "receipt_doc_id": it.receipt_doc_id,
                "allocations": [{"line_id": a.line_id, "qty": a.qty} for a in it.allocations],
            }
            for it in payload.items
        ]
        link_receipts(conn, trip_id, items, uid)
        conn.commit()
    return {"message": "ok"}


@router.delete("/trips/{trip_id}/receipts/{receipt_doc_id}")
def unlink_trip_receipt(trip_id: str, receipt_doc_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) not in (TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL):
            raise HTTPException(status_code=400, detail="Отвязать поступление можно до начала разгрузки")
        line = conn.execute(
            "SELECT l.id, r.doc_number FROM trip_lines l LEFT JOIN receipt_docs r ON r.id = l.receipt_doc_id "
            "WHERE l.trip_id = ? AND l.receipt_doc_id = ? AND l.is_deleted = 0",
            (trip_id, receipt_doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Поступление не привязано к рейсу")
        now = _now()
        conn.execute("UPDATE trip_lines SET is_deleted = 1 WHERE id = ?", (str(line["id"]),))
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_RECEIPT_UNLINK,
             f"Отвязано поступление {line['doc_number']}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/trips/{trip_id}/dispatches")
def link_trip_dispatches(trip_id: str, payload: TripDispatchLinkPayload, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["direction"]) != TRIP_DIRECTION_OUTBOUND:
            raise HTTPException(status_code=400, detail="Отгрузки можно привязать только к рейсу отгрузки")
        if str(doc_row["status"]) not in (TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL):
            raise HTTPException(status_code=400, detail="Привязать отгрузки можно до начала погрузки")
        items = [
            {
                "dispatch_doc_id": it.dispatch_doc_id,
                "allocations": [{"line_id": a.line_id, "qty": a.qty} for a in it.allocations],
            }
            for it in payload.items
        ]
        link_dispatches(conn, trip_id, items, uid)
        conn.commit()
    return {"message": "ok"}


@router.delete("/trips/{trip_id}/dispatches/{dispatch_doc_id}")
def unlink_trip_dispatch(trip_id: str, dispatch_doc_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) not in (TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING):
            raise HTTPException(status_code=400, detail="Отвязать отгрузку можно до завершения погрузки")
        line = conn.execute(
            "SELECT l.id, s.doc_number FROM trip_lines l LEFT JOIN dispatch_docs s ON s.id = l.dispatch_doc_id "
            "WHERE l.trip_id = ? AND l.dispatch_doc_id = ? AND l.is_deleted = 0",
            (trip_id, dispatch_doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Отгрузка не привязана к рейсу")
        now = _now()
        conn.execute("UPDATE trip_lines SET is_deleted = 1 WHERE id = ?", (str(line["id"]),))
        conn.execute(
            "UPDATE trip_alloc SET is_deleted = 1 WHERE trip_line_id = ? AND COALESCE(is_deleted, 0) = 0",
            (str(line["id"]),),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_SHIPMENT_UNLINK,
             f"Отвязана отгрузка {line['doc_number']}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


def _advance(conn, trip_id: str, *, to_status: str, op_type: str,
             comment: str, uid: str, extra_sql: str = "", extra_params: tuple = ()) -> None:
    now = _now()
    assignee = TRIP_STATUS_ASSIGNEE_ROLE.get(to_status)
    set_clause = "status = ?, assignee_role = ?, updated_at = ?"
    params: list = [to_status, assignee, now]
    if extra_sql:
        set_clause += ", " + extra_sql
        params += list(extra_params)
    params.append(trip_id)
    conn.execute(f"UPDATE trip_docs SET {set_clause} WHERE id = ?", params)
    conn.execute(
        "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), trip_id, op_type, comment, now, uid),
    )


@router.post("/trips/{trip_id}/handoff")
def handoff_trip(
    trip_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "trip_handoff", response={"message": TRIP_STATUS_AWAITING_ARRIVAL})
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Передать на склад можно только черновик")
        outbound = str(doc_row["direction"]) == TRIP_DIRECTION_OUTBOUND
        cnt = conn.execute(
            "SELECT COUNT(*) AS c FROM trip_lines WHERE trip_id = ? AND is_deleted = 0", (trip_id,)
        ).fetchone()
        if int(cnt["c"] if cnt else 0) == 0:
            raise HTTPException(
                status_code=400,
                detail="Привяжите хотя бы одну отгрузку" if outbound else "Привяжите хотя бы одно поступление",
            )
        required = [
            ("origin_id", "Куда" if outbound else "Откуда"),
            ("carrier_id", "Перевозчик"),
            ("vehicle_type_id", "Тип кузова"),
            ("vehicle_number", "Гос. номер"),
            ("cost_estimate", "Стоимость логистики (план)"),
            ("transport_ordered_at", "Транспорт заказан"),
            ("eta", "Плановое прибытие"),
        ]
        missing = [label for col, label in required if doc_row[col] in (None, "")]
        if missing:
            raise HTTPException(status_code=400, detail="Заполните обязательные поля: " + ", ".join(missing))
        if str(doc_row["eta"]) < str(doc_row["transport_ordered_at"]):
            raise HTTPException(
                status_code=400,
                detail="Плановое прибытие не может быть раньше заказа транспорта",
            )
        to_ru = trip_status_ru(str(doc_row["direction"]), TRIP_STATUS_AWAITING_ARRIVAL)
        _advance(conn, trip_id, to_status=TRIP_STATUS_AWAITING_ARRIVAL,
                 op_type=TRIP_OP_HANDOFF, comment=f"Черновик → {to_ru} (передан на склад)", uid=uid)
        conn.commit()
    return {"message": TRIP_STATUS_AWAITING_ARRIVAL}


@router.post("/trips/{trip_id}/arrival")
def trip_arrival(
    trip_id: str,
    payload: TripArrivalPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_warehouse),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "trip_arrival", response={"message": TRIP_STATUS_UNLOADING}
        )
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        direction = str(doc_row["direction"])
        outbound = direction == TRIP_DIRECTION_OUTBOUND
        if str(doc_row["status"]) != TRIP_STATUS_AWAITING_ARRIVAL:
            from_ru = trip_status_ru(direction, TRIP_STATUS_AWAITING_ARRIVAL)
            verb = "прибытие"
            raise HTTPException(status_code=400, detail=f"Отметить {verb} можно только из статуса '{from_ru}'")
        arrived_at = (payload.arrived_at or "").strip() or _business_now()
        from_ru = trip_status_ru(direction, TRIP_STATUS_AWAITING_ARRIVAL)
        to_ru = trip_status_ru(direction, TRIP_STATUS_UNLOADING)
        event = "прибытие отмечено"
        _advance(conn, trip_id, to_status=TRIP_STATUS_UNLOADING,
                 op_type=TRIP_OP_DEPARTURE if outbound else TRIP_OP_ARRIVAL,
                 comment=f"{from_ru} → {to_ru} ({event})", uid=uid,
                 extra_sql="arrived_at = ?, unload_started_at = ?",
                 extra_params=(arrived_at, arrived_at))
        conn.commit()
    return {"message": TRIP_STATUS_UNLOADING}


@router.post("/trips/{trip_id}/unload")
def trip_unload(
    trip_id: str,
    payload: TripUnloadPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_warehouse),
):
    uid = str(user["id"])
    if not payload.load_factor:
        raise HTTPException(status_code=400, detail="Укажите загруженность машины")
    if payload.load_factor not in (TRIP_LOAD_FULL, TRIP_LOAD_PARTIAL):
        raise HTTPException(status_code=400, detail="Недопустимое значение загруженности")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(
            conn, x_request_id, uid, "trip_unload", response={"message": TRIP_STATUS_COSTING}
        )
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        direction = str(doc_row["direction"])
        outbound = direction == TRIP_DIRECTION_OUTBOUND
        from_ru = trip_status_ru(direction, TRIP_STATUS_UNLOADING)
        to_ru = trip_status_ru(direction, TRIP_STATUS_COSTING)
        op_noun = "погрузку" if outbound else "разгрузку"
        if str(doc_row["status"]) != TRIP_STATUS_UNLOADING:
            raise HTTPException(status_code=400, detail=f"Завершить {op_noun} можно только из статуса '{from_ru}'")
        if outbound:
            assert_dispatches_ready_for_load(conn, trip_id)
        unload_started_at = (
            (payload.unload_started_at or "").strip()
            or doc_row["unload_started_at"]
            or doc_row["arrived_at"]
            or _business_now()
        )
        unload_at = (payload.unload_finished_at or "").strip() or _business_now()
        _ensure_unload_period(unload_started_at, unload_at, "погрузки" if outbound else "разгрузки")
        done = "погрузка завершена" if outbound else "разгрузка завершена"
        _advance(conn, trip_id, to_status=TRIP_STATUS_COSTING,
                 op_type=TRIP_OP_LOAD_DONE if outbound else TRIP_OP_UNLOAD_DONE,
                 comment=f"{from_ru} → {to_ru} ({done})", uid=uid,
                 extra_sql="unload_started_at = ?, unload_finished_at = ?, load_factor = ?",
                 extra_params=(unload_started_at, unload_at, payload.load_factor))
        if outbound:
            cascade_dispatches_to_shipped(conn, trip_id, str(doc_row["trip_number"]), uid)
            sync_actual_ship_date(conn, trip_id, doc_row["arrived_at"])
        else:
            placements_by_line: dict[str, list[dict]] = {}
            for x in payload.receipt_lines:
                if x.placements:
                    placements_by_line[x.line_id] = [
                        {
                            "id": (p.storage_zone_id or "").strip() or None,
                            "name": (p.storage_zone_name or "").strip() or None,
                            "qty": int(p.qty or 0),
                        }
                        for p in x.placements
                    ]
                else:
                    placements_by_line[x.line_id] = [
                        {
                            "id": (x.storage_zone_id or "").strip() or None,
                            "name": (x.storage_zone_name or "").strip() or None,
                            "qty": int(x.accepted_qty or 0),
                        }
                    ]
            receive_receipts_for_trip(
                conn, trip_id, str(doc_row["trip_number"]), uid,
                placements_by_line=placements_by_line,
            )
            sync_actual_arrival(conn, trip_id, doc_row["arrived_at"])
        conn.commit()
    return {"message": TRIP_STATUS_COSTING}


@router.post("/trips/{trip_id}/cost")
def trip_cost(
    trip_id: str,
    payload: TripCostPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    ensure_cost_access(user)
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "trip_cost", response={"message": "ok"})
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_COSTING:
            raise HTTPException(status_code=400, detail="Внести стоимость можно только в статусе 'Уточнение стоимости'")
        updates: list[str] = []
        params: list = []
        if payload.logistics_cost_actual is not None:
            updates.append("logistics_cost_actual = ?")
            params.append(payload.logistics_cost_actual)
        if payload.waiting_cost is not None:
            updates.append("waiting_cost = ?")
            params.append(payload.waiting_cost)
        if payload.waiting_minutes is not None:
            updates.append("waiting_minutes = ?")
            params.append(payload.waiting_minutes)
        if not updates:
            raise HTTPException(status_code=400, detail="Нет данных для сохранения")
        now = _now()
        updates.append("updated_at = ?")
        params.append(now)
        params.append(trip_id)
        conn.execute(f"UPDATE trip_docs SET {', '.join(updates)} WHERE id = ?", params)
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_COST_ACTUAL, "Внесена фактическая стоимость логистики", now, uid),
        )
        # Стоимость рейса ≠ оплата: заводим/обновляем расход «ожидает оплаты» в реестре.
        upsert_trip_logistics_expense(conn, _fetch_doc(conn, trip_id), uid)
        conn.commit()
    return {"message": "ok"}


@router.patch("/trips/{trip_id}/execution")
def update_trip_execution(trip_id: str, payload: TripExecutionPayload, user=Depends(get_current_manager)):
    _ensure_trip_manager_edit_access(user)
    uid = str(user["id"])
    if payload.load_factor is not None and payload.load_factor not in (TRIP_LOAD_FULL, TRIP_LOAD_PARTIAL):
        raise HTTPException(status_code=400, detail="Недопустимое значение загруженности")
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_COSTING:
            raise HTTPException(status_code=400, detail="Исполнение на складе можно редактировать только в статусе 'Уточнение стоимости'")
        outbound = str(doc_row["direction"]) == TRIP_DIRECTION_OUTBOUND
        arrived_at = (payload.arrived_at or "").strip() or None
        unload_started_at = (payload.unload_started_at or "").strip() or None
        unload_finished_at = (payload.unload_finished_at or "").strip() or None
        _ensure_unload_period(unload_started_at, unload_finished_at, "погрузки" if outbound else "разгрузки")
        now = _now()
        conn.execute(
            """
            UPDATE trip_docs
            SET arrived_at = ?, unload_started_at = ?, unload_finished_at = ?,
                load_factor = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                arrived_at,
                unload_started_at,
                unload_finished_at,
                payload.load_factor,
                now,
                trip_id,
            ),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_DOC_UPDATE, "Исполнение на складе изменено", now, uid),
        )
        if outbound:
            sync_actual_ship_date(conn, trip_id, arrived_at)
        else:
            sync_actual_arrival(conn, trip_id, arrived_at)
        conn.commit()
    return {"message": "ok"}


@router.post("/trips/{trip_id}/close")
def close_trip(
    trip_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "trip_close", response={"message": TRIP_STATUS_CLOSED})
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_COSTING:
            raise HTTPException(status_code=400, detail="Закрыть можно только рейс в статусе 'Уточнение стоимости'")
        _advance(conn, trip_id, to_status=TRIP_STATUS_CLOSED,
                 op_type=TRIP_OP_CLOSE, comment="Уточнение стоимости → Закрыт", uid=uid)
        conn.commit()
    return {"message": TRIP_STATUS_CLOSED}


@router.post("/trips/{trip_id}/cancel")
def cancel_trip(
    trip_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "trip_cancel", response={"message": TRIP_STATUS_CANCELLED})
        if not proceed:
            return stored
        doc_row = _fetch_doc(conn, trip_id)
        current = str(doc_row["status"])
        if current in (TRIP_STATUS_CLOSED, TRIP_STATUS_CANCELLED):
            raise HTTPException(status_code=400, detail="Рейс уже в финальном статусе")
        now = _now()
        # Если рейс уже двигал остаток (был в «Уточнение стоимости») — вернуть назад:
        # отгрузка списанное → «Готов»; поступление принятое → снять с хранения.
        if str(doc_row["direction"]) == TRIP_DIRECTION_OUTBOUND:
            reverse_dispatch_consume_for_trip(conn, trip_id, uid)
        else:
            reverse_receipt_intake_for_trip(conn, trip_id, uid)
        conn.execute(
            "UPDATE trip_docs SET status = ?, assignee_role = NULL, updated_at = ? WHERE id = ?",
            (TRIP_STATUS_CANCELLED, now, trip_id),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_CANCEL,
             f"{trip_status_ru(str(doc_row['direction']), current)} → Аннулирован", now, uid),
        )
        conn.commit()
    return {"message": TRIP_STATUS_CANCELLED}
