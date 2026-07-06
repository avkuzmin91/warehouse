"""Штрих-коды вариантов: много кодов на один вариант (product_variant_barcodes).

У одного SKU бывает до десятка штрих-кодов (коды маркетплейсов, производителя),
поэтому одиночная колонка product_variants.barcode заменяется таблицей.
Инвариант сканера сохраняется: один активный код опознаёт ровно один вариант.
Существующие коды переносятся, колонка удаляется.

Revision ID: 0086
Revises: 0085
Create Date: 2026-07-06
"""

from __future__ import annotations

from datetime import UTC, datetime

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_variant_barcodes (
            id TEXT PRIMARY KEY,
            variant_id TEXT NOT NULL,
            barcode TEXT NOT NULL,
            source TEXT,
            created_at TEXT,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS product_variant_barcodes_code_active_uq
        ON product_variant_barcodes (barcode)
        WHERE COALESCE(is_deleted, 0) = 0
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_variant_barcodes_variant_idx "
        "ON product_variant_barcodes (variant_id)"
    )
    now = datetime.now(UTC).isoformat()
    op.execute(
        f"""
        INSERT INTO product_variant_barcodes (id, variant_id, barcode, created_at, is_deleted)
        SELECT gen_random_uuid()::text, id, barcode, '{now}', 0
        FROM product_variants
        WHERE barcode IS NOT NULL AND barcode <> '' AND COALESCE(is_deleted, 0) = 0
        """
    )
    op.execute("DROP INDEX IF EXISTS product_variants_barcode_active_uq")
    op.execute("ALTER TABLE product_variants DROP COLUMN IF EXISTS barcode")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode TEXT")
    # При нескольких кодах в колонку возвращается самый ранний.
    op.execute(
        """
        UPDATE product_variants v
        SET barcode = vb.barcode
        FROM (
            SELECT DISTINCT ON (variant_id) variant_id, barcode
            FROM product_variant_barcodes
            WHERE COALESCE(is_deleted, 0) = 0
            ORDER BY variant_id, created_at
        ) vb
        WHERE vb.variant_id = v.id
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS product_variants_barcode_active_uq
        ON product_variants (barcode)
        WHERE barcode IS NOT NULL AND barcode <> '' AND COALESCE(is_deleted, 0) = 0
        """
    )
    op.execute("DROP TABLE IF EXISTS product_variant_barcodes")
