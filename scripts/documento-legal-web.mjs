/**
 * Un documento legal de la empresa, como página pública — sin iniciar sesión.
 *
 * Hoy publica el reglamento del programa de puntos (`/reglamento-puntos`) y el
 * aviso de privacidad (`/privacidad`). Cada uno sale del MISMO archivo que su
 * PDF de la sala. Dos originales del mismo documento es cómo se llega a que el
 * de la pared y el del sitio digan cosas distintas, y el que reclama siempre
 * tiene el otro.
 *
 * Es HTML PLANO, no una vista del portal, y eso es la decisión:
 *
 *   · No necesita sesión, ni React, ni que el portal esté sano. Es un documento
 *     que promete estar disponible; que dependa de la aplicación entera para
 *     mostrarse es exactamente lo que no puede pasar.
 *   · Abre en un parpadeo desde el QR de la vitrina, con el teléfono de
 *     cualquiera y con la señal que haya.
 *   · No trae ni una línea de JavaScript, así que no hay nada que pueda leer,
 *     escribir ni pedirle datos a quien lo lee.
 *
 * Las tipografías van SERVIDAS POR NOSOTROS (`public/fuentes/`) y no desde
 * Google. No es una preferencia: la CSP del sitio (`vercel.json`) sólo admite
 * estilos y fuentes propias, así que las de Google saldrían bloqueadas y la
 * página se vería con letras de repuesto — parecida a otro documento. Servirlas
 * desde `self` las deja entrar sin tocar la CSP, que es lo que había que evitar:
 * abrirle un permiso a TODO el portal para arreglar UNA página.
 *
 * El `<title>` y la `<meta name="description">` salen del PROPIO documento, no
 * de este archivo: son texto del documento, y escritos acá se quedarían viejos
 * el día que alguien reescriba la fuente sin mirar el generador.
 *
 *   node scripts/documento-legal-web.mjs <fuente.html> [salida.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fuente = process.argv[2];
const salida = process.argv[3];
if (!fuente || !salida) {
  console.error('uso: node scripts/documento-legal-web.mjs <fuente.html> <salida.html>');
  process.exit(1);
}

let cuerpo = readFileSync(resolve(fuente), 'utf8');

// El archivo de origen pide las tipografías a Google porque así se publica en
// línea. Acá se les cambia el origen, no la elección.
const enlacesGoogle = /\s*<link rel="preconnect"[^>]*>\s*|\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g;
if (!enlacesGoogle.test(cuerpo)) {
  console.error('el HTML de origen ya no pide las tipografías a Google — revisar este script');
  process.exit(1);
}
cuerpo = cuerpo.replace(enlacesGoogle, '\n');

// El `<title>` y la descripción viajan adentro del cuerpo (el publicador de
// artefactos lee el título de ahí). En un documento HTML de verdad van en el
// `<head>`, así que se mudan.
//
// Los dos son OBLIGATORIOS y el script se cae sin ellos: son lo que ve quien
// encuentra la página por un buscador o la recibe por un enlace, y un documento
// que obliga no puede llegar sin decir qué es.
const tituloEnCuerpo = cuerpo.match(/<title>([^<]*)<\/title>\s*/);
if (!tituloEnCuerpo) { console.error(`${fuente} no declara <title>`); process.exit(1); }
const titulo = tituloEnCuerpo[1];
cuerpo = cuerpo.replace(tituloEnCuerpo[0], '');

const descEnCuerpo = cuerpo.match(/<meta name="description" content="([^"]*)">\s*/);
if (!descEnCuerpo) { console.error(`${fuente} no declara <meta name="description">`); process.exit(1); }
const descripcion = descEnCuerpo[1];
cuerpo = cuerpo.replace(descEnCuerpo[0], '');

// El pie de página es cosa del PDF (`documento-legal-pdf.mjs`), no de la web.
// Se retira para que no viaje como una `<meta>` suelta dentro del `<body>`.
cuerpo = cuerpo.replace(/<meta name="pie-de-pagina" content="[^"]*">\s*/, '');

// Los mismos `unicode-range` que sirve Google: sin ellos el navegador se baja
// las dos variantes siempre, y `latin-ext` no la usa ni una letra del documento.
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const cara = (familia, archivo, rango, pesos) => `
  @font-face {
    font-family: '${familia}';
    font-style: normal;
    font-weight: ${pesos};
    font-display: swap;
    src: url(/fuentes/${archivo}) format('woff2');
    unicode-range: ${rango};
  }`;

// Las dos son tipografías VARIABLES: un archivo cubre todo el rango de peso, así
// que declarar el rango entero evita que el navegador simule la negrita.
const fuentes = [
  cara('IBM Plex Sans', 'ibm-plex-sans-latin.woff2', LATIN, '100 700'),
  cara('IBM Plex Sans', 'ibm-plex-sans-latin-ext.woff2', LATIN_EXT, '100 700'),
  cara('Source Serif 4', 'source-serif-4-latin.woff2', LATIN, '200 900'),
  cara('Source Serif 4', 'source-serif-4-latin-ext.woff2', LATIN_EXT, '200 900'),
].join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<meta name="description" content="${descripcion}">
<meta name="robots" content="index,follow">
<meta name="color-scheme" content="light dark">
<style>
${fuentes}
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; }
</style>
</head>
<body>
${cuerpo}
</body>
</html>
`;

writeFileSync(resolve(salida), html, 'utf8');
console.log('Página escrita en', salida, `(${Math.round(html.length / 1024)} kB)`);
