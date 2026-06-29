"""Интеграционные тесты модуля «Расходы на материалы»: CRUD, append-only журнал
(дифф изменений), справочники категорий и источников оплаты, сводка по периоду,
вложения, RBAC. Требует DATABASE_URL.
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
    manager_client,
    warehouse_client,
)


@pytest.fixture
def dict_ids(admin_client):
    """Создаёт тестовую категорию и источник оплаты, по завершении чистит их
    вместе со всеми ссылающимися расходами/журналом/файлами."""
    tag = uuid.uuid4().hex[:8]
    cat = admin_client.post("/expenses/dict/categories", json={"name": f"TestCat-{tag}"}).json()["message"]
    src = admin_client.post("/expenses/dict/payment-sources", json={"name": f"TestSrc-{tag}"}).json()["message"]
    yield cat, src
    with get_connection() as conn:
        exp_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM material_expenses WHERE category_id = ? OR payment_source_id = ?",
                (cat, src),
            ).fetchall()
        ]
        for eid in exp_ids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (eid,))
            conn.execute("DELETE FROM expense_files WHERE expense_id = ?", (eid,))
            conn.execute("DELETE FROM expense_payments WHERE expense_id = ?", (eid,))
        conn.execute(
            "DELETE FROM material_expenses WHERE category_id = ? OR payment_source_id = ?",
            (cat, src),
        )
        conn.execute("DELETE FROM expense_categories WHERE id = ?", (cat,))
        conn.execute("DELETE FROM expense_payment_sources WHERE id = ?", (src,))
        conn.commit()


def _create_expense(client, cat, src, *, spent_on="2026-06-15", name="Перчатки нитрил",
                    quantity=5, unit="шт", amount=100000, supplier=None, comment=None) -> str:
    payload = {
        "spent_on": spent_on, "category_id": cat, "name": name, "quantity": quantity,
        "unit": unit, "amount": amount, "payment_source_id": src,
    }
    if supplier is not None:
        payload["supplier"] = supplier
    if comment is not None:
        payload["comment"] = comment
    r = client.post("/expenses", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["message"]


def test_dictionaries_seeded(admin_client):
    cats = {c["name"] for c in admin_client.get("/expenses/dict/categories").json()}
    srcs = {s["name"] for s in admin_client.get("/expenses/dict/payment-sources").json()}
    assert {"Склад", "Упаковка", "Уборка", "Туалет", "Прочее"} <= cats
    assert {"ИП Макс", "Саша", "Олег"} <= srcs


def test_create_lands_in_list_with_journal(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src, quantity=5, amount=100000, comment="июнь")

    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["exp_number"].startswith("EXP-")
    assert d["spent_on"] == "2026-06-15"
    assert d["quantity"] == 5.0
    assert d["amount"] == 100000          # копейки
    assert d["category_id"] == cat
    assert d["payment_source_id"] == src
    assert d["comment"] == "июнь"
    assert "create" in {o["op_type"] for o in d["ops"]}

    lst = admin_client.get("/expenses?limit=200").json()
    assert eid in {it["id"] for it in lst["items"]}


def test_fractional_quantity(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src, quantity=2.5, unit="л", name="Средство для пола")
    assert admin_client.get(f"/expenses/{eid}").json()["quantity"] == 2.5


def test_update_records_diff(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src, name="Перчатки", quantity=5, amount=100000)

    upd = admin_client.patch(f"/expenses/{eid}", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Перчатки нитрил",
        "quantity": 6, "unit": "шт", "amount": 120000, "payment_source_id": src,
    })
    assert upd.status_code == 200, upd.text

    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["amount"] == 120000
    assert d["quantity"] == 6.0
    updates = [o for o in d["ops"] if o["op_type"] == "update"]
    assert updates, "ожидалась запись update в журнале"
    comment = updates[-1]["comment"]
    assert "Сумма:" in comment and "Количество:" in comment and "Наименование:" in comment


def test_update_noop_writes_nothing(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src, name="Скотч", quantity=3, unit="шт", amount=30000)
    before = len(admin_client.get(f"/expenses/{eid}").json()["ops"])

    same = admin_client.patch(f"/expenses/{eid}", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Скотч",
        "quantity": 3, "unit": "шт", "amount": 30000, "payment_source_id": src,
    })
    assert same.status_code == 200, same.text
    after = len(admin_client.get(f"/expenses/{eid}").json()["ops"])
    assert after == before, "повтор без изменений не должен писать запись в журнал"


def test_delete_is_forbidden(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src)
    # Удаление расходов запрещено — записи реестра не удаляются (для снятия есть «Аннулировать»).
    assert admin_client.delete(f"/expenses/{eid}").status_code == 405

    assert admin_client.get(f"/expenses/{eid}").status_code == 200
    lst = admin_client.get("/expenses?limit=200").json()
    assert eid in {it["id"] for it in lst["items"]}


def test_summary_aggregates(admin_client, dict_ids):
    cat, src = dict_ids
    _create_expense(admin_client, cat, src, amount=100000)
    _create_expense(admin_client, cat, src, amount=50000)

    s = admin_client.get(f"/expenses/summary?category_id={cat}").json()
    assert s["total_amount"] == 150000
    assert s["total_count"] == 2
    cat_row = next(b for b in s["by_category"] if b["id"] == cat)
    assert cat_row["amount"] == 150000 and cat_row["count"] == 2
    assert any(b["id"] == src and b["amount"] == 150000 for b in s["by_payment_source"])


def test_period_filter(admin_client, dict_ids):
    cat, src = dict_ids
    early = _create_expense(admin_client, cat, src, spent_on="2026-05-01", amount=11111)
    late = _create_expense(admin_client, cat, src, spent_on="2026-06-20", amount=22222)

    ids = {it["id"] for it in admin_client.get(
        f"/expenses?date_from=2026-06-01&date_to=2026-06-30&limit=200"
    ).json()["items"]}
    assert late in ids and early not in ids


def test_validation_rejects_bad_input(admin_client, dict_ids):
    cat, src = dict_ids
    # Нулевая сумма / количество — отсекается схемой (422).
    assert admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "x",
        "quantity": 0, "unit": "шт", "amount": 100, "payment_source_id": src,
    }).status_code == 422
    assert admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "x",
        "quantity": 1, "unit": "шт", "amount": 0, "payment_source_id": src,
    }).status_code == 422
    # Несуществующая категория — 400.
    bad_cat = admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": "no-such", "name": "x",
        "quantity": 1, "unit": "шт", "amount": 100, "payment_source_id": src,
    })
    assert bad_cat.status_code == 400 and "категори" in bad_cat.json()["detail"].lower()
    # Кривая дата — 400.
    bad_date = admin_client.post("/expenses", json={
        "spent_on": "15.06.2026", "category_id": cat, "name": "x",
        "quantity": 1, "unit": "шт", "amount": 100, "payment_source_id": src,
    })
    assert bad_date.status_code == 400


def test_dict_unique_name(admin_client):
    name = f"Дубликат-{uuid.uuid4().hex[:8]}"
    first = admin_client.post("/expenses/dict/categories", json={"name": name})
    assert first.status_code == 200, first.text
    dup = admin_client.post("/expenses/dict/categories", json={"name": name})
    assert dup.status_code == 400 and "уже есть" in dup.json()["detail"]
    with get_connection() as conn:
        conn.execute("DELETE FROM expense_categories WHERE id = ?", (first.json()["message"],))
        conn.commit()


def test_file_upload_and_delete(admin_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(admin_client, cat, src)

    bad = admin_client.post(f"/expenses/{eid}/files", files={"file": ("notes.txt", b"hi", "text/plain")})
    assert bad.status_code == 400, bad.text

    png = ("receipt.png", b"\x89PNG\r\n\x1a\n", "image/png")
    ok = admin_client.post(f"/expenses/{eid}/files", files={"file": png})
    assert ok.status_code == 200, ok.text
    file_id = ok.json()["message"]

    d = admin_client.get(f"/expenses/{eid}").json()
    assert [f["filename"] for f in d["files"]] == ["receipt.png"]
    assert d["file_count"] == 1
    assert "file_add" in {o["op_type"] for o in d["ops"]}

    rm = admin_client.delete(f"/expenses/{eid}/files/{file_id}")
    assert rm.status_code == 200, rm.text
    assert admin_client.get(f"/expenses/{eid}").json()["files"] == []


def test_rbac_forbids_warehouse(warehouse_client, dict_ids):
    cat, src = dict_ids
    assert warehouse_client.get("/expenses").status_code == 403
    assert warehouse_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "x",
        "quantity": 1, "unit": "шт", "amount": 100, "payment_source_id": src,
    }).status_code == 403


def test_payment_lifecycle(admin_client, dict_ids):
    cat, src = dict_ids
    # «Ожидает оплаты» — без источника оплаты (ещё не платили).
    eid = admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Счёт к оплате",
        "quantity": 1, "unit": "шт", "amount": 300000, "payment_status": "awaiting",
    }).json()["message"]
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "awaiting" and d["paid_on"] is None

    pay = admin_client.post(f"/expenses/{eid}/pay",
                            json={"payment_source_id": src, "paid_on": "2026-06-16"})
    assert pay.status_code == 200, pay.text
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "paid" and d["paid_on"] == "2026-06-16"
    assert d["payment_source_id"] == src
    assert d["paid_amount"] == 300000
    assert "payment" in {o["op_type"] for o in d["ops"]}

    # Повторная оплата запрещена.
    assert admin_client.post(f"/expenses/{eid}/pay", json={}).status_code == 400

    # Ошибочную оплату можно откатить: «оплачено» → «ожидает», дата оплаты снимается.
    unpay = admin_client.post(f"/expenses/{eid}/unpay")
    assert unpay.status_code == 200, unpay.text
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "awaiting" and d["paid_on"] is None
    assert "unpay" in {o["op_type"] for o in d["ops"]}
    # Откатывать можно только оплаченный расход.
    assert admin_client.post(f"/expenses/{eid}/unpay").status_code == 400

    # Ожидающее обязательство можно отменить; отменённое — нельзя оплатить.
    eid2 = admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Отменяемое",
        "quantity": 1, "unit": "шт", "amount": 100000, "payment_status": "awaiting",
    }).json()["message"]
    assert admin_client.post(f"/expenses/{eid2}/cancel").status_code == 200
    assert admin_client.get(f"/expenses/{eid2}").json()["payment_status"] == "cancelled"
    assert admin_client.post(f"/expenses/{eid2}/pay",
                             json={"payment_source_id": src}).status_code == 400


def test_summary_awaiting_paid(admin_client, dict_ids):
    cat, src = dict_ids
    _create_expense(admin_client, cat, src, amount=100000)  # оплачено по умолчанию
    admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Ожидает",
        "quantity": 1, "unit": "шт", "amount": 40000, "payment_status": "awaiting",
    })
    s = admin_client.get(f"/expenses/summary?category_id={cat}").json()
    assert s["paid_amount"] == 100000
    assert s["awaiting_amount"] == 40000
    assert s["total_amount"] == 140000


def test_partial_payment_lifecycle(admin_client, dict_ids):
    cat, src = dict_ids
    eid = admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "Частичный",
        "quantity": 1, "unit": "шт", "amount": 300000, "payment_status": "awaiting",
    }).json()["message"]

    # Частичная оплата 100 000 из 300 000 → статус «частично оплачен».
    p1 = admin_client.post(f"/expenses/{eid}/pay", json={"payment_source_id": src, "amount": 100000})
    assert p1.status_code == 200, p1.text
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "partially_paid"
    assert d["paid_amount"] == 100000 and d["paid_on"] is None
    assert len(d["payments"]) == 1

    # Сводка: остаток в «Ожидает», проведённое — в «Оплачено».
    s = admin_client.get(f"/expenses/summary?category_id={cat}").json()
    assert s["paid_amount"] == 100000 and s["awaiting_amount"] == 200000

    # Переплата остатка запрещена.
    over = admin_client.post(f"/expenses/{eid}/pay", json={"payment_source_id": src, "amount": 250000})
    assert over.status_code == 400 and "превышает остаток" in over.json()["detail"]

    # Догашение без указания суммы → весь остаток, статус «оплачено».
    p2 = admin_client.post(f"/expenses/{eid}/pay", json={"payment_source_id": src})
    assert p2.status_code == 200, p2.text
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "paid" and d["paid_amount"] == 300000
    assert len(d["payments"]) == 2

    # Откат снимает все платежи → снова «ожидает оплаты».
    assert admin_client.post(f"/expenses/{eid}/unpay").status_code == 200
    d = admin_client.get(f"/expenses/{eid}").json()
    assert d["payment_status"] == "awaiting" and d["paid_amount"] == 0
    assert d["payments"] == []


@pytest.fixture
def carrier_logistics(admin_client):
    """Перевозчик + 3 логистических расхода (заводятся напрямую — API логистику не создаёт).
    Суммы 50/60/40 тыс. по возрастанию дат; чистит за собой."""
    src = admin_client.post("/expenses/dict/payment-sources",
                            json={"name": f"CarSrc-{uuid.uuid4().hex[:8]}"}).json()["message"]
    carrier_id = str(uuid.uuid4())
    exp_ids: list[str] = []
    plan = [("2026-06-01", 50000), ("2026-06-05", 60000), ("2026-06-10", 40000)]
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO carriers (id, name, is_active, is_deleted, created_at) VALUES (?,?,1,0,NOW())",
            (carrier_id, f"Перевозчик-{uuid.uuid4().hex[:6]}"),
        )
        for i, (day, amount) in enumerate(plan):
            eid = str(uuid.uuid4())
            exp_ids.append(eid)
            conn.execute(
                "INSERT INTO material_expenses "
                "(id,exp_number,spent_on,name,quantity,amount,paid_amount,kind,payment_status,"
                " carrier_id,source_kind,source_id,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
                (eid, f"EXP-CT{uuid.uuid4().hex[:6]}", day, f"Логистика {i}", 1, amount, 0,
                 "logistics", "awaiting", carrier_id, "trip", str(uuid.uuid4())),
            )
        conn.commit()
    yield carrier_id, src, exp_ids
    with get_connection() as conn:
        for eid in exp_ids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (eid,))
            conn.execute("DELETE FROM expense_payments WHERE expense_id = ?", (eid,))
        ph = ",".join("?" for _ in exp_ids)
        conn.execute(f"DELETE FROM material_expenses WHERE id IN ({ph})", exp_ids)
        conn.execute("DELETE FROM carriers WHERE id = ?", (carrier_id,))
        conn.execute("DELETE FROM expense_payment_sources WHERE id = ?", (src,))
        conn.commit()


def test_carrier_outstanding_and_fifo(admin_client, carrier_logistics):
    carrier_id, src, exp_ids = carrier_logistics

    # Долг перевозчика — сумма остатков (150 000), 3 расхода.
    out = admin_client.get("/expenses/carriers/outstanding").json()
    mine = next(c for c in out if c["carrier_id"] == carrier_id)
    assert mine["outstanding_amount"] == 150000 and mine["count"] == 3

    # Переплата свыше долга запрещена.
    over = admin_client.post("/expenses/pay-carrier", json={
        "carrier_id": carrier_id, "amount": 150001, "payment_source_id": src,
    })
    assert over.status_code == 400 and "долг" in over.json()["detail"].lower()

    # 50 000 → закрывает самый ранний расход целиком.
    r1 = admin_client.post("/expenses/pay-carrier", json={
        "carrier_id": carrier_id, "amount": 50000, "payment_source_id": src, "paid_on": "2026-06-20",
    }).json()
    assert r1["affected_count"] == 1 and r1["fully_paid_count"] == 1 and r1["allocated_amount"] == 50000

    # 70 000 → второй (60 000) целиком + 10 000 в третий (частично).
    r2 = admin_client.post("/expenses/pay-carrier", json={
        "carrier_id": carrier_id, "amount": 70000, "payment_source_id": src,
    }).json()
    assert r2["affected_count"] == 2 and r2["fully_paid_count"] == 1 and r2["partially_paid_count"] == 1

    states = {e["id"]: e for e in admin_client.get("/expenses?kind=logistics&limit=200").json()["items"]}
    assert states[exp_ids[0]]["payment_status"] == "paid"
    assert states[exp_ids[1]]["payment_status"] == "paid"
    assert states[exp_ids[2]]["payment_status"] == "partially_paid"
    assert states[exp_ids[2]]["paid_amount"] == 10000

    # Остаток долга — 30 000.
    out2 = admin_client.get("/expenses/carriers/outstanding").json()
    assert next(c for c in out2 if c["carrier_id"] == carrier_id)["outstanding_amount"] == 30000


def test_analytics_daily_series_and_kinds(admin_client, dict_ids):
    cat, src = dict_ids
    # Дальние даты 2099 — изоляция от прочих данных общей тестовой БД.
    _create_expense(admin_client, cat, src, spent_on="2099-06-10", amount=100000)
    _create_expense(admin_client, cat, src, spent_on="2099-06-12", amount=40000)

    a = admin_client.get("/expenses/analytics?date_from=2099-06-10&date_to=2099-06-12&kinds=manual").json()
    assert a["days"] == 3
    by_day = {p["date"]: p["amount"] for p in a["series"]}
    assert by_day["2099-06-10"] == 100000
    assert by_day["2099-06-11"] == 0
    assert by_day["2099-06-12"] == 40000
    assert a["total_amount"] == 140000
    assert a["max_day_amount"] == 100000
    manual = next(k for k in a["by_kind"] if k["kind"] == "manual")
    assert manual["amount"] == 140000 and manual["count"] == 2
    by_cat = next(c for c in a["by_category"] if c["id"] == cat)
    assert by_cat["amount"] == 140000 and by_cat["count"] == 2  # распределение по категории
    paid = next(s for s in a["by_status"] if s["payment_status"] == "paid")
    assert paid["amount"] == 140000  # оба расхода оплачены по умолчанию


def test_analytics_category_matrix(admin_client, dict_ids):
    # Матрица «категория × день»: серия категории выровнена с series по дням,
    # сумма категорий по каждому дню сходится с дневным итогом.
    cat, src = dict_ids
    _create_expense(admin_client, cat, src, spent_on="2099-09-10", amount=100000)
    _create_expense(admin_client, cat, src, spent_on="2099-09-12", amount=40000)

    a = admin_client.get("/expenses/analytics?date_from=2099-09-10&date_to=2099-09-12&kinds=manual").json()
    assert len(a["series"]) == 3
    row = next(c for c in a["categories"] if c["id"] == cat)
    assert row["series"] == [100000, 0, 40000]
    assert row["kind"] == "manual"
    day_from_cats = [sum(c["series"][i] for c in a["categories"]) for i in range(len(a["series"]))]
    assert day_from_cats == [p["amount"] for p in a["series"]]


def test_analytics_excludes_cancelled(admin_client, dict_ids):
    # Аннулированный расход не входит ни в один срез отчёта.
    cat, src = dict_ids
    keep = _create_expense(admin_client, cat, src, spent_on="2099-08-10", amount=70000)
    drop = admin_client.post("/expenses", json={
        "spent_on": "2099-08-10", "category_id": cat, "name": "Отменённый",
        "quantity": 1, "unit": "шт", "amount": 50000, "kind": "manual", "payment_status": "awaiting",
    }).json()["message"]
    assert admin_client.post(f"/expenses/{drop}/cancel").status_code == 200
    _ = keep

    a = admin_client.get("/expenses/analytics?date_from=2099-08-01&date_to=2099-08-31&kinds=manual").json()
    assert a["total_amount"] == 70000  # только не-аннулированный
    assert all(s["payment_status"] != "cancelled" for s in a["by_status"])  # аннулированных нет
    by_cat = next(c for c in a["by_category"] if c["id"] == cat)
    assert by_cat["amount"] == 70000
    # by_category в сумме сходится с total.
    assert sum(c["amount"] for c in a["by_category"]) == a["total_amount"]


def test_analytics_spreads_rent_over_period(admin_client):
    # Аренда за месяц размазывается ровно по дням периода (а не пиком в день начисления).
    rent_id = admin_client.post("/expenses", json={
        "spent_on": "2099-04-01", "name": "Аренда тест", "amount": 300000,
        "kind": "rent", "payment_status": "awaiting",
        "period_start": "2099-04-01", "period_end": "2099-04-30",
    }).json()["message"]
    try:
        a = admin_client.get("/expenses/analytics?date_from=2099-04-01&date_to=2099-04-30&kinds=rent").json()
        assert a["total_amount"] == 300000  # вся сумма внутри окна
        by_day = {p["date"]: p["amount"] for p in a["series"]}
        assert by_day["2099-04-15"] == 10000  # 300000 / 30 дней
        rent = next(k for k in a["by_kind"] if k["kind"] == "rent")
        assert rent["amount"] == 300000 and rent["count"] == 1
        # Частичное окно (первые 10 дней) — учитывается только попавшая доля.
        half = admin_client.get("/expenses/analytics?date_from=2099-04-01&date_to=2099-04-10&kinds=rent").json()
        assert half["total_amount"] == 100000
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (rent_id,))
            conn.execute("DELETE FROM material_expenses WHERE id = ?", (rent_id,))
            conn.commit()


def test_analytics_manager_sees_admin_kinds(admin_client, manager_client):
    # Аналитика расходов НЕ скрывает типы от менеджера: аренду заводит админ,
    # но в дневной динамике/разбивке менеджер видит её наравне с админом.
    rent_id = admin_client.post("/expenses", json={
        "spent_on": "2099-11-01", "name": "Аренда тест видимости", "amount": 300000,
        "kind": "rent", "payment_status": "awaiting",
        "period_start": "2099-11-01", "period_end": "2099-11-30",
    }).json()["message"]
    try:
        # Явный запрос админского типа менеджером больше не запрещён.
        resp = manager_client.get(
            "/expenses/analytics?date_from=2099-11-01&date_to=2099-11-30&kinds=rent"
        )
        assert resp.status_code == 200
        rent = next(k for k in resp.json()["by_kind"] if k["kind"] == "rent")
        assert rent["amount"] == 300000
        # Без явных типов аренда тоже попадает в разбивку менеджера.
        a = manager_client.get("/expenses/analytics?date_from=2099-11-01&date_to=2099-11-30").json()
        assert any(k["kind"] == "rent" for k in a["by_kind"])
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM expense_ops WHERE expense_id = ?", (rent_id,))
            conn.execute("DELETE FROM material_expenses WHERE id = ?", (rent_id,))
            conn.commit()


def test_analytics_rbac_forbids_warehouse(warehouse_client):
    assert warehouse_client.get(
        "/expenses/analytics?date_from=2099-04-01&date_to=2099-04-02"
    ).status_code == 403


def test_summary_excludes_cancelled(admin_client, dict_ids):
    cat, src = dict_ids
    _create_expense(admin_client, cat, src, amount=100000)  # оплачено
    cancel_id = admin_client.post("/expenses", json={
        "spent_on": "2026-06-15", "category_id": cat, "name": "К аннулированию",
        "quantity": 1, "unit": "шт", "amount": 70000,
        "payment_status": "awaiting", "payment_source_id": src,
    }).json()["message"]
    assert admin_client.post(f"/expenses/{cancel_id}/cancel").status_code == 200

    s = admin_client.get(f"/expenses/summary?category_id={cat}").json()
    # Аннулированный (70000) выпадает из «Итого» и разбивок; «Итого» = «Ожидает» + «Оплачено».
    assert s["total_amount"] == 100000
    assert s["awaiting_amount"] == 0
    assert s["paid_amount"] == 100000
    assert s["total_amount"] == s["awaiting_amount"] + s["paid_amount"]
    cat_row = next(b for b in s["by_category"] if b["id"] == cat)
    assert cat_row["amount"] == 100000
    src_row = next(b for b in s["by_payment_source"] if b["id"] == src)
    assert src_row["amount"] == 100000

    # Но в списке аннулированный остаётся виден и фильтруется по статусу.
    cancelled = admin_client.get(
        f"/expenses?category_id={cat}&payment_status=cancelled&limit=200"
    ).json()["items"]
    assert any(it["id"] == cancel_id for it in cancelled)


def test_admin_only_kinds_hidden_from_manager(admin_client, manager_client, dict_ids):
    cat, src = dict_ids
    rent = {
        "spent_on": "2026-06-15", "name": "Аренда июнь", "amount": 5000000,
        "category_id": cat, "payment_source_id": src, "kind": "rent",
    }
    # Менеджер не может завести аренду; админ — может.
    assert manager_client.post("/expenses", json=rent).status_code == 403
    rid = admin_client.post("/expenses", json=rent).json()["message"]

    # Менеджер не видит аренду: явный фильтр 403, общий список — без неё, прямой id — 404.
    assert manager_client.get("/expenses?kind=rent").status_code == 403
    mids = {it["id"] for it in manager_client.get("/expenses?limit=200").json()["items"]}
    assert rid not in mids
    assert manager_client.get(f"/expenses/{rid}").status_code == 404
    assert manager_client.post(f"/expenses/{rid}/pay", json={}).status_code == 404

    # Админ аренду видит.
    aids = {it["id"] for it in admin_client.get("/expenses?kind=rent&limit=200").json()["items"]}
    assert rid in aids


def test_rent_edit_does_not_require_manual_fields(admin_client, dict_ids):
    cat, src = dict_ids
    rid = admin_client.post("/expenses", json={
        "spent_on": "2026-06-01", "name": "Аренда июнь", "amount": 5000000,
        "kind": "rent", "payment_status": "awaiting", "category_id": cat,
        "period_start": "2026-06-01", "period_end": "2026-06-30",
    }).json()["message"]
    d = admin_client.get(f"/expenses/{rid}").json()
    assert d["kind"] == "rent" and d["payment_status"] == "awaiting"
    assert d["period_start"] == "2026-06-01" and d["unit"] is None

    # Правка без ед.изм./источника (поля хозрасхода) проходит.
    upd = admin_client.patch(f"/expenses/{rid}", json={
        "spent_on": "2026-06-01", "name": "Аренда июнь", "amount": 5200000,
        "category_id": cat, "period_start": "2026-06-01", "period_end": "2026-07-31",
    })
    assert upd.status_code == 200, upd.text
    d2 = admin_client.get(f"/expenses/{rid}").json()
    assert d2["amount"] == 5200000 and d2["period_end"] == "2026-07-31"

    # Оплачиваем «фикс» с указанием карты.
    pay = admin_client.post(f"/expenses/{rid}/pay", json={"payment_source_id": src})
    assert pay.status_code == 200, pay.text
    assert admin_client.get(f"/expenses/{rid}").json()["payment_status"] == "paid"


def test_salary_accruals_monthly_idempotent(admin_client, manager_client):
    tag = uuid.uuid4().hex[:8]
    emp = admin_client.post("/employees", json={
        "full_name": f"Оклад-{tag}", "comp_type": "fixed", "fixed_salary_kopecks": 100000,
        "hired_on": "2026-06-01",
    })
    assert emp.status_code == 200, emp.text
    emp_id = emp.json()["message"]
    try:
        # Менеджер не может запускать начисление (admin-only).
        assert manager_client.post("/expenses/salary/accruals/run?on_date=2026-06-01").status_code == 403

        # 1-е число → одна проводка на весь июнь, полный оклад, «ожидает оплаты».
        r1 = admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-01")
        assert r1.status_code == 200, r1.text
        assert r1.json()["created"] >= 1

        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == emp_id and e["period_start"] == "2026-06-01"]
        assert len(mine) == 1
        assert mine[0]["payment_status"] == "awaiting"
        assert mine[0]["amount"] == 100000              # полный месяц = оклад
        assert mine[0]["period_end"] == "2026-06-30"

        # Любой повтор в том же месяце — без дублей (одна проводка на месяц).
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-01").json()["created"] == 0
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-15").json()["created"] == 0
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-30").json()["created"] == 0
        again = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        assert len([e for e in again if e.get("source_id") == emp_id and e["period_start"] == "2026-06-01"]) == 1
    finally:
        with get_connection() as conn:
            ids = [r["id"] for r in conn.execute(
                "SELECT id FROM material_expenses WHERE source_kind='employee' AND source_id=?",
                (emp_id,),
            ).fetchall()]
            for eid in ids:
                conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
            conn.execute("DELETE FROM material_expenses WHERE source_kind='employee' AND source_id=?", (emp_id,))
            conn.execute("DELETE FROM employee_rates WHERE employee_id=?", (emp_id,))
            conn.execute("DELETE FROM employee_salaries WHERE employee_id=?", (emp_id,))
            conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))
            conn.commit()


def test_salary_effective_dated_accrual_and_history(admin_client):
    tag = uuid.uuid4().hex[:8]
    # Оклад 150 000 ₽ с серединой месяца (27.06) → начисление пропорционально рабочим дням
    # от даты начала оклада, а не за весь месяц.
    emp = admin_client.post("/employees", json={
        "full_name": f"Окл2-{tag}", "comp_type": "fixed",
        "fixed_salary_kopecks": 15000000, "salary_from": "2026-06-27",
    })
    assert emp.status_code == 200, emp.text
    emp_id = emp.json()["message"]
    try:
        # Стартовый оклад лёг одной записью истории с датой начала 27.06.
        detail = admin_client.get(f"/employees/{emp_id}").json()
        assert len(detail["salary_history"]) == 1
        assert detail["salary_history"][0]["effective_from"] == "2026-06-27"
        assert detail["salary_history"][0]["salary_kopecks"] == 15000000
        wrong_id = detail["salary_history"][0]["id"]

        # Начисление за июнь = доля за рабочие дни с 27.06 (3 рабочих дня из 26) = 1 730 769 коп.
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-30").status_code == 200
        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == emp_id and e["period_start"] == "2026-06-01"]
        assert len(mine) == 1
        assert mine[0]["amount"] == 1730769

        # Исправление даты начала оклада: добавляем запись с 01.06, удаляем ошибочную с 27.06.
        assert admin_client.post(f"/employees/{emp_id}/salaries", json={
            "salary_kopecks": 15000000, "effective_from": "2026-06-01",
        }).status_code == 200
        assert admin_client.delete(f"/employees/{emp_id}/salaries/{wrong_id}").status_code == 200
        assert admin_client.delete(f"/employees/{emp_id}/salaries/{wrong_id}").status_code == 404

        d2 = admin_client.get(f"/employees/{emp_id}").json()
        assert len(d2["salary_history"]) == 1
        assert d2["salary_history"][0]["effective_from"] == "2026-06-01"
        assert d2["fixed_salary_kopecks"] == 15000000   # кэш «оклад на сегодня» пересчитан

        # Свежий окладник с датой начала 01.06 → полный месяц = оклад (1-е число).
        emp2 = admin_client.post("/employees", json={
            "full_name": f"Окл3-{tag}", "comp_type": "fixed",
            "fixed_salary_kopecks": 15000000, "salary_from": "2026-06-01",
        }).json()["message"]
        try:
            assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-01").status_code == 200
            it2 = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
            full = [e for e in it2 if e.get("source_id") == emp2 and e["period_start"] == "2026-06-01"]
            assert len(full) == 1
            assert full[0]["amount"] == 15000000
        finally:
            _purge_employee(emp2)
    finally:
        _purge_employee(emp_id)


def test_salary_reaccrual_after_cancel(admin_client):
    tag = uuid.uuid4().hex[:8]
    # Сценарий пользователя: начислили оклад, аннулировали проводку, начисляем заново —
    # отменённая проводка НЕ должна блокировать повторное начисление (дедуп игнорит cancelled).
    emp = admin_client.post("/employees", json={
        "full_name": f"Окл4-{tag}", "comp_type": "fixed",
        "fixed_salary_kopecks": 15000000, "salary_from": "2031-03-01",
    }).json()["message"]
    try:
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2031-03-01").status_code == 200
        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == emp and e["period_start"] == "2031-03-01"]
        assert len(mine) == 1
        exp_id = mine[0]["id"]

        # Повтор без отмены — дубля нет.
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2031-03-10").json()["created"] == 0

        # Аннулируем и начисляем заново → появляется свежая проводка.
        assert admin_client.post(f"/expenses/{exp_id}/cancel").status_code == 200
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2031-03-10").json()["created"] == 1
        again = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        rows = [e for e in again if e.get("source_id") == emp and e["period_start"] == "2031-03-01"]
        assert len(rows) == 2  # одно аннулированное + одно новое
        assert sorted(e["payment_status"] for e in rows) == ["awaiting", "cancelled"]
    finally:
        _purge_employee(emp)


def _purge_employee(emp_id: str) -> None:
    with get_connection() as conn:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM material_expenses WHERE source_kind='employee' AND source_id=?",
            (emp_id,),
        ).fetchall()]
        for eid in ids:
            conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
        conn.execute("DELETE FROM material_expenses WHERE source_kind='employee' AND source_id=?", (emp_id,))
        conn.execute("DELETE FROM employee_rates WHERE employee_id=?", (emp_id,))
        conn.execute("DELETE FROM employee_salaries WHERE employee_id=?", (emp_id,))
        conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))
        conn.commit()


def test_rent_accruals_per_warehouse_idempotent(admin_client, manager_client):
    tag = uuid.uuid4().hex[:8]
    # Два наших склада со ставкой + один без аренды + один архивный со ставкой.
    assert admin_client.post("/own-warehouses", json={
        "name": f"СкладA-{tag}", "is_active": True, "rent_monthly_kopecks": 12000000,
    }).status_code == 200
    assert admin_client.post("/own-warehouses", json={
        "name": f"СкладB-{tag}", "is_active": True, "rent_monthly_kopecks": 8000000,
    }).status_code == 200
    assert admin_client.post("/own-warehouses", json={
        "name": f"СкладNoRent-{tag}", "is_active": True,
    }).status_code == 200
    assert admin_client.post("/own-warehouses", json={
        "name": f"СкладArch-{tag}", "is_active": False, "rent_monthly_kopecks": 5000000,
    }).status_code == 200

    with get_connection() as conn:
        ids = {r["name"]: str(r["id"]) for r in conn.execute(
            "SELECT id, name FROM own_warehouses WHERE name LIKE ?", (f"%-{tag}",)
        ).fetchall()}
    a_id, b_id = ids[f"СкладA-{tag}"], ids[f"СкладB-{tag}"]
    no_rent_id, arch_id = ids[f"СкладNoRent-{tag}"], ids[f"СкладArch-{tag}"]
    try:
        # Ставка round-trip через карточку нашего склада.
        wh = admin_client.get(f"/own-warehouses/{a_id}").json()
        assert wh["rent_monthly_kopecks"] == 12000000
        # Менеджер не видит справочник наших складов (admin-only).
        assert manager_client.get("/own-warehouses").status_code == 403

        # Менеджер не может запускать начисление аренды (admin-only).
        assert manager_client.post("/expenses/rent/accruals/run?on_date=2026-06-01").status_code == 403

        r1 = admin_client.post("/expenses/rent/accruals/run?on_date=2026-06-01")
        assert r1.status_code == 200, r1.text
        assert r1.json()["created"] >= 2
        # Повтор того же месяца — без дублей.
        assert admin_client.post("/expenses/rent/accruals/run?on_date=2026-06-15").json()["created"] == 0

        items = admin_client.get("/expenses?kind=rent&limit=200").json()["items"]
        by_src = {e["source_id"]: e for e in items if e["period_start"] == "2026-06-01"}
        assert by_src[a_id]["amount"] == 12000000
        assert by_src[a_id]["payment_status"] == "awaiting"
        assert by_src[a_id]["period_end"] == "2026-06-30"
        assert by_src[b_id]["amount"] == 8000000
        # Склад без аренды и архивный — записей нет.
        assert no_rent_id not in by_src and arch_id not in by_src
    finally:
        with get_connection() as conn:
            wids = list(ids.values())
            ph = ",".join("?" for _ in wids)
            eids = [r["id"] for r in conn.execute(
                f"SELECT id FROM material_expenses WHERE source_kind='warehouse' AND source_id IN ({ph})",
                wids,
            ).fetchall()]
            for eid in eids:
                conn.execute("DELETE FROM expense_ops WHERE expense_id=?", (eid,))
            conn.execute(
                f"DELETE FROM material_expenses WHERE source_kind='warehouse' AND source_id IN ({ph})",
                wids,
            )
            conn.execute(f"DELETE FROM own_warehouses WHERE id IN ({ph})", wids)
            conn.commit()


def test_manager_sees_manual_expenses(admin_client, manager_client, dict_ids):
    cat, src = dict_ids
    eid = _create_expense(manager_client, cat, src, name="Хозрасход менеджера")
    mids = {it["id"] for it in manager_client.get("/expenses?limit=200").json()["items"]}
    assert eid in mids
    assert manager_client.get(f"/expenses/{eid}").status_code == 200
