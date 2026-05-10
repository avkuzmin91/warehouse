from datetime import UTC, date, datetime, timedelta
import io
import json
import re
from pathlib import Path
from urllib.parse import quote
from typing import Any, Mapping
from uuid import uuid4

from dbconn import get_connection
from psycopg.errors import IntegrityConstraintViolation, UndefinedColumn

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

import movements_excel_import as _mei
from fastapi.responses import Response


JWT_SECRET = "replace-this-secret-in-production"
JWT_ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = 60
UPLOADS_DIR = Path(__file__).parent / "uploads"
DICTIONARY_TABLES = {"clients", "colors", "sizes", "product_types", "suppliers"}

# Поступления (op_type = 'in'): в остатках учитываются только со статусом «accepted».
RECEIPT_STATUS_PENDING = "pending"
RECEIPT_STATUS_ACCEPTED = "accepted"

# Отгрузка (op_type = 'out'): в остатках учитываются только «отгружено».
SHIPMENT_STATUS_PENDING = "pending"
SHIPMENT_STATUS_SHIPPED = "shipped"

# Агрегаты с алиасом `o` (inventory_operations o).
SQL_O_NET_QTY = (
    "CASE WHEN o.op_type = 'out' AND COALESCE(o.shipment_status, 'shipped') = 'shipped' THEN -o.quantity "
    "WHEN o.op_type = 'in' AND COALESCE(o.receipt_status, 'accepted') = 'accepted' "
    "THEN o.quantity ELSE 0 END"
)
# Сумма отгруженного количества (для отчётов; не путать с SQL_O_NET_QTY).
SQL_O_SHIPPED_OUT_QTY = (
    "CASE WHEN o.op_type = 'out' AND COALESCE(o.shipment_status, 'shipped') = 'shipped' "
    "THEN o.quantity ELSE 0 END"
)
SQL_O_INFLOW_QTY = (
    "CASE WHEN o.op_type = 'in' AND COALESCE(o.receipt_status, 'accepted') = 'accepted' "
    "THEN o.quantity ELSE 0 END"
)
# Мягкое удаление складских операций (как у справочников).
SQL_WHERE_INV_OP_ACTIVE_O = "COALESCE(o.is_deleted, 0) = 0"

CLIENT_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
SIZE_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
COLOR_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
INVENTORY_OPERATIONS_SORT_COLUMNS: dict[str, str] = {
    "created_at": "o.created_at",
    "receipt_status": "COALESCE(o.receipt_status, 'accepted')",
    "shipment_status": "COALESCE(o.shipment_status, 'shipped')",
    "quantity": "o.quantity",
    "product_name": "LOWER(p.name)",
    "product_type_name": "LOWER(pt.name)",
    "client_name": "LOWER(cl.name)",
    "supplier_name": "LOWER(sp.name)",
    "color_name": "LOWER(col.name)",
    "size_name": "LOWER(sz.name)",
    "variant_sku": "LOWER(TRIM(COALESCE(o.variant_sku, pv.sku, p.sku, '')))",
    "product_sku": "LOWER(TRIM(COALESCE(p.sku, '')))",
    "created_by": "LOWER(u.email)",
}
INVENTORY_BALANCES_SORT_COLUMNS: dict[str, str] = {
    "product_sku": "LOWER(MAX(p.sku))",
    "product_name": "LOWER(MAX(p.name))",
    "product_type_name": "LOWER(MAX(pt.name))",
    "client_name": "LOWER(MAX(cl.name))",
    "supplier_name": "LOWER(MAX(sp.name))",
    "color_name": "LOWER(MAX(col.name))",
    "size_name": "LOWER(MAX(sz.name))",
    "quantity": f"SUM({SQL_O_NET_QTY})",
}
PRODUCT_LIST_SORT_COLUMNS: dict[str, str] = {
    "sku_base": "LOWER(p.sku)",
    "name": "LOWER(p.name)",
    "type": "LOWER(COALESCE(pt.name, ''))",
    "client": "LOWER(COALESCE(c.name, ''))",
    "created_at": "p.created_at",
    "is_active": "p.is_active",
}

# Системный справочник «актуальность записи» для фильтров списков (не показывается в UI справочников).
RECORD_ACTUALITY_YES_ID = "00000000-0000-4000-8000-000000000001"
RECORD_ACTUALITY_NO_ID = "00000000-0000-4000-8000-000000000002"


def _order_sql_from_sort_param(sort: str | None, allowed: dict[str, str]) -> str | None:
    if not sort or not str(sort).strip():
        return None
    head, sep, tail = str(sort).strip().rpartition("_")
    if not sep or tail.lower() not in ("asc", "desc"):
        return None
    field_key = head
    if field_key not in allowed:
        return None
    return f"{allowed[field_key]} {tail.upper()}"


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


def _created_at_for_receipt_date(raw: str | None, *, allow_future: bool = False) -> str:
    """Дата поступления (YYYY-MM-DD) → `created_at` (UTC, полдень); пусто → текущий момент.

    Для статуса «ожидает» допускается будущая дата. Для «принят» — не позже сегодня, если
    `allow_future` ложь.
    """
    if raw is None or not str(raw).strip():
        return _now()
    s = str(raw).strip()
    d = _normalize_date_yyyy_mm_dd(s, "receipt_date")
    if d is None:
        return _now()
    try:
        y, mo, day = (int(d[0:4]), int(d[5:7]), int(d[8:10]))
        chosen = date(y, mo, day)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Некорректная дата поступления",
        )
    if not allow_future and chosen > datetime.now(UTC).date():
        raise HTTPException(
            status_code=400,
            detail="Для принятого поступления дата не может быть позже сегодняшнего дня",
        )
    return datetime(y, mo, day, 12, 0, 0, tzinfo=UTC).isoformat()


def _assert_receipt_posting_day_not_after_today(created_at_val: str | None) -> None:
    """Для статуса «принят» день поступления (по `created_at`) не позже сегодня."""
    if not created_at_val or len(str(created_at_val)) < 10:
        return
    s = str(created_at_val)[:10]
    try:
        y, mo, day = (int(s[0:4]), int(s[5:7]), int(s[8:10]))
        chosen = date(y, mo, day)
    except ValueError:
        return
    if chosen > datetime.now(UTC).date():
        raise HTTPException(
            status_code=400,
            detail="Чтобы принять на склад, укажите дату поступления не позже сегодняшнего дня",
        )


def _created_at_for_shipment_date(raw: str | None, *, allow_future: bool = False) -> str:
    """Дата отгрузки (YYYY-MM-DD) → `created_at` (UTC полдень); пусто → сейчас.

    Для «ожидает отгрузки» — дата может быть в будущем. Для «отгружен» — не позже сегодня.
    """
    if raw is None or not str(raw).strip():
        return _now()
    s = str(raw).strip()
    d = _normalize_date_yyyy_mm_dd(s, "shipment_date")
    if d is None:
        return _now()
    try:
        y, mo, day = (int(d[0:4]), int(d[5:7]), int(d[8:10]))
        chosen = date(y, mo, day)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Некорректная дата отгрузки",
        )
    if not allow_future and chosen > datetime.now(UTC).date():
        raise HTTPException(
            status_code=400,
            detail="Для отгруженной позиции дата отгрузки не может быть позже сегодняшнего дня",
        )
    return datetime(y, mo, day, 12, 0, 0, tzinfo=UTC).isoformat()


def _assert_shipment_posting_day_not_after_today(created_at_val: str | None) -> None:
    """Для статуса «отгружен» день отгрузки (по `created_at`) не позже сегодня."""
    if not created_at_val or len(str(created_at_val)) < 10:
        return
    s = str(created_at_val)[:10]
    try:
        y, mo, day = (int(s[0:4]), int(s[5:7]), int(s[8:10]))
        chosen = date(y, mo, day)
    except ValueError:
        return
    if chosen > datetime.now(UTC).date():
        raise HTTPException(
            status_code=400,
            detail="Чтобы подтвердить отгрузку, укажите дату отгрузки не позже сегодняшнего дня",
        )


bearer_scheme = HTTPBearer()

app = FastAPI(root_path="/api")
app.add_middleware(
    CORSMiddleware,
    # Локальная разработка: любой порт на localhost / 127.0.0.1 (Vite, preview, другой порт)
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
UPLOADS_DIR.mkdir(exist_ok=True)
IMPORT_STAGING_DIR = UPLOADS_DIR / "import_staging"
IMPORT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
IMPORT_STAGING_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterResponse(BaseModel):
    success: bool


class LoginResponse(BaseModel):
    token: str


class MeResponse(BaseModel):
    id: str
    email: EmailStr
    role: str
    client_id: str | None = Field(
        default=None,
        description="Справочник клиента для роли client; назначается администратором.",
    )


class UserListItem(BaseModel):
    id: str
    email: EmailStr
    role: str
    created_at: str
    client_id: str | None = None
    client_name: str | None = None


class UserDeletePatchRequest(BaseModel):
    """Мягкое удаление / восстановление (без физического DELETE)."""
    is_deleted: bool


class RoleUpdateRequest(BaseModel):
    role: str


class UserClientAssignRequest(BaseModel):
    """Привязка учётной записи к клиенту из справочника (только для роли client)."""

    client_id: str | None = Field(
        default=None,
        description="UUID клиента или null — снять привязку.",
    )


class MessageResponse(BaseModel):
    message: str


class DictionaryBaseItem(BaseModel):
    id: str
    name: str
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = Field(
        default=None,
        description="Email пользователя, пометившего запись удалённой.",
    )
    created_at: str
    created_by: str | None = Field(
        default=None,
        description="Email создателя (users.creator_id).",
    )
    updated_at: str | None = None
    updated_by: str | None = Field(
        default=None,
        description="Email последнего редактора (users.updated_by_id).",
    )


class ProductTypeDictionaryItem(DictionaryBaseItem):
    """Тип товара: признаки учёта вариантов по цвету и размеру (для SKU)."""

    requires_color: bool = Field(
        description="Нужно указывать цвет у каждого варианта товара этого типа.",
    )
    requires_size: bool = Field(
        description="Нужно указывать размер у каждого варианта товара этого типа.",
    )


class ProductTypeCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = False
    requires_color: bool = Field(
        default=True,
        description="При создании типа всегда сохраняется как true (поле в теле запроса игнорируется).",
    )
    requires_size: bool = Field(
        default=False,
        description="Включить обязательный выбор размера для вариантов.",
    )


class ProductTypeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None
    requires_color: bool | None = Field(
        default=None,
        description="Обязательный цвет в вариантах; null — не менять.",
    )
    requires_size: bool | None = Field(
        default=None,
        description="Обязательный размер в вариантах; null — не менять.",
    )


class RecordActualityFilterItem(BaseModel):
    """Пункт системного справочника актуальности (только для фильтров)."""

    id: str
    name: str


class DictionaryCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = False


class DictionaryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None


class SizeItem(BaseModel):
    id: str
    name: str
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = Field(
        default=None,
        description="Email пользователя, пометившего запись удалённой.",
    )
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class SizeListResponse(BaseModel):
    items: list[SizeItem]
    total: int
    page: int
    limit: int


class SizeCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = Field(default=True)


class SizeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_deleted: bool | None = None


class ProductItem(BaseModel):
    id: str
    name: str
    type_id: str
    type_name: str | None = None
    sku_base: str
    requires_color: bool = False
    requires_size: bool = False
    client_id: str | None = None
    client_name: str | None = None
    variant_count: int = 0
    is_active: bool = Field(
        description="Актуален: true — товар в ассортименте, false — не актуален; по умолчанию true.",
    )
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = Field(
        default=None,
        description="Email пользователя, пометившего запись удалённой.",
    )
    image_urls: list[str] = Field(
        default_factory=list,
        description="Галерея фото карточки (порядок как при сохранении); превью списка — первое.",
    )
    created_at: str
    created_by: str | None = Field(
        default=None,
        description="Кто создал: email из users (creator_id).",
    )
    updated_at: str | None = None
    updated_by: str | None = Field(
        default=None,
        description="Кто менял последним: email из users (updated_by_id).",
    )


class ProductCreateDimensionBlock(BaseModel):
    length: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)
    sizes: list[str] = Field(default_factory=list)


class ProductCreateInner(BaseModel):
    name: str = Field(min_length=1)
    type_id: str = Field(min_length=1)
    sku_base: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    is_active: bool = True


class ProductCreateMeta(BaseModel):
    product: ProductCreateInner
    colors: list[str] = Field(min_length=1)
    dimensions: list[ProductCreateDimensionBlock] = Field(min_length=1)


class ProductVariantDimension(BaseModel):
    length: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class ProductVariantItem(BaseModel):
    id: str
    color_id: str
    dimension: ProductVariantDimension
    size_id: str | None = None
    sku: str
    images: list[str] = Field(default_factory=list)
    is_active: bool


class ProductVariantDeletePatchRequest(BaseModel):
    """PATCH вместо HTTP DELETE для варианта (ТЗ: мягкое удаление)."""
    is_deleted: bool


class ProductVariantWriteItem(BaseModel):
    id: str | None = None
    sku: str | None = None
    color_id: str = Field(min_length=1)
    dimension: ProductVariantDimension
    size_id: str | None = None
    images: list[str] = Field(default_factory=list)
    is_active: bool = True


class ProductVariantsPatchRequest(BaseModel):
    variants: list[ProductVariantWriteItem]


class ProductVariantFindItem(BaseModel):
    variant_id: str
    product_id: str
    product_name: str
    product_type_name: str | None = None
    client_name: str | None = Field(default=None, description="Клиент карточки товара")
    requires_size: bool
    sku: str
    color_id: str
    size_id: str | None
    length: float
    width: float
    height: float
    first_image_url: str | None = None


class ProductVariantFindResponse(BaseModel):
    found: bool
    variant: ProductVariantFindItem | None = None
    needs_size: bool = False


class ReceiptCreate(BaseModel):
    variant_id: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    comment: str | None = None
    receipt_date: str | None = Field(
        default=None,
        description=f"Дата поступления YYYY-MM-DD. Для «{RECEIPT_STATUS_PENDING}» — любая; "
        f"для «{RECEIPT_STATUS_ACCEPTED}» — не позже сегодня. Пусто — текущий момент",
    )
    receipt_status: str = Field(
        default=RECEIPT_STATUS_ACCEPTED,
        description=f"'{RECEIPT_STATUS_PENDING}' — запланировано, '{RECEIPT_STATUS_ACCEPTED}' — принято на склад",
    )


class ReceiptPatch(BaseModel):
    quantity: int | None = Field(default=None, gt=0)
    comment: str | None = None
    variant_id: str | None = Field(
        default=None,
        description="Новый вариант; при смене пересчитываются product_id и ключ остатка.",
    )
    receipt_date: str | None = Field(
        default=None,
        description=f"Дата поступления YYYY-MM-DD (обновляет created_at). "
        f"Для итогового «{RECEIPT_STATUS_ACCEPTED}» — не позже сегодня; "
        f"для «{RECEIPT_STATUS_PENDING}» — без ограничения по будущему",
    )
    receipt_status: str | None = Field(
        default=None,
        description=f"'{RECEIPT_STATUS_PENDING}' | '{RECEIPT_STATUS_ACCEPTED}'",
    )


class ReceiptDetailResponse(BaseModel):
    id: str
    variant_id: str | None
    sku: str
    color_id: str | None
    size_id: str | None
    quantity: int
    comment: str | None
    receipt_status: str
    product_id: str
    product_name: str
    product_type_name: str | None
    client_id: str | None
    client_name: str | None
    length: float
    width: float
    height: float
    first_image_url: str | None
    created_at: str
    created_by: str | None


class ShipmentCreate(BaseModel):
    variant_id: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    comment: str | None = None
    shipment_date: str | None = Field(
        default=None,
        description="Дата отгрузки YYYY-MM-DD. Для ожидания — любая; для отгружено — не позже сегодня",
    )
    shipment_status: str = Field(
        default=SHIPMENT_STATUS_PENDING,
        description=f"'{SHIPMENT_STATUS_PENDING}' — план, '{SHIPMENT_STATUS_SHIPPED}' — факт (остаток)",
    )


class ShipmentPatch(BaseModel):
    quantity: int | None = Field(default=None, gt=0)
    comment: str | None = None
    variant_id: str | None = Field(
        default=None,
        description="Новый вариант; пересчёт product_id, color_id, size_id",
    )
    shipment_date: str | None = None
    shipment_status: str | None = Field(
        default=None,
        description=f"'{SHIPMENT_STATUS_PENDING}' | '{SHIPMENT_STATUS_SHIPPED}'",
    )


class ShipmentDetailResponse(BaseModel):
    id: str
    variant_id: str | None
    sku: str
    color_id: str | None
    size_id: str | None
    quantity: int
    comment: str | None
    shipment_status: str
    product_id: str
    product_name: str
    product_type_name: str | None
    client_id: str | None
    client_name: str | None
    length: float
    width: float
    height: float
    first_image_url: str | None
    created_at: str
    created_by: str | None


class ProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type_id: str | None = None
    client_id: str | None = None
    is_active: bool | None = None
    is_deleted: bool | None = None
    sku_base: str | None = Field(
        default=None,
        min_length=1,
        description="Базовый штрих-код (products.sku); при смене пересчитываются SKU вариантов.",
    )
    image_urls: list[str] | None = Field(
        default=None,
        description="Галерея фото карточки (порядок); пустой список — без фото.",
    )


class ProductListResponse(BaseModel):
    items: list[ProductItem]
    total: int
    page: int
    limit: int


class DictionaryListResponse(BaseModel):
    items: list[DictionaryBaseItem]
    total: int
    page: int
    limit: int


class ProductTypeListResponse(BaseModel):
    items: list[ProductTypeDictionaryItem]
    total: int
    page: int
    limit: int


def _fold_ci_str(x: object) -> str:
    """Совпадает с SQL fold_ci(): lower + ё→е (без учёта регистра; е и ё эквивалентны)."""
    if x is None:
        return ""
    return str(x).lower().replace("ё", "е")


def _fold_ci_import_match(x: object) -> str:
    """Сверка строк импорта с данными системы (trim + fold_ci)."""
    if x is None:
        return ""
    return _fold_ci_str(str(x).strip())


def _ci_substring_like_param(raw: str) -> str:
    return f"%{_fold_ci_str(str(raw).strip())}%"


def _table_column_names(connection: Any, table_name: str) -> set[str]:
    rows = connection.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name.lower(),),
    ).fetchall()
    return {str(r["column_name"]).lower() for r in rows}


def _ensure_fold_ci(connection: Any) -> None:
    connection.execute(
        """
        CREATE OR REPLACE FUNCTION fold_ci(input text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        AS $fold$
            SELECT replace(lower(COALESCE(input, '')), 'ё', 'е')
        $fold$
        """
    )


def init_db():
    with get_connection() as connection:
        _ensure_fold_ci(connection)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            )
            """
        )
        columns = _table_column_names(connection, "users")
        if "role" not in columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"
            )
        _ensure_columns(
            connection,
            "users",
            {
                "client_id": "TEXT",
            },
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS colors (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sizes (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS product_types (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type_id TEXT NOT NULL,
                client_id TEXT,
                supplier_id TEXT,
                sku TEXT UNIQUE NOT NULL,
                image_url TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                creator_id TEXT,
                updated_at TEXT,
                updated_by_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory_operations (
                id TEXT PRIMARY KEY,
                op_type TEXT NOT NULL CHECK (op_type IN ('in', 'out')),
                product_id TEXT NOT NULL,
                color_id TEXT,
                size_id TEXT,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                note TEXT,
                created_at TEXT NOT NULL,
                created_by_id TEXT
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS inventory_operations_product_idx "
            "ON inventory_operations(product_id, color_id, size_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS inventory_operations_created_idx "
            "ON inventory_operations(created_at)"
        )
        _ensure_columns(
            connection,
            "product_types",
            {
                "requires_color": "INTEGER NOT NULL DEFAULT 0",
                "requires_size": "INTEGER NOT NULL DEFAULT 0",
            },
        )
        _migrate_product_types_requires_seed(connection)
        _ensure_columns(
            connection,
            "clients",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        _ensure_columns(
            connection,
            "colors",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        _ensure_columns(
            connection,
            "sizes",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        _ensure_columns(
            connection,
            "product_types",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        _ensure_columns(
            connection,
            "suppliers",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        _ensure_columns(
            connection,
            "products",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
                "is_active": "INTEGER NOT NULL DEFAULT 1",
            },
        )
        _migrate_sizes_remove_code_column(connection)
        _migrate_products_is_active_aktualen(connection)
        _migrate_products_dictionary_fks(connection)
        _migrate_product_variants_v1(connection)
        _migrate_soft_delete_policy_v1(connection)
        _migrate_product_gallery_json_v1(connection)
        _ensure_columns(
            connection,
            "inventory_operations",
            {
                "variant_id": "TEXT",
                "variant_sku": "TEXT",
                "receipt_status": "TEXT",
                "is_deleted": "INTEGER NOT NULL DEFAULT 0",
                "deleted_at": "TEXT",
                "deleted_by_id": "TEXT",
                "shipment_status": "TEXT",
            },
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS import_movement_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                op_type TEXT NOT NULL,
                filename TEXT,
                total INTEGER NOT NULL DEFAULT 0,
                success INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                warnings INTEGER NOT NULL DEFAULT 0,
                detail_json TEXT
            )
            """
        )
        connection.execute(
            """
            UPDATE inventory_operations
            SET receipt_status = ?
            WHERE op_type = 'in'
              AND (receipt_status IS NULL OR TRIM(COALESCE(receipt_status, '')) = '')
            """,
            (RECEIPT_STATUS_ACCEPTED,),
        )
        _ensure_record_actuality(connection)
        connection.commit()


def _ensure_columns(connection: Any, table_name: str, columns: dict[str, str]):
    current_columns = _table_column_names(connection, table_name)
    for column_name, column_type in columns.items():
        if column_name.lower() not in current_columns:
            connection.execute(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
            )


def _migrate_product_types_requires_seed(connection: Any) -> None:
    """Однократно: проставить requires_color/requires_size по названию типа.

    «Одежда» → требуется и цвет, и размер; для прочих типов остаётся 0/0
    (можно скорректировать вручную в БД при необходимости).
    """
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'product_types_requires_seed_v1'"
    ).fetchone():
        return
    connection.execute(
        """
        UPDATE product_types
        SET requires_color = 1, requires_size = 1
        WHERE LOWER(name) LIKE '%одежд%' OR LOWER(name) LIKE '%cloth%'
        """
    )
    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('product_types_requires_seed_v1')"
    )


def _migrate_sizes_remove_code_column(connection: Any) -> None:
    """Удаление колонки code и индекса (поле убрано из модели)."""
    cols = _table_column_names(connection, "sizes")
    if "code" not in cols:
        return
    connection.execute("DROP INDEX IF EXISTS sizes_code_unique")
    try:
        connection.execute("ALTER TABLE sizes DROP COLUMN code")
    except UndefinedColumn:
        pass


def _migrate_products_is_active_aktualen(connection: Any) -> None:
    """Однократно: старая семантика is_active у товара (1 = «не актуален») → новая (1 = «актуален»)."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'products_is_active_aktualen_v1'"
    ).fetchone():
        return
    connection.execute(
        "UPDATE products SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END"
    )
    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('products_is_active_aktualen_v1')"
    )


def _ensure_seed_product_types_if_empty(connection: Any) -> None:
    count = int(
        connection.execute("SELECT COUNT(*) AS cnt FROM product_types").fetchone()["cnt"]
    )
    if count > 0:
        return
    now = _now()
    for title in ("Одежда", "Техника"):
        connection.execute(
            """
            INSERT INTO product_types (id, name, is_active, created_at)
            VALUES (?, ?, 1, ?)
            """,
            (str(uuid4()), title, now),
        )


def _migrate_products_dictionary_fks(connection: Any) -> None:
    """Товары: type_id / client_id / supplier_id вместо legacy type / supplier TEXT."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'products_dictionary_fk_v1'"
    ).fetchone():
        return

    cols = _table_column_names(connection, "products")

    if "type_id" in cols and "type" not in cols:
        connection.execute(
            "INSERT INTO app_migrations (id) VALUES ('products_dictionary_fk_v1')"
        )
        return

    if "type" not in cols:
        connection.execute(
            "INSERT INTO app_migrations (id) VALUES ('products_dictionary_fk_v1')"
        )
        return

    _ensure_columns(
        connection,
        "products",
        {"type_id": "TEXT", "client_id": "TEXT", "supplier_id": "TEXT"},
    )

    connection.execute(
        """
        UPDATE products
        SET type = 'clothes'
        WHERE LOWER(type) IN ('одежда', 'clothes')
        """
    )
    connection.execute(
        """
        UPDATE products
        SET type = 'tech'
        WHERE LOWER(type) IN ('техника', 'tech', 'electronics', 'электроника')
        """
    )

    connection.execute(
        """
        UPDATE products AS p
        SET supplier_id = (
            SELECT s.id FROM suppliers s
            WHERE s.is_active = 1
              AND TRIM(LOWER(COALESCE(s.name, ''))) = TRIM(LOWER(COALESCE(p.supplier, '')))
            LIMIT 1
        )
        WHERE p.supplier_id IS NULL
          AND p.supplier IS NOT NULL
          AND TRIM(p.supplier) != ''
        """
    )

    connection.execute(
        """
        UPDATE products AS p
        SET type_id = (
            SELECT pt.id FROM product_types pt
            WHERE pt.is_active = 1 AND p.type = 'clothes'
              AND (
                  LOWER(pt.name) IN ('одежда', 'clothes')
                  OR LOWER(pt.name) LIKE '%одежда%'
              )
            ORDER BY pt.created_at LIMIT 1
        )
        WHERE p.type_id IS NULL AND p.type = 'clothes'
        """
    )
    connection.execute(
        """
        UPDATE products AS p
        SET type_id = (
            SELECT pt.id FROM product_types pt
            WHERE pt.is_active = 1 AND p.type = 'tech'
              AND (
                  LOWER(pt.name) IN ('техника', 'tech', 'electronics', 'электроника')
                  OR LOWER(pt.name) LIKE '%техник%'
              )
            ORDER BY pt.created_at LIMIT 1
        )
        WHERE p.type_id IS NULL AND p.type = 'tech'
        """
    )

    _ensure_seed_product_types_if_empty(connection)

    fallback_pt = connection.execute(
        "SELECT id FROM product_types WHERE is_active = 1 ORDER BY created_at LIMIT 1"
    ).fetchone()
    if fallback_pt:
        connection.execute(
            "UPDATE products SET type_id = ? WHERE type_id IS NULL",
            (fallback_pt["id"],),
        )

    remaining = int(
        connection.execute(
            "SELECT COUNT(*) AS cnt FROM products WHERE type_id IS NULL"
        ).fetchone()["cnt"]
    )
    if remaining:
        raise RuntimeError(
            f"products_dictionary_fk_v1: осталось {remaining} строк без type_id; "
            "добавьте записи в справочник типов товаров."
        )

    connection.execute("ALTER TABLE products RENAME TO products__legacy")
    connection.execute(
        """
        CREATE TABLE products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type_id TEXT NOT NULL,
            client_id TEXT,
            supplier_id TEXT,
            sku TEXT UNIQUE NOT NULL,
            image_url TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            creator_id TEXT,
            updated_at TEXT,
            updated_by_id TEXT
        )
        """
    )
    connection.execute(
        """
        INSERT INTO products (
            id, name, type_id, client_id, supplier_id, sku, image_url, is_active,
            created_at, creator_id, updated_at, updated_by_id
        )
        SELECT
            id, name, type_id, client_id, supplier_id, sku, image_url, is_active,
            created_at, creator_id, updated_at, updated_by_id
        FROM products__legacy
        """
    )
    connection.execute("DROP TABLE products__legacy")

    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('products_dictionary_fk_v1')"
    )


def _migrate_product_variants_v1(connection: Any) -> None:
    """Таблица вариантов SKU + перенос legacy image/sku в одну строку variant на товар."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'product_variants_v1'"
    ).fetchone():
        return

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS product_variants (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            color_id TEXT NOT NULL,
            size_id TEXT,
            length REAL NOT NULL,
            width REAL NOT NULL,
            height REAL NOT NULL,
            sku TEXT NOT NULL UNIQUE,
            images_json TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS product_variants_product_idx "
        "ON product_variants(product_id)"
    )

    color_row = connection.execute(
        "SELECT id FROM colors WHERE is_active = 1 ORDER BY created_at LIMIT 1"
    ).fetchone()
    if not color_row:
        color_row = connection.execute(
            "SELECT id FROM colors ORDER BY created_at LIMIT 1"
        ).fetchone()
    if not color_row:
        nid = str(uuid4())
        connection.execute(
            """
            INSERT INTO colors (id, name, is_active, created_at)
            VALUES (?, ?, 1, ?)
            """,
            (nid, "—", _now()),
        )
        legacy_color_id = nid
    else:
        legacy_color_id = color_row["id"]

    products = connection.execute(
        "SELECT id, sku, image_url, is_active, created_at FROM products"
    ).fetchall()
    for p in products:
        exists = connection.execute(
            "SELECT 1 FROM product_variants WHERE product_id = ? LIMIT 1",
            (p["id"],),
        ).fetchone()
        if exists:
            continue
        imgs: list[str] = []
        if p["image_url"]:
            imgs.append(str(p["image_url"]))
        connection.execute(
            """
            INSERT INTO product_variants (
                id, product_id, color_id, size_id,
                length, width, height, sku, images_json,
                is_active, created_at
            )
            VALUES (?, ?, ?, NULL, 0, 0, 0, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                p["id"],
                legacy_color_id,
                str(p["sku"]),
                json.dumps(imgs, ensure_ascii=False),
                1 if p["is_active"] else 0,
                p["created_at"],
            ),
        )

    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('product_variants_v1')"
    )


def _migrate_soft_delete_policy_v1(connection: Any) -> None:
    """Мягкое удаление: is_deleted, deleted_at, deleted_by_id (ТЗ «Логика удаления элементов»)."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'soft_delete_policy_v1'"
    ).fetchone():
        return

    soft_cols: dict[str, str] = {
        "is_deleted": "INTEGER NOT NULL DEFAULT 0",
        "deleted_at": "TEXT",
        "deleted_by_id": "TEXT",
    }
    for tbl in (
        "clients",
        "colors",
        "sizes",
        "product_types",
        "suppliers",
        "products",
        "product_variants",
        "users",
    ):
        _ensure_columns(connection, tbl, soft_cols)

    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('soft_delete_policy_v1')"
    )


def _migrate_product_gallery_json_v1(connection: Any) -> None:
    """JSON-массив URL фото карточки (порядок); превью — первый элемент = image_url."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
        """
    )
    if connection.execute(
        "SELECT 1 FROM app_migrations WHERE id = 'product_gallery_json_v1'"
    ).fetchone():
        return
    _ensure_columns(
        connection,
        "products",
        {"gallery_json": "TEXT"},
    )
    for r in connection.execute(
        "SELECT id, image_url FROM products WHERE image_url IS NOT NULL AND TRIM(image_url) != ''"
    ).fetchall():
        u = str(r["image_url"]).strip()
        if u:
            connection.execute(
                "UPDATE products SET gallery_json = ? WHERE id = ?",
                (json.dumps([u], ensure_ascii=False), r["id"]),
            )
    connection.execute(
        "INSERT INTO app_migrations (id) VALUES ('product_gallery_json_v1')"
    )


def _ensure_record_actuality(connection: Any) -> None:
    """Системный справочник значений фильтра «актуальность»; не редактируется через UI."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS record_actuality (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            maps_is_active INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    n = int(connection.execute("SELECT COUNT(*) AS cnt FROM record_actuality").fetchone()["cnt"])
    if n > 0:
        return
    connection.execute(
        """
        INSERT INTO record_actuality (id, name, maps_is_active, sort_order)
        VALUES (?, ?, 1, 0), (?, ?, 0, 1)
        """,
        (
            RECORD_ACTUALITY_YES_ID,
            "Актуален",
            RECORD_ACTUALITY_NO_ID,
            "Не актуален",
        ),
    )


def seed_admin():
    admin_email = "admin@example.com"
    admin_password = "admin123"
    with get_connection() as connection:
        existing_admin = connection.execute(
            "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
        ).fetchone()
        if existing_admin:
            return

        connection.execute(
            """
            INSERT INTO users (id, email, password_hash, role, created_at)
            VALUES (?, ?, ?, 'admin', ?)
            """,
            (
                str(uuid4()),
                admin_email,
                hash_password(admin_password),
                datetime.now(UTC).isoformat(),
            ),
        )
        connection.commit()


@app.on_event("startup")
def on_startup():
    init_db()
    seed_admin()


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "userId": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(UTC) + timedelta(minutes=TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def get_user_by_email(email: str):
    with get_connection() as connection:
        return connection.execute(
            "SELECT id, email, password_hash, role, created_at, client_id FROM users "
            "WHERE email = ? AND COALESCE(is_deleted, 0) = 0",
            (email.lower(),),
        ).fetchone()


def _user_client_id_opt(user) -> str | None:
    """Значение users.client_id из результата SELECT (доступ по ключу, без .get)."""
    try:
        raw = user["client_id"]
    except (KeyError, IndexError):
        return None
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен",
        ) from exc

    user_id = payload.get("userId")
    email = payload.get("email")
    role = payload.get("role")
    if not user_id or not email or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен",
        )

    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, email, role, created_at, client_id
            FROM users
            WHERE id = ?
              AND LOWER(TRIM(email)) = LOWER(TRIM(?))
              AND COALESCE(is_deleted, 0) = 0
            """,
            (user_id, str(email)),
        ).fetchone()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден",
        )

    return user


def get_current_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав",
        )
    return user


def get_current_manager(user=Depends(get_current_user)):
    if user["role"] not in ("manager", "admin", "warehouse_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав",
        )
    return user


def get_current_client_portal(user=Depends(get_current_user)):
    """Роль client и назначенный client_id; иначе 403 (в т.ч. сообщение об активации)."""
    if user["role"] != "client":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав",
        )
    cid = _user_client_id_opt(user) or ""
    if not cid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обратитесь к администратору для активации доступа",
        )
    return user


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_dictionary_table(table_name: str):
    if table_name not in DICTIONARY_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый справочник",
        )


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поле Название обязательно",
        )
    return normalized


def _normalize_sku(sku: str) -> str:
    normalized = sku.strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поле Штрих-код товара обязательно",
        )
    return normalized


def _variant_sku_in_use(
    connection: Any, sku: str, exclude_variant_id: str | None
) -> bool:
    q = (
        "SELECT 1 FROM product_variants WHERE sku = ? "
        "AND COALESCE(is_deleted, 0) = 0"
    )
    params: list[object] = [sku]
    if exclude_variant_id:
        q += " AND id != ?"
        params.append(exclude_variant_id)
    return connection.execute(q, tuple(params)).fetchone() is not None


def _sku_taken_globally_except_product(
    connection: Any, sku: str, exclude_product_id: str
) -> bool:
    if connection.execute(
        """
        SELECT 1 FROM products
        WHERE sku = ? AND id != ? AND COALESCE(is_deleted, 0) = 0
        """,
        (sku, exclude_product_id),
    ).fetchone():
        return True
    if connection.execute(
        """
        SELECT 1 FROM product_variants
        WHERE sku = ? AND product_id != ? AND COALESCE(is_deleted, 0) = 0
        """,
        (sku, exclude_product_id),
    ).fetchone():
        return True
    return False


def _rebase_variant_skus_for_new_product_base(
    connection: Any,
    *,
    product_id: str,
    old_base_sku: str,
    new_base_sku: str,
    updated_at: str,
) -> None:
    """При смене базового штрих-кода товара обновляет SKU неудалённых вариантов (префикс + проверка уникальности)."""
    old_b = old_base_sku.strip()
    new_b = new_base_sku.strip()
    rows = connection.execute(
        """
        SELECT id, sku, color_id, size_id
        FROM product_variants
        WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0
        ORDER BY LOWER(sku) ASC
        """,
        (product_id,),
    ).fetchall()
    computed: list[tuple[str, str, str, str | None]] = []
    for r in rows:
        vid = str(r["id"])
        cur = str(r["sku"]).strip()
        color_id = str(r["color_id"])
        sz_id = str(r["size_id"]) if r["size_id"] else None
        if cur == old_b or cur.startswith(old_b + "-"):
            prop = new_b + cur[len(old_b) :] if cur.startswith(old_b + "-") else new_b
        else:
            prop = _generate_variant_sku_for_patch(
                connection,
                sku_base=new_b,
                color_id=color_id,
                size_id=sz_id,
                exclude_variant_id=vid,
            )
        if prop == new_b:
            prop = _generate_variant_sku_for_patch(
                connection,
                sku_base=new_b,
                color_id=color_id,
                size_id=sz_id,
                exclude_variant_id=vid,
            )
        computed.append((vid, prop, color_id, sz_id))

    used_local: set[str] = set()
    finals: list[tuple[str, str]] = []
    for vid, prop, color_id, sz_id in computed:
        p = prop
        n = 0
        while n < 500:
            n += 1
            if p not in used_local and not _variant_sku_in_use(connection, p, vid):
                break
            p = _generate_variant_sku_for_patch(
                connection,
                sku_base=new_b,
                color_id=color_id,
                size_id=sz_id,
                exclude_variant_id=vid,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Не удалось подобрать уникальные штрих-коды вариантов",
            )
        used_local.add(p)
        finals.append((vid, p))

    for vid, p in finals:
        connection.execute(
            "UPDATE product_variants SET sku = ?, updated_at = ? WHERE id = ?",
            (p, updated_at, vid),
        )


def _require_active_product_type(connection: Any, type_id: str) -> str:
    tid = type_id.strip()
    row = connection.execute(
        "SELECT id FROM product_types WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (tid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Тип товара: недопустимое или неактивное значение",
        )
    return tid


def _require_active_client(connection: Any, raw: str | None) -> str:
    if raw is None or str(raw).strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поле Клиент обязательно",
        )
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Клиент: недопустимое или неактивное значение",
        )
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Клиент: недопустимое или неактивное значение",
        )
    return cid


def _optional_active_supplier(connection: Any, raw: str | None) -> str | None:
    if raw is None or str(raw).strip() == "":
        return None
    sid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM suppliers WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (sid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поставщик: недопустимое или неактивное значение",
        )
    return sid


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


def _product_card_image_urls(
    gallery_json_val: str | None, image_url_val: str | None
) -> list[str]:
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


def _find_variant_row_for_receipt(
    connection: Any,
    sku_norm: str,
    color_id: str,
    size_id: str | None,
) -> tuple[Mapping[str, Any] | None, bool]:
    """Подбор варианта для приёмки: одежда — sku+color+size; техника — sku+color (size игнорируется).

    Возвращает (строка или None, needs_size — нужно выбрать размер в UI).
    """
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


def _sku_token_from_label(name: str) -> str:
    s = re.sub(r"\s+", "-", str(name).strip().upper())
    s = re.sub(r"[^0-9A-ZА-ЯЁ\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-") or "X"
    return s[:18]


def _product_type_flags(connection: Any, type_id: str) -> tuple[bool, bool]:
    row = connection.execute(
        "SELECT requires_color, requires_size FROM product_types WHERE id = ?",
        (type_id,),
    ).fetchone()
    if not row:
        return False, False
    return bool(row["requires_color"]), bool(row["requires_size"])


def _require_active_color_id(connection: Any, cid: str) -> str:
    rid = cid.strip()
    row = connection.execute(
        "SELECT id FROM colors WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (rid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Цвет: недопустимое или неактивное значение",
        )
    return rid


def _require_active_size_id(connection: Any, sid: str) -> str:
    rid = sid.strip()
    row = connection.execute(
        "SELECT id FROM sizes WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (rid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Размер: недопустимое или неактивное значение",
        )
    return rid


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


def _variant_dimension_key(
    length: float, width: float, height: float, color_id: str, size_id: str | None
) -> tuple:
    return (
        color_id,
        round(float(length), 4),
        round(float(width), 4),
        round(float(height), 4),
        size_id or "",
    )


def _variant_identity_key(
    sku_base: str,
    color_id: str,
    size_id: str | None,
    *,
    requires_size: bool,
) -> tuple[str, str, str]:
    """Уникальность варианта: штрих-код товара + цвет варианта + размер варианта."""
    base = str(sku_base).strip()
    cid = str(color_id).strip().lower()
    if requires_size:
        sid = str(size_id).strip().lower() if size_id else ""
    else:
        sid = ""
    return (base, cid, sid)


def _norm_variant_row_id(value: str | None) -> str | None:
    """Единый вид UUID строки варианта для сравнения (регистр, пробелы)."""
    if value is None:
        return None
    s = str(value).strip()
    return s.lower() if s else None


def _sku_dim_token(length: float, width: float, height: float) -> str:
    """Короткий суффикс SKU для различения габаритов (техника, несколько блоков)."""
    a, b, c = int(round(float(length))), int(round(float(width))), int(round(float(height)))
    return f"{a}X{b}X{c}"


def _build_variant_rows_for_create(
    connection: Any,
    *,
    requires_size: bool,
    sku_base: str,
    color_ids: list[str],
    dimensions: list[ProductCreateDimensionBlock],
) -> list[dict]:
    """Строки для INSERT в product_variants (без id/product_id).

    По ТЗ «Product Variant Create Strategy»: фото не участвуют в генерации — images_json = [].
    Техника: variants = colors × dimensions. Одежда: псевдокод color → group → size.
    """
    seen_keys: set[tuple] = set()
    out: list[dict] = []
    used_skus: set[str] = set()
    size_ids_collect: set[str] = set()
    for block in dimensions:
        for s in block.sizes:
            size_ids_collect.add(s)

    if not dimensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите хотя бы один блок габаритов",
        )

    if requires_size:
        for block in dimensions:
            if not block.sizes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Для одежды укажите размеры в каждом блоке габаритов",
                )
        for color_id in color_ids:
            _require_active_color_id(connection, color_id)
        for sid in size_ids_collect:
            _require_active_size_id(connection, sid)
    else:
        for block in dimensions:
            if block.sizes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Для техники не указывайте размеры в блоке габаритов",
                )

    color_labels, size_labels = _color_size_labels_for_skus(
        connection, set(color_ids), size_ids_collect
    )
    base_norm = _normalize_sku(sku_base)
    multi_dim = len(dimensions) > 1

    if requires_size:
        for block in dimensions:
            for sz in block.sizes:
                sz_id = _require_active_size_id(connection, sz)
                for color_id in color_ids:
                    _require_active_color_id(connection, color_id)
                    ct = _sku_token_from_label(color_labels.get(color_id, "C"))
                    st = _sku_token_from_label(size_labels.get(sz_id, "S"))
                    candidate = f"{base_norm}-{ct}-{st}"
                    sku = candidate
                    salt = 0
                    while sku in used_skus:
                        salt += 1
                        sku = f"{candidate}-{salt}"
                    used_skus.add(sku)
                    key = _variant_dimension_key(
                        block.length, block.width, block.height, color_id, sz_id
                    )
                    if key in seen_keys:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=(
                                "Дублируется комбинация цвета, габаритов и размера "
                                "(один размер не может повторяться для тех же габаритов "
                                "в разных блоках)."
                            ),
                        )
                    seen_keys.add(key)
                    out.append(
                        {
                            "color_id": color_id,
                            "size_id": sz_id,
                            "length": float(block.length),
                            "width": float(block.width),
                            "height": float(block.height),
                            "sku": sku,
                            "images_json": _encode_images_json([]),
                        }
                    )
    else:
        for block in dimensions:
            dim_tok = _sku_dim_token(block.length, block.width, block.height)
            for color_id in color_ids:
                _require_active_color_id(connection, color_id)
                ct = _sku_token_from_label(color_labels.get(color_id, "C"))
                candidate = (
                    f"{base_norm}-{ct}-{dim_tok}" if multi_dim else f"{base_norm}-{ct}"
                )
                sku = candidate
                salt = 0
                while sku in used_skus:
                    salt += 1
                    sku = f"{candidate}-{salt}"
                used_skus.add(sku)
                key = _variant_dimension_key(
                    block.length, block.width, block.height, color_id, None
                )
                if key in seen_keys:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Дублируется комбинация цвета и габаритов",
                    )
                seen_keys.add(key)
                out.append(
                    {
                        "color_id": color_id,
                        "size_id": None,
                        "length": float(block.length),
                        "width": float(block.width),
                        "height": float(block.height),
                        "sku": sku,
                        "images_json": _encode_images_json([]),
                    }
                )
    return out


def _generate_variant_sku_for_patch(
    connection: Any,
    *,
    sku_base: str,
    color_id: str,
    size_id: str | None,
    exclude_variant_id: str | None,
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
        q = "SELECT id FROM product_variants WHERE sku = ? AND COALESCE(is_deleted, 0) = 0"
        params: list[object] = [sku]
        if exclude_variant_id:
            q += " AND id != ?"
            params.append(exclude_variant_id)
        dup = connection.execute(q, tuple(params)).fetchone()
        if not dup:
            return sku
        salt += 1
        sku = f"{candidate}-{salt}"


def _soft_delete_variants_for_product(
    connection: Any,
    product_id: str,
    admin_id: str,
    ts: str,
) -> None:
    connection.execute(
        """
        UPDATE product_variants
        SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?,
            updated_at = ?, is_active = 0
        WHERE product_id = ? AND COALESCE(is_deleted, 0) = 0
        """,
        (ts, admin_id, ts, product_id),
    )


def _sync_product_variants_from_request(
    connection: Any,
    product_id: str,
    payload: ProductVariantsPatchRequest,
    admin_id: str,
) -> None:
    prow = connection.execute(
        """
        SELECT p.sku AS sku_base, COALESCE(pt.requires_size, 0) AS requires_size,
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Товар удалён. Восстановите его перед редактированием вариантов.",
        )
    sku_base = str(prow["sku_base"])
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
    incoming_norm = {
        _norm_variant_row_id(str(v.id)) for v in payload.variants if v.id
    }
    incoming_norm.discard(None)
    for norm_id, raw_id in existing_by_norm.items():
        if norm_id not in incoming_norm:
            connection.execute(
                """
                UPDATE product_variants
                SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?,
                    updated_at = ?, is_active = 0
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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Для этого типа товара укажите размер варианта",
            )
        _require_active_color_id(connection, item.color_id)
        if eff_size:
            _require_active_size_id(connection, eff_size)
        identity_keys.append(
            _variant_identity_key(
                sku_base,
                item.color_id,
                eff_size,
                requires_size=requires_size,
            )
        )
        rows_to_apply.append((item, eff_size))

    if len(identity_keys) != len(set(identity_keys)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=dup_detail,
        )

    for item, eff_size in rows_to_apply:
        imgs = _encode_images_json(item.images)
        if item.id:
            rid = str(item.id)
            own = connection.execute(
                "SELECT id FROM product_variants WHERE id = ? AND product_id = ?",
                (rid, product_id),
            ).fetchone()
            if not own:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Неизвестный вариант",
                )
            new_sku = (
                _normalize_sku(item.sku)
                if item.sku and str(item.sku).strip()
                else _generate_variant_sku_for_patch(
                    connection,
                    sku_base=sku_base,
                    color_id=item.color_id,
                    size_id=eff_size,
                    exclude_variant_id=rid,
                )
            )
            connection.execute(
                """
                UPDATE product_variants
                SET color_id = ?, size_id = ?, length = ?, width = ?, height = ?,
                    sku = ?, images_json = ?, is_active = ?, updated_at = ?,
                    is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL
                WHERE id = ? AND product_id = ?
                """,
                (
                    item.color_id,
                    eff_size,
                    float(item.dimension.length),
                    float(item.dimension.width),
                    float(item.dimension.height),
                    new_sku,
                    imgs,
                    1 if item.is_active else 0,
                    now,
                    rid,
                    product_id,
                ),
            )
        else:
            new_sku = (
                _normalize_sku(item.sku)
                if item.sku and str(item.sku).strip()
                else _generate_variant_sku_for_patch(
                    connection,
                    sku_base=sku_base,
                    color_id=item.color_id,
                    size_id=eff_size,
                    exclude_variant_id=None,
                )
            )
            connection.execute(
                """
                INSERT INTO product_variants (
                    id, product_id, color_id, size_id,
                    length, width, height, sku, images_json,
                    is_active, created_at, is_deleted
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    str(uuid4()),
                    product_id,
                    item.color_id,
                    eff_size,
                    float(item.dimension.length),
                    float(item.dimension.width),
                    float(item.dimension.height),
                    new_sku,
                    imgs,
                    1 if item.is_active else 0,
                    now,
                ),
            )


def _product_image_extension(
    content_type: str | None, original_filename: str | None
) -> str | None:
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
        ext = original_filename.rsplit(".", 1)
        if len(ext) == 2 and ext[1].lower() in ("heic", "heif"):
            return f".{ext[1].lower()}"
    return None


def _get_dictionary_items(table_name: str):
    _ensure_dictionary_table(table_name)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE COALESCE(d.is_deleted, 0) = 0
            ORDER BY d.created_at ASC
            """
        ).fetchall()
    return [
        DictionaryBaseItem(
            id=row["id"],
            name=row["name"],
            is_active=bool(row["is_active"]),
            is_deleted=bool(row["is_deleted"]),
            deleted_at=row["deleted_at"],
            deleted_by=row["deleted_by"],
            created_at=row["created_at"],
            created_by=row["created_by"],
            updated_at=row["updated_at"],
            updated_by=row["updated_by"],
        )
        for row in rows
    ]


def _get_dictionary_item(
    table_name: str, item_id: str, *, include_deleted: bool = False
):
    _ensure_dictionary_table(table_name)
    with get_connection() as connection:
        row = connection.execute(
            f"""
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    return DictionaryBaseItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _create_dictionary_item(table_name: str, payload: DictionaryCreateRequest, creator_id: str):
    _ensure_dictionary_table(table_name)
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        try:
            connection.execute(
                f"""
                INSERT INTO {table_name} (id, name, is_active, created_at, creator_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    name,
                    1 if payload.is_active else 0,
                    _now(),
                    creator_id,
                ),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def _update_dictionary_item(
    table_name: str,
    item_id: str,
    payload: DictionaryUpdateRequest,
    editor_id: str,
):
    _ensure_dictionary_table(table_name)
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            f"SELECT COALESCE(is_deleted, 0) AS del FROM {table_name} WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена",
                )

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(
                [
                    "is_deleted = 1",
                    "deleted_at = ?",
                    "deleted_by_id = ?",
                ]
            )
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(
                [
                    "is_deleted = 0",
                    "deleted_at = NULL",
                    "deleted_by_id = NULL",
                ]
            )
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)

        if not fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нет данных для обновления",
            )
        fields.append("updated_at = ?")
        values.append(now)
        fields.append("updated_by_id = ?")
        values.append(editor_id)
        values.append(item_id)
        try:
            connection.execute(
                f"UPDATE {table_name} SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
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


def _delete_dictionary_item(table_name: str, item_id: str, admin_id: str):
    """Мягкое удаление (ТЗ: без физического DELETE)."""
    return _update_dictionary_item(
        table_name,
        item_id,
        DictionaryUpdateRequest(is_deleted=True),
        admin_id,
    )


def _size_row_to_item(row: Mapping[str, Any]) -> SizeItem:
    return SizeItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _get_size_item(item_id: str, *, include_deleted: bool = False) -> SizeItem:
    _ensure_dictionary_table("sizes")
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
            FROM sizes d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    return _size_row_to_item(row)


def _list_sizes_page(
    page: int,
    limit: int,
    *,
    name: str | None,
    actuality_id: str | None,
    sort: str | None,
    include_deleted: bool = False,
) -> SizeListResponse:
    _ensure_dictionary_table("sizes")
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list[object] = []
    if name is not None and str(name).strip():
        conds.append("fold_ci(d.name) LIKE ?")
        params.append(_ci_substring_like_param(str(name)))
    if not include_deleted:
        conds.append("COALESCE(d.is_deleted, 0) = 0")
    where_sql = " AND ".join(conds)
    order_sql = _order_sql_from_sort_param(sort, SIZE_LIST_SORT_COLUMNS) or "d.created_at DESC"
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
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by,
                d.created_at,
                d.updated_at
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
        items=[_size_row_to_item(row) for row in rows],
        total=total,
        page=page,
        limit=limit,
    )


def _create_size(payload: SizeCreateRequest, creator_id: str) -> MessageResponse:
    _ensure_dictionary_table("sizes")
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        try:
            connection.execute(
                """
                INSERT INTO sizes (id, name, is_active, created_at, creator_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    name,
                    1 if payload.is_active else 0,
                    _now(),
                    creator_id,
                ),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def _update_size(item_id: str, payload: SizeUpdateRequest, editor_id: str) -> MessageResponse:
    _ensure_dictionary_table("sizes")
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM sizes WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if payload.name is not None or payload.is_active is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена",
                )

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(
                [
                    "is_deleted = 1",
                    "deleted_at = ?",
                    "deleted_by_id = ?",
                ]
            )
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(
                [
                    "is_deleted = 0",
                    "deleted_at = NULL",
                    "deleted_by_id = NULL",
                ]
            )
        if payload.name is not None:
            fields.append("name = ?")
            values.append(_normalize_name(payload.name))
        if payload.is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if payload.is_active else 0)

        if not fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нет данных для обновления",
            )
        fields.append("updated_at = ?")
        values.append(now)
        fields.append("updated_by_id = ?")
        values.append(editor_id)
        values.append(item_id)
        try:
            connection.execute(
                f"UPDATE sizes SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
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


@app.post("/auth/register", response_model=RegisterResponse)
def register(payload: RegisterRequest):
    existing_user = get_user_by_email(payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email уже зарегистрирован",
        )

    user_id = str(uuid4())
    password_hash = hash_password(payload.password)
    created_at = datetime.now(UTC).isoformat()

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO users (id, email, password_hash, role, created_at)
            VALUES (?, ?, ?, 'user', ?)
            """,
            (user_id, payload.email.lower(), password_hash, created_at),
        )
        connection.commit()

    return RegisterResponse(success=True)


@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    user = get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )

    token = create_token(str(user["id"]), str(user["email"]).strip().lower(), str(user["role"]))
    return LoginResponse(token=token)


@app.get("/auth/me", response_model=MeResponse)
def me(user=Depends(get_current_user)):
    return MeResponse(
        id=user["id"],
        email=user["email"],
        role=user["role"],
        client_id=_user_client_id_opt(user),
    )


@app.get("/users", response_model=list[UserListItem])
def list_users(admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        users = connection.execute(
            """
            SELECT u.id, u.email, u.role, u.created_at, u.client_id, c.name AS client_name
            FROM users u
            LEFT JOIN clients c ON c.id = u.client_id
            WHERE COALESCE(u.is_deleted, 0) = 0
            ORDER BY u.created_at ASC
            """
        ).fetchall()

    return [
        UserListItem(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            created_at=user["created_at"],
            client_id=user["client_id"],
            client_name=user["client_name"],
        )
        for user in users
    ]


@app.patch("/users/{user_id}/role", response_model=MessageResponse)
def update_user_role(user_id: str, payload: RoleUpdateRequest, admin=Depends(get_current_admin)):
    if payload.role not in ("user", "manager", "client"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Можно назначить роль: user, manager или client",
        )

    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить роль самому себе",
        )

    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден",
            )
        if target_user["role"] == "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя изменить роль администратора",
            )

        connection.execute(
            "UPDATE users SET role = ? WHERE id = ?",
            (payload.role, user_id),
        )
        connection.commit()

    return MessageResponse(message="Role updated")


@app.patch("/users/{user_id}/client", response_model=MessageResponse)
def update_user_client(
    user_id: str,
    payload: UserClientAssignRequest,
    admin=Depends(get_current_admin),
):
    _ = admin
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить привязку самому себе",
        )
    raw = payload.client_id
    new_cid = (str(raw).strip() if raw is not None else "") or None
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден",
            )
        if target_user["role"] != "client":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Привязка к клиенту доступна только для пользователей с ролью «Клиент»",
            )
        if new_cid:
            _require_active_client(connection, new_cid)
        connection.execute(
            "UPDATE users SET client_id = ? WHERE id = ?",
            (new_cid, user_id),
        )
        connection.commit()
    return MessageResponse(message="Привязка обновлена")


@app.patch("/users/{user_id}", response_model=MessageResponse)
def patch_user_deleted_flag(
    user_id: str,
    payload: UserDeletePatchRequest,
    admin=Depends(get_current_admin),
):
    return _apply_user_deleted_flag(user_id, admin, is_deleted=payload.is_deleted)


def _apply_user_deleted_flag(
    user_id: str,
    admin: dict,
    *,
    is_deleted: bool,
) -> MessageResponse:
    if user_id == admin["id"] and is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить самого себя",
        )
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role, COALESCE(is_deleted, 0) AS del FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден",
            )
        if is_deleted:
            if target_user["del"]:
                return MessageResponse(message="Удалено")
            if target_user["role"] == "admin":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Нельзя удалить администратора",
                )
            now = _now()
            connection.execute(
                """
                UPDATE users
                SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?
                WHERE id = ?
                """,
                (now, admin["id"], user_id),
            )
        else:
            if not target_user["del"]:
                return MessageResponse(message="Восстановлено")
            connection.execute(
                """
                UPDATE users
                SET is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL
                WHERE id = ?
                """,
                (user_id,),
            )
        connection.commit()
    return MessageResponse(message="Удалено" if is_deleted else "Восстановлено")


@app.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(user_id: str, admin=Depends(get_current_admin)):
    return _apply_user_deleted_flag(user_id, admin, is_deleted=True)


def _resolve_actuality_filter(
    connection: Any, actuality_id: str | None
) -> bool | None:
    """Преобразует id системного справочника в фильтр по колонке is_active."""
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


def _list_dictionary_items_page(
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
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
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
        items=[
            DictionaryBaseItem(
                id=row["id"],
                name=row["name"],
                is_active=bool(row["is_active"]),
                is_deleted=bool(row["is_deleted"]),
                deleted_at=row["deleted_at"],
                deleted_by=row["deleted_by"],
                created_at=row["created_at"],
                created_by=row["created_by"],
                updated_at=row["updated_at"],
                updated_by=row["updated_by"],
            )
            for row in rows
        ],
        total=total,
        page=page,
        limit=limit,
    )


def _product_type_row_to_item(row: Mapping[str, Any]) -> ProductTypeDictionaryItem:
    return ProductTypeDictionaryItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
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


def _list_product_types_page(
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
    table_name = "product_types"
    _ensure_dictionary_table(table_name)
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
    order_sql = _order_sql_from_sort_param(sort, CLIENT_LIST_SORT_COLUMNS) or "d.created_at DESC"
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
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                COALESCE(d.requires_color, 0) AS requires_color,
                COALESCE(d.requires_size, 0) AS requires_size,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
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
    return ProductTypeListResponse(
        items=[_product_type_row_to_item(row) for row in rows],
        total=total,
        page=page,
        limit=limit,
    )


def _get_product_type_item(item_id: str, *, include_deleted: bool = False) -> ProductTypeDictionaryItem:
    _ensure_dictionary_table("product_types")
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                d.id,
                d.name,
                d.is_active,
                COALESCE(d.is_deleted, 0) AS is_deleted,
                d.deleted_at,
                d.created_at,
                d.updated_at,
                COALESCE(d.requires_color, 0) AS requires_color,
                COALESCE(d.requires_size, 0) AS requires_size,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
            FROM product_types d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    return _product_type_row_to_item(row)


def _create_product_type(payload: ProductTypeCreateRequest, creator_id: str):
    _ensure_dictionary_table("product_types")
    item_id = str(uuid4())
    name = _normalize_name(payload.name)
    with get_connection() as connection:
        try:
            connection.execute(
                """
                INSERT INTO product_types (
                    id, name, is_active, requires_color, requires_size, created_at, creator_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    name,
                    1 if payload.is_active else 0,
                    1,  # новые типы: учёт по цвету всегда включён
                    1 if payload.requires_size else 0,
                    _now(),
                    creator_id,
                ),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def _update_product_type(item_id: str, payload: ProductTypeUpdateRequest, editor_id: str):
    _ensure_dictionary_table("product_types")
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM product_types WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        is_del = bool(meta["del"])
        if is_del and payload.is_deleted is not False:
            if (
                payload.name is not None
                or payload.is_active is not None
                or payload.requires_color is not None
                or payload.requires_size is not None
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена. Восстановите её перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Запись удалена",
                )

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(
                [
                    "is_deleted = 1",
                    "deleted_at = ?",
                    "deleted_by_id = ?",
                ]
            )
            values.extend([now, editor_id])
        elif payload.is_deleted is False:
            fields.extend(
                [
                    "is_deleted = 0",
                    "deleted_at = NULL",
                    "deleted_by_id = NULL",
                ]
            )
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

        if not fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нет данных для обновления",
            )
        fields.append("updated_at = ?")
        values.append(now)
        fields.append("updated_by_id = ?")
        values.append(editor_id)
        values.append(item_id)
        try:
            connection.execute(
                f"UPDATE product_types SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except IntegrityConstraintViolation as exc:
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


@app.get("/system/record-actuality", response_model=list[RecordActualityFilterItem])
def list_record_actuality_filter_items(admin=Depends(get_current_admin)):
    """Системный справочник для фильтра «актуальность» (не отображается в разделе справочников)."""
    _ = admin
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name FROM record_actuality
            ORDER BY sort_order ASC, LOWER(name) ASC
            """
        ).fetchall()
    return [RecordActualityFilterItem(id=r["id"], name=r["name"]) for r in rows]


@app.get("/clients", response_model=DictionaryListResponse)
def list_clients(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    return _list_dictionary_items_page(
        "clients",
        page,
        limit,
        search=search,
        actuality_id=actuality_id,
        date_from=df,
        date_to=dt,
        sort=sort,
        sort_columns=CLIENT_LIST_SORT_COLUMNS,
        default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@app.post("/clients", response_model=MessageResponse)
def create_client(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("clients", payload, admin["id"])


@app.get("/clients/{item_id}", response_model=DictionaryBaseItem)
def get_client(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _get_dictionary_item("clients", item_id, include_deleted=include_deleted)


@app.patch("/clients/{item_id}", response_model=MessageResponse)
def update_client(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("clients", item_id, payload, admin["id"])


@app.delete("/clients/{item_id}", response_model=MessageResponse)
def delete_client(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("clients", item_id, admin["id"])


@app.get("/colors", response_model=DictionaryListResponse)
def list_colors(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    return _list_dictionary_items_page(
        "colors",
        page,
        limit,
        search=name,
        actuality_id=actuality_id,
        date_from=df,
        date_to=dt,
        sort=sort,
        sort_columns=COLOR_LIST_SORT_COLUMNS,
        default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@app.post("/colors", response_model=MessageResponse)
def create_color(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("colors", payload, admin["id"])


@app.get("/colors/{item_id}", response_model=DictionaryBaseItem)
def get_color(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _get_dictionary_item("colors", item_id, include_deleted=include_deleted)


@app.patch("/colors/{item_id}", response_model=MessageResponse)
def update_color(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("colors", item_id, payload, admin["id"])


@app.delete("/colors/{item_id}", response_model=MessageResponse)
def delete_color(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("colors", item_id, admin["id"])


@app.get("/product-types", response_model=ProductTypeListResponse)
def list_product_types(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    return _list_product_types_page(
        page,
        limit,
        search=name,
        actuality_id=actuality_id,
        date_from=df,
        date_to=dt,
        sort=sort,
        include_deleted=include_deleted,
    )


@app.post("/product-types", response_model=MessageResponse)
def create_product_type(payload: ProductTypeCreateRequest, admin=Depends(get_current_admin)):
    return _create_product_type(payload, admin["id"])


@app.get("/product-types/{item_id}", response_model=ProductTypeDictionaryItem)
def get_product_type(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _get_product_type_item(item_id, include_deleted=include_deleted)


@app.patch("/product-types/{item_id}", response_model=MessageResponse)
def update_product_type(item_id: str, payload: ProductTypeUpdateRequest, admin=Depends(get_current_admin)):
    return _update_product_type(item_id, payload, admin["id"])


@app.delete("/product-types/{item_id}", response_model=MessageResponse)
def delete_product_type(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("product_types", item_id, admin["id"])


@app.get("/suppliers", response_model=DictionaryListResponse)
def list_suppliers(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    return _list_dictionary_items_page(
        "suppliers",
        page,
        limit,
        search=name,
        actuality_id=actuality_id,
        date_from=df,
        date_to=dt,
        sort=sort,
        sort_columns=CLIENT_LIST_SORT_COLUMNS,
        default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@app.post("/suppliers", response_model=MessageResponse)
def create_supplier(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("suppliers", payload, admin["id"])


@app.get("/suppliers/{item_id}", response_model=DictionaryBaseItem)
def get_supplier(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _get_dictionary_item("suppliers", item_id, include_deleted=include_deleted)


@app.patch("/suppliers/{item_id}", response_model=MessageResponse)
def update_supplier(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("suppliers", item_id, payload, admin["id"])


@app.delete("/suppliers/{item_id}", response_model=MessageResponse)
def delete_supplier(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("suppliers", item_id, admin["id"])


@app.get("/sizes", response_model=SizeListResponse)
def list_sizes(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _list_sizes_page(
        page,
        limit,
        name=name,
        actuality_id=actuality_id,
        sort=sort,
        include_deleted=include_deleted,
    )


@app.post("/sizes", response_model=MessageResponse)
def create_size(payload: SizeCreateRequest, admin=Depends(get_current_admin)):
    return _create_size(payload, admin["id"])


@app.get("/sizes/{item_id}", response_model=SizeItem)
def get_size(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return _get_size_item(item_id, include_deleted=include_deleted)


@app.patch("/sizes/{item_id}", response_model=MessageResponse)
def update_size(item_id: str, payload: SizeUpdateRequest, admin=Depends(get_current_admin)):
    return _update_size(item_id, payload, admin["id"])


@app.delete("/sizes/{item_id}", response_model=MessageResponse)
def delete_size(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("sizes", item_id, admin["id"])


@app.get("/products", response_model=ProductListResponse)
def list_products(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
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
            SELECT
                p.id,
                p.name,
                p.type_id,
                pt.name AS type_name,
                p.sku AS sku_base,
                COALESCE(pt.requires_color, 0) AS requires_color,
                COALESCE(pt.requires_size, 0) AS requires_size,
                p.client_id,
                c.name AS client_name,
                COALESCE(vcnt.cnt, 0) AS variant_count,
                p.is_active,
                COALESCE(p.is_deleted, 0) AS is_deleted,
                p.deleted_at,
                p.image_url,
                p.gallery_json,
                p.created_at,
                p.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
            {join_sql}
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return ProductListResponse(
        items=[
            ProductItem(
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
            for row in rows
        ],
        total=total,
        page=page,
        limit=limit,
    )


@app.get("/products/{item_id}", response_model=ProductItem)
def get_product(
    item_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                p.id,
                p.name,
                p.type_id,
                pt.name AS type_name,
                p.sku AS sku_base,
                COALESCE(pt.requires_color, 0) AS requires_color,
                COALESCE(pt.requires_size, 0) AS requires_size,
                p.client_id,
                c.name AS client_name,
                COALESCE(vcnt.cnt, 0) AS variant_count,
                p.is_active,
                COALESCE(p.is_deleted, 0) AS is_deleted,
                p.deleted_at,
                p.image_url,
                p.gallery_json,
                p.created_at,
                p.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by,
                deleter.email AS deleted_by
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
            WHERE p.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if bool(row["is_deleted"]) and not include_deleted:
        raise HTTPException(status_code=404, detail="Товар не найден")
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


@app.get("/product-variants/find", response_model=ProductVariantFindResponse)
def find_product_variant_for_receipt(
    sku: str = Query("", description="Штрих-код варианта или базовый штрих-код товара"),
    color_id: str = Query("", description="Идентификатор цвета"),
    size_id: str | None = Query(None, description="Размер; для одежды обязателен для однозначного поиска"),
    user=Depends(get_current_manager),
):
    """Поиск варианта для приёмки: admin / manager (роль «кладовщик» в ТЗ = manager)."""
    _ = user
    sku_t = sku.strip()
    cid = color_id.strip()
    if not sku_t or not cid:
        return ProductVariantFindResponse(found=False)
    with get_connection() as connection:
        row, needs_size = _find_variant_row_for_receipt(
            connection, sku_t, cid, size_id
        )
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
                product_type_name=str(row["product_type_name"])
                if row["product_type_name"]
                else None,
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


@app.get("/products/{item_id}/variants", response_model=list[ProductVariantItem])
def list_product_variants(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        exists = connection.execute(
            """
            SELECT 1 FROM products p
            WHERE p.id = ? AND COALESCE(p.is_deleted, 0) = 0
            """,
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Товар не найден")
        rows = connection.execute(
            """
            SELECT id, color_id, size_id, length, width, height, sku, images_json, is_active
            FROM product_variants
            WHERE product_id = ?
              AND COALESCE(is_deleted, 0) = 0
            ORDER BY LOWER(sku) ASC
            """,
            (item_id,),
        ).fetchall()
    return [
        ProductVariantItem(
            id=str(r["id"]),
            color_id=str(r["color_id"]),
            dimension=ProductVariantDimension(
                length=float(r["length"]),
                width=float(r["width"]),
                height=float(r["height"]),
            ),
            size_id=str(r["size_id"]) if r["size_id"] else None,
            sku=str(r["sku"]),
            images=_decode_images_json(r["images_json"]),
            is_active=bool(r["is_active"]),
        )
        for r in rows
    ]


@app.patch("/products/{item_id}/variants", response_model=MessageResponse)
def patch_product_variants(
    item_id: str,
    payload: ProductVariantsPatchRequest,
    admin=Depends(get_current_admin),
):
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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="SKU варианта уже занят",
            ) from exc
    return MessageResponse(message="Варианты сохранены")


def _require_product_not_deleted_for_variants(
    connection: Any, product_id: str
) -> None:
    r = connection.execute(
        "SELECT COALESCE(is_deleted, 0) FROM products WHERE id = ?",
        (product_id,),
    ).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Товар не найден")
    if bool(r[0]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Товар удалён. Восстановите товар перед изменением вариантов.",
        )


def _apply_product_variant_deleted_flag(
    item_id: str,
    variant_id: str,
    admin_id: str,
    *,
    is_deleted: bool,
) -> MessageResponse:
    now = _now()
    with get_connection() as connection:
        _require_product_not_deleted_for_variants(connection, item_id)
        row = connection.execute(
            """
            SELECT id, COALESCE(is_deleted, 0) AS del
            FROM product_variants
            WHERE id = ? AND product_id = ?
            """,
            (variant_id, item_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Вариант не найден")
        if is_deleted:
            if row["del"]:
                return MessageResponse(message="Вариант отключён")
            connection.execute(
                """
                UPDATE product_variants
                SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?,
                    updated_at = ?, is_active = 0
                WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0
                """,
                (now, admin_id, now, variant_id, item_id),
            )
        else:
            if not row["del"]:
                return MessageResponse(message="Вариант восстановлен")
            connection.execute(
                """
                UPDATE product_variants
                SET is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL,
                    updated_at = ?, is_active = 1
                WHERE id = ? AND product_id = ?
                """,
                (now, variant_id, item_id),
            )
        connection.execute(
            "UPDATE products SET updated_at = ?, updated_by_id = ? WHERE id = ?",
            (now, admin_id, item_id),
        )
        connection.commit()
    return MessageResponse(
        message="Вариант отключён" if is_deleted else "Вариант восстановлен"
    )


@app.patch(
    "/products/{item_id}/variants/{variant_id}",
    response_model=MessageResponse,
)
def patch_product_variant(
    item_id: str,
    variant_id: str,
    payload: ProductVariantDeletePatchRequest,
    admin=Depends(get_current_admin),
):
    return _apply_product_variant_deleted_flag(
        item_id,
        variant_id,
        admin["id"],
        is_deleted=payload.is_deleted,
    )


@app.delete("/products/{item_id}/variants/{variant_id}", response_model=MessageResponse)
def delete_product_variant(
    item_id: str, variant_id: str, admin=Depends(get_current_admin)
):
    return _apply_product_variant_deleted_flag(
        item_id, variant_id, admin["id"], is_deleted=True
    )


class ProductUploadImageResponse(BaseModel):
    url: str


@app.post("/products/upload-image", response_model=ProductUploadImageResponse)
async def upload_product_dictionary_image(
    image: UploadFile = File(...),
    admin=Depends(get_current_admin),
):
    _ = admin
    if not image.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = _product_image_extension(image.content_type, image.filename)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Допустимы изображения: jpg, png, heic",
        )
    filename = f"{uuid4()}{ext}"
    file_path = UPLOADS_DIR / filename
    file_path.write_bytes(await image.read())
    return ProductUploadImageResponse(url=f"/uploads/{filename}")


@app.post("/products", response_model=MessageResponse)
async def create_product(
    meta: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    admin=Depends(get_current_admin),
):
    try:
        parsed = ProductCreateMeta.model_validate_json(meta)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректные данные товара (meta JSON)",
        ) from exc

    image_urls: list[str] = []
    for image in images:
        if not image.filename:
            continue
        ext = _product_image_extension(image.content_type, image.filename)
        if not ext:
            raise HTTPException(
                status_code=400,
                detail="Допустимы изображения: jpg, png, heic",
            )
        filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / filename
        file_path.write_bytes(await image.read())
        image_urls.append(f"/uploads/{filename}")

    inner = parsed.product
    if not parsed.colors:
        raise HTTPException(status_code=400, detail="Выберите хотя бы один цвет")

    with get_connection() as connection:
        tid = _require_active_product_type(connection, inner.type_id)
        _, requires_size = _product_type_flags(connection, tid)
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
                INSERT INTO products (
                    id, name, type_id, client_id, supplier_id, sku, image_url, gallery_json,
                    is_active, created_at, creator_id
                )
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    pid,
                    _normalize_name(inner.name),
                    tid,
                    cid,
                    _normalize_sku(inner.sku_base),
                    preview_url,
                    gallery_ser,
                    1 if inner.is_active else 0,
                    now,
                    admin["id"],
                ),
            )
            for vr in variant_rows:
                connection.execute(
                    """
                    INSERT INTO product_variants (
                        id, product_id, color_id, size_id,
                        length, width, height, sku, images_json,
                        is_active, created_at, is_deleted
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
                    """,
                    (
                        str(uuid4()),
                        pid,
                        vr["color_id"],
                        vr["size_id"],
                        vr["length"],
                        vr["width"],
                        vr["height"],
                        vr["sku"],
                        vr["images_json"],
                        now,
                    ),
                )
            connection.commit()
        except IntegrityConstraintViolation as exc:
            connection.rollback()
            raise HTTPException(
                status_code=400,
                detail="Базовый штрих-код или SKU варианта уже существует",
            ) from exc
    return MessageResponse(message="Создано")


@app.patch("/products/{item_id}", response_model=MessageResponse)
def update_product(
    item_id: str,
    payload: ProductUpdateRequest,
    admin=Depends(get_current_admin),
):
    now = _now()
    with get_connection() as connection:
        meta = connection.execute(
            """
            SELECT COALESCE(is_deleted, 0) AS del, sku AS sku, type_id AS type_id
            FROM products WHERE id = ?
            """,
            (item_id,),
        ).fetchone()
        if not meta:
            raise HTTPException(status_code=404, detail="Товар не найден")
        is_del = bool(meta["del"])
        cur_sku = str(meta["sku"])
        cur_type = str(meta["type_id"])
        if is_del and payload.is_deleted is not False:
            if (
                payload.name is not None
                or payload.type_id is not None
                or payload.client_id is not None
                or payload.is_active is not None
                or payload.sku_base is not None
                or payload.image_urls is not None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Товар удалён. Восстановите его перед редактированием.",
                )
            if payload.is_deleted is None:
                raise HTTPException(status_code=400, detail="Товар удалён")

        if payload.type_id is not None:
            req_tid = str(payload.type_id).strip()
            if req_tid != cur_type:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Тип товара нельзя изменить после создания",
                )

        fields: list[str] = []
        values: list[object] = []
        if payload.is_deleted is True:
            fields.extend(
                [
                    "is_deleted = 1",
                    "deleted_at = ?",
                    "deleted_by_id = ?",
                ]
            )
            values.extend([now, admin["id"]])
        elif payload.is_deleted is False:
            fields.extend(
                [
                    "is_deleted = 0",
                    "deleted_at = NULL",
                    "deleted_by_id = NULL",
                ]
            )
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
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Базовый штрих-код уже занят",
                    )
                _rebase_variant_skus_for_new_product_base(
                    connection,
                    product_id=item_id,
                    old_base_sku=cur_sku,
                    new_base_sku=new_sku,
                    updated_at=now,
                )
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
        fields.append("updated_at = ?")
        values.append(now)
        fields.append("updated_by_id = ?")
        values.append(admin["id"])
        values.append(item_id)

        try:
            connection.execute(
                f"UPDATE products SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            if payload.is_deleted is True:
                _soft_delete_variants_for_product(connection, item_id, admin["id"], now)
            connection.commit()
        except IntegrityConstraintViolation as exc:
            connection.rollback()
            raise HTTPException(
                status_code=400,
                detail="Базовый штрих-код или SKU варианта уже существует",
            ) from exc
    msg = "Обновлено"
    if payload.is_deleted is True:
        msg = "Удалено"
    elif payload.is_deleted is False:
        msg = "Восстановлено"
    return MessageResponse(message=msg)


@app.delete("/products/{item_id}", response_model=MessageResponse)
def delete_product(item_id: str, admin=Depends(get_current_admin)):
    now = _now()
    with get_connection() as connection:
        exists = connection.execute(
            "SELECT id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        connection.execute(
            """
            UPDATE products
            SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?,
                updated_at = ?, updated_by_id = ?
            WHERE id = ?
            """,
            (now, admin["id"], now, admin["id"], item_id),
        )
        _soft_delete_variants_for_product(connection, item_id, admin["id"], now)
        connection.commit()
    return MessageResponse(message="Удалено")


# ============================================================================
# Inventory: операции (приход/расход), остатки.
# Бизнес-логика: см. ТЗ «Бизнес логика приемка отгрузка остатки».
# Доступ — менеджер и админ (get_current_manager).
# Остатки агрегируются из истории операций по ключу (product_id, color_id, size_id).
# ============================================================================


class InventoryProductTypeLookup(BaseModel):
    id: str
    name: str
    requires_color: bool
    requires_size: bool


class InventoryProductLookup(BaseModel):
    id: str
    name: str
    sku: str
    type_id: str
    type_name: str
    supplier_id: str | None = None
    supplier_name: str | None = None
    requires_color: bool
    requires_size: bool


class InventoryOperationCreate(BaseModel):
    op_type: str = Field(description="'in' — поступление, 'out' — отгрузка")
    client_id: str = Field(description="Клиент: проверяется как владелец товара")
    product_id: str
    color_id: str | None = None
    size_id: str | None = None
    quantity: int = Field(gt=0)
    note: str | None = None
    shipment_status: str | None = Field(
        default=None,
        description=f"Только out: '{SHIPMENT_STATUS_PENDING}' | '{SHIPMENT_STATUS_SHIPPED}'; "
        "по умолчанию для out — отгружено (совместимость API)",
    )
    shipment_date: str | None = Field(
        default=None,
        description="Только out: дата отгрузки YYYY-MM-DD (в created_at). Для ожидания — любая дата",
    )


class InventoryOperationItem(BaseModel):
    id: str
    op_type: str
    client_id: str | None
    client_name: str | None
    product_id: str
    product_name: str
    product_type_id: str | None
    product_type_name: str | None
    supplier_id: str | None
    supplier_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    variant_sku: str | None = Field(
        default=None, description="Штрих-код варианта (для сортировки/совместимости; в UI списка — product_sku)"
    )
    product_sku: str | None = Field(
        default=None, description="Базовый штрих-код товара (products.sku)"
    )
    preview_image_url: str | None = Field(default=None, description="Первое фото карточки товара")
    receipt_status: str | None = Field(
        default=None,
        description="Для op_type=in: pending | accepted; для отгрузки — null",
    )
    shipment_status: str | None = Field(
        default=None,
        description="Для op_type=out: pending | shipped; для прихода — null",
    )
    quantity: int
    note: str | None
    created_at: str
    created_by: str | None


class InventoryOperationListResponse(BaseModel):
    items: list[InventoryOperationItem]
    total: int
    page: int
    limit: int


class InventoryBalanceItem(BaseModel):
    product_id: str
    product_name: str
    product_sku: str = Field("", description="Базовый штрих-код карточки товара")
    preview_image_url: str | None = Field(None, description="Первое фото карточки товара")
    product_type_id: str | None
    product_type_name: str | None
    client_id: str | None
    client_name: str | None
    supplier_id: str | None
    supplier_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    quantity: int


class InventoryBalanceListResponse(BaseModel):
    items: list[InventoryBalanceItem]
    total: int
    page: int
    limit: int


def _inventory_balance_item_from_row(r: Mapping[str, Any]) -> InventoryBalanceItem:
    urls = _product_card_image_urls(r["gallery_json"], r["image_url"])
    preview = urls[0] if urls else None
    return InventoryBalanceItem(
        product_id=str(r["product_id"]),
        product_name=r["product_name"] or "",
        product_sku=str(r["product_sku"] or "").strip(),
        preview_image_url=preview,
        product_type_id=r["product_type_id"],
        product_type_name=r["product_type_name"],
        client_id=r["client_id"],
        client_name=r["client_name"],
        supplier_id=r["supplier_id"],
        supplier_name=r["supplier_name"],
        color_id=r["color_id"],
        color_name=r["color_name"],
        size_id=r["size_id"],
        size_name=r["size_name"],
        quantity=int(r["quantity"]),
    )


class InventorySingleBalanceResponse(BaseModel):
    quantity: int


def _active_lookup_dictionary(table_name: str) -> list[DictionaryBaseItem]:
    _ensure_dictionary_table(table_name)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT id, name, is_active, created_at, NULL AS created_by,
                   NULL AS updated_at, NULL AS updated_by
            FROM {table_name}
            WHERE is_active = 1 AND COALESCE(is_deleted, 0) = 0
            ORDER BY LOWER(name) ASC
            """
        ).fetchall()
    return [
        DictionaryBaseItem(
            id=r["id"],
            name=r["name"],
            is_active=bool(r["is_active"]),
            created_at=r["created_at"],
            created_by=None,
            updated_at=None,
            updated_by=None,
        )
        for r in rows
    ]


def _balance_qty(
    connection: Any,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
) -> int:
    row = connection.execute(
        """
        SELECT
            COALESCE(SUM(
                CASE WHEN op_type = 'in'
                     AND COALESCE(receipt_status, 'accepted') = 'accepted'
                THEN quantity ELSE 0 END
            ), 0) AS qty_in,
            COALESCE(SUM(CASE WHEN op_type = 'out'
                     AND COALESCE(shipment_status, 'shipped') = ?
                THEN quantity ELSE 0 END), 0) AS qty_out
        FROM inventory_operations
        WHERE product_id = ?
          AND COALESCE(color_id, '') = COALESCE(?, '')
          AND COALESCE(size_id, '') = COALESCE(?, '')
          AND COALESCE(is_deleted, 0) = 0
        """,
        (SHIPMENT_STATUS_SHIPPED, product_id, color_id, size_id),
    ).fetchone()
    return int(row["qty_in"]) - int(row["qty_out"])


@app.get("/inventory/lookups/clients", response_model=list[DictionaryBaseItem])
def inventory_lookup_clients(user=Depends(get_current_manager)):
    _ = user
    return _active_lookup_dictionary("clients")


@app.get("/inventory/lookups/colors", response_model=list[DictionaryBaseItem])
def inventory_lookup_colors(user=Depends(get_current_manager)):
    _ = user
    return _active_lookup_dictionary("colors")


@app.get(
    "/inventory/lookups/colors-for-sku",
    response_model=list[DictionaryBaseItem],
)
def inventory_lookup_colors_for_sku(
    sku: str = Query(..., description="Базовый штрих-код товара (products.sku)"),
    user=Depends(get_current_manager),
):
    """Цвета, для которых у товара есть варианты (только по этому штрих-коду)."""
    _ = user
    s = str(sku).strip()
    if not s:
        return []
    with get_connection() as connection:
        prow = connection.execute(
            """
            SELECT p.id
            FROM products p
            WHERE COALESCE(p.is_deleted, 0) = 0
              AND p.is_active = 1
              AND LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(?)
            LIMIT 1
            """,
            (s,),
        ).fetchone()
        if not prow:
            return []
        pid = str(prow["id"])
        rows = connection.execute(
            """
            SELECT id, name, is_active, created_at, created_by, updated_at, updated_by, is_deleted
            FROM (
              SELECT DISTINCT d.id, d.name, d.is_active, d.created_at,
                     NULL AS created_by, NULL AS updated_at, NULL AS updated_by,
                     COALESCE(d.is_deleted, 0) AS is_deleted
              FROM product_variants v
              INNER JOIN colors d ON d.id = v.color_id
              WHERE v.product_id = ?
                AND COALESCE(v.is_deleted, 0) = 0
                AND COALESCE(v.is_active, 1) = 1
                AND v.color_id IS NOT NULL
                AND d.is_active = 1
                AND COALESCE(d.is_deleted, 0) = 0
            ) t
            ORDER BY LOWER(t.name) ASC
            """,
            (pid,),
        ).fetchall()
    return [
        DictionaryBaseItem(
            id=str(r["id"]),
            name=r["name"],
            is_active=bool(r["is_active"]),
            is_deleted=bool(r["is_deleted"]) if r["is_deleted"] is not None else False,
            created_at=r["created_at"],
            created_by=None,
            updated_at=None,
            updated_by=None,
        )
        for r in rows
    ]


@app.get(
    "/inventory/lookups/sizes-for-sku",
    response_model=list[DictionaryBaseItem],
)
def inventory_lookup_sizes_for_sku(
    sku: str = Query(..., description="Базовый штрих-код товара (products.sku)"),
    color_id: str = Query(..., description="Цвет варианта"),
    user=Depends(get_current_manager),
):
    """Размеры вариантов для пары товар (штрих-код) + цвет."""
    _ = user
    s = str(sku).strip()
    cid = str(color_id).strip()
    if not s or not cid:
        return []
    with get_connection() as connection:
        prow = connection.execute(
            """
            SELECT p.id
            FROM products p
            WHERE COALESCE(p.is_deleted, 0) = 0
              AND p.is_active = 1
              AND LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(?)
            LIMIT 1
            """,
            (s,),
        ).fetchone()
        if not prow:
            return []
        pid = str(prow["id"])
        rows = connection.execute(
            """
            SELECT id, name, is_active, created_at, created_by, updated_at, updated_by, is_deleted
            FROM (
              SELECT DISTINCT d.id, d.name, d.is_active, d.created_at,
                     NULL AS created_by, NULL AS updated_at, NULL AS updated_by,
                     COALESCE(d.is_deleted, 0) AS is_deleted
              FROM product_variants v
              INNER JOIN sizes d ON d.id = v.size_id
              WHERE v.product_id = ?
                AND v.color_id = ?
                AND COALESCE(v.is_deleted, 0) = 0
                AND COALESCE(v.is_active, 1) = 1
                AND v.size_id IS NOT NULL
                AND d.is_active = 1
                AND COALESCE(d.is_deleted, 0) = 0
            ) t
            ORDER BY LOWER(t.name) ASC
            """,
            (pid, cid),
        ).fetchall()
    return [
        DictionaryBaseItem(
            id=str(r["id"]),
            name=r["name"],
            is_active=bool(r["is_active"]),
            is_deleted=bool(r["is_deleted"]) if r["is_deleted"] is not None else False,
            created_at=r["created_at"],
            created_by=None,
            updated_at=None,
            updated_by=None,
        )
        for r in rows
    ]


@app.get("/inventory/lookups/sizes", response_model=list[DictionaryBaseItem])
def inventory_lookup_sizes(user=Depends(get_current_manager)):
    _ = user
    return _active_lookup_dictionary("sizes")


@app.get(
    "/inventory/lookups/product-types",
    response_model=list[InventoryProductTypeLookup],
)
def inventory_lookup_product_types(user=Depends(get_current_manager)):
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name, requires_color, requires_size
            FROM product_types
            WHERE is_active = 1
            ORDER BY LOWER(name) ASC
            """
        ).fetchall()
    return [
        InventoryProductTypeLookup(
            id=r["id"],
            name=r["name"],
            requires_color=bool(r["requires_color"]),
            requires_size=bool(r["requires_size"]),
        )
        for r in rows
    ]


@app.get("/inventory/lookups/suppliers", response_model=list[DictionaryBaseItem])
def inventory_lookup_suppliers(user=Depends(get_current_manager)):
    _ = user
    return _active_lookup_dictionary("suppliers")


@app.get("/inventory/lookups/products", response_model=list[InventoryProductLookup])
def inventory_lookup_products(
    client_id: str | None = Query(None, description="Фильтр по клиенту-владельцу товара"),
    user=Depends(get_current_manager),
):
    _ = user
    conds = ["p.is_active = 1", "COALESCE(p.is_deleted, 0) = 0"]
    params: list[object] = []
    if client_id is not None and str(client_id).strip():
        conds.append("p.client_id = ?")
        params.append(str(client_id).strip())
    where_sql = " AND ".join(conds)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT p.id, p.name, p.sku, p.type_id,
                   pt.name AS type_name,
                   p.supplier_id, sp.name AS supplier_name,
                   pt.requires_color, pt.requires_size
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN suppliers sp ON sp.id = p.supplier_id
            WHERE {where_sql}
            ORDER BY LOWER(p.name) ASC
            """,
            params,
        ).fetchall()
    return [
        InventoryProductLookup(
            id=r["id"],
            name=r["name"],
            sku=r["sku"],
            type_id=r["type_id"],
            type_name=r["type_name"] or "",
            supplier_id=r["supplier_id"],
            supplier_name=r["supplier_name"],
            requires_color=bool(r["requires_color"]) if r["requires_color"] is not None else False,
            requires_size=bool(r["requires_size"]) if r["requires_size"] is not None else False,
        )
        for r in rows
    ]


@app.get("/inventory/lookups/skus", response_model=list[str])
def inventory_lookup_skus(user=Depends(get_current_manager)):
    """Базовые штрих-коды товаров (`products.sku`) для выбора в приёмке (без штрих-кодов вариантов)."""
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT sku FROM (
              SELECT DISTINCT TRIM(p.sku) AS sku
              FROM products p
              WHERE COALESCE(p.is_deleted, 0) = 0
                AND p.is_active = 1
                AND TRIM(COALESCE(p.sku, '')) != ''
            ) t
            ORDER BY LOWER(sku) ASC
            """
        ).fetchall()
    return [str(r["sku"]).strip() for r in rows]


@app.get("/inventory/balance/single", response_model=InventorySingleBalanceResponse)
def inventory_balance_single(
    product_id: str = Query(...),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    user=Depends(get_current_manager),
):
    """Текущий остаток по точному ключу (product, color, size). Используется в форме отгрузки."""
    _ = user
    pid = str(product_id).strip()
    if not pid:
        raise HTTPException(status_code=400, detail="product_id обязателен")
    cid = (color_id or "").strip() or None
    sid = (size_id or "").strip() or None
    with get_connection() as connection:
        qty = _balance_qty(connection, pid, cid, sid)
    return InventorySingleBalanceResponse(quantity=qty)


@app.get("/inventory/operations", response_model=InventoryOperationListResponse)
def list_inventory_operations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    op_type: str | None = Query(None, description="'in' или 'out'"),
    client_id: str | None = Query(None),
    product_id: str | None = Query(None),
    supplier_id: str | None = Query(None),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    sku: str | None = Query(None, description="Подстрока по базовому штрих-коду товара (products.sku)"),
    name: str | None = Query(None, description="Подстрока по названию товара (products.name)"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    receipt_status: str | None = Query(
        None,
        description=f"Только приход: '{RECEIPT_STATUS_PENDING}' | '{RECEIPT_STATUS_ACCEPTED}'",
    ),
    shipment_status: str | None = Query(
        None,
        description=f"Только расход: '{SHIPMENT_STATUS_PENDING}' | '{SHIPMENT_STATUS_SHIPPED}'",
    ),
    sort: str | None = Query(None),
    user=Depends(get_current_manager),
):
    _ = user
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    offset = (page - 1) * limit
    conds = ["1=1", SQL_WHERE_INV_OP_ACTIVE_O]
    params: list[object] = []
    if op_type is not None and str(op_type).strip():
        v = str(op_type).strip()
        if v not in ("in", "out"):
            raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
        conds.append("o.op_type = ?")
        params.append(v)
    if client_id is not None and str(client_id).strip():
        conds.append("p.client_id = ?")
        params.append(str(client_id).strip())
    if supplier_id is not None and str(supplier_id).strip():
        conds.append("p.supplier_id = ?")
        params.append(str(supplier_id).strip())
    if product_id is not None and str(product_id).strip():
        conds.append("o.product_id = ?")
        params.append(str(product_id).strip())
    if color_id is not None and str(color_id).strip():
        conds.append("o.color_id = ?")
        params.append(str(color_id).strip())
    if size_id is not None and str(size_id).strip():
        conds.append("o.size_id = ?")
        params.append(str(size_id).strip())
    if sku is not None and str(sku).strip():
        conds.append("fold_ci(COALESCE(p.sku, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(sku)))
    if name is not None and str(name).strip():
        conds.append("fold_ci(COALESCE(p.name, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(name)))
    if df is not None:
        conds.append("substr(o.created_at, 1, 10) >= ?")
        params.append(df)
    if dt is not None:
        conds.append("substr(o.created_at, 1, 10) <= ?")
        params.append(dt)
    if receipt_status is not None and str(receipt_status).strip():
        rsq = str(receipt_status).strip().lower()
        if rsq not in (RECEIPT_STATUS_PENDING, RECEIPT_STATUS_ACCEPTED):
            raise HTTPException(
                status_code=400,
                detail=f"receipt_status: допустимо {RECEIPT_STATUS_PENDING} | {RECEIPT_STATUS_ACCEPTED}",
            )
        if op_type is None or str(op_type).strip() != "out":
            conds.append("COALESCE(o.receipt_status, 'accepted') = ?")
            params.append(rsq)
    if shipment_status is not None and str(shipment_status).strip():
        ssq = str(shipment_status).strip().lower()
        if ssq not in (SHIPMENT_STATUS_PENDING, SHIPMENT_STATUS_SHIPPED):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"shipment_status: допустимо {SHIPMENT_STATUS_PENDING} | "
                    f"{SHIPMENT_STATUS_SHIPPED}"
                ),
            )
        if op_type is None or str(op_type).strip() != "in":
            conds.append("COALESCE(o.shipment_status, 'shipped') = ?")
            params.append(ssq)
    where_sql = " AND ".join(conds)
    join_sql = """
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        LEFT JOIN colors col ON col.id = o.color_id
        LEFT JOIN sizes sz ON sz.id = o.size_id
        LEFT JOIN users u ON u.id = o.created_by_id
        LEFT JOIN product_variants pv ON pv.id = o.variant_id
    """
    order_sql = (
        _order_sql_from_sort_param(sort, INVENTORY_OPERATIONS_SORT_COLUMNS)
        or "o.created_at DESC"
    )
    with get_connection() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt {join_sql} WHERE {where_sql}", params
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT
                o.id, o.op_type, o.product_id, o.color_id, o.size_id, o.quantity,
                o.note, o.created_at, o.variant_id, o.variant_sku, o.receipt_status,
                o.shipment_status,
                p.name AS product_name, p.client_id, p.type_id AS product_type_id,
                p.sku AS product_sku, p.gallery_json, p.image_url,
                pt.name AS product_type_name,
                p.supplier_id, sp.name AS supplier_name,
                cl.name AS client_name,
                col.name AS color_name,
                sz.name AS size_name,
                pv.sku AS pv_sku,
                u.email AS created_by
            {join_sql}
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    items: list[InventoryOperationItem] = []
    for r in rows:
        urls = _product_card_image_urls(r["gallery_json"], r["image_url"])
        preview = urls[0] if urls else None
        vs = (r["variant_sku"] or r["pv_sku"] or r["product_sku"] or "").strip() or None
        op_t = str(r["op_type"])
        rec_st: str | None = None
        ship_st: str | None = None
        if op_t == "in":
            rec_st = str(r["receipt_status"] or RECEIPT_STATUS_ACCEPTED)
        elif op_t == "out":
            ship_st = str(r["shipment_status"] or SHIPMENT_STATUS_SHIPPED)
        items.append(
            InventoryOperationItem(
                id=r["id"],
                op_type=op_t,
                client_id=r["client_id"],
                client_name=r["client_name"],
                product_id=r["product_id"],
                product_name=r["product_name"] or "",
                product_type_id=r["product_type_id"],
                product_type_name=r["product_type_name"],
                supplier_id=r["supplier_id"],
                supplier_name=r["supplier_name"],
                color_id=r["color_id"],
                color_name=r["color_name"],
                size_id=r["size_id"],
                size_name=r["size_name"],
                variant_sku=vs,
                product_sku=str(r["product_sku"] or "").strip() or None,
                preview_image_url=preview,
                receipt_status=rec_st,
                shipment_status=ship_st,
                quantity=int(r["quantity"]),
                note=r["note"],
                created_at=r["created_at"],
                created_by=r["created_by"],
            )
        )
    return InventoryOperationListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


@app.post("/inventory/operations", response_model=MessageResponse)
def create_inventory_operation(
    payload: InventoryOperationCreate,
    user=Depends(get_current_manager),
):
    op_type = payload.op_type.strip().lower()
    if op_type not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")

    pid = payload.product_id.strip()
    cid = (payload.color_id or "").strip() or None
    sid = (payload.size_id or "").strip() or None
    note = (payload.note or "").strip() or None

    with get_connection() as connection:
        client_id = _require_active_client(connection, payload.client_id)
        product = connection.execute(
            """
            SELECT p.id, p.name, p.client_id, p.is_active,
                   pt.id AS type_id, pt.name AS type_name,
                   pt.requires_color, pt.requires_size
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            WHERE p.id = ? AND COALESCE(p.is_deleted, 0) = 0
            """,
            (pid,),
        ).fetchone()
        if not product:
            raise HTTPException(status_code=400, detail="Товар не найден")
        if not bool(product["is_active"]):
            raise HTTPException(status_code=400, detail="Товар не актуален")
        if product["client_id"] != client_id:
            raise HTTPException(
                status_code=400,
                detail="Название: товар не привязан к выбранному клиенту",
            )

        requires_color = bool(product["requires_color"]) if product["requires_color"] is not None else False
        requires_size = bool(product["requires_size"]) if product["requires_size"] is not None else False

        if requires_color and not cid:
            raise HTTPException(status_code=400, detail="Цвет обязателен для этого типа товара")
        if requires_size and not sid:
            raise HTTPException(status_code=400, detail="Размер обязателен для этого типа товара")

        if cid:
            ok = connection.execute(
                "SELECT 1 FROM colors WHERE id = ? AND is_active = 1", (cid,)
            ).fetchone()
            if not ok:
                raise HTTPException(
                    status_code=400, detail="Цвет: недопустимое или неактивное значение"
                )
        if sid:
            ok = connection.execute(
                "SELECT 1 FROM sizes WHERE id = ? AND is_active = 1", (sid,)
            ).fetchone()
            if not ok:
                raise HTTPException(
                    status_code=400, detail="Размер: недопустимое или неактивное значение"
                )

        if op_type == "in":
            in_rs = RECEIPT_STATUS_ACCEPTED
            connection.execute(
                """
                INSERT INTO inventory_operations
                    (id, op_type, product_id, color_id, size_id, quantity, note,
                     created_at, created_by_id, receipt_status, shipment_status)
                VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    str(uuid4()),
                    pid,
                    cid,
                    sid,
                    int(payload.quantity),
                    note,
                    _now(),
                    user["id"],
                    in_rs,
                ),
            )
        else:
            ss = (payload.shipment_status or "").strip().lower() or SHIPMENT_STATUS_SHIPPED
            if ss not in (SHIPMENT_STATUS_PENDING, SHIPMENT_STATUS_SHIPPED):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"shipment_status: допустимо {SHIPMENT_STATUS_PENDING} | "
                        f"{SHIPMENT_STATUS_SHIPPED}"
                    ),
                )
            created_at = _created_at_for_shipment_date(
                (payload.shipment_date or "").strip() or None,
                allow_future=(ss == SHIPMENT_STATUS_PENDING),
            )
            if ss == SHIPMENT_STATUS_SHIPPED:
                current = _balance_qty(connection, pid, cid, sid)
                if current < payload.quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Недостаточно остатка: доступно {current}, "
                            f"требуется {payload.quantity}"
                        ),
                    )
            connection.execute(
                """
                INSERT INTO inventory_operations
                    (id, op_type, product_id, color_id, size_id, quantity, note,
                     created_at, created_by_id, receipt_status, shipment_status)
                VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    str(uuid4()),
                    pid,
                    cid,
                    sid,
                    int(payload.quantity),
                    note,
                    created_at,
                    user["id"],
                    ss,
                ),
            )
        connection.commit()
    return MessageResponse(message="Создано")


@app.post("/inventory/receipt", response_model=MessageResponse)
def create_inventory_receipt(
    payload: ReceiptCreate,
    user=Depends(get_current_manager),
):
    """Приёмка по варианту: op_type=in; дублирует POST /receipts."""
    return _create_receipt_from_variant(payload, user)


@app.post("/receipts", response_model=MessageResponse)
def create_receipt(
    payload: ReceiptCreate,
    user=Depends(get_current_manager),
):
    """Создание приёмки (поступления) по варианту товара."""
    return _create_receipt_from_variant(payload, user)


def _create_receipt_from_variant(payload: ReceiptCreate, user: dict) -> MessageResponse:
    vid = payload.variant_id.strip()
    if not vid:
        raise HTTPException(status_code=400, detail="Укажите вариант")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
    rs = str(payload.receipt_status or "").strip().lower() or RECEIPT_STATUS_ACCEPTED
    if rs not in (RECEIPT_STATUS_PENDING, RECEIPT_STATUS_ACCEPTED):
        raise HTTPException(
            status_code=400,
            detail=f"receipt_status: допустимо {RECEIPT_STATUS_PENDING} | {RECEIPT_STATUS_ACCEPTED}",
        )
    note = (payload.comment or "").strip() or None

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT v.id, v.sku AS v_sku, v.product_id, v.color_id, v.size_id,
                   COALESCE(v.is_deleted, 0) AS vdel,
                   COALESCE(p.is_deleted, 0) AS pdel,
                   COALESCE(v.is_active, 1) AS vact,
                   COALESCE(p.is_active, 1) AS pact
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            WHERE v.id = ?
            """,
            (vid,),
        ).fetchone()
        if not row or bool(row["vdel"]) or bool(row["pdel"]):
            raise HTTPException(status_code=400, detail="Вариант не найден")
        if not bool(row["vact"]) or not bool(row["pact"]):
            raise HTTPException(status_code=400, detail="Товар не актуален")

        pid = str(row["product_id"])
        cid = str(row["color_id"]) if row["color_id"] else None
        sid = str(row["size_id"]) if row["size_id"] else None
        vsku = str(row["v_sku"]).strip()
        created_at = _created_at_for_receipt_date(
            (payload.receipt_date or "").strip() or None,
            allow_future=(rs == RECEIPT_STATUS_PENDING),
        )

        connection.execute(
            """
            INSERT INTO inventory_operations
                (id, op_type, product_id, color_id, size_id, quantity, note,
                 created_at, created_by_id, variant_id, variant_sku, receipt_status)
            VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                pid,
                cid,
                sid,
                int(payload.quantity),
                note,
                created_at,
                user["id"],
                vid,
                vsku,
                rs,
            ),
        )
        connection.commit()
    if rs == RECEIPT_STATUS_PENDING:
        return MessageResponse(message="Поступление запланировано")
    return MessageResponse(message="Товар принят на склад")


def _receipt_detail_from_connection(
    connection: Any, op_id: str
) -> ReceiptDetailResponse:
    row = connection.execute(
        """
        SELECT o.id, o.op_type, o.product_id, o.color_id, o.size_id, o.quantity, o.note,
               o.created_at, o.variant_id, o.variant_sku,
               COALESCE(o.receipt_status, ?) AS receipt_status,
               p.name AS product_name, p.sku AS product_sku, p.client_id, p.gallery_json, p.image_url,
               cl.name AS client_name, pt.name AS product_type_name,
               u.email AS created_by
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN users u ON u.id = o.created_by_id
        WHERE o.id = ? AND o.op_type = 'in' AND COALESCE(o.is_deleted, 0) = 0
        """,
        (RECEIPT_STATUS_ACCEPTED, op_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Поступление не найдено")
    vr = None
    if row["variant_id"] and str(row["variant_id"]).strip():
        vr = connection.execute(
            """
            SELECT length, width, height, sku
            FROM product_variants
            WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (str(row["variant_id"]).strip(),),
        ).fetchone()
    if not vr:
        vr = connection.execute(
            """
            SELECT length, width, height, sku
            FROM product_variants
            WHERE product_id = ? AND color_id = ? AND COALESCE(size_id, '') = COALESCE(?, '')
              AND COALESCE(is_deleted, 0) = 0
            LIMIT 1
            """,
            (row["product_id"], row["color_id"], row["size_id"]),
        ).fetchone()
    if not vr:
        raise HTTPException(status_code=400, detail="Не удалось сопоставить вариант")
    urls = _product_card_image_urls(row["gallery_json"], row["image_url"])
    first_img = urls[0] if urls else None
    base_sku = str(row["product_sku"] or "").strip()
    variant_sku_display = (row["variant_sku"] or vr["sku"] or "").strip()
    sku_for_form = base_sku if base_sku else variant_sku_display
    return ReceiptDetailResponse(
        id=str(row["id"]),
        variant_id=str(row["variant_id"]) if row["variant_id"] else None,
        sku=sku_for_form,
        color_id=str(row["color_id"]) if row["color_id"] else None,
        size_id=str(row["size_id"]) if row["size_id"] else None,
        quantity=int(row["quantity"]),
        comment=row["note"],
        receipt_status=str(row["receipt_status"] or RECEIPT_STATUS_ACCEPTED),
        product_id=str(row["product_id"]),
        product_name=str(row["product_name"] or ""),
        product_type_name=str(row["product_type_name"] or "") or None,
        client_id=str(row["client_id"]) if row["client_id"] else None,
        client_name=str(row["client_name"] or "") or None,
        length=float(vr["length"]),
        width=float(vr["width"]),
        height=float(vr["height"]),
        first_image_url=first_img,
        created_at=str(row["created_at"]),
        created_by=row["created_by"],
    )


def _shipment_detail_from_connection(
    connection: Any, op_id: str
) -> ShipmentDetailResponse:
    row = connection.execute(
        """
        SELECT o.id, o.op_type, o.product_id, o.color_id, o.size_id, o.quantity, o.note,
               o.created_at, o.variant_id, o.variant_sku,
               COALESCE(o.shipment_status, ?) AS shipment_status,
               p.name AS product_name, p.sku AS product_sku, p.client_id, p.gallery_json, p.image_url,
               cl.name AS client_name, pt.name AS product_type_name,
               u.email AS created_by
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN users u ON u.id = o.created_by_id
        WHERE o.id = ? AND o.op_type = 'out' AND COALESCE(o.is_deleted, 0) = 0
        """,
        (SHIPMENT_STATUS_SHIPPED, op_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Отгрузка не найдена")
    vr = None
    if row["variant_id"] and str(row["variant_id"]).strip():
        vr = connection.execute(
            """
            SELECT length, width, height, sku
            FROM product_variants
            WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (str(row["variant_id"]).strip(),),
        ).fetchone()
    if not vr:
        vr = connection.execute(
            """
            SELECT length, width, height, sku
            FROM product_variants
            WHERE product_id = ? AND color_id = ? AND COALESCE(size_id, '') = COALESCE(?, '')
              AND COALESCE(is_deleted, 0) = 0
            LIMIT 1
            """,
            (row["product_id"], row["color_id"], row["size_id"]),
        ).fetchone()
    if not vr:
        raise HTTPException(status_code=400, detail="Не удалось сопоставить вариант")
    urls = _product_card_image_urls(row["gallery_json"], row["image_url"])
    first_img = urls[0] if urls else None
    base_sku = str(row["product_sku"] or "").strip()
    variant_sku_display = (row["variant_sku"] or vr["sku"] or "").strip()
    sku_for_form = base_sku if base_sku else variant_sku_display
    return ShipmentDetailResponse(
        id=str(row["id"]),
        variant_id=str(row["variant_id"]) if row["variant_id"] else None,
        sku=sku_for_form,
        color_id=str(row["color_id"]) if row["color_id"] else None,
        size_id=str(row["size_id"]) if row["size_id"] else None,
        quantity=int(row["quantity"]),
        comment=row["note"],
        shipment_status=str(row["shipment_status"] or SHIPMENT_STATUS_SHIPPED),
        product_id=str(row["product_id"]),
        product_name=str(row["product_name"] or ""),
        product_type_name=str(row["product_type_name"] or "") or None,
        client_id=str(row["client_id"]) if row["client_id"] else None,
        client_name=str(row["client_name"] or "") or None,
        length=float(vr["length"]),
        width=float(vr["width"]),
        height=float(vr["height"]),
        first_image_url=first_img,
        created_at=str(row["created_at"]),
        created_by=row["created_by"],
    )


def _create_shipment_from_variant(payload: ShipmentCreate, user: dict) -> MessageResponse:
    vid = payload.variant_id.strip()
    if not vid:
        raise HTTPException(status_code=400, detail="Укажите вариант")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
    ss = str(payload.shipment_status or "").strip().lower() or SHIPMENT_STATUS_PENDING
    if ss not in (SHIPMENT_STATUS_PENDING, SHIPMENT_STATUS_SHIPPED):
        raise HTTPException(
            status_code=400,
            detail=(
                f"shipment_status: допустимо {SHIPMENT_STATUS_PENDING} | "
                f"{SHIPMENT_STATUS_SHIPPED}"
            ),
        )
    note = (payload.comment or "").strip() or None

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT v.id, v.sku AS v_sku, v.product_id, v.color_id, v.size_id,
                   COALESCE(v.is_deleted, 0) AS vdel,
                   COALESCE(p.is_deleted, 0) AS pdel,
                   COALESCE(v.is_active, 1) AS vact,
                   COALESCE(p.is_active, 1) AS pact
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            WHERE v.id = ?
            """,
            (vid,),
        ).fetchone()
        if not row or bool(row["vdel"]) or bool(row["pdel"]):
            raise HTTPException(status_code=400, detail="Вариант не найден")
        if not bool(row["vact"]) or not bool(row["pact"]):
            raise HTTPException(status_code=400, detail="Товар не актуален")

        pid = str(row["product_id"])
        cid = str(row["color_id"]) if row["color_id"] else None
        sid = str(row["size_id"]) if row["size_id"] else None
        vsku = str(row["v_sku"]).strip()
        created_at = _created_at_for_shipment_date(
            (payload.shipment_date or "").strip() or None,
            allow_future=(ss == SHIPMENT_STATUS_PENDING),
        )

        if ss == SHIPMENT_STATUS_SHIPPED:
            current = _balance_qty(connection, pid, cid, sid)
            if current < int(payload.quantity):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Недостаточно остатка: доступно {current}, "
                        f"требуется {payload.quantity}"
                    ),
                )

        connection.execute(
            """
            INSERT INTO inventory_operations
                (id, op_type, product_id, color_id, size_id, quantity, note,
                 created_at, created_by_id, variant_id, variant_sku, receipt_status, shipment_status)
            VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                str(uuid4()),
                pid,
                cid,
                sid,
                int(payload.quantity),
                note,
                created_at,
                user["id"],
                vid,
                vsku,
                ss,
            ),
        )
        connection.commit()
    if ss == SHIPMENT_STATUS_PENDING:
        return MessageResponse(message="Отгрузка запланирована")
    return MessageResponse(message="Отгрузка отражена на складе")


@app.post("/shipments", response_model=MessageResponse)
def create_shipment(
    payload: ShipmentCreate,
    user=Depends(get_current_manager),
):
    """Создание отгрузки по варианту (план или факт)."""
    return _create_shipment_from_variant(payload, user)


@app.get("/shipments/{shipment_id}", response_model=ShipmentDetailResponse)
def get_shipment(
    shipment_id: str,
    user=Depends(get_current_manager),
):
    _ = user
    with get_connection() as connection:
        return _shipment_detail_from_connection(connection, shipment_id.strip())


@app.patch("/shipments/{shipment_id}", response_model=MessageResponse)
def patch_shipment(
    shipment_id: str,
    payload: ShipmentPatch,
    user=Depends(get_current_manager),
):
    _ = user
    sid = shipment_id.strip()
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Нет данных для обновления")

    change_variant = bool(
        "variant_id" in patch and (patch.get("variant_id") or "").strip()
    )

    with get_connection() as connection:
        cur_row = connection.execute(
            """
            SELECT id, op_type, product_id, color_id, size_id, quantity, created_at,
                   COALESCE(shipment_status, ?) AS shipment_status
            FROM inventory_operations WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (SHIPMENT_STATUS_SHIPPED, sid),
        ).fetchone()
        if not cur_row or str(cur_row["op_type"]) != "out":
            raise HTTPException(status_code=404, detail="Отгрузка не найдена")

        cur_ss = str(cur_row["shipment_status"])
        if "shipment_status" in patch and patch["shipment_status"] is not None:
            eff_ss = str(patch["shipment_status"]).strip().lower()
        else:
            eff_ss = cur_ss
        allow_date_future = eff_ss == SHIPMENT_STATUS_PENDING

        if "shipment_status" in patch and patch["shipment_status"] is not None:
            new_ss = str(patch["shipment_status"]).strip().lower()
            if new_ss not in (SHIPMENT_STATUS_PENDING, SHIPMENT_STATUS_SHIPPED):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"shipment_status: допустимо {SHIPMENT_STATUS_PENDING} | "
                        f"{SHIPMENT_STATUS_SHIPPED}"
                    ),
                )

        if (
            "shipment_status" in patch
            and patch["shipment_status"] is not None
            and str(patch["shipment_status"]).strip().lower() == SHIPMENT_STATUS_SHIPPED
            and "shipment_date" not in patch
        ):
            _assert_shipment_posting_day_not_after_today(cur_row["created_at"])

        def _stock_headroom(
            pid_: str, cid_: str | None, sid_: str | None, shipped: bool, q_line: int
        ) -> int:
            return _balance_qty(connection, pid_, cid_, sid_) + (
                int(q_line) if shipped else 0
            )

        if change_variant:
            new_vid = str(patch["variant_id"]).strip()
            vrow = connection.execute(
                """
                SELECT v.id, v.sku, v.product_id, v.color_id, v.size_id,
                       COALESCE(v.is_deleted,0) AS vdel, COALESCE(p.is_deleted,0) AS pdel,
                       COALESCE(v.is_active,1) AS vact, COALESCE(p.is_active,1) AS pact
                FROM product_variants v
                JOIN products p ON p.id = v.product_id
                WHERE v.id = ?
                """,
                (new_vid,),
            ).fetchone()
            if not vrow or vrow["vdel"] or vrow["pdel"] or not vrow["vact"] or not vrow["pact"]:
                raise HTTPException(status_code=400, detail="Вариант не найден")
            qty_bind = int(patch["quantity"]) if "quantity" in patch else None
            if qty_bind is not None and qty_bind <= 0:
                raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
            note_bind = (
                (patch["comment"] or "").strip() or None if "comment" in patch else None
            )
            npid = str(vrow["product_id"])
            ncid = str(vrow["color_id"]) if vrow["color_id"] else None
            nsid = str(vrow["size_id"]) if vrow["size_id"] else None
            eff_qty = qty_bind if qty_bind is not None else int(cur_row["quantity"])
            target_shipped = (
                str(patch["shipment_status"]).strip().lower()
                if "shipment_status" in patch and patch["shipment_status"] is not None
                else cur_ss
            )
            if target_shipped == SHIPMENT_STATUS_SHIPPED:
                head = _stock_headroom(npid, ncid, nsid, False, 0)
                if head < eff_qty:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Недостаточно остатка по новой позиции: доступно {head}, "
                            f"требуется {eff_qty}"
                        ),
                    )

            set_parts = [
                "product_id = ?",
                "color_id = ?",
                "size_id = ?",
                "variant_id = ?",
                "variant_sku = ?",
                "quantity = COALESCE(?, quantity)",
                "note = COALESCE(?, note)",
            ]
            exec_vals: list[object] = [
                npid,
                ncid,
                nsid,
                new_vid,
                str(vrow["sku"] or "").strip(),
                qty_bind,
                note_bind,
            ]
            if "shipment_date" in patch:
                set_parts.append("created_at = ?")
                exec_vals.append(
                    _created_at_for_shipment_date(
                        patch.get("shipment_date"), allow_future=allow_date_future
                    )
                )
            if "shipment_status" in patch and patch["shipment_status"] is not None:
                set_parts.append("shipment_status = ?")
                exec_vals.append(str(patch["shipment_status"]).strip().lower())
            exec_vals.append(sid)
            connection.execute(
                f"UPDATE inventory_operations SET {', '.join(set_parts)} WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
                exec_vals,
            )
        else:
            if "quantity" in patch and patch["quantity"] <= 0:
                raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")

            new_qty = int(patch["quantity"]) if "quantity" in patch else int(cur_row["quantity"])
            target_ss = (
                str(patch["shipment_status"]).strip().lower()
                if "shipment_status" in patch and patch["shipment_status"] is not None
                else cur_ss
            )

            if target_ss == SHIPMENT_STATUS_SHIPPED:
                pid = str(cur_row["product_id"])
                cid = str(cur_row["color_id"]) if cur_row["color_id"] else None
                sid_sz = str(cur_row["size_id"]) if cur_row["size_id"] else None
                was_shipped = cur_ss == SHIPMENT_STATUS_SHIPPED
                old_q = int(cur_row["quantity"])
                room = _stock_headroom(pid, cid, sid_sz, was_shipped, old_q)
                if room < new_qty:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Недостаточно остатка для отгрузки: доступно "
                            f"{room}, требуется {new_qty}"
                        ),
                    )

            sets: list[str] = []
            vals: list[object] = []
            if "quantity" in patch:
                sets.append("quantity = ?")
                vals.append(int(patch["quantity"]))
            if "comment" in patch:
                sets.append("note = ?")
                vals.append((patch["comment"] or "").strip() or None)
            if "shipment_date" in patch:
                sets.append("created_at = ?")
                vals.append(
                    _created_at_for_shipment_date(
                        patch.get("shipment_date"), allow_future=allow_date_future
                    )
                )
            if "shipment_status" in patch and patch["shipment_status"] is not None:
                sets.append("shipment_status = ?")
                vals.append(str(patch["shipment_status"]).strip().lower())
            if not sets:
                raise HTTPException(status_code=400, detail="Нет данных для обновления")
            vals.append(sid)
            connection.execute(
                f"UPDATE inventory_operations SET {', '.join(sets)} WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
                vals,
            )
        connection.commit()
    return MessageResponse(message="Сохранено")


@app.get("/receipts/{receipt_id}", response_model=ReceiptDetailResponse)
def get_receipt(
    receipt_id: str,
    user=Depends(get_current_manager),
):
    _ = user
    with get_connection() as connection:
        return _receipt_detail_from_connection(connection, receipt_id.strip())


@app.patch("/receipts/{receipt_id}", response_model=MessageResponse)
def patch_receipt(
    receipt_id: str,
    payload: ReceiptPatch,
    user=Depends(get_current_manager),
):
    _ = user
    rid = receipt_id.strip()
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Нет данных для обновления")

    change_variant = bool(
        "variant_id" in patch and (patch.get("variant_id") or "").strip()
    )

    with get_connection() as connection:
        cur_row = connection.execute(
            """
            SELECT id, op_type, product_id, color_id, size_id, quantity, created_at,
                   COALESCE(receipt_status, ?) AS receipt_status
            FROM inventory_operations WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (RECEIPT_STATUS_ACCEPTED, rid),
        ).fetchone()
        if not cur_row or str(cur_row["op_type"]) != "in":
            raise HTTPException(status_code=404, detail="Поступление не найдено")

        cur_rs = str(cur_row["receipt_status"])
        if "receipt_status" in patch and patch["receipt_status"] is not None:
            eff_rs = str(patch["receipt_status"]).strip().lower()
        else:
            eff_rs = cur_rs
        allow_date_future = eff_rs == RECEIPT_STATUS_PENDING

        if "receipt_status" in patch and patch["receipt_status"] is not None:
            new_rs = str(patch["receipt_status"]).strip().lower()
            if new_rs not in (RECEIPT_STATUS_PENDING, RECEIPT_STATUS_ACCEPTED):
                raise HTTPException(
                    status_code=400,
                    detail=f"receipt_status: допустимо {RECEIPT_STATUS_PENDING} | {RECEIPT_STATUS_ACCEPTED}",
                )
            old_rs = str(cur_row["receipt_status"])
            if old_rs == RECEIPT_STATUS_ACCEPTED and new_rs == RECEIPT_STATUS_PENDING:
                pid = str(cur_row["product_id"])
                cid = str(cur_row["color_id"]) if cur_row["color_id"] else None
                sid = str(cur_row["size_id"]) if cur_row["size_id"] else None
                q_eff = int(patch["quantity"]) if "quantity" in patch else int(cur_row["quantity"])
                bal = _balance_qty(connection, pid, cid, sid)
                if bal < q_eff:
                    raise HTTPException(
                        status_code=400,
                        detail="Нельзя вернуть в ожидание: недостаточно остатка на складе по этой позиции",
                    )

        if (
            "receipt_status" in patch
            and patch["receipt_status"] is not None
            and str(patch["receipt_status"]).strip().lower() == RECEIPT_STATUS_ACCEPTED
            and "receipt_date" not in patch
        ):
            _assert_receipt_posting_day_not_after_today(cur_row["created_at"])

        if change_variant:
            new_vid = str(patch["variant_id"]).strip()
            vrow = connection.execute(
                """
                SELECT v.id, v.sku, v.product_id, v.color_id, v.size_id,
                       COALESCE(v.is_deleted,0) AS vdel, COALESCE(p.is_deleted,0) AS pdel,
                       COALESCE(v.is_active,1) AS vact, COALESCE(p.is_active,1) AS pact
                FROM product_variants v
                JOIN products p ON p.id = v.product_id
                WHERE v.id = ?
                """,
                (new_vid,),
            ).fetchone()
            if not vrow or vrow["vdel"] or vrow["pdel"] or not vrow["vact"] or not vrow["pact"]:
                raise HTTPException(status_code=400, detail="Вариант не найден")
            qty_bind = int(patch["quantity"]) if "quantity" in patch else None
            if qty_bind is not None and qty_bind <= 0:
                raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
            note_bind = (
                (patch["comment"] or "").strip() or None if "comment" in patch else None
            )
            set_parts = [
                "product_id = ?",
                "color_id = ?",
                "size_id = ?",
                "variant_id = ?",
                "variant_sku = ?",
                "quantity = COALESCE(?, quantity)",
                "note = COALESCE(?, note)",
            ]
            exec_vals: list[object] = [
                str(vrow["product_id"]),
                str(vrow["color_id"]) if vrow["color_id"] else None,
                str(vrow["size_id"]) if vrow["size_id"] else None,
                new_vid,
                str(vrow["sku"] or "").strip(),
                qty_bind,
                note_bind,
            ]
            if "receipt_date" in patch:
                set_parts.append("created_at = ?")
                exec_vals.append(
                    _created_at_for_receipt_date(
                        patch.get("receipt_date"), allow_future=allow_date_future
                    )
                )
            if "receipt_status" in patch and patch["receipt_status"] is not None:
                set_parts.append("receipt_status = ?")
                exec_vals.append(str(patch["receipt_status"]).strip().lower())
            exec_vals.append(rid)
            connection.execute(
                f"UPDATE inventory_operations SET {', '.join(set_parts)} WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
                exec_vals,
            )
        else:
            if "quantity" in patch and patch["quantity"] <= 0:
                raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
            sets: list[str] = []
            vals: list[object] = []
            if "quantity" in patch:
                sets.append("quantity = ?")
                vals.append(int(patch["quantity"]))
            if "comment" in patch:
                sets.append("note = ?")
                vals.append((patch["comment"] or "").strip() or None)
            if "receipt_date" in patch:
                sets.append("created_at = ?")
                vals.append(
                    _created_at_for_receipt_date(
                        patch.get("receipt_date"), allow_future=allow_date_future
                    )
                )
            if "receipt_status" in patch and patch["receipt_status"] is not None:
                sets.append("receipt_status = ?")
                vals.append(str(patch["receipt_status"]).strip().lower())
            if not sets:
                raise HTTPException(status_code=400, detail="Нет данных для обновления")
            vals.append(rid)
            connection.execute(
                f"UPDATE inventory_operations SET {', '.join(sets)} WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
                vals,
            )
        connection.commit()
    return MessageResponse(message="Сохранено")


@app.delete("/receipts/{receipt_id}", response_model=MessageResponse)
def delete_receipt(receipt_id: str, admin=Depends(get_current_admin)):
    """Мягкое удаление записи поступления (только администратор)."""
    rid = receipt_id.strip()
    if not rid:
        raise HTTPException(status_code=400, detail="Укажите поступление")

    with get_connection() as connection:
        cur = connection.execute(
            """
            SELECT id, op_type, product_id, color_id, size_id, quantity,
                   COALESCE(receipt_status, ?) AS receipt_status
            FROM inventory_operations WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (RECEIPT_STATUS_ACCEPTED, rid),
        ).fetchone()
        if not cur or str(cur["op_type"]) != "in":
            raise HTTPException(status_code=404, detail="Поступление не найдено")
        rs = str(cur["receipt_status"])
        if rs == RECEIPT_STATUS_ACCEPTED:
            pid = str(cur["product_id"])
            cid = str(cur["color_id"]) if cur["color_id"] else None
            sid = str(cur["size_id"]) if cur["size_id"] else None
            q = int(cur["quantity"])
            bal = _balance_qty(connection, pid, cid, sid)
            if bal < q:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Нельзя удалить принятое поступление: по этой позиции есть отгрузки, "
                        "остаток стал бы отрицательным"
                    ),
                )
        ts = _now()
        connection.execute(
            """
            UPDATE inventory_operations
            SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?
            WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (ts, admin["id"], rid),
        )
        connection.commit()
    return MessageResponse(message="Удалено")


@app.delete("/shipments/{shipment_id}", response_model=MessageResponse)
def delete_shipment(shipment_id: str, admin=Depends(get_current_admin)):
    """Мягкое удаление записи отгрузки (только администратор)."""
    sid = shipment_id.strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Укажите отгрузку")

    with get_connection() as connection:
        cur = connection.execute(
            "SELECT id, op_type FROM inventory_operations WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        if not cur or str(cur["op_type"]) != "out":
            raise HTTPException(status_code=404, detail="Отгрузка не найдена")
        ts = _now()
        connection.execute(
            """
            UPDATE inventory_operations
            SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?
            WHERE id = ? AND COALESCE(is_deleted, 0) = 0
            """,
            (ts, admin["id"], sid),
        )
        connection.commit()
    return MessageResponse(message="Удалено")


@app.get("/inventory/balances", response_model=InventoryBalanceListResponse)
def list_inventory_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    client_id: str | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    supplier_id: str | None = Query(None),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    sku: str | None = Query(None, description="Подстрока по базовому штрих-коду (products.sku)"),
    name: str | None = Query(None, description="Подстрока по названию товара"),
    only_positive: bool = Query(True, description="Скрывать нулевые/отрицательные остатки"),
    sort: str | None = Query(None),
    user=Depends(get_current_manager),
):
    _ = user
    offset = (page - 1) * limit
    conds = ["1=1", SQL_WHERE_INV_OP_ACTIVE_O]
    params: list[object] = []
    if client_id is not None and str(client_id).strip():
        conds.append("p.client_id = ?")
        params.append(str(client_id).strip())
    if product_id is not None and str(product_id).strip():
        conds.append("o.product_id = ?")
        params.append(str(product_id).strip())
    if type_id is not None and str(type_id).strip():
        conds.append("p.type_id = ?")
        params.append(str(type_id).strip())
    if supplier_id is not None and str(supplier_id).strip():
        conds.append("p.supplier_id = ?")
        params.append(str(supplier_id).strip())
    if color_id is not None and str(color_id).strip():
        conds.append("COALESCE(o.color_id, '') = ?")
        params.append(str(color_id).strip())
    if size_id is not None and str(size_id).strip():
        conds.append("COALESCE(o.size_id, '') = ?")
        params.append(str(size_id).strip())
    if sku is not None and str(sku).strip():
        conds.append("fold_ci(COALESCE(p.sku, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(sku)))
    if name is not None and str(name).strip():
        conds.append("fold_ci(COALESCE(p.name, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(name)))
    where_sql = " AND ".join(conds)
    having_sql = f"HAVING SUM({SQL_O_NET_QTY}) > 0" if only_positive else ""
    base_sql = f"""
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        LEFT JOIN colors col ON col.id = o.color_id
        LEFT JOIN sizes sz ON sz.id = o.size_id
        WHERE {where_sql}
        GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
        {having_sql}
    """
    balances_order_sql = (
        _order_sql_from_sort_param(sort, INVENTORY_BALANCES_SORT_COLUMNS)
        or "LOWER(MAX(p.name)) ASC, MAX(col.name) ASC, MAX(sz.name) ASC"
    )
    with get_connection() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt FROM (SELECT 1 {base_sql})",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.sku) AS product_sku,
                MAX(p.name) AS product_name,
                MAX(p.gallery_json) AS gallery_json,
                MAX(p.image_url) AS image_url,
                MAX(p.type_id) AS product_type_id,
                MAX(pt.name) AS product_type_name,
                MAX(p.client_id) AS client_id,
                MAX(cl.name) AS client_name,
                MAX(p.supplier_id) AS supplier_id,
                MAX(sp.name) AS supplier_name,
                MAX(o.color_id) AS color_id,
                MAX(col.name) AS color_name,
                MAX(o.size_id) AS size_id,
                MAX(sz.name) AS size_name,
                SUM({SQL_O_NET_QTY}) AS quantity
            {base_sql}
            ORDER BY {balances_order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return InventoryBalanceListResponse(
        items=[_inventory_balance_item_from_row(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


# ============================================================================
# Analytics: отчёты по операциям и остаткам.
# Доступ — только администратор (ТЗ «Аналитика админа»). Период по умолчанию — последние 30 дней.
# Все эндпоинты возвращают {report, chart, explanation, period, filters, data}.
# ============================================================================


ANALYTICS_GROUPS = ("day", "week", "month")


class AnalyticsPeriod(BaseModel):
    date_from: str
    date_to: str


class AnalyticsFilters(BaseModel):
    client_ids: list[str] = Field(default_factory=list)
    product_id: str | None = None
    type_id: str | None = None


def _normalize_analytics_client_ids(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in values or []:
        s = str(x).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


class MovementBucket(BaseModel):
    period: str
    inflow: int
    outflow: int


class MovementReport(BaseModel):
    report: str = "movement"
    chart: str = "line"
    explanation: str
    group: str
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    data: list[MovementBucket]


class StockSnapshotItem(BaseModel):
    product_id: str
    product: str
    type_id: str | None
    type_name: str | None
    client_id: str | None
    client: str | None
    color_id: str | None
    color: str | None
    size_id: str | None
    size: str | None
    stock: int


class StockSnapshotReport(BaseModel):
    report: str = "stock_snapshot"
    chart: str = "table"
    explanation: str
    at_date: str
    filters: AnalyticsFilters
    data: list[StockSnapshotItem]


class TopProductItem(BaseModel):
    product_id: str
    product: str
    type_name: str | None
    total_outflow: int


class TopProductsReport(BaseModel):
    report: str = "top_products"
    chart: str = "bar"
    explanation: str
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    limit: int
    data: list[TopProductItem]


class DeadStockItem(BaseModel):
    product_id: str
    product: str
    client_id: str | None
    client: str | None
    color_id: str | None
    color: str | None
    size_id: str | None
    size: str | None
    stock: int
    last_movement_at: str | None
    days_without_movement: int


class DeadStockReport(BaseModel):
    report: str = "dead_stock"
    chart: str = "table"
    explanation: str
    days_threshold: int
    filters: AnalyticsFilters
    data: list[DeadStockItem]


class ClientActivityItem(BaseModel):
    client_id: str
    client: str
    total_outflow: int
    operations: int


class ClientActivityReport(BaseModel):
    report: str = "client_activity"
    chart: str = "bar"
    explanation: str
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    data: list[ClientActivityItem]


class BalanceReport(BaseModel):
    report: str = "balance"
    chart: str = "bar"
    explanation: str
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    inflow: int
    outflow: int
    delta: int
    prev_inflow: int
    prev_outflow: int
    prev_delta: int
    inflow_change_pct: float | None
    outflow_change_pct: float | None
    delta_trend: str  # 'up' | 'down' | 'flat'


class ByTypeItem(BaseModel):
    type_id: str | None
    type_name: str
    stock: int
    outflow: int
    inflow: int


class ByTypeReport(BaseModel):
    report: str = "by_type"
    chart: str = "bar"
    explanation: str
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    data: list[ByTypeItem]


class AdminDashboardStockByClient(BaseModel):
    client_id: str
    client: str
    stock: int


class AdminDashboardClientMovement(BaseModel):
    client_id: str
    client: str
    inflow: int
    outflow: int


class AdminDashboardReport(BaseModel):
    report: str = "admin_dashboard"
    period: AnalyticsPeriod
    filters: AnalyticsFilters
    at_date: str
    total_inflow: int
    total_outflow: int
    stock_total: int
    active_clients: int
    movement_clients_limit: int
    stock_by_client: list[AdminDashboardStockByClient]
    client_movement: list[AdminDashboardClientMovement]
    explanation: str


def _default_period(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    """Если период не задан — последние 30 дней (включительно)."""
    today = datetime.now(UTC).date()
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    if not dt:
        dt = today.isoformat()
    if not df:
        df_date = today - timedelta(days=29)
        df = df_date.isoformat()
    if df > dt:
        df, dt = dt, df
    return df, dt


def _ana_filter_sql(
    *,
    client_ids: list[str] | None = None,
    product_id: str | None = None,
    type_id: str | None = None,
) -> tuple[list[str], list[object]]:
    conds: list[str] = []
    params: list[object] = []
    ids = _normalize_analytics_client_ids(client_ids)
    pid = (product_id or "").strip()
    tid = (type_id or "").strip()
    if len(ids) == 1:
        conds.append("p.client_id = ?")
        params.append(ids[0])
    elif len(ids) > 1:
        placeholders = ",".join("?" * len(ids))
        conds.append(f"p.client_id IN ({placeholders})")
        params.extend(ids)
    if pid:
        conds.append("o.product_id = ?")
        params.append(pid)
    if tid:
        conds.append("p.type_id = ?")
        params.append(tid)
    conds.append(SQL_WHERE_INV_OP_ACTIVE_O)
    return conds, params


def _group_expr(group: str) -> str:
    """SQL-выражение для бакета периода по дате создания операции (PostgreSQL, created_at — ISO-текст)."""
    g = (group or "day").lower()
    if g == "week":
        return (
            "to_char(o.created_at::timestamptz, 'IYYY') || '-W' || "
            "to_char(o.created_at::timestamptz, 'IW')"
        )
    if g == "month":
        return "substring(o.created_at from 1 for 7)"
    return "substring(o.created_at from 1 for 10)"


def _explain_period(date_from: str, date_to: str) -> str:
    return f"Период: {date_from} … {date_to}"


@app.get("/analytics/movement", response_model=MovementReport)
def analytics_movement(
    group: str = Query("day", description="day | week | month"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_ids: list[str] | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    user=Depends(get_current_admin),
):
    _ = user
    g = (group or "day").lower()
    if g not in ANALYTICS_GROUPS:
        raise HTTPException(status_code=400, detail="group: допустимо day | week | month")
    df, dt = _default_period(date_from, date_to)
    cids = _normalize_analytics_client_ids(client_ids)
    conds, params = _ana_filter_sql(
        client_ids=cids or None, product_id=product_id, type_id=type_id
    )
    conds.extend(
        [
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds) if conds else "1=1"
    bucket_expr = _group_expr(g)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                {bucket_expr} AS bucket,
                SUM({SQL_O_INFLOW_QTY}) AS inflow,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            WHERE {where_sql}
            GROUP BY bucket
            ORDER BY bucket ASC
            """,
            params,
        ).fetchall()
    data = [
        MovementBucket(
            period=r["bucket"],
            inflow=int(r["inflow"] or 0),
            outflow=int(r["outflow"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Движение товаров по {g}. {_explain_period(df, dt)}. "
        f"Бакетов: {len(data)}."
    )
    return MovementReport(
        explanation=explanation,
        group=g,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(
            client_ids=cids, product_id=product_id, type_id=type_id
        ),
        data=data,
    )


@app.get("/analytics/stock-snapshot", response_model=StockSnapshotReport)
def analytics_stock_snapshot(
    at_date: str | None = Query(None, description="YYYY-MM-DD; по умолчанию сегодня"),
    client_ids: list[str] | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    only_positive: bool = Query(True),
    limit: int = Query(500, ge=1, le=5000),
    user=Depends(get_current_admin),
):
    _ = user
    at = _normalize_date_yyyy_mm_dd(at_date, "at_date")
    if not at:
        at = datetime.now(UTC).date().isoformat()
    cids = _normalize_analytics_client_ids(client_ids)
    conds, params = _ana_filter_sql(
        client_ids=cids or None, product_id=product_id, type_id=type_id
    )
    conds.append("substr(o.created_at, 1, 10) <= ?")
    params.append(at)
    where_sql = " AND ".join(conds)
    having_sql = f"HAVING SUM({SQL_O_NET_QTY}) > 0" if only_positive else ""
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.name) AS product,
                MAX(p.type_id) AS type_id,
                MAX(pt.name) AS type_name,
                MAX(p.client_id) AS client_id,
                MAX(cl.name) AS client,
                MAX(o.color_id) AS color_id,
                MAX(col.name) AS color,
                MAX(o.size_id) AS size_id,
                MAX(sz.name) AS size,
                SUM({SQL_O_NET_QTY}) AS stock
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            LEFT JOIN colors col ON col.id = o.color_id
            LEFT JOIN sizes sz ON sz.id = o.size_id
            WHERE {where_sql}
            GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
            {having_sql}
            ORDER BY stock DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()
    data = [
        StockSnapshotItem(
            product_id=r["product_id"],
            product=r["product"] or "",
            type_id=r["type_id"],
            type_name=r["type_name"],
            client_id=r["client_id"],
            client=r["client"],
            color_id=r["color_id"],
            color=r["color"],
            size_id=r["size_id"],
            size=r["size"],
            stock=int(r["stock"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Срез остатков на {at}. Записей: {len(data)}."
        + (" Только > 0." if only_positive else "")
    )
    return StockSnapshotReport(
        explanation=explanation,
        at_date=at,
        filters=AnalyticsFilters(
            client_ids=cids, product_id=product_id, type_id=type_id
        ),
        data=data,
    )


@app.get("/analytics/top-products", response_model=TopProductsReport)
def analytics_top_products(
    limit: int = Query(10, ge=1, le=100),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_ids: list[str] | None = Query(None),
    type_id: str | None = Query(None),
    user=Depends(get_current_admin),
):
    _ = user
    df, dt = _default_period(date_from, date_to)
    cids = _normalize_analytics_client_ids(client_ids)
    conds, params = _ana_filter_sql(
        client_ids=cids or None, product_id=None, type_id=type_id
    )
    conds.extend(
        [
            "o.op_type = 'out'",
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.name) AS product,
                MAX(pt.name) AS type_name,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS total_outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN product_types pt ON pt.id = p.type_id
            WHERE {where_sql}
            GROUP BY o.product_id
            ORDER BY total_outflow DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()
    data = [
        TopProductItem(
            product_id=r["product_id"],
            product=r["product"] or "",
            type_name=r["type_name"],
            total_outflow=int(r["total_outflow"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Топ-{limit} товаров по отгрузке. {_explain_period(df, dt)}. "
        f"Записей: {len(data)}."
    )
    return TopProductsReport(
        explanation=explanation,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(client_ids=cids, product_id=None, type_id=type_id),
        limit=limit,
        data=data,
    )


@app.get("/analytics/dead-stock", response_model=DeadStockReport)
def analytics_dead_stock(
    days: int = Query(30, ge=1, le=3650),
    client_ids: list[str] | None = Query(None),
    type_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=5000),
    user=Depends(get_current_admin),
):
    _ = user
    today = datetime.now(UTC).date()
    cutoff = (today - timedelta(days=days)).isoformat()
    today_iso = today.isoformat()
    cids = _normalize_analytics_client_ids(client_ids)
    conds, params = _ana_filter_sql(
        client_ids=cids or None, product_id=None, type_id=type_id
    )
    where_sql = " AND ".join(conds) if conds else "1=1"
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.name) AS product,
                MAX(p.client_id) AS client_id,
                MAX(cl.name) AS client,
                MAX(o.color_id) AS color_id,
                MAX(col.name) AS color,
                MAX(o.size_id) AS size_id,
                MAX(sz.name) AS size,
                SUM({SQL_O_NET_QTY}) AS stock,
                MAX(o.created_at) AS last_movement_at
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            LEFT JOIN colors col ON col.id = o.color_id
            LEFT JOIN sizes sz ON sz.id = o.size_id
            WHERE {where_sql}
            GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
            HAVING SUM({SQL_O_NET_QTY}) > 0 AND substr(MAX(o.created_at), 1, 10) <= ?
            ORDER BY stock DESC
            LIMIT ?
            """,
            [*params, cutoff, limit],
        ).fetchall()
    data: list[DeadStockItem] = []
    for r in rows:
        last_iso = r["last_movement_at"] or ""
        days_without = 0
        if last_iso:
            try:
                last_date = datetime.fromisoformat(last_iso).date()
                days_without = (today - last_date).days
            except ValueError:
                days_without = days
        data.append(
            DeadStockItem(
                product_id=r["product_id"],
                product=r["product"] or "",
                client_id=r["client_id"],
                client=r["client"],
                color_id=r["color_id"],
                color=r["color"],
                size_id=r["size_id"],
                size=r["size"],
                stock=int(r["stock"] or 0),
                last_movement_at=last_iso or None,
                days_without_movement=days_without,
            )
        )
    explanation = (
        f"Мёртвые остатки: без движения ≥ {days} дней (на {today_iso}). "
        f"Найдено позиций: {len(data)}."
    )
    return DeadStockReport(
        explanation=explanation,
        days_threshold=days,
        filters=AnalyticsFilters(client_ids=cids, product_id=None, type_id=type_id),
        data=data,
    )


@app.get("/analytics/client-activity", response_model=ClientActivityReport)
def analytics_client_activity(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    type_id: str | None = Query(None),
    product_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=200),
    user=Depends(get_current_admin),
):
    _ = user
    df, dt = _default_period(date_from, date_to)
    conds, params = _ana_filter_sql(
        client_ids=None, product_id=product_id, type_id=type_id
    )
    conds.extend(
        [
            "o.op_type = 'out'",
            "p.client_id IS NOT NULL",
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                p.client_id,
                MAX(cl.name) AS client,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS total_outflow,
                SUM(CASE WHEN COALESCE(o.shipment_status, 'shipped') = '{SHIPMENT_STATUS_SHIPPED}' THEN 1 ELSE 0 END) AS operations
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            WHERE {where_sql}
            GROUP BY p.client_id
            ORDER BY total_outflow DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()
    data = [
        ClientActivityItem(
            client_id=r["client_id"],
            client=r["client"] or "",
            total_outflow=int(r["total_outflow"] or 0),
            operations=int(r["operations"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Активность клиентов по отгрузкам. {_explain_period(df, dt)}. "
        f"Клиентов в выборке: {len(data)}."
    )
    return ClientActivityReport(
        explanation=explanation,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(client_ids=[], product_id=product_id, type_id=type_id),
        data=data,
    )


def _sum_in_out_for_range(
    connection: Any,
    *,
    df: str,
    dt: str,
    client_ids: list[str] | None,
    product_id: str | None,
    type_id: str | None,
) -> tuple[int, int]:
    conds, params = _ana_filter_sql(
        client_ids=client_ids, product_id=product_id, type_id=type_id
    )
    conds.extend(
        [
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds)
    row = connection.execute(
        f"""
        SELECT
            COALESCE(SUM({SQL_O_INFLOW_QTY}), 0) AS inflow,
            COALESCE(SUM({SQL_O_SHIPPED_OUT_QTY}), 0) AS outflow
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()
    return int(row["inflow"]), int(row["outflow"])


def _change_pct(current: int, previous: int) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) * 100.0 / previous, 2)


@app.get("/analytics/balance", response_model=BalanceReport)
def analytics_balance(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_ids: list[str] | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    user=Depends(get_current_admin),
):
    _ = user
    df, dt = _default_period(date_from, date_to)
    cids = _normalize_analytics_client_ids(client_ids)
    cid_param = cids or None
    df_d = datetime.fromisoformat(df).date()
    dt_d = datetime.fromisoformat(dt).date()
    span = (dt_d - df_d).days + 1
    prev_dt = (df_d - timedelta(days=1)).isoformat()
    prev_df = (df_d - timedelta(days=span)).isoformat()
    with get_connection() as connection:
        cur_in, cur_out = _sum_in_out_for_range(
            connection,
            df=df,
            dt=dt,
            client_ids=cid_param,
            product_id=product_id,
            type_id=type_id,
        )
        prev_in, prev_out = _sum_in_out_for_range(
            connection,
            df=prev_df,
            dt=prev_dt,
            client_ids=cid_param,
            product_id=product_id,
            type_id=type_id,
        )
    delta = cur_in - cur_out
    prev_delta = prev_in - prev_out
    if delta > prev_delta:
        trend = "up"
    elif delta < prev_delta:
        trend = "down"
    else:
        trend = "flat"
    explanation = (
        f"Баланс за {df}…{dt}: приход {cur_in}, расход {cur_out}, дельта {delta}. "
        f"Сравнение с {prev_df}…{prev_dt}."
    )
    return BalanceReport(
        explanation=explanation,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(
            client_ids=cids, product_id=product_id, type_id=type_id
        ),
        outflow=cur_out,
        delta=delta,
        prev_inflow=prev_in,
        prev_outflow=prev_out,
        prev_delta=prev_delta,
        inflow_change_pct=_change_pct(cur_in, prev_in),
        outflow_change_pct=_change_pct(cur_out, prev_out),
        delta_trend=trend,
    )


@app.get("/analytics/by-type", response_model=ByTypeReport)
def analytics_by_type(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_ids: list[str] | None = Query(None),
    user=Depends(get_current_admin),
):
    _ = user
    df, dt = _default_period(date_from, date_to)
    cids = _normalize_analytics_client_ids(client_ids)
    cid_param = cids or None
    # 1) inflow / outflow в периоде по типу
    conds, params = _ana_filter_sql(
        client_ids=cid_param, product_id=None, type_id=None
    )
    conds.extend(
        [
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds) if conds else "1=1"
    with get_connection() as connection:
        movement_rows = connection.execute(
            f"""
            SELECT
                p.type_id AS type_id,
                MAX(pt.name) AS type_name,
                SUM({SQL_O_INFLOW_QTY}) AS inflow,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN product_types pt ON pt.id = p.type_id
            WHERE {where_sql}
            GROUP BY p.type_id
            """,
            params,
        ).fetchall()
        # 2) текущий остаток по типу (на сегодня, без учёта периода — это снапшот)
        stock_conds, stock_params = _ana_filter_sql(
            client_ids=cid_param, product_id=None, type_id=None
        )
        stock_where = " AND ".join(stock_conds) if stock_conds else "1=1"
        stock_rows = connection.execute(
            f"""
            SELECT
                type_id, type_name,
                SUM(stock) AS stock
            FROM (
                SELECT
                    p.type_id AS type_id,
                    MAX(pt.name) AS type_name,
                    SUM({SQL_O_NET_QTY}) AS stock
                FROM inventory_operations o
                LEFT JOIN products p ON p.id = o.product_id
                LEFT JOIN product_types pt ON pt.id = p.type_id
                WHERE {stock_where}
                GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
            )
            WHERE stock > 0
            GROUP BY type_id, type_name
            """,
            stock_params,
        ).fetchall()

    stock_by_type = {row["type_id"]: int(row["stock"] or 0) for row in stock_rows}
    name_by_type = {row["type_id"]: (row["type_name"] or "") for row in stock_rows}

    seen: set[str | None] = set()
    items: list[ByTypeItem] = []
    for row in movement_rows:
        tid = row["type_id"]
        seen.add(tid)
        items.append(
            ByTypeItem(
                type_id=tid,
                type_name=row["type_name"] or name_by_type.get(tid) or "—",
                stock=stock_by_type.get(tid, 0),
                outflow=int(row["outflow"] or 0),
                inflow=int(row["inflow"] or 0),
            )
        )
    # Типы, у которых есть остаток, но не было движения в периоде.
    for tid, stock in stock_by_type.items():
        if tid in seen:
            continue
        items.append(
            ByTypeItem(
                type_id=tid,
                type_name=name_by_type.get(tid) or "—",
                stock=stock,
                outflow=0,
                inflow=0,
            )
        )
    items.sort(key=lambda x: (-x.outflow, -x.stock, x.type_name))
    explanation = (
        f"Разрез по типам товаров. {_explain_period(df, dt)}. "
        f"Типов в выборке: {len(items)}."
    )
    return ByTypeReport(
        explanation=explanation,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(client_ids=cids, product_id=None, type_id=None),
        data=items,
    )


@app.get("/analytics/admin-dashboard", response_model=AdminDashboardReport)
def analytics_admin_dashboard(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client_ids: list[str] | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    movement_clients_limit: int = Query(12, ge=5, le=40),
    admin=Depends(get_current_admin),
):
    _ = admin
    df, dt = _default_period(date_from, date_to)
    cids = _normalize_analytics_client_ids(client_ids)
    cid_param = cids or None
    conds_stock, params_stock = _ana_filter_sql(
        client_ids=cid_param, product_id=product_id, type_id=type_id
    )
    conds_stock.append("substr(o.created_at, 1, 10) <= ?")
    params_stock.append(dt)
    where_stock = " AND ".join(conds_stock)

    conds_mv, params_mv = _ana_filter_sql(
        client_ids=cid_param, product_id=product_id, type_id=type_id
    )
    conds_mv.extend(
        [
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params_mv.extend([df, dt])
    where_mv = " AND ".join(conds_mv)

    with get_connection() as connection:
        total_in, total_out = _sum_in_out_for_range(
            connection,
            df=df,
            dt=dt,
            client_ids=cid_param,
            product_id=product_id,
            type_id=type_id,
        )

        row_tot = connection.execute(
            f"""
            SELECT COALESCE(SUM(b.qty), 0) AS total
            FROM (
                SELECT SUM({SQL_O_NET_QTY}) AS qty
                FROM inventory_operations o
                LEFT JOIN products p ON p.id = o.product_id
                WHERE {where_stock}
                GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
                HAVING SUM({SQL_O_NET_QTY}) > 0
            ) AS b
            """,
            params_stock,
        ).fetchone()
        stock_total = int(row_tot["total"] or 0)

        row_ac = connection.execute(
            """
            SELECT COUNT(*) AS n
            FROM clients
            WHERE COALESCE(is_deleted, 0) = 0 AND COALESCE(is_active, 0) = 1
            """
        ).fetchone()
        active_clients = int(row_ac["n"] or 0)

        rows_sc = connection.execute(
            f"""
            SELECT pr.client_id AS client_id,
                   MAX(cl.name) AS client,
                   SUM(v.stock) AS stock
            FROM (
                SELECT o.product_id AS product_id,
                       COALESCE(o.color_id, '') AS color_id,
                       COALESCE(o.size_id, '') AS size_id,
                       SUM({SQL_O_NET_QTY}) AS stock
                FROM inventory_operations o
                LEFT JOIN products p ON p.id = o.product_id
                WHERE {where_stock}
                GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
                HAVING SUM({SQL_O_NET_QTY}) > 0
            ) v
            INNER JOIN products pr ON pr.id = v.product_id
            LEFT JOIN clients cl ON cl.id = pr.client_id
            WHERE pr.client_id IS NOT NULL
            GROUP BY pr.client_id
            ORDER BY stock DESC
            LIMIT ?
            """,
            [*params_stock, 15],
        ).fetchall()

        rows_cm = connection.execute(
            f"""
            SELECT p.client_id AS client_id,
                   MAX(cl.name) AS client,
                   COALESCE(SUM({SQL_O_INFLOW_QTY}), 0) AS inflow,
                   COALESCE(SUM({SQL_O_SHIPPED_OUT_QTY}), 0) AS outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            WHERE {where_mv}
              AND p.client_id IS NOT NULL
            GROUP BY p.client_id
            ORDER BY COALESCE(SUM({SQL_O_INFLOW_QTY}), 0)
                + COALESCE(SUM({SQL_O_SHIPPED_OUT_QTY}), 0) DESC
            LIMIT ?
            """,
            [*params_mv, movement_clients_limit],
        ).fetchall()

    stock_by_client = [
        AdminDashboardStockByClient(
            client_id=str(r["client_id"]),
            client=r["client"] or "",
            stock=int(r["stock"] or 0),
        )
        for r in rows_sc
    ]
    client_movement = [
        AdminDashboardClientMovement(
            client_id=str(r["client_id"]),
            client=r["client"] or "",
            inflow=int(r["inflow"] or 0),
            outflow=int(r["outflow"] or 0),
        )
        for r in rows_cm
    ]
    explanation = (
        f"Сводка админ-дашборда. {_explain_period(df, dt)}. Остатки на дату {dt}."
    )
    return AdminDashboardReport(
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(
            client_ids=cids,
            product_id=product_id,
            type_id=type_id,
        ),
        at_date=dt,
        total_inflow=total_in,
        total_outflow=total_out,
        stock_total=stock_total,
        active_clients=active_clients,
        movement_clients_limit=movement_clients_limit,
        stock_by_client=stock_by_client,
        client_movement=client_movement,
        explanation=explanation,
    )


# ============================================================================
# Личный кабинет клиента: данные только по users.client_id (не из query).
# ============================================================================


class ClientPortalDashboardMetrics(BaseModel):
    total_stock: int
    period_inflow: int
    period_outflow: int
    period: AnalyticsPeriod


def _portal_bound_client_id(user) -> str:
    return _user_client_id_opt(user) or ""


def _client_portal_total_positive_stock(connection: Any, client_id: str) -> int:
    row = connection.execute(
        f"""
        SELECT COALESCE(SUM(b.qty), 0) AS total
        FROM (
            SELECT SUM({SQL_O_NET_QTY}) AS qty
            FROM inventory_operations o
            INNER JOIN products p ON p.id = o.product_id
            WHERE p.client_id = ? AND {SQL_WHERE_INV_OP_ACTIVE_O}
            GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
            HAVING SUM({SQL_O_NET_QTY}) > 0
        ) AS b
        """,
        (client_id,),
    ).fetchone()
    return int(row["total"] or 0)


@app.get("/client-portal/balances", response_model=InventoryBalanceListResponse)
def client_portal_list_balances(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    sku: str | None = Query(None, description="Подстрока по базовому штрих-коду (products.sku)"),
    name: str | None = Query(None, description="Подстрока по названию товара"),
    search: str | None = Query(None, description="Устар.: используйте name"),
    only_positive: bool = Query(True, description="Скрывать нулевые/отрицательные остатки"),
    sort: str | None = Query(None),
    user=Depends(get_current_client_portal),
):
    portal_cid = _portal_bound_client_id(user)
    offset = (page - 1) * limit
    conds = ["p.client_id = ?", SQL_WHERE_INV_OP_ACTIVE_O]
    params: list[object] = [portal_cid]
    name_sub = (str(name).strip() if name is not None and str(name).strip() else None) or (
        str(search).strip() if search is not None and str(search).strip() else None
    )
    if name_sub:
        conds.append("fold_ci(COALESCE(p.name, '')) LIKE ?")
        params.append(_ci_substring_like_param(name_sub))
    if sku is not None and str(sku).strip():
        conds.append("fold_ci(COALESCE(p.sku, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(sku)))
    if product_id is not None and str(product_id).strip():
        conds.append("o.product_id = ?")
        params.append(str(product_id).strip())
    if type_id is not None and str(type_id).strip():
        conds.append("p.type_id = ?")
        params.append(str(type_id).strip())
    if color_id is not None and str(color_id).strip():
        conds.append("COALESCE(o.color_id, '') = ?")
        params.append(str(color_id).strip())
    if size_id is not None and str(size_id).strip():
        conds.append("COALESCE(o.size_id, '') = ?")
        params.append(str(size_id).strip())
    where_sql = " AND ".join(conds)
    having_sql = f"HAVING SUM({SQL_O_NET_QTY}) > 0" if only_positive else ""
    base_sql = f"""
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        LEFT JOIN colors col ON col.id = o.color_id
        LEFT JOIN sizes sz ON sz.id = o.size_id
        WHERE {where_sql}
        GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
        {having_sql}
    """
    balances_order_sql = (
        _order_sql_from_sort_param(sort, INVENTORY_BALANCES_SORT_COLUMNS)
        or "LOWER(MAX(p.name)) ASC, MAX(col.name) ASC, MAX(sz.name) ASC"
    )
    with get_connection() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt FROM (SELECT 1 {base_sql})",
                params,
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.sku) AS product_sku,
                MAX(p.name) AS product_name,
                MAX(p.gallery_json) AS gallery_json,
                MAX(p.image_url) AS image_url,
                MAX(p.type_id) AS product_type_id,
                MAX(pt.name) AS product_type_name,
                MAX(p.client_id) AS client_id,
                MAX(cl.name) AS client_name,
                MAX(p.supplier_id) AS supplier_id,
                MAX(sp.name) AS supplier_name,
                MAX(o.color_id) AS color_id,
                MAX(col.name) AS color_name,
                MAX(o.size_id) AS size_id,
                MAX(sz.name) AS size_name,
                SUM({SQL_O_NET_QTY}) AS quantity
            {base_sql}
            ORDER BY {balances_order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return InventoryBalanceListResponse(
        items=[_inventory_balance_item_from_row(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


@app.get("/client-portal/operations", response_model=InventoryOperationListResponse)
def client_portal_list_operations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    op_type: str | None = Query(None, description="'in' или 'out'"),
    product_id: str | None = Query(None),
    color_id: str | None = Query(None),
    size_id: str | None = Query(None),
    sku: str | None = Query(None, description="Подстрока по базовому штрих-коду товара"),
    name: str | None = Query(None, description="Подстрока по названию товара"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    search: str | None = Query(None, description="Устар.: используйте name"),
    receipt_status: str | None = Query(
        None,
        description=f"Только приход: '{RECEIPT_STATUS_PENDING}' | '{RECEIPT_STATUS_ACCEPTED}'",
    ),
    shipment_status: str | None = Query(
        None,
        description=f"Только расход: '{SHIPMENT_STATUS_PENDING}' | '{SHIPMENT_STATUS_SHIPPED}'",
    ),
    sort: str | None = Query(None),
    user=Depends(get_current_client_portal),
):
    portal_cid = _portal_bound_client_id(user)
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    offset = (page - 1) * limit
    conds = ["p.client_id = ?", SQL_WHERE_INV_OP_ACTIVE_O]
    params: list[object] = [portal_cid]
    name_sub = (str(name).strip() if name is not None and str(name).strip() else None) or (
        str(search).strip() if search is not None and str(search).strip() else None
    )
    if name_sub:
        conds.append("fold_ci(COALESCE(p.name, '')) LIKE ?")
        params.append(_ci_substring_like_param(name_sub))
    if sku is not None and str(sku).strip():
        conds.append("fold_ci(COALESCE(p.sku, '')) LIKE ?")
        params.append(_ci_substring_like_param(str(sku)))
    if op_type is not None and str(op_type).strip():
        v = str(op_type).strip()
        if v not in ("in", "out"):
            raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
        conds.append("o.op_type = ?")
        params.append(v)
    if product_id is not None and str(product_id).strip():
        conds.append("o.product_id = ?")
        params.append(str(product_id).strip())
    if color_id is not None and str(color_id).strip():
        conds.append("o.color_id = ?")
        params.append(str(color_id).strip())
    if size_id is not None and str(size_id).strip():
        conds.append("o.size_id = ?")
        params.append(str(size_id).strip())
    if df is not None:
        conds.append("substr(o.created_at, 1, 10) >= ?")
        params.append(df)
    if dt is not None:
        conds.append("substr(o.created_at, 1, 10) <= ?")
        params.append(dt)
    if receipt_status is not None and str(receipt_status).strip():
        rsq = str(receipt_status).strip().lower()
        if rsq not in (RECEIPT_STATUS_PENDING, RECEIPT_STATUS_ACCEPTED):
            raise HTTPException(
                status_code=400,
                detail=f"receipt_status: допустимо {RECEIPT_STATUS_PENDING} | {RECEIPT_STATUS_ACCEPTED}",
            )
        if op_type is None or str(op_type).strip() != "out":
            conds.append("COALESCE(o.receipt_status, 'accepted') = ?")
            params.append(rsq)
    if shipment_status is not None and str(shipment_status).strip():
        ssq = str(shipment_status).strip().lower()
        if ssq not in (SHIPMENT_STATUS_PENDING, SHIPMENT_STATUS_SHIPPED):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"shipment_status: допустимо {SHIPMENT_STATUS_PENDING} | "
                    f"{SHIPMENT_STATUS_SHIPPED}"
                ),
            )
        if op_type is None or str(op_type).strip() != "in":
            conds.append("COALESCE(o.shipment_status, 'shipped') = ?")
            params.append(ssq)
    where_sql = " AND ".join(conds)
    join_sql = """
        FROM inventory_operations o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        LEFT JOIN colors col ON col.id = o.color_id
        LEFT JOIN sizes sz ON sz.id = o.size_id
        LEFT JOIN users u ON u.id = o.created_by_id
    """
    order_sql = (
        _order_sql_from_sort_param(sort, INVENTORY_OPERATIONS_SORT_COLUMNS)
        or "o.created_at DESC"
    )
    with get_connection() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS cnt {join_sql} WHERE {where_sql}", params
            ).fetchone()["cnt"]
        )
        rows = connection.execute(
            f"""
            SELECT
                o.id, o.op_type, o.product_id, o.color_id, o.size_id, o.quantity,
                o.note, o.created_at, o.receipt_status, o.shipment_status,
                p.name AS product_name, p.client_id, p.type_id AS product_type_id,
                pt.name AS product_type_name,
                p.sku AS product_sku, p.gallery_json, p.image_url,
                p.supplier_id, sp.name AS supplier_name,
                cl.name AS client_name,
                col.name AS color_name,
                sz.name AS size_name,
                u.email AS created_by
            {join_sql}
            WHERE {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return InventoryOperationListResponse(
        items=[
            InventoryOperationItem(
                id=r["id"],
                op_type=r["op_type"],
                client_id=r["client_id"],
                client_name=r["client_name"],
                product_id=r["product_id"],
                product_name=r["product_name"] or "",
                product_type_id=r["product_type_id"],
                product_type_name=r["product_type_name"],
                supplier_id=r["supplier_id"],
                supplier_name=r["supplier_name"],
                color_id=r["color_id"],
                color_name=r["color_name"],
                size_id=r["size_id"],
                size_name=r["size_name"],
                variant_sku=None,
                product_sku=str(r["product_sku"] or "").strip() or None,
                preview_image_url=(
                    (lambda urls: urls[0] if urls else None)(
                        _product_card_image_urls(r["gallery_json"], r["image_url"])
                    )
                ),
                receipt_status=(
                    str(r["receipt_status"] or RECEIPT_STATUS_ACCEPTED)
                    if str(r["op_type"]) == "in"
                    else None
                ),
                shipment_status=(
                    str(r["shipment_status"] or SHIPMENT_STATUS_SHIPPED)
                    if str(r["op_type"]) == "out"
                    else None
                ),
                quantity=int(r["quantity"]),
                note=r["note"],
                created_at=r["created_at"],
                created_by=r["created_by"],
            )
            for r in rows
        ],
        total=total,
        page=page,
        limit=limit,
    )


@app.get("/client-portal/lookups/products", response_model=list[InventoryProductLookup])
def client_portal_lookup_products(user=Depends(get_current_client_portal)):
    portal_cid = _portal_bound_client_id(user)
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT p.id, p.name, p.sku, p.type_id,
                   pt.name AS type_name,
                   p.supplier_id, sp.name AS supplier_name,
                   pt.requires_color, pt.requires_size
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN suppliers sp ON sp.id = p.supplier_id
            WHERE p.is_active = 1 AND p.client_id = ? AND COALESCE(p.is_deleted, 0) = 0
            ORDER BY LOWER(p.name) ASC
            """,
            (portal_cid,),
        ).fetchall()
    return [
        InventoryProductLookup(
            id=r["id"],
            name=r["name"],
            sku=r["sku"],
            type_id=r["type_id"],
            type_name=r["type_name"] or "",
            supplier_id=r["supplier_id"],
            supplier_name=r["supplier_name"],
            requires_color=bool(r["requires_color"]) if r["requires_color"] is not None else False,
            requires_size=bool(r["requires_size"]) if r["requires_size"] is not None else False,
        )
        for r in rows
    ]


@app.get(
    "/client-portal/lookups/product-types",
    response_model=list[InventoryProductTypeLookup],
)
def client_portal_lookup_product_types(user=Depends(get_current_client_portal)):
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name, requires_color, requires_size
            FROM product_types
            WHERE is_active = 1
            ORDER BY LOWER(name) ASC
            """
        ).fetchall()
    return [
        InventoryProductTypeLookup(
            id=r["id"],
            name=r["name"],
            requires_color=bool(r["requires_color"]),
            requires_size=bool(r["requires_size"]),
        )
        for r in rows
    ]


@app.get("/client-portal/lookups/colors", response_model=list[DictionaryBaseItem])
def client_portal_lookup_colors(user=Depends(get_current_client_portal)):
    _ = user
    return _active_lookup_dictionary("colors")


@app.get("/client-portal/lookups/sizes", response_model=list[DictionaryBaseItem])
def client_portal_lookup_sizes(user=Depends(get_current_client_portal)):
    _ = user
    return _active_lookup_dictionary("sizes")


@app.get("/client-portal/dashboard/metrics", response_model=ClientPortalDashboardMetrics)
def client_portal_dashboard_metrics(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user=Depends(get_current_client_portal),
):
    portal_cid = _portal_bound_client_id(user)
    df, dt = _default_period(date_from, date_to)
    with get_connection() as connection:
        total_stock = _client_portal_total_positive_stock(connection, portal_cid)
        cur_in, cur_out = _sum_in_out_for_range(
            connection,
            df=df,
            dt=dt,
            client_ids=[portal_cid],
            product_id=None,
            type_id=None,
        )
    return ClientPortalDashboardMetrics(
        total_stock=total_stock,
        period_inflow=cur_in,
        period_outflow=cur_out,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
    )


@app.get("/client-portal/dashboard/movement", response_model=MovementReport)
def client_portal_dashboard_movement(
    group: str = Query("day", description="day | week | month"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    product_id: str | None = Query(None),
    type_id: str | None = Query(None),
    user=Depends(get_current_client_portal),
):
    portal_cid = _portal_bound_client_id(user)
    g = (group or "day").lower()
    if g not in ANALYTICS_GROUPS:
        raise HTTPException(status_code=400, detail="group: допустимо day | week | month")
    df, dt = _default_period(date_from, date_to)
    conds, params = _ana_filter_sql(
        client_ids=[portal_cid], product_id=product_id, type_id=type_id
    )
    conds.extend(
        [
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds) if conds else "1=1"
    bucket_expr = _group_expr(g)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                {bucket_expr} AS bucket,
                SUM({SQL_O_INFLOW_QTY}) AS inflow,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            WHERE {where_sql}
            GROUP BY bucket
            ORDER BY bucket ASC
            """,
            params,
        ).fetchall()
    data = [
        MovementBucket(
            period=r["bucket"],
            inflow=int(r["inflow"] or 0),
            outflow=int(r["outflow"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Движение товаров по {g}. {_explain_period(df, dt)}. "
        f"Бакетов: {len(data)}."
    )
    return MovementReport(
        explanation=explanation,
        group=g,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(
            client_ids=[portal_cid], product_id=product_id, type_id=type_id
        ),
        data=data,
    )


@app.get("/client-portal/dashboard/top-products", response_model=TopProductsReport)
def client_portal_dashboard_top_products(
    limit: int = Query(10, ge=1, le=100),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    type_id: str | None = Query(None),
    user=Depends(get_current_client_portal),
):
    portal_cid = _portal_bound_client_id(user)
    df, dt = _default_period(date_from, date_to)
    conds, params = _ana_filter_sql(
        client_ids=[portal_cid], product_id=None, type_id=type_id
    )
    conds.extend(
        [
            "o.op_type = 'out'",
            "substr(o.created_at, 1, 10) >= ?",
            "substr(o.created_at, 1, 10) <= ?",
        ]
    )
    params.extend([df, dt])
    where_sql = " AND ".join(conds)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.name) AS product,
                MAX(pt.name) AS type_name,
                SUM({SQL_O_SHIPPED_OUT_QTY}) AS total_outflow
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN product_types pt ON pt.id = p.type_id
            WHERE {where_sql}
            GROUP BY o.product_id
            ORDER BY total_outflow DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()
    data = [
        TopProductItem(
            product_id=r["product_id"],
            product=r["product"] or "",
            type_name=r["type_name"],
            total_outflow=int(r["total_outflow"] or 0),
        )
        for r in rows
    ]
    explanation = (
        f"Топ-{limit} товаров по отгрузке. {_explain_period(df, dt)}. "
        f"Записей: {len(data)}."
    )
    return TopProductsReport(
        explanation=explanation,
        period=AnalyticsPeriod(date_from=df, date_to=dt),
        filters=AnalyticsFilters(client_ids=[portal_cid], product_id=None, type_id=type_id),
        limit=limit,
        data=data,
    )


@app.get("/client-portal/dashboard/dead-stock", response_model=DeadStockReport)
def client_portal_dashboard_dead_stock(
    days: int = Query(30, ge=1, le=3650),
    type_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=5000),
    user=Depends(get_current_client_portal),
):
    """Мёртвые остатки только по товарам клиента (кабинет)."""
    portal_cid = _portal_bound_client_id(user)
    today = datetime.now(UTC).date()
    cutoff = (today - timedelta(days=days)).isoformat()
    today_iso = today.isoformat()
    conds, params = _ana_filter_sql(
        client_ids=[portal_cid], product_id=None, type_id=type_id
    )
    where_sql = " AND ".join(conds) if conds else "1=1"
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                o.product_id,
                MAX(p.name) AS product,
                MAX(p.client_id) AS client_id,
                MAX(cl.name) AS client,
                MAX(o.color_id) AS color_id,
                MAX(col.name) AS color,
                MAX(o.size_id) AS size_id,
                MAX(sz.name) AS size,
                SUM({SQL_O_NET_QTY}) AS stock,
                MAX(o.created_at) AS last_movement_at
            FROM inventory_operations o
            LEFT JOIN products p ON p.id = o.product_id
            LEFT JOIN clients cl ON cl.id = p.client_id
            LEFT JOIN colors col ON col.id = o.color_id
            LEFT JOIN sizes sz ON sz.id = o.size_id
            WHERE {where_sql}
            GROUP BY o.product_id, COALESCE(o.color_id, ''), COALESCE(o.size_id, '')
            HAVING SUM({SQL_O_NET_QTY}) > 0 AND substr(MAX(o.created_at), 1, 10) <= ?
            ORDER BY stock DESC
            LIMIT ?
            """,
            [*params, cutoff, limit],
        ).fetchall()
    data: list[DeadStockItem] = []
    for r in rows:
        last_iso = r["last_movement_at"] or ""
        days_without = 0
        if last_iso:
            try:
                last_date = datetime.fromisoformat(last_iso).date()
                days_without = (today - last_date).days
            except ValueError:
                days_without = days
        data.append(
            DeadStockItem(
                product_id=r["product_id"],
                product=r["product"] or "",
                client_id=r["client_id"],
                client=r["client"],
                color_id=r["color_id"],
                color=r["color"],
                size_id=r["size_id"],
                size=r["size"],
                stock=int(r["stock"] or 0),
                last_movement_at=last_iso or None,
                days_without_movement=days_without,
            )
        )
    explanation = (
        f"Ваши мёртвые остатки: без движения ≥ {days} дней (на {today_iso}). "
        f"Найдено позиций: {len(data)}."
    )
    return DeadStockReport(
        explanation=explanation,
        days_threshold=days,
        filters=AnalyticsFilters(client_ids=[portal_cid], product_id=None, type_id=type_id),
        data=data,
    )


# --- Импорт движений из Excel (ТЗ «Загрузка excel») ---


def _excel_filename_kind(filename: str) -> str | None:
    lower = str(filename).strip().lower()
    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        return "xlsx"
    if lower.endswith(".xls"):
        return "xls"
    return None


def _template_type_to_op_type(template_type: str) -> str:
    x = str(template_type).strip().lower()
    if x in ("receipt", "in", "поступление", "поступления"):
        return "in"
    if x in ("shipment", "out", "отгрузка", "отгрузки"):
        return "out"
    raise HTTPException(status_code=400, detail="Неподдерживаемый тип шаблона")


def _assert_excel_readable(raw: bytes, orig_name: str) -> None:
    kind = _excel_filename_kind(orig_name)
    if kind is None:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")
    if kind == "xlsx":
        try:
            from openpyxl import load_workbook

            wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            wb.close()
        except Exception:
            raise HTTPException(status_code=400, detail="Не удалось прочитать файл")
        return
    try:
        import xlrd

        xlrd.open_workbook(file_contents=raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось прочитать файл")


def _save_staged_import(uid: str, op_type: str, raw: bytes, original_name: str) -> str:
    fid = str(uuid4())
    bin_path = IMPORT_STAGING_DIR / f"{fid}.bin"
    meta_path = IMPORT_STAGING_DIR / f"{fid}.json"
    template_label = "receipt" if op_type == "in" else "shipment"
    meta = {
        "user_id": uid,
        "op_type": op_type,
        "template_type": template_label,
        "original_name": original_name,
        "size": len(raw),
    }
    bin_path.write_bytes(raw)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return fid


def _load_staged_import(uid: str, file_id: str) -> tuple[bytes, dict[str, Any]]:
    fid = str(file_id).strip()
    if not fid:
        raise HTTPException(status_code=400, detail="Укажите file_id")
    meta_path = IMPORT_STAGING_DIR / f"{fid}.json"
    bin_path = IMPORT_STAGING_DIR / f"{fid}.bin"
    if not meta_path.is_file() or not bin_path.is_file():
        raise HTTPException(status_code=404, detail="Файл импорта не найден или устарел")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if str(meta.get("user_id")) != uid:
        raise HTTPException(status_code=403, detail="Нет доступа к файлу импорта")
    return bin_path.read_bytes(), meta


def _delete_staged_import(file_id: str) -> None:
    fid = str(file_id).strip()
    if not fid:
        return
    for suffix in (".bin", ".json"):
        p = IMPORT_STAGING_DIR / f"{fid}{suffix}"
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass


class MovementImportPreviewErrorItem(BaseModel):
    row: int
    error: str


class MovementImportPreviewWarningItem(BaseModel):
    row: int
    warning: str


class MovementImportPreviewRow(BaseModel):
    excel_row: int
    date: str
    name: str
    barcode: str
    color: str
    size: str | None = None
    quantity: int
    status: str
    receipt_status: str | None = None
    shipment_status: str | None = None
    comment: str | None = None
    product_name: str
    client_name: str | None = None
    preview_image_url: str | None = None
    warnings: list[str] = Field(default_factory=list)


class MovementImportPreviewRowResult(BaseModel):
    """Строка таблицы детализации проверки (ТЗ шаг 02)."""

    excel_row: int
    date: str
    barcode: str
    color: str
    size: str | None = None
    quantity: int | None = None
    status_display: str
    found_product_name: str | None = None
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class MovementImportPreviewResponse(BaseModel):
    summary_total: int = 0
    summary_ok: int = 0
    summary_with_errors: int = 0
    import_ready: bool = False
    file_status_label: str = ""
    row_results: list[MovementImportPreviewRowResult] = Field(default_factory=list)
    valid_rows: list[MovementImportPreviewRow] = Field(default_factory=list)
    errors: list[MovementImportPreviewErrorItem] = Field(default_factory=list)
    warnings: list[MovementImportPreviewWarningItem] = Field(default_factory=list)


class MovementImportCommitResponse(BaseModel):
    total: int
    success: int
    failed: int
    warnings: int


class ImportUploadResponse(BaseModel):
    file_id: str
    file_name: str
    file_size: int


def _date_iso_to_ru_display(date_iso: str | None) -> str:
    if not date_iso or len(str(date_iso)) < 10:
        return ""
    s = str(date_iso)
    try:
        y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        return f"{d:02d}.{mo:02d}.{y}"
    except Exception:
        return s


def _import_status_field_error(status_display: str, op_type: str) -> str | None:
    sd = _mei.normalize_excel_text(status_display)
    if not sd:
        return "Не указан статус"
    if _mei.normalize_movement_import_status(sd, op_type) is not None:
        return None
    alt_ot = "out" if str(op_type).strip().lower() == "in" else "in"
    if _mei.normalize_movement_import_status(sd, alt_ot) is not None:
        return "Статус не соответствует типу операции"
    return "Некорректный статус"


def _lookup_client_id_for_import(connection: Any, client_name: str) -> tuple[str | None, str | None]:
    cn = _mei.normalize_excel_text(client_name)
    if not cn:
        return None, "Клиент не найден"
    rows = connection.execute(
        """
        SELECT id FROM clients
        WHERE COALESCE(is_deleted, 0) = 0 AND COALESCE(is_active, 1) = 1
          AND replace(lower(trim(COALESCE(name, ''))), 'ё', 'е') = ?
        """,
        (_fold_ci_import_match(cn),),
    ).fetchall()
    if not rows:
        return None, "Клиент не найден"
    return str(rows[0]["id"]), None


def _resolve_movement_variant_for_import(
    connection: Any,
    barcode: str,
    color_name: str,
    size_name: str,
    product_name_excel: str,
    client_id_file: str | None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Поиск варианта по ШК + цвету + размеру (название только сверка). ТЗ шаг 02."""
    bc = str(barcode).strip()
    cn = str(color_name or "").strip()
    sn = str(size_name or "").strip()
    if not bc:
        return None, "Не указан ШК"

    prows = connection.execute(
        """
        SELECT p.id, p.name, p.client_id, p.gallery_json, p.image_url,
               COALESCE(pt.requires_color, 0) AS requires_color,
               COALESCE(pt.requires_size, 0) AS requires_size,
               cl.name AS client_name
        FROM products p
        JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        WHERE COALESCE(p.is_deleted, 0) = 0 AND COALESCE(p.is_active, 1) = 1
          AND LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(TRIM(?))
        """,
        (bc,),
    ).fetchall()
    if not prows:
        return None, "Товар не найден"
    if len(prows) > 1:
        return None, "Найдено несколько вариантов товара"
    pr = prows[0]
    pid = str(pr["id"])
    pname = str(pr["name"] or "").strip()
    client_id = pr["client_id"]
    client_name = str(pr["client_name"] or "").strip() if pr["client_name"] else None
    if client_id is None or not str(client_id).strip():
        return None, "Товар не привязан к клиенту"
    if _fold_ci_import_match(product_name_excel) != _fold_ci_import_match(pname):
        return None, f"Название в системе отличается: {pname}"
    if client_id_file and str(client_id).strip() != str(client_id_file).strip():
        return None, "Товар не принадлежит клиенту"

    requires_color = bool(pr["requires_color"])
    requires_size = bool(pr["requires_size"])

    color_id: str | None = None
    if requires_color:
        if not cn:
            return None, "Цвет не найден"
        color_rows = connection.execute(
            """
            SELECT id FROM colors
            WHERE COALESCE(is_deleted, 0) = 0 AND is_active = 1
              AND replace(lower(trim(COALESCE(name, ''))), 'ё', 'е') = ?
            """,
            (_fold_ci_import_match(cn),),
        ).fetchall()
        if not color_rows:
            return None, "Цвет не найден"
        color_id = str(color_rows[0]["id"])
    else:
        if cn:
            color_rows = connection.execute(
                """
                SELECT id FROM colors
                WHERE COALESCE(is_deleted, 0) = 0 AND is_active = 1
                  AND replace(lower(trim(COALESCE(name, ''))), 'ё', 'е') = ?
                """,
                (_fold_ci_import_match(cn),),
            ).fetchall()
            if not color_rows:
                return None, "Цвет не найден"
            color_id = str(color_rows[0]["id"])

    if color_id is not None:
        vrows = connection.execute(
            """
            SELECT v.id AS variant_id, v.sku AS variant_sku, v.product_id, v.color_id, v.size_id,
                   s.name AS size_name
            FROM product_variants v
            LEFT JOIN sizes s ON s.id = v.size_id
            WHERE v.product_id = ? AND v.color_id = ?
              AND COALESCE(v.is_deleted, 0) = 0 AND COALESCE(v.is_active, 1) = 1
            """,
            (pid, color_id),
        ).fetchall()
    else:
        vrows = connection.execute(
            """
            SELECT v.id AS variant_id, v.sku AS variant_sku, v.product_id, v.color_id, v.size_id,
                   s.name AS size_name
            FROM product_variants v
            LEFT JOIN sizes s ON s.id = v.size_id
            WHERE v.product_id = ?
              AND COALESCE(v.is_deleted, 0) = 0 AND COALESCE(v.is_active, 1) = 1
            """,
            (pid,),
        ).fetchall()

    if not vrows:
        return None, "Недопустимый цвет для товара" if color_id is not None else "Товар не найден"

    size_id: str | None = None
    if requires_size:
        if not sn:
            return None, "Размер не найден"
        sz_rows = connection.execute(
            """
            SELECT id FROM sizes
            WHERE COALESCE(is_deleted, 0) = 0 AND is_active = 1
              AND replace(lower(trim(COALESCE(name, ''))), 'ё', 'е') = ?
            """,
            (_fold_ci_import_match(sn),),
        ).fetchall()
        if not sz_rows:
            return None, "Размер не найден"
        size_id = str(sz_rows[0]["id"])
    elif sn:
        sz_rows = connection.execute(
            """
            SELECT id FROM sizes
            WHERE COALESCE(is_deleted, 0) = 0 AND is_active = 1
              AND replace(lower(trim(COALESCE(name, ''))), 'ё', 'е') = ?
            """,
            (_fold_ci_import_match(sn),),
        ).fetchall()
        if not sz_rows:
            return None, "Размер не найден"
        size_id = str(sz_rows[0]["id"])

    matches: list[Mapping[str, Any]] = []
    if requires_size:
        for vr in vrows:
            if str(vr["size_id"] or "") == (size_id or ""):
                matches.append(vr)
        if not matches:
            return None, "Недопустимый размер для товара"
    else:
        if sn:
            for vr in vrows:
                szn = str(vr["size_name"] or "").strip()
                if _fold_ci_import_match(szn) == _fold_ci_import_match(sn):
                    matches.append(vr)
            if not matches:
                return None, "Недопустимый размер для товара"
        else:
            if len(vrows) == 1:
                matches = list(vrows)
            else:
                null_sz = [vr for vr in vrows if not vr["size_id"]]
                if len(null_sz) == 1:
                    matches = null_sz
                elif len(null_sz) > 1:
                    return None, "Найдено несколько вариантов товара"
                else:
                    return None, "Найдено несколько вариантов товара"

    if len(matches) != 1:
        if len(matches) > 1:
            return None, "Найдено несколько вариантов товара"
        return None, "Товар не найден"

    vr = matches[0]
    urls = _product_card_image_urls(pr["gallery_json"], pr["image_url"])
    preview = urls[0] if urls else None
    return {
        "variant_id": str(vr["variant_id"]),
        "variant_sku": str(vr["variant_sku"] or "").strip(),
        "product_id": pid,
        "color_id": str(vr["color_id"]) if vr["color_id"] else None,
        "size_id": str(vr["size_id"]) if vr["size_id"] else None,
        "product_name": pname,
        "client_name": client_name,
        "client_id": str(client_id).strip(),
        "preview_image_url": preview,
    }, None


def _movement_import_process_rows(
    connection: Any,
    op_type: str,
    parsed_rows: list[dict[str, Any]],
) -> tuple[
    list[MovementImportPreviewRow],
    list[MovementImportPreviewErrorItem],
    list[MovementImportPreviewWarningItem],
    list[MovementImportPreviewRowResult],
]:
    """Полная проверка строк (ТЗ шаг 02): без записи в БД."""
    today = datetime.now(UTC).date()
    warn_flat: list[MovementImportPreviewWarningItem] = []
    valid: list[MovementImportPreviewRow] = []
    row_results: list[MovementImportPreviewRowResult] = []

    for r in parsed_rows:
        row_no = int(r["excel_row"])
        row_errs: list[str] = []
        row_warns: list[str] = []

        status_display = str(r.get("status_display") or r.get("status") or "")
        date_str = r.get("date")
        date_disp = _date_iso_to_ru_display(date_str) if date_str else ""
        name = str(r.get("name") or "").strip()
        barcode = str(r.get("barcode") or "").strip()
        color = str(r.get("color") or "").strip()
        size = str(r.get("size") or "").strip()
        qty = r.get("quantity")
        qty_empty = bool(r.get("quantity_empty", False))
        comment = r.get("comment")

        client_id_file: str | None = None

        if not date_str:
            row_errs.append("Некорректная дата")
        op_day: date | None = None
        if date_str:
            try:
                y, mo, d = (int(date_str[0:4]), int(date_str[5:7]), int(date_str[8:10]))
                op_day = date(y, mo, d)
            except Exception:
                row_errs.append("Некорректная дата")

        if not barcode:
            row_errs.append("Не указан ШК")

        if not name:
            row_errs.append("Не указано название")

        if qty_empty:
            row_errs.append("Не указано количество")
        elif qty is None or not isinstance(qty, int):
            row_errs.append("Некорректное количество")

        st_msg = _import_status_field_error(status_display, op_type)
        if st_msg:
            row_errs.append(st_msg)
        st_norm = _mei.normalize_movement_import_status(status_display, op_type) if not st_msg else None

        cid_lookup, cerr = _lookup_client_id_for_import(connection, str(r.get("client") or ""))
        if cerr:
            row_errs.append(cerr)
        else:
            client_id_file = cid_lookup

        resolved: dict[str, Any] | None = None
        if not row_errs and op_day is not None and st_norm is not None:
            if st_norm == "accepted" and op_day > today:
                row_errs.append("Дата в будущем недопустима для подтверждённой операции")

        if not row_errs and client_id_file:
            res, err = _resolve_movement_variant_for_import(
                connection,
                barcode,
                color,
                size,
                name,
                client_id_file,
            )
            if err:
                row_errs.append(err)
            else:
                resolved = res

        if not row_errs and resolved is not None and op_day is not None:
            if abs((today - op_day).days) > 365:
                row_warns.append("Дата операции сильно отличается от текущей")
            if isinstance(qty, int) and qty > 5000:
                row_warns.append("Необычно большое количество (>5000)")

        if not row_errs and resolved is not None and st_norm is not None:
            st = st_norm
            rec_st: str | None = None
            ship_st: str | None = None
            if op_type == "in":
                rec_st = RECEIPT_STATUS_PENDING if st == "planned" else RECEIPT_STATUS_ACCEPTED
            else:
                ship_st = SHIPMENT_STATUS_PENDING if st == "planned" else SHIPMENT_STATUS_SHIPPED
            valid.append(
                MovementImportPreviewRow(
                    excel_row=row_no,
                    date=date_str or "",
                    name=name,
                    barcode=barcode,
                    color=color,
                    size=size or None,
                    quantity=int(qty) if isinstance(qty, int) else 0,
                    status=st,
                    receipt_status=rec_st,
                    shipment_status=ship_st,
                    comment=str(comment).strip() if comment else None,
                    product_name=str(resolved["product_name"]),
                    client_name=resolved.get("client_name"),
                    preview_image_url=resolved.get("preview_image_url"),
                    warnings=list(row_warns),
                )
            )

        row_results.append(
            MovementImportPreviewRowResult(
                excel_row=row_no,
                date=date_disp or (date_str or ""),
                barcode=barcode,
                color=color,
                size=size or None,
                quantity=int(qty) if isinstance(qty, int) else None,
                status_display=status_display,
                found_product_name=str(resolved["product_name"]) if resolved else None,
                errors=list(row_errs),
                warnings=list(row_warns),
            )
        )

    by_row = {rr.excel_row: rr for rr in row_results}

    dup_map: dict[tuple[Any, ...], list[int]] = {}
    for r in parsed_rows:
        row_no = int(r["excel_row"])
        rr = by_row[row_no]
        if rr.errors:
            continue
        st_n = _mei.normalize_movement_import_status(str(r.get("status_display") or r.get("status") or ""), op_type)
        cid, _cerr = _lookup_client_id_for_import(connection, str(r.get("client") or ""))
        ds = r.get("date")
        if not st_n or not cid or not ds:
            continue
        key = (
            op_type,
            ds,
            cid,
            _fold_ci_str(str(r.get("barcode") or "")),
            _fold_ci_import_match(str(r.get("color") or "")),
            _fold_ci_import_match(str(r.get("size") or "")),
            st_n,
        )
        dup_map.setdefault(key, []).append(row_no)

    dupped_rows: set[int] = set()
    for _k, rows_d in dup_map.items():
        rows_sorted = sorted(rows_d)
        if len(rows_sorted) <= 1:
            continue
        for rn in rows_sorted[1:]:
            dupped_rows.add(rn)
            by_row[rn].errors.append("Дублирующаяся строка в файле")

    if dupped_rows:
        valid = [v for v in valid if v.excel_row not in dupped_rows]

    if op_type == "out":
        valid.sort(key=lambda x: x.excel_row)
        running: dict[tuple[str, str | None, str | None], int] = {}
        to_remove: set[int] = set()
        for v in valid:
            row_src = next((row for row in parsed_rows if int(row["excel_row"]) == v.excel_row), None)
            if not row_src:
                continue
            cid_f, _ce = _lookup_client_id_for_import(connection, str(row_src.get("client") or ""))
            res, _e = _resolve_movement_variant_for_import(
                connection,
                str(row_src.get("barcode") or ""),
                str(row_src.get("color") or ""),
                str(row_src.get("size") or ""),
                str(row_src.get("name") or ""),
                cid_f,
            )
            if not res:
                continue
            pid, cid, sid = res["product_id"], res["color_id"], res["size_id"]
            key = (str(pid), cid, sid)
            if key not in running:
                running[key] = _balance_qty(connection, str(pid), cid, sid)
            if (v.shipment_status or "") == SHIPMENT_STATUS_SHIPPED:
                need = int(v.quantity)
                if running[key] < need:
                    to_remove.add(v.excel_row)
                    by_row[v.excel_row].errors.append("Недостаточно остатка")
                else:
                    running[key] -= need
        valid = [x for x in valid if x.excel_row not in to_remove]

    errors_out: list[MovementImportPreviewErrorItem] = []
    for rr in row_results:
        for e in rr.errors:
            errors_out.append(MovementImportPreviewErrorItem(row=rr.excel_row, error=e))
        for w in rr.warnings:
            warn_flat.append(MovementImportPreviewWarningItem(row=rr.excel_row, warning=w))

    return valid, errors_out, warn_flat, row_results


def _movement_import_insert_rows(
    connection: Any,
    op_type: str,
    parsed_rows: list[dict[str, Any]],
    user_id: str,
) -> tuple[int, int, int]:
    """Вставка всех валидных строк (строгий режим). Возвращает (total строк в файле, success, warnings)."""
    valid, errors, warns, _rr = _movement_import_process_rows(connection, op_type, parsed_rows)
    if errors:
        raise HTTPException(status_code=400, detail="Файл содержит ошибки; загрузка отменена")
    total_file = len(parsed_rows)
    wcount = len(warns)
    valid_sorted = sorted(valid, key=lambda v: v.excel_row)
    for v in valid_sorted:
        row_src = next((r for r in parsed_rows if int(r["excel_row"]) == v.excel_row), None)
        if not row_src:
            continue
        cid_f, _ecl = _lookup_client_id_for_import(connection, str(row_src.get("client") or ""))
        res, err = _resolve_movement_variant_for_import(
            connection,
            str(row_src.get("barcode") or ""),
            str(row_src.get("color") or ""),
            str(row_src.get("size") or ""),
            str(row_src.get("name") or ""),
            cid_f,
        )
        if err or not res:
            raise HTTPException(status_code=400, detail=err or "Ошибка сопоставления")
        note = (v.comment or "").strip() or None
        vid = str(res["variant_id"])
        vsku = str(res["variant_sku"]).strip()
        pid = str(res["product_id"])
        cid = str(res["color_id"]) if res["color_id"] else None
        sid = str(res["size_id"]) if res["size_id"] else None
        qty = int(v.quantity)
        if op_type == "in":
            rs = str(v.receipt_status or RECEIPT_STATUS_ACCEPTED)
            allow_future = rs == RECEIPT_STATUS_PENDING
            created_at = _created_at_for_receipt_date(v.date, allow_future=allow_future)
            connection.execute(
                """
                INSERT INTO inventory_operations
                    (id, op_type, product_id, color_id, size_id, quantity, note,
                     created_at, created_by_id, variant_id, variant_sku, receipt_status, shipment_status)
                VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    str(uuid4()),
                    pid,
                    cid,
                    sid,
                    qty,
                    note,
                    created_at,
                    user_id,
                    vid,
                    vsku,
                    rs,
                ),
            )
        else:
            ss = str(v.shipment_status or SHIPMENT_STATUS_PENDING)
            allow_future = ss == SHIPMENT_STATUS_PENDING
            created_at = _created_at_for_shipment_date(v.date, allow_future=allow_future)
            if ss == SHIPMENT_STATUS_SHIPPED:
                cur = _balance_qty(connection, pid, cid, sid)
                if cur < qty:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно остатка: доступно {cur}, требуется {qty}",
                    )
            connection.execute(
                """
                INSERT INTO inventory_operations
                    (id, op_type, product_id, color_id, size_id, quantity, note,
                     created_at, created_by_id, variant_id, variant_sku, receipt_status, shipment_status)
                VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    str(uuid4()),
                    pid,
                    cid,
                    sid,
                    qty,
                    note,
                    created_at,
                    user_id,
                    vid,
                    vsku,
                    ss,
                ),
            )
    return total_file, len(valid_sorted), wcount


def _movement_import_insert_partial(
    connection: Any,
    op_type: str,
    parsed_rows: list[dict[str, Any]],
    user_id: str,
) -> tuple[int, int, int, int]:
    """Частичная загрузка: валидные строки по тем же правилам, что и превью; вставка по порядку строк файла."""
    valid, errors, warns, _rr = _movement_import_process_rows(connection, op_type, parsed_rows)
    total = len(parsed_rows)
    wcount = len(warns)
    success = 0
    for v in sorted(valid, key=lambda x: x.excel_row):
        row_src = next((r for r in parsed_rows if int(r["excel_row"]) == v.excel_row), None)
        if not row_src:
            continue
        cid_f, _ecl = _lookup_client_id_for_import(connection, str(row_src.get("client") or ""))
        res, err = _resolve_movement_variant_for_import(
            connection,
            str(row_src.get("barcode") or ""),
            str(row_src.get("color") or ""),
            str(row_src.get("size") or ""),
            str(row_src.get("name") or ""),
            cid_f,
        )
        if err or not res:
            continue
        note = (v.comment or "").strip() or None
        vid = str(res["variant_id"])
        vsku = str(res["variant_sku"]).strip()
        pid = str(res["product_id"])
        cid = str(res["color_id"]) if res["color_id"] else None
        sid = str(res["size_id"]) if res["size_id"] else None
        qty = int(v.quantity)
        try:
            if op_type == "in":
                rs = str(v.receipt_status or RECEIPT_STATUS_ACCEPTED)
                allow_future = rs == RECEIPT_STATUS_PENDING
                created_at = _created_at_for_receipt_date(v.date, allow_future=allow_future)
                connection.execute(
                    """
                    INSERT INTO inventory_operations
                        (id, op_type, product_id, color_id, size_id, quantity, note,
                         created_at, created_by_id, variant_id, variant_sku, receipt_status, shipment_status)
                    VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        str(uuid4()),
                        pid,
                        cid,
                        sid,
                        qty,
                        note,
                        created_at,
                        user_id,
                        vid,
                        vsku,
                        rs,
                    ),
                )
            else:
                ss = str(v.shipment_status or SHIPMENT_STATUS_PENDING)
                allow_future = ss == SHIPMENT_STATUS_PENDING
                created_at = _created_at_for_shipment_date(v.date, allow_future=allow_future)
                if ss == SHIPMENT_STATUS_SHIPPED:
                    cur = _balance_qty(connection, pid, cid, sid)
                    if cur < qty:
                        continue
                connection.execute(
                    """
                    INSERT INTO inventory_operations
                        (id, op_type, product_id, color_id, size_id, quantity, note,
                         created_at, created_by_id, variant_id, variant_sku, receipt_status, shipment_status)
                    VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                    """,
                    (
                        str(uuid4()),
                        pid,
                        cid,
                        sid,
                        qty,
                        note,
                        created_at,
                        user_id,
                        vid,
                        vsku,
                        ss,
                    ),
                )
            success += 1
        except Exception:
            continue
    failed = max(0, total - success)
    return total, success, failed, wcount


def _movement_import_preview_from_raw(connection: Any, ot: str, raw: bytes) -> MovementImportPreviewResponse:
    parsed, file_errors = _mei.parse_movements_excel(raw, ot)
    if file_errors:
        return MovementImportPreviewResponse(
            summary_total=0,
            summary_ok=0,
            summary_with_errors=0,
            import_ready=False,
            file_status_label="Импорт невозможен",
            row_results=[],
            valid_rows=[],
            errors=[MovementImportPreviewErrorItem(row=0, error=e) for e in file_errors],
            warnings=[],
        )
    valid, row_errors, warns, row_results = _movement_import_process_rows(connection, ot, parsed)
    total = len(row_results)
    with_err = sum(1 for rr in row_results if rr.errors)
    ok = total - with_err
    ready = with_err == 0
    return MovementImportPreviewResponse(
        summary_total=total,
        summary_ok=ok,
        summary_with_errors=with_err,
        import_ready=ready,
        file_status_label="Готов к импорту" if ready else "Импорт невозможен",
        row_results=row_results,
        valid_rows=valid,
        errors=row_errors,
        warnings=warns,
    )


def _movement_import_commit_parsed(
    connection: Any,
    ot: str,
    parsed: list[Any],
    fname: str,
    partial: bool,
    uid: str,
) -> MovementImportCommitResponse:
    if partial:
        total, success, failed, wcount = _movement_import_insert_partial(connection, ot, parsed, uid)
        detail = {
            "mode": "partial",
            "filename": fname,
            "total": total,
            "success": success,
            "failed": failed,
            "warnings": wcount,
        }
        connection.execute(
            """
            INSERT INTO import_movement_logs
                (id, user_id, created_at, op_type, filename, total, success, failed, warnings, detail_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                uid,
                _now(),
                ot,
                fname,
                total,
                success,
                failed,
                wcount,
                json.dumps(detail, ensure_ascii=False),
            ),
        )
        connection.commit()
        return MovementImportCommitResponse(total=total, success=success, failed=failed, warnings=wcount)

    total, success, wcount = _movement_import_insert_rows(connection, ot, parsed, uid)
    failed = max(0, total - success)
    detail = {
        "mode": "strict",
        "filename": fname,
        "total": total,
        "success": success,
        "failed": failed,
        "warnings": wcount,
    }
    connection.execute(
        """
        INSERT INTO import_movement_logs
            (id, user_id, created_at, op_type, filename, total, success, failed, warnings, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            uid,
            _now(),
            ot,
            fname,
            total,
            success,
            failed,
            wcount,
            json.dumps(detail, ensure_ascii=False),
        ),
    )
    connection.commit()
    return MovementImportCommitResponse(total=total, success=success, failed=failed, warnings=wcount)


@app.delete("/import/staging/{file_id}", status_code=204)
def import_delete_staging(file_id: str, user=Depends(get_current_manager)):
    """Удаляет временный файл импорта и метаданные (ТЗ шаг 02: сброс перед повторной загрузкой)."""
    uid = str(user["id"])
    _load_staged_import(uid, file_id)
    _delete_staged_import(file_id)


@app.post("/import/upload", response_model=ImportUploadResponse)
async def import_upload_excel(
    template_type: str = Form(..., description="'receipt' или 'shipment' (или in/out)"),
    file: UploadFile = File(...),
    user=Depends(get_current_manager),
):
    """Шаг 1 ТЗ: техническая проверка и временное сохранение файла (без разбора строк движений)."""
    uid = str(user["id"])
    fname = (file.filename or "").strip() or "upload.xlsx"
    if _excel_filename_kind(fname) is None:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")
    raw = await file.read()
    if len(raw) > IMPORT_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Размер файла превышает допустимый лимит 20 MB")
    _assert_excel_readable(raw, fname)
    ot = _template_type_to_op_type(template_type)
    fid = _save_staged_import(uid, ot, raw, fname)
    return ImportUploadResponse(file_id=fid, file_name=fname, file_size=len(raw))


@app.get("/import/movements/template")
def import_movements_template(
    op_type: str = Query(..., description="'in' или 'out'"),
    user=Depends(get_current_manager),
):
    _ = user
    ot = str(op_type).strip().lower()
    if ot not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    body = _mei.build_template_workbook_bytes(ot)
    fn_ru = "Поступление.xlsx" if ot == "in" else "Отгрузка.xlsx"
    fn_ascii = "postuplenie.xlsx" if ot == "in" else "otgruzka.xlsx"
    cd = f'attachment; filename="{fn_ascii}"; filename*=UTF-8\'\'{quote(fn_ru)}'
    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": cd},
    )


@app.post("/import/movements/preview", response_model=MovementImportPreviewResponse)
async def import_movements_preview(
    op_type: str = Query(..., description="'in' или 'out'"),
    file: UploadFile = File(...),
    user=Depends(get_current_manager),
):
    ot = str(op_type).strip().lower()
    if ot not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    raw = await file.read()
    with get_connection() as connection:
        return _movement_import_preview_from_raw(connection, ot, raw)


@app.post("/import/movements/preview-staged", response_model=MovementImportPreviewResponse)
async def import_movements_preview_staged(
    op_type: str = Query(..., description="'in' или 'out'"),
    file_id: str = Query(...),
    user=Depends(get_current_manager),
):
    ot = str(op_type).strip().lower()
    if ot not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    uid = str(user["id"])
    raw, meta = _load_staged_import(uid, file_id)
    if str(meta.get("op_type")) != ot:
        raise HTTPException(status_code=400, detail="Тип операции не совпадает с выбранным шаблоном")
    with get_connection() as connection:
        return _movement_import_preview_from_raw(connection, ot, raw)


@app.post("/import/movements/commit", response_model=MovementImportCommitResponse)
async def import_movements_commit(
    op_type: str = Query(..., description="'in' или 'out'"),
    partial: bool = Query(False, description="Если true — загружаются только валидные строки"),
    file: UploadFile = File(...),
    user=Depends(get_current_manager),
):
    ot = str(op_type).strip().lower()
    if ot not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    raw = await file.read()
    fname = (file.filename or "upload.xlsx").strip() or "upload.xlsx"
    parsed, file_errors = _mei.parse_movements_excel(raw, ot)
    if file_errors:
        raise HTTPException(status_code=400, detail=file_errors[0])

    uid = str(user["id"])
    with get_connection() as connection:
        return _movement_import_commit_parsed(connection, ot, parsed, fname, partial, uid)


@app.post("/import/movements/commit-staged", response_model=MovementImportCommitResponse)
async def import_movements_commit_staged(
    op_type: str = Query(..., description="'in' или 'out'"),
    file_id: str = Query(...),
    partial: bool = Query(False, description="Если true — загружаются только валидные строки"),
    user=Depends(get_current_manager),
):
    ot = str(op_type).strip().lower()
    if ot not in ("in", "out"):
        raise HTTPException(status_code=400, detail="op_type: допустимо 'in' или 'out'")
    uid = str(user["id"])
    raw, meta = _load_staged_import(uid, file_id)
    if str(meta.get("op_type")) != ot:
        raise HTTPException(status_code=400, detail="Тип операции не совпадает с выбранным шаблоном")
    fname = str(meta.get("original_name") or "upload.xlsx").strip() or "upload.xlsx"
    parsed, file_errors = _mei.parse_movements_excel(raw, ot)
    if file_errors:
        raise HTTPException(status_code=400, detail=file_errors[0])
    with get_connection() as connection:
        out = _movement_import_commit_parsed(connection, ot, parsed, fname, partial, uid)
    _delete_staged_import(file_id)
    return out
