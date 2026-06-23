from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    DISPATCH_CARGO_DEFECT,
    DISPATCH_CARGO_GOOD,
    DISPATCH_STATUS_LABELS,
    DISPATCH_STATUSES_ALL,
    DISPATCH_TERMINAL_STATUSES,
    DISPATCH_TRIP_SELECTABLE_STATUSES,
    INV_OP_READY,
    INV_OP_SHIPPED,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_UNLOADING,
)
from dbconn import like_substring_param


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_doc_number(connection) -> str:
    """Следующий номер документа отгрузки клиенту (DSP-NNNN).

    MAX подстроки вместо COUNT, чтобы дырки в нумерации не давали дубликатов;
    UNIQUE на doc_number гарантирует атомарность.
    """
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM dispatch_docs
        WHERE doc_number LIKE 'DSP-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"DSP-{n:04d}"


def normalize_cargo_type(raw: str | None) -> str:
    s = str(raw or DISPATCH_CARGO_GOOD).strip().lower()
    return s if s in (DISPATCH_CARGO_GOOD, DISPATCH_CARGO_DEFECT) else DISPATCH_CARGO_GOOD


def _doc_quality(connection, doc_id: str) -> str:
    """Качество остатка отгрузки: рейс брака → брак, иначе годный."""
    row = connection.execute(
        "SELECT cargo_type FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    cargo = normalize_cargo_type(row["cargo_type"] if row else None)
    return INV_Q_DEFECT if cargo == DISPATCH_CARGO_DEFECT else INV_Q_GOOD


def _source_ops(quality: str) -> list[str]:
    """Корзины-источники отгрузки, в порядке приоритета списания.

    Годный проходит упаковку (packed → ready) и отгружается прежде всего из «Готов к
    отгрузке» (`ready`), но раскладка в зону отгрузки — НЕ обязательна: если готового
    остатка не хватает, отгрузка добирает прямо «На хранении» (`storage`). Поэтому
    источник годного — `[ready, storage]` (сначала ready, затем storage).
    Брак упаковку не проходит — он отгружается напрямую `storage`.
    """
    return [INV_OP_STORAGE] if quality == INV_Q_DEFECT else [INV_OP_READY, INV_OP_STORAGE]


def check_lines_have_sku(connection, doc_id: str) -> None:
    """Гейт перевода в «Ожидает рейс»: у каждого товара должен быть присвоен SKU.

    Товар «ожидает SKU» (sku_pending) отгружать нельзя — артикул нужен для
    маркировки и счетов. Источник истины — `products.sku_pending`.
    """
    rows = connection.execute(
        """SELECT DISTINCT l.product_name
           FROM dispatch_lines l
           JOIN products p ON p.id = l.product_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND COALESCE(p.sku_pending, 0) = 1
           ORDER BY l.product_name""",
        (doc_id,),
    ).fetchall()
    if rows:
        names = ", ".join(f"«{r['product_name']}»" for r in rows)
        raise HTTPException(
            status_code=400,
            detail=f"Укажите SKU для товаров без артикула перед отгрузкой: {names}",
        )


def check_lines_have_ready(connection, doc_id: str) -> None:
    """Гейт перевода в «Ожидает рейс»: каждая позиция покрыта свободным остатком-источником.

    Спрос агрегируется по варианту (product/color/size), т.к. позиция может быть в
    нескольких строках (разные магазины), а остаток у неё общий. Источник зависит от
    груза: годный — `ready` (готов к отгрузке), брак — `storage` (на хранении).
    """
    from modules.balances.service import ready_available_for_dispatch

    doc = connection.execute(
        "SELECT client_id FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    client_id = doc["client_id"] if doc else None
    quality = _doc_quality(connection, doc_id)
    source_ops = _source_ops(quality)

    rows = connection.execute(
        """SELECT product_id, color_id, size_id,
                  MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
                  MIN(color_name) AS color_name, MIN(size_name) AS size_name,
                  SUM(qty) AS demand
           FROM dispatch_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
           GROUP BY product_id, color_id, size_id""",
        (doc_id,),
    ).fetchall()

    short: list[str] = []
    for r in rows:
        avail = ready_available_for_dispatch(
            connection,
            product_id=str(r["product_id"]),
            color_id=r["color_id"],
            size_id=r["size_id"],
            client_id=client_id,
            quality=quality,
            ops=source_ops,
            exclude_doc_id=doc_id,
        )
        demand = int(r["demand"] or 0)
        if demand > avail:
            label = " · ".join(x for x in [r["product_sku"], r["color_name"], r["size_name"]] if x) or r["product_name"]
            avail_word = "на хранении" if quality == INV_Q_DEFECT else "доступно"
            short.append(f"«{label}»: нужно {demand}, {avail_word} {avail}")
    if short:
        head = (
            "Недостаточно брака на хранении для отгрузки. " if quality == INV_Q_DEFECT
            else "Недостаточно товара (готового и на хранении) для отгрузки. "
        )
        raise HTTPException(status_code=400, detail=head + "; ".join(short))


def dispatch_alloc_remaining(connection, doc_id: str) -> dict[str, int]:
    """Остаток к распределению по строкам отгрузки (для привязки к рейсу).

    Спрос строки = qty − shipped_qty − уже распределённое в активные ещё-не-уехавшие
    рейсы. Ограничивается жадно общим готовым остатком варианта (несколько строк
    одного варианта делят один пул `ready`).
    """
    from modules.balances.service import ready_zones_for_variant

    doc = connection.execute(
        "SELECT client_id FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    client_id = doc["client_id"] if doc else None
    quality = _doc_quality(connection, doc_id)
    source_ops = _source_ops(quality)

    lines = connection.execute(
        "SELECT id, product_id, color_id, size_id "
        "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY created_at, id",
        (doc_id,),
    ).fetchall()

    variant_ready_left: dict[tuple, int] = {}
    for ln in lines:
        key = (str(ln["product_id"]), ln["color_id"], ln["size_id"])
        if key in variant_ready_left:
            continue
        total = 0
        for op in source_ops:
            zones = ready_zones_for_variant(
                connection,
                product_id=str(ln["product_id"]),
                color_id=ln["color_id"],
                size_id=ln["size_id"],
                client_id=client_id,
                quality=quality,
                op=op,
            )
            total += sum(int(z["net"]) for z in zones)
        variant_ready_left[key] = total

    result: dict[str, int] = {}
    for ln in lines:
        line_id = str(ln["id"])
        full = connection.execute(
            "SELECT qty, COALESCE(shipped_qty, 0) AS shipped_qty FROM dispatch_lines WHERE id = ?",
            (line_id,),
        ).fetchone()
        pending = connection.execute(
            """SELECT COALESCE(SUM(ta.qty), 0) AS q FROM trip_alloc ta
               JOIN trip_lines tl ON tl.id = ta.trip_line_id
               JOIN trip_docs td ON td.id = tl.trip_id
               WHERE ta.dispatch_line_id = ?
                 AND COALESCE(ta.is_deleted, 0) = 0
                 AND COALESCE(tl.is_deleted, 0) = 0
                 AND td.status IN (?, ?, ?)""",
            (line_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
        ).fetchone()
        base = max(0, int(full["qty"] or 0) - int(full["shipped_qty"] or 0) - int(pending["q"] or 0))
        key = (str(ln["product_id"]), ln["color_id"], ln["size_id"])
        give = min(base, variant_ready_left.get(key, 0))
        variant_ready_left[key] = variant_ready_left.get(key, 0) - give
        result[line_id] = give
    return result


def _insert_shipped_move(
    connection, *,
    line, client_id: str | None, client_name: str | None, quality: str,
    from_op: str, from_zone_id: str | None, from_zone_name: str | None,
    qty: int, user_id: str | None, dispatch_line_id: str, trip_id: str | None,
    comment: str | None,
) -> None:
    """Журнальная запись списания при отгрузке (`from_op` → shipped) с атрибуцией к строке.

    Прямой INSERT в zone_relocations (а не insert_inventory_move): движение нужно
    привязать к dispatch_line_id, которого нет в сигнатуре balances.insert_inventory_move.
    Список столбцов скопирован из balances.insert_inventory_move плюс dispatch_line_id.
    `from_op` — корзина-источник: `ready` для годного, `storage` для брака.
    """
    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id,reason,trip_id,dispatch_line_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), str(line["product_id"]), line["product_name"], line["product_sku"],
         line["color_id"], line["color_name"], line["size_id"], line["size_name"],
         client_id, client_name, from_op, INV_OP_SHIPPED, quality, quality,
         from_zone_id, from_zone_name, None, None, qty, comment,
         _now(), user_id, None,
         None, None, None, None, None, trip_id, dispatch_line_id),
    )


def consume_stock_for_dispatch(
    connection, doc_id: str, user_id: str,
    *, alloc: dict[str, int] | None = None, trip_id: str | None = None,
) -> None:
    """Списание остатков при выезде рейса: журнальные движения (источник → shipped).

    Без commit — коммитит вызывающий (каскад рейса). Остаток берётся ПО ВАРИАНТУ
    (product/color/size × client × quality), т.к. отгрузка не знает, какая задача
    упаковки его подготовила. Источник зависит от груза: годный — `ready`, брак —
    `storage` (отгружается прямо с хранения). `alloc` — сколько каждой строки увозит
    этот рейс; при alloc=None списывается весь доступный остаток. shipped_qty
    накапливается (инкремент), так отгрузка может уезжать несколькими рейсами.
    trip_id пишется в журнал для точного сторно при отмене рейса.
    """
    doc_row = connection.execute(
        "SELECT client_id, client_name, cargo_type FROM dispatch_docs WHERE id = ?",
        (doc_id,),
    ).fetchone()
    cargo_type = normalize_cargo_type(doc_row["cargo_type"] if doc_row else None)
    client_id = doc_row["client_id"] if doc_row else None
    client_name = doc_row["client_name"] if doc_row else None
    quality = INV_Q_DEFECT if cargo_type == DISPATCH_CARGO_DEFECT else INV_Q_GOOD
    source_ops = _source_ops(quality)
    comment_prefix = "Отгрузка брака" if cargo_type == DISPATCH_CARGO_DEFECT else "Отгрузка"
    avail_word = "брака на хранении" if cargo_type == DISPATCH_CARGO_DEFECT else "товара (готового и на хранении)"

    from modules.balances.service import ready_zones_for_variant

    lines = connection.execute(
        "SELECT * FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()

    for line in lines:
        line_id = str(line["id"])
        # Корзины-источники в порядке приоритета (ready раньше storage для годного),
        # каждая помечена своим `op` — он пишется во `from_op` журнальной записи.
        zones: list[dict] = []
        for op in source_ops:
            for z in ready_zones_for_variant(
                connection,
                product_id=str(line["product_id"]),
                color_id=line["color_id"],
                size_id=line["size_id"],
                client_id=client_id,
                quality=quality,
                op=op,
            ):
                zones.append({**z, "op": op})
        available = sum(int(z["net"]) for z in zones)
        target = int(alloc.get(line_id, 0)) if alloc is not None else available
        if target <= 0:
            continue
        if target > available:
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно {avail_word} для отгрузки: нужно {target}, есть {available}",
            )

        shipped_total = 0
        remaining = target
        for src in zones:
            if remaining <= 0:
                break
            take = min(remaining, int(src["net"]))
            _insert_shipped_move(
                connection,
                line=line, client_id=client_id, client_name=client_name, quality=quality,
                from_op=src["op"],
                from_zone_id=src["zone_id"], from_zone_name=src["zone_name"],
                qty=take, user_id=user_id, dispatch_line_id=line_id, trip_id=trip_id,
                comment=f"{comment_prefix}: {take} шт.",
            )
            shipped_total += take
            remaining -= take

        connection.execute(
            "UPDATE dispatch_lines SET shipped_qty = COALESCE(shipped_qty, 0) + ? WHERE id = ?",
            (shipped_total, line_id),
        )


def dispatch_fully_shipped(connection, doc_id: str) -> bool:
    """True, если по всем строкам отгрузки отгружать больше нечего.

    Завершённость считаем по плану/факту строки: (qty − shipped_qty) <= 0 по всем
    строкам. Так не зависает случай нескольких строк одного варианта (они делят
    общий пул `ready`, и проверка по варианту могла бы не сойтись построчно);
    для v1 этого критерия достаточно — план набирается shipped_qty при выезде рейсов.
    """
    rows = connection.execute(
        "SELECT qty, COALESCE(shipped_qty, 0) AS shipped_qty "
        "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()
    for r in rows:
        if int(r["qty"] or 0) - int(r["shipped_qty"] or 0) > 0:
            return False
    return True


def _dispatch_priority_order(alias: str = "d") -> str:
    return (
        f"CASE WHEN {alias}.priority_rank IS NULL THEN 1 ELSE 0 END, "
        f"{alias}.priority_rank ASC NULLS LAST, "
        f"{alias}.ship_date ASC NULLS LAST, "
        f"{alias}.created_at DESC"
    )


def list_dispatches_aggregated(
    connection, *,
    page: int, limit: int,
    client_id: str | None = None,
    status: str | None = None,
    search: str | None = None,
    sku: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    cargo_type: str | None = None,
    available_for_trip_id: str | None = None,
) -> tuple[list[dict], int]:
    """Агрегирующий список отгрузок (один SQL, без replay по строкам)."""
    conds = ["d.is_deleted = 0"]
    params: list = []
    use_priority_order = False

    if cargo_type in (DISPATCH_CARGO_GOOD, DISPATCH_CARGO_DEFECT):
        conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)

    if available_for_trip_id and available_for_trip_id.strip():
        # Кандидаты в рейс: только нужного типа груза, в статусах привязки, ещё не
        # привязанные к ЭТОМУ рейсу (к другим — могут, отгрузка едет несколькими рейсами).
        selectable = list(DISPATCH_TRIP_SELECTABLE_STATUSES)
        placeholders = ",".join("?" for _ in selectable)
        conds.append(f"d.status IN ({placeholders})"); params.extend(selectable)
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.dispatch_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 AND tl.trip_id = ?)"
        )
        params.append(available_for_trip_id.strip())
        use_priority_order = True

    if status:
        requested = [s.strip() for s in status.split(",") if s.strip()]
        allowed = [s for s in requested if s in DISPATCH_STATUSES_ALL]
        if len(allowed) == 1:
            conds.append("d.status = ?"); params.append(allowed[0])
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
        if allowed and all(s not in DISPATCH_TERMINAL_STATUSES for s in allowed):
            use_priority_order = True

    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
        params += [s, s, s]
    if sku:
        conds.append(
            "EXISTS (SELECT 1 FROM dispatch_lines dl"
            " LEFT JOIN products p ON p.id = dl.product_id"
            " WHERE dl.doc_id = d.id AND COALESCE(dl.is_deleted,0)=0"
            " AND COALESCE(NULLIF(p.sku, ''), dl.product_sku) LIKE ?)"
        )
        params.append(like_substring_param(sku))
    if date_from:
        conds.append("d.ship_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?"); params.append(date_to)

    where = " AND ".join(conds)
    total = int(connection.execute(
        f"SELECT COUNT(*) AS cnt FROM dispatch_docs d WHERE {where}", params
    ).fetchone()["cnt"])

    offset = (page - 1) * limit
    order_by = _dispatch_priority_order() if use_priority_order else "d.ship_date DESC NULLS LAST, d.created_at DESC"
    rows = connection.execute(
        f"""SELECT d.*,
                COUNT(DISTINCT l.product_id) FILTER (WHERE l.is_deleted=0) AS sku_count,
                COALESCE(SUM(l.qty) FILTER (WHERE l.is_deleted=0), 0) AS total_qty,
                COALESCE(SUM(COALESCE(l.shipped_qty, 0)) FILTER (WHERE l.is_deleted=0), 0) AS total_shipped_qty
            FROM dispatch_docs d
            LEFT JOIN dispatch_lines l ON l.doc_id = d.id
            WHERE {where}
            GROUP BY d.id
            ORDER BY {order_by}
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "cargo_type": normalize_cargo_type(r.get("cargo_type")),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "destination": r["destination"],
            "carrier": r["carrier"],
            "logistics_cost": float(r["logistics_cost"]) if r.get("logistics_cost") is not None else None,
            "ship_date": r["ship_date"],
            "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            "status": str(r["status"]),
            "status_label": DISPATCH_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            "sku_count": int(r["sku_count"] or 0),
            "total_qty": int(r["total_qty"] or 0),
            "total_shipped_qty": int(r["total_shipped_qty"] or 0),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]
    return items, total


def get_dispatch_detail(connection, doc_id: str) -> dict | None:
    """Документ + строки (sku_pending, remaining) + ops (email) + рейсы. None если нет."""
    row = connection.execute(
        "SELECT * FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
    ).fetchone()
    if not row:
        return None

    remaining = dispatch_alloc_remaining(connection, doc_id)

    lines_rows = connection.execute(
        "SELECT l.*, COALESCE(p.sku_pending, 0) AS sku_pending, "
        "COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS effective_sku "
        "FROM dispatch_lines l "
        "LEFT JOIN products p ON p.id = l.product_id "
        "WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 ORDER BY l.created_at, l.id",
        (doc_id,),
    ).fetchall()
    ops_rows = connection.execute(
        """SELECT o.*, u.email AS user_email
           FROM dispatch_ops o LEFT JOIN users u ON u.id = o.created_by
           WHERE o.doc_id = ? ORDER BY o.created_at DESC""",
        (doc_id,),
    ).fetchall()
    trip_rows = connection.execute(
        "SELECT DISTINCT t.id AS trip_id, t.trip_number AS trip_number "
        "FROM trip_lines tl "
        "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
        "WHERE tl.dispatch_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 "
        "ORDER BY t.trip_number",
        (doc_id,),
    ).fetchall()

    lines = [
        {
            "id": str(l["id"]),
            "product_id": str(l["product_id"]),
            "product_name": str(l["product_name"]),
            "product_sku": str(l["effective_sku"]),
            "sku_pending": bool(l["sku_pending"]),
            "color_id": l["color_id"],
            "color_name": l["color_name"],
            "size_id": l["size_id"],
            "size_name": l["size_name"],
            "qty": int(l["qty"] or 0),
            "shipped_qty": int(l["shipped_qty"] or 0),
            "site_url": l["site_url"],
            "store_id": l["store_id"],
            "store_name": l["store_name"],
            "remaining": int(remaining.get(str(l["id"]), 0)),
        }
        for l in lines_rows
    ]
    ops = [
        {
            "id": str(o["id"]),
            "op_type": str(o["op_type"]),
            "comment": o["comment"],
            "created_at": str(o["created_at"]),
            "created_by": o["created_by"],
            "created_by_email": o["user_email"],
        }
        for o in ops_rows
    ]
    trips = [{"id": str(tr["trip_id"]), "number": str(tr["trip_number"])} for tr in trip_rows]

    return {
        "id": str(row["id"]),
        "doc_number": str(row["doc_number"]),
        "cargo_type": normalize_cargo_type(row.get("cargo_type")),
        "client_id": row["client_id"],
        "client_name": row["client_name"],
        "destination": row["destination"],
        "carrier": row["carrier"],
        "logistics_cost": float(row["logistics_cost"]) if row.get("logistics_cost") is not None else None,
        "ship_date": row["ship_date"],
        "priority_rank": int(row["priority_rank"]) if row.get("priority_rank") is not None else None,
        "actual_ship_date": row.get("actual_ship_date"),
        "comment": row["comment"],
        "status": str(row["status"]),
        "status_label": DISPATCH_STATUS_LABELS.get(str(row["status"]), str(row["status"])),
        "trips": trips,
        "created_at": str(row["created_at"]),
        "created_by": row["created_by"],
        "updated_at": row["updated_at"],
        "lines": lines,
        "ops": ops,
        "sku_count": len(lines),
        "total_qty": sum(l["qty"] for l in lines),
    }
