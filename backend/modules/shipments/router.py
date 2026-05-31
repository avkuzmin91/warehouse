from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_EDITABLE_LINE_STATUSES,
    SHIPMENT_REVERT_TRANSITIONS,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUSES_ALL,
    SHIPMENT_TRANSITIONS,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.shipments.schemas import (
    ShipmentDetailResponse,
    ShipmentDocCreate,
    ShipmentDocUpdate,
    ShipmentLineIn,
    ShipmentLineItem,
    ShipmentListItem,
    ShipmentListResponse,
    ShipmentOpItem,
)
from modules.shipments.service import advance_shipment, next_doc_number, normalize_cargo_type

router = APIRouter(tags=["shipments"])

_get_manager = get_current_manager


def _now() -> str:
    return datetime.now(UTC).isoformat()


@router.post("/shipments")
def create_shipment(body: ShipmentDocCreate, user=Depends(_get_manager)):
    uid = str(user["id"])
    now = _now()
    doc_id = str(uuid4())
    cargo_type = normalize_cargo_type(body.cargo_type)

    with get_connection() as conn:
        doc_num = next_doc_number(conn)
        conn.execute(
            """INSERT INTO shipment_docs
               (id,doc_number,cargo_type,client_id,client_name,destination,carrier,ship_date,comment,status,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, doc_num, cargo_type, body.client_id, body.client_name,
             body.destination, body.carrier, body.ship_date, body.comment,
             SHIPMENT_STATUS_DRAFT, now, uid),
        )
        for line in body.lines:
            conn.execute(
                """INSERT INTO shipment_lines
                   (id,doc_id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,qty,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid4()), doc_id, line.product_id, line.product_name, line.product_sku,
                 line.color_id, line.color_name, line.size_id, line.size_name, line.qty, now),
            )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), doc_id, "doc_create", now, uid),
        )
        conn.commit()
    return {"message": doc_id}


@router.get("/shipments/summary")
def shipments_summary(
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = f"%{search.strip()}%"
            conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
            params += [s, s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM shipment_lines sl"
                " WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted,0)=0 AND sl.product_sku LIKE ?)"
            )
            params.append(f"%{sku.strip()}%")
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        where = " AND ".join(conds)
        rows = conn.execute(
            f"SELECT d.status, d.ship_date FROM shipment_docs d WHERE {where}", params
        ).fetchall()
    today = date.today().isoformat()
    return {
        "all":     len(rows),
        "done":    sum(1 for r in rows if r["status"] in (SHIPMENT_STATUS_SHIPPED, SHIPMENT_STATUS_CANCELLED)),
        "packing": sum(1 for r in rows if r["status"] == SHIPMENT_STATUS_PACKING),
        "overdue": sum(
            1 for r in rows
            if r["status"] == SHIPMENT_STATUS_PACKING
            and r["ship_date"] and str(r["ship_date"]) < today
        ),
    }


@router.get("/shipments", response_model=ShipmentListResponse)
def list_shipments(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    status:    str | None = Query(None),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    overdue:   bool = Query(False),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if status:
            # Поддерживаем как одно значение, так и CSV ("shipped,cancelled" — вкладка «Завершённые»).
            requested = [s.strip() for s in status.split(",") if s.strip()]
            allowed = [s for s in requested if s in SHIPMENT_STATUSES_ALL]
            if len(allowed) == 1:
                conds.append("d.status = ?"); params.append(allowed[0])
            elif len(allowed) > 1:
                placeholders = ",".join("?" for _ in allowed)
                conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
        if overdue:
            today = date.today().isoformat()
            conds.append("d.status = ?")
            params.append(SHIPMENT_STATUS_PACKING)
            conds.append("d.ship_date IS NOT NULL")
            conds.append("d.ship_date < ?"); params.append(today)
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = f"%{search.strip()}%"
            conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
            params += [s, s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM shipment_lines sl"
                " WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted,0)=0 AND sl.product_sku LIKE ?)"
            )
            params.append(f"%{sku.strip()}%")
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        where = " AND ".join(conds)
        total = int(conn.execute(
            f"SELECT COUNT(*) AS cnt FROM shipment_docs d WHERE {where}", params
        ).fetchone()["cnt"])
        offset = (page - 1) * limit
        rows = conn.execute(
            f"""SELECT d.*,
                    COUNT(l.id) FILTER (WHERE l.is_deleted=0) AS sku_count,
                    COALESCE(SUM(l.qty) FILTER (WHERE l.is_deleted=0), 0) AS total_qty,
                    COALESCE(SUM(COALESCE(l.shipped_qty, 0)) FILTER (WHERE l.is_deleted=0), 0) AS total_shipped_qty,
                    COUNT(l.id) FILTER (
                        WHERE l.is_deleted=0 AND COALESCE(l.shipped_qty, 0) > 0
                    ) AS lines_with_shipped_qty,
                    COUNT(l.id) FILTER (
                        WHERE l.is_deleted=0 AND l.storage_zone_id IS NOT NULL
                    ) AS lines_with_zone
                FROM shipment_docs d
                LEFT JOIN shipment_lines l ON l.doc_id = d.id
                WHERE {where}
                GROUP BY d.id
                ORDER BY d.created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    items = [
        ShipmentListItem(
            id=str(r["id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=normalize_cargo_type(r.get("cargo_type")),
            client_id=r["client_id"],
            client_name=r["client_name"],
            destination=r["destination"],
            carrier=r["carrier"],
            ship_date=r["ship_date"],
            status=str(r["status"]),
            status_label=SHIPMENT_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            sku_count=int(r["sku_count"] or 0),
            total_qty=int(r["total_qty"] or 0),
            total_shipped_qty=int(r["total_shipped_qty"] or 0),
            lines_with_shipped_qty=int(r["lines_with_shipped_qty"] or 0),
            lines_with_zone=int(r["lines_with_zone"] or 0),
            created_at=str(r["created_at"]),
        )
        for r in rows
    ]
    return ShipmentListResponse(items=items, total=total, page=page, limit=limit)


@router.get("/shipments/{doc_id}", response_model=ShipmentDetailResponse)
def get_shipment(doc_id: str, user=Depends(_get_manager)):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        lines_rows = conn.execute(
            "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at",
            (doc_id,),
        ).fetchall()
        ops_rows = conn.execute(
            """SELECT o.*, u.email AS user_email
               FROM shipment_ops o LEFT JOIN users u ON u.id = o.created_by
               WHERE o.doc_id = ? ORDER BY o.created_at DESC""",
            (doc_id,),
        ).fetchall()

    lines = [
        ShipmentLineItem(
            id=str(l["id"]),
            product_id=str(l["product_id"]),
            product_name=str(l["product_name"]),
            product_sku=str(l["product_sku"]),
            color_id=l["color_id"],
            color_name=l["color_name"],
            size_id=l["size_id"],
            size_name=l["size_name"],
            qty=int(l["qty"]),
            shipped_qty=int(l["shipped_qty"] or 0),
            storage_zone_id=l["storage_zone_id"],
            storage_zone_name=l["storage_zone_name"],
        )
        for l in lines_rows
    ]
    ops = [
        ShipmentOpItem(
            id=str(o["id"]),
            op_type=str(o["op_type"]),
            comment=o["comment"],
            created_at=str(o["created_at"]),
            created_by=o["created_by"],
            created_by_email=o["user_email"],
        )
        for o in ops_rows
    ]
    return ShipmentDetailResponse(
        id=str(row["id"]),
        doc_number=str(row["doc_number"]),
        cargo_type=normalize_cargo_type(row.get("cargo_type")),
        client_id=row["client_id"],
        client_name=row["client_name"],
        destination=row["destination"],
        carrier=row["carrier"],
        ship_date=row["ship_date"],
        comment=row["comment"],
        status=str(row["status"]),
        status_label=SHIPMENT_STATUS_LABELS.get(str(row["status"]), str(row["status"])),
        created_at=str(row["created_at"]),
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        lines=lines,
        ops=ops,
        sku_count=len(lines),
        total_qty=sum(l.qty for l in lines),
    )


@router.patch("/shipments/{doc_id}")
def update_shipment(doc_id: str, body: ShipmentDocUpdate, user=Depends(_get_manager)):
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Нельзя редактировать отправленный документ")
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        if "cargo_type" in fields:
            fields["cargo_type"] = normalize_cargo_type(fields["cargo_type"])
        if not fields:
            return {"message": "ok"}
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE shipment_docs SET {sets}, updated_at = ? WHERE id = ?",
            list(fields.values()) + [now, doc_id],
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/shipments/{doc_id}/lines")
def add_shipment_line(doc_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике или в плане")
        line_id = str(uuid4())
        conn.execute(
            """INSERT INTO shipment_lines
               (id,doc_id,product_id,product_name,product_sku,color_id,color_name,
                size_id,size_name,qty,shipped_qty,storage_zone_id,storage_zone_name,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (line_id, doc_id, body.product_id, body.product_name, body.product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name, now),
        )
        conn.commit()
    return {"message": line_id}


@router.patch("/shipments/{doc_id}/lines/{line_id}")
def update_shipment_line(doc_id: str, line_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) == SHIPMENT_STATUS_SHIPPED:
            raise HTTPException(status_code=400, detail="Состав отгрузки нельзя менять после отправки")
        conn.execute(
            """UPDATE shipment_lines SET
               product_id=?,product_name=?,product_sku=?,color_id=?,color_name=?,
               size_id=?,size_name=?,qty=?,shipped_qty=?,storage_zone_id=?,storage_zone_name=?
               WHERE id=? AND doc_id=? AND is_deleted=0""",
            (body.product_id, body.product_name, body.product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name,
             line_id, doc_id),
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/shipments/{doc_id}/lines/{line_id}")
def delete_shipment_line(doc_id: str, line_id: str, user=Depends(_get_manager)):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике или в плане")
        conn.execute(
            "UPDATE shipment_lines SET is_deleted=1 WHERE id=? AND doc_id=?",
            (line_id, doc_id),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/shipments/{doc_id}/advance")
def advance_shipment_status(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = advance_shipment(conn, doc_id, uid)
    return {"message": next_status}


@router.post("/shipments/{doc_id}/cancel")
def cancel_shipment(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) == SHIPMENT_STATUS_SHIPPED:
            raise HTTPException(status_code=400, detail="Нельзя отменить отправленный документ")
        conn.execute(
            "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
            (SHIPMENT_STATUS_CANCELLED, now, doc_id),
        )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), doc_id, "cancel", now, uid),
        )
        conn.commit()
    return {"message": SHIPMENT_STATUS_CANCELLED}


@router.post("/shipments/{doc_id}/revert")
def revert_shipment(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        current = str(row["status"])
        prev_status = SHIPMENT_REVERT_TRANSITIONS.get(current)
        if not prev_status:
            raise HTTPException(status_code=400, detail=f"Нельзя откатить из статуса «{current}»")
        conn.execute(
            "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
            (prev_status, now, doc_id),
        )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, "revert", f"{current} → {prev_status}", now, uid),
        )
        conn.commit()
    return {"message": prev_status}


@router.delete("/shipments/{doc_id}")
def delete_shipment_doc(doc_id: str, user=Depends(_get_manager)):
    now = _now()
    with get_connection() as conn:
        conn.execute(
            "UPDATE shipment_docs SET is_deleted=1, updated_at=? WHERE id=?",
            (now, doc_id),
        )
        conn.commit()
    return {"message": "ok"}
