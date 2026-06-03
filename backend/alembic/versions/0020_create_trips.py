"""Create logistics trips (trip_docs/trip_lines/trip_ops) and vehicle_types dictionary.

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-02
"""

from __future__ import annotations

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # --- Справочник «Тип кузова» (как прочие справочники) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS vehicle_types (
            id            TEXT PRIMARY KEY,
            name          TEXT UNIQUE NOT NULL,
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

    # --- Рейсы: шапка ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS trip_docs (
            id                   TEXT PRIMARY KEY,
            trip_number          TEXT NOT NULL UNIQUE,
            direction            TEXT NOT NULL DEFAULT 'inbound',
            status               TEXT NOT NULL DEFAULT 'draft',
            assignee_role        TEXT,
            assignee_id          TEXT,
            origin_id            TEXT,
            origin_name          TEXT,
            carrier_id           TEXT,
            carrier_name         TEXT,
            vehicle_type_id      TEXT,
            vehicle_type_name    TEXT,
            transport_ordered_at TEXT,
            eta                  TEXT,
            cost_estimate        REAL,
            comment              TEXT,
            arrived_at           TEXT,
            unload_finished_at   TEXT,
            load_factor          TEXT,
            logistics_cost_actual REAL,
            waiting_cost         REAL,
            waiting_minutes      INTEGER,
            created_at           TEXT NOT NULL,
            created_by           TEXT,
            updated_at           TEXT,
            is_deleted           INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_docs_status ON trip_docs(status)")

    # --- Рейсы: привязка поступлений ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS trip_lines (
            id             TEXT PRIMARY KEY,
            trip_id        TEXT NOT NULL REFERENCES trip_docs(id),
            receipt_doc_id TEXT NOT NULL,
            client_id      TEXT,
            client_name    TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_lines_trip ON trip_lines(trip_id)")
    # Поступление принадлежит не более чем одному активному рейсу.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_receipt_unique "
        "ON trip_lines(receipt_doc_id) WHERE is_deleted = 0"
    )

    # --- Рейсы: журнал операций (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS trip_ops (
            id         TEXT PRIMARY KEY,
            trip_id    TEXT NOT NULL REFERENCES trip_docs(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_ops_trip ON trip_ops(trip_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS trip_ops")
    op.execute("DROP TABLE IF EXISTS trip_lines")
    op.execute("DROP TABLE IF EXISTS trip_docs")
    op.execute("DROP TABLE IF EXISTS vehicle_types")
