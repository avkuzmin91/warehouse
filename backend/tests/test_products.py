from __future__ import annotations

import uuid

from dbconn import get_connection


def test_products_search_filters_by_name_and_sku(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-{suffix}"
    client_id = f"client-{suffix}"
    product_name_id = f"product-name-{suffix}"
    product_sku_id = f"product-sku-{suffix}"
    name_token = f"SearchName{suffix}"
    sku_token = f"SKU-FILTER-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_name_id, f"{name_token} Jacket", type_id, client_id, f"BASE-NAME-{suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_sku_id, f"Other Product {suffix}", type_id, client_id, sku_token),
        )
        conn.commit()

    try:
        by_name = admin_client.get(f"/products?search={name_token}&limit=100")
        assert by_name.status_code == 200, by_name.text
        by_name_ids = {item["id"] for item in by_name.json()["items"]}
        assert product_name_id in by_name_ids
        assert product_sku_id not in by_name_ids

        by_sku = admin_client.get(f"/products?search={sku_token}&limit=100")
        assert by_sku.status_code == 200, by_sku.text
        by_sku_ids = {item["id"] for item in by_sku.json()["items"]}
        assert product_sku_id in by_sku_ids
        assert product_name_id not in by_sku_ids
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id IN (?, ?)", (product_name_id, product_sku_id))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()
