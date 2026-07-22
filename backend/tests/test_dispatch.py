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
from tests.conftest import (  # noqa: F401
    admin_client,
    manager_client,
    warehouse_client,
    make_client_id,
    cleanup_client,
)


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
        "comment": "Тех. задание: упаковать аккуратно",
        "lines": [{
            "product_id": product_id, "product_name": "Product", "product_sku": sku,
            "qty": qty, "pallets_qty": 1, "boxes_qty": 1, "site_url": site_url,
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


def _seed_packed(client_id: str, *, product_id: str, sku: str, qty: int, shipment_line_id: str):
    """Засеять «Упаковано» (packing → packed/good@зона упаковки) с привязкой к строке упаковки."""
    from modules.balances.service import insert_inventory_move, get_packing_zone

    with get_connection() as conn:
        pk_id, pk_name = get_packing_zone(conn)
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Product", product_sku=sku,
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="packed",
            from_quality="good", to_quality="good",
            from_zone_id=pk_id, from_zone_name=pk_name,
            to_zone_id=pk_id, to_zone_name=pk_name,
            qty=qty, user_id="test-admin-id", shipment_line_id=shipment_line_id,
        )
        conn.commit()
    return pk_id, pk_name


def _packed_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total

    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="packed", quality="good",
        )


def test_dispatch_from_packed_unplaced(admin_client, client_id):
    """Отгрузка из упакованного, но ещё не размещённого товара (packed).

    Менеджер выбирает упакованное (packed виден в plannable), передаёт в подготовку,
    кладовщик берёт его из «Зоны упаковки» → «Готов к отгрузке». Списание packed
    атрибутируется к строке упаковки (shipment_line_id), чтобы финальная раскладка
    задачи упаковки не переразложила уже отгруженное.
    """
    pid = _make_product(client_id, sku="DSP-PK")
    sl1 = str(uuid.uuid4())  # строка задачи упаковки, произведшая packed
    pk_id, pk_name = _seed_packed(client_id, product_id=pid, sku="DSP-PK", qty=10, shipment_line_id=sl1)

    # 1. Упакованное видно в окне выбора отгрузки (plannable.packed_good).
    pl = admin_client.get(f"/balances/plannable?client_id={client_id}&cargo_type=good").json()
    item = next(i for i in pl["items"] if i["product_id"] == pid)
    assert item["packed_good"] == 10, item

    # 2. Создаём отгрузку на 6 и передаём в подготовку — гейт пускает (packed = источник).
    doc_id = _create(admin_client, client_id, pid, "DSP-PK", 6)
    adv = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert adv.status_code == 200 and adv.json()["message"] == "preparing", adv.text

    # 3. Кладовщик готовит отгрузку, источник — «Зона упаковки» (packed).
    lines = admin_client.get(f"/dispatches/{doc_id}").json()["lines"]
    body = {"lines": [{"line_id": lines[0]["id"], "sources": [{"zone_id": pk_id, "zone_name": pk_name, "qty": 6}]}]}
    fin = admin_client.post(f"/dispatches/{doc_id}/finish-preparation", json=body)
    assert fin.status_code == 200, fin.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "awaiting_trip"

    # 4. 6 ушло packed → ready (доступно к рейсу), 4 осталось упакованным.
    assert _ready_net(client_id, pid) == 6
    assert _packed_net(client_id, pid) == 4

    # 5. Списание packed атрибутировано к строке упаковки: её ещё-не-размещённое = 4,
    #    значит финальное «Готово к рейсу» разложит только остаток (без переразложения).
    from modules.shipments.service import line_packed_pending
    with get_connection() as conn:
        assert line_packed_pending(conn, sl1)["good"] == 4


def test_create_dispatch_returns_doc_id(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T1")
    doc_id = _create(admin_client, client_id, pid, "DSP-T1", 3)
    r = admin_client.get(f"/dispatches/{doc_id}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "draft"
    assert d["doc_number"].startswith("DSP-")
    assert d["total_qty"] == 3


def test_advance_parks_without_ready(admin_client, client_id):
    """Годный без готового остатка не блокируется, а паркуется в «Ожидание упаковки»
    (товар ещё на упаковке) — фоновой цикл переведёт в подготовку по готовности."""
    pid = _make_product(client_id, sku="DSP-T2")
    doc_id = _create(admin_client, client_id, pid, "DSP-T2", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_packing"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "awaiting_packing"


def test_advance_succeeds_with_ready(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-T3")
    _seed_ready(client_id, product_id=pid, sku="DSP-T3", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-T3", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "preparing"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "preparing"


def test_advance_allows_zero_pallets(admin_client, client_id):
    """0 палет — валидное осознанное значение, гейт пропускает."""
    pid = _make_product(client_id, sku="DSP-P0")
    _seed_ready(client_id, product_id=pid, sku="DSP-P0", qty=5)
    payload = _payload(client_id, pid, "DSP-P0", 5)
    payload["lines"][0]["pallets_qty"] = 0
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "preparing"


def test_advance_blocked_without_pallets(admin_client, client_id):
    """Пустое (NULL) количество палет блокирует передачу в подготовку."""
    pid = _make_product(client_id, sku="DSP-PN")
    _seed_ready(client_id, product_id=pid, sku="DSP-PN", qty=5)
    payload = _payload(client_id, pid, "DSP-PN", 5)
    payload["lines"][0]["pallets_qty"] = None
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "палет" in r.json()["detail"].lower()


def test_advance_allows_zero_boxes(admin_client, client_id):
    """0 коробов — валидное осознанное значение, гейт пропускает."""
    pid = _make_product(client_id, sku="DSP-B0")
    _seed_ready(client_id, product_id=pid, sku="DSP-B0", qty=5)
    payload = _payload(client_id, pid, "DSP-B0", 5)
    payload["lines"][0]["boxes_qty"] = 0
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "preparing"


def test_advance_blocked_without_boxes(admin_client, client_id):
    """Пустое (NULL) количество коробов блокирует передачу в подготовку."""
    pid = _make_product(client_id, sku="DSP-BN")
    _seed_ready(client_id, product_id=pid, sku="DSP-BN", qty=5)
    payload = _payload(client_id, pid, "DSP-BN", 5)
    payload["lines"][0]["boxes_qty"] = None
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "короб" in r.json()["detail"].lower()


def test_advance_blocked_without_comment(admin_client, client_id):
    """ТЗ (comment) обязательно при передаче отгрузки в подготовку — для товара и брака."""
    pid = _make_product(client_id, sku="DSP-TZ1")
    _seed_ready(client_id, product_id=pid, sku="DSP-TZ1", qty=5)
    payload = _payload(client_id, pid, "DSP-TZ1", 5)
    payload["comment"] = "   "
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 400, r.text
    assert "техническое задание" in r.json()["detail"].lower()

    # после заполнения ТЗ передача проходит
    assert admin_client.patch(f"/dispatches/{doc_id}", json={"comment": "Собрать к 18:00"}).status_code == 200
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200


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


def test_finish_preparation_allows_shipping_zone_as_source(admin_client, client_id):
    """Товар, уже лежащий в «Зоне отгрузки», можно выбрать источником подготовки.

    Его могли разложить туда при «Готово к рейсу» после упаковки — нет причин запрещать
    отгрузку из зоны отгрузки. Самоперенос ready@зона отгрузки → ready@зона отгрузки
    оставляет готовый остаток на месте.
    """
    from modules.balances.service import get_shipping_zone, insert_inventory_move

    pid = _make_product(client_id, sku="DSP-SZ")
    with get_connection() as conn:
        ship_id, ship_name = get_shipping_zone(conn)
        insert_inventory_move(
            conn,
            product_id=pid, product_name="Product", product_sku="DSP-SZ",
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="ready", from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=ship_id, to_zone_name=ship_name,
            qty=5, user_id="test-admin-id",
        )
        conn.commit()

    doc_id = _create(admin_client, client_id, pid, "DSP-SZ", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    r = _finish_prep(admin_client, doc_id, cell=(ship_id, ship_name))
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_trip"
    # готовый остаток остался на месте (самоперенос) — рейс спишет его из зоны отгрузки
    assert _ready_net(client_id, pid) == 5
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


def test_advance_parks_when_ready_partial(admin_client, client_id):
    """Частичный готовый остаток (меньше плана) — годный паркуется в «Ожидание упаковки»."""
    pid = _make_product(client_id, sku="DSP-T4")
    _seed_ready(client_id, product_id=pid, sku="DSP-T4", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-T4", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_packing"


def test_reservation_blocks_second_dispatch(admin_client, client_id):
    """Свободный ready режется уже открытыми отгрузками — два документа не отгрузят одно и то же:
    doc_a уходит в подготовку и держит резерв, doc_b паркуется в «Ожидание упаковки», и автоцикл
    его не поднимает, пока свободного ready нет."""
    from modules.dispatch.service import autopromote_ready_dispatches
    pid = _make_product(client_id, sku="DSP-T5")
    _seed_ready(client_id, product_id=pid, sku="DSP-T5", qty=5)
    doc_a = _create(admin_client, client_id, pid, "DSP-T5", 5)
    doc_b = _create(admin_client, client_id, pid, "DSP-T5", 5)
    assert admin_client.post(f"/dispatches/{doc_a}/advance").json()["message"] == "preparing"
    # doc_a зарезервировал все 5 ready → doc_b паркуется, а не проходит в подготовку
    rb = admin_client.post(f"/dispatches/{doc_b}/advance")
    assert rb.status_code == 200 and rb.json()["message"] == "awaiting_packing"
    with get_connection() as conn:
        autopromote_ready_dispatches(conn)
    assert admin_client.get(f"/dispatches/{doc_b}").json()["status"] == "awaiting_packing"


def test_reservations_endpoint_reports_reserved(admin_client, client_id):
    """`/dispatches/reservations` отдаёт остаток, обещанный незакрытым отгрузкам —
    витрина подбора вычитает его из валового «упаковано»."""
    pid = _make_product(client_id, sku="DSP-T6")
    _seed_ready(client_id, product_id=pid, sku="DSP-T6", qty=8)
    # пока ничего не зафиксировано — резерва нет
    r0 = admin_client.get("/dispatches/reservations", params={"client_id": client_id, "cargo_type": "good"})
    assert r0.status_code == 200, r0.text
    assert all(it["product_id"] != pid for it in r0.json()["items"])
    # фиксируем отгрузку на 3 → она держит резерв в awaiting_trip-цепочке
    doc_id = _create(admin_client, client_id, pid, "DSP-T6", 3)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    r1 = admin_client.get("/dispatches/reservations", params={"client_id": client_id, "cargo_type": "good"})
    hit = [it for it in r1.json()["items"] if it["product_id"] == pid]
    assert hit and hit[0]["reserved"] == 3, r1.text


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
        "product_id": pid, "product_name": "Product", "product_sku": "DSP-T8", "qty": 1, "pallets_qty": 1, "boxes_qty": 1,
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


def test_pallets_editable_after_advance(admin_client, client_id):
    # Палеты правятся на любом не-черновом статусе (тут — «Подготовка отгрузки»).
    pid = _make_product(client_id, sku="DSP-PAL")
    _seed_ready(client_id, product_id=pid, sku="DSP-PAL", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-PAL", 3)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    r = admin_client.patch(f"/dispatches/{doc_id}/lines/{line['id']}/pallets", json={"pallets_qty": 7})
    assert r.status_code == 200, r.text
    updated = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert updated["pallets_qty"] == 7


def test_pallets_blocked_on_cancelled(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-PAL2")
    _seed_ready(client_id, product_id=pid, sku="DSP-PAL2", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-PAL2", 2)
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert admin_client.post(f"/dispatches/{doc_id}/cancel").status_code == 200
    r = admin_client.patch(f"/dispatches/{doc_id}/lines/{line['id']}/pallets", json={"pallets_qty": 5})
    assert r.status_code == 400, r.text


def test_boxes_editable_after_advance(admin_client, client_id):
    # Короба правятся на любом не-черновом статусе (тут — «Подготовка отгрузки»).
    pid = _make_product(client_id, sku="DSP-BOX")
    _seed_ready(client_id, product_id=pid, sku="DSP-BOX", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-BOX", 3)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    r = admin_client.patch(f"/dispatches/{doc_id}/lines/{line['id']}/boxes", json={"boxes_qty": 12})
    assert r.status_code == 200, r.text
    updated = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert updated["boxes_qty"] == 12


def test_boxes_blocked_on_cancelled(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-BOX2")
    _seed_ready(client_id, product_id=pid, sku="DSP-BOX2", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-BOX2", 2)
    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert admin_client.post(f"/dispatches/{doc_id}/cancel").status_code == 200
    r = admin_client.patch(f"/dispatches/{doc_id}/lines/{line['id']}/boxes", json={"boxes_qty": 5})
    assert r.status_code == 400, r.text


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


def test_line_file_upload_and_delete(admin_client, client_id):
    """Менеджер прикрепляет файл (pdf/zip/jpeg) к строке отгрузки в черновике,
    файл виден в detail, затем удаляется."""
    pid = _make_product(client_id, sku="DSP-F1")
    doc_id = _create(admin_client, client_id, pid, "DSP-F1", 1)
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]

    up = admin_client.post(
        f"/dispatches/{doc_id}/lines/{line_id}/files",
        files={"file": ("накладная.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    file_id = up.json()["message"]

    line = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]
    assert len(line["files"]) == 1
    assert line["files"][0]["filename"] == "накладная.pdf"
    assert line["files"][0]["url"].startswith("/uploads/")

    rm = admin_client.delete(f"/dispatches/{doc_id}/lines/{line_id}/files/{file_id}")
    assert rm.status_code == 200, rm.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["files"] == []


def test_line_file_rejects_bad_extension(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-F2")
    doc_id = _create(admin_client, client_id, pid, "DSP-F2", 1)
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    bad = admin_client.post(
        f"/dispatches/{doc_id}/lines/{line_id}/files",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert bad.status_code == 400, bad.text


def test_line_file_editable_until_prepared(admin_client, client_id):
    """Файлы прикрепляются в черновике и на подготовке (кладовщик собирает отгрузку);
    после завершения подготовки (awaiting_trip) — уже нельзя."""
    pid = _make_product(client_id, sku="DSP-F3")
    _seed_ready(client_id, product_id=pid, sku="DSP-F3", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-F3", 2)
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    # На подготовке прикрепить ещё можно.
    ok = admin_client.post(
        f"/dispatches/{doc_id}/lines/{line_id}/files",
        files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert ok.status_code == 200, ok.text
    # После завершения подготовки — нельзя.
    assert _finish_prep(admin_client, doc_id).status_code == 200
    blocked = admin_client.post(
        f"/dispatches/{doc_id}/lines/{line_id}/files",
        files={"file": ("doc2.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert blocked.status_code == 400, blocked.text


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

def test_good_advance_parks_when_only_in_storage(admin_client, client_id):
    """Годный только «На хранении» (не разложен «Готов к отгрузке») паркуется в «Ожидание упаковки»."""
    pid = _make_product(client_id, sku="DSP-G1")
    _seed_storage_good(client_id, product_id=pid, sku="DSP-G1", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-G1", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "awaiting_packing"


def test_awaiting_packing_autopromotes_when_ready_arrives(admin_client, client_id):
    """Как только упаковка выдала готовый остаток — фоновой цикл сам двигает
    «Ожидание упаковки» → «Подготовка»."""
    from modules.dispatch.service import autopromote_ready_dispatches
    pid = _make_product(client_id, sku="DSP-AP1")
    doc_id = _create(admin_client, client_id, pid, "DSP-AP1", 5)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").json()["message"] == "awaiting_packing"
    _seed_ready(client_id, product_id=pid, sku="DSP-AP1", qty=5)
    with get_connection() as conn:
        promoted = autopromote_ready_dispatches(conn)
    assert promoted >= 1
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "preparing"


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


def _dup_check(admin_client, client_id, product_id, qty, *, ship_date="2026-07-01", cargo_type="good"):
    return admin_client.post("/dispatches/check-duplicate", json={
        "cargo_type": cargo_type,
        "client_id": client_id,
        "ship_date": ship_date,
        "lines": [{"product_id": product_id, "color_id": None, "size_id": None, "qty": qty}],
    })


def test_duplicate_check_exact_match(admin_client, client_id):
    """Тот же клиент + плановая дата + состав → совпадение 100%."""
    pid = _make_product(client_id, sku="DSP-DUP1")
    doc_id = _create(admin_client, client_id, pid, "DSP-DUP1", 10)
    r = _dup_check(admin_client, client_id, pid, 10)
    assert r.status_code == 200, r.text
    matches = r.json()["matches"]
    assert len(matches) == 1
    assert matches[0]["id"] == doc_id
    assert matches[0]["lines"][0]["qty"] == 10


def test_duplicate_check_qty_differs(admin_client, client_id):
    """Другое количество — состав не совпадает, дубля нет."""
    pid = _make_product(client_id, sku="DSP-DUP2")
    _create(admin_client, client_id, pid, "DSP-DUP2", 10)
    assert _dup_check(admin_client, client_id, pid, 11).json()["matches"] == []


def test_duplicate_check_date_differs(admin_client, client_id):
    """Другая плановая дата — за тот день дубля нет."""
    pid = _make_product(client_id, sku="DSP-DUP3")
    _create(admin_client, client_id, pid, "DSP-DUP3", 10)
    assert _dup_check(admin_client, client_id, pid, 10, ship_date="2026-07-02").json()["matches"] == []


def test_duplicate_check_ignores_cancelled(admin_client, client_id):
    """Аннулированная отгрузка не считается дублем."""
    pid = _make_product(client_id, sku="DSP-DUP4")
    doc_id = _create(admin_client, client_id, pid, "DSP-DUP4", 10)
    assert admin_client.post(f"/dispatches/{doc_id}/cancel").status_code == 200
    assert _dup_check(admin_client, client_id, pid, 10).json()["matches"] == []


def test_duplicate_check_cargo_type_differs(admin_client, client_id):
    """Годная и брак с одинаковым составом — разные типы, не дубль."""
    pid = _make_product(client_id, sku="DSP-DUP5")
    _create(admin_client, client_id, pid, "DSP-DUP5", 10)
    assert _dup_check(admin_client, client_id, pid, 10, cargo_type="defect").json()["matches"] == []


# --- Авторизация: паритет с receipts/shipments по созданию и стоимости ---

def test_warehouse_cannot_create_dispatch(warehouse_client, client_id):
    """Кладовщик не создаёт отгрузку — это менеджерский состав (document_creator)."""
    pid = _make_product(client_id, sku="DSP-RBAC1")
    r = warehouse_client.post("/dispatches", json=_payload(client_id, pid, "DSP-RBAC1", 5))
    assert r.status_code == 403, r.text


def test_manager_can_create_dispatch(manager_client, client_id):
    """Менеджер по-прежнему создаёт отгрузку."""
    pid = _make_product(client_id, sku="DSP-RBAC2")
    r = manager_client.post("/dispatches", json=_payload(client_id, pid, "DSP-RBAC2", 5))
    assert r.status_code == 200, r.text


def test_logistics_cost_hidden_from_warehouse(admin_client, warehouse_client, client_id):
    """logistics_cost видят только admin/manager; кладовщику в list/detail — None."""
    pid = _make_product(client_id, sku="DSP-RBAC3")
    payload = _payload(client_id, pid, "DSP-RBAC3", 5)
    payload["logistics_cost"] = 1234.5
    doc_id = admin_client.post("/dispatches", json=payload).json()["message"]

    # admin видит стоимость
    assert admin_client.get(f"/dispatches/{doc_id}").json()["logistics_cost"] == 1234.5
    # кладовщик — нет
    assert warehouse_client.get(f"/dispatches/{doc_id}").json()["logistics_cost"] is None
    wh_item = next(
        it for it in warehouse_client.get("/dispatches?limit=200").json()["items"]
        if it["id"] == doc_id
    )
    assert wh_item["logistics_cost"] is None


def test_warehouse_cannot_set_logistics_cost_on_update(admin_client, warehouse_client, client_id):
    """Кладовщик не может записать logistics_cost через PATCH черновика."""
    pid = _make_product(client_id, sku="DSP-RBAC4")
    doc_id = _create(admin_client, client_id, pid, "DSP-RBAC4", 5)
    r = warehouse_client.patch(f"/dispatches/{doc_id}", json={"logistics_cost": 999})
    assert r.status_code == 403, r.text


def test_uploaded_file_served_as_attachment_with_nosniff(admin_client, client_id):
    """Вложения-не-картинки раздаются как attachment + nosniff (не inline), закрывая stored-XSS."""
    pid = _make_product(client_id, sku="DSP-UP1")
    doc_id = _create(admin_client, client_id, pid, "DSP-UP1", 1)
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    up = admin_client.post(
        f"/dispatches/{doc_id}/lines/{line_id}/files",
        files={"file": ("накладная.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    url = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["files"][0]["url"]

    served = admin_client.get(url)
    assert served.status_code == 200, served.text
    assert served.headers.get("x-content-type-options") == "nosniff"
    assert "attachment" in (served.headers.get("content-disposition") or "")


def test_uploads_rejects_path_traversal(admin_client):
    """Имя файла с разделителями/traversal не проходит — 404, а не выход из каталога."""
    assert admin_client.get("/uploads/..%2f..%2fapp.py").status_code == 404
    assert admin_client.get("/uploads/nonexistent-file.pdf").status_code == 404


# --- «Вернуть на корректировку» (return-to-draft) ---

def test_return_to_draft_from_preparing(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-R1")
    _seed_ready(client_id, product_id=pid, sku="DSP-R1", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-R1", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    r = admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={"reason": "Ошибка в количестве"})
    assert r.status_code == 200, r.text
    detail = admin_client.get(f"/dispatches/{doc_id}").json()
    assert detail["status"] == "draft"
    # состав сохранён, документ снова редактируем и передаётся в подготовку повторно
    assert len(detail["lines"]) == 1
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    # причина попала в журнал
    ops = admin_client.get(f"/dispatches/{doc_id}").json()["ops"]
    ret = [o for o in ops if o["op_type"] == "return_to_draft"]
    assert len(ret) == 1
    assert "Ошибка в количестве" in ret[0]["comment"]


def test_return_to_draft_from_awaiting_trip_restores_stock(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-R2")
    _seed_ready(client_id, product_id=pid, sku="DSP-R2", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-R2", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id).status_code == 200
    r = admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={})
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "draft"
    # сторно подготовки: остаток вернулся в исходную ячейку, ничего не потеряно
    assert _ready_net(client_id, pid) == 2
    # цикл замыкается: снова в подготовку и снова подготовить
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id).status_code == 200


def test_return_to_draft_from_awaiting_packing(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-R3")
    _seed_storage_good(client_id, product_id=pid, sku="DSP-R3", qty=5)
    doc_id = _create(admin_client, client_id, pid, "DSP-R3", 5)
    r = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert r.status_code == 200 and r.json()["message"] == "awaiting_packing"
    r = admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={})
    assert r.status_code == 200, r.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "draft"


def test_return_to_draft_blocked_from_draft_and_cancelled(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-R4")
    _seed_ready(client_id, product_id=pid, sku="DSP-R4", qty=2)
    doc_id = _create(admin_client, client_id, pid, "DSP-R4", 2)
    assert admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={}).status_code == 400
    assert admin_client.post(f"/dispatches/{doc_id}/cancel").status_code == 200
    assert admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={}).status_code == 400


def test_return_to_draft_blocked_by_active_trip(admin_client, client_id):
    pid = _make_product(client_id, sku="DSP-R5")
    _seed_ready(client_id, product_id=pid, sku="DSP-R5", qty=3)
    doc_id = _create(admin_client, client_id, pid, "DSP-R5", 3)
    assert admin_client.post(f"/dispatches/{doc_id}/advance").status_code == 200
    assert _finish_prep(admin_client, doc_id).status_code == 200
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    trip_id = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "good",
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
    }).json()["message"]
    link = admin_client.post(f"/trips/{trip_id}/dispatches", json={
        "items": [{"dispatch_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 3}]}],
    })
    assert link.status_code == 200, link.text
    blocked = admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={})
    assert blocked.status_code == 400
    assert "рейс" in blocked.json()["detail"]
    # отвязали от рейса — возврат проходит
    unlink = admin_client.delete(f"/trips/{trip_id}/dispatches/{doc_id}")
    assert unlink.status_code == 200, unlink.text
    r = admin_client.post(f"/dispatches/{doc_id}/return-to-draft", json={})
    assert r.status_code == 200, r.text
    assert _ready_net(client_id, pid) == 3
