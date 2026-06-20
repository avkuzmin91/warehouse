"""Табель: флаг «Не вызван» (простой не по вине сотрудника).

Когда склад намеренно не выводит сотрудника (нет товара от заказчика и т.п.), день
не должен считаться прогулом. Отдельный флаг `not_called` даёт третий вид нерабочего
дня рядом с «Выходной» (нет записи) и «Не вышел» (прогул, is_absent). План при этом
сохраняется. Выводимый статус дня — `not_called`, в «невыходы» не попадает, не
оплачивается. Взаимоисключающий с is_absent (управляется на уровне роутера).

Revision ID: 0059
Revises: 0058
Create Date: 2026-06-20
"""

from __future__ import annotations

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE timesheet_entries ADD COLUMN not_called INTEGER NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE timesheet_entries DROP COLUMN not_called")
