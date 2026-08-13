"""Интеграционные тесты shipments state machine и проверки остатков."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, warehouse_client, warehouse_head_client, make_client_id, cleanup_client, seed_storage_good  # noqa: F401


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _make_shipment_payload(client_id: str, lines: list | None = None) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": "2026-05-27",
        "comment": "integration test",
        "lines": lines or [],
    }


def test_create_shipment_returns_doc_id(admin_client, client_id):
    payload = _make_shipment_payload(client_id)
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # POST /shipments возвращает {"message": "<doc_id>"}
    assert "message" in data
    doc_id = data["message"]
    # Проверяем созданный документ через GET
    r2 = admin_client.get(f"/shipments/{doc_id}")
    assert r2.status_code == 200, r2.text
    detail = r2.json()
    assert detail["status"] == "draft"
    assert detail["doc_number"].startswith("SHP-")


def test_create_shipment_rejects_out_of_range_ship_date(admin_client, client_id):
    payload = _make_shipment_payload(client_id)
    payload["ship_date"] = "1991-06-15"
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 400, r.text
    assert "вне допустимого диапазона" in r.json()["detail"]


def test_update_shipment_rejects_garbage_ship_date(admin_client, client_id):
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id)).json()["message"]
    r = admin_client.patch(f"/shipments/{doc_id}", json={"ship_date": "27.05.2026"})
    assert r.status_code == 400, r.text
    assert "ГГГГ-ММ-ДД" in r.json()["detail"]


def test_shipment_advance_draft_to_packing(admin_client, client_id):
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    assert r.status_code == 200
    doc_id = r.json()["message"]

    # Менеджер ставит задачу: draft → packing (сразу в план склада).
    r2 = admin_client.post(f"/shipments/{doc_id}/advance")
    assert r2.status_code == 200, r2.text
    assert r2.json()["message"] == "packing"


def test_shipment_advance_idempotent_replay(admin_client, client_id):
    """Повтор /advance с тем же X-Request-Id отдаёт прежний ответ и НЕ двигает статус.

    Регрессия на finish_idempotent: ответ должен коммититься вместе с операцией,
    иначе в non-pool пути повтор получает 409 «ещё обрабатывается» (см. idempotency.py).
    """
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    assert r.status_code == 200
    doc_id = r.json()["message"]
    rid = str(uuid.uuid4())
    try:
        first = admin_client.post(f"/shipments/{doc_id}/advance", headers={"X-Request-Id": rid})
        assert first.status_code == 200, first.text
        assert first.json()["message"] == "packing"

        replay = admin_client.post(f"/shipments/{doc_id}/advance", headers={"X-Request-Id": rid})
        assert replay.status_code == 200, replay.text
        assert replay.json()["message"] == "packing"  # прежний ответ, статус не двигается

        assert admin_client.get(f"/shipments/{doc_id}").json()["status"] == "packing"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM idempotency_keys WHERE request_id = ?", (rid,))
            conn.commit()


def test_shipment_advance_requires_technical_task(admin_client, client_id):
    payload = _make_shipment_payload(client_id)
    payload["comment"] = "  "
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    r2 = admin_client.post(f"/shipments/{doc_id}/advance")
    assert r2.status_code == 400, r2.text
    assert r2.json()["detail"] == "Заполните техническое задание"


def test_shipment_packing_requires_handoff_to_advance(admin_client, client_id):
    """packing → on_packing требует передачи на упаковку: без перемещения — 400."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]

    r2 = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert r2.status_code == 200 and r2.json()["message"] == "packing", r2.text
    r3 = admin_client.post(f"/shipments/{doc_id}/advance")  # packing → on_packing
    assert r3.status_code == 400, r3.text


def _fake_line() -> dict:
    return {
        "product_id": str(uuid.uuid4()),
        "product_name": "Fake Product",
        "product_sku": "FAKE-001",
        "color_id": str(uuid.uuid4()),
        "color_name": "Red",
        "size_id": None,
        "size_name": None,
        "qty": 999,
        "shipped_qty": 999,
    }


def test_shipment_cancel_allowed_in_packing(admin_client, client_id):
    """Аннулировать можно в черновике и «В плане» (до передачи на упаковку)."""
    line = _fake_line()
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=line["qty"],
    )
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert adv.status_code == 200 and adv.json()["message"] == "packing", adv.text

    r_cancel = admin_client.post(f"/shipments/{doc_id}/cancel")
    assert r_cancel.status_code == 200, r_cancel.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["status"] == "cancelled"


def test_shipment_plan_gate_blocks_when_in_transit(admin_client, client_id):
    """Перевод в план блокируется, если товара ещё нет на остатках (он в пути)."""
    line = _fake_line()
    line["qty"] = 10  # ничего не засеяли в storage → на складе 0
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    adv = admin_client.post(f"/shipments/{doc_id}/advance")
    assert adv.status_code == 400, adv.text
    assert "в пути" in adv.json()["detail"].lower()


def test_shipment_plan_gate_passes_when_stock_arrives(admin_client, client_id):
    """Как только товар появился на остатках — перевод в план проходит."""
    line = _fake_line()
    line["qty"] = 10
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    doc_id = r.json()["message"]
    assert admin_client.post(f"/shipments/{doc_id}/advance").status_code == 400

    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=10,
    )
    # Покрытие проверяется на постановке задачи (draft → packing).
    adv = admin_client.post(f"/shipments/{doc_id}/advance")
    assert adv.status_code == 200 and adv.json()["message"] == "packing", adv.text


def test_shipment_plan_gate_partial_stock_blocks(admin_client, client_id):
    """Частичного покрытия мало — нужен весь объём (всё-или-ничего)."""
    line = _fake_line()
    line["qty"] = 10
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=6,  # на складе только 6 из 10
    )
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/shipments/{doc_id}/advance")
    assert adv.status_code == 400, adv.text


def test_add_line_in_plan_blocks_uncovered_product(admin_client, client_id):
    """В статусе «В плане» нельзя дописать товар, которого ещё нет на складе."""
    line = _fake_line()
    line["qty"] = 5
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=5,
    )
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    doc_id = r.json()["message"]
    adv = admin_client.post(f"/shipments/{doc_id}/advance")  # draft → packing
    assert adv.status_code == 200 and adv.json()["message"] == "packing", adv.text

    # Вторая позиция без остатка — должна отклоняться.
    new_line = _fake_line()
    new_line["product_sku"] = "FAKE-002"
    new_line["qty"] = 3
    add = admin_client.post(f"/shipments/{doc_id}/lines", json=new_line)
    assert add.status_code == 400, add.text
    assert "в пути" in add.json()["detail"].lower()

    # Строка не должна была сохраниться (откат транзакции).
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert len(detail["lines"]) == 1


def test_add_line_in_plan_allows_covered_product(admin_client, client_id):
    """Добавить покрытую остатком позицию в «В плане» можно."""
    line = _fake_line()
    line["qty"] = 5
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=5,
    )
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    doc_id = r.json()["message"]
    assert admin_client.post(f"/shipments/{doc_id}/advance").json()["message"] == "packing"

    new_line = _fake_line()
    new_line["product_sku"] = "FAKE-002"
    new_line["qty"] = 4
    seed_storage_good(
        client_id, product_id=new_line["product_id"], product_name=new_line["product_name"],
        product_sku=new_line["product_sku"], color_id=new_line["color_id"], color_name=new_line["color_name"],
        qty=4,
    )
    add = admin_client.post(f"/shipments/{doc_id}/lines", json=new_line)
    assert add.status_code == 200, add.text
    assert len(admin_client.get(f"/shipments/{doc_id}").json()["lines"]) == 2


def test_update_line_qty_in_plan_blocks_when_over_stock(admin_client, client_id):
    """Поднять количество в «В плане» выше остатка нельзя."""
    line = _fake_line()
    line["qty"] = 5
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=5,
    )
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    doc_id = r.json()["message"]
    assert admin_client.post(f"/shipments/{doc_id}/advance").json()["message"] == "packing"

    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    upd = admin_client.patch(f"/shipments/{doc_id}/lines/{line_id}", json={**line, "qty": 9})
    assert upd.status_code == 400, upd.text
    # Количество не должно было измениться.
    assert admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["qty"] == 5


def test_put_task_requires_manager(admin_client, warehouse_client, warehouse_head_client, client_id):
    """Постановку задачи (draft → packing) делает менеджерский состав, не склад."""
    line = _fake_line()
    line["qty"] = 5
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=5,
    )
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line])).json()["message"]

    for staff in (warehouse_client, warehouse_head_client):
        blocked = staff.post(f"/shipments/{doc_id}/advance")
        assert blocked.status_code == 403, blocked.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["status"] == "draft"

    ok = admin_client.post(f"/shipments/{doc_id}/advance")
    assert ok.status_code == 200 and ok.json()["message"] == "packing", ok.text


def test_plannable_lists_stock_and_in_transit(admin_client, client_id):
    """Эндпоинт планирования отдаёт остаток на складе и товар в пути."""
    line = _fake_line()
    seed_storage_good(
        client_id, product_id=line["product_id"], product_name=line["product_name"],
        product_sku=line["product_sku"], color_id=line["color_id"], color_name=line["color_name"],
        qty=15,
    )
    r = admin_client.get(f"/balances/plannable?client_id={client_id}")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    match = next((i for i in items if i["product_id"] == line["product_id"]), None)
    assert match is not None
    assert match["storage_good"] == 15
    assert match["in_transit"] == 0


def test_shipment_list_returns_pagination(admin_client):
    r = admin_client.get("/shipments?page=1&limit=5")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert data["page"] == 1


def test_shipment_lines_view_returns_doc_line_rows(admin_client, client_id):
    """Разрез «По товарам»: одна строка = позиция документа с данными дока."""
    line = _fake_line()
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    doc_number = admin_client.get(f"/shipments/{doc_id}").json()["doc_number"]

    r2 = admin_client.get(f"/shipments/lines?sku={line['product_sku']}&limit=200")
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert "items" in data and "total" in data
    row = next(i for i in data["items"] if i["doc_id"] == doc_id)
    assert row["doc_number"] == doc_number
    assert row["product_sku"] == line["product_sku"]
    assert row["product_name"] == line["product_name"]
    assert row["qty"] == line["qty"]
    assert row["status"] == "draft"
    assert row["client_id"] == client_id


def test_shipment_priority_levels(admin_client, client_id):
    """Приоритет — уровни: 1 «Срочно», 2 «Повышенный»; значения вне диапазона — 422."""
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]

    r2 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 1})
    assert r2.status_code == 200, r2.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["priority_rank"] == 1

    r3 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 5})
    assert r3.status_code == 422, r3.text

    r4 = admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": None})
    assert r4.status_code == 200, r4.text
    assert admin_client.get(f"/shipments/{doc_id}").json()["priority_rank"] is None


def test_shipment_cancel_clears_priority(admin_client, client_id):
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id))
    doc_id = r.json()["message"]
    assert admin_client.patch(f"/shipments/{doc_id}/priority", json={"priority_rank": 2}).status_code == 200

    assert admin_client.post(f"/shipments/{doc_id}/cancel").status_code == 200
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["status"] == "cancelled"
    assert detail["priority_rank"] is None


def test_warehouse_shipment_costs_are_hidden_and_readonly(admin_client, warehouse_client, client_id):
    payload = _make_shipment_payload(client_id)
    payload["logistics_cost"] = 54321
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    detail = warehouse_client.get(f"/shipments/{doc_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["logistics_cost"] is None

    # client_id-фильтр: в dev-БД сотни документов, без него документ не попадает в страницу.
    listing = warehouse_client.get(f"/shipments?client_id={client_id}&limit=200")
    assert listing.status_code == 200, listing.text
    item = next(i for i in listing.json()["items"] if i["id"] == doc_id)
    assert item["logistics_cost"] is None

    forbidden = warehouse_client.patch(f"/shipments/{doc_id}", json={"logistics_cost": 777})
    assert forbidden.status_code == 403


def test_warehouse_cannot_edit_shipment_plan_or_composition(admin_client, warehouse_client, client_id):
    line = _fake_line()
    r = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line]))
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    detail = admin_client.get(f"/shipments/{doc_id}").json()
    line_id = detail["lines"][0]["id"]

    date_patch = warehouse_client.patch(f"/shipments/{doc_id}", json={"ship_date": "2026-07-01"})
    assert date_patch.status_code == 403

    line_patch = warehouse_client.patch(f"/shipments/{doc_id}/lines/{line_id}", json={**line, "qty": 1})
    assert line_patch.status_code == 403

    line_delete = warehouse_client.delete(f"/shipments/{doc_id}/lines/{line_id}")
    assert line_delete.status_code == 403


# ── Корректировка «На упаковке»: ТЗ, дата (план), магазины ────────────────────

def _set_doc_status(doc_id: str, status: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE shipment_docs SET status = ? WHERE id = ?", (status, doc_id))
        conn.commit()


def _seed_client_store(client_id: str, name: str) -> str:
    store_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO client_stores (id, client_id, name, is_active, is_deleted, created_at) "
            "VALUES (?, ?, ?, 1, 0, NOW())",
            (store_id, client_id, name),
        )
        conn.commit()
    return store_id


def test_on_packing_correction_allows_tz_and_plan_date(admin_client, client_id):
    """«На упаковке» менеджер корректирует ТЗ и дату (план); оба изменения — в журнале."""
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id)).json()["message"]
    _set_doc_status(doc_id, "on_packing")

    r = admin_client.patch(f"/shipments/{doc_id}", json={"comment": "Скорректированное ТЗ", "ship_date": "2026-06-01"})
    assert r.status_code == 200, r.text

    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["comment"] == "Скорректированное ТЗ"
    assert detail["ship_date"] == "2026-06-01"
    op_comments = [str(o["comment"] or "") for o in detail["ops"]]
    assert any("Дата упаковки (план): 27.05.2026 → 01.06.2026" in c for c in op_comments)
    assert any("Техническое задание обновлено" in c for c in op_comments)


def test_on_packing_correction_rejects_requisites(admin_client, client_id):
    """«На упаковке» реквизиты (кроме ТЗ и даты план) заблокированы."""
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id)).json()["message"]
    _set_doc_status(doc_id, "on_packing")

    r = admin_client.patch(f"/shipments/{doc_id}", json={"destination": "Kazan"})
    assert r.status_code == 400, r.text
    assert "На упаковке" in r.json()["detail"]


def test_on_packing_correction_forbidden_for_warehouse_head(admin_client, warehouse_head_client, client_id):
    """Корректировка «На упаковке» — только менеджерский состав (начальнику склада 403)."""
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id)).json()["message"]
    _set_doc_status(doc_id, "on_packing")

    r = warehouse_head_client.patch(f"/shipments/{doc_id}", json={"comment": "не положено"})
    assert r.status_code == 403, r.text


def test_ship_date_change_journaled_in_draft(admin_client, client_id):
    """Смена даты упаковки (план) журналируется и вне корректировки — в любом статусе."""
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id)).json()["message"]

    r = admin_client.patch(f"/shipments/{doc_id}", json={"ship_date": "2026-06-15"})
    assert r.status_code == 200, r.text
    ops = admin_client.get(f"/shipments/{doc_id}").json()["ops"]
    assert any("Дата упаковки (план): 27.05.2026 → 15.06.2026" in str(o["comment"] or "") for o in ops)


def test_line_store_correction_on_packing(admin_client, client_id):
    """«На упаковке» магазин строки правится узким эндпоинтом и журналируется."""
    store_id = _seed_client_store(client_id, "Магазин Б")
    line = _fake_line()
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line])).json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    _set_doc_status(doc_id, "on_packing")

    r = admin_client.patch(f"/shipments/{doc_id}/lines/{line_id}/store", json={"store_id": store_id})
    assert r.status_code == 200, r.text

    detail = admin_client.get(f"/shipments/{doc_id}").json()
    assert detail["lines"][0]["store_id"] == store_id
    assert detail["lines"][0]["store_name"] == "Магазин Б"
    assert any(
        "Магазин по «Fake Product» (Red): без магазина → Магазин Б" in str(o["comment"] or "")
        for o in detail["ops"]
    )


def test_line_store_correction_rejects_foreign_store(admin_client, client_id):
    """Магазин другого клиента не принимается."""
    other_cid = make_client_id()
    try:
        foreign_store = _seed_client_store(other_cid, "Чужой магазин")
        line = _fake_line()
        doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line])).json()["message"]
        line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]

        r = admin_client.patch(f"/shipments/{doc_id}/lines/{line_id}/store", json={"store_id": foreign_store})
        assert r.status_code == 400, r.text
        assert "не принадлежит клиенту" in r.json()["detail"]
    finally:
        cleanup_client(other_cid)


def test_line_store_correction_blocks_duplicates(admin_client, client_id):
    """Смена магазина не должна создавать дубль товар+зона+магазин."""
    store_a = _seed_client_store(client_id, "Магазин А")
    store_b = _seed_client_store(client_id, "Магазин Б")
    line = _fake_line()
    payload = _make_shipment_payload(client_id, [
        {**line, "store_id": store_a},
        {**line, "store_id": store_b},
    ])
    doc_id = admin_client.post("/shipments", json=payload).json()["message"]
    lines = admin_client.get(f"/shipments/{doc_id}").json()["lines"]
    line_b = next(l for l in lines if l["store_id"] == store_b)

    r = admin_client.patch(f"/shipments/{doc_id}/lines/{line_b['id']}/store", json={"store_id": store_a})
    assert r.status_code == 400, r.text
    assert "добавлен дважды" in r.json()["detail"]


def test_line_full_patch_blocked_on_packing(admin_client, client_id):
    """Общий line-PATCH (план/товар) «На упаковке» закрыт — только узкая смена магазина."""
    line = _fake_line()
    doc_id = admin_client.post("/shipments", json=_make_shipment_payload(client_id, [line])).json()["message"]
    line_id = admin_client.get(f"/shipments/{doc_id}").json()["lines"][0]["id"]
    _set_doc_status(doc_id, "on_packing")

    r = admin_client.patch(f"/shipments/{doc_id}/lines/{line_id}", json={**line, "qty": 5})
    assert r.status_code == 400, r.text


# --- Проверка на дубль (check-duplicate) ---

def _dup_product(client_id: str, *, sku: str) -> str:
    type_id = str(uuid.uuid4())
    product_id = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO product_types (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (type_id, f"Type-{type_id[:8]}"),
        )
        conn.execute(
            "INSERT INTO products (id, name, type_id, client_id, sku, is_active, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, NOW())",
            (product_id, f"Product-{product_id[:8]}", type_id, client_id, sku),
        )
        conn.commit()
    return product_id


def _dup_create(admin_client, client_id, product_id, sku, qty, *, ship_date="2026-07-01", cargo_type="good") -> str:
    payload = _make_shipment_payload(client_id, lines=[{
        "product_id": product_id, "product_name": "Product", "product_sku": sku, "qty": qty,
    }])
    payload["ship_date"] = ship_date
    payload["cargo_type"] = cargo_type
    r = admin_client.post("/shipments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _dup_check(admin_client, client_id, product_id, qty, *, ship_date="2026-07-01", cargo_type="good"):
    return admin_client.post("/shipments/check-duplicate", json={
        "cargo_type": cargo_type,
        "client_id": client_id,
        "ship_date": ship_date,
        "lines": [{"product_id": product_id, "color_id": None, "size_id": None, "qty": qty}],
    })


def test_duplicate_check_exact_match(admin_client, client_id):
    """Тот же клиент + плановая дата + состав → совпадение 100%."""
    pid = _dup_product(client_id, sku="SHP-DUP1")
    doc_id = _dup_create(admin_client, client_id, pid, "SHP-DUP1", 10)
    r = _dup_check(admin_client, client_id, pid, 10)
    assert r.status_code == 200, r.text
    matches = r.json()["matches"]
    assert len(matches) == 1
    assert matches[0]["id"] == doc_id
    assert matches[0]["lines"][0]["qty"] == 10


def test_duplicate_check_qty_differs(admin_client, client_id):
    """Другое количество — состав не совпадает, дубля нет."""
    pid = _dup_product(client_id, sku="SHP-DUP2")
    _dup_create(admin_client, client_id, pid, "SHP-DUP2", 10)
    assert _dup_check(admin_client, client_id, pid, 11).json()["matches"] == []


def test_duplicate_check_date_differs(admin_client, client_id):
    """Другая плановая дата — за тот день дубля нет."""
    pid = _dup_product(client_id, sku="SHP-DUP3")
    _dup_create(admin_client, client_id, pid, "SHP-DUP3", 10)
    assert _dup_check(admin_client, client_id, pid, 10, ship_date="2026-07-02").json()["matches"] == []


def test_duplicate_check_ignores_cancelled(admin_client, client_id):
    """Аннулированная задача упаковки не считается дублем."""
    pid = _dup_product(client_id, sku="SHP-DUP4")
    doc_id = _dup_create(admin_client, client_id, pid, "SHP-DUP4", 10)
    assert admin_client.post(f"/shipments/{doc_id}/cancel").status_code == 200
    assert _dup_check(admin_client, client_id, pid, 10).json()["matches"] == []


def test_duplicate_check_cargo_type_differs(admin_client, client_id):
    """Годная задача и брак с одинаковым составом — разные типы, не дубль."""
    pid = _dup_product(client_id, sku="SHP-DUP5")
    _dup_create(admin_client, client_id, pid, "SHP-DUP5", 10)
    assert _dup_check(admin_client, client_id, pid, 10, cargo_type="defect").json()["matches"] == []
