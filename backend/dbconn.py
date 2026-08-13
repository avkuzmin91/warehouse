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


def ci_like_substring_param(raw: str) -> str:
    """%...% для поиска через `fold_ci(col) LIKE ?`: экранирование + lower + ё→е.

    Зеркалит SQL-функцию fold_ci (см. 0001_baseline). Обе стороны сравнения
    должны быть свёрнуты одинаково, иначе совпадений не будет.
    """
    return f"%{escape_like(str(raw).strip().lower().replace('ё', 'е'))}%"


def barcode_variant_exists_sql(product_col: str, color_col: str, size_col: str) -> str:
    """EXISTS-фрагмент поиска позиции по штрих-коду товара; ждёт один параметр —
    %...%-фрагмент кода (`like_substring_param`).

    Совпадение по вхождению (можно искать по обрывку кода) и с точностью до
    варианта: ШК принадлежит цвето-размеру, поэтому сужает выдачу до конкретной
    позиции, а не до всех вариантов товара.
    """
    return (
        "EXISTS (SELECT 1 FROM product_barcodes pb"
        " JOIN product_variants pv ON pv.id = pb.variant_id"
        " WHERE pb.barcode LIKE ? AND COALESCE(pb.is_deleted, 0) = 0"
        f" AND pb.product_id = {product_col}"
        f" AND pv.color_id IS NOT DISTINCT FROM {color_col}"
        f" AND pv.size_id IS NOT DISTINCT FROM {size_col})"
    )


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
