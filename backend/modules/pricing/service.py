"""Тарифы упаковки: effective-dated стоимость услуги (годный/брак) по (товар, клиент).

Чистая логика поверх таблицы product_packing_prices. Действующая ставка ищется
зеркально rate_on из табеля: последняя запись с effective_from <= дата события,
самая ранняя тянется назад. Деньги — копейки INTEGER.
"""

from __future__ import annotations

from uuid import uuid4

from config import INV_Q_DEFECT, INV_Q_GOOD
from utils import now_iso as _now

QUALITIES = (INV_Q_GOOD, INV_Q_DEFECT)



# ── Lookup (as-of) ───────────────────────────────────────────────────────────

def load_price_history(connection, product_id: str, client_id: str, quality: str) -> list[dict]:
    """Записи тарифа по (товар, клиент, качество), свежая первой."""
    rows = connection.execute(
        "SELECT id, price_kop, effective_from, note, created_at, created_by "
        "FROM product_packing_prices "
        "WHERE product_id = ? AND client_id = ? AND quality = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY effective_from DESC, created_at DESC",
        (product_id, client_id, quality),
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


def price_on(prices_desc: list[dict] | None, day_iso: str) -> int | None:
    """Тариф, действовавший на дату: последняя запись с effective_from <= day.

    Самая ранняя ставка тянется на более ранние даты («распространение назад»),
    иначе упакованное/отгруженное до заведения тарифа считалось бы нулём."""
    if not prices_desc:
        return None
    day = day_iso[:10]
    for r in prices_desc:  # отсортированы по убыванию effective_from
        if str(r["effective_from"])[:10] <= day:
            return int(r["price_kop"])
    return int(prices_desc[-1]["price_kop"])


def current_prices_for_products(
    connection, products: list[tuple[str, str | None]], day_iso: str
) -> dict[tuple[str, str], int]:
    """(product_id, quality) → действующий на дату тариф для набора товаров.

    products — список (product_id, client_id); тариф ищется по собственному клиенту
    товара. Один запрос на страницу (без N+1)."""
    pairs = [(str(pid), str(cid)) for pid, cid in products if pid and cid]
    if not pairs:
        return {}
    pids = list({p for p, _ in pairs})
    placeholders = ",".join("?" for _ in pids)
    rows = connection.execute(
        f"SELECT product_id, client_id, quality, price_kop, effective_from, created_at "
        f"FROM product_packing_prices "
        f"WHERE product_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY product_id, client_id, quality, effective_from DESC, created_at DESC",
        pids,
    ).fetchall()
    hist: dict[tuple[str, str, str], list[dict]] = {}
    for r in rows:
        hist.setdefault(
            (str(r["product_id"]), str(r["client_id"]), str(r["quality"])), []
        ).append({"price_kop": int(r["price_kop"]), "effective_from": str(r["effective_from"])})
    out: dict[tuple[str, str], int] = {}
    for pid, cid in pairs:
        for q in QUALITIES:
            val = price_on(hist.get((pid, cid, q)), day_iso)
            if val is not None:
                out[(pid, q)] = val
    return out


def price_for_event(connection, product_id: str, client_id: str, quality: str, day_iso: str) -> int | None:
    """Действующий тариф (товар, клиент, качество) на дату события. None — тариф не заведён."""
    return price_on(load_price_history(connection, product_id, client_id, quality), day_iso)


def load_histories(connection, product_ids: list[str]) -> dict[tuple[str, str, str], list[dict]]:
    """(product_id, client_id, quality) → история тарифа (свежая первой) одним запросом.

    Для построчного расчёта заработка (производительность) без N+1: вызывающий сам
    делает price_on(history, packed_date) на нужную дату каждой строки."""
    ids = [str(p) for p in product_ids if p]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT product_id, client_id, quality, price_kop, effective_from, created_at "
        f"FROM product_packing_prices "
        f"WHERE product_id IN ({placeholders}) AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY product_id, client_id, quality, effective_from DESC, created_at DESC",
        ids,
    ).fetchall()
    out: dict[tuple[str, str, str], list[dict]] = {}
    for r in rows:
        out.setdefault(
            (str(r["product_id"]), str(r["client_id"]), str(r["quality"])), []
        ).append({"price_kop": int(r["price_kop"]), "effective_from": str(r["effective_from"])})
    return out


# ── Запись тарифа ────────────────────────────────────────────────────────────

def add_price(
    connection,
    *,
    product_id: str,
    client_id: str,
    quality: str,
    price_kop: int,
    effective_from: str,
    user_id: str,
    note: str | None = None,
) -> str:
    """Добавить запись тарифа (append-only). Без commit — вызывающий коммитит."""
    new_id = str(uuid4())
    connection.execute(
        "INSERT INTO product_packing_prices "
        "(id, product_id, client_id, quality, price_kop, effective_from, note, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (new_id, product_id, client_id, quality, int(price_kop), effective_from,
         (note or None), _now(), user_id),
    )
    return new_id


def delete_price(connection, *, product_id: str, price_id: str) -> bool:
    """Мягко удалить запись истории тарифа (ошибочный ввод). Без commit.

    Возвращает False, если запись не найдена / уже удалена / не принадлежит товару."""
    row = connection.execute(
        "SELECT id FROM product_packing_prices "
        "WHERE id = ? AND product_id = ? AND COALESCE(is_deleted, 0) = 0",
        (price_id, product_id),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE product_packing_prices SET is_deleted = 1 WHERE id = ?",
        (price_id,),
    )
    return True


# ── Цена единицы упаковки по клиенту (палета/короб) ─────────────────────────
# Одна effective-dated цена на клиента, история append-only. Логика палет и
# коробов идентична — различается только таблица (client_pallet_prices /
# client_box_prices); модули pallet_pricing / box_pricing — тонкие обёртки.
# `table` приходит только из этих модулей (константа), не из запроса.

def load_client_unit_price_history(connection, table: str, client_id: str) -> list[dict]:
    """Записи цены по клиенту, свежая первой."""
    rows = connection.execute(
        f"SELECT id, price_kop, effective_from, note, created_at, created_by "
        f"FROM {table} "
        f"WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0 "
        f"ORDER BY effective_from DESC, created_at DESC",
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


def load_client_unit_price_histories(connection, table: str, client_ids: list[str]) -> dict[str, list[dict]]:
    """client_id → история цены (свежая первой) одним запросом — без N+1.

    Для построчного расчёта по разным датам событий: вызывающий сам делает
    `price_on(hist.get(client_id), day)` на нужную дату каждого документа."""
    ids = list({str(c) for c in client_ids if c})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT client_id, price_kop, effective_from "
        f"FROM {table} "
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


def current_client_unit_prices(connection, table: str, client_ids: list[str], day_iso: str) -> dict[str, int]:
    """client_id → действующая на дату цена для набора клиентов (один запрос)."""
    hist = load_client_unit_price_histories(connection, table, client_ids)
    out: dict[str, int] = {}
    for cid in {str(c) for c in client_ids if c}:
        val = price_on(hist.get(cid), day_iso)
        if val is not None:
            out[cid] = val
    return out


def client_unit_price_for_event(connection, table: str, client_id: str, day_iso: str) -> int | None:
    """Действующая цена клиента на дату события. None — цена не заведена."""
    return price_on(load_client_unit_price_history(connection, table, client_id), day_iso)


def add_client_unit_price(
    connection, table: str, *, client_id: str, price_kop: int, effective_from: str,
    user_id: str, note: str | None = None,
) -> str:
    """Добавить запись цены (append-only). Без commit — вызывающий коммитит."""
    new_id = str(uuid4())
    connection.execute(
        f"INSERT INTO {table} "
        f"(id, client_id, price_kop, effective_from, note, created_at, created_by) "
        f"VALUES (?,?,?,?,?,?,?)",
        (new_id, client_id, int(price_kop), effective_from, (note or None), _now(), user_id),
    )
    return new_id


def delete_client_unit_price(connection, table: str, *, client_id: str, price_id: str) -> bool:
    """Мягко удалить запись истории (ошибочный ввод). Без commit.

    False, если запись не найдена / уже удалена / не принадлежит клиенту."""
    row = connection.execute(
        f"SELECT id FROM {table} "
        f"WHERE id = ? AND client_id = ? AND COALESCE(is_deleted, 0) = 0",
        (price_id, client_id),
    ).fetchone()
    if not row:
        return False
    connection.execute(f"UPDATE {table} SET is_deleted = 1 WHERE id = ?", (price_id,))
    return True
