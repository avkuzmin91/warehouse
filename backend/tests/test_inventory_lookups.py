from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("DATABASE_URL is required", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import manager_client  # noqa: F401


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


@pytest.fixture
def lookup_data():
    client_id = _id("client")
    color_id = _id("color")
    size_id = _id("size")
    product_type_id = _id("ptype")
    product_id = _id("product")
    variant_id = _id("variant")
    sku = f"SKU-{uuid.uuid4().hex[:8]}"

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (client_id, f"Client {client_id[:12]}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (color_id, f"Color {color_id[:12]}"),
        )
        conn.execute(
            "INSERT INTO sizes (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (size_id, f"Size {size_id[:12]}"),
        )
        conn.execute(
            """
            INSERT INTO product_types (id, name, is_active, requires_color, requires_size, created_at)
            VALUES (?, ?, 1, 1, 1, NOW())
            """,
            (product_type_id, f"Type {product_type_id[:12]}"),
        )
        conn.execute(
            """
            INSERT INTO products (id, name, type_id, client_id, sku, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, 1, NOW())
            """,
            (product_id, f"Product {product_id[:12]}", product_type_id, client_id, sku),
        )
        conn.execute(
            """
            INSERT INTO product_variants
                (id, product_id, color_id, size_id, length, width, height, sku, images_json, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, 1, 1, ?, '[]', 1, NOW())
            """,
            (variant_id, product_id, color_id, size_id, f"{sku}-V"),
        )
        conn.commit()

    yield {
        "client_id": client_id,
        "color_id": color_id,
        "size_id": size_id,
        "product_id": product_id,
        "sku": sku,
    }

    with get_connection() as conn:
        conn.execute("DELETE FROM product_variants WHERE id = ?", (variant_id,))
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (product_type_id,))
        conn.execute("DELETE FROM sizes WHERE id = ?", (size_id,))
        conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
        conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        conn.commit()


def test_inventory_dictionary_lookup_returns_active_items(manager_client, lookup_data):
    response = manager_client.get("/inventory/lookups/clients")
    assert response.status_code == 200, response.text
    ids = {item["id"] for item in response.json()}
    assert lookup_data["client_id"] in ids


def test_product_create_lookup_contracts(manager_client, lookup_data):
    checks = [
        ("/inventory/lookups/product-types", "id"),
        ("/inventory/lookups/clients", "id"),
        ("/inventory/lookups/colors", "id"),
        ("/inventory/lookups/sizes", "id"),
    ]
    for path, key in checks:
        response = manager_client.get(path)
        assert response.status_code == 200, response.text
        assert isinstance(response.json(), list)
        assert all(key in item for item in response.json())


def test_inventory_product_and_variant_lookups(manager_client, lookup_data):
    products = manager_client.get(f"/inventory/lookups/products?client_id={lookup_data['client_id']}")
    assert products.status_code == 200, products.text
    assert any(item["id"] == lookup_data["product_id"] for item in products.json())

    colors = manager_client.get(f"/inventory/lookups/colors-for-sku?sku={lookup_data['sku']}")
    assert colors.status_code == 200, colors.text
    assert [item["id"] for item in colors.json()] == [lookup_data["color_id"]]

    sizes = manager_client.get(
        f"/inventory/lookups/sizes-for-sku?sku={lookup_data['sku']}&color_id={lookup_data['color_id']}"
    )
    assert sizes.status_code == 200, sizes.text
    assert [item["id"] for item in sizes.json()] == [lookup_data["size_id"]]
