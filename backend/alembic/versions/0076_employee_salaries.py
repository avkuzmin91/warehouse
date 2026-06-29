"""Effective-dated оклад сотрудников (employee_salaries).

Оклад окладников (comp_type=fixed) переезжает с одного поля employees.fixed_salary_kopecks
на append-only историю с датой начала действия — как почасовая ставка (employee_rates) и
аренда складов (warehouse_rent_rates). Действующий оклад на дату ищется правилом «последняя
запись с effective_from <= дата»; в отличие от ставки, дни ДО самой ранней записи окладом
не считаются (оклад начинает действовать со своей даты — это и есть «дата начала оклада»).
Колонка employees.fixed_salary_kopecks остаётся денормализованным кэшем «оклада на сегодня»
для списка/шапки карточки и lookups.

Сид: текущий оклад каждого окладника переносится в историю записью с effective_from =
датой приёма (hired_on, иначе дата создания), чтобы ранее заведённый оклад не потерялся.

Revision ID: 0076
Revises: 0075
Create Date: 2026-06-29
"""

from __future__ import annotations

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_salaries (
            id             TEXT PRIMARY KEY,
            employee_id    TEXT NOT NULL REFERENCES employees(id),
            salary_kopecks INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_employee_salaries_emp "
        "ON employee_salaries (employee_id, effective_from)"
    )
    op.execute("""
        INSERT INTO employee_salaries
            (id, employee_id, salary_kopecks, effective_from, note, created_at, created_by, is_deleted)
        SELECT gen_random_uuid()::text, id, fixed_salary_kopecks,
               COALESCE(hired_on, substr(created_at, 1, 10)),
               NULL, created_at, created_by, 0
        FROM employees
        WHERE comp_type = 'fixed'
          AND COALESCE(fixed_salary_kopecks, 0) > 0
          AND COALESCE(is_deleted, 0) = 0
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS employee_salaries")
