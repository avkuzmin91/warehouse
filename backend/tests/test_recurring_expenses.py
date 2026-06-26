"""Интеграционные тесты модуля «Регулярные расходы»: CRUD шаблонов, ставка с историей
(effective-dated), авто-начисление (ежедневно/ежемесячно, идемпотентность, бэкафилл),
массовая оплата FIFO. Требует DATABASE_URL.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    manager_client,
)


def _purge_template(template_id: str) -> None:
    with get_connection() as conn:
        eids = [r["id"] for r in conn.execute(
            "SELECT id FROM material_expenses WHERE source_kind='recurring' AND source_id=?",
            (template_id,),
        ).fetchall()]
        for eid in eids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
            conn.execute("DELETE FROM expense_payments WHERE expense_id=?", (eid,))
        conn.execute(
            "DELETE FROM material_expenses WHERE source_kind='recurring' AND source_id=?",
            (template_id,),
        )
        conn.execute("DELETE FROM recurring_expense_rates WHERE template_id=?", (template_id,))
        conn.execute("DELETE FROM recurring_expenses WHERE id=?", (template_id,))
        conn.commit()


def _create_template(client, **over) -> str:
    payload = {
        "name": f"Погрузчик-{uuid.uuid4().hex[:8]}",
        "frequency": "daily",
        "start_date": "2026-06-01",
        "amount_kop": 150000,
    }
    payload.update(over)
    r = client.post("/recurring-expenses", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _recurring_items(client, template_id: str) -> list[dict]:
    items = client.get("/expenses?kind=recurring&limit=200").json()["items"]
    return [e for e in items if e["source_id"] == template_id]


def test_template_crud_and_current_rate(admin_client):
    tid = _create_template(admin_client, name=f"Аренда погрузчика-{uuid.uuid4().hex[:6]}")
    try:
        # Список отдаёт действующую ставку.
        items = admin_client.get("/recurring-expenses?limit=200").json()["items"]
        row = next(it for it in items if it["id"] == tid)
        assert row["frequency"] == "daily"
        assert row["current_amount_kop"] == 150000
        assert row["is_active"] is True

        # Деталка со ставками.
        detail = admin_client.get(f"/recurring-expenses/{tid}").json()
        assert len(detail["rates"]) == 1
        assert detail["rates"][0]["amount_kop"] == 150000

        # Правка названия/активности.
        assert admin_client.patch(f"/recurring-expenses/{tid}", json={"name": "Погрузчик X", "is_active": False}).status_code == 200
        detail = admin_client.get(f"/recurring-expenses/{tid}").json()
        assert detail["name"] == "Погрузчик X"
        assert detail["is_active"] is False
    finally:
        _purge_template(tid)


def test_monthly_requires_month_day(admin_client):
    r = admin_client.post("/recurring-expenses", json={
        "name": "Интернет", "frequency": "monthly", "start_date": "2026-06-01", "amount_kop": 50000,
    })
    assert r.status_code == 400
    assert "число месяца" in r.json()["detail"].lower()


def test_accrual_daily_idempotent(admin_client):
    tid = _create_template(admin_client)
    try:
        r1 = admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-15")
        assert r1.status_code == 200, r1.text
        assert r1.json()["created"] == 1
        # Повтор того же дня — без дублей.
        assert admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-15").json()["created"] == 0

        rows = _recurring_items(admin_client, tid)
        day = [e for e in rows if e["spent_on"] == "2026-06-15"]
        assert len(day) == 1
        e = day[0]
        assert e["amount"] == 150000
        assert e["payment_status"] == "awaiting"
        assert e["period_start"] == "2026-06-15" and e["period_end"] == "2026-06-15"
        assert e["kind"] == "recurring"
    finally:
        _purge_template(tid)


def test_accrual_monthly_only_on_day(admin_client):
    tid = _create_template(admin_client, name="Охрана", frequency="monthly", month_day=10, amount_kop=300000)
    try:
        # В число month_day — заводится за месяц.
        assert admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-10").json()["created"] == 1
        # В другой день — нет.
        assert admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-11").json()["created"] == 0

        rows = _recurring_items(admin_client, tid)
        assert len(rows) == 1
        assert rows[0]["period_start"] == "2026-06-01" and rows[0]["period_end"] == "2026-06-30"
        assert rows[0]["amount"] == 300000
    finally:
        _purge_template(tid)


def test_rate_effective_dated(admin_client):
    # Стартовая ставка с 2026-06-01; новая — с 2026-06-20.
    tid = _create_template(admin_client, amount_kop=100000)
    try:
        assert admin_client.post(f"/recurring-expenses/{tid}/rates", json={
            "amount_kop": 200000, "effective_from": "2026-06-20",
        }).status_code == 200

        # До смены — старая ставка, после — новая.
        admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-19")
        admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-21")
        rows = {e["spent_on"]: e for e in _recurring_items(admin_client, tid)}
        assert rows["2026-06-19"]["amount"] == 100000
        assert rows["2026-06-21"]["amount"] == 200000
    finally:
        _purge_template(tid)


def test_backfill_range(admin_client):
    tid = _create_template(admin_client)
    try:
        r = admin_client.post("/recurring-expenses/accruals/run?date_from=2026-06-01&date_to=2026-06-05")
        assert r.status_code == 200, r.text
        assert r.json()["created"] == 5
        # Повтор диапазона — без дублей.
        assert admin_client.post("/recurring-expenses/accruals/run?date_from=2026-06-01&date_to=2026-06-05").json()["created"] == 0
        assert len(_recurring_items(admin_client, tid)) == 5
    finally:
        _purge_template(tid)


def test_bulk_pay_fifo(admin_client):
    tag = uuid.uuid4().hex[:8]
    src = admin_client.post("/expenses/dict/payment-sources", json={"name": f"Касса-{tag}"}).json()["message"]
    tid = _create_template(admin_client, amount_kop=100000)  # 1000 ₽/день
    try:
        admin_client.post("/recurring-expenses/accruals/run?date_from=2026-06-01&date_to=2026-06-03")
        # Долг = 3 × 100000 = 300000.
        out = admin_client.get("/recurring-expenses/outstanding").json()
        mine = next(o for o in out if o["template_id"] == tid)
        assert mine["outstanding_amount"] == 300000 and mine["count"] == 3

        # Переплата отклоняется.
        assert admin_client.post("/recurring-expenses/pay", json={
            "template_id": tid, "amount": 400000, "payment_source_id": src,
        }).status_code == 400

        # Платим 250000 → 2 ранних закрыты целиком, третий частично.
        r = admin_client.post("/recurring-expenses/pay", json={
            "template_id": tid, "amount": 250000, "payment_source_id": src, "paid_on": "2026-06-05",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["allocated_amount"] == 250000
        assert body["fully_paid_count"] == 2 and body["partially_paid_count"] == 1

        rows = {e["spent_on"]: e for e in _recurring_items(admin_client, tid)}
        assert rows["2026-06-01"]["payment_status"] == "paid"
        assert rows["2026-06-02"]["payment_status"] == "paid"
        assert rows["2026-06-03"]["payment_status"] == "partially_paid"
        assert rows["2026-06-03"]["paid_amount"] == 50000
    finally:
        _purge_template(tid)
        with get_connection() as conn:
            conn.execute("DELETE FROM expense_payment_sources WHERE id=?", (src,))
            conn.commit()


def test_manager_can_manage_recurring(admin_client, manager_client):
    # Регулярные расходы видны и доступны менеджеру (не admin-only, как аренда/ЗП).
    tid = _create_template(manager_client, name=f"Погрузчик мен-{uuid.uuid4().hex[:6]}")
    try:
        ids = {it["id"] for it in manager_client.get("/recurring-expenses?limit=200").json()["items"]}
        assert tid in ids
        manager_client.post("/recurring-expenses/accruals/run?on_date=2026-06-15")
        rows = _recurring_items(manager_client, tid)
        assert len(rows) == 1
    finally:
        _purge_template(tid)
