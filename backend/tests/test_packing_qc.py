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
    """(good, defect, on_review, on_packing) по позиции из расчёта остатков."""
    with get_connection() as c:
        bs = get_balances(c, page=1, limit=10000, client_id=client_id, search=None, only_positive=False, has_defect=False)
    for i in bs.items:
        if i.product_id == pos["product_id"] and i.color_id == pos["color_id"] and i.size_id == pos["size_id"]:
            return i.good, i.defect, i.on_review, i.on_packing
    return 0, 0, 0, 0


def _zone_qty(client_id, pos, zone_id, status):
    with get_connection() as c:
        bz = get_balances_by_zone(c, client_id=client_id, search=None, only_positive=False)
    for i in bz.items:
        if (i.product_id == pos["product_id"] and i.color_id == pos["color_id"]
                and i.size_id == pos["size_id"] and i.location_id == zone_id and i.status == status):
            return i.qty
    return 0


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
    api.patch(f"/receipts/{doc_id}/actual-arrival", json={"actual_arrival_date": "2026-05-27"})
    lid = api.get(f"/receipts/{doc_id}").json()["lines"][0]["id"]
    api.patch(f"/receipts/{doc_id}/lines/{lid}", json={"storage_zone_id": intake_zone_id, "storage_zone_name": "Приёмка"})
    api.post(f"/receipts/{doc_id}/intake")  # planned → on_intake
    r = api.post(f"/receipts/{doc_id}/arrive", json={"lines": [{"line_id": lid, "accepted_qty": qty}]})
    assert r.status_code == 200 and r.json()["message"] == "done", r.text
    return doc_id


def _packing_shipment(api, client_id, pos, qty):
    _as(_ADMIN)
    line = {**pos, "product_name": "P", "product_sku": "SKU", "color_name": "Red", "size_name": None, "qty": qty}
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": "2000-01-01", "comment": "ТЗ", "lines": [line],
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → packing
    line_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    return doc_id, line_id


def _advance(api, doc_id, role=_ADMIN):
    """Продвинуть статус отгрузки под заданной ролью."""
    _as(role)
    return api.post(f"/shipments/{doc_id}/advance")


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


def test_leftover_pool_returns_to_review_on_ship(api, client_id):
    """Нерешённый пул on_packing при отгрузке возвращается в on_review."""
    pos = _position()
    intake_zone = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)
    _receive(api, client_id, pos, 10, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 10)
    _as(_WH)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 10})
    _advance(api, doc_id, _WH)  # packing → on_packing
    _as(_SHIFT)
    api.post(f"/shipments/{doc_id}/lines/{line_id}/pack", json={"good_delta": 6, "packed_date": _TODAY})  # пул 4 не разобран
    _advance(api, doc_id, _SHIFT)  # on_packing → on_shipping
    _advance(api, doc_id, _WH)     # on_shipping → shipped

    ship_line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert ship_line["shipped_qty"] == 6
    # Отгружено 6 годных; 4 из пула вернулись в on_review (в зоне упаковки).
    assert _balance(client_id, pos) == (0, 0, 4, 0)
    assert _zone_qty(client_id, pos, packing_id, "on_review") == 4


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
    _advance(api, doc_id, _SHIFT)  # on_packing → on_shipping

    # «На отгрузке»: кладовщику — отгрузить; у начальника смены упаковки нет.
    assert any(x["doc_id"] == doc_id and x["kind"] == "shipment_ship" for x in _tasks("warehouse_manager"))
    assert not any(x["doc_id"] == doc_id and x["kind"] == "shipment_pack" for x in _tasks("shift_supervisor"))


def test_ship_good_after_packing(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
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

    # Передача на отгрузку, затем «Отгрузить»: shipped_qty = упакованный годный, место = зона упаковки.
    adv1 = _advance(api, doc_id, _SHIFT)  # on_packing → on_shipping
    assert adv1.status_code == 200 and adv1.json()["message"] == "on_shipping", adv1.text
    adv2 = _advance(api, doc_id, _WH)  # on_shipping → shipped
    assert adv2.status_code == 200 and adv2.json()["message"] == "shipped", adv2.text

    ship_line = api.get(f"/shipments/{doc_id}").json()["lines"][0]
    assert ship_line["shipped_qty"] == 10
    assert ship_line["storage_zone_id"] == packing_id
    assert _balance(client_id, pos) == (0, 0, 0, 0)


def test_ship_partial_lines_does_not_require_zero_shipped_line(api, client_id):
    pos1 = _position()
    pos2 = _position()
    zone1 = str(uuid.uuid4())
    zone2 = str(uuid.uuid4())
    with get_connection() as c:
        packing_id, _ = get_packing_zone(c)

    _receive(api, client_id, pos1, 5, zone1)
    _receive(api, client_id, pos2, 7, zone2)

    _as(_ADMIN)
    lines = [
        {**pos1, "product_name": "P1", "product_sku": "SKU-1", "color_name": "Red", "size_name": None, "qty": 5},
        {**pos2, "product_name": "P2", "product_sku": "SKU-2", "color_name": "Blue", "size_name": None, "qty": 7},
    ]
    doc_id = api.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "C",
        "ship_date": "2000-01-01", "comment": "ТЗ", "lines": lines,
    }).json()["message"]
    api.post(f"/shipments/{doc_id}/advance")  # draft → packing
    line1_id = api.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]

    _as(_WH)
    mv = api.post(f"/shipments/{doc_id}/lines/{line1_id}/move-to-packing", json={"qty": 5, "from_zone_id": zone1})
    assert mv.status_code == 200, mv.text
    adv0 = _advance(api, doc_id, _WH)  # packing → on_packing
    assert adv0.status_code == 200 and adv0.json()["message"] == "on_packing", adv0.text

    _as(_SHIFT)
    pack = api.post(f"/shipments/{doc_id}/lines/{line1_id}/pack", json={"good_delta": 5, "packed_date": _TODAY})
    assert pack.status_code == 200, pack.text
    adv1 = _advance(api, doc_id, _SHIFT)  # on_packing → on_shipping
    assert adv1.status_code == 200 and adv1.json()["message"] == "on_shipping", adv1.text

    adv2 = _advance(api, doc_id, _WH)  # on_shipping → shipped
    assert adv2.status_code == 200 and adv2.json()["message"] == "shipped", adv2.text
    detail = api.get(f"/shipments/{doc_id}").json()
    shipped = {line["product_sku"]: line for line in detail["lines"]}
    assert shipped["SKU-1"]["shipped_qty"] == 5
    assert shipped["SKU-1"]["storage_zone_id"] == packing_id
    assert shipped["SKU-2"]["shipped_qty"] == 0
    assert _balance(client_id, pos1) == (0, 0, 0, 0)
    assert _balance(client_id, pos2) == (0, 0, 7, 0)


def test_move_to_packing_requires_warehouse_role(api, client_id):
    pos = _position()
    intake_zone = str(uuid.uuid4())
    _receive(api, client_id, pos, 5, intake_zone)
    doc_id, line_id = _packing_shipment(api, client_id, pos, 5)
    _as(_SHIFT)  # начальник смены не вправе перемещать
    r = api.post(f"/shipments/{doc_id}/lines/{line_id}/move-to-packing", json={"qty": 5})
    assert r.status_code == 403, r.text
