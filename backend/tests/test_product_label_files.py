"""Этикетки штрих-кодов в карточке товара + прикрепление их к строкам задач упаковки."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, warehouse_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def env(admin_client):
    """Клиент + товары A/B с кодами, задача упаковки со строкой товара A."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid_a = str(uuid.uuid4())
    pid_b = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"LFType-{type_id[:8]}"),
        )
        vid_a, vid_b = str(uuid.uuid4()), str(uuid.uuid4())
        for pid, vid, tag in ((pid_a, vid_a, "A"), (pid_b, vid_b, "B")):
            conn.execute(
                "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
                "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
                (pid, f"LFProduct{tag}-{pid[:8]}", type_id, cid, f"LF{tag}-{pid[:8]}"),
            )
            conn.execute(
                "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
                "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
                "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
                (vid, pid, cid, f"LF-V{tag}-{vid[:8]}"),
            )
        conn.commit()
    bc_a = admin_client.post(f"/products/{pid_a}/barcodes", json={"barcode": f"LF-{uuid.uuid4().hex[:10]}"}).json()["message"]
    bc_b = admin_client.post(f"/products/{pid_b}/barcodes", json={"barcode": f"LF-{uuid.uuid4().hex[:10]}"}).json()["message"]
    doc_id = admin_client.post("/shipments", json={
        "cargo_type": "good",
        "client_id": cid,
        "client_name": "Test Client",
        "lines": [{
            "product_id": pid_a,
            "product_name": f"LFProductA-{pid_a[:8]}",
            "product_sku": f"LFA-{pid_a[:8]}",
            "color_id": None, "color_name": None,
            "size_id": None, "size_name": None,
            "qty": 3,
        }],
    }).json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    yield {
        "client_id": cid, "product_a": pid_a, "product_b": pid_b,
        "barcode_a": bc_a, "barcode_b": bc_b, "doc_id": doc_id, "line_id": line_id,
    }
    with get_connection() as conn:
        conn.execute("DELETE FROM shipment_line_files WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_docs WHERE id = ?", (doc_id,))
        for pid in (pid_a, pid_b):
            conn.execute("DELETE FROM product_barcode_files WHERE product_id = ?", (pid,))
            conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
            conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _upload_label(client, pid, bc_id, filename="этикетка.png"):
    return client.post(
        f"/products/{pid}/barcodes/{bc_id}/files",
        files={"file": (filename, b"\x89PNG fake", "image/png")},
    )


def test_add_barcode_returns_id(admin_client, env):
    # message содержит id кода — нужен для немедленной загрузки этикетки
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM product_barcodes WHERE id = ?", (env["barcode_a"],)).fetchone()
    assert row is not None


def test_label_file_upload_and_lists(admin_client, warehouse_client, env):
    up = _upload_label(admin_client, env["product_a"], env["barcode_a"])
    assert up.status_code == 200, up.text
    file_id = up.json()["message"]

    variants = admin_client.get(f"/products/{env['product_a']}/variants").json()
    target = next(b for v in variants for b in v["barcodes"] if b["id"] == env["barcode_a"])
    assert [f["id"] for f in target["files"]] == [file_id]
    assert target["files"][0]["filename"] == "этикетка.png"
    assert target["files"][0]["url"].startswith("/uploads/")

    # плоский список для выбора в документах — доступен складу
    flat = warehouse_client.get(f"/products/{env['product_a']}/files")
    assert flat.status_code == 200, flat.text
    assert [f["id"] for f in flat.json()] == [file_id]

    # удаление этикетки
    rm = admin_client.delete(f"/products/{env['product_a']}/barcodes/{env['barcode_a']}/files/{file_id}")
    assert rm.status_code == 200, rm.text
    assert warehouse_client.get(f"/products/{env['product_a']}/files").json() == []


def test_delete_barcode_hides_its_files(admin_client, env):
    file_id = _upload_label(admin_client, env["product_a"], env["barcode_a"]).json()["message"]
    assert admin_client.delete(f"/products/{env['product_a']}/barcodes/{env['barcode_a']}").status_code == 200
    flat = admin_client.get(f"/products/{env['product_a']}/files").json()
    assert file_id not in [f["id"] for f in flat]


def test_attach_label_from_product_to_line(admin_client, env):
    file_id = _upload_label(admin_client, env["product_a"], env["barcode_a"]).json()["message"]
    r = admin_client.post(
        f"/shipments/{env['doc_id']}/lines/{env['line_id']}/files/from-product",
        json={"product_file_id": file_id},
    )
    assert r.status_code == 200, r.text
    files = admin_client.get(f"/shipments/{env['doc_id']}").json()["lines"][0]["files"]
    assert len(files) == 1
    assert files[0]["filename"] == "этикетка.png"

    # повторное прикрепление той же этикетки — 409
    dup = admin_client.post(
        f"/shipments/{env['doc_id']}/lines/{env['line_id']}/files/from-product",
        json={"product_file_id": file_id},
    )
    assert dup.status_code == 409


def test_attach_foreign_product_label_rejected(admin_client, env):
    foreign_file = _upload_label(admin_client, env["product_b"], env["barcode_b"]).json()["message"]
    r = admin_client.post(
        f"/shipments/{env['doc_id']}/lines/{env['line_id']}/files/from-product",
        json={"product_file_id": foreign_file},
    )
    assert r.status_code == 400
    assert "другому товару" in r.json()["detail"]
