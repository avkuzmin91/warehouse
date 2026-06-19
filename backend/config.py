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
    "vehicle_types", "positions", "own_warehouses",
})

# Системный справочник «актуальность записи»
RECORD_ACTUALITY_YES_ID = "00000000-0000-4000-8000-000000000001"
RECORD_ACTUALITY_NO_ID = "00000000-0000-4000-8000-000000000002"

# ---------------------------------------------------------------------------
# Поступления (receipt_*)
# ---------------------------------------------------------------------------

RECEIPT_STATUS_DRAFT             = "draft"
RECEIPT_STATUS_PLANNED           = "planned"
RECEIPT_STATUS_ON_INTAKE         = "on_intake"
RECEIPT_STATUS_PARTIALLY_RECEIVED = "partially_received"
RECEIPT_STATUS_ON_REVIEW         = "on_review"
RECEIPT_STATUS_DONE              = "done"
RECEIPT_STATUS_CANCELLED         = "cancelled"

RECEIPT_STATUSES_ALL: frozenset[str] = frozenset({
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_CANCELLED,
})

RECEIPT_STATUS_TRANSITIONS: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:     RECEIPT_STATUS_PLANNED,
    # Дальше поступление двигает только рейс: приёмка идёт в разгрузке рейса
    # (planned → partially_received → done), отдельной карточной приёмки больше нет.
    # on_intake / on_review — легаси-статусы, в новом потоке не используются.
}

RECEIPT_STATUS_RU: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:             "Создание",
    RECEIPT_STATUS_PLANNED:           "В плане",
    RECEIPT_STATUS_ON_INTAKE:         "На приёмке",
    RECEIPT_STATUS_PARTIALLY_RECEIVED: "Частично принято",
    RECEIPT_STATUS_ON_REVIEW:         "На проверке",
    RECEIPT_STATUS_DONE:              "Завершён",
    RECEIPT_STATUS_CANCELLED:         "Аннулирован",
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
RECEIPT_OP_RECEIVING_CORRECTION = "receiving_correction"
RECEIPT_OP_CANCEL              = "cancel"

# Статусы line-уровня (QC)
RECEIPT_LINE_QC_STATUS_PENDING   = "pending"
RECEIPT_LINE_QC_STATUS_COMPLETED = "completed"

# ---------------------------------------------------------------------------
# Отгрузки (shipment_*)
# ---------------------------------------------------------------------------

SHIPMENT_STATUS_DRAFT             = "draft"
SHIPMENT_STATUS_PACKING           = "packing"
SHIPMENT_STATUS_ON_PACKING        = "on_packing"
SHIPMENT_STATUS_RELOCATING        = "relocating"
SHIPMENT_STATUS_AWAITING_TRIP     = "awaiting_trip"
SHIPMENT_STATUS_PARTIALLY_SHIPPED = "partially_shipped"
SHIPMENT_STATUS_SHIPPED           = "shipped"
# Завершено без отгрузки: после упаковки годного 0 (весь товар оказался браком),
# рейс не нужен. Терминальный исход, отдельный от `shipped` — иначе попадёт в
# кандидаты на счёт (финансы берут строго `shipped`) и в метрику реальных отгрузок.
SHIPMENT_STATUS_COMPLETED_NO_GOODS = "completed_no_goods"
SHIPMENT_STATUS_CANCELLED         = "cancelled"

SHIPMENT_STATUSES_ALL: list[str] = [
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_PARTIALLY_SHIPPED,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUS_COMPLETED_NO_GOODS,
    SHIPMENT_STATUS_CANCELLED,
]

# Терминальные статусы отгрузки (документ завершён, дальше не двигается).
SHIPMENT_TERMINAL_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUS_COMPLETED_NO_GOODS,
    SHIPMENT_STATUS_CANCELLED,
})

SHIPMENT_STATUS_LABELS: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT:             "Создание",
    SHIPMENT_STATUS_PACKING:           "В плане",
    SHIPMENT_STATUS_ON_PACKING:        "На упаковке",
    SHIPMENT_STATUS_RELOCATING:        "Перемещение",
    SHIPMENT_STATUS_AWAITING_TRIP:     "Ожидает рейс",
    SHIPMENT_STATUS_PARTIALLY_SHIPPED: "Частично отгружено",
    SHIPMENT_STATUS_SHIPPED:           "Завершён",
    SHIPMENT_STATUS_COMPLETED_NO_GOODS: "Завершён",
    SHIPMENT_STATUS_CANCELLED:         "Аннулирован",
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
    SHIPMENT_STATUS_PACKING:    frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
    SHIPMENT_STATUS_ON_PACKING: frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
    SHIPMENT_STATUS_RELOCATING: frozenset({"manager", "admin", "shift_supervisor", "warehouse_head"}),
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

# Брак-отгрузка минует упаковку: draft → relocating «Перемещение» (задача кладовщику
# подготовить брак). relocating → awaiting_trip делает отдельный эндпоинт
# finish_defect_relocation: кладовщик выбирает места-источники, брак переезжает
# storage/defect → ready/defect в «Зону отгрузки».
SHIPMENT_TRANSITIONS_DEFECT: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT: SHIPMENT_STATUS_RELOCATING,
}

SHIPMENT_TRANSITION_ROLES_DEFECT: dict[str, frozenset[str]] = {
    SHIPMENT_STATUS_RELOCATING: frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
}

# До подготовки кладовщиком остатки не двигаются; из «Ожидает рейс» аннулирование
# выполняет автовозврат брака из зоны отгрузки на исходные места.
SHIPMENT_CANCELLABLE_STATUSES_DEFECT: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_AWAITING_TRIP,
})

SHIPMENT_EDITABLE_LINE_STATUSES_DEFECT: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
})

# Приоритет отгрузки — уровень срочности (меньше = срочнее), NULL = обычный.
SHIPMENT_PRIORITY_URGENT = 1
SHIPMENT_PRIORITY_HIGH   = 2

SHIPMENT_PRIORITY_LABELS: dict[int | None, str] = {
    SHIPMENT_PRIORITY_URGENT: "Срочно",
    SHIPMENT_PRIORITY_HIGH:   "Повышенный",
    None:                     "Обычный",
}

# ---------------------------------------------------------------------------
# Инвентарь — две оси статуса запаса (журнал zone_relocations)
# ---------------------------------------------------------------------------

# Операционный статус: что товар делает. «Отгружен» и «Списан» — терминальные
# стоки, в остатках не отображаются. «На приёмке» — виртуальный статус
# отображения (accepted_qty незавершённых поступлений), в журнал движений
# zone_relocations не пишется.
INV_OP_INTAKE      = "intake"
INV_OP_STORAGE     = "storage"
INV_OP_PACKING     = "packing"
INV_OP_READY       = "ready"
INV_OP_SHIPPED     = "shipped"
INV_OP_WRITTEN_OFF = "written_off"

INV_OP_LABELS: dict[str, str] = {
    INV_OP_INTAKE:      "На приёмке",
    INV_OP_STORAGE:     "На хранении",
    INV_OP_PACKING:     "На упаковке",
    INV_OP_READY:       "Готов к отгрузке",
    INV_OP_SHIPPED:     "Отгружен",
    INV_OP_WRITTEN_OFF: "Списан",
}

# Терминальные стоки журнала: движение «в» них уводит товар с остатков,
# движений «из» них не бывает (кроме сторно списания — отдельная фича).
INV_OP_SINKS: tuple[str, ...] = (INV_OP_SHIPPED, INV_OP_WRITTEN_OFF)

# Качество. «Не проверен» существует только внутри приёмки (уровень документа);
# после приёмки товар встаёт на остатки годным, брак фиксируется на упаковке
# или операцией смены качества.
INV_Q_GOOD   = "good"
INV_Q_DEFECT = "defect"

INV_QUALITY_LABELS: dict[str, str] = {
    INV_Q_GOOD:   "Годный",
    INV_Q_DEFECT: "Брак",
}

# Причины списания остатков (zone_relocations.reason у движений → written_off)
WRITEOFF_REASON_SHORTAGE      = "shortage"
WRITEOFF_REASON_DAMAGE        = "damage"
WRITEOFF_REASON_DISPOSAL      = "disposal"
WRITEOFF_REASON_CLIENT_RETURN = "client_return"
WRITEOFF_REASON_OTHER         = "other"

WRITEOFF_REASON_LABELS: dict[str, str] = {
    WRITEOFF_REASON_SHORTAGE:      "Недостача",
    WRITEOFF_REASON_DAMAGE:        "Порча",
    WRITEOFF_REASON_DISPOSAL:      "Утилизация брака",
    WRITEOFF_REASON_CLIENT_RETURN: "Возврат клиенту",
    WRITEOFF_REASON_OTHER:         "Прочее",
}

# Типы операций журнала отгрузок
SHIPMENT_OP_DOC_UPDATE = "doc_update"
SHIPMENT_OP_PRIORITY_UPDATE = "priority_update"
SHIPMENT_OP_PACK            = "pack"
SHIPMENT_OP_PACK_CORRECTION = "pack_correction"
SHIPMENT_OP_MOVE_RETURN     = "move_return"
SHIPMENT_OP_RELOCATE        = "relocate"
SHIPMENT_OP_SHIP            = "ship"

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
# Финансы — Счета (invoice_*)
# ---------------------------------------------------------------------------

# Денежные суммы счёта (total_amount, paid_amount, payment.amount) хранятся в
# КОПЕЙКАХ как INTEGER — финансовый модуль не должен накапливать ошибки
# округления float (прочие стоимости проекта в REAL — это осознанное отличие).

INVOICE_STATUS_DRAFT          = "draft"
INVOICE_STATUS_ISSUED         = "issued"
INVOICE_STATUS_PARTIALLY_PAID = "partially_paid"
INVOICE_STATUS_CLOSED         = "closed"
INVOICE_STATUS_CANCELLED      = "cancelled"

INVOICE_STATUSES_ALL: list[str] = [
    INVOICE_STATUS_DRAFT,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_PARTIALLY_PAID,
    INVOICE_STATUS_CLOSED,
    INVOICE_STATUS_CANCELLED,
]

INVOICE_STATUS_LABELS: dict[str, str] = {
    INVOICE_STATUS_DRAFT:          "Черновик",
    INVOICE_STATUS_ISSUED:         "Выставлен",
    INVOICE_STATUS_PARTIALLY_PAID: "Частично оплачен",
    INVOICE_STATUS_CLOSED:         "Завершён",
    INVOICE_STATUS_CANCELLED:      "Аннулирован",
}

# Активная задолженность — для алёрта «к оплате/просрочено», оплат, закрытия и
# признаков «срок наступил/просрочен». Черновик сюда НЕ входит: это ещё не
# выставленное обязательство.
INVOICE_ACTIVE_STATUSES: frozenset[str] = frozenset({
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_PARTIALLY_PAID,
})

# Редактируемые статусы — состав отгрузок/файлов можно менять, счёт можно
# аннулировать. Шире, чем active: добавляется черновик (его правят целиком).
INVOICE_MUTABLE_STATUSES: frozenset[str] = frozenset({
    INVOICE_STATUS_DRAFT,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_PARTIALLY_PAID,
})

# Типы операций журнала счетов (append-only)
INVOICE_OP_DOC_CREATE      = "doc_create"
INVOICE_OP_ISSUE           = "issue"
INVOICE_OP_DOC_UPDATE      = "doc_update"
INVOICE_OP_SHIPMENT_LINK   = "shipment_link"
INVOICE_OP_SHIPMENT_UNLINK = "shipment_unlink"
INVOICE_OP_DUE_DATE_CHANGE = "due_date_change"
INVOICE_OP_AMOUNT_CHANGE   = "amount_change"
INVOICE_OP_PAYMENT         = "payment"
INVOICE_OP_CLOSE           = "close"
INVOICE_OP_CANCEL          = "cancel"

# ---------------------------------------------------------------------------
# Расходы на материалы (хозрасходы)
# ---------------------------------------------------------------------------
# Суммы (material_expenses.amount) хранятся в КОПЕЙКАХ как INTEGER — как в счетах
# и табеле, чтобы денежный учёт не накапливал ошибок округления float.
# Количество (material_expenses.quantity) — NUMERIC: расходники бывают дробными
# (2.5 л, 0.5 кг), поэтому не INTEGER.

# Типы операций журнала расходов (append-only)
EXPENSE_OP_CREATE      = "create"
EXPENSE_OP_UPDATE      = "update"
EXPENSE_OP_DELETE      = "delete"
EXPENSE_OP_RESTORE     = "restore"
EXPENSE_OP_FILE_ADD    = "file_add"
EXPENSE_OP_FILE_DELETE = "file_delete"
EXPENSE_OP_PAY         = "pay"
EXPENSE_OP_CANCEL      = "cancel"

EXPENSE_OP_LABELS: dict[str, str] = {
    EXPENSE_OP_CREATE:      "Создание",
    EXPENSE_OP_UPDATE:      "Изменение",
    EXPENSE_OP_DELETE:      "Удаление",
    EXPENSE_OP_RESTORE:     "Восстановление",
    EXPENSE_OP_FILE_ADD:    "Файл прикреплён",
    EXPENSE_OP_FILE_DELETE: "Файл удалён",
    EXPENSE_OP_PAY:         "Оплачено",
    EXPENSE_OP_CANCEL:      "Аннулирование",
}

# Тип/источник расхода (kind). Единый реестр сводит хозрасходы, логистику рейсов,
# аренду склада и ЗП в одну таблицу material_expenses.
EXPENSE_KIND_MANUAL    = "manual"      # ручная разовая закупка
EXPENSE_KIND_LOGISTICS = "logistics"   # автоматически из рейса (стоимость логистики)
EXPENSE_KIND_RENT      = "rent"        # оплата склада (аренда)
EXPENSE_KIND_SALARY    = "salary"      # выплата ЗП сотруднику

EXPENSE_KINDS_ALL: tuple[str, ...] = (
    EXPENSE_KIND_MANUAL, EXPENSE_KIND_LOGISTICS, EXPENSE_KIND_RENT, EXPENSE_KIND_SALARY,
)
EXPENSE_KIND_LABELS: dict[str, str] = {
    EXPENSE_KIND_MANUAL:    "Хозрасход",
    EXPENSE_KIND_LOGISTICS: "Логистика",
    EXPENSE_KIND_RENT:      "Аренда",
    EXPENSE_KIND_SALARY:    "Зарплата",
}
# Видимость по ролям: менеджер видит только хозрасходы и логистику; аренда и ЗП —
# только админ. Реестр-список и сводка фильтруются этим набором (см. security).
EXPENSE_KINDS_MANAGER_VISIBLE: frozenset[str] = frozenset({
    EXPENSE_KIND_MANUAL, EXPENSE_KIND_LOGISTICS,
})
EXPENSE_KINDS_ADMIN_ONLY: frozenset[str] = frozenset({
    EXPENSE_KIND_RENT, EXPENSE_KIND_SALARY,
})

# Источник (origin) расхода — обратная ссылка на породивший объект.
EXPENSE_SOURCE_TRIP      = "trip"       # рейс (логистика)
EXPENSE_SOURCE_EMPLOYEE  = "employee"   # сотрудник (ЗП-оклад, авто-начисление)
EXPENSE_SOURCE_WAREHOUSE = "warehouse"  # склад (аренда)
EXPENSE_SOURCE_PAYROLL   = "payroll"    # выплата по табелю (ЗП почасовика), source_id = payroll_payments.id

# Статус оплаты расхода. Рейсовая логистика создаётся «ожидает оплаты»; ручной
# хозрасход по умолчанию «оплачено» (фиксация постфактум), но может быть и «ожидает».
EXPENSE_PAYMENT_AWAITING  = "awaiting"
EXPENSE_PAYMENT_PAID      = "paid"
EXPENSE_PAYMENT_CANCELLED = "cancelled"

EXPENSE_PAYMENT_STATUSES_ALL: tuple[str, ...] = (
    EXPENSE_PAYMENT_AWAITING, EXPENSE_PAYMENT_PAID, EXPENSE_PAYMENT_CANCELLED,
)
EXPENSE_PAYMENT_STATUS_LABELS: dict[str, str] = {
    EXPENSE_PAYMENT_AWAITING:  "Ожидает оплаты",
    EXPENSE_PAYMENT_PAID:      "Оплачен",
    EXPENSE_PAYMENT_CANCELLED: "Аннулирован",
}

# Системные категории, которые сидятся миграцией 0057 и используются авто-расходами
# (логистика рейса) и подсказками UI. Их имена резолвятся по name (best-effort).
EXPENSE_SYSTEM_CATEGORY_LOGISTICS = "Логистика"
EXPENSE_SYSTEM_CATEGORY_RENT      = "Аренда склада"
EXPENSE_SYSTEM_CATEGORY_SALARY    = "Зарплата"
EXPENSE_SYSTEM_CATEGORY_SEED: tuple[str, ...] = (
    EXPENSE_SYSTEM_CATEGORY_LOGISTICS,
    EXPENSE_SYSTEM_CATEGORY_RENT,
    EXPENSE_SYSTEM_CATEGORY_SALARY,
)

# Стартовое наполнение справочников расходов (сид миграции 0056 и dev-guard).
EXPENSE_CATEGORY_SEED: tuple[str, ...] = (
    "Склад", "Упаковка", "Уборка", "Туалет", "Прочее",
)
EXPENSE_PAYMENT_SOURCE_SEED: tuple[str, ...] = (
    "ИП Макс", "Саша", "Олег",
)

# ---------------------------------------------------------------------------
# Табель учёта рабочего времени и выплаты
# ---------------------------------------------------------------------------
# Ставка (employee_rates.rate_kopecks) и суммы выплат (payroll_payments.amount_kopecks)
# хранятся в КОПЕЙКАХ как INTEGER — как в модуле счетов, чтобы денежный учёт не
# накапливал ошибки округления float.

# Базовая смена и вычет обеда — основа расчёта часов за день.
TIMESHEET_DEFAULT_SHIFT_START = "08:00"
TIMESHEET_DEFAULT_SHIFT_END   = "20:00"
TIMESHEET_LUNCH_HOURS         = 1.0   # вычет обеда: часы за день = (уход − приход) − 1 ч

# Статус сотрудника в справочнике
EMPLOYEE_STATUS_ACTIVE   = "active"
EMPLOYEE_STATUS_ARCHIVED = "archived"
EMPLOYEE_STATUS_LABELS: dict[str, str] = {
    EMPLOYEE_STATUS_ACTIVE:   "Активен",
    EMPLOYEE_STATUS_ARCHIVED: "В архиве",
}

# Тип оплаты труда (в карточке сотрудника). hourly — ставка × часы из табеля;
# fixed — фиксированный оклад из карточки (employees.fixed_salary_kopecks).
EMPLOYEE_COMP_HOURLY = "hourly"
EMPLOYEE_COMP_FIXED  = "fixed"
EMPLOYEE_COMP_TYPES_ALL: tuple[str, ...] = (EMPLOYEE_COMP_HOURLY, EMPLOYEE_COMP_FIXED)
EMPLOYEE_COMP_LABELS: dict[str, str] = {
    EMPLOYEE_COMP_HOURLY: "Почасовая",
    EMPLOYEE_COMP_FIXED:  "Оклад (фикс)",
}

# Статус дня (производный, для UI). Хранится только is_absent; остальное считается.
#   worked  — есть факт по плану
#   planned — план есть, факта нет, день не закрыт (сегодня/будущее)
#   absent  — «не вышел» (план был, факта нет на прошедший день или отмечено явно)
#   noplan  — факт есть, плана не было
#   off     — выходной / нет записи
TIMESHEET_DAY_WORKED  = "worked"
TIMESHEET_DAY_PLANNED = "planned"
TIMESHEET_DAY_ABSENT  = "absent"
TIMESHEET_DAY_NOPLAN  = "noplan"
TIMESHEET_DAY_OFF     = "off"
TIMESHEET_DAY_LABELS: dict[str, str] = {
    TIMESHEET_DAY_WORKED:  "Отработал",
    TIMESHEET_DAY_PLANNED: "Запланирован",
    TIMESHEET_DAY_ABSENT:  "Не вышел",
    TIMESHEET_DAY_NOPLAN:  "Без плана",
    TIMESHEET_DAY_OFF:     "Выходной",
}

# Типы операций журнала табеля (append-only)
TIMESHEET_OP_PLAN_SET     = "plan_set"
TIMESHEET_OP_FACT_SET     = "fact_set"
TIMESHEET_OP_ABSENT_MARK  = "absent_mark"
TIMESHEET_OP_ABSENT_CLEAR = "absent_clear"
TIMESHEET_OP_NOTE         = "note"
TIMESHEET_OP_CLEARED      = "cleared"

# Типы выплат
PAYROLL_KIND_SETTLEMENT = "settlement"   # пятничный расчёт за неделю
PAYROLL_KIND_ADVANCE    = "advance"      # аванс по просьбе среди недели
PAYROLL_KIND_LABELS: dict[str, str] = {
    PAYROLL_KIND_SETTLEMENT: "Расчёт",
    PAYROLL_KIND_ADVANCE:    "Аванс",
}

# ---------------------------------------------------------------------------
# Кабинет клиента — границы видимости
# ---------------------------------------------------------------------------

# Клиент не видит черновики: документ появляется в кабинете с момента планирования.
CABINET_RECEIPT_VISIBLE_STATUSES: frozenset[str] = frozenset({
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_ON_REVIEW,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_CANCELLED,
})

CABINET_SHIPMENT_VISIBLE_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_PARTIALLY_SHIPPED,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_STATUS_COMPLETED_NO_GOODS,
    SHIPMENT_STATUS_CANCELLED,
})

# Журналы: клиенту отдаются только бизнес-события с готовыми русскими комментариями.
# 'advance' исключён намеренно — его комментарии содержат внутренние коды статусов.
CABINET_RECEIPT_OPS_VISIBLE: frozenset[str] = frozenset({
    RECEIPT_OP_INTAKE_START,
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_RECEIVING_CORRECTION,
    RECEIPT_OP_CANCEL,
})

CABINET_SHIPMENT_OPS_VISIBLE: frozenset[str] = frozenset({
    SHIPMENT_OP_PACK,
    SHIPMENT_OP_PACK_CORRECTION,
    SHIPMENT_OP_SHIP,
    "cancel",
})

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
