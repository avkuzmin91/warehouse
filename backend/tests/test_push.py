"""Пуш-уведомления: регистрация FCM-токенов (/push/*) и дифф новых задач.

FCM в тестах не трогаем: _ensure_fcm/_send_push подменяются, проверяется логика
диффа (новая задача → пуш, повторный тик — тишина, исчезновение и повторное
появление задачи → пуш снова).
"""

from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.push import service as push_service


@pytest.fixture
def db_user():
    """Реальная строка в users — push_tokens ссылается на неё по FK."""
    uid = str(uuid.uuid4())
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,NOW())",
            (uid, f"push-{uid[:8]}@test.com", "x", "warehouse_manager"),
        )
        conn.commit()
    yield uid
    with get_connection() as conn:
        conn.execute("DELETE FROM push_tokens WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()


def test_save_push_token_upsert_and_remove(db_user):
    token = f"tok-{uuid.uuid4()}"
    with get_connection() as conn:
        push_service.save_push_token(conn, user_id=db_user, token=token, platform="android")
        push_service.save_push_token(conn, user_id=db_user, token=token, platform="android")
        rows = conn.execute("SELECT id FROM push_tokens WHERE token = ?", (token,)).fetchall()
        assert len(rows) == 1
        push_service.remove_push_token(conn, token=token)
        assert conn.execute("SELECT id FROM push_tokens WHERE token = ?", (token,)).fetchone() is None
        conn.commit()


def test_register_unregister_endpoints(db_user):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": db_user, "email": "push@test.com", "role": "warehouse_manager", "client_id": None,
    }
    token = f"tok-ep-{uuid.uuid4()}"
    try:
        with TestClient(app) as c:
            assert c.post("/push/register", json={"token": token, "platform": "android"}).status_code == 200
            with get_connection() as conn:
                row = conn.execute("SELECT user_id FROM push_tokens WHERE token = ?", (token,)).fetchone()
            assert row is not None and str(row["user_id"]) == db_user
            assert c.post("/push/unregister", json={"token": token}).status_code == 200
    finally:
        app.dependency_overrides.clear()
    with get_connection() as conn:
        assert conn.execute("SELECT id FROM push_tokens WHERE token = ?", (token,)).fetchone() is None


def test_notify_new_tasks_diff(monkeypatch, db_user):
    doc_id = str(uuid.uuid4())
    task_key = f"dispatch_prepare:{doc_id}"
    task = {
        "kind": "dispatch_prepare", "title": "Подготовить отгрузку DSP-T1",
        "doc_type": "dispatch", "doc_id": doc_id, "doc_number": "DSP-T1",
        "status": "preparing", "role": "warehouse_manager", "since": None,
    }
    tasks: list[dict] = [task]
    monkeypatch.setattr(push_service, "list_my_tasks", lambda conn, *, user: list(tasks))
    monkeypatch.setattr(push_service, "_ensure_fcm", lambda: True)
    sent: list[dict] = []

    def fake_send(tokens, *, title, body, data):
        sent.append({"tokens": list(tokens), "title": title, "body": body, "data": data})
        return []

    monkeypatch.setattr(push_service, "_send_push", fake_send)

    token = f"tok-{doc_id}"
    with get_connection() as conn:
        push_service.save_push_token(conn, user_id=db_user, token=token, platform="android")
        conn.commit()

    try:
        # новая задача → пуш на токен кладовщика
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
        assert len(sent) == 1
        assert token in sent[0]["tokens"]
        assert sent[0]["body"] == task["title"]
        assert sent[0]["data"]["doc_id"] == doc_id

        # повторный тик — задача уже отправлена, тишина
        sent.clear()
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
        assert sent == []

        # задача исчезла → ключ снят из push_notified_tasks
        tasks.clear()
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
            row = conn.execute(
                "SELECT task_key FROM push_notified_tasks WHERE task_key = ?", (task_key,)
            ).fetchone()
        assert row is None

        # повторное появление (возврат документа в статус) → пуш снова
        tasks.append(task)
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
        assert len(sent) == 1
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM push_notified_tasks WHERE task_key = ?", (task_key,))
            conn.commit()


def test_notify_storm_recorded_without_send(monkeypatch, db_user):
    """Первичное заполнение / массовый импорт: аномально много новых задач за тик —
    записываются в push_notified_tasks, но пуши не шлются."""
    from config import PUSH_STORM_THRESHOLD

    prefix = f"storm-{uuid.uuid4().hex[:8]}"
    tasks = [
        {
            "kind": "dispatch_prepare", "title": f"Подготовить отгрузку DSP-S{i}",
            "doc_type": "dispatch", "doc_id": f"{prefix}-{i}", "doc_number": f"DSP-S{i}",
            "status": "preparing", "role": "warehouse_manager", "since": None,
        }
        for i in range(PUSH_STORM_THRESHOLD + 5)
    ]
    monkeypatch.setattr(push_service, "list_my_tasks", lambda conn, *, user: list(tasks))
    monkeypatch.setattr(push_service, "_ensure_fcm", lambda: True)
    sent: list[dict] = []
    monkeypatch.setattr(push_service, "_send_push", lambda *a, **kw: sent.append(kw) or [])

    with get_connection() as conn:
        push_service.save_push_token(conn, user_id=db_user, token=f"tok-{prefix}", platform="android")
        conn.commit()

    try:
        with get_connection() as conn:
            push_service.notify_new_tasks(conn)
            recorded = conn.execute(
                "SELECT COUNT(*) AS n FROM push_notified_tasks WHERE task_key LIKE ?",
                (f"dispatch_prepare:{prefix}-%",),
            ).fetchone()
        assert sent == []
        assert int(recorded["n"]) == len(tasks)
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM push_notified_tasks WHERE task_key LIKE ?", (f"dispatch_prepare:{prefix}-%",))
            conn.commit()
