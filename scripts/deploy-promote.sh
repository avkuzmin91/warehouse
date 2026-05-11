#!/usr/bin/env bash
# Одна команда: staging (test) → production с тем же деревом Git после двух pull.
# Не заменяет merge в main: оба шага используют тот же deploy.sh (pull origin main).
set -euo pipefail
ROOT="/app/wms-prod"
"${ROOT}/scripts/deploy.sh" test
"${ROOT}/scripts/deploy.sh" prod
