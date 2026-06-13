"""Единые проверки ролей для HTTP-зависимостей (RBAC)."""

from __future__ import annotations

from typing import Any, Mapping

from fastapi import HTTPException, status

# Сообщение для 403: одна строка — проще сопоставлять в тестах и логах.
FORBIDDEN_DETAIL = "Недостаточно прав"


def user_client_id_opt(user: Mapping[str, Any]) -> str | None:
    """Значение users.client_id из результата SELECT (доступ по ключу, без .get)."""
    try:
        raw = user["client_id"]
    except (KeyError, IndexError):
        return None
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def ensure_backoffice_account(user: Mapping[str, Any]) -> None:
    """Админ-разделы бэк-офиса (справочники, товары): admin, manager, warehouse_manager.

    Это НЕ проверка «только admin» — для строго админских операций
    (управление пользователями) используется отдельная проверка role == "admin".
    """
    if user["role"] not in ("admin", "manager", "warehouse_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_manager_staff(user: Mapping[str, Any]) -> None:
    if user["role"] not in ("manager", "admin", "warehouse_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_shipment_view_access(user: Mapping[str, Any]) -> None:
    if user["role"] not in ("manager", "admin", "warehouse_manager", "shift_supervisor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_dashboard_access(user: Mapping[str, Any]) -> None:
    ensure_shipment_view_access(user)


def ensure_packing_access(user: Mapping[str, Any]) -> None:
    """Внесение результата упаковки: менеджерский состав и начальник смены."""
    if user["role"] not in ("manager", "admin", "shift_supervisor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_warehouse_staff(user: Mapping[str, Any]) -> None:
    """Складские действия (приёмка, разгрузка рейса): кладовщик и менеджерский состав."""
    if user["role"] not in ("warehouse_manager", "manager", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_view_costs(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def can_manage_finance(user: Mapping[str, Any]) -> bool:
    """Счета (финансы) ведут только менеджер и админ — как и просмотр стоимостей."""
    return user["role"] in ("admin", "manager")


def ensure_finance_access(user: Mapping[str, Any]) -> None:
    if not can_manage_finance(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_edit_shipment_priority(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def can_edit_shipment_planning(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def ensure_shipment_priority_access(user: Mapping[str, Any]) -> None:
    if not can_edit_shipment_priority(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_shipment_planning_access(user: Mapping[str, Any]) -> None:
    if not can_edit_shipment_planning(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_cost_access(user: Mapping[str, Any]) -> None:
    if not can_view_costs(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_edit_planned_arrival(user: Mapping[str, Any]) -> bool:
    """Плановую дату прибытия правит менеджерский состав, но не кладовщик."""
    return user["role"] in ("admin", "manager")


def ensure_planned_arrival_access(user: Mapping[str, Any]) -> None:
    if not can_edit_planned_arrival(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )
