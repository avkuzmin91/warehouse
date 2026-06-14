"""Rename shipment status on_shipping → relocating.

Revision ID: 0040
Revises: 0039
Create Date: 2026-06-09

Статус «На отгрузке» (on_shipping) заменён на «Перемещение» (relocating): кладовщик
раскладывает упакованный годный/брак по местам хранения перед рейсом. Завершение
(списание) переехало на отправку привязанного рейса. Данные-миграция переводит
зависшие документы; новый статус awaiting_trip создаётся самим переходом.
"""

from __future__ import annotations

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("UPDATE shipment_docs SET status = 'relocating' WHERE status = 'on_shipping'")


def downgrade() -> None:
    from alembic import op

    op.execute("UPDATE shipment_docs SET status = 'on_shipping' WHERE status = 'relocating'")
