"""Add packed_qty to shipment_lines.

Revision ID: 0032
Revises: 0031
Create Date: 2026-06-07
"""

from __future__ import annotations

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines ADD COLUMN packed_qty INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    pass
