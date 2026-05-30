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


def _insert_receiving_op(conn, doc_id: str, line_id: str, qty: int) -> None:
    """Вставляет receipt_ops с op_type=receiving."""
    conn.execute(
        """INSERT INTO receipt_ops
           (id, doc_id, line_id, op_type, qty, created_at, created_by)
           VALUES (?, ?, ?, 'receiving', ?, NOW(), 'test')""",
        (str(uuid.uuid4()), doc_id, line_id, qty),
    )


def _insert_defect_op(conn, doc_id: str, line_id: str, qty: int) -> None:
    """Вставляет receipt_ops с op_type=defect_fix."""
    conn.execute(
        """INSERT INTO receipt_ops
           (id, doc_id, line_id, op_type, qty, created_at, created_by)
           VALUES (?, ?, ?, 'defect_fix', ?, NOW(), 'test')""",
        (str(uuid.uuid4()), doc_id, line_id, qty),
    )


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


def _insert_shipment_line(conn, doc_id: str, product_id: str, color_id: str | None, size_id: str | None, qty: int) -> None:
    conn.execute(
        """INSERT INTO shipment_lines
           (id, doc_id, product_id, product_name, product_sku,
            color_id, color_name, size_id, size_name,
            qty, is_deleted, created_at)
           VALUES (?, ?, ?, 'Test Product', 'TST-SKU',
                   ?, 'Red', ?, NULL,
                   ?, 0, NOW())""",
        (str(uuid.uuid4()), doc_id, product_id, color_id, size_id, qty),
    )


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
        conn.commit()


# ── tests ─────────────────────────────────────────────────────────────────────

def test_balance_increases_after_receipt_accepted(admin_client, client_id, product_ids):
    """Принятый товар (статус on_review) отражается в балансах как good."""
    pid, color_id, size_id = product_ids
    good_qty = 42

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "on_review")
        line_id = _insert_receipt_line(conn, doc_id, pid, color_id, size_id, good_qty)
        _insert_receiving_op(conn, doc_id, line_id, good_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matched = [i for i in items if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах: {items}"
        assert matched[0]["good"] == good_qty
        assert matched[0]["defect"] == 0
    finally:
        _cleanup_test_docs(client_id)


def test_balance_includes_defect_qty(admin_client, client_id, product_ids):
    """Принятый брак отражается в поле defect."""
    pid, color_id, size_id = product_ids
    good_qty = 10
    defect_qty = 5

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "done")
        line_id = _insert_receipt_line(conn, doc_id, pid, color_id, size_id, good_qty + defect_qty)
        _insert_receiving_op(conn, doc_id, line_id, good_qty)
        _insert_defect_op(conn, doc_id, line_id, defect_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matched = [i for i in items if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["good"] == good_qty
        assert matched[0]["defect"] == defect_qty
    finally:
        _cleanup_test_docs(client_id)


def test_balance_decreases_after_shipment_shipped(admin_client, client_id, product_ids):
    """После отгрузки (status=shipped) баланс уменьшается."""
    pid, color_id, size_id = product_ids
    received_qty = 20
    shipped_qty = 8

    with get_connection() as conn:
        # Принимаем товар
        r_doc = _insert_receipt(conn, client_id, "done")
        r_line = _insert_receipt_line(conn, r_doc, pid, color_id, size_id, received_qty)
        _insert_receiving_op(conn, r_doc, r_line, received_qty)
        # Отгружаем часть
        s_doc = _insert_shipment(conn, client_id, "good", "shipped")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, shipped_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matched = [i for i in items if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        assert matched[0]["good"] == received_qty - shipped_qty
    finally:
        _cleanup_test_docs(client_id)


def test_balance_unchanged_for_ready_shipment(admin_client, client_id, product_ids):
    """Отгрузка в статусе ready (не shipped) не уменьшает баланс."""
    pid, color_id, size_id = product_ids
    received_qty = 15
    reserved_qty = 10  # в отгрузке, но ещё не отправлена

    with get_connection() as conn:
        r_doc = _insert_receipt(conn, client_id, "done")
        r_line = _insert_receipt_line(conn, r_doc, pid, color_id, size_id, received_qty)
        _insert_receiving_op(conn, r_doc, r_line, received_qty)
        # Отгрузка в статусе ready — не должна влиять на баланс
        s_doc = _insert_shipment(conn, client_id, "good", "ready")
        _insert_shipment_line(conn, s_doc, pid, color_id, size_id, reserved_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matched = [i for i in items if i["product_id"] == pid]
        assert matched, f"Товар {pid} не найден в балансах"
        # Балансы должны остаться полными — ready не вычитается
        assert matched[0]["good"] == received_qty
    finally:
        _cleanup_test_docs(client_id)


def test_on_review_remainder_uses_accepted_qty(admin_client, client_id, product_ids):
    """Остаток «на проверке» = «Принят» минус уже разнесённый годный/брак (не план)."""
    pid, color_id, size_id = product_ids
    planned_qty = 30   # информационный план
    accepted_qty = 25  # фактически принято при прибытии
    good_qty = 10      # уже разнесено на QC

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "on_review")
        line_id = _insert_receipt_line(conn, doc_id, pid, color_id, size_id, planned_qty, accepted_qty)
        _insert_receiving_op(conn, doc_id, line_id, good_qty)
        conn.commit()

    try:
        r = admin_client.get(f"/balances?client_id={client_id}")
        assert r.status_code == 200, r.text
        matched = [i for i in r.json()["items"] if i["product_id"] == pid]
        assert matched, "Товар не найден в балансах"
        assert matched[0]["good"] == good_qty
        # Остаток на проверке считается от «Принят» (25), а не «План» (30): 25 - 10 = 15.
        assert matched[0]["on_review"] == accepted_qty - good_qty
    finally:
        _cleanup_test_docs(client_id)


def test_balance_not_counted_for_draft_receipt(admin_client, client_id, product_ids):
    """Поступление в статусе draft/planned не попадает в балансы."""
    pid, color_id, size_id = product_ids

    with get_connection() as conn:
        doc_id = _insert_receipt(conn, client_id, "planned")
        line_id = _insert_receipt_line(conn, doc_id, pid, color_id, size_id, 50)
        _insert_receiving_op(conn, doc_id, line_id, 50)
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
