"""Подключение к PostgreSQL (DATABASE_URL). В SQL используются плейсхолдеры ``?``; адаптер подставляет ``%s`` для psycopg."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Sequence

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

_backend_dir = Path(__file__).resolve().parent
_load_env = _backend_dir / ".env"
if _load_env.is_file():
    load_dotenv(_load_env)

# В проде задайте в окружении, например:
# postgresql://user:pass@localhost:5432/dbname
# Локально можно положить backend/.env (см. .env.example).
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:5432/app",
)


class _ConnAdapter:
    __slots__ = ("_conn",)

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    @staticmethod
    def _adapt(q: str) -> str:
        return q.replace("?", "%s")

    def execute(self, query: str, params: Sequence[Any] | None = None):
        q = self._adapt(query)
        if params is None:
            return self._conn.execute(q)
        return self._conn.execute(q, params)

    def executemany(self, query: str, params_seq: Sequence[Sequence[Any]]) -> None:
        q = self._adapt(query)
        self._conn.executemany(q, params_seq)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def __enter__(self) -> _ConnAdapter:
        self._conn.__enter__()
        return self

    def __exit__(self, *args: object) -> None:
        return self._conn.__exit__(*args)


def get_connection() -> _ConnAdapter:
    return _ConnAdapter(psycopg.connect(DATABASE_URL, row_factory=dict_row))