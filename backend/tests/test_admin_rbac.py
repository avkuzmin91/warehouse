"""Проверка RBAC: админские маршруты отдают 403 до обращения к бизнес-логике."""

from __future__ import annotations

import os

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip(
        "Нужен DATABASE_URL (PostgreSQL) для импорта приложения и TestClient",
        allow_module_level=True,
    )

from fastapi.testclient import TestClient

from app import app
from modules.auth.service import get_current_user
from security import FORBIDDEN_DETAIL


def _user_row(role: str, *, client_id: str | None = None):
    def _override():
        return {
            "id": "test-user-id",
            "email": "t@example.com",
            "role": role,
            "created_at": "2020-01-01T00:00:00",
            "client_id": client_id,
        }

    return _override


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("role", "client_id"),
    [
        ("client", "client-uuid-1"),
        ("user", None),
        ("warehouse_manager", None),
        ("shift_supervisor", None),
    ],
)
def test_get_users_forbidden_non_admin(role: str, client_id: str | None):
    app.dependency_overrides[get_current_user] = _user_row(role, client_id=client_id)
    r = TestClient(app).get("/users", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 403
    assert r.json()["detail"] == FORBIDDEN_DETAIL


def test_get_users_allowed_for_manager():
    # Менеджер ведёт список пользователей (роли/клиент/отображаемое имя), удаление — admin-only.
    app.dependency_overrides[get_current_user] = _user_row("manager")
    r = TestClient(app).get("/users", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 200


@pytest.mark.parametrize("role", ["client", "user"])
def test_get_clients_forbidden_non_admin(role: str):
    app.dependency_overrides[get_current_user] = _user_row(
        role,
        client_id="client-uuid-1" if role == "client" else None,
    )
    r = TestClient(app).get("/clients", headers={"Authorization": "Bearer test-token"})
    assert r.status_code == 403
    assert r.json()["detail"] == FORBIDDEN_DETAIL


def test_get_analytics_movement_removed():
    app.dependency_overrides[get_current_user] = _user_row("client", client_id="client-uuid-1")
    r = TestClient(app).get(
        "/analytics/movement",
        headers={"Authorization": "Bearer test-token"},
    )
    assert r.status_code == 410
    assert r.json()["detail"] == "Аналитика отключена"
