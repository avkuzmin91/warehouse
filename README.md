# Warehouse (WMS)

FastAPI + React (Vite) + nginx + Docker Compose.

## Ветки и окружения

| Ветка Git   | Окружение   | Compose-файл              |
|------------|-------------|---------------------------|
| `develop`  | Development | `docker-compose.dev.yml`  |
| PR / CI    | Test        | `docker-compose.test.yml` |
| `main`     | Production  | `docker-compose.prod.yml` |

- **develop → dev:** разработка и интеграция ветки `develop`, деплой dev-стека на отдельных портах.
- **main → production:** только стабильные изменения в `main`, деплой на production.

## Переменные окружения

Скопируйте примеры (секреты не в репозитории):

```bash
cp .env.dev.example .env.dev
cp .env.test.example .env.test
# production: только на сервере, из .env.prod.example → .env.prod
```

## Development (`develop`)

```bash
git checkout develop
docker compose -f docker-compose.dev.yml up -d --build
```

- UI: `http://<host>:8080`
- Backend с хоста: порт `8001`
- Postgres с хоста: `5433`

## Test

```bash
cp .env.test.example .env.test
docker compose -f docker-compose.test.yml up -d --build
```

- UI: `http://<host>:9080`

Остановка тестового стека: `docker compose -f docker-compose.test.yml stop`  
Полная очистка **только тестовых** томов: `docker compose -f docker-compose.test.yml down -v` (не использовать на production).

## Production (`main`)

```bash
git checkout main
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

Не удаляйте том `db_data` без явной необходимости — в нём данные PostgreSQL.

## Nginx и API

Production compose монтирует **`nginx/nginx.conf`**. Для `/api/` используется `proxy_pass http://backend:8000/;` (завершающий `/` обязателен). В коде: `FastAPI(root_path="/api")` в `backend/main.py`.
