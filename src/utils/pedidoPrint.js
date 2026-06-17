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

// Nombre de farmacia según destino
function getFarmaciaName(sucId) {
    if (sucId === 5) return 'FARMACIA LA POPULAR';
    if (sucId === 6) return 'BODEGA FARMALASA';
    return 'FARMACIA LA SALUD';
}

// Margen inferior 60pt — alojar el bloque de firmas en el footer (≈42pt)
// sin desperdiciar espacio en páginas normales (antes 110pt = demasiado vacío).
const PAGE_MARGINS  = [24, 22, 24, 60];
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
        const { data } = await supabase
            .from('erp_sucursal_map')
            .select('erp_sucursal_id, branches(address)');
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
    if (lot.lote) parts.push({ text: lot.lote, bold: true });
    if (vence)    parts.push({ text: vence, italics: true });
    parts.push({ text: `${count}`, bold: true });
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

function buildProductRows(rows) {
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
        body.push([
            { text: r.laboratorio || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            { stack: productStack, fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            { text: r.presentacion_tipo || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
            { text: String(r.qty), fillColor: bg, fontSize: 9.5, bold: true, alignment: 'center', margin: [0, 2, 0, 2], verticalAlignment: 'middle' },
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
    const totalPacks   = sec.rows.reduce((t, r) => t + r.qty, 0);
    const farmaciaName = getFarmaciaName(sec.sucId);
    const bodegaAddr   = addrMap?.[6] ?? '';
    const sucAddr      = addrMap?.[sec.sucId] ?? '';

    const logoCell = logo
        ? { image: logo, width: 22, height: 22, margin: [0, 0, 7, 0] }
        : { text: '', width: 0 };

    // Fila 1 — gris claro, B&W friendly
    const titleRow = [
        {
            colSpan: 6, fillColor: '#eeeeee', margin: [8, 4, 8, 4],
            columns: [
                {
                    columns: [
                        logoCell,
                        { text: farmaciaName, fontSize: 10, bold: true, color: '#111', margin: [0, 3, 0, 0] },
                    ],
                    width: '48%',
                },
                { text: 'ORDEN DE DESPACHO', fontSize: 9.5, bold: true, color: '#333', alignment: 'center', width: '28%', margin: [0, 3, 0, 0] },
                {
                    stack: [
                        { text: sec.codigo ?? '', fontSize: 8, bold: true, color: '#111', alignment: 'right' },
                        { text: fecha, fontSize: 7, color: '#666', alignment: 'right' },
                    ],
                    width: '24%',
                },
            ],
        },
        {}, {}, {}, {}, {},
    ];

    // Fila 2 — blanco, ruta origen→destino
    const originText = bodegaAddr ? `Origen: Bodega  ·  ${bodegaAddr}` : 'Origen: Bodega';
    const destText   = sucAddr ? `Destino: ${sec.nombre}  ·  ${sucAddr}` : `Destino: ${sec.nombre}`;
    const subtitleRow = [
        {
            colSpan: 6, fillColor: '#ffffff', margin: [8, 3, 8, 3],
            columns: [
                { text: originText, fontSize: 6.5, color: '#555', width: '48%' },
                { text: '→', fontSize: 8, bold: true, color: '#333', alignment: 'center', width: '6%', margin: [0, 0.5, 0, 0] },
                {
                    stack: [
                        { text: destText, fontSize: 6.5, color: '#555' },
                        { text: `${sec.rows.length} prod  ·  ${totalPacks} packs`, fontSize: 6, color: '#aaa', margin: [0, 1, 0, 0] },
                    ],
                    width: '46%',
                },
            ],
        },
        {}, {}, {}, {}, {},
    ];

    const headerRow = HEADER_LABELS.map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 6.5, color: '#000',
        alignment: (i === 3 || i === 5) ? 'center' : 'left',
        margin: [0, 3, 0, 3],
    }));

    const bodyRows = sec.rows.length
        ? buildProductRows(sec.rows)
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

// Firma: línea arriba para firmar, nombre impreso debajo, etiqueta al final.
// Formato: _______ / Nombre / ETIQUETA
function sigColumn(nombre, label, width) {
    return {
        width,
        stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 1, lineColor: '#000' }] },
            { text: nombre || ' ', fontSize: 8, margin: [0, 3, 0, 1] },
            { text: label, fontSize: 7, bold: true, color: '#555' },
        ],
    };
}

// Footer callback: firmas solo en la ÚLTIMA página, número de página en todas.
// Con PAGE_MARGINS[3]=60pt el footer ocupa 60pt — suficiente para las firmas (~40pt)
// sin dejar grandes vacíos en páginas normales (antes 110pt = demasiado desperdicio).
function buildFooterCallback(meta) {
    const responsable = meta.responsable || meta.generadoPor || null;
    return (currentPage, pageCount) => {
        if (currentPage !== pageCount) {
            return {
                margin: [PAGE_MARGINS[0], 46, PAGE_MARGINS[2], 0],
                text: `${currentPage} / ${pageCount}`,
                fontSize: 6.5, color: '#bbb', alignment: 'center',
            };
        }
        // Última página — bloque de firmas
        return {
            margin: [PAGE_MARGINS[0], 5, PAGE_MARGINS[2], 0],
            stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1, lineColor: '#bbb' }] },
                {
                    margin: [0, 6, 0, 0],
                    columns: [
                        sigColumn(responsable, 'RESPONSABLE', '55%'),
                        {
                            width: '30%',
                            table: { widths: ['*'], body: [[
                                { text: 'SELLO', fontSize: 8, color: '#aaa', alignment: 'center', margin: [0, 5, 0, 5] },
                            ]] },
                            layout: {
                                hLineWidth: () => 0.8, vLineWidth: () => 0.8,
                                hLineColor: () => '#bbb', vLineColor: () => '#bbb',
                            },
                        },
                        { width: '15%', text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: '#bbb', alignment: 'right', margin: [0, 2, 0, 0] },
                    ],
                },
            ],
        };
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

// ── Public API ────────────────────────────────────────────────────────────────

export function buildPedidoCodigo(numero, date, nSelected) {
    const nn     = String(numero ?? 0).padStart(2, '0');
    const d      = date instanceof Date ? date : new Date();
    const dd     = String(d.getDate()).padStart(2, '0');
    const mm     = String(d.getMonth() + 1).padStart(2, '0');
    const yy     = String(d.getFullYear()).slice(-2);
    const aabbcc = `${dd}${mm}${yy}`;
    const dist   = nSelected >= TOTAL_NON_BODEGA ? '3' : nSelected > 1 ? '2' : '1';
    return (sucId) => `${nn}-${aabbcc}-${dist}-${SUCURSAL_CODES[sucId] ?? `S${sucId}`}`;
}

function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}
function lotesToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, packs: Math.floor((l.packs ?? 0) * erpFactor / dispFactor) }))
        .filter(l => l.packs > 0);
}
function lotesAsignadosToDispatch(lotes, erpFactor, dispFactor) {
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
        const g    = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const rows = [...g.normal, ...g.revision].map(row => {
            const erpFactor  = row.factor ?? 1;
            const dispFactor = row.dispatch_factor ?? erpFactor;
            const qty        = toDispatch(getAdjusted(row), erpFactor, dispFactor);
            return {
                product_name:      row.product_name,
                laboratorio:       row.laboratorio ?? '',
                presentacion_tipo: row.dispatch_tipo ?? row.presentacion_tipo,
                es_antibiotico:    row.es_antibiotico,
                qty,
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        }).filter(r => r.qty > 0);

        const codigo = codigoFn ? codigoFn(sucId) : null;
        const section = {
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo,
            rows,
            sinCount: g.sinStock.length,
            revCount: g.revision.length,
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
        const g      = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const mapped = [...g.normal, ...g.revision].map(row => {
            const erpFactor  = row.factor ?? 1;
            const dispFactor = row.dispatch_factor ?? erpFactor;
            const qty        = toDispatch(getAdjusted(row), erpFactor, dispFactor);
            return {
                product_name:      row.product_name,
                laboratorio:       row.laboratorio ?? '',
                presentacion_tipo: row.dispatch_tipo ?? row.presentacion_tipo,
                es_antibiotico:    row.es_antibiotico,
                qty,
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        });
        return {
            sucId, nombre: ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo: null,
            rows:     mapped.filter(r => r.qty > 0),
            sinCount: g.sinStock.length,
            revCount: mapped.filter(r => r.qty === 0).length,
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
        const printRows = rows.filter(r => !r.sin_stock).map(r => {
            const erpFactor  = r.factor ?? 1;
            const dispFactor = r.dispatch_factor ?? erpFactor;
            const dispTipo   = r.dispatch_tipo ?? r.presentaciones?.tipo ?? '';
            const qty        = toDispatch(r.cantidad_asignada ?? 0, erpFactor, dispFactor);
            return {
                product_name:      r.products?.nombre ?? '?',
                laboratorio:       r.products?.laboratorios?.nombre ?? '',
                presentacion_tipo: dispTipo,
                es_antibiotico:    r.products?.es_antibiotico ?? false,
                qty,
                lotes: lotesAsignadosToDispatch(
                    Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
                    erpFactor, dispFactor,
                ),
            };
        }).filter(r => r.qty > 0);
        return {
            sucId, nombre: ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo: sucGroups.length === 1 ? (titleOverride ?? null) : null,
            rows:     printRows,
            sinCount: rows.filter(r => r.sin_stock).length,
            revCount: rows.filter(r => r.revision_minmax && !r.sin_stock).length,
        };
    });

    const title = titleOverride
        ?? (sucGroups.length === 1
            ? `Pedido_${(ERP_NAMES_DEFAULT[sucGroups[0][0]] ?? `Sucursal_${sucGroups[0][0]}`).replace(/ /g, '_')}_${ds}`
            : `Pedido_${String(pedidoNumero).padStart(3,'0')}_${ds}`);
    const filename = `${title.replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    downloadPdf(buildDocDefinition(sections, title, meta, logo, addrMap), filename);
}
