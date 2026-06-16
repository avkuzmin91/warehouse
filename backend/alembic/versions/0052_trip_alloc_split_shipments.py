"""Дробление отгрузки по нескольким рейсам: распределение по строкам (trip_alloc).

- Снимаем уникальность «отгрузка ↔ один рейс» (idx_trip_lines_shipment_unique) и
  заменяем на (trip_id, shipment_doc_id): одна отгрузка может ехать несколькими
  рейсами, но не дважды в одном рейсе.
- trip_alloc — сколько каждой строки документа (SKU×цвет×размер) едет в этом рейсе.
  Таблица общая под отгрузки (shipment_line_id) и под будущие поступления
  (receipt_line_id, фаза 2); сейчас заполняется только shipment_line_id.
- zone_relocations.trip_id — атрибуция списания рейсу, чтобы точно сторнировать
  частичное списание при отмене рейса.

idx_trip_lines_receipt_unique оставлен: поступления пока 1 рейс ⇄ 1 поступление.

Revision ID: 0052
Revises: 0051
Create Date: 2026-06-15
"""

from __future__ import annotations

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_trip_lines_shipment_unique")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_shipment_per_trip "
        "ON trip_lines(trip_id, shipment_doc_id) "
        "WHERE is_deleted = 0 AND shipment_doc_id IS NOT NULL"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS trip_alloc (
            id               TEXT PRIMARY KEY,
            trip_line_id     TEXT NOT NULL REFERENCES trip_lines(id),
            shipment_line_id TEXT,
            receipt_line_id  TEXT,
            qty              INTEGER NOT NULL,
            created_at       TEXT NOT NULL,
            created_by       TEXT,
            is_deleted       INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_alloc_trip_line ON trip_alloc(trip_line_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_alloc_shipment_line ON trip_alloc(shipment_line_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_trip_alloc_receipt_line ON trip_alloc(receipt_line_id)")

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS trip_id TEXT")


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS trip_id")
    op.execute("DROP TABLE IF EXISTS trip_alloc")
    op.execute("DROP INDEX IF EXISTS idx_trip_lines_shipment_per_trip")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_lines_shipment_unique "
        "ON trip_lines(shipment_doc_id) "
        "WHERE is_deleted = 0 AND shipment_doc_id IS NOT NULL"
    )
