"""HTTP-клиенты Ozon Seller API и WB Marketplace API.

Единственное место проекта, знающее URL и форматы API маркетплейсов: при смене
версии метода МП правится только этот файл. Все функции — синхронные (воркер
вызывает их через asyncio.to_thread), сеть — httpx.

Ключи продавцов в логи не пишутся никогда; логгер wms.mp получает только
счётчики, номера заказов и тексты ошибок МП.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

log = logging.getLogger("wms.mp")

OZON_BASE = "https://api-seller.ozon.ru"
WB_MARKETPLACE_BASE = "https://marketplace-api.wildberries.ru"
WB_CONTENT_BASE = "https://content-api.wildberries.ru"
WB_MARKETPLACE_SANDBOX_BASE = "https://marketplace-api-sandbox.wildberries.ru"
WB_CONTENT_SANDBOX_BASE = "https://content-api-sandbox.wildberries.ru"

_TIMEOUT = 30.0
_RETRIES = 3
_PAGE_PAUSE = 0.5  # лимиты обоих МП: пауза между постраничными запросами


class MpApiError(Exception):
    """Нормализованная ошибка API маркетплейса."""

    def __init__(self, message: str, *, retriable: bool = False):
        super().__init__(message)
        self.retriable = retriable


def _request(method: str, url: str, *, headers: dict, json_body: Any | None = None) -> Any:
    """Запрос с повторами на 429/5xx/сетевых сбоях. Возвращает разобранный JSON."""
    last_error: str = "нет ответа"
    for attempt in range(1, _RETRIES + 1):
        try:
            resp = httpx.request(method, url, headers=headers, json=json_body, timeout=_TIMEOUT)
        except httpx.HTTPError as exc:
            last_error = f"сетевая ошибка: {type(exc).__name__}"
            if attempt < _RETRIES:
                time.sleep(attempt)
                continue
            raise MpApiError(last_error, retriable=True) from exc
        if resp.status_code == 429 or resp.status_code >= 500:
            last_error = f"HTTP {resp.status_code}"
            if attempt < _RETRIES:
                time.sleep(attempt)
                continue
            raise MpApiError(f"Маркетплейс недоступен ({last_error})", retriable=True)
        if resp.status_code in (401, 403):
            raise MpApiError("Неверный API-ключ или нет доступа (HTTP %d)" % resp.status_code)
        if resp.status_code >= 400:
            detail = ""
            try:
                body = resp.json()
                detail = str(body.get("message") or body.get("error") or "")[:200]
            except Exception:
                pass
            raise MpApiError(f"Ошибка запроса (HTTP {resp.status_code}): {detail or 'без деталей'}")
        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise MpApiError("Некорректный ответ маркетплейса (не JSON)") from exc
    raise MpApiError(last_error, retriable=True)


# ── Ozon Seller API ───────────────────────────────────────────────────────────

def _ozon_headers(creds: dict) -> dict:
    return {
        "Client-Id": str(creds["ozon_client_id"] or ""),
        "Api-Key": str(creds["api_key"] or ""),
    }


def ozon_check(creds: dict) -> None:
    """Дешёвый вызов для проверки связи: список FBS-складов продавца."""
    _request("POST", f"{OZON_BASE}/v1/warehouse/list", headers=_ozon_headers(creds), json_body={})


def ozon_fetch_products(creds: dict) -> list[dict]:
    """Все карточки продавца: /v3/product/list (id+offer_id) → /v3/product/info/list (ШК, название)."""
    headers = _ozon_headers(creds)
    refs: list[dict] = []
    last_id = ""
    while True:
        data = _request(
            "POST", f"{OZON_BASE}/v3/product/list", headers=headers,
            json_body={"filter": {"visibility": "ALL"}, "last_id": last_id, "limit": 1000},
        )
        result = (data or {}).get("result") or {}
        items = result.get("items") or []
        refs.extend(items)
        last_id = str(result.get("last_id") or "")
        if not last_id or not items:
            break
        time.sleep(_PAGE_PAUSE)

    products: list[dict] = []
    for i in range(0, len(refs), 1000):
        chunk_ids = [int(r["product_id"]) for r in refs[i:i + 1000] if r.get("product_id")]
        if not chunk_ids:
            continue
        data = _request(
            "POST", f"{OZON_BASE}/v3/product/info/list", headers=headers,
            json_body={"product_id": chunk_ids},
        )
        items = (data or {}).get("items") or ((data or {}).get("result") or {}).get("items") or []
        products.extend(items)
        if i + 1000 < len(refs):
            time.sleep(_PAGE_PAUSE)
    return products


def ozon_fetch_open_postings(creds: dict) -> list[dict]:
    """Необработанные FBS-отправления (ждут сборки/отгрузки)."""
    headers = _ozon_headers(creds)
    postings: list[dict] = []
    offset = 0
    while True:
        data = _request(
            "POST", f"{OZON_BASE}/v3/posting/fbs/unfulfilled/list", headers=headers,
            json_body={"dir": "ASC", "filter": {}, "limit": 1000, "offset": offset},
        )
        result = (data or {}).get("result") or {}
        items = result.get("postings") or []
        postings.extend(items)
        if len(items) < 1000:
            break
        offset += 1000
        time.sleep(_PAGE_PAUSE)
    return postings


def ozon_fetch_postings(creds: dict, external_ids: list[str]) -> list[dict]:
    """Актуальное состояние известных отправлений (по одному: /v3/posting/fbs/get)."""
    headers = _ozon_headers(creds)
    postings: list[dict] = []
    for idx, posting_number in enumerate(external_ids):
        try:
            data = _request(
                "POST", f"{OZON_BASE}/v3/posting/fbs/get", headers=headers,
                json_body={"posting_number": posting_number},
            )
        except MpApiError as exc:
            if exc.retriable:
                raise
            # Заказ мог быть удалён/недоступен — пропускаем, остальные важнее.
            log.warning("Ozon: отправление %s недоступно: %s", posting_number, exc)
            continue
        result = (data or {}).get("result")
        if result:
            postings.append(result)
        if idx + 1 < len(external_ids):
            time.sleep(_PAGE_PAUSE)
    return postings


# ── WB Marketplace API ────────────────────────────────────────────────────────

def _wb_headers(creds: dict) -> dict:
    return {"Authorization": str(creds["api_key"] or "")}


def _wb_marketplace(creds: dict) -> str:
    return WB_MARKETPLACE_SANDBOX_BASE if creds.get("is_sandbox") else WB_MARKETPLACE_BASE


def _wb_content(creds: dict) -> str:
    return WB_CONTENT_SANDBOX_BASE if creds.get("is_sandbox") else WB_CONTENT_BASE


def wb_check(creds: dict) -> None:
    _request("GET", f"{_wb_marketplace(creds)}/ping", headers=_wb_headers(creds))


def wb_fetch_cards(creds: dict) -> list[dict]:
    """Все карточки продавца (Content API, курсорная пагинация)."""
    headers = _wb_headers(creds)
    cards: list[dict] = []
    cursor: dict = {"limit": 100}
    while True:
        data = _request(
            "POST", f"{_wb_content(creds)}/content/v2/get/cards/list", headers=headers,
            json_body={"settings": {"cursor": cursor, "filter": {"withPhoto": -1}}},
        )
        items = (data or {}).get("cards") or []
        cards.extend(items)
        resp_cursor = (data or {}).get("cursor") or {}
        total = int(resp_cursor.get("total") or 0)
        if total < int(cursor.get("limit") or 100):
            break
        cursor = {
            "limit": 100,
            "updatedAt": resp_cursor.get("updatedAt"),
            "nmID": resp_cursor.get("nmID"),
        }
        time.sleep(_PAGE_PAUSE)
    return cards


def wb_fetch_new_orders(creds: dict) -> list[dict]:
    """Новые сборочные задания (ещё не взятые в работу)."""
    data = _request("GET", f"{_wb_marketplace(creds)}/api/v3/orders/new", headers=_wb_headers(creds))
    return (data or {}).get("orders") or []


def wb_fetch_order_statuses(creds: dict, external_ids: list[int]) -> list[dict]:
    """Статусы известных сборочных заданий (supplierStatus + wbStatus), батчами по 1000."""
    headers = _wb_headers(creds)
    statuses: list[dict] = []
    for i in range(0, len(external_ids), 1000):
        chunk = external_ids[i:i + 1000]
        data = _request(
            "POST", f"{_wb_marketplace(creds)}/api/v3/orders/status", headers=headers,
            json_body={"orders": chunk},
        )
        statuses.extend((data or {}).get("orders") or [])
        if i + 1000 < len(external_ids):
            time.sleep(_PAGE_PAUSE)
    return statuses
