"""Общие мелкие хелперы backend-модулей (время, номера документов, даты).

Без FastAPI-зависимостей, кроме HTTPException (как в service-слое).
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException


def now_iso() -> str:
    """Текущий момент UTC строкой ISO 8601 — канонический формат created_at/updated_at."""
    return datetime.now(UTC).isoformat()


def next_doc_number(connection, *, table: str, prefix: str, width: int) -> str:
    """Следующий номер документа вида `{prefix}NNNN` по таблице `table`.

    MAX подстроки вместо COUNT, чтобы дырки в нумерации не давали дубликатов;
    UNIQUE constraint на doc_number гарантирует атомарность.
    `table`/`prefix` приходят только из кода (константы модулей), не из запроса.
    """
    start = len(prefix) + 1
    row = connection.execute(
        f"""
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, {start}) AS INTEGER)), 0) AS max_n
        FROM {table}
        WHERE doc_number LIKE '{prefix}%' AND SUBSTR(doc_number, {start}) ~ '^[0-9]+$'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"{prefix}{n:0{width}d}"


# Разумные границы бизнес-дат документов: раньше 2020 года склад не существовал,
# планирование дальше чем на 2 года вперёд — почти наверняка опечатка в годе.
BUSINESS_DATE_MIN = date(2020, 1, 1)
BUSINESS_DATE_MAX_AHEAD_DAYS = 730


def validate_business_date(value, *, field_ru: str) -> str | None:
    """Нормализует бизнес-дату документа: пусто → None, иначе YYYY-MM-DD в разумном диапазоне.

    400 с русским detail при мусоре или дате вне диапазона (например, 1991 год).
    """
    s = (str(value) if value is not None else "").strip()
    if not s:
        return None
    try:
        d = date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_ru}: укажите дату в формате ГГГГ-ММ-ДД")
    if d < BUSINESS_DATE_MIN or d > date.today() + timedelta(days=BUSINESS_DATE_MAX_AHEAD_DAYS):
        raise HTTPException(
            status_code=400,
            detail=f"{field_ru}: дата {d.isoformat()} вне допустимого диапазона",
        )
    return d.isoformat()
