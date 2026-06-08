"""Интеграционные тесты балансов.

Балансы считаются из:
  - receipt_ops (op_type=receiving/defect_fix) для поступлений со статусом on_review или done
  - shipment_lines (shipment_docs.status=shipped) для отгрузок

Тесты вставляют данные напрямую в БД, минуя полный API,
чтобы контролировать точные суммы и избежать зависимости от UI-флоу приёмки.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


@pytest.fixture
def product_ids():
    """Создаёт тестовый продукт, возвращает (product_id, color_id, size_id)."""
    pid = str(uuid.uuid4())
    type_id = str(uuid.uuid4())
    color_id = str(uuid.uuid4())
    with get_connection() as conn:
        # Минимальный тип продукта
        conn.execute(
            """INSERT INTO product_types (id, name, is_active, is_deleted, created_at)
               VALUES (?, ?, 1, 0, NOW())""",
            (type_id, f"TestType-{type_id[:8]}"),
        )
        conn.execute(
            """INSERT INTO products (id, name, type_id, sku, is_active, is_deleted, created_at)
               VALUES (?, ?, ?, ?, 1, 0, NOW())""",
            (pid, f"TestProduct-{pid[:8]}", type_id, f"TST-{pid[:8]}"),
        )
        conn.commit()
    yield pid, color_id, None  # size_id = None
    with get_connection() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()


# ── helpers ───────────────────────────────────────────────────────────────────

def _insert_receipt(conn, client_id: str, status: str) -> str:
    """Вставляет receipt_docs, возвращает doc_id."""
    doc_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO receipt_docs
           (id, doc_number, client_id, status, is_deleted, created_at, created_by)
           VALUES (?, ?, ?, ?, 0, NOW(), 'test')""",
        (doc_id, f"WH-T-{doc_id}", client_id, status),
    )
    return doc_id


def _insert_receipt_line(conn, doc_id: str, product_id: str, color_id: str | None, size_id: str | None, planned_qty: int, accepted_qty: int | None = None) -> str:
    """Вставляет receipt_lines, возвращает line_id."""
    line_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO receipt_lines
           (id, doc_id, product_id, product_name, product_sku,
            color_id, color_name, size_id, size_name,
            planned_qty, accepted_qty, is_deleted, created_at, created_by)
           VALUES (?, ?, ?, 'Test Product', 'TST-SKU',
                   ?, 'Red', ?, NULL,
                   ?, ?, 0, NOW(), 'test')""",
        (line_id, doc_id, product_id, color_id, size_id, planned_qty, accepted_qty),
    )
    return line_id


def _insert_conversion(conn, client_id: str, product_ids, to_status: str, qty: int, zone_id: str | None = None) -> None:
    """QC-конвертация в журнале: on_review→good|defect (как при упаковке). Источник good/defect."""
    pid, color_id, size_id = product_ids
    conn.execute(
        """INSERT INTO zone_relocations
           (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
            client_id, from_status, to_status, from_zone_id, to_zone_id, qty, created_at)
           VALUES (?, ?, 'Test Product', 'TST-SKU', ?, 'Red', ?, NULL,
                   ?, 'on_review', ?, ?, ?, ?, NOW())""",
        (str(uuid.uuid4()), pid, color_id, size_id, client_id, to_status, zone_id, zone_id, qty),
    )


def _seed_received(conn, client_id: str, product_ids, accepted: int, zone_id: str | None = None) -> tuple[str, str]:
    """Принятое поступление (done): accepted_qty → остаток on_review в зоне."""
    pid, color_id, size_id = product_ids
    doc = _insert_receipt(conn, client_id, "done")
    line = _insert_receipt_line(conn, doc, pid, color_id, size_id, planned_qty=accepted, accepted_qty=accepted)
    if zone_id:
        conn.execute("UPDATE receipt_lines SET storage_zone_id = ? WHERE id = ?", (zone_id, line))
    return doc, line


def _seed_good(conn, client_id: str, product_ids, qty: int, zone_id: str | None = None) -> None:
    """Готовый годный остаток: приёмка accepted=qty + конвертация on_review→good."""
    _seed_received(conn, client_id, product_ids, qty, zone_id)
    _insert_conversion(conn, client_id, product_ids, "good", qty, zone_id)


def _insert_shipment(conn, client_id: str, cargo_type: str, status: str) -> str:
    """Вставляет shipment_docs, возвращает doc_id."""
    doc_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO shipment_docs
           (id, doc_number, cargo_type, client_id, client_name,
            status, is_deleted, created_at, created_by)
           VALUES (?, ?, ?, ?, 'Test Client', ?, 0, NOW(), 'test')""",
        (doc_id, f"SHP-T-{doc_id}", cargo_type, client_id, status),
    )
    return doc_id


def _insert_shipment_line(
    conn,
    doc_id: str,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    qty: int,
    shipped_qty: int = 0,
) -> None:
    conn.execute(
        """INSERT INTO shipment_lines
           (id, doc_id, product_id, product_name, product_sku,
            color_id, color_name, size_id, size_name,
            qty, shipped_qty, is_deleted, created_at)
           VALUES (?, ?, ?, 'Test Product', 'TST-SKU',
                   ?, 'Red', ?, NULL,
                   ?, ?, 0, NOW())""",
        (str(uuid.uuid4()), doc_id, product_id, color_id, size_id, qty, shipped_qty),
    )


def _insert_product_variant(conn, product_id: str, color_id: str | None, size_id: str | None) -> str:
    variant_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO product_variants
           (id, product_id, color_id, size_id, length, width, height, sku, images_json, is_active, created_at, is_deleted)
           VALUES (?, ?, ?, ?, 1, 1, 1, ?, '[]', 1, NOW(), 0)""",
        (variant_id, product_id, color_id, size_id, f"TST-V-{variant_id[:8]}"),
    )
    return variant_id


def _cleanup_test_docs(client_id: str) -> None:
    """Удаляет все тестовые документы для данного клиента."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)
        ).fetchall()
        for r in rows:
            conn.execute("DELETE FROM receipt_ops WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))

        rows = conn.execute(
            "SELECT id FROM shipment_docs WHERE client_id = ?", (client_id,)
        ).fetchall()
        for r in rows:
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
        conn.commit()


# ── tests ─────────────────────────────────────────────────────────────────────

def test_balance_increases_after_receipt_accepted(admin_client, client_id, product_ids):
    """Принятый товар попадает в остаток как on_review (good/defect появятся при упаковке)."""
    pid, _color_id, _size_id = product_ids
    qty = 42

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["on_review"] == qty
        assert matched[0]["good"] == 0
        assert matched[0]["defect"] == 0
    finally:
        _cleanup_test_docs(client_id)


def test_balance_includes_defect_qty(admin_client, client_id, product_ids):
    """Упаковка делит на годный/брак: конвертации on_review→good/defect."""
    pid, _color_id, _size_id = product_ids
    good_qty = 10
    defect_qty = 5

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, good_qty + defect_qty)
        _insert_conversion(conn, client_id, product_ids, "good", good_qty)
        _insert_conversion(conn, client_id, product_ids, "defect", defect_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["good"] == good_qty
        assert matched[0]["defect"] == defect_qty
        assert matched[0]["on_review"] == 0
    finally:
        _cleanup_test_docs(client_id)


def test_balance_decreases_after_shipment_shipped(admin_client, client_id, product_ids):
    """После отгрузки (status=shipped) годный остаток уменьшается."""
    pid, color_id, size_id = product_ids
    good_qty = 20
    shipped_qty = 8

    with get_connection() as conn:
        _seed_good(conn, client_id, product_ids, good_qty)
        s_doc = _insert_shipment(conn, client_id, "good", "shipped")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, shipped_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["good"] == good_qty - shipped_qty
    finally:
        _cleanup_test_docs(client_id)


def test_product_variant_stock_uses_actual_shipped_qty_like_balances(
    admin_client,
    client_id,
    product_ids,
):
    """Справочник товаров должен вычитать факт отгрузки, а не план."""
    pid, color_id, size_id = product_ids
    received_good_qty = 20
    received_defect_qty = 6
    planned_good_ship_qty = 8
    actual_good_ship_qty = 5
    planned_defect_ship_qty = 4
    actual_defect_ship_qty = 2
    variant_id = None

    with get_connection() as conn:
        variant_id = _insert_product_variant(conn, pid, color_id, size_id)
        _seed_received(conn, client_id, product_ids, received_good_qty + received_defect_qty)
        _insert_conversion(conn, client_id, product_ids, "good", received_good_qty)
        _insert_conversion(conn, client_id, product_ids, "defect", received_defect_qty)
        s_good_doc = _insert_shipment(conn, client_id, "good", "shipped")
        _insert_shipment_line(
            conn,
            s_good_doc,
            pid,
            color_id,
            size_id,
            planned_good_ship_qty,
            actual_good_ship_qty,
        )
        s_defect_doc = _insert_shipment(conn, client_id, "defect", "shipped")
        _insert_shipment_line(
            conn,
            s_defect_doc,
            pid,
            color_id,
            size_id,
            planned_defect_ship_qty,
            actual_defect_ship_qty,
        )
        conn.commit()

    try:
        balances = admin_client.get(f"/balances?client_id={client_id}")
        assert balances.status_code == 200, balances.text
        balance_items = [i for i in balances.json()["items"] if i["product_id"] == pid]
        assert balance_items

        variants = admin_client.get(f"/products/{pid}/variants")
        assert variants.status_code == 200, variants.text
        variant_items = [i for i in variants.json() if i["id"] == variant_id]
        assert variant_items

        expected_good = received_good_qty - actual_good_ship_qty
        expected_defect = received_defect_qty - actual_defect_ship_qty
        assert balance_items[0]["good"] == expected_good
        assert balance_items[0]["defect"] == expected_defect
        assert variant_items[0]["stock"] == expected_good
        assert variant_items[0]["defect_qty"] == expected_defect
        assert variant_items[0]["stock"] == balance_items[0]["good"]
        assert variant_items[0]["defect_qty"] == balance_items[0]["defect"]
    finally:
        with get_connection() as conn:
            if variant_id:
                conn.execute("DELETE FROM product_variants WHERE id = ?", (variant_id,))
                conn.commit()
        _cleanup_test_docs(client_id)


def test_balance_unchanged_for_packing_shipment(admin_client, client_id, product_ids):
    """Отгрузка в статусе packing (не shipped) не уменьшает баланс."""
    pid, color_id, size_id = product_ids
    good_qty = 15
    reserved_qty = 10  # в отгрузке, но ещё не отправлена

    with get_connection() as conn:
        _seed_good(conn, client_id, product_ids, good_qty)
        s_doc = _insert_shipment(conn, client_id, "good", "packing")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, reserved_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["good"] == good_qty  # packing не вычитается
    finally:
        _cleanup_test_docs(client_id)


def test_on_review_remainder_uses_accepted_qty(admin_client, client_id, product_ids):
    """Остаток «на проверке» = «Принят» минус разнесённый упаковкой good/defect."""
    pid, _color_id, _size_id = product_ids
    accepted_qty = 25  # фактически принято при прибытии
    good_qty = 10      # упаковано как годный

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, accepted_qty)
        _insert_conversion(conn, client_id, product_ids, "good", good_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, "Товар не найден в балансах"
        assert matched[0]["good"] == good_qty
        assert matched[0]["on_review"] == accepted_qty - good_qty  # 25 - 10 = 15
    finally:
        _cleanup_test_docs(client_id)


def test_balance_not_counted_for_draft_receipt(admin_client, client_id, product_ids):
    """Поступление в статусе draft/planned не попадает в балансы."""
    pid, color_id, size_id = product_ids

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "planned")
        _insert_receipt_line(conn, doc_id, pid, color_id, size_id, 50, accepted_qty=50)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matched = [i for i in items if i["product_id"] == pid]
        # Товар не должен появляться в балансах, пока поступление не принято
        assert not matched, f"Товар {pid} неожиданно найден в балансах при статусе planned: {matched}"
    finally:
        _cleanup_test_docs(client_id)


# ── zone relocations (вариант B) ───────────────────────────────────────────────

def _zone_good(items, location_id) -> int:
    return sum(i["qty"] for i in items if i["status"] == "good" and i["location_id"] == location_id)


def _seed_good_in_zone(conn, client_id, product_ids, zone_id, qty) -> None:
    _seed_good(conn, client_id, product_ids, qty, zone_id)
    conn.commit()


def test_relocation_moves_good_between_zones(admin_client, client_id, product_ids):
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 10)
    try:
        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_good(items, zone_a) == 10

        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "status": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 4,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_good(items, zone_a) == 6
        assert _zone_good(items, zone_b) == 4
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_appears_in_journal(admin_client, client_id, product_ids):
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 8)
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "product_name": "Test Product", "product_sku": "TST-SKU",
            "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "status": "good", "from_zone_id": zone_a, "to_zone_id": zone_b,
            "qty": 3, "comment": "перенос",
        })
        assert r.status_code == 200, r.text

        j = admin_client.get(f"/balances/relocations?client_id={client_id}")
        assert j.status_code == 200, j.text
        data = j.json()
        assert data["total"] >= 1
        mine = [i for i in data["items"] if i["product_name"] == "Test Product" and i["qty"] == 3]
        assert mine, data["items"]
        assert mine[0]["status"] == "good"
        assert mine[0]["comment"] == "перенос"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_over_available_returns_400(admin_client, client_id, product_ids):
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 5)
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "status": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 100,
        })
        assert r.status_code == 400, r.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_moves_on_review_between_zones(admin_client, client_id, product_ids):
    """#1: товар «на проверке» можно перемещать между местами хранения."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, accepted=12, zone_id=zone_a)
        conn.commit()
    try:
        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert sum(i["qty"] for i in items if i["status"] == "on_review" and i["location_id"] == zone_a) == 12

        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "status": "on_review", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 5,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        rev = lambda z: sum(i["qty"] for i in items if i["status"] == "on_review" and i["location_id"] == z)
        assert rev(zone_a) == 7 and rev(zone_b) == 5
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_requires_source_zone(admin_client, client_id, product_ids):
    """#3: перемещение без указания источника отклоняется."""
    pid, color_id, size_id = product_ids
    zone_b = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good(conn, client_id, product_ids, 5)
        conn.commit()
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "status": "good", "from_zone_id": None, "to_zone_id": zone_b, "qty": 3,
        })
        assert r.status_code == 400, r.text
        assert "откуда" in r.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)
