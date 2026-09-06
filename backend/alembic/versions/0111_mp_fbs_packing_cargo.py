"""FBS: упаковка заказов (ШК/ЧЗ, этикетка площадки) и грузовые места поставки.

Revision ID: 0111
Revises: 0110
"""

from __future__ import annotations

revision = "0111"
down_revision = "0110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Фаза «Упаковка» между сборкой и передачей.
    op.execute("ALTER TABLE mp_supplies ADD COLUMN IF NOT EXISTS packing_at TEXT")

    # Заказ как единица упаковки: когда закрыт, чем ответила площадка, где этикетка.
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS packed_at TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS packed_by TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS mp_shipped_at TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS mp_error TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS label_url TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS label_barcode TEXT")
    op.execute("ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS label_fetched_at TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_orders_label_barcode "
        "ON mp_orders(label_barcode) WHERE label_barcode IS NOT NULL"
    )

    # Журнал упаковки: единица товара (ШК или КИЗ) уложена в конкретный заказ.
    # Append-only, откат — строка с отрицательным qty и reverses_id; сток не двигает
    # (товар уже в корзине picked), только распределяет собранное по заказам.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mp_supply_packs (
            id              TEXT PRIMARY KEY,
            supply_id       TEXT NOT NULL,
            order_id        TEXT NOT NULL,
            line_id         TEXT NOT NULL,
            variant_id      TEXT,
            product_id      TEXT NOT NULL,
            color_id        TEXT,
            size_id         TEXT,
            marking_code_id TEXT,
            cis_raw         TEXT,
            qty             INTEGER NOT NULL,
            reverses_id     TEXT,
            created_at      TEXT NOT NULL,
            created_by      TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_supply_packs_supply_idx "
        "ON mp_supply_packs (supply_id, order_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_supply_packs_marking_idx "
        "ON mp_supply_packs (marking_code_id) WHERE marking_code_id IS NOT NULL"
    )

    # Грузовые места: короб/палета, уезжающие на площадку.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mp_cargo_units (
            id          TEXT PRIMARY KEY,
            supply_id   TEXT NOT NULL REFERENCES mp_supplies(id),
            doc_number  TEXT NOT NULL UNIQUE,
            kind        TEXT NOT NULL DEFAULT 'box',
            status      TEXT NOT NULL DEFAULT 'open',
            external_id TEXT,
            closed_at   TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT,
            updated_at  TEXT NOT NULL,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_cargo_units_supply_idx "
        "ON mp_cargo_units (supply_id, status)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mp_cargo_unit_orders (
            id            TEXT PRIMARY KEY,
            cargo_unit_id TEXT NOT NULL REFERENCES mp_cargo_units(id),
            order_id      TEXT NOT NULL REFERENCES mp_orders(id),
            added_at      TEXT NOT NULL,
            added_by      TEXT
        )
        """
    )
    # Заказ лежит ровно в одном грузовом месте.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_cargo_unit_orders_order "
        "ON mp_cargo_unit_orders (order_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS mp_cargo_unit_orders_unit_idx "
        "ON mp_cargo_unit_orders (cargo_unit_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS mp_cargo_unit_orders")
    op.execute("DROP TABLE IF EXISTS mp_cargo_units")
    op.execute("DROP TABLE IF EXISTS mp_supply_packs")
    op.execute("DROP INDEX IF EXISTS idx_mp_orders_label_barcode")
    for col in ("packed_at", "packed_by", "mp_shipped_at", "mp_error",
                "label_url", "label_barcode", "label_fetched_at"):
        op.execute(f"ALTER TABLE mp_orders DROP COLUMN IF EXISTS {col}")
    op.execute("ALTER TABLE mp_supplies DROP COLUMN IF EXISTS packing_at")
