"""Add actual_arrival_date to receipt_docs.

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-04
"""

from __future__ import annotations

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE receipt_docs ADD COLUMN IF NOT EXISTS actual_arrival_date TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE receipt_docs DROP COLUMN IF EXISTS actual_arrival_date")
