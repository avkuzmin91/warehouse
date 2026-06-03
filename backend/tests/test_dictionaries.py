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
