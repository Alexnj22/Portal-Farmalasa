// ─── Pedido print utility ─────────────────────────────────────────────────────
// Genera un PDF real con pdfmake: el encabezado de cada tabla repite en todas
// las hojas vía headerRows, márgenes exactos, filas atómicas (dontBreakRows).
// qty siempre en PACKS (cajas/blisters/frascos), no en unidades.

import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import { supabase } from '../supabaseClient';

pdfMake.addVirtualFileSystem(vfsFonts);

const ERP_NAMES_DEFAULT = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES_ORDER = [5, 1, 2, 3, 4, 7];
const SUCURSAL_CODES  = { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'S4', 5: 'PO', 6: 'BO', 7: 'S5' };
const TOTAL_NON_BODEGA = 6;
const CUSTOM_LABELS    = ['CAJA', 'ESTUCHE', 'BOLSA'];

// Va a "Cajas Adicionales" solo si dispatch_label='CAJA' (Electrolit) o caja_especial. ESTUCHE/BOLSA van en tabla normal.
function isAdicional(row) {
    return row.caja_especial === true ||
           (row.tiene_dispatch_label === true && (row.dispatch_tipo ?? '').toUpperCase() === 'CAJA');
}

// Nombre de farmacia según destino
function getFarmaciaName(sucId) {
    if (sucId === 5) return 'FARMACIA LA POPULAR';
    if (sucId === 6) return 'BODEGA FARMALASA';
    return 'FARMACIA LA SALUD';
}

// Margen inferior 44pt — espacio para el footer original (Revisado/Recibido).
// En la última página se agrega el bloque de firmas compacto arriba del footer.
const PAGE_MARGINS  = [24, 22, 24, 44];
const CONTENT_WIDTH = 612 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

// ── Asset cache ───────────────────────────────────────────────────────────────
let _logoCache = null;
async function getLogoBase64() {
    if (_logoCache) return _logoCache;
    try {
        const res  = await fetch('/Logo512.png');
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload  = () => { _logoCache = reader.result; resolve(reader.result); };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch { return null; }
}

let _addrCache = null;
async function getAddressMap() {
    if (_addrCache) return _addrCache;
    try {
        const { data, error } = await supabase
            .from('erp_sucursal_map')
            .select('erp_sucursal_id, branches(address)');
        if (error) console.error('getAddressMap: fetch erp_sucursal_map failed:', error.message);
        _addrCache = {};
        if (data) {
            for (const r of data) {
                _addrCache[r.erp_sucursal_id] = r.branches?.address ?? '';
            }
        }
        return _addrCache;
    } catch { _addrCache = {}; return _addrCache; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function fefoProject(lotes, qty) {
    if (!lotes || !lotes.length || qty <= 0) return [];
    let rem = qty;
    const result = [];
    for (const lot of lotes) {
        if (rem <= 0) break;
        const take = Math.min(Number(lot.packs), rem);
        if (take > 0) { result.push({ ...lot, take }); rem -= take; }
    }
    return result;
}

function fmtVence(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-SV', { month: 'short', year: '2-digit' });
}
function fmtFechaLarga(date) {
    return date.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtFechaHora(date) {
    return date.toLocaleDateString('es-SV', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}
function dateSuffix() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getFullYear()).slice(-2)}`;
}
function sortRows(rows) {
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
    const originText = bodegaAddr ? `Origen: Bodega · ${bodegaAddr}` : 'Origen: Bodega';
    const destText   = sucAddr    ? `Destino: ${sec.nombre} · ${sucAddr}` : `Destino: ${sec.nombre}`;
    const subtitleRow = [
        {
            colSpan: 6, fillColor: '#ffffff', margin: [6, 9, 6, 9],
            columns: [
                { text: originText, fontSize: 6, color: '#555', width: '36%' },
                { text: destText,   fontSize: 6, color: '#555', width: '38%', alignment: 'center' },
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
function buildFooterCallback(_meta) {
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

function buildDocDefinition(sections, title, meta, logo, addrMap) {
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

function downloadPdf(docDefinition, filename) {
    pdfMake.createPdf(docDefinition).download(filename);
}

// ── Estimación de páginas para FinalizarCajasModal ──────────────────────────
// Calibrado contra pdfmake con LETTER, PAGE_MARGINS=[24,22,24,44] y el layout
// de buildSectionTable (paddingTop:0, paddingBottom:0 → solo margin de celda).
//
// Alturas reales en pdfmake (cell margin [0,2,0,2] + fontSize + border 0.5pt):
//   Fila simple (0-1 lotes, sin badge) ≈ 15pt
//   Cada lote adicional añade ≈ 9pt  (fontSize 7.5 × 1.15 + margin 1+1 = 10.6pt)
//   Badge BAJO RECETA añade ≈ 8pt
//   Header 3 filas (titleRow+subtitle+colHeader) ≈ 50pt
//   Espacio disponible para datos ≈ 726 - 50 = 676pt
const _AVAIL_H    = 792 - PAGE_MARGINS[1] - PAGE_MARGINS[3]; // 726pt
const _HEADER_PT  = 61;
const _DATA_AVAIL = _AVAIL_H - _HEADER_PT;  // 665pt (sin buffer — alturas más ajustadas)
const _ROW_BASE   = 15;   // fila simple (0-1 lotes, sin badge) — calibrado empíricamente
const _LOTE_XTRA  = 9;    // pt por lote adicional (2do, 3ro…)
const _BADGE_ADD  = 8;    // pt extra por badge BAJO RECETA

function _rowPt(row) {
    // Funciona con pedido_items crudos (lotes_asignados) o filas mapeadas (lotes)
    const loteCnt = Array.isArray(row.lotes_asignados) ? row.lotes_asignados.length
                  : Array.isArray(row.lotes)            ? row.lotes.length : 0;
    const badge   = row.products?.es_antibiotico ?? row.es_antibiotico ?? false;
    return Math.max(
        _ROW_BASE + (badge ? _BADGE_ADD : 0),
        loteCnt > 1 ? _ROW_BASE + (loteCnt - 1) * _LOTE_XTRA : _ROW_BASE,
    );
}

// Retorna [{ ids, firstItem, firstLab, itemCount }, …]
// Sort idéntico a buildProductRows (lab → producto).
export function getPageGroups(rows) {
    const printable = [...rows]
        .filter(r => !r.sin_stock && (r.cantidad_asignada ?? 0) > 0)
        .sort((a, b) =>
            (a.products?.laboratorios?.nombre ?? '').localeCompare(b.products?.laboratorios?.nombre ?? '', 'es')
            || (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es')
        );

    const pages = [];
    let page = [], used = 0;
    for (const row of printable) {
        const h = _rowPt(row);
        if (used + h > _DATA_AVAIL && page.length > 0) {
            pages.push(page); page = []; used = 0;
        }
        page.push(row);
        used += h;
    }
    if (page.length > 0) pages.push(page);

    return pages.map(p => ({
        ids:       p.map(r => r.id),
        firstItem: p[0]?.products?.nombre ?? '',
        firstLab:  p[0]?.products?.laboratorios?.nombre ?? '',
        itemCount: p.length,
    }));
}

// ── Extracción exacta de páginas vía pageBreakBefore ─────────────────────────
// Construye el mismo docDef que se imprimiría, añade id='row_N' a cada celda
// de laboratorio, y usa pdfMake.createPdf().getBuffer() para disparar el layout.
// pageBreakBefore captura en qué página aparece por primera vez cada fila.
// Resultado: grupos EXACTOS que coinciden 100% con el PDF impreso.
export async function getExactPageGroups(sucId, rawItems) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);

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

    if (!printRows.length) return [];

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

    // getBuffer() retorna una Promise (no usa callback en v0.3.11)
    await pdfMake.createPdf(docDef).getBuffer();

    const pageNums = Object.keys(pageFirstIdx).map(Number).sort((a, b) => a - b);
    if (!pageNums.length) return getPageGroups(rawItems); // fallback

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
}

// ── Public API ────────────────────────────────────────────────────────────────

// countsBySuc: { [erp_sucursal_id]: numero_mensual_por_sucursal }
export function buildPedidoCodigo(countsBySuc, date, nSelected) {
    const d      = date instanceof Date ? date : new Date();
    const dd     = String(d.getDate()).padStart(2, '0');
    const mm     = String(d.getMonth() + 1).padStart(2, '0');
    const yy     = String(d.getFullYear()).slice(-2);
    const aabbcc = `${dd}${mm}${yy}`;
    const dist   = nSelected >= TOTAL_NON_BODEGA ? '3' : nSelected > 1 ? '2' : '1';
    return (sucId) => {
        const nn = String(countsBySuc[sucId] ?? 1).padStart(2, '0');
        return `${nn}-${aabbcc}-${dist}-${SUCURSAL_CODES[sucId] ?? `S${sucId}`}`;
    };
}

export function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}
export function lotesToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, packs: Math.floor((l.packs ?? 0) * erpFactor / dispFactor) }))
        .filter(l => l.packs > 0);
}
export function lotesAsignadosToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, take: toDispatch(l.take ?? l.cantidad ?? l.packs ?? 0, erpFactor, dispFactor) }))
        .filter(l => l.take > 0);
}

// Un PDF individual por sucursal, nombrado con el código del pedido.
// Descarga simultánea: todos los blobs se construyen en paralelo y se
// disparan con 150ms de intervalo (invisible para el usuario pero evita
// que el navegador bloquee descargas simultáneas).
export async function printPerSucursal(grouped, sortedSucIds, getAdjusted, codigoFn, meta = {}) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);

    const pdfs = sortedSucIds.map(sucId => {
        const g    = grouped[sucId] || { normal: [], revision: [], sinStock: [], agotamiento: [] };
        const rows = [...g.normal, ...g.agotamiento, ...g.revision].filter(row => !isAdicional(row)).map(row => {
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
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        }).filter(r => r.qty > 0);

        let eCounter = 1;
        const especiales = [...g.normal, ...g.agotamiento, ...g.revision]
            .filter(row => isAdicional(row) && (getAdjusted(row) ?? 0) > 0)
            .sort((a, b) => (a.product_name ?? '').localeCompare(b.product_name ?? '', 'es'))
            .flatMap(row => {
                const erpF     = row.factor ?? 1;
                const dispF    = row.dispatch_factor ?? erpF;
                const qty      = toDispatch(getAdjusted(row) ?? 1, erpF, dispF);
                const dispTipo = row.dispatch_tipo ?? row.presentacion_tipo ?? '';
                const rawLotes = fefoProject(
                    lotesToDispatch(row.lotes_bodega ?? [], erpF, dispF),
                    qty,
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

        const codigo = codigoFn ? codigoFn(sucId) : null;
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
    });

    pdfs.forEach(({ section, filename }, idx) => {
        setTimeout(() => {
            const docDef = buildDocDefinition([section], section.codigo ?? section.nombre, meta, logo, addrMap);
            downloadPdf(docDef, filename);
        }, idx * 150);
    });
}

export async function printFromPreview(grouped, sortedSucIds, getAdjusted, title, meta = {}) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);
    const sections = sortedSucIds.map(sucId => {
        const g      = grouped[sucId] || { normal: [], revision: [], sinStock: [], agotamiento: [] };
        const mapped = [...g.normal, ...g.agotamiento, ...g.revision].filter(row => !row.caja_especial).map(row => {
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
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        });
        return {
            sucId, nombre: ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo: null,
            rows:             mapped.filter(r => r.qty > 0),
            sinCount:         g.sinStock.length,
            revCount:         mapped.filter(r => r.qty === 0).length,
            agotamientoCount: (g.agotamiento ?? []).length,
        };
    });
    const filename = `${(title ?? 'Vista_previa').replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    downloadPdf(buildDocDefinition(sections, title ?? 'Vista previa', meta, logo, addrMap), filename);
}

export async function printFromSnapshot(snapshot, meta = {}) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);
    const datos = Array.isArray(snapshot.datos) ? snapshot.datos : [];
    const byS   = {};
    for (const row of datos) {
        const s = row.erp_sucursal_id;
        if (!byS[s]) byS[s] = { normal: [], sinStock: [] };
        if (row.sin_stock) byS[s].sinStock.push(row);
        else byS[s].normal.push(row);
    }
    const ids = [
        ...SUCURSALES_ORDER.filter(id => byS[id]),
        ...Object.keys(byS).map(Number).filter(id => !SUCURSALES_ORDER.includes(id)),
    ];
    const sections = ids.map(sucId => {
        const g = byS[sucId];
        const rows = g.normal.map(row => {
            const qty = row.cantidad_asignada ?? 0;
            return {
                product_name:      row.product_name,
                laboratorio:       row.laboratorio ?? '',
                presentacion_tipo: row.presentacion_tipo,
                es_antibiotico:    row.es_antibiotico,
                qty,
                lotes: fefoProject(row.lotes_bodega, qty),
            };
        });
        return {
            sucId, nombre: ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo: null, rows, sinCount: g.sinStock.length, revCount: 0,
        };
    });
    const nombre   = snapshot.nombre ?? 'Borrador_guardado';
    const filename = `${nombre.replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    downloadPdf(buildDocDefinition(sections, nombre, meta, logo, addrMap), filename);
}

export async function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}, titleOverride = null) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);
    const ds = dateSuffix();

    const sections = sucGroups.map(([sucId, rows]) => {
        const printRows = rows.filter(r => !r.sin_stock && !isAdicional(r)).map(r => {
            const erpFactor  = r.factor ?? 1;
            const dispFactor = r.dispatch_factor ?? erpFactor;
            const dispTipo   = r.dispatch_tipo ?? r.presentaciones?.tipo ?? '';
            const qty        = toDispatch(r.cantidad_asignada ?? 0, erpFactor, dispFactor);
            const isLabel    = r.tiene_dispatch_label === true;
            return {
                product_name:      r.products?.nombre ?? '?',
                laboratorio:       r.products?.laboratorios?.nombre ?? '',
                presentacion_tipo: dispTipo,
                es_antibiotico:    r.products?.es_antibiotico ?? false,
                qty,
                qty_base: isLabel ? qty * dispFactor : null,
                lotes: lotesAsignadosToDispatch(
                    Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                    erpFactor, dispFactor,
                ),
            };
        }).filter(r => r.qty > 0);

        let eCounter = 1;
        const especiales = rows
            .filter(r => !r.sin_stock && isAdicional(r) && (r.cantidad_asignada ?? 0) > 0)
            .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
            .flatMap(r => {
                const erpF     = r.factor ?? 1;
                const dispF    = r.dispatch_factor ?? erpF;
                const qty      = toDispatch(r.cantidad_asignada ?? 1, erpF, dispF);
                const dispTipo = r.dispatch_tipo ?? r.presentaciones?.tipo ?? '';
                const rawLotes = lotesAsignadosToDispatch(
                    Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                    erpF, dispF,
                ).filter(l => l.lote || l.fecha_vencimiento);
                const lotPool  = rawLotes.map(l => ({ ...l, _rem: l.take ?? l.cantidad ?? l.packs ?? 0 }));
                return Array.from({ length: qty }, () => {
                    let boxLot = null;
                    for (const lot of lotPool) {
                        if (lot._rem > 0) { boxLot = { lote: lot.lote, fecha_vencimiento: lot.fecha_vencimiento, take: 1 }; lot._rem--; break; }
                    }
                    return { label: `E${eCounter++}`, product_name: r.products?.nombre ?? '?', presentacion_tipo: dispTipo, dispF, tiene_dispatch_label: r.tiene_dispatch_label === true, lotes: boxLot ? [boxLot] : [] };
                });
            });

        return {
            sucId, nombre: ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo: sucGroups.length === 1 ? (titleOverride ?? null) : null,
            rows:     printRows,
            especiales,
            sinCount: rows.filter(r => r.sin_stock).length,
            revCount: rows.filter(r => r.revision_minmax && !r.sin_stock && !r.caja_especial).length,
        };
    });

    const title = titleOverride
        ?? (sucGroups.length === 1
            ? `Pedido_${(ERP_NAMES_DEFAULT[sucGroups[0][0]] ?? `Sucursal_${sucGroups[0][0]}`).replace(/ /g, '_')}_${ds}`
            : `Pedido_${String(pedidoNumero).padStart(3,'0')}_${ds}`);
    const filename = `${title.replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    downloadPdf(buildDocDefinition(sections, title, meta, logo, addrMap), filename);
}
