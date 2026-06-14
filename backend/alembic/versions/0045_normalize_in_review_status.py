"""Normalize legacy receipt status in_review -> on_review.

Revision ID: 0045
Revises: 0044
Create Date: 2026-06-11

Раньше статус нормализовался кодом при старте приложения; код удалён,
миграция закрывает остаточные строки раз и навсегда.
"""

from __future__ import annotations

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("UPDATE receipt_docs SET status = 'on_review' WHERE status = 'in_review'")


def downgrade() -> None:
    pass
