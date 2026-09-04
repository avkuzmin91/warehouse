"""Тестовый контур маркетплейса как признак подключения.

WB выдаёт отдельные токены «Тестового контура»: они отвечают только на
sandbox-хостах и на боевых дают 401 (token scope not allowed). Признак живёт
на подключении, а не в окружении, чтобы тестовый и боевой кабинет
подключались одновременно на одном инстансе.

Revision ID: 0106
Revises: 0105
Create Date: 2026-09-03
"""

from __future__ import annotations

revision = "0106"
down_revision = "0105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS is_sandbox INTEGER NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS is_sandbox")
