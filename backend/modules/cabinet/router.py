from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status

from config import (
    CABINET_RECEIPT_VISIBLE_STATUSES,
    CABINET_SHIPMENT_VISIBLE_STATUSES,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
)
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.balances.schemas import BalanceListResponse, BalanceSummaryResponse
from modules.balances.service import get_balances, get_balances_summary
from modules.products.schemas import ProductItem, ProductListResponse, ProductVariantItem
from security import user_client_id_opt

from .schemas import (
    CabinetPackingReportResponse,
    CabinetProfileResponse,
    CabinetReceiptDetailResponse,
    CabinetReceiptLinesResponse,
    CabinetReceiptListResponse,
    CabinetShipmentDetailResponse,
    CabinetShipmentLinesResponse,
    CabinetShipmentListResponse,
    CabinetSummaryResponse,
    CabinetWriteOffsResponse,
)
from .service import (
    cabinet_packing_report,
    cabinet_summary,
    get_cabinet_product,
    get_cabinet_profile,
    get_cabinet_receipt,
    get_cabinet_shipment,
    list_cabinet_product_variants,
    list_cabinet_products as list_cabinet_products_service,
    list_cabinet_receipt_lines,
    list_cabinet_receipts,
    list_cabinet_shipment_lines,
    list_cabinet_shipments,
    list_cabinet_write_offs,
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


def _validate_status(value: str | None, allowed: frozenset[str]) -> str | None:
    if value is None or not value.strip():
        return None
    s = value.strip()
    if s not in allowed:
        raise HTTPException(status_code=400, detail="Недопустимый статус")
    return s


def _validate_cargo_type(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    s = value.strip()
    if s not in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT):
        raise HTTPException(status_code=400, detail="Недопустимый тип груза")
    return s


@router.get("/cabinet/summary", response_model=CabinetSummaryResponse)
def get_client_summary(client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return cabinet_summary(conn, client_id=client_id)


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


@router.get("/cabinet/balances/summary", response_model=BalanceSummaryResponse)
def get_client_balances_summary(
    search: str | None = Query(None),
    has_defect: bool = Query(False),
    client_id: str = Depends(_get_current_client_id),
):
    with get_connection() as conn:
        return get_balances_summary(
            conn,
            client_id=client_id,
            search=search,
            has_defect=has_defect,
        )


@router.get("/cabinet/write-offs", response_model=CabinetWriteOffsResponse)
def list_client_write_offs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    client_id: str = Depends(_get_current_client_id),
):
    with get_connection() as conn:
        return list_cabinet_write_offs(conn, client_id=client_id, page=page, limit=limit)


@router.get("/cabinet/receipts", response_model=CabinetReceiptListResponse)
def list_client_receipts(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    status_value = _validate_status(status_filter, CABINET_RECEIPT_VISIBLE_STATUSES)
    with get_connection() as conn:
        return list_cabinet_receipts(
            conn,
            client_id=client_id,
            page=page,
            limit=limit,
            status=status_value,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )


@router.get("/cabinet/receipts/lines", response_model=CabinetReceiptLinesResponse)
def list_client_receipt_lines(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    status_value = _validate_status(status_filter, CABINET_RECEIPT_VISIBLE_STATUSES)
    with get_connection() as conn:
        return list_cabinet_receipt_lines(
            conn,
            client_id=client_id,
            page=page,
            limit=limit,
            status=status_value,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )


@router.get("/cabinet/receipts/{doc_id}", response_model=CabinetReceiptDetailResponse)
def get_client_receipt(doc_id: str, client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return get_cabinet_receipt(conn, client_id=client_id, doc_id=doc_id)


@router.get("/cabinet/shipments", response_model=CabinetShipmentListResponse)
def list_client_shipments(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    cargo_type: str | None = Query(None),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    status_value = _validate_status(status_filter, CABINET_SHIPMENT_VISIBLE_STATUSES)
    cargo_value = _validate_cargo_type(cargo_type)
    with get_connection() as conn:
        return list_cabinet_shipments(
            conn,
            client_id=client_id,
            page=page,
            limit=limit,
            status=status_value,
            cargo_type=cargo_value,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )


@router.get("/cabinet/shipments/lines", response_model=CabinetShipmentLinesResponse)
def list_client_shipment_lines(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    cargo_type: str | None = Query(None),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    status_value = _validate_status(status_filter, CABINET_SHIPMENT_VISIBLE_STATUSES)
    cargo_value = _validate_cargo_type(cargo_type)
    with get_connection() as conn:
        return list_cabinet_shipment_lines(
            conn,
            client_id=client_id,
            page=page,
            limit=limit,
            status=status_value,
            cargo_type=cargo_value,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )


@router.get("/cabinet/shipments/{doc_id}", response_model=CabinetShipmentDetailResponse)
def get_client_shipment(doc_id: str, client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return get_cabinet_shipment(conn, client_id=client_id, doc_id=doc_id)


@router.get("/cabinet/reports/packing", response_model=CabinetPackingReportResponse)
def get_client_packing_report(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    search: str | None = Query(None),
    client_id: str = Depends(_get_current_client_id),
):
    if not date_from:
        date_from = (datetime.now(UTC).date() - timedelta(days=30)).isoformat()
    with get_connection() as conn:
        return cabinet_packing_report(
            conn,
            client_id=client_id,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )


@router.get("/cabinet/profile", response_model=CabinetProfileResponse)
def get_client_profile(client_id: str = Depends(_get_current_client_id)):
    with get_connection() as conn:
        return get_cabinet_profile(conn, client_id=client_id)


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
