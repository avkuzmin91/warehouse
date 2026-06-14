from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    INV_OP_INTAKE,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_CANCEL,
    RECEIPT_OP_DOC_CREATE,
    RECEIPT_OP_DOC_UPDATE,
    RECEIPT_OP_LINE_ADD,
    RECEIPT_OP_LINE_DELETE,
    RECEIPT_OP_INTAKE_START,
    RECEIPT_OP_LINE_UPDATE,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
    RECEIPT_STATUSES_ALL,
    TRIP_STATUS_CANCELLED,
)
from dbconn import get_connection, like_substring_param
from modules.auth.service import (
    get_current_document_creator,
    get_current_manager,
    get_current_warehouse,
)
from modules.receipts.schemas import (
    ReceiptActualArrivalUpdate,
    ReceiptArrivePayload,
    ReceiptDetailResponse,
    ReceiptDocCreate,
    ReceiptDocResponse,
    ReceiptDocUpdate,
    ReceiptLineAdd,
    ReceiptLineResponse,
    ReceiptLinesListItem,
    ReceiptLinesResponse,
    ReceiptLineUpdate,
    ReceiptListItem,
    ReceiptListResponse,
    ReceiptOpResponse,
)
from modules.receipts.service import (
    advance_receipt,
    compute_state,
    list_receipt_lines,
    list_receipts_aggregated,
    next_doc_number,
)
from security import can_view_costs, ensure_cost_access, ensure_planned_arrival_access

router = APIRouter(tags=["receipts"])

_get_manager = get_current_manager
_get_warehouse = get_current_warehouse


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _line_label(product_sku, color_name, size_name, qty) -> str:
    sku = str(product_sku or "").strip() or "SKU?"
    color = str(color_name or "").strip()
    size = str(size_name or "").strip()
    attrs = " / ".join([x for x in (color, size) if x])
    qty_part = f" x{int(qty or 0)}" if qty is not None else ""
    return f"{sku}{f' ({attrs})' if attrs else ''}{qty_part}"


def _validate_receipt_lines_have_storage(connection, doc_id: str) -> None:
    missing = connection.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM receipt_lines
        WHERE doc_id = ?
          AND is_deleted = 0
          AND NULLIF(TRIM(COALESCE(storage_zone_id, '')), '') IS NULL
        """,
        (doc_id,),
    ).fetchone()
    if int(missing["cnt"] if missing else 0) > 0:
        raise HTTPException(status_code=400, detail="Укажите зону хранения для каждой строки поступления")


def _validate_receipt_line_has_color(line) -> None:
    if not str(line.color_id or "").strip():
        raise HTTPException(status_code=400, detail="Укажите цвет товара")


def _receipt_op_comment_for_user(comment: str | None, user) -> str | None:
    if comment and not can_view_costs(user) and "Стоимость логистики" in comment:
        return "Изменена стоимость логистики"
    return comment


@router.post("/receipts")
def create_receipt(payload: ReceiptDocCreate, user=Depends(get_current_document_creator)):
    if payload.logistics_cost is not None:
        ensure_cost_access(user)
    uid = str(user["id"])
    cid = payload.client_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Укажите клиента")
    for line in payload.lines:
        _validate_receipt_line_has_color(line)

    with get_connection() as conn:
        client_row = conn.execute(
            "SELECT id, name FROM clients WHERE id = ? AND COALESCE(is_deleted,0)=0",
            (cid,),
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=400, detail="Клиент не найден")

        doc_id = str(uuid4())
        doc_num = next_doc_number(conn)
        now = _now()

        conn.execute(
            """
            INSERT INTO receipt_docs
              (id, doc_number, client_id, supplier_name, arrival_date, comment, status,
               zone_id, zone_name, ttn, logistics_cost, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                doc_id, doc_num, cid,
                (payload.supplier_name or "").strip() or None,
                (payload.arrival_date or "").strip() or None,
                (payload.comment or "").strip() or None,
                RECEIPT_STATUS_DRAFT,
                (payload.zone_id or "").strip() or None,
                (payload.zone_name or "").strip() or None,
                (payload.ttn or "").strip() or None,
                payload.logistics_cost or 0.0,
                now, uid,
            ),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_DOC_CREATE, now, uid),
        )

        for line in payload.lines:
            line_id = str(uuid4())
            conn.execute(
                """
                INSERT INTO receipt_lines
                  (id, doc_id, product_id, product_name, product_sku,
                   color_id, color_name, size_id, size_name,
                   storage_zone_id, storage_zone_name, planned_qty, created_at, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    line_id, doc_id,
                    line.product_id, line.product_name, line.product_sku,
                    line.color_id, line.color_name,
                    line.size_id, line.size_name,
                    line.storage_zone_id, line.storage_zone_name,
                    line.planned_qty, now, uid,
                ),
            )
            conn.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_ADD, line.planned_qty,
                 _line_label(line.product_sku, line.color_name, line.size_name, line.planned_qty), now, uid),
            )

        conn.commit()
    return {"message": doc_id}


@router.get("/receipts/summary")
def receipts_summary(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    sku: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user=Depends(_get_manager),
):
    from datetime import date as _date
    today = _date.today().isoformat()
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if client_id:
            conds.append("d.client_id = ?")
            params.append(client_id.strip())
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
        where = " AND ".join(conds)
        rows = conn.execute(
            f"SELECT d.status, d.arrival_date FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id WHERE {where}",
            params,
        ).fetchall()
    total = len(rows)
    active = sum(1 for r in rows if r["status"] in ("on_intake", "on_review"))
    done = sum(1 for r in rows if r["status"] in ("done", "cancelled"))
    drafts = sum(1 for r in rows if r["status"] == "planned")
    overdue = sum(
        1 for r in rows
        if r["status"] in ("planned", "on_intake", "on_review")
        and r["arrival_date"] and str(r["arrival_date"]) < today
    )
    return {"all": total, "active": active, "done": done, "drafts": drafts, "overdue": overdue}


@router.get("/receipts", response_model=ReceiptListResponse)
def list_receipts(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    client_id: str | None = Query(None),
    status: str | None = Query(None),
    overdue: bool = Query(False),
    search: str | None = Query(None),
    sku: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    unlinked_to_trip: bool = Query(False),
    available_for_trip_id: str | None = Query(None),
    user=Depends(_get_manager),
):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        total, rows = list_receipts_aggregated(
            conn,
            page=page, limit=limit, client_id=client_id, status=status,
            overdue=overdue, search=search, sku=sku, date_from=date_from, date_to=date_to,
            unlinked_to_trip=unlinked_to_trip, available_for_trip_id=available_for_trip_id,
            statuses_all=RECEIPT_STATUSES_ALL,
        )
    items = [
        ReceiptListItem(
            id=str(r["id"]),
            doc_number=str(r["doc_number"]),
            client_id=str(r["client_id"]),
            client_name=r["client_name"],
            supplier_name=r["supplier_name"],
            arrival_date=r["arrival_date"],
            actual_arrival_date=r["actual_arrival_date"],
            comment=r["comment"],
            status=str(r["status"]),
            zone_id=r["zone_id"],
            zone_name=r["zone_name"],
            ttn=r["ttn"],
            logistics_cost=float(r["logistics_cost"] or 0) if show_costs else None,
            created_at=str(r["created_at"]),
            created_by=r["created_by"],
            sku_count=int(r["sku_count"] or 0),
            total_planned=int(r["total_planned"] or 0),
            total_accepted_qty=int(r["total_accepted_qty"] or 0),
        )
        for r in rows
    ]
    return ReceiptListResponse(items=items, total=total, page=page, limit=limit)


@router.get("/receipts/lines", response_model=ReceiptLinesResponse)
def list_receipt_lines_view(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    client_id: str | None = Query(None),
    status: str | None = Query(None),
    overdue: bool = Query(False),
    search: str | None = Query(None),
    sku: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        total, rows = list_receipt_lines(
            conn,
            page=page, limit=limit, client_id=client_id, status=status,
            overdue=overdue, search=search, sku=sku, date_from=date_from, date_to=date_to,
            statuses_all=RECEIPT_STATUSES_ALL,
        )
    items = [
        ReceiptLinesListItem(
            line_id=str(r["line_id"]),
            doc_id=str(r["doc_id"]),
            doc_number=str(r["doc_number"]),
            client_id=str(r["client_id"]),
            client_name=r["client_name"],
            arrival_date=r["arrival_date"],
            actual_arrival_date=r["actual_arrival_date"],
            status=str(r["status"]),
            product_id=str(r["product_id"]),
            product_name=str(r["product_name"]),
            product_sku=str(r["product_sku"]),
            color_name=r["color_name"],
            size_name=r["size_name"],
            planned_qty=int(r["planned_qty"] or 0),
            accepted_qty=int(r["accepted_qty"]) if r["accepted_qty"] is not None else None,
            storage_zone_name=r["storage_zone_name"],
        )
        for r in rows
    ]
    return ReceiptLinesResponse(items=items, total=total, page=page, limit=limit)


@router.get("/receipts/{doc_id}", response_model=ReceiptDetailResponse)
def get_receipt(doc_id: str, user=Depends(_get_manager)):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT d.*, cl.name AS client_name, tl.trip_id AS trip_id, t.trip_number AS trip_number "
            "FROM receipt_docs d "
            "LEFT JOIN clients cl ON cl.id = d.client_id "
            "LEFT JOIN trip_lines tl ON tl.receipt_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 "
            "LEFT JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE d.id = ? AND d.is_deleted = 0",
            (doc_id,),
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")

        state = compute_state(conn, doc_id)

        lines_rows = conn.execute(
            "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at, id",
            (doc_id,),
        ).fetchall()
        ops_rows = conn.execute(
            "SELECT o.*, u.email AS user_email FROM receipt_ops o LEFT JOIN users u ON u.id = o.created_by WHERE o.doc_id = ? ORDER BY o.created_at DESC",
            (doc_id,),
        ).fetchall()

    lines_out = [
        ReceiptLineResponse(
            id=str(lr["id"]),
            doc_id=doc_id,
            product_id=str(lr["product_id"]),
            product_name=str(lr["product_name"]),
            product_sku=str(lr["product_sku"]),
            color_id=lr["color_id"],
            color_name=lr["color_name"],
            size_id=lr["size_id"],
            size_name=lr["size_name"],
            storage_zone_id=lr["storage_zone_id"],
            storage_zone_name=lr["storage_zone_name"],
            planned_qty=int(lr["planned_qty"]),
            accepted_qty=int(lr["accepted_qty"]) if lr["accepted_qty"] is not None else None,
            created_at=str(lr["created_at"]),
        )
        for lr in lines_rows
    ]
    ops_out = [
        ReceiptOpResponse(
            id=str(op["id"]),
            doc_id=doc_id,
            line_id=op["line_id"],
            op_type=str(op["op_type"]),
            qty=op["qty"],
            reason=op["reason"],
            comment=_receipt_op_comment_for_user(op["comment"], user),
            created_at=str(op["created_at"]),
            created_by=op["created_by"],
            created_by_email=op["user_email"],
        )
        for op in ops_rows
    ]
    doc_out = ReceiptDocResponse(
        id=doc_id,
        doc_number=str(doc_row["doc_number"]),
        client_id=str(doc_row["client_id"]),
        client_name=doc_row["client_name"],
        supplier_name=doc_row["supplier_name"],
        arrival_date=doc_row["arrival_date"],
        actual_arrival_date=doc_row["actual_arrival_date"],
        comment=doc_row["comment"],
        status=str(doc_row["status"]),
        zone_id=doc_row["zone_id"],
        zone_name=doc_row["zone_name"],
        ttn=doc_row["ttn"],
        logistics_cost=float(doc_row["logistics_cost"] or 0) if show_costs else None,
        trip_id=doc_row["trip_id"],
        trip_number=doc_row["trip_number"],
        created_at=str(doc_row["created_at"]),
        created_by=doc_row["created_by"],
        updated_at=doc_row["updated_at"],
    )
    return ReceiptDetailResponse(doc=doc_out, lines=lines_out, ops=ops_out, state=state)


@router.patch("/receipts/{doc_id}")
def update_receipt(doc_id: str, payload: ReceiptDocUpdate, user=Depends(_get_manager)):
    if "logistics_cost" in payload.model_fields_set:
        ensure_cost_access(user)
    if "arrival_date" in payload.model_fields_set:
        ensure_planned_arrival_access(user)
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT * FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) in (RECEIPT_STATUS_DONE, RECEIPT_STATUS_CANCELLED):
            raise HTTPException(status_code=400, detail="Завершённый документ нельзя изменять")

        updates: list[str] = []
        params: list = []
        changed: dict = {}

        def _fmt_date(s) -> str:
            if not s:
                return "—"
            try:
                y, m, d = str(s).split("-")
                return f"{d}.{m}.{y}"
            except Exception:
                return str(s)

        def _diff(label: str, old_raw, new_raw, fmt=None) -> None:
            old_cmp = str(old_raw).strip() if old_raw is not None else ""
            new_cmp = str(new_raw).strip() if new_raw is not None else ""
            if old_cmp == new_cmp:
                return
            old_disp = fmt(old_raw) if fmt else (old_cmp or "—")
            new_disp = fmt(new_raw) if fmt else (new_cmp or "—")
            changed[label] = f"{old_disp} → {new_disp}"

        if payload.client_id is not None:
            v = payload.client_id.strip()
            updates.append("client_id = ?"); params.append(v)
            _diff("Клиент", doc_row["client_id"], v)
        if payload.supplier_name is not None:
            v = (payload.supplier_name or "").strip() or None
            updates.append("supplier_name = ?"); params.append(v)
            _diff("Поставщик", doc_row["supplier_name"], v)
        if payload.arrival_date is not None:
            v = (payload.arrival_date or "").strip() or None
            updates.append("arrival_date = ?"); params.append(v)
            _diff("Дата прибытия", doc_row["arrival_date"], v, fmt=_fmt_date)
        if "comment" in payload.model_fields_set:
            v = (payload.comment or "").strip() or None
            updates.append("comment = ?"); params.append(v)
        if payload.zone_id is not None:
            v = (payload.zone_id or "").strip() or None
            updates.append("zone_id = ?"); params.append(v)
        if payload.zone_name is not None:
            v = (payload.zone_name or "").strip() or None
            updates.append("zone_name = ?"); params.append(v)
            _diff("Зона", doc_row["zone_name"], v)
        if payload.ttn is not None:
            v = (payload.ttn or "").strip() or None
            updates.append("ttn = ?"); params.append(v)
            _diff("ТТН", doc_row["ttn"], v)
        if payload.logistics_cost is not None:
            updates.append("logistics_cost = ?"); params.append(payload.logistics_cost)
            _diff("Стоимость логистики", doc_row["logistics_cost"], payload.logistics_cost)

        if updates:
            now = _now()
            updates.append("updated_at = ?"); params.append(now); params.append(doc_id)
            conn.execute(f"UPDATE receipt_docs SET {', '.join(updates)} WHERE id = ?", params)
            if changed:
                conn.execute(
                    "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                    (str(uuid4()), doc_id, RECEIPT_OP_DOC_UPDATE,
                     "; ".join(f"{k}: {v}" for k, v in changed.items()), now, uid),
                )
            conn.commit()
    return {"message": "ok"}


@router.patch("/receipts/{doc_id}/actual-arrival")
def update_receipt_actual_arrival(doc_id: str, payload: ReceiptActualArrivalUpdate, user=Depends(_get_warehouse)):
    """Факт прибытия поступления. Доступно складу, только если поступление НЕ привязано к рейсу.

    У привязанного поступления факт управляется рейсом (копируется при разгрузке /
    правке исполнения) — менять его в карточке поступления нельзя.
    """
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status, actual_arrival_date FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) in (RECEIPT_STATUS_DONE, RECEIPT_STATUS_CANCELLED):
            raise HTTPException(status_code=400, detail="Завершённый документ нельзя изменять")

        linked = conn.execute(
            "SELECT 1 FROM trip_lines WHERE receipt_doc_id = ? AND COALESCE(is_deleted, 0) = 0 LIMIT 1", (doc_id,)
        ).fetchone()
        if linked:
            raise HTTPException(status_code=400, detail="Дата прибытия (факт) управляется рейсом — измените её в рейсе")

        new_val = (payload.actual_arrival_date or "").strip() or None
        old_val = doc_row["actual_arrival_date"]
        if (str(old_val).strip() if old_val is not None else "") == (new_val or ""):
            return {"message": "ok"}

        def _fmt(s) -> str:
            if not s:
                return "—"
            try:
                y, m, d = str(s).split("-")
                return f"{d}.{m}.{y}"
            except Exception:
                return str(s)

        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET actual_arrival_date = ?, updated_at = ? WHERE id = ?",
            (new_val, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_DOC_UPDATE,
             f"Дата прибытия (факт): {_fmt(old_val)} → {_fmt(new_val)}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/receipts/{doc_id}/lines")
def add_receipt_line(doc_id: str, payload: ReceiptLineAdd, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) == RECEIPT_STATUS_DONE:
            raise HTTPException(status_code=400, detail="Нельзя добавить строку в завершённый документ")

        _validate_receipt_line_has_color(payload)
        now = _now()
        line_id = str(uuid4())
        conn.execute(
            """
            INSERT INTO receipt_lines
              (id, doc_id, product_id, product_name, product_sku,
               color_id, color_name, size_id, size_name,
               storage_zone_id, storage_zone_name, planned_qty, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (line_id, doc_id, payload.product_id, payload.product_name, payload.product_sku,
             payload.color_id, payload.color_name, payload.size_id, payload.size_name,
             payload.storage_zone_id, payload.storage_zone_name,
             payload.planned_qty, now, uid),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_ADD, payload.planned_qty,
             _line_label(payload.product_sku, payload.color_name, payload.size_name, payload.planned_qty), now, uid),
        )
        conn.commit()
    return {"message": line_id}


@router.patch("/receipts/{doc_id}/lines/{line_id}")
def update_receipt_line(doc_id: str, line_id: str, payload: ReceiptLineUpdate, user=Depends(_get_manager)):
    uid = str(user["id"])
    provided_fields = getattr(payload, "model_fields_set", None)
    if provided_fields is None:
        provided_fields = getattr(payload, "__fields_set__", set())
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        status = str(doc_row["status"])
        if payload.planned_qty is not None and status not in (RECEIPT_STATUS_DRAFT, RECEIPT_STATUS_PLANNED):
            raise HTTPException(status_code=400, detail="Изменить количество можно только в статусе 'Создание' или 'В плане'")
        if payload.accepted_qty is not None and status not in (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE, RECEIPT_STATUS_ON_REVIEW):
            raise HTTPException(status_code=400, detail="Изменить принятое количество можно только в статусе 'В плане', 'Принят' или 'На проверке'")
        _zone_fields = {"storage_zone_id", "storage_zone_name"}
        if (_zone_fields & set(provided_fields)) and status not in (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE, RECEIPT_STATUS_ON_REVIEW):
            raise HTTPException(status_code=400, detail="Изменить место хранения можно только в статусе 'В плане', 'Принят' или 'На проверке'")
        line_row = conn.execute(
            "SELECT id, planned_qty, accepted_qty, storage_zone_name "
            "FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        now = _now()
        updates: list[str] = []
        params: list = []
        comments: list[str] = []
        op_qty = payload.planned_qty

        if payload.planned_qty is not None:
            old_qty = line_row["planned_qty"]
            updates.append("planned_qty = ?")
            params.append(payload.planned_qty)
            if int(old_qty) != payload.planned_qty:
                comments.append(f"План: {old_qty} → {payload.planned_qty} шт.")
        if payload.accepted_qty is not None:
            old_acc = line_row["accepted_qty"]
            updates.append("accepted_qty = ?")
            params.append(payload.accepted_qty)
            old_acc_disp = int(old_acc) if old_acc is not None else "—"
            if old_acc is None or int(old_acc) != payload.accepted_qty:
                comments.append(f"Принят: {old_acc_disp} → {payload.accepted_qty} шт.")
        if "storage_zone_id" in provided_fields:
            updates.append("storage_zone_id = ?")
            params.append((payload.storage_zone_id or "").strip() or None)
        if "storage_zone_name" in provided_fields:
            old_zone = str(line_row["storage_zone_name"] or "").strip() or "—"
            new_zone = (payload.storage_zone_name or "").strip() or None
            updates.append("storage_zone_name = ?")
            params.append(new_zone)
            new_zone_display = new_zone or "—"
            if old_zone != new_zone_display:
                comments.append(f"Место (на проверке): {old_zone} → {new_zone_display}")

        if updates:
            params.append(line_id)
            conn.execute(f"UPDATE receipt_lines SET {', '.join(updates)} WHERE id = ?", params)
            if comments:
                conn.execute(
                    "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                    (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_UPDATE, op_qty,
                     "; ".join(comments), now, uid),
                )
            conn.commit()
    return {"message": "ok"}


@router.delete("/receipts/{doc_id}/lines/{line_id}")
def delete_receipt_line(doc_id: str, line_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) not in (RECEIPT_STATUS_DRAFT, RECEIPT_STATUS_PLANNED):
            raise HTTPException(status_code=400, detail="Удалить строку можно только в статусе 'Создание' или 'В плане'")
        line_row = conn.execute(
            "SELECT id, product_sku, color_name, size_name, planned_qty FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        now = _now()
        parts = [str(line_row["product_sku"])]
        if line_row["color_name"]:
            parts.append(str(line_row["color_name"]))
        if line_row["size_name"]:
            parts.append(str(line_row["size_name"]))
        parts.append(f"{line_row['planned_qty']} шт.")
        conn.execute("UPDATE receipt_lines SET is_deleted = 1 WHERE id = ?", (line_id,))
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_DELETE,
             "Товар удалён: " + " / ".join(parts), now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/receipts/{doc_id}")
def delete_receipt(doc_id: str, user=Depends(_get_manager)):
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Удалить можно только черновик")
        conn.execute("UPDATE receipt_docs SET is_deleted = 1 WHERE id = ?", (doc_id,))
        conn.commit()
    return {"message": "ok"}


# QC поступления удалён (Итерация 2): годность/брак определяются при упаковке отгрузки.
# Были эндпоинты /receipts/{id}/ops, /qc-complete, /qc-reopen.


@router.post("/receipts/{doc_id}/advance")
def advance_receipt_status(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = advance_receipt(conn, doc_id, uid)
    return {"message": next_status}


@router.post("/receipts/{doc_id}/intake")
def start_receipt_intake(doc_id: str, user=Depends(_get_warehouse)):
    """В плане → Принят: товар прибыл, начинается подсчёт количества.

    Ручной триггер для поступлений без рейса; для рейсовых тот же переход делает
    разгрузка рейса (см. modules/logistics).
    """
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status, actual_arrival_date FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_PLANNED:
            raise HTTPException(status_code=400, detail="Начать приёмку можно только из статуса 'В плане'")
        if not str(doc_row["actual_arrival_date"] or "").strip():
            raise HTTPException(status_code=400, detail="Укажите дату прибытия (факт)")
        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_ON_INTAKE, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_INTAKE_START,
             "В плане → Принят (начало приёмки)", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_ON_INTAKE}


@router.post("/receipts/{doc_id}/arrive")
def arrive_receipt(doc_id: str, payload: ReceiptArrivePayload, user=Depends(_get_warehouse)):
    """Принят → На проверке: «Принять товары» — фиксирует принятое количество.

    Приход встаёт на остатки журнальным движением (intake → storage) по каждой
    строке — расчёт остатков читает только журнал, accepted_qty остаётся
    документным фактом приёмки.
    """
    from modules.balances.service import insert_inventory_move

    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT d.status, d.doc_number, d.client_id, cl.name AS client_name "
            "FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id "
            "WHERE d.id = ? AND d.is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_ON_INTAKE:
            raise HTTPException(
                status_code=400,
                detail="Принять товары можно только из статуса 'Принят'",
            )
        _validate_receipt_lines_have_storage(conn, doc_id)

        line_rows = conn.execute(
            "SELECT id, product_id, product_name, product_sku, color_id, color_name, "
            "size_id, size_name, storage_zone_id, storage_zone_name "
            "FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0",
            (doc_id,),
        ).fetchall()
        if not line_rows:
            raise HTTPException(status_code=400, detail="Нет строк в документе")

        accepted_by_line = {item.line_id: item.accepted_qty for item in payload.lines}
        missing = [str(lr["id"]) for lr in line_rows if str(lr["id"]) not in accepted_by_line]
        if missing:
            raise HTTPException(status_code=400, detail="Укажите принятое количество по каждой строке")

        now = _now()
        for lr in line_rows:
            lid = str(lr["id"])
            qty = accepted_by_line[lid]
            conn.execute(
                "UPDATE receipt_lines SET accepted_qty = ? WHERE id = ?",
                (qty, lid),
            )
            conn.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), doc_id, lid, RECEIPT_OP_ARRIVAL_ACCEPT, qty,
                 f"Принят: {qty} шт. ({_line_label(lr['product_sku'], lr['color_name'], lr['size_name'], None)})",
                 now, uid),
            )
            if qty > 0:
                insert_inventory_move(
                    conn,
                    product_id=str(lr["product_id"]), product_name=lr["product_name"], product_sku=lr["product_sku"],
                    color_id=lr["color_id"], color_name=lr["color_name"],
                    size_id=lr["size_id"], size_name=lr["size_name"],
                    client_id=doc_row["client_id"], client_name=doc_row["client_name"],
                    from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
                    from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                    from_zone_id=lr["storage_zone_id"], from_zone_name=lr["storage_zone_name"],
                    to_zone_id=lr["storage_zone_id"], to_zone_name=lr["storage_zone_name"],
                    qty=int(qty), user_id=uid, receipt_line_id=lid,
                    comment=f"Приёмка по поступлению {doc_row['doc_number']}: {qty} шт.",
                )

        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_DONE, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_ARRIVAL_FIX,
             "Принят → Завершён (товары приняты, на проверке)", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_DONE}


@router.post("/receipts/{doc_id}/cancel")
def cancel_receipt(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_PLANNED:
            raise HTTPException(status_code=400, detail="Аннулировать можно только документ в статусе 'В плане'")
        # Привязанное к активному рейсу поступление аннулировать нельзя: рейс повезёт
        # «мёртвую» строку, а разгрузка попытается стартовать приёмку. Сначала отвязка.
        trip_row = conn.execute(
            "SELECT t.trip_number FROM trip_lines tl "
            "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE tl.receipt_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 AND t.status != ?",
            (doc_id, TRIP_STATUS_CANCELLED),
        ).fetchone()
        if trip_row:
            raise HTTPException(
                status_code=400,
                detail=f"Поступление привязано к рейсу {trip_row['trip_number']} — сначала отвяжите его от рейса",
            )
        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_CANCELLED, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_CANCEL, "В пути → Аннулирован", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_CANCELLED}


# Эндпоинт /receipts/{id}/reopen удалён: статус документа on_review убран (приёмка завершается на done).
