"""Частичная оплата расходов + журнал платежей + перевозчик на логистическом расходе.

Revision ID: 0068
Revises: 0067
Create Date: 2026-06-25

Расход перестаёт быть «всё или ничего»: добавляется денормализованное paid_amount
и append-only журнал expense_payments (как invoice_payments у счетов). Статус
material_expenses.payment_status выводится из paid_amount vs amount:
awaiting → partially_paid → paid. Перевозчик логистического расхода фиксируется
по carrier_id (FK-значение из рейса), чтобы массовая оплата по перевозчику не
зависела от текстового supplier. Деньги — копейки (INTEGER).
"""

from __future__ import annotations

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE material_expenses "
        "ADD COLUMN IF NOT EXISTS paid_amount INTEGER NOT NULL DEFAULT 0, "
        "ADD COLUMN IF NOT EXISTS carrier_id  TEXT"
    )
    # Уже оплаченные расходы → paid_amount равен сумме (полностью закрыты).
    op.execute(
        "UPDATE material_expenses SET paid_amount = amount "
        "WHERE payment_status = 'paid' AND paid_amount = 0"
    )
    # Перевозчик логистических расходов берётся из породившего рейса.
    op.execute(
        "UPDATE material_expenses e SET carrier_id = t.carrier_id "
        "FROM trip_docs t "
        "WHERE e.source_kind = 'trip' AND e.source_id = t.id "
        "AND e.carrier_id IS NULL AND t.carrier_id IS NOT NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_carrier ON material_expenses(carrier_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS expense_payments (
            id                TEXT PRIMARY KEY,
            expense_id        TEXT NOT NULL REFERENCES material_expenses(id),
            amount            INTEGER NOT NULL,
            paid_on           TEXT,
            payment_source_id TEXT,
            comment           TEXT,
            created_at        TEXT NOT NULL,
            created_by        TEXT,
            is_deleted        INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments(expense_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS expense_payments")
    op.execute("DROP INDEX IF EXISTS idx_material_expenses_carrier")
    op.execute("ALTER TABLE material_expenses DROP COLUMN IF EXISTS carrier_id")
    op.execute("ALTER TABLE material_expenses DROP COLUMN IF EXISTS paid_amount")
