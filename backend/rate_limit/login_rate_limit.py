"""
Redis rate limit для POST /auth/login (по IP и по нормализованному email, ключ user = SHA-256)
и POST /auth/refresh (по IP) — общий Redis-клиент и Lua-скрипт.

Атомарность: Lua-скрипт INCR + EXPIRE при первом обращении (фиксированное окно).
При недоступности Redis (если задан REDIS_URL) — опционально строгий режим через env.

Импорт пакета redis отложен: иначе при старом Docker-образе без redis весь процесс падает при import main.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from config import AUTH_RL_REFRESH_MAX, AUTH_RL_REFRESH_WINDOW_SEC
from rate_limit.client_ip import client_ip_from_request
from rate_limit import metrics as rl_metrics
from rate_limit.rl_log import log_auth_rate_limit

_log = logging.getLogger("warehouse.auth")

# --- Redis ---
REDIS_URL = (os.environ.get("REDIS_URL") or "").strip()
AUTH_LOGIN_RL_REDIS_DISABLED = os.environ.get("AUTH_LOGIN_RL_REDIS_DISABLED", "").lower() in (
    "1",
    "true",
    "yes",
)

# Лимиты по IP (по умолчанию: 10 / 1 мин)
AUTH_LOGIN_RL_IP_MAX = int(os.environ.get("AUTH_LOGIN_RL_IP_MAX", "10"))
AUTH_LOGIN_RL_IP_WINDOW_SEC = int(os.environ.get("AUTH_LOGIN_RL_IP_WINDOW_SEC", "60"))

# Лимиты по email (по умолчанию: 8 / 10 мин)
AUTH_LOGIN_RL_EMAIL_MAX = int(os.environ.get("AUTH_LOGIN_RL_EMAIL_MAX", "8"))
AUTH_LOGIN_RL_EMAIL_WINDOW_SEC = int(os.environ.get("AUTH_LOGIN_RL_EMAIL_WINDOW_SEC", "600"))

# Макс. размер тела JSON для разбора email (защита от огромных тел)
AUTH_LOGIN_RL_MAX_BODY_BYTES = int(os.environ.get("AUTH_LOGIN_RL_MAX_BODY_BYTES", str(32 * 1024)))

# При ошибке Redis: open = пропустить запрос (логируем), closed = 503
AUTH_LOGIN_RL_FAIL_CLOSED = os.environ.get("AUTH_LOGIN_RL_FAIL_CLOSED", "").lower() in (
    "1",
    "true",
    "yes",
)


def _redis_timeout_seconds(name: str, default: float) -> float:
    """Положительное число секунд; иначе default (защита от «вечного» ожидания TCP при мёртвом Redis)."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        v = float(raw)
    except ValueError:
        return default
    return v if v > 0 else default


# Таймауты клиента Redis (сек): без них первый login может висеть на TCP до десятков секунд, если Redis недоступен.
AUTH_LOGIN_RL_REDIS_SOCKET_CONNECT_TIMEOUT_SEC = _redis_timeout_seconds(
    "AUTH_LOGIN_RL_REDIS_SOCKET_CONNECT_TIMEOUT_SEC",
    2.0,
)
AUTH_LOGIN_RL_REDIS_SOCKET_TIMEOUT_SEC = _redis_timeout_seconds(
    "AUTH_LOGIN_RL_REDIS_SOCKET_TIMEOUT_SEC",
    2.0,
)

# Не даём aclose() зависнуть в middleware (иначе nginx может отдать 502 «upstream closed»).
AUTH_LOGIN_RL_REDIS_CLOSE_TIMEOUT_SEC = _redis_timeout_seconds(
    "AUTH_LOGIN_RL_REDIS_CLOSE_TIMEOUT_SEC",
    3.0,
)

# Fallback без Redis: прежняя семантика in-memory по IP (окно из AUTH_RATE_LIMIT_*)
AUTH_RATE_LIMIT_LOGIN_MAX = int(os.environ.get("AUTH_RATE_LIMIT_LOGIN_MAX", "20"))
AUTH_RATE_LIMIT_LOGIN_WINDOW_SEC = float(os.environ.get("AUTH_RATE_LIMIT_LOGIN_WINDOW_SEC", "60"))

TOO_MANY_BODY = {"message": "Too many login attempts. Please try again later."}

# Lua: INCR; при первом попадании EXPIRE; если счётчик > max — отказ (возвращаем 0)
_LUA_INCR_WINDOW = """
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if c > tonumber(ARGV[2]) then
  return 0
end
return 1
"""

_redis: Any = None
_script: Any = None
_redis_init_lock = asyncio.Lock()
_redis_import_warned = False
_redis_package_missing = False

# In-memory fallback (только IP), как раньше в main — скользящее окно по monotonic
_rl_fallback_lock = threading.Lock()
_rl_fallback_hits: dict[str, list[float]] = {}


def _try_import_redis() -> tuple[Any, Any] | None:
    """Возвращает (redis.asyncio, redis.exceptions) или None при отсутствии пакета."""
    try:
        import redis.asyncio as aioredis
        import redis.exceptions as redis_exc

        return aioredis, redis_exc
    except ModuleNotFoundError:
        return None


def login_email_redis_key_suffix(normalized_email: str) -> str:
    """SHA-256 hex нормализованного email для ключа Redis (без хранения email в ключе)."""
    return hashlib.sha256(normalized_email.encode("utf-8")).hexdigest()


def _key_ip(ip: str) -> str:
    return f"rl:login:ip:{ip}"


def _key_email(normalized: str) -> str:
    return f"rl:login:user:{login_email_redis_key_suffix(normalized)}"


def _normalize_login_email(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or len(s) > 254:
        return None
    return s


def _parse_email_from_json_body(body: bytes) -> str | None:
    if not body:
        return None
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return _normalize_login_email(data.get("email"))


def _fallback_consume(key: str, max_requests: int, window_sec: float) -> bool:
    if max_requests <= 0 or window_sec <= 0:
        return True
    now = time.monotonic()
    cutoff = now - window_sec
    with _rl_fallback_lock:
        lst = _rl_fallback_hits.setdefault(key, [])
        while lst and lst[0] < cutoff:
            lst.pop(0)
        if len(lst) >= max_requests:
            return False
        lst.append(now)
    return True


def _fallback_consume_ip(key: str) -> bool:
    return _fallback_consume(key, AUTH_RATE_LIMIT_LOGIN_MAX, AUTH_RATE_LIMIT_LOGIN_WINDOW_SEC)


async def _ensure_redis() -> tuple[Any, Any]:
    """Ленивая инициализация Redis + зарегистрированный Lua."""
    global _redis, _script, _redis_import_warned, _redis_package_missing
    if not REDIS_URL or AUTH_LOGIN_RL_REDIS_DISABLED:
        return None, None
    if _redis_package_missing:
        return None, None

    mods = _try_import_redis()
    if mods is None:
        _redis_package_missing = True
        if not _redis_import_warned:
            _redis_import_warned = True
            log_auth_rate_limit(
                _log,
                logging.ERROR,
                {
                    "type": "redis_import_error",
                    "blocked": False,
                    "ip": "",
                    "error": "ModuleNotFoundError: redis (pip install redis>=5; или пересоберите backend-образ)",
                },
            )
        return None, None

    aioredis, _redis_exc_unused = mods
    async with _redis_init_lock:
        if _redis is None:
            _redis = aioredis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=AUTH_LOGIN_RL_REDIS_SOCKET_CONNECT_TIMEOUT_SEC,
                socket_timeout=AUTH_LOGIN_RL_REDIS_SOCKET_TIMEOUT_SEC,
            )
            _script = _redis.register_script(_LUA_INCR_WINDOW)
    return _redis, _script


async def _drop_redis_client_unlocked() -> None:
    """Закрыть пул и обнулить ссылки (вызывать под _redis_init_lock)."""
    global _redis, _script
    client = _redis
    _redis = None
    _script = None
    if client is not None:
        try:
            await asyncio.wait_for(client.aclose(), timeout=AUTH_LOGIN_RL_REDIS_CLOSE_TIMEOUT_SEC)
        except (Exception, asyncio.TimeoutError):
            pass


async def _invalidate_redis_after_error() -> None:
    """После сбоя Redis — новое подключение на следующий запрос (избегаем зависшего соединения)."""
    async with _redis_init_lock:
        await _drop_redis_client_unlocked()


async def close_login_redis() -> None:
    async with _redis_init_lock:
        await _drop_redis_client_unlocked()


async def _redis_allow(script: Any, key: str, window_sec: int, max_req: int) -> bool:
    """True если запрос разрешён (счётчик не превысил max)."""
    r = await script(keys=[key], args=[str(int(window_sec)), str(int(max_req))])
    return bool(r)


def _is_redis_infrastructure_error(exc: BaseException) -> bool:
    mods = _try_import_redis()
    if mods is not None:
        _, redis_exc = mods
        if isinstance(exc, redis_exc.RedisError):
            return True
    return isinstance(exc, (TimeoutError, asyncio.TimeoutError, ConnectionError, OSError))


REFRESH_TOO_MANY_BODY = {"detail": "Too many requests"}


def _key_refresh_ip(ip: str) -> str:
    return f"rl:refresh:ip:{ip}"


async def check_refresh_rate_limit(request: Request) -> JSONResponse | None:
    """
    Для POST /auth/refresh: лимит по IP в Redis (общий счётчик для всех воркеров).
    Без Redis (или при его сбое в fail-open) — in-memory fallback на процесс.
    """
    ip = client_ip_from_request(request)

    redis_client, script = await _ensure_redis()
    if redis_client is None or script is None:
        if not _fallback_consume(f"mem:refresh:{ip}", AUTH_RL_REFRESH_MAX, AUTH_RL_REFRESH_WINDOW_SEC):
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "refresh_ip_memory",
                    "blocked": True,
                    "ip": ip,
                    "reason": "no_redis_or_disabled",
                },
            )
            return JSONResponse(REFRESH_TOO_MANY_BODY, status_code=429)
        return None

    try:
        ok = await _redis_allow(
            script,
            _key_refresh_ip(ip),
            int(AUTH_RL_REFRESH_WINDOW_SEC),
            AUTH_RL_REFRESH_MAX,
        )
        if not ok:
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "refresh_ip",
                    "blocked": True,
                    "ip": ip,
                    "limit": AUTH_RL_REFRESH_MAX,
                    "window_sec": AUTH_RL_REFRESH_WINDOW_SEC,
                },
            )
            return JSONResponse(REFRESH_TOO_MANY_BODY, status_code=429)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if _is_redis_infrastructure_error(exc):
            await _invalidate_redis_after_error()
        log_auth_rate_limit(
            _log,
            logging.ERROR,
            {
                "type": "redis_error",
                "blocked": False,
                "ip": ip,
                "error": str(exc),
            },
            exc_info=True,
        )
        if AUTH_LOGIN_RL_FAIL_CLOSED:
            return JSONResponse(
                {"detail": "Rate limit service temporarily unavailable"},
                status_code=503,
            )
        rl_metrics.increment("auth_rl_redis_fallback_total")
        if not _fallback_consume(f"mem:refresh:{ip}", AUTH_RL_REFRESH_MAX, AUTH_RL_REFRESH_WINDOW_SEC):
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "refresh_ip_memory",
                    "blocked": True,
                    "ip": ip,
                    "reason": "after_redis_error",
                },
            )
            return JSONResponse(REFRESH_TOO_MANY_BODY, status_code=429)
    return None


async def check_login_rate_limits(request: Request) -> JSONResponse | None:
    """
    Для POST /auth/login: проверка лимитов. При блокировке — JSONResponse 429.
    Тело запроса читается один раз; Starlette кэширует его для следующих обработчиков.
    """
    if request.method != "POST" or request.url.path != "/auth/login":
        return None

    ip = client_ip_from_request(request)
    body = await request.body()
    if len(body) > AUTH_LOGIN_RL_MAX_BODY_BYTES:
        log_auth_rate_limit(
            _log,
            logging.WARNING,
            {
                "type": "body_size",
                "blocked": True,
                "ip": ip,
                "bytes": len(body),
                "max_bytes": AUTH_LOGIN_RL_MAX_BODY_BYTES,
            },
        )
        return JSONResponse(TOO_MANY_BODY, status_code=429)

    email_norm = _parse_email_from_json_body(body)

    redis_client, script = await _ensure_redis()
    if redis_client is None or script is None:
        if not _fallback_consume_ip(f"mem:{ip}"):
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "ip_memory",
                    "blocked": True,
                    "ip": ip,
                    "reason": "no_redis_or_disabled",
                },
            )
            return JSONResponse(TOO_MANY_BODY, status_code=429)
        return None

    try:
        ok_ip = await _redis_allow(script, _key_ip(ip), AUTH_LOGIN_RL_IP_WINDOW_SEC, AUTH_LOGIN_RL_IP_MAX)
        if not ok_ip:
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "ip",
                    "blocked": True,
                    "ip": ip,
                    "limit": AUTH_LOGIN_RL_IP_MAX,
                    "window_sec": AUTH_LOGIN_RL_IP_WINDOW_SEC,
                },
            )
            return JSONResponse(TOO_MANY_BODY, status_code=429)

        if email_norm:
            ok_email = await _redis_allow(
                script,
                _key_email(email_norm),
                AUTH_LOGIN_RL_EMAIL_WINDOW_SEC,
                AUTH_LOGIN_RL_EMAIL_MAX,
            )
            if not ok_email:
                log_auth_rate_limit(
                    _log,
                    logging.WARNING,
                    {
                        "type": "email",
                        "blocked": True,
                        "ip": ip,
                        "email_hash": login_email_redis_key_suffix(email_norm),
                        "limit": AUTH_LOGIN_RL_EMAIL_MAX,
                        "window_sec": AUTH_LOGIN_RL_EMAIL_WINDOW_SEC,
                    },
                )
                return JSONResponse(TOO_MANY_BODY, status_code=429)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if _is_redis_infrastructure_error(exc):
            await _invalidate_redis_after_error()
        log_auth_rate_limit(
            _log,
            logging.ERROR,
            {
                "type": "redis_error",
                "blocked": False,
                "ip": ip,
                "error": str(exc),
            },
            exc_info=True,
        )
        if AUTH_LOGIN_RL_FAIL_CLOSED:
            return JSONResponse(
                {"detail": "Rate limit service temporarily unavailable"},
                status_code=503,
            )
        rl_metrics.increment("auth_rl_redis_fallback_total")
        log_auth_rate_limit(
            _log,
            logging.WARNING,
            {
                "type": "redis_fallback",
                "blocked": False,
                "ip": ip,
                "fail_open": True,
            },
        )
        if not _fallback_consume_ip(f"mem:{ip}"):
            log_auth_rate_limit(
                _log,
                logging.WARNING,
                {
                    "type": "ip_memory",
                    "blocked": True,
                    "ip": ip,
                    "reason": "after_redis_error",
                },
            )
            return JSONResponse(TOO_MANY_BODY, status_code=429)
    return None
