"""Align Техника product type flags with seed (no required color/size).

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-29

"""
from __future__ import annotations

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        UPDATE product_types
        SET requires_color = 0, requires_size = 0
        WHERE LOWER(TRIM(name)) = 'техника'
          AND COALESCE(is_deleted, 0) = 0
        """
    )


def downgrade() -> None:
    pass
