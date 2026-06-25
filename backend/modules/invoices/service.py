from __future__ import annotations

import time
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    DISPATCH_STATUS_LABELS,
    DISPATCH_STATUS_SHIPPED,
    INVOICE_ACTIVE_STATUSES,
    INVOICE_OP_RECEIPT_LINK,
    INVOICE_OP_SHIPMENT_LINK,
    INVOICE_STATUS_LABELS,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_LABELS,
)
from dbconn import like_substring_param


def _now() -> str:
    return datetime.now(UTC).isoformat()


def format_kopecks(kopecks: int) -> str:
    """Копейки → «15 000,00 ₽» (ru-формат для журнальных комментариев)."""
    rub, kop = divmod(int(kopecks), 100)
    grouped = f"{rub:,}".replace(",", " ")
    return f"{grouped},{kop:02d} ₽"


def is_overdue(status: str, due_date) -> bool:
    """Срок просрочен — плановая дата строго в прошлом (< сегодня)."""
    return (
        status in INVOICE_ACTIVE_STATUSES
        and bool(due_date)
        and str(due_date) < date.today().isoformat()
    )


def is_due_reached(status: str, due_date) -> bool:
    """Срок наступил — плановая дата сегодня или в прошлом (<= сегодня).

    Отдельно от `is_overdue` (строгое <): «наступил» включает день-в-день,
    поэтому в карточке/рейле срок подсвечивается уже в плановую дату, а не
    только на следующий день.
    """
    return (
        status in INVOICE_ACTIVE_STATUSES
        and bool(due_date)
        and str(due_date) <= date.today().isoformat()
    )


def recompute_paid(connection, invoice_id: str) -> int:
    row = connection.execute(
        "SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
        (invoice_id,),
    ).fetchone()
    return int(row["paid"] if row else 0)


def next_invoice_number(connection) -> str:
    """Следующий номер счёта `INV-NNNN` (MAX, не COUNT — без дублей при дырках)."""
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM invoice_docs
        WHERE doc_number LIKE 'INV-%' AND SUBSTR(doc_number, 5) ~ '^[0-9]+$'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"INV-{n:04d}"


def attach_shipments(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    shipment_ids: list[str],
    uid: str,
    now: str,
) -> None:
    """Привязывает отгрузки к счёту с валидацией инвариантов.

    Только завершённые отгрузки (`shipped`), того же клиента, ещё не входящие
    ни в один активный счёт. Уникальный частичный индекс
    `idx_invoice_shipments_shipment_unique` страхует от гонок.
    """
    seen: set[str] = set()
    for raw in shipment_ids:
        sid = str(raw or "").strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)

        ship = connection.execute(
            "SELECT id, doc_number, status, client_id FROM dispatch_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if not ship:
            raise HTTPException(status_code=404, detail="Отгрузка не найдена")

        doc_number = str(ship["doc_number"])
        if str(ship["status"]) != DISPATCH_STATUS_SHIPPED:
            label = DISPATCH_STATUS_LABELS.get(str(ship["status"]), str(ship["status"]))
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузку {doc_number} нельзя включить в счёт: только завершённые (сейчас «{label}»)",
            )
        if str(ship["client_id"] or "") != str(client_id or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузка {doc_number} принадлежит другому клиенту",
            )

        busy = connection.execute(
            "SELECT 1 FROM invoice_shipments "
            "WHERE shipment_doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if busy:
            raise HTTPException(
                status_code=400,
                detail=f"Отгрузка {doc_number} уже привязана к счёту",
            )

        connection.execute(
            "INSERT INTO invoice_shipments "
            "(id,invoice_id,shipment_doc_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, sid, ship["client_id"], None, now, uid),
        )
        connection.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_SHIPMENT_LINK,
             f"Привязана отгрузка {doc_number}", now, uid),
        )


def attach_receipts(
    connection,
    *,
    invoice_id: str,
    client_id: str | None,
    receipt_ids: list[str],
    uid: str,
    now: str,
) -> None:
    """Привязывает поступления к счёту с валидацией инвариантов.

    Зеркало `attach_shipments`: только завершённые поступления (`done`), того же
    клиента, ещё не входящие ни в один активный счёт. Уникальный частичный индекс
    `idx_invoice_receipts_receipt_unique` страхует от гонок.
    """
    seen: set[str] = set()
    for raw in receipt_ids:
        rid = str(raw or "").strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)

        rec = connection.execute(
            "SELECT id, doc_number, status, client_id FROM receipt_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (rid,),
        ).fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Поступление не найдено")

        doc_number = str(rec["doc_number"])
        if str(rec["status"]) != RECEIPT_STATUS_DONE:
            label = RECEIPT_STATUS_LABELS.get(str(rec["status"]), str(rec["status"]))
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} нельзя включить в счёт: только завершённые (сейчас «{label}»)",
            )
        if str(rec["client_id"] or "") != str(client_id or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} принадлежит другому клиенту",
            )

        busy = connection.execute(
            "SELECT 1 FROM invoice_receipts "
            "WHERE receipt_doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (rid,),
        ).fetchone()
        if busy:
            raise HTTPException(
                status_code=400,
                detail=f"Поступление {doc_number} уже привязано к счёту",
            )

        connection.execute(
            "INSERT INTO invoice_receipts "
            "(id,invoice_id,receipt_doc_id,client_id,client_name,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, rid, rec["client_id"], None, now, uid),
        )
        connection.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_RECEIPT_LINK,
             f"Привязано поступление {doc_number}", now, uid),
        )


def logistics_amount_for_docs(
    connection, *, dispatch_ids: list[str] | None = None, receipt_ids: list[str] | None = None
) -> dict:
    """Логистика для клиента по наборам отгрузок и поступлений, копейки.

    Берётся из `*.logistics_cost` (рубли) самих документов — это цена логистики
    для клиента, не себестоимость рейса. Рубли → копейки через `round(rub*100)`."""
    def _sum(table: str, ids: list[str] | None) -> int:
        clean = [str(x or "").strip() for x in (ids or []) if str(x or "").strip()]
        clean = list(dict.fromkeys(clean))
        if not clean:
            return 0
        placeholders = ",".join("?" for _ in clean)
        rows = connection.execute(
            f"SELECT logistics_cost FROM {table} "
            f"WHERE id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0",
            clean,
        ).fetchall()
        return sum(round(float(r["logistics_cost"] or 0) * 100) for r in rows)

    return {
        "dispatch_logistics_kop": _sum("dispatch_docs", dispatch_ids),
        "receipt_logistics_kop": _sum("receipt_docs", receipt_ids),
    }


def list_invoices_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    status: str | None,
    client_id: str | None,
    search: str | None,
    overdue: bool,
) -> tuple[list[dict], int]:
    today = date.today().isoformat()
    conds = ["COALESCE(d.is_deleted, 0) = 0"]
    params: list = []
    if status:
        codes = [s.strip() for s in str(status).split(",") if s.strip()]
        if codes:
            conds.append(f"d.status IN ({','.join('?' for _ in codes)})")
            params += codes
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ?)")
        params += [s, s]
    if overdue:
        conds.append("d.due_date IS NOT NULL AND d.due_date < ?")
        params.append(today)
        conds.append(f"d.status IN ({','.join('?' for _ in INVOICE_ACTIVE_STATUSES)})")
        params += list(INVOICE_ACTIVE_STATUSES)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM invoice_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.*,
               (SELECT COUNT(*) FROM invoice_shipments s
                WHERE s.invoice_id = d.id AND COALESCE(s.is_deleted, 0) = 0) AS shipment_count,
               (SELECT COUNT(*) FROM invoice_receipts r
                WHERE r.invoice_id = d.id AND COALESCE(r.is_deleted, 0) = 0) AS receipt_count
        FROM invoice_docs d
        WHERE {where}
        ORDER BY d.due_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "status": str(r["status"]),
            "status_label": INVOICE_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            "total_amount": int(r["total_amount"]),
            "paid_amount": int(r["paid_amount"]),
            "due_date": r["due_date"],
            "overdue": is_overdue(str(r["status"]), r["due_date"]),
            "shipment_count": int(r["shipment_count"]),
            "receipt_count": int(r["receipt_count"]),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def list_uninvoiced_shipments(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[dict], int]:
    """Завершённые отгрузки, не входящие ни в один активный счёт."""
    conds = [
        "COALESCE(d.is_deleted, 0) = 0",
        "d.status = ?",
        "NOT EXISTS (SELECT 1 FROM invoice_shipments s "
        "WHERE s.shipment_doc_id = d.id AND COALESCE(s.is_deleted, 0) = 0)",
    ]
    params: list = [DISPATCH_STATUS_SHIPPED]
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
        params += [s, s, s]
    if date_from:
        conds.append("d.ship_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM dispatch_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.cargo_type, d.client_id, d.client_name,
               d.destination, d.ship_date, d.created_at,
               (SELECT COUNT(DISTINCT sl.product_id) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(sl.qty), 0) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS total_qty
        FROM dispatch_docs d
        WHERE {where}
        ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    # Топ-товары каждой отгрузки для свёрнутой строки (одним запросом по странице,
    # не N+1). Полный состав по требованию грузит карточка отгрузки / roll-up.
    preview_map = _products_preview_map(connection, [str(r["id"]) for r in rows], top_n=3)

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "cargo_type": str(r["cargo_type"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "destination": r["destination"],
            "ship_date": r["ship_date"],
            "sku_count": int(r["sku_count"]),
            "total_qty": int(r["total_qty"]),
            "products_preview": preview_map.get(str(r["id"]), []),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def _products_preview_map(connection, doc_ids: list[str], *, top_n: int) -> dict[str, list[dict]]:
    """Для набора отгрузок — топ-N товаров по количеству (для свёрнутой строки)."""
    ids = [d for d in doc_ids if d]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT doc_id, product_id, MAX(product_name) AS name, SUM(qty) AS qty
        FROM dispatch_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY doc_id, product_id
        ORDER BY doc_id, SUM(qty) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    result: dict[str, list[dict]] = {}
    for r in rows:
        bucket = result.setdefault(str(r["doc_id"]), [])
        if len(bucket) < top_n:
            bucket.append({"name": str(r["name"]), "qty": int(r["qty"])})
    return result


def aggregate_shipment_contents(connection, shipment_ids: list[str]) -> dict:
    """Сводный состав по набору отгрузок: товары с суммарным количеством (roll-up)."""
    ids: list[str] = []
    for raw in shipment_ids:
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    if not ids:
        return {"products": [], "total_qty": 0, "sku_count": 0}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT product_id, MAX(product_name) AS name, MAX(product_sku) AS sku, SUM(qty) AS qty
        FROM dispatch_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY product_id
        ORDER BY SUM(qty) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    products = [
        {"product_id": str(r["product_id"]), "name": str(r["name"]),
         "sku": r["sku"], "qty": int(r["qty"])}
        for r in rows
    ]
    return {
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "sku_count": len(products),
    }


def list_uninvoiced_receipts(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[dict], int]:
    """Завершённые поступления, не входящие ни в один активный счёт."""
    conds = [
        "COALESCE(d.is_deleted, 0) = 0",
        "d.status = ?",
        "NOT EXISTS (SELECT 1 FROM invoice_receipts r "
        "WHERE r.receipt_doc_id = d.id AND COALESCE(r.is_deleted, 0) = 0)",
    ]
    params: list = [RECEIPT_STATUS_DONE]
    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.supplier_name LIKE ?)")
        params += [s, s]
    if date_from:
        conds.append("d.arrival_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?"); params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM receipt_docs d WHERE {where}", params
    ).fetchone()["n"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.client_id, c.name AS client_name,
               d.supplier_name, d.arrival_date, d.logistics_cost, d.created_at,
               (SELECT COUNT(DISTINCT rl.product_id) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(rl.accepted_qty), 0) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS total_qty
        FROM receipt_docs d
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE {where}
        ORDER BY d.arrival_date DESC NULLS LAST, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    preview_map = _receipt_products_preview_map(connection, [str(r["id"]) for r in rows], top_n=3)

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "supplier_name": r["supplier_name"],
            "arrival_date": r["arrival_date"],
            "logistics_cost_kop": round(float(r["logistics_cost"] or 0) * 100),
            "sku_count": int(r["sku_count"]),
            "total_qty": int(r["total_qty"]),
            "products_preview": preview_map.get(str(r["id"]), []),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def _receipt_products_preview_map(connection, doc_ids: list[str], *, top_n: int) -> dict[str, list[dict]]:
    """Для набора поступлений — топ-N товаров по принятому количеству."""
    ids = [d for d in doc_ids if d]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT doc_id, product_id, MAX(product_name) AS name, SUM(COALESCE(accepted_qty, 0)) AS qty
        FROM receipt_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY doc_id, product_id
        ORDER BY doc_id, SUM(COALESCE(accepted_qty, 0)) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    result: dict[str, list[dict]] = {}
    for r in rows:
        bucket = result.setdefault(str(r["doc_id"]), [])
        if len(bucket) < top_n:
            bucket.append({"name": str(r["name"]), "qty": int(r["qty"])})
    return result


def aggregate_receipt_contents(connection, receipt_ids: list[str]) -> dict:
    """Сводный состав по набору поступлений: товары с суммарным принятым количеством."""
    ids: list[str] = []
    for raw in receipt_ids:
        rid = str(raw or "").strip()
        if rid and rid not in ids:
            ids.append(rid)
    if not ids:
        return {"products": [], "total_qty": 0, "sku_count": 0}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT product_id, MAX(product_name) AS name, MAX(product_sku) AS sku,
               SUM(COALESCE(accepted_qty, 0)) AS qty
        FROM receipt_lines
        WHERE doc_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0
        GROUP BY product_id
        ORDER BY SUM(COALESCE(accepted_qty, 0)) DESC, MAX(product_name)
        """,
        ids,
    ).fetchall()
    products = [
        {"product_id": str(r["product_id"]), "name": str(r["name"]),
         "sku": r["sku"], "qty": int(r["qty"])}
        for r in rows
    ]
    return {
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "sku_count": len(products),
    }


def suggested_amount_for_dispatches(connection, dispatch_ids: list[str]) -> dict:
    """Предлагаемая сумма счёта по набору отгрузок: Σ qty × тариф на дату отгрузки.

    Качество тарифа берётся по cargo_type отгрузки (good/defect), дата — фактическая
    дата отгрузки (или плановая). `has_missing_price` = по части позиций тариф не
    заведён (такие позиции в сумму не вошли) — UI предупреждает менеджера.

    Палеты считаются отдельным компонентом `pallets_amount_kop`: Σ палет документа ×
    цена палета клиента (client_pallet_prices) на дату отгрузки. Цена палета — по
    клиенту, без разделения на годный/брак. `has_missing_pallet_price` = у клиента
    есть палеты, но цена не заведена."""
    from modules.pallet_pricing.service import pallet_price_for_event
    from modules.pricing.service import price_for_event
    from modules.timesheet.service import business_today

    ids: list[str] = []
    for raw in dispatch_ids:
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    if not ids:
        return {
            "amount_kop": 0, "has_missing_price": False, "priced_qty": 0, "unpriced_qty": 0,
            "pallets_amount_kop": 0, "has_missing_pallet_price": False,
        }

    today = business_today().isoformat()
    placeholders = ",".join("?" for _ in ids)
    docs = connection.execute(
        f"SELECT id, cargo_type, client_id, actual_ship_date, ship_date "
        f"FROM dispatch_docs WHERE id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0",
        ids,
    ).fetchall()

    amount = 0
    priced_qty = 0
    unpriced_qty = 0
    pallets_amount = 0
    has_missing_pallet_price = False
    for doc in docs:
        doc_id = str(doc["id"])
        client_id = doc["client_id"]
        quality = str(doc["cargo_type"] or "good")
        day = str(doc["actual_ship_date"] or doc["ship_date"] or today)[:10]
        lines = connection.execute(
            "SELECT product_id, qty, COALESCE(pallets_qty, 0) AS pallets_qty FROM dispatch_lines "
            "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (doc_id,),
        ).fetchall()
        pallets_total = 0
        for line in lines:
            pallets_total += int(line["pallets_qty"] or 0)
            qty = int(line["qty"] or 0)
            if qty <= 0:
                continue
            price = None
            if client_id:
                price = price_for_event(connection, str(line["product_id"]), str(client_id), quality, day)
            if price is None:
                unpriced_qty += qty
            else:
                amount += price * qty
                priced_qty += qty
        if pallets_total > 0:
            pallet_price = pallet_price_for_event(connection, str(client_id), day) if client_id else None
            if pallet_price is None:
                has_missing_pallet_price = True
            else:
                pallets_amount += pallet_price * pallets_total

    return {
        "amount_kop": amount,
        "has_missing_price": unpriced_qty > 0,
        "priced_qty": priced_qty,
        "unpriced_qty": unpriced_qty,
        "pallets_amount_kop": pallets_amount,
        "has_missing_pallet_price": has_missing_pallet_price,
    }


# Лёгкий in-process кеш счётчика алёрта: бейдж опрашивается часто, а сам запрос
# хоть и индексируемый, не нужно гонять на каждый рендер главной. TTL короткий —
# точность «к оплате/просрочено» в пределах десятка секунд достаточна.
_ALERTS_TTL_SEC = 20.0
_alerts_cache: dict[str, object] = {"at": 0.0, "value": None}


def invalidate_alerts_cache() -> None:
    _alerts_cache["at"] = 0.0
    _alerts_cache["value"] = None


def alerts_counts(connection) -> dict[str, int]:
    now_mono = time.monotonic()
    cached = _alerts_cache["value"]
    if cached is not None and (now_mono - float(_alerts_cache["at"])) < _ALERTS_TTL_SEC:
        return dict(cached)  # type: ignore[arg-type]

    today = date.today().isoformat()
    active = list(INVOICE_ACTIVE_STATUSES)
    placeholders = ",".join("?" for _ in active)
    row = connection.execute(
        f"""
        SELECT
            COUNT(*) AS active_count,
            COALESCE(SUM(total_amount - paid_amount), 0) AS active_outstanding,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <= ?) AS due_count,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date <  ?) AS overdue_count
        FROM invoice_docs
        WHERE COALESCE(is_deleted, 0) = 0 AND status IN ({placeholders})
        """,
        [today, today, *active],
    ).fetchone()
    value = {
        "due_count": int(row["due_count"] or 0),
        "overdue_count": int(row["overdue_count"] or 0),
        "active_count": int(row["active_count"] or 0),
        "active_outstanding": int(row["active_outstanding"] or 0),
    }
    _alerts_cache["at"] = now_mono
    _alerts_cache["value"] = value
    return dict(value)
