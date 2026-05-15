"""Счётчик auth_rl_redis_fallback_total при fail-open после ошибки Redis."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.requests import Request

import rate_limit.login_rate_limit as lrl
from rate_limit import metrics as rl_metrics


def _login_request(*, client_host: str) -> Request:
    scope = {
        "type": "http",
        "asgi": {"spec_version": "2.3", "version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "server": ("testserver", 80),
        "client": (client_host, 12345),
        "root_path": "",
        "path": "/auth/login",
        "raw_path": b"/auth/login",
        "query_string": b"",
        "headers": [],
        "state": {},
    }
    body = b'{"email":"u@example.com","password":"x"}'

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


@pytest.fixture(autouse=True)
def _reset_rl_metrics():
    rl_metrics.reset_counters_for_tests()
    yield
    rl_metrics.reset_counters_for_tests()


def test_redis_error_fail_open_increments_fallback_counter():
    assert rl_metrics.get_counter_value("auth_rl_redis_fallback_total") == 0

    script = AsyncMock(side_effect=RuntimeError("redis unavailable"))
    redis_mock = MagicMock()

    async def run():
        req = _login_request(client_host="127.0.0.1")
        with patch.object(lrl, "REDIS_URL", "redis://localhost:6379/0"):
            with patch.object(lrl, "AUTH_LOGIN_RL_REDIS_DISABLED", False):
                with patch.object(lrl, "AUTH_LOGIN_RL_FAIL_CLOSED", False):
                    with patch.object(
                        lrl,
                        "_ensure_redis",
                        new_callable=AsyncMock,
                        return_value=(redis_mock, script),
                    ):
                        return await lrl.check_login_rate_limits(req)

    resp = asyncio.run(run())

    assert resp is None
    assert rl_metrics.get_counter_value("auth_rl_redis_fallback_total") == 1
    script.assert_awaited()
