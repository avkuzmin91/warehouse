# Этап 1 «Фундамент»: декомпозиция задач

Контекст: [ADR 0002](adr/0002-branch-scoped-data-and-analytics.md), план — [docs/branch-separation-plan.md](branch-separation-plan.md).
Оценка этапа: **5–8 человеко-дней** (уточнено после аудита: единый экран доступа,
массовый перевод, бутстрап нового инстанса).

Цель этапа: филиал существует как сущность, пользователь к нему привязан, область видимости
и три галочки прав работают, `/me` их отдаёт, хелпер изоляции написан и покрыт тестами.
**Данные при этом ещё не разделены** — это этапы 2–6. После этапа 1 система работает
ровно как раньше: все пользователи в филиале «Москва», все области — прежние.

Порядок задач — это порядок выполнения. Т1 → Т2 → Т3 идут строго последовательно
(миграции), дальше можно параллелить backend (Т4–Т8) и frontend (Т9–Т11).

---

## Т1. Миграция `0101_merge_own_warehouses` — слияние двух московских записей

**Файл:** `backend/alembic/versions/0101_merge_own_warehouses.py`

Необратима автоматически — идёт отдельной ревизией и первой, чтобы дальше работать
с одной записью на город.

Логика `upgrade()`:

1. Выбрать выжившую запись: самая ранняя по `created_at` среди `COALESCE(is_deleted,0)=0`.
   Если активных записей ровно одна или ноль — миграция no-op (важно: на новом инстансе
   и в тестовой БД записей может не быть вовсе).
2. Перенести `warehouse_rent_rates` со всех прочих записей на выжившую. При совпадении
   `(warehouse_id, effective_from)` ставки **суммируются** в одну строку — аренда ведётся
   одной суммой (решение Q1), разбивка по площадкам не нужна.
3. Переставить `material_expenses` с `source_kind = 'warehouse'` и `source_id` прочих
   записей на выжившую.
4. Пересчитать кэш `own_warehouses.rent_monthly_kopecks` выжившей записи —
   `_sync_rent_cache` из `modules/warehouse_rent/service.py` делает это же на сегодняшнюю дату.
5. Прочие записи — `is_deleted = 1`, `deleted_at = NOW()::text`.

`downgrade()` — только `raise NotImplementedError` с текстом «слияние складов необратимо,
восстановление из бэкапа». Молча делать вид, что откат возможен, хуже, чем упасть.

**Приёмка:** на копии прод-БД сумма `rent_monthly_kopecks` действующих ставок аренды
и сумма `material_expenses` по `source_kind='warehouse'` совпадают до и после миграции.

**Тест:** `backend/tests/test_warehouse_rent.py` — новый кейс: две записи с пересекающимися
и непересекающимися `effective_from`, после `upgrade` действующая ставка на каждую дату
равна сумме двух прежних.

---

## Т2. Миграция `0102_branch_access` — код филиала и поля пользователя

**Файл:** `backend/alembic/versions/0102_branch_access.py`

```sql
ALTER TABLE own_warehouses ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS branch_id          TEXT,
    ADD COLUMN IF NOT EXISTS branch_access      TEXT    NOT NULL DEFAULT 'own',
    ADD COLUMN IF NOT EXISTS perm_view_costs    INTEGER,
    ADD COLUMN IF NOT EXISTS perm_view_pnl      INTEGER,
    ADD COLUMN IF NOT EXISTS perm_view_invoices INTEGER;
```

Бэкфилл:

- `own_warehouses.code = 'MSK'` у выжившей записи (уникальный индекс по `LOWER(code)`
  среди неудалённых — как у `expense_categories.name`).
- `users.branch_id` = id выжившей записи для всех пользователей, кроме `role='client'`
  (у клиента оси филиала нет — ADR 0002, §4.3 плана).
- `users.branch_access = 'all'` для `role IN ('admin','manager')`, `'own'` остальным.
- Три `perm_*` остаются `NULL` — «как решает роль», текущее поведение сохраняется.

Индекс: `CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id)`.

**Приёмка:** `alembic upgrade head` на dev-БД проходит; ни один существующий пользователь
не потерял доступ (проверяется Т12).

---

## Т3. Константы в `config.py`

**Файл:** `backend/config.py`

```python
BRANCH_ACCESS_OWN = "own"
BRANCH_ACCESS_ALL = "all"
BRANCH_ACCESS_ALL_VALUES: frozenset[str] = frozenset({BRANCH_ACCESS_OWN, BRANCH_ACCESS_ALL})
BRANCH_ACCESS_LABELS: dict[str, str] = {
    BRANCH_ACCESS_OWN: "Свой филиал",
    BRANCH_ACCESS_ALL: "Все филиалы",
}
```

`CLAUDE.md` §«Константы»: строки `'own'`/`'all'` в роутерах и SQL не хардкодить.

Идентификатор филиала «Москва» константой **не фиксируем** — в отличие от
`RECORD_ACTUALITY_YES_ID`, он не системный, а данные конкретного инстанса; на новом
инстансе (`bootstrap_instance.py`) филиал заводится админом.

---

## Т4. `backend/branch_scope.py` — хелпер изоляции

**Новый файл**, рядом с `security.py`. Пять функций, без FastAPI-зависимостей кроме
`HTTPException` (та же природа, что у `security.py`):

```python
def user_branch_id_opt(user) -> str | None
def branch_access_of(user) -> str
def visible_branch_ids(connection, user) -> list[str] | None
def resolve_branch_filter(connection, user, requested: str | None) -> list[str] | None
def ensure_branch_access(user, branch_id: str | None) -> None
def branch_sql(alias: str, branches: list[str] | None) -> tuple[str, list]
def default_branch_for_write(user, requested: str | None) -> str
```

Правила реализации:

- Доступ к полям строки — через `try/except (KeyError, IndexError)`, как в
  `security.user_client_id_opt`. Строка пользователя приходит из трёх разных `SELECT`
  (Т5), и защита от отсутствующего ключа дешевле, чем отладка `KeyError` в проде.
- `visible_branch_ids` возвращает `None` для `role='admin'` и `branch_access='all'` —
  `None` означает «без фильтра», а не «пустой список». Это различие проверяется тестом:
  пустой список обязан давать пустую выборку, а не всю.
- `resolve_branch_filter` при запросе чужого филиала — `403 «Недостаточно прав»`
  (та же строка, что `security.FORBIDDEN_DETAIL`).
- `ensure_branch_access` при чужом филиале — `404 «Документ не найден»` (инвариант I3
  ADR 0002: 403 подтвердил бы существование документа).
- `default_branch_for_write`: для `own` — только домашний филиал, попытка указать другой
  → 403; для `all` — переданный, а при отсутствии — домашний филиал автора (решение Q6:
  «у менеджера Москвы по умолчанию Москва»).
- `branch_sql` возвращает `("", [])` для `None` и `(f"AND {alias}.branch_id IN (?,?)", ids)`
  иначе — плейсхолдеры `?`, адаптер `dbconn` сам заменит на `%s`.

**Тест:** `backend/tests/test_branch_scope.py` — юнит-тесты на все ветки, включая
«пустой список ≠ None» и «own не может писать в чужой филиал».

---

## Т5. Проброс полей в сессию

**Файл:** `backend/modules/auth/service.py`

Три `SELECT` читают пользователя и все три должны отдавать новые поля, иначе поведение
будет зависеть от способа аутентификации (Bearer против refresh-cookie):

| Строка | Функция |
|---|---|
| ~172 | `get_user_by_email` |
| ~186 | `_get_user_by_refresh_cookie` |
| ~240 | `get_current_user` |

Добавить в список колонок: `branch_id, branch_access, perm_view_costs, perm_view_pnl,
perm_view_invoices`.

JWT **не расширять** — инвариант I4 ADR 0002.

**Тест:** `backend/tests/test_auth_mobile_flow.py` — новый кейс: пользователь,
аутентифицированный по refresh-cookie, и он же по Bearer видят одинаковую область.

---

## Т6. Переопределения прав в `security.py`

**Файл:** `backend/security.py`

Три функции получают проверку флага перед ролью:

```python
def _perm_override(user, key: str) -> bool | None:
    try:
        raw = user[key]
    except (KeyError, IndexError):
        return None
    return None if raw is None else bool(raw)


def can_view_costs(user) -> bool:
    override = _perm_override(user, "perm_view_costs")
    if override is not None:
        return override
    return user["role"] in ("admin", "manager")
```

Аналогично `can_manage_finance` (флаг `perm_view_invoices`) и новая `can_view_pnl`
(флаг `perm_view_pnl`).

Точки применения — по одному гейту на модуль, менять больше ничего не нужно:

| Модуль | Строка | Гейт |
|---|---|---|
| `modules/invoices/router.py` | 113 | `ensure_finance_access` |
| `modules/pnl/router.py` | 29 | `ensure_finance_access` → расщепить на `ensure_pnl_access` |
| `modules/expenses/router.py` | 88 | `ensure_finance_access` |

**Важно:** сегодня P&L и счета закрыты одним `ensure_finance_access`. Раз галочки
раздельные, гейт P&L расщепляется на собственный `ensure_pnl_access`. Это единственное
изменение ролевой матрицы в этапе — по умолчанию (`NULL`) обе функции дают тот же
результат, что сейчас, поэтому регресса нет.

**Тест:** `backend/tests/test_security_roles.py` — матрица: роль × флаг ∈ {NULL, 0, 1}
для каждого из трёх прав; отдельный кейс «флаг закрывает право, которое роль открывает».

---

## Т7. Ведение доступа: один экран, одно сохранение

**Файлы:** `backend/modules/users/router.py`, `schemas.py`

> Переработано по итогам аудита. Первая редакция предлагала два эндпоинта — филиал
> и права раздельно. Это повторило бы существующую манеру `UsersFeature.tsx`, где роль,
> имя и клиент сохраняются тремя независимыми запросами: на одного человека вышло бы
> шесть сохранений, и каждое отзывает его сессии. Открытие филиала на восьмерых — полсотни
> сохранений и восемь человек, разлогиненных по пять раз.

Один эндпоинт под `_get_users_admin` (решение Q8 — только администратор, в отличие от
`role`/`client`, доступных и менеджеру):

```
PATCH /users/{user_id}/access
{ branch_id, branch_access, perm_view_costs, perm_view_pnl, perm_view_invoices }
```

Все поля опциональны; передано — меняется, не передано — остаётся. Три `perm_*`
принимают `true` / `false` / `null`, где `null` — «по роли».

Валидация:

- `branch_id` — существующая неудалённая запись `own_warehouses`, иначе `400 «Филиал не найден»`.
- `branch_access` — из `BRANCH_ACCESS_ALL_VALUES`, иначе `400`.
- `role='client'` — филиал не назначается (`400 «Клиенту филиал не назначается»`).
- Нельзя менять доступ самому себе — как уже сделано для роли.

**Обязательно:** `_revoke_user_sessions(connection, user_id)` — **один раз** в конце,
после всех изменений. Без отзыва правка подействует только после истечения access-токена
(инвариант I4 ADR 0002); с отзывом на каждое поле человек разлогинивается по пять раз.

**Синхронизация с табелем.** У `employees` есть связь `employees.user_id`, которую ведёт
админ в карточке сотрудника, и она используется. Если у пользователя есть связанный
сотрудник, смена филиала учётки меняет и `employees.branch_id`: иначе переведённый
человек останется московским в табеле, и его ЗП продолжит падать в расход Москвы.
В этапе 1 колонки `employees.branch_id` ещё нет — задача сводится к тому, чтобы
**заложить точку синхронизации** (одна функция `_sync_employee_branch`, пока no-op
с комментарием) и не искать её потом по всему роутеру.

---

## Т7б. Массовый перевод

```
POST /users/bulk-access
{ user_ids: [...], branch_id, branch_access }
```

Открытие филиала — это перевод пачки людей разом, а не шести полей у одного.
Права (`perm_*`) в массовую операцию **не** входят: они точечные по смыслу, и массовая
раздача финансовых прав — ровно тот случай, когда удобство работает против безопасности.

Ограничения: не более 100 id за вызов; пользователи с `role='client'` и сам актор
пропускаются молча (ответ возвращает, сколько переведено и сколько пропущено, — иначе
непонятно, сработало ли); сессии отзываются каждому переведённому.

---

## Т7в. Список пользователей: филиал видно и по нему фильтруется

`UserListItem` дополняется: `branch_id`, `branch_name`, `branch_access`, три флага.
`GET /users` джойнит `own_warehouses` за именем филиала и принимает фильтр
`branch_id`. Без колонки и фильтра список после разделения становится плоской кашей,
в которой не видно, кто где.

**Тест (на Т7 / Т7б / Т7в):** `backend/tests/test_users.py` — назначение доступа одним
вызовом отзывает сессии ровно один раз; отказ назначить филиал клиенту; отказ править
себя; массовый перевод не трогает пользователей вне выборки и возвращает счётчик
пропущенных; фильтр списка по филиалу.

---

## Т8. `/me` и справочник филиалов

**Файлы:** `backend/modules/auth/router.py` (~311), `modules/auth/schemas.py`,
`modules/inventory/router.py`

`MeResponse` дополняется: `branch_id`, `branch_name`, `branch_access`,
`perm_view_costs`, `perm_view_pnl`, `perm_view_invoices` (все — с `None` по умолчанию,
чтобы старые клиенты не ломались).

Новый lookup — `GET /lookups/branches` в `modules/inventory/router.py`, рядом с
`/lookups/warehouses`, `response_model=list[DictionaryBaseItem]`.

**Зачем отдельный эндпоинт:** CRUD «Наших складов» в `modules/dictionaries/router.py`
закрыт `_get_strict_admin`. Но имя филиала нужно всем — в бейдже списка, в селекторе
у пользователя с областью `all`, в карточке документа. Читать справочник через
админский эндпоинт нельзя. Lookup отдаёт только неудалённые активные записи
(`id`, `name`, `code`) и доступен всему бэк-офисному составу.

`DictionaryBaseItem` дополняется полем `code: str | None = None` — по образцу того, как
там уже живут `rent_monthly_kopecks` и `color_hex` для отдельных справочников.
`DictionaryCreateRequest` / `DictionaryUpdateRequest` — тем же полем, чтобы код филиала
заводился штатным CRUD «Наших складов».

**Тест:** `backend/tests/test_inventory_lookups.py` — кладовщик получает список филиалов;
`test_admin_rbac.py` — он же не может править «Наши склады».

---

## Т9. Frontend: типы и api

**Файлы:** `frontend/src/api/typesUser.ts`, `usersApi.ts`, `inventoryLookupsApi.ts`

```ts
// typesUser.ts
export type BranchAccess = 'own' | 'all'

export type User = {
  // ...существующее
  branch_id?: string | null
  branch_name?: string | null
  branch_access?: BranchAccess
  perm_view_costs?: boolean | null
  perm_view_pnl?: boolean | null
  perm_view_invoices?: boolean | null
}

export const BRANCH_ACCESS_LABELS: Record<BranchAccess, string> = {
  own: 'Свой филиал',
  all: 'Все филиалы',
}
```

`usersApi.ts` — `updateUserAccess()` и `bulkUpdateUserAccess()` по образцу существующего
`updateUserRole()`. `inventoryLookupsApi.ts` — `getInventoryBranches()` рядом с
`getInventoryWarehouses()`.

`useLookups()` начинает отдавать `branches` — провайдер уже смонтирован в `AppLayout`,
добавляется один запрос. Прямые вызовы `getInventoryBranches()` в страницах/фичах
запрещены (`CLAUDE.md` §5.6).

---

## Т10. Frontend: экран доступа

**Файл:** `ui/features/dictionaries/UsersFeature.tsx` (маршрут — `ui/routes/admin.tsx`)

Блок «Доступ» с **одной** кнопкой сохранения — намеренно иначе, чем соседние поля
(роль, имя, клиент), каждое из которых сохраняется само по себе:

- селект «Филиал» из `useLookups().branches`, скрыт для `role='client'`;
- селект «Область видимости» с `BRANCH_ACCESS_LABELS`;
- три чекбокса прав, каждый трёхпозиционный: «по роли» / «разрешено» / «запрещено».
  Под каждым — подпись, что даёт роль по умолчанию, иначе состояние «по роли» нечитаемо.

Сохранение разлогинивает пользователя, и это надо сказать до, а не после:
`useConfirm()` с текстом «Пользователь будет разлогинен на всех устройствах».
`window.confirm` запрещён (`CLAUDE.md` §5.7).

В списке — колонка «Филиал», фильтр по филиалу через `useFilterParam('branch', '')`
и выбор нескольких строк для массового перевода (Т7б).

**Экран «филиал не назначен».** Найдено аудитом: новый сотрудник регистрируется сам,
получает роль `user` и остаётся без филиала. После разделения он увидит пустые таблицы
без объяснения. Проверка по `/me`: нет `branch_id` и область `own` → вместо контента
показывается «Филиал не назначен — обратитесь к администратору». Fail-closed на backend
даёт пустоту, интерфейс обязан объяснить, почему она пустая.

---

## Т11. Mobile: паритет типов

**Файл:** `mobile/src/api/authApi.ts` (+ `parity.test.ts`)

`BranchAccess` — union-тип, `BRANCH_ACCESS_LABELS` — labels: оба попадают в зону
покрытия `parity.test.ts` автоматически. Object-тип `User` — **вне** сверки
(слепая зона теста, `CLAUDE.md` §9), проверить руками.

Раскладка табов (`tabsForRole`) в этапе 1 не меняется.

**Филиал в шапке.** Кладовщику селектор не нужен, но видеть свой город он должен — иначе
первый же вопрос при разборе «почему я не вижу задачу» останется без ответа. Название
филиала из `/me` показывается рядом с именем пользователя.

---

## Т12. Новый инстанс и dev-сиды

**Файлы:** `backend/bootstrap_instance.py`, `backend/seed_test_data.py`,
`backend/clear_inventory_test_data.py`, `docs/onboarding-instance.md`

Найдено аудитом: бутстрап создаёт только администратора. В этапе 1 это ещё не ломается
(поля пользователя nullable), но начиная с этапа 4 у расхода филиал обязателен — чистый
инстанс не сможет завести первую же трату. Дешевле заложить сейчас, пока правится тот же файл:

- `bootstrap_instance.py` создаёт филиал по умолчанию (имя — параметром, код выводится
  из имени) и привязывает к нему созданного админа с `branch_access='all'`;
- `seed_test_data.py` и `clear_inventory_test_data.py` — тот же филиал в сидах;
- `docs/onboarding-instance.md` — шаг «завести филиал» в ранбуке.

Чек-лист запуска филиала (зоны и ячейки → тарифы → сотрудники → учётки → отчёт пробелов)
пишется в этапе 6, когда все части существуют; здесь только шаг развёртывания.

---

## Т13. Регрессионный прогон

Этап 1 не разделяет данные, поэтому главный критерий — **ничего не изменилось**:

```bash
cd backend && pytest                 # весь набор, не только затронутые модули
cd backend && alembic upgrade head   # на dev-БД
cd frontend && npm run build && npm test
cd mobile && npm test
```

Отдельно проверить руками:

- существующий менеджер после миграции видит ровно то же, что до неё;
- кладовщик после миграции видит ровно то же;
- клиент в ЛК не затронут (филиал ему не назначается);
- `bootstrap_instance.py` на пустой БД поднимает инстанс с филиалом.

---

## Критерий приёмки этапа

1. Филиал заводится администратором через «Наши склады», у него есть код.
2. Администратор назначает пользователю филиал, область видимости и три права **одним
   сохранением**; после назначения пользователь разлогинен ровно один раз. Массовый
   перевод переводит выборку разом.
3. `/me` отдаёт филиал, область и три права; фронт и мобилка их читают.
4. `branch_scope.py` написан и покрыт юнит-тестами, но **ещё не подключён** к
   документным эндпоинтам — это этапы 2–6.
5. Весь существующий тестовый набор зелёный; ни один пользователь не потерял доступ.
6. Суммы аренды до и после слияния записей «Наших складов» совпадают.
7. Чистый инстанс поднимается: бутстрап создаёт филиал, dev-сиды проходят.
8. Пользователь без филиала видит объяснение, а не пустой экран.

---

## Чего в этапе 1 намеренно нет

- `branch_id` на документах, зонах, журнале остатков, расходах, тарифах — этапы 2–5.
- Селектора филиала в шапке и разреза «по филиалам» в отчётах — этап 6.
- Изоляционного теста по всем роутам — этап 7: изолировать пока нечего.
