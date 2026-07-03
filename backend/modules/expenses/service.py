from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
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
    EXPENSE_KINDS_ALL,
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
    EXPENSE_PAYMENT_STATUSES_ALL,
    EXPENSE_SALARY_SOURCE_SUBTYPE,
    EXPENSE_SALARY_SUBTYPE_FIXED,
    EXPENSE_SALARY_SUBTYPE_LABELS,
    EXPENSE_SALARY_SUBTYPE_TIMESHEET,
    EXPENSE_SOURCE_EMPLOYEE,
    EXPENSE_SOURCE_PAYROLL,
    EXPENSE_SOURCE_TRIP,
    EXPENSE_SOURCE_WAREHOUSE,
    EXPENSE_SYSTEM_CATEGORY_LOGISTICS,
    EXPENSE_SYSTEM_CATEGORY_RENT,
    EXPENSE_SYSTEM_CATEGORY_SALARY,
    EXPENSE_SYSTEM_CATEGORY_SALARY_FIXED,
    EXPENSE_SYSTEM_CATEGORY_SALARY_TIMESHEET,
    PAYROLL_KIND_LABELS,
)
from dbconn import ci_like_substring_param
from modules.production_calendar.service import working_days_in_range, working_days_of_month
from modules.timesheet.service import (
    daily_payroll_accruals_split,
    daily_payroll_by_employee,
    load_salaries,
    salary_on,
)
from modules.warehouse_rent.service import current_rent_rates


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def format_kopecks(kopecks: int) -> str:
    """Копейки → «1 500,00 ₽» (ru-формат для журнальных комментариев)."""
    rub, kop = divmod(int(kopecks), 100)
    grouped = f"{rub:,}".replace(",", " ")
    return f"{grouped},{kop:02d} ₽"


def rub_to_kop(value) -> int:
    """Рубли → копейки без потерь на float (половина округляется вверх).

    `round(float(rub) * 100)` теряет копейку на значениях вроде 1.115 и использует
    банковское округление (round(2.5)→2). Через Decimal результат точный.
    """
    if value is None:
        return 0
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


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
    # Advisory-lock сериализует генерацию номера внутри транзакции — иначе два
    # параллельных создания получат один MAX+1.
    connection.execute("SELECT pg_advisory_xact_lock(hashtext('material_expense_number'))")
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
        FOR UPDATE
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
    salary_subtype: str | None = None,
) -> tuple[str, list]:
    conds = ["COALESCE(e.is_deleted, 0) = 0"]
    params: list = []
    if salary_subtype:
        src = {
            EXPENSE_SALARY_SUBTYPE_FIXED:     EXPENSE_SOURCE_EMPLOYEE,
            EXPENSE_SALARY_SUBTYPE_TIMESHEET: EXPENSE_SOURCE_PAYROLL,
        }.get(salary_subtype)
        if src:
            conds.append("e.source_kind = ?"); params.append(src)
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
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(e.name) LIKE ? OR fold_ci(e.supplier) LIKE ? OR fold_ci(e.exp_number) LIKE ?)")
        params += [s, s, s]
    return " AND ".join(conds), params


def _row_to_list_item(r) -> dict:
    kind = str(r["kind"] or "manual")
    salary_subtype = (
        EXPENSE_SALARY_SOURCE_SUBTYPE.get(str(r["source_kind"] or ""))
        if kind == EXPENSE_KIND_SALARY else None
    )
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
        "kind": kind,
        "kind_label": EXPENSE_KIND_LABELS.get(kind, str(r["kind"] or "")),
        "payment_status": str(r["payment_status"] or "paid"),
        "payment_status_label": EXPENSE_PAYMENT_STATUS_LABELS.get(
            str(r["payment_status"] or "paid"), str(r["payment_status"] or "")
        ),
        "paid_on": r["paid_on"],
        "period_start": r["period_start"],
        "period_end": r["period_end"],
        "source_kind": r["source_kind"],
        "source_id": r["source_id"],
        "salary_subtype": salary_subtype,
        "salary_subtype_label": EXPENSE_SALARY_SUBTYPE_LABELS.get(salary_subtype) if salary_subtype else None,
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
    salary_subtype: str | None = None,
) -> tuple[list[dict], int]:
    where, params = _expense_filter_sql(
        search=search, category_id=category_id, payment_source_id=payment_source_id,
        date_from=date_from, date_to=date_to,
        kind=kind, payment_status=payment_status, kinds=kinds, salary_subtype=salary_subtype,
    )
    # Аннулированные скрываются из списка по умолчанию; показать — явным выбором статуса оплаты.
    if not payment_status:
        where = f"{where} AND e.payment_status != ?"
        params = [*params, EXPENSE_PAYMENT_CANCELLED]
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
    salary_subtype: str | None = None,
) -> dict:
    where, params = _expense_filter_sql(
        search=search, category_id=category_id, payment_source_id=payment_source_id,
        date_from=date_from, date_to=date_to,
        kind=kind, payment_status=payment_status, kinds=kinds, salary_subtype=salary_subtype,
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
        f"     ELSE COALESCE(e.paid_amount, 0) END), 0) AS paid, "
        f"COALESCE(SUM(CASE WHEN e.payment_status IN (?, ?) THEN 1 ELSE 0 END), 0) AS awaiting_count "
        f"FROM material_expenses e WHERE {where}",
        [EXPENSE_PAYMENT_CANCELLED, EXPENSE_PAYMENT_CANCELLED, EXPENSE_PAYMENT_CANCELLED,
         EXPENSE_PAYMENT_AWAITING, EXPENSE_PAYMENT_PARTIAL, *params],
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
        "awaiting_count": int(head["awaiting_count"]),
        "paid_amount": int(head["paid"]),
        "by_category": _bd(by_cat),
        "by_payment_source": _bd(by_src),
    }


def expense_analytics(
    connection,
    *,
    date_from: str,
    date_to: str,
    kinds: list[str] | None,
) -> dict:
    """Ежедневная аналитика расходов за [date_from..date_to] (вкл.):
      • series      — начислено по дням (динамика, непрерывная шкала с нулями),
      • by_kind     — распределение начислений по типам,
      • by_category — распределение начислений по категориям,
      • by_status   — состояние оплаты обязательств реестра за период.

    Сумма дня — «начислено» (обязательство по дате операции); аннулированные исключены
    из всех срезов отчёта. Аренда размазывается по рабочим дням своего периода (как и оклад),
    а не пиком в день начисления. ЗП берётся из табеля начислением по дням (часы × ставка / доля
    оклада), а не из реестровых выплат, — поэтому реестровый kind=salary из динамики и
    by_kind исключён (иначе двойной учёт).

    `kinds=None` — все типы; список — явно запрошенная область. Аналитика не скрывает типы
    по роли: менеджер видит аренду и ЗП наравне с админом. Срез by_status считается по реестровым строкам
    (выплаты ЗП и аренда — по их дате), это состояние долгов, а не дневная атрибуция,
    поэтому его итог может отличаться от «начислено». by_category сходится с total_amount."""
    try:
        df = date.fromisoformat(date_from[:10])
        dt = date.fromisoformat(date_to[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Укажите период в формате ГГГГ-ММ-ДД") from exc
    if dt < df:
        df, dt = dt, df

    scope = list(EXPENSE_KINDS_ALL) if kinds is None else list(kinds)
    salary_in_scope = EXPENSE_KIND_SALARY in scope
    rent_in_scope = EXPENSE_KIND_RENT in scope
    registry_kinds = [k for k in scope if k != EXPENSE_KIND_SALARY]      # salary — из табеля
    point_kinds = [k for k in registry_kinds if k != EXPENSE_KIND_RENT]  # rent размазываем

    days: list[str] = []
    d = df
    while d <= dt:
        days.append(d.isoformat())
        d += timedelta(days=1)
    series: dict[str, int] = {k: 0 for k in days}
    by_kind: dict[str, dict] = {}
    by_category: dict[str, dict] = {}
    # Матрица «категория × день» для стопочного графика: имя → {id, kind, days:{день→сумма}}.
    # Ключ — имя категории (как в by_category); системные ЗП/«Без категории» с id=None
    # не сливаются, т.к. имена различны.
    cat_matrix: dict[str, dict] = {}

    def _accumulate(day_iso: str, kind: str, amount: int, count: int) -> None:
        if day_iso in series:
            series[day_iso] += amount
        bk = by_kind.setdefault(kind, {"amount": 0, "count": 0})
        bk["amount"] += amount
        bk["count"] += count

    def _add_category(name: str, cat_id: str | None, amount: int, count: int) -> None:
        if not amount:
            return
        ce = by_category.setdefault(name, {"id": cat_id, "amount": 0, "count": 0})
        ce["amount"] += amount
        ce["count"] += count

    def _add_matrix(name: str, cat_id: str | None, kind: str, day_iso: str, amount: int) -> None:
        if not amount or day_iso not in series:
            return
        e = cat_matrix.setdefault(name, {"id": cat_id, "kind": kind, "days": {}})
        if e["id"] is None and cat_id is not None:
            e["id"] = cat_id
        e["days"][day_iso] = e["days"].get(day_iso, 0) + amount

    # 1) Точечные расходы (всё, кроме аренды и ЗП) — по дате операции spent_on.
    if point_kinds:
        placeholders = ",".join("?" for _ in point_kinds)
        rows = connection.execute(
            f"""
            SELECT e.kind, e.spent_on, e.category_id, c.name AS category_name,
                   COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS count
            FROM material_expenses e
            LEFT JOIN expense_categories c ON c.id = e.category_id
            WHERE COALESCE(e.is_deleted, 0) = 0
              AND e.payment_status != ?
              AND e.kind IN ({placeholders})
              AND e.spent_on >= ? AND e.spent_on <= ?
            GROUP BY e.kind, e.spent_on, e.category_id, c.name
            """,
            [EXPENSE_PAYMENT_CANCELLED, *point_kinds, df.isoformat(), dt.isoformat()],
        ).fetchall()
        for r in rows:
            amount, count = int(r["amount"]), int(r["count"])
            cat_name = str(r["category_name"] or "Без категории")
            _accumulate(str(r["spent_on"]), str(r["kind"]), amount, count)
            _add_category(cat_name, r["category_id"], amount, count)
            _add_matrix(cat_name, r["category_id"], str(r["kind"]), str(r["spent_on"]), amount)

    # 2) Аренда — размазываем сумму по рабочим дням периода (period_start..period_end).
    if rent_in_scope:
        rent_rows = connection.execute(
            """
            SELECT e.amount, e.period_start, e.period_end, e.spent_on,
                   e.category_id, c.name AS category_name
            FROM material_expenses e
            LEFT JOIN expense_categories c ON c.id = e.category_id
            WHERE COALESCE(e.is_deleted, 0) = 0
              AND e.payment_status != ?
              AND e.kind = ?
              AND COALESCE(e.period_end, e.spent_on) >= ?
              AND COALESCE(e.period_start, e.spent_on) <= ?
            """,
            [EXPENSE_PAYMENT_CANCELLED, EXPENSE_KIND_RENT, df.isoformat(), dt.isoformat()],
        ).fetchall()
        for r in rent_rows:
            total = int(r["amount"])
            try:
                pstart = date.fromisoformat(str(r["period_start"] or r["spent_on"])[:10])
                pend = date.fromisoformat(str(r["period_end"] or r["spent_on"])[:10])
            except ValueError:
                continue
            if pend < pstart:
                pstart, pend = pend, pstart
            wd = working_days_in_range(connection, pstart, pend)  # размазываем по рабочим дням
            n_days = len(wd)
            if n_days <= 0:
                continue
            base, rem = divmod(total, n_days)  # остаток целочисленного деления — на первые дни
            in_window = 0  # сумма долей, попавших в окно отчёта — для by_category
            rent_name = str(r["category_name"] or "Без категории")
            for idx, dd in enumerate(wd):
                share = base + (1 if idx < rem else 0)
                day_iso = dd.isoformat()
                if day_iso in series and share:
                    series[day_iso] += share
                    by_kind.setdefault(EXPENSE_KIND_RENT, {"amount": 0, "count": 0})["amount"] += share
                    in_window += share
                    _add_matrix(rent_name, r["category_id"], EXPENSE_KIND_RENT, day_iso, share)
            if in_window:
                by_kind.setdefault(EXPENSE_KIND_RENT, {"amount": 0, "count": 0})["count"] += 1
                _add_category(rent_name, r["category_id"], in_window, 1)

    # 3) ЗП — начисление по дням из табеля (часы × ставка / доля оклада), разнесённое
    # на оклад (фикс) и табель (почасовую) двумя категориями, чтобы они не смешивались.
    if salary_in_scope:
        split = daily_payroll_accruals_split(connection, df.isoformat(), dt.isoformat())
        for subtype, cat_name in (
            (EXPENSE_SALARY_SUBTYPE_FIXED, EXPENSE_SYSTEM_CATEGORY_SALARY_FIXED),
            (EXPENSE_SALARY_SUBTYPE_TIMESHEET, EXPENSE_SYSTEM_CATEGORY_SALARY_TIMESHEET),
        ):
            sal_amount = sal_days = 0
            for day_iso, amount in split[subtype].items():
                if amount and day_iso in series:
                    series[day_iso] += amount
                    sal_amount += amount
                    sal_days += 1
                    _add_matrix(cat_name, None, EXPENSE_KIND_SALARY, day_iso, amount)
            if sal_amount:
                bk = by_kind.setdefault(EXPENSE_KIND_SALARY, {"amount": 0, "count": 0})
                bk["amount"] += sal_amount
                bk["count"] += sal_days
                _add_category(cat_name, None, sal_amount, sal_days)

    # 4) Статус оплаты — по реестровым строкам области; аннулированные в отчёт не входят.
    by_status: dict[str, dict] = {}
    if scope:
        placeholders = ",".join("?" for _ in scope)
        st_rows = connection.execute(
            f"""
            SELECT payment_status, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
            FROM material_expenses
            WHERE COALESCE(is_deleted, 0) = 0
              AND payment_status != ?
              AND kind IN ({placeholders})
              AND spent_on >= ? AND spent_on <= ?
            GROUP BY payment_status
            """,
            [EXPENSE_PAYMENT_CANCELLED, *scope, df.isoformat(), dt.isoformat()],
        ).fetchall()
        for r in st_rows:
            by_status[str(r["payment_status"])] = {"amount": int(r["amount"]), "count": int(r["count"])}

    total_amount = sum(series.values())
    n_days = len(days)
    return {
        "date_from": df.isoformat(),
        "date_to": dt.isoformat(),
        "days": n_days,
        "total_amount": total_amount,
        "avg_per_day": round(total_amount / n_days) if n_days else 0,
        "max_day_amount": max(series.values()) if series else 0,
        "series": [{"date": k, "amount": series[k]} for k in days],
        "categories": [
            {"id": e["id"], "name": name, "kind": e["kind"],
             "series": [e["days"].get(d, 0) for d in days]}
            for name, e in sorted(
                cat_matrix.items(), key=lambda kv: sum(kv[1]["days"].values()), reverse=True
            )
            if any(v != 0 for v in e["days"].values())
        ],
        "by_kind": [
            {"kind": k, "kind_label": EXPENSE_KIND_LABELS.get(k, k),
             "amount": v["amount"], "count": v["count"]}
            for k, v in sorted(by_kind.items(), key=lambda kv: kv[1]["amount"], reverse=True)
            if v["amount"] != 0
        ],
        "by_category": [
            {"id": v["id"], "name": name, "amount": v["amount"], "count": v["count"]}
            for name, v in sorted(by_category.items(), key=lambda kv: kv[1]["amount"], reverse=True)
            if v["amount"] != 0
        ],
        "by_status": [
            {"payment_status": s, "label": EXPENSE_PAYMENT_STATUS_LABELS.get(s, s),
             "amount": by_status[s]["amount"], "count": by_status[s]["count"]}
            for s in EXPENSE_PAYMENT_STATUSES_ALL if s in by_status
        ],
    }


def expense_day_detail(connection, *, day: str, can_view_salary: bool) -> list[dict]:
    """Детализация расхода за ОДИН день по категориям с первоисточниками — для P&L-шторки.

    Категории и их суммы совпадают с дневным срезом `expense_analytics` (тот же расчёт:
    точечные по `spent_on`, аренда — доля дня, ЗП — начисление по табелю). Каждая категория
    несёт items[] первоисточников:
      • точечный расход — реальные записи `material_expenses` (type='expense');
      • аренда — доля месячной суммы, размазанной по рабочим дням (type='computed');
      • ЗП табель — по сотрудникам (type='employee'); ЗП оклад — по сотрудникам только
        администратору (can_view_salary), иначе одна строка-агрегат без имён (защита окладов)."""
    try:
        d = date.fromisoformat(day[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Укажите день в формате ГГГГ-ММ-ДД") from exc
    day_iso = d.isoformat()

    cats: dict[str, dict] = {}

    def _cat(name: str, kind: str) -> dict:
        return cats.setdefault(name, {"key": name, "label": name, "kind": kind, "amount": 0, "items": []})

    # 1) Точечные расходы (всё, кроме аренды и ЗП) — реальные записи по дате операции.
    point_kinds = [k for k in EXPENSE_KINDS_ALL if k not in (EXPENSE_KIND_SALARY, EXPENSE_KIND_RENT)]
    if point_kinds:
        placeholders = ",".join("?" for _ in point_kinds)
        rows = connection.execute(
            f"""
            SELECT e.id, e.kind, e.amount, e.name, e.supplier, e.category_id,
                   c.name AS category_name
            FROM material_expenses e
            LEFT JOIN expense_categories c ON c.id = e.category_id
            WHERE COALESCE(e.is_deleted, 0) = 0
              AND e.payment_status != ?
              AND e.kind IN ({placeholders})
              AND e.spent_on = ?
            ORDER BY e.amount DESC
            """,
            [EXPENSE_PAYMENT_CANCELLED, *point_kinds, day_iso],
        ).fetchall()
        for r in rows:
            amount = int(r["amount"])
            if not amount:
                continue
            cat_name = str(r["category_name"] or "Без категории")
            e = _cat(cat_name, str(r["kind"]))
            e["amount"] += amount
            label = str(r["name"] or r["supplier"] or EXPENSE_KIND_LABELS.get(str(r["kind"]), cat_name))
            e["items"].append({
                "type": "expense", "label": label, "amount": amount,
                "ref_id": str(r["id"]), "ref_kind": "expense", "note": None,
            })

    # 2) Аренда — доля дня из месячной суммы, размазанной по рабочим дням периода записи.
    rent_rows = connection.execute(
        """
        SELECT e.amount, e.name, e.period_start, e.period_end, e.spent_on,
               e.category_id, c.name AS category_name
        FROM material_expenses e
        LEFT JOIN expense_categories c ON c.id = e.category_id
        WHERE COALESCE(e.is_deleted, 0) = 0
          AND e.payment_status != ?
          AND e.kind = ?
          AND COALESCE(e.period_end, e.spent_on) >= ?
          AND COALESCE(e.period_start, e.spent_on) <= ?
        """,
        [EXPENSE_PAYMENT_CANCELLED, EXPENSE_KIND_RENT, day_iso, day_iso],
    ).fetchall()
    for r in rent_rows:
        total = int(r["amount"])
        try:
            pstart = date.fromisoformat(str(r["period_start"] or r["spent_on"])[:10])
            pend = date.fromisoformat(str(r["period_end"] or r["spent_on"])[:10])
        except ValueError:
            continue
        if pend < pstart:
            pstart, pend = pend, pstart
        wd = working_days_in_range(connection, pstart, pend)
        n_days = len(wd)
        if n_days <= 0 or d not in wd:
            continue
        base, rem = divmod(total, n_days)
        share = base + (1 if wd.index(d) < rem else 0)
        if not share:
            continue
        cat_name = str(r["category_name"] or "Без категории")
        e = _cat(cat_name, EXPENSE_KIND_RENT)
        e["amount"] += share
        e["items"].append({
            "type": "computed",
            "label": str(r["name"] or "Аренда"),
            "amount": share, "ref_id": None, "ref_kind": None,
            "note": f"Доля дня из месячной суммы {format_kopecks(total)} "
                    f"({pstart.isoformat()} — {pend.isoformat()}, {n_days} раб. дн.)",
        })

    # 3) ЗП — начисление по табелю за день, по сотрудникам. Оклад окладников виден
    # только администратору; менеджеру — общая сумма без имён (нельзя идентифицировать).
    payroll = daily_payroll_by_employee(connection, day_iso)
    ts_total = sum(int(x["amount"]) for x in payroll["timesheet"])
    if ts_total:
        e = _cat(EXPENSE_SYSTEM_CATEGORY_SALARY_TIMESHEET, EXPENSE_KIND_SALARY)
        e["amount"] += ts_total
        for x in payroll["timesheet"]:
            e["items"].append({
                "type": "employee", "label": str(x["full_name"]), "amount": int(x["amount"]),
                "ref_id": str(x["employee_id"]), "ref_kind": "employee", "note": None,
            })
    fixed_total = sum(int(x["amount"]) for x in payroll["fixed"])
    if fixed_total:
        e = _cat(EXPENSE_SYSTEM_CATEGORY_SALARY_FIXED, EXPENSE_KIND_SALARY)
        e["amount"] += fixed_total
        if can_view_salary:
            for x in payroll["fixed"]:
                e["items"].append({
                    "type": "employee", "label": str(x["full_name"]), "amount": int(x["amount"]),
                    "ref_id": str(x["employee_id"]), "ref_kind": "employee", "note": None,
                })
        else:
            e["items"].append({
                "type": "computed", "label": "Начислено окладникам", "amount": fixed_total,
                "ref_id": None, "ref_kind": None,
                "note": "Детализация по сотрудникам доступна администратору",
            })

    out = [c for c in cats.values() if c["amount"] != 0]
    out.sort(key=lambda c: c["amount"], reverse=True)
    return out


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
    rub = Decimal(str(trip_row["logistics_cost_actual"] or 0)) + Decimal(str(trip_row["waiting_cost"] or 0))
    amount = rub_to_kop(rub)

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


def reattribute_trip_logistics_carrier(
    connection, trip_id: str, *, carrier_id: str | None, carrier_name: str | None, uid: str
) -> None:
    """Переносит логистический расход рейса (source_kind=trip) на другого перевозчика.

    Разрешено, только пока расход «ожидает оплаты»: у оплаченного/частично оплаченного
    расхода смена перевозчика исказила бы историю платежей и «Задолженность по перевозчикам»
    (агрегируется по carrier_id), поэтому — 400. Если расхода нет (стоимость не заводилась)
    или перевозчик уже совпадает — тихо выходим. Не коммитит — это делает вызывающий."""
    existing = connection.execute(
        "SELECT * FROM material_expenses "
        "WHERE source_kind = ? AND source_id = ? AND COALESCE(is_deleted, 0) = 0",
        (EXPENSE_SOURCE_TRIP, trip_id),
    ).fetchone()
    if not existing:
        return
    if str(existing["carrier_id"] or "") == str(carrier_id or ""):
        return
    if str(existing["payment_status"]) != EXPENSE_PAYMENT_AWAITING:
        raise HTTPException(
            status_code=400,
            detail="Расход рейса уже оплачивается — сменить перевозчика нельзя",
        )
    old_name = existing["supplier"] or "—"
    connection.execute(
        "UPDATE material_expenses SET supplier = ?, carrier_id = ?, updated_at = ? WHERE id = ?",
        (carrier_name or None, carrier_id or None, now_iso(), str(existing["id"])),
    )
    connection.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), str(existing["id"]), EXPENSE_OP_UPDATE,
         f"Перевозчик изменён: {old_name} → {carrier_name or '—'}", now_iso(), uid),
    )


def _fixed_month_accrual(connection, salaries_desc, year: int, month: int) -> int:
    """Сумма оклада за месяц по истории окладов (effective-dated). Для каждого рабочего дня
    берётся оклад, действовавший в этот день (salary_on), и его дневная доля (оклад ÷ рабочие
    дни месяца, остаток на первые рабочие дни). Считается так же, как дневная разбивка в
    аналитике, поэтому начисление в реестр и аналитика по дням сходятся копейка-в-копейку; для
    полного месяца без смены оклада сумма равна окладу, дни до даты начала оклада не считаются."""
    wd = working_days_of_month(connection, year, month)
    n = len(wd)
    if n == 0:
        return 0
    total = 0
    for idx, day in enumerate(wd):
        s = salary_on(salaries_desc, day.isoformat())
        if not s:
            continue
        base, rem = divmod(s, n)
        total += base + (1 if idx < rem else 0)
    return total


def run_salary_accruals(connection, on_date: date, uid: str | None = None) -> int:
    """Идемпотентно начисляет ЗП-оклады: ОДНА проводка на (сотрудник, месяц) за полный
    месяц, статус «ожидает оплаты». Заводится 1-го числа (или в день начала оклада для
    серединного старта); аванс/расчёт гасят её частичной оплатой — отдельных проводок
    15-го/последнего дня больше нет. Сумма берётся из истории окладов (effective-dated):
    дневная доля по рабочим дням, дни до даты начала оклада не считаются, смена оклада среди
    месяца учитывается с её даты; сходится с дневной разбивкой в аналитике. Только окладники
    (comp_type=fixed) с записью оклада. Дедуп по (source_id, period_start) — повторный прогон
    не плодит дубли. Возвращает число созданных начислений. Не коммитит — это делает вызывающий."""
    year, month = on_date.year, on_date.month
    last_day = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    period_start = month_start.isoformat()
    period_end = date(year, month, last_day).isoformat()
    title = f"Оклад {month:02d}.{year}"

    rows = connection.execute(
        "SELECT id, full_name "
        "FROM employees WHERE comp_type = ? AND status = ? AND COALESCE(is_deleted, 0) = 0",
        (EMPLOYEE_COMP_FIXED, EMPLOYEE_STATUS_ACTIVE),
    ).fetchall()
    if not rows:
        return 0

    salaries = load_salaries(connection, [str(r["id"]) for r in rows])
    cat_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_SALARY)
    spent_on = on_date.isoformat()
    created = 0
    for r in rows:
        emp_id = str(r["id"])
        sal = salaries.get(emp_id)
        if not sal:
            continue
        # Самая ранняя запись оклада = дата его начала. В этом месяце оклад «стартует» не
        # раньше 1-го числа; пока стартовый день не наступил — ждём (заведём проводку тогда).
        try:
            earliest = min(date.fromisoformat(str(s["effective_from"])[:10]) for s in sal)
        except (ValueError, TypeError):
            earliest = month_start
        start_in_month = max(month_start, earliest)
        if on_date < start_in_month:
            continue
        exists = connection.execute(
            "SELECT 1 FROM material_expenses WHERE kind = ? AND source_kind = ? AND source_id = ? "
            "AND period_start = ? AND COALESCE(is_deleted, 0) = 0 AND payment_status != ?",
            (EXPENSE_KIND_SALARY, EXPENSE_SOURCE_EMPLOYEE, emp_id, period_start, EXPENSE_PAYMENT_CANCELLED),
        ).fetchone()
        if exists:
            continue
        amount = _fixed_month_accrual(connection, sal, year, month)
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


def run_rent_accruals(connection, on_date: date, uid: str | None = None) -> int:
    """Идемпотентно заводит аренду складов: по записи в едином реестре на каждый активный
    склад с действующей на 1-е число ставкой. Ставка — effective-dated (warehouse_rent_rates,
    правило pricing.price_on), а не из колонки-кэша own_warehouses.rent_monthly_kopecks.
    Заводит аренду за МЕСЯЦ даты on_date в любой день (а не только 1-го числа), как и оклады:
    дедуп по (kind=rent, source_kind=warehouse, source_id, period_start) делает повторные
    прогоны безопасными, поэтому фоновый цикл сам добирает месяц, даже если backend не
    работал ровно 1-го числа или ставку завели позже. Тот же путь — ручной бэкафилл прошлого
    месяца через on_date. Не коммитит — это делает вызывающий."""
    y, m = on_date.year, on_date.month
    last_day = calendar.monthrange(y, m)[1]
    period_start = date(y, m, 1).isoformat()
    period_end = date(y, m, last_day).isoformat()

    rows = connection.execute(
        "SELECT id, name FROM own_warehouses "
        "WHERE COALESCE(is_active, 0) = 1 AND COALESCE(is_deleted, 0) = 0"
    ).fetchall()
    if not rows:
        return 0

    rates = current_rent_rates(connection, [str(r["id"]) for r in rows], period_start)
    cat_id = resolve_system_category_id(connection, EXPENSE_SYSTEM_CATEGORY_RENT)
    title_month = f"{m:02d}.{y}"
    created = 0
    for r in rows:
        wh_id = str(r["id"])
        amount = int(rates.get(wh_id, 0))
        if amount <= 0:
            continue
        exists = connection.execute(
            "SELECT 1 FROM material_expenses WHERE kind = ? AND source_kind = ? AND source_id = ? "
            "AND period_start = ? AND COALESCE(is_deleted, 0) = 0 AND payment_status != ?",
            (EXPENSE_KIND_RENT, EXPENSE_SOURCE_WAREHOUSE, wh_id, period_start, EXPENSE_PAYMENT_CANCELLED),
        ).fetchone()
        if exists:
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
