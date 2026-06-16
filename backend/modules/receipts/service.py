from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    INV_OP_INTAKE,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_INTAKE_START,
    RECEIPT_OP_PLAN_FIX,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
    TRIP_STATUS_CANCELLED,
)
from dbconn import like_substring_param


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_doc_number(connection) -> str:
    """Генерирует следующий номер документа поступления.

    Использует MAX вместо COUNT, чтобы не давать дубликатов при пустых дырках.
    UNIQUE constraint на doc_number в baseline-миграции гарантирует атомарность.
    """
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 4) AS INTEGER)), 0) AS max_n
        FROM receipt_docs
        WHERE doc_number LIKE 'WH-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"WH-{n:05d}"


def compute_state(connection, doc_id: str) -> dict:
    """Сводка документа поступления по строкам (без QC — годность определяется при упаковке)."""
    lines_rows = connection.execute(
        "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchall()

    line_list = [
        {
            "id": str(lr["id"]),
            "product_id": str(lr["product_id"]),
            "product_name": str(lr["product_name"]),
            "product_sku": str(lr["product_sku"]),
            "color_id": lr["color_id"],
            "color_name": lr["color_name"],
            "size_id": lr["size_id"],
            "size_name": lr["size_name"],
            "storage_zone_id": lr["storage_zone_id"],
            "storage_zone_name": lr["storage_zone_name"],
            "planned_qty": int(lr["planned_qty"]),
            "accepted_qty": int(lr["accepted_qty"]) if lr["accepted_qty"] is not None else None,
        }
        for lr in lines_rows
    ]

    return {
        "lines": line_list,
        "sku_count": len(line_list),
        "total_planned": sum(l["planned_qty"] for l in line_list),
        "total_accepted_qty": sum(l["accepted_qty"] or 0 for l in line_list),
    }


def list_receipts_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    status: str | None,
    overdue: bool,
    search: str | None,
    sku: str | None,
    date_from: str | None,
    date_to: str | None,
    unlinked_to_trip: bool,
    available_for_trip_id: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    """Агрегирующий запрос для списка поступлений — без N+1.

    Возвращает (total, rows). Каждый row содержит агрегаты sku_count, total_planned,
    total_accepted, total_defect, вычисленные одним SQL.
    """
    from datetime import date as _date
    today = _date.today().isoformat()

    conds = ["d.is_deleted = 0"]
    params: list = []

    if client_id:
        conds.append("d.client_id = ?")
        params.append(client_id.strip())
    if overdue:
        conds.append("d.status IN ('planned', 'on_intake', 'on_review')")
        conds.append("d.arrival_date < ?")
        params.append(today)
    elif status:
        # Поддерживаем как одно значение, так и CSV ("planned,partially_received" —
        # кандидаты для привязки к рейсу).
        requested = [s.strip() for s in str(status).split(",") if s.strip()]
        allowed = [s for s in requested if s in statuses_all]
        if len(allowed) == 1:
            conds.append("d.status = ?")
            params.append(allowed[0])
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})")
            params.extend(allowed)
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
        params += [s, s]
    if sku:
        conds.append(
            "EXISTS (SELECT 1 FROM receipt_lines rl"
            " WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted,0)=0 AND rl.product_sku LIKE ?)"
        )
        params.append(like_substring_param(sku))
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)
    if available_for_trip_id and str(available_for_trip_id).strip():
        # Поступление может приезжать несколькими рейсами: исключаем только привязанные
        # к ЭТОМУ рейсу; привязанные к другим рейсам остаются кандидатами (остаток).
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.receipt_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 AND tl.trip_id = ?)"
        )
        params.append(str(available_for_trip_id).strip())
    elif unlinked_to_trip:
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.receipt_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0)"
        )

    where = " AND ".join(conds)

    total_row = connection.execute(
        f"SELECT COUNT(*) AS cnt FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id WHERE {where}",
        params,
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit

    # Агрегаты по строкам вычисляются одним JOIN — нет N+1.
    # accepted = последняя receiving_correction ИЛИ сумма receiving.
    # defect   = последняя defect_correction ИЛИ сумма defect_fix.
    rows = connection.execute(
        f"""
        SELECT
            d.id, d.doc_number, d.client_id, d.supplier_name, d.arrival_date,
            d.actual_arrival_date,
            d.comment, d.status, d.zone_id, d.zone_name, d.ttn, d.logistics_cost,
            d.created_at, d.created_by,
            MAX(cl.name) AS client_name,
            COUNT(DISTINCT CASE WHEN l.is_deleted = 0 THEN l.id END) AS sku_count,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN l.planned_qty ELSE 0 END), 0) AS total_planned,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN COALESCE(l.accepted_qty, 0) ELSE 0 END), 0) AS total_accepted_qty
        FROM receipt_docs d
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN receipt_lines l ON l.doc_id = d.id
        WHERE {where}
        GROUP BY d.id
        ORDER BY COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def list_receipt_lines(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    status: str | None,
    overdue: bool,
    search: str | None,
    sku: str | None,
    date_from: str | None,
    date_to: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    """Плоский список позиций поступлений (разрез «По товарам»): одна строка = строка документа."""
    from datetime import date as _date
    today = _date.today().isoformat()

    conds = ["d.is_deleted = 0", "l.is_deleted = 0"]
    params: list = []

    if client_id:
        conds.append("d.client_id = ?")
        params.append(client_id.strip())
    if overdue:
        conds.append("d.status IN ('planned', 'on_intake', 'on_review')")
        conds.append("d.arrival_date < ?")
        params.append(today)
    elif status:
        # Поддерживаем как одно значение, так и CSV ("planned,partially_received" —
        # кандидаты для привязки к рейсу).
        requested = [s.strip() for s in str(status).split(",") if s.strip()]
        allowed = [s for s in requested if s in statuses_all]
        if len(allowed) == 1:
            conds.append("d.status = ?")
            params.append(allowed[0])
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})")
            params.extend(allowed)
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
        params += [s, s]
    if sku:
        s = like_substring_param(sku)
        conds.append("(l.product_sku LIKE ? OR l.product_name LIKE ?)")
        params += [s, s]
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)

    where = " AND ".join(conds)

    total_row = connection.execute(
        f"""SELECT COUNT(*) AS cnt
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {where}""",
        params,
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""SELECT
                l.id AS line_id, l.doc_id,
                l.product_id, l.product_name, l.product_sku,
                l.color_name, l.size_name,
                l.planned_qty, l.accepted_qty, l.storage_zone_name,
                d.doc_number, d.client_id, d.arrival_date, d.actual_arrival_date, d.status,
                cl.name AS client_name
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {where}
            ORDER BY COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC, l.created_at
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def receive_stock_for_receipt(
    connection, doc_id: str, user_id: str,
    *, alloc: dict[str, int] | None = None, trip_id: str | None = None,
) -> None:
    """Приёмка остатков при разгрузке inbound-рейса: журнал intake → storage.

    Без commit — коммитит вызывающий (каскад рейса). `alloc` — сколько каждой строки
    привёз этот рейс {receipt_line_id: qty}. При `alloc=None` принимается весь
    непринятый план (план − accepted_qty). `accepted_qty` накапливается (инкремент),
    поэтому поступление может приезжать несколькими рейсами. `trip_id` пишется в
    журнал для точного сторно при отмене рейса. Зеркало consume_stock_for_shipment.
    """
    from modules.balances.service import get_receiving_zone, insert_inventory_move

    doc_row = connection.execute(
        "SELECT d.doc_number, d.client_id, cl.name AS client_name "
        "FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id WHERE d.id = ?",
        (doc_id,),
    ).fetchone()
    client_id = doc_row["client_id"] if doc_row else None
    client_name = doc_row["client_name"] if doc_row else None
    doc_number = doc_row["doc_number"] if doc_row else ""

    lines = connection.execute(
        "SELECT * FROM receipt_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()
    now = _now()
    # При разгрузке рейса кладовщик не назначает финальную полку построчно — товар без
    # места приходуем в буферную «Зону приёмки» (раскладка на стеллажи — отдельным шагом).
    receiving_zone: tuple[str, str] | None = None
    for line in lines:
        line_id = str(line["id"])
        planned = int(line["planned_qty"] or 0)
        already = int(line["accepted_qty"] or 0)
        qty = int(alloc.get(line_id, 0)) if alloc is not None else max(planned - already, 0)
        if qty <= 0:
            continue
        zone_id = line["storage_zone_id"]
        zone_name = line["storage_zone_name"]
        if not zone_id:
            if receiving_zone is None:
                receiving_zone = get_receiving_zone(connection)
            zone_id, zone_name = receiving_zone
            connection.execute(
                "UPDATE receipt_lines SET storage_zone_id = ?, storage_zone_name = ? WHERE id = ?",
                (zone_id, zone_name, line_id),
            )
        insert_inventory_move(
            connection,
            product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
            color_id=line["color_id"], color_name=line["color_name"],
            size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name=client_name,
            from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=zone_id, to_zone_name=zone_name,
            qty=qty, user_id=user_id, receipt_line_id=line_id, trip_id=trip_id,
            comment=f"Приёмка по поступлению {doc_number}: {qty} шт. (рейс)",
        )
        connection.execute(
            "UPDATE receipt_lines SET accepted_qty = COALESCE(accepted_qty, 0) + ? WHERE id = ?",
            (qty, line_id),
        )
        connection.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, line_id, RECEIPT_OP_ARRIVAL_ACCEPT, qty,
             f"Принято рейсом: {qty} шт.", now, user_id),
        )


def receipt_alloc_remaining(connection, doc_id: str) -> dict[str, int]:
    """Остаток к распределению по строкам поступления: planned − активные trip_alloc.

    Исключает аллокации отменённых рейсов. Гейт пере-аллокации при привязке к рейсу.
    """
    rows = connection.execute(
        """SELECT rl.id AS line_id, rl.planned_qty AS planned,
                  COALESCE((SELECT SUM(ta.qty) FROM trip_alloc ta
                            JOIN trip_lines tl ON tl.id = ta.trip_line_id
                            JOIN trip_docs td ON td.id = tl.trip_id
                            WHERE ta.receipt_line_id = rl.id
                              AND COALESCE(ta.is_deleted, 0) = 0
                              AND COALESCE(tl.is_deleted, 0) = 0
                              AND td.status != ?), 0) AS allocated
           FROM receipt_lines rl
           WHERE rl.doc_id = ? AND COALESCE(rl.is_deleted, 0) = 0""",
        (TRIP_STATUS_CANCELLED, doc_id),
    ).fetchall()
    return {str(r["line_id"]): int(r["planned"]) - int(r["allocated"]) for r in rows}


def receipt_fully_received(connection, doc_id: str) -> bool:
    """True, если по всем строкам принято не меньше плана (приёмка завершена)."""
    row = connection.execute(
        """SELECT COUNT(*) AS pending
           FROM receipt_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
             AND COALESCE(accepted_qty, 0) < planned_qty""",
        (doc_id,),
    ).fetchone()
    return int(row["pending"]) == 0 if row else True


def advance_receipt(connection, doc_id: str, user_id: str) -> str:
    """Переводит документ на следующий статус по цепочке. Возвращает новый статус."""
    doc_row = connection.execute(
        "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc_row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Документ не найден")

    current = str(doc_row["status"])
    next_status = RECEIPT_STATUS_TRANSITIONS.get(current)
    if next_status is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Документ уже в финальном статусе")

    op_type = (
        RECEIPT_OP_PLAN_FIX if next_status == RECEIPT_STATUS_PLANNED else
        RECEIPT_OP_INTAKE_START
    )

    now = _now()
    connection.execute(
        "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
        (next_status, now, doc_id),
    )
    connection.execute(
        "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (
            str(uuid4()), doc_id, op_type,
            f"{RECEIPT_STATUS_RU.get(current, current)} → {RECEIPT_STATUS_RU.get(next_status, next_status)}",
            now, user_id,
        ),
    )
    connection.commit()
    return next_status
