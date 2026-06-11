"""Интеграционные тесты логистики (рейсы) и каскада на поступления.

Требует DATABASE_URL. admin проходит и менеджерский, и складской гард.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import admin_client, manager_client, warehouse_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _handoff_ready_trip(admin_client, receipt_id: str) -> str:
    """Создаёт черновик рейса со всеми обязательными для передачи на склад полями."""
    create = admin_client.post("/trips", json={
        "origin_id": "wh-1", "origin_name": "Москва",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77",
        "cost_estimate": 10000,
        "transport_ordered_at": "2026-06-01T10:00",
        "eta": "2026-06-02T08:00",
        "receipt_doc_ids": [receipt_id],
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


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

    trip_id = _handoff_ready_trip(admin_client, receipt_id)

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
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
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


def test_handoff_rejects_eta_before_transport_ordered(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.patch(f"/trips/{trip_id}", json={
        "transport_ordered_at": "2026-06-02T10:00",
        "eta": "2026-06-01T08:00",
    })
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    assert "раньше" in bad.json()["detail"]


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
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    # Прямой вызов сервиса: API /tasks отдаёт топ-20, что зависит от объёма БД.
    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks
    with get_connection() as conn:
        items = list_my_tasks(conn, user={"role": "admin"})
    kinds = {(t["doc_id"], t["kind"]) for t in items}
    # рейс в costing → задача менеджеру; поступление в on_intake → задача кладовщику
    assert (trip_id, "trip_cost") in kinds
    assert (receipt_id, "receipt_intake") in kinds


def test_unload_copies_actual_arrival_to_receipt(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2025-06-05T09:30"})
    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_finished_at": "2025-06-05T11:00", "load_factor": "full",
    })
    assert unload.status_code == 200, unload.text

    rec = admin_client.get(f"/receipts/{receipt_id}").json()
    assert rec["doc"]["actual_arrival_date"] == "2025-06-05"
    assert rec["doc"]["trip_id"] == trip_id
    assert rec["doc"]["trip_number"].startswith("TR-")


def test_manager_edits_arrival_resyncs_receipt(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2025-06-05T09:30"})
    admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_finished_at": "2025-06-05T11:00", "load_factor": "full",
    })

    execution = admin_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2025-06-07T12:00",
        "unload_started_at": "2025-06-07T12:05",
        "unload_finished_at": "2025-06-07T13:00",
        "load_factor": "full",
    })
    assert execution.status_code == 200, execution.text
    rec = admin_client.get(f"/receipts/{receipt_id}").json()
    assert rec["doc"]["actual_arrival_date"] == "2025-06-07"


def test_actual_arrival_editable_without_trip(warehouse_client, client_id):
    free_receipt = _planned_receipt(warehouse_client, client_id)
    ok = warehouse_client.patch(f"/receipts/{free_receipt}/actual-arrival", json={"actual_arrival_date": "2026-06-06"})
    assert ok.status_code == 200, ok.text
    assert warehouse_client.get(f"/receipts/{free_receipt}").json()["doc"]["actual_arrival_date"] == "2026-06-06"


def test_actual_arrival_blocked_with_trip(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    # достаточно привязки (trip_lines) — без cost_estimate, чтобы не упереться в cost-доступ
    admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    bad = admin_client.patch(f"/receipts/{linked_receipt}/actual-arrival", json={"actual_arrival_date": "2026-06-06"})
    assert bad.status_code == 400, bad.text


def test_cancel_receipt_blocked_while_linked_to_trip(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    create = admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    bad = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert bad.status_code == 400, bad.text
    assert "привязано к рейсу" in bad.json()["detail"]

    unlink = admin_client.delete(f"/trips/{trip_id}/receipts/{linked_receipt}")
    assert unlink.status_code == 200, unlink.text

    ok = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert ok.status_code == 200, ok.text
    assert ok.json()["message"] == "cancelled"


def test_cancel_receipt_allowed_when_trip_cancelled(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    create = admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    cancel_trip = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel_trip.status_code == 200, cancel_trip.text

    ok = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert ok.status_code == 200, ok.text


# Тест on_review-задач удалён: статус документа on_review убран (приёмка завершается на done).


def test_tasks_endpoint_lists_only_costing_trips_for_manager(admin_client, manager_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks
    with get_connection() as conn:
        items = list_my_tasks(conn, user={"role": "manager"})
    assert (trip_id, "trip_cost") in {(t["doc_id"], t["kind"]) for t in items}
    assert all(t["kind"] == "trip_cost" for t in items)


def test_warehouse_trip_costs_are_hidden_and_readonly(admin_client, warehouse_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})
    cost = admin_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 12000,
        "waiting_cost": 1500,
        "waiting_minutes": 90,
    })
    assert cost.status_code == 200, cost.text

    detail = warehouse_client.get(f"/trips/{trip_id}")
    assert detail.status_code == 200, detail.text
    doc = detail.json()["doc"]
    assert doc["cost_estimate"] is None
    assert doc["logistics_cost_actual"] is None
    assert doc["waiting_cost"] is None
    assert doc["waiting_minutes"] == 90

    listing = warehouse_client.get("/trips?limit=200")
    assert listing.status_code == 200, listing.text
    item = next(i for i in listing.json()["items"] if i["id"] == trip_id)
    assert item["cost_estimate"] is None
    assert item["logistics_cost_actual"] is None

    patch = warehouse_client.patch(f"/trips/{trip_id}", json={"cost_estimate": 777})
    assert patch.status_code == 403

    forbidden = warehouse_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 777,
    })
    assert forbidden.status_code == 403


def test_warehouse_cannot_edit_trip_transport_planning(admin_client, warehouse_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)

    draft_patch = warehouse_client.patch(f"/trips/{trip_id}", json={"carrier_name": "Другой перевозчик"})
    assert draft_patch.status_code == 403, draft_patch.text

    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    costing_patch = warehouse_client.patch(f"/trips/{trip_id}", json={"origin_name": "Другой склад"})
    assert costing_patch.status_code == 403, costing_patch.text


def test_warehouse_cannot_edit_trip_execution_in_costing(admin_client, warehouse_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-03T10:00"})
    admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_started_at": "2026-06-03T10:05",
        "unload_finished_at": "2026-06-03T11:10",
        "load_factor": "partial",
    })

    execution = warehouse_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2026-06-03T10:02",
        "unload_started_at": "2026-06-03T10:07",
        "unload_finished_at": "2026-06-03T11:15",
        "load_factor": "full",
    })
    assert execution.status_code == 403, execution.text
