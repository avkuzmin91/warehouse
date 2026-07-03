from __future__ import annotations

import hashlib
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import (
    AUTH_JTI_DENYLIST_MAX,
    AUTH_REFRESH_COOKIE_NAME,
    AUTH_REFRESH_COOKIE_PATH,
    AUTH_REFRESH_COOKIE_SAMESITE,
    AUTH_REFRESH_TTL_DAYS,
    JWT_ALGORITHM,
    JWT_SECRET,
    TOKEN_TTL_MINUTES,
)
from dbconn import get_connection
from security import (
    ensure_backoffice_account,
    ensure_dashboard_access,
    ensure_document_create_access,
    ensure_manager_staff,
    ensure_packing_access,
    ensure_shipment_view_access,
    ensure_stock_write_access,
    ensure_warehouse_staff,
    user_client_id_opt,
)
from utils import now_iso as _now


optional_bearer = HTTPBearer(auto_error=False)
bearer_scheme = HTTPBearer()



def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "userId": user_id,
        "email": email,
        "role": role,
        "jti": str(uuid4()),
        "exp": datetime.now(UTC) + timedelta(minutes=TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# Фиктивный bcrypt-хэш для несуществующих пользователей при логине: прогон checkpw
# держит время ответа одинаковым и не даёт по таймингу отличить занятый email от свободного.
_DUMMY_PASSWORD_HASH = hash_password("timing-attack-dummy-password")


def verify_password_dummy() -> None:
    """Прогнать bcrypt вхолостую (константное время логина для неизвестного email)."""
    bcrypt.checkpw(b"timing-attack-dummy-password", _DUMMY_PASSWORD_HASH.encode("utf-8"))


def _hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _app_environment() -> str:
    import os
    raw = (os.environ.get("APP_ENV") or "dev").strip().lower()
    return raw if raw in ("dev", "test", "prod") else "dev"


def _auth_refresh_cookie_secure() -> bool:
    return _app_environment() == "prod"


def _auth_refresh_max_age_seconds() -> int:
    return AUTH_REFRESH_TTL_DAYS * 24 * 60 * 60


def _refresh_cookie_binding_kwargs() -> dict[str, Any]:
    return {
        "path": AUTH_REFRESH_COOKIE_PATH,
        "httponly": True,
        "secure": _auth_refresh_cookie_secure(),
        "samesite": AUTH_REFRESH_COOKIE_SAMESITE,
    }


def set_refresh_cookie(response: Any, raw_refresh: str) -> None:
    value = str(raw_refresh).strip()
    if not value:
        raise ValueError("refresh cookie value must be non-empty")
    response.set_cookie(
        key=AUTH_REFRESH_COOKIE_NAME,
        value=value,
        max_age=_auth_refresh_max_age_seconds(),
        **_refresh_cookie_binding_kwargs(),
    )


def clear_refresh_cookie(response: Any) -> None:
    response.delete_cookie(AUTH_REFRESH_COOKIE_NAME, **_refresh_cookie_binding_kwargs())


_JTI_DENY: dict[str, float] = {}
_JTI_DENY_LOCK = threading.Lock()


def _jti_denylist_prune_unlocked(now: float) -> None:
    dead = [k for k, exp in _JTI_DENY.items() if exp <= now]
    for k in dead:
        _JTI_DENY.pop(k, None)


def jti_denylist_add(jti: str, exp_unix: float) -> None:
    with _JTI_DENY_LOCK:
        now = time.time()
        _jti_denylist_prune_unlocked(now)
        _JTI_DENY[jti] = exp_unix
        if len(_JTI_DENY) > AUTH_JTI_DENYLIST_MAX:
            overflow = len(_JTI_DENY) - AUTH_JTI_DENYLIST_MAX
            for k in list(_JTI_DENY.keys())[: max(overflow, 0)]:
                _JTI_DENY.pop(k, None)


def jti_denylist_contains(jti: str) -> bool:
    with _JTI_DENY_LOCK:
        _jti_denylist_prune_unlocked(time.time())
        return jti in _JTI_DENY


def insert_auth_session_row(connection: Any, user_id: str) -> str:
    sid = str(uuid4())
    raw = secrets.token_urlsafe(32)
    h = _hash_refresh_token(raw)
    exp = (datetime.now(UTC) + timedelta(days=AUTH_REFRESH_TTL_DAYS)).isoformat()
    now = _now()
    connection.execute(
        """
        INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at, revoked_at, created_at, last_used_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
        """,
        (sid, user_id, h, exp, now, now),
    )
    return raw


def _parse_session_expires_at(value: str) -> datetime:
    s = str(value).strip()
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def get_user_by_email(email: str):
    with get_connection() as connection:
        return connection.execute(
            "SELECT id, email, password_hash, role, created_at, client_id FROM users "
            "WHERE email = ? AND COALESCE(is_deleted, 0) = 0",
            (email.lower(),),
        ).fetchone()


def _get_user_by_refresh_cookie(raw_refresh: str | None):
    raw = str(raw_refresh or "").strip()
    if not raw:
        return None
    h = _hash_refresh_token(raw)
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT u.id, u.email, u.role, u.created_at, u.client_id, s.expires_at
            FROM auth_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.refresh_hash = ?
              AND s.revoked_at IS NULL
              AND COALESCE(u.is_deleted, 0) = 0
            """,
            (h,),
        ).fetchone()
    if not row:
        return None
    try:
        exp_at = _parse_session_expires_at(str(row["expires_at"]))
    except ValueError:
        return None
    if exp_at < datetime.now(UTC):
        return None
    return row


def get_current_user(
    wms_rt: str | None = Cookie(None),
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer),
):
    if not credentials or not credentials.credentials:
        user = _get_user_by_refresh_cookie(wms_rt)
        if user:
            return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        user = _get_user_by_refresh_cookie(wms_rt)
        if user:
            return user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен"
        ) from exc

    user_id = payload.get("userId")
    email = payload.get("email")
    role = payload.get("role")
    jti = payload.get("jti")
    if not user_id or not email or not role:
        user = _get_user_by_refresh_cookie(wms_rt)
        if user:
            return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    if jti and jti_denylist_contains(str(jti)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия завершена")

    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, email, role, created_at, client_id
            FROM users
            WHERE id = ?
              AND LOWER(TRIM(email)) = LOWER(TRIM(?))
              AND COALESCE(is_deleted, 0) = 0
            """,
            (user_id, str(email)),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    return user


def get_current_admin(user=Depends(get_current_user)):
    """Бэк-офис (admin, manager, warehouse_manager), а не строго admin — см. ensure_backoffice_account."""
    ensure_backoffice_account(user)
    return user


def get_current_manager(user=Depends(get_current_user)):
    ensure_manager_staff(user)
    return user


def get_current_document_creator(user=Depends(get_current_user)):
    """Создание рейсов / поступлений / отгрузок — менеджерский состав, не кладовщик."""
    ensure_document_create_access(user)
    return user


def get_current_shipment_viewer(user=Depends(get_current_user)):
    ensure_shipment_view_access(user)
    return user


def get_current_packer(user=Depends(get_current_user)):
    ensure_packing_access(user)
    return user


def get_current_stock_operator(user=Depends(get_current_user)):
    """Ручные операции с остатками — складской состав вместе с начальником смены."""
    ensure_stock_write_access(user)
    return user


def get_current_dashboard_user(user=Depends(get_current_user)):
    ensure_dashboard_access(user)
    return user


def get_current_warehouse(user=Depends(get_current_user)):
    ensure_warehouse_staff(user)
    return user


def get_client_user(user=Depends(get_current_user)):
    return user
