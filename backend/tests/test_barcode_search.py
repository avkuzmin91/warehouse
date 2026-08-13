"""Поиск по штрих-коду варианта: пикер остатков, списки остатков/упаковки/отгрузки, lookup товаров.

Сценарий: клиент присылает товар с непонятным названием и ШК — сотрудник ищет
позицию по коду. Совпадение точное и с точностью до варианта (цвет×размер).
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    manager_client,
    make_client_id,
    cleanup_client,
)


@pytest.fixture
def seeded():
    """Товар с двумя вариантами (разные цвета), остаток по обоим, ШК — только у первого."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    color1, color2 = str(uuid.uuid4()), str(uuid.uuid4())
    vid1, vid2 = str(uuid.uuid4()), str(uuid.uuid4())
    code = f"468{uuid.uuid4().hex[:10]}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"BCSType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"BCSProduct-{pid[:8]}", type_id, cid, f"BCS-{pid[:8]}"),
        )
        for vid, color in ((vid1, color1), (vid2, color2)):
            conn.execute(
                "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
                "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
                "VALUES (?, ?, ?, ?, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
                (vid, pid, cid, color, f"BCS-V-{vid[:8]}"),
            )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid1, code),
        )
        # остаток «На хранении / Годный» по обоим вариантам
        for color in (color1, color2):
            conn.execute(
                "INSERT INTO zone_relocations "
                "(id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name, "
                " client_id, from_op, to_op, from_quality, to_quality, qty, created_at) "
                "VALUES (?, ?, 'BCS Product', 'BCS-SKU', ?, 'Цвет', NULL, NULL, ?, "
                "'intake', 'storage', 'good', 'good', 10, NOW())",
                (str(uuid.uuid4()), pid, color, cid),
            )
        conn.commit()
    yield {
        "client_id": cid, "product_id": pid, "code": code,
        "color1": color1, "color2": color2, "vid1": vid1, "vid2": vid2,
    }
    with get_connection() as conn:
        for doc in conn.execute("SELECT id FROM shipment_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (doc["id"],))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (cid,))
        for doc in conn.execute("SELECT id FROM dispatch_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (doc["id"],))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (cid,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (cid,))
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def test_plannable_picker_barcode_narrows_to_variant(manager_client, seeded):
    r = manager_client.get(f"/balances/plannable?search={seeded['code']}&cargo_type=good")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["product_id"] == seeded["product_id"]
    assert items[0]["color_id"] == seeded["color1"]
    # коды варианта отдаются в позиции — для чипа «ШК» в пикере
    assert items[0]["barcodes"] == [seeded["code"]]

    # точное совпадение: обрезанный код ничего не находит
    r = manager_client.get(f"/balances/plannable?search={seeded['code'][:8]}&cargo_type=good")
    assert r.status_code == 200
    assert r.json()["items"] == []


def test_balances_search_by_barcode(manager_client, seeded):
    r = manager_client.get(f"/balances?search={seeded['code']}")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["color_id"] == seeded["color1"]

    r = manager_client.get(f"/balances/zones?search={seeded['code']}")
    assert r.status_code == 200, r.text
    zone_items = r.json()["items"]
    assert zone_items and all(i["color_id"] == seeded["color1"] for i in zone_items)


def test_shipments_list_search_by_barcode(manager_client, seeded):
    cid, pid = seeded["client_id"], seeded["product_id"]
    with get_connection() as conn:
        doc_with, doc_without = str(uuid.uuid4()), str(uuid.uuid4())
        for doc_id, color in ((doc_with, seeded["color1"]), (doc_without, seeded["color2"])):
            conn.execute(
                "INSERT INTO shipment_docs (id, doc_number, cargo_type, client_id, client_name, "
                "status, is_deleted, created_at, created_by) VALUES (?, ?, 'good', ?, 'BCS Client', 'draft', 0, NOW(), 'test')",
                (doc_id, f"SHP-BCS-{doc_id[:8]}", cid),
            )
            conn.execute(
                "INSERT INTO shipment_lines (id, doc_id, product_id, product_name, product_sku, "
                "color_id, color_name, size_id, size_name, qty, shipped_qty, is_deleted, created_at) "
                "VALUES (?, ?, ?, 'BCS Product', 'BCS-SKU', ?, 'Цвет', NULL, NULL, 5, 0, 0, NOW())",
                (str(uuid.uuid4()), doc_id, pid, color),
            )
        conn.commit()

    r = manager_client.get(f"/shipments?search={seeded['code']}")
    assert r.status_code == 200, r.text
    ids = [d["id"] for d in r.json()["items"]]
    assert doc_with in ids and doc_without not in ids


def test_dispatches_list_search_by_barcode(manager_client, seeded):
    cid, pid = seeded["client_id"], seeded["product_id"]
    with get_connection() as conn:
        doc_with, doc_without = str(uuid.uuid4()), str(uuid.uuid4())
        for doc_id, color in ((doc_with, seeded["color1"]), (doc_without, seeded["color2"])):
            conn.execute(
                "INSERT INTO dispatch_docs (id, doc_number, cargo_type, client_id, client_name, "
                "status, is_deleted, created_at, created_by) VALUES (?, ?, 'good', ?, 'BCS Client', 'draft', 0, NOW(), 'test')",
                (doc_id, f"DSP-BCS-{doc_id[:8]}", cid),
            )
            conn.execute(
                "INSERT INTO dispatch_lines (id, doc_id, product_id, product_name, product_sku, "
                "color_id, color_name, size_id, size_name, qty, shipped_qty, is_deleted, created_at) "
                "VALUES (?, ?, ?, 'BCS Product', 'BCS-SKU', ?, 'Цвет', NULL, NULL, 5, 0, 0, NOW())",
                (str(uuid.uuid4()), doc_id, pid, color),
            )
        conn.commit()

    r = manager_client.get(f"/dispatches?search={seeded['code']}")
    assert r.status_code == 200, r.text
    ids = [d["id"] for d in r.json()["items"]]
    assert doc_with in ids and doc_without not in ids


def test_inventory_lookup_products_by_barcode(manager_client, seeded):
    r = manager_client.get(f"/inventory/lookups/products?client_id={seeded['client_id']}&search={seeded['code']}")
    assert r.status_code == 200, r.text
    items = r.json()
    assert [p["id"] for p in items] == [seeded["product_id"]]
    codes = items[0]["barcodes"]
    assert codes == [{"barcode": seeded["code"], "color_id": seeded["color1"], "size_id": None}]
