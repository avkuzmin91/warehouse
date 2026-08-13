"""Справочник скана: живые документы по отсканированному варианту (/scan/context)."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from config import RECEIPT_STATUS_DONE, RECEIPT_STATUS_PLANNED
from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    make_client_id,
    cleanup_client,
    warehouse_client,
)


@pytest.fixture
def variant_with_receipt():
    """Товар с вариантом + поступление (planned) с одной строкой этого варианта."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    line_id = str(uuid.uuid4())
    doc_number = f"WH-T{uuid.uuid4().hex[:6]}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"ScanType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"ScanProduct-{pid[:8]}", type_id, cid, f"SC-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"SC-V-{vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO receipt_docs "
            "(id, doc_number, client_id, supplier_name, arrival_date, comment, status, "
            " zone_id, zone_name, ttn, logistics_cost, created_at, created_by) "
            "VALUES (?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,NOW(),?)",
            (doc_id, doc_number, cid, RECEIPT_STATUS_PLANNED, "test-admin-id"),
        )
        conn.execute(
            "INSERT INTO receipt_lines "
            "(id, doc_id, product_id, product_name, product_sku, color_id, color_name, "
            " size_id, size_name, storage_zone_id, storage_zone_name, planned_qty, created_at, created_by) "
            "VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,NOW(),?)",
            (line_id, doc_id, pid, f"ScanProduct-{pid[:8]}", f"SC-{pid[:8]}", 10, "test-admin-id"),
        )
        conn.commit()
    yield {"client_id": cid, "product_id": pid, "variant_id": vid, "doc_id": doc_id, "doc_number": doc_number}
    with get_connection() as conn:
        conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM receipt_docs WHERE id = ?", (doc_id,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def test_active_receipt_visible(warehouse_client, variant_with_receipt):
    vid = variant_with_receipt["variant_id"]
    r = warehouse_client.get(f"/scan/context?variant_id={vid}")
    assert r.status_code == 200, r.text
    docs = r.json()["documents"]
    receipts = [d for d in docs if d["doc_type"] == "receipt"]
    assert len(receipts) == 1
    assert receipts[0]["doc_number"] == variant_with_receipt["doc_number"]
    assert receipts[0]["status"] == RECEIPT_STATUS_PLANNED
    assert receipts[0]["planned_qty"] == 10
    assert receipts[0]["done_qty"] == 0


def test_terminal_receipt_hidden(warehouse_client, variant_with_receipt):
    vid = variant_with_receipt["variant_id"]
    with get_connection() as conn:
        conn.execute(
            "UPDATE receipt_docs SET status = ? WHERE id = ?",
            (RECEIPT_STATUS_DONE, variant_with_receipt["doc_id"]),
        )
        conn.commit()
    r = warehouse_client.get(f"/scan/context?variant_id={vid}")
    assert r.status_code == 200, r.text
    docs = r.json()["documents"]
    assert [d for d in docs if d["doc_type"] == "receipt"] == []


def test_requires_exactly_one_param(warehouse_client):
    assert warehouse_client.get("/scan/context").status_code == 400
    assert warehouse_client.get("/scan/context?variant_id=a&location_id=b").status_code == 400


def test_unknown_variant_empty(warehouse_client):
    r = warehouse_client.get(f"/scan/context?variant_id={uuid.uuid4()}")
    assert r.status_code == 200, r.text
    assert r.json()["documents"] == []
