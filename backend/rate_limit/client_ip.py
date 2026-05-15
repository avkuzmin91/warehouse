"""
Определение IP клиента с учётом reverse proxy.

X-Forwarded-For учитывается только если непосредственный peer (request.client.host)
входит в TRUSTED_PROXIES (IP, CIDR или имя хоста), иначе используется peer — защита от подделки XFF.
"""

from __future__ import annotations

import ipaddress
import os

from starlette.requests import Request

_TRUSTED_RAW: str | None = None
_TRUSTED_PARSED: tuple[list[ipaddress._BaseNetwork], frozenset[str]] | None = None


def clear_trusted_proxies_cache_for_tests() -> None:
    """Сброс кэша после monkeypatch env (только тесты)."""
    global _TRUSTED_RAW, _TRUSTED_PARSED
    _TRUSTED_RAW = None
    _TRUSTED_PARSED = None


def parse_trusted_proxies(raw: str) -> tuple[list[ipaddress._BaseNetwork], frozenset[str]]:
    """
    TRUSTED_PROXIES: запись через запятую.
    - IPv4/IPv6 с CIDR: 172.18.0.0/16
    - одиночный IP: 127.0.0.1 → /32 или /128
    - иначе трактуется как имя хоста peer (например nginx в overlay).
    """
    networks: list[ipaddress._BaseNetwork] = []
    hostnames: set[str] = set()
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if "/" in token:
            try:
                networks.append(ipaddress.ip_network(token, strict=False))
            except ValueError:
                continue
            continue
        try:
            addr = ipaddress.ip_address(token)
            if isinstance(addr, ipaddress.IPv4Address):
                networks.append(ipaddress.ip_network(f"{addr}/32", strict=False))
            else:
                networks.append(ipaddress.ip_network(f"{addr}/128", strict=False))
        except ValueError:
            hostnames.add(token.lower())
    return networks, frozenset(hostnames)


def _trusted_entries() -> tuple[list[ipaddress._BaseNetwork], frozenset[str]]:
    global _TRUSTED_RAW, _TRUSTED_PARSED
    raw = (os.environ.get("TRUSTED_PROXIES") or "").strip()
    if raw == _TRUSTED_RAW and _TRUSTED_PARSED is not None:
        return _TRUSTED_PARSED
    _TRUSTED_RAW = raw
    if not raw:
        _TRUSTED_PARSED = ([], frozenset())
    else:
        _TRUSTED_PARSED = parse_trusted_proxies(raw)
    return _TRUSTED_PARSED


def _peer_trusted(peer_host: str, networks: list[ipaddress._BaseNetwork], hostnames: frozenset[str]) -> bool:
    ph = peer_host.strip().lower()
    if ph in hostnames:
        return True
    try:
        ip = ipaddress.ip_address(ph)
    except ValueError:
        return False
    for net in networks:
        if ip in net:
            return True
    return False


def _first_valid_ip_from_xff(xff: str) -> str | None:
    for segment in xff.split(","):
        s = segment.strip()
        if not s:
            continue
        # Убрать zone id у IPv6
        if "%" in s:
            s = s.split("%", 1)[0]
        try:
            return str(ipaddress.ip_address(s))
        except ValueError:
            continue
    return None


def resolve_client_ip(
    peer_host: str | None,
    x_forwarded_for: str | None,
    *,
    trusted_override: tuple[list[ipaddress._BaseNetwork], frozenset[str]] | None = None,
) -> str:
    """
    peer_host — request.client.host; x_forwarded_for — сырое значение заголовка.
    trusted_override — для тестов; иначе читается TRUSTED_PROXIES из env.
    """
    networks, hostnames = trusted_override if trusted_override is not None else _trusted_entries()
    peer = (peer_host or "").strip()
    if not peer:
        return "unknown"

    if networks or hostnames:
        if _peer_trusted(peer, networks, hostnames) and x_forwarded_for:
            xff = x_forwarded_for.strip()
            if xff:
                first = _first_valid_ip_from_xff(xff)
                if first:
                    return first
        return peer

    # Нет TRUSTED_PROXIES: не доверяем XFF (безопасный дефолт)
    return peer


def client_ip_from_request(request: Request) -> str:
    """Публичный API: peer из соединения + опционально X-Forwarded-For при доверенном proxy."""
    peer = None
    if request.client and request.client.host:
        peer = str(request.client.host)
    h = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    xff = h.strip() if h else None
    return resolve_client_ip(peer, xff)
