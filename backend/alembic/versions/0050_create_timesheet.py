"""Create timesheet & payroll tables.

Табель учёта рабочего времени и выплаты:
- employees           — справочник сотрудников склада (не пользователи системы)
- employee_rates      — почасовая ставка с историей (effective-dated, append-only)
- timesheet_entries   — табельная запись: одна на сотрудник × дата (план/факт)
- timesheet_ops       — журнал правок табеля (append-only)
- payroll_payments    — выплаты: пятничный расчёт и авансы (append-only)

Ставки и суммы выплат хранятся в КОПЕЙКАХ как INTEGER — как в модуле счетов:
денежный учёт не должен накапливать ошибки округления float.

Revision ID: 0050
Revises: 0049
Create Date: 2026-06-14
"""

from __future__ import annotations

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # --- Сотрудники ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id          TEXT PRIMARY KEY,
            full_name   TEXT NOT NULL,
            position    TEXT,
            status      TEXT NOT NULL DEFAULT 'active',
            hired_on    TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT,
            updated_at  TEXT,
            is_deleted  INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)")

    # --- Ставки (effective-dated, append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_rates (
            id             TEXT PRIMARY KEY,
            employee_id    TEXT NOT NULL REFERENCES employees(id),
            rate_kopecks   INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            note           TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_employee_rates_emp "
        "ON employee_rates(employee_id, effective_from)"
    )

    # --- Табельные записи: одна на сотрудник × дата ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS timesheet_entries (
            id            TEXT PRIMARY KEY,
            employee_id   TEXT NOT NULL REFERENCES employees(id),
            work_date     TEXT NOT NULL,
            planned_start TEXT,
            planned_end   TEXT,
            actual_start  TEXT,
            actual_end    TEXT,
            is_absent     INTEGER NOT NULL DEFAULT 0,
            note          TEXT,
            created_at    TEXT NOT NULL,
            created_by    TEXT,
            updated_at    TEXT,
            is_deleted    INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_timesheet_entries_date ON timesheet_entries(work_date)"
    )
    # Один сотрудник — одна запись на дату.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_entries_emp_date_unique "
        "ON timesheet_entries(employee_id, work_date) WHERE is_deleted = 0"
    )

    # --- Журнал правок табеля (append-only) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS timesheet_ops (
            id         TEXT PRIMARY KEY,
            entry_id   TEXT NOT NULL REFERENCES timesheet_entries(id),
            op_type    TEXT NOT NULL,
            comment    TEXT,
            created_at TEXT NOT NULL,
            created_by TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_timesheet_ops_entry ON timesheet_ops(entry_id)")

    # --- Выплаты (append-only): расчёт и авансы ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS payroll_payments (
            id             TEXT PRIMARY KEY,
            employee_id    TEXT NOT NULL REFERENCES employees(id),
            amount_kopecks INTEGER NOT NULL,
            kind           TEXT NOT NULL DEFAULT 'settlement',
            paid_on        TEXT,
            period_start   TEXT,
            period_end     TEXT,
            comment        TEXT,
            created_at     TEXT NOT NULL,
            created_by     TEXT,
            is_deleted     INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_payroll_payments_emp ON payroll_payments(employee_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_payroll_payments_period ON payroll_payments(period_start, period_end)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS payroll_payments")
    op.execute("DROP TABLE IF EXISTS timesheet_ops")
    op.execute("DROP TABLE IF EXISTS timesheet_entries")
    op.execute("DROP TABLE IF EXISTS employee_rates")
    op.execute("DROP TABLE IF EXISTS employees")
