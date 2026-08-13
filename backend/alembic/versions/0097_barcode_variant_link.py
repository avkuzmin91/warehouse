"""Доукомплектование variant_id у штрих-кодов после ранней редакции 0095.

Первая редакция 0095 (применена на dev/test) переносила коды на товар без
variant_id. Здесь колонка добавляется, если её нет, и заполняется: код без
варианта привязывается к первому живому варианту товара (по created_at) —
у товара с одним вариантом это точное восстановление, при нескольких —
привязку стоит проверить руками. На окружениях с новой редакцией 0095
(prod, свежие инстансы) заполнять нечего — миграция без эффекта.

Revision ID: 0097
Revises: 0096
Create Date: 2026-08-13
"""

from __future__ import annotations

revision = "0097"
down_revision = "0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS variant_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_barcodes_variant_idx "
        "ON product_barcodes (variant_id)"
    )
    op.execute(
        """
        UPDATE product_barcodes pb
        SET variant_id = fv.variant_id
        FROM (
            SELECT DISTINCT ON (product_id) product_id, id AS variant_id
            FROM product_variants
            WHERE COALESCE(is_deleted, 0) = 0
            ORDER BY product_id, created_at
        ) fv
        WHERE fv.product_id = pb.product_id
          AND pb.variant_id IS NULL
        """
    )


def downgrade() -> None:
    # Колонка нужна и редакции 0095 — откатывать нечего.
    pass
