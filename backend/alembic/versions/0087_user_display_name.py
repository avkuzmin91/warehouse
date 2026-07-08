"""Отображаемое имя пользователя (users.display_name).

В журналах процессов и по всей системе рядом с действием показывается человек,
а не почта, на которую он зарегистрирован. Отображаемое имя задаёт админ;
если оно пустое — везде показывается email (COALESCE на чтении).

Revision ID: 0087
Revises: 0086
Create Date: 2026-07-08
"""

from __future__ import annotations

revision = "0087"
down_revision = "0086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS display_name")
