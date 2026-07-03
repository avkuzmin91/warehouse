"""Тесты доп. работ (прочие доходы): реестр, привязка к счёту, источник в P&L.
Требует DATABASE_URL.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    manager_client,
)


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM invoice_ops WHERE invoice_id IN "
            "(SELECT id FROM invoice_docs WHERE client_id = ?)", (client_id,)
        )
        conn.execute("DELETE FROM invoice_extra_income WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM invoice_docs WHERE client_id = ?", (client_id,))
        conn.execute(
            "DELETE FROM extra_income_ops WHERE entry_id IN "
            "(SELECT id FROM extra_income_entries WHERE client_id = ?)", (client_id,)
        )
        conn.execute("DELETE FROM extra_income_entries WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


def _category_id(admin_client) -> str:
    cats = admin_client.get("/extra-income/categories").json()
    assert cats, "сид справочника видов работ пуст"
    return cats[0]["id"]


def _create_entry(admin_client, client_id: str, *, amount_kop: int = 450000,
                  entry_date: str = "2026-07-01", qty: int | None = 300) -> str:
    r = admin_client.post("/extra-income", json={
        "entry_date": entry_date, "client_id": client_id,
        "category_id": _category_id(admin_client),
        "qty": qty, "amount_kop": amount_kop, "comment": "тестовая работа",
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


# ── Реестр ───────────────────────────────────────────────────────────────────

def test_create_list_update_delete(admin_client, client_id):
    entry_id = _create_entry(admin_client, client_id)

    lst = admin_client.get(f"/extra-income?client_id={client_id}").json()
    assert lst["total"] == 1
    item = lst["items"][0]
    assert item["amount_kop"] == 450000
    assert item["qty"] == 300
    assert item["invoice_id"] is None

    summary = admin_client.get(f"/extra-income/summary?client_id={client_id}").json()
    assert summary["total_amount"] == 450000
    assert summary["uninvoiced_count"] == 1

    r = admin_client.patch(f"/extra-income/{entry_id}", json={
        "entry_date": "2026-07-02", "client_id": client_id,
        "category_id": _category_id(admin_client),
        "qty": None, "amount_kop": 500000,
    })
    assert r.status_code == 200, r.text
    item = admin_client.get(f"/extra-income?client_id={client_id}").json()["items"][0]
    assert item["amount_kop"] == 500000
    assert item["entry_date"] == "2026-07-02"
    assert item["qty"] is None

    r = admin_client.delete(f"/extra-income/{entry_id}")
    assert r.status_code == 200
    assert admin_client.get(f"/extra-income?client_id={client_id}").json()["total"] == 0


def test_create_requires_valid_refs(admin_client, client_id):
    r = admin_client.post("/extra-income", json={
        "entry_date": "2026-07-01", "client_id": "no-such-client",
        "category_id": _category_id(admin_client), "amount_kop": 100,
    })
    assert r.status_code == 400
    r = admin_client.post("/extra-income", json={
        "entry_date": "2026-07-01", "client_id": client_id,
        "category_id": "no-such-category", "amount_kop": 100,
    })
    assert r.status_code == 400


# ── Привязка к счёту ─────────────────────────────────────────────────────────

def test_invoice_attach_detach_flow(admin_client, client_id):
    entry_id = _create_entry(admin_client, client_id)

    # запись видна в пуле «без счёта»
    pool = admin_client.get(f"/invoices/uninvoiced-extra-income?client_id={client_id}").json()
    assert [it["id"] for it in pool["items"]] == [entry_id]

    # создание счёта сразу с доп. работой
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "total_amount": 0, "extra_income_ids": [entry_id],
    })
    assert r.status_code == 200, r.text
    invoice_id = r.json()["message"]

    detail = admin_client.get(f"/invoices/{invoice_id}").json()
    assert detail["extra_income_kop"] == 450000
    assert len(detail["extra_income"]) == 1
    assert detail["extra_income"][0]["entry_id"] == entry_id

    # из пула запись ушла, в реестре видна с номером счёта
    pool = admin_client.get(f"/invoices/uninvoiced-extra-income?client_id={client_id}").json()
    assert pool["total"] == 0
    item = admin_client.get(f"/extra-income?client_id={client_id}").json()["items"][0]
    assert item["invoice_id"] == invoice_id

    # привязанную запись нельзя менять и удалять
    r = admin_client.patch(f"/extra-income/{entry_id}", json={
        "entry_date": "2026-07-01", "client_id": client_id,
        "category_id": _category_id(admin_client), "amount_kop": 1,
    })
    assert r.status_code == 400
    assert admin_client.delete(f"/extra-income/{entry_id}").status_code == 400

    # повторная привязка в другой счёт — отказ
    r2 = admin_client.post("/invoices", json={
        "client_id": client_id, "total_amount": 0, "extra_income_ids": [entry_id],
    })
    assert r2.status_code == 400

    # отвязка возвращает запись в пул
    r = admin_client.delete(f"/invoices/{invoice_id}/extra-income/{entry_id}")
    assert r.status_code == 200
    pool = admin_client.get(f"/invoices/uninvoiced-extra-income?client_id={client_id}").json()
    assert pool["total"] == 1


def test_invoice_attach_rejects_foreign_client(admin_client, client_id):
    other = make_client_id()
    try:
        entry_id = _create_entry(admin_client, other)
        r = admin_client.post("/invoices", json={
            "client_id": client_id, "total_amount": 0, "extra_income_ids": [entry_id],
        })
        assert r.status_code == 400
    finally:
        _cleanup(other)
        cleanup_client(other)


def test_invoice_cancel_frees_entries(admin_client, client_id):
    entry_id = _create_entry(admin_client, client_id)
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "total_amount": 0, "extra_income_ids": [entry_id],
    })
    invoice_id = r.json()["message"]
    assert admin_client.post(f"/invoices/{invoice_id}/cancel").status_code == 200
    pool = admin_client.get(f"/invoices/uninvoiced-extra-income?client_id={client_id}").json()
    assert pool["total"] == 1


# ── P&L ──────────────────────────────────────────────────────────────────────

def test_extra_income_in_pnl(admin_client, client_id):
    _create_entry(admin_client, client_id, amount_kop=450000, entry_date="2026-07-01")

    from modules.pnl.service import income_analytics, pnl_day_detail

    with get_connection() as conn:
        data = income_analytics(conn, date_from="2026-07-01", date_to="2026-07-01", client_id=client_id)
        extra = next((s for s in data["sources"] if s["key"] == "extra"), None)
        assert extra is not None
        assert sum(extra["series"]) == 450000
        assert data["total_amount"] == 450000
        assert data["by_client"][0]["amount"] == 450000

        day = pnl_day_detail(
            conn, day="2026-07-01", date_from="2026-07-01", date_to="2026-07-01",
            client_id=client_id, can_view_salary=True,
        )
        src = next((s for s in day["income_sources"] if s["key"] == "extra"), None)
        assert src is not None and src["amount"] == 450000
        assert src["items"][0]["note"] == "300 шт."
