#!/usr/bin/env bash
# Восстановление WMS из бэкапа. ОПАСНО: перезаписывает текущие данные.
# Запускать от root на сервере. См. docs/backup.md.
#
# Использование:
#   wms-restore.sh db       <файл .dump>      # восстановить БД (pg_restore --clean)
#   wms-restore.sh uploads  <файл .tar.gz>    # восстановить файлы (uploads/)
#   wms-restore.sh list                       # показать доступные бэкапы
set -euo pipefail

WMS_BACKUP_ENV_FILE="${WMS_BACKUP_ENV_FILE:-/etc/wms-backup.env}"
if [[ -f "${WMS_BACKUP_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${WMS_BACKUP_ENV_FILE}"; set +a
fi

WMS_ENV="${WMS_ENV:-prod}"
APP_DIR="${APP_DIR:-/var/www/app-${WMS_ENV}}"
DB_CONTAINER="${DB_CONTAINER:-wms_${WMS_ENV}_db}"
DB_NAME="${DB_NAME:-app}"
DB_USER="${DB_USER:-postgres}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wms}"

action="${1:-}"
arg="${2:-}"

confirm() {
  read -r -p "$1 Введите 'yes' для продолжения: " ans
  [[ "${ans}" == "yes" ]] || { echo "Отменено."; exit 1; }
}

case "${action}" in
  list)
    echo "== БД (${BACKUP_ROOT}/db) =="
    ls -1t "${BACKUP_ROOT}/db"/*.dump 2>/dev/null || echo "  (нет)"
    echo "== Файлы (${BACKUP_ROOT}/uploads) =="
    ls -1t "${BACKUP_ROOT}/uploads"/*.tar.gz 2>/dev/null || echo "  (нет)"
    echo "== Исходники (${BACKUP_ROOT}/source) =="
    ls -1t "${BACKUP_ROOT}/source"/*.tar.gz 2>/dev/null || echo "  (нет)"
    ;;

  db)
    [[ -f "${arg}" ]] || { echo "Укажите существующий файл .dump. Список: wms-restore.sh list" >&2; exit 2; }
    echo "Восстановление БД '${DB_NAME}' в контейнере ${DB_CONTAINER} из:"
    echo "  ${arg}"
    confirm "ВСЕ текущие данные БД будут заменены."
    echo "Восстанавливаю (pg_restore --clean --if-exists --no-owner) ..."
    # Дамп подаётся в stdin контейнера; --clean удаляет объекты перед пересозданием.
    docker exec -i "${DB_CONTAINER}" pg_restore -U "${DB_USER}" -d "${DB_NAME}" \
      --clean --if-exists --no-owner --no-privileges < "${arg}"
    echo "Готово. Рекомендуется перезапустить backend: docker restart wms_${WMS_ENV}_backend"
    ;;

  uploads)
    [[ -f "${arg}" ]] || { echo "Укажите существующий файл .tar.gz. Список: wms-restore.sh list" >&2; exit 2; }
    echo "Восстановление файлов в ${UPLOADS_DIR} из:"
    echo "  ${arg}"
    confirm "Текущее содержимое ${UPLOADS_DIR} будет заменено содержимым архива."
    local_parent="$(dirname "${UPLOADS_DIR}")"
    echo "Распаковываю ..."
    tar -xzf "${arg}" -C "${local_parent}"
    echo "Готово."
    ;;

  *)
    echo "Использование:" >&2
    echo "  wms-restore.sh list" >&2
    echo "  wms-restore.sh db      <файл .dump>" >&2
    echo "  wms-restore.sh uploads <файл .tar.gz>" >&2
    exit 2
    ;;
esac
