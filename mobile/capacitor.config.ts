import type { CapacitorConfig } from '@capacitor/cli'

// Android-проект создаётся с Android SDK: `npx cap add android`.
// webDir = каталог сборки Vite (`npm run build`).
const config: CapacitorConfig = {
  appId: 'com.projectff.warehouse.keeper',
  appName: 'Склад · Кладовщик',
  webDir: 'dist',
  // DEV live-reload: эмулятор грузит UI с Vite dev-сервера на хосте (10.0.2.2 = loopback
  // хоста из Android-эмулятора). API идёт по относительному /api → Vite-прокси → backend:8000.
  // ВЕРНУТЬ обратно (закомментировать) перед сборкой test/prod APK!
  server: { url: 'http://10.0.2.2:5174', cleartext: true },
}

export default config
