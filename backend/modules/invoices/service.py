from __future__ import annotations

import time
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    INVOICE_ACTIVE_STATUSES,
    INVOICE_OP_SHIPMENT_LINK,
    INVOICE_STATUS_LABELS,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_SHIPPED,
)
from dbconn import like_substring_param


def _now() -> str:
    return datetime.now(UTC).isoformat()


def format_kopecks(kopecks: int) -> str:
    """Копейки → «15 000,00 ₽» (ru-формат для журнальных комментариев)."""
    rub, kop = divmod(int(kopecks), 100)
    grouped = f"{rub:,}".replace(",", " ")
    return f"{grouped},{kop:02d} ₽"


def is_overdue(status: str, due_date) -> bool:
    """Срок просрочен — плановая дата строго в прошлом (< сегодня)."""
    return (
        status in INVOICE_ACTIVE_STATUSES
        and bool(due_date)
        and str(due_date) < date.today().isoformat()
    )


def is_due_reached(status: str, due_date) -> bool:
    """Срок наступил — плановая дата сегодня или в прошлом (<= сегодня).

    Отдельно от `is_overdue` (строгое <): «наступил» включает день-в-день,
    поэтому в карточке/рейле срок подсвечивается уже в плановую дату, а не
    только на следующий день.
    """
    return (
        status in INVOICE_ACTIVE_STATUSES
        and bool(due_date)
        and str(due_date) <= date.today().isoformat()
    )


def recompute_paid(connection, invoice_id: str) -> int:
    row = connection.execute(
        "SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
        (invoice_id,),
    ).fetchone()
    return int(row["paid"] if row else 0)


def next_invoice_number(connection) -> str:
    """Следующий номер счёта `INV-NNNN` (MAX, не COUNT — без дублей при дырках)."""
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM invoice_docs
        WHERE doc_number LIKE 'INV-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"INV-{n:04d}"


def attach_shipments(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    shipment_ids: list[str],
    uid: str,
    now: str,
) -> None:
    """Привязывает отгрузки к счёту с валидацией инвариантов.

    Только завершённые отгрузки (`shipped`), того же клиента, ещё не входящие
    ни в один активный счёт. Уникальный частичный индекс
    `idx_invoice_shipments_shipment_unique` страхует от гонок.
    """
    seen: set[str] = set()
    for raw in shipment_ids:
        sid = str(raw or "").strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)

        ship = connection.execute(
            "SELECT id, doc_number, status, client_id FROM shipment_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if not ship:
            raise HTTPException(status_code=404, detail="Отгрузка не найдена")

        doc_number = str(ship["doc_number"])
        if str(ship["status"]) != SHIPMENT_STATUS_SHIPPED:
            label = SHIPMENT_STATUS_LABELS.get(str(ship["status"]), str(ship["status"]))
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузку {doc_number} нельзя включить в счёт: только завершённые (сейчас «{label}»)",
            )
        if str(ship["client_id"] or "") != str(client_id or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузка {doc_number} принадлежит другому клиенту",
            )

        busy = connection.execute(
            "SELECT 1 FROM invoice_shipments "
            "WHERE shipment_doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if busy:
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузка {doc_number} уже привязана к счёту",
            )

        connection.execute(
            "INSERT INTO invoice_shipments "
            "(id,invoice_id,shipment_doc_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, sid, ship["client_id"], None, now, uid),
        )
        connection.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_SHIPMENT_LINK,
             f"Привязана отгрузка {doc_number}", now, uid),
        )


def list_invoices_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    status: str | None,
    client_id: str | None,
    search: str | None,
    overdue: bool,
) -> tuple[list[dict], int]:
    today = date.today().isoformat()
    conds = ["COALESCE(d.is_deleted, 0) = 0"]
    params: list = []
    if status:
        codes = [s.strip() for s in str(status).split(",") if s.strip()]
        if codes:
            conds.append(f"d.status IN ({','.join('?' for _ in codes)})")
            params += codes
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ?)")
        params += [s, s]
    if overdue:
        conds.append("d.due_date IS NOT NULL AND d.due_date < ?")
        params.append(today)
        conds.append(f"d.status IN ({','.join('?' for _ in INVOICE_ACTIVE_STATUSES)})")
        params += list(INVOICE_ACTIVE_STATUSES)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM invoice_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.*,
               (SELECT COUNT(*) FROM invoice_shipments s
                WHERE s.invoice_id = d.id AND COALESCE(s.is_deleted, 0) = 0) AS shipment_count
        FROM invoice_docs d
        WHERE {where}
        ORDER BY d.due_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "status": str(r["status"]),
            "status_label": INVOICE_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            "total_amount": int(r["total_amount"]),
            "paid_amount": int(r["paid_amount"]),
            "due_date": r["due_date"],
            "overdue": is_overdue(str(r["status"]), r["due_date"]),
            "shipment_count": int(r["shipment_count"]),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def list_uninvoiced_shipments(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[dict], int]:
    """Завершённые отгрузки, не входящие ни в один активный счёт."""
    conds = [
        "COALESCE(d.is_deleted, 0) = 0",
        "d.status = ?",
        "NOT EXISTS (SELECT 1 FROM invoice_shipments s "
        "WHERE s.shipment_doc_id = d.id AND COALESCE(s.is_deleted, 0) = 0)",
    ]
    params: list = [SHIPMENT_STATUS_SHIPPED]
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
        params += [s, s, s]
    if date_from:
        conds.append("d.ship_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM shipment_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.cargo_type, d.client_id, d.client_name,
               d.destination, d.ship_date, d.created_at,
               (SELECT COUNT(DISTINCT sl.product_id) FROM shipment_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(sl.qty), 0) FROM shipment_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS total_qty
        FROM shipment_docs d
        WHERE {where}
        ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "cargo_type": str(r["cargo_type"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "destination": r["destination"],
            "ship_date": r["ship_date"],
            "sku_count": int(r["sku_count"]),
            "total_qty": int(r["total_qty"]),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


# Лёгкий in-process кеш счётчика алёрта: бейдж опрашивается часто, а сам запрос
# хоть и индексируемый, не нужно гонять на каждый рендер главной. TTL короткий —
# точность «к оплате/просрочено» в пределах десятка секунд достаточна.
_ALERTS_TTL_SEC = 20.0
_alerts_cache: dict[str, object] = {"at": 0.0, "value": None}


def invalidate_alerts_cache() -> None:
    _alerts_cache["at"] = 0.0
    _alerts_cache["value"] = None


def alerts_counts(connection) -> dict[str, int]:
    now_mono = time.monotonic()
    cached = _alerts_cache["value"]
    if cached is not None and (now_mono - float(_alerts_cache["at"])) < _ALERTS_TTL_SEC:
        return dict(cached)  # type: ignore[arg-type]

    today = date.today().isoformat()
    active = list(INVOICE_ACTIVE_STATUSES)
    placeholders = ",".join("?" for _ in active)
    row = connection.execute(
        f"""
        SELECT
            COUNT(*) AS active_count,
            COALESCE(SUM(total_amount - paid_amount), 0) AS active_outstanding,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <= ?) AS due_count,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <  ?) AS overdue_count
        FROM invoice_docs
        WHERE COALESCE(is_deleted, 0) = 0 AND status IN ({placeholders})
        """,
        [today, today, *active],
    ).fetchone()
    value = {
        "due_count": int(row["due_count"] or 0),
        "overdue_count": int(row["overdue_count"] or 0),
        "active_count": int(row["active_count"] or 0),
        "active_outstanding": int(row["active_outstanding"] or 0),
    }
    _alerts_cache["at"] = now_mono
    _alerts_cache["value"] = value
    return dict(value)
