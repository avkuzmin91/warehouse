"""Address-storage columns on unloading_zones (адресное хранение, ячейки стеллажей).

Revision ID: 0066
Revises: 0065
Create Date: 2026-06-23

Адресное хранение «через справочник местоположения»: место хранения получает
структуру адреса Помещение-Стеллаж-Секция-Этаж (код вида «1-А-10-1») и тип kind.
Существующие записи — служебные зоны (упаковка/отгрузка/прочее), помечаются
kind='special'; новые адресные ячейки заводятся через модуль locations с kind='cell'.
QR на ячейке несёт unloading_zones.id (стабилен при переименовании адреса).
"""

from __future__ import annotations

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS kind TEXT")
    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS room TEXT")
    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS rack TEXT")
    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS section TEXT")
    op.execute("ALTER TABLE unloading_zones ADD COLUMN IF NOT EXISTS floor TEXT")
    op.execute("UPDATE unloading_zones SET kind = 'special' WHERE kind IS NULL")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_unloading_zones_cell "
        "ON unloading_zones (room, rack, section, floor)"
    )


def downgrade() -> None:
    pass
