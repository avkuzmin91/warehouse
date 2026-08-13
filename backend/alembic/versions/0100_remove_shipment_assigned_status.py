"""Remove shipment status assigned (этап приёмки задачи начальником склада).

Revision ID: 0100
Revises: 0099
Create Date: 2026-08-13

Этап «Ожидает принятия» (assigned) удалён: менеджер ставит задачу сразу в план
склада (draft → packing). Зависшие документы переводятся в packing; в журнал
пишется запись перехода, чтобы у шага «В плане» осталась отметка времени в
статус-лайне. Откат данных невозможен (мигрированные документы неотличимы).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    bind = op.get_bind()
    now = datetime.now(UTC).isoformat()
    rows = bind.exec_driver_sql(
        "SELECT id FROM shipment_docs WHERE status = 'assigned'"
    ).fetchall()
    for (doc_id,) in rows:
        bind.exec_driver_sql(
            "INSERT INTO shipment_ops (id, doc_id, op_type, comment, created_at) "
            "VALUES (%s, %s, 'advance', 'assigned → packing', %s)",
            (str(uuid4()), doc_id, now),
        )
    op.execute("UPDATE shipment_docs SET status = 'packing' WHERE status = 'assigned'")


def downgrade() -> None:
    pass
