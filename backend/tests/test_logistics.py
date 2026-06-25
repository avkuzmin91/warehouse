"""Интеграционные тесты логистики (рейсы) и каскада на поступления.

Требует DATABASE_URL. admin проходит и менеджерский, и складской гард.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import admin_client, manager_client, warehouse_client, make_client_id, cleanup_client  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _handoff_ready_trip(admin_client, receipt_id: str, origin_name: str = "Москва") -> str:
    """Создаёт черновик рейса со всеми обязательными для передачи на склад полями."""
    create = admin_client.post("/trips", json={
        "origin_id": "wh-1", "origin_name": origin_name,
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77",
        "cost_estimate": 10000,
        "transport_ordered_at": "2026-06-01T10:00",
        "eta": "2026-06-02T08:00",
        "receipt_doc_ids": [receipt_id],
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


def _planned_receipt(admin_client, client_id: str) -> str:
    r = admin_client.post("/receipts", json={"client_id": client_id, "lines": []})
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    assert adv.status_code == 200, adv.text
    assert adv.json()["message"] == "planned"
    return doc_id


def test_trip_full_flow_receives_receipt_on_unload(admin_client, client_id):
    # Приёмка происходит В РЕЙСЕ: завершение разгрузки проводит приход (по умолчанию
    # принимаем всю аллокацию), поступление → «Завершён», товар встаёт на хранение.
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)

    trip_id = _handoff_ready_trip(admin_client, doc_id)

    data = admin_client.get(f"/trips/{trip_id}").json()
    assert data["doc"]["status"] == "draft"
    assert data["doc"]["trip_number"].startswith("TR-")
    assert len(data["receipts"]) == 1
    # Аллокация отдаёт место хранения строки для предзаполнения приёмки в рейсе.
    assert data["receipts"][0]["allocations"][0]["storage_zone_id"] == zone_id

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(f"/trips/{trip_id}/arrival", json={}).json()["message"] == "unloading"

    unload = _unload_with_receive(admin_client, trip_id)
    assert unload.status_code == 200, unload.text
    assert unload.json()["message"] == "costing"

    # Приёмка в рейсе: поступление завершено, товар на хранении, задачи приёмки нет.
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 10

    cost = admin_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 12000, "waiting_cost": 1500, "waiting_minutes": 90,
    })
    assert cost.status_code == 200, cost.text

    close = admin_client.post(f"/trips/{trip_id}/close")
    assert close.status_code == 200, close.text
    assert close.json()["message"] == "closed"


def test_trip_unload_requires_load_factor(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})

    blocked = admin_client.post(f"/trips/{trip_id}/unload", json={})
    assert blocked.status_code == 400, blocked.text
    assert "загруженность" in blocked.json()["detail"].lower()
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["status"] == "unloading"

    bad = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "half"})
    assert bad.status_code == 400, bad.text

    ok = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})
    assert ok.status_code == 200, ok.text


def test_trip_unload_start_copied_from_arrival_and_can_be_adjusted(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")

    arrived_at = "2026-06-03T10:00"
    arrival = admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": arrived_at})
    assert arrival.status_code == 200, arrival.text

    detail = admin_client.get(f"/trips/{trip_id}").json()
    assert detail["doc"]["arrived_at"] == arrived_at
    assert detail["doc"]["unload_started_at"] == arrived_at

    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_started_at": "2026-06-03T10:05",
        "unload_finished_at": "2026-06-03T11:10",
        "load_factor": "partial",
    })
    assert unload.status_code == 200, unload.text

    done = admin_client.get(f"/trips/{trip_id}").json()
    assert done["doc"]["unload_started_at"] == "2026-06-03T10:05"
    assert done["doc"]["unload_finished_at"] == "2026-06-03T11:10"

    execution = admin_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2026-06-03T10:02",
        "unload_started_at": "2026-06-03T10:07",
        "unload_finished_at": "2026-06-03T11:15",
        "load_factor": "full",
    })
    assert execution.status_code == 200, execution.text

    adjusted = admin_client.get(f"/trips/{trip_id}").json()
    assert adjusted["doc"]["arrived_at"] == "2026-06-03T10:02"
    assert adjusted["doc"]["unload_started_at"] == "2026-06-03T10:07"
    assert adjusted["doc"]["unload_finished_at"] == "2026-06-03T11:15"
    assert adjusted["doc"]["load_factor"] == "full"


def test_handoff_requires_linked_receipt(admin_client):
    create = admin_client.post("/trips", json={"origin_name": "СПб"})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text


def test_handoff_rejects_eta_before_transport_ordered(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.patch(f"/trips/{trip_id}", json={
        "transport_ordered_at": "2026-06-02T10:00",
        "eta": "2026-06-01T08:00",
    })
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    assert "раньше" in bad.json()["detail"]


def test_receipt_can_be_linked_to_multiple_trips(admin_client, client_id):
    # Поступление можно дробить по нескольким рейсам (распределение по строкам).
    receipt_id = _planned_receipt(admin_client, client_id)
    t1 = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]}).json()["message"]
    assert t1
    t2 = admin_client.post("/trips", json={}).json()["message"]
    # Та же поступление — во второй рейс: теперь разрешено.
    second = admin_client.post(f"/trips/{t2}/receipts", json={"items": [{"receipt_doc_id": receipt_id, "allocations": []}]})
    assert second.status_code == 200, second.text
    # Повторная привязка к тому же рейсу — идемпотентна.
    again = admin_client.post(f"/trips/{t1}/receipts", json={"items": [{"receipt_doc_id": receipt_id, "allocations": []}]})
    assert again.status_code == 200, again.text


def test_receipt_candidates_include_receipts_linked_to_other_trips(admin_client, client_id):
    own_receipt = _planned_receipt(admin_client, client_id)
    other_receipt = _planned_receipt(admin_client, client_id)
    free_receipt = _planned_receipt(admin_client, client_id)
    own_trip = admin_client.post("/trips", json={"receipt_doc_ids": [own_receipt]}).json()["message"]
    other_trip = admin_client.post("/trips", json={"receipt_doc_ids": [other_receipt]}).json()["message"]
    assert own_trip and other_trip

    current = admin_client.get(f"/receipts?status=planned&available_for_trip_id={own_trip}&limit=100")
    assert current.status_code == 200, current.text
    current_ids = {item["id"] for item in current.json()["items"]}
    assert own_receipt not in current_ids       # привязано к этому рейсу
    assert other_receipt in current_ids         # привязано к другому рейсу — остаётся кандидатом
    assert free_receipt in current_ids

    new_trip = admin_client.get("/receipts?status=planned&unlinked_to_trip=true&limit=100")
    assert new_trip.status_code == 200, new_trip.text
    new_trip_ids = {item["id"] for item in new_trip.json()["items"]}
    assert free_receipt in new_trip_ids
    assert own_receipt not in new_trip_ids
    assert other_receipt not in new_trip_ids


def test_cancel_trip_unlinks_receipt(admin_client, client_id):
    # Аннулирование рейса «отвязывает» поступление: рейс исчезает из карточки и
    # поступление снова попадает в кандидаты «без рейса».
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]}).json()["message"]

    linked = admin_client.get(f"/receipts/{receipt_id}").json()
    assert any(t["id"] == trip_id for t in linked["doc"]["trips"])

    cancel = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["message"] == "cancelled"

    after = admin_client.get(f"/receipts/{receipt_id}").json()
    assert after["doc"]["trips"] == []
    assert after["doc"]["trip_id"] is None

    candidates = admin_client.get("/receipts?status=planned&unlinked_to_trip=true&limit=100").json()
    assert any(item["id"] == receipt_id for item in candidates["items"])


# --- Дробление поступления по нескольким inbound-рейсам ---

def _planned_receipt_with_line(admin_client, client_id: str, planned: int = 10):
    """Поступление в «В плане» с одной строкой и проставленной зоной хранения."""
    import uuid as _uuid
    pid = str(_uuid.uuid4())
    cid = str(_uuid.uuid4())
    zone_id = str(_uuid.uuid4())
    r = admin_client.post("/receipts", json={
        "client_id": client_id, "client_name": "Test Client",
        "lines": [{"product_id": pid, "product_name": "Товар", "product_sku": "SKU-RIN",
                   "color_id": cid, "color_name": "Red", "size_id": None, "size_name": None,
                   "planned_qty": planned}],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    assert admin_client.post(f"/receipts/{doc_id}/advance").json()["message"] == "planned"
    line_id = admin_client.get(f"/receipts/{doc_id}").json()["lines"][0]["id"]
    patch = admin_client.patch(f"/receipts/{doc_id}/lines/{line_id}",
                               json={"storage_zone_id": zone_id, "storage_zone_name": "Зона П"})
    assert patch.status_code == 200, patch.text
    return doc_id, line_id, pid, cid, zone_id


def _storage_good_in_zone(client_id: str, pid: str, color_id: str, zone_id: str) -> int:
    from dbconn import get_connection
    from modules.balances.service import get_available_in_zone
    with get_connection() as conn:
        return get_available_in_zone(
            conn, product_id=pid, color_id=color_id, size_id=None,
            client_id=client_id, zone_id=zone_id, op="storage", quality="good",
        )


def _bare_inbound_trip(admin_client) -> str:
    create = admin_client.post("/trips", json={
        "direction": "inbound",
        "origin_id": "wh-1", "origin_name": "Москва",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77", "cost_estimate": 10000,
        "transport_ordered_at": "2026-06-01T10:00", "eta": "2026-06-02T08:00",
    })
    assert create.status_code == 200, create.text
    return create.json()["message"]


def _drive_inbound_to_costing(admin_client, trip_id: str) -> None:
    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(f"/trips/{trip_id}/arrival", json={}).json()["message"] == "unloading"
    unload = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert unload.status_code == 200, unload.text


def _unload_with_receive(admin_client, trip_id: str, lines: list[dict] | None = None):
    """Завершить разгрузку с приёмкой по строкам (inline в рейсе).

    lines: [{line_id, accepted_qty, storage_zone_id?, storage_zone_name?}]. Пусто —
    принимаем всю аллокацию рейса по умолчанию.
    """
    return admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full", "receipt_lines": lines or [],
    })


def _balances_storage_good(client_id: str, pid: str):
    """storage/good по позиции из позиционного агрегата остатков (или None, если позиции нет)."""
    from dbconn import get_connection
    from modules.balances.service import get_balances
    with get_connection() as conn:
        res = get_balances(conn, page=1, limit=500, client_id=client_id,
                           search=None, only_positive=False, has_defect=False)
    for it in res.items:
        if it.product_id == pid:
            return it.storage_good
    return None


def test_receipt_split_across_two_trips(admin_client, client_id):
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)

    t1 = _bare_inbound_trip(admin_client)
    link1 = admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    assert link1.status_code == 200, link1.text

    t2 = _bare_inbound_trip(admin_client)
    link2 = admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })
    assert link2.status_code == 200, link2.text

    # Первый рейс привёз 6 → приёмка в рейсе по умолчанию принимает всю аллокацию (6):
    # поступление «Частично принято», на хранении 6.
    _drive_inbound_to_costing(admin_client, t1)
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["lines"][0]["accepted_qty"] == 6
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 6
    # Частично принятая позиция видна в остатках (якорь включает partially_received).
    assert _balances_storage_good(client_id, pid) == 6

    # Второй рейс привёз остаток 4 → приёмка в рейсе → «Завершён», на хранении 10.
    _drive_inbound_to_costing(admin_client, t2)
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 10


def test_receipt_split_across_cells_on_unload(admin_client, client_id):
    """Принятое по строке раскладывается по нескольким ячейкам: журнал пишет движение
    на каждую ячейку, остаток встаёт в свои места, карточка показывает раскладку."""
    import uuid as _uuid
    doc_id, line_id, pid, cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)
    zone_a, zone_b = str(_uuid.uuid4()), str(_uuid.uuid4())

    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 10}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    unload = _unload_with_receive(admin_client, t1, [{
        "line_id": line_id, "accepted_qty": 10,
        "placements": [
            {"storage_zone_id": zone_a, "storage_zone_name": "Зона A", "qty": 7},
            {"storage_zone_id": zone_b, "storage_zone_name": "Зона B", "qty": 3},
        ],
    }])
    assert unload.status_code == 200, unload.text

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10
    assert _storage_good_in_zone(client_id, pid, cid, zone_a) == 7
    assert _storage_good_in_zone(client_id, pid, cid, zone_b) == 3

    placements = {p["storage_zone_id"]: p["qty"] for p in rec["lines"][0]["placements"]}
    assert placements == {zone_a: 7, zone_b: 3}


def test_unload_split_cell_missing_zone_rejected(admin_client, client_id):
    """Ячейка с количеством, но без места — приёмку не проводим (нужно указать место)."""
    doc_id, line_id, _pid, _cid, _zone0 = _planned_receipt_with_line(admin_client, client_id, planned=10)
    # У строки нет плановой зоны — снимаем, чтобы не сработал фолбэк на неё.
    admin_client.patch(f"/receipts/{doc_id}/lines/{line_id}",
                       json={"storage_zone_id": None, "storage_zone_name": None})

    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 10}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    got = _unload_with_receive(admin_client, t1, [{
        "line_id": line_id, "accepted_qty": 10,
        "placements": [{"storage_zone_id": "", "storage_zone_name": None, "qty": 10}],
    }])
    assert got.status_code == 400
    assert "место хранения" in got.json()["detail"].lower()


def test_trip_detail_shows_per_trip_received_qty(admin_client, client_id):
    """Карточка рейса показывает принятое В ЭТОМ рейсе (received_qty), отдельно от
    накопленного по всем рейсам (accepted_qty)."""
    doc_id, line_id, _pid, _cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)

    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    t2 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })

    # До разгрузки приёмки ещё нет — received_qty = 0.
    pre = admin_client.get(f"/trips/{t1}").json()
    assert pre["receipts"][0]["received_qty"] == 0
    assert pre["receipts"][0]["allocations"][0]["received_qty"] == 0

    _drive_inbound_to_costing(admin_client, t1)  # принял 6
    _drive_inbound_to_costing(admin_client, t2)  # принял 4 (накопл. 10)

    d1 = admin_client.get(f"/trips/{t1}").json()
    assert d1["receipts"][0]["received_qty"] == 6
    assert d1["receipts"][0]["allocations"][0]["received_qty"] == 6
    # accepted_qty — накопленное по всем рейсам.
    assert d1["receipts"][0]["allocations"][0]["accepted_qty"] == 10

    d2 = admin_client.get(f"/trips/{t2}").json()
    assert d2["receipts"][0]["received_qty"] == 4
    assert d2["receipts"][0]["allocations"][0]["received_qty"] == 4
    assert d2["receipts"][0]["allocations"][0]["accepted_qty"] == 10


def test_trip_detail_received_qty_reversed_on_cancel(admin_client, client_id):
    """Отмена рейса сторнирует приёмку → received_qty в карточке возвращается к 0."""
    doc_id, line_id, _pid, _cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    _drive_inbound_to_costing(admin_client, t1)
    assert admin_client.get(f"/trips/{t1}").json()["receipts"][0]["received_qty"] == 6

    admin_client.post(f"/trips/{t1}/cancel")
    assert admin_client.get(f"/trips/{t1}").json()["receipts"][0]["received_qty"] == 0


def _trip_to_costing(admin_client, client_id: str) -> str:
    """Минимальный рейс до статуса «Уточнение стоимости» с перевозчиком."""
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    ok = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["message"] == "costing"
    return trip_id


def _logistics_expense_for(admin_client, trip_id: str) -> dict | None:
    items = admin_client.get("/expenses?kind=logistics&limit=200").json()["items"]
    mine = [e for e in items if e.get("source_id") == trip_id]
    return mine[0] if mine else None


def test_trip_cost_creates_logistics_expense(admin_client, client_id):
    """Стоимость рейса ≠ оплата: внесение фактической стоимости заводит в реестре
    расход «ожидает оплаты» (1 рейс → 1 расход, повтор обновляет, не дублирует)."""
    from dbconn import get_connection

    trip_id = _trip_to_costing(admin_client, client_id)
    try:
        cost = admin_client.post(f"/trips/{trip_id}/cost", json={
            "logistics_cost_actual": 5000, "waiting_cost": 500,
        })
        assert cost.status_code == 200, cost.text

        exp = _logistics_expense_for(admin_client, trip_id)
        assert exp is not None, "ожидался логистический расход из рейса"
        assert exp["kind"] == "logistics"
        assert exp["payment_status"] == "awaiting"
        assert exp["amount"] == 550000          # (5000 + 500) ₽ → копейки
        assert exp["supplier"] == "ООО Перевозчик"
        assert exp["source_kind"] == "trip"

        # Повторный ввод стоимости обновляет ТОТ ЖЕ расход, не плодит дубль.
        again = admin_client.post(f"/trips/{trip_id}/cost", json={"logistics_cost_actual": 6000})
        assert again.status_code == 200, again.text
        items = admin_client.get("/expenses?kind=logistics&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == trip_id]
        assert len(mine) == 1, mine
        assert mine[0]["amount"] == 650000      # (6000 + 500) ₽

        # Расход можно оплатить из реестра (источник оплаты у авто-расхода пуст —
        # указываем «с чьей карты» при оплате).
        pay_src = admin_client.get("/expenses/dict/payment-sources").json()[0]["id"]
        paid = admin_client.post(f"/expenses/{exp['id']}/pay",
                                 json={"payment_source_id": pay_src, "paid_on": "2026-06-17"})
        assert paid.status_code == 200, paid.text
        assert admin_client.get(f"/expenses/{exp['id']}").json()["payment_status"] == "paid"
    finally:
        with get_connection() as conn:
            ids = [r["id"] for r in conn.execute(
                "SELECT id FROM material_expenses WHERE source_kind='trip' AND source_id=?",
                (trip_id,),
            ).fetchall()]
            for eid in ids:
                conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
                conn.execute("DELETE FROM expense_payments WHERE expense_id=?", (eid,))
            conn.execute(
                "DELETE FROM material_expenses WHERE source_kind='trip' AND source_id=?", (trip_id,)
            )
            conn.commit()


def test_trip_receive_undership_then_close_short(admin_client, client_id):
    # Весь план на одном рейсе, но привезли меньше: приёмка в рейсе фиксирует факт,
    # поступление «Частично принято»; менеджер закрывает его с недопоставкой.
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 10}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    got = _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": 8}])
    assert got.status_code == 200, got.text
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["lines"][0]["accepted_qty"] == 8
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 8

    short = admin_client.post(f"/receipts/{doc_id}/close-short")
    assert short.status_code == 200, short.text
    assert short.json()["message"] == "done"
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    # Недовезённое в сток не попадает — на хранении остаётся принятое.
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 8


def test_trip_receive_overdelivery(admin_client, client_id):
    # Привезли больше плана — нормальная ситуация. Кладовщик принимает факт (12 при
    # плане 10): излишек поднимает аллокацию рейса, поступление закрывается в done,
    # на хранении стоит всё принятое.
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 10}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    got = _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": 12}])
    assert got.status_code == 200, got.text

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 12
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 12

    # Аллокацию рейса подняли до факта: «привезено рейсом» = 12, остатка к
    # распределению на новые рейсы нет.
    trip = admin_client.get(f"/trips/{t1}").json()
    assert trip["receipts"][0]["allocations"][0]["qty"] == 12
    assert trip["receipts"][0]["received_qty"] == 12


def test_shortage_close_short_gated_by_pending_trip_and_alloc(admin_client, client_id):
    # План 10 разложен по двум рейсам 6+4. Пока второй рейс не приехал — это не
    # недопоставка, а ожидание: задачи менеджеру нет, close-short отклоняется.
    # После прихода обоих (привезли 6+3=9) рейсы кончились, план разложен на 100% →
    # недопоставка финальна: появляется задача и close-short проходит.
    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks

    def _manager_shortage_kinds():
        with get_connection() as conn:
            items = list_my_tasks(conn, user={"role": "manager"})
        return {(t["doc_id"], t["kind"]) for t in items}

    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    t2 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })

    # Первый рейс привёз свои 6.
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    assert _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": 6}]).status_code == 200

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["can_close_short"] is False
    assert (doc_id, "receipt_close_short") not in _manager_shortage_kinds()

    # Второй рейс ещё в пути → close-short отклоняется.
    rejected = admin_client.post(f"/receipts/{doc_id}/close-short")
    assert rejected.status_code == 400, rejected.text
    assert "везётся рейсом" in rejected.json()["detail"]

    # Второй рейс приезжает, но привозит меньше (3 из 4).
    admin_client.post(f"/trips/{t2}/handoff")
    admin_client.post(f"/trips/{t2}/arrival", json={})
    assert _unload_with_receive(admin_client, t2, [{"line_id": line_id, "accepted_qty": 3}]).status_code == 200

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["can_close_short"] is True
    assert (doc_id, "receipt_close_short") in _manager_shortage_kinds()

    closed = admin_client.post(f"/receipts/{doc_id}/close-short")
    assert closed.status_code == 200, closed.text
    assert closed.json()["message"] == "done"
    # Принято 6+3=9, недовезённое в сток не попало.
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 9
    assert (doc_id, "receipt_close_short") not in _manager_shortage_kinds()


def test_trip_undership_expect_redelivery_then_new_trip(admin_client, client_id):
    # План 10 разложен по двум рейсам 6+4, но оба привезли меньше (5+3=8). Вместо
    # закрытия с недопоставкой менеджер фиксирует «Ожидается довоз»: недовоз
    # освобождается, поступление остаётся открытым, и недостающее довозят новым рейсом.
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    t2 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })

    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    assert _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": 5}]).status_code == 200
    admin_client.post(f"/trips/{t2}/handoff")
    admin_client.post(f"/trips/{t2}/arrival", json={})
    assert _unload_with_receive(admin_client, t2, [{"line_id": line_id, "accepted_qty": 3}]).status_code == 200

    # Рейсы кончились, привезли меньше плана — это точка развилки.
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["can_close_short"] is True

    # «Ожидается довоз»: недовоз (10−8=2) освобождён.
    released = admin_client.post(f"/receipts/{doc_id}/expect-redelivery")
    assert released.status_code == 200, released.text

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    # Поступление осталось открытым, развилка погасла (остаток снова > 0).
    assert rec["doc"]["status"] == "partially_received"
    assert rec["can_close_short"] is False
    assert rec["lines"][0]["accepted_qty"] == 8
    # Принятое на остатках не тронуто.
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 8

    # Освободилось ровно 2 шт.: больше на новый рейс не разложить, ровно 2 — можно.
    t3 = _bare_inbound_trip(admin_client)
    over = admin_client.post(f"/trips/{t3}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 3}]}],
    })
    assert over.status_code == 400, over.text
    ok = admin_client.post(f"/trips/{t3}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 2}]}],
    })
    assert ok.status_code == 200, ok.text

    # Довоз приехал полностью → поступление завершено, на хранении весь план.
    _drive_inbound_to_costing(admin_client, t3)
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 10


def test_expect_redelivery_accounts_for_received_correction(admin_client, client_id):
    # Рейс привёз/принял 8 из плана 10, затем менеджер пересчитал приёмку вниз до 6.
    # «Ожидается довоз» должен учесть пересчёт: освободить 4 (10−6), а не 2 (10−8) «до
    # пересчёта». Иначе на новый рейс разложится только 2 и поступление не закроется.
    doc_id, line_id, pid, cid, zone_id = _received_line(admin_client, client_id, planned=10, accepted=8)
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"

    down = _correct(admin_client, doc_id, line_id, 6)
    assert down.status_code == 200, down.text
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 6

    released = admin_client.post(f"/receipts/{doc_id}/expect-redelivery")
    assert released.status_code == 200, released.text

    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["can_close_short"] is False
    assert rec["lines"][0]["accepted_qty"] == 6
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 6

    # Освободилось ровно 4: 5 на новый рейс не лезет, 4 — да.
    t2 = _bare_inbound_trip(admin_client)
    over = admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    assert over.status_code == 400, over.text
    ok = admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })
    assert ok.status_code == 200, ok.text

    # Довоз приехал полностью → поступление завершено, на хранении весь план.
    _drive_inbound_to_costing(admin_client, t2)
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 10


def test_expect_redelivery_gated_like_close_short(admin_client, client_id):
    # Пока рейс ещё может что-то довезти — освобождать недовоз нельзя (как и close-short).
    doc_id, line_id, _pid, _cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    t2 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 4}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    assert _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": 5}]).status_code == 200

    # Второй рейс ещё в пути → это ожидание, а не недопоставка.
    rejected = admin_client.post(f"/receipts/{doc_id}/expect-redelivery")
    assert rejected.status_code == 400, rejected.text


def _correct(client, doc_id: str, line_id: str, qty: int, reason: str = "пересчёт"):
    return client.post(f"/receipts/{doc_id}/lines/{line_id}/correct-received",
                       json={"accepted_qty": qty, "reason": reason})


def _received_line(admin_client, client_id, *, planned=10, accepted=8):
    """Поступление, принятое рейсом (одна строка, вся аллокация на одном рейсе)."""
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=planned)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": planned}]}],
    })
    admin_client.post(f"/trips/{t1}/handoff")
    admin_client.post(f"/trips/{t1}/arrival", json={})
    assert _unload_with_receive(admin_client, t1, [{"line_id": line_id, "accepted_qty": accepted}]).status_code == 200
    return doc_id, line_id, pid, cid, zone_id


def test_correct_received_increase_then_decrease(admin_client, client_id):
    # Приёмщик обсчитался: принял 8 из привезённых 10. Менеджер правит вверх до 10
    # (сток растёт, статус done), затем вниз до 9 (сток уменьшается, снова частично).
    doc_id, line_id, pid, cid, zone_id = _received_line(admin_client, client_id, planned=10, accepted=8)
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 8

    up = _correct(admin_client, doc_id, line_id, 10)
    assert up.status_code == 200, up.text
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 10
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "done"
    assert rec["lines"][0]["accepted_qty"] == 10

    down = _correct(admin_client, doc_id, line_id, 9)
    assert down.status_code == 200, down.text
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 9
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "partially_received"
    assert rec["lines"][0]["accepted_qty"] == 9


def test_correct_received_cannot_exceed_arrived(admin_client, client_id):
    doc_id, line_id, _pid, _cid, _zone = _received_line(admin_client, client_id, planned=10, accepted=8)
    bad = _correct(admin_client, doc_id, line_id, 11)
    assert bad.status_code == 400, bad.text
    assert "не больше 10" in bad.json()["detail"]


def test_correct_received_blocked_when_stock_consumed(admin_client, client_id):
    # После приёмки товар списали со склада — уменьшать принятое некуда: гейт блокирует.
    doc_id, line_id, pid, cid, zone_id = _received_line(admin_client, client_id, planned=10, accepted=10)
    wo = admin_client.post("/balances/write-offs", json={
        "product_id": pid, "color_id": cid, "size_id": None, "client_id": client_id,
        "zone_id": zone_id, "quality": "good", "qty": 10, "reason": "damage",
    })
    assert wo.status_code == 200, wo.text
    bad = _correct(admin_client, doc_id, line_id, 6)
    assert bad.status_code == 400, bad.text
    assert "Нельзя уменьшить" in bad.json()["detail"]


def test_correct_received_permission(admin_client, warehouse_client, warehouse_head_client, client_id):
    doc_id, line_id, _pid, _cid, _zone = _received_line(admin_client, client_id, planned=10, accepted=8)
    # Кладовщик такую правку не делает.
    denied = _correct(warehouse_client, doc_id, line_id, 9)
    assert denied.status_code == 403, denied.text
    # Начальник склада — вправе.
    ok = _correct(warehouse_head_client, doc_id, line_id, 9)
    assert ok.status_code == 200, ok.text


def test_link_receipt_rejects_over_allocation(admin_client, client_id):
    doc_id, line_id, _pid, _cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    ok = admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 7}]}],
    })
    assert ok.status_code == 200, ok.text
    t2 = _bare_inbound_trip(admin_client)
    bad = admin_client.post(f"/trips/{t2}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 5}]}],
    })
    assert bad.status_code == 400, bad.text
    assert "остаток" in bad.json()["detail"].lower()


def test_cancel_inbound_trip_reverses_receipt_intake(admin_client, client_id):
    doc_id, line_id, pid, cid, zone_id = _planned_receipt_with_line(admin_client, client_id, planned=10)
    t1 = _bare_inbound_trip(admin_client)
    admin_client.post(f"/trips/{t1}/receipts", json={
        "items": [{"receipt_doc_id": doc_id, "allocations": [{"line_id": line_id, "qty": 6}]}],
    })
    # Разгрузка приняла 6 в рейсе → «Частично принято», на хранении 6.
    _drive_inbound_to_costing(admin_client, t1)
    assert admin_client.get(f"/receipts/{doc_id}").json()["doc"]["status"] == "partially_received"
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 6

    # Отмена рейса сторнирует приёмку: товар снят с хранения, поступление «В плане».
    cancel = admin_client.post(f"/trips/{t1}/cancel")
    assert cancel.status_code == 200, cancel.text
    rec = admin_client.get(f"/receipts/{doc_id}").json()
    assert rec["doc"]["status"] == "planned"
    assert (rec["lines"][0]["accepted_qty"] or 0) == 0
    assert _storage_good_in_zone(client_id, pid, cid, zone_id) == 0


def test_tasks_endpoint_lists_costing_trip(admin_client, client_id):
    doc_id, _line_id, _pid, _cid, _zone = _planned_receipt_with_line(admin_client, client_id, planned=10)
    trip_id = _handoff_ready_trip(admin_client, doc_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    _unload_with_receive(admin_client, trip_id)

    # Прямой вызов сервиса: API /tasks отдаёт топ-20, что зависит от объёма БД.
    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks
    with get_connection() as conn:
        items = list_my_tasks(conn, user={"role": "admin"})
    kinds = {(t["doc_id"], t["kind"]) for t in items}
    # Рейс в costing → задача менеджеру. Приёмка прошла в рейсе → поступление
    # «Завершён», задачи приёмки на поступлении НЕТ (рейсовое не входит в on_intake).
    assert (trip_id, "trip_cost") in kinds
    assert (doc_id, "receipt_intake") not in kinds
    assert admin_client.get(f"/receipts/{doc_id}").json()["doc"]["status"] == "done"


def test_unload_copies_actual_arrival_to_receipt(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2025-06-05T09:30"})
    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_finished_at": "2025-06-05T11:00", "load_factor": "full",
    })
    assert unload.status_code == 200, unload.text

    rec = admin_client.get(f"/receipts/{receipt_id}").json()
    assert rec["doc"]["actual_arrival_date"] == "2025-06-05"
    assert rec["doc"]["trip_id"] == trip_id
    assert rec["doc"]["trip_number"].startswith("TR-")


def test_manager_edits_arrival_resyncs_receipt(admin_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2025-06-05T09:30"})
    admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_finished_at": "2025-06-05T11:00", "load_factor": "full",
    })

    execution = admin_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2025-06-07T12:00",
        "unload_started_at": "2025-06-07T12:05",
        "unload_finished_at": "2025-06-07T13:00",
        "load_factor": "full",
    })
    assert execution.status_code == 200, execution.text
    rec = admin_client.get(f"/receipts/{receipt_id}").json()
    assert rec["doc"]["actual_arrival_date"] == "2025-06-07"


def test_actual_arrival_editable_without_trip(admin_client, warehouse_client, client_id):
    free_receipt = _planned_receipt(admin_client, client_id)  # создаёт менеджерский состав
    ok = warehouse_client.patch(f"/receipts/{free_receipt}/actual-arrival", json={"actual_arrival_date": "2026-06-06"})
    assert ok.status_code == 200, ok.text
    assert warehouse_client.get(f"/receipts/{free_receipt}").json()["doc"]["actual_arrival_date"] == "2026-06-06"


def test_warehouse_cannot_create_documents(warehouse_client, client_id):
    """Кладовщику запрещено создавать рейсы, поступления и отгрузки (403)."""
    r = warehouse_client.post("/receipts", json={"client_id": client_id, "lines": []})
    assert r.status_code == 403, r.text
    s = warehouse_client.post("/shipments", json={"client_id": client_id, "client_name": "C", "lines": []})
    assert s.status_code == 403, s.text
    t = warehouse_client.post("/trips", json={"receipt_doc_ids": []})
    assert t.status_code == 403, t.text


def test_actual_arrival_blocked_with_trip(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    # достаточно привязки (trip_lines) — без cost_estimate, чтобы не упереться в cost-доступ
    admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    bad = admin_client.patch(f"/receipts/{linked_receipt}/actual-arrival", json={"actual_arrival_date": "2026-06-06"})
    assert bad.status_code == 400, bad.text


def test_cancel_receipt_blocked_while_linked_to_trip(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    create = admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    bad = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert bad.status_code == 400, bad.text
    assert "привязано к рейсу" in bad.json()["detail"]

    unlink = admin_client.delete(f"/trips/{trip_id}/receipts/{linked_receipt}")
    assert unlink.status_code == 200, unlink.text

    ok = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert ok.status_code == 200, ok.text
    assert ok.json()["message"] == "cancelled"


def test_cancel_receipt_allowed_when_trip_cancelled(admin_client, client_id):
    linked_receipt = _planned_receipt(admin_client, client_id)
    create = admin_client.post("/trips", json={"receipt_doc_ids": [linked_receipt]})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    cancel_trip = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel_trip.status_code == 200, cancel_trip.text

    ok = admin_client.post(f"/receipts/{linked_receipt}/cancel")
    assert ok.status_code == 200, ok.text


# Тест on_review-задач удалён: статус документа on_review убран (приёмка завершается на done).


def test_tasks_endpoint_lists_only_costing_trips_for_manager(admin_client, manager_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    from dbconn import get_connection
    from modules.tasks.service import list_my_tasks
    with get_connection() as conn:
        items = list_my_tasks(conn, user={"role": "manager"})
    assert (trip_id, "trip_cost") in {(t["doc_id"], t["kind"]) for t in items}
    # Менеджер видит только свои виды задач: стоимость рейса и закрытие недопоставки —
    # складские/сменные задачи в его очередь не попадают.
    assert all(t["kind"] in ("trip_cost", "receipt_close_short") for t in items)


def test_warehouse_trip_costs_are_hidden_and_readonly(admin_client, warehouse_client, client_id):
    tag = f"WHCOST-{uuid.uuid4()}"  # маркер origin_name изолирует рейс в общем списке
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id, origin_name=tag)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})
    cost = admin_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 12000,
        "waiting_cost": 1500,
        "waiting_minutes": 90,
    })
    assert cost.status_code == 200, cost.text

    detail = warehouse_client.get(f"/trips/{trip_id}")
    assert detail.status_code == 200, detail.text
    doc = detail.json()["doc"]
    assert doc["cost_estimate"] is None
    assert doc["logistics_cost_actual"] is None
    assert doc["waiting_cost"] is None
    assert doc["waiting_minutes"] == 90

    listing = warehouse_client.get(f"/trips?search={tag}&limit=200")
    assert listing.status_code == 200, listing.text
    item = next(i for i in listing.json()["items"] if i["id"] == trip_id)
    assert item["cost_estimate"] is None
    assert item["logistics_cost_actual"] is None

    patch = warehouse_client.patch(f"/trips/{trip_id}", json={"cost_estimate": 777})
    assert patch.status_code == 403

    forbidden = warehouse_client.post(f"/trips/{trip_id}/cost", json={
        "logistics_cost_actual": 777,
    })
    assert forbidden.status_code == 403


def test_trips_search_by_product_sku_and_name(admin_client, client_id):
    """Поиск рейса по SKU и названию товара из привязанного поступления."""
    marker = uuid.uuid4().hex[:8].upper()
    sku = f"SKU-{marker}"
    name = f"Куртка-{marker}"
    pid = str(uuid.uuid4())
    cid = str(uuid.uuid4())
    r = admin_client.post("/receipts", json={
        "client_id": client_id, "client_name": "Test Client",
        "lines": [{"product_id": pid, "product_name": name, "product_sku": sku,
                   "color_id": cid, "color_name": "Red", "size_id": None, "size_name": None,
                   "planned_qty": 5}],
    })
    assert r.status_code == 200, r.text
    receipt_id = r.json()["message"]
    assert admin_client.post(f"/receipts/{receipt_id}/advance").json()["message"] == "planned"

    create = admin_client.post("/trips", json={"receipt_doc_ids": [receipt_id]})
    assert create.status_code == 200, create.text
    trip_id = create.json()["message"]

    by_sku = admin_client.get("/trips", params={"search": sku, "limit": 200})
    assert by_sku.status_code == 200, by_sku.text
    assert any(i["id"] == trip_id for i in by_sku.json()["items"]), "рейс не найден по SKU"

    by_name = admin_client.get("/trips", params={"search": name, "limit": 200})
    assert by_name.status_code == 200, by_name.text
    assert any(i["id"] == trip_id for i in by_name.json()["items"]), "рейс не найден по названию товара"

    miss = admin_client.get("/trips", params={"search": f"НЕТ-{marker}", "limit": 200})
    assert miss.status_code == 200, miss.text
    assert all(i["id"] != trip_id for i in miss.json()["items"]), "рейс не должен находиться по чужому запросу"


def test_warehouse_cannot_edit_trip_transport_planning(admin_client, warehouse_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)

    draft_patch = warehouse_client.patch(f"/trips/{trip_id}", json={"carrier_name": "Другой перевозчик"})
    assert draft_patch.status_code == 403, draft_patch.text

    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={})
    admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "partial"})

    costing_patch = warehouse_client.patch(f"/trips/{trip_id}", json={"origin_name": "Другой склад"})
    assert costing_patch.status_code == 403, costing_patch.text


def test_warehouse_cannot_edit_trip_execution_in_costing(admin_client, warehouse_client, client_id):
    receipt_id = _planned_receipt(admin_client, client_id)
    trip_id = _handoff_ready_trip(admin_client, receipt_id)
    admin_client.post(f"/trips/{trip_id}/handoff")
    admin_client.post(f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-03T10:00"})
    admin_client.post(f"/trips/{trip_id}/unload", json={
        "unload_started_at": "2026-06-03T10:05",
        "unload_finished_at": "2026-06-03T11:10",
        "load_factor": "partial",
    })

    execution = warehouse_client.patch(f"/trips/{trip_id}/execution", json={
        "arrived_at": "2026-06-03T10:02",
        "unload_started_at": "2026-06-03T10:07",
        "unload_finished_at": "2026-06-03T11:15",
        "load_factor": "full",
    })
    assert execution.status_code == 403, execution.text
