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
    after_arrival = admin_client.get(f"/trips/{trip_id}").json()
    assert after_arrival["doc"]["unload_started_at"] == after_arrival["doc"]["arrived_at"]

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


def test_trip_unload_start_copied_from_arrival_and_can_be_adjusted(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]}).json()["message"]
    admin_client.post(f"/trips/{trip_id}/handoff")

    arrived_at = "2026-06-03T10:00"
    arrival = admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": arrived_at})
    assert arrival.status_code == 200, arrival.text

    detail = admin_client.get(f"/trips/{trip_id}").json()
    assert detail["doc"]["arrived_at"] == arrived_at
    assert detail["doc"]["unload_started_at"] == arrived_at

    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_started_at": "2026-06-03T10:05",
        "unload_finished_at": "2026-06-03T11:10",
        "load_factor": "partial",
    })
    assert unload.status_code == 200, unload.text

    done = admin_client.get(f"/trips/{trip_id}").json()
    assert done["doc"]["unload_started_at"] == "2026-06-03T10:05"
    assert done["doc"]["unload_finished_at"] == "2026-06-03T11:10"

    execution = admin_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2026-06-03T10:02",
        "unload_started_at": "2026-06-03T10:07",
        "unload_finished_at": "2026-06-03T11:15",
        "load_factor": "full",
    })
    assert execution.status_code == 200, execution.text

    adjusted = admin_client.get(f"/trips/{trip_id}").json()
    assert adjusted["doc"]["arrived_at"] == "2026-06-03T10:02"
    assert adjusted["doc"]["unload_started_at"] == "2026-06-03T10:07"
    assert adjusted["doc"]["unload_finished_at"] == "2026-06-03T11:15"
    assert adjusted["doc"]["load_factor"] == "full"


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


def test_receipt_candidates_exclude_receipts_linked_to_other_trips(admin_client, client_id):
    own_receipt = _planned_receipt(admin_client, client_id)
    other_receipt = _planned_receipt(admin_client, client_id)
    free_receipt = _planned_receipt(admin_client, client_id)
    own_trip = admin_client.post("/trips", json={"receipt_doc_ids": [own_receipt]}).json()["message"]
    other_trip = admin_client.post("/trips", json={"receipt_doc_ids": [other_receipt]}).json()["message"]
    assert own_trip and other_trip

    current = admin_client.get(f"/receipts?status=planned&available_for_trip_id={own_trip}&limit=100")
    assert current.status_code == 200, current.text
    current_ids = {item["id"] for item in current.json()["items"]}
    assert own_receipt in current_ids
    assert free_receipt in current_ids
    assert other_receipt not in current_ids

    new_trip = admin_client.get("/receipts?status=planned&unlinked_to_trip=true&limit=100")
    assert new_trip.status_code == 200, new_trip.text
    new_trip_ids = {item["id"] for item in new_trip.json()["items"]}
    assert free_receipt in new_trip_ids
    assert own_receipt not in new_trip_ids
    assert other_receipt not in new_trip_ids


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
