"""Интеграционные тесты кабинета клиента: изоляция, видимость, проекция полей.

Требует DATABASE_URL. Запускать только когда БД доступна.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from app import app
from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    _RoleClient,
    admin_client,
    cleanup_client,
    make_client_id,
)

CABINET_GET_PATHS = [
    "/cabinet/summary",
    "/cabinet/balances",
    "/cabinet/balances/summary",
    "/cabinet/write-offs",
    "/cabinet/receipts",
    "/cabinet/receipts/lines",
    "/cabinet/shipments",
    "/cabinet/shipments/lines",
    "/cabinet/reports/packing",
    "/cabinet/profile",
    "/cabinet/products",
]


def _client_user_row(client_id: str | None) -> dict:
    return {
        "id": "test-cabinet-user-id",
        "email": "client@test.com",
        "role": "client",
        "created_at": "2020-01-01T00:00:00",
        "client_id": client_id,
    }


@pytest.fixture
def own_client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


@pytest.fixture
def foreign_client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


@pytest.fixture
def cabinet_client(own_client_id):
    with _RoleClient(app, _client_user_row(own_client_id)) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def unbound_cabinet_client():
    with _RoleClient(app, _client_user_row(None)) as c:
        yield c
    app.dependency_overrides.clear()


def _receipt_line(planned_qty: int = 5) -> dict:
    return {
        "product_id": str(uuid.uuid4()),
        "product_name": "Тестовый товар",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": str(uuid.uuid4()),
        "color_name": "Красный",
        "planned_qty": planned_qty,
    }


def _create_receipt(admin_client, client_id: str, *, advance: bool = False) -> str:
    r = admin_client.post("/receipts", json={
        "client_id": client_id,
        "supplier_name": "Тестовый поставщик",
        "arrival_date": "2026-06-20",
        "ttn": "ТТН-001",
        "logistics_cost": 999.0,
        "comment": "внутренний комментарий",
        "lines": [_receipt_line()],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    if advance:
        adv = admin_client.post(f"/receipts/{doc_id}/advance")
        assert adv.status_code == 200, adv.text
    return doc_id


def _accept_receipt(admin_client, doc_id: str) -> None:
    """Приёмка по плану. Карточная приёмка убрана (поступления принимаются в рейсе),
    поэтому в тесте сразу сажаем остаток в storage и помечаем поступление done —
    как раньше делал /arrive."""
    from datetime import UTC, datetime
    from config import INV_OP_INTAKE, INV_OP_STORAGE, INV_Q_GOOD, RECEIPT_OP_ARRIVAL_ACCEPT
    from dbconn import get_connection
    from modules.balances.service import insert_inventory_move
    doc = admin_client.get(f"/receipts/{doc_id}").json()
    client_id = doc["doc"]["client_id"]
    zone_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    with get_connection() as c:
        c.execute("UPDATE receipt_docs SET status='done', actual_arrival_date='2026-06-21' WHERE id=?", (doc_id,))
        for l in doc["lines"]:
            c.execute("UPDATE receipt_lines SET accepted_qty=?, storage_zone_id=?, storage_zone_name=? WHERE id=?",
                      (l["planned_qty"], zone_id, "Зона Т", l["id"]))
            c.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at) VALUES (?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), doc_id, l["id"], RECEIPT_OP_ARRIVAL_ACCEPT, l["planned_qty"],
                 f"Принято: {l['planned_qty']} шт. (seed)", now),
            )
            insert_inventory_move(
                c, product_id=l["product_id"], product_name=l["product_name"], product_sku=l["product_sku"],
                color_id=l["color_id"], color_name=l["color_name"], size_id=l["size_id"], size_name=l["size_name"],
                client_id=client_id, client_name=None, from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=zone_id, from_zone_name="Зона Т", to_zone_id=zone_id, to_zone_name="Зона Т",
                qty=l["planned_qty"], user_id=None, receipt_line_id=l["id"], comment="seed",
            )
        c.commit()


def _create_shipment(admin_client, client_id: str, *, advance: bool = False) -> str:
    r = admin_client.post("/shipments", json={
        "cargo_type": "good",
        "client_id": client_id,
        "destination": "Магазин Тест",
        "carrier": "Перевозчик Т",
        "ship_date": "2026-06-25",
        "logistics_cost": 555.0,
        "comment": "внутренний комментарий",
        "lines": [{
            "product_id": str(uuid.uuid4()),
            "product_name": "Тестовый товар",
            "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
            "qty": 7,
        }],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    if advance:
        adv = admin_client.post(f"/shipments/{doc_id}/advance")
        assert adv.status_code == 200, adv.text
    return doc_id


# --- Доступ ---

def test_cabinet_rejects_staff_roles(admin_client):
    for path in CABINET_GET_PATHS:
        r = admin_client.get(path)
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"


def test_cabinet_requires_client_binding(unbound_cabinet_client):
    r = unbound_cabinet_client.get("/cabinet/summary")
    assert r.status_code == 403
    assert "администратор" in r.json()["detail"]


# --- Поступления ---

def test_receipts_isolation_and_drafts(admin_client, cabinet_client, own_client_id, foreign_client_id):
    own_planned = _create_receipt(admin_client, own_client_id, advance=True)
    own_draft = _create_receipt(admin_client, own_client_id)
    foreign_planned = _create_receipt(admin_client, foreign_client_id, advance=True)

    r = cabinet_client.get("/cabinet/receipts")
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert own_planned in ids
    assert own_draft not in ids
    assert foreign_planned not in ids

    assert cabinet_client.get(f"/cabinet/receipts/{own_planned}").status_code == 200
    assert cabinet_client.get(f"/cabinet/receipts/{own_draft}").status_code == 404
    assert cabinet_client.get(f"/cabinet/receipts/{foreign_planned}").status_code == 404


def test_receipt_detail_projection(admin_client, cabinet_client, own_client_id):
    doc_id = _create_receipt(admin_client, own_client_id, advance=True)
    _accept_receipt(admin_client, doc_id)

    r = cabinet_client.get(f"/cabinet/receipts/{doc_id}")
    assert r.status_code == 200, r.text
    data = r.json()

    doc = data["doc"]
    assert doc["ttn"] == "ТТН-001"
    for hidden in ("logistics_cost", "comment", "zone_id", "zone_name", "trip_id", "trip_number", "created_by", "client_id", "supplier_name"):
        assert hidden not in doc, f"в doc утёк ключ {hidden}"

    assert data["totals"]["total_planned"] == 5
    assert data["totals"]["total_accepted"] == 5
    for line in data["lines"]:
        for hidden in ("storage_zone_id", "storage_zone_name"):
            assert hidden not in line

    op_types = {o["op_type"] for o in data["ops"]}
    assert op_types, "ожидались видимые операции приёмки"
    assert op_types <= {"intake_start", "arrival_accept", "arrival_fix", "cancel"}
    for o in data["ops"]:
        assert "created_by" not in o
        assert "created_by_email" not in o


def test_receipts_status_filter_validation(cabinet_client):
    r = cabinet_client.get("/cabinet/receipts", params={"status": "draft"})
    assert r.status_code == 400


def test_receipt_lines_hide_zones(admin_client, cabinet_client, own_client_id):
    _create_receipt(admin_client, own_client_id, advance=True)
    r = cabinet_client.get("/cabinet/receipts/lines")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items
    for item in items:
        assert "storage_zone_name" not in item
        assert "client_id" not in item


# --- Отгрузки ---

def test_shipments_isolation_and_projection(admin_client, cabinet_client, own_client_id, foreign_client_id):
    own_packing = _create_shipment(admin_client, own_client_id, advance=True)
    own_draft = _create_shipment(admin_client, own_client_id)
    foreign_packing = _create_shipment(admin_client, foreign_client_id, advance=True)

    r = cabinet_client.get("/cabinet/shipments")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    ids = {item["id"] for item in items}
    assert own_packing in ids
    assert own_draft not in ids
    assert foreign_packing not in ids
    for item in items:
        for hidden in ("logistics_cost", "priority_rank", "client_id", "client_name", "destination", "carrier"):
            assert hidden not in item, f"в списке утёк ключ {hidden}"
        assert "store_names" in item

    assert cabinet_client.get(f"/cabinet/shipments/{own_draft}").status_code == 404
    assert cabinet_client.get(f"/cabinet/shipments/{foreign_packing}").status_code == 404

    detail = cabinet_client.get(f"/cabinet/shipments/{own_packing}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    for hidden in ("logistics_cost", "priority_rank", "comment", "trip_id", "trip_number", "created_by", "destination", "carrier"):
        assert hidden not in data["doc"], f"в doc утёк ключ {hidden}"
    for line in data["lines"]:
        for hidden in ("storage_zone_id", "storage_zone_name", "placements", "available_for_pack", "store_id"):
            assert hidden not in line, f"в строке утёк ключ {hidden}"

    op_types = {o["op_type"] for o in data["ops"]}
    assert op_types <= {"pack", "pack_correction", "cancel"}, f"в журнал утекли операции: {op_types}"


def test_shipments_status_filter_validation(cabinet_client):
    assert cabinet_client.get("/cabinet/shipments", params={"status": "draft"}).status_code == 400
    assert cabinet_client.get("/cabinet/shipments", params={"cargo_type": "x"}).status_code == 400


# --- Сводка, отчёты, профиль ---

def test_cabinet_summary(admin_client, cabinet_client, own_client_id, foreign_client_id):
    own_planned = _create_receipt(admin_client, own_client_id, advance=True)
    own_shipment = _create_shipment(admin_client, own_client_id, advance=True)
    foreign_planned = _create_receipt(admin_client, foreign_client_id, advance=True)

    r = cabinet_client.get("/cabinet/summary")
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("storage_good", "packing_good", "ready_good", "total_good", "defect_total"):
        assert key in data["totals"]

    receipt_ids = {item["id"] for item in data["active_receipts"]}
    assert own_planned in receipt_ids
    assert foreign_planned not in receipt_ids
    shipment_ids = {item["id"] for item in data["active_shipments"]}
    assert own_shipment in shipment_ids
    assert isinstance(data["events"], list)


def test_cabinet_packing_report_smoke(cabinet_client):
    r = cabinet_client.get("/cabinet/reports/packing")
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("days", "total_good", "total_defect", "total"):
        assert key in data


def test_cabinet_profile(cabinet_client, own_client_id):
    store_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO client_stores (id, client_id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, 1, 0, NOW())",
            (store_id, own_client_id, "Тестовый магазин"),
        )
        conn.commit()
    try:
        r = cabinet_client.get("/cabinet/profile")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["client"]["id"] == own_client_id
        store_ids = {s["id"] for s in data["stores"]}
        assert store_id in store_ids
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM client_stores WHERE id = ?", (store_id,))
            conn.commit()


def test_cabinet_write_offs_isolation(cabinet_client, own_client_id, foreign_client_id):
    """Клиент видит только списания своего товара; причина и комментарий доступны."""
    own_id, foreign_id = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        for rec_id, cid in ((own_id, own_client_id), (foreign_id, foreign_client_id)):
            conn.execute(
                """INSERT INTO zone_relocations
                   (id, product_id, product_name, product_sku, client_id,
                    from_op, to_op, from_quality, to_quality, qty, reason, comment, created_at)
                   VALUES (?, ?, 'Тестовый товар', 'SKU-WO', ?,
                           'storage', 'written_off', 'good', 'good', 3, 'damage', 'тест', NOW())""",
                (rec_id, str(uuid.uuid4()), cid),
            )
        conn.commit()
    try:
        r = cabinet_client.get("/cabinet/write-offs")
        assert r.status_code == 200, r.text
        data = r.json()
        ids = {i["id"] for i in data["items"]}
        assert own_id in ids
        assert foreign_id not in ids
        mine = next(i for i in data["items"] if i["id"] == own_id)
        assert mine["reason"] == "damage" and mine["qty"] == 3 and mine["comment"] == "тест"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE id IN (?, ?)", (own_id, foreign_id))
            conn.commit()
