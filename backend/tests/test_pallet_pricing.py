"""Тесты стоимости палета по клиенту: справочник цен (effective-dated) и вывод
суммы палет в счёт. Требует DATABASE_URL.
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
    warehouse_client,
)


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
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
