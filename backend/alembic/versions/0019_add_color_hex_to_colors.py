"""Add color hex to colors.

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-01
"""

from __future__ import annotations

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE colors ADD COLUMN IF NOT EXISTS color_hex TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE colors DROP COLUMN IF EXISTS color_hex")
