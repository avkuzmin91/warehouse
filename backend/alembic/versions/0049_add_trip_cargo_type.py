"""Add cargo_type to trip_docs (good|defect) for outbound trips.

Revision ID: 0049
Revises: 0048
Create Date: 2026-06-13
"""

from __future__ import annotations

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Тип груза рейса отгрузки: товар (good) | брак (defect). Зеркало shipment_docs.cargo_type.
    # Существующие рейсы и все рейсы поступления — 'good'.
    op.execute("ALTER TABLE trip_docs ADD COLUMN IF NOT EXISTS cargo_type TEXT NOT NULL DEFAULT 'good'")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE trip_docs DROP COLUMN IF EXISTS cargo_type")
