"""Оборотная ведомость запаса и хронология позиции (/balances/turnover*).

Отчёт отвечает на вопрос «как остаток пришёл к текущему значению»: из журнала
берутся только движения, меняющие общий остаток (приход, корректировка приёмки,
отгрузка, списание и их возвраты), внутренние переходы между корзинами
storage → packing → packed → ready в ведомость не попадают.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    cleanup_client,
    make_client_id,
    shift_supervisor_client,
)


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


@pytest.fixture
def product_ids():
    pid = str(uuid.uuid4())
    type_id = str(uuid.uuid4())
    color_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, is_deleted, created_at)"
            " VALUES (?, ?, 1, 0, NOW())",
            (type_id, f"TestType-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, sku, is_active, is_deleted, created_at)"
            " VALUES (?, ?, ?, ?, 1, 0, NOW())",
            (pid, f"TurnoverProduct-{pid[:8]}", type_id, f"TRN-{pid[:8]}"),
        )
        conn.commit()
    yield pid, color_id, None
    with get_connection() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.execute("DELETE FROM product_types WHERE id = ?", (type_id,))
        conn.commit()


# ── helpers ───────────────────────────────────────────────────────────────────

def _days_ago_iso(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


def _move(
    conn, client_id: str, product_ids, qty: int, *,
    from_op: str, to_op: str, quality: str = "good",
    created_at: str | None = None, receipt_line_id: str | None = None,
    dispatch_line_id: str | None = None, reason: str | None = None,
    comment: str | None = None,
) -> str:
    pid, color_id, size_id = product_ids
    mid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO zone_relocations
           (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
            client_id, from_op, to_op, from_quality, to_quality, qty,
            receipt_line_id, dispatch_line_id, reason, comment, created_at)
           VALUES (?, ?, 'Turnover Product', 'TRN-SKU', ?, 'Red', ?, NULL,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (mid, pid, color_id, size_id, client_id, from_op, to_op, quality, quality, qty,
         receipt_line_id, dispatch_line_id, reason, comment,
         created_at or datetime.now(UTC).isoformat()),
    )
    return mid


def _receipt_line(conn, client_id: str, product_ids, qty: int) -> tuple[str, str, str]:
    """Поступление done + строка. Возвращает (doc_id, doc_number, line_id)."""
    pid, color_id, size_id = product_ids
    doc_id, line_id = str(uuid.uuid4()), str(uuid.uuid4())
    number = f"WH-T-{doc_id[:8]}"
    conn.execute(
        """INSERT INTO receipt_docs (id, doc_number, client_id, status, is_deleted, created_at, created_by)
           VALUES (?, ?, ?, 'done', 0, NOW(), 'test')""",
        (doc_id, number, client_id),
    )
    conn.execute(
        """INSERT INTO receipt_lines
           (id, doc_id, product_id, product_name, product_sku, color_id, color_name,
            size_id, size_name, planned_qty, accepted_qty, is_deleted, created_at, created_by)
           VALUES (?, ?, ?, 'Turnover Product', 'TRN-SKU', ?, 'Red', ?, NULL, ?, ?, 0, NOW(), 'test')""",
        (line_id, doc_id, pid, color_id, size_id, qty, qty),
    )
    return doc_id, number, line_id


def _find(items: list[dict], product_id: str) -> dict:
    match = [i for i in items if i["product_id"] == product_id]
    assert match, "позиция не найдена в отчёте"
    return match[0]


# ── ведомость ─────────────────────────────────────────────────────────────────

def test_turnover_skips_internal_moves(shift_supervisor_client, client_id, product_ids):
    """Технологические переходы между корзинами в оборот не попадают."""
    pid, _, _ = product_ids
    with get_connection() as conn:
        _, _, line_id = _receipt_line(conn, client_id, product_ids, 100)
        _move(conn, client_id, product_ids, 100, from_op="intake", to_op="storage", receipt_line_id=line_id)
        # Внутренний маршрут: хранение → упаковка → упаковано → готов к отгрузке.
        _move(conn, client_id, product_ids, 40, from_op="storage", to_op="packing")
        _move(conn, client_id, product_ids, 40, from_op="packing", to_op="packed")
        _move(conn, client_id, product_ids, 40, from_op="packed", to_op="ready")
        # Смена качества — тоже внутреннее движение.
        _move(conn, client_id, product_ids, 5, from_op="storage", to_op="storage", quality="defect")
        _move(conn, client_id, product_ids, 30, from_op="ready", to_op="shipped")
        _move(conn, client_id, product_ids, 10, from_op="storage", to_op="written_off", reason="damage")
        conn.commit()

    res = shift_supervisor_client.get("/balances/turnover", params={"client_id": client_id})
    assert res.status_code == 200
    row = _find(res.json()["items"], pid)
    assert row["opening"] == 0
    assert row["receipt"] == 100
    assert row["stock_entry"] == 0
    assert row["shipped"] == 30
    assert row["written_off"] == 10
    assert row["closing"] == 60

    # Ведомость сходится с остатком «По товарам».
    bal = shift_supervisor_client.get("/balances", params={"client_id": client_id}).json()
    assert _find(bal["items"], pid)["total"] == row["closing"]


def test_turnover_period_opening_and_closing(shift_supervisor_client, client_id, product_ids):
    """Движения до периода уходят в остаток на начало, а не в приход."""
    pid, _, _ = product_ids
    with get_connection() as conn:
        _, _, line_id = _receipt_line(conn, client_id, product_ids, 100)
        _move(conn, client_id, product_ids, 100, from_op="intake", to_op="storage",
              receipt_line_id=line_id, created_at=_days_ago_iso(30))
        _move(conn, client_id, product_ids, 30, from_op="storage", to_op="shipped",
              created_at=_days_ago_iso(2))
        conn.commit()

    date_from = (datetime.now(UTC) - timedelta(days=7)).date().isoformat()
    res = shift_supervisor_client.get(
        "/balances/turnover", params={"client_id": client_id, "date_from": date_from}
    )
    row = _find(res.json()["items"], pid)
    assert row["opening"] == 100
    assert row["receipt"] == 0
    assert row["shipped"] == 30
    assert row["closing"] == 70

    # Верхняя граница периода отсекает отгрузку — остаток на конец остаётся 100.
    cut = (datetime.now(UTC) - timedelta(days=5)).date().isoformat()
    res2 = shift_supervisor_client.get(
        "/balances/turnover", params={"client_id": client_id, "date_to": cut}
    )
    row2 = _find(res2.json()["items"], pid)
    assert row2["receipt"] == 100
    assert row2["shipped"] == 0
    assert row2["closing"] == 100


def test_turnover_nets_reversals(shift_supervisor_client, client_id, product_ids):
    """Откат списания и возврат отгрузки сворачиваются с исходным расходом."""
    pid, _, _ = product_ids
    with get_connection() as conn:
        _, _, line_id = _receipt_line(conn, client_id, product_ids, 50)
        _move(conn, client_id, product_ids, 50, from_op="intake", to_op="storage", receipt_line_id=line_id)
        _move(conn, client_id, product_ids, 20, from_op="storage", to_op="written_off", reason="shortage")
        _move(conn, client_id, product_ids, 20, from_op="written_off", to_op="storage")
        _move(conn, client_id, product_ids, 15, from_op="ready", to_op="shipped")
        _move(conn, client_id, product_ids, 15, from_op="shipped", to_op="ready")
        conn.commit()

    row = _find(
        shift_supervisor_client.get("/balances/turnover", params={"client_id": client_id}).json()["items"],
        pid,
    )
    assert row["written_off"] == 0
    assert row["shipped"] == 0
    assert row["closing"] == 50


def test_turnover_counts_receipt_correction(shift_supervisor_client, client_id, product_ids):
    """Корректировка приёмки (storage → intake) идёт отдельной колонкой со знаком."""
    pid, _, _ = product_ids
    with get_connection() as conn:
        _, _, line_id = _receipt_line(conn, client_id, product_ids, 80)
        _move(conn, client_id, product_ids, 80, from_op="intake", to_op="storage", receipt_line_id=line_id)
        _move(conn, client_id, product_ids, 5, from_op="storage", to_op="intake", receipt_line_id=line_id)
        conn.commit()

    row = _find(
        shift_supervisor_client.get("/balances/turnover", params={"client_id": client_id}).json()["items"],
        pid,
    )
    assert row["receipt"] == 80
    assert row["adjustments"] == -5
    assert row["closing"] == 75


def test_turnover_stock_entry_separate_column(shift_supervisor_client, client_id, product_ids):
    """Заведение остатка без документа не смешивается с приходом по поступлению."""
    pid, _, _ = product_ids
    with get_connection() as conn:
        _move(conn, client_id, product_ids, 12, from_op="intake", to_op="storage")
        conn.commit()

    row = _find(
        shift_supervisor_client.get("/balances/turnover", params={"client_id": client_id}).json()["items"],
        pid,
    )
    assert row["receipt"] == 0
    assert row["stock_entry"] == 12
    assert row["closing"] == 12


def test_turnover_totals_match_items(shift_supervisor_client, client_id, product_ids):
    pid, _, _ = product_ids
    with get_connection() as conn:
        _, _, line_id = _receipt_line(conn, client_id, product_ids, 70)
        _move(conn, client_id, product_ids, 70, from_op="intake", to_op="storage", receipt_line_id=line_id)
        _move(conn, client_id, product_ids, 25, from_op="ready", to_op="shipped")
        conn.commit()

    body = shift_supervisor_client.get("/balances/turnover", params={"client_id": client_id}).json()
    totals = body["totals"]
    assert totals["receipt"] == sum(i["receipt"] for i in body["items"])
    assert totals["shipped"] == sum(i["shipped"] for i in body["items"])
    assert totals["closing"] == sum(i["closing"] for i in body["items"])


def test_turnover_bad_period_rejected(shift_supervisor_client, client_id):
    res = shift_supervisor_client.get(
        "/balances/turnover", params={"client_id": client_id, "date_from": "2026-05-10", "date_to": "2026-05-01"}
    )
    assert res.status_code == 400
    assert "позже" in res.json()["detail"]


# ── хронология позиции ────────────────────────────────────────────────────────

def test_history_running_balance_and_docs(shift_supervisor_client, client_id, product_ids):
    """События идут по возрастанию даты, накопительный остаток сходится с текущим."""
    pid, color_id, _ = product_ids
    with get_connection() as conn:
        _, number, line_id = _receipt_line(conn, client_id, product_ids, 100)
        _move(conn, client_id, product_ids, 100, from_op="intake", to_op="storage",
              receipt_line_id=line_id, created_at=_days_ago_iso(10))
        _move(conn, client_id, product_ids, 30, from_op="ready", to_op="shipped",
              created_at=_days_ago_iso(5))
        _move(conn, client_id, product_ids, 10, from_op="storage", to_op="written_off",
              reason="damage", comment="Порвана упаковка", created_at=_days_ago_iso(1))
        conn.commit()

    res = shift_supervisor_client.get(
        "/balances/turnover/history",
        params={"product_id": pid, "client_id": client_id, "color_id": color_id},
    )
    assert res.status_code == 200
    body = res.json()
    kinds = [e["kind"] for e in body["events"]]
    assert kinds == ["receipt", "shipment", "write_off"]
    assert [e["delta"] for e in body["events"]] == [100, -30, -10]
    assert [e["balance_after"] for e in body["events"]] == [100, 70, 60]
    assert body["opening"] == 0
    assert body["closing"] == 60
    assert body["events"][0]["receipt_number"] == number
    assert body["events"][2]["reason"] == "damage"


def test_history_excludes_internal_moves(shift_supervisor_client, client_id, product_ids):
    pid, color_id, _ = product_ids
    with get_connection() as conn:
        _move(conn, client_id, product_ids, 40, from_op="intake", to_op="storage")
        _move(conn, client_id, product_ids, 40, from_op="storage", to_op="packing")
        _move(conn, client_id, product_ids, 40, from_op="packing", to_op="packed")
        conn.commit()

    body = shift_supervisor_client.get(
        "/balances/turnover/history",
        params={"product_id": pid, "client_id": client_id, "color_id": color_id},
    ).json()
    assert len(body["events"]) == 1
    assert body["events"][0]["kind"] == "stock_entry"
    assert body["closing"] == 40
