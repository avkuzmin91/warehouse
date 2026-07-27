"""Аудит смены цвета/размера варианта с переносом истории.

Идентичность остатка — тройка (product_id, color_id, size_id). Ошибочно заведённый
цвет («не знали цвет — узнали») раньше нельзя было исправить: гейт 409 при любых
поступлениях. Теперь админ-операция change-identity пере-ключевывает журнал
zone_relocations и строки документов на новый ключ; этот журнал — append-only след
таких операций (кто, когда, что и сколько строк перенёс).
"""

from __future__ import annotations

revision = "0092"
down_revision = "0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS variant_identity_changes (
            id              TEXT PRIMARY KEY,
            product_id      TEXT NOT NULL,
            variant_id      TEXT NOT NULL,
            old_color_id    TEXT,
            old_color_name  TEXT,
            new_color_id    TEXT,
            new_color_name  TEXT,
            old_size_id     TEXT,
            old_size_name   TEXT,
            new_size_id     TEXT,
            new_size_name   TEXT,
            old_sku         TEXT,
            new_sku         TEXT,
            journal_rows    INTEGER NOT NULL DEFAULT 0,
            receipt_rows    INTEGER NOT NULL DEFAULT 0,
            shipment_rows   INTEGER NOT NULL DEFAULT 0,
            dispatch_rows   INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            created_by      TEXT
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_variant_identity_changes_product "
        "ON variant_identity_changes (product_id, created_at)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS variant_identity_changes")
