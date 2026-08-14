"""Тесты модуля «Табель и выплаты».

Юнит-проверки формул (часы, неделя Сб→Пт, статус дня, ставка по дате) запускаются
всегда. Интеграционные (RBAC, расчёт, аванс) требуют DATABASE_URL — conftest
пропускает модуль целиком, если его нет.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from dbconn import get_connection
from modules.timesheet.service import (
    day_hours,
    day_status,
    entry_earned,
    rate_on,
    split_shift_hours,
    week_start_for,
    week_stats,
)


# ── Юнит: формула часов ───────────────────────────────────────────────────────

def test_day_hours_full_shift():
    assert day_hours("08:00", "20:00") == 11.0   # 12 ч − 1 ч обед


def test_day_hours_half_day():
    assert day_hours("08:00", "16:00") == 7.0


def test_day_hours_short_day_no_negative():
    assert day_hours("08:00", "08:30") == 0.0     # меньше обеда → 0, не минус
    assert day_hours("08:00", "09:00") == 0.0     # ровно час → 0


def test_day_hours_missing():
    assert day_hours(None, "20:00") == 0.0
    assert day_hours("08:00", None) == 0.0


def test_day_hours_no_lunch():
    assert day_hours("08:00", "20:00", lunch=False) == 12.0   # без обеда — час не вычитаем
    # короткий день без обеда не обнуляется (обнуление защищало вычет от ухода в минус)
    assert day_hours("08:00", "08:30", lunch=False) == 0.5


def test_day_hours_end_next_day():
    assert day_hours("08:00", "02:00", end_next_day=True) == 17.0   # (26:00−08:00)−1 ч
    # ночная смена без обеда
    assert day_hours("08:00", "02:00", lunch=False, end_next_day=True) == 18.0
    # без флага уход ≤ приход → 0 (нельзя случайно посчитать ночную как дневную)
    assert day_hours("08:00", "02:00") == 0.0


# ── Юнит: переработка (порог по времени на смене) ─────────────────────────────

def _ot_entry(start: str, end: str, **kw) -> dict:
    return {"planned_start": "08:00", "planned_end": "20:00",
            "actual_start": start, "actual_end": end, "is_absent": 0, "not_called": 0, **kw}


def test_split_no_overtime_up_to_threshold():
    assert split_shift_hours("08:00", "20:00") == (11.0, 0.0, 0.0)   # ровно 12 ч на смене
    assert split_shift_hours("08:00", "16:00") == (7.0, 0.0, 0.0)


def test_split_tier1_after_threshold():
    # 13 ч на смене: 12 базовых (−1 ч обед = 11 оплачиваемых) + 1 ч ×1.3
    assert split_shift_hours("08:00", "21:00") == (11.0, 1.0, 0.0)
    assert split_shift_hours("08:00", "00:00", end_next_day=True) == (11.0, 4.0, 0.0)  # ровно 16 ч


def test_split_tier2_after_16_hours():
    # 18 ч на смене: 11 оплачиваемых базовых + 4 ч ×1.3 + 2 ч ×1.5
    assert split_shift_hours("08:00", "02:00", end_next_day=True) == (11.0, 4.0, 2.0)


def test_split_no_lunch_keeps_bands():
    assert split_shift_hours("08:00", "21:00", lunch=False) == (12.0, 1.0, 0.0)


def test_day_hours_equals_sum_of_bands():
    for args, kw in (
        (("08:00", "21:00"), {}),
        (("08:00", "02:00"), {"end_next_day": True}),
        (("08:00", "20:30"), {"lunch": False}),
        (("08:00", "08:30"), {}),
    ):
        assert day_hours(*args, **kw) == round(sum(split_shift_hours(*args, **kw)), 2)


def test_entry_earned_applies_overtime_multipliers():
    # Ставка 350 ₽/ч, ночная смена 18 ч на смене (17 оплачиваемых часов).
    earned, ot_hours, ot_pay = entry_earned(
        _ot_entry("08:00", "02:00", end_next_day=1), 35000, "2026-08-10"
    )
    assert earned == round(35000 * (11 + 4 * 1.3 + 2 * 1.5))   # 6 720 ₽
    assert ot_hours == 6.0
    assert ot_pay == earned - round(17 * 35000)                # доплата = 770 ₽


def test_entry_earned_before_effective_date_is_flat():
    # До даты вступления правила день считается по-старому — закрытые недели не поедут.
    earned, ot_hours, ot_pay = entry_earned(
        _ot_entry("08:00", "02:00", end_next_day=1), 35000, "2026-08-07"
    )
    assert (earned, ot_hours, ot_pay) == (round(17 * 35000), 0.0, 0)


def test_entry_earned_without_overtime_unchanged():
    assert entry_earned(_ot_entry("08:00", "20:00"), 35000, "2026-08-10") == (385000, 0.0, 0)
    assert entry_earned(_ot_entry("08:00", "20:00"), None, "2026-08-10") == (0, 0.0, 0)


def test_week_stats_aggregates_overtime():
    days = [date(2026, 8, 8) + timedelta(days=i) for i in range(7)]
    entries = {
        ("emp", "2026-08-10"): _ot_entry("08:00", "21:00"),           # +1 ч ×1.3
        ("emp", "2026-08-11"): _ot_entry("08:00", "20:00"),           # без переработки
    }
    rates = [{"rate_kopecks": 35000, "effective_from": "2026-01-01"}]
    s = week_stats("emp", days, entries, rates, "2026-08-14")
    assert s["hours"] == 23.0                                          # 12 + 11
    assert s["overtime_hours"] == 1.0
    assert s["overtime_pay"] == round(35000 * 0.3)
    assert s["earned"] == round(35000 * (11 + 1.3)) + round(35000 * 11)


# ── Юнит: расчётная неделя Сб → Пт ────────────────────────────────────────────

def test_week_start_saturday_is_itself():
    assert week_start_for(date(2026, 6, 6)) == date(2026, 6, 6)  # Сб


def test_week_start_from_friday():
    # Пт 12 июн принадлежит неделе, начавшейся Сб 06 июн
    assert week_start_for(date(2026, 6, 12)) == date(2026, 6, 6)


def test_week_start_from_sunday():
    assert week_start_for(date(2026, 6, 7)) == date(2026, 6, 6)  # Вс → пред. Сб


# ── Юнит: статус дня ──────────────────────────────────────────────────────────

def test_day_status_off_when_empty():
    assert day_status(None, "2025-01-06", "2025-01-10") == "off"


def test_day_status_worked_and_noplan():
    worked = {"planned_start": "08:00", "planned_end": "20:00",
              "actual_start": "08:00", "actual_end": "20:00", "is_absent": 0}
    noplan = {"planned_start": None, "planned_end": None,
              "actual_start": "10:00", "actual_end": "19:00", "is_absent": 0}
    assert day_status(worked, "2025-01-06", "2025-01-10") == "worked"
    assert day_status(noplan, "2025-01-06", "2025-01-10") == "noplan"


def test_day_status_absent_vs_planned_by_date():
    plan_only = {"planned_start": "08:00", "planned_end": "20:00",
                 "actual_start": None, "actual_end": None, "is_absent": 0}
    # прошедший день без факта → не вышел
    assert day_status(plan_only, "2025-01-06", "2025-01-10") == "absent"
    # будущий день без факта → запланирован
    assert day_status(plan_only, "2025-01-20", "2025-01-10") == "planned"


def test_day_status_explicit_absent():
    e = {"planned_start": "08:00", "planned_end": "20:00",
         "actual_start": None, "actual_end": None, "is_absent": 1}
    assert day_status(e, "2025-01-20", "2025-01-10") == "absent"


def test_day_status_not_called_is_not_absent():
    # План был, но склад не вывел сотрудника — даже на прошедший день это «не вызван», не прогул.
    e = {"planned_start": "08:00", "planned_end": "20:00",
         "actual_start": None, "actual_end": None, "is_absent": 0, "not_called": 1}
    assert day_status(e, "2025-01-06", "2025-01-10") == "not_called"
    # «Не вызван» имеет приоритет над случайно выставленным is_absent.
    e2 = {**e, "is_absent": 1}
    assert day_status(e2, "2025-01-06", "2025-01-10") == "not_called"


def test_week_stats_not_called_excluded_from_absent_and_pay():
    days = [date(2025, 1, 4) + timedelta(days=i) for i in range(7)]
    # Сб..Пт: один день «не вызван» с планом, остальные пустые.
    entries = {
        ("emp", "2025-01-06"): {
            "planned_start": "08:00", "planned_end": "20:00",
            "actual_start": None, "actual_end": None, "is_absent": 0, "not_called": 1,
        },
    }
    rates = [{"rate_kopecks": 40000, "effective_from": "2025-01-01"}]
    s = week_stats("emp", days, entries, rates, "2025-01-31")
    assert s["absent"] == 0       # «не вызван» не идёт в невыходы
    assert s["worked_days"] == 0
    assert s["hours"] == 0.0
    assert s["earned"] == 0       # и не оплачивается


# ── Юнит: ставка по дате (effective-dated) ────────────────────────────────────

def test_rate_on_picks_historical():
    rates = [  # отсортированы по убыванию даты (как возвращает load_rates)
        {"rate_kopecks": 38000, "effective_from": "2026-06-01"},
        {"rate_kopecks": 36000, "effective_from": "2026-02-01"},
        {"rate_kopecks": 34000, "effective_from": "2025-11-10"},
    ]
    assert rate_on(rates, "2026-06-10") == 38000
    assert rate_on(rates, "2026-03-01") == 36000
    assert rate_on(rates, "2025-12-01") == 34000
    assert rate_on(rates, "2025-01-01") == 34000  # до первой ставки — тянем раннюю назад
    # effective_from с временем не должен «съедать» первый день ставки
    assert rate_on([{"rate_kopecks": 34000, "effective_from": "2025-11-10T00:00:00"}], "2025-11-10") == 34000
    assert rate_on(None, "2026-06-10") is None


# ── Интеграционные: RBAC и расчёт ─────────────────────────────────────────────

WEEK = "2025-01-04"          # Сб
WORK_DATE = "2025-01-06"     # Пн той же недели, заведомо в прошлом
RATE = 35000                 # 350 ₽/ч в копейках


@pytest.fixture
def employee():
    """Создаёт сотрудника со ставкой и одной отработанной сменой; чистит за собой."""
    emp_id: dict[str, str] = {}
    with get_connection() as conn:
        from uuid import uuid4
        eid = str(uuid4())
        conn.execute(
            "INSERT INTO employees (id,full_name,position,status,hired_on,created_at) "
            "VALUES (?,?,?, 'active', '2024-01-01', NOW())",
            (eid, "Тестов Тест Тестович", "Грузчик"),
        )
        conn.execute(
            "INSERT INTO employee_rates (id,employee_id,rate_kopecks,effective_from,created_at) "
            "VALUES (?,?,?,?,NOW())",
            (str(uuid4()), eid, RATE, "2024-01-01"),
        )
        conn.commit()
        emp_id["id"] = eid
    yield emp_id["id"]
    with get_connection() as conn:
        _purge_payroll_expenses(conn, emp_id["id"])
        conn.execute("DELETE FROM payroll_payments WHERE employee_id = ?", (emp_id["id"],))
        conn.execute(
            "DELETE FROM timesheet_ops WHERE entry_id IN "
            "(SELECT id FROM timesheet_entries WHERE employee_id = ?)", (emp_id["id"],))
        conn.execute("DELETE FROM timesheet_entries WHERE employee_id = ?", (emp_id["id"],))
        conn.execute("DELETE FROM employee_rates WHERE employee_id = ?", (emp_id["id"],))
        conn.execute("DELETE FROM employees WHERE id = ?", (emp_id["id"],))
        conn.commit()


def _make_employee(full_name: str, user_id: str | None = None) -> str:
    from uuid import uuid4
    eid = str(uuid4())
    with get_connection() as conn:
        # hired_on до WEEK — давний сотрудник, попадает в историческую тестовую неделю
        # (неделя показывает активных, принятых не позже её конца).
        conn.execute(
            "INSERT INTO employees (id,full_name,status,user_id,hired_on,created_at) "
            "VALUES (?,?, 'active', ?, '2024-01-01', NOW())",
            (eid, full_name, user_id),
        )
        conn.commit()
    return eid


def _purge_payroll_expenses(conn, eid: str) -> None:
    """Удаляет расходы (и их журнал), зеркалившие выплаты сотрудника по табелю."""
    sub = ("SELECT id FROM material_expenses WHERE source_kind = 'payroll' AND source_id IN "
           "(SELECT id FROM payroll_payments WHERE employee_id = ?)")
    conn.execute(f"DELETE FROM expense_ops WHERE expense_id IN ({sub})", (eid,))
    conn.execute(
        "DELETE FROM material_expenses WHERE source_kind = 'payroll' AND source_id IN "
        "(SELECT id FROM payroll_payments WHERE employee_id = ?)", (eid,))


def _delete_employee(eid: str) -> None:
    with get_connection() as conn:
        _purge_payroll_expenses(conn, eid)
        conn.execute("DELETE FROM payroll_payments WHERE employee_id = ?", (eid,))
        conn.execute(
            "DELETE FROM timesheet_ops WHERE entry_id IN "
            "(SELECT id FROM timesheet_entries WHERE employee_id = ?)", (eid,))
        conn.execute("DELETE FROM timesheet_entries WHERE employee_id = ?", (eid,))
        conn.execute("DELETE FROM employee_rates WHERE employee_id = ?", (eid,))
        conn.execute("DELETE FROM employees WHERE id = ?", (eid,))
        conn.commit()


@pytest.fixture
def sup_employee():
    """Активный сотрудник для проверок начальника смены."""
    eid = _make_employee("Упаковщиков Упак Упакович")
    yield eid
    _delete_employee(eid)


@pytest.fixture
def team():
    """Трое активных сотрудников. В плоской модели табеля все доступны любой роли."""
    ids = {
        "a": _make_employee("Упаковщиков Упак"),
        "b": _make_employee("Грузчиков Груз"),
        "c": _make_employee("Помощников Пом"),
    }
    yield ids
    for eid in ids.values():
        _delete_employee(eid)


def _add_worked_day(manager_client, emp_id: str):
    r = manager_client.put("/timesheet/entry", json={
        "employee_id": emp_id, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "08:00", "actual_end": "20:00",
    })
    assert r.status_code == 200, r.text


def test_week_grid_hours_and_money_for_manager(manager_client, employee):
    _add_worked_day(manager_client, employee)
    r = manager_client.get(f"/timesheet/week?week={WEEK}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["with_money"] is True
    row = next(x for x in body["rows"] if x["employee_id"] == employee)
    assert row["hours"] == 11.0
    assert row["earned"] == round(11.0 * RATE)   # 385000


def test_entry_overnight_no_lunch_hours_and_money(manager_client, employee):
    # Ночная смена 08:00 → 02:00 без обеда: (26:00−08:00) = 18 ч, час не вычитаем.
    r = manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "08:00", "actual_end": "02:00",
        "end_next_day": True, "no_lunch": True,
    })
    assert r.status_code == 200, r.text

    body = manager_client.get(f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}").json()
    assert body["end_next_day"] is True
    assert body["no_lunch"] is True
    assert body["hours"] == 18.0

    row = next(x for x in manager_client.get(f"/timesheet/week?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["hours"] == 18.0
    assert row["earned"] == round(18.0 * RATE)

    # Флаги без полного факта не сохраняются (свойство факта, не плана).
    r2 = manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": None, "actual_end": None,
        "no_lunch": True, "end_next_day": True,
    })
    assert r2.status_code == 200, r2.text
    body2 = manager_client.get(f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}").json()
    assert body2["no_lunch"] is False
    assert body2["end_next_day"] is False


def test_day_fact_bulk_overnight_no_lunch(manager_client, employee):
    r = manager_client.put("/timesheet/day-fact", json={
        "work_date": WORK_DATE,
        "items": [{
            "employee_id": employee, "actual_start": "08:00", "actual_end": "02:00",
            "end_next_day": True, "no_lunch": True,
        }],
    })
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "1"
    body = manager_client.get(f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}").json()
    assert body["hours"] == 18.0
    assert body["end_next_day"] is True and body["no_lunch"] is True


def test_week_grid_hides_money_for_supervisor(shift_supervisor_client, sup_employee):
    # Начальник смены ведёт факт своего подчинённого и видит часы, но не деньги.
    _add_worked_day(shift_supervisor_client, sup_employee)
    r = shift_supervisor_client.get(f"/timesheet/week?week={WEEK}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["with_money"] is False
    row = next(x for x in body["rows"] if x["employee_id"] == sup_employee)
    assert row["hours"] == 11.0
    assert row["earned"] is None                 # суммы скрыты для роли


def test_payroll_forbidden_for_supervisor(shift_supervisor_client):
    assert shift_supervisor_client.get(f"/timesheet/payroll?week={WEEK}").status_code == 403


def test_rates_forbidden_for_supervisor(shift_supervisor_client, employee):
    r = shift_supervisor_client.post(
        f"/employees/{employee}/rates",
        json={"rate_kopecks": 40000, "effective_from": "2026-01-01"},
    )
    assert r.status_code == 403


def test_archived_employee_keeps_historical_payroll(manager_client, employee):
    # Сотрудник отработал и получил аванс на WEEK, затем ушёл в архив.
    _add_worked_day(manager_client, employee)
    assert manager_client.post("/timesheet/payments", json={
        "employee_id": employee, "amount_kopecks": 100000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    }).status_code == 200
    assert manager_client.post(f"/employees/{employee}/archive").status_code == 200

    # Историческая неделя сохраняет строку — суммы сходятся, помечено «архив».
    row = next(x for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["earned"] == 385000
    assert row["advances"] == 100000
    assert row["archived"] is True
    wrow = next(x for x in manager_client.get(f"/timesheet/week?week={WEEK}").json()["rows"]
                if x["employee_id"] == employee)
    assert wrow["archived"] is True


def test_archived_employee_drops_from_empty_week(manager_client, employee):
    # Архивный без данных за неделю — в этой неделе его уже нет.
    assert manager_client.post(f"/employees/{employee}/archive").status_code == 200
    pids = {x["employee_id"] for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]}
    assert employee not in pids


def test_new_hire_absent_from_weeks_before_hire(manager_client):
    # Сотрудник принят 01.06.2026 — на неделях до приёма его быть не должно.
    from uuid import uuid4
    eid = str(uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO employees (id,full_name,status,hired_on,created_at) "
            "VALUES (?,?, 'active', '2026-06-01', NOW())",
            (eid, "Новичков Новичок"),
        )
        conn.commit()
    try:
        # Старая неделя (2025) — новичка нет.
        old_ids = {x["employee_id"] for x in manager_client.get(f"/timesheet/week?week={WEEK}").json()["rows"]}
        assert eid not in old_ids
        # Неделя приёма (Сб 31.05.2026) — уже есть.
        hire_ids = {x["employee_id"] for x in manager_client.get("/timesheet/week?week=2026-05-31").json()["rows"]}
        assert eid in hire_ids
    finally:
        _delete_employee(eid)


def test_advance_reduces_to_pay_then_settle(manager_client, employee):
    _add_worked_day(manager_client, employee)

    # Заработано 385000, авансов нет → к выдаче 385000
    r = manager_client.get(f"/timesheet/payroll?week={WEEK}")
    row = next(x for x in r.json()["rows"] if x["employee_id"] == employee)
    assert row["earned"] == 385000
    assert row["to_pay"] == 385000
    assert row["settled"] is False

    # Аванс 100000 → к выдаче 285000
    r = manager_client.post("/timesheet/payments", json={
        "employee_id": employee, "amount_kopecks": 100000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    })
    assert r.status_code == 200, r.text
    row = next(x for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["advances"] == 100000
    assert row["to_pay"] == 285000

    # Рассчитать всех → строка закрыта, «осталось выдать» обнулилось
    assert manager_client.post("/timesheet/payroll/settle-all",
                               json={"week": WEEK}).status_code == 200
    row = next(x for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["settled"] is True
    assert row["to_pay"] == 0     # 385000 − 100000 аванс − 285000 расчёт


def test_payroll_hides_zero_hour_rows_but_keeps_money(manager_client, employee):
    # Без часов и без движения денег за неделю сотрудника в расчёте нет.
    pids = {x["employee_id"] for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]}
    assert employee not in pids

    # Аванс без часов — строка возвращается (выданные деньги прятать нельзя),
    # но в «осталось рассчитать» такой сотрудник не считается.
    assert manager_client.post("/timesheet/payments", json={
        "employee_id": employee, "amount_kopecks": 50000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    }).status_code == 200
    row = next(x for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["hours"] == 0.0
    assert row["overpaid"] == 50000
    assert row["to_pay"] == 0


def test_payroll_payment_mirrors_to_expense_ledger(manager_client, employee):
    _add_worked_day(manager_client, employee)   # заработано 385000

    # Аванс почасовику → строка в реестре расходов
    assert manager_client.post("/timesheet/payments", json={
        "employee_id": employee, "amount_kopecks": 100000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    }).status_code == 200

    # Пятничный расчёт → вторая строка расхода на остаток к выдаче (285000)
    assert manager_client.post("/timesheet/payroll/settle-all",
                               json={"week": WEEK}).status_code == 200

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT me.kind, me.payment_status, me.amount, me.paid_on, pp.kind AS pay_kind "
            "FROM material_expenses me JOIN payroll_payments pp ON pp.id = me.source_id "
            "WHERE me.source_kind = 'payroll' AND pp.employee_id = ? "
            "AND COALESCE(me.is_deleted, 0) = 0 ORDER BY me.amount",
            (employee,),
        ).fetchall()

    by_amount = {int(r["amount"]): dict(r) for r in rows}
    assert set(by_amount) == {100000, 285000}            # аванс + остаток расчёта
    for r in rows:
        assert r["kind"] == "salary"
        assert r["payment_status"] == "paid"             # деньги уже выданы
        assert r["paid_on"]
    assert by_amount[100000]["pay_kind"] == "advance"
    assert by_amount[285000]["pay_kind"] == "settlement"


def test_cancel_payment_removes_record_and_mirrored_expense(manager_client, employee):
    _add_worked_day(manager_client, employee)
    assert manager_client.post("/timesheet/payments", json={
        "employee_id": employee, "amount_kopecks": 100000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    }).status_code == 200

    hist = manager_client.get(f"/employees/{employee}").json()["pay_history"]
    assert len(hist) == 1
    pid = hist[0]["id"]

    assert manager_client.delete(f"/timesheet/payments/{pid}").status_code == 200

    # Запись ушла из истории
    assert manager_client.get(f"/employees/{employee}").json()["pay_history"] == []

    # Зеркальный расход снят (soft-delete)
    with get_connection() as conn:
        n = conn.execute(
            "SELECT COUNT(*) AS n FROM material_expenses "
            "WHERE source_kind = 'payroll' AND source_id = ? AND COALESCE(is_deleted, 0) = 0",
            (pid,),
        ).fetchone()["n"]
    assert int(n) == 0


def test_cancel_settlement_unlocks_week(manager_client, employee):
    _add_worked_day(manager_client, employee)
    assert manager_client.post("/timesheet/payroll/settle-all",
                               json={"week": WEEK}).status_code == 200
    assert manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()["fact_locked"] is True

    hist = manager_client.get(f"/employees/{employee}").json()["pay_history"]
    pid = next(p["id"] for p in hist if p["kind"] == "settlement")
    assert manager_client.delete(f"/timesheet/payments/{pid}").status_code == 200

    # Неделя разблокирована — факт снова правится
    assert manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()["fact_locked"] is False
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "10:00", "actual_end": "20:00",
    }).status_code == 200


def test_cancel_payment_404_unknown(manager_client):
    assert manager_client.delete("/timesheet/payments/does-not-exist").status_code == 404


def test_cancel_payment_forbidden_for_supervisor(shift_supervisor_client):
    assert shift_supervisor_client.delete("/timesheet/payments/whatever").status_code == 403


def test_fixed_salary_settle_not_mirrored(manager_client):
    """Окладник в реестр расходов через табель не попадает — его ЗП идёт авто-начислением."""
    from uuid import uuid4
    eid = str(uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO employees (id,full_name,status,comp_type,fixed_salary_kopecks,created_at) "
            "VALUES (?,?, 'active', 'fixed', 5000000, NOW())",
            (eid, "Окладов Оклад Окладович"),
        )
        conn.execute(
            "INSERT INTO employee_rates (id,employee_id,rate_kopecks,effective_from,created_at) "
            "VALUES (?,?,?,?,NOW())",
            (str(uuid4()), eid, RATE, "2024-01-01"),
        )
        conn.commit()
    try:
        _add_worked_day(manager_client, eid)             # к выдаче > 0, но это окладник
        assert manager_client.post("/timesheet/payroll/settle-all",
                                   json={"week": WEEK}).status_code == 200
        with get_connection() as conn:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM material_expenses me "
                "JOIN payroll_payments pp ON pp.id = me.source_id "
                "WHERE me.source_kind = 'payroll' AND pp.employee_id = ?",
                (eid,),
            ).fetchone()["n"]
        assert int(n) == 0
    finally:
        _delete_employee(eid)


def test_entry_journal_appends_ops(manager_client, employee):
    _add_worked_day(manager_client, employee)
    r = manager_client.get(f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "worked"
    assert body["hours"] == 11.0
    assert len(body["ops"]) >= 1                 # план/факт записаны в журнал


def test_fact_rejected_for_future_day(manager_client, employee):
    future = "2099-01-05"
    # План на будущее можно
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": future,
        "planned_start": "08:00", "planned_end": "20:00",
    }).status_code == 200
    # Факт за ненаступивший день — нельзя
    r = manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": future,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "08:00", "actual_end": "20:00",
    })
    assert r.status_code == 400, r.text
    # «Не вышел» на будущее — тоже нельзя
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": future, "is_absent": True,
    }).status_code == 400


def test_fact_locked_after_settlement(manager_client, employee):
    """После расчёта факт за дни этой недели менять нельзя; план/примечание — можно."""
    _add_worked_day(manager_client, employee)

    # До расчёта факт правится свободно
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "09:00", "actual_end": "20:00",
    }).status_code == 200
    assert manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()["fact_locked"] is False

    # Провели расчёт за неделю
    assert manager_client.post("/timesheet/payroll/settle-all",
                               json={"week": WEEK}).status_code == 200

    body = manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()
    assert body["fact_locked"] is True
    week_row = next(x for x in manager_client.get(f"/timesheet/week?week={WEEK}").json()["rows"]
                    if x["employee_id"] == employee)
    assert week_row["fact_locked"] is True

    # Менять факт нельзя
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
        "actual_start": "10:00", "actual_end": "20:00",
    }).status_code == 400
    # «Не вышел» тоже нельзя
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00", "is_absent": True,
    }).status_code == 400

    # Факт в БД не изменился
    assert manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()["actual_start"] == "09:00"

    # План/примечание править можно (факт не трогаем)
    assert manager_client.put("/timesheet/entry", json={
        "employee_id": employee, "work_date": WORK_DATE,
        "planned_start": "07:00", "planned_end": "20:00",
        "actual_start": "09:00", "actual_end": "20:00",
        "note": "правка плана после расчёта",
    }).status_code == 200

    # Массовое «факт = план» и быстрый ввод за день закрытую неделю не трогают
    assert manager_client.post("/timesheet/fill-fact",
                               json={"week": WEEK, "force": True}).json()["message"] == "0"
    assert manager_client.put("/timesheet/day-fact", json={
        "work_date": WORK_DATE,
        "items": [{"employee_id": employee, "actual_start": "10:00", "actual_end": "20:00"}],
    }).json()["message"] == "0"
    assert manager_client.get(
        f"/timesheet/entry?employee_id={employee}&date={WORK_DATE}"
    ).json()["actual_start"] == "09:00"


# ── Плоская модель доступа: все роли табеля видят и правят всех ────────────────

def test_shift_supervisor_sees_all_employees(shift_supervisor_client, team):
    body = shift_supervisor_client.get(f"/timesheet/week?week={WEEK}").json()
    ids = {r["employee_id"] for r in body["rows"]}
    assert {team["a"], team["b"], team["c"]} <= ids


def test_shift_supervisor_can_edit_any_employee(shift_supervisor_client, team):
    r = shift_supervisor_client.put("/timesheet/entry", json={
        "employee_id": team["b"], "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
    })
    assert r.status_code == 200, r.text


def test_warehouse_head_sees_all_and_edits_without_money(warehouse_head_client, team):
    # Начальник склада ведёт табель наравне с начсмены, но денег не видит.
    body = warehouse_head_client.get(f"/timesheet/week?week={WEEK}").json()
    assert body["with_money"] is False
    ids = {r["employee_id"] for r in body["rows"]}
    assert {team["a"], team["b"], team["c"]} <= ids
    r = warehouse_head_client.put("/timesheet/entry", json={
        "employee_id": team["c"], "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
    })
    assert r.status_code == 200, r.text


def test_admin_sees_all_employees(admin_client, team):
    body = admin_client.get(f"/timesheet/week?week={WEEK}").json()
    ids = {r["employee_id"] for r in body["rows"]}
    assert {team["a"], team["b"], team["c"]} <= ids


def test_manager_sees_all_with_money(manager_client, team):
    body = manager_client.get(f"/timesheet/week?week={WEEK}").json()
    assert body["with_money"] is True                    # деньги видит
    ids = {r["employee_id"] for r in body["rows"]}
    assert {team["a"], team["b"], team["c"]} <= ids
    # Пятничный расчёт показывает только сотрудников с часами (или движением денег)
    # за неделю — у команды часов нет, в расчёте её не должно быть.
    pr = manager_client.get(f"/timesheet/payroll?week={WEEK}").json()
    pids = {r["employee_id"] for r in pr["rows"]}
    assert not ({team["a"], team["b"], team["c"]} & pids)


def test_manager_cannot_see_fixed_salary(admin_client, manager_client):
    """Оклад в месяц — только админ: менеджер не видит ни суммы оклада, ни истории,
    ни прочих денег по окладнику, и не может завести/правку оклада."""
    from uuid import uuid4
    tag = uuid4().hex[:8]
    emp_id = admin_client.post("/employees", json={
        "full_name": f"Окладник-{tag}", "comp_type": "fixed",
        "fixed_salary_kopecks": 15000000, "salary_from": "2026-06-01",
    }).json()["message"]
    try:
        # Админ видит оклад и историю.
        a = admin_client.get(f"/employees/{emp_id}").json()
        assert a["with_money"] is True
        assert a["fixed_salary_kopecks"] == 15000000
        assert len(a["salary_history"]) == 1

        # Менеджер — деньги окладника скрыты целиком.
        m = manager_client.get(f"/employees/{emp_id}").json()
        assert m["with_money"] is False
        assert m["fixed_salary_kopecks"] is None
        assert m["salary_history"] == []
        assert m["this_week"]["earned"] is None

        # В списке оклад менеджеру тоже не отдаётся.
        row = next(
            it for it in manager_client.get("/employees?search=Окладник-").json()["items"]
            if it["id"] == emp_id
        )
        assert row.get("fixed_salary_kopecks") is None

        # Менеджер не может заводить/править оклад.
        assert manager_client.post(f"/employees/{emp_id}/salaries", json={
            "salary_kopecks": 9000000, "effective_from": "2026-06-01",
        }).status_code == 403
        sid = a["salary_history"][0]["id"]
        assert manager_client.delete(f"/employees/{emp_id}/salaries/{sid}").status_code == 403
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM employee_salaries WHERE employee_id = ?", (emp_id,))
            conn.execute("DELETE FROM employee_rates WHERE employee_id = ?", (emp_id,))
            conn.execute("DELETE FROM employees WHERE id = ?", (emp_id,))
            conn.commit()


def test_manager_still_sees_hourly_money(admin_client, manager_client):
    """Почасовик — деньги остаются видны менеджеру (скрыты только оклады)."""
    from uuid import uuid4
    tag = uuid4().hex[:8]
    emp_id = admin_client.post("/employees", json={
        "full_name": f"Почасовик-{tag}", "comp_type": "hourly",
        "rate_kopecks": 40000, "effective_from": "2026-01-01",
    }).json()["message"]
    try:
        m = manager_client.get(f"/employees/{emp_id}").json()
        assert m["with_money"] is True
        assert m["rate_kopecks"] == 40000
        # Менеджер может вести почасовую ставку.
        assert manager_client.post(f"/employees/{emp_id}/rates", json={
            "rate_kopecks": 42000, "effective_from": "2026-06-01",
        }).status_code == 200
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM employee_rates WHERE employee_id = ?", (emp_id,))
            conn.execute("DELETE FROM employees WHERE id = ?", (emp_id,))
            conn.commit()


def test_positions_dictionary_crud(admin_client):
    from uuid import uuid4
    name = f"ТестДолжность-{uuid4().hex[:8]}"
    try:
        assert admin_client.post("/positions", json={"name": name, "is_active": True}).status_code == 200
        lst = admin_client.get(f"/positions?name={name}").json()
        item = next(it for it in lst["items"] if it["name"] == name)
        # Деактивация (мягкая) проходит.
        assert admin_client.patch(f"/positions/{item['id']}", json={"is_active": False}).status_code == 200
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM positions WHERE name = ?", (name,))
            conn.commit()
