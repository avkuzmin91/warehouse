"""Корзина «Ждёт размещения» (boxed) слита с «Упаковано» (packed), статус «Собрано»
(collected) — с «Упакован» (packed).

Задача «Упаковка с ТСД» даёт тот же результат, что задача упаковки: собранное в
короба упаковано и доступно отгрузке сразу, отдельная корзина вне пулов доступности
больше не нужна. Журнал append-only, поэтому исторические движения переписываются на
месте: to/from_op 'boxed' → 'packed'; развозка коробов раньше шла boxed → storage —
такие записи становятся packed → storage и на новую формулу «развезено» (packed →
ready) не ложатся, что для задач до этой ревизии допустимо (на проде их нет).

Revision ID: 0110
Revises: 0109
Create Date: 2026-09-05
"""

from __future__ import annotations

from alembic import op

revision = "0110"
down_revision = "0109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE zone_relocations SET to_op = 'packed' WHERE to_op = 'boxed'")
    op.execute("UPDATE zone_relocations SET from_op = 'packed' WHERE from_op = 'boxed'")
    op.execute("UPDATE shipment_docs SET status = 'packed' WHERE status = 'collected'")


def downgrade() -> None:
    # После слияния корзин записи boxed и packed неразличимы — обратного пути нет.
    pass
