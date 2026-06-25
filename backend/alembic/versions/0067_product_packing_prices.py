"""Тарифы на упаковку товара (effective-dated), раздельно годный/брак, по клиенту.

Revision ID: 0067
Revises: 0066
Create Date: 2026-06-25

Стоимость услуги упаковки/поиска брака: за единицу, раздельные ставки для
годного (quality='good') и брака (quality='defect'), ключ (товар, клиент).
История цен — append-only, действующая ставка ищется по effective_from <= дата
события (как employee_rates в табеле); самая ранняя ставка тянется на более
ранние даты («распространение назад»), чтобы уже упакованное/отгруженное до
заведения тарифа не считалось нулём.
"""

from __future__ import annotations

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS product_packing_prices (
            id             TEXT PRIMARY KEY,
            product_id     TEXT NOT NULL,
            client_id      TEXT NOT NULL,
            quality        TEXT NOT NULL,
            price_kop      INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_packing_prices_lookup "
        "ON product_packing_prices (product_id, client_id, quality, effective_from)"
    )


def downgrade() -> None:
    pass
