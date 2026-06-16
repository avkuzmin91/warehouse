"""Поступление несколькими inbound-рейсами: снять уникальность поступления в рейсе.

Зеркало 0052 для inbound: поступление может приезжать несколькими рейсами с
распределением по строкам (`trip_alloc.receipt_line_id` уже создан в 0052).
Уникальность «поступление ↔ один рейс» заменяется на (trip_id, receipt_doc_id):
поступление может быть в нескольких рейсах, но не дважды в одном рейсе.

Revision ID: 0053
Revises: 0052
Create Date: 2026-06-15
"""

from __future__ import annotations

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_trip_lines_receipt_unique")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_receipt_per_trip "
        "ON trip_lines(trip_id, receipt_doc_id) "
        "WHERE is_deleted = 0 AND receipt_doc_id IS NOT NULL"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_trip_lines_receipt_per_trip")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_receipt_unique "
        "ON trip_lines(receipt_doc_id) WHERE is_deleted = 0"
    )
