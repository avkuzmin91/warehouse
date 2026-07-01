"""Финрезультат «доходы vs расходы» (P&L) — сборка дохода по дням и сравнение с расходом.

Доход = упаковка (годное/брак) + логистика клиента + палеты. Расход переиспользует
`expenses.service.expense_analytics` (ЗП/аренда размазаны по дням, см. там).

Атрибуция по дням:
  • упаковка — по `packed_date` (день перемещения в упаковку), из `packing_productivity`;
  • логистика и палеты — по ФАКТИЧЕСКОМУ дню рейса `trip_docs.arrived_at`, по документам,
    привязанным к рейсу. Рейсы со статусом cancelled и без факта прибытия не учитываются.

Документ, привязанный к нескольким рейсам (дробление), относим к самому раннему его рейсу
в окне — чтобы стоимость логистики/палет документа не задвоилась. Деньги — копейки INTEGER.
"""

from __future__ import annotations

from datetime import date, timedelta

from config import INV_Q_DEFECT, INV_Q_GOOD, TRIP_STATUS_CANCELLED


def _days_axis(date_from: str, date_to: str) -> list[str]:
    df = date.fromisoformat(date_from[:10])
    dt = date.fromisoformat(date_to[:10])
    if dt < df:
        df, dt = dt, df
    out: list[str] = []
    d = df
    while d <= dt:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _logistics_income_rows(
    connection, *, date_from: str, date_to: str, client_id: str | None,
) -> list[dict]:
    """Строки дохода логистики: по одной на документ (день факта рейса, клиент, копейки).

    Берётся из `*.logistics_cost` (рубли) отгрузок и поступлений, привязанных к рейсу,
    по дню `arrived_at` рейса. Документ относим к самому раннему рейсу в окне. Разрез по
    клиенту нужен для «По клиентам»; агрегация по дням — на стороне вызывающего."""
    from modules.invoices.service import rub_to_kop

    out: list[dict] = []
    for table, link_col in (("dispatch_docs", "dispatch_doc_id"), ("receipt_docs", "receipt_doc_id")):
        conds = [
            "COALESCE(d.is_deleted, 0) = 0",
            "t.is_deleted = 0",
            "tl.is_deleted = 0",
            "t.status != ?",
            "t.arrived_at IS NOT NULL",
            "SUBSTR(t.arrived_at, 1, 10) >= ?",
            "SUBSTR(t.arrived_at, 1, 10) <= ?",
        ]
        params: list = [TRIP_STATUS_CANCELLED, date_from, date_to]
        if client_id and client_id.strip():
            conds.append("d.client_id = ?")
            params.append(client_id.strip())
        where = " AND ".join(conds)
        rows = connection.execute(
            f"""
            SELECT d.id AS doc_id, d.client_id AS client_id,
                   MIN(cl.name) AS client_name,
                   MIN(SUBSTR(t.arrived_at, 1, 10)) AS day,
                   MAX(COALESCE(d.logistics_cost, 0)) AS logistics_cost
            FROM {table} d
            JOIN trip_lines tl ON tl.{link_col} = d.id
            JOIN trip_docs t ON t.id = tl.trip_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {where}
            GROUP BY d.id, d.client_id
            """,
            params,
        ).fetchall()
        for r in rows:
            kop = rub_to_kop(r["logistics_cost"])
            if kop:
                out.append({
                    "day": str(r["day"]), "client_id": r["client_id"],
                    "client_name": r["client_name"], "kop": kop,
                })
    return out


def _pallets_income_rows(
    connection, *, date_from: str, date_to: str, client_id: str | None,
) -> list[dict]:
    """Строки дохода от палет: по одной на документ (день факта рейса, клиент, копейки).

    Палеты привязанных к рейсу отгрузок × цена палета клиента (effective-dated) на день
    рейса. Документ относим к самому раннему рейсу в окне. Палеты без заведённой цены
    в доход не входят. Разрез по клиенту нужен для «По клиентам»."""
    from modules.pallet_pricing.service import pallet_price_for_event

    conds = [
        "COALESCE(d.is_deleted, 0) = 0",
        "t.is_deleted = 0",
        "tl.is_deleted = 0",
        "t.status != ?",
        "t.arrived_at IS NOT NULL",
        "SUBSTR(t.arrived_at, 1, 10) >= ?",
        "SUBSTR(t.arrived_at, 1, 10) <= ?",
    ]
    params: list = [TRIP_STATUS_CANCELLED, date_from, date_to]
    if client_id and client_id.strip():
        conds.append("d.client_id = ?")
        params.append(client_id.strip())
    where = " AND ".join(conds)
    rows = connection.execute(
        f"""
        SELECT d.id AS doc_id, d.client_id,
               MIN(cl.name) AS client_name,
               MIN(SUBSTR(t.arrived_at, 1, 10)) AS day,
               COALESCE((
                   SELECT SUM(COALESCE(sl.pallets_qty, 0)) FROM dispatch_lines sl
                   WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0
               ), 0) AS pallets
        FROM dispatch_docs d
        JOIN trip_lines tl ON tl.dispatch_doc_id = d.id
        JOIN trip_docs t ON t.id = tl.trip_id
        LEFT JOIN clients cl ON cl.id = d.client_id
        WHERE {where}
        GROUP BY d.id, d.client_id
        """,
        params,
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        pallets = int(r["pallets"] or 0)
        cid = r["client_id"]
        if pallets <= 0 or not cid:
            continue
        day = str(r["day"])
        price = pallet_price_for_event(connection, str(cid), day)
        if price:
            out.append({
                "day": day, "client_id": cid,
                "client_name": r["client_name"], "kop": price * pallets,
            })
    return out


def _income_by_source(connection, *, axis: list[str], client_id: str | None) -> dict:
    """Общий расчёт дохода за окно `axis` (единый источник для P&L и аналитики «Доходы»).

    Доход = упаковка (годное/брак) по `packed_date` + логистика клиента + палеты по
    ФАКТ-дню рейса. Возвращает потоки с посуточными рядами, итоговый ряд/сумму и разрез
    по клиентам. Итог by_client сходится с income_total (те же слагаемые). Копейки INTEGER."""
    from modules.shipments.service import packing_productivity

    idx = {d: i for i, d in enumerate(axis)}
    n = len(axis)
    df, dt = axis[0], axis[-1]

    def _empty() -> list[int]:
        return [0] * n

    by_client: dict[str, dict] = {}

    def _add_client(cid, name: str | None, amount: int) -> None:
        if not amount:
            return
        key = str(cid) if cid else "__none"
        e = by_client.setdefault(
            key, {"id": (str(cid) if cid else None), "name": name or "Без клиента", "amount": 0}
        )
        if name and (e["name"] == "Без клиента"):
            e["name"] = name
        e["amount"] += amount

    packing_good = _empty()
    packing_defect = _empty()
    prod = packing_productivity(connection, date_from=df, date_to=dt, client_id=client_id, with_earnings=True)
    for day in prod.get("days", []):
        i = idx.get(str(day["packed_date"]))
        if i is None:
            continue
        packing_good[i] += int(day.get("good_earn_kop", 0) or 0)
        packing_defect[i] += int(day.get("defect_earn_kop", 0) or 0)
        for row in day.get("rows", []):
            _add_client(
                row.get("client_id"), row.get("client_name"),
                int(row.get("good_earn_kop", 0) or 0) + int(row.get("defect_earn_kop", 0) or 0),
            )

    logistics = _empty()
    for r in _logistics_income_rows(connection, date_from=df, date_to=dt, client_id=client_id):
        i = idx.get(r["day"])
        if i is not None:
            logistics[i] += r["kop"]
            _add_client(r["client_id"], r["client_name"], r["kop"])

    pallets = _empty()
    for r in _pallets_income_rows(connection, date_from=df, date_to=dt, client_id=client_id):
        i = idx.get(r["day"])
        if i is not None:
            pallets[i] += r["kop"]
            _add_client(r["client_id"], r["client_name"], r["kop"])

    income_defs = [
        ("packing_good", "Упаковка (годное)", INV_Q_GOOD, packing_good),
        ("packing_defect", "Упаковка (брак)", INV_Q_DEFECT, packing_defect),
        ("logistics", "Логистика", None, logistics),
        ("pallets", "Палеты", None, pallets),
    ]
    sources = [
        {"key": key, "label": label, "kind": kind, "amount": sum(series), "series": series}
        for key, label, kind, series in income_defs
        if sum(series) != 0
    ]
    sources.sort(key=lambda s: s["amount"], reverse=True)
    income_series = [sum(col) for col in zip(*[s["series"] for s in sources])] if sources else _empty()
    return {
        "sources": sources,
        "income_series": income_series,
        "income_total": sum(income_series),
        "by_client": by_client,
    }


def pnl_report(connection, *, date_from: str, date_to: str, client_id: str | None = None) -> dict:
    """Сводка «доходы vs расходы» по дням за [date_from..date_to] (вкл.).

    Возвращает дневные ряды дохода (по источникам) и расхода (по категориям), их итоги,
    нарастающий итог прибыли и маржу. Сравнение накопительное: KPI — суммы за период."""
    from modules.expenses.service import expense_analytics

    axis = _days_axis(date_from, date_to)
    df, dt = axis[0], axis[-1]
    n = len(axis)

    # ── Доход ──
    inc = _income_by_source(connection, axis=axis, client_id=client_id)
    income_sources = inc["sources"]
    income_series = inc["income_series"]
    income_total = inc["income_total"]

    # ── Расход (переиспользуем дневную аналитику расходов целиком) ──
    exp = expense_analytics(connection, date_from=df, date_to=dt, kinds=None)
    exp_by_date = {p["date"]: int(p["amount"]) for p in exp["series"]}
    expense_series = [exp_by_date.get(d, 0) for d in axis]
    expense_total = sum(expense_series)
    expense_categories = [
        {
            "key": c["name"], "label": c["name"], "kind": c.get("kind"),
            "amount": sum(int(v) for v in c["series"]),
            "series": [int(v) for v in c["series"]],
        }
        for c in exp.get("categories", [])
    ]

    # ── Итог ──
    net_cumulative: list[int] = []
    running = 0
    for i in range(n):
        running += income_series[i] - expense_series[i]
        net_cumulative.append(running)
    net_total = income_total - expense_total
    margin_pct = round(net_total / income_total * 100, 1) if income_total > 0 else 0.0

    return {
        "date_from": df,
        "date_to": dt,
        "days": n,
        "axis": axis,
        "income_total": income_total,
        "expense_total": expense_total,
        "net_total": net_total,
        "margin_pct": margin_pct,
        "income_series": income_series,
        "expense_series": expense_series,
        "net_cumulative": net_cumulative,
        "income_sources": income_sources,
        "expense_categories": expense_categories,
    }


def income_analytics(connection, *, date_from: str, date_to: str, client_id: str | None = None) -> dict:
    """Аналитика доходов за [date_from..date_to] (вкл.) — зеркало аналитики расходов:
      • series    — доход по дням (непрерывная шкала с нулями),
      • sources   — потоки дохода (упаковка годное/брак, логистика, палеты) с посуточными рядами,
      • by_client — распределение дохода по клиентам за период.

    Доход считается тем же `_income_by_source`, что и в P&L, поэтому `total_amount` копейка-в-копейку
    совпадает с `pnl_report.income_total` в том же окне. Копейки INTEGER."""
    axis = _days_axis(date_from, date_to)
    df, dt = axis[0], axis[-1]
    n = len(axis)

    inc = _income_by_source(connection, axis=axis, client_id=client_id)
    series = inc["income_series"]
    total = inc["income_total"]

    by_client = sorted(
        [
            {"id": v["id"], "name": v["name"], "amount": v["amount"]}
            for v in inc["by_client"].values()
            if v["amount"] != 0
        ],
        key=lambda x: x["amount"],
        reverse=True,
    )

    return {
        "date_from": df,
        "date_to": dt,
        "days": n,
        "total_amount": total,
        "avg_per_day": round(total / n) if n else 0,
        "max_day_amount": max(series) if series else 0,
        "series": [{"date": d, "amount": series[i]} for i, d in enumerate(axis)],
        "sources": [
            {"key": s["key"], "name": s["label"], "kind": s["kind"], "series": s["series"]}
            for s in inc["sources"]
        ],
        "by_client": by_client,
    }


def pnl_day_detail(
    connection, *, day: str, date_from: str, date_to: str,
    client_id: str | None, can_view_salary: bool,
) -> dict:
    """Детализация одного дня P&L: из чего сложился доход и расход этого дня.

    Доход и расход считаются тем же расчётом, что и столбик за день на графике, поэтому
    итоги сходятся. Логистика/палеты атрибутируются к самому раннему рейсу документа в окне
    [date_from..date_to] графика — окно передаётся, чтобы день детализации совпал со столбиком
    (иначе документ с рейсами в разные дни ушёл бы в другой день). Каждый источник несёт
    items[] первоисточников (документ/товар/сотрудник). Копейки INTEGER."""
    from modules.expenses.service import expense_day_detail
    from modules.invoices.service import rub_to_kop
    from modules.pallet_pricing.service import pallet_price_for_event
    from modules.shipments.service import packing_productivity

    cid = (client_id or None)

    def _client_cond(params: list) -> str:
        if cid and cid.strip():
            params.append(cid.strip())
            return " AND d.client_id = ?"
        return ""

    # ── Доход: логистика (по документам, атрибуция к раннему рейсу в окне) ──
    logistics_items: list[dict] = []
    for table, link_col, route in (
        ("dispatch_docs", "dispatch_doc_id", "dispatch"),
        ("receipt_docs", "receipt_doc_id", "receipt"),
    ):
        params: list = [TRIP_STATUS_CANCELLED, date_from, date_to]
        cc = _client_cond(params)
        rows = connection.execute(
            f"""
            SELECT d.id AS doc_id, d.doc_number AS doc_number,
                   MIN(cl.name) AS client_name,
                   MIN(SUBSTR(t.arrived_at, 1, 10)) AS day,
                   MAX(COALESCE(d.logistics_cost, 0)) AS logistics_cost
            FROM {table} d
            JOIN trip_lines tl ON tl.{link_col} = d.id
            JOIN trip_docs t ON t.id = tl.trip_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE COALESCE(d.is_deleted, 0) = 0 AND t.is_deleted = 0 AND tl.is_deleted = 0
              AND t.status != ? AND t.arrived_at IS NOT NULL
              AND SUBSTR(t.arrived_at, 1, 10) >= ? AND SUBSTR(t.arrived_at, 1, 10) <= ?{cc}
            GROUP BY d.id, d.doc_number
            """,
            params,
        ).fetchall()
        for r in rows:
            if str(r["day"]) != day:
                continue
            kop = rub_to_kop(r["logistics_cost"])
            if not kop:
                continue
            logistics_items.append({
                "type": "doc", "label": f"{r['doc_number']} · {r['client_name'] or 'Без клиента'}",
                "amount": kop, "ref_id": str(r["doc_id"]), "ref_kind": route, "note": None,
            })

    # ── Доход: палеты (по отгрузкам, та же атрибуция) ──
    pallet_items: list[dict] = []
    params = [TRIP_STATUS_CANCELLED, date_from, date_to]
    cc = _client_cond(params)
    rows = connection.execute(
        f"""
        SELECT d.id AS doc_id, d.doc_number AS doc_number, d.client_id,
               MIN(cl.name) AS client_name,
               MIN(SUBSTR(t.arrived_at, 1, 10)) AS day,
               COALESCE((
                   SELECT SUM(COALESCE(sl.pallets_qty, 0)) FROM dispatch_lines sl
                   WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0
               ), 0) AS pallets
        FROM dispatch_docs d
        JOIN trip_lines tl ON tl.dispatch_doc_id = d.id
        JOIN trip_docs t ON t.id = tl.trip_id
        LEFT JOIN clients cl ON cl.id = d.client_id
        WHERE COALESCE(d.is_deleted, 0) = 0 AND t.is_deleted = 0 AND tl.is_deleted = 0
          AND t.status != ? AND t.arrived_at IS NOT NULL
          AND SUBSTR(t.arrived_at, 1, 10) >= ? AND SUBSTR(t.arrived_at, 1, 10) <= ?{cc}
        GROUP BY d.id, d.doc_number, d.client_id
        """,
        params,
    ).fetchall()
    for r in rows:
        if str(r["day"]) != day:
            continue
        pallets = int(r["pallets"] or 0)
        pc = r["client_id"]
        if pallets <= 0 or not pc:
            continue
        price = pallet_price_for_event(connection, str(pc), day)
        if not price:
            continue
        pallet_items.append({
            "type": "doc",
            "label": f"{r['doc_number']} · {r['client_name'] or 'Без клиента'} · {pallets} пал.",
            "amount": price * pallets, "ref_id": str(r["doc_id"]), "ref_kind": "dispatch", "note": None,
        })

    # ── Доход: упаковка (годное/брак) по строкам товаров за день ──
    good_items: list[dict] = []
    defect_items: list[dict] = []
    prod = packing_productivity(connection, date_from=day, date_to=day, client_id=cid, with_earnings=True)
    for pday in prod.get("days", []):
        if str(pday["packed_date"]) != day:
            continue
        for row in pday.get("rows", []):
            cname = row.get("client_name") or "Без клиента"
            sku = str(row.get("product_sku") or "")
            pname = str(row.get("product_name") or "")
            label = f"{cname} · {(sku + ' ' + pname).strip()}".strip(" ·")
            g = int(row.get("good_earn_kop", 0) or 0)
            dfk = int(row.get("defect_earn_kop", 0) or 0)
            if g:
                good_items.append({
                    "type": "packing", "label": label, "amount": g, "ref_id": None,
                    "ref_kind": None, "note": f"{int(row.get('good', 0) or 0)} шт.",
                })
            if dfk:
                defect_items.append({
                    "type": "packing", "label": label, "amount": dfk, "ref_id": None,
                    "ref_kind": None, "note": f"{int(row.get('defect', 0) or 0)} шт.",
                })

    income_defs = [
        ("packing_good", "Упаковка (годное)", INV_Q_GOOD, good_items),
        ("packing_defect", "Упаковка (брак)", INV_Q_DEFECT, defect_items),
        ("logistics", "Логистика", None, logistics_items),
        ("pallets", "Палеты", None, pallet_items),
    ]
    income_sources: list[dict] = []
    for key, label, kind, items in income_defs:
        amt = sum(int(i["amount"]) for i in items)
        if amt == 0:
            continue
        items.sort(key=lambda i: i["amount"], reverse=True)
        income_sources.append({"key": key, "label": label, "kind": kind, "amount": amt, "items": items})
    income_sources.sort(key=lambda s: s["amount"], reverse=True)
    income_total = sum(s["amount"] for s in income_sources)

    expense_categories = expense_day_detail(connection, day=day, can_view_salary=can_view_salary)
    expense_total = sum(int(c["amount"]) for c in expense_categories)

    return {
        "date": day,
        "income_total": income_total,
        "expense_total": expense_total,
        "net_total": income_total - expense_total,
        "income_sources": income_sources,
        "expense_categories": expense_categories,
    }


def trip_profitability(connection, *, date_from: str, date_to: str) -> dict:
    """Рентабельность рейсов в окне (по факту прибытия): доход рейса − его себестоимость.

    Доход = логистика клиента (по привязанным отгрузкам и поступлениям) + палеты по
    привязанным отгрузкам на день рейса. Себестоимость = `trip_docs.logistics_cost_actual`.
    Аннулированные рейсы и рейсы без факта прибытия не учитываются. Документ,
    привязанный к нескольким рейсам, в этой таблице учитывается у каждого рейса —
    это экономика конкретного рейса, не дневной агрегат."""
    from config import TRIP_STATUS_RU_BY_DIRECTION
    from modules.invoices.service import rub_to_kop
    from modules.pallet_pricing.service import pallet_price_for_event

    trips = connection.execute(
        """
        SELECT t.id, t.trip_number, t.direction, t.cargo_type, t.status,
               SUBSTR(t.arrived_at, 1, 10) AS day, t.carrier_name,
               COALESCE(t.logistics_cost_actual, 0) AS cost_actual
        FROM trip_docs t
        WHERE t.is_deleted = 0 AND t.status != ? AND t.arrived_at IS NOT NULL
          AND SUBSTR(t.arrived_at, 1, 10) >= ? AND SUBSTR(t.arrived_at, 1, 10) <= ?
        ORDER BY SUBSTR(t.arrived_at, 1, 10) DESC, t.trip_number DESC
        """,
        (TRIP_STATUS_CANCELLED, date_from, date_to),
    ).fetchall()

    items: list[dict] = []
    income_total = cost_total = 0
    for t in trips:
        trip_id = str(t["id"])
        day = str(t["day"])
        income = 0
        for table, link_col in (("dispatch_docs", "dispatch_doc_id"), ("receipt_docs", "receipt_doc_id")):
            rows = connection.execute(
                f"""
                SELECT MAX(COALESCE(d.logistics_cost, 0)) AS logistics_cost
                FROM {table} d
                JOIN trip_lines tl ON tl.{link_col} = d.id AND tl.is_deleted = 0
                WHERE tl.trip_id = ? AND COALESCE(d.is_deleted, 0) = 0
                GROUP BY d.id
                """,
                (trip_id,),
            ).fetchall()
            income += sum(rub_to_kop(r["logistics_cost"]) for r in rows)
        pallet_rows = connection.execute(
            """
            SELECT d.client_id,
                   COALESCE((
                       SELECT SUM(COALESCE(sl.pallets_qty, 0)) FROM dispatch_lines sl
                       WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0
                   ), 0) AS pallets
            FROM dispatch_docs d
            JOIN trip_lines tl ON tl.dispatch_doc_id = d.id AND tl.is_deleted = 0
            WHERE tl.trip_id = ? AND COALESCE(d.is_deleted, 0) = 0
            """,
            (trip_id,),
        ).fetchall()
        for pr in pallet_rows:
            pallets = int(pr["pallets"] or 0)
            cid = pr["client_id"]
            if pallets > 0 and cid:
                price = pallet_price_for_event(connection, str(cid), day)
                if price:
                    income += price * pallets

        cost = rub_to_kop(t["cost_actual"])
        margin = income - cost
        income_total += income
        cost_total += cost
        direction = str(t["direction"])
        status = str(t["status"])
        labels = TRIP_STATUS_RU_BY_DIRECTION.get(direction, {})
        items.append({
            "trip_id": trip_id,
            "trip_number": str(t["trip_number"]),
            "direction": direction,
            "cargo_type": t["cargo_type"],
            "status": status,
            "status_label": labels.get(status, status),
            "day": day,
            "carrier_name": t["carrier_name"],
            "income_kop": income,
            "cost_kop": cost,
            "margin_kop": margin,
            "margin_pct": round(margin / income * 100, 1) if income > 0 else 0.0,
        })

    return {
        "date_from": date_from,
        "date_to": date_to,
        "income_total": income_total,
        "cost_total": cost_total,
        "margin_total": income_total - cost_total,
        "items": items,
    }
