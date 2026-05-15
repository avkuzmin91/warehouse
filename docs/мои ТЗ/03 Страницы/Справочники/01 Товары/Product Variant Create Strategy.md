# **SYSTEM: Product Variant Create Strategy**

---

# 1. Цель

Определить единый механизм генерации вариантов товара (SKU) при создании.

---

# 2. Концепция

Варианты создаются автоматически на основе комбинации:

- цветов
- габаритов
- размеров (опционально)

---

## Формула:

variants = colors × (dimension → sizes mapping)

---

# 3. Входные данные (Create Form)

---

## 3.1 Общие поля

- name
- type_id
- sku (базовый)
- client_id

---

## 3.2 Цвета

colors: color_id[]

- множественный выбор
- только активные значения

---

## 3.3 Габариты

---

### Для техники:

dimensions: [
 { length, width, height }
 ]

---

### Для одежды:

dimension_size_map: [
 {
 dimension: { length, width, height },
 size_ids: string[]
 }
 ]

---

# 4. Алгоритм генерации

---

## 4.1 Для техники

variants = colors × dimensions

---

### Пример:

- colors = 3
- dimensions = 1

→ variants = 3

---

## 4.2 Для одежды

variants = colors × sizes

(где размеры привязаны к габаритам)

---

### Пример:

- colors = 8
- sizes = 9
- dimensions = 3 (группы размеров)

→ variants = 8 × 9 = 72

---

# 5. Псевдокод

variants = []

for color in colors:
 for group in dimension_size_map:
 for size in group.size_ids:
 variants.push({
 color_id: color,
 dimension: group.dimension,
 size_id: size
 })

---

# 6. SKU генерация

---

## Формула:

sku_variant = base_sku + "-" + color_code + "-" + size_code

---

## Пример:

TSHIRT-RED-M
 TSHIRT-BLUE-L

---

## ВАЖНО:

- SKU варианта уникален
- base sku используется как префикс

---

# 7. Фото

---

## Логика:

- фото НЕ участвуют в генерации
- добавляются позже (или копируются)

---

# 8. Поведение при создании

---

## UI:

Пользователь:

1. заполняет форму
2. выбирает:
   - цвета
   - габариты / размеры

---

## При нажатии "Создать":

1. выполняется POST /products
2. backend:
   - создаёт product
   - генерирует variants
   - сохраняет variants

---

# 9. Валидация

---

## Проверяется:

- есть хотя бы 1 цвет
- есть хотя бы 1 dimension
- для одежды:
  - есть size_ids

---

# 10. Ограничения

---

- нельзя создавать товар без вариантов
- нельзя создавать пустые комбинации
- нельзя дублировать комбинации

---

# 11. Связь с другими системами

Использует:

- Product Variants Editor
- Products Dictionary
- Sizes Dictionary
- Colors Dictionary

---

# 12. Итог

Create Strategy:

- полностью автоматизирует создание SKU
- устраняет ручной ввод комбинаций
- обеспечивает консистентность данных