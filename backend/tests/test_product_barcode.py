"""Штрих-коды вариантов: присвоение + поиск сканером (mobile §6.2)."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
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
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _set_barcode(admin_client, pid, vid, code):
    return admin_client.patch(f"/products/{pid}/variants/{vid}/barcode", json={"barcode": code})


def test_assign_then_lookup(admin_client, warehouse_client, product_with_variant):
    pid, vid = product_with_variant["product_id"], product_with_variant["variant_id"]
    code = f"460{uuid.uuid4().hex[:10]}"

    r = _set_barcode(admin_client, pid, vid, code)
    assert r.status_code == 200, r.text

    found = warehouse_client.get(f"/products/by-barcode/{code}")
    assert found.status_code == 200, found.text
    data = found.json()
    assert data["found"] is True
    assert data["match"]["variant_id"] == vid
    assert data["match"]["product_id"] == pid
    assert data["match"]["client_name"]

    # в списке вариантов штрих-код тоже виден
    variants = admin_client.get(f"/products/{pid}/variants").json()
    assert variants[0]["barcode"] == code


def test_lookup_unknown_returns_not_found(warehouse_client):
    r = warehouse_client.get(f"/products/by-barcode/{uuid.uuid4().hex}")
    assert r.status_code == 200, r.text
    assert r.json() == {"found": False, "match": None}


def test_duplicate_barcode_rejected(admin_client, product_with_variant):
    pid, vid = product_with_variant["product_id"], product_with_variant["variant_id"]
    code = f"461{uuid.uuid4().hex[:10]}"
    assert _set_barcode(admin_client, pid, vid, code).status_code == 200

    # второй вариант того же товара
    vid2 = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid2, pid, product_with_variant["client_id"], f"BC-V2-{vid2[:8]}"),
        )
        conn.commit()

    clash = _set_barcode(admin_client, pid, vid2, code)
    assert clash.status_code == 409, clash.text


def test_clear_barcode_removes_from_lookup(admin_client, warehouse_client, product_with_variant):
    pid, vid = product_with_variant["product_id"], product_with_variant["variant_id"]
    code = f"462{uuid.uuid4().hex[:10]}"
    assert _set_barcode(admin_client, pid, vid, code).status_code == 200
    assert warehouse_client.get(f"/products/by-barcode/{code}").json()["found"] is True

    cleared = _set_barcode(admin_client, pid, vid, None)
    assert cleared.status_code == 200, cleared.text
    assert warehouse_client.get(f"/products/by-barcode/{code}").json()["found"] is False
