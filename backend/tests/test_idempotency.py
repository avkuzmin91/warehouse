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
