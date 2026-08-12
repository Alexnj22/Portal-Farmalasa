#!/usr/bin/env node
/**
 * Verifica que el PDF del Corte Z ocupe UNA HOJA POR SUCURSAL.
 *
 * Existe porque el requisito se rompió dos veces seguidas el 2026-08-12 sin que
 * nada avisara: primero por el bloque de comprobaciones, y después —ya con la
 * hoja "arreglada"— por un SOLO renglón de veredicto que se pasó a la segunda
 * página. Las dos veces lo encontró el usuario abriendo el archivo.
 *
 * La lección es que **el alto de una hoja no se lee, se mide**. Revisar el
 * código no dice cuántas hojas salen; hay que correr el mismo motor de
 * maquetado que corre en el navegador y contar.
 *
 * Cómo cuenta: no parsea el PDF —pdfkit comprime y el conteo por texto es
 * frágil— sino que envuelve el `footer` del documento, al que pdfmake le pasa
 * el total de páginas ya resuelto durante el render. Es el mismo número que
 * termina impreso en «Página 1 de N».
 *
 * El caso que se mide es el PEOR: una sucursal con retención, que suma el
 * renglón de aviso bajo el total y una fila más en el cotejo. Si esa entra, las
 * demás entran. Los datos son los de Salud 3 en julio de 2026 — el mes que
 * destapó todo esto.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');

// El fuente importa sin extensión (`./formatNumber`), que Vite resuelve y Node
// no. Se compila con esbuild —el mismo resolvedor que usa el build— en vez de
// tocar los imports del fuente para que un script pueda leerlos: el archivo que
// se mide tiene que ser el que se despacha, no una variante adaptada.
const tmp = mkdtempSync(join(tmpdir(), 'corte-z-'));
const salida = join(tmp, 'corteZPrint.mjs');
await build({
    entryPoints: ['src/utils/corteZPrint.js'],
    outfile: salida,
    bundle: true, format: 'esm', platform: 'node',
    // pdfmake sólo se importa dinámicamente al descargar; acá no se usa y su
    // build de navegador no resuelve en Node.
    external: ['pdfmake/*'],
    logLevel: 'silent',
});
const { construirCorteZDoc } = await import(`file://${salida}`);
rmSync(tmp, { recursive: true, force: true });

// Sin políticas, pdfmake avisa por cada render y el ruido tapa el resultado.
// El documento no trae imágenes ni recursos externos, así que la red se niega
// entera; del disco sólo se permiten las fuentes, que es lo único que lee.
// (Negar TODO el disco parece más prudente y rompe el render: las fuentes son
// archivos locales.)
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(ruta => ruta.includes(join('pdfmake', 'fonts')));

pdfmake.addFonts({
    Roboto: {
        normal:      require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'),
        bold:        require.resolve('pdfmake/fonts/Roboto/Roboto-Medium.ttf'),
        italics:     require.resolve('pdfmake/fonts/Roboto/Roboto-Italic.ttf'),
        bolditalics: require.resolve('pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf'),
    },
});

// Salud 3, julio 2026. Con retención: es el caso más alto que puede darse.
const CON_RETENCION = {
    branch_id: 27, sucursal: 'Salud 3', periodo: '2026-07-01',
    direccion: 'Carr. a Chalatenango, Crio. Totolco, Chalatenango',
    departamento: 'Chalatenango',
    fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31',
    tiquete_total: 0, factura_total: 48525.21, ccf_total: 976.73, total_general: 49501.94,
    z_factura: 48564.53, z_ccf: 980.33, z_total: 49544.86,
    portal_factura: 48564.53, portal_ccf: 980.33, portal_total: 49544.86,
    dif_factura: 0, dif_ccf: 0, dif_total: 0,
    retencion: 42.92, portal_retencion: 42.92, dif_retencion: 0,
    declaracion: {
        factura: { exentas: 0, gravadas: 43011.33, debito: 5592.52, retenido: 39.32, total: 48564.53 },
        ccf:     { exentas: 0, gravadas: 870.74,   debito: 113.19,  retenido: 3.60,  total: 980.33 },
    },
    detalle: { secciones: {
        tiquete: { exentas: 0, gravadas: 0,        no_sujetas: 0, retencion: 0,     total: 0 },
        factura: { exentas: 0, gravadas: 48564.53, no_sujetas: 0, retencion: 39.32, total: 48525.21 },
        ccf:     { exentas: 0, gravadas: 980.33,   no_sujetas: 0, retencion: 3.60,  total: 976.73 },
    } },
};

// La misma sucursal sin retención: no lleva el aviso ni la fila del cotejo, así
// que es la hoja más corta. Se mide igual para que el día que alguien agregue
// algo "sólo cuando NO hay retención" tampoco pase inadvertido.
const SIN_RETENCION = {
    ...CON_RETENCION, sucursal: 'Salud 1', branch_id: 4,
    factura_total: 48261.89, ccf_total: 517.79, total_general: 48779.68,
    z_factura: 48261.89, z_ccf: 517.79, z_total: 48779.68,
    portal_factura: 48261.89, portal_ccf: 517.79, portal_total: 48779.68,
    retencion: 0, portal_retencion: 0, dif_retencion: 0,
    declaracion: {
        factura: { exentas: 0, gravadas: 42709.64, debito: 5552.25, retenido: 0, total: 48261.89 },
        ccf:     { exentas: 0, gravadas: 458.22,   debito: 59.57,   retenido: 0, total: 517.79 },
    },
    detalle: { secciones: {
        tiquete: { exentas: 0, gravadas: 0,        no_sujetas: 0, retencion: 0, total: 0 },
        factura: { exentas: 0, gravadas: 48261.89, no_sujetas: 0, retencion: 0, total: 48261.89 },
        ccf:     { exentas: 0, gravadas: 517.79,   no_sujetas: 0, retencion: 0, total: 517.79 },
    } },
};

async function hojasDe(filas) {
    const doc = construirCorteZDoc(filas);
    // El footer recibe el total de páginas ya resuelto. Se envuelve en vez de
    // reemplazarlo para medir el documento REAL, con su pie y todo.
    const pieOriginal = doc.footer;
    let total = 0;
    doc.footer = (pagina, paginas) => { total = paginas; return pieOriginal(pagina, paginas); };

    const pdf = await pdfmake.createPdf(doc);
    await pdf.getBuffer();
    return total;
}

const casos = [
    ['una sucursal CON retención', [CON_RETENCION], 1],
    ['una sucursal SIN retención', [SIN_RETENCION], 1],
    ['las dos juntas (una por hoja)', [CON_RETENCION, SIN_RETENCION], 2],
];

console.log('\n  PDF del Corte Z — una hoja por sucursal\n');

let fallo = false;
for (const [nombre, filas, esperado] of casos) {
    const hojas = await hojasDe(filas);
    const ok = hojas === esperado;
    if (!ok) fallo = true;
    console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${hojas} hoja(s), esperaba ${esperado}`);
}

if (fallo) {
    console.log('\n  ✗ El PDF se pasó de una hoja por sucursal.');
    console.log('    Es un requisito del usuario, no una preferencia: el archivo se');
    console.log('    presenta y una hoja suelta de puro texto no aporta nada.');
    console.log('    Sacá contenido o apretá los márgenes en `construirCorteZDoc`.\n');
    process.exit(1);
}

console.log('\n  ✓ Una hoja por sucursal.\n');
