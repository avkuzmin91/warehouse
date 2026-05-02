# COMPONENT: FILTERS PANEL

---

# 1. Цель

Универсальный композиционный компонент для управления списками сущностей.

Объединяет:

- фильтрацию данных
- управление Query State
- синхронизацию с URL
- действия над коллекцией (Collection Actions)

---

# 2. Область применения

Используется на list-страницах:

- справочники
- товары
- клиенты
- пользователи
- любые таблицы

---

# 3. Общая структура

Компонент состоит из двух зон: [ Filters ] -------------------- [ Collection Actions ]

---

# 4. UI структура

---

## 4.1 Расположение

- в соответствии с PageContainer
- в соответствии с List Page Pattern

---

## 4.2 Визуальная структура

- горизонтальный flex layout
- gap: 12–16px
- элементы фильтров слева
- действия (actions) справа
- wrap на mobile

---

# 5. Filters (левая часть)

---

## 5.1 Поддерживаемые элементы

### Search

- текстовый input
- debounce 300–500ms

---

### Select

- типизированные значения
- зависит от сущности

---

### Boolean filter

- Да / Нет

---

## 5.2 Поведение

- изменение → update Query State
- update → API reload
- синхронизация с URL

---

# 6. Collection Actions (правая часть)

- будет описано в ТЗ для Collection Actions

---

## 6.3 Ограничения

- не содержит бизнес-логики
- не выполняет API запросы напрямую
- полностью зависит от Query State

---

# 7. State Model

```ts
{
  search?: string,
  type?: string,
  is_active?: boolean,
  page: number,
  limit: number,
  sort?: string
}
```

# 8. URL синхронизация

------

## Пример

```
/dictionaries/products?search=shirt&type=clothes&page=1
```

------

## Правила

- UI ↔ URL синхронизированы
- URL — источник состояния при загрузке

------

# 9. API интеграция

```
GET /products
```

------

## Правила

- пустые поля не отправляются
- формируется единый query object

------

# 10. Ограничения

- запрещено хранить state только локально
- запрещено разделять actions и filters
- запрещено использовать без Query State Management

------

# 11. Сценарии тестирования

- поиск с debounce
- select фильтрация
- reset filters
- create navigation
- восстановление состояния из URL
