"""Тесты модуля «Табель и выплаты».

Юнит-проверки формул (часы, неделя Сб→Пт, статус дня, ставка по дате) запускаются
всегда. Интеграционные (RBAC, расчёт, аванс) требуют DATABASE_URL — conftest
пропускает модуль целиком, если его нет.
"""

from __future__ import annotations

from datetime import date

import pytest

from dbconn import get_connection
from modules.timesheet.service import (
    day_hours,
    day_status,
    rate_on,
    week_start_for,
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
    assert rate_on(rates, "2025-01-01") is None   # до первой ставки
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
            "INSERT INTO employees (id,full_name,position,status,supervisor_user_id,created_at) "
            "VALUES (?,?,?, 'active', 'test-manager-id', NOW())",
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
        conn.execute("DELETE FROM payroll_payments WHERE employee_id = ?", (emp_id["id"],))
        conn.execute(
            "DELETE FROM timesheet_ops WHERE entry_id IN "
            "(SELECT id FROM timesheet_entries WHERE employee_id = ?)", (emp_id["id"],))
        conn.execute("DELETE FROM timesheet_entries WHERE employee_id = ?", (emp_id["id"],))
        conn.execute("DELETE FROM employee_rates WHERE employee_id = ?", (emp_id["id"],))
        conn.execute("DELETE FROM employees WHERE id = ?", (emp_id["id"],))
        conn.commit()


def _make_employee(full_name: str, supervisor_user_id: str | None = None,
                   user_id: str | None = None) -> str:
    from uuid import uuid4
    eid = str(uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO employees (id,full_name,status,supervisor_user_id,user_id,created_at) "
            "VALUES (?,?, 'active', ?, ?, NOW())",
            (eid, full_name, supervisor_user_id, user_id),
        )
        conn.commit()
    return eid


def _delete_employee(eid: str) -> None:
    with get_connection() as conn:
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
    """Подчинённый начальника смены (test-shift-supervisor-id)."""
    eid = _make_employee("Упаковщиков Упак Упакович", supervisor_user_id="test-shift-supervisor-id")
    yield eid
    _delete_employee(eid)


@pytest.fixture
def team():
    """Подчинённые разных руководителей: начсмены, начсклада и менеджера."""
    ids = {
        "sup": _make_employee("Упаковщиков Упак", supervisor_user_id="test-shift-supervisor-id"),
        "other": _make_employee("Грузчиков Груз", supervisor_user_id="test-warehouse-head-id"),
        "mgr": _make_employee("Помощников Пом", supervisor_user_id="test-manager-id"),
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

    # Рассчитать всех → строка закрыта
    assert manager_client.post("/timesheet/payroll/settle-all",
                               json={"week": WEEK}).status_code == 200
    row = next(x for x in manager_client.get(f"/timesheet/payroll?week={WEEK}").json()["rows"]
               if x["employee_id"] == employee)
    assert row["settled"] is True


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


# ── Орг. структура: доступ по подчинению ──────────────────────────────────────

def test_supervisor_sees_only_subordinates(shift_supervisor_client, team):
    body = shift_supervisor_client.get(f"/timesheet/week?week={WEEK}").json()
    ids = {r["employee_id"] for r in body["rows"]}
    assert team["sup"] in ids
    assert team["other"] not in ids        # чужой руководитель
    assert team["mgr"] not in ids


def test_supervisor_cannot_edit_foreign_employee(shift_supervisor_client, team):
    r = shift_supervisor_client.put("/timesheet/entry", json={
        "employee_id": team["other"], "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
    })
    assert r.status_code == 403, r.text


def test_supervisor_can_edit_own_subordinate(shift_supervisor_client, team):
    r = shift_supervisor_client.put("/timesheet/entry", json={
        "employee_id": team["sup"], "work_date": WORK_DATE,
        "planned_start": "08:00", "planned_end": "20:00",
    })
    assert r.status_code == 200, r.text


def test_admin_sees_all_employees(admin_client, team):
    body = admin_client.get(f"/timesheet/week?week={WEEK}").json()
    ids = {r["employee_id"] for r in body["rows"]}
    assert {team["sup"], team["other"], team["mgr"]} <= ids


def test_manager_scoped_to_subordinates_with_money(manager_client, team):
    body = manager_client.get(f"/timesheet/week?week={WEEK}").json()
    assert body["with_money"] is True                    # деньги видит
    ids = {r["employee_id"] for r in body["rows"]}
    assert team["mgr"] in ids
    assert team["sup"] not in ids                        # но только своих
    assert team["other"] not in ids
    # Пятничный расчёт тоже ограничен подчинёнными.
    pr = manager_client.get(f"/timesheet/payroll?week={WEEK}").json()
    pids = {r["employee_id"] for r in pr["rows"]}
    assert team["mgr"] in pids
    assert team["sup"] not in pids


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
