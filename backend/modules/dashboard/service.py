from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

from config import (
    DISPATCH_STATUS_CANCELLED,
    INV_OP_PACKED,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PLANNED,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_PACKING,
)


def _arrivals_on(connection, day: date) -> dict:
    """Поступления за день (по дате прибытия): план = Σ planned_qty, факт = Σ accepted_qty.

    Аннулированные документы не цель дня — исключаем. Совпадает с колонками
    ПЛАН/ФАКТ группы «Сегодня» в списке поступлений.
    """
    row = connection.execute(
        """
        SELECT COALESCE(SUM(COALESCE(l.planned_qty, 0)), 0)  AS plan,
               COALESCE(SUM(COALESCE(l.accepted_qty, 0)), 0) AS fact
        FROM receipt_docs d
        JOIN receipt_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status <> ?
          AND d.arrival_date = ?
        """,
        (RECEIPT_STATUS_CANCELLED, day.isoformat()),
    ).fetchone()
    return {"plan": int(row["plan"] if row else 0), "fact": int(row["fact"] if row else 0)}


def _packed_on(connection, day: date) -> dict:
    """Упаковка за день (по дате задачи упаковки `shipment_docs.ship_date`):
    план = Σ qty строк, факт = упакованный годный из журнала (как «Факт» в списке упаковок).

    Факт — нетто годного, вошедшего в `packed`/`ready` по строкам документа
    (формула совпадает с `total_packed_qty` списка отгрузок-упаковок).
    """
    row = connection.execute(
        f"""
        SELECT
          (SELECT COALESCE(SUM(COALESCE(l.qty, 0)), 0)
             FROM shipment_docs d
             JOIN shipment_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
             WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status <> ? AND d.ship_date = ?) AS plan,
          (SELECT COALESCE(SUM(CASE
                     WHEN zr.to_op IN ('{INV_OP_PACKED}','{INV_OP_READY}')   AND zr.to_quality='{INV_Q_GOOD}'   AND COALESCE(zr.from_op,'') NOT IN ('{INV_OP_PACKED}','{INV_OP_READY}') THEN zr.qty
                     WHEN zr.from_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND zr.from_quality='{INV_Q_GOOD}' AND zr.to_op='{INV_OP_PACKING}' THEN -zr.qty
                     ELSE 0 END), 0)
             FROM zone_relocations zr
             JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
             JOIN shipment_docs d ON d.id = sl.doc_id
             WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status <> ? AND d.ship_date = ?) AS fact
        """,
        (SHIPMENT_STATUS_CANCELLED, day.isoformat(), SHIPMENT_STATUS_CANCELLED, day.isoformat()),
    ).fetchone()
    return {"plan": int(row["plan"] if row else 0), "fact": int(row["fact"] if row else 0)}


def _local_day_utc_range(day: date) -> tuple[str, str]:
    """Границы локальных суток `day` в виде UTC-ISO строк [start, end).

    `created_at` хранится в UTC, а `day` — локальная (бизнес-) дата склада, поэтому
    бакет «сутки по таймзоне сервера» переводим в UTC-диапазон, иначе на границе
    суток счётчик уезжает на размер смещения таймзоны.
    """
    start = datetime.combine(day, time.min).astimezone(UTC).isoformat()
    end = datetime.combine(day + timedelta(days=1), time.min).astimezone(UTC).isoformat()
    return start, end


def _defect_qty_on(connection, day: date) -> int:
    """Брака выявлено за день: нетто-конвертации качества в defect (перемещения не считаются)."""
    start, end = _local_day_utc_range(day)
    row = connection.execute(
        """
        SELECT COALESCE(SUM(CASE
                   WHEN to_quality = 'defect'   AND COALESCE(from_quality,'') <> 'defect' THEN qty
                   WHEN from_quality = 'defect' AND COALESCE(to_quality,'')   <> 'defect' THEN -qty
                   ELSE 0 END), 0) AS total
        FROM zone_relocations
        WHERE created_at >= ? AND created_at < ?
        """,
        (start, end),
    ).fetchone()
    return int(row["total"] if row else 0)


def _shipped_on(connection, day: date) -> dict:
    """Отгрузки за день (по дате отгрузки `dispatch_docs.ship_date`):
    план = Σ qty строк, факт = Σ shipped_qty. Аннулированные исключаем.

    Реальная отгрузка живёт в домене `dispatch` (DSP-документы), а не в
    `shipment_docs` (там теперь только «Задачи упаковки»). Совпадает с
    колонками ПЛАН/ОТГРУЖЕНО группы «Сегодня» в списке отгрузок.
    """
    row = connection.execute(
        """
        SELECT COALESCE(SUM(COALESCE(l.qty, 0)), 0)         AS plan,
               COALESCE(SUM(COALESCE(l.shipped_qty, 0)), 0) AS fact
        FROM dispatch_docs d
        JOIN dispatch_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status <> ?
          AND d.ship_date = ?
        """,
        (DISPATCH_STATUS_CANCELLED, day.isoformat()),
    ).fetchone()
    return {"plan": int(row["plan"] if row else 0), "fact": int(row["fact"] if row else 0)}


def day_stats(connection, day: date) -> dict:
    return {
        "arrivals": _arrivals_on(connection, day),
        "packed": _packed_on(connection, day),
        "shipped": _shipped_on(connection, day),
        "defects": _defect_qty_on(connection, day),
    }


def _priority(doc_date, today: date, *, active: bool = False) -> str:
    if not doc_date:
        return "no_date"
    value = str(doc_date)
    if value < today.isoformat():
        return "overdue"
    if value == today.isoformat():
        return "today"
    if active:
        return "active"
    return "upcoming"


def _count_operational_receipts(connection, *, today: date, overdue_only: bool = False) -> int:
    row = connection.execute(
        f"""
        SELECT COUNT(*) AS cnt
        FROM receipt_docs d
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status IN (?, ?)
          AND d.arrival_date IS NOT NULL
          AND d.arrival_date {'<' if overdue_only else '<='} ?
        """,
        (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE, today.isoformat()),
    ).fetchone()
    return int(row["cnt"] if row else 0)


def _count_operational_shipments(connection, *, today: date, overdue_only: bool = False) -> int:
    row = connection.execute(
        f"""
        SELECT COUNT(*) AS cnt
        FROM shipment_docs d
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status = ?
          AND d.ship_date IS NOT NULL
          AND d.ship_date {'<' if overdue_only else '<='} ?
        """,
        (SHIPMENT_STATUS_PACKING, today.isoformat()),
    ).fetchone()
    return int(row["cnt"] if row else 0)


def operational_plan(connection, *, receipts_limit: int, shipments_limit: int, today: date | None = None) -> dict:
    today = today or date.today()
    receipt_total = _count_operational_receipts(connection, today=today)
    shipment_total = _count_operational_shipments(connection, today=today)
    overdue_total = (
        _count_operational_receipts(connection, today=today, overdue_only=True)
        + _count_operational_shipments(connection, today=today, overdue_only=True)
    )

    receipt_rows = connection.execute(
        """
        SELECT d.id, d.doc_number, d.status, d.arrival_date, cl.name AS client_name,
               COUNT(l.id) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0) AS sku_count,
               COALESCE(SUM(l.planned_qty) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0), 0) AS total_qty,
               COALESCE(SUM(COALESCE(l.accepted_qty, 0)) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0), 0) AS progress_qty
        FROM receipt_docs d
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN receipt_lines l ON l.doc_id = d.id
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status IN (?, ?)
          AND d.arrival_date IS NOT NULL
          AND d.arrival_date <= ?
        GROUP BY d.id, cl.name
        ORDER BY d.arrival_date ASC, d.created_at ASC, d.doc_number ASC
        LIMIT ?
        """,
        (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE, today.isoformat(), receipts_limit),
    ).fetchall()
    receipts = [
        {
            "type": "receipt",
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "date": r["arrival_date"],
            "date_kind": "arrival",
            "client_name": r["client_name"],
            "destination": None,
            "sku_count": int(r["sku_count"] or 0),
            "total_qty": int(r["total_qty"] or 0),
            "progress_qty": int(r["progress_qty"] or 0),
            "overdue": bool(r["arrival_date"] and str(r["arrival_date"]) < today.isoformat()),
            "priority": _priority(r["arrival_date"], today, active=str(r["status"]) == RECEIPT_STATUS_ON_INTAKE),
            "exception": None,
        }
        for r in receipt_rows
    ]

    shipment_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status, d.ship_date, d.priority_rank, d.client_name, d.destination,
               COUNT(l.id) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0) AS sku_count,
               COALESCE(SUM(l.qty) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0), 0) AS total_qty,
               COALESCE((
                   SELECT SUM(CASE
                       WHEN zr.to_op='{INV_OP_PACKED}' AND zr.to_quality='{INV_Q_GOOD}' AND COALESCE(zr.from_op,'') NOT IN ('{INV_OP_PACKED}','{INV_OP_READY}') THEN zr.qty
                       WHEN zr.from_op='{INV_OP_PACKED}' AND zr.from_quality='{INV_Q_GOOD}' AND zr.to_op='{INV_OP_PACKING}'   THEN -zr.qty
                       ELSE 0 END)
                   + SUM(CASE
                       WHEN zr.to_quality='{INV_Q_DEFECT}'   AND COALESCE(zr.from_quality,'')<>'{INV_Q_DEFECT}' THEN zr.qty
                       WHEN zr.from_quality='{INV_Q_DEFECT}' AND COALESCE(zr.to_quality,'')<>'{INV_Q_DEFECT}'   THEN -zr.qty
                       ELSE 0 END)
                   FROM zone_relocations zr
                   JOIN shipment_lines sl2 ON sl2.id = zr.shipment_line_id
                   WHERE sl2.doc_id = d.id
               ), 0) AS progress_qty
        FROM shipment_docs d
        LEFT JOIN shipment_lines l ON l.doc_id = d.id
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status = ?
          AND d.ship_date IS NOT NULL
          AND d.ship_date <= ?
        GROUP BY d.id
        ORDER BY
          CASE WHEN d.priority_rank IS NULL THEN 1 ELSE 0 END,
          d.priority_rank ASC NULLS LAST,
          d.ship_date ASC,
          d.created_at ASC,
          d.doc_number ASC
        LIMIT ?
        """,
        (
            SHIPMENT_STATUS_PACKING, today.isoformat(), shipments_limit,
        ),
    ).fetchall()
    shipments = [
        {
            "type": "shipment",
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "date": r["ship_date"],
            "date_kind": "ship",
            "client_name": r["client_name"],
            "destination": r["destination"],
            "sku_count": int(r["sku_count"] or 0),
            "total_qty": int(r["total_qty"] or 0),
            "progress_qty": int(r["progress_qty"] or 0),
            "overdue": bool(r["ship_date"] and str(r["ship_date"]) < today.isoformat()),
            "priority": _priority(r["ship_date"], today, active=False),
            "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            "exception": None,
        }
        for r in shipment_rows
    ]

    return {
        "receipts": receipts,
        "shipments": shipments,
        "exceptions": [],
        "totals": {
            "receipts": receipt_total,
            "shipments": shipment_total,
            "overdue": overdue_total,
        },
    }
