"""Trusted proxy: X-Forwarded-For только при доверенном peer."""

import ipaddress

import pytest
from starlette.requests import Request

from rate_limit.client_ip import (
    clear_trusted_proxies_cache_for_tests,
    client_ip_from_request,
    parse_trusted_proxies,
    resolve_client_ip,
)


def _make_request(*, client_host: str, xff: str | None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode("utf-8")))
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
        "headers": headers,
        "state": {},
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


def test_trusted_peer_uses_first_valid_xff_ip():
    nets, hosts = parse_trusted_proxies("127.0.0.1")
    ip = resolve_client_ip(
        "127.0.0.1",
        "203.0.113.5, 10.0.0.1",
        trusted_override=(nets, hosts),
    )
    assert ip == "203.0.113.5"


def test_untrusted_peer_ignores_xff():
    nets, hosts = parse_trusted_proxies("127.0.0.1")
    ip = resolve_client_ip(
        "192.0.2.99",
        "203.0.113.5",
        trusted_override=(nets, hosts),
    )
    assert ip == "192.0.2.99"


def test_trusted_cidr():
    nets, hosts = parse_trusted_proxies("172.18.0.0/16")
    ip = resolve_client_ip(
        "172.18.0.5",
        "198.51.100.2",
        trusted_override=(nets, hosts),
    )
    assert ip == "198.51.100.2"


def test_trusted_hostname_peer():
    nets, hosts = parse_trusted_proxies("nginx")
    ip = resolve_client_ip(
        "nginx",
        "198.51.100.10",
        trusted_override=(nets, hosts),
    )
    assert ip == "198.51.100.10"


def test_client_ip_from_request_respects_env_trusted(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "127.0.0.1")
    clear_trusted_proxies_cache_for_tests()
    try:
        req = _make_request(client_host="127.0.0.1", xff="198.51.100.77")
        assert client_ip_from_request(req) == "198.51.100.77"
    finally:
        monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
        clear_trusted_proxies_cache_for_tests()


def test_client_ip_from_request_untrusted_ignores_xff(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "127.0.0.1")
    clear_trusted_proxies_cache_for_tests()
    try:
        req = _make_request(client_host="10.0.0.1", xff="198.51.100.88")
        assert client_ip_from_request(req) == "10.0.0.1"
    finally:
        monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
        clear_trusted_proxies_cache_for_tests()


def test_empty_trusted_never_uses_xff():
    override = parse_trusted_proxies("")
    assert override == ([], frozenset())
    ip = resolve_client_ip("10.0.0.1", "198.51.100.1", trusted_override=override)
    assert ip == "10.0.0.1"


def test_parse_trusted_proxies_mixed():
    nets, hosts = parse_trusted_proxies("127.0.0.1,nginx,172.18.0.0/16")
    assert hosts == frozenset({"nginx"})
    assert any(ipaddress.ip_address("127.0.0.1") in n for n in nets)
    assert any(ipaddress.ip_address("172.18.0.5") in n for n in nets)
