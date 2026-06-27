from __future__ import annotations

import asyncio
import functools
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import UPLOADS_DIR
from dbconn import close_pool, get_connection, init_pool
from rate_limit.login_rate_limit import check_login_rate_limits, check_refresh_rate_limit, close_login_redis

from modules.auth.router import router as auth_router
from modules.balances.router import router as balances_router
from modules.cabinet.router import router as cabinet_router
from modules.dashboard.router import router as dashboard_router
from modules.dictionaries.router import router as dictionaries_router
from modules.inventory.router import router as inventory_router
from modules.invoices.router import router as invoices_router
from modules.expenses.router import router as expenses_router
from modules.timesheet.router import router as timesheet_router
from modules.locations.router import router as locations_router
from modules.logistics.router import router as logistics_router
from modules.pallet_pricing.router import router as pallet_pricing_router
from modules.pricing.router import router as pricing_router
from modules.production_calendar.router import router as production_calendar_router
from modules.products.router import router as products_router
from modules.receipts.router import router as receipts_router
from modules.recurring_expenses.router import router as recurring_expenses_router
from modules.shipments.router import router as shipments_router
from modules.dispatch.router import router as dispatch_router
from modules.tasks.router import router as tasks_router
from modules.scan.router import router as scan_router
from modules.users.router import router as users_router
from modules.warehouse_rent.router import router as warehouse_rent_router


# ── Application lifespan ──────────────────────────────────────────────────────

def _seed_expense_dictionaries(conn) -> None:
    """Сид справочников расходов при dev-старте без alembic — только если таблица пуста."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from config import (
        EXPENSE_CATEGORY_SEED,
        EXPENSE_PAYMENT_SOURCE_SEED,
        EXPENSE_SYSTEM_CATEGORY_SEED,
    )

    now = datetime.now(UTC).isoformat()
    for table, names in (
        ("expense_categories", EXPENSE_CATEGORY_SEED + EXPENSE_SYSTEM_CATEGORY_SEED),
        ("expense_payment_sources", EXPENSE_PAYMENT_SOURCE_SEED),
    ):
        empty = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
        if int(empty) > 0:
            continue
        for i, name in enumerate(names):
            conn.execute(
                f"INSERT INTO {table} (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)",
                (str(uuid4()), name, i, now),
            )


def _ensure_runtime_schema() -> None:
    """Small guard for direct dev starts that bypass `alembic upgrade head`."""
    with get_connection() as conn:
        conn.execute("""
            ALTER TABLE IF EXISTS receipt_lines
                ADD COLUMN IF NOT EXISTS storage_zone_id TEXT,
                ADD COLUMN IF NOT EXISTS storage_zone_name TEXT
        """)
        conn.execute("""
            ALTER TABLE IF EXISTS receipt_docs
                ADD COLUMN IF NOT EXISTS comment TEXT,
                ADD COLUMN IF NOT EXISTS actual_arrival_date TEXT
        """)
        conn.execute("""
            ALTER TABLE IF EXISTS shipment_docs
                ADD COLUMN IF NOT EXISTS priority_rank INTEGER
        """)
        conn.execute("""
            ALTER TABLE IF EXISTS colors
                ADD COLUMN IF NOT EXISTS color_hex TEXT
        """)
        # «Наши склады» (own_warehouses) — отдельный admin-only справочник со ставкой
        # аренды; не путать с warehouses («Точки логистики», origin рейсов).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS own_warehouses (
                id                   TEXT PRIMARY KEY,
                name                 TEXT UNIQUE NOT NULL,
                rent_monthly_kopecks INTEGER,
                is_active            INTEGER NOT NULL DEFAULT 1,
                created_at           TEXT NOT NULL,
                creator_id           TEXT,
                updated_at           TEXT,
                updated_by_id        TEXT,
                is_deleted           INTEGER NOT NULL DEFAULT 0,
                deleted_at           TEXT,
                deleted_by_id        TEXT
            )
        """)
        conn.execute("""
            ALTER TABLE IF EXISTS products
                ADD COLUMN IF NOT EXISTS weight_grams INTEGER
        """)
        conn.execute("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sku_pending INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS sku_pending INTEGER NOT NULL DEFAULT 0")
        # Орг. структура табеля: справочник должностей + связь сотрудника с учёткой/руководителем.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS positions (
                id            TEXT PRIMARY KEY,
                name          TEXT UNIQUE NOT NULL,
                is_active     INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                creator_id    TEXT,
                updated_at    TEXT,
                updated_by_id TEXT,
                is_deleted    INTEGER NOT NULL DEFAULT 0,
                deleted_at    TEXT,
                deleted_by_id TEXT
            )
        """)
        conn.execute("""
            ALTER TABLE IF EXISTS employees
                ADD COLUMN IF NOT EXISTS position_id          TEXT,
                ADD COLUMN IF NOT EXISTS user_id              TEXT,
                ADD COLUMN IF NOT EXISTS supervisor_user_id   TEXT,
                ADD COLUMN IF NOT EXISTS comp_type            TEXT NOT NULL DEFAULT 'hourly',
                ADD COLUMN IF NOT EXISTS fixed_salary_kopecks INTEGER
        """)
        # Логистика (рейсы) + справочник «Тип кузова» — на случай dev-старта без alembic.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vehicle_types (
                id            TEXT PRIMARY KEY,
                name          TEXT UNIQUE NOT NULL,
                is_active     INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                creator_id    TEXT,
                updated_at    TEXT,
                updated_by_id TEXT,
                is_deleted    INTEGER NOT NULL DEFAULT 0,
                deleted_at    TEXT,
                deleted_by_id TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trip_docs (
                id                   TEXT PRIMARY KEY,
                trip_number          TEXT NOT NULL UNIQUE,
                direction            TEXT NOT NULL DEFAULT 'inbound',
                cargo_type           TEXT NOT NULL DEFAULT 'good',
                status               TEXT NOT NULL DEFAULT 'draft',
                assignee_role        TEXT,
                assignee_id          TEXT,
                origin_id            TEXT,
                origin_name          TEXT,
                carrier_id           TEXT,
                carrier_name         TEXT,
                vehicle_type_id      TEXT,
                vehicle_type_name    TEXT,
                transport_ordered_at TEXT,
                eta                  TEXT,
                cost_estimate        REAL,
                comment              TEXT,
                arrived_at           TEXT,
                unload_finished_at   TEXT,
                load_factor          TEXT,
                logistics_cost_actual REAL,
                waiting_cost         REAL,
                waiting_minutes      INTEGER,
                created_at           TEXT NOT NULL,
                created_by           TEXT,
                updated_at           TEXT,
                is_deleted           INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("ALTER TABLE IF EXISTS trip_docs ADD COLUMN IF NOT EXISTS cargo_type TEXT NOT NULL DEFAULT 'good'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_docs_status ON trip_docs(status)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trip_lines (
                id             TEXT PRIMARY KEY,
                trip_id        TEXT NOT NULL REFERENCES trip_docs(id),
                receipt_doc_id TEXT NOT NULL,
                client_id      TEXT,
                client_name    TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_lines_trip ON trip_lines(trip_id)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_receipt_per_trip "
            "ON trip_lines(trip_id, receipt_doc_id) WHERE is_deleted = 0 AND receipt_doc_id IS NOT NULL"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trip_ops (
                id         TEXT PRIMARY KEY,
                trip_id    TEXT NOT NULL REFERENCES trip_docs(id),
                op_type    TEXT NOT NULL,
                comment    TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_ops_trip ON trip_ops(trip_id)")
        # Финансы (счета) — на случай dev-старта без alembic.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS invoice_docs (
                id           TEXT PRIMARY KEY,
                doc_number   TEXT NOT NULL UNIQUE,
                client_id    TEXT,
                client_name  TEXT,
                status       TEXT NOT NULL DEFAULT 'issued',
                total_amount INTEGER NOT NULL DEFAULT 0,
                paid_amount  INTEGER NOT NULL DEFAULT 0,
                due_date     TEXT,
                comment      TEXT,
                created_at   TEXT NOT NULL,
                created_by   TEXT,
                updated_at   TEXT,
                is_deleted   INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_docs_status ON invoice_docs(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_docs_client ON invoice_docs(client_id)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_invoice_docs_due ON invoice_docs(due_date) "
            "WHERE COALESCE(is_deleted, 0) = 0 AND status IN ('issued', 'partially_paid')"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS invoice_shipments (
                id              TEXT PRIMARY KEY,
                invoice_id      TEXT NOT NULL REFERENCES invoice_docs(id),
                shipment_doc_id TEXT NOT NULL,
                client_id       TEXT,
                client_name     TEXT,
                created_at      TEXT NOT NULL,
                created_by      TEXT,
                is_deleted      INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_shipments_invoice ON invoice_shipments(invoice_id)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_shipments_shipment_unique "
            "ON invoice_shipments(shipment_doc_id) WHERE is_deleted = 0"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS invoice_payments (
                id         TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
                amount     INTEGER NOT NULL,
                paid_on    TEXT,
                comment    TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS invoice_ops (
                id         TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
                op_type    TEXT NOT NULL,
                comment    TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_ops_invoice ON invoice_ops(invoice_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS invoice_files (
                id         TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL,
                filename   TEXT NOT NULL,
                url        TEXT NOT NULL,
                mime_type  TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_invoice_files_invoice ON invoice_files(invoice_id)")
        # Расходы на материалы (хозрасходы) — на случай dev-старта без alembic.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_categories (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                created_by TEXT,
                updated_at TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_name "
            "ON expense_categories (LOWER(name)) WHERE COALESCE(is_deleted, 0) = 0"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_payment_sources (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                created_by TEXT,
                updated_at TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_payment_sources_name "
            "ON expense_payment_sources (LOWER(name)) WHERE COALESCE(is_deleted, 0) = 0"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS material_expenses (
                id                TEXT PRIMARY KEY,
                exp_number        TEXT NOT NULL UNIQUE,
                spent_on          TEXT NOT NULL,
                category_id       TEXT REFERENCES expense_categories(id),
                name              TEXT NOT NULL,
                quantity          NUMERIC(14, 3) NOT NULL DEFAULT 0,
                unit              TEXT,
                amount            INTEGER NOT NULL DEFAULT 0,
                payment_source_id TEXT REFERENCES expense_payment_sources(id),
                supplier          TEXT,
                comment           TEXT,
                created_at        TEXT NOT NULL,
                created_by        TEXT,
                updated_at        TEXT,
                is_deleted        INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_spent_on ON material_expenses(spent_on)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_category ON material_expenses(category_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_source ON material_expenses(payment_source_id)")
        # Единый реестр расходов: тип / статус оплаты / origin / период (миграция 0057).
        conn.execute("""
            ALTER TABLE IF EXISTS material_expenses
                ADD COLUMN IF NOT EXISTS kind           TEXT NOT NULL DEFAULT 'manual',
                ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid',
                ADD COLUMN IF NOT EXISTS paid_on        TEXT,
                ADD COLUMN IF NOT EXISTS source_kind    TEXT,
                ADD COLUMN IF NOT EXISTS source_id      TEXT,
                ADD COLUMN IF NOT EXISTS period_start   TEXT,
                ADD COLUMN IF NOT EXISTS period_end     TEXT
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_kind ON material_expenses(kind)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_pay_status ON material_expenses(payment_status)")
        # Частичная оплата + перевозчик логистического расхода (миграция 0068).
        conn.execute("""
            ALTER TABLE IF EXISTS material_expenses
                ADD COLUMN IF NOT EXISTS paid_amount INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS carrier_id  TEXT
        """)
        conn.execute(
            "UPDATE material_expenses SET paid_amount = amount "
            "WHERE payment_status = 'paid' AND paid_amount = 0"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_carrier ON material_expenses(carrier_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_payments (
                id                TEXT PRIMARY KEY,
                expense_id        TEXT NOT NULL REFERENCES material_expenses(id),
                amount            INTEGER NOT NULL,
                paid_on           TEXT,
                payment_source_id TEXT,
                comment           TEXT,
                created_at        TEXT NOT NULL,
                created_by        TEXT,
                is_deleted        INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments(expense_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_ops (
                id         TEXT PRIMARY KEY,
                expense_id TEXT NOT NULL REFERENCES material_expenses(id),
                op_type    TEXT NOT NULL,
                comment    TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expense_ops_expense ON expense_ops(expense_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expense_files (
                id         TEXT PRIMARY KEY,
                expense_id TEXT NOT NULL,
                filename   TEXT NOT NULL,
                url        TEXT NOT NULL,
                mime_type  TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expense_files_expense ON expense_files(expense_id)")
        _seed_expense_dictionaries(conn)
        # Табель и выплаты — на случай dev-старта без alembic.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                id          TEXT PRIMARY KEY,
                full_name   TEXT NOT NULL,
                position    TEXT,
                status      TEXT NOT NULL DEFAULT 'active',
                hired_on    TEXT,
                created_at  TEXT NOT NULL,
                created_by  TEXT,
                updated_at  TEXT,
                is_deleted  INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS employee_rates (
                id             TEXT PRIMARY KEY,
                employee_id    TEXT NOT NULL REFERENCES employees(id),
                rate_kopecks   INTEGER NOT NULL,
                effective_from TEXT NOT NULL,
                note           TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_employee_rates_emp "
            "ON employee_rates(employee_id, effective_from)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS timesheet_entries (
                id            TEXT PRIMARY KEY,
                employee_id   TEXT NOT NULL REFERENCES employees(id),
                work_date     TEXT NOT NULL,
                planned_start TEXT,
                planned_end   TEXT,
                actual_start  TEXT,
                actual_end    TEXT,
                is_absent     INTEGER NOT NULL DEFAULT 0,
                not_called    INTEGER NOT NULL DEFAULT 0,
                no_lunch      INTEGER NOT NULL DEFAULT 0,
                end_next_day  INTEGER NOT NULL DEFAULT 0,
                note          TEXT,
                created_at    TEXT NOT NULL,
                created_by    TEXT,
                updated_at    TEXT,
                is_deleted    INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_timesheet_entries_date ON timesheet_entries(work_date)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_entries_emp_date_unique "
            "ON timesheet_entries(employee_id, work_date) WHERE is_deleted = 0"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS timesheet_ops (
                id         TEXT PRIMARY KEY,
                entry_id   TEXT NOT NULL REFERENCES timesheet_entries(id),
                op_type    TEXT NOT NULL,
                comment    TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_timesheet_ops_entry ON timesheet_ops(entry_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS payroll_payments (
                id             TEXT PRIMARY KEY,
                employee_id    TEXT NOT NULL REFERENCES employees(id),
                amount_kopecks INTEGER NOT NULL,
                kind           TEXT NOT NULL DEFAULT 'settlement',
                paid_on        TEXT,
                period_start   TEXT,
                period_end     TEXT,
                comment        TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_payroll_payments_emp ON payroll_payments(employee_id)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_payroll_payments_period "
            "ON payroll_payments(period_start, period_end)"
        )
        # Тарифы упаковки (effective-dated, годный/брак, по клиенту) — для dev-старта без alembic.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS product_packing_prices (
                id             TEXT PRIMARY KEY,
                product_id     TEXT NOT NULL,
                client_id      TEXT NOT NULL,
                quality        TEXT NOT NULL,
                price_kop      INTEGER NOT NULL,
                effective_from TEXT NOT NULL,
                note           TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_packing_prices_lookup "
            "ON product_packing_prices (product_id, client_id, quality, effective_from)"
        )
        # Палеты: кол-во в строке отгрузки + цена палета по клиенту — для dev-старта без alembic.
        conn.execute("ALTER TABLE IF EXISTS dispatch_lines ADD COLUMN IF NOT EXISTS pallets_qty INTEGER")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS client_pallet_prices (
                id             TEXT PRIMARY KEY,
                client_id      TEXT NOT NULL,
                price_kop      INTEGER NOT NULL,
                effective_from TEXT NOT NULL,
                note           TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_pallet_prices_lookup "
            "ON client_pallet_prices (client_id, effective_from)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS recurring_expenses (
                id                TEXT PRIMARY KEY,
                name              TEXT NOT NULL,
                category_id       TEXT,
                payment_source_id TEXT,
                supplier          TEXT,
                frequency         TEXT NOT NULL,
                month_day         INTEGER,
                start_date        TEXT NOT NULL,
                end_date          TEXT,
                is_active         INTEGER NOT NULL DEFAULT 1,
                created_at        TEXT NOT NULL,
                created_by        TEXT,
                updated_at        TEXT,
                is_deleted        INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS recurring_expense_rates (
                id             TEXT PRIMARY KEY,
                template_id    TEXT NOT NULL,
                amount_kop     INTEGER NOT NULL,
                effective_from TEXT NOT NULL,
                note           TEXT,
                created_at     TEXT NOT NULL,
                created_by     TEXT,
                is_deleted     INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_recurring_expense_rates_lookup "
            "ON recurring_expense_rates (template_id, effective_from)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS production_calendar (
                id          TEXT PRIMARY KEY,
                cal_date    TEXT NOT NULL,
                is_working  INTEGER NOT NULL,
                reason      TEXT,
                created_at  TEXT NOT NULL,
                created_by  TEXT,
                updated_at  TEXT,
                is_deleted  INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_production_calendar_date "
            "ON production_calendar (cal_date) WHERE is_deleted = 0"
        )
        conn.commit()


async def _accrual_loop() -> None:
    """Фоновое автоначисление: ЗП-оклады (одна проводка на месяц, 1-го числа / в день
    приёма), аренда складов (1-е число) и регулярные расходы по шаблонам (ежедневно /
    в число месяца). Будится раз в час; дедуп по периоду делает повторные прогоны и
    рестарты безопасными. Отключается в тестах (SALARY_SCHEDULER=0), чтобы не писать в
    тестовую БД."""
    from idempotency import purge_expired_idempotency_keys
    from modules.expenses.service import run_rent_accruals, run_salary_accruals
    from modules.recurring_expenses.service import run_recurring_accruals
    from modules.timesheet.service import business_today

    while True:
        try:
            with get_connection() as conn:
                today = business_today()
                created = run_salary_accruals(conn, today)
                created += run_rent_accruals(conn, today)
                created += run_recurring_accruals(conn, today)
                if created:
                    conn.commit()
                purge_expired_idempotency_keys(conn)
                conn.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(exist_ok=True)
    init_pool()
    _ensure_runtime_schema()
    accrual_task = (
        asyncio.create_task(_accrual_loop())
        if os.environ.get("SALARY_SCHEDULER", "1") == "1"
        else None
    )
    yield
    if accrual_task is not None:
        accrual_task.cancel()
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

@app.middleware("http")
async def _auth_rate_limit_middleware(request: Request, call_next):
    if request.method == "POST":
        p = request.url.path
        if p == "/auth/login":
            rl_resp = await check_login_rate_limits(request)
            if rl_resp is not None:
                return rl_resp
        elif p == "/auth/refresh":
            rl_resp = await check_refresh_rate_limit(request)
            if rl_resp is not None:
                return rl_resp
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
app.include_router(locations_router)
app.include_router(inventory_router)
app.include_router(products_router)
app.include_router(pricing_router)
app.include_router(pallet_pricing_router)
app.include_router(production_calendar_router)
app.include_router(warehouse_rent_router)
app.include_router(receipts_router)
app.include_router(shipments_router)
app.include_router(dispatch_router)
app.include_router(balances_router)
app.include_router(cabinet_router)
app.include_router(invoices_router)
app.include_router(expenses_router)
app.include_router(recurring_expenses_router)
app.include_router(timesheet_router)
app.include_router(logistics_router)
app.include_router(tasks_router)
app.include_router(scan_router)
app.include_router(dashboard_router)
