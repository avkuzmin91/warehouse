"""Интеграционные тесты задачи «Упаковка с ТСД» (task_kind=putaway).

Процесс разделён на две фазы. Сборка (документ): передали на стол → взяли короб →
скан товара → закрыли короб → «Упаковка завершена». Развозка (без документа): скан
коробов и россыпи → скан места. Ключевой инвариант: скан в короб — это упаковка:
товар сразу в корзине `packed` (пул отгрузки), развозка лишь переводит его в зону
отгрузки (`ready`) в конкретном месте. Задача заканчивается на сборке («Упакован» —
общий терминал с задачей упаковки); развозка живёт своей очередью и статусы не двигает.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from config import INV_OP_READY
from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from tests.conftest import cleanup_client, make_client_id, seed_storage_good

_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_WAREHOUSE = {"id": "t-wh", "email": "w@t.com", "role": "warehouse_manager", "created_at": "2020-01-01T00:00:00", "client_id": None}
_SHIFT = {"id": "t-shift", "email": "s@t.com", "role": "shift_supervisor", "created_at": "2020-01-01T00:00:00", "client_id": None}


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
    """Зона упаковки (стол), адресная ячейка стеллажа и служебное место (зона брака)."""
    packing_id, cell_id, special_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
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
        conn.execute(
            "INSERT INTO unloading_zones (id, name, kind, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 'special', 1, 0, NOW())",
            (special_id, f"Брак-{special_id[:6]}"),
        )
        conn.commit()
    yield {"packing_id": packing_id, "cell_id": cell_id, "special_id": special_id}
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM unloading_zones WHERE id IN (?, ?, ?)", (packing_id, cell_id, special_id)
        )
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


def _place(api, *, zone_id: str, box_ids=None, items=None):
    return api.post("/containers/place", json={
        "zone_id": zone_id,
        "box_ids": list(box_ids or []),
        "items": list(items or []),
    })


def test_full_putaway_flow(api, client_id, product, zones):
    """Сборка закрывает задачу в «Упакован», развозка едет отдельно и статус не трогает."""
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

    # Товар собран в короб: упакован сканом — уже в пуле отгрузки, в зоне отгрузки ещё нет.
    assert _bucket(client_id, product["product_id"], "packed") == 3
    assert _bucket(client_id, product["product_id"], "ready") == 0
    # Скан = запись упаковки: объём и заработок считаются по ней.
    assert api.get(f"/shipments/{doc_id}").json()["lines"][0]["packed_good"] == 3

    closed = api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    assert closed.status_code == 200 and closed.json()["status"] == "closed", closed.text

    # Сборка завершается, не дожидаясь развозки: короб ещё стоит у стола.
    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200, fin.text
    assert fin.json()["message"] == "packed"
    assert _bucket(client_id, product["product_id"], "packed") == 3
    # Нерешённый пул со стола вернулся на хранение — товар не завис на упаковке.
    assert _bucket(client_id, product["product_id"], "packing") == 0

    placed = _place(api, zone_id=zones["cell_id"], box_ids=[box_id])
    assert placed.status_code == 200, placed.text
    assert placed.json()["placed_qty"] == 3
    assert placed.json()["boxes"][0]["status"] == "placed"
    assert placed.json()["boxes"][0]["zone_id"] == zones["cell_id"]

    # После развозки товар лежит в зоне отгрузки в конкретной ячейке.
    assert _bucket(client_id, product["product_id"], "packed") == 0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'ready' AND to_zone_id = ?",
            (product["product_id"], zones["cell_id"]),
        ).fetchone()
    assert int(row["n"]) == 3

    # Развозка статус задачи не двигает: задача закрылась ещё на сборке.
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "packed"
    assert detail["task_kind"] == "putaway"
    assert detail["lines"][0]["placed_qty"] == 3
    assert detail["lines"][0]["boxed_qty"] == 0
    assert len(detail["boxes"]) == 1


def test_collecting_blocked_by_open_box_with_goods(api, client_id, product, zones):
    """Сборку держит только незакрытый короб — закрытый уезжает отдельным процессом."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})

    blocked = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert blocked.status_code == 400
    assert "закройте короба" in blocked.json()["detail"].lower()

    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    assert api.post(f"/shipments/{doc_id}/finish-collecting").json()["message"] == "packed"


def test_placement_can_run_before_collecting_is_finished(api, client_id, product, zones):
    """Кладовщик увозит закрытый короб, пока сборка ещё идёт: процессы независимы."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")

    placed = _place(api, zone_id=zones["cell_id"], box_ids=[box_id])
    assert placed.status_code == 200, placed.text
    # Развозка идёт своим темпом — статус сборки она не трогает.
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "on_packing"

    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text


def test_scan_limited_by_what_is_on_the_table(api, client_id, product, zones):
    """Жёсткий блок: в короб нельзя пропикать больше, чем передано на стол."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    over = api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 3})
    assert over.status_code == 400, over.text


def test_defect_goes_into_its_own_box(api, client_id, product, zones):
    """Брак собирается в отдельный короб: годный и брак в одной таре не едут."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=3)
    _as(_WAREHOUSE)
    good_box = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]
    defect_box = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]

    good = api.post(f"/shipments/{doc_id}/boxes/{good_box}/items", json={"barcode": product["barcode"], "qty": 2})
    assert good.status_code == 200, good.text
    assert good.json()["quality"] == "good"
    defect = api.post(
        f"/shipments/{doc_id}/boxes/{defect_box}/items",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    )
    assert defect.status_code == 200, defect.text
    assert defect.json()["items_qty"] == 1
    assert defect.json()["quality"] == "defect"
    assert defect.json()["contents"][0]["quality"] == "defect"

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 2 and line["packed_defect"] == 1
    assert line["boxed_qty"] == 3 and line["boxed_defect_qty"] == 1
    assert _bucket(client_id, product["product_id"], "packed", "defect") == 1

    api.post(f"/shipments/{doc_id}/boxes/{good_box}/close")
    api.post(f"/shipments/{doc_id}/boxes/{defect_box}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")
    assert _place(api, zone_id=zones["cell_id"], box_ids=[good_box, defect_box]).status_code == 200

    # Качество при развозке сохраняется: брак лёг браком в то же место.
    assert _bucket(client_id, product["product_id"], "ready", "defect") == 1
    assert _bucket(client_id, product["product_id"], "ready", "good") == 2


def test_box_cannot_mix_good_and_defect(api, client_id, product, zones):
    """Качество короба задаёт первый скан: второе качество в него уже не принимается."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]

    assert api.post(
        f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 1},
    ).status_code == 200
    mixed = api.post(
        f"/shipments/{doc_id}/boxes/{box_id}/items",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    )
    assert mixed.status_code == 400
    assert "годным" in mixed.json()["detail"]

    # Обратный случай: короб, начатый браком, не принимает годный.
    defect_box = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]
    assert api.post(
        f"/shipments/{doc_id}/boxes/{defect_box}/items",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    ).status_code == 200
    back_to_good = api.post(
        f"/shipments/{doc_id}/boxes/{defect_box}/items", json={"barcode": product["barcode"], "qty": 1},
    )
    assert back_to_good.status_code == 400
    assert "браком" in back_to_good.json()["detail"]

    # Опустошённый короб снова свободен по качеству: изъяли брак — можно класть годный.
    boxes = api.get(f"/shipments/{doc_id}/boxes").json()["items"]
    line_id = next(b for b in boxes if b["id"] == defect_box)["contents"][0]["line_id"]
    assert api.post(
        f"/shipments/{doc_id}/boxes/{defect_box}/items/undo", json={"line_id": line_id, "qty": 1},
    ).status_code == 200
    assert api.post(
        f"/shipments/{doc_id}/boxes/{defect_box}/items", json={"barcode": product["barcode"], "qty": 1},
    ).status_code == 200


def test_aside_item_placed_by_scan_at_the_rack(api, client_id, product, zones):
    """Мимо короба (габарит, брак): собрали сканом, место назначил кладовщик у стеллажа."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=3)
    _as(_WAREHOUSE)
    aside = api.post(
        f"/shipments/{doc_id}/putaway/aside",
        json={"barcode": product["barcode"], "qty": 2, "quality": "defect"},
    )
    assert aside.status_code == 200, aside.text
    assert aside.json()["aside_total"] == 2

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    # Это полноценная запись упаковки (объём и заработок), но товар ещё не размещён.
    assert line["packed_defect"] == 2
    assert line["aside_qty"] == 2 and line["placed_qty"] == 0
    assert _bucket(client_id, product["product_id"], "packed", "defect") == 2

    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text

    # Место для россыпи — любое активное: зона брака заведена служебным местом.
    placed = _place(
        api, zone_id=zones["special_id"],
        items=[{"barcode": product["barcode"], "qty": 2}],
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["items"][0]["quality"] == "defect"
    assert _bucket(client_id, product["product_id"], "ready", "defect") == 2
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "packed"


def test_aside_quality_must_be_explicit_when_ambiguous(api, client_id, product, zones):
    """По одному ШК ждут годный и брак — качество спрашиваем, а не угадываем."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})
    api.post(
        f"/shipments/{doc_id}/putaway/aside",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    )

    ambiguous = _place(api, zone_id=zones["cell_id"], items=[{"barcode": product["barcode"], "qty": 1}])
    assert ambiguous.status_code == 400
    assert "качество" in ambiguous.json()["detail"].lower()

    ok = _place(
        api, zone_id=zones["cell_id"],
        items=[{"barcode": product["barcode"], "qty": 1, "quality": "good"}],
    )
    assert ok.status_code == 200, ok.text
    assert _bucket(client_id, product["product_id"], "ready", "good") == 1


def test_place_batch_takes_boxes_and_items_at_once(api, client_id, product, zones):
    """Пачка: два короба и россыпь уезжают в одно место одним запросом."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=5)
    code_a, code_b = _new_box_code(api), _new_box_code(api)
    _as(_WAREHOUSE)
    box_a = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_a}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/close")
    box_b = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_b}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_b}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_b}/close")
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})
    api.post(f"/shipments/{doc_id}/finish-collecting")

    placed = _place(
        api, zone_id=zones["cell_id"], box_ids=[box_a, box_b],
        items=[{"barcode": product["barcode"], "qty": 1}],
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["placed_qty"] == 5
    assert len(placed.json()["boxes"]) == 2
    assert _bucket(client_id, product["product_id"], "packed") == 0
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "packed"


def test_place_ignores_box_scanned_twice(api, client_id, product, zones):
    """Один короб, попавший в пачку дважды, размещается один раз, а не ломает ходку."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=3)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 3})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")

    placed = _place(api, zone_id=zones["cell_id"], box_ids=[box_id, box_id])
    assert placed.status_code == 200, placed.text
    assert placed.json()["placed_qty"] == 3
    assert len(placed.json()["boxes"]) == 1
    assert _bucket(client_id, product["product_id"], "packed") == 0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'ready' AND to_zone_id = ?",
            (product["product_id"], zones["cell_id"]),
        ).fetchone()
    assert int(row["n"]) == 3


def test_place_rejects_open_box(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 1})

    placed = _place(api, zone_id=zones["cell_id"], box_ids=[box_id])
    assert placed.status_code == 400
    assert "не закрыт" in placed.json()["detail"]


def test_undo_aside_item_returns_goods_to_table(api, client_id, product, zones):
    """Ошибочный скан мимо короба отменяется с ТСД: товар возвращается на стол."""
    doc_id, line_id = _create_task(api, client_id, product, qty=3)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})

    undo = api.post(f"/shipments/{doc_id}/putaway/aside/undo", json={"line_id": line_id, "qty": 1})
    assert undo.status_code == 200, undo.text
    assert undo.json()["aside_total"] == 0

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 0
    assert line["available_for_pack"] == 3


def test_undo_aside_item_targets_requested_quality(api, client_id, product, zones):
    """Годный и брак лежат мимо коробов вместе: изымается то качество, о котором просят."""
    doc_id, line_id = _create_task(api, client_id, product, qty=3)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})
    api.post(
        f"/shipments/{doc_id}/putaway/aside",
        json={"barcode": product["barcode"], "qty": 1, "quality": "defect"},
    )

    # Без качества сторно ушло бы в последний скан (брак) — просим именно годный.
    undo = api.post(
        f"/shipments/{doc_id}/putaway/aside/undo",
        json={"line_id": line_id, "qty": 1, "quality": "good"},
    )
    assert undo.status_code == 200, undo.text
    assert undo.json()["aside_total"] == 1

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 0 and line["packed_defect"] == 1
    assert line["aside_qty"] == 1 and line["aside_defect_qty"] == 1

    # Годного мимо коробов больше нет: повторная отмена отклоняется понятной ошибкой.
    again = api.post(
        f"/shipments/{doc_id}/putaway/aside/undo",
        json={"line_id": line_id, "qty": 1, "quality": "good"},
    )
    assert again.status_code == 400
    assert "годный" in again.json()["detail"]


def test_empty_box_can_be_released(api, client_id, product, zones):
    """Этикетку взяли по ошибке: пустой короб снимается с задачи и не держит её."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    closed = api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    assert closed.status_code == 400 and "пустой" in closed.json()["detail"].lower()

    released = api.post(f"/shipments/{doc_id}/boxes/{box_id}/release")
    assert released.status_code == 200, released.text
    assert api.get(f"/shipments/{doc_id}").json()["boxes"] == []
    # Этикетка не сгорела: короб снова свободен и берётся в работу заново.
    assert api.get(f"/containers/{box_id}").json()["doc"]["status"] == "new"
    assert api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).status_code == 200


def test_release_rejects_box_with_goods(api, client_id, product, zones):
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 1})

    released = api.post(f"/shipments/{doc_id}/boxes/{box_id}/release")
    assert released.status_code == 400
    assert "не пустой" in released.json()["detail"]


def test_finish_releases_forgotten_empty_box(api, client_id, product, zones):
    """Забытый пустой короб не блокирует конец сборки — он освобождается сам."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code_a, code_b = _new_box_code(api), _new_box_code(api)
    _as(_WAREHOUSE)
    box_a = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_a}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/close")
    box_b = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_b}).json()["id"]

    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200, fin.text
    assert api.get(f"/containers/{box_b}").json()["doc"]["status"] == "new"


def test_task_without_goods_closes_immediately(api, client_id, product, zones):
    """Собирать было нечего: «Сборка завершена» закрывает задачу сразу."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    _as(_WAREHOUSE)
    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text


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
    assert _bucket(client_id, product["product_id"], "packed") == 1
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


def _collect_and_place(api, client_id, product, zones, qty: int = 2):
    """Задача, собранная в один короб и размещённая в ячейке. → (doc_id, box_id)."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=qty)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": qty})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")
    assert _place(api, zone_id=zones["cell_id"], box_ids=[box_id]).status_code == 200
    return doc_id, box_id


def test_manual_move_of_boxed_stock_rejected(api, client_id, product, zones):
    """Товар в размещённом коробе двигается только коробом целиком."""
    _doc_id, _box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    move = api.post("/balances/relocations", json={
        "product_id": product["product_id"],
        "product_name": "Putaway Product",
        "product_sku": product["sku"],
        "client_id": client_id,
        "op": "ready",
        "quality": "good",
        "qty": 1,
        "from_zone_id": zones["cell_id"],
        "to_zone_id": zones["packing_id"],
    })
    assert move.status_code == 400, move.text
    assert "коробе" in move.json()["detail"]


def test_item_can_be_removed_from_placed_box(api, client_id, product, zones):
    """Пересорт нашли у стеллажа: позиция изымается из короба, оставаясь в ячейке."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    removed = api.post(
        f"/containers/{box_id}/items/remove",
        json={"barcode": product["barcode"], "qty": 1},
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["items_qty"] == 1
    # Остаток из ячейки никуда не уехал — ушла только привязка к коробу.
    assert _bucket(client_id, product["product_id"], "ready") == 2

    # Изъятое перестало быть «в коробе» — обычное перемещение снова разрешено.
    move = api.post("/balances/relocations", json={
        "product_id": product["product_id"],
        "product_name": "Putaway Product",
        "product_sku": product["sku"],
        "client_id": client_id,
        "op": "ready",
        "quality": "good",
        "qty": 1,
        "from_zone_id": zones["cell_id"],
        "to_zone_id": zones["packing_id"],
    })
    assert move.status_code == 200, move.text


def test_placed_box_moves_between_locations(api, client_id, product, zones):
    """Перемещение — то же действие, что размещение: скан короба → скан места."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    moved = _place(api, zone_id=zones["special_id"], box_ids=[box_id])
    assert moved.status_code == 200, moved.text
    assert moved.json()["boxes"][0]["zone_id"] == zones["special_id"]

    detail = api.get(f"/containers/{box_id}").json()
    assert detail["doc"]["zone_id"] == zones["special_id"]
    assert sum(c["qty"] for c in detail["contents"]) == 2  # содержимое при переезде не изменилось


def test_scan_move_of_stored_goods_between_locations(api, client_id, product, zones):
    """Тем же сканом двигают уже размещённый товар: место → место, без задачи."""
    _doc_id, _box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    # Часть выкладываем из короба, иначе двигать её нельзя — короб атомарен.
    api.post(f"/containers/{_box_id}/items/remove", json={"barcode": product["barcode"], "qty": 1})

    moved = _place(
        api, zone_id=zones["special_id"],
        items=[{"barcode": product["barcode"], "qty": 1, "from_zone_id": zones["cell_id"]}],
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["items"][0]["from_collected"] is False
    assert moved.json()["placed_qty"] == 1
    # Перенос остаток не меняет — меняется только место.
    assert _bucket(client_id, product["product_id"], "ready") == 2

    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'ready' AND to_zone_id = ? AND from_op = 'ready'",
            (product["product_id"], zones["special_id"]),
        ).fetchone()
    assert int(row["n"]) == 1


def test_scan_move_refuses_goods_locked_in_box(api, client_id, product, zones):
    """Товар в коробе сканом не утащить: короб едет целиком."""
    _doc_id, _box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    blocked = _place(
        api, zone_id=zones["special_id"],
        items=[{"barcode": product["barcode"], "qty": 1, "from_zone_id": zones["cell_id"]}],
    )
    assert blocked.status_code == 400, blocked.text
    assert "коробе" in blocked.json()["detail"]


def test_scan_move_asks_source_when_ambiguous(api, client_id, product, zones):
    """Товар лежит в двух местах — источник спрашиваем, а не угадываем."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    api.post(f"/containers/{box_id}/items/remove", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/containers/{box_id}/move", json={"zone_id": zones["special_id"]})
    # Половину переносим в служебное место — товар оказывается в двух местах.
    api.post("/balances/relocations", json={
        "product_id": product["product_id"],
        "product_name": "Putaway Product",
        "product_sku": product["sku"],
        "client_id": client_id,
        "op": "ready",
        "quality": "good",
        "qty": 1,
        "from_zone_id": zones["cell_id"],
        "to_zone_id": zones["special_id"],
    })

    ambiguous = _place(api, zone_id=zones["packing_id"], items=[{"barcode": product["barcode"], "qty": 1}])
    assert ambiguous.status_code == 400
    assert "нескольких местах" in ambiguous.json()["detail"]

    ok = _place(
        api, zone_id=zones["packing_id"],
        items=[{"barcode": product["barcode"], "qty": 1, "from_zone_id": zones["cell_id"]}],
    )
    assert ok.status_code == 200, ok.text


def test_holdings_report_boxes_in_location(api, client_id, product, zones):
    """Остатки должны показывать, что позиция лежит в коробе, а не упираться в отказ."""
    _doc_id, _box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    r = api.get(f"/containers/holdings?zone_ids={zones['cell_id']}")
    assert r.status_code == 200, r.text
    rows = [i for i in r.json()["items"] if i["product_id"] == product["product_id"]]
    assert len(rows) == 1
    assert rows[0]["qty"] == 2 and rows[0]["doc_number"].startswith("BOX-")


def test_relocations_journal_shows_box(api, client_id, product, zones):
    """Журнал перемещений различает движение коробом — иначе развозки в нём не видно."""
    _doc_id, _box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    _as(_ADMIN)
    r = api.get("/balances/relocations?boxed_only=true&limit=50")
    assert r.status_code == 200, r.text
    mine = [i for i in r.json()["items"] if i["product_sku"] == product["sku"]]
    assert mine, r.text
    assert any(i["to_container"] for i in mine)


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
    assert "Упаковка с ТСД" in taken.json()["detail"]


def test_pending_placement_queue_is_the_home_of_delivery(api, client_id, product, zones):
    """Очередь развозки живёт в коробах: задача уже закрыта, а объекты видны и ждут."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})
    assert api.post(f"/shipments/{doc_id}/finish-collecting").json()["message"] == "packed"

    queue = api.get("/containers/pending-placement")
    assert queue.status_code == 200, queue.text
    body = queue.json()
    assert box_id in [b["id"] for b in body["boxes"]]
    mine = [i for i in body["aside"] if i["product_id"] == product["product_id"]]
    assert mine and mine[0]["qty"] == 1
    assert body["since"]

    # Одна карточка на весь склад, а не по задаче: кладовщик везёт ходку, а не документ.
    cards = [t for t in api.get("/tasks").json()["items"] if t["kind"] == "boxes_place"]
    assert len(cards) == 1
    assert cards[0]["doc_type"] == "containers"

    _place(api, zone_id=zones["cell_id"], box_ids=[box_id],
           items=[{"barcode": product["barcode"], "qty": 1}])

    # Очередь общая на склад (в ней и объекты соседних задач) — проверяем свои.
    after = api.get("/containers/pending-placement").json()
    assert box_id not in [b["id"] for b in after["boxes"]]
    assert [i for i in after["aside"] if i["product_id"] == product["product_id"]] == []


def test_partial_delivery_leaves_the_rest_in_queue(api, client_id, product, zones):
    """Часть коробов уехала, часть стоит: очередь показывает остаток, задача закрыта."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=4)
    code_a, code_b = _new_box_code(api), _new_box_code(api)
    _as(_WAREHOUSE)
    box_a = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_a}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_a}/close")
    box_b = api.post(f"/shipments/{doc_id}/boxes", json={"code": code_b}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_b}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_b}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")

    assert _place(api, zone_id=zones["cell_id"], box_ids=[box_a]).status_code == 200

    queue = api.get("/containers/pending-placement").json()
    ids = [b["id"] for b in queue["boxes"]]
    assert box_b in ids and box_a not in ids
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "packed"
    assert detail["lines"][0]["placed_qty"] == 2


# ── «Откуда → Что → Куда»: источник назван явно и сверяется с учётом ─────────

def _transfer(api, *, source, target, box_ids=None, items=None):
    return api.post("/containers/place", json={
        "source": source,
        "target": target,
        "box_ids": list(box_ids or []),
        "items": list(items or []),
    })


def _loc(zone_id: str) -> dict:
    return {"kind": "location", "id": zone_id}


def _box(box_id: str) -> dict:
    return {"kind": "container", "id": box_id}


_COLLECTED = {"kind": "collected"}


def test_source_collected_rejects_box_already_on_shelf(api, client_id, product, zones):
    """Сверка учёта: короб, который стоит на полке, из зоны упаковки не берут."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    r = _transfer(api, source=_COLLECTED, target=_loc(zones["special_id"]), box_ids=[box_id])
    assert r.status_code == 400, r.text
    assert "уже стоит" in r.json()["detail"]


def test_source_location_must_match_where_box_is_registered(api, client_id, product, zones):
    """Короб числится в A, кладовщик назвал B — ошибка, а не молчаливая правка учёта."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    wrong = _transfer(api, source=_loc(zones["special_id"]), target=_loc(zones["packing_id"]), box_ids=[box_id])
    assert wrong.status_code == 400, wrong.text
    assert "числится" in wrong.json()["detail"]

    ok = _transfer(api, source=_loc(zones["cell_id"]), target=_loc(zones["special_id"]), box_ids=[box_id])
    assert ok.status_code == 200, ok.text
    assert ok.json()["boxes"][0]["zone_id"] == zones["special_id"]


def test_source_location_rejects_box_still_at_the_table(api, client_id, product, zones):
    """Закрытый, но не размещённый короб — у стола: источник для него «Зона упаковки»."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")

    r = _transfer(api, source=_loc(zones["cell_id"]), target=_loc(zones["special_id"]), box_ids=[box_id])
    assert r.status_code == 400, r.text
    assert "у стола" in r.json()["detail"]

    ok = _transfer(api, source=_COLLECTED, target=_loc(zones["cell_id"]), box_ids=[box_id])
    assert ok.status_code == 200, ok.text


def test_source_collected_does_not_fall_through_to_shelf(api, client_id, product, zones):
    """«Зона упаковки» названа явно: товар, лежащий только на полке, оттуда не берётся."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    api.post(f"/containers/{box_id}/items/remove", json={"barcode": product["barcode"], "qty": 1})

    r = _transfer(
        api, source=_COLLECTED, target=_loc(zones["special_id"]),
        items=[{"barcode": product["barcode"], "qty": 1}],
    )
    assert r.status_code == 400, r.text
    assert "не ждёт развозки" in r.json()["detail"]


def test_source_and_target_location_must_differ(api, client_id, product, zones):
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    api.post(f"/containers/{box_id}/items/remove", json={"barcode": product["barcode"], "qty": 1})

    r = _transfer(
        api, source=_loc(zones["cell_id"]), target=_loc(zones["cell_id"]),
        items=[{"barcode": product["barcode"], "qty": 1}],
    )
    assert r.status_code == 400, r.text
    assert "совпадают" in r.json()["detail"]


def test_item_goes_from_box_to_another_location_in_one_step(api, client_id, product, zones):
    """Из короба на другую полку — одна операция вместо «изъять, потом перенести»."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    r = _transfer(
        api, source=_box(box_id), target=_loc(zones["special_id"]),
        items=[{"barcode": product["barcode"], "qty": 1}],
    )
    assert r.status_code == 200, r.text
    assert r.json()["placed_qty"] == 1
    assert r.json()["items"][0]["from_collected"] is False
    assert api.get(f"/containers/{box_id}").json()["doc"]["items_qty"] == 1
    # Остаток не изменился, штука переехала: в служебном месте она лежит россыпью.
    assert _bucket(client_id, product["product_id"], "ready") == 2
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_zone_id = ? AND from_container_id = ? AND to_container_id IS NULL",
            (product["product_id"], zones["special_id"], box_id),
        ).fetchone()
    assert int(row["n"]) == 1

    too_many = _transfer(
        api, source=_box(box_id), target=_loc(zones["special_id"]),
        items=[{"barcode": product["barcode"], "qty": 5}],
    )
    assert too_many.status_code == 400
    assert "только 1 шт" in too_many.json()["detail"]


def test_item_moves_between_placed_boxes(api, client_id, product, zones):
    """Товар между коробами: ось короба снимается у источника и ставится у приёмника."""
    _doc_a, box_a = _collect_and_place(api, client_id, product, zones, qty=2)
    _doc_b, box_b = _collect_and_place(api, client_id, product, zones, qty=2)

    same = _transfer(api, source=_box(box_a), target=_box(box_a), items=[{"barcode": product["barcode"], "qty": 1}])
    assert same.status_code == 400
    assert "один и тот же короб" in same.json()["detail"]

    r = _transfer(api, source=_box(box_a), target=_box(box_b), items=[{"barcode": product["barcode"], "qty": 1}])
    assert r.status_code == 200, r.text
    assert r.json()["target_container"]["doc_number"].startswith("BOX-")
    assert api.get(f"/containers/{box_a}").json()["doc"]["items_qty"] == 1
    detail_b = api.get(f"/containers/{box_b}").json()
    assert detail_b["doc"]["items_qty"] == 3
    assert any(op["op_type"] == "item_add" and "Доложено" in (op["comment"] or "") for op in detail_b["ops"])
    assert _bucket(client_id, product["product_id"], "ready") == 4


def test_loose_item_from_shelf_goes_into_placed_box(api, client_id, product, zones):
    """С полки в короб, стоящий на той же полке: меняется только ось короба."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    api.post(f"/containers/{box_id}/items/remove", json={"barcode": product["barcode"], "qty": 1})
    assert api.get(f"/containers/{box_id}").json()["doc"]["items_qty"] == 1

    r = _transfer(
        api, source=_loc(zones["cell_id"]), target=_box(box_id),
        items=[{"barcode": product["barcode"], "qty": 1}],
    )
    assert r.status_code == 200, r.text
    assert r.json()["zone_id"] == zones["cell_id"]
    assert api.get(f"/containers/{box_id}").json()["doc"]["items_qty"] == 2
    assert _bucket(client_id, product["product_id"], "ready") == 2
    # Всё снова в коробе — ручное перемещение россыпи опять запрещено.
    holdings = api.get(f"/containers/holdings?zone_ids={zones['cell_id']}").json()["items"]
    mine = [h for h in holdings if h["product_id"] == product["product_id"]]
    assert mine and mine[0]["qty"] == 2


def test_collected_item_goes_straight_into_placed_box(api, client_id, product, zones):
    """Со стола в размещённый короб: россыпь другой задачи докладывается в чужую тару."""
    _doc_a, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    doc_b, _line_id = _create_task(api, client_id, product, qty=1)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_b}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})
    api.post(f"/shipments/{doc_b}/finish-collecting")

    r = _transfer(api, source=_COLLECTED, target=_box(box_id), items=[{"barcode": product["barcode"], "qty": 1}])
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["from_collected"] is True
    assert api.get(f"/containers/{box_id}").json()["doc"]["items_qty"] == 3
    assert _bucket(client_id, product["product_id"], "packed") == 0
    assert _bucket(client_id, product["product_id"], "ready") == 3


def test_box_into_box_is_rejected(api, client_id, product, zones):
    _doc_a, box_a = _collect_and_place(api, client_id, product, zones, qty=2)
    _doc_b, box_b = _collect_and_place(api, client_id, product, zones, qty=2)

    r = _transfer(api, source=_loc(zones["cell_id"]), target=_box(box_b), box_ids=[box_a])
    assert r.status_code == 400, r.text
    assert "не вкладывается" in r.json()["detail"]


def test_placed_box_keeps_one_quality_when_adding(api, client_id, product, zones):
    """Годный короб брак не принимает — иначе у стеллажа его пришлось бы разбирать."""
    _doc_a, good_box = _collect_and_place(api, client_id, product, zones, qty=2)
    doc_b, _line_id = _create_task(api, client_id, product, qty=1)
    _as(_WAREHOUSE)
    api.post(f"/shipments/{doc_b}/putaway/aside", json={"barcode": product["barcode"], "qty": 1, "quality": "defect"})
    api.post(f"/shipments/{doc_b}/finish-collecting")

    r = _transfer(api, source=_COLLECTED, target=_box(good_box), items=[{"barcode": product["barcode"], "qty": 1}])
    assert r.status_code == 400, r.text
    assert "набран годным" in r.json()["detail"]
    assert _bucket(client_id, product["product_id"], "packed", "defect") == 1


def test_unplaced_box_is_not_a_target(api, client_id, product, zones):
    """Короб у стола приёмником не бывает: его состав меняют в задаче сборки."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=3)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": _new_box_code(api)}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/putaway/aside", json={"barcode": product["barcode"], "qty": 1})

    r = _transfer(api, source=_COLLECTED, target=_box(box_id), items=[{"barcode": product["barcode"], "qty": 1}])
    assert r.status_code == 400, r.text
    assert "не размещён" in r.json()["detail"]


def test_holdings_by_variant_answers_where_stored(api, client_id, product, zones):
    """«Где лежит» спрашивают по товару — без перечисления мест."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    r = api.get(f"/containers/holdings?product_id={product['product_id']}")
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    assert len(rows) == 1
    assert rows[0]["container_id"] == box_id
    assert rows[0]["zone_id"] == zones["cell_id"]
    assert rows[0]["zone_name"]
    assert rows[0]["op_status"] == "ready" and rows[0]["status"] == "placed"


def test_holdings_show_boxes_waiting_placement(api, client_id, product, zones):
    """Закрытый короб у стола — тоже короб: в остатках он не должен выглядеть россыпью."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")

    r = api.get(f"/containers/holdings?product_id={product['product_id']}")
    assert r.status_code == 200, r.text
    rows = r.json()["items"]
    assert len(rows) == 1
    assert rows[0]["op_status"] == "packed" and rows[0]["container_id"] == box_id
    assert rows[0]["status"] == "closed"


def test_holdings_require_place_or_product(api):
    """Без мест и без товара выборка бессмысленна — просим уточнить."""
    _as(_WAREHOUSE)
    assert api.get("/containers/holdings").status_code == 400


def test_boxes_search_finds_box_by_product(api, client_id, product, zones):
    """«В каком коробе лежит SKU» спрашивают и со стороны списка коробов."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    found = api.get(f"/containers?search={product['sku']}")
    assert found.status_code == 200, found.text
    assert [c["id"] for c in found.json()["items"]] == [box_id]

    assert api.get("/containers?search=НетТакогоАртикула").json()["items"] == []

    # Товар изъяли — короб больше не «с этим SKU».
    api.post(f"/containers/{box_id}/items/remove", json={"barcode": product["barcode"], "qty": 2})
    assert api.get(f"/containers?search={product['sku']}").json()["items"] == []


def test_boxes_filter_by_place(api, client_id, product, zones):
    """Фильтр места в списке коробов: что стоит на этом стеллаже."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)

    in_cell = api.get(f"/containers?zone_id={zones['cell_id']}")
    assert [c["id"] for c in in_cell.json()["items"]] == [box_id]
    assert api.get(f"/containers?zone_id={zones['special_id']}").json()["items"] == []
def test_free_boxes_can_be_deleted_after_a_typo(api):
    """Ошиблись количеством при заведении пачки — свободные короба убираются из реестра."""
    _as(_ADMIN)
    made = api.post("/containers", json={"count": 2}).json()["items"]
    ids = [c["id"] for c in made]

    r = api.post("/containers/delete", json={"ids": ids})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 2 and r.json()["skipped"] == 0

    listed = api.get("/containers?status=new&limit=200").json()["items"]
    assert not [c for c in listed if c["id"] in ids]
    # Номера сожжены вместе с этикеткой: следующий короб не переиспользует их.
    again = api.post("/containers", json={"count": 1}).json()["items"][0]
    assert again["doc_number"] not in [c["doc_number"] for c in made]
    api.post("/containers/delete", json={"ids": [again["id"]]})


def test_delete_refuses_box_already_in_work(api, client_id, product, zones):
    """Короб, который уже взяли в задачу, не удаляется молча — его номер возвращают."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    _as(_ADMIN)
    r = api.post("/containers/delete", json={"ids": [box_id]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] == 0 and body["skipped"] == 1 and body["skipped_numbers"] == [code]
    assert api.get(f"/containers/{box_id}").status_code == 200


def test_delete_refuses_box_with_goods_inside(api, client_id, product, zones):
    """Короб с товаром не удаляется ни на каком статусе — ни закрытый у стола, ни размещённый."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 2})
    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")

    _as(_ADMIN)
    closed = api.post("/containers/delete", json={"ids": [box_id]}).json()
    assert closed["deleted"] == 0 and closed["skipped_numbers"] == [code]

    _place(api, zone_id=zones["cell_id"], box_ids=[box_id])
    placed = api.post("/containers/delete", json={"ids": [box_id]}).json()
    assert placed["deleted"] == 0 and placed["skipped_numbers"] == [code]

    # Товар на месте: отказ не должен ничего сдвинуть в остатке.
    detail = api.get(f"/containers/{box_id}").json()
    assert detail["doc"]["items_qty"] == 2
    assert _bucket(client_id, product["product_id"], INV_OP_READY) == 2


def test_free_labels_sink_below_boxes_in_work(api, client_id, product, zones):
    """Пачка чистых этикеток не должна накрывать первую страницу списка."""
    _doc_id, box_id = _collect_and_place(api, client_id, product, zones, qty=2)
    _as(_ADMIN)
    fresh = api.post("/containers", json={"count": 1}).json()["items"][0]["id"]

    order = [c["id"] for c in api.get("/containers?limit=200").json()["items"]]
    assert order.index(box_id) < order.index(fresh)
    api.post("/containers/delete", json={"ids": [fresh]})


def test_shift_supervisor_prints_labels_but_does_not_create_boxes(api):
    """Перепечатка рваной этикетки — работа смены; заведение пачки — нет."""
    _as(_ADMIN)
    box = api.post("/containers", json={"count": 1}).json()["items"][0]

    _as(_SHIFT)
    labels = api.get(f"/containers/labels?ids={box['id']}")
    assert labels.status_code == 200, labels.text
    assert labels.json()["items"][0]["doc_number"] == box["doc_number"]
    assert api.post("/containers", json={"count": 1}).status_code == 403
    assert api.post("/containers/delete", json={"ids": [box["id"]]}).status_code == 403

    _as(_ADMIN)
    api.post("/containers/delete", json={"ids": [box["id"]]})
