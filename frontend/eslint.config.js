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
      // Current data-loading components intentionally update local state from effects.
      // The app is not yet structured around React Compiler data primitives.
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
