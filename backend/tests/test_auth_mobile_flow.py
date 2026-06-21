"""Мобильный режим auth: refresh-токен в теле под X-Client: mobile.

Браузер продолжает работать через HttpOnly cookie wms_rt; натив (Capacitor) не
имеет надёжной cookie и шлёт/получает refresh в теле. См. docs/mobile-plan.md §6.1.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import app
from dbconn import get_connection
from modules.auth.service import hash_password


@pytest.fixture
def mobile_user():
    uid = str(uuid.uuid4())
    email = f"mobile-{uid[:8]}@test.com"
    password = "mobile-pass-123"
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) "
            "VALUES (?, ?, ?, 'warehouse_manager', NOW())",
            (uid, email, hash_password(password)),
        )
        conn.commit()
    yield {"id": uid, "email": email, "password": password}
    with get_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM auth_refresh_superseded WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()


def _login(client: TestClient, user: dict, *, mobile: bool):
    headers = {"X-Client": "mobile"} if mobile else {}
    return client.post(
        "/auth/login",
        json={"email": user["email"], "password": user["password"]},
        headers=headers,
    )


def test_mobile_login_returns_refresh_in_body(mobile_user):
    with TestClient(app) as client:
        res = _login(client, mobile_user, mobile=True)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["access_token"]
    assert data["refresh_token"]


def test_browser_login_keeps_refresh_out_of_body(mobile_user):
    with TestClient(app) as client:
        res = _login(client, mobile_user, mobile=False)
        assert res.status_code == 200, res.text
        assert res.json().get("refresh_token") is None
        assert client.cookies.get("wms_rt")


def test_mobile_refresh_by_body_rotates_and_blocks_replay(mobile_user):
    with TestClient(app) as client:
        rt = _login(client, mobile_user, mobile=True).json()["refresh_token"]

        client.cookies.clear()  # имитируем натив: cookie отсутствует
        res = client.post("/auth/refresh", json={"refresh_token": rt}, headers={"X-Client": "mobile"})
        assert res.status_code == 200, res.text
        new_rt = res.json()["refresh_token"]
        assert new_rt and new_rt != rt

        client.cookies.clear()
        replay = client.post("/auth/refresh", json={"refresh_token": rt}, headers={"X-Client": "mobile"})
        assert replay.status_code == 401

        client.cookies.clear()
        ok = client.post("/auth/refresh", json={"refresh_token": new_rt}, headers={"X-Client": "mobile"})
        assert ok.status_code == 200, ok.text


def test_mobile_logout_revokes_body_refresh(mobile_user):
    with TestClient(app) as client:
        login = _login(client, mobile_user, mobile=True).json()
        rt, access = login["refresh_token"], login["access_token"]

        client.cookies.clear()
        out = client.post(
            "/auth/logout",
            json={"refresh_token": rt},
            headers={"Authorization": f"Bearer {access}", "X-Client": "mobile"},
        )
        assert out.status_code == 204

        client.cookies.clear()
        res = client.post("/auth/refresh", json={"refresh_token": rt}, headers={"X-Client": "mobile"})
        assert res.status_code == 401


def test_browser_refresh_without_body_still_works(mobile_user):
    """Регрессия: пустое тело + Content-Type JSON у браузерного refresh не должно падать в 422.

    Cookie ставится с path=/api, а TestClient бьёт по /auth/refresh — поэтому
    передаём refresh-cookie запросу явно (в браузере путь совпадает: /api/auth/refresh).
    """
    with TestClient(app) as client:
        _login(client, mobile_user, mobile=False)
        rt_cookie = client.cookies.get("wms_rt")
        assert rt_cookie
        client.cookies.set("wms_rt", rt_cookie, path="/")
        res = client.post("/auth/refresh", headers={"Content-Type": "application/json"})
        assert res.status_code == 200, res.text
        assert res.json().get("refresh_token") is None
