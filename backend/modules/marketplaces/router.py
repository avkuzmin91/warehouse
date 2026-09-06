from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from config import (
    MARKETPLACES,
    MP_ACCOUNT_STATUS_ACTIVE,
    MP_ACCOUNT_STATUSES,
    MP_LINK_SOURCE_MANUAL,
    MP_ORDER_STATUSES,
    MP_OZON,
    MP_SUPPLY_STATUS_HANDOVER,
    MP_SUPPLY_STATUS_PACKING,
    MP_SUPPLY_STATUS_PICKING,
    MP_SYNC_KIND_CATALOG,
    MP_SYNC_KIND_ORDERS,
)
from dbconn import get_connection
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import (
    get_current_admin,
    get_current_supply_picker,
    get_current_supply_worker,
    get_current_user,
)
from security import ensure_marketplace_access

from .clients import MpApiError
from .schemas import (
    MessageResponse,
    MpCargoCreateRequest,
    MpCargoLabel,
    MpCargoLabelsResponse,
    MpCargoLookupResponse,
    MpCargoOrderScanRequest,
    MpCargoOrderScanResult,
    MpCargoUnit,
    MpCargoUnitsResponse,
    MpOrderPushResult,
    MpPackScanRequest,
    MpPackScanResult,
    MpAccountCreate,
    MpAccountItem,
    MpAccountsResponse,
    MpAccountUpdate,
    MpLinkRequest,
    MpLinkResponse,
    MpOrderDetailResponse,
    MpOrderLine,
    MpOrderListItem,
    MpOrdersResponse,
    MpOrdersSummaryResponse,
    MpPickReturnRequest,
    MpPickReturnResult,
    MpPickScanRequest,
    MpPickScanResult,
    MpProductArticleItem,
    MpProductArticlesResponse,
    MpProductItem,
    MpProductsResponse,
    MpSupplyBoardResponse,
    MpSupplyCandidatesResponse,
    MpSupplyCreateRequest,
    MpSupplyDetailResponse,
    MpSupplyOpItem,
    MpSupplyOpsResponse,
    MpSupplyOrderItem,
    MpSupplyOrdersRequest,
    MpSupplyLabelsResult,
    MpSupplyPackViewResponse,
    MpSupplyPickViewResponse,
    MpSupplyQueueResponse,
    SyncStatsResponse,
)
from .service import (
    add_order_to_cargo,
    advance_supply,
    apply_supply_correction,
    auto_link_by_barcode,
    available_orders_for_supply,
    cancel_supply,
    cargo_labels,
    check_account,
    claim_next_supply,
    close_cargo_unit,
    create_cargo_unit,
    create_supply,
    delete_cargo_unit,
    discard_supply_correction,
    dock_supply_orders,
    drop_supply_order,
    fetch_supply_labels,
    handover_supply_to_marketplace,
    link_mp_product,
    list_cargo_units,
    lookup_cargo_unit,
    pack_order,
    push_order_to_marketplace,
    register_pack_scan,
    remove_order_from_cargo,
    reopen_cargo_unit,
    supply_pack_view,
    undo_pack_scan,
    unpack_order,
    list_mp_products,
    list_orders,
    list_product_mp_articles,
    load_supply,
    order_detail,
    orders_summary,
    picking_queue_size,
    pool_orders,
    register_pick,
    return_pick,
    release_supply,
    set_supply_orders,
    start_supply_correction,
    supply_board,
    supply_detail,
    supply_ops,
    supply_pick_view,
    sync_account_catalog,
    sync_account_orders,
    transfer_supply_to_marketplace,
    undo_pick,
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


def _account_item(row, client_name: str | None) -> MpAccountItem:
    return MpAccountItem(
        id=str(row["id"]),
        client_id=str(row["client_id"]),
        client_name=client_name,
        marketplace=str(row["marketplace"]),
        name=str(row["name"]),
        ozon_client_id_masked=(_mask(row["ozon_client_id"]) if row["ozon_client_id"] else None),
        api_key_masked=_mask(row["api_key"]),
        is_sandbox=bool(row["is_sandbox"]),
        status=str(row["status"]),
        last_sync_at=row["last_sync_at"],
        last_sync_error=row["last_sync_error"],
        created_at=str(row["created_at"]),
    )


# ── Подключения кабинетов (менеджерский состав) ───────────────────────────────

@router.get("/marketplaces/accounts", response_model=MpAccountsResponse)
def list_accounts(user=Depends(_get_mp_manager)):
    """Список подключений; ключи в ответе всегда маскированы."""
    _ = user
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT a.*, c.name AS client_name FROM mp_accounts a "
            "LEFT JOIN clients c ON c.id = a.client_id "
            "WHERE COALESCE(a.is_deleted, 0) = 0 ORDER BY a.created_at ASC",
        ).fetchall()
    return MpAccountsResponse(items=[_account_item(r, r["client_name"]) for r in rows])


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
    is_sandbox = bool(payload.is_sandbox)
    if is_sandbox and marketplace == MP_OZON:
        raise HTTPException(status_code=400, detail="Тестовый контур есть только у Wildberries")

    account = {
        "id": str(uuid4()),
        "client_id": str(payload.client_id),
        "marketplace": marketplace,
        "name": name,
        "ozon_client_id": ozon_client_id,
        "api_key": api_key,
        "is_sandbox": is_sandbox,
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
            "api_key, is_sandbox, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (account["id"], account["client_id"], marketplace, name, ozon_client_id,
             api_key, 1 if is_sandbox else 0, MP_ACCOUNT_STATUS_ACTIVE, _now(), uid),
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
    if payload.is_sandbox is not None:
        sets.append("is_sandbox = ?")
        params.append(1 if payload.is_sandbox else 0)
    if not sets:
        raise HTTPException(status_code=400, detail="Нет изменений")
    with get_connection() as conn:
        row = _load_account(conn, account_id)
        if payload.is_sandbox and str(row["marketplace"]) == MP_OZON:
            raise HTTPException(status_code=400, detail="Тестовый контур есть только у Wildberries")
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
    no_supply: bool = Query(False),
    has_error: bool = Query(False),
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
            no_supply=no_supply, has_error=has_error,
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
    account_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    linked: str = Query("all"),
    search: str | None = Query(None),
):
    _ = user
    if linked not in ("all", "linked", "unlinked"):
        raise HTTPException(status_code=400, detail="Недопустимый фильтр связки")
    with get_connection() as conn:
        account = _load_account(conn, account_id) if account_id else None
        data = list_mp_products(conn, account, page=page, limit=limit, linked=linked, search=search)
    return MpProductsResponse(
        items=[MpProductItem(**item) for item in data["items"]],
        total=data["total"], page=data["page"], limit=data["limit"],
    )


@router.get(
    "/marketplaces/wms-products/{product_id}/articles",
    response_model=MpProductArticlesResponse,
)
def list_product_articles_endpoint(product_id: str, user=Depends(get_current_admin)):
    """Артикулы продавца в карточке товара WMS.

    Доступ шире остальных marketplace-эндпоинтов (весь бэк-офис, не только
    менеджерский состав): артикул — не ключ кабинета, а карточку товара смотрит
    и склад."""
    _ = user
    with get_connection() as conn:
        rows = list_product_mp_articles(conn, product_id)
    return MpProductArticlesResponse(items=[MpProductArticleItem(**r) for r in rows])


@router.post("/marketplaces/products/{mp_product_id}/link", response_model=MpLinkResponse)
def link_product_endpoint(mp_product_id: str, payload: MpLinkRequest, user=Depends(_get_mp_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        stats = link_mp_product(
            conn, mp_product_id,
            product_id=payload.product_id, variant_id=payload.variant_id,
            user_id=uid, source=MP_LINK_SOURCE_MANUAL,
        )
        conn.commit()
    return MpLinkResponse(message="ok", **stats)


@router.delete("/marketplaces/products/{mp_product_id}/link", response_model=MessageResponse)
def unlink_product_endpoint(mp_product_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        if not unlink_mp_product(conn, mp_product_id):
            raise HTTPException(status_code=404, detail="Связка не найдена")
        conn.commit()
    return MessageResponse(message="ok")


# ── FBS-поставки (менеджерский состав) ────────────────────────────────────────

@router.get("/marketplaces/supplies/board", response_model=MpSupplyBoardResponse)
def supply_board_endpoint(
    user=Depends(_get_mp_manager),
    client_id: str | None = Query(None),
    marketplace: str | None = Query(None),
    account_id: str | None = Query(None),
):
    _ = user
    if marketplace and marketplace not in MARKETPLACES:
        raise HTTPException(status_code=400, detail="Недопустимый маркетплейс")
    with get_connection() as conn:
        data = supply_board(
            conn, client_id=client_id, marketplace=marketplace, account_id=account_id,
        )
    return MpSupplyBoardResponse(**data)


@router.post("/marketplaces/supplies", response_model=MessageResponse)
def create_supply_endpoint(
    payload: MpSupplyCreateRequest, request: Request, user=Depends(_get_mp_manager),
):
    """Завести поставку кабинета: поток заказов делится на столько отгрузок,
    на сколько решил менеджер. Состав приходит выбранным из пула — поставка
    сразу встаёт на «Проверку», отдельного подтверждения того же списка нет."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_create:{payload.account_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MessageResponse(**stored)
        supply_id = create_supply(
            conn, account_id=payload.account_id, order_ids=payload.order_ids, user_id=uid,
        )
        result = {"message": supply_id}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MessageResponse(**result)


@router.get("/marketplaces/supplies/pool", response_model=MpSupplyCandidatesResponse)
def supply_pool_endpoint(account_id: str = Query(...), user=Depends(_get_mp_manager)):
    """Свободные заказы кабинета — из них набирают состав новой поставки."""
    _ = user
    with get_connection() as conn:
        items = pool_orders(conn, account_id)
    return MpSupplyCandidatesResponse(items=[MpSupplyOrderItem(**i) for i in items])


@router.get("/marketplaces/supplies/{supply_id}", response_model=MpSupplyDetailResponse)
def supply_detail_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        data = supply_detail(conn, supply_id)
    if not data:
        raise HTTPException(status_code=404, detail="Поставка не найдена")
    return MpSupplyDetailResponse(**data)


@router.get("/marketplaces/supplies/{supply_id}/candidates", response_model=MpSupplyCandidatesResponse)
def supply_candidates_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        load_supply(conn, supply_id)
        items = available_orders_for_supply(conn, supply_id)
    return MpSupplyCandidatesResponse(items=[MpSupplyOrderItem(**i) for i in items])


@router.get("/marketplaces/supplies/{supply_id}/ops", response_model=MpSupplyOpsResponse)
def supply_ops_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    _ = user
    with get_connection() as conn:
        load_supply(conn, supply_id)
        items = supply_ops(conn, supply_id)
    return MpSupplyOpsResponse(items=[MpSupplyOpItem(**i) for i in items])


@router.put("/marketplaces/supplies/{supply_id}/orders", response_model=MessageResponse)
def set_supply_orders_endpoint(
    supply_id: str, payload: MpSupplyOrdersRequest, user=Depends(_get_mp_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        set_supply_orders(conn, supply_id, payload.order_ids, uid)
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/correct", response_model=MessageResponse)
def start_supply_correction_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    """«Скорректировать»: состав перевыбирается галочками, как при заведении."""
    with get_connection() as conn:
        start_supply_correction(conn, supply_id, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/correct/apply", response_model=MessageResponse)
def apply_supply_correction_endpoint(
    supply_id: str, payload: MpSupplyOrdersRequest, user=Depends(_get_mp_manager),
):
    with get_connection() as conn:
        apply_supply_correction(conn, supply_id, payload.order_ids, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/correct/discard", response_model=MessageResponse)
def discard_supply_correction_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    with get_connection() as conn:
        discard_supply_correction(conn, supply_id, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/transfer", response_model=MessageResponse)
def transfer_supply_endpoint(supply_id: str, request: Request, user=Depends(_get_mp_manager)):
    """«Передать поставку WB / Ozon»: у WB заводится поставка продавца со всеми
    заданиями, у Ozon фиксируется состав. Дальше состав не правится, поставка не
    аннулируется, а лента этикеток становится доступна."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_transfer:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MessageResponse(**stored)
        try:
            transferred = transfer_supply_to_marketplace(conn, supply_id, uid)
        except HTTPException as exc:
            # Отказ площадки после заведения поставки продавца: её номер и запись об
            # ошибке должны остаться, иначе повтор заведёт у WB вторую поставку.
            if exc.status_code == 502:
                conn.commit()
            raise
        result = {"message": transferred["external_supply_id"] or "ok"}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MessageResponse(**result)


@router.post("/marketplaces/supplies/{supply_id}/dock", response_model=MessageResponse)
def dock_supply_orders_endpoint(
    supply_id: str, payload: MpSupplyOrdersRequest, user=Depends(_get_mp_manager),
):
    uid = str(user["id"])
    with get_connection() as conn:
        docked = dock_supply_orders(conn, supply_id, payload.order_ids, uid)
        conn.commit()
    return MessageResponse(message=str(docked))


@router.post("/marketplaces/supplies/{supply_id}/advance", response_model=MessageResponse)
def advance_supply_endpoint(
    supply_id: str, request: Request, user=Depends(_get_mp_manager),
):
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_advance:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MessageResponse(**stored)
        row = load_supply(conn, supply_id)
        if str(row["status"]) == MP_SUPPLY_STATUS_HANDOVER:
            # Регистрация коробов и deliver у WB идут до смены статуса: если площадка
            # откажет, поставка остаётся на передаче с записью об ошибке в журнале.
            handover_supply_to_marketplace(conn, supply_id, uid)
        status = advance_supply(conn, supply_id, uid)
        result = {"message": status}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MessageResponse(**result)


@router.get("/marketplaces/supplies/queue/next", response_model=MpSupplyQueueResponse)
def picking_queue_endpoint(user=Depends(get_current_supply_picker)):
    """Что покажет кнопка «Получить задачу»: размер очереди и своя незакрытая сборка."""
    uid = str(user["id"])
    with get_connection() as conn:
        mine = conn.execute(
            "SELECT id, status FROM mp_supplies WHERE status IN (?, ?) AND picker_id = ? "
            "AND COALESCE(is_deleted, 0) = 0 ORDER BY claimed_at ASC LIMIT 1",
            (MP_SUPPLY_STATUS_PICKING, MP_SUPPLY_STATUS_PACKING, uid),
        ).fetchone()
        return MpSupplyQueueResponse(
            queue=picking_queue_size(conn),
            supply_id=str(mine["id"]) if mine else None,
            supply_status=str(mine["status"]) if mine else None,
        )


@router.post("/marketplaces/supplies/claim-next", response_model=MpSupplyQueueResponse)
def claim_next_supply_endpoint(request: Request, user=Depends(get_current_supply_picker)):
    """Получить задачу: захват следующей поставки из очереди сборки."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, "mp_supply_claim")
        if not proceed:
            conn.commit()
            return MpSupplyQueueResponse(**stored)
        supply_id = claim_next_supply(conn, uid)
        result = {"queue": picking_queue_size(conn), "supply_id": supply_id}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpSupplyQueueResponse(**result)


@router.get("/marketplaces/supplies/{supply_id}/pick-view", response_model=MpSupplyPickViewResponse)
def supply_pick_view_endpoint(supply_id: str, user=Depends(get_current_supply_picker)):
    with get_connection() as conn:
        return MpSupplyPickViewResponse(**supply_pick_view(conn, supply_id))


@router.post("/marketplaces/supplies/{supply_id}/release", response_model=MessageResponse)
def release_supply_endpoint(supply_id: str, user=Depends(get_current_supply_picker)):
    with get_connection() as conn:
        release_supply(conn, supply_id, str(user["id"]), str(user["role"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/picks", response_model=MpPickScanResult)
def register_pick_endpoint(
    supply_id: str, payload: MpPickScanRequest, request: Request,
    user=Depends(get_current_supply_picker),
):
    """Скан позиции сборщиком. Идемпотентно: обрыв связи не задваивает движение стока."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_pick:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MpPickScanResult(**stored)
        result = register_pick(
            conn, supply_id, barcode=payload.barcode, zone_id=payload.zone_id,
            container_id=payload.container_id, qty=payload.qty,
            user_id=uid, role=str(user["role"]),
        )
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpPickScanResult(**result)


@router.post("/marketplaces/supplies/{supply_id}/picks/return", response_model=MpPickReturnResult)
def return_pick_endpoint(
    supply_id: str, payload: MpPickReturnRequest, request: Request,
    user=Depends(get_current_supply_worker),
):
    """Возврат на полку собранного под снятые заказы. Идемпотентно: обрыв связи
    не задваивает движение стока."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_pick_return:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MpPickReturnResult(**stored)
        result = return_pick(
            conn, supply_id, barcode=payload.barcode, zone_id=payload.zone_id,
            qty=payload.qty, user_id=uid, role=str(user["role"]),
        )
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpPickReturnResult(**result)


@router.post("/marketplaces/supplies/{supply_id}/picks/{pick_id}/undo", response_model=MessageResponse)
def undo_pick_endpoint(supply_id: str, pick_id: str, user=Depends(get_current_supply_picker)):
    with get_connection() as conn:
        undo_pick(conn, supply_id, pick_id, str(user["id"]), str(user["role"]))
        conn.commit()
    return MessageResponse(message="ok")


# ── Станция упаковки ──────────────────────────────────────────────────────────

@router.get("/marketplaces/supplies/{supply_id}/pack-view", response_model=MpSupplyPackViewResponse)
def supply_pack_view_endpoint(supply_id: str, user=Depends(get_current_supply_worker)):
    _ = user
    with get_connection() as conn:
        return MpSupplyPackViewResponse(**supply_pack_view(conn, supply_id))


@router.post(
    "/marketplaces/supplies/{supply_id}/orders/{order_id}/pack-scans",
    response_model=MpPackScanResult,
)
def register_pack_scan_endpoint(
    supply_id: str, order_id: str, payload: MpPackScanRequest, request: Request,
    user=Depends(get_current_supply_worker),
):
    """Скан единицы (ШК или КИЗ) в заказ. Идемпотентно: повтор не задваивает укладку."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_pack:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MpPackScanResult(**stored)
        result = register_pack_scan(
            conn, supply_id, order_id, code=payload.code, qty=payload.qty,
            user_id=uid, role=str(user["role"]),
        )
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpPackScanResult(**result)


@router.post(
    "/marketplaces/supplies/{supply_id}/pack-scans/{pack_id}/undo", response_model=MessageResponse,
)
def undo_pack_scan_endpoint(supply_id: str, pack_id: str, user=Depends(get_current_supply_worker)):
    with get_connection() as conn:
        undo_pack_scan(conn, supply_id, pack_id, str(user["id"]), str(user["role"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post(
    "/marketplaces/supplies/{supply_id}/orders/{order_id}/pack", response_model=MpOrderPushResult,
)
def pack_order_endpoint(
    supply_id: str, order_id: str, request: Request, user=Depends(get_current_supply_worker),
):
    """Заказ укомплектован → отправление собирается на площадке и приходит этикетка.

    Две транзакции: упаковка фиксируется независимо от ответа площадки, чтобы обрыв
    связи с МП не откатывал факт укладки; ошибка площадки возвращается в ответе."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_pack_order:{supply_id}"
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MpOrderPushResult(**stored)
        pack_order(conn, supply_id, order_id, uid, str(user["role"]))
        conn.commit()
    with get_connection() as conn:
        result = push_order_to_marketplace(conn, supply_id, order_id, uid)
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpOrderPushResult(**result)


@router.post(
    "/marketplaces/supplies/{supply_id}/orders/{order_id}/push", response_model=MpOrderPushResult,
)
def push_order_endpoint(supply_id: str, order_id: str, user=Depends(get_current_supply_worker)):
    """Повторить отправку на площадку / запрос этикетки для уже упакованного заказа."""
    with get_connection() as conn:
        result = push_order_to_marketplace(conn, supply_id, order_id, str(user["id"]))
        conn.commit()
    return MpOrderPushResult(**result)


@router.post("/marketplaces/supplies/{supply_id}/labels", response_model=MpSupplyLabelsResult)
def fetch_supply_labels_endpoint(supply_id: str, user=Depends(get_current_supply_worker)):
    """Лента этикеток на весь состав: печатается пачкой и клеится на заказы по ходу
    работы. Ошибка площадки не роняет уже полученное — она в ответе, повтор безопасен."""
    with get_connection() as conn:
        result = fetch_supply_labels(conn, supply_id, str(user["id"]))
        conn.commit()
    return MpSupplyLabelsResult(**result)


@router.post(
    "/marketplaces/supplies/{supply_id}/orders/{order_id}/unpack", response_model=MessageResponse,
)
def unpack_order_endpoint(supply_id: str, order_id: str, user=Depends(get_current_supply_worker)):
    with get_connection() as conn:
        unpack_order(conn, supply_id, order_id, str(user["id"]), str(user["role"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/finish-packing", response_model=MessageResponse)
def finish_packing_endpoint(
    supply_id: str, request: Request, user=Depends(get_current_supply_worker),
):
    """Упаковка закончена — поставка уходит на передачу (грузовые места)."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_finish_packing:{supply_id}"
    with get_connection() as conn:
        row = load_supply(conn, supply_id)
        if str(row["status"]) != MP_SUPPLY_STATUS_PACKING:
            raise HTTPException(status_code=400, detail="Поставка не на упаковке")
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MessageResponse(**stored)
        result = {"message": advance_supply(conn, supply_id, uid)}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MessageResponse(**result)


# ── Грузовые места ────────────────────────────────────────────────────────────

@router.get("/marketplaces/supplies/{supply_id}/cargo", response_model=MpCargoUnitsResponse)
def list_cargo_units_endpoint(supply_id: str, user=Depends(get_current_supply_worker)):
    _ = user
    with get_connection() as conn:
        load_supply(conn, supply_id)
        items = list_cargo_units(conn, supply_id)
    return MpCargoUnitsResponse(items=[MpCargoUnit(**i) for i in items])


@router.post("/marketplaces/supplies/{supply_id}/cargo", response_model=MpCargoUnit)
def create_cargo_unit_endpoint(
    supply_id: str, payload: MpCargoCreateRequest, request: Request,
    user=Depends(get_current_supply_worker),
):
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, f"mp_cargo_create:{supply_id}")
        if not proceed:
            conn.commit()
            return MpCargoUnit(**stored)
        unit = create_cargo_unit(conn, supply_id, payload.kind, uid)
        finish_idempotent(conn, request_id, unit)
        conn.commit()
    return MpCargoUnit(**unit)


@router.get("/marketplaces/cargo/labels", response_model=MpCargoLabelsResponse)
def cargo_labels_endpoint(
    user=Depends(get_current_supply_worker),
    ids: str = Query(..., description="Список id грузовых мест через запятую"),
):
    _ = user
    id_list = [x for x in (ids or "").split(",") if x.strip()]
    with get_connection() as conn:
        items = cargo_labels(conn, id_list)
    return MpCargoLabelsResponse(items=[MpCargoLabel(**i) for i in items])


@router.get("/marketplaces/cargo/by-code/{code}", response_model=MpCargoLookupResponse)
def lookup_cargo_unit_endpoint(code: str, user=Depends(get_current_supply_worker)):
    """Скан этикетки ГМ: QR/номер → грузовое место. found=false, если не найдено."""
    _ = user
    with get_connection() as conn:
        unit = lookup_cargo_unit(conn, code)
    return MpCargoLookupResponse(found=unit is not None, unit=MpCargoUnit(**unit) if unit else None)


@router.post("/marketplaces/cargo/{cargo_id}/orders", response_model=MpCargoOrderScanResult)
def add_order_to_cargo_endpoint(
    cargo_id: str, payload: MpCargoOrderScanRequest, request: Request,
    user=Depends(get_current_supply_worker),
):
    """Скан этикетки заказа в грузовое место. Идемпотентно по X-Request-Id."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, request_id, uid, f"mp_cargo_order:{cargo_id}")
        if not proceed:
            conn.commit()
            return MpCargoOrderScanResult(**stored)
        result = add_order_to_cargo(conn, cargo_id, payload.code, uid)
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MpCargoOrderScanResult(**result)


@router.delete("/marketplaces/cargo/{cargo_id}/orders/{order_id}", response_model=MessageResponse)
def remove_order_from_cargo_endpoint(
    cargo_id: str, order_id: str, user=Depends(get_current_supply_worker),
):
    with get_connection() as conn:
        remove_order_from_cargo(conn, cargo_id, order_id, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/cargo/{cargo_id}/close", response_model=MpCargoUnit)
def close_cargo_unit_endpoint(cargo_id: str, user=Depends(get_current_supply_worker)):
    with get_connection() as conn:
        unit = close_cargo_unit(conn, cargo_id, str(user["id"]))
        conn.commit()
    return MpCargoUnit(**unit)


@router.post("/marketplaces/cargo/{cargo_id}/reopen", response_model=MpCargoUnit)
def reopen_cargo_unit_endpoint(cargo_id: str, user=Depends(get_current_supply_worker)):
    with get_connection() as conn:
        unit = reopen_cargo_unit(conn, cargo_id, str(user["id"]))
        conn.commit()
    return MpCargoUnit(**unit)


@router.delete("/marketplaces/cargo/{cargo_id}", response_model=MessageResponse)
def delete_cargo_unit_endpoint(cargo_id: str, user=Depends(get_current_supply_worker)):
    with get_connection() as conn:
        delete_cargo_unit(conn, cargo_id, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/finish-picking", response_model=MessageResponse)
def finish_picking_endpoint(
    supply_id: str, request: Request, user=Depends(get_current_supply_picker),
):
    """Сборка закончена — поставка уходит на передачу. Гейт общий с кнопкой менеджера."""
    uid = str(user["id"])
    request_id = request.headers.get("X-Request-Id")
    scope = f"mp_supply_finish_picking:{supply_id}"
    with get_connection() as conn:
        row = load_supply(conn, supply_id)
        if str(row["status"]) != MP_SUPPLY_STATUS_PICKING:
            raise HTTPException(status_code=400, detail="Поставка не на сборке")
        proceed, stored = begin_idempotent(conn, request_id, uid, scope)
        if not proceed:
            conn.commit()
            return MessageResponse(**stored)
        result = {"message": advance_supply(conn, supply_id, uid)}
        finish_idempotent(conn, request_id, result)
        conn.commit()
    return MessageResponse(**result)


@router.post("/marketplaces/supplies/{supply_id}/orders/{order_id}/drop", response_model=MessageResponse)
def drop_supply_order_endpoint(supply_id: str, order_id: str, user=Depends(_get_mp_manager)):
    """Снять заказ с поставки на сборке — разбор недостачи."""
    with get_connection() as conn:
        drop_supply_order(conn, supply_id, order_id, str(user["id"]))
        conn.commit()
    return MessageResponse(message="ok")


@router.post("/marketplaces/supplies/{supply_id}/cancel", response_model=MessageResponse)
def cancel_supply_endpoint(supply_id: str, user=Depends(_get_mp_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        cancel_supply(conn, supply_id, uid)
        conn.commit()
    return MessageResponse(message="ok")
