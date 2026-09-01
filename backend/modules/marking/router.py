from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import get_current_stock_operator
from modules.marking.schemas import (
    MarkingCodeListResponse,
    MarkingScanCreate,
    MarkingScanResponse,
)
from modules.marking.service import (
    find_active_by_sgtin,
    list_codes,
    parse_cis,
    save_scanned_code,
)

router = APIRouter(tags=["marking"])


@router.post("/marking/codes", response_model=MarkingScanResponse)
def scan_marking_code(
    payload: MarkingScanCreate,
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_stock_operator),
):
    """Зарегистрировать отсканированный КИЗ.

    Повторный скан того же кода не ошибка процесса, а рабочий сигнал оператору:
    отвечаем status=duplicate и прежней записью, чтобы на экране было видно,
    когда и кто уже отсканировал эту единицу.
    """
    uid = str(user["id"])
    raw = payload.raw
    parsed = parse_cis(raw)
    if not parsed:
        raise HTTPException(status_code=400, detail="Это не код маркировки «Честный знак»")

    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, uid, "marking_scan")
        if not proceed:
            return stored

        existing = find_active_by_sgtin(conn, parsed["gtin"], parsed["serial"])
        if existing:
            result = {"status": "duplicate", "code": existing}
        else:
            result = {"status": "saved", "code": save_scanned_code(conn, raw, parsed, uid)}

        finish_idempotent(conn, x_request_id, result)
        conn.commit()
    return result


@router.get("/marking/codes", response_model=MarkingCodeListResponse)
def get_marking_codes(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user=Depends(get_current_stock_operator),
):
    _ = user
    with get_connection() as conn:
        return list_codes(
            conn,
            page=page,
            limit=limit,
            client_id=(client_id or "").strip() or None,
            search=(search or "").strip() or None,
        )
