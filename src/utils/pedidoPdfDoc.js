// ─── El papel del pedido, sin la imprenta ─────────────────────────────────────
// La DEFINICIÓN del PDF del pedido (pdfmake) y la preparación de las hojas
// exactas, en JavaScript puro: sin pdfmake, sin red y sin el navegador. La usan
// dos imprentas que tienen que dar el MISMO papel:
//   · el portal (`pedidoPrint.js`), que corre pdfmake en el navegador;
//   · el teléfono (`apps/mobile/motor/entrada.js`), que corre ESTE mismo código
//     y el mismo pdfmake dentro de un WebView oculto (`scripts/motor-pedido.mjs`
//     lo empaqueta).
// Vivía dentro de `pedidoPrint.js`. Se separó el 2026-10-12 para que el teléfono
// pudiera FINALIZAR un pedido: las hojas salen del maquetado exacto del PDF, y
// un maquetador distinto corta en otros renglones — las cajas quedarían con
// productos ajenos.
import { ERP_NAMES, SUCURSALES } from '../constants/erp';
import { hora12Papel } from './hora';
import { fechaTexto } from './fecha';
import { fefoProject } from './codigoDePedido';
import { esAdicional, lotesAsignadosToDispatch, toDispatch } from './papelDePedido';

// Los nombres, el orden y los códigos de sala viven en `constants/erp.js`, que
// es el espejo del registro (`erp_sucursal_map`). Este módulo tenía sus propias
// copias —idénticas, carácter por carácter— hasta el 2026-08-12; se descubrió al
// definir la clave del traslado, cuando se estaba por inventar un cuarto código
// de sala sin saber que la hoja de despacho ya imprimía el suyo.
export const ERP_NAMES_DEFAULT = ERP_NAMES;
const SUCURSALES_ORDER  = SUCURSALES;
const CUSTOM_LABELS    = ['CAJA', 'ESTUCHE', 'BOLSA'];

// Va a "Cajas Adicionales" solo si dispatch_label='CAJA' (Electrolit) o caja_especial. ESTUCHE/BOLSA van en tabla normal.
export const isAdicional = esAdicional;

// Nombre de farmacia según destino
function getFarmaciaName(sucId) {
    if (sucId === 5) return 'FARMACIA LA POPULAR';
    if (sucId === 6) return 'BODEGA FARMALASA';
    return 'FARMACIA LA SALUD';
}

// Margen inferior 44pt — espacio para el footer original (Revisado/Recibido).
// En la última página se agrega el bloque de firmas compacto arriba del footer.
export const PAGE_MARGINS  = [24, 22, 24, 44];
const CONTENT_WIDTH = 612 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

// ── Helpers ───────────────────────────────────────────────────────────────────

// `fecha_vencimiento` es una fecha SIN hora ('2027-11-01'). `new Date()` la lee
// como UTC y `toLocaleDateString` la pinta en hora local: en El Salvador (UTC−6)
// toda fecha del día 1 retrocedía un mes, o sea que un lote que vence en
// noviembre se imprimía «oct 27». Y no era un borde raro — medido el 2026-08-18,
// 9,774 de las 9,959 existencias con vencimiento son día 01: el desfase era la
// regla. Se le pasa el DÍA como texto a `fechaTexto`, que no lo convierte de
// huso: armarlo con `new Date(y, m, 1)` lo dejaba a medianoche del APARATO, y
// en uno que no estuviera en hora de El Salvador (el de CI corre en UTC)
// volvía a imprimir «oct» por noviembre.
export function fmtVence(iso) {
    if (!iso) return null;
    const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m) return null;
    return fechaTexto(`${y}-${String(m).padStart(2, '0')}-01`, { month: 'short', year: '2-digit' });
}
// El día del calendario de El Salvador, no el del aparato que imprime: el
// teléfono o una computadora con otra zona ponían otro día en el papel.
function fmtFechaLarga(date) {
    return fechaTexto(date, { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtFechaHora(date) {
    return `${fmtFechaLarga(date)}, ${hora12Papel(date)}`;
}
export function dateSuffix() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getFullYear()).slice(-2)}`;
}
export function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (a.laboratorio || '').localeCompare(b.laboratorio || '', 'es')
        || (a.product_name || '').localeCompare(b.product_name || '', 'es')
    );
}

// ── Tabla por sucursal ────────────────────────────────────────────────────────
const COL_WIDTHS    = ['16%', '31%', '13%', '9%', '25%', '6%'];
const HEADER_LABELS = ['Laboratorio', 'Producto', 'Presentación', 'Cant.', 'Lote', 'OK'];

function loteCellNode(lot, bg) {
    if (!lot) return { text: '—', fontSize: 8, color: '#999', fillColor: bg, margin: [0, 2, 0, 2] };
    const count = lot.take ?? lot.cantidad ?? lot.packs ?? '?';
    const vence = fmtVence(lot.fecha_vencimiento);
    const parts = [];
    if (lot.lote) parts.push({ text: lot.lote, color: '#222' });
    if (vence)    parts.push({ text: vence,    color: '#888' });
    parts.push({ text: `${count}`,             color: '#444' });
    const joined = [];
    parts.forEach((p, i) => { if (i > 0) joined.push({ text: '  ·  ', color: '#999' }); joined.push(p); });
    return { text: joined, fontSize: 7.5, fillColor: bg, margin: [0, 2, 0, 2] };
}
function loteStackNode(lotes, bg) {
    if (!lotes.length) return { text: '', fillColor: bg, verticalAlignment: 'middle' };
    const lines = lotes.map(lot => loteCellNode(lot, bg));
    lines.forEach((l, i) => { l.margin = [0, i === 0 ? 2 : 1, 0, i === lines.length - 1 ? 2 : 1]; });
    return { stack: lines, fillColor: bg, verticalAlignment: 'middle' };
}

// withRowIds: si true, añade id='row_N' a la celda de laboratorio de cada fila.
// pdfmake preserva ese id en linearNodeList → pageBreakBefore puede leerlo
// para saber qué fila (N) aparece primero en cada página.
function buildProductRows(rows, withRowIds = false) {
    const body = [];
    sortRows(rows).forEach((r, idx) => {
        const bg  = idx % 2 === 1 ? '#f2f2f2' : '#ffffff';
        const lts = r.lotes?.length ? r.lotes : [];
        const productStack = [{ text: r.product_name || '', fontSize: 8.5 }];
        if (r.es_antibiotico) {
            productStack.push({
                columns: [{
                    width: 'auto',
                    table: { body: [[{ text: 'BAJO RECETA', fontSize: 5.5, bold: true, color: '#92400e', margin: [3, 1.5, 3, 1.5] }]] },
                    layout: { fillColor: () => '#fde68a', hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
                }],
                margin: [0, 2, 0, 0],
            });
        }
        const labCell = { text: r.laboratorio || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' };
        if (withRowIds) labCell.id = `row_${idx}`;
        body.push([
            labCell,
            { stack: productStack, fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            { text: r.presentacion_tipo || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            r.qty_base
                ? { stack: [{ text: String(r.qty), fontSize: 9.5, bold: true, alignment: 'center' }, { text: `(${r.qty_base} und.)`, fontSize: 6, color: '#666', alignment: 'center', margin: [0, 1, 0, 0] }], fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' }
                : { text: String(r.qty), fillColor: bg, fontSize: 9.5, bold: true, alignment: 'center', margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            loteStackNode(lts, bg),
            { fillColor: bg, alignment: 'center', margin: [0, 0, 0, 0], verticalAlignment: 'middle',
              canvas: [{ type: 'rect', x: 0, y: 0, w: 8, h: 8, lineWidth: 1, lineColor: '#555' }] },
        ]);
    });
    return body;
}

// Encabezado B&W compacto — 3 filas (headerRows:3) que repiten en cada página.
// Fila 1: [logo] FARMACIA LA SALUD   ORDEN DE DESPACHO   Código / Fecha
// Fila 2: Origen: Bodega, dirección  →  Destino: Sucursal, dirección
// Fila 3: Columnas de tabla
function buildSectionTable(sec, fecha, logo, addrMap) {
    const farmaciaName = getFarmaciaName(sec.sucId);
    const bodegaAddr   = addrMap?.[6] ?? '';
    const sucAddr      = addrMap?.[sec.sucId] ?? '';

    const logoCell = logo
        ? { image: logo, width: 22, height: 22, margin: [0, 0, 16, 0] }
        : { text: '', width: 0 };

    // Fila 1 — Logo+Farmacia | ORDEN DE DESPACHO | Código/Fecha — todo en UNA línea, sin fila separada para el título
    const titleRow = [
        {
            colSpan: 6, fillColor: '#eeeeee', margin: [6, 3, 6, 3],
            columns: [
                {
                    columns: [
                        logoCell,
                        { text: farmaciaName, fontSize: 9, bold: true, color: '#111', margin: [0, 5, 0, 0] },
                    ],
                    width: '36%',
                },
                {
                    text: 'ORDEN DE DESPACHO',
                    fontSize: 9, bold: true, color: '#222', alignment: 'center', margin: [0, 5, 0, 0],
                    width: '*',
                },
                {
                    width: '26%',
                    stack: [
                        { text: sec.codigo ?? '', fontSize: 7.5, bold: true, color: '#111', alignment: 'right' },
                        { text: fecha, fontSize: 6.5, color: '#666', alignment: 'right', margin: [0, 1, 0, 0] },
                    ],
                },
            ],
        },
        {}, {}, {}, {}, {},
    ];

    // Fila 2 — origen → destino en UNA sola línea + Caja más grande a la derecha
    // La sala va en negrita para que se lea de un vistazo. Letra 8 (antes 6) y
    // margen 5.5/5.4 (antes 9/9) para que la fila NO crezca: un punto de más
    // puede correr la última fila a la hoja siguiente. Medido: la tabla arranca
    // en 78.06pt con cualquier sala; antes, 78.1 (dirección corta) u 80.5
    // (Salud 5, la más larga).
    const lugar = (rotulo, sala, addr) => [
        `${rotulo}: `,
        { text: sala, bold: true, color: '#111' },
        addr ? ` · ${addr}` : '',
    ];
    const subtitleRow = [
        {
            colSpan: 6, fillColor: '#ffffff', margin: [6, 5.5, 6, 5.4],
            columns: [
                { text: lugar('Origen', 'Bodega', bodegaAddr),       fontSize: 8, color: '#555', width: '36%' },
                { text: lugar('Destino', sec.nombre ?? '', sucAddr), fontSize: 8, color: '#555', width: '38%', alignment: 'center' },
                {
                    width: '26%',
                    text: [
                        { text: 'Caja: ', fontSize: 10, bold: true, color: '#222' },
                        { text: '_______________________', fontSize: 10, color: '#444' },
                    ],
                    alignment: 'right',
                },
            ],
        },
        {}, {}, {}, {}, {},
    ];

    const headerRow = HEADER_LABELS.map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 6.5, color: '#000',
        alignment: (i === 3 || i === 5) ? 'center' : 'left',
        margin: [0, 2, 0, 2],
    }));

    const bodyRows = sec.rows.length
        ? buildProductRows(sec.rows, sec._withRowIds ?? false)
        : [[
            { text: 'Sin productos para esta sucursal', colSpan: 6, alignment: 'center', fontSize: 9, color: '#555', margin: [0, 10, 0, 10] },
            {}, {}, {}, {}, {},
        ]];

    return {
        table: { headerRows: 3, dontBreakRows: true, widths: COL_WIDTHS, body: [titleRow, subtitleRow, headerRow, ...bodyRows] },
        layout: {
            hLineWidth:  (i, node) => (i === 0 ? 0 : i === 3 ? 1.5 : i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth:  (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor:  (i) => (i === 3 ? '#999' : i === 1 ? '#ccc' : '#e0e0e0'),
            vLineColor:  () => '#ccc',
            paddingLeft:  () => 5,
            paddingRight: () => 5,
            paddingTop:   () => 0,
            paddingBottom: () => 0,
        },
    };
}

function buildSectionFooter(sec) {
    const parts = [];
    if (sec.agotamientoCount > 0) parts.push(`Stock insuficiente en Bodega: ${sec.agotamientoCount} producto(s)`);
    if (sec.sinCount > 0) parts.push(`Sin stock en Bodega: ${sec.sinCount} producto(s)`);
    if (sec.revCount  > 0) parts.push(`Sin asignación (revisar): ${sec.revCount}`);
    if (!parts.length) return null;
    return {
        margin: [0, 0, 0, 6],
        table: { widths: ['*'], body: [[
            { text: parts.join('     ·     '), fontSize: 7.5, color: '#000', fillColor: '#ebebeb', margin: [8, 4, 8, 4] },
        ]] },
        layout: 'noBorders',
    };
}

// Footer callback: "Revisado por / N/M / Recibido por" en todas las páginas con márgenes uniformes.
function buildFooterCallback() {
    return (currentPage, pageCount) => ({
        margin: [PAGE_MARGINS[0], 6, PAGE_MARGINS[2], 0],
        columns: [
            { text: 'Revisado por: ________________________', fontSize: 6.5, color: '#555' },
            { text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: '#555', alignment: 'center' },
            { text: 'Recibido por: ________________________', fontSize: 6.5, color: '#555', alignment: 'right' },
        ],
    });
}

function buildEspecialesBlock(especiales) {
    if (!especiales?.length) return null;

    // Agrupar por producto: una fila por producto con rango E1–E5 y lotes sumados
    const groups = [];
    const groupMap = new Map();
    especiales.forEach(e => {
        const key = e.product_name ?? '?';
        if (!groupMap.has(key)) {
            const g = { product_name: key, presentacion_tipo: e.presentacion_tipo, labels: [], lotsAgg: new Map(), dispF: e.dispF ?? 1, tiene_dispatch_label: e.tiene_dispatch_label === true };
            groupMap.set(key, g);
            groups.push(g);
        }
        const g = groupMap.get(key);
        g.labels.push(e.label ?? '');
        const lot = e.lotes?.[0];
        if (lot) {
            const lotKey = lot.lote ?? '__nolote__';
            const prev = g.lotsAgg.get(lotKey);
            if (prev) prev.take = (prev.take ?? 0) + 1;
            else g.lotsAgg.set(lotKey, { lote: lot.lote, fecha_vencimiento: lot.fecha_vencimiento, take: 1 });
        }
    });

    // Mismo formato exacto que la tabla principal — solo "Caja" reemplaza "Laboratorio"
    const titleRow = [
        { text: 'CAJAS ADICIONALES', colSpan: 6, fillColor: '#e8e8e8', bold: true, fontSize: 7, color: '#444444', margin: [4, 3, 4, 3], alignment: 'center' },
        {}, {}, {}, {}, {},
    ];
    const headerRow = ['Caja', 'Producto', 'Presentación', 'Cant.', 'Lote', 'OK'].map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 6.5, color: '#333333',
        alignment: (i === 3 || i === 5) ? 'center' : 'left',
        margin: [0, 2, 0, 2],
    }));

    const bodyRows = groups.map((g, idx) => {
        const bg    = idx % 2 === 1 ? '#f2f2f2' : '#ffffff';
        const qty   = g.labels.length;
        const range = qty === 1 ? g.labels[0] : `${g.labels[0]}–${g.labels[qty - 1]}`;
        return [
            { text: range, fontSize: 7.5, bold: true, color: '#555555', fillColor: bg, alignment: 'center', margin: [2, 2, 2, 2], verticalAlignment: 'middle' },
            { text: g.product_name, fontSize: 8.5, fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            { text: g.presentacion_tipo || '—', fontSize: 7, color: '#333', fillColor: bg, margin: [0, 2, 3, 2], verticalAlignment: 'middle' },
            g.tiene_dispatch_label
                ? { stack: [{ text: String(qty), fontSize: 9.5, bold: true, alignment: 'center' }, { text: `(${qty * g.dispF} und.)`, fontSize: 6, color: '#666', alignment: 'center', margin: [0, 1, 0, 0] }], fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' }
                : { text: String(qty), fontSize: 9.5, bold: true, alignment: 'center', fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            loteStackNode([...g.lotsAgg.values()], bg),
            { fillColor: bg, alignment: 'center', margin: [0, 0, 0, 0], verticalAlignment: 'middle', canvas: [{ type: 'rect', x: 0, y: 0, w: 8, h: 8, lineWidth: 1, lineColor: '#555' }] },
        ];
    });

    return {
        margin: [0, 6, 0, 0],
        table: { widths: COL_WIDTHS, body: [titleRow, headerRow, ...bodyRows] },
        layout: {
            hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : i === 2 ? 1.2 : 0.5),
            vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor: (i) => (i === 2 ? '#999999' : '#cccccc'),
            vLineColor: () => '#cccccc',
            paddingLeft: () => 5, paddingRight: () => 5,
            paddingTop: () => 0,  paddingBottom: () => 0,
        },
    };
}

export function buildDocDefinition(sections, title, meta, logo, addrMap) {
    const fecha   = fmtFechaLarga(new Date());
    const content = [];

    sections.forEach((sec, i) => {
        const table = buildSectionTable(sec, fecha, logo, addrMap);
        if (i > 0) table.pageBreak = 'before';
        content.push(table);
        const secFooter = buildSectionFooter(sec);
        if (secFooter) content.push(secFooter);
        const espBlock = buildEspecialesBlock(sec.especiales);
        if (espBlock) content.push(espBlock);
    });

    // "Generado por + fecha/hora" va en el contenido (no en el footer) —
    // aparece justo después de la tabla, antes del espacio para firmas.
    if (meta.generadoPor) {
        content.push({
            margin: [0, 10, 0, 0],
            text: [
                { text: 'Generado por: ', fontSize: 7.5, color: '#666' },
                { text: meta.generadoPor, fontSize: 7.5, bold: true, color: '#333' },
                { text: `   ·   ${fmtFechaHora(new Date())}`, fontSize: 7.5, color: '#666' },
            ],
        });
    }

    return {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title },
        defaultStyle: { fontSize: 9 },
        content,
        footer: buildFooterCallback(meta),
    };
}

// ── Hojas exactas: preparar la captura ───────────────────────────────────────
// Construye el mismo docDef que se imprimiría, con id='row_N' en cada celda de
// laboratorio, y un `pageBreakBefore` que anota en qué página aparece por
// primera vez cada fila. Quien tenga pdfmake lo maqueta (`getBuffer`) y después
// llama a `grupos()`: los grupos coinciden 100% con el PDF impreso.
// Devuelve null si la sala no tiene nada que vaya en la tabla.
export function prepararHojasExactas(sucId, rawItems, logo, addrMap) {
    const printRows = rawItems.filter(r => !r.sin_stock && !isAdicional(r)).map(r => {
        const erpFactor  = r.factor ?? 1;
        const dispFactor = r.dispatch_factor ?? erpFactor;
        const qty        = toDispatch(r.cantidad_asignada ?? 0, erpFactor, dispFactor);
        const isLabel    = r.tiene_dispatch_label === true;
        return {
            _rawId:          r.id,
            product_name:    r.products?.nombre ?? '?',
            laboratorio:     r.products?.laboratorios?.nombre ?? '',
            presentacion_tipo: r.dispatch_tipo ?? r.presentaciones?.tipo ?? '',
            es_antibiotico:  r.products?.es_antibiotico ?? false,
            qty,
            qty_base: isLabel ? qty * dispFactor : null,
            lotes: lotesAsignadosToDispatch(
                Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                erpFactor, dispFactor,
            ),
        };
    }).filter(r => r.qty > 0);

    if (!printRows.length) return null;

    // sortRows devuelve el mismo orden que buildProductRows usa internamente
    const sorted = sortRows(printRows);

    const section = {
        sucId,
        nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
        codigo:   null,
        rows:     printRows,
        sinCount: 0,
        revCount: 0,
        _withRowIds: true,   // activa los id='row_N' en buildProductRows
    };

    // pageFirstIdx: { pageNumber → sorted index del primer item en esa página }
    const pageFirstIdx = {};

    const docDef = buildDocDefinition([section], '', {}, logo, addrMap);
    docDef.pageBreakBefore = (currentNode) => {
        const id = currentNode.id;
        if (typeof id === 'string' && id.startsWith('row_') && currentNode.startPosition) {
            const pg  = currentNode.startPosition.pageNumber; // 1-indexed
            const idx = parseInt(id.slice(4), 10);
            if (pageFirstIdx[pg] === undefined) pageFirstIdx[pg] = idx;
        }
        return false; // nunca añadir saltos extra
    };

    // null = el maquetado no anotó páginas (quien llama cae a la estimación).
    const grupos = () => {
        const pageNums = Object.keys(pageFirstIdx).map(Number).sort((a, b) => a - b);
        if (!pageNums.length) return null;
        return pageNums.map((pg, pi) => {
            const start   = pageFirstIdx[pg];
            const end     = pi < pageNums.length - 1 ? pageFirstIdx[pageNums[pi + 1]] : sorted.length;
            const pageRows = sorted.slice(start, end);
            return {
                ids:       pageRows.map(r => r._rawId).filter(Boolean),
                firstItem: pageRows[0]?.product_name ?? '',
                firstLab:  pageRows[0]?.laboratorio  ?? '',
                itemCount: pageRows.length,
            };
        });
    };

    return { docDef, grupos };
}

// ── La sección de una sala al GENERAR ────────────────────────────────────────
// La hoja que sale en el momento de generar: lo asignado por FEFO sobre la
// existencia de Bodega. Datos planos (sin funciones), para que el teléfono la
// arme acá y se la pase a su imprenta.
export function seccionDeGenerar(grouped, sucId, getAdjusted, codigo) {
    const g    = grouped[sucId] || { normal: [], revision: [], sinStock: [], agotamiento: [] };
    const rows = [...g.normal, ...(g.agotamiento ?? []), ...g.revision].filter(row => !isAdicional(row)).map(row => {
        const erpFactor  = row.factor ?? 1;
        const dispFactor = row.dispatch_factor ?? erpFactor;
        const qty        = toDispatch(getAdjusted(row), erpFactor, dispFactor);
        const isLabel    = row.tiene_dispatch_label === true;
        return {
            product_name:      row.product_name,
            laboratorio:       row.laboratorio ?? '',
            presentacion_tipo: row.dispatch_tipo ?? row.presentacion_tipo,
            es_antibiotico:    row.es_antibiotico,
            qty,
            qty_base: isLabel ? qty * dispFactor : null,
            // MISMA proyección que la captura y que el reimpreso: primero se
            // reparte en packs del sistema —que es lo que queda guardado en
            // `lotes_asignados` y lo que después viaja al traslado— y recién
            // ahí se convierte a la presentación de despacho. Al revés daba
            // un número de renglones de lote distinto, y como cada lote extra
            // suma alto a la fila, podía correr un salto de página: el papel
            // y las hojas guardadas dejaban de coincidir.
            lotes: lotesAsignadosToDispatch(
                fefoProject(row.lotes_bodega, getAdjusted(row)), erpFactor, dispFactor,
            ),
        };
    }).filter(r => r.qty > 0);

    let eCounter = 1;
    const especiales = [...g.normal, ...(g.agotamiento ?? []), ...g.revision]
        .filter(row => isAdicional(row) && (getAdjusted(row) ?? 0) > 0)
        .sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? '', 'es'))
        .flatMap(row => {
            const erpF     = row.factor ?? 1;
            const dispF    = row.dispatch_factor ?? erpF;
            const qty      = toDispatch(getAdjusted(row) ?? 1, erpF, dispF);
            const dispTipo = row.dispatch_tipo ?? row.presentacion_tipo ?? '';
            const rawLotes = lotesAsignadosToDispatch(
                fefoProject(row.lotes_bodega ?? [], getAdjusted(row) ?? 0), erpF, dispF,
            ).filter(l => l.lote || l.fecha_vencimiento);
            const lotPool  = rawLotes.map(l => ({ ...l, _rem: l.take ?? l.cantidad ?? l.packs ?? 0 }));
            return Array.from({ length: qty }, () => {
                let boxLot = null;
                for (const lot of lotPool) {
                    if (lot._rem > 0) { boxLot = { lote: lot.lote, fecha_vencimiento: lot.fecha_vencimiento, take: 1 }; lot._rem--; break; }
                }
                return { label: `E${eCounter++}`, product_name: row.product_name ?? '?', presentacion_tipo: dispTipo, dispF, tiene_dispatch_label: row.tiene_dispatch_label === true, lotes: boxLot ? [boxLot] : [] };
            });
        });

    const section = {
        sucId,
        nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
        codigo,
        rows,
        especiales,
        sinCount:         g.sinStock.length,
        revCount:         g.revision.length,
        agotamientoCount: (g.agotamiento ?? []).length,
    };
    // Nombre del archivo = código del pedido (ej. 01-170617-3-PO.pdf)
    const filename = codigo
        ? `${codigo}.pdf`
        : `Pedido_${section.nombre.replace(/ /g, '_')}_${dateSuffix()}.pdf`;
    return { section, filename };
}
