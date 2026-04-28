from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3
from uuid import uuid4

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field


JWT_SECRET = "replace-this-secret-in-production"
JWT_ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = 60
DB_PATH = Path(__file__).parent / "auth.db"
UPLOADS_DIR = Path(__file__).parent / "uploads"
DICTIONARY_TABLES = {"clients", "colors", "sizes"}
PRODUCT_TYPES = ("одежда", "техника")

bearer_scheme = HTTPBearer()

app = FastAPI(title="Auth Module API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    creator: str | None
    updated_at: str | None = None
    editor: str | None = None


class DictionaryCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_active: bool = False


class DictionaryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None


class ProductItem(BaseModel):
    id: str
    name: str
    type: str
    sku: str
    supplier: str | None
    image_url: str | None
    is_active: bool
    created_at: str
    creator: str | None
    updated_at: str | None = None
    editor: str | None = None


class ProductCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    type: str
    sku: str = Field(min_length=1)
    supplier: str | None = None
    is_active: bool = False


class ProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type: str | None = None
    sku: str | None = Field(default=None, min_length=1)
    supplier: str | None = None
    image_url: str | None = None
    is_active: bool | None = None


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
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                sku TEXT UNIQUE NOT NULL,
                supplier TEXT,
                image_url TEXT,
                is_active INTEGER NOT NULL DEFAULT 0,
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
            "products",
            {
                "creator_id": "TEXT",
                "updated_at": "TEXT",
                "updated_by_id": "TEXT",
            },
        )
        connection.execute("UPDATE products SET type = 'одежда' WHERE type = 'clothes'")
        connection.execute("UPDATE products SET type = 'техника' WHERE type = 'electronics'")
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


def _validate_product_type(product_type: str) -> str:
    normalized = product_type.strip().lower()
    if normalized not in PRODUCT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Тип должен быть: одежда или техника",
        )
    return normalized


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
                creator.email AS creator,
                editor.email AS editor
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
            creator=row["creator"],
            updated_at=row["updated_at"],
            editor=row["editor"],
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
                creator.email AS creator,
                editor.email AS editor
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
        creator=row["creator"],
        updated_at=row["updated_at"],
        editor=row["editor"],
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
    if payload.role not in ("user", "manager"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Можно назначить только role user или manager",
        )

    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить роль самому себе",
        )

    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден",
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
            "SELECT id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден",
            )

        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        connection.commit()

    return MessageResponse(message="User deleted")


@app.get("/clients", response_model=list[DictionaryBaseItem])
def list_clients(admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_items("clients")


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


@app.get("/colors", response_model=list[DictionaryBaseItem])
def list_colors(admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_items("colors")


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


@app.get("/sizes", response_model=list[DictionaryBaseItem])
def list_sizes(admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_items("sizes")


@app.post("/sizes", response_model=MessageResponse)
def create_size(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return _create_dictionary_item("sizes", payload, admin["id"])


@app.get("/sizes/{item_id}", response_model=DictionaryBaseItem)
def get_size(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _get_dictionary_item("sizes", item_id)


@app.patch("/sizes/{item_id}", response_model=MessageResponse)
def update_size(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return _update_dictionary_item("sizes", item_id, payload, admin["id"])


@app.delete("/sizes/{item_id}", response_model=MessageResponse)
def delete_size(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return _delete_dictionary_item("sizes", item_id)


@app.get("/products", response_model=list[ProductItem])
def list_products(admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                p.id,
                p.name,
                p.type,
                p.sku,
                p.supplier,
                p.image_url,
                p.is_active,
                p.created_at,
                p.updated_at,
                creator.email AS creator,
                editor.email AS editor
            FROM products p
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
            ORDER BY p.created_at ASC
            """
        ).fetchall()
    return [
        ProductItem(
            id=row["id"],
            name=row["name"],
            type=row["type"],
            sku=row["sku"],
            supplier=row["supplier"],
            image_url=row["image_url"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            creator=row["creator"],
            updated_at=row["updated_at"],
            editor=row["editor"],
        )
        for row in rows
    ]


@app.get("/products/{item_id}", response_model=ProductItem)
def get_product(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                p.id,
                p.name,
                p.type,
                p.sku,
                p.supplier,
                p.image_url,
                p.is_active,
                p.created_at,
                p.updated_at,
                creator.email AS creator,
                editor.email AS editor
            FROM products p
            LEFT JOIN users creator ON creator.id = p.creator_id
            LEFT JOIN users editor ON editor.id = p.updated_by_id
            WHERE p.id = ?
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return ProductItem(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        sku=row["sku"],
        supplier=row["supplier"],
        image_url=row["image_url"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        creator=row["creator"],
        updated_at=row["updated_at"],
        editor=row["editor"],
    )


@app.post("/products", response_model=MessageResponse)
async def create_product(
    name: str = Form(...),
    type: str = Form(...),
    sku: str = Form(...),
    supplier: str | None = Form(default=None),
    is_active: bool = Form(default=False),
    image: UploadFile | None = File(default=None),
    admin=Depends(get_current_admin),
):
    product_payload = ProductCreateRequest(
        name=name,
        type=_validate_product_type(type),
        sku=sku,
        supplier=supplier,
        is_active=is_active,
    )

    image_url: str | None = None
    if image:
        if not image.content_type or image.content_type not in ("image/jpeg", "image/png"):
            raise HTTPException(status_code=400, detail="Поддерживаются только jpg и png")
        extension = ".png" if image.content_type == "image/png" else ".jpg"
        filename = f"{uuid4()}{extension}"
        file_path = UPLOADS_DIR / filename
        file_path.write_bytes(await image.read())
        image_url = f"/uploads/{filename}"

    with get_connection() as connection:
        try:
            connection.execute(
                """
                INSERT INTO products (id, name, type, sku, supplier, image_url, is_active, created_at, creator_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    _normalize_name(product_payload.name),
                    product_payload.type,
                    _normalize_sku(product_payload.sku),
                    (product_payload.supplier or "").strip() or None,
                    image_url,
                    1 if product_payload.is_active else 0,
                    _now(),
                    admin["id"],
                ),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=400,
                detail="Товар с таким артикулом уже существует",
            ) from exc
    return MessageResponse(message="Создано")


@app.patch("/products/{item_id}", response_model=MessageResponse)
async def update_product(
    item_id: str,
    name: str | None = Form(default=None),
    type: str | None = Form(default=None),
    sku: str | None = Form(default=None),
    supplier: str | None = Form(default=None),
    is_active: bool | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    admin=Depends(get_current_admin),
):
    fields = []
    values: list[object] = []
    if name is not None:
        fields.append("name = ?")
        values.append(_normalize_name(name))
    if type is not None:
        fields.append("type = ?")
        values.append(_validate_product_type(type))
    if sku is not None:
        fields.append("sku = ?")
        values.append(_normalize_sku(sku))
    if supplier is not None:
        fields.append("supplier = ?")
        values.append(supplier.strip() or None)
    if image is not None:
        if not image.content_type or image.content_type not in ("image/jpeg", "image/png"):
            raise HTTPException(status_code=400, detail="Поддерживаются только jpg и png")
        extension = ".png" if image.content_type == "image/png" else ".jpg"
        filename = f"{uuid4()}{extension}"
        file_path = UPLOADS_DIR / filename
        file_path.write_bytes(await image.read())
        fields.append("image_url = ?")
        values.append(f"/uploads/{filename}")
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
    with get_connection() as connection:
        exists = connection.execute(
            "SELECT id FROM products WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        try:
            connection.execute(
                f"UPDATE products SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=400,
                detail="Товар с таким артикулом уже существует",
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
