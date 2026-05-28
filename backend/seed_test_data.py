"""
Сидер тестовых данных по ТЗ «test data.md».

Запуск:
    python seed_test_data.py            # обычный режим (идемпотентно по имени)
    python seed_test_data.py --reset    # очистить документы поступлений/отгрузок и таблицы товаров/справочников

Перед запуском создайте БД в PostgreSQL и задайте DATABASE_URL (см. backend/dbconn.py).

Создаёт:
    - 30 клиентов (фантазийные названия)
    - 60 поставщиков (ООО / АО / ИП)
    - 15 размеров (стандартный набор по ТЗ)
    - 20 цветов
    - 2 типа товаров: «Одежда», «Техника»
    - 120 товаров (~60 одежда + ~60 техника), каждый клиент получает минимум 1 товар.
"""

from __future__ import annotations

import argparse
import random
import sys
import unicodedata
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import psycopg

from dbconn import get_connection


# ---------- справочные списки ----------------------------------------------

CLIENTS = [
    "Северный Ветер", "Лунный Лис", "Город Света", "Звёздный Путь", "Алый Парус",
    "Снежный Барс", "Зелёная Долина", "Хрустальный Дворец", "Янтарное Море",
    "Тихая Гавань", "Серебряная Река", "Восточный Экспресс", "Огненная Птица",
    "Каменный Цветок", "Морской Бриз", "Закатный Берег", "Лазурный Купол",
    "Северное Сияние", "Бирюзовый Пляж", "Жемчужная Бухта", "Гранатовый Сад",
    "Изумрудный Лес", "Платиновый Век", "Сапфировая Звезда",
    "Малахитовая Шкатулка", "Перламутровый Закат", "Рубиновый Путь",
    "Янтарная Тропа", "Хрустальная Гора", "Аметистовый Берег",
]
assert len(CLIENTS) == 30

# 60 поставщиков: 35 ООО + 18 АО + 7 ИП.
_SUPPLIER_BRANDS = [
    "Альфа Снаб", "Бета Трейд", "Гранит", "Дельта Логистик", "Эверест",
    "Жасмин", "Заря", "Импульс", "Кедр", "Линия", "Меридиан", "Нева",
    "Орион", "Прометей", "Радуга", "Сигма", "Титан", "Универсал",
    "Феникс", "Хорда", "Цитрин", "Чайка", "Шторм", "Эра", "Ютланд",
    "Янтарь", "Базальт", "Велес", "Горизонт", "Диамант", "Енисей",
    "Зенит", "Икар", "Калибр", "Лотос",
]
assert len(_SUPPLIER_BRANDS) == 35
_SUPPLIER_AO = [
    "Магистраль", "Норд", "Олимп", "Пирамида", "Регион", "Стандарт",
    "Терра", "Урал", "Фактор", "Холдинг-А", "Цеппелин", "Эталон",
    "Юпитер", "Атлант", "Бриз-А", "Восток", "Гермес", "Доминанта",
]
assert len(_SUPPLIER_AO) == 18
_SUPPLIER_IP = [
    "Морозов", "Кузнецова", "Соколов", "Орлова", "Громов", "Беляева",
    "Зорин",
]
assert len(_SUPPLIER_IP) == 7

SUPPLIERS = (
    [f'ООО "{n}"' for n in _SUPPLIER_BRANDS]
    + [f'АО "{n}"' for n in _SUPPLIER_AO]
    + [f"ИП {n}" for n in _SUPPLIER_IP]
)
assert len(SUPPLIERS) == 60

SIZES = [
    # Стандартные буквенные (одежда взрослая)
    "XS", "S", "M", "L", "XL", "XXL", "XXXL",
    # Европейские числовые (одежда взрослая)
    "44", "46", "48", "50", "52", "54", "56",
    # Детские ростовки
    "86", "92", "98", "104", "110", "116", "122", "128",
    # Обувные (EU)
    "35", "36", "37", "38", "39", "40", "41", "42",
]
assert len(SIZES) == 30

COLORS = [
    # Нейтральные
    "Чёрный", "Белый", "Серый", "Светло-серый", "Тёмно-серый",
    # Тёплые
    "Бежевый", "Коричневый", "Шоколадный", "Карамельный", "Терракотовый",
    # Красная гамма
    "Красный", "Бордовый", "Малиновый", "Коралловый", "Персиковый",
    # Синяя гамма
    "Синий", "Тёмно-синий", "Голубой", "Индиго", "Джинсовый",
    # Зелёная гамма
    "Зелёный", "Тёмно-зелёный", "Оливковый", "Мятный", "Хаки",
    # Прочие
    "Жёлтый", "Оранжевый", "Фиолетовый", "Розовый", "Бирюзовый",
]
assert len(COLORS) == 30

WAREHOUSES = [
    # Московский регион
    "Склад Москва-Север", "Склад Москва-Юг", "Склад Москва-Восток",
    "Склад Москва-Запад", "Склад Подольск", "Склад Химки",
    "Склад Красногорск", "Склад Люберцы", "Склад Балашиха", "Склад Мытищи",
    # Крупные города
    "Склад Санкт-Петербург", "Склад Новосибирск", "Склад Екатеринбург",
    "Склад Казань", "Склад Нижний Новгород", "Склад Краснодар",
    "Склад Ростов-на-Дону", "Склад Самара", "Склад Уфа", "Склад Пермь",
    # Специализированные
    "Склад Холодного хранения №1", "Склад Холодного хранения №2",
    "Склад Высотного хранения А", "Склад Высотного хранения Б",
    "Склад Таможенный терминал", "Склад Карантинный", "Склад Брака",
    # Логистические хабы
    "Хаб Домодедово", "Хаб Шереметьево", "Хаб Внуково",
]
assert len(WAREHOUSES) == 30

CARRIERS = [
    # Крупные российские
    "СДЭК", "Деловые Линии", "ПЭК", "Байкал Сервис", "КИТ",
    "Энергия", "GTD Logistics", "Major Express", "ДПД", "Boxberry",
    # Почтовые
    "Почта России", "EMS Почта России", "PickPoint",
    # Курьерские сервисы
    "Яндекс Доставка", "Ozon Логистика", "Wildberries Logistics",
    "5Post", "Hermes Russia", "SPSR Express",
    # Региональные
    "Транс-Сибирская", "Урал-Логистик", "Сибирь-Карго",
    "Южная Логистическая Компания", "Северо-Западный Экспресс",
    "Волга-Транс", "Дальний Восток Логистик",
    # Международные с присутствием в РФ
    "DHL", "FedEx", "TNT", "UPS",
]
assert len(CARRIERS) == 30

PRODUCT_TYPES = [
    ("Одежда", 1, 1),  # requires_color=1, requires_size=1
    ("Техника", 0, 0),
]

RNG = random.Random(42)

# 60 названий одежды
_CLOTHES_BASES = [
    "Куртка зимняя", "Куртка демисезонная", "Пуховик длинный", "Парка утеплённая",
    "Пальто шерстяное", "Плащ классический", "Тренч однобортный",
    "Ветровка спортивная", "Жилет утеплённый", "Жилет джинсовый",
    "Свитер вязаный", "Кардиган длинный", "Худи флисовое", "Толстовка спортивная",
    "Свитшот базовый", "Лонгслив хлопковый", "Футболка базовая", "Футболка поло",
    "Рубашка офисная", "Рубашка лён", "Блузка шёлковая", "Топ майка",
    "Платье миди", "Платье макси", "Платье вечернее", "Юбка карандаш",
    "Юбка плиссе", "Юбка джинсовая", "Брюки классические", "Брюки чинос",
    "Джинсы прямые", "Джинсы скинни", "Джинсы бойфренды", "Шорты спортивные",
    "Шорты карго", "Бермуды лён", "Спортивный костюм", "Лосины",
    "Леггинсы спортивные", "Колготки тёплые", "Носки хлопковые",
    "Бельё термо", "Пижама классическая", "Халат махровый",
    "Кепка бейсболка", "Шапка вязаная", "Шапка флисовая",
    "Шарф палантин", "Шарф снуд", "Перчатки кожаные", "Варежки шерстяные",
    "Кроссовки беговые", "Кеды классические", "Ботинки треккинговые",
    "Сапоги зимние", "Сандалии летние", "Туфли офисные",
    "Балетки", "Слипоны", "Босоножки",
]
assert len(_CLOTHES_BASES) == 60

_TECH_BASES = [
    "Ноутбук игровой 15.6\"", "Ноутбук офисный 14\"", "Ноутбук ультрабук 13.3\"",
    "Моноблок 24\"", "ПК настольный игровой", "ПК офисный мини",
    "Монитор 27\" QHD", "Монитор 32\" 4K", "Монитор 24\" Full HD",
    "Клавиатура механическая", "Клавиатура мембранная", "Мышь беспроводная",
    "Мышь игровая RGB", "Коврик игровой XL",
    "Смартфон флагман 6.7\"", "Смартфон средний класс 6.5\"",
    "Смартфон базовый 6.1\"", "Планшет 10.2\"", "Планшет про 12.9\"",
    "Электронная книга 6\"", "Смарт-часы спортивные", "Фитнес-браслет",
    "Беспроводные наушники TWS", "Наушники накладные", "Наушники полноразмерные ANC",
    "Колонка портативная", "Саундбар 2.1", "Домашний кинотеатр 5.1",
    "Телевизор 43\" 4K", "Телевизор 55\" QLED", "Телевизор 65\" OLED",
    "Проектор Full HD", "Проектор 4K",
    "Пылесос вертикальный", "Робот-пылесос", "Пароочиститель ручной",
    "Утюг с парогенератором", "Гладильная система",
    "Кофемашина автоматическая", "Кофеварка рожковая",
    "Чайник электрический 1.7л", "Тостер на 2 ломтика", "Микроволновая печь 25л",
    "Холодильник двухкамерный", "Морозильная камера",
    "Стиральная машина 7кг", "Сушильная машина", "Посудомоечная машина 60см",
    "Мультиварка 5л", "Блендер погружной", "Кухонный комбайн",
    "Мясорубка электрическая", "Соковыжималка центробежная",
    "Электрогриль настольный", "Аэрогриль 12л",
    "Фен профессиональный", "Стайлер для волос",
    "Электробритва", "Триммер для бороды", "Зубная щётка электрическая",
]
assert len(_TECH_BASES) == 60


# ---------- утилиты ---------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _slug(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = "".join(c.lower() if c.isalnum() else "-" for c in norm)
    while "--" in norm:
        norm = norm.replace("--", "-")
    return norm.strip("-") or "x"


def _picsum(seed: str, size: int = 480) -> str:
    return f"https://picsum.photos/seed/{seed}/{size}/{size}"


def _admin_id(con: Any) -> str | None:
    row = con.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    return row["id"] if row else None


def _ensure_dictionary(
    con: Any,
    table: str,
    names: list[str],
    creator_id: str | None,
    is_active: int = 1,
) -> dict[str, str]:
    """Идемпотентно вставить записи; возвращает {name: id}."""
    out: dict[str, str] = {}
    for name in names:
        row = con.execute(
            f"SELECT id FROM {table} WHERE LOWER(name) = LOWER(?)", (name,)
        ).fetchone()
        if row:
            out[name] = row["id"]
            continue
        new_id = str(uuid4())
        con.execute(
            f"INSERT INTO {table} (id, name, is_active, created_at, creator_id) "
            f"VALUES (?, ?, ?, ?, ?)",
            (new_id, name, is_active, _now_iso(), creator_id),
        )
        out[name] = new_id
    return out


def _ensure_product_types(
    con: Any, creator_id: str | None
) -> dict[str, str]:
    out: dict[str, str] = {}
    for name, req_color, req_size in PRODUCT_TYPES:
        row = con.execute(
            "SELECT id FROM product_types WHERE LOWER(name) = LOWER(?)", (name,)
        ).fetchone()
        if row:
            type_id = row["id"]
            con.execute(
                "UPDATE product_types SET requires_color = ?, requires_size = ?, "
                "is_active = 1 WHERE id = ?",
                (req_color, req_size, type_id),
            )
            out[name] = type_id
            continue
        new_id = str(uuid4())
        con.execute(
            """
            INSERT INTO product_types
                (id, name, is_active, created_at, creator_id, requires_color, requires_size)
            VALUES (?, ?, 1, ?, ?, ?, ?)
            """,
            (new_id, name, _now_iso(), creator_id, req_color, req_size),
        )
        out[name] = new_id
    return out


def _seed_products(
    con: Any,
    *,
    type_ids: dict[str, str],
    client_ids: list[str],
    supplier_ids: list[str],
    color_ids: list[str],
    size_ids: list[str],
    creator_id: str | None,
) -> int:
    """Создаёт 120 товаров; гарантирует, что каждому клиенту назначен ≥ 1 товар."""
    existing_skus = {
        row["sku"] for row in con.execute("SELECT sku FROM products").fetchall()
    }
    existing_names = {
        row["name"].lower()
        for row in con.execute("SELECT name FROM products").fetchall()
    }

    products: list[tuple[str, str, str | None]] = []
    for name in _CLOTHES_BASES:
        products.append((name, type_ids["Одежда"], "CLO"))
    for name in _TECH_BASES:
        products.append((name, type_ids["Техника"], "TCH"))

    # Каждому клиенту — гарантированный товар (первые 30 позиций).
    rng = RNG
    rng.shuffle(products)

    if len(products) < len(client_ids):
        raise RuntimeError("Недостаточно товаров, чтобы покрыть всех клиентов")

    inserted = 0
    for index, (name, type_id, sku_prefix) in enumerate(products):
        client_id = client_ids[index] if index < len(client_ids) else rng.choice(client_ids)
        supplier_id = rng.choice(supplier_ids)

        # Уникальный SKU вида CLO-001-<slug>, TCH-001-<slug>.
        base_sku = f"{sku_prefix}-{index + 1:03d}-{_slug(name)[:24]}"
        sku = base_sku
        salt = 1
        while sku in existing_skus:
            salt += 1
            sku = f"{base_sku}-{salt}"
        existing_skus.add(sku)

        if name.lower() in existing_names:
            continue
        existing_names.add(name.lower())

        pid = str(uuid4())
        con.execute(
            """
            INSERT INTO products
                (id, name, type_id, client_id, supplier_id, sku, image_url,
                 is_active, created_at, creator_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                pid,
                name,
                type_id,
                client_id,
                supplier_id,
                sku,
                _picsum(_slug(name)),
                _now_iso(),
                creator_id,
            ),
        )
        col_id = RNG.choice(color_ids)
        if type_ids.get("Одежда") == type_id:
            sz_id = RNG.choice(size_ids)
            con.execute(
                """
                INSERT INTO product_variants (
                    id, product_id, color_id, size_id,
                    length, width, height, sku, images_json,
                    is_active, created_at
                )
                VALUES (?, ?, ?, ?, 1, 1, 1, ?, '[]', 1, ?)
                """,
                (str(uuid4()), pid, col_id, sz_id, sku, _now_iso()),
            )
        else:
            con.execute(
                """
                INSERT INTO product_variants (
                    id, product_id, color_id, size_id,
                    length, width, height, sku, images_json,
                    is_active, created_at
                )
                VALUES (?, ?, ?, NULL, 10, 10, 10, ?, '[]', 1, ?)
                """,
                (str(uuid4()), pid, col_id, sku, _now_iso()),
            )
        inserted += 1
    return inserted


def _reset(con: Any) -> None:
    con.execute("DELETE FROM receipt_ops")
    con.execute("DELETE FROM receipt_lines")
    con.execute("DELETE FROM receipt_docs")
    con.execute("DELETE FROM shipment_ops")
    con.execute("DELETE FROM shipment_lines")
    con.execute("DELETE FROM shipment_docs")
    con.execute("DELETE FROM product_variants")
    con.execute("DELETE FROM products")
    con.execute("DELETE FROM clients")
    con.execute("DELETE FROM suppliers")
    con.execute("DELETE FROM colors")
    con.execute("DELETE FROM sizes")
    con.execute("DELETE FROM warehouses")
    con.execute("DELETE FROM carriers")
    con.execute(
        "DELETE FROM product_types WHERE LOWER(name) IN ('одежда', 'техника')"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Сидер тестовых данных")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Очистить операции, товары и справочники перед посадкой",
    )
    args = parser.parse_args()

    try:
        with get_connection() as con:
            admin_id = _admin_id(con)
            if args.reset:
                _reset(con)
                print("Удалены: операции, товары и тестовые справочники")

            clients = _ensure_dictionary(con, "clients", CLIENTS, admin_id)
            suppliers = _ensure_dictionary(con, "suppliers", SUPPLIERS, admin_id)
            sizes = _ensure_dictionary(con, "sizes", SIZES, admin_id)
            colors = _ensure_dictionary(con, "colors", COLORS, admin_id)
            warehouses = _ensure_dictionary(con, "warehouses", WAREHOUSES, admin_id)
            carriers = _ensure_dictionary(con, "carriers", CARRIERS, admin_id)
            types = _ensure_product_types(con, admin_id)

            # Все активные клиенты в БД (включая возможные предсуществующие) — чтобы
            # каждый получил минимум по 1 товару (правило ТЗ).
            all_client_ids = [
                row["id"]
                for row in con.execute(
                    "SELECT id FROM clients ORDER BY created_at ASC"
                ).fetchall()
            ]
            product_inserts = _seed_products(
                con,
                type_ids=types,
                client_ids=all_client_ids,
                supplier_ids=list(suppliers.values()),
                color_ids=list(colors.values()),
                size_ids=list(sizes.values()),
                creator_id=admin_id,
            )
            con.commit()

            totals = {
                "Клиенты": len(clients),
                "Поставщики": len(suppliers),
                "Размеры": len(sizes),
                "Цвета": len(colors),
                "Склады": len(warehouses),
                "Перевозчики": len(carriers),
                "Типы товаров": len(types),
                "Товары (новых записей)": product_inserts,
            }
            for label, qty in totals.items():
                print(f"  {label:.<32} {qty}")
            print("Готово.")
    except psycopg.Error as e:
        print(f"Ошибка БД: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
