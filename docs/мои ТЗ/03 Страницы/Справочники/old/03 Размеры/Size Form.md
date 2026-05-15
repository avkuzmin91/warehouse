# SIZE FORM CONFIG

---

# 1. Цель

Определить конфигурацию формы для сущности **Size**.

Используется в:

- create
- edit
- view

через COMPONENT: FormPage

---

# 2. Data Model

```ts
Size {
  id: string
  name: string
  code: string
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
- label: "Название размера"
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
- подсветка полей

------

# 5. API

------

## Create

POST /sizes

```
{
  "name": "string",
  "is_active": true
}
```

------

## Update

PATCH /sizes/{id}

```
{
  "name": "string",
  "is_active": true
}
```

------

## Get

GET /sizes/{id}

------

## Ошибки

- "Код уже существует"

------

# 6. Инициализация

------

## Create

- пустая форма
- is_active = true

------

## Edit

- GET /sizes/{id}
- заполнение формы

------

## Loading

- loader
- disabled форма

------

## Not found

- "Размер не найден"
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

→ /dictionaries/sizes

------

## После update

→ /dictionaries/sizes

------

## Отмена

→ /dictionaries/sizes

------

# 9. Доступ

- admin only

------

# 10. Проверка

------

## Create

- создание работает

------

## Edit

- обновление работает

------

## Validation

- ошибки отображаются

------

## API error

- не сбрасывает форму

------

## Access

- 403 для user
