"""Add shipment_doc_id to trip_lines for outbound trips.

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-04
"""

from __future__ import annotations

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Outbound-рейсы ссылаются на отгрузки. receipt_doc_id остаётся для inbound,
    # одна из двух колонок заполнена в зависимости от trip_docs.direction.
    op.execute("ALTER TABLE trip_lines ALTER COLUMN receipt_doc_id DROP NOT NULL")
    op.execute("ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS shipment_doc_id TEXT")
    # Отгрузка принадлежит не более чем одному активному рейсу (зеркало receipt-индекса).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_shipment_unique "
        "ON trip_lines(shipment_doc_id) WHERE is_deleted = 0 AND shipment_doc_id IS NOT NULL"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_trip_lines_shipment_unique")
    op.execute("ALTER TABLE trip_lines DROP COLUMN IF EXISTS shipment_doc_id")
