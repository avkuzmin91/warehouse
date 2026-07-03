"""Ставка аренды склада (effective-dated).

Чистая логика поверх warehouse_rent_rates: одна ставка аренды на склад, история
append-only. Действующая ставка ищется тем же правилом, что стоимость палета/упаковки
(`pricing.service.price_on`): последняя запись с effective_from <= дата события, самая
ранняя тянется назад. Деньги — копейки INTEGER.

own_warehouses.rent_monthly_kopecks — денормализованный кэш «ставки на сегодня»: список
справочника и lookups читают его напрямую, поэтому при каждом add/delete ставки кэш
пересчитывается через _sync_rent_cache. Источник правды — история, а не кэш.
"""

from __future__ import annotations

from uuid import uuid4

from modules.pricing.service import price_on
from utils import now_iso as _now



def load_rent_history(connection, warehouse_id: str) -> list[dict]:
    """Записи ставки аренды по складу, свежая первой."""
    rows = connection.execute(
        "SELECT id, rent_monthly_kopecks, effective_from, note, created_at, created_by "
        "FROM warehouse_rent_rates "
        "WHERE warehouse_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY effective_from DESC, created_at DESC",
        (warehouse_id,),
    ).fetchall()
    return [
        {
            "id": str(r["id"]),
            "rent_monthly_kopecks": int(r["rent_monthly_kopecks"]),
            "effective_from": str(r["effective_from"]),
            "note": r["note"],
            "created_at": str(r["created_at"]),
            "created_by": r["created_by"],
        }
        for r in rows
    ]


def current_rent_rates(connection, warehouse_ids: list[str], day_iso: str) -> dict[str, int]:
    """warehouse_id → действующая на дату ставка аренды для набора складов (один запрос)."""
    ids = list({str(w) for w in warehouse_ids if w})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT warehouse_id, rent_monthly_kopecks, effective_from, created_at "
        f"FROM warehouse_rent_rates "
        f"WHERE warehouse_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY warehouse_id, effective_from DESC, created_at DESC",
        ids,
    ).fetchall()
    hist: dict[str, list[dict]] = {}
    for r in rows:
        hist.setdefault(str(r["warehouse_id"]), []).append(
            {"price_kop": int(r["rent_monthly_kopecks"]), "effective_from": str(r["effective_from"])}
        )
    out: dict[str, int] = {}
    for wid in ids:
        val = price_on(hist.get(wid), day_iso)
        if val is not None:
            out[wid] = val
    return out


def rent_rate_for_event(connection, warehouse_id: str, day_iso: str) -> int | None:
    """Действующая ставка аренды склада на дату события. None — ставка не заведена."""
    hist = [
        {"price_kop": e["rent_monthly_kopecks"], "effective_from": e["effective_from"]}
        for e in load_rent_history(connection, warehouse_id)
    ]
    return price_on(hist, day_iso)


def _sync_rent_cache(connection, warehouse_id: str, today_iso: str) -> None:
    """Пересчитать денормализованный кэш own_warehouses.rent_monthly_kopecks по истории."""
    current = rent_rate_for_event(connection, warehouse_id, today_iso)
    connection.execute(
        "UPDATE own_warehouses SET rent_monthly_kopecks = ? WHERE id = ?",
        (current, warehouse_id),
    )


def add_rent_rate(
    connection, *, warehouse_id: str, rent_monthly_kopecks: int, effective_from: str,
    user_id: str, today_iso: str, note: str | None = None,
) -> str:
    """Добавить запись ставки аренды (append-only) и обновить кэш. Без commit — коммитит вызывающий."""
    new_id = str(uuid4())
    connection.execute(
        "INSERT INTO warehouse_rent_rates "
        "(id, warehouse_id, rent_monthly_kopecks, effective_from, note, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?)",
        (new_id, warehouse_id, int(rent_monthly_kopecks), effective_from, (note or None), _now(), user_id),
    )
    _sync_rent_cache(connection, warehouse_id, today_iso)
    return new_id


def delete_rent_rate(connection, *, warehouse_id: str, rate_id: str, today_iso: str) -> bool:
    """Мягко удалить запись истории (ошибочный ввод) и обновить кэш. Без commit.

    False, если запись не найдена / уже удалена / не принадлежит складу."""
    row = connection.execute(
        "SELECT id FROM warehouse_rent_rates "
        "WHERE id = ? AND warehouse_id = ? AND COALESCE(is_deleted, 0) = 0",
        (rate_id, warehouse_id),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE warehouse_rent_rates SET is_deleted = 1 WHERE id = ?", (rate_id,)
    )
    _sync_rent_cache(connection, warehouse_id, today_iso)
    return True
