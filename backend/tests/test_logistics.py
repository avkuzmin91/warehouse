"""Интеграционные тесты логистики (рейсы) и каскада на поступления.

Требует DATABASE_URL. admin проходит и менеджерский, и складской гард.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _planned_receipt(admin_client, client_id: str) -> str:
    r = admin_client.post("/receipts", json={"client_id": client_id, "lines": []})
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    assert adv.status_code == 200, adv.text
    assert adv.json()["message"] == "planned"
    return doc_id


def test_trip_full_flow_cascades_receipt_to_intake(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)

    create = admin_client.post("/trips", json={
        "origin_name": "Москва",
        "carrier_name": "ООО Перевозчик",
        "cost_estimate": 10000,
        "receipt_doc_ids": [receipt_id],
    })
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    detail = admin_client.get(f"/trips/{trip_id}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["doc"]["status"] == "draft"
    assert data["doc"]["trip_number"].startswith("TR-")
    assert len(data["receipts"]) == 1

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(f"/trips/{trip_id}/arrival", json={}).json()["message"] == "unloading"

    unload = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert unload.status_code == 200, unload.text
    assert unload.json()["message"] == "costing"

    # Каскад: привязанное поступление переведено planned → on_intake.
    rec = admin_client.get(f"/receipts/{receipt_id}").json()
    assert rec["doc"]["status"] == "on_intake"

    cost = admin_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 12000, "waiting_cost": 1500, "waiting_minutes": 90,
    })
    assert cost.status_code == 200, cost.text

    close = admin_client.post(f"/trips/{trip_id}/close")
    assert close.status_code == 200, close.text
    assert close.json()["message"] == "closed"

    final = admin_client.get(f"/trips/{trip_id}").json()
    assert final["doc"]["logistics_cost_actual"] == 12000
    assert final["doc"]["waiting_cost"] == 1500
    assert final["doc"]["load_factor"] == "full"


def test_handoff_requires_linked_receipt(admin_client):
    create = admin_client.post("/trips", json={"origin_name": "СПб"})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text


def test_receipt_cannot_be_linked_to_two_trips(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    t1 = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]}).json()["message"]
    assert t1
    t2 = admin_client.post("/trips", json={})
    trip2 = t2.json()["message"]
    dup = admin_client.post(f"/trips/{trip2}/receipts", json={"receipt_doc_ids": [receipt_id]})
    assert dup.status_code == 400, dup.text


def test_tasks_endpoint_lists_costing_trip(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]}).json()["message"]
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    tasks = admin_client.get("/tasks")
    assert tasks.status_code == 200, tasks.text
    kinds = {(t["doc_id"], t["kind"]) for t in tasks.json()["items"]}
    # рейс в costing → задача менеджеру; поступление в on_intake → задача кладовщику
    assert (trip_id, "trip_cost") in kinds
    assert (receipt_id, "receipt_intake") in kinds
