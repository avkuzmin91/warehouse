# # SYSTEM: Audit Fields Management

------

## 1. Цель

Определить правила формирования audit-полей:

- created_at
- created_by
- updated_at
- updated_by

------

## 2. Общие правила

Audit поля:

- генерируются только backend
- не передаются с frontend
- не могут быть изменены вручную

------

## 3. Логика создания записи (POST)

При создании сущности:

```
created_at = now()
created_by = currentUser

updated_at = null
updated_by = null
```

------

## 4. Логика обновления записи (PATCH / PUT)

При любом изменении:

```
updated_at = now()
updated_by = currentUser
```

------

## 5. Исключения

### Если данные не изменились

(опционально, зависит от backend)

```
если payload не изменил запись:
  updated_at НЕ обновляется
```

------

## 6. Источник пользователя

```
currentUser = user из auth context (JWT / session)
```

------

## 7. Запрещено

- принимать audit поля из frontend
- позволять их редактировать
- подменять updated → created

------

## 8. Возврат в API

Все GET endpoints обязаны возвращать:

```
{
  "created_at": "...",
  "created_by": "...",
  "updated_at": "...",
  "updated_by": "..."
}
```