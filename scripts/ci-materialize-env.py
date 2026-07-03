#!/usr/bin/env python3
"""Собрать env-файл деплоя из переменных окружения (секреты GitHub Actions)."""
from __future__ import annotations

import os
import pathlib
import sys
import urllib.parse


def _req(name: str) -> str:
    val = os.environ.get(name, "")
    if not val:
        print(f"ERROR: переменная окружения {name} не задана.", file=sys.stderr)
        sys.exit(1)
    return val


def _write_lines(path: pathlib.Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _verify_jwt(path: pathlib.Path) -> None:
    text = path.read_text(encoding="utf-8")
    jwt = next((line.split("=", 1)[1] for line in text.splitlines() if line.startswith("JWT_SECRET=")), "")
    if len(jwt) < 32:
        print("ERROR: JWT_SECRET missing or shorter than 32 characters.", file=sys.stderr)
        sys.exit(1)
    print(f"Staged env file OK (JWT_SECRET length {len(jwt)})")


def _cors_allow_origins() -> str:
    """CORS_ALLOW_ORIGINS: явный секрет, иначе origin из VITE_API_BASE_URL + мобильные.

    Мобильное приложение (Capacitor WebView) ходит с origin https://localhost /
    http://localhost — раньше их пропускал localhost-regex-fallback в app.py,
    теперь prod fail-closed и список должен быть явным.
    """
    explicit = os.environ.get("CORS_ALLOW_ORIGINS", "").strip()
    if explicit:
        return explicit
    api = _req("VITE_API_BASE_URL")
    parsed = urllib.parse.urlsplit(api)
    if not parsed.scheme or not parsed.netloc:
        print(
            "ERROR: не удалось вывести origin из VITE_API_BASE_URL "
            f"({api!r}); задайте секрет CORS_ALLOW_ORIGINS явно.",
            file=sys.stderr,
        )
        sys.exit(1)
    web_origin = f"{parsed.scheme}://{parsed.netloc}"
    origins = [web_origin, "https://localhost", "http://localhost"]
    return ",".join(dict.fromkeys(origins))


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: ci-materialize-env.py <test|prod> <output-path>", file=sys.stderr)
        sys.exit(2)

    kind = sys.argv[1]
    out = pathlib.Path(sys.argv[2])

    if kind == "test":
        jwt = _req("JWT_SECRET")
        if len(jwt) < 32:
            print("ERROR: JWT_SECRET короче 32 символов.", file=sys.stderr)
            sys.exit(1)
        _write_lines(
            out,
            [
                f"DATABASE_URL={_req('DATABASE_URL')}",
                f"POSTGRES_PASSWORD={_req('POSTGRES_PASSWORD')}",
                f"VITE_API_BASE_URL={_req('VITE_API_BASE_URL')}",
                f"JWT_SECRET={jwt}",
                f"CORS_ALLOW_ORIGINS={_cors_allow_origins()}",
            ],
        )
    elif kind == "prod":
        jwt = _req("JWT_SECRET")
        if len(jwt) < 32:
            print("ERROR: JWT_SECRET короче 32 символов.", file=sys.stderr)
            sys.exit(1)
        _write_lines(
            out,
            [
                f"POSTGRES_PASSWORD={_req('POSTGRES_PASSWORD')}",
                f"VITE_API_BASE_URL={_req('VITE_API_BASE_URL')}",
                f"JWT_SECRET={jwt}",
                f"CORS_ALLOW_ORIGINS={_cors_allow_origins()}",
            ],
        )
    else:
        print(f"ERROR: unknown kind {kind!r}", file=sys.stderr)
        sys.exit(2)

    _verify_jwt(out)


if __name__ == "__main__":
    main()
