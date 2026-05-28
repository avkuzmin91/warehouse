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
      // Data-loading effects routinely setState from async fetches. Treat as warn so we see
      // new offenders but legacy hooks don't block CI.
      'react-hooks/set-state-in-effect': 'warn',
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
