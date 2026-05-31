"""Add shipped_qty to shipment_lines.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-31
"""

from __future__ import annotations

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines ADD COLUMN shipped_qty INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    pass
