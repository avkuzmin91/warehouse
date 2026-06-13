from __future__ import annotations

import uuid

from dbconn import get_connection


def test_carrier_update_accepts_full_list_payload(admin_client):
    suffix = uuid.uuid4().hex[:10]
    carrier_id = f"carrier-full-{suffix}"
    old_name = f"Carrier Old {suffix}"
    new_name = f"Carrier New {suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO carriers (id, name, is_active, is_deleted, created_at)
            VALUES (?, ?, 1, 0, NOW())
            """,
            (carrier_id, old_name),
        )
        conn.commit()

    try:
        payload = {
            "id": carrier_id,
            "name": new_name,
            "color_hex": None,
            "is_active": True,
            "is_deleted": False,
            "deleted_at": None,
            "deleted_by": None,
            "created_at": "2026-05-27T05:36:45.401897+00:00",
            "created_by": "admin@example.com",
            "updated_at": None,
            "updated_by": None,
        }
        res = admin_client.patch(f"/carriers/{carrier_id}", json=payload)
        assert res.status_code == 200, res.text

        check = admin_client.get(f"/carriers/{carrier_id}")
        assert check.status_code == 200, check.text
        assert check.json()["name"] == new_name
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM carriers WHERE id = ?", (carrier_id,))
            conn.commit()


def test_carrier_duplicate_name_returns_400(admin_client):
    suffix = uuid.uuid4().hex[:10]
    carrier_a = f"carrier-a-{suffix}"
    carrier_b = f"carrier-b-{suffix}"
    name_a = f"Carrier Duplicate {suffix}"

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO carriers (id, name, is_active, is_deleted, created_at)
            VALUES (?, ?, 1, 0, NOW())
            """,
            (carrier_a, name_a),
        )
        conn.execute(
            """
            INSERT INTO carriers (id, name, is_active, is_deleted, created_at)
            VALUES (?, ?, 1, 0, NOW())
            """,
            (carrier_b, f"Carrier Other {suffix}"),
        )
        conn.commit()

    try:
        res = admin_client.patch(f"/carriers/{carrier_b}", json={"name": name_a, "is_active": True})
        assert res.status_code == 400, res.text
        assert res.json()["detail"] == "Запись с таким названием уже существует"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM carriers WHERE id IN (?, ?)", (carrier_a, carrier_b))
            conn.commit()


def test_client_store_rename_propagates_to_shipment_lines(admin_client):
    suffix = uuid.uuid4().hex[:10]
    client_id = f"client-{suffix}"
    store_id = f"store-{suffix}"
    doc_id = str(uuid.uuid4())
    line_id = str(uuid.uuid4())
    old_name = f"Store Old {suffix}"
    new_name = f"Store New {suffix}"

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client {suffix}"),
        )
        conn.execute(
            "INSERT INTO client_stores (id, client_id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, 1, 0, NOW())",
            (store_id, client_id, old_name),
        )
        conn.execute(
            """INSERT INTO shipment_docs
               (id, doc_number, client_id, client_name, status, is_deleted, created_at, created_by)
               VALUES (?, ?, ?, 'Test Client', 'draft', 0, NOW(), 'test')""",
            (doc_id, f"SHP-T-{doc_id}", client_id),
        )
        conn.execute(
            """INSERT INTO shipment_lines
               (id, doc_id, product_id, product_name, product_sku,
                qty, shipped_qty, store_id, store_name, is_deleted, created_at)
               VALUES (?, ?, ?, 'Test Product', 'TST-SKU', 1, 0, ?, ?, 0, NOW())""",
            (line_id, doc_id, str(uuid.uuid4()), store_id, old_name),
        )
        conn.commit()

    try:
        res = admin_client.patch(f"/clients/{client_id}/stores/{store_id}", json={"name": new_name})
        assert res.status_code == 200, res.text

        with get_connection() as conn:
            row = conn.execute("SELECT store_name FROM shipment_lines WHERE id = ?", (line_id,)).fetchone()
        assert row["store_name"] == new_name
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM shipment_lines WHERE id = ?", (line_id,))
            conn.execute("DELETE FROM shipment_docs WHERE id = ?", (doc_id,))
            conn.execute("DELETE FROM client_stores WHERE id = ?", (store_id,))
            conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
            conn.commit()


def test_set_packing_zone_is_exclusive(admin_client):
    suffix = uuid.uuid4().hex[:10]
    zone_a = f"zone-a-{suffix}"
    zone_b = f"zone-b-{suffix}"
    with get_connection() as conn:
        for zid, nm in ((zone_a, f"ZoneA {suffix}"), (zone_b, f"ZoneB {suffix}")):
            conn.execute(
                "INSERT INTO unloading_zones (id, name, is_active, is_deleted, is_packing_zone, created_at) "
                "VALUES (?, ?, 1, 0, 0, NOW())",
                (zid, nm),
            )
        conn.commit()
    try:
        r = admin_client.post(f"/unloading-zones/{zone_a}/set-packing")
        assert r.status_code == 200, r.text
        with get_connection() as conn:
            flags = {row["id"]: row["is_packing_zone"] for row in conn.execute(
                "SELECT id, is_packing_zone FROM unloading_zones WHERE id IN (?, ?)", (zone_a, zone_b)
            ).fetchall()}
        assert flags[zone_a] == 1 and flags[zone_b] == 0
        # Назначение другой зоны снимает флаг с прежней (ровно одна).
        admin_client.post(f"/unloading-zones/{zone_b}/set-packing")
        with get_connection() as conn:
            flags = {row["id"]: row["is_packing_zone"] for row in conn.execute(
                "SELECT id, is_packing_zone FROM unloading_zones WHERE id IN (?, ?)", (zone_a, zone_b)
            ).fetchall()}
        assert flags[zone_a] == 0 and flags[zone_b] == 1
        # Список отдаёт флаг.
        lst = admin_client.get("/unloading-zones?limit=100").json()["items"]
        b_item = next(i for i in lst if i["id"] == zone_b)
        assert b_item["is_packing_zone"] is True
    finally:
        with get_connection() as conn:
            # Вернём флаг засеянной «Зоне упаковки», чтобы не сломать другие тесты.
            conn.execute("DELETE FROM unloading_zones WHERE id IN (?, ?)", (zone_a, zone_b))
            seed = conn.execute("SELECT id FROM unloading_zones WHERE name = 'Зона упаковки' ORDER BY created_at LIMIT 1").fetchone()
            if seed:
                conn.execute("UPDATE unloading_zones SET is_packing_zone = CASE WHEN id = ? THEN 1 ELSE 0 END", (seed["id"],))
            conn.commit()
