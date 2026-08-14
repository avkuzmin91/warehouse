"""Идемпотентность write-операций (X-Request-Id, docs/mobile-plan.md §6.3).

Главный кейс: рвущаяся мобильная сеть → повтор запроса не должен задваивать
перемещение/приёмку. Проверяем на /balances/relocations (журнальная операция без
статусного гейта — самый опасный случай двойного эффекта).
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, manager_client, make_client_id, cleanup_client  # noqa: F401
from tests.test_balances import (  # noqa: F401
    client_id,
    product_ids,
    _seed_good_in_zone,
    _zone_bucket,
)
from tests.test_recurring_expenses import _create_template, _purge_template, _recurring_items
from tests.test_timesheet import WEEK, _add_worked_day, employee  # noqa: F401


def _storage_move_count(pid: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM zone_relocations "
            "WHERE product_id = ? AND from_op = 'storage' AND to_op = 'storage'",
            (pid,),
        ).fetchone()
    return int(row["n"])


def _cleanup(pid: str, *request_ids: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM zone_relocations WHERE product_id = ?", (pid,))
        for rid in request_ids:
            conn.execute("DELETE FROM idempotency_keys WHERE request_id = ?", (rid,))
        conn.commit()


def _relocate(client, *, pid, color_id, size_id, client_id, zone_from, zone_to, qty, request_id=None):
    headers = {"X-Request-Id": request_id} if request_id else {}
    return client.post(
        "/balances/relocations",
        json={
            "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
            "quality": "good", "from_zone_id": zone_from, "to_zone_id": zone_to, "qty": qty,
        },
        headers=headers,
    )


def test_same_request_id_applies_once(admin_client, client_id, product_ids):
    """Повтор с тем же X-Request-Id отдаёт прежний ответ и НЕ двигает остаток повторно."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    rid = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 10)
    try:
        first = _relocate(admin_client, pid=pid, color_id=color_id, size_id=size_id,
                          client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid)
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "ok"}

        second = _relocate(admin_client, pid=pid, color_id=color_id, size_id=size_id,
                           client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid)
        assert second.status_code == 200, second.text
        assert second.json() == {"message": "ok"}  # прежний ответ, операция не выполнялась

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone_a) == 6   # сдвинули один раз, не два
        assert _zone_bucket(items, zone_b) == 4
        assert _storage_move_count(pid) == 1       # в журнале одна запись
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


def test_different_request_id_applies_each_time(admin_client, client_id, product_ids):
    """Разные X-Request-Id — разные логические операции, эффект применяется дважды."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    rid1, rid2 = str(uuid.uuid4()), str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 10)
    try:
        r1 = _relocate(admin_client, pid=pid, color_id=color_id, size_id=size_id,
                      client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid1)
        assert r1.status_code == 200, r1.text
        r2 = _relocate(admin_client, pid=pid, color_id=color_id, size_id=size_id,
                      client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid2)
        assert r2.status_code == 200, r2.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone_a) == 2
        assert _zone_bucket(items, zone_b) == 8
        assert _storage_move_count(pid) == 2
    finally:
        _cleanup(pid, rid1, rid2)
        _cleanup_balances(client_id)


def test_request_id_scoped_to_user(admin_client, manager_client, client_id, product_ids):
    """Чужой пользователь с тем же request_id получает 409, не чужой результат."""
    pid, color_id, size_id = product_ids
    zone_a, zone_b = str(uuid.uuid4()), str(uuid.uuid4())
    rid = str(uuid.uuid4())
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone_a, 10)
    try:
        ok = _relocate(admin_client, pid=pid, color_id=color_id, size_id=size_id,
                      client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid)
        assert ok.status_code == 200, ok.text

        clash = _relocate(manager_client, pid=pid, color_id=color_id, size_id=size_id,
                         client_id=client_id, zone_from=zone_a, zone_to=zone_b, qty=4, request_id=rid)
        assert clash.status_code == 409, clash.text
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


def _cleanup_balances(client_id: str) -> None:
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)).fetchall()
        for r in rows:
            conn.execute("DELETE FROM receipt_ops WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
        conn.commit()


# ── Создание документов: повтор при обрыве сети не должен задваивать документ ──────

def _receipt_count(client_id: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM receipt_docs WHERE client_id = ?", (client_id,)
        ).fetchone()
    return int(row["n"])


def test_create_receipt_same_request_id_creates_once(admin_client):
    """Повтор POST /receipts с тем же X-Request-Id отдаёт прежний id и НЕ создаёт второй документ."""
    cid = make_client_id()
    rid = str(uuid.uuid4())
    payload = {"client_id": cid, "lines": []}
    try:
        first = admin_client.post("/receipts", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        doc_id = first.json()["message"]

        second = admin_client.post("/receipts", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json()["message"] == doc_id   # прежний ответ, не новый документ
        assert _receipt_count(cid) == 1
    finally:
        _cleanup_balances(cid)
        with get_connection() as conn:
            conn.execute("DELETE FROM idempotency_keys WHERE request_id = ?", (rid,))
            conn.commit()
        cleanup_client(cid)


def test_create_receipt_different_request_id_creates_each(admin_client):
    """Разные X-Request-Id — разные документы (легитимные одинаковые создания не блокируются)."""
    cid = make_client_id()
    rid1, rid2 = str(uuid.uuid4()), str(uuid.uuid4())
    payload = {"client_id": cid, "lines": []}
    try:
        r1 = admin_client.post("/receipts", json=payload, headers={"X-Request-Id": rid1})
        r2 = admin_client.post("/receipts", json=payload, headers={"X-Request-Id": rid2})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["message"] != r2.json()["message"]
        assert _receipt_count(cid) == 2
    finally:
        _cleanup_balances(cid)
        with get_connection() as conn:
            conn.execute("DELETE FROM idempotency_keys WHERE request_id IN (?, ?)", (rid1, rid2))
            conn.commit()
        cleanup_client(cid)


# ── Ручные операции с остатками: списание / откат / смена качества / заведение ─────

def _purge_request_ids(*request_ids: str) -> None:
    with get_connection() as conn:
        for rid in request_ids:
            conn.execute("DELETE FROM idempotency_keys WHERE request_id = ?", (rid,))
        conn.commit()


def _journal_count(pid: str, where: str, params: tuple = ()) -> int:
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM zone_relocations WHERE product_id = ? AND {where}",
            (pid, *params),
        ).fetchone()
    return int(row["n"])


def test_write_off_same_request_id_applies_once(admin_client, client_id, product_ids):
    """Повтор списания с тем же X-Request-Id не списывает второй раз."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    rid = str(uuid.uuid4())
    payload = {
        "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
        "zone_id": zone, "quality": "good", "qty": 4, "reason": "damage",
    }
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
    try:
        first = admin_client.post("/balances/write-offs", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "ok"}

        second = admin_client.post("/balances/write-offs", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone) == 6                       # списали один раз, не два
        assert _journal_count(pid, "to_op = 'written_off'") == 1
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


def test_write_off_different_request_id_applies_each_time(admin_client, client_id, product_ids):
    """Разные X-Request-Id — два самостоятельных списания."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    rid1, rid2 = str(uuid.uuid4()), str(uuid.uuid4())
    payload = {
        "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
        "zone_id": zone, "quality": "good", "qty": 3, "reason": "shortage",
    }
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
    try:
        r1 = admin_client.post("/balances/write-offs", json=payload, headers={"X-Request-Id": rid1})
        assert r1.status_code == 200, r1.text
        r2 = admin_client.post("/balances/write-offs", json=payload, headers={"X-Request-Id": rid2})
        assert r2.status_code == 200, r2.text

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone) == 4
        assert _journal_count(pid, "to_op = 'written_off'") == 2
    finally:
        _cleanup(pid, rid1, rid2)
        _cleanup_balances(client_id)


def test_write_off_undo_same_request_id_applies_once(admin_client, client_id, product_ids):
    """Повтор отката списания с тем же X-Request-Id отдаёт прежний ответ (без ключа был бы 400 «уже отменено»)."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    rid = str(uuid.uuid4())
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

        first = admin_client.post(f"/balances/write-offs/{woff['id']}/undo", headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "ok"}

        second = admin_client.post(f"/balances/write-offs/{woff['id']}/undo", headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone) == 10                       # вернулось ровно списанное
        assert _journal_count(pid, "reverses_id = ?", (woff["id"],)) == 1
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


def test_quality_change_same_request_id_applies_once(admin_client, client_id, product_ids):
    """Повтор перевода в брак с тем же X-Request-Id не переводит вторую партию."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    rid = str(uuid.uuid4())
    payload = {
        "product_id": pid, "color_id": color_id, "size_id": size_id, "client_id": client_id,
        "zone_id": zone, "from_quality": "good", "to_quality": "defect", "qty": 3,
    }
    with get_connection() as conn:
        _seed_good_in_zone(conn, client_id, product_ids, zone, 10)
    try:
        first = admin_client.post("/balances/quality-changes", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "ok"}

        second = admin_client.post("/balances/quality-changes", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone, "storage", "good") == 7
        assert _zone_bucket(items, zone, "storage", "defect") == 3   # 3, не 6
        assert _journal_count(pid, "from_quality = 'good' AND to_quality = 'defect'") == 1
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


def test_stock_entry_same_request_id_applies_once(admin_client, client_id, product_ids):
    """Повтор заведения остатков с тем же X-Request-Id отдаёт прежний ответ и не задваивает приход."""
    pid, color_id, size_id = product_ids
    zone = str(uuid.uuid4())
    rid = str(uuid.uuid4())
    payload = {
        "client_id": client_id,
        "lines": [{
            "product_id": pid, "product_name": "Test Product", "product_sku": "TST-SKU",
            "color_id": color_id, "size_id": size_id,
            "zone_id": zone, "quality": "good", "qty": 7,
        }],
    }
    try:
        first = admin_client.post("/balances/stock-entry", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "1"}

        second = admin_client.post("/balances/stock-entry", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        items = admin_client.get(f"/balances/zones?client_id={client_id}").json()["items"]
        assert _zone_bucket(items, zone) == 7
        assert _journal_count(pid, "from_op = 'intake'") == 1
    finally:
        _cleanup(pid, rid)
        _cleanup_balances(client_id)


# ── Табель: выплата и «Рассчитать всех» ────────────────────────────────────────────

def _payment_count(employee_id: str, kind: str | None = None) -> int:
    with get_connection() as conn:
        if kind:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM payroll_payments WHERE employee_id = ? AND kind = ?",
                (employee_id, kind),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM payroll_payments WHERE employee_id = ?",
                (employee_id,),
            ).fetchone()
    return int(row["n"])


def test_payroll_payment_same_request_id_applies_once(manager_client, employee):
    """Повтор аванса с тем же X-Request-Id не создаёт вторую выплату."""
    rid = str(uuid.uuid4())
    payload = {
        "employee_id": employee, "amount_kopecks": 100000, "kind": "advance",
        "period_start": "2025-01-04", "period_end": "2025-01-10",
    }
    try:
        first = manager_client.post("/timesheet/payments", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "ok"}

        second = manager_client.post("/timesheet/payments", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        assert _payment_count(employee) == 1
    finally:
        _purge_request_ids(rid)


def test_settle_all_same_request_id_settles_once(manager_client, employee):
    """Повтор «Рассчитать всех» с тем же X-Request-Id отдаёт прежний счётчик и не плодит расчёты."""
    _add_worked_day(manager_client, employee)
    rid = str(uuid.uuid4())
    try:
        first = manager_client.post("/timesheet/payroll/settle-all",
                                    json={"week": WEEK}, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json() == {"message": "1"}

        second = manager_client.post("/timesheet/payroll/settle-all",
                                     json={"week": WEEK}, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == first.json()   # прежний ответ, не «0» повторного прогона

        assert _payment_count(employee, "settlement") == 1
    finally:
        _purge_request_ids(rid)


# ── Регулярные расходы: массовая оплата FIFO ───────────────────────────────────────

def test_recurring_pay_same_request_id_pays_once(admin_client):
    """Повтор оплаты с тем же X-Request-Id отдаёт прежний ответ и не задваивает платёж.

    Без ключа повтор упал бы с 400 «нет начислений к оплате» — начисление уже закрыто."""
    src = admin_client.post(
        "/expenses/dict/payment-sources", json={"name": f"Касса-{uuid.uuid4().hex[:8]}"}
    ).json()["message"]
    tid = _create_template(admin_client, amount_kop=100000)
    rid = str(uuid.uuid4())
    try:
        assert admin_client.post("/recurring-expenses/accruals/run?on_date=2026-06-15").json()["created"] == 1

        payload = {
            "template_id": tid, "amount": 100000,
            "payment_source_id": src, "paid_on": "2026-06-16",
        }
        first = admin_client.post("/recurring-expenses/pay", json=payload, headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["allocated_amount"] == 100000
        assert body["fully_paid_count"] == 1

        second = admin_client.post("/recurring-expenses/pay", json=payload, headers={"X-Request-Id": rid})
        assert second.status_code == 200, second.text
        assert second.json() == body

        rows = {e["spent_on"]: e for e in _recurring_items(admin_client, tid)}
        assert rows["2026-06-15"]["payment_status"] == "paid"
        assert rows["2026-06-15"]["paid_amount"] == 100000   # один платёж, не 200000
        with get_connection() as conn:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM expense_payments WHERE expense_id IN "
                "(SELECT id FROM material_expenses WHERE source_kind = 'recurring' "
                " AND source_id = ? AND spent_on = '2026-06-15')",
                (tid,),
            ).fetchone()["n"]
        assert int(n) == 1
    finally:
        _purge_template(tid)
        with get_connection() as conn:
            conn.execute("DELETE FROM expense_payment_sources WHERE id = ?", (src,))
            conn.commit()
        _purge_request_ids(rid)
