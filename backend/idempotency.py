"""Идемпотентность write-операций для мобильного клиента (docs/mobile-plan.md §6.3).

Мобильная сеть рвётся: клиент шлёт `X-Request-Id` (UUID) и повторяет write-запрос
при обрыве. Сервер запоминает обработанные request_id и на повтор отдаёт прежний
ответ, не выполняя операцию заново.

Ключевой инвариант: захват ключа (`INSERT ... ON CONFLICT DO NOTHING`) идёт по тому
же `connection`, что и сама операция, и коммитится вместе с ней. Поэтому повтор
никогда не получит `proceed=True` для уже закоммиченной операции — двойного эффекта
(двойной приёмки/перемещения) быть не может. Если операция падает до коммита,
транзакция откатывается вместе с захватом — корректный ретрай возможен.

Конкурентный повтор блокируется на unique-индексе PK до завершения первого запроса,
затем читает уже сохранённый ответ.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException


def _now() -> str:
    return datetime.now(UTC).isoformat()


def purge_expired_idempotency_keys(conn: Any, *, older_than_hours: int = 48) -> None:
    """Удалить идемпотентные ключи старше окна ретраев (фоновая чистка).

    Ключ нужен лишь на время, пока клиент может повторить оборванный запрос; держать
    его вечно незачем, иначе таблица растёт безгранично. created_at — ISO-8601 UTC,
    поэтому лексикографическое сравнение строк корректно. Индекс по created_at есть
    (миграция 0062). Вызывается из фонового цикла в app.py.
    """
    cutoff = (datetime.now(UTC) - timedelta(hours=older_than_hours)).isoformat()
    conn.execute("DELETE FROM idempotency_keys WHERE created_at < ?", (cutoff,))


def begin_idempotent(
    conn: Any,
    request_id: str | None,
    user_id: str,
    scope: str,
    *,
    response: Any = None,
) -> tuple[bool, Any]:
    """Захватить идемпотентный ключ.

    Возвращает ``(proceed, stored)``:
    - ``proceed=True`` — ключ захвачен в этой транзакции, выполняй операцию;
    - ``proceed=False`` — операция по этому request_id уже выполнена, верни ``stored``.

    Без ``request_id`` идемпотентность выключена (``(True, None)``).

    ``response`` — если ответ операции детерминирован (константа), передать его сюда:
    он сохранится сразу при захвате, без окна с пустым ответом. Для операций с
    вычисляемым ответом оставить ``None`` и вызвать :func:`finish_idempotent` после.
    """
    rid = str(request_id or "").strip()
    if not rid:
        return True, None
    payload = json.dumps(response, ensure_ascii=False) if response is not None else None
    claimed = conn.execute(
        "INSERT INTO idempotency_keys (request_id, user_id, scope, response_json, created_at) "
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT (request_id) DO NOTHING RETURNING request_id",
        (rid, user_id, scope, payload, _now()),
    ).fetchone()
    if claimed:
        return True, None
    row = conn.execute(
        "SELECT user_id, scope, response_json FROM idempotency_keys WHERE request_id = ?",
        (rid,),
    ).fetchone()
    if not row:
        # Гонка вставки/удаления — крайне маловероятно. Пусть клиент повторит.
        raise HTTPException(status_code=409, detail="Повторите запрос")
    if str(row["user_id"]) != str(user_id) or str(row["scope"]) != scope:
        raise HTTPException(status_code=409, detail="Конфликт идемпотентного ключа")
    if row["response_json"] is None:
        raise HTTPException(status_code=409, detail="Запрос ещё обрабатывается")
    return False, json.loads(row["response_json"])


def finish_idempotent(conn: Any, request_id: str | None, result: Any) -> None:
    """Сохранить вычисленный ответ операции под захваченным ключом (см. begin_idempotent)."""
    rid = str(request_id or "").strip()
    if not rid:
        return
    conn.execute(
        "UPDATE idempotency_keys SET response_json = ? WHERE request_id = ?",
        (json.dumps(result, ensure_ascii=False), rid),
    )
