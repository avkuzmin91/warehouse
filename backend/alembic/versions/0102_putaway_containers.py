"""Задача «Размещение по ячейкам»: короба (containers) и ось контейнера в журнале остатков.

Второй тип задачи склада (`shipment_docs.task_kind`): `packing` — упаковка под
отгрузку (как было), `putaway` — размещение по ячейкам. Терминальный статус
задачи размещения — `placed`.

Короб — физический ящик с наклеенной этикеткой (QR «wms:box:<id>»): собирается на
столе упаковки и уезжает в адресную ячейку. Содержимое короба НЕ хранится
отдельной таблицей: оно считается нетто журнала `zone_relocations` по новой оси
`from_container_id`/`to_container_id` — тем же правилом, что остаток в ячейке.
`container_ops` — человекочитаемый журнал действий с коробом (история карточки).

Revision ID: 0102
Revises: 0101
Create Date: 2026-09-02
"""

from __future__ import annotations

revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS containers (
            id            TEXT PRIMARY KEY,
            doc_number    TEXT NOT NULL,
            status        TEXT NOT NULL,
            doc_id        TEXT,
            client_id     TEXT,
            client_name   TEXT,
            store_id      TEXT,
            store_name    TEXT,
            zone_id       TEXT,
            zone_name     TEXT,
            created_at    TEXT NOT NULL,
            created_by    TEXT,
            updated_at    TEXT,
            closed_at     TEXT,
            placed_at     TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS containers_number_uq ON containers (doc_number)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS containers_doc_idx ON containers (doc_id)")
    op.execute("CREATE INDEX IF NOT EXISTS containers_zone_idx ON containers (zone_id)")
    op.execute("CREATE INDEX IF NOT EXISTS containers_status_idx ON containers (status)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS container_ops (
            id            TEXT PRIMARY KEY,
            container_id  TEXT NOT NULL,
            op_type       TEXT NOT NULL,
            doc_id        TEXT,
            product_id    TEXT,
            product_name  TEXT,
            product_sku   TEXT,
            color_name    TEXT,
            size_name     TEXT,
            qty           INTEGER,
            zone_id       TEXT,
            zone_name     TEXT,
            comment       TEXT,
            created_at    TEXT NOT NULL,
            created_by    TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS container_ops_container_idx ON container_ops (container_id, created_at)"
    )

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS from_container_id TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS to_container_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS zone_relocations_to_container_idx "
        "ON zone_relocations (to_container_id) WHERE to_container_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS zone_relocations_from_container_idx "
        "ON zone_relocations (from_container_id) WHERE from_container_id IS NOT NULL"
    )

    op.execute("ALTER TABLE shipment_docs ADD COLUMN IF NOT EXISTS task_kind TEXT")
    op.execute("UPDATE shipment_docs SET task_kind = 'packing' WHERE task_kind IS NULL")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE shipment_docs DROP COLUMN IF EXISTS task_kind")
    op.execute("DROP INDEX IF EXISTS zone_relocations_from_container_idx")
    op.execute("DROP INDEX IF EXISTS zone_relocations_to_container_idx")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS to_container_id")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS from_container_id")
    op.execute("DROP TABLE IF EXISTS container_ops")
    op.execute("DROP TABLE IF EXISTS containers")
