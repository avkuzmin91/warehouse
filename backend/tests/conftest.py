"""Общий конфиг для интеграционных тестов.

Требует переменной окружения DATABASE_URL (PostgreSQL).
Если DATABASE_URL не задан — интеграционные тесты пропускаются.
"""
from __future__ import annotations

import os
import uuid

import pytest

# Пропускаем весь модуль, если нет БД
if not os.environ.get("DATABASE_URL"):
    pytest.skip(
        "Нужен DATABASE_URL (PostgreSQL) для интеграционных тестов",
        allow_module_level=True,
    )

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user


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


@pytest.fixture
def admin_client():
    """TestClient с авторизацией администратора (dependency override)."""
    app.dependency_overrides[get_current_user] = lambda: _admin_user_row()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def manager_client():
    """TestClient с авторизацией менеджера (dependency override)."""
    app.dependency_overrides[get_current_user] = lambda: _manager_user_row()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def warehouse_client():
    """TestClient с авторизацией кладовщика (dependency override)."""
    app.dependency_overrides[get_current_user] = lambda: _warehouse_user_row()
    with TestClient(app) as c:
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
