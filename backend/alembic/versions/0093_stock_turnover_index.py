"""Частичный индекс под оборотную ведомость (значимые движения журнала).

Revision ID: 0093
Revises: 0092
Create Date: 2026-08-07

Отчёт «Оборот» читает только движения, меняющие общий остаток позиции: приход и
корректировка приёмки (ось intake) плюс расход и возврат по терминальным стокам
(shipped / written_off). Это малая доля журнала — внутренние переходы между
корзинами (storage → packing → packed → ready) и перемещения между местами
составляют его основную массу. Частичный индекс режет скан до значимого среза.
"""

from __future__ import annotations

revision = "0093"
down_revision = "0092"
branch_labels = None
depends_on = None

_SIGNIFICANT = (
    "from_op = 'intake' OR to_op = 'intake'"
    " OR from_op IN ('shipped', 'written_off') OR to_op IN ('shipped', 'written_off')"
)


def upgrade() -> None:
    from alembic import op

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_turnover "
        "ON zone_relocations (product_id, client_id, color_id, size_id, created_at) "
        f"WHERE {_SIGNIFICANT}"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_turnover")
