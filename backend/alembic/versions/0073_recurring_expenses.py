"""Регулярные расходы: шаблоны + ставка с историей (effective-dated).

Справочник повторяющихся хозрасходов (погрузчик, интернет, охрана…), чтобы не
вносить один и тот же расход вручную каждый день. Планировщик заводит по записи в
едином реестре (kind=recurring, ожидает оплаты): ежедневные — каждый день,
ежемесячные — в заданное число месяца. Стоимость хранится в отдельной таблице ставок
с датой действия — сменилась цена → добавили запись, прошлые начисления не трогаем.
Действующая ставка ищется тем же правилом, что и тариф упаковки (`pricing.price_on`):
последняя запись с effective_from <= дата начисления. Деньги — копейки INTEGER.

Revision ID: 0073
Revises: 0072
Create Date: 2026-06-26
"""

from __future__ import annotations

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS recurring_expenses (
            id                TEXT PRIMARY KEY,
            name              TEXT NOT NULL,
            category_id       TEXT,
            payment_source_id TEXT,
            supplier          TEXT,
            frequency         TEXT NOT NULL,
            month_day         INTEGER,
            start_date        TEXT NOT NULL,
            end_date          TEXT,
            is_active         INTEGER NOT NULL DEFAULT 1,
            created_at        TEXT NOT NULL,
            created_by        TEXT,
            updated_at        TEXT,
            is_deleted        INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS recurring_expense_rates (
            id             TEXT PRIMARY KEY,
            template_id    TEXT NOT NULL,
            amount_kop     INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_recurring_expense_rates_lookup "
        "ON recurring_expense_rates (template_id, effective_from)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS recurring_expense_rates")
    op.execute("DROP TABLE IF EXISTS recurring_expenses")
