#!/usr/bin/env bash
# Единственная поддерживаемая точка входа для деплоя dev/test/prod (см. README).
# Без sudo, без rollback, без compose down / без трогания volumes.
set -euo pipefail

REPO_ROOT="/app/wms-prod"

usage() {
  cat >&2 <<'EOS'
Использование:
  deploy.sh <dev|test|prod> [--dry-run]
  deploy.sh [--dry-run] <dev|test|prod>

  --dry-run   только проверки и план шагов (без git pull, compose up, smoke)
EOS
  exit 2
}

# Разрешённые неотслеживаемые (untracked) пути при иначе «чистом» дереве.
is_allowed_untracked_path() {
  local p="$1"
  local base
  base="$(basename "${p}")"
  [[ "${base}" == .env* ]] && return 0
  [[ "${p}" == logs || "${p}" == logs/* ]] && return 0
  [[ "${p}" == *__pycache__* ]] && return 0
  [[ "${p}" == .pytest_cache || "${p}" == .pytest_cache/* ]] && return 0
  return 1
}

assert_clean_worktree() {
  local line code path rest
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" ]] && continue
    code="${line:0:2}"
    rest="${line:3}"
    if [[ "${code}" == "??" ]]; then
      path="${rest# }"
      if is_allowed_untracked_path "${path}"; then
        continue
      fi
      echo "Ошибка: незакоммиченный рабочий каталог (запрещённый untracked: ${path})." >&2
      echo "Разрешены только untracked: .env* (имя файла), logs/, пути с __pycache__, .pytest_cache/" >&2
      git status --short >&2
      exit 1
    fi
    echo "Ошибка: рабочее дерево не чистое (есть изменения в отслеживаемых файлах или staged)." >&2
    echo "Сделайте commit/stash или удалите лишнее; git pull при грязном дереве запрещён." >&2
    git status --short >&2
    exit 1
  done < <(git status --porcelain)
}

verify_docker() {
  if ! docker info >/dev/null 2>&1; then
    cat >&2 <<'EOS'
Docker API недоступен (нет доступа к /var/run/docker.sock или демон не запущен).

Без sudo:

  sudo usermod -aG docker dev

Затем перелогиньтесь по SSH (logout / login), чтобы группа docker применилась.

Не запускайте этот скрипт от root без необходимости; целевой пользователь — dev с группой docker.
EOS
    exit 1
  fi
}

validate_compose_file() {
  local f="$1"
  docker compose -f "${f}" config >/dev/null
}

# Ожидание бэкенда на loopback (минует host nginx; порты — контракт репозитория).
wait_for_backend_health() {
  local port
  case "${DEPLOY_ENV}" in
    prod) port=10000 ;;
    test) port=11000 ;;
    dev) port=8000 ;;
    *) echo "wait_for_backend_health: неизвестный env" >&2; return 1 ;;
  esac
  local waited=0
  echo "=== ожидание /health на 127.0.0.1:${port} (до 30 с, шаг 1 с) ==="
  while (( waited < 30 )); do
    if try_backend_health_json "${port}"; then
      echo "Бэкенд отвечает /health (JSON OK)."
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "Ошибка: за 30 с бэкенд не поднялся (127.0.0.1:${port}/health)." >&2
  docker compose -f "${COMPOSE_FILE}" ps >&2 || true
  docker compose -f "${COMPOSE_FILE}" logs --tail=50 backend >&2 || true
  exit 1
}

try_backend_health_json() {
  local port="$1"
  local body
  if ! body=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null); then
    return 1
  fi
  if ! python3 -c 'import json,sys; json.loads(sys.argv[1])' "${body}" 2>/dev/null; then
    return 1
  fi
  return 0
}

dump_compose_diagnostics() {
  echo "=== docker compose ps ===" >&2
  docker compose -f "${COMPOSE_FILE}" ps >&2 || true
  echo "=== docker compose logs backend (tail 50) ===" >&2
  docker compose -f "${COMPOSE_FILE}" logs --tail=50 backend >&2 || true
  if [[ "${DEPLOY_ENV}" != "dev" ]]; then
    echo "=== docker compose logs frontend (tail 50) ===" >&2
    docker compose -f "${COMPOSE_FILE}" logs --tail=50 frontend >&2 || true
  fi
}

# --- smoke (через host nginx); при ошибке возвращают 1, без exit из процесса ---
try_parse_health_json_curl() {
  local -a curl_cmd=("$@")
  local body
  if ! body=$("${curl_cmd[@]}" 2>/dev/null); then
    return 1
  fi
  python3 -c 'import json,sys; json.loads(sys.argv[1])' "${body}" 2>/dev/null
}

try_docs_http_200() {
  local -a curl_cmd=("$@")
  local code
  if ! code=$("${curl_cmd[@]}" 2>/dev/null); then
    return 1
  fi
  [[ "${code}" == "200" ]]
}

smoke_prod() {
  echo "Smoke-check (prod через localhost)..."
  try_parse_health_json_curl curl -fsSL --max-time 30 http://localhost/health || return 1
  try_docs_http_200 curl -fsSL --max-time 30 -o /dev/null -w "%{http_code}" http://localhost/api/docs || return 1
  return 0
}

smoke_test() {
  echo "Smoke-check (test через 127.0.0.1, Host: test.pack-men.ru)..."
  try_parse_health_json_curl curl -fsSL --max-time 30 -H "Host: test.pack-men.ru" http://127.0.0.1/health || return 1
  try_docs_http_200 curl -fsSL --max-time 30 -o /dev/null -w "%{http_code}" -H "Host: test.pack-men.ru" http://127.0.0.1/api/docs || return 1
  return 0
}

smoke_dev() {
  echo "Smoke-check (dev через 127.0.0.1, Host: dev.pack-men.ru; -L/-k из-за типичного HTTPS-редиректа nginx)..."
  try_parse_health_json_curl curl -fsSLk --max-time 30 -H "Host: dev.pack-men.ru" http://127.0.0.1/health || return 1
  try_docs_http_200 curl -fsSLk --max-time 30 -o /dev/null -w "%{http_code}" -H "Host: dev.pack-men.ru" http://127.0.0.1/api/docs || return 1
  return 0
}

run_smoke() {
  case "${DEPLOY_ENV}" in
    prod) smoke_prod ;;
    test) smoke_test ;;
    dev) smoke_dev ;;
    *) echo "Неизвестное окружение для smoke-check: ${DEPLOY_ENV}" >&2; return 1 ;;
  esac
}

# --- parse argv: env + optional --dry-run (любой порядок) ---
DRY_RUN=0
DEPLOY_ENV=""
for a in "$@"; do
  case "${a}" in
    --dry-run) DRY_RUN=1 ;;
    dev | test | prod)
      if [[ -n "${DEPLOY_ENV}" ]]; then
        echo "Ошибка: окружение указано дважды." >&2
        usage
      fi
      DEPLOY_ENV="${a}"
      ;;
    *) echo "Неизвестный аргумент: ${a}" >&2; usage ;;
  esac
done

[[ -n "${DEPLOY_ENV}" ]] || usage

cd "${REPO_ROOT}"

echo "=== git status (кратко) ==="
git status --short

assert_clean_worktree

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "=== DRY-RUN: план (изменений в репозитории не вносится) ==="
  echo "  1. git fetch + git pull --ff-only origin main  [пропущено в dry-run]"
  echo "  2. docker compose -f docker-compose.${DEPLOY_ENV}.yml config  [будет выполнено для валидации]"
  echo "  3. docker compose -f docker-compose.${DEPLOY_ENV}.yml up -d --build  [пропущено]"
  echo "  4. ожидание /health на loopback backend  [пропущено]"
  echo "  5. smoke-check через host nginx  [пропущено]"
  verify_docker
  COMPOSE_FILE="docker-compose.${DEPLOY_ENV}.yml"
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "Файл ${COMPOSE_FILE} не найден в ${REPO_ROOT}" >&2
    exit 1
  fi
  echo "=== docker compose config (валидация) ==="
  validate_compose_file "${COMPOSE_FILE}"
  echo "Dry-run OK: compose валиден, дерево чистое (с учётом исключений для untracked)."
  exit 0
fi

echo "=== git fetch + pull (ff-only) origin/main ==="
git fetch origin
git pull --ff-only origin main
echo "=== ревизия после pull ==="
git rev-parse HEAD
git log -1 --oneline

verify_docker

COMPOSE_FILE="docker-compose.${DEPLOY_ENV}.yml"
if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Файл ${COMPOSE_FILE} не найден в ${REPO_ROOT}" >&2
  exit 1
fi

echo "=== docker compose config (валидация перед up) ==="
validate_compose_file "${COMPOSE_FILE}"

echo "=== docker compose up (${DEPLOY_ENV}) ==="
docker compose -f "${COMPOSE_FILE}" up -d --build --pull always

wait_for_backend_health

echo "=== smoke-check через nginx на хосте ==="
if ! run_smoke; then
  echo "Ошибка: smoke-check не пройден." >&2
  dump_compose_diagnostics
  exit 1
fi

echo "=== docker compose ps ==="
docker compose -f "${COMPOSE_FILE}" ps

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Deploy OK                                                     ║"
printf "║  env: %-56s║\n" "${DEPLOY_ENV}"
echo "║  sequence: clean tree → pull → compose config → up → health   ║"
echo "║            wait → smoke (nginx)                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
