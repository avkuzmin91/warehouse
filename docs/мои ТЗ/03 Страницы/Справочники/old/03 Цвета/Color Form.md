# COLOR FORM CONFIG

---

# 1. Цель

Определить конфигурацию формы для сущности **Color**.

Используется в:

- create
- edit
- view

через COMPONENT: FormPage

---

# 2. Data Model

```ts
Color {
  id: string
  name: string
  is_active: boolean

  created_at: datetime
  created_by: string
  updated_at: datetime
  updated_by: string
}
```

# 3. Поля формы

------

## 3.1 name

- тип: text
- label: "Название цвета"
- обязательное: да

------

## 3.2 is_active

- тип: checkbox
- label: "Актуален"
- default: true

------

# 4. Валидация

------

## Проверки:

- name не пустой

------

## Ошибки:

- "Заполните обязательные поля"
- подсветка поля name

------

# 5. API

------

## Create

POST /colors

```
{
  "name": "string",
  "is_active": true
}
```

------

## Update

PATCH /colors/{id}

```
{
  "name": "string",
  "is_active": true
}
```

------

## Get

GET /colors/{id}

------

## Ошибки

Пример:

- "Цвет уже существует"

------

# 6. Инициализация

------

## Create

- форма пустая
- is_active = true

------

## Edit

- GET /colors/{id}
- заполнение формы

------

## Loading

- loader
- форма disabled

------

## Not found

- "Цвет не найден"
- кнопка "Назад"

------

# 7. Audit блок

Используется:

- COMPONENT: SystemInfoBlock

------

## Поля:

- created_at
- created_by
- updated_at
- updated_by

------

## Поведение:

- только read-only
- только edit/view

------

# 8. Навигация

------

## После create

→ /dictionaries/colors

------

## После update

→ /dictionaries/colors

------

## Отмена

→ /dictionaries/colors

------

# 9. Доступ

- admin only

------

# 10. Проверка

------

## Create

- создаётся цвет

------

## Edit

- обновляется

------

## Validation

- ошибки отображаются

------

## API error

- не сбрасывает форму

------

## Access

- 403 для user
