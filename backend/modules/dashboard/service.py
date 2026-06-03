from __future__ import annotations

from datetime import date

from config import RECEIPT_OP_DEFECT_FIX, SHIPMENT_STATUS_SHIPPED


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
