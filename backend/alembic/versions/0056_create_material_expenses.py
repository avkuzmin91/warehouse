"""Create material expenses (хозрасходы): material_expenses + 2 справочника + журнал + файлы.

Суммы (amount) — в копейках (INTEGER), как в счетах/табеле, чтобы денежный учёт
не накапливал ошибок округления. Количество (quantity) — NUMERIC: расходники
бывают дробными. Журнал expense_ops — append-only, по образцу invoice_ops.

Revision ID: 0056
Revises: 0055
Create Date: 2026-06-17
"""

from __future__ import annotations

from uuid import uuid4

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    from config import EXPENSE_CATEGORY_SEED, EXPENSE_PAYMENT_SOURCE_SEED

    # --- Справочник категорий ---
    op.execute("""
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
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_name "
        "ON expense_categories (LOWER(name)) WHERE COALESCE(is_deleted, 0) = 0"
    )

    # --- Справочник источников оплаты (с чьей карты платили) ---
    op.execute("""
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
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_payment_sources_name "
        "ON expense_payment_sources (LOWER(name)) WHERE COALESCE(is_deleted, 0) = 0"
    )

    # --- Расход (строка журнала закупок) ---
    op.execute("""
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
    op.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_spent_on ON material_expenses(spent_on)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_category ON material_expenses(category_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_source ON material_expenses(payment_source_id)")

    # --- Журнал операций по расходу (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS expense_ops (
            id         TEXT PRIMARY KEY,
            expense_id TEXT NOT NULL REFERENCES material_expenses(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_expense_ops_expense ON expense_ops(expense_id)")

    # --- Вложения (фото/скан чека) ---
    op.execute("""
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
    op.execute("CREATE INDEX IF NOT EXISTS idx_expense_files_expense ON expense_files(expense_id)")

    # --- Сид справочников ---
    for i, name in enumerate(EXPENSE_CATEGORY_SEED):
        op.execute(
            "INSERT INTO expense_categories (id, name, sort_order, created_at) "
            "VALUES ('%s', '%s', %d, NOW()::text)"
            % (uuid4(), name.replace("'", "''"), i)
        )
    for i, name in enumerate(EXPENSE_PAYMENT_SOURCE_SEED):
        op.execute(
            "INSERT INTO expense_payment_sources (id, name, sort_order, created_at) "
            "VALUES ('%s', '%s', %d, NOW()::text)"
            % (uuid4(), name.replace("'", "''"), i)
        )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS expense_files")
    op.execute("DROP TABLE IF EXISTS expense_ops")
    op.execute("DROP TABLE IF EXISTS material_expenses")
    op.execute("DROP TABLE IF EXISTS expense_payment_sources")
    op.execute("DROP TABLE IF EXISTS expense_categories")
