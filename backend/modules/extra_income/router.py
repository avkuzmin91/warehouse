from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from psycopg import IntegrityError

from config import (
    EXTRA_INCOME_OP_CREATE,
    EXTRA_INCOME_OP_DELETE,
    EXTRA_INCOME_OP_UPDATE,
)
from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import get_current_manager
from modules.expenses.service import format_kopecks, validate_date
from modules.extra_income.schemas import (
    ExtraIncomeCreate,
    ExtraIncomeDictCreate,
    ExtraIncomeDictItem,
    ExtraIncomeDictUpdate,
    ExtraIncomeListItem,
    ExtraIncomeListResponse,
    ExtraIncomeSummaryResponse,
    ExtraIncomeUpdate,
    MessageResponse,
)
from modules.extra_income.service import (
    active_invoice_link,
    entries_summary,
    journal,
    list_entries_aggregated,
    resolve_category,
    resolve_client,
)
from security import ensure_finance_access
from utils import now_iso as _now

router = APIRouter(tags=["extra_income"])


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


def _parse_invoiced(raw: str | None) -> bool | None:
    if raw is None or not str(raw).strip():
        return None
    v = str(raw).strip().lower()
    if v in ("1", "true", "yes"):
        return True
    if v in ("0", "false", "no"):
        return False
    raise HTTPException(status_code=400, detail="Фильтр «в счёте»: 1 или 0")


# ── Список / сводка ─────────────────────────────────────────────────────────────

@router.get("/extra-income", response_model=ExtraIncomeListResponse)
def list_extra_income(
    page:        int = Query(1, ge=1),
    limit:       int = Query(25, ge=1, le=200),
    search:      str | None = Query(None),
    client_id:   str | None = Query(None),
    category_id: str | None = Query(None),
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    invoiced:    str | None = Query(None),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        items, total = list_entries_aggregated(
            conn, page=page, limit=limit, search=search, client_id=client_id,
            category_id=category_id, date_from=date_from, date_to=date_to,
            invoiced=_parse_invoiced(invoiced),
        )
    return ExtraIncomeListResponse(
        items=[ExtraIncomeListItem(**it) for it in items], total=total, page=page, limit=limit,
    )


@router.get("/extra-income/summary", response_model=ExtraIncomeSummaryResponse)
def extra_income_summary(
    search:      str | None = Query(None),
    client_id:   str | None = Query(None),
    category_id: str | None = Query(None),
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    user=Depends(_get_finance),
):
    with get_connection() as conn:
        data = entries_summary(
            conn, search=search, client_id=client_id, category_id=category_id,
            date_from=date_from, date_to=date_to,
        )
    return ExtraIncomeSummaryResponse(**data)


# ── Справочник видов работ ──────────────────────────────────────────────────────

@router.get("/extra-income/categories", response_model=list[ExtraIncomeDictItem])
def list_categories(user=Depends(_get_finance)):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name FROM extra_income_categories WHERE COALESCE(is_deleted, 0) = 0 "
            "ORDER BY sort_order ASC, LOWER(name) ASC"
        ).fetchall()
    return [ExtraIncomeDictItem(id=str(r["id"]), name=str(r["name"])) for r in rows]


@router.post("/extra-income/categories", response_model=MessageResponse)
def create_category(body: ExtraIncomeDictCreate, user=Depends(_get_finance)):
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название")
    new_id = str(uuid4())
    with get_connection() as conn:
        max_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) AS m FROM extra_income_categories"
        ).fetchone()
        try:
            conn.execute(
                "INSERT INTO extra_income_categories (id,name,sort_order,created_at,created_by) "
                "VALUES (?,?,?,?,?)",
                (new_id, name, int(max_row["m"]) + 1, _now(), str(user["id"])),
            )
            conn.commit()
        except IntegrityError as exc:
            raise HTTPException(status_code=400, detail="Вид работы с таким названием уже есть") from exc
    return MessageResponse(message=new_id)


@router.patch("/extra-income/categories/{item_id}", response_model=MessageResponse)
def update_category(item_id: str, body: ExtraIncomeDictUpdate, user=Depends(_get_finance)):
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM extra_income_categories WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Вид работы не найден")
        try:
            conn.execute(
                "UPDATE extra_income_categories SET name = ?, updated_at = ? WHERE id = ?",
                (name, _now(), item_id),
            )
            conn.commit()
        except IntegrityError as exc:
            raise HTTPException(status_code=400, detail="Вид работы с таким названием уже есть") from exc
    return MessageResponse(message="ok")


@router.delete("/extra-income/categories/{item_id}", response_model=MessageResponse)
def delete_category(item_id: str, user=Depends(_get_finance)):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM extra_income_categories WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Вид работы не найден")
        conn.execute(
            "UPDATE extra_income_categories SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (_now(), item_id),
        )
        conn.commit()
    return MessageResponse(message="ok")


# ── Записи ──────────────────────────────────────────────────────────────────────

@router.post("/extra-income", response_model=MessageResponse)
def create_extra_income(
    body: ExtraIncomeCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(_get_finance),
):
    uid = str(user["id"])
    entry_date = validate_date(body.entry_date)
    entry_id = str(uuid4())
    now = _now()
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "extra_income_create")
        if not proceed:
            return stored
        client_name = resolve_client(conn, body.client_id)
        cat_name = resolve_category(conn, body.category_id)
        qty = int(body.qty) if body.qty else None
        conn.execute(
            """INSERT INTO extra_income_entries
               (id,entry_date,client_id,category_id,qty,amount_kop,comment,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (entry_id, entry_date, body.client_id.strip(), body.category_id.strip(),
             qty, int(body.amount_kop), (body.comment or "").strip() or None, now, uid),
        )
        bits = [cat_name, client_name]
        if qty:
            bits.append(f"{qty} шт.")
        bits.append(format_kopecks(int(body.amount_kop)))
        journal(conn, entry_id, EXTRA_INCOME_OP_CREATE,
                f"Заведено ({entry_date}): " + " · ".join(bits), uid)
        result = {"message": entry_id}
        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return MessageResponse(**result)


def _load_entry(conn, entry_id: str):
    row = conn.execute(
        "SELECT * FROM extra_income_entries WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (entry_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return row


def _require_not_invoiced(conn, entry_id: str) -> None:
    link = active_invoice_link(conn, entry_id)
    if link:
        raise HTTPException(
            status_code=400,
            detail=f"Запись входит в счёт {link['invoice_number']} — сначала отвяжите её от счёта",
        )


@router.patch("/extra-income/{entry_id}", response_model=MessageResponse)
def update_extra_income(entry_id: str, body: ExtraIncomeUpdate, user=Depends(_get_finance)):
    uid = str(user["id"])
    entry_date = validate_date(body.entry_date)
    with get_connection() as conn:
        old = _load_entry(conn, entry_id)
        _require_not_invoiced(conn, entry_id)
        client_name = resolve_client(conn, body.client_id)
        cat_name = resolve_category(conn, body.category_id)
        qty = int(body.qty) if body.qty else None
        conn.execute(
            """UPDATE extra_income_entries
               SET entry_date = ?, client_id = ?, category_id = ?, qty = ?,
                   amount_kop = ?, comment = ?, updated_at = ?
               WHERE id = ?""",
            (entry_date, body.client_id.strip(), body.category_id.strip(), qty,
             int(body.amount_kop), (body.comment or "").strip() or None, _now(), entry_id),
        )
        changes: list[str] = []
        if str(old["entry_date"]) != entry_date:
            changes.append(f"дата: {old['entry_date']} → {entry_date}")
        if int(old["amount_kop"]) != int(body.amount_kop):
            changes.append(
                f"сумма: {format_kopecks(int(old['amount_kop']))} → {format_kopecks(int(body.amount_kop))}"
            )
        summary = "; ".join(changes) if changes else f"{cat_name} · {client_name}"
        journal(conn, entry_id, EXTRA_INCOME_OP_UPDATE, f"Изменено: {summary}", uid)
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/extra-income/{entry_id}", response_model=MessageResponse)
def delete_extra_income(entry_id: str, user=Depends(_get_finance)):
    uid = str(user["id"])
    with get_connection() as conn:
        old = _load_entry(conn, entry_id)
        _require_not_invoiced(conn, entry_id)
        conn.execute(
            "UPDATE extra_income_entries SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (_now(), entry_id),
        )
        journal(conn, entry_id, EXTRA_INCOME_OP_DELETE,
                f"Удалено ({old['entry_date']}, {format_kopecks(int(old['amount_kop']))})", uid)
        conn.commit()
    return MessageResponse(message="ok")
