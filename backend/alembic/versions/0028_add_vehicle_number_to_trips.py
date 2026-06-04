"""Add vehicle number to trip docs.

Revision ID: 0028
Revises: 0027
Create Date: 2026-06-05
"""

from __future__ import annotations

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE trip_docs ADD COLUMN IF NOT EXISTS vehicle_number TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE trip_docs DROP COLUMN IF EXISTS vehicle_number")
