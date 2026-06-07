"""E2E нового потока запасов: приёмка → on_review → подготовка к упаковке → QC good/defect.

Один TestClient с переключением роли (admin делает всё; роли проверяются отдельно).
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.balances.service import get_balances, get_balances_by_zone, get_packing_zone
from tests.conftest import make_client_id, cleanup_client


_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_SHIFT = {"id": "t-shift", "email": "s@t.com", "role": "shift_supervisor", "created_at": "2020-01-01T00:00:00", "client_id": None}
_WH = {"id": "t-wh", "email": "w@t.com", "role": "warehouse_manager", "created_at": "2020-01-01T00:00:00", "client_id": None}


@pytest.fixture
def api():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _as(row):
    app.dependency_overrides[get_current_user] = lambda: row


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _position():
    return {"product_id": str(uuid.uuid4()), "color_id": str(uuid.uuid4()), "size_id": None}


def _balance(client_id, pos):
    """(good, defect, on_review) по позиции из API-расчёта."""
    with get_connection() as c:
        bs = get_balances(c, page=1, limit=10000, client_id=client_id, search=None, only_positive=False, has_defect=False)
    for i in bs.items:
        if i.product_id == pos["product_id"] and i.color_id == pos["color_id"] and i.size_id == pos["size_id"]:
            return i.good, i.defect, i.on_review
    return 0, 0, 0


def _zone_qty(client_id, pos, zone_id, status):
    with get_connection() as c:
        bz = get_balances_by_zone(c, client_id=client_id, search=None, only_positive=False)
    for i in bz.items:
        if (i.product_id == pos["product_id"] and i.color_id == pos["color_id"]
                and i.size_id == pos["size_id"] and i.location_id == zone_id and i.status == status):
            return i.qty
    return 0


def _receive(api, client_id, pos, qty, intake_zone_id):
    """Создаёт поступление и принимает qty в intake_zone → on_review qty."""
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU-" + uuid.uuid4().hex[:6],
            "color_name": "Red", "size_name": None, "planned_qty": qty}
    doc_id = api.post("/receipts", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "supplier_name": "S", "arrival_date": "2026-05-27", "lines": [line],
    }).json()["message"]
    api.post(f"/receipts/{doc_id}/advance")  # draft → planned
    api.patch(f"/receipts/{doc_id}/actual-arrival", json={"actual_arrival_date": "2026-05-27"})
    lid = api.get(f"/receipts/{doc_id}").json()["lines"][0]["id"]
    api.patch(f"/receipts/{doc_id}/lines/{lid}", json={"storage_zone_id": intake_zone_id, "storage_zone_name": "Приёмка"})
    api.post(f"/receipts/{doc_id}/intake")  # planned → on_intake
    r = api.post(f"/receipts/{doc_id}/arrive", json={"lines": [{"line_id": lid, "accepted_qty": qty}]})
    assert r.status_code == 200 and r.json()["message"] == "done", r.text
    return doc_id


def _packing_shipment(api, client_id, pos, qty):
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": qty}
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C", "lines": [line],
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → packing
    line_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    return doc_id, line_id


def test_full_flow_receipt_to_packing_qc(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    _receive(api, client_id, pos, 100, intake_zone)
    assert _balance(client_id, pos) == (0, 0, 100)
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 100

    doc_id, line_id = _packing_shipment(api, client_id, pos, 100)

    # Без перемещения в зону упаковки паковать нельзя.
    _as(_SHIFT)
    blocked = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 10, "kind": "good"})
    assert blocked.status_code == 400, blocked.text

    # Кладовщик перемещает 100 в зону упаковки (FIFO из приёмки).
    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 100})
    assert mv.status_code == 200, mv.text
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 100
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 0
    assert _balance(client_id, pos) == (0, 0, 100)  # сумма on_review не изменилась

    # Начальник смены: 97 годных, 3 брак.
    _as(_SHIFT)
    g = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 97, "kind": "good"})
    assert g.status_code == 200, g.text
    d = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 3, "kind": "defect"})
    assert d.status_code == 200, d.text
    assert d.json()["packed_good"] == 97 and d.json()["packed_defect"] == 3

    assert _balance(client_id, pos) == (97, 3, 0)
    assert _zone_qty(client_id, pos, packing_id, "good") == 97
    assert _zone_qty(client_id, pos, packing_id, "defect") == 3
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 0


def test_pack_cannot_exceed_plan(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 8, "kind": "good"})
    over = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 5, "kind": "defect"})
    assert over.status_code == 400, over.text  # 8+5 > 10


def test_pack_correction_returns_to_review(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 6, "kind": "good"})
    corr = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": -2, "kind": "good"})
    assert corr.status_code == 200, corr.text
    assert corr.json()["packed_good"] == 4
    assert _balance(client_id, pos) == (4, 0, 6)


def test_packing_handoff_tasks(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)

    # Пока не упаковано: задача упаковки у начальника смены, у кладовщика вывоза нет.
    _as(_SHIFT)
    t = api.get("/tasks").json()["items"]
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in t)
    _as(_WH)
    t = api.get("/tasks").json()["items"]
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_move_out" for x in t)

    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 10, "kind": "good"})

    # Упаковано целиком: у кладовщика появилась задача вывоза, у начальника смены упаковки нет.
    _as(_WH)
    t = api.get("/tasks").json()["items"]
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_move_out" for x in t)
    _as(_SHIFT)
    t = api.get("/tasks").json()["items"]
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in t)


def test_ship_good_after_packing(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"delta": 10, "kind": "good"})
    assert _balance(client_id, pos) == (10, 0, 0)

    # Отгрузка годного из зоны упаковки.
    _as(_ADMIN)
    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    upd = api.patch(f"/shipments/{doc_id}/lines/{line_id}", json={
        "product_id": line["product_id"], "product_name": line["product_name"], "product_sku": line["product_sku"],
        "color_id": line["color_id"], "color_name": line["color_name"],
        "size_id": line["size_id"], "size_name": line["size_name"],
        "qty": 10, "shipped_qty": 10, "storage_zone_id": packing_id, "storage_zone_name": "Зона упаковки",
    })
    assert upd.status_code == 200, upd.text
    adv = api.post(f"/shipments/{doc_id}/advance")  # packing → shipped
    assert adv.status_code == 200 and adv.json()["message"] == "shipped", adv.text
    assert _balance(client_id, pos) == (0, 0, 0)


def test_move_to_packing_requires_warehouse_role(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 5, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 5)
    _as(_SHIFT)  # начальник смены не вправе перемещать
    r = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 5})
    assert r.status_code == 403, r.text
