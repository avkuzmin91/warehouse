"""Add actual_ship_date to shipment_docs.

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-04
"""

from __future__ import annotations

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs ADD COLUMN IF NOT EXISTS actual_ship_date TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs DROP COLUMN IF EXISTS actual_ship_date")
