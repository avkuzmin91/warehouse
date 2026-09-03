from __future__ import annotations

import uuid
from io import BytesIO

import pytest
from openpyxl import Workbook

from dbconn import get_connection

HEADERS = [
    "SKU базовый", "Название товара", "Тип товара", "Цвет", "Размер",
    "Длина, см", "Ширина, см", "Высота, см", "Вес, гр", "Кол-во в коробе",
    "Коробов на палете", "Штрих-код(ы)", "Цена упаковки годный, ₽",
    "Цена упаковки брак, ₽", "Активен",
]

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _workbook_bytes(rows: list[list[object]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Товары"
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(client, client_id: str, rows: list[list[object]], *, request_id: str | None = None):
    headers = {"X-Request-Id": request_id} if request_id else None
    return client.post(
        "/products/bulk-import/preview",
        data={"client_id": client_id},
        files={"file": ("import.xlsx", _workbook_bytes(rows), XLSX_MIME)},
        headers=headers,
    )


@pytest.fixture
def import_env():
    """Клиент, два типа товара (с размером и без), цвет и размер."""
    suffix = uuid.uuid4().hex[:8]
    env = {
        "client_id": f"cli-imp-{suffix}",
        "client_name": f"Клиент импорта {suffix}",
        "type_sized_id": f"pt-imp-s-{suffix}",
        "type_sized_name": f"Одежда {suffix}",
        "type_plain_id": f"pt-imp-p-{suffix}",
        "type_plain_name": f"Коробка {suffix}",
        "color_id": f"col-imp-{suffix}",
        "color_name": f"Красный {suffix}",
        "color2_id": f"col2-imp-{suffix}",
        "color2_name": f"Синий {suffix}",
        "size_id": f"sz-imp-{suffix}",
        "size_name": f"44-{suffix}",
        "suffix": suffix,
    }
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (env["client_id"], env["client_name"]),
        )
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, requires_color, requires_size, is_deleted, created_at) "
            "VALUES (?, ?, 1, 1, 1, 0, NOW())",
            (env["type_sized_id"], env["type_sized_name"]),
        )
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, requires_color, requires_size, is_deleted, created_at) "
            "VALUES (?, ?, 1, 0, 0, 0, NOW())",
            (env["type_plain_id"], env["type_plain_name"]),
        )
        for cid, cname in ((env["color_id"], env["color_name"]), (env["color2_id"], env["color2_name"])):
            conn.execute(
                "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
                (cid, cname),
            )
        conn.execute(
            "INSERT INTO sizes (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (env["size_id"], env["size_name"]),
        )
        conn.commit()
    try:
        yield env
    finally:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM product_barcodes WHERE product_id IN (SELECT id FROM products WHERE client_id = ?)",
                (env["client_id"],),
            )
            conn.execute("DELETE FROM product_packing_prices WHERE client_id = ?", (env["client_id"],))
            conn.execute("DELETE FROM product_variants WHERE client_id = ?", (env["client_id"],))
            conn.execute("DELETE FROM products WHERE client_id = ?", (env["client_id"],))
            conn.execute("DELETE FROM product_import_batches WHERE client_id = ?", (env["client_id"],))
            conn.execute("DELETE FROM sizes WHERE id = ?", (env["size_id"],))
            conn.execute("DELETE FROM colors WHERE id IN (?, ?)", (env["color_id"], env["color2_id"]))
            conn.execute(
                "DELETE FROM product_types WHERE id IN (?, ?)",
                (env["type_sized_id"], env["type_plain_id"]),
            )
            conn.execute("DELETE FROM clients WHERE id = ?", (env["client_id"],))
            conn.commit()


def test_import_creates_products_variants_and_barcodes(manager_client, import_env):
    sku = f"IMP-{import_env['suffix']}"
    barcode = f"460{import_env['suffix'][:6]}01"
    rows = [
        # Лишние пробелы в названии и справочных значениях должны схлопываться.
        [sku, f"  Куртка   {import_env['suffix']}  ", f" {import_env['type_sized_name']} ",
         import_env["color_name"], import_env["size_name"],
         30, 20, 5, 250, 10, 12, barcode, "12,50", "5,00", "да"],
        [sku, f"Куртка {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color2_name"], import_env["size_name"],
         30, 20, 5, 250, 10, 12, "", "", "", ""],
    ]
    preview = _upload(manager_client, import_env["client_id"], rows)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["summary"]["rows_total"] == 2
    assert body["summary"]["rows_with_errors"] == 0
    assert body["summary"]["products_new"] == 1
    assert body["summary"]["variants_new"] == 2
    assert body["summary"]["barcodes_new"] == 1
    assert body["summary"]["import_ready"] is True
    assert body["status_label"] == "Готов к импорту"

    commit = manager_client.post(f"/products/bulk-import/{body['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    assert commit.json()["summary"]["variants_new"] == 2

    with get_connection() as conn:
        product = conn.execute(
            "SELECT id, name, weight_grams, items_per_box, boxes_per_pallet, sku_pending "
            "FROM products WHERE client_id = ? AND sku = ?",
            (import_env["client_id"], sku),
        ).fetchone()
        assert product is not None
        assert product["name"] == f"Куртка {import_env['suffix']}"
        assert product["weight_grams"] == 250
        assert product["items_per_box"] == 10
        assert product["boxes_per_pallet"] == 12
        assert int(product["sku_pending"]) == 0

        variants = conn.execute(
            "SELECT sku FROM product_variants WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0",
            (product["id"],),
        ).fetchall()
        assert len(variants) == 2
        assert all(str(v["sku"]).startswith(sku) for v in variants)

        codes = conn.execute(
            "SELECT barcode FROM product_barcodes WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0",
            (product["id"],),
        ).fetchall()
        assert [str(c["barcode"]) for c in codes] == [barcode]

        prices = conn.execute(
            "SELECT quality, price_kop FROM product_packing_prices WHERE product_id = ?",
            (product["id"],),
        ).fetchall()
        assert {str(p["quality"]): int(p["price_kop"]) for p in prices} == {"good": 1250, "defect": 500}


def test_import_appends_variant_to_existing_product_and_skips_known(manager_client, import_env):
    sku = f"IMP2-{import_env['suffix']}"
    first = _upload(manager_client, import_env["client_id"], [
        [sku, f"Худи {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert first.status_code == 200, first.text
    commit = manager_client.post(f"/products/bulk-import/{first.json()['import_id']}/commit")
    assert commit.status_code == 200, commit.text

    second = _upload(manager_client, import_env["client_id"], [
        # Уже заведённый вариант — «Уже есть».
        [sku, f"Худи {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
        # Новый цвет — дозаливка к существующему товару.
        [sku, f"Худи {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color2_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["summary"]["products_new"] == 0
    assert body["summary"]["products_existing"] == 1
    assert body["summary"]["variants_new"] == 1
    assert body["summary"]["variants_skipped"] == 1
    actions = [r["action"] for r in body["rows"]]
    assert actions == ["skip", "append"]

    commit2 = manager_client.post(f"/products/bulk-import/{body['import_id']}/commit")
    assert commit2.status_code == 200, commit2.text

    with get_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id "
            "WHERE p.client_id = ? AND p.sku = ? AND COALESCE(v.is_deleted, 0) = 0",
            (import_env["client_id"], sku),
        ).fetchone()
        assert int(count["n"]) == 2


def test_import_reports_row_errors_and_blocks_strict_commit(manager_client, import_env):
    sku = f"IMP3-{import_env['suffix']}"
    rows = [
        # Ок.
        [sku, f"Свитер {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
        # Тип требует размер, а размера нет.
        [f"{sku}-B", f"Свитер B {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], "", 1, 1, 1, "", "", "", "", "", "", ""],
        # Неизвестный цвет — справочники строгие.
        [f"{sku}-C", f"Свитер C {import_env['suffix']}", import_env["type_sized_name"],
         f"Неизвестный цвет {import_env['suffix']}", import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
        # Не число в весе.
        [f"{sku}-D", f"Свитер D {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "много", "", "", "", "", "", ""],
    ]
    preview = _upload(manager_client, import_env["client_id"], rows)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["summary"]["rows_with_errors"] == 3
    assert body["summary"]["can_import_partial"] is True
    assert body["summary"]["import_ready"] is False
    assert "Для этого типа товара укажите размер" in body["rows"][1]["errors"]
    assert any("не найден в справочнике" in e for e in body["rows"][2]["errors"])
    assert any("не число" in e for e in body["rows"][3]["errors"])

    strict = manager_client.post(f"/products/bulk-import/{body['import_id']}/commit")
    assert strict.status_code == 409, strict.text

    partial = manager_client.post(f"/products/bulk-import/{body['import_id']}/commit?partial=true")
    assert partial.status_code == 200, partial.text
    assert partial.json()["summary"]["variants_new"] == 1

    with get_connection() as conn:
        rows_db = conn.execute(
            "SELECT sku FROM products WHERE client_id = ?", (import_env["client_id"],)
        ).fetchall()
        assert [str(r["sku"]) for r in rows_db] == [sku]


def test_import_rejects_taken_barcode_and_duplicate_variant(manager_client, import_env):
    sku = f"IMP4-{import_env['suffix']}"
    barcode = f"461{import_env['suffix'][:6]}02"
    first = _upload(manager_client, import_env["client_id"], [
        [sku, f"Кепка {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", barcode, "", "", ""],
    ])
    assert first.status_code == 200, first.text
    assert manager_client.post(f"/products/bulk-import/{first.json()['import_id']}/commit").status_code == 200

    second = _upload(manager_client, import_env["client_id"], [
        [f"{sku}-X", f"Кепка X {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", barcode, "", "", ""],
        [f"{sku}-Y", f"Кепка Y {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color2_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
        [f"{sku}-Y", f"Кепка Y {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color2_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert second.status_code == 200, second.text
    body = second.json()
    assert any("уже присвоен" in e for e in body["rows"][0]["errors"])
    assert any("уже есть в файле" in e for e in body["rows"][2]["errors"])


def test_import_sku_case_collision_is_an_error(manager_client, import_env):
    sku = f"IMP5-{import_env['suffix']}"
    preview = _upload(manager_client, import_env["client_id"], [
        [sku, f"Джемпер {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
        [sku.lower(), f"Джемпер {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color2_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert any("отличается только регистром" in e for e in body["rows"][1]["errors"])


def test_import_without_sku_creates_pending_product_with_warning(manager_client, import_env):
    preview = _upload(manager_client, import_env["client_id"], [
        ["", f"Без SKU {import_env['suffix']}", import_env["type_plain_name"],
         "", "", 10, 10, 10, "", "", "", "", "", "", ""],
    ])
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["summary"]["rows_with_errors"] == 0
    assert any("без SKU" in w for w in body["rows"][0]["warnings"])

    assert manager_client.post(f"/products/bulk-import/{body['import_id']}/commit").status_code == 200
    with get_connection() as conn:
        row = conn.execute(
            "SELECT sku_pending FROM products WHERE client_id = ? AND name = ?",
            (import_env["client_id"], f"Без SKU {import_env['suffix']}"),
        ).fetchone()
        assert row is not None and int(row["sku_pending"]) == 1


def test_import_commit_is_idempotent(manager_client, import_env):
    sku = f"IMP6-{import_env['suffix']}"
    preview = _upload(manager_client, import_env["client_id"], [
        [sku, f"Шарф {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], import_env["size_name"], 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert preview.status_code == 200, preview.text
    batch_id = preview.json()["import_id"]
    request_id = str(uuid.uuid4())

    first = manager_client.post(
        f"/products/bulk-import/{batch_id}/commit", headers={"X-Request-Id": request_id}
    )
    assert first.status_code == 200, first.text
    repeat = manager_client.post(
        f"/products/bulk-import/{batch_id}/commit", headers={"X-Request-Id": request_id}
    )
    assert repeat.status_code == 200, repeat.text
    assert repeat.json() == first.json()

    with get_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM products WHERE client_id = ? AND sku = ?",
            (import_env["client_id"], sku),
        ).fetchone()
        assert int(count["n"]) == 1


def test_import_rejects_bad_structure_and_format(manager_client, import_env):
    wb = Workbook()
    ws = wb.active
    ws.append(["Не", "та", "шапка"])
    ws.append([1, 2, 3])
    buf = BytesIO()
    wb.save(buf)
    bad_structure = manager_client.post(
        "/products/bulk-import/preview",
        data={"client_id": import_env["client_id"]},
        files={"file": ("import.xlsx", buf.getvalue(), XLSX_MIME)},
    )
    assert bad_structure.status_code == 400
    assert "структура" in bad_structure.json()["detail"].lower()

    bad_format = manager_client.post(
        "/products/bulk-import/preview",
        data={"client_id": import_env["client_id"]},
        files={"file": ("import.csv", b"a;b;c\n1;2;3\n", "text/csv")},
    )
    assert bad_format.status_code == 400
    assert "формат" in bad_format.json()["detail"].lower()


def test_import_template_and_report_are_xlsx(manager_client, import_env):
    template = manager_client.get("/products/bulk-import/template")
    assert template.status_code == 200, template.text
    assert template.content[:2] == b"PK"

    preview = _upload(manager_client, import_env["client_id"], [
        [f"IMP7-{import_env['suffix']}", f"Плед {import_env['suffix']}", import_env["type_sized_name"],
         import_env["color_name"], "", 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert preview.status_code == 200, preview.text
    report = manager_client.get(f"/products/bulk-import/{preview.json()['import_id']}/report")
    assert report.status_code == 200, report.text
    assert report.content[:2] == b"PK"


def test_import_requires_manager_staff(shift_supervisor_client, import_env):
    resp = _upload(shift_supervisor_client, import_env["client_id"], [
        [f"IMP8-{import_env['suffix']}", "Тест", import_env["type_plain_name"],
         "", "", 1, 1, 1, "", "", "", "", "", "", ""],
    ])
    assert resp.status_code == 403
