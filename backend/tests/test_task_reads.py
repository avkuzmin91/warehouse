"""Прочитанные задачи: отметка per-user, аннотация списка, чистка исчезнувших.

Задачи вычисляемые (ключ kind:doc_id), отметка живёт в task_reads. Проверяется:
повторная отметка идемпотентна, is_read проставляется только своему пользователю,
исчезновение задачи из очереди снимает отметку (тик notify_new_tasks).
"""

from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from dbconn import get_connection
from modules.push import service as push_service
from modules.tasks.service import annotate_task_reads, mark_task_read


@pytest.fixture
def db_user():
    uid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,NOW())",
            (uid, f"reads-{uid[:8]}@test.com", "x", "warehouse_manager"),
        )
        conn.commit()
    yield uid
    with get_connection() as conn:
        conn.execute("DELETE FROM task_reads WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()


def test_mark_task_read_idempotent_and_annotate(db_user):
    doc_id = str(uuid.uuid4())
    tasks = [
        {"kind": "dispatch_prepare", "doc_id": doc_id},
        {"kind": "trip_arrival", "doc_id": str(uuid.uuid4())},
    ]
    with get_connection() as conn:
        mark_task_read(conn, user_id=db_user, kind="dispatch_prepare", doc_id=doc_id)
        mark_task_read(conn, user_id=db_user, kind="dispatch_prepare", doc_id=doc_id)
        rows = conn.execute("SELECT read_at FROM task_reads WHERE user_id = ?", (db_user,)).fetchall()
        assert len(rows) == 1

        annotate_task_reads(conn, tasks, user_id=db_user)
        assert tasks[0]["is_read"] is True
        assert tasks[1]["is_read"] is False

        # чужая отметка не видна другому пользователю
        annotate_task_reads(conn, tasks, user_id=str(uuid.uuid4()))
        assert tasks[0]["is_read"] is False
        conn.commit()


def test_read_mark_removed_when_task_disappears(monkeypatch, db_user):
    doc_id = str(uuid.uuid4())
    task_key = f"dispatch_prepare:{doc_id}"
    task = {
        "kind": "dispatch_prepare", "title": "Подготовить отгрузку DSP-T2",
        "doc_type": "dispatch", "doc_id": doc_id, "doc_number": "DSP-T2",
        "status": "preparing", "role": "warehouse_manager", "since": None,
    }
    tasks: list[dict] = [task]
    monkeypatch.setattr(push_service, "list_my_tasks", lambda conn, *, user: list(tasks))
    monkeypatch.setattr(push_service, "_ensure_fcm", lambda: False)

    try:
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
            mark_task_read(conn, user_id=db_user, kind="dispatch_prepare", doc_id=doc_id)
            conn.commit()

        # задача активна — отметка живёт
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
            assert conn.execute(
                "SELECT 1 FROM task_reads WHERE task_key = ?", (task_key,)
            ).fetchone() is not None

        # задача исчезла — отметка снимается вместе с ключом пуша
        tasks.clear()
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
            assert conn.execute(
                "SELECT 1 FROM task_reads WHERE task_key = ?", (task_key,)
            ).fetchone() is None
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM push_notified_tasks WHERE task_key = ?", (task_key,))
            conn.execute("DELETE FROM task_reads WHERE task_key = ?", (task_key,))
            conn.commit()
