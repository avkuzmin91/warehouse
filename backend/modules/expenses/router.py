from __future__ import annotations

from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from psycopg import IntegrityError

from config import (
    EXPENSE_KIND_LOGISTICS,
    EXPENSE_KIND_MANUAL,
    EXPENSE_KINDS_ADMIN_ONLY,
    EXPENSE_KINDS_ALL,
    EXPENSE_KINDS_MANAGER_VISIBLE,
    EXPENSE_OP_CANCEL,
    EXPENSE_OP_CREATE,
    EXPENSE_OP_FILE_ADD,
    EXPENSE_OP_FILE_DELETE,
    EXPENSE_OP_UPDATE,
    EXPENSE_PAYMENT_AWAITING,
    EXPENSE_PAYMENT_CANCELLED,
    EXPENSE_PAYMENT_PAID,
    EXPENSE_PAYMENT_PARTIAL,
    MAX_UPLOAD_BYTES,
    UPLOADS_DIR,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.expenses.schemas import (
    AccrualRunResponse,
    CarrierOutstandingItem,
    ExpenseAnalyticsResponse,
    ExpenseCarrierPayRequest,
    ExpenseCarrierPayResponse,
    ExpenseCreate,
    ExpenseDetailResponse,
    ExpenseDictCreate,
    ExpenseDictItem,
    ExpenseDictUpdate,
    ExpenseListItem,
    ExpenseListResponse,
    ExpensePayRequest,
    ExpenseSummaryResponse,
    ExpenseUpdate,
    MessageResponse,
)
from modules.expenses.service import (
    add_expense_payment,
    build_update_diff,
    carrier_outstanding_logistics,
    expense_analytics,
    expense_summary,
    format_kopecks,
    list_expenses_aggregated,
    load_detail,
    next_expense_number,
    now_iso,
    pay_carrier_fifo,
    resolve_category,
    resolve_payment_source,
    revert_expense_payments,
    run_rent_accruals,
    run_salary_accruals,
    today_iso,
    validate_date,
)
from modules.timesheet.service import business_today
from security import can_manage_admin_finance, ensure_admin_finance, ensure_finance_access

router = APIRouter(tags=["expenses"])

_ALLOWED_EXPENSE_FILE_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}

# Справочники расходов: ключ из URL → (таблица, человекочитаемая метка ошибок).
_DICTS: dict[str, tuple[str, str]] = {
    "categories": ("expense_categories", "Категория"),
    "payment-sources": ("expense_payment_sources", "Источник оплаты"),
}


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


def _visible_kinds(user) -> list[str] | None:
    """Набор типов расходов, видимых роли: админ — все (None = без фильтра),
    менеджер — только хозрасходы и логистика."""
    if can_manage_admin_finance(user):
        return None
    return list(EXPENSE_KINDS_MANAGER_VISIBLE)


def _resolve_kind_filter(user, kind: str | None) -> str | None:
    """Валидирует явный фильтр kind с учётом видимости роли. 403, если менеджер
    запрашивает админский тип."""
    if not kind:
        return None
    if kind not in EXPENSE_KINDS_ALL:
        raise HTTPException(status_code=400, detail="Неизвестный тип расхода")
    if kind in EXPENSE_KINDS_ADMIN_ONLY and not can_manage_admin_finance(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return kind


def _resolve_kinds_scope(user, kinds_csv: str | None) -> list[str] | None:
    """Область типов (CSV) ∩ видимость роли. Без CSV — вся видимая область
    (None для админа = все типы). Менеджер с админским типом в CSV → 403."""
    visible = _visible_kinds(user)
    if not kinds_csv:
        return visible
    requested: list[str] = []
    for raw in kinds_csv.split(","):
        k = raw.strip()
        if not k:
            continue
        if k not in EXPENSE_KINDS_ALL:
            raise HTTPException(status_code=400, detail="Неизвестный тип расхода")
        if k in EXPENSE_KINDS_ADMIN_ONLY and not can_manage_admin_finance(user):
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        requested.append(k)
    if visible is None:
        return requested
    return [k for k in requested if k in visible]


def _assert_visible(user, row) -> None:
    """Менеджер не должен видеть/трогать аренду и ЗП даже по прямому id."""
    if str(row["kind"]) in EXPENSE_KINDS_ADMIN_ONLY and not can_manage_admin_finance(user):
        raise HTTPException(status_code=404, detail="Расход не найден")


def _resolve_kinds_analytics(kinds_csv: str | None) -> list[str] | None:
    """Область типов для аналитики — целиком, без изъятий по роли. Реестр расходов
    скрывает аренду и ЗП от менеджера, но дневная динамика и итоги аналитики обязаны
    отражать ВСЕ расходы: иначе менеджер видит заниженную картину затрат. Валидируем
    CSV, но не режем по видимости и не отдаём 403 на админский тип. Пусто → None (все)."""
    if not kinds_csv:
        return None
    requested: list[str] = []
    for raw in kinds_csv.split(","):
        k = raw.strip()
        if not k:
            continue
        if k not in EXPENSE_KINDS_ALL:
            raise HTTPException(status_code=400, detail="Неизвестный тип расхода")
        requested.append(k)
    return requested


def _journal(conn, expense_id: str, op_type: str, comment: str, uid: str) -> None:
    conn.execute(
        "INSERT INTO expense_ops (id,expense_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), expense_id, op_type, comment, now_iso(), uid),
    )


# ── Список / сводка ─────────────────────────────────────────────────────────────

@router.get("/expenses", response_model=ExpenseListResponse)
def list_expenses(
    page:              int = Query(1, ge=1),
    limit:             int = Query(25, ge=1, le=200),
    search:            str | None = Query(None),
    category_id:       str | None = Query(None),
    payment_source_id: str | None = Query(None),
    date_from:         str | None = Query(None),
    date_to:           str | None = Query(None),
    kind:              str | None = Query(None),
    kinds:             str | None = Query(None),
    payment_status:    str | None = Query(None),
    salary_subtype:    str | None = Query(None),
    user=Depends(_get_finance),
):
    kind = _resolve_kind_filter(user, kind)
    with get_connection() as conn:
        items, total = list_expenses_aggregated(
            conn, page=page, limit=limit, search=search, category_id=category_id,
            payment_source_id=payment_source_id, date_from=date_from, date_to=date_to,
            kind=kind, payment_status=payment_status, kinds=_resolve_kinds_scope(user, kinds),
            salary_subtype=salary_subtype,
        )
    return ExpenseListResponse(
        items=[ExpenseListItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/expenses/summary", response_model=ExpenseSummaryResponse)
def expenses_summary(
    search:            str | None = Query(None),
    category_id:       str | None = Query(None),
    payment_source_id: str | None = Query(None),
    date_from:         str | None = Query(None),
    date_to:           str | None = Query(None),
    kind:              str | None = Query(None),
    kinds:             str | None = Query(None),
    payment_status:    str | None = Query(None),
    salary_subtype:    str | None = Query(None),
    user=Depends(_get_finance),
):
    kind = _resolve_kind_filter(user, kind)
    with get_connection() as conn:
        data = expense_summary(
            conn, search=search, category_id=category_id,
            payment_source_id=payment_source_id, date_from=date_from, date_to=date_to,
            kind=kind, payment_status=payment_status, kinds=_resolve_kinds_scope(user, kinds),
            salary_subtype=salary_subtype,
        )
    return ExpenseSummaryResponse(**data)


# ── Аналитика расходов (ежедневная динамика, разбивка по типам и статусу) ────────

@router.get("/expenses/analytics", response_model=ExpenseAnalyticsResponse)
def expenses_analytics(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    kinds:     str | None = Query(None),
    user=Depends(_get_finance),
):
    """Ежедневная аналитика расходов: динамика по дням, распределение по типам и статусу
    оплаты. ЗП учитывается начислением по дням из табеля, аренда размазана по дням периода.
    Видна целиком всем финансовым ролям, включая аренду и ЗП: аналитика не скрывает
    расходы от менеджера (в отличие от реестра)."""
    df = validate_date(date_from)
    dt = validate_date(date_to)
    with get_connection() as conn:
        data = expense_analytics(
            conn, date_from=df, date_to=dt, kinds=_resolve_kinds_analytics(kinds),
        )
    return ExpenseAnalyticsResponse(**data)


# ── Массовая оплата перевозчику (логистика, FIFO от ранних к поздним) ────────────

@router.get("/expenses/carriers/outstanding", response_model=list[CarrierOutstandingItem])
def carriers_outstanding(user=Depends(_get_finance)):
    """Перевозчики с непогашенным остатком по логистическим расходам — для окна
    массовой оплаты. Логистика видна и менеджеру, и админу."""
    with get_connection() as conn:
        rows = carrier_outstanding_logistics(conn)
    return [CarrierOutstandingItem(**r) for r in rows]


@router.post("/expenses/pay-carrier", response_model=ExpenseCarrierPayResponse)
def pay_carrier(body: ExpenseCarrierPayRequest, user=Depends(_get_finance)):
    """Внести оплату перевозчику одной суммой: распределяется по его логистическим
    расходам от ранних к поздним, последний может закрыться частично. Сумма не может
    превышать суммарный долг перевозчику."""
    uid = str(user["id"])
    carrier_id = (body.carrier_id or "").strip()
    if not carrier_id:
        raise HTTPException(status_code=400, detail="Выберите перевозчика")
    paid_on = validate_date(body.paid_on) if body.paid_on else today_iso()
    with get_connection() as conn:
        src_name = resolve_payment_source(conn, (body.payment_source_id or "").strip())
        result = pay_carrier_fifo(
            conn, carrier_id=carrier_id, amount=int(body.amount), paid_on=paid_on,
            payment_source_id=(body.payment_source_id or "").strip(), src_name=src_name, uid=uid,
        )
        conn.commit()
    return ExpenseCarrierPayResponse(**result)


# ── Автоначисление ЗП (оклад: одна проводка на месяц, 1-го числа / в день приёма) ─

@router.post("/expenses/salary/accruals/run", response_model=AccrualRunResponse)
def run_salary_accruals_endpoint(on_date: str | None = Query(None), user=Depends(_get_finance)):
    """Ручной запуск начисления ЗП-окладов за месяц даты (по умолчанию — сегодня).
    Идемпотентно: повторный вызов ничего не дублирует. Только админ."""
    ensure_admin_finance(user)
    target = validate_date(on_date) if on_date else business_today().isoformat()
    with get_connection() as conn:
        created = run_salary_accruals(conn, date.fromisoformat(target), uid=str(user["id"]))
        if created:
            conn.commit()
    return AccrualRunResponse(created=created, on_date=target)


# ── Автозаведение аренды складов (1-е число месяца) ──────────────────────────────

@router.post("/expenses/rent/accruals/run", response_model=AccrualRunResponse)
def run_rent_accruals_endpoint(on_date: str | None = Query(None), user=Depends(_get_finance)):
    """Ручной запуск/бэкафилл аренды складов за месяц даты (по умолчанию — сегодня).
    Идемпотентно: повторный вызов за тот же месяц ничего не дублирует. Только админ."""
    ensure_admin_finance(user)
    target = validate_date(on_date) if on_date else business_today().isoformat()
    with get_connection() as conn:
        created = run_rent_accruals(conn, date.fromisoformat(target), uid=str(user["id"]))
        if created:
            conn.commit()
    return AccrualRunResponse(created=created, on_date=target)


# ── Справочники (категории, источники оплаты) ───────────────────────────────────

def _dict_meta(kind: str) -> tuple[str, str]:
    meta = _DICTS.get(kind)
    if not meta:
        raise HTTPException(status_code=404, detail="Справочник не найден")
    return meta


@router.get("/expenses/dict/{kind}", response_model=list[ExpenseDictItem])
def list_dict_items(kind: str, user=Depends(_get_finance)):
    table, _ = _dict_meta(kind)
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT id, name FROM {table} WHERE COALESCE(is_deleted, 0) = 0 "
            "ORDER BY sort_order ASC, LOWER(name) ASC"
        ).fetchall()
    return [ExpenseDictItem(id=str(r["id"]), name=str(r["name"])) for r in rows]


@router.post("/expenses/dict/{kind}", response_model=MessageResponse)
def create_dict_item(kind: str, body: ExpenseDictCreate, user=Depends(_get_finance)):
    table, label = _dict_meta(kind)
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название")
    new_id = str(uuid4())
    with get_connection() as conn:
        max_row = conn.execute(f"SELECT COALESCE(MAX(sort_order), -1) AS m FROM {table}").fetchone()
        sort_order = int(max_row["m"]) + 1
        try:
            conn.execute(
                f"INSERT INTO {table} (id,name,sort_order,created_at,created_by) VALUES (?,?,?,?,?)",
                (new_id, name, sort_order, now_iso(), str(user["id"])),
            )
            conn.commit()
        except IntegrityError as exc:
            raise HTTPException(status_code=400, detail=f"{label} с таким названием уже есть") from exc
    return MessageResponse(message=new_id)


@router.patch("/expenses/dict/{kind}/{item_id}", response_model=MessageResponse)
def update_dict_item(kind: str, item_id: str, body: ExpenseDictUpdate, user=Depends(_get_finance)):
    table, label = _dict_meta(kind)
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название")
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT 1 FROM {table} WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"{label} не найдена")
        try:
            conn.execute(
                f"UPDATE {table} SET name = ?, updated_at = ? WHERE id = ?",
                (name, now_iso(), item_id),
            )
            conn.commit()
        except IntegrityError as exc:
            raise HTTPException(status_code=400, detail=f"{label} с таким названием уже есть") from exc
    return MessageResponse(message="ok")


@router.delete("/expenses/dict/{kind}/{item_id}", response_model=MessageResponse)
def delete_dict_item(kind: str, item_id: str, user=Depends(_get_finance)):
    table, label = _dict_meta(kind)
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT 1 FROM {table} WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"{label} не найдена")
        conn.execute(
            f"UPDATE {table} SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (now_iso(), item_id),
        )
        conn.commit()
    return MessageResponse(message="ok")


# ── Расход: создание ─────────────────────────────────────────────────────────────

@router.post("/expenses", response_model=MessageResponse)
def create_expense(body: ExpenseCreate, user=Depends(_get_finance)):
    uid = str(user["id"])
    kind = (body.kind or EXPENSE_KIND_MANUAL).strip()
    if kind not in EXPENSE_KINDS_ALL:
        raise HTTPException(status_code=400, detail="Неизвестный тип расхода")
    if kind == EXPENSE_KIND_LOGISTICS:
        raise HTTPException(status_code=400, detail="Логистический расход заводится из рейса")
    if kind in EXPENSE_KINDS_ADMIN_ONLY:
        ensure_admin_finance(user)

    spent_on = validate_date(body.spent_on)
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите наименование")

    pay_status = (body.payment_status or EXPENSE_PAYMENT_PAID).strip()
    if pay_status not in (EXPENSE_PAYMENT_AWAITING, EXPENSE_PAYMENT_PAID):
        raise HTTPException(status_code=400, detail="Статус оплаты: ожидает или оплачено")

    quantity = float(body.quantity or 1)
    unit = str(body.unit or "").strip()
    if kind == EXPENSE_KIND_MANUAL and not unit:
        raise HTTPException(status_code=400, detail="Укажите единицу измерения")
    unit = unit or None

    period_start = validate_date(body.period_start) if body.period_start else None
    period_end = validate_date(body.period_end) if body.period_end else None
    expense_id = str(uuid4())
    now = now_iso()
    with get_connection() as conn:
        cat_id = (body.category_id or "").strip() or None
        if kind == EXPENSE_KIND_MANUAL and not cat_id:
            raise HTTPException(status_code=400, detail="Выберите категорию")
        cat_name = resolve_category(conn, cat_id) if cat_id else None

        src_id = (body.payment_source_id or "").strip() or None
        if pay_status == EXPENSE_PAYMENT_PAID and not src_id:
            raise HTTPException(status_code=400, detail="Выберите источник оплаты")
        src_name = resolve_payment_source(conn, src_id) if src_id else None

        paid_on = (validate_date(body.paid_on) if body.paid_on else spent_on) \
            if pay_status == EXPENSE_PAYMENT_PAID else None
        source_kind = (body.source_kind or "").strip() or None
        source_id = (body.source_id or "").strip() or None

        # Заведение «оплачено» сразу гасит расход: фиксируем платёж на всю сумму,
        # чтобы paid_amount/журнал платежей были согласованы с awaiting→partial→paid.
        amount = int(body.amount)
        paid_amount = amount if pay_status == EXPENSE_PAYMENT_PAID else 0
        exp_number = next_expense_number(conn)
        conn.execute(
            """INSERT INTO material_expenses
               (id,exp_number,spent_on,category_id,name,quantity,unit,amount,paid_amount,
                payment_source_id,supplier,comment,kind,payment_status,paid_on,
                period_start,period_end,source_kind,source_id,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (expense_id, exp_number, spent_on, cat_id, name, quantity, unit, amount, paid_amount,
             src_id, (body.supplier or "").strip() or None, (body.comment or "").strip() or None,
             kind, pay_status, paid_on, period_start, period_end, source_kind, source_id, now, uid),
        )
        if pay_status == EXPENSE_PAYMENT_PAID:
            conn.execute(
                "INSERT INTO expense_payments "
                "(id,expense_id,amount,paid_on,payment_source_id,comment,created_at,created_by) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), expense_id, amount, paid_on, src_id, "Заведено оплаченным", now, uid),
            )
        bits = [name, format_kopecks(int(body.amount))]
        if src_name:
            bits.append(src_name)
        if cat_name:
            bits.append(cat_name)
        comment = "Заведено: " + " · ".join(bits)
        if pay_status == EXPENSE_PAYMENT_AWAITING:
            comment += " · ожидает оплаты"
        _journal(conn, expense_id, EXPENSE_OP_CREATE, comment, uid)
        conn.commit()
    return MessageResponse(message=expense_id)


# ── Расход: карточка / правка ────────────────────────────────────────────────────

@router.get("/expenses/{expense_id}", response_model=ExpenseDetailResponse)
def get_expense(expense_id: str, user=Depends(_get_finance)):
    with get_connection() as conn:
        detail = load_detail(conn, expense_id)
    _assert_visible(user, detail)
    return ExpenseDetailResponse(**detail)


@router.patch("/expenses/{expense_id}", response_model=MessageResponse)
def update_expense(expense_id: str, body: ExpenseUpdate, user=Depends(_get_finance)):
    uid = str(user["id"])
    spent_on = validate_date(body.spent_on)
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите наименование")
    with get_connection() as conn:
        old = conn.execute(
            "SELECT * FROM material_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (expense_id,),
        ).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Расход не найден")
        _assert_visible(user, old)

        # Ед.изм./категория обязательны только для хозрасхода (как при создании).
        is_manual = str(old["kind"]) == EXPENSE_KIND_MANUAL
        unit = str(body.unit or "").strip()
        if is_manual and not unit:
            raise HTTPException(status_code=400, detail="Укажите единицу измерения")
        cat_id = (body.category_id or "").strip() or None
        if is_manual and not cat_id:
            raise HTTPException(status_code=400, detail="Выберите категорию")

        diff = build_update_diff(conn, old, body)
        if diff is None:
            return MessageResponse(message="ok")

        period_start = validate_date(body.period_start) if body.period_start else None
        period_end = validate_date(body.period_end) if body.period_end else None
        conn.execute(
            """UPDATE material_expenses
               SET spent_on = ?, category_id = ?, name = ?, quantity = ?, unit = ?,
                   amount = ?, payment_source_id = ?, supplier = ?, comment = ?,
                   period_start = ?, period_end = ?, updated_at = ?
               WHERE id = ?""",
            (spent_on, cat_id, name, float(body.quantity or 1), unit or None,
             int(body.amount), (body.payment_source_id or "").strip() or None,
             (body.supplier or "").strip() or None, (body.comment or "").strip() or None,
             period_start, period_end, now_iso(), expense_id),
        )
        _journal(conn, expense_id, EXPENSE_OP_UPDATE, diff, uid)
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/expenses/{expense_id}/pay", response_model=MessageResponse)
def pay_expense(expense_id: str, body: ExpensePayRequest, user=Depends(_get_finance)):
    """Оплата расхода: полная (amount не задан → гасится весь остаток) или частичная.
    Допустима из статусов «ожидает» и «частично оплачен»; переплата запрещена.
    Каждый платёж — запись в журнал expense_payments, статус пересчитывается."""
    uid = str(user["id"])
    paid_on = validate_date(body.paid_on) if body.paid_on else today_iso()
    with get_connection() as conn:
        old = conn.execute(
            "SELECT * FROM material_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0 FOR UPDATE",
            (expense_id,),
        ).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Расход не найден")
        _assert_visible(user, old)
        if str(old["payment_status"]) == EXPENSE_PAYMENT_PAID:
            raise HTTPException(status_code=400, detail="Расход уже оплачен")
        if str(old["payment_status"]) == EXPENSE_PAYMENT_CANCELLED:
            raise HTTPException(status_code=400, detail="Аннулированный расход нельзя оплатить")

        remaining = int(old["amount"]) - int(old["paid_amount"] or 0)
        pay_amount = int(body.amount) if body.amount is not None else remaining
        if pay_amount <= 0:
            raise HTTPException(status_code=400, detail="Сумма оплаты должна быть больше нуля")
        if pay_amount > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Оплата превышает остаток по расходу ({format_kopecks(max(0, remaining))})",
            )

        src_id = (body.payment_source_id or "").strip() or old["payment_source_id"]
        if not src_id:
            raise HTTPException(status_code=400, detail="Выберите источник оплаты")
        src_name = resolve_payment_source(conn, src_id)
        add_expense_payment(
            conn, old, amount=pay_amount, paid_on=paid_on,
            payment_source_id=src_id, src_name=src_name, uid=uid,
        )
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/expenses/{expense_id}/unpay", response_model=MessageResponse)
def unpay_expense(expense_id: str, user=Depends(_get_finance)):
    """Откат ошибочной оплаты: «оплачено»/«частично оплачено» → «ожидает оплаты».
    Снимает все платежи расхода (soft-delete журнала expense_payments)."""
    uid = str(user["id"])
    with get_connection() as conn:
        old = conn.execute(
            "SELECT * FROM material_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (expense_id,),
        ).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Расход не найден")
        _assert_visible(user, old)
        if str(old["payment_status"]) not in (EXPENSE_PAYMENT_PAID, EXPENSE_PAYMENT_PARTIAL):
            raise HTTPException(status_code=400, detail="Вернуть в ожидание можно только оплаченный расход")
        revert_expense_payments(conn, expense_id, int(old["paid_amount"] or 0), uid)
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/expenses/{expense_id}/cancel", response_model=MessageResponse)
def cancel_expense(expense_id: str, user=Depends(_get_finance)):
    """Снятие обязательства «ожидает оплаты» → «аннулирован» (без удаления записи)."""
    uid = str(user["id"])
    with get_connection() as conn:
        old = conn.execute(
            "SELECT * FROM material_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (expense_id,),
        ).fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Расход не найден")
        _assert_visible(user, old)
        if str(old["payment_status"]) != EXPENSE_PAYMENT_AWAITING:
            raise HTTPException(status_code=400, detail="Аннулировать можно только расход, ожидающий оплаты")
        conn.execute(
            "UPDATE material_expenses SET payment_status = ?, updated_at = ? WHERE id = ?",
            (EXPENSE_PAYMENT_CANCELLED, now_iso(), expense_id),
        )
        _journal(conn, expense_id, EXPENSE_OP_CANCEL,
                 f"Обязательство снято: {format_kopecks(int(old['amount']))}", uid)
        conn.commit()
    return MessageResponse(message="ok")


# ── Вложения (фото/скан чека) ────────────────────────────────────────────────────

@router.post("/expenses/{expense_id}/files", response_model=MessageResponse)
async def upload_expense_file(
    expense_id: str,
    file: UploadFile = File(...),
    user=Depends(_get_finance),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_EXPENSE_FILE_EXTS:
        raise HTTPException(status_code=400, detail="Допустимы файлы: pdf, png, jpg, jpeg")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")

    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM material_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (expense_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Расход не найден")

        saved_filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / saved_filename
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)

        file_id = str(uuid4())
        url = f"/uploads/{saved_filename}"
        conn.execute(
            "INSERT INTO expense_files (id,expense_id,filename,url,mime_type,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (file_id, expense_id, file.filename, url, file.content_type or None, now_iso(), uid),
        )
        _journal(conn, expense_id, EXPENSE_OP_FILE_ADD, f"Прикреплён файл {file.filename}", uid)
        conn.commit()
    return MessageResponse(message=file_id)


@router.delete("/expenses/{expense_id}/files/{file_id}", response_model=MessageResponse)
def delete_expense_file(expense_id: str, file_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT filename FROM expense_files WHERE id = ? AND expense_id = ? AND COALESCE(is_deleted, 0) = 0",
            (file_id, expense_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Файл не найден")
        conn.execute("UPDATE expense_files SET is_deleted = 1 WHERE id = ?", (file_id,))
        _journal(conn, expense_id, EXPENSE_OP_FILE_DELETE, f"Удалён файл {row['filename']}", uid)
        conn.commit()
    return MessageResponse(message="ok")
