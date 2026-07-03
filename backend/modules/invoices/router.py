from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile

from idempotency import begin_idempotent, finish_idempotent
from config import (
    DISPATCH_STATUS_LABELS,
    INVOICE_ACTIVE_STATUSES,
    INVOICE_MUTABLE_STATUSES,
    INVOICE_OP_AMOUNT_CHANGE,
    INVOICE_OP_CANCEL,
    INVOICE_OP_CLOSE,
    INVOICE_OP_DOC_CREATE,
    INVOICE_OP_DOC_UPDATE,
    INVOICE_OP_DUE_DATE_CHANGE,
    INVOICE_OP_EXTRA_UNLINK,
    INVOICE_OP_ISSUE,
    INVOICE_OP_PAYMENT,
    INVOICE_OP_RECEIPT_UNLINK,
    INVOICE_OP_SHIPMENT_UNLINK,
    INVOICE_STATUS_CANCELLED,
    INVOICE_STATUS_CLOSED,
    INVOICE_STATUS_DRAFT,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_LABELS,
    INVOICE_STATUS_PARTIALLY_PAID,
    MAX_UPLOAD_BYTES,
    RECEIPT_STATUS_LABELS,
    UPLOADS_DIR,
)
from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.invoices.schemas import (
    InvoiceAlertsResponse,
    InvoiceAttachExtraIncome,
    InvoiceAttachReceipts,
    InvoiceAttachShipments,
    InvoiceAmountUpdate,
    InvoiceCreate,
    InvoiceDetailResponse,
    InvoiceDueDateUpdate,
    InvoiceExtraIncomeItem,
    InvoiceFileItem,
    InvoiceListItem,
    InvoiceListResponse,
    InvoiceOpItem,
    InvoicePaymentCreate,
    InvoicePaymentItem,
    InvoiceReceiptItem,
    InvoiceShipmentItem,
    InvoiceUpdate,
    ReceiptContentsResponse,
    ShipmentContentsResponse,
    UninvoicedExtraIncomeItem,
    UninvoicedExtraIncomeResponse,
    UninvoicedReceiptItem,
    UninvoicedReceiptsResponse,
    UninvoicedShipmentItem,
    UninvoicedShipmentsResponse,
)
from modules.invoices.service import (
    aggregate_receipt_contents,
    aggregate_shipment_contents,
    alerts_counts,
    attach_extra_income,
    attach_receipts,
    attach_shipments,
    format_kopecks,
    invalidate_alerts_cache,
    is_due_reached,
    is_overdue,
    list_invoices_aggregated,
    list_uninvoiced_extra_income,
    list_uninvoiced_receipts,
    list_uninvoiced_shipments,
    logistics_amount_for_docs,
    next_invoice_number,
    recompute_paid,
    rub_to_kop,
    suggested_amount_for_dispatches,
)
from security import ensure_finance_access
from utils import now_iso as _now

router = APIRouter(tags=["invoices"])

_ALLOWED_INVOICE_FILE_EXTS = {".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg"}


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user



def _status_label(status: str) -> str:
    return INVOICE_STATUS_LABELS.get(status, status)


def _require_active(doc) -> str:
    status = str(doc["status"])
    if status not in INVOICE_ACTIVE_STATUSES:
        label = _status_label(status)
        raise HTTPException(status_code=400, detail=f"Счёт в статусе «{label}» изменять нельзя")
    return status


def _require_mutable(doc) -> str:
    status = str(doc["status"])
    if status not in INVOICE_MUTABLE_STATUSES:
        label = _status_label(status)
        raise HTTPException(status_code=400, detail=f"Счёт в статусе «{label}» изменять нельзя")
    return status


def _load_detail(conn, invoice_id: str) -> InvoiceDetailResponse:
    doc = conn.execute(
        "SELECT * FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (invoice_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Счёт не найден")

    ship_rows = conn.execute(
        """
        SELECT s.shipment_doc_id, d.doc_number, d.cargo_type, d.status,
               d.ship_date, d.destination, d.logistics_cost,
               (SELECT COUNT(DISTINCT sl.product_id) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(sl.qty), 0) FROM dispatch_lines sl
                WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0) AS total_qty
        FROM invoice_shipments s
        JOIN dispatch_docs d ON d.id = s.shipment_doc_id
        WHERE s.invoice_id = ? AND COALESCE(s.is_deleted, 0) = 0
        ORDER BY d.doc_number
        """,
        (invoice_id,),
    ).fetchall()
    shipments = [
        InvoiceShipmentItem(
            shipment_doc_id=str(r["shipment_doc_id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=str(r["cargo_type"]),
            status=str(r["status"]),
            status_label=DISPATCH_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            ship_date=r["ship_date"],
            destination=r["destination"],
            sku_count=int(r["sku_count"]),
            total_qty=int(r["total_qty"]),
            logistics_cost_kop=rub_to_kop(r["logistics_cost"]),
        )
        for r in ship_rows
    ]

    rec_rows = conn.execute(
        """
        SELECT s.receipt_doc_id, d.doc_number, d.status, d.arrival_date,
               d.supplier_name, d.logistics_cost,
               (SELECT COUNT(DISTINCT rl.product_id) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS sku_count,
               (SELECT COALESCE(SUM(rl.accepted_qty), 0) FROM receipt_lines rl
                WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted, 0) = 0) AS total_qty
        FROM invoice_receipts s
        JOIN receipt_docs d ON d.id = s.receipt_doc_id
        WHERE s.invoice_id = ? AND COALESCE(s.is_deleted, 0) = 0
        ORDER BY d.doc_number
        """,
        (invoice_id,),
    ).fetchall()
    receipts = [
        InvoiceReceiptItem(
            receipt_doc_id=str(r["receipt_doc_id"]),
            doc_number=str(r["doc_number"]),
            status=str(r["status"]),
            status_label=RECEIPT_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            arrival_date=r["arrival_date"],
            supplier_name=r["supplier_name"],
            sku_count=int(r["sku_count"]),
            total_qty=int(r["total_qty"]),
            logistics_cost_kop=rub_to_kop(r["logistics_cost"]),
        )
        for r in rec_rows
    ]
    dispatch_logistics_kop = sum(s.logistics_cost_kop for s in shipments)
    receipt_logistics_kop = sum(r.logistics_cost_kop for r in receipts)

    extra_rows = conn.execute(
        """
        SELECT l.entry_id, e.entry_date, e.qty, e.amount_kop, e.comment,
               c.name AS category_name
        FROM invoice_extra_income l
        JOIN extra_income_entries e ON e.id = l.entry_id
        LEFT JOIN extra_income_categories c ON c.id = e.category_id
        WHERE l.invoice_id = ? AND COALESCE(l.is_deleted, 0) = 0
        ORDER BY e.entry_date, e.created_at
        """,
        (invoice_id,),
    ).fetchall()
    extra_income = [
        InvoiceExtraIncomeItem(
            entry_id=str(r["entry_id"]),
            entry_date=str(r["entry_date"]),
            category_name=r["category_name"],
            qty=(int(r["qty"]) if r["qty"] is not None else None),
            amount_kop=int(r["amount_kop"]),
            comment=r["comment"],
        )
        for r in extra_rows
    ]
    extra_income_kop = sum(x.amount_kop for x in extra_income)

    pay_rows = conn.execute(
        """
        SELECT p.id, p.amount, p.paid_on, p.comment, p.created_at, p.created_by,
               u.email AS created_by_email
        FROM invoice_payments p
        LEFT JOIN users u ON u.id = p.created_by
        WHERE p.invoice_id = ? AND COALESCE(p.is_deleted, 0) = 0
        ORDER BY p.created_at
        """,
        (invoice_id,),
    ).fetchall()
    payments = [
        InvoicePaymentItem(
            id=str(r["id"]),
            amount=int(r["amount"]),
            paid_on=r["paid_on"],
            comment=r["comment"],
            created_at=str(r["created_at"]),
            created_by=r["created_by"],
            created_by_email=r["created_by_email"],
        )
        for r in pay_rows
    ]

    file_rows = conn.execute(
        "SELECT id, filename, url, mime_type, created_at FROM invoice_files "
        "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at",
        (invoice_id,),
    ).fetchall()
    files = [
        InvoiceFileItem(
            id=str(r["id"]),
            filename=str(r["filename"]),
            url=str(r["url"]),
            mime_type=r["mime_type"],
            created_at=str(r["created_at"]),
        )
        for r in file_rows
    ]

    op_rows = conn.execute(
        """
        SELECT o.id, o.op_type, o.comment, o.created_at, o.created_by,
               u.email AS created_by_email
        FROM invoice_ops o
        LEFT JOIN users u ON u.id = o.created_by
        WHERE o.invoice_id = ?
        ORDER BY o.created_at
        """,
        (invoice_id,),
    ).fetchall()
    ops = [
        InvoiceOpItem(
            id=str(r["id"]),
            op_type=str(r["op_type"]),
            comment=r["comment"],
            created_at=str(r["created_at"]),
            created_by=r["created_by"],
            created_by_email=r["created_by_email"],
        )
        for r in op_rows
    ]

    status = str(doc["status"])
    return InvoiceDetailResponse(
        id=str(doc["id"]),
        doc_number=str(doc["doc_number"]),
        client_id=doc["client_id"],
        client_name=doc["client_name"],
        status=status,
        status_label=_status_label(status),
        total_amount=int(doc["total_amount"]),
        paid_amount=int(doc["paid_amount"]),
        due_date=doc["due_date"],
        overdue=is_overdue(status, doc["due_date"]),
        due_reached=is_due_reached(status, doc["due_date"]),
        comment=doc["comment"],
        created_at=str(doc["created_at"]),
        created_by=doc["created_by"],
        updated_at=doc["updated_at"],
        dispatch_logistics_kop=dispatch_logistics_kop,
        receipt_logistics_kop=receipt_logistics_kop,
        extra_income_kop=extra_income_kop,
        shipments=shipments,
        receipts=receipts,
        extra_income=extra_income,
        payments=payments,
        files=files,
        ops=ops,
    )


# ── Create ─────────────────────────────────────────────────────────────────────

@router.post("/invoices")
def create_invoice(
    body: InvoiceCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    # Счёт рождается черновиком: обязателен только клиент, остальное (отгрузки,
    # сумма, срок, файл) дозаполняется в карточке и проверяется при выставлении.
    client_id = str(body.client_id or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Укажите клиента")
    due_date = str(body.due_date or "").strip() or None

    uid = str(user["id"])
    now = _now()
    invoice_id = str(uuid4())

    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "invoice_create")
        if not proceed:
            return stored
        doc_number = next_invoice_number(conn)
        conn.execute(
            """INSERT INTO invoice_docs
               (id,doc_number,client_id,client_name,status,total_amount,paid_amount,due_date,comment,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (invoice_id, doc_number, client_id, (body.client_name or "").strip() or None,
             INVOICE_STATUS_DRAFT, int(body.total_amount), 0, due_date,
             (body.comment or "").strip() or None, now, uid),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_DOC_CREATE, "Черновик создан", now, uid),
        )
        if [s for s in body.shipment_ids if str(s or "").strip()]:
            attach_shipments(
                conn,
                invoice_id=invoice_id,
                client_id=client_id,
                shipment_ids=body.shipment_ids,
                uid=uid,
                now=now,
            )
        if [s for s in body.extra_income_ids if str(s or "").strip()]:
            attach_extra_income(
                conn,
                invoice_id=invoice_id,
                client_id=client_id,
                entry_ids=body.extra_income_ids,
                uid=uid,
                now=now,
            )
        result = {"message": invoice_id}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


# ── Lists (static routes BEFORE /invoices/{invoice_id}) ─────────────────────────

@router.get("/invoices", response_model=InvoiceListResponse)
def list_invoices(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    status:    str | None = Query(None),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    overdue:   bool = Query(False),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        items, total = list_invoices_aggregated(
            conn, page=page, limit=limit, status=status,
            client_id=client_id, search=search, overdue=overdue,
        )
    return InvoiceListResponse(
        items=[InvoiceListItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/invoices/uninvoiced-shipments", response_model=UninvoicedShipmentsResponse)
def list_uninvoiced(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        items, total = list_uninvoiced_shipments(
            conn, page=page, limit=limit, client_id=client_id,
            search=search, date_from=date_from, date_to=date_to,
        )
    return UninvoicedShipmentsResponse(
        items=[UninvoicedShipmentItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/invoices/alerts", response_model=InvoiceAlertsResponse)
def invoice_alerts(user=Depends(_get_finance)):
    with get_connection() as conn:
        counts = alerts_counts(conn)
    return InvoiceAlertsResponse(**counts)


@router.get("/invoices/shipment-contents", response_model=ShipmentContentsResponse)
def shipment_contents(shipment_ids: str = Query(""), user=Depends(_get_finance)):
    # Сводный состав по набору отгрузок (roll-up при выборе в счёт). ids — CSV.
    ids = [s.strip() for s in str(shipment_ids or "").split(",") if s.strip()]
    with get_connection() as conn:
        data = aggregate_shipment_contents(conn, ids)
        amount = suggested_amount_for_dispatches(conn, ids)
        logistics = logistics_amount_for_docs(conn, dispatch_ids=ids)
    return ShipmentContentsResponse(
        **data,
        suggested_amount_kop=amount["amount_kop"],
        logistics_amount_kop=logistics["dispatch_logistics_kop"],
        pallets_amount_kop=amount["pallets_amount_kop"],
        boxes_amount_kop=amount["boxes_amount_kop"],
        has_missing_price=amount["has_missing_price"],
        has_missing_pallet_price=amount["has_missing_pallet_price"],
        has_missing_box_price=amount["has_missing_box_price"],
    )


@router.get("/invoices/uninvoiced-receipts", response_model=UninvoicedReceiptsResponse)
def list_uninvoiced_receipt_docs(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        items, total = list_uninvoiced_receipts(
            conn, page=page, limit=limit, client_id=client_id,
            search=search, date_from=date_from, date_to=date_to,
        )
    return UninvoicedReceiptsResponse(
        items=[UninvoicedReceiptItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/invoices/uninvoiced-extra-income", response_model=UninvoicedExtraIncomeResponse)
def list_uninvoiced_extra_income_entries(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    client_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        items, total = list_uninvoiced_extra_income(
            conn, page=page, limit=limit, client_id=client_id,
            date_from=date_from, date_to=date_to,
        )
    return UninvoicedExtraIncomeResponse(
        items=[UninvoicedExtraIncomeItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/invoices/receipt-contents", response_model=ReceiptContentsResponse)
def receipt_contents(receipt_ids: str = Query(""), user=Depends(_get_finance)):
    # Сводный состав по набору поступлений + их логистика (roll-up при выборе в счёт).
    ids = [s.strip() for s in str(receipt_ids or "").split(",") if s.strip()]
    with get_connection() as conn:
        data = aggregate_receipt_contents(conn, ids)
        logistics = logistics_amount_for_docs(conn, receipt_ids=ids)
    return ReceiptContentsResponse(
        **data,
        logistics_amount_kop=logistics["receipt_logistics_kop"],
    )


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailResponse)
def get_invoice(invoice_id: str, user=Depends(_get_finance)):
    with get_connection() as conn:
        return _load_detail(conn, invoice_id)


# ── Shipments link/unlink ───────────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/shipments")
def attach_invoice_shipments(invoice_id: str, body: InvoiceAttachShipments, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, client_id FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        if not [s for s in body.shipment_ids if str(s or "").strip()]:
            raise HTTPException(status_code=400, detail="Не выбрано ни одной отгрузки")
        attach_shipments(
            conn,
            invoice_id=invoice_id,
            client_id=doc["client_id"],
            shipment_ids=body.shipment_ids,
            uid=uid,
            now=now,
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/invoices/{invoice_id}/shipments/{shipment_doc_id}")
def detach_invoice_shipment(invoice_id: str, shipment_doc_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        link = conn.execute(
            "SELECT s.id, d.doc_number FROM invoice_shipments s "
            "JOIN dispatch_docs d ON d.id = s.shipment_doc_id "
            "WHERE s.invoice_id = ? AND s.shipment_doc_id = ? AND COALESCE(s.is_deleted, 0) = 0",
            (invoice_id, shipment_doc_id),
        ).fetchone()
        if not link:
            raise HTTPException(status_code=404, detail="Отгрузка не привязана к счёту")
        conn.execute("UPDATE invoice_shipments SET is_deleted = 1 WHERE id = ?", (str(link["id"]),))
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_SHIPMENT_UNLINK,
             f"Отвязана отгрузка {link['doc_number']}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


# ── Receipts link/unlink ────────────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/receipts")
def attach_invoice_receipts(invoice_id: str, body: InvoiceAttachReceipts, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, client_id FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        if not [s for s in body.receipt_ids if str(s or "").strip()]:
            raise HTTPException(status_code=400, detail="Не выбрано ни одного поступления")
        attach_receipts(
            conn,
            invoice_id=invoice_id,
            client_id=doc["client_id"],
            receipt_ids=body.receipt_ids,
            uid=uid,
            now=now,
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/invoices/{invoice_id}/receipts/{receipt_doc_id}")
def detach_invoice_receipt(invoice_id: str, receipt_doc_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        link = conn.execute(
            "SELECT s.id, d.doc_number FROM invoice_receipts s "
            "JOIN receipt_docs d ON d.id = s.receipt_doc_id "
            "WHERE s.invoice_id = ? AND s.receipt_doc_id = ? AND COALESCE(s.is_deleted, 0) = 0",
            (invoice_id, receipt_doc_id),
        ).fetchone()
        if not link:
            raise HTTPException(status_code=404, detail="Поступление не привязано к счёту")
        conn.execute("UPDATE invoice_receipts SET is_deleted = 1 WHERE id = ?", (str(link["id"]),))
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_RECEIPT_UNLINK,
             f"Отвязано поступление {link['doc_number']}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


# ── Extra income link/unlink ────────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/extra-income")
def attach_invoice_extra_income(invoice_id: str, body: InvoiceAttachExtraIncome, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, client_id FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        if not [s for s in body.entry_ids if str(s or "").strip()]:
            raise HTTPException(status_code=400, detail="Не выбрано ни одной доп. работы")
        attach_extra_income(
            conn,
            invoice_id=invoice_id,
            client_id=doc["client_id"],
            entry_ids=body.entry_ids,
            uid=uid,
            now=now,
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/invoices/{invoice_id}/extra-income/{entry_id}")
def detach_invoice_extra_income(invoice_id: str, entry_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        link = conn.execute(
            """
            SELECT l.id, e.entry_date, e.amount_kop, c.name AS category_name
            FROM invoice_extra_income l
            JOIN extra_income_entries e ON e.id = l.entry_id
            LEFT JOIN extra_income_categories c ON c.id = e.category_id
            WHERE l.invoice_id = ? AND l.entry_id = ? AND COALESCE(l.is_deleted, 0) = 0
            """,
            (invoice_id, entry_id),
        ).fetchone()
        if not link:
            raise HTTPException(status_code=404, detail="Доп. работа не привязана к счёту")
        conn.execute("UPDATE invoice_extra_income SET is_deleted = 1 WHERE id = ?", (str(link["id"]),))
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_EXTRA_UNLINK,
             f"Отвязана доп. работа: {link['category_name'] or 'Доп. работа'} · {link['entry_date']} · "
             f"{format_kopecks(int(link['amount_kop']))}",
             now, uid),
        )
        conn.commit()
    return {"message": "ok"}


# ── Draft: правка реквизитов и выставление ───────────────────────────────────────

@router.patch("/invoices/{invoice_id}")
def update_invoice(invoice_id: str, body: InvoiceUpdate, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    fields = body.model_fields_set
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, client_id FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        if str(doc["status"]) != INVOICE_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Реквизиты можно менять только в черновике")

        sets: list[str] = []
        params: list = []
        if "client_id" in fields:
            new_client = str(body.client_id or "").strip()
            if not new_client:
                raise HTTPException(status_code=400, detail="Укажите клиента")
            if new_client != str(doc["client_id"] or ""):
                linked = conn.execute(
                    "SELECT 1 FROM invoice_shipments WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0 "
                    "UNION ALL "
                    "SELECT 1 FROM invoice_receipts WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0 "
                    "UNION ALL "
                    "SELECT 1 FROM invoice_extra_income WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
                    (invoice_id, invoice_id, invoice_id),
                ).fetchone()
                if linked:
                    raise HTTPException(
                        status_code=400,
                        detail="Сначала отвяжите отгрузки, поступления и доп. работы прежнего клиента",
                    )
            sets.append("client_id = ?"); params.append(new_client)
        if "client_name" in fields:
            sets.append("client_name = ?"); params.append((body.client_name or "").strip() or None)
        if "due_date" in fields:
            sets.append("due_date = ?"); params.append(str(body.due_date or "").strip() or None)
        if "total_amount" in fields and body.total_amount is not None:
            sets.append("total_amount = ?"); params.append(int(body.total_amount))
        if "comment" in fields:
            sets.append("comment = ?"); params.append((body.comment or "").strip() or None)

        if not sets:
            return {"message": "ok"}

        sets.append("updated_at = ?"); params.append(now)
        params.append(invoice_id)
        conn.execute(f"UPDATE invoice_docs SET {', '.join(sets)} WHERE id = ?", params)
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_DOC_UPDATE, "Изменены реквизиты черновика", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/invoices/{invoice_id}/issue")
def issue_invoice(
    invoice_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "invoice_issue", response={"message": INVOICE_STATUS_ISSUED})
        if not proceed:
            return stored
        doc = conn.execute(
            "SELECT status, total_amount, due_date FROM invoice_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        if str(doc["status"]) != INVOICE_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Выставить можно только черновик")
        if int(doc["total_amount"]) <= 0:
            raise HTTPException(status_code=400, detail="Укажите сумму счёта")
        if not str(doc["due_date"] or "").strip():
            raise HTTPException(status_code=400, detail="Укажите плановую дату расчёта")
        n_ship = int(conn.execute(
            "SELECT COUNT(*) AS n FROM invoice_shipments "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()["n"])
        n_rec = int(conn.execute(
            "SELECT COUNT(*) AS n FROM invoice_receipts "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()["n"])
        n_extra = int(conn.execute(
            "SELECT COUNT(*) AS n FROM invoice_extra_income "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()["n"])
        if n_ship == 0 and n_rec == 0 and n_extra == 0:
            raise HTTPException(
                status_code=400,
                detail="Добавьте хотя бы одну отгрузку, поступление или доп. работу",
            )
        n_files = int(conn.execute(
            "SELECT COUNT(*) AS n FROM invoice_files "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()["n"])
        if n_files == 0:
            raise HTTPException(status_code=400, detail="Прикрепите файл счёта (например, расчёт Excel)")

        conn.execute(
            "UPDATE invoice_docs SET status = ?, updated_at = ? WHERE id = ?",
            (INVOICE_STATUS_ISSUED, now, invoice_id),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_ISSUE, "Счёт выставлен", now, uid),
        )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": INVOICE_STATUS_ISSUED}


# ── Payments / due date / close / cancel ────────────────────────────────────────

@router.post("/invoices/{invoice_id}/payments")
def add_payment(
    invoice_id: str,
    body: InvoicePaymentCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "invoice_payment", response={"message": "ok"})
        if not proceed:
            return stored
        doc = conn.execute(
            "SELECT status, total_amount, paid_amount FROM invoice_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0 FOR UPDATE",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_active(doc)
        paid_on = str(body.paid_on or "").strip()
        if not paid_on:
            raise HTTPException(status_code=400, detail="Укажите дату оплаты")
        remaining = int(doc["total_amount"]) - int(doc["paid_amount"])
        if int(body.amount) > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Оплата превышает остаток по счёту ({format_kopecks(max(0, remaining))})",
            )
        conn.execute(
            "INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, int(body.amount),
             paid_on, (body.comment or "").strip() or None, now, uid),
        )
        # Полностью оплаченный счёт остаётся «частично оплачен» до явного POST /close
        # (ручное подтверждение менеджером) — это намеренный гейт, см. test_payment_then_close.
        paid = recompute_paid(conn, invoice_id)
        # Полная оплата сразу закрывает счёт — иначе он остаётся «частично оплачен»
        # (активный) до ручного /close и попадает в просрочку по due_date.
        fully_paid = paid >= int(doc["total_amount"])
        new_status = INVOICE_STATUS_CLOSED if fully_paid else INVOICE_STATUS_PARTIALLY_PAID
        conn.execute(
            "UPDATE invoice_docs SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?",
            (paid, new_status, now, invoice_id),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_PAYMENT,
             f"Оплата {format_kopecks(int(body.amount))}", now, uid),
        )
        if fully_paid:
            conn.execute(
                "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
                "VALUES (?,?,?,?,?,?)",
                (str(uuid4()), invoice_id, INVOICE_OP_CLOSE,
                 "Счёт завершён (оплачен полностью)", now, uid),
            )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": "ok"}


@router.patch("/invoices/{invoice_id}/due-date")
def update_due_date(invoice_id: str, body: InvoiceDueDateUpdate, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    new_date = str(body.due_date or "").strip()
    if not new_date:
        raise HTTPException(status_code=400, detail="Укажите новую плановую дату расчёта")
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, due_date FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_active(doc)
        old_date = doc["due_date"] or "—"
        reason = str(body.reason or "").strip()
        comment = f"Срок: {old_date} → {new_date}"
        if reason:
            comment += f". Причина: {reason}"
        conn.execute(
            "UPDATE invoice_docs SET due_date = ?, updated_at = ? WHERE id = ?",
            (new_date, now, invoice_id),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_DUE_DATE_CHANGE, comment, now, uid),
        )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": "ok"}


@router.patch("/invoices/{invoice_id}/amount")
def update_amount(invoice_id: str, body: InvoiceAmountUpdate, user=Depends(_get_finance)):
    # Корректировка суммы уже выставленного счёта (клиент оспорил и прав). Правка
    # «на месте» с обязательной причиной — журнал invoice_ops служит аудитом.
    # Опустить сумму ниже уже оплаченной нельзя: возвратов/кредит-ноты в модели нет.
    uid = str(user["id"])
    now = _now()
    reason = str(body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину корректировки суммы")
    new_amount = int(body.total_amount)
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status, total_amount, paid_amount FROM invoice_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_active(doc)
        paid = int(doc["paid_amount"])
        if new_amount < paid:
            raise HTTPException(
                status_code=400,
                detail=f"Скорректированная сумма меньше уже оплаченной ({format_kopecks(paid)}). "
                       "Сначала оформите возврат.",
            )
        old_amount = int(doc["total_amount"])
        if new_amount == old_amount:
            return {"message": "ok"}
        conn.execute(
            "UPDATE invoice_docs SET total_amount = ?, updated_at = ? WHERE id = ?",
            (new_amount, now, invoice_id),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_AMOUNT_CHANGE,
             f"Сумма: {format_kopecks(old_amount)} → {format_kopecks(new_amount)}. Причина: {reason}",
             now, uid),
        )
        # Если коррекция опустила сумму ровно до уже оплаченной — счёт полностью
        # оплачен и должен закрыться (иначе остался бы активным и попал в просрочку).
        if new_amount > 0 and paid >= new_amount:
            conn.execute(
                "UPDATE invoice_docs SET status = ?, updated_at = ? WHERE id = ?",
                (INVOICE_STATUS_CLOSED, now, invoice_id),
            )
            conn.execute(
                "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
                "VALUES (?,?,?,?,?,?)",
                (str(uuid4()), invoice_id, INVOICE_OP_CLOSE,
                 "Счёт завершён (оплачен полностью)", now, uid),
            )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": "ok"}


@router.post("/invoices/{invoice_id}/close")
def close_invoice(
    invoice_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "invoice_close", response={"message": INVOICE_STATUS_CLOSED})
        if not proceed:
            return stored
        doc = conn.execute(
            "SELECT status, total_amount, paid_amount FROM invoice_docs "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_active(doc)
        if int(doc["paid_amount"]) < int(doc["total_amount"]):
            raise HTTPException(status_code=400, detail="Счёт оплачен не полностью")
        conn.execute(
            "UPDATE invoice_docs SET status = ?, updated_at = ? WHERE id = ?",
            (INVOICE_STATUS_CLOSED, now, invoice_id),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_CLOSE, "Счёт завершён (оплачен)", now, uid),
        )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": INVOICE_STATUS_CLOSED}


@router.post("/invoices/{invoice_id}/cancel")
def cancel_invoice(
    invoice_id: str,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "invoice_cancel", response={"message": INVOICE_STATUS_CANCELLED})
        if not proceed:
            return stored
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0 FOR UPDATE",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        _require_mutable(doc)
        # Сторнируем платежи, иначе деньги «повиснут» оплаченными на аннулированном счёте.
        reversed_paid = recompute_paid(conn, invoice_id)
        conn.execute(
            "UPDATE invoice_payments SET is_deleted = 1 "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        )
        # Освобождаем отгрузки и поступления — снова попадают в реестр «без счёта».
        conn.execute(
            "UPDATE invoice_shipments SET is_deleted = 1 "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        )
        conn.execute(
            "UPDATE invoice_receipts SET is_deleted = 1 "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        )
        conn.execute(
            "UPDATE invoice_extra_income SET is_deleted = 1 "
            "WHERE invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        )
        conn.execute(
            "UPDATE invoice_docs SET status = ?, paid_amount = 0, updated_at = ? WHERE id = ?",
            (INVOICE_STATUS_CANCELLED, now, invoice_id),
        )
        cancel_comment = "Счёт аннулирован"
        if reversed_paid > 0:
            cancel_comment += f". Сторнированы платежи на {format_kopecks(reversed_paid)}"
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_CANCEL, cancel_comment, now, uid),
        )
        conn.commit()
    invalidate_alerts_cache()
    return {"message": INVOICE_STATUS_CANCELLED}


# ── Files ───────────────────────────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/files")
async def upload_invoice_file(
    invoice_id: str,
    file: UploadFile = File(...),
    user=Depends(_get_finance),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_INVOICE_FILE_EXTS:
        raise HTTPException(status_code=400, detail="Допустимы файлы: xlsx, xls, pdf, png, jpg, jpeg")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")

    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        if str(doc["status"]) == INVOICE_STATUS_CANCELLED:
            raise HTTPException(status_code=400, detail="Нельзя менять файлы у аннулированного счёта")

        saved_filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / saved_filename
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)

        file_id = str(uuid4())
        url = f"/uploads/{saved_filename}"
        conn.execute(
            "INSERT INTO invoice_files (id,invoice_id,filename,url,mime_type,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?)",
            (file_id, invoice_id, file.filename, url, file.content_type or None, now, uid),
        )
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_DOC_UPDATE, f"Прикреплён файл {file.filename}", now, uid),
        )
        conn.commit()
    return {"message": file_id}


@router.delete("/invoices/{invoice_id}/files/{file_id}")
def delete_invoice_file(invoice_id: str, file_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    now = _now()
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT status FROM invoice_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (invoice_id,),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        if str(doc["status"]) == INVOICE_STATUS_CANCELLED:
            raise HTTPException(status_code=400, detail="Нельзя менять файлы у аннулированного счёта")
        row = conn.execute(
            "SELECT filename FROM invoice_files WHERE id = ? AND invoice_id = ? AND COALESCE(is_deleted, 0) = 0",
            (file_id, invoice_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Файл не найден")
        conn.execute("UPDATE invoice_files SET is_deleted = 1 WHERE id = ?", (file_id,))
        conn.execute(
            "INSERT INTO invoice_ops (id,invoice_id,op_type,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid4()), invoice_id, INVOICE_OP_DOC_UPDATE, f"Удалён файл {row['filename']}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}
