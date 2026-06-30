"""Тесты финрезультата «доходы vs расходы» (P&L). Требует DATABASE_URL.

Проверяем доход логистики и палет по ФАКТИЧЕСКОМУ дню рейса (arrived_at), а не по дате
документа; рентабельность рейса (доход − себестоимость); гейтинг по финансовой роли.
"""
from __future__ import annotations

import os
from uuid import uuid4

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    warehouse_client,
)


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
        disp_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM dispatch_docs WHERE client_id = ?", (client_id,)
            ).fetchall()
        ]
        trip_line_ids = []
        for sid in disp_ids:
            trip_line_ids += [
                r["id"] for r in conn.execute(
                    "SELECT id FROM trip_lines WHERE dispatch_doc_id = ?", (sid,)
                ).fetchall()
            ]
        trip_ids = []
        for tlid in trip_line_ids:
            trip_ids += [
                r["trip_id"] for r in conn.execute(
                    "SELECT trip_id FROM trip_lines WHERE id = ?", (tlid,)
                ).fetchall()
            ]
        for sid in disp_ids:
            conn.execute("DELETE FROM trip_lines WHERE dispatch_doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (sid,))
        for tid in set(trip_ids):
            conn.execute("DELETE FROM trip_ops WHERE trip_id = ?", (tid,))
            conn.execute("DELETE FROM trip_docs WHERE id = ?", (tid,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM client_pallet_prices WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


def _dispatch_in_trip(
    admin_client, client_id: str, *,
    pallets: list[int], logistics_rub: float, trip_cost_rub: float,
    ship_date: str, arrived_at: str,
) -> tuple[str, str]:
    """Отгрузка с палетами и стоимостью логистики, привязанная к закрытому рейсу
    с фактической датой прибытия. Возвращает (dispatch_id, trip_number)."""
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": ship_date, "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    now = f"{ship_date}T00:00:00+00:00"
    trip_id = str(uuid4())
    trip_number = f"TR-T{uuid4().hex[:6]}"
    with get_connection() as conn:
        for i, pq in enumerate(pallets):
            conn.execute(
                "INSERT INTO dispatch_lines "
                "(id,doc_id,product_id,product_name,product_sku,color_id,color_name,"
                "size_id,size_name,qty,pallets_qty,shipped_qty,site_url,store_id,store_name,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"{doc_id}-l{i}", doc_id, f"p-{i}", f"Товар {i}", f"P{i}",
                 None, None, None, None, 10, pq, 10, None, None, None, now),
            )
        conn.execute(
            "UPDATE dispatch_docs SET status = 'shipped', logistics_cost = ? WHERE id = ?",
            (logistics_rub, doc_id),
        )
        conn.execute(
            "INSERT INTO trip_docs (id,trip_number,direction,status,cargo_type,arrived_at,"
            "logistics_cost_actual,carrier_name,created_at,is_deleted) "
            "VALUES (?,?,?,?,?,?,?,?,?,0)",
            (trip_id, trip_number, "outbound", "closed", "good", arrived_at,
             trip_cost_rub, "Перевозчик-Т", now),
        )
        conn.execute(
            "INSERT INTO trip_lines (id,trip_id,dispatch_doc_id,client_id,client_name,created_at,is_deleted) "
            "VALUES (?,?,?,?,?,?,0)",
            (str(uuid4()), trip_id, doc_id, client_id, "Test Client", now),
        )
        conn.commit()
    return doc_id, trip_number


def test_pnl_income_by_trip_day(admin_client, client_id):
    # Палеты 5 шт × 35000 коп = 175000; логистика клиента 1000 ₽ = 100000 коп.
    # Дата документа 10.06, но рейс прибыл 12.06 → доход относится к 12.06.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    _dispatch_in_trip(
        admin_client, client_id, pallets=[3, 2], logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )

    body = admin_client.get(
        f"/pnl?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()

    assert body["days"] == 30
    assert len(body["axis"]) == 30
    assert len(body["income_series"]) == 30
    assert body["income_total"] == 275000  # доход скоуплен клиентом → детерминирован

    sources = {s["key"]: s["amount"] for s in body["income_sources"]}
    assert sources.get("logistics") == 100000
    assert sources.get("pallets") == 175000

    # Доход лёг на день рейса (12.06 = индекс 11), а не на дату документа (10.06 = индекс 9).
    assert body["income_series"][11] == 275000
    assert body["income_series"][9] == 0


def test_pnl_trip_profitability(admin_client, client_id):
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    _, trip_number = _dispatch_in_trip(
        admin_client, client_id, pallets=[3, 2], logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )

    body = admin_client.get("/pnl/trips?date_from=2026-06-01&date_to=2026-06-30").json()
    row = next((it for it in body["items"] if it["trip_number"] == trip_number), None)
    assert row is not None, "рейс не найден в отчёте рентабельности"
    assert row["income_kop"] == 275000          # логистика 100000 + палеты 175000
    assert row["cost_kop"] == 40000             # себестоимость рейса 400 ₽
    assert row["margin_kop"] == 235000
    assert row["day"] == "2026-06-12"


def test_pnl_empty_window_ok(admin_client, client_id):
    body = admin_client.get(
        f"/pnl?date_from=2026-06-01&date_to=2026-06-07&client_id={client_id}"
    ).json()
    assert body["days"] == 7
    assert body["income_total"] == 0
    assert body["income_sources"] == []
    assert body["net_cumulative"][-1] == -body["expense_total"]


def test_pnl_requires_finance_role(warehouse_client, client_id):
    assert warehouse_client.get(
        "/pnl?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
    assert warehouse_client.get(
        "/pnl/trips?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
