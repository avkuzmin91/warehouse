"""Реестр кодов маркировки «Честный знак» (КИЗ), отсканированных на складе.

Идентичность кода — пара (gtin, serial) из AI 01 и AI 21, а не сырая строка:
один и тот же физический КИЗ разные сканеры отдают по-разному (с разделителями
FNC1 и без, с символьным префиксом ]d2 и без него). Уникальность — частичный
индекс по активным строкам, как у product_barcodes: soft-delete позволяет снять
ошибочный скан и отсканировать код заново.

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

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS marking_codes (
            id         TEXT PRIMARY KEY,
            gtin       TEXT NOT NULL,
            serial     TEXT NOT NULL,
            raw        TEXT NOT NULL,
            variant_id TEXT,
            product_id TEXT,
            client_id  TEXT,
            is_exact   INTEGER NOT NULL DEFAULT 1,
            created_at TEXT,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS marking_codes_sgtin_active_uq
        ON marking_codes (gtin, serial)
        WHERE COALESCE(is_deleted, 0) = 0
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS marking_codes_variant_idx ON marking_codes (variant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS marking_codes_created_idx ON marking_codes (created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS marking_codes")
