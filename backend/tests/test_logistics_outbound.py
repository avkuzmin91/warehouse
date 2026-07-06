"""Интеграционные тесты outbound-рейсов: привязка отгрузок (dispatch) и каскад
awaiting_trip → shipped, дробление по рейсам, сторно при отмене.

Outbound-рейсы возят сущность «Отгрузка клиенту» (dispatch), а НЕ «Задачу
упаковки» (shipment). Готовый остаток `ready` сеется по варианту (product×client×
quality) — отгрузка тянет из общего пула, не зная, какая задача упаковки его готовила.
Требует DATABASE_URL.
"""
from __future__ import annotations

import os
import uuid

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


def _seed_ready(client_id: str, *, product_id: str, sku: str, qty: int,
                quality: str = "good", color_id=None, size_id=None) -> None:
    """Остаток-источник отгрузки по варианту×клиенту×качеству.

    Годный отгружается из `ready` (сеем packing→ready), брак — прямо из `storage`
    (сеем intake→storage), без раскладки в зону отгрузки.
    """
    from modules.balances.service import insert_inventory_move

    if quality == "defect":
        from_op, to_op, to_zone_id, to_zone_name = "intake", "storage", "zone-store-def", "Хранение брак"
    else:
        from_op, to_op, to_zone_id, to_zone_name = "packing", "ready", "zone-ready", "Готов"
    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Товар", product_sku=sku,
            color_id=color_id, color_name=None, size_id=size_id, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op=from_op, to_op=to_op, from_quality=quality, to_quality=quality,
            from_zone_id=None, from_zone_name=None,
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=qty, user_id="test",
        )
        conn.commit()


def _ready_net(client_id: str, product_id: str, quality: str = "good") -> int:
    """Нетто остатка-источника: для брака — `storage`, для годного — `ready`."""
    from modules.balances.service import get_available_total

    op = "storage" if quality == "defect" else "ready"
    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op=op, quality=quality,
        )


def _create_dispatch(admin_client, client_id: str, *, qty: int, cargo: str = "good",
                     sku: str = "SKU-D", product_id: str | None = None) -> tuple[str, str, str]:
    """Создаёт отгрузку с одной строкой (статус draft). Возвращает (doc_id, line_id, product_id)."""
    pid = product_id or str(uuid.uuid4())
    r = admin_client.post("/dispatches", json={
        "cargo_type": cargo, "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "comment": "Тех. задание",
        "lines": [{"product_id": pid, "product_name": "Товар", "product_sku": sku, "qty": qty, "pallets_qty": 1, "boxes_qty": 1}],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    line_id = admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["id"]
    return doc_id, line_id, pid


def _finish_prep(admin_client, doc_id: str, cargo: str = "good"):
    """POST finish-preparation: кладовщик берёт всю каждую строку из засеянной ячейки.

    Источник зависит от груза: годный — ячейка готового (`zone-ready`), брак — ячейка
    хранения брака (`zone-store-def`).
    """
    cell = ("zone-store-def", "Хранение брак") if cargo == "defect" else ("zone-ready", "Готов")
    lines = admin_client.get(f"/dispatches/{doc_id}").json()["lines"]
    body = {"lines": [
        {"line_id": l["id"], "sources": [{"zone_id": cell[0], "zone_name": cell[1], "qty": l["qty"]}]}
        for l in lines
    ]}
    return admin_client.post(f"/dispatches/{doc_id}/finish-preparation", json=body)


def _awaiting_dispatch(admin_client, client_id: str, *, qty: int = 10, ready: int | None = None,
                       cargo: str = "good", sku: str = "SKU-D") -> tuple[str, str, str]:
    """Отгрузка в статусе «Ожидает рейс»: сеет остаток по варианту, создаёт и подготавливает.

    Гейт перевода требует остаток ≥ полного плана строки, поэтому остаток по умолчанию = qty.
    Кладовщик указывает ячейку-источник, товар переезжает в «Готов к отгрузке».
    """
    ready = qty if ready is None else ready
    quality = "defect" if cargo == "defect" else "good"
    pid = str(uuid.uuid4())
    if ready > 0:
        _seed_ready(client_id, product_id=pid, sku=sku, qty=ready, quality=quality)
    doc_id, line_id, pid = _create_dispatch(admin_client, client_id, qty=qty, cargo=cargo, sku=sku, product_id=pid)
    adv = admin_client.post(f"/dispatches/{doc_id}/advance")
    assert adv.status_code == 200, adv.text
    assert adv.json()["message"] == "preparing"
    fin = _finish_prep(admin_client, doc_id, cargo)
    assert fin.status_code == 200, fin.text
    assert fin.json()["message"] == "awaiting_trip"
    return doc_id, line_id, pid


def _bare_outbound_trip(admin_client, cargo_type: str = "good") -> str:
    r = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": cargo_type,
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77", "cost_estimate": 8000,
        "transport_ordered_at": "2026-06-09T10:00", "eta": "2026-06-10T08:00",
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _trip_with_dispatch(admin_client, dispatch_id: str, cargo_type: str = "good") -> str:
    r = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": cargo_type,
        "origin_id": "wh-2", "origin_name": "Склад-получатель",
        "carrier_id": "carrier-1", "carrier_name": "ООО Перевозчик",
        "vehicle_type_id": "vt-1", "vehicle_type_name": "Тент",
        "vehicle_number": "А123ВС 77", "cost_estimate": 8000,
        "transport_ordered_at": "2026-06-09T10:00", "eta": "2026-06-10T08:00",
        "dispatch_doc_ids": [dispatch_id],
    })
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _link(admin_client, trip_id: str, dispatch_id: str, line_id: str | None = None, qty: int | None = None):
    allocations = [{"line_id": line_id, "qty": qty}] if line_id and qty is not None else []
    return admin_client.post(f"/trips/{trip_id}/dispatches",
                             json={"items": [{"dispatch_doc_id": dispatch_id, "allocations": allocations}]})


def _drive_to_costing(admin_client, trip_id: str) -> None:
    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"
    unload = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full", "unload_started_at": "2026-06-10T07:35", "unload_finished_at": "2026-06-10T08:10",
    })
    assert unload.status_code == 200, unload.text
    assert unload.json()["message"] == "costing"


# --- Базовый поток ---

def test_outbound_full_flow_cascades_dispatch_to_shipped(admin_client, client_id):
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _trip_with_dispatch(admin_client, doc_id)

    detail = admin_client.get(f"/trips/{trip_id}").json()
    assert detail["doc"]["direction"] == "outbound"
    assert detail["doc"]["status"] == "draft"
    assert len(detail["dispatches"]) == 1
    assert detail["dispatches"][0]["dispatch_doc_id"] == doc_id
    assert detail["receipts"] == []
    trip_number = detail["doc"]["trip_number"]

    # Отгрузка знает свой рейс.
    linked = admin_client.get(f"/dispatches/{doc_id}").json()
    assert any(t["id"] == trip_id for t in linked["trips"])

    _drive_to_costing(admin_client, trip_id)

    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 5
    assert _ready_net(client_id, pid) == 0

    close = admin_client.post(f"/trips/{trip_id}/close")
    assert close.status_code == 200, close.text
    assert close.json()["message"] == "closed"


def test_outbound_unload_blocked_for_draft_dispatch(admin_client, client_id):
    # Черновик отгрузки (с готовым остатком, но ещё не переданный кладовщику) блокирует погрузку.
    pid = str(uuid.uuid4())
    _seed_ready(client_id, product_id=pid, sku="SKU-B", qty=5)
    doc_id, line_id, pid = _create_dispatch(admin_client, client_id, qty=5, sku="SKU-B", product_id=pid)
    trip_id = _trip_with_dispatch(admin_client, doc_id)

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"

    blocked = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert blocked.status_code == 400, blocked.text
    assert "не подготовлены к отгрузке" in blocked.json()["detail"]
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["status"] == "unloading"

    # Передаём кладовщику в подготовку. Годную отгрузку теперь можно грузить прямо из
    # «Подготовки» — товар уезжает из ready/упаковки, ручная раскладка «Готово к рейсу»
    # не обязательна (DISPATCH_ALLOW_SHIP_FROM_PACKED).
    assert admin_client.post(f"/dispatches/{doc_id}/advance").json()["message"] == "preparing"
    ok = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full", "unload_started_at": "2026-06-10T07:35", "unload_finished_at": "2026-06-10T08:10",
    })
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "shipped"


def test_outbound_unlink_dispatch_during_loading(admin_client, client_id):
    ready, ready_line, _ = _awaiting_dispatch(admin_client, client_id, qty=4, sku="SKU-R")
    # «Опоздавшая» — с готовым остатком, но в черновике (не успела стать «Ожидает рейс»).
    late_pid = str(uuid.uuid4())
    _seed_ready(client_id, product_id=late_pid, sku="SKU-L", qty=3)
    late, late_line, _ = _create_dispatch(admin_client, client_id, qty=3, sku="SKU-L", product_id=late_pid)

    trip_id = _trip_with_dispatch(admin_client, ready)
    assert _link(admin_client, trip_id, late).status_code == 200

    assert admin_client.post(f"/trips/{trip_id}/handoff").json()["message"] == "awaiting_arrival"
    assert admin_client.post(
        f"/trips/{trip_id}/arrival", json={"arrived_at": "2026-06-10T07:30"}
    ).json()["message"] == "unloading"

    blocked = admin_client.post(f"/trips/{trip_id}/unload", json={"load_factor": "full"})
    assert blocked.status_code == 400, blocked.text

    unlink = admin_client.delete(f"/trips/{trip_id}/dispatches/{late}")
    assert unlink.status_code == 200, unlink.text

    ok = admin_client.post(f"/trips/{trip_id}/unload", json={
        "load_factor": "full", "unload_started_at": "2026-06-10T07:35", "unload_finished_at": "2026-06-10T08:10",
    })
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/dispatches/{ready}").json()["status"] == "shipped"

    late_d = admin_client.get(f"/dispatches/{late}").json()
    assert late_d["status"] == "draft"
    assert not late_d["trips"]


def test_cancel_trip_unlinks_dispatch(admin_client, client_id):
    # Аннулирование рейса «отвязывает» отгрузку: рейс исчезает из карточки и
    # количество снова свободно к распределению (отменённый рейс не держит alloc).
    doc_id, line_id, _ = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _trip_with_dispatch(admin_client, doc_id)

    linked = admin_client.get(f"/dispatches/{doc_id}").json()
    assert any(t["id"] == trip_id for t in linked["trips"])

    cancel = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["message"] == "cancelled"

    after = admin_client.get(f"/dispatches/{doc_id}").json()
    assert after["trips"] == []

    rem = admin_client.get(f"/dispatches/{doc_id}/trip-alloc-remaining").json()
    assert rem["lines"][0]["remaining"] == 5


def test_outbound_handoff_requires_linked_dispatch(admin_client):
    trip_id = admin_client.post("/trips", json={"direction": "outbound", "origin_name": "Склад"}).json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    assert "отгрузку" in bad.json()["detail"]


def test_outbound_handoff_missing_fields_use_outbound_labels(admin_client, client_id):
    doc_id, _, _ = _awaiting_dispatch(admin_client, client_id, qty=2)
    trip_id = admin_client.post("/trips", json={
        "direction": "outbound", "dispatch_doc_ids": [doc_id],
    }).json()["message"]
    bad = admin_client.post(f"/trips/{trip_id}/handoff")
    assert bad.status_code == 400, bad.text
    detail = bad.json()["detail"]
    assert "Куда" in detail
    assert "Плановое прибытие" in detail


# --- Дробление по рейсам ---

def test_dispatch_split_across_two_trips(admin_client, client_id):
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=10)

    t1 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t1, doc_id, line_id, 6).status_code == 200
    t2 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t2, doc_id, line_id, 4).status_code == 200

    _drive_to_costing(admin_client, t1)
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "partially_shipped"
    assert ship["lines"][0]["shipped_qty"] == 6
    assert _ready_net(client_id, pid) == 4

    _drive_to_costing(admin_client, t2)
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 10
    assert _ready_net(client_id, pid) == 0


def test_dispatch_split_across_three_trips(admin_client, client_id):
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=12)
    parts = [5, 5, 2]
    trips = []
    for qty in parts:
        t = _bare_outbound_trip(admin_client)
        assert _link(admin_client, t, doc_id, line_id, qty).status_code == 200
        trips.append(t)

    shipped = 0
    for t, qty in zip(trips[:-1], parts[:-1]):
        _drive_to_costing(admin_client, t)
        shipped += qty
        assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "partially_shipped"
        assert admin_client.get(f"/dispatches/{doc_id}").json()["lines"][0]["shipped_qty"] == shipped

    _drive_to_costing(admin_client, trips[-1])
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 12
    assert _ready_net(client_id, pid) == 0


def test_alloc_remaining_tracks_plan_minus_shipped(admin_client, client_id):
    doc_id, line_id, _ = _awaiting_dispatch(admin_client, client_id, qty=10)
    rem = admin_client.get(f"/dispatches/{doc_id}/trip-alloc-remaining").json()["lines"][0]
    assert rem["qty"] == 10
    assert rem["remaining"] == 10


def test_remaining_counts_only_cargo_quality(admin_client, client_id):
    # Готовый остаток считается по качеству груза: рейс товара видит только годный.
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=3, sku="SKU-Q")
    _seed_ready(client_id, product_id=pid, sku="SKU-Q", qty=5, quality="defect")
    rem = admin_client.get(f"/dispatches/{doc_id}/trip-alloc-remaining").json()["lines"][0]
    assert rem["remaining"] == 3
    assert _ready_net(client_id, pid, "good") == 3
    assert _ready_net(client_id, pid, "defect") == 5


def test_link_rejects_over_allocation(admin_client, client_id):
    doc_id, line_id, _ = _awaiting_dispatch(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t1, doc_id, line_id, 7).status_code == 200
    t2 = _bare_outbound_trip(admin_client)
    bad = _link(admin_client, t2, doc_id, line_id, 5)
    assert bad.status_code == 400, bad.text
    assert "остаток" in bad.json()["detail"].lower()
    assert _link(admin_client, t2, doc_id, line_id, 3).status_code == 200


def test_relink_dispatch_replaces_allocation(admin_client, client_id):
    doc_id, line_id, _ = _awaiting_dispatch(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t1, doc_id, line_id, 6).status_code == 200
    assert _link(admin_client, t1, doc_id, line_id, 4).status_code == 200

    detail = admin_client.get(f"/trips/{t1}").json()
    assert detail["dispatches"][0]["allocated_qty"] == 4, detail["dispatches"]
    rem = admin_client.get(f"/dispatches/{doc_id}/trip-alloc-remaining").json()["lines"]
    assert rem[0]["remaining"] == 6, rem


def test_dispatch_can_be_linked_to_multiple_trips(admin_client, client_id):
    doc_id, line_id, _ = _awaiting_dispatch(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t1, doc_id, line_id, 6).status_code == 200
    t2 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t2, doc_id, line_id, 4).status_code == 200
    # Идемпотентная повторная привязка к тому же рейсу.
    again = _link(admin_client, t1, doc_id, line_id, 6)
    assert again.status_code == 200, again.text


def test_cancel_trip_returns_partial_dispatch(admin_client, client_id):
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=10)
    t1 = _bare_outbound_trip(admin_client)
    assert _link(admin_client, t1, doc_id, line_id, 6).status_code == 200
    _drive_to_costing(admin_client, t1)
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "partially_shipped"
    assert _ready_net(client_id, pid) == 4

    cancel = admin_client.post(f"/trips/{t1}/cancel")
    assert cancel.status_code == 200, cancel.text
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "awaiting_trip"
    assert ship["lines"][0]["shipped_qty"] == 0
    assert _ready_net(client_id, pid) == 10


def _expense_awaiting(trip_id: str) -> dict | None:
    """Активный (не удалённый) логистический расход рейса, если есть."""
    with get_connection() as conn:
        return conn.execute(
            "SELECT id, payment_status FROM material_expenses "
            "WHERE source_kind = 'trip' AND source_id = ? AND COALESCE(is_deleted, 0) = 0",
            (trip_id,),
        ).fetchone()


def test_cancel_closed_trip_reverses_shipment_and_removes_expense(admin_client, client_id):
    # Закрытый outbound-рейс: аннулирование откатывает отгрузку shipped → awaiting_trip,
    # возвращает готовый остаток и снимает логистический расход рейса.
    doc_id, _, pid = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _trip_with_dispatch(admin_client, doc_id)
    _drive_to_costing(admin_client, trip_id)
    assert admin_client.post(f"/trips/{trip_id}/cost", json={"logistics_cost_actual": 8000}).status_code == 200
    assert _expense_awaiting(trip_id) is not None
    assert admin_client.post(f"/trips/{trip_id}/close").json()["message"] == "closed"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "shipped"
    assert _ready_net(client_id, pid) == 0

    cancel = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["message"] == "cancelled"
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["status"] == "cancelled"
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "awaiting_trip"
    assert ship["lines"][0]["shipped_qty"] == 0
    assert _ready_net(client_id, pid) == 5
    assert _expense_awaiting(trip_id) is None  # расход снят


def test_cancel_closed_trip_blocked_when_paid_expense(admin_client, client_id):
    # Оплаченный логистический расход блокирует аннулирование — финансы разбираются вручную.
    doc_id, _, pid = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _trip_with_dispatch(admin_client, doc_id)
    _drive_to_costing(admin_client, trip_id)
    assert admin_client.post(f"/trips/{trip_id}/cost", json={"logistics_cost_actual": 8000}).status_code == 200
    assert admin_client.post(f"/trips/{trip_id}/close").json()["message"] == "closed"
    exp = _expense_awaiting(trip_id)
    with get_connection() as conn:
        conn.execute("UPDATE material_expenses SET payment_status = 'paid' WHERE id = ?", (exp["id"],))
        conn.commit()

    cancel = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel.status_code == 400, cancel.text
    # Остатки и статус не тронуты: рейс всё ещё закрыт, отгрузка отгружена.
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["status"] == "closed"
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "shipped"
    assert _ready_net(client_id, pid) == 0


def test_cancel_closed_trip_blocked_when_dispatch_invoiced(admin_client, client_id):
    # Отгрузка в выставленном (не черновом) счёте — аннулирование рейса отклоняется.
    import uuid as _uuid

    doc_id, _, pid = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _trip_with_dispatch(admin_client, doc_id)
    _drive_to_costing(admin_client, trip_id)
    assert admin_client.post(f"/trips/{trip_id}/close").json()["message"] == "closed"

    inv_id = str(_uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO invoice_docs (id,doc_number,client_id,status,total_amount,paid_amount,created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (inv_id, f"INV-T{inv_id[:6]}", client_id, "issued", 1000, 0, "2026-06-11T00:00:00+00:00"),
        )
        conn.execute(
            "INSERT INTO invoice_shipments (id,invoice_id,shipment_doc_id,client_id,created_at) "
            "VALUES (?,?,?,?,?)",
            (str(_uuid.uuid4()), inv_id, doc_id, client_id, "2026-06-11T00:00:00+00:00"),
        )
        conn.commit()

    cancel = admin_client.post(f"/trips/{trip_id}/cancel")
    assert cancel.status_code == 400, cancel.text
    assert "счёт" in cancel.json()["detail"]
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "shipped"
    assert _ready_net(client_id, pid) == 0


# --- Кандидаты, тип груза, направление ---

def test_dispatch_candidates_include_dispatches_linked_to_other_trips(admin_client, client_id):
    own, own_line, _ = _awaiting_dispatch(admin_client, client_id, qty=5, sku="SKU-OWN")
    other, other_line, _ = _awaiting_dispatch(admin_client, client_id, qty=5, sku="SKU-OTH")
    free, _, _ = _awaiting_dispatch(admin_client, client_id, qty=5, sku="SKU-FRE")

    own_trip = _bare_outbound_trip(admin_client)
    assert _link(admin_client, own_trip, own, own_line, 5).status_code == 200
    other_trip = _bare_outbound_trip(admin_client)
    assert _link(admin_client, other_trip, other, other_line, 5).status_code == 200

    res = admin_client.get(
        f"/dispatches?available_for_trip_id={own_trip}&client_id={client_id}&limit=200"
    )
    assert res.status_code == 200, res.text
    ids = {i["id"] for i in res.json()["items"]}
    assert own not in ids       # привязана к этому рейсу
    assert other in ids         # привязана к другому — остаётся кандидатом
    assert free in ids


def test_cross_direction_linking_rejected(admin_client, client_id):
    doc_id, _, _ = _awaiting_dispatch(admin_client, client_id, qty=2)
    inbound = admin_client.post("/trips", json={"direction": "inbound"}).json()["message"]
    outbound = admin_client.post("/trips", json={"direction": "outbound"}).json()["message"]

    bad_disp = _link(admin_client, inbound, doc_id)
    assert bad_disp.status_code == 400, bad_disp.text
    bad_rec = admin_client.post(f"/trips/{outbound}/receipts", json={"receipt_doc_ids": ["whatever"]})
    assert bad_rec.status_code == 400, bad_rec.text


def test_link_rejects_cargo_mismatch(admin_client, client_id):
    good_d, _, _ = _awaiting_dispatch(admin_client, client_id, qty=3, cargo="good", sku="SKU-G")
    defect_d, _, _ = _awaiting_dispatch(admin_client, client_id, qty=3, cargo="defect", sku="SKU-DEF")

    good_trip = _bare_outbound_trip(admin_client, "good")
    defect_trip = _bare_outbound_trip(admin_client, "defect")

    bad = _link(admin_client, good_trip, defect_d)
    assert bad.status_code == 400, bad.text
    assert "не подходит" in bad.json()["detail"]

    bad2 = _link(admin_client, defect_trip, good_d)
    assert bad2.status_code == 400, bad2.text

    ok = _link(admin_client, defect_trip, defect_d)
    assert ok.status_code == 200, ok.text


def test_create_outbound_with_mismatched_cargo_rejected(admin_client, client_id):
    good_d, _, _ = _awaiting_dispatch(admin_client, client_id, qty=3, cargo="good", sku="SKU-GM")
    res = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "defect", "dispatch_doc_ids": [good_d],
    })
    assert res.status_code == 400, res.text
    # Рейс не создан (транзакция откатилась) — отгрузка свободна.
    assert not admin_client.get(f"/dispatches/{good_d}").json()["trips"]


def test_defect_dispatch_shipped_via_defect_trip(admin_client, client_id):
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=4, cargo="defect", sku="SKU-DSHIP")
    trip_id = _trip_with_dispatch(admin_client, doc_id, cargo_type="defect")
    _drive_to_costing(admin_client, trip_id)
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 4
    assert _ready_net(client_id, pid, "defect") == 0


def test_outbound_trip_cargo_type_stored_and_returned(admin_client, client_id):
    tag = f"CARGOTYPE-{uuid.uuid4()}"
    trip_id = admin_client.post("/trips", json={
        "direction": "outbound", "cargo_type": "defect", "origin_name": tag,
    }).json()["message"]
    inbound = admin_client.post("/trips", json={"direction": "inbound", "cargo_type": "defect"}).json()["message"]
    assert admin_client.get(f"/trips/{trip_id}").json()["doc"]["cargo_type"] == "defect"
    assert admin_client.get(f"/trips/{inbound}").json()["doc"]["cargo_type"] == "good"
    items = admin_client.get(f"/trips?direction=outbound&search={tag}&limit=200").json()["items"]
    assert any(t["id"] == trip_id and t["cargo_type"] == "defect" for t in items)


def test_outbound_trip_rejects_invalid_cargo_type(admin_client):
    bad = admin_client.post("/trips", json={"direction": "outbound", "cargo_type": "junk"})
    assert bad.status_code == 400, bad.text


def test_trips_search_by_dispatch_product(admin_client, client_id):
    marker = uuid.uuid4().hex[:8].upper()
    sku = f"OSK-{marker}"
    doc_id, _, _ = _awaiting_dispatch(admin_client, client_id, qty=4, sku=sku)
    trip_id = _trip_with_dispatch(admin_client, doc_id)

    by_sku = admin_client.get("/trips", params={"search": sku, "limit": 200})
    assert by_sku.status_code == 200, by_sku.text
    assert any(i["id"] == trip_id for i in by_sku.json()["items"]), "рейс не найден по SKU отгрузки"


def test_outbound_list_filter_by_direction(admin_client, client_id):
    tag = f"DIRFILTER-{uuid.uuid4()}"
    doc_id, _, _ = _awaiting_dispatch(admin_client, client_id, qty=2)
    out_trip = admin_client.post("/trips", json={
        "direction": "outbound", "origin_name": tag, "dispatch_doc_ids": [doc_id],
    }).json()["message"]
    in_trip = admin_client.post("/trips", json={"direction": "inbound", "origin_name": tag}).json()["message"]

    items = admin_client.get(f"/trips?direction=outbound&search={tag}&limit=200").json()["items"]
    out_ids = {i["id"] for i in items}
    assert out_trip in out_ids
    assert in_trip not in out_ids
    assert all(i["direction"] == "outbound" for i in items)


# --- Выезд прямо из «Упаковано» (без ручной раскладки «Готово к рейсу») ---

def _seed_packed_task(client_id: str, *, product_id: str, sku: str, qty: int) -> tuple[str, str]:
    """Упаковочная задача (shipment) в статусе «Перемещение» с упакованным годным.

    Сеет packing→packed (good) в зону упаковки с атрибуцией к строке упаковки —
    как после внесения упаковки, но до раскладки в зону отгрузки. Возвращает
    (shipment_doc_id, shipment_line_id). Имитирует состояние, из которого домен
    «Отгрузка» теперь может увезти товар, не дожидаясь «Готово к рейсу».
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    doc_id = str(uuid.uuid4())
    line_id = str(uuid.uuid4())
    with get_connection() as conn:
        packing_id, packing_name = get_packing_zone(conn)
        conn.execute(
            "INSERT INTO shipment_docs (id, doc_number, status, client_id, client_name, cargo_type, created_at) "
            "VALUES (?, ?, 'relocating', ?, 'Test Client', 'good', NOW())",
            (doc_id, f"SH-PKD-{doc_id[:8]}", client_id),
        )
        conn.execute(
            "INSERT INTO shipment_lines (id, doc_id, product_id, product_name, product_sku, qty, created_at) "
            "VALUES (?, ?, ?, 'Товар', ?, ?, NOW())",
            (line_id, doc_id, product_id, sku, qty),
        )
        insert_inventory_move(
            conn,
            product_id=product_id, product_name="Товар", product_sku=sku,
            color_id=None, color_name=None, size_id=None, size_name=None,
            client_id=client_id, client_name="Test Client",
            from_op="packing", to_op="packed", from_quality="good", to_quality="good",
            from_zone_id=packing_id, from_zone_name=packing_name,
            to_zone_id=packing_id, to_zone_name=packing_name,
            qty=qty, user_id="test", shipment_line_id=line_id,
        )
        conn.commit()
    return doc_id, line_id


def _packed_net(client_id: str, product_id: str) -> int:
    from modules.balances.service import get_available_total
    with get_connection() as conn:
        return get_available_total(
            conn, product_id=product_id, color_id=None, size_id=None,
            client_id=client_id, op="packed", quality="good",
        )


def _shipment_status(shipment_doc_id: str) -> str:
    with get_connection() as conn:
        return str(conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ?", (shipment_doc_id,)
        ).fetchone()["status"])


def test_ship_good_from_packed_closes_packing_task(admin_client, client_id):
    # Товар только упакован (в `packed`), раскладку «Готово к рейсу» НЕ делали.
    pid = str(uuid.uuid4())
    sh_doc, sh_line = _seed_packed_task(client_id, product_id=pid, sku="SKU-PK", qty=8)
    assert _packed_net(client_id, pid) == 8
    assert _ready_net(client_id, pid) == 0

    doc_id, line_id, pid = _create_dispatch(admin_client, client_id, qty=8, sku="SKU-PK", product_id=pid)
    # Передача в подготовку проходит за счёт упакованного (источник ready+packed).
    assert admin_client.post(f"/dispatches/{doc_id}/advance").json()["message"] == "preparing"

    # Остаток к распределению в рейс виден из упаковки (а не 0).
    rem = admin_client.get(f"/dispatches/{doc_id}/trip-alloc-remaining").json()["lines"]
    assert rem[0]["remaining"] == 8, rem

    trip_id = _bare_outbound_trip(admin_client)
    assert _link(admin_client, trip_id, doc_id, line_id, 8).status_code == 200
    _drive_to_costing(admin_client, trip_id)

    # Отгрузка уехала прямо из упаковки, остаток packed обнулился.
    ship = admin_client.get(f"/dispatches/{doc_id}").json()
    assert ship["status"] == "shipped"
    assert ship["lines"][0]["shipped_qty"] == 8
    assert _packed_net(client_id, pid) == 0
    # Упаковочная задача закрылась автоматически (relocating → packed).
    assert _shipment_status(sh_doc) == "packed"
