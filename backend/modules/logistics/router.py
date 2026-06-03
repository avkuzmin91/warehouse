from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    TRIP_DIRECTION_INBOUND,
    TRIP_LOAD_FULL,
    TRIP_LOAD_PARTIAL,
    TRIP_OP_ARRIVAL,
    TRIP_OP_CANCEL,
    TRIP_OP_CLOSE,
    TRIP_OP_COST_ACTUAL,
    TRIP_OP_DOC_CREATE,
    TRIP_OP_DOC_UPDATE,
    TRIP_OP_HANDOFF,
    TRIP_OP_RECEIPT_UNLINK,
    TRIP_OP_UNLOAD_DONE,
    TRIP_STATUS_ASSIGNEE_ROLE,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_CANCELLED,
    TRIP_STATUS_CLOSED,
    TRIP_STATUS_COSTING,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_RU,
    TRIP_STATUS_UNLOADING,
    TRIP_STATUSES_ALL,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager, get_current_warehouse
from modules.logistics.schemas import (
    TripArrivalPayload,
    TripCostPayload,
    TripDetailResponse,
    TripDocCreate,
    TripDocResponse,
    TripDocUpdate,
    TripExecutionPayload,
    TripLinkPayload,
    TripListItem,
    TripListResponse,
    TripOpResponse,
    TripReceiptItem,
    TripUnloadPayload,
)
from modules.logistics.service import (
    cascade_receipts_to_intake,
    link_receipts,
    list_trips_aggregated,
    next_trip_number,
)

router = APIRouter(tags=["logistics"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _doc_response(row) -> TripDocResponse:
    return TripDocResponse(
        id=str(row["id"]),
        trip_number=str(row["trip_number"]),
        direction=str(row["direction"]),
        status=str(row["status"]),
        assignee_role=row["assignee_role"],
        origin_id=row["origin_id"],
        origin_name=row["origin_name"],
        carrier_id=row["carrier_id"],
        carrier_name=row["carrier_name"],
        vehicle_type_id=row["vehicle_type_id"],
        vehicle_type_name=row["vehicle_type_name"],
        transport_ordered_at=row["transport_ordered_at"],
        eta=row["eta"],
        cost_estimate=float(row["cost_estimate"]) if row["cost_estimate"] is not None else None,
        comment=row["comment"],
        arrived_at=row["arrived_at"],
        unload_started_at=row["unload_started_at"],
        unload_finished_at=row["unload_finished_at"],
        load_factor=row["load_factor"],
        logistics_cost_actual=float(row["logistics_cost_actual"]) if row["logistics_cost_actual"] is not None else None,
        waiting_cost=float(row["waiting_cost"]) if row["waiting_cost"] is not None else None,
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
def create_trip(payload: TripDocCreate, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        trip_id = str(uuid4())
        trip_num = next_trip_number(conn)
        now = _now()
        conn.execute(
            """
            INSERT INTO trip_docs
              (id, trip_number, direction, status, assignee_role,
               origin_id, origin_name, carrier_id, carrier_name,
               vehicle_type_id, vehicle_type_name, transport_ordered_at, eta,
               cost_estimate, comment, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                trip_id, trip_num, TRIP_DIRECTION_INBOUND, TRIP_STATUS_DRAFT,
                TRIP_STATUS_ASSIGNEE_ROLE.get(TRIP_STATUS_DRAFT),
                (payload.origin_id or "").strip() or None,
                (payload.origin_name or "").strip() or None,
                (payload.carrier_id or "").strip() or None,
                (payload.carrier_name or "").strip() or None,
                (payload.vehicle_type_id or "").strip() or None,
                (payload.vehicle_type_name or "").strip() or None,
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
        if payload.receipt_doc_ids:
            link_receipts(conn, trip_id, payload.receipt_doc_ids, uid)
        conn.commit()
    return {"message": trip_id}


@router.get("/trips", response_model=TripListResponse)
def list_trips(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    status: str | None = Query(None),
    carrier_id: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(get_current_manager),
):
    with get_connection() as conn:
        total, rows = list_trips_aggregated(
            conn, page=page, limit=limit, status=status, carrier_id=carrier_id,
            search=search, statuses_all=TRIP_STATUSES_ALL,
        )
    items = [
        TripListItem(
            id=str(r["id"]),
            trip_number=str(r["trip_number"]),
            direction=str(r["direction"]),
            status=str(r["status"]),
            origin_name=r["origin_name"],
            carrier_name=r["carrier_name"],
            vehicle_type_name=r["vehicle_type_name"],
            eta=r["eta"],
            arrived_at=r["arrived_at"],
            cost_estimate=float(r["cost_estimate"]) if r["cost_estimate"] is not None else None,
            logistics_cost_actual=float(r["logistics_cost_actual"]) if r["logistics_cost_actual"] is not None else None,
            created_at=str(r["created_at"]),
            receipts_count=int(r["receipts_count"] or 0),
        )
        for r in rows
    ]
    return TripListResponse(items=items, total=total, page=page, limit=limit)


@router.get("/trips/{trip_id}", response_model=TripDetailResponse)
def get_trip(trip_id: str, user=Depends(get_current_manager)):
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
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
        ops_rows = conn.execute(
            "SELECT o.*, u.email AS user_email FROM trip_ops o "
            "LEFT JOIN users u ON u.id = o.created_by WHERE o.trip_id = ? ORDER BY o.created_at DESC",
            (trip_id,),
        ).fetchall()

    receipts = [
        TripReceiptItem(
            line_id=str(r["line_id"]),
            receipt_doc_id=str(r["receipt_doc_id"]),
            receipt_number=r["receipt_number"],
            receipt_status=r["receipt_status"],
            client_id=r["client_id"],
            client_name=r["client_name"],
        )
        for r in receipt_rows
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
    return TripDetailResponse(doc=_doc_response(doc_row), receipts=receipts, ops=ops)


@router.patch("/trips/{trip_id}")
def update_trip(trip_id: str, payload: TripDocUpdate, user=Depends(get_current_manager)):
    uid = str(user["id"])
    editable = {TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_COSTING}
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) not in editable:
            raise HTTPException(status_code=400, detail="Рейс в этом статусе нельзя редактировать")

        updates: list[str] = []
        params: list = []
        for col in (
            "origin_id", "origin_name", "carrier_id", "carrier_name",
            "vehicle_type_id", "vehicle_type_name", "transport_ordered_at", "eta", "comment",
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


@router.post("/trips/{trip_id}/receipts")
def link_trip_receipts(trip_id: str, payload: TripLinkPayload, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) not in (TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL):
            raise HTTPException(status_code=400, detail="Привязать поступления можно до начала разгрузки")
        link_receipts(conn, trip_id, payload.receipt_doc_ids, uid)
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
def handoff_trip(trip_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Передать на склад можно только черновик")
        cnt = conn.execute(
            "SELECT COUNT(*) AS c FROM trip_lines WHERE trip_id = ? AND is_deleted = 0", (trip_id,)
        ).fetchone()
        if int(cnt["c"] if cnt else 0) == 0:
            raise HTTPException(status_code=400, detail="Привяжите хотя бы одно поступление")
        _advance(conn, trip_id, to_status=TRIP_STATUS_AWAITING_ARRIVAL,
                 op_type=TRIP_OP_HANDOFF, comment="Черновик → Ожидает прибытия (передан на склад)", uid=uid)
        conn.commit()
    return {"message": TRIP_STATUS_AWAITING_ARRIVAL}


@router.post("/trips/{trip_id}/arrival")
def trip_arrival(trip_id: str, payload: TripArrivalPayload, user=Depends(get_current_warehouse)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_AWAITING_ARRIVAL:
            raise HTTPException(status_code=400, detail="Отметить прибытие можно только из статуса 'Ожидает прибытия'")
        arrived_at = (payload.arrived_at or "").strip() or _now()
        _advance(conn, trip_id, to_status=TRIP_STATUS_UNLOADING,
                 op_type=TRIP_OP_ARRIVAL, comment="Ожидает прибытия → Разгрузка (прибытие отмечено)", uid=uid,
                 extra_sql="arrived_at = ?, unload_started_at = ?",
                 extra_params=(arrived_at, arrived_at))
        conn.commit()
    return {"message": TRIP_STATUS_UNLOADING}


@router.post("/trips/{trip_id}/unload")
def trip_unload(trip_id: str, payload: TripUnloadPayload, user=Depends(get_current_warehouse)):
    uid = str(user["id"])
    if payload.load_factor is not None and payload.load_factor not in (TRIP_LOAD_FULL, TRIP_LOAD_PARTIAL):
        raise HTTPException(status_code=400, detail="Недопустимое значение загруженности")
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_UNLOADING:
            raise HTTPException(status_code=400, detail="Завершить разгрузку можно только из статуса 'Разгрузка'")
        unload_started_at = (
            (payload.unload_started_at or "").strip()
            or doc_row["unload_started_at"]
            or doc_row["arrived_at"]
            or _now()
        )
        unload_at = (payload.unload_finished_at or "").strip() or _now()
        _advance(conn, trip_id, to_status=TRIP_STATUS_COSTING,
                 op_type=TRIP_OP_UNLOAD_DONE, comment="Разгрузка → Уточнение стоимости (разгрузка завершена)", uid=uid,
                 extra_sql="unload_started_at = ?, unload_finished_at = ?, load_factor = ?",
                 extra_params=(unload_started_at, unload_at, payload.load_factor))
        cascade_receipts_to_intake(conn, trip_id, str(doc_row["trip_number"]), uid)
        conn.commit()
    return {"message": TRIP_STATUS_COSTING}


@router.post("/trips/{trip_id}/cost")
def trip_cost(trip_id: str, payload: TripCostPayload, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
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
        conn.commit()
    return {"message": "ok"}


@router.patch("/trips/{trip_id}/execution")
def update_trip_execution(trip_id: str, payload: TripExecutionPayload, user=Depends(get_current_manager)):
    uid = str(user["id"])
    if payload.load_factor is not None and payload.load_factor not in (TRIP_LOAD_FULL, TRIP_LOAD_PARTIAL):
        raise HTTPException(status_code=400, detail="Недопустимое значение загруженности")
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_COSTING:
            raise HTTPException(status_code=400, detail="Исполнение на складе можно редактировать только в статусе 'Уточнение стоимости'")
        now = _now()
        conn.execute(
            """
            UPDATE trip_docs
            SET arrived_at = ?, unload_started_at = ?, unload_finished_at = ?,
                load_factor = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                (payload.arrived_at or "").strip() or None,
                (payload.unload_started_at or "").strip() or None,
                (payload.unload_finished_at or "").strip() or None,
                payload.load_factor,
                now,
                trip_id,
            ),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_DOC_UPDATE, "Исполнение на складе изменено", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/trips/{trip_id}/close")
def close_trip(trip_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        if str(doc_row["status"]) != TRIP_STATUS_COSTING:
            raise HTTPException(status_code=400, detail="Закрыть можно только рейс в статусе 'Уточнение стоимости'")
        _advance(conn, trip_id, to_status=TRIP_STATUS_CLOSED,
                 op_type=TRIP_OP_CLOSE, comment="Уточнение стоимости → Закрыт", uid=uid)
        conn.commit()
    return {"message": TRIP_STATUS_CLOSED}


@router.post("/trips/{trip_id}/cancel")
def cancel_trip(trip_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = _fetch_doc(conn, trip_id)
        current = str(doc_row["status"])
        if current in (TRIP_STATUS_CLOSED, TRIP_STATUS_CANCELLED):
            raise HTTPException(status_code=400, detail="Рейс уже в финальном статусе")
        now = _now()
        conn.execute(
            "UPDATE trip_docs SET status = ?, assignee_role = NULL, updated_at = ? WHERE id = ?",
            (TRIP_STATUS_CANCELLED, now, trip_id),
        )
        conn.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_CANCEL,
             f"{TRIP_STATUS_RU.get(current, current)} → Аннулирован", now, uid),
        )
        conn.commit()
    return {"message": TRIP_STATUS_CANCELLED}
