"""Свободный пул FBS-заказов: поставок на волну сколько нужно.

Поставку заводит менеджер, а не синк, поэтому «одна открытая поставка на
кабинет × отсечку» больше не инвариант. Вместо него в БД закрепляется то, что
действительно должно держаться при N поставках: заказ занят ровно одной из них.

Revision ID: 0113
Revises: 0112
"""

from __future__ import annotations

revision = "0113"
down_revision = "0112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS ux_mp_supplies_open_wave")
    # Задвоение заказа по активным поставкам раньше держалось только проверками в
    # коде; при ручном наборе состава из общего пула гонок больше, поэтому лишние
    # строки снимаются, а инвариант уезжает в индекс.
    op.execute("""
        UPDATE mp_supply_orders SET state = 'unselected', updated_at = NOW()::text
        WHERE id IN (
            SELECT id FROM (
                SELECT so.id,
                       ROW_NUMBER() OVER (
                           PARTITION BY so.order_id ORDER BY so.added_at DESC, so.id DESC
                       ) AS rn
                FROM mp_supply_orders so
                WHERE so.state IN ('selected', 'pending')
            ) ranked WHERE ranked.rn > 1
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_supply_orders_active "
        "ON mp_supply_orders(order_id) WHERE state IN ('selected', 'pending')"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS ux_mp_supply_orders_active")
    # Может не пройти, если к этому моменту у волны несколько открытых поставок:
    # это ровно то, что версия 0113 и разрешила.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_supplies_open_wave "
        "ON mp_supplies(account_id, COALESCE(cutoff_at, '')) "
        "WHERE status IN ('draft', 'checking') AND intake_closed_at IS NULL AND is_deleted = 0"
    )
