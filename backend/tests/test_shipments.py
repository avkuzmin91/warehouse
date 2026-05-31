"""Интеграционные тесты shipments state machine и проверки остатков."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _make_shipment_payload(client_id: str, lines: list | None = None) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-05-27",
        "comment": "integration test",
        "lines": lines or [],
    }


def test_create_shipment_returns_doc_id(admin_client, client_id):
    payload = _make_shipment_payload(client_id)
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # POST /shipments возвращает {"message": "<doc_id>"}
    assert "message" in data
    doc_id = data["message"]
    # Проверяем созданный документ через GET
    r2 = admin_client.get(f"/shipments/{doc_id}")
    assert r2.status_code == 200, r2.text
    detail = r2.json()
    assert detail["status"] == "draft"
    assert detail["doc_number"].startswith("SHP-")


def test_shipment_advance_draft_to_packing(admin_client, client_id):
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    assert r.status_code == 200
    doc_id = r.json()["message"]

    r2 = admin_client.post(f"/shipments/{doc_id}/advance")
    assert r2.status_code == 200, r2.text
    assert r2.json()["message"] == "packing"


def test_shipment_advance_packing_to_shipped(admin_client, client_id):
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]

    admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    r3 = admin_client.post(f"/shipments/{doc_id}/advance")  # packing → shipped
    assert r3.status_code == 200, r3.text
    assert r3.json()["message"] == "shipped"


def _fake_line() -> dict:
    return {
        "product_id": str(uuid.uuid4()),
        "product_name": "Fake Product",
        "product_sku": "FAKE-001",
        "color_id": str(uuid.uuid4()),
        "color_name": "Red",
        "size_id": None,
        "size_name": None,
        "qty": 999,
        "shipped_qty": 999,
    }


def test_shipment_packing_to_shipped_unallocated_zone_returns_409(admin_client, client_id):
    """Отгрузка годного без зоны блокируется проверкой остатков."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [_fake_line()]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    line = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]
    line["shipped_qty"] = 999

    r_line = admin_client.patch(f"/shipments/{doc_id}/lines/{line['id']}", json=line)
    assert r_line.status_code == 200, r_line.text

    admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing

    r_ship = admin_client.post(f"/shipments/{doc_id}/advance")  # packing → shipped
    assert r_ship.status_code == 409, r_ship.text


def test_shipment_packing_to_shipped_insufficient_stock_returns_409(admin_client, client_id):
    """Распределено по зоне, но остатка в зоне нет → 409."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [_fake_line()]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    line = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]
    zone_id = str(uuid.uuid4())
    line["shipped_qty"] = 999
    line["storage_zone_id"] = zone_id
    line["storage_zone_name"] = "Зона А"

    r_line = admin_client.patch(f"/shipments/{doc_id}/lines/{line['id']}", json=line)
    assert r_line.status_code == 200, r_line.text

    admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing

    r_ship = admin_client.post(f"/shipments/{doc_id}/advance")  # packing → shipped
    assert r_ship.status_code == 409, r_ship.text


def test_shipment_list_returns_pagination(admin_client):
    r = admin_client.get("/shipments?page=1&limit=5")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert data["page"] == 1
