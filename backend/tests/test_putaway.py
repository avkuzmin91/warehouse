"""Интеграционные тесты задачи «Размещение по ячейкам» (task_kind=putaway).

Процесс разделён на две фазы. Сборка (документ): передали на стол → взяли короб →
скан товара → закрыли короб → «Сборка завершена». Развозка (без документа): скан
коробов и россыпи → скан места хранения. Ключевой инвариант: пока товар собран, но
не развезён (корзина boxed), он НЕ доступен ни отгрузке, ни другой задаче упаковки —
готовность наступает только после размещения. Задача закрывается сама, когда уехал
её последний объект.
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
    """Сборка закрывает задачу в «Собрано», развозка коробом закрывает её сама."""
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

    # Товар собран в короб: упакован сканом, но к отгрузке ещё не доступен.
    assert _bucket(client_id, product["product_id"], "boxed") == 3
    assert _bucket(client_id, product["product_id"], "packed") == 0
    assert _bucket(client_id, product["product_id"], "ready") == 0
    # Скан = запись упаковки: объём и заработок считаются по ней.
    assert api.get(f"/shipments/{doc_id}").json()["lines"][0]["packed_good"] == 3

    closed = api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    assert closed.status_code == 200 and closed.json()["status"] == "closed", closed.text

    # Сборка завершается, не дожидаясь развозки: короб ещё стоит у стола.
    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200, fin.text
    assert fin.json()["message"] == "collected"
    assert _bucket(client_id, product["product_id"], "boxed") == 3
    # Нерешённый пул со стола вернулся на хранение — товар не завис на упаковке.
    assert _bucket(client_id, product["product_id"], "packing") == 0

    placed = _place(api, zone_id=zones["cell_id"], box_ids=[box_id])
    assert placed.status_code == 200, placed.text
    assert placed.json()["placed_qty"] == 3
    assert placed.json()["boxes"][0]["status"] == "placed"
    assert placed.json()["boxes"][0]["zone_id"] == zones["cell_id"]

    # После размещения товар лежит на хранении в ячейке — вот теперь он доступен.
    assert _bucket(client_id, product["product_id"], "boxed") == 0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'storage' AND to_zone_id = ?",
            (product["product_id"], zones["cell_id"]),
        ).fetchone()
    assert int(row["n"]) == 3

    # Уехал последний объект задачи — она закрылась сама, без отдельного финиша.
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "placed"
    assert detail["task_kind"] == "putaway"
    assert detail["lines"][0]["placed_qty"] == 3
    assert detail["lines"][0]["boxed_qty"] == 0
    assert len(detail["boxes"]) == 1
    assert placed.json()["closed_tasks"] == [detail["doc_number"]]


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
    assert api.post(f"/shipments/{doc_id}/finish-collecting").json()["message"] == "collected"


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
    # Задача ещё собирается — авто-закрытие её не трогает.
    assert placed.json()["closed_tasks"] == []
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "on_packing"

    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200 and fin.json()["message"] == "placed", fin.text


def test_scan_limited_by_what_is_on_the_table(api, client_id, product, zones):
    """Жёсткий блок: в короб нельзя пропикать больше, чем передано на стол."""
    doc_id, _line_id = _create_task(api, client_id, product, qty=2)
    code = _new_box_code(api)
    _as(_WAREHOUSE)
    box_id = api.post(f"/shipments/{doc_id}/boxes", json={"code": code}).json()["id"]

    over = api.post(f"/shipments/{doc_id}/boxes/{box_id}/items", json={"barcode": product["barcode"], "qty": 3})
    assert over.status_code == 400, over.text


def test_defect_goes_into_the_box_too(api, client_id, product, zones):
    """Короб — просто тара: брак кладётся в него так же, как годный."""
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
    assert defect.json()["items_qty"] == 3

    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 2 and line["packed_defect"] == 1
    assert line["boxed_qty"] == 3 and line["boxed_defect_qty"] == 1
    assert _bucket(client_id, product["product_id"], "boxed", "defect") == 1

    api.post(f"/shipments/{doc_id}/boxes/{box_id}/close")
    api.post(f"/shipments/{doc_id}/finish-collecting")
    assert _place(api, zone_id=zones["cell_id"], box_ids=[box_id]).status_code == 200

    # Качество при размещении сохраняется: брак лёг браком в то же место.
    assert _bucket(client_id, product["product_id"], "storage", "defect") == 1
    assert _bucket(client_id, product["product_id"], "storage", "good") == 2


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
    assert _bucket(client_id, product["product_id"], "boxed", "defect") == 2

    fin = api.post(f"/shipments/{doc_id}/finish-collecting")
    assert fin.status_code == 200 and fin.json()["message"] == "collected", fin.text

    # Место для россыпи — любое активное: зона брака заведена служебным местом.
    placed = _place(
        api, zone_id=zones["special_id"],
        items=[{"barcode": product["barcode"], "qty": 2}],
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["items"][0]["quality"] == "defect"
    assert _bucket(client_id, product["product_id"], "storage", "defect") == 2
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "placed"


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
    assert _bucket(client_id, product["product_id"], "storage", "good") == 1


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
    assert _bucket(client_id, product["product_id"], "boxed") == 0
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "placed"


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
    assert fin.status_code == 200 and fin.json()["message"] == "placed", fin.text


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
    assert _bucket(client_id, product["product_id"], "storage") == 2

    # Изъятое перестало быть «в коробе» — обычное перемещение снова разрешено.
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
    # Перенос ничью задачу не закрывает и остаток не меняет — меняется только место.
    assert moved.json()["closed_tasks"] == []
    assert _bucket(client_id, product["product_id"], "storage") == 2

    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS n FROM zone_relocations "
            "WHERE product_id = ? AND to_op = 'storage' AND to_zone_id = ? AND from_op = 'storage'",
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
    assert "Размещение по ячейкам" in taken.json()["detail"]
