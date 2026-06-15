"""Орг. структура для табеля: справочник должностей и подчинение сотрудников.

- positions                    — справочник должностей (стандартный справочник)
- employees.position_id        — должность из справочника (вместо свободного текста)
- employees.user_id            — связь с учётной записью (руководитель сам — строка
                                 в табеле, случай «по себе»)
- employees.supervisor_user_id — руководитель (учётная запись), который ведёт табель
                                 и планирование по этому сотруднику

Доступ к табелю/планированию ограничивается подчинёнными: пользователь видит и правит
сотрудника E ⇔ admin, либо E.supervisor_user_id = его id, либо E.user_id = его id.

Revision ID: 0051
Revises: 0050
Create Date: 2026-06-14
"""

from __future__ import annotations

from uuid import uuid4

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


_SEED_POSITIONS = [
    "Кладовщик",
    "Уборщик",
    "Грузчик",
    "Упаковщик",
    "Помощник",
    "Начальник смены",
    "Начальник склада",
    "Менеджер",
]


def upgrade() -> None:
    from alembic import op

    # --- Справочник должностей (стандартная структура справочника) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            id            TEXT PRIMARY KEY,
            name          TEXT UNIQUE NOT NULL,
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL,
            creator_id    TEXT,
            updated_at    TEXT,
            updated_by_id TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0,
            deleted_at    TEXT,
            deleted_by_id TEXT
        )
    """)

    for name in _SEED_POSITIONS:
        op.execute(
            "INSERT INTO positions (id, name, is_active, created_at) "
            "VALUES ('%s', '%s', 1, NOW()::text) ON CONFLICT (name) DO NOTHING"
            % (uuid4(), name.replace("'", "''"))
        )

    # --- Орг. поля сотрудника ---
    op.execute("""
        ALTER TABLE IF EXISTS employees
            ADD COLUMN IF NOT EXISTS position_id        TEXT,
            ADD COLUMN IF NOT EXISTS user_id            TEXT,
            ADD COLUMN IF NOT EXISTS supervisor_user_id TEXT
    """)

    # Бэкфилл должности из свободного текста по совпадению имени (без учёта регистра).
    op.execute("""
        UPDATE employees e
        SET position_id = p.id
        FROM positions p
        WHERE e.position_id IS NULL
          AND e.position IS NOT NULL
          AND LOWER(p.name) = LOWER(e.position)
    """)

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_employees_supervisor "
        "ON employees(supervisor_user_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user "
        "ON employees(user_id) WHERE user_id IS NOT NULL AND is_deleted = 0"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_employees_user")
    op.execute("DROP INDEX IF EXISTS idx_employees_supervisor")
    op.execute("ALTER TABLE IF EXISTS employees DROP COLUMN IF EXISTS supervisor_user_id")
    op.execute("ALTER TABLE IF EXISTS employees DROP COLUMN IF EXISTS user_id")
    op.execute("ALTER TABLE IF EXISTS employees DROP COLUMN IF EXISTS position_id")
    op.execute("DROP TABLE IF EXISTS positions")
