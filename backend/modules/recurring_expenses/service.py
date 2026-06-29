"""Регулярные расходы: шаблоны + ставка с историей + авто-начисление в единый реестр.

Шаблон (recurring_expenses) описывает повторяющийся хозрасход (погрузчик, интернет…):
периодичность (ежедневно / ежемесячно в заданное число) и срок действия. Стоимость —
в отдельной таблице ставок (recurring_expense_rates), действующая ищется правилом
`pricing.price_on` (последняя запись с effective_from <= дата начисления). Планировщик
заводит расход kind=recurring «ожидает оплаты» в material_expenses; дедуп по
(source_id=шаблон, period_start) делает повторные прогоны и рестарты безопасными.

Массовая оплата по шаблону — как у перевозчика (FIFO от ранних к поздним), поверх
общего `add_expense_payment` из модуля expenses.
"""

from __future__ import annotations

import calendar
from datetime import date
from uuid import uuid4

from fastapi import HTTPException

from config import (
    EXPENSE_KIND_RECURRING,
    EXPENSE_OP_CREATE,
    EXPENSE_PAYMENT_AWAITING,
    EXPENSE_PAYMENT_CANCELLED,
    EXPENSE_PAYMENT_PAID,
    EXPENSE_SOURCE_RECURRING,
    RECURRING_FREQ_ALL,
    RECURRING_FREQ_DAILY,
    RECURRING_FREQ_LABELS,
    RECURRING_FREQ_MONTHLY,
)
from modules.expenses.service import (
    add_expense_payment,
    format_kopecks,
    next_expense_number,
    now_iso,
    today_iso,
)
from modules.pricing.service import price_on


# ── Ставки (effective-dated) ─────────────────────────────────────────────────────

def _rate_history(connection, template_id: str) -> list[dict]:
    """Записи ставки шаблона, свежая первой (формат под `price_on`)."""
    rows = connection.execute(
        "SELECT id, amount_kop, effective_from, note, created_at, created_by "
        "FROM recurring_expense_rates "
        "WHERE template_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY effective_from DESC, created_at DESC",
        (template_id,),
    ).fetchall()
    return [
        {
            "id": str(r["id"]),
            "price_kop": int(r["amount_kop"]),
            "amount_kop": int(r["amount_kop"]),
            "effective_from": str(r["effective_from"]),
            "note": r["note"],
            "created_at": str(r["created_at"]),
            "created_by": r["created_by"],
        }
        for r in rows
    ]


def rate_on(connection, template_id: str, day_iso: str) -> int | None:
    """Действующая на дату ставка шаблона. None — ставка ещё не заведена."""
    return price_on(_rate_history(connection, template_id), day_iso)


def _current_rates(connection, template_ids: list[str], day_iso: str) -> dict[str, int]:
    """template_id → действующая на дату ставка для набора шаблонов (один запрос)."""
    ids = list({str(t) for t in template_ids if t})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT template_id, amount_kop, effective_from "
        f"FROM recurring_expense_rates "
        f"WHERE template_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY template_id, effective_from DESC, created_at DESC",
        ids,
    ).fetchall()
    hist: dict[str, list[dict]] = {}
    for r in rows:
        hist.setdefault(str(r["template_id"]), []).append(
            {"price_kop": int(r["amount_kop"]), "effective_from": str(r["effective_from"])}
        )
    out: dict[str, int] = {}
    for tid in ids:
        val = price_on(hist.get(tid), day_iso)
        if val is not None:
            out[tid] = val
    return out


def add_rate(connection, *, template_id: str, amount_kop: int, effective_from: str,
             user_id: str, note: str | None = None) -> str:
    """Добавить запись ставки (append-only). Без commit — коммитит вызывающий."""
    new_id = str(uuid4())
    connection.execute(
        "INSERT INTO recurring_expense_rates "
        "(id, template_id, amount_kop, effective_from, note, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?)",
        (new_id, template_id, int(amount_kop), effective_from, (note or None), now_iso(), user_id),
    )
    return new_id


def delete_rate(connection, *, template_id: str, rate_id: str) -> bool:
    """Мягко удалить запись ставки (ошибочный ввод). Без commit.
    False, если запись не найдена / уже удалена / не принадлежит шаблону."""
    row = connection.execute(
        "SELECT id FROM recurring_expense_rates "
        "WHERE id = ? AND template_id = ? AND COALESCE(is_deleted, 0) = 0",
        (rate_id, template_id),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE recurring_expense_rates SET is_deleted = 1 WHERE id = ?", (rate_id,)
    )
    return True


# ── Шаблоны (CRUD) ────────────────────────────────────────────────────────────────

_TEMPLATE_SELECT = """
    SELECT t.*, c.name AS category_name, ps.name AS payment_source_name
    FROM recurring_expenses t
    LEFT JOIN expense_categories c ON c.id = t.category_id
    LEFT JOIN expense_payment_sources ps ON ps.id = t.payment_source_id
"""


def _row_to_item(r, current_amount: int | None) -> dict:
    return {
        "id": str(r["id"]),
        "name": str(r["name"]),
        "category_id": r["category_id"],
        "category_name": r["category_name"],
        "payment_source_id": r["payment_source_id"],
        "payment_source_name": r["payment_source_name"],
        "supplier": r["supplier"],
        "frequency": str(r["frequency"]),
        "frequency_label": RECURRING_FREQ_LABELS.get(str(r["frequency"]), str(r["frequency"])),
        "month_day": r["month_day"],
        "start_date": str(r["start_date"]),
        "end_date": r["end_date"],
        "is_active": bool(r["is_active"]),
        "current_amount_kop": current_amount,
        "created_at": str(r["created_at"]),
    }


def list_templates(connection, *, page: int, limit: int, search: str | None,
                   active_only: bool) -> tuple[list[dict], int]:
    conds = ["COALESCE(t.is_deleted, 0) = 0"]
    params: list = []
    if active_only:
        conds.append("COALESCE(t.is_active, 0) = 1")
    if search and search.strip():
        conds.append("LOWER(t.name) LIKE ?")
        params.append(f"%{search.strip().lower()}%")
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM recurring_expenses t WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"{_TEMPLATE_SELECT} WHERE {where} ORDER BY t.is_active DESC, LOWER(t.name) ASC "
        f"LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    rates = _current_rates(connection, [str(r["id"]) for r in rows], today_iso())
    return [_row_to_item(r, rates.get(str(r["id"]))) for r in rows], total


def load_template_detail(connection, template_id: str) -> dict:
    row = connection.execute(
        f"{_TEMPLATE_SELECT} WHERE t.id = ? AND COALESCE(t.is_deleted, 0) = 0",
        (template_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Регулярный расход не найден")
    item = _row_to_item(row, rate_on(connection, template_id, today_iso()))
    item["rates"] = [
        {
            "id": e["id"],
            "amount_kop": e["amount_kop"],
            "effective_from": e["effective_from"],
            "note": e["note"],
            "created_at": e["created_at"],
            "created_by": e["created_by"],
        }
        for e in _rate_history(connection, template_id)
    ]
    return item


def _validate_frequency(frequency: str, month_day: int | None) -> tuple[str, int | None]:
    freq = str(frequency or "").strip()
    if freq not in RECURRING_FREQ_ALL:
        raise HTTPException(status_code=400, detail="Периодичность: ежедневно или ежемесячно")
    if freq == RECURRING_FREQ_MONTHLY:
        if not month_day:
            raise HTTPException(status_code=400, detail="Укажите число месяца (1–28)")
        return freq, int(month_day)
    return freq, None  # ежедневно — число месяца не нужно


def _resolve_optional_category(connection, category_id: str | None) -> str | None:
    cid = (category_id or "").strip() or None
    if cid and not connection.execute(
        "SELECT 1 FROM expense_categories WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (cid,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Категория не найдена")
    return cid


def _resolve_optional_source(connection, source_id: str | None) -> str | None:
    sid = (source_id or "").strip() or None
    if sid and not connection.execute(
        "SELECT 1 FROM expense_payment_sources WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (sid,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Источник оплаты не найден")
    return sid


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


def create_template(connection, body, user_id: str) -> str:
    freq, month_day = _validate_frequency(body.frequency, body.month_day)
    category_id = _resolve_optional_category(connection, body.category_id)
    payment_source_id = _resolve_optional_source(connection, body.payment_source_id)
    start_date = _validate_date(body.start_date) if body.start_date else today_iso()
    end_date = _validate_date(body.end_date) if body.end_date else None
    if end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="Дата окончания раньше начала")

    template_id = str(uuid4())
    connection.execute(
        """INSERT INTO recurring_expenses
           (id, name, category_id, payment_source_id, supplier, frequency, month_day,
            start_date, end_date, is_active, created_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (template_id, str(body.name).strip(), category_id, payment_source_id,
         (body.supplier or "").strip() or None, freq, month_day,
         start_date, end_date, 1 if body.is_active else 0, now_iso(), user_id),
    )
    if body.amount_kop:
        add_rate(connection, template_id=template_id, amount_kop=int(body.amount_kop),
                 effective_from=start_date, user_id=user_id)
    return template_id


def update_template(connection, template_id: str, body, user_id: str) -> None:
    old = connection.execute(
        "SELECT * FROM recurring_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (template_id,),
    ).fetchone()
    if not old:
        raise HTTPException(status_code=404, detail="Регулярный расход не найден")

    name = str(body.name).strip() if body.name is not None else str(old["name"])
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название")

    freq_raw = body.frequency if body.frequency is not None else str(old["frequency"])
    month_day_raw = body.month_day if body.month_day is not None else old["month_day"]
    freq, month_day = _validate_frequency(freq_raw, month_day_raw)

    category_id = _resolve_optional_category(
        connection, body.category_id if body.category_id is not None else old["category_id"])
    payment_source_id = _resolve_optional_source(
        connection, body.payment_source_id if body.payment_source_id is not None else old["payment_source_id"])
    supplier = (body.supplier.strip() or None) if body.supplier is not None else old["supplier"]
    start_date = _validate_date(body.start_date) if body.start_date else str(old["start_date"])
    end_date = _validate_date(body.end_date) if body.end_date else (
        None if body.end_date == "" else old["end_date"])
    if end_date and str(end_date) < start_date:
        raise HTTPException(status_code=400, detail="Дата окончания раньше начала")
    is_active = old["is_active"] if body.is_active is None else (1 if body.is_active else 0)

    connection.execute(
        """UPDATE recurring_expenses
           SET name = ?, category_id = ?, payment_source_id = ?, supplier = ?,
               frequency = ?, month_day = ?, start_date = ?, end_date = ?, is_active = ?,
               updated_at = ?
           WHERE id = ?""",
        (name, category_id, payment_source_id, supplier, freq, month_day,
         start_date, end_date, is_active, now_iso(), template_id),
    )


def delete_template(connection, template_id: str) -> bool:
    row = connection.execute(
        "SELECT id FROM recurring_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (template_id,),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE recurring_expenses SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?",
        (now_iso(), template_id),
    )
    return True


# ── Авто-начисление ──────────────────────────────────────────────────────────────

def _accrual_plan(template, on_date: date) -> tuple[str, str, str] | None:
    """(spent_on, period_start, period_end) для даты начисления, либо None если в этот
    день шаблон не срабатывает. Ежедневно — расход за on_date; ежемесячно — за месяц,
    только в число month_day."""
    on_iso = on_date.isoformat()
    if str(template["start_date"]) > on_iso:
        return None
    if template["end_date"] and str(template["end_date"]) < on_iso:
        return None

    freq = str(template["frequency"])
    if freq == RECURRING_FREQ_DAILY:
        return (on_iso, on_iso, on_iso)
    if freq == RECURRING_FREQ_MONTHLY:
        if not template["month_day"] or on_date.day != int(template["month_day"]):
            return None
        y, m = on_date.year, on_date.month
        last = calendar.monthrange(y, m)[1]
        return (on_iso, date(y, m, 1).isoformat(), date(y, m, last).isoformat())
    return None


def run_recurring_accruals(connection, on_date: date, uid: str | None = None) -> int:
    """Идемпотентно заводит регулярные расходы за один день on_date: для каждого
    активного шаблона, срабатывающего в этот день, по записи kind=recurring «ожидает
    оплаты» по действующей ставке. Дедуп по (source_id=шаблон, period_start). Без commit.
    Возвращает число созданных начислений."""
    templates = connection.execute(
        "SELECT * FROM recurring_expenses "
        "WHERE COALESCE(is_active, 0) = 1 AND COALESCE(is_deleted, 0) = 0"
    ).fetchall()
    created = 0
    for t in templates:
        plan = _accrual_plan(t, on_date)
        if plan is None:
            continue
        spent_on, period_start, period_end = plan
        template_id = str(t["id"])

        exists = connection.execute(
            "SELECT 1 FROM material_expenses WHERE kind = ? AND source_kind = ? AND source_id = ? "
            "AND period_start = ? AND COALESCE(is_deleted, 0) = 0 AND payment_status != ?",
            (EXPENSE_KIND_RECURRING, EXPENSE_SOURCE_RECURRING, template_id, period_start, EXPENSE_PAYMENT_CANCELLED),
        ).fetchone()
        if exists:
            continue

        amount = rate_on(connection, template_id, spent_on)
        if not amount or amount <= 0:
            continue  # ставка ещё не заведена — пропускаем, заведём при появлении

        expense_id = str(uuid4())
        exp_number = next_expense_number(connection)
        connection.execute(
            """INSERT INTO material_expenses
               (id,exp_number,spent_on,category_id,name,quantity,unit,amount,
                payment_source_id,supplier,comment,kind,payment_status,
                period_start,period_end,source_kind,source_id,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (expense_id, exp_number, spent_on, t["category_id"], str(t["name"]), 1, None, amount,
             t["payment_source_id"], t["supplier"], None, EXPENSE_KIND_RECURRING, EXPENSE_PAYMENT_AWAITING,
             period_start, period_end, EXPENSE_SOURCE_RECURRING, template_id, now_iso(), uid),
        )
        connection.execute(
            "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), expense_id, EXPENSE_OP_CREATE,
             f"Начислено автоматически: {t['name']} · {format_kopecks(amount)} · ожидает оплаты",
             now_iso(), uid),
        )
        created += 1
    return created


def backfill_accruals(connection, date_from: date, date_to: date, uid: str | None = None) -> int:
    """Прогон начислений по диапазону дат включительно (ручной бэкафилл за пропущенные
    дни). Каждый день идемпотентен. Без commit."""
    created = 0
    cur = date_from
    one_day = (date.fromordinal(2) - date.fromordinal(1))
    while cur <= date_to:
        created += run_recurring_accruals(connection, cur, uid=uid)
        cur = cur + one_day
    return created


# ── Массовая оплата по шаблону (FIFO от ранних к поздним) ─────────────────────────

def recurring_outstanding(connection) -> list[dict]:
    """Шаблоны с непогашенным остатком по их начислениям — для окна массовой оплаты."""
    rows = connection.execute(
        """
        SELECT e.source_id AS id, t.name AS name,
               COALESCE(SUM(e.amount - COALESCE(e.paid_amount, 0)), 0) AS outstanding,
               COUNT(*) AS count
        FROM material_expenses e
        LEFT JOIN recurring_expenses t ON t.id = e.source_id
        WHERE COALESCE(e.is_deleted, 0) = 0
          AND e.kind = ?
          AND e.source_kind = ?
          AND e.source_id IS NOT NULL
          AND e.payment_status != ?
          AND (e.amount - COALESCE(e.paid_amount, 0)) > 0
        GROUP BY e.source_id, t.name
        HAVING COALESCE(SUM(e.amount - COALESCE(e.paid_amount, 0)), 0) > 0
        ORDER BY outstanding DESC
        """,
        (EXPENSE_KIND_RECURRING, EXPENSE_SOURCE_RECURRING, EXPENSE_PAYMENT_CANCELLED),
    ).fetchall()
    return [
        {
            "template_id": str(r["id"]),
            "template_name": str(r["name"]) if r["name"] else "Регулярный расход",
            "outstanding_amount": int(r["outstanding"]),
            "count": int(r["count"]),
        }
        for r in rows
    ]


def pay_recurring_fifo(connection, *, template_id: str, amount: int, paid_on: str,
                       payment_source_id: str, src_name: str, uid: str | None) -> dict:
    """Массовая оплата по шаблону: распределяет сумму по его неоплаченным начислениям
    от ранних к поздним (spent_on ASC), закрывая каждый целиком, последний — частично.
    Сумма не может превышать суммарный остаток. Без commit."""
    rows = connection.execute(
        """
        SELECT * FROM material_expenses
        WHERE COALESCE(is_deleted, 0) = 0
          AND kind = ?
          AND source_kind = ?
          AND source_id = ?
          AND payment_status != ?
          AND (amount - COALESCE(paid_amount, 0)) > 0
        ORDER BY spent_on ASC, created_at ASC
        FOR UPDATE
        """,
        (EXPENSE_KIND_RECURRING, EXPENSE_SOURCE_RECURRING, template_id, EXPENSE_PAYMENT_CANCELLED),
    ).fetchall()

    outstanding = sum(int(r["amount"]) - int(r["paid_amount"] or 0) for r in rows)
    if outstanding <= 0:
        raise HTTPException(status_code=400, detail="По этому расходу нет начислений к оплате")
    if int(amount) > outstanding:
        raise HTTPException(
            status_code=400,
            detail=f"Сумма превышает остаток по расходу ({format_kopecks(outstanding)})",
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
            comment="Массовая оплата регулярного расхода",
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
