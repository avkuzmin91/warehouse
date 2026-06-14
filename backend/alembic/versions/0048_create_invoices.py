"""Create finance invoices (invoice_docs/invoice_shipments/invoice_payments/invoice_ops/invoice_files).

Деньги хранятся в копейках (INTEGER) — осознанное отклонение от REAL-конвенции
прочих стоимостей проекта: финансовый модуль не должен накапливать ошибки округления.

Revision ID: 0048
Revises: 0047
Create Date: 2026-06-13
"""

from __future__ import annotations

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # --- Счёт: шапка ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_docs (
            id           TEXT PRIMARY KEY,
            doc_number   TEXT NOT NULL UNIQUE,
            client_id    TEXT,
            client_name  TEXT,
            status       TEXT NOT NULL DEFAULT 'issued',
            total_amount INTEGER NOT NULL DEFAULT 0,
            paid_amount  INTEGER NOT NULL DEFAULT 0,
            due_date     TEXT,
            comment      TEXT,
            created_at   TEXT NOT NULL,
            created_by   TEXT,
            updated_at   TEXT,
            is_deleted   INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_docs_status ON invoice_docs(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_docs_client ON invoice_docs(client_id)")
    # Под алёрт «к оплате/просрочено»: активные счета по плановой дате.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_invoice_docs_due ON invoice_docs(due_date) "
        "WHERE COALESCE(is_deleted, 0) = 0 AND status IN ('issued', 'partially_paid')"
    )

    # --- Счёт: привязка отгрузок ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_shipments (
            id              TEXT PRIMARY KEY,
            invoice_id      TEXT NOT NULL REFERENCES invoice_docs(id),
            shipment_doc_id TEXT NOT NULL,
            client_id       TEXT,
            client_name     TEXT,
            created_at      TEXT NOT NULL,
            created_by      TEXT,
            is_deleted      INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_shipments_invoice ON invoice_shipments(invoice_id)")
    # Отгрузка принадлежит не более чем одному активному счёту.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_shipments_shipment_unique "
        "ON invoice_shipments(shipment_doc_id) WHERE is_deleted = 0"
    )

    # --- Счёт: оплаты (копейки) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_payments (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
            amount     INTEGER NOT NULL,
            paid_on    TEXT,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id)")

    # --- Счёт: журнал операций (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_ops (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoice_docs(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_ops_invoice ON invoice_ops(invoice_id)")

    # --- Счёт: файлы (Excel-расчёт и пр.) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS invoice_files (
            id         TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            filename   TEXT NOT NULL,
            url        TEXT NOT NULL,
            mime_type  TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_invoice_files_invoice ON invoice_files(invoice_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS invoice_files")
    op.execute("DROP TABLE IF EXISTS invoice_ops")
    op.execute("DROP TABLE IF EXISTS invoice_payments")
    op.execute("DROP TABLE IF EXISTS invoice_shipments")
    op.execute("DROP TABLE IF EXISTS invoice_docs")
