"""Тесты платного хранения остатков: тариф клиента (effective-dated, без
распространения назад), ежедневное начисление (лоты + FIFO, бесплатный период,
конвертация в единицы), доход в P&L и привязка к счёту. Требует DATABASE_URL.

Данные журнала вставляются напрямую (insert в zone_relocations с нужным
created_at), чтобы контролировать даты приёмки лотов.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from datetime import timedelta
from uuid import uuid4

from dbconn import get_connection
from modules.storage_pricing.service import run_storage_accruals, storage_record_on
from modules.timesheet.service import business_today
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    warehouse_client,
)

TODAY = business_today()


def _day(offset: int) -> str:
    """Бизнес-дата со смещением от сегодня (offset < 0 — в прошлом)."""
    return (TODAY + timedelta(days=offset)).isoformat()


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM invoice_ops WHERE invoice_id IN "
            "(SELECT id FROM invoice_docs WHERE client_id = ?)", (client_id,)
        )
        conn.execute(
            "DELETE FROM invoice_storage_charges WHERE invoice_id IN "
            "(SELECT id FROM invoice_docs WHERE client_id = ?)", (client_id,)
        )
        conn.execute("DELETE FROM invoice_docs WHERE client_id = ?", (client_id,))
        conn.execute(
            "DELETE FROM storage_charge_lines WHERE charge_id IN "
            "(SELECT id FROM storage_charges WHERE client_id = ?)", (client_id,)
        )
        conn.execute("DELETE FROM storage_charges WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM client_storage_prices WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


@pytest.fixture
def product_id():
    pid = str(uuid4())
    type_id = str(uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"TestType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"TestProduct-{pid[:8]}", type_id, f"TST-{pid[:8]}"),
        )
        conn.commit()
    yield pid
    with get_connection() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()


def _move(
    conn, *, client_id: str, product_id: str, from_op: str, to_op: str,
    qty: int, day: str, receipt_line_id: str | None = None,
) -> None:
    """Журнальное движение с управляемой датой (10:00 UTC = 13:00 МСК того же дня)."""
    conn.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,client_id,client_name,
            from_op,to_op,from_quality,to_quality,qty,created_at,receipt_line_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), product_id, "Test Product", "TST-1", client_id, "Test Client",
         from_op, to_op, "good", "good", qty, f"{day}T10:00:00+00:00", receipt_line_id),
    )


def _set_tariff(admin_client, client_id: str, *, unit: str = "piece", price_kop: int = 100,
                free_days: int = 14, effective_from: str) -> None:
    r = admin_client.post(
        f"/storage-pricing/clients/{client_id}/prices",
        json={"unit": unit, "price_kop": price_kop, "free_days": free_days,
              "effective_from": effective_from},
    )
    assert r.status_code == 200, r.text


def _charge(client_id: str, day: str) -> dict | None:
    with get_connection() as conn:
        r = conn.execute(
            "SELECT * FROM storage_charges WHERE client_id = ? AND charge_date = ?",
            (client_id, day),
        ).fetchone()
    return dict(r) if r else None


def _accrue(today=None) -> None:
    with get_connection() as conn:
        run_storage_accruals(conn, today or TODAY)
        conn.commit()


# ── Справочник тарифов ───────────────────────────────────────────────────────

def test_set_and_get_storage_price(admin_client, client_id):
    _set_tariff(admin_client, client_id, unit="piece", price_kop=150, free_days=14,
                effective_from="2026-06-01")
    d = admin_client.get(f"/storage-pricing/clients/{client_id}").json()
    assert d["unit"] == "piece"
    assert d["price_kop"] == 150
    assert d["free_days"] == 14
    assert d["billing_start"] == "2026-06-01"
    assert len(d["history"]) == 1


def test_storage_record_not_stretched_back(admin_client, client_id):
    # До первой записи тарифа хранение не тарифицируется (в отличие от pricing.price_on).
    _set_tariff(admin_client, client_id, price_kop=100, effective_from="2026-06-10")
    _set_tariff(admin_client, client_id, price_kop=200, effective_from="2026-06-20")
    from modules.storage_pricing.service import load_storage_price_history
    with get_connection() as conn:
        hist = load_storage_price_history(conn, client_id)
    assert storage_record_on(hist, "2026-06-01") is None
    assert storage_record_on(hist, "2026-06-15")["price_kop"] == 100
    assert storage_record_on(hist, "2026-06-25")["price_kop"] == 200


def test_invalid_unit_rejected(admin_client, client_id):
    r = admin_client.post(
        f"/storage-pricing/clients/{client_id}/prices",
        json={"unit": "kg", "price_kop": 100, "free_days": 0},
    )
    assert r.status_code == 400


def test_delete_storage_price(admin_client, client_id):
    _set_tariff(admin_client, client_id, effective_from="2026-06-01")
    d = admin_client.get(f"/storage-pricing/clients/{client_id}").json()
    pid = d["history"][0]["id"]
    assert admin_client.delete(f"/storage-pricing/clients/{client_id}/prices/{pid}").status_code == 200
    after = admin_client.get(f"/storage-pricing/clients/{client_id}").json()
    assert after["price_kop"] is None


def test_warehouse_role_forbidden(warehouse_client):
    assert warehouse_client.get("/storage-pricing/clients").status_code == 403


# ── Начисление: бесплатный период, FIFO, старт тарифа ────────────────────────

def test_accrual_free_period_and_fifo(admin_client, client_id, product_id):
    # Тариф: 1,00 ₽/шт·день, 14 бесплатных дней, действует 40 дней.
    _set_tariff(admin_client, client_id, price_kop=100, free_days=14, effective_from=_day(-40))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=100, day=_day(-30), receipt_line_id="lot-a")
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=50, day=_day(-5), receipt_line_id="lot-b")
        # Отгружено 80 шт. — FIFO съедает старый лот.
        _move(conn, client_id=client_id, product_id=product_id, from_op="storage",
              to_op="shipped", qty=80, day=_day(-3))
        conn.commit()
    _accrue()

    # Вчера: от лота A осталось 20 (возраст 29 ≥ 14 — платно), лот B молодой (4 дн.) — бесплатно.
    yc = _charge(client_id, _day(-1))
    assert yc is not None
    assert yc["qty_pieces"] == 20
    assert yc["amount_kop"] == 20 * 100

    # 10 дней назад: лот A ещё целиком на складе и уже платный (возраст 20).
    mid = _charge(client_id, _day(-10))
    assert mid["qty_pieces"] == 100
    assert mid["amount_kop"] == 100 * 100

    # До приёмки лота A — нулевой день (якорь идемпотентности пишется всегда).
    early = _charge(client_id, _day(-35))
    assert early is not None and early["amount_kop"] == 0

    # Детализация вчерашнего дня: один платный лот, атрибуция к строке lot-a.
    with get_connection() as conn:
        lines = conn.execute(
            "SELECT * FROM storage_charge_lines WHERE charge_id = ?", (yc["id"],)
        ).fetchall()
    assert len(lines) == 1
    assert lines[0]["receipt_line_id"] == "lot-a"
    assert int(lines[0]["billable_qty"]) == 20
    assert str(lines[0]["accepted_on"]) == _day(-30)


def test_accrual_age_counts_from_tariff_start(admin_client, client_id, product_id):
    # Лот принят задолго до старта тарифа: ретроспективы нет, возраст — от старта.
    _set_tariff(admin_client, client_id, price_kop=100, free_days=5, effective_from=_day(-10))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=10, day=_day(-100), receipt_line_id="lot-old")
        conn.commit()
    _accrue()
    # Через 2 дня после старта возраст 2 < 5 — бесплатно.
    assert _charge(client_id, _day(-8))["amount_kop"] == 0
    # Вчера возраст 9 ≥ 5 — платно.
    yc = _charge(client_id, _day(-1))
    assert yc["qty_pieces"] == 10
    assert yc["amount_kop"] == 10 * 100


def test_accrual_idempotent_and_self_healing(admin_client, client_id, product_id):
    _set_tariff(admin_client, client_id, price_kop=100, free_days=0, effective_from=_day(-3))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=5, day=_day(-3), receipt_line_id="lot-1")
        conn.commit()
    _accrue()
    _accrue()  # повторный прогон не задваивает
    with get_connection() as conn:
        n = int(conn.execute(
            "SELECT COUNT(*) AS n FROM storage_charges WHERE client_id = ?", (client_id,)
        ).fetchone()["n"])
    assert n == 3  # дни -3, -2, -1


def test_accrual_correction_reduces_lot(admin_client, client_id, product_id):
    # Корректировка приёмки (storage → intake) уменьшает лот своей строки.
    _set_tariff(admin_client, client_id, price_kop=100, free_days=0, effective_from=_day(-5))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=30, day=_day(-5), receipt_line_id="lot-c")
        _move(conn, client_id=client_id, product_id=product_id, from_op="storage",
              to_op="intake", qty=10, day=_day(-2), receipt_line_id="lot-c")
        conn.commit()
    _accrue()
    assert _charge(client_id, _day(-3))["qty_pieces"] == 30  # до корректировки
    assert _charge(client_id, _day(-1))["qty_pieces"] == 20  # после


# ── Конвертация в единицы тарификации ────────────────────────────────────────

def test_units_box_conversion_and_missing_capacity(admin_client, client_id, product_id):
    # Второй товар без вместимости — его штуки не тарифицируются, но подсвечиваются.
    pid2 = str(uuid4())
    with get_connection() as conn:
        type_id = conn.execute(
            "SELECT type_id FROM products WHERE id = ?", (product_id,)
        ).fetchone()["type_id"]
        conn.execute(
            "INSERT INTO products (id, name, type_id, sku, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, ?, 1, 0, NOW())",
            (pid2, "NoCap Product", type_id, f"NC-{pid2[:8]}"),
        )
        conn.execute("UPDATE products SET items_per_box = 10 WHERE id = ?", (product_id,))
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=25, day=_day(-2), receipt_line_id="lot-x")
        _move(conn, client_id=client_id, product_id=pid2, from_op="intake",
              to_op="storage", qty=7, day=_day(-2), receipt_line_id="lot-y")
        conn.commit()
    try:
        _set_tariff(admin_client, client_id, unit="box", price_kop=500, free_days=0,
                    effective_from=_day(-1))
        _accrue()
        yc = _charge(client_id, _day(-1))
        assert yc["qty_pieces"] == 32
        assert yc["units_qty"] == 3            # ceil(25 / 10) на уровне товара
        assert yc["amount_kop"] == 3 * 500
        assert yc["missing_capacity_qty"] == 7  # товар без items_per_box
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM products WHERE id = ?", (pid2,))
            conn.commit()


# ── Отчёт и P&L ──────────────────────────────────────────────────────────────

def test_report_and_pnl_include_storage(admin_client, client_id, product_id):
    _set_tariff(admin_client, client_id, price_kop=100, free_days=0, effective_from=_day(-2))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=10, day=_day(-2), receipt_line_id="lot-p")
        conn.commit()
    _accrue()

    rep = admin_client.get(
        f"/storage-pricing/report?date_from={_day(-2)}&date_to={_day(0)}&client_id={client_id}"
    ).json()
    row = next(it for it in rep["items"] if it["client_id"] == client_id)
    assert row["billable_days"] == 2
    assert row["amount_kop"] == 2 * 10 * 100
    assert row["uninvoiced_kop"] == row["amount_kop"]

    days = admin_client.get(
        f"/storage-pricing/report/{client_id}/days?date_from={_day(-2)}&date_to={_day(0)}"
    ).json()["items"]
    paid_days = [d for d in days if d["amount_kop"] > 0]
    assert len(paid_days) == 2
    detail = admin_client.get(f"/storage-pricing/charges/{paid_days[0]['id']}").json()
    assert detail["lines"] and detail["lines"][0]["receipt_line_id"] == "lot-p"

    pnl = admin_client.get(
        f"/pnl?date_from={_day(-2)}&date_to={_day(-1)}&client_id={client_id}"
    ).json()
    storage_src = next((s for s in pnl["income_sources"] if s["key"] == "storage"), None)
    assert storage_src is not None
    assert storage_src["amount"] == 2 * 10 * 100

    day_detail = admin_client.get(
        f"/pnl/day?date={_day(-1)}&date_from={_day(-2)}&date_to={_day(-1)}&client_id={client_id}"
    ).json()
    assert any(s["key"] == "storage" for s in day_detail["income_sources"])


# ── Привязка к счёту ─────────────────────────────────────────────────────────

def test_invoice_storage_attach_and_detach(admin_client, client_id, product_id):
    _set_tariff(admin_client, client_id, price_kop=100, free_days=0, effective_from=_day(-3))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=10, day=_day(-3), receipt_line_id="lot-i")
        conn.commit()
    _accrue()

    r = admin_client.post("/invoices", json={"client_id": client_id, "client_name": "Test Client"})
    assert r.status_code == 200, r.text
    inv_id = r.json()["message"]

    r = admin_client.post(f"/invoices/{inv_id}/storage",
                          json={"date_from": _day(-3), "date_to": _day(-1)})
    assert r.status_code == 200, r.text
    assert r.json()["days"] == 3
    assert r.json()["amount_kop"] == 3 * 10 * 100

    detail = admin_client.get(f"/invoices/{inv_id}").json()
    assert detail["storage_kop"] == 3 * 10 * 100
    assert detail["storage"]["days"] == 3
    assert detail["storage"]["period_from"] == _day(-3)
    assert detail["storage"]["period_to"] == _day(-1)

    # Повторная привязка того же периода (второй счёт) — дни уже заняты.
    r2 = admin_client.post("/invoices", json={"client_id": client_id})
    inv2 = r2.json()["message"]
    busy = admin_client.post(f"/invoices/{inv2}/storage",
                             json={"date_from": _day(-3), "date_to": _day(-1)})
    assert busy.status_code == 400

    # Отвязка освобождает дни — второй счёт может их забрать.
    assert admin_client.delete(f"/invoices/{inv_id}/storage").status_code == 200
    ok = admin_client.post(f"/invoices/{inv2}/storage",
                           json={"date_from": _day(-3), "date_to": _day(-1)})
    assert ok.status_code == 200


def test_invoice_cancel_frees_storage(admin_client, client_id, product_id):
    _set_tariff(admin_client, client_id, price_kop=100, free_days=0, effective_from=_day(-2))
    with get_connection() as conn:
        _move(conn, client_id=client_id, product_id=product_id, from_op="intake",
              to_op="storage", qty=5, day=_day(-2), receipt_line_id="lot-z")
        conn.commit()
    _accrue()

    inv_id = admin_client.post("/invoices", json={"client_id": client_id}).json()["message"]
    assert admin_client.post(f"/invoices/{inv_id}/storage",
                             json={"date_from": _day(-2), "date_to": _day(-1)}).status_code == 200
    assert admin_client.post(f"/invoices/{inv_id}/cancel").status_code == 200

    inv2 = admin_client.post("/invoices", json={"client_id": client_id}).json()["message"]
    r = admin_client.post(f"/invoices/{inv2}/storage",
                          json={"date_from": _day(-2), "date_to": _day(-1)})
    assert r.status_code == 200, r.text
