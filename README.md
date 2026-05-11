# Warehouse (WMS)

## Модель: host nginx + Docker (без edge-контейнера, без Docker DNS в nginx)

- **Один ingress:** **nginx на хосте** читает **`nginx/nginx.conf`** из репозитория.
- **Три compose:** `docker-compose.prod.yml`, `docker-compose.test.yml`, `docker-compose.dev.yml` — стандартные сети Compose, без resolver/`set $upstream` в nginx.
- **Порты на loopback:** см. контракт ниже; nginx проксирует **только на `127.0.0.1`**.

---

## Контракт портов (зафиксировано)

Используйте **только** эти значения при настройке nginx, мониторинга и документации.

| Окружение | Backend (API, loopback) | Frontend (loopback) | Примечание |
|-----------|-------------------------|----------------------|------------|
| **prod** | **10000** | **10080** | Статика после `npm run build` в Docker |
| **test** | **11000** | **11080** | Как prod, другие env/том |
| **dev** | **8000** | **5173** | Backend в Docker; UI — **Vite на хосте** (`npm run dev`) |

Дополнительно (Postgres с хоста для миграций / отладки):

| Окружение | Postgres (loopback) |
|-----------|---------------------|
| test | **5434** |
| dev | **5435** |
| Локальный-only стек `docker-compose.yml` | **5432** |

**Health (через host nginx):** `GET /health` → бэкенд того же окружения (без префикса `/api`). Пример: `curl -fsSL http://localhost/health` (prod `server_name` включает `localhost`).

### Dev frontend rule (важно)

- В **dev** UI запускается **только на хосте**: **`npm run dev`** (Vite, порт **5173**).
- **Frontend в `docker-compose.dev.yml` не используется** — не добавляйте сервис `frontend`/Vite в Docker для dev без отдельного ADR.

**Почему:** сейчас зафиксирован **гибрид** (Postgres + API в Docker, исходники и Vite на диске/хосте). Параллельный «docker frontend» приведёт к путанице с портами (**5173** vs контейнер), **HMR** и **proxy** (`/api`).

---

## Postgres: одно окружение — одна логическая БД

**Правило:** у каждого runtime-окружения **свой** экземпляр Postgres в своём compose и **свой** том данных. Не смешивать prod/test/dev в одной БД.

| Compose | БД в контейнере (имя) | Том | Назначение |
|---------|------------------------|-----|------------|
| `docker-compose.prod.yml` | `app` (см. env) | `db_data` | Production |
| `docker-compose.test.yml` | `app_test` | `db_test_data` | Staging / test |
| `docker-compose.dev.yml` | `app` (dev-данные) | `db_data_dev` | Development |
| `docker-compose.yml` (legacy) | `wms` | `postgres_data` | Отдельный локальный стек, **не** prod |

**Чёткие схемы:** в `DATABASE_URL` имя БД и хост `db` должны совпадать с `POSTGRES_DB` / сервисом `db` **этого же** compose. Миграции запускать только против БД нужного окружения.

---

## Правило публикации портов Docker

**Порты приложений и БД не публикуются на `0.0.0.0` — только на `127.0.0.1`.**

- В `docker-compose*.yml` используйте форму **`"127.0.0.1:<порт>:<порт>"`**.
- Внешний доступ — **только через nginx** (80/443 на хосте) или SSH-туннель; Cloudflare → IP VPS → nginx → loopback → контейнеры.

Так меньше риска случайно открыть API или БД в интернет.

---

## Deploy

**Поддерживаемый способ выкладки окружений** — только скрипт:

`/app/wms-prod/scripts/deploy.sh`

Он задаёт воспроизводимый и детерминированный порядок: переход в репозиторий → сокращённый статус Git → **проверка чистоты рабочего дерева** (см. **Deploy safety rules**) → **`git fetch`** и **`git pull --ff-only origin main`** (не выполняется при грязном дереве и не в **`--dry-run`**) → **проверка доступа к Docker API** (без sudo) → **`docker compose … config`** (валидация) → **`docker compose … up -d --build --pull always`** → **ожидание `/health` на loopback-бэкенде** (до 30 с) → **smoke-check через host nginx** → вывод **`docker compose ps`** и баннер успеха. После успешного pull в лог печатается **SHA коммита** (`git rev-parse HEAD` и последняя строка `git log -1`).

Режим проверки без изменений: **`/app/wms-prod/scripts/deploy.sh <env> --dry-run`** (или **`--dry-run` перед `<env>`**) — без `git pull`, без `compose up`, без smoke; выполняются проверка дерева, Docker и **`docker compose config`**.

Из интерактивной bash (после `source ~/.bashrc` или новой SSH-сессии):

- **`deploy-prod`** — `/app/wms-prod/scripts/deploy.sh prod`
- **`deploy-test`** — `/app/wms-prod/scripts/deploy.sh test`
- **`deploy-dev`** — `/app/wms-prod/scripts/deploy.sh dev`
- **`deploy-promote`** — `/app/wms-prod/scripts/deploy-promote.sh` — подряд **test**, затем **prod** (два полных деплоя с одним и тем же `deploy.sh`, чтобы не забыть прод после проверки staging).

### Почему на dev «уже новое», на test тоже, а на prod будто старое

1. **Backend в dev** в Docker смонтирован с хоста: **`./backend:/app`** (`docker-compose.dev.yml`). В контейнере выполняется **то, что лежит на диске**, даже без `git commit` / без merge в `main`. **Test и prod** собирают образ из контекста после **`git pull --ff-only origin main`** при **чистом** дереве — в релизных стеках оказывается только **то, что в удалённом `main`**.
2. **Frontend в dev** по документированной схеме — **Vite на хосте** (`npm run dev`), не из образа prod/test. То, что вы видите в браузере на dev, **не обязано** совпадать с тем, что попадёт в Docker-образ фронта на test/prod, пока изменения **не в `main` и не задеплоены**.
3. **Test и prod** используют **один и тот же** `deploy.sh` и **одну ветку** — **`origin/main`**. После одинакового успешного деплоя **образы из одного коммита** должны совпадать по коду приложения. Если prod «отстаёт», чаще всего: **не запускали `deploy-prod`** после проверки на test, смотрели **кэш браузера / CDN** на боевом домене, или деплой prod **упал** (смотрите вывод скрипта и `docker compose ps`).

Сводка: **устранить разрыв test → prod** — явно запускать **`deploy-promote`** или **`deploy-prod`** сразу после зелёного **`deploy-test`**; сверять в логах **одинаковый SHA** после `pull` у обоих деплоев.

Таблица smoke-check при деплое совпадает с разделом **Smoke-check** ниже. При **провале smoke** скрипт выводит **`docker compose ps`** и **`docker compose logs --tail=50`** для **backend** и **frontend** (для окружения **dev** лог **frontend** не запрашивается — UI вне Docker). При **таймауте ожидания `/health` на loopback-бэкенде** выводятся **`ps`** и логи **только backend**.

`*` **deploy.sh** для смоука всегда запрашивает **финальный** ответ после редиректов nginx: **prod** и **test** — `curl -fsSL`; **dev** — `curl -fsSLk`, если виртуальный хост переводит на HTTPS и цепочка иначе обрывается на проверке сертификата (подробности в комментариях `scripts/deploy.sh`). Для ручных проверок используйте те же флаги, что в разделе **Smoke-check** ниже.

При любой ошибке шаг или smoke скрипт завершается **с ненулевым кодом выхода** (контейнеры и тома **не** откатываются автоматически). Пользователь, запускающий деплой, должен иметь доступ к Docker (**`docker`** без sudo, членство в группе **`docker`**).

---

## Deploy safety rules

- Деплой только через **`scripts/deploy.sh`** (или алиасы `deploy-*` / **`scripts/deploy-promote.sh`** в `~/.bashrc`); другие сценарии не поддерживаются.
- Рабочее дерево Git должно быть **чистым**: не допускаются изменения в отслеживаемых файлах и staged-изменения. Исключение — **только** неотслеживаемые пути: файлы с именем **`.env*`** в каталоге, каталог **`logs/`**, пути с **`__pycache__`**, каталог **`.pytest_cache/`**.
- **Откат (rollback)** только вручную оператором; скрипт **не** откатывает образы и **не** делает автоматический `down`.
- Скрипт **не** вызывает **`docker compose down`**, **не** удаляет и **не** пересоздаёт **volumes**.
- Внутри скрипта **нет `sudo`**.
- Рекомендуемый порядок выкладки: сначала **test**, затем **prod** после проверки staging — одной командой: **`deploy-promote`** (`scripts/deploy-promote.sh`).

### Git: `fatal: detected dubious ownership` в `/app/wms-prod`

Каталог репозитория обычно принадлежит пользователю **`dev`**, а Git вызывается от **`root`** (например, после `sudo su`). Git ≥ 2.35 по умолчанию **блокирует** работу в «чужом» дереве — это нормальная защита.

**Рекомендация:** **`git pull`** и **`scripts/deploy.sh`** запускать от **`dev`** (SSH-сессия как `dev` или `sudo -u dev -H bash -lc 'cd /app/wms-prod && ./scripts/deploy.sh prod'`).

Если Git от **`root`** всё же нужен, один раз для учётной записи root:

```bash
git config --global --add safe.directory /app/wms-prod
```

(пишет исключение в **`/root/.gitconfig`**; на пользователя **`dev`** это не влияет — у него свой `~/.gitconfig`.)

---

## Smoke-check (после `nginx -s reload` и поднятых стеков)

Минимальная проверка: **liveness** и **OpenAPI UI** через тот же вход, что и пользователи (кроме прямых проверок бэкенда).

### Через nginx (нужен заголовок `Host` для test/dev, если заходите на `127.0.0.1`)

**Production** (`server_name` включает `localhost`):

```bash
curl -fsSL http://localhost/health
curl -fsSL -o /dev/null -w "%{http_code}\n" http://localhost/api/docs
```

**Test** (`test.pack-men.ru`):

```bash
curl -fsSL -H "Host: test.pack-men.ru" http://127.0.0.1/health
curl -fsSL -o /dev/null -w "%{http_code}\n" -H "Host: test.pack-men.ru" http://127.0.0.1/api/docs
```

**Dev** (`dev.pack-men.ru`; для `/` при необходимости должен быть запущен Vite на **5173**):

```bash
curl -fsSLk -H "Host: dev.pack-men.ru" http://127.0.0.1/health
curl -fsSLk -o /dev/null -w "%{http_code}\n" -H "Host: dev.pack-men.ru" http://127.0.0.1/api/docs
```

### Напрямую на backend (минуя nginx, тот же хост)

```bash
curl -fsS http://127.0.0.1:10000/health   # prod
curl -fsS http://127.0.0.1:11000/health   # test
curl -fsS http://127.0.0.1:8000/health   # dev
```

Ожидается HTTP **200** и тело **`/health`** с JSON `{"status":"ok"}`; для **`/api/docs`** — код **200** (HTML).

---

## Non-goals (намеренно не делаем)

Чтобы архитектура не разъезжалась через месяц, следующие вещи **вне скоупа** этого репозитория:

| Non-goal | Почему |
|----------|--------|
| **Docker DNS как runtime-маршрутизация** | Ingress — **host nginx** + фиксированные **`127.0.0.1:порт`**; имена контейнеров в `proxy_pass` не используются. |
| **Отдельный edge-слой** (отдельный nginx-контейнер перед всеми env) | Уже было отклонено: лишняя связность и порядок запуска. |
| **K8s-подобные абстракции** | Один VPS, Compose, предсказуемые порты — без Helm/service mesh. |
| **`root_path` в FastAPI под `/api`** | Префикс снимает только nginx (и Vite в dev); приложение не знает о `/api` в URL. |

Расширение (отдельное решение продуктовое): второй регион, Kubernetes, внутренний service mesh — оформлять отдельным ADR, а не наращивать текущий README «по тихому».

---

## Запуск стеков

В каждом compose задано своё **`name:`** (`wms-prod`, `wms-test`, `wms-dev`), чтобы **не совпадать с именем каталога** (`wms-prod`). Иначе `docker compose -f docker-compose.dev.yml` использует project **`wms-prod`**, пересекается с продом (orphan-контейнеры, пересоздание БД, конфликт портов).

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.dev.yml up -d --build
```

Подключите **`nginx/nginx.conf`** к системному nginx и выполните **`nginx -t && nginx -s reload`**.

## Локальная разработка UI

Нужны **Node.js 20+** и **npm** на машине, где запускаете Vite (на VPS без Node команда `npm` не найдётся).

Установка на Ubuntu (пример, от root):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Затем:

```bash
docker compose -f docker-compose.dev.yml up -d
cd /app/wms-prod/frontend && npm install && npm run dev
```

Прокси Vite: **`/api` → `http://127.0.0.1:8000`**. Для входа через nginx на **`dev.pack-men.ru`** в **`vite.config.ts`** задано **`server.allowedHosts`** — без этого Vite отдаёт **403** на проксированный `/`.


## API

Префикс **`/api`** снимает nginx (или Vite в dev). FastAPI **без `root_path`**. Фронт: **`API_BASE_URL=/api`**.

## Cloudflare

DNS на IP сервера; трафик на **80/443** хоста → nginx → **`127.0.0.1:…`** в Docker.

В **`nginx/nginx.conf`** заданы заголовки **`Cache-Control` / `CDN-Cache-Control`**: HTML и API не кэшируются на границе, а **`/assets/*`** (хэш в имени Vite) — **`immutable`**, чтобы прод и тест не расходились из‑за старой оболочки при одинаковых Docker-образах.

После правок nginx на сервере: **`sudo nginx -t && sudo systemctl reload nginx`** (или **`sudo nginx -s reload`**, если unit не используется).

Если после деплоя боевой домен всё ещё «старый», в Cloudflare выполните **Purge Cache** (хотя бы **Custom Purge** для `https://pack-men.ru/` и `https://www.pack-men.ru/`) — политика origin не сбрасывает уже закэшированные ответы на edge мгновенно во всех режимах.

**Браузер:** даже при корректных заголовках с origin часть клиентов держит **старый документ или старый кэш диска** до **жёсткого обновления** (**Ctrl+F5** / **Cmd+Shift+R**) или окна **инкогнито**. Если «без Ctrl+F5 не работало» — это ожидаемо для первого захода после релиза; для проверки после выкладки используйте жёсткое обновление или инкогнито.
