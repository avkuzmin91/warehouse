from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    RECEIPT_OP_INTAKE_START,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PLANNED,
    SHIPMENT_OP_PRIORITY_UPDATE,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_SHIPPED,
    TRIP_OP_RECEIPT_LINK,
    TRIP_OP_SHIPMENT_LINK,
)
from dbconn import like_substring_param


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
    direction: str | None,
    status: str | None,
    statuses: list[str] | None,
    carrier_id: str | None,
    search: str | None,
    eta_from: str | None,
    eta_to: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    conds = ["d.is_deleted = 0"]
    params: list = []

    if direction:
        conds.append("d.direction = ?")
        params.append(direction)
    if status and status in statuses_all:
        conds.append("d.status = ?")
        params.append(status)
    elif statuses:
        valid = [s for s in statuses if s in statuses_all]
        if valid:
            placeholders = ",".join("?" for _ in valid)
            conds.append(f"d.status IN ({placeholders})")
            params += valid
    if carrier_id:
        conds.append("d.carrier_id = ?")
        params.append(carrier_id.strip())
    if eta_from:
        conds.append("SUBSTR(d.eta, 1, 10) >= ?")
        params.append(eta_from)
    if eta_to:
        conds.append("SUBSTR(d.eta, 1, 10) <= ?")
        params.append(eta_to)
    if search:
        s = like_substring_param(search)
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
        ORDER BY NULLIF(d.eta, '') IS NULL, NULLIF(d.eta, '') DESC, d.created_at DESC
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


def link_shipments(connection, trip_id: str, shipment_doc_ids: list[str], uid: str) -> int:
    """Привязывает отгрузки к outbound-рейсу. Возвращает число новых привязок.

    Зеркало link_receipts: отгрузка существует, не удалена и не привязана к
    другому активному рейсу.
    """
    ids = [str(x).strip() for x in shipment_doc_ids if str(x).strip()]
    if not ids:
        return 0

    linked_numbers: list[str] = []
    now = _now()
    for sid in ids:
        ship = connection.execute(
            "SELECT id, doc_number, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0",
            (sid,),
        ).fetchone()
        if not ship:
            raise HTTPException(status_code=400, detail=f"Отгрузка не найдена: {sid}")

        existing = connection.execute(
            "SELECT trip_id FROM trip_lines WHERE shipment_doc_id = ? AND is_deleted = 0",
            (sid,),
        ).fetchone()
        if existing:
            if str(existing["trip_id"]) == trip_id:
                continue
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузка {ship['doc_number']} уже привязана к другому рейсу",
            )

        client_id = ship["client_id"]
        client_row = connection.execute(
            "SELECT name FROM clients WHERE id = ?", (client_id,)
        ).fetchone()
        connection.execute(
            "INSERT INTO trip_lines (id, trip_id, shipment_doc_id, client_id, client_name, created_at, created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), trip_id, sid, client_id,
             client_row["name"] if client_row else None, now, uid),
        )
        linked_numbers.append(str(ship["doc_number"]))

    if linked_numbers:
        connection.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_SHIPMENT_LINK,
             "Привязаны отгрузки: " + ", ".join(linked_numbers), now, uid),
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


def sync_actual_ship_date(connection, trip_id: str, arrived_at: str | None) -> None:
    """Копирует фактическую дату прибытия машины в привязанные отгрузки."""
    date_part = (str(arrived_at).strip()[:10] or None) if arrived_at else None
    connection.execute(
        "UPDATE shipment_docs SET actual_ship_date = ? "
        "WHERE id IN (SELECT shipment_doc_id FROM trip_lines WHERE trip_id = ? AND COALESCE(is_deleted, 0) = 0 AND shipment_doc_id IS NOT NULL)",
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


def assert_shipments_ready_for_load(connection, trip_id: str) -> None:
    """Гейт перед завершением погрузки outbound-рейса.

    Кладовщик завершает погрузку только когда все привязанные отгрузки готовы к
    рейсу (статус «Ожидает рейс»). Аннулированные пропускаем — они не поедут.
    """
    rows = connection.execute(
        "SELECT s.doc_number, s.status FROM trip_lines l "
        "JOIN shipment_docs s ON s.id = l.shipment_doc_id AND COALESCE(s.is_deleted, 0) = 0 "
        "WHERE l.trip_id = ? AND l.is_deleted = 0 AND l.shipment_doc_id IS NOT NULL "
        "ORDER BY s.doc_number",
        (trip_id,),
    ).fetchall()
    blocking = [
        str(r["doc_number"])
        for r in rows
        if str(r["status"]) not in (SHIPMENT_STATUS_AWAITING_TRIP, SHIPMENT_STATUS_CANCELLED)
    ]
    if blocking:
        raise HTTPException(
            status_code=400,
            detail="Нельзя завершить погрузку: отгрузки ещё не готовы к рейсу — " + ", ".join(blocking),
        )


def cascade_shipments_to_shipped(connection, trip_id: str, trip_number: str, uid: str) -> int:
    """При завершении погрузки outbound-рейса: привязанные отгрузки awaiting_trip → shipped.

    Зеркало cascade_receipts_to_intake, но переводит сразу в финальный shipped.
    Списание — журнальными движениями (… → shipped): годный груз уходит из мест
    раскладки («Готов к отгрузке»), брак-отгрузка — напрямую со хранения.
    Идёт в одной транзакции со сменой статуса рейса.
    """
    from modules.shipments.service import _check_duplicate_lines, consume_stock_for_shipment

    lines = connection.execute(
        "SELECT shipment_doc_id FROM trip_lines "
        "WHERE trip_id = ? AND is_deleted = 0 AND shipment_doc_id IS NOT NULL",
        (trip_id,),
    ).fetchall()
    now = _now()
    moved = 0
    for ln in lines:
        sid = str(ln["shipment_doc_id"])
        ship = connection.execute(
            "SELECT status, priority_rank FROM shipment_docs WHERE id = ? AND is_deleted = 0", (sid,)
        ).fetchone()
        if not ship or str(ship["status"]) != SHIPMENT_STATUS_AWAITING_TRIP:
            continue
        _check_duplicate_lines(connection, sid)
        consume_stock_for_shipment(connection, sid, uid)
        connection.execute(
            "UPDATE shipment_docs SET status = ?, priority_rank = NULL, updated_at = ? WHERE id = ?",
            (SHIPMENT_STATUS_SHIPPED, now, sid),
        )
        if ship.get("priority_rank") is not None:
            connection.execute(
                "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), sid, SHIPMENT_OP_PRIORITY_UPDATE,
                 "Приоритет снят: отгрузка завершена", now, uid),
            )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), sid, "advance",
             f"Ожидает рейс → Завершён (погрузка рейса {trip_number})", now, uid),
        )
        moved += 1
    return moved
