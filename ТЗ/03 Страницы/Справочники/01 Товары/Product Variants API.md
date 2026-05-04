# **API: Product Variants**

---

# 1. Цель

Определить API для работы с вариантами товара (SKU).

---

# 2. Сущность

ProductVariant

---

# 3. Модель

```
{
 id: string

product_id: string

color_id: string

dimension: {
 length: number
 width: number
 height: number
 }

size_id: string | null

sku: string

images: string[]

is_active: boolean

created_at: datetime
 updated_at: datetime
 }
```



---

# 4. Получение вариантов

---

## GET /products/{id}/variants

---

### Response:

```
[
 {
 id,
 color_id,
 dimension,
 size_id,
 sku,
 images,
 is_active
 }
 ]
```

---

# 5. Массовое обновление вариантов

---

## PATCH /products/{id}/variants

---

### Request:

```
{
 variants: [
 {
 id: string,

  color_id: string,
  dimension: { length, width, height },
  size_id: string | null,

  images: string[],
  is_active: boolean
}
]
}
```

---

## Поведение:

- обновляются существующие
- новые создаются (если id = null)
- отсутствующие → могут удаляться (опционально)

---

# 6. Удаление варианта

---

## DELETE /products/{id}/variants/{variant_id}

---

### Поведение:

- soft delete (is_active = false)
или
- hard delete (по настройке)

---

# 7. Создание вариантов (internal)

---

❗ НЕ используется напрямую из UI

---

Используется:

POST /products

---

Backend:

- вызывает Product Variant Create Strategy
- создаёт variants автоматически

---

# 8. Валидация

---

## Проверяется:

- уникальность комбинации:

color_id + dimension + size_id

---

- корректность ссылок:
  - color_id существует
  - size_id существует

---

# 9. Ошибки

---

## Примеры:

- "Variant already exists"
- "Invalid size_id"
- "Invalid dimension"

---

# 10. Ограничения

---

- нельзя создать variant без product
- нельзя дублировать комбинации
- нельзя менять product_id

---

# 11. Связь с системой

Используется:

- Product Variants Editor
- Product Create Strategy

---

# 12. Итог

Variants API:

- управляет SKU товара
- отделён от Product API
- поддерживает массовое обновление