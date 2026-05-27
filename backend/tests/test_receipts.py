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
    assert detail["status"] == "draft"
    assert detail["doc_number"].startswith("WH2-")


def test_receipt_advance_state_machine(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    # draft → planned
    r2 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r2.status_code == 200, r2.text
    assert r2.json()["message"] == "planned"

    # planned → on_review
    r3 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r3.status_code == 200, r3.text
    assert r3.json()["message"] == "on_review"

    # on_review → done
    r4 = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r4.status_code == 200, r4.text
    assert r4.json()["message"] == "done"


def test_receipt_advance_final_status_returns_400(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200
    doc_id = r.json()["message"]

    admin_client.post(f"/receipts/{doc_id}/advance")  # → planned
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
