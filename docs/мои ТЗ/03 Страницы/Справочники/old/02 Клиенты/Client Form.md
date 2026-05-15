# CLIENT FORM CONFIG

------

# 1. Цель

Определить конфигурацию формы для сущности **Client**.

Используется в:

- create page
- edit page
- view page

(через COMPONENT: FormPage)

------

# 2. Data Model

```
Client {
  id: string
  name: string
  is_active: boolean

  created_at: datetime
  created_by: string
  updated_at: datetime
  updated_by: string
}
```

------

# 3. Поля формы

## 3.1 name

- тип: text
- label: "Название клиента"
- обязательное: да
- placeholder: "Введите название клиента"

------

## 3.2 is_active

- тип: checkbox
- label: "Актуален"
- default (create): true
- editable: да

------

# 4. Валидация

При submit:

- name:
  - обязательное
  - не пустое

------

### Ошибки:

- общее сообщение:
   "Заполните обязательные поля"
- поле:
  - подсветка name

------

# 5. API

------

## 5.1 Create

POST /clients

```
{
  "name": "string",
  "is_active": true
}
```

------

## 5.2 Update

PATCH /clients/{id}

```
{
  "name": "string",
  "is_active": true
}
```

------

## 5.3 Get by id

GET /clients/{id}

------

## 5.4 Ошибки

Примеры:

- "Клиент уже существует"

Поведение:

- отображается сообщение
- форма не сбрасывается

------

# 6. Инициализация

------

## Create mode

- форма пустая
- is_active = true

------

## Edit mode

- выполняется:
   GET /clients/{id}
- данные заполняют форму

------

## Loading state

- loader
- форма disabled

------

## Not found

- "Клиент не найден"
- кнопка "Назад" → /dictionaries/clients

------

# 7. Audit данные

Используется:

- COMPONENT: SystemInfoBlock

------

### Поля:

- created_at
- created_by
- updated_at
- updated_by

------

### Поведение:

- отображаются только в edit/view
- read-only
- берутся из API

------

# 8. Навигация

------

## После create:

→ /dictionaries/clients

------

## После update:

→ /dictionaries/clients

------

## Отмена:

→ /dictionaries/clients

------

# 9. Доступ

- только admin
- иначе 403
