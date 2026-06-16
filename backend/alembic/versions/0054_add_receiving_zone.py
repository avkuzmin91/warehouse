"""Add is_receiving_zone flag to unloading_zones and seed one receiving zone.

Revision ID: 0054
Revises: 0053
Create Date: 2026-06-16

«Зона приёмки» — буферное место, куда товар встаёт при разгрузке рейса, если
кладовщик не назначил конкретное место хранения по строке. Ровно одна активная
зона с is_receiving_zone = 1, по аналогии с «Зоной отгрузки» (0043).
"""

from __future__ import annotations

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS is_receiving_zone INTEGER NOT NULL DEFAULT 0")
    # Если зона с именем «Зона приёмки» уже есть (например, заведена вручную в справочнике),
    # пометить её как зону приёмки и реанимировать — иначе INSERT упадёт на UNIQUE(name).
    op.execute("""
        UPDATE unloading_zones
        SET is_receiving_zone = 1, is_active = 1, is_deleted = 0
        WHERE name = 'Зона приёмки'
    """)
    # Иначе засеять «Зону приёмки», если активной ещё нет.
    op.execute("""
        INSERT INTO unloading_zones (id, name, is_active, is_receiving_zone, created_at)
        SELECT gen_random_uuid()::text, 'Зона приёмки', 1, 1, NOW()::text
        WHERE NOT EXISTS (
            SELECT 1 FROM unloading_zones WHERE is_receiving_zone = 1 AND COALESCE(is_deleted,0) = 0
        )
    """)


def downgrade() -> None:
    pass
