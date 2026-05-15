# Auth cookie regression (browser)

Источник истины — DevTools в браузере (не CLI). Окружение: SPA через Vite с префиксом `/api`.

## Чеклист

1. **Login** (`POST /api/auth/login`): в Application → Cookies появляется `wms_rt`, `Path=/api`, `HttpOnly`, `SameSite=Lax` (и `Secure` в prod).
2. **Refresh** (F5 или заход на защищённый URL): в Network у `POST /api/auth/refresh` в запросе есть `Cookie: wms_rt=...`; в ответе одно `Set-Cookie` с новым значением; в Application остаётся **одна** запись `wms_rt`.
3. **Logout**: `POST /api/auth/logout` → 204; `wms_rt` удалён из браузера.

## Ограничения PR3

Правки только вне зон: контракты `/auth/*`, cookie-семантика, bootstrap и single-flight refresh — оформляются отдельным PR (PR4+).
