/**
 * El reglamento de puntos, como página pública — sin iniciar sesión.
 *
 * Sale del MISMO archivo que el PDF de la sala
 * (`docs/legal/reglamento-programa-de-puntos.html`). Dos originales del mismo
 * reglamento es cómo se llega a que el de la pared y el del sitio digan cosas
 * distintas, y el que reclama siempre tiene el otro.
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
 *   node scripts/reglamento-puntos-web.mjs <fuente.html> [salida.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fuente = process.argv[2];
const salida = process.argv[3] ?? 'public/reglamento-puntos.html';
if (!fuente) { console.error('falta el HTML de origen'); process.exit(1); }

let cuerpo = readFileSync(resolve(fuente), 'utf8');

// El archivo de origen pide las tipografías a Google porque así se publica en
// línea. Acá se les cambia el origen, no la elección.
const enlacesGoogle = /\s*<link rel="preconnect"[^>]*>\s*|\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g;
if (!enlacesGoogle.test(cuerpo)) {
  console.error('el HTML de origen ya no pide las tipografías a Google — revisar este script');
  process.exit(1);
}
cuerpo = cuerpo.replace(enlacesGoogle, '\n');

// El `<title>` viaja adentro del cuerpo (el publicador de artefactos lo lee de
// ahí). En un documento HTML de verdad va en el `<head>`, así que se muda.
const tituloEnCuerpo = cuerpo.match(/<title>([^<]*)<\/title>\s*/);
const titulo = tituloEnCuerpo ? tituloEnCuerpo[1] : 'Reglamento del Programa de Puntos';
if (tituloEnCuerpo) cuerpo = cuerpo.replace(tituloEnCuerpo[0], '');

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
<meta name="description" content="Reglamento del Programa de Puntos de Farmacias La Popular y La Salud. Cómo se acumulan, cómo se canjean y cuándo vencen.">
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
