"""Скидки в счёте (invoice_discounts) + системная категория расходов «Скидки клиентам».

Скидка — сумма (копейки INTEGER) с обязательным текстом «за что», вычитается из
total_amount счёта и автоматически заводит расход kind=discount в едином реестре
(material_expenses, source_kind=invoice_discount, source_id=invoice_discounts.id).
Расход создаётся «оплаченным»: скидка зачитывается в счёте, денежного оттока нет.

Revision ID: 0088
Revises: 0087
Create Date: 2026-07-10
"""

from __future__ import annotations

from uuid import uuid4

revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    from config import EXPENSE_SYSTEM_CATEGORY_DISCOUNT

    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_discounts (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
            amount_kop INTEGER NOT NULL,
            reason     TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_discounts_invoice ON invoice_discounts(invoice_id)"
    )

    # Системная категория авто-расхода скидки (резолвится по имени, best-effort).
    name = EXPENSE_SYSTEM_CATEGORY_DISCOUNT.replace("'", "''")
    op.execute(
        f"""
        INSERT INTO expense_categories (id, name, sort_order, created_at)
        SELECT '{uuid4()}', '{name}',
               COALESCE((SELECT MAX(sort_order) FROM expense_categories), 0) + 1, NOW()::text
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories
            WHERE LOWER(name) = LOWER('{name}') AND COALESCE(is_deleted, 0) = 0
        )
        """
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS invoice_discounts")
