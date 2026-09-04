"""Сборка FBS-поставки на ТСД: сборщик поставки и журнал сборки.

Revision ID: 0108
Revises: 0107
Create Date: 2026-09-04
"""

from __future__ import annotations

revision = "0108"
down_revision = "0107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE mp_supplies ADD COLUMN IF NOT EXISTS picker_id TEXT")
    op.execute("ALTER TABLE mp_supplies ADD COLUMN IF NOT EXISTS claimed_at TEXT")

    # Журнал сборки: append-only, откат — строка с отрицательным qty и reverses_id,
    # собранное по позиции = нетто. Движение остатка живёт в zone_relocations,
    # здесь — привязка к поставке и к месту/коробу, откуда взяли.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mp_supply_picks (
            id           TEXT PRIMARY KEY,
            supply_id    TEXT NOT NULL,
            variant_id   TEXT,
            product_id   TEXT NOT NULL,
            color_id     TEXT,
            size_id      TEXT,
            client_id    TEXT,
            zone_id      TEXT,
            container_id TEXT,
            qty          INTEGER NOT NULL,
            reverses_id  TEXT,
            created_at   TEXT NOT NULL,
            created_by   TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_supply_picks_supply_idx "
        "ON mp_supply_picks (supply_id, variant_id)"
    )
    # Очередь сборки: незанятые поставки на сборке, самая срочная волна первой.
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_supplies_picking_queue_idx "
        "ON mp_supplies (status, cutoff_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS mp_supplies_picking_queue_idx")
    op.execute("DROP INDEX IF EXISTS mp_supply_picks_supply_idx")
    op.execute("DROP TABLE IF EXISTS mp_supply_picks")
    op.execute("ALTER TABLE mp_supplies DROP COLUMN IF EXISTS claimed_at")
    op.execute("ALTER TABLE mp_supplies DROP COLUMN IF EXISTS picker_id")
