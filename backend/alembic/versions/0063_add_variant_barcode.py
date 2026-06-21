"""Barcode on product variants for scanner lookup (mobile §6.2).

Revision ID: 0063
Revises: 0062
Create Date: 2026-06-21
"""

from __future__ import annotations

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode TEXT")
    # Штрих-код однозначно опознаёт вариант при сканировании → один активный
    # вариант на код. Пустые/снятые коды между собой не конфликтуют.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS product_variants_barcode_active_uq
        ON product_variants (barcode)
        WHERE barcode IS NOT NULL AND barcode <> '' AND COALESCE(is_deleted, 0) = 0
        """
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS product_variants_barcode_active_uq")
    op.execute("ALTER TABLE product_variants DROP COLUMN IF EXISTS barcode")
