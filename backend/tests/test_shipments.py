"""Интеграционные тесты shipments state machine и проверки остатков."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, warehouse_client, make_client_id, cleanup_client  # noqa: F401


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


def test_shipment_advance_requires_technical_task(admin_client, client_id):
    payload = _make_shipment_payload(client_id)
    payload["comment"] = "  "
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    r2 = admin_client.post(f"/shipments/{doc_id}/advance")
    assert r2.status_code == 400, r2.text
    assert r2.json()["detail"] == "Заполните техническое задание"


def test_shipment_packing_requires_handoff_to_advance(admin_client, client_id):
    """packing → on_packing требует передачи на упаковку: без перемещения — 400."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]

    r2 = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert r2.status_code == 200 and r2.json()["message"] == "packing", r2.text
    r3 = admin_client.post(f"/shipments/{doc_id}/advance")  # packing → on_packing
    assert r3.status_code == 400, r3.text


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


def test_shipment_cancel_allowed_in_packing(admin_client, client_id):
    """Аннулировать можно в черновике и «В плане» (до передачи на упаковку)."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [_fake_line()]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing

    r_cancel = admin_client.post(f"/shipments/{doc_id}/cancel")
    assert r_cancel.status_code == 200, r_cancel.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["status"] == "cancelled"


def test_shipment_list_returns_pagination(admin_client):
    r = admin_client.get("/shipments?page=1&limit=5")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert data["page"] == 1


def test_shipment_lines_view_returns_doc_line_rows(admin_client, client_id):
    """Разрез «По товарам»: одна строка = позиция документа с данными дока."""
    line = _fake_line()
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    doc_number = admin_client.get(f"/shipments/{doc_id}").json()["doc_number"]

    r2 = admin_client.get(f"/shipments/lines?sku={line['product_sku']}&limit=200")
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert "items" in data and "total" in data
    row = next(i for i in data["items"] if i["doc_id"] == doc_id)
    assert row["doc_number"] == doc_number
    assert row["product_sku"] == line["product_sku"]
    assert row["product_name"] == line["product_name"]
    assert row["qty"] == line["qty"]
    assert row["status"] == "draft"
    assert row["client_id"] == client_id


def test_shipment_priority_levels(admin_client, client_id):
    """Приоритет — уровни: 1 «Срочно», 2 «Повышенный»; значения вне диапазона — 422."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]

    r2 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 1})
    assert r2.status_code == 200, r2.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["priority_rank"] == 1

    r3 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 5})
    assert r3.status_code == 422, r3.text

    r4 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": None})
    assert r4.status_code == 200, r4.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["priority_rank"] is None


def test_shipment_cancel_clears_priority(admin_client, client_id):
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]
    assert admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 2}).status_code == 200

    assert admin_client.post(f"/shipments/{doc_id}/cancel").status_code == 200
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "cancelled"
    assert detail["priority_rank"] is None


def test_warehouse_shipment_costs_are_hidden_and_readonly(admin_client, warehouse_client, client_id):
    payload = _make_shipment_payload(client_id)
    payload["logistics_cost"] = 54321
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    detail = warehouse_client.get(f"/shipments/{doc_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["logistics_cost"] is None

    # client_id-фильтр: в dev-БД сотни документов, без него документ не попадает в страницу.
    listing = warehouse_client.get(f"/shipments?client_id={client_id}&limit=200")
    assert listing.status_code == 200, listing.text
    item = next(i for i in listing.json()["items"] if i["id"] == doc_id)
    assert item["logistics_cost"] is None

    forbidden = warehouse_client.patch(f"/shipments/{doc_id}", json={"logistics_cost": 777})
    assert forbidden.status_code == 403


def test_warehouse_cannot_edit_shipment_plan_or_composition(admin_client, warehouse_client, client_id):
    line = _fake_line()
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    line_id = detail["lines"][0]["id"]

    date_patch = warehouse_client.patch(f"/shipments/{doc_id}", json={"ship_date": "2026-07-01"})
    assert date_patch.status_code == 403

    line_patch = warehouse_client.patch(f"/shipments/{doc_id}/lines/{line_id}", json={**line, "qty": 1})
    assert line_patch.status_code == 403

    line_delete = warehouse_client.delete(f"/shipments/{doc_id}/lines/{line_id}")
    assert line_delete.status_code == 403
