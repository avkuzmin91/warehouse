"""Add unload_started_at to trip_docs.

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-03
"""

from __future__ import annotations

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE trip_docs ADD COLUMN IF NOT EXISTS unload_started_at TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE trip_docs DROP COLUMN IF EXISTS unload_started_at")
