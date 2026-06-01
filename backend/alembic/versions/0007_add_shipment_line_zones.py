"""Add per-zone allocations for shipment lines.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-29
"""

from __future__ import annotations

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS shipment_line_zones")
