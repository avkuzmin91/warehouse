"""FBS-маркетплейсы (Фаза 1): RBAC, маскирование ключей, нормализация статусов,
идемпотентность синка, авто-связка по ШК, изоляция сбоя кабинета."""
from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import (
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_LINK_SOURCE_BARCODE,
    MP_ORDER_STATUS_CANCELLED,
    MP_ORDER_STATUS_DONE,
    MP_ORDER_STATUS_IN_PROGRESS,
    MP_ORDER_STATUS_NEW,
    MP_ORDER_STATUS_SHIPPED,
    MP_OZON,
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
    warehouse_client,
)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _insert_account(client_id: str, marketplace: str = MP_OZON, name: str | None = None) -> str:
    account_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, ozon_client_id, "
            "api_key, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,NOW(),?)",
            (account_id, client_id, marketplace, name or f"Test-{marketplace}-{account_id[:6]}",
             ("12345" if marketplace == MP_OZON else None),
             "secret-api-key-abcd1234", MP_ACCOUNT_STATUS_ACTIVE, "test-admin-id"),
        )
        conn.commit()
    return account_id


def _load_account(account_id: str):
    with get_connection() as conn:
        return conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (account_id,)).fetchone()


def _cleanup_account(account_id: str, client_id: str) -> None:
    with get_connection() as conn:
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
        conn.execute("DELETE FROM mp_sync_log WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM mp_accounts WHERE id = ?", (account_id,))
        conn.commit()
    cleanup_client(client_id)


@pytest.fixture
def ozon_account():
    cid = make_client_id()
    account_id = _insert_account(cid, MP_OZON)
    yield {"id": account_id, "client_id": cid}
    _cleanup_account(account_id, cid)


@pytest.fixture
def wb_account():
    cid = make_client_id()
    account_id = _insert_account(cid, MP_WB)
    yield {"id": account_id, "client_id": cid}
    _cleanup_account(account_id, cid)


def _ozon_posting(posting_number: str, status: str = "awaiting_packaging", *,
                  shipment_date: str | None = None, qty: int = 2) -> dict:
    return {
        "posting_number": posting_number,
        "status": status,
        "in_process_at": "2026-07-01T10:00:00Z",
        "shipment_date": shipment_date or "2026-07-08T10:00:00Z",
        "products": [
            {"offer_id": "ART-1", "name": "Футболка синяя", "quantity": qty, "price": "179.00", "sku": 111},
        ],
    }


def _wb_order(order_id: int, *, barcode: str = "4650000000001") -> dict:
    return {
        "id": order_id,
        "rid": f"rid-{order_id}",
        "createdAt": "2026-07-05T08:00:00Z",
        "article": "wb-art-1",
        "nmId": 555000111,
        "chrtId": 777,
        "skus": [barcode],
        "price": 50000,
    }


# ── Нормализация статусов и дедлайны (unit) ───────────────────────────────────

def test_normalize_status_ozon():
    assert mp_service.normalize_status(MP_OZON, "awaiting_packaging") == MP_ORDER_STATUS_NEW
    assert mp_service.normalize_status(MP_OZON, "awaiting_deliver") == MP_ORDER_STATUS_IN_PROGRESS
    assert mp_service.normalize_status(MP_OZON, "delivering") == MP_ORDER_STATUS_SHIPPED
    assert mp_service.normalize_status(MP_OZON, "delivered") == MP_ORDER_STATUS_DONE
    assert mp_service.normalize_status(MP_OZON, "cancelled") == MP_ORDER_STATUS_CANCELLED
    # Неизвестный статус не роняет синк: заказ считается живым.
    assert mp_service.normalize_status(MP_OZON, "totally_new_status") == MP_ORDER_STATUS_IN_PROGRESS


def test_normalize_status_wb():
    ws = mp_service.wb_external_status
    assert mp_service.normalize_status(MP_WB, ws("new", "waiting")) == MP_ORDER_STATUS_NEW
    assert mp_service.normalize_status(MP_WB, ws("confirm", "waiting")) == MP_ORDER_STATUS_IN_PROGRESS
    assert mp_service.normalize_status(MP_WB, ws("complete", "sorted")) == MP_ORDER_STATUS_SHIPPED
    assert mp_service.normalize_status(MP_WB, ws("complete", "sold")) == MP_ORDER_STATUS_DONE
    assert mp_service.normalize_status(MP_WB, ws("cancel", "canceled")) == MP_ORDER_STATUS_CANCELLED
    assert mp_service.normalize_status(MP_WB, ws("confirm", "canceled_by_client")) == MP_ORDER_STATUS_CANCELLED


def test_compute_deadline_ozon_api():
    deadline, source = mp_service.compute_deadline(MP_OZON, {"shipment_date": "2026-07-08T10:00:00Z"})
    assert source == "api"
    assert deadline is not None and deadline.startswith("2026-07-08T10:00:00")


def test_compute_deadline_wb_estimated(monkeypatch):
    monkeypatch.setenv("MP_WB_SLA_HOURS", "10")
    deadline, source = mp_service.compute_deadline(MP_WB, {"createdAt": "2026-07-05T08:00:00Z"})
    assert source == "estimated"
    assert deadline is not None and deadline.startswith("2026-07-05T18:00:00")


def test_parse_wb_order_single_line():
    parsed = mp_service.parse_wb_order(_wb_order(101))
    assert parsed["total_qty"] == 1
    assert len(parsed["lines"]) == 1
    assert parsed["lines"][0]["price_kopecks"] == 50000
    assert parsed["status"] == MP_ORDER_STATUS_NEW


# ── Синк: идемпотентность и переходы ─────────────────────────────────────────

def test_sync_ozon_idempotent(monkeypatch, ozon_account):
    posting = _ozon_posting("111-1")
    monkeypatch.setattr(mp_clients, "ozon_fetch_open_postings", lambda creds: [posting])
    monkeypatch.setattr(mp_clients, "ozon_fetch_postings", lambda creds, ids: [])
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (ozon_account["id"],)).fetchone()
        stats1 = mp_service.sync_account_orders(conn, account)
        stats2 = mp_service.sync_account_orders(conn, account)
        conn.commit()
        orders = conn.execute(
            "SELECT * FROM mp_orders WHERE account_id = ?", (ozon_account["id"],)
        ).fetchall()
        lines = conn.execute(
            "SELECT * FROM mp_order_lines WHERE order_id = ?", (str(orders[0]["id"]),)
        ).fetchall()
    assert stats1 == {"fetched": 1, "created": 1, "updated": 0}
    assert stats2 == {"fetched": 1, "created": 0, "updated": 0}
    assert len(orders) == 1
    assert len(lines) == 1
    assert int(orders[0]["total_qty"]) == 2
    assert str(orders[0]["status"]) == MP_ORDER_STATUS_NEW


def test_sync_ozon_status_transition_and_terminal(monkeypatch, ozon_account):
    posting = _ozon_posting("222-1")
    monkeypatch.setattr(mp_clients, "ozon_fetch_open_postings", lambda creds: [posting])
    monkeypatch.setattr(mp_clients, "ozon_fetch_postings", lambda creds, ids: [])
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (ozon_account["id"],)).fetchone()
        mp_service.sync_account_orders(conn, account)
        conn.commit()

        # Заказ ушёл из «необработанных» — статус добирается точечным опросом.
        monkeypatch.setattr(mp_clients, "ozon_fetch_open_postings", lambda creds: [])
        requested: list[list[str]] = []

        def fake_fetch(creds, ids):
            requested.append(list(ids))
            return [_ozon_posting("222-1", status="delivered")]

        monkeypatch.setattr(mp_clients, "ozon_fetch_postings", fake_fetch)
        mp_service.sync_account_orders(conn, account)
        conn.commit()
        row = conn.execute(
            "SELECT status FROM mp_orders WHERE account_id = ? AND external_id = ?",
            (ozon_account["id"], "222-1"),
        ).fetchone()
        assert str(row["status"]) == MP_ORDER_STATUS_DONE
        assert requested == [["222-1"]]

        # Терминальный заказ больше не опрашивается.
        requested.clear()
        mp_service.sync_account_orders(conn, account)
        conn.commit()
        assert requested == []


def test_sync_wb_new_and_cancel(monkeypatch, wb_account):
    monkeypatch.setattr(mp_clients, "wb_fetch_new_orders", lambda creds: [_wb_order(313)])
    monkeypatch.setattr(mp_clients, "wb_fetch_order_statuses", lambda creds, ids: [
        {"id": 313, "supplierStatus": "confirm", "wbStatus": "waiting"},
    ])
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (wb_account["id"],)).fetchone()
        mp_service.sync_account_orders(conn, account)
        conn.commit()
        row = conn.execute(
            "SELECT status FROM mp_orders WHERE account_id = ? AND external_id = '313'",
            (wb_account["id"],),
        ).fetchone()
        assert str(row["status"]) == MP_ORDER_STATUS_IN_PROGRESS

        monkeypatch.setattr(mp_clients, "wb_fetch_new_orders", lambda creds: [])
        monkeypatch.setattr(mp_clients, "wb_fetch_order_statuses", lambda creds, ids: [
            {"id": 313, "supplierStatus": "cancel", "wbStatus": "canceled"},
        ])
        mp_service.sync_account_orders(conn, account)
        conn.commit()
        row = conn.execute(
            "SELECT status FROM mp_orders WHERE account_id = ? AND external_id = '313'",
            (wb_account["id"],),
        ).fetchone()
        assert str(row["status"]) == MP_ORDER_STATUS_CANCELLED


def test_run_marketplace_sync_isolates_failure(monkeypatch, ozon_account, wb_account):
    def boom(creds):
        raise MpApiError("Неверный API-ключ или нет доступа (HTTP 401)")

    monkeypatch.setattr(mp_clients, "ozon_fetch_open_postings", boom)
    monkeypatch.setattr(mp_clients, "wb_fetch_new_orders", lambda creds: [_wb_order(414)])
    monkeypatch.setattr(mp_clients, "wb_fetch_order_statuses", lambda creds, ids: [])
    with get_connection() as conn:
        totals = mp_service.run_marketplace_sync(conn)
        ozon_row = conn.execute(
            "SELECT last_sync_error FROM mp_accounts WHERE id = ?", (ozon_account["id"],)
        ).fetchone()
        wb_row = conn.execute(
            "SELECT last_sync_error, last_sync_at FROM mp_accounts WHERE id = ?", (wb_account["id"],)
        ).fetchone()
        wb_orders = conn.execute(
            "SELECT COUNT(*) AS n FROM mp_orders WHERE account_id = ?", (wb_account["id"],)
        ).fetchone()
        bad_log = conn.execute(
            "SELECT ok FROM mp_sync_log WHERE account_id = ? ORDER BY created_at DESC",
            (ozon_account["id"],),
        ).fetchone()
    assert totals["failed"] >= 1
    assert "API-ключ" in str(ozon_row["last_sync_error"])
    assert wb_row["last_sync_error"] is None
    assert wb_row["last_sync_at"] is not None
    assert int(wb_orders["n"]) == 1
    assert int(bad_log["ok"]) == 0


# ── RBAC и маскирование ───────────────────────────────────────────────────────

def test_accounts_manager_can_manage(monkeypatch, manager_client):
    # Менеджер управляет подключениями наравне с админом (создание/правка/синк).
    cid = make_client_id()
    monkeypatch.setattr(mp_clients, "ozon_check", lambda creds: None)
    monkeypatch.setattr(mp_clients, "ozon_fetch_products", lambda creds: [])
    r = manager_client.post("/marketplaces/accounts", json={
        "client_id": cid, "marketplace": "ozon", "name": "Менеджерский кабинет",
        "ozon_client_id": "555", "api_key": "mgr-key-9999",
    })
    assert r.status_code == 200, r.text
    account_id = r.json()["message"]
    assert manager_client.get("/marketplaces/accounts").status_code == 200
    assert manager_client.patch(
        f"/marketplaces/accounts/{account_id}", json={"status": "paused"}
    ).status_code == 200
    assert manager_client.delete(f"/marketplaces/accounts/{account_id}").status_code == 200
    _cleanup_account(account_id, cid)


def test_accounts_forbidden_for_warehouse(warehouse_client):
    # Кладовщик не видит и не трогает подключения (несут API-ключи продавцов).
    assert warehouse_client.get("/marketplaces/accounts").status_code == 403
    assert warehouse_client.post("/marketplaces/accounts", json={
        "client_id": "x", "marketplace": "ozon", "name": "n", "api_key": "k",
    }).status_code == 403
    assert warehouse_client.delete("/marketplaces/accounts/some-id").status_code == 403
    assert warehouse_client.post("/marketplaces/accounts/some-id/sync-orders").status_code == 403


def test_orders_forbidden_for_warehouse(warehouse_client):
    assert warehouse_client.get("/marketplaces/orders").status_code == 403
    assert warehouse_client.get("/marketplaces/products?account_id=x").status_code == 403


def test_accounts_masking(admin_client, ozon_account):
    r = admin_client.get("/marketplaces/accounts")
    assert r.status_code == 200, r.text
    payload = json.dumps(r.json(), ensure_ascii=False)
    assert "secret-api-key-abcd1234" not in payload
    item = next(i for i in r.json()["items"] if i["id"] == ozon_account["id"])
    assert item["api_key_masked"] == "****1234"
    assert "api_key" not in item


def test_create_account_check_fail(monkeypatch, admin_client):
    cid = make_client_id()

    def boom(creds):
        raise MpApiError("Неверный API-ключ или нет доступа (HTTP 401)")

    monkeypatch.setattr(mp_clients, "ozon_check", boom)
    r = admin_client.post("/marketplaces/accounts", json={
        "client_id": cid, "marketplace": "ozon", "name": "Ozon тест",
        "ozon_client_id": "777", "api_key": "bad-key",
    })
    assert r.status_code == 400
    assert "Не удалось подключиться" in r.json()["detail"]
    cleanup_client(cid)


def test_create_account_ok(monkeypatch, admin_client):
    cid = make_client_id()
    monkeypatch.setattr(mp_clients, "ozon_check", lambda creds: None)
    monkeypatch.setattr(mp_clients, "ozon_fetch_products", lambda creds: [])
    r = admin_client.post("/marketplaces/accounts", json={
        "client_id": cid, "marketplace": "ozon", "name": "Ozon тест",
        "ozon_client_id": "777", "api_key": "good-key-0001",
    })
    assert r.status_code == 200, r.text
    account_id = r.json()["message"]
    row = _load_account(account_id)
    assert row is not None and str(row["status"]) == MP_ACCOUNT_STATUS_ACTIVE
    _cleanup_account(account_id, cid)


# ── Списки заказов ────────────────────────────────────────────────────────────

def _seed_order(account_id: str, external_id: str, *, status_raw: str = "awaiting_packaging",
                deadline: datetime | None = None) -> None:
    posting = _ozon_posting(external_id, status=status_raw,
                            shipment_date=_iso(deadline) if deadline else None)
    with get_connection() as conn:
        mp_service.upsert_order(conn, account_id, MP_OZON, mp_service.parse_ozon_posting(posting))
        conn.commit()


def test_orders_list_and_summary(manager_client, ozon_account):
    account_id = ozon_account["id"]
    now = datetime.now(UTC)
    _seed_order(account_id, "AAA-1", deadline=now + timedelta(days=2))
    _seed_order(account_id, "AAA-2", status_raw="delivered")
    _seed_order(account_id, "AAA-3", deadline=now - timedelta(hours=3))

    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}")
    assert r.status_code == 200, r.text
    ids = [i["external_id"] for i in r.json()["items"]]
    assert "AAA-1" in ids and "AAA-3" in ids
    assert "AAA-2" not in ids  # терминальные скрыты по умолчанию

    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&status=done")
    assert [i["external_id"] for i in r.json()["items"]] == ["AAA-2"]

    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&overdue=true")
    assert [i["external_id"] for i in r.json()["items"]] == ["AAA-3"]

    assert manager_client.get("/marketplaces/orders?status=bogus").status_code == 400

    r = manager_client.get(f"/marketplaces/orders/summary?account_id={account_id}")
    assert r.status_code == 200
    assert r.json()["by_status"].get("new") == 2
    assert r.json()["overdue_count"] == 1

    # Поиск по номеру и по составу.
    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&search=aaa-3")
    assert [i["external_id"] for i in r.json()["items"]] == ["AAA-3"]
    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&search=футболка")
    assert len(r.json()["items"]) == 2


def test_order_detail_404(manager_client):
    assert manager_client.get(f"/marketplaces/orders/{uuid.uuid4()}").status_code == 404


# ── Авто-связка и ручная связка ───────────────────────────────────────────────

@pytest.fixture
def catalog_fixture(ozon_account):
    """Вариант с ШК + карточка МП с тем же ШК (не связаны)."""
    cid = ozon_account["client_id"]
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    barcode = f"46{uuid.uuid4().hex[:10]}"
    mp_product_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"MpType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"MpProduct-{pid[:8]}", type_id, cid, f"MP-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"MP-V-{vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid, barcode),
        )
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,NULL,NULL,NOW())",
            (mp_product_id, ozon_account["id"], "900001", "ART-900001", "Карточка Ozon",
             json.dumps([barcode])),
        )
        conn.commit()
    yield {
        **ozon_account, "product_id": pid, "variant_id": vid,
        "barcode": barcode, "mp_product_id": mp_product_id,
    }
    with get_connection() as conn:
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()


def test_auto_link_by_barcode(admin_client, catalog_fixture):
    r = admin_client.post(f"/marketplaces/accounts/{catalog_fixture['id']}/auto-link")
    assert r.status_code == 200, r.text
    assert r.json()["stats"]["auto_linked"] == 1
    with get_connection() as conn:
        link = conn.execute(
            "SELECT * FROM mp_product_links WHERE mp_product_id = ? AND COALESCE(is_deleted,0) = 0",
            (catalog_fixture["mp_product_id"],),
        ).fetchone()
    assert link is not None
    assert str(link["product_id"]) == catalog_fixture["product_id"]
    assert str(link["variant_id"]) == catalog_fixture["variant_id"]
    assert str(link["link_source"]) == MP_LINK_SOURCE_BARCODE

    # Повторный прогон ничего не задваивает.
    r = admin_client.post(f"/marketplaces/accounts/{catalog_fixture['id']}/auto-link")
    assert r.json()["stats"]["auto_linked"] == 0


def test_auto_link_conflict_skipped(admin_client, catalog_fixture):
    """Карточка, чьи ШК ведут к двум разным вариантам, — конфликт: не связываем."""
    cid = catalog_fixture["client_id"]
    pid = catalog_fixture["product_id"]
    vid2 = str(uuid.uuid4())
    barcode2 = f"46{uuid.uuid4().hex[:10]}"
    conflict_mp_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid2, pid, cid, f"MP-V2-{vid2[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid2, barcode2),
        )
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,NULL,NULL,NOW())",
            (conflict_mp_id, catalog_fixture["id"], "900002", "ART-900002", "Конфликтная карточка",
             json.dumps([catalog_fixture["barcode"], barcode2])),
        )
        conn.commit()
    r = admin_client.get(
        f"/marketplaces/products?account_id={catalog_fixture['id']}&linked=unlinked"
    )
    assert r.status_code == 200, r.text
    conflict_item = next(i for i in r.json()["items"] if i["id"] == conflict_mp_id)
    assert conflict_item["barcode_conflict"] is True
    assert conflict_item["suggestion"] is None

    r = admin_client.post(f"/marketplaces/accounts/{catalog_fixture['id']}/auto-link")
    with get_connection() as conn:
        link = conn.execute(
            "SELECT 1 FROM mp_product_links WHERE mp_product_id = ? AND COALESCE(is_deleted,0) = 0",
            (conflict_mp_id,),
        ).fetchone()
        conn.commit()
    assert link is None


def test_manual_link_and_unlink(manager_client, catalog_fixture):
    mp_id = catalog_fixture["mp_product_id"]
    r = manager_client.post(f"/marketplaces/products/{mp_id}/link", json={
        "product_id": catalog_fixture["product_id"],
        "variant_id": catalog_fixture["variant_id"],
    })
    assert r.status_code == 200, r.text

    r = manager_client.get(f"/marketplaces/products?account_id={catalog_fixture['id']}&linked=linked")
    items = {i["id"]: i for i in r.json()["items"]}
    assert mp_id in items
    assert items[mp_id]["product_sku"] is not None

    r = manager_client.delete(f"/marketplaces/products/{mp_id}/link")
    assert r.status_code == 200
    assert manager_client.delete(f"/marketplaces/products/{mp_id}/link").status_code == 404


def test_link_foreign_client_product_rejected(manager_client, catalog_fixture):
    other_cid = make_client_id()
    type_id = str(uuid.uuid4())
    foreign_pid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"FType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (foreign_pid, "Чужой товар", type_id, other_cid, f"FR-{foreign_pid[:8]}"),
        )
        conn.commit()
    r = manager_client.post(
        f"/marketplaces/products/{catalog_fixture['mp_product_id']}/link",
        json={"product_id": foreign_pid},
    )
    assert r.status_code == 400
    assert "другому клиенту" in r.json()["detail"]
    with get_connection() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (foreign_pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(other_cid)


def test_wb_sandbox_routes_to_sandbox_hosts(monkeypatch):
    """Токен «Тестового контура» WB отвечает только на sandbox-хостах, боевые
    отдают 401 — признак подключения обязан доехать до выбора базового URL."""
    urls: list[str] = []

    def fake_request(method, url, *, headers, json_body=None):
        urls.append(url)
        return {}

    monkeypatch.setattr(mp_clients, "_request", fake_request)
    sandbox = {"api_key": "token", "is_sandbox": True}
    mp_clients.wb_check(sandbox)
    mp_clients.wb_fetch_new_orders(sandbox)
    mp_clients.wb_fetch_cards(sandbox)
    mp_clients.wb_check({"api_key": "token", "is_sandbox": False})

    assert urls == [
        f"{mp_clients.WB_MARKETPLACE_SANDBOX_BASE}/ping",
        f"{mp_clients.WB_MARKETPLACE_SANDBOX_BASE}/api/v3/orders/new",
        f"{mp_clients.WB_CONTENT_SANDBOX_BASE}/content/v2/get/cards/list",
        f"{mp_clients.WB_MARKETPLACE_BASE}/ping",
    ]


def test_account_sandbox_flag_reaches_client(monkeypatch, wb_account):
    seen: list[dict] = []
    monkeypatch.setattr(mp_clients, "wb_check", lambda creds: seen.append(creds))
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET is_sandbox = 1 WHERE id = ?", (wb_account["id"],))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM mp_accounts WHERE id = ?", (wb_account["id"],)
        ).fetchone()
    mp_service.check_account(row)
    assert seen and seen[0]["is_sandbox"] is True


def test_sandbox_flag_rejected_for_ozon(manager_client):
    cid = make_client_id()
    r = manager_client.post("/marketplaces/accounts", json={
        "client_id": cid,
        "marketplace": MP_OZON,
        "name": "Тестовый Ozon",
        "ozon_client_id": "123",
        "api_key": "key",
        "is_sandbox": True,
    })
    assert r.status_code == 400
    assert "Wildberries" in r.json()["detail"]
    cleanup_client(cid)
