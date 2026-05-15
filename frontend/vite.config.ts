import { existsSync } from 'node:fs'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Прокси /api в dev:
 * - `VITE_DEV_PROXY_TARGET` — явно (docker-compose задаёт http://backend:8000 для контейнера frontend);
 * - иначе внутри Docker (`/.dockerenv`) — сервис `backend`;
 * - иначе на хосте — uvicorn на loopback (README: npm run dev + compose только db/backend).
 */
function resolveDevApiProxyTarget(): string {
  const fromEnv = (process.env.VITE_DEV_PROXY_TARGET || '').trim()
  if (fromEnv) return fromEnv
  if (existsSync('/.dockerenv')) {
    return 'http://backend:8000'
  }
  return 'http://127.0.0.1:8000'
}

const devApiProxyTarget = resolveDevApiProxyTarget()

export default defineConfig(async () => {
  const plugins: PluginOption[] = [react()]

  try {
    const { visualizer } = await import('rollup-plugin-visualizer')
    plugins.push(
      visualizer({
        filename: 'dist/bundle-stats.html',
        gzipSize: true,
        template: 'treemap',
      }),
    )
  } catch {
    // Пакет не в node_modules (урезанный образ / старый volume) — dev-сервер всё равно стартует.
  }

  return {
    plugins,
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      // Запросы через nginx с Host: dev.pack-men.ru — иначе Vite отвечает 403
      allowedHosts: ['dev.pack-men.ru', 'localhost', '127.0.0.1'],
      proxy: {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, '') || '/',
        },
      },
    },
  }
})
