# Rate limiting: `/auth/login`, `/auth/refresh`

## `POST /auth/login` (Redis + по email)

При заданном **`REDIS_URL`** лимиты хранятся в **Redis** (атомарно, Lua: `INCR` + `EXPIRE` при первом обращении — фиксированное окно по ключу).

| Ключ Redis | Смысл |
|------------|--------|
| `rl:login:ip:<ip>` | Попытки с одного IP |
| `rl:login:user:<sha256_hex>` | Попытки для нормализованного email (`strip` + `lower`), в ключе только SHA-256 hex от UTF-8 строки email |

### Доверенный proxy и IP клиента

`TRUSTED_PROXIES` — список через запятую: одиночные IP, CIDR (`172.18.0.0/16`) или имя хоста непосредственного peer (как в `request.client.host`, например `nginx` в overlay-сети).

Логика: сначала `remote_addr` (peer соединения); если он **не** входит в список доверенных — заголовок `X-Forwarded-For` **игнорируется** и в rate limit попадает peer (защита от подделки XFF). Если peer доверенный — берётся **первый валидный IP** из цепочки XFF.

Реализация: `rate_limit/client_ip.py`, функция `client_ip_from_request` (используется и для `POST /auth/login`, и для `POST /auth/refresh`).

Если **`REDIS_URL` пуст** или **`AUTH_LOGIN_RL_REDIS_DISABLED=true`** — для login используется **in-memory** лимит **только по IP** (как раньше, скользящее окно по `AUTH_RATE_LIMIT_*`).

### Переменные окружения (login + Redis)

| Переменная | По умолчанию | Смысл |
|------------|--------------|--------|
| `TRUSTED_PROXIES` | — | Доверенные proxy: только тогда используется `X-Forwarded-For` (см. выше) |
| `REDIS_URL` | — | URL Redis, например `redis://127.0.0.1:6379/0` |
| `AUTH_LOGIN_RL_REDIS_DISABLED` | — | `1` / `true` — не подключаться к Redis, только in-memory по IP |
| `AUTH_LOGIN_RL_IP_MAX` | `10` | Макс. запросов login с одного IP за окно |
| `AUTH_LOGIN_RL_IP_WINDOW_SEC` | `60` | TTL окна для IP (сек) |
| `AUTH_LOGIN_RL_EMAIL_MAX` | `8` | Макс. попыток на один email за окно (targeted brute-force) |
| `AUTH_LOGIN_RL_EMAIL_WINDOW_SEC` | `600` | TTL окна для email (сек), по умолчанию 10 мин |
| `AUTH_LOGIN_RL_MAX_BODY_BYTES` | `32768` | Макс. размер тела POST для разбора JSON (превышение → **429**) |
| `AUTH_LOGIN_RL_FAIL_CLOSED` | — | `1` / `true` — при ошибке Redis вернуть **503** вместо fallback |
| `AUTH_LOGIN_RL_REDIS_SOCKET_CONNECT_TIMEOUT_SEC` | `2` | Таймаут установки TCP к Redis (сек); без него при «мёртвом» хосте login может висеть очень долго |
| `AUTH_LOGIN_RL_REDIS_SOCKET_TIMEOUT_SEC` | `2` | Таймаут ответа Redis на команду (сек) |
| `AUTH_LOGIN_RL_REDIS_CLOSE_TIMEOUT_SEC` | `3` | Таймаут `aclose()` клиента Redis (сек); иначе при сбое пула запрос мог «висеть» в middleware |

**Пакет `redis`:** в `requirements.txt` указан `redis>=5.0`; после добавления зависимости нужен **`docker compose … build --no-cache backend`**. Импорт в `rate_limit/login_rate_limit.py` **отложен**: при отсутствии пакета приложение всё равно стартует, а при заданном `REDIS_URL` лимит login уходит в in-memory по IP (в лог — `redis_import_error`).

**Ошибка `LoginResponse`:** в текущем дереве `main.py` для login/change-password используется только **`AuthTokenResponse`**. Если у вас в логе `NameError: LoginResponse`, проверьте **несохранённые правки / другую ветку** и приведите декораторы к `AuthTokenResponse`.

### Ответ при превышении лимита (login)

`429 Too Many Requests`, тело:

```json
{"message": "Too many login attempts. Please try again later."}
```

Слишком большое тело запроса (выше `AUTH_LOGIN_RL_MAX_BODY_BYTES`) также даёт **429** с тем же телом (защита от злоупотребления).

Логи (`warehouse.auth`): одна JSON-строка на событие, поле `"event":"auth_rate_limit"` (типы: `ip`, `email`, `body_size`, `ip_memory`, `redis_error`, `redis_fallback`). При ошибке Redis в лог пишется та же структура с `exc_info` (трассировка).

Метрика при fail-open после ошибки Redis (in-memory fallback по IP): **`auth_rl_redis_fallback_total`** — счётчик `prometheus_client`, если пакет установлен; иначе in-process счётчик в `rate_limit/metrics.py` (для тестов и простого мониторинга).

---

## `POST /auth/refresh` (in-memory, per IP)

Без Redis: счётчик в памяти процесса; IP определяется так же, как для login (`client_ip_from_request` и `TRUSTED_PROXIES`).

| Переменная | По умолчанию | Смысл |
|------------|--------------|--------|
| `AUTH_RATE_LIMIT_REFRESH_MAX` | `60` | Макс. запросов за окно |
| `AUTH_RATE_LIMIT_REFRESH_WINDOW_SEC` | `60` | Окно (сек), скользящее по `time.monotonic()` |

Ответ при превышении: `429`, тело `{"detail":"Too many requests"}`.

---

## Smoke (login → 429)

Сервер должен слушать тот же URL, что и в `SMOKE_AUTH_URL` (прямой uvicorn — без `/api`; через Vite — `http://127.0.0.1:5173/api/auth/login`).

С Redis задайте низкий лимит, например:

```bash
export REDIS_URL=redis://127.0.0.1:6379/0
export AUTH_LOGIN_RL_IP_MAX=5
export SMOKE_AUTH_URL=http://127.0.0.1:8000/auth/login
python backend/scripts/auth_rate_limit_smoke.py
```

Ожидание: среди ответов появится **429** с полем `message`.

Контракты успешного login/refresh, cookie и bootstrap **не меняются**.
