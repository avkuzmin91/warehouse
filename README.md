# Warehouse (WMS)

## 1. Architecture overview

**Ingress:** один **nginx на хосте**, конфиг из репозитория — **`nginx/nginx.conf`**. Без edge-контейнера и без Docker DNS в `proxy_pass` (только **`127.0.0.1:порт`**).

**Compose:** `docker-compose.prod.yml`, `docker-compose.test.yml`, `docker-compose.dev.yml` — у каждого файла своё **`name:`** (`wms-prod`, `wms-test`, `wms-dev`), чтобы проект не совпал с именем каталога (`wms-prod`) и не пересёкся с другим окружением.

**Публикация портов:** только **`"127.0.0.1:<host>:<container>"`** в compose; наружу — nginx **80/443** или SSH-туннель.

### Контракт портов (зафиксировано)

| Окружение | Backend (loopback) | Frontend (loopback) | Примечание |
|-----------|--------------------|---------------------|------------|
| **prod** | **10000** | **10080** | Статика после `npm run build` в Docker |
| **test** | **11000** | **11080** | Как prod, другие env/том |
| **dev** | **8000** | **5173** | Backend в Docker + bind mount **`./backend:/app`**; UI — **Vite на хосте** (`npm run dev`). Сервиса `frontend` в `docker-compose.dev.yml` нет (не добавлять без ADR — путаница портов, HMR, `/api`). |

**Postgres (loopback, миграции / отладка с хоста):**

| Окружение | Postgres |
|-----------|----------|
| test | **5434** |
| dev | **5435** |
| Legacy `docker-compose.yml` | **5432** |

**БД:** одно runtime-окружение — один экземпляр Postgres и один том; не смешивать prod/test/dev.

| Compose | БД в контейнере | Том | Назначение |
|---------|-----------------|-----|------------|
| `docker-compose.prod.yml` | `app` (см. env) | `db_data` | Production |
| `docker-compose.test.yml` | `app_test` | `db_test_data` | Staging / test |
| `docker-compose.dev.yml` | `app` | `db_data_dev` | Development |
| `docker-compose.yml` (legacy) | `wms` | `postgres_data` | Не prod |

В **`DATABASE_URL`** хост `db` и имя БД должны совпадать с **`POSTGRES_DB`** / сервисом **`db`** **этого же** compose. Миграции — только против нужной БД.

**Запуск стеков на сервере:**

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.dev.yml up -d --build
```

Подключите **`nginx/nginx.conf`** к системному nginx. После правок: **`sudo nginx -t && sudo systemctl reload nginx`** (или **`sudo nginx -s reload`**, если unit не используется).

**API:** префикс **`/api`** снимает nginx (или Vite в dev). FastAPI **без `root_path`**. Фронт: **`API_BASE_URL=/api`**.

### Cloudflare и кэш

- DNS на IP сервера → **80/443** → nginx → loopback → контейнеры.
- В **`nginx/nginx.conf`:** HTML и **API** — без кэша на границе; **`/assets/*`** (хэш в имени Vite) — **`immutable`**.
- Если боевой домен «старый» после выкладки: **Purge Cache** в Cloudflare (например Custom Purge для `https://pack-men.ru/` и `https://www.pack-men.ru/`).
- Браузер: при проверке после релиза — **жёсткое обновление** (**Ctrl+F5** / **Cmd+Shift+R**) или инкогнито.

### Non-goals (вне скоупа репозитория)

| Non-goal | Почему |
|----------|--------|
| **Docker DNS как runtime-маршрутизация** | Ingress — host nginx + **`127.0.0.1:порт`**. |
| **Отдельный edge nginx-контейнер** | Лишняя связность и порядок запуска. |
| **K8s / service mesh** | Один VPS, Compose, фиксированные порты. |
| **`root_path` в FastAPI под `/api`** | Префикс снимает только nginx и Vite в dev. |

Расширения (второй регион, K8s и т.д.) — отдельный ADR, не «тихое» наращивание этого README.

---

## 2. Local-first model

- **Разработка** — прежде всего **локальный ПК**: клон, правки, **`docker-compose.dev.yml`** + **`npm run dev`** (Vite).
- **Source of truth** — **GitHub**, ветка **`main`**; на VPS после **`git push`** попадает только то, что в удалённом репозитории.
- **VPS** — **test / prod** (и при необходимости dev на сервере), только **`scripts/deploy.sh`**; не считать SSH на сервере основным местом **повседневных** правок.

**Dev vs test/prod (один раз):** в dev compose **`./backend:/app`** — в контейнере выполняется **то, что в рабочем дереве на машине, где запущен compose**, до **`git push`**. UI — Vite на хосте, не образ prod/test. **Test и prod** на сервере: **`git pull --ff-only origin main`**, чистое дерево, образы из **`main`**.

**Цикл:** локально dev → **`git commit`** → **`git push origin main`** → **`deploy-test`** → проверка → **`deploy-prod`** или **`deploy-promote`**. **`deploy-test`** / **`deploy-prod`** — после того, как коммиты уже в **`main`** на GitHub.

**Релизы:** после зелёного **`deploy-test`** явно **`deploy-promote`** или **`deploy-prod`**; в логах деплоя сверять **одинаковый SHA** после `pull`.

---

## 3. Local development (PC)

Нужны **Docker**, **Node.js 20+**, **npm**. Backend на хосте здесь не описан.

### Установка Node.js (пример для Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

### Quickstart (локально)

Из корня клона репозитория:

```bash
cp .env.dev.example .env.dev
docker compose -f docker-compose.dev.yml up -d
cd frontend && npm install && npm run dev
```

**После этого:**

- API: **`127.0.0.1:8000`**; Vite: **`/api`** → **`http://127.0.0.1:8000`** (`frontend/vite.config.ts`).
- Smoke: `curl -fsS http://127.0.0.1:8000/health`
- **Alembic** (корень репо, `alembic.ini`): **`DATABASE_URL`** на dev-Postgres с хоста — комментарий в **`.env.dev.example`** (порт **5435**), затем **`alembic upgrade head`**.
- Hot reload: backend **`--reload`** в compose; фронт — HMR Vite.

Через nginx на **`dev.pack-men.ru`** нужен **`server.allowedHosts`** в Vite — иначе возможен **403**.

---

## 4. Deploy system

**Единственная поддерживаемая выкладка:** **`/app/wms-prod/scripts/deploy.sh`**

Порядок: `cd` в репозиторий → краткий **`git status`** → **чистое дерево** (см. **Deploy safety rules**) → **`git fetch`** + **`git pull --ff-only origin main`** (не при грязном дереве и не в **`--dry-run`**) → **`APP_VERSION`** из **`git describe --tags --always`** (если не задан в окружении) → доступ к Docker API → **`docker compose -f docker-compose.<env>.yml config`** → **`docker compose … up -d --build --pull always`** → ожидание **`/health`** на loopback backend (до 30 с) → **smoke через host nginx** → **`docker compose ps`** и успех. После pull в лог — **SHA** (`git rev-parse HEAD`, **`git log -1`**).

### Версия и теги

- **`GET /version`:** **`APP_VERSION`** → **`git describe`** на диске репо → **`1.0.1`**.
- **`deploy.sh`** перед compose выставляет **`APP_VERSION`** из **`git describe`**, если не задан; в контейнере **`.git`** не нужен.
- Релиз: **`git tag v1.0.2`**, **`git push origin v1.0.2`**, деплой на нужный коммит (или merge в **`main`** + тег).

**Dry-run:** **`/app/wms-prod/scripts/deploy.sh <env> --dry-run`** (или **`--dry-run`** перед `<env>`) — без pull, без up, без smoke; проверка дерева, Docker, **`docker compose config`**.

**Алиасы** (после `source ~/.bashrc` на сервере):

- **`deploy-prod`** — `/app/wms-prod/scripts/deploy.sh prod`
- **`deploy-test`** — `/app/wms-prod/scripts/deploy.sh test`
- **`deploy-dev`** — `/app/wms-prod/scripts/deploy.sh dev`
- **`deploy-promote`** — `/app/wms-prod/scripts/deploy-promote.sh` — подряд **test**, затем **prod**.

Если prod «отстаёт» при проверенном test: не запускали **`deploy-prod`**, кэш браузера/CDN, или деплой prod упал — смотреть лог скрипта и **`docker compose ps`**.

При **провале smoke:** **`docker compose ps`** и **`logs --tail=50`** backend + frontend (**dev** — без логов frontend). При **таймауте `/health`:** **`ps`** и логи **только backend**.

**Смоук deploy.sh:** финальный ответ после редиректов nginx — **prod/test:** `curl -fsSL`; **dev:** `curl -fsSLk` при HTTPS на vhost (детали в комментариях **`scripts/deploy.sh`**). Ручные проверки — те же команды, что в **Smoke-check** ниже.

Ошибка на любом шаге — **ненулевой exit**; контейнеры и тома **не** откатываются автоматически. Нужен **`docker`** без sudo (пользователь в группе **`docker`**).

### Deploy safety rules

- Только **`scripts/deploy.sh`** / алиасы **`deploy-*`** / **`scripts/deploy-promote.sh`**.
- Дерево **чистое**; из untracked допустимы: **`.env*`**, **`logs/`**, **`__pycache__`**, **`.pytest_cache/`**.
- **Rollback** — вручную; скрипт **не** откатывает образы, **не** делает **`compose down`**, **не** трогает **volumes**. **Без `sudo`**.
- Рекомендуемый порядок: сначала **test**, затем **prod** после проверки staging — **`deploy-promote`** (`scripts/deploy-promote.sh`).

### Git: `fatal: detected dubious ownership` в `/app/wms-prod`

Запускайте **`git pull`** и **`deploy.sh`** от пользователя **`dev`** (не от root после `sudo su`). От root один раз:

```bash
git config --global --add safe.directory /app/wms-prod
```

### Smoke-check (после reload nginx и поднятых стеков)

Те же проверки, что использует deploy: **liveness** и **`/api/docs`** через тот же вход, что пользователи (кроме прямого curl к backend).

**Через nginx** (для test/dev на **`127.0.0.1`** нужен заголовок **`Host`**):

**Production** (`localhost` в `server_name`):

```bash
curl -fsSL http://localhost/health
curl -fsSL -o /dev/null -w "%{http_code}\n" http://localhost/api/docs
```

**Test** (`test.pack-men.ru`):

```bash
curl -fsSL -H "Host: test.pack-men.ru" http://127.0.0.1/health
curl -fsSL -o /dev/null -w "%{http_code}\n" -H "Host: test.pack-men.ru" http://127.0.0.1/api/docs
```

**Dev** (нужен Vite на **5173** для `/`):

```bash
curl -fsSLk -H "Host: dev.pack-men.ru" http://127.0.0.1/health
curl -fsSLk -o /dev/null -w "%{http_code}\n" -H "Host: dev.pack-men.ru" http://127.0.0.1/api/docs
```

**Напрямую на backend:**

```bash
curl -fsS http://127.0.0.1:10000/health   # prod
curl -fsS http://127.0.0.1:11000/health   # test
curl -fsS http://127.0.0.1:8000/health   # dev
```

Ожидается **`/health`:** HTTP **200**, JSON с **`"status":"ok"`**; **`/api/docs`:** **200** (HTML).
