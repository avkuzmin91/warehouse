"""Закрытие отгрузки с недовозом: Частично отгружено → Отгружено.

Рейс увёз меньше плана и остаток больше не поедет — менеджер закрывает документ.
Проверяем гейт (активный рейс), сохранение плана/факта, освобождение резерва под
следующую отгрузку и тарификацию по факту. Требует DATABASE_URL.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import admin_client, make_client_id, cleanup_client  # noqa: F401
from tests.test_logistics_outbound import (  # noqa: F401
    _awaiting_dispatch,
    _bare_outbound_trip,
    _create_dispatch,
    _drive_to_costing,
    _link,
    _ready_net,
    _seed_ready,
)


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _partially_shipped(admin_client, client_id: str, *, plan: int = 10, shipped: int = 6):
    """Отгрузка, у которой рейс увёз часть плана. Возвращает (doc_id, line_id, product_id)."""
    doc_id, line_id, pid = _awaiting_dispatch(admin_client, client_id, qty=plan)
    trip_id = _bare_outbound_trip(admin_client)
    assert _link(admin_client, trip_id, doc_id, line_id, shipped).status_code == 200
    _drive_to_costing(admin_client, trip_id)
    detail = admin_client.get(f"/dispatches/{doc_id}").json()
    assert detail["status"] == "partially_shipped"
    assert detail["lines"][0]["shipped_qty"] == shipped
    return doc_id, line_id, pid


def test_close_short_finishes_dispatch_and_keeps_plan(admin_client, client_id):
    doc_id, _line_id, pid = _partially_shipped(admin_client, client_id, plan=10, shipped=6)
    assert admin_client.get(f"/dispatches/{doc_id}").json()["can_close_short"] is True

    r = admin_client.post(f"/dispatches/{doc_id}/close-short")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "shipped"

    d = admin_client.get(f"/dispatches/{doc_id}").json()
    assert d["status"] == "shipped"
    assert d["closed_short_at"] is not None
    assert d["can_close_short"] is False
    # План остался заявленным клиентом, факт — что уехало.
    assert d["lines"][0]["qty"] == 10
    assert d["lines"][0]["shipped_qty"] == 6
    # Неувезённое осталось на складе — сток не двигали.
    assert _ready_net(client_id, pid) == 4
    ops = [o for o in d["ops"] if o["op_type"] == "close_short"]
    assert ops and "закрыто с недовозом: отгружено 6 из 10 шт." in ops[0]["comment"]

    # Повторный вызов на терминальном статусе — отказ.
    again = admin_client.post(f"/dispatches/{doc_id}/close-short")
    assert again.status_code == 400
    assert "частично отгруженный" in again.json()["detail"]


def test_close_short_gated_by_active_trip(admin_client, client_id):
    doc_id, line_id, _pid = _partially_shipped(admin_client, client_id, plan=10, shipped=6)

    # Остаток распределён в новый рейс — это ожидание, а не недовоз.
    trip_id = _bare_outbound_trip(admin_client)
    assert _link(admin_client, trip_id, doc_id, line_id, 4).status_code == 200
    assert admin_client.get(f"/dispatches/{doc_id}").json()["can_close_short"] is False
    blocked = admin_client.post(f"/dispatches/{doc_id}/close-short")
    assert blocked.status_code == 400
    assert "отвяжите" in blocked.json()["detail"]

    # Отвязали — недовоз можно закрыть.
    assert admin_client.delete(f"/trips/{trip_id}/dispatches/{doc_id}").status_code == 200
    assert admin_client.get(f"/dispatches/{doc_id}").json()["can_close_short"] is True
    assert admin_client.post(f"/dispatches/{doc_id}/close-short").json()["message"] == "shipped"


def test_close_short_releases_reserve_for_next_dispatch(admin_client, client_id):
    doc_id, _line_id, pid = _partially_shipped(admin_client, client_id, plan=10, shipped=6)

    # Пока документ висит в «Частично отгружено», недовоз держит резерв: следующая
    # отгрузка того же варианта не проходит гейт по готовому остатку.
    next_id, _next_line, _pid = _create_dispatch(
        admin_client, client_id, qty=4, sku="SKU-D", product_id=pid
    )
    blocked = admin_client.post(f"/dispatches/{next_id}/advance")
    assert blocked.status_code == 200
    assert blocked.json()["message"] == "awaiting_packing"   # годного не хватает — очередь упаковки

    assert admin_client.post(f"/dispatches/{doc_id}/close-short").json()["message"] == "shipped"

    # Резерв снят — тот же остаток теперь доступен новой отгрузке.
    after_id, _l, _p = _create_dispatch(
        admin_client, client_id, qty=4, sku="SKU-D", product_id=pid
    )
    ok = admin_client.post(f"/dispatches/{after_id}/advance")
    assert ok.status_code == 200, ok.text
    assert ok.json()["message"] == "preparing"


def test_closed_short_dispatch_is_billed_by_fact(admin_client, client_id):
    doc_id, _line_id, _pid = _partially_shipped(admin_client, client_id, plan=10, shipped=6)
    assert admin_client.post(f"/dispatches/{doc_id}/close-short").json()["message"] == "shipped"

    # Реестр «без счёта»: количество — фактически уехавшее, не план.
    reg = admin_client.get(f"/invoices/uninvoiced-shipments?client_id={client_id}&limit=200")
    assert reg.status_code == 200, reg.text
    item = next(it for it in reg.json()["items"] if it["id"] == doc_id)
    assert item["total_qty"] == 6
    assert item["products_preview"][0]["qty"] == 6

    # Сводный состав (roll-up при выборе в счёт) — тоже по факту.
    roll = admin_client.get(f"/invoices/shipment-contents?shipment_ids={doc_id}")
    assert roll.status_code == 200, roll.text
    assert roll.json()["total_qty"] == 6


def test_close_short_rejected_without_shortfall(admin_client, client_id):
    # Уехал весь план — статус сразу shipped, закрывать нечего.
    doc_id, line_id, _pid = _awaiting_dispatch(admin_client, client_id, qty=5)
    trip_id = _bare_outbound_trip(admin_client)
    assert _link(admin_client, trip_id, doc_id, line_id, 5).status_code == 200
    _drive_to_costing(admin_client, trip_id)
    assert admin_client.get(f"/dispatches/{doc_id}").json()["status"] == "shipped"

    r = admin_client.post(f"/dispatches/{doc_id}/close-short")
    assert r.status_code == 400
    assert "частично отгруженный" in r.json()["detail"]
