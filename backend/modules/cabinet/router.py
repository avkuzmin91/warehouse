from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.balances.schemas import BalanceListResponse
from modules.balances.service import get_balances
from modules.products.schemas import ProductItem, ProductListResponse, ProductVariantItem
from security import user_client_id_opt

from .service import (
    get_cabinet_product,
    list_cabinet_product_variants,
    list_cabinet_products as list_cabinet_products_service,
)

router = APIRouter(tags=["cabinet"])


def _get_current_client_id(user=Depends(get_current_user)) -> str:
    if user["role"] != "client":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    client_id = user_client_id_opt(user)
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обратитесь к администратору для активации доступа",
        )
    return client_id


@router.get("/cabinet/balances", response_model=BalanceListResponse)
def list_client_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    only_positive: bool = Query(True),
    has_defect: bool = Query(False),
    client_id: str = Depends(_get_current_client_id),
):
    with get_connection() as conn:
        return get_balances(
            conn,
            page=page,
            limit=limit,
            client_id=client_id,
            search=search,
            only_positive=only_positive,
            has_defect=has_defect,
        )


@router.get("/cabinet/products", response_model=ProductListResponse)
def list_client_products(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    sort: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    with get_connection() as conn:
        return list_cabinet_products_service(
            conn,
            client_id=client_id,
            page=page,
            limit=limit,
            search=search,
            sort=sort,
        )


@router.get("/cabinet/products/{product_id}", response_model=ProductItem)
def get_client_product(product_id: str, client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return get_cabinet_product(conn, client_id=client_id, product_id=product_id)


@router.get("/cabinet/products/{product_id}/variants", response_model=list[ProductVariantItem])
def list_client_product_variants(product_id: str, client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return list_cabinet_product_variants(conn, client_id=client_id, product_id=product_id)
