"""Journal receipt intake: every stock inflow becomes a zone_relocations move.

Revision ID: 0046
Revises: 0045
Create Date: 2026-06-12

Приёмка перестаёт быть неявным приходом «мимо журнала»: завершение поступления
пишет движение (intake, good)@место → (storage, good)@место на accepted_qty
с привязкой receipt_line_id (зеркально shipment_line_id).

Бэкфилл: по каждой строке завершённого поступления (status=done, accepted_qty>0)
создаётся intake-движение. Время — момент завершения приёмки (op arrival_fix),
для старых документов — updated_at/created_at документа.

После бэкфилла расчёт остатков переключается на чистый журнал: accepted-CTE
по done-поступлениям из формул уходит (см. modules/balances/service.py).
Инвариант: остаток меняется ⇔ есть запись в zone_relocations.
"""

from __future__ import annotations

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS receipt_line_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_receipt_line "
        "ON zone_relocations (receipt_line_id)"
    )

    # NOT EXISTS делает бэкфилл идемпотентным при повторном прогоне.
    # Отрицательные accepted_qty (кривые легаси-данные WH2-эры) переносятся со знаком:
    # отрицательная qty проходит через SUM-формулы остатков так же, как вычитал их
    # старый accepted-CTE, — паритет остатков до/после миграции точный.
    op.execute("""
        INSERT INTO zone_relocations
            (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
             client_id, client_name, from_op, to_op, from_quality, to_quality,
             from_zone_id, from_zone_name, to_zone_id, to_zone_name,
             qty, comment, created_at, created_by, receipt_line_id)
        SELECT gen_random_uuid()::text, rl.product_id, rl.product_name, rl.product_sku,
               rl.color_id, rl.color_name, rl.size_id, rl.size_name,
               rd.client_id, cl.name, 'intake', 'storage', 'good', 'good',
               rl.storage_zone_id, rl.storage_zone_name, rl.storage_zone_id, rl.storage_zone_name,
               rl.accepted_qty,
               'Миграция: приёмка по поступлению ' || rd.doc_number || ': ' || rl.accepted_qty || ' шт.',
               COALESCE(
                   (SELECT MIN(ro.created_at) FROM receipt_ops ro
                     WHERE ro.doc_id = rd.id AND ro.op_type = 'arrival_fix'),
                   rd.updated_at, rd.created_at),
               rd.created_by, rl.id
        FROM receipt_lines rl
        JOIN receipt_docs rd ON rd.id = rl.doc_id
        LEFT JOIN clients cl ON cl.id = rd.client_id
        WHERE rd.status = 'done'
          AND COALESCE(rd.is_deleted, 0) = 0
          AND COALESCE(rl.is_deleted, 0) = 0
          AND COALESCE(rl.accepted_qty, 0) <> 0
          AND NOT EXISTS (
              SELECT 1 FROM zone_relocations zr
              WHERE zr.receipt_line_id = rl.id AND zr.from_op = 'intake'
          )
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DELETE FROM zone_relocations WHERE from_op = 'intake'")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_receipt_line")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS receipt_line_id")
