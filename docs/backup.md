# Резервное копирование WMS

Ежедневный автоматический бэкап трёх объектов на сервере:

| # | Объект | Что именно | Источник |
|---|--------|------------|----------|
| 1 | **База данных** | PostgreSQL `app` (поступления, отгрузки, остатки, рейсы, счета, пользователи) | `pg_dump` из контейнера `wms_prod_db` |
| 2 | **Файлы** | Загрузки пользователей: фото товаров, excel/import staging | каталог `/var/www/app-prod/uploads` |
| 3 | **Исходный код** | Код приложения (с GitHub) | развёрнутое дерево `/var/www/app-prod` или зеркало git |

Расписание: **каждые 24 часа в 03:00 по Москве** (cron, `CRON_TZ=Europe/Moscow`).

> ⚠️ **Важное ограничение.** Бэкап лежит на **том же сервере**, что и данные. Это защищает от
> порчи/удаления данных и ошибок приложения, но **не** от потери самого сервера/диска.
> Для полноценного аварийного восстановления включите выгрузку за пределы сервера —
> см. [Offsite](#offsite-выгрузка-за-пределы-сервера).

---

## Файлы решения

Всё лежит в репозитории (деплоится вместе с кодом), кроме конфига с возможными секретами:

| Файл | Назначение |
|------|------------|
| [scripts/backup/wms-backup.sh](../scripts/backup/wms-backup.sh) | основной скрипт бэкапа (БД + файлы + код, ротация, лог) |
| [scripts/backup/wms-restore.sh](../scripts/backup/wms-restore.sh) | восстановление из бэкапа |
| [scripts/backup/install-cron.sh](../scripts/backup/install-cron.sh) | разовая установка cron-задания |
| [scripts/backup/wms-backup.env.example](../scripts/backup/wms-backup.env.example) | пример конфигурации → `/etc/wms-backup.env` |

---

## Где лежат бэкапы

```
/var/backups/wms/
├── db/        wms-db_app_2026-06-14_030001.dump        (pg_dump custom format)
├── uploads/   wms-uploads_2026-06-14_030001.tar.gz     (архив файлов)
├── source/    wms-source_2026-06-14_030001.tar.gz      (архив исходников)
└── logs/      wms-backup_2026-06-14.log, cron.log      (логи)
```

Имена файлов — с меткой времени в **МСК**. Хранение по умолчанию — **14 суток** (`RETENTION_DAYS`),
старые файлы удаляются автоматически в конце каждого прогона.

---

## Установка (один раз на сервере)

Выполняется от root на проде. Код бэкапа уже доставлен деплоем в `/var/www/app-prod/scripts/backup/`.

```bash
# 1. Зайти на сервер
ssh wms-prod

# 2. Установить cron-задание (создаст /etc/wms-backup.env, каталог бэкапов и /etc/cron.d/wms-backup)
#    BACKUP_READ_USER=alex сразу выдаёт пользователю alex доступ на чтение бэкапов (см. ниже).
sudo BACKUP_READ_USER=alex bash /var/www/app-prod/scripts/backup/install-cron.sh

# 3. (Опционально) проверить/поправить конфигурацию
sudo nano /etc/wms-backup.env

# 4. Прогнать бэкап вручную прямо сейчас — убедиться, что всё работает
sudo bash /var/www/app-prod/scripts/backup/wms-backup.sh

# 5. Посмотреть результат
ls -lah /var/backups/wms/db /var/backups/wms/uploads /var/backups/wms/source
tail -n 40 /var/backups/wms/logs/wms-backup_$(date +%Y-%m-%d).log
```

Ожидаемый итог в логе: `ИТОГ: БД=OK, Файлы=OK, Исходники=OK`.

### Про таймзону

cron на сервере мог бы жить в UTC. Чтобы «03:00 МСК» соблюдалось точно, в `/etc/cron.d/wms-backup`
задаётся `CRON_TZ=Europe/Moscow` — стандартный cron Ubuntu это поддерживает.
Если конкретный cron `CRON_TZ` не понимает, замените строку расписания на UTC-эквивалент
(МСК = UTC+3, без перехода на летнее время): `0 0 * * *` вместо `0 3 * * *`.

---

## Проверка, что бэкап работает

```bash
# Расписание установлено?
cat /etc/cron.d/wms-backup

# Последние запуски (cron.log пишется при каждом срабатывании)
tail -n 60 /var/backups/wms/logs/cron.log

# Есть свежие файлы за сегодня?
ls -lt /var/backups/wms/db | head

# Дамп БД не битый? (читаем оглавление, ничего не меняем)
docker exec -i wms_prod_db pg_restore -l < /var/backups/wms/db/<самый-свежий>.dump | head
```

Раз в месяц рекомендуется делать **тестовое восстановление** (на test-окружение) — бэкап,
который ни разу не разворачивали, нельзя считать рабочим.

---

## Восстановление

> Все команды — от root на сервере. Восстановление БД и файлов **перезаписывает** текущие данные,
> поэтому скрипт спрашивает подтверждение (`yes`).

```bash
# Посмотреть доступные бэкапы
sudo bash /var/www/app-prod/scripts/backup/wms-restore.sh list
```

### База данных

```bash
sudo bash /var/www/app-prod/scripts/backup/wms-restore.sh db \
  /var/backups/wms/db/wms-db_app_2026-06-14_030001.dump

# затем перезапустить backend
docker restart wms_prod_backend
```

Под капотом: `pg_restore --clean --if-exists --no-owner` в БД `app` контейнера `wms_prod_db`
(удаляет существующие объекты и накатывает дамп).

### Файлы (uploads)

```bash
sudo bash /var/www/app-prod/scripts/backup/wms-restore.sh uploads \
  /var/backups/wms/uploads/wms-uploads_2026-06-14_030001.tar.gz
```

### Исходный код

Штатно код восстанавливается из **GitHub** через обычный деплой (это первичный источник).
Архив `source/*.tar.gz` нужен на случай недоступности GitHub:

```bash
mkdir -p /tmp/wms-src && tar -xzf \
  /var/backups/wms/source/wms-source_2026-06-14_030001.tar.gz -C /tmp/wms-src
```

---

## Тестовое восстановление на изолированном docker-стеке (локально)

Бэкап, который ни разу не разворачивали, нельзя считать рабочим. Раз в месяц (и после
любых изменений схемы/деплоя) полезно скачать набор и **поднять его как отдельное приложение**,
не трогая dev/prod. Ниже — отработанный подход для проверки набора `db.dump + source.tar.gz + uploads.tar.gz`.

### Принципы

- **Полная изоляция.** Отдельное compose-`name`, свои `container_name`, свой том БД и свои порты —
  чтобы случайно не задеть dev/prod (их тома и контейнеры не должны фигурировать в проверочном стеке).
- **Проверяем код из бэкапа против БД из бэкапа.** Дамп и исходники сняты в один момент, поэтому
  ревизии alembic у них совпадают и `alembic upgrade head` при старте backend будет **no-op**.
  Если в логе backend появились строки `Running upgrade ...` — код и дамп разъехались, это сигнал.
- **`.env`-файлы в бэкап не попадают** (они в `.gitignore`, а `SOURCE_MODE=tree` архивирует дерево
  без них). Для проверки задаём **одноразовые** `POSTGRES_PASSWORD` и `JWT_SECRET` — это нормально:
  они нужны только этому временному стеку.
- **`wms-restore.sh` рассчитан на сервер** (читает `/etc/wms-backup.env`, контейнер `wms_prod_db`).
  Для локальной проверки удобнее воспроизвести ту же команду `pg_restore` вручную против
  изолированного контейнера (см. ниже) — поведение идентично (`--clean --if-exists --no-owner`).

> ⚠️ **Не редактируйте данные в восстановленной БД ради проверки логина.** Был случай: чтобы
> залогиниться, перезаписали `password_hash` у `admin@example.com` тестовым паролем — после чего
> **настоящий прод-пароль перестал подходить**, и это выглядело как «пароль не попал в бэкап»
> (хотя все хэши на месте). Правильно:
> - сначала убедиться, что хэши пришли: `SELECT email, left(password_hash,7), length(password_hash) FROM users;`
>   (валидный bcrypt — `$2b$12$`, длина 60);
> - логиниться **реальным** прод-паролем, ничего не меняя в таблице `users`;
> - если очень нужно проверить вход без known-пароля — делать это **недеструктивно** (проверка
>   `bcrypt.checkpw` против хранимого хэша) или **на копии**;
> - если хэш всё же затёрли — просто **накатить дамп повторно**, он вернёт оригинальные данные.

### Шаги

```bash
# 0. Каталоги под распаковку (вне репозитория, чтобы не попало в git)
mkdir -p ./restore-test/app ./restore-test/data

# 1. Распаковать исходники и файлы из бэкапа
tar -xzf wms-source_<дата>.tar.gz  -C ./restore-test/app
tar -xzf wms-uploads_<дата>.tar.gz -C ./restore-test/data     # внутри каталог uploads/

# 2. Положить рядом проверочный compose, nginx-конфиг и .env (см. ниже) в ./restore-test/app
#    .env:  POSTGRES_PASSWORD=restorepass / JWT_SECRET=restore-test-only

# 3. Поднять ТОЛЬКО БД и дождаться healthy
docker compose --project-directory ./restore-test/app \
  -f ./restore-test/app/docker-compose.restore.yml up -d db

# 4. Накатить дамп в чистый Postgres (та же команда, что и в wms-restore.sh)
docker exec -i wms_restore_db pg_restore -U postgres -d app \
  --clean --if-exists --no-owner --no-privileges < wms-db_<дата>.dump

# 5. Проверить данные (счётчики, ревизия alembic)
docker exec -i wms_restore_db psql -U postgres -d app -tA -c \
  "SELECT version_num FROM alembic_version;"
docker exec -i wms_restore_db psql -U postgres -d app -tA -c \
  "SELECT 'users',count(*) FROM users UNION ALL SELECT 'receipt_docs',count(*) FROM receipt_docs;"

# 6. Собрать и поднять остальное (backend накатит alembic — должен быть no-op)
docker compose --project-directory ./restore-test/app \
  -f ./restore-test/app/docker-compose.restore.yml up -d --build backend frontend proxy

# 7. Смоук-проверки
curl -s http://127.0.0.1:18080/health                       # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18080/             # 200 (SPA)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18080/api/uploads/<файл>  # 200 (uploads)
# вход — реальным прод-паролем на http://127.0.0.1:18080 (НЕ меняя password_hash)

# 8. Снести стек вместе с томом
docker compose --project-directory ./restore-test/app \
  -f ./restore-test/app/docker-compose.restore.yml down -v
```

### `docker-compose.restore.yml` (изолированный стек)

```yaml
name: wms-restore     # отдельный проект — не пересекается с wms-dev / wms-prod

services:
  db:
    image: postgres:16
    container_name: wms_restore_db
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}, POSTGRES_DB: app, TZ: Europe/Moscow }
    ports: ["127.0.0.1:5436:5432"]
    volumes: [db_data_restore:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U postgres -d app"], interval: 5s, timeout: 5s, retries: 10 }

  backend:
    build: { context: ./backend }
    container_name: wms_restore_backend
    environment:
      APP_ENV: prod
      TZ: Europe/Moscow
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/app
      JWT_SECRET: ${JWT_SECRET}
      WAREHOUSE_UPLOADS_DIR: /app/uploads
    volumes: ["../data/uploads:/app/uploads"]
    depends_on: { db: { condition: service_healthy } }
    ports: ["127.0.0.1:18000:8000"]

  frontend:
    build: { context: ./frontend }
    container_name: wms_restore_frontend
    depends_on: [backend]

  proxy:                # мини-замена прод-nginx: /api/ → backend (strip /api), / → frontend
    image: nginx:alpine
    container_name: wms_restore_proxy
    volumes: ["./restore-nginx.conf:/etc/nginx/nginx.conf:ro"]
    ports: ["127.0.0.1:18080:80"]
    depends_on: [backend, frontend]

volumes:
  db_data_restore:
```

### `restore-nginx.conf`

```nginx
events { worker_connections 1024; }
http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    client_max_body_size 50m;
    server {
        listen 80;
        location = /health { proxy_pass http://backend:8000/health; }
        location /api/     { proxy_pass http://backend:8000/; proxy_set_header Host $host; }
        location /         { proxy_pass http://frontend:80;   proxy_set_header Host $host; }
    }
}
```

---

## Доступ на чтение для пользователя (SSH)

Бэкапы лежат в `/var/backups/wms` с правами `700` (владелец — root), чтобы дампы БД со всеми данными
не были доступны посторонним. Чтобы выдать **конкретному** SSH-пользователю доступ **только на чтение** —
используется POSIX ACL с наследованием: новые файлы бэкапа автоматически становятся читаемыми этим
пользователем, ничего настраивать после каждого прогона не нужно.

**Имя пользователя — в репозитории, приезжает через CI/CD.** Оно задано в
[`scripts/backup/wms-backup.defaults.env`](../scripts/backup/wms-backup.defaults.env) (сейчас `alex`) и
деплоится вместе со скриптом — править `/etc/wms-backup.env` на сервере не нужно. Каждый прогон
`wms-backup.sh` (cron или вручную) сам поддерживает ACL для этого пользователя. Переопределить для
конкретного сервера можно через `BACKUP_READ_USER=` в `/etc/wms-backup.env` (он приоритетнее дефолта).

После деплоя ACL применится при ближайшем прогоне; чтобы не ждать 03:00 — один раз вручную:

```bash
sudo bash /var/www/app-prod/scripts/backup/wms-backup.sh   # подхватит alex из репо-дефолта и выдаст ACL
# либо переустановить cron (заодно рекурсивно поправит ACL на уже существующих файлах):
sudo bash /var/www/app-prod/scripts/backup/install-cron.sh
```

> Единственная серверная зависимость — пакет `acl` (на Ubuntu обычно есть; иначе один раз
> `sudo apt-get install -y acl`). Без `setfacl` скрипт молча пропустит выдачу ACL.

**Проверить** (видно строку `user:alex:r-x` и метку `+` в `ls`):

```bash
getfacl /var/backups/wms/db
ls -lah /var/backups/wms/db        # права вида drwxr-x---+
sudo -u alex cat /var/backups/wms/db/<файл>.dump > /dev/null && echo "alex может читать"
```

**Скачать бэкап с сервера** под пользователем `alex` (с локальной машины):

```bash
scp alex@<сервер>:/var/backups/wms/db/wms-db_app_2026-06-14_030001.dump .
# или весь свежий набор:
rsync -avz alex@<сервер>:/var/backups/wms/ ./wms-backups/
```

Доступ — только чтение: создавать, изменять и удалять файлы в `/var/backups/wms` `alex` не может.
Запуск самого бэкапа и восстановление по-прежнему требуют root.

## Offsite (выгрузка за пределы сервера)

Чтобы бэкап пережил потерю сервера, настройте копирование в облако/на другой хост.
В `/etc/wms-backup.env` задайте `OFFSITE_CMD` — команда выполняется как есть, ей доступны
переменные `$BACKUP_ROOT` (путь к `/var/backups/wms`) и `$WMS_BACKUP_DATE`:

```bash
# Пример с rclone (предварительно: rclone config — настроить remote, например s3:wms-backups)
OFFSITE_CMD='rclone copy --max-age 25h "$BACKUP_ROOT" s3:wms-backups'
```

Команда вызывается после успешного дампа БД. Под свой инструмент подправьте её.
Альтернативы: `rsync` на второй VPS, `aws s3 sync`, выгрузка на NAS.

---

## Настройка (файл `/etc/wms-backup.env`)

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `WMS_ENV` | `prod` | окружение (`prod`/`test`) |
| `APP_DIR` | `/var/www/app-prod` | каталог приложения |
| `DB_CONTAINER` | `wms_prod_db` | контейнер PostgreSQL |
| `DB_NAME` / `DB_USER` | `app` / `postgres` | БД и пользователь |
| `UPLOADS_DIR` | `/var/www/app-prod/uploads` | каталог файлов |
| `BACKUP_ROOT` | `/var/backups/wms` | куда складывать бэкапы |
| `RETENTION_DAYS` | `14` | сколько суток хранить |
| `SOURCE_MODE` | `tree` | `tree` (архив дерева) или `mirror` (git-история) |
| `REPO_URL` | — | URL репозитория для `SOURCE_MODE=mirror` |
| `BACKUP_READ_USER` | `alex` (репо-дефолт) | SSH-пользователь с доступом на чтение бэкапов (ACL); из `wms-backup.defaults.env`, оверрайд — в `/etc/wms-backup.env` |
| `OFFSITE_CMD` | — | команда внешней выгрузки |

Для полного зеркала git-истории вместо снимка дерева: `SOURCE_MODE=mirror` и `REPO_URL` с доступом
на чтение (token-URL `https://<TOKEN>@github.com/avkuzmin91/warehouse.git` или SSH deploy key на сервере).

---

## Бэкап test-окружения (опционально)

Тот же скрипт умеет бэкапить test. Заведите отдельный конфиг и cron.d-файл:

```bash
# /etc/wms-backup-test.env  →  WMS_ENV=test, APP_DIR=/var/www/app-test, BACKUP_ROOT=/var/backups/wms-test
# /etc/cron.d/wms-backup-test  →  строка с WMS_BACKUP_ENV_FILE=/etc/wms-backup-test.env и другим временем (напр. 0 4 * * *)
```

---

## Диагностика

| Симптом | Причина / решение |
|---------|-------------------|
| `Контейнер БД wms_prod_db не запущен` | стек не поднят: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d` |
| `Permission denied` на uploads/docker | запускайте бэкап от **root** (cron.d уже задаёт `root`) |
| `Бэкап уже выполняется (lock ...)` | предыдущий прогон ещё идёт или завис; проверьте процесс, при необходимости удалите `/var/backups/wms/.wms-backup.lock` |
| Нет файлов в `source/` при `mirror` | нет доступа к приватному репо — задайте `REPO_URL` с токеном/ключом или вернитесь к `SOURCE_MODE=tree` |
| Кончилось место | уменьшите `RETENTION_DAYS` или включите offsite и чистку |

Логи: подробный — `/var/backups/wms/logs/wms-backup_<дата>.log`, вывод cron — `/var/backups/wms/logs/cron.log`.
