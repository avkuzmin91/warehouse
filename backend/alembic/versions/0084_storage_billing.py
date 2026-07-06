"""Платное хранение остатков: тариф клиента + журнал начислений + привязка к счёту.

Тариф (client_storage_prices) — effective-dated, как цены палет/коробов, но запись
несёт полные условия: единица тарификации (piece/box/pallet), ставка за единицу
в день (копейки INTEGER) и бесплатный период (free_days, календарные дни).
Начало отсчёта хранения клиента = effective_from самой ранней записи.

storage_charges — append-only журнал ежедневных начислений (уникальность по
клиенту и дню делает фоновый прогон идемпотентным), storage_charge_lines —
детализация по партиям (лотам приёмки). invoice_storage_charges — зеркало
invoice_extra_income: дневное начисление входит не более чем в один активный счёт.

Revision ID: 0084
Revises: 0083
Create Date: 2026-07-05
"""

from __future__ import annotations

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # --- Тариф хранения по клиенту (effective-dated, append-only история) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS client_storage_prices (
            id             TEXT PRIMARY KEY,
            client_id      TEXT NOT NULL,
            unit           TEXT NOT NULL,
            price_kop      INTEGER NOT NULL,
            free_days      INTEGER NOT NULL DEFAULT 0,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_client_storage_prices_client "
        "ON client_storage_prices(client_id)"
    )

    # --- Ежедневные начисления (append-only; повторный прогон дня невозможен) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS storage_charges (
            id                   TEXT PRIMARY KEY,
            client_id            TEXT NOT NULL,
            charge_date          TEXT NOT NULL,
            unit                 TEXT NOT NULL,
            rate_kop             INTEGER NOT NULL,
            free_days            INTEGER NOT NULL,
            qty_pieces           INTEGER NOT NULL DEFAULT 0,
            units_qty            INTEGER NOT NULL DEFAULT 0,
            amount_kop           INTEGER NOT NULL DEFAULT 0,
            missing_capacity_qty INTEGER NOT NULL DEFAULT 0,
            created_at           TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_charges_client_day "
        "ON storage_charges(client_id, charge_date)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_storage_charges_day ON storage_charges(charge_date)")

    # --- Детализация начисления по партиям (лотам приёмки) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS storage_charge_lines (
            id                 TEXT PRIMARY KEY,
            charge_id          TEXT NOT NULL REFERENCES storage_charges(id),
            receipt_line_id    TEXT,
            receipt_doc_id     TEXT,
            receipt_doc_number TEXT,
            product_id         TEXT,
            product_sku        TEXT,
            product_name       TEXT,
            color_name         TEXT,
            size_name          TEXT,
            accepted_on        TEXT,
            age_days           INTEGER NOT NULL DEFAULT 0,
            qty_pieces         INTEGER NOT NULL DEFAULT 0,
            billable_qty       INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_storage_charge_lines_charge "
        "ON storage_charge_lines(charge_id)"
    )

    # --- Привязка начислений к счёту (зеркало invoice_extra_income) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_storage_charges (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
            charge_id  TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_storage_charges_invoice "
        "ON invoice_storage_charges(invoice_id)"
    )
    # Дневное начисление принадлежит не более чем одному активному счёту.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_storage_charges_charge_unique "
        "ON invoice_storage_charges(charge_id) WHERE is_deleted = 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS invoice_storage_charges")
    op.execute("DROP TABLE IF EXISTS storage_charge_lines")
    op.execute("DROP TABLE IF EXISTS storage_charges")
    op.execute("DROP TABLE IF EXISTS client_storage_prices")
