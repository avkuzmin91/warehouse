"""Add logistics_cost to shipment_docs.

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-01

Колонка читалась кодом (shipments router/schemas), но добавлялась в dev-БД
вне миграций — на уже существующих базах (test/prod) её не было → KeyError на
GET /shipments. Догоняем миграцией (IF NOT EXISTS — на dev no-op).
"""

from __future__ import annotations

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs ADD COLUMN IF NOT EXISTS logistics_cost REAL DEFAULT 0")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs DROP COLUMN IF EXISTS logistics_cost")
