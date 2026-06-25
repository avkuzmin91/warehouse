"""Количество палет в строке отгрузки (для тарификации палет клиенту).

Revision ID: 0070
Revises: 0069
Create Date: 2026-06-25

Менеджер указывает число палет по каждой строке отгрузки при создании. Система
подсказывает рекомендацию из `products.items_per_pallet` (кратность на палете),
менеджер может переопределить. Сумма палет по документу × цена палета клиента
(client_pallet_prices) попадает в счёт отдельным компонентом.
"""

from __future__ import annotations

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE IF EXISTS dispatch_lines ADD COLUMN IF NOT EXISTS pallets_qty INTEGER")


def downgrade() -> None:
    pass
