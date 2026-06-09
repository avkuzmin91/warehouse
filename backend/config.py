from __future__ import annotations

import logging
import os
from pathlib import Path


# ---------------------------------------------------------------------------
# JWT / Auth
# ---------------------------------------------------------------------------

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if len(JWT_SECRET) < 32:
    raise RuntimeError(
        "Переменная окружения JWT_SECRET отсутствует или слишком короткая (минимум 32 символа). "
        "Установите JWT_SECRET перед запуском приложения."
    )

JWT_ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = 60

AUTH_REFRESH_COOKIE_NAME = "wms_rt"
AUTH_REFRESH_COOKIE_PATH = "/api"
AUTH_REFRESH_TTL_DAYS = 30
AUTH_REFRESH_COOKIE_SAMESITE = "lax"

AUTH_RL_REFRESH_MAX = int(os.environ.get("AUTH_RATE_LIMIT_REFRESH_MAX", "60"))
AUTH_RL_REFRESH_WINDOW_SEC = float(os.environ.get("AUTH_RATE_LIMIT_REFRESH_WINDOW_SEC", "60"))
AUTH_REPLAY_REVOKE_MIN_SECONDS = float(os.environ.get("AUTH_REPLAY_REVOKE_MIN_SECONDS", "30"))
AUTH_JTI_DENYLIST_MAX = int(os.environ.get("AUTH_JTI_DENYLIST_MAX", "5000"))

# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------

def _resolve_uploads_dir() -> Path:
    raw = (os.environ.get("WAREHOUSE_UPLOADS_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(__file__).resolve().parent / "uploads"


UPLOADS_DIR = _resolve_uploads_dir()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 МБ

# ---------------------------------------------------------------------------
# Справочники
# ---------------------------------------------------------------------------

DICTIONARY_TABLES = frozenset({
    "clients", "colors", "sizes", "product_types", "suppliers",
    "unloading_zones", "warehouses", "carriers", "defect_reasons",
    "vehicle_types",
})

# Системный справочник «актуальность записи»
RECORD_ACTUALITY_YES_ID = "00000000-0000-4000-8000-000000000001"
RECORD_ACTUALITY_NO_ID = "00000000-0000-4000-8000-000000000002"

# ---------------------------------------------------------------------------
# Поступления (receipt_*)
# ---------------------------------------------------------------------------

RECEIPT_STATUS_DRAFT     = "draft"
RECEIPT_STATUS_PLANNED   = "planned"
RECEIPT_STATUS_ON_INTAKE = "on_intake"
RECEIPT_STATUS_ON_REVIEW = "on_review"
RECEIPT_STATUS_IN_REVIEW_LEGACY = "in_review"   # нормализуется → on_review при старте
RECEIPT_STATUS_DONE      = "done"
RECEIPT_STATUS_CANCELLED = "cancelled"

RECEIPT_STATUSES_ALL: frozenset[str] = frozenset({
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_CANCELLED,
})

RECEIPT_STATUS_TRANSITIONS: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:     RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_PLANNED:   RECEIPT_STATUS_ON_INTAKE,
    # on_intake → done выполняет «Принять товары» (/arrive): весь принятый товар
    # попадает в остаток как on_review (статус инвентаря, не документа). QC перенесён в упаковку.
}

RECEIPT_STATUS_RU: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:     "Создание",
    RECEIPT_STATUS_PLANNED:   "В плане",
    RECEIPT_STATUS_ON_INTAKE: "Принят",
    RECEIPT_STATUS_ON_REVIEW: "На проверке",
    RECEIPT_STATUS_DONE:      "Завершён",
    RECEIPT_STATUS_CANCELLED: "Аннулирован",
}

# Типы операций журнала поступлений (QC убран — годность определяется при упаковке)
RECEIPT_OP_DOC_CREATE          = "doc_create"
RECEIPT_OP_DOC_UPDATE          = "doc_update"
RECEIPT_OP_LINE_ADD            = "line_add"
RECEIPT_OP_LINE_UPDATE         = "line_update"
RECEIPT_OP_LINE_DELETE         = "line_delete"
RECEIPT_OP_PLAN_FIX            = "plan_fix"
RECEIPT_OP_INTAKE_START        = "intake_start"
RECEIPT_OP_ARRIVAL_FIX         = "arrival_fix"
RECEIPT_OP_ARRIVAL_ACCEPT      = "arrival_accept"
RECEIPT_OP_CANCEL              = "cancel"

# Статусы line-уровня (QC)
RECEIPT_LINE_QC_STATUS_PENDING   = "pending"
RECEIPT_LINE_QC_STATUS_COMPLETED = "completed"

# ---------------------------------------------------------------------------
# Отгрузки (shipment_*)
# ---------------------------------------------------------------------------

SHIPMENT_STATUS_DRAFT         = "draft"
SHIPMENT_STATUS_PACKING       = "packing"
SHIPMENT_STATUS_ON_PACKING    = "on_packing"
SHIPMENT_STATUS_RELOCATING    = "relocating"
SHIPMENT_STATUS_AWAITING_TRIP = "awaiting_trip"
SHIPMENT_STATUS_SHIPPED       = "shipped"
SHIPMENT_STATUS_CANCELLED     = "cancelled"

SHIPMENT_STATUSES_ALL: list[str] = [
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUS_CANCELLED,
]

SHIPMENT_STATUS_LABELS: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT:         "Создание",
    SHIPMENT_STATUS_PACKING:       "В плане",
    SHIPMENT_STATUS_ON_PACKING:    "На упаковке",
    SHIPMENT_STATUS_RELOCATING:    "Перемещение",
    SHIPMENT_STATUS_AWAITING_TRIP: "Ожидает рейс",
    SHIPMENT_STATUS_SHIPPED:       "Завершён",
    SHIPMENT_STATUS_CANCELLED:     "Аннулирован",
}

# Плановые переходы через /advance. relocating → awaiting_trip не здесь: его делает
# отдельный эндпоинт «Готово к рейсу» (перемещение по местам). awaiting_trip → shipped —
# при отправке привязанного рейса (логистика), тоже вне /advance.
SHIPMENT_TRANSITIONS: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT:      SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_PACKING:    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_ON_PACKING: SHIPMENT_STATUS_RELOCATING,
}

# Роли, которым разрешён переход НА данный статус (целевой статус → роли).
# В плане → На упаковке: кладовщик передаёт товар. На упаковке → Перемещение:
# начальник смены упаковал годный/брак и передаёт кладовщику.
SHIPMENT_TRANSITION_ROLES: dict[str, frozenset[str]] = {
    SHIPMENT_STATUS_PACKING:    frozenset({"manager", "admin", "warehouse_manager"}),
    SHIPMENT_STATUS_ON_PACKING: frozenset({"manager", "admin", "warehouse_manager"}),
    SHIPMENT_STATUS_RELOCATING: frozenset({"manager", "admin", "shift_supervisor"}),
}

# Аннулировать можно только до передачи на упаковку включительно.
SHIPMENT_CANCELLABLE_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
})

SHIPMENT_REVERT_TRANSITIONS: dict[str, str] = {}

SHIPMENT_EDITABLE_LINE_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
})

SHIPMENT_CARGO_GOOD   = "good"
SHIPMENT_CARGO_DEFECT = "defect"

# Типы операций журнала отгрузок
SHIPMENT_OP_DOC_UPDATE = "doc_update"
SHIPMENT_OP_PRIORITY_UPDATE = "priority_update"
SHIPMENT_OP_PACK            = "pack"
SHIPMENT_OP_PACK_CORRECTION = "pack_correction"
SHIPMENT_OP_MOVE_RETURN     = "move_return"
SHIPMENT_OP_RELOCATE        = "relocate"

# ---------------------------------------------------------------------------
# Логистика — Рейсы (trip_*)
# ---------------------------------------------------------------------------

TRIP_DIRECTION_INBOUND  = "inbound"
TRIP_DIRECTION_OUTBOUND = "outbound"   # заложено на будущее, пока не используется

TRIP_STATUS_DRAFT            = "draft"
TRIP_STATUS_AWAITING_ARRIVAL = "awaiting_arrival"
TRIP_STATUS_UNLOADING        = "unloading"
TRIP_STATUS_COSTING          = "costing"
TRIP_STATUS_CLOSED           = "closed"
TRIP_STATUS_CANCELLED        = "cancelled"

TRIP_STATUSES_ALL: frozenset[str] = frozenset({
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_UNLOADING,
    TRIP_STATUS_COSTING,
    TRIP_STATUS_CLOSED,
    TRIP_STATUS_CANCELLED,
})

TRIP_STATUS_TRANSITIONS: dict[str, str] = {
    TRIP_STATUS_DRAFT:            TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_AWAITING_ARRIVAL: TRIP_STATUS_UNLOADING,
    TRIP_STATUS_UNLOADING:        TRIP_STATUS_COSTING,
    TRIP_STATUS_COSTING:          TRIP_STATUS_CLOSED,
}

TRIP_STATUS_RU: dict[str, str] = {
    TRIP_STATUS_DRAFT:            "Черновик",
    TRIP_STATUS_AWAITING_ARRIVAL: "Ожидает прибытия",
    TRIP_STATUS_UNLOADING:        "Разгрузка",
    TRIP_STATUS_COSTING:          "Уточнение стоимости",
    TRIP_STATUS_CLOSED:           "Закрыт",
    TRIP_STATUS_CANCELLED:        "Аннулирован",
}

# Статус-коды у обоих направлений общие; различается только лексика погрузки/разгрузки.
TRIP_STATUS_RU_OUTBOUND: dict[str, str] = {
    TRIP_STATUS_DRAFT:            "Черновик",
    TRIP_STATUS_AWAITING_ARRIVAL: "Ожидает прибытия",
    TRIP_STATUS_UNLOADING:        "Погрузка",
    TRIP_STATUS_COSTING:          "Уточнение стоимости",
    TRIP_STATUS_CLOSED:           "Закрыт",
    TRIP_STATUS_CANCELLED:        "Аннулирован",
}

TRIP_STATUS_RU_BY_DIRECTION: dict[str, dict[str, str]] = {
    TRIP_DIRECTION_INBOUND:  TRIP_STATUS_RU,
    TRIP_DIRECTION_OUTBOUND: TRIP_STATUS_RU_OUTBOUND,
}


def trip_status_ru(direction: str, status: str) -> str:
    table = TRIP_STATUS_RU_BY_DIRECTION.get(direction, TRIP_STATUS_RU)
    return table.get(status, status)

# Роль-владелец текущего статуса (для «Моих задач»)
TRIP_STATUS_ASSIGNEE_ROLE: dict[str, str] = {
    TRIP_STATUS_DRAFT:            "manager",
    TRIP_STATUS_AWAITING_ARRIVAL: "warehouse_manager",
    TRIP_STATUS_UNLOADING:        "warehouse_manager",
    TRIP_STATUS_COSTING:          "manager",
}

TRIP_LOAD_FULL    = "full"
TRIP_LOAD_PARTIAL = "partial"

TRIP_LOAD_RU: dict[str, str] = {
    TRIP_LOAD_FULL:    "Полная",
    TRIP_LOAD_PARTIAL: "Неполная",
}

# Типы операций журнала рейсов (append-only)
TRIP_OP_DOC_CREATE      = "doc_create"
TRIP_OP_DOC_UPDATE      = "doc_update"
TRIP_OP_RECEIPT_LINK    = "receipt_link"
TRIP_OP_RECEIPT_UNLINK  = "receipt_unlink"
TRIP_OP_SHIPMENT_LINK   = "shipment_link"
TRIP_OP_SHIPMENT_UNLINK = "shipment_unlink"
TRIP_OP_HANDOFF         = "handoff"
TRIP_OP_ARRIVAL         = "arrival"
TRIP_OP_DEPARTURE       = "departure"
TRIP_OP_UNLOAD_DONE     = "unload_done"
TRIP_OP_LOAD_DONE       = "load_done"
TRIP_OP_COST_ACTUAL     = "cost_actual"
TRIP_OP_CLOSE           = "close"
TRIP_OP_CANCEL          = "cancel"

# ---------------------------------------------------------------------------
# Сортировка — словари допустимых колонок (для SQL ORDER BY)
# ---------------------------------------------------------------------------

CLIENT_LIST_SORT_COLUMNS: dict[str, str] = {
    "name":       "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active":  "d.is_active",
}
SIZE_LIST_SORT_COLUMNS: dict[str, str] = {
    "name":       "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active":  "d.is_active",
}
COLOR_LIST_SORT_COLUMNS: dict[str, str] = {
    "name":       "LOWER(d.name)",
    "created_at": "d.created_at",
    "is_active":  "d.is_active",
}
PRODUCT_LIST_SORT_COLUMNS: dict[str, str] = {
    "sku_base":   "LOWER(p.sku)",
    "name":       "LOWER(p.name)",
    "type":       "LOWER(COALESCE(pt.name, ''))",
    "client":     "LOWER(COALESCE(c.name, ''))",
    "created_at": "p.created_at",
    "is_active":  "p.is_active",
}

# ---------------------------------------------------------------------------
# Логгеры
# ---------------------------------------------------------------------------

auth_log = logging.getLogger("warehouse.auth")
