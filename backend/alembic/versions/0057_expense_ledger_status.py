"""Единый реестр расходов: тип (kind), статус оплаты, origin, период + тип оплаты труда.

Расширяет material_expenses до единого реестра расходов «на выход»:
- kind            — тип/источник: manual | logistics | rent | salary
- payment_status  — жизненный цикл оплаты: awaiting | paid | cancelled
- paid_on         — дата фактической оплаты (для paid)
- source_kind/id  — обратная ссылка на источник (рейс / сотрудник) + защита от дублей
- period_start/end — период (аренда — месяц, ЗП — расчётная неделя)

Карточка сотрудника получает тип оплаты труда:
- comp_type             — hourly | fixed
- fixed_salary_kopecks  — оклад для fixed (копейки)

Бэкафилл: существующие расходы → manual/paid (paid_on = spent_on); сотрудники → hourly.
Сидятся системные категории (Логистика / Аренда склада / Зарплата).

Revision ID: 0057
Revises: 0056
Create Date: 2026-06-17
"""

from __future__ import annotations

from uuid import uuid4

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    from config import (
        EXPENSE_KIND_MANUAL,
        EXPENSE_PAYMENT_PAID,
        EXPENSE_SYSTEM_CATEGORY_SEED,
    )

    # --- material_expenses → единый реестр ---
    op.execute(
        "ALTER TABLE material_expenses "
        f"ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT '{EXPENSE_KIND_MANUAL}'"
    )
    op.execute(
        "ALTER TABLE material_expenses "
        f"ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT '{EXPENSE_PAYMENT_PAID}'"
    )
    op.execute("ALTER TABLE material_expenses ADD COLUMN IF NOT EXISTS paid_on TEXT")
    op.execute("ALTER TABLE material_expenses ADD COLUMN IF NOT EXISTS source_kind TEXT")
    op.execute("ALTER TABLE material_expenses ADD COLUMN IF NOT EXISTS source_id TEXT")
    op.execute("ALTER TABLE material_expenses ADD COLUMN IF NOT EXISTS period_start TEXT")
    op.execute("ALTER TABLE material_expenses ADD COLUMN IF NOT EXISTS period_end TEXT")

    # Бэкафилл: всё, что было заведено до реестра — это оплаченные хозрасходы.
    op.execute(
        "UPDATE material_expenses SET paid_on = spent_on "
        f"WHERE payment_status = '{EXPENSE_PAYMENT_PAID}' AND paid_on IS NULL"
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_material_expenses_kind ON material_expenses(kind)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_material_expenses_pay_status "
        "ON material_expenses(payment_status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_material_expenses_source "
        "ON material_expenses(source_kind, source_id)"
    )

    # --- Карточка сотрудника: тип оплаты труда ---
    op.execute(
        "ALTER TABLE employees ADD COLUMN IF NOT EXISTS comp_type TEXT NOT NULL DEFAULT 'hourly'"
    )
    op.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS fixed_salary_kopecks INTEGER")

    # --- Сид системных категорий (если ещё нет с таким именем) ---
    for i, name in enumerate(EXPENSE_SYSTEM_CATEGORY_SEED):
        safe = name.replace("'", "''")
        op.execute(
            "INSERT INTO expense_categories (id, name, sort_order, created_at) "
            "SELECT '%s', '%s', %d, NOW()::text "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM expense_categories "
            "  WHERE LOWER(name) = LOWER('%s') AND COALESCE(is_deleted, 0) = 0"
            ")" % (uuid4(), safe, 100 + i, safe)
        )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_material_expenses_source")
    op.execute("DROP INDEX IF EXISTS idx_material_expenses_pay_status")
    op.execute("DROP INDEX IF EXISTS idx_material_expenses_kind")
    for col in ("period_end", "period_start", "source_id", "source_kind", "paid_on",
                "payment_status", "kind"):
        op.execute(f"ALTER TABLE material_expenses DROP COLUMN IF EXISTS {col}")
    op.execute("ALTER TABLE employees DROP COLUMN IF EXISTS fixed_salary_kopecks")
    op.execute("ALTER TABLE employees DROP COLUMN IF EXISTS comp_type")
