"""Add good/defect storage locations to receipt lines.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-29

storage_zone_* остаётся местом товара «на проверке»; good_zone_* / defect_zone_* —
места годного и брака, задаются при QC. Балансы по месту используют
COALESCE(good_zone_id, storage_zone_id) и COALESCE(defect_zone_id, storage_zone_id).
"""

from __future__ import annotations

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            ADD COLUMN IF NOT EXISTS good_zone_id     TEXT,
            ADD COLUMN IF NOT EXISTS good_zone_name   TEXT,
            ADD COLUMN IF NOT EXISTS defect_zone_id   TEXT,
            ADD COLUMN IF NOT EXISTS defect_zone_name TEXT
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("""
        ALTER TABLE receipt_lines
            DROP COLUMN IF EXISTS defect_zone_name,
            DROP COLUMN IF EXISTS defect_zone_id,
            DROP COLUMN IF EXISTS good_zone_name,
            DROP COLUMN IF EXISTS good_zone_id
    """)
