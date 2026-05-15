"""
Метрики rate limit. При наличии prometheus_client — Counter в registry;
иначе потокобезопасный счётчик в памяти (для тестов и простого мониторинга).
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any

_lock = threading.Lock()
_in_memory: dict[str, int] = defaultdict(int)

_PROM_AUTH_RL_REDIS_FALLBACK: Any = None
_PROM_LOAD_ATTEMPTED = False


def _prometheus_fallback_counter() -> Any:
    global _PROM_AUTH_RL_REDIS_FALLBACK, _PROM_LOAD_ATTEMPTED
    if _PROM_LOAD_ATTEMPTED:
        return _PROM_AUTH_RL_REDIS_FALLBACK
    _PROM_LOAD_ATTEMPTED = True
    try:
        from prometheus_client import Counter

        _PROM_AUTH_RL_REDIS_FALLBACK = Counter(
            "auth_rl_redis_fallback_total",
            "Login RL: Redis error, использован in-memory fallback (fail-open)",
        )
    except ImportError:
        _PROM_AUTH_RL_REDIS_FALLBACK = None
    return _PROM_AUTH_RL_REDIS_FALLBACK


def increment(name: str) -> None:
    """Универсальный инкремент (сейчас используется auth_rl_redis_fallback_total)."""
    with _lock:
        _in_memory[name] += 1
    if name == "auth_rl_redis_fallback_total":
        pc = _prometheus_fallback_counter()
        if pc is not None:
            pc.inc()


def get_counter_value(name: str) -> int:
    """Для тестов: значение in-memory счётчика (всегда синхронно с инкрементами)."""
    with _lock:
        return int(_in_memory.get(name, 0))


def reset_counters_for_tests() -> None:
    """Только для pytest."""
    with _lock:
        _in_memory.clear()
