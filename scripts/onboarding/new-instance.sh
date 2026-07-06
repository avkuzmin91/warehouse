#!/usr/bin/env bash
# Развёртывание клиентского инстанса WMS на Linux-VPS одной командой.
# Поддерживает несколько инстансов на одном сервере: у каждого свой каталог
# (checkout репозитория), своё имя (--name) и своя пара loopback-портов.
#
# Предпосылки: Docker + docker compose v2; репозиторий уже скопирован на сервер
# (git clone или rsync); скрипт запускается из корня репозитория.
#
#   # первый/единственный инстанс на сервере (порты по умолчанию 10000/10080):
#   ./scripts/onboarding/new-instance.sh --admin-email admin@client.ru
#
#   # второй инстанс на том же VPS (свой каталог + свои имя и порты):
#   ./scripts/onboarding/new-instance.sh --name client-b \
#       --backend-port 10100 --frontend-port 10180 --admin-email admin@client-b.ru
#
# Что делает (идемпотентно — повторный запуск докатывает недостающее):
#   1. Генерирует .env.prod (если его нет): случайные POSTGRES_PASSWORD и
#      JWT_SECRET + параметры инстанса (имя, порты, каталог uploads).
#      Существующий .env.prod не перезаписывается; имя и порты берутся из него.
#   2. Создаёт каталог uploads рядом с репозиторием (bind-mount из compose).
#   3. docker compose up -d --build  (alembic upgrade head выполняется на старте backend).
#   4. Ждёт /health на 127.0.0.1:<backend-port>.
#   5. Создаёт администратора (bootstrap_instance.py; существующий не трогается).
#
# Что НЕ делает (см. docs/onboarding-instance.md): nginx + TLS на хосте,
# установка бэкапов (scripts/backup/install-cron.sh), сборка мобильного APK.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
INSTANCE=""
BACKEND_PORT=""
FRONTEND_PORT=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

usage() {
  grep '^#' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)           INSTANCE="${2:?}"; shift 2 ;;
    --backend-port)   BACKEND_PORT="${2:?}"; shift 2 ;;
    --frontend-port)  FRONTEND_PORT="${2:?}"; shift 2 ;;
    --admin-email)    ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift 2 ;;
    -h|--help)        usage ;;
    *) echo "Неизвестный аргумент: $1" >&2; usage ;;
  esac
done

[[ -n "${ADMIN_EMAIL}" ]] || { echo "Обязателен --admin-email" >&2; usage; }
[[ -f "${COMPOSE_FILE}" ]] || { echo "Не найден ${COMPOSE_FILE} — запускайте из корня репозитория." >&2; exit 1; }

if ! docker info >/dev/null 2>&1; then
  echo "Docker недоступен (демон не запущен или нет прав на /var/run/docker.sock)." >&2
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "Нужен docker compose v2." >&2; exit 1; }

# Значение переменной из существующего env-файла (пусто, если нет).
env_file_get() {
  [[ -f "${ENV_FILE}" ]] || return 0
  sed -n "s/^$1=//p" "${ENV_FILE}" | tail -1
}

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1
}

# --- параметры инстанса: приоритет у существующего .env.prod (идемпотентность) ---
if [[ -f "${ENV_FILE}" ]]; then
  saved_instance="$(env_file_get WMS_INSTANCE)"
  saved_backend="$(env_file_get WMS_BACKEND_PORT)"
  saved_frontend="$(env_file_get WMS_FRONTEND_PORT)"
  if [[ -n "${INSTANCE}" && -n "${saved_instance}" && "${INSTANCE}" != "${saved_instance#wms-}" && "wms-${INSTANCE}" != "${saved_instance}" ]]; then
    echo "ОШИБКА: в ${ENV_FILE} инстанс уже назван «${saved_instance}», а передано --name ${INSTANCE}." >&2
    echo "Для второго инстанса нужен ОТДЕЛЬНЫЙ каталог с собственным checkout репозитория." >&2
    exit 1
  fi
  INSTANCE="${saved_instance:-wms-prod}"
  BACKEND_PORT="${saved_backend:-10000}"
  FRONTEND_PORT="${saved_frontend:-10080}"
  echo "=== ${ENV_FILE} уже существует — имя/порты/секреты берём из него (идемпотентность) ==="
else
  if [[ -n "${INSTANCE}" ]]; then
    if [[ ! "${INSTANCE}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      echo "ОШИБКА: --name — только строчные латинские буквы, цифры и дефис (например client-b)." >&2
      exit 1
    fi
    INSTANCE="wms-${INSTANCE}"
  else
    INSTANCE="wms-prod"
  fi
  BACKEND_PORT="${BACKEND_PORT:-10000}"
  FRONTEND_PORT="${FRONTEND_PORT:-10080}"
  for p in "${BACKEND_PORT}" "${FRONTEND_PORT}"; do
    if port_busy "${p}"; then
      echo "ОШИБКА: порт 127.0.0.1:${p} уже занят (другой инстанс?)." >&2
      echo "Передайте свободные --backend-port/--frontend-port (например 10100/10180)." >&2
      exit 1
    fi
  done
fi
CONTAINER_PREFIX="$(printf '%s' "${INSTANCE}" | tr '-' '_')"

GENERATED_PASSWORD=0
if [[ -z "${ADMIN_PASSWORD}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 15)"
  GENERATED_PASSWORD=1
fi

# --- 1. env-файл: создаётся один раз, повторный запуск НЕ перегенерирует секреты ---
UPLOADS_DIR="${WAREHOUSE_UPLOADS_HOST_PATH_PROD:-$(pwd)/uploads}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "=== Генерация ${ENV_FILE} (инстанс ${INSTANCE}, порты ${BACKEND_PORT}/${FRONTEND_PORT}) ==="
  umask 077
  cat > "${ENV_FILE}" <<EOF
# Сгенерировано scripts/onboarding/new-instance.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Полный контракт переменных: .env.prod.example
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
VITE_API_BASE_URL=/api
# Параметры инстанса (несколько систем на одном VPS)
WMS_INSTANCE=${INSTANCE}
WMS_CONTAINER_PREFIX=${CONTAINER_PREFIX}
WMS_BACKEND_PORT=${BACKEND_PORT}
WMS_FRONTEND_PORT=${FRONTEND_PORT}
WAREHOUSE_UPLOADS_HOST_PATH_PROD=${UPLOADS_DIR}
EOF
  echo "Создан ${ENV_FILE} (права 600)."
fi

# --- 2. каталог загрузок (bind-mount в /app/uploads) ---
saved_uploads="$(env_file_get WAREHOUSE_UPLOADS_HOST_PATH_PROD)"
UPLOADS_DIR="${saved_uploads:-${UPLOADS_DIR}}"
mkdir -p "${UPLOADS_DIR}"

# --- 3. сборка и запуск ---
export APP_VERSION="${APP_VERSION:-$(git describe --tags --always 2>/dev/null || echo onboarding)}"
echo "=== docker compose up -d --build (${INSTANCE}, APP_VERSION=${APP_VERSION}) ==="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build

# --- 4. health gate (alembic на старте может занять время) ---
echo "=== Ожидание /health на 127.0.0.1:${BACKEND_PORT} (до 90 с) ==="
waited=0
until curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; do
  sleep 2
  waited=$((waited + 2))
  if [[ ${waited} -ge 90 ]]; then
    echo "Backend не поднялся за 90 с:" >&2
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps >&2 || true
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=50 backend >&2 || true
    exit 1
  fi
done
echo "Health OK."

# --- 5. администратор ---
echo "=== Создание администратора ==="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T \
  -e BOOTSTRAP_ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e BOOTSTRAP_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  backend python bootstrap_instance.py

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Инстанс развёрнут: ${INSTANCE}"
echo "   Backend:  127.0.0.1:${BACKEND_PORT}   (loopback)"
echo "   Frontend: 127.0.0.1:${FRONTEND_PORT}  (loopback)"
echo "   Админ:    ${ADMIN_EMAIL}"
if [[ ${GENERATED_PASSWORD} -eq 1 ]]; then
  echo "   Пароль:   ${ADMIN_PASSWORD}"
  echo "   ↑ показан ОДИН раз, нигде не сохранён — передайте владельцу"
  echo "     и смените при первом входе. Если выше написано «уже существует,"
  echo "     без изменений» — действует СТАРЫЙ пароль, этот не применён."
fi
echo ""
echo " Дальше по чек-листу docs/onboarding-instance.md:"
echo "   1) nginx + TLS на хосте (server по домену → loopback-порты выше);"
echo "   2) бэкапы: scripts/backup/install-cron.sh (конфиг на каждый инстанс);"
echo "   3) мобильный APK под домен клиента (VITE_API_BASE_URL)."
echo "════════════════════════════════════════════════════════════"
