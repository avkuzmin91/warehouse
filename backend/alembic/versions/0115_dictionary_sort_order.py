"""Явный порядок в простых справочниках (не алфавит и не дата заведения).

Revision ID: 0115
Revises: 0114
Create Date: 2026-09-06

Размеры получили sort_order в 0094, но проблема общая: «Причины брака»,
«Должности», «Типы кузовов» тоже читаются в осмысленном порядке, а не по
алфавиту или дате создания. NULL = порядок не задан — такие значения идут
после упорядоченных, «натуральной» сортировкой имени (числовой префикс
числом: 44 раньше 104).
"""

from __future__ import annotations

revision = "0115"
down_revision = "0114"
branch_labels = None
depends_on = None

# sizes уже имеет колонку с 0094
TABLES = (
    "colors",
    "product_types",
    "suppliers",
    "unloading_zones",
    "warehouses",
    "own_warehouses",
    "carriers",
    "vehicle_types",
    "positions",
    "defect_reasons",
)


def upgrade() -> None:
    from alembic import op

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS sort_order INTEGER")


def downgrade() -> None:
    from alembic import op

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS sort_order")
