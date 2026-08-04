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


def test_products_default_order_is_by_name(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-sort-{suffix}"
    client_id = f"client-sort-{suffix}"
    alpha_id = f"product-alpha-{suffix}"
    bravo_id = f"product-bravo-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type Sort {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Sort {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, ?)
            """,
            (bravo_id, f"Bravo Sort {suffix}", type_id, client_id, f"BRAVO-SORT-{suffix}", "2026-01-02T00:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, ?)
            """,
            (alpha_id, f"Alpha Sort {suffix}", type_id, client_id, f"ALPHA-SORT-{suffix}", "2026-01-01T00:00:00+00:00"),
        )
        conn.commit()

    try:
        res = admin_client.get(f"/products?client_id={client_id}&limit=100")
        assert res.status_code == 200, res.text
        assert [item["id"] for item in res.json()["items"]] == [alpha_id, bravo_id]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id IN (?, ?)", (alpha_id, bravo_id))
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


def test_create_product_allowed_for_manager(manager_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-mgr-create-{suffix}"
    client_id = f"client-mgr-create-{suffix}"
    sku = f"MGR-SKU-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type Mgr {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Mgr {suffix}"),
        )
        conn.commit()

    payload = {
        "meta": json.dumps({
            "product": {
                "name": f"Mgr Product {suffix}",
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
        res = manager_client.post("/products", data=payload)
        assert res.status_code == 200, res.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE sku = ?)", (sku,))
            conn.execute("DELETE FROM products WHERE sku = ?", (sku,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
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


def test_delete_product_succeeds_when_never_used(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-del-{suffix}"
    client_id = f"client-del-{suffix}"
    product_id = f"product-del-{suffix}"
    variant_id = f"variant-del-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type Del {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Del {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_id, f"Product Del {suffix}", type_id, client_id, f"DEL-SKU-{suffix}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, length, width, height, sku, created_at) VALUES (?, ?, 0, 0, 0, ?, NOW())",
            (variant_id, product_id, f"DEL-VAR-{suffix}"),
        )
        conn.commit()

    try:
        res = admin_client.delete(f"/products/{product_id}")
        assert res.status_code == 200, res.text
        with get_connection() as conn:
            assert conn.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is None
            assert conn.execute("SELECT 1 FROM product_variants WHERE id = ?", (variant_id,)).fetchone() is None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_delete_product_blocked_when_used_in_receipts(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-delr-{suffix}"
    client_id = f"client-delr-{suffix}"
    product_id = f"product-delr-{suffix}"
    doc_id = f"rdoc-delr-{suffix}"
    line_id = f"rline-delr-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type DelR {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client DelR {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_id, f"Product DelR {suffix}", type_id, client_id, f"DELR-SKU-{suffix}"),
        )
        conn.execute(
            "INSERT INTO receipt_docs (id, doc_number, client_id, status, created_at) VALUES (?, ?, ?, 'draft', NOW())",
            (doc_id, f"WH-DELR-{suffix}", client_id),
        )
        conn.execute(
            """
            INSERT INTO receipt_lines
                (id, doc_id, product_id, product_name, product_sku, planned_qty, created_at)
            VALUES (?, ?, ?, ?, ?, 1, NOW())
            """,
            (line_id, doc_id, product_id, f"Product DelR {suffix}", f"DELR-SKU-{suffix}"),
        )
        conn.commit()

    try:
        res = admin_client.delete(f"/products/{product_id}")
        assert res.status_code == 409, res.text
        assert "поступления" in res.json()["detail"]
        with get_connection() as conn:
            assert conn.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is not None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM receipt_lines WHERE id = ?", (line_id,))
            conn.execute("DELETE FROM receipt_docs WHERE id = ?", (doc_id,))
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_delete_product_forbidden_for_non_admin(manager_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-delm-{suffix}"
    client_id = f"client-delm-{suffix}"
    product_id = f"product-delm-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 0, 0, 0, NOW())
            """,
            (type_id, f"Type DelM {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client DelM {suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_id, f"Product DelM {suffix}", type_id, client_id, f"DELM-SKU-{suffix}"),
        )
        conn.commit()

    try:
        res = manager_client.delete(f"/products/{product_id}")
        assert res.status_code == 403, res.text
        with get_connection() as conn:
            assert conn.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is not None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_create_product_with_pending_sku(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-pend-{suffix}"
    client_id = f"client-pend-{suffix}"
    color_id = f"color-pend-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type Pend {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Pend {suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"Color Pend {suffix}"),
        )
        conn.commit()

    def pending_payload(name: str) -> dict[str, str]:
        return {
            "meta": json.dumps({
                "product": {
                    "name": name,
                    "type_id": type_id,
                    "sku_pending": True,
                    "client_id": client_id,
                    "is_active": True,
                },
                "colors": [color_id],
                "dimensions": [{"length": 1, "width": 1, "height": 1, "sizes": []}],
            }),
        }

    try:
        first = admin_client.post("/products", data=pending_payload(f"Pending A {suffix}"))
        assert first.status_code == 200, first.text
        # Второй pending-товар того же клиента не должен конфликтовать по уникальности SKU.
        second = admin_client.post("/products", data=pending_payload(f"Pending B {suffix}"))
        assert second.status_code == 200, second.text

        listed = admin_client.get(f"/products?client_id={client_id}&sku_pending=true&limit=100")
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        assert len(items) == 2
        assert all(it["sku_pending"] is True for it in items)
        assert all(it["sku_base"] == "" for it in items)

        with get_connection() as conn:
            vrows = conn.execute(
                "SELECT sku, COALESCE(sku_pending, 0) AS sku_pending FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE client_id = ?)",
                (client_id,),
            ).fetchall()
            assert len(vrows) == 2
            assert all(str(r["sku"]) == "" and int(r["sku_pending"]) == 1 for r in vrows)
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE client_id = ?)", (client_id,))
            conn.execute("DELETE FROM products WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_assign_sku_to_pending_product(admin_client):
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-assign-{suffix}"
    client_id = f"client-assign-{suffix}"
    color_id = f"color-assign-{suffix}"
    new_sku = f"REAL-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type Assign {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Assign {suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"ColorAssign{suffix}"),
        )
        conn.commit()

    payload = {
        "meta": json.dumps({
            "product": {
                "name": f"Assign {suffix}",
                "type_id": type_id,
                "sku_pending": True,
                "client_id": client_id,
                "is_active": True,
            },
            "colors": [color_id],
            "dimensions": [{"length": 1, "width": 1, "height": 1, "sizes": []}],
        }),
    }

    try:
        created = admin_client.post("/products", data=payload)
        assert created.status_code == 200, created.text
        listed = admin_client.get(f"/products?client_id={client_id}&limit=100")
        product_id = listed.json()["items"][0]["id"]

        res = admin_client.patch(f"/products/{product_id}", json={"sku_base": new_sku})
        assert res.status_code == 200, res.text

        detail = admin_client.get(f"/products/{product_id}")
        assert detail.json()["sku_pending"] is False
        assert detail.json()["sku_base"] == new_sku

        variants = admin_client.get(f"/products/{product_id}/variants")
        assert variants.status_code == 200, variants.text
        vitems = variants.json()
        assert len(vitems) == 1
        assert vitems[0]["sku"].startswith(new_sku)

        with get_connection() as conn:
            row = conn.execute(
                "SELECT COALESCE(sku_pending, 0) AS sku_pending FROM product_variants WHERE product_id = ?",
                (product_id,),
            ).fetchone()
            assert int(row["sku_pending"]) == 0
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE client_id = ?)", (client_id,))
            conn.execute("DELETE FROM products WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_colors_lookup_by_product_id_for_pending_product(admin_client):
    """У товара «ожидает SKU» цвета подбираются по product_id (SKU пустой)."""
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-lk-{suffix}"
    client_id = f"client-lk-{suffix}"
    color_id = f"color-lk-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type Lk {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Lk {suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"ColorLk{suffix}"),
        )
        conn.commit()

    payload = {
        "meta": json.dumps({
            "product": {
                "name": f"Lk {suffix}",
                "type_id": type_id,
                "sku_pending": True,
                "client_id": client_id,
                "is_active": True,
            },
            "colors": [color_id],
            "dimensions": [{"length": 1, "width": 1, "height": 1, "sizes": []}],
        }),
    }

    try:
        created = admin_client.post("/products", data=payload)
        assert created.status_code == 200, created.text
        product_id = admin_client.get(f"/products?client_id={client_id}&limit=100").json()["items"][0]["id"]

        # По пустому SKU цвет не найти — а по product_id находится.
        by_pid = admin_client.get(f"/inventory/lookups/colors-for-sku?product_id={product_id}")
        assert by_pid.status_code == 200, by_pid.text
        ids = {c["id"] for c in by_pid.json()}
        assert color_id in ids

        # Товар в lookup помечен как ожидающий SKU.
        plist = admin_client.get(f"/inventory/lookups/products?client_id={client_id}")
        assert plist.status_code == 200, plist.text
        prod = next(p for p in plist.json() if p["id"] == product_id)
        assert prod["sku_pending"] is True
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE client_id = ?)", (client_id,))
            conn.execute("DELETE FROM products WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_product_boxes_per_pallet_roundtrip(admin_client):
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
                "boxes_per_pallet": 48,
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
        assert items[0]["boxes_per_pallet"] == 48

        detail = admin_client.get(f"/products/{product_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["boxes_per_pallet"] == 48

        updated = admin_client.patch(f"/products/{product_id}", json={"boxes_per_pallet": None})
        assert updated.status_code == 200, updated.text

        detail_after_update = admin_client.get(f"/products/{product_id}")
        assert detail_after_update.status_code == 200, detail_after_update.text
        assert detail_after_update.json()["boxes_per_pallet"] is None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE sku = ?)", (sku,))
            conn.execute("DELETE FROM products WHERE sku = ?", (sku,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_variant_change_identity_moves_stock_and_history(admin_client):
    """Смена цвета варианта с поступлениями: обычный PATCH — 409, change-identity
    переносит журнал/строки на новый ключ, остатки и карточка сходятся."""
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-ident-{suffix}"
    client_id = f"client-ident-{suffix}"
    product_id = f"product-ident-{suffix}"
    red_id = f"color-red-{suffix}"
    yellow_id = f"color-yel-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type Ident {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client Ident {suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (red_id, f"Red{suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (yellow_id, f"Yellow{suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_id, f"Ident Product {suffix}", type_id, client_id, f"IDNT-{suffix}"),
        )
        conn.commit()

    def _variant_payload(color_id: str, variant_id: str | None = None) -> dict:
        return {
            "id": variant_id,
            "sku": "",
            "color_id": color_id,
            "dimension": {"length": 1, "width": 1, "height": 1},
            "size_id": None,
            "images": [],
            "is_active": True,
        }

    try:
        r = admin_client.patch(
            f"/products/{product_id}/variants", json={"variants": [_variant_payload(red_id)]}
        )
        assert r.status_code == 200, r.text
        variant = admin_client.get(f"/products/{product_id}/variants").json()[0]
        variant_id = variant["id"]
        old_sku = variant["sku"]

        # Принятое поступление + приход в журнале — вариант «с историей».
        doc_id = str(uuid.uuid4())
        with get_connection() as conn:
            conn.execute(
                """INSERT INTO receipt_docs
                   (id, doc_number, client_id, status, is_deleted, created_at, created_by)
                   VALUES (?, ?, ?, 'done', 0, NOW(), 'test')""",
                (doc_id, f"WH-T-{suffix}", client_id),
            )
            conn.execute(
                """INSERT INTO receipt_lines
                   (id, doc_id, product_id, product_name, product_sku,
                    color_id, color_name, planned_qty, accepted_qty, is_deleted, created_at)
                   VALUES (?, ?, ?, 'Ident Product', ?, ?, 'Red', 10, 10, 0, NOW())""",
                (str(uuid.uuid4()), doc_id, product_id, old_sku, red_id),
            )
            conn.execute(
                """INSERT INTO zone_relocations
                   (id, product_id, product_name, product_sku, color_id, color_name,
                    client_id, from_op, to_op, from_quality, to_quality, qty, created_at)
                   VALUES (?, ?, 'Ident Product', ?, ?, 'Red', ?, 'intake', 'storage', 'good', 'good', 10, NOW())""",
                (str(uuid.uuid4()), product_id, old_sku, red_id, client_id),
            )
            conn.commit()

        # Обычный PATCH менять цвет по-прежнему отказывается.
        blocked = admin_client.patch(
            f"/products/{product_id}/variants",
            json={"variants": [_variant_payload(yellow_id, variant_id)]},
        )
        assert blocked.status_code == 409, blocked.text

        # Смена без изменений — 400.
        same = admin_client.post(
            f"/products/{product_id}/variants/{variant_id}/change-identity",
            json={"color_id": red_id},
        )
        assert same.status_code == 400, same.text

        moved = admin_client.post(
            f"/products/{product_id}/variants/{variant_id}/change-identity",
            json={"color_id": yellow_id},
        )
        assert moved.status_code == 200, moved.text

        # Вариант: новый цвет, пересозданный SKU; остаток карточки сошёлся по новому ключу.
        fresh = admin_client.get(f"/products/{product_id}/variants").json()[0]
        assert fresh["color_id"] == yellow_id
        assert fresh["sku"] != old_sku
        assert fresh["stock"] == 10
        assert fresh["has_receipts"] is True

        # Остатки: позиция уехала на новый цвет целиком.
        balances = admin_client.get(f"/balances?client_id={client_id}").json()["items"]
        mine = [i for i in balances if i["product_id"] == product_id]
        assert len(mine) == 1, mine
        assert mine[0]["color_id"] == yellow_id
        assert mine[0]["storage_good"] == 10

        with get_connection() as conn:
            rl = conn.execute(
                "SELECT color_id FROM receipt_lines WHERE doc_id = ?", (doc_id,)
            ).fetchone()
            assert rl["color_id"] == yellow_id
            audit = conn.execute(
                "SELECT * FROM variant_identity_changes WHERE variant_id = ?", (variant_id,)
            ).fetchone()
            assert audit is not None
            assert audit["old_color_id"] == red_id and audit["new_color_id"] == yellow_id
            assert int(audit["journal_rows"]) == 1 and int(audit["receipt_rows"]) == 1

        # Занятое сочетание цвета — 400 (второй вариант red → yellow не пройдёт).
        r2 = admin_client.patch(
            f"/products/{product_id}/variants",
            json={"variants": [_variant_payload(yellow_id, variant_id), _variant_payload(red_id)]},
        )
        assert r2.status_code == 200, r2.text
        second_id = next(
            v["id"] for v in admin_client.get(f"/products/{product_id}/variants").json()
            if v["id"] != variant_id
        )
        clash = admin_client.post(
            f"/products/{product_id}/variants/{second_id}/change-identity",
            json={"color_id": yellow_id},
        )
        assert clash.status_code == 400, clash.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM variant_identity_changes WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM receipt_lines WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM product_variants WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.execute("DELETE FROM colors WHERE id IN (?, ?)", (red_id, yellow_id))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()


def test_product_card_stock_excludes_written_off(admin_client):
    """Карточка товара считает остаток как модуль остатков: списание
    (… → written_off) уменьшает остаток наравне с отгрузкой."""
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-wo-{suffix}"
    client_id = f"client-wo-{suffix}"
    product_id = f"product-wo-{suffix}"
    color_id = f"color-wo-{suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, requires_color, requires_size, is_deleted, created_at)
            VALUES (?, ?, 1, 1, 0, 0, NOW())
            """,
            (type_id, f"Type WO {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client WO {suffix}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"ColorWO{suffix}"),
        )
        conn.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, sku, is_active, is_deleted, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, NOW())
            """,
            (product_id, f"WO Product {suffix}", type_id, client_id, f"WOPR-{suffix}"),
        )
        conn.commit()

    def _move(conn, from_op, to_op, from_q, to_q, qty):
        conn.execute(
            """INSERT INTO zone_relocations
               (id, product_id, product_name, product_sku, color_id, color_name,
                client_id, from_op, to_op, from_quality, to_quality, qty, created_at)
               VALUES (?, ?, 'WO Product', ?, ?, 'ColorWO', ?, ?, ?, ?, ?, ?, NOW())""",
            (str(uuid.uuid4()), product_id, f"WOPR-{suffix}", color_id, client_id,
             from_op, to_op, from_q, to_q, qty),
        )

    try:
        r = admin_client.patch(
            f"/products/{product_id}/variants",
            json={"variants": [{
                "id": None, "sku": "", "color_id": color_id,
                "dimension": {"length": 1, "width": 1, "height": 1},
                "size_id": None, "images": [], "is_active": True,
            }]},
        )
        assert r.status_code == 200, r.text

        with get_connection() as conn:
            _move(conn, "intake", "storage", "good", "good", 10)     # приход
            _move(conn, "storage", "shipped", "good", "good", 2)     # отгрузка
            _move(conn, "storage", "written_off", "good", "good", 3) # списание годного
            _move(conn, "storage", "storage", "good", "defect", 2)   # перевод в брак
            _move(conn, "storage", "written_off", "defect", "defect", 1)  # списание брака
            conn.commit()

        # Годный: 10 − 2 − 3 − 2 = 3; брак: 2 − 1 = 1.
        detail = admin_client.get(f"/products/{product_id}").json()
        assert detail["stock_total"] == 3
        assert detail["defect_total"] == 1

        listed = admin_client.get(f"/products?client_id={client_id}").json()["items"]
        assert len(listed) == 1
        assert listed[0]["stock_total"] == 3
        assert listed[0]["defect_total"] == 1

        variant = admin_client.get(f"/products/{product_id}/variants").json()[0]
        assert variant["stock"] == 3
        assert variant["defect_qty"] == 1
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM product_variants WHERE product_id = ?", (product_id,))
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
            conn.commit()
