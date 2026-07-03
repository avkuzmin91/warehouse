import { defineConfig } from 'vitest/config'

// Тесты чистых утилит — node environment достаточно (без React/DOM).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
