"""Производственный календарь + дневная разбивка оклада по рабочим дням."""
from __future__ import annotations

import calendar
import uuid
from datetime import date

from dbconn import get_connection
from modules.expenses.service import _fixed_month_accrual
from modules.production_calendar.service import (
    bulk_apply,
    delete_day,
    is_working_day,
    list_year,
    set_day,
    working_days_of_month,
)


def _first_sunday(year: int, month: int) -> date:
    for d in range(1, calendar.monthrange(year, month)[1] + 1):
        dt = date(year, month, d)
        if dt.weekday() == 6:
            return dt
    raise AssertionError("в месяце нет воскресенья")


def _first_weekday_non_sunday(year: int, month: int) -> date:
    for d in range(1, calendar.monthrange(year, month)[1] + 1):
        dt = date(year, month, d)
        if dt.weekday() != 6:
            return dt
    raise AssertionError


def test_default_6x1_rule():
    """Дефолт: рабочий = любой день, кроме воскресенья (без записей календаря)."""
    with get_connection() as conn:
        wd = working_days_of_month(conn, 2099, 6)
        # Все рабочие дни — не воскресенья.
        assert all(d.weekday() != 6 for d in wd)
        # Каждое воскресенье месяца отсутствует в списке.
        sundays = [date(2099, 6, d) for d in range(1, 31) if date(2099, 6, d).weekday() == 6]
        for s in sundays:
            assert s not in wd
        assert is_working_day(conn, _first_weekday_non_sunday(2099, 6)) is True
        assert is_working_day(conn, _first_sunday(2099, 6)) is False


def test_overrides_both_directions():
    """Исключение перебивает дефолт в обе стороны: воскресенье→рабочее, будни→выходной."""
    sun = _first_sunday(2099, 7)
    mon = _first_weekday_non_sunday(2099, 7)
    try:
        with get_connection() as conn:
            base = len(working_days_of_month(conn, 2099, 7))

            # Воскресенье делаем рабочим → +1 рабочий день.
            set_day(conn, cal_date=sun.isoformat(), is_working=True, reason="Субботник", uid=None)
            conn.commit()
            assert is_working_day(conn, sun) is True
            assert len(working_days_of_month(conn, 2099, 7)) == base + 1

            # Будний день делаем нерабочим (праздник) → возвращаемся к base.
            set_day(conn, cal_date=mon.isoformat(), is_working=False, reason="Праздник", uid=None)
            conn.commit()
            assert is_working_day(conn, mon) is False
            assert len(working_days_of_month(conn, 2099, 7)) == base
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM production_calendar WHERE cal_date IN (?, ?)",
                         (sun.isoformat(), mon.isoformat()))
            conn.commit()


def test_list_year_sums_and_groups():
    """Год: сумма рабочих дней по месяцам = годовому итогу; исключение в нужном месяце."""
    day = "2098-03-15"
    try:
        with get_connection() as conn:
            set_day(conn, cal_date=day, is_working=False, reason="Учёт", uid=None)
            conn.commit()
            data = list_year(conn, 2098)

        assert len(data["months"]) == 12
        assert sum(m["working_days"] for m in data["months"]) == data["working_days"]
        march = next(m for m in data["months"] if m["month"] == 3)
        assert day in {i["cal_date"] for i in march["items"]}
        # Исключение не утекает в другие месяцы.
        assert all(
            day not in {i["cal_date"] for i in m["items"]}
            for m in data["months"] if m["month"] != 3
        )
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM production_calendar WHERE cal_date = ?", (day,))
            conn.commit()


def test_bulk_apply_modes():
    """bulk_apply: nonworking уменьшает рабочие дни; working создаёт worksun / снимает исключение."""
    mon1 = _first_weekday_non_sunday(2098, 9)
    mon2 = next(
        date(2098, 9, d) for d in range(mon1.day + 1, 31)
        if date(2098, 9, d).weekday() not in (5, 6)
    )
    sun = _first_sunday(2098, 9)
    dates = [mon1.isoformat(), mon2.isoformat()]
    try:
        with get_connection() as conn:
            base = len(working_days_of_month(conn, 2098, 9))

            # nonworking: два будних → нерабочими, рабочих дней -2.
            bulk_apply(conn, dates=dates, mode="nonworking", reason="Майские", uid=None)
            conn.commit()
            assert len(working_days_of_month(conn, 2098, 9)) == base - 2
            assert is_working_day(conn, mon1) is False

            # working: будни с исключением → снимает (возврат к base), воскресенье → доп. смена (+1).
            bulk_apply(conn, dates=[*dates, sun.isoformat()], mode="working", reason="Смена", uid=None)
            conn.commit()
            assert is_working_day(conn, mon1) is True
            assert is_working_day(conn, sun) is True
            assert len(working_days_of_month(conn, 2098, 9)) == base + 1
    finally:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM production_calendar WHERE cal_date IN (?, ?, ?)",
                (mon1.isoformat(), mon2.isoformat(), sun.isoformat()),
            )
            conn.commit()


def test_calendar_crud_endpoints(admin_client, shift_supervisor_client):
    day = "2099-08-12"
    try:
        # Начальник смены не управляет календарём (менеджерский состав only).
        assert shift_supervisor_client.post("/production-calendar",
                                            json={"cal_date": day, "is_working": False}).status_code == 403

        base = admin_client.get("/production-calendar?year=2099&month=8").json()["working_days"]
        r = admin_client.post("/production-calendar",
                              json={"cal_date": day, "is_working": False, "reason": "Закрытие"})
        assert r.status_code == 200, r.text

        got = admin_client.get("/production-calendar?year=2099&month=8").json()
        assert got["working_days"] == base - 1
        items = {i["cal_date"]: i for i in got["items"]}
        assert items[day]["is_working"] is False and items[day]["reason"] == "Закрытие"

        # Снятие исключения возвращает день к правилу 6/1.
        assert admin_client.delete(f"/production-calendar/{day}").status_code == 200
        back = admin_client.get("/production-calendar?year=2099&month=8").json()
        assert back["working_days"] == base
        assert day not in {i["cal_date"] for i in back["items"]}
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM production_calendar WHERE cal_date = ?", (day,))
            conn.commit()


def test_fixed_month_accrual_sums_to_salary_and_prorates():
    with get_connection() as conn:
        # Полный месяц = оклад точно (независимо от числа рабочих дней).
        full = _fixed_month_accrual(conn, [{"salary_kopecks": 100000, "effective_from": "2099-06-01"}], 2099, 6)
        assert full == 100000

        # Старт оклада в середине месяца прорастает в пропорцию: 0 < доля < полный оклад.
        wd = working_days_of_month(conn, 2099, 6)
        mid_day = wd[len(wd) // 2]
        partial = _fixed_month_accrual(
            conn, [{"salary_kopecks": 100000, "effective_from": mid_day.isoformat()}], 2099, 6
        )
        assert 0 < partial < 100000

        # Доли «до» и «с» серединного дня в сумме дают полный оклад (без потери копеек).
        before = sum(
            (100000 // len(wd)) + (1 if idx < 100000 % len(wd) else 0)
            for idx, d in enumerate(wd) if d < mid_day
        )
        assert before + partial == 100000


def test_salary_accrual_prorated_for_midmonth_hire(admin_client):
    tag = uuid.uuid4().hex[:8]
    emp = admin_client.post("/employees", json={
        "full_name": f"Серединка-{tag}", "comp_type": "fixed", "fixed_salary_kopecks": 100000,
        "hired_on": "2099-06-16",
    })
    assert emp.status_code == 200, emp.text
    emp_id = emp.json()["message"]
    try:
        with get_connection() as conn:
            expected = _fixed_month_accrual(
                conn, [{"salary_kopecks": 100000, "effective_from": "2099-06-16"}], 2099, 6
            )

        # До выхода (1-е число) — не начисляем.
        admin_client.post("/expenses/salary/accruals/run?on_date=2099-06-01")
        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        assert not [e for e in items if e.get("source_id") == emp_id]

        # В день выхода (16-е) — одна проводка на пропорциональную сумму.
        admin_client.post("/expenses/salary/accruals/run?on_date=2099-06-16")
        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == emp_id and e["period_start"] == "2099-06-01"]
        assert len(mine) == 1
        assert mine[0]["amount"] == expected
        assert 0 < expected < 100000
    finally:
        with get_connection() as conn:
            eids = [r["id"] for r in conn.execute(
                "SELECT id FROM material_expenses WHERE source_kind='employee' AND source_id=?",
                (emp_id,),
            ).fetchall()]
            for eid in eids:
                conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
            conn.execute("DELETE FROM material_expenses WHERE source_kind='employee' AND source_id=?", (emp_id,))
            conn.execute("DELETE FROM employee_rates WHERE employee_id=?", (emp_id,))
            conn.execute("DELETE FROM employee_salaries WHERE employee_id=?", (emp_id,))
            conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))
            conn.commit()
