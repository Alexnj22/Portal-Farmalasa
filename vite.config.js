import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@capacitor/geolocation', '@capacitor-community/background-geolocation'],
  },
  build: {
    rollupOptions: {
      external: (id) => id.startsWith('@capacitor/geolocation') || id.startsWith('@capacitor-community/background-geolocation'),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // `Cross-Origin-Embedder-Policy: require-corp` estuvo acá y bloqueaba
      // TODA imagen de Supabase Storage: 58 fotos de empleados por sesión, sin
      // CORP en la respuesta del bucket (auditoría 2026-07-29). Solo afectaba
      // a dev — `vercel.json` nunca mandó COEP, así que en producción las
      // fotos siempre cargaron — pero significa que meses de verificación
      // visual local corrieron con las fotos rotas y eso se leía como un dato
      // faltante, no como un header. Nada del portal necesita
      // `crossOriginIsolated` (no hay SharedArrayBuffer ni wasm con hilos), y
      // dev debe parecerse a producción, no ser más estricto que ella.
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
