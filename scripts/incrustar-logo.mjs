/**
 * Vuelve a pegar el logo de la empresa dentro de los documentos que lo llevan
 * EMBEBIDO, y no enlazado.
 *
 *     node scripts/incrustar-logo.mjs             (informa, no escribe)
 *     node scripts/incrustar-logo.mjs --escribir
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El logo de la empresa vive en un solo sitio para el portal —la constante
 * `LOGO_DE_LA_EMPRESA` de `src/utils/marcaDeLaSala.js`, que apunta a
 * `public/logo-farmacias.png`— así que cambiarlo es cambiar el archivo y ya.
 *
 * **Salvo en el reglamento y el afiche de Puntos Salud, que lo llevan pegado
 * adentro como `data:image/png;base64`.** Y eso es a propósito: los dos son
 * archivos que se mandan sueltos, se publican en línea y se imprimen para la
 * vitrina; si el logo fuera un `<img src="/logo-farmacias.png">`, el papel de
 * la vitrina saldría con un hueco y la copia que alguien reenvía por correo,
 * también.
 *
 * El costo de esa decisión —correcta— es que **un logo pegado no se entera de
 * que el archivo cambió**. Pasó el 2026-09-01: se centró «FARMACIAS», el portal
 * entero lo tomó sin tocar una línea, y estos dos documentos se quedaron con el
 * anterior sin dar ningún error. No hay forma de notarlo leyendo el código: se
 * ve un `<img>` con una cadena larguísima y adentro está el logo de antes.
 *
 * Por eso el arreglo no es «acordarse»: es este script. Cambiar el logo pasa a
 * ser dos comandos, y el segundo dice cuáles documentos tocó.
 *
 * ── Después de correrlo, regenerar lo derivado ─────────────────────────────
 *
 *     npm run legal:web        → public/reglamento-puntos.html · public/privacidad.html
 *     npm run legal:pdf        → los tres PDF de docs/legal/
 *     npm run afiche:puntos    → docs/legal/AFICHE-...pdf
 *
 * `public/reglamento-puntos.html` y `public/privacidad.html` NO están en la
 * lista de destinos aunque tengan el logo pegado: los genera
 * `documento-legal-web.mjs` desde los de `docs/`, y escribirlos acá también los
 * dejaría al día por un rato y desincronizados en cuanto alguien edite la
 * fuente. Lo derivado se regenera, no se parcha.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESCRIBIR = process.argv.includes('--escribir');

/** El logo aprobado. Es el mismo archivo que usa el portal. */
const LOGO = 'public/logo-farmacias.png';

/** Los documentos que lo llevan pegado. Sólo FUENTES: nada derivado. */
const DESTINOS = [
    'docs/legal/reglamento-programa-de-puntos.html',
    'docs/legal/afiche-programa-de-puntos.html',
    'docs/legal/aviso-de-privacidad.html',
    'docs/legal/acuerdo-de-nombramiento-delegado.html',
    'docs/legal/formulario-solicitud-datos.html',
    'docs/legal/afiche-aviso-de-privacidad.html',
];

/* El `alt` es el ancla, y no la posición ni el tamaño de la cadena: es lo único
 * que dice QUÉ imagen es. Un documento puede pegar mañana otra imagen —un QR,
 * un sello— y este script no tiene por qué confundirse. */
const ALT = 'Farmacias La Popular y La Salud';
const IMG = new RegExp(
    `(<img\\s+src=")data:image/png;base64,[A-Za-z0-9+/=]+("[^>]*alt="${ALT}"[^>]*>)`,
    'g',
);

const png = fs.readFileSync(path.join(RAIZ, LOGO));
const b64 = png.toString('base64');
console.log(`logo: ${LOGO} · ${(png.length / 1024).toFixed(1)} kB\n`);

let cambiados = 0;
let sinAncla = 0;

for (const rel of DESTINOS) {
    const abs = path.join(RAIZ, rel);
    if (!fs.existsSync(abs)) { console.log(`${rel}\n  ✗ no existe\n`); sinAncla++; continue; }

    const antes = fs.readFileSync(abs, 'utf8');
    const encontrados = antes.match(IMG)?.length ?? 0;

    /* Un reemplazo que no encuentra su ancla NO falla: simplemente no hace
     * nada, y el documento se queda con el logo viejo mientras el script
     * informa que todo salió bien. Por eso se cuenta antes de escribir. */
    if (!encontrados) {
        console.log(`${rel}\n  ✗ no tiene ningún <img> con alt="${ALT}" — ¿le cambiaron el ancla?\n`);
        sinAncla++;
        continue;
    }

    const despues = antes.replace(IMG, `$1data:image/png;base64,${b64}$2`);
    if (despues === antes) {
        console.log(`${rel}\n  ✓ ya tiene el logo al día (${encontrados} imagen/es)\n`);
        continue;
    }

    console.log(`${rel}\n  ${ESCRIBIR ? 'actualizado' : 'hay que actualizar'}: ${encontrados} imagen/es`);
    if (ESCRIBIR) {
        fs.writeFileSync(abs, despues);
        console.log(`  escrito   ${(fs.statSync(abs).size / 1024).toFixed(1)} kB`);
    }
    console.log('');
    cambiados++;
}

if (sinAncla) {
    console.error(`✗ ${sinAncla} documento(s) sin el ancla esperada — revisalos a mano.`);
    process.exit(1);
}
if (!ESCRIBIR && cambiados) console.log('(nada se escribió — agregá --escribir)');
if (ESCRIBIR && cambiados) {
    console.log('Falta regenerar lo derivado:');
    console.log('  npm run legal:web');
    console.log('  npm run legal:pdf');
    console.log('  npm run afiche:puntos');
}
