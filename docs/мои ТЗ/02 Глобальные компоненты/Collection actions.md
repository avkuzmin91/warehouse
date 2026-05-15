# COMPONENT: Collection Actions

---

# 1. Цель

Определить набор действий над коллекцией внутри FiltersPanel.

---

# 2. Контекст использования

- Всегда используется внутри FiltersPanel

---

# 3. Назначение

Содержит действия, относящиеся ко всему списку:

- создание нового элемента
- (расширяемо: экспорт, bulk actions)

---

# 4. Состав

---

## 4.1 Primary Action

### Создание (Create)

- иконка "+"
- переход: /{entity}/new

---

## 4.2 Secondary Action

### Сброс фильтров (Reset Filters)

- очищает Query State (filters)
- сбрасывает URL (page = 1)
- вызывает reload списка

---

# 5. UI размещение

---

- справа внутри FiltersPanel
- рядом с фильтрами
- визуально отделено spacing’ом

---

# 6. Поведение

---

## Create

- navigation only
- не влияет на state

---

## Reset

- очищает filters
- не сбрасывает сортировку
- reload данных

---

# 7. Ограничения

- запрещено использовать вне FiltersPanel
- запрещено добавлять API логику
- запрещено дублировать UI в таблицах

---

# 8. Архитектурное правило

FiltersPanel = Filters + CollectionActions

---

# 9. Итог

Collection Actions = встроенный блок управления списком внутри FiltersPanel
