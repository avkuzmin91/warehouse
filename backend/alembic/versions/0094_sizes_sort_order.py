"""Порядок размеров в справочнике (S < M < L, а не алфавит).

Revision ID: 0094
Revises: 0093
Create Date: 2026-08-08

Размерные сетки не сортируются по имени (алфавит даёт L, M, S, XL, XS), поэтому
порядок задаётся явным полем sort_order. NULL = порядок не задан — такие размеры
идут после упорядоченных, по имени.
"""

from __future__ import annotations

revision = "0094"
down_revision = "0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE sizes ADD COLUMN IF NOT EXISTS sort_order INTEGER")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE sizes DROP COLUMN IF EXISTS sort_order")
