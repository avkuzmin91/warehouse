"""Отмена FBS-заказа на площадке.

Правило: отмена сама не двигает сток — она уменьшает потребность поставки и
поднимает флаг. Собранное под снятый заказ возвращает на полку человек сканом.
Заказ, уже отданный площадке, не снимается вовсе: вынуть его оттуда нельзя.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from config import (
    INV_OP_PICKED,
    MP_SUPPLY_PICK_OP,
    MP_ORDER_STATUS_CANCELLED,
    MP_SUPPLY_OP_ORDER_CANCELLED,
    MP_SUPPLY_ORDER_SELECTED,
    MP_SUPPLY_ORDER_UNSELECTED,
    MP_SUPPLY_STATUS_PACKING,
)
from dbconn import get_connection
from modules.marketplaces import service as mp_service
from tests.test_mp_supplies import (  # noqa: F401
    _add_order,
    _detail,
    _net,
    _now,
    _pick,
    _route,
    _supplies,
    _to_picking,
    fbs,
)


def _cancel_on_marketplace(external_id: str) -> None:
    """Площадка отменила заказ — синк увидит это следующим циклом."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE mp_orders SET status = ?, external_status = 'cancelled' WHERE external_id = ?",
            (MP_ORDER_STATUS_CANCELLED, external_id),
        )
        conn.commit()


def _release() -> int:
    with get_connection() as conn:
        released = mp_service.release_cancelled_orders(conn)
        conn.commit()
    return released


def _state_of(supply_id: str, external_id: str) -> str:
    return next(
        o["state"] for o in _detail(supply_id)["orders"] if o["external_id"] == external_id
    )


def _blockers(supply_id: str) -> list[str]:
    with get_connection() as conn:
        status = str(mp_service.load_supply(conn, supply_id)["status"])
        return mp_service.supply_advance_blockers(conn, supply_id, status)


def test_cancelled_order_leaves_the_picking_supply(fbs):
    """Снятие автоматическое и на рабочих фазах, а не только пока состав набирается."""
    supply_id = _to_picking(fbs, qty=1, orders=2)
    _cancel_on_marketplace("0192-p1")

    assert _release() == 1

    assert _state_of(supply_id, "0192-p1") == MP_SUPPLY_ORDER_UNSELECTED
    assert _state_of(supply_id, "0192-p0") == MP_SUPPLY_ORDER_SELECTED
    detail = _detail(supply_id)
    assert detail["doc"]["orders_total"] == 1
    assert detail["doc"]["orders_cancelled"] == 1
    assert sum(i["need_qty"] for i in detail["pick_list"]) == 1


def test_goods_picked_for_a_cancelled_order_become_a_return_debt(fbs):
    """Товар уже в руках: отмена не списывает и не возвращает его сама."""
    supply_id = _to_picking(fbs, qty=1, orders=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=2)
        conn.commit()
    _cancel_on_marketplace("0192-p1")
    _release()

    assert _detail(supply_id)["doc"]["return_debt_qty"] == 1
    assert any("Вернуть на место: 1 шт." in b for b in _blockers(supply_id))
    assert _net(fbs, INV_OP_PICKED) == 2

    with get_connection() as conn:
        result = mp_service.return_pick(
            conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
            qty=1, user_id="u", role="admin",
        )
        conn.commit()

    assert result["returned_qty"] == 1 and result["debt_total_qty"] == 0
    assert _net(fbs, INV_OP_PICKED) == 1
    assert _net(fbs, MP_SUPPLY_PICK_OP, zone_id=fbs["cell_id"]) == 9
    assert _detail(supply_id)["doc"]["return_debt_qty"] == 0
    with get_connection() as conn:
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PACKING
        conn.commit()


def test_return_cannot_take_more_than_the_debt(fbs):
    """Возврат существует ради снятых заказов, а не как способ распустить состав."""
    supply_id = _to_picking(fbs, qty=1, orders=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=2)
        conn.commit()

    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.return_pick(
                conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
                qty=1, user_id="u", role="admin",
            )
    assert "лишнего нет" in str(getattr(exc.value, "detail", exc.value))

    _cancel_on_marketplace("0192-p1")
    _release()
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.return_pick(
                conn, supply_id, barcode=fbs["barcode"], zone_id=fbs["cell_id"],
                qty=2, user_id="u", role="admin",
            )
    assert "только 1 шт." in str(getattr(exc.value, "detail", exc.value))


def test_order_already_handed_to_the_marketplace_stays_in_the_supply(fbs):
    """Задание, попавшее в поставку продавца, площадка назад не отдаёт — только след."""
    supply_id = _to_picking(fbs, qty=1, orders=2)
    with get_connection() as conn:
        conn.execute(
            "UPDATE mp_orders SET mp_shipped_at = ? WHERE external_id = ?", (_now().isoformat(), "0192-p1"),
        )
        conn.commit()
    _cancel_on_marketplace("0192-p1")

    assert _release() == 0
    assert _release() == 0

    assert _state_of(supply_id, "0192-p1") == MP_SUPPLY_ORDER_SELECTED
    assert _detail(supply_id)["doc"]["orders_cancelled_held"] == 1
    with get_connection() as conn:
        notes = conn.execute(
            "SELECT COUNT(*) AS n FROM mp_supply_ops WHERE supply_id = ? AND op_type = ?",
            (supply_id, MP_SUPPLY_OP_ORDER_CANCELLED),
        ).fetchone()
    assert int(notes["n"]) == 1


def test_cancelled_order_cannot_be_put_back_into_the_supply(fbs):
    """Снятый отменой заказ остаётся строкой поставки — галочку на него не вернуть."""
    _add_order(fbs, external_id="0192-c0", deadline=_now() + timedelta(hours=5), qty=1)
    _add_order(fbs, external_id="0192-c1", deadline=_now() + timedelta(hours=5), qty=1)
    supply_id = _route(fbs)
    _cancel_on_marketplace("0192-c1")
    _release()

    order_ids = [o["order_id"] for o in _detail(supply_id)["orders"]]
    with pytest.raises(Exception) as exc:
        with get_connection() as conn:
            mp_service.set_supply_orders(conn, supply_id, order_ids, "u")
    assert "отменён на площадке" in str(getattr(exc.value, "detail", exc.value))
