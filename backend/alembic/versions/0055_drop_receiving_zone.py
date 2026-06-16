"""Drop is_receiving_zone flag — буферная «Зона приёмки» отменена.

Revision ID: 0055
Revises: 0054
Create Date: 2026-06-16

Откат 0054: приёмка рейсом снова создаёт кладовщику задачу в карточке
поступления (planned → on_intake), а не авто-приходует товар в буфер. Колонку
is_receiving_zone и засеянную зону убираем.
"""

from __future__ import annotations

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Архивируем засеянную зону, если ею не пользуются как обычным местом хранения.
    op.execute("""
        UPDATE unloading_zones
        SET is_deleted = 1
        WHERE name = 'Зона приёмки' AND is_receiving_zone = 1
          AND NOT EXISTS (
              SELECT 1 FROM receipt_lines rl
              WHERE rl.storage_zone_id = unloading_zones.id AND COALESCE(rl.is_deleted, 0) = 0
          )
    """)
    op.execute("ALTER TABLE unloading_zones DROP COLUMN IF EXISTS is_receiving_zone")


def downgrade() -> None:
    pass
