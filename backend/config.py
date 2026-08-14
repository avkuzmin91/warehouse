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

# Мобильный клиент (Capacitor) шлёт заголовок X-Client: mobile. В этом режиме
# refresh-токен ходит в теле ответа (cookie в нативной обёртке ненадёжна) —
# приложение хранит его в secure storage. См. docs/mobile-plan.md §6.1.
AUTH_CLIENT_HEADER = "X-Client"
AUTH_CLIENT_MOBILE = "mobile"

AUTH_RL_REFRESH_MAX = int(os.environ.get("AUTH_RATE_LIMIT_REFRESH_MAX", "60"))
AUTH_RL_REFRESH_WINDOW_SEC = float(os.environ.get("AUTH_RATE_LIMIT_REFRESH_WINDOW_SEC", "60"))
AUTH_RL_REGISTER_MAX = int(os.environ.get("AUTH_RATE_LIMIT_REGISTER_MAX", "5"))
AUTH_RL_REGISTER_WINDOW_SEC = float(os.environ.get("AUTH_RATE_LIMIT_REGISTER_WINDOW_SEC", "60"))
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
# Push-уведомления (FCM)
# ---------------------------------------------------------------------------

# Путь к JSON сервисного аккаунта Firebase; пусто — отправка пушей выключена.
FIREBASE_CREDENTIALS_FILE = (os.environ.get("FIREBASE_CREDENTIALS_FILE") or "").strip()

# Больше стольких новых задач за один тик = шторм (первая раскатка фичи, массовый
# импорт документов) — записываем без отправки, чтобы не заспамить устройства.
PUSH_STORM_THRESHOLD = int(os.environ.get("PUSH_STORM_THRESHOLD", "20"))

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
RECEIPT_STATUS_PARTIALLY_RECEIVED = "partially_received"
RECEIPT_STATUS_DONE              = "done"
RECEIPT_STATUS_CANCELLED         = "cancelled"

RECEIPT_STATUSES_ALL: frozenset[str] = frozenset({
    RECEIPT_STATUS_DRAFT,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_CANCELLED,
})

RECEIPT_STATUS_LABELS: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:              "Создание",
    RECEIPT_STATUS_PLANNED:            "В плане",
    RECEIPT_STATUS_PARTIALLY_RECEIVED: "Частично принято",
    RECEIPT_STATUS_DONE:               "Завершён",
    RECEIPT_STATUS_CANCELLED:          "Аннулирован",
}

RECEIPT_STATUS_TRANSITIONS: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:     RECEIPT_STATUS_PLANNED,
    # Дальше поступление двигает только рейс: приёмка идёт в разгрузке рейса
    # (planned → partially_received → done), отдельной карточной приёмки больше нет.
}

RECEIPT_STATUS_RU: dict[str, str] = {
    RECEIPT_STATUS_DRAFT:             "Создание",
    RECEIPT_STATUS_PLANNED:           "В плане",
    RECEIPT_STATUS_PARTIALLY_RECEIVED: "Частично принято",
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
# Терминальный исход «Задачи упаковки»: после раскладки по местам товар упакован
# и готов к отгрузке. Дальше его возит отдельный домен dispatch (привязка к рейсу
# и списание — там), задача упаковки на этом завершается.
SHIPMENT_STATUS_PACKED            = "packed"
# Завершено без отгрузки: после упаковки годного 0 (весь товар оказался браком),
# рейс не нужен. Терминальный исход, отдельный от `packed` — иначе попадёт в
# кандидаты на счёт и в метрику реальных отгрузок.
SHIPMENT_STATUS_COMPLETED_NO_GOODS = "completed_no_goods"
SHIPMENT_STATUS_CANCELLED         = "cancelled"

SHIPMENT_STATUSES_ALL: list[str] = [
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_PACKED,
    SHIPMENT_STATUS_COMPLETED_NO_GOODS,
    SHIPMENT_STATUS_CANCELLED,
]

# Терминальные статусы отгрузки (документ завершён, дальше не двигается).
SHIPMENT_TERMINAL_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_PACKED,
    SHIPMENT_STATUS_COMPLETED_NO_GOODS,
    SHIPMENT_STATUS_CANCELLED,
})

SHIPMENT_STATUS_LABELS: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT:             "Создание",
    SHIPMENT_STATUS_PACKING:           "В плане",
    SHIPMENT_STATUS_ON_PACKING:        "На упаковке",
    SHIPMENT_STATUS_RELOCATING:        "Перемещение",
    SHIPMENT_STATUS_PACKED:            "Упакован",
    SHIPMENT_STATUS_COMPLETED_NO_GOODS: "Завершён",
    SHIPMENT_STATUS_CANCELLED:         "Аннулирован",
}

# Плановые переходы через /advance. relocating → packed не здесь: его делает
# отдельный эндпоинт «Готово к рейсу» (раскладка по местам). packed — терминальный
# исход задачи упаковки; отгрузку к рейсу далее возит домен dispatch.
# draft → packing: менеджер ставит задачу — она сразу попадает в план склада.
SHIPMENT_TRANSITIONS: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT:      SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_PACKING:    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_ON_PACKING: SHIPMENT_STATUS_RELOCATING,
}

# Роли, которым разрешён переход НА данный статус (целевой статус → роли).
# В плане: менеджер ставит задачу. В плане → На упаковке: кладовщик передаёт товар.
# На упаковке → Перемещение: начальник смены упаковал годный/брак и передаёт кладовщику.
SHIPMENT_TRANSITION_ROLES: dict[str, frozenset[str]] = {
    SHIPMENT_STATUS_PACKING:    frozenset({"manager", "admin"}),
    SHIPMENT_STATUS_ON_PACKING: frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
    SHIPMENT_STATUS_RELOCATING: frozenset({"manager", "admin", "shift_supervisor", "warehouse_head"}),
}

# Аннулировать можно до передачи на упаковку включительно; в «На упаковке» — только
# пока нет ни одной упакованной единицы (гейт по факту упаковки — в роутере).
SHIPMENT_CANCELLABLE_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
})

SHIPMENT_REVERT_TRANSITIONS: dict[str, str] = {}

# Менеджерский возврат товарной задачи упаковки «на упаковку» (→ on_packing) из
# «Перемещение» или «Упаковано»: переупаковать/исправить. Для «Упаковано» при этом
# откатывается раскладка по местам (см. return_to_packing). Брак упаковку минует —
# для брак-отгрузки действие недоступно.
SHIPMENT_RETURN_TO_PACKING_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_STATUS_PACKED,
})

# Виды переупаковки (задача была поставлена с ошибкой, товар пакуется заново).
# Первый проход упаковки остаётся оплаченным; повторные pack-записи штампуются:
# free — за наш счёт (в производительности объём виден, деньги 0);
# paid — за счёт клиента (при завершении задачи автоматически создаётся запись
#        «Доп. работы»: кастомная цена за единицу либо стандартный тариф упаковки,
#        плюс работы сверх тарифа — удаление старой упаковки, пересборка коробов).
SHIPMENT_REPACK_FREE = "free"
SHIPMENT_REPACK_PAID = "paid"
SHIPMENT_REPACK_KINDS: frozenset[str] = frozenset({SHIPMENT_REPACK_FREE, SHIPMENT_REPACK_PAID})
# Системный вид работ для автосозданных записей платной переупаковки
# (find-or-create по имени — нейтральное значение, безопасно для новых инстансов).
EXTRA_INCOME_REPACK_CATEGORY_NAME = "Переупаковка"

SHIPMENT_EDITABLE_LINE_STATUSES: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
})

SHIPMENT_CARGO_GOOD   = "good"
SHIPMENT_CARGO_DEFECT = "defect"

# Брак-отгрузка минует упаковку: draft → relocating «Перемещение» (задача кладовщику
# подготовить брак). relocating → packed делает отдельный эндпоинт
# finish_defect_relocation: кладовщик выбирает места-источники, брак переезжает
# storage/defect → ready/defect в «Зону отгрузки».
SHIPMENT_TRANSITIONS_DEFECT: dict[str, str] = {
    SHIPMENT_STATUS_DRAFT: SHIPMENT_STATUS_RELOCATING,
}

SHIPMENT_TRANSITION_ROLES_DEFECT: dict[str, frozenset[str]] = {
    SHIPMENT_STATUS_RELOCATING: frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
}

# До завершения раскладки кладовщиком остатки не двигаются — отмена безопасна.
SHIPMENT_CANCELLABLE_STATUSES_DEFECT: frozenset[str] = frozenset({
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_RELOCATING,
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
# «Упаковано» — товар прошёл стол упаковки (и годный, и брак), но ещё НЕ готов к
# отгрузке: готовность наступает явным действием склада «Готово к рейсу»
# (finish_relocation, relocating → packed), которое и переводит годное packed → ready.
INV_OP_PACKED      = "packed"
INV_OP_READY       = "ready"
INV_OP_SHIPPED     = "shipped"
INV_OP_WRITTEN_OFF = "written_off"

INV_OP_LABELS: dict[str, str] = {
    INV_OP_INTAKE:      "На приёмке",
    INV_OP_STORAGE:     "На хранении",
    INV_OP_PACKING:     "На упаковке",
    INV_OP_PACKED:      "Упакован",
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

# Значимые события оборота: движения журнала, меняющие ОБЩИЙ остаток позиции.
# Внутренние переходы (хранение → упаковка → упаковано → готов к отгрузке, смена
# места, смена качества) остаток не меняют и в оборотную ведомость не попадают —
# для них есть журнал «Перемещения». Классификация движения — по осям от/к:
# из intake — приход, в intake — корректировка приёмки, в сток — расход,
# из стока — возврат.
STOCK_EVENT_RECEIPT          = "receipt"           # приход по поступлению (intake → …)
STOCK_EVENT_STOCK_ENTRY      = "stock_entry"       # заведение остатка без документа
STOCK_EVENT_RECEIPT_ADJUST   = "receipt_adjust"    # корректировка/сторно приёмки (… → intake)
STOCK_EVENT_SHIPMENT         = "shipment"          # отгрузка клиенту (… → shipped)
STOCK_EVENT_SHIPMENT_RETURN  = "shipment_return"   # возврат отгрузки при отмене рейса
STOCK_EVENT_WRITE_OFF        = "write_off"         # списание (… → written_off)
STOCK_EVENT_WRITE_OFF_UNDO   = "write_off_undo"    # откат списания
# Переводы между качествами общий остаток позиции не меняют, поэтому значимы
# только для оборота-среза по одному качеству (фильтр quality); без фильтра эти
# виды в ведомости не встречаются.
STOCK_EVENT_DEFECT_IN        = "defect_in"         # перевод в брак (good → defect)
STOCK_EVENT_DEFECT_OUT       = "defect_out"        # возврат в годный (defect → good)

STOCK_EVENT_LABELS: dict[str, str] = {
    STOCK_EVENT_RECEIPT:         "Поступление",
    STOCK_EVENT_STOCK_ENTRY:     "Заведение остатка",
    STOCK_EVENT_RECEIPT_ADJUST:  "Корректировка приёмки",
    STOCK_EVENT_SHIPMENT:        "Отгрузка",
    STOCK_EVENT_SHIPMENT_RETURN: "Возврат отгрузки",
    STOCK_EVENT_WRITE_OFF:       "Списание",
    STOCK_EVENT_WRITE_OFF_UNDO:  "Откат списания",
    STOCK_EVENT_DEFECT_IN:       "Перевод в брак",
    STOCK_EVENT_DEFECT_OUT:      "Возврат в годный",
}

# События с плюсом к остатку; остальные из STOCK_EVENT_LABELS — с минусом.
# Знак defect_in/defect_out зависит от среза качества (перевод в брак — приход
# для среза «брак», расход для среза «годный»), сюда они не входят.
STOCK_EVENT_INCOMING: tuple[str, ...] = (
    STOCK_EVENT_RECEIPT,
    STOCK_EVENT_STOCK_ENTRY,
    STOCK_EVENT_SHIPMENT_RETURN,
    STOCK_EVENT_WRITE_OFF_UNDO,
)

# ── Адресное хранение: ячейки стеллажей (unloading_zones со структурой адреса) ──
# Место хранения с координатами Помещение-Стеллаж-Секция-Этаж (код вида «1-А-10-1»).
# QR на ячейке несёт идентификатор записи (стабилен при переименовании адреса),
# человекочитаемый код печатается рядом. Префикс payload отличает QR места от ШК товара.
LOCATION_KIND_CELL    = "cell"      # адресная ячейка стеллажа
LOCATION_KIND_SPECIAL = "special"   # служебная зона (упаковка/отгрузка/прочее)
LOCATION_QR_PREFIX    = "wms:loc:"

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
# Админ перенёс бизнес-дату упаковки (историческая коррекция «указали не тот день»).
SHIPMENT_OP_PACK_DATE_MOVE  = "pack_date_move"
SHIPMENT_OP_MOVE_RETURN     = "move_return"
SHIPMENT_OP_RELOCATE        = "relocate"
SHIPMENT_OP_RETURN_TO_PACKING = "return_to_packing"
# Менеджер запустил переупаковку (ошибка постановки задачи) / платная переупаковка
# выставлена клиенту автосозданной записью «Доп. работы» при выходе в «Упаковано».
SHIPMENT_OP_REPACK_START  = "repack_start"
SHIPMENT_OP_REPACK_CHARGE = "repack_charge"
# Легаси: отклонение задачи начальником склада на удалённом этапе «Ожидает принятия».
# Константа нужна только для рендера исторических записей журнала.
SHIPMENT_OP_REJECT          = "reject"
SHIPMENT_OP_SHIP            = "ship"

# ---------------------------------------------------------------------------
# Отгрузки клиенту (dispatch_*) — коммерческо-логистическая сущность
# ---------------------------------------------------------------------------
# Отделена от «Задачи упаковки» (shipment_*, склад): менеджер набирает клиенту
# товар из готового к отгрузке (ready) и в пути, логист дробит её по рейсам.
# Связь со складом — только через журнальный остаток `ready` (по варианту×клиенту):
# задача упаковки его производит, отгрузка — потребляет (списание ready→shipped
# при выезде рейса). Документы друг на друга не ссылаются.

DISPATCH_STATUS_DRAFT             = "draft"
# Промежуточная очередь: состав передан, но годного остатка ещё нет (товар на упаковке).
# Как только весь спрос покрыт готовым остатком — фоновой цикл сам двигает в preparing.
DISPATCH_STATUS_AWAITING_PACKING  = "awaiting_packing"
DISPATCH_STATUS_PREPARING         = "preparing"
DISPATCH_STATUS_AWAITING_TRIP     = "awaiting_trip"
DISPATCH_STATUS_PARTIALLY_SHIPPED = "partially_shipped"
DISPATCH_STATUS_SHIPPED           = "shipped"
DISPATCH_STATUS_CANCELLED         = "cancelled"

DISPATCH_STATUSES_ALL: list[str] = [
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_AWAITING_PACKING,
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
    DISPATCH_STATUS_SHIPPED,
    DISPATCH_STATUS_CANCELLED,
]

# Терминальные статусы (документ завершён, дальше не двигается).
DISPATCH_TERMINAL_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_SHIPPED,
    DISPATCH_STATUS_CANCELLED,
})

DISPATCH_STATUS_LABELS: dict[str, str] = {
    DISPATCH_STATUS_DRAFT:             "Создание",
    DISPATCH_STATUS_AWAITING_PACKING:  "Ожидание упаковки",
    DISPATCH_STATUS_PREPARING:         "Подготовка отгрузки",
    DISPATCH_STATUS_AWAITING_TRIP:     "Ожидает рейс",
    DISPATCH_STATUS_PARTIALLY_SHIPPED: "Частично отгружено",
    DISPATCH_STATUS_SHIPPED:           "Отгружено",
    DISPATCH_STATUS_CANCELLED:         "Аннулирована",
}

# Состав/поля документа правятся в черновике и пока отгрузка ждёт упаковки
# (менеджер корректирует план, пока склад пакует). С preparing состав заморожен.
DISPATCH_EDITABLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_AWAITING_PACKING,
})

# Вложения и ссылку по строке менеджер правит и на подготовке — поправить
# ошибочно прикреплённый файл/ссылку, пока кладовщик ещё собирает отгрузку.
DISPATCH_ATTACHMENT_EDITABLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_AWAITING_PACKING,
    DISPATCH_STATUS_PREPARING,
})

# Аннулировать можно, пока ничего не уехало (до первого рейса). В «Ожидании упаковки»
# остаток не двигали — отмена безопасна, как из черновика.
DISPATCH_CANCELLABLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_AWAITING_PACKING,
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_AWAITING_TRIP,
})

# «Вернуть на корректировку»: откат в черновик, пока ничего не уехало рейсом. Из
# «Ожидает рейс» подготовленный товар сторнируется на исходные места (return_prepared_stock).
# После первого выезда (partially_shipped/shipped) возврата нет — только отмена рейса.
DISPATCH_RETURNABLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_AWAITING_PACKING,
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_AWAITING_TRIP,
})

# Статусы, в которых отгрузка — кандидат на привязку к рейсу (есть готовый остаток).
# Рейс можно заказать как на «Ожидает рейс», так и на ещё готовящиеся кладовщиком
# («Подготовка отгрузки») — товар всё равно лежит в `ready`, спишется при выезде.
DISPATCH_TRIP_SELECTABLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
})

DISPATCH_CARGO_GOOD   = "good"
DISPATCH_CARGO_DEFECT = "defect"
# Годный без упаковки: возврат товара заказчику со хранения, минуя задачу упаковки.
# Источник — `storage` (good); подготовка свозит его в зону отгрузки, как у брака.
DISPATCH_CARGO_GOOD_UNPACKED = "good_unpacked"

DISPATCH_CARGO_TYPES: tuple[str, ...] = (
    DISPATCH_CARGO_GOOD, DISPATCH_CARGO_GOOD_UNPACKED, DISPATCH_CARGO_DEFECT,
)

# Можно ли распределять/отгружать ГОДНЫЙ прямо из «Упаковано» (`packed`), не дожидаясь
# раскладки кладовщиком в зону отгрузки («Готово к рейсу», packed → ready). Сейчас этот
# шаг — формальная галочка, поэтому годный считается доступным к рейсу уже упакованным:
# распределение и выезд берут пул ready+packed, упаковочная задача закрывается по факту
# отъезда. Когда «Готово к рейсу» станет реальным физическим перемещением — поставить
# False: вернётся прежнее поведение (источник только `ready`, нужен awaiting_trip). Брак
# этим флагом не затрагивается (он всегда едет с хранения через подготовку).
DISPATCH_ALLOW_SHIP_FROM_PACKED = True

# Перевод draft → preparing («Подготовка отгрузки») делает менеджер (ставит задачу
# кладовщику); гейт — весь товар покрыт свободным остатком `ready` и имеет SKU.
# preparing → awaiting_trip («Ожидает рейс») отмечает кладовщик, закончив подготовку.
# awaiting_trip/preparing → (partially_shipped/shipped) — при выезде привязанного
# рейса (логистика), вне ручных переходов.
DISPATCH_TRANSITION_ROLES: dict[str, frozenset[str]] = {
    DISPATCH_STATUS_PREPARING:     frozenset({"manager", "admin"}),
    DISPATCH_STATUS_AWAITING_TRIP: frozenset({"manager", "admin", "warehouse_manager", "warehouse_head"}),
}

# Приоритет — как у задачи упаковки (меньше = срочнее), NULL = обычный.
DISPATCH_PRIORITY_URGENT = 1
DISPATCH_PRIORITY_HIGH   = 2
DISPATCH_PRIORITY_LABELS: dict[int | None, str] = {
    DISPATCH_PRIORITY_URGENT: "Срочно",
    DISPATCH_PRIORITY_HIGH:   "Повышенный",
    None:                     "Обычный",
}

# Типы операций журнала отгрузок клиенту (append-only)
DISPATCH_OP_DOC_CREATE      = "doc_create"
DISPATCH_OP_DOC_UPDATE      = "doc_update"
DISPATCH_OP_PRIORITY_UPDATE = "priority_update"
DISPATCH_OP_LINE_ADD        = "line_add"
DISPATCH_OP_LINE_UPDATE     = "line_update"
DISPATCH_OP_LINE_DELETE     = "line_delete"
DISPATCH_OP_ADVANCE         = "advance"
DISPATCH_OP_PREPARE         = "prepare"
DISPATCH_OP_SHIP            = "ship"
DISPATCH_OP_CLOSE_SHORT     = "close_short"
DISPATCH_OP_CANCEL          = "cancel"
DISPATCH_OP_RETURN          = "return_to_draft"

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
TRIP_OP_RECEIVE_CORRECTION = "receive_correction"
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
INVOICE_OP_RECEIPT_LINK    = "receipt_link"
INVOICE_OP_RECEIPT_UNLINK  = "receipt_unlink"
INVOICE_OP_DUE_DATE_CHANGE = "due_date_change"
INVOICE_OP_AMOUNT_CHANGE   = "amount_change"
INVOICE_OP_PAYMENT         = "payment"
INVOICE_OP_CLOSE           = "close"
INVOICE_OP_CANCEL          = "cancel"
INVOICE_OP_EXTRA_LINK      = "extra_income_link"
INVOICE_OP_EXTRA_UNLINK    = "extra_income_unlink"
INVOICE_OP_STORAGE_LINK    = "storage_link"
INVOICE_OP_STORAGE_UNLINK  = "storage_unlink"
INVOICE_OP_DISCOUNT_ADD    = "discount_add"
INVOICE_OP_DISCOUNT_REMOVE = "discount_remove"

# ---------------------------------------------------------------------------
# Аналитика расчётов: старение долга
# ---------------------------------------------------------------------------
# Бакеты старения — (ключ, подпись, нижняя граница дней вкл., верхняя вкл. или None).
# Дебиторка стареет по ДНЯМ ПРОСРОЧКИ (дата отчёта − due_date): у счёта есть срок
# расчёта. Кредиторка — по ВОЗРАСТУ ДОЛГА (дата отчёта − spent_on): у расхода срока
# оплаты нет, поэтому «просрочка» для него не определена, меряем сколько висит.

RECEIVABLE_AGING_BUCKETS: list[tuple[str, str, int | None, int | None]] = [
    ("current",  "Срок не наступил", None,  0),
    ("d1_7",     "1–7 дней",            1,  7),
    ("d8_30",    "8–30 дней",           8,  30),
    ("d31_60",   "31–60 дней",         31,  60),
    ("d60_plus", "Более 60 дней",      61,  None),
]

PAYABLE_AGING_BUCKETS: list[tuple[str, str, int | None, int | None]] = [
    ("d0_7",     "До 7 дней",        None,  7),
    ("d8_30",    "8–30 дней",           8,  30),
    ("d31_60",   "31–60 дней",         31,  60),
    ("d60_plus", "Более 60 дней",      61,  None),
]


def aging_bucket_key(buckets, days: int) -> str:
    """Ключ бакета старения по количеству дней (границы включительно, None — открыто)."""
    for key, _label, lo, hi in buckets:
        if (lo is None or days >= lo) and (hi is None or days <= hi):
            return key
    return buckets[-1][0]

# ---------------------------------------------------------------------------
# Доп. работы (прочие доходы): переборка брака, переклейка ШК и т.п.
# ---------------------------------------------------------------------------
# Суммы (extra_income_entries.amount_kop) — КОПЕЙКИ INTEGER, как счета и расходы.
# Запись атрибутируется в P&L по entry_date (день работы) и может входить
# не более чем в один активный счёт (invoice_extra_income).

EXTRA_INCOME_OP_CREATE = "create"
EXTRA_INCOME_OP_UPDATE = "update"
EXTRA_INCOME_OP_DELETE = "delete"

EXTRA_INCOME_OP_LABELS: dict[str, str] = {
    EXTRA_INCOME_OP_CREATE: "Создание",
    EXTRA_INCOME_OP_UPDATE: "Изменение",
    EXTRA_INCOME_OP_DELETE: "Удаление",
}

EXTRA_INCOME_CATEGORY_SEED: tuple[str, ...] = (
    "Переборка брака",
    "Переклейка ШК",
    "Прочие работы",
)

# ---------------------------------------------------------------------------
# Платное хранение остатков (storage billing)
# ---------------------------------------------------------------------------
# Тариф клиента (client_storage_prices) effective-dated; запись несёт единицу
# тарификации, ставку за единицу в день (КОПЕЙКИ INTEGER) и бесплатный период
# (календарные дни). Начало отсчёта хранения = effective_from самой ранней
# записи тарифа — до неё начислений нет (ставка НЕ «тянется назад», в отличие
# от pricing.price_on). Начисления — append-only журнал storage_charges,
# в P&L входят источником «Хранение» по charge_date.

STORAGE_UNIT_PIECE  = "piece"
STORAGE_UNIT_BOX    = "box"
STORAGE_UNIT_PALLET = "pallet"

STORAGE_UNITS: tuple[str, ...] = (STORAGE_UNIT_PIECE, STORAGE_UNIT_BOX, STORAGE_UNIT_PALLET)

STORAGE_UNIT_LABELS: dict[str, str] = {
    STORAGE_UNIT_PIECE:  "Штука",
    STORAGE_UNIT_BOX:    "Короб",
    STORAGE_UNIT_PALLET: "Палета",
}

# ---------------------------------------------------------------------------
# FBS-маркетплейсы (Ozon / Wildberries)
# ---------------------------------------------------------------------------
# Фаза 1 — read-only монитор: заказы тянутся polling'ом, статусы МП в ядро
# не тащим — храним сырой external_status и нормализуем в свой набор.
# Неизвестный статус МП нормализуется в in_progress (заказ жив, опрашиваем дальше).

MP_OZON = "ozon"
MP_WB = "wb"

MARKETPLACES: tuple[str, ...] = (MP_OZON, MP_WB)

MP_ACCOUNT_STATUS_ACTIVE = "active"
MP_ACCOUNT_STATUS_PAUSED = "paused"

MP_ACCOUNT_STATUSES: tuple[str, ...] = (MP_ACCOUNT_STATUS_ACTIVE, MP_ACCOUNT_STATUS_PAUSED)

MP_ORDER_STATUS_NEW = "new"                  # ждёт сборки
MP_ORDER_STATUS_IN_PROGRESS = "in_progress"  # подтверждён/собран продавцом, ещё у нас
MP_ORDER_STATUS_SHIPPED = "shipped"          # передан в доставку МП
MP_ORDER_STATUS_DONE = "done"                # доставлен покупателю
MP_ORDER_STATUS_CANCELLED = "cancelled"

MP_ORDER_STATUSES: tuple[str, ...] = (
    MP_ORDER_STATUS_NEW, MP_ORDER_STATUS_IN_PROGRESS, MP_ORDER_STATUS_SHIPPED,
    MP_ORDER_STATUS_DONE, MP_ORDER_STATUS_CANCELLED,
)

# Терминальные: воркер перестаёт опрашивать заказ, из списков скрыты по умолчанию.
MP_ORDER_TERMINAL_STATUSES: frozenset[str] = frozenset({
    MP_ORDER_STATUS_DONE, MP_ORDER_STATUS_CANCELLED,
})

MP_LINK_SOURCE_BARCODE = "barcode_auto"
MP_LINK_SOURCE_MANUAL = "manual"

MP_SYNC_KIND_ORDERS = "orders"
MP_SYNC_KIND_CATALOG = "catalog"
MP_SYNC_KIND_CHECK = "check"

MP_DEADLINE_SOURCE_API = "api"
MP_DEADLINE_SOURCE_ESTIMATED = "estimated"

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
EXPENSE_OP_PAYMENT     = "payment"   # частичная/полная оплата (запись в expense_payments)
EXPENSE_OP_UNPAY       = "unpay"
EXPENSE_OP_CANCEL      = "cancel"

EXPENSE_OP_LABELS: dict[str, str] = {
    EXPENSE_OP_CREATE:      "Создание",
    EXPENSE_OP_UPDATE:      "Изменение",
    EXPENSE_OP_DELETE:      "Удаление",
    EXPENSE_OP_RESTORE:     "Восстановление",
    EXPENSE_OP_FILE_ADD:    "Файл прикреплён",
    EXPENSE_OP_FILE_DELETE: "Файл удалён",
    EXPENSE_OP_PAY:         "Оплачено",
    EXPENSE_OP_PAYMENT:     "Оплата",
    EXPENSE_OP_UNPAY:       "Оплата отменена",
    EXPENSE_OP_CANCEL:      "Аннулирование",
}

# Тип/источник расхода (kind). Единый реестр сводит хозрасходы, логистику рейсов,
# аренду склада и ЗП в одну таблицу material_expenses.
EXPENSE_KIND_MANUAL    = "manual"      # ручная разовая закупка
EXPENSE_KIND_LOGISTICS = "logistics"   # автоматически из рейса (стоимость логистики)
EXPENSE_KIND_RENT      = "rent"        # оплата склада (аренда)
EXPENSE_KIND_SALARY    = "salary"      # выплата ЗП сотруднику
EXPENSE_KIND_RECURRING = "recurring"   # авто из шаблона регулярного расхода (погрузчик и т.п.)
EXPENSE_KIND_DISCOUNT  = "discount"    # автоматически из скидки в счёте клиенту

EXPENSE_KINDS_ALL: tuple[str, ...] = (
    EXPENSE_KIND_MANUAL, EXPENSE_KIND_LOGISTICS, EXPENSE_KIND_RENT, EXPENSE_KIND_SALARY,
    EXPENSE_KIND_RECURRING, EXPENSE_KIND_DISCOUNT,
)
EXPENSE_KIND_LABELS: dict[str, str] = {
    EXPENSE_KIND_MANUAL:    "Хозрасход",
    EXPENSE_KIND_LOGISTICS: "Логистика",
    EXPENSE_KIND_RENT:      "Аренда",
    EXPENSE_KIND_SALARY:    "Зарплата",
    EXPENSE_KIND_RECURRING: "Регулярный",
    EXPENSE_KIND_DISCOUNT:  "Скидка клиенту",
}
# Видимость по ролям: менеджер видит хозрасходы, логистику, регулярные расходы и скидки;
# аренда и ЗП — только админ. Реестр-список и сводка фильтруются этим набором (см. security).
EXPENSE_KINDS_MANAGER_VISIBLE: frozenset[str] = frozenset({
    EXPENSE_KIND_MANUAL, EXPENSE_KIND_LOGISTICS, EXPENSE_KIND_RECURRING, EXPENSE_KIND_DISCOUNT,
})
EXPENSE_KINDS_ADMIN_ONLY: frozenset[str] = frozenset({
    EXPENSE_KIND_RENT, EXPENSE_KIND_SALARY,
})

# Источник (origin) расхода — обратная ссылка на породивший объект.
EXPENSE_SOURCE_TRIP      = "trip"       # рейс (логистика)
EXPENSE_SOURCE_EMPLOYEE  = "employee"   # сотрудник (ЗП-оклад, авто-начисление)
EXPENSE_SOURCE_WAREHOUSE = "warehouse"  # склад (аренда)
EXPENSE_SOURCE_PAYROLL   = "payroll"    # выплата по табелю (ЗП почасовика), source_id = payroll_payments.id
EXPENSE_SOURCE_RECURRING = "recurring"  # шаблон регулярного расхода, source_id = recurring_expenses.id
EXPENSE_SOURCE_INVOICE_DISCOUNT = "invoice_discount"  # скидка в счёте, source_id = invoice_discounts.id

# Подтип ЗП (производный, не хранится): оклад vs табель. На витринах ЗП разносится на
# две строки, чтобы фикс и почасовая не смешивались. Оклад — авто-начисление по сотруднику
# (source_kind=employee), табель — зеркало выплаты по табелю (source_kind=payroll).
EXPENSE_SALARY_SUBTYPE_FIXED     = "fixed"
EXPENSE_SALARY_SUBTYPE_TIMESHEET = "timesheet"
EXPENSE_SALARY_SUBTYPE_LABELS: dict[str, str] = {
    EXPENSE_SALARY_SUBTYPE_FIXED:     "Оклад (фикс)",
    EXPENSE_SALARY_SUBTYPE_TIMESHEET: "Табель (почасовая)",
}
# source_kind расхода-ЗП → подтип.
EXPENSE_SALARY_SOURCE_SUBTYPE: dict[str, str] = {
    EXPENSE_SOURCE_EMPLOYEE: EXPENSE_SALARY_SUBTYPE_FIXED,
    EXPENSE_SOURCE_PAYROLL:  EXPENSE_SALARY_SUBTYPE_TIMESHEET,
}

# Периодичность регулярного расхода: ежедневно или раз в месяц в заданное число.
RECURRING_FREQ_DAILY   = "daily"
RECURRING_FREQ_MONTHLY = "monthly"
RECURRING_FREQ_ALL: tuple[str, ...] = (RECURRING_FREQ_DAILY, RECURRING_FREQ_MONTHLY)
RECURRING_FREQ_LABELS: dict[str, str] = {
    RECURRING_FREQ_DAILY:   "Ежедневно",
    RECURRING_FREQ_MONTHLY: "Ежемесячно",
}

# Статус оплаты расхода. Рейсовая логистика создаётся «ожидает оплаты»; ручной
# хозрасход по умолчанию «оплачено» (фиксация постфактум), но может быть и «ожидает».
EXPENSE_PAYMENT_AWAITING  = "awaiting"
EXPENSE_PAYMENT_PARTIAL   = "partially_paid"
EXPENSE_PAYMENT_PAID      = "paid"
EXPENSE_PAYMENT_CANCELLED = "cancelled"

EXPENSE_PAYMENT_STATUSES_ALL: tuple[str, ...] = (
    EXPENSE_PAYMENT_AWAITING, EXPENSE_PAYMENT_PARTIAL, EXPENSE_PAYMENT_PAID, EXPENSE_PAYMENT_CANCELLED,
)
EXPENSE_PAYMENT_STATUS_LABELS: dict[str, str] = {
    EXPENSE_PAYMENT_AWAITING:  "Ожидает оплаты",
    EXPENSE_PAYMENT_PARTIAL:   "Частично оплачен",
    EXPENSE_PAYMENT_PAID:      "Оплачен",
    EXPENSE_PAYMENT_CANCELLED: "Аннулирован",
}

# Системные категории, которые сидятся миграцией 0057 и используются авто-расходами
# (логистика рейса) и подсказками UI. Их имена резолвятся по name (best-effort).
EXPENSE_SYSTEM_CATEGORY_LOGISTICS = "Логистика"
EXPENSE_SYSTEM_CATEGORY_RENT      = "Аренда склада"
EXPENSE_SYSTEM_CATEGORY_SALARY    = "Зарплата"
EXPENSE_SYSTEM_CATEGORY_DISCOUNT  = "Скидки клиентам"  # авто-расход скидки в счёте (сид 0088)
# Виртуальные категории аналитики для разнесения ЗП на оклад/табель (в справочнике
# категорий их нет, id=None — как и у общей «Зарплата»).
EXPENSE_SYSTEM_CATEGORY_SALARY_FIXED     = "Оклад (фикс)"
EXPENSE_SYSTEM_CATEGORY_SALARY_TIMESHEET = "Табель (почасовая)"
EXPENSE_SYSTEM_CATEGORY_SEED: tuple[str, ...] = (
    EXPENSE_SYSTEM_CATEGORY_LOGISTICS,
    EXPENSE_SYSTEM_CATEGORY_RENT,
    EXPENSE_SYSTEM_CATEGORY_SALARY,
    EXPENSE_SYSTEM_CATEGORY_DISCOUNT,
)

# Стартовое наполнение справочников расходов (сид миграции 0056 и dev-guard).
EXPENSE_CATEGORY_SEED: tuple[str, ...] = (
    "Склад", "Упаковка", "Уборка", "Туалет", "Прочее",
)
# Нейтральные значения: сид выполняется на КАЖДОМ новом инстансе (клиентском),
# поэтому здесь нет имён конкретной компании; свои источники добавляются в UI.
# Уже развёрнутые базы не затрагиваются — миграция 0056 на них давно применена.
EXPENSE_PAYMENT_SOURCE_SEED: tuple[str, ...] = (
    "Основной счёт", "Наличные",
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

# Переработка: порог считается по времени НА СМЕНЕ (уход − приход, без вычета обеда),
# обед вычитается из базовой части. Часы сверх порога оплачиваются с повышающим
# коэффициентом: первые TIER1_HOURS — TIER1_MULT, дальше — TIER2_MULT.
# Правило применяется к дням начиная с EFFECTIVE_FROM (начало расчётной недели):
# закрытые прошлые недели и P&L прошлых месяцев пересчитываться не должны.
TIMESHEET_OVERTIME_THRESHOLD_HOURS = 12.0
TIMESHEET_OVERTIME_TIER1_HOURS     = 4.0
TIMESHEET_OVERTIME_TIER1_MULT      = 1.3
TIMESHEET_OVERTIME_TIER2_MULT      = 1.5
TIMESHEET_OVERTIME_EFFECTIVE_FROM  = "2026-08-08"

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

# Статус дня (производный, для UI). Хранятся is_absent и not_called; остальное считается.
#   worked     — есть факт по плану
#   planned    — план есть, факта нет, день не закрыт (сегодня/будущее)
#   absent     — «не вышел» (план был, факта нет на прошедший день или отмечено явно)
#   noplan     — факт есть, плана не было
#   not_called — «не вызван»: склад намеренно не вывел сотрудника (нет товара и т.п.),
#                не прогул и не оплачивается; план может сохраняться
#   off        — выходной / нет записи
TIMESHEET_DAY_WORKED     = "worked"
TIMESHEET_DAY_PLANNED    = "planned"
TIMESHEET_DAY_ABSENT     = "absent"
TIMESHEET_DAY_NOPLAN     = "noplan"
TIMESHEET_DAY_NOT_CALLED = "not_called"
TIMESHEET_DAY_OFF        = "off"
TIMESHEET_DAY_LABELS: dict[str, str] = {
    TIMESHEET_DAY_WORKED:     "Отработал",
    TIMESHEET_DAY_PLANNED:    "Запланирован",
    TIMESHEET_DAY_ABSENT:     "Не вышел",
    TIMESHEET_DAY_NOPLAN:     "Без плана",
    TIMESHEET_DAY_NOT_CALLED: "Не вызван",
    TIMESHEET_DAY_OFF:        "Выходной",
}

# Типы операций журнала табеля (append-only)
TIMESHEET_OP_PLAN_SET         = "plan_set"
TIMESHEET_OP_FACT_SET         = "fact_set"
TIMESHEET_OP_ABSENT_MARK      = "absent_mark"
TIMESHEET_OP_ABSENT_CLEAR     = "absent_clear"
TIMESHEET_OP_NOT_CALLED_MARK  = "not_called_mark"
TIMESHEET_OP_NOT_CALLED_CLEAR = "not_called_clear"
TIMESHEET_OP_NOTE             = "note"
TIMESHEET_OP_CLEARED          = "cleared"

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
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_CANCELLED,
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

# Клиентская отгрузка = домен dispatch. Клиент видит её с момента передачи в
# подготовку (черновик внутренний). Журнал — только человекочитаемые события
# (отгружено / аннулировано); служебный advance с внутренними кодами скрыт.
CABINET_DISPATCH_VISIBLE_STATUSES: frozenset[str] = frozenset({
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
    DISPATCH_STATUS_SHIPPED,
    DISPATCH_STATUS_CANCELLED,
})

CABINET_DISPATCH_OPS_VISIBLE: frozenset[str] = frozenset({
    DISPATCH_OP_SHIP,
    DISPATCH_OP_CLOSE_SHORT,
    DISPATCH_OP_CANCEL,
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
    "sort_order": "d.sort_order",
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
