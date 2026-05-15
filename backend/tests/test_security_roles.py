"""Unit-тесты RBAC без импорта приложения и без БД."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from security import (
    FORBIDDEN_DETAIL,
    ensure_admin_account,
    ensure_client_portal_account,
    ensure_manager_staff,
)


def test_ensure_admin_rejects_non_admin():
    with pytest.raises(HTTPException) as ctx:
        ensure_admin_account(
            {
                "id": "1",
                "email": "u@x",
                "role": "manager",
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403
    assert ctx.value.detail == FORBIDDEN_DETAIL


def test_ensure_manager_rejects_plain_user():
    with pytest.raises(HTTPException) as ctx:
        ensure_manager_staff(
            {
                "id": "1",
                "email": "u@x",
                "role": "user",
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", "manager", "warehouse_manager"])
def test_ensure_manager_accepts_staff(role: str):
    ensure_manager_staff(
        {
            "id": "1",
            "email": "u@x",
            "role": role,
            "created_at": "",
            "client_id": None,
        }
    )


def test_ensure_client_portal_requires_client_role():
    with pytest.raises(HTTPException) as ctx:
        ensure_client_portal_account(
            {
                "id": "1",
                "email": "u@x",
                "role": "admin",
                "created_at": "",
                "client_id": "cid",
            }
        )
    assert ctx.value.status_code == 403


def test_ensure_client_portal_requires_client_id():
    with pytest.raises(HTTPException) as ctx:
        ensure_client_portal_account(
            {
                "id": "1",
                "email": "u@x",
                "role": "client",
                "created_at": "",
                "client_id": None,
            }
        )
    assert "администратору" in str(ctx.value.detail)
