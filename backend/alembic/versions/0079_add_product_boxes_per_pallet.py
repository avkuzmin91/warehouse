"""Add product boxes per pallet.

Revision ID: 0079
Revises: 0078
Create Date: 2026-07-01
"""

from __future__ import annotations

revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS boxes_per_pallet INTEGER")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS boxes_per_pallet")
