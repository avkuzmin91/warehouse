"""Add is_shipping_zone flag to unloading_zones and seed one shipping zone.

Revision ID: 0043
Revises: 0042
Create Date: 2026-06-11

«Зона отгрузки» — выделенное место, куда кладовщик переносит подготовленный
к отгрузке брак (storage/defect → ready/defect). Ровно одна активная зона
с is_shipping_zone = 1, по аналогии с «Зоной упаковки» (0035).
"""

from __future__ import annotations

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS is_shipping_zone INTEGER NOT NULL DEFAULT 0")
    # Если зона с именем «Зона отгрузки» уже есть (например, заведена вручную в справочнике),
    # пометить её как зону отгрузки и реанимировать — иначе INSERT упадёт на UNIQUE(name).
    op.execute("""
        UPDATE unloading_zones
        SET is_shipping_zone = 1, is_active = 1, is_deleted = 0
        WHERE name = 'Зона отгрузки'
    """)
    # Иначе засеять «Зону отгрузки», если активной ещё нет.
    op.execute("""
        INSERT INTO unloading_zones (id, name, is_active, is_shipping_zone, created_at)
        SELECT gen_random_uuid()::text, 'Зона отгрузки', 1, 1, NOW()::text
        WHERE NOT EXISTS (
            SELECT 1 FROM unloading_zones WHERE is_shipping_zone = 1 AND COALESCE(is_deleted,0) = 0
        )
    """)


def downgrade() -> None:
    pass
