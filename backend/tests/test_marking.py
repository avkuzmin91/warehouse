"""Реестр кодов маркировки «Честный знак»: разбор GS1, уникальность, идемпотентность."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from app import app
from dbconn import get_connection
from modules.marking.service import gtin_to_ean13, parse_cis
from tests.conftest import (  # noqa: F401
    _RoleClient,
    cleanup_client,
    make_client_id,
    warehouse_client,
)

GS = "\x1d"
SERIAL = "9A1B2C3D4E5F6"
CRYPTO = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"


def _gtin() -> str:
    """GTIN-14 с ведущим нулём: его EAN-13 совпадает с штрих-кодом варианта."""
    return "0" + str(uuid.uuid4().int)[:13]


def _cis(gtin: str, *, with_gs: bool = True) -> str:
    tail = f"{GS}91EE06{GS}92{CRYPTO}" if with_gs else f"91EE0692{CRYPTO}"
    return f"01{gtin}21{SERIAL}{tail}"


@pytest.fixture
def product_with_barcode():
    """Товар с вариантом и штрих-кодом EAN-13, к которому приводится GTIN кода маркировки."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    vid = str(uuid.uuid4())
    gtin = _gtin()
    ean13 = gtin[1:]
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"MarkType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"MarkProduct-{pid[:8]}", type_id, cid, f"MK-{pid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
            "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
            "VALUES (?, ?, ?, NULL, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
            (vid, pid, cid, f"MK-V-{vid[:8]}"),
        )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid, ean13),
        )
        conn.commit()
    yield {"client_id": cid, "product_id": pid, "variant_id": vid, "gtin": gtin}
    with get_connection() as conn:
        conn.execute("DELETE FROM marking_codes WHERE product_id = ? OR gtin = ?", (pid, gtin))
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


# --- Разбор GS1 (чистая функция) ---


def test_parse_cis_with_separators():
    gtin = _gtin()
    parsed = parse_cis(_cis(gtin))
    assert parsed == {"gtin": gtin, "serial": SERIAL, "is_exact": True}


def test_parse_cis_without_separators_trims_serial():
    gtin = _gtin()
    parsed = parse_cis(_cis(gtin, with_gs=False))
    assert parsed["gtin"] == gtin
    assert parsed["serial"] == SERIAL
    assert parsed["is_exact"] is False


def test_parse_cis_strips_symbology_prefix():
    gtin = _gtin()
    assert parse_cis(f"]d2{_cis(gtin)}")["gtin"] == gtin


def test_parse_cis_keeps_trailing_separator_exact():
    """0x1D в Python — пробельный символ; голый strip() съел бы его и соврал про is_exact."""
    gtin = _gtin()
    assert parse_cis(f"01{gtin}21{SERIAL}{GS}")["is_exact"] is True


def test_parse_cis_rejects_plain_barcode():
    assert parse_cis("4601234567890") is None
    assert parse_cis("wms:loc:abc") is None
    assert parse_cis("") is None


def test_gtin_to_ean13():
    assert gtin_to_ean13("04601234567890") == "4601234567890"
    assert gtin_to_ean13("14601234567890") is None


# --- Реестр ---


def test_scan_saves_code_and_links_variant(warehouse_client, product_with_barcode):
    gtin = product_with_barcode["gtin"]
    res = warehouse_client.post("/marking/codes", json={"raw": _cis(gtin)})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "saved"
    assert body["code"]["gtin"] == gtin
    assert body["code"]["serial"] == SERIAL
    assert body["code"]["is_exact"] is True
    assert body["code"]["variant_id"] == product_with_barcode["variant_id"]
    assert body["code"]["client_id"] == product_with_barcode["client_id"]
    # created_by_email приходит джойном к users, а фиктивного пользователя фикстуры
    # там нет — авторство проверяем по самой записи.
    with get_connection() as conn:
        row = conn.execute(
            "SELECT created_by, created_at FROM marking_codes WHERE id = ?", (body["code"]["id"],)
        ).fetchone()
    assert row["created_by"] == "test-warehouse-id"
    assert row["created_at"]


def test_rescan_reports_duplicate_with_original(warehouse_client, product_with_barcode):
    raw = _cis(product_with_barcode["gtin"])
    first = warehouse_client.post("/marking/codes", json={"raw": raw}).json()
    again = warehouse_client.post("/marking/codes", json={"raw": raw})
    assert again.status_code == 200, again.text
    body = again.json()
    assert body["status"] == "duplicate"
    assert body["code"]["id"] == first["code"]["id"]
    assert body["code"]["created_at"] == first["code"]["created_at"]


def test_duplicate_detected_across_scanner_dialects(warehouse_client, product_with_barcode):
    """Один физический КИЗ от сканеров с FNC1 и без — одна запись: ключ (gtin, serial)."""
    gtin = product_with_barcode["gtin"]
    warehouse_client.post("/marking/codes", json={"raw": _cis(gtin)})
    body = warehouse_client.post("/marking/codes", json={"raw": _cis(gtin, with_gs=False)}).json()
    assert body["status"] == "duplicate"


def test_scan_is_idempotent_on_retry(warehouse_client, product_with_barcode):
    """Обрыв связи и повтор с тем же X-Request-Id не должен давать ложный duplicate."""
    raw = _cis(product_with_barcode["gtin"])
    rid = str(uuid.uuid4())
    first = warehouse_client.post("/marking/codes", json={"raw": raw}, headers={"X-Request-Id": rid})
    retry = warehouse_client.post("/marking/codes", json={"raw": raw}, headers={"X-Request-Id": rid})
    assert first.json() == retry.json()
    assert retry.json()["status"] == "saved"


def test_scan_rejects_non_marking_code(warehouse_client):
    res = warehouse_client.post("/marking/codes", json={"raw": "4601234567890"})
    assert res.status_code == 400
    assert "Честный знак" in res.json()["detail"]


def test_code_without_known_barcode_saved_unlinked(warehouse_client):
    gtin = _gtin()
    body = warehouse_client.post("/marking/codes", json={"raw": _cis(gtin)}).json()
    assert body["status"] == "saved"
    assert body["code"]["variant_id"] is None
    assert body["code"]["product_id"] is None
    with get_connection() as conn:
        conn.execute("DELETE FROM marking_codes WHERE gtin = ?", (gtin,))
        conn.commit()


def test_list_codes_filters_by_client(warehouse_client, product_with_barcode):
    warehouse_client.post("/marking/codes", json={"raw": _cis(product_with_barcode["gtin"])})
    res = warehouse_client.get(
        "/marking/codes", params={"client_id": product_with_barcode["client_id"]}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["items"][0]["serial"] == SERIAL
    assert body["items"][0]["product_name"]


def test_list_codes_search_by_serial(warehouse_client, product_with_barcode):
    warehouse_client.post("/marking/codes", json={"raw": _cis(product_with_barcode["gtin"])})
    body = warehouse_client.get("/marking/codes", params={"search": SERIAL}).json()
    assert any(i["serial"] == SERIAL for i in body["items"])


def test_soft_deleted_code_can_be_rescanned(warehouse_client, product_with_barcode):
    """Ошибочный скан снимается soft-delete — частичный uq не мешает завести код заново."""
    raw = _cis(product_with_barcode["gtin"])
    first = warehouse_client.post("/marking/codes", json={"raw": raw}).json()
    with get_connection() as conn:
        conn.execute("UPDATE marking_codes SET is_deleted = 1 WHERE id = ?", (first["code"]["id"],))
        conn.commit()
    again = warehouse_client.post("/marking/codes", json={"raw": raw}).json()
    assert again["status"] == "saved"
    assert again["code"]["id"] != first["code"]["id"]


def test_client_cabinet_user_cannot_scan(product_with_barcode):
    """ЛК клиента — read-only: складских операций там быть не должно."""
    cabinet_user = {
        "id": "test-cabinet-user-id",
        "email": "client@test.com",
        "role": "client",
        "created_at": "2020-01-01T00:00:00",
        "client_id": product_with_barcode["client_id"],
    }
    with _RoleClient(app, cabinet_user) as c:
        res = c.post("/marking/codes", json={"raw": _cis(product_with_barcode["gtin"])})
    app.dependency_overrides.clear()
    assert res.status_code == 403
