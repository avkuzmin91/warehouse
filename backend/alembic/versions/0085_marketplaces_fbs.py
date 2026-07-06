"""FBS-маркетплейсы, Фаза 1: подключения кабинетов, кэш карточек, связка товаров,
монитор заказов.

mp_accounts — кабинеты продавцов (Ozon Seller API / WB Marketplace API); API-ключи
хранятся открытым текстом, наружу отдаются только маской (осознанное ограничение Ф1).
mp_products — кэш карточек МП: у WB одна карточка (nmID) даёт строку на каждый размер
(techSize) со своими ШК, поэтому уникальность (account_id, external_id, external_size).
mp_product_links — связка карточки МП с товаром/вариантом WMS; развязка = soft-delete.
mp_orders / mp_order_lines — FBS-заказы (read-only зеркало, сырой payload сохраняем
для отладки и Фазы 2). mp_sync_log — append-only журнал синхронизаций (ретеншн 30 дней).

Revision ID: 0085
Revises: 0084
Create Date: 2026-07-06
"""

from __future__ import annotations

revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # --- Подключения кабинетов продавцов ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_accounts (
            id              TEXT PRIMARY KEY,
            client_id       TEXT NOT NULL,
            marketplace     TEXT NOT NULL,
            name            TEXT NOT NULL,
            ozon_client_id  TEXT,
            api_key         TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'active',
            last_sync_at    TEXT,
            last_sync_error TEXT,
            created_at      TEXT NOT NULL,
            created_by      TEXT,
            is_deleted      INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_accounts_mp_status ON mp_accounts(marketplace, status)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_mp_accounts_client ON mp_accounts(client_id)")

    # --- Кэш карточек маркетплейса ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_products (
            id            TEXT PRIMARY KEY,
            account_id    TEXT NOT NULL REFERENCES mp_accounts(id),
            external_id   TEXT NOT NULL,
            offer_id      TEXT,
            title         TEXT,
            barcodes      TEXT,
            external_size TEXT,
            payload       TEXT,
            updated_at    TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_products_account_ext "
        "ON mp_products(account_id, external_id, COALESCE(external_size, ''))"
    )

    # --- Связка карточки МП с товаром WMS ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_product_links (
            id            TEXT PRIMARY KEY,
            mp_product_id TEXT NOT NULL REFERENCES mp_products(id),
            product_id    TEXT NOT NULL,
            variant_id    TEXT,
            link_source   TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            created_by    TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0
        )
    """)
    # Одна активная связка на карточку МП.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_product_links_mp_unique "
        "ON mp_product_links(mp_product_id) WHERE is_deleted = 0"
    )

    # --- FBS-заказы ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_orders (
            id              TEXT PRIMARY KEY,
            account_id      TEXT NOT NULL REFERENCES mp_accounts(id),
            external_id     TEXT NOT NULL,
            status          TEXT NOT NULL,
            external_status TEXT NOT NULL,
            created_at_mp   TEXT,
            deadline_at     TEXT,
            deadline_source TEXT,
            total_qty       INTEGER NOT NULL DEFAULT 0,
            payload         TEXT,
            first_seen_at   TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_orders_account_ext "
        "ON mp_orders(account_id, external_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_mp_orders_status ON mp_orders(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_mp_orders_deadline ON mp_orders(deadline_at)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_order_lines (
            id            TEXT PRIMARY KEY,
            order_id      TEXT NOT NULL REFERENCES mp_orders(id),
            mp_product_id TEXT,
            offer_id      TEXT,
            title         TEXT,
            qty           INTEGER NOT NULL,
            price_kopecks INTEGER
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_mp_order_lines_order ON mp_order_lines(order_id)")

    # --- Журнал синхронизаций (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS mp_sync_log (
            id         TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            kind       TEXT NOT NULL,
            ok         INTEGER NOT NULL,
            stats      TEXT,
            error      TEXT,
            created_at TEXT NOT NULL
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mp_sync_log_account ON mp_sync_log(account_id, created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS mp_sync_log")
    op.execute("DROP TABLE IF EXISTS mp_order_lines")
    op.execute("DROP TABLE IF EXISTS mp_orders")
    op.execute("DROP TABLE IF EXISTS mp_product_links")
    op.execute("DROP TABLE IF EXISTS mp_products")
    op.execute("DROP TABLE IF EXISTS mp_accounts")
