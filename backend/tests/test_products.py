from __future__ import annotations

import json
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


def test_product_sku_can_repeat_for_different_clients(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-sku-client-{suffix}"
    client_a = f"client-a-{suffix}"
    client_b = f"client-b-{suffix}"
    sku = f"CLIENT-SKU-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type SKU Client {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_a, f"Client A {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_b, f"Client B {suffix}"),
        )
        conn.commit()

    def create_payload(client_id: str, name: str) -> dict[str, str]:
        return {
            "meta": json.dumps({
                "product": {
                    "name": name,
                    "type_id": type_id,
                    "sku_base": sku,
                    "client_id": client_id,
                    "is_active": True,
                },
                "colors": [],
                "dimensions": [{"length": 1, "width": 1, "height": 1, "sizes": []}],
            }),
        }

    try:
        first = admin_client.post("/products", data=create_payload(client_a, f"Product A {suffix}"))
        assert first.status_code == 200, first.text

        second = admin_client.post("/products", data=create_payload(client_b, f"Product B {suffix}"))
        assert second.status_code == 200, second.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE sku = ?)", (sku,))
            conn.execute("DELETE FROM products WHERE sku = ?", (sku,))
            conn.execute("DELETE FROM clients WHERE id IN (?, ?)", (client_a, client_b))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_product_sku_stays_unique_inside_client_on_update(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-sku-update-{suffix}"
    client_id = f"client-sku-update-{suffix}"
    product_a = f"product-a-{suffix}"
    product_b = f"product-b-{suffix}"
    sku_a = f"SKU-A-{suffix}"
    sku_b = f"SKU-B-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type SKU Update {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client SKU Update {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_a, f"Product A {suffix}", type_id, client_id, sku_a),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_b, f"Product B {suffix}", type_id, client_id, sku_b),
        )
        conn.commit()

    try:
        res = admin_client.patch(f"/products/{product_b}", json={"sku_base": sku_a})
        assert res.status_code == 400, res.text
        assert "клиента" in res.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id IN (?, ?)", (product_a, product_b))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_product_items_per_pallet_roundtrip(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-pallet-{suffix}"
    client_id = f"client-pallet-{suffix}"
    sku = f"PALLET-SKU-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type Pallet {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Pallet {suffix}"),
        )
        conn.commit()

    create_payload = {
        "meta": json.dumps({
            "product": {
                "name": f"Product Pallet {suffix}",
                "type_id": type_id,
                "sku_base": sku,
                "client_id": client_id,
                "weight_grams": 120,
                "items_per_pallet": 48,
                "is_active": True,
            },
            "colors": [],
            "dimensions": [{"length": 1, "width": 1, "height": 1, "sizes": []}],
        }),
    }

    try:
        created = admin_client.post("/products", data=create_payload)
        assert created.status_code == 200, created.text

        listed = admin_client.get(f"/products?search={sku}&limit=100")
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        assert len(items) == 1
        product_id = items[0]["id"]
        assert items[0]["items_per_pallet"] == 48

        detail = admin_client.get(f"/products/{product_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["items_per_pallet"] == 48

        updated = admin_client.patch(f"/products/{product_id}", json={"items_per_pallet": None})
        assert updated.status_code == 200, updated.text

        detail_after_update = admin_client.get(f"/products/{product_id}")
        assert detail_after_update.status_code == 200, detail_after_update.text
        assert detail_after_update.json()["items_per_pallet"] is None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE sku = ?)", (sku,))
            conn.execute("DELETE FROM products WHERE sku = ?", (sku,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()
