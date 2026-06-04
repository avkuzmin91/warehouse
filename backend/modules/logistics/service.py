from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    RECEIPT_OP_INTAKE_START,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PLANNED,
    TRIP_OP_RECEIPT_LINK,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_trip_number(connection) -> str:
    """Следующий номер рейса формата TR-00001 (MAX, как у поступлений)."""
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(trip_number, 4) AS INTEGER)), 0) AS max_n
        FROM trip_docs
        WHERE trip_number LIKE 'TR-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"TR-{n:05d}"


def list_trips_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    status: str | None,
    carrier_id: str | None,
    search: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    conds = ["d.is_deleted = 0"]
    params: list = []

    if status and status in statuses_all:
        conds.append("d.status = ?")
        params.append(status)
    if carrier_id:
        conds.append("d.carrier_id = ?")
        params.append(carrier_id.strip())
    if search:
        s = f"%{search.strip()}%"
        conds.append("(d.trip_number LIKE ? OR COALESCE(d.origin_name,'') LIKE ? OR COALESCE(d.carrier_name,'') LIKE ?)")
        params += [s, s, s]

    where = " AND ".join(conds)

    total_row = connection.execute(
        f"SELECT COUNT(*) AS cnt FROM trip_docs d WHERE {where}", params
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT
            d.id, d.trip_number, d.direction, d.status, d.origin_name, d.carrier_name,
            d.vehicle_type_name, d.eta, d.arrived_at, d.cost_estimate, d.logistics_cost_actual,
            d.created_at,
            COUNT(l.id) AS receipts_count
        FROM trip_docs d
        LEFT JOIN trip_lines l ON l.trip_id = d.id AND l.is_deleted = 0
        WHERE {where}
        GROUP BY d.id
        ORDER BY d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def link_receipts(connection, trip_id: str, receipt_doc_ids: list[str], uid: str) -> int:
    """Привязывает поступления к рейсу. Возвращает число новых привязок.

    Валидация: поступление существует, не удалено и не привязано к другому
    активному рейсу.
    """
    ids = [str(x).strip() for x in receipt_doc_ids if str(x).strip()]
    if not ids:
        return 0

    linked_numbers: list[str] = []
    now = _now()
    for rid in ids:
        rec = connection.execute(
            "SELECT id, doc_number, client_id FROM receipt_docs WHERE id = ? AND is_deleted = 0",
            (rid,),
        ).fetchone()
        if not rec:
            raise HTTPException(status_code=400, detail=f"Поступление не найдено: {rid}")

        existing = connection.execute(
            "SELECT trip_id FROM trip_lines WHERE receipt_doc_id = ? AND is_deleted = 0",
            (rid,),
        ).fetchone()
        if existing:
            if str(existing["trip_id"]) == trip_id:
                continue  # уже привязано к этому рейсу — пропускаем
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {rec['doc_number']} уже привязано к другому рейсу",
            )

        client_id = rec["client_id"]
        client_row = connection.execute(
            "SELECT name FROM clients WHERE id = ?", (client_id,)
        ).fetchone()
        connection.execute(
            "INSERT INTO trip_lines (id, trip_id, receipt_doc_id, client_id, client_name, created_at, created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), trip_id, rid, client_id,
             client_row["name"] if client_row else None, now, uid),
        )
        linked_numbers.append(str(rec["doc_number"]))

    if linked_numbers:
        connection.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_RECEIPT_LINK,
             "Привязаны поступления: " + ", ".join(linked_numbers), now, uid),
        )

    return len(linked_numbers)


def sync_actual_arrival(connection, trip_id: str, arrived_at: str | None) -> None:
    """Копирует фактическую дату прибытия рейса в привязанные поступления.

    Берём дату из `arrived_at` (YYYY-MM-DDTHH:mm → YYYY-MM-DD). Пустое значение → NULL.
    """
    date_part = (str(arrived_at).strip()[:10] or None) if arrived_at else None
    connection.execute(
        "UPDATE receipt_docs SET actual_arrival_date = ? "
        "WHERE id IN (SELECT receipt_doc_id FROM trip_lines WHERE trip_id = ? AND COALESCE(is_deleted, 0) = 0)",
        (date_part, trip_id),
    )


def cascade_receipts_to_intake(connection, trip_id: str, trip_number: str, uid: str) -> int:
    """При завершении разгрузки рейса: привязанные поступления planned → on_intake.

    Возвращает число переведённых поступлений. Идёт в той же транзакции, что и
    смена статуса рейса (вызывающий делает commit).
    """
    lines = connection.execute(
        "SELECT receipt_doc_id FROM trip_lines WHERE trip_id = ? AND is_deleted = 0",
        (trip_id,),
    ).fetchall()
    now = _now()
    moved = 0
    for ln in lines:
        rid = str(ln["receipt_doc_id"])
        rec = connection.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (rid,)
        ).fetchone()
        if not rec or str(rec["status"]) != RECEIPT_STATUS_PLANNED:
            continue
        connection.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_ON_INTAKE, now, rid),
        )
        connection.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), rid, RECEIPT_OP_INTAKE_START,
             f"В плане → Принят (разгрузка рейса {trip_number})", now, uid),
        )
        moved += 1
    return moved
