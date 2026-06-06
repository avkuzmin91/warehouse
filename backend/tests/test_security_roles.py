"""Unit-тесты RBAC без импорта приложения и без БД."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from security import (
    FORBIDDEN_DETAIL,
    ensure_admin_account,
    ensure_manager_staff,
    ensure_shipment_view_access,
)


def test_ensure_admin_rejects_plain_user():
    with pytest.raises(HTTPException) as ctx:
        ensure_admin_account(
            {
                "id": "1",
                "email": "u@x",
                "role": "user",
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403
    assert ctx.value.detail == FORBIDDEN_DETAIL


@pytest.mark.parametrize("role", ["admin", "manager", "warehouse_manager"])
def test_ensure_admin_accepts_privileged_roles(role: str):
    ensure_admin_account(
        {
            "id": "1",
            "email": "u@x",
            "role": role,
            "created_at": "",
            "client_id": None,
        }
    )


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


@pytest.mark.parametrize("role", ["admin", "manager", "warehouse_manager", "shift_supervisor"])
def test_ensure_shipment_view_accepts_shift_supervisor(role: str):
    ensure_shipment_view_access(
        {
            "id": "1",
            "email": "u@x",
            "role": role,
            "created_at": "",
            "client_id": None,
        }
    )


def test_ensure_manager_rejects_shift_supervisor():
    with pytest.raises(HTTPException) as ctx:
        ensure_manager_staff(
            {
                "id": "1",
                "email": "u@x",
                "role": "shift_supervisor",
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403
