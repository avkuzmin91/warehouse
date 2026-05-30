"""Add accepted_qty (Принят) to receipt lines.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-29

accepted_qty — сколько товара по строке физически принято всего (годный + брак),
вводится обязательно при фиксации прибытия. NULL = прибытие ещё не зафиксировано.
planned_qty остаётся информационным «План». Бэкафилла нет — реальных данных ещё нет.
"""

from __future__ import annotations

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            ADD COLUMN IF NOT EXISTS accepted_qty INTEGER
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            DROP COLUMN IF EXISTS accepted_qty
    """)
