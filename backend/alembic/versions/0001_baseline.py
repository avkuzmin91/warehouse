"""Baseline schema — актуальная схема приложения.

Revision ID: 0001
Revises:
Create Date: 2026-05-27
"""

from __future__ import annotations

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _rename_table_sql(old_name: str, new_name: str) -> str:
    return f"""
    DO $$
    BEGIN
        IF to_regclass('public.{old_name}') IS NOT NULL
           AND to_regclass('public.{new_name}') IS NULL THEN
            ALTER TABLE {old_name} RENAME TO {new_name};
        ELSIF to_regclass('public.{old_name}') IS NOT NULL
              AND to_regclass('public.{new_name}') IS NOT NULL THEN
            RAISE EXCEPTION 'Both {old_name} and {new_name} exist; manual merge is required';
        END IF;
    END $$;
    """


def _rename_index_sql(old_name: str, new_name: str) -> str:
    return f"""
    DO $$
    BEGIN
        IF to_regclass('public.{old_name}') IS NOT NULL
           AND to_regclass('public.{new_name}') IS NULL THEN
            ALTER INDEX {old_name} RENAME TO {new_name};
        END IF;
    END $$;
    """


def _rename_legacy_receipt_shipment_tables(op) -> None:
    table_renames = [
        ("receipt2_docs", "receipt_docs"),
        ("receipt2_lines", "receipt_lines"),
        ("receipt2_ops", "receipt_ops"),
        ("shipment2_docs", "shipment_docs"),
        ("shipment2_lines", "shipment_lines"),
        ("shipment2_ops", "shipment_ops"),
    ]
    index_renames = [
        ("idx_r2docs_client", "idx_receipt_docs_client"),
        ("idx_r2lines_doc", "idx_receipt_lines_doc"),
        ("idx_r2ops_doc", "idx_receipt_ops_doc"),
        ("idx_s2docs_client", "idx_shipment_docs_client"),
        ("idx_s2lines_doc", "idx_shipment_lines_doc"),
        ("idx_s2ops_doc", "idx_shipment_ops_doc"),
    ]

    for old_name, new_name in table_renames:
        op.execute(_rename_table_sql(old_name, new_name))
    for old_name, new_name in index_renames:
        op.execute(_rename_index_sql(old_name, new_name))


def upgrade() -> None:
    from alembic import op

    _rename_legacy_receipt_shipment_tables(op)

    # ------------------------------------------------------------------
    # Расширение для case-insensitive fold (ё → е)
    # ------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION fold_ci(input TEXT)
        RETURNS TEXT
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        AS $fold$
            SELECT replace(lower(COALESCE(input, '')), 'ё', 'е')
        $fold$
    """)

    # ------------------------------------------------------------------
    # Системный справочник «актуальность записи»
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS record_actuality (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            maps_is_active INTEGER NOT NULL,
            sort_order   INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("""
        INSERT INTO record_actuality (id, name, maps_is_active, sort_order)
        VALUES
            ('00000000-0000-4000-8000-000000000001', 'Актуален',     1, 0),
            ('00000000-0000-4000-8000-000000000002', 'Не актуален',  0, 1)
        ON CONFLICT (id) DO NOTHING
    """)

    # ------------------------------------------------------------------
    # Пользователи
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'user',
            client_id     TEXT,
            created_at    TEXT NOT NULL,
            is_deleted    INTEGER NOT NULL DEFAULT 0,
            deleted_at    TEXT,
            deleted_by_id TEXT
        )
    """)

    # ------------------------------------------------------------------
    # Auth-сессии
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id           TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL,
            refresh_hash TEXT NOT NULL,
            expires_at   TEXT NOT NULL,
            revoked_at   TEXT,
            created_at   TEXT NOT NULL,
            last_used_at TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_refresh_hash_active_uq
        ON auth_sessions (refresh_hash)
        WHERE revoked_at IS NULL
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS auth_refresh_superseded (
            superseded_hash TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL,
            superseded_at   TEXT NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS auth_refresh_superseded_user_id_idx
        ON auth_refresh_superseded (user_id)
    """)

    # ------------------------------------------------------------------
    # Справочники (единая структура)
    # ------------------------------------------------------------------
    for table, default_active in [
        ("clients",         0),
        ("colors",          0),
        ("sizes",           0),
        ("product_types",   0),
        ("suppliers",       0),
        ("unloading_zones", 1),
        ("warehouses",      1),
        ("carriers",        1),
        ("defect_reasons",  1),
    ]:
        op.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id            TEXT PRIMARY KEY,
                name          TEXT UNIQUE NOT NULL,
                is_active     INTEGER NOT NULL DEFAULT {default_active},
                created_at    TEXT NOT NULL,
                creator_id    TEXT,
                updated_at    TEXT,
                updated_by_id TEXT,
                is_deleted    INTEGER NOT NULL DEFAULT 0,
                deleted_at    TEXT,
                deleted_by_id TEXT
            )
        """)

    # product_types: доп. колонки
    op.execute("""
        ALTER TABLE product_types
            ADD COLUMN IF NOT EXISTS requires_color INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS requires_size  INTEGER NOT NULL DEFAULT 0
    """)

    # ------------------------------------------------------------------
    # Товары
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            type_id       TEXT NOT NULL,
            client_id     TEXT,
            supplier_id   TEXT,
            sku           TEXT UNIQUE NOT NULL,
            image_url     TEXT,
            gallery_json  TEXT,
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL,
            creator_id    TEXT,
            updated_at    TEXT,
            updated_by_id TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0,
            deleted_at    TEXT,
            deleted_by_id TEXT
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS product_variants (
            id         TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            color_id   TEXT,
            size_id    TEXT,
            length     REAL NOT NULL DEFAULT 0,
            width      REAL NOT NULL DEFAULT 0,
            height     REAL NOT NULL DEFAULT 0,
            sku        TEXT NOT NULL UNIQUE,
            images_json TEXT NOT NULL DEFAULT '[]',
            is_active  INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0,
            deleted_at    TEXT,
            deleted_by_id TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id)")

    # ------------------------------------------------------------------
    # Импорт (логи)
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS import_movement_logs (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            op_type     TEXT NOT NULL,
            filename    TEXT,
            total       INTEGER NOT NULL DEFAULT 0,
            success     INTEGER NOT NULL DEFAULT 0,
            failed      INTEGER NOT NULL DEFAULT 0,
            warnings    INTEGER NOT NULL DEFAULT 0,
            detail_json TEXT
        )
    """)

    # ------------------------------------------------------------------
    # Поступления
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS receipt_docs (
            id             TEXT PRIMARY KEY,
            doc_number     TEXT NOT NULL UNIQUE,
            client_id      TEXT NOT NULL,
            supplier_id    TEXT,
            supplier_name  TEXT,
            arrival_date   TEXT,
            status         TEXT NOT NULL DEFAULT 'draft',
            zone_id        TEXT,
            zone_name      TEXT,
            ttn            TEXT,
            logistics_cost REAL DEFAULT 0,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            updated_at     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_receipt_docs_client ON receipt_docs(client_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS receipt_lines (
            id           TEXT PRIMARY KEY,
            doc_id       TEXT NOT NULL REFERENCES receipt_docs(id),
            product_id   TEXT NOT NULL,
            product_name TEXT NOT NULL,
            product_sku  TEXT NOT NULL,
            color_id     TEXT,
            color_name   TEXT,
            size_id      TEXT,
            size_name    TEXT,
            planned_qty  INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT NOT NULL,
            created_by   TEXT,
            is_deleted   INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_receipt_lines_doc ON receipt_lines(doc_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS receipt_ops (
            id         TEXT PRIMARY KEY,
            doc_id     TEXT NOT NULL REFERENCES receipt_docs(id),
            line_id    TEXT,
            op_type    TEXT NOT NULL,
            qty        INTEGER,
            reason     TEXT,
            comment    TEXT,
            payload    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_receipt_ops_doc ON receipt_ops(doc_id)")

    # ------------------------------------------------------------------
    # Отгрузки
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS shipment_docs (
            id          TEXT PRIMARY KEY,
            doc_number  TEXT NOT NULL UNIQUE,
            cargo_type  TEXT NOT NULL DEFAULT 'good',
            client_id   TEXT,
            client_name TEXT,
            destination TEXT,
            carrier     TEXT,
            ship_date   TEXT,
            comment     TEXT,
            status      TEXT NOT NULL DEFAULT 'draft',
            created_at  TEXT NOT NULL,
            created_by  TEXT,
            updated_at  TEXT,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_shipment_docs_client ON shipment_docs(client_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS shipment_lines (
            id           TEXT PRIMARY KEY,
            doc_id       TEXT NOT NULL REFERENCES shipment_docs(id),
            product_id   TEXT NOT NULL,
            product_name TEXT NOT NULL,
            product_sku  TEXT NOT NULL,
            color_id     TEXT,
            color_name   TEXT,
            size_id      TEXT,
            size_name    TEXT,
            qty          INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT NOT NULL,
            is_deleted   INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_shipment_lines_doc ON shipment_lines(doc_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS shipment_ops (
            id         TEXT PRIMARY KEY,
            doc_id     TEXT NOT NULL REFERENCES shipment_docs(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_shipment_ops_doc ON shipment_ops(doc_id)")


def downgrade() -> None:
    from alembic import op

    for tbl in [
        "shipment_ops", "shipment_lines", "shipment_docs",
        "receipt_ops", "receipt_lines", "receipt_docs",
        "import_movement_logs",
        "product_variants", "products",
        "defect_reasons", "carriers", "warehouses", "unloading_zones",
        "suppliers", "product_types", "sizes", "colors", "clients",
        "auth_refresh_superseded", "auth_sessions",
        "users",
        "record_actuality",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")
    op.execute("DROP FUNCTION IF EXISTS fold_ci(TEXT)")
