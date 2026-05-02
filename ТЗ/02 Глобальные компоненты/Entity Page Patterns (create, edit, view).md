# # ENTITY PAGE PATTERNS (Create / Edit / View)

------

# 1. Цель

Определить единый стандарт построения страниц:

- создания сущности (Create)
- редактирования сущности (Edit)
- просмотра сущности (View / Detail)

Применяется ко всем доменным объектам:

- товары
- клиенты
- справочники
- любые сущности системы

------

# 2. Область применения

Обязательно используется для страниц:

- `/dictionaries/*`
- `/clients/*`
- `/inventory/*`
- любых entity routes

------

# 3. Базовая концепция

Каждая entity-страница строится по единому паттерну:

```
PageContainer
  Breadcrumbs
  Form / View Content
  Optional: System Info Block
  ActionBar
```

------

# 4. Типы страниц

## 4.1 Create Page

- создание новой сущности
- пустая форма
- отправка POST

Маршрут:

```
/{entity}/new
```

------

## 4.2 Edit Page

- редактирование существующей сущности
- форма предзаполнена
- отправка PATCH/PUT

Маршрут:

```
/{entity}/{id}
```

------

## 4.3 View Page

- только просмотр данных
- без редактирования
- может совпадать с edit UI в readOnly режиме

------

# 5. Глобальная структура UI

## 5.1 Общая структура

```
<PageContainer>

  <Breadcrumbs />

  <EntityForm | EntityView />

  <SystemInfoBlock /> (optional)

  <ActionBar />

</PageContainer>
```

------

# 6. Form Pattern (Create / Edit)

## 6.1 Общие правила

- форма вертикальная
- поля соответствуют Data Model
- обязательные поля помечаются `*`
- единый validation flow

------

## 6.2 Поведение формы

### Create

- форма пустая
- default values применяются (если есть)
- POST запрос

------

### Edit

- данные загружаются через API
- форма инициализируется данными
- PATCH/PUT запрос

------

# 7. View Pattern (Read-only)

## 7.1 Поведение

- все поля read-only
- input заменяется на text display
- кнопки редактирования отсутствуют или disabled

------

# 8. ActionBar (глобальный компонент)

Используется во всех Create/Edit страницах

## 8.1 Содержит:

- Primary Action (Сохранить / Создать)
- Secondary Action (Отмена)

------

## 8.2 Поведение:

### Сохранить / Создать

- выполняет валидацию
- отправляет API запрос
- redirect после успеха

------

### Отмена

- переход назад в список
- изменения не сохраняются

------

# 9. SystemInfoBlock (аудит данные)

## 9.1 Назначение

Отображение системных данных сущности

------

## 9.2 Поля:

- created_at
- created_by
- updated_at
- updated_by

------

## 9.3 Правила:

- только read-only
- только Edit и View режимы
- Create не содержит

------

# 10. Breadcrumb Pattern

Общий компонент:

- строится автоматически из URL
- последняя крошка зависит от режима:

### Create:

```
Создание {Entity}
```

### Edit:

```
Редактирование {Entity}
```

### View:

```
Просмотр {Entity}
```

------

# 11. Loading Pattern

## 11.1 Edit / View

- loader во время GET /{id}
- форма disabled до загрузки

------

## 11.2 Create

- loader только при инициализации (если есть defaults)

------

# 12. Error States

## 12.1 Not Found

- entity не существует
   → экран "Не найдено"

------

## 12.2 API Error

- отображается toast / inline error
- форма не сбрасывается

------

# 13. Navigation Rules

## 13.1 Open Edit

- клик по строке таблицы
   → `/entity/{id}`

------

## 13.2 Open Create

- кнопка "Создать"
   → `/entity/new`

------

## 13.3 Cancel

- возврат в список
   → `/entity`

------

# 14. UI Rules

- PageContainer обязателен
- max-width зависит от типа страницы:
  - list: 1200
  - form: 640
- без modals для CRUD
- без inline edit

------

# 15. Integration Rules

Использует глобальные системы:

- SYSTEM: Query State Management (для list)
- COMPONENT: Breadcrumbs
- COMPONENT: ActionBar
- COMPONENT: SystemInfoBlock

------

# 16. Итог

Этот документ заменяет необходимость дублировать:

- create page MD
- edit page MD
- view page MD

Они теперь описываются как **вариации одного паттерна**, а не отдельные спецификации.
