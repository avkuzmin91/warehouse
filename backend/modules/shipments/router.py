from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from config import (
    MAX_UPLOAD_BYTES,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_EDITABLE_LINE_STATUSES,
    SHIPMENT_OP_DOC_UPDATE,
    SHIPMENT_REVERT_TRANSITIONS,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUSES_ALL,
    SHIPMENT_TRANSITIONS,
    UPLOADS_DIR,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager, get_current_shipment_viewer
from modules.shipments.schemas import (
    ShipmentDetailResponse,
    ShipmentDocCreate,
    ShipmentDocUpdate,
    ShipmentLineFile,
    ShipmentLineIn,
    ShipmentLineItem,
    ShipmentLinesListItem,
    ShipmentLinesResponse,
    ShipmentListItem,
    ShipmentListResponse,
    ShipmentOpItem,
)
from modules.shipments.service import advance_shipment, next_doc_number, normalize_cargo_type
from security import can_view_costs, ensure_cost_access

router = APIRouter(tags=["shipments"])

_get_manager = get_current_manager
_get_viewer = get_current_shipment_viewer

_ALLOWED_LINE_FILE_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}
_FILE_EDIT_ROLES = {"admin", "manager"}
_FILE_FINAL_STATUSES = {SHIPMENT_STATUS_SHIPPED, SHIPMENT_STATUS_CANCELLED}


def _ensure_can_edit_files(user, status: str) -> None:
    if str(user["role"]) not in _FILE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Менять файлы может только менеджер")
    if status in _FILE_FINAL_STATUSES:
        raise HTTPException(status_code=400, detail="Нельзя менять файлы в финальном статусе документа")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _fmt_date(value) -> str:
    if not value:
        return "—"
    try:
        y, m, d = str(value).split("-")
        return f"{d}.{m}.{y}"
    except ValueError:
        return str(value)


def _resolve_line_store(conn, client_id: str | None, store_id: str | None) -> tuple[str | None, str | None]:
    if not store_id or not str(store_id).strip():
        return None, None
    if not client_id or not str(client_id).strip():
        raise HTTPException(status_code=400, detail="Выберите клиента перед выбором магазина")
    row = conn.execute(
        """
        SELECT id, name
        FROM client_stores
        WHERE id = ?
          AND client_id = ?
          AND COALESCE(is_deleted, 0) = 0
        """,
        (str(store_id).strip(), str(client_id).strip()),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Магазин не принадлежит клиенту отгрузки")
    return str(row["id"]), str(row["name"])


@router.post("/shipments")
def create_shipment(body: ShipmentDocCreate, user=Depends(_get_manager)):
    if body.logistics_cost is not None:
        ensure_cost_access(user)
    uid = str(user["id"])
    now = _now()
    doc_id = str(uuid4())
    cargo_type = normalize_cargo_type(body.cargo_type)

    with get_connection() as conn:
        doc_num = next_doc_number(conn)
        conn.execute(
            """INSERT INTO shipment_docs
               (id,doc_number,cargo_type,client_id,client_name,destination,carrier,logistics_cost,ship_date,comment,status,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, doc_num, cargo_type, body.client_id, body.client_name,
             body.destination, body.carrier, body.logistics_cost, body.ship_date, (body.comment or "").strip() or None,
             SHIPMENT_STATUS_DRAFT, now, uid),
        )
        for line in body.lines:
            store_id, store_name = _resolve_line_store(conn, body.client_id, line.store_id)
            conn.execute(
                """INSERT INTO shipment_lines
                   (id,doc_id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                    qty,shipped_qty,storage_zone_id,storage_zone_name,store_id,store_name,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid4()), doc_id, line.product_id, line.product_name, line.product_sku,
                 line.color_id, line.color_name, line.size_id, line.size_name, line.qty,
                 line.shipped_qty, line.storage_zone_id, line.storage_zone_name, store_id, store_name, now),
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
    user=Depends(_get_viewer),
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
    available_for_trip_id: str | None = Query(None),
    user=Depends(_get_viewer),
):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if available_for_trip_id and available_for_trip_id.strip():
            conds.append(
                "NOT EXISTS (SELECT 1 FROM trip_lines tl"
                " WHERE tl.shipment_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 AND tl.trip_id != ?)"
            )
            params.append(available_for_trip_id.strip())
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
                ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC
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
            logistics_cost=float(r["logistics_cost"]) if show_costs and r.get("logistics_cost") is not None else None,
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


@router.get("/shipments/lines", response_model=ShipmentLinesResponse)
def list_shipment_lines(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    status:    str | None = Query(None),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    overdue:   bool = Query(False),
    user=Depends(_get_viewer),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0", "l.is_deleted = 0"]
        params: list = []
        if status:
            requested = [s.strip() for s in status.split(",") if s.strip()]
            allowed = [s for s in requested if s in SHIPMENT_STATUSES_ALL]
            if len(allowed) == 1:
                conds.append("d.status = ?"); params.append(allowed[0])
            elif len(allowed) > 1:
                placeholders = ",".join("?" for _ in allowed)
                conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
        if overdue:
            today = date.today().isoformat()
            conds.append("d.status = ?"); params.append(SHIPMENT_STATUS_PACKING)
            conds.append("d.ship_date IS NOT NULL")
            conds.append("d.ship_date < ?"); params.append(today)
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = f"%{search.strip()}%"
            conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
            params += [s, s, s]
        if sku:
            s = f"%{sku.strip()}%"
            conds.append("(l.product_sku LIKE ? OR l.product_name LIKE ?)")
            params += [s, s]
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        where = " AND ".join(conds)
        total = int(conn.execute(
            f"""SELECT COUNT(*) AS cnt
                FROM shipment_lines l
                JOIN shipment_docs d ON d.id = l.doc_id
                WHERE {where}""",
            params,
        ).fetchone()["cnt"])
        offset = (page - 1) * limit
        rows = conn.execute(
            f"""SELECT l.id AS line_id, l.doc_id AS doc_id,
                    l.product_id, l.product_name, l.product_sku,
                    l.color_name, l.size_name, l.qty,
                    COALESCE(l.shipped_qty, 0) AS shipped_qty, l.storage_zone_name, l.store_name,
                    d.doc_number, d.cargo_type, d.client_id, d.client_name, d.destination,
                    d.ship_date, d.status
                FROM shipment_lines l
                JOIN shipment_docs d ON d.id = l.doc_id
                WHERE {where}
                ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC, l.created_at
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    items = [
        ShipmentLinesListItem(
            line_id=str(r["line_id"]),
            doc_id=str(r["doc_id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=normalize_cargo_type(r.get("cargo_type")),
            client_id=r["client_id"],
            client_name=r["client_name"],
            destination=r["destination"],
            ship_date=r["ship_date"],
            status=str(r["status"]),
            status_label=SHIPMENT_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            product_id=str(r["product_id"]),
            product_name=str(r["product_name"]),
            product_sku=str(r["product_sku"]),
            color_name=r["color_name"],
            size_name=r["size_name"],
            qty=int(r["qty"] or 0),
            shipped_qty=int(r["shipped_qty"] or 0),
            storage_zone_name=r["storage_zone_name"],
            store_name=r["store_name"],
        )
        for r in rows
    ]
    return ShipmentLinesResponse(items=items, total=total, page=page, limit=limit)


@router.get("/shipments/{doc_id}", response_model=ShipmentDetailResponse)
def get_shipment(doc_id: str, user=Depends(_get_viewer)):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        trip_row = conn.execute(
            "SELECT t.id AS trip_id, t.trip_number AS trip_number "
            "FROM trip_lines tl "
            "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE tl.shipment_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0",
            (doc_id,),
        ).fetchone()
        lines_rows = conn.execute(
            "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at",
            (doc_id,),
        ).fetchall()
        files_rows = conn.execute(
            "SELECT * FROM shipment_line_files WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at",
            (doc_id,),
        ).fetchall()
        ops_rows = conn.execute(
            """SELECT o.*, u.email AS user_email
               FROM shipment_ops o LEFT JOIN users u ON u.id = o.created_by
               WHERE o.doc_id = ? ORDER BY o.created_at DESC""",
            (doc_id,),
        ).fetchall()

    files_by_line: dict[str, list[ShipmentLineFile]] = {}
    for f in files_rows:
        lid = str(f["line_id"])
        if lid not in files_by_line:
            files_by_line[lid] = []
        files_by_line[lid].append(ShipmentLineFile(
            id=str(f["id"]),
            filename=str(f["filename"]),
            url=str(f["url"]),
            mime_type=f["mime_type"],
            created_at=str(f["created_at"]),
        ))

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
            store_id=l["store_id"],
            store_name=l["store_name"],
            files=files_by_line.get(str(l["id"]), []),
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
        logistics_cost=float(row["logistics_cost"]) if show_costs and row.get("logistics_cost") is not None else None,
        ship_date=row["ship_date"],
        actual_ship_date=row.get("actual_ship_date"),
        comment=row["comment"],
        status=str(row["status"]),
        status_label=SHIPMENT_STATUS_LABELS.get(str(row["status"]), str(row["status"])),
        trip_id=str(trip_row["trip_id"]) if trip_row else None,
        trip_number=str(trip_row["trip_number"]) if trip_row else None,
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
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, actual_ship_date, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        status = str(row["status"])
        if status not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Нельзя редактировать отправленный документ")
        fields = body.model_dump(exclude_unset=True)
        if "logistics_cost" in fields:
            ensure_cost_access(user)
        if "actual_ship_date" in fields:
            if status != SHIPMENT_STATUS_PACKING:
                raise HTTPException(status_code=400, detail="Дату отгрузки (факт) можно менять только в статусе «В плане»")
            fields["actual_ship_date"] = (fields["actual_ship_date"] or "").strip() or None
        if "comment" in fields:
            fields["comment"] = (fields["comment"] or "").strip() or None
        if "cargo_type" in fields:
            fields["cargo_type"] = normalize_cargo_type(fields["cargo_type"])
        if not fields:
            return {"message": "ok"}
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE shipment_docs SET {sets}, updated_at = ? WHERE id = ?",
            list(fields.values()) + [now, doc_id],
        )
        if "client_id" in fields and (row["client_id"] or "") != (fields["client_id"] or ""):
            conn.execute(
                "UPDATE shipment_lines SET store_id = NULL, store_name = NULL WHERE doc_id = ? AND is_deleted = 0",
                (doc_id,),
            )
        if "actual_ship_date" in fields:
            old_val = row["actual_ship_date"]
            new_val = fields["actual_ship_date"]
            if (str(old_val).strip() if old_val is not None else "") != (new_val or ""):
                conn.execute(
                    "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                    (str(uuid4()), doc_id, SHIPMENT_OP_DOC_UPDATE,
                     f"Дата отгрузки (факт): {_fmt_date(old_val)} → {_fmt_date(new_val)}", now, uid),
                )
        conn.commit()
    return {"message": "ok"}


@router.post("/shipments/{doc_id}/lines")
def add_shipment_line(doc_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике или в плане")
        line_id = str(uuid4())
        store_id, store_name = _resolve_line_store(conn, row["client_id"], body.store_id)
        conn.execute(
            """INSERT INTO shipment_lines
               (id,doc_id,product_id,product_name,product_sku,color_id,color_name,
                size_id,size_name,qty,shipped_qty,storage_zone_id,storage_zone_name,store_id,store_name,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (line_id, doc_id, body.product_id, body.product_name, body.product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name, store_id, store_name, now),
        )
        conn.commit()
    return {"message": line_id}


@router.patch("/shipments/{doc_id}/lines/{line_id}")
def update_shipment_line(doc_id: str, line_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) == SHIPMENT_STATUS_SHIPPED:
            raise HTTPException(status_code=400, detail="Состав отгрузки нельзя менять после отправки")
        store_id, store_name = _resolve_line_store(conn, row["client_id"], body.store_id)
        conn.execute(
            """UPDATE shipment_lines SET
               product_id=?,product_name=?,product_sku=?,color_id=?,color_name=?,
               size_id=?,size_name=?,qty=?,shipped_qty=?,storage_zone_id=?,storage_zone_name=?,store_id=?,store_name=?
               WHERE id=? AND doc_id=? AND is_deleted=0""",
            (body.product_id, body.product_name, body.product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name, store_id, store_name,
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


@router.post("/shipments/{doc_id}/lines/{line_id}/files")
async def upload_shipment_line_file(
    doc_id: str,
    line_id: str,
    file: UploadFile = File(...),
    user=Depends(_get_manager),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_LINE_FILE_EXTS:
        raise HTTPException(status_code=400, detail="Допустимы файлы: pdf, png, jpg, jpeg")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")

    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        _ensure_can_edit_files(user, str(row["status"]))
        line_row = conn.execute(
            "SELECT id FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=404, detail="Строка не найдена")

        saved_filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / saved_filename
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)

        file_id = str(uuid4())
        url = f"/uploads/{saved_filename}"
        conn.execute(
            "INSERT INTO shipment_line_files (id,line_id,doc_id,filename,url,mime_type,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (file_id, line_id, doc_id, file.filename, url, file.content_type or None, now, uid),
        )
        conn.commit()
    return {"message": file_id}


@router.delete("/shipments/{doc_id}/lines/{line_id}/files/{file_id}")
def delete_shipment_line_file(
    doc_id: str,
    line_id: str,
    file_id: str,
    user=Depends(_get_manager),
):
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        _ensure_can_edit_files(user, str(row["status"]))
        conn.execute(
            "UPDATE shipment_line_files SET is_deleted=1 WHERE id=? AND line_id=? AND doc_id=?",
            (file_id, line_id, doc_id),
        )
        conn.commit()
    return {"message": "ok"}


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
