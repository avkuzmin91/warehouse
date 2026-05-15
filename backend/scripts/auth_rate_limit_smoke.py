#!/usr/bin/env python3
"""Hammer /auth/login (or /api/auth/login) until 429; exit 0 on first 429, 1 if not seen."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("SMOKE_AUTH_URL", "http://127.0.0.1:8000/auth/login")
N = int(os.environ.get("SMOKE_N", "40"))
BODY = json.dumps({"email": "ratelimit-smoke@example.com", "password": "wrong-password"}).encode("utf-8")


def main() -> int:
    for i in range(N):
        req = urllib.request.Request(
            URL,
            data=BODY,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(i, resp.status)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:200]
            print(i, e.code, body)
            if e.code == 429:
                return 0
    print("no 429 within", N, "requests", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
