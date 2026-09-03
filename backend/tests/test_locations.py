"""Адресное хранение: справочник ячеек, генерация, печать QR, сканер-lookup."""
from __future__ import annotations

import uuid

from dbconn import get_connection


def _cleanup_room(room: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM unloading_zones WHERE room = ?", (room.upper(),))
        conn.commit()


def test_bulk_create_generates_grid_and_pads_codes(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        r = admin_client.post(
            "/locations/bulk",
            json={"room": room, "racks": ["А", "Б"], "sections": 3, "floors": 2},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # 2 стеллажа × 3 секции × 2 этажа = 12 ячеек
        assert body["created"] == 12
        assert body["skipped"] == 0

        lst = admin_client.get("/locations", params={"room": room, "limit": 500}).json()
        assert lst["total"] == 12
        codes = [it["code"] for it in lst["items"]]
        # секция дополнена нулём, сортировка корректна
        assert f"{room.upper()}-А-01-1" in codes
        assert f"{room.upper()}-Б-03-2" in codes
        first = lst["items"][0]
        assert first["code"] == f"{room.upper()}-А-01-1"
        assert first["section"] == "01"
        assert first["kind"] == "cell"
    finally:
        _cleanup_room(room)


def test_bulk_create_is_idempotent(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        admin_client.post(
            "/locations/bulk", json={"room": room, "racks": ["А"], "sections": 2, "floors": 1}
        )
        r2 = admin_client.post(
            "/locations/bulk", json={"room": room, "racks": ["А"], "sections": 3, "floors": 1}
        )
        body = r2.json()
        assert body["created"] == 1  # добавилась только новая секция 03
        assert body["skipped"] == 2
    finally:
        _cleanup_room(room)


def test_create_single_and_duplicate_rejected(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        r = admin_client.post(
            "/locations", json={"room": room, "rack": "в", "section": 5, "floor": 2}
        )
        assert r.status_code == 200, r.text
        loc = r.json()
        assert loc["code"] == f"{room.upper()}-В-05-2"  # сегменты в верхнем регистре
        assert loc["rack"] == "В"

        dup = admin_client.post(
            "/locations", json={"room": room, "rack": "В", "section": 5, "floor": 2}
        )
        assert dup.status_code == 400
    finally:
        _cleanup_room(room)


def test_lookup_by_id_prefix_and_code(admin_client, warehouse_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        loc = admin_client.post(
            "/locations", json={"room": room, "rack": "А", "section": 1, "floor": 1}
        ).json()
        loc_id = loc["id"]
        code = loc["code"]

        # по голому id
        r1 = warehouse_client.get(f"/locations/by-code/{loc_id}").json()
        assert r1["found"] is True and r1["location"]["id"] == loc_id

        # по payload QR «wms:loc:<id>»
        r2 = warehouse_client.get(f"/locations/by-code/wms:loc:{loc_id}").json()
        assert r2["found"] is True and r2["location"]["code"] == code

        # по человекочитаемому коду
        r3 = warehouse_client.get(f"/locations/by-code/{code}").json()
        assert r3["found"] is True and r3["location"]["id"] == loc_id

        # не найдено
        r4 = warehouse_client.get("/locations/by-code/wms:loc:nope-nope").json()
        assert r4["found"] is False
    finally:
        _cleanup_room(room)


def test_labels_carry_qr_svg(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        admin_client.post(
            "/locations/bulk", json={"room": room, "racks": ["А"], "sections": 2, "floors": 1}
        )
        r = admin_client.get("/locations/labels", params={"room": room})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 2
        for it in items:
            assert it["payload"] == f"wms:loc:{it['id']}"
            assert "<svg" in it["qr_svg"]
    finally:
        _cleanup_room(room)


def test_labels_by_selected_ids(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        admin_client.post(
            "/locations/bulk", json={"room": room, "racks": ["А"], "sections": 3, "floors": 1}
        )
        lst = admin_client.get("/locations", params={"room": room, "limit": 500}).json()["items"]
        assert len(lst) == 3
        chosen = [lst[0]["id"], lst[2]["id"]]

        r = admin_client.get("/locations/labels", params={"ids": ",".join(chosen)})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # ровно выбранные места, у каждого свой QR
        assert {it["id"] for it in items} == set(chosen)
        for it in items:
            assert "<svg" in it["qr_svg"]
    finally:
        _cleanup_room(room)


def test_bulk_delete_hides_cells_and_is_idempotent(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        admin_client.post(
            "/locations/bulk", json={"room": room, "racks": ["А"], "sections": 3, "floors": 1}
        )
        lst = admin_client.get("/locations", params={"room": room, "limit": 500}).json()["items"]
        assert len(lst) == 3
        chosen = [lst[0]["id"], lst[2]["id"]]

        r = admin_client.post("/locations/bulk-delete", json={"ids": chosen})
        assert r.status_code == 200, r.text
        assert r.json() == {"deleted": 2, "skipped": 0}

        left = admin_client.get("/locations", params={"room": room, "limit": 500}).json()
        assert left["total"] == 1
        assert left["items"][0]["id"] == lst[1]["id"]

        # повтор (обрыв связи / двойной клик) ничего не ломает
        r2 = admin_client.post("/locations/bulk-delete", json={"ids": chosen})
        assert r2.json() == {"deleted": 0, "skipped": 2}
    finally:
        _cleanup_room(room)


def test_bulk_delete_requires_ids_and_backoffice(admin_client, shift_supervisor_client):
    empty = admin_client.post("/locations/bulk-delete", json={"ids": []})
    assert empty.status_code == 422

    forbidden = shift_supervisor_client.post(
        "/locations/bulk-delete", json={"ids": [str(uuid.uuid4())]}
    )
    assert forbidden.status_code == 403


def test_delete_hides_cell_from_list(admin_client):
    room = f"T{uuid.uuid4().hex[:4]}"
    try:
        loc = admin_client.post(
            "/locations", json={"room": room, "rack": "А", "section": 1, "floor": 1}
        ).json()
        d = admin_client.delete(f"/locations/{loc['id']}")
        assert d.status_code == 200, d.text
        lst = admin_client.get("/locations", params={"room": room}).json()
        assert lst["total"] == 0
    finally:
        _cleanup_room(room)
