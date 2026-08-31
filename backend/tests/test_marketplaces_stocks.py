"""FBS-маркетплейсы: выгрузка остатков в МП — расчёт доступного, дельта-выгрузка,
изоляция сбоя кабинета, сверка и RBAC."""
from __future__ import annotations

import json
import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import (
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_PREPARING,
    INV_OP_PACKING,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_LINK_SOURCE_MANUAL,
    MP_ORDER_STATUS_DONE,
    MP_ORDER_STATUS_NEW,
    MP_STOCK_SKIP_NO_BARCODE,
    MP_STOCK_SKIP_UNLINKED,
    MP_WB,
)
from dbconn import get_connection
from modules.marketplaces import clients as mp_clients
from modules.marketplaces import service as mp_service
from modules.marketplaces.clients import MpApiError
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    manager_client,
    seed_storage_good,
    warehouse_client,
)

WAREHOUSE_ID = "777001"


def _insert_wb_account(client_id: str, *, warehouse_id: str | None = WAREHOUSE_ID,
                       enabled: bool = True) -> str:
    account_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, api_key, status, "
            "stock_warehouse_id, stock_sync_enabled, created_at, created_by) "
            "VALUES (?,?,?,?,?,?,?,?,NOW(),?)",
            (account_id, client_id, MP_WB, f"WB-{account_id[:6]}", "secret-key-abcd1234",
             MP_ACCOUNT_STATUS_ACTIVE, warehouse_id, 1 if enabled else 0, "test-admin-id"),
        )
        if warehouse_id:
            conn.execute(
                "INSERT INTO mp_warehouses (id, account_id, external_id, name, updated_at) "
                "VALUES (?,?,?,?,NOW())",
                (str(uuid.uuid4()), account_id, warehouse_id, "Склад продавца"),
            )
        conn.commit()
    return account_id


def _insert_card(account_id: str, *, external_id: str, barcodes: list[str],
                 size: str | None = None, offer_id: str | None = None) -> str:
    mp_product_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,?,NULL,NOW())",
            (mp_product_id, account_id, external_id, offer_id or f"ART-{external_id}",
             f"Карточка {external_id}", json.dumps(barcodes), size),
        )
        conn.commit()
    return mp_product_id


def _link(mp_product_id: str, product_id: str, variant_id: str | None) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_product_links (id, mp_product_id, product_id, variant_id, "
            "link_source, created_at, created_by) VALUES (?,?,?,?,?,NOW(),?)",
            (str(uuid.uuid4()), mp_product_id, product_id, variant_id,
             MP_LINK_SOURCE_MANUAL, "test-admin-id"),
        )
        conn.commit()


def _seed_variant(client_id: str) -> dict:
    """Товар + вариант без цвета/размера (позиция остатка = product_id)."""
    type_id, pid, vid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"StockType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"StockProduct-{pid[:8]}", type_id, client_id, f"ST-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, client_id, f"ST-V-{vid[:8]}"),
        )
        conn.commit()
    return {"type_id": type_id, "product_id": pid, "variant_id": vid}


def _seed_dispatch(client_id: str, product_id: str, *, qty: int, shipped: int = 0,
                   status: str = DISPATCH_STATUS_PREPARING) -> str:
    doc_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO dispatch_docs (id, doc_number, cargo_type, client_id, status, created_at) "
            "VALUES (?,?,?,?,?,NOW())",
            (doc_id, f"DSP-{doc_id[:8]}", "good", client_id, status),
        )
        conn.execute(
            "INSERT INTO dispatch_lines (id, doc_id, product_id, product_name, product_sku, "
            "qty, shipped_qty, created_at) VALUES (?,?,?,?,?,?,?,NOW())",
            (str(uuid.uuid4()), doc_id, product_id, "StockProduct", "ST", qty, shipped),
        )
        conn.commit()
    return doc_id


def _seed_mp_order(account_id: str, mp_product_id: str, *, qty: int,
                   status: str = MP_ORDER_STATUS_NEW) -> str:
    order_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_orders (id, account_id, external_id, status, external_status, "
            "total_qty, first_seen_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())",
            (order_id, account_id, f"O-{order_id[:8]}", status, "new/waiting", qty),
        )
        conn.execute(
            "INSERT INTO mp_order_lines (id, order_id, mp_product_id, offer_id, title, qty) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), order_id, mp_product_id, "ART", "Товар", qty),
        )
        conn.commit()
    return order_id


@pytest.fixture
def wb_stock_env():
    """Кабинет WB со связанной карточкой и остатком 10 шт на хранении."""
    client_id = make_client_id()
    account_id = _insert_wb_account(client_id)
    variant = _seed_variant(client_id)
    barcode = f"46{uuid.uuid4().hex[:10]}"
    mp_product_id = _insert_card(account_id, external_id="100500", barcodes=[barcode])
    _link(mp_product_id, variant["product_id"], variant["variant_id"])
    seed_storage_good(client_id, product_id=variant["product_id"], qty=10)
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (account_id,)).fetchone()
    yield {
        "client_id": client_id, "account_id": account_id, "account": account,
        "mp_product_id": mp_product_id, "barcode": barcode, **variant,
    }
    with get_connection() as conn:
        conn.execute("DELETE FROM mp_order_lines WHERE order_id IN "
                     "(SELECT id FROM mp_orders WHERE account_id = ?)", (account_id,))
        conn.execute("DELETE FROM mp_orders WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_stock_state WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_sync_log WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_product_links WHERE mp_product_id IN "
                     "(SELECT id FROM mp_products WHERE account_id = ?)", (account_id,))
        conn.execute("DELETE FROM mp_products WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_warehouses WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_accounts WHERE id = ?", (account_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM dispatch_lines WHERE doc_id IN "
                     "(SELECT id FROM dispatch_docs WHERE client_id = ?)", (client_id,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (variant["product_id"],))
        conn.execute("DELETE FROM products WHERE id = ?", (variant["product_id"],))
        conn.execute("DELETE FROM product_types WHERE id = ?", (variant["type_id"],))
        conn.commit()
    cleanup_client(client_id)


def _rows(env) -> list[dict]:
    with get_connection() as conn:
        return mp_service.compute_stock_rows(conn, env["account"])


# ── Расчёт доступного ─────────────────────────────────────────────────────────

def test_target_is_storage_good(wb_stock_env):
    rows = _rows(wb_stock_env)
    assert [r["qty"] for r in rows] == [10]
    assert mp_service.stock_targets(rows) == {wb_stock_env["barcode"]: 10}


def test_dispatch_and_fbs_demand_subtracted(wb_stock_env):
    _seed_dispatch(wb_stock_env["client_id"], wb_stock_env["product_id"], qty=3)
    _seed_mp_order(wb_stock_env["account_id"], wb_stock_env["mp_product_id"], qty=2)
    assert _rows(wb_stock_env)[0]["qty"] == 5


def test_draft_dispatch_and_terminal_order_do_not_reserve(wb_stock_env):
    _seed_dispatch(wb_stock_env["client_id"], wb_stock_env["product_id"], qty=4,
                   status=DISPATCH_STATUS_DRAFT)
    _seed_mp_order(wb_stock_env["account_id"], wb_stock_env["mp_product_id"], qty=4,
                   status=MP_ORDER_STATUS_DONE)
    assert _rows(wb_stock_env)[0]["qty"] == 10


def test_moved_out_goods_not_counted_twice(wb_stock_env):
    """Товар под отгрузку уже вынесен в упаковку: он вычтен из хранения журналом,
    вычитать спрос второй раз нельзя."""
    from modules.balances.service import insert_inventory_move

    _seed_dispatch(wb_stock_env["client_id"], wb_stock_env["product_id"], qty=4)
    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=wb_stock_env["product_id"], product_name="StockProduct", product_sku="ST",
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=wb_stock_env["client_id"], client_name="Test Client",
            from_op=INV_OP_STORAGE, to_op=INV_OP_PACKING,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=None, from_zone_name=None, to_zone_id=None, to_zone_name=None,
            qty=4, user_id="test-admin-id",
        )
        conn.commit()
    # 10 − 4 (уехало в упаковку) = 6 на хранении, спрос уже покрыт физически.
    assert _rows(wb_stock_env)[0]["qty"] == 6


def test_demand_over_stock_clamped_to_zero(wb_stock_env):
    _seed_dispatch(wb_stock_env["client_id"], wb_stock_env["product_id"], qty=99)
    assert _rows(wb_stock_env)[0]["qty"] == 0


def test_shipped_part_of_dispatch_not_reserved(wb_stock_env):
    _seed_dispatch(wb_stock_env["client_id"], wb_stock_env["product_id"], qty=5, shipped=5)
    assert _rows(wb_stock_env)[0]["qty"] == 10


def test_unlinked_and_barcodeless_cards_skipped(wb_stock_env):
    _insert_card(wb_stock_env["account_id"], external_id="200600", barcodes=["4650000000009"])
    empty_id = _insert_card(wb_stock_env["account_id"], external_id="300700", barcodes=[])
    _link(empty_id, wb_stock_env["product_id"], wb_stock_env["variant_id"])
    reasons = {r["external_id"]: r["skip_reason"] for r in _rows(wb_stock_env)}
    assert reasons["200600"] == MP_STOCK_SKIP_UNLINKED
    assert reasons["300700"] == MP_STOCK_SKIP_NO_BARCODE
    assert reasons["100500"] is None


def test_shared_sku_takes_minimum(wb_stock_env):
    """Один ШК на двух карточках: в МП уходит меньшее из посчитанных значений."""
    second = _insert_card(wb_stock_env["account_id"], external_id="100501",
                          barcodes=[wb_stock_env["barcode"]])
    other = _seed_variant(wb_stock_env["client_id"])
    _link(second, other["product_id"], other["variant_id"])
    seed_storage_good(wb_stock_env["client_id"], product_id=other["product_id"], qty=2)
    targets = mp_service.stock_targets(_rows(wb_stock_env))
    assert targets == {wb_stock_env["barcode"]: 2}
    with get_connection() as conn:
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (other["product_id"],))
        conn.execute("DELETE FROM products WHERE id = ?", (other["product_id"],))
        conn.execute("DELETE FROM product_types WHERE id = ?", (other["type_id"],))
        conn.commit()


# ── Выгрузка ──────────────────────────────────────────────────────────────────

def _capture_push(monkeypatch) -> list[tuple[str, list]]:
    calls: list[tuple[str, list]] = []

    def fake_push(creds, warehouse_id, items):
        calls.append((warehouse_id, list(items)))

    monkeypatch.setattr(mp_clients, "wb_push_stocks", fake_push)
    return calls


def test_push_sends_only_changes(monkeypatch, wb_stock_env):
    calls = _capture_push(monkeypatch)
    with get_connection() as conn:
        stats = mp_service.push_account_stocks(conn, wb_stock_env["account"])
        conn.commit()
    assert stats["pushed"] == 1 and stats["changed"] == 1
    assert calls == [(WAREHOUSE_ID, [(wb_stock_env["barcode"], 10)])]

    # Ничего не изменилось — второй прогон не ходит в МП.
    calls.clear()
    with get_connection() as conn:
        stats = mp_service.push_account_stocks(conn, wb_stock_env["account"])
        conn.commit()
    assert stats["changed"] == 0 and calls == []

    # Остаток изменился — уходит новое значение.
    _seed_mp_order(wb_stock_env["account_id"], wb_stock_env["mp_product_id"], qty=3)
    with get_connection() as conn:
        mp_service.push_account_stocks(conn, wb_stock_env["account"])
        conn.commit()
    assert calls == [(WAREHOUSE_ID, [(wb_stock_env["barcode"], 7)])]

    # full=True переотправляет снапшот целиком.
    calls.clear()
    with get_connection() as conn:
        stats = mp_service.push_account_stocks(conn, wb_stock_env["account"], full=True)
        conn.commit()
    assert stats["changed"] == 1 and calls == [(WAREHOUSE_ID, [(wb_stock_env["barcode"], 7)])]


def test_push_without_warehouse_rejected(monkeypatch, wb_stock_env):
    _capture_push(monkeypatch)
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET stock_warehouse_id = NULL WHERE id = ?",
                     (wb_stock_env["account_id"],))
        conn.commit()
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?",
                               (wb_stock_env["account_id"],)).fetchone()
        with pytest.raises(mp_service.MpStockNotConfigured):
            mp_service.push_account_stocks(conn, account)


def test_run_stock_push_isolates_failure(monkeypatch, wb_stock_env):
    def boom(creds, warehouse_id, items):
        raise MpApiError("Маркетплейс недоступен (HTTP 500)", retriable=True)

    monkeypatch.setattr(mp_clients, "wb_push_stocks", boom)
    with get_connection() as conn:
        totals = mp_service.run_stock_push(conn)
    assert totals["failed"] >= 1
    with get_connection() as conn:
        row = conn.execute("SELECT last_stock_push_error FROM mp_accounts WHERE id = ?",
                           (wb_stock_env["account_id"],)).fetchone()
        log_row = conn.execute(
            "SELECT ok, error FROM mp_sync_log WHERE account_id = ? AND kind = 'stocks' "
            "ORDER BY created_at DESC LIMIT 1", (wb_stock_env["account_id"],)
        ).fetchone()
    assert "HTTP 500" in str(row["last_stock_push_error"])
    assert int(log_row["ok"]) == 0

    # Снапшот не обновлён: после восстановления связи остаток уйдёт заново.
    calls = _capture_push(monkeypatch)
    with get_connection() as conn:
        mp_service.run_stock_push(conn)
    assert calls == [(WAREHOUSE_ID, [(wb_stock_env["barcode"], 10)])]


def test_disabled_account_not_pushed(monkeypatch, wb_stock_env):
    calls = _capture_push(monkeypatch)
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET stock_sync_enabled = 0 WHERE id = ?",
                     (wb_stock_env["account_id"],))
        conn.commit()
        totals = mp_service.run_stock_push(conn)
    assert totals["accounts"] == 0 and calls == []


# ── Склады, сверка, RBAC ──────────────────────────────────────────────────────

def test_sync_warehouses_and_settings(monkeypatch, admin_client, wb_stock_env):
    monkeypatch.setattr(
        mp_clients, "wb_fetch_warehouses",
        lambda creds: [{"id": 999002, "name": "Новый склад", "officeId": 42, "cargoType": 1}],
    )
    account_id = wb_stock_env["account_id"]
    r = admin_client.post(f"/marketplaces/accounts/{account_id}/sync-warehouses")
    assert r.status_code == 200, r.text
    r = admin_client.get(f"/marketplaces/accounts/{account_id}/warehouses")
    assert {i["external_id"] for i in r.json()["items"]} == {WAREHOUSE_ID, "999002"}

    r = admin_client.patch(f"/marketplaces/accounts/{account_id}",
                           json={"stock_warehouse_id": "999002"})
    assert r.status_code == 200, r.text
    r = admin_client.patch(f"/marketplaces/accounts/{account_id}",
                           json={"stock_warehouse_id": "нет-такого"})
    assert r.status_code == 400


def test_enable_stock_sync_requires_warehouse(admin_client, wb_stock_env):
    account_id = wb_stock_env["account_id"]
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET stock_warehouse_id = NULL WHERE id = ?", (account_id,))
        conn.commit()
    r = admin_client.patch(f"/marketplaces/accounts/{account_id}", json={"stock_sync_enabled": True})
    assert r.status_code == 400
    assert "склад" in r.json()["detail"].lower()


def test_stock_report_shows_diff(monkeypatch, manager_client, wb_stock_env):
    monkeypatch.setattr(
        mp_clients, "wb_fetch_stocks",
        lambda creds, warehouse_id, skus: {wb_stock_env["barcode"]: 4},
    )
    r = manager_client.get(f"/marketplaces/accounts/{wb_stock_env['account_id']}/stocks")
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["qty"] == 10 and item["mp_qty"] == 4 and item["diff"] == -6

    r = manager_client.get(
        f"/marketplaces/accounts/{wb_stock_env['account_id']}/stocks?with_marketplace=false"
    )
    assert r.json()["items"][0]["mp_qty"] is None


def test_stock_report_survives_marketplace_error(monkeypatch, manager_client, wb_stock_env):
    def boom(creds, warehouse_id, skus):
        raise MpApiError("Маркетплейс недоступен (HTTP 502)", retriable=True)

    monkeypatch.setattr(mp_clients, "wb_fetch_stocks", boom)
    r = manager_client.get(f"/marketplaces/accounts/{wb_stock_env['account_id']}/stocks")
    assert r.status_code == 200
    assert "HTTP 502" in r.json()["marketplace_error"]


def test_stock_endpoints_forbidden_for_warehouse(warehouse_client, wb_stock_env):
    account_id = wb_stock_env["account_id"]
    assert warehouse_client.get(f"/marketplaces/accounts/{account_id}/stocks").status_code == 403
    assert warehouse_client.post(f"/marketplaces/accounts/{account_id}/push-stocks").status_code == 403
    assert warehouse_client.get(f"/marketplaces/accounts/{account_id}/warehouses").status_code == 403
