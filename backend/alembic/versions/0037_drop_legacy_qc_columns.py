"""Drop legacy columns: zone_relocations.status and receipt_lines good/defect zones.

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-08

- zone_relocations.status — заменён на from_status/to_status (список читает to_status).
- receipt_lines.good_zone_id/name, defect_zone_id/name — QC поступления убран,
  годность/брак и их места определяются при упаковке (Зона упаковки).
"""

from __future__ import annotations

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE receipt_lines DROP COLUMN IF EXISTS good_zone_id")
    op.execute("ALTER TABLE receipt_lines DROP COLUMN IF EXISTS good_zone_name")
    op.execute("ALTER TABLE receipt_lines DROP COLUMN IF EXISTS defect_zone_id")
    op.execute("ALTER TABLE receipt_lines DROP COLUMN IF EXISTS defect_zone_name")


def downgrade() -> None:
    pass
