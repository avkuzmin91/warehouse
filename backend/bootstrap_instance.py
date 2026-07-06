"""Первичная инициализация инстанса: создание администратора.

Схему БД ведёт alembic (docker-start.sh выполняет `alembic upgrade head` перед
uvicorn), сид справочников расходов — миграции 0056/0081. Этому скрипту остаётся
одно: идемпотентно завести первого администратора.

Запуск внутри контейнера backend (DATABASE_URL и JWT_SECRET уже заданы):
    docker compose --env-file .env.prod -f docker-compose.prod.yml \
        exec -T backend python bootstrap_instance.py \
        --email admin@client.ru --password 'СИЛЬНЫЙ_ПАРОЛЬ'

Либо локально — с теми же переменными окружения в шелле.

Поведение:
    - пользователя с таким email нет            → создаётся с ролью admin;
    - есть и это admin                          → без изменений (exit 0);
    - есть и это admin + --update-password      → пароль обновляется;
    - есть, но роль НЕ admin                    → ошибка (exit 1): повышение
      ролей — осознанное действие через раздел «Пользователи», не bootstrap.

Email и пароль можно передать и через окружение: BOOTSTRAP_ADMIN_EMAIL,
BOOTSTRAP_ADMIN_PASSWORD (аргументы командной строки имеют приоритет).
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from uuid import uuid4

from dbconn import get_connection
from modules.auth.service import hash_password

MIN_PASSWORD_LEN = 10


def _fail(message: str) -> None:
    print(f"ОШИБКА: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Создание администратора нового инстанса")
    parser.add_argument("--email", default=os.environ.get("BOOTSTRAP_ADMIN_EMAIL", ""))
    parser.add_argument("--password", default=os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", ""))
    parser.add_argument(
        "--update-password",
        action="store_true",
        help="Обновить пароль, если администратор с этим email уже существует",
    )
    args = parser.parse_args()

    email = args.email.strip().lower()
    password = args.password
    if not email or "@" not in email:
        _fail("укажите корректный email (--email или BOOTSTRAP_ADMIN_EMAIL)")
    if len(password) < MIN_PASSWORD_LEN:
        _fail(
            f"пароль короче {MIN_PASSWORD_LEN} символов "
            "(--password или BOOTSTRAP_ADMIN_PASSWORD)"
        )

    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, role FROM users WHERE lower(email) = ? AND COALESCE(is_deleted, 0) = 0",
            (email,),
        ).fetchone()

        if row is None:
            conn.execute(
                "INSERT INTO users (id, email, password_hash, role, created_at) "
                "VALUES (?, ?, ?, 'admin', ?)",
                (str(uuid4()), email, hash_password(password), datetime.now(UTC).isoformat()),
            )
            conn.commit()
            print(f"Администратор создан: {email}")
        elif str(row["role"]) != "admin":
            _fail(
                f"пользователь {email} уже существует с ролью «{row['role']}». "
                "Bootstrap не повышает роли — используйте раздел «Пользователи»."
            )
        elif args.update_password:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(password), str(row["id"])),
            )
            conn.commit()
            print(f"Пароль администратора обновлён: {email}")
        else:
            print(f"Администратор уже существует, без изменений: {email}")

        admins = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND COALESCE(is_deleted, 0) = 0"
        ).fetchone()["n"]
        print(f"Активных администраторов в системе: {admins}")


if __name__ == "__main__":
    main()
