"""Пуш-уведомления о новых задачах: FCM-токены устройств + дедуп отправленного.

push_tokens — устройства с установленным мобильным приложением (токен уникален,
при перелогине на том же устройстве переезжает на нового пользователя).
push_notified_tasks — активные задачи, о которых пуш уже отправлен; задачи
вычисляемые (нет события «создана»), поэтому фоновый цикл диффует текущую
очередь против этой таблицы. Исчезнувшая задача удаляется — повторное появление
(возврат документа в статус) даёт новый пуш.

Revision ID: 0082
Revises: 0081
Create Date: 2026-07-04
"""

from __future__ import annotations

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
        CREATE TABLE IF NOT EXISTS push_tokens (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id),
            token      TEXT NOT NULL,
            platform   TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS push_notified_tasks (
            task_key    TEXT PRIMARY KEY,
            notified_at TEXT NOT NULL
        )
    """)


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS push_notified_tasks")
    op.execute("DROP TABLE IF EXISTS push_tokens")
