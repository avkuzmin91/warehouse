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


def test_bulk_create_numbers_sort_order_and_skips_duplicates(admin_client):
    suffix = uuid.uuid4().hex[:8]
    names = [f"Position {suffix} A", f"Position {suffix} B", f"Position {suffix} C"]

    try:
        first = admin_client.post("/positions/bulk", json={"names": names[:1], "is_active": True})
        assert first.status_code == 200, first.text
        assert first.json()["created"] == 1

        # Повтор первого значения не должен отменять остальные
        res = admin_client.post("/positions/bulk", json={"names": names, "is_active": True})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["created"] == 2
        assert body["skipped"] == [names[0]]

        with get_connection() as conn:
            rows = conn.execute(
                "SELECT name, sort_order FROM positions WHERE name LIKE ? ORDER BY sort_order",
                (f"Position {suffix}%",),
            ).fetchall()
        orders = [int(r["sort_order"]) for r in rows]
        assert len(orders) == 3
        # Нумерация продолжает справочник шагом 10
        assert orders[1] - orders[0] == 10
        assert orders[2] - orders[1] == 10
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM positions WHERE name LIKE ?", (f"Position {suffix}%",))
            conn.commit()


def test_dictionary_order_puts_sort_order_first_then_natural_names(admin_client):
    suffix = uuid.uuid4().hex[:8]
    created: list[str] = []
    try:
        for name in (f"{suffix}-104", f"{suffix}-9", f"{suffix}-35"):
            res = admin_client.post("/sizes", json={"name": name, "is_active": True})
            assert res.status_code == 200, res.text
        listed = admin_client.get(f"/sizes?name={suffix}&limit=50")
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        created = [i["id"] for i in items]
        # Числовой префикс отсутствует (имена начинаются с suffix) — сортировка по имени
        assert len(items) == 3

        # Явный порядок поднимает значение наверх независимо от имени
        last = next(i for i in items if i["name"].endswith("-9"))
        patched = admin_client.patch(f"/sizes/{last['id']}", json={"sort_order": 5})
        assert patched.status_code == 200, patched.text
        again = admin_client.get(f"/sizes?name={suffix}&limit=50").json()["items"]
        assert again[0]["name"].endswith("-9")
        assert again[0]["sort_order"] == 5

        # Сброс порядка возвращает значение в общий алфавитный хвост
        cleared = admin_client.patch(f"/sizes/{last['id']}", json={"clear_sort_order": True})
        assert cleared.status_code == 200, cleared.text
        after = admin_client.get(f"/sizes?name={suffix}&limit=50").json()["items"]
        assert after[0]["sort_order"] is None
    finally:
        with get_connection() as conn:
            for item_id in created:
                conn.execute("DELETE FROM sizes WHERE id = ?", (item_id,))
            conn.commit()


def test_lookup_sizes_respects_sort_order(admin_client):
    suffix = uuid.uuid4().hex[:8]
    created: list[str] = []
    try:
        for name, order in ((f"{suffix}-zz", 1), (f"{suffix}-aa", 2)):
            res = admin_client.post("/sizes", json={"name": name, "is_active": True, "sort_order": order})
            assert res.status_code == 200, res.text
        listed = admin_client.get(f"/sizes?name={suffix}&limit=50").json()["items"]
        created = [i["id"] for i in listed]

        rows = admin_client.get("/inventory/lookups/sizes")
        assert rows.status_code == 200, rows.text
        names = [r["name"] for r in rows.json() if r["name"].startswith(suffix)]
        # Порядок задан вручную — подбор обязан идти по нему, а не по алфавиту
        assert names == [f"{suffix}-zz", f"{suffix}-aa"]
    finally:
        with get_connection() as conn:
            for item_id in created:
                conn.execute("DELETE FROM sizes WHERE id = ?", (item_id,))
            conn.commit()


def test_reorder_assigns_sort_order_by_position(admin_client):
    suffix = uuid.uuid4().hex[:8]
    names = [f"Position {suffix} A", f"Position {suffix} B", f"Position {suffix} C"]
    try:
        res = admin_client.post("/positions/bulk", json={"names": names, "is_active": True})
        assert res.status_code == 200, res.text

        with get_connection() as conn:
            rows = conn.execute(
                "SELECT id, name FROM positions WHERE name LIKE ? ORDER BY sort_order",
                (f"Position {suffix}%",),
            ).fetchall()
        ids = {str(r["name"]): str(r["id"]) for r in rows}
        assert [str(r["name"]) for r in rows] == names

        # Переставляем последнее значение в начало — как перетаскиванием строки
        moved = admin_client.post(
            "/positions/reorder",
            json={"ids": [ids[names[2]], ids[names[0]], ids[names[1]]]},
        )
        assert moved.status_code == 200, moved.text

        with get_connection() as conn:
            after = conn.execute(
                "SELECT name, sort_order FROM positions WHERE name LIKE ? ORDER BY sort_order",
                (f"Position {suffix}%",),
            ).fetchall()
        assert [str(r["name"]) for r in after] == [names[2], names[0], names[1]]
        # Номера проставляет система: позиция × 10, без дыр от прежней нумерации
        orders = [int(r["sort_order"]) for r in after]
        assert orders == sorted(orders)
        assert len(set(orders)) == 3
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM positions WHERE name LIKE ?", (f"Position {suffix}%",))
            conn.commit()


def test_reorder_keeps_values_outside_the_sent_page(admin_client):
    suffix = uuid.uuid4().hex[:8]
    names = [f"Position {suffix} A", f"Position {suffix} B", f"Position {suffix} C"]
    try:
        admin_client.post("/positions/bulk", json={"names": names, "is_active": True})
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT id, name FROM positions WHERE name LIKE ? ORDER BY sort_order",
                (f"Position {suffix}%",),
            ).fetchall()
        ids = {str(r["name"]): str(r["id"]) for r in rows}

        # Присылаем только два id — третье значение не должно потеряться
        res = admin_client.post("/positions/reorder", json={"ids": [ids[names[1]], ids[names[0]]]})
        assert res.status_code == 200, res.text

        with get_connection() as conn:
            after = conn.execute(
                "SELECT name, sort_order FROM positions WHERE name LIKE ? ORDER BY sort_order",
                (f"Position {suffix}%",),
            ).fetchall()
        assert [str(r["name"]) for r in after][:2] == [names[1], names[0]]
        assert all(r["sort_order"] is not None for r in after)
        assert len(after) == 3
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM positions WHERE name LIKE ?", (f"Position {suffix}%",))
            conn.commit()
