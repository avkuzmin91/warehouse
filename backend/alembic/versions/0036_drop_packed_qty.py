"""Drop unused shipment_lines.packed_qty (Iteration 2 cleanup).

Revision ID: 0036
Revises: 0035
Create Date: 2026-06-08

Колонка packed_qty (из 0032) больше не используется: факт упаковки считается из журнала
конвертаций (packed_good/packed_defect по shipment_line_id).
"""

from __future__ import annotations

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines DROP COLUMN IF EXISTS packed_qty")


def downgrade() -> None:
    pass
