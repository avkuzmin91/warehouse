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

from fastapi import HTTPException

from config import (
    CONTAINER_STATUS_PLACED,
    INV_OP_PICKED,
    INV_OP_SHIPPED,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_BARCODE_PULL_AMBIGUOUS,
    MP_BARCODE_PULL_CONFLICT,
    MP_BARCODE_PULL_EXISTS,
    MP_BARCODE_PULL_NO_ACCOUNT,
    MP_BARCODE_PULL_NO_STORE,
    MP_BARCODE_PULL_NO_VARIANT,
    MP_BARCODE_PULL_NOT_FOUND,
    MP_BARCODE_PULL_READY,
    MP_BARCODE_SOURCE_LABELS,
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
    MP_SUPPLY_ACTIVE_STATUSES,
    MP_SUPPLY_INTAKE_CLOSE_MINUTES,
    MP_SUPPLY_INTAKE_STATUSES,
    MP_SUPPLY_OP_CLAIM,
    MP_SUPPLY_OP_CREATE,
    MP_SUPPLY_OP_INTAKE_CLOSE,
    MP_SUPPLY_OP_ORDER_ADD,
    MP_SUPPLY_OP_ORDER_DOCK,
    MP_SUPPLY_OP_ORDER_REMOVE,
    MP_SUPPLY_OP_PICK,
    MP_SUPPLY_OP_PICK_UNDO,
    MP_SUPPLY_OP_RELEASE,
    MP_SUPPLY_OP_STATUS,
    MP_SUPPLY_ORDER_PENDING,
    MP_SUPPLY_ORDER_SELECTED,
    MP_SUPPLY_ORDER_UNSELECTED,
    MP_SUPPLY_STATUS_CANCELLED,
    MP_SUPPLY_STATUS_CHECKING,
    MP_SUPPLY_STATUS_DONE,
    MP_SUPPLY_STATUS_DRAFT,
    MP_SUPPLY_STATUS_HANDOVER,
    MP_SUPPLY_STATUS_LABELS,
    MP_SUPPLY_STATUS_PICKING,
    MP_SUPPLY_TERMINAL_STATUSES,
    MP_SYNC_KIND_CATALOG,
    MP_SYNC_KIND_ORDERS,
    MP_WB,
)
from dbconn import ci_like_substring_param
from utils import next_doc_number as _next_doc_number

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
    return {
        "ozon_client_id": account["ozon_client_id"],
        "api_key": account["api_key"],
        "is_sandbox": bool(account["is_sandbox"]),
    }


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
    totals = {"accounts": 0, "failed": 0, "fetched": 0, "created": 0, "updated": 0,
              "routed": 0, "docked": 0, "supplies_created": 0}
    for account in accounts:
        totals["accounts"] += 1
        try:
            stats = sync_account_orders(connection, account)
            for key in ("fetched", "created", "updated"):
                totals[key] += stats[key]
            # Разложить пришедшее по поставкам сразу: кучи «нераспределённых
            # заказов» не должно существовать ни в одну секунду.
            routing = route_orders_into_supplies(connection, account)
            for key in ("routed", "docked", "supplies_created"):
                totals[key] += routing[key]
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
    totals["cancelled_released"] = release_cancelled_orders(connection)
    totals["intakes_closed"] = close_due_intakes(connection)
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


def _variants_by_barcodes(connection, client_id: str, barcodes: list[str]) -> dict[str, dict]:
    """ШК → вариант (только товары этого клиента, активные записи)."""
    if not barcodes:
        return {}
    placeholders = ",".join("?" for _ in barcodes)
    rows = connection.execute(
        f"""
        SELECT pb.barcode, v.id AS variant_id, p.id AS product_id,
               COALESCE(NULLIF(v.sku, ''), p.sku) AS product_sku,
               p.name AS product_name,
               col.name AS color_name, s.name AS size_name
        FROM product_barcodes pb
        JOIN product_variants v ON v.id = pb.variant_id
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN colors col ON col.id = v.color_id
        LEFT JOIN sizes s ON s.id = v.size_id
        WHERE pb.barcode IN ({placeholders})
          AND COALESCE(pb.is_deleted, 0) = 0
          AND COALESCE(v.is_deleted, 0) = 0
          AND COALESCE(p.is_deleted, 0) = 0
          AND p.client_id = ?
        """,
        [*barcodes, client_id],
    ).fetchall()
    return {str(r["barcode"]): dict(r) for r in rows}


def auto_link_by_barcode(connection, account) -> int:
    """Связать несвязанные карточки МП с вариантами WMS по точному совпадению ШК.
    Карточка с ШК, ведущими к разным вариантам, — конфликт, не связываем."""
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
        matches = _variants_by_barcodes(connection, client_id, barcodes)
        variant_ids = {str(m["variant_id"]) for m in matches.values()}
        if len(variant_ids) != 1:
            continue
        match = next(iter(matches.values()))
        connection.execute(
            "INSERT INTO mp_product_links (id, mp_product_id, product_id, variant_id, "
            "link_source, created_at, created_by) VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), str(row["id"]), str(match["product_id"]), str(match["variant_id"]),
             MP_LINK_SOURCE_BARCODE, now, None),
        )
        linked += 1
    return linked


# ── Выборки для UI ────────────────────────────────────────────────────────────

def _order_conditions(*, account_id, client_id, marketplace, status, overdue, search,
                      no_supply=False):
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
    if no_supply:
        conds.append(
            "NOT EXISTS (SELECT 1 FROM mp_supply_orders zso "
            "            WHERE zso.order_id = o.id AND zso.state IN (?, ?))"
        )
        params.extend([MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_PENDING])
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
            WHERE l.order_id = o.id) AS lines_linked,
           sup.id AS supply_id, sup.doc_number AS supply_number, sup.status AS supply_status
    FROM mp_orders o
    JOIN mp_accounts a ON a.id = o.account_id
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN mp_supply_orders so ON so.order_id = o.id AND so.state IN ('selected', 'pending')
    LEFT JOIN mp_supplies sup ON sup.id = so.supply_id
"""


def list_orders(connection, *, page: int, limit: int, account_id=None, client_id=None,
                marketplace=None, status=None, overdue=False, search=None,
                no_supply=False) -> dict:
    where, params = _order_conditions(
        account_id=account_id, client_id=client_id, marketplace=marketplace,
        status=status, overdue=overdue, search=search, no_supply=no_supply,
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
    matches = _variants_by_barcodes(connection, client_id, page_barcodes)

    items = []
    for r in rows:
        d = dict(r)
        codes = parsed_barcodes[str(r["id"])]
        d["barcodes"] = codes
        d["linked"] = d["product_id"] is not None
        row_matches = {c: matches[c] for c in codes if c in matches}
        variant_ids = {str(m["variant_id"]) for m in row_matches.values()}
        d["barcode_conflict"] = (not d["linked"]) and len(variant_ids) > 1
        suggestion = None
        if not d["linked"] and len(variant_ids) == 1:
            m = next(iter(row_matches.values()))
            suggestion = {
                "product_id": str(m["product_id"]),
                "variant_id": str(m["variant_id"]),
                "product_sku": m["product_sku"],
                "product_name": m["product_name"],
                "color_name": m["color_name"],
                "size_name": m["size_name"],
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


# ── Подтягивание ШК маркетплейса в вариант ────────────────────────────────────
#
# Обратное направление к auto_link_by_barcode: там ШК уже был у варианта и вёл
# к карточке МП, здесь ШК берётся из карточки. Кабинет определяет магазин позиции
# (client_stores.mp_account_id) — у клиента их может быть несколько на одном МП,
# и у одного варианта в двух магазинах разные ШК, поэтому записанный ШК помнит
# свой магазин (product_barcodes.store_id).


def _norm_offer(value) -> str:
    return " ".join(str(value or "").split()).casefold()


def _norm_size(value) -> str:
    """Размер карточки и варианта к общему виду: у WB безразмерный товар — «0»."""
    s = " ".join(str(value or "").split()).casefold()
    return "0" if s in ("", "0", "б/р", "бр", "one size", "onesize", "os") else s


def _store_with_account(connection, store_id: str):
    return connection.execute(
        """
        SELECT s.id, s.name, s.client_id, s.mp_account_id,
               a.name AS account_name, a.marketplace
        FROM client_stores s
        LEFT JOIN mp_accounts a ON a.id = s.mp_account_id AND COALESCE(a.is_deleted, 0) = 0
        WHERE s.id = ? AND COALESCE(s.is_deleted, 0) = 0
        """,
        (store_id,),
    ).fetchone()


def _account_cards(connection, account_id: str) -> list[dict]:
    rows = connection.execute(
        "SELECT id, external_id, external_size, offer_id, title, barcodes "
        "FROM mp_products WHERE account_id = ?",
        (account_id,),
    ).fetchall()
    cards: list[dict] = []
    for row in rows:
        try:
            codes = [str(b) for b in json.loads(row["barcodes"] or "[]") if str(b)]
        except ValueError:
            codes = []
        cards.append({
            "id": str(row["id"]),
            "external_id": str(row["external_id"]),
            "external_size": row["external_size"],
            "offer_id": row["offer_id"],
            "title": row["title"],
            "barcodes": codes,
        })
    return cards


def _variant_barcodes(connection, variant_ids: list[str]) -> dict[str, list[dict]]:
    if not variant_ids:
        return {}
    placeholders = ",".join("?" for _ in variant_ids)
    rows = connection.execute(
        f"SELECT variant_id, barcode, store_id FROM product_barcodes "
        f"WHERE variant_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0",
        list(variant_ids),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(str(row["variant_id"]), []).append({
            "barcode": str(row["barcode"]),
            "store_id": row["store_id"],
        })
    return out


def _barcode_owners(connection, codes: list[str]) -> dict[str, dict]:
    """ШК → владелец (вариант, товар, магазин): активный ШК в системе уникален."""
    if not codes:
        return {}
    placeholders = ",".join("?" for _ in codes)
    rows = connection.execute(
        f"""
        SELECT pb.barcode, pb.product_id, pb.variant_id, pb.store_id,
               p.name AS product_name, col.name AS color_name, sz.name AS size_name,
               st.name AS store_name
        FROM product_barcodes pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN product_variants v ON v.id = pb.variant_id
        LEFT JOIN colors col ON col.id = v.color_id
        LEFT JOIN sizes sz ON sz.id = v.size_id
        LEFT JOIN client_stores st ON st.id = pb.store_id
        WHERE pb.barcode IN ({placeholders}) AND COALESCE(pb.is_deleted, 0) = 0
        """,
        list(codes),
    ).fetchall()
    return {str(r["barcode"]): dict(r) for r in rows}


def _linked_card_ids(connection, account_id: str, variant_ids: list[str]) -> dict[str, set[str]]:
    if not variant_ids:
        return {}
    placeholders = ",".join("?" for _ in variant_ids)
    rows = connection.execute(
        f"""
        SELECT pl.variant_id, pl.mp_product_id
        FROM mp_product_links pl
        JOIN mp_products mp ON mp.id = pl.mp_product_id
        WHERE mp.account_id = ? AND COALESCE(pl.is_deleted, 0) = 0
          AND pl.variant_id IN ({placeholders})
        """,
        [account_id, *variant_ids],
    ).fetchall()
    out: dict[str, set[str]] = {}
    for row in rows:
        out.setdefault(str(row["variant_id"]), set()).add(str(row["mp_product_id"]))
    return out


def _owner_label(owner: dict) -> str:
    variant = " · ".join(x for x in (owner.get("color_name"), owner.get("size_name")) if x)
    label = str(owner.get("product_name") or "другой товар")
    return f"{label} · {variant}" if variant else label


def _match_cards(cards: list[dict], *, linked_ids: set[str], own_codes: set[str],
                 sku: str | None, size_name: str | None) -> list[dict]:
    """Карточки кабинета под вариант: связка → общий ШК → артикул продавца + размер."""
    if linked_ids:
        by_link = [c for c in cards if c["id"] in linked_ids]
        if by_link:
            return by_link
    if own_codes:
        by_code = [c for c in cards if own_codes & set(c["barcodes"])]
        if by_code:
            return by_code
    offer = _norm_offer(sku)
    if not offer:
        return []
    size = _norm_size(size_name)
    return [
        c for c in cards
        if _norm_offer(c["offer_id"]) == offer and _norm_size(c["external_size"]) == size
    ]


def suggest_store_barcodes(connection, items: list[dict]) -> list[dict]:
    """Что можно записать вариантам позиций из кабинетов их магазинов.

    items: [{key, store_id, product_id, variant_id, product_sku, size_name}] —
    данные позиции берутся вызывающим доменом из БД, не с клиента."""
    variant_ids = [str(i["variant_id"]) for i in items if i.get("variant_id")]
    barcodes_by_variant = _variant_barcodes(connection, sorted(set(variant_ids)))

    stores: dict[str, dict] = {}
    cards_by_account: dict[str, list[dict]] = {}
    links_by_account: dict[str, dict[str, set[str]]] = {}
    for item in items:
        store_id = str(item.get("store_id") or "")
        if not store_id or store_id in stores:
            continue
        row = _store_with_account(connection, store_id)
        stores[store_id] = dict(row) if row else {}
        account_id = str((stores[store_id] or {}).get("mp_account_id") or "")
        if account_id and account_id not in cards_by_account:
            cards_by_account[account_id] = _account_cards(connection, account_id)
            links_by_account[account_id] = _linked_card_ids(
                connection, account_id, sorted(set(variant_ids)),
            )

    out: list[dict] = []
    for item in items:
        key = str(item["key"])
        store_id = str(item.get("store_id") or "")
        store = stores.get(store_id) or {}
        base = {
            "key": key,
            "store_id": store_id or None,
            "store_name": store.get("name"),
            "marketplace": store.get("marketplace"),
            "account_name": store.get("account_name"),
            "card_external_id": None,
            "card_offer_id": None,
            "card_size": None,
            "card_barcodes": [],
            "new_barcodes": [],
            "conflicts": [],
        }
        if not store_id:
            out.append({**base, "status": MP_BARCODE_PULL_NO_STORE})
            continue
        account_id = str(store.get("mp_account_id") or "")
        if not account_id:
            out.append({**base, "status": MP_BARCODE_PULL_NO_ACCOUNT})
            continue
        variant_id = str(item.get("variant_id") or "")
        if not variant_id:
            out.append({**base, "status": MP_BARCODE_PULL_NO_VARIANT})
            continue

        own = barcodes_by_variant.get(variant_id, [])
        matched = _match_cards(
            cards_by_account.get(account_id, []),
            linked_ids=links_by_account.get(account_id, {}).get(variant_id, set()),
            own_codes={b["barcode"] for b in own},
            sku=item.get("product_sku"),
            size_name=item.get("size_name"),
        )
        if not matched:
            out.append({**base, "status": MP_BARCODE_PULL_NOT_FOUND})
            continue
        if len({c["id"] for c in matched}) > 1:
            out.append({**base, "status": MP_BARCODE_PULL_AMBIGUOUS,
                        "card_barcodes": sorted({c for card in matched for c in card["barcodes"]})})
            continue

        card = matched[0]
        info = {
            **base,
            "card_external_id": card["external_id"],
            "card_offer_id": card["offer_id"],
            "card_size": card["external_size"],
            "card_barcodes": card["barcodes"],
        }
        owners = _barcode_owners(connection, card["barcodes"])
        new_codes: list[str] = []
        adopt_codes: list[str] = []
        exists = False
        conflicts: list[dict] = []
        for code in card["barcodes"]:
            owner = owners.get(code)
            if owner is None:
                new_codes.append(code)
            elif str(owner["variant_id"] or "") != variant_id:
                conflicts.append({"code": code, "owner": _owner_label(owner)})
            elif not owner["store_id"]:
                adopt_codes.append(code)
            else:
                exists = True
        info["new_barcodes"] = new_codes
        info["adopt_barcodes"] = adopt_codes
        info["conflicts"] = conflicts
        if new_codes or adopt_codes:
            info["status"] = MP_BARCODE_PULL_READY
        elif exists:
            info["status"] = MP_BARCODE_PULL_EXISTS
        elif conflicts:
            info["status"] = MP_BARCODE_PULL_CONFLICT
        else:
            info["status"] = MP_BARCODE_PULL_NOT_FOUND
        out.append(info)
    return out


def apply_store_barcodes(connection, items: list[dict], keys: set[str], user_id: str) -> dict:
    """Записать вариантам ШК их магазинов по выбранным позициям.

    Предложение пересчитывается здесь же: клиент присылает только выбор позиций.
    Конфликтные коды пропускаются — чужой ШК не переписывается никогда."""
    suggestions = [s for s in suggest_store_barcodes(connection, items) if str(s["key"]) in keys]
    by_key = {str(i["key"]): i for i in items}
    now = _now()
    written = 0
    lines_done = 0
    skipped = 0
    for suggestion in suggestions:
        if suggestion["status"] != MP_BARCODE_PULL_READY:
            skipped += 1
            continue
        item = by_key[str(suggestion["key"])]
        source = MP_BARCODE_SOURCE_LABELS.get(str(suggestion["marketplace"] or ""), "Маркетплейс")
        for code in suggestion["new_barcodes"]:
            connection.execute(
                "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, "
                "store_id, created_at, created_by, is_deleted) VALUES (?,?,?,?,?,?,?,?,0)",
                (str(uuid4()), str(item["product_id"]), str(item["variant_id"]), code,
                 source, suggestion["store_id"], now, user_id),
            )
            written += 1
        for code in suggestion.get("adopt_barcodes") or []:
            connection.execute(
                "UPDATE product_barcodes SET store_id = ? "
                "WHERE barcode = ? AND variant_id = ? AND COALESCE(is_deleted, 0) = 0",
                (suggestion["store_id"], code, str(item["variant_id"])),
            )
            written += 1
        lines_done += 1
    return {"written": written, "lines": lines_done, "skipped": skipped}


# ── FBS-поставки: волны, маршрутизация, приём ─────────────────────────────────
#
# Единица работы менеджера — поставка, а не заказ: площадка не примет отгрузку,
# в которой заказы двух продавцов. Пара «кабинет + отсечка» однозначно определяет
# поставку, поэтому распределение делает правило, а не человек — менеджер только
# утверждает состав галочками на фазе «Состав».


def supply_wave_key(deadline_at: str | None) -> str | None:
    """Волна = дедлайн сборки, обрезанный ВНИЗ до часа.

    Вниз, а не вверх: отсечка волны не должна оказаться позже дедлайна самого
    раннего заказа в ней, иначе поставка соберётся, когда площадка уже не примет.
    Заказ без дедлайна попадает в волну «без срока» (cutoff_at IS NULL).
    """
    dt = _parse_iso(deadline_at)
    if dt is None:
        return None
    return dt.replace(minute=0, second=0, microsecond=0).isoformat()


def next_supply_number(connection) -> str:
    """Следующий номер FBS-поставки (FBS-0001)."""
    return _next_doc_number(connection, table="mp_supplies", prefix="FBS-", width=4)


def _intake_close_minutes(account) -> int:
    raw = dict(account).get("intake_close_minutes")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return MP_SUPPLY_INTAKE_CLOSE_MINUTES
    return value if value >= 0 else MP_SUPPLY_INTAKE_CLOSE_MINUTES


def _intake_closes_at(cutoff_at: str | None, minutes: int) -> str | None:
    dt = _parse_iso(cutoff_at)
    if dt is None:
        return None
    return (dt - timedelta(minutes=minutes)).isoformat()


def _fmt_moment(raw: str | None) -> str:
    dt = _parse_iso(raw)
    return dt.strftime("%d.%m %H:%M") if dt else "без срока"


def write_supply_op(connection, supply_id: str, op_type: str, *, comment: str,
                    order_id: str | None = None, qty: int | None = None,
                    user_id: str | None = None) -> None:
    connection.execute(
        "INSERT INTO mp_supply_ops (id, supply_id, op_type, order_id, qty, comment, "
        "created_at, created_by) VALUES (?,?,?,?,?,?,?,?)",
        (str(uuid4()), supply_id, op_type, order_id, qty, comment, _now(), user_id),
    )


def _create_supply(connection, account, wave: str | None, *, user_id: str | None = None) -> str:
    supply_id = str(uuid4())
    now = _now()
    connection.execute(
        "INSERT INTO mp_supplies (id, doc_number, account_id, cutoff_at, intake_closes_at, "
        "status, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (supply_id, next_supply_number(connection), str(account["id"]), wave,
         _intake_closes_at(wave, _intake_close_minutes(account)),
         MP_SUPPLY_STATUS_DRAFT, now, user_id, now),
    )
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_CREATE,
        comment=f"Поставка заведена под отсечку {_fmt_moment(wave)}", user_id=user_id,
    )
    return supply_id


def _attach_order(connection, supply_id: str, order_id: str, state: str) -> None:
    now = _now()
    connection.execute(
        "INSERT INTO mp_supply_orders (id, supply_id, order_id, state, added_at, updated_at) "
        "VALUES (?,?,?,?,?,?)",
        (str(uuid4()), supply_id, order_id, state, now, now),
    )


def route_orders_into_supplies(connection, account) -> dict:
    """Разложить неразмещённые заказы кабинета по поставкам его волн.

    Открыта на приём поставка волны — заказ втекает сам; идёт сборка, но приём
    ещё не закрыт — заказ ложится в дозагрузку (pending, решает менеджер);
    иначе заводится новая поставка. Заказ, снятый менеджером галочкой, обратно
    в ту же поставку не возвращается: он ждёт следующей поставки этой волны.
    """
    account_id = str(account["id"])
    stats = {"routed": 0, "docked": 0, "supplies_created": 0}
    rows = connection.execute(
        "SELECT o.id, o.deadline_at FROM mp_orders o "
        "WHERE o.account_id = ? AND o.status IN (?, ?) "
        "AND NOT EXISTS (SELECT 1 FROM mp_supply_orders so "
        "                WHERE so.order_id = o.id AND so.state IN (?, ?)) "
        "ORDER BY o.deadline_at ASC NULLS LAST, o.first_seen_at ASC",
        (account_id, MP_ORDER_STATUS_NEW, MP_ORDER_STATUS_IN_PROGRESS,
         MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_PENDING),
    ).fetchall()

    for row in rows:
        order_id = str(row["id"])
        wave = supply_wave_key(row["deadline_at"])
        # Приоритет — открытая на приём поставка (draft/checking); идущая сборка
        # берёт заказ только в дозагрузку, поэтому стоит в сортировке последней.
        target = connection.execute(
            "SELECT id, status FROM mp_supplies WHERE account_id = ? "
            "AND cutoff_at IS NOT DISTINCT FROM ? AND intake_closed_at IS NULL "
            "AND COALESCE(is_deleted, 0) = 0 AND status IN (?, ?, ?) "
            "ORDER BY CASE WHEN status = ? THEN 1 ELSE 0 END, created_at ASC LIMIT 1",
            (account_id, wave, MP_SUPPLY_STATUS_DRAFT, MP_SUPPLY_STATUS_CHECKING,
             MP_SUPPLY_STATUS_PICKING, MP_SUPPLY_STATUS_PICKING),
        ).fetchone()
        if target is None:
            supply_id = _create_supply(connection, account, wave)
            stats["supplies_created"] += 1
            _attach_order(connection, supply_id, order_id, MP_SUPPLY_ORDER_SELECTED)
            stats["routed"] += 1
            continue
        supply_id = str(target["id"])
        seen = connection.execute(
            "SELECT id FROM mp_supply_orders WHERE supply_id = ? AND order_id = ?",
            (supply_id, order_id),
        ).fetchone()
        if seen:
            continue
        docked = str(target["status"]) == MP_SUPPLY_STATUS_PICKING
        _attach_order(
            connection, supply_id, order_id,
            MP_SUPPLY_ORDER_PENDING if docked else MP_SUPPLY_ORDER_SELECTED,
        )
        if docked:
            stats["docked"] += 1
            write_supply_op(
                connection, supply_id, MP_SUPPLY_OP_ORDER_DOCK, order_id=order_id,
                comment="Заказ подъехал в идущую сборку — ждёт дозагрузки",
            )
        else:
            stats["routed"] += 1
    return stats


def release_cancelled_orders(connection) -> int:
    """Снять с поставки заказы, отменённые на площадке, пока она набирается.

    На сборке и позже строка остаётся выбранной и всплывает блокером: товар
    может быть уже в руках у кладовщика, и его надо вернуть, а не потерять.
    """
    rows = connection.execute(
        "SELECT so.id, so.supply_id, so.order_id, o.external_id FROM mp_supply_orders so "
        "JOIN mp_orders o ON o.id = so.order_id "
        "JOIN mp_supplies s ON s.id = so.supply_id "
        "WHERE so.state IN (?, ?) AND o.status = ? AND s.status IN (?, ?)",
        (MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_PENDING, MP_ORDER_STATUS_CANCELLED,
         MP_SUPPLY_STATUS_DRAFT, MP_SUPPLY_STATUS_CHECKING),
    ).fetchall()
    for row in rows:
        connection.execute(
            "UPDATE mp_supply_orders SET state = ?, updated_at = ? WHERE id = ?",
            (MP_SUPPLY_ORDER_UNSELECTED, _now(), str(row["id"])),
        )
        write_supply_op(
            connection, str(row["supply_id"]), MP_SUPPLY_OP_ORDER_REMOVE,
            order_id=str(row["order_id"]),
            comment=f"Заказ {row['external_id']} отменён на площадке — снят с поставки",
        )
    return len(rows)


def close_due_intakes(connection) -> int:
    """Закрыть приём у поставок, чья отсечка приёма наступила.

    Закрытие делает воркер, а не человек: после него поток заказов волны идёт
    в следующую поставку, а текущая перестаёт расти под руками у склада.
    """
    now = _now()
    rows = connection.execute(
        "SELECT id FROM mp_supplies WHERE intake_closed_at IS NULL "
        "AND intake_closes_at IS NOT NULL AND intake_closes_at <= ? "
        "AND COALESCE(is_deleted, 0) = 0 AND status IN (?, ?, ?)",
        (now, MP_SUPPLY_STATUS_DRAFT, MP_SUPPLY_STATUS_CHECKING, MP_SUPPLY_STATUS_PICKING),
    ).fetchall()
    for row in rows:
        connection.execute(
            "UPDATE mp_supplies SET intake_closed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, str(row["id"])),
        )
        write_supply_op(
            connection, str(row["id"]), MP_SUPPLY_OP_INTAKE_CLOSE,
            comment="Приём в поставку закрыт — новые заказы уходят в следующую",
        )
    return len(rows)


# ── FBS-поставки: остаток, ячейки, лист подбора ───────────────────────────────


def _stock_by_variant(connection, pairs: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    """Остаток «На хранении / Годный» по (клиент, вариант) с разбивкой по ячейкам.

    Один запрос на всю доску вместо обхода вариантов: пары приходят из строк
    заказов. Ячейка — это `zone_relocations.*_zone_id` → `unloading_zones.name`;
    товар может лежать в нескольких ячейках, отсутствие ячейки (NULL) — реальное
    состояние «без места», а не отсутствие данных.
    """
    uniq = sorted({(str(c), str(v)) for c, v in pairs if c and v})
    if not uniq:
        return {}
    # Типы первой строки VALUES задают тип колонок CTE — иначе Postgres оставит
    # их unknown и join с product_variants.id развалится.
    values = ", ".join(
        "(?::text, ?::text)" if i == 0 else "(?, ?)" for i in range(len(uniq))
    )
    params: list = []
    for client_id, variant_id in uniq:
        params += [client_id, variant_id]
    rows = connection.execute(
        f"""
        WITH req(client_id, variant_id) AS (VALUES {values}),
        v AS (
            SELECT r.client_id, r.variant_id, pv.product_id, pv.color_id, pv.size_id
            FROM req r JOIN product_variants pv ON pv.id = r.variant_id
        ),
        mv AS (
            SELECT v.client_id, v.variant_id, zr.to_zone_id AS zone_id, zr.qty AS net
            FROM v JOIN zone_relocations zr
              ON zr.product_id = v.product_id
             AND zr.color_id  IS NOT DISTINCT FROM v.color_id
             AND zr.size_id   IS NOT DISTINCT FROM v.size_id
             AND zr.client_id IS NOT DISTINCT FROM v.client_id
            WHERE zr.to_op = ? AND zr.to_quality = ?
            UNION ALL
            SELECT v.client_id, v.variant_id, zr.from_zone_id, -zr.qty
            FROM v JOIN zone_relocations zr
              ON zr.product_id = v.product_id
             AND zr.color_id  IS NOT DISTINCT FROM v.color_id
             AND zr.size_id   IS NOT DISTINCT FROM v.size_id
             AND zr.client_id IS NOT DISTINCT FROM v.client_id
            WHERE zr.from_op = ? AND zr.from_quality = ?
        )
        SELECT mv.client_id, mv.variant_id, uz.name AS zone_name, SUM(mv.net) AS net
        FROM mv LEFT JOIN unloading_zones uz ON uz.id = mv.zone_id
        GROUP BY mv.client_id, mv.variant_id, uz.name
        HAVING SUM(mv.net) > 0
        ORDER BY uz.name IS NULL, uz.name
        """,
        [*params, INV_OP_STORAGE, INV_Q_GOOD, INV_OP_STORAGE, INV_Q_GOOD],
    ).fetchall()
    out: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (str(row["client_id"]), str(row["variant_id"]))
        entry = out.setdefault(key, {"available": 0, "cells": []})
        entry["available"] += int(row["net"])
        entry["cells"].append({"name": row["zone_name"], "qty": int(row["net"])})
    return out


_SUPPLY_LINE_SELECT = """
    SELECT so.supply_id, so.state,
           o.id AS order_id, o.external_id, o.status AS order_status,
           o.deadline_at, o.created_at_mp, o.first_seen_at,
           l.id AS line_id, l.qty, l.title, l.offer_id,
           a.client_id,
           pl.product_id, pl.variant_id,
           p.name AS product_name,
           COALESCE(NULLIF(v.sku, ''), p.sku) AS product_sku,
           col.name AS color_name, s.name AS size_name
    FROM mp_supply_orders so
    JOIN mp_orders o ON o.id = so.order_id
    JOIN mp_accounts a ON a.id = o.account_id
    JOIN mp_order_lines l ON l.order_id = o.id
    LEFT JOIN mp_product_links pl ON pl.mp_product_id = l.mp_product_id
      AND COALESCE(pl.is_deleted, 0) = 0
    LEFT JOIN products p ON p.id = pl.product_id
    LEFT JOIN product_variants v ON v.id = pl.variant_id
    LEFT JOIN colors col ON col.id = v.color_id
    LEFT JOIN sizes s ON s.id = v.size_id
"""


def _supply_lines(connection, supply_ids: list[str], *, states: tuple[str, ...]) -> list[dict]:
    if not supply_ids:
        return []
    supply_ph = ",".join("?" for _ in supply_ids)
    state_ph = ",".join("?" for _ in states)
    rows = connection.execute(
        f"{_SUPPLY_LINE_SELECT} WHERE so.supply_id IN ({supply_ph}) AND so.state IN ({state_ph})",
        [*supply_ids, *states],
    ).fetchall()
    return [dict(r) for r in rows]


def _reserved_by_other_supplies(connection, exclude_supply_ids: list[str]) -> dict[tuple[str, str], int]:
    """Сколько штук варианта уже обещано другими поставками, вставшими на сборку.

    Свободный остаток одной поставки не должен включать то, что кладовщик уже
    несёт по другой: статусы checking/picking/handover — это принятое обязательство.
    """
    exclude_ph = ",".join("?" for _ in exclude_supply_ids) if exclude_supply_ids else None
    where = (
        "s.status IN (?, ?, ?) AND COALESCE(s.is_deleted, 0) = 0 "
        "AND so.state = ? AND pl.variant_id IS NOT NULL"
    )
    params: list = [
        MP_SUPPLY_STATUS_CHECKING, MP_SUPPLY_STATUS_PICKING, MP_SUPPLY_STATUS_HANDOVER,
        MP_SUPPLY_ORDER_SELECTED,
    ]
    if exclude_ph:
        where += f" AND s.id NOT IN ({exclude_ph})"
        params += list(exclude_supply_ids)
    rows = connection.execute(
        f"""
        SELECT a.client_id, pl.variant_id, SUM(l.qty) AS qty
        FROM mp_supply_orders so
        JOIN mp_supplies s ON s.id = so.supply_id
        JOIN mp_orders o ON o.id = so.order_id
        JOIN mp_accounts a ON a.id = o.account_id
        JOIN mp_order_lines l ON l.order_id = o.id
        JOIN mp_product_links pl ON pl.mp_product_id = l.mp_product_id
          AND COALESCE(pl.is_deleted, 0) = 0
        WHERE {where}
        GROUP BY a.client_id, pl.variant_id
        """,
        params,
    ).fetchall()
    out = {(str(r["client_id"]), str(r["variant_id"])): int(r["qty"]) for r in rows}

    # Собранное чужой поставкой уже физически ушло со storage — держать его ещё и
    # в резерве значило бы вычесть один и тот же товар дважды.
    picked_where = "s.status IN (?, ?, ?) AND COALESCE(s.is_deleted, 0) = 0 AND p.variant_id IS NOT NULL"
    picked_params: list = [
        MP_SUPPLY_STATUS_CHECKING, MP_SUPPLY_STATUS_PICKING, MP_SUPPLY_STATUS_HANDOVER,
    ]
    if exclude_ph:
        picked_where += f" AND s.id NOT IN ({exclude_ph})"
        picked_params += list(exclude_supply_ids)
    picked = connection.execute(
        f"""
        SELECT p.client_id, p.variant_id, SUM(p.qty) AS qty
        FROM mp_supply_picks p
        JOIN mp_supplies s ON s.id = p.supply_id
        WHERE {picked_where}
        GROUP BY p.client_id, p.variant_id
        """,
        picked_params,
    ).fetchall()
    for r in picked:
        key = (str(r["client_id"]), str(r["variant_id"]))
        if key in out:
            out[key] = max(0, out[key] - int(r["qty"] or 0))
    return out


def _cells_label(cells: list[dict]) -> list[str]:
    return [str(c["name"]) for c in cells if c["name"]]


def build_pick_list(lines: list[dict], stock: dict, reserved: dict,
                    picked: dict | None = None) -> list[dict]:
    """Свёртка строк заказов в лист подбора: вариант × суммарное количество.

    Порядок — маршрут обхода склада (по имени ячейки), позиции без ячейки в
    конце: они не имеют адреса и рвали бы маршрут.
    """
    agg: dict[str, dict] = {}
    for line in lines:
        variant_id = line["variant_id"]
        key = str(variant_id) if variant_id else f"unlinked:{line['line_id']}"
        item = agg.get(key)
        if item is None:
            stock_key = (str(line["client_id"]), str(variant_id)) if variant_id else None
            entry = stock.get(stock_key, {}) if stock_key else {}
            cells = _cells_label(entry.get("cells", []))
            available = int(entry.get("available", 0))
            item = agg[key] = {
                "variant_id": str(variant_id) if variant_id else None,
                "product_id": line["product_id"],
                "product_sku": line["product_sku"],
                "product_name": line["product_name"] or line["title"],
                "color_name": line["color_name"],
                "size_name": line["size_name"],
                "offer_id": line["offer_id"],
                "linked": variant_id is not None,
                "need_qty": 0,
                "orders_count": 0,
                "available_qty": max(0, available - (reserved.get(stock_key, 0) if stock_key else 0)),
                "cells": cells,
                "_orders": set(),
            }
        item["need_qty"] += int(line["qty"])
        item["_orders"].add(str(line["order_id"]))
    items = []
    picked = picked or {}
    for item in agg.values():
        item["orders_count"] = len(item.pop("_orders"))
        # Собранное уже ушло из storage, поэтому недостача считается от остатка
        # потребности: иначе на сборке каждая закрытая позиция светилась бы дефицитом.
        item["picked_qty"] = int(picked.get(item["variant_id"], 0)) if item["variant_id"] else 0
        item["remaining_qty"] = max(0, item["need_qty"] - item["picked_qty"])
        item["shortage_qty"] = max(0, item["remaining_qty"] - item["available_qty"])
        items.append(item)
    items.sort(key=lambda i: (
        not i["linked"],            # не связанные — в конец
        not i["cells"],             # «без места» — после адресованных
        i["cells"][0] if i["cells"] else "",
        str(i["product_name"] or ""), str(i["color_name"] or ""), str(i["size_name"] or ""),
    ))
    return items


def build_supply_orders(lines: list[dict], stock: dict) -> list[dict]:
    """Заказы поставки для экрана выбора состава: состав, ячейки, готовность."""
    agg: dict[str, dict] = {}
    for line in lines:
        order_id = str(line["order_id"])
        item = agg.get(order_id)
        if item is None:
            item = agg[order_id] = {
                "order_id": order_id,
                "external_id": str(line["external_id"]),
                "order_status": str(line["order_status"]),
                "state": str(line["state"]),
                "deadline_at": line["deadline_at"],
                "created_at_mp": line["created_at_mp"] or line["first_seen_at"],
                "lines_total": 0, "total_qty": 0,
                "summary": "", "cells": [], "blockers": [],
                "_titles": [], "_cells": [],
            }
        variant_id = line["variant_id"]
        qty = int(line["qty"])
        item["lines_total"] += 1
        item["total_qty"] += qty
        if variant_id:
            entry = stock.get((str(line["client_id"]), str(variant_id)), {})
            cells = _cells_label(entry.get("cells", []))
            item["_cells"].extend(cells)
            if not cells:
                item["blockers"].append("no_location")
            name = " · ".join(str(x) for x in [
                line["product_name"], line["color_name"], line["size_name"],
            ] if x)
        else:
            item["blockers"].append("unlinked")
            name = str(line["title"] or line["offer_id"] or "Товар без связки")
        item["_titles"].append(f"{name} · {qty} шт.")
    items = []
    for item in agg.values():
        titles = item.pop("_titles")
        item["summary"] = (
            titles[0] if len(titles) == 1
            else f"{item['lines_total']} позиции · {item['total_qty']} шт."
        )
        seen: list[str] = []
        for cell in item.pop("_cells"):
            if cell not in seen:
                seen.append(cell)
        item["cells"] = seen
        item["blockers"] = sorted(set(item["blockers"]))
        items.append(item)
    items.sort(key=lambda i: (str(i["created_at_mp"] or ""), i["external_id"]))
    return items


# ── FBS-поставки: анализ состава ──────────────────────────────────────────────


def _order_sort_key(order: dict) -> tuple:
    return (str(order["deadline_at"] or "9"), str(order["created_at_mp"] or ""), order["external_id"])


def analyze_supply(lines: list[dict], stock: dict, reserved: dict,
                   picked: dict | None = None) -> dict:
    """Лист подбора, заказы и счётчики по одному набору строк.

    Готовность заказа считается жадным распределением остатка в порядке дедлайна:
    когда два заказа тянут один и тот же вариант, а на складе хватает на один,
    «соберётся» именно срочный. Иначе доска обещала бы собрать оба.
    """
    pick_list = build_pick_list(lines, stock, reserved, picked)
    orders = build_supply_orders(lines, stock)

    # Уже собранное считается доступным: иначе готовность заказа падала бы по мере
    # того, как сборщик снимает его товар с полки.
    remaining = {
        item["variant_id"]: item["available_qty"] + item["picked_qty"]
        for item in pick_list if item["variant_id"]
    }
    need_by_order: dict[str, dict[str, int]] = {}
    for line in lines:
        if not line["variant_id"]:
            continue
        bucket = need_by_order.setdefault(str(line["order_id"]), {})
        key = str(line["variant_id"])
        bucket[key] = bucket.get(key, 0) + int(line["qty"])

    for order in sorted(orders, key=_order_sort_key):
        if "unlinked" in order["blockers"]:
            order["ready"] = False
            continue
        need = need_by_order.get(order["order_id"], {})
        if all(remaining.get(v, 0) >= q for v, q in need.items()):
            for variant_id, qty in need.items():
                remaining[variant_id] -= qty
            order["ready"] = True
        else:
            order["ready"] = False
            order["blockers"] = sorted({*order["blockers"], "shortage"})

    orders_total = len(orders)
    orders_ready = sum(1 for o in orders if o["ready"])
    return {
        "pick_list": pick_list,
        "orders": orders,
        "counters": {
            "orders_total": orders_total,
            "orders_ready": orders_ready,
            "positions": len(pick_list),
            "total_qty": sum(int(line["qty"]) for line in lines),
            "cells_count": len({c for item in pick_list for c in item["cells"]}),
            "unlinked_positions": sum(1 for i in pick_list if not i["linked"]),
            "shortage_positions": sum(1 for i in pick_list if i["linked"] and i["shortage_qty"] > 0),
            "picked_qty": sum(i["picked_qty"] for i in pick_list),
            "remaining_qty": sum(i["remaining_qty"] for i in pick_list if i["linked"]),
            "no_location_positions": sum(1 for i in pick_list if i["linked"] and not i["cells"]),
        },
    }


def supply_blockers(analysis: dict) -> list[dict]:
    """Что мешает собрать — с действием на каждую причину, а не общее «проверьте состав»."""
    out: list[dict] = []
    for item in analysis["pick_list"]:
        if not item["linked"]:
            out.append({
                "kind": "unlinked",
                "text": (f"Товар не связан с вариантом номенклатуры: "
                         f"{item['offer_id'] or item['product_name'] or 'без артикула'}"),
                "orders_count": item["orders_count"],
                "variant_id": None,
            })
    for item in analysis["pick_list"]:
        if item["linked"] and item["shortage_qty"] > 0:
            title = " · ".join(str(x) for x in [
                item["product_name"], item["color_name"], item["size_name"],
            ] if x)
            out.append({
                "kind": "shortage",
                "text": (f"Нет остатка: {title} — нужно {item['remaining_qty']} шт., "
                         f"свободно {item['available_qty']} шт."),
                "orders_count": item["orders_count"],
                "variant_id": item["variant_id"],
            })
    return out


# ── FBS-поставки: выборки для UI ──────────────────────────────────────────────

_SUPPLY_SELECT = """
    SELECT s.id, s.doc_number, s.status, s.cutoff_at, s.intake_closes_at, s.intake_closed_at,
           s.external_supply_id, s.created_at, s.updated_at, s.created_by,
           s.checking_at, s.picking_at, s.handover_at, s.done_at,
           s.picker_id, s.claimed_at,
           COALESCE(NULLIF(pu.display_name, ''), pu.email) AS picker_name,
           a.id AS account_id, a.name AS account_name, a.marketplace,
           a.client_id, c.name AS client_name,
           COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_name
    FROM mp_supplies s
    JOIN mp_accounts a ON a.id = s.account_id
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN users u ON u.id = s.created_by
    LEFT JOIN users pu ON pu.id = s.picker_id
"""


def _picked_by_supplies(connection, supply_ids: list[str]) -> dict[str, dict[str, int]]:
    """Прогресс сборки по пачке поставок: {поставка: {вариант: собрано}}."""
    if not supply_ids:
        return {}
    ph = ",".join("?" for _ in supply_ids)
    rows = connection.execute(
        f"SELECT supply_id, variant_id, SUM(qty) AS qty FROM mp_supply_picks "
        f"WHERE supply_id IN ({ph}) AND variant_id IS NOT NULL "
        f"GROUP BY supply_id, variant_id",
        list(supply_ids),
    ).fetchall()
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(str(r["supply_id"]), {})[str(r["variant_id"])] = int(r["qty"] or 0)
    return out


def _pending_counts(connection, supply_ids: list[str]) -> dict[str, int]:
    if not supply_ids:
        return {}
    ph = ",".join("?" for _ in supply_ids)
    rows = connection.execute(
        f"SELECT supply_id, COUNT(*) AS n FROM mp_supply_orders "
        f"WHERE supply_id IN ({ph}) AND state = ? GROUP BY supply_id",
        [*supply_ids, MP_SUPPLY_ORDER_PENDING],
    ).fetchall()
    return {str(r["supply_id"]): int(r["n"]) for r in rows}


def supply_board(connection, *, client_id=None, marketplace=None, account_id=None) -> dict:
    """Доска отгрузок: активные поставки всех кабинетов с блокерами и покрытием.

    Группировку по волнам делает фронт — сервер отдаёт плоский список,
    отсортированный по отсечке, чтобы «просрочено» шло первым.
    """
    conds = ["COALESCE(s.is_deleted, 0) = 0", "COALESCE(a.is_deleted, 0) = 0"]
    params: list = []
    placeholders = ",".join("?" for _ in MP_SUPPLY_ACTIVE_STATUSES)
    conds.append(f"s.status IN ({placeholders})")
    params.extend(sorted(MP_SUPPLY_ACTIVE_STATUSES))
    if account_id:
        conds.append("s.account_id = ?")
        params.append(account_id)
    if client_id:
        conds.append("a.client_id = ?")
        params.append(client_id)
    if marketplace:
        conds.append("a.marketplace = ?")
        params.append(marketplace)
    rows = connection.execute(
        f"{_SUPPLY_SELECT} WHERE {' AND '.join(conds)} "
        "ORDER BY s.cutoff_at ASC NULLS LAST, s.doc_number ASC",
        params,
    ).fetchall()
    supplies = [dict(r) for r in rows]
    if not supplies:
        return {"items": [], "counters": {"supplies": 0, "orders": 0, "overdue": 0}}

    ids = [str(s["id"]) for s in supplies]
    lines = _supply_lines(connection, ids, states=(MP_SUPPLY_ORDER_SELECTED,))
    stock = _stock_by_variant(connection, [(l["client_id"], l["variant_id"]) for l in lines])
    reserved_all = _reserved_by_other_supplies(connection, [])
    pending = _pending_counts(connection, ids)
    picked_all = _picked_by_supplies(connection, ids)

    by_supply: dict[str, list[dict]] = {}
    for line in lines:
        by_supply.setdefault(str(line["supply_id"]), []).append(line)

    now = _now()
    items = []
    overdue = 0
    for supply in supplies:
        supply_id = str(supply["id"])
        own_lines = by_supply.get(supply_id, [])
        # Своё обязательство не должно уменьшать собственный свободный остаток.
        reserved = dict(reserved_all)
        if str(supply["status"]) in (MP_SUPPLY_STATUS_CHECKING, MP_SUPPLY_STATUS_PICKING,
                                     MP_SUPPLY_STATUS_HANDOVER):
            for line in own_lines:
                if line["variant_id"]:
                    key = (str(line["client_id"]), str(line["variant_id"]))
                    reserved[key] = max(0, reserved.get(key, 0) - int(line["qty"]))
        analysis = analyze_supply(own_lines, stock, reserved, picked_all.get(supply_id))
        is_overdue = bool(supply["cutoff_at"]) and str(supply["cutoff_at"]) < now
        if is_overdue:
            overdue += 1
        items.append({
            **{k: supply[k] for k in (
                "id", "doc_number", "status", "cutoff_at", "intake_closes_at",
                "intake_closed_at", "account_id", "account_name", "marketplace",
                "client_id", "client_name", "created_at", "updated_at",
                "picker_id", "picker_name", "claimed_at",
            )},
            **analysis["counters"],
            "orders_pending": pending.get(supply_id, 0),
            "overdue": is_overdue,
        })
    return {
        "items": items,
        "counters": {
            "supplies": len(items),
            "orders": sum(i["orders_total"] for i in items),
            "overdue": overdue,
        },
    }


def supply_detail(connection, supply_id: str) -> dict | None:
    row = connection.execute(f"{_SUPPLY_SELECT} WHERE s.id = ?", (supply_id,)).fetchone()
    if not row:
        return None
    doc = dict(row)
    lines = _supply_lines(
        connection, [supply_id],
        states=(MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_UNSELECTED, MP_SUPPLY_ORDER_PENDING),
    )
    selected = [l for l in lines if str(l["state"]) == MP_SUPPLY_ORDER_SELECTED]
    stock = _stock_by_variant(connection, [(l["client_id"], l["variant_id"]) for l in lines])
    reserved = _reserved_by_other_supplies(connection, [supply_id])
    picked = picked_by_variant(connection, supply_id)
    analysis = analyze_supply(selected, stock, reserved, picked)
    others = analyze_supply(
        [l for l in lines if str(l["state"]) != MP_SUPPLY_ORDER_SELECTED], stock, reserved,
    )
    now = _now()
    doc["overdue"] = bool(doc["cutoff_at"]) and str(doc["cutoff_at"]) < now
    doc.update(analysis["counters"])
    doc["orders_pending"] = sum(
        1 for o in others["orders"] if o["state"] == MP_SUPPLY_ORDER_PENDING
    )
    return {
        "doc": doc,
        "orders": [*analysis["orders"], *others["orders"]],
        "pick_list": analysis["pick_list"],
        "blockers": supply_blockers(analysis),
    }


def supply_ops(connection, supply_id: str) -> list[dict]:
    rows = connection.execute(
        "SELECT o.id, o.op_type, o.comment, o.created_at, "
        "COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_name "
        "FROM mp_supply_ops o LEFT JOIN users u ON u.id = o.created_by "
        "WHERE o.supply_id = ? ORDER BY o.created_at DESC LIMIT 200",
        (supply_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def available_orders_for_supply(connection, supply_id: str) -> list[dict]:
    """Заказы кабинета, которые можно добавить в поставку вручную.

    Те, что ещё не заняты активной поставкой: подъехали после утверждения
    состава либо были сняты галочкой с другой поставки той же волны.
    """
    row = connection.execute(
        "SELECT account_id FROM mp_supplies WHERE id = ?", (supply_id,),
    ).fetchone()
    if not row:
        return []
    rows = connection.execute(
        "SELECT o.id AS order_id, o.external_id, o.status AS order_status, o.deadline_at, "
        "o.created_at_mp, o.first_seen_at, o.total_qty "
        "FROM mp_orders o WHERE o.account_id = ? AND o.status IN (?, ?) "
        "AND NOT EXISTS (SELECT 1 FROM mp_supply_orders so "
        "                WHERE so.order_id = o.id AND so.state IN (?, ?)) "
        "AND NOT EXISTS (SELECT 1 FROM mp_supply_orders so2 "
        "                WHERE so2.order_id = o.id AND so2.supply_id = ?) "
        "ORDER BY o.deadline_at ASC NULLS LAST, o.first_seen_at ASC LIMIT 200",
        (str(row["account_id"]), MP_ORDER_STATUS_NEW, MP_ORDER_STATUS_IN_PROGRESS,
         MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_PENDING, supply_id),
    ).fetchall()
    return [dict(r) for r in rows]


# ── FBS-поставки: команды ─────────────────────────────────────────────────────


def load_supply(connection, supply_id: str):
    row = connection.execute(
        "SELECT * FROM mp_supplies WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (supply_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Поставка не найдена")
    return row


def set_supply_orders(connection, supply_id: str, order_ids: list[str], user_id: str) -> dict:
    """Утвердить состав: выбранные — selected, остальные освобождаются.

    Снятие галочки — не удаление: заказ уходит в следующую поставку кабинета,
    поэтому строка остаётся следом в журнале, а не исчезает.
    """
    supply = load_supply(connection, supply_id)
    status = str(supply["status"])
    if status not in MP_SUPPLY_INTAKE_STATUSES:
        raise HTTPException(status_code=400, detail="Состав правится только до передачи в сборку")
    wanted = {str(x) for x in order_ids}
    linked = connection.execute(
        "SELECT so.id, so.order_id, so.state, o.external_id FROM mp_supply_orders so "
        "JOIN mp_orders o ON o.id = so.order_id WHERE so.supply_id = ?",
        (supply_id,),
    ).fetchall()
    known = {str(r["order_id"]): r for r in linked}
    allowed_new = {str(r["order_id"]) for r in available_orders_for_supply(connection, supply_id)}
    unknown = wanted - set(known) - allowed_new
    if unknown:
        raise HTTPException(status_code=400, detail="Заказ уже занят другой поставкой")

    now = _now()
    stats = {"selected": 0, "unselected": 0}
    for order_id, row in known.items():
        target = MP_SUPPLY_ORDER_SELECTED if order_id in wanted else MP_SUPPLY_ORDER_UNSELECTED
        if str(row["state"]) == target:
            continue
        connection.execute(
            "UPDATE mp_supply_orders SET state = ?, updated_at = ? WHERE id = ?",
            (target, now, str(row["id"])),
        )
        if target == MP_SUPPLY_ORDER_SELECTED:
            stats["selected"] += 1
            write_supply_op(
                connection, supply_id, MP_SUPPLY_OP_ORDER_ADD, order_id=order_id, user_id=user_id,
                comment=f"Заказ {row['external_id']} возвращён в состав",
            )
        else:
            stats["unselected"] += 1
            write_supply_op(
                connection, supply_id, MP_SUPPLY_OP_ORDER_REMOVE, order_id=order_id, user_id=user_id,
                comment=f"Заказ {row['external_id']} снят — уйдёт в следующую поставку",
            )
    for order_id in wanted - set(known):
        _attach_order(connection, supply_id, order_id, MP_SUPPLY_ORDER_SELECTED)
        stats["selected"] += 1
        write_supply_op(
            connection, supply_id, MP_SUPPLY_OP_ORDER_ADD, order_id=order_id, user_id=user_id,
            comment="Заказ добавлен в состав вручную",
        )
    connection.execute("UPDATE mp_supplies SET updated_at = ? WHERE id = ?", (now, supply_id))
    return stats


def dock_supply_orders(connection, supply_id: str, order_ids: list[str], user_id: str) -> int:
    """Дозагрузка: принять подъехавшие заказы в идущую сборку.

    Дельтой в ту же задачу кладовщика — второй карточки на тот же кабинет и
    второго прохода по тем же стеллажам быть не должно.
    """
    supply = load_supply(connection, supply_id)
    if str(supply["status"]) != MP_SUPPLY_STATUS_PICKING:
        raise HTTPException(status_code=400, detail="Дозагрузка возможна только на сборке")
    wanted = {str(x) for x in order_ids}
    rows = connection.execute(
        "SELECT so.id, so.order_id, o.external_id FROM mp_supply_orders so "
        "JOIN mp_orders o ON o.id = so.order_id "
        "WHERE so.supply_id = ? AND so.state = ?",
        (supply_id, MP_SUPPLY_ORDER_PENDING),
    ).fetchall()
    now = _now()
    docked = 0
    for row in rows:
        order_id = str(row["order_id"])
        if wanted and order_id not in wanted:
            continue
        connection.execute(
            "UPDATE mp_supply_orders SET state = ?, updated_at = ? WHERE id = ?",
            (MP_SUPPLY_ORDER_SELECTED, now, str(row["id"])),
        )
        write_supply_op(
            connection, supply_id, MP_SUPPLY_OP_ORDER_DOCK, order_id=order_id, user_id=user_id,
            comment=f"Заказ {row['external_id']} добавлен в идущую сборку",
        )
        docked += 1
    connection.execute("UPDATE mp_supplies SET updated_at = ? WHERE id = ?", (now, supply_id))
    return docked


_SUPPLY_NEXT_STATUS = {
    MP_SUPPLY_STATUS_DRAFT: (MP_SUPPLY_STATUS_CHECKING, "checking_at", "Состав утверждён"),
    MP_SUPPLY_STATUS_CHECKING: (MP_SUPPLY_STATUS_PICKING, "picking_at", "Передана в сборку"),
    MP_SUPPLY_STATUS_PICKING: (MP_SUPPLY_STATUS_HANDOVER, "handover_at", "Собрана, к передаче"),
    MP_SUPPLY_STATUS_HANDOVER: (MP_SUPPLY_STATUS_DONE, "done_at", "Передана площадке"),
}


def supply_advance_blockers(connection, supply_id: str, status: str) -> list[str]:
    """Причины, по которым фаза не закрывается. Кнопка остаётся активной —
    клик показывает список, как в карточках задач."""
    detail = supply_detail(connection, supply_id)
    if detail is None:
        return ["Поставка не найдена"]
    reasons: list[str] = []
    if status in MP_SUPPLY_INTAKE_STATUSES and detail["doc"]["orders_total"] == 0:
        reasons.append("В составе нет ни одного заказа")
    if status == MP_SUPPLY_STATUS_CHECKING:
        reasons.extend(b["text"] for b in detail["blockers"])
    if status == MP_SUPPLY_STATUS_PICKING:
        if detail["doc"]["orders_pending"]:
            reasons.append(
                f"Дозагрузка не разобрана: {detail['doc']['orders_pending']} заказ(ов) ждут решения"
            )
        # Сборка закрывается только полностью собранным составом. Товара нет физически —
        # выход не через недобор, а через снятие заказа менеджером (drop_supply_order).
        left = sum(i["remaining_qty"] for i in detail["pick_list"] if i["linked"])
        if left:
            reasons.append(f"Собрано не всё: осталось {left} шт.")
        unlinked = detail["doc"]["unlinked_positions"]
        if unlinked:
            reasons.append(f"Не связано с номенклатурой: {unlinked} позиц(ий) — собрать нечем")
        extra = sum(
            max(0, i["picked_qty"] - i["need_qty"]) for i in detail["pick_list"] if i["linked"]
        )
        if extra:
            reasons.append(f"Собрано лишнее: вернуть {extra} шт. на место")
    return reasons


def advance_supply(connection, supply_id: str, user_id: str) -> str:
    supply = load_supply(connection, supply_id)
    status = str(supply["status"])
    step = _SUPPLY_NEXT_STATUS.get(status)
    if step is None:
        raise HTTPException(status_code=400, detail="Поставка уже закрыта")
    reasons = supply_advance_blockers(connection, supply_id, status)
    if reasons:
        raise HTTPException(status_code=400, detail="; ".join(reasons))
    next_status, stamp_col, comment = step
    now = _now()
    # На сборке приём закрывается принудительно: собранное больше не растёт.
    close_intake = ", intake_closed_at = COALESCE(intake_closed_at, ?)" if next_status == MP_SUPPLY_STATUS_HANDOVER else ""
    params: list = [next_status, now, now]
    if close_intake:
        params.append(now)
    connection.execute(
        f"UPDATE mp_supplies SET status = ?, {stamp_col} = ?, updated_at = ?{close_intake} WHERE id = ?",
        [*params, supply_id],
    )
    if next_status == MP_SUPPLY_STATUS_DONE:
        ship_picked_stock(connection, supply_id, user_id)
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_STATUS, user_id=user_id,
        comment=f"{comment} ({MP_SUPPLY_STATUS_LABELS[next_status]})",
    )
    return next_status


def cancel_supply(connection, supply_id: str, user_id: str) -> None:
    supply = load_supply(connection, supply_id)
    status = str(supply["status"])
    if status in MP_SUPPLY_TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail="Поставка уже закрыта")
    now = _now()
    connection.execute(
        "UPDATE mp_supply_orders SET state = ?, updated_at = ? WHERE supply_id = ? AND state IN (?, ?)",
        (MP_SUPPLY_ORDER_UNSELECTED, now, supply_id,
         MP_SUPPLY_ORDER_SELECTED, MP_SUPPLY_ORDER_PENDING),
    )
    connection.execute(
        "UPDATE mp_supplies SET status = ?, updated_at = ? WHERE id = ?",
        (MP_SUPPLY_STATUS_CANCELLED, now, supply_id),
    )
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_STATUS, user_id=user_id,
        comment="Поставка аннулирована — заказы освобождены",
    )


def list_picking_supplies(connection) -> list[dict]:
    """Поставки на сборке — источник задачи «Собрать поставку»."""
    rows = connection.execute(
        "SELECT s.id, s.doc_number, s.status, s.cutoff_at, s.updated_at, s.created_at, "
        "s.picker_id, a.name AS account_name "
        "FROM mp_supplies s JOIN mp_accounts a ON a.id = s.account_id "
        "WHERE s.status = ? AND COALESCE(s.is_deleted, 0) = 0",
        (MP_SUPPLY_STATUS_PICKING,),
    ).fetchall()
    return [dict(r) for r in rows]


# ── FBS-поставки: сборка на ТСД ───────────────────────────────────────────────


def picked_by_variant(connection, supply_id: str) -> dict[str, int]:
    """Собрано по каждому варианту = нетто журнала сборки (откат — строка с минусом)."""
    rows = connection.execute(
        "SELECT variant_id, SUM(qty) AS qty FROM mp_supply_picks "
        "WHERE supply_id = ? AND variant_id IS NOT NULL GROUP BY variant_id",
        (supply_id,),
    ).fetchall()
    return {str(r["variant_id"]): int(r["qty"] or 0) for r in rows}


def _variant_by_barcode(connection, code: str) -> dict:
    """ШК → вариант вместе с variant_id: лист подбора свёрнут именно по варианту."""
    bc = (code or "").strip()
    if not bc:
        raise HTTPException(status_code=400, detail="Отсканируйте штрих-код товара")
    row = connection.execute(
        """SELECT v.id AS variant_id, v.product_id, v.color_id, v.size_id
           FROM product_barcodes pb
           JOIN product_variants v ON v.id = pb.variant_id
           JOIN products p ON p.id = v.product_id
           WHERE pb.barcode = ?
             AND COALESCE(pb.is_deleted, 0) = 0
             AND COALESCE(v.is_deleted, 0) = 0
             AND COALESCE(p.is_deleted, 0) = 0
           LIMIT 1""",
        (bc,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Штрих-код «{bc}» не найден — заведите его в карточке товара",
        )
    return {
        "variant_id": str(row["variant_id"]), "product_id": str(row["product_id"]),
        "color_id": row["color_id"], "size_id": row["size_id"],
    }


def _require_picking(connection, supply_id: str, user_id: str, role: str) -> dict:
    """Поставка на сборке, закреплённая за этим сборщиком.

    Свободную поставку скан закрепляет сам: сборщик мог начать с товара, а не с
    кнопки «Получить задачу», и упираться в лишний шаг посреди прохода незачем.
    """
    supply = load_supply(connection, supply_id)
    if str(supply["status"]) != MP_SUPPLY_STATUS_PICKING:
        raise HTTPException(status_code=400, detail="Поставка не на сборке")
    holder = supply["picker_id"]
    if holder and str(holder) != str(user_id) and role != "admin":
        raise HTTPException(status_code=409, detail="Поставку уже собирает другой сборщик")
    if not holder:
        now = _now()
        connection.execute(
            "UPDATE mp_supplies SET picker_id = ?, claimed_at = ?, updated_at = ? WHERE id = ?",
            (user_id, now, now, supply_id),
        )
        write_supply_op(
            connection, supply_id, MP_SUPPLY_OP_CLAIM, user_id=user_id,
            comment="Поставка взята в сборку",
        )
    return supply


def claim_next_supply(connection, user_id: str) -> str | None:
    """Взять следующую поставку из очереди сборки. → id или None, если очередь пуста.

    Уже взятая этим сборщиком возвращается той же кнопкой: незакрытая задача важнее
    новой. Захват атомарный (SKIP LOCKED) — два сборщика не получат одну поставку.
    """
    mine = connection.execute(
        "SELECT id FROM mp_supplies WHERE status = ? AND picker_id = ? "
        "AND COALESCE(is_deleted, 0) = 0 ORDER BY claimed_at ASC LIMIT 1",
        (MP_SUPPLY_STATUS_PICKING, user_id),
    ).fetchone()
    if mine:
        return str(mine["id"])
    now = _now()
    row = connection.execute(
        """UPDATE mp_supplies SET picker_id = ?, claimed_at = ?, updated_at = ?
           WHERE id = (
               SELECT id FROM mp_supplies
               WHERE status = ? AND picker_id IS NULL AND COALESCE(is_deleted, 0) = 0
               ORDER BY cutoff_at ASC NULLS LAST, doc_number ASC
               LIMIT 1 FOR UPDATE SKIP LOCKED
           )
           RETURNING id""",
        (user_id, now, now, MP_SUPPLY_STATUS_PICKING),
    ).fetchone()
    if not row:
        return None
    supply_id = str(row["id"])
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_CLAIM, user_id=user_id,
        comment="Поставка взята в сборку",
    )
    return supply_id


def picking_queue_size(connection) -> int:
    row = connection.execute(
        "SELECT COUNT(*) AS n FROM mp_supplies WHERE status = ? AND picker_id IS NULL "
        "AND COALESCE(is_deleted, 0) = 0",
        (MP_SUPPLY_STATUS_PICKING,),
    ).fetchone()
    return int(row["n"] or 0)


def release_supply(connection, supply_id: str, user_id: str, role: str) -> None:
    """Вернуть поставку в очередь. Собранное не откатывается — его доберёт следующий."""
    supply = load_supply(connection, supply_id)
    if str(supply["status"]) != MP_SUPPLY_STATUS_PICKING:
        raise HTTPException(status_code=400, detail="Поставка не на сборке")
    holder = supply["picker_id"]
    if not holder:
        return
    if str(holder) != str(user_id) and role not in ("admin", "manager", "warehouse_head"):
        raise HTTPException(status_code=403, detail="Поставку собирает другой сборщик")
    now = _now()
    connection.execute(
        "UPDATE mp_supplies SET picker_id = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?",
        (now, supply_id),
    )
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_RELEASE, user_id=user_id,
        comment="Поставка возвращена в очередь сборки",
    )


def _pick_sources(connection, *, variant: dict, client_id: str | None,
                  zone_id: str, container_id: str | None) -> list[dict]:
    """Откуда физически брать: короб в этом месте либо свободный остаток на полке."""
    from modules.containers.service import container_stock_rows, free_storage_sources

    def matches(row) -> bool:
        return (
            str(row["product_id"]) == variant["product_id"]
            and (row["color_id"] or None) == (variant["color_id"] or None)
            and (row["size_id"] or None) == (variant["size_id"] or None)
            and (row["client_id"] or None) == (client_id or None)
        )

    if container_id:
        return [
            r for r in container_stock_rows(connection, container_id)
            if matches(r) and r["op"] == INV_OP_STORAGE and r["quality"] == INV_Q_GOOD
            and (r["zone_id"] or None) == zone_id
        ]
    return [
        r for r in free_storage_sources(connection, variant, INV_Q_GOOD, zone_id)
        if (r["client_id"] or None) == (client_id or None)
    ]


def register_pick(connection, supply_id: str, *, barcode: str, zone_id: str,
                  container_id: str | None, qty: int, user_id: str, role: str) -> dict:
    """Скан позиции сборщиком: товар уходит с полки в корзину «Собрано под МП».

    Оси движения: место — откуда взяли, короб — из чего взяли (пустая ось = россыпь).
    Собранное намеренно не остаётся в storage: обещанное площадке не должно снова
    попасть ни в лист подбора соседней волны, ни в пул упаковки.
    """
    from modules.balances.service import insert_inventory_move
    from modules.containers.service import require_container, require_location

    supply = _require_picking(connection, supply_id, user_id, role)
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")

    zone = require_location(connection, zone_id, empty_detail="Отсканируйте место хранения")
    box = None
    if container_id:
        box = require_container(connection, container_id)
        if str(box["status"]) != CONTAINER_STATUS_PLACED:
            raise HTTPException(status_code=400, detail="Короб не размещён в месте хранения")

    variant = _variant_by_barcode(connection, barcode)
    detail = supply_detail(connection, supply_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Поставка не найдена")
    item = next(
        (i for i in detail["pick_list"] if i["variant_id"] == variant["variant_id"]), None,
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Этого товара нет в поставке")
    if item["remaining_qty"] <= 0:
        raise HTTPException(status_code=400, detail="По этой позиции уже собрано всё, что нужно")
    if n > item["remaining_qty"]:
        raise HTTPException(
            status_code=400,
            detail=f"По этой позиции осталось собрать {item['remaining_qty']} шт.",
        )

    client_id = str(detail["doc"]["client_id"]) if detail["doc"]["client_id"] else None
    sources = _pick_sources(
        connection, variant=variant, client_id=client_id,
        zone_id=zone[0], container_id=container_id,
    )
    available = sum(int(r["net"]) for r in sources)
    if available < n:
        raise HTTPException(
            status_code=400,
            detail=(
                f"В коробе {box['doc_number']} этого товара только {available} шт."
                if container_id else
                f"В месте «{zone[1]}» этого товара свободно только {available} шт. "
                "(если он в коробе — отсканируйте короб)"
            ),
        )

    remaining = n
    for src in sources:
        if remaining <= 0:
            break
        take = min(remaining, int(src["net"]))
        insert_inventory_move(
            connection,
            product_id=src["product_id"], product_name=src["product_name"], product_sku=src["product_sku"],
            color_id=src["color_id"], color_name=src["color_name"],
            size_id=src["size_id"], size_name=src["size_name"],
            client_id=src["client_id"], client_name=src["client_name"],
            from_op=INV_OP_STORAGE, to_op=INV_OP_PICKED,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=zone[0], from_zone_name=zone[1],
            to_zone_id=None, to_zone_name=None,
            qty=take, user_id=user_id,
            from_container_id=container_id, to_container_id=None,
            comment=(f"Сборка поставки {supply['doc_number']}: {take} шт. "
                     f"из места {zone[1]}" + (f", короб {box['doc_number']}" if box else "")),
        )
        remaining -= take

    pick_id = str(uuid4())
    connection.execute(
        "INSERT INTO mp_supply_picks (id, supply_id, variant_id, product_id, color_id, size_id, "
        "client_id, zone_id, container_id, qty, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (pick_id, supply_id, variant["variant_id"], variant["product_id"],
         variant["color_id"], variant["size_id"], client_id, zone[0], container_id,
         n, _now(), user_id),
    )
    title = " · ".join(str(x) for x in [
        item["product_name"], item["color_name"], item["size_name"],
    ] if x)
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_PICK, qty=n, user_id=user_id,
        comment=f"Собрано {n} шт.: {title} (место {zone[1]}"
                + (f", короб {box['doc_number']}" if box else "") + ")",
    )
    picked = item["picked_qty"] + n
    return {
        "pick_id": pick_id,
        "variant_id": variant["variant_id"],
        "product_name": item["product_name"],
        "color_name": item["color_name"],
        "size_name": item["size_name"],
        "picked_qty": picked,
        "need_qty": item["need_qty"],
        "remaining_qty": max(0, item["need_qty"] - picked),
    }


def undo_pick(connection, supply_id: str, pick_id: str, user_id: str, role: str) -> None:
    """Откат скана: товар возвращается туда, откуда его взяли (в короб — тоже в короб)."""
    from modules.balances.service import insert_inventory_move
    from modules.containers.service import require_location

    _require_picking(connection, supply_id, user_id, role)
    row = connection.execute(
        "SELECT * FROM mp_supply_picks WHERE id = ? AND supply_id = ?", (pick_id, supply_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Запись сборки не найдена")
    if int(row["qty"]) <= 0:
        raise HTTPException(status_code=400, detail="Эта запись уже откачена")
    done = connection.execute(
        "SELECT 1 FROM mp_supply_picks WHERE reverses_id = ?", (pick_id,),
    ).fetchone()
    if done:
        raise HTTPException(status_code=400, detail="Эта запись уже откачена")

    zone = require_location(connection, str(row["zone_id"]), empty_detail="Место не указано")
    names = connection.execute(
        """SELECT p.name AS product_name, COALESCE(NULLIF(v.sku, ''), p.sku) AS product_sku,
                  col.name AS color_name, sz.name AS size_name
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           LEFT JOIN colors col ON col.id = v.color_id
           LEFT JOIN sizes sz ON sz.id = v.size_id
           WHERE v.id = ?""",
        (row["variant_id"],),
    ).fetchone()
    client = connection.execute(
        "SELECT name FROM clients WHERE id = ?", (row["client_id"],),
    ).fetchone() if row["client_id"] else None
    qty = int(row["qty"])
    insert_inventory_move(
        connection,
        product_id=str(row["product_id"]),
        product_name=names["product_name"] if names else None,
        product_sku=names["product_sku"] if names else None,
        color_id=row["color_id"], color_name=names["color_name"] if names else None,
        size_id=row["size_id"], size_name=names["size_name"] if names else None,
        client_id=row["client_id"], client_name=client["name"] if client else None,
        from_op=INV_OP_PICKED, to_op=INV_OP_STORAGE,
        from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
        from_zone_id=None, from_zone_name=None,
        to_zone_id=zone[0], to_zone_name=zone[1],
        qty=qty, user_id=user_id,
        from_container_id=None, to_container_id=row["container_id"],
        comment=f"Откат сборки: {qty} шт. возвращены в место {zone[1]}",
    )
    connection.execute(
        "INSERT INTO mp_supply_picks (id, supply_id, variant_id, product_id, color_id, size_id, "
        "client_id, zone_id, container_id, qty, reverses_id, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (str(uuid4()), supply_id, row["variant_id"], row["product_id"], row["color_id"],
         row["size_id"], row["client_id"], row["zone_id"], row["container_id"],
         -qty, pick_id, _now(), user_id),
    )
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_PICK_UNDO, qty=qty, user_id=user_id,
        comment=f"Откат сборки: {qty} шт. возвращены в место {zone[1]}",
    )


def drop_supply_order(connection, supply_id: str, order_id: str, user_id: str) -> None:
    """Снять заказ с поставки, уже стоящей на сборке.

    Единственный выход из тупика «товара физически нет»: сборка не закрывается, пока
    состав не собран, поэтому недостачу разруливает менеджер — уменьшает состав.
    """
    supply = load_supply(connection, supply_id)
    if str(supply["status"]) != MP_SUPPLY_STATUS_PICKING:
        raise HTTPException(status_code=400, detail="Снять заказ можно только у поставки на сборке")
    row = connection.execute(
        "SELECT so.id, so.state, o.external_id FROM mp_supply_orders so "
        "JOIN mp_orders o ON o.id = so.order_id "
        "WHERE so.supply_id = ? AND so.order_id = ?",
        (supply_id, order_id),
    ).fetchone()
    if not row or str(row["state"]) not in MP_SUPPLY_ORDER_HOLDING:
        raise HTTPException(status_code=404, detail="Заказ не найден в составе поставки")
    connection.execute(
        "UPDATE mp_supply_orders SET state = ?, updated_at = ? WHERE id = ?",
        (MP_SUPPLY_ORDER_UNSELECTED, _now(), str(row["id"])),
    )
    write_supply_op(
        connection, supply_id, MP_SUPPLY_OP_ORDER_REMOVE, order_id=order_id, user_id=user_id,
        comment=f"Заказ {row['external_id']} снят со сборки — товара нет в наличии",
    )


def _pick_locations(connection, pairs: list[tuple[str, str]]) -> dict[tuple[str, str], list[dict]]:
    """Адреса позиции для ТСД: место + короб, в порядке обхода склада.

    В отличие от `_stock_by_variant` (там нужны только имена ячеек для доски) здесь
    держим id места и короба: сборщик сканирует их, и скан надо сверить с адресом.
    """
    uniq = sorted({(str(c), str(v)) for c, v in pairs if c and v})
    if not uniq:
        return {}
    values = ", ".join(
        "(?::text, ?::text)" if i == 0 else "(?, ?)" for i in range(len(uniq))
    )
    params: list = []
    for client_id, variant_id in uniq:
        params += [client_id, variant_id]
    rows = connection.execute(
        f"""
        WITH req(client_id, variant_id) AS (VALUES {values}),
        v AS (
            SELECT r.client_id, r.variant_id, pv.product_id, pv.color_id, pv.size_id
            FROM req r JOIN product_variants pv ON pv.id = r.variant_id
        ),
        mv AS (
            SELECT v.client_id, v.variant_id, zr.to_zone_id AS zone_id,
                   zr.to_container_id AS container_id, zr.qty AS net
            FROM v JOIN zone_relocations zr
              ON zr.product_id = v.product_id
             AND zr.color_id  IS NOT DISTINCT FROM v.color_id
             AND zr.size_id   IS NOT DISTINCT FROM v.size_id
             AND zr.client_id IS NOT DISTINCT FROM v.client_id
            WHERE zr.to_op = ? AND zr.to_quality = ?
            UNION ALL
            SELECT v.client_id, v.variant_id, zr.from_zone_id, zr.from_container_id, -zr.qty
            FROM v JOIN zone_relocations zr
              ON zr.product_id = v.product_id
             AND zr.color_id  IS NOT DISTINCT FROM v.color_id
             AND zr.size_id   IS NOT DISTINCT FROM v.size_id
             AND zr.client_id IS NOT DISTINCT FROM v.client_id
            WHERE zr.from_op = ? AND zr.from_quality = ?
        )
        SELECT mv.client_id, mv.variant_id, mv.zone_id, mv.container_id,
               uz.name AS zone_name, ct.doc_number AS container_number,
               SUM(mv.net) AS net
        FROM mv
        LEFT JOIN unloading_zones uz ON uz.id = mv.zone_id
        LEFT JOIN containers ct ON ct.id = mv.container_id
        GROUP BY mv.client_id, mv.variant_id, mv.zone_id, mv.container_id,
                 uz.name, ct.doc_number
        HAVING SUM(mv.net) > 0
        ORDER BY uz.name IS NULL, uz.name, ct.doc_number
        """,
        [*params, INV_OP_STORAGE, INV_Q_GOOD, INV_OP_STORAGE, INV_Q_GOOD],
    ).fetchall()
    out: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        key = (str(row["client_id"]), str(row["variant_id"]))
        out.setdefault(key, []).append({
            "zone_id": row["zone_id"], "zone_name": row["zone_name"],
            "container_id": row["container_id"], "container_number": row["container_number"],
            "qty": int(row["net"]),
        })
    return out


def supply_pick_view(connection, supply_id: str) -> dict:
    """Лист подбора для ТСД: что осталось собрать и по каким адресам идти."""
    detail = supply_detail(connection, supply_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Поставка не найдена")
    doc = detail["doc"]
    client_id = str(doc["client_id"]) if doc["client_id"] else None
    locations = _pick_locations(
        connection,
        [(client_id, i["variant_id"]) for i in detail["pick_list"] if i["variant_id"]],
    ) if client_id else {}
    items = []
    for item in detail["pick_list"]:
        row = dict(item)
        row["locations"] = locations.get((client_id, item["variant_id"]), []) if item["variant_id"] else []
        items.append(row)
    blockers = supply_advance_blockers(connection, supply_id, str(doc["status"]))
    return {
        "id": str(doc["id"]), "doc_number": str(doc["doc_number"]), "status": str(doc["status"]),
        "account_name": doc["account_name"], "client_name": doc["client_name"],
        "cutoff_at": doc["cutoff_at"], "overdue": bool(doc["overdue"]),
        "orders_total": int(doc["orders_total"]),
        "need_qty": sum(i["need_qty"] for i in items if i["linked"]),
        "picked_qty": sum(i["picked_qty"] for i in items),
        "remaining_qty": sum(i["remaining_qty"] for i in items if i["linked"]),
        "picker_id": doc["picker_id"], "picker_name": doc["picker_name"],
        "can_finish": not blockers,
        "blockers": blockers,
        "items": items,
    }

def ship_picked_stock(connection, supply_id: str, user_id: str) -> int:
    """Передача площадке: собранное уходит со склада (picked → shipped)."""
    from modules.balances.service import insert_inventory_move

    rows = connection.execute(
        """SELECT p.product_id, p.color_id, p.size_id, p.client_id, SUM(p.qty) AS qty,
                  MIN(pr.name) AS product_name,
                  MIN(COALESCE(NULLIF(v.sku, ''), pr.sku)) AS product_sku,
                  MIN(col.name) AS color_name, MIN(sz.name) AS size_name,
                  MIN(c.name) AS client_name
           FROM mp_supply_picks p
           LEFT JOIN product_variants v ON v.id = p.variant_id
           LEFT JOIN products pr ON pr.id = p.product_id
           LEFT JOIN colors col ON col.id = p.color_id
           LEFT JOIN sizes sz ON sz.id = p.size_id
           LEFT JOIN clients c ON c.id = p.client_id
           WHERE p.supply_id = ?
           GROUP BY p.product_id, p.color_id, p.size_id, p.client_id
           HAVING SUM(p.qty) > 0""",
        (supply_id,),
    ).fetchall()
    doc_number = str(load_supply(connection, supply_id)["doc_number"])
    total = 0
    for r in rows:
        qty = int(r["qty"])
        insert_inventory_move(
            connection,
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=INV_OP_PICKED, to_op=INV_OP_SHIPPED,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=None, from_zone_name=None, to_zone_id=None, to_zone_name=None,
            qty=qty, user_id=user_id,
            comment=f"Передано площадке по поставке {doc_number}: {qty} шт.",
        )
        total += qty
    return total
