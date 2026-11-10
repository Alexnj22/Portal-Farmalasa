import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { boda } from './src/config.js';

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
  return {
    name: 'vista-previa',
    transformIndexHtml: (html) => html.replace('<!-- vista-previa -->', etiquetas),
  };
}

export default defineConfig({
  plugins: [react(), vistaPrevia()],
  // Vive dentro de otro repo: sin esto Vite hereda el postcss.config del padre.
  css: { postcss: {} },
  server: { port: 5180 },
  // heic2any (1.3 MB) es un chunk aparte que sólo baja quien sube un HEIC que su
  // navegador no sabe leer; el aviso de tamaño no aplica a él.
  build: { chunkSizeWarningLimit: 1400 },
});
