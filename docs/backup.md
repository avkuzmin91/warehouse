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

## Доступ на чтение для пользователя (SSH)

Бэкапы лежат в `/var/backups/wms` с правами `700` (владелец — root), чтобы дампы БД со всеми данными
не были доступны посторонним. Чтобы выдать **конкретному** SSH-пользователю (например `alex`)
доступ **только на чтение** — используется POSIX ACL с наследованием: новые файлы бэкапа автоматически
становятся читаемыми этим пользователем, ничего настраивать после каждого прогона не нужно.

**Выдать доступ** (от root, идемпотентно):

```bash
# При установке:
sudo BACKUP_READ_USER=alex bash /var/www/app-prod/scripts/backup/install-cron.sh

# Или позже, не переустанавливая cron — задать в конфиге и один раз применить:
echo 'BACKUP_READ_USER=alex' | sudo tee -a /etc/wms-backup.env
sudo setfacl -R   -m u:alex:rX /var/backups/wms          # текущие файлы
sudo find /var/backups/wms -type d -exec setfacl -d -m u:alex:rX {} +   # будущие файлы
```

> Нужен пакет `acl` (на Ubuntu обычно есть; иначе `sudo apt-get install -y acl`).
> `BACKUP_READ_USER` в `/etc/wms-backup.env` нужен, чтобы `wms-backup.sh` поддерживал ACL и при ручных запусках.

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
| `BACKUP_READ_USER` | — | SSH-пользователь с доступом на чтение бэкапов (ACL) |
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
