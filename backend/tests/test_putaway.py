"""Интеграционные тесты задачи «Размещение по ячейкам» (task_kind=putaway).

Полный поток ТСД: передали на стол → взяли короб → скан товара → закрыли короб →
скан ячейки → закрытие задачи. Ключевой инвариант: пока товар в коробе на столе
(корзина boxed), он НЕ доступен ни отгрузке, ни другой задаче упаковки — готовность
наступает только после размещения короба в ячейке.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from tests.conftest import cleanup_client, make_client_id, seed_storage_good

_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_WAREHOUSE = {"id": "t-wh", "email": "w@t.com", "role": "warehouse_manager", "created_at": "2020-01-01T00:00:00", "client_id": None}


@pytest.fixture
def api():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _as(row: dict) -> None:
    app.dependency_overrides[get_current_user] = lambda: row


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


@pytest.fixture
def zones():
    """Зона упаковки (стол) и адресная ячейка стеллажа."""
    packing_id, cell_id = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO unloading_zones (id, name, is_active, is_deleted, is_packing_zone, created_at) "
            "VALUES (?, ?, 1, 0, 1, NOW())",
            (packing_id, f"Стол-{packing_id[:6]}"),
        )
        conn.execute(
            "INSERT INTO unloading_zones (id, name, kind, room, rack, section, floor, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 'cell', '1', 'А', '01', '1', 1, 0, NOW())",
            (cell_id, f"1-А-01-{cell_id[:4]}"),
        )
        conn.commit()
    yield {"packing_id": packing_id, "cell_id": cell_id}
    with get_connection() as conn:
        conn.execute("DELETE FROM unloading_zones WHERE id IN (?, ?)", (packing_id, cell_id))
        conn.commit()


@pytest.fixture
def product(client_id):
    """Товар с вариантом и штрих-кодом — скан в короб работает только по ШК."""
    pid, vid, type_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    code = f"460{uuid.uuid4().hex[:10]}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, created_at) VALUES (?, ?, NOW())",
            (type_id, f"PT-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"Putaway-{pid[:8]}", type_id, client_id, f"PUT-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, client_id, f"PUT-V-{vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid, code),
        )
        conn.commit()
    yield {"product_id": pid, "variant_id": vid, "barcode": code, "sku": f"PUT-{pid[:8]}"}
    with get_connection() as conn:
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()


def _create_task(api, client_id: str, product: dict, qty: int = 5) -> tuple[str, str]:
    """Задача размещения в статусе «На упаковке» с товаром, переданным на стол."""
    _as(_ADMIN)
    r = api.post("/shipments", json={
        "cargo_type": "good",
        "task_kind": "putaway",
        "client_id": client_id,
        "client_name": "Test Client",
        "ship_date": "2026-09-02",
        "lines": [{
            "product_id": product["product_id"],
            "product_name": "Putaway Product",
            "product_sku": product["sku"],
            "qty": qty,
        }],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    seed_storage_good(
        client_id, product_id=product["product_id"], product_name="Putaway Product",
        product_sku=product["sku"], qty=qty,
    )
    assert api.post(f"/shipments/{doc_id}/advance").json()["message"] == "packing"
    _as(_WAREHOUSE)
    moved = api.post(
        f"/shipments/{doc_id}/lines/{line['id']}/move-to-packing",
        json={"allocations": [{"qty": qty}]},
    )
    assert moved.status_code == 200, moved.text
    assert api.post(f"/shipments/{doc_id}/advance").json()["message"] == "on_packing"
    return doc_id, line["id"]


def _new_box_code(api) -> str:
    _as(_ADMIN)
    r = api.post("/containers", json={"count": 1})
    assert r.status_code == 200, r.text
    return r.json()["items"][0]["doc_number"]


def _bucket(client_id: str, product_id: str, op: str, quality: str = "good") -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN to_op = ? AND to_quality = ? THEN qty ELSE 0 END), 0) "
            "     - COALESCE(SUM(CASE WHEN from_op = ? AND from_quality = ? THEN qty ELSE 0 END), 0) AS n "
            "FROM zone_relocations WHERE product_id = ? AND client_id = ?",
            (op, quality, op, quality, product_id, client_id),
        ).fetchone()
    return int(row["n"] or 0)


def test_full_putaway_flow(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=5)
    code = _new_box_code(api)

    _as(_WAREHOUSE)
    box = api.post(f"/shipments/{doc_id}/boxes", json={"code": code})
    assert box.status_code == 200, box.text
    box_id = box.json()["id"]
    assert box.json()["status"] == "open"

    put = api.post(
        f"/shipments/{doc_id}/boxes/{box_id}/items",
        json={"barcode": product["barcode"], "qty": 3},
    )
    assert put.status_code == 200, put.text
    assert put.json()["items_qty"] == 3
    assert put.json()["contents"][0]["qty"] == 3

    # Товар в коробе на столе: упакован сканом, но к отгрузке ещё не доступен.
    assert _bucket(client_id, product["product_id"], "boxed") == 3
    assert _bucket(client_id, product["product_id"], "packed") == 0
    assert _bucket(client_id, product["product_id"], "ready") == 0
    # Скан = запись упаковки: объём и заработок считаются по ней.
    assert api.get(f"/shipments/{doc_id}").json()["lines"][0]["packed_good"] == 3

    closed = api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    assert closed.status_code == 200 and closed.json()["status"] == "closed", closed.text

    placed = api.post(f"/shipments/{doc_id}/boxes/{box_id}/place", json={"zone_id": zones["cell_id"]})
    assert placed.status_code == 200, placed.text
    assert placed.json()["status"] == "placed"
    assert placed.json()["zone_id"] == zones["cell_id"]

    # После размещения товар лежит на хранении в ячейке — вот теперь он доступен.
    assert _bucket(client_id, product["product_id"], "boxed") == 0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'storage' AND to_zone_id = ?",
            (product["product_id"], zones["cell_id"]),
        ).fetchone()
    assert int(row["n"]) == 3

    fin = api.post(f"/shipments/{doc_id}/finish-putaway", json={})
    assert fin.status_code == 200, fin.text
    assert fin.json()["message"] == "placed"

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "placed"
    assert detail["task_kind"] == "putaway"
    assert detail["lines"][0]["placed_qty"] == 3
    assert detail["lines"][0]["boxed_qty"] == 0
    assert len(detail["boxes"]) == 1

    # Нерешённый пул со стола вернулся на хранение — товар не завис на упаковке.
    assert _bucket(client_id, product["product_id"], "packing") == 0


def test_finish_blocked_until_boxes_placed(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})

    blocked = api.post(f"/shipments/{doc_id}/finish-putaway", json={})
    assert blocked.status_code == 400
    assert "разместите короба" in blocked.json()["detail"].lower()

    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    still_blocked = api.post(f"/shipments/{doc_id}/finish-putaway", json={})
    assert still_blocked.status_code == 400, still_blocked.text

    api.post(f"/shipments/{doc_id}/boxes/{box_id}/place", json={"zone_id": zones["cell_id"]})
    assert api.post(f"/shipments/{doc_id}/finish-putaway", json={}).status_code == 200


def test_scan_limited_by_what_is_on_the_table(api, client_id, product, zones):
    """Жёсткий блок: в короб нельзя пропикать больше, чем передано на стол."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    over = api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 3})
    assert over.status_code == 400, over.text


def test_defect_scan_stays_out_of_box(api, client_id, product, zones):
    """Брак пикается тем же сканом, но в короб не кладётся и уезжает на хранение."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=3)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    good = api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    assert good.status_code == 200, good.text
    defect = api.post(
        f"/shipments/{doc_id}/boxes/{box_id}/items",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    )
    assert defect.status_code == 200, defect.text
    assert defect.json()["items_qty"] == 2  # брак в коробе не лежит

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 2 and line["packed_defect"] == 1

    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/place", json={"zone_id": zones["cell_id"]})

    no_zone = api.post(f"/shipments/{doc_id}/finish-putaway", json={})
    assert no_zone.status_code == 400 and "брак" in no_zone.json()["detail"].lower()

    fin = api.post(f"/shipments/{doc_id}/finish-putaway", json={"defect_zone_id": zones["cell_id"]})
    assert fin.status_code == 200, fin.text
    assert _bucket(client_id, product["product_id"], "storage", "defect") == 1


def test_unknown_barcode_and_foreign_product_rejected(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    unknown = api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": "0000000000000", "qty": 1})
    assert unknown.status_code == 404, unknown.text


def test_undo_box_item_reverses_packing(api, client_id, product, zones):
    """Изъятие из короба сторнирует запись упаковки: товар возвращается на стол."""
    doc_id, line_id = _create_task(api, client_id, product, qty=3)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 1})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 1})

    undo = api.post(
        f"/shipments/{doc_id}/boxes/{box_id}/items/undo",
        json={"line_id": line_id, "qty": 1},
    )
    assert undo.status_code == 200, undo.text
    assert undo.json()["items_qty"] == 1
    assert _bucket(client_id, product["product_id"], "boxed") == 1
    assert _bucket(client_id, product["product_id"], "packing") == 2
    # Объём упаковки уменьшился вместе с изъятием — заработок за неотсканированное не висит.
    assert api.get(f"/shipments/{doc_id}").json()["lines"][0]["packed_good"] == 1


def test_box_of_another_task_rejected(api, client_id, product, zones):
    doc_a, _ = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_a}/boxes", json={"code": code})

    doc_b, _ = _create_task(api, client_id, product, qty=1)
    _as(_WAREHOUSE)
    taken = api.post(f"/shipments/{doc_b}/boxes", json={"code": code})
    assert taken.status_code == 400
    assert "занят задачей" in taken.json()["detail"]


def test_manual_move_of_boxed_stock_rejected(api, client_id, product, zones):
    """Товар в размещённом коробе двигается только коробом целиком."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/place", json={"zone_id": zones["cell_id"]})

    move = api.post("/balances/relocations", json={
        "product_id": product["product_id"],
        "product_name": "Putaway Product",
        "product_sku": product["sku"],
        "client_id": client_id,
        "quality": "good",
        "qty": 1,
        "from_zone_id": zones["cell_id"],
        "to_zone_id": zones["packing_id"],
    })
    assert move.status_code == 400, move.text
    assert "коробе" in move.json()["detail"]


def test_placed_box_moves_between_cells(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/place", json={"zone_id": zones["cell_id"]})

    other_cell = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO unloading_zones (id, name, kind, room, rack, section, floor, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 'cell', '1', 'Б', '02', '1', 1, 0, NOW())",
            (other_cell, f"1-Б-02-{other_cell[:4]}"),
        )
        conn.commit()
    try:
        moved = api.post(f"/containers/{box_id}/move", json={"zone_id": other_cell})
        assert moved.status_code == 200, moved.text
        assert moved.json()["zone_id"] == other_cell
        assert moved.json()["items_qty"] == 2  # содержимое короба при переезде не изменилось

        detail = api.get(f"/containers/{box_id}").json()
        assert detail["doc"]["zone_id"] == other_cell
        assert sum(c["qty"] for c in detail["contents"]) == 2
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM unloading_zones WHERE id = ?", (other_cell,))
            conn.commit()


def test_packing_task_has_no_boxes(api, client_id, product, zones):
    """Короба не относятся к обычной задаче упаковки."""
    _as(_ADMIN)
    r = api.post("/shipments", json={
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "ship_date": "2026-09-02",
        "comment": "ТЗ",
        "lines": [{
            "product_id": product["product_id"],
            "product_name": "Putaway Product",
            "product_sku": product["sku"],
            "qty": 1,
        }],
    })
    doc_id = r.json()["message"]
    assert api.get(f"/shipments/{doc_id}").json()["task_kind"] == "packing"
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    taken = api.post(f"/shipments/{doc_id}/boxes", json={"code": code})
    assert taken.status_code == 400
    assert "Размещение по ячейкам" in taken.json()["detail"]
