"""FBS-маркетплейсы, Фаза 1: синхронизация заказов/карточек и выборки для UI.

Read-only контур: в маркетплейсы ничего не пишем. Статусы МП нормализуются
в свой набор MP_ORDER_STATUS_* (сырой статус сохраняется в external_status);
у WB сборочное задание — всегда одна позиция qty=1, сырой статус хранится
парой «supplierStatus/wbStatus».
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from config import (
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_DEADLINE_SOURCE_API,
    MP_DEADLINE_SOURCE_ESTIMATED,
    MP_LINK_SOURCE_BARCODE,
    MP_ORDER_STATUS_CANCELLED,
    MP_ORDER_STATUS_DONE,
    MP_ORDER_STATUS_IN_PROGRESS,
    MP_ORDER_STATUS_NEW,
    MP_ORDER_STATUS_SHIPPED,
    MP_ORDER_TERMINAL_STATUSES,
    MP_OZON,
    MP_SYNC_KIND_CATALOG,
    MP_SYNC_KIND_ORDERS,
    MP_WB,
)
from dbconn import ci_like_substring_param

from . import clients

log = logging.getLogger("wms.mp")

_SYNC_LOG_RETENTION_DAYS = 30


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_iso(raw: object) -> datetime | None:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _wb_sla_hours() -> int:
    try:
        return max(1, int(os.environ.get("MP_WB_SLA_HOURS", "24")))
    except ValueError:
        return 24


# ── Нормализация статусов ─────────────────────────────────────────────────────

_OZON_STATUS_MAP: dict[str, str] = {
    "awaiting_registration": MP_ORDER_STATUS_NEW,
    "acceptance_in_progress": MP_ORDER_STATUS_NEW,
    "awaiting_approve": MP_ORDER_STATUS_NEW,
    "awaiting_packaging": MP_ORDER_STATUS_NEW,
    "awaiting_deliver": MP_ORDER_STATUS_IN_PROGRESS,
    "driver_pickup": MP_ORDER_STATUS_SHIPPED,
    "delivering": MP_ORDER_STATUS_SHIPPED,
    "delivered": MP_ORDER_STATUS_DONE,
    "cancelled": MP_ORDER_STATUS_CANCELLED,
    "not_accepted": MP_ORDER_STATUS_CANCELLED,
}

_WB_CANCEL_STATUSES = frozenset({"cancel", "canceled", "canceled_by_client", "declined_by_client"})
_WB_SHIPPED_STATUSES = frozenset({"sorted", "ready_for_pickup"})


def wb_external_status(supplier_status: str, wb_status: str) -> str:
    return f"{supplier_status or ''}/{wb_status or ''}"


def normalize_status(marketplace: str, external_status: str) -> str:
    """Сырой статус МП → MP_ORDER_STATUS_*. Для WB external_status — пара
    «supplierStatus/wbStatus». Неизвестное значение → in_progress (заказ жив)."""
    raw = str(external_status or "").strip().lower()
    if marketplace == MP_OZON:
        mapped = _OZON_STATUS_MAP.get(raw)
        if mapped:
            return mapped
        log.warning("Ozon: неизвестный статус отправления %r", raw)
        return MP_ORDER_STATUS_IN_PROGRESS
    supplier, _, wb = raw.partition("/")
    if supplier in _WB_CANCEL_STATUSES or wb in _WB_CANCEL_STATUSES:
        return MP_ORDER_STATUS_CANCELLED
    if wb == "sold":
        return MP_ORDER_STATUS_DONE
    if wb in _WB_SHIPPED_STATUSES:
        return MP_ORDER_STATUS_SHIPPED
    if supplier in ("confirm", "complete"):
        return MP_ORDER_STATUS_IN_PROGRESS
    if supplier == "new":
        return MP_ORDER_STATUS_NEW
    log.warning("WB: неизвестный статус сборочного задания %r", raw)
    return MP_ORDER_STATUS_IN_PROGRESS


def compute_deadline(marketplace: str, payload: dict) -> tuple[str | None, str | None]:
    """Дедлайн сборки. Ozon отдаёт shipment_date явно; WB дедлайна не отдаёт —
    считаем createdAt + MP_WB_SLA_HOURS (признак estimated)."""
    if marketplace == MP_OZON:
        dt = _parse_iso(payload.get("shipment_date"))
        if dt is None:
            return None, None
        return dt.isoformat(), MP_DEADLINE_SOURCE_API
    created = _parse_iso(payload.get("createdAt"))
    if created is None:
        return None, None
    return (created + timedelta(hours=_wb_sla_hours())).isoformat(), MP_DEADLINE_SOURCE_ESTIMATED


# ── Разбор заказов ────────────────────────────────────────────────────────────

def _rub_to_kopecks(raw: object) -> int | None:
    try:
        return round(float(str(raw)) * 100)
    except (TypeError, ValueError):
        return None


def parse_ozon_posting(posting: dict) -> dict:
    """Отправление Ozon → нормализованный dict для upsert_order."""
    external_status = str(posting.get("status") or "")
    deadline_at, deadline_source = compute_deadline(MP_OZON, posting)
    lines = []
    for product in posting.get("products") or []:
        lines.append({
            "offer_id": str(product.get("offer_id") or "") or None,
            "title": str(product.get("name") or "") or None,
            "qty": int(product.get("quantity") or 1),
            "price_kopecks": _rub_to_kopecks(product.get("price")),
            "barcodes": [],
            "nm_id": None,
        })
    created = _parse_iso(posting.get("in_process_at"))
    return {
        "external_id": str(posting.get("posting_number") or ""),
        "external_status": external_status,
        "status": normalize_status(MP_OZON, external_status),
        "created_at_mp": created.isoformat() if created else None,
        "deadline_at": deadline_at,
        "deadline_source": deadline_source,
        "total_qty": sum(line["qty"] for line in lines),
        "payload": json.dumps(posting, ensure_ascii=False),
        "lines": lines,
    }


def parse_wb_order(order: dict, *, supplier_status: str = "new", wb_status: str = "waiting") -> dict:
    """Сборочное задание WB → нормализованный dict. Задание = одна позиция qty=1;
    price у WB уже в копейках (цена × 100)."""
    external_status = wb_external_status(supplier_status, wb_status)
    deadline_at, deadline_source = compute_deadline(MP_WB, order)
    price = order.get("price")
    created = _parse_iso(order.get("createdAt"))
    return {
        "external_id": str(order.get("id") or ""),
        "external_status": external_status,
        "status": normalize_status(MP_WB, external_status),
        "created_at_mp": created.isoformat() if created else None,
        "deadline_at": deadline_at,
        "deadline_source": deadline_source,
        "total_qty": 1,
        "payload": json.dumps(order, ensure_ascii=False),
        "lines": [{
            "offer_id": str(order.get("article") or "") or None,
            "title": None,
            "qty": 1,
            "price_kopecks": int(price) if isinstance(price, (int, float)) else None,
            "barcodes": [str(s) for s in (order.get("skus") or [])],
            "nm_id": str(order.get("nmId") or "") or None,
        }],
    }


# ── Upsert заказов ────────────────────────────────────────────────────────────

def _find_mp_product_id(connection, account_id: str, marketplace: str, line: dict) -> str | None:
    """Карточка МП для строки заказа: Ozon — по offer_id; WB — по nmId,
    при нескольких размерах уточняем пересечением ШК."""
    if marketplace == MP_OZON:
        if not line.get("offer_id"):
            return None
        row = connection.execute(
            "SELECT id FROM mp_products WHERE account_id = ? AND offer_id = ? LIMIT 1",
            (account_id, line["offer_id"]),
        ).fetchone()
        return str(row["id"]) if row else None
    if not line.get("nm_id"):
        return None
    rows = connection.execute(
        "SELECT id, barcodes FROM mp_products WHERE account_id = ? AND external_id = ?",
        (account_id, line["nm_id"]),
    ).fetchall()
    if not rows:
        return None
    order_barcodes = set(line.get("barcodes") or [])
    if order_barcodes:
        for row in rows:
            try:
                card_barcodes = set(json.loads(row["barcodes"] or "[]"))
            except ValueError:
                card_barcodes = set()
            if card_barcodes & order_barcodes:
                return str(row["id"])
    return str(rows[0]["id"])


def upsert_order(connection, account_id: str, marketplace: str, parsed: dict) -> str:
    """Идемпотентный upsert заказа. Возвращает 'created' | 'updated' | 'unchanged'.
    Строки пишутся один раз при создании — состав заказа на МП не меняется."""
    if not parsed["external_id"]:
        return "unchanged"
    now = _now()
    existing = connection.execute(
        "SELECT id, status, external_status FROM mp_orders WHERE account_id = ? AND external_id = ?",
        (account_id, parsed["external_id"]),
    ).fetchone()
    if existing:
        if (str(existing["status"]) == parsed["status"]
                and str(existing["external_status"]) == parsed["external_status"]):
            return "unchanged"
        connection.execute(
            "UPDATE mp_orders SET status = ?, external_status = ?, deadline_at = ?, "
            "deadline_source = ?, payload = ?, updated_at = ? WHERE id = ?",
            (parsed["status"], parsed["external_status"], parsed["deadline_at"],
             parsed["deadline_source"], parsed["payload"], now, str(existing["id"])),
        )
        return "updated"
    order_id = str(uuid4())
    connection.execute(
        "INSERT INTO mp_orders (id, account_id, external_id, status, external_status, "
        "created_at_mp, deadline_at, deadline_source, total_qty, payload, first_seen_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (order_id, account_id, parsed["external_id"], parsed["status"], parsed["external_status"],
         parsed["created_at_mp"], parsed["deadline_at"], parsed["deadline_source"],
         parsed["total_qty"], parsed["payload"], now, now),
    )
    for line in parsed["lines"]:
        connection.execute(
            "INSERT INTO mp_order_lines (id, order_id, mp_product_id, offer_id, title, qty, price_kopecks) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), order_id,
             _find_mp_product_id(connection, account_id, marketplace, line),
             line["offer_id"], line["title"], line["qty"], line["price_kopecks"]),
        )
    return "created"


def _apply_wb_status(connection, account_id: str, external_id: str, supplier_status: str, wb_status: str) -> bool:
    external = wb_external_status(supplier_status, wb_status)
    status = normalize_status(MP_WB, external)
    row = connection.execute(
        "SELECT id, status, external_status FROM mp_orders WHERE account_id = ? AND external_id = ?",
        (account_id, external_id),
    ).fetchone()
    if not row or (str(row["status"]) == status and str(row["external_status"]) == external):
        return False
    connection.execute(
        "UPDATE mp_orders SET status = ?, external_status = ?, updated_at = ? WHERE id = ?",
        (status, external, _now(), str(row["id"])),
    )
    return True


# ── Синхронизация ─────────────────────────────────────────────────────────────

def write_sync_log(connection, account_id: str, kind: str, *, ok: bool,
                   stats: dict | None = None, error: str | None = None) -> None:
    connection.execute(
        "INSERT INTO mp_sync_log (id, account_id, kind, ok, stats, error, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (str(uuid4()), account_id, kind, 1 if ok else 0,
         json.dumps(stats, ensure_ascii=False) if stats else None,
         (error or None), _now()),
    )


def purge_sync_log(connection) -> None:
    threshold = (datetime.now(UTC) - timedelta(days=_SYNC_LOG_RETENTION_DAYS)).isoformat()
    connection.execute("DELETE FROM mp_sync_log WHERE created_at < ?", (threshold,))


def _account_creds(account) -> dict:
    return {"ozon_client_id": account["ozon_client_id"], "api_key": account["api_key"]}


def check_account(account) -> None:
    """Проверка связи с кабинетом; MpApiError наружу."""
    creds = _account_creds(account)
    if str(account["marketplace"]) == MP_OZON:
        clients.ozon_check(creds)
    else:
        clients.wb_check(creds)


def _known_open_external_ids(connection, account_id: str, exclude: set[str]) -> list[str]:
    rows = connection.execute(
        "SELECT external_id FROM mp_orders WHERE account_id = ? AND status NOT IN (?, ?)",
        (account_id, MP_ORDER_STATUS_DONE, MP_ORDER_STATUS_CANCELLED),
    ).fetchall()
    return [str(r["external_id"]) for r in rows if str(r["external_id"]) not in exclude]


def sync_account_orders(connection, account) -> dict:
    """Один цикл синка заказов по аккаунту. MpApiError наружу — вызывающий
    решает, как фиксировать сбой."""
    account_id = str(account["id"])
    marketplace = str(account["marketplace"])
    creds = _account_creds(account)
    stats = {"fetched": 0, "created": 0, "updated": 0}

    def _apply(parsed: dict) -> None:
        stats["fetched"] += 1
        outcome = upsert_order(connection, account_id, marketplace, parsed)
        if outcome in ("created", "updated"):
            stats[outcome] += 1

    if marketplace == MP_OZON:
        fetched_ids: set[str] = set()
        for posting in clients.ozon_fetch_open_postings(creds):
            parsed = parse_ozon_posting(posting)
            fetched_ids.add(parsed["external_id"])
            _apply(parsed)
        stale_ids = _known_open_external_ids(connection, account_id, fetched_ids)
        if stale_ids:
            for posting in clients.ozon_fetch_postings(creds, stale_ids):
                _apply(parse_ozon_posting(posting))
    else:
        for order in clients.wb_fetch_new_orders(creds):
            _apply(parse_wb_order(order))
        known_ids = _known_open_external_ids(connection, account_id, set())
        if known_ids:
            numeric_ids = [int(x) for x in known_ids if x.isdigit()]
            for entry in clients.wb_fetch_order_statuses(creds, numeric_ids):
                if _apply_wb_status(
                    connection, account_id, str(entry.get("id") or ""),
                    str(entry.get("supplierStatus") or ""), str(entry.get("wbStatus") or ""),
                ):
                    stats["updated"] += 1

    connection.execute(
        "UPDATE mp_accounts SET last_sync_at = ?, last_sync_error = NULL WHERE id = ?",
        (_now(), account_id),
    )
    write_sync_log(connection, account_id, MP_SYNC_KIND_ORDERS, ok=True, stats=stats)
    return stats


def run_marketplace_sync(connection) -> dict:
    """Прогон по всем активным подключениям. Сбой одного кабинета не мешает
    остальным: ошибка пишется в last_sync_error + журнал, коммит — по аккаунту."""
    accounts = connection.execute(
        "SELECT * FROM mp_accounts WHERE status = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY created_at ASC",
        (MP_ACCOUNT_STATUS_ACTIVE,),
    ).fetchall()
    totals = {"accounts": 0, "failed": 0, "fetched": 0, "created": 0, "updated": 0}
    for account in accounts:
        totals["accounts"] += 1
        try:
            stats = sync_account_orders(connection, account)
            for key in ("fetched", "created", "updated"):
                totals[key] += stats[key]
        except Exception as exc:
            connection.rollback()
            totals["failed"] += 1
            message = str(exc)[:500]
            log.warning("Синк кабинета %s не удался: %s", account["name"], message)
            connection.execute(
                "UPDATE mp_accounts SET last_sync_error = ? WHERE id = ?",
                (message, str(account["id"])),
            )
            write_sync_log(connection, str(account["id"]), MP_SYNC_KIND_ORDERS, ok=False, error=message)
        connection.commit()
    purge_sync_log(connection)
    connection.commit()
    return totals


# ── Каталог и связка ──────────────────────────────────────────────────────────

def _upsert_mp_product(connection, account_id: str, *, external_id: str, external_size: str | None,
                       offer_id: str | None, title: str | None, barcodes: list[str],
                       payload: dict | None) -> None:
    now = _now()
    barcodes_json = json.dumps(barcodes, ensure_ascii=False)
    payload_json = json.dumps(payload, ensure_ascii=False) if payload is not None else None
    row = connection.execute(
        "SELECT id FROM mp_products WHERE account_id = ? AND external_id = ? "
        "AND COALESCE(external_size, '') = ?",
        (account_id, external_id, external_size or ""),
    ).fetchone()
    if row:
        connection.execute(
            "UPDATE mp_products SET offer_id = ?, title = ?, barcodes = ?, payload = ?, updated_at = ? "
            "WHERE id = ?",
            (offer_id, title, barcodes_json, payload_json, now, str(row["id"])),
        )
        return
    connection.execute(
        "INSERT INTO mp_products (id, account_id, external_id, offer_id, title, barcodes, "
        "external_size, payload, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (str(uuid4()), account_id, external_id, offer_id, title, barcodes_json,
         external_size, payload_json, now),
    )


def sync_account_catalog(connection, account) -> dict:
    """Обновить кэш карточек МП + прогнать авто-связку по ШК."""
    account_id = str(account["id"])
    marketplace = str(account["marketplace"])
    creds = _account_creds(account)
    fetched = 0
    if marketplace == MP_OZON:
        for item in clients.ozon_fetch_products(creds):
            external_id = str(item.get("id") or item.get("product_id") or "")
            if not external_id:
                continue
            fetched += 1
            _upsert_mp_product(
                connection, account_id,
                external_id=external_id, external_size=None,
                offer_id=str(item.get("offer_id") or "") or None,
                title=str(item.get("name") or "") or None,
                barcodes=[str(b) for b in (item.get("barcodes") or []) if str(b)],
                payload=item,
            )
    else:
        for card in clients.wb_fetch_cards(creds):
            nm_id = str(card.get("nmID") or "")
            if not nm_id:
                continue
            sizes = card.get("sizes") or [{}]
            for size in sizes:
                fetched += 1
                _upsert_mp_product(
                    connection, account_id,
                    external_id=nm_id,
                    external_size=str(size.get("techSize") or "") or None,
                    offer_id=str(card.get("vendorCode") or "") or None,
                    title=str(card.get("title") or "") or None,
                    barcodes=[str(s) for s in (size.get("skus") or []) if str(s)],
                    payload=card,
                )
    linked = auto_link_by_barcode(connection, account)
    stats = {"fetched": fetched, "auto_linked": linked}
    write_sync_log(connection, account_id, MP_SYNC_KIND_CATALOG, ok=True, stats=stats)
    return stats


def _products_by_barcodes(connection, client_id: str, barcodes: list[str]) -> dict[str, dict]:
    """ШК → товар (только товары этого клиента, активные записи)."""
    if not barcodes:
        return {}
    placeholders = ",".join("?" for _ in barcodes)
    rows = connection.execute(
        f"""
        SELECT pb.barcode, p.id AS product_id, p.sku AS product_sku, p.name AS product_name
        FROM product_barcodes pb
        JOIN products p ON p.id = pb.product_id
        WHERE pb.barcode IN ({placeholders})
          AND COALESCE(pb.is_deleted, 0) = 0
          AND COALESCE(p.is_deleted, 0) = 0
          AND p.client_id = ?
        """,
        [*barcodes, client_id],
    ).fetchall()
    return {str(r["barcode"]): dict(r) for r in rows}


def auto_link_by_barcode(connection, account) -> int:
    """Связать несвязанные карточки МП с товарами WMS по точному совпадению ШК.
    Карточка с ШК, ведущими к разным товарам, — конфликт, не связываем."""
    account_id = str(account["id"])
    client_id = str(account["client_id"])
    rows = connection.execute(
        """
        SELECT mp.id, mp.barcodes FROM mp_products mp
        WHERE mp.account_id = ?
          AND NOT EXISTS (
              SELECT 1 FROM mp_product_links pl
              WHERE pl.mp_product_id = mp.id AND COALESCE(pl.is_deleted, 0) = 0
          )
        """,
        (account_id,),
    ).fetchall()
    linked = 0
    now = _now()
    for row in rows:
        try:
            barcodes = [str(b) for b in json.loads(row["barcodes"] or "[]") if str(b)]
        except ValueError:
            continue
        matches = _products_by_barcodes(connection, client_id, barcodes)
        product_ids = {str(m["product_id"]) for m in matches.values()}
        if len(product_ids) != 1:
            continue
        match = next(iter(matches.values()))
        connection.execute(
            "INSERT INTO mp_product_links (id, mp_product_id, product_id, variant_id, "
            "link_source, created_at, created_by) VALUES (?,?,?,NULL,?,?,?)",
            (str(uuid4()), str(row["id"]), str(match["product_id"]),
             MP_LINK_SOURCE_BARCODE, now, None),
        )
        linked += 1
    return linked


# ── Выборки для UI ────────────────────────────────────────────────────────────

def _order_conditions(*, account_id, client_id, marketplace, status, overdue, search):
    conds = ["COALESCE(a.is_deleted, 0) = 0"]
    params: list = []
    if account_id:
        conds.append("o.account_id = ?")
        params.append(account_id)
    if client_id:
        conds.append("a.client_id = ?")
        params.append(client_id)
    if marketplace:
        conds.append("a.marketplace = ?")
        params.append(marketplace)
    if status:
        conds.append("o.status = ?")
        params.append(status)
    else:
        placeholders = ",".join("?" for _ in MP_ORDER_TERMINAL_STATUSES)
        conds.append(f"o.status NOT IN ({placeholders})")
        params.extend(sorted(MP_ORDER_TERMINAL_STATUSES))
    if overdue:
        conds.append("o.deadline_at IS NOT NULL AND o.deadline_at < ? AND o.status IN (?, ?)")
        params.extend([_now(), MP_ORDER_STATUS_NEW, MP_ORDER_STATUS_IN_PROGRESS])
    if search and search.strip():
        like = ci_like_substring_param(search)
        conds.append(
            "(fold_ci(o.external_id) LIKE ? OR EXISTS ("
            "SELECT 1 FROM mp_order_lines sl WHERE sl.order_id = o.id AND ("
            "fold_ci(COALESCE(sl.title, '')) LIKE ? OR fold_ci(COALESCE(sl.offer_id, '')) LIKE ?)))"
        )
        params.extend([like, like, like])
    return " AND ".join(conds), params


_ORDER_SELECT = """
    SELECT o.id, o.external_id, o.status, o.external_status, o.created_at_mp,
           o.deadline_at, o.deadline_source, o.total_qty, o.first_seen_at, o.updated_at,
           a.id AS account_id, a.name AS account_name, a.marketplace,
           a.client_id, c.name AS client_name,
           (SELECT COUNT(*) FROM mp_order_lines l WHERE l.order_id = o.id) AS lines_total,
           (SELECT COUNT(*) FROM mp_order_lines l
            JOIN mp_product_links pl ON pl.mp_product_id = l.mp_product_id
              AND COALESCE(pl.is_deleted, 0) = 0
            WHERE l.order_id = o.id) AS lines_linked
    FROM mp_orders o
    JOIN mp_accounts a ON a.id = o.account_id
    LEFT JOIN clients c ON c.id = a.client_id
"""


def list_orders(connection, *, page: int, limit: int, account_id=None, client_id=None,
                marketplace=None, status=None, overdue=False, search=None) -> dict:
    where, params = _order_conditions(
        account_id=account_id, client_id=client_id, marketplace=marketplace,
        status=status, overdue=overdue, search=search,
    )
    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM mp_orders o JOIN mp_accounts a ON a.id = o.account_id WHERE {where}",
        params,
    ).fetchone()["n"])
    rows = connection.execute(
        f"{_ORDER_SELECT} WHERE {where} "
        "ORDER BY o.deadline_at ASC NULLS LAST, o.created_at_mp DESC NULLS LAST, o.first_seen_at DESC "
        "LIMIT ? OFFSET ?",
        [*params, limit, (page - 1) * limit],
    ).fetchall()
    return {"items": [dict(r) for r in rows], "total": total, "page": page, "limit": limit}


def orders_summary(connection, *, account_id=None, client_id=None, marketplace=None, search=None) -> dict:
    where, params = _order_conditions(
        account_id=account_id, client_id=client_id, marketplace=marketplace,
        status=None, overdue=False, search=search,
    )
    rows = connection.execute(
        f"SELECT o.status, COUNT(*) AS n FROM mp_orders o "
        f"JOIN mp_accounts a ON a.id = o.account_id WHERE {where} GROUP BY o.status",
        params,
    ).fetchall()
    by_status = {str(r["status"]): int(r["n"]) for r in rows}
    overdue_row = connection.execute(
        f"SELECT COUNT(*) AS n FROM mp_orders o JOIN mp_accounts a ON a.id = o.account_id "
        f"WHERE {where} AND o.deadline_at IS NOT NULL AND o.deadline_at < ? AND o.status IN (?, ?)",
        [*params, _now(), MP_ORDER_STATUS_NEW, MP_ORDER_STATUS_IN_PROGRESS],
    ).fetchone()
    return {"by_status": by_status, "overdue_count": int(overdue_row["n"])}


def order_detail(connection, order_id: str) -> dict | None:
    row = connection.execute(f"{_ORDER_SELECT} WHERE o.id = ?", (order_id,)).fetchone()
    if not row:
        return None
    lines = connection.execute(
        """
        SELECT l.id, l.offer_id, l.title, l.qty, l.price_kopecks, l.mp_product_id,
               mp.external_id AS mp_external_id, mp.external_size,
               mp.title AS mp_title, mp.offer_id AS mp_offer_id,
               pl.id AS link_id, pl.product_id, pl.variant_id,
               p.name AS product_name,
               COALESCE(NULLIF(v.sku, ''), p.sku) AS product_sku,
               col.name AS color_name, s.name AS size_name
        FROM mp_order_lines l
        LEFT JOIN mp_products mp ON mp.id = l.mp_product_id
        LEFT JOIN mp_product_links pl ON pl.mp_product_id = l.mp_product_id
          AND COALESCE(pl.is_deleted, 0) = 0
        LEFT JOIN products p ON p.id = pl.product_id
        LEFT JOIN product_variants v ON v.id = pl.variant_id
        LEFT JOIN colors col ON col.id = v.color_id
        LEFT JOIN sizes s ON s.id = v.size_id
        WHERE l.order_id = ?
        ORDER BY l.offer_id ASC NULLS LAST
        """,
        (order_id,),
    ).fetchall()
    items = []
    for line in lines:
        d = dict(line)
        d["title"] = d["title"] or d.pop("mp_title", None)
        d.pop("mp_title", None)
        d["offer_id"] = d["offer_id"] or d.pop("mp_offer_id", None)
        d.pop("mp_offer_id", None)
        d["linked"] = d["link_id"] is not None
        d.pop("link_id", None)
        items.append(d)
    return {"doc": dict(row), "lines": items}


def list_mp_products(connection, account, *, page: int, limit: int,
                     linked: str = "all", search=None) -> dict:
    account_id = str(account["id"])
    client_id = str(account["client_id"])
    conds = ["mp.account_id = ?"]
    params: list = [account_id]
    link_exists = (
        "EXISTS (SELECT 1 FROM mp_product_links pl "
        "WHERE pl.mp_product_id = mp.id AND COALESCE(pl.is_deleted, 0) = 0)"
    )
    if linked == "linked":
        conds.append(link_exists)
    elif linked == "unlinked":
        conds.append(f"NOT {link_exists}")
    if search and search.strip():
        like = ci_like_substring_param(search)
        conds.append(
            "(fold_ci(COALESCE(mp.offer_id, '')) LIKE ? OR fold_ci(COALESCE(mp.title, '')) LIKE ? "
            "OR mp.barcodes LIKE ?)"
        )
        params.extend([like, like, f"%{str(search).strip()}%"])
    where = " AND ".join(conds)
    total = int(connection.execute(
        f"SELECT COUNT(*) AS n FROM mp_products mp WHERE {where}", params
    ).fetchone()["n"])
    rows = connection.execute(
        f"""
        SELECT mp.id, mp.external_id, mp.external_size, mp.offer_id, mp.title, mp.barcodes,
               pl.link_source, pl.product_id, pl.variant_id,
               p.name AS product_name,
               COALESCE(NULLIF(v.sku, ''), p.sku) AS product_sku,
               col.name AS color_name, s.name AS size_name
        FROM mp_products mp
        LEFT JOIN mp_product_links pl ON pl.mp_product_id = mp.id
          AND COALESCE(pl.is_deleted, 0) = 0
        LEFT JOIN products p ON p.id = pl.product_id
        LEFT JOIN product_variants v ON v.id = pl.variant_id
        LEFT JOIN colors col ON col.id = v.color_id
        LEFT JOIN sizes s ON s.id = v.size_id
        WHERE {where}
        ORDER BY LOWER(COALESCE(mp.offer_id, mp.title, '')) ASC, mp.external_size ASC NULLS FIRST
        LIMIT ? OFFSET ?
        """,
        [*params, limit, (page - 1) * limit],
    ).fetchall()

    # Подсказка авто-связки и конфликт ШК — по всем штрихкодам страницы одним запросом.
    page_barcodes: list[str] = []
    parsed_barcodes: dict[str, list[str]] = {}
    for r in rows:
        try:
            codes = [str(b) for b in json.loads(r["barcodes"] or "[]") if str(b)]
        except ValueError:
            codes = []
        parsed_barcodes[str(r["id"])] = codes
        page_barcodes.extend(codes)
    matches = _products_by_barcodes(connection, client_id, page_barcodes)

    items = []
    for r in rows:
        d = dict(r)
        codes = parsed_barcodes[str(r["id"])]
        d["barcodes"] = codes
        d["linked"] = d["product_id"] is not None
        row_matches = {c: matches[c] for c in codes if c in matches}
        product_ids = {str(m["product_id"]) for m in row_matches.values()}
        d["barcode_conflict"] = (not d["linked"]) and len(product_ids) > 1
        suggestion = None
        if not d["linked"] and len(product_ids) == 1:
            m = next(iter(row_matches.values()))
            suggestion = {
                "product_id": str(m["product_id"]),
                "product_sku": m["product_sku"],
                "product_name": m["product_name"],
            }
        d["suggestion"] = suggestion
        items.append(d)
    return {"items": items, "total": total, "page": page, "limit": limit}


def link_mp_product(connection, mp_product_id: str, *, product_id: str,
                    variant_id: str | None, user_id: str, source: str) -> None:
    """Связать карточку МП с товаром WMS. Товар обязан принадлежать клиенту кабинета."""
    from fastapi import HTTPException

    mp_row = connection.execute(
        "SELECT mp.id, a.client_id FROM mp_products mp "
        "JOIN mp_accounts a ON a.id = mp.account_id WHERE mp.id = ?",
        (mp_product_id,),
    ).fetchone()
    if not mp_row:
        raise HTTPException(status_code=404, detail="Карточка маркетплейса не найдена")
    product = connection.execute(
        "SELECT id, client_id FROM products WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (product_id,),
    ).fetchone()
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if str(product["client_id"] or "") != str(mp_row["client_id"] or ""):
        raise HTTPException(status_code=400, detail="Товар принадлежит другому клиенту")
    if variant_id:
        variant = connection.execute(
            "SELECT id FROM product_variants WHERE id = ? AND product_id = ? "
            "AND COALESCE(is_deleted, 0) = 0",
            (variant_id, product_id),
        ).fetchone()
        if not variant:
            raise HTTPException(status_code=400, detail="Вариант не относится к этому товару")
    connection.execute(
        "UPDATE mp_product_links SET is_deleted = 1 WHERE mp_product_id = ? AND COALESCE(is_deleted, 0) = 0",
        (mp_product_id,),
    )
    connection.execute(
        "INSERT INTO mp_product_links (id, mp_product_id, product_id, variant_id, "
        "link_source, created_at, created_by) VALUES (?,?,?,?,?,?,?)",
        (str(uuid4()), mp_product_id, product_id, variant_id, source, _now(), user_id),
    )


def unlink_mp_product(connection, mp_product_id: str) -> bool:
    cursor = connection.execute(
        "UPDATE mp_product_links SET is_deleted = 1 WHERE mp_product_id = ? AND COALESCE(is_deleted, 0) = 0",
        (mp_product_id,),
    )
    return bool(getattr(cursor, "rowcount", 0))
