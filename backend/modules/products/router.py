from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from psycopg.errors import IntegrityConstraintViolation

from config import (
    PRODUCT_LIST_SORT_COLUMNS,
    RECEIPT_OP_DEFECT_CORRECTION,
    RECEIPT_OP_DEFECT_FIX,
    RECEIPT_OP_RECEIVING,
    RECEIPT_OP_RECEIVING_CORRECTION,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_ON_REVIEW,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_STATUS_SHIPPED,
    UPLOADS_DIR,
    MAX_UPLOAD_BYTES,
)
from dbconn import get_connection
from modules.auth.service import get_current_admin, get_current_manager

from .schemas import (
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
)
from .service import (
    _build_variant_rows_for_create,
    _decode_images_json,
    _encode_images_json,
    _find_variant_row_for_receipt,
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
    _sku_taken_globally_except_product,
    _soft_delete_variants_for_product,
    _sync_product_variants_from_request,
    _product_type_flags,
)

router = APIRouter(tags=["products"])


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
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if search is not None and str(search).strip():
        like = _ci_substring_like_param(str(search))
        conds.append("(fold_ci(COALESCE(p.name, '')) LIKE ? OR fold_ci(COALESCE(p.sku, '')) LIKE ?)")
        params.extend([like, like])
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
    order_sql = _order_sql_from_sort_param(sort, PRODUCT_LIST_SORT_COLUMNS) or "p.created_at DESC"
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
                   COALESCE(pt.requires_color, 0) AS requires_color,
                   COALESCE(pt.requires_size, 0) AS requires_size,
                   p.client_id, c.name AS client_name,
                   COALESCE(vcnt.cnt, 0) AS variant_count,
                   p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
                   p.deleted_at, p.image_url, p.gallery_json,
                   p.created_at, p.updated_at,
                   creator.email AS created_by, editor.email AS updated_by, deleter.email AS deleted_by
            {join_sql}
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
            """
            SELECT p.id, p.name, p.type_id, pt.name AS type_name, p.sku AS sku_base,
                   COALESCE(pt.requires_color, 0) AS requires_color,
                   COALESCE(pt.requires_size, 0) AS requires_size,
                   p.client_id, c.name AS client_name,
                   COALESCE(vcnt.cnt, 0) AS variant_count,
                   p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
                   p.deleted_at, p.image_url, p.gallery_json,
                   p.created_at, p.updated_at,
                   creator.email AS created_by, editor.email AS updated_by, deleter.email AS deleted_by
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN (
                SELECT product_id, COUNT(*) AS cnt FROM product_variants WHERE COALESCE(is_deleted, 0) = 0 GROUP BY product_id
            ) vcnt ON vcnt.product_id = p.id
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
            LEFT JOIN users deleter ON deleter.id = p.deleted_by_id
            WHERE p.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=404, detail="Товар не найден")
    return _row_to_product_item(row)


@router.post("/products/upload-image", response_model=ProductUploadImageResponse)
async def upload_product_image(image: UploadFile = File(...), admin=Depends(get_current_admin)):
    _ = admin
    if not image.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
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
    return ProductUploadImageResponse(url=f"/uploads/{filename}")


@router.post("/products", response_model=MessageResponse)
async def create_product(
    meta: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    admin=Depends(get_current_admin),
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
        tid = _require_active_product_type(connection, inner.type_id)
        requires_color, requires_size = _product_type_flags(connection, tid)
        if requires_color and not parsed.colors:
            raise HTTPException(status_code=400, detail="Для этого типа товара выберите хотя бы один цвет")
        cid = _require_active_client(connection, inner.client_id)
        variant_rows = _build_variant_rows_for_create(
            connection,
            requires_size=requires_size,
            sku_base=inner.sku_base,
            color_ids=parsed.colors,
            dimensions=parsed.dimensions,
        )
        pid = str(uuid4())
        now = _now()
        preview_url = image_urls[0] if image_urls else None
        gallery_ser = json.dumps(image_urls, ensure_ascii=False) if image_urls else None
        try:
            connection.execute(
                """
                INSERT INTO products (id, name, type_id, client_id, supplier_id, sku, image_url, gallery_json, is_active, created_at, creator_id)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (pid, _normalize_name(inner.name), tid, cid, _normalize_sku(inner.sku_base), preview_url, gallery_ser, 1 if inner.is_active else 0, now, admin["id"]),
            )
            for vr in variant_rows:
                connection.execute(
                    """
                    INSERT INTO product_variants (id, product_id, color_id, size_id, length, width, height, sku, images_json, is_active, created_at, is_deleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
                    """,
                    (str(uuid4()), pid, vr["color_id"], vr["size_id"], vr["length"], vr["width"], vr["height"], vr["sku"], vr["images_json"], now),
                )
            connection.commit()
        except IntegrityConstraintViolation as exc:
            connection.rollback()
            raise HTTPException(status_code=400, detail="Базовый штрих-код или SKU варианта уже существует") from exc
    return MessageResponse(message="Создано")


@router.patch("/products/{item_id}", response_model=MessageResponse)
def update_product(item_id: str, payload: ProductUpdateRequest, admin=Depends(get_current_admin)):
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del, sku, type_id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=404, detail="Товар не найден")
        is_del = bool(meta["del"])
        cur_sku = str(meta["sku"])
        cur_type = str(meta["type_id"])
        if is_del and payload.is_deleted is not False:
            if any([payload.name, payload.type_id, payload.client_id, payload.is_active, payload.sku_base, payload.image_urls]):
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
            else:
                cid = _optional_active_client(connection, payload.client_id)
                fields.append("client_id = ?")
                values.append(cid)
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if payload.sku_base is not None:
            new_sku = _normalize_sku(payload.sku_base)
            if new_sku != cur_sku:
                if _sku_taken_globally_except_product(connection, new_sku, item_id):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Базовый штрих-код уже занят")
                _rebase_variant_skus_for_new_product_base(connection, product_id=item_id, old_base_sku=cur_sku, new_base_sku=new_sku, updated_at=now)
                fields.append("sku = ?")
                values.append(new_sku)
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
            if payload.is_deleted is True:
                _soft_delete_variants_for_product(connection, item_id, admin["id"], now)
            connection.commit()
        except IntegrityConstraintViolation as exc:
            connection.rollback()
            raise HTTPException(status_code=400, detail="Базовый штрих-код или SKU варианта уже существует") from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


@router.delete("/products/{item_id}", response_model=MessageResponse)
def delete_product(item_id: str, admin=Depends(get_current_admin)):
    now = _now()
    with get_connection() as connection:
        exists = connection.execute("SELECT id FROM products WHERE id = ?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        connection.execute(
            "UPDATE products SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?, updated_at = ?, updated_by_id = ? WHERE id = ?",
            (now, admin["id"], now, admin["id"], item_id),
        )
        _soft_delete_variants_for_product(connection, item_id, admin["id"], now)
        connection.commit()
    return MessageResponse(message="Удалено")


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
            """
            SELECT v.id, v.color_id, col.name AS color_name,
                   v.size_id, sz.name AS size_name,
                   v.length, v.width, v.height, v.sku, v.images_json, v.is_active,
                   GREATEST(0, COALESCE(b.good_in, 0) - COALESCE(sg.shipped_good, 0)) AS stock,
                   GREATEST(0, COALESCE(b.defect_in, 0) - COALESCE(sd.shipped_defect, 0)) AS defect_qty,
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
                SELECT l.product_id, l.color_id, l.size_id,
                       SUM(COALESCE((
                           SELECT COALESCE(
                               (SELECT o2.qty FROM receipt_ops o2 WHERE o2.line_id = l.id AND o2.op_type = ? ORDER BY o2.created_at DESC LIMIT 1),
                               (SELECT SUM(o2.qty) FROM receipt_ops o2 WHERE o2.line_id = l.id AND o2.op_type = ?)
                           )
                       ), 0)) AS good_in,
                       SUM(COALESCE((
                           SELECT COALESCE(
                               (SELECT o2.qty FROM receipt_ops o2 WHERE o2.line_id = l.id AND o2.op_type = ? ORDER BY o2.created_at DESC LIMIT 1),
                               (SELECT SUM(o2.qty) FROM receipt_ops o2 WHERE o2.line_id = l.id AND o2.op_type = ?)
                           )
                       ), 0)) AS defect_in
                FROM receipt_lines l
                JOIN receipt_docs d ON d.id = l.doc_id
                WHERE l.product_id = ? AND l.is_deleted = 0
                  AND d.is_deleted = 0 AND d.status IN (?, ?)
                GROUP BY l.product_id, l.color_id, l.size_id
            ) b ON b.product_id = v.product_id AND b.color_id IS NOT DISTINCT FROM v.color_id AND b.size_id IS NOT DISTINCT FROM v.size_id
            LEFT JOIN (
                SELECT sl.product_id, sl.color_id, sl.size_id, SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)) AS shipped_good
                FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
                WHERE sl.product_id = ? AND sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = ? AND sd.cargo_type = ?
                GROUP BY sl.product_id, sl.color_id, sl.size_id
            ) sg ON sg.product_id = v.product_id AND sg.color_id IS NOT DISTINCT FROM v.color_id AND sg.size_id IS NOT DISTINCT FROM v.size_id
            LEFT JOIN (
                SELECT sl.product_id, sl.color_id, sl.size_id, SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)) AS shipped_defect
                FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
                WHERE sl.product_id = ? AND sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = ? AND sd.cargo_type = ?
                GROUP BY sl.product_id, sl.color_id, sl.size_id
            ) sd ON sd.product_id = v.product_id AND sd.color_id IS NOT DISTINCT FROM v.color_id AND sd.size_id IS NOT DISTINCT FROM v.size_id
            WHERE v.product_id = ? AND COALESCE(v.is_deleted, 0) = 0
            ORDER BY LOWER(v.sku) ASC
            """,
            (
                RECEIPT_OP_RECEIVING_CORRECTION,
                RECEIPT_OP_RECEIVING,
                RECEIPT_OP_DEFECT_CORRECTION,
                RECEIPT_OP_DEFECT_FIX,
                item_id,
                RECEIPT_STATUS_DONE,
                RECEIPT_STATUS_ON_REVIEW,
                item_id,
                SHIPMENT_STATUS_SHIPPED,
                SHIPMENT_CARGO_GOOD,
                item_id,
                SHIPMENT_STATUS_SHIPPED,
                SHIPMENT_CARGO_DEFECT,
                item_id,
            ),
        ).fetchall()
    return [
        ProductVariantItem(
            id=str(r["id"]),
            color_id=r["color_id"],
            color_name=r["color_name"],
            dimension=ProductVariantDimension(length=float(r["length"]), width=float(r["width"]), height=float(r["height"])),
            size_id=str(r["size_id"]) if r["size_id"] else None,
            size_name=r["size_name"],
            sku=str(r["sku"]),
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
        except IntegrityConstraintViolation as exc:
            connection.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SKU варианта уже занят") from exc
    return MessageResponse(message="Варианты сохранены")


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
