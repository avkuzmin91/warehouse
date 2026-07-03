"""Стоимость палета по клиенту (effective-dated).

Тонкие обёртки над общей реализацией «цена единицы упаковки по клиенту»
(`modules.pricing.service.*client_unit_price*`): у палет и коробов одна логика,
различается только таблица. Деньги — копейки INTEGER.
"""

from __future__ import annotations

from modules.pricing.service import (
    add_client_unit_price,
    client_unit_price_for_event,
    current_client_unit_prices,
    delete_client_unit_price,
    load_client_unit_price_histories,
    load_client_unit_price_history,
    price_on,
)

__all__ = [
    "load_pallet_price_history", "load_pallet_price_histories", "current_pallet_prices",
    "pallet_price_for_event", "add_pallet_price", "delete_pallet_price", "price_on",
]

_TABLE = "client_pallet_prices"


def load_pallet_price_history(connection, client_id: str) -> list[dict]:
    """Записи цены палета по клиенту, свежая первой."""
    return load_client_unit_price_history(connection, _TABLE, client_id)


def load_pallet_price_histories(connection, client_ids: list[str]) -> dict[str, list[dict]]:
    """client_id → история цены палета (свежая первой) одним запросом — без N+1."""
    return load_client_unit_price_histories(connection, _TABLE, client_ids)


def current_pallet_prices(connection, client_ids: list[str], day_iso: str) -> dict[str, int]:
    """client_id → действующая на дату цена палета для набора клиентов (один запрос)."""
    return current_client_unit_prices(connection, _TABLE, client_ids, day_iso)


def pallet_price_for_event(connection, client_id: str, day_iso: str) -> int | None:
    """Действующая цена палета клиента на дату события. None — цена не заведена."""
    return client_unit_price_for_event(connection, _TABLE, client_id, day_iso)


def add_pallet_price(
    connection, *, client_id: str, price_kop: int, effective_from: str,
    user_id: str, note: str | None = None,
) -> str:
    """Добавить запись цены палета (append-only). Без commit — вызывающий коммитит."""
    return add_client_unit_price(
        connection, _TABLE,
        client_id=client_id, price_kop=price_kop, effective_from=effective_from,
        user_id=user_id, note=note,
    )


def delete_pallet_price(connection, *, client_id: str, price_id: str) -> bool:
    """Мягко удалить запись истории (ошибочный ввод). Без commit."""
    return delete_client_unit_price(connection, _TABLE, client_id=client_id, price_id=price_id)
