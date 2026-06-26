"""Backfill missing product SKU from shipment line snapshots.

Revision ID: 0072
Revises: 0071
Create Date: 2026-06-25
"""

from __future__ import annotations

from datetime import UTC, datetime

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    now = datetime.now(UTC).isoformat()

    # Дедуп кандидатов по (client_id, sku): два разных pending-товара одного клиента
    # с одинаковым snapshot-SKU не видят друг друга в safe_candidates (guard смотрит
    # только sku_pending=0), поэтому без dedup оба получили бы один SKU → нарушение
    # частичного unique-индекса products_client_sku_active_uq из 0061. Берём ровно
    # одного победителя на пару.
    op.execute(
        """
        WITH candidates AS (
            SELECT p.id AS product_id,
                   p.client_id,
                   MIN(NULLIF(TRIM(sl.product_sku), '')) AS sku
            FROM products p
            JOIN shipment_lines sl ON sl.product_id = p.id
            WHERE COALESCE(p.is_deleted, 0) = 0
              AND (COALESCE(NULLIF(TRIM(p.sku), ''), '') = '' OR COALESCE(p.sku_pending, 0) = 1)
              AND COALESCE(sl.is_deleted, 0) = 0
              AND NULLIF(TRIM(sl.product_sku), '') IS NOT NULL
            GROUP BY p.id, p.client_id
            HAVING COUNT(DISTINCT NULLIF(TRIM(sl.product_sku), '')) = 1
        ),
        deduped AS (
            SELECT product_id, client_id, sku,
                   ROW_NUMBER() OVER (
                       PARTITION BY client_id, sku ORDER BY product_id
                   ) AS rn
            FROM candidates
        ),
        safe_candidates AS (
            SELECT c.product_id, c.client_id, c.sku
            FROM deduped c
            WHERE c.rn = 1
              AND NOT EXISTS (
                SELECT 1
                FROM products p2
                WHERE p2.id <> c.product_id
                  AND p2.client_id IS NOT DISTINCT FROM c.client_id
                  AND COALESCE(p2.is_deleted, 0) = 0
                  AND COALESCE(p2.sku_pending, 0) = 0
                  AND TRIM(COALESCE(p2.sku, '')) = c.sku
            )
              AND NOT EXISTS (
                SELECT 1
                FROM product_variants v2
                JOIN products p2 ON p2.id = v2.product_id
                WHERE v2.product_id <> c.product_id
                  AND p2.client_id IS NOT DISTINCT FROM c.client_id
                  AND COALESCE(v2.is_deleted, 0) = 0
                  AND COALESCE(v2.sku_pending, 0) = 0
                  AND TRIM(COALESCE(v2.sku, '')) = c.sku
            )
        )
        UPDATE products p
        SET sku = c.sku,
            sku_pending = 0,
            updated_at = '%(now)s'
        FROM safe_candidates c
        WHERE p.id = c.product_id
        """
        % {"now": now}
    )

    op.execute(
        """
        WITH numbered AS (
            SELECT v.id,
                   v.client_id,
                   p.sku AS base_sku,
                   COUNT(*) OVER (PARTITION BY v.product_id) AS variant_count,
                   ROW_NUMBER() OVER (PARTITION BY v.product_id ORDER BY v.created_at, v.id) AS rn
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            WHERE COALESCE(v.is_deleted, 0) = 0
              AND COALESCE(p.is_deleted, 0) = 0
              AND COALESCE(p.sku_pending, 0) = 0
              AND NULLIF(TRIM(p.sku), '') IS NOT NULL
              AND (COALESCE(NULLIF(TRIM(v.sku), ''), '') = '' OR COALESCE(v.sku_pending, 0) = 1)
        ),
        candidates AS (
            SELECT id,
                   client_id,
                   CASE WHEN variant_count = 1 THEN base_sku ELSE base_sku || '-' || rn::text END AS sku
            FROM numbered
        ),
        deduped AS (
            SELECT id, client_id, sku,
                   ROW_NUMBER() OVER (
                       PARTITION BY client_id, sku ORDER BY id
                   ) AS dedup_rn
            FROM candidates
        ),
        safe_candidates AS (
            SELECT c.id, c.client_id, c.sku
            FROM deduped c
            WHERE c.dedup_rn = 1
              AND NOT EXISTS (
                SELECT 1
                FROM product_variants v2
                WHERE v2.id <> c.id
                  AND v2.client_id IS NOT DISTINCT FROM c.client_id
                  AND COALESCE(v2.is_deleted, 0) = 0
                  AND COALESCE(v2.sku_pending, 0) = 0
                  AND TRIM(COALESCE(v2.sku, '')) = c.sku
            )
        )
        UPDATE product_variants v
        SET sku = c.sku,
            sku_pending = 0,
            updated_at = '%(now)s'
        FROM safe_candidates c
        WHERE v.id = c.id
        """
        % {"now": now}
    )

    op.execute(
        """
        UPDATE shipment_lines sl
        SET product_sku = p.sku
        FROM products p
        WHERE sl.product_id = p.id
          AND COALESCE(p.sku_pending, 0) = 0
          AND NULLIF(TRIM(p.sku), '') IS NOT NULL
          AND COALESCE(NULLIF(TRIM(sl.product_sku), ''), '') = ''
        """
    )

    op.execute(
        """
        UPDATE dispatch_lines dl
        SET product_sku = p.sku
        FROM products p
        WHERE dl.product_id = p.id
          AND COALESCE(p.sku_pending, 0) = 0
          AND NULLIF(TRIM(p.sku), '') IS NOT NULL
          AND COALESCE(NULLIF(TRIM(dl.product_sku), ''), '') = ''
        """
    )


def downgrade() -> None:
    # Backfill необратим намеренно: исходное «пустое»/pending-состояние SKU
    # достоверно восстановить нельзя, откат данных не выполняется.
    pass
