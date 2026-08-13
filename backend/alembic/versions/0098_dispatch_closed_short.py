"""Закрытие отгрузки с недовозом: отметка на документе.

Отгрузка, часть которой уехала, а остаток больше не поедет, зависала в
«Частично отгружено»: резерв на недовоз держался, в счёт документ не попадал.
Менеджер закрывает такую отгрузку в `shipped`, а факт недовоза остаётся на
документе — план строк не переписываем, недовоз = Σ(qty − shipped_qty).

Revision ID: 0098
Revises: 0097
Create Date: 2026-08-13
"""

from __future__ import annotations

revision = "0098"
down_revision = "0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE dispatch_docs ADD COLUMN IF NOT EXISTS closed_short_at TEXT")
    op.execute("ALTER TABLE dispatch_docs ADD COLUMN IF NOT EXISTS closed_short_by TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE dispatch_docs DROP COLUMN IF EXISTS closed_short_by")
    op.execute("ALTER TABLE dispatch_docs DROP COLUMN IF EXISTS closed_short_at")
