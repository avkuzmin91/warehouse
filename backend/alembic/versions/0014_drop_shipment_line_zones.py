"""Drop legacy shipment_line_zones table.

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-01

Отгрузка перешла на единственное место в shipment_lines.storage_zone_id, а
балансы по месту считаются из него. Таблица multi-zone распределения
(0007) больше не используется — удаляем.
"""

from __future__ import annotations

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS shipment_line_zones")


def downgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS shipment_line_zones (
            id                TEXT PRIMARY KEY,
            doc_id            TEXT NOT NULL REFERENCES shipment_docs(id),
            line_id           TEXT NOT NULL REFERENCES shipment_lines(id),
            storage_zone_id   TEXT,
            storage_zone_name TEXT,
            qty               INTEGER NOT NULL,
            created_at        TEXT NOT NULL
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_shipment_line_zones_line ON shipment_line_zones(line_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_shipment_line_zones_doc ON shipment_line_zones(doc_id)")
