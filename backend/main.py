from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3
from uuid import uuid4

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field


JWT_SECRET = "replace-this-secret-in-production"
JWT_ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = 60
DB_PATH = Path(__file__).parent / "auth.db"
UPLOADS_DIR = Path(__file__).parent / "uploads"
DICTIONARY_TABLES = {"clients", "colors", "sizes", "product_types", "suppliers"}

CLIENT_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "d.name COLLATE NOCASE",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
SIZE_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "d.name COLLATE NOCASE",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
COLOR_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "d.name COLLATE NOCASE",
    "created_at": "d.created_at",
    "is_active": "d.is_active",
}
PRODUCT_LIST_SORT_COLUMNS: dict[str, str] = {
    "name": "p.name COLLATE NOCASE",
    "type": "IFNULL(pt.name, '') COLLATE NOCASE",
    "sku": "p.sku COLLATE NOCASE",
    "client": "IFNULL(c.name, '') COLLATE NOCASE",
    "supplier": "IFNULL(s.name, '') COLLATE NOCASE",
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


bearer_scheme = HTTPBearer()

app = FastAPI(title="Auth Module API")
app.add_middleware(
    CORSMiddleware,
    # Локальная разработка: любой порт на localhost / 127.0.0.1 (Vite, preview, другой порт)
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
UPLOADS_DIR.mkdir(exist_ok=True)
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


class UserListItem(BaseModel):
    id: str
    email: EmailStr
    role: str
    created_at: str


class RoleUpdateRequest(BaseModel):
    role: str


class MessageResponse(BaseModel):
    message: str


class DictionaryBaseItem(BaseModel):
    id: str
    name: str
    is_active: bool
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


class SizeItem(BaseModel):
    id: str
    name: str
    is_active: bool
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


class ProductItem(BaseModel):
    id: str
    name: str
    type_id: str
    type_name: str | None = None
    sku: str
    client_id: str | None = None
    client_name: str | None = None
    supplier_id: str | None = None
    supplier_name: str | None = None
    image_url: str | None
    is_active: bool = Field(
        description="Актуален: true — товар в ассортименте, false — не актуален; по умолчанию true.",
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


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as connection:
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
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()
        }
        if "role" not in columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"
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
            },
        )
        _migrate_sizes_remove_code_column(connection)
        _migrate_products_is_active_aktualen(connection)
        _migrate_products_dictionary_fks(connection)
        _ensure_record_actuality(connection)
        connection.commit()


def _ensure_columns(connection: sqlite3.Connection, table_name: str, columns: dict[str, str]):
    current_columns = {
        row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    for column_name, column_type in columns.items():
        if column_name not in current_columns:
            connection.execute(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
            )


def _migrate_sizes_remove_code_column(connection: sqlite3.Connection) -> None:
    """Удаление колонки code и индекса (поле убрано из модели)."""
    cols = {row["name"] for row in connection.execute("PRAGMA table_info(sizes)").fetchall()}
    if "code" not in cols:
        return
    connection.execute("DROP INDEX IF EXISTS sizes_code_unique")
    try:
        connection.execute("ALTER TABLE sizes DROP COLUMN code")
    except sqlite3.OperationalError:
        pass


def _migrate_products_is_active_aktualen(connection: sqlite3.Connection) -> None:
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


def _ensure_seed_product_types_if_empty(connection: sqlite3.Connection) -> None:
    count = int(
        connection.execute("SELECT COUNT(*) FROM product_types").fetchone()[0]
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


def _migrate_products_dictionary_fks(connection: sqlite3.Connection) -> None:
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

    cols = {row["name"] for row in connection.execute("PRAGMA table_info(products)").fetchall()}

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
              AND TRIM(LOWER(IFNULL(s.name, ''))) = TRIM(LOWER(IFNULL(p.supplier, '')))
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
            "SELECT COUNT(*) FROM products WHERE type_id IS NULL"
        ).fetchone()[0]
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


def _ensure_record_actuality(connection: sqlite3.Connection) -> None:
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
    n = int(connection.execute("SELECT COUNT(*) FROM record_actuality").fetchone()[0])
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
            "SELECT id, email, password_hash, role, created_at FROM users WHERE email = ?",
            (email.lower(),),
        ).fetchone()


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
            "SELECT id, email, role, created_at FROM users WHERE id = ? AND email = ?",
            (user_id, email.lower())
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
    if user["role"] not in ("manager", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав",
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
            detail="Поле Артикул товара обязательно",
        )
    return normalized


def _require_active_product_type(connection: sqlite3.Connection, type_id: str) -> str:
    tid = type_id.strip()
    row = connection.execute(
        "SELECT id FROM product_types WHERE id = ? AND is_active = 1",
        (tid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Тип товара: недопустимое или неактивное значение",
        )
    return tid


def _require_active_client(connection: sqlite3.Connection, raw: str | None) -> str:
    if raw is None or str(raw).strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поле Клиент обязательно",
        )
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Клиент: недопустимое или неактивное значение",
        )
    return cid


def _optional_active_client(connection: sqlite3.Connection, raw: str | None) -> str | None:
    if raw is None or str(raw).strip() == "":
        return None
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Клиент: недопустимое или неактивное значение",
        )
    return cid


def _optional_active_supplier(connection: sqlite3.Connection, raw: str | None) -> str | None:
    if raw is None or str(raw).strip() == "":
        return None
    sid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM suppliers WHERE id = ? AND is_active = 1",
        (sid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поставщик: недопустимое или неактивное значение",
        )
    return sid


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
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            ORDER BY d.created_at ASC
            """
        ).fetchall()
    return [
        DictionaryBaseItem(
            id=row["id"],
            name=row["name"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            created_by=row["created_by"],
            updated_at=row["updated_at"],
            updated_by=row["updated_by"],
        )
        for row in rows
    ]


def _get_dictionary_item(table_name: str, item_id: str):
    _ensure_dictionary_table(table_name)
    with get_connection() as connection:
        row = connection.execute(
            f"""
            SELECT
                d.id,
                d.name,
                d.is_active,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    return DictionaryBaseItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
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
        except sqlite3.IntegrityError as exc:
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
    fields = []
    values: list[object] = []
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
    values.append(_now())
    fields.append("updated_by_id = ?")
    values.append(editor_id)

    values.append(item_id)
    with get_connection() as connection:
        exists = connection.execute(
            f"SELECT id FROM {table_name} WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        try:
            connection.execute(
                f"UPDATE {table_name} SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Обновлено")


def _delete_dictionary_item(table_name: str, item_id: str):
    _ensure_dictionary_table(table_name)
    with get_connection() as connection:
        exists = connection.execute(
            f"SELECT id FROM {table_name} WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        connection.execute(f"DELETE FROM {table_name} WHERE id = ?", (item_id,))
        connection.commit()
    return MessageResponse(message="Удалено")


def _size_row_to_item(row: sqlite3.Row) -> SizeItem:
    return SizeItem(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _get_size_item(item_id: str) -> SizeItem:
    _ensure_dictionary_table("sizes")
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                d.id,
                d.name,
                d.is_active,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM sizes d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            WHERE d.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
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
) -> SizeListResponse:
    _ensure_dictionary_table("sizes")
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list[object] = []
    if name is not None and str(name).strip():
        conds.append("LOWER(d.name) LIKE LOWER(?)")
        params.append(f"%{str(name).strip()}%")
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
                f"SELECT COUNT(*) FROM sizes d WHERE {where_sql}",
                params,
            ).fetchone()[0]
        )
        rows = connection.execute(
            f"""
            SELECT
                d.id,
                d.name,
                d.is_active,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM sizes d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
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
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Создано")


def _update_size(item_id: str, payload: SizeUpdateRequest, editor_id: str) -> MessageResponse:
    _ensure_dictionary_table("sizes")
    fields: list[str] = []
    values: list[object] = []
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
    values.append(_now())
    fields.append("updated_by_id = ?")
    values.append(editor_id)
    values.append(item_id)
    with get_connection() as connection:
        exists = connection.execute("SELECT id FROM sizes WHERE id = ?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Запись не найдена",
            )
        try:
            connection.execute(
                f"UPDATE sizes SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись с таким названием уже существует",
            ) from exc
    return MessageResponse(message="Обновлено")


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

    token = create_token(user["id"], user["email"], user["role"])
    return LoginResponse(token=token)


@app.get("/auth/me", response_model=MeResponse)
def me(user=Depends(get_current_user)):
    return MeResponse(id=user["id"], email=user["email"], role=user["role"])


@app.get("/users", response_model=list[UserListItem])
def list_users(admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        users = connection.execute(
            "SELECT id, email, role, created_at FROM users ORDER BY created_at ASC"
        ).fetchall()

    return [
        UserListItem(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            created_at=user["created_at"],
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


@app.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(user_id: str, admin=Depends(get_current_admin)):
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить самого себя",
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
                detail="Нельзя удалить администратора",
            )

        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        connection.commit()

    return MessageResponse(message="User deleted")


def _resolve_actuality_filter(
    connection: sqlite3.Connection, actuality_id: str | None
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
) -> DictionaryListResponse:
    _ensure_dictionary_table(table_name)
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if search is not None and str(search).strip():
        conds.append("LOWER(d.name) LIKE LOWER(?)")
        params.append(f"%{str(search).strip()}%")
    if date_from is not None and str(date_from).strip():
        conds.append("substr(d.created_at, 1, 10) >= ?")
        params.append(str(date_from).strip())
    if date_to is not None and str(date_to).strip():
        conds.append("substr(d.created_at, 1, 10) <= ?")
        params.append(str(date_to).strip())
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
                f"SELECT COUNT(*) FROM {table_name} d WHERE {where_sql}",
                params,
            ).fetchone()[0]
        )
        rows = connection.execute(
            f"""
            SELECT
                d.id,
                d.name,
                d.is_active,
                d.created_at,
                d.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
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


@app.get("/system/record-actuality", response_model=list[RecordActualityFilterItem])
def list_record_actuality_filter_items(admin=Depends(get_current_admin)):
    """Системный справочник для фильтра «актуальность» (не отображается в разделе справочников)."""
    _ = admin
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name FROM record_actuality
            ORDER BY sort_order ASC, name COLLATE NOCASE ASC
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
    )


@app.post("/clients", response_model=MessageResponse)
def create_client(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("clients", payload, admin["id"])


@app.get("/clients/{item_id}", response_model=DictionaryBaseItem)
def get_client(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_item("clients", item_id)


@app.patch("/clients/{item_id}", response_model=MessageResponse)
def update_client(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("clients", item_id, payload, admin["id"])


@app.delete("/clients/{item_id}", response_model=MessageResponse)
def delete_client(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("clients", item_id)


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
    )


@app.post("/colors", response_model=MessageResponse)
def create_color(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("colors", payload, admin["id"])


@app.get("/colors/{item_id}", response_model=DictionaryBaseItem)
def get_color(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_item("colors", item_id)


@app.patch("/colors/{item_id}", response_model=MessageResponse)
def update_color(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("colors", item_id, payload, admin["id"])


@app.delete("/colors/{item_id}", response_model=MessageResponse)
def delete_color(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("colors", item_id)


@app.get("/product-types", response_model=DictionaryListResponse)
def list_product_types(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    return _list_dictionary_items_page(
        "product_types",
        page,
        limit,
        search=name,
        actuality_id=actuality_id,
        date_from=df,
        date_to=dt,
        sort=sort,
        sort_columns=CLIENT_LIST_SORT_COLUMNS,
        default_order="d.created_at DESC",
    )


@app.post("/product-types", response_model=MessageResponse)
def create_product_type(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("product_types", payload, admin["id"])


@app.get("/product-types/{item_id}", response_model=DictionaryBaseItem)
def get_product_type(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_item("product_types", item_id)


@app.patch("/product-types/{item_id}", response_model=MessageResponse)
def update_product_type(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("product_types", item_id, payload, admin["id"])


@app.delete("/product-types/{item_id}", response_model=MessageResponse)
def delete_product_type(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("product_types", item_id)


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
    )


@app.post("/suppliers", response_model=MessageResponse)
def create_supplier(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("suppliers", payload, admin["id"])


@app.get("/suppliers/{item_id}", response_model=DictionaryBaseItem)
def get_supplier(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_item("suppliers", item_id)


@app.patch("/suppliers/{item_id}", response_model=MessageResponse)
def update_supplier(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("suppliers", item_id, payload, admin["id"])


@app.delete("/suppliers/{item_id}", response_model=MessageResponse)
def delete_supplier(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("suppliers", item_id)


@app.get("/sizes", response_model=SizeListResponse)
def list_sizes(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    sort: str | None = Query(None),
):
    _ = admin
    return _list_sizes_page(
        page,
        limit,
        name=name,
        actuality_id=actuality_id,
        sort=sort,
    )


@app.post("/sizes", response_model=MessageResponse)
def create_size(payload: SizeCreateRequest, admin=Depends(get_current_admin)):
    return _create_size(payload, admin["id"])


@app.get("/sizes/{item_id}", response_model=SizeItem)
def get_size(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_size_item(item_id)


@app.patch("/sizes/{item_id}", response_model=MessageResponse)
def update_size(item_id: str, payload: SizeUpdateRequest, admin=Depends(get_current_admin)):
    return _update_size(item_id, payload, admin["id"])


@app.delete("/sizes/{item_id}", response_model=MessageResponse)
def delete_size(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("sizes", item_id)


@app.get("/products", response_model=ProductListResponse)
def list_products(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    sku: str | None = Query(None),
    type_id: str | None = Query(None),
    client_id: str | None = Query(None),
    supplier_id: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
):
    _ = admin
    df = _normalize_date_yyyy_mm_dd(date_from, "date_from")
    dt = _normalize_date_yyyy_mm_dd(date_to, "date_to")
    offset = (page - 1) * limit
    conds = ["1=1"]
    params: list = []
    if name is not None and str(name).strip():
        conds.append("LOWER(p.name) LIKE LOWER(?)")
        params.append(f"%{str(name).strip()}%")
    if sku is not None and str(sku).strip():
        conds.append("LOWER(p.sku) LIKE LOWER(?)")
        params.append(f"%{str(sku).strip()}%")
    if type_id is not None and str(type_id).strip():
        conds.append("p.type_id = ?")
        params.append(str(type_id).strip())
    if client_id is not None and str(client_id).strip():
        conds.append("p.client_id = ?")
        params.append(str(client_id).strip())
    if supplier_id is not None and str(supplier_id).strip():
        conds.append("p.supplier_id = ?")
        params.append(str(supplier_id).strip())
    if df is not None:
        conds.append("substr(p.created_at, 1, 10) >= ?")
        params.append(df)
    if dt is not None:
        conds.append("substr(p.created_at, 1, 10) <= ?")
        params.append(dt)
    join_sql = """
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
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
                f"SELECT COUNT(*) {join_sql} WHERE {where_sql}",
                params,
            ).fetchone()[0]
        )
        rows = connection.execute(
            f"""
            SELECT
                p.id,
                p.name,
                p.type_id,
                pt.name AS type_name,
                p.sku,
                p.client_id,
                c.name AS client_name,
                p.supplier_id,
                s.name AS supplier_name,
                p.image_url,
                p.is_active,
                p.created_at,
                p.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
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
                sku=row["sku"],
                client_id=row["client_id"],
                client_name=row["client_name"],
                supplier_id=row["supplier_id"],
                supplier_name=row["supplier_name"],
                image_url=row["image_url"],
                is_active=bool(row["is_active"]),
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
def get_product(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                p.id,
                p.name,
                p.type_id,
                pt.name AS type_name,
                p.sku,
                p.client_id,
                c.name AS client_name,
                p.supplier_id,
                s.name AS supplier_name,
                p.image_url,
                p.is_active,
                p.created_at,
                p.updated_at,
                creator.email AS created_by,
                editor.email AS updated_by
            FROM products p
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
            WHERE p.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Товар не найден")
    return ProductItem(
        id=row["id"],
        name=row["name"],
        type_id=row["type_id"],
        type_name=row["type_name"],
        sku=row["sku"],
        client_id=row["client_id"],
        client_name=row["client_name"],
        supplier_id=row["supplier_id"],
        supplier_name=row["supplier_name"],
        image_url=row["image_url"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


@app.post("/products", response_model=MessageResponse)
async def create_product(
    name: str = Form(...),
    type_id: str = Form(...),
    sku: str = Form(...),
    client_id: str | None = Form(default=None),
    supplier_id: str | None = Form(default=None),
    is_active: bool = Form(default=True),
    image: UploadFile | None = File(default=None),
    admin=Depends(get_current_admin),
):
    image_url: str | None = None
    if image and image.filename:
        ext = _product_image_extension(image.content_type, image.filename)
        if not ext:
            raise HTTPException(
                status_code=400,
                detail="Допустимы изображения: jpg, png, heic",
            )
        filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / filename
        file_path.write_bytes(await image.read())
        image_url = f"/uploads/{filename}"

    with get_connection() as connection:
        tid = _require_active_product_type(connection, type_id)
        cid = _require_active_client(connection, client_id)
        sid = _optional_active_supplier(connection, supplier_id)
        try:
            connection.execute(
                """
                INSERT INTO products (
                    id, name, type_id, client_id, supplier_id, sku, image_url,
                    is_active, created_at, creator_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    _normalize_name(name),
                    tid,
                    cid,
                    sid,
                    _normalize_sku(sku),
                    image_url,
                    1 if is_active else 0,
                    _now(),
                    admin["id"],
                ),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=400,
                detail="SKU уже существует",
            ) from exc
    return MessageResponse(message="Создано")


@app.patch("/products/{item_id}", response_model=MessageResponse)
async def update_product(
    item_id: str,
    name: str | None = Form(default=None),
    type_id: str | None = Form(default=None),
    sku: str | None = Form(default=None),
    client_id: str | None = Form(default=None),
    supplier_id: str | None = Form(default=None),
    is_active: bool | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    admin=Depends(get_current_admin),
):
    fields = []
    values: list[object] = []
    if name is not None:
        fields.append("name = ?")
        values.append(_normalize_name(name))
    if image is not None and image.filename:
        ext = _product_image_extension(image.content_type, image.filename)
        if not ext:
            raise HTTPException(
                status_code=400,
                detail="Допустимы изображения: jpg, png, heic",
            )
        filename = f"{uuid4()}{ext}"
        file_path = UPLOADS_DIR / filename
        file_path.write_bytes(await image.read())
        fields.append("image_url = ?")
        values.append(f"/uploads/{filename}")

    with get_connection() as connection:
        exists = connection.execute(
            "SELECT id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Товар не найден")

        if type_id is not None:
            tid = _require_active_product_type(connection, type_id)
            fields.append("type_id = ?")
            values.append(tid)
        if sku is not None:
            fields.append("sku = ?")
            values.append(_normalize_sku(sku))
        if client_id is not None:
            if str(client_id).strip() == "":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Поле Клиент обязательно",
                )
            cid = _require_active_client(connection, client_id)
            fields.append("client_id = ?")
            values.append(cid)
        if supplier_id is not None:
            if str(supplier_id).strip() == "":
                fields.append("supplier_id = ?")
                values.append(None)
            else:
                sid = _optional_active_supplier(connection, supplier_id)
                fields.append("supplier_id = ?")
                values.append(sid)
        if is_active is not None:
            fields.append("is_active = ?")
            values.append(1 if is_active else 0)

        if not fields:
            raise HTTPException(status_code=400, detail="Нет данных для обновления")
        fields.append("updated_at = ?")
        values.append(_now())
        fields.append("updated_by_id = ?")
        values.append(admin["id"])
        values.append(item_id)

        try:
            connection.execute(
                f"UPDATE products SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=400,
                detail="SKU уже существует",
            ) from exc
    return MessageResponse(message="Обновлено")


@app.delete("/products/{item_id}", response_model=MessageResponse)
def delete_product(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        exists = connection.execute(
            "SELECT id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        connection.execute("DELETE FROM products WHERE id = ?", (item_id,))
        connection.commit()
    return MessageResponse(message="Удалено")
