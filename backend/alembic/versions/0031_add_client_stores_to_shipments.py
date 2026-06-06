"""Add client stores to shipment lines.

Revision ID: 0031
Revises: 0030
Create Date: 2026-06-06
"""

from __future__ import annotations

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS client_stores (
            id            TEXT PRIMARY KEY,
            client_id     TEXT NOT NULL,
            name          TEXT NOT NULL,
            is_active     INTEGER NOT NULL DEFAULT 1,
            is_deleted    INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL,
            creator_id    TEXT,
            updated_at    TEXT,
            updated_by_id TEXT,
            deleted_at    TEXT,
            deleted_by_id TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_client_stores_client ON client_stores(client_id)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_client_stores_client_name_active
        ON client_stores(client_id, LOWER(TRIM(name)))
        WHERE COALESCE(is_deleted, 0) = 0
    """)
    op.execute("ALTER TABLE shipment_lines ADD COLUMN IF NOT EXISTS store_id TEXT")
    op.execute("ALTER TABLE shipment_lines ADD COLUMN IF NOT EXISTS store_name TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines DROP COLUMN IF EXISTS store_name")
    op.execute("ALTER TABLE shipment_lines DROP COLUMN IF EXISTS store_id")
    op.execute("DROP INDEX IF EXISTS ux_client_stores_client_name_active")
    op.execute("DROP INDEX IF EXISTS idx_client_stores_client")
    op.execute("DROP TABLE IF EXISTS client_stores")
