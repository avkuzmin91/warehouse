"""Выбранный код этикетки на строке задачи упаковки.

У варианта бывает несколько ШК (кабинеты Ozon и WB, массив skus одной карточки).
Печатать молча первый попавшийся опасно: чужой код на коробе — возврат партии.
Решение «чем маркируем эту строку» принадлежит документу, рядом со store_id, и
хранится снимком кода — тогда повторная печать через месяц даст тот же код.

Revision ID: 0114
Revises: 0113
"""

from __future__ import annotations

revision = "0114"
down_revision = "0113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines ADD COLUMN IF NOT EXISTS label_barcode TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_lines DROP COLUMN IF EXISTS label_barcode")
