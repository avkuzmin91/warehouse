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


def test_create_receipt_rejects_duplicate_variant(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line()
    payload["lines"] = [line, dict(line)]

    r = admin_client.post("/receipts", json=payload)

    assert r.status_code == 400, r.text
    assert "уже добавлен" in r.json()["detail"]


def test_add_receipt_line_rejects_duplicate_variant(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line()
    payload["lines"] = [line]
    created = admin_client.post("/receipts", json=payload)
    assert created.status_code == 200, created.text
    doc_id = created.json()["message"]

    r = admin_client.post(f"/receipts/{doc_id}/lines", json=dict(line))

    assert r.status_code == 400, r.text
    assert "уже добавлен" in r.json()["detail"]


def test_add_receipt_line_allows_different_variant(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line()
    payload["lines"] = [line]
    created = admin_client.post("/receipts", json=payload)
    assert created.status_code == 200, created.text
    doc_id = created.json()["message"]

    other = dict(line)
    other["color_id"] = str(uuid.uuid4())
    other["color_name"] = "Blue"
    r = admin_client.post(f"/receipts/{doc_id}/lines", json=other)

    assert r.status_code == 200, r.text


def test_receipt_advance_to_planned(admin_client, client_id):
    """Единственный ручной переход — draft → planned. Дальше двигает рейс."""
    payload = _make_receipt_payload(client_id)
    payload["lines"] = [_make_receipt_line()]
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]

    planned = admin_client.post(f"/receipts/{doc_id}/advance")
    assert planned.status_code == 200, planned.text
    assert planned.json()["message"] == "planned"
    assert admin_client.get(f"/receipts/{doc_id}").json()["doc"]["status"] == "planned"


def test_receipt_advance_final_status_returns_400(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200
    doc_id = r.json()["message"]

    admin_client.post(f"/receipts/{doc_id}/advance")  # draft → planned
    # planned — финал для ручного перехода (дальше только рейс).
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


def test_receipt_search_is_case_and_yo_insensitive(admin_client, client_id):
    """Поиск по списку должен быть регистронезависимым и сворачивать ё↔е."""
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line()
    line["product_name"] = "Ёлка Праздничная"
    payload["lines"] = [line]
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    doc_number = admin_client.get(f"/receipts/{doc_id}").json()["doc"]["doc_number"]

    def _ids(**qs: str) -> list[str]:
        query = "&".join(f"{k}={v}" for k, v in {"client_id": client_id, **qs}.items())
        res = admin_client.get(f"/receipts?{query}")
        assert res.status_code == 200, res.text
        return [it["id"] for it in res.json()["items"]]

    # doc_number генерируется в верхнем регистре (WH-…) — ищем нижним.
    assert doc_id in _ids(search=doc_number.lower())
    # product_name с «ё» — ищем через «е» и разным регистром.
    assert doc_id in _ids(sku="елка")
    assert doc_id in _ids(sku="ЕЛКА")
    assert doc_id in _ids(sku="Ёлка")


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
            " FROM receipt_docs WHERE doc_number LIKE 'WH-%' AND SUBSTR(doc_number,4) ~ '^[0-9]+$'"
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


# Карточная приёмка (/intake, /arrive) удалена: поступления принимаются в рейсе.
# Приёмка по рейсу покрыта в test_logistics; историческое заведение — в test_balances.


def _receipt_dup_check(admin_client, client_id, line, *, arrival_date="2026-05-27"):
    return admin_client.post("/receipts/check-duplicate", json={
        "client_id": client_id,
        "arrival_date": arrival_date,
        "lines": [{
            "product_id": line["product_id"],
            "color_id": line["color_id"],
            "size_id": line["size_id"],
            "planned_qty": line["planned_qty"],
        }],
    })


def test_receipt_duplicate_exact_match(admin_client, client_id):
    """Тот же клиент + плановая дата прибытия + состав → совпадение."""
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line(5)
    payload["lines"] = [line]
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]
    matches = _receipt_dup_check(admin_client, client_id, line).json()["matches"]
    assert len(matches) == 1
    assert matches[0]["id"] == doc_id
    assert matches[0]["lines"][0]["qty"] == 5


def test_receipt_duplicate_qty_differs(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line(5)
    payload["lines"] = [line]
    admin_client.post("/receipts", json=payload)
    other = dict(line, planned_qty=6)
    assert _receipt_dup_check(admin_client, client_id, other).json()["matches"] == []


def test_receipt_duplicate_date_differs(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line(5)
    payload["lines"] = [line]
    admin_client.post("/receipts", json=payload)
    assert _receipt_dup_check(admin_client, client_id, line, arrival_date="2026-05-28").json()["matches"] == []


def test_create_receipt_rejects_out_of_range_arrival_date(admin_client, client_id):
    """Явная опечатка в годе (1991) не должна протекать в документ."""
    payload = _make_receipt_payload(client_id)
    payload["arrival_date"] = "1991-06-15"
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 400, r.text
    assert "вне допустимого диапазона" in r.json()["detail"]


def test_create_receipt_rejects_garbage_arrival_date(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["arrival_date"] = "15.06.2026"
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 400, r.text
    assert "ГГГГ-ММ-ДД" in r.json()["detail"]


def test_create_receipt_allows_empty_arrival_date(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    payload["arrival_date"] = ""
    r = admin_client.post("/receipts", json=payload)
    assert r.status_code == 200, r.text
    doc = admin_client.get(f"/receipts/{r.json()['message']}").json()["doc"]
    assert doc["arrival_date"] is None


def test_update_receipt_rejects_far_future_arrival_date(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]
    r = admin_client.patch(f"/receipts/{doc_id}", json={"arrival_date": "3000-01-01"})
    assert r.status_code == 400, r.text
    assert "вне допустимого диапазона" in r.json()["detail"]


def test_receipt_doc_numbers_increase(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    id1 = admin_client.post("/receipts", json=payload).json()["message"]
    id2 = admin_client.post("/receipts", json=payload).json()["message"]
    n1 = admin_client.get(f"/receipts/{id1}").json()["doc"]["doc_number"]
    n2 = admin_client.get(f"/receipts/{id2}").json()["doc"]["doc_number"]
    assert n1.startswith("WH-") and n2.startswith("WH-")
    assert int(n2[3:]) == int(n1[3:]) + 1


def test_update_cancelled_receipt_forbidden(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]
    assert admin_client.post(f"/receipts/{doc_id}/advance").status_code == 200  # draft → planned
    assert admin_client.post(f"/receipts/{doc_id}/cancel").status_code == 200
    r = admin_client.patch(f"/receipts/{doc_id}", json={"supplier_name": "X"})
    assert r.status_code == 400, r.text


def test_receipt_overdue_filter(admin_client, client_id):
    """overdue=true отдаёт запланированные с прошедшей датой прибытия (SQL на константах)."""
    from datetime import date, timedelta

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    payload = _make_receipt_payload(client_id)
    payload["arrival_date"] = yesterday
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]
    assert admin_client.post(f"/receipts/{doc_id}/advance").status_code == 200  # draft → planned

    r = admin_client.get(f"/receipts?overdue=true&client_id={client_id}")
    assert r.status_code == 200, r.text
    assert doc_id in [it["id"] for it in r.json()["items"]]

    # Черновик (не planned) в просроченные не попадает.
    draft_payload = _make_receipt_payload(client_id)
    draft_payload["arrival_date"] = yesterday
    draft_id = admin_client.post("/receipts", json=draft_payload).json()["message"]
    r2 = admin_client.get(f"/receipts?overdue=true&client_id={client_id}")
    assert draft_id not in [it["id"] for it in r2.json()["items"]]


def test_receipt_duplicate_ignores_cancelled(admin_client, client_id):
    payload = _make_receipt_payload(client_id)
    line = _make_receipt_line(5)
    payload["lines"] = [line]
    doc_id = admin_client.post("/receipts", json=payload).json()["message"]
    assert admin_client.post(f"/receipts/{doc_id}/advance").status_code == 200  # draft → planned
    assert admin_client.post(f"/receipts/{doc_id}/cancel").status_code == 200
    assert _receipt_dup_check(admin_client, client_id, line).json()["matches"] == []
