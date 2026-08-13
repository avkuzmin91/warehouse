"""Распознанные ШК на файле строки упаковки.

JSON-массив кодов, снятых с файла при загрузке (или код этикетки из карточки
товара). NULL — коды не распознаны / файл загружен до появления колонки.
"""

from __future__ import annotations

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_line_files ADD COLUMN IF NOT EXISTS barcodes TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_line_files DROP COLUMN IF EXISTS barcodes")
