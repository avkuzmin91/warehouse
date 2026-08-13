"""Штрих-коды: таблица product_barcodes (замена product_variant_barcodes).

Код принадлежит варианту товара (у каждой комбинации цвет×размер свои ШК),
variant_id сохраняется при переносе; product_id денормализован для выборок
«все коды товара». Активная глобальная уникальность кода сохраняется.

История ревизии: первая редакция (успела примениться только на dev/test)
переносила коды без variant_id — там связку доукомплектовывает 0097.
На окружениях, где 0095 ещё не выполнялась (prod, новые инстансы),
вариантная привязка переезжает без потерь.

Revision ID: 0095
Revises: 0094
Create Date: 2026-08-12
"""

from __future__ import annotations

revision = "0095"
down_revision = "0094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_barcodes (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            variant_id TEXT,
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
        CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_code_active_uq
        ON product_barcodes (barcode)
        WHERE COALESCE(is_deleted, 0) = 0
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcodes_product_idx "
        "ON product_barcodes (product_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcodes_variant_idx "
        "ON product_barcodes (variant_id)"
    )
    op.execute(
        """
        INSERT INTO product_barcodes (id, product_id, variant_id, barcode, source, created_at, created_by, is_deleted)
        SELECT vb.id, v.product_id, vb.variant_id, vb.barcode, vb.source, vb.created_at, vb.created_by, vb.is_deleted
        FROM product_variant_barcodes vb
        JOIN product_variants v ON v.id = vb.variant_id
        """
    )
    op.execute("DROP TABLE IF EXISTS product_variant_barcodes")


def downgrade() -> None:
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
    op.execute(
        """
        INSERT INTO product_variant_barcodes (id, variant_id, barcode, source, created_at, created_by, is_deleted)
        SELECT pb.id, pb.variant_id, pb.barcode, pb.source, pb.created_at, pb.created_by, pb.is_deleted
        FROM product_barcodes pb
        WHERE pb.variant_id IS NOT NULL
        """
    )
    op.execute("DROP TABLE IF EXISTS product_barcodes")
