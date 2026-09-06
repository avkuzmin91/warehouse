"""FBS-поставка после сборки: упаковка заказов (ШК/ЧЗ, этикетка площадки),
грузовые места и передача площадке.

Площадки заглушены на уровне `modules.marketplaces.clients`: проверяется, что
и с какими данными уходит на Ozon/WB, а не сама сеть.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime

import pytest

from config import (
    MP_CARGO_STATUS_CLOSED,
    MP_CARGO_STATUS_OPEN,
    MP_SUPPLY_STATUS_DONE,
    MP_SUPPLY_STATUS_HANDOVER,
    MP_SUPPLY_STATUS_PACKING,
    MP_WB,
    UPLOADS_DIR,
)
from dbconn import get_connection
from fastapi import HTTPException
from modules.marketplaces import service as mp_service
from modules.marketplaces.clients import MpApiError
from tests.test_mp_supplies import (  # noqa: F401
    _add_order,
    _net,
    _pick,
    _route,
    _supplies,
    _to_picking,
    fbs,
)

GS = "\x1d"
EAN13 = "4600001234567"
# Тот же сборщик, что у фикстуры picker_client: собранная поставка остаётся за ним.
PICKER_ID = "test-picker-id"
GTIN14 = "0" + EAN13


def _now() -> datetime:
    return datetime.now(UTC)


def _cis(serial: str) -> str:
    return f"01{GTIN14}21{serial}{GS}91EE06{GS}92dGVzdA=="


@pytest.fixture
def packing(fbs):
    """Поставка Ozon на упаковке: один заказ на 2 шт., собрано 2 шт., у варианта есть EAN-13."""
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, created_at, is_deleted) "
            "VALUES (?,?,?,?,NOW(),0)",
            (str(uuid.uuid4()), fbs["product_id"], fbs["variant_id"], EAN13),
        )
        _pick(conn, fbs, supply_id, qty=2, user_id=PICKER_ID)
        assert mp_service.advance_supply(conn, supply_id, "u") == MP_SUPPLY_STATUS_PACKING
        order = conn.execute(
            "SELECT o.id, o.external_id FROM mp_supply_orders so JOIN mp_orders o ON o.id = so.order_id "
            "WHERE so.supply_id = ?", (supply_id,),
        ).fetchone()
        # Состав отправления Ozon, как его отдаёт синк: sku нужен для сборки.
        conn.execute(
            "UPDATE mp_orders SET payload = ? WHERE id = ?",
            (json.dumps({"posting_number": order["external_id"],
                         "products": [{"sku": 777001, "offer_id": "ART-1", "quantity": 2}]}),
             str(order["id"])),
        )
        conn.commit()
    yield {**fbs, "supply_id": supply_id, "order_id": str(order["id"]),
           "external_id": str(order["external_id"])}
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT label_url FROM mp_orders WHERE account_id = ? AND label_url IS NOT NULL",
            (fbs["account_id"],),
        ).fetchall()
        conn.execute(
            "DELETE FROM mp_cargo_unit_orders WHERE cargo_unit_id IN "
            "(SELECT id FROM mp_cargo_units WHERE supply_id = ?)", (supply_id,))
        conn.execute("DELETE FROM mp_cargo_units WHERE supply_id = ?", (supply_id,))
        conn.execute("DELETE FROM mp_supply_packs WHERE supply_id = ?", (supply_id,))
        conn.execute("DELETE FROM marking_codes WHERE gtin = ?", (GTIN14,))
        conn.commit()
    for r in rows:
        path = UPLOADS_DIR / str(r["label_url"]).rsplit("/", 1)[-1]
        if path.exists():
            path.unlink()


class _OzonStub:
    """Заглушка Ozon: помнит, что ушло, и умеет падать по команде."""

    def __init__(self, monkeypatch, *, fail_label: bool = False):
        self.shipped: list[tuple[str, list]] = []
        self.exemplars: list[tuple[str, list]] = []
        self.labels: list[list[str]] = []
        self.fail_label = fail_label
        monkeypatch.setattr(mp_service.clients, "ozon_ship_posting",
                            lambda creds, n, products: self.shipped.append((n, products)))
        monkeypatch.setattr(mp_service.clients, "ozon_set_exemplars",
                            lambda creds, n, products: self.exemplars.append((n, products)))

        def label(creds, numbers):
            self.labels.append(list(numbers))
            if self.fail_label:
                raise MpApiError("Ozon: этикетка ещё не готова", retriable=True)
            return b"%PDF-1.4 test label"

        monkeypatch.setattr(mp_service.clients, "ozon_package_label", label)


def _scan(conn, p, code: str, *, qty: int = 1) -> dict:
    return mp_service.register_pack_scan(
        conn, p["supply_id"], p["order_id"], code=code, qty=qty, user_id="u", role="admin",
    )


def _view(supply_id: str) -> dict:
    with get_connection() as conn:
        return mp_service.supply_pack_view(conn, supply_id)


# ── Упаковка заказов ──────────────────────────────────────────────────────────

def test_picking_now_leads_to_packing_and_closes_intake(packing):
    row = _supplies(packing)[0]
    assert row["status"] == MP_SUPPLY_STATUS_PACKING
    assert row["packing_at"] is not None
    assert row["intake_closed_at"] is not None


def test_pack_scan_by_barcode_fills_the_order_line(packing):
    with get_connection() as conn:
        first = _scan(conn, packing, packing["barcode"])
        assert first["packed_qty"] == 1 and not first["order_complete"]
        second = _scan(conn, packing, packing["barcode"])
        assert second["packed_qty"] == 2 and second["order_complete"]
        conn.commit()
    view = _view(packing["supply_id"])
    order = view["orders"][0]
    assert order["complete"] and order["packed_qty"] == 2 and not order["packed_at"]
    assert view["table"][0]["on_table_qty"] == 0


def test_pack_scan_over_the_line_is_rejected(packing):
    with get_connection() as conn:
        _scan(conn, packing, packing["barcode"], qty=2)
        with pytest.raises(HTTPException) as exc:
            _scan(conn, packing, packing["barcode"])
        assert "уже укомплектована" in exc.value.detail


def test_pack_scan_needs_picked_stock_on_the_table(fbs):
    """Собрано 1 шт. при потребности 2 — второй скан упаковки упирается в стол."""
    supply_id = _to_picking(fbs, qty=2)
    with get_connection() as conn:
        _pick(conn, fbs, supply_id, qty=1)
        conn.execute(
            "UPDATE mp_supplies SET status = ?, packing_at = NOW() WHERE id = ?",
            (MP_SUPPLY_STATUS_PACKING, supply_id),
        )
        order_id = conn.execute(
            "SELECT order_id FROM mp_supply_orders WHERE supply_id = ?", (supply_id,),
        ).fetchone()["order_id"]
        mp_service.register_pack_scan(
            conn, supply_id, str(order_id), code=fbs["barcode"], qty=1, user_id="u", role="admin",
        )
        with pytest.raises(HTTPException) as exc:
            mp_service.register_pack_scan(
                conn, supply_id, str(order_id), code=fbs["barcode"], qty=1, user_id="u", role="admin",
            )
        assert "На столе нет" in exc.value.detail


def test_cis_scan_binds_the_marking_code_and_rejects_its_reuse(packing):
    with get_connection() as conn:
        res = _scan(conn, packing, _cis("SERIAL0000001"))
        assert res["cis_serial"] == "SERIAL0000001"
        code = conn.execute(
            "SELECT id, variant_id FROM marking_codes WHERE gtin = ? AND serial = ?",
            (GTIN14, "SERIAL0000001"),
        ).fetchone()
        assert code and str(code["variant_id"]) == packing["variant_id"]
        with pytest.raises(HTTPException) as exc:
            _scan(conn, packing, _cis("SERIAL0000001"))
        assert "уже уложен" in exc.value.detail
        # Откат освобождает код, и он снова принимается.
        mp_service.undo_pack_scan(conn, packing["supply_id"], res["pack_id"], "u", "admin")
        again = _scan(conn, packing, _cis("SERIAL0000001"))
        assert again["packed_qty"] == 1


def test_pack_order_requires_a_complete_order(packing):
    with get_connection() as conn:
        _scan(conn, packing, packing["barcode"])
        with pytest.raises(HTTPException) as exc:
            mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        assert "не укомплектован" in exc.value.detail


def test_packed_order_ships_on_ozon_with_marks_and_gets_a_label(packing, monkeypatch):
    stub = _OzonStub(monkeypatch)
    with get_connection() as conn:
        _scan(conn, packing, _cis("SERIAL0000001"))
        _scan(conn, packing, _cis("SERIAL0000002"))
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        res = mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        conn.commit()
    assert res["ok"] and res["label_url"].startswith("/uploads/") and res["label_url"].endswith(".pdf")
    assert (UPLOADS_DIR / res["label_url"].rsplit("/", 1)[-1]).read_bytes().startswith(b"%PDF")
    assert stub.shipped == [(packing["external_id"], [{"product_id": 777001, "quantity": 2}])]
    number, products = stub.exemplars[0]
    assert number == packing["external_id"]
    marks = sorted(e["mandatory_mark"] for e in products[0]["exemplars"])
    assert marks == [_cis("SERIAL0000001"), _cis("SERIAL0000002")]
    order = _view(packing["supply_id"])["orders"][0]
    assert order["packed_at"] and order["mp_shipped_at"] and order["label_barcode"] == packing["external_id"]


def test_marketplace_error_is_kept_on_the_order_and_retry_fetches_the_label(packing, monkeypatch):
    stub = _OzonStub(monkeypatch, fail_label=True)
    with get_connection() as conn:
        _scan(conn, packing, packing["barcode"], qty=2)
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        res = mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        conn.commit()
    assert not res["ok"] and "не готова" in res["error"]
    view = _view(packing["supply_id"])
    order = view["orders"][0]
    assert order["mp_shipped_at"] and not order["label_url"] and order["mp_error"]
    assert any("Нет этикетки" in b for b in view["blockers"])
    # Повтор: отправление второй раз не собирается, только этикетка.
    stub.fail_label = False
    with get_connection() as conn:
        res = mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        conn.commit()
    assert res["ok"] and len(stub.shipped) == 1 and len(stub.labels) == 2
    assert _view(packing["supply_id"])["orders"][0]["mp_error"] is None


def test_unpack_is_closed_once_the_marketplace_knows(packing, monkeypatch):
    _OzonStub(monkeypatch)
    with get_connection() as conn:
        _scan(conn, packing, packing["barcode"], qty=2)
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        # До отправки площадке заказ открывается заново.
        mp_service.unpack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        with pytest.raises(HTTPException) as exc:
            mp_service.unpack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        assert "уже собрано на площадке" in exc.value.detail


def test_finish_packing_waits_for_every_order_and_label(packing, monkeypatch):
    _OzonStub(monkeypatch)
    with get_connection() as conn:
        assert any("Не упаковано" in b for b in
                   mp_service.supply_advance_blockers(conn, packing["supply_id"], MP_SUPPLY_STATUS_PACKING))
        _scan(conn, packing, packing["barcode"], qty=2)
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        assert any("Нет этикетки" in b for b in
                   mp_service.supply_advance_blockers(conn, packing["supply_id"], MP_SUPPLY_STATUS_PACKING))
        mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        assert mp_service.advance_supply(conn, packing["supply_id"], "u") == MP_SUPPLY_STATUS_HANDOVER
        conn.commit()


# ── Грузовые места ────────────────────────────────────────────────────────────

def _to_handover(packing, monkeypatch) -> None:
    _OzonStub(monkeypatch)
    with get_connection() as conn:
        _scan(conn, packing, packing["barcode"], qty=2)
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        mp_service.advance_supply(conn, packing["supply_id"], "u")
        conn.commit()


def test_cargo_unit_takes_only_packed_orders_and_closes_full(packing, monkeypatch):
    with get_connection() as conn:
        unit = mp_service.create_cargo_unit(conn, packing["supply_id"], "box", "u")
        assert unit["doc_number"].startswith("GM-") and unit["status"] == MP_CARGO_STATUS_OPEN
        with pytest.raises(HTTPException) as exc:
            mp_service.add_order_to_cargo(conn, unit["id"], packing["external_id"], "u")
        assert "ещё не упакован" in exc.value.detail
        with pytest.raises(HTTPException):
            mp_service.close_cargo_unit(conn, unit["id"], "u")
        conn.commit()
    _to_handover(packing, monkeypatch)
    with get_connection() as conn:
        # Этикетка ГМ: QR с префиксом wms:gm, по нему же короб находится сканом.
        labels = mp_service.cargo_labels(conn, [unit["id"]])
        assert labels[0]["payload"] == f"wms:gm:{unit['id']}" and "<svg" in labels[0]["qr_svg"]
        found = mp_service.lookup_cargo_unit(conn, labels[0]["payload"])
        assert found and found["id"] == unit["id"]
        assert mp_service.lookup_cargo_unit(conn, unit["doc_number"].lower())["id"] == unit["id"]

        blockers = mp_service.supply_advance_blockers(conn, packing["supply_id"], MP_SUPPLY_STATUS_HANDOVER)
        assert any("Не уложено в грузовые места" in b for b in blockers)

        # Скан этикетки заказа = штрих-код стикера площадки (у Ozon — номер отправления).
        res = mp_service.add_order_to_cargo(conn, unit["id"], packing["external_id"], "u")
        assert not res["already"] and res["orders_count"] == 1
        assert mp_service.add_order_to_cargo(conn, unit["id"], packing["external_id"], "u")["already"]

        other = mp_service.create_cargo_unit(conn, packing["supply_id"], "pallet", "u")
        with pytest.raises(HTTPException) as exc:
            mp_service.add_order_to_cargo(conn, other["id"], packing["external_id"], "u")
        assert "уже лежит" in exc.value.detail
        mp_service.delete_cargo_unit(conn, other["id"], "u")

        blockers = mp_service.supply_advance_blockers(conn, packing["supply_id"], MP_SUPPLY_STATUS_HANDOVER)
        assert blockers == [f"Не закрыто грузовых мест: {unit['doc_number']}"]
        closed = mp_service.close_cargo_unit(conn, unit["id"], "u")
        assert closed["status"] == MP_CARGO_STATUS_CLOSED
        with pytest.raises(HTTPException):
            mp_service.remove_order_from_cargo(conn, unit["id"], packing["order_id"], "u")
        assert mp_service.supply_advance_blockers(conn, packing["supply_id"], MP_SUPPLY_STATUS_HANDOVER) == []

        # Ozon: передача без сетевых вызовов, сток уходит picked → shipped.
        assert mp_service.handover_supply_to_marketplace(conn, packing["supply_id"], "u") == {"registered": 0}
        assert mp_service.advance_supply(conn, packing["supply_id"], "u") == MP_SUPPLY_STATUS_DONE
        conn.commit()
    assert _net(packing, "picked") == 0
    assert _net(packing, "shipped") == 2
    with get_connection() as conn:
        detail = mp_service.supply_detail(conn, packing["supply_id"])
    assert detail["orders"][0]["cargo_unit_number"] == unit["doc_number"]
    assert detail["doc"]["cargo_units_total"] == 1


def test_wb_handover_registers_boxes_and_delivers_the_supply(packing, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(mp_service.clients, "wb_create_supply", lambda c, name: "WB-GI-1")
    monkeypatch.setattr(mp_service.clients, "wb_add_orders_to_supply",
                        lambda c, s, ids: calls.append(("add", s, list(ids))))
    monkeypatch.setattr(mp_service.clients, "wb_set_order_sgtins",
                        lambda c, o, sgtins: calls.append(("sgtin", o, list(sgtins))))
    png = base64.b64encode(b"\x89PNG fake").decode()
    monkeypatch.setattr(mp_service.clients, "wb_order_stickers",
                        lambda c, ids: [{"orderId": ids[0], "barcode": "231000123456", "file": png}])
    monkeypatch.setattr(mp_service.clients, "wb_create_boxes",
                        lambda c, s, n: [f"WB-TRBX-{i}" for i in range(n)])
    monkeypatch.setattr(mp_service.clients, "wb_box_set_orders",
                        lambda c, s, box, ids: calls.append(("box", box, list(ids))))
    monkeypatch.setattr(mp_service.clients, "wb_supply_deliver", lambda c, s: calls.append(("deliver", s)))

    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET marketplace = ? WHERE id = ?", (MP_WB, packing["account_id"]))
        conn.execute("UPDATE mp_orders SET external_id = '4455667' WHERE id = ?", (packing["order_id"],))
        _scan(conn, packing, _cis("SERIAL0000009"))
        _scan(conn, packing, packing["barcode"])
        mp_service.pack_order(conn, packing["supply_id"], packing["order_id"], "u", "admin")
        res = mp_service.push_order_to_marketplace(conn, packing["supply_id"], packing["order_id"], "u")
        assert res["ok"] and res["label_barcode"] == "231000123456" and res["label_url"].endswith(".png")
        assert ("add", "WB-GI-1", ["4455667"]) in calls
        assert ("sgtin", "4455667", [_cis("SERIAL0000009")]) in calls
        assert conn.execute(
            "SELECT external_supply_id FROM mp_supplies WHERE id = ?", (packing["supply_id"],),
        ).fetchone()["external_supply_id"] == "WB-GI-1"
        mp_service.advance_supply(conn, packing["supply_id"], "u")
        unit = mp_service.create_cargo_unit(conn, packing["supply_id"], "box", "u")
        # Стикер площадки — то, что сканируют при укладке в короб.
        mp_service.add_order_to_cargo(conn, unit["id"], "231000123456", "u")
        mp_service.close_cargo_unit(conn, unit["id"], "u")
        assert mp_service.handover_supply_to_marketplace(conn, packing["supply_id"], "u") == {"registered": 1}
        assert ("box", "WB-TRBX-0", [4455667]) in calls and ("deliver", "WB-GI-1") in calls
        assert mp_service.load_cargo_unit(conn, unit["id"])["external_id"] == "WB-TRBX-0"
        with pytest.raises(HTTPException):
            mp_service.reopen_cargo_unit(conn, unit["id"], "u")
        assert mp_service.advance_supply(conn, packing["supply_id"], "u") == MP_SUPPLY_STATUS_DONE
        conn.commit()


# ── Доступ и задачи ───────────────────────────────────────────────────────────

def test_packing_supply_stays_with_the_picker_who_collected_it(picker_client, packing):
    """Упаковка — продолжение сборки: поставка остаётся за собравшим её сборщиком."""
    tasks = picker_client.get("/tasks").json()["items"]
    mine = [t for t in tasks if t["doc_id"] == packing["supply_id"]]
    assert mine and mine[0]["kind"] == "mp_supply_pack"
    assert picker_client.get(f"/marketplaces/supplies/{packing['supply_id']}/pack-view").status_code == 200
    queue = picker_client.get("/marketplaces/supplies/queue/next").json()
    assert queue["supply_id"] == packing["supply_id"] and queue["supply_status"] == MP_SUPPLY_STATUS_PACKING
    res = picker_client.post(
        f"/marketplaces/supplies/{packing['supply_id']}/orders/{packing['order_id']}/pack-scans",
        json={"code": packing["barcode"]},
    )
    assert res.status_code == 200, res.text


def test_handover_supply_is_a_cargo_task_for_the_warehouse(warehouse_client, manager_client, packing, monkeypatch):
    _to_handover(packing, monkeypatch)
    tasks = warehouse_client.get("/tasks").json()["items"]
    mine = [t for t in tasks if t["doc_id"] == packing["supply_id"]]
    assert mine and mine[0]["kind"] == "mp_supply_cargo"
    created = warehouse_client.post(
        f"/marketplaces/supplies/{packing['supply_id']}/cargo", json={"kind": "box"},
    )
    assert created.status_code == 200, created.text
    unit_id = created.json()["id"]
    assert warehouse_client.get(f"/marketplaces/cargo/labels?ids={unit_id}").status_code == 200
    assert warehouse_client.get(f"/marketplaces/cargo/by-code/wms:gm:{unit_id}").json()["found"]
    added = warehouse_client.post(
        f"/marketplaces/cargo/{unit_id}/orders", json={"code": packing["external_id"]},
    )
    assert added.status_code == 200, added.text
    assert warehouse_client.post(f"/marketplaces/cargo/{unit_id}/close").status_code == 200
    detail = manager_client.get(f"/marketplaces/supplies/{packing['supply_id']}").json()
    assert detail["cargo_units"][0]["status"] == MP_CARGO_STATUS_CLOSED
    assert detail["orders"][0]["cargo_unit_id"] == unit_id
    assert manager_client.post(f"/marketplaces/supplies/{packing['supply_id']}/advance").status_code == 200
    assert _supplies(packing)[0]["status"] == MP_SUPPLY_STATUS_DONE


def test_pack_scan_is_idempotent_by_request_id(picker_client, packing):
    url = f"/marketplaces/supplies/{packing['supply_id']}/orders/{packing['order_id']}/pack-scans"
    headers = {"X-Request-Id": str(uuid.uuid4())}
    first = picker_client.post(url, json={"code": packing["barcode"]}, headers=headers)
    second = picker_client.post(url, json={"code": packing["barcode"]}, headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["pack_id"] == second.json()["pack_id"]
    assert _view(packing["supply_id"])["orders"][0]["packed_qty"] == 1


# ── Лента этикеток заранее ────────────────────────────────────────────────────

def test_wb_labels_are_pulled_for_the_whole_supply_at_once(fbs, monkeypatch):
    """Лента: задания уходят в поставку WB, стикеры приходят пачкой, повтор ничего
    не дозапрашивает — печать пачкой и наклейка по ходу работы."""
    calls: list[tuple] = []
    monkeypatch.setattr(mp_service.clients, "wb_create_supply", lambda c, name: "WB-GI-7")
    monkeypatch.setattr(mp_service.clients, "wb_add_orders_to_supply",
                        lambda c, s, ids: calls.append(("add", s, list(ids))))
    png = base64.b64encode(b"\x89PNG fake").decode()
    monkeypatch.setattr(
        mp_service.clients, "wb_order_stickers",
        lambda c, ids: [{"orderId": i, "barcode": f"2310001234{i}", "file": png} for i in ids],
    )
    supply_id = _to_picking(fbs, qty=1, orders=2)
    with get_connection() as conn:
        conn.execute("UPDATE mp_accounts SET marketplace = ? WHERE id = ?", (MP_WB, fbs["account_id"]))
        rows = conn.execute(
            "SELECT o.id FROM mp_supply_orders so JOIN mp_orders o ON o.id = so.order_id "
            "WHERE so.supply_id = ? ORDER BY o.external_id", (supply_id,),
        ).fetchall()
        for i, row in enumerate(rows):
            conn.execute(
                "UPDATE mp_orders SET external_id = ? WHERE id = ?", (str(770001 + i), str(row["id"])),
            )
        conn.commit()
    with get_connection() as conn:
        res = mp_service.fetch_supply_labels(conn, supply_id, "u")
        conn.commit()
    assert res == {"ok": True, "error": None, "fetched": 2, "labeled": 2, "total": 2}
    assert ("add", "WB-GI-7", ["770001", "770002"]) in calls
    with get_connection() as conn:
        labels = [
            str(r["label_url"]) for r in conn.execute(
                "SELECT o.label_url FROM mp_supply_orders so JOIN mp_orders o ON o.id = so.order_id "
                "WHERE so.supply_id = ? AND o.label_url IS NOT NULL", (supply_id,),
            ).fetchall()
        ]
        again = mp_service.fetch_supply_labels(conn, supply_id, "u")
        conn.commit()
    assert len(labels) == 2
    assert again["fetched"] == 0 and again["labeled"] == 2
    assert len([c for c in calls if c[0] == "add"]) == 1
    for url in labels:
        path = UPLOADS_DIR / url.rsplit("/", 1)[-1]
        if path.exists():
            path.unlink()


def test_labels_ahead_are_wb_only(packing):
    """Ozon отдаёт этикетку только после сборки отправления, а сборке предшествует КИЗ."""
    with get_connection() as conn:
        with pytest.raises(HTTPException) as exc:
            mp_service.fetch_supply_labels(conn, packing["supply_id"], "u")
    assert "Ozon" in str(exc.value.detail)
