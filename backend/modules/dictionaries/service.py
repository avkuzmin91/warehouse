from __future__ import annotations

from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException, status
from psycopg import IntegrityError

from config import (
    DICTIONARY_TABLES,
    CLIENT_LIST_SORT_COLUMNS,
    DICTIONARY_ORDER_SQL,
    DICTIONARY_SORTABLE_TABLES,
    SIZE_LIST_SORT_COLUMNS,
    COLOR_LIST_SORT_COLUMNS,
)
from dbconn import escape_like, get_connection

from .schemas import (
    ClientStoreCreateRequest,
    DictionaryBulkCreateRequest,
    DictionaryBulkCreateResponse,
    DictionaryReorderRequest,
    ClientStoreItem,
    ClientStoreUpdateRequest,
    DictionaryBaseItem,
    DictionaryCreateRequest,
    DictionaryListResponse,
    DictionaryUpdateRequest,
    MessageResponse,
    ProductTypeDictionaryItem,
    ProductTypeCreateRequest,
    ProductTypeListResponse,
    ProductTypeUpdateRequest,
    SizeCreateRequest,
    SizeItem,
    SizeListResponse,
    SizeUpdateRequest,
)
from utils import now_iso as _now



def _ensure_dictionary_table(table_name: str) -> None:
    if table_name not in DICTIONARY_TABLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый справочник")


def _sort_order_sql(table_name: str) -> str:
    return "d.sort_order" if table_name in DICTIONARY_SORTABLE_TABLES else "NULL AS sort_order"


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле Название обязательно")
    return normalized


def _normalize_color_hex(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    raw = s[1:] if s.startswith("#") else s
    if len(raw) not in (3, 6) or any(ch not in "0123456789abcdefABCDEF" for ch in raw):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hex цвета должен быть в формате #RGB или #RRGGBB")
    return f"#{raw.lower()}"


def _fold_ci_str(x: object) -> str:
    if x is None:
        return ""
    return str(x).lower().replace("ё", "е")


def _ci_substring_like_param(raw: str) -> str:
    return f"%{escape_like(_fold_ci_str(str(raw).strip()))}%"


def _order_sql_from_sort_param(sort: str | None, allowed: dict[str, str]) -> str | None:
    if not sort or not str(sort).strip():
        return None
    head, sep, tail = str(sort).strip().rpartition("_")
    if not sep or tail.lower() not in ("asc", "desc"):
        return None
    if head not in allowed:
        return None
    return f"{allowed[head]} {tail.upper()}"


def _normalize_date_yyyy_mm_dd(raw: str | None, param_name: str) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Параметр {param_name}: ожидается дата в формате YYYY-MM-DD",
        )
    return s


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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимое значение фильтра актуальности",
        )
    return bool(row["maps_is_active"])


def _dict_row_to_item(row: Mapping[str, Any]) -> DictionaryBaseItem:
    rent = row.get("rent_monthly_kopecks")
    return DictionaryBaseItem(
        id=row["id"],
        name=row["name"],
        color_hex=row.get("color_hex"),
        rent_monthly_kopecks=int(rent) if rent is not None else None,
        is_packing_zone=bool(row.get("is_packing_zone") or 0),
        is_shipping_zone=bool(row.get("is_shipping_zone") or 0),
        is_active=bool(row["is_active"]),
        sort_order=row.get("sort_order"),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _client_store_row_to_item(row: Mapping[str, Any]) -> ClientStoreItem:
    return ClientStoreItem(
        id=row["id"],
        client_id=row["client_id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        mp_account_id=row["mp_account_id"],
        mp_account_name=row["mp_account_name"],
        mp_marketplace=row["mp_marketplace"],
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _size_row_to_item(row: Mapping[str, Any]) -> SizeItem:
    return SizeItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        sort_order=row["sort_order"],
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _product_type_row_to_item(row: Mapping[str, Any]) -> ProductTypeDictionaryItem:
    return ProductTypeDictionaryItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        sort_order=row.get("sort_order"),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
        requires_color=bool(row["requires_color"]),
        requires_size=bool(row["requires_size"]),
    )


# ── Generic dictionary CRUD ─────────────────────────────────────────────────

def get_dictionary_item(table_name: str, item_id: str, *, include_deleted: bool = False) -> DictionaryBaseItem:
    _ensure_dictionary_table(table_name)
    color_hex_sql = "d.color_hex" if table_name == "colors" else "NULL AS color_hex"
    rent_sql = "d.rent_monthly_kopecks" if table_name == "own_warehouses" else "NULL AS rent_monthly_kopecks"
    sort_order_sql = _sort_order_sql(table_name)
    with get_connection() as connection:
        row = connection.execute(
            f"""
            SELECT d.id, d.name, d.is_active, COALESCE(d.is_deleted, 0) AS is_deleted,
                   {color_hex_sql}, {rent_sql}, {sort_order_sql},
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    return _dict_row_to_item(row)


def create_dictionary_item(table_name: str, payload: DictionaryCreateRequest, creator_id: str) -> MessageResponse:
    _ensure_dictionary_table(table_name)
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    color_hex = _normalize_color_hex(payload.color_hex) if table_name == "colors" else None
    with get_connection() as connection:
        try:
            if table_name == "colors":
                connection.execute(
                    "INSERT INTO colors (id, name, color_hex, is_active, sort_order, created_at, creator_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (item_id, name, color_hex, 1 if payload.is_active else 0, payload.sort_order, _now(), creator_id),
                )
            elif table_name == "own_warehouses":
                now = _now()
                connection.execute(
                    "INSERT INTO own_warehouses (id, name, rent_monthly_kopecks, is_active, sort_order, created_at, creator_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (item_id, name, payload.rent_monthly_kopecks, 1 if payload.is_active else 0, payload.sort_order, now, creator_id),
                )
                # Стартовая ставка → запись в effective-dated истории (источник правды
                # для начислений аренды); колонка выше остаётся кэшем «на сегодня».
                if payload.rent_monthly_kopecks and int(payload.rent_monthly_kopecks) > 0:
                    connection.execute(
                        "INSERT INTO warehouse_rent_rates "
                        "(id, warehouse_id, rent_monthly_kopecks, effective_from, note, created_at, created_by) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (str(uuid4()), item_id, int(payload.rent_monthly_kopecks), now[:10], None, now, creator_id),
                    )
            elif table_name in DICTIONARY_SORTABLE_TABLES:
                connection.execute(
                    f"INSERT INTO {table_name} (id, name, is_active, sort_order, created_at, creator_id) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (item_id, name, 1 if payload.is_active else 0, payload.sort_order, _now(), creator_id),
                )
            else:
                connection.execute(
                    f"INSERT INTO {table_name} (id, name, is_active, created_at, creator_id) VALUES (?, ?, ?, ?, ?)",
                    (item_id, name, 1 if payload.is_active else 0, _now(), creator_id),
                )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def create_dictionary_items_bulk(
    table_name: str, payload: DictionaryBulkCreateRequest, creator_id: str
) -> DictionaryBulkCreateResponse:
    """Заводит список значений одним действием, продолжая нумерацию sort_order.

    Каждое значение пишется отдельной транзакцией: занятое имя не должно
    отменять весь ряд — оно попадает в «пропущено», остальные создаются.
    """
    _ensure_dictionary_table(table_name)
    names: list[str] = []
    seen: set[str] = set()
    for raw in payload.names:
        value = str(raw).strip()
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(value)
    if not names:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не указано ни одного значения")

    sortable = table_name in DICTIONARY_SORTABLE_TABLES
    created = 0
    skipped: list[str] = []
    with get_connection() as connection:
        next_order = None
        if sortable:
            row = connection.execute(f"SELECT MAX(sort_order) AS mx FROM {table_name}").fetchone()
            next_order = int(row["mx"] or 0) + 10
        for value in names:
            item_id = str(uuid4())
            now = _now()
            try:
                if table_name == "product_types":
                    connection.execute(
                        "INSERT INTO product_types "
                        "(id, name, is_active, requires_color, requires_size, sort_order, created_at, creator_id) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            # requires_color=1 — как в create_product_type: заведение
                            # пачкой не должно давать типы с другими атрибутами
                            item_id, value, 1 if payload.is_active else 0, 1,
                            1 if payload.requires_size else 0,
                            next_order, now, creator_id,
                        ),
                    )
                elif sortable:
                    connection.execute(
                        f"INSERT INTO {table_name} (id, name, is_active, sort_order, created_at, creator_id) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (item_id, value, 1 if payload.is_active else 0, next_order, now, creator_id),
                    )
                else:
                    connection.execute(
                        f"INSERT INTO {table_name} (id, name, is_active, created_at, creator_id) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (item_id, value, 1 if payload.is_active else 0, now, creator_id),
                    )
                connection.commit()
            except IntegrityError:
                connection.rollback()
                skipped.append(value)
                continue
            created += 1
            if next_order is not None:
                next_order += 10

    message = f"Создано: {created}"
    if skipped:
        message += f", пропущено (уже есть): {len(skipped)}"
    return DictionaryBulkCreateResponse(message=message, created=created, skipped=skipped)


def reorder_dictionary_items(
    table_name: str, payload: DictionaryReorderRequest, editor_id: str
) -> MessageResponse:
    """Переставляет значения по списку id: sort_order = позиция × 10.

    Клиент присылает порядок видимой страницы. Значения, в неё не попавшие,
    дописываются в хвост в текущем порядке — иначе перестановка на первой
    странице перемешала бы невидимый остаток справочника.
    """
    _ensure_dictionary_table(table_name)
    if table_name not in DICTIONARY_SORTABLE_TABLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Справочник не поддерживает порядок")
    now = _now()
    with get_connection() as connection:
        rows = connection.execute(
            f"SELECT d.id FROM {table_name} d WHERE COALESCE(d.is_deleted, 0) = 0 ORDER BY {DICTIONARY_ORDER_SQL}"
        ).fetchall()
        existing = [str(r["id"]) for r in rows]
        known = set(existing)
        ordered: list[str] = []
        seen: set[str] = set()
        for raw in payload.ids:
            item_id = str(raw)
            if item_id in known and item_id not in seen:
                seen.add(item_id)
                ordered.append(item_id)
        if not ordered:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не найдено значений для перестановки")
        ordered.extend(item_id for item_id in existing if item_id not in seen)
        for index, item_id in enumerate(ordered):
            connection.execute(
                f"UPDATE {table_name} SET sort_order = ?, updated_at = ?, updated_by_id = ? WHERE id = ?",
                ((index + 1) * 10, now, editor_id, item_id),
            )
        connection.commit()
    return MessageResponse(message="Порядок обновлён")


def update_dictionary_item(
    table_name: str, item_id: str, payload: DictionaryUpdateRequest, editor_id: str
) -> MessageResponse:
    _ensure_dictionary_table(table_name)
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            f"SELECT COALESCE(is_deleted, 0) AS del FROM {table_name} WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None or payload.sort_order is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запись удалена")

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(["is_deleted = 1", "deleted_at = ?", "deleted_by_id = ?"])
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(["is_deleted = 0", "deleted_at = NULL", "deleted_by_id = NULL"])
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if table_name == "colors" and "color_hex" in payload.model_fields_set:
            fields.append("color_hex = ?")
            values.append(_normalize_color_hex(payload.color_hex))
        if table_name == "own_warehouses" and "rent_monthly_kopecks" in payload.model_fields_set:
            fields.append("rent_monthly_kopecks = ?")
            values.append(payload.rent_monthly_kopecks)
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if table_name in DICTIONARY_SORTABLE_TABLES:
            if payload.clear_sort_order:
                fields.append("sort_order = NULL")
            elif payload.sort_order is not None:
                fields.append("sort_order = ?")
                values.append(int(payload.sort_order))

        if not fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет данных для обновления")
        fields.extend(["updated_at = ?", "updated_by_id = ?"])
        values.extend([now, editor_id, item_id])
        try:
            connection.execute(
                f"UPDATE {table_name} SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


def delete_dictionary_item(table_name: str, item_id: str, admin_id: str) -> MessageResponse:
    return update_dictionary_item(table_name, item_id, DictionaryUpdateRequest(is_deleted=True), admin_id)


def _ensure_client_exists(connection: Any, client_id: str) -> None:
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (client_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Клиент не найден")


def list_client_stores(client_id: str, *, include_deleted: bool = False) -> list[ClientStoreItem]:
    with get_connection() as connection:
        _ensure_client_exists(connection, client_id)
        cond = "" if include_deleted else "AND COALESCE(s.is_deleted, 0) = 0"
        rows = connection.execute(
            f"""
            SELECT s.id, s.client_id, s.name, s.is_active, COALESCE(s.is_deleted, 0) AS is_deleted,
                   s.deleted_at, s.created_at, s.updated_at, s.mp_account_id,
                   acc.name AS mp_account_name, acc.marketplace AS mp_marketplace,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM client_stores s
            LEFT JOIN mp_accounts acc ON acc.id = s.mp_account_id AND COALESCE(acc.is_deleted, 0) = 0
            LEFT JOIN users creator ON creator.id = s.creator_id
            LEFT JOIN users editor ON editor.id = s.updated_by_id
            LEFT JOIN users deleter ON deleter.id = s.deleted_by_id
            WHERE s.client_id = ? {cond}
            ORDER BY COALESCE(s.is_deleted, 0) ASC, LOWER(s.name) ASC
            """,
            (client_id,),
        ).fetchall()
    return [_client_store_row_to_item(row) for row in rows]


def _resolve_store_mp_account(connection, client_id: str, mp_account_id: str | None) -> str | None:
    """Кабинет МП магазина: пустая строка — снять привязку, иначе кабинет того же клиента."""
    value = (mp_account_id or "").strip()
    if not value:
        return None
    row = connection.execute(
        "SELECT client_id FROM mp_accounts WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (value,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подключение не найдено")
    if str(row["client_id"]) != str(client_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Кабинет маркетплейса принадлежит другому клиенту",
        )
    return value


def create_client_store(client_id: str, payload: ClientStoreCreateRequest, creator_id: str) -> MessageResponse:
    store_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        _ensure_client_exists(connection, client_id)
        account_id = _resolve_store_mp_account(connection, client_id, payload.mp_account_id)
        try:
            connection.execute(
                """
                INSERT INTO client_stores (id, client_id, name, is_active, mp_account_id, created_at, creator_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (store_id, client_id, name, 1 if payload.is_active else 0, account_id, _now(), creator_id),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Магазин с таким названием уже есть у клиента",
            ) from exc
    return MessageResponse(message=store_id)


def update_client_store(
    client_id: str, store_id: str, payload: ClientStoreUpdateRequest, editor_id: str
) -> MessageResponse:
    now = _now()
    with get_connection() as connection:
        _ensure_client_exists(connection, client_id)
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM client_stores WHERE id = ? AND client_id = ?",
            (store_id, client_id),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Магазин не найден")
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None or payload.mp_account_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Магазин удалён. Восстановите его перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Магазин удалён")

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(["is_deleted = 1", "deleted_at = ?", "deleted_by_id = ?"])
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(["is_deleted = 0", "deleted_at = NULL", "deleted_by_id = NULL"])
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if payload.mp_account_id is not None:
            fields.append("mp_account_id = ?")
            values.append(_resolve_store_mp_account(connection, client_id, payload.mp_account_id))
        if not fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет данных для обновления")
        fields.extend(["updated_at = ?", "updated_by_id = ?"])
        values.extend([now, editor_id, store_id, client_id])
        try:
            connection.execute(
                f"UPDATE client_stores SET {', '.join(fields)} WHERE id = ? AND client_id = ?",
                tuple(values),
            )
            if payload.name is not None:
                connection.execute(
                    "UPDATE shipment_lines SET store_name = ? WHERE store_id = ?",
                    (_normalize_name(payload.name), store_id),
                )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Магазин с таким названием уже есть у клиента",
            ) from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


def delete_client_store(client_id: str, store_id: str, admin_id: str) -> MessageResponse:
    return update_client_store(client_id, store_id, ClientStoreUpdateRequest(is_deleted=True), admin_id)


def list_dictionary_items_page(
    table_name: str,
    page: int,
    limit: int,
    *,
    search: str | None,
    actuality_id: str | None,
    date_from: str | None,
    date_to: str | None,
    sort: str | None,
    sort_columns: dict[str, str],
    default_order: str,
    include_deleted: bool = False,
) -> DictionaryListResponse:
    _ensure_dictionary_table(table_name)
    color_hex_sql = "d.color_hex" if table_name == "colors" else "NULL AS color_hex"
    rent_sql = "d.rent_monthly_kopecks" if table_name == "own_warehouses" else "NULL AS rent_monthly_kopecks"
    packing_sql = "COALESCE(d.is_packing_zone, 0) AS is_packing_zone" if table_name == "unloading_zones" else "0 AS is_packing_zone"
    shipping_sql = "COALESCE(d.is_shipping_zone, 0) AS is_shipping_zone" if table_name == "unloading_zones" else "0 AS is_shipping_zone"
    sort_order_sql = _sort_order_sql(table_name)
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if search is not None and str(search).strip():
        conds.append("fold_ci(d.name) LIKE ?")
        params.append(_ci_substring_like_param(str(search)))
    if date_from is not None and str(date_from).strip():
        conds.append("substr(d.created_at, 1, 10) >= ?")
        params.append(str(date_from).strip())
    if date_to is not None and str(date_to).strip():
        conds.append("substr(d.created_at, 1, 10) <= ?")
        params.append(str(date_to).strip())
    if not include_deleted:
        conds.append("COALESCE(d.is_deleted, 0) = 0")
    where_sql = " AND ".join(conds)
    order_sql = _order_sql_from_sort_param(sort, sort_columns) or default_order
    with get_connection() as connection:
        ia = _resolve_actuality_filter(connection, actuality_id)
        if ia is not None:
            conds.append("d.is_active = ?")
            params.append(1 if ia else 0)
            where_sql = " AND ".join(conds)
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt FROM {table_name} d WHERE {where_sql}",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT d.id, d.name, d.is_active, COALESCE(d.is_deleted, 0) AS is_deleted,
                   {color_hex_sql}, {rent_sql}, {packing_sql}, {shipping_sql}, {sort_order_sql},
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return DictionaryListResponse(
        items=[_dict_row_to_item(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


def set_packing_zone(item_id: str) -> MessageResponse:
    """Делает зону единственной «Зоной упаковки» (снимает флаг с остальных)."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM unloading_zones WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Место хранения не найдено")
        connection.execute("UPDATE unloading_zones SET is_packing_zone = CASE WHEN id = ? THEN 1 ELSE 0 END", (item_id,))
        connection.commit()
    return MessageResponse(message="ok")


def set_shipping_zone(item_id: str) -> MessageResponse:
    """Делает зону единственной «Зоной отгрузки» (снимает флаг с остальных)."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM unloading_zones WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Место хранения не найдено")
        connection.execute("UPDATE unloading_zones SET is_shipping_zone = CASE WHEN id = ? THEN 1 ELSE 0 END", (item_id,))
        connection.commit()
    return MessageResponse(message="ok")


# ── Sizes (специфичный список/создание/обновление) ──────────────────────────

def get_size_item(item_id: str, *, include_deleted: bool = False) -> SizeItem:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT d.id, d.name, d.is_active, d.sort_order, COALESCE(d.is_deleted, 0) AS is_deleted,
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM sizes d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    return _size_row_to_item(row)


def list_sizes_page(
    page: int, limit: int, *, name: str | None, actuality_id: str | None, sort: str | None, include_deleted: bool = False
) -> SizeListResponse:
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if name is not None and str(name).strip():
        conds.append("fold_ci(d.name) LIKE ?")
        params.append(_ci_substring_like_param(str(name)))
    if not include_deleted:
        conds.append("COALESCE(d.is_deleted, 0) = 0")
    where_sql = " AND ".join(conds)
    order_sql = _order_sql_from_sort_param(sort, SIZE_LIST_SORT_COLUMNS) or DICTIONARY_ORDER_SQL
    with get_connection() as connection:
        ia = _resolve_actuality_filter(connection, actuality_id)
        if ia is not None:
            conds.append("d.is_active = ?")
            params.append(1 if ia else 0)
            where_sql = " AND ".join(conds)
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt FROM sizes d WHERE {where_sql}",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT d.id, d.name, d.is_active, d.sort_order, COALESCE(d.is_deleted, 0) AS is_deleted,
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM sizes d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return SizeListResponse(
        items=[_size_row_to_item(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


def create_size(payload: SizeCreateRequest, creator_id: str) -> MessageResponse:
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        try:
            connection.execute(
                "INSERT INTO sizes (id, name, is_active, sort_order, created_at, creator_id) VALUES (?, ?, ?, ?, ?, ?)",
                (item_id, name, 1 if payload.is_active else 0, payload.sort_order, _now(), creator_id),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def update_size(item_id: str, payload: SizeUpdateRequest, editor_id: str) -> MessageResponse:
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM sizes WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запись удалена")

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(["is_deleted = 1", "deleted_at = ?", "deleted_by_id = ?"])
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(["is_deleted = 0", "deleted_at = NULL", "deleted_by_id = NULL"])
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if payload.clear_sort_order:
            fields.append("sort_order = NULL")
        elif payload.sort_order is not None:
            fields.append("sort_order = ?")
            values.append(payload.sort_order)
        if not fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет данных для обновления")
        fields.extend(["updated_at = ?", "updated_by_id = ?"])
        values.extend([now, editor_id, item_id])
        try:
            connection.execute(
                f"UPDATE sizes SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


# ── Product types (специфичный CRUD с requires_color/size) ──────────────────

def get_product_type_item(item_id: str, *, include_deleted: bool = False) -> ProductTypeDictionaryItem:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT d.id, d.name, d.is_active, d.sort_order, COALESCE(d.is_deleted, 0) AS is_deleted,
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(d.requires_color, 0) AS requires_color,
                   COALESCE(d.requires_size, 0) AS requires_size,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM product_types d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    return _product_type_row_to_item(row)


def list_product_types_page(
    page: int,
    limit: int,
    *,
    search: str | None,
    actuality_id: str | None,
    date_from: str | None,
    date_to: str | None,
    sort: str | None,
    include_deleted: bool = False,
) -> ProductTypeListResponse:
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if search is not None and str(search).strip():
        conds.append("fold_ci(d.name) LIKE ?")
        params.append(_ci_substring_like_param(str(search)))
    if date_from is not None and str(date_from).strip():
        conds.append("substr(d.created_at, 1, 10) >= ?")
        params.append(str(date_from).strip())
    if date_to is not None and str(date_to).strip():
        conds.append("substr(d.created_at, 1, 10) <= ?")
        params.append(str(date_to).strip())
    if not include_deleted:
        conds.append("COALESCE(d.is_deleted, 0) = 0")
    where_sql = " AND ".join(conds)
    order_sql = _order_sql_from_sort_param(sort, CLIENT_LIST_SORT_COLUMNS) or DICTIONARY_ORDER_SQL
    with get_connection() as connection:
        ia = _resolve_actuality_filter(connection, actuality_id)
        if ia is not None:
            conds.append("d.is_active = ?")
            params.append(1 if ia else 0)
            where_sql = " AND ".join(conds)
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt FROM product_types d WHERE {where_sql}",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT d.id, d.name, d.is_active, d.sort_order, COALESCE(d.is_deleted, 0) AS is_deleted,
                   d.deleted_at, d.created_at, d.updated_at,
                   COALESCE(d.requires_color, 0) AS requires_color,
                   COALESCE(d.requires_size, 0) AS requires_size,
                   COALESCE(NULLIF(creator.display_name, ''), creator.email) AS created_by, COALESCE(NULLIF(editor.display_name, ''), editor.email) AS updated_by, COALESCE(NULLIF(deleter.display_name, ''), deleter.email) AS deleted_by
            FROM product_types d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return ProductTypeListResponse(
        items=[_product_type_row_to_item(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


def create_product_type(payload: ProductTypeCreateRequest, creator_id: str) -> MessageResponse:
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        try:
            connection.execute(
                """
                INSERT INTO product_types
                    (id, name, is_active, requires_color, requires_size, sort_order, created_at, creator_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id, name, 1 if payload.is_active else 0, 1,
                    1 if payload.requires_size else 0, payload.sort_order, _now(), creator_id,
                ),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def update_product_type(item_id: str, payload: ProductTypeUpdateRequest, editor_id: str) -> MessageResponse:
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM product_types WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None or payload.requires_color is not None or payload.requires_size is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запись удалена")

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(["is_deleted = 1", "deleted_at = ?", "deleted_by_id = ?"])
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(["is_deleted = 0", "deleted_at = NULL", "deleted_by_id = NULL"])
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)
        if payload.requires_color is not None:
            fields.append("requires_color = ?")
            values.append(1 if payload.requires_color else 0)
        if payload.requires_size is not None:
            fields.append("requires_size = ?")
            values.append(1 if payload.requires_size else 0)
        if payload.clear_sort_order:
            fields.append("sort_order = NULL")
        elif payload.sort_order is not None:
            fields.append("sort_order = ?")
            values.append(int(payload.sort_order))
        if not fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет данных для обновления")
        fields.extend(["updated_at = ?", "updated_by_id = ?"])
        values.extend([now, editor_id, item_id])
        try:
            connection.execute(
                f"UPDATE product_types SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)
