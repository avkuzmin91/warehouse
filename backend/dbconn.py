from __future__ import annotations

import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


DATABASE_URL = os.environ["DATABASE_URL"]

_pool: ConnectionPool | None = None


def init_pool() -> None:
    """Инициализировать пул соединений. Вызывается один раз при старте приложения."""
    global _pool
    _pool = ConnectionPool(
        DATABASE_URL,
        min_size=2,
        max_size=10,
        kwargs={"row_factory": dict_row},
        open=True,
    )


def close_pool() -> None:
    """Закрыть пул при остановке приложения."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def escape_like(raw: str) -> str:
    """Экранирует спецсимволы LIKE (\\, %, _), чтобы пользовательский ввод искался буквально.

    В PostgreSQL escape-символ LIKE по умолчанию — backslash, поэтому ESCAPE-клауза не нужна.
    """
    return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def like_substring_param(raw: str) -> str:
    """Параметр подстрочного поиска: %...% вокруг экранированного пользовательского ввода."""
    return f"%{escape_like(str(raw).strip())}%"


class _ConnAdapter:
    """Оборачивает psycopg-соединение, заменяя ? на %s в запросах."""

    def __init__(self, conn: psycopg.Connection):
        self._conn = conn

    def execute(self, query: str, params=None):
        return self._conn.execute(query.replace("?", "%s"), params)

    def executemany(self, query: str, params_seq):
        return self._conn.executemany(query.replace("?", "%s"), params_seq)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, *args):
        return self._conn.__exit__(*args)


@contextmanager
def get_connection():
    """Получить соединение из пула. Использовать как контекстный менеджер: `with get_connection() as conn:`."""
    if _pool is None:
        # Fallback для тестов и скриптов, запускаемых без init_pool()
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        adapter = _ConnAdapter(conn)
        try:
            yield adapter
        finally:
            conn.close()
        return

    with _pool.connection() as conn:
        yield _ConnAdapter(conn)
