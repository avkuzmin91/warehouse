import { createRequire } from 'node:module'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Версия приложения — единый источник истины package.json (UI читает APP_VERSION).
const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

// Браузерная разработка: проксируем `/api` на backend, как во frontend.
// Нативная сборка (Android) ходит по абсолютному URL из VITE_API_BASE_URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
    server: {
      host: true,
      port: 5174,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  }
})
