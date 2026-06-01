"""Add indexes for balance query performance.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-29
"""

from __future__ import annotations

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Самый критичный: коррелированные подзапросы в get_balances фильтруют по line_id + op_type
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_receipt_ops_line_optype_created
            ON receipt_ops(line_id, op_type, created_at DESC)
    """)

    # Фильтр статуса документов при расчёте остатков
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_receipt_docs_status
            ON receipt_docs(status)
    """)

    # Фильтр статуса + cargo_type в LEFT JOIN подзапросах shipments
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_shipment_docs_status_cargo
            ON shipment_docs(status, cargo_type)
    """)

    # GROUP BY в подзапросах sg и sd_out
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_shipment_lines_product_color_size
            ON shipment_lines(product_id, color_id, size_id)
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_shipment_lines_product_color_size")
    op.execute("DROP INDEX IF EXISTS idx_shipment_docs_status_cargo")
    op.execute("DROP INDEX IF EXISTS idx_receipt_docs_status")
    op.execute("DROP INDEX IF EXISTS idx_receipt_ops_line_optype_created")
