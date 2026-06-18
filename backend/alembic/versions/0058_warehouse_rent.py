"""Справочник «Наши склады» (own_warehouses) + ежемесячная аренда.

Отдельный admin-only справочник собственных складов компании с полем ставки аренды
(копейки). Не путать с `warehouses` — это «Точки логистики» (внешние, origin рейсов).
Планировщик 1-го числа каждого месяца заводит по записи в едином реестре расходов
(kind=rent, ожидает оплаты) на каждый активный наш склад с заданной ставкой.

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

    op.execute("""
        CREATE TABLE IF NOT EXISTS own_warehouses (
            id                   TEXT PRIMARY KEY,
            name                 TEXT UNIQUE NOT NULL,
            rent_monthly_kopecks INTEGER,
            is_active            INTEGER NOT NULL DEFAULT 1,
            created_at           TEXT NOT NULL,
            creator_id           TEXT,
            updated_at           TEXT,
            updated_by_id        TEXT,
            is_deleted           INTEGER NOT NULL DEFAULT 0,
            deleted_at           TEXT,
            deleted_by_id        TEXT
        )
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS own_warehouses")
