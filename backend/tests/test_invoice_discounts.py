"""Скидки в счёте: вычитание из суммы, авто-расход kind=discount, сторно.
Требует DATABASE_URL.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import (
    EXPENSE_KIND_DISCOUNT,
    EXPENSE_PAYMENT_PAID,
    EXPENSE_SOURCE_INVOICE_DISCOUNT,
)
from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    manager_client,
    warehouse_client,
)


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
        inv_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM invoice_docs WHERE client_id = ?", (client_id,)
            ).fetchall()
        ]
        for iid in inv_ids:
            disc_ids = [
                r["id"] for r in conn.execute(
                    "SELECT id FROM invoice_discounts WHERE invoice_id = ?", (iid,)
                ).fetchall()
            ]
            for did in disc_ids:
                exp_ids = [
                    r["id"] for r in conn.execute(
                        "SELECT id FROM material_expenses WHERE source_kind = ? AND source_id = ?",
                        (EXPENSE_SOURCE_INVOICE_DISCOUNT, did),
                    ).fetchall()
                ]
                for eid in exp_ids:
                    conn.execute("DELETE FROM expense_payments WHERE expense_id = ?", (eid,))
                    conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (eid,))
                    conn.execute("DELETE FROM material_expenses WHERE id = ?", (eid,))
            conn.execute("DELETE FROM invoice_discounts WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_shipments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_payments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_ops WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_files WHERE invoice_id = ?", (iid,))
        conn.execute("DELETE FROM invoice_docs WHERE client_id = ?", (client_id,))
        disp_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM dispatch_docs WHERE client_id = ?", (client_id,)
            ).fetchall()
        ]
        for sid in disp_ids:
            conn.execute("DELETE FROM dispatch_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (sid,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


def _shipped_shipment(admin_client, client_id: str) -> str:
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    with get_connection() as conn:
        conn.execute("UPDATE dispatch_docs SET status = 'shipped' WHERE id = ?", (doc_id,))
        conn.commit()
    return doc_id


_XLSX = ("calc.xlsx", b"PK\x03\x04dummy",
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _draft_invoice(admin_client, client_id, *, ship=None, total_amount=100_000) -> str:
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-01", "total_amount": total_amount,
        "shipment_ids": [ship] if ship else [],
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _issued_invoice(admin_client, client_id, *, total_amount=100_000) -> str:
    ship = _shipped_shipment(admin_client, client_id)
    iid = _draft_invoice(admin_client, client_id, ship=ship, total_amount=total_amount)
    ok = admin_client.post(f"/invoices/{iid}/files", files={"file": _XLSX})
    assert ok.status_code == 200, ok.text
    r = admin_client.post(f"/invoices/{iid}/issue")
    assert r.status_code == 200, r.text
    return iid


def _discount_expense(discount_id: str):
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM material_expenses WHERE source_kind = ? AND source_id = ?",
            (EXPENSE_SOURCE_INVOICE_DISCOUNT, discount_id),
        ).fetchone()


def test_add_discount_reduces_total_and_creates_expense(admin_client, client_id):
    iid = _draft_invoice(admin_client, client_id, total_amount=100_000)
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 30_000, "reason": "Брак при упаковке"})
    assert r.status_code == 200, r.text
    discount_id = r.json()["message"]

    detail = admin_client.get(f"/invoices/{iid}").json()
    assert detail["total_amount"] == 70_000
    assert detail["discount_kop"] == 30_000
    assert len(detail["discounts"]) == 1
    assert detail["discounts"][0]["reason"] == "Брак при упаковке"
    assert any(o["op_type"] == "discount_add" for o in detail["ops"])

    exp = _discount_expense(discount_id)
    assert exp is not None
    assert str(exp["kind"]) == EXPENSE_KIND_DISCOUNT
    assert int(exp["amount"]) == 30_000
    assert str(exp["payment_status"]) == EXPENSE_PAYMENT_PAID
    assert int(exp["paid_amount"]) == 30_000
    assert "Скидка по счёту" in str(exp["name"])


def test_discount_requires_reason(admin_client, client_id):
    iid = _draft_invoice(admin_client, client_id)
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 1_000, "reason": "   "})
    assert r.status_code == 400


def test_discount_cannot_exceed_remaining(admin_client, client_id):
    iid = _issued_invoice(admin_client, client_id, total_amount=50_000)
    ok = admin_client.post(f"/invoices/{iid}/payments",
                           json={"amount": 40_000, "paid_on": "2026-06-20"})
    assert ok.status_code == 200, ok.text
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 20_000, "reason": "Слишком щедро"})
    assert r.status_code == 400
    assert "превышает" in r.json()["detail"]


def test_discount_down_to_paid_closes_invoice(admin_client, client_id):
    iid = _issued_invoice(admin_client, client_id, total_amount=50_000)
    ok = admin_client.post(f"/invoices/{iid}/payments",
                           json={"amount": 40_000, "paid_on": "2026-06-20"})
    assert ok.status_code == 200, ok.text
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 10_000, "reason": "Округлили"})
    assert r.status_code == 200, r.text
    detail = admin_client.get(f"/invoices/{iid}").json()
    assert detail["status"] == "closed"
    assert detail["total_amount"] == 40_000


def test_remove_discount_restores_total_and_reverses_expense(admin_client, client_id):
    iid = _draft_invoice(admin_client, client_id, total_amount=100_000)
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 25_000, "reason": "Ошиблись"})
    discount_id = r.json()["message"]

    ok = admin_client.delete(f"/invoices/{iid}/discounts/{discount_id}")
    assert ok.status_code == 200, ok.text

    detail = admin_client.get(f"/invoices/{iid}").json()
    assert detail["total_amount"] == 100_000
    assert detail["discount_kop"] == 0
    assert detail["discounts"] == []
    assert any(o["op_type"] == "discount_remove" for o in detail["ops"])

    exp = _discount_expense(discount_id)
    assert exp is not None and int(exp["is_deleted"]) == 1


def test_cancel_invoice_reverses_discount_expense(admin_client, client_id):
    iid = _issued_invoice(admin_client, client_id, total_amount=80_000)
    r = admin_client.post(f"/invoices/{iid}/discounts",
                          json={"amount_kop": 15_000, "reason": "Лояльность"})
    discount_id = r.json()["message"]

    ok = admin_client.post(f"/invoices/{iid}/cancel")
    assert ok.status_code == 200, ok.text

    exp = _discount_expense(discount_id)
    assert exp is not None and int(exp["is_deleted"]) == 1


def test_manual_discount_expense_forbidden(admin_client):
    r = admin_client.post("/expenses", json={
        "kind": EXPENSE_KIND_DISCOUNT, "spent_on": "2026-07-01",
        "name": "Скидка руками", "amount": 1_000,
    })
    assert r.status_code == 400


def test_manager_can_add_discount(manager_client, admin_client, client_id):
    iid = _draft_invoice(admin_client, client_id, total_amount=10_000)
    r = manager_client.post(f"/invoices/{iid}/discounts",
                            json={"amount_kop": 2_000, "reason": "Менеджерская скидка"})
    assert r.status_code == 200, r.text
    detail = manager_client.get(f"/invoices/{iid}").json()
    assert detail["total_amount"] == 8_000
