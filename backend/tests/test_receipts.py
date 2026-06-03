"""Интеграционные тесты receipts state machine.

Требует DATABASE_URL. Запускать только когда БД доступна.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


def _make_receipt_payload(client_id: str) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "supplier_name": "Test Supplier",
        "arrival_date": "2026-05-27",
        "comment": "integration test",
        "lines": [],
    }


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _to_intake(admin_client, doc_id: str):
    """draft → planned → on_intake, проставив зону хранения по каждой строке."""
    admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    detail = admin_client.get(f"/receipts/{doc_id}").json()
    for l in detail["lines"]:
        admin_client.patch(
            f"/receipts/{doc_id}/lines/{l['id']}",
            json={"storage_zone_id": str(uuid.uuid4()), "storage_zone_name": "Зона П"},
        )
    return admin_client.post(f"/receipts/{doc_id}/intake")  # planned → on_intake


def _arrive(admin_client, doc_id: str):
    """Принять товары: on_intake → on_review, «Принят» по каждой строке = planned_qty."""
    intake = _to_intake(admin_client, doc_id)
    assert intake.status_code == 200, intake.text
    lines = admin_client.get(f"/receipts/{doc_id}").json()["lines"]
    payload = {"lines": [{"line_id": l["id"], "accepted_qty": l["planned_qty"]} for l in lines]}
    return admin_client.post(f"/receipts/{doc_id}/arrive", json=payload)


def test_create_receipt_returns_doc_id(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # POST /receipts возвращает {"message": "<doc_id>"}
    assert "message" in data
    doc_id = data["message"]
    # Проверяем созданный документ через GET
    r2 = admin_client.get(f"/receipts/{doc_id}")
    assert r2.status_code == 200, r2.text
    detail = r2.json()
    assert detail["doc"]["status"] == "draft"
    assert detail["doc"]["doc_number"].startswith("WH-")


def test_receipt_advance_state_machine(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    # draft → planned
    r2 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r2.status_code == 200, r2.text
    assert r2.json()["message"] == "planned"

    # planned → on_intake
    r3 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r3.status_code == 200, r3.text
    assert r3.json()["message"] == "on_intake"

    # on_intake → on_review
    r4 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r4.status_code == 200, r4.text
    assert r4.json()["message"] == "on_review"

    # on_review → done
    r5 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r5.status_code == 200, r5.text
    assert r5.json()["message"] == "done"


def test_receipt_advance_final_status_returns_400(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200
    doc_id = r.json()["message"]

    admin_client.post(f"/receipts/{doc_id}/advance")  # → planned
    admin_client.post(f"/receipts/{doc_id}/advance")  # → on_intake
    admin_client.post(f"/receipts/{doc_id}/advance")  # → on_review
    admin_client.post(f"/receipts/{doc_id}/advance")  # → done

    r_fail = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r_fail.status_code == 400


def test_receipt_list_returns_pagination(admin_client):
    r = admin_client.get("/receipts?page=1&limit=5")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert data["page"] == 1


def test_complete_receipt_line_sets_qc_status_done(admin_client, client_id):
    line_id = str(uuid.uuid4())
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [{
        "product_id": str(uuid.uuid4()),
        "product_name": "Test Product",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": None,
        "color_name": None,
        "size_id": None,
        "size_name": None,
        "planned_qty": 3,
    }]
    response = admin_client.post("/receipts", json=payload)
    assert response.status_code == 200, response.text
    doc_id = response.json()["message"]

    detail = admin_client.get(f"/receipts/{doc_id}")
    assert detail.status_code == 200, detail.text
    line_id = detail.json()["lines"][0]["id"]

    arrive = _arrive(admin_client, doc_id)
    assert arrive.status_code == 200, arrive.text

    # Принят зафиксирован при прибытии.
    updated_after_arrive = admin_client.get(f"/receipts/{doc_id}")
    assert updated_after_arrive.json()["lines"][0]["accepted_qty"] == 3

    # Место годного обязательно при accepted > 0.
    zone = admin_client.patch(
        f"/receipts/{doc_id}/lines/{line_id}",
        json={"good_zone_id": str(uuid.uuid4()), "good_zone_name": "Зона А"},
    )
    assert zone.status_code == 200, zone.text

    complete = admin_client.post(
        f"/receipts/{doc_id}/lines/{line_id}/qc-complete",
        json={"accepted": 3, "defect": 0},
    )
    assert complete.status_code == 200, complete.text

    updated = admin_client.get(f"/receipts/{doc_id}")
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["lines"][0]["qc_status"] == "done"
    assert data["state"]["all_qc_done"] is True


def test_record_receipt_op_sets_line_qc_status_in_progress(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [{
        "product_id": str(uuid.uuid4()),
        "product_name": "Test Product",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": None,
        "color_name": None,
        "size_id": None,
        "size_name": None,
        "planned_qty": 3,
    }]
    response = admin_client.post("/receipts", json=payload)
    assert response.status_code == 200, response.text
    doc_id = response.json()["message"]

    arrive = _arrive(admin_client, doc_id)
    assert arrive.status_code == 200, arrive.text

    detail = admin_client.get(f"/receipts/{doc_id}")
    assert detail.status_code == 200, detail.text
    line_id = detail.json()["lines"][0]["id"]

    op = admin_client.post(
        f"/receipts/{doc_id}/ops",
        json={"line_id": line_id, "op_type": "receiving", "qty": 1},
    )
    assert op.status_code == 200, op.text

    updated = admin_client.get(f"/receipts/{doc_id}")
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["lines"][0]["accepted"] == 1
    assert data["lines"][0]["qc_status"] == "in_progress"
    assert data["state"]["lines"][0]["qc_status"] == "in_progress"


def test_arrive_requires_accepted_qty_for_every_line(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [{
        "product_id": str(uuid.uuid4()),
        "product_name": "Test Product",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": None,
        "color_name": None,
        "size_id": None,
        "size_name": None,
        "planned_qty": 4,
    }]
    response = admin_client.post("/receipts", json=payload)
    assert response.status_code == 200, response.text
    doc_id = response.json()["message"]

    intake = _to_intake(admin_client, doc_id)
    assert intake.status_code == 200, intake.text

    # Принять товары без «Принят» по строке — отклоняется.
    bad = admin_client.post(f"/receipts/{doc_id}/arrive", json={"lines": []})
    assert bad.status_code == 400, bad.text


def test_record_receipt_correction_updates_saved_qty(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [{
        "product_id": str(uuid.uuid4()),
        "product_name": "Test Product",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": None,
        "color_name": None,
        "size_id": None,
        "size_name": None,
        "planned_qty": 5,
    }]
    response = admin_client.post("/receipts", json=payload)
    assert response.status_code == 200, response.text
    doc_id = response.json()["message"]

    arrive = _arrive(admin_client, doc_id)
    assert arrive.status_code == 200, arrive.text

    detail = admin_client.get(f"/receipts/{doc_id}")
    assert detail.status_code == 200, detail.text
    line_id = detail.json()["lines"][0]["id"]

    first_op = admin_client.post(
        f"/receipts/{doc_id}/ops",
        json={"line_id": line_id, "op_type": "receiving", "qty": 3},
    )
    assert first_op.status_code == 200, first_op.text

    correction_op = admin_client.post(
        f"/receipts/{doc_id}/ops",
        json={"line_id": line_id, "op_type": "receiving_correction", "qty": 1},
    )
    assert correction_op.status_code == 200, correction_op.text

    updated = admin_client.get(f"/receipts/{doc_id}")
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["lines"][0]["accepted"] == 1
    assert data["lines"][0]["qc_status"] == "in_progress"
