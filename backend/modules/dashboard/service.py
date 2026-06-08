from __future__ import annotations

from datetime import date

from config import (
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_PLANNED,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_SHIPPED,
)


def _receipt_docs_on(connection, day: date) -> int:
    """Количество поступлений с датой прибытия = день."""
    row = connection.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM receipt_docs
        WHERE COALESCE(is_deleted, 0) = 0
          AND arrival_date = ?
        """,
        (day.isoformat(),),
    ).fetchone()
    return int(row["cnt"] if row else 0)


def _accepted_qty_on(connection, day: date) -> int:
    """Принято товара по поступлениям с датой прибытия = день.

    Берём accepted_qty строк (приёмка при прибытии) по документам этого дня.
    """
    row = connection.execute(
        """
        SELECT COALESCE(SUM(COALESCE(l.accepted_qty, 0)), 0) AS total
        FROM receipt_docs d
        JOIN receipt_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.arrival_date = ?
        """,
        (day.isoformat(),),
    ).fetchone()
    return int(row["total"] if row else 0)


def _defect_qty_on(connection, day: date) -> int:
    """Брака выявлено за день (при упаковке): нетто-конвертации в статус defect."""
    row = connection.execute(
        """
        SELECT COALESCE(SUM(CASE WHEN to_status = 'defect'   THEN qty
                                 WHEN from_status = 'defect' THEN -qty ELSE 0 END), 0) AS total
        FROM zone_relocations
        WHERE created_at LIKE ?
        """,
        (day.isoformat() + "%",),
    ).fetchone()
    return int(row["total"] if row else 0)


def _shipped_qty_on(connection, day: date) -> int:
    """Объём отгрузки по shipped-документам с датой отгрузки = день."""
    row = connection.execute(
        """
        SELECT COALESCE(SUM(l.shipped_qty), 0) AS total
        FROM shipment_docs d
        JOIN shipment_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status = ?
          AND d.ship_date = ?
        """,
        (SHIPMENT_STATUS_SHIPPED, day.isoformat()),
    ).fetchone()
    return int(row["total"] if row else 0)


def day_stats(connection, day: date) -> dict:
    return {
        "receipt_docs": _receipt_docs_on(connection, day),
        "accepted": _accepted_qty_on(connection, day),
        "shipped": _shipped_qty_on(connection, day),
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
        """
        SELECT d.id, d.doc_number, d.status, d.ship_date, d.priority_rank, d.client_name, d.destination,
               COUNT(l.id) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0) AS sku_count,
               COALESCE(SUM(l.qty) FILTER (WHERE COALESCE(l.is_deleted, 0) = 0), 0) AS total_qty,
               COALESCE((
                   SELECT SUM(CASE
                       WHEN zr.from_status=? AND zr.to_status IN (?, ?) THEN zr.qty
                       WHEN zr.to_status=? AND zr.from_status IN (?, ?) THEN -zr.qty
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
          d.ship_date ASC,
          CASE WHEN d.priority_rank IS NULL THEN 1 ELSE 0 END,
          d.priority_rank ASC NULLS LAST,
          d.created_at ASC,
          d.doc_number ASC
        LIMIT ?
        """,
        (
            RECEIPT_STATUS_ON_REVIEW, SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT,
            RECEIPT_STATUS_ON_REVIEW, SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT,
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
