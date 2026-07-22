"""Интеграционные тесты аналитики расчётов: дебиторка `/invoices/analytics` и
кредиторка `/expenses/payables` — KPI за период, накопительная кривая долга,
старение и разрезы. Требует DATABASE_URL.
"""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from tests.conftest import (  # noqa: F401
    admin_client,
    cleanup_client,
    make_client_id,
    manager_client,
    warehouse_client,
)

_XLSX = ("calc.xlsx", b"PK\x03\x04dummy",
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _cleanup(client_id: str) -> None:
    with get_connection() as conn:
        inv_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM invoice_docs WHERE client_id = ?", (client_id,)).fetchall()]
        for iid in inv_ids:
            conn.execute("DELETE FROM invoice_shipments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_payments WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_ops WHERE invoice_id = ?", (iid,))
            conn.execute("DELETE FROM invoice_files WHERE invoice_id = ?", (iid,))
        conn.execute("DELETE FROM invoice_docs WHERE client_id = ?", (client_id,))
        disp_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM dispatch_docs WHERE client_id = ?", (client_id,)).fetchall()]
        for sid in disp_ids:
            conn.execute("DELETE FROM dispatch_ops WHERE doc_id = ?", (sid,))
            conn.execute("DELETE FROM dispatch_lines WHERE doc_id = ?", (sid,))
        conn.execute("DELETE FROM dispatch_docs WHERE client_id = ?", (client_id,))
        conn.commit()


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    _cleanup(cid)
    cleanup_client(cid)


def _shipped_dispatch(admin_client, client_id: str) -> str:
    r = admin_client.post("/dispatches", json={
        "cargo_type": "good", "client_id": client_id, "client_name": "Test Client",
        "destination": "Москва", "ship_date": "2026-06-10", "lines": [],
    })
    assert r.status_code == 200, r.text
    doc_id = r.json()["message"]
    with get_connection() as conn:
        conn.execute("UPDATE dispatch_docs SET status = 'shipped' WHERE id = ?", (doc_id,))
        conn.commit()
    return doc_id


def _issued_invoice(admin_client, client_id: str, *, total: int, due_date: str, issued_on: str) -> str:
    """Выставленный счёт с проставленной задним числом бизнес-датой выставления.

    `issue` ставит issued_on = сегодня — для периодных срезов дату сдвигаем в БД,
    иначе тест зависел бы от календарного дня прогона."""
    ship = _shipped_dispatch(admin_client, client_id)
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "client_name": "Test Client",
        "due_date": due_date, "total_amount": total, "shipment_ids": [ship],
    })
    assert r.status_code == 200, r.text
    iid = r.json()["message"]
    assert admin_client.post(f"/invoices/{iid}/files", files={"file": _XLSX}).status_code == 200
    assert admin_client.post(f"/invoices/{iid}/issue").status_code == 200
    with get_connection() as conn:
        conn.execute("UPDATE invoice_docs SET issued_on = ? WHERE id = ?", (issued_on, iid))
        conn.commit()
    return iid


def _analytics(admin_client, client_id: str, date_from="2026-06-01", date_to="2026-06-30") -> dict:
    r = admin_client.get(
        f"/invoices/analytics?date_from={date_from}&date_to={date_to}&client_id={client_id}")
    assert r.status_code == 200, r.text
    return r.json()


# ── Дебиторка ───────────────────────────────────────────────────────────────────

def test_receivables_kpi_over_period(admin_client, client_id):
    """Выставлено/оплачено/долг считаются по бизнес-датам периода, а не «на сейчас»."""
    iid = _issued_invoice(admin_client, client_id, total=1_000_000,
                          due_date="2026-07-15", issued_on="2026-06-05")
    pay = admin_client.post(f"/invoices/{iid}/payments",
                            json={"amount": 400_000, "paid_on": "2026-06-20"})
    assert pay.status_code == 200, pay.text

    data = _analytics(admin_client, client_id)
    assert data["issued_kop"] == 1_000_000
    assert data["issued_count"] == 1
    assert data["paid_kop"] == 400_000
    assert data["payment_count"] == 1
    assert data["debt_kop"] == 600_000
    assert data["debt_count"] == 1
    assert data["opening_debt_kop"] == 0
    # Собираемость когорты: 400 000 из выставленных в периоде 1 000 000.
    assert data["collected_pct"] == 40.0
    # Средний срок оплаты — от даты выставления до даты оплаты (05.06 → 20.06).
    assert data["avg_days_to_pay"] == 15.0


def test_receivables_debt_curve_is_cumulative(admin_client, client_id):
    """Кривая долга — накопительная: растёт в день выставления, падает в день оплаты."""
    iid = _issued_invoice(admin_client, client_id, total=1_000_000,
                          due_date="2026-07-15", issued_on="2026-06-05")
    assert admin_client.post(f"/invoices/{iid}/payments",
                             json={"amount": 400_000, "paid_on": "2026-06-20"}).status_code == 200

    series = {p["date"]: p for p in _analytics(admin_client, client_id)["series"]}
    assert len(series) == 30
    assert series["2026-06-04"]["outstanding_kop"] == 0
    assert series["2026-06-05"]["issued_kop"] == 1_000_000
    assert series["2026-06-05"]["outstanding_kop"] == 1_000_000
    assert series["2026-06-19"]["outstanding_kop"] == 1_000_000
    assert series["2026-06-20"]["paid_kop"] == 400_000
    assert series["2026-06-20"]["outstanding_kop"] == 600_000
    assert series["2026-06-30"]["outstanding_kop"] == 600_000


def test_receivables_opening_balance_carries_into_window(admin_client, client_id):
    """Долг, возникший до окна, входит в него открывающим остатком."""
    _issued_invoice(admin_client, client_id, total=500_000,
                    due_date="2026-08-01", issued_on="2026-05-20")

    data = _analytics(admin_client, client_id)
    assert data["issued_kop"] == 0            # в самом окне ничего не выставляли
    assert data["opening_debt_kop"] == 500_000
    assert data["debt_kop"] == 500_000
    assert data["series"][0]["outstanding_kop"] == 500_000


def test_receivables_aging_splits_by_days_overdue(admin_client, client_id):
    """Старение считается на дату конца окна: срок 10.06 при отчёте по 30.06 → 20 дней."""
    _issued_invoice(admin_client, client_id, total=300_000,
                    due_date="2026-06-10", issued_on="2026-06-01")   # просрочен на 20 дн.
    _issued_invoice(admin_client, client_id, total=200_000,
                    due_date="2026-07-20", issued_on="2026-06-02")   # срок ещё не наступил

    data = _analytics(admin_client, client_id)
    aging = {b["key"]: b for b in data["aging"]}
    assert aging["d8_30"]["amount_kop"] == 300_000
    assert aging["d8_30"]["count"] == 1
    assert aging["current"]["amount_kop"] == 200_000
    assert data["overdue_kop"] == 300_000
    assert data["overdue_count"] == 1
    assert data["debt_kop"] == 500_000

    client_row = data["clients"][0]
    assert client_row["client_id"] == client_id
    assert client_row["debt_kop"] == 500_000
    assert client_row["overdue_kop"] == 300_000
    assert client_row["oldest_overdue_days"] == 20


def test_receivables_scoped_by_client(admin_client, client_id):
    """Фильтр по клиенту изолирует срез: чужой клиент не видит наших счетов."""
    _issued_invoice(admin_client, client_id, total=700_000,
                    due_date="2026-07-15", issued_on="2026-06-05")

    other = make_client_id()
    try:
        data = _analytics(admin_client, other)
        assert data["issued_kop"] == 0
        assert data["debt_kop"] == 0
        assert data["clients"] == []
    finally:
        cleanup_client(other)


def test_receivables_ignores_drafts(admin_client, client_id):
    """Черновик — ещё не обязательство клиента: в дебиторку не попадает."""
    ship = _shipped_dispatch(admin_client, client_id)
    r = admin_client.post("/invoices", json={
        "client_id": client_id, "due_date": "2026-07-01",
        "total_amount": 900_000, "shipment_ids": [ship],
    })
    assert r.status_code == 200, r.text

    data = _analytics(admin_client, client_id)
    assert data["issued_kop"] == 0
    assert data["debt_kop"] == 0


def test_cancel_does_not_rewrite_closed_period(admin_client, client_id):
    """Аннулирование не трогает уже закрытый период: касса июня остаётся прежней,
    обязательство снимается датой аннулирования (сегодня), а не задним числом."""
    iid = _issued_invoice(admin_client, client_id, total=1_000_000,
                          due_date="2026-07-15", issued_on="2026-06-05")
    assert admin_client.post(f"/invoices/{iid}/payments",
                             json={"amount": 400_000, "paid_on": "2026-06-20"}).status_code == 200
    june_before = _analytics(admin_client, client_id)

    assert admin_client.post(f"/invoices/{iid}/cancel").status_code == 200

    june_after = _analytics(admin_client, client_id)
    assert june_after["issued_kop"] == june_before["issued_kop"] == 1_000_000
    assert june_after["paid_kop"] == june_before["paid_kop"] == 400_000
    assert june_after["debt_kop"] == june_before["debt_kop"] == 600_000
    assert june_after["series"] == june_before["series"]

    # В окне, куда попадает день аннулирования, обязательство и касса схлопываются.
    wide = _analytics(admin_client, client_id, date_from="2026-06-01", date_to="2026-08-31")
    assert wide["debt_kop"] == 0
    assert wide["cancelled_kop"] == 1_000_000
    assert wide["cancelled_count"] == 1
    assert wide["paid_kop"] == 0                     # 400 000 оплаты + сторно −400 000
    assert wide["series"][-1]["outstanding_kop"] == 0
    # Собираемость когорты считается без аннулированных — делить не на что.
    assert wide["collected_pct"] == 0.0


def test_cancel_writes_reversal_instead_of_deleting_payment(admin_client, client_id):
    """Исходная оплата остаётся в журнале со своей датой, сторно — парной записью."""
    iid = _issued_invoice(admin_client, client_id, total=1_000_000,
                          due_date="2026-07-15", issued_on="2026-06-05")
    assert admin_client.post(f"/invoices/{iid}/payments",
                             json={"amount": 400_000, "paid_on": "2026-06-20"}).status_code == 200
    assert admin_client.post(f"/invoices/{iid}/cancel").status_code == 200

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT amount, paid_on, reverses_id, COALESCE(is_deleted, 0) AS deleted "
            "FROM invoice_payments WHERE invoice_id = ? ORDER BY amount DESC", (iid,)).fetchall()
        doc = conn.execute(
            "SELECT paid_amount, cancelled_on, status FROM invoice_docs WHERE id = ?", (iid,)).fetchone()

    assert len(rows) == 2
    original, reversal = rows
    assert int(original["amount"]) == 400_000
    assert original["paid_on"] == "2026-06-20"       # дата не переписана
    assert original["reverses_id"] is None
    assert int(original["deleted"]) == 0             # запись не удалена мягко
    assert int(reversal["amount"]) == -400_000
    assert reversal["reverses_id"] is not None
    assert reversal["paid_on"] == doc["cancelled_on"]
    assert int(doc["paid_amount"]) == 0
    assert str(doc["status"]) == "cancelled"

    # Карточка счёта показывает обе записи — сторно помечено ссылкой на исходную оплату.
    detail = admin_client.get(f"/invoices/{iid}").json()
    assert [p["amount"] for p in detail["payments"]] == [400_000, -400_000]
    assert detail["payments"][1]["reverses_id"] == detail["payments"][0]["id"]


def test_receivables_requires_finance_role(warehouse_client):
    r = warehouse_client.get("/invoices/analytics?date_from=2026-06-01&date_to=2026-06-30")
    assert r.status_code == 403


# ── Кредиторка ──────────────────────────────────────────────────────────────────

@pytest.fixture
def dict_ids(admin_client):
    tag = uuid.uuid4().hex[:8]
    cat = admin_client.post("/expenses/dict/categories", json={"name": f"SettleCat-{tag}"}).json()["message"]
    src = admin_client.post("/expenses/dict/payment-sources", json={"name": f"SettleSrc-{tag}"}).json()["message"]
    yield cat, src
    with get_connection() as conn:
        exp_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM material_expenses WHERE category_id = ? OR payment_source_id = ?",
            (cat, src)).fetchall()]
        for eid in exp_ids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (eid,))
            conn.execute("DELETE FROM expense_payments WHERE expense_id = ?", (eid,))
        conn.execute("DELETE FROM material_expenses WHERE category_id = ? OR payment_source_id = ?",
                     (cat, src))
        conn.execute("DELETE FROM expense_categories WHERE id = ?", (cat,))
        conn.execute("DELETE FROM expense_payment_sources WHERE id = ?", (src,))
        conn.commit()


def _payables(admin_client, date_from="2026-06-01", date_to="2026-06-30") -> dict:
    r = admin_client.get(f"/expenses/payables?date_from={date_from}&date_to={date_to}")
    assert r.status_code == 200, r.text
    return r.json()


def test_payables_accrual_payment_and_debt(admin_client, dict_ids):
    """Начислено/выплачено/долг по расходам за период. Срез общий по всем контрагентам,
    поэтому сверяем дельты к состоянию до создания расхода."""
    cat, src = dict_ids
    before = _payables(admin_client)

    r = admin_client.post("/expenses", json={
        "spent_on": "2026-06-05", "category_id": cat, "name": "Стретч-плёнка",
        "quantity": 10, "unit": "шт", "amount": 500_000,
        "payment_source_id": src, "payment_status": "awaiting",
    })
    assert r.status_code == 200, r.text
    eid = r.json()["message"]
    pay = admin_client.post(f"/expenses/{eid}/pay", json={
        "paid_on": "2026-06-20", "payment_source_id": src, "amount": 200_000,
    })
    assert pay.status_code == 200, pay.text

    after = _payables(admin_client)
    assert after["accrued_kop"] - before["accrued_kop"] == 500_000
    assert after["paid_kop"] - before["paid_kop"] == 200_000
    assert after["debt_kop"] - before["debt_kop"] == 300_000

    series_before = {p["date"]: p for p in before["series"]}
    series_after = {p["date"]: p for p in after["series"]}
    assert series_after["2026-06-05"]["accrued_kop"] - series_before["2026-06-05"]["accrued_kop"] == 500_000
    assert series_after["2026-06-20"]["paid_kop"] - series_before["2026-06-20"]["paid_kop"] == 200_000
    # Долг накопительный: после дня оплаты остаётся непогашенные 300 000.
    delta_end = (series_after["2026-06-30"]["outstanding_kop"]
                 - series_before["2026-06-30"]["outstanding_kop"])
    assert delta_end == 300_000

    # Старение по возрасту от даты расхода: 05.06 → 30.06 = 25 дней.
    aging_before = {b["key"]: b["amount_kop"] for b in before["aging"]}
    aging_after = {b["key"]: b["amount_kop"] for b in after["aging"]}
    assert aging_after["d8_30"] - aging_before["d8_30"] == 300_000


def test_payables_requires_finance_role(warehouse_client):
    r = warehouse_client.get("/expenses/payables?date_from=2026-06-01&date_to=2026-06-30")
    assert r.status_code == 403
