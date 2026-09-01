# Мобильное приложение кладовщика

Capacitor + React 19 + TypeScript + Vite. План и архитектурные решения — в [../docs/mobile-plan.md](../docs/mobile-plan.md).

V1-объём: вход + экран «Мои задачи» (очередь кладовщика из `GET /tasks`). Остальные операции (приёмка рейса, упаковка, раскладка, остатки) — следующие итерации.

## Запуск в браузере (разработка)

```bash
cd mobile
npm install
npm run dev          # http://localhost:5174
```

Браузерная версия ходит на backend через Vite-прокси `/api` → `http://127.0.0.1:8000`
(переопределяется `VITE_DEV_PROXY_TARGET`). Backend поднимается как в основном проекте
(`cd backend && python -m uvicorn app:app --host 127.0.0.1 --port 8000` или docker-compose).

## Проверки

```bash
npm run lint     # tsc --noEmit (type-check)
npm run build    # tsc + vite build → dist/
```

## Сборка под Android (Windows/Mac/Linux с Android SDK)

Android-проект **не** коммитится (`/android` в .gitignore) и создаётся локально:

```bash
cd mobile
npm install
npm i capacitor-secure-storage-plugin   # secure storage для refresh-токена (Android Keystore)
npm i @capacitor-mlkit/barcode-scanning # камера-сканер ШК
npm run build
npx cap add android      # генерирует android/ из capacitor.config.ts
npx cap sync android     # ставит нативные зависимости (secure storage + barcode scanning)
npx cap open android     # открывает Android Studio → Run / Build APK
```

> Нативные плагины (`capacitor-secure-storage-plugin` → `SecureStoragePlugin`,
> `@capacitor-mlkit/barcode-scanning` → `BarcodeScanning`) нужны только нативной
> сборке. В вебе они не зарегистрированы: `secureStore.ts` / `scan/ScanSource.ts`
> перехватывают вызовы (сессия живёт в cookie, сканер — ручной ввод). При замене
> плагина сохранить имя в `registerPlugin(...)`. Камере нужно разрешение
> `android.permission.CAMERA` в `android/app/src/main/AndroidManifest.xml`.

Для установки на устройство собрать APK/AAB в Android Studio; для публикации в
Google Play — подписанный AAB (release keystore).

Нативная сборка обязана знать абсолютный URL backend (прокси `/api` там не работает).
Прод-адрес зафиксирован в отслеживаемом `mobile/.env.production`.

Сборка под **тестовый контур** — переменной окружения, без правки `.env.production`
(иначе на тест уедут и будущие прод-сборки):

```bash
VITE_API_BASE_URL=https://test.pack-men.ru/api npm run build
npx cap sync android
```

## Аутентификация

- **Веб (dev):** refresh — в HttpOnly cookie `wms_rt`, как во `frontend`.
- **Натив:** запросы шлют заголовок `X-Client: mobile`; `/auth/login` и `/auth/refresh`
  возвращают refresh-токен в теле, приложение хранит его в secure storage
  (Android Keystore) и шлёт обратно на `/auth/refresh` и `/auth/logout`.
  Access-JWT (TTL 60 мин) — только в памяти, ротация переиспользует серверную
  replay-protection. Бэкенд: `backend/modules/auth/` (`X-Client`, `RefreshRequest`).

## Идемпотентность write-операций

Рвущаяся сеть не должна задваивать приёмку/перемещение (план §6.3). Write-вызовы
шлют заголовок `X-Request-Id` (UUID, `newRequestId()` в `api/http.ts`); сервер
запоминает обработанные id и на повтор отдаёт прежний ответ, не выполняя операцию
заново. id стабилен на одно логическое действие (переживает ретрай): шторки —
`useState(newRequestId)`, кнопки-действия — кеш `reqIds` по ключу действия, сброс
при успехе. Покрыты: приёмка/разгрузка рейса, перемещение остатка, передача на
упаковку, раскладка, `advance`. Бэкенд: `backend/idempotency.py` (таблица
`idempotency_keys`, миграция 0062).

## Штрихкоды

Сканер ШК (план §6.2): экран `ScanScreen` сканирует камерой (`scan/ScanSource.ts` —
ML Kit за абстракцией, позже ТСД второй реализацией) или принимает код вручную, затем
`GET /products/by-barcode/{code}` → товар/вариант. Бэкенд: у варианта может быть
несколько штрих-кодов (таблица `product_variant_barcodes`, миграция 0086; активный код
уникален и опознаёт ровно один вариант), ведение кодов —
`POST/DELETE /products/{pid}/variants/{vid}/barcodes[...]` (менеджерский состав) и
веб-карточка товара. Интеграция скана в строки приёмки/отгрузки (автоподстановка
позиции) — следующий шаг.

## Известные ограничения v1 (см. docs/mobile-plan.md)

- Очередь автоповтора write-операций при обрыве (online-first retry queue) ещё не
  выделена — id уже стабилен, очередь сможет переиспользовать его как есть.
- Штрих-коды вариантов ведутся в веб-карточке товара; ввода кода с мобилки пока нет.
- `packages/api-client` пока не выделен — мобильный API-слой самостоятельный,
  зеркалит конвенции `frontend/src/api`.
