"""Гейт планирования отгрузки: товар «ожидает SKU» (sku_pending) нельзя запланировать."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    make_client_id,
    cleanup_client,
    seed_storage_good,
)


@pytest.fixture
def pending_product():
    """Товар «ожидает SKU» (sku_pending=1) с одним вариантом у тестового клиента."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"SkuType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, sku_pending, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, '', 1, 1, 0, NOW())",
            (pid, f"SkuProduct-{pid[:8]}", type_id, cid),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, '', 1, '[]', 1, NOW(), 0)",
            (vid, pid, cid),
        )
        conn.commit()
    yield {"client_id": cid, "product_id": pid, "variant_id": vid}
    with get_connection() as conn:
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _shipment_payload(client_id: str, product_id: str) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-05-27",
        "comment": "sku gate test",
        "lines": [{
            "product_id": product_id,
            "product_name": "SkuProduct",
            "product_sku": "",
            "color_id": None,
            "color_name": None,
            "size_id": None,
            "size_name": None,
            "qty": 5,
            "shipped_qty": 0,
        }],
    }


def test_plan_blocked_when_product_has_no_sku(admin_client, pending_product):
    """draft → packing блокируется, пока у товара нет SKU (sku_pending=1)."""
    cid, pid = pending_product["client_id"], pending_product["product_id"]
    seed_storage_good(cid, product_id=pid, product_sku="", qty=5)

    doc_id = admin_client.post("/shipments", json=_shipment_payload(cid, pid)).json()["message"]
    # GET отдаёт строку с sku_pending=true (для бейджа «Без SKU» на фронте).
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["sku_pending"] is True

    adv = admin_client.post(f"/shipments/{doc_id}/advance")
    assert adv.status_code == 400, adv.text
    assert "SKU" in adv.json()["detail"]


def test_plan_passes_after_sku_assigned(admin_client, pending_product):
    """После присвоения базового SKU товару перевод в план проходит."""
    cid, pid = pending_product["client_id"], pending_product["product_id"]
    seed_storage_good(cid, product_id=pid, product_sku="", qty=5)

    doc_id = admin_client.post("/shipments", json=_shipment_payload(cid, pid)).json()["message"]
    assert admin_client.post(f"/shipments/{doc_id}/advance").status_code == 400

    sku_base = f"SKU-{pid[:8]}"
    patch = admin_client.patch(f"/products/{pid}", json={"sku_base": sku_base})
    assert patch.status_code == 200, patch.text
    # Флаг снят авторитетно на товаре → строка отгрузки больше не pending,
    # и присвоенный SKU сразу виден (подставлен из варианта/товара, снимок был пустым).
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["sku_pending"] is False
    assert sku_base.upper() in detail["lines"][0]["product_sku"].upper()

    adv = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → assigned (гейт SKU здесь)
    assert adv.status_code == 200 and adv.json()["message"] == "assigned", adv.text
    adv2 = admin_client.post(f"/shipments/{doc_id}/advance")  # assigned → packing
    assert adv2.status_code == 200 and adv2.json()["message"] == "packing", adv2.text


def test_change_existing_sku_reflected_on_line(admin_client, pending_product):
    """Изменение базового SKU товара сразу видно в строке отгрузки (берём live products.sku)."""
    cid, pid = pending_product["client_id"], pending_product["product_id"]
    seed_storage_good(cid, product_id=pid, product_sku="", qty=5)
    doc_id = admin_client.post("/shipments", json=_shipment_payload(cid, pid)).json()["message"]

    first = f"AAA-{pid[:6]}"
    assert admin_client.patch(f"/products/{pid}", json={"sku_base": first}).status_code == 200
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert first.upper() in detail["lines"][0]["product_sku"].upper()

    second = f"BBB-{pid[:6]}"
    assert admin_client.patch(f"/products/{pid}", json={"sku_base": second}).status_code == 200
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert second.upper() in detail["lines"][0]["product_sku"].upper()
    assert first.upper() not in detail["lines"][0]["product_sku"].upper()
