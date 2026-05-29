from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_CANCEL,
    RECEIPT_OP_DEFECT_CORRECTION,
    RECEIPT_OP_DEFECT_FIX,
    RECEIPT_OP_DOC_CREATE,
    RECEIPT_OP_DOC_UPDATE,
    RECEIPT_OP_LINE_ADD,
    RECEIPT_OP_LINE_DELETE,
    RECEIPT_OP_LINE_QC_COMPLETE,
    RECEIPT_OP_LINE_QC_REOPEN,
    RECEIPT_OP_LINE_UPDATE,
    RECEIPT_OP_PLAN_FIX,
    RECEIPT_OP_RECEIVING,
    RECEIPT_OP_RECEIVING_CORRECTION,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
    RECEIPT_STATUSES_ALL,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.receipts.schemas import (
    ReceiptDetailResponse,
    ReceiptDocCreate,
    ReceiptDocResponse,
    ReceiptDocUpdate,
    ReceiptLineAdd,
    ReceiptLineQcComplete,
    ReceiptLineResponse,
    ReceiptLineUpdate,
    ReceiptListItem,
    ReceiptListResponse,
    ReceiptOpRecord,
    ReceiptOpResponse,
)
from modules.receipts.service import (
    advance_receipt,
    compute_state,
    list_receipts_aggregated,
    next_doc_number,
)

router = APIRouter(tags=["receipts"])

_get_manager = get_current_manager


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


@router.post("/receipts")
def create_receipt(payload: ReceiptDocCreate, user=Depends(_get_manager)):
    uid = str(user["id"])
    cid = payload.client_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Укажите клиента")

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
              (id, doc_number, client_id, supplier_name, arrival_date, status,
               zone_id, zone_name, ttn, logistics_cost, created_at, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                doc_id, doc_num, cid,
                (payload.supplier_name or "").strip() or None,
                (payload.arrival_date or "").strip() or None,
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
            s = f"%{search.strip()}%"
            conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
            params += [s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM receipt_lines rl"
                " WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted,0)=0 AND rl.product_sku LIKE ?)"
            )
            params.append(f"%{sku.strip()}%")
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
    active = sum(1 for r in rows if r["status"] == "on_review")
    done = sum(1 for r in rows if r["status"] in ("done", "cancelled"))
    drafts = sum(1 for r in rows if r["status"] == "planned")
    overdue = sum(
        1 for r in rows
        if r["status"] in ("planned", "on_review")
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
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        total, rows = list_receipts_aggregated(
            conn,
            page=page, limit=limit, client_id=client_id, status=status,
            overdue=overdue, search=search, sku=sku, date_from=date_from, date_to=date_to,
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
            status=str(r["status"]),
            zone_id=r["zone_id"],
            zone_name=r["zone_name"],
            ttn=r["ttn"],
            logistics_cost=float(r["logistics_cost"] or 0),
            created_at=str(r["created_at"]),
            created_by=r["created_by"],
            sku_count=int(r["sku_count"] or 0),
            total_planned=int(r["total_planned"] or 0),
            total_accepted=int(r["total_accepted"] or 0),
            total_defect=int(r["total_defect"] or 0),
        )
        for r in rows
    ]
    return ReceiptListResponse(items=items, total=total, page=page, limit=limit)


@router.get("/receipts/{doc_id}", response_model=ReceiptDetailResponse)
def get_receipt(doc_id: str, user=Depends(_get_manager)):
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT d.*, cl.name AS client_name FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id WHERE d.id = ? AND d.is_deleted = 0",
            (doc_id,),
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")

        state = compute_state(conn, doc_id)

        lines_rows = conn.execute(
            "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at",
            (doc_id,),
        ).fetchall()
        ops_rows = conn.execute(
            "SELECT o.*, u.email AS user_email FROM receipt_ops o LEFT JOIN users u ON u.id = o.created_by WHERE o.doc_id = ? ORDER BY o.created_at DESC",
            (doc_id,),
        ).fetchall()

    state_by_line = {l["id"]: l for l in state["lines"]}
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
            accepted=state_by_line.get(str(lr["id"]), {}).get("accepted", 0),
            defect=state_by_line.get(str(lr["id"]), {}).get("defect", 0),
            ops_count=state_by_line.get(str(lr["id"]), {}).get("ops_count", 0),
            qc_status=str(state_by_line.get(str(lr["id"]), {}).get("qc_status", "pending")),
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
            comment=op["comment"],
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
        status=str(doc_row["status"]),
        zone_id=doc_row["zone_id"],
        zone_name=doc_row["zone_name"],
        ttn=doc_row["ttn"],
        logistics_cost=float(doc_row["logistics_cost"] or 0),
        created_at=str(doc_row["created_at"]),
        created_by=doc_row["created_by"],
        updated_at=doc_row["updated_at"],
    )
    return ReceiptDetailResponse(doc=doc_out, lines=lines_out, ops=ops_out, state=state)


@router.patch("/receipts/{doc_id}")
def update_receipt(doc_id: str, payload: ReceiptDocUpdate, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT * FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) == RECEIPT_STATUS_DONE:
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
        if (("storage_zone_id" in provided_fields) or ("storage_zone_name" in provided_fields)) and status not in (RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_REVIEW):
            raise HTTPException(status_code=400, detail="Изменить зону хранения можно только в статусе 'В плане' или 'На проверке'")
        line_row = conn.execute(
            "SELECT id, planned_qty, storage_zone_name FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
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
                comments.append(f"Хранение: {old_zone} → {new_zone_display}")

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


@router.post("/receipts/{doc_id}/ops")
def record_receipt_op(doc_id: str, payload: ReceiptOpRecord, user=Depends(_get_manager)):
    uid = str(user["id"])
    if payload.op_type not in {
        RECEIPT_OP_RECEIVING,
        RECEIPT_OP_DEFECT_FIX,
        RECEIPT_OP_RECEIVING_CORRECTION,
        RECEIPT_OP_DEFECT_CORRECTION,
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported op_type: {RECEIPT_OP_RECEIVING} | {RECEIPT_OP_DEFECT_FIX} | "
                f"{RECEIPT_OP_RECEIVING_CORRECTION} | {RECEIPT_OP_DEFECT_CORRECTION}"
            ),
        )
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_ON_REVIEW:
            raise HTTPException(status_code=400, detail="Операцию можно записывать только в статусе 'on_review'")
        line_row = conn.execute(
            "SELECT id FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (payload.line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=400, detail="Строка не найдена в этом документе")
        now = _now()
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,reason,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, payload.line_id, payload.op_type, payload.qty,
             payload.reason, payload.comment, now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/receipts/{doc_id}/lines/{line_id}/qc-complete")
def complete_receipt_line(
    doc_id: str, line_id: str,
    body: ReceiptLineQcComplete | None = None,
    user=Depends(_get_manager),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_ON_REVIEW:
            raise HTTPException(status_code=400, detail="QC можно выполнить только в статусе 'on_review'")
        line_row = conn.execute(
            "SELECT id FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        if body and body.accepted is not None and body.accepted >= 0:
            conn.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), doc_id, line_id, RECEIPT_OP_RECEIVING_CORRECTION, body.accepted, "QC корректировка", now, uid),
            )
        if body and body.defect is not None and body.defect >= 0:
            conn.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), doc_id, line_id, RECEIPT_OP_DEFECT_CORRECTION, body.defect, "QC корректировка брака", now, uid),
            )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_QC_COMPLETE, "Строка проверена", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/receipts/{doc_id}/lines/{line_id}/qc-reopen")
def reopen_receipt_line(doc_id: str, line_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_ON_REVIEW:
            raise HTTPException(status_code=400, detail="Переоткрыть строку можно только в статусе 'on_review'")
        line_row = conn.execute(
            "SELECT id FROM receipt_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line_row:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_QC_REOPEN, "Строка возвращена на проверку", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/receipts/{doc_id}/advance")
def advance_receipt_status(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = advance_receipt(conn, doc_id, uid)
    return {"message": next_status}


@router.post("/receipts/{doc_id}/arrive")
def arrive_receipt(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        current = str(doc_row["status"])
        if current not in (RECEIPT_STATUS_DRAFT, RECEIPT_STATUS_PLANNED):
            raise HTTPException(
                status_code=400,
                detail="Зафиксировать прибытие можно только из статуса 'Создание' или 'В плане'",
            )
        if current == RECEIPT_STATUS_PLANNED:
            _validate_receipt_lines_have_storage(conn, doc_id)
        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_ON_REVIEW, now, doc_id),
        )
        if current == RECEIPT_STATUS_DRAFT:
            conn.execute(
                "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), doc_id, RECEIPT_OP_PLAN_FIX,
                 "Создание → В плане (авто при фиксации прибытия)", now, uid),
            )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_ARRIVAL_FIX,
             "В плане → На проверке (фиксация прибытия)", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_ON_REVIEW}


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


@router.post("/receipts/{doc_id}/reopen")
def reopen_receipt(doc_id: str, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) != RECEIPT_STATUS_DONE:
            raise HTTPException(status_code=400, detail="Вернуть на проверку можно только завершённый документ")
        now = _now()
        conn.execute(
            "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
            (RECEIPT_STATUS_ON_REVIEW, now, doc_id),
        )
        conn.execute(
            "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, RECEIPT_OP_DOC_UPDATE,
             "Завершён → На проверке (возврат на проверку)", now, uid),
        )
        conn.commit()
    return {"message": RECEIPT_STATUS_ON_REVIEW}
