import type { CapacitorConfig } from '@capacitor/cli'

// iOS/Android-проекты создаются на Mac/с Android SDK: `npx cap add ios` / `add android`.
// webDir = каталог сборки Vite (`npm run build`).
const config: CapacitorConfig = {
  appId: 'com.projectff.warehouse.keeper',
  appName: 'Склад · Кладовщик',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
  },
  // Для live-reload на устройстве в dev раскомментировать и указать IP машины:
  // server: { url: 'http://192.168.X.X:5174', cleartext: true },
}

export default config
