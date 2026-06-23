import type { CapacitorConfig } from '@capacitor/cli'

// Android-проект создаётся с Android SDK: `npx cap add android`.
// webDir = каталог сборки Vite (`npm run build`).
const config: CapacitorConfig = {
  appId: 'com.projectff.warehouse.keeper',
  appName: 'Склад · Кладовщик',
  webDir: 'dist',
  // Для live-reload на устройстве в dev раскомментировать и указать IP машины:
  // server: { url: 'http://192.168.X.X:5174', cleartext: true },
}

export default config
