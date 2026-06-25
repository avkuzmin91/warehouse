"""Стоимость палета по клиенту (effective-dated).

Revision ID: 0071
Revises: 0070
Create Date: 2026-06-25

Одна цена палета на клиента, история — append-only. Действующая цена ищется по
effective_from <= дата отгрузки (как product_packing_prices); самая ранняя цена
тянется на более ранние даты («распространение назад»). Деньги — копейки INTEGER.
"""

from __future__ import annotations

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS client_pallet_prices (
            id             TEXT PRIMARY KEY,
            client_id      TEXT NOT NULL,
            price_kop      INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_client_pallet_prices_lookup "
        "ON client_pallet_prices (client_id, effective_from)"
    )


def downgrade() -> None:
    pass
