"""Отгрузка клиенту (dispatch_*) — отделение коммерческо-логистической сущности
от «Задачи упаковки» (shipment_*, склад).

- dispatch_docs / dispatch_lines / dispatch_ops — новый домен: менеджер набирает
  клиенту товар из готового к отгрузке (ready) и в пути, прикрепляет ссылку на сайт
  по строке (dispatch_lines.site_url), логист дробит отгрузку по рейсам.
- trip_lines.dispatch_doc_id — привязка отгрузки к рейсу (как shipment_doc_id);
  одна отгрузка может ехать несколькими рейсами, но не дважды в одном рейсе.
- trip_alloc.dispatch_line_id — сколько каждой строки отгрузки едет в этом рейсе
  (рядом с shipment_line_id/receipt_line_id, заполняется ровно одно из них).
- zone_relocations.dispatch_line_id — атрибуция списания (ready→shipped) строке
  отгрузки, для точного сторно при отмене рейса.

Связь со складом — только через журнальный остаток `ready` (вариант×клиент×качество):
задача упаковки его производит, отгрузка потребляет. Документы друг на друга не ссылаются.

Revision ID: 0064
Revises: 0063
Create Date: 2026-06-22
"""

from __future__ import annotations

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_docs (
            id             TEXT PRIMARY KEY,
            doc_number     TEXT NOT NULL UNIQUE,
            cargo_type     TEXT NOT NULL DEFAULT 'good',
            client_id      TEXT,
            client_name    TEXT,
            destination    TEXT,
            carrier        TEXT,
            logistics_cost REAL DEFAULT 0,
            ship_date      TEXT,
            actual_ship_date TEXT,
            comment        TEXT,
            priority_rank  INTEGER,
            status         TEXT NOT NULL DEFAULT 'draft',
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            updated_at     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_docs_client ON dispatch_docs(client_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_docs_status ON dispatch_docs(status)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_lines (
            id           TEXT PRIMARY KEY,
            doc_id       TEXT NOT NULL REFERENCES dispatch_docs(id),
            product_id   TEXT NOT NULL,
            product_name TEXT NOT NULL,
            product_sku  TEXT NOT NULL,
            color_id     TEXT,
            color_name   TEXT,
            size_id      TEXT,
            size_name    TEXT,
            qty          INTEGER NOT NULL DEFAULT 1,
            shipped_qty  INTEGER NOT NULL DEFAULT 0,
            site_url     TEXT,
            store_id     TEXT,
            store_name   TEXT,
            created_at   TEXT NOT NULL,
            is_deleted   INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_lines_doc ON dispatch_lines(doc_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dispatch_ops (
            id         TEXT PRIMARY KEY,
            doc_id     TEXT NOT NULL REFERENCES dispatch_docs(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_ops_doc ON dispatch_ops(doc_id)")

    # Привязка отгрузки к рейсу (рядом с shipment_doc_id для задачи упаковки/легаси).
    op.execute("ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS dispatch_doc_id TEXT")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_dispatch_per_trip "
        "ON trip_lines(trip_id, dispatch_doc_id) "
        "WHERE is_deleted = 0 AND dispatch_doc_id IS NOT NULL"
    )

    op.execute("ALTER TABLE trip_alloc ADD COLUMN IF NOT EXISTS dispatch_line_id TEXT")
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_alloc_dispatch_line ON trip_alloc(dispatch_line_id)")

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS dispatch_line_id TEXT")
    op.execute("CREATE INDEX IF NOT EXISTS idx_zone_relocations_dispatch_line ON zone_relocations(dispatch_line_id)")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS dispatch_line_id")
    op.execute("ALTER TABLE trip_alloc DROP COLUMN IF EXISTS dispatch_line_id")
    op.execute("DROP INDEX IF EXISTS idx_trip_lines_dispatch_per_trip")
    op.execute("ALTER TABLE trip_lines DROP COLUMN IF EXISTS dispatch_doc_id")
    op.execute("DROP TABLE IF EXISTS dispatch_ops")
    op.execute("DROP TABLE IF EXISTS dispatch_lines")
    op.execute("DROP TABLE IF EXISTS dispatch_docs")
