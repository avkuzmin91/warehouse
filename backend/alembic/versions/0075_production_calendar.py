"""Производственный календарь склада (production_calendar).

Справочник исключений из правила рабочей недели 6/1 (рабочий = любой день, кроме
воскресенья). Каждая строка — переопределение конкретной даты в обе стороны:
праздник / внеплановое закрытие помечает нормально рабочий день нерабочим, а выход
в воскресенье — наоборот. Глобальный (праздники национальны); per-warehouse не вводим
до второго реального случая. Используется делителем «рабочих дней в месяце» при дневной
разбивке оклада (аналитика и начисление в реестр).

Revision ID: 0075
Revises: 0074
Create Date: 2026-06-27
"""

from __future__ import annotations

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS production_calendar (
            id          TEXT PRIMARY KEY,
            cal_date    TEXT NOT NULL,
            is_working  INTEGER NOT NULL,
            reason      TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT,
            updated_at  TEXT,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_production_calendar_date "
        "ON production_calendar (cal_date) WHERE is_deleted = 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS production_calendar")
