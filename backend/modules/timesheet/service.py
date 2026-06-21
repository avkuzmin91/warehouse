"""Чистая логика табеля: формулы часов/заработка, недельные границы, сборка
сетки недели, пятничного расчёта и карточки сотрудника.

Деньги — в копейках (INTEGER). Часы за день = (уход − приход) − 1 ч обед.
Расчётная неделя — Суббота → Пятница (день выплат — пятница). Заработок считается
по ставке, действовавшей в конкретный день (effective-dated employee_rates).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from config import (
    EMPLOYEE_STATUS_ACTIVE,
    PAYROLL_KIND_ADVANCE,
    PAYROLL_KIND_SETTLEMENT,
    TIMESHEET_DAY_ABSENT,
    TIMESHEET_DAY_NOPLAN,
    TIMESHEET_DAY_NOT_CALLED,
    TIMESHEET_DAY_OFF,
    TIMESHEET_DAY_PLANNED,
    TIMESHEET_DAY_WORKED,
    TIMESHEET_LUNCH_HOURS,
)
from dbconn import like_substring_param

RU_MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
RU_DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]  # date.weekday(): Mon=0..Sun=6


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def business_today() -> date:
    """Сегодня по бизнес-зоне (контейнеру задаётся TZ=Europe/Moscow)."""
    return date.today()


# ── Часы ─────────────────────────────────────────────────────────────────────

def _to_min(t: str | None) -> int | None:
    if not t:
        return None
    try:
        h, m = str(t).split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def day_hours(
    start: str | None,
    end: str | None,
    *,
    lunch: bool = True,
    end_next_day: bool = False,
) -> float:
    """Часы за день = (уход − приход) − 1 ч обед.

    `end_next_day` — смена закончилась на следующий день (08:00 → 02:00): к уходу
    добавляем +24 ч. `lunch=False` — вышел без обеда, час не вычитаем (и короткий
    день не обнуляем, ведь обнуление существует только чтобы вычет обеда не уходил
    в минус). На коротком дне с обедом зачёт 0, а не минус (как в дизайне)."""
    a, b = _to_min(start), _to_min(end)
    if a is None or b is None:
        return 0.0
    if end_next_day:
        b += 24 * 60
    gross = (b - a) / 60.0
    if gross <= 0:
        return 0.0
    if not lunch:
        net = gross
    else:
        net = gross - TIMESHEET_LUNCH_HOURS if gross > TIMESHEET_LUNCH_HOURS else 0.0
    return max(0.0, round(net, 2))


# ── Неделя Сб → Пт ───────────────────────────────────────────────────────────

def week_start_for(ref: date) -> date:
    """Суббота расчётной недели, в которую попадает дата ref.
    weekday(): Mon=0 … Sat=5, Sun=6 → сдвиг к ближайшей прошедшей субботе."""
    return ref - timedelta(days=(ref.weekday() - 5) % 7)


def parse_week_param(raw: str | None) -> date:
    """`?week=YYYY-MM-DD` → суббота этой недели; пусто/мусор → текущая неделя."""
    if raw:
        try:
            return week_start_for(date.fromisoformat(str(raw).strip()))
        except ValueError:
            pass
    return week_start_for(business_today())


def week_days(sat: date) -> list[date]:
    return [sat + timedelta(days=i) for i in range(7)]


def fmt_dom(d: date) -> str:
    return f"{d.day:02d}"


def fmt_date_ru(d: date) -> str:
    return f"{d.day:02d} {RU_MON[d.month - 1]}"


def fmt_full_ru(d: date) -> str:
    return f"{d.day} {RU_MON[d.month - 1]} {d.year}"


def dow_ru(d: date) -> str:
    return RU_DOW[d.weekday()]


def is_weekend(d: date) -> bool:
    return d.weekday() == 6  # Вс (Сб — рабочий)


# ── Ставки (effective-dated) ─────────────────────────────────────────────────

def load_rates(connection, employee_ids: list[str] | None = None) -> dict[str, list[dict]]:
    """employee_id → список ставок, отсортированный по дате убыв. (свежая первой)."""
    if employee_ids is not None and not employee_ids:
        return {}
    sql = (
        "SELECT employee_id, rate_kopecks, effective_from, note "
        "FROM employee_rates WHERE COALESCE(is_deleted, 0) = 0"
    )
    params: list = []
    if employee_ids:
        sql += f" AND employee_id IN ({','.join('?' for _ in employee_ids)})"
        params += employee_ids
    sql += " ORDER BY employee_id, effective_from DESC, created_at DESC"
    out: dict[str, list[dict]] = {}
    for r in connection.execute(sql, params).fetchall():
        out.setdefault(str(r["employee_id"]), []).append(
            {
                "rate_kopecks": int(r["rate_kopecks"]),
                "effective_from": str(r["effective_from"]),
                "note": r["note"],
            }
        )
    return out


def rate_on(rates_desc: list[dict] | None, day_iso: str) -> int | None:
    """Ставка, действовавшая на дату: последняя запись с effective_from <= day.

    Дни до самой ранней ставки оплачиваются по этой ранней ставке (тянем назад), а
    не нулём — иначе часы, отработанные до того, как ставку завели, не заработали бы.
    Повышения (новая ставка с более поздней датой) работают как обычно. Сравнение —
    по дате: effective_from может прийти с временем, берём первые 10 символов, иначе
    ставка не применилась бы в свой же первый день."""
    if not rates_desc:
        return None
    day = day_iso[:10]
    for r in rates_desc:  # отсортированы по убыванию effective_from
        if str(r["effective_from"])[:10] <= day:
            return int(r["rate_kopecks"])
    return int(rates_desc[-1]["rate_kopecks"])  # самая ранняя ставка — назад


def current_rate(rates_desc: list[dict] | None) -> int | None:
    return rate_on(rates_desc, business_today().isoformat())


# ── Статус дня и часы по записи ───────────────────────────────────────────────

def _has_plan(entry: dict) -> bool:
    return bool(entry.get("planned_start") and entry.get("planned_end"))


def _has_fact(entry: dict) -> bool:
    return bool(entry.get("actual_start") and entry.get("actual_end"))


def day_status(entry: dict | None, day_iso: str, today_iso: str) -> str:
    if not entry:
        return TIMESHEET_DAY_OFF
    if int(entry.get("not_called") or 0) == 1:
        return TIMESHEET_DAY_NOT_CALLED
    if int(entry.get("is_absent") or 0) == 1:
        return TIMESHEET_DAY_ABSENT
    if _has_fact(entry):
        return TIMESHEET_DAY_WORKED if _has_plan(entry) else TIMESHEET_DAY_NOPLAN
    if _has_plan(entry):
        return TIMESHEET_DAY_ABSENT if day_iso < today_iso else TIMESHEET_DAY_PLANNED
    return TIMESHEET_DAY_OFF


def entry_hours(entry: dict | None) -> float:
    if entry and _has_fact(entry):
        return day_hours(
            entry["actual_start"],
            entry["actual_end"],
            lunch=int(entry.get("no_lunch") or 0) == 0,
            end_next_day=int(entry.get("end_next_day") or 0) == 1,
        )
    return 0.0


# ── Загрузчики ────────────────────────────────────────────────────────────────

def load_week_employees(connection, sat_iso: str, fri_iso: str) -> list[dict]:
    """Сотрудники, относящиеся к расчётной неделе [sat..fri] (для сетки и расчёта).

    Сотрудник попадает в неделю, если выполнено хотя бы одно:
    - он активен и принят на работу не позже конца недели — новичок появляется
      с момента приёма (по hired_on, иначе по дате создания), а не задним числом;
    - за эту неделю по нему есть запись табеля;
    - за эту неделю по нему есть выплата.

    Два последних условия держат историю: архивный сотрудник остаётся в неделях,
    где он работал или получал выплаты (суммы сходятся), но пропадает из текущих и
    будущих недель, где данных по нему уже нет."""
    rows = connection.execute(
        "SELECT e.id, e.full_name, COALESCE(p.name, e.position) AS position, e.status "
        "FROM employees e LEFT JOIN positions p ON p.id = e.position_id "
        "WHERE COALESCE(e.is_deleted, 0) = 0 AND ("
        "  (e.status = ? AND COALESCE(e.hired_on, SUBSTR(e.created_at, 1, 10)) <= ?)"
        "  OR EXISTS (SELECT 1 FROM timesheet_entries t "
        "             WHERE t.employee_id = e.id AND COALESCE(t.is_deleted, 0) = 0 "
        "               AND t.work_date >= ? AND t.work_date <= ?)"
        "  OR EXISTS (SELECT 1 FROM payroll_payments pp "
        "             WHERE pp.employee_id = e.id AND COALESCE(pp.is_deleted, 0) = 0 "
        "               AND pp.period_start = ? AND pp.period_end = ?)"
        ") "
        "ORDER BY (e.status = ?) DESC, e.full_name",
        (EMPLOYEE_STATUS_ACTIVE, fri_iso, sat_iso, fri_iso,
         sat_iso, fri_iso, EMPLOYEE_STATUS_ACTIVE),
    ).fetchall()
    return [
        {"id": str(r["id"]), "full_name": str(r["full_name"]),
         "position": r["position"], "status": str(r["status"])}
        for r in rows
    ]


def load_entries_range(connection, start_iso: str, end_iso: str) -> dict[tuple[str, str], dict]:
    """(employee_id, work_date) → запись табеля за диапазон дат включительно."""
    rows = connection.execute(
        "SELECT * FROM timesheet_entries "
        "WHERE COALESCE(is_deleted, 0) = 0 AND work_date >= ? AND work_date <= ?",
        (start_iso, end_iso),
    ).fetchall()
    return {(str(r["employee_id"]), str(r["work_date"])): dict(r) for r in rows}


def load_payments_period(connection, start_iso: str, end_iso: str) -> dict[str, list[dict]]:
    """employee_id → выплаты с period_start = субботой недели (Сб→Пт)."""
    rows = connection.execute(
        "SELECT * FROM payroll_payments "
        "WHERE COALESCE(is_deleted, 0) = 0 AND period_start = ? AND period_end = ?",
        (start_iso, end_iso),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["employee_id"]), []).append(dict(r))
    return out


# ── Закрытие недели расчётом (блокировка факта) ───────────────────────────────

def settled_employee_ids(connection, week_start_iso: str, week_end_iso: str) -> set[str]:
    """ID сотрудников, по которым за расчётную неделю уже проведён расчёт (settlement).
    Факт за такую неделю менять нельзя — суммы посчитаны и выплачены."""
    rows = connection.execute(
        "SELECT DISTINCT employee_id FROM payroll_payments "
        "WHERE kind = ? AND COALESCE(is_deleted, 0) = 0 "
        "AND period_start = ? AND period_end = ?",
        (PAYROLL_KIND_SETTLEMENT, week_start_iso, week_end_iso),
    ).fetchall()
    return {str(r["employee_id"]) for r in rows}


def settled_ids_for_date(connection, work_date: str) -> set[str]:
    """ID сотрудников с проведённым расчётом за расчётную неделю, в которую попадает день."""
    try:
        d = date.fromisoformat(work_date[:10])
    except ValueError:
        return set()
    sat = week_start_for(d)
    fri = sat + timedelta(days=6)
    return settled_employee_ids(connection, sat.isoformat(), fri.isoformat())


def is_fact_locked(connection, employee_id: str, work_date: str) -> bool:
    """Факт за день закрыт, если по расчётной неделе этого дня уже проведён расчёт."""
    return employee_id in settled_ids_for_date(connection, work_date)


# ── Производные числа за неделю по сотруднику ─────────────────────────────────

def week_stats(
    employee_id: str,
    days: list[date],
    entries: dict[tuple[str, str], dict],
    rates_desc: list[dict] | None,
    today_iso: str,
    payments: list[dict] | None = None,
) -> dict:
    hours = 0.0
    earned = 0
    worked_days = 0
    absent = 0
    noplan = 0
    for d in days:
        day_iso = d.isoformat()
        entry = entries.get((employee_id, day_iso))
        st = day_status(entry, day_iso, today_iso)
        if st in (TIMESHEET_DAY_WORKED, TIMESHEET_DAY_NOPLAN):
            h = entry_hours(entry)
            hours += h
            worked_days += 1
            r = rate_on(rates_desc, day_iso)
            if r is not None:
                earned += round(h * r)
        if st == TIMESHEET_DAY_ABSENT:
            absent += 1
        if st == TIMESHEET_DAY_NOPLAN:
            noplan += 1
    advances = sum(
        int(p["amount_kopecks"]) for p in (payments or [])
        if str(p["kind"]) == PAYROLL_KIND_ADVANCE
    )
    settled = any(str(p["kind"]) == PAYROLL_KIND_SETTLEMENT for p in (payments or []))
    to_pay = max(0, earned - advances)
    return {
        "hours": round(hours, 1),
        "earned": earned,
        "worked_days": worked_days,
        "absent": absent,
        "noplan": noplan,
        "advances": advances,
        "to_pay": to_pay,
        "overpaid": max(0, advances - earned),
        "settled": settled,
    }


# ── Сборка сетки недели ───────────────────────────────────────────────────────

def build_week(connection, sat: date, *, with_money: bool) -> dict:
    days = week_days(sat)
    fri = days[-1]
    today = business_today()
    today_iso = today.isoformat()

    employees = load_week_employees(connection, sat.isoformat(), fri.isoformat())
    emp_ids = [e["id"] for e in employees]
    entries = load_entries_range(connection, sat.isoformat(), fri.isoformat())
    rates = load_rates(connection, emp_ids) if with_money else {}
    settled = settled_employee_ids(connection, sat.isoformat(), fri.isoformat())

    day_meta = [
        {
            "date": d.isoformat(),
            "dow": dow_ru(d),
            "dom": fmt_dom(d),
            "date_ru": fmt_date_ru(d),
            "weekend": is_weekend(d),
            "is_today": d == today,
        }
        for d in days
    ]

    rows: list[dict] = []
    per_day = [0.0] * 7
    tot_hours = 0.0
    tot_earned = 0
    tot_absent = 0

    for e in employees:
        cells: list[dict] = []
        for i, d in enumerate(days):
            day_iso = d.isoformat()
            entry = entries.get((e["id"], day_iso))
            st = day_status(entry, day_iso, today_iso)
            h = entry_hours(entry)
            per_day[i] += h
            cell = {
                "date": day_iso,
                "status": st,
                "planned_start": entry.get("planned_start") if entry else None,
                "planned_end": entry.get("planned_end") if entry else None,
                "actual_start": entry.get("actual_start") if entry else None,
                "actual_end": entry.get("actual_end") if entry else None,
                "is_absent": bool(int(entry.get("is_absent") or 0)) if entry else False,
                "not_called": bool(int(entry.get("not_called") or 0)) if entry else False,
                "no_lunch": bool(int(entry.get("no_lunch") or 0)) if entry else False,
                "end_next_day": bool(int(entry.get("end_next_day") or 0)) if entry else False,
                "hours": round(h, 1),
                "note": entry.get("note") if entry else None,
            }
            cells.append(cell)
        s = week_stats(e["id"], days, entries, rates.get(e["id"]), today_iso)
        tot_hours += s["hours"]
        tot_earned += s["earned"]
        tot_absent += s["absent"]
        row = {
            "employee_id": e["id"],
            "full_name": e["full_name"],
            "position": e["position"],
            "cells": cells,
            "hours": s["hours"],
            "worked_days": s["worked_days"],
            "absent": s["absent"],
            "earned": s["earned"] if with_money else None,
            "fact_locked": e["id"] in settled,
            "archived": e["status"] != EMPLOYEE_STATUS_ACTIVE,
        }
        rows.append(row)

    return {
        "week_start": sat.isoformat(),
        "week_end": fri.isoformat(),
        "week_label": f"{fmt_date_ru(sat)} — {fmt_date_ru(fri)} {fri.year}",
        "today": today_iso,
        "with_money": with_money,
        "days": day_meta,
        "rows": rows,
        "totals": {
            "hours": round(tot_hours, 1),
            "earned": tot_earned if with_money else None,
            "absent": tot_absent,
            "per_day": [round(x, 1) for x in per_day],
            "employees": len(employees),
        },
    }


# ── Пятничный расчёт ──────────────────────────────────────────────────────────

def build_payroll(connection, sat: date) -> dict:
    days = week_days(sat)
    fri = days[-1]
    today_iso = business_today().isoformat()

    employees = load_week_employees(connection, sat.isoformat(), fri.isoformat())
    emp_ids = [e["id"] for e in employees]
    entries = load_entries_range(connection, sat.isoformat(), fri.isoformat())
    rates = load_rates(connection, emp_ids)
    payments = load_payments_period(connection, sat.isoformat(), fri.isoformat())

    rows: list[dict] = []
    t_earned = t_adv = t_pay = 0
    left = 0
    for e in employees:
        s = week_stats(
            e["id"], days, entries, rates.get(e["id"]), today_iso, payments.get(e["id"])
        )
        cur = current_rate(rates.get(e["id"]))
        t_earned += s["earned"]
        t_adv += s["advances"]
        t_pay += s["to_pay"]
        if not s["settled"]:
            left += 1
        rows.append({
            "employee_id": e["id"],
            "full_name": e["full_name"],
            "position": e["position"],
            "rate_kopecks": cur,
            "hours": s["hours"],
            "earned": s["earned"],
            "advances": s["advances"],
            "to_pay": s["to_pay"],
            "overpaid": s["overpaid"],
            "settled": s["settled"],
            "archived": e["status"] != EMPLOYEE_STATUS_ACTIVE,
        })

    return {
        "week_start": sat.isoformat(),
        "week_end": fri.isoformat(),
        "week_label": f"{fmt_date_ru(sat)} — {fmt_date_ru(fri)} {fri.year}",
        "rows": rows,
        "totals": {
            "earned": t_earned,
            "advances": t_adv,
            "to_pay": t_pay,
            "employees": len(employees),
            "left": left,
        },
    }


# ── Посещаемость карточки: 4 недели Сб→Пт + итоги за всё время ────────────────

ATTENDANCE_WEEKS = 4


def late_minutes(entry: dict | None) -> int:
    """Опоздание в минутах = факт. приход − плановый приход (если позже плана).
    Имеет смысл только когда есть и план, и факт; иначе 0."""
    if not entry:
        return 0
    planned, actual = _to_min(entry.get("planned_start")), _to_min(entry.get("actual_start"))
    if planned is None or actual is None:
        return 0
    return max(0, actual - planned)


def _att_status(entry: dict | None, day_iso: str, today_iso: str, hired: str) -> str:
    """Статус ячейки тепловой карты. Дни до приёма и будущие дни — отдельные
    немые статусы (prehire/future), остальное — обычный day_status."""
    if hired and day_iso < hired:
        return "prehire"
    if day_iso > today_iso:
        return "future"
    return day_status(entry, day_iso, today_iso)


def attendance_alltime(connection, employee_id: str, today_iso: str) -> dict:
    """Смены / внеплановые выходы / прогулы за всё время работы сотрудника."""
    rows = connection.execute(
        "SELECT * FROM timesheet_entries "
        "WHERE employee_id = ? AND COALESCE(is_deleted, 0) = 0 AND work_date <= ?",
        (employee_id, today_iso),
    ).fetchall()
    shifts = noplan = absent = 0
    for r in rows:
        entry = dict(r)
        st = day_status(entry, str(r["work_date"]), today_iso)
        if st in (TIMESHEET_DAY_WORKED, TIMESHEET_DAY_NOPLAN):
            shifts += 1
        if st == TIMESHEET_DAY_NOPLAN:
            noplan += 1
        if st == TIMESHEET_DAY_ABSENT:
            absent += 1
    return {"shifts": shifts, "noplan": noplan, "absent": absent}


def build_attendance(connection, employee_id: str, hired_on: str | None) -> dict:
    """Тепловая карта посещаемости: всегда последние 4 расчётные недели Сб→Пт
    (включая текущую), плюс итоги за показанный период и за всё время."""
    today = business_today()
    today_iso = today.isoformat()
    cur_sat = week_start_for(today)
    start_sat = cur_sat - timedelta(weeks=ATTENDANCE_WEEKS - 1)
    fri = cur_sat + timedelta(days=6)
    days = [start_sat + timedelta(days=i) for i in range(ATTENDANCE_WEEKS * 7)]
    entries = load_entries_range(connection, start_sat.isoformat(), fri.isoformat())
    hired = (hired_on or "")[:10]

    cells: list[dict] = []
    shifts = noplan = absent = 0
    hours = 0.0
    for d in days:
        day_iso = d.isoformat()
        entry = entries.get((employee_id, day_iso))
        st = _att_status(entry, day_iso, today_iso, hired)
        h = entry_hours(entry)
        if st in (TIMESHEET_DAY_WORKED, TIMESHEET_DAY_NOPLAN):
            shifts += 1
            hours += h
        if st == TIMESHEET_DAY_NOPLAN:
            noplan += 1
        if st == TIMESHEET_DAY_ABSENT:
            absent += 1
        cells.append({
            "date": day_iso,
            "dom": d.day,
            "weekend": is_weekend(d),
            "status": st,
            "hours": round(h, 1),
            "late_minutes": late_minutes(entry) if st == TIMESHEET_DAY_WORKED else 0,
        })

    return {
        "range_label": f"{fmt_date_ru(start_sat)} — {fmt_date_ru(fri)} {fri.year}",
        "days": cells,
        "stats": {
            "shifts": shifts,
            "noplan": noplan,
            "absent": absent,
            "hours": round(hours, 1),
        },
        "alltime": attendance_alltime(connection, employee_id, today_iso),
    }


# ── Сотрудники: список ────────────────────────────────────────────────────────

def list_employees(
    connection, *, status: str | None, search: str | None, with_money: bool,
) -> list[dict]:
    conds = ["COALESCE(e.is_deleted, 0) = 0"]
    params: list = []
    if status in (EMPLOYEE_STATUS_ACTIVE, "archived"):
        conds.append("e.status = ?")
        params.append(status)
    if search:
        s = like_substring_param(search)
        conds.append("(e.full_name LIKE ? OR COALESCE(p.name, e.position) LIKE ?)")
        params += [s, s]
    where = " AND ".join(conds)
    rows = connection.execute(
        f"""
        SELECT e.id, e.full_name, COALESCE(p.name, e.position) AS position, e.position_id,
               e.status, e.comp_type, e.fixed_salary_kopecks,
               (SELECT MAX(t.work_date) FROM timesheet_entries t
                WHERE t.employee_id = e.id AND COALESCE(t.is_deleted, 0) = 0
                  AND t.actual_start IS NOT NULL) AS last_shift
        FROM employees e
        LEFT JOIN positions p ON p.id = e.position_id
        WHERE {where}
        ORDER BY (e.status = '{EMPLOYEE_STATUS_ACTIVE}') DESC, e.full_name
        """,
        params,
    ).fetchall()
    rates = load_rates(connection, [str(r["id"]) for r in rows]) if with_money else {}
    out: list[dict] = []
    for r in rows:
        item = {
            "id": str(r["id"]),
            "full_name": str(r["full_name"]),
            "position": r["position"],
            "position_id": r["position_id"],
            "status": str(r["status"]),
            "last_shift": r["last_shift"],
            "comp_type": str(r["comp_type"] or "hourly"),
        }
        if with_money:
            item["rate_kopecks"] = current_rate(rates.get(str(r["id"])))
            item["fixed_salary_kopecks"] = (
                int(r["fixed_salary_kopecks"]) if r["fixed_salary_kopecks"] is not None else None
            )
        out.append(item)
    return out
