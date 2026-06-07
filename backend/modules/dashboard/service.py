from __future__ import annotations

from datetime import date, timedelta

from config import (
    RECEIPT_OP_DEFECT_FIX,
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
    """Браков зафиксировано по поступлениям с датой прибытия = день."""
    row = connection.execute(
        """
        SELECT COALESCE(SUM(o.qty), 0) AS total
        FROM receipt_docs d
        JOIN receipt_ops o ON o.doc_id = d.id AND o.op_type = ?
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.arrival_date = ?
        """,
        (RECEIPT_OP_DEFECT_FIX, day.isoformat()),
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


def _priority_rank(item: dict) -> tuple[int, str, str]:
    ranks = {
        "overdue": 0,
        "today": 1,
        "active": 2,
        "upcoming": 3,
        "no_date": 4,
    }
    return (ranks.get(str(item["priority"]), 9), str(item["date"] or "9999-12-31"), str(item["doc_number"]))


def _exception(item: dict) -> str | None:
    if item["priority"] == "overdue":
        return "Просрочен плановый срок"
    if item["priority"] == "no_date":
        return "Не указана плановая дата"
    if item["type"] == "shipment" and item["priority"] == "today" and int(item["progress_qty"] or 0) == 0:
        return "Сегодня к отгрузке, упаковка не начата"
    return None


def operational_plan(connection, *, limit: int, horizon_days: int, today: date | None = None) -> dict:
    today = today or date.today()
    horizon = today + timedelta(days=horizon_days)

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
          AND (d.arrival_date IS NULL OR d.arrival_date <= ?)
        GROUP BY d.id, cl.name
        """,
        (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE, horizon.isoformat()),
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
        SELECT d.id, d.doc_number, d.status, d.ship_date, d.client_name, d.destination,
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
          AND (d.ship_date IS NULL OR d.ship_date <= ?)
        GROUP BY d.id
        """,
        (
            RECEIPT_STATUS_ON_REVIEW, SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT,
            RECEIPT_STATUS_ON_REVIEW, SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT,
            SHIPMENT_STATUS_PACKING, horizon.isoformat(),
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
            "exception": None,
        }
        for r in shipment_rows
    ]

    receipts.sort(key=_priority_rank)
    shipments.sort(key=_priority_rank)

    exceptions = []
    for item in [*receipts, *shipments]:
        exception = _exception(item)
        if exception:
            exceptions.append({**item, "exception": exception})
    exceptions.sort(key=_priority_rank)

    return {
        "receipts": receipts[:limit],
        "shipments": shipments[:limit],
        "exceptions": exceptions[:limit],
        "totals": {
            "receipts": len(receipts),
            "shipments": len(shipments),
            "overdue": sum(1 for item in [*receipts, *shipments] if item["overdue"]),
        },
    }
