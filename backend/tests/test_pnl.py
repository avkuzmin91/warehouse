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
        for tlid in trip_line_ids:
            conn.execute("DELETE FROM trip_alloc WHERE trip_line_id = ?", (tlid,))
        for sid in disp_ids:
            conn.execute("DELETE FROM trip_lines WHERE dispatch_doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (sid,))
        for tid in set(trip_ids):
            conn.execute("DELETE FROM trip_ops WHERE trip_id = ?", (tid,))
            conn.execute("DELETE FROM trip_docs WHERE id = ?", (tid,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM client_pallet_prices WHERE client_id = ?", (client_id,))
        conn.execute("DELETE FROM client_box_prices WHERE client_id = ?", (client_id,))
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
    ship_date: str, arrived_at: str, boxes: list[int] | None = None,
) -> tuple[str, str]:
    """Отгрузка с палетами (и опц. коробами) и стоимостью логистики, привязанная к закрытому
    рейсу с фактической датой прибытия. Возвращает (dispatch_id, trip_number)."""
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
            bq = boxes[i] if boxes else None
            conn.execute(
                "INSERT INTO dispatch_lines "
                "(id,doc_id,product_id,product_name,product_sku,color_id,color_name,"
                "size_id,size_name,qty,pallets_qty,boxes_qty,shipped_qty,site_url,store_id,store_name,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"{doc_id}-l{i}", doc_id, f"p-{i}", f"Товар {i}", f"P{i}",
                 None, None, None, None, 10, pq, bq, 10, None, None, None, now),
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


def test_pnl_income_includes_boxes(admin_client, client_id):
    # Короба 10 шт × 9000 коп = 90000 — отдельный источник дохода наравне с палетами.
    # Палеты 5 × 35000 = 175000, логистика 1000 ₽ = 100000, короба 90000 → итого 365000.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    admin_client.post(f"/box-pricing/clients/{client_id}/prices",
                      json={"price_kop": 9000, "effective_from": "2026-06-01"})
    _, trip_number = _dispatch_in_trip(
        admin_client, client_id, pallets=[3, 2], boxes=[4, 6],
        logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )

    body = admin_client.get(
        f"/pnl?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    sources = {s["key"]: s["amount"] for s in body["income_sources"]}
    assert sources.get("boxes") == 90000
    assert sources.get("pallets") == 175000
    assert body["income_total"] == 365000

    # Детализация дня рейса тоже несёт короба отдельным источником.
    day = admin_client.get(
        f"/pnl/day?date=2026-06-12&date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    day_src = {s["key"]: s["amount"] for s in day["income_sources"]}
    assert day_src.get("boxes") == 90000

    # Рентабельность рейса — только логистика клиента; палеты и короба сюда не входят.
    trips = admin_client.get("/pnl/trips?date_from=2026-06-01&date_to=2026-06-30").json()
    row = next(r for r in trips["items"] if r["trip_number"] == trip_number)
    assert row["income_kop"] == 100000


def test_pnl_day_detail_matches_bar(admin_client, client_id):
    # Тот же сценарий: палеты 175000 + логистика 100000, доход лёг на день рейса 12.06.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    doc_id, _ = _dispatch_in_trip(
        admin_client, client_id, pallets=[3, 2], logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )

    # День детализации считается в окне графика → его доход совпадает со столбиком 12.06.
    day = admin_client.get(
        f"/pnl/day?date=2026-06-12&date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    assert day["date"] == "2026-06-12"
    assert day["income_total"] == 275000
    assert day["net_total"] == 275000 - day["expense_total"]

    src = {s["key"]: s for s in day["income_sources"]}
    assert src["logistics"]["amount"] == 100000
    assert src["pallets"]["amount"] == 175000
    # Первоисточник логистики ссылается на реальную отгрузку.
    log_item = src["logistics"]["items"][0]
    assert log_item["ref_kind"] == "dispatch"
    assert log_item["ref_id"] == doc_id

    # Пустой день внутри окна: доход нулевой, источников нет.
    empty = admin_client.get(
        f"/pnl/day?date=2026-06-10&date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    assert empty["income_total"] == 0
    assert empty["income_sources"] == []


def test_pnl_day_requires_finance_role(warehouse_client, client_id):
    assert warehouse_client.get(
        "/pnl/day?date=2026-06-12&date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403


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
    assert row["income_kop"] == 100000          # только логистика клиента 1000 ₽ (палеты — отдельно)
    assert row["cost_kop"] == 40000             # себестоимость рейса 400 ₽
    assert row["margin_kop"] == 60000
    assert row["margin_pct"] == 150.0           # рентабельность = 60000 / 40000
    assert row["day"] == "2026-06-12"
    assert row["client_names"] == ["Test Client"]

    # Фильтр по клиенту: свой клиент — рейс есть, чужой — отсутствует.
    filtered = admin_client.get(
        f"/pnl/trips?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    assert any(it["trip_number"] == trip_number for it in filtered["items"])
    other = admin_client.get(
        f"/pnl/trips?date_from=2026-06-01&date_to=2026-06-30&client_id={uuid4()}"
    ).json()
    assert all(it["trip_number"] != trip_number for it in other["items"])


def test_pnl_trip_margin_pct_zero_income(admin_client, client_id):
    """Рентабельность = прибыль / себестоимость: доход 0 при себестоимости 5000 ₽ → −100%."""
    _, trip_number = _dispatch_in_trip(
        admin_client, client_id, pallets=[1], logistics_rub=0.0, trip_cost_rub=5000.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )
    body = admin_client.get("/pnl/trips?date_from=2026-06-01&date_to=2026-06-30").json()
    row = next(it for it in body["items"] if it["trip_number"] == trip_number)
    assert row["income_kop"] == 0
    assert row["cost_kop"] == 500000
    assert row["margin_pct"] == -100.0


def test_pnl_trip_logistics_apportioned_by_qty(admin_client, client_id):
    """Логистика одного документа, разбитого на два рейса, делится пропорционально
    перевезённому количеству (trip_alloc.qty), а не начисляется целиком на каждый рейс."""
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    now = "2026-06-10T00:00:00+00:00"
    line_id = f"{doc_id}-l0"
    # Рейс A везёт 4 ед, рейс B — 6 ед из 10; логистика документа 1000 ₽ → 400 / 600.
    trips = [("TR-A" + uuid4().hex[:6], "2026-06-12T08:00:00+00:00", 4),
             ("TR-B" + uuid4().hex[:6], "2026-06-13T08:00:00+00:00", 6)]
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO dispatch_lines "
            "(id,doc_id,product_id,product_name,product_sku,qty,pallets_qty,boxes_qty,shipped_qty,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (line_id, doc_id, "p-0", "Товар 0", "P0", 10, 5, 0, 10, now),
        )
        conn.execute(
            "UPDATE dispatch_docs SET status = 'shipped', logistics_cost = ? WHERE id = ?",
            (1000.0, doc_id),
        )
        for trip_number, arrived_at, qty in trips:
            trip_id = str(uuid4())
            trip_line_id = str(uuid4())
            conn.execute(
                "INSERT INTO trip_docs (id,trip_number,direction,status,cargo_type,arrived_at,"
                "logistics_cost_actual,carrier_name,created_at,is_deleted) "
                "VALUES (?,?,?,?,?,?,?,?,?,0)",
                (trip_id, trip_number, "outbound", "closed", "good", arrived_at, 0, "Перевозчик-Т", now),
            )
            conn.execute(
                "INSERT INTO trip_lines (id,trip_id,dispatch_doc_id,client_id,client_name,created_at,is_deleted) "
                "VALUES (?,?,?,?,?,?,0)",
                (trip_line_id, trip_id, doc_id, client_id, "Test Client", now),
            )
            conn.execute(
                "INSERT INTO trip_alloc (id,trip_line_id,dispatch_line_id,qty,created_at) VALUES (?,?,?,?,?)",
                (str(uuid4()), trip_line_id, line_id, qty, now),
            )
        conn.commit()

    body = admin_client.get("/pnl/trips?date_from=2026-06-01&date_to=2026-06-30").json()
    by_num = {it["trip_number"]: it for it in body["items"]}
    assert by_num[trips[0][0]]["income_kop"] == 40000   # 1000 ₽ × 4/10
    assert by_num[trips[1][0]]["income_kop"] == 60000   # 1000 ₽ × 6/10


def test_pnl_empty_window_ok(admin_client, client_id):
    body = admin_client.get(
        f"/pnl?date_from=2026-06-01&date_to=2026-06-07&client_id={client_id}"
    ).json()
    assert body["days"] == 7
    assert body["income_total"] == 0
    assert body["income_sources"] == []
    assert body["net_cumulative"][-1] == -body["expense_total"]


def test_income_analytics_mirrors_pnl(admin_client, client_id):
    # Тот же сценарий, что test_pnl_income_by_trip_day: палеты 175000 + логистика 100000.
    admin_client.post(f"/pallet-pricing/clients/{client_id}/prices",
                      json={"price_kop": 35000, "effective_from": "2026-06-01"})
    _dispatch_in_trip(
        admin_client, client_id, pallets=[3, 2], logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )

    inc = admin_client.get(
        f"/pnl/income?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()

    assert inc["days"] == 30
    assert len(inc["series"]) == 30
    # Итог аналитики доходов копейка-в-копейку = income_total из P&L (общий _income_by_source).
    pnl = admin_client.get(
        f"/pnl?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()
    assert inc["total_amount"] == pnl["income_total"] == 275000

    sources = {s["key"]: sum(s["series"]) for s in inc["sources"]}
    assert sources.get("logistics") == 100000
    assert sources.get("pallets") == 175000

    # Доход лёг на день рейса (12.06 = индекс 11), а не на дату документа (10.06).
    assert inc["series"][11]["amount"] == 275000
    assert inc["series"][9]["amount"] == 0

    # Разрез по клиентам: единственный клиент несёт весь доход.
    assert len(inc["by_client"]) == 1
    assert inc["by_client"][0]["id"] == client_id
    assert inc["by_client"][0]["amount"] == 275000


def test_income_analytics_empty_window_ok(admin_client, client_id):
    inc = admin_client.get(
        f"/pnl/income?date_from=2026-06-01&date_to=2026-06-07&client_id={client_id}"
    ).json()
    assert inc["days"] == 7
    assert inc["total_amount"] == 0
    assert inc["sources"] == []
    assert inc["by_client"] == []


def test_logistics_analytics_by_vehicle(admin_client, client_id):
    """Аналитика логистики: KPI, «потрачено» = себестоимость + простой, разрез по кузовам
    (рейс без кузова — в строке «Не указан»), динамика по дням и фильтр направления."""
    _, trip_a = _dispatch_in_trip(
        admin_client, client_id, pallets=[1], logistics_rub=1000.0, trip_cost_rub=400.0,
        ship_date="2026-06-10", arrived_at="2026-06-12T08:00:00+00:00",
    )
    _, trip_b = _dispatch_in_trip(
        admin_client, client_id, pallets=[1], logistics_rub=500.0, trip_cost_rub=300.0,
        ship_date="2026-06-11", arrived_at="2026-06-13T08:00:00+00:00",
    )
    with get_connection() as conn:
        # Рейс A — «Фура», с простоем 100 ₽ / 30 мин; рейс B — кузов не указан.
        conn.execute(
            "UPDATE trip_docs SET vehicle_type_id = ?, vehicle_type_name = ?, "
            "waiting_cost = ?, waiting_minutes = ?, load_factor = ? WHERE trip_number = ?",
            ("vt-fura", "Фура", 100.0, 30, "full", trip_a),
        )
        conn.commit()

    body = admin_client.get(
        f"/pnl/logistics?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}"
    ).json()

    assert body["trips_total"] == 2
    assert body["trips_inbound"] == 0
    assert body["trips_outbound"] == 2
    assert body["income_total"] == 150000                  # 1000 + 500 ₽ логистики клиента
    assert body["spent_total"] == 80000                    # (400+100) + 300 ₽
    assert body["margin_total"] == 70000
    assert body["waiting_total_kop"] == 10000
    assert body["waiting_minutes_total"] == 30
    assert body["trips_full"] == 1
    assert body["trips_no_income"] == 0

    by_vehicle = {g["name"]: g for g in body["by_vehicle"]}
    fura = by_vehicle["Фура"]
    assert fura["trips"] == 1
    assert fura["spent_kop"] == 50000                      # 400 ₽ + 100 ₽ простоя
    assert fura["income_kop"] == 100000
    assert fura["margin_pct"] == 100.0
    none_row = by_vehicle["Не указан"]
    assert none_row["id"] is None
    assert none_row["spent_kop"] == 30000
    assert none_row["income_kop"] == 50000

    # Динамика: деньги легли на дни фактического прибытия рейсов.
    series = {p["date"]: p for p in body["series"]}
    assert series["2026-06-12"]["trips_outbound"] == 1
    assert series["2026-06-12"]["income_kop"] == 100000
    assert series["2026-06-13"]["spent_kop"] == 30000
    assert series["2026-06-10"]["trips_outbound"] == 0

    # Фильтр направления: поступлений в сценарии нет.
    inbound = admin_client.get(
        f"/pnl/logistics?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}&direction=inbound"
    ).json()
    assert inbound["trips_total"] == 0
    # Фильтр по кузову: остаётся только «Фура».
    only_fura = admin_client.get(
        f"/pnl/logistics?date_from=2026-06-01&date_to=2026-06-30&client_id={client_id}&vehicle_type_id=vt-fura"
    ).json()
    assert only_fura["trips_total"] == 1
    assert only_fura["spent_total"] == 50000


def test_pnl_requires_finance_role(warehouse_client, client_id):
    assert warehouse_client.get(
        "/pnl?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
    assert warehouse_client.get(
        "/pnl/income?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
    assert warehouse_client.get(
        "/pnl/trips?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
    assert warehouse_client.get(
        "/pnl/logistics?date_from=2026-06-01&date_to=2026-06-30"
    ).status_code == 403
