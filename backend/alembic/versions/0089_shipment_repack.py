"""Переупаковка задачи упаковки: без оплаты (наша ошибка) / за счёт клиента.

shipment_docs.repack_* — параметры запущенной менеджером переупаковки:
kind free|paid, причина, активность (пока пакуют повторно), цена за единицу
в копейках (NULL = стандартный тариф упаковки), доп. работы сверх тарифа
(копейки INTEGER) с комментарием, момент старта (расчёт суммы идёт по
pack-записям текущего цикла переупаковки) и id автосозданной записи
«Доп. работы» (paid: создаётся при выходе задачи в «Упаковано»).

zone_relocations.repack_kind/repack_price_kop — маркер на pack-записях
повторной упаковки: free — объём виден в производительности, деньги 0;
paid — тарифицируется клиенту (кастомная цена либо стандартный тариф).
Записи первого прохода остаются без маркера и сохраняют свой заработок.

Revision ID: 0089
Revises: 0088
Create Date: 2026-07-10
"""

from __future__ import annotations

revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None

_DOC_COLUMNS = (
    ("repack_kind", "TEXT"),
    ("repack_reason", "TEXT"),
    ("repack_active", "INTEGER"),
    ("repack_price_kop", "INTEGER"),
    ("repack_extra_amount_kop", "INTEGER"),
    ("repack_extra_comment", "TEXT"),
    ("repack_started_at", "TEXT"),
    ("repack_charge_entry_id", "TEXT"),
)

_MOVE_COLUMNS = (
    ("repack_kind", "TEXT"),
    ("repack_price_kop", "INTEGER"),
)


def upgrade() -> None:
    from alembic import op

    for name, kind in _DOC_COLUMNS:
        op.execute(f"ALTER TABLE shipment_docs ADD COLUMN IF NOT EXISTS {name} {kind}")
    for name, kind in _MOVE_COLUMNS:
        op.execute(f"ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS {name} {kind}")


def downgrade() -> None:
    from alembic import op

    for name, _ in reversed(_MOVE_COLUMNS):
        op.execute(f"ALTER TABLE zone_relocations DROP COLUMN IF EXISTS {name}")
    for name, _ in reversed(_DOC_COLUMNS):
        op.execute(f"ALTER TABLE shipment_docs DROP COLUMN IF EXISTS {name}")
