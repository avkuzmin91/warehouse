"""Доп. работы (прочие доходы): extra_income_entries + справочник + журнал + привязка к счёту.

Ручной доход по дате (переборка брака, переклейка ШК): суммы — копейки INTEGER,
атрибуция в P&L по entry_date. invoice_extra_income — зеркало invoice_shipments:
запись входит не более чем в один активный счёт (уникальный частичный индекс).

Revision ID: 0081
Revises: 0080
Create Date: 2026-07-03
"""

from __future__ import annotations

from uuid import uuid4

revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    from config import EXTRA_INCOME_CATEGORY_SEED

    # --- Справочник видов работ ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS extra_income_categories (
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_extra_income_categories_name "
        "ON extra_income_categories (LOWER(name)) WHERE COALESCE(is_deleted, 0) = 0"
    )

    # --- Запись доп. работы ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS extra_income_entries (
            id          TEXT PRIMARY KEY,
            entry_date  TEXT NOT NULL,
            client_id   TEXT NOT NULL,
            category_id TEXT REFERENCES extra_income_categories(id),
            qty         INTEGER,
            amount_kop  INTEGER NOT NULL DEFAULT 0,
            comment     TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT,
            updated_at  TEXT,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_extra_income_entries_date ON extra_income_entries(entry_date)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_extra_income_entries_client ON extra_income_entries(client_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_extra_income_entries_category ON extra_income_entries(category_id)")

    # --- Журнал операций (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS extra_income_ops (
            id         TEXT PRIMARY KEY,
            entry_id   TEXT NOT NULL REFERENCES extra_income_entries(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_extra_income_ops_entry ON extra_income_ops(entry_id)")

    # --- Привязка к счёту (зеркало invoice_shipments) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_extra_income (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
            entry_id   TEXT NOT NULL,
            client_id  TEXT,
            client_name TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_extra_income_invoice ON invoice_extra_income(invoice_id)")
    # Запись доп. работы принадлежит не более чем одному активному счёту.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_extra_income_entry_unique "
        "ON invoice_extra_income(entry_id) WHERE is_deleted = 0"
    )

    # --- Сид справочника ---
    for i, name in enumerate(EXTRA_INCOME_CATEGORY_SEED):
        op.execute(
            "INSERT INTO extra_income_categories (id, name, sort_order, created_at) "
            "VALUES ('%s', '%s', %d, NOW()::text)"
            % (uuid4(), name.replace("'", "''"), i)
        )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS invoice_extra_income")
    op.execute("DROP TABLE IF EXISTS extra_income_ops")
    op.execute("DROP TABLE IF EXISTS extra_income_entries")
    op.execute("DROP TABLE IF EXISTS extra_income_categories")
