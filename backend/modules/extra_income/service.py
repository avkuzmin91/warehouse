"""Доп. работы (прочие доходы): переборка брака, переклейка ШК и т.п.

Записи ручного дохода по бизнес-дате. В P&L входят источником «Доп. работы»
по entry_date (см. modules/pnl/service.py); в счёт клиенту попадают привязкой
invoice_extra_income (см. modules/invoices). Суммы — копейки INTEGER.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException

from dbconn import ci_like_substring_param
from utils import now_iso


def journal(connection, entry_id: str, op_type: str, comment: str, uid: str | None) -> None:
    connection.execute(
        "INSERT INTO extra_income_ops (id,entry_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), entry_id, op_type, comment, now_iso(), uid),
    )


def resolve_category(connection, category_id: str) -> str:
    """Проверяет, что вид работы существует и не удалён, возвращает его имя."""
    row = connection.execute(
        "SELECT name FROM extra_income_categories WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (str(category_id or "").strip(),),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Выберите вид работы")
    return str(row["name"])


def resolve_client(connection, client_id: str) -> str:
    row = connection.execute(
        "SELECT name FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (str(client_id or "").strip(),),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Выберите клиента")
    return str(row["name"])


def active_invoice_link(connection, entry_id: str) -> dict | None:
    """Активная привязка записи к счёту (счёт не аннулирован) или None."""
    row = connection.execute(
        """
        SELECT l.id AS link_id, i.id AS invoice_id, i.doc_number AS invoice_number
        FROM invoice_extra_income l
        JOIN invoice_docs i ON i.id = l.invoice_id
        WHERE l.entry_id = ? AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(i.is_deleted, 0) = 0
        """,
        (entry_id,),
    ).fetchone()
    return dict(row) if row else None


def _filter_sql(
    *,
    search: str | None,
    client_id: str | None,
    category_id: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[str, list]:
    conds = ["COALESCE(e.is_deleted, 0) = 0"]
    params: list = []
    if client_id and client_id.strip():
        conds.append("e.client_id = ?"); params.append(client_id.strip())
    if category_id and category_id.strip():
        conds.append("e.category_id = ?"); params.append(category_id.strip())
    if date_from:
        conds.append("e.entry_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("e.entry_date <= ?"); params.append(date_to)
    if search and search.strip():
        s = ci_like_substring_param(search)
        conds.append(
            "(fold_ci(COALESCE(e.comment, '')) LIKE ? OR fold_ci(COALESCE(cl.name, '')) LIKE ? "
            "OR fold_ci(COALESCE(c.name, '')) LIKE ?)"
        )
        params += [s, s, s]
    return " AND ".join(conds), params


_FROM = """
    FROM extra_income_entries e
    LEFT JOIN clients cl ON cl.id = e.client_id
    LEFT JOIN extra_income_categories c ON c.id = e.category_id
    LEFT JOIN invoice_extra_income l
        ON l.entry_id = e.id AND COALESCE(l.is_deleted, 0) = 0
    LEFT JOIN invoice_docs i ON i.id = l.invoice_id
"""


def list_entries_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    search: str | None,
    client_id: str | None,
    category_id: str | None,
    date_from: str | None,
    date_to: str | None,
    invoiced: bool | None = None,
) -> tuple[list[dict], int]:
    where, params = _filter_sql(
        search=search, client_id=client_id, category_id=category_id,
        date_from=date_from, date_to=date_to,
    )
    if invoiced is True:
        where += " AND l.id IS NOT NULL"
    elif invoiced is False:
        where += " AND l.id IS NULL"

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n {_FROM} WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT e.id, e.entry_date, e.client_id, cl.name AS client_name,
               e.category_id, c.name AS category_name,
               e.qty, e.amount_kop, e.comment, e.created_at,
               i.id AS invoice_id, i.doc_number AS invoice_number
        {_FROM}
        WHERE {where}
        ORDER BY e.entry_date DESC, e.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "entry_date": str(r["entry_date"]),
            "client_id": str(r["client_id"]),
            "client_name": r["client_name"],
            "category_id": r["category_id"],
            "category_name": r["category_name"],
            "qty": int(r["qty"]) if r["qty"] is not None else None,
            "amount_kop": int(r["amount_kop"]),
            "comment": r["comment"],
            "invoice_id": (str(r["invoice_id"]) if r["invoice_id"] else None),
            "invoice_number": r["invoice_number"],
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def entries_summary(
    connection,
    *,
    search: str | None,
    client_id: str | None,
    category_id: str | None,
    date_from: str | None,
    date_to: str | None,
) -> dict:
    where, params = _filter_sql(
        search=search, client_id=client_id, category_id=category_id,
        date_from=date_from, date_to=date_to,
    )
    row = connection.execute(
        f"""
        SELECT COALESCE(SUM(e.amount_kop), 0) AS total_amount,
               COUNT(*) AS total_count,
               COALESCE(SUM(e.amount_kop) FILTER (WHERE l.id IS NULL), 0) AS uninvoiced_amount,
               COUNT(*) FILTER (WHERE l.id IS NULL) AS uninvoiced_count
        {_FROM}
        WHERE {where}
        """,
        params,
    ).fetchone()
    return {
        "total_amount": int(row["total_amount"]),
        "total_count": int(row["total_count"]),
        "uninvoiced_amount": int(row["uninvoiced_amount"]),
        "uninvoiced_count": int(row["uninvoiced_count"]),
    }


def extra_income_rows(
    connection, *, date_from: str, date_to: str, client_id: str | None,
) -> list[dict]:
    """Строки дохода «Доп. работы» для P&L: (день, клиент, копейки) по entry_date."""
    conds = ["COALESCE(e.is_deleted, 0) = 0", "e.entry_date >= ?", "e.entry_date <= ?"]
    params: list = [date_from, date_to]
    if client_id and client_id.strip():
        conds.append("e.client_id = ?"); params.append(client_id.strip())
    rows = connection.execute(
        f"""
        SELECT e.entry_date AS day, e.client_id, cl.name AS client_name, e.amount_kop
        FROM extra_income_entries e
        LEFT JOIN clients cl ON cl.id = e.client_id
        WHERE {" AND ".join(conds)}
        """,
        params,
    ).fetchall()
    return [
        {
            "day": str(r["day"]), "client_id": r["client_id"],
            "client_name": r["client_name"], "kop": int(r["amount_kop"]),
        }
        for r in rows
        if int(r["amount_kop"])
    ]


def extra_income_day_items(connection, *, day: str, client_id: str | None) -> list[dict]:
    """Items источника «Доп. работы» для детализации дня P&L."""
    conds = ["COALESCE(e.is_deleted, 0) = 0", "e.entry_date = ?"]
    params: list = [day]
    if client_id and client_id.strip():
        conds.append("e.client_id = ?"); params.append(client_id.strip())
    rows = connection.execute(
        f"""
        SELECT e.id, e.qty, e.amount_kop, cl.name AS client_name, c.name AS category_name
        FROM extra_income_entries e
        LEFT JOIN clients cl ON cl.id = e.client_id
        LEFT JOIN extra_income_categories c ON c.id = e.category_id
        WHERE {" AND ".join(conds)}
        ORDER BY e.amount_kop DESC
        """,
        params,
    ).fetchall()
    items: list[dict] = []
    for r in rows:
        amount = int(r["amount_kop"])
        if not amount:
            continue
        label = f"{r['category_name'] or 'Доп. работа'} · {r['client_name'] or 'Без клиента'}"
        qty = int(r["qty"]) if r["qty"] is not None else None
        items.append({
            "type": "extra_income", "label": label, "amount": amount,
            "ref_id": str(r["id"]), "ref_kind": "extra_income",
            "note": (f"{qty} шт." if qty else None),
        })
    return items
