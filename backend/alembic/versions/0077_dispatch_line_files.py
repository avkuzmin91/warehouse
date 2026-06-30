"""Вложения по строкам отгрузки (dispatch_line_files) — менеджер прикрепляет файлы
(zip, pdf, jpeg) по каждому товару в отгрузке; кладовщик видит их при подготовке.

Зеркало shipment_line_files: файл на диске в UPLOADS_DIR, в таблице — ссылка `/uploads/...`.

Revision ID: 0077
Revises: 0076
Create Date: 2026-06-29
"""

from __future__ import annotations

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_line_files (
            id         TEXT PRIMARY KEY,
            line_id    TEXT NOT NULL,
            doc_id     TEXT NOT NULL,
            filename   TEXT NOT NULL,
            url        TEXT NOT NULL,
            mime_type  TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_line_files_doc ON dispatch_line_files(doc_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_line_files_line ON dispatch_line_files(line_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS dispatch_line_files")
