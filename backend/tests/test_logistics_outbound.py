"""Интеграционные тесты outbound-рейсов (отгрузки) и каскада packing → shipped.

Зеркало test_logistics.py. Требует DATABASE_URL.
Каскад тестируется на отгрузке без строк: проверка остатков проходит вхолостую
(как в test_shipments.test_shipment_advance_packing_to_shipped).
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _packing_shipment(admin_client, client_id: str) -> str:
    r = admin_client.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "comment": "ТЗ", "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert adv.status_code == 200, adv.text
    assert adv.json()["message"] == "packing"
    return doc_id


def _defect_shipment(admin_client, client_id: str) -> str:
    """Брак-отгрузка в черновике (без строк) — для проверок привязки по типу груза."""
    r = admin_client.post("/shipments", json={
        "cargo_type": "defect", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "lines": [],
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _force_status(doc_id: str, status: str) -> None:
    """Тестовый шорткат: проставить статус отгрузки напрямую.

    Полный путь до «Ожидает рейс» (приёмка → упаковка → раскладка по местам)
    покрыт в test_packing_qc; здесь нас интересует только каскад/гейт рейса.
    """
    with get_connection() as conn:
        conn.execute("UPDATE shipment_docs SET status = ? WHERE id = ?", (status, doc_id))
        conn.commit()


def _handoff_ready_outbound(admin_client, shipment_id: str, cargo_type: str = "good") -> str:
    create = admin_client.post("/trips", json={
        "direction": "outbound",
        "cargo_type": cargo_type,
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77",
        "cost_estimate": 8000,
        "transport_ordered_at": "2026-06-09T10:00",
        "eta": "2026-06-10T08:00",
        "shipment_doc_ids": [shipment_id],
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


def test_outbound_full_flow_cascades_shipment_to_shipped(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    trip_id = _handoff_ready_outbound(admin_client, shipment_id)

    detail = admin_client.get(f"/trips/{trip_id}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["doc"]["direction"] == "outbound"
    assert data["doc"]["status"] == "draft"
    assert data["doc"]["trip_number"].startswith("TR-")
    assert len(data["shipments"]) == 1
    assert data["shipments"][0]["shipment_doc_id"] == shipment_id
    assert data["receipts"] == []
    trip_number = data["doc"]["trip_number"]

    # Привязанная отгрузка уже знает свой рейс (план).
    linked = admin_client.get(f"/shipments/{shipment_id}").json()
    assert linked["trip_id"] == trip_id
    assert linked["trip_number"] == trip_number
    assert linked["actual_ship_date"] is None

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    arrival = admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"})
    assert arrival.json()["message"] == "unloading"

    # Кладовщик подготовил отгрузку к рейсу («Ожидает рейс») — теперь погрузку можно завершить.
    _force_status(shipment_id, "awaiting_trip")

    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full",
        "unload_started_at": "2026-06-10T07:35",
        "unload_finished_at": "2026-06-10T08:10",
    })
    assert unload.status_code == 200, unload.text
    assert unload.json()["message"] == "costing"

    # Каскад: привязанная отгрузка awaiting_trip → shipped, факт. дата отправления проставлена.
    ship = admin_client.get(f"/shipments/{shipment_id}").json()
    assert ship["status"] == "shipped"
    assert ship["actual_ship_date"] == "2026-06-10"
    assert ship["trip_id"] == trip_id
    assert ship["trip_number"] == trip_number

    close = admin_client.post(f"/trips/{trip_id}/close")
    assert close.status_code == 200, close.text
    assert close.json()["message"] == "closed"


def test_outbound_unload_blocked_until_shipments_awaiting_trip(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    trip_id = _handoff_ready_outbound(admin_client, shipment_id)

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"

    # Отгрузка ещё «В плане» — завершить погрузку нельзя.
    blocked = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert blocked.status_code == 400, blocked.text
    assert "не готовы к рейсу" in blocked.json()["detail"]

    # Рейс остался в погрузке, отгрузка не отправлена.
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["status"] == "unloading"
    assert admin_client.get(f"/shipments/{shipment_id}").json()["status"] == "packing"

    # Готовим к рейсу — погрузку можно завершить, отгрузка уходит в shipped.
    _force_status(shipment_id, "awaiting_trip")
    ok = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full",
        "unload_started_at": "2026-06-10T07:35",
        "unload_finished_at": "2026-06-10T08:10",
    })
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/shipments/{shipment_id}").json()["status"] == "shipped"


def test_outbound_unlink_shipment_during_loading(admin_client, client_id):
    """Транспорт приехал, отгрузка не успела упаковаться — менеджер открепляет её в погрузке."""
    ready = _packing_shipment(admin_client, client_id)
    late = _packing_shipment(admin_client, client_id)
    trip_id = _handoff_ready_outbound(admin_client, ready)
    link = admin_client.post(f"/trips/{trip_id}/shipments", json={"items": [{"shipment_doc_id": late, "allocations": []}]})
    assert link.status_code == 200, link.text

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"

    _force_status(ready, "awaiting_trip")

    # Неготовая отгрузка блокирует завершение погрузки.
    blocked = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert blocked.status_code == 400, blocked.text

    # Открепляем её прямо в погрузке.
    unlink = admin_client.delete(f"/trips/{trip_id}/shipments/{late}")
    assert unlink.status_code == 200, unlink.text

    # Привязать обратно в погрузке нельзя.
    relink = admin_client.post(f"/trips/{trip_id}/shipments", json={"items": [{"shipment_doc_id": late, "allocations": []}]})
    assert relink.status_code == 400, relink.text

    # Теперь погрузка завершается, готовая отгрузка уезжает.
    ok = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full",
        "unload_started_at": "2026-06-10T07:35",
        "unload_finished_at": "2026-06-10T08:10",
    })
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/shipments/{ready}").json()["status"] == "shipped"

    # Откреплённая осталась в упаковке и свободна для нового рейса.
    late_ship = admin_client.get(f"/shipments/{late}").json()
    assert late_ship["status"] == "packing"
    assert late_ship["trip_id"] is None

    # После завершения погрузки открепление снова закрыто.
    too_late = admin_client.delete(f"/trips/{trip_id}/shipments/{ready}")
    assert too_late.status_code == 400, too_late.text


def test_outbound_handoff_requires_linked_shipment(admin_client):
    create = admin_client.post("/trips", json={"direction": "outbound", "origin_name": "Склад"})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    assert "отгрузку" in bad.json()["detail"]


def test_outbound_handoff_missing_fields_use_outbound_labels(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    create = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    })
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    detail = bad.json()["detail"]
    assert "Куда" in detail
    assert "Плановое отправление" in detail


def test_shipment_can_be_linked_to_multiple_trips(admin_client, client_id):
    # Отгрузку можно дробить по нескольким рейсам (распределение по строкам).
    shipment_id = _packing_shipment(admin_client, client_id)
    t1 = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    }).json()["message"]
    assert t1
    t2 = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]
    # Та же отгрузка — во второй рейс: теперь разрешено.
    second = admin_client.post(f"/trips/{t2}/shipments", json={"items": [{"shipment_doc_id": shipment_id, "allocations": []}]})
    assert second.status_code == 200, second.text
    # Повторная привязка к тому же рейсу — идемпотентна (без дублей и ошибок).
    again = admin_client.post(f"/trips/{t1}/shipments", json={"items": [{"shipment_doc_id": shipment_id, "allocations": []}]})
    assert again.status_code == 200, again.text


def test_shipment_candidates_include_shipments_linked_to_other_trips(admin_client, client_id):
    # Привязанная к ДРУГОМУ рейсу остаётся кандидатом (остаток можно довезти другим
    # рейсом); исключается только привязанная к ЭТОМУ рейсу.
    own = _packing_shipment(admin_client, client_id)
    other = _packing_shipment(admin_client, client_id)
    free = _packing_shipment(admin_client, client_id)
    own_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [own],
    }).json()["message"]
    other_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [other],
    }).json()["message"]
    assert own_trip and other_trip

    res = admin_client.get(
        f"/shipments?status=packing&available_for_trip_id={own_trip}&client_id={client_id}&limit=200"
    )
    assert res.status_code == 200, res.text
    ids = {item["id"] for item in res.json()["items"]}
    assert own not in ids       # привязана к этому рейсу
    assert other in ids         # привязана к другому рейсу — остаётся кандидатом
    assert free in ids


def test_cross_direction_linking_rejected(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    inbound = admin_client.post("/trips", json={"direction": "inbound"}).json()["message"]
    outbound = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]

    bad_ship = admin_client.post(f"/trips/{inbound}/shipments", json={"items": [{"shipment_doc_id": shipment_id, "allocations": []}]})
    assert bad_ship.status_code == 400, bad_ship.text

    bad_rec = admin_client.post(f"/trips/{outbound}/receipts", json={"receipt_doc_ids": ["whatever"]})
    assert bad_rec.status_code == 400, bad_rec.text


def test_outbound_trip_cargo_type_stored_and_returned(admin_client, client_id):
    trip_id = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "defect", "origin_name": "Склад",
    }).json()["message"]
    # Поступление игнорирует тип груза — всегда 'good'.
    inbound = admin_client.post("/trips", json={
        "direction": "inbound", "cargo_type": "defect",
    }).json()["message"]

    detail = admin_client.get(f"/trips/{trip_id}").json()
    assert detail["doc"]["cargo_type"] == "defect"
    assert admin_client.get(f"/trips/{inbound}").json()["doc"]["cargo_type"] == "good"

    items = admin_client.get("/trips?direction=outbound&limit=200").json()["items"]
    assert any(t["id"] == trip_id and t["cargo_type"] == "defect" for t in items)


def test_outbound_trip_rejects_invalid_cargo_type(admin_client):
    bad = admin_client.post("/trips", json={"direction": "outbound", "cargo_type": "junk"})
    assert bad.status_code == 400, bad.text


def test_link_rejects_cargo_mismatch(admin_client, client_id):
    good_ship = _packing_shipment(admin_client, client_id)
    defect_ship = _defect_shipment(admin_client, client_id)

    good_trip = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]  # cargo = good
    defect_trip = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "defect",
    }).json()["message"]

    # Брак нельзя привязать к рейсу товара.
    bad = admin_client.post(f"/trips/{good_trip}/shipments", json={"items": [{"shipment_doc_id": defect_ship, "allocations": []}]})
    assert bad.status_code == 400, bad.text
    assert "не подходит" in bad.json()["detail"]

    # Товар нельзя привязать к рейсу брака.
    bad2 = admin_client.post(f"/trips/{defect_trip}/shipments", json={"items": [{"shipment_doc_id": good_ship, "allocations": []}]})
    assert bad2.status_code == 400, bad2.text

    # Совпадающий тип груза — ок.
    ok = admin_client.post(f"/trips/{defect_trip}/shipments", json={"items": [{"shipment_doc_id": defect_ship, "allocations": []}]})
    assert ok.status_code == 200, ok.text


def test_create_outbound_with_mismatched_cargo_rejected(admin_client, client_id):
    """Тип груза проверяется и при создании рейса (link_shipments внутри create)."""
    good_ship = _packing_shipment(admin_client, client_id)
    res = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "defect", "shipment_doc_ids": [good_ship],
    })
    assert res.status_code == 400, res.text
    # Отгрузка осталась свободной — рейс не создан (транзакция откатилась).
    assert admin_client.get(f"/shipments/{good_ship}").json()["trip_id"] is None


# --- Дробление отгрузки по нескольким рейсам (распределение по строкам) ---

def _good_shipment_awaiting_with_ready(admin_client, client_id: str, qty: int = 10, ready: int | None = None):
    """Отгрузка (товар) с одной строкой и готовым остатком ready/good, статус awaiting_trip.

    Полный путь (приёмка→упаковка→раскладка) покрыт в test_packing_qc; здесь сразу
    сеем готовый остаток в журнал и ставим «Ожидает рейс», чтобы проверить дробление
    списания по рейсам. `ready` (по умолчанию = qty) задаёт физически готовый остаток —
    меньше плана, чтобы воспроизвести расхождение план-привязки и подготовленного.
    """
    import uuid as _uuid
    ready = qty if ready is None else ready
    pid = str(_uuid.uuid4())
    create = admin_client.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "comment": "ТЗ",
        "lines": [{"product_id": pid, "product_name": "Товар", "product_sku": "SKU-SPLIT",
                   "color_id": None, "color_name": None, "size_id": None, "size_name": None, "qty": qty}],
    })
    assert create.status_code == 200, create.text
    doc_id = create.json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    with get_connection() as conn:
        if ready > 0:
            conn.execute(
                """INSERT INTO zone_relocations
                   (id, product_id, product_name, product_sku, client_id, client_name,
                    from_op, to_op, from_quality, to_quality, to_zone_id, to_zone_name,
                    qty, created_at, created_by, shipment_line_id)
                   VALUES (?, ?, 'Товар', 'SKU-SPLIT', ?, 'Test Client',
                           'packing', 'ready', 'good', 'good', 'zone-ready', 'Готов',
                           ?, NOW(), 'test', ?)""",
                (str(_uuid.uuid4()), pid, client_id, ready, line_id),
            )
        conn.execute("UPDATE shipment_docs SET status = 'awaiting_trip' WHERE id = ?", (doc_id,))
        conn.commit()
    return doc_id, line_id


def _ready_for_line(line_id: str, quality: str = "good") -> int:
    from modules.shipments.service import _line_ready_by_zone
    with get_connection() as conn:
        return sum(z["net"] for z in _line_ready_by_zone(conn, line_id, quality))


def _bare_outbound_trip(admin_client) -> str:
    create = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "good",
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77", "cost_estimate": 8000,
        "transport_ordered_at": "2026-06-09T10:00", "eta": "2026-06-10T08:00",
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


def _drive_to_costing(admin_client, trip_id: str) -> None:
    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"
    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full", "unload_started_at": "2026-06-10T07:35", "unload_finished_at": "2026-06-10T08:10",
    })
    assert unload.status_code == 200, unload.text


def test_shipment_split_across_two_trips(admin_client, client_id):
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10)

    t1 = _bare_outbound_trip(admin_client)
    link1 = admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    assert link1.status_code == 200, link1.text

    t2 = _bare_outbound_trip(admin_client)
    link2 = admin_client.post(f"/trips/{t2}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })
    assert link2.status_code == 200, link2.text

    # Первый рейс увозит 6 → «Частично отгружено», остаток 4 «Готов».
    _drive_to_costing(admin_client, t1)
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "partially_shipped"
    assert ship["lines"][0]["shipped_qty"] == 6
    assert _ready_for_line(line_id) == 4

    # Второй рейс увозит остаток 4 → «Завершён».
    _drive_to_costing(admin_client, t2)
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 10
    assert _ready_for_line(line_id) == 0


def test_shipment_split_across_three_trips(admin_client, client_id):
    # Дробление одной отгрузки по трём рейсам (система не ограничивает двумя).
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=12)

    parts = [5, 5, 2]
    trips = []
    for qty in parts:
        t = _bare_outbound_trip(admin_client)
        link = admin_client.post(f"/trips/{t}/shipments", json={
            "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": qty}]}],
        })
        assert link.status_code == 200, link.text
        trips.append(t)

    shipped = 0
    for t, qty in zip(trips[:-1], parts[:-1]):
        _drive_to_costing(admin_client, t)
        shipped += qty
        ship = admin_client.get(f"/shipments/{doc_id}").json()
        assert ship["status"] == "partially_shipped"
        assert ship["lines"][0]["shipped_qty"] == shipped

    # Последний рейс увозит остаток → «Завершён».
    _drive_to_costing(admin_client, trips[-1])
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 12
    assert _ready_for_line(line_id) == 0


def test_alloc_remaining_is_fact_not_plan(admin_client, client_id):
    # Остаток к распределению считается по ФАКТУ готового остатка, а не по плану:
    # заказ 10, готово 8 → в рейс можно отдать максимум 8, а не 10.
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10, ready=8)
    rem = admin_client.get(f"/shipments/{doc_id}/trip-alloc-remaining").json()["lines"][0]
    assert rem["qty"] == 10           # план строки
    assert rem["remaining"] == 8      # факт готового остатка


def test_fact_counts_only_cargo_quality(admin_client, client_id):
    # Факт готового остатка считается по КАЧЕСТВУ груза: рейс товара видит только
    # годный; брак той же строки в факт не попадает (и наоборот).
    import uuid as _uuid
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10, ready=3)
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO zone_relocations
               (id, product_id, product_name, product_sku, client_id, client_name,
                from_op, to_op, from_quality, to_quality, to_zone_id, to_zone_name,
                qty, created_at, created_by, shipment_line_id)
               VALUES (?, (SELECT product_id FROM shipment_lines WHERE id = ?), 'Товар', 'SKU-SPLIT',
                       ?, 'Test Client', 'storage', 'ready', 'defect', 'defect',
                       'zone-ship', 'Зона отгрузки', 5, NOW(), 'test', ?)""",
            (str(_uuid.uuid4()), line_id, client_id, line_id),
        )
        conn.commit()

    rem = admin_client.get(f"/shipments/{doc_id}/trip-alloc-remaining").json()["lines"][0]
    assert rem["remaining"] == 3              # только годный; брак (5) не учтён
    assert _ready_for_line(line_id, "good") == 3
    assert _ready_for_line(line_id, "defect") == 5


def test_link_rejects_alloc_above_ready(admin_client, client_id):
    # План привязки опережает факт: заказ 10, готово 8. Первый рейс берёт 5,
    # второй НЕ может взять 5 (свободно только 3) — отказ ещё на привязке.
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10, ready=8)

    t1 = _bare_outbound_trip(admin_client)
    ok = admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    assert ok.status_code == 200, ok.text

    t2 = _bare_outbound_trip(admin_client)
    bad = admin_client.post(f"/trips/{t2}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    assert bad.status_code == 400, bad.text
    assert "остаток" in bad.json()["detail"].lower()

    # Ровно по факту (3) — проходит.
    good = admin_client.post(f"/trips/{t2}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 3}]}],
    })
    assert good.status_code == 200, good.text


def test_short_prepare_completes_after_shipping_all_ready(admin_client, client_id):
    # Подготовлено меньше плана (заказ 10, готово 8): после отгрузки всех 8 догрузить
    # нечем → отгрузка ЗАВЕРШАЕТСЯ (shipped), а не зависает в «Частично отгружено».
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10, ready=8)

    t1 = _bare_outbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    t2 = _bare_outbound_trip(admin_client)
    admin_client.post(f"/trips/{t2}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 3}]}],
    })

    # После первого рейса остаётся 3 готовых → «Частично отгружено».
    _drive_to_costing(admin_client, t1)
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "partially_shipped"
    assert ship["lines"][0]["shipped_qty"] == 5
    assert _ready_for_line(line_id) == 3

    # Второй рейс увозит остаток факта (3); план не добран (8 из 10), но готового
    # больше нет → отгрузка завершена.
    _drive_to_costing(admin_client, t2)
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 8
    assert _ready_for_line(line_id) == 0


def test_relink_shipment_replaces_allocation(admin_client, client_id):
    # Повторная привязка той же отгрузки к рейсу ЗАМЕНяет распределение (правка из модала),
    # а не складывает; остаток корректно восстанавливается.
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    first = admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    assert first.status_code == 200, first.text
    second = admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })
    assert second.status_code == 200, second.text

    detail = admin_client.get(f"/trips/{t1}").json()
    assert detail["shipments"][0]["allocated_qty"] == 4, detail["shipments"]
    # Остаток в этой отгрузке: 10 − 4 = 6 (старое распределение 6 снято).
    rem = admin_client.get(f"/shipments/{doc_id}/trip-alloc-remaining").json()["lines"]
    assert rem[0]["remaining"] == 6, rem


def test_link_rejects_over_allocation(admin_client, client_id):
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    ok = admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 7}]}],
    })
    assert ok.status_code == 200, ok.text
    # Второй рейс пытается взять 5 при остатке 3 — отказ.
    t2 = _bare_outbound_trip(admin_client)
    bad = admin_client.post(f"/trips/{t2}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    assert bad.status_code == 400, bad.text
    assert "остаток" in bad.json()["detail"].lower()


def test_cancel_trip_returns_partial_shipment(admin_client, client_id):
    doc_id, line_id = _good_shipment_awaiting_with_ready(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/shipments", json={
        "items": [{"shipment_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    _drive_to_costing(admin_client, t1)
    assert admin_client.get(f"/shipments/{doc_id}").json()["status"] == "partially_shipped"
    assert _ready_for_line(line_id) == 4

    # Отмена рейса после выезда возвращает товар и откатывает статус.
    cancel = admin_client.post(f"/trips/{t1}/cancel")
    assert cancel.status_code == 200, cancel.text
    ship = admin_client.get(f"/shipments/{doc_id}").json()
    assert ship["status"] == "awaiting_trip"
    assert ship["lines"][0]["shipped_qty"] == 0
    assert _ready_for_line(line_id) == 10


def _seed_defect_in_zone(client_id: str, pos: dict, zone_id: str, qty: int) -> None:
    """Принятое поступление в зоне + смена качества → брак «На хранении» в месте."""
    import uuid as _uuid

    doc_id = str(_uuid.uuid4())
    line_id = str(_uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO receipt_docs (id, doc_number, client_id, status, is_deleted, created_at, created_by)
               VALUES (?, ?, ?, 'done', 0, NOW(), 'test')""",
            (doc_id, f"WH-T-{doc_id}", client_id),
        )
        conn.execute(
            """INSERT INTO receipt_lines
               (id, doc_id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
                planned_qty, accepted_qty, storage_zone_id, is_deleted, created_at, created_by)
               VALUES (?, ?, ?, 'Брак-товар', 'TST-DEF', ?, 'Red', ?, NULL, ?, ?, ?, 0, NOW(), 'test')""",
            (line_id, doc_id, pos["product_id"], pos["color_id"], pos["size_id"], qty, qty, zone_id),
        )
        conn.execute(
            """INSERT INTO zone_relocations
               (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
                client_id, from_op, to_op, from_quality, to_quality, from_zone_id, to_zone_id, qty, created_at)
               VALUES (?, ?, 'Брак-товар', 'TST-DEF', ?, 'Red', ?, NULL,
                       ?, 'intake', 'storage', 'good', 'good', ?, ?, ?, NOW())""",
            (str(_uuid.uuid4()), pos["product_id"], pos["color_id"], pos["size_id"], client_id, zone_id, zone_id, qty),
        )
        conn.execute(
            """INSERT INTO zone_relocations
               (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
                client_id, from_op, to_op, from_quality, to_quality, from_zone_id, to_zone_id, qty, created_at)
               VALUES (?, ?, 'Брак-товар', 'TST-DEF', ?, 'Red', ?, NULL,
                       ?, 'storage', 'storage', 'good', 'defect', ?, ?, ?, NOW())""",
            (str(_uuid.uuid4()), pos["product_id"], pos["color_id"], pos["size_id"], client_id, zone_id, zone_id, qty),
        )
        conn.commit()


def _storage_defect_in_zone(client_id: str, pos: dict, zone_id: str) -> int:
    from modules.balances.service import get_available_in_zone

    with get_connection() as conn:
        return get_available_in_zone(
            conn,
            product_id=pos["product_id"], color_id=pos["color_id"], size_id=pos["size_id"],
            client_id=client_id, zone_id=zone_id, op="storage", quality="defect",
        )


def _shipping_zone_id() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM unloading_zones WHERE is_shipping_zone = 1 AND COALESCE(is_deleted, 0) = 0 "
            "ORDER BY created_at LIMIT 1"
        ).fetchone()
    assert row, "Не настроена «Зона отгрузки» (миграция 0043)"
    return str(row["id"])


def _ready_defect_in_zone(client_id: str, pos: dict, zone_id: str) -> int:
    from modules.balances.service import get_available_in_zone

    with get_connection() as conn:
        return get_available_in_zone(
            conn,
            product_id=pos["product_id"], color_id=pos["color_id"], size_id=pos["size_id"],
            client_id=client_id, zone_id=zone_id, op="ready", quality="defect",
        )


def test_defect_shipment_prepared_by_warehouse_then_shipped(admin_client, client_id):
    """Брак-отгрузка: draft → relocating (кладовщик готовит) → awaiting_trip → shipped."""
    import uuid as _uuid

    pos = {"product_id": str(_uuid.uuid4()), "color_id": str(_uuid.uuid4()), "size_id": None}
    zone_id = str(_uuid.uuid4())
    shipping_zone = _shipping_zone_id()
    _seed_defect_in_zone(client_id, pos, zone_id, 7)
    assert _storage_defect_in_zone(client_id, pos, zone_id) == 7

    try:
        create = admin_client.post("/shipments", json={
            "cargo_type": "defect", "client_id": client_id, "client_name": "Test Client",
            "destination": "Москва", "ship_date": "2026-06-10",
            "lines": [{**pos, "product_name": "Брак-товар", "product_sku": "TST-DEF",
                       "color_name": "Red", "size_name": None, "qty": 5}],
        })
        assert create.status_code == 200, create.text
        shipment_id = create.json()["message"]

        # draft → relocating: задача кладовщику подготовить брак.
        adv = admin_client.post(f"/shipments/{shipment_id}/advance")
        assert adv.status_code == 200, adv.text
        assert adv.json()["message"] == "relocating"
        assert _storage_defect_in_zone(client_id, pos, zone_id) == 7

        # Кладовщик выбирает источник и переносит брак в зону отгрузки.
        line_id = admin_client.get(f"/shipments/{shipment_id}").json()["lines"][0]["id"]
        finish = admin_client.post(f"/shipments/{shipment_id}/finish-defect-relocation", json={
            "lines": [{"line_id": line_id,
                       "sources": [{"zone_id": zone_id, "zone_name": "Зона брака", "qty": 5}]}],
        })
        assert finish.status_code == 200, finish.text
        assert finish.json()["message"] == "awaiting_trip"

        # Брак зарезервирован: ушёл со хранения в ready/defect@зона отгрузки.
        assert _storage_defect_in_zone(client_id, pos, zone_id) == 2
        assert _ready_defect_in_zone(client_id, pos, shipping_zone) == 5

        trip_id = _handoff_ready_outbound(admin_client, shipment_id, cargo_type="defect")
        assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
        assert admin_client.post(
            f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
        ).json()["message"] == "unloading"
        unload = admin_client.post(f"/trips/{trip_id}/unload", json={
            "load_factor": "full",
            "unload_started_at": "2026-06-10T07:35",
            "unload_finished_at": "2026-06-10T08:10",
        })
        assert unload.status_code == 200, unload.text

        ship = admin_client.get(f"/shipments/{shipment_id}").json()
        assert ship["status"] == "shipped"
        assert ship["lines"][0]["shipped_qty"] == 5
        # Брак списан из зоны отгрузки журнальным движением.
        assert _storage_defect_in_zone(client_id, pos, zone_id) == 2
        assert _ready_defect_in_zone(client_id, pos, shipping_zone) == 0
    finally:
        with get_connection() as conn:
            for r in conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)).fetchall():
                conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
            conn.commit()


def test_defect_shipment_gates(admin_client, client_id):
    """Гейты брак-отгрузки: строки и общий остаток при планировании, источники при подготовке."""
    import uuid as _uuid

    pos = {"product_id": str(_uuid.uuid4()), "color_id": str(_uuid.uuid4()), "size_id": None}
    zone_id = str(_uuid.uuid4())
    empty_zone_id = str(_uuid.uuid4())

    try:
        # Без строк — 400.
        empty = admin_client.post("/shipments", json={
            "cargo_type": "defect", "client_id": client_id, "client_name": "Test Client", "lines": [],
        })
        empty_id = empty.json()["message"]
        no_lines = admin_client.post(f"/shipments/{empty_id}/advance")
        assert no_lines.status_code == 400, no_lines.text

        # Суммарного брака по клиенту нет — 409 уже при планировании.
        doc = admin_client.post("/shipments", json={
            "cargo_type": "defect", "client_id": client_id, "client_name": "Test Client",
            "lines": [{**pos, "product_name": "Брак-товар", "product_sku": "TST-DEF",
                       "color_name": "Red", "size_name": None, "qty": 3}],
        })
        doc_id = doc.json()["message"]
        no_stock = admin_client.post(f"/shipments/{doc_id}/advance")
        assert no_stock.status_code == 409, no_stock.text

        _seed_defect_in_zone(client_id, pos, zone_id, 4)
        adv = admin_client.post(f"/shipments/{doc_id}/advance")
        assert adv.status_code == 200, adv.text
        assert adv.json()["message"] == "relocating"

        # Задача кладовщику: подготовить брак к отгрузке (без даты — сразу).
        from modules.tasks.service import list_my_tasks
        with get_connection() as conn:
            tasks = list_my_tasks(conn, user={"role": "warehouse_manager"})
        assert any(t["doc_id"] == doc_id and t["kind"] == "shipment_defect_prepare" for t in tasks)

        line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]

        # Источники не покрывают план строки — 400.
        partial = admin_client.post(f"/shipments/{doc_id}/finish-defect-relocation", json={
            "lines": [{"line_id": line_id, "sources": [{"zone_id": zone_id, "qty": 2}]}],
        })
        assert partial.status_code == 400, partial.text

        # В выбранном месте брака нет — 409.
        wrong_zone = admin_client.post(f"/shipments/{doc_id}/finish-defect-relocation", json={
            "lines": [{"line_id": line_id,
                       "sources": [{"zone_id": empty_zone_id, "zone_name": "Пустая зона", "qty": 3}]}],
        })
        assert wrong_zone.status_code == 409, wrong_zone.text

        ok = admin_client.post(f"/shipments/{doc_id}/finish-defect-relocation", json={
            "lines": [{"line_id": line_id,
                       "sources": [{"zone_id": zone_id, "zone_name": "Зона брака", "qty": 3}]}],
        })
        assert ok.status_code == 200, ok.text
        assert ok.json()["message"] == "awaiting_trip"
    finally:
        with get_connection() as conn:
            for r in conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)).fetchall():
                conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
            conn.commit()


def test_defect_shipment_cancel_returns_stock(admin_client, client_id):
    """Аннулирование подготовленной брак-отгрузки возвращает брак на исходные места."""
    import uuid as _uuid

    pos = {"product_id": str(_uuid.uuid4()), "color_id": str(_uuid.uuid4()), "size_id": None}
    zone_id = str(_uuid.uuid4())
    shipping_zone = _shipping_zone_id()
    _seed_defect_in_zone(client_id, pos, zone_id, 6)

    try:
        create = admin_client.post("/shipments", json={
            "cargo_type": "defect", "client_id": client_id, "client_name": "Test Client",
            "lines": [{**pos, "product_name": "Брак-товар", "product_sku": "TST-DEF",
                       "color_name": "Red", "size_name": None, "qty": 4}],
        })
        doc_id = create.json()["message"]
        assert admin_client.post(f"/shipments/{doc_id}/advance").json()["message"] == "relocating"
        line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
        assert admin_client.post(f"/shipments/{doc_id}/finish-defect-relocation", json={
            "lines": [{"line_id": line_id,
                       "sources": [{"zone_id": zone_id, "zone_name": "Зона брака", "qty": 4}]}],
        }).json()["message"] == "awaiting_trip"
        assert _storage_defect_in_zone(client_id, pos, zone_id) == 2
        assert _ready_defect_in_zone(client_id, pos, shipping_zone) == 4

        cancel = admin_client.post(f"/shipments/{doc_id}/cancel")
        assert cancel.status_code == 200, cancel.text

        # Брак вернулся на исходное место, резерв в зоне отгрузки снят.
        assert _storage_defect_in_zone(client_id, pos, zone_id) == 6
        assert _ready_defect_in_zone(client_id, pos, shipping_zone) == 0
    finally:
        with get_connection() as conn:
            for r in conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (client_id,)).fetchall():
                conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (client_id,))
            conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (client_id,))
            conn.commit()


def test_outbound_list_filter_by_direction(admin_client, client_id):
    shipment_id = _packing_shipment(admin_client, client_id)
    out_trip = admin_client.post("/trips", json={
        "direction": "outbound", "shipment_doc_ids": [shipment_id],
    }).json()["message"]
    in_trip = admin_client.post("/trips", json={"direction": "inbound"}).json()["message"]

    out_list = admin_client.get("/trips?direction=outbound&limit=200")
    assert out_list.status_code == 200, out_list.text
    out_ids = {i["id"] for i in out_list.json()["items"]}
    assert out_trip in out_ids
    assert in_trip not in out_ids
    assert all(i["direction"] == "outbound" for i in out_list.json()["items"])
