"""Структурированные JSON-строки в лог (event=auth_rate_limit)."""

from __future__ import annotations

import json
import logging
from typing import Any


def log_auth_rate_limit(
    logger: logging.Logger,
    level: int,
    fields: dict[str, Any],
    *,
    exc_info: Any = None,
) -> None:
    payload = {"event": "auth_rate_limit", **fields}
    logger.log(
        level,
        "%s",
        json.dumps(payload, ensure_ascii=False, default=str),
        exc_info=exc_info,
    )
