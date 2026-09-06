"""FBS-поставки (Фаза 2): волны, маршрутизация потока заказов, состав, ячейки,
лист подбора, дозагрузка и переходы фаз.

Ключевой инвариант — один заказ в одной активной поставке — держится частичным
UNIQUE-индексом; тесты проверяют, что маршрутизатор его не нарушает ни при
повторном прогоне, ни после снятия заказа менеджером.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import (
    CONTAINER_STATUS_PLACED,
    MP_SUPPLY_PICK_OP,
    INV_Q_GOOD,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_LINK_SOURCE_MANUAL,
    MP_ORDER_STATUS_CANCELLED,
    MP_ORDER_STATUS_NEW,
    MP_OZON,
    MP_SUPPLY_ORDER_PENDING,
    MP_SUPPLY_ORDER_SELECTED,
    MP_SUPPLY_STATUS_CHECKING,
    MP_SUPPLY_STATUS_CORRECTING,
    MP_SUPPLY_STATUS_HANDOVER,
    MP_SUPPLY_STATUS_PACKING,
    MP_SUPPLY_STATUS_PICKING,
    MP_WB,
)
from dbconn import get_connection
from modules.balances.service import insert_inventory_move
from modules.marketplaces import clients as mp_clients
from modules.marketplaces import service as mp_service
from tests.conftest import (  # noqa: F401
    cleanup_client,
    make_client_id,
    manager_client,
    picker_client,
    warehouse_client,
)


def _now() -> datetime:
    return datetime.now(UTC)


@pytest.fixture
def fbs():
    """Кабинет Ozon с одним связанным вариантом, ячейкой и остатком 10 шт."""
    cid = make_client_id()
    account_id = str(uuid.uuid4())
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    mp_product_id = str(uuid.uuid4())
    cell_id = str(uuid.uuid4())
    cell_name = f"A-{uuid.uuid4().hex[:4]}"
    barcode = f"FBS-{uuid.uuid4().hex[:10].upper()}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, ozon_client_id, "
            "api_key, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,NOW(),?)",
            (account_id, cid, MP_OZON, f"Shop-{account_id[:6]}", "12345",
             "secret-api-key-abcd1234", MP_ACCOUNT_STATUS_ACTIVE, "test-admin-id"),
        )
        conn.execute(
            "INSERT INTO unloading_zones (id, name, kind, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 'cell', 1, 0, NOW())",
            (cell_id, cell_name),
        )
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"FbsType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, "Худи оверсайз", type_id, cid, f"FF-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"FF-V-{vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?,?,?,?,NOW(),0)",
            (str(uuid.uuid4()), pid, vid, barcode),
        )
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,'[]',NULL,NULL,NOW())",
            (mp_product_id, account_id, "900001", "ART-1", "Худи оверсайз чёрный M"),
        )
        conn.execute(
            "INSERT INTO mp_product_links (id, mp_product_id, product_id, variant_id, "
            "link_source, created_at, created_by, is_deleted) VALUES (?,?,?,?,?,NOW(),?,0)",
            (str(uuid.uuid4()), mp_product_id, pid, vid, MP_LINK_SOURCE_MANUAL, "test-admin-id"),
        )
        insert_inventory_move(
            conn,
            product_id=pid, product_name="Худи оверсайз", product_sku=f"FF-{pid[:8]}",
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=cid, client_name="Test Client",
            from_op="intake", to_op=MP_SUPPLY_PICK_OP,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=None, from_zone_name=None,
            to_zone_id=cell_id, to_zone_name=cell_name,
            qty=10, user_id="test-admin-id",
        )
        conn.commit()
    yield {
        "account_id": account_id, "client_id": cid, "product_id": pid, "variant_id": vid,
        "mp_product_id": mp_product_id, "cell_id": cell_id, "cell_name": cell_name,
        "type_id": type_id, "barcode": barcode,
    }
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM mp_cargo_unit_orders WHERE cargo_unit_id IN (SELECT id FROM mp_cargo_units "
            "WHERE supply_id IN (SELECT id FROM mp_supplies WHERE account_id = ?))", (account_id,))
        conn.execute(
            "DELETE FROM mp_cargo_units WHERE supply_id IN "
            "(SELECT id FROM mp_supplies WHERE account_id = ?)", (account_id,))
        conn.execute(
            "DELETE FROM mp_supply_packs WHERE supply_id IN "
            "(SELECT id FROM mp_supplies WHERE account_id = ?)", (account_id,))
        conn.execute(
            "DELETE FROM mp_supply_picks WHERE supply_id IN "
            "(SELECT id FROM mp_supplies WHERE account_id = ?)", (account_id,))
        conn.execute(
            "DELETE FROM mp_supply_ops WHERE supply_id IN "
            "(SELECT id FROM mp_supplies WHERE account_id = ?)", (account_id,))
        conn.execute(
            "DELETE FROM mp_supply_orders WHERE supply_id IN "
            "(SELECT id FROM mp_supplies WHERE account_id = ?)", (account_id,))
        conn.execute("DELETE FROM mp_supplies WHERE account_id = ?", (account_id,))
        conn.execute(
            "DELETE FROM mp_order_lines WHERE order_id IN "
            "(SELECT id FROM mp_orders WHERE account_id = ?)", (account_id,))
        conn.execute("DELETE FROM mp_orders WHERE account_id = ?", (account_id,))
        conn.execute(
            "DELETE FROM mp_product_links WHERE mp_product_id IN "
            "(SELECT id FROM mp_products WHERE account_id = ?)", (account_id,))
        conn.execute("DELETE FROM mp_products WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_accounts WHERE id = ?", (account_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (cid,))
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.execute("DELETE FROM unloading_zones WHERE id = ?", (cell_id,))
        conn.commit()
    cleanup_client(cid)


def _add_order(fbs, *, external_id: str, deadline: datetime | None, qty: int = 1,
               linked: bool = True, status: str = MP_ORDER_STATUS_NEW) -> str:
    order_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_orders (id, account_id, external_id, status, external_status, "
            "created_at_mp, deadline_at, deadline_source, total_qty, payload, first_seen_at, updated_at) "
            "VALUES (?,?,?,?,'awaiting_packaging',NOW(),?,'api',?,NULL,NOW(),NOW())",
            (order_id, fbs["account_id"], external_id, status,
             deadline.isoformat() if deadline else None, qty),
        )
        conn.execute(
            "INSERT INTO mp_order_lines (id, order_id, mp_product_id, offer_id, title, qty, price_kopecks) "
            "VALUES (?,?,?,?,?,?,NULL)",
            (str(uuid.uuid4()), order_id, fbs["mp_product_id"] if linked else None,
             "ART-1", "Худи оверсайз чёрный M", qty),
        )
        conn.commit()
    return order_id


def _free_pool_ids(fbs) -> list[str]:
    with get_connection() as conn:
        pool = mp_service.free_orders_pool(conn, account_id=fbs["account_id"])
        if not pool:
            return []
        rows = conn.execute(
            "SELECT o.id FROM mp_orders o WHERE o.account_id = ? AND o.status IN (?, ?) "
            "AND NOT EXISTS (SELECT 1 FROM mp_supply_orders so "
            "                WHERE so.order_id = o.id AND so.state IN (?, ?)) "
            "ORDER BY o.deadline_at ASC NULLS LAST, o.first_seen_at ASC",
            (fbs["account_id"], "new", "in_progress", "selected", "pending"),
        ).fetchall()
    return [str(r["id"]) for r in rows]


def _route(fbs, order_ids: list[str] | None = None) -> str:
    """Завести поставку из пула: весь свободный пул или названные заказы."""
    picked = order_ids if order_ids is not None else _free_pool_ids(fbs)
    with get_connection() as conn:
        supply_id = mp_service.create_supply(
            conn, account_id=fbs["account_id"], order_ids=picked, user_id="test-admin-id",
        )
        conn.commit()
    return supply_id


def _supplies(fbs) -> list:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM mp_supplies WHERE account_id = ? ORDER BY doc_number",
            (fbs["account_id"],),
        ).fetchall()


def _transfer(supply_id: str) -> None:
    """«Передать поставку площадке» — обязательный шаг перед сборкой.
    Кабинет фикстуры — Ozon, поэтому площадка здесь не вызывается."""
    with get_connection() as conn:
        mp_service.transfer_supply_to_marketplace(conn, supply_id, "u")
        conn.commit()


def _pick(conn, fbs, supply_id: str, *, qty: int, user_id: str = "u") -> dict:
    return mp_service.register_pick(
        conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
        container_id=None, qty=qty, user_id=user_id, role="admin",
    )


def _detail(supply_id: str) -> dict:
    with get_connection() as conn:
        return mp_service.supply_detail(conn, supply_id)


# ── Пул свободных заказов и набор состава ─────────────────────────────────────

def test_wave_key_floors_to_hour():
    assert mp_service.supply_wave_key("2026-09-03T13:47:12+00:00").startswith("2026-09-03T13:00")
    assert mp_service.supply_wave_key(None) is None


def test_new_order_waits_in_the_pool(fbs):
    """Синк только приносит заказ: поставку из него заводит менеджер."""
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=6), qty=2)
    assert _supplies(fbs) == []
    with get_connection() as conn:
        pool = mp_service.free_orders_pool(conn, account_id=fbs["account_id"])
    assert len(pool) == 1
    assert pool[0]["orders_count"] == 1
    assert pool[0]["total_qty"] == 2


def test_cutoff_follows_the_earliest_deadline_in_the_supply(fbs):
    """Отсечка — следствие состава: обещать дольше самого срочного заказа нельзя."""
    early = (_now() + timedelta(hours=4)).replace(minute=45, second=0, microsecond=0)
    late = _now() + timedelta(hours=20)
    _add_order(fbs, external_id="0192-1", deadline=late)
    _add_order(fbs, external_id="0192-2", deadline=early)
    supply_id = _route(fbs)
    supply = _supplies(fbs)[0]
    assert str(supply["cutoff_at"]) == mp_service.supply_wave_key(early.isoformat())
    # Приём закрывается за 30 минут до отсечки — считает система, не человек.
    assert supply["intake_closes_at"] < supply["cutoff_at"]

    # Срочный заказ ушёл из состава — отсечка отъезжает к следующему по срочности.
    with get_connection() as conn:
        keep = [o["order_id"] for o in mp_service.supply_detail(conn, supply_id)["orders"]
                if o["external_id"] == "0192-1"]
        mp_service.set_supply_orders(conn, supply_id, keep, "test-admin-id")
        conn.commit()
    assert str(_supplies(fbs)[0]["cutoff_at"]) == mp_service.supply_wave_key(late.isoformat())


def test_account_can_have_several_open_supplies(fbs):
    """Поставка = отгрузка FBS: поток делится на столько, на сколько удобно складу."""
    cutoff = _now() + timedelta(hours=5)
    first = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    second = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    third = _add_order(fbs, external_id="0192-3", deadline=cutoff)
    a = _route(fbs, [first])
    b = _route(fbs, [second, third])
    assert a != b
    supplies = _supplies(fbs)
    assert len(supplies) == 2
    assert all(str(x["status"]) == MP_SUPPLY_STATUS_CHECKING for x in supplies)
    assert _detail(a)["doc"]["orders_total"] == 1
    assert _detail(b)["doc"]["orders_total"] == 2
    with get_connection() as conn:
        assert mp_service.free_orders_pool(conn, account_id=fbs["account_id"]) == []


def test_order_is_taken_by_one_supply_only(fbs):
    cutoff = _now() + timedelta(hours=5)
    order_id = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs, [order_id])
    with pytest.raises(HTTPException) as exc:
        _route(fbs, [order_id])
    assert exc.value.status_code == 400
    assert len(_supplies(fbs)) == 1


def test_supply_without_orders_is_not_created(fbs):
    """Пустышек быть не должно: поставку создаёт выбор заказов, а не нажатие кнопки."""
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    with pytest.raises(HTTPException) as exc:
        _route(fbs, [])
    assert exc.value.status_code == 400
    assert _supplies(fbs) == []


def test_supply_starts_on_checking_without_a_second_confirmation(fbs):
    """Состав выбран в пуле — подтверждать тот же список отдельной фазой нечем.

    Заведение и есть принятое обязательство, поэтому следующий шаг сразу отдаёт
    поставку сборщику, а не открывает второй проход по тем же заказам.
    """
    order_id = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), qty=2)
    supply_id = _route(fbs, [order_id])
    row = _supplies(fbs)[0]
    assert str(row["status"]) == MP_SUPPLY_STATUS_CHECKING
    assert row["checking_at"] is not None
    assert _detail(supply_id)["doc"]["orders_total"] == 1
    _transfer(supply_id)
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PICKING
        conn.commit()


def test_picking_waits_for_the_transfer_to_the_marketplace(fbs):
    """В сборку уходит только переданная площадке поставка: у WB задания к этому
    моменту лежат в поставке продавца, иначе сборщик работает без этикеток."""
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    supply_id = _route(fbs)
    with pytest.raises(HTTPException) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "u")
    assert "не передана площадке" in exc.value.detail
    _transfer(supply_id)
    row = _supplies(fbs)[0]
    assert row["mp_transferred_at"] is not None
    assert str(row["status"]) == MP_SUPPLY_STATUS_CHECKING
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PICKING
        with pytest.raises(HTTPException):
            mp_service.transfer_supply_to_marketplace(conn, supply_id, "u")


def test_transfer_needs_a_clean_composition(fbs):
    """После передачи состав не правится, поэтому с блокером площадке не отдаём."""
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), linked=False)
    supply_id = _route(fbs)
    with pytest.raises(HTTPException) as exc:
        with get_connection() as conn:
            mp_service.transfer_supply_to_marketplace(conn, supply_id, "u")
    assert exc.value.status_code == 400
    assert _supplies(fbs)[0]["mp_transferred_at"] is None


def test_transfer_to_wb_creates_the_seller_supply_with_all_orders(fbs, monkeypatch):
    calls: dict[str, list] = {"created": [], "added": []}
    monkeypatch.setattr(
        mp_clients, "wb_create_supply",
        lambda creds, name: calls["created"].append(name) or "WB-GI-77",
    )
    monkeypatch.setattr(
        mp_clients, "wb_add_orders_to_supply",
        lambda creds, sid, ids: calls["added"].append((sid, sorted(ids))),
    )
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET marketplace = ? WHERE id = ?", (MP_WB, fbs["account_id"]))
        conn.commit()
    a = _add_order(fbs, external_id="1001", deadline=_now() + timedelta(hours=5))
    b = _add_order(fbs, external_id="1002", deadline=_now() + timedelta(hours=5))
    supply_id = _route(fbs, [a, b])
    _transfer(supply_id)
    row = _supplies(fbs)[0]
    assert row["external_supply_id"] == "WB-GI-77"
    assert calls["created"] == [row["doc_number"]]
    assert calls["added"] == [("WB-GI-77", ["1001", "1002"])]
    with get_connection() as conn:
        shipped = conn.execute(
            "SELECT COUNT(*) AS n FROM mp_orders WHERE id IN (?, ?) AND mp_shipped_at IS NOT NULL",
            (a, b),
        ).fetchone()["n"]
    assert shipped == 2


def test_transferred_supply_is_locked_for_cancel_and_edits(fbs):
    """После передачи площадке состав зафиксирован: ни аннулировать, ни перевыбрать."""
    keep = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    _add_order(fbs, external_id="0192-2", deadline=_now() + timedelta(hours=5))
    supply_id = _route(fbs)
    _transfer(supply_id)
    with get_connection() as conn:
        for action in (
            lambda: mp_service.cancel_supply(conn, supply_id, "u"),
            lambda: mp_service.start_supply_correction(conn, supply_id, "u"),
            lambda: mp_service.set_supply_orders(conn, supply_id, [keep], "u"),
        ):
            with pytest.raises(HTTPException) as exc:
                action()
            assert exc.value.status_code == 400
    assert _detail(supply_id)["doc"]["orders_total"] == 2


def test_correction_reopens_the_choice_and_applies_it_as_a_whole(fbs):
    """«Скорректировать» — тот же выбор галочками, что и при заведении: пока он
    открыт, поставка стоит на «Корректировке» и не двигается; применяется целиком,
    отмена возвращает прежний состав."""
    cutoff = _now() + timedelta(hours=5)
    first = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    second = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    supply_id = _route(fbs, [first])
    with get_connection() as conn:
        mp_service.start_supply_correction(conn, supply_id, "u")
        conn.commit()
    row = _supplies(fbs)[0]
    assert str(row["status"]) == MP_SUPPLY_STATUS_CORRECTING
    assert row["correcting_at"] is not None
    assert _free_pool_ids(fbs) == [second]
    with get_connection() as conn:
        for action in (
            lambda: mp_service.advance_supply(conn, supply_id, "u"),
            lambda: mp_service.transfer_supply_to_marketplace(conn, supply_id, "u"),
            lambda: mp_service.apply_supply_correction(conn, supply_id, [], "u"),
        ):
            with pytest.raises(HTTPException) as exc:
                action()
            assert exc.value.status_code == 400

    with get_connection() as conn:
        mp_service.discard_supply_correction(conn, supply_id, "u")
        conn.commit()
    assert str(_supplies(fbs)[0]["status"]) == MP_SUPPLY_STATUS_CHECKING
    assert _detail(supply_id)["doc"]["orders_total"] == 1

    with get_connection() as conn:
        mp_service.start_supply_correction(conn, supply_id, "u")
        stats = mp_service.apply_supply_correction(conn, supply_id, [second], "u")
        conn.commit()
    assert stats == {"selected": 1, "unselected": 1}
    assert str(_supplies(fbs)[0]["status"]) == MP_SUPPLY_STATUS_CHECKING
    detail = _detail(supply_id)
    assert [o["order_id"] for o in detail["orders"] if o["state"] == "selected"] == [second]
    assert _free_pool_ids(fbs) == [first]
    with get_connection() as conn:
        with pytest.raises(HTTPException):
            mp_service.discard_supply_correction(conn, supply_id, "u")


def test_correction_endpoints_are_for_the_manager(manager_client, warehouse_client, fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    supply_id = _route(fbs)
    assert warehouse_client.post(f"/marketplaces/supplies/{supply_id}/correct").status_code == 403
    r = manager_client.post(f"/marketplaces/supplies/{supply_id}/correct")
    assert r.status_code == 200, r.text
    assert manager_client.get(f"/marketplaces/supplies/{supply_id}").json()["doc"]["status"] == (
        MP_SUPPLY_STATUS_CORRECTING
    )
    r = manager_client.post(f"/marketplaces/supplies/{supply_id}/correct/discard")
    assert r.status_code == 200, r.text
    r = manager_client.post(f"/marketplaces/supplies/{supply_id}/transfer")
    assert r.status_code == 200, r.text
    doc = manager_client.get(f"/marketplaces/supplies/{supply_id}").json()["doc"]
    assert doc["mp_transferred_at"] is not None
    assert manager_client.post(f"/marketplaces/supplies/{supply_id}/cancel").status_code == 400


def test_pool_is_analyzed_before_it_is_taken(fbs, manager_client):
    """Пул приходит разобранным: состав и готовность видны до выбора."""
    keep = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    _add_order(fbs, external_id="0192-2", deadline=_now() + timedelta(hours=6), linked=False)
    supply_id = _route(fbs, [keep])

    r = manager_client.get(f"/marketplaces/supplies/pool?account_id={fbs['account_id']}")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["external_id"] for i in items] == ["0192-2"]
    assert items[0]["summary"]
    assert items[0]["blockers"] == ["unlinked"]

    # Та же выборка в разрезе поставки — то, что она может добрать.
    r = manager_client.get(f"/marketplaces/supplies/{supply_id}/candidates")
    assert r.status_code == 200, r.text
    assert [i["external_id"] for i in r.json()["items"]] == ["0192-2"]


def test_unselected_order_returns_to_the_pool(fbs):
    """Снятый галочкой заказ свободен: его возьмёт эта же или любая другая поставка."""
    cutoff = _now() + timedelta(hours=5)
    keep = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    drop = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    supply_id = _route(fbs)
    with get_connection() as conn:
        mp_service.set_supply_orders(conn, supply_id, [keep], "test-admin-id")
        conn.commit()
    assert _free_pool_ids(fbs) == [drop]

    other = _route(fbs, [drop])
    assert _detail(other)["doc"]["orders_total"] == 1
    with get_connection() as conn:
        assert mp_service.free_orders_pool(conn, account_id=fbs["account_id"]) == []


def test_pool_order_docks_into_a_running_picking(fbs):
    cutoff = _now() + timedelta(hours=5)
    first = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    supply_id = _route(fbs, [first])
    _transfer(supply_id)
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    late = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    with get_connection() as conn:
        assert mp_service.dock_supply_orders(conn, supply_id, [late], "u") == 1
        conn.commit()
    detail = _detail(supply_id)
    assert detail["doc"]["orders_total"] == 2
    assert _free_pool_ids(fbs) == []


def test_closed_intake_stops_docking(fbs):
    """После закрытия приёма состав не растёт — новый заказ берёт другая поставка."""
    cutoff = _now() + timedelta(minutes=10)  # приём (−30 мин) уже в прошлом
    first = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    supply_id = _route(fbs, [first])
    _transfer(supply_id)
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        assert mp_service.close_due_intakes(conn) == 1
        conn.commit()
    late = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    with get_connection() as conn:
        with pytest.raises(HTTPException) as exc:
            mp_service.dock_supply_orders(conn, supply_id, [late], "u")
        assert exc.value.status_code == 400
    assert _free_pool_ids(fbs) == [late]
    assert _route(fbs, [late]) != supply_id


def test_cancelled_order_leaves_supply_while_drafting(fbs):
    order_id = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    supply_id = _route(fbs)
    with get_connection() as conn:
        conn.execute("UPDATE mp_orders SET status = ? WHERE id = ?",
                     (MP_ORDER_STATUS_CANCELLED, order_id))
        released = mp_service.release_cancelled_orders(conn)
        conn.commit()
    assert released == 1
    assert _detail(supply_id)["doc"]["orders_total"] == 0
    assert _supplies(fbs)[0]["cutoff_at"] is None


# ── Лист подбора и ячейки ─────────────────────────────────────────────────────

def test_pick_list_folds_by_variant_and_shows_cell(fbs):
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff, qty=3)
    _add_order(fbs, external_id="0192-2", deadline=cutoff, qty=4)
    _route(fbs)
    detail = _detail(str(_supplies(fbs)[0]["id"]))
    assert len(detail["pick_list"]) == 1
    item = detail["pick_list"][0]
    assert item["need_qty"] == 7
    assert item["orders_count"] == 2
    assert item["available_qty"] == 10
    assert item["shortage_qty"] == 0
    assert item["cells"] == [fbs["cell_name"]]
    assert detail["doc"]["cells_count"] == 1
    assert detail["blockers"] == []


def test_shortage_blocks_advance_and_marks_orders(fbs):
    # Минута прибита: волна режется по часу, и на прогоне в :59 сдвиг на минуту
    # разложил бы заказы по двум поставкам вместо одной.
    cutoff = (_now() + timedelta(hours=5)).replace(minute=5, second=0, microsecond=0)
    _add_order(fbs, external_id="0192-1", deadline=cutoff, qty=8)
    _add_order(fbs, external_id="0192-2", deadline=cutoff.replace(minute=6), qty=8)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    detail = _detail(supply_id)
    assert detail["doc"]["shortage_positions"] == 1
    # Жадное распределение по дедлайну: остатка хватает ровно на один заказ.
    assert detail["doc"]["orders_ready"] == 1
    assert any(b["kind"] == "shortage" for b in detail["blockers"])
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "test-admin-id")
    assert "Нет остатка" in str(getattr(exc.value, "detail", exc.value))


def test_unlinked_line_is_a_blocker(fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), linked=False)
    _route(fbs)
    detail = _detail(str(_supplies(fbs)[0]["id"]))
    assert detail["doc"]["unlinked_positions"] == 1
    assert any(b["kind"] == "unlinked" for b in detail["blockers"])
    assert detail["orders"][0]["ready"] is False
    assert "unlinked" in detail["orders"][0]["blockers"]


def test_excluding_problem_order_unblocks_the_supply(fbs):
    cutoff = _now() + timedelta(hours=5)
    good = _add_order(fbs, external_id="0192-1", deadline=cutoff, qty=2)
    _add_order(fbs, external_id="0192-2", deadline=cutoff, linked=False)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.set_supply_orders(conn, supply_id, [good], "test-admin-id")
        conn.commit()
    detail = _detail(supply_id)
    assert detail["blockers"] == []
    assert detail["doc"]["orders_total"] == 1


# ── Фазы ──────────────────────────────────────────────────────────────────────

def test_phase_chain_and_intake_close_on_packing(fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), qty=2)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    _transfer(supply_id)
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PICKING
        # Сборка закрывается только полностью собранным составом — иначе
        # «Собрано не всё» не пустит поставку на упаковку.
        _pick(conn, fbs, supply_id, qty=2)
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PACKING
        conn.commit()
    row = _supplies(fbs)[0]
    assert row["intake_closed_at"] is not None


def test_empty_supply_cannot_advance(fbs):
    order_id = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.set_supply_orders(conn, supply_id, [], "u")
        conn.commit()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "u")
    assert "нет ни одного заказа" in str(getattr(exc.value, "detail", exc.value))
    assert order_id  # заказ жив, просто ждёт следующей поставки


def test_pending_dock_blocks_handover(fbs):
    """Строка дозагрузки от прежней автораскладки не даёт уехать, пока не разобрана."""
    cutoff = _now() + timedelta(hours=5)
    first = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    supply_id = _route(fbs, [first])
    _transfer(supply_id)
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    late = _add_order(fbs, external_id="0192-late", deadline=cutoff)
    with get_connection() as conn:
        mp_service._attach_order(conn, supply_id, late, MP_SUPPLY_ORDER_PENDING)
        conn.commit()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "u")
    assert "Дозагрузка не разобрана" in str(getattr(exc.value, "detail", exc.value))

    with get_connection() as conn:
        assert mp_service.dock_supply_orders(conn, supply_id, [late], "u") == 1
        conn.commit()
    assert _detail(supply_id)["doc"]["orders_pending"] == 0


def test_cancel_releases_orders_back_to_the_pool(fbs):
    cutoff = _now() + timedelta(hours=5)
    order_id = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    supply_id = _route(fbs)
    with get_connection() as conn:
        mp_service.cancel_supply(conn, supply_id, "u")
        conn.commit()
    assert _free_pool_ids(fbs) == [order_id]
    assert _route(fbs) != supply_id
    assert len(_supplies(fbs)) == 2


# ── Доска, задачи и RBAC ──────────────────────────────────────────────────────

def test_board_groups_by_supply_and_counts_blockers(manager_client, fbs):
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff, qty=2)
    _add_order(fbs, external_id="0192-2", deadline=cutoff, linked=False)
    _route(fbs)
    r = manager_client.get(f"/marketplaces/supplies/board?account_id={fbs['account_id']}")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["orders_total"] == 2
    assert items[0]["orders_ready"] == 1
    assert items[0]["unlinked_positions"] == 1
    assert items[0]["overdue"] is False


def test_board_shows_the_free_pool_with_deadline_alarm(manager_client, fbs):
    """Пул — рабочая очередь доски: система ничего не собирает сама, но показывает, что горит."""
    keep = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=30))
    _add_order(fbs, external_id="0192-2", deadline=_now() + timedelta(hours=2), qty=3)
    _add_order(fbs, external_id="0192-3", deadline=_now() - timedelta(hours=1))
    _route(fbs, [keep])

    r = manager_client.get(f"/marketplaces/supplies/board?account_id={fbs['account_id']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counters"]["free_orders"] == 2
    pool = body["free_pool"][0]
    assert pool["account_id"] == fbs["account_id"]
    assert pool["orders_count"] == 2
    assert pool["total_qty"] == 4
    assert pool["overdue_count"] == 1
    assert pool["urgent_count"] == 1


def test_manual_supply_endpoint_takes_the_chosen_orders(manager_client, fbs):
    cutoff = _now() + timedelta(hours=5)
    mine = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    other = _add_order(fbs, external_id="0192-2", deadline=cutoff)

    r = manager_client.post("/marketplaces/supplies", json={
        "account_id": fbs["account_id"], "order_ids": [mine],
    })
    assert r.status_code == 200, r.text
    supply_id = r.json()["message"]
    selected = [o["order_id"] for o in _detail(supply_id)["orders"]
                if o["state"] == MP_SUPPLY_ORDER_SELECTED]
    assert selected == [mine]
    assert _free_pool_ids(fbs) == [other]

    # Второй поставке того же кабинета и той же волны ничего не мешает.
    r = manager_client.post("/marketplaces/supplies", json={
        "account_id": fbs["account_id"], "order_ids": [other],
    })
    assert r.status_code == 200, r.text
    assert r.json()["message"] != supply_id
    assert len(_supplies(fbs)) == 2


def test_manual_supply_rejects_orders_of_another_supply(manager_client, fbs):
    cutoff = _now() + timedelta(hours=5)
    taken = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs, [taken])
    r = manager_client.post("/marketplaces/supplies", json={
        "account_id": fbs["account_id"], "order_ids": [taken],
    })
    assert r.status_code == 400
    assert len(_supplies(fbs)) == 1


def test_manual_supply_is_forbidden_for_warehouse(warehouse_client, fbs):
    order_id = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    r = warehouse_client.post("/marketplaces/supplies", json={
        "account_id": fbs["account_id"], "order_ids": [order_id],
    })
    assert r.status_code == 403


def test_board_is_forbidden_for_warehouse(warehouse_client, fbs):
    r = warehouse_client.get("/marketplaces/supplies/board")
    assert r.status_code == 403


def test_orders_list_shows_supply_and_no_supply_filter(manager_client, fbs):
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs)
    r = manager_client.get(f"/marketplaces/orders?account_id={fbs['account_id']}")
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["supply_number"].startswith("FBS-")
    assert item["supply_status"] == MP_SUPPLY_STATUS_CHECKING
    r = manager_client.get(
        f"/marketplaces/orders?account_id={fbs['account_id']}&no_supply=true")
    assert r.json()["total"] == 0


def test_picking_supply_becomes_a_warehouse_task(warehouse_client, fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), qty=2)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    _transfer(supply_id)
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    r = warehouse_client.get("/tasks")
    assert r.status_code == 200, r.text
    mine = [t for t in r.json()["items"] if t["doc_id"] == supply_id]
    assert len(mine) == 1
    assert mine[0]["kind"] == "mp_supply_pick"
    assert mine[0]["doc_type"] == "mp_supply"


# ── Сборка на ТСД: очередь, скан, откат, списание ─────────────────────────────

def _to_picking(fbs, *, qty: int = 2, orders: int = 1) -> str:
    """Поставка, доведённая до фазы «Сборка», с заданным составом."""
    for i in range(orders):
        _add_order(fbs, external_id=f"0192-p{i}", deadline=_now() + timedelta(hours=5), qty=qty)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    _transfer(supply_id)
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    return supply_id


def _net(fbs, op: str, *, zone_id: str | None = None) -> int:
    """Нетто журнала по корзине (и месту, если задано) — «сколько физически лежит»."""
    zone_cond = "AND to_zone_id IS NOT DISTINCT FROM ?::text" if zone_id else ""
    from_cond = "AND from_zone_id IS NOT DISTINCT FROM ?::text" if zone_id else ""
    params_in = [op, fbs["product_id"], fbs["client_id"]] + ([zone_id] if zone_id else [])
    params_out = [op, fbs["product_id"], fbs["client_id"]] + ([zone_id] if zone_id else [])
    with get_connection() as conn:
        row = conn.execute(
            f"""SELECT COALESCE((
                    SELECT SUM(qty) FROM zone_relocations
                    WHERE to_op = ? AND product_id = ? AND client_id = ? {zone_cond}
                ), 0) - COALESCE((
                    SELECT SUM(qty) FROM zone_relocations
                    WHERE from_op = ? AND product_id = ? AND client_id = ? {from_cond}
                ), 0) AS net""",
            [*params_in, *params_out],
        ).fetchone()
    return int(row["net"] or 0)


def _pick_row(fbs, supply_id: str) -> dict:
    with get_connection() as conn:
        view = mp_service.supply_pick_view(conn, supply_id)
    return next(i for i in view["items"] if i["variant_id"] == fbs["variant_id"])


def test_claim_gives_the_supply_to_one_picker_only(fbs):
    supply_id = _to_picking(fbs)
    with get_connection() as conn:
        first = mp_service.claim_next_supply(conn, "picker-1")
        conn.commit()
    with get_connection() as conn:
        second = mp_service.claim_next_supply(conn, "picker-2")
        conn.commit()
    assert first == supply_id
    assert second is None


def test_claim_returns_own_unfinished_supply(fbs):
    supply_id = _to_picking(fbs)
    with get_connection() as conn:
        mp_service.claim_next_supply(conn, "picker-1")
        conn.commit()
    with get_connection() as conn:
        again = mp_service.claim_next_supply(conn, "picker-1")
        conn.commit()
    assert again == supply_id


def test_released_supply_returns_to_the_queue(fbs):
    supply_id = _to_picking(fbs)
    with get_connection() as conn:
        mp_service.claim_next_supply(conn, "picker-1")
        mp_service.release_supply(conn, supply_id, "picker-1", "picker")
        conn.commit()
    with get_connection() as conn:
        assert mp_service.claim_next_supply(conn, "picker-2") == supply_id
        conn.commit()


def test_pick_moves_stock_from_the_shelf_into_picked(fbs):
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        res = _pick(conn, fbs, supply_id, qty=2)
        conn.commit()
    assert res["picked_qty"] == 2 and res["remaining_qty"] == 0
    # Собранное ушло с полки: иначе соседняя волна увидела бы обещанный товар свободным.
    assert _net(fbs, MP_SUPPLY_PICK_OP, zone_id=fbs["cell_id"]) == 8
    assert _net(fbs, "picked") == 2
    row = _pick_row(fbs, supply_id)
    assert (row["picked_qty"], row["remaining_qty"]) == (2, 0)


def test_pick_over_the_need_is_rejected(fbs):
    supply_id = _to_picking(fbs, qty=1)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=1)
        conn.commit()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            _pick(conn, fbs, supply_id, qty=1)
    assert "уже собрано" in str(getattr(exc.value, "detail", exc.value))


def test_undo_returns_the_stock_to_its_cell(fbs):
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        res = _pick(conn, fbs, supply_id, qty=2)
        conn.commit()
    with get_connection() as conn:
        mp_service.undo_pick(conn, supply_id, res["pick_id"], "u", "admin")
        conn.commit()
    assert _net(fbs, MP_SUPPLY_PICK_OP, zone_id=fbs["cell_id"]) == 10
    assert _net(fbs, "picked") == 0
    assert _pick_row(fbs, supply_id)["picked_qty"] == 0


def test_undo_twice_is_rejected(fbs):
    supply_id = _to_picking(fbs, qty=1)
    with get_connection() as conn:
        res = _pick(conn, fbs, supply_id, qty=1)
        mp_service.undo_pick(conn, supply_id, res["pick_id"], "u", "admin")
        conn.commit()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.undo_pick(conn, supply_id, res["pick_id"], "u", "admin")
    assert "откачена" in str(getattr(exc.value, "detail", exc.value))


def test_partial_pick_does_not_close_the_picking(fbs):
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=1)
        conn.commit()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "u")
    assert "Собрано не всё" in str(getattr(exc.value, "detail", exc.value))


def test_dropping_a_stuck_order_unblocks_the_picking(fbs):
    """Тупик «товара физически нет» развязывает менеджер, а не недобор сборщика."""
    supply_id = _to_picking(fbs, qty=1, orders=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=1)
        conn.commit()
    stuck = next(
        o for o in _detail(supply_id)["orders"]
        if o["state"] == MP_SUPPLY_ORDER_SELECTED and o["external_id"] == "0192-p1"
    )
    with get_connection() as conn:
        mp_service.drop_supply_order(conn, supply_id, stuck["order_id"], "u")
        conn.commit()
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PACKING
        conn.commit()


def _pack_and_handover(conn, fbs, supply_id: str) -> None:
    """Упаковка и грузовое место без площадки: этикетка проставляется напрямую."""
    order_id = str(conn.execute(
        "SELECT order_id FROM mp_supply_orders WHERE supply_id = ?", (supply_id,),
    ).fetchone()["order_id"])
    mp_service.register_pack_scan(
        conn, supply_id, order_id, code=fbs["barcode"], qty=2, user_id="u", role="admin",
    )
    mp_service.pack_order(conn, supply_id, order_id, "u", "admin")
    conn.execute(
        "UPDATE mp_orders SET label_url = '/uploads/x.pdf', label_barcode = external_id WHERE id = ?",
        (order_id,),
    )
    mp_service.advance_supply(conn, supply_id, "u")
    unit = mp_service.create_cargo_unit(conn, supply_id, "box", "u")
    mp_service.add_order_to_cargo(conn, unit["id"], order_id, "u")
    mp_service.close_cargo_unit(conn, unit["id"], "u")


def test_handover_to_done_ships_the_picked_stock(fbs):
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=2)
        mp_service.advance_supply(conn, supply_id, "u")
        _pack_and_handover(conn, fbs, supply_id)
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    assert _net(fbs, "picked") == 0
    assert _net(fbs, "shipped") == 2
    assert _net(fbs, MP_SUPPLY_PICK_OP) == 8


def test_picked_stock_is_not_offered_to_the_next_wave(fbs):
    """Резерв и остаток не должны вычесть один и тот же товар дважды."""
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=2)
        conn.commit()
    row = _pick_row(fbs, supply_id)
    # Своя поставка видит остаток полки как есть: её собственное обязательство
    # уже закрыто физически, повторно вычитать его нельзя.
    assert row["available_qty"] == 8


def test_picker_pick_view_is_open_and_board_is_not(picker_client, fbs):
    supply_id = _to_picking(fbs)
    assert picker_client.get(f"/marketplaces/supplies/{supply_id}/pick-view").status_code == 200
    assert picker_client.get("/tasks").status_code == 200
    assert picker_client.get("/marketplaces/supplies/board").status_code == 403


def test_picking_supply_is_a_task_for_the_picker(picker_client, fbs):
    supply_id = _to_picking(fbs)
    tasks = picker_client.get("/tasks").json()["items"]
    mine = [t for t in tasks if t["doc_id"] == supply_id]
    assert mine and mine[0]["kind"] == "mp_supply_pick"


def _boxed(fbs, qty: int) -> str:
    """Переложить часть остатка ячейки в размещённый короб. → id короба."""
    box_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO containers (id, doc_number, status, client_id, zone_id, zone_name, "
            "created_at, placed_at, is_deleted) VALUES (?,?,?,?,?,?,NOW(),NOW(),0)",
            (box_id, f"BOX-{box_id[:6]}", CONTAINER_STATUS_PLACED, fbs["client_id"],
             fbs["cell_id"], fbs["cell_name"]),
        )
        insert_inventory_move(
            conn,
            product_id=fbs["product_id"], product_name="Худи оверсайз", product_sku=None,
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=fbs["client_id"], client_name="Test Client",
            from_op=MP_SUPPLY_PICK_OP, to_op=MP_SUPPLY_PICK_OP,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=fbs["cell_id"], from_zone_name=fbs["cell_name"],
            to_zone_id=fbs["cell_id"], to_zone_name=fbs["cell_name"],
            qty=qty, user_id="test-admin-id", to_container_id=box_id,
        )
        conn.commit()
    return box_id


def test_goods_in_a_box_are_picked_only_by_scanning_the_box(fbs):
    """Товар в коробе не берётся мимо короба: иначе короб и остатки разойдутся."""
    supply_id = _to_picking(fbs, qty=10)
    box_id = _boxed(fbs, 10)
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            _pick(conn, fbs, supply_id, qty=1)
    assert "коробе" in str(getattr(exc.value, "detail", exc.value))

    with get_connection() as conn:
        mp_service.register_pick(
            conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
            container_id=box_id, qty=10, user_id="u", role="admin",
        )
        conn.commit()
    with get_connection() as conn:
        left = conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN to_container_id = ? THEN qty ELSE 0 END), 0) "
            "     - COALESCE(SUM(CASE WHEN from_container_id = ? THEN qty ELSE 0 END), 0) AS net "
            "FROM zone_relocations", (box_id, box_id),
        ).fetchone()
    assert int(left["net"]) == 0
    assert _net(fbs, "picked") == 10

    with get_connection() as conn:
        conn.execute("DELETE FROM containers WHERE id = ?", (box_id,))
        conn.commit()


def test_picker_can_resolve_scanned_location_and_box(picker_client, fbs):
    """Скан места и короба — первые шаги цепочки сборки: без них ТСД встанет."""
    assert picker_client.get(f"/locations/by-code/wms:loc:{fbs['cell_id']}").status_code == 200
    assert picker_client.get("/containers/by-code/BOX-000001").status_code == 200
    # Ручные операции с остатками роли по-прежнему закрыты.
    assert picker_client.get("/balances/zones").status_code == 403
