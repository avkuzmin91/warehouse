"""Интеграционные тесты домена dispatch («Отгрузка клиенту»).

Проверяют: создание, гейт draft→awaiting_trip по готовому остатку `ready`,
резервирование ready между отгрузками, списание при выезде рейса (consume),
завершение, отмену, редактируемость только в черновике, гейт SKU, ссылку на сайт.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _make_product(client_id: str, *, sku: str, sku_pending: int = 0) -> str:
    """Создать тип + товар, вернуть product_id (нужен гейту SKU и detail)."""
    type_id = str(uuid.uuid4())
    product_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (type_id, f"Type-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, created_at, sku_pending) "
            "VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)",
            (product_id, f"Product-{product_id[:8]}", type_id, client_id, sku, sku_pending),
        )
        conn.commit()
    return product_id


def _seed_ready(client_id: str, *, product_id: str, sku: str, qty: int,
                color_id=None, size_id=None) -> None:
    """Засеять готовый к отгрузке остаток (movement → ready/good) по варианту×клиенту."""
    from modules.balances.service import insert_inventory_move

    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Product", product_sku=sku,
            color_id=color_id, color_name=None, size_id=size_id, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="ready",
            from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=None, to_zone_name=None,
            qty=qty, user_id="test-admin-id",
        )
        conn.commit()


def _ready_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="ready", quality="good",
        )


def _payload(client_id, product_id, sku, qty, site_url=None) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-07-01",
        "lines": [{
            "product_id": product_id, "product_name": "Product", "product_sku": sku,
            "qty": qty, "site_url": site_url,
        }],
    }


def _create(admin_client, client_id, product_id, sku, qty, site_url=None) -> str:
    r = admin_client.post("/dispatches", json=_payload(client_id, product_id, sku, qty, site_url))
    assert r.status_code == 200, r.text
    return r.json()["message"]


def test_create_dispatch_returns_doc_id(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T1")
    doc_id = _create(admin_client, client_id, pid, "DSP-T1", 3)
    r = admin_client.get(f"/dispatches/{doc_id}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "draft"
    assert d["doc_number"].startswith("DSP-")
    assert d["total_qty"] == 3


def test_advance_blocked_without_ready(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T2")
    doc_id = _create(admin_client, client_id, pid, "DSP-T2", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "не готова" in r.json()["detail"].lower() or "готово" in r.json()["detail"].lower()


def test_advance_succeeds_with_ready(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T3")
    _seed_ready(client_id, product_id=pid, sku="DSP-T3", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-T3", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_trip"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "awaiting_trip"


def test_advance_blocked_when_ready_partial(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T4")
    _seed_ready(client_id, product_id=pid, sku="DSP-T4", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-T4", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text


def test_reservation_blocks_second_dispatch(admin_client, client_id):
    """Свободный ready режется уже открытыми отгрузками — два документа не отгрузят одно и то же."""
    pid = _make_product(client_id, sku="DSP-T5")
    _seed_ready(client_id, product_id=pid, sku="DSP-T5", qty=5)
    doc_a = _create(admin_client, client_id, pid, "DSP-T5", 5)
    doc_b = _create(admin_client, client_id, pid, "DSP-T5", 5)
    assert admin_client.post(f"/dispatches/{doc_a}/advance").status_code == 200
    # doc_a зарезервировал все 5 ready → doc_b не проходит гейт
    assert admin_client.post(f"/dispatches/{doc_b}/advance").status_code == 400


def test_consume_marks_shipped_and_fully_shipped(admin_client, client_id):
    from modules.dispatch.service import consume_stock_for_dispatch, dispatch_fully_shipped

    pid = _make_product(client_id, sku="DSP-T6")
    _seed_ready(client_id, product_id=pid, sku="DSP-T6", qty=4)
    doc_id = _create(admin_client, client_id, pid, "DSP-T6", 4)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200

    with get_connection() as conn:
        consume_stock_for_dispatch(conn, doc_id, "test-admin-id", alloc=None, trip_id="trip-test")
        conn.commit()
        assert dispatch_fully_shipped(conn, doc_id) is True

    assert _ready_net(client_id, pid) == 0
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["shipped_qty"] == 4


def test_cancel_from_awaiting_trip(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T7")
    _seed_ready(client_id, product_id=pid, sku="DSP-T7", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-T7", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    r = admin_client.post(f"/dispatches/{doc_id}/cancel")
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "cancelled"


def test_lines_editable_only_in_draft(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T8")
    _seed_ready(client_id, product_id=pid, sku="DSP-T8", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-T8", 2)
    # в черновике добавление строки доступно
    add = admin_client.post(f"/dispatches/{doc_id}/lines", json={
        "product_id": pid, "product_name": "Product", "product_sku": "DSP-T8", "qty": 1,
    })
    assert add.status_code == 200, add.text
    # после перевода в «Ожидает рейс» состав не правится
    # (поднимем ready до 3, чтобы пройти гейт)
    _seed_ready(client_id, product_id=pid, sku="DSP-T8", qty=1)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    blocked = admin_client.post(f"/dispatches/{doc_id}/lines", json={
        "product_id": pid, "product_name": "Product", "product_sku": "DSP-T8", "qty": 1,
    })
    assert blocked.status_code == 400, blocked.text


def test_sku_pending_blocks_advance(admin_client, client_id):
    pid = _make_product(client_id, sku="", sku_pending=1)
    _seed_ready(client_id, product_id=pid, sku="", qty=5)
    doc_id = _create(admin_client, client_id, pid, "", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "SKU" in r.json()["detail"] or "артикул" in r.json()["detail"].lower()


def test_site_url_persisted(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T9")
    doc_id = _create(admin_client, client_id, pid, "DSP-T9", 1, site_url="https://shop.example/item/9")
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["site_url"] == "https://shop.example/item/9"


def test_priority_update(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T10")
    doc_id = _create(admin_client, client_id, pid, "DSP-T10", 1)
    r = admin_client.patch(f"/dispatches/{doc_id}/priority", json={"priority_rank": 1})
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["priority_rank"] == 1
