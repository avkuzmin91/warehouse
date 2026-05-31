"""Add zone relocations journal (move stock between storage locations).

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-01

Append-only журнал перемещений товара между местами хранения. Баланс места =
приход − отгрузка + перемещения_в − перемещения_из. Перемещаются только
принятые статусы 'good' / 'defect'.
"""

from __future__ import annotations

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS zone_relocations (
            id              TEXT PRIMARY KEY,
            product_id      TEXT NOT NULL,
            color_id        TEXT,
            size_id         TEXT,
            client_id       TEXT,
            status          TEXT NOT NULL,
            from_zone_id    TEXT,
            from_zone_name  TEXT,
            to_zone_id      TEXT,
            to_zone_name    TEXT,
            qty             INTEGER NOT NULL,
            comment         TEXT,
            created_at      TEXT NOT NULL,
            created_by      TEXT
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_position "
        "ON zone_relocations (product_id, client_id, color_id, size_id, status)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS zone_relocations")
