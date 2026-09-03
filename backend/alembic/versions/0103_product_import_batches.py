"""Пакеты массовой загрузки товаров из Excel (превью → применение).

Revision ID: 0103
Revises: 0102
Create Date: 2026-09-03
"""

from __future__ import annotations

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_import_batches (
            id           TEXT PRIMARY KEY,
            client_id    TEXT NOT NULL,
            file_name    TEXT,
            status       TEXT NOT NULL,
            rows_json    TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            created_by   TEXT,
            committed_at TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS product_import_batches_created_idx "
        "ON product_import_batches (created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS product_import_batches_created_idx")
    op.execute("DROP TABLE IF EXISTS product_import_batches")
