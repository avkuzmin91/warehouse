from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    MARKETPLACES,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_ACCOUNT_STATUSES,
    MP_LINK_SOURCE_MANUAL,
    MP_ORDER_STATUSES,
    MP_OZON,
    MP_SYNC_KIND_CATALOG,
    MP_SYNC_KIND_ORDERS,
    MP_SYNC_KIND_STOCKS,
    MP_WB,
)
from dbconn import get_connection
from modules.auth.service import get_current_user
from security import ensure_marketplace_access

from .clients import MpApiError
from .schemas import (
    MessageResponse,
    MpAccountCreate,
    MpAccountItem,
    MpAccountsResponse,
    MpAccountUpdate,
    MpLinkRequest,
    MpOrderDetailResponse,
    MpOrderLine,
    MpOrderListItem,
    MpOrdersResponse,
    MpOrdersSummaryResponse,
    MpProductItem,
    MpProductsResponse,
    MpStockReportResponse,
    MpStockRow,
    MpWarehouseItem,
    MpWarehousesResponse,
    SyncStatsResponse,
)
from .service import (
    MpStockNotConfigured,
    auto_link_by_barcode,
    check_account,
    link_mp_product,
    list_mp_products,
    list_orders,
    list_warehouses,
    order_detail,
    orders_summary,
    push_account_stocks,
    stock_report,
    sync_account_catalog,
    sync_account_orders,
    sync_account_warehouses,
    unlink_mp_product,
    write_sync_log,
)

router = APIRouter(tags=["marketplaces"])


def _get_mp_manager(user=Depends(get_current_user)):
    ensure_marketplace_access(user)
    return user


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _mask(raw: str | None) -> str:
    s = str(raw or "")
    if not s:
        return ""
    return f"****{s[-4:]}" if len(s) > 4 else "****"


def _load_account(conn, account_id: str):
    row = conn.execute(
        "SELECT * FROM mp_accounts WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (account_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    return row


def _account_item(row, client_name: str | None, warehouse_name: str | None = None) -> MpAccountItem:
    return MpAccountItem(
        id=str(row["id"]),
        client_id=str(row["client_id"]),
        client_name=client_name,
        marketplace=str(row["marketplace"]),
        name=str(row["name"]),
        ozon_client_id_masked=(_mask(row["ozon_client_id"]) if row["ozon_client_id"] else None),
        api_key_masked=_mask(row["api_key"]),
        status=str(row["status"]),
        last_sync_at=row["last_sync_at"],
        last_sync_error=row["last_sync_error"],
        stock_sync_enabled=bool(row["stock_sync_enabled"]),
        stock_warehouse_id=row["stock_warehouse_id"],
        stock_warehouse_name=warehouse_name,
        last_stock_push_at=row["last_stock_push_at"],
        last_stock_push_error=row["last_stock_push_error"],
        created_at=str(row["created_at"]),
    )


# ── Подключения кабинетов (менеджерский состав) ───────────────────────────────

@router.get("/marketplaces/accounts", response_model=MpAccountsResponse)
def list_accounts(user=Depends(_get_mp_manager)):
    """Список подключений; ключи в ответе всегда маскированы."""
    _ = user
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT a.*, c.name AS client_name, w.name AS warehouse_name FROM mp_accounts a "
            "LEFT JOIN clients c ON c.id = a.client_id "
            "LEFT JOIN mp_warehouses w ON w.account_id = a.id AND w.external_id = a.stock_warehouse_id "
            "WHERE COALESCE(a.is_deleted, 0) = 0 ORDER BY a.created_at ASC",
        ).fetchall()
    return MpAccountsResponse(
        items=[_account_item(r, r["client_name"], r["warehouse_name"]) for r in rows]
    )


@router.post("/marketplaces/accounts", response_model=MessageResponse)
def create_account(payload: MpAccountCreate, user=Depends(_get_mp_manager)):
    uid = str(user["id"])
    marketplace = str(payload.marketplace or "").strip()
    if marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail="Укажите маркетплейс (ozon или wb)")
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название подключения")
    api_key = str(payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Укажите API-ключ")
    ozon_client_id = str(payload.ozon_client_id or "").strip() or None
    if marketplace == MP_OZON and not ozon_client_id:
        raise HTTPException(status_code=400, detail="Для Ozon укажите Client-Id")

    account = {
        "id": str(uuid4()),
        "client_id": str(payload.client_id),
        "marketplace": marketplace,
        "name": name,
        "ozon_client_id": ozon_client_id,
        "api_key": api_key,
    }
    try:
        check_account(account)
    except MpApiError as exc:
        raise HTTPException(status_code=400, detail=f"Не удалось подключиться: {exc}") from exc

    with get_connection() as conn:
        client = conn.execute(
            "SELECT id FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (payload.client_id,),
        ).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        conn.execute(
            "INSERT INTO mp_accounts (id, client_id, marketplace, name, ozon_client_id, "
            "api_key, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
            (account["id"], account["client_id"], marketplace, name, ozon_client_id,
             api_key, MP_ACCOUNT_STATUS_ACTIVE, _now(), uid),
        )
        row = _load_account(conn, account["id"])
        try:
            sync_account_catalog(conn, row)
        except MpApiError as exc:
            # Кабинет подключён, но каталог не дотянулся — фиксируем, синк повторит.
            conn.execute(
                "UPDATE mp_accounts SET last_sync_error = ? WHERE id = ?",
                (str(exc)[:500], account["id"]),
            )
            write_sync_log(conn, account["id"], MP_SYNC_KIND_CATALOG, ok=False, error=str(exc)[:500])
        conn.commit()
    return MessageResponse(message=account["id"])


def _validate_stock_settings(conn, row, payload: MpAccountUpdate) -> None:
    """Выгрузка остатков пока только для WB и только на существующий склад продавца."""
    if str(row["marketplace"]) != MP_WB:
        raise HTTPException(
            status_code=400, detail="Выгрузка остатков поддержана только для Wildberries",
        )
    warehouse_id = (
        payload.stock_warehouse_id.strip()
        if payload.stock_warehouse_id is not None
        else str(row["stock_warehouse_id"] or "")
    )
    if payload.stock_sync_enabled and not warehouse_id:
        raise HTTPException(status_code=400, detail="Выберите склад маркетплейса")
    if warehouse_id:
        exists = conn.execute(
            "SELECT id FROM mp_warehouses WHERE account_id = ? AND external_id = ?",
            (str(row["id"]), warehouse_id),
        ).fetchone()
        if not exists:
            raise HTTPException(
                status_code=400,
                detail="Склад не найден — обновите список складов маркетплейса",
            )


@router.patch("/marketplaces/accounts/{account_id}", response_model=MessageResponse)
def update_account(account_id: str, payload: MpAccountUpdate, user=Depends(_get_mp_manager)):
    _ = user
    sets: list[str] = []
    params: list = []
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Название не может быть пустым")
        sets.append("name = ?")
        params.append(name)
    if payload.status is not None:
        if payload.status not in MP_ACCOUNT_STATUSES:
            raise HTTPException(status_code=400, detail="Недопустимый статус подключения")
        sets.append("status = ?")
        params.append(payload.status)
    if payload.api_key is not None and payload.api_key.strip():
        sets.append("api_key = ?")
        params.append(payload.api_key.strip())
    if payload.ozon_client_id is not None and payload.ozon_client_id.strip():
        sets.append("ozon_client_id = ?")
        params.append(payload.ozon_client_id.strip())
    if payload.stock_warehouse_id is not None:
        sets.append("stock_warehouse_id = ?")
        params.append(payload.stock_warehouse_id.strip() or None)
    if payload.stock_sync_enabled is not None:
        sets.append("stock_sync_enabled = ?")
        params.append(1 if payload.stock_sync_enabled else 0)
    if not sets:
        raise HTTPException(status_code=400, detail="Нет изменений")
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        if payload.stock_warehouse_id is not None or payload.stock_sync_enabled:
            _validate_stock_settings(conn, row, payload)
        conn.execute(
            f"UPDATE mp_accounts SET {', '.join(sets)} WHERE id = ?",
            [*params, account_id],
        )
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/marketplaces/accounts/{account_id}", response_model=MessageResponse)
def delete_account(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        _load_account(conn, account_id)
        conn.execute("UPDATE mp_accounts SET is_deleted = 1 WHERE id = ?", (account_id,))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/accounts/{account_id}/check", response_model=MessageResponse)
def check_account_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
    try:
        check_account(row)
    except MpApiError as exc:
        raise HTTPException(status_code=400, detail=f"Не удалось подключиться: {exc}") from exc
    return MessageResponse(message="ok")


@router.post("/marketplaces/accounts/{account_id}/sync-catalog", response_model=SyncStatsResponse)
def sync_catalog_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        try:
            stats = sync_account_catalog(conn, row)
        except MpApiError as exc:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Синхронизация не удалась: {exc}") from exc
        conn.commit()
    return SyncStatsResponse(message="ok", stats=stats)


@router.post("/marketplaces/accounts/{account_id}/sync-orders", response_model=SyncStatsResponse)
def sync_orders_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        try:
            stats = sync_account_orders(conn, row)
        except MpApiError as exc:
            conn.rollback()
            conn.execute(
                "UPDATE mp_accounts SET last_sync_error = ? WHERE id = ?",
                (str(exc)[:500], account_id),
            )
            write_sync_log(conn, account_id, MP_SYNC_KIND_ORDERS, ok=False, error=str(exc)[:500])
            conn.commit()
            raise HTTPException(status_code=400, detail=f"Синхронизация не удалась: {exc}") from exc
        conn.commit()
    return SyncStatsResponse(message="ok", stats=stats)


@router.post("/marketplaces/accounts/{account_id}/auto-link", response_model=SyncStatsResponse)
def auto_link_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        linked = auto_link_by_barcode(conn, row)
        conn.commit()
    return SyncStatsResponse(message="ok", stats={"auto_linked": linked})


# ── Остатки: склады МП, выгрузка, сверка ──────────────────────────────────────

@router.post("/marketplaces/accounts/{account_id}/sync-warehouses", response_model=SyncStatsResponse)
def sync_warehouses_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    """Обновить справочник складов продавца на стороне МП."""
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        try:
            stats = sync_account_warehouses(conn, row)
        except MpStockNotConfigured as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except MpApiError as exc:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Не удалось получить склады: {exc}") from exc
        conn.commit()
    return SyncStatsResponse(message="ok", stats=stats)


@router.get("/marketplaces/accounts/{account_id}/warehouses", response_model=MpWarehousesResponse)
def list_warehouses_endpoint(account_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        _load_account(conn, account_id)
        items = list_warehouses(conn, account_id)
    return MpWarehousesResponse(items=[MpWarehouseItem(**item) for item in items])


@router.post("/marketplaces/accounts/{account_id}/push-stocks", response_model=SyncStatsResponse)
def push_stocks_endpoint(
    account_id: str,
    user=Depends(_get_mp_manager),
    full: bool = Query(False, description="Выгрузить весь каталог, а не только изменения"),
):
    """Выгрузить остатки в МП вручную — не дожидаясь фонового цикла."""
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        try:
            stats = push_account_stocks(conn, row, full=full)
        except MpStockNotConfigured as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except MpApiError as exc:
            conn.rollback()
            conn.execute(
                "UPDATE mp_accounts SET last_stock_push_error = ? WHERE id = ?",
                (str(exc)[:500], account_id),
            )
            write_sync_log(conn, account_id, MP_SYNC_KIND_STOCKS, ok=False, error=str(exc)[:500])
            conn.commit()
            raise HTTPException(status_code=400, detail=f"Выгрузка не удалась: {exc}") from exc
        conn.commit()
    return SyncStatsResponse(message="ok", stats=stats)


@router.get("/marketplaces/accounts/{account_id}/stocks", response_model=MpStockReportResponse)
def stock_report_endpoint(
    account_id: str,
    user=Depends(_get_mp_manager),
    only_diff: bool = Query(False),
    search: str | None = Query(None),
    with_marketplace: bool = Query(True, description="Запросить фактические остатки у МП"),
):
    """Сверка «наш расчёт ↔ выгружено ↔ факт МП» по карточкам кабинета."""
    _ = user
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        data = stock_report(
            conn, row, only_diff=only_diff, search=search, with_marketplace=with_marketplace,
        )
    return MpStockReportResponse(
        items=[MpStockRow(**item) for item in data["items"]],
        total=data["total"],
        marketplace_error=data["marketplace_error"],
        checked_at=data["checked_at"],
    )


# ── Заказы (менеджерский состав) ──────────────────────────────────────────────

@router.get("/marketplaces/orders", response_model=MpOrdersResponse)
def list_orders_endpoint(
    user=Depends(_get_mp_manager),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    account_id: str | None = Query(None),
    client_id: str | None = Query(None),
    marketplace: str | None = Query(None),
    status: str | None = Query(None),
    overdue: bool = Query(False),
    search: str | None = Query(None),
):
    _ = user
    if status and status not in MP_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Недопустимый статус заказа")
    if marketplace and marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail="Недопустимый маркетплейс")
    with get_connection() as conn:
        data = list_orders(
            conn, page=page, limit=limit, account_id=account_id, client_id=client_id,
            marketplace=marketplace, status=status, overdue=overdue, search=search,
        )
    return MpOrdersResponse(
        items=[MpOrderListItem(**item) for item in data["items"]],
        total=data["total"], page=data["page"], limit=data["limit"],
    )


@router.get("/marketplaces/orders/summary", response_model=MpOrdersSummaryResponse)
def orders_summary_endpoint(
    user=Depends(_get_mp_manager),
    account_id: str | None = Query(None),
    client_id: str | None = Query(None),
    marketplace: str | None = Query(None),
    search: str | None = Query(None),
):
    _ = user
    with get_connection() as conn:
        data = orders_summary(
            conn, account_id=account_id, client_id=client_id,
            marketplace=marketplace, search=search,
        )
    return MpOrdersSummaryResponse(**data)


@router.get("/marketplaces/orders/{order_id}", response_model=MpOrderDetailResponse)
def order_detail_endpoint(order_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        data = order_detail(conn, order_id)
    if not data:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return MpOrderDetailResponse(
        doc=MpOrderListItem(**data["doc"]),
        lines=[MpOrderLine(**line) for line in data["lines"]],
    )


# ── Карточки МП и связка товаров ──────────────────────────────────────────────

@router.get("/marketplaces/products", response_model=MpProductsResponse)
def list_products_endpoint(
    user=Depends(_get_mp_manager),
    account_id: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    linked: str = Query("all"),
    search: str | None = Query(None),
):
    _ = user
    if linked not in ("all", "linked", "unlinked"):
        raise HTTPException(status_code=400, detail="Недопустимый фильтр связки")
    with get_connection() as conn:
        account = _load_account(conn, account_id)
        data = list_mp_products(conn, account, page=page, limit=limit, linked=linked, search=search)
    return MpProductsResponse(
        items=[MpProductItem(**item) for item in data["items"]],
        total=data["total"], page=data["page"], limit=data["limit"],
    )


@router.post("/marketplaces/products/{mp_product_id}/link", response_model=MessageResponse)
def link_product_endpoint(mp_product_id: str, payload: MpLinkRequest, user=Depends(_get_mp_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        link_mp_product(
            conn, mp_product_id,
            product_id=payload.product_id, variant_id=payload.variant_id,
            user_id=uid, source=MP_LINK_SOURCE_MANUAL,
        )
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/marketplaces/products/{mp_product_id}/link", response_model=MessageResponse)
def unlink_product_endpoint(mp_product_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        if not unlink_mp_product(conn, mp_product_id):
            raise HTTPException(status_code=404, detail="Связка не найдена")
        conn.commit()
    return MessageResponse(message="ok")
