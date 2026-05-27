"""Drop legacy app migrations marker table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-27
"""

from __future__ import annotations

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS app_migrations CASCADE")


def downgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY
        )
    """)
