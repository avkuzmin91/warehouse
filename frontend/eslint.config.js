import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Data-loading effects routinely call setState inside .then() from async fetches —
      // это намеренный паттерн для list/detail-страниц. Правило ловит и эти legitimate cases,
      // и form-sync (sync display from props). Включить обратно стоит только после миграции
      // на TanStack Query / Suspense-based loaders.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: [
      'src/ui/routes/**/*.tsx',
      'src/ui/primitives/**/*.tsx',
      'src/ui/feedback/**/*.tsx',
    ],
    rules: {
      // Route and primitive modules intentionally export small helpers/types next to components.
      'react-refresh/only-export-components': 'off',
    },
  },
])
