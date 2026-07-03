# Warehouse WMS — Claude instructions

Полный свод архитектурных правил и конвенций проекта. **Любой новый код должен соответствовать этому документу.** При конфликте с задачей — сначала явно указать конфликт, не менять архитектуру молча.

---

## AI Agent Workflow

Перед любым изменением кода:

1. Прочитать `CLAUDE.md` и `AGENTS.md` целиком.
2. Найти **похожую реализацию** в проекте. Эталонные домены: `receipts` (поступления), `dispatch` (отгрузка клиенту), `shipments` (задача упаковки). Внимание: «отгрузка клиенту» живёт в `dispatch`, а не в `shipments` — shipments после расщепления остался только задачей упаковки склада.
3. Изучить связанные backend/frontend файлы (router → service → schemas → api → feature).
4. Сделать **минимально необходимое** изменение в рамках существующих слоёв и паттернов.
5. **Не менять архитектуру** (слои, структуру модулей, базовые хелперы) без явного запроса пользователя.
6. После изменения:
   - запустить проверку типов / сборку / тесты, **или**
   - явно написать, какие проверки не запускались и почему.

При расхождении инструкции в задаче с этим файлом — остановиться, описать конфликт пользователю, дождаться решения.

---

## 1. Стек и точки входа

| Часть | Стек | Точка входа |
|---|---|---|
| Backend | FastAPI + psycopg + Alembic | [backend/app.py](backend/app.py) |
| Frontend | React + Vite + react-router-dom | [frontend/src/main.tsx](frontend/src/main.tsx) |
| Mobile | Capacitor + React (отдельное приложение «Склад») | [mobile/src/](mobile/src/), [mobile/capacitor.config.ts](mobile/capacitor.config.ts) |
| БД | PostgreSQL | миграции в [backend/alembic/versions/](backend/alembic/versions/) |
| Dev | Docker Compose | [docker-compose.dev.yml](docker-compose.dev.yml) |
| Backend tests | pytest | [backend/tests/](backend/tests/), [backend/pytest.ini](backend/pytest.ini) |
| CI / Deploy | GitHub Actions | [.github/workflows/deploy.yml](.github/workflows/deploy.yml) |

Backend dev: `cd backend && python -m uvicorn app:app --host 127.0.0.1 --port 8000`
Frontend dev: запускается через docker-compose или `npm run dev` в `frontend/`.

При работе через docker-compose backend **не** перезагружается сам — после правок выполнить `docker restart wms_dev_backend`.

### Деплой

CI-only деплой (ADR [docs/adr/0001](docs/adr/0001-ci-only-deployment-via-github-actions.md)): push в `develop` → test-окружение, push в `main` → prod. Перед деплоем job `ci` гоняет backend pytest (живая PostgreSQL + alembic) и сборку frontend — красный CI блокирует деплой. **Без явной команды пользователя в `main` не пушить.** Rollback — `workflow_dispatch` с нужным `git_ref`.

### Backend-модули (обзор)

Каждый домен — в `backend/modules/<домен>/`. Ориентир, где что живёт:

| Модуль | Что это |
|---|---|
| `auth`, `users` | JWT + refresh-сессии (cookie `wms_rt`, мобильный режим `X-Client: mobile`), rate-limit; учётные записи |
| `dictionaries` | справочники (clients, colors, sizes, warehouses, carriers, positions, own_warehouses, ...) |
| `products` | товары и варианты: SKU (+`sku_pending`), barcode, фото |
| `receipts` | поступления `WH-xxxxx`; приёмка идёт через рейс (разгрузка) |
| `shipments` | «Задача упаковки» склада; терминальный исход — `packed` |
| `dispatch` | «Отгрузка» клиенту `DSP-xxxx`; дробление по рейсам через `trip_alloc` |
| `logistics` | рейсы (trips) inbound/outbound, привязка документов, расходы рейса |
| `balances` | остатки (двухосевая модель), перемещения, списания |
| `locations` | адресное хранение: ячейки, QR-этикетки |
| `scan` | контекст по отсканированному ШК/QR |
| `tasks` | карточки-задания «Мои задачи» |
| `dashboard` | сводка главного экрана |
| `cabinet` | личный кабинет клиента, `/cabinet/*` (read-only, изоляция по `client_id`) |
| `invoices` | счета; **суммы в копейках INTEGER** |
| `expenses` | единый реестр расходов: хозрасходы / логистика / аренда / ЗП (аренда и ЗП — admin-only) |
| `recurring_expenses` | шаблоны регулярных расходов, авто-начисление в `_accrual_loop` |
| `pnl` | «Доходы и расходы» (P&L), `/pnl/*` |
| `timesheet` | табель (неделя Сб→Пт), ставки effective-dated, выплаты |
| `production_calendar`, `warehouse_rent` | произв. календарь (6/1); ставки аренды складов effective-dated |
| `pricing`, `pallet_pricing`, `box_pricing` | клиентские тарифы: логистика, палеты, короба (все effective-dated) |
| `inventory` | вспомогательные lookup'ы инвентаря (исторически только router.py) |

---

## 2. База данных

### Адаптер и базовые правила

PostgreSQL через `psycopg` с пулом соединений и адаптером в [backend/dbconn.py](backend/dbconn.py):

- Запросы пишутся с `?`-плейсхолдерами — адаптер сам заменяет на `%s`.
- Строки результата — `dict`-подобные (`row["col"]`).
- Использовать только через контекстный менеджер:

```python
from dbconn import get_connection

with get_connection() as conn:
    row = conn.execute("SELECT * FROM receipt_docs WHERE id = ?", (doc_id,)).fetchone()
    rows = conn.execute("SELECT * FROM receipt_lines WHERE doc_id = ?", (doc_id,)).fetchall()
    conn.execute("UPDATE receipt_docs SET status = ? WHERE id = ?", (new_status, doc_id))
    conn.commit()
```

- Boolean — это `INTEGER 0/1`, **не** `TRUE`/`FALSE`. Канонический фильтр soft-delete: `COALESCE(is_deleted, 0) = 0`.
- Идентификаторы — `str(uuid4())`.
- Timestamps — `datetime.now(UTC).isoformat()` (строка ISO 8601).

### Inventory-таблицы

**Receipts (поступления):**
- `receipt_docs` — документы (id, doc_number `WH-00001`, client_id, status, ...)
- `receipt_lines` — строки (product, color, size, planned_qty, storage_zone_*)
- `receipt_ops` — журнал операций (op_type, qty, reason, comment)

**Shipments («Задача упаковки»):**
- `shipment_docs`, `shipment_lines`, `shipment_ops`, `shipment_line_files`

**Dispatch («Отгрузка» клиенту):**
- `dispatch_docs`, `dispatch_lines`, `dispatch_ops`, `dispatch_line_files`
- Со складом связаны только через журнальный остаток `ready`: задача упаковки его производит, отгрузка потребляет. Документы друг на друга **не** ссылаются.

**Перемещения:**
- `zone_relocations` — append-only журнал перемещений остатков между бакетами (опер. статус × качество), включая журнальное списание при отгрузке.

**Logistics (рейсы):**
- модуль `backend/modules/logistics/` — рейсы (trips), привязка поступлений и отгрузок к рейсу, расходы.
- `trip_alloc` — дробление документов по рейсам (одно поступление/отгрузка может ехать несколькими рейсами).

**Остатки (двухосевая модель):**
- Остаток измеряется по двум осям: **операционный статус** (`INV_OP_*`: проверка / хранение / упаковка / зона отгрузки и т.д.) × **качество** (`INV_Q_GOOD` / `INV_Q_DEFECT`). Константы — в `config.py`.
- Источник данных: `receipt_lines.accepted_qty` (приёмка) **плюс** нетто-перемещения из журнала `zone_relocations` по каждому бакету. Отгруженное списывается журнальной записью в `zone_relocations`, **не** вычитанием `shipment_lines`.
- Эталон расчёта — [backend/modules/balances/service.py](backend/modules/balances/service.py). Старая формула «receipt_ops минус shipment_lines (shipped)» больше не используется.

### Статусы документов

Полные перечни — в [backend/config.py](backend/config.py), здесь — для ориентира:

- **Receipts:** ручной переход только `draft → planned`; дальше поступление двигает **рейс** (приёмка в разгрузке): `planned → partially_received → done`, плюс `cancelled`. `on_intake` / `on_review` — легаси, в новом потоке не используются.
- **Shipments («Задача упаковки», годный груз):** `draft → assigned → packing → on_packing → relocating → packed`, плюс `completed_no_goods` (весь товар оказался браком — завершение без рейса) и `cancelled`. **`packed` — терминал**: дальше товар возит домен dispatch. `awaiting_trip` / `partially_shipped` / `shipped` — легаси, документы в них больше не переводятся. Брак-отгрузка минует упаковку: `draft → relocating → awaiting_trip`. Приоритеты — `SHIPMENT_PRIORITY_URGENT / HIGH` (+ обычный), отдельный `PATCH /priority`.
- **Dispatch («Отгрузка» клиенту):** `draft → preparing → awaiting_trip → (partially_shipped) → shipped`, плюс `cancelled`. Переходы в `partially_shipped`/`shipped` делает выезд привязанного рейса, не ручной advance.
- **Trips:** `draft → awaiting_arrival → unloading → costing → closed`, плюс `cancelled`. Направления `inbound` / `outbound` (лексика статусов различается, коды общие).
- **Invoices:** `draft → issued → partially_paid → closed`, плюс `cancelled`.

### Запрещённые таблицы и имена

Никогда не использовать в новом коде:

- `inventory_operations` — удалена в `0003_drop_legacy_inventory_operations`.
- `app_migrations` — удалена в `0004_drop_legacy_app_migrations`.
- Любые имена `receipt2_*`, `shipment2_*` — это историческое название, таблиц больше нет.

### Журнал операций (append-only)

Журналы `receipt_ops` / `shipment_ops` — **append-only**. Каждое значимое изменение пишет новую запись с `op_type` + человекочитаемым `comment` (по-русски):

```python
conn.execute(
    "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) "
    "VALUES (?,?,?,?,?,?,?,?)",
    (str(uuid4()), doc_id, line_id, RECEIPT_OP_LINE_UPDATE, qty,
     "План: 10 → 12 шт.", _now(), uid),
)
```

Состояние документа = replay журнала (`compute_state` в [backend/modules/receipts/service.py](backend/modules/receipts/service.py)). Для list-view используется отдельный агрегирующий SQL (`list_receipts_aggregated`) — **не** replay по каждой строке.

### Константы (статусы, op_type)

Все enum-значения лежат в [backend/config.py](backend/config.py) — импортировать оттуда, **не** хардкодить строки:

```python
from config import (
    RECEIPT_STATUS_DRAFT, RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_DONE,
    RECEIPT_OP_LINE_UPDATE, RECEIPT_OP_ARRIVAL_ACCEPT, RECEIPT_OP_RECEIVING_CORRECTION,
    SHIPMENT_STATUS_PACKED, DISPATCH_STATUS_PREPARING,
    INV_OP_STORAGE, INV_OP_READY, INV_Q_GOOD,
)
```

Это относится и к SQL: опер. статусы остатков (`'storage'`, `'ready'`, ...) в запросы подставлять из `INV_OP_*`, а не строкой.

### Миграции

Любая схема — только через Alembic:

```bash
cd backend && alembic revision -m "add_xxx"
cd backend && alembic upgrade head
```

Имена ревизий — `NNNN_short_snake_case.py`. Руками править схему в коде или на проде нельзя. Runtime-guard `_ensure_runtime_schema()` в [backend/app.py](backend/app.py) выполняется **только при `APP_ENV=dev`** (подстраховка dev-старта без alembic) — не место для миграций; на test/prod схему ведёт исключительно alembic.

---

## 3. Backend — структура модуля

Каждый домен живёт в `backend/modules/<domain>/` и собирается из 3 файлов:

```
backend/modules/receipts/
  __init__.py    # пустой
  router.py      # APIRouter, эндпоинты, авторизация, валидация статуса
  service.py     # чистая логика: replay, расчёты, генерация номеров
  schemas.py     # Pydantic-модели request/response
```

Все роутеры регистрируются в [backend/app.py](backend/app.py):

```python
from modules.receipts.router import router as receipts_router
app.include_router(receipts_router)
```

### router.py

- `router = APIRouter(tags=["receipts"])` — префикс обычно задаётся в путях явно (`/receipts/...`), кроме `auth` (там `prefix="/auth"`).
- Авторизация — через зависимость:

```python
from modules.auth.service import get_current_manager

@router.get("/receipts/{doc_id}")
def get_receipt(doc_id: str, user=Depends(get_current_manager)):
    uid = str(user["id"])
    ...
```

- Ошибки — `HTTPException` с **русским** `detail`:

```python
raise HTTPException(status_code=400, detail="Укажите клиента")
raise HTTPException(status_code=404, detail="Документ не найден")
```

- Response models — через `response_model=...` для всех list/detail-эндпоинтов:

```python
@router.get("/receipts", response_model=ReceiptListResponse)
def list_receipts(...): ...
```

- Простой CRUD — inline SQL в роутере. Сложная логика (replay, расчёт состояния, валидация переходов) — в `service.py`, принимает уже открытый `connection`.

### service.py

- Чистые функции, **без** FastAPI/HTTP-зависимостей (могут вызывать `HTTPException`, но не зависят от Request/Response).
- Принимают `connection` первым параметром:

```python
def next_doc_number(connection) -> str: ...
def compute_state(connection, doc_id: str) -> dict: ...
def list_receipts_aggregated(connection, *, page, limit, client_id, ...): ...
```

### schemas.py

- Pydantic v2 модели, `from __future__ import annotations`, `from pydantic import BaseModel, Field`.
- Разделяй по назначению: `*Create`, `*Update`, `*Add`, `*Response`, `*ListItem`, `*ListResponse`.
- Валидация чисел через `Field(ge=1)`. Опциональные поля — `str | None = None`.

### Пример эндпоинта

```python
@router.patch("/receipts/{doc_id}")
def update_receipt(doc_id: str, payload: ReceiptDocUpdate, user=Depends(_get_manager)):
    uid = str(user["id"])
    with get_connection() as conn:
        doc_row = conn.execute(
            "SELECT * FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
        ).fetchone()
        if not doc_row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(doc_row["status"]) == RECEIPT_STATUS_DONE:
            raise HTTPException(status_code=400, detail="Завершённый документ нельзя изменять")
        # ... сборка UPDATE + журнальная запись ...
        conn.commit()
    return {"message": "ok"}
```

Шаблон ответа: для команд — `{"message": "ok"}` или `{"message": "<id или статус>"}`; для list/detail — Pydantic response model.

---

## 4. Frontend — архитектура слоёв

**Жёсткие границы слоёв.** Нарушение = баг архитектуры.

| Слой | Назначение | Запрещено |
|---|---|---|
| `ui/pages/` | route layer — рендерит фичу + читает URL-state | прямые fetch, бизнес-`useEffect`, бизнес-`useState` |
| `ui/features/<domain>/` | вся бизнес-логика, состояния, API-вызовы | — |
| `ui/features/shared/process/` | общие компоненты процессных карточек: `ProcessRail`, `PhaseBlock`, `RoleChip`, `DocHeader`, `PrimaryAction` — использовать, не дублировать | — |
| `ui/primitives/` | чистые UI-атомы (Button, Badge, Card, Input, Icon, Tooltip, ...) | бизнес-логика, API |
| `ui/data/` | сложные data-компоненты (Table, FiltersBar, Pagination, Combobox, DateRange, MultiSelect) | API, бизнес-логика |
| `ui/layouts/` | композиция страницы (`ListPage`, `DetailPage`, `FormPage`, `AppLayout`, `AuthLayout`) | API |
| `ui/shell/` | `AppShell`, `Sidebar`, `Topbar`, `CommandPalette`, `Breadcrumbs` | прямые API |
| `ui/feedback/` | `ConfirmDialog`, `Toast`, `Modal`, `Drawer` (провайдеры/обёртки) | бизнес-логика |
| `ui/routes/` | `lazy()`-определения `<Route>` | — |
| `hooks/` | reusable хуки: `useApi`, `useCurrentUser`, `useLookups`, `useFilterParam`, `usePageParam` | feature-логика (`useReceiptFlow` и т.п.) |
| `api/` | `<domain>Api.ts` — типы + чистые fetch-функции через `request<T>` | React, JSX |
| `utils/` | чистые функции: `fmtDate`, `foldCiSearch`, `balanceKey`, `breadcrumbLabels` | React, API |
| `auth/` | session helpers: `sessionError`, `tabSync`, `redirectToAuth` | UI |

### Жёсткие запреты

- API-вызовы в `ui/pages/`.
- Бизнес-`useState`/`useEffect` вне `ui/features/` или прикладных контекстов.
- Feature-логика в `ui/primitives/`, `ui/data/`, `ui/layouts/`.
- Создание «универсальных форм», «mega-hooks», «shared business layers», «feature factories».
- Любая абстракция без **двух реальных повторений**.

### Правило дублирования

1. Увидел повтор — зафиксируй.
2. Дождись второго реального случая.
3. Только потом выноси общее.

Преждевременная абстракция запрещена. Три похожих строки **лучше**, чем неудачный helper.

---

## 5. Frontend — паттерны

### 5.1 API-модуль (`src/api/<domain>Api.ts`)

Фиксированная структура файла — см. [frontend/src/api/receiptsApi.ts](frontend/src/api/receiptsApi.ts) как эталон:

```ts
// --- Types ---
export type ReceiptStatus = 'draft' | 'planned' | 'on_intake' | 'on_review' | 'done' | 'cancelled'
export type ReceiptDoc  = { id: string; doc_number: string; /* ... */ }
export type ReceiptLine = { /* ... */ }
export type ReceiptListItem = ReceiptDoc & { sku_count: number; /* ... */ }
export type ReceiptListResponse = { items: ReceiptListItem[]; total: number; page: number; limit: number }
export type ReceiptCreatePayload = { /* ... */ }
export type ReceiptListParams = { page?: number; limit?: number; /* ... */ }

// --- API functions ---
export function getReceipts(params: ReceiptListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.client_id) sp.set('client_id', params.client_id)
  // ...
  const q = sp.toString()
  return request<ReceiptListResponse>(`/receipts${q ? `?${q}` : ''}`, { signal })
}

export function createReceipt(payload: ReceiptCreatePayload) {
  return request<{ message: string }>('/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// --- Labels & helpers ---
export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = { draft: 'Создание', /* ... */ }
export function receiptStatusTone(status: ReceiptStatus): string { /* ... */ }
export function isReceiptOverdue(item: ReceiptListItem): boolean { /* ... */ }
```

Правила:
- Все запросы — через `request<T>(...)` из [frontend/src/api/http.ts](frontend/src/api/http.ts).
- Query-string собирается через `URLSearchParams` (не шаблонной строкой).
- GET-функции принимают опциональный `signal?: AbortSignal`.
- Базовый URL — `/api` (см. [frontend/src/api/constants.ts](frontend/src/api/constants.ts)), прокси к backend настраивается на уровне Vite/nginx.

### 5.2 Аутентификация и заголовки

- Токен живёт в `tokenStore`; `buildAuthHeaders` в `http.ts` сам добавляет `Authorization: Bearer ...`.
- На любой `401` с Bearer-заголовком: `SessionExpiredError` + `invalidateSessionAfterUnauthorizedApi()` (кроме `/auth/login`, `/auth/register`).
- Ошибки FastAPI разбираются `formatApiErrorDetail` → одна понятная строка для UI.
- **Не дублировать** обработку 401 / парсинг ошибок в `<domain>Api.ts`.

### 5.3 Route layer (`ui/pages/`)

Page-файл = тонкий обёрточный компонент. Может читать URL-state и передавать его в фичу, но **никаких** прямых `fetch` и бизнес-`useEffect`:

```tsx
// ui/pages/InventoryReceiptDetailPage.tsx
import { useParams } from 'react-router-dom'
import { ReceiptDetailFeature } from '../features/inventory/ReceiptDetailFeature'

export function InventoryReceiptDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  if (!docId) return null
  return <ReceiptDetailFeature docId={docId} />
}
```

Если страница уже содержит существенный объём бизнес-логики (исторически — `InventoryReceiptsListPage`), новый бизнес-код добавляется через выделение фичи, **не** через рост страницы.

### 5.4 Списочные страницы

Стек хуков:

```tsx
const [search,    setSearch]    = useFilterParam('search', '')
const [clientId,  setClientId]  = useFilterParam('client', '')
const [statusF,   setStatusF]   = useFilterParam('status', '')
const [page,      setPage]      = usePageParam()
const { setMany } = useFilterParamsActions()

const { clients } = useLookups()

const { data: summary } = useApi(
  (signal) => getReceiptsSummary({ client_id: clientId || undefined, search: search.trim() || undefined }, signal),
  [clientId, search],
)
```

- URL — единственный источник состояния фильтров/страницы. Смена фильтра автоматически сбрасывает `page`.
- Layout — `<ListPage title subtitle actions filters>`.
- Таблица — `<Table>`, `<Td>` из `ui/data/Table`. Заголовки таблиц рисуются inline `<th>` — отдельного `SortableTh` **нет** и не возвращать.
- Пустые / ошибочные состояния — `<SkeletonRows>`, `<EmptyState>`.
- Пагинация — `<Pagination page pageSize total onPage>`.

### 5.5 Detail-фичи со статусами

Паттерн `receiptDetail/` (второй живой пример — `dispatchDetail/`) — повторять для других доменов:

```
ui/features/inventory/
  ReceiptDetailFeature.tsx        # реэкспорт из receiptDetail/
  receiptDetail/
    ReceiptDetailFeature.tsx      # загрузка + роутинг по статусу
    views/
      DraftView.tsx               # status = draft
      PlannedView.tsx             # status = planned | on_intake
      ReviewView.tsx              # status = on_review | done
    components/
      AddLineDrawer.tsx
      OpEntry.tsx
    shared/
      opLabels.ts
```

Главная фича грузит данные и делегирует рендер view'у по статусу:

```tsx
if (detail.doc.status === 'draft') return <DraftView {...props} />
if (detail.doc.status === 'planned' || detail.doc.status === 'on_intake') return <PlannedView {...props} />
return <ReviewView {...props} />
```

### 5.6 Справочники

`useLookups()` отдаёт уже закешированные `clients`, `suppliers`, `carriers`, `warehouses`, `unloadingZones`, `vehicleTypes`, `positions`. Провайдер монтируется в `AppLayout`. **Никаких** прямых `getInventoryClients()` в страницах/фичах — только через `useLookups()`. Перезагрузка после изменений в справочнике — `useLookups().reload()`.

### 5.7 Подтверждения и тосты

- Подтверждения деструктивных операций — `useConfirm()` из `ui/feedback/ConfirmDialog`:

```tsx
const confirm = useConfirm()
const ok = await confirm({
  title: 'Аннулировать документ?',
  body: `Документ ${doc.doc_number} будет аннулирован. Это действие нельзя отменить.`,
  danger: true,
  confirmLabel: 'Аннулировать',
})
if (!ok) return
```

- Уведомления — `useToast()`.
- **Запрещено**: `window.confirm`, `window.alert`, `window.prompt`.

### 5.8 Стили

- Цвета, фоны, тени, шрифты — **только** через CSS-переменные: `var(--c-text-subtle)`, `var(--c-accent)`, `var(--c-bg-elev)`, `var(--c-bg-sunken)`, `var(--c-danger)`, `var(--c-warning)`, `var(--c-success)`, `var(--sh-1)` и т.п. (см. [frontend/src/ui/theme.css](frontend/src/ui/theme.css)).
- Готовые классы: `.page`, `.page-header`, `.page-title`, `.page-subtitle`, `.btn primary|ghost|sm|icon`, `.card`, `.input sm`, `.tabs`, `.tab.active`, `.tab-count`, `.row.gap-8`, `.mono`, `.num`, `.t-sub`.
- Inline `style={}` допустим для одноразовой композиции. Если кусок повторился — выноси в класс в `theme.css`, **не** в новый помощник.
- Табы — inline `.tabs / .tab.active` (отдельный `Tabs.tsx` удалён, не возвращать).

### 5.9 Маршрутизация

Маршруты — в `ui/routes/<area>.tsx` через `lazy()`-import:

```tsx
const InventoryReceiptsListPage = lazy(() =>
  import('../pages/InventoryReceiptsListPage').then((m) => ({ default: m.InventoryReceiptsListPage })),
)

export const inventoryRoutes = [
  <Route key="inventory-receipts"     path="/inventory/receipts"           element={<InventoryReceiptsListPage />} />,
  <Route key="inventory-receipts-new" path="/inventory/receipts/new"       element={<InventoryReceiptPage />} />,
  <Route key="inventory-receipts-id"  path="/inventory/receipts/:docId"    element={<InventoryReceiptDetailPage />} />,
]
```

URL-конвенции inventory: `/receipts`, `/shipments`, `/balances` — **без** суффикса `-v2`.

---

## 5a. Мобильное приложение (`mobile/`)

Отдельное Capacitor + React приложение «Склад» (online-first, тот же backend). Ключевое:

- Один APK для всех ролей: раскладка табов по роли (`tabsForRole`) — кладовщик, начальник смены, начальник склада, менеджер.
- `mobile/src/api/` — **параллельная копия** `frontend/src/api/` (осознанно: два независимых приложения). Добавил статус/label/тип на backend — проверь **оба** api-слоя.
- Auth — нативный режим: заголовок `X-Client: mobile`, refresh-токен в теле ответа + secure storage (не cookie).
- Окружение выбирается `VITE_API_BASE_URL` на сборке; сборка APK — см. память проекта / [docs/mobile-plan.md](docs/mobile-plan.md).
- UI-конвенции: числовые поля количества без степперов −/+; свой `PullToRefresh` (и тогда без кнопки «Обновить»); свой `DateTimeField` (контракт `YYYY-MM-DDTHH:mm`); сканер ШК — ML Kit.
- Тесты: `cd mobile && npm test` (vitest).

---

## 6. Авторизация

- Backend: `Depends(get_current_manager)` для админ/менеджер-эндпоинтов, `Depends(get_current_user)` для общих. RBAC-матрица — в [backend/security.py](backend/security.py).
- Frontend: бутстрап сессии в `AppLayout` через `ensureSessionBootstrapped()` → `me()`. До завершения — экран «Проверка сессии…». Гость → `<Navigate to="/auth" />`.
- Rate limit на `/auth/login`, `/auth/refresh`, `/auth/register` — в middleware в `app.py` (Redis для login, in-memory fallback).
- Файлы `/uploads/*` раздаются **только аутентифицированным** (эндпоинт `serve_upload` в `app.py`, авторизация по Bearer или refresh-cookie) — не возвращать публичный `StaticFiles`-mount.
- Никогда не логировать пароли, refresh-токены, JWT-секрет.

---

## 6a. Сквозные инварианты

- **Идемпотентность записи:** frontend `http.ts` шлёт `X-Request-Id` на каждый write по умолчанию; backend хранит ключи в `idempotency_keys` — повтор при обрыве связи не задваивает операцию. Новые write-эндпоинты получают это бесплатно, не ломать.
- **Таймзона:** бизнес-логика склада живёт по **Europe/Moscow** (`business_today` в `modules/timesheet/service.py`); `created_at` хранится в UTC, бакетировать по UTC; фронт пиннит МСК. Не использовать локальную дату сервера (`date.today()`) для бизнес-дат.
- **Деньги:** счета, расходы, ставки табеля — **копейки INTEGER** (не float). Прочие стоимости проекта — REAL, это осознанное различие.
- **Effective-dated справочники:** тарифы (логистика/палеты/короба), ставки сотрудников, оклады, аренда — версии со сроком действия; текущая = последняя с `effective_from <= дата`.

---

## 7. Удалённое и запрещённое

В коде **не должно появляться**:

**Frontend (удалённые файлы):**
- `frontend/src/api/filterHelpers.ts` — фильтры читаются/пишутся **только** через `useFilterParam` / `useFilterParamsActions`.
- `frontend/src/ui/data/SortableTh.tsx` — сортировка не нужна, не возвращать.
- `frontend/src/ui/primitives/Tabs.tsx` — табы рисуются inline через `.tabs / .tab.active`.
- `frontend/src/ui/features/inventory/ReceiptStepper.tsx`, `ShipmentStepper.tsx` — заменены компонентами из `ui/features/shared/process/`, не возвращать.

**Backend:**
- Таблицы `inventory_operations`, `app_migrations`.
- Имена `receipt2_*`, `shipment2_*`.
- Backend-эндпоинты `/import/*`, `/analytics/*`, `/client-portal/*` — заглушки 410 Gone, не оживлять. **Не путать с живым функционалом**: фронтовая страница `/analytics` (ExpensesAnalyticsFeature → `/expenses/analytics`), модуль `pnl` (`/pnl/*`) и ЛК клиента (`/cabinet/*`) — рабочие, их трогать можно.
- Excel-импорт.

**Архитектурное:**
- Прямые `fetch` в `ui/pages/`.
- Бизнес-`useState`/`useEffect` вне `features/`.
- «Универсальные формы», mega-hooks, абстракции без 2+ реальных повторений.
- `window.confirm` / `window.alert`.
- Хардкод цветов вместо `var(--c-*)`.
- Хардкод статусов / op_type на backend вместо констант из `config.py`.

---

## 8. Конвенции имён и тона

- **Идентификаторы, типы, файлы** — английский (`ReceiptDetailFeature`, `getReceipts`, `RECEIPT_STATUS_DRAFT`).
- **Пользовательский текст, labels, error detail, комментарии к ops** — русский (`"Документ не найден"`, `"Завершён"`, `"План: 10 → 12 шт."`).
- Pages: `<Area><Entity><Action>Page.tsx` (`InventoryReceiptDetailPage`).
- Features: `<Entity><Action>Feature.tsx` (`ReceiptDetailFeature`, `ReceiptCreateFeature`).
- API: `<domain>Api.ts` (`receiptsApi.ts`, `shipmentsApi.ts`).
- Backend модули: `backend/modules/<domain>/{router,service,schemas}.py`.
- Миграции: `NNNN_short_snake_case.py`.

### Комментарии

- По умолчанию — **не** писать комментарии.
- Писать только если есть **WHY**, который нельзя прочитать из кода (скрытый инвариант, обход бага, неочевидное ограничение).
- Не описывать WHAT (имена и типы говорят сами).
- Не ссылаться на «текущую задачу» / номера тикетов в комментариях.

---

## 9. Проверки перед завершением задачи

В зависимости от того, что менялось:

- Backend: `cd backend && pytest` (минимум — затронутый модуль). Нужны env: `DATABASE_URL` (живая PostgreSQL) и `JWT_SECRET` (≥32 символов), иначе тесты скипаются/падают на импорте. Прогон сам создаёт одноразовую БД (`<dbname>_test_<hex>` + alembic upgrade head) и удаляет её в конце — общая dev-БД не затрагивается, `pytest -n` безопасен; `TEST_DB_ISOLATION=0` отключает (гонять прямо в `DATABASE_URL`).
- Frontend: type-check / `npm run build` и `npm test` (vitest, чистые утилиты) в `frontend/`.
- Mobile: `cd mobile && npm test` и сборка при затронутом mobile-коде. В `mobile/src/api/parity.test.ts` — parity-тест с `frontend/src/api`: добавил статус/label в один api-слой — тест напомнит про второй.
- Миграции: `cd backend && alembic upgrade head` на dev-БД.

Если проверка не запускалась — в ответе явно указать **почему** (например, «нет dev-окружения для запуска БД, ручная проверка нужна»). Те же проверки гоняет job `ci` в GitHub Actions перед каждым деплоем — локально красный тест значит красный деплой.
