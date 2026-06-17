// ─── Pedido print utility ─────────────────────────────────────────────────────
// Genera un PDF real con pdfmake (no HTML+CSS print): el encabezado de cada
// tabla (título de sucursal + columnas) repite en TODAS las hojas vía
// headerRows, los márgenes de página son exactos (sin recorte por margen de
// hardware de la impresora) y las filas con varios lotes usan rowSpan nativo
// — todo calculado por el mismo motor que dibuja el PDF, sin depender de cómo
// cada navegador/impresora fragmenta HTML al imprimir.
// qty siempre está en PACKS (cajas/frascos/blisters), no en unidades.

import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';

pdfMake.addVirtualFileSystem(vfsFonts);

const ERP_NAMES_DEFAULT = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES_ORDER   = [5, 1, 2, 3, 4, 7];
const SUCURSAL_CODES     = { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'S4', 5: 'PO', 6: 'BO', 7: 'S5' };
const TOTAL_NON_BODEGA   = 6;

// Letter: 612pt ancho. Margen inferior 110pt para el bloque de firmas en el
// footer de la última página (el footer vive fuera del área de contenido — no
// reduce el espacio disponible por página). En páginas intermedias solo aparece
// el número de página en ese espacio.
const PAGE_MARGINS  = [24, 22, 24, 110];
const CONTENT_WIDTH = 612 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

// ── Logo cache ────────────────────────────────────────────────────────────────
let _logoCache = null;
async function getLogoBase64() {
    if (_logoCache) return _logoCache;
    try {
        const res  = await fetch('/Logo512.png');
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => { _logoCache = reader.result; resolve(reader.result); };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

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

function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (a.laboratorio || '').localeCompare(b.laboratorio || '', 'es')
        || (a.product_name || '').localeCompare(b.product_name || '', 'es')
    );
}

// ── Tabla por sucursal ──────────────────────────────────────────────────────
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
    const lines = lotes.map((lot) => loteCellNode(lot, bg));
    lines.forEach((l, i) => { l.margin = [0, i === 0 ? 2 : 1, 0, i === lines.length - 1 ? 2 : 1]; });
    return { stack: lines, fillColor: bg, verticalAlignment: 'middle' };
}

function buildProductRows(rows) {
    const body = [];
    sortRows(rows).forEach((r, idx) => {
        const bg  = idx % 2 === 1 ? '#f2f2f2' : '#ffffff';
        const lts = (r.lotes && r.lotes.length) ? r.lotes : [];

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

        const labCell  = { text: r.laboratorio || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' };
        const prodCell = { stack: productStack, fillColor: bg, margin: [0, 2, 0, 2], verticalAlignment: 'middle' };
        const presCell = { text: r.presentacion_tipo || '—', fillColor: bg, fontSize: 7, color: '#333', margin: [0, 2, 0, 2], verticalAlignment: 'middle' };
        const qtyCell  = { text: String(r.qty), fillColor: bg, fontSize: 9.5, bold: true, alignment: 'center', margin: [0, 2, 0, 2], verticalAlignment: 'middle' };
        const chkCell  = {
            fillColor: bg, alignment: 'center', margin: [0, 0, 0, 0], verticalAlignment: 'middle',
            canvas: [{ type: 'rect', x: 0, y: 0, w: 8, h: 8, lineWidth: 1, lineColor: '#555' }],
        };
        const loteCell = loteStackNode(lts, bg);

        body.push([labCell, prodCell, presCell, qtyCell, loteCell, chkCell]);
    });
    return body;
}

// Encabezado rediseñado: 3 filas (→ headerRows: 3) que repiten en cada página.
// Fila 1 (negro): logo + FARMACIA FARMALASA / ORDEN DE DESPACHO / fecha.
// Fila 2 (gris oscuro): Bodega → Sucursal / código / N prods · N packs.
// Fila 3: etiquetas de columnas (igual que antes).
function buildSectionTable(sec, fecha, logo) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);

    // Fila 1 — negro, logo + nombre farmacia + título + fecha
    const logoBlock = logo
        ? { image: logo, width: 26, height: 26, margin: [0, 0, 8, 0] }
        : { text: '', width: 0 };

    const titleRow = [
        {
            colSpan: 6, fillColor: '#111', margin: [8, 5, 8, 5],
            columns: [
                {
                    columns: [
                        logoBlock,
                        {
                            stack: [
                                { text: 'FARMACIA FARMALASA', fontSize: 10, bold: true, color: '#fff', lineHeight: 1.1 },
                                { text: 'Farmalasa S.A. de C.V.', fontSize: 6, color: '#888' },
                            ],
                        },
                    ],
                    width: '48%',
                },
                { text: 'ORDEN DE DESPACHO', fontSize: 10, bold: true, color: '#fff', alignment: 'center', width: '30%', margin: [0, 4, 0, 0] },
                { text: fecha, fontSize: 7, color: '#999', alignment: 'right', width: '22%', margin: [0, 5, 0, 0] },
            ],
        },
        {}, {}, {}, {}, {},
    ];

    // Fila 2 — gris oscuro, ruta Bodega → Sucursal + código + conteos
    const subtitleRow = [
        {
            colSpan: 6, fillColor: '#2c2c2c', margin: [8, 3, 8, 3],
            columns: [
                { text: `Bodega  →  ${sec.nombre}`, fontSize: 8, bold: true, color: '#e0e0e0', width: '44%' },
                { text: sec.codigo ? `Código: ${sec.codigo}` : '', fontSize: 7.5, color: '#aaa', alignment: 'center', width: '30%' },
                { text: `${sec.rows.length} prod  ·  ${totalPacks} packs`, fontSize: 7.5, color: '#aaa', alignment: 'right', width: '26%' },
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
            hLineWidth:  (i, node) => (i === 0 ? 0 : i === 3 ? 1.2 : i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth:  (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor:  (i) => (i === 3 ? '#999' : '#ddd'),
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
        margin: [0, 0, 0, 10],
        table: { widths: ['*'], body: [[
            { text: parts.join('     ·     '), fontSize: 7.5, color: '#000', fillColor: '#ebebeb', margin: [8, 4, 8, 4] },
        ]] },
        layout: 'noBorders',
    };
}

function sigColumn(nombre, label, width) {
    return {
        width,
        stack: [
            { text: nombre || ' ', fontSize: 9, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 1.2, lineColor: '#000' }], alignment: 'center' },
            { text: label, fontSize: 7.5, bold: true, alignment: 'center', color: '#000', margin: [0, 4, 0, 0] },
        ],
    };
}

// Firmas en el footer de la ÚLTIMA página; número de página en todas.
// Con PAGE_MARGINS[3]=110pt, el área de footer es 110pt. Las firmas ocupan
// ~80pt empezando desde el borde del contenido; en páginas intermedias solo
// aparece el número centrado a 88pt del borde del contenido (≈22pt del físico).
function buildFooterCallback(meta) {
    const responsable = meta.responsable || meta.generadoPor || null;
    const generadoPor = meta.generadoPor || null;

    return (currentPage, pageCount) => {
        const isLast = currentPage === pageCount;

        if (!isLast) {
            return {
                margin: [PAGE_MARGINS[0], 88, PAGE_MARGINS[2], 0],
                text: `${currentPage} / ${pageCount}`,
                fontSize: 6.5, color: '#bbb', alignment: 'center',
            };
        }

        // Última página: bloque de firmas completo
        const generadoLine = generadoPor
            ? [
                { text: 'Generado por: ', fontSize: 8, color: '#555' },
                { text: generadoPor, fontSize: 8, bold: true, color: '#000' },
              ]
            : [];

        return {
            margin: [PAGE_MARGINS[0], 8, PAGE_MARGINS[2], 0],
            stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1.2, lineColor: '#000' }] },
                {
                    margin: [0, 5, 0, 10],
                    columns: [
                        { text: generadoLine, width: '*' },
                        { text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: '#bbb', alignment: 'right', width: 'auto' },
                    ],
                },
                {
                    columns: [
                        sigColumn(responsable, 'RESPONSABLE', '28%'),
                        sigColumn(meta.revisor ?? null, 'REVISADO POR', '28%'),
                        sigColumn(null, 'AUTORIZA', '22%'),
                        {
                            width: '22%',
                            table: { widths: ['*'], body: [[
                                { text: 'SELLO', fontSize: 8, color: '#777', alignment: 'center', margin: [0, 14, 0, 14] },
                            ]] },
                            layout: { hLineWidth: () => 1.2, vLineWidth: () => 1.2, hLineColor: () => '#000', vLineColor: () => '#000' },
                        },
                    ],
                },
            ],
        };
    };
}

function buildDocDefinition(sections, title, meta, logo = null) {
    const fecha   = fmtFechaLarga(new Date());
    const content = [];

    sections.forEach((sec, i) => {
        const table = buildSectionTable(sec, fecha, logo);
        if (i > 0) table.pageBreak = 'before';
        content.push(table);
        const secFooter = buildSectionFooter(sec);
        if (secFooter) content.push(secFooter);
    });

    return {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title },
        defaultStyle: { fontSize: 9 },
        content,
        footer: buildFooterCallback(meta),
    };
}

// Descarga el PDF directamente con el nombre de archivo correcto.
function downloadPdf(docDefinition, filename) {
    pdfMake.createPdf(docDefinition).download(filename);
}

function dateSuffix() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getFullYear()).slice(-2)}`;
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

// Convierte qty y lotes de packs ERP a packs de despacho cuando la regla usa otra presentación.
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

// Genera UN solo PDF combinado con todas las sucursales (una por página) y lo descarga.
// Elimina los N diálogos de impresión separados y el 1-segundo de delay entre ellos.
export async function printPerSucursal(grouped, sortedSucIds, getAdjusted, codigoFn, meta = {}) {
    const logo = await getLogoBase64();

    const sections = sortedSucIds.map(sucId => {
        const g    = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const rows = [...g.normal, ...g.revision].map(row => {
            const erpFactor  = row.factor ?? 1;
            const dispFactor = row.dispatch_factor ?? erpFactor;
            const dispTipo   = row.dispatch_tipo ?? row.presentacion_tipo;
            const qty        = toDispatch(getAdjusted(row), erpFactor, dispFactor);
            return {
                product_name:      row.product_name,
                laboratorio:       row.laboratorio ?? '',
                presentacion_tipo: dispTipo,
                es_antibiotico:    row.es_antibiotico,
                qty,
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        }).filter(r => r.qty > 0);

        return {
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo:   codigoFn ? codigoFn(sucId) : null,
            rows,
            sinCount: g.sinStock.length,
            revCount: g.revision.length,
        };
    });

    const numero   = meta.pedidoNumero;
    const filename = numero
        ? `Pedido_${String(numero).padStart(3, '0')}_${dateSuffix()}.pdf`
        : `Pedido_${dateSuffix()}.pdf`;

    const docDef = buildDocDefinition(sections, filename.replace('.pdf', ''), meta, logo);
    downloadPdf(docDef, filename);
}

export async function printFromPreview(grouped, sortedSucIds, getAdjusted, title, meta = {}) {
    const logo = await getLogoBase64();
    const sections = sortedSucIds.map(sucId => {
        const g      = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const mapped = [...g.normal, ...g.revision].map(row => {
            const erpFactor  = row.factor ?? 1;
            const dispFactor = row.dispatch_factor ?? erpFactor;
            const dispTipo   = row.dispatch_tipo ?? row.presentacion_tipo;
            const qty        = toDispatch(getAdjusted(row), erpFactor, dispFactor);
            return {
                product_name:      row.product_name,
                laboratorio:       row.laboratorio ?? '',
                presentacion_tipo: dispTipo,
                es_antibiotico:    row.es_antibiotico,
                qty,
                lotes: fefoProject(lotesToDispatch(row.lotes_bodega, erpFactor, dispFactor), qty),
            };
        });
        return {
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo:   null,
            rows:     mapped.filter(r => r.qty > 0),
            sinCount: g.sinStock.length,
            revCount: mapped.filter(r => r.qty === 0).length,
        };
    });
    const filename = `${(title ?? 'Vista_previa_pedido').replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    const docDef   = buildDocDefinition(sections, title ?? 'Vista previa del pedido', meta, logo);
    downloadPdf(docDef, filename);
}

export async function printFromSnapshot(snapshot, meta = {}) {
    const logo  = await getLogoBase64();
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
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo:   null,
            rows,
            sinCount: g.sinStock.length,
            revCount: 0,
        };
    });
    const nombre   = snapshot.nombre ?? 'Borrador_guardado';
    const filename = `${nombre.replace(/[^a-zA-Z0-9_\-]/g,'_')}.pdf`;
    const docDef   = buildDocDefinition(sections, nombre, meta, logo);
    downloadPdf(docDef, filename);
}

export async function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}, titleOverride = null) {
    const logo  = await getLogoBase64();
    const ds    = dateSuffix();

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
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            codigo:   sucGroups.length === 1 ? (titleOverride ?? null) : null,
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

    const docDef = buildDocDefinition(sections, title, meta, logo);
    downloadPdf(docDef, filename);
}
