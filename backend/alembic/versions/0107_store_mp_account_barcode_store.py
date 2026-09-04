"""Магазин клиента ↔ кабинет маркетплейса, магазин у штрих-кода.

Revision ID: 0107
Revises: 0106
Create Date: 2026-09-03
"""

from __future__ import annotations

revision = "0107"
down_revision = "0106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE client_stores ADD COLUMN IF NOT EXISTS mp_account_id TEXT")
    op.execute("ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS store_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcodes_store_idx "
        "ON product_barcodes (variant_id, store_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS product_barcodes_store_idx")
    op.execute("ALTER TABLE product_barcodes DROP COLUMN IF EXISTS store_id")
    op.execute("ALTER TABLE client_stores DROP COLUMN IF EXISTS mp_account_id")
