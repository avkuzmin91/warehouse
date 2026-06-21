"""Allow products/variants without known SKU yet (sku_pending flag).

Revision ID: 0061
Revises: 0060
Create Date: 2026-06-21
"""

from __future__ import annotations

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS sku_pending INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sku_pending INTEGER NOT NULL DEFAULT 0")

    # Уникальность SKU per client — только среди позиций с присвоенным SKU.
    # Позиции «ожидают SKU» (sku_pending=1, sku='') между собой не конфликтуют.
    op.execute("DROP INDEX IF EXISTS products_client_sku_active_uq")
    op.execute("DROP INDEX IF EXISTS product_variants_client_sku_active_uq")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS products_client_sku_active_uq
        ON products (client_id, sku)
        WHERE COALESCE(is_deleted, 0) = 0 AND COALESCE(sku_pending, 0) = 0
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS product_variants_client_sku_active_uq
        ON product_variants (client_id, sku)
        WHERE COALESCE(is_deleted, 0) = 0 AND COALESCE(sku_pending, 0) = 0
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS product_variants_client_sku_active_uq")
    op.execute("DROP INDEX IF EXISTS products_client_sku_active_uq")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS products_client_sku_active_uq
        ON products (client_id, sku)
        WHERE COALESCE(is_deleted, 0) = 0
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS product_variants_client_sku_active_uq
        ON product_variants (client_id, sku)
        WHERE COALESCE(is_deleted, 0) = 0
    """)
    op.execute("ALTER TABLE product_variants DROP COLUMN IF EXISTS sku_pending")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS sku_pending")
