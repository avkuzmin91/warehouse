"""Переупаковка задачи упаковки: без оплаты (наша ошибка) и за счёт клиента.

Ключевые инварианты:
- факт первого прохода упаковки сохраняется в производительности (оплаченным);
- товар возвращается в пул, кладовщик пакует заново, план/факт не задваиваются;
- повторные pack-записи помечены repack_kind (free — 0 ₽, paid — тарифицируется);
- paid: при выходе задачи в «Упаковано» автоматически создаётся запись «Доп. работы»
  (кастомная цена за единицу × объём + работы сверх тарифа).
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from tests.conftest import make_client_id, cleanup_client

_D1 = "2026-06-08"
_D2 = "2026-06-09"

_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_SHIFT = {"id": "t-shift", "email": "s@t.com", "role": "shift_supervisor", "created_at": "2020-01-01T00:00:00", "client_id": None}
_WH = {"id": "t-wh", "email": "w@t.com", "role": "warehouse_manager", "created_at": "2020-01-01T00:00:00", "client_id": None}


@pytest.fixture
def api():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _as(row):
    app.dependency_overrides[get_current_user] = lambda: row


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    with get_connection() as conn:
        for r in conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM receipt_ops WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (cid,))
        for r in conn.execute("SELECT id FROM shipment_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (cid,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (cid,))
        for r in conn.execute("SELECT id FROM extra_income_entries WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM extra_income_ops WHERE entry_id = ?", (r["id"],))
        conn.execute("DELETE FROM extra_income_entries WHERE client_id = ?", (cid,))
        conn.commit()
    cleanup_client(cid)


def _position():
    return {"product_id": str(uuid.uuid4()), "color_id": str(uuid.uuid4()), "size_id": None}


def _receive(api, client_id, pos, qty, intake_zone_id):
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU-" + uuid.uuid4().hex[:6],
            "color_name": "Red", "size_name": None, "planned_qty": qty}
    doc_id = api.post("/receipts", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "supplier_name": "S", "arrival_date": "2026-05-27", "lines": [line],
    }).json()["message"]
    api.post(f"/receipts/{doc_id}/advance")
    l = api.get(f"/receipts/{doc_id}").json()["lines"][0]
    from config import INV_OP_INTAKE, INV_OP_STORAGE, INV_Q_GOOD
    from modules.balances.service import insert_inventory_move
    with get_connection() as c:
        c.execute("UPDATE receipt_docs SET status='done' WHERE id=?", (doc_id,))
        c.execute("UPDATE receipt_lines SET accepted_qty=?, storage_zone_id=?, storage_zone_name=? WHERE id=?",
                  (qty, intake_zone_id, "Приёмка", l["id"]))
        insert_inventory_move(
            c, product_id=l["product_id"], product_name=l["product_name"], product_sku=l["product_sku"],
            color_id=l["color_id"], color_name=l["color_name"], size_id=l["size_id"], size_name=l["size_name"],
            client_id=client_id, client_name="C", from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=intake_zone_id, from_zone_name="Приёмка", to_zone_id=intake_zone_id, to_zone_name="Приёмка",
            qty=qty, user_id=None, receipt_line_id=l["id"], comment="seed",
        )
        c.commit()


def _packed_shipment(api, client_id, pos, qty, good_zone):
    """Полный первый проход: создание → упаковка qty годного (дата _D1) → «Упаковано»."""
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": qty}
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": "2026-05-27", "comment": "ТЗ", "lines": [line],
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → assigned
    api.post(f"/shipments/{doc_id}/advance")  # assigned → packing
    line_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": qty})
    api.post(f"/shipments/{doc_id}/advance")  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": qty, "packed_date": _D1})
    api.post(f"/shipments/{doc_id}/advance")  # on_packing → relocating
    _as(_WH)
    fin = api.post(f"/shipments/{doc_id}/finish-relocation", json={
        "lines": [{"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": qty}], "defect": []}],
    })
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text
    return doc_id, line_id


def _repack_to_packed(api, doc_id, line_id, qty, good_zone):
    """Повторная упаковка qty годного (дата _D2) и завершение задачи."""
    _as(_SHIFT)
    p = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": qty, "packed_date": _D2})
    assert p.status_code == 200, p.text
    api.post(f"/shipments/{doc_id}/advance")  # on_packing → relocating
    _as(_WH)
    fin = api.post(f"/shipments/{doc_id}/finish-relocation", json={
        "lines": [{"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": qty}], "defect": []}],
    })
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text


def _productivity_rows(api, client_id):
    # Под админом: деньги (with_earnings) отдаются только ролям со стоимостями.
    _as(_ADMIN)
    r = api.get("/shipments/packing/productivity",
                params={"client_id": client_id, "date_from": _D1, "date_to": _D2})
    assert r.status_code == 200, r.text
    return {d["packed_date"]: d for d in r.json()["days"]}


def _extra_income(client_id):
    with get_connection() as c:
        return c.execute(
            "SELECT * FROM extra_income_entries WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0",
            (client_id,),
        ).fetchall()


def test_repack_requires_reason(api, client_id):
    pos = _position()
    intake, good_zone = str(uuid.uuid4()), str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake)
    doc_id, _ = _packed_shipment(api, client_id, pos, 10, good_zone)
    _as(_ADMIN)
    r = api.post(f"/shipments/{doc_id}/return-to-packing", json={"mode": "repack_free"})
    assert r.status_code == 400 and "причину переупаковки" in r.json()["detail"], r.text


def test_free_repack_keeps_first_pass_and_marks_entries(api, client_id):
    pos = _position()
    intake, good_zone = str(uuid.uuid4()), str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake)
    doc_id, line_id = _packed_shipment(api, client_id, pos, 10, good_zone)

    _as(_ADMIN)
    r = api.post(f"/shipments/{doc_id}/return-to-packing",
                 json={"mode": "repack_free", "reason": "Неверное ТЗ"})
    assert r.status_code == 200 and r.json()["message"] == "on_packing", r.text

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["repack_kind"] == "free" and detail["repack_active"] is True
    assert detail["repack_reason"] == "Неверное ТЗ"
    line = detail["lines"][0]
    # Товар вернулся в пул, факт упаковки обнулён — кладовщик пакует заново.
    assert line["available_for_pack"] == 10
    assert line["packed_good"] == 0

    # Первый проход остался в производительности на своей дате.
    days = _productivity_rows(api, client_id)
    assert days[_D1]["good"] == 10

    # Записи первого прохода на переупаковке отменять нельзя (они оплачены).
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    first = next(e for e in entries if e["repack_kind"] is None)
    _as(_SHIFT)
    blocked = api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{first['id']}/reverse")
    assert blocked.status_code == 400, blocked.text

    _repack_to_packed(api, doc_id, line_id, 10, good_zone)

    # Повторная запись помечена free; оба прохода видны, объём не слился и не потерялся.
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    kinds = sorted((e["repack_kind"] or "-", e["good"]) for e in entries)
    assert kinds == [("-", 10), ("free", 10)]
    days = _productivity_rows(api, client_id)
    assert days[_D1]["good"] == 10 and days[_D2]["good"] == 10
    d2_row = days[_D2]["rows"][0]
    assert d2_row["repack_kind"] == "free"
    # Бесплатный объём: 0 ₽ и БЕЗ price_missing (это не дыра в тарифах).
    assert d2_row["earn_kop"] == 0 and d2_row["price_missing"] is False

    # Режим переупаковки снят, бейдж (kind) остался; доп. работа не создавалась.
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "packed"
    assert detail["repack_active"] is False and detail["repack_kind"] == "free"
    assert _extra_income(client_id) == []
    assert any(o["op_type"] == "repack_start" for o in detail["ops"])


def test_paid_repack_creates_extra_income(api, client_id):
    pos = _position()
    intake, good_zone = str(uuid.uuid4()), str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake)
    doc_id, line_id = _packed_shipment(api, client_id, pos, 10, good_zone)

    _as(_ADMIN)
    r = api.post(f"/shipments/{doc_id}/return-to-packing", json={
        "mode": "repack_paid", "reason": "Клиент прислал неверное ТЗ",
        "unit_price_kop": 500,
        "extra_amount_kop": 30000, "extra_comment": "удаление старой упаковки",
    })
    assert r.status_code == 200, r.text

    _repack_to_packed(api, doc_id, line_id, 10, good_zone)

    # Автосозданная запись «Доп. работы»: 10 шт × 5 ₽ + 300 ₽ = 350 ₽.
    entries = _extra_income(client_id)
    assert len(entries) == 1
    e = entries[0]
    assert int(e["qty"]) == 10
    assert int(e["amount_kop"]) == 10 * 500 + 30000
    assert "Переупаковка по вине клиента" in str(e["comment"])
    assert "удаление старой упаковки" in str(e["comment"])
    with get_connection() as c:
        cat = c.execute(
            "SELECT name FROM extra_income_categories WHERE id = ?", (e["category_id"],)
        ).fetchone()
    assert str(cat["name"]) == "Переупаковка"

    # Производительность: повторный объём тарифицирован кастомной ценой.
    days = _productivity_rows(api, client_id)
    d2_row = days[_D2]["rows"][0]
    assert d2_row["repack_kind"] == "paid"
    assert d2_row["earn_kop"] == 10 * 500 and d2_row["price_missing"] is False

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["repack_active"] is False
    assert any(o["op_type"] == "repack_charge" for o in detail["ops"])
    # Гейт от повторного выставления записан на документе.
    with get_connection() as c:
        row = c.execute("SELECT repack_charge_entry_id FROM shipment_docs WHERE id = ?", (doc_id,)).fetchone()
    assert str(row["repack_charge_entry_id"]) == str(e["id"])


def test_paid_repack_extra_requires_comment(api, client_id):
    pos = _position()
    intake, good_zone = str(uuid.uuid4()), str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake)
    doc_id, _ = _packed_shipment(api, client_id, pos, 10, good_zone)
    _as(_ADMIN)
    r = api.post(f"/shipments/{doc_id}/return-to-packing", json={
        "mode": "repack_paid", "reason": "Ошибка клиента", "extra_amount_kop": 1000,
    })
    assert r.status_code == 400 and "за что доп. работы" in r.json()["detail"], r.text


def test_return_to_packing_without_body_is_rework(api, client_id):
    """Back-compat: пустой вызов работает как обычная доработка (без маркеров переупаковки)."""
    pos = _position()
    intake, good_zone = str(uuid.uuid4()), str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake)
    doc_id, _ = _packed_shipment(api, client_id, pos, 10, good_zone)
    _as(_ADMIN)
    r = api.post(f"/shipments/{doc_id}/return-to-packing")
    assert r.status_code == 200 and r.json()["message"] == "on_packing", r.text
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["repack_kind"] is None and detail["repack_active"] is False
    # Доработка не обнуляет факт: упакованное ждёт раскладки, пул пуст.
    line = detail["lines"][0]
    assert line["packed_good"] == 10 and line["available_for_pack"] == 0
