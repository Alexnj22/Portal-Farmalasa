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

// Letter = 612pt de ancho. Márgenes generosos (24pt ≈ 8.5mm, 30pt abajo)
// para quedar siempre dentro del área imprimible real de cualquier impresora
// (el margen de hardware típico es 4-6mm) — el PDF nunca se recorta.
const PAGE_MARGINS  = [24, 22, 24, 30];
const CONTENT_WIDTH = 612 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

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
// headerRows:2 -> pdfmake repite SIEMPRE las 2 primeras filas (título negro +
// encabezado de columnas) al inicio de cada hoja que ocupe esta tabla.
const COL_WIDTHS    = ['16%', '31%', '13%', '9%', '25%', '6%'];
const HEADER_LABELS = ['Laboratorio', 'Producto', 'Presentación', 'Cant.', 'Lote', 'OK'];

function loteCellNode(lot, bg) {
    if (!lot) return { text: '—', fontSize: 8, color: '#999', fillColor: bg, margin: [0, 2, 0, 2] };
    const count = lot.take ?? lot.cantidad ?? lot.packs ?? '?';
    const vence = fmtVence(lot.fecha_vencimiento);
    const parts = [];
    if (lot.lote) parts.push({ text: lot.lote, bold: true });
    if (vence)    parts.push({ text: vence, italics: true });
    parts.push({ text: `${count}pk`, bold: true });
    const joined = [];
    parts.forEach((p, i) => { if (i > 0) joined.push({ text: '  ·  ', color: '#999' }); joined.push(p); });
    return { text: joined, fontSize: 7.5, fillColor: bg, margin: [0, 2, 0, 2] };
}

// Cada producto es UNA sola fila de tabla; sus lotes se apilan como líneas
// dentro de la celda "Lote" (en vez de varias filas + rowSpan). pdfmake NO
// garantiza que un grupo rowSpan se mantenga junto al paginar — lo divide
// entre hojas y deja Lab/Producto/Cant en blanco en la continuación (bug
// confirmado en pruebas). Con una fila por producto + dontBreakRows en la
// tabla, cada producto es la unidad atómica que pdfmake mueve completa a la
// siguiente hoja si no cabe, sin nunca cortar sus lotes a la mitad.
function loteStackNode(lotes, bg) {
    if (!lotes.length) return { text: '—', fontSize: 8, color: '#999', fillColor: bg, margin: [0, 2, 0, 2] };
    const lines = lotes.map((lot) => loteCellNode(lot, bg));
    lines.forEach((l, i) => { l.margin = [0, i === 0 ? 2 : 1, 0, i === lines.length - 1 ? 2 : 1]; });
    return { stack: lines, fillColor: bg };
}

function buildProductRows(rows) {
    const body = [];
    sortRows(rows).forEach((r, idx) => {
        const bg  = idx % 2 === 1 ? '#f2f2f2' : '#ffffff';
        const lts = (r.lotes && r.lotes.length) ? r.lotes : [];

        const productStack = [{ text: r.product_name || '', fontSize: 8.5 }];
        if (r.es_antibiotico) {
            productStack.push({
                text: 'BAJO RECETA', fontSize: 5.5, bold: true, margin: [0, 2, 0, 0],
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

function buildSectionTable(sec, fecha) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);

    const titleRow = [
        {
            colSpan: 6, fillColor: '#000', margin: [8, 5, 8, 5],
            columns: [
                { text: `Farmacia Farmalasa  —  ${sec.nombre}`, color: '#fff', bold: true, fontSize: 10.5 },
                { text: `${sec.rows.length} productos   ·   ${totalPacks} packs   ·   ${fecha}`, color: '#fff', fontSize: 7.5, alignment: 'right' },
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
        table: { headerRows: 2, dontBreakRows: true, widths: COL_WIDTHS, body: [titleRow, headerRow, ...bodyRows] },
        layout: {
            hLineWidth:  (i, node) => (i === 0 ? 0 : i === 2 ? 1.2 : i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth:  (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0.5),
            hLineColor:  (i) => (i === 2 ? '#999' : '#ddd'),
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

// Bloque atómico (unbreakable): nunca se divide entre hojas — si no cabe en
// la hoja actual, pdfmake lo mueve completo a la siguiente. Nada de hacks de
// altura mínima que puedan generar una página en blanco.
function buildSignaturesContent(meta = {}) {
    const responsable = meta.responsable || meta.generadoPor || null;
    const fecha        = fmtFechaLarga(new Date());
    const generadoText = meta.generadoPor
        ? [
            { text: 'Generado por: ', fontSize: 8, color: '#333' },
            { text: meta.generadoPor, fontSize: 8, bold: true, color: '#000' },
            { text: `   ·   ${fecha}`, fontSize: 8, color: '#333' },
        ]
        : [{ text: fecha, fontSize: 8, color: '#333' }];

    return {
        unbreakable: true,
        margin: [0, 18, 0, 0],
        stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1.4, lineColor: '#000' }] },
            { text: generadoText, margin: [0, 7, 0, 12] },
            {
                columns: [
                    sigColumn(responsable, 'RESPONSABLE', '28%'),
                    sigColumn(meta.revisor ?? null, 'REVISADO POR', '28%'),
                    sigColumn(null, 'AUTORIZA', '22%'),
                    {
                        width: '22%',
                        table: { widths: ['*'], body: [[
                            { text: 'SELLO', fontSize: 8, color: '#777', alignment: 'center', margin: [0, 16, 0, 16] },
                        ]] },
                        layout: { hLineWidth: () => 1.2, vLineWidth: () => 1.2, hLineColor: () => '#000', vLineColor: () => '#000' },
                    },
                ],
            },
        ],
    };
}

function buildDocDefinition(sections, title, meta) {
    const fecha   = fmtFechaLarga(new Date());
    const content = [];

    sections.forEach((sec, i) => {
        const table = buildSectionTable(sec, fecha);
        if (i > 0) table.pageBreak = 'before';
        content.push(table);
        const footer = buildSectionFooter(sec);
        if (footer) content.push(footer);
    });
    content.push(buildSignaturesContent(meta));

    return {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title },
        defaultStyle: { fontSize: 9 },
        content,
        // Pie de página repetido en cada hoja, dentro del margen inferior
        // (no compite por espacio con el contenido): paginación al centro,
        // firmas de revisado/recibido a los lados.
        footer: (currentPage, pageCount) => ({
            margin: [PAGE_MARGINS[0], 6, PAGE_MARGINS[2], 0],
            columns: [
                { text: 'Revisado por: ________________________', fontSize: 6.5, color: '#555' },
                { text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: '#555', alignment: 'center' },
                { text: 'Recibido por: ________________________', fontSize: 6.5, color: '#555', alignment: 'right' },
            ],
        }),
    };
}

// Genera el PDF real y lo carga en un iframe oculto para disparar el diálogo
// de impresión nativo del visor de PDF del navegador — esto imprime la
// geometría EXACTA del PDF (márgenes, encabezados repetidos, sin cortes),
// sin depender de cómo cada navegador fragmenta HTML al imprimir.
async function printPdf(docDefinition) {
    const blob    = await pdfMake.createPdf(docDefinition).getBlob();
    const blobUrl = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const cleanup = () => {
        iframe.remove();
        URL.revokeObjectURL(blobUrl);
    };

    iframe.onload = () => {
        // El visor de PDF embebido tarda un instante en inicializar tras el
        // evento load del iframe; sin este margen el print() puede disparar
        // antes de que el visor esté listo.
        setTimeout(() => {
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (_) {
                cleanup();
                return;
            }
            try { iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true }); } catch (_) { /* noop */ }
            setTimeout(cleanup, 120_000);
        }, 300);
    };

    iframe.src = blobUrl;
}

function openPrintWindow(sections, title, meta = {}) {
    const docDefinition = buildDocDefinition(sections, title, meta);
    printPdf(docDefinition).catch((err) => console.error('Error generando PDF de pedido:', err));
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

// lotes_asignados (ya persistidos en pedido_items) traen la cantidad tomada de
// cada lote en `take`, en unidades ERP — a diferencia de lotesToDispatch (que
// convierte disponibilidad de bodega en `packs` antes del FEFO). Aquí solo hay
// que reexpresar ese `take` ya asignado en la presentación de despacho.
function lotesAsignadosToDispatch(lotes, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return lotes ?? [];
    return (lotes ?? [])
        .map(l => ({ ...l, take: toDispatch(l.take ?? l.cantidad ?? l.packs ?? 0, erpFactor, dispFactor) }))
        .filter(l => l.take > 0);
}

export function printPerSucursal(grouped, sortedSucIds, getAdjusted, codigoFn, meta = {}) {
    sortedSucIds.forEach((sucId, idx) => {
        setTimeout(() => {
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
            const section = {
                sucId,
                nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
                rows,
                sinCount: g.sinStock.length,
                revCount: g.revision.length,
            };
            const titulo = codigoFn
                ? codigoFn(sucId)
                : `Pedido_${(ERP_NAMES_DEFAULT[sucId] ?? `Sucursal_${sucId}`).replace(/ /g, '_')}`;
            openPrintWindow([section], titulo, meta);
        }, idx * 1000);
    });
}

export function printFromPreview(grouped, sortedSucIds, getAdjusted, title, meta = {}) {
    const sections = sortedSucIds.map(sucId => {
        const g = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
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
            rows:     mapped.filter(r => r.qty > 0),
            sinCount: g.sinStock.length,
            revCount: mapped.filter(r => r.qty === 0).length,
        };
    });
    openPrintWindow(sections, title ?? 'Vista previa del pedido', meta);
}

export function printFromSnapshot(snapshot, meta = {}) {
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
            rows,
            sinCount: g.sinStock.length,
            revCount: 0,
        };
    });
    openPrintWindow(sections, snapshot.nombre ?? 'Borrador guardado', meta);
}

export function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}, titleOverride = null) {
    const fecha = new Date().toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .replace(/\//g, '-');

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
            rows:     printRows,
            sinCount: rows.filter(r => r.sin_stock).length,
            revCount: rows.filter(r => r.revision_minmax && !r.sin_stock).length,
        };
    });

    const title = titleOverride
        ?? (sucGroups.length === 1
            ? `Pedido_${(ERP_NAMES_DEFAULT[sucGroups[0][0]] ?? `Sucursal_${sucGroups[0][0]}`).replace(/ /g, '_')}_${fecha}`
            : `Pedido_#${pedidoNumero}_${fecha}`);

    openPrintWindow(sections, title, meta);
}
