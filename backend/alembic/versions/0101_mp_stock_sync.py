"""FBS-маркетплейсы: выгрузка остатков WMS → МП (блок «Остатки»).

mp_warehouses — склады продавца на стороне МП (у WB это склад FBS, к которому
привязаны остатки); mp_accounts.stock_warehouse_id хранит внешний id выбранного
склада, stock_sync_enabled — тумблер выгрузки по кабинету.
mp_stock_state — снапшот последнего успешно выгруженного количества по каждому
ШК: выгружаем только изменения, иначе на каждом тике улетал бы весь каталог.

Revision ID: 0101
Revises: 0100
Create Date: 2026-08-31
"""

from __future__ import annotations

revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_warehouses (
            id            TEXT PRIMARY KEY,
            account_id    TEXT NOT NULL REFERENCES mp_accounts(id),
            external_id   TEXT NOT NULL,
            name          TEXT,
            office_id     TEXT,
            cargo_type    TEXT,
            delivery_type TEXT,
            payload       TEXT,
            updated_at    TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_warehouses_account_ext "
        "ON mp_warehouses(account_id, external_id)"
    )

    op.execute("ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS stock_warehouse_id TEXT")
    op.execute(
        "ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS "
        "stock_sync_enabled INTEGER NOT NULL DEFAULT 0"
    )
    op.execute("ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS last_stock_push_at TEXT")
    op.execute("ALTER TABLE mp_accounts ADD COLUMN IF NOT EXISTS last_stock_push_error TEXT")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_stock_state (
            id         TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES mp_accounts(id),
            sku        TEXT NOT NULL,
            qty        INTEGER NOT NULL,
            pushed_at  TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_stock_state_account_sku "
        "ON mp_stock_state(account_id, sku)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS mp_stock_state")
    op.execute("DROP TABLE IF EXISTS mp_warehouses")
    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS last_stock_push_error")
    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS last_stock_push_at")
    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS stock_sync_enabled")
    op.execute("ALTER TABLE mp_accounts DROP COLUMN IF EXISTS stock_warehouse_id")
