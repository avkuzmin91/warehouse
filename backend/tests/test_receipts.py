"""Интеграционные тесты receipts state machine.

Требует DATABASE_URL. Запускать только когда БД доступна.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import admin_client, manager_client, warehouse_client, make_client_id, cleanup_client  # noqa: F401


def _make_receipt_payload(client_id: str) -> dict:
    return {
        "cargo_type": "good",
        "client_id": client_id,
        "client_name": "Test Client",
        "supplier_name": "Test Supplier",
        "arrival_date": "2026-05-27",
        "comment": "integration test",
        "lines": [],
    }


def _make_receipt_line(planned_qty: int = 3) -> dict:
    return {
        "product_id": str(uuid.uuid4()),
        "product_name": "Test Product",
        "product_sku": f"SKU-{uuid.uuid4().hex[:8]}",
        "color_id": str(uuid.uuid4()),
        "color_name": "Red",
        "size_id": None,
        "size_name": None,
        "planned_qty": planned_qty,
    }


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _to_intake(admin_client, doc_id: str):
    """draft → planned → on_intake, проставив зону хранения по каждой строке."""
    admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    actual = admin_client.patch(
        f"/receipts/{doc_id}/actual-arrival",
        json={"actual_arrival_date": "2026-05-27"},
    )
    assert actual.status_code == 200, actual.text
    detail = admin_client.get(f"/receipts/{doc_id}").json()
    for l in detail["lines"]:
        admin_client.patch(
            f"/receipts/{doc_id}/lines/{l['id']}",
            json={"storage_zone_id": str(uuid.uuid4()), "storage_zone_name": "Зона П"},
        )
    return admin_client.post(f"/receipts/{doc_id}/intake")  # planned → on_intake


def _arrive(admin_client, doc_id: str):
    """Принять товары: on_intake → on_review, «Принят» по каждой строке = planned_qty."""
    intake = _to_intake(admin_client, doc_id)
    assert intake.status_code == 200, intake.text
    lines = admin_client.get(f"/receipts/{doc_id}").json()["lines"]
    payload = {"lines": [{"line_id": l["id"], "accepted_qty": l["planned_qty"]} for l in lines]}
    return admin_client.post(f"/receipts/{doc_id}/arrive", json=payload)


def test_create_receipt_returns_doc_id(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # POST /receipts возвращает {"message": "<doc_id>"}
    assert "message" in data
    doc_id = data["message"]
    # Проверяем созданный документ через GET
    r2 = admin_client.get(f"/receipts/{doc_id}")
    assert r2.status_code == 200, r2.text
    detail = r2.json()
    assert detail["doc"]["status"] == "draft"
    assert detail["doc"]["doc_number"].startswith("WH-")


def test_create_receipt_rejects_line_without_color(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line()
    line["color_id"] = None
    line["color_name"] = None
    payload["lines"] = [line]

    r = admin_client.post("/receipts", json=payload)

    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "Укажите цвет товара"


def test_add_receipt_line_rejects_line_without_color(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    created = admin_client.post("/receipts", json=payload)
    assert created.status_code == 200, created.text
    doc_id = created.json()["message"]

    line = _make_receipt_line()
    line["color_id"] = None
    line["color_name"] = None
    r = admin_client.post(f"/receipts/{doc_id}/lines", json=line)

    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "Укажите цвет товара"


def test_start_intake_requires_actual_arrival_date(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [_make_receipt_line()]
    created = admin_client.post("/receipts", json=payload)
    assert created.status_code == 200, created.text
    doc_id = created.json()["message"]

    planned = admin_client.post(f"/receipts/{doc_id}/advance")
    assert planned.status_code == 200, planned.text

    intake = admin_client.post(f"/receipts/{doc_id}/intake")

    assert intake.status_code == 400, intake.text
    assert intake.json()["detail"] == "Укажите дату прибытия (факт)"


def test_receipt_advance_state_machine(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [_make_receipt_line()]
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    # draft → planned → on_intake → done («Принять товары»); QC перенесён в упаковку.
    arrive = _arrive(admin_client, doc_id)
    assert arrive.status_code == 200, arrive.text
    assert arrive.json()["message"] == "done"
    assert admin_client.get(f"/receipts/{doc_id}").json()["doc"]["status"] == "done"


def test_arrive_writes_intake_move_to_journal(admin_client, client_id):
    """Завершение приёмки пишет журнальное движение intake → storage по каждой строке."""
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [_make_receipt_line(planned_qty=12)]
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]

    arrive = _arrive(admin_client, doc_id)
    assert arrive.status_code == 200, arrive.text

    line = admin_client.get(f"/receipts/{doc_id}").json()["lines"][0]
    with get_connection() as conn:
        moves = conn.execute(
            "SELECT * FROM zone_relocations WHERE receipt_line_id = ?", (line["id"],)
        ).fetchall()
    assert len(moves) == 1, moves
    mv = moves[0]
    assert str(mv["from_op"]) == "intake"
    assert str(mv["to_op"]) == "storage"
    assert str(mv["from_quality"]) == "good" and str(mv["to_quality"]) == "good"
    assert int(mv["qty"]) == 12
    assert mv["to_zone_id"] == line["storage_zone_id"]
    assert str(mv["client_id"]) == client_id

    # Остаток встаёт из журнала: storage/good в зоне приёмки = принятому.
    from modules.balances.service import get_available_in_zone

    with get_connection() as conn:
        available = get_available_in_zone(
            conn,
            product_id=str(mv["product_id"]), color_id=mv["color_id"], size_id=mv["size_id"],
            client_id=client_id, zone_id=line["storage_zone_id"],
            op="storage", quality="good",
        )
    assert available == 12


def test_receipt_advance_final_status_returns_400(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200
    doc_id = r.json()["message"]

    admin_client.post(f"/receipts/{doc_id}/advance")  # → planned
    admin_client.post(f"/receipts/{doc_id}/advance")  # → on_intake
    admin_client.post(f"/receipts/{doc_id}/advance")  # → on_review
    admin_client.post(f"/receipts/{doc_id}/advance")  # → done

    r_fail = admin_client.post(f"/receipts/{doc_id}/advance")
    assert r_fail.status_code == 400


def test_receipt_list_returns_pagination(admin_client):
    r = admin_client.get("/receipts?page=1&limit=5")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert data["page"] == 1


def _insert_receipt_with_cost(client_id: str, logistics_cost: float) -> str:
    """Создаёт receipt_docs напрямую в БД с заданной стоимостью логистики.

    Минуя POST /receipts: проверка cost-доступа на create отвергла бы запрос под
    warehouse-ролью, а admin_client и warehouse_client делят один dependency
    override get_current_user (последняя фикстура перетирает предыдущую).
    """
    from datetime import UTC, datetime

    doc_id = str(uuid.uuid4())
    with get_connection() as conn:
        n = conn.execute(
            "SELECT COALESCE(MAX(CAST(SUBSTR(doc_number,4) AS INTEGER)),0)+1 AS n"
            " FROM receipt_docs WHERE doc_number LIKE 'WH-%'"
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO receipt_docs (id,doc_number,client_id,status,logistics_cost,created_at)"
            " VALUES (?,?,?,?,?,?)",
            (doc_id, f"WH-{int(n):05d}", client_id, "draft", logistics_cost,
             datetime.now(UTC).isoformat()),
        )
        conn.commit()
    return doc_id


def test_receipt_lines_view_returns_doc_line_rows(admin_client, client_id):
    """Разрез «По товарам»: одна строка = позиция документа с данными дока."""
    line = _make_receipt_line(7)
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [line]
    created = admin_client.post("/receipts", json=payload)
    assert created.status_code == 200, created.text
    doc_id = created.json()["message"]
    doc_number = admin_client.get(f"/receipts/{doc_id}").json()["doc"]["doc_number"]

    r = admin_client.get(f"/receipts/lines?sku={line['product_sku']}&limit=200")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data and "total" in data
    row = next(i for i in data["items"] if i["doc_id"] == doc_id)
    assert row["doc_number"] == doc_number
    assert row["product_sku"] == line["product_sku"]
    assert row["product_name"] == line["product_name"]
    assert row["planned_qty"] == 7
    assert row["status"] == "draft"
    assert row["client_id"] == client_id


def test_warehouse_receipt_costs_are_hidden_and_readonly(warehouse_client, client_id):
    doc_id = _insert_receipt_with_cost(client_id, 12345)

    detail = warehouse_client.get(f"/receipts/{doc_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["doc"]["logistics_cost"] is None

    listing = warehouse_client.get("/receipts?limit=200")
    assert listing.status_code == 200, listing.text
    item = next(i for i in listing.json()["items"] if i["id"] == doc_id)
    assert item["logistics_cost"] is None

    forbidden = warehouse_client.patch(f"/receipts/{doc_id}", json={"logistics_cost": 777})
    assert forbidden.status_code == 403


def test_warehouse_cannot_edit_planned_arrival(warehouse_client, client_id):
    doc_id = _insert_receipt_with_cost(client_id, 0)
    forbidden = warehouse_client.patch(f"/receipts/{doc_id}", json={"arrival_date": "2026-07-01"})
    assert forbidden.status_code == 403


def test_manager_can_edit_planned_arrival(manager_client, client_id):
    doc_id = _insert_receipt_with_cost(client_id, 0)
    ok = manager_client.patch(f"/receipts/{doc_id}", json={"arrival_date": "2026-07-01"})
    assert ok.status_code == 200, ok.text
    detail = manager_client.get(f"/receipts/{doc_id}")
    assert detail.json()["doc"]["arrival_date"] == "2026-07-01"


# Тесты отключённого QC поступления удалены: годность определяется при упаковке.


def test_arrive_requires_accepted_qty_for_every_line(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [_make_receipt_line(4)]
    response = admin_client.post("/receipts", json=payload)
    assert response.status_code == 200, response.text
    doc_id = response.json()["message"]

    intake = _to_intake(admin_client, doc_id)
    assert intake.status_code == 200, intake.text

    # Принять товары без «Принят» по строке — отклоняется.
    bad = admin_client.post(f"/receipts/{doc_id}/arrive", json={"lines": []})
    assert bad.status_code == 400, bad.text


# Тест корректировок отключённого QC удалён: годность определяется при упаковке.
