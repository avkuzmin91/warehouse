#!/usr/bin/env bash
# Установка ежедневного бэкапа WMS в cron (03:00 по Москве). Запускать от root один раз.
#   sudo bash /var/www/app-prod/scripts/backup/install-cron.sh
#
# Создаёт: каталог бэкапов, /etc/wms-backup.env (если нет), /etc/cron.d/wms-backup.
# Скрипт бэкапа берётся из репозитория (обновляется при деплое), поэтому правки идут через git.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запустите от root: sudo bash $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/wms-backup.sh"
ENV_EXAMPLE="${SCRIPT_DIR}/wms-backup.env.example"
ENV_FILE="/etc/wms-backup.env"
CRON_FILE="/etc/cron.d/wms-backup"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wms}"

[[ -f "${BACKUP_SCRIPT}" ]] || { echo "Не найден ${BACKUP_SCRIPT}" >&2; exit 1; }

# 1. Конфиг (не перезаписываем существующий — там могут быть секреты).
if [[ ! -f "${ENV_FILE}" ]]; then
  install -m 600 "${ENV_EXAMPLE}" "${ENV_FILE}"
  echo "Создан ${ENV_FILE} (проверьте значения)."
else
  echo "${ENV_FILE} уже существует — оставляю как есть."
fi

# 2. Каталоги бэкапов.
mkdir -p "${BACKUP_ROOT}"/{db,uploads,source,logs}
chmod 700 "${BACKUP_ROOT}"
echo "Каталог бэкапов: ${BACKUP_ROOT}"

# 2b. Доступ на ЧТЕНИЕ для SSH-пользователя через POSIX ACL.
# Имя пользователя берём из окружения (BACKUP_READ_USER=alex bash install-cron.sh)
# или из уже существующего /etc/wms-backup.env.
READ_USER="${BACKUP_READ_USER:-}"
if [[ -z "${READ_USER}" && -f "${ENV_FILE}" ]]; then
  READ_USER="$(grep -E '^[[:space:]]*BACKUP_READ_USER=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi

if [[ -n "${READ_USER}" ]]; then
  if ! id "${READ_USER}" >/dev/null 2>&1; then
    echo "ВНИМАНИЕ: пользователь '${READ_USER}' не найден — ACL не выданы." >&2
  elif ! command -v setfacl >/dev/null 2>&1; then
    echo "ВНИМАНИЕ: setfacl не установлен. Поставьте: sudo apt-get install -y acl, затем повторите. ACL не выданы." >&2
  else
    # Access ACL на всё существующее (rX: r для файлов, r-x для каталогов).
    setfacl -R -m "u:${READ_USER}:rX" "${BACKUP_ROOT}" || true
    # Default ACL только на каталоги → новые файлы бэкапа автоматически читаемы этим пользователем.
    find "${BACKUP_ROOT}" -type d -exec setfacl -d -m "u:${READ_USER}:rX" {} + || true
    echo "Доступ на чтение для '${READ_USER}' выдан (ACL + наследование для будущих файлов)."
    # Зафиксируем имя в конфиге, чтобы wms-backup.sh поддерживал ACL при ручных запусках.
    if [[ -f "${ENV_FILE}" ]]; then
      if grep -qE '^[[:space:]]*BACKUP_READ_USER=' "${ENV_FILE}"; then
        sed -i -E "s|^[[:space:]]*BACKUP_READ_USER=.*|BACKUP_READ_USER=${READ_USER}|" "${ENV_FILE}"
      else
        printf '\nBACKUP_READ_USER=%s\n' "${READ_USER}" >> "${ENV_FILE}"
      fi
    fi
  fi
else
  echo "BACKUP_READ_USER не задан — доступ к бэкапам только у root."
  echo "  Чтобы дать чтение пользователю alex: sudo BACKUP_READ_USER=alex bash $0"
fi

# 3. Cron-задание. CRON_TZ=Europe/Moscow → 0 3 * * * = 03:00 МСК независимо от TZ сервера.
cat > "${CRON_FILE}" <<EOF
# WMS daily backup — управляется scripts/backup/install-cron.sh, правки в git.
CRON_TZ=Europe/Moscow
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
0 3 * * * root bash ${BACKUP_SCRIPT} >> ${BACKUP_ROOT}/logs/cron.log 2>&1
EOF
chmod 644 "${CRON_FILE}"
echo "Установлен ${CRON_FILE}:"
sed 's/^/  /' "${CRON_FILE}"

# 4. Перечитать cron (на части систем cron.d подхватывается сам).
systemctl reload cron 2>/dev/null || systemctl reload crond 2>/dev/null || service cron reload 2>/dev/null || true

cat <<EOF

Готово. Бэкап будет запускаться ежедневно в 03:00 МСК.

Проверьте вручную прямо сейчас:
  sudo bash ${BACKUP_SCRIPT}
  ls -lah ${BACKUP_ROOT}/db ${BACKUP_ROOT}/uploads ${BACKUP_ROOT}/source
  tail -n 40 ${BACKUP_ROOT}/logs/wms-backup_\$(date +%Y-%m-%d).log
EOF
