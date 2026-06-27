"""Effective-dated ставка аренды складов (warehouse_rent_rates).

Аренда «Наших складов» переезжает с одного поля own_warehouses.rent_monthly_kopecks
на append-only историю ставок с датой начала действия — как стоимость палета/упаковки.
Действующая ставка ищется тем же правилом pricing.service.price_on: последняя запись
с effective_from <= дата, самая ранняя тянется назад. Колонка rent_monthly_kopecks
остаётся денормализованным кэшем «ставки на сегодня» для списка справочника и lookups.

Сид: текущая ставка каждого склада переносится в историю записью с effective_from =
датой создания склада, чтобы ранее заведённая аренда не потерялась.

Revision ID: 0074
Revises: 0073
Create Date: 2026-06-27
"""

from __future__ import annotations

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS warehouse_rent_rates (
            id                   TEXT PRIMARY KEY,
            warehouse_id         TEXT NOT NULL,
            rent_monthly_kopecks INTEGER NOT NULL,
            effective_from       TEXT NOT NULL,
            note                 TEXT,
            created_at           TEXT NOT NULL,
            created_by           TEXT,
            is_deleted           INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouse_rent_rates_lookup "
        "ON warehouse_rent_rates (warehouse_id, effective_from)"
    )
    op.execute("""
        INSERT INTO warehouse_rent_rates
            (id, warehouse_id, rent_monthly_kopecks, effective_from, note, created_at, created_by, is_deleted)
        SELECT gen_random_uuid()::text, id, rent_monthly_kopecks, substr(created_at, 1, 10),
               NULL, created_at, creator_id, 0
        FROM own_warehouses
        WHERE COALESCE(rent_monthly_kopecks, 0) > 0 AND COALESCE(is_deleted, 0) = 0
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS warehouse_rent_rates")
