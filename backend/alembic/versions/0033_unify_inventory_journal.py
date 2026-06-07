"""Unify inventory journal: add from_status/to_status/shipment_line_id to zone_relocations.

Revision ID: 0033
Revises: 0032
Create Date: 2026-06-07

Журнал zone_relocations становится единым журналом движений запаса:
- перемещение         (зонаA, S) → (зонаB, S)            — from_status = to_status
- подготовка к упаковке (приёмка, on_review) → (упаковка, on_review)
- QC-конвертация      (упаковка, on_review) → (упаковка, good|defect)

Старое поле status сохраняем до итерации 2 (удаление легаси).
"""

from __future__ import annotations

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations ADD COLUMN from_status TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN to_status TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN shipment_line_id TEXT")
    # Бэкофилл существующих перемещений: статус не менялся.
    op.execute("UPDATE zone_relocations SET from_status = status, to_status = status "
               "WHERE from_status IS NULL OR to_status IS NULL")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_conv "
        "ON zone_relocations (from_status, to_status, product_id, client_id, color_id, size_id)"
    )


def downgrade() -> None:
    pass
