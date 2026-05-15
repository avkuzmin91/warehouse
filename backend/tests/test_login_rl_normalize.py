"""Разбор email для login rate limit (без Redis)."""

from rate_limit.login_rate_limit import (
    _normalize_login_email,
    _parse_email_from_json_body,
    login_email_redis_key_suffix,
)


def test_normalize_email():
    assert _normalize_login_email("  User@Example.COM  ") == "user@example.com"
    assert _normalize_login_email("") is None
    assert _normalize_login_email(None) is None


def test_parse_email_from_body():
    assert _parse_email_from_json_body(b'{"email":" A@B.C ","password":"x"}') == "a@b.c"
    assert _parse_email_from_json_body(b"not json") is None
    assert _parse_email_from_json_body(b"[]") is None


def test_login_email_hash_same_after_normalize():
    a = _normalize_login_email("USER@test.com")
    b = _normalize_login_email(" user@test.com ")
    assert a == b == "user@test.com"
    assert login_email_redis_key_suffix(a) == login_email_redis_key_suffix(b)
