"""Прочитанные задачи «Мои задачи»: per-user отметка о прочтении.

task_reads — кто из сотрудников какую задачу уже видел. Задачи вычисляемые
(ключ = kind:doc_id, отдельного хранилища нет), поэтому отметка живёт, пока
задача активна: фоновый цикл пушей удаляет ключи исчезнувших задач — возврат
документа в статус снова делает задачу непрочитанной для всех.

Revision ID: 0083
Revises: 0082
Create Date: 2026-07-04
"""

from __future__ import annotations

revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS task_reads (
            user_id  TEXT NOT NULL REFERENCES users(id),
            task_key TEXT NOT NULL,
            read_at  TEXT NOT NULL,
            PRIMARY KEY (user_id, task_key)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_task_reads_key ON task_reads(task_key)")


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS task_reads")
