import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'android', 'ios', '.agents']),
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
])
