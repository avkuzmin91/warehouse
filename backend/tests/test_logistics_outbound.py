"""Интеграционные тесты outbound-рейсов (отгрузки) и каскада packing → shipped.

Зеркало test_logistics.py. Требует DATABASE_URL.
Каскад тестируется на отгрузке без строк: проверка остатков проходит вхолостую
(как в test_shipments.test_shipment_advance_packing_to_shipped).
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _packing_shipment(admin_client, client_id: str) -> str:
    r = admin_client.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert adv.status_code == 200, adv.text
    assert adv.json()["message"] == "packing"
    return doc_id


def _handoff_ready_outbound(admin_client, shipment_id: str) -> str:
    create = admin_client.post("/trips", json={
        "direction": "outbound",
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "cost_estimate": 8000,
        "transport_ordered_at": "2026-06-09T10:00",
        "eta": "2026-06-10T08:00",
        "shipment_doc_ids": [shipment_id],
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


def test_outbound_full_flow_cascades_shipment_to_shipped(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    trip_id = _handoff_ready_outbound(admin_client, shipment_id)

    detail = admin_client.get(f"/trips/{trip_id}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["doc"]["direction"] == "outbound"
    assert data["doc"]["status"] == "draft"
    assert data["doc"]["trip_number"].startswith("TR-")
    assert len(data["shipments"]) == 1
    assert data["shipments"][0]["shipment_doc_id"] == shipment_id
    assert data["receipts"] == []
    trip_number = data["doc"]["trip_number"]

    # Привязанная отгрузка уже знает свой рейс (план).
    linked = admin_client.get(f"/shipments/{shipment_id}").json()
    assert linked["trip_id"] == trip_id
    assert linked["trip_number"] == trip_number
    assert linked["actual_ship_date"] is None

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    arrival = admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"})
    assert arrival.json()["message"] == "unloading"

    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full",
        "unload_started_at": "2026-06-10T07:35",
        "unload_finished_at": "2026-06-10T08:10",
    })
    assert unload.status_code == 200, unload.text
    assert unload.json()["message"] == "costing"

    # Каскад: привязанная отгрузка packing → shipped, факт. дата отправления проставлена.
    ship = admin_client.get(f"/shipments/{shipment_id}").json()
    assert ship["status"] == "shipped"
    assert ship["actual_ship_date"] == "2026-06-10"
    assert ship["trip_id"] == trip_id
    assert ship["trip_number"] == trip_number

    close = admin_client.post(f"/trips/{trip_id}/close")
    assert close.status_code == 200, close.text
    assert close.json()["message"] == "closed"


def test_outbound_handoff_requires_linked_shipment(admin_client):
    create = admin_client.post("/trips", json={"direction": "outbound", "origin_name": "Склад"})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    assert "отгрузку" in bad.json()["detail"]


def test_outbound_handoff_missing_fields_use_outbound_labels(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    create = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    })
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    detail = bad.json()["detail"]
    assert "Куда" in detail
    assert "Плановое отправление" in detail


def test_shipment_cannot_be_linked_to_two_trips(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    t1 = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    }).json()["message"]
    assert t1
    t2 = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]
    dup = admin_client.post(f"/trips/{t2}/shipments", json={"shipment_doc_ids": [shipment_id]})
    assert dup.status_code == 400, dup.text
    assert "уже привязана" in dup.json()["detail"]


def test_shipment_candidates_exclude_shipments_linked_to_other_trips(admin_client, client_id):
    own = _packing_shipment(admin_client, client_id)
    other = _packing_shipment(admin_client, client_id)
    free = _packing_shipment(admin_client, client_id)
    own_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [own],
    }).json()["message"]
    other_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [other],
    }).json()["message"]
    assert own_trip and other_trip

    res = admin_client.get(f"/shipments?status=packing&available_for_trip_id={own_trip}&limit=200")
    assert res.status_code == 200, res.text
    ids = {item["id"] for item in res.json()["items"]}
    assert own in ids
    assert free in ids
    assert other not in ids


def test_cross_direction_linking_rejected(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    inbound = admin_client.post("/trips", json={"direction": "inbound"}).json()["message"]
    outbound = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]

    bad_ship = admin_client.post(f"/trips/{inbound}/shipments", json={"shipment_doc_ids": [shipment_id]})
    assert bad_ship.status_code == 400, bad_ship.text

    bad_rec = admin_client.post(f"/trips/{outbound}/receipts", json={"receipt_doc_ids": ["whatever"]})
    assert bad_rec.status_code == 400, bad_rec.text


def test_outbound_list_filter_by_direction(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    out_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    }).json()["message"]
    in_trip = admin_client.post("/trips", json={"direction": "inbound"}).json()["message"]

    out_list = admin_client.get("/trips?direction=outbound&limit=200")
    assert out_list.status_code == 200, out_list.text
    out_ids = {i["id"] for i in out_list.json()["items"]}
    assert out_trip in out_ids
    assert in_trip not in out_ids
    assert all(i["direction"] == "outbound" for i in out_list.json()["items"])
