from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from idempotency import begin_idempotent, finish_idempotent
from config import (
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_CANCEL,
    RECEIPT_OP_DOC_CREATE,
    RECEIPT_OP_DOC_UPDATE,
    RECEIPT_OP_LINE_ADD,
    RECEIPT_OP_LINE_DELETE,
    RECEIPT_OP_LINE_UPDATE,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
    RECEIPT_STATUSES_ALL,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_CANCELLED,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_UNLOADING,
)
from dbconn import get_connection, ci_like_substring_param
from utils import now_iso as _now, size_order_sql, validate_business_date
from modules.timesheet.service import business_today
from modules.auth.service import (
    get_current_document_creator,
    get_current_manager,
    get_current_warehouse,
)
from modules.receipts.schemas import (
    DuplicateCheckResponse,
    ReceiptActualArrivalUpdate,
    ReceiptDetailResponse,
    ReceiptDuplicateCheck,
    ReceiptDocCreate,
    ReceiptDocResponse,
    ReceiptDocUpdate,
    ReceiptLineAdd,
    ReceiptLinePlacement,
    ReceiptLineResponse,
    ReceiptLinesListItem,
    ReceiptLinesResponse,
    ReceiptLineUpdate,
    ReceiptListItem,
    ReceiptListResponse,
    ReceiptOpResponse,
    ReceiptTripAllocRemainingResponse,
    ReceiptsSummaryResponse,
    TripRef,
)
from modules.receipts.service import (
    advance_receipt,
    arrived_qty_by_line,
    compute_state,
    ensure_receipt_line_unique,
    find_duplicate_receipts,
    list_receipt_lines,
    list_receipts_aggregated,
    next_doc_number,
    receipt_alloc_remaining,
    receipt_trip_allocations,
    receipt_shortage_final,
    received_placements_by_line,
    release_shortfall_for_redelivery,
)
from security import (
    can_view_costs,
    ensure_cost_access,
    ensure_planned_arrival_access,
)

router = APIRouter(tags=["receipts"])

_get_manager = get_current_manager
_get_warehouse = get_current_warehouse



def _line_label(product_sku, color_name, size_name, qty) -> str:
    sku = str(product_sku or "").strip() or "SKU?"
    color = str(color_name or "").strip()
    size = str(size_name or "").strip()
    attrs = " / ".join([x for x in (color, size) if x])
    qty_part = f" x{int(qty or 0)}" if qty is not None else ""
    return f"{sku}{f' ({attrs})' if attrs else ''}{qty_part}"


def _validate_receipt_line_has_color(line) -> None:
    if not str(line.color_id or "").strip():
        raise HTTPException(status_code=400, detail="Укажите цвет товара")


def _receipt_op_comment_for_user(comment: str | None, user) -> str | None:
    if comment and not can_view_costs(user) and "Стоимость логистики" in comment:
        return "Изменена стоимость логистики"
    return comment


@router.post("/receipts")
def create_receipt(
    payload: ReceiptDocCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_document_creator),
):
    if payload.logistics_cost is not None:
        ensure_cost_access(user)
    uid = str(user["id"])
    cid = payload.client_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Укажите клиента")
    for line in payload.lines:
        _validate_receipt_line_has_color(line)

    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "receipt_create")
        if not proceed:
            return stored
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
                validate_business_date(payload.arrival_date, field_ru="Дата прибытия"),
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
            ensure_receipt_line_unique(
                conn, doc_id, line.product_id, line.color_id, line.size_id,
                product_name=line.product_name,
            )
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

        result = {"message": doc_id}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.post("/receipts/check-duplicate", response_model=DuplicateCheckResponse)
def check_receipt_duplicate(
    payload: ReceiptDuplicateCheck,
    user=Depends(get_current_document_creator),
):
    cid = (payload.client_id or "").strip()
    if not cid or not payload.lines:
        return {"matches": []}
    with get_connection() as conn:
        matches = find_duplicate_receipts(
            conn, client_id=cid, arrival_date=payload.arrival_date, lines=payload.lines
        )
    return {"matches": matches}


@router.get("/receipts/summary", response_model=ReceiptsSummaryResponse)
def receipts_summary(
    client_id: str | None = Query(None),
    search: str | None = Query(None),
    sku: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user=Depends(_get_manager),
):
    today = business_today().isoformat()
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if client_id:
            conds.append("d.client_id = ?")
            params.append(client_id.strip())
        if search:
            s = ci_like_substring_param(search)
            conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(cl.name) LIKE ?)")
            params += [s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM receipt_lines rl"
                " WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted,0)=0"
                " AND (fold_ci(rl.product_sku) LIKE ? OR fold_ci(rl.product_name) LIKE ?))"
            )
            s = ci_like_substring_param(sku)
            params += [s, s]
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
    active_statuses = (
        RECEIPT_STATUS_PLANNED,
        RECEIPT_STATUS_PARTIALLY_RECEIVED,
    )
    active = sum(1 for r in rows if r["status"] in active_statuses)
    done = sum(1 for r in rows if r["status"] in (RECEIPT_STATUS_DONE, RECEIPT_STATUS_CANCELLED))
    drafts = sum(1 for r in rows if r["status"] == RECEIPT_STATUS_DRAFT)
    overdue = sum(
        1 for r in rows
        if r["status"] in active_statuses
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
            trips=[TripRef(id=str(t["id"]), number=str(t["number"])) for t in r.get("trips", [])],
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


@router.get("/receipts/{doc_id}/trip-alloc-remaining", response_model=ReceiptTripAllocRemainingResponse)
def receipt_trip_alloc_remaining(doc_id: str, user=Depends(_get_manager)):
    """Остаток к распределению по строкам поступления для привязки к рейсу.

    remaining = план − уже распределённое в активные рейсы. Шторка привязки к
    рейсу берёт его как значение по умолчанию и верхнюю границу.
    """
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT id FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
        remaining = receipt_alloc_remaining(conn, doc_id)
        allocations = receipt_trip_allocations(conn, doc_id)
        lines = conn.execute(
            "SELECT l.id, l.product_sku, l.product_name, l.color_name, l.size_name, "
            "l.planned_qty, l.accepted_qty "
            "FROM receipt_lines l LEFT JOIN sizes sz ON sz.id = l.size_id "
            "WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 "
            "ORDER BY l.product_sku, l.product_name, l.color_name NULLS FIRST, "
            f"{size_order_sql('sz.sort_order', 'l.size_name')}, l.id",
            (doc_id,),
        ).fetchall()
    items = [
        {
            "line_id": str(ln["id"]),
            "product_sku": ln["product_sku"],
            "product_name": ln["product_name"],
            "color": ln["color_name"],
            "variant": " · ".join(x for x in [ln["color_name"], ln["size_name"]] if x) or None,
            "planned_qty": int(ln["planned_qty"] or 0),
            "accepted_qty": int(ln["accepted_qty"] or 0),
            "remaining": int(remaining.get(str(ln["id"]), 0)),
            "allocations": allocations.get(str(ln["id"]), []),
        }
        for ln in lines
    ]
    return {"lines": items}


@router.get("/receipts/{doc_id}", response_model=ReceiptDetailResponse)
def get_receipt(doc_id: str, user=Depends(_get_manager)):
    show_costs = can_view_costs(user)
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT d.*, cl.name AS client_name, "
            "COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_name "
            "FROM receipt_docs d "
            "LEFT JOIN clients cl ON cl.id = d.client_id "
            "LEFT JOIN users u ON u.id = d.created_by "
            "WHERE d.id = ? AND d.is_deleted = 0",
            (doc_id,),
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")

        trip_rows = conn.execute(
            "SELECT DISTINCT t.id AS trip_id, t.trip_number AS trip_number "
            "FROM trip_lines tl "
            "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE tl.receipt_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 AND t.status != ? "
            "ORDER BY t.trip_number",
            (doc_id, TRIP_STATUS_CANCELLED),
        ).fetchall()

        state = compute_state(conn, doc_id)

        lines_rows = conn.execute(
            "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at, id",
            (doc_id,),
        ).fetchall()
        arrived_by_line = arrived_qty_by_line(conn, doc_id)
        placements_by_line = received_placements_by_line(conn, doc_id)
        ops_rows = conn.execute(
            "SELECT o.*, COALESCE(NULLIF(u.display_name, ''), u.email) AS user_email FROM receipt_ops o LEFT JOIN users u ON u.id = o.created_by WHERE o.doc_id = ? ORDER BY o.created_at DESC",
            (doc_id,),
        ).fetchall()
        can_close_short = receipt_shortage_final(conn, doc_id)

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
            arrived_qty=int(arrived_by_line.get(str(lr["id"]), int(lr["planned_qty"]))),
            placements=[
                ReceiptLinePlacement(
                    storage_zone_id=p["storage_zone_id"],
                    storage_zone_name=p["storage_zone_name"],
                    qty=p["qty"],
                )
                for p in placements_by_line.get(str(lr["id"]), [])
            ],
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
        trip_id=str(trip_rows[0]["trip_id"]) if trip_rows else None,
        trip_number=str(trip_rows[0]["trip_number"]) if trip_rows else None,
        trips=[TripRef(id=str(tr["trip_id"]), number=str(tr["trip_number"])) for tr in trip_rows],
        created_at=str(doc_row["created_at"]),
        created_by=doc_row["created_by"],
        created_by_name=doc_row["created_by_name"],
        updated_at=doc_row["updated_at"],
    )
    return ReceiptDetailResponse(
        doc=doc_out, lines=lines_out, ops=ops_out, state=state,
        can_close_short=can_close_short,
    )


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
            v = validate_business_date(payload.arrival_date, field_ru="Дата прибытия")
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
            "SELECT 1 FROM trip_lines tl "
            "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE tl.receipt_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 AND t.status != ? LIMIT 1",
            (doc_id, TRIP_STATUS_CANCELLED),
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
        ensure_receipt_line_unique(
            conn, doc_id, payload.product_id, payload.color_id, payload.size_id,
            product_name=payload.product_name,
        )
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
        if payload.accepted_qty is not None and status != RECEIPT_STATUS_PLANNED:
            raise HTTPException(status_code=400, detail="Изменить принятое количество можно только в статусе 'В плане'")
        _zone_fields = {"storage_zone_id", "storage_zone_name"}
        if (_zone_fields & set(provided_fields)) and status != RECEIPT_STATUS_PLANNED:
            raise HTTPException(status_code=400, detail="Изменить место хранения можно только в статусе 'В плане'")
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


# Карточная приёмка удалена: новые поступления принимаются только в рейсе
# (разгрузка рейса → receive_receipts_for_trip). Были /receipts/{id}/intake и
# /receipts/{id}/arrive — заменены приёмкой в карточке рейса. Историческое
# заведение остатков — действие в «Остатках» (POST /balances/stock-entry).


@router.post("/receipts/{doc_id}/cancel")
def cancel_receipt(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "receipt_cancel", response={"message": RECEIPT_STATUS_CANCELLED})
        if not proceed:
            return stored
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


@router.post("/receipts/{doc_id}/close-short")
def close_receipt_short(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_manager),
):
    """Частично принято → Завершён: менеджер закрывает поступление с недопоставкой.

    Применяется, когда рейсы поступления приехали, но привезли меньше плана и больше
    довозов не будет. В сток ничего не пишем — недовезённое не приезжало; разница
    план−принято фиксируется в журнале как недопоставка.
    """
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "receipt_close_short", response={"message": RECEIPT_STATUS_DONE})
        if not proceed:
            return stored
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_PARTIALLY_RECEIVED:
            raise HTTPException(
                status_code=400,
                detail="Закрыть с недопоставкой можно только частично принятое поступление",
            )
        # Гейт «рейсы кончились, привезли меньше»: пока рейс ещё может что-то довезти
        # или план разложен по рейсам не целиком — это не недопоставка, а ожидание.
        pending_trip = conn.execute(
            "SELECT t.trip_number FROM trip_lines tl "
            "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
            "WHERE tl.receipt_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 "
            "AND t.status IN (?,?,?) LIMIT 1",
            (doc_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
        ).fetchone()
        if pending_trip:
            raise HTTPException(
                status_code=400,
                detail=f"Поступление ещё везётся рейсом {pending_trip['trip_number']} — дождитесь разгрузки",
            )
        if any(v > 0 for v in receipt_alloc_remaining(conn, doc_id).values()):
            raise HTTPException(
                status_code=400,
                detail="Не весь план разложен по рейсам — распределите остаток или дождитесь рейса",
            )
        agg = conn.execute(
            "SELECT COALESCE(SUM(accepted_qty), 0) AS acc, COALESCE(SUM(planned_qty), 0) AS plan "
            "FROM receipt_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (doc_id,),
        ).fetchone()
        accepted = int(agg["acc"]) if agg else 0
        planned = int(agg["plan"]) if agg else 0
        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_DONE, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_ARRIVAL_FIX,
             f"{RECEIPT_STATUS_RU[RECEIPT_STATUS_PARTIALLY_RECEIVED]} → {RECEIPT_STATUS_RU[RECEIPT_STATUS_DONE]} "
             f"(закрыто с недопоставкой: принято {accepted} из {planned} шт.)", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_DONE}


@router.post("/receipts/{doc_id}/expect-redelivery")
def expect_receipt_redelivery(
    doc_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_manager),
):
    """Частично принято: менеджер фиксирует, что недовоз довезут новым рейсом.

    Зеркало close-short (тот же гейт «рейсы кончились, привезли меньше плана»), но
    вместо закрытия с недопоставкой освобождает недовоз разгруженных рейсов: их
    аллокации ужимаются до фактически принятого. После этого по поступлению снова
    есть остаток к распределению — менеджер заказывает новый рейс и раскладывает на
    него освобождённое. Сток не трогаем — принятое уже на остатках.
    """
    uid = str(user["id"])
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "receipt_expect_redelivery", response={"message": "ok"})
        if not proceed:
            return stored
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if not receipt_shortage_final(conn, doc_id):
            raise HTTPException(
                status_code=400,
                detail="Освободить недовоз можно только у частично принятого поступления, "
                       "по которому все рейсы уже приехали",
            )
        released = release_shortfall_for_redelivery(conn, doc_id, uid)
        if released <= 0:
            raise HTTPException(status_code=400, detail="Нет недовоза для освобождения")
        conn.commit()
    return {"message": "ok"}


# Эндпоинт /receipts/{id}/reopen удалён: статус документа on_review убран (приёмка завершается на done).
