"""
Сидер тестовых операций приёмки и отгрузки.

По ТЗ:
    - 1000 поступлений (in) по 20 заказчикам со случайными товарами
    - 900 отгрузок (out) по тем же заказчикам
    - Все остатки должны быть > 0 (для каждой ключевой комбинации
      product+color+size после всех операций balance > 0)

Запуск:
    python seed_inventory_operations.py
    python seed_inventory_operations.py --reset   # удалить все операции до посадки
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from dbconn import get_connection

RNG = random.Random(20260502)

CLIENTS_COUNT = 20
RECEIPTS_COUNT = 1000
SHIPMENTS_COUNT = 900

RECEIPT_QTY_MIN, RECEIPT_QTY_MAX = 5, 50
SHIPMENT_QTY_MIN, SHIPMENT_QTY_MAX = 1, 15

# Поступления распределяются «глубже» в прошлое, отгрузки — ближе к сегодня,
# чтобы порядок был хронологически корректным.
RECEIPT_DAYS_AGO_MIN, RECEIPT_DAYS_AGO_MAX = 20, 90
SHIPMENT_DAYS_AGO_MIN, SHIPMENT_DAYS_AGO_MAX = 0, 19


def _now() -> datetime:
    return datetime.now(UTC)


def _admin_id(con: Any) -> str | None:
    row = con.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    return row["id"] if row else None


def _pick_color_size(
    rng: random.Random,
    *,
    requires_color: bool,
    requires_size: bool,
    colors: list[str],
    sizes: list[str],
    is_tech: bool,
) -> tuple[str | None, str | None]:
    if requires_color:
        cid: str | None = rng.choice(colors)
    else:
        cid = rng.choice(colors) if (is_tech and rng.random() < 0.5) else None
    sid: str | None = rng.choice(sizes) if requires_size else None
    return cid, sid


def _is_tech_type_name(name: str | None) -> bool:
    if not name:
        return False
    n = name.lower()
    return "техник" in n or "tech" in n


def main() -> int:
    parser = argparse.ArgumentParser(description="Сидер операций приёмки/отгрузки")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Удалить все inventory_operations перед посадкой",
    )
    args = parser.parse_args()

    rng = RNG
    now_ts = _now()

    with get_connection() as con:
        admin_id = _admin_id(con)

        if args.reset:
            con.execute("DELETE FROM inventory_operations")
            print("inventory_operations очищена")

        # 20 заказчиков (детерминированно: первые по дате создания).
        clients = [
            r["id"]
            for r in con.execute(
                "SELECT id FROM clients WHERE is_active = 1 "
                "ORDER BY created_at ASC LIMIT ?",
                (CLIENTS_COUNT,),
            ).fetchall()
        ]
        if len(clients) < CLIENTS_COUNT:
            print(
                f"Недостаточно активных клиентов: нужно {CLIENTS_COUNT}, есть {len(clients)}. "
                "Сначала запустите seed_test_data.py",
                file=sys.stderr,
            )
            return 1

        placeholders = ",".join(["?"] * len(clients))
        products = con.execute(
            f"""
            SELECT p.id, p.client_id, p.type_id,
                   pt.name AS type_name,
                   pt.requires_color, pt.requires_size
            FROM products p
            JOIN product_types pt ON pt.id = p.type_id
            WHERE p.is_active = 1
              AND p.client_id IN ({placeholders})
            """,
            clients,
        ).fetchall()
        if not products:
            print("Нет активных товаров у выбранных клиентов", file=sys.stderr)
            return 1

        colors = [
            r["id"]
            for r in con.execute(
                "SELECT id FROM colors WHERE is_active = 1"
            ).fetchall()
        ]
        sizes = [
            r["id"]
            for r in con.execute(
                "SELECT id FROM sizes WHERE is_active = 1"
            ).fetchall()
        ]
        if not colors or not sizes:
            print("Нет активных размеров/цветов", file=sys.stderr)
            return 1

        balances: dict[tuple[str, str | None, str | None], int] = {}
        rows: list[tuple[str, str, str, str | None, str | None, int, str, str | None]] = []

        # 1) Поступления.
        for _ in range(RECEIPTS_COUNT):
            p = rng.choice(products)
            is_tech = _is_tech_type_name(p["type_name"])
            cid, sid = _pick_color_size(
                rng,
                requires_color=bool(p["requires_color"]),
                requires_size=bool(p["requires_size"]),
                colors=colors,
                sizes=sizes,
                is_tech=is_tech,
            )
            qty = rng.randint(RECEIPT_QTY_MIN, RECEIPT_QTY_MAX)
            ts = now_ts - timedelta(
                days=rng.randint(RECEIPT_DAYS_AGO_MIN, RECEIPT_DAYS_AGO_MAX),
                seconds=rng.randint(0, 86399),
            )
            rows.append((str(uuid4()), "in", p["id"], cid, sid, qty, ts.isoformat(), admin_id))
            key = (p["id"], cid, sid)
            balances[key] = balances.get(key, 0) + qty

        # 2) Отгрузки. Берём ключи с балансом ≥ 2, чтобы оставить минимум 1 шт.
        keys_with_stock = [k for k, v in balances.items() if v >= 2]
        if not keys_with_stock:
            print("Нет ключей с положительным балансом", file=sys.stderr)
            return 1

        placed_out = 0
        max_attempts = SHIPMENTS_COUNT * 20
        attempts = 0
        while placed_out < SHIPMENTS_COUNT and attempts < max_attempts:
            attempts += 1
            key = rng.choice(keys_with_stock)
            bal = balances[key]
            if bal < 2:
                # ключ исчерпан — обновляем выборку
                keys_with_stock = [k for k, v in balances.items() if v >= 2]
                if not keys_with_stock:
                    break
                continue
            # Гарантируем balance - qty >= 1 → qty <= bal - 1
            max_qty = min(SHIPMENT_QTY_MAX, bal - 1)
            qty = rng.randint(SHIPMENT_QTY_MIN, max_qty)
            ts = now_ts - timedelta(
                days=rng.randint(SHIPMENT_DAYS_AGO_MIN, SHIPMENT_DAYS_AGO_MAX),
                seconds=rng.randint(0, 86399),
            )
            rows.append(
                (str(uuid4()), "out", key[0], key[1], key[2], qty, ts.isoformat(), admin_id)
            )
            balances[key] = bal - qty
            placed_out += 1

        if placed_out < SHIPMENTS_COUNT:
            print(
                f"Внимание: удалось разместить {placed_out}/{SHIPMENTS_COUNT} отгрузок "
                "(не хватает остатка по ключам)",
                file=sys.stderr,
            )

        con.executemany(
            """
            INSERT INTO inventory_operations
                (id, op_type, product_id, color_id, size_id, quantity, note,
                 created_at, created_by_id)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """,
            rows,
        )
        con.commit()

        positive = sum(1 for v in balances.values() if v > 0)
        zero_or_neg = sum(1 for v in balances.values() if v <= 0)
        total_in = sum(r[5] for r in rows if r[1] == "in")
        total_out = sum(r[5] for r in rows if r[1] == "out")
        print(f"  Поступления вставлено................. {RECEIPTS_COUNT}")
        print(f"  Отгрузки вставлено.................... {placed_out}")
        print(f"  Уникальных ключей (product+color+size) {len(balances)}")
        print(f"  Ключей с положительным балансом....... {positive}")
        print(f"  Ключей с нулевым/отрицательным........ {zero_or_neg}")
        print(f"  Сумма прихода......................... {total_in}")
        print(f"  Сумма расхода......................... {total_out}")
        print(f"  Итого остаток (in - out).............. {total_in - total_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
