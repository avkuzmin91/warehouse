"""Ежемесячная аренда склада: ставка на карточке склада.

Добавляет складу ставку аренды (копейки). Планировщик 1-го числа каждого месяца
заводит по записи в едином реестре расходов (kind=rent, ожидает оплаты) на каждый
активный склад с заданной ставкой.

Revision ID: 0058
Revises: 0057
Create Date: 2026-06-17
"""

from __future__ import annotations

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS rent_monthly_kopecks INTEGER"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE warehouses DROP COLUMN IF EXISTS rent_monthly_kopecks")
