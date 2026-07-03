"""Perf indexes: zone_relocations, trip_lines, dispatch_lines.

Revision ID: 0080
Revises: 0079
Create Date: 2026-07-02
"""

from __future__ import annotations

revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Замена idx_zone_relocations_position, молча удалённого вместе с колонкой status в 0037.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_variant "
        "ON zone_relocations (product_id, client_id, color_id, size_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_shipment_line "
        "ON zone_relocations (shipment_line_id) WHERE shipment_line_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_reverses "
        "ON zone_relocations (reverses_id) WHERE reverses_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_trip "
        "ON zone_relocations (trip_id) WHERE trip_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_created "
        "ON zone_relocations (created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_client_created "
        "ON zone_relocations (client_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_packed_date "
        "ON zone_relocations (packed_date) WHERE pack_entry_id IS NOT NULL"
    )
    # from_status/to_status после 0042 нигде не читаются — индекс только тормозит вставки.
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_conv")

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_trip_lines_receipt_doc "
        "ON trip_lines (receipt_doc_id) WHERE receipt_doc_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_trip_lines_dispatch_doc "
        "ON trip_lines (dispatch_doc_id) WHERE dispatch_doc_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_dispatch_lines_product_color_size "
        "ON dispatch_lines (product_id, color_id, size_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_dispatch_lines_product_color_size")
    op.execute("DROP INDEX IF EXISTS idx_trip_lines_dispatch_doc")
    op.execute("DROP INDEX IF EXISTS idx_trip_lines_receipt_doc")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_conv "
        "ON zone_relocations (from_status, to_status, product_id, client_id, color_id, size_id)"
    )
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_packed_date")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_client_created")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_created")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_trip")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_reverses")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_shipment_line")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_variant")
