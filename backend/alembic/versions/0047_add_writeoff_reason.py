"""Write-off reason: причина списания в журнале движений.

Revision ID: 0047
Revises: 0046
Create Date: 2026-06-12

Списание остатков — журнальное движение (storage, …) → (written_off, …),
второй терминальный сток рядом с shipped. Причина списания (недостача / порча /
утилизация брака / возврат клиенту / прочее) хранится кодом в отдельной колонке,
а не в комментарии — для отчётности и витрины ЛК клиента.
"""

from __future__ import annotations

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS reason TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS reason")
