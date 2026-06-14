"""Add manual shipment priority.

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-08
"""

from __future__ import annotations

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs ADD COLUMN IF NOT EXISTS priority_rank INTEGER")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs DROP COLUMN IF EXISTS priority_rank")
