"""Add storage zone to receipt lines.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29
"""

from __future__ import annotations

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            ADD COLUMN IF NOT EXISTS storage_zone_id TEXT,
            ADD COLUMN IF NOT EXISTS storage_zone_name TEXT
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            DROP COLUMN IF EXISTS storage_zone_name,
            DROP COLUMN IF EXISTS storage_zone_id
    """)
