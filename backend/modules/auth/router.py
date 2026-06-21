from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

import jwt
from fastapi import APIRouter, Body, Cookie, Depends, Header, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import (
    JWT_ALGORITHM,
    JWT_SECRET,
    TOKEN_TTL_MINUTES,
    AUTH_CLIENT_MOBILE,
    AUTH_REPLAY_REVOKE_MIN_SECONDS,
    AUTH_REFRESH_TTL_DAYS,
)
from dbconn import get_connection
from security import user_client_id_opt

from .schemas import (
    AuthTokenResponse,
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
)
from .service import (
    _hash_refresh_token,
    _parse_session_expires_at,
    clear_refresh_cookie,
    create_token,
    get_current_user,
    get_user_by_email,
    hash_password,
    insert_auth_session_row,
    jti_denylist_add,
    optional_bearer,
    set_refresh_cookie,
    verify_password,
)

import secrets

router = APIRouter(prefix="/auth", tags=["auth"])
_auth_log = logging.getLogger("warehouse.auth")

_now_str = lambda: datetime.now(UTC).isoformat()


def _is_mobile_client(x_client: str | None) -> bool:
    return bool(x_client) and str(x_client).strip().lower() == AUTH_CLIENT_MOBILE


@router.post("/register", response_model=RegisterResponse)
def register(payload: RegisterRequest):
    existing_user = get_user_by_email(payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email уже зарегистрирован",
        )
    user_id = str(uuid4())
    password_hash = hash_password(payload.password)
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)",
            (user_id, payload.email.lower(), password_hash, _now_str()),
        )
        connection.commit()
    return RegisterResponse(success=True)


@router.post("/login", response_model=AuthTokenResponse)
def login(payload: LoginRequest, response: Response, x_client: str | None = Header(default=None)):
    user = get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    user_id = str(user["id"])
    with get_connection() as connection:
        raw_refresh = insert_auth_session_row(connection, user_id)
        connection.commit()
    token = create_token(user_id, str(user["email"]).strip().lower(), str(user["role"]))
    set_refresh_cookie(response, raw_refresh)
    _auth_log.info("auth login ok user_id_prefix=%s", user_id[:8])
    return AuthTokenResponse(
        access_token=token,
        token_type="Bearer",
        expires_in=TOKEN_TTL_MINUTES * 60,
        refresh_token=raw_refresh if _is_mobile_client(x_client) else None,
    )


@router.post("/change-password", response_model=AuthTokenResponse)
def change_password(payload: ChangePasswordRequest, response: Response, user=Depends(get_current_user)):
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Новый пароль должен отличаться от текущего",
        )
    user_id = user["id"]
    email = str(user["email"]).strip().lower()
    role = str(user["role"])
    new_hash = hash_password(payload.new_password)
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, password_hash FROM users WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (user_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if not verify_password(payload.current_password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неверный текущий пароль",
            )
        connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))
        now_ts = _now_str()
        connection.execute(
            "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now_ts, user_id),
        )
        raw_refresh = insert_auth_session_row(connection, str(user_id))
        connection.commit()
    token = create_token(str(user_id), email, role)
    set_refresh_cookie(response, raw_refresh)
    return AuthTokenResponse(access_token=token, token_type="Bearer", expires_in=TOKEN_TTL_MINUTES * 60)


@router.post("/refresh", response_model=AuthTokenResponse)
def auth_refresh(
    response: Response,
    payload: RefreshRequest | None = Body(default=None),
    wms_rt: str | None = Cookie(None),
    x_client: str | None = Header(default=None),
):
    body_refresh = str(payload.refresh_token).strip() if payload and payload.refresh_token else ""
    raw_in = body_refresh or (str(wms_rt).strip() if wms_rt else "")
    if not raw_in:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла или отсутствует",
        )
    # Refresh в теле отдаём только явному мобильному клиенту (как и /login). Браузер
    # держит refresh строго в HttpOnly cookie — иначе ротированный токен утёк бы в
    # JS-читаемое тело и обошёл HttpOnly-модель. Тело refresh_token при этом всё равно
    # принимаем (raw_in выше), но НЕ эхо-возвращаем без X-Client: mobile.
    is_mobile = _is_mobile_client(x_client)
    h = _hash_refresh_token(raw_in)
    now_ts = _now_str()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT s.user_id, s.expires_at, u.email, u.role
            FROM auth_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.refresh_hash = ?
              AND s.revoked_at IS NULL
              AND COALESCE(u.is_deleted, 0) = 0
            """,
            (h,),
        ).fetchone()
        if not row:
            sup = connection.execute(
                "SELECT user_id, superseded_at FROM auth_refresh_superseded WHERE superseded_hash = ?",
                (h,),
            ).fetchone()
            if not sup:
                _auth_log.info("auth refresh invalid hash prefix=%s", h[:12])
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Сессия недействительна",
                )
            try:
                sup_at = _parse_session_expires_at(str(sup["superseded_at"]))
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Сессия недействительна",
                ) from None
            replay_uid = str(sup["user_id"])
            age_sec = (datetime.now(UTC) - sup_at).total_seconds()
            if age_sec >= AUTH_REPLAY_REVOKE_MIN_SECONDS:
                connection.execute(
                    "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                    (now_ts, replay_uid),
                )
                connection.commit()
                _auth_log.warning("auth refresh replay revoke_all user_id=%s age_sec=%.1f", replay_uid, age_sec)
            else:
                _auth_log.info("auth refresh replay grace user_id=%s age_sec=%.1f", replay_uid, age_sec)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия недействительна")

        try:
            exp_at = _parse_session_expires_at(str(row["expires_at"]))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Сессия недействительна",
            ) from None
        if exp_at < datetime.now(UTC):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия истекла")

        user_id = str(row["user_id"])
        email = str(row["email"]).strip().lower()
        role = str(row["role"])
        new_raw = secrets.token_urlsafe(32)
        new_h = _hash_refresh_token(new_raw)
        from datetime import timedelta
        new_exp = (datetime.now(UTC) + timedelta(days=AUTH_REFRESH_TTL_DAYS)).isoformat()
        upd = connection.execute(
            """
            UPDATE auth_sessions
            SET refresh_hash = ?, expires_at = ?, last_used_at = ?
            WHERE refresh_hash = ? AND revoked_at IS NULL
            RETURNING id
            """,
            (new_h, new_exp, now_ts, h),
        ).fetchone()
        if not upd:
            sup = connection.execute(
                "SELECT user_id, superseded_at FROM auth_refresh_superseded WHERE superseded_hash = ?",
                (h,),
            ).fetchone()
            if sup:
                try:
                    sup_at = _parse_session_expires_at(str(sup["superseded_at"]))
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Сессия недействительна",
                    ) from None
                replay_uid = str(sup["user_id"])
                age_sec = (datetime.now(UTC) - sup_at).total_seconds()
                if age_sec >= AUTH_REPLAY_REVOKE_MIN_SECONDS:
                    connection.execute(
                        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                        (now_ts, replay_uid),
                    )
                    connection.commit()
                    _auth_log.warning(
                        "auth refresh replay_after_race revoke_all user_id=%s age_sec=%.1f", replay_uid, age_sec
                    )
                else:
                    _auth_log.info(
                        "auth refresh race_lost user_id=%s age_sec=%.1f", replay_uid, age_sec
                    )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия недействительна")
        connection.execute(
            """
            INSERT INTO auth_refresh_superseded (superseded_hash, user_id, superseded_at)
            VALUES (?, ?, ?)
            ON CONFLICT (superseded_hash) DO NOTHING
            """,
            (h, user_id, now_ts),
        )
        connection.commit()

    token = create_token(user_id, email, role)
    set_refresh_cookie(response, new_raw)
    return AuthTokenResponse(
        access_token=token,
        token_type="Bearer",
        expires_in=TOKEN_TTL_MINUTES * 60,
        refresh_token=new_raw if is_mobile else None,
    )


@router.post("/logout")
def auth_logout(
    payload: RefreshRequest | None = Body(default=None),
    wms_rt: str | None = Cookie(None),
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer),
):
    if credentials and credentials.credentials:
        try:
            pl = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            jti = pl.get("jti")
            exp = pl.get("exp")
            if jti is not None and exp is not None:
                jti_denylist_add(str(jti), float(exp))
        except jwt.PyJWTError:
            pass
    body_refresh = str(payload.refresh_token).strip() if payload and payload.refresh_token else ""
    raw_refresh = body_refresh or (str(wms_rt).strip() if wms_rt else "")
    if raw_refresh:
        h = _hash_refresh_token(raw_refresh)
        with get_connection() as connection:
            connection.execute(
                "UPDATE auth_sessions SET revoked_at = ? WHERE refresh_hash = ? AND revoked_at IS NULL",
                (_now_str(), h),
            )
            connection.commit()
    r = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(r)
    return r


@router.get("/me", response_model=MeResponse)
def me(user=Depends(get_current_user)):
    return MeResponse(
        id=user["id"],
        email=user["email"],
        role=user["role"],
        client_id=user_client_id_opt(user),
    )
