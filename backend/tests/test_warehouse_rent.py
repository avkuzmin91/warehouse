"""Тесты effective-dated ставки аренды склада: справочник ставок (история),
действующая ставка по дате и связь с начислением аренды. Требует DATABASE_URL.
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
    manager_client,
)


def _make_warehouse(admin_client, *, rent: int | None = None) -> str:
    tag = uuid.uuid4().hex[:8]
    body = {"name": f"Аренда-{tag}", "is_active": True}
    if rent is not None:
        body["rent_monthly_kopecks"] = rent
    assert admin_client.post("/own-warehouses", json=body).status_code == 200
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM own_warehouses WHERE name = ?", (body["name"],)
        ).fetchone()
    return str(row["id"])


def _cleanup(wid: str) -> None:
    with get_connection() as conn:
        eids = [r["id"] for r in conn.execute(
            "SELECT id FROM material_expenses WHERE source_kind='warehouse' AND source_id=?", (wid,)
        ).fetchall()]
        for eid in eids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
        conn.execute("DELETE FROM material_expenses WHERE source_kind='warehouse' AND source_id=?", (wid,))
        conn.execute("DELETE FROM warehouse_rent_rates WHERE warehouse_id=?", (wid,))
        conn.execute("DELETE FROM own_warehouses WHERE id=?", (wid,))
        conn.commit()


@pytest.fixture
def warehouse_id(admin_client):  # noqa: F811
    wid = _make_warehouse(admin_client)
    yield wid
    _cleanup(wid)


def test_set_and_get_warehouse_rent(admin_client, warehouse_id):  # noqa: F811
    r = admin_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                          json={"rent_monthly_kopecks": 12000000, "effective_from": "2026-06-01"})
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/own-warehouses/{warehouse_id}/rent-rates").json()
    assert d["rent_monthly_kopecks"] == 12000000
    assert len(d["history"]) == 1


def test_rent_rate_effective_dated(admin_client, warehouse_id):  # noqa: F811
    admin_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                      json={"rent_monthly_kopecks": 10000000, "effective_from": "2026-06-01"})
    admin_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                      json={"rent_monthly_kopecks": 15000000, "effective_from": "2026-08-01"})
    from modules.warehouse_rent.service import rent_rate_for_event
    with get_connection() as conn:
        assert rent_rate_for_event(conn, warehouse_id, "2026-05-01") == 10000000  # назад
        assert rent_rate_for_event(conn, warehouse_id, "2026-07-01") == 10000000
        assert rent_rate_for_event(conn, warehouse_id, "2026-09-01") == 15000000


def test_rent_cache_synced_on_change(admin_client, warehouse_id):  # noqa: F811
    admin_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                      json={"rent_monthly_kopecks": 9000000})
    wh = admin_client.get(f"/own-warehouses/{warehouse_id}").json()
    assert wh["rent_monthly_kopecks"] == 9000000


def test_delete_rent_rate_resets(admin_client, warehouse_id):  # noqa: F811
    admin_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                      json={"rent_monthly_kopecks": 7000000})
    d = admin_client.get(f"/own-warehouses/{warehouse_id}/rent-rates").json()
    rate_id = d["history"][0]["id"]
    assert admin_client.delete(f"/own-warehouses/{warehouse_id}/rent-rates/{rate_id}").status_code == 200
    after = admin_client.get(f"/own-warehouses/{warehouse_id}/rent-rates").json()
    assert after["rent_monthly_kopecks"] is None
    wh = admin_client.get(f"/own-warehouses/{warehouse_id}").json()
    assert wh["rent_monthly_kopecks"] is None


def test_create_with_rent_seeds_history(admin_client):  # noqa: F811
    wid = _make_warehouse(admin_client, rent=8000000)
    try:
        d = admin_client.get(f"/own-warehouses/{wid}/rent-rates").json()
        assert d["rent_monthly_kopecks"] == 8000000
        assert len(d["history"]) == 1
    finally:
        _cleanup(wid)


def test_accrual_uses_effective_rate(admin_client):  # noqa: F811
    wid = _make_warehouse(admin_client, rent=10000000)
    try:
        # Со 2026-08-01 ставка выросла — августовское начисление берёт новую.
        admin_client.post(f"/own-warehouses/{wid}/rent-rates",
                          json={"rent_monthly_kopecks": 13000000, "effective_from": "2026-08-01"})
        assert admin_client.post("/expenses/rent/accruals/run?on_date=2026-07-01").status_code == 200
        assert admin_client.post("/expenses/rent/accruals/run?on_date=2026-08-01").status_code == 200
        items = admin_client.get("/expenses?kind=rent&limit=200").json()["items"]
        by_period = {e["period_start"]: e for e in items if e["source_id"] == wid}
        assert by_period["2026-07-01"]["amount"] == 10000000
        assert by_period["2026-08-01"]["amount"] == 13000000
    finally:
        _cleanup(wid)


def test_manager_forbidden(admin_client, manager_client, warehouse_id):  # noqa: F811
    assert manager_client.get(f"/own-warehouses/{warehouse_id}/rent-rates").status_code == 403
    assert manager_client.post(f"/own-warehouses/{warehouse_id}/rent-rates",
                               json={"rent_monthly_kopecks": 100}).status_code == 403
