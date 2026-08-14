from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import uuid4

from fastapi import HTTPException

from config import (
    DISPATCH_STATUS_LABELS,
    DISPATCH_STATUS_SHIPPED,
    INVOICE_ACTIVE_STATUSES,
    INVOICE_OP_AMOUNT_CHANGE,
    INVOICE_STATUS_CANCELLED,
    INVOICE_STATUS_CLOSED,
    INVOICE_STATUS_DRAFT,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_PARTIALLY_PAID,
    INVOICE_OP_EXTRA_LINK,
    INVOICE_OP_RECEIPT_LINK,
    INVOICE_OP_SHIPMENT_LINK,
    INVOICE_OP_STORAGE_LINK,
    INVOICE_OP_STORAGE_UNLINK,
    INVOICE_STATUS_LABELS,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_LABELS,
    RECEIVABLE_AGING_BUCKETS,
    aging_bucket_key,
)
from dbconn import ci_like_substring_param
from modules.timesheet.service import business_today
from utils import now_iso as _now



def format_kopecks(kopecks: int) -> str:
    """Копейки → «15 000,00 ₽» (ru-формат для журнальных комментариев)."""
    rub, kop = divmod(int(kopecks), 100)
    grouped = f"{rub:,}".replace(",", " ")
    return f"{grouped},{kop:02d} ₽"


def rub_to_kop(value) -> int:
    """Рубли → копейки без потерь на float (половина округляется вверх).

    `round(float(rub) * 100)` теряет копейку на значениях вроде 1.115 (их float-
    репрезентация чуть меньше) и использует банковское округление (round(2.5)→2).
    Через Decimal результат точный и предсказуемый.
    """
    if value is None:
        return 0
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def is_overdue(status: str, due_date) -> bool:
    """Срок просрочен — плановая дата строго в прошлом (< сегодня)."""
    return (
        status in INVOICE_ACTIVE_STATUSES
        and bool(due_date)
        and str(due_date) < business_today().isoformat()
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
        and str(due_date) <= business_today().isoformat()
    )


def recompute_paid(connection, invoice_id: str) -> int:
    row = connection.execute(
        "SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
        (invoice_id,),
    ).fetchone()
    return int(row["paid"] if row else 0)


def reverse_payments(connection, *, invoice_id: str, on_date: str, uid: str, now: str) -> int:
    """Сторнировать все действующие платежи счёта отдельными записями на `on_date`.

    Исходный платёж остаётся в журнале со своей датой — иначе касса за уже закрытый
    период менялась бы задним числом. Сторно — парная строка с отрицательной суммой и
    `reverses_id` на исходный платёж, поэтому `recompute_paid` даёт ноль без правки фактов.
    Возвращает сторнированную сумму. Не коммитит.
    """
    rows = connection.execute(
        "SELECT id, amount FROM invoice_payments "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0 AND reverses_id IS NULL "
        "AND id NOT IN (SELECT reverses_id FROM invoice_payments "
        "               WHERE invoice_id = ? AND reverses_id IS NOT NULL)",
        (invoice_id, invoice_id),
    ).fetchall()
    total = 0
    for r in rows:
        amount = int(r["amount"])
        if not amount:
            continue
        connection.execute(
            "INSERT INTO invoice_payments "
            "(id,invoice_id,amount,paid_on,comment,created_at,created_by,reverses_id) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, -amount, on_date,
             "Сторно при аннулировании счёта", now, uid, str(r["id"])),
        )
        total += amount
    return total


def next_invoice_number(connection) -> str:
    """Следующий номер счёта `INV-NNNN` (MAX, не COUNT — без дублей при дырках)."""
    # Advisory-lock сериализует генерацию номера внутри транзакции — иначе два
    # параллельных создания получат один MAX+1.
    connection.execute("SELECT pg_advisory_xact_lock(hashtext('invoice_doc_number'))")
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM invoice_docs
        WHERE doc_number LIKE 'INV-%' AND SUBSTR(doc_number, 5) ~ '^[0-9]+$'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"INV-{n:04d}"


# Количество строки отгрузки к тарификации: план, а у закрытых с недовозом
# (`closed_short_at`) — фактически уехавшее, иначе клиент заплатит за неувезённое.
# Факт берём только по явной отметке недовоза: у остальных отгружен весь план, а у
# документов, миграированных из shipments (0065), shipped_qty недостоверен. `d` —
# алиас dispatch_docs, `sl` — dispatch_lines.
_BILLABLE_QTY_SQL = (
    "CASE WHEN d.closed_short_at IS NOT NULL THEN COALESCE(sl.shipped_qty, 0) ELSE sl.qty END"
)


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
            "SELECT id, doc_number, status, client_id FROM dispatch_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if not ship:
            raise HTTPException(status_code=404, detail="Отгрузка не найдена")

        doc_number = str(ship["doc_number"])
        if str(ship["status"]) != DISPATCH_STATUS_SHIPPED:
            label = DISPATCH_STATUS_LABELS.get(str(ship["status"]), str(ship["status"]))
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


def attach_receipts(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    receipt_ids: list[str],
    uid: str,
    now: str,
) -> None:
    """Привязывает поступления к счёту с валидацией инвариантов.

    Зеркало `attach_shipments`: только завершённые поступления (`done`), того же
    клиента, ещё не входящие ни в один активный счёт. Уникальный частичный индекс
    `idx_invoice_receipts_receipt_unique` страхует от гонок.
    """
    seen: set[str] = set()
    for raw in receipt_ids:
        rid = str(raw or "").strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)

        rec = connection.execute(
            "SELECT id, doc_number, status, client_id FROM receipt_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (rid,),
        ).fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Поступление не найдено")

        doc_number = str(rec["doc_number"])
        if str(rec["status"]) != RECEIPT_STATUS_DONE:
            label = RECEIPT_STATUS_LABELS.get(str(rec["status"]), str(rec["status"]))
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} нельзя включить в счёт: только завершённые (сейчас «{label}»)",
            )
        if str(rec["client_id"] or "") != str(client_id or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} принадлежит другому клиенту",
            )

        busy = connection.execute(
            "SELECT 1 FROM invoice_receipts "
            "WHERE receipt_doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (rid,),
        ).fetchone()
        if busy:
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} уже привязано к счёту",
            )

        connection.execute(
            "INSERT INTO invoice_receipts "
            "(id,invoice_id,receipt_doc_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, rid, rec["client_id"], None, now, uid),
        )
        connection.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_RECEIPT_LINK,
             f"Привязано поступление {doc_number}", now, uid),
        )


def attach_extra_income(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    entry_ids: list[str],
    uid: str,
    now: str,
) -> None:
    """Привязывает записи доп. работ к счёту с валидацией инвариантов.

    Зеркало `attach_shipments`: только записи того же клиента, ещё не входящие
    ни в один активный счёт. Уникальный частичный индекс
    `idx_invoice_extra_income_entry_unique` страхует от гонок.
    """
    seen: set[str] = set()
    for raw in entry_ids:
        eid = str(raw or "").strip()
        if not eid or eid in seen:
            continue
        seen.add(eid)

        entry = connection.execute(
            """
            SELECT e.id, e.entry_date, e.client_id, e.qty, e.amount_kop,
                   c.name AS category_name
            FROM extra_income_entries e
            LEFT JOIN extra_income_categories c ON c.id = e.category_id
            WHERE e.id = ? AND COALESCE(e.is_deleted, 0) = 0
            """,
            (eid,),
        ).fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Запись доп. работы не найдена")

        label = str(entry["category_name"] or "Доп. работа")
        if str(entry["client_id"] or "") != str(client_id or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Доп. работа «{label}» принадлежит другому клиенту",
            )

        busy = connection.execute(
            "SELECT 1 FROM invoice_extra_income "
            "WHERE entry_id = ? AND COALESCE(is_deleted, 0) = 0",
            (eid,),
        ).fetchone()
        if busy:
            raise HTTPException(
                status_code=400,
                detail=f"Доп. работа «{label}» уже привязана к счёту",
            )

        connection.execute(
            "INSERT INTO invoice_extra_income "
            "(id,invoice_id,entry_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, eid, entry["client_id"], None, now, uid),
        )
        bits = [label, str(entry["entry_date"])]
        if entry["qty"]:
            bits.append(f"{int(entry['qty'])} шт.")
        bits.append(format_kopecks(int(entry["amount_kop"])))
        connection.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_EXTRA_LINK,
             "Привязана доп. работа: " + " · ".join(bits), now, uid),
        )


def invoice_storage_block(connection, invoice_id: str) -> dict | None:
    """Сводка привязанных к счёту начислений хранения (период, дни, сумма) или None."""
    row = connection.execute(
        """
        SELECT COUNT(*) AS days,
               MIN(c.charge_date) AS period_from,
               MAX(c.charge_date) AS period_to,
               COALESCE(SUM(c.amount_kop), 0) AS amount_kop
        FROM invoice_storage_charges l
        JOIN storage_charges c ON c.id = l.charge_id
        WHERE l.invoice_id = ? AND COALESCE(l.is_deleted, 0) = 0
        """,
        (invoice_id,),
    ).fetchone()
    if not row or not int(row["days"] or 0):
        return None
    return {
        "period_from": str(row["period_from"]),
        "period_to": str(row["period_to"]),
        "days": int(row["days"]),
        "amount_kop": int(row["amount_kop"]),
    }


def attach_storage_charges(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    date_from: str,
    date_to: str,
    uid: str,
    now: str,
) -> dict:
    """Привязывает к счёту непривязанные начисления хранения клиента за период.

    Берутся только дни с ненулевой суммой; день входит не более чем в один
    активный счёт (частичный уникальный индекс
    `idx_invoice_storage_charges_charge_unique` страхует от гонок)."""
    cid = str(client_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="У счёта не указан клиент")
    rows = connection.execute(
        """
        SELECT c.id, c.charge_date, c.amount_kop
        FROM storage_charges c
        WHERE c.client_id = ? AND c.charge_date >= ? AND c.charge_date <= ?
          AND c.amount_kop > 0
          AND NOT EXISTS (
              SELECT 1 FROM invoice_storage_charges l
              WHERE l.charge_id = c.id AND COALESCE(l.is_deleted, 0) = 0
          )
        ORDER BY c.charge_date
        """,
        (cid, date_from, date_to),
    ).fetchall()
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="За период нет начислений хранения, не привязанных к счёту",
        )
    for r in rows:
        connection.execute(
            "INSERT INTO invoice_storage_charges "
            "(id,invoice_id,charge_id,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), invoice_id, str(r["id"]), now, uid),
        )
    total = sum(int(r["amount_kop"]) for r in rows)
    connection.execute(
        "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), invoice_id, INVOICE_OP_STORAGE_LINK,
         f"Привязано хранение {rows[0]['charge_date']} — {rows[-1]['charge_date']}: "
         f"{len(rows)} дн. · {format_kopecks(total)}",
         now, uid),
    )
    return {"days": len(rows), "amount_kop": total}


def detach_storage_charges(connection, *, invoice_id: str, uid: str, now: str) -> int:
    """Отвязывает от счёта все начисления хранения (дни снова свободны для счёта)."""
    block = invoice_storage_block(connection, invoice_id)
    if not block:
        raise HTTPException(status_code=404, detail="Хранение не привязано к счёту")
    connection.execute(
        "UPDATE invoice_storage_charges SET is_deleted = 1 "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
        (invoice_id,),
    )
    connection.execute(
        "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), invoice_id, INVOICE_OP_STORAGE_UNLINK,
         f"Отвязано хранение {block['period_from']} — {block['period_to']} · "
         f"{format_kopecks(block['amount_kop'])}",
         now, uid),
    )
    return int(block["amount_kop"])


def list_uninvoiced_extra_income(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[dict], int]:
    """Записи доп. работ, не входящие ни в один активный счёт."""
    conds = [
        "COALESCE(e.is_deleted, 0) = 0",
        "NOT EXISTS (SELECT 1 FROM invoice_extra_income l "
        "WHERE l.entry_id = e.id AND COALESCE(l.is_deleted, 0) = 0)",
    ]
    params: list = []
    if client_id:
        conds.append("e.client_id = ?"); params.append(client_id.strip())
    if date_from:
        conds.append("e.entry_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("e.entry_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM extra_income_entries e WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT e.id, e.entry_date, e.client_id, cl.name AS client_name,
               e.qty, e.amount_kop, e.comment, e.created_at,
               c.name AS category_name
        FROM extra_income_entries e
        LEFT JOIN clients cl ON cl.id = e.client_id
        LEFT JOIN extra_income_categories c ON c.id = e.category_id
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
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "category_name": r["category_name"],
            "qty": int(r["qty"]) if r["qty"] is not None else None,
            "amount_kop": int(r["amount_kop"]),
            "comment": r["comment"],
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def logistics_amount_for_docs(
    connection, *, dispatch_ids: list[str] | None = None, receipt_ids: list[str] | None = None
) -> dict:
    """Логистика для клиента по наборам отгрузок и поступлений, копейки.

    Берётся из `*.logistics_cost` (рубли) самих документов — это цена логистики
    для клиента, не себестоимость рейса. Рубли → копейки через `round(rub*100)`."""
    def _sum(table: str, ids: list[str] | None) -> int:
        clean = [str(x or "").strip() for x in (ids or []) if str(x or "").strip()]
        clean = list(dict.fromkeys(clean))
        if not clean:
            return 0
        placeholders = ",".join("?" for _ in clean)
        rows = connection.execute(
            f"SELECT logistics_cost FROM {table} "
            f"WHERE id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0",
            clean,
        ).fetchall()
        return sum(rub_to_kop(r["logistics_cost"]) for r in rows)

    return {
        "dispatch_logistics_kop": _sum("dispatch_docs", dispatch_ids),
        "receipt_logistics_kop": _sum("receipt_docs", receipt_ids),
    }


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
    today = business_today().isoformat()
    conds = ["COALESCE(d.is_deleted, 0) = 0"]
    params: list = []
    status_filter_applied = False
    if status:
        codes = [s.strip() for s in str(status).split(",") if s.strip()]
        if codes:
            conds.append(f"d.status IN ({','.join('?' for _ in codes)})")
            params += codes
            status_filter_applied = True
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ?)")
        params += [s, s]
    if overdue:
        conds.append("d.due_date IS NOT NULL AND d.due_date < ?")
        params.append(today)
        conds.append(f"d.status IN ({','.join('?' for _ in INVOICE_ACTIVE_STATUSES)})")
        params += list(INVOICE_ACTIVE_STATUSES)
        status_filter_applied = True
    # Аннулированные скрываются из списка по умолчанию; показать — явным выбором статуса.
    if not status_filter_applied:
        conds.append("d.status != ?")
        params.append(INVOICE_STATUS_CANCELLED)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM invoice_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.*,
               (SELECT COUNT(*) FROM invoice_shipments s
                WHERE s.invoice_id = d.id AND COALESCE(s.is_deleted, 0) = 0) AS shipment_count,
               (SELECT COUNT(*) FROM invoice_receipts r
                WHERE r.invoice_id = d.id AND COALESCE(r.is_deleted, 0) = 0) AS receipt_count,
               (SELECT COUNT(*) FROM invoice_extra_income x
                WHERE x.invoice_id = d.id AND COALESCE(x.is_deleted, 0) = 0) AS extra_count
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
            "receipt_count": int(r["receipt_count"]),
            "extra_count": int(r["extra_count"]),
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
    params: list = [DISPATCH_STATUS_SHIPPED]
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ? OR fold_ci(d.destination) LIKE ?)")
        params += [s, s, s]
    if date_from:
        conds.append("d.ship_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM dispatch_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.cargo_type, d.client_id, d.client_name,
               d.destination, d.ship_date, d.created_at,
               (SELECT COUNT(DISTINCT sl.product_id) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM({_BILLABLE_QTY_SQL}), 0) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS total_qty
        FROM dispatch_docs d
        WHERE {where}
        ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    # Топ-товары каждой отгрузки для свёрнутой строки (одним запросом по странице,
    # не N+1). Полный состав по требованию грузит карточка отгрузки / roll-up.
    preview_map = _products_preview_map(connection, [str(r["id"]) for r in rows], top_n=3)

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
            "products_preview": preview_map.get(str(r["id"]), []),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def _products_preview_map(connection, doc_ids: list[str], *, top_n: int) -> dict[str, list[dict]]:
    """Для набора отгрузок — топ-N товаров по количеству (для свёрнутой строки)."""
    ids = [d for d in doc_ids if d]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT sl.doc_id, sl.product_id, MAX(sl.product_name) AS name,
               SUM({_BILLABLE_QTY_SQL}) AS qty
        FROM dispatch_lines sl
        JOIN dispatch_docs d ON d.id = sl.doc_id
        WHERE sl.doc_id IN ({placeholders}) AND COALESCE(sl.is_deleted, 0) = 0
        GROUP BY sl.doc_id, sl.product_id
        ORDER BY sl.doc_id, SUM({_BILLABLE_QTY_SQL}) DESC, MAX(sl.product_name)
        """,
        ids,
    ).fetchall()
    result: dict[str, list[dict]] = {}
    for r in rows:
        bucket = result.setdefault(str(r["doc_id"]), [])
        if len(bucket) < top_n:
            bucket.append({"name": str(r["name"]), "qty": int(r["qty"])})
    return result


def aggregate_shipment_contents(connection, shipment_ids: list[str]) -> dict:
    """Сводный состав по набору отгрузок: товары с суммарным количеством (roll-up)."""
    ids: list[str] = []
    for raw in shipment_ids:
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    if not ids:
        return {"products": [], "total_qty": 0, "sku_count": 0}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT sl.product_id, MAX(sl.product_name) AS name, MAX(sl.product_sku) AS sku,
               SUM({_BILLABLE_QTY_SQL}) AS qty
        FROM dispatch_lines sl
        JOIN dispatch_docs d ON d.id = sl.doc_id
        WHERE sl.doc_id IN ({placeholders}) AND COALESCE(sl.is_deleted, 0) = 0
        GROUP BY sl.product_id
        ORDER BY SUM({_BILLABLE_QTY_SQL}) DESC, MAX(sl.product_name)
        """,
        ids,
    ).fetchall()
    products = [
        {"product_id": str(r["product_id"]), "name": str(r["name"]),
         "sku": r["sku"], "qty": int(r["qty"])}
        for r in rows
    ]
    return {
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "sku_count": len(products),
    }


def list_uninvoiced_receipts(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[dict], int]:
    """Завершённые поступления, не входящие ни в один активный счёт."""
    conds = [
        "COALESCE(d.is_deleted, 0) = 0",
        "d.status = ?",
        "NOT EXISTS (SELECT 1 FROM invoice_receipts r "
        "WHERE r.receipt_doc_id = d.id AND COALESCE(r.is_deleted, 0) = 0)",
    ]
    params: list = [RECEIPT_STATUS_DONE]
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.supplier_name) LIKE ?)")
        params += [s, s]
    if date_from:
        conds.append("d.arrival_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM receipt_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.client_id, c.name AS client_name,
               d.supplier_name, d.arrival_date, d.logistics_cost, d.created_at,
               (SELECT COUNT(DISTINCT rl.product_id) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(rl.accepted_qty), 0) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS total_qty
        FROM receipt_docs d
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE {where}
        ORDER BY d.arrival_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    preview_map = _receipt_products_preview_map(connection, [str(r["id"]) for r in rows], top_n=3)

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "supplier_name": r["supplier_name"],
            "arrival_date": r["arrival_date"],
            "logistics_cost_kop": rub_to_kop(r["logistics_cost"]),
            "sku_count": int(r["sku_count"]),
            "total_qty": int(r["total_qty"]),
            "products_preview": preview_map.get(str(r["id"]), []),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def _receipt_products_preview_map(connection, doc_ids: list[str], *, top_n: int) -> dict[str, list[dict]]:
    """Для набора поступлений — топ-N товаров по принятому количеству."""
    ids = [d for d in doc_ids if d]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT doc_id, product_id, MAX(product_name) AS name, SUM(COALESCE(accepted_qty, 0)) AS qty
        FROM receipt_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY doc_id, product_id
        ORDER BY doc_id, SUM(COALESCE(accepted_qty, 0)) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    result: dict[str, list[dict]] = {}
    for r in rows:
        bucket = result.setdefault(str(r["doc_id"]), [])
        if len(bucket) < top_n:
            bucket.append({"name": str(r["name"]), "qty": int(r["qty"])})
    return result


def aggregate_receipt_contents(connection, receipt_ids: list[str]) -> dict:
    """Сводный состав по набору поступлений: товары с суммарным принятым количеством."""
    ids: list[str] = []
    for raw in receipt_ids:
        rid = str(raw or "").strip()
        if rid and rid not in ids:
            ids.append(rid)
    if not ids:
        return {"products": [], "total_qty": 0, "sku_count": 0}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT product_id, MAX(product_name) AS name, MAX(product_sku) AS sku,
               SUM(COALESCE(accepted_qty, 0)) AS qty
        FROM receipt_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY product_id
        ORDER BY SUM(COALESCE(accepted_qty, 0)) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    products = [
        {"product_id": str(r["product_id"]), "name": str(r["name"]),
         "sku": r["sku"], "qty": int(r["qty"])}
        for r in rows
    ]
    return {
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "sku_count": len(products),
    }


def suggested_amount_for_dispatches(connection, dispatch_ids: list[str]) -> dict:
    """Предлагаемая сумма счёта по набору отгрузок: Σ qty × тариф на дату отгрузки.

    Качество тарифа берётся по cargo_type отгрузки (good/defect), дата — фактическая
    дата отгрузки (или плановая). `has_missing_price` = по части позиций тариф не
    заведён (такие позиции в сумму не вошли) — UI предупреждает менеджера.

    Палеты и короба считаются отдельными компонентами `pallets_amount_kop` /
    `boxes_amount_kop`: Σ палет (коробов) документа × цена палета (короба) клиента
    (client_pallet_prices / client_box_prices) на дату отгрузки. Цена — по клиенту, без
    разделения на годный/брак. `has_missing_pallet_price` / `has_missing_box_price` = у
    клиента есть палеты (короба), но цена не заведена."""
    from modules.box_pricing.service import box_price_for_event
    from modules.pallet_pricing.service import pallet_price_for_event
    from modules.pricing.service import price_for_event

    ids: list[str] = []
    for raw in dispatch_ids:
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    if not ids:
        return {
            "amount_kop": 0, "has_missing_price": False, "priced_qty": 0, "unpriced_qty": 0,
            "pallets_amount_kop": 0, "has_missing_pallet_price": False,
            "boxes_amount_kop": 0, "has_missing_box_price": False,
        }

    today = business_today().isoformat()
    placeholders = ",".join("?" for _ in ids)
    docs = connection.execute(
        f"SELECT id, cargo_type, client_id, actual_ship_date, ship_date, closed_short_at "
        f"FROM dispatch_docs WHERE id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0",
        ids,
    ).fetchall()

    amount = 0
    priced_qty = 0
    unpriced_qty = 0
    pallets_amount = 0
    has_missing_pallet_price = False
    boxes_amount = 0
    has_missing_box_price = False
    for doc in docs:
        doc_id = str(doc["id"])
        client_id = doc["client_id"]
        quality = str(doc["cargo_type"] or "good")
        day = str(doc["actual_ship_date"] or doc["ship_date"] or today)[:10]
        # Закрытая с недовозом отгрузка тарифицируется по факту: план в строках остался
        # заявленным клиентом, но уехало меньше и больше не поедет.
        billed_short = doc["closed_short_at"] is not None
        lines = connection.execute(
            "SELECT product_id, qty, COALESCE(shipped_qty, 0) AS shipped_qty, "
            "COALESCE(pallets_qty, 0) AS pallets_qty, "
            "COALESCE(boxes_qty, 0) AS boxes_qty FROM dispatch_lines "
            "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (doc_id,),
        ).fetchall()
        pallets_total = 0
        boxes_total = 0
        for line in lines:
            pallets_total += int(line["pallets_qty"] or 0)
            boxes_total += int(line["boxes_qty"] or 0)
            qty = int(line["shipped_qty"] or 0) if billed_short else int(line["qty"] or 0)
            if qty <= 0:
                continue
            price = None
            if client_id:
                price = price_for_event(connection, str(line["product_id"]), str(client_id), quality, day)
            if price is None:
                unpriced_qty += qty
            else:
                amount += price * qty
                priced_qty += qty
        if pallets_total > 0:
            pallet_price = pallet_price_for_event(connection, str(client_id), day) if client_id else None
            if pallet_price is None:
                has_missing_pallet_price = True
            else:
                pallets_amount += pallet_price * pallets_total
        if boxes_total > 0:
            box_price = box_price_for_event(connection, str(client_id), day) if client_id else None
            if box_price is None:
                has_missing_box_price = True
            else:
                boxes_amount += box_price * boxes_total

    return {
        "amount_kop": amount,
        "has_missing_price": unpriced_qty > 0,
        "priced_qty": priced_qty,
        "unpriced_qty": unpriced_qty,
        "pallets_amount_kop": pallets_amount,
        "has_missing_pallet_price": has_missing_pallet_price,
        "boxes_amount_kop": boxes_amount,
        "has_missing_box_price": has_missing_box_price,
    }


# Лёгкий in-process кеш счётчика алёрта: бейдж опрашивается часто, а сам запрос
# хоть и индексируемый, не нужно гонять на каждый рендер главной. TTL короткий —
# точность «к оплате/просрочено» в пределах десятка секунд достаточна.
_ALERTS_TTL_SEC = 20.0
_alerts_cache: dict[str, object] = {"at": 0.0, "value": None}


def invalidate_alerts_cache() -> None:
    _alerts_cache["at"] = 0.0
    _alerts_cache["value"] = None


def alerts_counts(connection, *, client_id: str | None = None) -> dict[str, int]:
    cid = (client_id or "").strip() or None
    now_mono = time.monotonic()
    cached = _alerts_cache["value"]
    # Кешируется только общий срез — он и опрашивается часто (бейдж главной).
    # Разрез по клиенту считается каждый раз: запросов мало, а ключей кеша было бы
    # столько же, сколько клиентов.
    if cid is None and cached is not None and (now_mono - float(_alerts_cache["at"])) < _ALERTS_TTL_SEC:
        return dict(cached)  # type: ignore[arg-type]

    today = business_today().isoformat()
    active = list(INVOICE_ACTIVE_STATUSES)
    placeholders = ",".join("?" for _ in active)
    conds = f"COALESCE(is_deleted, 0) = 0 AND status IN ({placeholders})"
    params: list = [today, today, *active]
    if cid:
        conds += " AND client_id = ?"
        params.append(cid)
    row = connection.execute(
        f"""
        SELECT
            COUNT(*) AS active_count,
            COALESCE(SUM(total_amount - paid_amount), 0) AS active_outstanding,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <= ?) AS due_count,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <  ?) AS overdue_count
        FROM invoice_docs
        WHERE {conds}
        """,
        params,
    ).fetchone()
    value = {
        "due_count": int(row["due_count"] or 0),
        "overdue_count": int(row["overdue_count"] or 0),
        "active_count": int(row["active_count"] or 0),
        "active_outstanding": int(row["active_outstanding"] or 0),
    }
    if cid is None:
        _alerts_cache["at"] = now_mono
        _alerts_cache["value"] = value
    return dict(value)


# ── Аналитика дебиторки (расчёты с клиентами за период) ─────────────────────────

# Дата оплаты для срезов: `paid_on` обязателен с версии реестра, но у исторических
# записей мог быть пуст — тогда падаем на день создания, иначе сумма выпала бы из
# ряда по дням, оставшись в paid_amount, и долг по счёту завысился бы.
_PAY_DAY = "COALESCE(NULLIF(p.paid_on, ''), SUBSTR(p.created_at, 1, 10))"

_MAX_CLIENT_ROWS = 50


def _parse_window(date_from: str, date_to: str) -> tuple[date, date]:
    try:
        df = date.fromisoformat(str(date_from)[:10])
        dt = date.fromisoformat(str(date_to)[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Укажите период в формате ГГГГ-ММ-ДД") from exc
    return (dt, df) if dt < df else (df, dt)


def receivables_analytics(
    connection,
    *,
    date_from: str,
    date_to: str,
    client_id: str | None = None,
) -> dict:
    """Расчёты с клиентами за [date_from..date_to] (вкл.): что выставили, что получили,
    сколько должны и насколько долг просрочен.

    Ключевое отличие от `alerts_counts` (снимок «на сейчас»): все величины считаются
    НА ДАТУ — долг на конец дня D = выставлено (issued_on <= D) минус оплачено
    (paid_on <= D). Поэтому ряд по дням даёт накопительную кривую долга, а отчёт за
    закрытый месяц воспроизводится позже с тем же результатом.

    Черновики не участвуют (issued_on пуст) — это ещё не обязательство клиента.
    Аннулирование — событие СВОЕЙ даты, а не стирание истории: до `cancelled_on` счёт
    остаётся обязательством, в день аннулирования гасится отрицательным начислением, а
    его платежи сторнируются парной записью (см. `reverse_payments`). Сумма счёта берётся
    текущая: истории корректировок `PATCH /amount` в схеме нет, ретро-правка суммы сдвинет
    и прошлое.

    Собираемость — когортная: сколько оплачено ПО СЧЕТАМ, выставленным в периоде и не
    аннулированным (без ограничения датой оплаты), а не отношение кассы к начислению за
    те же дни.
    """
    df, dt = _parse_window(date_from, date_to)
    df_s, dt_s = df.isoformat(), dt.isoformat()
    cid = (client_id or "").strip() or None

    days: list[str] = []
    d = df
    while d <= dt:
        days.append(d.isoformat())
        d += timedelta(days=1)

    doc_where = "COALESCE(d.is_deleted, 0) = 0 AND d.issued_on IS NOT NULL"
    doc_params: list = []
    if cid:
        doc_where += " AND d.client_id = ?"
        doc_params.append(cid)

    # 1) Выставлено по дням окна + открывающий остаток начислений до окна.
    issued_rows = connection.execute(
        f"""
        SELECT d.issued_on AS day, COALESCE(SUM(d.total_amount), 0) AS amount, COUNT(*) AS n
        FROM invoice_docs d
        WHERE {doc_where} AND d.issued_on >= ? AND d.issued_on <= ?
        GROUP BY d.issued_on
        """,
        [*doc_params, df_s, dt_s],
    ).fetchall()
    issued_by_day = {str(r["day"]): int(r["amount"]) for r in issued_rows}
    issued_kop = sum(issued_by_day.values())
    issued_count = sum(int(r["n"]) for r in issued_rows)

    opening_issued = int(connection.execute(
        f"SELECT COALESCE(SUM(d.total_amount), 0) AS amount FROM invoice_docs d "
        f"WHERE {doc_where} AND d.issued_on < ?",
        [*doc_params, df_s],
    ).fetchone()["amount"])

    # 1a) Аннулировано по дням окна — отрицательное начисление на дату аннулирования.
    cancelled_rows = connection.execute(
        f"""
        SELECT d.cancelled_on AS day, COALESCE(SUM(d.total_amount), 0) AS amount, COUNT(*) AS n
        FROM invoice_docs d
        WHERE {doc_where} AND d.cancelled_on IS NOT NULL
          AND d.cancelled_on >= ? AND d.cancelled_on <= ?
        GROUP BY d.cancelled_on
        """,
        [*doc_params, df_s, dt_s],
    ).fetchall()
    cancelled_by_day = {str(r["day"]): int(r["amount"]) for r in cancelled_rows}
    cancelled_kop = sum(cancelled_by_day.values())
    cancelled_count = sum(int(r["n"]) for r in cancelled_rows)

    opening_cancelled = int(connection.execute(
        f"SELECT COALESCE(SUM(d.total_amount), 0) AS amount FROM invoice_docs d "
        f"WHERE {doc_where} AND d.cancelled_on IS NOT NULL AND d.cancelled_on < ?",
        [*doc_params, df_s],
    ).fetchone()["amount"])

    # 2) Оплачено по дням окна + открывающий остаток оплат до окна.
    # Сторно-записи (отрицательные) сидят здесь же и гасят кассу датой аннулирования.
    pay_join = f"""
        FROM invoice_payments p
        JOIN invoice_docs d ON d.id = p.invoice_id
        WHERE COALESCE(p.is_deleted, 0) = 0 AND {doc_where}
    """
    paid_rows = connection.execute(
        f"""
        SELECT {_PAY_DAY} AS day, COALESCE(SUM(p.amount), 0) AS amount, COUNT(*) AS n
        {pay_join} AND {_PAY_DAY} >= ? AND {_PAY_DAY} <= ?
        GROUP BY {_PAY_DAY}
        """,
        [*doc_params, df_s, dt_s],
    ).fetchall()
    paid_by_day = {str(r["day"]): int(r["amount"]) for r in paid_rows}
    paid_kop = sum(paid_by_day.values())
    payment_count = sum(int(r["n"]) for r in paid_rows)

    opening_paid = int(connection.execute(
        f"SELECT COALESCE(SUM(p.amount), 0) AS amount {pay_join} AND {_PAY_DAY} < ?",
        [*doc_params, df_s],
    ).fetchone()["amount"])

    # 3) Кривая долга: открывающий остаток + нарастающий итог по дням окна.
    running = opening_issued - opening_cancelled - opening_paid
    series: list[dict] = []
    for day in days:
        running += issued_by_day.get(day, 0) - cancelled_by_day.get(day, 0) - paid_by_day.get(day, 0)
        series.append({
            "date": day,
            "issued_kop": issued_by_day.get(day, 0),
            "cancelled_kop": cancelled_by_day.get(day, 0),
            "paid_kop": paid_by_day.get(day, 0),
            "outstanding_kop": running,
        })

    # 4) Средний срок оплаты — взвешенный по сумме, по оплатам окна.
    # Сторно исключаем: скорость расчётов меряется по реальным поступлениям, а
    # отрицательная запись с датой аннулирования исказила бы и знак, и срок.
    pay_speed = connection.execute(
        f"""
        SELECT COALESCE(SUM(p.amount), 0) AS amount,
               COALESCE(SUM(p.amount * ({_PAY_DAY}::date - d.issued_on::date)), 0) AS weighted
        {pay_join} AND p.reverses_id IS NULL AND {_PAY_DAY} >= ? AND {_PAY_DAY} <= ?
        """,
        [*doc_params, df_s, dt_s],
    ).fetchone()
    speed_amount = int(pay_speed["amount"] or 0)
    avg_days_to_pay = round(int(pay_speed["weighted"] or 0) / speed_amount, 1) if speed_amount else 0.0

    # 5) Собираемость когорты: оплаты по неаннулированным счетам, выставленным в окне.
    cohort_issued = int(connection.execute(
        f"SELECT COALESCE(SUM(d.total_amount), 0) AS amount FROM invoice_docs d "
        f"WHERE {doc_where} AND d.cancelled_on IS NULL AND d.issued_on >= ? AND d.issued_on <= ?",
        [*doc_params, df_s, dt_s],
    ).fetchone()["amount"])
    cohort_paid = int(connection.execute(
        f"""
        SELECT COALESCE(SUM(p.amount), 0) AS amount
        {pay_join} AND d.cancelled_on IS NULL AND d.issued_on >= ? AND d.issued_on <= ?
        """,
        [*doc_params, df_s, dt_s],
    ).fetchone()["amount"])
    collected_pct = round(cohort_paid * 100 / cohort_issued, 1) if cohort_issued else 0.0

    # 6) Долг по каждому счёту на конец окна → старение и разрез по клиентам.
    # Аннулированный к этой дате счёт обязательством уже не является.
    debt_rows = connection.execute(
        f"""
        SELECT d.id, d.client_id, d.client_name, d.due_date, d.total_amount,
               COALESCE((
                   SELECT SUM(p.amount) FROM invoice_payments p
                   WHERE p.invoice_id = d.id AND COALESCE(p.is_deleted, 0) = 0
                     AND {_PAY_DAY} <= ?
               ), 0) AS paid_to_date
        FROM invoice_docs d
        WHERE {doc_where} AND d.issued_on <= ?
          AND (d.cancelled_on IS NULL OR d.cancelled_on > ?)
        """,
        [dt_s, *doc_params, dt_s, dt_s],
    ).fetchall()

    aging = {key: {"key": key, "label": label, "count": 0, "amount_kop": 0}
             for key, label, _lo, _hi in RECEIVABLE_AGING_BUCKETS}
    clients: dict[str, dict] = {}
    debt_kop = overdue_kop = 0
    overdue_count = debt_count = 0

    for r in debt_rows:
        debt = int(r["total_amount"]) - int(r["paid_to_date"])
        if debt <= 0:
            continue
        due = str(r["due_date"] or "")
        days_overdue = (dt - date.fromisoformat(due[:10])).days if due else 0
        is_late = bool(due) and days_overdue > 0
        debt_kop += debt
        debt_count += 1
        if is_late:
            overdue_kop += debt
            overdue_count += 1
        bucket = aging[aging_bucket_key(RECEIVABLE_AGING_BUCKETS, days_overdue if due else 0)]
        bucket["count"] += 1
        bucket["amount_kop"] += debt

        key = str(r["client_id"] or "")
        c = clients.setdefault(key, {
            "client_id": r["client_id"], "client_name": r["client_name"],
            "issued_kop": 0, "paid_kop": 0, "debt_kop": 0, "overdue_kop": 0,
            "oldest_overdue_days": 0, "debt_count": 0,
        })
        c["debt_kop"] += debt
        c["debt_count"] += 1
        if is_late:
            c["overdue_kop"] += debt
            c["oldest_overdue_days"] = max(int(c["oldest_overdue_days"]), days_overdue)

    # 7) Обороты периода по клиентам — накладываются на долг из п.6.
    for row in connection.execute(
        f"""
        SELECT d.client_id, d.client_name, COALESCE(SUM(d.total_amount), 0) AS amount
        FROM invoice_docs d
        WHERE {doc_where} AND d.issued_on >= ? AND d.issued_on <= ?
        GROUP BY d.client_id, d.client_name
        """,
        [*doc_params, df_s, dt_s],
    ).fetchall():
        key = str(row["client_id"] or "")
        c = clients.setdefault(key, {
            "client_id": row["client_id"], "client_name": row["client_name"],
            "issued_kop": 0, "paid_kop": 0, "debt_kop": 0, "overdue_kop": 0,
            "oldest_overdue_days": 0, "debt_count": 0,
        })
        c["issued_kop"] += int(row["amount"])

    for row in connection.execute(
        f"""
        SELECT d.client_id, d.client_name, COALESCE(SUM(p.amount), 0) AS amount
        {pay_join} AND {_PAY_DAY} >= ? AND {_PAY_DAY} <= ?
        GROUP BY d.client_id, d.client_name
        """,
        [*doc_params, df_s, dt_s],
    ).fetchall():
        key = str(row["client_id"] or "")
        c = clients.setdefault(key, {
            "client_id": row["client_id"], "client_name": row["client_name"],
            "issued_kop": 0, "paid_kop": 0, "debt_kop": 0, "overdue_kop": 0,
            "oldest_overdue_days": 0, "debt_count": 0,
        })
        c["paid_kop"] += int(row["amount"])

    client_rows = sorted(
        clients.values(),
        key=lambda c: (-int(c["debt_kop"]), -int(c["issued_kop"])),
    )
    return {
        "date_from": df_s,
        "date_to": dt_s,
        "issued_kop": issued_kop,
        "issued_count": issued_count,
        "paid_kop": paid_kop,
        "payment_count": payment_count,
        "cancelled_kop": cancelled_kop,
        "cancelled_count": cancelled_count,
        "cohort_paid_kop": cohort_paid,
        "collected_pct": collected_pct,
        "opening_debt_kop": opening_issued - opening_cancelled - opening_paid,
        "debt_kop": debt_kop,
        "debt_count": debt_count,
        "overdue_kop": overdue_kop,
        "overdue_count": overdue_count,
        "avg_days_to_pay": avg_days_to_pay,
        "series": series,
        "aging": [aging[key] for key, _l, _lo, _hi in RECEIVABLE_AGING_BUCKETS],
        "clients": client_rows[:_MAX_CLIENT_ROWS],
        "clients_total": len(client_rows),
    }
