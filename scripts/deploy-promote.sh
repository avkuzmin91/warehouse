#!/usr/bin/env bash
# Emergency: последовательно test → prod на клоне /app/wms-prod (см. ADR 0001). Штатный релиз — GitHub Actions.
# Не заменяет merge в main: оба шага используют deploy.sh (pull origin main).
set -euo pipefail
ROOT="/app/wms-prod"
"${ROOT}/scripts/deploy.sh" test
"${ROOT}/scripts/deploy.sh" prod
