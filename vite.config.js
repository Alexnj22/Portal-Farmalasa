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
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
