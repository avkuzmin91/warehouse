"""FBS-поставки (Фаза 2): поставка как единица работы менеджера и задача склада.

mp_supplies — поставка кабинета к одной отсечке. Пара (account_id, cutoff_at) —
это «волна»: площадка не примет отгрузку с заказами двух продавцов, поэтому
кабинет задаёт жёсткую границу, а отсечка — окно. Приём в поставку закрывается
за mp_accounts.intake_close_minutes до отсечки, дальше поток идёт в следующую.

mp_supply_orders — состав. Заказ в поставке имеет состояние: selected (поедет),
unselected (снят менеджером — заказ освобождается и перетекает в следующую
поставку, строка остаётся следом), pending (подъехал в идущую сборку, ждёт
решения о дозагрузке). Частичный UNIQUE по order_id держит инвариант
«один заказ в одной активной поставке» на уровне БД: гонка воркера синка
и ручного действия менеджера не может завести дубль.

mp_supply_ops — append-only журнал поставки (как receipt_ops / shipment_ops).

Revision ID: 0105
Revises: 0104
Create Date: 2026-09-03
"""

from __future__ import annotations

revision = "0105"
down_revision = "0104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS intake_close_minutes INTEGER"
    )

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_supplies (
            id                 TEXT PRIMARY KEY,
            doc_number         TEXT NOT NULL UNIQUE,
            account_id         TEXT NOT NULL REFERENCES mp_accounts(id),
            cutoff_at          TEXT,
            intake_closes_at   TEXT,
            intake_closed_at   TEXT,
            status             TEXT NOT NULL DEFAULT 'draft',
            external_supply_id TEXT,
            checking_at        TEXT,
            picking_at         TEXT,
            handover_at        TEXT,
            done_at            TEXT,
            created_at         TEXT NOT NULL,
            created_by         TEXT,
            updated_at         TEXT NOT NULL,
            is_deleted         INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_supplies_account_status "
        "ON mp_supplies(account_id, status)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_mp_supplies_cutoff ON mp_supplies(cutoff_at)")
    # Одна открытая на приём поставка на волну: маршрутизатор синка не должен
    # заводить вторую, пока первая ещё набирается. Закрытие приёма освобождает
    # волну — заказ, приехавший после отсечки приёма, уходит в следующую поставку.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_supplies_open_wave "
        "ON mp_supplies(account_id, COALESCE(cutoff_at, '')) "
        "WHERE status IN ('draft', 'checking') AND intake_closed_at IS NULL AND is_deleted = 0"
    )

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_supply_orders (
            id         TEXT PRIMARY KEY,
            supply_id  TEXT NOT NULL REFERENCES mp_supplies(id),
            order_id   TEXT NOT NULL REFERENCES mp_orders(id),
            state      TEXT NOT NULL DEFAULT 'selected',
            added_at   TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_supply_orders_pair "
        "ON mp_supply_orders(supply_id, order_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_supply_orders_active "
        "ON mp_supply_orders(order_id) WHERE state IN ('selected', 'pending')"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_supply_orders_supply "
        "ON mp_supply_orders(supply_id, state)"
    )

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_supply_ops (
            id         TEXT PRIMARY KEY,
            supply_id  TEXT NOT NULL REFERENCES mp_supplies(id),
            op_type    TEXT NOT NULL,
            order_id   TEXT,
            qty        INTEGER,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_supply_ops_supply "
        "ON mp_supply_ops(supply_id, created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS mp_supply_ops")
    op.execute("DROP TABLE IF EXISTS mp_supply_orders")
    op.execute("DROP TABLE IF EXISTS mp_supplies")
    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS intake_close_minutes")
