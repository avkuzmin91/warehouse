"""Unit-тесты видимости задач по ролям (fake connection, без БД).

Проверяют ключевое свойство роли «Начальник склада» (warehouse_head):
он видит очередь и кладовщика, и начальника смены одновременно.
"""

from __future__ import annotations

from config import SHIPMENT_STATUS_ON_PACKING, TRIP_STATUS_UNLOADING
from modules.tasks.service import list_my_tasks


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    """Минимальный стенд: возвращает заранее заданные строки по таблице из SQL."""

    def __init__(self, *, trips=None, receipts=None, shipments=None):
        self._trips = trips or []
        self._receipts = receipts or []
        self._shipments = shipments or []

    def execute(self, sql, params=()):
        # Очередь развозки читает журнал с подзапросом по shipment_docs — это не документы.
        if "zone_relocations" in sql:
            return _Result([])
        if "trip_docs" in sql:
            return _Result(self._trips)
        if "receipt_docs" in sql:
            return _Result(self._receipts)
        if "shipment_docs" in sql:
            return _Result(self._shipments)
        return _Result([])


def _conn() -> _FakeConn:
    return _FakeConn(
        trips=[{
            "id": "t1", "trip_number": "TR-00001", "status": TRIP_STATUS_UNLOADING,
            "direction": "inbound", "eta": None, "vehicle_number": None,
            "updated_at": "2026-06-10T00:00:00", "created_at": "2026-06-10T00:00:00",
        }],
        shipments=[{
            "id": "s1", "doc_number": "SH-00001", "status": SHIPMENT_STATUS_ON_PACKING,
            "cargo_type": "good", "ship_date": None, "priority_rank": None,
            "updated_at": "2026-06-10T00:00:00", "created_at": "2026-06-10T00:00:00",
        }],
    )


def _kinds(role: str) -> set[str]:
    tasks = list_my_tasks(_conn(), user={"role": role})
    return {t["kind"] for t in tasks}


def test_warehouse_head_sees_both_queues():
    kinds = _kinds("warehouse_head")
    assert "trip_unload" in kinds          # очередь кладовщика (разгрузка/приёмка рейса)
    assert "shipment_pack" in kinds        # очередь начальника смены


def test_warehouse_manager_sees_only_warehouse_queue():
    kinds = _kinds("warehouse_manager")
    assert "trip_unload" in kinds
    assert "shipment_pack" not in kinds


def test_shift_supervisor_sees_only_shift_queue():
    kinds = _kinds("shift_supervisor")
    assert "shipment_pack" in kinds
    assert "trip_unload" not in kinds
