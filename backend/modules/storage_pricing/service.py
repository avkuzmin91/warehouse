"""Платное хранение остатков: тариф клиента, ежедневные начисления, отчёт.

Модель «партия + счётчик»: партия (лот) = событие приёмки в журнале остатков
(`zone_relocations`, intake → склад, с `receipt_line_id`), отгрузки и списания
потребляют лоты варианта FIFO — от самых старых. Возраст лота считается от
max(дата приёмки, старт тарифа клиента); платные дни начинаются после
бесплатного периода (`free_days`, календарные дни, ось — бизнес-день МСК).

Тариф (client_storage_prices) — effective-dated запись полных условий:
единица тарификации (piece/box/pallet), ставка за единицу в день и free_days.
Начало отсчёта = effective_from самой ранней записи; в отличие от
`pricing.price_on`, ставка НЕ распространяется назад — до старта начислений нет.

Начисление — раз в бизнес-день за вчера, в append-only журнал storage_charges
(уникальность по клиенту и дню; повторный прогон и рестарты безопасны, пропущенные
дни добираются). Смена тарифа задним числом прошлые начисления не переписывает.
Деньги — копейки INTEGER.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from math import ceil
from uuid import uuid4
from zoneinfo import ZoneInfo

from config import (
    INV_OP_INTAKE,
    INV_OP_SINKS,
    STORAGE_UNIT_BOX,
    STORAGE_UNIT_LABELS,
    STORAGE_UNIT_PALLET,
    STORAGE_UNIT_PIECE,
)
from utils import now_iso as _now

_BUSINESS_TZ = ZoneInfo("Europe/Moscow")

# Страховка от многочасовой транзакции при большом догоне: за один прогон
# начисляется не больше этого числа дней на клиента, остальное доберут
# следующие часовые тики (MAX(charge_date) продвигается).
_MAX_BACKFILL_DAYS = 92


def _msk_day(iso) -> str:
    """Бизнес-дата (МСК) из UTC-ISO метки журнала."""
    dt = datetime.fromisoformat(str(iso))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(_BUSINESS_TZ).date().isoformat()


# ── Тариф (effective-dated история) ──────────────────────────────────────────

def load_storage_price_history(connection, client_id: str) -> list[dict]:
    """Записи тарифа хранения по клиенту, свежая первой."""
    rows = connection.execute(
        "SELECT id, unit, price_kop, free_days, effective_from, note, created_at, created_by "
        "FROM client_storage_prices "
        "WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY effective_from DESC, created_at DESC",
        (client_id,),
    ).fetchall()
    return [_price_row(r) for r in rows]


def load_storage_price_histories(connection, client_ids: list[str] | None = None) -> dict[str, list[dict]]:
    """client_id → история тарифа (свежая первой) одним запросом — без N+1.

    Без `client_ids` возвращает истории всех клиентов с тарифом (для начисления)."""
    conds = ["COALESCE(is_deleted, 0) = 0"]
    params: list = []
    if client_ids is not None:
        ids = list({str(c) for c in client_ids if c})
        if not ids:
            return {}
        conds.append(f"client_id IN ({','.join('?' for _ in ids)})")
        params += ids
    rows = connection.execute(
        f"SELECT id, client_id, unit, price_kop, free_days, effective_from, note, created_at, created_by "
        f"FROM client_storage_prices WHERE {' AND '.join(conds)} "
        f"ORDER BY client_id, effective_from DESC, created_at DESC",
        params,
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["client_id"]), []).append(_price_row(r))
    return out


def _price_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "unit": str(r["unit"]),
        "price_kop": int(r["price_kop"]),
        "free_days": int(r["free_days"]),
        "effective_from": str(r["effective_from"]),
        "note": r["note"],
        "created_at": str(r["created_at"]),
        "created_by": r["created_by"],
    }


def storage_record_on(history_desc: list[dict] | None, day_iso: str) -> dict | None:
    """Условия тарифа, действующие на дату: последняя запись с effective_from <= day.

    None — дата раньше первой записи: хранение ещё не тарифицируется (начало
    отсчёта = effective_from самой ранней записи, назад ставка не тянется)."""
    if not history_desc:
        return None
    day = day_iso[:10]
    for r in history_desc:  # отсортированы по убыванию effective_from
        if str(r["effective_from"])[:10] <= day:
            return r
    return None


def billing_start(history_desc: list[dict] | None) -> str | None:
    """Дата начала отсчёта хранения клиента = самый ранний effective_from."""
    if not history_desc:
        return None
    return min(str(r["effective_from"])[:10] for r in history_desc)


def current_storage_prices(connection, client_ids: list[str], day_iso: str) -> dict[str, dict]:
    """client_id → действующая на дату запись тарифа для набора клиентов."""
    hist = load_storage_price_histories(connection, client_ids)
    out: dict[str, dict] = {}
    for cid in {str(c) for c in client_ids if c}:
        rec = storage_record_on(hist.get(cid), day_iso)
        if rec is not None:
            out[cid] = rec
    return out


def add_storage_price(
    connection, *, client_id: str, unit: str, price_kop: int, free_days: int,
    effective_from: str, user_id: str, note: str | None = None,
) -> str:
    """Добавить запись тарифа (append-only). Без commit — вызывающий коммитит."""
    new_id = str(uuid4())
    connection.execute(
        "INSERT INTO client_storage_prices "
        "(id, client_id, unit, price_kop, free_days, effective_from, note, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (new_id, client_id, unit, int(price_kop), int(free_days), effective_from,
         (note or None), _now(), user_id),
    )
    return new_id


def delete_storage_price(connection, *, client_id: str, price_id: str) -> bool:
    """Мягко удалить запись истории (ошибочный ввод). Без commit.

    False, если запись не найдена / уже удалена / не принадлежит клиенту."""
    row = connection.execute(
        "SELECT id FROM client_storage_prices "
        "WHERE id = ? AND client_id = ? AND COALESCE(is_deleted, 0) = 0",
        (price_id, client_id),
    ).fetchone()
    if not row:
        return False
    connection.execute("UPDATE client_storage_prices SET is_deleted = 1 WHERE id = ?", (price_id,))
    return True


# ── Лоты и потребление из журнала остатков ───────────────────────────────────

def _variant_key(r) -> tuple[str, str, str]:
    return (str(r["product_id"] or ""), str(r["color_id"] or ""), str(r["size_id"] or ""))


def _load_client_lot_events(connection, client_id: str) -> tuple[list[dict], list[dict]]:
    """События приёмки клиента: приход (intake → склад) и возвраты (склад → intake).

    Возвраты — корректировка приёмки в минус и сторно при отмене inbound-рейса;
    оба пишутся с `receipt_line_id`, поэтому уменьшают лоты своей строки поступления."""
    rows = connection.execute(
        """
        SELECT zr.qty, zr.created_at, zr.from_op, zr.to_op, zr.receipt_line_id,
               zr.product_id, zr.color_id, zr.size_id,
               zr.product_sku, zr.product_name, zr.color_name, zr.size_name,
               rl.doc_id AS receipt_doc_id, rd.doc_number AS receipt_doc_number
        FROM zone_relocations zr
        LEFT JOIN receipt_lines rl ON rl.id = zr.receipt_line_id
        LEFT JOIN receipt_docs rd ON rd.id = rl.doc_id
        WHERE zr.client_id = ? AND (zr.from_op = ? OR zr.to_op = ?)
        ORDER BY zr.created_at
        """,
        (client_id, INV_OP_INTAKE, INV_OP_INTAKE),
    ).fetchall()
    plus: list[dict] = []
    minus: list[dict] = []
    for r in rows:
        e = {
            "day": _msk_day(r["created_at"]),
            "created_at": str(r["created_at"]),
            "qty": int(r["qty"]),
            "line_id": (str(r["receipt_line_id"]) if r["receipt_line_id"] else None),
            "variant": _variant_key(r),
            "product_id": (str(r["product_id"]) if r["product_id"] else None),
            "product_sku": r["product_sku"],
            "product_name": r["product_name"],
            "color_name": r["color_name"],
            "size_name": r["size_name"],
            "receipt_doc_id": (str(r["receipt_doc_id"]) if r["receipt_doc_id"] else None),
            "receipt_doc_number": r["receipt_doc_number"],
        }
        if str(r["from_op"]) == INV_OP_INTAKE:
            plus.append(e)
        else:
            minus.append(e)
    return plus, minus


def _load_client_sink_events(connection, client_id: str) -> list[dict]:
    """Убытие со склада (отгружено/списано) и его сторно, по вариантам.

    Нетто в стоки = разность двух направлений (в сток и обратно), не один CASE."""
    ph = ",".join("?" for _ in INV_OP_SINKS)
    rows = connection.execute(
        f"""
        SELECT qty, created_at, from_op, to_op, product_id, color_id, size_id
        FROM zone_relocations
        WHERE client_id = ? AND (to_op IN ({ph}) OR from_op IN ({ph}))
        """,
        (client_id, *INV_OP_SINKS, *INV_OP_SINKS),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        delta = int(r["qty"]) if str(r["to_op"]) in INV_OP_SINKS else -int(r["qty"])
        out.append({"day": _msk_day(r["created_at"]), "variant": _variant_key(r), "delta": delta})
    return out


def _lots_as_of(plus: list[dict], minus: list[dict], day_iso: str) -> dict[tuple, list[dict]]:
    """Живые лоты на конец бизнес-дня: приходы минус возвраты своей строки (LIFO).

    Возврат гасит самые поздние приходы своей строки поступления — «принятого
    меньше» относится к последней приёмке, более ранние партии не молодеют."""
    lots: list[dict] = [
        {**e, "qty_left": e["qty"]}
        for e in plus
        if e["day"] <= day_iso and e["qty"] > 0
    ]
    by_line: dict[str, list[dict]] = {}
    for lot in lots:
        if lot["line_id"]:
            by_line.setdefault(lot["line_id"], []).append(lot)
    for e in minus:
        if e["day"] > day_iso or not e["line_id"]:
            continue
        remaining = e["qty"]
        for lot in reversed(by_line.get(e["line_id"], [])):
            if remaining <= 0:
                break
            take = min(remaining, lot["qty_left"])
            lot["qty_left"] -= take
            remaining -= take
    by_variant: dict[tuple, list[dict]] = {}
    for lot in lots:
        if lot["qty_left"] > 0:
            by_variant.setdefault(lot["variant"], []).append(lot)
    for vlots in by_variant.values():
        vlots.sort(key=lambda x: (x["day"], x["created_at"]))
    return by_variant


def _consumed_as_of(sink_events: list[dict], day_iso: str) -> dict[tuple, int]:
    """Вариант → суммарно убыло со склада (нетто в стоки) на конец бизнес-дня."""
    out: dict[tuple, int] = {}
    for e in sink_events:
        if e["day"] <= day_iso:
            out[e["variant"]] = out.get(e["variant"], 0) + e["delta"]
    return out


def _billable_lines_for_day(
    plus: list[dict], minus: list[dict], sink_events: list[dict],
    *, day: date, start_day: str, free_days: int,
) -> list[dict]:
    """Платные лоты на день начисления: остаток лота после FIFO-потребления варианта.

    Возраст лота — от max(дата приёмки, старт тарифа); лот платный, когда прошло
    не меньше free_days календарных дней (день free_days+1 — первый платный)."""
    day_iso = day.isoformat()
    lots_by_variant = _lots_as_of(plus, minus, day_iso)
    consumed = _consumed_as_of(sink_events, day_iso)
    lines: list[dict] = []
    for variant, vlots in lots_by_variant.items():
        remaining = max(0, consumed.get(variant, 0))
        for lot in vlots:  # FIFO: старые лоты потребляются первыми
            take = min(remaining, lot["qty_left"])
            lot["qty_left"] -= take
            remaining -= take
        for lot in vlots:
            if lot["qty_left"] <= 0:
                continue
            age_from = max(lot["day"], start_day)
            age_days = (day - date.fromisoformat(age_from)).days
            if age_days < free_days:
                continue
            lines.append({
                "receipt_line_id": lot["line_id"],
                "receipt_doc_id": lot["receipt_doc_id"],
                "receipt_doc_number": lot["receipt_doc_number"],
                "product_id": lot["product_id"],
                "product_sku": lot["product_sku"],
                "product_name": lot["product_name"],
                "color_name": lot["color_name"],
                "size_name": lot["size_name"],
                "accepted_on": lot["day"],
                "age_days": age_days,
                "qty_pieces": lot["qty_left"],
                "billable_qty": lot["qty_left"],
            })
    return lines


# ── Конвертация штук в единицу тарификации ───────────────────────────────────

def _product_capacities(connection, product_ids: list[str]) -> dict[str, dict]:
    ids = [p for p in {str(p) for p in product_ids if p}]
    if not ids:
        return {}
    ph = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT id, items_per_box, boxes_per_pallet FROM products WHERE id IN ({ph})", ids
    ).fetchall()
    return {
        str(r["id"]): {
            "items_per_box": int(r["items_per_box"]) if r["items_per_box"] else 0,
            "boxes_per_pallet": int(r["boxes_per_pallet"]) if r["boxes_per_pallet"] else 0,
        }
        for r in rows
    }


def _convert_to_units(
    unit: str, pieces_by_product: dict[str, int], caps: dict[str, dict]
) -> tuple[int, int]:
    """Платные штуки → единицы тарификации. Возвращает (units_qty, missing_capacity_qty).

    Округление вверх на уровне товара (не варианта и не клиента): «250 шт. при
    100 шт. в коробе = 3 короба» — объяснимо клиенту и не штрафует за мелкие
    остатки разных цветов/размеров одного товара. Товар без заведённой
    вместимости в единицы не конвертируется — его штуки копятся в
    missing_capacity_qty, отчёт подсвечивает это как пробел справочника."""
    if unit == STORAGE_UNIT_PIECE:
        return sum(pieces_by_product.values()), 0
    units = 0
    missing = 0
    for pid, pieces in pieces_by_product.items():
        cap = caps.get(pid, {})
        per_box = int(cap.get("items_per_box") or 0)
        if unit == STORAGE_UNIT_BOX:
            capacity = per_box
        else:  # STORAGE_UNIT_PALLET
            capacity = per_box * int(cap.get("boxes_per_pallet") or 0)
        if capacity > 0:
            units += ceil(pieces / capacity)
        else:
            missing += pieces
    return units, missing


# ── Ежедневное начисление ────────────────────────────────────────────────────

def run_storage_accruals(connection, today: date) -> int:
    """Идемпотентно начисляет хранение по всем клиентам с тарифом за дни до вчера.

    Не коммитит — вызывающий."""
    histories = load_storage_price_histories(connection)
    created = 0
    for client_id, hist in histories.items():
        created += run_client_storage_accrual(connection, client_id, today, hist=hist)
    return created


def run_client_storage_accrual(
    connection, client_id: str, today: date, *, hist: list[dict] | None = None,
) -> int:
    """Начисляет клиенту все непокрытые дни от старта тарифа до вчера.

    Идёт по «дырам»: день без строки в storage_charges вычисляется и пишется, уже
    начисленные дни не трогаются (append-only). Это покрывает и пропуски (простой
    backend), и ретро-включение — запись тарифа задним числом доначисляет прошлое
    по ставке, действовавшей на каждый день. День без платных лотов тоже пишется
    (нулевой строкой) — он же якорь «день посчитан». Не коммитит — вызывающий."""
    if hist is None:
        hist = load_storage_price_history(connection, client_id)
    start = billing_start(hist)
    if not start:
        return 0
    yesterday = today - timedelta(days=1)
    first_day = date.fromisoformat(start)
    if first_day > yesterday:
        return 0
    charged = {
        str(r["charge_date"])
        for r in connection.execute(
            "SELECT charge_date FROM storage_charges WHERE client_id = ?", (client_id,)
        ).fetchall()
    }

    created = 0
    loaded = False
    plus: list[dict] = []
    minus: list[dict] = []
    sink_events: list[dict] = []
    day = first_day
    while day <= yesterday and created < _MAX_BACKFILL_DAYS:
        if day.isoformat() in charged:
            day += timedelta(days=1)
            continue
        rec = storage_record_on(hist, day.isoformat())
        if rec is None:
            day += timedelta(days=1)
            continue
        if not loaded:
            # Журнал грузится один раз и только если есть что доначислять.
            plus, minus = _load_client_lot_events(connection, client_id)
            sink_events = _load_client_sink_events(connection, client_id)
            loaded = True
        created += _write_charge(
            connection, client_id=client_id, day=day, rec=rec, start=start,
            plus=plus, minus=minus, sink_events=sink_events,
        )
        day += timedelta(days=1)
    return created


def _write_charge(
    connection, *, client_id: str, day: date, rec: dict, start: str,
    plus: list[dict], minus: list[dict], sink_events: list[dict],
) -> int:
    lines = _billable_lines_for_day(
        plus, minus, sink_events, day=day, start_day=start, free_days=int(rec["free_days"]),
    )
    pieces_by_product: dict[str, int] = {}
    for ln in lines:
        pid = str(ln["product_id"] or "")
        pieces_by_product[pid] = pieces_by_product.get(pid, 0) + int(ln["billable_qty"])
    caps = _product_capacities(connection, list(pieces_by_product))
    units_qty, missing_qty = _convert_to_units(str(rec["unit"]), pieces_by_product, caps)
    amount_kop = units_qty * int(rec["price_kop"])

    charge_id = str(uuid4())
    now = _now()
    connection.execute(
        "INSERT INTO storage_charges "
        "(id, client_id, charge_date, unit, rate_kop, free_days, qty_pieces, units_qty, "
        " amount_kop, missing_capacity_qty, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (charge_id, client_id, day.isoformat(), str(rec["unit"]), int(rec["price_kop"]),
         int(rec["free_days"]), sum(int(ln["billable_qty"]) for ln in lines), units_qty,
         amount_kop, missing_qty, now),
    )
    for ln in lines:
        connection.execute(
            "INSERT INTO storage_charge_lines "
            "(id, charge_id, receipt_line_id, receipt_doc_id, receipt_doc_number, "
            " product_id, product_sku, product_name, color_name, size_name, "
            " accepted_on, age_days, qty_pieces, billable_qty) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid4()), charge_id, ln["receipt_line_id"], ln["receipt_doc_id"],
             ln["receipt_doc_number"], ln["product_id"], ln["product_sku"],
             ln["product_name"], ln["color_name"], ln["size_name"],
             ln["accepted_on"], int(ln["age_days"]), int(ln["qty_pieces"]),
             int(ln["billable_qty"])),
        )
    return 1


# ── Отчёт «Хранение» ─────────────────────────────────────────────────────────

def storage_report(
    connection, *, date_from: str, date_to: str, client_id: str | None = None,
) -> dict:
    """Сводка начислений за период по клиентам: сумма, платные дни, не в счетах."""
    conds = ["c.charge_date >= ?", "c.charge_date <= ?"]
    params: list = [date_from, date_to]
    if client_id and client_id.strip():
        conds.append("c.client_id = ?")
        params.append(client_id.strip())
    rows = connection.execute(
        f"""
        SELECT c.client_id, MIN(cl.name) AS client_name,
               COUNT(*) FILTER (WHERE c.amount_kop > 0) AS billable_days,
               COALESCE(SUM(c.amount_kop), 0) AS amount_kop,
               COALESCE(SUM(c.amount_kop) FILTER (WHERE l.id IS NULL), 0) AS uninvoiced_kop,
               COALESCE(SUM(c.missing_capacity_qty), 0) AS missing_capacity_qty,
               MAX(c.charge_date) AS last_charge_date
        FROM storage_charges c
        LEFT JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN invoice_storage_charges l
            ON l.charge_id = c.id AND COALESCE(l.is_deleted, 0) = 0
        WHERE {' AND '.join(conds)}
        GROUP BY c.client_id
        ORDER BY SUM(c.amount_kop) DESC
        """,
        params,
    ).fetchall()
    prices = current_storage_prices(connection, [str(r["client_id"]) for r in rows], date_to)
    items = []
    for r in rows:
        cid = str(r["client_id"])
        rec = prices.get(cid)
        items.append({
            "client_id": cid,
            "client_name": r["client_name"],
            "billable_days": int(r["billable_days"] or 0),
            "amount_kop": int(r["amount_kop"]),
            "uninvoiced_kop": int(r["uninvoiced_kop"]),
            "missing_capacity_qty": int(r["missing_capacity_qty"]),
            "last_charge_date": (str(r["last_charge_date"]) if r["last_charge_date"] else None),
            "unit": (str(rec["unit"]) if rec else None),
            "rate_kop": (int(rec["price_kop"]) if rec else None),
            "free_days": (int(rec["free_days"]) if rec else None),
        })
    return {
        "items": items,
        "total_amount_kop": sum(i["amount_kop"] for i in items),
        "total_uninvoiced_kop": sum(i["uninvoiced_kop"] for i in items),
    }


def storage_client_days(
    connection, *, client_id: str, date_from: str, date_to: str,
) -> list[dict]:
    """Дневные начисления клиента за период (для drill-down), свежие первыми."""
    rows = connection.execute(
        """
        SELECT c.id, c.charge_date, c.unit, c.rate_kop, c.free_days, c.qty_pieces,
               c.units_qty, c.amount_kop, c.missing_capacity_qty,
               i.id AS invoice_id, i.doc_number AS invoice_number
        FROM storage_charges c
        LEFT JOIN invoice_storage_charges l
            ON l.charge_id = c.id AND COALESCE(l.is_deleted, 0) = 0
        LEFT JOIN invoice_docs i ON i.id = l.invoice_id
        WHERE c.client_id = ? AND c.charge_date >= ? AND c.charge_date <= ?
        ORDER BY c.charge_date DESC
        """,
        (client_id, date_from, date_to),
    ).fetchall()
    return [
        {
            "id": str(r["id"]),
            "charge_date": str(r["charge_date"]),
            "unit": str(r["unit"]),
            "unit_label": STORAGE_UNIT_LABELS.get(str(r["unit"]), str(r["unit"])),
            "rate_kop": int(r["rate_kop"]),
            "free_days": int(r["free_days"]),
            "qty_pieces": int(r["qty_pieces"]),
            "units_qty": int(r["units_qty"]),
            "amount_kop": int(r["amount_kop"]),
            "missing_capacity_qty": int(r["missing_capacity_qty"]),
            "invoice_id": (str(r["invoice_id"]) if r["invoice_id"] else None),
            "invoice_number": r["invoice_number"],
        }
        for r in rows
    ]


def storage_charge_detail(connection, charge_id: str) -> dict | None:
    """Начисление дня + детализация по лотам (какая партия, возраст, сколько платно)."""
    charge = connection.execute(
        """
        SELECT c.*, cl.name AS client_name
        FROM storage_charges c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE c.id = ?
        """,
        (charge_id,),
    ).fetchone()
    if not charge:
        return None
    rows = connection.execute(
        "SELECT * FROM storage_charge_lines WHERE charge_id = ? "
        "ORDER BY accepted_on, receipt_doc_number, product_sku",
        (charge_id,),
    ).fetchall()
    return {
        "id": str(charge["id"]),
        "client_id": str(charge["client_id"]),
        "client_name": charge["client_name"],
        "charge_date": str(charge["charge_date"]),
        "unit": str(charge["unit"]),
        "unit_label": STORAGE_UNIT_LABELS.get(str(charge["unit"]), str(charge["unit"])),
        "rate_kop": int(charge["rate_kop"]),
        "free_days": int(charge["free_days"]),
        "qty_pieces": int(charge["qty_pieces"]),
        "units_qty": int(charge["units_qty"]),
        "amount_kop": int(charge["amount_kop"]),
        "missing_capacity_qty": int(charge["missing_capacity_qty"]),
        "lines": [
            {
                "id": str(r["id"]),
                "receipt_line_id": r["receipt_line_id"],
                "receipt_doc_id": r["receipt_doc_id"],
                "receipt_doc_number": r["receipt_doc_number"],
                "product_id": r["product_id"],
                "product_sku": r["product_sku"],
                "product_name": r["product_name"],
                "color_name": r["color_name"],
                "size_name": r["size_name"],
                "accepted_on": (str(r["accepted_on"]) if r["accepted_on"] else None),
                "age_days": int(r["age_days"]),
                "qty_pieces": int(r["qty_pieces"]),
                "billable_qty": int(r["billable_qty"]),
            }
            for r in rows
        ],
    }


_MONTHS_RU = (
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
)


def uninvoiced_storage_months(connection, client_id: str) -> dict:
    """Невыставленное хранение клиента помесячно — подсказка менеджеру при выставлении.

    Месяц = группа платных дней (amount > 0), не входящих ни в один активный счёт;
    date_from/date_to — границы свободных дней внутри месяца, ими же и привязывают."""
    rows = connection.execute(
        """
        SELECT SUBSTR(c.charge_date, 1, 7) AS month,
               COUNT(*) AS days,
               MIN(c.charge_date) AS date_from,
               MAX(c.charge_date) AS date_to,
               COALESCE(SUM(c.amount_kop), 0) AS amount_kop
        FROM storage_charges c
        WHERE c.client_id = ? AND c.amount_kop > 0
          AND NOT EXISTS (
              SELECT 1 FROM invoice_storage_charges l
              WHERE l.charge_id = c.id AND COALESCE(l.is_deleted, 0) = 0
          )
        GROUP BY SUBSTR(c.charge_date, 1, 7)
        ORDER BY SUBSTR(c.charge_date, 1, 7)
        """,
        (client_id,),
    ).fetchall()
    items = []
    for r in rows:
        month = str(r["month"])
        try:
            label = f"{_MONTHS_RU[int(month[5:7]) - 1]} {month[:4]}"
        except (ValueError, IndexError):
            label = month
        items.append({
            "month": month,
            "month_label": label,
            "days": int(r["days"]),
            "date_from": str(r["date_from"]),
            "date_to": str(r["date_to"]),
            "amount_kop": int(r["amount_kop"]),
        })
    return {"items": items, "total_amount_kop": sum(i["amount_kop"] for i in items)}


# ── Доход для P&L ────────────────────────────────────────────────────────────

def storage_income_rows(
    connection, *, date_from: str, date_to: str, client_id: str | None,
) -> list[dict]:
    """Строки дохода «Хранение» для P&L: (день, клиент, копейки) по charge_date.

    Учёт по начислению: попадание начисления в счёт на доход P&L не влияет."""
    conds = ["c.charge_date >= ?", "c.charge_date <= ?", "c.amount_kop != 0"]
    params: list = [date_from, date_to]
    if client_id and client_id.strip():
        conds.append("c.client_id = ?")
        params.append(client_id.strip())
    rows = connection.execute(
        f"""
        SELECT c.charge_date AS day, c.client_id, cl.name AS client_name, c.amount_kop
        FROM storage_charges c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE {' AND '.join(conds)}
        """,
        params,
    ).fetchall()
    return [
        {
            "day": str(r["day"]), "client_id": r["client_id"],
            "client_name": r["client_name"], "kop": int(r["amount_kop"]),
        }
        for r in rows
    ]


def storage_income_day_items(connection, *, day: str, client_id: str | None) -> list[dict]:
    """Items источника «Хранение» для детализации дня P&L (по клиентам)."""
    conds = ["c.charge_date = ?", "c.amount_kop != 0"]
    params: list = [day]
    if client_id and client_id.strip():
        conds.append("c.client_id = ?")
        params.append(client_id.strip())
    rows = connection.execute(
        f"""
        SELECT c.id, c.unit, c.units_qty, c.amount_kop, cl.name AS client_name
        FROM storage_charges c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE {' AND '.join(conds)}
        ORDER BY c.amount_kop DESC
        """,
        params,
    ).fetchall()
    return [
        {
            "type": "storage",
            "label": f"Хранение · {r['client_name'] or 'Без клиента'}",
            "amount": int(r["amount_kop"]),
            "ref_id": str(r["id"]),
            "ref_kind": "storage_charge",
            "note": f"{int(r['units_qty'])} × {STORAGE_UNIT_LABELS.get(str(r['unit']), str(r['unit'])).lower()}",
        }
        for r in rows
    ]
