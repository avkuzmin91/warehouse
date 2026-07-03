"""Общий конфиг для интеграционных тестов.

Требует переменной окружения DATABASE_URL (PostgreSQL).
Если DATABASE_URL не задан — интеграционные тесты пропускаются.

Изоляция: по умолчанию прогон создаёт СВОЮ одноразовую БД на том же сервере
(<dbname>_test_<hex>), накатывает alembic upgrade head и удаляет её в конце.
Это делает результат воспроизводимым (общая dev-БД замусорена и флачит list-тесты)
и позволяет параллельные прогоны (в т.ч. pytest -n: каждый worker — своя БД).
TEST_DB_ISOLATION=0 — гонять прямо в DATABASE_URL (старое поведение).
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

# Пропускаем весь модуль, если нет БД
if not os.environ.get("DATABASE_URL"):
    pytest.skip(
        "Нужен DATABASE_URL (PostgreSQL) для интеграционных тестов",
        allow_module_level=True,
    )

_TEST_DB_NAME: str | None = None
_ADMIN_URL: str | None = None


# Ключ-маркер в env: conftest импортируется ДВАЖДЫ (как pytest-plugin и как
# tests.conftest из test-файлов) — без маркера изоляция создала бы две БД и
# одна осталась бы висеть. Для pytest -n ключ включает id воркера: каждый
# воркер xdist — отдельный процесс со своим PYTEST_XDIST_WORKER → своя БД.
_MARKER = f"WMS_TEST_DB_NAME_{os.environ.get('PYTEST_XDIST_WORKER', 'main')}"


def _isolate_database() -> None:
    """Создать одноразовую БД и перенаправить DATABASE_URL до импорта app/dbconn."""
    global _TEST_DB_NAME, _ADMIN_URL
    if os.environ.get("TEST_DB_ISOLATION", "1") == "0":
        return
    if os.environ.get(_MARKER):
        # Уже изолировано вторым экземпляром модуля в этом же процессе.
        _TEST_DB_NAME = os.environ[_MARKER]
        _ADMIN_URL = os.environ[f"{_MARKER}_ADMIN_URL"]
        return
    import psycopg

    base = os.environ["DATABASE_URL"]
    parts = urlsplit(base)
    src_db = (parts.path.lstrip("/") or "postgres")[:40]
    _TEST_DB_NAME = f"{src_db}_test_{uuid.uuid4().hex[:8]}"
    _ADMIN_URL = base
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{_TEST_DB_NAME}"')
    os.environ["DATABASE_URL"] = urlunsplit(parts._replace(path=f"/{_TEST_DB_NAME}"))
    os.environ[_MARKER] = _TEST_DB_NAME
    os.environ[f"{_MARKER}_ADMIN_URL"] = _ADMIN_URL

    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(cfg, "head")


_isolate_database()

from fastapi.testclient import TestClient

# Фоновый планировщик ЗП не должен писать в тестовую БД при старте lifespan.
os.environ["SALARY_SCHEDULER"] = "0"

from app import app
from dbconn import close_pool, get_connection
from modules.auth.service import get_current_user


def pytest_sessionfinish(session, exitstatus):
    """Удалить одноразовую БД (FORCE рвёт оставшиеся коннекты пула)."""
    if not _TEST_DB_NAME:
        return
    import psycopg

    close_pool()
    with psycopg.connect(_ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{_TEST_DB_NAME}" WITH (FORCE)')


def _admin_user_row():
    return {
        "id": "test-admin-id",
        "email": "admin@test.com",
        "role": "admin",
        "created_at": "2020-01-01T00:00:00",
        "client_id": None,
    }


def _manager_user_row():
    return {
        "id": "test-manager-id",
        "email": "mgr@test.com",
        "role": "manager",
        "created_at": "2020-01-01T00:00:00",
        "client_id": None,
    }


def _warehouse_user_row():
    return {
        "id": "test-warehouse-id",
        "email": "warehouse@test.com",
        "role": "warehouse_manager",
        "created_at": "2020-01-01T00:00:00",
        "client_id": None,
    }


def _shift_supervisor_user_row():
    return {
        "id": "test-shift-supervisor-id",
        "email": "shift@test.com",
        "role": "shift_supervisor",
        "created_at": "2020-01-01T00:00:00",
        "client_id": None,
    }


def _warehouse_head_user_row():
    return {
        "id": "test-warehouse-head-id",
        "email": "whhead@test.com",
        "role": "warehouse_head",
        "created_at": "2020-01-01T00:00:00",
        "client_id": None,
    }


class _RoleClient(TestClient):
    """TestClient, привязанный к роли.

    Переустанавливает свой override get_current_user перед каждым запросом
    (все HTTP-методы httpx проходят через request()). Это позволяет держать
    в одном тесте сразу несколько клиентов с разными ролями — иначе они
    перетирали бы единый app.dependency_overrides на общем app.
    """

    def __init__(self, app, user_row: dict):
        super().__init__(app)
        self._user_row = user_row

    def request(self, *args, **kwargs):
        app.dependency_overrides[get_current_user] = lambda: dict(self._user_row)
        return super().request(*args, **kwargs)


@pytest.fixture
def admin_client():
    """TestClient с авторизацией администратора (dependency override)."""
    with _RoleClient(app, _admin_user_row()) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def manager_client():
    """TestClient с авторизацией менеджера (dependency override)."""
    with _RoleClient(app, _manager_user_row()) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def warehouse_client():
    """TestClient с авторизацией кладовщика (dependency override)."""
    with _RoleClient(app, _warehouse_user_row()) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def shift_supervisor_client():
    """TestClient с авторизацией начальника смены (dependency override)."""
    with _RoleClient(app, _shift_supervisor_user_row()) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def warehouse_head_client():
    """TestClient с авторизацией начальника склада (dependency override)."""
    with _RoleClient(app, _warehouse_head_user_row()) as c:
        yield c
    app.dependency_overrides.clear()


def make_client_id() -> str:
    """Создать тестового клиента в БД, вернуть его ID."""
    cid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO clients (id, name, is_active, created_at) VALUES (?, ?, 1, NOW())",
            (cid, f"TestClient-{cid[:8]}"),
        )
        conn.commit()
    return cid


def cleanup_client(cid: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM clients WHERE id = ?", (cid,))
        conn.commit()


def seed_storage_good(
    client_id: str,
    *,
    product_id: str,
    product_name: str = "Seed Product",
    product_sku: str = "SEED-001",
    color_id: str | None = None,
    color_name: str | None = None,
    size_id: str | None = None,
    size_name: str | None = None,
    qty: int,
) -> None:
    """Засеять годный остаток «На хранении» по позиции (журнальное движение intake→storage).

    Нужен тестам, которые переводят отгрузку в план: с гейтом покрытия остатком
    позиция должна реально лежать на складе."""
    from modules.balances.service import insert_inventory_move

    with get_connection() as conn:
        insert_inventory_move(
            conn,
            product_id=product_id, product_name=product_name, product_sku=product_sku,
            color_id=color_id, color_name=color_name,
            size_id=size_id, size_name=size_name,
            client_id=client_id, client_name="Test Client",
            from_op="intake", to_op="storage",
            from_quality="good", to_quality="good",
            from_zone_id=None, from_zone_name=None,
            to_zone_id=None, to_zone_name=None,
            qty=qty, user_id="test-admin-id",
        )
        conn.commit()
