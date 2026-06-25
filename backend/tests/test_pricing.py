from __future__ import annotations

import uuid

from dbconn import get_connection
from modules.pricing.service import price_on


def _seed_product(*, with_client: bool = True) -> tuple[str, str, str]:
    """Создать тип/клиента/товар напрямую. Возвращает (product_id, client_id, type_id)."""
    suffix = uuid.uuid4().hex[:10]
    type_id = f"ptype-{suffix}"
    client_id = f"client-{suffix}"
    product_id = f"product-{suffix}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, requires_color, requires_size, is_deleted, created_at) "
            "VALUES (?, ?, 1, 0, 0, 0, NOW())",
            (type_id, f"Type {suffix}"),
        )
        conn.execute(
            "INSERT INTO clients (id, name, is_active, is_deleted, created_at) VALUES (?, ?, 1, 0, NOW())",
            (client_id, f"Client {suffix}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NOW())",
            (product_id, f"Pricing Product {suffix}", type_id, client_id if with_client else None,
             f"PRC-{suffix}"),
        )
        conn.commit()
    return product_id, client_id, type_id


def test_price_on_backward_distribution():
    # Самая ранняя ставка тянется назад; повышение применяется с его даты.
    hist = [
        {"price_kop": 15000, "effective_from": "2026-06-01"},
        {"price_kop": 10000, "effective_from": "2026-01-01"},
    ]
    assert price_on(hist, "2025-12-31") == 10000  # до самой ранней — тянем назад
    assert price_on(hist, "2026-01-01") == 10000  # в свой первый день
    assert price_on(hist, "2026-05-31") == 10000
    assert price_on(hist, "2026-06-01") == 15000  # повышение в свой день
    assert price_on(hist, "2026-12-31") == 15000
    assert price_on(None, "2026-06-01") is None
    assert price_on([], "2026-06-01") is None


def test_list_missing_then_set_price(manager_client):
    product_id, client_id, _ = _seed_product()

    # Без тарифа — товар попадает в missing_only, has_price = false.
    miss = manager_client.get(f"/pricing/products?client_id={client_id}&missing_only=true")
    assert miss.status_code == 200, miss.text
    ids = {it["id"] for it in miss.json()["items"]}
    assert product_id in ids
    item = next(it for it in miss.json()["items"] if it["id"] == product_id)
    assert item["has_price"] is False
    assert item["good_price_kop"] is None

    # Заводим обе ставки.
    resp = manager_client.post(
        f"/pricing/products/{product_id}/prices",
        json={"good_price_kop": 12000, "defect_price_kop": 5000},
    )
    assert resp.status_code == 200, resp.text

    # Теперь не в missing, цены видны.
    miss2 = manager_client.get(f"/pricing/products?client_id={client_id}&missing_only=true")
    assert product_id not in {it["id"] for it in miss2.json()["items"]}

    lst = manager_client.get(f"/pricing/products?client_id={client_id}")
    item = next(it for it in lst.json()["items"] if it["id"] == product_id)
    assert item["good_price_kop"] == 12000
    assert item["defect_price_kop"] == 5000
    assert item["has_price"] is True


def test_detail_history_and_current(manager_client):
    product_id, client_id, _ = _seed_product()
    # Старая ставка и повышение.
    r1 = manager_client.post(
        f"/pricing/products/{product_id}/prices",
        json={"good_price_kop": 10000, "effective_from": "2026-01-01"},
    )
    assert r1.status_code == 200, r1.text
    r2 = manager_client.post(
        f"/pricing/products/{product_id}/prices",
        json={"good_price_kop": 15000, "effective_from": "2026-06-01"},
    )
    assert r2.status_code == 200, r2.text

    detail = manager_client.get(f"/pricing/products/{product_id}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["good_price_kop"] == 15000  # действующая на сегодня (2026-06-25)
    assert len(body["good_history"]) == 2
    assert body["good_history"][0]["effective_from"] == "2026-06-01"  # свежая первой
    assert body["defect_price_kop"] is None


def test_set_price_requires_value(manager_client):
    product_id, _, _ = _seed_product()
    resp = manager_client.post(f"/pricing/products/{product_id}/prices", json={})
    assert resp.status_code == 400


def test_pricing_forbidden_for_warehouse(warehouse_client):
    resp = warehouse_client.get("/pricing/products")
    assert resp.status_code == 403


def _seed_dispatch(product_id: str, client_id: str, *, cargo_type: str, qty: int, ship_date: str) -> str:
    suffix = uuid.uuid4().hex[:10]
    doc_id = f"dsp-{suffix}"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO dispatch_docs (id, doc_number, cargo_type, client_id, client_name, "
            "ship_date, status, created_at, is_deleted) VALUES (?,?,?,?,?,?,?, NOW(), 0)",
            (doc_id, f"DSP-{suffix}", cargo_type, client_id, "C", ship_date, "shipped"),
        )
        conn.execute(
            "INSERT INTO dispatch_lines (id, doc_id, product_id, product_name, product_sku, qty, "
            "shipped_qty, created_at, is_deleted) VALUES (?,?,?,?,?,?,?, NOW(), 0)",
            (f"dl-{suffix}", doc_id, product_id, "P", "SKU", qty, qty),
        )
        conn.commit()
    return doc_id


def test_suggested_amount_for_dispatches(manager_client):
    from modules.invoices.service import suggested_amount_for_dispatches

    product_id, client_id, _ = _seed_product()
    manager_client.post(
        f"/pricing/products/{product_id}/prices",
        json={"good_price_kop": 10000, "defect_price_kop": 4000, "effective_from": "2026-01-01"},
    )
    good_doc = _seed_dispatch(product_id, client_id, cargo_type="good", qty=3, ship_date="2026-06-10")
    defect_doc = _seed_dispatch(product_id, client_id, cargo_type="defect", qty=2, ship_date="2026-06-10")

    with get_connection() as conn:
        res = suggested_amount_for_dispatches(conn, [good_doc, defect_doc])
    assert res["amount_kop"] == 3 * 10000 + 2 * 4000
    assert res["has_missing_price"] is False
    assert res["unpriced_qty"] == 0


def test_suggested_amount_flags_missing_price(manager_client):
    from modules.invoices.service import suggested_amount_for_dispatches

    product_id, client_id, _ = _seed_product()  # тариф не заводим
    doc = _seed_dispatch(product_id, client_id, cargo_type="good", qty=5, ship_date="2026-06-10")
    with get_connection() as conn:
        res = suggested_amount_for_dispatches(conn, [doc])
    assert res["amount_kop"] == 0
    assert res["has_missing_price"] is True
    assert res["unpriced_qty"] == 5


def _seed_packing(product_id: str, client_id: str, *, good: int, defect: int, packed_date: str) -> str:
    """Засеять QC-движение упаковки (годный/брак) в журнал. Возвращает pack_entry_id."""
    from modules.balances.service import insert_inventory_move

    pack_entry_id = str(uuid.uuid4())
    line_id = f"sl-{uuid.uuid4().hex[:10]}"
    with get_connection() as conn:
        for quality, qty in (("good", good), ("defect", defect)):
            if qty <= 0:
                continue
            insert_inventory_move(
                conn,
                product_id=product_id, product_name="P", product_sku="SKU",
                color_id=None, color_name=None, size_id=None, size_name=None,
                client_id=client_id, client_name=None,
                from_op="packing", to_op="packed",
                from_quality="good", to_quality=quality,
                from_zone_id=None, from_zone_name=None, to_zone_id=None, to_zone_name=None,
                qty=qty, user_id="test-admin-id", shipment_line_id=line_id,
                comment="seed", packed_date=packed_date, pack_entry_id=pack_entry_id,
            )
        conn.commit()
    return pack_entry_id


def test_productivity_earnings_for_manager(manager_client, warehouse_client):
    product_id, client_id, _ = _seed_product()
    manager_client.post(
        f"/pricing/products/{product_id}/prices",
        json={"good_price_kop": 10000, "defect_price_kop": 4000, "effective_from": "2026-01-01"},
    )
    _seed_packing(product_id, client_id, good=3, defect=2, packed_date="2026-06-12")

    resp = manager_client.get(
        f"/shipments/packing/productivity?client_id={client_id}&date_from=2026-06-12&date_to=2026-06-12"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["with_earnings"] is True
    assert body["total_good_earn_kop"] == 3 * 10000
    assert body["total_defect_earn_kop"] == 2 * 4000
    assert body["total_earn_kop"] == 3 * 10000 + 2 * 4000
    row = body["days"][0]["rows"][0]
    assert row["good_earn_kop"] == 30000
    assert row["defect_earn_kop"] == 8000

    # Кладовщик стоимость не видит.
    wh = warehouse_client.get(
        f"/shipments/packing/productivity?client_id={client_id}&date_from=2026-06-12&date_to=2026-06-12"
    )
    assert wh.status_code == 200, wh.text
    wbody = wh.json()
    assert wbody["with_earnings"] is False
    assert wbody["total_earn_kop"] == 0
    assert wbody["total_good"] == 3  # количества видны всем
