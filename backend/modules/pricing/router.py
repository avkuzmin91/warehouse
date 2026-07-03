from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from config import INV_Q_DEFECT, INV_Q_GOOD
from dbconn import get_connection, ci_like_substring_param
from modules.auth.service import get_current_manager
from modules.timesheet.service import business_today
from security import ensure_finance_access

from .schemas import (
    MessageResponse,
    PriceHistoryEntry,
    PricedProductItem,
    PricedProductsResponse,
    ProductPriceDetail,
    SetPriceRequest,
)
from .service import add_price, current_prices_for_products, delete_price, load_price_history, price_on

router = APIRouter(tags=["pricing"])


def _get_finance(user=Depends(get_current_manager)):
    ensure_finance_access(user)
    return user


def _validate_date(raw: str) -> str:
    s = str(raw or "").strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата (нужен формат ГГГГ-ММ-ДД)") from exc
    return s


@router.get("/pricing/products", response_model=PricedProductsResponse)
def list_priced_products(
    user=Depends(_get_finance),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    client_id: str | None = Query(None),
    missing_only: bool = Query(False),
):
    _ = user
    today = business_today().isoformat()
    conds = ["COALESCE(p.is_deleted, 0) = 0"]
    params: list = []
    if search and search.strip():
        like = ci_like_substring_param(search)
        conds.append("(fold_ci(p.name) LIKE ? OR fold_ci(p.sku) LIKE ?)")
        params += [like, like]
    if client_id and client_id.strip():
        conds.append("p.client_id = ?")
        params.append(client_id.strip())
    if missing_only:
        conds.append(
            "NOT EXISTS (SELECT 1 FROM product_packing_prices pp "
            "WHERE pp.product_id = p.id AND pp.client_id = p.client_id "
            "AND COALESCE(pp.is_deleted, 0) = 0)"
        )
    where = " AND ".join(conds)
    offset = (page - 1) * limit
    with get_connection() as conn:
        total = int(conn.execute(
            f"SELECT COUNT(*) AS n FROM products p WHERE {where}", params
        ).fetchone()["n"])
        rows = conn.execute(
            f"""
            SELECT p.id, p.name, p.sku, COALESCE(p.sku_pending, 0) AS sku_pending,
                   p.client_id, c.name AS client_name
            FROM products p
            LEFT JOIN clients c ON c.id = p.client_id
            WHERE {where}
            ORDER BY LOWER(p.name) ASC, p.created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        priced = current_prices_for_products(
            conn, [(str(r["id"]), r["client_id"]) for r in rows], today
        )
    items = []
    for r in rows:
        pid = str(r["id"])
        good = priced.get((pid, INV_Q_GOOD))
        defect = priced.get((pid, INV_Q_DEFECT))
        items.append(PricedProductItem(
            id=pid,
            name=str(r["name"]),
            sku=str(r["sku"]) if r["sku"] else None,
            sku_pending=bool(r["sku_pending"]),
            client_id=str(r["client_id"]) if r["client_id"] else None,
            client_name=str(r["client_name"]) if r["client_name"] else None,
            good_price_kop=good,
            defect_price_kop=defect,
            has_price=good is not None or defect is not None,
        ))
    return PricedProductsResponse(items=items, total=total, page=page, limit=limit)


@router.get("/pricing/products/{product_id}", response_model=ProductPriceDetail)
def get_product_prices(
    product_id: str,
    user=Depends(_get_finance),
    client_id: str | None = Query(None),
):
    _ = user
    today = business_today().isoformat()
    with get_connection() as conn:
        prod = conn.execute(
            "SELECT p.id, p.name, p.sku, p.client_id, c.name AS client_name "
            "FROM products p LEFT JOIN clients c ON c.id = p.client_id "
            "WHERE p.id = ? AND COALESCE(p.is_deleted, 0) = 0",
            (product_id,),
        ).fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail="Товар не найден")
        cid = (client_id or "").strip() or (str(prod["client_id"]) if prod["client_id"] else "")
        if not cid:
            raise HTTPException(status_code=400, detail="У товара не указан клиент — задайте клиента для тарифа")
        good_hist = load_price_history(conn, product_id, cid, INV_Q_GOOD)
        defect_hist = load_price_history(conn, product_id, cid, INV_Q_DEFECT)
        client_name = prod["client_name"]
        if cid != (str(prod["client_id"]) if prod["client_id"] else ""):
            cn = conn.execute("SELECT name FROM clients WHERE id = ?", (cid,)).fetchone()
            client_name = cn["name"] if cn else None
    return ProductPriceDetail(
        product_id=str(prod["id"]),
        product_name=str(prod["name"]),
        sku=str(prod["sku"]) if prod["sku"] else None,
        client_id=cid,
        client_name=str(client_name) if client_name else None,
        good_price_kop=price_on(good_hist, today),
        defect_price_kop=price_on(defect_hist, today),
        good_history=[PriceHistoryEntry(**e) for e in good_hist],
        defect_history=[PriceHistoryEntry(**e) for e in defect_hist],
    )


@router.post("/pricing/products/{product_id}/prices", response_model=MessageResponse)
def set_product_price(product_id: str, body: SetPriceRequest, user=Depends(_get_finance)):
    uid = str(user["id"])
    if body.good_price_kop is None and body.defect_price_kop is None:
        raise HTTPException(status_code=400, detail="Укажите стоимость годного или брака")
    effective_from = _validate_date(body.effective_from) if body.effective_from else business_today().isoformat()
    with get_connection() as conn:
        prod = conn.execute(
            "SELECT client_id FROM products WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (product_id,),
        ).fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail="Товар не найден")
        cid = (body.client_id or "").strip() or (str(prod["client_id"]) if prod["client_id"] else "")
        if not cid:
            raise HTTPException(status_code=400, detail="У товара не указан клиент — задайте клиента для тарифа")
        if body.good_price_kop is not None:
            add_price(conn, product_id=product_id, client_id=cid, quality=INV_Q_GOOD,
                      price_kop=body.good_price_kop, effective_from=effective_from,
                      user_id=uid, note=body.note)
        if body.defect_price_kop is not None:
            add_price(conn, product_id=product_id, client_id=cid, quality=INV_Q_DEFECT,
                      price_kop=body.defect_price_kop, effective_from=effective_from,
                      user_id=uid, note=body.note)
        conn.commit()
    return MessageResponse(message="ok")


@router.delete("/pricing/products/{product_id}/prices/{price_id}", response_model=MessageResponse)
def delete_product_price(product_id: str, price_id: str, user=Depends(_get_finance)):
    _ = user
    with get_connection() as conn:
        if not delete_price(conn, product_id=product_id, price_id=price_id):
            raise HTTPException(status_code=404, detail="Запись тарифа не найдена")
        conn.commit()
    return MessageResponse(message="ok")
