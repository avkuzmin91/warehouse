"""Drop legacy inventory operations table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-27
"""

from __future__ import annotations

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS inventory_operations CASCADE")


def downgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS inventory_operations (
            id              TEXT PRIMARY KEY,
            op_type         TEXT NOT NULL,
            product_id      TEXT NOT NULL,
            color_id        TEXT,
            size_id         TEXT,
            quantity        INTEGER NOT NULL,
            note            TEXT,
            created_at      TEXT NOT NULL,
            created_by_id   TEXT,
            variant_id      TEXT,
            variant_sku     TEXT,
            receipt_status  TEXT,
            is_deleted      INTEGER NOT NULL DEFAULT 0,
            deleted_at      TEXT,
            deleted_by_id   TEXT,
            shipment_status TEXT,
            inspected_qty   INTEGER NOT NULL DEFAULT 0,
            defect_qty      INTEGER NOT NULL DEFAULT 0,
            shipment_type   TEXT NOT NULL DEFAULT 'good'
        )
    """)
