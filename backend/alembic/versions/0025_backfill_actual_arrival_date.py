"""Backfill actual_arrival_date from arrival_date for completed receipts.

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-04

Разовая операция при релизе: у завершённых поступлений (done / on_review) товар
уже физически прибыл, но фактическая дата прибытия исторически не заполнялась.
Копируем плановую дату в фактическую там, где факт ещё пуст. Идемпотентно:
обновляются только строки с actual_arrival_date IS NULL.
"""

from __future__ import annotations

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        UPDATE receipt_docs
        SET actual_arrival_date = arrival_date
        WHERE status IN ('done', 'on_review')
          AND actual_arrival_date IS NULL
          AND arrival_date IS NOT NULL
        """
    )


def downgrade() -> None:
    # Разовый backfill необратим: исходное «факт = NULL» не восстановить
    # отличая его от дат, проставленных пользователем вручную.
    pass
