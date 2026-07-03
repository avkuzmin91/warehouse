"""E2E нового потока запасов: приёмка → on_review → подготовка к упаковке → QC good/defect.

Один TestClient с переключением роли (admin делает всё; роли проверяются отдельно).
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.balances.service import get_balances, get_balances_by_zone, get_packing_zone
from tests.conftest import make_client_id, cleanup_client


_TODAY = "2026-06-09"

_ADMIN = {"id": "t-admin", "email": "a@t.com", "role": "admin", "created_at": "2020-01-01T00:00:00", "client_id": None}
_SHIFT = {"id": "t-shift", "email": "s@t.com", "role": "shift_supervisor", "created_at": "2020-01-01T00:00:00", "client_id": None}
_WH = {"id": "t-wh", "email": "w@t.com", "role": "warehouse_manager", "created_at": "2020-01-01T00:00:00", "client_id": None}
_MANAGER = {"id": "t-mgr", "email": "m@t.com", "role": "manager", "created_at": "2020-01-01T00:00:00", "client_id": None}


@pytest.fixture
def api():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _as(row):
    app.dependency_overrides[get_current_user] = lambda: row


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    # Чистим созданные документы, чтобы не засорять dev-БД (cleanup_client удаляет только клиента).
    with get_connection() as conn:
        for r in conn.execute("SELECT id FROM receipt_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM receipt_ops WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM receipt_lines WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM receipt_docs WHERE client_id = ?", (cid,))
        for r in conn.execute("SELECT id FROM shipment_docs WHERE client_id = ?", (cid,)).fetchall():
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (r["id"],))
            conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (r["id"],))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (cid,))
        conn.execute("DELETE FROM zone_relocations WHERE client_id = ?", (cid,))
        conn.commit()
    cleanup_client(cid)


def _position():
    return {"product_id": str(uuid.uuid4()), "color_id": str(uuid.uuid4()), "size_id": None}


def _balance(client_id, pos):
    """(упакованный_годный, defect_всего, storage_good, packing_good) по позиции.

    Позиции кортежа соответствуют старым (good, defect, on_review, on_packing).
    Упакованный годный после упаковки лежит «Упаковано» (packed), а после «Готово к
    рейсу» переезжает в «Готов к отгрузке» (ready) — для теста это один и тот же
    «упакованный годный», поэтому суммируем оба бакета. Принятый — «На хранении /
    Годный», нерешённый пул — «На упаковке / Годный».
    """
    with get_connection() as c:
        bs = get_balances(c, page=1, limit=10000, client_id=client_id, search=None, only_positive=False, has_defect=False)
    for i in bs.items:
        if i.product_id == pos["product_id"] and i.color_id == pos["color_id"] and i.size_id == pos["size_id"]:
            defect = i.storage_defect + i.packing_defect + i.packed_defect + i.ready_defect
            return i.packed_good + i.ready_good, defect, i.storage_good, i.packing_good
    return 0, 0, 0, 0


# Старые однострочные статусы зон → корзины (op, quality) новой модели. Значение —
# список корзин (суммируется): «упакованный годный» живёт в packed до «Готово к рейсу»
# и в ready после, поэтому статус "good" покрывает оба; брак на упаковке — packed/defect.
_ZONE_STATUS_MAP = {
    "on_review":  [("storage", "good")],
    "on_packing": [("packing", "good")],
    "good":       [("packed", "good"), ("ready", "good")],
    "defect":     [("packed", "defect")],
    "storage_defect": [("storage", "defect")],
}


def _zone_qty(client_id, pos, zone_id, status):
    buckets = _ZONE_STATUS_MAP[status]
    with get_connection() as c:
        bz = get_balances_by_zone(c, client_id=client_id, search=None, only_positive=False)
    total = 0
    for i in bz.items:
        if (i.product_id == pos["product_id"] and i.color_id == pos["color_id"]
                and i.size_id == pos["size_id"] and i.location_id == zone_id
                and (i.op_status, i.quality) in buckets):
            total += i.qty
    return total


def _receive(api, client_id, pos, qty, intake_zone_id):
    """Создаёт поступление и принимает qty в intake_zone → on_review qty."""
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU-" + uuid.uuid4().hex[:6],
            "color_name": "Red", "size_name": None, "planned_qty": qty}
    doc_id = api.post("/receipts", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "supplier_name": "S", "arrival_date": "2026-05-27", "lines": [line],
    }).json()["message"]
    api.post(f"/receipts/{doc_id}/advance")  # draft → planned
    l = api.get(f"/receipts/{doc_id}").json()["lines"][0]
    lid = l["id"]
    # Карточная приёмка убрана (поступления принимаются в рейсе); для сида сразу
    # сажаем готовый остаток в storage и помечаем поступление done — как делал /arrive.
    from config import INV_OP_INTAKE, INV_OP_STORAGE, INV_Q_GOOD
    from dbconn import get_connection
    from modules.balances.service import insert_inventory_move
    with get_connection() as c:
        c.execute("UPDATE receipt_docs SET status='done' WHERE id=?", (doc_id,))
        c.execute("UPDATE receipt_lines SET accepted_qty=?, storage_zone_id=?, storage_zone_name=? WHERE id=?",
                  (qty, intake_zone_id, "Приёмка", lid))
        insert_inventory_move(
            c, product_id=l["product_id"], product_name=l["product_name"], product_sku=l["product_sku"],
            color_id=l["color_id"], color_name=l["color_name"], size_id=l["size_id"], size_name=l["size_name"],
            client_id=client_id, client_name="C", from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=intake_zone_id, from_zone_name="Приёмка", to_zone_id=intake_zone_id, to_zone_name="Приёмка",
            qty=qty, user_id=None, receipt_line_id=lid, comment="seed",
        )
        c.commit()
    return doc_id


def _packing_shipment(api, client_id, pos, qty):
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": qty}
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": "2026-05-27", "comment": "ТЗ", "lines": [line],
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → assigned
    api.post(f"/shipments/{doc_id}/advance")  # assigned → packing (приёмка нач. склада)
    line_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    return doc_id, line_id


def _advance(api, doc_id, role=_ADMIN):
    """Продвинуть статус отгрузки под заданной ролью."""
    _as(role)
    return api.post(f"/shipments/{doc_id}/advance")


def _finish_relocation(api, doc_id, lines, role=_WH):
    """«Готово к рейсу»: разложить упакованный годный/брак по местам под заданной ролью."""
    _as(role)
    return api.post(f"/shipments/{doc_id}/finish-relocation", json={"lines": lines})


def test_full_flow_receipt_to_packing_qc(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    _receive(api, client_id, pos, 100, intake_zone)
    assert _balance(client_id, pos) == (0, 0, 100, 0)
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 100

    doc_id, line_id = _packing_shipment(api, client_id, pos, 100)

    # До статуса «На упаковке» паковать нельзя.
    _as(_SHIFT)
    blocked = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    assert blocked.status_code == 400, blocked.text

    # Кладовщик перемещает 100 в зону упаковки (товар уходит из on_review в on_packing).
    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 100})
    assert mv.status_code == 200, mv.text
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 100
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 0
    assert _balance(client_id, pos) == (0, 0, 0, 100)  # on_review → on_packing

    # Кладовщик передаёт на упаковку → статус «На упаковке».
    adv = _advance(api, doc_id, _WH)
    assert adv.status_code == 200 and adv.json()["message"] == "on_packing", adv.text
    detail = api.get(f"/shipments/{doc_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["lines"][0]["available_for_pack"] == 100

    blocked_pack = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 1, "packed_date": _TODAY})
    assert blocked_pack.status_code == 403, blocked_pack.text
    blocked_advance = _advance(api, doc_id, _WH)
    assert blocked_advance.status_code == 403, blocked_advance.text

    # Начальник смены: 97 годных, 3 брак.
    _as(_SHIFT)
    g = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 97, "packed_date": _TODAY})
    assert g.status_code == 200, g.text
    d = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 3, "packed_date": _TODAY})
    assert d.status_code == 200, d.text
    assert d.json()["packed_good"] == 97 and d.json()["packed_defect"] == 3

    assert _balance(client_id, pos) == (97, 3, 0, 0)
    assert _zone_qty(client_id, pos, packing_id, "good") == 97
    assert _zone_qty(client_id, pos, packing_id, "defect") == 3
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 0
    detail_after_pack = api.get(f"/shipments/{doc_id}")
    assert detail_after_pack.status_code == 200, detail_after_pack.text
    assert detail_after_pack.json()["lines"][0]["available_for_pack"] == 0


def test_good_cannot_exceed_plan_defect_unbounded(api, client_id):
    """Годного — не больше плана; брак планом не ограничен (только пулом на столе)."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 12, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 12})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    # 11-й годный сверх плана — нельзя.
    over = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 1, "packed_date": _TODAY})
    assert over.status_code == 400, over.text
    # А брак сверх плана (good 10 + defect 2 = 12) — можно, пока есть пул на столе.
    d = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 2, "packed_date": _TODAY})
    assert d.status_code == 200, d.text
    assert d.json()["packed_good"] == 10 and d.json()["packed_defect"] == 2


def test_pack_limited_by_packing_pool(api, client_id):
    """Нельзя упаковать больше, чем физически подвезли в зону упаковки."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 6})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    over = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 7, "packed_date": _TODAY})
    assert over.status_code == 400, over.text  # на столе только 6


def test_replenish_during_packing_reaches_plan_good(api, client_id):
    """Ядро сценария: при браке кладовщик подвозит ещё, упаковщик добивает план годным."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 13, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)

    # Первичная передача 10 на упаковку.
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing

    # QC: 7 годных + 3 брак — план годным ещё не добран (нужно 10).
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 7, "packed_date": _TODAY})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 3, "packed_date": _TODAY})
    assert _balance(client_id, pos) == (7, 3, 3, 0)  # on_review 13−10=3, пул 0

    # Подвоз 3 на упаковку в статусе «На упаковке».
    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 3})
    assert mv.status_code == 200, mv.text
    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["available_for_pack"] == 3

    # Добиваем план годным: ещё 3 → итого 10 годных.
    _as(_SHIFT)
    g = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 3, "packed_date": _TODAY})
    assert g.status_code == 200 and g.json()["packed_good"] == 10, g.text
    assert _balance(client_id, pos) == (10, 3, 0, 0)


def test_cancel_on_packing_without_packed_returns_pool(api, client_id):
    """«На упаковке» без единой упакованной единицы: менеджер аннулирует, пул возвращается на места."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing

    _as(_MANAGER)
    r = api.post(f"/shipments/{doc_id}/cancel")
    assert r.status_code == 200, r.text
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "cancelled"
    assert _balance(client_id, pos) == (0, 0, 10, 0)  # пул вернулся на хранение
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 10


def test_cancel_on_packing_blocked_when_packed(api, client_id):
    """«На упаковке» с упакованным товаром (годным или браком) аннулировать нельзя."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 2, "packed_date": _TODAY})

    _as(_MANAGER)
    r = api.post(f"/shipments/{doc_id}/cancel")
    assert r.status_code == 400, r.text
    assert "упакованный товар" in r.json()["detail"]
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "on_packing"


def test_multizone_transfer_via_allocations(api, client_id):
    """Передача из нескольких мест: явная разбивка allocations по зонам."""
    pos = _position()
    zone_a = str(uuid.uuid4())
    zone_b = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 4, zone_a)
    _receive(api, client_id, pos, 6, zone_b)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)

    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={
        "allocations": [
            {"from_zone_id": zone_a, "qty": 4},
            {"from_zone_id": zone_b, "qty": 6},
        ],
    })
    assert mv.status_code == 200 and mv.json()["moved"] == 10, mv.text
    assert _zone_qty(client_id, pos, zone_a, "on_review") == 0
    assert _zone_qty(client_id, pos, zone_b, "on_review") == 0
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 10
    assert _balance(client_id, pos) == (0, 0, 0, 10)


def test_leftover_pool_returns_to_review_on_finish_relocation(api, client_id):
    """Нерешённый пул on_packing при «Готово к рейсу» возвращается в on_review."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 6, "packed_date": _TODAY})  # пул 4 не разобран
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating

    # «Дата упаковки (факт)» проставляется при передаче кладовщику на размещение (вход в relocating),
    # а не при завершении размещения.
    assert api.get(f"/shipments/{doc_id}").json()["actual_ship_date"], "факт должен ставиться на handover"

    fin = _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 6}], "defect": []},
    ])
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text

    # 6 годных переехали в место хранения (остаются в остатках), 4 из пула вернулись в on_review.
    assert _balance(client_id, pos) == (6, 0, 4, 0)
    assert _zone_qty(client_id, pos, good_zone, "good") == 6
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 4
    assert _zone_qty(client_id, pos, packing_id, "good") == 0


def test_return_from_packing_restores_source_zones(api, client_id):
    """Откат передачи «В плане»: пул возвращается в исходные места по журналу."""
    pos = _position()
    zone_a = str(uuid.uuid4())
    zone_b = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 4, zone_a)
    _receive(api, client_id, pos, 6, zone_b)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)

    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={
        "allocations": [{"from_zone_id": zone_a, "qty": 4}, {"from_zone_id": zone_b, "qty": 6}],
    })
    assert _balance(client_id, pos) == (0, 0, 0, 10)

    ret = api.post(f"/shipments/{doc_id}/lines/{line_id}/return-from-packing", json={})
    assert ret.status_code == 200 and ret.json()["returned"] == 10, ret.text
    # Источник восстановлен ровно по местам: 4 → A, 6 → B; в зоне упаковки пусто.
    assert _zone_qty(client_id, pos, zone_a, "on_review") == 4
    assert _zone_qty(client_id, pos, zone_b, "on_review") == 6
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 0


def test_manual_relocation_of_packing_pool_keeps_zone_integrity(api, client_id):
    """Пул «На упаковке» вручную переставили в ячейку-буфер: упаковка списывает пул
    из фактической ячейки, раскладка — упакованное; по местам не остаётся фантомов."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    buffer_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing

    # Стол упаковки занят — кладовщик вручную переставил пул в ячейку-буфер.
    r = api.post("/balances/relocations", json={
        **pos, "client_id": client_id, "op": "packing", "quality": "good",
        "from_zone_id": packing_id, "to_zone_id": buffer_zone, "qty": 10,
    })
    assert r.status_code == 200, r.text
    assert _zone_qty(client_id, pos, buffer_zone, "on_packing") == 10
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 0

    _as(_SHIFT)
    g = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    assert g.status_code == 200, g.text
    # Упаковка списала пул из фактической ячейки (буфера), а не из зоны упаковки.
    assert _zone_qty(client_id, pos, buffer_zone, "on_packing") == 0
    assert _zone_qty(client_id, pos, packing_id, "good") == 10  # упакованное — на столе упаковки

    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    fin = _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 10}], "defect": []},
    ])
    assert fin.status_code == 200, fin.text
    assert _zone_qty(client_id, pos, good_zone, "good") == 10
    # В буфере и зоне упаковки по позиции ничего не осталось — ни фантомов, ни минусов.
    with get_connection() as c:
        bz = get_balances_by_zone(c, client_id=client_id, search=None, only_positive=False)
    residues = [
        (i.location_id, i.op_status, i.quality, i.qty) for i in bz.items
        if i.product_id == pos["product_id"] and i.qty != 0
        and i.location_id in (packing_id, buffer_zone)
    ]
    assert residues == [], residues


def _ready_qty(client_id, pos, zone_id):
    """Готовый к отгрузке годный (ready/good) позиции в конкретном месте."""
    with get_connection() as c:
        bz = get_balances_by_zone(c, client_id=client_id, search=None, only_positive=False)
    return sum(
        i.qty for i in bz.items
        if i.product_id == pos["product_id"] and i.color_id == pos["color_id"]
        and i.size_id == pos["size_id"] and i.location_id == zone_id
        and i.op_status == "ready" and i.quality == "good"
    )


def test_partial_place_packed_keeps_on_packing_and_exposes_ready(api, client_id):
    """Частичное размещение упакованного: отгрузка из упаковки до её завершения.

    Большую задачу пакуют несколько дней; уже упакованное размещаем по местам
    (packed→ready) — становится доступно к отгрузке (dispatch читает ready), а статус
    остаётся «На упаковке». Финальное «Готово к рейсу» докладывает остаток.
    """
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())

    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 6, "packed_date": _TODAY})

    # Размещаем упакованные 6 годных по месту — статус остаётся «На упаковке».
    _as(_WH)
    r = api.post(f"/shipments/{doc_id}/place-packed", json={
        "lines": [{"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Готовое-1", "qty": 6}], "defect": []}],
    })
    assert r.status_code == 200 and r.json()["moved"] == 6, r.text
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "on_packing"
    # Размещённое доступно к отгрузке (ready), упаковочный пул не тронут.
    assert _ready_qty(client_id, pos, good_zone) == 6
    line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert line["packed_good"] == 6           # факт упаковки держится
    assert line["packed_pending_good"] == 0   # всё размещено
    assert line["available_for_pack"] == 4    # нерешённый пул на столе остался

    # Больше, чем упаковано-не-размещено (pending=0), разместить нельзя.
    bad = api.post(f"/shipments/{doc_id}/place-packed", json={
        "lines": [{"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "x", "qty": 1}], "defect": []}],
    })
    assert bad.status_code == 400, bad.text

    # Допаковываем остаток и финально размещаем — переходит в «Упаковано».
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 4, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    fin = _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Готовое-1", "qty": 4}], "defect": []},
    ])
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text
    assert _ready_qty(client_id, pos, good_zone) == 10


def test_return_in_on_packing_returns_only_undecided(api, client_id):
    """Откат «На упаковке» возвращает только нерешённый пул; упакованное не трогает."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 6, "packed_date": _TODAY})  # пул 4

    _as(_WH)
    ret = api.post(f"/shipments/{doc_id}/lines/{line_id}/return-from-packing", json={})
    assert ret.status_code == 200 and ret.json()["returned"] == 4, ret.text
    # 6 годных остались, 4 вернулись в исходное место на проверку, пул 0.
    assert _balance(client_id, pos) == (6, 0, 4, 0)
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 4


def test_return_from_packing_guards(api, client_id):
    """Возврат: роль warehouse обязательна; при пустом пуле — 400."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 5, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 5)

    # Пул пуст — нечего возвращать.
    _as(_WH)
    empty = api.post(f"/shipments/{doc_id}/lines/{line_id}/return-from-packing", json={})
    assert empty.status_code == 400, empty.text

    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 5})
    # Начальник смены не вправе возвращать.
    _as(_SHIFT)
    forbidden = api.post(f"/shipments/{doc_id}/lines/{line_id}/return-from-packing", json={})
    assert forbidden.status_code == 403, forbidden.text


def test_pack_correction_via_reverse(api, client_id):
    """Ошибочную запись упаковки отменяют через reverse; товар возвращается в on_packing."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 4, "packed_date": _TODAY})
    extra = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 2, "packed_date": _TODAY})
    assert extra.json()["packed_good"] == 6

    # Находим ошибочную запись на 2 годных и отменяем её.
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    bad = next(e for e in entries if e["good"] == 2 and not e["reversed"])
    corr = api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{bad['id']}/reverse")
    assert corr.status_code == 200, corr.text
    assert corr.json()["packed_good"] == 4
    # Коррекция вернула 2 в on_packing: good 4, on_packing 6.
    assert _balance(client_id, pos) == (4, 0, 0, 6)

    # Повторная отмена той же записи запрещена; запись помечена reversed.
    again = api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{bad['id']}/reverse")
    assert again.status_code == 400, again.text
    entries2 = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    assert any(e["id"] == bad["id"] and e["reversed"] for e in entries2)


def test_packing_records_date_and_history(api, client_id):
    """Дата упаковки сохраняется; записи за разные даты — отдельные строки истории."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    # День 1: 4 годных + 1 брак одной записью.
    r1 = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack",
                  json={"good_delta": 4, "defect_delta": 1, "packed_date": "2026-06-08"})
    assert r1.status_code == 200, r1.text
    assert r1.json()["packed_good"] == 4 and r1.json()["packed_defect"] == 1
    # День 2: ещё 5 годных.
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack",
             json={"good_delta": 5, "packed_date": "2026-06-09"})

    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    assert len(entries) == 2
    by_date = {e["packed_date"]: e for e in entries}
    assert by_date["2026-06-08"]["good"] == 4 and by_date["2026-06-08"]["defect"] == 1
    assert by_date["2026-06-09"]["good"] == 5 and by_date["2026-06-09"]["defect"] == 0
    assert _balance(client_id, pos) == (9, 1, 0, 0)


def test_pack_requires_valid_date_and_amount(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 5, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 5)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 5})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    bad_date = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 1, "packed_date": "не дата"})
    assert bad_date.status_code == 400, bad_date.text
    no_qty = api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"packed_date": _TODAY})
    assert no_qty.status_code == 400, no_qty.text


def _tasks(role: str):
    """Полный список задач роли (минуя API-лимит /tasks=20, чтобы не зависеть от объёма БД)."""
    from modules.tasks.service import list_my_tasks
    with get_connection() as c:
        return list_my_tasks(c, user={"role": role})


def test_packing_handoff_tasks(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)  # ship_date в прошлом

    # «В плане» + срок наступил: кладовщику — передать на упаковку; начальнику смены — ничего.
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_move_in" for x in _tasks("warehouse_manager"))
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in _tasks("shift_supervisor"))

    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing

    # «На упаковке»: начальнику смены — упаковать; у кладовщика передачи нет.
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in _tasks("shift_supervisor"))
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_move_in" for x in _tasks("warehouse_manager"))

    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating

    # «Перемещение»: кладовщику — разложить по местам; у начальника смены упаковки нет.
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_relocate" for x in _tasks("warehouse_manager"))
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in _tasks("shift_supervisor"))


def test_prev_working_day_skips_sunday():
    from datetime import date

    from modules.tasks.service import _prev_working_day

    # Понедельник → суббота (воскресенье — нерабочее, пропускается).
    assert _prev_working_day(date(2026, 6, 15)) == date(2026, 6, 13)
    # Вторник → понедельник.
    assert _prev_working_day(date(2026, 6, 16)) == date(2026, 6, 15)
    # Воскресенье → суббота.
    assert _prev_working_day(date(2026, 6, 14)) == date(2026, 6, 13)


def _packing_shipment_dated(api, client_id, pos, qty, ship_date):
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": qty}
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": ship_date, "comment": "ТЗ", "lines": [line],
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → assigned
    api.post(f"/shipments/{doc_id}/advance")  # assigned → packing
    return doc_id


def test_packing_handoff_appears_one_working_day_before(api, client_id):
    from datetime import date, timedelta

    from modules.tasks.service import _prev_working_day

    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)

    today = date.today()

    # Срок ещё далеко: за 1 рабочий день до отгрузки задача не наступила.
    far = today + timedelta(days=14)
    assert _prev_working_day(far) > today
    far_doc = _packing_shipment_dated(api, client_id, pos, 4, far.isoformat())
    assert not any(x["doc_id"] == far_doc and x["kind"] == "shipment_move_in" for x in _tasks("warehouse_manager"))

    # Ближайший рабочий день после сегодня: до него ровно 1 рабочий день → задача видна.
    soon = today + timedelta(days=1)
    while soon.weekday() == 6:  # пропускаем воскресенье
        soon += timedelta(days=1)
    assert _prev_working_day(soon) <= today
    soon_doc = _packing_shipment_dated(api, client_id, pos, 3, soon.isoformat())
    assert any(x["doc_id"] == soon_doc and x["kind"] == "shipment_move_in" for x in _tasks("warehouse_manager"))


def test_relocate_good_after_packing(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    assert _balance(client_id, pos) == (10, 0, 0, 0)

    # Передать кладовщику, затем «Готово к рейсу»: товар переезжает в место хранения, без списания.
    adv1 = _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    assert adv1.status_code == 200 and adv1.json()["message"] == "relocating", adv1.text
    fin = _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 10}], "defect": []},
    ])
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text

    # Не списано: 10 годных остаются в остатках, но уже в выбранном месте, не в зоне упаковки.
    assert _balance(client_id, pos) == (10, 0, 0, 0)
    assert _zone_qty(client_id, pos, good_zone, "good") == 10
    assert _zone_qty(client_id, pos, packing_id, "good") == 0

    # Раскладка good→good не должна задваивать упакованное в карточке, а места — видны для просмотра.
    det_line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert det_line["packed_good"] == 10 and det_line["packed_defect"] == 0
    assert det_line["placements"] == [
        {"kind": "good", "zone_id": good_zone, "zone_name": "Годный-1", "qty": 10},
    ]


def test_relocate_partial_lines_skips_unpacked_line(api, client_id):
    pos1 = _position()
    pos2 = _position()
    zone1 = str(uuid.uuid4())
    zone2 = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())

    _receive(api, client_id, pos1, 5, zone1)
    _receive(api, client_id, pos2, 7, zone2)

    _as(_ADMIN)
    lines = [
        {**pos1, "product_name": "P1", "product_sku": "SKU-1", "color_name": "Red", "size_name": None, "qty": 5},
        {**pos2, "product_name": "P2", "product_sku": "SKU-2", "color_name": "Blue", "size_name": None, "qty": 7},
    ]
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": "2026-05-27", "comment": "ТЗ", "lines": lines,
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → assigned
    api.post(f"/shipments/{doc_id}/advance")  # assigned → packing
    line1_id = next(
        l["id"] for l in api.get(f"/shipments/{doc_id}").json()["lines"]
        if l["product_sku"] == "SKU-1"
    )

    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line1_id}/move-to-packing", json={"qty": 5, "from_zone_id": zone1})
    assert mv.status_code == 200, mv.text
    adv0 = _advance(api, doc_id, _WH)  # packing → on_packing
    assert adv0.status_code == 200 and adv0.json()["message"] == "on_packing", adv0.text

    _as(_SHIFT)
    pack = api.post(f"/shipments/{doc_id}/lines/{line1_id}/pack", json={"good_delta": 5, "packed_date": _TODAY})
    assert pack.status_code == 200, pack.text
    adv1 = _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    assert adv1.status_code == 200 and adv1.json()["message"] == "relocating", adv1.text

    # Линия 2 ничего не упаковала — её можно не указывать в раскладке.
    fin = _finish_relocation(api, doc_id, [
        {"line_id": line1_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 5}], "defect": []},
    ])
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text
    assert _zone_qty(client_id, pos1, good_zone, "good") == 5
    assert _balance(client_id, pos1) == (5, 0, 0, 0)
    assert _balance(client_id, pos2) == (0, 0, 7, 0)


def test_move_to_packing_from_partially_received_receipt(api, client_id):
    """Передача на упаковку работает, когда товар приехал поступлением в статусе
    partially_received (часть заказа ещё ждём): остаток уже на хранении, источник
    зон не должен ограничиваться только done-поступлениями (баг «доступно 0»)."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    doc_id_rcpt = _receive(api, client_id, pos, 20, intake_zone)
    # Поступление приехало не целиком — рейс довёз часть, документ висит частично принятым.
    with get_connection() as c:
        c.execute("UPDATE receipt_docs SET status = 'partially_received' WHERE id = ?", (doc_id_rcpt,))
        c.commit()
    # Остаток на хранении виден несмотря на частичный приём (якорь включает partially_received).
    assert _balance(client_id, pos) == (0, 0, 20, 0)

    doc_id, line_id = _packing_shipment(api, client_id, pos, 20)
    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 20})
    assert mv.status_code == 200, mv.text
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 20
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 0
    assert _balance(client_id, pos) == (0, 0, 0, 20)


def test_move_to_packing_from_process_zone_crossdock(api, client_id):
    """Cross-dock: товар сразу отнесли в зону упаковки (storage/good в процессной зоне).

    Передача на упаковку должна брать товар по фактическому остатку, а не по местам
    приёмки — иначе «доступно 0», хотя товар физически лежит в зоне упаковки.
    """
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, packing_name = get_packing_zone(c)

    _receive(api, client_id, pos, 30, intake_zone)
    # Кладовщик переносит весь товар сразу в зону упаковки (остаётся storage/good).
    _as(_ADMIN)
    rel = api.post("/balances/relocations", json={
        "product_id": pos["product_id"], "color_id": pos["color_id"], "size_id": pos["size_id"],
        "client_id": client_id, "quality": "good",
        "from_zone_id": intake_zone, "to_zone_id": packing_id, "qty": 30,
    })
    assert rel.status_code == 200, rel.text
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 30  # storage/good в зоне упаковки
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 0

    doc_id, line_id = _packing_shipment(api, client_id, pos, 30)
    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing",
                  json={"qty": 30, "from_zone_id": packing_id})
    assert mv.status_code == 200, mv.text
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 30
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 0
    assert _balance(client_id, pos) == (0, 0, 0, 30)


def test_move_to_packing_requires_warehouse_role(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 5, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 5)
    _as(_SHIFT)  # начальник смены не вправе перемещать
    r = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 5})
    assert r.status_code == 403, r.text


def test_packing_productivity_report(api, client_id):
    """Отчёт производительности: нетто по дням (клиент × SKU), отмены вычитаются."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 40, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 30)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 35})
    _advance(api, doc_id, _WH)  # packing → on_packing

    d1, d2 = "2026-06-08", "2026-06-09"
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": d1})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 5, "defect_delta": 3, "packed_date": d2})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 7, "packed_date": d2})

    # Начальник смены видит отчёт; дни по убыванию, день агрегирует записи.
    r = api.get("/shipments/packing/productivity", params={"client_id": client_id, "date_from": d1, "date_to": d2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [d["packed_date"] for d in body["days"]] == [d2, d1]
    day2 = body["days"][0]
    assert (day2["good"], day2["defect"], day2["total"]) == (12, 3, 15)
    assert day2["sku_count"] == 1 and day2["doc_count"] == 1
    row = day2["rows"][0]
    assert row["product_id"] == pos["product_id"]
    assert (row["good"], row["defect"], row["total"]) == (12, 3, 15)
    assert row["client_id"] == client_id and row["client_name"]  # имя — из справочника клиентов
    assert (body["total_good"], body["total_defect"], body["total"]) == (22, 3, 25)

    # Фильтр периода отсекает день 1.
    only_d2 = api.get("/shipments/packing/productivity", params={"client_id": client_id, "date_from": d2, "date_to": d2}).json()
    assert [d["packed_date"] for d in only_d2["days"]] == [d2] and only_d2["total"] == 15

    # Отмена единственной записи дня 1 → нетто 0, день исчезает из отчёта.
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    e1 = next(e for e in entries if e["packed_date"] == d1)
    rev = api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{e1['id']}/reverse")
    assert rev.status_code == 200, rev.text
    after = api.get("/shipments/packing/productivity", params={"client_id": client_id, "date_from": d1, "date_to": d2}).json()
    assert [d["packed_date"] for d in after["days"]] == [d2]
    assert (after["total_good"], after["total_defect"], after["total"]) == (12, 3, 15)


def test_move_packing_date_admin(api, client_id):
    """Менеджер/админ переносит дату упаковки из отчёта: запись (и её сторно) едут на другой день."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 40, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 30)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 30})
    _advance(api, doc_id, _WH)  # packing → on_packing

    d_wrong, d_right = "2026-06-08", "2026-06-15"
    _as(_SHIFT)
    # Запись A (10 годных) и B (5 годных) — обе ошибочно на d_wrong.
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": d_wrong})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 5, "packed_date": d_wrong})
    # Отменяем A — её нетто 0, но сторно наследует d_wrong.
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    a = next(e for e in entries if e["good"] == 10 and not e["reversed"])
    api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{a['id']}/reverse")

    # Отчёт за d_wrong: только B (нетто 5).
    rep = api.get("/shipments/packing/productivity",
                  params={"client_id": client_id, "date_from": d_wrong, "date_to": d_right}).json()
    assert [d["packed_date"] for d in rep["days"]] == [d_wrong]
    assert rep["total_good"] == 5 and rep["total_defect"] == 0

    # Начальник смены не вправе смотреть записи строки отчёта и переносить дату.
    _as(_SHIFT)
    assert api.get("/shipments/packing/productivity/entries",
                   params={"packed_date": d_wrong, "product_id": pos["product_id"], "client_id": client_id}
                   ).status_code == 403
    assert api.post("/shipments/packing/productivity/move-date",
                    json={"entry_ids": ["x"], "new_date": d_right}).status_code == 403

    # Менеджер (не только админ) видит обе записи строки (A помечена отменённой).
    _as(_MANAGER)
    ents = api.get("/shipments/packing/productivity/entries",
                   params={"packed_date": d_wrong, "product_id": pos["product_id"], "client_id": client_id}).json()["entries"]
    ids = [e["id"] for e in ents]
    assert len(ids) == 2
    assert any(e["reversed"] for e in ents) and ents[0]["doc_number"]

    # Перенос на ту же дату — ничего не двигает.
    same = api.post("/shipments/packing/productivity/move-date",
                    json={"entry_ids": ids, "new_date": d_wrong})
    assert same.status_code == 200 and same.json()["moved"] == 0, same.text

    # Менеджер переносит обе записи на правильный день: сторно A уезжает вместе с
    # оригиналом, иначе на d_wrong остался бы орфан-минус.
    mv = api.post("/shipments/packing/productivity/move-date",
                  json={"entry_ids": ids, "new_date": d_right})
    assert mv.status_code == 200 and mv.json()["moved"] == 2, mv.text

    after = api.get("/shipments/packing/productivity",
                    params={"client_id": client_id, "date_from": d_wrong, "date_to": d_right}).json()
    assert [d["packed_date"] for d in after["days"]] == [d_right]
    assert after["total_good"] == 5 and after["total_defect"] == 0

    # Аудит переноса записан в журнал отгрузки.
    ops = api.get(f"/shipments/{doc_id}").json()["ops"]
    assert any(o["op_type"] == "pack_date_move" for o in ops), ops


def test_cancel_in_plan_returns_packing_pool_to_storage(api, client_id):
    """Аннулирование годной отгрузки «В плане» возвращает переданное на упаковку на исходные места."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 20, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)

    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    assert mv.status_code == 200, mv.text
    assert _balance(client_id, pos) == (0, 0, 10, 10)  # 10 на хранении, 10 на упаковке

    _as(_ADMIN)
    cancel = api.post(f"/shipments/{doc_id}/cancel")
    assert cancel.status_code == 200, cancel.text

    # Пул с упаковки вернулся в исходную зону, на упаковке пусто.
    assert _balance(client_id, pos) == (0, 0, 20, 0)
    assert _zone_qty(client_id, pos, intake_zone, "on_review") == 20


def test_return_to_packing_from_relocating_is_pure_status_flip(api, client_id):
    """Возврат «на упаковку» из «Перемещение» — остатки не двигались, только статус."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 7, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    before = _balance(client_id, pos)

    _as(_ADMIN)
    ret = api.post(f"/shipments/{doc_id}/return-to-packing")
    assert ret.status_code == 200 and ret.json()["message"] == "on_packing", ret.text

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "on_packing"
    assert detail["actual_ship_date"] in (None, "")  # факт сброшен — проставится при следующей передаче
    assert _balance(client_id, pos) == before  # остатки не тронуты
    # Упакованное и пул на месте: можно продолжить упаковку.
    assert detail["lines"][0]["packed_good"] == 7
    assert detail["lines"][0]["available_for_pack"] == 3


def test_return_to_packing_from_packed_restores_table(api, client_id):
    """Возврат «на упаковку» из «Упаковано» откатывает раскладку: годный/брак/пул назад в зону упаковки."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    defect_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 100, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 100)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 100})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 60, "packed_date": _TODAY})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 3, "packed_date": _TODAY})  # пул 37
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    fin = _finish_relocation(api, doc_id, [
        {"line_id": line_id,
         "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 60}],
         "defect": [{"zone_id": defect_zone, "zone_name": "Брак-1", "qty": 3}]},
    ])
    assert fin.status_code == 200 and fin.json()["message"] == "packed", fin.text
    # После раскладки: годный — ready по месту, брак — storage_defect по месту, пул вернулся в on_review.
    assert _zone_qty(client_id, pos, good_zone, "good") == 60
    assert _zone_qty(client_id, pos, defect_zone, "storage_defect") == 3

    _as(_ADMIN)
    ret = api.post(f"/shipments/{doc_id}/return-to-packing")
    assert ret.status_code == 200 and ret.json()["message"] == "on_packing", ret.text

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "on_packing"
    # Раскладка откатана: всё снова в зоне упаковки в своих корзинах.
    assert _zone_qty(client_id, pos, good_zone, "good") == 0
    assert _zone_qty(client_id, pos, defect_zone, "storage_defect") == 0
    assert _zone_qty(client_id, pos, packing_id, "good") == 60        # packed/good@зона упаковки
    assert _zone_qty(client_id, pos, packing_id, "defect") == 3       # packed/defect@зона упаковки
    assert _zone_qty(client_id, pos, packing_id, "on_packing") == 37  # нерешённый пул восстановлен
    # Факт упаковки сохранён, на столе снова есть нерешённый пул.
    assert detail["lines"][0]["packed_good"] == 60
    assert detail["lines"][0]["packed_defect"] == 3
    assert detail["lines"][0]["available_for_pack"] == 37


def test_placements_are_net_after_return_and_repack(api, client_id):
    """Раскладка по местам показывает ЧИСТЫЙ остаток: цикл возврат→переупаковка→раскладка не двоит."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    defect_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 5, "packed_date": _TODAY})
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"defect_delta": 5, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    _finish_relocation(api, doc_id, [
        {"line_id": line_id,
         "good": [{"zone_id": good_zone, "zone_name": "A-01-01", "qty": 5}],
         "defect": [{"zone_id": defect_zone, "zone_name": "B-01-01", "qty": 5}]},
    ])  # → packed (5 годных @ A, 5 брак @ B)

    # Менеджер вернул на упаковку, упаковщик переупаковал все 10 как годные, снова разложил.
    _as(_ADMIN)
    assert api.post(f"/shipments/{doc_id}/return-to-packing").status_code == 200
    _as(_SHIFT)
    entries = api.get(f"/shipments/{doc_id}/lines/{line_id}/packing").json()["entries"]
    for e in entries:
        api.post(f"/shipments/{doc_id}/lines/{line_id}/packing/{e['id']}/reverse")
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "A-01-01", "qty": 10}], "defect": []},
    ])  # → packed снова

    detail = api.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "packed"
    placements = detail["lines"][0]["placements"]
    # Ровно одна раскладка: 10 годных @ A-01-01; фантомов в зоне упаковки и брака нет.
    assert placements == [{"kind": "good", "zone_id": good_zone, "zone_name": "A-01-01", "qty": 10}], placements


def test_return_to_packing_blocked_when_already_shipped(api, client_id):
    """Если упакованный товар уже отгружён/закреплён рейсом — откат раскладки запрещён (409)."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    good_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 10, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    _finish_relocation(api, doc_id, [
        {"line_id": line_id, "good": [{"zone_id": good_zone, "zone_name": "Годный-1", "qty": 10}], "defect": []},
    ])
    # Эмулируем отгрузку: списываем готовый остаток из места (ready → shipped).
    from config import INV_OP_READY, INV_OP_SHIPPED, INV_Q_GOOD
    from modules.balances.service import insert_inventory_move
    with get_connection() as c:
        insert_inventory_move(
            c, product_id=pos["product_id"], product_name="P", product_sku="SKU",
            color_id=pos["color_id"], color_name="Red", size_id=pos["size_id"], size_name=None,
            client_id=client_id, client_name="C", from_op=INV_OP_READY, to_op=INV_OP_SHIPPED,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=good_zone, from_zone_name="Годный-1", to_zone_id=None, to_zone_name=None,
            qty=10, user_id=None, comment="seed-ship",
        )
        c.commit()

    _as(_ADMIN)
    ret = api.post(f"/shipments/{doc_id}/return-to-packing")
    assert ret.status_code == 409, ret.text
    # Статус не изменился — остался «Упаковано».
    assert api.get(f"/shipments/{doc_id}").json()["status"] == "packed"


def test_return_to_packing_rejected_for_defect_cargo(api, client_id):
    """Брак-отгрузка минует упаковку — вернуть «на упаковку» нельзя."""
    pos = _position()
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": 5}
    _as(_ADMIN)
    doc_id = api.post("/shipments", json={
        "cargo_type": "defect", "client_id": client_id, "client_name": "C",
        "ship_date": "2026-05-27", "comment": "ТЗ", "lines": [line],
    }).json()["message"]
    ret = api.post(f"/shipments/{doc_id}/return-to-packing")
    assert ret.status_code == 400, ret.text


def test_return_to_packing_requires_manager_staff(api, client_id):
    """Возврат «на упаковку» — менеджерский состав; начальник смены не вправе."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 5, "packed_date": _TODAY})
    _advance(api, doc_id, _SHIFT)  # on_packing → relocating
    blocked = api.post(f"/shipments/{doc_id}/return-to-packing")  # ещё _SHIFT
    assert blocked.status_code == 403, blocked.text
