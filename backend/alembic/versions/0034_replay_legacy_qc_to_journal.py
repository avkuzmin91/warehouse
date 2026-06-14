"""Replay legacy receipt QC into the unified inventory journal (zone_relocations).

Revision ID: 0034
Revises: 0033
Create Date: 2026-06-07

Переносит исторический QC поступлений в единый журнал, чтобы новый расчёт остатков
(on_review = accepted − конвертации; good/defect = конвертации − отгрузка) воспроизвёл
текущие остатки без изменений:

  1) для каждой строки поступления (done/on_review) пишем конвертации
     on_review→good (good_in, в good_zone||storage_zone) и
     on_review→defect (defect_in, в defect_zone||storage_zone);
  2) backfill accepted_qty := good_in + defect_in + остаток_on_review
     (остаток считается по старой формуле: только on_review-док и QC не закрыт);
  3) on_review-документы → done («на проверке» остаётся только статусом инвентаря).

Шаги 1–2 читают исходное состояние (receipt_ops / исходный accepted_qty), поэтому
сначала INSERT-ы, затем UPDATE accepted_qty, затем смена статуса.
"""

from __future__ import annotations

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

_OPS_AGG = """
    SELECT o.line_id,
      (SELECT o2.qty FROM receipt_ops o2 WHERE o2.line_id=o.line_id AND o2.op_type='receiving_correction' ORDER BY o2.created_at DESC LIMIT 1) AS recv_corr,
      SUM(CASE WHEN o.op_type='receiving' THEN o.qty ELSE 0 END) AS recv_sum,
      (SELECT o2.qty FROM receipt_ops o2 WHERE o2.line_id=o.line_id AND o2.op_type='defect_correction' ORDER BY o2.created_at DESC LIMIT 1) AS def_corr,
      SUM(CASE WHEN o.op_type='defect_fix' THEN o.qty ELSE 0 END) AS def_sum,
      MAX(CASE WHEN o.op_type='line_qc_complete' THEN o.created_at END) AS qc_done,
      MAX(CASE WHEN o.op_type='line_qc_reopen' THEN o.created_at END) AS qc_reopen
    FROM receipt_ops o GROUP BY o.line_id
"""


def upgrade() -> None:
    from alembic import op

    # 1) Конвертации on_review→good
    op.execute(f"""
        WITH oa AS ({_OPS_AGG})
        INSERT INTO zone_relocations
            (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
             client_id, client_name, status, from_status, to_status,
             from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment, created_at)
        SELECT gen_random_uuid()::text, l.product_id, l.product_name, l.product_sku,
               l.color_id, l.color_name, l.size_id, l.size_name,
               d.client_id, cl.name, 'good', 'on_review', 'good',
               l.storage_zone_id, l.storage_zone_name,
               COALESCE(l.good_zone_id, l.storage_zone_id), COALESCE(l.good_zone_name, l.storage_zone_name),
               COALESCE(oa.recv_corr, oa.recv_sum, 0),
               'Миграция QC: годный', COALESCE(d.updated_at, d.created_at)
        FROM receipt_lines l
        JOIN receipt_docs d ON d.id = l.doc_id
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN oa ON oa.line_id = l.id
        WHERE COALESCE(l.is_deleted,0)=0 AND COALESCE(d.is_deleted,0)=0
          AND d.status IN ('done','on_review')
          AND COALESCE(oa.recv_corr, oa.recv_sum, 0) > 0
    """)

    # 2) Конвертации on_review→defect
    op.execute(f"""
        WITH oa AS ({_OPS_AGG})
        INSERT INTO zone_relocations
            (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
             client_id, client_name, status, from_status, to_status,
             from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment, created_at)
        SELECT gen_random_uuid()::text, l.product_id, l.product_name, l.product_sku,
               l.color_id, l.color_name, l.size_id, l.size_name,
               d.client_id, cl.name, 'defect', 'on_review', 'defect',
               l.storage_zone_id, l.storage_zone_name,
               COALESCE(l.defect_zone_id, l.storage_zone_id), COALESCE(l.defect_zone_name, l.storage_zone_name),
               COALESCE(oa.def_corr, oa.def_sum, 0),
               'Миграция QC: брак', COALESCE(d.updated_at, d.created_at)
        FROM receipt_lines l
        JOIN receipt_docs d ON d.id = l.doc_id
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN oa ON oa.line_id = l.id
        WHERE COALESCE(l.is_deleted,0)=0 AND COALESCE(d.is_deleted,0)=0
          AND d.status IN ('done','on_review')
          AND COALESCE(oa.def_corr, oa.def_sum, 0) > 0
    """)

    # 3) backfill accepted_qty = good_in + defect_in + остаток_on_review (по исходному accepted_qty)
    op.execute(f"""
        WITH oa AS ({_OPS_AGG}),
        calc AS (
          SELECT l.id,
            COALESCE(oa.recv_corr, oa.recv_sum, 0) AS good_in,
            COALESCE(oa.def_corr, oa.def_sum, 0) AS defect_in,
            CASE WHEN d.status='on_review'
                   AND (oa.qc_done IS NULL OR (oa.qc_reopen IS NOT NULL AND oa.qc_reopen > oa.qc_done))
                 THEN GREATEST(0, COALESCE(l.accepted_qty,0)
                                  - COALESCE(oa.recv_corr, oa.recv_sum, 0)
                                  - COALESCE(oa.def_corr, oa.def_sum, 0))
                 ELSE 0 END AS review_rem
          FROM receipt_lines l
          JOIN receipt_docs d ON d.id = l.doc_id
          LEFT JOIN oa ON oa.line_id = l.id
          WHERE COALESCE(l.is_deleted,0)=0 AND COALESCE(d.is_deleted,0)=0
            AND d.status IN ('done','on_review')
        )
        UPDATE receipt_lines l
        SET accepted_qty = calc.good_in + calc.defect_in + calc.review_rem
        FROM calc WHERE calc.id = l.id
    """)

    # 4) on_review-документы → done
    op.execute("UPDATE receipt_docs SET status='done' WHERE status='on_review' AND COALESCE(is_deleted,0)=0")


def downgrade() -> None:
    pass
