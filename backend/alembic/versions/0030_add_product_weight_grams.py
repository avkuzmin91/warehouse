"""Add product weight in grams.

Revision ID: 0030
Revises: 0029
Create Date: 2026-06-05
"""

from __future__ import annotations

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_grams INTEGER")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS weight_grams")
