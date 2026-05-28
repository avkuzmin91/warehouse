from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from config import (
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_LINE_QC_COMPLETE,
    RECEIPT_OP_LINE_QC_REOPEN,
    RECEIPT_OP_PLAN_FIX,
    RECEIPT_OP_QC_COMPLETE,
    RECEIPT_OP_RECEIVING,
    RECEIPT_OP_RECEIVING_CORRECTION,
    RECEIPT_OP_DEFECT_FIX,
    RECEIPT_OP_DEFECT_CORRECTION,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
)


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
    """Replay журнала операций → текущее состояние строк документа.

    Используется для detail-view. Для list-view используй list_receipts (агрегирующий SQL).
    """
    ops = connection.execute(
        "SELECT * FROM receipt_ops WHERE doc_id = ? ORDER BY created_at",
        (doc_id,),
    ).fetchall()
    lines_rows = connection.execute(
        "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchall()

    lines: dict[str, dict] = {}
    for lr in lines_rows:
        lines[str(lr["id"])] = {
            "id": str(lr["id"]),
            "product_id": str(lr["product_id"]),
            "product_name": str(lr["product_name"]),
            "product_sku": str(lr["product_sku"]),
            "color_id": lr["color_id"],
            "color_name": lr["color_name"],
            "size_id": lr["size_id"],
            "size_name": lr["size_name"],
            "planned_qty": int(lr["planned_qty"]),
            "accepted": 0,
            "defect": 0,
            "ops_count": 0,
            "qc_status": "pending",
        }

    for op in ops:
        ot = str(op["op_type"])
        lid = str(op["line_id"]) if op["line_id"] else None
        qty = int(op["qty"]) if op["qty"] is not None else 0

        if lid and lid in lines:
            line = lines[lid]
            if ot == RECEIPT_OP_RECEIVING:
                line["accepted"] += qty
                line["ops_count"] += 1
                if line["qc_status"] != "done":
                    line["qc_status"] = "in_progress"
            elif ot == RECEIPT_OP_DEFECT_FIX:
                line["defect"] += qty
                line["ops_count"] += 1
                if line["qc_status"] != "done":
                    line["qc_status"] = "in_progress"
            elif ot == RECEIPT_OP_RECEIVING_CORRECTION:
                line["accepted"] = qty
                if line["qc_status"] != "done":
                    line["qc_status"] = "in_progress"
            elif ot == RECEIPT_OP_DEFECT_CORRECTION:
                line["defect"] = qty
                if line["qc_status"] != "done":
                    line["qc_status"] = "in_progress"
            elif ot == RECEIPT_OP_LINE_QC_COMPLETE:
                line["qc_status"] = "done"
            elif ot == RECEIPT_OP_LINE_QC_REOPEN:
                line["qc_status"] = (
                    "in_progress"
                    if line["accepted"] > 0 or line["defect"] > 0 or line["ops_count"] > 0
                    else "pending"
                )

    line_list = list(lines.values())
    sku_count = len(line_list)
    total_planned = sum(l["planned_qty"] for l in line_list)
    total_accepted = sum(l["accepted"] for l in line_list)
    total_defect = sum(l["defect"] for l in line_list)
    all_qc_done = all(l["qc_status"] == "done" for l in line_list) if line_list else False

    return {
        "lines": line_list,
        "sku_count": sku_count,
        "total_planned": total_planned,
        "total_accepted": total_accepted,
        "total_defect": total_defect,
        "all_qc_done": all_qc_done,
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
    date_from: str | None,
    date_to: str | None,
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
        conds.append("d.status IN ('planned', 'on_review')")
        conds.append("d.arrival_date < ?")
        params.append(today)
    elif status and status in statuses_all:
        conds.append("d.status = ?")
        params.append(status)
    if search:
        s = f"%{search.strip()}%"
        conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
        params += [s, s]
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)

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
            d.status, d.zone_id, d.zone_name, d.ttn, d.logistics_cost,
            d.created_at, d.created_by,
            MAX(cl.name) AS client_name,
            COUNT(DISTINCT CASE WHEN l.is_deleted = 0 THEN l.id END) AS sku_count,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN l.planned_qty ELSE 0 END), 0) AS total_planned,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN (
                SELECT COALESCE(
                    (SELECT o2.qty FROM receipt_ops o2
                     WHERE o2.line_id = l.id AND o2.op_type = 'receiving_correction'
                     ORDER BY o2.created_at DESC LIMIT 1),
                    (SELECT COALESCE(SUM(o2.qty),0) FROM receipt_ops o2
                     WHERE o2.line_id = l.id AND o2.op_type = 'receiving')
                )
            ) ELSE 0 END), 0) AS total_accepted,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN (
                SELECT COALESCE(
                    (SELECT o2.qty FROM receipt_ops o2
                     WHERE o2.line_id = l.id AND o2.op_type = 'defect_correction'
                     ORDER BY o2.created_at DESC LIMIT 1),
                    (SELECT COALESCE(SUM(o2.qty),0) FROM receipt_ops o2
                     WHERE o2.line_id = l.id AND o2.op_type = 'defect_fix')
                )
            ) ELSE 0 END), 0) AS total_defect
        FROM receipt_docs d
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN receipt_lines l ON l.doc_id = d.id
        WHERE {where}
        GROUP BY d.id
        ORDER BY d.arrival_date DESC, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


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
        RECEIPT_OP_PLAN_FIX if next_status == "planned" else
        RECEIPT_OP_ARRIVAL_FIX if next_status == "on_review" else
        RECEIPT_OP_QC_COMPLETE
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
