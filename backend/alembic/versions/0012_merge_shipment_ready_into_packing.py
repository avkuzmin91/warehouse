"""Merge shipment ready status into packing.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-31
"""

from __future__ import annotations

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("UPDATE shipment_docs SET status = 'packing' WHERE status = 'ready'")


def downgrade() -> None:
    pass
