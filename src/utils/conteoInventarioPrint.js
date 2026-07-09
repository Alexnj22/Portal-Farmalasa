// ─── Conteo de Inventario print utility ───────────────────────────────────────
// Mismo patrón pdfmake que pedidoPrint.js (headerRows repetido, footer con
// número de página, downloadPdf) pero autocontenido — pedidoPrint.js trae
// lógica específica de despacho/factor que no aplica a un conteo físico.

import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';

pdfMake.addVirtualFileSystem(vfsFonts);

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
function sortItems(items) {
    return [...items].sort((a, b) =>
        (a.laboratorio_nombre || '').localeCompare(b.laboratorio_nombre || '', 'es')
        || (a.product_nombre || '').localeCompare(b.product_nombre || '', 'es')
        || (a.lote || '').localeCompare(b.lote || '', 'es')
    );
}

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
const HOJA_COL_WIDTHS = ['26%', '18%', '11%', '11%', '10%', '24%'];
const HOJA_LABELS = ['Producto', 'Lote', 'Vence', 'Sistema', 'Físico', 'Nota'];

function buildHojaTable(conteo, items, ciego) {
    const headerRow = HOJA_LABELS.map((label, i) => ({
        text: (i === 3 && ciego) ? '' : label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: (i === 2 || i === 3) ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortItems(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        return [
            { ...productCell(item), fillColor: bg },
            { text: item.lote || '—', fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: fmtFecha(item.fecha_vencimiento), fontSize: 7.5, color: '#333', fillColor: bg, alignment: 'center', margin: [4, 3, 4, 3] },
            ciego
                ? { text: '', fillColor: bg }
                : { text: String(item.sistema_cantidad), fontSize: 8.5, bold: true, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: '', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: '', fillColor: bg, margin: [4, 3, 4, 3] },
        ];
    });

    return {
        table: { headerRows: 1, dontBreakRows: true, widths: HOJA_COL_WIDTHS, body: [headerRow, ...body] },
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

function downloadPdf(docDefinition, filename) {
    pdfMake.createPdf(docDefinition).download(filename);
}

// items: filas de get_conteo_items_jsonb. ciego=true oculta la columna Sistema.
export function printHojaConteo(conteo, items, { ciego = false } = {}) {
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
    downloadPdf(docDefinition, `Conteo_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}_Hoja.pdf`);
}

// ── Reporte de resultados ────────────────────────────────────────────────────
const RES_COL_WIDTHS = ['24%', '15%', '9%', '9%', '9%', '9%', '25%'];
const RES_LABELS = ['Producto', 'Lote', 'Sistema', 'Físico', 'Dif.', 'Valor', 'Nota'];

function buildResultadosTable(items) {
    const headerRow = RES_LABELS.map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: (i >= 2 && i <= 5) ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortItems(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        const dif = item.diferencia;
        const valor = dif != null && item.costo_unitario != null ? dif * item.costo_unitario : null;
        const difColor = dif == null ? '#999' : dif === 0 ? '#059669' : dif < 0 ? '#dc2626' : '#2563eb';
        return [
            { ...productCell(item), fillColor: bg },
            { text: item.lote || '—', fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: String(item.sistema_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.fisico_cantidad != null ? String(item.fisico_cantidad) : '—', fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
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
    return {
        margin: [0, 10, 0, 0],
        table: {
            widths: ['*', '*', '*', '*', '*'],
            body: [[
                { text: `${items.length} ítems`, fontSize: 8, bold: true, fillColor: '#f0f0f0', margin: [6, 4, 6, 4] },
                { text: `${conDiferencia} con diferencia`, fontSize: 8, bold: true, fillColor: '#f0f0f0', margin: [6, 4, 6, 4] },
                { text: `${sinContar} sin contar`, fontSize: 8, bold: true, color: '#92400e', fillColor: '#fffbeb', margin: [6, 4, 6, 4] },
                { text: `Faltante: ${fmtMoney(conteo.valor_faltante)}`, fontSize: 8, bold: true, color: '#dc2626', fillColor: '#fef2f2', margin: [6, 4, 6, 4] },
                { text: `Sobrante: ${fmtMoney(conteo.valor_sobrante)}`, fontSize: 8, bold: true, color: '#2563eb', fillColor: '#eff6ff', margin: [6, 4, 6, 4] },
            ]],
        },
        layout: 'noBorders',
    };
}

// items: filas de get_conteo_items_jsonb. soloDiferencias filtra antes de imprimir.
export function printResultadosConteo(conteo, items, { soloDiferencias = false } = {}) {
    const filtered = soloDiferencias ? items.filter((i) => i.diferencia != null && i.diferencia !== 0) : items;
    const docDefinition = {
        pageSize: 'LETTER',
        pageMargins: PAGE_MARGINS,
        info: { title: `Resultados de Conteo — ${conteo.branches?.name || ''}` },
        defaultStyle: { fontSize: 9 },
        content: [
            headerBlock(conteo, `Reporte de resultados${soloDiferencias ? ' (solo diferencias)' : ''}`),
            buildResultadosTable(filtered),
            buildTotalesBlock(conteo, items),
        ],
        footer: footerFirmas('Contado por', 'Revisado por'),
    };
    downloadPdf(docDefinition, `Conteo_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}_Resultados.pdf`);
}
