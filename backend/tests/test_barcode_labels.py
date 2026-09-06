"""Печатные этикетки ШК: Code 128 рисуется по цифрам, ничего не сохраняя."""
from __future__ import annotations

import os
import re
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from utils import _CODE128_PATTERNS, _CODE128_QUIET, barcode_svg
from tests.conftest import (  # noqa: F401
    admin_client,
    manager_client,
    warehouse_client,
    make_client_id,
    cleanup_client,
)


def _decode(svg: str, modules: int) -> str:
    """Обратное чтение нарисованного кода — тест читает этикетку как сканер."""
    bits = ["0"] * modules
    for x, w in re.findall(r'<rect x="(\d+)" y="0" width="(\d+)"', svg):
        for k in range(int(w)):
            bits[int(x) + k] = "1"
    core = "".join(bits)[_CODE128_QUIET:modules - _CODE128_QUIET]
    symbols = [core[i:i + 11] for i in range(0, len(core) - 13, 11)]

    def widths(seq: str) -> str:
        out, cur, cnt = [], seq[0], 0
        for ch in seq:
            if ch == cur:
                cnt += 1
            else:
                out.append(str(cnt))
                cur, cnt = ch, 1
        out.append(str(cnt))
        return "".join(out)

    values = [_CODE128_PATTERNS.index(widths(s)) for s in symbols]
    assert widths(core[len(symbols) * 11:]) == _CODE128_PATTERNS[106], "нет стоп-символа"
    checksum = values[0] + sum(i * v for i, v in enumerate(values[1:-1], start=1))
    assert checksum % 103 == values[-1], "контрольная сумма не сходится"
    out, mode_c = [], values[0] == 105
    for v in values[1:-1]:
        if mode_c:
            if v == 100:
                mode_c = False
            else:
                out.append(f"{v:02d}")
        elif v == 99:
            mode_c = True
        else:
            out.append(chr(32 + v))
    return "".join(out)


@pytest.mark.parametrize("code", [
    "OZN5656440549",   # код Ozon с печатной формы: буквы + цифры
    "4680123456789",   # 13-значный ШК из карточки WB
    "2000000000015",
    "ABC-12/45 x",
    "7",
    "12",
    "WMS0001",
])
def test_barcode_svg_reads_back(code):
    svg, modules = barcode_svg(code)
    assert _decode(svg, modules) == code


def test_numeric_code_uses_dense_subset():
    """13 цифр набором B — 178 модулей, вся ширина этикетки 43 мм без запаса."""
    _, modules = barcode_svg("4680123456789")
    assert modules == 143


def test_unprintable_code_rejected():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        barcode_svg("ШК-кириллица")
    assert exc.value.status_code == 400


@pytest.fixture
def labelled_product():
    """Товар с двумя вариантами: у первого есть ШК, у второго — нет."""
    cid = make_client_id()
    type_id = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    color_id = str(uuid.uuid4())
    vid_with = str(uuid.uuid4())
    vid_without = str(uuid.uuid4())
    code = f"460{uuid.uuid4().hex[:10]}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"LblType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (color_id, f"LblColor-{color_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"LblProduct-{pid[:8]}", type_id, cid, f"LBL-{pid[:8]}"),
        )
        for vid, cval in ((vid_with, color_id), (vid_without, None)):
            conn.execute(
                "INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, "
                "length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted) "
                "VALUES (?, ?, ?, ?, NULL, 1, 1, 1, ?, 0, '[]', 1, NOW(), 0)",
                (vid, pid, cid, cval, f"LBL-V-{vid[:8]}"),
            )
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), pid, vid_with, code, "Ozon"),
        )
        conn.commit()
    yield {
        "client_id": cid, "product_id": pid, "color_id": color_id,
        "variant_with": vid_with, "variant_without": vid_without, "barcode": code,
    }
    with get_connection() as conn:
        conn.execute("DELETE FROM product_barcodes WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM product_variants WHERE product_id = ?", (pid,))
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()
    cleanup_client(cid)


def test_labels_generated_for_variant(warehouse_client, labelled_product):
    r = warehouse_client.post("/products/barcode-labels", json={"items": [
        {"product_id": labelled_product["product_id"],
         "color_id": labelled_product["color_id"], "qty": 12},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["missing"] == []
    item = data["items"][0]
    assert item["barcode"] == labelled_product["barcode"]
    assert item["variant_id"] == labelled_product["variant_with"]
    assert item["qty"] == 12
    assert _decode(item["barcode_svg"], item["modules"]) == labelled_product["barcode"]


def test_variant_without_barcode_reported_not_dropped(warehouse_client, labelled_product):
    r = warehouse_client.post("/products/barcode-labels", json={"items": [
        {"product_id": labelled_product["product_id"], "color_id": labelled_product["color_id"]},
        {"product_id": labelled_product["product_id"]},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["items"]) == 1
    assert [m["variant_id"] for m in data["missing"]] == [labelled_product["variant_without"]]


def test_variant_without_barcode_is_a_state_not_an_error(warehouse_client, labelled_product):
    """Строка состава рисует «Нет ШК» этим же ответом — значит это не ошибка запроса."""
    r = warehouse_client.post("/products/barcode-labels", json={"items": [
        {"product_id": labelled_product["product_id"]},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["items"] == []
    assert data["missing"][0]["reason"] == "У варианта нет штрих-кода"


def test_all_codes_returns_every_barcode_of_the_variant(warehouse_client, labelled_product):
    extra = f"461{uuid.uuid4().hex[:10]}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), labelled_product["product_id"], labelled_product["variant_with"], extra, "WB"),
        )
        conn.commit()
    body = {"items": [{"product_id": labelled_product["product_id"],
                       "color_id": labelled_product["color_id"]}]}
    one = warehouse_client.post("/products/barcode-labels", json=body).json()
    assert len(one["items"]) == 1 and one["items"][0]["barcode_count"] == 2

    every = warehouse_client.post("/products/barcode-labels", json={**body, "all_codes": True}).json()
    assert {i["barcode"] for i in every["items"]} == {labelled_product["barcode"], extra}
    assert {i["source"] for i in every["items"]} == {"Ozon", "WB"}


def test_pinned_code_missing_from_card_is_reported_not_substituted(warehouse_client, labelled_product):
    """Выбранный на строке код сняли с карточки — молча печатать другой нельзя."""
    r = warehouse_client.post("/products/barcode-labels", json={"items": [
        {"product_id": labelled_product["product_id"],
         "color_id": labelled_product["color_id"], "barcode": "4600000000000"},
    ]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["items"] == []
    assert data["missing"][0]["reason"] == "Выбранный код снят с карточки — выберите заново"


def _add_code(product_id, variant_id, code, *, source=None, store_id=None):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, store_id, "
            "created_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)",
            (str(uuid.uuid4()), product_id, variant_id, code, source, store_id),
        )
        conn.commit()


@pytest.fixture
def store_id(labelled_product):
    sid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO client_stores (id, client_id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, 1, 0, NOW())",
            (sid, labelled_product["client_id"], f"Store-{sid[:8]}"),
        )
        conn.commit()
    yield sid
    with get_connection() as conn:
        conn.execute("DELETE FROM client_stores WHERE id = ?", (sid,))
        conn.commit()


def test_store_of_the_line_decides_which_code_is_printed(warehouse_client, labelled_product, store_id):
    """Код кабинета строки главнее общего: чужой ШК на коробе площадка не примет."""
    own = f"462{uuid.uuid4().hex[:10]}"
    _add_code(labelled_product["product_id"], labelled_product["variant_with"], own,
              source="WB", store_id=store_id)
    body = {"items": [{"product_id": labelled_product["product_id"],
                       "color_id": labelled_product["color_id"], "store_id": store_id}]}
    data = warehouse_client.post("/products/barcode-labels", json=body).json()
    assert [i["barcode"] for i in data["items"]] == [own]
    # Кандидат остался один — выбирать не из чего.
    assert data["items"][0]["barcode_count"] == 1
    assert data["items"][0]["mixed_origin"] is False


def test_codes_from_different_cabinets_need_a_choice(warehouse_client, labelled_product, store_id):
    other_store = f"463{uuid.uuid4().hex[:10]}"
    _add_code(labelled_product["product_id"], labelled_product["variant_with"], other_store,
              source="WB", store_id=store_id)
    # Магазин у строки не указан: кандидаты — общий код Ozon и код кабинета WB.
    body = {"items": [{"product_id": labelled_product["product_id"],
                       "color_id": labelled_product["color_id"]}]}
    data = warehouse_client.post("/products/barcode-labels", json=body).json()
    item = data["items"][0]
    assert item["barcode"] == labelled_product["barcode"]
    assert item["barcode_count"] == 1 and item["mixed_origin"] is False, (
        "код с магазином не должен конкурировать с общим, пока магазин строки не выбран"
    )


def test_two_general_codes_are_homogeneous_candidates(warehouse_client, labelled_product):
    twin = f"464{uuid.uuid4().hex[:10]}"
    _add_code(labelled_product["product_id"], labelled_product["variant_with"], twin, source="Ozon")
    body = {"items": [{"product_id": labelled_product["product_id"],
                       "color_id": labelled_product["color_id"]}]}
    item = warehouse_client.post("/products/barcode-labels", json=body).json()["items"][0]
    assert item["barcode_count"] == 2
    assert item["mixed_origin"] is False, "оба кода одного кабинета — выбор не обязателен"


def test_pinned_code_is_marked_as_chosen(warehouse_client, labelled_product):
    twin = f"465{uuid.uuid4().hex[:10]}"
    _add_code(labelled_product["product_id"], labelled_product["variant_with"], twin, source="Ozon")
    body = {"items": [{"product_id": labelled_product["product_id"],
                       "color_id": labelled_product["color_id"], "barcode": twin}]}
    item = warehouse_client.post("/products/barcode-labels", json=body).json()["items"][0]
    assert item["barcode"] == twin
    assert item["chosen"] is True
