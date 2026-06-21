"""Табель: флаги факта «без обеда» и «смена до следующего дня».

Два свойства реально отработанной смены, которые знает вносящий факт:

- `no_lunch` — сотрудник вышел без обеда, час вычитать не нужно (выясняется по факту).
- `end_next_day` — смена закончилась на следующий день (08:00 → 02:00): уход ≤ приход
  по часам, поэтому к `actual_end` при расчёте добавляется +24 ч. Смена остаётся
  привязанной к дню начала (`work_date`) — недельная корзина и ставка не меняются.

Оба относятся только к факту; план остаётся как есть.

Revision ID: 0060
Revises: 0059
Create Date: 2026-06-20
"""

from __future__ import annotations

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE timesheet_entries ADD COLUMN no_lunch INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE timesheet_entries ADD COLUMN end_next_day INTEGER NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE timesheet_entries DROP COLUMN end_next_day")
    op.execute("ALTER TABLE timesheet_entries DROP COLUMN no_lunch")
