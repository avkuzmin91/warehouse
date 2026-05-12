#!/usr/bin/env python3
"""
Нормализует строку DATABASE_URL в .env.test для деплоя в Docker Compose (сервис db, БД app_test).
Вызывается из GitHub Actions по SSH (см. deploy-environment.yml).
"""
from __future__ import annotations

import pathlib
import re
import sys


def _mask_url(u: str, maxlen: int = 120) -> str:
    s = u[:maxlen]
    s = re.sub(r"//([^:@/]+)(:([^@/]*))?@", r"//***:***@", s, count=1)
    return s + ("…" if len(u) > maxlen else "")


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: ci-normalize-database-url-test.py <path-to-.env.test>", file=sys.stderr)
        sys.exit(2)
    path = pathlib.Path(sys.argv[1])
    text = path.read_text(encoding="utf-8-sig")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
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
            out.append("DATABASE_URL=" + val)
        else:
            out.append(line)
    if not found:
        print("ERROR: DATABASE_URL= line missing in env file.", file=sys.stderr)
        sys.exit(1)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
