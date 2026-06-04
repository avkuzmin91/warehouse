"""Make product SKU unique per client.

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-03
"""

from __future__ import annotations

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS client_id TEXT")
    op.execute("""
        UPDATE product_variants v
        SET client_id = p.client_id
        FROM products p
        WHERE p.id = v.product_id
          AND v.client_id IS DISTINCT FROM p.client_id
    """)

    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key")
    op.execute("ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key")

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
    op.execute("CREATE INDEX IF NOT EXISTS product_variants_client_idx ON product_variants(client_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS product_variants_client_idx")
    op.execute("DROP INDEX IF EXISTS product_variants_client_sku_active_uq")
    op.execute("DROP INDEX IF EXISTS products_client_sku_active_uq")
    op.execute("ALTER TABLE products ADD CONSTRAINT products_sku_key UNIQUE (sku)")
    op.execute("ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku)")
    op.execute("ALTER TABLE product_variants DROP COLUMN IF EXISTS client_id")
