# **DICTIONARY: PRODUCTS (Товары)**

------

# 1. Цель

Реализовать справочник товаров с поддержкой:

- вариативных товаров (цвет / размер / габариты)
- массового создания вариантов
- фильтрации и сортировки
- редактирования

------

# 2. Архитектура модели

Справочник состоит из двух сущностей:

- Product (базовый товар)
- ProductVariant (вариации товара)

------

## 2.1 Product

```
{
  id: string

  name: string
  type_id: string
  sku_base: string

  client_id: string

  is_active: boolean

  created_at: datetime
  created_by: string

  updated_at: datetime
  updated_by: string
}
```

------

## 2.2 ProductVariant

```
{
  id: string

  product_id: string

  color_id: string
  size_id: string | null

  length: number | null
  width: number | null
  height: number | null

  sku: string

  images: string[]

  is_active: boolean
}
```

------

# 3. Зависимости

Использует справочники:

- Product Types
- Clients
- Colors
- Sizes

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

Отображает Product (не варианты)

Колонки:

1. Название
2. Тип товара
3. Клиент
4. Количество вариантов
5. Актуален
6. Дата создания

------

## 5.4 Сортировка

Доступна по:

- name
- type
- client
- is_active
- created_at

------

## 5.5 FiltersPanel

------

### Фильтры:

- name (text)
- type_id (select)
- client_id (select)
- is_active (Да / Нет)

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

### Базовые поля (Product)

------

#### 1. Название (name)

- text
- обязательное

------

#### 2. Тип товара (type_id)

- select
- обязательное
- источник: Product Types

------

#### 3. Базовый штрих-код (sku_base)

- text
- обязательное

------

#### 4. Клиент (client_id)

- select
- источник: Clients

------

------

### Вариативные поля

------

## 6.3.1 Цвета (colors)

- multi-select
- источник: Colors
- обязательное поле

------

## 6.3.2 Фотографии

- multi file upload
- можно загрузить несколько файлов
- отображается preview
- возможность удаления

------

## 6.3.3 Габариты (DimensionsBlock)

------

### Поведение зависит от типа товара

------

### Если type = "техника"

- один блок:

```
Длина
Ширина
Высота
```

------

### Если type = "одежда"

Список блоков:

```
Габарит:
  длина
  ширина
  высота

Размеры:
  multi-select (Sizes)
```

------

Пример:

```
[Габарит 1]
10 x 20 x 30
Размеры: S, M, L

[Габарит 2]
12 x 22 x 32
Размеры: XL, XXL
```

------

------

# 7. ГЕНЕРАЦИЯ ВАРИАНТОВ

------

## 7.1 Общая логика

При сохранении создаются ProductVariant

------

## 7.2 Для одежды

```
для каждого габарита:
  для каждого размера:
    для каждого цвета:
      создать variant
```

------

## Формула:

```
variants = colors × sizes
```

------

## 7.3 Для техники

```
для каждого цвета:
  создать variant
```

------

## Формула:

```
variants = colors
```

------

## 7.4 SKU генерация

```
sku = sku_base + color + size (опционально)
```

------

Пример:

```
TSHIRT-RED-M
PHONE-BLACK
```

------

------

# 8. СОХРАНЕНИЕ

------

## API

```
POST /products
```

------

## Request

```
{
  "product": {
    "name": "string",
    "type_id": "string",
    "sku_base": "string",
    "client_id": "string",
    "is_active": true
  },
  "colors": ["color_id"],
  "dimensions": [
    {
      "length": 10,
      "width": 20,
      "height": 30,
      "sizes": ["size_id"]
    }
  ],
  "images": []
}
```

------

## Поведение

- backend создаёт:
  - Product
  - ProductVariants

------

------

# 9. EDIT PAGE

------

## 9.1 Маршрут

```
/dictionaries/products/{id}
```

------

## 9.2 Структура

Используется:

- PageContainer
- Form Pattern
- ActionBar
- SystemInfoBlock

------

## 9.3 Поведение

------

### Загрузка:

```
GET /products/{id}
```

------

### Loading:

- loader
- форма disabled

------

### Ошибка:

- "Товар не найден"

------

------

## 9.4 Редактирование

------

### Разрешено:

- базовые поля (name, type, client)
- is_active

------

### Ограничение:

❗ вариации (colors, sizes, dimensions) НЕ редактируются в этой версии

(редактируются отдельно — future scope)

------

------

# 10. SYSTEM INFO

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

# 11. API

------

## List

```
GET /products
```

------

## Get

```
GET /products/{id}
```

------

## Create

```
POST /products
```

------

## Update

```
PATCH /products/{id}
```

------

------

# 12. Ограничения

- без модалок
- без inline edit
- select только активные значения
- массовое редактирование вариантов не реализовано

------

# 13. Итог

Справочник товаров:

- реализует variant-based модель
- поддерживает массовое создание
- использует глобальные компоненты системы
- масштабируем для e-commerce сценариев