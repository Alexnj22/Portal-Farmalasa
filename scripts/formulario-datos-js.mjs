/**
 * El formulario de solicitud de datos, como papel que imprime el PORTAL.
 *
 * Sale del MISMO archivo que el PDF de la sala
 * (`docs/legal/formulario-solicitud-datos.html`). Dos originales del mismo
 * formulario es cómo se llega a que el de la sala y el que imprime el portal
 * pidan cosas distintas, y quien reclama siempre tiene el otro.
 *
 * ── Dos diferencias con el PDF, y las dos son a propósito ─────────────────
 *
 *   · **El logo va enlazado, no pegado.** El de `docs/` lo lleva embebido
 *     porque viaja suelto por correo y se imprime desde cualquier lado; la
 *     ventana de impresión del portal es del MISMO origen, así que
 *     `/logo-farmacias.png` carga sin problema. Pegado, este archivo pesaría
 *     90 kB de base64 dentro del paquete de una vista.
 *   · **El folio va escrito.** En el papel de la sala es una raya que alguien
 *     llena a mano; acá el número ya existe, porque la fila se creó al pedir
 *     la impresión. Ese es el punto de todo el módulo.
 *
 *   node scripts/formulario-datos-js.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FUENTE = 'docs/legal/formulario-solicitud-datos.html';
const SALIDA = 'src/generated/formularioDatos.js';

let cuerpo = readFileSync(FUENTE, 'utf8');

// Fuera el `<title>` y las `<meta>` del documento: acá los pone la ventana.
for (const re of [/<title>[^<]*<\/title>\s*/, /<meta name="[^"]+" content="[^"]*">\s*/g]) {
    cuerpo = cuerpo.replace(re, '');
}

// El logo, enlazado. Si el `alt` cambia en la fuente, este script se cae en vez
// de emitir un papel sin logo: un documento de la empresa sin su marca no es un
// detalle estético, es un papel que no se reconoce como suyo.
const IMG = /<img\s+src="data:image\/png;base64,[A-Za-z0-9+/=]+"([^>]*alt="Farmacias La Popular y La Salud"[^>]*)>/g;
const antes = cuerpo.match(IMG)?.length ?? 0;
if (antes === 0) {
    console.error(`${FUENTE}: no encontré el logo embebido — ¿cambió el alt?`);
    process.exit(1);
}
cuerpo = cuerpo.replace(IMG, '<img src="/logo-farmacias.png"$1>');

// El folio: en el papel es una raya, acá es el número. Dos sitios, el
// encabezado y el acuse, y los dos tienen que llevar el mismo.
const FOLIO = /<span class="folio"><\/span>/g;
const folios = cuerpo.match(FOLIO)?.length ?? 0;
if (folios !== 2) {
    console.error(`${FUENTE}: esperaba 2 espacios de folio y encontré ${folios}`);
    process.exit(1);
}
cuerpo = cuerpo.replace(FOLIO, '<span class="folio impreso">__FOLIO__</span>');

// La raya deja de ser raya cuando lleva número escrito.
cuerpo = cuerpo.replace(
    '  .folio { display: inline-block; width: 6rem; border-bottom: 1px solid var(--ink-3); }',
    '  .folio { display: inline-block; width: 6rem; border-bottom: 1px solid var(--ink-3); }\n'
    + '  .folio.impreso { width: auto; border-bottom: 0; font-weight: 700;\n'
    + '                   font-family: "IBM Plex Sans", system-ui, sans-serif;\n'
    + '                   font-variant-numeric: tabular-nums; }');

const js = `// ─────────────────────────────────────────────────────────────────────────────
// GENERADO. No editar a mano.
//
// Sale de \`${FUENTE}\` por \`npm run legal:js\`.
// Para cambiar el formulario se edita ESE archivo y se regenera; editar acá
// deja el papel del portal diciendo algo distinto del que está en la sala.
// ─────────────────────────────────────────────────────────────────────────────

/** El cuerpo del formulario, con \`__FOLIO__\` donde va el correlativo. */
const CUERPO = ${JSON.stringify(cuerpo)};

/**
 * El papel listo para la ventana de impresión.
 * @param {string} folio  el correlativo ya asignado, ej. \`2026-0007\`
 * @returns {string} documento HTML completo
 */
export function papelDeSolicitudDeDatos(folio) {
    return '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        + '<title>Solicitud ' + folio + '</title>'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '</head><body>'
        + CUERPO.replaceAll('__FOLIO__', folio)
        + '</body></html>';
}
`;

writeFileSync(SALIDA, js, 'utf8');
console.log('Papel escrito en', SALIDA, `(${Math.round(js.length / 1024)} kB)`);
