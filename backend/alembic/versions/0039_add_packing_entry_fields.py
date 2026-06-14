"""Add packing entry fields to zone relocations.

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-09

packed_date   — бизнес-дата упаковки (YYYY-MM-DD); упаковка может растянуться на дни.
pack_entry_id — общий id записи из шторки (good+defect одного «Записать»).
reverses_id   — для строк-компенсаций = pack_entry_id отменённой записи.
Заполняются только для QC-движений упаковки; прочие движения пишут NULL.
"""

from __future__ import annotations

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS packed_date TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS pack_entry_id TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS reverses_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_pack_entry "
        "ON zone_relocations (pack_entry_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_pack_entry")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS reverses_id")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS pack_entry_id")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS packed_date")
