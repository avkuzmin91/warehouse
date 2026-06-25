"""Привязка поступлений к счёту (invoice_receipts).

Зеркало invoice_shipments из 0048: счёт теперь может включать не только отгрузки,
но и поступления (выставляются клиенту только за логистику). Деньги логистики
берутся из receipt_docs.logistics_cost (рубли) — отдельной суммы здесь не хранится.

Revision ID: 0069
Revises: 0068
Create Date: 2026-06-25
"""

from __future__ import annotations

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_receipts (
            id             TEXT PRIMARY KEY,
            invoice_id     TEXT NOT NULL REFERENCES invoice_docs(id),
            receipt_doc_id TEXT NOT NULL,
            client_id      TEXT,
            client_name    TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_receipts_invoice ON invoice_receipts(invoice_id)")
    # Поступление принадлежит не более чем одному активному счёту.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_receipts_receipt_unique "
        "ON invoice_receipts(receipt_doc_id) WHERE is_deleted = 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS invoice_receipts")
