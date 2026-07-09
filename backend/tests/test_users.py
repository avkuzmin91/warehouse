"""Интеграционные тесты модуля users: RBAC (admin-only), список, смена роли,
привязка клиента, отключение/восстановление доступа.

Требует DATABASE_URL. БД общая (dev): тестовые пользователи создаются с
uuid-суффиксом в email и удаляются в teardown фикстуры.
Создания пользователя в модуле нет — учётки появляются через /auth/register,
поэтому тестовые строки заводятся напрямую в БД.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from security import FORBIDDEN_DETAIL
from tests.conftest import admin_client, cleanup_client, make_client_id, manager_client  # noqa: F401

ADMIN_ID = "test-admin-id"  # id админа из conftest._admin_user_row
MANAGER_ID = "test-manager-id"  # id менеджера из conftest._manager_user_row


def _insert_user(role: str = "user", client_id: str | None = None) -> dict:
    uid = str(uuid.uuid4())
    email = f"users-test-{uid[:8]}@test.com"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, client_id, created_at) "
            "VALUES (?, ?, 'x', ?, ?, ?)",
            (uid, email, role, client_id, datetime.now(UTC).isoformat()),
        )
        conn.commit()
    return {"id": uid, "email": email}


def _cleanup_user(uid: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()


@pytest.fixture
def user_factory():
    created: list[str] = []

    def make(role: str = "user", client_id: str | None = None) -> dict:
        u = _insert_user(role, client_id)
        created.append(u["id"])
        return u

    yield make
    for uid in created:
        _cleanup_user(uid)


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _find(admin_client, uid: str) -> dict | None:
    r = admin_client.get("/users")
    assert r.status_code == 200, r.text
    return next((u for u in r.json() if u["id"] == uid), None)


# ---------------------------------------------------------------- RBAC


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
    ("role", "cid"),
    [
        ("client", "client-uuid-1"),
        ("user", None),
        ("warehouse_manager", None),
        ("shift_supervisor", None),
        ("warehouse_head", None),
    ],
)
def test_users_endpoints_forbidden_low_roles(role: str, cid: str | None):
    """Роли ниже менеджера не имеют доступа ни к одному эндпоинту модуля."""
    app.dependency_overrides[get_current_user] = _user_row(role, client_id=cid)
    c = TestClient(app)
    headers = {"Authorization": "Bearer test-token"}

    for method, path, body in [
        ("GET", "/users", None),
        ("PATCH", "/users/some-id/role", {"role": "warehouse_manager"}),
        ("PATCH", "/users/some-id/client", {"client_id": None}),
        ("PATCH", "/users/some-id", {"is_deleted": True}),
        ("DELETE", "/users/some-id", None),
    ]:
        r = c.request(method, path, json=body, headers=headers)
        assert r.status_code == 403, f"{method} {path}: {r.status_code} {r.text}"
        assert r.json()["detail"] == FORBIDDEN_DETAIL


def test_manager_forbidden_on_destructive_endpoints():
    """Менеджер ведёт роли/привязку, но удаление/восстановление — только админ."""
    app.dependency_overrides[get_current_user] = _user_row("manager")
    c = TestClient(app)
    headers = {"Authorization": "Bearer test-token"}

    for method, path, body in [
        ("PATCH", "/users/some-id", {"is_deleted": True}),
        ("DELETE", "/users/some-id", None),
    ]:
        r = c.request(method, path, json=body, headers=headers)
        assert r.status_code == 403, f"{method} {path}: {r.status_code} {r.text}"
        assert r.json()["detail"] == FORBIDDEN_DETAIL


def test_users_unauthenticated():
    app.dependency_overrides.clear()
    assert TestClient(app).get("/users").status_code == 401


# ---------------------------------------------------------------- список


def test_list_users_shows_user_with_client_binding(admin_client, user_factory, client_id):
    u = user_factory("client", client_id)
    row = _find(admin_client, u["id"])
    assert row is not None
    assert row["email"] == u["email"]
    assert row["role"] == "client"
    assert row["client_id"] == client_id
    assert row["client_name"] and row["client_name"].startswith("TestClient-")


def test_list_users_hides_deleted(admin_client, user_factory):
    u = user_factory("user")
    with get_connection() as conn:
        conn.execute("UPDATE users SET is_deleted = 1 WHERE id = ?", (u["id"],))
        conn.commit()
    assert _find(admin_client, u["id"]) is None


# ---------------------------------------------------------------- смена роли


def test_update_role_happy_path(admin_client, user_factory):
    u = user_factory("user")
    r = admin_client.patch(f"/users/{u['id']}/role", json={"role": "manager"})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Роль обновлена"
    assert _find(admin_client, u["id"])["role"] == "manager"


def test_update_role_from_client_clears_binding(admin_client, user_factory, client_id):
    u = user_factory("client", client_id)
    r = admin_client.patch(f"/users/{u['id']}/role", json={"role": "warehouse_manager"})
    assert r.status_code == 200, r.text
    row = _find(admin_client, u["id"])
    assert row["role"] == "warehouse_manager"
    assert row["client_id"] is None


@pytest.mark.parametrize("bad_role", ["superadmin", "admin", ""])
def test_update_role_rejects_unknown_role(admin_client, user_factory, bad_role: str):
    u = user_factory("user")
    r = admin_client.patch(f"/users/{u['id']}/role", json={"role": bad_role})
    assert r.status_code == 400
    assert r.json()["detail"].startswith("Можно назначить роль")


def test_update_role_self_forbidden(admin_client):
    r = admin_client.patch(f"/users/{ADMIN_ID}/role", json={"role": "manager"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя изменить роль самому себе"


def test_update_role_of_admin_forbidden(admin_client, user_factory):
    other_admin = user_factory("admin")
    r = admin_client.patch(f"/users/{other_admin['id']}/role", json={"role": "manager"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя изменить роль администратора"


def test_update_role_unknown_user_404(admin_client):
    r = admin_client.patch(f"/users/{uuid.uuid4()}/role", json={"role": "manager"})
    assert r.status_code == 404
    assert r.json()["detail"] == "Пользователь не найден"


def test_update_role_revokes_sessions(admin_client, user_factory):
    u = user_factory("user")
    session_id = _insert_session(u["id"])
    r = admin_client.patch(f"/users/{u['id']}/role", json={"role": "manager"})
    assert r.status_code == 200, r.text
    assert _session_revoked(session_id)


# ---------------------------------------------------------------- менеджер: выдача ролей


def test_manager_can_list_users(manager_client, user_factory):
    u = user_factory("user")
    assert _find(manager_client, u["id"]) is not None


def test_manager_assigns_non_privileged_role(manager_client, user_factory):
    u = user_factory("user")
    r = manager_client.patch(f"/users/{u['id']}/role", json={"role": "warehouse_manager"})
    assert r.status_code == 200, r.text
    assert _find(manager_client, u["id"])["role"] == "warehouse_manager"


def test_manager_cannot_grant_manager_role(manager_client, user_factory):
    u = user_factory("user")
    r = manager_client.patch(f"/users/{u['id']}/role", json={"role": "manager"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Роль «Менеджер» может назначить только администратор"


def test_manager_cannot_change_manager_role(manager_client, user_factory):
    other_manager = user_factory("manager")
    r = manager_client.patch(f"/users/{other_manager['id']}/role", json={"role": "user"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Изменить роль менеджера может только администратор"


def test_manager_cannot_change_admin_role(manager_client, user_factory):
    other_admin = user_factory("admin")
    r = manager_client.patch(f"/users/{other_admin['id']}/role", json={"role": "user"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя изменить роль администратора"


def test_manager_can_bind_client(manager_client, user_factory, client_id):
    u = user_factory("client")
    r = manager_client.patch(f"/users/{u['id']}/client", json={"client_id": client_id})
    assert r.status_code == 200, r.text
    assert _find(manager_client, u["id"])["client_id"] == client_id


# ---------------------------------------------------------------- привязка клиента


def test_assign_and_clear_client_binding(admin_client, user_factory, client_id):
    u = user_factory("client")
    r = admin_client.patch(f"/users/{u['id']}/client", json={"client_id": client_id})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Привязка обновлена"
    assert _find(admin_client, u["id"])["client_id"] == client_id

    r2 = admin_client.patch(f"/users/{u['id']}/client", json={"client_id": None})
    assert r2.status_code == 200, r2.text
    assert _find(admin_client, u["id"])["client_id"] is None


def test_assign_client_rejects_non_client_role(admin_client, user_factory, client_id):
    u = user_factory("manager")
    r = admin_client.patch(f"/users/{u['id']}/client", json={"client_id": client_id})
    assert r.status_code == 400
    assert "только для пользователей с ролью" in r.json()["detail"]


def test_assign_client_rejects_unknown_client(admin_client, user_factory):
    u = user_factory("client")
    r = admin_client.patch(f"/users/{u['id']}/client", json={"client_id": str(uuid.uuid4())})
    assert r.status_code == 400
    assert r.json()["detail"] == "Клиент: недопустимое или неактивное значение"


def test_assign_client_rejects_inactive_client(admin_client, user_factory, client_id):
    u = user_factory("client")
    with get_connection() as conn:
        conn.execute("UPDATE clients SET is_active = 0 WHERE id = ?", (client_id,))
        conn.commit()
    r = admin_client.patch(f"/users/{u['id']}/client", json={"client_id": client_id})
    assert r.status_code == 400
    assert r.json()["detail"] == "Клиент: недопустимое или неактивное значение"


def test_assign_client_self_forbidden(admin_client, client_id):
    r = admin_client.patch(f"/users/{ADMIN_ID}/client", json={"client_id": client_id})
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя изменить привязку самому себе"


def test_assign_client_unknown_user_404(admin_client, client_id):
    r = admin_client.patch(f"/users/{uuid.uuid4()}/client", json={"client_id": client_id})
    assert r.status_code == 404


# ---------------------------------------------------------------- отключение доступа


def _insert_session(user_id: str) -> str:
    sid = str(uuid.uuid4())
    now = datetime.now(UTC)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at, revoked_at, created_at) "
            "VALUES (?, ?, ?, ?, NULL, ?)",
            (sid, user_id, f"test-hash-{sid}",
             (now + timedelta(days=1)).isoformat(), now.isoformat()),
        )
        conn.commit()
    return sid


def _session_revoked(session_id: str) -> bool:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT revoked_at FROM auth_sessions WHERE id = ?", (session_id,)
        ).fetchone()
    return bool(row and row["revoked_at"])


def test_delete_user_soft_deletes_and_revokes_sessions(admin_client, user_factory, client_id):
    u = user_factory("client", client_id)
    session_id = _insert_session(u["id"])

    r = admin_client.delete(f"/users/{u['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Пользователь удалён"

    # Мягкое удаление: is_deleted=1, пользователь скрыт из списка, сессии отозваны.
    # Роль и привязка сохраняются — восстановление возвращает пользователя как был.
    assert _find(admin_client, u["id"]) is None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT role, client_id, is_deleted, deleted_at, deleted_by_id FROM users WHERE id = ?",
            (u["id"],),
        ).fetchone()
    assert row["is_deleted"] == 1
    assert row["deleted_at"]
    assert row["deleted_by_id"] == ADMIN_ID
    assert row["role"] == "client"
    assert row["client_id"] == client_id
    assert _session_revoked(session_id)


def test_delete_then_restore_roundtrip(admin_client, user_factory):
    u = user_factory("manager")
    r = admin_client.delete(f"/users/{u['id']}")
    assert r.status_code == 200, r.text
    assert _find(admin_client, u["id"]) is None

    r = admin_client.patch(f"/users/{u['id']}", json={"is_deleted": False})
    assert r.status_code == 200, r.text
    row = _find(admin_client, u["id"])
    assert row is not None
    assert row["role"] == "manager"


def test_delete_self_forbidden(admin_client):
    r = admin_client.delete(f"/users/{ADMIN_ID}")
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя удалить самого себя"


def test_delete_admin_forbidden(admin_client, user_factory):
    other_admin = user_factory("admin")
    r = admin_client.delete(f"/users/{other_admin['id']}")
    assert r.status_code == 400
    assert r.json()["detail"] == "Нельзя удалить администратора"


def test_delete_unknown_user_404(admin_client):
    r = admin_client.delete(f"/users/{uuid.uuid4()}")
    assert r.status_code == 404


def test_patch_is_deleted_true_same_as_delete(admin_client, user_factory):
    u = user_factory("manager")
    r = admin_client.patch(f"/users/{u['id']}", json={"is_deleted": True})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Пользователь удалён"
    assert _find(admin_client, u["id"]) is None


def test_patch_restore_deleted_user(admin_client, user_factory):
    u = user_factory("user")
    with get_connection() as conn:
        conn.execute("UPDATE users SET is_deleted = 1 WHERE id = ?", (u["id"],))
        conn.commit()
    assert _find(admin_client, u["id"]) is None

    r = admin_client.patch(f"/users/{u['id']}", json={"is_deleted": False})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Восстановлено"
    assert _find(admin_client, u["id"]) is not None


def test_patch_restore_not_deleted_user_is_noop(admin_client, user_factory):
    u = user_factory("user")
    r = admin_client.patch(f"/users/{u['id']}", json={"is_deleted": False})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "Восстановлено"


def test_patch_restore_unknown_user_404(admin_client):
    r = admin_client.patch(f"/users/{uuid.uuid4()}", json={"is_deleted": False})
    assert r.status_code == 404
