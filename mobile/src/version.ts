// Версия приложения для UI (профиль, экран входа). Подставляется при сборке из
// package.json "version" (см. define __APP_VERSION__ в vite.config.ts) — синхронить
// руками не нужно.
declare const __APP_VERSION__: string

export const APP_VERSION = __APP_VERSION__
