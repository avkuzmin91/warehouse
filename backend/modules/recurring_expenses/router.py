from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import get_current_manager
from modules.expenses.service import resolve_payment_source
from modules.timesheet.service import business_today
from security import ensure_finance_access

from .schemas import (
    AccrualRunResponse,
    MessageResponse,
    RecurringOutstandingItem,
    RecurringPayRequest,
    RecurringPayResponse,
    RecurringTemplateCreate,
    RecurringTemplateDetail,
    RecurringTemplateItem,
    RecurringTemplateListResponse,
    RecurringTemplateUpdate,
    SetRecurringRateRequest,
)
from .service import (
    add_rate,
    backfill_accruals,
    create_template,
    delete_rate,
    delete_template,
    list_templates,
    load_template_detail,
    pay_recurring_fifo,
    recurring_outstanding,
    run_recurring_accruals,
    update_template,
)

router = APIRouter(tags=["recurring-expenses"])

_MAX_BACKFILL_DAYS = 370


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


# ── Список / создание ─────────────────────────────────────────────────────────────

@router.get("/recurring-expenses", response_model=RecurringTemplateListResponse)
def list_recurring(
    user=Depends(_get_finance),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    active_only: bool = Query(False),
):
    _ = user
    with get_connection() as conn:
        items, total = list_templates(
            conn, page=page, limit=limit, search=search, active_only=active_only,
        )
    return RecurringTemplateListResponse(
        items=[RecurringTemplateItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.post("/recurring-expenses", response_model=MessageResponse)
def create_recurring(body: RecurringTemplateCreate, user=Depends(_get_finance)):
    with get_connection() as conn:
        template_id = create_template(conn, body, str(user["id"]))
        conn.commit()
    return MessageResponse(message=template_id)


# ── Массовая оплата (FIFO от ранних к поздним) ────────────────────────────────────

@router.get("/recurring-expenses/outstanding", response_model=list[RecurringOutstandingItem])
def list_recurring_outstanding(user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        rows = recurring_outstanding(conn)
    return [RecurringOutstandingItem(**r) for r in rows]


@router.post("/recurring-expenses/pay", response_model=RecurringPayResponse)
def pay_recurring(
    body: RecurringPayRequest,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    """Оплата по шаблону одной суммой: распределяется по его начислениям от ранних к
    поздним, последнее может закрыться частично. Сумма не больше суммарного остатка."""
    uid = str(user["id"])
    template_id = (body.template_id or "").strip()
    if not template_id:
        raise HTTPException(status_code=400, detail="Выберите расход")
    paid_on = _validate_date(body.paid_on) if body.paid_on else business_today().isoformat()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "recurring_expense_pay")
        if not proceed:
            return RecurringPayResponse(**stored)
        src_name = resolve_payment_source(conn, (body.payment_source_id or "").strip())
        result = pay_recurring_fifo(
            conn, template_id=template_id, amount=int(body.amount), paid_on=paid_on,
            payment_source_id=(body.payment_source_id or "").strip(), src_name=src_name, uid=uid,
        )
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return RecurringPayResponse(**result)


# ── Ручной прогон / бэкафилл начислений ──────────────────────────────────────────

@router.post("/recurring-expenses/accruals/run", response_model=AccrualRunResponse)
def run_recurring(
    on_date: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user=Depends(_get_finance),
):
    """Прогон начислений за день (on_date, по умолчанию сегодня) или диапазон дат
    (date_from..date_to — бэкафилл за пропущенные дни). Идемпотентно."""
    uid = str(user["id"])
    with get_connection() as conn:
        if date_from or date_to:
            d_from = date.fromisoformat(_validate_date(date_from)) if date_from else business_today()
            d_to = date.fromisoformat(_validate_date(date_to)) if date_to else business_today()
            if d_to < d_from:
                raise HTTPException(status_code=400, detail="Дата конца раньше начала")
            if (d_to - d_from) > timedelta(days=_MAX_BACKFILL_DAYS):
                raise HTTPException(status_code=400, detail="Слишком большой диапазон (макс. ~год)")
            created = backfill_accruals(conn, d_from, d_to, uid=uid)
            target = d_to.isoformat()
        else:
            target = _validate_date(on_date) if on_date else business_today().isoformat()
            created = run_recurring_accruals(conn, date.fromisoformat(target), uid=uid)
        if created:
            conn.commit()
    return AccrualRunResponse(created=created, on_date=target)


# ── Карточка / правка / удаление ──────────────────────────────────────────────────

@router.get("/recurring-expenses/{template_id}", response_model=RecurringTemplateDetail)
def get_recurring(template_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        detail = load_template_detail(conn, template_id)
    return RecurringTemplateDetail(**detail)


@router.patch("/recurring-expenses/{template_id}", response_model=MessageResponse)
def update_recurring(template_id: str, body: RecurringTemplateUpdate, user=Depends(_get_finance)):
    with get_connection() as conn:
        update_template(conn, template_id, body, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/recurring-expenses/{template_id}", response_model=MessageResponse)
def delete_recurring(template_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        if not delete_template(conn, template_id):
            raise HTTPException(status_code=404, detail="Регулярный расход не найден")
        conn.commit()
    return MessageResponse(message="ok")


# ── Ставка (effective-dated) ─────────────────────────────────────────────────────

@router.post("/recurring-expenses/{template_id}/rates", response_model=MessageResponse)
def set_recurring_rate(template_id: str, body: SetRecurringRateRequest, user=Depends(_get_finance)):
    uid = str(user["id"])
    effective_from = _validate_date(body.effective_from) if body.effective_from else business_today().isoformat()
    with get_connection() as conn:
        if not conn.execute(
            "SELECT 1 FROM recurring_expenses WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (template_id,),
        ).fetchone():
            raise HTTPException(status_code=404, detail="Регулярный расход не найден")
        add_rate(conn, template_id=template_id, amount_kop=int(body.amount_kop),
                 effective_from=effective_from, user_id=uid, note=body.note)
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/recurring-expenses/{template_id}/rates/{rate_id}", response_model=MessageResponse)
def delete_recurring_rate(template_id: str, rate_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        if not delete_rate(conn, template_id=template_id, rate_id=rate_id):
            raise HTTPException(status_code=404, detail="Запись ставки не найдена")
        conn.commit()
    return MessageResponse(message="ok")
