"""Unit-тесты RBAC без импорта приложения и без БД."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from security import (
    FORBIDDEN_DETAIL,
    ensure_backoffice_account,
    ensure_manager_staff,
    ensure_packing_access,
    ensure_shipment_priority_access,
    ensure_shipment_view_access,
)


def test_ensure_backoffice_rejects_plain_user():
    with pytest.raises(HTTPException) as ctx:
        ensure_backoffice_account(
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
def test_ensure_backoffice_accepts_privileged_roles(role: str):
    ensure_backoffice_account(
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


@pytest.mark.parametrize("role", ["admin", "manager"])
def test_ensure_shipment_priority_accepts_managers(role: str):
    ensure_shipment_priority_access(
        {
            "id": "1",
            "email": "u@x",
            "role": role,
            "created_at": "",
            "client_id": None,
        }
    )


@pytest.mark.parametrize("role", ["warehouse_manager", "shift_supervisor", "user", "client"])
def test_ensure_shipment_priority_rejects_non_managers(role: str):
    with pytest.raises(HTTPException) as ctx:
        ensure_shipment_priority_access(
            {
                "id": "1",
                "email": "u@x",
                "role": role,
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403
    assert ctx.value.detail == FORBIDDEN_DETAIL


@pytest.mark.parametrize("role", ["admin", "manager", "shift_supervisor"])
def test_ensure_packing_accepts_qc_roles(role: str):
    ensure_packing_access(
        {
            "id": "1",
            "email": "u@x",
            "role": role,
            "created_at": "",
            "client_id": None,
        }
    )


@pytest.mark.parametrize("role", ["warehouse_manager", "user", "client"])
def test_ensure_packing_rejects_warehouse_and_plain_roles(role: str):
    with pytest.raises(HTTPException) as ctx:
        ensure_packing_access(
            {
                "id": "1",
                "email": "u@x",
                "role": role,
                "created_at": "",
                "client_id": None,
            }
        )
    assert ctx.value.status_code == 403
    assert ctx.value.detail == FORBIDDEN_DETAIL
