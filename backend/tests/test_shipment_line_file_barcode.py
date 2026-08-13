"""Распознавание ШК на файлах строк задачи упаковки (upload → barcodes[])."""
from __future__ import annotations

import io
import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401

zxingcpp = pytest.importorskip("zxingcpp")
PIL_Image = pytest.importorskip("PIL.Image")


def _barcode_png(code: str) -> bytes:
    """PNG с Code-128 (произвольный текст, без контрольных цифр EAN)."""
    bc = zxingcpp.create_barcode(code, zxingcpp.BarcodeFormat.Code128)
    img = zxingcpp.write_barcode_to_image(bc, scale=4)
    h, w = img.shape[0], img.shape[1]
    pil = PIL_Image.frombuffer("L", (w, h), img, "raw", "L", 0, 1)
    buf = io.BytesIO()
    pil.save(buf, "PNG")
    return buf.getvalue()


def _barcode_pdf(code: str) -> bytes:
    bc = zxingcpp.create_barcode(code, zxingcpp.BarcodeFormat.Code128)
    img = zxingcpp.write_barcode_to_image(bc, scale=4)
    h, w = img.shape[0], img.shape[1]
    pil = PIL_Image.frombuffer("L", (w, h), img, "raw", "L", 0, 1).convert("RGB")
    buf = io.BytesIO()
    pil.save(buf, "PDF")
    return buf.getvalue()


@pytest.fixture
def shipment_with_line(admin_client):
    """Клиент + товар A (строка задачи) + товар B (чужой), задача упаковки в draft.
    У каждого товара один вариант без цвета/размера (строка задачи резолвится в него)."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid_a = str(uuid.uuid4())
    pid_b = str(uuid.uuid4())
    vid_a = str(uuid.uuid4())
    vid_b = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"BCFType-{type_id[:8]}"),
        )
        for pid, vid, tag in ((pid_a, vid_a, "A"), (pid_b, vid_b, "B")):
            conn.execute(
                "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
                "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
                (pid, f"BCFProduct{tag}-{pid[:8]}", type_id, cid, f"BCF{tag}-{pid[:8]}"),
            )
            conn.execute(
                "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
                "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
                "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
                (vid, pid, cid, f"BCF-V{tag}-{vid[:8]}"),
            )
        conn.commit()
    doc_id = admin_client.post("/shipments", json={
        "cargo_type": "good",
        "client_id": cid,
        "client_name": "Test Client",
        "lines": [{
            "product_id": pid_a,
            "product_name": f"BCFProductA-{pid_a[:8]}",
            "product_sku": f"BCFA-{pid_a[:8]}",
            "color_id": None,
            "color_name": None,
            "size_id": None,
            "size_name": None,
            "qty": 5,
        }],
    }).json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    yield {
        "client_id": cid, "doc_id": doc_id, "line_id": line_id,
        "product_a": pid_a, "product_b": pid_b,
        "variant_a": vid_a, "variant_b": vid_b,
    }
    with get_connection() as conn:
        conn.execute("DELETE FROM shipment_line_files WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM shipment_docs WHERE id = ?", (doc_id,))
        for pid in (pid_a, pid_b):
            conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
            conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def _upload(client, doc_id, line_id, filename, data, mime):
    return client.post(
        f"/shipments/{doc_id}/lines/{line_id}/files",
        files={"file": (filename, data, mime)},
    )


def test_unknown_barcode_recognized_on_png(admin_client, shipment_with_line):
    code = f"BCF-{uuid.uuid4().hex[:10].upper()}"
    r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                "shk.png", _barcode_png(code), "image/png")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["message"]
    assert data["line_variant_id"] == shipment_with_line["variant_a"]
    assert data["barcodes"] == [
        {"code": code, "status": "unknown", "other_product_name": None, "other_variant_label": None}
    ]


def test_confirmed_barcode_of_line_product(admin_client, shipment_with_line):
    code = f"BCF-{uuid.uuid4().hex[:10].upper()}"
    assert admin_client.post(
        f"/products/{shipment_with_line['product_a']}/barcodes", json={"barcode": code}
    ).status_code == 200
    r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                "shk.png", _barcode_png(code), "image/png")
    assert r.status_code == 200, r.text
    assert r.json()["barcodes"] == [
        {"code": code, "status": "confirmed", "other_product_name": None, "other_variant_label": None}
    ]


def test_other_variant_barcode_flagged(admin_client, shipment_with_line):
    """Код другого цвето-размера того же товара — статус other_variant (пересорт)."""
    pid = shipment_with_line["product_a"]
    cid = shipment_with_line["client_id"]
    vid2 = str(uuid.uuid4())
    color_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"BCF-Красный-{color_id[:6]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid2, pid, cid, color_id, f"BCF-V2-{vid2[:8]}"),
        )
        conn.commit()
    code = f"BCF-{uuid.uuid4().hex[:10].upper()}"
    try:
        assert admin_client.post(
            f"/products/{pid}/barcodes", json={"barcode": code, "variant_id": vid2}
        ).status_code == 200
        r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                    "shk.png", _barcode_png(code), "image/png")
        assert r.status_code == 200, r.text
        bcs = r.json()["barcodes"]
        assert bcs[0]["status"] == "other_variant"
        assert "Красный" in bcs[0]["other_variant_label"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM product_barcodes WHERE variant_id = ?", (vid2,))
            conn.execute("DELETE FROM product_variants WHERE id = ?", (vid2,))
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.commit()


def test_foreign_barcode_reports_other_product(admin_client, shipment_with_line):
    code = f"BCF-{uuid.uuid4().hex[:10].upper()}"
    assert admin_client.post(
        f"/products/{shipment_with_line['product_b']}/barcodes", json={"barcode": code}
    ).status_code == 200
    r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                "shk.png", _barcode_png(code), "image/png")
    assert r.status_code == 200, r.text
    bcs = r.json()["barcodes"]
    assert len(bcs) == 1
    assert bcs[0]["code"] == code
    assert bcs[0]["status"] == "other_product"
    assert bcs[0]["other_product_name"].startswith("BCFProductB-")


def test_barcode_recognized_in_pdf(admin_client, shipment_with_line):
    code = f"BCF-{uuid.uuid4().hex[:10].upper()}"
    r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                "этикетка.pdf", _barcode_pdf(code), "application/pdf")
    assert r.status_code == 200, r.text
    assert r.json()["barcodes"] == [
        {"code": code, "status": "unknown", "other_product_name": None, "other_variant_label": None}
    ]


def test_unreadable_file_uploads_without_barcodes(admin_client, shipment_with_line):
    """Мусорный PDF: файл прикрепляется, распознавание — пустой список, не ошибка."""
    r = _upload(admin_client, shipment_with_line["doc_id"], shipment_with_line["line_id"],
                "тз.pdf", b"%PDF-1.4 no barcode here", "application/pdf")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["message"]
    assert data["barcodes"] == []
    files = admin_client.get(f"/shipments/{shipment_with_line['doc_id']}").json()["lines"][0]["files"]
    assert len(files) == 1
