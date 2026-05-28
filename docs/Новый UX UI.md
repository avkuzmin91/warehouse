# ТЗ для Claude Code — новый дизайн-слой WMS pack-men

## Как использовать

1. Скачай папку `design-mockup/` из этого проекта (через download) и положи её в корень своей локальной `warehouse/` — рядом с `frontend/`, `backend/`, `docker-compose.yml`. Должно получиться `warehouse/design-mockup/`.
2. Открой Claude Code в корне `warehouse/`.
3. Скопируй в Claude Code всё содержимое этого файла (от «# Задача» и ниже), отправь одним сообщением.

В `warehouse/design-mockup/` лежит готовый рабочий React-прототип нового вида приложения — `index.html` открывается локально, в нём весь визуал, все экраны, все интеракции. Это **эталон**, на который надо ровняться 1-в-1.

---

# Задача

В репозитории `warehouse/` есть Vite/React 19/TS-фронтенд (`warehouse/frontend/`) с уже работающим SPA: роутинг (react-router 7), API-клиенты, авторизация, защита роутов, куча страниц. И весь визуал собран из старых глобальных компонентов в `warehouse/frontend/src/components/**` и старой темы `src/index.css` / `src/App.css`.

В `warehouse/design-mockup/` лежит **готовый дизайн-прототип** — pack-men WMS на чистом JSX без сборщика. Открой `warehouse/design-mockup/index.html` в браузере, прокликай экраны (роли переключаются через Tweaks-панель).

**Цель:** реализовать в `warehouse/frontend/` **новый параллельный визуальный слой**, который полностью соответствует прототипу, **не импортируя ни один компонент и ни один css-файл из `warehouse/frontend/src/components/**` и `warehouse/frontend/src/index.css` / `App.css`**. Бизнес-логику (API-клиенты, типы, auth, hooks, queryState) переиспользуем как есть.

Результат — «второй слой», на который можно переключить приложение через env-флаг. Старый слой пока не трогать, не удалять, не править.

---

## Жёсткие правила

1. **Никаких импортов из `src/components/**` в новом слое.** Если нужна таблица/сайдбар/диалог/комбобокс — заново реализовать в новом слое. В чёрном списке всё, что есть в `warehouse/frontend/src/components/`: `Sidebar`, `Header`, `AppLayout`, `AuthLayout`, `Breadcrumbs`, `Table`, `ActionBar`, `ListPageLayout`, `FiltersPanel`, `ModalDialog`, `PageContainer`, `ListPagination`, `ConfirmDialogProvider`, `DateRangeFilter`, `Dictionary*Combobox`, `DictionaryMultiSelect`, `FormDateField`, `SortableTh`, `MiniCharts`, `RouteLoadingFallback`, `CollectionActions`, `Field*`, `Filter*`, `Product*`, `ReceiptForm`, `ShipmentForm`, `SimpleDictionaryFormFields`, `SizeFormFields`, `SystemInfoBlock`, `UsersRoleGrantMenu`, `ClientFormFields`, `MovementsExcelImportPreviewSection`, `ImageFullscreenLightbox`.
2. **Никаких импортов глобальной темы:** не подключать `src/index.css`, `src/App.css`, `src/components/InventoryProductStyles.css`, `src/pages/AnalyticsPage.css`, `src/pages/ExcelImportStep1Page.css`. Новый слой работает поверх **своей** темы `src/ui/theme.css`, скопированной из `warehouse/design-mockup/styles.css`.
3. **Бизнес-слой переиспользуем:** всё в `src/api/**`, `src/auth/**`, `src/hooks/**`, `src/utils/**`, `src/routes/AdminRoute.tsx`, `ManagerAdminRoute.tsx`, `RoleRestrictedRoute.tsx`, `ProtectedLayout.tsx`, `ClientCabinetLayout.tsx` (для роутинга, не для UI) оставляем и импортируем как есть. `RootErrorBoundary`, `AuthTabSync` тоже.
4. **TypeScript обязателен** для нового слоя (React 19, strict, без `any` без нужды). Файлы — `.tsx`.
5. **Старый слой не ломать.** `App.tsx`, `main.tsx`, старые роуты, `src/pages/**`, `src/components/**` остаются нетронутыми. Новый слой подключается через переключатель (см. секцию «Подключение»).
6. **Без сторонних UI-библиотек.** Никаких MUI, Antd, shadcn, Radix, Tailwind, styled-components. Только React + CSS из `theme.css` + локальные CSS-модули при необходимости. Иконки — inline SVG, как в прототипе (`design-mockup/src/icons.jsx`).
7. **Шрифты:** только Inter (400/450/500/600/700) и JetBrains Mono (400/500/600). Подключить в `warehouse/frontend/index.html` ровно как в `design-mockup/index.html`.
8. **`react-router` не менять** — используем тот же `BrowserRouter`. Просто добавляем новый layout и новые элементы маршрутов.
9. **Никаких косметических правок в старых файлах** кроме точечной правки `main.tsx` (флаг), `index.html` (шрифты) и `.env.dev` / `.env.dev.example` (`VITE_UI_V2=1`).
10. **Не добавлять зависимости в `package.json`** сверх существующих. Если очень-очень нужно — сначала спроси.

---

## Структура нового слоя

Создать **только** следующие папки/файлы в `warehouse/frontend/src/`:

```
src/ui/
  theme.css                  ← перенести design-mockup/styles.css 1-в-1
  primitives/
    Brand.tsx                ← из design-mockup/src/primitives.jsx
    Icon.tsx                 ← полный набор иконок из design-mockup/src/icons.jsx, типизированный IconName
    Badge.tsx
    Button.tsx               ← .btn / .btn.primary / .btn.ghost / .btn.sm / .btn.lg / .btn.icon / .btn.danger
    Input.tsx                ← .input, .label, .field, .help
    Textarea.tsx
    Select.tsx
    Checkbox.tsx
    Card.tsx                 ← .card, .card-head, .card-body
    KPI.tsx                  ← с поддержкой spark+delta
    Sparkline.tsx
    Tabs.tsx
    Avatar.tsx
    Kbd.tsx
    Tag.tsx
    EmptyState.tsx
    Skeleton.tsx
    Dropdown.tsx
    Tooltip.tsx
  data/
    Table.tsx                ← .t-wrap / .t / .t-checkbox / .mono / .num
    SortableTh.tsx
    Pagination.tsx
    FiltersBar.tsx
    DateRange.tsx
    Combobox.tsx             ← общий, заменяет Dictionary*Combobox
    MultiSelect.tsx
  shell/
    AppShell.tsx             ← layout из design-mockup/src/shell.jsx: Sidebar + Topbar + content
    Sidebar.tsx
    Topbar.tsx
    Breadcrumbs.tsx
    CommandPalette.tsx       ← из design-mockup/src/widgets/CommandPalette.jsx
  feedback/
    Modal.tsx                ← новый, на замену ModalDialog
    ConfirmDialog.tsx
    Toast.tsx
  layouts/
    AuthLayoutV2.tsx         ← для /auth и /auth/register
    AppLayoutV2.tsx          ← оборачивает Outlet в AppShell
    ClientCabinetLayoutV2.tsx ← для /cabinet/*
    ListPage.tsx             ← шаблон: header + filters + table + pagination
    FormPage.tsx
    DetailPage.tsx
  pages/
    LoginPage.tsx
    RegisterPage.tsx
    HomePage.tsx
    ChangePasswordPage.tsx
    AccessDeniedPage.tsx
    InventoryHomePage.tsx          ← /inventory
    InventoryBalancesPage.tsx      ← /inventory/balances
    InventoryReceiptsListPage.tsx  ← /inventory/receipts
    InventoryReceiptPage.tsx       ← /inventory/receipts/new
    InventoryReceiptEditPage.tsx   ← /inventory/receipts/:id
    InventoryShipmentsListPage.tsx
    InventoryShipmentPage.tsx
    InventoryShipmentEditPage.tsx
    ExcelImportStep1Page.tsx
    ExcelImportPreviewPage.tsx
    AnalyticsPage.tsx
    DictionariesListPage.tsx
    DictionariesPage.tsx
    ClientsListPage.tsx
    ClientCreatePage.tsx
    ClientEditPage.tsx
    SizesListPage.tsx
    SizeCreatePage.tsx
    SizeEditPage.tsx
    SimpleDictionaryListPage.tsx
    SimpleDictionaryCreatePage.tsx
    SimpleDictionaryEditPage.tsx
    ProductCreatePage.tsx
    ProductEditPage.tsx
    UsersPage.tsx
    cabinet/
      DashboardPage.tsx
      BalancesPage.tsx
      OperationsPage.tsx
      ProductsPage.tsx
      ProductViewPage.tsx
  widgets/
    WarehouseMap.tsx         ← из design-mockup/src/widgets/WarehouseMap.jsx
    DictSheets.tsx           ← из design-mockup/src/widgets/DictSheets.jsx (если пригодится)
  AppV2.tsx                  ← новый <Routes>, повторяет топологию из старого src/App.tsx, но рендерит экраны из src/ui/pages
```

### Маршруты — берём 1-в-1 из старого `warehouse/frontend/src/App.tsx`
Полная топология уже зафиксирована в `src/App.tsx` — повторить её в `src/ui/AppV2.tsx`, заменив только импорты компонентов страниц и layout-ов на новые из `src/ui/...`. Guard-роуты (`AdminRoute`, `ManagerAdminRoute`, `ProtectedLayout`) **переиспользовать существующие** — это бизнес-слой, не UI.

---

## Подключение нового слоя

В `warehouse/frontend/src/main.tsx` добавить переключатель через env-флаг `VITE_UI_V2`:

```tsx
import App from './App'
import AppV2 from './ui/AppV2'

const useV2 = import.meta.env.VITE_UI_V2 === '1'

createRoot(rootEl).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter basename={routerBasename()}>
        {useV2 ? <AppV2 /> : <App />}
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
)
```

`src/ui/theme.css` импортируется **внутри** `AppV2.tsx` — чтобы при выключенном флаге глобальные стили нового слоя не утекали в старый слой.

Добавь в `warehouse/frontend/.env.dev` (и в `.env.dev.example`) строку `VITE_UI_V2=1` для локальной разработки. В prod-конфиг не трогать.

Не делай **никаких** изменений в `src/App.tsx`, `src/index.css`, `src/App.css`.

---

## Дизайн-эталон — что брать из `warehouse/design-mockup/`

| Файл прототипа | Куда переносим |
|---|---|
| `design-mockup/styles.css` (811 строк) | `src/ui/theme.css` — копировать целиком |
| `design-mockup/src/icons.jsx` | `src/ui/primitives/Icon.tsx` — переписать на TS, добавить тип `IconName = keyof typeof icons` |
| `design-mockup/src/primitives.jsx` | разбить по файлам в `src/ui/primitives/*` (Brand, Badge, Button, Input, Card, KPI, Sparkline, Tabs, Checkbox, Avatar, …) |
| `design-mockup/src/shell.jsx` | `src/ui/shell/AppShell.tsx` + `Sidebar.tsx` + `Topbar.tsx` + `Breadcrumbs.tsx` |
| `design-mockup/src/screens/Login.jsx` | `src/ui/pages/LoginPage.tsx` |
| `design-mockup/src/screens/Dashboard.jsx` | `src/ui/pages/HomePage.tsx` (менеджер/админ) и `cabinet/DashboardPage.tsx` (клиент) |
| `design-mockup/src/screens/Receipts.jsx` | `InventoryReceiptsListPage.tsx` |
| `design-mockup/src/screens/ReceiptDetail.jsx` | `InventoryReceiptEditPage.tsx` |
| `design-mockup/src/screens/ReceiptCreate.jsx` | `InventoryReceiptPage.tsx` |
| `design-mockup/src/screens/Shipments.jsx` | `InventoryShipmentsListPage.tsx` |
| `design-mockup/src/screens/ShipmentCreate.jsx` | `InventoryShipmentPage.tsx` |
| `design-mockup/src/screens/Balances.jsx` | `InventoryBalancesPage.tsx` |
| `design-mockup/src/screens/Defects.jsx` | пока нет аналога — приделать как вкладку к `InventoryBalancesPage` или сделать отдельной страницей-черновиком |
| `design-mockup/src/screens/Dictionaries.jsx` | `DictionariesListPage.tsx` |
| `design-mockup/src/screens/ProductEdit.jsx` | `ProductCreatePage.tsx` + `ProductEditPage.tsx` |
| `design-mockup/src/screens/Users.jsx` | `UsersPage.tsx` |
| `design-mockup/src/screens/Client.jsx` | `cabinet/DashboardPage.tsx` |
| `design-mockup/src/widgets/CommandPalette.jsx` | `src/ui/shell/CommandPalette.tsx` |
| `design-mockup/src/widgets/WarehouseMap.jsx` | `src/ui/widgets/WarehouseMap.tsx` |
| `design-mockup/src/widgets/DictSheets.jsx` | `src/ui/widgets/DictSheets.tsx` |

Мок-данные из `design-mockup/src/data.jsx` **не переносить** в продакшен — на их место подставлять реальные данные через существующие API-хуки (`adminApi`, `inventoryApi`, `analyticsApi`, `clientPortalApi`, `usersApi`). Если ответа API ещё нет/loading — показывать `<Skeleton>` или `<EmptyState>`.

`design-mockup/src/Tweaks.jsx` и `design-mockup/lib/tweaks-panel.jsx` — **не переносить** вообще, это служебная штука прототипа.

---

## Дизайн-токены (для справки)

В `theme.css` уже всё есть — переменные `--c-bg`, `--c-text`, `--c-accent` (`#4338ca`), плотности `[data-density="compact|cozy"]`, шрифты Inter / JetBrains Mono, радиусы `--r-sm/md/lg/xl`, тени `--sh-1/2/3`, размеры `--sidebar-w: 232px`, `--header-h: 48px`. Не выдумывай свои значения.

---

## Чеклист по фичам, которые должны работать

- [ ] `AppShell`: левый сайдбар с pac-shape логотипом, секциями «Операции» / «Управление», бейджами-счётчиками, футером с аватаром и ролью; топбар с поиском (⌘K), уведомлениями, хлебными крошками
- [ ] `CommandPalette` — Cmd/Ctrl+K, fuzzy search по экранам/командам, навигация стрелками
- [ ] Таблицы с плотностью (`compact|default|cozy`), sticky шапкой, чекбоксами выбора строк, моноширинными числовыми/код-колонками, hover-row, сортировкой
- [ ] Формы поступления/отгрузки: line items, выбор товара через `Combobox` со справочником, считаемые суммы
- [ ] Excel-импорт: 2 шага (upload + preview) — те же экраны, что и в старом слое, только новый визуал
- [ ] Аналитика: KPI-блоки + Sparkline (как примитив `KPI` из прототипа)
- [ ] Кабинет клиента: своя главная, остатки, операции (одна страница на поступления/отгрузки через проп `opType`), список товаров, карточка товара
- [ ] Auth: `LoginPage` и `RegisterPage` в новом `AuthLayoutV2` (без сайдбара) — посмотри `design-mockup/src/screens/Login.jsx` для композиции (двух-колоночный, лого слева, форма справа)
- [ ] Confirm-диалог и модалки — собственная реализация (`Modal`, `ConfirmDialog`), API повторяет минимум, нужный страницам: `confirm({title, body, danger}) => Promise<boolean>`
- [ ] Ролевой ауд: новый слой берёт роль из существующего `tokenStore`/`profileCache` — **не трогать** эти модули
- [ ] Скелетоны для loading-стейтов вместо «Loading…»
- [ ] Все тексты — на русском, как в прототипе. Тон, формулировки, заголовки колонок — повторить с прототипа

---

## Порядок работ (важно — придерживаться)

1. **Тема и примитивы.** Создай `src/ui/theme.css` копией `design-mockup/styles.css`. Подключи её в `AppV2.tsx`. Сделай `src/ui/primitives/*` и `src/ui/data/*` — без бизнес-логики, на статичных props.
2. **Sandbox** (только в DEV). Сделай dev-роут `/ui-sandbox` (рендерится только когда `import.meta.env.DEV`), где вручную можно глянуть все примитивы — Button во всех состояниях, Table, Card, KPI, Badge, Combobox и т.д. Это поможет проверять качество визуала.
3. **Shell.** Собери `AppShell` + `Sidebar` + `Topbar` + `Breadcrumbs` + `CommandPalette`. Прокинь через `AppV2.tsx` пустой `Outlet` — убедись, что layout живёт.
4. **Страницы.** По одной — начиная с `HomePage`, потом списки (`Receipts`, `Shipments`, `Balances`), потом формы (`ReceiptPage`, `ShipmentPage`), потом справочники, потом кабинет клиента, в конце auth.
5. **Данные.** На каждой странице — реальные данные через существующие хуки `src/api/*`. Никаких моков в финальной версии. Если поля API не совпадают с моками прототипа — приоритет за API; визуал подгоняй.
6. **Финал.** Включи `VITE_UI_V2=1` в `.env.dev`. Прогон `npm run lint && npm run build` без ошибок.

---

## Запрещено

- Импортировать `from '../components/...'` или `from '@/components/...'` или `from 'src/components/...'` в любом файле под `src/ui/**`.
- Импортировать `src/index.css`, `src/App.css`, `src/components/InventoryProductStyles.css`, `src/pages/*.css` где-либо в новом слое.
- Менять старые файлы, кроме `main.tsx` (флаг) и `warehouse/frontend/index.html` (подключение шрифтов).
- Удалять, переименовывать или править `src/components/**`, `src/pages/**`, `src/App.tsx`, `src/index.css`, `src/App.css`.
- Копировать `design-mockup/` или его части в `warehouse/frontend/src/` напрямую. Только переписывание на TS в `src/ui/**`.
- Добавлять зависимости в `package.json` сверх существующих.

---

## Критерии приёмки

- `VITE_UI_V2=1 npm run dev` поднимает приложение, все маршруты из старого `App.tsx` работают и визуально соответствуют прототипу из `design-mockup/`.
- `VITE_UI_V2=` (пусто) или `0` — приложение работает на старом слое без изменений.
- `npm run build && npm run lint` — чисто.
- `rg "from '.*components/" warehouse/frontend/src/ui` — пусто.
- `rg "import.*(index|App)\.css" warehouse/frontend/src/ui` — пусто.
- Все экраны из таблицы маппинга есть в `src/ui/pages` и подключены в `AppV2.tsx`.

---

## Что делать, если что-то непонятно

- Если в прототипе нет аналога экрана из старого роутера (например, `ChangePasswordPage`, `AccessDeniedPage`) — сделай его по аналогии с ближайшим: для формы — как `ProductEdit`, для статуса — как пустой стейт с `EmptyState`.
- Если данных API явно не хватает для какого-то блока из прототипа (например, графики на дашборде) — оставь блок с `<EmptyState>` и комментом `// TODO: подключить API`, не выдумывай поля.
- Сомнения по UX — следуй прототипу. Сомнения по API — следуй старой странице из `src/pages/**` (только **читай**, не импортируй).

---

## Старт

Перед тем как начать кодить — выведи:
1. План файлов, которые ты создашь (дерево).
2. Список запрещённых импортов и файлов, которые ты не будешь трогать.
3. Шаги, в каком порядке пойдёшь.

Дальше — иди по порядку.
