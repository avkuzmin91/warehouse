"""Add expression index for effective arrival date sort on receipt_docs.

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-04
"""

from __future__ import annotations

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    # Список поступлений сортируется по фактической дате прибытия, а при её
    # отсутствии — по плановой. Выражённый индекс позволяет планировщику
    # обслуживать ORDER BY COALESCE(actual_arrival_date, arrival_date) DESC + LIMIT.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_receipt_docs_arrival_effective "
        "ON receipt_docs (COALESCE(actual_arrival_date, arrival_date) DESC)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP INDEX IF EXISTS idx_receipt_docs_arrival_effective")
