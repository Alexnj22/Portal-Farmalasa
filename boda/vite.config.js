import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { boda } from './src/config.js';
import { imagenAdaptable, ANCHOS_PORTADA } from './src/lib/fotos.js';

// Vista previa del enlace (WhatsApp, Facebook, iMessage): esos servicios no
// corren JavaScript, así que el título, el texto y la foto tienen que estar
// escritos en el HTML. Se arman al compilar desde src/config.js.
function vistaPrevia() {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fecha = new Date(boda.fecha).toLocaleDateString('es', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: boda.zonaHoraria,
  });
  const sitio = (boda.sitio || '').replace(/\/$/, '');
  const absoluta = (u) => (/^https?:\/\//.test(u) ? u : `${sitio}${u.startsWith('/') ? '' : '/'}${u}`);
  const titulo = `${boda.novios.firma} · ${fecha}`;
  const texto = 'Guarda la fecha, confirma tu asistencia y comparte tus fotos.';
  const imagen = boda.portadaCompartir || boda.portada;
  const etiquetas = [
    `<title>${esc(titulo)}</title>`,
    `<meta name="description" content="${esc(texto)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(titulo)}" />`,
    `<meta property="og:description" content="${esc(texto)}" />`,
    imagen && `<meta property="og:image" content="${esc(absoluta(imagen))}" />`,
    sitio && `<meta property="og:url" content="${esc(sitio)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].filter(Boolean).join('\n    ');
  // La foto de la portada es lo más grande que pinta la primera pantalla: se
  // pide desde el HTML, antes de que corra el JavaScript.
  const p = imagenAdaptable(boda.portada, ANCHOS_PORTADA, '100vw');
  const precargaFoto = p.srcSet
    ? `<link rel="preload" as="image" imagesrcset="${esc(p.srcSet)}" imagesizes="100vw" fetchpriority="high" />`
    : `<link rel="preload" as="image" href="${esc(p.src)}" fetchpriority="high" />`;
  return {
    name: 'vista-previa',
    transformIndexHtml: (html) => html.replace('<!-- vista-previa -->', `${etiquetas}\n    ${precargaFoto}`),
  };
}

// Precarga de la letra de los nombres (Bodoni Moda normal y cursiva): sin
// esto el navegador la descubre tarde, al leer el CSS, y los nombres saltan.
// El nombre del archivo lleva un hash que sólo se conoce al final de la compilación.
function precargaFuentes() {
  return {
    name: 'precarga-fuentes',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const fuentes = Object.keys(ctx.bundle)
          .filter((f) => /bodoni-moda-latin-opsz-(normal|italic)-[\w-]+\.woff2$/.test(f))
          .map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`);
        return html.replace('</title>', `</title>\n    ${fuentes.join('\n    ')}`);
      },
    },
  };
}

// La noche del sitio (oklch 0.16 0.008 105) para la barra del sistema y el arranque.
const NOCHE = '#0e0d0a';

export default defineConfig({
  plugins: [
    react(), vistaPrevia(), precargaFuentes(),
    VitePWA({
      // La actualización la decide src/lib/pwa.js (en la siguiente navegación).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'iconos/apple-touch-icon.png'],
      manifest: {
        name: boda.novios.firma,
        short_name: `${boda.novios.ella[0]}&${boda.novios.el[0]}`,
        description: 'Nuestra boda: la fecha, la confirmación, el álbum y el día en vivo.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: NOCHE,
        theme_color: NOCHE,
        icons: [
          { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El cascarón y las fuentes, listos sin red. heic2any (1.3 MB) sólo lo
        // baja quien lo necesita: fuera del precache.
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        globIgnores: ['**/heic2any-*.js', '**/Admin-*.js', '**/PanelPruebas-*.js', '**/Pantalla-*.js', '**/Dj-*.js', '**/client-zip-*.js', '**/leaflet-src-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/assets\//],
        cleanupOutdatedCaches: true,
        // Sólo las fotos del config. NUNCA Supabase (datos y álbum en vivo):
        // ninguna regla las toca, así que van siempre a la red.
        runtimeCaching: [{
          urlPattern: ({ url }) => url.origin === 'https://images.unsplash.com',
          handler: 'CacheFirst',
          options: {
            cacheName: 'fotos-config',
            expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
      },
    }),
  ],
  // Vive dentro de otro repo: sin esto Vite hereda el postcss.config del padre.
  css: { postcss: {} },
  server: { port: 5180 },
  // heic2any (1.3 MB) es un chunk aparte que sólo baja quien sube un HEIC que su
  // navegador no sabe leer; el aviso de tamaño no aplica a él.
  build: { chunkSizeWarningLimit: 1400 },
});
