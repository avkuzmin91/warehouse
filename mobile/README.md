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

## Сборка под iOS (только на macOS)

iOS-проект **не** коммитится (`/ios` в .gitignore) и создаётся на Mac:

```bash
# на macOS с установленным Xcode + CocoaPods
cd mobile
npm install
npm i capacitor-secure-storage-plugin   # secure storage для refresh-токена (iOS Keychain)
npm i @capacitor-mlkit/barcode-scanning # камера-сканер ШК
npm run build
npx cap add ios          # генерирует ios/ из capacitor.config.ts
npx cap sync ios         # ставит нативные поды (secure storage + barcode scanning)
npx cap open ios         # открывает Xcode → Run на симуляторе/устройстве
```

> Нативные плагины (`capacitor-secure-storage-plugin` → `SecureStoragePlugin`,
> `@capacitor-mlkit/barcode-scanning` → `BarcodeScanning`) нужны только нативной
> сборке. В вебе они не зарегистрированы: `secureStore.ts` / `scan/ScanSource.ts`
> перехватывают вызовы (сессия живёт в cookie, сканер — ручной ввод). При замене
> плагина сохранить имя в `registerPlugin(...)`. Камере нужен ключ
> `NSCameraUsageDescription` в `ios/App/App/Info.plist`.

Для установки на реальный iPhone нужен Apple Developer аккаунт (подпись).
Раздача тестировщикам — TestFlight.

Нативная сборка обязана знать абсолютный URL backend (прокси `/api` там не работает):

```bash
# mobile/.env.production
VITE_API_BASE_URL=https://api.ваш-домен
```

## Сборка под Android (Windows/Mac/Linux с Android SDK)

```bash
npm run build
npx cap add android
npx cap open android     # Android Studio → Build APK
```

## Аутентификация

- **Веб (dev):** refresh — в HttpOnly cookie `wms_rt`, как во `frontend`.
- **Натив:** запросы шлют заголовок `X-Client: mobile`; `/auth/login` и `/auth/refresh`
  возвращают refresh-токен в теле, приложение хранит его в secure storage
  (iOS Keychain / Android Keystore) и шлёт обратно на `/auth/refresh` и `/auth/logout`.
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
`GET /products/by-barcode/{code}` → товар/вариант. Бэкенд: штрих-код на варианте
(колонка `product_variants.barcode`, миграция 0063, активно-уникальный), присвоение —
`PATCH /products/{pid}/variants/{vid}/barcode` (admin). Интеграция скана в строки
приёмки/отгрузки (автоподстановка позиции) — следующий шаг.

## Известные ограничения v1 (см. docs/mobile-plan.md)

- Очередь автоповтора write-операций при обрыве (online-first retry queue) ещё не
  выделена — id уже стабилен, очередь сможет переиспользовать его как есть.
- Штрих-коды вариантов присваиваются через API; ввода в веб-карточке товара пока нет.
- `packages/api-client` пока не выделен — мобильный API-слой самостоятельный,
  зеркалит конвенции `frontend/src/api`.
