"""Add is_packing_zone flag to unloading_zones and seed one packing zone.

Revision ID: 0035
Revises: 0034
Create Date: 2026-06-07

«Зона упаковки» — выделенное место, куда кладовщик заранее перемещает on_review-товар;
там начальник смены делит его на годный/брак (статус меняется, место — нет).
Ровно одна активная зона с is_packing_zone = 1.
"""

from __future__ import annotations

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE unloading_zones ADD COLUMN is_packing_zone INTEGER NOT NULL DEFAULT 0")
    # Засеять «Зону упаковки», если ни одной ещё не отмечено.
    op.execute("""
        INSERT INTO unloading_zones (id, name, is_active, is_packing_zone, created_at)
        SELECT gen_random_uuid()::text, 'Зона упаковки', 1, 1, NOW()::text
        WHERE NOT EXISTS (
            SELECT 1 FROM unloading_zones WHERE is_packing_zone = 1 AND COALESCE(is_deleted,0) = 0
        )
    """)


def downgrade() -> None:
    pass
