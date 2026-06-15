from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
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
from security import can_view_payroll, ensure_payroll_access, ensure_timesheet_access

from .schemas import (
    BulkPlanRequest,
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
    accessible_employee_ids,
    build_payroll,
    build_week,
    business_today,
    can_access_employee,
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


def _emp_or_404(conn, emp_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM employees WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (emp_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return dict(row)


def _emp_or_403(conn, user, emp_id: str) -> dict:
    """Сотрудник существует И доступен пользователю по подчинению, иначе 404/403."""
    emp = _emp_or_404(conn, emp_id)
    if not can_access_employee(conn, user, emp_id):
        raise HTTPException(status_code=403, detail="Нет доступа к сотруднику")
    return emp


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
        ids = accessible_employee_ids(conn, user)
        items = list_employees(
            conn, status=status, search=search, with_money=with_money, accessible_ids=ids
        )
    return EmployeeListResponse(
        items=[
            EmployeeListItem(
                id=it["id"],
                full_name=it["full_name"],
                position=it["position"],
                position_id=it.get("position_id"),
                supervisor_user_id=it.get("supervisor_user_id"),
                supervisor_name=it.get("supervisor_name"),
                status=it["status"],
                status_label=EMPLOYEE_STATUS_LABELS.get(it["status"], it["status"]),
                last_shift=it["last_shift"],
                rate_kopecks=it.get("rate_kopecks"),
            )
            for it in items
        ],
        total=len(items),
    )


@router.get("/employees/lookup", response_model=list[EmployeeLookupItem])
def employees_lookup(user=Depends(_get_timesheet)):
    with get_connection() as conn:
        ids = accessible_employee_ids(conn, user)
        conds = ["COALESCE(e.is_deleted, 0) = 0", "e.status = ?"]
        params: list = [EMPLOYEE_STATUS_ACTIVE]
        if ids is not None:
            if not ids:
                return []
            conds.append(f"e.id IN ({','.join('?' for _ in ids)})")
            params += ids
        rows = conn.execute(
            f"SELECT e.id, e.full_name, COALESCE(p.name, e.position) AS position "
            f"FROM employees e LEFT JOIN positions p ON p.id = e.position_id "
            f"WHERE {' AND '.join(conds)} ORDER BY e.full_name",
            params,
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


def _validate_supervisor(conn, supervisor_user_id: str | None) -> str | None:
    sup = _clean(supervisor_user_id)
    if sup is None:
        return None
    if not conn.execute(
        "SELECT 1 FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (sup,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Руководитель не найден")
    return sup


@router.post("/employees")
def create_employee(body: EmployeeCreate, user=Depends(_get_timesheet)):
    full_name = str(body.full_name or "").strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите ФИО сотрудника")
    uid = str(user["id"])
    now = _now()
    emp_id = str(uuid4())
    with get_connection() as conn:
        position_id = _validate_position(conn, body.position_id)
        # Подчинение и связь с учёткой назначает только администратор.
        user_link = _validate_user_link(conn, body.user_id) if _is_admin(user) else None
        supervisor = _validate_supervisor(conn, body.supervisor_user_id) if _is_admin(user) else None
        conn.execute(
            "INSERT INTO employees "
            "(id,full_name,position_id,user_id,supervisor_user_id,status,hired_on,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (emp_id, full_name, position_id, user_link, supervisor, EMPLOYEE_STATUS_ACTIVE,
             _clean(body.hired_on), now, uid),
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
        emp = _emp_or_403(conn, user, emp_id)
        meta = conn.execute(
            "SELECT COALESCE(p.name, e.position) AS position_name, "
            "       su.email AS supervisor_name, lu.email AS user_email "
            "FROM employees e "
            "LEFT JOIN positions p ON p.id = e.position_id "
            "LEFT JOIN users su ON su.id = e.supervisor_user_id "
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
        supervisor_user_id=emp.get("supervisor_user_id"),
        supervisor_name=meta["supervisor_name"] if meta else None,
        status=status,
        status_label=EMPLOYEE_STATUS_LABELS.get(status, status),
        hired_on=emp["hired_on"],
        rate_kopecks=current_rate(rates) if with_money else None,
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
        _emp_or_403(conn, user, emp_id)
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
        # Подчинение и связь с учёткой меняет только администратор.
        if "user_id" in fields and _is_admin(user):
            sets.append("user_id = ?"); params.append(_validate_user_link(conn, body.user_id, emp_id))
        if "supervisor_user_id" in fields and _is_admin(user):
            sets.append("supervisor_user_id = ?"); params.append(_validate_supervisor(conn, body.supervisor_user_id))
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
        _emp_or_403(conn, user, emp_id)
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
        _emp_or_403(conn, user, emp_id)
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
        _emp_or_403(conn, user, emp_id)
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
        ids = accessible_employee_ids(conn, user)
        data = build_week(conn, sat, with_money=can_view_payroll(user), accessible_ids=ids)
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
        emp = _emp_or_403(conn, user, employee_id)
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
        _emp_or_403(conn, user, body.employee_id)
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
def fill_fact(body: SettleAllRequest, user=Depends(_get_timesheet)):
    """Массово проставить факт = плану там, где день запланирован и факта ещё нет.
    Невыходы и уже заполненные дни не трогаются."""
    sat = parse_week_param(body.week)
    days = week_days(sat)
    today_iso = business_today().isoformat()
    uid = str(user["id"])
    now = _now()
    filled = 0
    with get_connection() as conn:
        ids = accessible_employee_ids(conn, user)
        allowed = None if ids is None else set(ids)
        entries = load_entries_range(conn, days[0].isoformat(), days[-1].isoformat())
        for (emp_id, day_iso), entry in entries.items():
            if allowed is not None and emp_id not in allowed:  # чужие сотрудники не трогаем
                continue
            if day_iso > today_iso:  # факт за ненаступивший день не проставляем
                continue
            if day_status(entry, day_iso, today_iso) != TIMESHEET_DAY_PLANNED:
                continue
            ps, pe = entry.get("planned_start"), entry.get("planned_end")
            conn.execute(
                "UPDATE timesheet_entries SET actual_start=?,actual_end=?,updated_at=? WHERE id=?",
                (ps, pe, now, str(entry["id"])),
            )
            _op(conn, str(entry["id"]), TIMESHEET_OP_FACT_SET, f"Факт по плану: {ps}–{pe}", uid, now)
            filled += 1
        conn.commit()
    return {"message": str(filled)}


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
        acc = accessible_employee_ids(conn, user)
        allowed = None if acc is None else set(acc)
        for emp_id in ids:
            if allowed is not None and emp_id not in allowed:  # чужих не планируем
                continue
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
        ids = accessible_employee_ids(conn, user)
        data = build_payroll(conn, sat, ids)
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
    now = _now()
    with get_connection() as conn:
        _emp_or_403(conn, user, body.employee_id)
        conn.execute(
            "INSERT INTO payroll_payments "
            "(id,employee_id,amount_kopecks,kind,paid_on,period_start,period_end,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (str(uuid4()), body.employee_id, int(body.amount_kopecks), kind, paid_on,
             period_start, period_end, _clean(body.comment), now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/timesheet/payroll/settle-all")
def settle_all(body: SettleAllRequest, user=Depends(_get_payroll)):
    sat = parse_week_param(body.week)
    uid = str(user["id"])
    now = _now()
    today_iso = business_today().isoformat()
    settled = 0
    with get_connection() as conn:
        ids = accessible_employee_ids(conn, user)
        data = build_payroll(conn, sat, ids)
        period_start, period_end = data["week_start"], data["week_end"]
        for r in data["rows"]:
            if r["settled"]:
                continue
            conn.execute(
                "INSERT INTO payroll_payments "
                "(id,employee_id,amount_kopecks,kind,paid_on,period_start,period_end,comment,created_at,created_by) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (str(uuid4()), r["employee_id"], int(r["to_pay"]), PAYROLL_KIND_SETTLEMENT,
                 today_iso, period_start, period_end, "Пятничный расчёт", now, uid),
            )
            settled += 1
        conn.commit()
    return {"message": str(settled)}
