from __future__ import annotations

import functools
import os
import subprocess
import time
import threading
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import AUTH_RL_REFRESH_MAX, AUTH_RL_REFRESH_WINDOW_SEC, UPLOADS_DIR
from dbconn import close_pool, get_connection, init_pool
from rate_limit.client_ip import client_ip_from_request
from rate_limit.login_rate_limit import check_login_rate_limits, close_login_redis

from modules.auth.router import router as auth_router
from modules.balances.router import router as balances_router
from modules.dictionaries.router import router as dictionaries_router
from modules.inventory.router import router as inventory_router
from modules.products.router import router as products_router
from modules.receipts.router import router as receipts_router
from modules.shipments.router import router as shipments_router
from modules.users.router import router as users_router

_auth_log = logging.getLogger("warehouse.auth")


# ── Application lifespan ──────────────────────────────────────────────────────

def _ensure_runtime_schema() -> None:
    """Small guard for direct dev starts that bypass `alembic upgrade head`."""
    with get_connection() as conn:
        conn.execute("""
            ALTER TABLE IF EXISTS receipt_lines
                ADD COLUMN IF NOT EXISTS storage_zone_id TEXT,
                ADD COLUMN IF NOT EXISTS storage_zone_name TEXT
        """)
        conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(exist_ok=True)
    init_pool()
    _ensure_runtime_schema()
    yield
    close_pool()
    try:
        await close_login_redis()
    except Exception:
        pass


# ── Version helpers ───────────────────────────────────────────────────────────

def _app_environment() -> str:
    raw = (os.environ.get("APP_ENV") or "dev").strip().lower()
    return raw if raw in ("dev", "test", "prod") else "dev"


def _git_repo_root() -> Path | None:
    here = Path(__file__).resolve().parent
    for p in (here, *here.parents):
        if (p / ".git").exists():
            return p
    return None


@functools.lru_cache(maxsize=1)
def _git_describe_version() -> str | None:
    root = _git_repo_root()
    if root is None:
        return None
    try:
        proc = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            cwd=root, capture_output=True, text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = (proc.stdout or "").strip() if proc.returncode == 0 else ""
    return out if out else None


def _app_version() -> str:
    env = (os.environ.get("APP_VERSION") or "").strip()
    if env:
        return env
    git_v = _git_describe_version()
    if git_v:
        return git_v
    return "1.0.1"


# ── FastAPI instance ──────────────────────────────────────────────────────────

app = FastAPI(
    openapi_url="/openapi.json",
    swagger_ui_parameters={"url": "./openapi.json"},
    lifespan=lifespan,
)

_cors_allow_origins = [o.strip() for o in (os.environ.get("CORS_ALLOW_ORIGINS") or "").split(",") if o.strip()]
if _cors_allow_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


# ── Rate limiting middleware ───────────────────────────────────────────────────

_rl_refresh_lock = threading.Lock()
_rl_refresh_store: dict[str, list[float]] = {}


def _rate_limit_consume(store: dict[str, list[float]], key: str, *, max_requests: int, window_sec: float) -> bool:
    if max_requests <= 0 or window_sec <= 0:
        return True
    now = time.monotonic()
    cutoff = now - window_sec
    with _rl_refresh_lock:
        lst = store.setdefault(key, [])
        while lst and lst[0] < cutoff:
            lst.pop(0)
        if len(lst) >= max_requests:
            return False
        lst.append(now)
    return True


@app.middleware("http")
async def _auth_rate_limit_middleware(request: Request, call_next):
    if request.method == "POST":
        p = request.url.path
        if p == "/auth/login":
            rl_resp = await check_login_rate_limits(request)
            if rl_resp is not None:
                return rl_resp
        elif p == "/auth/refresh":
            if not _rate_limit_consume(
                _rl_refresh_store,
                client_ip_from_request(request),
                max_requests=AUTH_RL_REFRESH_MAX,
                window_sec=AUTH_RL_REFRESH_WINDOW_SEC,
            ):
                _auth_log.warning("auth rate limit refresh ip=%s", client_ip_from_request(request))
                return JSONResponse({"detail": "Too many requests"}, status_code=429)
    return await call_next(request)


# ── System endpoints ──────────────────────────────────────────────────────────

class SystemVersionResponse(BaseModel):
    version: str
    environment: str


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version", response_model=SystemVersionResponse, tags=["system"])
def system_version() -> SystemVersionResponse:
    return SystemVersionResponse(version=_app_version(), environment=_app_environment())


@app.api_route("/import/{removed_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
def removed_import_api(removed_path: str):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Excel-импорт отключен")


@app.api_route("/analytics/{removed_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
def removed_analytics_api(removed_path: str):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Аналитика отключена")


@app.api_route("/client-portal/{removed_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
def removed_client_portal_api(removed_path: str):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Клиентский портал отключен")


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(dictionaries_router)
app.include_router(inventory_router)
app.include_router(products_router)
app.include_router(receipts_router)
app.include_router(shipments_router)
app.include_router(balances_router)
