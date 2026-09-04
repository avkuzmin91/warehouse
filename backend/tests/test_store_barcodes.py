"""Подтягивание ШК маркетплейса в вариант по магазину строки задачи упаковки.

Магазин клиента привязан к кабинету МП, карточка ищется в кабинете именно этого
магазина, записанный ШК помнит свой магазин, чужие коды не переписываются."""
from __future__ import annotations

import json
import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import MP_ACCOUNT_STATUS_ACTIVE, MP_WB
from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    manager_client,
)


@pytest.fixture
def task_fixture():
    """Задача упаковки: строка с магазином, у магазина — кабинет WB с карточкой."""
    suffix = uuid.uuid4().hex[:8]
    client_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    store_id = str(uuid.uuid4())
    type_id = str(uuid.uuid4())
    size_id = str(uuid.uuid4())
    product_id = str(uuid.uuid4())
    variant_id = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    line_id = str(uuid.uuid4())
    mp_product_id = str(uuid.uuid4())
    sku = f"ART-{suffix}"
    barcode = f"20{uuid.uuid4().hex[:11]}"

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"SB Client {suffix}"),
        )
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, api_key, status, created_at) "
            "VALUES (?,?,?,?,?,?,NOW())",
            (account_id, client_id, MP_WB, f"WB {suffix}", "secret-key-1234", MP_ACCOUNT_STATUS_ACTIVE),
        )
        conn.execute(
            "INSERT INTO client_stores (id, client_id, name, is_active, mp_account_id, is_deleted, created_at) "
            "VALUES (?,?,?,1,?,0,NOW())",
            (store_id, client_id, f"WB Store {suffix}", account_id),
        )
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"SBType-{suffix}"),
        )
        conn.execute(
            "INSERT INTO sizes (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (size_id, f"S-{suffix}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (product_id, f"SB Product {suffix}", type_id, client_id, sku),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, ?, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (variant_id, product_id, client_id, size_id, sku),
        )
        conn.execute(
            "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
            "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,?,NULL,NOW())",
            (mp_product_id, account_id, "1234567", sku, "Карточка WB",
             json.dumps([barcode]), f"S-{suffix}"),
        )
        conn.execute(
            "INSERT INTO shipment_docs (id, doc_number, cargo_type, client_id, client_name, status, "
            "is_deleted, created_at, created_by) VALUES (?,?,'good',?,?, 'draft', 0, NOW(), 'test')",
            (doc_id, f"SHP-SB-{suffix}", client_id, f"SB Client {suffix}"),
        )
        conn.execute(
            "INSERT INTO shipment_lines (id, doc_id, product_id, product_name, product_sku, "
            "color_id, color_name, size_id, size_name, qty, shipped_qty, store_id, store_name, "
            "is_deleted, created_at) VALUES (?,?,?,?,?,NULL,NULL,?,?,5,0,?,?,0,NOW())",
            (line_id, doc_id, product_id, f"SB Product {suffix}", sku,
             size_id, f"S-{suffix}", store_id, f"WB Store {suffix}"),
        )
        conn.commit()

    yield {
        "client_id": client_id, "account_id": account_id, "store_id": store_id,
        "product_id": product_id, "variant_id": variant_id, "doc_id": doc_id,
        "line_id": line_id, "mp_product_id": mp_product_id, "barcode": barcode,
        "sku": sku, "size_id": size_id, "type_id": type_id,
    }

    with get_connection() as conn:
        conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_docs WHERE id = ?", (doc_id,))
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (product_id,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (product_id,))
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        conn.execute("DELETE FROM sizes WHERE id = ?", (size_id,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.execute("DELETE FROM mp_products WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM client_stores WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM mp_accounts WHERE id = ?", (account_id,))
        conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        conn.commit()


def test_pull_by_offer_and_size(manager_client, task_fixture):
    doc_id, line_id = task_fixture["doc_id"], task_fixture["line_id"]
    r = manager_client.get(f"/shipments/{doc_id}/store-barcodes")
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["line_id"] == line_id
    assert item["status"] == "ready"
    assert item["marketplace"] == MP_WB
    assert item["new_barcodes"] == [task_fixture["barcode"]]

    r = manager_client.post(f"/shipments/{doc_id}/store-barcodes", json={"line_ids": [line_id]})
    assert r.status_code == 200, r.text

    with get_connection() as conn:
        row = conn.execute(
            "SELECT variant_id, store_id, source FROM product_barcodes "
            "WHERE barcode = ? AND COALESCE(is_deleted, 0) = 0",
            (task_fixture["barcode"],),
        ).fetchone()
    assert row is not None
    assert str(row["variant_id"]) == task_fixture["variant_id"]
    assert str(row["store_id"]) == task_fixture["store_id"]
    assert str(row["source"]) == "Wildberries"

    # ШК магазина виден в строке задачи, повтор ничего не добавляет.
    detail = manager_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["store_barcodes"] == [task_fixture["barcode"]]

    r = manager_client.get(f"/shipments/{doc_id}/store-barcodes")
    assert r.json()["items"][0]["status"] == "exists"


def test_pull_for_unsaved_form(manager_client, task_fixture):
    """Форма создания: подбор идёт по выбранным значениям, документа ещё нет."""
    payload = {
        "client_id": task_fixture["client_id"],
        "lines": [{
            "key": "row-1",
            "product_id": task_fixture["product_id"],
            "color_id": None,
            "size_id": task_fixture["size_id"],
            "store_id": task_fixture["store_id"],
        }],
    }
    r = manager_client.post("/shipments/store-barcodes/preview", json=payload)
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["line_id"] == "row-1"
    assert item["status"] == "ready"
    assert item["new_barcodes"] == [task_fixture["barcode"]]

    r = manager_client.post("/shipments/store-barcodes/apply", json={**payload, "keys": ["row-1"]})
    assert r.status_code == 200, r.text

    with get_connection() as conn:
        row = conn.execute(
            "SELECT variant_id, store_id FROM product_barcodes "
            "WHERE barcode = ? AND COALESCE(is_deleted, 0) = 0",
            (task_fixture["barcode"],),
        ).fetchone()
    assert row is not None
    assert str(row["variant_id"]) == task_fixture["variant_id"]
    assert str(row["store_id"]) == task_fixture["store_id"]

    # Повтор по тем же значениям уже ничего не пишет.
    assert manager_client.post(
        "/shipments/store-barcodes/preview", json=payload
    ).json()["items"][0]["status"] == "exists"


def test_draft_pull_rejects_foreign_store(manager_client, task_fixture):
    """Магазин чужого клиента с формы не принимается."""
    r = manager_client.post("/shipments/store-barcodes/preview", json={
        "client_id": task_fixture["client_id"],
        "lines": [{
            "key": "row-1",
            "product_id": task_fixture["product_id"],
            "color_id": None,
            "size_id": task_fixture["size_id"],
            "store_id": str(uuid.uuid4()),
        }],
    })
    assert r.status_code == 400


def test_pull_conflict_not_overwritten(manager_client, task_fixture):
    """ШК карточки уже стоит у другого варианта — не переписываем, показываем конфликт."""
    other_variant = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (other_variant, task_fixture["product_id"], task_fixture["client_id"],
             f"{task_fixture['sku']}-X"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), task_fixture["product_id"], other_variant, task_fixture["barcode"]),
        )
        conn.commit()

    doc_id, line_id = task_fixture["doc_id"], task_fixture["line_id"]
    item = manager_client.get(f"/shipments/{doc_id}/store-barcodes").json()["items"][0]
    assert item["status"] == "conflict"
    assert item["conflicts"] and item["conflicts"][0]["code"] == task_fixture["barcode"]

    r = manager_client.post(f"/shipments/{doc_id}/store-barcodes", json={"line_ids": [line_id]})
    assert r.status_code == 400

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT variant_id FROM product_barcodes WHERE barcode = ? AND COALESCE(is_deleted, 0) = 0",
            (task_fixture["barcode"],),
        ).fetchall()
    assert [str(r["variant_id"]) for r in rows] == [other_variant]


def test_store_without_account(manager_client, task_fixture):
    """Магазин без кабинета — искать негде, состояние честно показывается."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE client_stores SET mp_account_id = NULL WHERE id = ?",
            (task_fixture["store_id"],),
        )
        conn.commit()
    item = manager_client.get(f"/shipments/{task_fixture['doc_id']}/store-barcodes").json()["items"][0]
    assert item["status"] == "no_account"


def test_other_account_cards_not_used(manager_client, task_fixture):
    """Карточка с тем же артикулом в другом кабинете клиента не подходит: у каждого
    магазина свой кабинет и свои ШК."""
    other_account = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, api_key, status, created_at) "
            "VALUES (?,?,?,?,?,?,NOW())",
            (other_account, task_fixture["client_id"], MP_WB, "WB второй кабинет",
             "secret-key-5678", MP_ACCOUNT_STATUS_ACTIVE),
        )
        conn.execute(
            "UPDATE client_stores SET mp_account_id = ? WHERE id = ?",
            (other_account, task_fixture["store_id"]),
        )
        conn.commit()
    try:
        item = manager_client.get(
            f"/shipments/{task_fixture['doc_id']}/store-barcodes"
        ).json()["items"][0]
        assert item["status"] == "not_found"
    finally:
        with get_connection() as conn:
            conn.execute(
                "UPDATE client_stores SET mp_account_id = ? WHERE id = ?",
                (task_fixture["account_id"], task_fixture["store_id"]),
            )
            conn.execute("DELETE FROM mp_accounts WHERE id = ?", (other_account,))
            conn.commit()
