"""Convert shipment priority ranks (1-999) to levels: 1 = urgent, 2 = high.

Revision ID: 0044
Revises: 0043
Create Date: 2026-06-11
"""

from __future__ import annotations

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        "UPDATE shipment_docs SET priority_rank = NULL "
        "WHERE priority_rank IS NOT NULL AND status IN ('shipped', 'cancelled')"
    )
    op.execute(
        "UPDATE shipment_docs SET priority_rank = CASE WHEN priority_rank <= 3 THEN 1 ELSE 2 END "
        "WHERE priority_rank IS NOT NULL"
    )


def downgrade() -> None:
    # Обратное преобразование уровней в ранги невозможно — данные потеряны.
    pass
