from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    EMPLOYEE_COMP_FIXED,
    EMPLOYEE_COMP_HOURLY,
    EMPLOYEE_STATUS_ACTIVE,
    EXPENSE_KIND_LABELS,
    EXPENSE_KIND_LOGISTICS,
    EXPENSE_KIND_RENT,
    EXPENSE_KIND_SALARY,
    EXPENSE_OP_CREATE,
    EXPENSE_OP_DELETE,
    EXPENSE_OP_LABELS,
    EXPENSE_OP_PAYMENT,
    EXPENSE_OP_UNPAY,
    EXPENSE_OP_UPDATE,
    EXPENSE_PAYMENT_AWAITING,
    EXPENSE_PAYMENT_CANCELLED,
    EXPENSE_PAYMENT_PAID,
    EXPENSE_PAYMENT_PARTIAL,
    EXPENSE_PAYMENT_STATUS_LABELS,
    EXPENSE_SOURCE_EMPLOYEE,
    EXPENSE_SOURCE_PAYROLL,
    EXPENSE_SOURCE_TRIP,
    EXPENSE_SOURCE_WAREHOUSE,
    EXPENSE_SYSTEM_CATEGORY_LOGISTICS,
    EXPENSE_SYSTEM_CATEGORY_RENT,
    EXPENSE_SYSTEM_CATEGORY_SALARY,
    PAYROLL_KIND_LABELS,
)
from dbconn import like_substring_param


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def format_kopecks(kopecks: int) -> str:
    """Копейки → «1 500,00 ₽» (ru-формат для журнальных комментариев)."""
    rub, kop = divmod(int(kopecks), 100)
    grouped = f"{rub:,}".replace(",", " ")
    return f"{grouped},{kop:02d} ₽"


def format_qty(quantity) -> str:
    """Количество без хвостовых нулей: 2.500 → «2.5», 6.000 → «6»."""
    q = float(quantity)
    if q == int(q):
        return str(int(q))
    return f"{q:g}"


def format_date_dmy(iso_date: str | None) -> str:
    """YYYY-MM-DD → DD.MM.YYYY для читаемого комментария журнала."""
    s = str(iso_date or "").strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"
    return s or "—"


def validate_date(raw: str | None) -> str:
    s = str(raw or "").strip()
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        raise HTTPException(status_code=400, detail="Укажите дату в формате ГГГГ-ММ-ДД")
    return s


def next_expense_number(connection) -> str:
    """Следующий номер расхода `EXP-NNNN` (MAX, не COUNT — без дублей при дырках)."""
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(exp_number, 5) AS INTEGER)), 0) AS max_n
        FROM material_expenses
        WHERE exp_number LIKE 'EXP-%' AND SUBSTR(exp_number, 5) ~ '^[0-9]+$'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"EXP-{n:04d}"


def resolve_category(connection, category_id: str) -> str:
    """Проверяет, что категория существует и не удалена, возвращает её имя."""
    row = connection.execute(
        "SELECT name FROM expense_categories WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (str(category_id or "").strip(),),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Выберите категорию")
    return str(row["name"])


def resolve_payment_source(connection, source_id: str) -> str:
    """Проверяет, что источник оплаты существует и не удалён, возвращает его имя."""
    row = connection.execute(
        "SELECT name FROM expense_payment_sources WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (str(source_id or "").strip(),),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Выберите источник оплаты")
    return str(row["name"])


def _expense_journal(connection, expense_id: str, op_type: str, comment: str, uid: str | None) -> None:
    connection.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), expense_id, op_type, comment, now_iso(), uid),
    )


def recompute_expense_payment(connection, expense_id: str) -> tuple[int, str]:
    """Пересчитывает paid_amount/payment_status расхода по журналу expense_payments.

    Статус выводится: аннулированный остаётся аннулированным; иначе оплачено≥сумма →
    paid, 0<оплачено<сумма → partially_paid, оплачено=0 → awaiting. paid_on проставляется
    датой последнего платежа только при полном погашении (иначе снимается). Не коммитит.
    Возвращает (paid_amount, payment_status)."""
    row = connection.execute(
        "SELECT amount, payment_status FROM material_expenses WHERE id = ?", (expense_id,)
    ).fetchone()
    amount = int(row["amount"])
    agg = connection.execute(
        "SELECT COALESCE(SUM(amount), 0) AS paid, MAX(paid_on) AS last_on "
        "FROM expense_payments WHERE expense_id = ? AND COALESCE(is_deleted, 0) = 0",
        (expense_id,),
    ).fetchone()
    paid = int(agg["paid"] or 0)

    if str(row["payment_status"]) == EXPENSE_PAYMENT_CANCELLED:
        status = EXPENSE_PAYMENT_CANCELLED
    elif paid >= amount and amount > 0:
        status = EXPENSE_PAYMENT_PAID
    elif paid > 0:
        status = EXPENSE_PAYMENT_PARTIAL
    else:
        status = EXPENSE_PAYMENT_AWAITING

    paid_on = agg["last_on"] if status == EXPENSE_PAYMENT_PAID else None
    connection.execute(
        "UPDATE material_expenses SET paid_amount = ?, payment_status = ?, paid_on = ?, updated_at = ? "
        "WHERE id = ?",
        (paid, status, paid_on, now_iso(), expense_id),
    )
    return paid, status


def add_expense_payment(
    connection, expense_row, *, amount: int, paid_on: str, payment_source_id: str,
    src_name: str, uid: str | None, comment: str | None = None,
) -> tuple[int, str]:
    """Проводит один платёж по расходу: запись в журнал expense_payments + пересчёт
    статуса + человекочитаемая запись в expense_ops. Сумму и остаток валидирует вызывающий.
    Не коммитит. Возвращает (paid_amount, payment_status)."""
    expense_id = str(expense_row["id"])
    connection.execute(
        "INSERT INTO expense_payments (id,expense_id,amount,paid_on,payment_source_id,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (str(uuid4()), expense_id, int(amount), paid_on, payment_source_id,
         (comment or None), now_iso(), uid),
    )
    paid, status = recompute_expense_payment(connection, expense_id)
    # Источник последнего платежа держим на самом расходе — для колонки «Оплата»
    # в списке и как подсказку к повторной оплате остатка.
    connection.execute(
        "UPDATE material_expenses SET payment_source_id = ? WHERE id = ?",
        (payment_source_id, expense_id),
    )
    total = int(expense_row["amount"])
    tail = "оплачено полностью" if status == EXPENSE_PAYMENT_PAID \
        else f"оплачено {format_kopecks(paid)} из {format_kopecks(total)}"
    _expense_journal(
        connection, expense_id, EXPENSE_OP_PAYMENT,
        f"Платёж {format_kopecks(int(amount))} · {src_name} · {tail}", uid,
    )
    return paid, status


def revert_expense_payments(connection, expense_id: str, amount: int, uid: str | None) -> None:
    """Откат всех платежей расхода: soft-delete журнала + возврат в «ожидает оплаты».
    Не коммитит."""
    connection.execute(
        "UPDATE expense_payments SET is_deleted = 1 WHERE expense_id = ? AND COALESCE(is_deleted, 0) = 0",
        (expense_id,),
    )
    recompute_expense_payment(connection, expense_id)
    _expense_journal(
        connection, expense_id, EXPENSE_OP_UNPAY,
        f"Отметки об оплате сняты: {format_kopecks(int(amount))} · возврат в ожидание", uid,
    )


def carrier_outstanding_logistics(connection) -> list[dict]:
    """Перевозчики с непогашенным остатком по логистическим расходам (для массовой оплаты).
    Остаток = SUM(amount − paid_amount) по неаннулированным расходам kind=logistics с
    остатком > 0, сгруппировано по carrier_id."""
    rows = connection.execute(
        """
        SELECT e.carrier_id AS id, cr.name AS name,
               COALESCE(SUM(e.amount - COALESCE(e.paid_amount, 0)), 0) AS outstanding,
               COUNT(*) AS count
        FROM material_expenses e
        LEFT JOIN carriers cr ON cr.id = e.carrier_id
        WHERE COALESCE(e.is_deleted, 0) = 0
          AND e.kind = ?
          AND e.carrier_id IS NOT NULL
          AND e.payment_status != ?
          AND (e.amount - COALESCE(e.paid_amount, 0)) > 0
        GROUP BY e.carrier_id, cr.name
        HAVING COALESCE(SUM(e.amount - COALESCE(e.paid_amount, 0)), 0) > 0
        ORDER BY outstanding DESC
        """,
        (EXPENSE_KIND_LOGISTICS, EXPENSE_PAYMENT_CANCELLED),
    ).fetchall()
    return [
        {
            "carrier_id": str(r["id"]),
            "carrier_name": str(r["name"]) if r["name"] else "Без перевозчика",
            "outstanding_amount": int(r["outstanding"]),
            "count": int(r["count"]),
        }
        for r in rows
    ]


def pay_carrier_fifo(
    connection, *, carrier_id: str, amount: int, paid_on: str,
    payment_source_id: str, src_name: str, uid: str | None,
) -> dict:
    """Массовая оплата перевозчику: распределяет сумму по его непогашенным логистическим
    расходам от ранних к поздним (spent_on ASC, тай-брейк created_at ASC), закрывая каждый
    целиком, последний — частично. Сумма не может превышать суммарный остаток (валидируется).
    Не коммитит. Возвращает сводку распределения."""
    rows = connection.execute(
        """
        SELECT * FROM material_expenses
        WHERE COALESCE(is_deleted, 0) = 0
          AND kind = ?
          AND carrier_id = ?
          AND payment_status != ?
          AND (amount - COALESCE(paid_amount, 0)) > 0
        ORDER BY spent_on ASC, created_at ASC
        """,
        (EXPENSE_KIND_LOGISTICS, carrier_id, EXPENSE_PAYMENT_CANCELLED),
    ).fetchall()

    outstanding = sum(int(r["amount"]) - int(r["paid_amount"] or 0) for r in rows)
    if outstanding <= 0:
        raise HTTPException(status_code=400, detail="У перевозчика нет расходов к оплате")
    if int(amount) > outstanding:
        raise HTTPException(
            status_code=400,
            detail=f"Сумма превышает долг перевозчику ({format_kopecks(outstanding)})",
        )

    remaining = int(amount)
    affected = 0
    fully = 0
    for r in rows:
        if remaining <= 0:
            break
        owed = int(r["amount"]) - int(r["paid_amount"] or 0)
        pay = min(owed, remaining)
        _, status = add_expense_payment(
            connection, r, amount=pay, paid_on=paid_on,
            payment_source_id=payment_source_id, src_name=src_name, uid=uid,
            comment="Массовая оплата перевозчику",
        )
        remaining -= pay
        affected += 1
        if status == EXPENSE_PAYMENT_PAID:
            fully += 1

    return {
        "allocated_amount": int(amount) - remaining,
        "affected_count": affected,
        "fully_paid_count": fully,
        "partially_paid_count": affected - fully,
    }


def _expense_filter_sql(
    *,
    search: str | None,
    category_id: str | None,
    payment_source_id: str | None,
    date_from: str | None,
    date_to: str | None,
    kind: str | None = None,
    payment_status: str | None = None,
    kinds: list[str] | None = None,
) -> tuple[str, list]:
    conds = ["COALESCE(e.is_deleted, 0) = 0"]
    params: list = []
    if kinds is not None:
        if kinds:
            placeholders = ",".join("?" for _ in kinds)
            conds.append(f"e.kind IN ({placeholders})"); params += list(kinds)
        else:
            conds.append("1 = 0")
    if kind:
        conds.append("e.kind = ?"); params.append(kind.strip())
    if payment_status:
        conds.append("e.payment_status = ?"); params.append(payment_status.strip())
    if category_id:
        conds.append("e.category_id = ?"); params.append(category_id.strip())
    if payment_source_id:
        conds.append("e.payment_source_id = ?"); params.append(payment_source_id.strip())
    if date_from:
        conds.append("e.spent_on >= ?"); params.append(date_from.strip())
    if date_to:
        conds.append("e.spent_on <= ?"); params.append(date_to.strip())
    if search and search.strip():
        s = like_substring_param(search)
        conds.append("(e.name LIKE ? OR e.supplier LIKE ? OR e.exp_number LIKE ?)")
        params += [s, s, s]
    return " AND ".join(conds), params


def _row_to_list_item(r) -> dict:
    return {
        "id": str(r["id"]),
        "exp_number": str(r["exp_number"]),
        "spent_on": str(r["spent_on"]),
        "category_id": r["category_id"],
        "category_name": r["category_name"],
        "name": str(r["name"]),
        "quantity": float(r["quantity"]),
        "unit": r["unit"],
        "amount": int(r["amount"]),
        "paid_amount": int(r["paid_amount"] or 0),
        "carrier_id": r["carrier_id"],
        "carrier_name": r["carrier_name"],
        "payment_source_id": r["payment_source_id"],
        "payment_source_name": r["payment_source_name"],
        "supplier": r["supplier"],
        "comment": r["comment"],
        "kind": str(r["kind"] or "manual"),
        "kind_label": EXPENSE_KIND_LABELS.get(str(r["kind"] or "manual"), str(r["kind"] or "")),
        "payment_status": str(r["payment_status"] or "paid"),
        "payment_status_label": EXPENSE_PAYMENT_STATUS_LABELS.get(
            str(r["payment_status"] or "paid"), str(r["payment_status"] or "")
        ),
        "paid_on": r["paid_on"],
        "period_start": r["period_start"],
        "period_end": r["period_end"],
        "source_kind": r["source_kind"],
        "source_id": r["source_id"],
        "file_count": int(r["file_count"]),
        "created_at": str(r["created_at"]),
        "created_by_email": r["created_by_email"],
    }


_LIST_SELECT = """
    SELECT e.*,
           c.name AS category_name,
           ps.name AS payment_source_name,
           cr.name AS carrier_name,
           u.email AS created_by_email,
           (SELECT COUNT(*) FROM expense_files f
            WHERE f.expense_id = e.id AND COALESCE(f.is_deleted, 0) = 0) AS file_count
    FROM material_expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN expense_payment_sources ps ON ps.id = e.payment_source_id
    LEFT JOIN carriers cr ON cr.id = e.carrier_id
    LEFT JOIN users u ON u.id = e.created_by
"""


def list_expenses_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    search: str | None,
    category_id: str | None,
    payment_source_id: str | None,
    date_from: str | None,
    date_to: str | None,
    kind: str | None = None,
    payment_status: str | None = None,
    kinds: list[str] | None = None,
) -> tuple[list[dict], int]:
    where, params = _expense_filter_sql(
        search=search, category_id=category_id, payment_source_id=payment_source_id,
        date_from=date_from, date_to=date_to,
        kind=kind, payment_status=payment_status, kinds=kinds,
    )
    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM material_expenses e WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"{_LIST_SELECT} WHERE {where} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    return [_row_to_list_item(r) for r in rows], total


def expense_summary(
    connection,
    *,
    search: str | None,
    category_id: str | None,
    payment_source_id: str | None,
    date_from: str | None,
    date_to: str | None,
    kind: str | None = None,
    payment_status: str | None = None,
    kinds: list[str] | None = None,
) -> dict:
    where, params = _expense_filter_sql(
        search=search, category_id=category_id, payment_source_id=payment_source_id,
        date_from=date_from, date_to=date_to,
        kind=kind, payment_status=payment_status, kinds=kinds,
    )
    # «Оплачено» — фактически проведённые деньги (paid_amount), «Ожидает» — остаток
    # к оплате (amount − paid_amount) по неаннулированным; частично оплаченные дают
    # свой остаток в «Ожидает», уже проведённую часть — в «Оплачено».
    # Аннулированные расходы — снятые обязательства; в денежные итоги и разбивки
    # они не входят (но остаются в списке и под фильтром «Аннулирован»).
    # «Итого» = неаннулированная сумма = «Ожидает» + «Оплачено».
    active_where = f"{where} AND e.payment_status != ?"
    active_params = [*params, EXPENSE_PAYMENT_CANCELLED]
    head = connection.execute(
        f"SELECT COUNT(*) AS n, "
        f"COALESCE(SUM(CASE WHEN e.payment_status = ? THEN 0 ELSE e.amount END), 0) AS total, "
        f"COALESCE(SUM(CASE WHEN e.payment_status = ? THEN 0 "
        f"     ELSE GREATEST(e.amount - COALESCE(e.paid_amount, 0), 0) END), 0) AS awaiting, "
        f"COALESCE(SUM(CASE WHEN e.payment_status = ? THEN 0 "
        f"     ELSE COALESCE(e.paid_amount, 0) END), 0) AS paid "
        f"FROM material_expenses e WHERE {where}",
        [EXPENSE_PAYMENT_CANCELLED, EXPENSE_PAYMENT_CANCELLED, EXPENSE_PAYMENT_CANCELLED, *params],
    ).fetchone()

    by_cat = connection.execute(
        f"""
        SELECT e.category_id AS id, c.name AS name,
               COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS count
        FROM material_expenses e
        LEFT JOIN expense_categories c ON c.id = e.category_id
        WHERE {active_where}
        GROUP BY e.category_id, c.name
        ORDER BY amount DESC
        """,
        active_params,
    ).fetchall()

    by_src = connection.execute(
        f"""
        SELECT e.payment_source_id AS id, ps.name AS name,
               COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS count
        FROM material_expenses e
        LEFT JOIN expense_payment_sources ps ON ps.id = e.payment_source_id
        WHERE {active_where}
        GROUP BY e.payment_source_id, ps.name
        ORDER BY amount DESC
        """,
        active_params,
    ).fetchall()

    def _bd(rows) -> list[dict]:
        return [
            {
                "id": r["id"],
                "name": str(r["name"]) if r["name"] else "Без категории",
                "amount": int(r["amount"]),
                "count": int(r["count"]),
            }
            for r in rows
        ]

    return {
        "total_amount": int(head["total"]),
        "total_count": int(head["n"]),
        "awaiting_amount": int(head["awaiting"]),
        "paid_amount": int(head["paid"]),
        "by_category": _bd(by_cat),
        "by_payment_source": _bd(by_src),
    }


def load_detail(connection, expense_id: str) -> dict:
    row = connection.execute(
        f"{_LIST_SELECT} WHERE e.id = ? AND COALESCE(e.is_deleted, 0) = 0",
        (expense_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Расход не найден")

    item = _row_to_list_item(row)
    item["updated_at"] = row["updated_at"]

    item["source_trip_number"] = None
    if str(row["source_kind"] or "") == EXPENSE_SOURCE_TRIP and row["source_id"]:
        trip = connection.execute(
            "SELECT trip_number FROM trip_docs WHERE id = ?", (str(row["source_id"]),)
        ).fetchone()
        item["source_trip_number"] = str(trip["trip_number"]) if trip else None

    file_rows = connection.execute(
        "SELECT id, filename, url, mime_type, created_at FROM expense_files "
        "WHERE expense_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at",
        (expense_id,),
    ).fetchall()
    item["files"] = [
        {
            "id": str(f["id"]),
            "filename": str(f["filename"]),
            "url": str(f["url"]),
            "mime_type": f["mime_type"],
            "created_at": str(f["created_at"]),
        }
        for f in file_rows
    ]

    pay_rows = connection.execute(
        """
        SELECT p.id, p.amount, p.paid_on, p.payment_source_id, ps.name AS payment_source_name,
               p.comment, p.created_at, p.created_by, u.email AS created_by_email
        FROM expense_payments p
        LEFT JOIN expense_payment_sources ps ON ps.id = p.payment_source_id
        LEFT JOIN users u ON u.id = p.created_by
        WHERE p.expense_id = ? AND COALESCE(p.is_deleted, 0) = 0
        ORDER BY p.created_at
        """,
        (expense_id,),
    ).fetchall()
    item["payments"] = [
        {
            "id": str(p["id"]),
            "amount": int(p["amount"]),
            "paid_on": p["paid_on"],
            "payment_source_id": p["payment_source_id"],
            "payment_source_name": p["payment_source_name"],
            "comment": p["comment"],
            "created_at": str(p["created_at"]),
            "created_by_email": p["created_by_email"],
        }
        for p in pay_rows
    ]

    op_rows = connection.execute(
        """
        SELECT o.id, o.op_type, o.comment, o.created_at, o.created_by, u.email AS created_by_email
        FROM expense_ops o
        LEFT JOIN users u ON u.id = o.created_by
        WHERE o.expense_id = ?
        ORDER BY o.created_at
        """,
        (expense_id,),
    ).fetchall()
    item["ops"] = [
        {
            "id": str(o["id"]),
            "op_type": str(o["op_type"]),
            "op_label": EXPENSE_OP_LABELS.get(str(o["op_type"]), str(o["op_type"])),
            "comment": o["comment"],
            "created_at": str(o["created_at"]),
            "created_by": o["created_by"],
            "created_by_email": o["created_by_email"],
        }
        for o in op_rows
    ]
    return item


def build_update_diff(connection, old, body) -> str | None:
    """Человекочитаемый список изменений для журнала. None — если ничего не менялось."""
    parts: list[str] = []

    new_date = validate_date(body.spent_on)
    if str(old["spent_on"]) != new_date:
        parts.append(f"Дата: {format_date_dmy(old['spent_on'])} → {format_date_dmy(new_date)}")

    if str(old["category_id"] or "") != str(body.category_id or ""):
        old_cat = _name_of(connection, "expense_categories", old["category_id"]) or "—"
        new_cat = resolve_category(connection, body.category_id) if body.category_id else "—"
        parts.append(f"Категория: {old_cat} → {new_cat}")

    if str(old["name"]) != str(body.name).strip():
        parts.append(f"Наименование: {old['name']} → {body.name.strip()}")

    if float(old["quantity"]) != float(body.quantity):
        parts.append(f"Количество: {format_qty(old['quantity'])} → {format_qty(body.quantity)}")

    old_unit = str(old["unit"] or "")
    new_unit = str(body.unit or "").strip()
    if old_unit != new_unit:
        parts.append(f"Ед. изм.: {old_unit or '—'} → {new_unit or '—'}")

    if int(old["amount"]) != int(body.amount):
        parts.append(f"Сумма: {format_kopecks(int(old['amount']))} → {format_kopecks(int(body.amount))}")

    if str(old["payment_source_id"] or "") != str(body.payment_source_id or ""):
        old_src = _name_of(connection, "expense_payment_sources", old["payment_source_id"]) or "—"
        new_src = resolve_payment_source(connection, body.payment_source_id) if body.payment_source_id else "—"
        parts.append(f"Источник оплаты: {old_src} → {new_src}")

    old_sup = str(old["supplier"] or "")
    new_sup = str(body.supplier or "").strip()
    if old_sup != new_sup:
        parts.append(f"Поставщик: {old_sup or '—'} → {new_sup or '—'}")

    old_com = str(old["comment"] or "")
    new_com = str(body.comment or "").strip()
    if old_com != new_com:
        parts.append("Комментарий изменён")

    new_ps = str(getattr(body, "period_start", None) or "").strip()
    new_pe = str(getattr(body, "period_end", None) or "").strip()
    if str(old["period_start"] or "") != new_ps or str(old["period_end"] or "") != new_pe:
        parts.append("Период изменён")

    if not parts:
        return None
    return "; ".join(parts)


def _name_of(connection, table: str, item_id) -> str | None:
    if not item_id:
        return None
    row = connection.execute(
        f"SELECT name FROM {table} WHERE id = ?", (str(item_id),)
    ).fetchone()
    return str(row["name"]) if row else None


def resolve_system_category_id(connection, name: str) -> str | None:
    """ID активной категории по имени (best-effort): для авто-расходов рейса/ЗП.
    None, если категорию удалили — тогда расход ляжет без категории, не падая."""
    row = connection.execute(
        "SELECT id FROM expense_categories "
        "WHERE LOWER(name) = LOWER(?) AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY sort_order LIMIT 1",
        (str(name or "").strip(),),
    ).fetchone()
    return str(row["id"]) if row else None


def _date_part(value: str | None) -> str | None:
    s = str(value or "").strip()
    return s[:10] if len(s) >= 10 and s[4] == "-" and s[7] == "-" else None


def upsert_trip_logistics_expense(connection, trip_row, uid: str) -> None:
    """Заводит/обновляет логистический расход рейса в едином реестре.

    Инвариант «1 рейс → 1 логистический расход» (source_kind=trip): при повторном
    вводе стоимости обновляем тот же расход, не плодим дубли. Уже оплаченный расход
    не перетираем. Сумма рейса хранится в рублях (float) → конвертируем ×100 в копейки.
    """
    trip_id = str(trip_row["id"])
    rub = float(trip_row["logistics_cost_actual"] or 0) + float(trip_row["waiting_cost"] or 0)
    amount = round(rub * 100)

    existing = connection.execute(
        "SELECT * FROM material_expenses "
        "WHERE source_kind = ? AND source_id = ? AND COALESCE(is_deleted, 0) = 0",
        (EXPENSE_SOURCE_TRIP, trip_id),
    ).fetchone()

    if amount <= 0:
        return  # нечего проводить, существующий awaiting оставляем как есть

    trip_number = str(trip_row["trip_number"])
    carrier = (trip_row["carrier_name"] or None)
    carrier_id = (trip_row["carrier_id"] or None)
    spent_on = _date_part(trip_row["arrived_at"]) or today_iso()
    name = f"Логистика рейса {trip_number}"

    if existing:
        if str(existing["payment_status"]) != EXPENSE_PAYMENT_AWAITING:
            return  # оплаченный/отменённый расход не трогаем
        if int(existing["amount"]) == amount and str(existing["carrier_id"] or "") == str(carrier_id or ""):
            return
        connection.execute(
            "UPDATE material_expenses SET amount = ?, supplier = ?, carrier_id = ?, updated_at = ? WHERE id = ?",
            (amount, carrier, carrier_id, now_iso(), str(existing["id"])),
        )
        connection.execute(
            "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), str(existing["id"]), EXPENSE_OP_UPDATE,
             f"Стоимость логистики: {format_kopecks(int(existing['amount']))} → {format_kopecks(amount)}",
             now_iso(), uid),
        )
        return

    expense_id = str(uuid4())
    exp_number = next_expense_number(connection)
    category_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_LOGISTICS)
    connection.execute(
        """INSERT INTO material_expenses
           (id,exp_number,spent_on,category_id,name,quantity,unit,amount,
            payment_source_id,supplier,carrier_id,comment,kind,payment_status,
            source_kind,source_id,created_at,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (expense_id, exp_number, spent_on, category_id, name, 1, None, amount,
         None, carrier, carrier_id, None, EXPENSE_KIND_LOGISTICS, EXPENSE_PAYMENT_AWAITING,
         EXPENSE_SOURCE_TRIP, trip_id, now_iso(), uid),
    )
    connection.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), expense_id, EXPENSE_OP_CREATE,
         f"Заведено из рейса {trip_number}: {format_kopecks(amount)} · ожидает оплаты", now_iso(), uid),
    )


def _salary_accrual_plan(on_date: date) -> tuple[str, str, str, bool] | None:
    """(period_start, period_end, title, first_half) для даты начисления, либо None.
    Начисляем 15-го (первая половина оклада) и в последний день месяца (вторая)."""
    y, m = on_date.year, on_date.month
    last_day = calendar.monthrange(y, m)[1]
    if on_date.day == 15:
        return (date(y, m, 1).isoformat(), date(y, m, 15).isoformat(), f"Аванс ЗП {m:02d}.{y}", True)
    if on_date.day == last_day:
        return (date(y, m, 16).isoformat(), date(y, m, last_day).isoformat(), f"Расчёт ЗП {m:02d}.{y}", False)
    return None


def run_salary_accruals(connection, on_date: date, uid: str | None = None) -> int:
    """Идемпотентно начисляет ЗП-оклады по датам: 15-е число — первая половина оклада,
    последний день месяца — вторая. Только сотрудники с окладом (comp_type=fixed, fixed_salary>0).
    Дедуп по (source_id, period_start) — повторный прогон в тот же день не плодит дубли.
    Возвращает число созданных начислений. Не коммитит — это делает вызывающий."""
    plan = _salary_accrual_plan(on_date)
    if plan is None:
        return 0
    period_start, period_end, title, first_half = plan

    rows = connection.execute(
        "SELECT id, full_name, fixed_salary_kopecks FROM employees "
        "WHERE comp_type = ? AND status = ? AND COALESCE(is_deleted, 0) = 0 "
        "AND COALESCE(fixed_salary_kopecks, 0) > 0",
        (EMPLOYEE_COMP_FIXED, EMPLOYEE_STATUS_ACTIVE),
    ).fetchall()
    if not rows:
        return 0

    cat_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_SALARY)
    spent_on = on_date.isoformat()
    created = 0
    for r in rows:
        emp_id = str(r["id"])
        exists = connection.execute(
            "SELECT 1 FROM material_expenses WHERE kind = ? AND source_kind = ? AND source_id = ? "
            "AND period_start = ? AND COALESCE(is_deleted, 0) = 0",
            (EXPENSE_KIND_SALARY, EXPENSE_SOURCE_EMPLOYEE, emp_id, period_start),
        ).fetchone()
        if exists:
            continue
        fixed = int(r["fixed_salary_kopecks"])
        amount = fixed // 2 if first_half else fixed - fixed // 2
        if amount <= 0:
            continue
        expense_id = str(uuid4())
        exp_number = next_expense_number(connection)
        connection.execute(
            """INSERT INTO material_expenses
               (id,exp_number,spent_on,category_id,name,quantity,unit,amount,
                payment_source_id,supplier,comment,kind,payment_status,
                period_start,period_end,source_kind,source_id,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (expense_id, exp_number, spent_on, cat_id, f"{title} — {r['full_name']}", 1, None, amount,
             None, None, None, EXPENSE_KIND_SALARY, EXPENSE_PAYMENT_AWAITING,
             period_start, period_end, EXPENSE_SOURCE_EMPLOYEE, emp_id, now_iso(), uid),
        )
        connection.execute(
            "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), expense_id, EXPENSE_OP_CREATE,
             f"Начислено автоматически: {title} · {format_kopecks(amount)} · ожидает оплаты", now_iso(), uid),
        )
        created += 1
    return created


def record_payroll_expense(
    connection,
    *,
    payment_id: str,
    employee_id: str,
    amount: int,
    kind: str,
    paid_on: str,
    period_start: str,
    period_end: str,
    uid: str | None = None,
) -> bool:
    """Зеркалит выплату по табелю (аванс/расчёт почасовика) строкой в едином реестре расходов.

    Окладники (comp_type=fixed) сюда не попадают — их ЗП заводит авто-начисление
    run_salary_accruals, иначе расход задвоится. Инвариант «1 выплата → 1 расход»
    (source_kind=payroll, source_id=payment_id) делает повторный вызов безопасным.
    Деньги уже выданы в момент расчёта → статус сразу «оплачено». Не коммитит."""
    amount = int(amount)
    if amount <= 0:
        return False

    emp = connection.execute(
        "SELECT full_name, comp_type FROM employees WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (str(employee_id),),
    ).fetchone()
    if not emp or str(emp["comp_type"] or EMPLOYEE_COMP_HOURLY) != EMPLOYEE_COMP_HOURLY:
        return False

    exists = connection.execute(
        "SELECT 1 FROM material_expenses WHERE source_kind = ? AND source_id = ? "
        "AND COALESCE(is_deleted, 0) = 0",
        (EXPENSE_SOURCE_PAYROLL, str(payment_id)),
    ).fetchone()
    if exists:
        return False

    label = PAYROLL_KIND_LABELS.get(str(kind), str(kind))
    cat_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_SALARY)
    expense_id = str(uuid4())
    exp_number = next_expense_number(connection)
    name = f"{label} ЗП — {emp['full_name']}"
    connection.execute(
        """INSERT INTO material_expenses
           (id,exp_number,spent_on,category_id,name,quantity,unit,amount,paid_amount,
            payment_source_id,supplier,comment,kind,payment_status,paid_on,
            period_start,period_end,source_kind,source_id,created_at,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (expense_id, exp_number, paid_on, cat_id, name, 1, None, amount, amount,
         None, None, None, EXPENSE_KIND_SALARY, EXPENSE_PAYMENT_PAID, paid_on,
         period_start, period_end, EXPENSE_SOURCE_PAYROLL, str(payment_id), now_iso(), uid),
    )
    connection.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), expense_id, EXPENSE_OP_CREATE,
         f"Создано из табеля: {label} ЗП · {format_kopecks(amount)} · оплачено", now_iso(), uid),
    )
    return True


def reverse_payroll_expense(connection, *, payment_id: str, uid: str | None = None) -> bool:
    """Снимает зеркальный расход при отмене ошибочной выплаты по табелю: soft-delete + журнал.
    Парный к record_payroll_expense (source_kind=payroll, source_id=payment_id); soft-delete
    оставляет повторную выплату идемпотентной (CTE-проверка существования игнорирует удалённые).
    Не коммитит. Возвращает True, если расход был найден и снят."""
    row = connection.execute(
        "SELECT id, amount FROM material_expenses WHERE source_kind = ? AND source_id = ? "
        "AND COALESCE(is_deleted, 0) = 0",
        (EXPENSE_SOURCE_PAYROLL, str(payment_id)),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE material_expenses SET is_deleted = 1, updated_at = ? WHERE id = ?",
        (now_iso(), row["id"]),
    )
    connection.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), row["id"], EXPENSE_OP_DELETE,
         f"Выплата отменена в табеле: {format_kopecks(int(row['amount']))} · расход снят", now_iso(), uid),
    )
    return True


def run_rent_accruals(connection, on_date: date, uid: str | None = None, *, force: bool = False) -> int:
    """Идемпотентно заводит аренду складов: по записи в едином реестре на каждый активный
    склад с заданной ставкой (rent_monthly_kopecks > 0). Авто-прогон — только 1-го числа
    месяца; force=True (ручной бэкафилл) заводит аренду за месяц on_date в любой день.
    Дедуп по (kind=rent, source_kind=warehouse, source_id, period_start) делает повторные
    прогоны и рестарты безопасными. Не коммитит — это делает вызывающий."""
    if not force and on_date.day != 1:
        return 0
    y, m = on_date.year, on_date.month
    last_day = calendar.monthrange(y, m)[1]
    period_start = date(y, m, 1).isoformat()
    period_end = date(y, m, last_day).isoformat()

    rows = connection.execute(
        "SELECT id, name, rent_monthly_kopecks FROM own_warehouses "
        "WHERE COALESCE(is_active, 0) = 1 AND COALESCE(is_deleted, 0) = 0 "
        "AND COALESCE(rent_monthly_kopecks, 0) > 0"
    ).fetchall()
    if not rows:
        return 0

    cat_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_RENT)
    title_month = f"{m:02d}.{y}"
    created = 0
    for r in rows:
        wh_id = str(r["id"])
        exists = connection.execute(
            "SELECT 1 FROM material_expenses WHERE kind = ? AND source_kind = ? AND source_id = ? "
            "AND period_start = ? AND COALESCE(is_deleted, 0) = 0",
            (EXPENSE_KIND_RENT, EXPENSE_SOURCE_WAREHOUSE, wh_id, period_start),
        ).fetchone()
        if exists:
            continue
        amount = int(r["rent_monthly_kopecks"])
        if amount <= 0:
            continue
        expense_id = str(uuid4())
        exp_number = next_expense_number(connection)
        name = f"Аренда склада {r['name']} · {title_month}"
        connection.execute(
            """INSERT INTO material_expenses
               (id,exp_number,spent_on,category_id,name,quantity,unit,amount,
                payment_source_id,supplier,comment,kind,payment_status,
                period_start,period_end,source_kind,source_id,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (expense_id, exp_number, period_start, cat_id, name, 1, None, amount,
             None, None, None, EXPENSE_KIND_RENT, EXPENSE_PAYMENT_AWAITING,
             period_start, period_end, EXPENSE_SOURCE_WAREHOUSE, wh_id, now_iso(), uid),
        )
        connection.execute(
            "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), expense_id, EXPENSE_OP_CREATE,
             f"Начислено автоматически: аренда {title_month} · {format_kopecks(amount)} · ожидает оплаты",
             now_iso(), uid),
        )
        created += 1
    return created
