"""Интеграционные тесты факта упаковки (packed_qty) и прав начальника смены.

Используем один TestClient и переключаем роль через dependency_overrides перед
запросом: две фикстуры-клиента нельзя держать одновременно — они переопределяют
один и тот же get_current_user на общем app.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from modules.auth.service import get_current_user
from tests.conftest import make_client_id, cleanup_client, seed_storage_good


_TODAY = "2026-06-09"

_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_SHIFT = {"id": "t-shift", "email": "s@t.com", "role": "shift_supervisor", "created_at": "2020-01-01T00:00:00", "client_id": None}


@pytest.fixture
def api():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _as(row: dict) -> None:
    app.dependency_overrides[get_current_user] = lambda: row


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _payload(client_id: str) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-05-27",
        "comment": "ТЗ",
        "lines": [{
            "product_id": str(uuid.uuid4()),
            "product_name": "Pack Product",
            "product_sku": "PACK-001",
            "color_id": None, "color_name": None,
            "size_id": None, "size_name": None,
            "qty": 10,
        }],
    }


def _create_packing_doc(api, client_id: str) -> tuple[str, str]:
    _as(_ADMIN)
    r = api.post("/shipments", json=_payload(client_id))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    # Гейт перевода в план требует, чтобы позиция лежала на складе.
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], qty=line["qty"],
    )
    api.post(f"/shipments/{doc_id}/advance")  # draft → assigned
    adv = api.post(f"/shipments/{doc_id}/advance")  # assigned → packing
    assert adv.status_code == 200 and adv.json()["message"] == "packing", adv.text
    return doc_id, line["id"]


# Полный поток упаковки (move-to-packing → pack good/defect → балансы) покрыт в test_packing_qc.py.


def test_pack_above_plan_rejected(api, client_id):
    doc_id, line_id = _create_packing_doc(api, client_id)
    r = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 11, "packed_date": _TODAY})
    assert r.status_code == 400, r.text


def test_pack_zero_rejected(api, client_id):
    doc_id, line_id = _create_packing_doc(api, client_id)
    r = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 0, "defect_delta": 0, "packed_date": _TODAY})
    assert r.status_code == 400, r.text


def test_pack_only_in_packing_status(api, client_id):
    _as(_ADMIN)
    r = api.post("/shipments", json=_payload(client_id))
    doc_id = r.json()["message"]
    line_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    res = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 1, "packed_date": _TODAY})
    assert res.status_code == 400, res.text  # статус draft


def test_shift_supervisor_cannot_edit_lines(api, client_id):
    doc_id, line_id = _create_packing_doc(api, client_id)
    _as(_SHIFT)
    forbidden = api.patch(f"/shipments/{doc_id}/lines/{line_id}", json={
        "product_id": str(uuid.uuid4()), "product_name": "x", "product_sku": "x", "qty": 5,
    })
    assert forbidden.status_code == 403, forbidden.text


def test_shift_supervisor_sees_packing_task(api, client_id):
    doc_id, _ = _create_packing_doc(api, client_id)
    # Задача упаковки начальнику смены появляется на статусе «На упаковке».
    # Ставим статус напрямую: тест проверяет генерацию задачи по статусу, не поток упаковки.
    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks
    with get_connection() as conn:
        conn.execute("UPDATE shipment_docs SET status = 'on_packing' WHERE id = ?", (doc_id,))
        conn.commit()
    with get_connection() as conn:
        tasks = list_my_tasks(conn, user={"role": "shift_supervisor"})
    assert any(t["doc_id"] == doc_id and t["kind"] == "shipment_pack" for t in tasks)
