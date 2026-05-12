#!/usr/bin/env python3
"""
Нормализует .env.test для деплоя в Docker Compose (сервис db, БД app_test).

- DATABASE_URL: хост/порт/имя БД под стек test (см. ниже).
- Если в файле есть строка POSTGRES_PASSWORD=…, пароль из неё подставляется в userinfo
  DATABASE_URL (чтобы совпадал с паролем контейнера db из compose).
Вызывается из GitHub Actions по SSH (см. deploy-environment.yml).
"""
from __future__ import annotations

import pathlib
import re
import sys
from urllib.parse import quote, urlparse, urlunparse


def _mask_url(u: str, maxlen: int = 120) -> str:
    s = u[:maxlen]
    s = re.sub(r"//([^:@/]+)(:([^@/]*))?@", r"//***:***@", s, count=1)
    return s + ("…" if len(u) > maxlen else "")


def _strip_env_value(raw: str) -> str:
    val = raw.strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    return val.strip()


def _extract_postgres_password(lines: list[str]) -> str | None:
    for line in lines:
        if line.startswith("POSTGRES_PASSWORD="):
            v = _strip_env_value(line.split("=", 1)[1])
            return v or None
    return None


def _sync_database_url_password(url: str, password: str) -> str:
    """Подставить пароль из POSTGRES_PASSWORD= в userinfo DATABASE_URL (после нормализации хоста/БД)."""
    p = urlparse(url)
    user = p.username or "postgres"
    host = p.hostname
    if not host:
        return url
    port = p.port
    user_q = quote(user, safe="")
    pw_q = quote(password, safe="")
    if port is not None:
        netloc = f"{user_q}:{pw_q}@{host}:{port}"
    else:
        netloc = f"{user_q}:{pw_q}@{host}"
    return urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: ci-normalize-database-url-test.py <path-to-.env.test>", file=sys.stderr)
        sys.exit(2)
    path = pathlib.Path(sys.argv[1])
    text = path.read_text(encoding="utf-8-sig")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sync_pw = _extract_postgres_password(lines)
    out: list[str] = []
    found = False
    for line in lines:
        if line.startswith("DATABASE_URL="):
            found = True
            raw = line.split("=", 1)[1].strip()
            if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
                raw = raw[1:-1]
            val = raw.strip()

            val = re.sub(r"(?i)@wms_prod_db:", "@db:", val)
            val = re.sub(r"(?i)@wms_test_db:", "@db:", val)
            val = re.sub(r"(?i)@wms_prod_db/", "@db:5432/", val)
            val = re.sub(r"(?i)@wms_test_db/", "@db:5432/", val)
            val = re.sub(r"(?i)@127\.0\.0\.1:\d+/", "@db:5432/", val)
            val = re.sub(r"(?i)@localhost:\d+/", "@db:5432/", val)
            val = re.sub(r"(?i)(@db:\d+/)(app)(?=[?#]|$)", r"\1app_test", val)
            val = re.sub(r"(?i)@db/app(?=[?#]|$)", "@db:5432/app_test", val)

            if re.search(r"(?i)wms_(?:prod|test)_db", val):
                print("ERROR: DATABASE_URL still references wms_*_db host after normalize.", file=sys.stderr)
                print("hint:", _mask_url(val), file=sys.stderr)
                sys.exit(1)
            if not re.search(r"(?i)@[dD][bB](?::[0-9]+)?/app_test", val):
                print(
                    "ERROR: DATABASE_URL must use host db and database app_test, e.g. "
                    "postgresql://postgres:postgres@db:5432/app_test",
                    file=sys.stderr,
                )
                print("hint:", _mask_url(val), file=sys.stderr)
                sys.exit(1)
            if sync_pw is not None:
                val = _sync_database_url_password(val, sync_pw)
            out.append("DATABASE_URL=" + val)
        else:
            out.append(line)
    if not found:
        print("ERROR: DATABASE_URL= line missing in env file.", file=sys.stderr)
        sys.exit(1)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
