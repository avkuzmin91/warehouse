"""Add storage_zone_id/name to shipment_lines.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-31
"""

from __future__ import annotations

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines ADD COLUMN storage_zone_id   TEXT")
    op.execute("ALTER TABLE shipment_lines ADD COLUMN storage_zone_name TEXT")


def downgrade() -> None:
    pass
