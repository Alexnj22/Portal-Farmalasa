import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Deja en `dist/version.json` qué COMPILACIÓN es ésta, y la misma marca en
// `index.html` (`<meta name="portal-build">`).
//
// Es lo único que el portal ya corriendo puede preguntarle al servidor para
// saber si lo suyo quedó viejo — y hace falta porque hasta ahora se enteraba
// sólo cuando YA había fallado un archivo, o sea con la persona ya trabada, y
// resolvía recargando sin preguntar (ver `src/utils/versionNueva.js`).
//
// Hasta el 2026-11-07 la marca era el NOMBRE del archivo de entrada
// (`index-<hash>.js`). Ese nombre ahora es fijo (`assets/index.js`, ver
// `entryFileNames` abajo), así que la marca es una huella de la compilación:
// el código final de la entrada más la lista de TODOS los archivos. Cualquier
// cambio servido la mueve: un pedazo que cambia cambia de nombre, ese nombre
// vive dentro de quien lo importa, y la cadena llega hasta la entrada. La
// lista de archivos va igual, por las dudas. El número de versión viaja
// también, pero sólo para poder nombrarlo en pantalla.
//
// `enforce: 'post'`: tiene que correr DESPUÉS de que Vite escriba
// `index.html` en el bundle, para poder ponerle la marca.
function huellaDeVersion() {
  return {
    name: 'farmalasa-huella-de-version',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opciones, bundle) {
      const entrada = Object.values(bundle).find((a) => a.type === 'chunk' && a.isEntry)
      const fuente = readFileSync(new URL('./src/version.js', import.meta.url), 'utf-8')
      const version = (fuente.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || null
      const html = bundle['index.html']
      if (!entrada || !html || typeof html.source !== 'string') {
        // Sin entrada o sin html no hay nada que comparar, y un `version.json`
        // a medias haría que el portal se crea al día para siempre. Mejor que
        // no exista: el detector trata la ausencia como «no sé» y no avisa.
        this.warn('no se encontró la entrada o index.html: no se emite version.json')
        return
      }
      const huella = createHash('sha256')
        .update(entrada.code)
        .update('\0')
        .update(Object.keys(bundle).filter((f) => f !== 'index.html').sort().join('\n'))
        .digest('hex')
        .slice(0, 16)
      if (!html.source.includes('</head>')) {
        this.warn('index.html sin </head>: no se emite version.json')
        return
      }
      html.source = html.source.replace('</head>', `  <meta name="portal-build" content="${huella}">\n  </head>`)
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ v: version, e: huella }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), huellaDeVersion()],
  // El núcleo portable (F7 de docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md). Todo lo
  // que cruza su borde va por alias —`@nucleo/…` desde las pantallas,
  // `@plataforma/…` desde el núcleo—, así mudarlo es cambiar esta ruta y nada
  // más. `@plataforma` lo pone cada app: la web, `src/plataforma`; el
  // teléfono, sus adaptadores. Lo vigila `scripts/nucleo-alias.mjs`.
  resolve: {
    alias: {
      '@nucleo': fileURLToPath(new URL('./src', import.meta.url)),
      '@plataforma': fileURLToPath(new URL('./src/plataforma', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@capacitor/geolocation', '@capacitor-community/background-geolocation'],
  },
  // El worker de quitar fondo (`plataforma/fondoWorker.js`) importa
  // onnxruntime, que se parte en chunks: en formato iife no se puede.
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      external: (id) => id.startsWith('@capacitor/geolocation') || id.startsWith('@capacitor-community/background-geolocation'),
      // B2 (PENDIENTES 33): las librerías de terceros en chunks propios. Su
      // contenido no cambia entre despliegues, así que su nombre tampoco y el
      // navegador las conserva; antes viajaban dentro del chunk de entrada y
      // se volvían a bajar enteras con cada versión del portal.
      output: {
        // Nombres estables (2026-11-07). Con `index-<hash>.js`, cada
        // publicación renombraba ~630 de ~730 archivos aunque cambiara una sola
        // línea: 623 importan la entrada por su nombre, y el número de versión
        // vive en la entrada. El navegador volvía a bajar todo y el CDN de
        // Vercel pasó de 1M a 2.8M peticiones al mes. Medido con dos
        // compilaciones seguidas: cambiar sólo la versión renombraba 633; así,
        // 0. Cambiar una vista renombra 3 (ella y sus piezas).
        //
        // Las dos líneas van juntas:
        //  - la entrada sin hash, y por eso `vercel.json` la sirve SIN la
        //    caché `immutable` de un año (se revalida en cada carga);
        //  - los nombres de lo que exporta la entrada sin acortar: acortados
        //    («a», «b»…) cambian de una compilación a otra, y entonces cada
        //    pedazo que los importa cambiaría de contenido igual. Cuesta ~1.7%
        //    del peso comprimido.
        // Una pestaña vieja no se mezcla: ya tiene SU entrada cargada en
        // memoria, y un pedazo con el mismo nombre tiene el mismo contenido,
        // o sea que importa justo lo que esa entrada exportaba.
        entryFileNames: 'assets/[name].js',
        minifyInternalExports: false,
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'vendor-react';
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          // Nombre fijo para que `gate:bundle` lo reconozca si vuelve a entrar estático.
          if (id.includes('node_modules/pdfjs-dist/')) return 'pdfjs';
          return undefined;
        },
      },
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
    // `apps/` es la app del teléfono: tiene sus propias dependencias (y sus pruebas).
    // `.claude/` son los worktrees de los agentes: sin excluirlo, vitest corría
    // las pruebas de cada copia y de sus node_modules (2026-10-21).
    exclude: ['tests/e2e/**', 'node_modules/**', 'apps/**', '.claude/**'],
  },
})
