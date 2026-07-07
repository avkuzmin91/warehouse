from __future__ import annotations

from datetime import date
from uuid import uuid4

from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile

from idempotency import begin_idempotent, finish_idempotent
from config import (
    INV_OP_PACKED,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    MAX_UPLOAD_BYTES,
    SHIPMENT_ACCEPT_ROLES,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_EDITABLE_LINE_STATUSES,
    SHIPMENT_CANCELLABLE_STATUSES,
    SHIPMENT_CANCELLABLE_STATUSES_DEFECT,
    SHIPMENT_OP_DOC_UPDATE,
    SHIPMENT_OP_PRIORITY_UPDATE,
    SHIPMENT_OP_REJECT,
    SHIPMENT_PRIORITY_LABELS,
    SHIPMENT_REVERT_TRANSITIONS,
    SHIPMENT_STATUS_ASSIGNED,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_TERMINAL_STATUSES,
    SHIPMENT_STATUSES_ALL,
    UPLOADS_DIR,
)
from dbconn import get_connection, ci_like_substring_param
from utils import now_iso as _now, validate_business_date
from modules.auth.service import (
    get_current_admin,
    get_current_document_creator,
    get_current_manager,
    get_current_packer,
    get_current_shipment_viewer,
    get_current_warehouse,
)
from modules.shipments.schemas import (
    ShipmentDetailResponse,
    ShipmentDocCreate,
    ShipmentDocUpdate,
    ShipmentFinishDefectRelocationPayload,
    ShipmentFinishRelocationPayload,
    ShipmentLineFile,
    ShipmentLineIn,
    ShipmentLineItem,
    ShipmentLinePackPayload,
    ShipmentLinePlacement,
    ShipmentLinesListItem,
    ShipmentLinesResponse,
    ShipmentListItem,
    ShipmentListResponse,
    ShipmentMoveToPackingPayload,
    ShipmentOpItem,
    PackDateMovePayload,
    ProductivityEntriesResponse,
    ProductivityPackEntry,
    ShipmentPackingEntry,
    ShipmentPackingProductivityResponse,
    ShipmentPackingResponse,
    ShipmentPriorityUpdate,
    ShipmentRejectPayload,
    ShipmentReturnFromPackingPayload,
)
from modules.shipments.service import (
    _check_lines_covered_by_stock,
    _doc_packed_qty,
    advance_shipment,
    finish_defect_relocation,
    finish_relocation,
    line_on_packing_qty,
    line_packed_breakdown,
    list_packing_entries,
    list_productivity_entries,
    move_line_to_packing,
    move_packing_date,
    next_doc_number,
    normalize_cargo_type,
    packing_productivity,
    record_packing,
    relocate_packed,
    return_defect_to_storage,
    return_line_from_packing,
    return_packing_pool_to_storage,
    return_to_packing,
    reverse_packing_entry,
)
from modules.products.service import assign_product_sku_if_missing
from security import can_view_costs, ensure_cost_access, ensure_shipment_planning_access, ensure_shipment_priority_access

router = APIRouter(tags=["shipments"])

_get_manager = get_current_manager
_get_viewer = get_current_shipment_viewer
_get_packer = get_current_packer
_get_warehouse = get_current_warehouse

_ALLOWED_LINE_FILE_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}
_FILE_EDIT_ROLES = {"admin", "manager"}
_FILE_FINAL_STATUSES = SHIPMENT_TERMINAL_STATUSES


def _shipment_priority_order(alias: str = "d") -> str:
    return (
        f"CASE WHEN {alias}.priority_rank IS NULL THEN 1 ELSE 0 END, "
        f"{alias}.priority_rank ASC NULLS LAST, "
        f"{alias}.ship_date ASC NULLS LAST, "
        f"{alias}.created_at DESC"
    )


def _priority_label(rank: int | None) -> str:
    return SHIPMENT_PRIORITY_LABELS.get(rank, f"#{rank}")


def _ensure_pack_date_editor(user) -> None:
    if str(user["role"]) not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Доступно только менеджеру")


def _ensure_can_edit_files(user, status: str) -> None:
    role = str(user["role"])
    # Начальник склада правит файлы только на шаге приёмки задачи («Ожидает принятия»):
    # вместе с правом поправить ТЗ это позволяет ему подготовить задачу к принятию.
    allowed = role in _FILE_EDIT_ROLES or (role == "warehouse_head" and status == SHIPMENT_STATUS_ASSIGNED)
    if not allowed:
        raise HTTPException(status_code=403, detail="Менять файлы может только менеджер")
    if status in _FILE_FINAL_STATUSES:
        raise HTTPException(status_code=400, detail="Нельзя менять файлы в финальном статусе документа")



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
def create_shipment(
    body: ShipmentDocCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_document_creator),
):
    if body.logistics_cost is not None:
        ensure_cost_access(user)
    uid = str(user["id"])
    now = _now()
    doc_id = str(uuid4())
    cargo_type = normalize_cargo_type(body.cargo_type)

    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_create")
        if not proceed:
            return stored
        doc_num = next_doc_number(conn)
        conn.execute(
            """INSERT INTO shipment_docs
               (id,doc_number,cargo_type,client_id,client_name,destination,carrier,logistics_cost,ship_date,comment,status,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, doc_num, cargo_type, body.client_id, body.client_name,
             body.destination, body.carrier, body.logistics_cost,
             validate_business_date(body.ship_date, field_ru="Дата отгрузки"),
             (body.comment or "").strip() or None,
             SHIPMENT_STATUS_DRAFT, now, uid),
        )
        for line in body.lines:
            store_id, store_name = _resolve_line_store(conn, body.client_id, line.store_id)
            product_sku = assign_product_sku_if_missing(
                conn,
                product_id=line.product_id,
                sku_base=line.product_sku,
                updated_at=now,
                user_id=uid,
            ) or line.product_sku
            conn.execute(
                """INSERT INTO shipment_lines
                   (id,doc_id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                    qty,shipped_qty,storage_zone_id,storage_zone_name,store_id,store_name,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid4()), doc_id, line.product_id, line.product_name, product_sku,
                 line.color_id, line.color_name, line.size_id, line.size_name, line.qty,
                 line.shipped_qty, line.storage_zone_id, line.storage_zone_name, store_id, store_name, now),
            )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), doc_id, "doc_create", now, uid),
        )
        result = {"message": doc_id}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


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
            s = ci_like_substring_param(search)
            conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ? OR fold_ci(d.destination) LIKE ?)")
            params += [s, s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM shipment_lines sl"
                " LEFT JOIN products p ON p.id = sl.product_id"
                " WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted,0)=0"
                " AND (fold_ci(COALESCE(NULLIF(p.sku, ''), sl.product_sku)) LIKE ? OR fold_ci(sl.product_name) LIKE ?))"
            )
            s = ci_like_substring_param(sku); params += [s, s]
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
        "done":    sum(1 for r in rows if r["status"] in SHIPMENT_TERMINAL_STATUSES),
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
    cargo_type: str | None = Query(None),
    user=Depends(_get_viewer),
):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        use_priority_order = overdue
        status_filter_applied = False
        if cargo_type in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT):
            conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)
        if status:
            # Поддерживаем как одно значение, так и CSV ("shipped,cancelled" — вкладка «Завершённые»).
            requested = [s.strip() for s in status.split(",") if s.strip()]
            allowed = [s for s in requested if s in SHIPMENT_STATUSES_ALL]
            if len(allowed) == 1:
                conds.append("d.status = ?"); params.append(allowed[0])
                status_filter_applied = True
            elif len(allowed) > 1:
                placeholders = ",".join("?" for _ in allowed)
                conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
                status_filter_applied = True
            if allowed and all(
                s not in SHIPMENT_TERMINAL_STATUSES for s in allowed
            ):
                use_priority_order = True
        if overdue:
            today = date.today().isoformat()
            conds.append("d.status = ?")
            params.append(SHIPMENT_STATUS_PACKING)
            conds.append("d.ship_date IS NOT NULL")
            conds.append("d.ship_date < ?"); params.append(today)
            status_filter_applied = True
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = ci_like_substring_param(search)
            conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ? OR fold_ci(d.destination) LIKE ?)")
            params += [s, s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM shipment_lines sl"
                " LEFT JOIN products p ON p.id = sl.product_id"
                " WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted,0)=0"
                " AND (fold_ci(COALESCE(NULLIF(p.sku, ''), sl.product_sku)) LIKE ? OR fold_ci(sl.product_name) LIKE ?))"
            )
            s = ci_like_substring_param(sku); params += [s, s]
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        # Аннулированные скрываются из списка по умолчанию; показать — явным выбором статуса.
        if not status_filter_applied:
            conds.append("d.status != ?"); params.append(SHIPMENT_STATUS_CANCELLED)
        where = " AND ".join(conds)
        total = int(conn.execute(
            f"SELECT COUNT(*) AS cnt FROM shipment_docs d WHERE {where}", params
        ).fetchone()["cnt"])
        offset = (page - 1) * limit
        order_by = _shipment_priority_order() if use_priority_order else "d.ship_date DESC NULLS LAST, d.created_at DESC"
        rows = conn.execute(
            f"""SELECT d.*,
                    COUNT(l.id) FILTER (WHERE l.is_deleted=0) AS sku_count,
                    COALESCE(SUM(l.qty) FILTER (WHERE l.is_deleted=0), 0) AS total_qty,
                    COALESCE(SUM(COALESCE(l.shipped_qty, 0)) FILTER (WHERE l.is_deleted=0), 0) AS total_shipped_qty,
                    COUNT(l.id) FILTER (
                        WHERE l.is_deleted=0 AND COALESCE(l.shipped_qty, 0) > 0
                    ) AS lines_with_shipped_qty,
                    0 AS lines_with_packed_qty,
                    COUNT(l.id) FILTER (
                        WHERE l.is_deleted=0 AND l.storage_zone_id IS NOT NULL
                    ) AS lines_with_zone
                FROM shipment_docs d
                LEFT JOIN shipment_lines l ON l.doc_id = d.id
                WHERE {where}
                GROUP BY d.id
                ORDER BY {order_by}
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

        # Тяжёлые агрегаты по журналу zone_relocations — отдельным запросом только для
        # документов страницы, а не для всей выборки под фильтром до LIMIT.
        doc_ids = [str(r["id"]) for r in rows]
        journal_aggs: dict = {}
        if doc_ids:
            ph = ",".join("?" for _ in doc_ids)
            journal_aggs = {
                str(a["id"]): a
                for a in conn.execute(
                    f"""SELECT d.id,
                        -- «Факт» документа = упакованный годный (что реально едет). Найденный
                        -- брак возвращается на хранение и в факт выполнения плана не входит.
                        COALESCE((
                            SELECT SUM(CASE
                                WHEN zr.to_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND zr.to_quality='{INV_Q_GOOD}' AND COALESCE(zr.from_op,'') NOT IN ('{INV_OP_PACKED}','{INV_OP_READY}') THEN zr.qty
                                WHEN zr.from_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND zr.from_quality='{INV_Q_GOOD}' AND zr.to_op='{INV_OP_PACKING}'   THEN -zr.qty
                                ELSE 0 END)
                            FROM zone_relocations zr
                            JOIN shipment_lines sl2 ON sl2.id = zr.shipment_line_id
                            WHERE sl2.doc_id = d.id
                        ), 0) AS total_packed_qty,
                        COALESCE((
                            -- Готовый к отгрузке остаток (нетто `ready` нужного качества): вошло в
                            -- ready − вышло из ready, стороны независимо, чтобы перекладка ready→ready
                            -- (раскладка годного по местам) давала ноль. Привязку к рейсу и списание
                            -- держит домен dispatch — здесь резерв в рейсы не вычитается.
                            SELECT SUM(GREATEST(pl.ready, 0))
                            FROM (
                                SELECT sl3.id AS line_id,
                                    COALESCE(SUM(CASE WHEN zr.to_op='{INV_OP_READY}'   AND zr.to_quality
                                             = CASE WHEN COALESCE(d.cargo_type,'{SHIPMENT_CARGO_GOOD}')='{SHIPMENT_CARGO_DEFECT}' THEN '{INV_Q_DEFECT}' ELSE '{INV_Q_GOOD}' END THEN zr.qty ELSE 0 END), 0)
                                    - COALESCE(SUM(CASE WHEN zr.from_op='{INV_OP_READY}' AND zr.from_quality
                                             = CASE WHEN COALESCE(d.cargo_type,'{SHIPMENT_CARGO_GOOD}')='{SHIPMENT_CARGO_DEFECT}' THEN '{INV_Q_DEFECT}' ELSE '{INV_Q_GOOD}' END THEN zr.qty ELSE 0 END), 0) AS ready
                                FROM shipment_lines sl3
                                LEFT JOIN zone_relocations zr ON zr.shipment_line_id = sl3.id
                                WHERE sl3.doc_id = d.id AND COALESCE(sl3.is_deleted,0)=0
                                GROUP BY sl3.id
                            ) pl
                        ), 0) AS total_free_qty
                    FROM shipment_docs d
                    WHERE d.id IN ({ph})""",
                    doc_ids,
                ).fetchall()
            }

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
            priority_rank=int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            status=str(r["status"]),
            status_label=SHIPMENT_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            sku_count=int(r["sku_count"] or 0),
            total_qty=int(r["total_qty"] or 0),
            total_shipped_qty=int(r["total_shipped_qty"] or 0),
            total_packed_qty=int(journal_aggs[str(r["id"])]["total_packed_qty"] or 0),
            total_free_qty=int(journal_aggs[str(r["id"])]["total_free_qty"] or 0),
            lines_with_shipped_qty=int(r["lines_with_shipped_qty"] or 0),
            lines_with_packed_qty=int(r["lines_with_packed_qty"] or 0),
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
    cargo_type: str | None = Query(None),
    user=Depends(_get_viewer),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0", "l.is_deleted = 0"]
        params: list = []
        if cargo_type in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT):
            conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)
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
            s = ci_like_substring_param(search)
            conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ? OR fold_ci(d.destination) LIKE ?)")
            params += [s, s, s]
        if sku:
            s = ci_like_substring_param(sku)
            conds.append("(fold_ci(COALESCE(NULLIF(p.sku, ''), l.product_sku)) LIKE ? OR fold_ci(l.product_name) LIKE ?)")
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
                LEFT JOIN products p ON p.id = l.product_id
                WHERE {where}""",
            params,
        ).fetchone()["cnt"])
        offset = (page - 1) * limit
        rows = conn.execute(
            f"""SELECT l.id AS line_id, l.doc_id AS doc_id,
                    l.product_id, l.product_name,
                    COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS product_sku,
                    l.color_name, l.size_name, l.qty,
                    COALESCE(l.shipped_qty, 0) AS shipped_qty,
                    l.storage_zone_name, l.store_name,
                    d.doc_number, d.cargo_type, d.client_id, d.client_name, d.destination,
                    d.ship_date, d.status
                FROM shipment_lines l
                JOIN shipment_docs d ON d.id = l.doc_id
                LEFT JOIN products p ON p.id = l.product_id
                WHERE {where}
                ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC, l.created_at
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

        # «Факт» строки = упакованный годный (что реально едет). Найденный брак
        # возвращается на хранение и в факт выполнения плана не входит.
        # Агрегат по журналу — отдельным запросом только для строк страницы.
        line_ids = [str(r["line_id"]) for r in rows]
        packed_by_line: dict = {}
        if line_ids:
            ph = ",".join("?" for _ in line_ids)
            packed_by_line = {
                str(a["line_id"]): int(a["packed_good"] or 0)
                for a in conn.execute(
                    f"""SELECT zr.shipment_line_id AS line_id,
                            SUM(CASE
                                WHEN zr.to_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND zr.to_quality='{INV_Q_GOOD}' AND COALESCE(zr.from_op,'') NOT IN ('{INV_OP_PACKED}','{INV_OP_READY}') THEN zr.qty
                                WHEN zr.from_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND zr.from_quality='{INV_Q_GOOD}' AND zr.to_op='{INV_OP_PACKING}'   THEN -zr.qty
                                ELSE 0 END) AS packed_good
                        FROM zone_relocations zr
                        WHERE zr.shipment_line_id IN ({ph})
                        GROUP BY zr.shipment_line_id""",
                    line_ids,
                ).fetchall()
            }

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
            packed_good=packed_by_line.get(str(r["line_id"]), 0),
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
        # На строке показывается базовый SKU товара из карточки (SKU варианта вычисляется
        # автоматически и хранится только в карточке). SKU «принадлежит» товару, поэтому
        # берём актуальный `products.sku` — тогда присвоение/изменение SKU сразу видно, а
        # снимок `l.product_sku` остаётся запасным (если товар вдруг отсутствует).
        lines_rows = conn.execute(
            "SELECT l.*, COALESCE(p.sku_pending, 0) AS sku_pending, "
            "COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS effective_sku "
            "FROM shipment_lines l "
            "LEFT JOIN products p ON p.id = l.product_id "
            "WHERE l.doc_id = ? AND l.is_deleted = 0 ORDER BY l.created_at, l.id",
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
        packed_rows = conn.execute(
            f"""SELECT shipment_line_id,
                  COALESCE(SUM(CASE WHEN to_op IN ('{INV_OP_PACKED}','{INV_OP_READY}')   AND to_quality='{INV_Q_GOOD}'   AND COALESCE(from_op,'') NOT IN ('{INV_OP_PACKED}','{INV_OP_READY}') THEN qty
                                    WHEN from_op IN ('{INV_OP_PACKED}','{INV_OP_READY}') AND from_quality='{INV_Q_GOOD}' AND to_op='{INV_OP_PACKING}'               THEN -qty ELSE 0 END), 0) AS good,
                  COALESCE(SUM(CASE WHEN to_quality='{INV_Q_DEFECT}'   AND COALESCE(from_quality,'')<>'{INV_Q_DEFECT}' THEN qty
                                    WHEN from_quality='{INV_Q_DEFECT}' AND COALESCE(to_quality,'')<>'{INV_Q_DEFECT}'   THEN -qty ELSE 0 END), 0) AS defect,
                  -- «Ещё не размещено» = чистый остаток корзины packed (ждёт раскладки):
                  -- размещение good (packed→ready) и defect (packed→storage) его уменьшает.
                  -- Плюс/минус отдельными суммами: ручное перемещение packed→packed по
                  -- ячейкам обязано дать нетто 0, а не задвоить остаток.
                  COALESCE(SUM(CASE WHEN to_op='{INV_OP_PACKED}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN from_op='{INV_OP_PACKED}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END), 0) AS pending_good,
                  COALESCE(SUM(CASE WHEN to_op='{INV_OP_PACKED}' AND to_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN from_op='{INV_OP_PACKED}' AND from_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0) AS pending_defect
               FROM zone_relocations
               WHERE shipment_line_id IN (SELECT id FROM shipment_lines WHERE doc_id = ?)
               GROUP BY shipment_line_id""",
            (doc_id,),
        ).fetchall()
        packed_by_line = {str(r["shipment_line_id"]): (int(r["good"] or 0), int(r["defect"] or 0)) for r in packed_rows}
        pending_by_line = {str(r["shipment_line_id"]): (int(r["pending_good"] or 0), int(r["pending_defect"] or 0)) for r in packed_rows}

        # Раскладка по местам = ЧИСТЫЙ остаток нужной корзины по месту (вошло − вышло),
        # а не валовая сумма размещений: иначе возврат на упаковку (откат раскладки
        # ready→ready / storage→packing) и повторная раскладка задвоили бы числа. Корзины:
        # годный — ready/good (товар) по местам хранения; брак — storage/defect (товарная
        # отгрузка) либо ready/defect (подготовка брак-отгрузки в зону отгрузки). Движения
        # отгрузки (dispatch) не помечены shipment_line_id, поэтому в раскладку не попадают.
        placement_rows = conn.execute(
            f"""SELECT shipment_line_id, kind, zone_id,
                  MIN(zone_name) AS zone_name, SUM(net) AS qty
               FROM (
                   SELECT shipment_line_id, '{INV_Q_GOOD}' AS kind, to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
                   FROM zone_relocations WHERE to_op = '{INV_OP_READY}' AND to_quality = '{INV_Q_GOOD}'
                   UNION ALL
                   SELECT shipment_line_id, '{INV_Q_GOOD}', from_zone_id, from_zone_name, -qty
                   FROM zone_relocations WHERE from_op = '{INV_OP_READY}' AND from_quality = '{INV_Q_GOOD}'
                   UNION ALL
                   SELECT shipment_line_id, '{INV_Q_DEFECT}', to_zone_id, to_zone_name, qty
                   FROM zone_relocations WHERE to_op = '{INV_OP_STORAGE}' AND to_quality = '{INV_Q_DEFECT}'
                   UNION ALL
                   SELECT shipment_line_id, '{INV_Q_DEFECT}', from_zone_id, from_zone_name, -qty
                   FROM zone_relocations WHERE from_op = '{INV_OP_STORAGE}' AND from_quality = '{INV_Q_DEFECT}'
                   UNION ALL
                   SELECT shipment_line_id, '{INV_Q_DEFECT}', to_zone_id, to_zone_name, qty
                   FROM zone_relocations WHERE to_op = '{INV_OP_READY}' AND to_quality = '{INV_Q_DEFECT}'
                   UNION ALL
                   SELECT shipment_line_id, '{INV_Q_DEFECT}', from_zone_id, from_zone_name, -qty
                   FROM zone_relocations WHERE from_op = '{INV_OP_READY}' AND from_quality = '{INV_Q_DEFECT}'
               ) t
               WHERE shipment_line_id IN (SELECT id FROM shipment_lines WHERE doc_id = ?)
               GROUP BY shipment_line_id, kind, zone_id
               HAVING SUM(net) > 0
               ORDER BY MIN(zone_name)""",
            (doc_id,),
        ).fetchall()
        placements_by_line: dict[str, list[ShipmentLinePlacement]] = {}
        for r in placement_rows:
            lid = str(r["shipment_line_id"])
            placements_by_line.setdefault(lid, []).append(ShipmentLinePlacement(
                kind=str(r["kind"]),
                zone_id=r["zone_id"],
                zone_name=r["zone_name"],
                qty=int(r["qty"] or 0),
            ))

        available_for_pack = {
            str(l["id"]): line_on_packing_qty(conn, str(l["id"]))
            for l in lines_rows
        }

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
            product_sku=str(l["effective_sku"]),
            sku_pending=bool(l["sku_pending"]),
            color_id=l["color_id"],
            color_name=l["color_name"],
            size_id=l["size_id"],
            size_name=l["size_name"],
            qty=int(l["qty"]),
            shipped_qty=int(l["shipped_qty"] or 0),
            packed_good=packed_by_line.get(str(l["id"]), (0, 0))[0],
            packed_defect=packed_by_line.get(str(l["id"]), (0, 0))[1],
            packed_pending_good=pending_by_line.get(str(l["id"]), (0, 0))[0],
            packed_pending_defect=pending_by_line.get(str(l["id"]), (0, 0))[1],
            available_for_pack=available_for_pack.get(str(l["id"]), 0),
            storage_zone_id=l["storage_zone_id"],
            storage_zone_name=l["storage_zone_name"],
            store_id=l["store_id"],
            store_name=l["store_name"],
            placements=placements_by_line.get(str(l["id"]), []),
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
        priority_rank=int(row["priority_rank"]) if row.get("priority_rank") is not None else None,
        actual_ship_date=row.get("actual_ship_date"),
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


@router.patch("/shipments/{doc_id}/priority")
def update_shipment_priority(doc_id: str, body: ShipmentPriorityUpdate, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    ensure_shipment_priority_access(user)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, priority_rank FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) in SHIPMENT_TERMINAL_STATUSES:
            raise HTTPException(status_code=400, detail="Нельзя менять приоритет завершённой или аннулированной отгрузки")

        old_rank = int(row["priority_rank"]) if row.get("priority_rank") is not None else None
        new_rank = body.priority_rank
        if old_rank == new_rank:
            return {"message": "ok"}

        conn.execute(
            "UPDATE shipment_docs SET priority_rank = ?, updated_at = ? WHERE id = ?",
            (new_rank, now, doc_id),
        )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_PRIORITY_UPDATE,
             f"Приоритет отгрузки: {_priority_label(old_rank)} → {_priority_label(new_rank)}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.patch("/shipments/{doc_id}")
def update_shipment(doc_id: str, body: ShipmentDocUpdate, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    role = str(user["role"])
    fields = body.model_dump(exclude_unset=True)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, actual_ship_date, priority_rank, client_id, comment FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        status = str(row["status"])
        if status not in SHIPMENT_EDITABLE_LINE_STATUSES:
            raise HTTPException(status_code=400, detail="Нельзя редактировать отправленный документ")
        # Планирование (состав, реквизиты) ведёт менеджерский состав. Начальник склада
        # на шаге приёмки задачи («Ожидает принятия») может поправить только ТЗ.
        wh_head_review = role == "warehouse_head" and status == SHIPMENT_STATUS_ASSIGNED
        if fields:
            if wh_head_review:
                if set(fields) - {"comment"}:
                    raise HTTPException(status_code=403, detail="Начальник склада может править только техническое задание")
            else:
                ensure_shipment_planning_access(user)
        if "logistics_cost" in fields:
            ensure_cost_access(user)
        if "priority_rank" in fields:
            ensure_shipment_priority_access(user)
        if "actual_ship_date" in fields:
            if status != SHIPMENT_STATUS_PACKING:
                raise HTTPException(status_code=400, detail="Дату отгрузки (факт) можно менять только в статусе «В плане»")
            fields["actual_ship_date"] = (fields["actual_ship_date"] or "").strip() or None
        if "comment" in fields:
            fields["comment"] = (fields["comment"] or "").strip() or None
        if "cargo_type" in fields:
            fields["cargo_type"] = normalize_cargo_type(fields["cargo_type"])
        if "ship_date" in fields:
            fields["ship_date"] = validate_business_date(fields["ship_date"], field_ru="Дата отгрузки")
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
        if "comment" in fields and (str(row["comment"] or "").strip()) != (fields["comment"] or ""):
            conn.execute(
                "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), doc_id, SHIPMENT_OP_DOC_UPDATE, "Техническое задание обновлено", now, uid),
            )
        if "priority_rank" in fields:
            old_rank = int(row["priority_rank"]) if row.get("priority_rank") is not None else None
            new_rank = fields["priority_rank"]
            if old_rank != new_rank:
                conn.execute(
                    "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                    (str(uuid4()), doc_id, SHIPMENT_OP_PRIORITY_UPDATE,
                     f"Приоритет отгрузки: {_priority_label(old_rank)} → {_priority_label(new_rank)}", now, uid),
                )
        conn.commit()
    return {"message": "ok"}


@router.post("/shipments/{doc_id}/lines")
def add_shipment_line(doc_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    ensure_shipment_planning_access(user)
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
        product_sku = assign_product_sku_if_missing(
            conn,
            product_id=body.product_id,
            sku_base=body.product_sku,
            updated_at=now,
            user_id=str(user["id"]),
        ) or body.product_sku
        conn.execute(
            """INSERT INTO shipment_lines
               (id,doc_id,product_id,product_name,product_sku,color_id,color_name,
                size_id,size_name,qty,shipped_qty,storage_zone_id,storage_zone_name,store_id,store_name,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (line_id, doc_id, body.product_id, body.product_name, product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name, store_id, store_name, now),
        )
        if str(row["status"]) == SHIPMENT_STATUS_PACKING:
            _check_lines_covered_by_stock(conn, doc_id, row["client_id"])
        conn.commit()
    return {"message": line_id}


@router.patch("/shipments/{doc_id}/lines/{line_id}")
def update_shipment_line(doc_id: str, line_id: str, body: ShipmentLineIn, user=Depends(_get_manager)):
    ensure_shipment_planning_access(user)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) == SHIPMENT_STATUS_SHIPPED:
            raise HTTPException(status_code=400, detail="Состав отгрузки нельзя менять после отправки")
        store_id, store_name = _resolve_line_store(conn, row["client_id"], body.store_id)
        product_sku = assign_product_sku_if_missing(
            conn,
            product_id=body.product_id,
            sku_base=body.product_sku,
            updated_at=_now(),
            user_id=str(user["id"]),
        ) or body.product_sku
        conn.execute(
            """UPDATE shipment_lines SET
               product_id=?,product_name=?,product_sku=?,color_id=?,color_name=?,
               size_id=?,size_name=?,qty=?,shipped_qty=?,storage_zone_id=?,storage_zone_name=?,store_id=?,store_name=?
               WHERE id=? AND doc_id=? AND is_deleted=0""",
            (body.product_id, body.product_name, product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             body.shipped_qty, body.storage_zone_id, body.storage_zone_name, store_id, store_name,
             line_id, doc_id),
        )
        if str(row["status"]) == SHIPMENT_STATUS_PACKING:
            _check_lines_covered_by_stock(conn, doc_id, row["client_id"])
        conn.commit()
    return {"message": "ok"}


@router.post("/shipments/{doc_id}/lines/{line_id}/pack")
def pack_line(
    doc_id: str,
    line_id: str,
    body: ShipmentLinePackPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_packer),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_pack")
        if not proceed:
            return stored
        packed = record_packing(conn, doc_id, line_id, body.good_delta, body.defect_delta, body.packed_date, uid)
        result = {"message": "ok", "packed_good": packed["good"], "packed_defect": packed["defect"]}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.get("/shipments/{doc_id}/lines/{line_id}/packing", response_model=ShipmentPackingResponse)
def get_line_packing(doc_id: str, line_id: str, user=Depends(_get_viewer)):
    with get_connection() as conn:
        line = conn.execute(
            "SELECT qty FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        packed = line_packed_breakdown(conn, line_id)
        return ShipmentPackingResponse(
            plan=int(line["qty"] or 0),
            available_for_pack=line_on_packing_qty(conn, line_id),
            packed_good=packed["good"],
            packed_defect=packed["defect"],
            entries=[ShipmentPackingEntry(**e) for e in list_packing_entries(conn, line_id)],
        )


@router.get("/shipments/packing/productivity", response_model=ShipmentPackingProductivityResponse)
def get_packing_productivity(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    user=Depends(_get_viewer),
):
    with get_connection() as conn:
        return packing_productivity(
            conn, date_from=date_from, date_to=date_to, client_id=client_id, search=search,
            with_earnings=can_view_costs(user),
        )


@router.get("/shipments/packing/productivity/entries", response_model=ProductivityEntriesResponse)
def get_productivity_entries(
    packed_date: str = Query(...),
    product_id: str = Query(...),
    client_id: str | None = Query(None),
    user=Depends(get_current_admin),
):
    _ensure_pack_date_editor(user)
    with get_connection() as conn:
        entries = list_productivity_entries(
            conn,
            packed_date=packed_date,
            client_id=(client_id or None),
            product_id=product_id,
        )
    return ProductivityEntriesResponse(entries=[ProductivityPackEntry(**e) for e in entries])


@router.post("/shipments/packing/productivity/move-date")
def move_productivity_pack_date(
    body: PackDateMovePayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_admin),
):
    _ensure_pack_date_editor(user)
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "pack_date_move")
        if not proceed:
            return stored
        result = move_packing_date(conn, body.entry_ids, body.new_date, uid)
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/lines/{line_id}/packing/{entry_id}/reverse")
def reverse_line_packing(
    doc_id: str,
    line_id: str,
    entry_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_packer),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_pack_reverse")
        if not proceed:
            return stored
        packed = reverse_packing_entry(conn, doc_id, line_id, entry_id, uid)
        result = {"message": "ok", "packed_good": packed["good"], "packed_defect": packed["defect"]}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/lines/{line_id}/move-to-packing")
def move_to_packing(
    doc_id: str,
    line_id: str,
    body: ShipmentMoveToPackingPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_warehouse),
):
    uid = str(user["id"])
    allocations = body.to_allocations()
    if not allocations:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_move_to_packing")
        if not proceed:
            return stored
        moved = move_line_to_packing(conn, doc_id, line_id, allocations, uid)
        result = {"message": "ok", "moved": moved}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/lines/{line_id}/return-from-packing")
def return_from_packing(doc_id: str, line_id: str, body: ShipmentReturnFromPackingPayload, user=Depends(_get_warehouse)):
    uid = str(user["id"])
    with get_connection() as conn:
        returned = return_line_from_packing(conn, doc_id, line_id, uid, body.qty)
    return {"message": "ok", "returned": returned}


@router.delete("/shipments/{doc_id}/lines/{line_id}")
def delete_shipment_line(doc_id: str, line_id: str, user=Depends(_get_manager)):
    ensure_shipment_planning_access(user)
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
def advance_shipment_status(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_viewer),
):
    uid = str(user["id"])
    role = str(user["role"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_advance")
        if not proceed:
            return stored
        next_status = advance_shipment(conn, doc_id, uid, role)
        result = {"message": next_status}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/finish-relocation")
def finish_shipment_relocation(
    doc_id: str,
    body: ShipmentFinishRelocationPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_warehouse),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_finish_relocation")
        if not proceed:
            return stored
        next_status = finish_relocation(conn, doc_id, body.lines, uid)
        result = {"message": next_status}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/place-packed")
def place_shipment_packed(
    doc_id: str,
    body: ShipmentFinishRelocationPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_warehouse),
):
    """Частичное размещение упакованного годного по местам, не завершая упаковку.

    Делает упакованное доступным к отгрузке (ready) во время многодневной упаковки —
    статус остаётся «На упаковке». Переиспользует payload раскладки (нужны только good)."""
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_place_packed")
        if not proceed:
            return stored
        moved = relocate_packed(conn, doc_id, body.lines, uid)
        result = {"message": "ok", "moved": moved}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/shipments/{doc_id}/finish-defect-relocation")
def finish_shipment_defect_relocation(doc_id: str, body: ShipmentFinishDefectRelocationPayload, user=Depends(_get_warehouse)):
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = finish_defect_relocation(conn, doc_id, body.lines, uid)
    return {"message": next_status}


@router.post("/shipments/{doc_id}/cancel")
def cancel_shipment(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_manager),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_cancel", response={"message": SHIPMENT_STATUS_CANCELLED})
        if not proceed:
            return stored
        row = conn.execute(
            "SELECT status, cargo_type, priority_rank FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        is_defect_cargo = normalize_cargo_type(row["cargo_type"]) == SHIPMENT_CARGO_DEFECT
        cancellable = SHIPMENT_CANCELLABLE_STATUSES_DEFECT if is_defect_cargo else SHIPMENT_CANCELLABLE_STATUSES
        if str(row["status"]) not in cancellable:
            raise HTTPException(status_code=400, detail="Документ нельзя аннулировать в текущем статусе")
        if not is_defect_cargo and str(row["status"]) == SHIPMENT_STATUS_ON_PACKING:
            packed = _doc_packed_qty(conn, doc_id)
            if packed["good"] > 0 or packed["defect"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="В задаче уже есть упакованный товар — аннулировать нельзя",
                )
        cancel_comment = None
        if is_defect_cargo:
            returned = return_defect_to_storage(conn, doc_id, uid)
            if returned > 0:
                cancel_comment = f"Брак возвращён на исходные места: {returned} шт."
        else:
            returned = return_packing_pool_to_storage(conn, doc_id, uid)
            if returned > 0:
                cancel_comment = f"Товар возвращён с упаковки на исходные места: {returned} шт."
        conn.execute(
            "UPDATE shipment_docs SET status=?, priority_rank=NULL, updated_at=? WHERE id=?",
            (SHIPMENT_STATUS_CANCELLED, now, doc_id),
        )
        if row.get("priority_rank") is not None:
            conn.execute(
                "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), doc_id, SHIPMENT_OP_PRIORITY_UPDATE,
                 "Приоритет снят: документ аннулирован", now, uid),
            )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, "cancel", cancel_comment, now, uid),
        )
        conn.commit()
    return {"message": SHIPMENT_STATUS_CANCELLED}


@router.post("/shipments/{doc_id}/reject")
def reject_shipment(
    doc_id: str,
    body: ShipmentRejectPayload,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_viewer),
):
    """Отклонить задачу упаковки на приёмке: возврат менеджеру (assigned → draft).

    Доступно начальнику склада и менеджерскому составу (см. SHIPMENT_ACCEPT_ROLES).
    Причина обязательна и фиксируется в журнале.
    """
    uid = str(user["id"])
    now = _now()
    if str(user["role"]) not in SHIPMENT_ACCEPT_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину отклонения")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_reject", response={"message": SHIPMENT_STATUS_DRAFT})
        if not proceed:
            return stored
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) != SHIPMENT_STATUS_ASSIGNED:
            raise HTTPException(status_code=400, detail="Отклонить можно только задачу, ожидающую принятия")
        conn.execute(
            "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
            (SHIPMENT_STATUS_DRAFT, now, doc_id),
        )
        conn.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_REJECT, f"Задача отклонена: {reason}", now, uid),
        )
        conn.commit()
    return {"message": SHIPMENT_STATUS_DRAFT}


@router.post("/shipments/{doc_id}/return-to-packing")
def return_shipment_to_packing(doc_id: str, force: bool = False, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = return_to_packing(conn, doc_id, uid, force=force)
    return {"message": next_status}


@router.post("/shipments/{doc_id}/revert")
def revert_shipment(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_manager),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "shipment_revert")
        if not proceed:
            return stored
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
        result = {"message": prev_status}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


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
        row = conn.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (doc_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) != SHIPMENT_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Удалить можно только черновик")
        conn.execute(
            "UPDATE shipment_docs SET is_deleted=1, updated_at=? WHERE id=?",
            (now, doc_id),
        )
        conn.commit()
    return {"message": "ok"}
