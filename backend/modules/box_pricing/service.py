"""Стоимость короба по клиенту (effective-dated).

Чистая логика поверх client_box_prices: одна цена короба на клиента, история
append-only. Действующая цена ищется тем же правилом, что и цена палета/тариф упаковки
(`pricing.service.price_on`): последняя запись с effective_from <= дата события,
самая ранняя тянется назад. Деньги — копейки INTEGER.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from modules.pricing.service import price_on


def _now() -> str:
    return datetime.now(UTC).isoformat()


def load_box_price_history(connection, client_id: str) -> list[dict]:
    """Записи цены короба по клиенту, свежая первой."""
    rows = connection.execute(
        "SELECT id, price_kop, effective_from, note, created_at, created_by "
        "FROM client_box_prices "
        "WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY effective_from DESC, created_at DESC",
        (client_id,),
    ).fetchall()
    return [
        {
            "id": str(r["id"]),
            "price_kop": int(r["price_kop"]),
            "effective_from": str(r["effective_from"]),
            "note": r["note"],
            "created_at": str(r["created_at"]),
            "created_by": r["created_by"],
        }
        for r in rows
    ]


def load_box_price_histories(connection, client_ids: list[str]) -> dict[str, list[dict]]:
    """client_id → история цены короба (свежая первой) одним запросом — без N+1.

    Для построчного расчёта по разным датам событий: вызывающий сам делает
    `price_on(hist.get(client_id), day)` на нужную дату каждого документа."""
    ids = list({str(c) for c in client_ids if c})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT client_id, price_kop, effective_from "
        f"FROM client_box_prices "
        f"WHERE client_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY client_id, effective_from DESC, created_at DESC",
        ids,
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["client_id"]), []).append(
            {"price_kop": int(r["price_kop"]), "effective_from": str(r["effective_from"])}
        )
    return out


def current_box_prices(connection, client_ids: list[str], day_iso: str) -> dict[str, int]:
    """client_id → действующая на дату цена короба для набора клиентов (один запрос)."""
    ids = list({str(c) for c in client_ids if c})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT client_id, price_kop, effective_from, created_at "
        f"FROM client_box_prices "
        f"WHERE client_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY client_id, effective_from DESC, created_at DESC",
        ids,
    ).fetchall()
    hist: dict[str, list[dict]] = {}
    for r in rows:
        hist.setdefault(str(r["client_id"]), []).append(
            {"price_kop": int(r["price_kop"]), "effective_from": str(r["effective_from"])}
        )
    out: dict[str, int] = {}
    for cid in ids:
        val = price_on(hist.get(cid), day_iso)
        if val is not None:
            out[cid] = val
    return out


def box_price_for_event(connection, client_id: str, day_iso: str) -> int | None:
    """Действующая цена короба клиента на дату события. None — цена не заведена."""
    return price_on(load_box_price_history(connection, client_id), day_iso)


def add_box_price(
    connection, *, client_id: str, price_kop: int, effective_from: str,
    user_id: str, note: str | None = None,
) -> str:
    """Добавить запись цены короба (append-only). Без commit — вызывающий коммитит."""
    new_id = str(uuid4())
    connection.execute(
        "INSERT INTO client_box_prices "
        "(id, client_id, price_kop, effective_from, note, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?)",
        (new_id, client_id, int(price_kop), effective_from, (note or None), _now(), user_id),
    )
    return new_id


def delete_box_price(connection, *, client_id: str, price_id: str) -> bool:
    """Мягко удалить запись истории (ошибочный ввод). Без commit.

    False, если запись не найдена / уже удалена / не принадлежит клиенту."""
    row = connection.execute(
        "SELECT id FROM client_box_prices "
        "WHERE id = ? AND client_id = ? AND COALESCE(is_deleted, 0) = 0",
        (price_id, client_id),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE client_box_prices SET is_deleted = 1 WHERE id = ?", (price_id,)
    )
    return True
