from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile, status
from psycopg import IntegrityError

from config import (
    INV_OP_INTAKE,
    INV_OP_SINKS,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    PRODUCT_IMPORT_STATUS_COMMITTED,
    PRODUCT_IMPORT_STATUS_PREVIEW,
    PRODUCT_LIST_SORT_COLUMNS,
    UPLOADS_DIR,
    MAX_UPLOAD_BYTES,
)
from dbconn import get_connection, like_substring_param
from idempotency import begin_idempotent, finish_idempotent
from modules.auth.service import (
    get_current_admin,
    get_current_manager,
    get_current_shipment_viewer,
    get_current_user,
    get_current_warehouse,
)

from .schemas import (
    BarcodeLabelsRequest,
    BarcodeLabelsResponse,
    BarcodeLookupResponse,
    BarcodeMatch,
    MessageResponse,
    ProductItem,
    ProductListResponse,
    ProductUpdateRequest,
    ProductUploadImageResponse,
    ProductVariantDeletePatchRequest,
    ProductVariantFindResponse,
    ProductVariantItem,
    ProductVariantDimension,
    ProductVariantsPatchRequest,
    ProductVariantFindItem,
    ProductCreateMeta,
    ProductBarcodeAdd,
    ProductBarcodeFileItem,
    ProductBarcodeItem,
    ProductFileItem,
    ProductImportCommitResponse,
    ProductImportPreviewResponse,
    ProductImportRowItem,
    ProductImportSummary,
    VariantIdentityChangeRequest,
)
from .service import (
    _barcode_owner_label,
    build_barcode_labels,
    _find_barcode_owner,
    apply_product_import_plan,
    build_product_import_plan,
    build_product_import_report_bytes,
    build_product_import_template_bytes,
    import_file_kind,
    parse_product_import_workbook,
    _assign_variant_skus_from_base,
    _build_variant_rows_for_create,
    _decode_images_json,
    _encode_images_json,
    _find_variant_row_for_receipt,
    _fill_empty_line_sku_snapshots,
    _normalize_name,
    _normalize_sku,
    _now,
    _optional_active_client,
    _order_sql_from_sort_param,
    _product_card_image_urls,
    _product_image_extension,
    _require_active_client,
    _require_active_product_type,
    _rebase_variant_skus_for_new_product_base,
    _resolve_actuality_filter,
    _row_to_product_item,
    _ci_substring_like_param,
    _sku_taken_for_client_except_product,
    _soft_delete_variants_for_product,
    _sync_product_variants_from_request,
    _product_type_flags,
    change_variant_identity,
)

router = APIRouter(tags=["products"])

_SINKS_SQL = ", ".join(f"'{s}'" for s in INV_OP_SINKS)


def _get_strict_admin(user=Depends(get_current_user)):
    """Строго admin — удаление товара доступно только администратору."""
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    return user


@router.get("/products", response_model=ProductListResponse)
def list_products(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    name: str | None = Query(None),
    sku: str | None = Query(None),
    type_id: str | None = Query(None),
    client_id: str | None = Query(None),
    actuality_id: str | None = Query(None),
    sku_pending: bool | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if search is not None and str(search).strip():
        term = str(search).strip()
        like = _ci_substring_like_param(term)
        # Артикул продавца ищется наравне со своим SKU: клиент называет товар тем
        # артикулом, под которым продаёт его на площадке, а не SKU склада.
        conds.append(
            "(fold_ci(COALESCE(p.name, '')) LIKE ? OR fold_ci(COALESCE(p.sku, '')) LIKE ?"
            " OR EXISTS ("
            "   SELECT 1 FROM product_barcodes pb"
            "   WHERE pb.product_id = p.id AND pb.barcode LIKE ?"
            "     AND COALESCE(pb.is_deleted, 0) = 0"
            " )"
            " OR EXISTS ("
            "   SELECT 1 FROM mp_product_links pl"
            "   JOIN mp_products mp ON mp.id = pl.mp_product_id"
            "   WHERE pl.product_id = p.id AND COALESCE(pl.is_deleted, 0) = 0"
            "     AND fold_ci(COALESCE(mp.offer_id, '')) LIKE ?"
            " ))"
        )
        params.extend([like, like, like_substring_param(term), like])
    if name is not None and str(name).strip():
        conds.append("fold_ci(p.name) LIKE ?")
        params.append(_ci_substring_like_param(str(name)))
    if sku is not None and str(sku).strip():
        conds.append("fold_ci(COALESCE(p.sku, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(sku)))
    if type_id is not None and str(type_id).strip():
        conds.append("p.type_id = ?")
        params.append(str(type_id).strip())
    if client_id is not None and str(client_id).strip():
        conds.append("p.client_id = ?")
        params.append(str(client_id).strip())
    if sku_pending is not None:
        conds.append("COALESCE(p.sku_pending, 0) = ?")
        params.append(1 if sku_pending else 0)
    if not include_deleted:
        conds.append("COALESCE(p.is_deleted, 0) = 0")
    join_sql = """
        FROM products p
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN (
            SELECT product_id, COUNT(*) AS cnt
            FROM product_variants
            WHERE COALESCE(is_deleted, 0) = 0
            GROUP BY product_id
        ) vcnt ON vcnt.product_id = p.id
        LEFT JOIN users creator ON creator.id = p.creator_id
        LEFT JOIN users editor ON editor.id = p.updated_by_id
        LEFT JOIN users deleter ON deleter.id = p.deleted_by_id
    """
    stock_join_sql = f"""
        LEFT JOIN (
            SELECT product_id,
                   SUM(CASE WHEN to_quality='{INV_Q_GOOD}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_quality='{INV_Q_GOOD}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS good_in,
                   SUM(CASE WHEN to_quality='{INV_Q_DEFECT}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_quality='{INV_Q_DEFECT}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS defect_in
            FROM zone_relocations
            GROUP BY product_id
        ) bal ON bal.product_id = p.id
    """
    order_sql = _order_sql_from_sort_param(sort, PRODUCT_LIST_SORT_COLUMNS) or "LOWER(p.name) ASC, LOWER(p.sku) ASC"
    with get_connection() as connection:
        ia = _resolve_actuality_filter(connection, actuality_id)
        if ia is not None:
            conds.append("p.is_active = ?")
            params.append(1 if ia else 0)
        where_sql = " AND ".join(conds)
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt {join_sql} WHERE {where_sql}",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT p.id, p.name, p.type_id, pt.name AS type_name, p.sku AS sku_base,
                   COALESCE(p.sku_pending, 0) AS sku_pending, p.weight_grams,
                   p.items_per_box, p.boxes_per_pallet,
                   COALESCE(pt.requires_color, 0) AS requires_color,
                   COALESCE(pt.requires_size, 0) AS requires_size,
                   p.client_id, c.name AS client_name,
                   COALESCE(vcnt.cnt, 0) AS variant_count,
                   GREATEST(0, COALESCE(bal.good_in, 0)) AS stock_total,
                   GREATEST(0, COALESCE(bal.defect_in, 0)) AS defect_total,
                   p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
                   p.deleted_at, p.image_url, p.gallery_json,
                   p.created_at, p.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            {join_sql}
            {stock_join_sql}
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return ProductListResponse(
        items=[_row_to_product_item(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/products/{item_id}", response_model=ProductItem)
def get_product(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            f"""
            SELECT p.id, p.name, p.type_id, pt.name AS type_name, p.sku AS sku_base,
                   COALESCE(p.sku_pending, 0) AS sku_pending, p.weight_grams,
                   p.items_per_box, p.boxes_per_pallet,
                   COALESCE(pt.requires_color, 0) AS requires_color,
                   COALESCE(pt.requires_size, 0) AS requires_size,
                   p.client_id, c.name AS client_name,
                   COALESCE(vcnt.cnt, 0) AS variant_count,
                   GREATEST(0, COALESCE(bal.good_in, 0)) AS stock_total,
                   GREATEST(0, COALESCE(bal.defect_in, 0)) AS defect_total,
                   p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
                   p.deleted_at, p.image_url, p.gallery_json,
                   p.created_at, p.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN (
                SELECT product_id, COUNT(*) AS cnt FROM product_variants WHERE COALESCE(is_deleted, 0) = 0 GROUP BY product_id
            ) vcnt ON vcnt.product_id = p.id
            LEFT JOIN (
                SELECT product_id,
                       SUM(CASE WHEN to_quality='{INV_Q_GOOD}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                         - SUM(CASE WHEN from_quality='{INV_Q_GOOD}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS good_in,
                       SUM(CASE WHEN to_quality='{INV_Q_DEFECT}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                         - SUM(CASE WHEN from_quality='{INV_Q_DEFECT}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS defect_in
                FROM zone_relocations
                WHERE product_id = ?
                GROUP BY product_id
            ) bal ON bal.product_id = p.id
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
            LEFT JOIN users deleter ON deleter.id = p.deleted_by_id
            WHERE p.id = ?
            """,
            (item_id, item_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=404, detail="Товар не найден")
    return _row_to_product_item(row)


@router.post("/products/upload-image", response_model=ProductUploadImageResponse)
async def upload_product_image(
    image: UploadFile = File(...),
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    admin=Depends(get_current_admin),
):
    if not image.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = _product_image_extension(image.content_type, image.filename)
    if not ext:
        raise HTTPException(status_code=400, detail="Допустимы изображения: jpg, png, heic")
    data = await image.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")
    with get_connection() as conn:
        proceed, stored = begin_idempotent(conn, x_request_id, str(admin["id"]), "product_image_upload")
        if not proceed:
            return ProductUploadImageResponse(**stored)
        filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / filename
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)
        finish_idempotent(conn, x_request_id, {"url": f"/uploads/{filename}"})
        conn.commit()
    return ProductUploadImageResponse(url=f"/uploads/{filename}")


@router.post("/products", response_model=MessageResponse)
async def create_product(
    meta: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    try:
        parsed = ProductCreateMeta.model_validate_json(meta)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректные данные товара (meta JSON)") from exc

    image_urls: list[str] = []
    for image in images:
        if not image.filename:
            continue
        ext = _product_image_extension(image.content_type, image.filename)
        if not ext:
            raise HTTPException(status_code=400, detail="Допустимы изображения: jpg, png, heic")
        filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / filename
        data = await image.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)
        image_urls.append(f"/uploads/{filename}")

    inner = parsed.product
    with get_connection() as connection:
        proceed, stored = begin_idempotent(
            connection, x_request_id, str(user["id"]), "product_create",
            response={"message": "Создано"},
        )
        if not proceed:
            return MessageResponse(**stored)
        tid = _require_active_product_type(connection, inner.type_id)
        requires_color, requires_size = _product_type_flags(connection, tid)
        if requires_color and not parsed.colors:
            raise HTTPException(status_code=400, detail="Для этого типа товара выберите хотя бы один цвет")
        cid = _require_active_client(connection, inner.client_id)
        sku_pending = bool(inner.sku_pending)
        if sku_pending:
            sku_base = ""
        else:
            sku_base = _normalize_sku(inner.sku_base or "")
            if _sku_taken_for_client_except_product(connection, sku_base, cid, None):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Базовый штрих-код уже занят у этого клиента")
        variant_rows = _build_variant_rows_for_create(
            connection,
            requires_size=requires_size,
            sku_base=sku_base,
            client_id=cid,
            color_ids=parsed.colors,
            dimensions=parsed.dimensions,
            sku_pending=sku_pending,
        )
        pid = str(uuid4())
        now = _now()
        preview_url = image_urls[0] if image_urls else None
        gallery_ser = json.dumps(image_urls, ensure_ascii=False) if image_urls else None
        try:
            connection.execute(
                """
                INSERT INTO products (id, name, type_id, client_id, supplier_id, sku, sku_pending, weight_grams, items_per_box, boxes_per_pallet, image_url, gallery_json, is_active, created_at, creator_id)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, _normalize_name(inner.name), tid, cid, sku_base, 1 if sku_pending else 0, inner.weight_grams, inner.items_per_box, inner.boxes_per_pallet, preview_url, gallery_ser, 1 if inner.is_active else 0, now, user["id"]),
            )
            for vr in variant_rows:
                connection.execute(
                    """
                    INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, length, width, height, sku, sku_pending, images_json, is_active, created_at, is_deleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
                    """,
                    (str(uuid4()), pid, cid, vr["color_id"], vr["size_id"], vr["length"], vr["width"], vr["height"], vr["sku"], 1 if sku_pending else 0, vr["images_json"], now),
                )
            if inner.packing_price_good_kop is not None or inner.packing_price_defect_kop is not None:
                from config import INV_Q_DEFECT, INV_Q_GOOD
                from modules.pricing.service import add_price
                from modules.timesheet.service import business_today
                eff = business_today().isoformat()
                if inner.packing_price_good_kop is not None:
                    add_price(connection, product_id=pid, client_id=cid, quality=INV_Q_GOOD,
                              price_kop=inner.packing_price_good_kop, effective_from=eff, user_id=str(user["id"]))
                if inner.packing_price_defect_kop is not None:
                    add_price(connection, product_id=pid, client_id=cid, quality=INV_Q_DEFECT,
                              price_kop=inner.packing_price_defect_kop, effective_from=eff, user_id=str(user["id"]))
            connection.commit()
        except IntegrityError as exc:
            connection.rollback()
            raise HTTPException(status_code=400, detail="Базовый штрих-код или SKU варианта уже существует") from exc
    return MessageResponse(message="Создано")


@router.patch("/products/{item_id}", response_model=MessageResponse)
def update_product(item_id: str, payload: ProductUpdateRequest, admin=Depends(get_current_admin)):
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del, sku, COALESCE(sku_pending, 0) AS sku_pending, type_id, client_id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=404, detail="Товар не найден")
        is_del = bool(meta["del"])
        cur_sku = str(meta["sku"])
        cur_pending = bool(meta["sku_pending"])
        cur_type = str(meta["type_id"])
        cur_client_id = str(meta["client_id"]) if meta["client_id"] else None
        target_client_id = cur_client_id
        if is_del and payload.is_deleted is not False:
            if any([payload.name, payload.type_id, payload.client_id, payload.is_active, payload.sku_base, "weight_grams" in payload.model_fields_set, "items_per_box" in payload.model_fields_set, "boxes_per_pallet" in payload.model_fields_set, payload.image_urls]):
                raise HTTPException(status_code=400, detail="Товар удалён. Восстановите его перед редактированием.")
            if payload.is_deleted is None:
                raise HTTPException(status_code=400, detail="Товар удалён")

        if payload.type_id is not None and str(payload.type_id).strip() != cur_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Тип товара нельзя изменить после создания")

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(["is_deleted = 1", "deleted_at = ?", "deleted_by_id = ?"])
            values.extend([now, admin["id"]])
        elif payload.is_deleted is False:
            fields.extend(["is_deleted = 0", "deleted_at = NULL", "deleted_by_id = NULL"])
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.client_id is not None:
            if str(payload.client_id).strip() == "":
                fields.append("client_id = ?")
                values.append(None)
                target_client_id = None
            else:
                cid = _optional_active_client(connection, payload.client_id)
                fields.append("client_id = ?")
                values.append(cid)
                target_client_id = cid
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        fill_empty_line_sku: str | None = None
        provided_sku = payload.sku_base.strip() if payload.sku_base is not None else None
        if cur_pending:
            # Товар «ожидает SKU»: дозаполнение базового SKU присваивает его товару и
            # всем вариантам, снимая признак ожидания.
            if provided_sku:
                new_sku = _normalize_sku(provided_sku)
                if target_client_id is not None and _sku_taken_for_client_except_product(connection, new_sku, target_client_id, item_id):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Базовый штрих-код уже занят у этого клиента")
                _assign_variant_skus_from_base(connection, product_id=item_id, new_base_sku=new_sku, updated_at=now, client_id=target_client_id)
                fields.append("sku = ?")
                values.append(new_sku)
                fields.append("sku_pending = 0")
                fill_empty_line_sku = new_sku
            elif payload.sku_pending is False:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите SKU, чтобы снять ожидание")
        else:
            if provided_sku and provided_sku != cur_sku:
                new_sku = _normalize_sku(provided_sku)
                if target_client_id is not None and _sku_taken_for_client_except_product(connection, new_sku, target_client_id, item_id):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Базовый штрих-код уже занят у этого клиента")
                _rebase_variant_skus_for_new_product_base(connection, product_id=item_id, old_base_sku=cur_sku, new_base_sku=new_sku, updated_at=now, client_id=target_client_id)
                fields.append("sku = ?")
                values.append(new_sku)
                fill_empty_line_sku = new_sku
            elif target_client_id is not None and target_client_id != cur_client_id:
                if _sku_taken_for_client_except_product(connection, cur_sku, target_client_id, item_id):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Базовый штрих-код уже занят у этого клиента")
        if "weight_grams" in payload.model_fields_set:
            fields.append("weight_grams = ?")
            values.append(payload.weight_grams)
        if "items_per_box" in payload.model_fields_set:
            fields.append("items_per_box = ?")
            values.append(payload.items_per_box)
        if "boxes_per_pallet" in payload.model_fields_set:
            fields.append("boxes_per_pallet = ?")
            values.append(payload.boxes_per_pallet)
        if payload.image_urls is not None:
            urls = [str(u).strip() for u in payload.image_urls if str(u).strip()]
            fields.append("gallery_json = ?")
            values.append(json.dumps(urls, ensure_ascii=False) if urls else None)
            fields.append("image_url = ?")
            values.append(urls[0] if urls else None)
        if not fields:
            raise HTTPException(status_code=400, detail="Нет данных для обновления")
        fields.extend(["updated_at = ?", "updated_by_id = ?"])
        values.extend([now, admin["id"], item_id])
        try:
            connection.execute(f"UPDATE products SET {', '.join(fields)} WHERE id = ?", tuple(values))
            if target_client_id != cur_client_id:
                connection.execute(
                    "UPDATE product_variants SET client_id = ?, updated_at = ? WHERE product_id = ?",
                    (target_client_id, now, item_id),
                )
            if payload.is_deleted is True:
                _soft_delete_variants_for_product(connection, item_id, admin["id"], now)
            if fill_empty_line_sku:
                _fill_empty_line_sku_snapshots(connection, product_id=item_id, sku=fill_empty_line_sku)
            connection.commit()
        except IntegrityError as exc:
            connection.rollback()
            raise HTTPException(status_code=400, detail="Базовый штрих-код или SKU варианта уже существует") from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


@router.delete("/products/{item_id}", response_model=MessageResponse)
def delete_product(item_id: str, admin=Depends(_get_strict_admin)):
    _ = admin
    with get_connection() as connection:
        exists = connection.execute("SELECT id FROM products WHERE id = ?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Товар не найден")
        used_in_receipts = connection.execute(
            "SELECT 1 FROM receipt_lines WHERE product_id = ? LIMIT 1", (item_id,)
        ).fetchone()
        if used_in_receipts:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Нельзя удалить товар: по нему есть поступления",
            )
        had_stock = connection.execute(
            "SELECT 1 FROM zone_relocations WHERE product_id = ? LIMIT 1", (item_id,)
        ).fetchone()
        if had_stock:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Нельзя удалить товар: он был на остатках",
            )
        used_in_shipments = connection.execute(
            "SELECT 1 FROM shipment_lines WHERE product_id = ? LIMIT 1", (item_id,)
        ).fetchone()
        if used_in_shipments:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Нельзя удалить товар: он участвует в отгрузках",
            )
        connection.execute("DELETE FROM product_barcode_files WHERE product_id = ?", (item_id,))
        connection.execute("DELETE FROM product_barcodes WHERE product_id = ?", (item_id,))
        connection.execute("DELETE FROM product_variants WHERE product_id = ?", (item_id,))
        connection.execute("DELETE FROM products WHERE id = ?", (item_id,))
        connection.commit()
    return MessageResponse(message="Товар удалён")


@router.get("/products/{item_id}/variants", response_model=list[ProductVariantItem])
def list_product_variants(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        exists = connection.execute(
            "SELECT 1 FROM products p WHERE p.id = ? AND COALESCE(p.is_deleted, 0) = 0",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Товар не найден")
        rows = connection.execute(
            f"""
            SELECT v.id, v.color_id, col.name AS color_name,
                   v.size_id, sz.name AS size_name,
                   v.length, v.width, v.height, v.sku, v.images_json, v.is_active,
                   GREATEST(0, COALESCE(b.good_in, 0)) AS stock,
                   GREATEST(0, COALESCE(b.defect_in, 0)) AS defect_qty,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM receipt_lines rl
                       JOIN receipt_docs rd ON rd.id = rl.doc_id
                       WHERE rl.product_id = v.product_id
                         AND rl.color_id IS NOT DISTINCT FROM v.color_id
                         AND rl.size_id IS NOT DISTINCT FROM v.size_id
                         AND rl.is_deleted = 0 AND rd.is_deleted = 0
                   ) THEN 1 ELSE 0 END AS has_receipts
            FROM product_variants v
            LEFT JOIN colors col ON col.id = v.color_id
            LEFT JOIN sizes sz ON sz.id = v.size_id
            LEFT JOIN (
                SELECT product_id, color_id, size_id,
                       SUM(CASE WHEN to_quality='{INV_Q_GOOD}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                         - SUM(CASE WHEN from_quality='{INV_Q_GOOD}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS good_in,
                       SUM(CASE WHEN to_quality='{INV_Q_DEFECT}' AND to_op NOT IN ({_SINKS_SQL}) THEN qty ELSE 0 END)
                         - SUM(CASE WHEN from_quality='{INV_Q_DEFECT}' AND from_op<>'{INV_OP_INTAKE}' THEN qty ELSE 0 END) AS defect_in
                FROM zone_relocations
                WHERE product_id = ?
                GROUP BY product_id, color_id, size_id
            ) b ON b.product_id = v.product_id AND b.color_id IS NOT DISTINCT FROM v.color_id AND b.size_id IS NOT DISTINCT FROM v.size_id
            WHERE v.product_id = ? AND COALESCE(v.is_deleted, 0) = 0
            ORDER BY LOWER(v.sku) ASC
            """,
            (
                item_id,
                item_id,
            ),
        ).fetchall()
        bc_rows = connection.execute(
            "SELECT id, variant_id, barcode, source FROM product_barcodes "
            "WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at",
            (item_id,),
        ).fetchall()
        file_rows = connection.execute(
            "SELECT id, barcode_id, filename, url, mime_type FROM product_barcode_files "
            "WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at",
            (item_id,),
        ).fetchall()
    files_by_barcode: dict[str, list[ProductBarcodeFileItem]] = {}
    for f in file_rows:
        files_by_barcode.setdefault(str(f["barcode_id"]), []).append(
            ProductBarcodeFileItem(
                id=str(f["id"]),
                filename=str(f["filename"]),
                url=str(f["url"]),
                mime_type=str(f["mime_type"]) if f["mime_type"] else None,
            )
        )
    barcodes_by_variant: dict[str, list[ProductBarcodeItem]] = {}
    for b in bc_rows:
        barcodes_by_variant.setdefault(str(b["variant_id"] or ""), []).append(
            ProductBarcodeItem(
                id=str(b["id"]),
                barcode=str(b["barcode"]),
                source=str(b["source"]) if b["source"] else None,
                files=files_by_barcode.get(str(b["id"]), []),
            )
        )
    return [
        ProductVariantItem(
            id=str(r["id"]),
            color_id=r["color_id"],
            color_name=r["color_name"],
            dimension=ProductVariantDimension(length=float(r["length"]), width=float(r["width"]), height=float(r["height"])),
            size_id=str(r["size_id"]) if r["size_id"] else None,
            size_name=r["size_name"],
            sku=str(r["sku"]),
            barcodes=barcodes_by_variant.get(str(r["id"]), []),
            images=_decode_images_json(r["images_json"]),
            is_active=bool(r["is_active"]),
            stock=max(0, int(r["stock"])),
            defect_qty=max(0, int(r["defect_qty"])),
            has_receipts=bool(r["has_receipts"]),
        )
        for r in rows
    ]


@router.patch("/products/{item_id}/variants", response_model=MessageResponse)
def patch_product_variants(item_id: str, payload: ProductVariantsPatchRequest, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        try:
            _sync_product_variants_from_request(connection, item_id, payload, admin["id"])
            connection.execute(
                "UPDATE products SET updated_at = ?, updated_by_id = ? WHERE id = ?",
                (_now(), admin["id"], item_id),
            )
            connection.commit()
        except IntegrityError as exc:
            connection.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SKU варианта уже занят") from exc
    return MessageResponse(message="Варианты сохранены")


@router.post("/products/{item_id}/variants/{variant_id}/change-identity", response_model=MessageResponse)
def change_product_variant_identity(
    item_id: str,
    variant_id: str,
    payload: VariantIdentityChangeRequest,
    admin=Depends(get_current_admin),
):
    with get_connection() as connection:
        result = change_variant_identity(
            connection,
            item_id,
            variant_id,
            color_id=payload.color_id,
            size_id=payload.size_id,
            sku=payload.sku,
            admin_id=str(admin["id"]),
        )
        connection.commit()
    return result


def _apply_product_variant_deleted_flag(item_id: str, variant_id: str, admin_id: str, *, is_deleted: bool) -> MessageResponse:
    now = _now()
    with get_connection() as connection:
        prod = connection.execute("SELECT COALESCE(is_deleted, 0) AS is_deleted FROM products WHERE id = ?", (item_id,)).fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail="Товар не найден")
        if bool(prod["is_deleted"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Товар удалён. Восстановите товар перед изменением вариантов.")
        row = connection.execute(
            "SELECT id, COALESCE(is_deleted, 0) AS del, color_id, size_id FROM product_variants WHERE id = ? AND product_id = ?",
            (variant_id, item_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Вариант не найден")
        if is_deleted:
            if row["del"]:
                return MessageResponse(message="Вариант отключён")
            has_receipts = connection.execute(
                """
                SELECT 1 FROM receipt_lines rl
                JOIN receipt_docs rd ON rd.id = rl.doc_id
                WHERE rl.product_id = ?
                  AND rl.color_id IS NOT DISTINCT FROM ?
                  AND rl.size_id IS NOT DISTINCT FROM ?
                  AND rl.is_deleted = 0 AND rd.is_deleted = 0
                LIMIT 1
                """,
                (item_id, row["color_id"], row["size_id"]),
            ).fetchone()
            if has_receipts:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Нельзя удалить вариант: по нему зафиксированы поступления в системе",
                )
            connection.execute(
                "UPDATE product_variants SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?, updated_at = ?, is_active = 0 WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
                (now, admin_id, now, variant_id, item_id),
            )
        else:
            if not row["del"]:
                return MessageResponse(message="Вариант восстановлен")
            connection.execute(
                "UPDATE product_variants SET is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL, updated_at = ?, is_active = 1 WHERE id = ? AND product_id = ?",
                (now, variant_id, item_id),
            )
        connection.execute("UPDATE products SET updated_at = ?, updated_by_id = ? WHERE id = ?", (now, admin_id, item_id))
        connection.commit()
    return MessageResponse(message="Вариант отключён" if is_deleted else "Вариант восстановлен")


@router.patch("/products/{item_id}/variants/{variant_id}", response_model=MessageResponse)
def patch_product_variant(item_id: str, variant_id: str, payload: ProductVariantDeletePatchRequest, admin=Depends(get_current_admin)):
    return _apply_product_variant_deleted_flag(item_id, variant_id, admin["id"], is_deleted=payload.is_deleted)


@router.delete("/products/{item_id}/variants/{variant_id}", response_model=MessageResponse)
def delete_product_variant(item_id: str, variant_id: str, admin=Depends(get_current_admin)):
    return _apply_product_variant_deleted_flag(item_id, variant_id, admin["id"], is_deleted=True)


@router.get("/product-variants/find", response_model=ProductVariantFindResponse)
def find_product_variant_for_receipt(
    sku: str = Query(""),
    color_id: str = Query(""),
    size_id: str | None = Query(None),
    user=Depends(get_current_manager),
):
    _ = user
    sku_t = sku.strip()
    cid = color_id.strip()
    if not sku_t or not cid:
        return ProductVariantFindResponse(found=False)
    with get_connection() as connection:
        row, needs_size = _find_variant_row_for_receipt(connection, sku_t, cid, size_id)
        if row is None:
            return ProductVariantFindResponse(found=False, needs_size=needs_size)
        urls = _product_card_image_urls(row["gallery_json"], row["image_url"])
        first_img = urls[0] if urls else None
        return ProductVariantFindResponse(
            found=True,
            needs_size=False,
            variant=ProductVariantFindItem(
                variant_id=str(row["variant_id"]),
                product_id=str(row["product_id"]),
                product_name=str(row["product_name"]),
                product_type_name=str(row["product_type_name"]) if row["product_type_name"] else None,
                client_name=str(row["client_name"]).strip() if row["client_name"] else None,
                requires_size=bool(row["requires_size"]),
                sku=str(row["variant_sku"]),
                color_id=str(row["color_id"]),
                size_id=str(row["size_id"]) if row["size_id"] else None,
                length=float(row["length"]),
                width=float(row["width"]),
                height=float(row["height"]),
                first_image_url=first_img,
            ),
        )


@router.post("/products/{item_id}/barcodes", response_model=MessageResponse)
def add_product_barcode(item_id: str, payload: ProductBarcodeAdd, admin=Depends(get_current_admin)):
    code = payload.barcode.strip()
    source = (payload.source or "").strip() or None
    if not code:
        raise HTTPException(status_code=400, detail="Укажите штрих-код")
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM products WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Товар не найден")
        dup = _find_barcode_owner(connection, code)
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Штрих-код уже присвоен: {_barcode_owner_label(dup)}")
        if payload.variant_id:
            variant = connection.execute(
                "SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
                (payload.variant_id, item_id),
            ).fetchone()
            if not variant:
                raise HTTPException(status_code=404, detail="Вариант не найден")
            variant_id = str(variant["id"])
        else:
            variants = connection.execute(
                "SELECT id FROM product_variants WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0 LIMIT 2",
                (item_id,),
            ).fetchall()
            if len(variants) != 1:
                raise HTTPException(status_code=400, detail="Укажите вариант: у товара несколько цвето-размеров")
            variant_id = str(variants[0]["id"])
        bc_id = str(uuid4())
        try:
            connection.execute(
                "INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, created_at, created_by, is_deleted) "
                "VALUES (?,?,?,?,?,?,?,0)",
                (bc_id, item_id, variant_id, code, source, _now(), str(admin["id"])),
            )
            connection.commit()
        except IntegrityError as exc:
            connection.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Штрих-код уже присвоен другому варианту") from exc
    return MessageResponse(message=bc_id)


@router.delete("/products/{item_id}/barcodes/{barcode_id}", response_model=MessageResponse)
def delete_product_barcode(item_id: str, barcode_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM product_barcodes "
            "WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
            (barcode_id, item_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Штрих-код не найден")
        connection.execute(
            "UPDATE product_barcodes SET is_deleted = 1 WHERE id = ?",
            (barcode_id,),
        )
        connection.execute(
            "UPDATE product_barcode_files SET is_deleted = 1 WHERE barcode_id = ?",
            (barcode_id,),
        )
        connection.commit()
    return MessageResponse(message="Штрих-код снят")


_BARCODE_FILE_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}


@router.post("/products/{item_id}/barcodes/{barcode_id}/files", response_model=MessageResponse)
async def add_product_barcode_file(
    item_id: str,
    barcode_id: str,
    file: UploadFile = File(...),
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    admin=Depends(get_current_admin),
):
    """Этикетка кода: PDF или фото ШК в карточке товара."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = Path(file.filename).suffix.lower()
    if ext not in _BARCODE_FILE_EXTS:
        raise HTTPException(status_code=400, detail="Допустимы файлы: pdf, png, jpg, jpeg")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 10 МБ)")
    with get_connection() as connection:
        proceed, stored = begin_idempotent(
            connection, x_request_id, str(admin["id"]), "product_barcode_file_upload"
        )
        if not proceed:
            return MessageResponse(**stored)
        bc = connection.execute(
            "SELECT id FROM product_barcodes WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
            (barcode_id, item_id),
        ).fetchone()
        if not bc:
            raise HTTPException(status_code=404, detail="Штрих-код не найден")
        saved_filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / saved_filename
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        tmp_path.write_bytes(data)
        tmp_path.rename(file_path)
        file_id = str(uuid4())
        connection.execute(
            "INSERT INTO product_barcode_files (id, product_id, barcode_id, filename, url, mime_type, created_at, created_by, is_deleted) "
            "VALUES (?,?,?,?,?,?,?,?,0)",
            (file_id, item_id, barcode_id, file.filename, f"/uploads/{saved_filename}",
             file.content_type or None, _now(), str(admin["id"])),
        )
        finish_idempotent(connection, x_request_id, {"message": file_id})
        connection.commit()
    return MessageResponse(message=file_id)


@router.delete("/products/{item_id}/barcodes/{barcode_id}/files/{file_id}", response_model=MessageResponse)
def delete_product_barcode_file(item_id: str, barcode_id: str, file_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM product_barcode_files "
            "WHERE id = ? AND barcode_id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
            (file_id, barcode_id, item_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Файл не найден")
        connection.execute(
            "UPDATE product_barcode_files SET is_deleted = 1 WHERE id = ?", (file_id,)
        )
        connection.commit()
    return MessageResponse(message="Файл удалён")


@router.get("/products/{item_id}/files", response_model=list[ProductFileItem])
def list_product_files(item_id: str, user=Depends(get_current_warehouse)):
    """Этикетки товара плоским списком — для выбора в документах (склад читает).
    Цвет/размер варианта нужны, чтобы строка документа фильтровала свои этикетки."""
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT f.id, pb.barcode, pb.variant_id,
                   v.color_id, v.size_id, col.name AS color_name, sz.name AS size_name,
                   f.filename, f.url, f.mime_type
            FROM product_barcode_files f
            JOIN product_barcodes pb ON pb.id = f.barcode_id
            LEFT JOIN product_variants v ON v.id = pb.variant_id
            LEFT JOIN colors col ON col.id = v.color_id
            LEFT JOIN sizes sz ON sz.id = v.size_id
            WHERE f.product_id = ?
              AND COALESCE(f.is_deleted, 0) = 0
              AND COALESCE(pb.is_deleted, 0) = 0
            ORDER BY f.created_at
            """,
            (item_id,),
        ).fetchall()
    return [
        ProductFileItem(
            id=str(r["id"]),
            barcode=str(r["barcode"]),
            variant_id=str(r["variant_id"]) if r["variant_id"] else None,
            color_id=str(r["color_id"]) if r["color_id"] else None,
            size_id=str(r["size_id"]) if r["size_id"] else None,
            color_name=str(r["color_name"]) if r["color_name"] else None,
            size_name=str(r["size_name"]) if r["size_name"] else None,
            filename=str(r["filename"]),
            url=str(r["url"]),
            mime_type=str(r["mime_type"]) if r["mime_type"] else None,
        )
        for r in rows
    ]


@router.post("/products/barcode-labels", response_model=BarcodeLabelsResponse)
def make_barcode_labels(payload: BarcodeLabelsRequest, user=Depends(get_current_shipment_viewer)):
    """Печатные формы ШК по вариантам: площадки отдают только цифры, картинку рисуем сами.

    Ничего не сохраняется — этикетка считается на каждый запрос печати. Право то же,
    что на просмотр документов: печать этикетки ничего не меняет, а точки входа —
    приёмка рейса и задача упаковки, где работает и начальник смены."""
    _ = user
    with get_connection() as connection:
        return build_barcode_labels(connection, payload.items, all_codes=payload.all_codes)


@router.get("/products/by-barcode/{code}", response_model=BarcodeLookupResponse)
def lookup_product_by_barcode(code: str, user=Depends(get_current_warehouse)):
    """Сканер кладовщика: штрих-код → вариант товара. found=false, если не найден."""
    _ = user
    bc = (code or "").strip()
    if not bc:
        return BarcodeLookupResponse(found=False)
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.sku,
                   v.color_id, col.name AS color_name,
                   v.size_id, sz.name AS size_name,
                   p.client_id, cl.name AS client_name
            FROM product_barcodes pb
            JOIN product_variants v ON v.id = pb.variant_id
            JOIN products p ON p.id = pb.product_id
            LEFT JOIN colors col ON col.id = v.color_id
            LEFT JOIN sizes sz ON sz.id = v.size_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            WHERE pb.barcode = ?
              AND COALESCE(pb.is_deleted, 0) = 0
              AND COALESCE(v.is_deleted, 0) = 0
              AND COALESCE(p.is_deleted, 0) = 0
            LIMIT 1
            """,
            (bc,),
        ).fetchone()
    if not row:
        return BarcodeLookupResponse(found=False)
    return BarcodeLookupResponse(
        found=True,
        match=BarcodeMatch(
            variant_id=str(row["variant_id"]),
            product_id=str(row["product_id"]),
            product_name=str(row["product_name"]),
            sku=str(row["sku"]),
            color_id=str(row["color_id"]) if row["color_id"] else None,
            color_name=str(row["color_name"]) if row["color_name"] else None,
            size_id=str(row["size_id"]) if row["size_id"] else None,
            size_name=str(row["size_name"]) if row["size_name"] else None,
            client_id=str(row["client_id"]) if row["client_id"] else None,
            client_name=str(row["client_name"]).strip() if row["client_name"] else None,
        ),
    )


# ---------------------------------------------------------------------------
# Массовая загрузка товаров из Excel: шаблон → проверка → применение
# ---------------------------------------------------------------------------

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(content: bytes, *, filename_ru: str, filename_ascii: str) -> Response:
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition":
                f'attachment; filename="{filename_ascii}"; filename*=UTF-8\'\'{quote(filename_ru)}',
        },
    )


def _import_status_label(summary: dict) -> str:
    if summary["rows_with_errors"]:
        return f"Есть ошибки: {summary['rows_with_errors']} из {summary['rows_total']}"
    if not summary["variants_new"]:
        return "Нечего импортировать: все позиции уже заведены"
    return "Готов к импорту"


def _load_import_batch(connection, batch_id: str, user_id: str):
    row = connection.execute(
        "SELECT * FROM product_import_batches WHERE id = ?", (str(batch_id).strip(),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Файл импорта не найден или устарел")
    if str(row["created_by"]) != str(user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к файлу импорта")
    return row


@router.get("/products/bulk-import/template")
def download_product_import_template(user=Depends(get_current_manager)):
    _ = user
    with get_connection() as connection:
        content = build_product_import_template_bytes(connection)
    return _xlsx_response(
        content,
        filename_ru="Шаблон загрузки товаров.xlsx",
        filename_ascii="products-import-template.xlsx",
    )


@router.post("/products/bulk-import/preview", response_model=ProductImportPreviewResponse)
async def preview_product_import(
    client_id: str = Form(...),
    file: UploadFile = File(...),
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    filename = (file.filename or "").strip() or "upload.xlsx"
    if import_file_kind(filename) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неподдерживаемый формат файла. Нужен .xlsx, .xlsm или .xls",
        )
    raw = await file.read()
    rows = parse_product_import_workbook(raw, filename=filename)

    with get_connection() as connection:
        cid = _require_active_client(connection, client_id)
        proceed, stored = begin_idempotent(connection, x_request_id, str(user["id"]), "product_import_preview")
        if not proceed:
            return ProductImportPreviewResponse(**stored)
        plan = build_product_import_plan(connection, client_id=cid, rows=rows)
        batch_id = str(uuid4())
        connection.execute(
            "INSERT INTO product_import_batches "
            "(id, client_id, file_name, status, rows_json, summary_json, created_at, created_by) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                batch_id, cid, filename, PRODUCT_IMPORT_STATUS_PREVIEW,
                json.dumps(rows, ensure_ascii=False),
                json.dumps(plan["summary"], ensure_ascii=False),
                _now(), str(user["id"]),
            ),
        )
        client_row = connection.execute("SELECT name FROM clients WHERE id = ?", (cid,)).fetchone()
        result = ProductImportPreviewResponse(
            import_id=batch_id,
            client_id=cid,
            client_name=str(client_row["name"]) if client_row else None,
            file_name=filename,
            status_label=_import_status_label(plan["summary"]),
            summary=ProductImportSummary(**plan["summary"]),
            rows=[ProductImportRowItem(**r) for r in plan["rows"]],
        )
        finish_idempotent(connection, x_request_id, result.model_dump())
        connection.commit()
    return result


@router.post("/products/bulk-import/{batch_id}/commit", response_model=ProductImportCommitResponse)
def commit_product_import(
    batch_id: str,
    partial: bool = Query(False, description="Если true — записываются только корректные строки"),
    x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
    user=Depends(get_current_manager),
):
    uid = str(user["id"])
    with get_connection() as connection:
        proceed, stored = begin_idempotent(connection, x_request_id, uid, "product_import_commit")
        if not proceed:
            return ProductImportCommitResponse(**stored)
        batch = _load_import_batch(connection, batch_id, uid)
        if str(batch["status"]) == PRODUCT_IMPORT_STATUS_COMMITTED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот файл уже загружен")

        # План пересобирается по живой БД: между проверкой и импортом SKU или
        # штрих-код мог занять кто-то другой.
        plan = build_product_import_plan(
            connection, client_id=str(batch["client_id"]), rows=json.loads(batch["rows_json"])
        )
        summary = plan["summary"]
        if summary["rows_with_errors"] and not partial:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="В файле есть ошибки. Исправьте файл или импортируйте только корректные строки",
            )
        if not summary["variants_new"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нечего импортировать: новых товаров и вариантов в файле нет",
            )
        apply_product_import_plan(connection, plan, user_id=uid)
        connection.execute(
            "UPDATE product_import_batches SET status = ?, summary_json = ?, committed_at = ? WHERE id = ?",
            (PRODUCT_IMPORT_STATUS_COMMITTED, json.dumps(summary, ensure_ascii=False), _now(), str(batch["id"])),
        )
        result = ProductImportCommitResponse(
            message=f"Создано товаров {summary['products_new']}, вариантов {summary['variants_new']}",
            summary=ProductImportSummary(**summary),
        )
        finish_idempotent(connection, x_request_id, result.model_dump())
        connection.commit()
    return result


@router.get("/products/bulk-import/{batch_id}/report")
def download_product_import_report(batch_id: str, user=Depends(get_current_manager)):
    with get_connection() as connection:
        batch = _load_import_batch(connection, batch_id, str(user["id"]))
        plan = build_product_import_plan(
            connection, client_id=str(batch["client_id"]), rows=json.loads(batch["rows_json"])
        )
        content = build_product_import_report_bytes(plan)
    return _xlsx_response(
        content,
        filename_ru="Проверка загрузки товаров.xlsx",
        filename_ascii="products-import-report.xlsx",
    )
