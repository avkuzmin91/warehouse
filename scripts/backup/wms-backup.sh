#!/usr/bin/env bash
# Резервное копирование WMS на сервере: БД (PostgreSQL) + файлы (uploads) + исходный код.
# Запускается из cron раз в сутки (см. docs/backup.md). Идемпотентен, не трогает рабочие данные.
#
# Конфигурация — переменными окружения или файлом /etc/wms-backup.env (см. wms-backup.env.example).
# Запускать от root (нужен доступ к docker-сокету и к root-owned файлам в uploads/).
set -euo pipefail

# --- 1. Загрузка конфигурации ---------------------------------------------------
# Сначала локальный конфиг сервера (секреты, оверрайды), затем репозиторные значения по
# умолчанию (через := заполняют лишь то, что не задано/пусто в /etc) — так не секретные
# параметры (напр. BACKUP_READ_USER) приезжают через CI/CD, а не правятся руками на сервере.
WMS_BACKUP_ENV_FILE="${WMS_BACKUP_ENV_FILE:-/etc/wms-backup.env}"
if [[ -f "${WMS_BACKUP_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${WMS_BACKUP_ENV_FILE}"; set +a
fi
WMS_BACKUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${WMS_BACKUP_SCRIPT_DIR}/wms-backup.defaults.env" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${WMS_BACKUP_SCRIPT_DIR}/wms-backup.defaults.env"; set +a
fi

# Время склада — Москва: имена файлов и метки в логе в МСК, независимо от TZ сервера.
export TZ="${WMS_TZ:-Europe/Moscow}"

WMS_ENV="${WMS_ENV:-prod}"
APP_DIR="${APP_DIR:-/var/www/app-${WMS_ENV}}"
DB_CONTAINER="${DB_CONTAINER:-wms_${WMS_ENV}_db}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-wms_${WMS_ENV}_backend}"
DB_NAME="${DB_NAME:-app}"
DB_USER="${DB_USER:-postgres}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Исходники: 'tree' — архив развёрнутого дерева (без auth, всегда работает);
#            'mirror' — git clone --mirror полной истории (нужен REPO_URL с доступом).
SOURCE_MODE="${SOURCE_MODE:-tree}"
REPO_URL="${REPO_URL:-}"
# Опциональная команда отправки бэкапа за пределы сервера (offsite). Получает путь к каталогу дня.
OFFSITE_CMD="${OFFSITE_CMD:-}"

TS="$(date +%Y-%m-%d_%H%M%S)"
DATE="$(date +%Y-%m-%d)"

DB_DIR="${BACKUP_ROOT}/db"
UPLOADS_BK_DIR="${BACKUP_ROOT}/uploads"
SOURCE_DIR="${BACKUP_ROOT}/source"
LOG_DIR="${BACKUP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/wms-backup_${DATE}.log"
LOCK_FILE="${BACKUP_ROOT}/.wms-backup.lock"

mkdir -p "${DB_DIR}" "${UPLOADS_BK_DIR}" "${SOURCE_DIR}" "${LOG_DIR}"

# Доступ на чтение для SSH-пользователя (если задан BACKUP_READ_USER): поддерживаем ACL на каталогах
# + наследование для новых файлов. Само наследование делает новые дампы читаемыми без действий per-file.
if [[ -n "${BACKUP_READ_USER:-}" ]] && command -v setfacl >/dev/null 2>&1 && id "${BACKUP_READ_USER}" >/dev/null 2>&1; then
  for d in "${BACKUP_ROOT}" "${DB_DIR}" "${UPLOADS_BK_DIR}" "${SOURCE_DIR}" "${LOG_DIR}"; do
    setfacl -m "u:${BACKUP_READ_USER}:rX" -m "d:u:${BACKUP_READ_USER}:rX" "${d}" 2>/dev/null || true
  done
fi

# --- 2. Логирование -------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" | tee -a "${LOG_FILE}"; }
fail() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] ОШИБКА: $*" | tee -a "${LOG_FILE}" >&2; }

# --- 3. Защита от параллельных запусков ----------------------------------------
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  fail "Бэкап уже выполняется (lock ${LOCK_FILE}). Выход."
  exit 1
fi

DB_OK=0; UPLOADS_OK=0; SOURCE_OK=0

log "=== WMS backup START (env=${WMS_ENV}, dir=${BACKUP_ROOT}, retention=${RETENTION_DAYS}д) ==="
log "Свободно на ${BACKUP_ROOT}: $(df -h "${BACKUP_ROOT}" | awk 'NR==2{print $4" из "$2}')"

# --- 4. Бэкап БД (pg_dump custom format) ---------------------------------------
# custom-формат (-Fc): сжат, поддерживает выборочное восстановление через pg_restore.
backup_db() {
  local out="${DB_DIR}/wms-db_${DB_NAME}_${TS}.dump"
  local tmp="${out}.tmp"
  if ! docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
    fail "Контейнер БД ${DB_CONTAINER} не запущен — дамп пропущен."
    return 1
  fi
  log "БД: pg_dump ${DB_NAME} из ${DB_CONTAINER} ..."
  if docker exec "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc --no-owner --no-privileges > "${tmp}"; then
    mv -f "${tmp}" "${out}"
    log "БД: готово → ${out} ($(du -h "${out}" | cut -f1))"
    DB_OK=1
  else
    rm -f "${tmp}"
    fail "БД: pg_dump завершился с ошибкой."
    return 1
  fi
}

# --- 5. Бэкап файлов (uploads) --------------------------------------------------
backup_uploads() {
  local out="${UPLOADS_BK_DIR}/wms-uploads_${TS}.tar.gz"
  local tmp="${out}.tmp"
  if [[ ! -d "${UPLOADS_DIR}" ]]; then
    fail "Каталог файлов ${UPLOADS_DIR} не найден — пропуск."
    return 1
  fi
  log "Файлы: tar ${UPLOADS_DIR} ..."
  if tar -czf "${tmp}" -C "$(dirname "${UPLOADS_DIR}")" "$(basename "${UPLOADS_DIR}")"; then
    mv -f "${tmp}" "${out}"
    log "Файлы: готово → ${out} ($(du -h "${out}" | cut -f1))"
    UPLOADS_OK=1
  else
    rm -f "${tmp}"
    fail "Файлы: tar завершился с ошибкой."
    return 1
  fi
}

# --- 6. Бэкап исходного кода ----------------------------------------------------
backup_source() {
  local out="${SOURCE_DIR}/wms-source_${TS}.tar.gz"
  local tmp="${out}.tmp"

  if [[ "${SOURCE_MODE}" == "mirror" && -n "${REPO_URL}" ]]; then
    log "Исходники: git clone --mirror ${REPO_URL%%@*} ..."
    local work; work="$(mktemp -d)"
    if git clone --mirror "${REPO_URL}" "${work}/repo.git" >/dev/null 2>&1 \
       && tar -czf "${tmp}" -C "${work}" repo.git; then
      mv -f "${tmp}" "${out}"
      rm -rf "${work}"
      log "Исходники (mirror): готово → ${out} ($(du -h "${out}" | cut -f1))"
      SOURCE_OK=1
      return 0
    fi
    rm -f "${tmp}"; rm -rf "${work}"
    fail "Исходники: clone --mirror не удался — пробую архив развёрнутого дерева."
  fi

  # Режим 'tree' (или fallback): архив развёрнутого дерева без .git/node_modules/uploads/секретов.
  if [[ ! -d "${APP_DIR}" ]]; then
    fail "Каталог приложения ${APP_DIR} не найден — исходники пропущены."
    return 1
  fi
  # Зафиксировать выкаченный SHA (APP_VERSION backend = git sha из деплоя).
  # Пишем sidecar рядом с архивом, НЕ в APP_DIR — иначе untracked-файл ломает clean-tree в deploy.sh.
  local sha; sha="$(docker exec "${BACKEND_CONTAINER}" printenv APP_VERSION 2>/dev/null || echo unknown)"
  echo "deployed_sha=${sha}" > "${SOURCE_DIR}/wms-source_${TS}.sha.txt" 2>/dev/null || true
  log "Исходники: tar дерева ${APP_DIR} (SHA=${sha}) ..."
  if tar -czf "${tmp}" -C "${APP_DIR}" \
       --exclude=.git --exclude=node_modules --exclude=uploads \
       --exclude='.env' --exclude='.env.*' \
       --exclude='*/__pycache__' --exclude=.pytest_cache .; then
    mv -f "${tmp}" "${out}"
    log "Исходники (tree): готово → ${out} ($(du -h "${out}" | cut -f1))"
    SOURCE_OK=1
  else
    rm -f "${tmp}"
    fail "Исходники: tar завершился с ошибкой."
    return 1
  fi
}

backup_db       || true
backup_uploads  || true
backup_source   || true

# --- 7. Ротация старых бэкапов --------------------------------------------------
log "Ротация: удаляю старше ${RETENTION_DAYS} дней ..."
for d in "${DB_DIR}" "${UPLOADS_BK_DIR}" "${SOURCE_DIR}"; do
  find "${d}" -type f -name '*.tmp'  -mtime +1 -delete 2>/dev/null || true
  find "${d}" -type f \( -name '*.dump' -o -name '*.tar.gz' -o -name '*.sha.txt' \) -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null \
    | sed 's/^/  удалён: /' | tee -a "${LOG_FILE}" || true
done
find "${LOG_DIR}" -type f -name '*.log' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

# --- 8. Offsite (опционально) ---------------------------------------------------
# Команда выполняется как есть; ей доступны $BACKUP_ROOT и $WMS_BACKUP_DATE.
if [[ -n "${OFFSITE_CMD}" && "${DB_OK}" -eq 1 ]]; then
  log "Offsite: ${OFFSITE_CMD}"
  if BACKUP_ROOT="${BACKUP_ROOT}" WMS_BACKUP_DATE="${DATE}" bash -c "${OFFSITE_CMD}"; then
    log "Offsite: готово."
  else
    fail "Offsite: команда завершилась с ошибкой."
  fi
fi

# --- 9. Итог --------------------------------------------------------------------
log "=== ИТОГ: БД=$([[ ${DB_OK} -eq 1 ]] && echo OK || echo FAIL), Файлы=$([[ ${UPLOADS_OK} -eq 1 ]] && echo OK || echo FAIL), Исходники=$([[ ${SOURCE_OK} -eq 1 ]] && echo OK || echo FAIL) ==="

# БД и файлы — критичны: их провал = ненулевой код выхода (cron пришлёт письмо при настроенном MAILTO).
if [[ "${DB_OK}" -ne 1 || "${UPLOADS_OK}" -ne 1 ]]; then
  fail "Бэкап завершён с ошибками (см. ${LOG_FILE})."
  exit 1
fi
log "Бэкап успешно завершён."
