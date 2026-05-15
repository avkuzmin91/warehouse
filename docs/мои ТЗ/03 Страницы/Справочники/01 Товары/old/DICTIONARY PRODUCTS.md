# **DICTIONARY: PRODUCTS (Товары)**

------

# 1. Цель

Реализовать справочник товаров с возможностью:

- просмотра списка
- фильтрации и сортировки
- создания
- редактирования

------

# 2. Data Model

```
{
  id: string

  name: string
  type_id: string
  sku: string

  client_id: string
  supplier_id: string

  image_url: string | null

  is_active: boolean

  created_at: datetime
  created_by: string

  updated_at: datetime
  updated_by: string
}
```

------

# 3. Зависимости

Использует справочники:

- Product Types
- Clients
- Suppliers

------

## ВАЖНО

Во всех select:

- отображаются только `is_active = true`

------

# 4. Доступ

- только admin
- иначе 403

------

# 5. LIST PAGE

------

## 5.1 Маршрут

```
/dictionaries/products
```

------

## 5.2 Структура

Используется:

- LIST PAGE PATTERN
- FiltersPanel
- Table
- Pagination
- Sorting
- Query State Management

------

## 5.3 Таблица

Колонки:

1. Название
2. Тип товара
3. Артикул
4. Клиент
5. Поставщик
6. Фото
7. Актуален
8. Дата создания

------

### Фото:

- миниатюра 40x40
- если нет → пусто

------

## 5.4 Сортировка

Доступна по:

- Название
- Тип товара
- Артикул
- Клиент
- Поставщик
- Актуален
- Дата создания

------

## 5.5 FiltersPanel

------

### Фильтры:

- name (text)
- type_id (select)
- sku (text)
- client_id (select)
- supplier_id (select)
- is_active (Да / Нет)
- Дата создания

------

### ВАЖНО:

Все select:

- только активные значения

------

### Actions:

- CreateButton → `/dictionaries/products/new`
- ResetFilters

------

------

# 6. CREATE PAGE

------

## 6.1 Маршрут

```
/dictionaries/products/new
```

------

## 6.2 Структура

Используется:

- PageContainer
- Breadcrumbs
- Form Pattern
- ActionBar

------

## 6.3 Форма

------

### Поля:

------

### 1. Название (name)

- text
- обязательное

------

### 2. Тип товара (type_id)

- select
- обязательное
- источник: Product Types
- только is_active = true

------

### 3. Артикул (sku)

- text
- обязательное
- уникальное

------

### 4. Клиент (client_id)

- select
- источник: Clients
- только активные

------

### 5. Поставщик (supplier_id)

- select
- источник: Suppliers
- только активные

------

### 6. Фотография (image_url)

- file upload
- форматы: jpg, png, heic
- preview после выбора

------

### 7. Актуален (is_active)

- checkbox
- default: true

------

------

## 6.4 Поведение

------

### Инициализация:

- форма пустая
- is_active = true

------

### Валидация:

- name обязателен
- type_id обязателен
- sku обязателен

------

### Сохранение:

```
POST /products
{
  "name": "string",
  "type_id": "string",
  "sku": "string",
  "client_id": "string",
  "supplier_id": "string",
  "is_active": true
}
```

------

### Файл:

- отправляется multipart/form-data

------

### Ошибка:

- "SKU уже существует"

------

### Успех:

→ редирект на список

------

------

# 7. EDIT PAGE

------

## 7.1 Маршрут

```
/dictionaries/products/{id}
```

------

## 7.2 Структура

Используется:

- PageContainer
- Form Pattern
- ActionBar
- SystemInfoBlock

------

## 7.3 Загрузка

```
GET /products/{id}
```

------

## 7.4 Форма

Та же, что Create

------

## 7.5 Поведение

------

### Loading:

- loader
- форма disabled

------

### Ошибка:

- "Товар не найден"

------

### Сохранение:

```
PATCH /products/{id}
```

------

### Успех:

→ редирект на список

------

### Ошибка:

- "SKU уже существует"

------

------

# 8. SYSTEM INFO

Используется:

- SystemInfoBlock

------

Поля:

- created_at
- created_by
- updated_at
- updated_by

------

------

# 9. API

------

## List:

```
GET /products
```

------

## Create:

```
POST /products
```

------

## Update:

```
PATCH /products/{id}
```

------

## Get:

```
GET /products/{id}
```

------

------

# 10. Ограничения

- без модалок
- без inline edit
- select только активные значения

------

# 11. Итог

Справочник товаров:

- сложная сущность
- использует связанные справочники
- реализуется через композицию глобальных компонентов