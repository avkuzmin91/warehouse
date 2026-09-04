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

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import (
    INV_OP_STORAGE,
    INV_Q_GOOD,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_LINK_SOURCE_MANUAL,
    MP_ORDER_STATUS_CANCELLED,
    MP_ORDER_STATUS_NEW,
    MP_OZON,
    MP_SUPPLY_ORDER_PENDING,
    MP_SUPPLY_ORDER_SELECTED,
    MP_SUPPLY_STATUS_CHECKING,
    MP_SUPPLY_STATUS_DRAFT,
    MP_SUPPLY_STATUS_HANDOVER,
    MP_SUPPLY_STATUS_PICKING,
)
from dbconn import get_connection
from modules.balances.service import insert_inventory_move
from modules.marketplaces import service as mp_service
from tests.conftest import (  # noqa: F401
    cleanup_client,
    make_client_id,
    manager_client,
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
            from_op="intake", to_op=INV_OP_STORAGE,
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


def _route(fbs) -> dict:
    with get_connection() as conn:
        account = conn.execute(
            "SELECT * FROM mp_accounts WHERE id = ?", (fbs["account_id"],)).fetchone()
        stats = mp_service.route_orders_into_supplies(conn, account)
        conn.commit()
    return stats


def _supplies(fbs) -> list:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM mp_supplies WHERE account_id = ? ORDER BY doc_number",
            (fbs["account_id"],),
        ).fetchall()


def _pick(conn, fbs, supply_id: str, *, qty: int) -> dict:
    return mp_service.register_pick(
        conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
        container_id=None, qty=qty, user_id="u", role="admin",
    )


def _detail(supply_id: str) -> dict:
    with get_connection() as conn:
        return mp_service.supply_detail(conn, supply_id)


# ── Волны и маршрутизация ─────────────────────────────────────────────────────

def test_wave_key_floors_to_hour():
    assert mp_service.supply_wave_key("2026-09-03T13:47:12+00:00").startswith("2026-09-03T13:00")
    assert mp_service.supply_wave_key(None) is None


def test_orders_of_one_wave_land_in_one_supply(fbs):
    base = (_now() + timedelta(hours=6)).replace(minute=5, second=0, microsecond=0)
    _add_order(fbs, external_id="0192-1", deadline=base)
    _add_order(fbs, external_id="0192-2", deadline=base.replace(minute=45))
    stats = _route(fbs)
    assert stats["supplies_created"] == 1
    assert stats["routed"] == 2
    supplies = _supplies(fbs)
    assert len(supplies) == 1
    assert str(supplies[0]["status"]) == MP_SUPPLY_STATUS_DRAFT
    # Приём закрывается за 30 минут до отсечки — считает система, не человек.
    assert supplies[0]["intake_closes_at"] < supplies[0]["cutoff_at"]


def test_different_waves_get_different_supplies(fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=4))
    _add_order(fbs, external_id="0192-2", deadline=_now() + timedelta(hours=9))
    _route(fbs)
    assert len(_supplies(fbs)) == 2


def test_routing_is_idempotent(fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    _route(fbs)
    stats = _route(fbs)
    assert stats == {"routed": 0, "docked": 0, "supplies_created": 0}
    assert len(_supplies(fbs)) == 1


def test_unselected_order_waits_for_next_supply(fbs):
    """Снятый галочкой заказ не возвращается синком в ту же поставку."""
    cutoff = _now() + timedelta(hours=5)
    keep = _add_order(fbs, external_id="0192-1", deadline=cutoff)
    drop = _add_order(fbs, external_id="0192-2", deadline=cutoff)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.set_supply_orders(conn, supply_id, [keep], "test-admin-id")
        conn.commit()
    _route(fbs)
    detail = _detail(supply_id)
    selected = [o for o in detail["orders"] if o["state"] == MP_SUPPLY_ORDER_SELECTED]
    assert [o["order_id"] for o in selected] == [keep]
    assert detail["doc"]["orders_total"] == 1
    assert drop not in [o["order_id"] for o in selected]


def test_order_arriving_during_picking_goes_to_dock(fbs):
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "test-admin-id")  # draft → checking
        mp_service.advance_supply(conn, supply_id, "test-admin-id")  # checking → picking
        conn.commit()
    late = _add_order(fbs, external_id="0192-late", deadline=cutoff)
    stats = _route(fbs)
    assert stats["docked"] == 1
    assert stats["supplies_created"] == 0
    detail = _detail(supply_id)
    assert detail["doc"]["orders_pending"] == 1
    with get_connection() as conn:
        docked = mp_service.dock_supply_orders(conn, supply_id, [late], "test-admin-id")
        conn.commit()
    assert docked == 1
    assert _detail(supply_id)["doc"]["orders_total"] == 2


def test_closed_intake_frees_the_wave(fbs):
    """После закрытия приёма новый заказ той же волны заводит следующую поставку."""
    cutoff = _now() + timedelta(minutes=10)  # приём (−30 мин) уже в прошлом
    _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs)
    with get_connection() as conn:
        assert mp_service.close_due_intakes(conn) == 1
        conn.commit()
    _add_order(fbs, external_id="0192-2", deadline=cutoff)
    stats = _route(fbs)
    assert stats["supplies_created"] == 1
    assert len(_supplies(fbs)) == 2


def test_cancelled_order_leaves_supply_while_drafting(fbs):
    order_id = _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5))
    _route(fbs)
    with get_connection() as conn:
        conn.execute("UPDATE mp_orders SET status = ? WHERE id = ?",
                     (MP_ORDER_STATUS_CANCELLED, order_id))
        released = mp_service.release_cancelled_orders(conn)
        conn.commit()
    assert released == 1
    assert _detail(str(_supplies(fbs)[0]["id"]))["doc"]["orders_total"] == 0


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
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff, qty=8)
    _add_order(fbs, external_id="0192-2", deadline=cutoff + timedelta(minutes=1), qty=8)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    detail = _detail(supply_id)
    assert detail["doc"]["shortage_positions"] == 1
    # Жадное распределение по дедлайну: остатка хватает ровно на один заказ.
    assert detail["doc"]["orders_ready"] == 1
    assert any(b["kind"] == "shortage" for b in detail["blockers"])
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "test-admin-id")  # draft → checking
        conn.commit()
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

def test_phase_chain_and_intake_close_on_handover(fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), qty=2)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_CHECKING
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PICKING
        # Сборка закрывается только полностью собранным составом — иначе
        # «Собрано не всё» не пустит поставку в передачу.
        _pick(conn, fbs, supply_id, qty=2)
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_HANDOVER
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
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    _add_order(fbs, external_id="0192-late", deadline=cutoff)
    _route(fbs)
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.advance_supply(conn, supply_id, "u")
    assert "Дозагрузка не разобрана" in str(getattr(exc.value, "detail", exc.value))


def test_cancel_releases_orders_to_the_next_supply(fbs):
    cutoff = _now() + timedelta(hours=5)
    _add_order(fbs, external_id="0192-1", deadline=cutoff)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.cancel_supply(conn, supply_id, "u")
        conn.commit()
    stats = _route(fbs)
    assert stats["supplies_created"] == 1
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
    assert item["supply_status"] == MP_SUPPLY_STATUS_DRAFT
    r = manager_client.get(
        f"/marketplaces/orders?account_id={fbs['account_id']}&no_supply=true")
    assert r.json()["total"] == 0


def test_picking_supply_becomes_a_warehouse_task(warehouse_client, fbs):
    _add_order(fbs, external_id="0192-1", deadline=_now() + timedelta(hours=5), qty=2)
    _route(fbs)
    supply_id = str(_supplies(fbs)[0]["id"])
    with get_connection() as conn:
        mp_service.advance_supply(conn, supply_id, "u")
        mp_service.advance_supply(conn, supply_id, "u")
        conn.commit()
    r = warehouse_client.get("/tasks")
    assert r.status_code == 200, r.text
    mine = [t for t in r.json()["items"] if t["doc_id"] == supply_id]
    assert len(mine) == 1
    assert mine[0]["kind"] == "mp_supply_pick"
    assert mine[0]["doc_type"] == "mp_supply"
