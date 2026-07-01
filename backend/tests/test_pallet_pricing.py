"""Тесты стоимости палета по клиенту: справочник цен (effective-dated) и вывод
суммы палет в счёт. Требует DATABASE_URL.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from uuid import uuid4

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
        conn.execute(
            "DELETE FROM invoice_ops WHERE invoice_id IN "
            "(SELECT id FROM invoice_docs WHERE client_id = ?)", (client_id,)
        )
        conn.execute("DELETE FROM invoice_shipments WHERE client_id = ?", (client_id,))
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
        conn.execute("DELETE FROM client_pallet_prices WHERE client_id = ?", (client_id,))
        conn.commit()


def _issue_invoice(dispatch_id: str, client_id: str, *, total_kop: int,
                   paid_kop: int = 0, status: str = "issued") -> str:
    """Прямой INSERT выставленного счёта с привязкой к отгрузке (минует загрузку файла)."""
    inv_id = str(uuid4())
    now = "2026-06-11T00:00:00+00:00"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO invoice_docs "
            "(id,doc_number,client_id,client_name,status,total_amount,paid_amount,due_date,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (inv_id, f"INV-TST-{inv_id[:8]}", client_id, "Test Client", status,
             total_kop, paid_kop, "2026-07-01", now, "test-admin-id"),
        )
        conn.execute(
            "INSERT INTO invoice_shipments "
            "(id,invoice_id,shipment_doc_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), inv_id, dispatch_id, client_id, "Test Client", now, "test-admin-id"),
        )
        conn.commit()
    return inv_id


def _invoice(invoice_id: str) -> dict:
    with get_connection() as conn:
        r = conn.execute(
            "SELECT total_amount, status FROM invoice_docs WHERE id = ?", (invoice_id,)
        ).fetchone()
    return {"total_amount": int(r["total_amount"]), "status": str(r["status"])}


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


def _shipped_dispatch_with_pallets(admin_client, client_id: str, *, pallets: list[int],
                                   ship_date: str = "2026-06-10") -> str:
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": ship_date, "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    now = f"{ship_date}T00:00:00+00:00"
    with get_connection() as conn:
        for i, pq in enumerate(pallets):
            conn.execute(
                "INSERT INTO dispatch_lines "
                "(id,doc_id,product_id,product_name,product_sku,color_id,color_name,"
                "size_id,size_name,qty,pallets_qty,shipped_qty,site_url,store_id,store_name,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"{doc_id}-l{i}", doc_id, f"p-{i}", f"Товар {i}", f"P{i}",
                 None, None, None, None, 10, pq, 10, None, None, None, now),
            )
        conn.execute("UPDATE dispatch_docs SET status = 'shipped' WHERE id = ?", (doc_id,))
        conn.commit()
    return doc_id


# ── Справочник цен ───────────────────────────────────────────────────────────

def test_set_and_get_client_pallet_price(admin_client, client_id):
    r = admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                          json={"price_kop": 35000, "effective_from": "2026-06-01"})
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/pallet-pricing/clients/{client_id}").json()
    assert d["price_kop"] == 35000
    assert len(d["history"]) == 1


def test_pallet_price_effective_dated(admin_client, client_id):
    # Более поздняя ставка действует с её даты; до неё — самая ранняя (распространение назад).
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 30000, "effective_from": "2026-06-01"})
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 40000, "effective_from": "2026-06-15"})
    from modules.pallet_pricing.service import pallet_price_for_event
    with get_connection() as conn:
        assert pallet_price_for_event(conn, client_id, "2026-05-01") == 30000  # назад
        assert pallet_price_for_event(conn, client_id, "2026-06-10") == 30000
        assert pallet_price_for_event(conn, client_id, "2026-06-20") == 40000


def test_client_listed_with_and_without_price(admin_client, client_id):
    term = client_id[:8]  # имя тестового клиента — TestClient-<8 симв.>
    missing = admin_client.get(f"/pallet-pricing/clients?missing_only=true&search={term}").json()
    assert any(it["client_id"] == client_id and not it["has_price"] for it in missing["items"])
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices", json={"price_kop": 50000})
    listed = admin_client.get(f"/pallet-pricing/clients?search={term}").json()
    row = next(it for it in listed["items"] if it["client_id"] == client_id)
    assert row["has_price"] and row["price_kop"] == 50000


def test_delete_pallet_price(admin_client, client_id):
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices", json={"price_kop": 12345})
    d = admin_client.get(f"/pallet-pricing/clients/{client_id}").json()
    pid = d["history"][0]["id"]
    assert admin_client.delete(f"/pallet-pricing/clients/{client_id}/prices/{pid}").status_code == 200
    after = admin_client.get(f"/pallet-pricing/clients/{client_id}").json()
    assert after["price_kop"] is None


def test_warehouse_role_forbidden(warehouse_client, client_id):
    assert warehouse_client.get("/pallet-pricing/clients").status_code == 403


# ── Вывод в счёт ─────────────────────────────────────────────────────────────

def test_invoice_contents_includes_pallets_amount(admin_client, client_id):
    ship = _shipped_dispatch_with_pallets(admin_client, client_id, pallets=[3, 2])  # 5 палет
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    body = admin_client.get(f"/invoices/shipment-contents?shipment_ids={ship}").json()
    assert body["pallets_amount_kop"] == 5 * 35000
    assert body["has_missing_pallet_price"] is False


def test_invoice_flags_missing_pallet_price(admin_client, client_id):
    ship = _shipped_dispatch_with_pallets(admin_client, client_id, pallets=[4])
    body = admin_client.get(f"/invoices/shipment-contents?shipment_ids={ship}").json()
    assert body["pallets_amount_kop"] == 0
    assert body["has_missing_pallet_price"] is True


# ── Админ правит палеты по отгрузке с выставленным счётом ─────────────────────

def test_admin_pallet_edit_after_invoice_adjusts_total(admin_client, client_id):
    # Цена палета 100,00 ₽. Отгрузка с 3 палетами, счёт на 300,00 ₽.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 10000, "effective_from": "2026-01-01"})
    ship = _shipped_dispatch_with_pallets(admin_client, client_id, pallets=[3])
    inv = _issue_invoice(ship, client_id, total_kop=30000)
    line = admin_client.get(f"/dispatches/{ship}").json()["lines"][0]
    # 3 → 5 палет: +2 × 100,00 = +200,00 → счёт 500,00.
    r = admin_client.patch(f"/dispatches/{ship}/lines/{line['id']}/pallets", json={"pallets_qty": 5})
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{ship}").json()["lines"][0]["pallets_qty"] == 5
    assert _invoice(inv)["total_amount"] == 50000


def test_manager_pallet_edit_blocked_after_invoice(manager_client, admin_client, client_id):
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 10000, "effective_from": "2026-01-01"})
    ship = _shipped_dispatch_with_pallets(admin_client, client_id, pallets=[3])
    inv = _issue_invoice(ship, client_id, total_kop=30000)
    line = admin_client.get(f"/dispatches/{ship}").json()["lines"][0]
    r = manager_client.patch(f"/dispatches/{ship}/lines/{line['id']}/pallets", json={"pallets_qty": 5})
    assert r.status_code == 400, r.text
    # Ни палеты, ни сумма счёта не изменились.
    assert admin_client.get(f"/dispatches/{ship}").json()["lines"][0]["pallets_qty"] == 3
    assert _invoice(inv)["total_amount"] == 30000


def test_admin_pallet_edit_blocked_below_paid(admin_client, client_id):
    # Счёт 300,00, оплачено 250,00. Снижение 3 → 0 палет (−300,00) опустит сумму ниже оплаты.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 10000, "effective_from": "2026-01-01"})
    ship = _shipped_dispatch_with_pallets(admin_client, client_id, pallets=[3])
    inv = _issue_invoice(ship, client_id, total_kop=30000, paid_kop=25000, status="partially_paid")
    line = admin_client.get(f"/dispatches/{ship}").json()["lines"][0]
    r = admin_client.patch(f"/dispatches/{ship}/lines/{line['id']}/pallets", json={"pallets_qty": 0})
    assert r.status_code == 400, r.text
    # Транзакция откатилась: палеты и сумма счёта на месте.
    assert admin_client.get(f"/dispatches/{ship}").json()["lines"][0]["pallets_qty"] == 3
    assert _invoice(inv)["total_amount"] == 30000
