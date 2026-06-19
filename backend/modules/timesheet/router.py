from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    EMPLOYEE_COMP_HOURLY,
    EMPLOYEE_COMP_LABELS,
    EMPLOYEE_COMP_TYPES_ALL,
    EMPLOYEE_STATUS_ACTIVE,
    EMPLOYEE_STATUS_ARCHIVED,
    EMPLOYEE_STATUS_LABELS,
    PAYROLL_KIND_ADVANCE,
    PAYROLL_KIND_LABELS,
    PAYROLL_KIND_SETTLEMENT,
    TIMESHEET_DAY_PLANNED,
    TIMESHEET_OP_ABSENT_CLEAR,
    TIMESHEET_OP_ABSENT_MARK,
    TIMESHEET_OP_FACT_SET,
    TIMESHEET_OP_NOTE,
    TIMESHEET_OP_PLAN_SET,
)
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.expenses.service import record_payroll_expense
from security import can_view_payroll, ensure_payroll_access, ensure_timesheet_access

from .schemas import (
    BulkPlanRequest,
    DayFactBulkRequest,
    EmployeeCreate,
    EmployeeDetailResponse,
    EmployeeListItem,
    EmployeeListResponse,
    EmployeeLookupItem,
    EmployeeUpdate,
    EmployeeWeekSummary,
    EntryDetailResponse,
    EntryOpItem,
    EntryUpsert,
    FillFactRequest,
    PaymentCreate,
    PayHistoryItem,
    PayrollResponse,
    PayrollRow,
    PayrollTotals,
    RateCreate,
    RateHistoryItem,
    SettleAllRequest,
    WeekResponse,
)
from .service import (
    build_payroll,
    build_week,
    business_today,
    current_rate,
    day_status,
    entry_hours,
    fmt_date_ru,
    list_employees,
    load_entries_range,
    load_rates,
    now_iso,
    parse_week_param,
    week_days,
    week_start_for,
    week_stats,
)

router = APIRouter(tags=["timesheet"])

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _get_timesheet(user=Depends(get_current_user)):
    ensure_timesheet_access(user)
    return user


def _get_payroll(user=Depends(get_current_user)):
    ensure_payroll_access(user)
    return user


def _now() -> str:
    return now_iso()


def _clean(v: str | None) -> str | None:
    s = str(v or "").strip()
    return s or None


def _time_or_none(v: str | None, field: str) -> str | None:
    s = _clean(v)
    if s is None:
        return None
    if not _HHMM.match(s):
        raise HTTPException(status_code=400, detail=f"Неверное время в поле «{field}» (ожидается ЧЧ:ММ)")
    return s


def _is_admin(user) -> bool:
    return str(user["role"]) == "admin"


def _validate_comp_type(value: str | None) -> str:
    """Тип оплаты труда из карточки: hourly | fixed (по умолчанию hourly)."""
    v = str(value or "").strip() or EMPLOYEE_COMP_HOURLY
    if v not in EMPLOYEE_COMP_TYPES_ALL:
        raise HTTPException(status_code=400, detail="Тип оплаты: почасовая или оклад")
    return v


def _emp_or_404(conn, emp_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM employees WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (emp_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return dict(row)


def _record_payment(
    conn,
    *,
    employee_id: str,
    amount: int,
    kind: str,
    paid_on: str,
    period_start: str,
    period_end: str,
    comment: str | None,
    uid: str,
) -> str:
    """Пишет выплату в журнал табеля и зеркалит её расходом в едином реестре.
    Расход создаётся только для почасовиков (окладники — через авто-начисление). Возвращает id выплаты."""
    payment_id = str(uuid4())
    conn.execute(
        "INSERT INTO payroll_payments "
        "(id,employee_id,amount_kopecks,kind,paid_on,period_start,period_end,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (payment_id, employee_id, int(amount), kind, paid_on,
         period_start, period_end, comment, _now(), uid),
    )
    record_payroll_expense(
        conn,
        payment_id=payment_id,
        employee_id=employee_id,
        amount=int(amount),
        kind=kind,
        paid_on=paid_on,
        period_start=period_start,
        period_end=period_end,
        uid=uid,
    )
    return payment_id


def _op(conn, entry_id: str, op_type: str, comment: str, uid: str, now: str) -> None:
    conn.execute(
        "INSERT INTO timesheet_ops (id,entry_id,op_type,comment,created_at,created_by) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), entry_id, op_type, comment, now, uid),
    )


# ── Сотрудники ────────────────────────────────────────────────────────────────

@router.get("/employees", response_model=EmployeeListResponse)
def list_employees_route(
    status: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(_get_timesheet),
):
    with_money = can_view_payroll(user)
    with get_connection() as conn:
        items = list_employees(conn, status=status, search=search, with_money=with_money)
    return EmployeeListResponse(
        items=[
            EmployeeListItem(
                id=it["id"],
                full_name=it["full_name"],
                position=it["position"],
                position_id=it.get("position_id"),
                status=it["status"],
                status_label=EMPLOYEE_STATUS_LABELS.get(it["status"], it["status"]),
                last_shift=it["last_shift"],
                rate_kopecks=it.get("rate_kopecks"),
                comp_type=it.get("comp_type", EMPLOYEE_COMP_HOURLY),
                fixed_salary_kopecks=it.get("fixed_salary_kopecks"),
            )
            for it in items
        ],
        total=len(items),
    )


@router.get("/employees/lookup", response_model=list[EmployeeLookupItem])
def employees_lookup(user=Depends(_get_timesheet)):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT e.id, e.full_name, COALESCE(p.name, e.position) AS position "
            "FROM employees e LEFT JOIN positions p ON p.id = e.position_id "
            "WHERE COALESCE(e.is_deleted, 0) = 0 AND e.status = ? ORDER BY e.full_name",
            (EMPLOYEE_STATUS_ACTIVE,),
        ).fetchall()
    return [
        EmployeeLookupItem(id=str(r["id"]), name=str(r["full_name"]), position=r["position"])
        for r in rows
    ]


def _validate_position(conn, position_id: str | None) -> str | None:
    pid = _clean(position_id)
    if pid is None:
        return None
    if not conn.execute(
        "SELECT 1 FROM positions WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (pid,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Должность не найдена")
    return pid


def _validate_user_link(conn, user_id: str | None, exclude_emp_id: str | None = None) -> str | None:
    """Связь сотрудника с учёткой: учётка существует и не занята другим сотрудником."""
    link = _clean(user_id)
    if link is None:
        return None
    if not conn.execute(
        "SELECT 1 FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (link,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Учётная запись не найдена")
    taken = conn.execute(
        "SELECT 1 FROM employees WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "AND id <> COALESCE(?, '')",
        (link, exclude_emp_id),
    ).fetchone()
    if taken:
        raise HTTPException(status_code=400, detail="Эта учётная запись уже связана с сотрудником")
    return link


@router.post("/employees")
def create_employee(body: EmployeeCreate, user=Depends(_get_timesheet)):
    full_name = str(body.full_name or "").strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите ФИО сотрудника")
    uid = str(user["id"])
    now = _now()
    emp_id = str(uuid4())
    comp_type = _validate_comp_type(body.comp_type)
    # Оклад — это деньги: проставляет только тот, кто их видит.
    fixed_salary = int(body.fixed_salary_kopecks) \
        if body.fixed_salary_kopecks is not None and can_view_payroll(user) else None
    with get_connection() as conn:
        position_id = _validate_position(conn, body.position_id)
        # Связь с учётной записью назначает только администратор.
        user_link = _validate_user_link(conn, body.user_id) if _is_admin(user) else None
        conn.execute(
            "INSERT INTO employees "
            "(id,full_name,position_id,user_id,status,hired_on,comp_type,fixed_salary_kopecks,"
            "created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (emp_id, full_name, position_id, user_link, EMPLOYEE_STATUS_ACTIVE,
             _clean(body.hired_on), comp_type, fixed_salary, now, uid),
        )
        # Стартовую ставку проставляет только тот, кто видит деньги.
        if body.rate_kopecks is not None and can_view_payroll(user):
            eff = _clean(body.effective_from) or business_today().isoformat()
            conn.execute(
                "INSERT INTO employee_rates (id,employee_id,rate_kopecks,effective_from,note,created_at,created_by) "
                "VALUES (?,?,?,?,?,?,?)",
                (str(uuid4()), emp_id, int(body.rate_kopecks), eff, "стартовая ставка", now, uid),
            )
        conn.commit()
    return {"message": emp_id}


@router.get("/employees/{emp_id}", response_model=EmployeeDetailResponse)
def get_employee(emp_id: str, user=Depends(_get_timesheet)):
    with_money = can_view_payroll(user)
    today = business_today()
    sat = week_start_for(today)
    days = week_days(sat)
    fri = days[-1]
    with get_connection() as conn:
        emp = _emp_or_404(conn, emp_id)
        meta = conn.execute(
            "SELECT COALESCE(p.name, e.position) AS position_name, lu.email AS user_email "
            "FROM employees e "
            "LEFT JOIN positions p ON p.id = e.position_id "
            "LEFT JOIN users lu ON lu.id = e.user_id "
            "WHERE e.id = ?",
            (emp_id,),
        ).fetchone()
        entries = load_entries_range(conn, sat.isoformat(), fri.isoformat())
        rates = load_rates(conn, [emp_id]).get(emp_id) if with_money else None

        pays_period = None
        rate_history: list[RateHistoryItem] = []
        pay_history: list[PayHistoryItem] = []
        if with_money:
            period_rows = conn.execute(
                "SELECT * FROM payroll_payments WHERE employee_id = ? "
                "AND COALESCE(is_deleted, 0) = 0 AND period_start = ? AND period_end = ?",
                (emp_id, sat.isoformat(), fri.isoformat()),
            ).fetchall()
            pays_period = [dict(r) for r in period_rows]
            for i, r in enumerate(rates or []):
                rate_history.append(RateHistoryItem(
                    rate_kopecks=int(r["rate_kopecks"]),
                    effective_from=str(r["effective_from"]),
                    note=r["note"],
                    current=(i == 0),
                ))
            hist_rows = conn.execute(
                "SELECT * FROM payroll_payments WHERE employee_id = ? "
                "AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at DESC",
                (emp_id,),
            ).fetchall()
            pay_history = [
                PayHistoryItem(
                    id=str(r["id"]),
                    kind=str(r["kind"]),
                    kind_label=PAYROLL_KIND_LABELS.get(str(r["kind"]), str(r["kind"])),
                    amount_kopecks=int(r["amount_kopecks"]),
                    paid_on=r["paid_on"],
                    period_start=r["period_start"],
                    period_end=r["period_end"],
                    comment=r["comment"],
                    created_at=str(r["created_at"]),
                )
                for r in hist_rows
            ]

    s = week_stats(emp_id, days, entries, rates, today.isoformat(), pays_period)
    status = str(emp["status"])
    return EmployeeDetailResponse(
        id=emp_id,
        full_name=str(emp["full_name"]),
        position=meta["position_name"] if meta else emp["position"],
        position_id=emp.get("position_id"),
        user_id=emp.get("user_id"),
        user_email=meta["user_email"] if meta else None,
        status=status,
        status_label=EMPLOYEE_STATUS_LABELS.get(status, status),
        hired_on=emp["hired_on"],
        rate_kopecks=current_rate(rates) if with_money else None,
        comp_type=str(emp.get("comp_type") or EMPLOYEE_COMP_HOURLY),
        comp_label=EMPLOYEE_COMP_LABELS.get(
            str(emp.get("comp_type") or EMPLOYEE_COMP_HOURLY), ""
        ),
        fixed_salary_kopecks=(
            int(emp["fixed_salary_kopecks"])
            if with_money and emp.get("fixed_salary_kopecks") is not None else None
        ),
        with_money=with_money,
        week_start=sat.isoformat(),
        week_end=fri.isoformat(),
        week_label=f"{fmt_date_ru(sat)} — {fmt_date_ru(fri)} {fri.year}",
        this_week=EmployeeWeekSummary(
            hours=s["hours"],
            worked_days=s["worked_days"],
            absent=s["absent"],
            earned=s["earned"] if with_money else None,
            advances=s["advances"] if with_money else None,
            to_pay=s["to_pay"] if with_money else None,
            overpaid=s["overpaid"] if with_money else None,
        ),
        rate_history=rate_history,
        pay_history=pay_history,
    )


@router.patch("/employees/{emp_id}")
def update_employee(emp_id: str, body: EmployeeUpdate, user=Depends(_get_timesheet)):
    fields = body.model_fields_set
    now = _now()
    with get_connection() as conn:
        _emp_or_404(conn, emp_id)
        sets: list[str] = []
        params: list = []
        if "full_name" in fields:
            fn = str(body.full_name or "").strip()
            if not fn:
                raise HTTPException(status_code=400, detail="Укажите ФИО сотрудника")
            sets.append("full_name = ?"); params.append(fn)
        if "position_id" in fields:
            sets.append("position_id = ?"); params.append(_validate_position(conn, body.position_id))
        if "hired_on" in fields:
            sets.append("hired_on = ?"); params.append(_clean(body.hired_on))
        if "comp_type" in fields:
            sets.append("comp_type = ?"); params.append(_validate_comp_type(body.comp_type))
        # Оклад — деньги: меняет только тот, кто их видит.
        if "fixed_salary_kopecks" in fields and can_view_payroll(user):
            fs = body.fixed_salary_kopecks
            sets.append("fixed_salary_kopecks = ?")
            params.append(int(fs) if fs is not None else None)
        # Связь с учётной записью меняет только администратор.
        if "user_id" in fields and _is_admin(user):
            sets.append("user_id = ?"); params.append(_validate_user_link(conn, body.user_id, emp_id))
        if not sets:
            return {"message": "ok"}
        sets.append("updated_at = ?"); params.append(now)
        params.append(emp_id)
        conn.execute(f"UPDATE employees SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    return {"message": "ok"}


@router.post("/employees/{emp_id}/archive")
def archive_employee(emp_id: str, user=Depends(_get_timesheet)):
    now = _now()
    with get_connection() as conn:
        _emp_or_404(conn, emp_id)
        conn.execute(
            "UPDATE employees SET status = ?, updated_at = ? WHERE id = ?",
            (EMPLOYEE_STATUS_ARCHIVED, now, emp_id),
        )
        conn.commit()
    return {"message": EMPLOYEE_STATUS_ARCHIVED}


@router.post("/employees/{emp_id}/restore")
def restore_employee(emp_id: str, user=Depends(_get_timesheet)):
    now = _now()
    with get_connection() as conn:
        _emp_or_404(conn, emp_id)
        conn.execute(
            "UPDATE employees SET status = ?, updated_at = ? WHERE id = ?",
            (EMPLOYEE_STATUS_ACTIVE, now, emp_id),
        )
        conn.commit()
    return {"message": EMPLOYEE_STATUS_ACTIVE}


@router.post("/employees/{emp_id}/rates")
def add_rate(emp_id: str, body: RateCreate, user=Depends(_get_payroll)):
    eff = str(body.effective_from or "").strip()
    if not eff:
        raise HTTPException(status_code=400, detail="Укажите дату, с которой действует ставка")
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        _emp_or_404(conn, emp_id)
        conn.execute(
            "INSERT INTO employee_rates (id,employee_id,rate_kopecks,effective_from,note,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), emp_id, int(body.rate_kopecks), eff, _clean(body.note), now, uid),
        )
        conn.commit()
    return {"message": "ok"}


# ── Табель: сетка недели ──────────────────────────────────────────────────────

@router.get("/timesheet/week", response_model=WeekResponse)
def get_week(week: str | None = Query(None), user=Depends(_get_timesheet)):
    sat = parse_week_param(week)
    with get_connection() as conn:
        data = build_week(conn, sat, with_money=can_view_payroll(user))
    return WeekResponse(**data)


@router.get("/timesheet/entry", response_model=EntryDetailResponse)
def get_entry(
    employee_id: str = Query(...),
    date: str = Query(..., alias="date"),
    user=Depends(_get_timesheet),
):
    work_date = str(date or "").strip()
    today_iso = business_today().isoformat()
    with get_connection() as conn:
        emp = _emp_or_404(conn, employee_id)
        row = conn.execute(
            "SELECT * FROM timesheet_entries "
            "WHERE employee_id = ? AND work_date = ? AND COALESCE(is_deleted, 0) = 0",
            (employee_id, work_date),
        ).fetchone()
        entry = dict(row) if row else None
        ops: list[EntryOpItem] = []
        if entry:
            op_rows = conn.execute(
                "SELECT o.id, o.op_type, o.comment, o.created_at, o.created_by, u.email AS created_by_email "
                "FROM timesheet_ops o LEFT JOIN users u ON u.id = o.created_by "
                "WHERE o.entry_id = ? ORDER BY o.created_at DESC",
                (str(entry["id"]),),
            ).fetchall()
            ops = [
                EntryOpItem(
                    id=str(r["id"]), op_type=str(r["op_type"]), comment=r["comment"],
                    created_at=str(r["created_at"]), created_by=r["created_by"],
                    created_by_email=r["created_by_email"],
                )
                for r in op_rows
            ]
    return EntryDetailResponse(
        employee_id=employee_id,
        employee_name=str(emp["full_name"]),
        work_date=work_date,
        planned_start=entry.get("planned_start") if entry else None,
        planned_end=entry.get("planned_end") if entry else None,
        actual_start=entry.get("actual_start") if entry else None,
        actual_end=entry.get("actual_end") if entry else None,
        is_absent=bool(entry.get("is_absent")) if entry else False,
        status=day_status(entry, work_date, today_iso),
        hours=entry_hours(entry),
        note=entry.get("note") if entry else None,
        ops=ops,
    )


@router.put("/timesheet/entry")
def upsert_entry(body: EntryUpsert, user=Depends(_get_timesheet)):
    work_date = str(body.work_date or "").strip()
    if not work_date:
        raise HTTPException(status_code=400, detail="Укажите дату")
    ps = _time_or_none(body.planned_start, "План · приход")
    pe = _time_or_none(body.planned_end, "План · уход")
    fs = _time_or_none(body.actual_start, "Факт · приход")
    fe = _time_or_none(body.actual_end, "Факт · уход")
    note = _clean(body.note)
    absent = 1 if body.is_absent else 0
    if (fs or fe or absent) and work_date > business_today().isoformat():
        raise HTTPException(status_code=400, detail="Нельзя внести факт за ненаступивший день")
    uid = str(user["id"])
    now = _now()

    with get_connection() as conn:
        _emp_or_404(conn, body.employee_id)
        row = conn.execute(
            "SELECT * FROM timesheet_entries "
            "WHERE employee_id = ? AND work_date = ? AND COALESCE(is_deleted, 0) = 0",
            (body.employee_id, work_date),
        ).fetchone()

        if row is None:
            entry_id = str(uuid4())
            conn.execute(
                "INSERT INTO timesheet_entries "
                "(id,employee_id,work_date,planned_start,planned_end,actual_start,actual_end,is_absent,note,created_at,created_by) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (entry_id, body.employee_id, work_date, ps, pe, fs, fe, absent, note, now, uid),
            )
            if ps and pe:
                _op(conn, entry_id, TIMESHEET_OP_PLAN_SET, f"План: {ps}–{pe}", uid, now)
            if fs and fe:
                _op(conn, entry_id, TIMESHEET_OP_FACT_SET, f"Факт: {fs}–{fe}", uid, now)
            if absent:
                _op(conn, entry_id, TIMESHEET_OP_ABSENT_MARK, "Отмечен «не вышел»", uid, now)
            if note:
                _op(conn, entry_id, TIMESHEET_OP_NOTE, f"Примечание: «{note}»", uid, now)
        else:
            entry_id = str(row["id"])
            old = dict(row)

            def _pair(a, b):
                return f"{a}–{b}" if a and b else "нет"

            if (ps, pe) != (old.get("planned_start"), old.get("planned_end")):
                _op(conn, entry_id, TIMESHEET_OP_PLAN_SET,
                    f"План: {_pair(old.get('planned_start'), old.get('planned_end'))} → {_pair(ps, pe)}", uid, now)
            if (fs, fe) != (old.get("actual_start"), old.get("actual_end")):
                _op(conn, entry_id, TIMESHEET_OP_FACT_SET,
                    f"Факт: {_pair(old.get('actual_start'), old.get('actual_end'))} → {_pair(fs, fe)}", uid, now)
            if absent != int(old.get("is_absent") or 0):
                _op(conn, entry_id,
                    TIMESHEET_OP_ABSENT_MARK if absent else TIMESHEET_OP_ABSENT_CLEAR,
                    "Отмечен «не вышел»" if absent else "Снят «не вышел»", uid, now)
            if note != old.get("note"):
                _op(conn, entry_id, TIMESHEET_OP_NOTE, f"Примечание: «{note or ''}»", uid, now)

            conn.execute(
                "UPDATE timesheet_entries SET planned_start=?,planned_end=?,actual_start=?,actual_end=?,"
                "is_absent=?,note=?,updated_at=? WHERE id=?",
                (ps, pe, fs, fe, absent, note, now, entry_id),
            )
        conn.commit()
    return {"message": "ok"}


@router.post("/timesheet/fill-fact")
def fill_fact(body: FillFactRequest, user=Depends(_get_timesheet)):
    """Массово проставить факт = плану за расчётную неделю.

    Обычный режим: только там, где день запланирован и факта ещё нет — невыходы и
    уже заполненные дни не трогаются. Режим `force=1`: для всех запланированных
    наступивших дней факт переписывается планом, снимая «не вышел» (для заполнения
    задним числом, когда корректировать каждую запись вручную неудобно)."""
    sat = parse_week_param(body.week)
    days = week_days(sat)
    today_iso = business_today().isoformat()
    uid = str(user["id"])
    now = _now()
    force = bool(body.force)
    filled = 0
    with get_connection() as conn:
        entries = load_entries_range(conn, days[0].isoformat(), days[-1].isoformat())
        for (emp_id, day_iso), entry in entries.items():
            if day_iso > today_iso:  # факт за ненаступивший день не проставляем
                continue
            ps, pe = entry.get("planned_start"), entry.get("planned_end")
            entry_id = str(entry["id"])
            if not force:
                if day_status(entry, day_iso, today_iso) != TIMESHEET_DAY_PLANNED:
                    continue
                conn.execute(
                    "UPDATE timesheet_entries SET actual_start=?,actual_end=?,updated_at=? WHERE id=?",
                    (ps, pe, now, entry_id),
                )
                _op(conn, entry_id, TIMESHEET_OP_FACT_SET, f"Факт по плану: {ps}–{pe}", uid, now)
                filled += 1
                continue
            # force: переписываем факт планом для всех запланированных дней, снимая невыход
            if not (ps and pe):
                continue
            was_absent = int(entry.get("is_absent") or 0) == 1
            same_fact = (entry.get("actual_start"), entry.get("actual_end")) == (ps, pe)
            if same_fact and not was_absent:
                continue
            conn.execute(
                "UPDATE timesheet_entries SET actual_start=?,actual_end=?,is_absent=0,updated_at=? WHERE id=?",
                (ps, pe, now, entry_id),
            )
            if was_absent:
                _op(conn, entry_id, TIMESHEET_OP_ABSENT_CLEAR, "Снят «не вышел» (факт по плану)", uid, now)
            _op(conn, entry_id, TIMESHEET_OP_FACT_SET, f"Факт по плану: {ps}–{pe}", uid, now)
            filled += 1
        conn.commit()
    return {"message": str(filled)}


@router.put("/timesheet/day-fact")
def day_fact_bulk(body: DayFactBulkRequest, user=Depends(_get_timesheet)):
    """Быстрый ввод факта за один день списком: на каждого сотрудника — факт прихода/ухода
    либо «не вышел». Меняет только факт/невыход/примечание, план не трогает. Зеркало
    `plan/bulk`, но для факта (роль-агностично, как одиночный upsert)."""
    work_date = str(body.work_date or "").strip()
    if not work_date:
        raise HTTPException(status_code=400, detail="Укажите день")
    if work_date > business_today().isoformat():
        raise HTTPException(status_code=400, detail="Нельзя внести факт за ненаступивший день")
    uid = str(user["id"])
    now = _now()
    saved = 0

    def _pair(a, b):
        return f"{a}–{b}" if a and b else "нет"

    with get_connection() as conn:
        for item in body.items:
            emp_id = str(item.employee_id or "").strip()
            if not emp_id:
                continue
            if not conn.execute(
                "SELECT 1 FROM employees WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (emp_id,)
            ).fetchone():
                continue
            absent = 1 if item.is_absent else 0
            fs = None if absent else _time_or_none(item.actual_start, "Факт · приход")
            fe = None if absent else _time_or_none(item.actual_end, "Факт · уход")
            note = _clean(item.note)
            row = conn.execute(
                "SELECT * FROM timesheet_entries "
                "WHERE employee_id = ? AND work_date = ? AND COALESCE(is_deleted, 0) = 0",
                (emp_id, work_date),
            ).fetchone()

            if row is None:
                if not (fs and fe) and not absent and note is None:
                    continue
                entry_id = str(uuid4())
                conn.execute(
                    "INSERT INTO timesheet_entries "
                    "(id,employee_id,work_date,actual_start,actual_end,is_absent,note,created_at,created_by) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (entry_id, emp_id, work_date, fs, fe, absent, note, now, uid),
                )
                if fs and fe:
                    _op(conn, entry_id, TIMESHEET_OP_FACT_SET, f"Факт: {fs}–{fe}", uid, now)
                if absent:
                    _op(conn, entry_id, TIMESHEET_OP_ABSENT_MARK, "Отмечен «не вышел»", uid, now)
                if note:
                    _op(conn, entry_id, TIMESHEET_OP_NOTE, f"Примечание: «{note}»", uid, now)
                saved += 1
            else:
                entry_id = str(row["id"])
                old = dict(row)
                changed = False
                if (fs, fe) != (old.get("actual_start"), old.get("actual_end")):
                    _op(conn, entry_id, TIMESHEET_OP_FACT_SET,
                        f"Факт: {_pair(old.get('actual_start'), old.get('actual_end'))} → {_pair(fs, fe)}", uid, now)
                    changed = True
                if absent != int(old.get("is_absent") or 0):
                    _op(conn, entry_id,
                        TIMESHEET_OP_ABSENT_MARK if absent else TIMESHEET_OP_ABSENT_CLEAR,
                        "Отмечен «не вышел»" if absent else "Снят «не вышел»", uid, now)
                    changed = True
                # Примечание правим только если прислано — пустое не затирает существующее.
                if note is not None and note != old.get("note"):
                    _op(conn, entry_id, TIMESHEET_OP_NOTE, f"Примечание: «{note}»", uid, now)
                    changed = True
                if changed:
                    new_note = note if note is not None else old.get("note")
                    conn.execute(
                        "UPDATE timesheet_entries SET actual_start=?,actual_end=?,is_absent=?,note=?,updated_at=? WHERE id=?",
                        (fs, fe, absent, new_note, now, entry_id),
                    )
                    saved += 1
        conn.commit()
    return {"message": str(saved)}


@router.post("/timesheet/plan/bulk")
def bulk_plan(body: BulkPlanRequest, user=Depends(_get_timesheet)):
    work_date = str(body.work_date or "").strip()
    if not work_date:
        raise HTTPException(status_code=400, detail="Укажите день")
    ps = _time_or_none(body.planned_start, "Приход")
    pe = _time_or_none(body.planned_end, "Уход")
    if not ps or not pe:
        raise HTTPException(status_code=400, detail="Укажите время смены")
    ids = [str(x).strip() for x in body.employee_ids if str(x or "").strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="Не выбрано ни одного сотрудника")
    uid = str(user["id"])
    now = _now()
    planned = 0
    with get_connection() as conn:
        for emp_id in ids:
            if not conn.execute(
                "SELECT 1 FROM employees WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (emp_id,)
            ).fetchone():
                continue
            row = conn.execute(
                "SELECT id FROM timesheet_entries "
                "WHERE employee_id = ? AND work_date = ? AND COALESCE(is_deleted, 0) = 0",
                (emp_id, work_date),
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE timesheet_entries SET planned_start=?,planned_end=?,updated_at=? WHERE id=?",
                    (ps, pe, now, str(row["id"])),
                )
                _op(conn, str(row["id"]), TIMESHEET_OP_PLAN_SET, f"План: {ps}–{pe}", uid, now)
            else:
                entry_id = str(uuid4())
                conn.execute(
                    "INSERT INTO timesheet_entries "
                    "(id,employee_id,work_date,planned_start,planned_end,is_absent,created_at,created_by) "
                    "VALUES (?,?,?,?,?,0,?,?)",
                    (entry_id, emp_id, work_date, ps, pe, now, uid),
                )
                _op(conn, entry_id, TIMESHEET_OP_PLAN_SET, f"План: {ps}–{pe}", uid, now)
            planned += 1
        conn.commit()
    return {"message": str(planned)}


# ── Выплаты / пятничный расчёт ────────────────────────────────────────────────

@router.get("/timesheet/payroll", response_model=PayrollResponse)
def get_payroll(week: str | None = Query(None), user=Depends(_get_payroll)):
    sat = parse_week_param(week)
    with get_connection() as conn:
        data = build_payroll(conn, sat)
    return PayrollResponse(
        week_start=data["week_start"],
        week_end=data["week_end"],
        week_label=data["week_label"],
        rows=[PayrollRow(**r) for r in data["rows"]],
        totals=PayrollTotals(**data["totals"]),
    )


@router.post("/timesheet/payments")
def add_payment(body: PaymentCreate, user=Depends(_get_payroll)):
    kind = str(body.kind or "").strip()
    if kind not in (PAYROLL_KIND_SETTLEMENT, PAYROLL_KIND_ADVANCE):
        raise HTTPException(status_code=400, detail="Тип выплаты: расчёт или аванс")
    period_start = str(body.period_start or "").strip()
    period_end = str(body.period_end or "").strip()
    if not period_start or not period_end:
        raise HTTPException(status_code=400, detail="Укажите расчётную неделю")
    paid_on = _clean(body.paid_on) or business_today().isoformat()
    uid = str(user["id"])
    with get_connection() as conn:
        _emp_or_404(conn, body.employee_id)
        _record_payment(
            conn,
            employee_id=body.employee_id,
            amount=int(body.amount_kopecks),
            kind=kind,
            paid_on=paid_on,
            period_start=period_start,
            period_end=period_end,
            comment=_clean(body.comment),
            uid=uid,
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/timesheet/payroll/settle-all")
def settle_all(body: SettleAllRequest, user=Depends(_get_payroll)):
    sat = parse_week_param(body.week)
    uid = str(user["id"])
    today_iso = business_today().isoformat()
    settled = 0
    with get_connection() as conn:
        data = build_payroll(conn, sat)
        period_start, period_end = data["week_start"], data["week_end"]
        for r in data["rows"]:
            if r["settled"]:
                continue
            _record_payment(
                conn,
                employee_id=r["employee_id"],
                amount=int(r["to_pay"]),
                kind=PAYROLL_KIND_SETTLEMENT,
                paid_on=today_iso,
                period_start=period_start,
                period_end=period_end,
                comment="Пятничный расчёт",
                uid=uid,
            )
            settled += 1
        conn.commit()
    return {"message": str(settled)}
