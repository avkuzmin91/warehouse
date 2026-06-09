"""Add product items per pallet.

Revision ID: 0041
Revises: 0040
Create Date: 2026-06-09
"""

from __future__ import annotations

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS items_per_pallet INTEGER")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS items_per_pallet")
