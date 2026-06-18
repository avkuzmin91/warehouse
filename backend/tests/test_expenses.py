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
    assert "pay" in {o["op_type"] for o in d["ops"]}

    # Повторная оплата запрещена.
    assert admin_client.post(f"/expenses/{eid}/pay", json={}).status_code == 400

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


def test_salary_accruals_halves_idempotent(admin_client, manager_client):
    tag = uuid.uuid4().hex[:8]
    emp = admin_client.post("/employees", json={
        "full_name": f"Оклад-{tag}", "comp_type": "fixed", "fixed_salary_kopecks": 100000,
    })
    assert emp.status_code == 200, emp.text
    emp_id = emp.json()["message"]
    try:
        # Менеджер не может запускать начисление (admin-only).
        assert manager_client.post("/expenses/salary/accruals/run?on_date=2026-06-15").status_code == 403

        # 15-е число → первая половина оклада, «ожидает оплаты».
        r1 = admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-15")
        assert r1.status_code == 200, r1.text
        assert r1.json()["created"] >= 1
        # Повтор той же даты — без дублей.
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-15").json()["created"] == 0

        items = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine = [e for e in items if e.get("source_id") == emp_id and e["period_start"] == "2026-06-01"]
        assert len(mine) == 1
        assert mine[0]["payment_status"] == "awaiting"
        assert mine[0]["amount"] == 50000               # 1/2 от 1000 ₽

        # Последний день месяца (июнь → 30-е) → вторая половина.
        admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-30")
        items2 = admin_client.get("/expenses?kind=salary&limit=200").json()["items"]
        mine2 = [e for e in items2 if e.get("source_id") == emp_id and e["period_start"] == "2026-06-16"]
        assert len(mine2) == 1 and mine2[0]["amount"] == 50000

        # Прочие даты (в т.ч. 1-е) — ничего не начисляется.
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-01").json()["created"] == 0
        assert admin_client.post("/expenses/salary/accruals/run?on_date=2026-06-10").json()["created"] == 0
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
