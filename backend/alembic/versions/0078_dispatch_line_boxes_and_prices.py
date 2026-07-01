"""Короба в отгрузке: кол-во в строке + кратность на короб + цена короба по клиенту.

Revision ID: 0078
Revises: 0077
Create Date: 2026-07-01

Полный аналог палет (0070/0071). Менеджер указывает число коробов по каждой строке
отгрузки при создании (рекомендация из `products.items_per_box`, можно переопределить).
Сумма коробов по документу × цена короба клиента (client_box_prices, effective-dated)
попадает в счёт отдельным компонентом — суммируется с палетами. Действующая цена
ищется по effective_from <= дата отгрузки; самая ранняя тянется назад. Деньги —
копейки INTEGER.
"""

from __future__ import annotations

revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE IF EXISTS dispatch_lines ADD COLUMN IF NOT EXISTS boxes_qty INTEGER")
    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS items_per_box INTEGER")
    op.execute("""
        CREATE TABLE IF NOT EXISTS client_box_prices (
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
        "CREATE INDEX IF NOT EXISTS idx_client_box_prices_lookup "
        "ON client_box_prices (client_id, effective_from)"
    )


def downgrade() -> None:
    pass
