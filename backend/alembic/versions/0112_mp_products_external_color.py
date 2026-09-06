"""Цвет карточки маркетплейса в кэше товаров МП.

Revision ID: 0112
Revises: 0111
"""

from __future__ import annotations

revision = "0112"
down_revision = "0111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Заполняется при синхронизации каталога: у WB цвет лежит в характеристиках карточки.
    op.execute("ALTER TABLE mp_products ADD COLUMN IF NOT EXISTS external_color TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE mp_products DROP COLUMN IF EXISTS external_color")
