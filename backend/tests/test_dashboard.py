"""Интеграционные тесты дашборда: RBAC, /dashboard/today, /dashboard/operational-plan.

Требует DATABASE_URL. БД общая (dev), поэтому:
- все посевы делаются на уникальной дате из далёкого прошлого (1991–1998),
- количественные проверки — дельтой от baseline, снятого до посева,
- всё созданное удаляется в teardown фикстуры client_id.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.balances.service import insert_inventory_move
from modules.dashboard.service import (
    _local_day_utc_range,
    _priority,
    day_stats,
    operational_plan,
)
from security import FORBIDDEN_DETAIL
from tests.conftest import admin_client, cleanup_client, make_client_id  # noqa: F401


def _unique_past_day() -> date:
    """Случайный прошедший день в 2020–2025: внутри допустимого диапазона бизнес-дат
    (validate_business_date не пускает раньше 2020) и уникальный между тестами."""
    return date(2020, 1, 1) + timedelta(days=int(uuid.uuid4().hex[:6], 16) % 2000)


def _cleanup_docs(client_id: str) -> None:
    with get_connection() as conn:
        for rid in [r["id"] for r in conn.execute(
                "SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)).fetchall()]:
            conn.execute("DELETE FROM receipt_ops WHERE doc_id = ?", (rid,))
            conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (rid,))
        conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
        for sid in [r["id"] for r in conn.execute(
                "SELECT id FROM shipment_docs WHERE client_id = ?", (client_id,)).fetchall()]:
            conn.execute(
                "DELETE FROM zone_relocations WHERE shipment_line_id IN "
                "(SELECT id FROM shipment_lines WHERE doc_id = ?)",
                (sid,),
            )
            conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM shipment_line_files WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (sid,))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (client_id,))
        for did in [r["id"] for r in conn.execute(
                "SELECT id FROM dispatch_docs WHERE client_id = ?", (client_id,)).fetchall()]:
            conn.execute("DELETE FROM dispatch_ops WHERE doc_id = ?", (did,))
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (did,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup_docs(cid)
    cleanup_client(cid)


# ---------------------------------------------------------------- RBAC


def _user_row(role: str, *, client_id: str | None = None):
    def _override():
        return {
            "id": "test-user-id",
            "email": "t@example.com",
            "role": role,
            "created_at": "2020-01-01T00:00:00",
            "client_id": client_id,
        }

    return _override


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "role",
    ["admin", "manager", "warehouse_manager", "shift_supervisor", "warehouse_head"],
)
def test_dashboard_today_allowed_roles(role: str):
    app.dependency_overrides[get_current_user] = _user_row(role)
    r = TestClient(app).get("/dashboard/today", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"today", "yesterday"}
    for bucket in ("today", "yesterday"):
        for metric in ("arrivals", "packed", "shipped"):
            assert set(body[bucket][metric]) == {"plan", "fact"}
            assert isinstance(body[bucket][metric]["plan"], int)
            assert isinstance(body[bucket][metric]["fact"], int)
        assert isinstance(body[bucket]["defects"], int)


@pytest.mark.parametrize(
    ("role", "cid"),
    [("client", "client-uuid-1"), ("user", None)],
)
@pytest.mark.parametrize("path", ["/dashboard/today", "/dashboard/operational-plan"])
def test_dashboard_forbidden_roles(path: str, role: str, cid: str | None):
    app.dependency_overrides[get_current_user] = _user_row(role, client_id=cid)
    r = TestClient(app).get(path, headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 403
    assert r.json()["detail"] == FORBIDDEN_DETAIL


@pytest.mark.parametrize("path", ["/dashboard/today", "/dashboard/operational-plan"])
def test_dashboard_unauthenticated(path: str):
    app.dependency_overrides.clear()
    r = TestClient(app).get(path)
    assert r.status_code == 401


def test_operational_plan_response_shape_and_limit_validation():
    app.dependency_overrides[get_current_user] = _user_row("manager")
    c = TestClient(app)
    headers = {"Authorization": "Bearer test-token"}

    r = c.get("/dashboard/operational-plan", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"receipts", "shipments", "exceptions", "totals"}
    assert set(body["totals"]) == {"receipts", "shipments", "overdue"}

    # Границы Query(ge=1, le=100).
    assert c.get("/dashboard/operational-plan?receipts_limit=0", headers=headers).status_code == 422
    assert c.get("/dashboard/operational-plan?shipments_limit=101", headers=headers).status_code == 422
    assert c.get("/dashboard/operational-plan?receipts_limit=1&shipments_limit=100", headers=headers).status_code == 200


# ---------------------------------------------------------------- service: _priority


def test_priority_classification():
    today = date(2026, 6, 15)
    assert _priority(None, today) == "no_date"
    assert _priority("2026-06-14", today) == "overdue"
    assert _priority("2026-06-15", today) == "today"
    assert _priority("2026-06-16", today) == "upcoming"
    assert _priority("2026-06-16", today, active=True) == "active"
    # active не перебивает просрочку и «сегодня».
    assert _priority("2026-06-14", today, active=True) == "overdue"
    assert _priority("2026-06-15", today, active=True) == "today"


# ---------------------------------------------------------------- seeding helpers


def _receipt_payload(client_id: str, day: date, planned_qty: int) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "supplier_name": "Test Supplier",
        "arrival_date": day.isoformat(),
        "comment": "dashboard test",
        "lines": [{
            "product_id": str(uuid.uuid4()),
            "product_name": "Dash Product",
            "product_sku": f"DASH-{uuid.uuid4().hex[:8]}",
            "color_id": str(uuid.uuid4()),
            "color_name": "Red",
            "size_id": None,
            "size_name": None,
            "planned_qty": planned_qty,
        }],
    }


def _seed_planned_receipt(admin_client, client_id: str, day: date, planned_qty: int) -> str:
    r = admin_client.post("/receipts", json=_receipt_payload(client_id, day, planned_qty))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    assert adv.status_code == 200, adv.text
    return doc_id


def _seed_shipment(admin_client, client_id: str, day: date, qty: int) -> str:
    r = admin_client.post("/shipments", json={
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": day.isoformat(),
        "comment": "dashboard test",
        "lines": [{
            "product_id": str(uuid.uuid4()),
            "product_name": "Dash Pack Product",
            "product_sku": f"DASH-{uuid.uuid4().hex[:8]}",
            "color_id": str(uuid.uuid4()),
            "color_name": "Blue",
            "size_id": None,
            "size_name": None,
            "qty": qty,
            "shipped_qty": 0,
        }],
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _seed_dispatch(admin_client, client_id: str, day: date, *, qty: int, shipped_qty: int) -> str:
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Москва",
        "ship_date": day.isoformat(),
        "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    now = datetime.now(UTC).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO dispatch_lines "
            "(id,doc_id,product_id,product_name,product_sku,color_id,color_name,"
            "size_id,size_name,qty,pallets_qty,boxes_qty,shipped_qty,site_url,store_id,store_name,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), doc_id, str(uuid.uuid4()), "Dash Ship Product",
             f"DASH-{uuid.uuid4().hex[:8]}", None, None, None, None,
             qty, None, None, shipped_qty, None, None, None, now),
        )
        conn.commit()
    return doc_id


def _seed_defect_on_day(client_id: str, day: date, qty: int) -> None:
    """Прямая запись в журнал: конвертация good→defect с created_at внутри локальных суток day."""
    start, _ = _local_day_utc_range(day)
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO zone_relocations
               (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                client_id,client_name,from_op,to_op,from_quality,to_quality,
                from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (str(uuid.uuid4()), str(uuid.uuid4()), "Dash Defect Product", "DASH-DEF",
             None, None, None, None, client_id, "Test Client",
             "storage", "storage", "good", "defect",
             None, None, None, None, qty, "dashboard test", start, "test-admin-id"),
        )
        conn.commit()


# ---------------------------------------------------------------- service: day_stats


def test_day_stats_counts_seeded_documents(admin_client, client_id):
    day = _unique_past_day()
    with get_connection() as conn:
        base = day_stats(conn, day)

    # Поступление: план 12, факт 5.
    receipt_id = _seed_planned_receipt(admin_client, client_id, day, planned_qty=12)
    with get_connection() as conn:
        conn.execute("UPDATE receipt_lines SET accepted_qty = 5 WHERE doc_id = ?", (receipt_id,))
        conn.commit()

    # Задача упаковки: план 8, упаковано (packing→packed годный) 5.
    shipment_id = _seed_shipment(admin_client, client_id, day, qty=8)
    with get_connection() as conn:
        line = conn.execute(
            "SELECT * FROM shipment_lines WHERE doc_id = ?", (shipment_id,)
        ).fetchone()
        insert_inventory_move(
            conn,
            product_id=line["product_id"], product_name=line["product_name"],
            product_sku=line["product_sku"], color_id=line["color_id"],
            color_name=line["color_name"], size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="packed", from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None, to_zone_id=None, to_zone_name=None,
            qty=5, user_id="test-admin-id", shipment_line_id=line["id"],
        )
        conn.commit()

    # Отгрузка клиенту (dispatch): план 10, отгружено 4.
    _seed_dispatch(admin_client, client_id, day, qty=10, shipped_qty=4)

    # Брак за день: 3 шт.
    _seed_defect_on_day(client_id, day, 3)

    with get_connection() as conn:
        stats = day_stats(conn, day)
    assert stats["arrivals"]["plan"] == base["arrivals"]["plan"] + 12
    assert stats["arrivals"]["fact"] == base["arrivals"]["fact"] + 5
    assert stats["packed"]["plan"] == base["packed"]["plan"] + 8
    assert stats["packed"]["fact"] == base["packed"]["fact"] + 5
    assert stats["shipped"]["plan"] == base["shipped"]["plan"] + 10
    assert stats["shipped"]["fact"] == base["shipped"]["fact"] + 4
    assert stats["defects"] == base["defects"] + 3

    # Соседний день не затронут.
    with get_connection() as conn:
        other = day_stats(conn, day + timedelta(days=1))
    assert other["arrivals"]["plan"] == 0
    assert other["shipped"]["plan"] == 0


def test_day_stats_excludes_cancelled_receipt(admin_client, client_id):
    day = _unique_past_day()
    with get_connection() as conn:
        base = day_stats(conn, day)

    receipt_id = _seed_planned_receipt(admin_client, client_id, day, planned_qty=7)
    with get_connection() as conn:
        assert day_stats(conn, day)["arrivals"]["plan"] == base["arrivals"]["plan"] + 7

    cancelled = admin_client.post(f"/receipts/{receipt_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    with get_connection() as conn:
        assert day_stats(conn, day)["arrivals"]["plan"] == base["arrivals"]["plan"]


# ---------------------------------------------------------------- service: operational_plan


def test_operational_plan_lists_seeded_docs(admin_client, client_id):
    day = _unique_past_day()

    receipt_id = _seed_planned_receipt(admin_client, client_id, day, planned_qty=4)
    # Черновик в план не попадает (только planned).
    draft = admin_client.post("/receipts", json=_receipt_payload(client_id, day, 2))
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["message"]

    shipment_id = _seed_shipment(admin_client, client_id, day, qty=6)
    with get_connection() as conn:
        # Черновик задачи упаковки в оперплан не входит — статус двигаем напрямую,
        # чтобы не проходить весь поток принятия задачи с гейтом остатков.
        conn.execute("UPDATE shipment_docs SET status = 'packing' WHERE id = ?", (shipment_id,))
        conn.commit()

    with get_connection() as conn:
        plan_today = operational_plan(conn, receipts_limit=100, shipments_limit=100, today=day)

    rec = next(i for i in plan_today["receipts"] if i["id"] == receipt_id)
    assert rec["type"] == "receipt"
    assert rec["doc_number"].startswith("WH-")
    assert rec["date"] == day.isoformat()
    assert rec["date_kind"] == "arrival"
    assert rec["sku_count"] == 1
    assert rec["total_qty"] == 4
    assert rec["progress_qty"] == 0
    assert rec["overdue"] is False
    assert rec["priority"] == "today"
    assert all(i["id"] != draft_id for i in plan_today["receipts"])

    shp = next(i for i in plan_today["shipments"] if i["id"] == shipment_id)
    assert shp["type"] == "shipment"
    assert shp["date_kind"] == "ship"
    assert shp["total_qty"] == 6
    assert shp["destination"] == "Moscow"
    assert shp["overdue"] is False
    assert shp["priority"] == "today"

    assert plan_today["totals"]["receipts"] >= 1
    assert plan_today["totals"]["shipments"] >= 1
    assert plan_today["exceptions"] == []

    # На следующий день оба документа просрочены.
    with get_connection() as conn:
        plan_next = operational_plan(
            conn, receipts_limit=100, shipments_limit=100, today=day + timedelta(days=1)
        )
    rec2 = next(i for i in plan_next["receipts"] if i["id"] == receipt_id)
    assert rec2["overdue"] is True
    assert rec2["priority"] == "overdue"
    shp2 = next(i for i in plan_next["shipments"] if i["id"] == shipment_id)
    assert shp2["overdue"] is True
    assert plan_next["totals"]["overdue"] >= 2

    # Лимиты выборки соблюдаются.
    with get_connection() as conn:
        plan_lim = operational_plan(conn, receipts_limit=1, shipments_limit=1, today=day)
    assert len(plan_lim["receipts"]) <= 1
    assert len(plan_lim["shipments"]) <= 1
