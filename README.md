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

Каноническая модель деплоя test/prod — **[ADR 0001](docs/adr/0001-ci-only-deployment-via-github-actions.md)** (CI-only).

- **Разработка** — прежде всего **локальный ПК**: клон, правки, **`docker-compose.dev.yml`** + **`npm run dev`** (Vite).
- **Source of truth** — **GitHub**: **`develop`** (интеграция), **`main`** (продакшен). На test/prod попадает только то, что успешно прошло **Deploy** в Actions (зафиксируйте **SHA** в логах).
- **Штатный деплой** — только **GitHub Actions** (см. **§4**). **`scripts/deploy.sh`** — **не** релизный путь; только **emergency / диагностика** (см. ADR и **§4**).

**Dev vs test/prod:** в dev compose **`./backend:/app`** — в контейнере то, что в рабочем дереве до **`git push`**. UI — Vite на хосте. Test/prod на сервере: дерево с раннера доставляется **rsync** в каталог приложения и поднимается **одним и тем же** пайплайном: env-файл → **`docker compose --env-file … -f … up -d --build`** → **health gate** на loopback backend.

**Цикл:** локально → **`git push origin develop`** → workflow **Deploy** (Environment **`test`**) → проверка staging → merge в **`main`** → **`git push origin main`** → **Deploy** (Environment **`production`**).

**Релизы / откат:** успешный **Deploy** и совпадение **SHA** с ожидаемым; откат — **workflow_dispatch** с ref на известный good **SHA** или **тег** (§4). Теги на коммитах — для учёта версий; штатная выкладка остаётся через ветки или dispatch.

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

Канон: **[ADR 0001](docs/adr/0001-ci-only-deployment-via-github-actions.md)**.

### Штатный деплой (GitHub Actions)

Один входной workflow **`deploy.yml`** вызывает reusable **`deploy-environment.yml`**. Логика test и prod **одинаковая**: checkout → **rsync** репозитория на сервер → запись env-файла из секретов → для **test** нормализация **`DATABASE_URL`** скриптом **`scripts/ci-normalize-database-url-test.py`** → **`docker compose --env-file … -f … up -d --build`** → **health gate** (до 30 с, `127.0.0.1` и порт backend по контракту README: test **11000**, prod **10000**).

| Триггер | GitHub Environment | Checkout ref по умолчанию |
|---------|--------------------|---------------------------|
| `push` в **`develop`** | **`test`** | SHA текущего коммита |
| `push` в **`main`** | **`production`** | SHA текущего коммита |

Каталоги на сервере (см. `deploy.yml`): test **`/var/www/app-test`**, prod **`/var/www/app-prod`**. Файлы compose: **`docker-compose.test.yml`**, **`docker-compose.prod.yml`**.

В reusable задан **`concurrency`** на имя Environment — параллельные деплои в одно окружение сериализуются.

### GitHub Environments и секреты

Создайте в репозитории окружения с именами **`test`** и **`production`** (как в `deploy.yml`). Если в Environment **нет** своих секретов, job всё равно видит **репозиторные** секреты — пустая страница *Environment secrets* сама по себе не ошибка. Для изоляции test/prod можно продублировать секреты на каждый Environment; **секрет с тем же именем на Environment перекрывает репозиторный** — пустое значение там даст пустую подстановку и ошибку БД (`fe_sendauth: no password supplied`). См. [Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment).

| Секрет | `test` | `production` |
|--------|--------|----------------|
| `SSH_HOST` | да | да |
| `SSH_USER` | да | да |
| `SSH_PRIVATE_KEY` | да (желательно отдельный ключ) | да |
| `DATABASE_URL` | да (см. **`.env.test.example`**). На сервере CI приводит URL к **`...@db:5432/app_test`** (`scripts/ci-normalize-database-url-test.py`: `wms_*_db`, `127.0.0.1`/`localhost`, `/app` → test-стек). Лучше задать канон в секрете. | — |
| `POSTGRES_PASSWORD` | опционально: если задан в GitHub, CI может писать его в `.env.test` для compose (иначе в compose используется **`postgres`**) | **да** для prod: секрет **`POSTGRES_PASSWORD`**; если он пуст, CI подставляет **`POSTGRES_PASSWORD_TEST`** (fallback — только если пароль совпадает с данными prod-Postgres; см. **`.env.prod.example`**) |
| `VITE_API_BASE_URL` | да | да |

Опционально: для **`production`** включите **Required reviewers** / wait timer в настройках Environment.

### Prod: `password authentication failed for user "postgres"`

Пароль в **`.env.prod`** (секреты **`POSTGRES_PASSWORD`** или fallback **`POSTGRES_PASSWORD_TEST`**) должен совпадать с паролем, с которым **изначально** инициализирован кластер в Docker-томе **`db_data`** (`docker-compose.prod.yml`). Если prod-БД когда-то поднималась с другим значением — либо выставите в GitHub тот же пароль, либо один раз смените пароль у `postgres` внутри контейнера БД под секрет (без смены тома данные сохраняются).

### Rollback и повторный деплой

**Actions** → **Deploy** → **Run workflow** → выберите **`test`** или **`production`**, в **`git_ref`** укажите **SHA**, **тег** или **ветку** известного good (пусто = по умолчанию **`develop`** или **`main`**). После успеха сверьте SHA в логе шага **Resolve deployed commit**.

### Миграции БД

Схема БД должна соответствовать выкатанному коду (ADR 0001). Явный шаг миграций в CI не зафиксирован в этом README — добавьте его в **`deploy-environment.yml`**, когда утвердите порядок (например `alembic upgrade head` в backend-контейнере).

### Emergency (`deploy.sh`, клон на VPS)

**`scripts/deploy.sh`** и алиасы **`deploy-*`**, **`deploy-promote`** — только **аварийный** и диагностический контур для клона в **`/app/wms-prod`** (git, compose, smoke через nginx). **Не** использовать для штатного релиза. После emergency приведите состояние в соответствие с репозиторием и зафиксируйте инцидент.

Порядок шагов, **`--dry-run`**, чистое дерево, smoke — в **`scripts/deploy.sh`** и комментариях внутри.

### Версия и теги

- **CI:** на сервер передаётся **`APP_VERSION`** = полный SHA выкладки (после checkout на раннере).
- **`GET /version`:** значение **`APP_VERSION`** в контейнере; при запуске **`deploy.sh`** — **`git describe`**, если переменная не задана.
- Теги: **`git tag`**, **`git push origin <tag>`** — учёт версий; выкладка остаётся через **`develop`** / **`main`** или **workflow_dispatch**.

### Deploy safety rules

- Штатная новая версия на test/prod — **только** **`deploy.yml`** / **`deploy-environment.yml`**. Не обходить их произвольным **`docker compose`** «с ноги».
- **`deploy.sh`** — не релиз; только runbook / emergency.
- **Rollback** — через **workflow_dispatch** с известным ref, не «правки на проде» как норма.
- При падении health gate job завершается с ошибкой; **авто-rollback** образов и томов нет — разбор по логам **`docker compose`**.

### Git: `fatal: detected dubious ownership` в `/app/wms-prod`

Запускайте **`git pull`** и **`deploy.sh`** от пользователя **`dev`** (не от root после `sudo su`). От root один раз:

```bash
git config --global --add safe.directory /app/wms-prod
```

### Smoke-check (после reload nginx и поднятых стеков)

Те же проверки, что использует **`deploy.sh`** (emergency) для smoke, или выполняйте после успешного **Deploy** в Actions: **liveness** и **`/api/docs`** через тот же вход, что пользователи (кроме прямого curl к backend).

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
