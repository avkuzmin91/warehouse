"""Файлы этикеток штрих-кодов товара (product_barcode_files).

Файл этикетки (PDF/фото ШК) хранится в карточке товара рядом со своим кодом:
задача упаковки может подтянуть его без повторной загрузки. product_id
денормализован для выборок «все этикетки товара» в один запрос.

Revision ID: 0096
Revises: 0095
Create Date: 2026-08-12
"""

from __future__ import annotations

revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_barcode_files (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            barcode_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            url TEXT NOT NULL,
            mime_type TEXT,
            created_at TEXT,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcode_files_product_idx "
        "ON product_barcode_files (product_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcode_files_barcode_idx "
        "ON product_barcode_files (barcode_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS product_barcode_files")
