#!/usr/bin/env python3
"""Проверить, что в env-файле есть JWT_SECRET длиной ≥ 32 символов."""
from __future__ import annotations

import pathlib
import sys


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: ci-verify-jwt-in-env.py <path-to-env-file>", file=sys.stderr)
        sys.exit(2)
    text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig")
    jwt = next((line.split("=", 1)[1] for line in text.splitlines() if line.startswith("JWT_SECRET=")), "")
    if len(jwt) < 32:
        print("ERROR: JWT_SECRET missing or shorter than 32 characters.", file=sys.stderr)
        sys.exit(1)
    print(f"JWT_SECRET OK (length {len(jwt)})")


if __name__ == "__main__":
    main()
