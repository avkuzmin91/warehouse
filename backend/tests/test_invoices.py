"""Интеграционные тесты модуля «Счета»: черновик → выставление → оплата → закрытие,
привязка отгрузок, инвариант «одна отгрузка — один счёт», гейты, RBAC.
Требует DATABASE_URL.
"""
from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    warehouse_client,
)


def _cleanup_invoices_and_shipments(client_id: str) -> None:
    with get_connection() as conn:
        inv_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM invoice_docs WHERE client_id = ?", (client_id,)
            ).fetchall()
        ]
        for iid in inv_ids:
            conn.execute("DELETE FROM invoice_shipments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_payments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_ops WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_files WHERE invoice_id = ?", (iid,))
        conn.execute("DELETE FROM invoice_docs WHERE client_id = ?", (client_id,))
        ship_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM shipment_docs WHERE client_id = ?", (client_id,)
            ).fetchall()
        ]
        for sid in ship_ids:
            conn.execute("DELETE FROM shipment_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM shipment_lines WHERE doc_id = ?", (sid,))
        conn.execute("DELETE FROM shipment_docs WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup_invoices_and_shipments(cid)
    cleanup_client(cid)


def _shipped_shipment(admin_client, client_id: str, ship_date: str = "2026-06-10") -> str:
    """Завершённая отгрузка клиента — кандидат на включение в счёт."""
    r = admin_client.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": ship_date, "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    with get_connection() as conn:
        conn.execute("UPDATE shipment_docs SET status = 'shipped' WHERE id = ?", (doc_id,))
        conn.commit()
    return doc_id


_XLSX = ("calc.xlsx", b"PK\x03\x04dummy",
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _attach_file(admin_client, invoice_id: str) -> None:
    ok = admin_client.post(f"/invoices/{invoice_id}/files", files={"file": _XLSX})
    assert ok.status_code == 200, ok.text


def _draft_invoice(admin_client, client_id, *, ship=None, due_date="2026-07-01",
                   total_amount=1000, comment=None) -> str:
    payload = {
        "client_id": client_id, "due_date": due_date, "total_amount": total_amount,
        "shipment_ids": [ship] if ship else [],
    }
    if comment is not None:
        payload["comment"] = comment
    r = admin_client.post("/invoices", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["message"]


def _issued_invoice(admin_client, client_id, ship, *, total_amount=1000, due_date="2026-07-01") -> str:
    """Полный путь черновик → файл → выставлен."""
    iid = _draft_invoice(admin_client, client_id, ship=ship, due_date=due_date, total_amount=total_amount)
    _attach_file(admin_client, iid)
    r = admin_client.post(f"/invoices/{iid}/issue")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "issued"
    return iid


def test_create_invoice_lands_in_draft_then_issues(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "client_name": "Test Client",
        "due_date": "2026-07-01", "total_amount": 1500000, "comment": "Счёт за июнь",
        "shipment_ids": [ship],
    })
    assert r.status_code == 200, r.text
    invoice_id = r.json()["message"]

    data = admin_client.get(f"/invoices/{invoice_id}").json()
    assert data["doc_number"].startswith("INV-")
    assert data["status"] == "draft"
    assert data["status_label"] == "Черновик"
    assert data["total_amount"] == 1500000      # копейки
    assert data["paid_amount"] == 0
    assert data["due_date"] == "2026-07-01"
    assert data["client_id"] == client_id
    assert [s["shipment_doc_id"] for s in data["shipments"]] == [ship]
    op_types = {o["op_type"] for o in data["ops"]}
    assert "doc_create" in op_types
    assert "shipment_link" in op_types

    # Выставить без файла нельзя.
    no_file = admin_client.post(f"/invoices/{invoice_id}/issue")
    assert no_file.status_code == 400, no_file.text
    assert "файл" in no_file.json()["detail"].lower()

    _attach_file(admin_client, invoice_id)
    issued = admin_client.post(f"/invoices/{invoice_id}/issue")
    assert issued.status_code == 200, issued.text

    after = admin_client.get(f"/invoices/{invoice_id}").json()
    assert after["status"] == "issued"
    assert after["status_label"] == "Выставлен"
    assert "issue" in {o["op_type"] for o in after["ops"]}


def test_create_requires_only_client(admin_client, client_id):
    no_client = admin_client.post("/invoices", json={"client_id": ""})
    assert no_client.status_code == 400, no_client.text

    # Черновик создаётся, если указан только клиент.
    ok = admin_client.post("/invoices", json={"client_id": client_id})
    assert ok.status_code == 200, ok.text
    d = admin_client.get(f"/invoices/{ok.json()['message']}").json()
    assert d["status"] == "draft"
    assert d["shipments"] == []
    assert d["due_date"] is None
    assert d["total_amount"] == 0


def test_issue_gates(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    iid = _draft_invoice(admin_client, client_id, ship=None, due_date="", total_amount=0)

    no_amount = admin_client.post(f"/invoices/{iid}/issue")
    assert no_amount.status_code == 400 and "сумм" in no_amount.json()["detail"].lower()

    assert admin_client.patch(f"/invoices/{iid}", json={"total_amount": 5000}).status_code == 200
    no_due = admin_client.post(f"/invoices/{iid}/issue")
    assert no_due.status_code == 400 and "дат" in no_due.json()["detail"].lower()

    assert admin_client.patch(f"/invoices/{iid}", json={"due_date": "2026-07-01"}).status_code == 200
    no_ship = admin_client.post(f"/invoices/{iid}/issue")
    assert no_ship.status_code == 400 and "отгрузк" in no_ship.json()["detail"].lower()

    assert admin_client.post(f"/invoices/{iid}/shipments", json={"shipment_ids": [ship]}).status_code == 200
    no_file = admin_client.post(f"/invoices/{iid}/issue")
    assert no_file.status_code == 400 and "файл" in no_file.json()["detail"].lower()

    _attach_file(admin_client, iid)
    ok = admin_client.post(f"/invoices/{iid}/issue")
    assert ok.status_code == 200, ok.text
    assert admin_client.get(f"/invoices/{iid}").json()["status"] == "issued"


def test_draft_edit_then_locked_after_issue(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    iid = _draft_invoice(admin_client, client_id, ship=ship, total_amount=1000)

    upd = admin_client.patch(f"/invoices/{iid}", json={
        "total_amount": 7777, "due_date": "2026-08-01", "comment": "правка",
    })
    assert upd.status_code == 200, upd.text
    d = admin_client.get(f"/invoices/{iid}").json()
    assert d["total_amount"] == 7777
    assert d["due_date"] == "2026-08-01"
    assert d["comment"] == "правка"
    assert "doc_update" in {o["op_type"] for o in d["ops"]}

    _attach_file(admin_client, iid)
    assert admin_client.post(f"/invoices/{iid}/issue").status_code == 200

    # После выставления реквизиты править нельзя.
    locked = admin_client.patch(f"/invoices/{iid}", json={"total_amount": 1})
    assert locked.status_code == 400, locked.text


def test_shipment_cannot_be_in_two_invoices(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    first = _draft_invoice(admin_client, client_id, ship=ship)
    assert first

    dup = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-01", "total_amount": 1000,
        "shipment_ids": [ship],
    })
    assert dup.status_code == 400, dup.text
    assert "уже привязана" in dup.json()["detail"]


def test_detach_frees_shipment_for_new_invoice(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    inv1 = _draft_invoice(admin_client, client_id, ship=ship)

    detach = admin_client.delete(f"/invoices/{inv1}/shipments/{ship}")
    assert detach.status_code == 200, detach.text

    # Освобождённую отгрузку можно включить в новый счёт.
    inv2 = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-02", "total_amount": 2000,
        "shipment_ids": [ship],
    })
    assert inv2.status_code == 200, inv2.text


def test_only_shipped_shipments_allowed(admin_client, client_id):
    # Отгрузка остаётся в черновике (не завершена) — в счёт нельзя.
    r = admin_client.post("/shipments", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client", "lines": [],
    })
    draft_ship = r.json()["message"]
    bad = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-01", "shipment_ids": [draft_ship],
    })
    assert bad.status_code == 400, bad.text
    assert "только завершённые" in bad.json()["detail"]


def test_shipment_of_other_client_rejected(admin_client, client_id):
    other = make_client_id()
    try:
        ship = _shipped_shipment(admin_client, other)
        bad = admin_client.post("/invoices", json={
            "client_id": client_id, "due_date": "2026-07-01", "shipment_ids": [ship],
        })
        assert bad.status_code == 400, bad.text
        assert "другому клиенту" in bad.json()["detail"]
    finally:
        _cleanup_invoices_and_shipments(other)
        cleanup_client(other)


def test_finance_rbac_forbids_warehouse(warehouse_client, client_id):
    forbidden = warehouse_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-01", "shipment_ids": [],
    })
    assert forbidden.status_code == 403, forbidden.text


def _uninvoiced_ids(admin_client, client_id: str) -> set[str]:
    r = admin_client.get(f"/invoices/uninvoiced-shipments?client_id={client_id}&limit=200")
    assert r.status_code == 200, r.text
    return {it["id"] for it in r.json()["items"]}


def test_registry_and_list(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    # До счёта отгрузка — в реестре «без счёта».
    assert ship in _uninvoiced_ids(admin_client, client_id)

    invoice_id = _draft_invoice(admin_client, client_id, ship=ship, total_amount=5000)

    # После — даже черновик резервирует отгрузку: она исчезает из реестра «без счёта».
    assert ship not in _uninvoiced_ids(admin_client, client_id)
    lst = admin_client.get(f"/invoices?client_id={client_id}&limit=200")
    assert lst.status_code == 200, lst.text
    item = next(it for it in lst.json()["items"] if it["id"] == invoice_id)
    assert item["shipment_count"] == 1
    assert item["total_amount"] == 5000
    assert item["status"] == "draft"


def test_payment_then_close(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=1000)

    p1 = admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 400, "paid_on": "2026-07-02"})
    assert p1.status_code == 200, p1.text
    d = admin_client.get(f"/invoices/{invoice_id}").json()
    assert d["paid_amount"] == 400
    assert d["status"] == "partially_paid"

    # Неполная оплата — закрыть нельзя.
    early = admin_client.post(f"/invoices/{invoice_id}/close")
    assert early.status_code == 400, early.text
    assert "не полностью" in early.json()["detail"]

    admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 600, "paid_on": "2026-07-03"})
    closed = admin_client.post(f"/invoices/{invoice_id}/close")
    assert closed.status_code == 200, closed.text
    assert closed.json()["message"] == "closed"

    # Закрытый счёт изменять нельзя.
    locked = admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 1})
    assert locked.status_code == 400, locked.text


def test_overpayment_rejected(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=1000)

    assert admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 600, "paid_on": "2026-07-02"}).status_code == 200
    over = admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 600, "paid_on": "2026-07-03"})
    assert over.status_code == 400, over.text
    assert "превышает" in over.json()["detail"]

    # Платёж не записан — оплачено осталось 600.
    assert admin_client.get(f"/invoices/{invoice_id}").json()["paid_amount"] == 600

    # Ровно остаток — проходит.
    exact = admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 400, "paid_on": "2026-07-04"})
    assert exact.status_code == 200, exact.text
    assert admin_client.get(f"/invoices/{invoice_id}").json()["paid_amount"] == 1000


def test_payment_requires_paid_on(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=1000)

    missing = admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 400})
    assert missing.status_code == 400, missing.text
    assert "дату оплаты" in missing.json()["detail"]
    # Платёж не записан — оплачено осталось 0.
    assert admin_client.get(f"/invoices/{invoice_id}").json()["paid_amount"] == 0


def test_due_date_shift_keeps_history(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=100, due_date="2026-07-01")

    r = admin_client.patch(f"/invoices/{invoice_id}/due-date", json={"due_date": "2026-07-15"})
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/invoices/{invoice_id}").json()
    assert d["due_date"] == "2026-07-15"
    changes = [o for o in d["ops"] if o["op_type"] == "due_date_change"]
    assert changes and "2026-07-01" in changes[-1]["comment"] and "2026-07-15" in changes[-1]["comment"]


def test_cancel_frees_shipment(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _draft_invoice(admin_client, client_id, ship=ship, total_amount=100)
    assert ship not in _uninvoiced_ids(admin_client, client_id)

    cancel = admin_client.post(f"/invoices/{invoice_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["message"] == "cancelled"

    # Отгрузка снова свободна и доступна для нового счёта.
    assert ship in _uninvoiced_ids(admin_client, client_id)
    again = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-09", "total_amount": 100,
        "shipment_ids": [ship],
    })
    assert again.status_code == 200, again.text


def test_overdue_alert_counts_only_issued(admin_client, client_id):
    before = admin_client.get("/invoices/alerts").json()
    ship = _shipped_shipment(admin_client, client_id)
    _issued_invoice(admin_client, client_id, ship, total_amount=100, due_date="2020-01-01")
    after = admin_client.get("/invoices/alerts").json()
    assert after["overdue_count"] >= before["overdue_count"] + 1
    assert after["due_count"] >= before["due_count"] + 1


def test_draft_excluded_from_overdue(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    iid = _draft_invoice(admin_client, client_id, ship=ship, total_amount=100, due_date="2020-01-01")

    # Черновик не активен → не «просрочен», не «срок наступил» и не в фильтре overdue.
    d = admin_client.get(f"/invoices/{iid}").json()
    assert d["overdue"] is False
    assert d["due_reached"] is False

    lst = admin_client.get("/invoices?overdue=true&limit=200").json()
    assert iid not in {it["id"] for it in lst["items"]}


def test_invoice_file_upload_and_delete(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _draft_invoice(admin_client, client_id, ship=ship, total_amount=100)

    bad = admin_client.post(
        f"/invoices/{invoice_id}/files",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert bad.status_code == 400, bad.text

    ok = admin_client.post(f"/invoices/{invoice_id}/files", files={"file": _XLSX})
    assert ok.status_code == 200, ok.text
    file_id = ok.json()["message"]

    d = admin_client.get(f"/invoices/{invoice_id}").json()
    assert [f["filename"] for f in d["files"]] == ["calc.xlsx"]

    rm = admin_client.delete(f"/invoices/{invoice_id}/files/{file_id}")
    assert rm.status_code == 200, rm.text
    assert admin_client.get(f"/invoices/{invoice_id}").json()["files"] == []


def test_amount_correction_after_issue(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=150000)

    r = admin_client.patch(f"/invoices/{invoice_id}/amount", json={
        "total_amount": 120000, "reason": "Клиент оспорил тариф, согласована новая сумма",
    })
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/invoices/{invoice_id}").json()
    assert d["total_amount"] == 120000
    changes = [o for o in d["ops"] if o["op_type"] == "amount_change"]
    assert changes, "ожидалась запись amount_change в журнале"
    comment = changes[-1]["comment"]
    assert "Причина:" in comment and "оспорил" in comment


def test_amount_correction_requires_reason(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=1000)

    no_reason = admin_client.patch(f"/invoices/{invoice_id}/amount", json={"total_amount": 1200, "reason": "  "})
    assert no_reason.status_code == 400, no_reason.text
    assert "причин" in no_reason.json()["detail"].lower()
    assert admin_client.get(f"/invoices/{invoice_id}").json()["total_amount"] == 1000


def test_amount_correction_below_paid_blocked(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=1000)
    assert admin_client.post(f"/invoices/{invoice_id}/payments", json={"amount": 600, "paid_on": "2026-07-02"}).status_code == 200

    # Опустить сумму ниже уже оплаченной нельзя.
    below = admin_client.patch(f"/invoices/{invoice_id}/amount", json={"total_amount": 500, "reason": "спор"})
    assert below.status_code == 400, below.text
    assert "оплаченной" in below.json()["detail"]
    assert admin_client.get(f"/invoices/{invoice_id}").json()["total_amount"] == 1000

    # Ровно до оплаченной — можно, после чего счёт закрывается.
    exact = admin_client.patch(f"/invoices/{invoice_id}/amount", json={"total_amount": 600, "reason": "спор"})
    assert exact.status_code == 200, exact.text
    closed = admin_client.post(f"/invoices/{invoice_id}/close")
    assert closed.status_code == 200, closed.text


def test_amount_correction_rejected_on_draft(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    iid = _draft_invoice(admin_client, client_id, ship=ship, total_amount=1000)

    # Черновик правится целиком через PATCH /invoices/{id}, а не точечной корректировкой.
    r = admin_client.patch(f"/invoices/{iid}/amount", json={"total_amount": 1200, "reason": "спор"})
    assert r.status_code == 400, r.text


def _add_shipment_lines(ship: str, rows: list[tuple[str, int]]) -> None:
    """Строки отгрузки напрямую в БД (без зависимости от справочника товаров)."""
    now = "2026-06-10T00:00:00+00:00"
    with get_connection() as conn:
        for i, (pid, qty) in enumerate(rows):
            conn.execute(
                "INSERT INTO shipment_lines "
                "(id,doc_id,product_id,product_name,product_sku,color_id,color_name,"
                "size_id,size_name,qty,shipped_qty,storage_zone_id,storage_zone_name,"
                "store_id,store_name,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"{ship}-l{i}", ship, pid, f"Товар {pid}", pid.upper(),
                 None, None, None, None, qty, qty, None, None, None, None, now),
            )
        conn.commit()


def test_invoice_detail_exposes_shipment_contents(admin_client, client_id):
    # Детализация счёта отдаёт агрегаты по строкам каждой отгрузки (кол-во + число SKU),
    # чтобы видеть содержимое прямо в карточке, не открывая отгрузку.
    ship = _shipped_shipment(admin_client, client_id)
    _add_shipment_lines(ship, [("p-aaa", 120), ("p-aaa", 100), ("p-bbb", 30)])  # 2 товара, 250 шт

    invoice_id = _draft_invoice(admin_client, client_id, ship=ship, total_amount=5000)
    d = admin_client.get(f"/invoices/{invoice_id}").json()
    item = next(s for s in d["shipments"] if s["shipment_doc_id"] == ship)
    assert item["total_qty"] == 250
    assert item["sku_count"] == 2


def test_uninvoiced_shipment_products_preview(admin_client, client_id):
    # Реестр «без счёта» отдаёт топ-3 товара отгрузки по количеству (для свёрнутой строки).
    ship = _shipped_shipment(admin_client, client_id)
    _add_shipment_lines(ship, [("p-a", 50), ("p-b", 200), ("p-c", 30), ("p-d", 10)])  # 4 SKU

    r = admin_client.get(f"/invoices/uninvoiced-shipments?client_id={client_id}&limit=200")
    assert r.status_code == 200, r.text
    item = next(it for it in r.json()["items"] if it["id"] == ship)
    assert item["sku_count"] == 4
    assert item["total_qty"] == 290
    preview = item["products_preview"]
    assert len(preview) == 3                              # топ-3, не все 4
    assert [p["name"] for p in preview] == ["Товар p-b", "Товар p-a", "Товар p-c"]  # qty desc
    assert preview[0]["qty"] == 200


def test_shipment_contents_rollup(admin_client, client_id):
    # Сводный состав по набору отгрузок (roll-up при выборе в счёт): товар p-x суммируется.
    ship1 = _shipped_shipment(admin_client, client_id)
    ship2 = _shipped_shipment(admin_client, client_id)
    _add_shipment_lines(ship1, [("p-x", 100), ("p-y", 50)])
    _add_shipment_lines(ship2, [("p-x", 30), ("p-z", 20)])

    r = admin_client.get(f"/invoices/shipment-contents?shipment_ids={ship1},{ship2}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_qty"] == 200
    assert body["sku_count"] == 3
    by_id = {p["product_id"]: p["qty"] for p in body["products"]}
    assert by_id == {"p-x": 130, "p-y": 50, "p-z": 20}
    assert body["products"][0]["product_id"] == "p-x"     # сортировка по убыванию количества

    # Пустой набор — пустая сводка.
    empty = admin_client.get("/invoices/shipment-contents?shipment_ids=")
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"products": [], "total_qty": 0, "sku_count": 0}


def test_due_date_reason_in_journal(admin_client, client_id):
    ship = _shipped_shipment(admin_client, client_id)
    invoice_id = _issued_invoice(admin_client, client_id, ship, total_amount=100, due_date="2026-07-01")

    r = admin_client.patch(f"/invoices/{invoice_id}/due-date", json={
        "due_date": "2026-07-20", "reason": "Отсрочка по договорённости",
    })
    assert r.status_code == 200, r.text
    d = admin_client.get(f"/invoices/{invoice_id}").json()
    changes = [o for o in d["ops"] if o["op_type"] == "due_date_change"]
    assert changes and "Причина: Отсрочка по договорённости" in changes[-1]["comment"]
