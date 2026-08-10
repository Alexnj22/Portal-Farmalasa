import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist-*` además de `dist`: la regla multisesión de CLAUDE.md manda compilar
  // con `OUT_DIR=dist-<nombre> npm run build` para no pisar el `dist/` de otra
  // sesión, así que el árbol acumula carpetas de build que este ignore no veía
  // (27 el 2026-08-10). No era ruido: ESLint las recorría enteras y moría
  // formateando el informe —`RangeError: Invalid string length`— o sea que
  // `npm run lint` no fallaba por el código, fallaba siempre.
  globalIgnores(['dist', 'dist-*', 'android', 'ios', '.agents']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      react,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Solo esta regla de eslint-plugin-react (no el set "recommended" completo):
      // marca como usadas las variables referenciadas en JSX (<motion.div>,
      // <Icon />) que no-unused-vars no detecta por sí solo sin el plugin.
      'react/jsx-uses-vars': 'error',
    },
  },
  {
    // Configs de build/test y specs corren en Node, no en el browser — necesitan
    // `process`/`__dirname`/etc. en vez de (o además de) los globals de browser.
    files: ['*.config.js', 'tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Vercel serverless functions (api/) corren en Node, no en el browser.
    files: ['api/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Service worker (public/sw.js) tiene su propio scope global (self, clients,
    // registration...), distinto del browser normal.
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
])
