"""Штрих-коды варианта: несколько кодов на цвето-размер, присвоение + поиск сканером."""
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
    warehouse_client,
    make_client_id,
    cleanup_client,
)


@pytest.fixture
def product_with_variant():
    """Товар с одним вариантом (без цвета/размера) у тестового клиента."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"BCType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"BCProduct-{pid[:8]}", type_id, cid, f"BC-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"BC-V-{vid[:8]}"),
        )
        conn.commit()
    yield {"client_id": cid, "product_id": pid, "variant_id": vid}
    with get_connection() as conn:
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _add_barcode(client, pid, code, source=None, variant_id=None):
    return client.post(
        f"/products/{pid}/barcodes",
        json={"barcode": code, "source": source, "variant_id": variant_id},
    )


def test_multiple_barcodes_lookup_same_variant(manager_client, warehouse_client, product_with_variant):
    pid, vid = product_with_variant["product_id"], product_with_variant["variant_id"]
    code1 = f"460{uuid.uuid4().hex[:10]}"
    code2 = f"460{uuid.uuid4().hex[:10]}"

    # у товара один вариант — variant_id можно не указывать
    assert _add_barcode(manager_client, pid, code1, source="Ozon").status_code == 200
    assert _add_barcode(manager_client, pid, code2, variant_id=vid).status_code == 200

    # оба кода ведут к одному и тому же варианту
    for code in (code1, code2):
        found = warehouse_client.get(f"/products/by-barcode/{code}")
        assert found.status_code == 200, found.text
        data = found.json()
        assert data["found"] is True
        assert data["match"]["variant_id"] == vid
        assert data["match"]["product_id"] == pid
        assert data["match"]["client_name"]

    # коды видны в списке вариантов с источником
    variants = manager_client.get(f"/products/{pid}/variants").json()
    codes = {b["barcode"]: b for b in variants[0]["barcodes"]}
    assert set(codes) == {code1, code2}
    assert codes[code1]["source"] == "Ozon"
    assert codes[code2]["source"] is None


def test_lookup_unknown_returns_not_found(warehouse_client):
    r = warehouse_client.get(f"/products/by-barcode/{uuid.uuid4().hex}")
    assert r.status_code == 200, r.text
    assert r.json() == {"found": False, "match": None}


def test_duplicate_barcode_rejected(manager_client, product_with_variant):
    pid = product_with_variant["product_id"]
    code = f"461{uuid.uuid4().hex[:10]}"
    assert _add_barcode(manager_client, pid, code).status_code == 200

    # повтор на том же товаре
    assert _add_barcode(manager_client, pid, code).status_code == 409

    # второй вариант того же товара — код тоже занят
    vid2 = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid2, pid, product_with_variant["client_id"], f"BC-V2-{vid2[:8]}"),
        )
        conn.commit()
    assert _add_barcode(manager_client, pid, code, variant_id=vid2).status_code == 409
    # без variant_id при двух вариантах — просим уточнить
    r = _add_barcode(manager_client, pid, f"464{uuid.uuid4().hex[:10]}")
    assert r.status_code == 400
    assert "вариант" in r.json()["detail"].lower()

    # другой товар того же клиента
    pid2 = str(uuid.uuid4())
    with get_connection() as conn:
        type_id = conn.execute("SELECT type_id FROM products WHERE id = ?", (pid,)).fetchone()["type_id"]
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid2, f"BCProduct2-{pid2[:8]}", type_id, product_with_variant["client_id"], f"BC2-{pid2[:8]}"),
        )
        conn.commit()
    try:
        clash = _add_barcode(manager_client, pid2, code)
        assert clash.status_code == 409, clash.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid2,))
            conn.execute("DELETE FROM products WHERE id = ?", (pid2,))
            conn.commit()


def test_delete_barcode_removes_from_lookup(manager_client, warehouse_client, product_with_variant):
    pid = product_with_variant["product_id"]
    code1 = f"462{uuid.uuid4().hex[:10]}"
    code2 = f"462{uuid.uuid4().hex[:10]}"
    assert _add_barcode(manager_client, pid, code1).status_code == 200
    assert _add_barcode(manager_client, pid, code2).status_code == 200

    variants = manager_client.get(f"/products/{pid}/variants").json()
    bc1_id = next(b["id"] for b in variants[0]["barcodes"] if b["barcode"] == code1)

    r = manager_client.delete(f"/products/{pid}/barcodes/{bc1_id}")
    assert r.status_code == 200, r.text

    assert warehouse_client.get(f"/products/by-barcode/{code1}").json()["found"] is False
    # второй код продолжает работать
    assert warehouse_client.get(f"/products/by-barcode/{code2}").json()["found"] is True

    # снятый код можно присвоить заново
    assert _add_barcode(manager_client, pid, code1).status_code == 200


def test_products_search_by_barcode_exact(manager_client, product_with_variant):
    pid = product_with_variant["product_id"]
    code = f"463{uuid.uuid4().hex[:10]}"
    assert _add_barcode(manager_client, pid, code).status_code == 200

    r = manager_client.get(f"/products?search={code}")
    assert r.status_code == 200, r.text
    assert [i["id"] for i in r.json()["items"]] == [pid]

    # поиск по ШК — точное совпадение: обрезанный код товара не находит
    r = manager_client.get(f"/products?search={code[:8]}")
    assert r.status_code == 200
    assert pid not in [i["id"] for i in r.json()["items"]]
