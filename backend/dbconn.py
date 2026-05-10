from __future__ import annotations

import os
import psycopg
from psycopg.rows import dict_row


# ВАЖНО: только env, без fallback на localhost
DATABASE_URL = os.environ["DATABASE_URL"]


class _ConnAdapter:
    def __init__(self, conn: psycopg.Connection):
        self._conn = conn

    def execute(self, query, params=None):
        q = query.replace("?", "%s")
        return self._conn.execute(q, params)

    def executemany(self, query, params_seq):
        q = query.replace("?", "%s")
        return self._conn.executemany(q, params_seq)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, *args):
        return self._conn.__exit__(*args)


def get_connection():
    return _ConnAdapter(
        psycopg.connect(DATABASE_URL, row_factory=dict_row)
    )
