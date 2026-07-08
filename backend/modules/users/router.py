from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from dbconn import get_connection
from modules.auth.service import get_current_user
from security import FORBIDDEN_DETAIL

from .schemas import (
    MessageResponse,
    RoleUpdateRequest,
    UserClientAssignRequest,
    UserDeletePatchRequest,
    UserDisplayNameUpdateRequest,
    UserListItem,
)
from utils import now_iso as _now

router = APIRouter(prefix="/users", tags=["users"])



def _get_users_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAIL)
    return user


def _require_active_client(connection, raw: str | None) -> str:
    if raw is None or str(raw).strip() == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле Клиент обязательно")
    cid = str(raw).strip()
    row = connection.execute(
        "SELECT id FROM clients WHERE id = ? AND is_active = 1 AND COALESCE(is_deleted, 0) = 0",
        (cid,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Клиент: недопустимое или неактивное значение",
        )
    return cid


def _revoke_user_sessions(connection, user_id: str) -> None:
    connection.execute(
        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        (_now(), user_id),
    )


def _soft_delete_user(user_id: str, admin: dict) -> MessageResponse:
    """Мягкое удаление: is_deleted=1 + отзыв сессий. Роль и привязка к клиенту
    сохраняются, чтобы восстановление (PATCH is_deleted=false) вернуло пользователя
    в исходном виде. Auth фильтрует is_deleted во всех выборках — доступ закрыт."""
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить самого себя",
        )
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if target_user["role"] == "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя удалить администратора",
            )
        connection.execute(
            "UPDATE users SET is_deleted = 1, deleted_at = ?, deleted_by_id = ? WHERE id = ?",
            (_now(), admin["id"], user_id),
        )
        _revoke_user_sessions(connection, user_id)
        connection.commit()
    return MessageResponse(message="Пользователь удалён")


def _apply_user_deleted_flag(user_id: str, admin: dict, *, is_deleted: bool) -> MessageResponse:
    if is_deleted:
        return _soft_delete_user(user_id, admin)
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role, COALESCE(is_deleted, 0) AS del FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if not target_user["del"]:
            return MessageResponse(message="Восстановлено")
        connection.execute(
            "UPDATE users SET is_deleted = 0, deleted_at = NULL, deleted_by_id = NULL WHERE id = ?",
            (user_id,),
        )
        connection.commit()
    return MessageResponse(message="Восстановлено")


@router.get("", response_model=list[UserListItem])
def list_users(admin=Depends(_get_users_admin)):
    _ = admin
    with get_connection() as connection:
        users = connection.execute(
            """
            SELECT u.id, u.email, u.display_name, u.role, u.created_at, u.client_id, c.name AS client_name
            FROM users u
            LEFT JOIN clients c ON c.id = u.client_id
            WHERE COALESCE(u.is_deleted, 0) = 0
            ORDER BY u.created_at ASC
            """
        ).fetchall()
    return [
        UserListItem(
            id=u["id"],
            email=u["email"],
            display_name=u["display_name"],
            role=u["role"],
            created_at=u["created_at"],
            client_id=u["client_id"],
            client_name=u["client_name"],
        )
        for u in users
    ]


@router.patch("/{user_id}/display-name", response_model=MessageResponse)
def update_user_display_name(
    user_id: str, payload: UserDisplayNameUpdateRequest, admin=Depends(_get_users_admin)
):
    _ = admin
    raw = payload.display_name
    new_name = (str(raw).strip() if raw is not None else "") or None
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        connection.execute("UPDATE users SET display_name = ? WHERE id = ?", (new_name, user_id))
        connection.commit()
    return MessageResponse(message="Отображаемое имя обновлено")


@router.patch("/{user_id}/role", response_model=MessageResponse)
def update_user_role(user_id: str, payload: RoleUpdateRequest, admin=Depends(_get_users_admin)):
    if payload.role not in ("user", "manager", "warehouse_manager", "shift_supervisor", "warehouse_head", "client"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Можно назначить роль: user, manager, warehouse_manager, shift_supervisor, warehouse_head или client",
        )
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить роль самому себе",
        )
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if target_user["role"] == "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя изменить роль администратора",
            )
        if payload.role == "client":
            connection.execute("UPDATE users SET role = ? WHERE id = ?", (payload.role, user_id))
        else:
            connection.execute("UPDATE users SET role = ?, client_id = NULL WHERE id = ?", (payload.role, user_id))
        _revoke_user_sessions(connection, user_id)
        connection.commit()
    return MessageResponse(message="Роль обновлена")


@router.patch("/{user_id}/client", response_model=MessageResponse)
def update_user_client(user_id: str, payload: UserClientAssignRequest, admin=Depends(_get_users_admin)):
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить привязку самому себе",
        )
    raw = payload.client_id
    new_cid = (str(raw).strip() if raw is not None else "") or None
    with get_connection() as connection:
        target_user = connection.execute(
            "SELECT id, role FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (user_id,),
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if target_user["role"] != "client":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Привязка к клиенту доступна только для пользователей с ролью «Клиент»",
            )
        if new_cid:
            _require_active_client(connection, new_cid)
        connection.execute("UPDATE users SET client_id = ? WHERE id = ?", (new_cid, user_id))
        _revoke_user_sessions(connection, user_id)
        connection.commit()
    return MessageResponse(message="Привязка обновлена")


@router.patch("/{user_id}", response_model=MessageResponse)
def patch_user_deleted_flag(user_id: str, payload: UserDeletePatchRequest, admin=Depends(_get_users_admin)):
    return _apply_user_deleted_flag(user_id, admin, is_deleted=payload.is_deleted)


@router.delete("/{user_id}", response_model=MessageResponse)
def delete_user(user_id: str, admin=Depends(_get_users_admin)):
    return _soft_delete_user(user_id, admin)
