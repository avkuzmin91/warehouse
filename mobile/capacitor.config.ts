import process from 'node:process'
import type { CapacitorConfig } from '@capacitor/cli'

// Android-проект создаётся с Android SDK: `npx cap add android`.
// webDir = каталог сборки Vite (`npm run build`).
//
// DEV live-reload: эмулятор грузит UI с Vite dev-сервера на хосте. Включается ТОЛЬКО
// переменной окружения CAP_SERVER_URL — например:
//   CAP_SERVER_URL=http://10.0.2.2:5174 npx cap sync
// (10.0.2.2 = loopback хоста из Android-эмулятора). Без неё сборка — продовая, UI из
// dist. Раньше адрес был зашит в комментарии и его легко было забыть убрать перед
// прод-сборкой; env-флаг исключает эту ошибку.
const devServerUrl = process.env.CAP_SERVER_URL?.trim()

const config: CapacitorConfig = {
  appId: 'com.projectff.warehouse.keeper',
  appName: 'Склад',
  webDir: 'dist',
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: true } } : {}),
}

export default config
