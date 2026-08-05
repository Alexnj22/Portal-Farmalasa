// ─── Conteo de Inventario print utility ───────────────────────────────────────
// Mismo patrón pdfmake que pedidoPrint.js (headerRows repetido, footer con
// número de página, downloadPdf) pero autocontenido — pedidoPrint.js trae
// lógica específica de despacho/factor que no aplica a un conteo físico.

import { exportCsv } from './csvExport';

// pdfmake bajo demanda — mismo motivo que en pedidoPrint.js: estático metía
// 809 kB gzip de fuentes embebidas en el chunk de ConteoDetailView, y esta
// vista también exporta CSV (exportAjustesConteo) sin tocar el PDF.
// Lo vigila `npm run gate:bundle` (auditoría 2026-07-30).
let pdfMakePromise = null;
function getPdfMake() {
    if (!pdfMakePromise) {
        pdfMakePromise = Promise.all([
            import('pdfmake/build/pdfmake'),
            import('pdfmake/build/vfs_fonts'),
        ]).then(([mk, fonts]) => {
            const pdfMake = mk.default || mk;
            pdfMake.addVirtualFileSystem(fonts.default || fonts);
            return pdfMake;
        }).catch((err) => {
            pdfMakePromise = null; // reintentar en el próximo click
            throw err;
        });
    }
    return pdfMakePromise;
}

const PAGE_MARGINS = [24, 22, 24, 44];

function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}
function fmtFechaLarga(date) {
    return date.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtMoney(n) {
    if (n === null || n === undefined) return '—';
    return `$${Number(n).toFixed(2)}`;
}
// Las cifras del sistema llegan en NULL cuando el llamador no tiene
// `conteo_ver_sistema` (las RPCs las tapan en origen). `String(null)` imprime la
// palabra "null" en el PDF, que es peor que un guion: parece un dato roto.
function num(n) {
    return n === null || n === undefined ? '—' : String(n);
}
// En un conteo sencillo el lote es NULL en todos los renglones, así que ese
// desempate no desempata nada y dos presentaciones del mismo producto salían en
// el orden en que vinieron — distinto entre la hoja y el reporte. La
// presentación cierra el orden en los dos modos.
function sortItems(items) {
    return [...items].sort((a, b) =>
        (a.laboratorio_nombre || '').localeCompare(b.laboratorio_nombre || '', 'es')
        || (a.product_nombre || '').localeCompare(b.product_nombre || '', 'es')
        || (a.lote || '').localeCompare(b.lote || '', 'es')
        || (a.presentacion || '').localeCompare(b.presentacion || '', 'es')
    );
}

// Un conteo sencillo no lleva lote ni vencimiento: las columnas que los muestran
// no van vacías, no van. Se deriva de la cabecera y no de `item.lote`, porque en
// modo por lote también hay renglones sin etiqueta.
const esSimple = (conteo) => conteo?.modo === 'SIMPLE';

function headerBlock(conteo, subtitle) {
    return {
        margin: [0, 0, 0, 10],
        columns: [
            {
                width: '*',
                stack: [
                    { text: 'CONTEO DE INVENTARIO', fontSize: 13, bold: true, color: '#111' },
                    { text: subtitle, fontSize: 9, color: '#555', margin: [0, 2, 0, 0] },
                ],
            },
            {
                width: 'auto',
                stack: [
                    { text: conteo.branches?.name || 'Sucursal', fontSize: 10, bold: true, alignment: 'right', color: '#111' },
                    { text: `Alcance: ${conteo.scope_type}`, fontSize: 8, alignment: 'right', color: '#666' },
                    // Una hoja sin columna de lote tiene que decir que el conteo
                    // no los lleva; si no, se lee como una hoja a la que le
                    // faltan columnas y alguien las agrega a mano al margen.
                    ...(esSimple(conteo)
                        ? [{ text: 'Detalle: solo cantidades', fontSize: 8, alignment: 'right', color: '#666' }]
                        : []),
                    { text: fmtFechaLarga(new Date(conteo.created_at)), fontSize: 8, alignment: 'right', color: '#666' },
                ],
            },
        ],
    };
}

function productCell(item) {
    const stack = [{ text: item.product_nombre || `Producto ${item.erp_product_id}`, fontSize: 8.5 }];
    if (item.es_antibiotico) {
        stack.push({
            columns: [{
                width: 'auto',
                table: { body: [[{ text: 'BAJO RECETA', fontSize: 5.5, bold: true, color: '#92400e', margin: [3, 1.5, 3, 1.5] }]] },
                layout: { fillColor: () => '#fde68a', hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
            }],
            margin: [0, 2, 0, 0],
        });
    }
    return { stack, margin: [0, 2, 0, 2] };
}

// ── Hoja de conteo en blanco ────────────────────────────────────────────────
// Dos anatomías, no una con un hueco. En conteo ciego la columna Sistema NO
// EXISTE: antes se imprimía igual con el rótulo y las celdas en blanco, o sea
// una columna vacía en el papel que además invita a preguntar qué debería ir
// ahí (y a que alguien lo rellene a mano desde otra pantalla). El ancho que
// libera se reparte entre Producto y Nota, que es donde se escribe.
//
// Mismo criterio para el conteo sencillo: sin Lote ni Vence son dos columnas
// menos, no dos columnas en blanco. Lo que identifica el renglón pasa a ser la
// presentación, y el ancho liberado va a Producto y Nota.
const HOJA_COLS = {
    lote: {
        normal: {
            widths: ['26%', '18%', '11%', '11%', '10%', '24%'],
            labels: ['Producto', 'Lote', 'Vence', 'Sistema', 'Físico', 'Nota'],
        },
        ciego: {
            widths: ['31%', '18%', '11%', '12%', '28%'],
            labels: ['Producto', 'Lote', 'Vence', 'Físico', 'Nota'],
        },
    },
    simple: {
        normal: {
            widths: ['34%', '18%', '12%', '11%', '25%'],
            labels: ['Producto', 'Presentación', 'Sistema', 'Físico', 'Nota'],
        },
        ciego: {
            widths: ['38%', '20%', '13%', '29%'],
            labels: ['Producto', 'Presentación', 'Físico', 'Nota'],
        },
    },
};

// El ERP separa el stock vencido en su propia área: dos filas del mismo
// producto/lote/fecha que en papel se veían idénticas y nadie sabía cuál era
// cuál. La etiqueta va pegada al lote, que es la columna que se lee al buscar.
function loteCell(item) {
    const marca = item.is_vencidos ? ' · ÁREA VENCIDOS' : '';
    return `${item.lote || '—'}${marca}`;
}

// El equivalente en un conteo sencillo. La marca de área vencidos sigue haciendo
// falta por la misma razón: son dos renglones del mismo producto y presentación
// que en papel se verían idénticos.
function presentacionCell(item) {
    const marca = item.is_vencidos ? ' · ÁREA VENCIDOS' : '';
    const detalle = item.detalle ? ` (${item.detalle})` : '';
    return `${item.presentacion || '—'}${detalle}${marca}`;
}

function buildHojaTable(conteo, items, ciego) {
    const simple = esSimple(conteo);
    const { widths, labels } = HOJA_COLS[simple ? 'simple' : 'lote'][ciego ? 'ciego' : 'normal'];

    const headerRow = labels.map((label) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: ['Vence', 'Sistema', 'Físico'].includes(label) ? 'center' : 'left',
        margin: [4, 3, 4, 3],
    }));

    const body = sortItems(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        return [
            { ...productCell(item), fillColor: bg },
            // La celda que identifica el renglón: presentación en sencillo, lote
            // (con su marca de área) en el modo por lote.
            ...(simple
                ? [{ text: presentacionCell(item), fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] }]
                : [
                    { text: loteCell(item), fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
                    { text: fmtFecha(item.fecha_vencimiento), fontSize: 7.5, color: '#333', fillColor: bg, alignment: 'center', margin: [4, 3, 4, 3] },
                ]),
            // Sistema: la columna solo se emite si el dato vino. `num()` es la
            // red de seguridad — un `String(null)` imprime la palabra "null".
            ...(ciego ? [] : [{ text: num(item.sistema_cantidad), fontSize: 8.5, bold: true, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] }]),
            { text: '', fillColor: bg, margin: [4, 3, 4, 3] },   // Físico: se llena a mano
            { text: '', fillColor: bg, margin: [4, 3, 4, 3] },   // Nota: idem
        ];
    });

    return {
        table: { headerRows: 1, dontBreakRows: true, widths, body: [headerRow, ...body] },
        layout: {
            hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 ? 1.2 : i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor: () => '#ccc', vLineColor: () => '#ccc',
            paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 0, paddingBottom: () => 0,
        },
    };
}

function footerFirmas(labelIzq, labelDer) {
    return (currentPage, pageCount) => ({
        margin: [PAGE_MARGINS[0], 6, PAGE_MARGINS[2], 0],
        columns: [
            { text: `${labelIzq}: ________________________`, fontSize: 6.5, color: '#555' },
            { text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: '#555', alignment: 'center' },
            { text: `${labelDer}: ________________________`, fontSize: 6.5, color: '#555', alignment: 'right' },
        ],
    });
}

async function downloadPdf(docDefinition, filename) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(docDefinition).download(filename);
}

// items: filas de get_conteo_items_jsonb. ciego=true oculta la columna Sistema.
export async function printHojaConteo(conteo, items, { ciego = false } = {}) {
    const docDefinition = {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title: `Hoja de Conteo — ${conteo.branches?.name || ''}` },
        defaultStyle: { fontSize: 9 },
        content: [
            headerBlock(conteo, `Hoja de conteo${ciego ? ' (ciego)' : ''} — ${items.length} línea(s)`),
            buildHojaTable(conteo, items, ciego),
        ],
        footer: footerFirmas('Contado por', 'Sucursal'),
    };
    await downloadPdf(docDefinition, `Conteo_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}_Hoja.pdf`);
}

// ── Reporte de resultados ────────────────────────────────────────────────────
const RES_COL_WIDTHS = ['24%', '15%', '9%', '9%', '9%', '9%', '25%'];
const RES_LABELS = ['Producto', 'Lote', 'Sistema', 'Físico', 'Dif.', 'Valor', 'Nota'];
// Mismas columnas y mismos anchos: lo único que cambia es qué identifica el
// renglón, así que solo cambia el rótulo de la segunda.
const RES_LABELS_SIMPLE = ['Producto', 'Presentación', 'Sistema', 'Físico', 'Dif.', 'Valor', 'Nota'];

function buildResultadosTable(items, simple = false) {
    const headerRow = (simple ? RES_LABELS_SIMPLE : RES_LABELS).map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: (i >= 2 && i <= 5) ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortItems(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        const dif = item.diferencia;
        const valor = dif != null && item.costo_unitario != null ? dif * item.costo_unitario : null;
        const difColor = dif == null ? '#999' : dif === 0 ? '#059669' : dif < 0 ? '#dc2626' : '#2563eb';
        const fisicoTxt = item.fisico_cantidad != null
            ? (item.estado_item === 'SIN_UBICAR' ? '0 (no ubic.)' : String(item.fisico_cantidad))
            : '—';
        return [
            { ...productCell(item), fillColor: bg },
            { text: simple ? presentacionCell(item) : loteCell(item), fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: num(item.sistema_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: fisicoTxt, fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: dif != null ? (dif > 0 ? `+${dif}` : String(dif)) : '—', fontSize: 8.5, bold: true, color: difColor, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: valor != null ? fmtMoney(valor) : '—', fontSize: 7.5, color: difColor, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.nota || '', fontSize: 7, color: '#555', fillColor: bg, margin: [4, 3, 4, 3] },
        ];
    });

    return {
        table: { headerRows: 1, dontBreakRows: true, widths: RES_COL_WIDTHS, body: [headerRow, ...body] },
        layout: {
            hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 ? 1.2 : i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor: () => '#ccc', vLineColor: () => '#ccc',
            paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 0, paddingBottom: () => 0,
        },
    };
}

function buildTotalesBlock(conteo, items) {
    const conDiferencia = items.filter((i) => i.diferencia != null && i.diferencia !== 0).length;
    const sinContar = items.filter((i) => i.estado_item === 'PENDIENTE').length;
    const noUbicados = items.filter((i) => i.estado_item === 'SIN_UBICAR').length;
    return {
        margin: [0, 10, 0, 0],
        table: {
            widths: ['*', '*', '*', '*', '*', '*'],
            body: [[
                { text: `${items.length} ítems`, fontSize: 8, bold: true, fillColor: '#f0f0f0', margin: [6, 4, 6, 4] },
                { text: `${conDiferencia} con diferencia`, fontSize: 8, bold: true, fillColor: '#f0f0f0', margin: [6, 4, 6, 4] },
                { text: `${noUbicados} no ubicados`, fontSize: 8, bold: true, color: '#92400e', fillColor: '#fffbeb', margin: [6, 4, 6, 4] },
                { text: `${sinContar} sin contar`, fontSize: 8, bold: true, color: '#92400e', fillColor: '#fffbeb', margin: [6, 4, 6, 4] },
                { text: `Faltante: ${fmtMoney(conteo.valor_faltante)}`, fontSize: 8, bold: true, color: '#dc2626', fillColor: '#fef2f2', margin: [6, 4, 6, 4] },
                { text: `Sobrante: ${fmtMoney(conteo.valor_sobrante)}`, fontSize: 8, bold: true, color: '#2563eb', fillColor: '#eff6ff', margin: [6, 4, 6, 4] },
            ]],
        },
        layout: 'noBorders',
    };
}

// Un reporte que muestra $ de faltante calculados sobre un conteo parcial tiene
// que decirlo en la misma hoja. Si no, el número se lee como un cuadre completo.
function avisoParcialBlock(conteo) {
    if (!conteo.total_pendientes) return null;
    const texto = conteo.pendientes_como_cero
        ? `Al cerrar, ${conteo.total_pendientes} renglón(es) sin contar se dieron por no ubicados (físico 0). Su faltante está incluido en los montos.`
        : `CONTEO PARCIAL: ${conteo.total_pendientes} renglón(es) quedaron sin contar y NO están valuados. Estos montos no son un cuadre completo.`;
    return {
        margin: [0, 8, 0, 0],
        table: {
            widths: ['*'],
            body: [[{
                text: texto, fontSize: 8, bold: true,
                color: conteo.pendientes_como_cero ? '#92400e' : '#dc2626',
                fillColor: conteo.pendientes_como_cero ? '#fffbeb' : '#fef2f2',
                margin: [8, 5, 8, 5],
            }]],
        },
        layout: 'noBorders',
    };
}

// ── Hoja de ajustes para el ERP ─────────────────────────────────────────────
// El portal NO escribe stock: mientras no sea el sistema completo, el ajuste se
// teclea en el ERP. Esta hoja es ese insumo, y por eso está partida en dos:
// faltantes y sobrantes son transacciones distintas en un ERP (salida vs
// entrada), y mezclarlas obliga a separarlas a mano al momento de digitar.

const AJU_COL_WIDTHS = ['8%', '25%', '11%', '14%', '8%', '7%', '7%', '8%', '12%'];
const AJU_LABELS = ['Código', 'Producto', 'Presentación', 'Lote', 'Vence', 'Sistema', 'Físico', 'Ajuste', 'Valor'];
// Sin Lote ni Vence quedan siete columnas: el 22% que liberan va a Producto y
// Presentación, que son las que se leen para ubicar el renglón al digitarlo.
const AJU_COL_WIDTHS_SIMPLE = ['9%', '34%', '20%', '9%', '9%', '9%', '10%'];
const AJU_LABELS_SIMPLE = ['Código', 'Producto', 'Presentación', 'Sistema', 'Físico', 'Ajuste', 'Valor'];

const esAjuste = (i) => i.diferencia != null && i.diferencia !== 0;
const valorAjuste = (i) => (i.costo_unitario != null ? i.diferencia * Number(i.costo_unitario) : null);

// Orden por código: es como se teclea en el ERP, un renglón tras otro, sin
// tener que buscar el producto por nombre en cada línea.
function sortParaDigitar(items) {
    return [...items].sort((a, b) =>
        (a.erp_product_id ?? 0) - (b.erp_product_id ?? 0)
        || (a.lote || '').localeCompare(b.lote || '', 'es')
        || (a.presentacion || '').localeCompare(b.presentacion || '', 'es'));
}

function loteAjusteCell(item) {
    const marcas = [];
    if (item.is_vencidos) marcas.push('ÁREA VENCIDOS');
    // sistema 0 y sobrante: en el ERP esto no es ajustar una cantidad, es dar
    // de alta un lote que no existe. Es otro trámite y hay que verlo distinto.
    if (item.es_agregado_manual) marcas.push('ALTA DE LOTE');
    return `${item.lote || '—'}${marcas.length ? ` · ${marcas.join(' · ')}` : ''}`;
}

// Las mismas marcas, colgadas de la presentación — en un conteo sencillo no hay
// lote del que colgarlas. "ALTA" y no "ALTA DE LOTE": lo que no existía es el
// producto en esa presentación, no un lote.
function marcasAjusteSimple(item) {
    const marcas = [];
    if (item.is_vencidos) marcas.push('ÁREA VENCIDOS');
    if (item.es_agregado_manual) marcas.push('ALTA');
    return `${item.presentacion || '—'}${marcas.length ? ` · ${marcas.join(' · ')}` : ''}`;
}

function buildAjusteSection(titulo, color, fill, items, simple = false) {
    if (!items.length) return null;
    const totalQty = items.reduce((s, i) => s + i.diferencia, 0);
    const totalVal = items.reduce((s, i) => s + (valorAjuste(i) || 0), 0);

    // El corte del centrado es el índice de la primera columna numérica, y esa
    // posición se corre dos lugares al desaparecer Lote y Vence.
    const primeraNumerica = simple ? 3 : 5;
    const headerRow = (simple ? AJU_LABELS_SIMPLE : AJU_LABELS).map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: i >= primeraNumerica ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortParaDigitar(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        const val = valorAjuste(item);
        return [
            { text: String(item.erp_product_id ?? '—'), fontSize: 8, bold: true, fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.product_nombre || '—', fontSize: 7.5, fillColor: bg, margin: [4, 3, 4, 3] },
            // En sencillo la presentación absorbe las marcas que en el otro modo
            // viajan pegadas al lote (área vencidos, alta a mano): sin ellas dos
            // renglones distintos se digitarían como el mismo.
            { text: simple ? marcasAjusteSimple(item) : (item.presentacion || '—'), fontSize: 7, color: '#555', fillColor: bg, margin: [4, 3, 4, 3] },
            ...(simple ? [] : [
                { text: loteAjusteCell(item), fontSize: 7, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
                { text: fmtFecha(item.fecha_vencimiento), fontSize: 7, color: '#555', fillColor: bg, alignment: 'center', margin: [4, 3, 4, 3] },
            ]),
            { text: num(item.sistema_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: num(item.fisico_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.diferencia > 0 ? `+${item.diferencia}` : String(item.diferencia), fontSize: 9, bold: true, color, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: val != null ? fmtMoney(val) : '—', fontSize: 7.5, color, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
        ];
    });

    return [
        {
            text: `${titulo} — ${items.length} línea(s)`,
            fontSize: 9.5, bold: true, color, margin: [0, 12, 0, 4],
        },
        {
            table: { headerRows: 1, dontBreakRows: true, widths: simple ? AJU_COL_WIDTHS_SIMPLE : AJU_COL_WIDTHS, body: [headerRow, ...body] },
            layout: {
                hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 ? 1.2 : i === node.table.body.length ? 0.8 : 0.5),
                vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
                hLineColor: () => '#ccc', vLineColor: () => '#ccc',
                paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 0, paddingBottom: () => 0,
            },
        },
        {
            margin: [0, 4, 0, 0],
            table: {
                widths: ['*', 'auto', 'auto'],
                body: [[
                    { text: '', border: [false, false, false, false] },
                    { text: `Total unidades: ${totalQty > 0 ? `+${totalQty}` : totalQty}`, fontSize: 8, bold: true, color, fillColor: fill, margin: [6, 4, 6, 4] },
                    { text: `Total valor: ${fmtMoney(totalVal)}`, fontSize: 8, bold: true, color, fillColor: fill, margin: [6, 4, 6, 4] },
                ]],
            },
            layout: 'noBorders',
        },
    ];
}

function ajusteHeaderBlock(conteo, faltantes, sobrantes) {
    const lineas = [
        { text: 'AJUSTE DE INVENTARIO', fontSize: 13, bold: true, color: '#111' },
        { text: 'Documento para aplicar en el sistema — el portal no modifica existencias', fontSize: 8, color: '#555', margin: [0, 2, 0, 0] },
    ];
    return {
        margin: [0, 0, 0, 6],
        columns: [
            { width: '*', stack: lineas },
            {
                width: 'auto',
                stack: [
                    { text: conteo.branches?.name || 'Sucursal', fontSize: 10, bold: true, alignment: 'right', color: '#111' },
                    { text: `Conteo del ${fmtFechaLarga(new Date(conteo.created_at))} · Alcance: ${conteo.scope_type}`, fontSize: 8, alignment: 'right', color: '#666' },
                    { text: `${faltantes.length} faltante(s) · ${sobrantes.length} sobrante(s)`, fontSize: 8, alignment: 'right', color: '#666' },
                    { text: `Ref. conteo: ${String(conteo.id).slice(0, 8).toUpperCase()}`, fontSize: 7.5, alignment: 'right', color: '#999' },
                ],
            },
        ],
    };
}

export async function printAjustesConteo(conteo, items) {
    const ajustes = items.filter(esAjuste);
    const faltantes = ajustes.filter((i) => i.diferencia < 0);
    const sobrantes = ajustes.filter((i) => i.diferencia > 0);

    const content = [ajusteHeaderBlock(conteo, faltantes, sobrantes)];

    const aviso = avisoParcialBlock(conteo);
    if (aviso) content.push(aviso);

    if (!ajustes.length) {
        content.push({
            margin: [0, 16, 0, 0],
            text: 'Este conteo no arrojó diferencias: no hay ajuste que aplicar.',
            fontSize: 10, bold: true, color: '#059669',
        });
    } else {
        const secFalt = buildAjusteSection('FALTANTES — ajuste de SALIDA', '#dc2626', '#fef2f2', faltantes, esSimple(conteo));
        const secSobr = buildAjusteSection('SOBRANTES — ajuste de ENTRADA', '#2563eb', '#eff6ff', sobrantes, esSimple(conteo));
        if (secFalt) content.push(...secFalt);
        if (secSobr) content.push(...secSobr);
    }

    const docDefinition = {
        pageSize: 'LETTER',
        // Nueve columnas de digitación no entran legibles en vertical.
        pageOrientation: 'landscape',
        pageMargins: PAGE_MARGINS,
        info: { title: `Ajuste de Inventario — ${conteo.branches?.name || ''}` },
        defaultStyle: { fontSize: 9 },
        content,
        footer: footerFirmas('Aplicado por', 'Fecha de aplicación'),
    };
    await downloadPdf(docDefinition, `Ajuste_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

// Mismo contenido en CSV: para filtrar, ordenar o cargar en lote si el ERP lo
// admite, sin volver a teclear lo que ya está medido.
export function exportAjustesConteo(conteo, items) {
    const simple = esSimple(conteo);
    const ajustes = sortParaDigitar(items.filter(esAjuste));
    // Dos columnas menos en sencillo, no dos columnas de celdas vacías: quien
    // abre la planilla filtra por lo que hay, y una columna «Lote» entera en
    // blanco se lee como un dato que se perdió, no como uno que no existe.
    const headers = [
        'Tipo', 'ID INTERNO', 'Codigo barras', 'Producto', 'Laboratorio', 'Presentacion',
        ...(simple ? [] : ['Lote', 'Vence']),
        'Area', simple ? 'Alta a mano' : 'Alta de lote', 'Sistema', 'Fisico', 'Ajuste',
        'Costo unitario', 'Valor ajuste', 'Nota',
    ];
    const rows = ajustes.map((i) => [
        i.diferencia < 0 ? 'FALTANTE' : 'SOBRANTE',
        i.erp_product_id ?? '',
        i.codigo_barras ?? '',
        i.product_nombre ?? '',
        i.laboratorio_nombre ?? '',
        i.presentacion ?? '',
        ...(simple ? [] : [i.lote ?? '', i.fecha_vencimiento ?? '']),
        i.is_vencidos ? 'VENCIDOS' : 'NORMAL',
        i.es_agregado_manual ? 'SI' : 'NO',
        i.sistema_cantidad,
        i.fisico_cantidad,
        i.diferencia,
        i.costo_unitario ?? '',
        valorAjuste(i) != null ? valorAjuste(i).toFixed(2) : '',
        i.nota ?? '',
    ]);
    const suc = (conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_');
    exportCsv(headers, rows, `Ajuste_${suc}_${String(conteo.id).slice(0, 8)}.csv`);
}

// items: filas de get_conteo_items_jsonb. soloDiferencias filtra antes de imprimir.
export async function printResultadosConteo(conteo, items, { soloDiferencias = false } = {}) {
    const filtered = soloDiferencias ? items.filter((i) => i.diferencia != null && i.diferencia !== 0) : items;
    const docDefinition = {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title: `Resultados de Conteo — ${conteo.branches?.name || ''}` },
        defaultStyle: { fontSize: 9 },
        content: [
            headerBlock(conteo, `Reporte de resultados${soloDiferencias ? ' (solo diferencias)' : ''}`),
            buildResultadosTable(filtered, esSimple(conteo)),
            buildTotalesBlock(conteo, items),
            avisoParcialBlock(conteo),
        ].filter(Boolean),
        footer: footerFirmas('Contado por', 'Revisado por'),
    };
    await downloadPdf(docDefinition, `Conteo_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}_Resultados.pdf`);
}
