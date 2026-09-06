"""Выбор кода этикетки на строке задачи упаковки: у варианта их бывает несколько."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def shipment_with_two_codes(admin_client):
    """Задача упаковки на товар с двумя ШК на одном варианте (массив skus кабинета)."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    codes = [f"466{uuid.uuid4().hex[:10]}", f"467{uuid.uuid4().hex[:10]}"]
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"LblType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"LblProduct-{pid[:8]}", type_id, cid, f"LBL-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"LBL-V-{vid[:8]}"),
        )
        for code in codes:
            conn.execute(
                "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, created_at, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, NOW(), 0)",
                (str(uuid.uuid4()), pid, vid, code, "Wildberries"),
            )
        conn.commit()
    doc_id = admin_client.post("/shipments", json={
        "cargo_type": "good",
        "client_id": cid,
        "client_name": "Test Client",
        "lines": [{
            "product_id": pid,
            "product_name": f"LblProduct-{pid[:8]}",
            "product_sku": f"LBL-{pid[:8]}",
            "color_id": None, "color_name": None,
            "size_id": None, "size_name": None,
            "qty": 7,
        }],
    }).json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    yield {"client_id": cid, "doc_id": doc_id, "line_id": line_id,
           "product_id": pid, "variant_id": vid, "codes": codes}
    with get_connection() as conn:
        conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_docs WHERE id = ?", (doc_id,))
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _set_label(client, doc, line, barcode):
    return client.patch(f"/shipments/{doc}/lines/{line}/label", json={"barcode": barcode})


def test_line_starts_without_a_chosen_code(admin_client, shipment_with_two_codes):
    line = admin_client.get(f"/shipments/{shipment_with_two_codes['doc_id']}").json()["lines"][0]
    assert line["label_barcode"] is None


def test_choice_is_kept_and_journalled(admin_client, shipment_with_two_codes):
    doc_id, line_id = shipment_with_two_codes["doc_id"], shipment_with_two_codes["line_id"]
    second = shipment_with_two_codes["codes"][1]
    assert _set_label(admin_client, doc_id, line_id, second).status_code == 200

    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["label_barcode"] == second
    assert any(second in (op["comment"] or "") for op in detail["ops"]), "выбор должен быть в журнале"


def test_choice_can_be_reset_to_the_rule(admin_client, shipment_with_two_codes):
    doc_id, line_id = shipment_with_two_codes["doc_id"], shipment_with_two_codes["line_id"]
    _set_label(admin_client, doc_id, line_id, shipment_with_two_codes["codes"][0])
    assert _set_label(admin_client, doc_id, line_id, None).status_code == 200
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["label_barcode"] is None


def test_code_outside_the_card_is_rejected(admin_client, shipment_with_two_codes):
    r = _set_label(admin_client, shipment_with_two_codes["doc_id"],
                   shipment_with_two_codes["line_id"], "4600000000000")
    assert r.status_code == 400, r.text
    assert "карточк" in r.json()["detail"].lower()


def test_chosen_code_is_what_gets_printed(admin_client, shipment_with_two_codes):
    """Печать строки идёт по выбранному коду, а не по правилу по умолчанию."""
    second = shipment_with_two_codes["codes"][1]
    _set_label(admin_client, shipment_with_two_codes["doc_id"],
               shipment_with_two_codes["line_id"], second)
    labels = admin_client.post("/products/barcode-labels", json={"items": [
        {"product_id": shipment_with_two_codes["product_id"], "barcode": second, "qty": 7},
    ]}).json()
    assert [i["barcode"] for i in labels["items"]] == [second]
    assert labels["items"][0]["chosen"] is True
    assert labels["items"][0]["qty"] == 7
