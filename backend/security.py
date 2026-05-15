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


def ensure_admin_account(user: Mapping[str, Any]) -> None:
    if user["role"] != "admin":
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


def ensure_client_portal_account(user: Mapping[str, Any]) -> None:
    """Роль client и назначенный client_id; иначе 403 (в т.ч. сообщение об активации)."""
    if user["role"] != "client":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )
    cid = user_client_id_opt(user) or ""
    if not cid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обратитесь к администратору для активации доступа",
        )
