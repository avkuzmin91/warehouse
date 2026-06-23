"""Интеграционные тесты домена dispatch («Отгрузка клиенту»).

Проверяют: создание, гейт draft→preparing по готовому остатку `ready`, отметку
подготовки кладовщиком (preparing→awaiting_trip), резервирование ready между
отгрузками, списание при выезде рейса (consume), завершение, отмену,
редактируемость только в черновике, гейт SKU, ссылку на сайт.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _make_product(client_id: str, *, sku: str, sku_pending: int = 0) -> str:
    """Создать тип + товар, вернуть product_id (нужен гейту SKU и detail)."""
    type_id = str(uuid.uuid4())
    product_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (type_id, f"Type-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, created_at, sku_pending) "
            "VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)",
            (product_id, f"Product-{product_id[:8]}", type_id, client_id, sku, sku_pending),
        )
        conn.commit()
    return product_id


# Ячейки-источники, из которых кладовщик «забирает» товар при подготовке. Должны
# отличаться от «Зоны отгрузки» (куда подготовка свозит «Готов к отгрузке»).
SRC_CELL_GOOD = ("dsp-cell-good", "Ячейка А1")
SRC_CELL_DEFECT = ("dsp-cell-defect", "Ячейка Брак")


def _finish_prep(admin_client, doc_id: str, cell=SRC_CELL_GOOD):
    """POST finish-preparation: всю каждую строку берём из одной ячейки-источника."""
    zone_id, zone_name = cell
    lines = admin_client.get(f"/dispatches/{doc_id}").json()["lines"]
    body = {"lines": [
        {"line_id": l["id"], "sources": [{"zone_id": zone_id, "zone_name": zone_name, "qty": l["qty"]}]}
        for l in lines
    ]}
    return admin_client.post(f"/dispatches/{doc_id}/finish-preparation", json=body)


def _seed_ready(client_id: str, *, product_id: str, sku: str, qty: int,
                color_id=None, size_id=None) -> None:
    """Засеять готовый к отгрузке остаток (movement → ready/good@ячейка) по варианту×клиенту."""
    from modules.balances.service import insert_inventory_move

    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Product", product_sku=sku,
            color_id=color_id, color_name=None, size_id=size_id, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="ready",
            from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=SRC_CELL_GOOD[0], to_zone_name=SRC_CELL_GOOD[1],
            qty=qty, user_id="test-admin-id",
        )
        conn.commit()


def _ready_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="ready", quality="good",
        )


def _ready_net_defect(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="ready", quality="defect",
        )


def _payload(client_id, product_id, sku, qty, site_url=None) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-07-01",
        "lines": [{
            "product_id": product_id, "product_name": "Product", "product_sku": sku,
            "qty": qty, "site_url": site_url,
        }],
    }


def _create(admin_client, client_id, product_id, sku, qty, site_url=None) -> str:
    r = admin_client.post("/dispatches", json=_payload(client_id, product_id, sku, qty, site_url))
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _seed_storage_defect(client_id: str, *, product_id: str, sku: str, qty: int,
                         color_id=None, size_id=None) -> None:
    """Засеять брак «На хранении» (movement intake → storage/defect) по варианту×клиенту."""
    from modules.balances.service import insert_inventory_move

    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Product", product_sku=sku,
            color_id=color_id, color_name=None, size_id=size_id, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="intake", to_op="storage",
            from_quality="defect", to_quality="defect",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=SRC_CELL_DEFECT[0], to_zone_name=SRC_CELL_DEFECT[1],
            qty=qty, user_id="test-admin-id",
        )
        conn.commit()


def _storage_defect_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="storage", quality="defect",
        )


def _seed_storage_good(client_id: str, *, product_id: str, sku: str, qty: int,
                       color_id=None, size_id=None) -> None:
    """Засеять годный «На хранении» (movement intake → storage/good) по варианту×клиенту."""
    from modules.balances.service import insert_inventory_move

    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Product", product_sku=sku,
            color_id=color_id, color_name=None, size_id=size_id, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="intake", to_op="storage",
            from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=None, to_zone_name=None,
            qty=qty, user_id="test-admin-id",
        )
        conn.commit()


def _storage_good_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="storage", quality="good",
        )


def _create_defect(admin_client, client_id, product_id, sku, qty) -> str:
    payload = _payload(client_id, product_id, sku, qty)
    payload["cargo_type"] = "defect"
    r = admin_client.post("/dispatches", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["message"]


def test_create_dispatch_returns_doc_id(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T1")
    doc_id = _create(admin_client, client_id, pid, "DSP-T1", 3)
    r = admin_client.get(f"/dispatches/{doc_id}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "draft"
    assert d["doc_number"].startswith("DSP-")
    assert d["total_qty"] == 3


def test_advance_blocked_without_ready(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T2")
    doc_id = _create(admin_client, client_id, pid, "DSP-T2", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "не готова" in r.json()["detail"].lower() or "готово" in r.json()["detail"].lower()


def test_advance_succeeds_with_ready(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T3")
    _seed_ready(client_id, product_id=pid, sku="DSP-T3", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-T3", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "preparing"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "preparing"


def test_finish_preparation_advances_to_awaiting_trip(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T3B")
    _seed_ready(client_id, product_id=pid, sku="DSP-T3B", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-T3B", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    # из подготовки кладовщик указывает ячейки и отмечает готовность → ожидает рейс
    r = _finish_prep(admin_client, doc_id)
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_trip"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "awaiting_trip"
    # повторная отметка из awaiting_trip запрещена
    assert _finish_prep(admin_client, doc_id).status_code == 400


def test_finish_preparation_blocked_from_draft(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T3C")
    doc_id = _create(admin_client, client_id, pid, "DSP-T3C", 1)
    assert admin_client.post(f"/dispatches/{doc_id}/finish-preparation", json={"lines": []}).status_code == 400


def test_finish_preparation_requires_full_sources(admin_client, client_id):
    """Подготовка не проходит, если ячейки покрывают не весь план строки."""
    pid = _make_product(client_id, sku="DSP-T3D")
    _seed_ready(client_id, product_id=pid, sku="DSP-T3D", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-T3D", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    body = {"lines": [{"line_id": line_id, "sources": [
        {"zone_id": SRC_CELL_GOOD[0], "zone_name": SRC_CELL_GOOD[1], "qty": 3}
    ]}]}
    r = admin_client.post(f"/dispatches/{doc_id}/finish-preparation", json=body)
    assert r.status_code == 400, r.text
    assert "ячеек" in r.json()["detail"].lower()


def test_advance_blocked_when_ready_partial(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T4")
    _seed_ready(client_id, product_id=pid, sku="DSP-T4", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-T4", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text


def test_reservation_blocks_second_dispatch(admin_client, client_id):
    """Свободный ready режется уже открытыми отгрузками — два документа не отгрузят одно и то же."""
    pid = _make_product(client_id, sku="DSP-T5")
    _seed_ready(client_id, product_id=pid, sku="DSP-T5", qty=5)
    doc_a = _create(admin_client, client_id, pid, "DSP-T5", 5)
    doc_b = _create(admin_client, client_id, pid, "DSP-T5", 5)
    assert admin_client.post(f"/dispatches/{doc_a}/advance").status_code == 200
    # doc_a зарезервировал все 5 ready → doc_b не проходит гейт
    assert admin_client.post(f"/dispatches/{doc_b}/advance").status_code == 400


def test_consume_marks_shipped_and_fully_shipped(admin_client, client_id):
    from modules.dispatch.service import consume_stock_for_dispatch, dispatch_fully_shipped

    pid = _make_product(client_id, sku="DSP-T6")
    _seed_ready(client_id, product_id=pid, sku="DSP-T6", qty=4)
    doc_id = _create(admin_client, client_id, pid, "DSP-T6", 4)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200

    with get_connection() as conn:
        consume_stock_for_dispatch(conn, doc_id, "test-admin-id", alloc=None, trip_id="trip-test")
        conn.commit()
        assert dispatch_fully_shipped(conn, doc_id) is True

    assert _ready_net(client_id, pid) == 0
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["shipped_qty"] == 4


def test_cancel_from_awaiting_trip(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T7")
    _seed_ready(client_id, product_id=pid, sku="DSP-T7", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-T7", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id).status_code == 200
    # подготовка свезла годный в «Зону отгрузки» — ready по варианту не изменился
    assert _ready_net(client_id, pid) == 2
    r = admin_client.post(f"/dispatches/{doc_id}/cancel")
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "cancelled"
    # возврат подготовки: остаток сохранён (вернулся из зоны отгрузки в исходную ячейку)
    assert _ready_net(client_id, pid) == 2


def test_cancel_from_preparing(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T7B")
    _seed_ready(client_id, product_id=pid, sku="DSP-T7B", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-T7B", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    r = admin_client.post(f"/dispatches/{doc_id}/cancel")
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "cancelled"


def test_lines_editable_only_in_draft(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T8")
    _seed_ready(client_id, product_id=pid, sku="DSP-T8", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-T8", 2)
    # в черновике добавление строки доступно
    add = admin_client.post(f"/dispatches/{doc_id}/lines", json={
        "product_id": pid, "product_name": "Product", "product_sku": "DSP-T8", "qty": 1,
    })
    assert add.status_code == 200, add.text
    # после передачи в подготовку состав не правится
    # (поднимем ready до 3, чтобы пройти гейт)
    _seed_ready(client_id, product_id=pid, sku="DSP-T8", qty=1)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    blocked = admin_client.post(f"/dispatches/{doc_id}/lines", json={
        "product_id": pid, "product_name": "Product", "product_sku": "DSP-T8", "qty": 1,
    })
    assert blocked.status_code == 400, blocked.text


def test_sku_pending_blocks_advance(admin_client, client_id):
    pid = _make_product(client_id, sku="", sku_pending=1)
    _seed_ready(client_id, product_id=pid, sku="", qty=5)
    doc_id = _create(admin_client, client_id, pid, "", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "SKU" in r.json()["detail"] or "артикул" in r.json()["detail"].lower()


def test_site_url_persisted(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T9")
    doc_id = _create(admin_client, client_id, pid, "DSP-T9", 1, site_url="https://shop.example/item/9")
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["site_url"] == "https://shop.example/item/9"


def test_priority_update(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T10")
    doc_id = _create(admin_client, client_id, pid, "DSP-T10", 1)
    r = admin_client.patch(f"/dispatches/{doc_id}/priority", json={"priority_rank": 1})
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["priority_rank"] == 1


# --- Брак готовится в «Готов к отгрузке» при подготовке (storage/defect → ready/defect) ---

def test_defect_advance_blocked_without_storage(admin_client, client_id):
    """Брак-отгрузку нельзя передать в подготовку без остатка брака на хранении."""
    pid = _make_product(client_id, sku="DSP-D1")
    doc_id = _create_defect(admin_client, client_id, pid, "DSP-D1", 3)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "хранени" in r.json()["detail"].lower()


def test_defect_prepare_moves_storage_to_ready(admin_client, client_id):
    """Подготовка брака перемещает его «На хранении» → «Готов к отгрузке» по выбранной ячейке."""
    pid = _make_product(client_id, sku="DSP-D2")
    _seed_storage_defect(client_id, product_id=pid, sku="DSP-D2", qty=5)
    doc_id = _create_defect(admin_client, client_id, pid, "DSP-D2", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id, SRC_CELL_DEFECT).status_code == 200
    # брак ушёл из хранения и стал «Готов к отгрузке»
    assert _storage_defect_net(client_id, pid) == 0
    assert _ready_net_defect(client_id, pid) == 5


def test_defect_consume_ships_after_prepare(admin_client, client_id):
    """Выезд рейса списывает подготовленный брак из «Готов к отгрузке» (ready/defect → shipped)."""
    from modules.dispatch.service import consume_stock_for_dispatch, dispatch_fully_shipped

    pid = _make_product(client_id, sku="DSP-D3")
    _seed_storage_defect(client_id, product_id=pid, sku="DSP-D3", qty=4)
    doc_id = _create_defect(admin_client, client_id, pid, "DSP-D3", 4)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id, SRC_CELL_DEFECT).status_code == 200

    with get_connection() as conn:
        consume_stock_for_dispatch(conn, doc_id, "test-admin-id", alloc=None, trip_id="trip-defect")
        conn.commit()
        assert dispatch_fully_shipped(conn, doc_id) is True

    assert _ready_net_defect(client_id, pid) == 0
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["shipped_qty"] == 4


def test_defect_reservation_blocks_second_dispatch(admin_client, client_id):
    """Брак на хранении режется уже открытой брак-отгрузкой — двойной отгрузки нет."""
    pid = _make_product(client_id, sku="DSP-D4")
    _seed_storage_defect(client_id, product_id=pid, sku="DSP-D4", qty=5)
    doc_a = _create_defect(admin_client, client_id, pid, "DSP-D4", 5)
    doc_b = _create_defect(admin_client, client_id, pid, "DSP-D4", 5)
    assert admin_client.post(f"/dispatches/{doc_a}/advance").status_code == 200
    assert admin_client.post(f"/dispatches/{doc_b}/advance").status_code == 400


def test_defect_prepared_does_not_reserve_fresh_storage(admin_client, client_id):
    """Подготовленный брак ушёл из хранения — свежий брак не блокирует новую отгрузку."""
    pid = _make_product(client_id, sku="DSP-D5")
    _seed_storage_defect(client_id, product_id=pid, sku="DSP-D5", qty=5)
    doc_a = _create_defect(admin_client, client_id, pid, "DSP-D5", 5)
    assert admin_client.post(f"/dispatches/{doc_a}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_a, SRC_CELL_DEFECT).status_code == 200
    # брак A уехал в «Готов к отгрузке»; завезли свежий брак — отгрузка B проходит гейт
    _seed_storage_defect(client_id, product_id=pid, sku="DSP-D5", qty=5)
    doc_b = _create_defect(admin_client, client_id, pid, "DSP-D5", 5)
    assert admin_client.post(f"/dispatches/{doc_b}/advance").status_code == 200


# --- Годный отгружается только из «Готов к отгрузке» (storage-only не проходит) ---

def test_good_advance_blocked_when_only_in_storage(admin_client, client_id):
    """Годный только «На хранении» (не разложен «Готов к отгрузке») не проходит гейт."""
    pid = _make_product(client_id, sku="DSP-G1")
    _seed_storage_good(client_id, product_id=pid, sku="DSP-G1", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-G1", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text


def test_good_prepare_then_consume(admin_client, client_id):
    """Кладовщик указывает ячейку готового → подготовка → выезд рейса списывает из ready."""
    from modules.dispatch.service import consume_stock_for_dispatch, dispatch_fully_shipped

    pid = _make_product(client_id, sku="DSP-G3")
    _seed_ready(client_id, product_id=pid, sku="DSP-G3", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-G3", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id).status_code == 200
    # после подготовки готовый по варианту сохранён (перенесён в зону отгрузки)
    assert _ready_net(client_id, pid) == 5

    with get_connection() as conn:
        consume_stock_for_dispatch(conn, doc_id, "test-admin-id", alloc=None, trip_id="trip-good")
        conn.commit()
        assert dispatch_fully_shipped(conn, doc_id) is True

    assert _ready_net(client_id, pid) == 0
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert line["shipped_qty"] == 5
