"""Аннулирование счёта не переписывает прошлое: сторно-платёж вместо мягкого удаления.

Раньше `POST /invoices/{id}/cancel` ставил invoice_payments.is_deleted = 1 — оплата
исчезала из фактов, и отчёт по кассе за уже закрытый месяц менялся задним числом.
Теперь исходный платёж остаётся в журнале со своей датой, а на дату аннулирования
пишется сторно-строка (отрицательная сумма, reverses_id → исходный платёж) — как
сделано в откате списаний остатков.

invoice_docs.cancelled_on — бизнес-дата аннулирования (Europe/Moscow). До неё счёт
остаётся обязательством в периодных срезах, с неё — снимается. Без этой даты
аннулированный счёт пришлось бы выкидывать из истории целиком.

Backfill: cancelled_on из журнала invoice_ops (op_type='cancel'), а платежи ранее
аннулированных счетов возвращаются в журнал (is_deleted = 0) и получают парную
сторно-строку на дату аннулирования. Сумма по счёту остаётся нулевой — paid_amount
не сдвигается, история становится восстановимой.
"""

from __future__ import annotations

revision = "0091"
down_revision = "0090"
branch_labels = None
depends_on = None

_MSK_DAY = "(({col})::timestamptz AT TIME ZONE 'Europe/Moscow')::date::text"

_REVERSAL_COMMENT = "Сторно при аннулировании счёта"


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE invoice_docs ADD COLUMN IF NOT EXISTS cancelled_on TEXT")
    op.execute("ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS reverses_id TEXT")

    op.execute(f"""
        UPDATE invoice_docs d SET cancelled_on = src.day
        FROM (
            SELECT invoice_id, {_MSK_DAY.format(col='MIN(created_at)')} AS day
            FROM invoice_ops WHERE op_type = 'cancel' GROUP BY invoice_id
        ) src
        WHERE src.invoice_id = d.id AND d.cancelled_on IS NULL
    """)
    op.execute(f"""
        UPDATE invoice_docs SET cancelled_on = {_MSK_DAY.format(col='COALESCE(updated_at, created_at)')}
        WHERE cancelled_on IS NULL AND status = 'cancelled'
    """)

    # Платежи ранее аннулированных счетов — обратно в журнал со своей исходной датой.
    op.execute("""
        UPDATE invoice_payments p SET is_deleted = 0
        FROM invoice_docs d
        WHERE d.id = p.invoice_id AND d.status = 'cancelled'
          AND p.is_deleted = 1 AND p.reverses_id IS NULL
    """)
    op.execute(f"""
        INSERT INTO invoice_payments
            (id, invoice_id, amount, paid_on, comment, created_at, created_by, is_deleted, reverses_id)
        SELECT gen_random_uuid()::text, p.invoice_id, -p.amount, d.cancelled_on,
               '{_REVERSAL_COMMENT}', COALESCE(d.updated_at, d.created_at), p.created_by, 0, p.id
        FROM invoice_payments p
        JOIN invoice_docs d ON d.id = p.invoice_id
        WHERE d.status = 'cancelled' AND p.reverses_id IS NULL AND p.amount <> 0
          AND NOT EXISTS (SELECT 1 FROM invoice_payments r WHERE r.reverses_id = p.id)
    """)

    # Часть исторически аннулированных счетов осталась с ненулевым paid_amount (их
    # аннулировали до того, как обнуление появилось в коде). Приводим денормализованное
    # поле к журналу — иначе карточка показывает оплату, которой по журналу нет.
    op.execute("UPDATE invoice_docs SET paid_amount = 0 WHERE status = 'cancelled' AND paid_amount <> 0")

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_payments_reverses ON invoice_payments(reverses_id) "
        "WHERE reverses_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_docs_cancelled_on ON invoice_docs(cancelled_on) "
        "WHERE cancelled_on IS NOT NULL"
    )


def downgrade() -> None:
    from alembic import op

    # Сторно-строки убираем, исходные платежи снова прячем — как было до ревизии.
    op.execute("DELETE FROM invoice_payments WHERE reverses_id IS NOT NULL")
    op.execute("""
        UPDATE invoice_payments p SET is_deleted = 1
        FROM invoice_docs d
        WHERE d.id = p.invoice_id AND d.status = 'cancelled'
    """)
    op.execute("DROP INDEX IF EXISTS idx_invoice_docs_cancelled_on")
    op.execute("DROP INDEX IF EXISTS idx_invoice_payments_reverses")
    op.execute("ALTER TABLE invoice_payments DROP COLUMN IF EXISTS reverses_id")
    op.execute("ALTER TABLE invoice_docs DROP COLUMN IF EXISTS cancelled_on")
