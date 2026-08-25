import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deja en `dist/version.json` cuál es el archivo de código de ESTA publicación.
//
// Es lo único que el portal ya corriendo puede preguntarle al servidor para
// saber si lo suyo quedó viejo — y hace falta porque hasta ahora se enteraba
// sólo cuando YA había fallado un archivo, o sea con la persona ya trabada, y
// resolvía recargando sin preguntar (ver `src/utils/versionNueva.js`).
//
// Se emite el NOMBRE DEL ARCHIVO de entrada y no sólo el número de versión: lo
// que rompe no es el número, es que el archivo con hash viejo dejó de existir.
// Dos publicaciones pueden llevar el mismo número y romper igual. El número
// viaja también, pero sólo para poder nombrarlo en pantalla.
function huellaDeVersion() {
  return {
    name: 'farmalasa-huella-de-version',
    apply: 'build',
    generateBundle(_opciones, bundle) {
      const entrada = Object.values(bundle).find((a) => a.type === 'chunk' && a.isEntry)
      const fuente = readFileSync(new URL('./src/version.js', import.meta.url), 'utf-8')
      const version = (fuente.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || null
      if (!entrada) {
        // Sin entrada no hay nada que comparar, y un `version.json` a medias
        // haría que el portal se crea al día para siempre. Mejor que no exista:
        // el detector trata la ausencia como «no sé» y no avisa nada.
        this.warn('no se encontró el chunk de entrada: no se emite version.json')
        return
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ v: version, e: entrada.fileName }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), huellaDeVersion()],
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
