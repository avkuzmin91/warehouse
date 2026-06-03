from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException, status
from psycopg.errors import IntegrityConstraintViolation

from config import PRODUCT_LIST_SORT_COLUMNS, UPLOADS_DIR, MAX_UPLOAD_BYTES
from dbconn import get_connection

from .schemas import (
    ProductCreateDimensionBlock,
    ProductCreateMeta,
    ProductItem,
    ProductListResponse,
    ProductUpdateRequest,
    ProductVariantDimension,
    ProductVariantFindItem,
    ProductVariantFindResponse,
    ProductVariantItem,
    ProductVariantsPatchRequest,
    MessageResponse,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле Название обязательно")
    return normalized


def _normalize_sku(sku: str) -> str:
    normalized = sku.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле Штрих-код товара обязательно")
    return normalized


def _fold_ci_str(x: object) -> str:
    if x is None:
        return ""
    return str(x).lower().replace("ё", "е")


def _ci_substring_like_param(raw: str) -> str:
    return f"%{_fold_ci_str(str(raw).strip())}%"


def _order_sql_from_sort_param(sort: str | None, allowed: dict[str, str]) -> str | None:
    if not sort or not str(sort).strip():
        return None
    head, sep, tail = str(sort).strip().rpartition("_")
    if not sep or tail.lower() not in ("asc", "desc"):
        return None
    if head not in allowed:
        return None
    return f"{allowed[head]} {tail.upper()}"


def _decode_images_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except json.JSONDecodeError:
        return []


def _encode_images_json(urls: list[str]) -> str:
    return json.dumps(urls, ensure_ascii=False)


def _product_card_image_urls(gallery_json_val: str | None, image_url_val: str | None) -> list[str]:
    if gallery_json_val and str(gallery_json_val).strip():
        try:
            v = json.loads(str(gallery_json_val))
            if isinstance(v, list) and v:
                return [str(x).strip() for x in v if str(x).strip()]
        except json.JSONDecodeError:
            pass
    if image_url_val and str(image_url_val).strip():
        return [str(image_url_val).strip()]
    return []


def _product_image_extension(content_type: str | None, original_filename: str | None) -> str | None:
    if not content_type and not original_filename:
        return None
    if content_type:
        ct = content_type.split(";", 1)[0].strip().lower()
        if ct in ("image/jpeg", "image/jpg"):
            return ".jpg"
        if ct == "image/png":
            return ".png"
        if ct in ("image/heic", "image/heif"):
            return ".heic"
    if original_filename:
        parts = original_filename.rsplit(".", 1)
        if len(parts) == 2 and parts[1].lower() in ("heic", "heif"):
            return f".{parts[1].lower()}"
    return None


def _sku_token_from_label(name: str) -> str:
    s = re.sub(r"\s+", "-", str(name).strip().upper())
    s = re.sub(r"[^0-9A-ZА-ЯЁ\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-") or "X"
    return s[:18]


def _color_size_labels_for_skus(
    connection: Any, color_ids: set[str], size_ids: set[str]
) -> tuple[dict[str, str], dict[str, str]]:
    colors: dict[str, str] = {}
    if color_ids:
        placeholders = ",".join("?" * len(color_ids))
        for r in connection.execute(
            f"SELECT id, name FROM colors WHERE id IN ({placeholders})",
            list(color_ids),
        ).fetchall():
            colors[str(r["id"])] = str(r["name"])
    sizes: dict[str, str] = {}
    if size_ids:
        placeholders = ",".join("?" * len(size_ids))
        for r in connection.execute(
            f"SELECT id, name FROM sizes WHERE id IN ({placeholders})",
            list(size_ids),
        ).fetchall():
            sizes[str(r["id"])] = str(r["name"])
    return colors, sizes


def _variant_identity_key(
    sku_base: str, color_id: str, size_id: str | None, *, requires_size: bool
) -> tuple[str, str, str]:
    base = str(sku_base).strip()
    cid = str(color_id).strip().lower()
    sid = str(size_id).strip().lower() if size_id and requires_size else ""
    return (base, cid, sid)


def _norm_variant_row_id(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s.lower() if s else None


def _variant_sku_in_use(
    connection: Any,
    sku: str,
    exclude_variant_id: str | None,
    client_id: str | None,
) -> bool:
    q = """
        SELECT 1
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.sku = ?
          AND COALESCE(v.is_deleted, 0) = 0
          AND COALESCE(p.is_deleted, 0) = 0
    """
    params: list[object] = [sku]
    if client_id is not None:
        q += " AND p.client_id = ?"
        params.append(client_id)
    if exclude_variant_id:
        q += " AND v.id != ?"
        params.append(exclude_variant_id)
    return connection.execute(q, tuple(params)).fetchone() is not None


def _sku_taken_for_client_except_product(
    connection: Any,
    sku: str,
    client_id: str,
    exclude_product_id: str | None,
) -> bool:
    product_sql = """
        SELECT 1
        FROM products
        WHERE sku = ?
          AND client_id = ?
          AND COALESCE(is_deleted, 0) = 0
    """
    product_params: list[object] = [sku, client_id]
    if exclude_product_id:
        product_sql += " AND id != ?"
        product_params.append(exclude_product_id)
    if connection.execute(product_sql, tuple(product_params)).fetchone():
        return True

    variant_sql = """
        SELECT 1
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.sku = ?
          AND p.client_id = ?
          AND COALESCE(v.is_deleted, 0) = 0
          AND COALESCE(p.is_deleted, 0) = 0
    """
    variant_params: list[object] = [sku, client_id]
    if exclude_product_id:
        variant_sql += " AND v.product_id != ?"
        variant_params.append(exclude_product_id)
    return connection.execute(variant_sql, tuple(variant_params)).fetchone() is not None


def _generate_variant_sku_for_patch(
    connection: Any,
    *,
    sku_base: str,
    color_id: str,
    size_id: str | None,
    exclude_variant_id: str | None,
    client_id: str | None,
) -> str:
    base_norm = _normalize_sku(sku_base)
    color_labels, size_labels = _color_size_labels_for_skus(
        connection, {color_id}, {size_id} if size_id else set()
    )
    ct = _sku_token_from_label(color_labels.get(color_id, "C"))
    if size_id:
        st = _sku_token_from_label(size_labels.get(size_id, "S"))
        candidate = f"{base_norm}-{ct}-{st}"
    else:
        candidate = f"{base_norm}-{ct}"
    sku = candidate
    salt = 0
    while True:
        q = """
            SELECT v.id
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            WHERE v.sku = ?
              AND COALESCE(v.is_deleted, 0) = 0
              AND COALESCE(p.is_deleted, 0) = 0
        """
        params: list[object] = [sku]
        if client_id is not None:
            q += " AND p.client_id = ?"
            params.append(client_id)
        if exclude_variant_id:
            q += " AND v.id != ?"
            params.append(exclude_variant_id)
        if not connection.execute(q, tuple(params)).fetchone():
            return sku
        salt += 1
        sku = f"{candidate}-{salt}"


def _sku_dim_token(length: float, width: float, height: float) -> str:
    a, b, c = int(round(float(length))), int(round(float(width))), int(round(float(height)))
    return f"{a}X{b}X{c}"


def _require_active_product_type(connection: Any, type_id: str) -> str:
    tid = type_id.strip()
    row = connection.execute(
        "SELECT id FROM product_types WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (tid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Тип товара: недопустимое или неактивное значение")
    return tid


def _require_active_client(connection: Any, raw: str | None) -> str:
    if raw is None or str(raw).strip() == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле Клиент обязательно")
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Клиент: недопустимое или неактивное значение")
    return cid


def _optional_active_client(connection: Any, raw: str | None) -> str | None:
    if raw is None or str(raw).strip() == "":
        return None
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Клиент: недопустимое или неактивное значение")
    return cid


def _require_active_color_id(connection: Any, cid: str) -> str:
    rid = cid.strip()
    row = connection.execute(
        "SELECT id FROM colors WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (rid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Цвет: недопустимое или неактивное значение")
    return rid


def _require_active_size_id(connection: Any, sid: str) -> str:
    rid = sid.strip()
    row = connection.execute(
        "SELECT id FROM sizes WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (rid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Размер: недопустимое или неактивное значение")
    return rid


def _product_type_flags(connection: Any, type_id: str) -> tuple[bool, bool]:
    row = connection.execute(
        "SELECT requires_color, requires_size FROM product_types WHERE id = ?",
        (type_id,),
    ).fetchone()
    if not row:
        return False, False
    return bool(row["requires_color"]), bool(row["requires_size"])


def _rebase_variant_skus_for_new_product_base(
    connection: Any,
    *,
    product_id: str,
    old_base_sku: str,
    new_base_sku: str,
    updated_at: str,
    client_id: str | None,
) -> None:
    old_b = old_base_sku.strip()
    new_b = new_base_sku.strip()
    rows = connection.execute(
        "SELECT id, sku, color_id, size_id FROM product_variants WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY LOWER(sku) ASC",
        (product_id,),
    ).fetchall()
    computed: list[tuple[str, str, str, str | None]] = []
    for r in rows:
        vid = str(r["id"])
        cur = str(r["sku"]).strip()
        color_id = str(r["color_id"])
        sz_id = str(r["size_id"]) if r["size_id"] else None
        if cur == old_b or cur.startswith(old_b + "-"):
            prop = new_b + cur[len(old_b):] if cur.startswith(old_b + "-") else new_b
        else:
            prop = _generate_variant_sku_for_patch(connection, sku_base=new_b, color_id=color_id, size_id=sz_id, exclude_variant_id=vid, client_id=client_id)
        if prop == new_b:
            prop = _generate_variant_sku_for_patch(connection, sku_base=new_b, color_id=color_id, size_id=sz_id, exclude_variant_id=vid, client_id=client_id)
        computed.append((vid, prop, color_id, sz_id))

    used_local: set[str] = set()
    finals: list[tuple[str, str]] = []
    for vid, prop, color_id, sz_id in computed:
        p = prop
        n = 0
        while n < 500:
            n += 1
            if p not in used_local and not _variant_sku_in_use(connection, p, vid, client_id):
                break
            p = _generate_variant_sku_for_patch(connection, sku_base=new_b, color_id=color_id, size_id=sz_id, exclude_variant_id=vid, client_id=client_id)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не удалось подобрать уникальные штрих-коды вариантов")
        used_local.add(p)
        finals.append((vid, p))

    for vid, p in finals:
        connection.execute("UPDATE product_variants SET sku = ?, updated_at = ? WHERE id = ?", (p, updated_at, vid))


def _soft_delete_variants_for_product(connection: Any, product_id: str, admin_id: str, ts: str) -> None:
    connection.execute(
        """
        UPDATE product_variants
        SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?, updated_at = ?, is_active = 0
        WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0
        """,
        (ts, admin_id, ts, product_id),
    )


def _build_variant_rows_for_create(
    connection: Any,
    *,
    requires_size: bool,
    sku_base: str,
    client_id: str,
    color_ids: list[str],
    dimensions: list[ProductCreateDimensionBlock],
) -> list[dict]:
    seen_keys: set[tuple] = set()
    out: list[dict] = []
    used_skus: set[str] = set()
    size_ids_collect: set[str] = set()
    for block in dimensions:
        for s in block.sizes:
            size_ids_collect.add(s)

    if not dimensions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите хотя бы один блок габаритов")

    color_labels, size_labels = _color_size_labels_for_skus(connection, set(color_ids), size_ids_collect)

    if requires_size:
        for block in dimensions:
            for cid in color_ids:
                for szid in block.sizes:
                    key = (cid, szid)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    ct = _sku_token_from_label(color_labels.get(cid, "C"))
                    st = _sku_token_from_label(size_labels.get(szid, "S"))
                    sku = f"{sku_base}-{ct}-{st}"
                    n = 0
                    base_sku = sku
                    while sku in used_skus or _variant_sku_in_use(connection, sku, None, client_id):
                        n += 1
                        sku = f"{base_sku}-{n}"
                    used_skus.add(sku)
                    out.append({
                        "color_id": cid, "size_id": szid,
                        "length": float(block.length), "width": float(block.width), "height": float(block.height),
                        "sku": sku, "images_json": "[]",
                    })
    else:
        multi_block = len(dimensions) > 1
        for block in dimensions:
            for cid in color_ids:
                ct = _sku_token_from_label(color_labels.get(cid, "C"))
                if multi_block:
                    dim_tok = _sku_dim_token(block.length, block.width, block.height)
                    sku = f"{sku_base}-{ct}-{dim_tok}"
                else:
                    sku = f"{sku_base}-{ct}"
                key = (cid, round(block.length, 4), round(block.width, 4), round(block.height, 4))
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                n = 0
                base_sku = sku
                while sku in used_skus or _variant_sku_in_use(connection, sku, None, client_id):
                    n += 1
                    sku = f"{base_sku}-{n}"
                used_skus.add(sku)
                out.append({
                    "color_id": cid, "size_id": None,
                    "length": float(block.length), "width": float(block.width), "height": float(block.height),
                    "sku": sku, "images_json": "[]",
                })
    return out


def _sync_product_variants_from_request(
    connection: Any,
    product_id: str,
    payload: ProductVariantsPatchRequest,
    admin_id: str,
) -> None:
    prow = connection.execute(
        """
        SELECT p.sku AS sku_base, p.client_id, COALESCE(pt.requires_size, 0) AS requires_size,
               COALESCE(p.is_deleted, 0) AS is_deleted
        FROM products p
        JOIN product_types pt ON pt.id = p.type_id
        WHERE p.id = ?
        """,
        (product_id,),
    ).fetchone()
    if not prow:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if bool(prow["is_deleted"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Товар удалён. Восстановите его перед редактированием вариантов.")
    sku_base = str(prow["sku_base"])
    client_id = str(prow["client_id"]) if prow["client_id"] else None
    requires_size = bool(prow["requires_size"])
    now = _now()

    existing_rows = connection.execute(
        "SELECT id FROM product_variants WHERE product_id = ?",
        (product_id,),
    ).fetchall()
    existing_by_norm: dict[str, str] = {}
    for r in existing_rows:
        raw_id = str(r["id"])
        n = _norm_variant_row_id(raw_id)
        if n:
            existing_by_norm[n] = raw_id
    incoming_norm = {_norm_variant_row_id(str(v.id)) for v in payload.variants if v.id}
    incoming_norm.discard(None)
    for norm_id, raw_id in existing_by_norm.items():
        if norm_id not in incoming_norm:
            connection.execute(
                """
                UPDATE product_variants
                SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?, updated_at = ?, is_active = 0
                WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0
                """,
                (now, admin_id, now, raw_id, product_id),
            )

    dup_detail = (
        "Дублируется сочетание штрих-кода товара, цвета и размера"
        if requires_size
        else "Дублируется сочетание штрих-кода товара и цвета"
    )
    rows_to_apply: list[tuple] = []
    identity_keys: list[tuple[str, str, str]] = []
    for item in payload.variants:
        eff_size = item.size_id if requires_size else None
        if requires_size and (eff_size is None or str(eff_size).strip() == ""):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Для этого типа товара укажите размер варианта")
        if item.color_id:
            _require_active_color_id(connection, item.color_id)
        if eff_size:
            _require_active_size_id(connection, eff_size)
        identity_keys.append(_variant_identity_key(sku_base, item.color_id or "", eff_size, requires_size=requires_size))
        rows_to_apply.append((item, eff_size))

    if len(identity_keys) != len(set(identity_keys)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=dup_detail)

    for item, eff_size in rows_to_apply:
        imgs = _encode_images_json(item.images)
        if item.id:
            rid = str(item.id)
            own = connection.execute(
                "SELECT id, color_id, size_id FROM product_variants WHERE id = ? AND product_id = ?",
                (rid, product_id),
            ).fetchone()
            if not own:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный вариант")
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
                (product_id, own["color_id"], own["size_id"]),
            ).fetchone()
            if has_receipts:
                if item.color_id != own["color_id"] or eff_size != own["size_id"]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Нельзя изменить цвет или размер варианта: по нему зафиксированы поступления",
                    )
            new_sku = (
                _normalize_sku(item.sku)
                if item.sku and str(item.sku).strip()
                else _generate_variant_sku_for_patch(connection, sku_base=sku_base, color_id=item.color_id, size_id=eff_size, exclude_variant_id=rid, client_id=client_id)
            )
            if _variant_sku_in_use(connection, new_sku, rid, client_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SKU варианта уже занят у этого клиента")
            connection.execute(
                """
                UPDATE product_variants
                SET color_id = ?, size_id = ?, length = ?, width = ?, height = ?,
                    sku = ?, images_json = ?, is_active = ?, updated_at = ?, client_id = ?,
                    is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL
                WHERE id = ? AND product_id = ?
                """,
                (item.color_id, eff_size, float(item.dimension.length), float(item.dimension.width), float(item.dimension.height), new_sku, imgs, 1 if item.is_active else 0, now, client_id, rid, product_id),
            )
        else:
            new_sku = (
                _normalize_sku(item.sku)
                if item.sku and str(item.sku).strip()
                else _generate_variant_sku_for_patch(connection, sku_base=sku_base, color_id=item.color_id, size_id=eff_size, exclude_variant_id=None, client_id=client_id)
            )
            if _variant_sku_in_use(connection, new_sku, None, client_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SKU варианта уже занят у этого клиента")
            connection.execute(
                """
                INSERT INTO product_variants (id, product_id, client_id, color_id, size_id, length, width, height, sku, images_json, is_active, created_at, is_deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (str(uuid4()), product_id, client_id, item.color_id, eff_size, float(item.dimension.length), float(item.dimension.width), float(item.dimension.height), new_sku, imgs, 1 if item.is_active else 0, now),
            )


def _find_variant_row_for_receipt(
    connection: Any,
    sku_norm: str,
    color_id: str,
    size_id: str | None,
) -> tuple[Mapping[str, Any] | None, bool]:
    rows = connection.execute(
        """
        SELECT v.id AS variant_id, v.product_id, v.sku AS variant_sku, p.sku AS product_sku,
               v.color_id, v.size_id, v.length, v.width, v.height,
               p.name AS product_name, p.gallery_json, p.image_url,
               COALESCE(pt.requires_size, 0) AS requires_size,
               pt.name AS product_type_name,
               cl.name AS client_name
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        WHERE COALESCE(v.is_deleted, 0) = 0 AND COALESCE(p.is_deleted, 0) = 0
          AND COALESCE(v.is_active, 1) = 1 AND COALESCE(p.is_active, 1) = 1
          AND v.color_id = ?
          AND (
            LOWER(TRIM(COALESCE(v.sku, ''))) = LOWER(?)
            OR LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(?)
          )
        """,
        (color_id, sku_norm, sku_norm),
    ).fetchall()
    if not rows:
        return None, False
    req_size = bool(rows[0]["requires_size"])
    if not req_size:
        if len(rows) != 1:
            return None, False
        return rows[0], False
    user_sz = (size_id or "").strip()
    if len(rows) == 1:
        r = rows[0]
        vs = str(r["size_id"] or "")
        if not user_sz:
            return None, True
        if vs != user_sz:
            return None, True
        return r, False
    if not user_sz:
        return None, True
    matches = [r for r in rows if str(r["size_id"] or "") == user_sz]
    if len(matches) != 1:
        return None, True
    return matches[0], False


def _resolve_actuality_filter(connection: Any, actuality_id: str | None) -> bool | None:
    if actuality_id is None:
        return None
    aid = str(actuality_id).strip()
    if not aid:
        return None
    row = connection.execute(
        "SELECT maps_is_active FROM record_actuality WHERE id = ?",
        (aid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимое значение фильтра актуальности")
    return bool(row["maps_is_active"])


def _row_to_product_item(row: Mapping[str, Any]) -> ProductItem:
    return ProductItem(
        id=row["id"],
        name=row["name"],
        type_id=row["type_id"],
        type_name=row["type_name"],
        sku_base=row["sku_base"],
        requires_color=bool(row["requires_color"]),
        requires_size=bool(row["requires_size"]),
        client_id=row["client_id"],
        client_name=row["client_name"],
        variant_count=int(row["variant_count"] or 0),
        is_active=bool(row["is_active"]),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        image_urls=_product_card_image_urls(row["gallery_json"], row["image_url"]),
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )
