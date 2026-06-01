"""Add comment to receipt_docs.

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-01
"""

from __future__ import annotations

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE receipt_docs ADD COLUMN IF NOT EXISTS comment TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE receipt_docs DROP COLUMN IF EXISTS comment")
