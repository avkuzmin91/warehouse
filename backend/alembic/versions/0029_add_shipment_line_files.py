"""Add shipment_line_files table.

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-05
"""

from __future__ import annotations

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS shipment_line_files (
            id          TEXT PRIMARY KEY,
            line_id     TEXT NOT NULL,
            doc_id      TEXT NOT NULL,
            filename    TEXT NOT NULL,
            url         TEXT NOT NULL,
            mime_type   TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT NOT NULL,
            is_deleted  INTEGER DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_shipment_line_files_line ON shipment_line_files(line_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_shipment_line_files_doc ON shipment_line_files(doc_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_shipment_line_files_line")
    op.execute("DROP INDEX IF EXISTS idx_shipment_line_files_doc")
    op.execute("DROP TABLE IF EXISTS shipment_line_files")
