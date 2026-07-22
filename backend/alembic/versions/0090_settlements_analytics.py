"""Аналитика расчётов: бизнес-даты выставления/закрытия счёта + индексы платежей.

invoice_docs.issued_on / closed_on — бизнес-дата (YYYY-MM-DD, Europe/Moscow)
выставления и закрытия счёта. До этого дата выставления жила только в журнале
invoice_ops (op_type='issue'), из-за чего срез «выставлено за период» и расчёт
среднего срока оплаты требовали join к журналу на каждый отчёт.

Backfill идёт из invoice_ops: MIN(created_at) по issue/close с конвертацией
UTC → Europe/Moscow (created_at пишется в UTC, а бизнес-день склада — московский).
Для счетов без записи в журнале (исторические/аномальные) issued_on берётся из
created_at документа, если статус уже не draft.

Индексы по paid_on у обоих журналов платежей — под период-срезы дебиторки и
кредиторки (раньше индекса не было вовсе: отчёт за месяц шёл seq scan).
"""

from __future__ import annotations

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None

_MSK_DAY = "(({col})::timestamptz AT TIME ZONE 'Europe/Moscow')::date::text"


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE invoice_docs "
        "ADD COLUMN IF NOT EXISTS issued_on TEXT, "
        "ADD COLUMN IF NOT EXISTS closed_on TEXT"
    )

    op.execute(f"""
        UPDATE invoice_docs d SET issued_on = src.day
        FROM (
            SELECT invoice_id, {_MSK_DAY.format(col='MIN(created_at)')} AS day
            FROM invoice_ops WHERE op_type = 'issue' GROUP BY invoice_id
        ) src
        WHERE src.invoice_id = d.id AND d.issued_on IS NULL
    """)
    op.execute(f"""
        UPDATE invoice_docs d SET closed_on = src.day
        FROM (
            SELECT invoice_id, {_MSK_DAY.format(col='MIN(created_at)')} AS day
            FROM invoice_ops WHERE op_type = 'close' GROUP BY invoice_id
        ) src
        WHERE src.invoice_id = d.id AND d.closed_on IS NULL
    """)
    # Счета без записи «issue» в журнале, но уже не черновики — дата документа.
    op.execute(f"""
        UPDATE invoice_docs SET issued_on = {_MSK_DAY.format(col='created_at')}
        WHERE issued_on IS NULL AND status <> 'draft'
    """)

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_docs_issued_on ON invoice_docs(issued_on) "
        "WHERE COALESCE(is_deleted, 0) = 0"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_payments_paid_on ON invoice_payments(paid_on) "
        "WHERE COALESCE(is_deleted, 0) = 0"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_expense_payments_paid_on ON expense_payments(paid_on) "
        "WHERE COALESCE(is_deleted, 0) = 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_expense_payments_paid_on")
    op.execute("DROP INDEX IF EXISTS idx_invoice_payments_paid_on")
    op.execute("DROP INDEX IF EXISTS idx_invoice_docs_issued_on")
    op.execute("ALTER TABLE invoice_docs DROP COLUMN IF EXISTS closed_on")
    op.execute("ALTER TABLE invoice_docs DROP COLUMN IF EXISTS issued_on")
