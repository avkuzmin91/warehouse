from __future__ import annotations

from datetime import date, timedelta

from config import (
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_DEFECT_FIX,
    SHIPMENT_STATUS_SHIPPED,
)


def _day_bounds(day: date) -> tuple[str, str]:
    """Полуоткрытый интервал [day, day+1) для сравнения ISO-таймстампов."""
    return day.isoformat(), (day + timedelta(days=1)).isoformat()


def _ops_qty_on(connection, op_type: str, day: date) -> int:
    """Сумма qty по receipt_ops указанного типа за день (по дате операции)."""
    lo, hi = _day_bounds(day)
    row = connection.execute(
        """
        SELECT COALESCE(SUM(qty), 0) AS total
        FROM receipt_ops
        WHERE op_type = ?
          AND created_at >= ?
          AND created_at < ?
        """,
        (op_type, lo, hi),
    ).fetchone()
    return int(row["total"] if row else 0)


def _receipt_docs_on(connection, day: date) -> int:
    """Количество поступлений с плановой датой прибытия = день."""
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


def _shipped_qty_on(connection, day: date) -> int:
    """Объём отгрузки по документам, перешедшим в shipped в этот день.

    shipped — финальный статус, поэтому updated_at стабильно отражает дату отгрузки.
    """
    lo, hi = _day_bounds(day)
    row = connection.execute(
        """
        SELECT COALESCE(SUM(l.shipped_qty), 0) AS total
        FROM shipment_docs d
        JOIN shipment_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE COALESCE(d.is_deleted, 0) = 0
          AND d.status = ?
          AND d.updated_at >= ?
          AND d.updated_at < ?
        """,
        (SHIPMENT_STATUS_SHIPPED, lo, hi),
    ).fetchone()
    return int(row["total"] if row else 0)


def day_stats(connection, day: date) -> dict:
    return {
        "receipt_docs": _receipt_docs_on(connection, day),
        "accepted": _ops_qty_on(connection, RECEIPT_OP_ARRIVAL_ACCEPT, day),
        "shipped": _shipped_qty_on(connection, day),
        "defects": _ops_qty_on(connection, RECEIPT_OP_DEFECT_FIX, day),
    }
