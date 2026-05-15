# Rate limiting: `/auth/login`, `/auth/refresh`

In-memory, per client IP (первый адрес из `X-Forwarded-For`, иначе `request.client.host`).

Лимит применяется **HTTP-middleware** для `POST /auth/login` и `POST /auth/refresh`: счётчик срабатывает **до** разбора тела и валидации Pydantic (в т.ч. при частых 422).

## Переменные окружения (опционально)

| Переменная | По умолчанию | Смысл |
|------------|--------------|--------|
| `AUTH_RATE_LIMIT_LOGIN_MAX` | `20` | Макс. запросов за окно |
| `AUTH_RATE_LIMIT_LOGIN_WINDOW_SEC` | `60` | Окно (сек), скользящее по `time.monotonic()` |
| `AUTH_RATE_LIMIT_REFRESH_MAX` | `60` | То же для refresh |
| `AUTH_RATE_LIMIT_REFRESH_WINDOW_SEC` | `60` | Окно для refresh |

Для быстрой проверки 429: например `AUTH_RATE_LIMIT_LOGIN_MAX=5` и подряд >5 POST на `/auth/login`.

## Ответ при превышении

`429 Too Many Requests`, тело: `{"detail":"Too many requests"}` (как у остальных `HTTPException`).

## Smoke (пример)

Сервер должен слушать тот же URL, что и в `SMOKE_AUTH_URL` (прямой uvicorn — без `/api`; через Vite — `http://127.0.0.1:5173/api/auth/login`).

```bash
export AUTH_RATE_LIMIT_LOGIN_MAX=5
export SMOKE_AUTH_URL=http://127.0.0.1:8000/auth/login
python backend/scripts/auth_rate_limit_smoke.py
```

Ожидание: среди ответов появится **429**.

Контракты успешного login/refresh, cookie и bootstrap **не меняются**.
