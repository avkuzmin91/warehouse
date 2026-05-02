**LIST PAGE PATTERN**

# 1. Цель

Определить стандарт сборки страниц списков сущностей.

---

# 2. Область применения

Обязательно для:

- справочников
- товаров
- клиентов
- пользователей
- любых list-страниц

---

# 3. Концепция

List Page = композиция:

- Query State Management
- Filters + Actions (Filters Panel)
- Sorting
- Pagination
- Table
- Navigation

---

# 4. Базовая структура

<PageContainer>  <Breadcrumbs />  <FiltersPanel />  <Table />  <Pagination /> </PageContainer> 

------

# 5. Обязательные компоненты

------

## 5.1 FiltersPanel

- фильтры + actions
- синхронизация с Query State
- управляет состоянием списка

------

## 5.2 Table

- отображение данных
- кликабельные строки
- сортировка через Sorting system

------

## 5.3 Pagination

- page / limit
- синхронизация с Query State
- влияет на API

------

# 6. Поведение страницы

------

## 6.1 Инициализация

1. читается Query State (из URL)
2. выполняется API запрос
3. отображается таблица

------

## 6.2 Обновление данных

Любое изменение:

- filters
- sort
- page
- limit

→ обновляет Query State → вызывает API reload

------

## 6.3 Навигация

### Row click

```
/{entity}/{id}
```

------

### Create button (через FiltersPanel)

```
/{entity}/new
```

------

# 7. Состояния

------

## Loading

- skeleton
- disabled controls

------

## Empty

- пустая таблица
- сообщение "Данные отсутствуют"

------

## Error

- ошибка API
- retry

------

# 8. Query State Integration

------

## Хранит:

- filters
- sort
- page
- limit

------

## Источник истины:

- URL + Query State

------

# 9. UI правила

- PageContainer обязателен
- maxWidth определяется контейнером
- адаптивность обязательна

------

# 10. Ограничения

- запрещено inline edit
- запрещены модалки для CRUD
- запрещено хранить state вне Query State

------

# 11. Зависимости

Использует:

- PageContainer
- FiltersPanel
- Table
- Sorting
- Pagination
- Query State Management

------

# 12. Итог

List Page Pattern = стандарт сборки list-страниц
