"""Интеграционные тесты балансов (модель на двух осях).

Балансы считаются из:
  - receipt_lines.accepted_qty (receipt_docs.status=done) — приход «На хранении / Годный»
  - zone_relocations — все движения: смена качества, передача на упаковку,
    упаковка (→ ready), списание (→ shipped)

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
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    shift_supervisor_client,
)


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


def _insert_move(
    conn, client_id: str, product_ids, qty: int,
    *, from_op: str, to_op: str, from_quality: str, to_quality: str,
    from_zone_id: str | None = None, to_zone_id: str | None = None,
    product_sku: str = "TST-SKU", shipment_line_id: str | None = None,
) -> None:
    """Произвольное движение в журнале (две оси статуса)."""
    pid, color_id, size_id = product_ids
    conn.execute(
        """INSERT INTO zone_relocations
           (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
            client_id, from_op, to_op, from_quality, to_quality, from_zone_id, to_zone_id, qty,
            shipment_line_id, created_at)
           VALUES (?, ?, 'Test Product', ?, ?, 'Red', ?, NULL,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())""",
        (str(uuid.uuid4()), pid, product_sku, color_id, size_id, client_id,
         from_op, to_op, from_quality, to_quality, from_zone_id, to_zone_id, qty,
         shipment_line_id),
    )


def _insert_quality_change(conn, client_id: str, product_ids, to_quality: str, qty: int, zone_id: str | None = None) -> None:
    """Смена качества на хранении (storage, good→defect или обратно)."""
    from_quality = "good" if to_quality == "defect" else "defect"
    _insert_move(
        conn, client_id, product_ids, qty,
        from_op="storage", to_op="storage",
        from_quality=from_quality, to_quality=to_quality,
        from_zone_id=zone_id, to_zone_id=zone_id,
    )


def _insert_ship_consume(conn, client_id: str, product_ids, quality: str, qty: int, zone_id: str | None = None, *, from_op: str = "storage") -> None:
    """Журнальное списание при отправке рейса: (from_op, quality) → shipped."""
    _insert_move(
        conn, client_id, product_ids, qty,
        from_op=from_op, to_op="shipped",
        from_quality=quality, to_quality=quality,
        from_zone_id=zone_id, to_zone_id=None,
    )


def _seed_received(conn, client_id: str, product_ids, accepted: int, zone_id: str | None = None) -> tuple[str, str]:
    """Принятое поступление (done) + intake-движение журнала, как пишет /arrive.

    Остаток «На хранении / Годный» встаёт из журнала (intake → storage),
    accepted_qty — документный факт приёмки.
    """
    pid, color_id, size_id = product_ids
    doc = _insert_receipt(conn, client_id, "done")
    line = _insert_receipt_line(conn, doc, pid, color_id, size_id, planned_qty=accepted, accepted_qty=accepted)
    if zone_id:
        conn.execute("UPDATE receipt_lines SET storage_zone_id = ? WHERE id = ?", (zone_id, line))
    _insert_move(
        conn, client_id, product_ids, accepted,
        from_op="intake", to_op="storage", from_quality="good", to_quality="good",
        from_zone_id=zone_id, to_zone_id=zone_id,
    )
    return doc, line


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
    """Принятый товар встаёт на остатки «На хранении / Годный»."""
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
        assert matched[0]["storage_good"] == qty
        assert matched[0]["storage_defect"] == 0
        assert matched[0]["packing_good"] == 0
        assert matched[0]["ready_good"] == 0
    finally:
        _cleanup_test_docs(client_id)


def test_balance_no_duplicate_on_mixed_product_sku(admin_client, client_id, product_ids):
    """Один product_id с разными product_sku в истории = одна строка остатка.

    Регрессия: до бэкфилла SKU (0072) приёмка «ожидает SKU» писала пустой
    product_sku, а поздние журнальные движения — реальный. Позиционный агрегат
    группировал по product_sku и разбивал одну позицию на две строки с
    одинаковыми количествами (оба джойнились к одному журнальному нетто)."""
    pid, color_id, size_id = product_ids
    qty = 30

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, qty)
        # Журнальное движение того же product_id с ДРУГИМ product_sku
        # (нетто не меняет: storage→storage в пределах одного места).
        _insert_move(
            conn, client_id, product_ids, 5,
            from_op="storage", to_op="storage", from_quality="good", to_quality="good",
            product_sku="OZN-ALT-SKU",
        )
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert len(matched) == 1, f"Ожидалась одна строка, получено {len(matched)}: {matched}"
        assert matched[0]["storage_good"] == qty
        assert matched[0]["total"] == qty

        s = admin_client.get(f"/balances/summary?client_id={client_id}")
        assert s.status_code == 200, s.text
        assert s.json()["total"] == qty  # итог не задвоен
    finally:
        _cleanup_test_docs(client_id)


def test_balance_includes_defect_qty(admin_client, client_id, product_ids):
    """Смена качества переводит часть остатка в брак на хранении."""
    pid, _color_id, _size_id = product_ids
    good_qty = 10
    defect_qty = 5

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, good_qty + defect_qty)
        _insert_quality_change(conn, client_id, product_ids, "defect", defect_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["storage_good"] == good_qty
        assert matched[0]["storage_defect"] == defect_qty
    finally:
        _cleanup_test_docs(client_id)


def test_balance_decreases_after_ship_consume(admin_client, client_id, product_ids):
    """Журнальное списание (… → shipped) уменьшает остаток."""
    pid, _color_id, _size_id = product_ids
    good_qty = 20
    shipped_qty = 8

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, good_qty)
        _insert_ship_consume(conn, client_id, product_ids, "good", shipped_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["storage_good"] == good_qty - shipped_qty
    finally:
        _cleanup_test_docs(client_id)


def test_product_variant_stock_matches_balances(
    admin_client,
    client_id,
    product_ids,
):
    """Справочник товаров считает остаток так же, как балансы (журнальное списание)."""
    pid, color_id, size_id = product_ids
    received_qty = 26
    defect_qty = 6           # переведено в брак
    shipped_good_qty = 5     # списано годного
    shipped_defect_qty = 2   # списано брака
    variant_id = None

    with get_connection() as conn:
        variant_id = _insert_product_variant(conn, pid, color_id, size_id)
        _seed_received(conn, client_id, product_ids, received_qty)
        _insert_quality_change(conn, client_id, product_ids, "defect", defect_qty)
        _insert_ship_consume(conn, client_id, product_ids, "good", shipped_good_qty)
        _insert_ship_consume(conn, client_id, product_ids, "defect", shipped_defect_qty)
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

        expected_good = received_qty - defect_qty - shipped_good_qty   # 15
        expected_defect = defect_qty - shipped_defect_qty              # 4
        assert balance_items[0]["storage_good"] == expected_good
        assert balance_items[0]["storage_defect"] == expected_defect
        assert variant_items[0]["stock"] == expected_good
        assert variant_items[0]["defect_qty"] == expected_defect
    finally:
        with get_connection() as conn:
            if variant_id:
                conn.execute("DELETE FROM product_variants WHERE id = ?", (variant_id,))
                conn.commit()
        _cleanup_test_docs(client_id)


def test_balance_unchanged_for_packing_shipment(admin_client, client_id, product_ids):
    """Отгрузка в статусе packing (без журнальных движений) не уменьшает баланс."""
    pid, color_id, size_id = product_ids
    good_qty = 15
    reserved_qty = 10  # в отгрузке, но ещё не отправлена

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, good_qty)
        s_doc = _insert_shipment(conn, client_id, "good", "packing")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, reserved_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["storage_good"] == good_qty  # packing не вычитается
    finally:
        _cleanup_test_docs(client_id)


def test_storage_remainder_after_move_to_packing(admin_client, client_id, product_ids):
    """Передача на упаковку уменьшает «На хранении» и увеличивает «На упаковке»."""
    pid, _color_id, _size_id = product_ids
    accepted_qty = 25  # фактически принято при прибытии
    moved_qty = 10     # передано на упаковку

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, accepted_qty)
        _insert_move(
            conn, client_id, product_ids, moved_qty,
            from_op="storage", to_op="packing", from_quality="good", to_quality="good",
        )
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, "Товар не найден в балансах"
        assert matched[0]["storage_good"] == accepted_qty - moved_qty  # 25 - 10 = 15
        assert matched[0]["packing_good"] == moved_qty
    finally:
        _cleanup_test_docs(client_id)


def test_unfinished_receipt_not_in_balances(admin_client, client_id, product_ids):
    """Незавершённая приёмка не попадает в остатки.

    Остаток чисто журнальный: пока приёмка не проведена (нет движения
    intake → storage), товар в выдаче остатков не появляется."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    qty = 17

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "partially_received")
        line_id = _insert_receipt_line(conn, doc_id, pid, color_id, size_id, planned_qty=qty, accepted_qty=qty)
        conn.execute("UPDATE receipt_lines SET storage_zone_id = ? WHERE id = ?", (zone, line_id))
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched == [], "Незавершённая приёмка не должна быть в остатках"

        z = admin_client.get(f"/balances/zones?client_id={client_id}")
        assert z.status_code == 200, z.text
        z_data = z.json()
        assert z_data["truncated"] is False
        assert _zone_bucket(z_data["items"], zone, "storage", "good") == 0

        s = admin_client.get(f"/balances/summary?client_id={client_id}")
        assert s.status_code == 200, s.text
        assert "intake" not in s.json()
        assert s.json()["total"] == 0
    finally:
        _cleanup_test_docs(client_id)


def test_balances_summary_matches_buckets(admin_client, client_id, product_ids):
    """Summary агрегирует все корзины и фильтруется по has_defect."""
    received = 30
    defect = 6
    to_packing = 10

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, received)
        _insert_quality_change(conn, client_id, product_ids, "defect", defect)
        _insert_move(
            conn, client_id, product_ids, to_packing,
            from_op="storage", to_op="packing", from_quality="good", to_quality="good",
        )
        conn.commit()

    try:
        s = admin_client.get(f"/balances/summary?client_id={client_id}")
        assert s.status_code == 200, s.text
        data = s.json()
        assert data["storage_good"] == received - defect - to_packing
        assert data["storage_defect"] == defect
        assert data["packing_good"] == to_packing
        assert data["total"] == received

        sd = admin_client.get(f"/balances/summary?client_id={client_id}&has_defect=true")
        assert sd.status_code == 200, sd.text
        assert sd.json()["storage_defect"] == defect
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


def test_shift_supervisor_can_read_zone_balances(shift_supervisor_client, client_id, product_ids):
    """Начальник смены читает остатки по местам (флоу упаковки), не получает 403."""
    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, 7)
        conn.commit()

    try:
        r = shift_supervisor_client.get(f"/balances/zones?client_id={client_id}")
        assert r.status_code == 200, r.text
        r2 = shift_supervisor_client.get(f"/balances?client_id={client_id}")
        assert r2.status_code == 200, r2.text
    finally:
        _cleanup_test_docs(client_id)


# ── zone relocations / quality changes ────────────────────────────────────────

def _zone_bucket(items, location_id, op_status: str = "storage", quality: str = "good") -> int:
    return sum(
        i["qty"] for i in items
        if i["op_status"] == op_status and i["quality"] == quality and i["location_id"] == location_id
    )


def _seed_good_in_zone(conn, client_id, product_ids, zone_id, qty) -> None:
    _seed_received(conn, client_id, product_ids, qty, zone_id)
    conn.commit()


def test_relocation_moves_good_between_zones(admin_client, client_id, product_ids):
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 10)
    try:
        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone_a) == 10

        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 4,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone_a) == 6
        assert _zone_bucket(items, zone_b) == 4
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
            "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b,
            "qty": 3, "comment": "перенос",
        })
        assert r.status_code == 200, r.text

        j = admin_client.get(f"/balances/relocations?client_id={client_id}")
        assert j.status_code == 200, j.text
        data = j.json()
        assert data["total"] >= 1
        mine = [i for i in data["items"] if i["product_name"] == "Test Product" and i["qty"] == 3]
        assert mine, data["items"]
        assert mine[0]["from_op"] == "storage" and mine[0]["to_op"] == "storage"
        assert mine[0]["from_quality"] == "good" and mine[0]["to_quality"] == "good"
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
            "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 100,
        })
        assert r.status_code == 400, r.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_requires_source_zone(admin_client, client_id, product_ids):
    """Перемещение без указания источника отклоняется."""
    pid, color_id, size_id = product_ids
    zone_b = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, 5)
        conn.commit()
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "quality": "good", "from_zone_id": None, "to_zone_id": zone_b, "qty": 3,
        })
        assert r.status_code == 400, r.text
        assert "откуда" in r.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_write_off_reduces_storage(admin_client, client_id, product_ids):
    """Списание уводит товар с остатков: (storage, good)@место → written_off."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
    try:
        r = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "good", "qty": 4, "reason": "damage",
            "comment": "повреждено при хранении",
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "good") == 6

        b = admin_client.get(f"/balances?client_id={client_id}").json()["items"]
        assert b and b[0]["storage_good"] == 6 and b[0]["total"] == 6

        j = admin_client.get(f"/balances/relocations?client_id={client_id}").json()
        mine = [i for i in j["items"] if i["to_op"] == "written_off"]
        assert mine, j["items"]
        assert mine[0]["from_op"] == "storage" and mine[0]["qty"] == 4
        assert mine[0]["reason"] == "damage"
        assert mine[0]["comment"] == "повреждено при хранении"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_undo_write_off_restores_storage(admin_client, client_id, product_ids):
    """Откат ошибочного списания возвращает товар в исходный бакет/место; повтор запрещён."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
    try:
        w = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "good", "qty": 4, "reason": "damage",
        })
        assert w.status_code == 200, w.text

        j = admin_client.get(f"/balances/relocations?client_id={client_id}").json()
        woff = next(i for i in j["items"] if i["to_op"] == "written_off")
        assert woff["is_reversed"] is False

        r = admin_client.post(f"/balances/write-offs/{woff['id']}/undo")
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "good") == 10

        j2 = admin_client.get(f"/balances/relocations?client_id={client_id}").json()
        again = next(i for i in j2["items"] if i["id"] == woff["id"])
        assert again["is_reversed"] is True
        assert any(i["from_op"] == "written_off" and i["reverses_id"] == woff["id"] for i in j2["items"])

        dup = admin_client.post(f"/balances/write-offs/{woff['id']}/undo")
        assert dup.status_code == 400, dup.text
        assert "уже отменено" in dup.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_undo_rejects_non_write_off_move(admin_client, client_id, product_ids):
    """Откатить можно только списание — обычное перемещение отклоняется."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 5)
    try:
        admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "storage", "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 2,
        })
        j = admin_client.get(f"/balances/relocations?client_id={client_id}").json()
        move = next(i for i in j["items"] if i["from_op"] == "storage" and i["to_op"] == "storage")
        r = admin_client.post(f"/balances/write-offs/{move['id']}/undo")
        assert r.status_code == 400, r.text
        assert "списания" in r.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_write_off_over_available_returns_400(admin_client, client_id, product_ids):
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 5)
    try:
        r = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "good", "qty": 100, "reason": "shortage",
        })
        assert r.status_code == 400, r.text
        assert "Недостаточно" in r.json()["detail"]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_write_off_other_requires_comment(admin_client, client_id, product_ids):
    """Причина «Прочее» без комментария отклоняется; недопустимая причина — 422."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 5)
    try:
        r = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "good", "qty": 1, "reason": "other",
        })
        assert r.status_code == 400, r.text
        assert "комментарий" in r.json()["detail"]

        bad = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "good", "qty": 1, "reason": "no_such_reason",
        })
        assert bad.status_code == 422, bad.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_write_off_defect_bucket(admin_client, client_id, product_ids):
    """Списание брака (утилизация) уменьшает storage/defect."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
        _insert_quality_change(conn, client_id, product_ids, "defect", 6, zone)
        conn.commit()
    try:
        r = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "quality": "defect", "qty": 6, "reason": "disposal",
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "defect") == 0
        assert _zone_bucket(items, zone, "storage", "good") == 4
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_quality_change_defect_to_good(admin_client, client_id, product_ids):
    """Исправление брака: Брак → Годный в пределах места, с проверкой остатка."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, 10, zone)
        _insert_quality_change(conn, client_id, product_ids, "defect", 4, zone)
        conn.commit()
    try:
        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "defect") == 4

        r = admin_client.post("/balances/quality-changes", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "from_quality": "defect", "to_quality": "good", "qty": 3,
            "comment": "исправлено",
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "defect") == 1
        assert _zone_bucket(items, zone, "storage", "good") == 9

        # Больше доступного — 400.
        over = admin_client.post("/balances/quality-changes", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone, "from_quality": "defect", "to_quality": "good", "qty": 100,
        })
        assert over.status_code == 400, over.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


# ── ручные операции из любого операционного статуса ──────────────────────────

def test_relocation_from_packing_inherits_attribution(admin_client, client_id, product_ids):
    """Товар «На упаковке» перемещается по ячейкам: пул строки не меняется,
    атрибуция к строке задачи упаковки наследуется журнальной записью."""
    pid, color_id, size_id = product_ids
    zone_a, packing_zone, zone_b = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, 10, zone_a)
        s_doc = _insert_shipment(conn, client_id, "good", "on_packing")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, 10)
        line_id = conn.execute(
            "SELECT id FROM shipment_lines WHERE doc_id = ?", (s_doc,)
        ).fetchone()["id"]
        _insert_move(
            conn, client_id, product_ids, 10,
            from_op="storage", to_op="packing", from_quality="good", to_quality="good",
            from_zone_id=zone_a, to_zone_id=packing_zone, shipment_line_id=str(line_id),
        )
        conn.commit()
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "packing", "quality": "good",
            "from_zone_id": packing_zone, "to_zone_id": zone_b, "qty": 4,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, packing_zone, "packing", "good") == 6
        assert _zone_bucket(items, zone_b, "packing", "good") == 4

        with get_connection() as conn:
            move = conn.execute(
                "SELECT shipment_line_id FROM zone_relocations "
                "WHERE product_id = ? AND from_zone_id = ? AND to_zone_id = ?",
                (pid, packing_zone, zone_b),
            ).fetchone()
            assert move and str(move["shipment_line_id"]) == str(line_id)
            # Пул строки на упаковке не изменился — перемещение нейтрально для процесса.
            from modules.shipments.service import line_on_packing_qty
            assert line_on_packing_qty(conn, str(line_id)) == 10
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_ready_splits_by_attribution_fifo(admin_client, client_id, product_ids):
    """Перемещение «Готов к отгрузке» дробится FIFO по строкам-источникам."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        s_doc = _insert_shipment(conn, client_id, "good", "packed")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, 3)
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, 2)
        lines = [str(r["id"]) for r in conn.execute(
            "SELECT id FROM shipment_lines WHERE doc_id = ? ORDER BY qty DESC", (s_doc,)
        ).fetchall()]
        _insert_move(conn, client_id, product_ids, 3,
                     from_op="packed", to_op="ready", from_quality="good", to_quality="good",
                     from_zone_id=None, to_zone_id=zone_a, shipment_line_id=lines[0])
        _insert_move(conn, client_id, product_ids, 2,
                     from_op="packed", to_op="ready", from_quality="good", to_quality="good",
                     from_zone_id=None, to_zone_id=zone_a, shipment_line_id=lines[1])
        conn.commit()
    try:
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "ready", "quality": "good",
            "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 4,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone_a, "ready", "good") == 1
        assert _zone_bucket(items, zone_b, "ready", "good") == 4

        with get_connection() as conn:
            moves = conn.execute(
                "SELECT shipment_line_id, qty FROM zone_relocations "
                "WHERE product_id = ? AND from_zone_id = ? AND to_zone_id = ? ORDER BY qty DESC",
                (pid, zone_a, zone_b),
            ).fetchall()
            # FIFO по убыванию нетто: 3 из большей строки + 1 из меньшей.
            assert [(str(m["shipment_line_id"]), int(m["qty"])) for m in moves] == [
                (lines[0], 3), (lines[1], 1),
            ]
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_quality_change_from_ready_moves_defect_to_storage(admin_client, client_id, product_ids):
    """Перевод в брак из «Готов к отгрузке»: товар выбывает в storage/defect в том же месте."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        _insert_move(conn, client_id, product_ids, 5,
                     from_op="packed", to_op="ready", from_quality="good", to_quality="good",
                     from_zone_id=None, to_zone_id=zone)
        conn.commit()
    try:
        r = admin_client.post("/balances/quality-changes", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "ready", "zone_id": zone, "from_quality": "good", "to_quality": "defect", "qty": 2,
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "ready", "good") == 3
        assert _zone_bucket(items, zone, "storage", "defect") == 2

        # Обратный перевод (брак → годный) вне «На хранении» запрещён.
        back = admin_client.post("/balances/quality-changes", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "ready", "zone_id": zone, "from_quality": "defect", "to_quality": "good", "qty": 1,
        })
        assert back.status_code == 400, back.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_write_off_from_packed_bucket(admin_client, client_id, product_ids):
    """Списание из «Упаковано» уменьшает бакет и уменьшает pending строки упаковки."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    with get_connection() as conn:
        s_doc = _insert_shipment(conn, client_id, "good", "on_packing")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, 6)
        line_id = str(conn.execute(
            "SELECT id FROM shipment_lines WHERE doc_id = ?", (s_doc,)
        ).fetchone()["id"])
        _insert_move(conn, client_id, product_ids, 6,
                     from_op="packing", to_op="packed", from_quality="good", to_quality="good",
                     from_zone_id=zone, to_zone_id=zone, shipment_line_id=line_id)
        conn.commit()
    try:
        r = admin_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": "packed", "zone_id": zone, "quality": "good", "qty": 2, "reason": "damage",
        })
        assert r.status_code == 200, r.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "packed", "good") == 4

        with get_connection() as conn:
            move = conn.execute(
                "SELECT shipment_line_id, from_op, to_op FROM zone_relocations "
                "WHERE product_id = ? AND to_op = 'written_off'", (pid,),
            ).fetchone()
            assert move and str(move["shipment_line_id"]) == line_id
            assert str(move["from_op"]) == "packed"
            from modules.shipments.service import line_packed_pending
            assert line_packed_pending(conn, line_id)["good"] == 4
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_relocation_rejects_terminal_and_intake_ops(admin_client, client_id, product_ids):
    """intake и терминальные стоки не перемещаются (422 от валидации схемы)."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    for op in ("intake", "shipped", "written_off"):
        r = admin_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "op": op, "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 1,
        })
        assert r.status_code == 422, f"{op}: {r.text}"


def test_shift_supervisor_can_do_stock_operations(shift_supervisor_client, client_id, product_ids):
    """Начальник смены выполняет перемещение/перевод в брак/списание (раньше — 403)."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 9)
    try:
        r = shift_supervisor_client.post("/balances/relocations", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "quality": "good", "from_zone_id": zone_a, "to_zone_id": zone_b, "qty": 3,
        })
        assert r.status_code == 200, r.text

        q = shift_supervisor_client.post("/balances/quality-changes", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone_a, "from_quality": "good", "to_quality": "defect", "qty": 2,
        })
        assert q.status_code == 200, q.text

        w = shift_supervisor_client.post("/balances/write-offs", json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "zone_id": zone_a, "quality": "good", "qty": 1, "reason": "shortage",
        })
        assert w.status_code == 200, w.text

        j = shift_supervisor_client.get(f"/balances/relocations?client_id={client_id}")
        assert j.status_code == 200, j.text
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_balances_zone_location_filter(admin_client, client_id, product_ids):
    """Адресное хранение: фильтр /balances/zones?location= по части кода ячейки."""
    pid, _color_id, _size_id = product_ids
    room = f"T{uuid.uuid4().hex[:4]}"
    cell = admin_client.post("/locations", json={"room": room, "rack": "А", "section": 1, "floor": 1})
    assert cell.status_code == 200, cell.text
    cell = cell.json()
    with get_connection() as conn:
        _insert_move(
            conn, client_id, product_ids, 7,
            from_op="intake", to_op="storage", from_quality="good", to_quality="good",
            from_zone_id=None, to_zone_id=cell["id"],
        )
        conn.commit()
    try:
        # часть кода адреса находит ячейку
        items = admin_client.get(f"/balances/zones?client_id={client_id}&location={room}").json()["items"]
        assert any(it["location_id"] == cell["id"] and it["location_name"] == cell["code"] for it in items)

        # непопадающий фильтр исключает её
        items2 = admin_client.get(f"/balances/zones?client_id={client_id}&location=ZZZNOPE").json()["items"]
        assert all(it["location_id"] != cell["id"] for it in items2)
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.execute("DELETE FROM unloading_zones WHERE id = ?", (cell["id"],))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_balances_zone_pagination_by_location(admin_client, client_id, product_ids):
    """Серверная пагинация: страница = N местоположений, total = число мест."""
    pid, _color_id, _size_id = product_ids
    room = f"T{uuid.uuid4().hex[:4]}"
    cell_ids: list[str] = []
    for rack in ("А", "Б", "В"):
        c = admin_client.post("/locations", json={"room": room, "rack": rack, "section": 1, "floor": 1})
        assert c.status_code == 200, c.text
        cell_ids.append(c.json()["id"])
    with get_connection() as conn:
        for cid in cell_ids:
            _insert_move(
                conn, client_id, product_ids, 5,
                from_op="intake", to_op="storage", from_quality="good", to_quality="good",
                from_zone_id=None, to_zone_id=cid,
            )
        conn.commit()
    try:
        p1 = admin_client.get(f"/balances/zones?client_id={client_id}&location={room}&page=1&limit=2").json()
        assert p1["total"] == 3 and p1["page"] == 1 and p1["limit"] == 2
        assert p1["truncated"] is False
        locs1 = {it["location_id"] for it in p1["items"]}
        assert len(locs1) == 2

        p2 = admin_client.get(f"/balances/zones?client_id={client_id}&location={room}&page=2&limit=2").json()
        assert p2["total"] == 3
        locs2 = {it["location_id"] for it in p2["items"]}
        assert len(locs2) == 1
        # страницы не пересекаются — каждое место ровно на одной странице
        assert not (locs1 & locs2)
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
            conn.execute("DELETE FROM unloading_zones WHERE room = ?", (room.upper(),))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_balances_and_plannable_show_live_dictionary_names(admin_client, client_id, product_ids):
    """Переименование товара/цвета в справочнике сразу видно в остатках и подборе.

    Снимки имён в журнале остаются как были — живое имя приходит джойном
    справочника, снимок — только фолбэк для удалённых записей."""
    pid, color_id, _size_id = product_ids
    new_name = f"Живое имя {pid[:8]}"

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO colors (id, name, is_active, is_deleted, created_at) VALUES (?, 'Старый цвет', 1, 0, NOW())",
            (color_id,),
        )
        _seed_received(conn, client_id, product_ids, 5)
        conn.commit()

    try:
        with get_connection() as conn:
            conn.execute("UPDATE products SET name = ? WHERE id = ?", (new_name, pid))
            conn.execute("UPDATE colors SET name = 'Новый цвет' WHERE id = ?", (color_id,))
            conn.commit()

        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        item = next(i for i in r.json()["items"] if i["product_id"] == pid)
        assert item["product_name"] == new_name
        assert item["color_name"] == "Новый цвет"

        p = admin_client.get(f"/balances/plannable?client_id={client_id}")
        assert p.status_code == 200, p.text
        pit = next(i for i in p.json()["items"] if i["product_id"] == pid)
        assert pit["product_name"] == new_name
        assert pit["color_name"] == "Новый цвет"
        assert pit["storage_good"] == 5

        z = admin_client.get(f"/balances/zones?client_id={client_id}")
        assert z.status_code == 200, z.text
        zit = next(i for i in z.json()["items"] if i["product_id"] == pid)
        assert zit["product_name"] == new_name
        assert zit["color_name"] == "Новый цвет"

        # Поиск находит позицию и по новому имени из справочника.
        s = admin_client.get(f"/balances?client_id={client_id}&search={new_name}")
        assert any(i["product_id"] == pid for i in s.json()["items"])
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM colors WHERE id = ?", (color_id,))
            conn.commit()
        _cleanup_test_docs(client_id)


def test_plannable_shows_position_left_only_on_packing(admin_client, client_id, product_ids):
    """Остаток целиком на упаковке всё равно доступен для подбора отгрузки.

    Отгрузка такой позиции паркуется в «Ожидание упаковки» и продолжается по
    готовности, поэтому пикер обязан её показывать — иначе документ нельзя собрать."""
    pid, _color_id, _size_id = product_ids
    qty = 20

    with get_connection() as conn:
        _seed_received(conn, client_id, product_ids, qty)
        _insert_move(
            conn, client_id, product_ids, qty,
            from_op="storage", to_op="packing", from_quality="good", to_quality="good",
        )
        conn.commit()

    try:
        p = admin_client.get(f"/balances/plannable?client_id={client_id}")
        assert p.status_code == 200, p.text
        matched = [i for i in p.json()["items"] if i["product_id"] == pid]
        assert matched, "Позиция с остатком только на упаковке пропала из подбора"
        assert matched[0]["storage_good"] == 0
        assert matched[0]["packing_good"] == qty

        # Для брака корзина `packing` (годная) источником не является.
        d = admin_client.get(f"/balances/plannable?client_id={client_id}&cargo_type=defect")
        assert d.status_code == 200, d.text
        assert [i for i in d.json()["items"] if i["product_id"] == pid] == []
    finally:
        _cleanup_test_docs(client_id)


# ── grouped: группировка по артикулу × клиенту ────────────────────────────────

def test_balances_grouped_variants_and_size_order(admin_client, client_id, product_ids):
    """Варианты артикула собираются в одну группу; размеры — по sort_order справочника.

    Имена размеров подобраны так, что алфавитный порядок (M, S, XS) отличается от
    порядка сетки (XS, S, M): регрессия на сортировку по имени вместо sort_order."""
    pid, color_id, _size_id = product_ids
    size_xs, size_s, size_m = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    with get_connection() as conn:
        for sid, name, so in ((size_xs, "XS", 10), (size_s, "S", 20), (size_m, "M", 30)):
            conn.execute(
                "INSERT INTO sizes (id, name, is_active, sort_order, created_at) VALUES (?, ?, 1, ?, NOW())",
                (sid, f"{name}-{sid[:8]}", so),
            )
        _seed_received(conn, client_id, (pid, color_id, size_m), 30)
        _seed_received(conn, client_id, (pid, color_id, size_s), 20)
        _seed_received(conn, client_id, (pid, color_id, size_xs), 10)
        conn.commit()

    try:
        r = admin_client.get(f"/balances/grouped?client_id={client_id}")
        assert r.status_code == 200, r.text
        groups = [g for g in r.json()["items"] if g["product_id"] == pid]
        assert len(groups) == 1, f"Ожидалась одна группа, получено {len(groups)}"
        g = groups[0]
        assert g["variants_count"] == 3
        assert g["colors_count"] == 1
        assert g["sizes_count"] == 3
        assert g["storage_good"] == 60
        assert g["total"] == 60
        assert sum(i["total"] for i in g["items"]) == g["total"]
        assert [i["size_id"] for i in g["items"]] == [size_xs, size_s, size_m]
    finally:
        _cleanup_test_docs(client_id)
        with get_connection() as conn:
            conn.execute("DELETE FROM sizes WHERE id IN (?, ?, ?)", (size_xs, size_s, size_m))
            conn.commit()


def test_balances_grouped_pagination_by_groups(admin_client, client_id, product_ids):
    """Страница режется по группам: артикул не рвётся, total — число групп."""
    pid, color_id, _size_id = product_ids
    pid2 = str(uuid.uuid4())

    with get_connection() as conn:
        type_row = conn.execute("SELECT type_id FROM products WHERE id = ?", (pid,)).fetchone()
        conn.execute(
            """INSERT INTO products (id, name, type_id, sku, is_active, is_deleted, created_at)
               VALUES (?, ?, ?, ?, 1, 0, NOW())""",
            (pid2, f"TestProduct2-{pid2[:8]}", type_row["type_id"], f"TST2-{pid2[:8]}"),
        )
        # Первый артикул крупнее (две позиции), второй меньше — порядок групп по остатку.
        _seed_received(conn, client_id, (pid, color_id, None), 30)
        _seed_received(conn, client_id, (pid, str(uuid.uuid4()), None), 20)
        _seed_received(conn, client_id, (pid2, color_id, None), 10)
        conn.commit()

    try:
        r1 = admin_client.get(f"/balances/grouped?client_id={client_id}&limit=1&page=1")
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["total"] == 2
        assert len(d1["items"]) == 1
        assert d1["items"][0]["product_id"] == pid
        assert d1["items"][0]["variants_count"] == 2
        assert d1["items"][0]["total"] == 50

        r2 = admin_client.get(f"/balances/grouped?client_id={client_id}&limit=1&page=2")
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert len(d2["items"]) == 1
        assert d2["items"][0]["product_id"] == pid2
        assert d2["items"][0]["total"] == 10
    finally:
        _cleanup_test_docs(client_id)
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id = ?", (pid2,))
            conn.commit()
