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
    assert stats1 == {"fetched": 1, "created": 1, "updated": 0, "relinked_lines": 0}
    assert stats2 == {"fetched": 1, "created": 0, "updated": 0, "relinked_lines": 0}
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


def test_sync_catalog_relinks_orders_synced_before_cards(monkeypatch, wb_account):
    """Заказ приехал раньше каталога: карточка догоняется обновлением карточек.

    Иначе строка навсегда осталась бы без карточки, а значит и без связки с товаром.
    """
    barcode = "4650000000001"
    monkeypatch.setattr(mp_clients, "wb_fetch_new_orders", lambda creds: [_wb_order(515, barcode=barcode)])
    monkeypatch.setattr(mp_clients, "wb_fetch_order_statuses", lambda creds, ids: [])
    monkeypatch.setattr(mp_clients, "wb_fetch_cards", lambda creds: [{
        "nmID": 555000111,
        "vendorCode": "wb-art-1",
        "title": "Кроссовки WB",
        "sizes": [
            {"techSize": "41", "skus": ["4650000000009"]},
            {"techSize": "42", "skus": [barcode]},
        ],
    }])
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (wb_account["id"],)).fetchone()
        mp_service.sync_account_orders(conn, account)
        conn.commit()
        line = conn.execute(
            "SELECT l.id, l.mp_product_id FROM mp_order_lines l "
            "JOIN mp_orders o ON o.id = l.order_id WHERE o.account_id = ?",
            (wb_account["id"],),
        ).fetchone()
        assert line["mp_product_id"] is None

        stats = mp_service.sync_account_catalog(conn, account)
        conn.commit()
        row = conn.execute(
            "SELECT mp.external_size FROM mp_order_lines l "
            "JOIN mp_products mp ON mp.id = l.mp_product_id WHERE l.id = ?",
            (str(line["id"]),),
        ).fetchone()
    assert stats["relinked_lines"] == 1
    assert str(row["external_size"]) == "42"


def test_sync_orders_relinks_lines_without_card(monkeypatch, wb_account):
    """Карточка появилась после заказа — связку догоняет обычный синк заказов,
    без ручного «Обновить карточки»."""
    barcode = "4650000000002"
    monkeypatch.setattr(mp_clients, "wb_fetch_new_orders", lambda creds: [_wb_order(516, barcode=barcode)])
    monkeypatch.setattr(mp_clients, "wb_fetch_order_statuses", lambda creds, ids: [])
    with get_connection() as conn:
        account = conn.execute("SELECT * FROM mp_accounts WHERE id = ?", (wb_account["id"],)).fetchone()
        stats = mp_service.sync_account_orders(conn, account)
        conn.commit()
        assert stats["relinked_lines"] == 0

        mp_product_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,?,NULL,NOW())",
            (mp_product_id, wb_account["id"], "555000111", "wb-art-1", "Кроссовки WB",
             json.dumps([barcode]), "42"),
        )
        conn.commit()

        stats = mp_service.sync_account_orders(conn, account)
        conn.commit()
        line = conn.execute(
            "SELECT l.mp_product_id FROM mp_order_lines l JOIN mp_orders o ON o.id = l.order_id "
            "WHERE o.account_id = ?",
            (wb_account["id"],),
        ).fetchone()
    assert stats["relinked_lines"] == 1
    assert str(line["mp_product_id"]) == mp_product_id


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


def test_orders_monitor_fields(manager_client, ozon_account):
    """Монитор отвечает на «смогу ли собрать» и «где заказ у нас», а не только
    пересказывает статус площадки."""
    account_id = ozon_account["id"]
    _seed_order(account_id, "MON-1", deadline=datetime.now(UTC) + timedelta(days=1))

    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&search=mon-1")
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    # Товар из заказа не связан с номенклатурой WMS → блокер и артикул для баннера.
    assert item["stage"] == "pool"
    assert item["blockers"] == ["unlinked"]
    assert item["unlinked_offers"]
    assert item["summary"]  # состав словами, а не «1 поз. / 1 шт.»

    r = manager_client.get(f"/marketplaces/orders/summary?account_id={account_id}")
    summary = r.json()
    assert summary["unlinked_orders_count"] >= 1
    assert summary["unlinked_offers"]
    assert summary["no_supply_count"] >= 1
    assert summary["error_count"] == 0

    # Ошибка площадки — отдельный срез, а не строка, потерянная в общем списке.
    with get_connection() as conn:
        conn.execute(
            "UPDATE mp_orders SET mp_error = ? WHERE account_id = ? AND external_id = ?",
            ("Ozon: отправление не собрано", account_id, "MON-1"),
        )
        conn.commit()
    r = manager_client.get(f"/marketplaces/orders?account_id={account_id}&has_error=true")
    assert [i["external_id"] for i in r.json()["items"]] == ["MON-1"]
    assert manager_client.get(
        f"/marketplaces/orders/summary?account_id={account_id}",
    ).json()["error_count"] == 1


def test_order_stage_reads_our_process_not_marketplace():
    """`mp_shipped_at` в стадию не входит: у WB отметка встаёт при добавлении
    задания в поставку продавца, задолго до передачи груза."""
    base = {"status": MP_ORDER_STATUS_NEW, "supply_id": None, "supply_status": None,
            "packed_at": None, "mp_shipped_at": None}
    assert mp_service.order_stage(base) == "pool"
    assert mp_service.order_stage({**base, "supply_id": "s1", "supply_status": "picking"}) == "in_supply"
    assert mp_service.order_stage({
        **base, "supply_id": "s1", "supply_status": "packing",
        "packed_at": "2026-09-05T10:00:00+00:00", "mp_shipped_at": "2026-09-05T09:00:00+00:00",
    }) == "packed"
    assert mp_service.order_stage({**base, "supply_id": "s1", "supply_status": "done"}) == "handed"
    assert mp_service.order_stage({**base, "status": MP_ORDER_STATUS_CANCELLED}) == "cancelled"


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


def test_product_mp_articles_follow_link(manager_client, admin_client, catalog_fixture):
    """Артикул продавца в карточке товара — производное от связки: появляется
    вместе со связкой и исчезает вместе с ней, без зачистки хранимых полей."""
    mp_id = catalog_fixture["mp_product_id"]
    pid = catalog_fixture["product_id"]

    assert admin_client.get(f"/marketplaces/wms-products/{pid}/articles").json()["items"] == []

    r = manager_client.post(f"/marketplaces/products/{mp_id}/link", json={
        "product_id": pid, "variant_id": catalog_fixture["variant_id"],
    })
    assert r.status_code == 200, r.text

    items = admin_client.get(f"/marketplaces/wms-products/{pid}/articles").json()["items"]
    assert [i["offer_id"] for i in items] == ["ART-900001"]
    assert items[0]["variant_id"] == catalog_fixture["variant_id"]
    assert items[0]["marketplace"] == MP_OZON

    # Товар ищется по артикулу продавца, а не только по своему SKU.
    found = admin_client.get("/products?search=ART-900001").json()["items"]
    assert pid in [i["id"] for i in found]

    assert manager_client.delete(f"/marketplaces/products/{mp_id}/link").status_code == 200
    assert admin_client.get(f"/marketplaces/wms-products/{pid}/articles").json()["items"] == []
    found = admin_client.get("/products?search=ART-900001").json()["items"]
    assert pid not in [i["id"] for i in found]


def test_manual_link_pulls_card_barcodes(manager_client, catalog_fixture):
    """Связка — утверждение «карточка = вариант», поэтому ШК карточки уезжают
    в вариант; занятый другим вариантом код пропускается."""
    pid = catalog_fixture["product_id"]
    vid = catalog_fixture["variant_id"]
    fresh = f"47{uuid.uuid4().hex[:10]}"
    foreign = f"48{uuid.uuid4().hex[:10]}"
    other_vid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (other_vid, pid, catalog_fixture["client_id"], f"MP-V2-{other_vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, other_vid, foreign),
        )
        conn.execute(
            "UPDATE mp_products SET barcodes = ? WHERE id = ?",
            (json.dumps([catalog_fixture["barcode"], fresh, foreign]),
             catalog_fixture["mp_product_id"]),
        )
        conn.commit()

    r = manager_client.post(
        f"/marketplaces/products/{catalog_fixture['mp_product_id']}/link",
        json={"product_id": pid, "variant_id": vid},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"message": "ok", "barcodes_written": 1, "barcodes_skipped": 1}

    with get_connection() as conn:
        codes = {
            str(row["barcode"]) for row in conn.execute(
                "SELECT barcode FROM product_barcodes WHERE variant_id = ? "
                "AND COALESCE(is_deleted, 0) = 0",
                (vid,),
            ).fetchall()
        }
        owner = conn.execute(
            "SELECT variant_id FROM product_barcodes WHERE barcode = ? "
            "AND COALESCE(is_deleted, 0) = 0",
            (foreign,),
        ).fetchone()
    assert codes == {catalog_fixture["barcode"], fresh}
    assert str(owner["variant_id"]) == other_vid


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
