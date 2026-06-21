"""Idempotency keys for write operations (request_id dedup, mobile §6.3).

Revision ID: 0062
Revises: 0061
Create Date: 2026-06-21
"""

from __future__ import annotations

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            request_id    TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL,
            scope         TEXT NOT NULL,
            response_json TEXT,
            created_at    TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx "
        "ON idempotency_keys (created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS idempotency_keys")
