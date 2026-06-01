"""Add position name snapshots to zone_relocations (for the relocations journal).

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-01

Снимки имён товара/клиента/цвета/размера на момент перемещения — чтобы журнал
перемещений отображался без хрупких join'ов по id.
"""

from __future__ import annotations

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE zone_relocations
            ADD COLUMN IF NOT EXISTS product_name TEXT,
            ADD COLUMN IF NOT EXISTS product_sku  TEXT,
            ADD COLUMN IF NOT EXISTS color_name   TEXT,
            ADD COLUMN IF NOT EXISTS size_name    TEXT,
            ADD COLUMN IF NOT EXISTS client_name  TEXT
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE zone_relocations
            DROP COLUMN IF EXISTS client_name,
            DROP COLUMN IF EXISTS size_name,
            DROP COLUMN IF EXISTS color_name,
            DROP COLUMN IF EXISTS product_sku,
            DROP COLUMN IF EXISTS product_name
    """)
