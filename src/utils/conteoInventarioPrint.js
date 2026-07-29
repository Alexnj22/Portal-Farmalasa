// ─── Conteo de Inventario print utility ───────────────────────────────────────
// Mismo patrón pdfmake que pedidoPrint.js (headerRows repetido, footer con
// número de página, downloadPdf) pero autocontenido — pedidoPrint.js trae
// lógica específica de despacho/factor que no aplica a un conteo físico.

import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import { exportCsv } from './csvExport';

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

// El ERP separa el stock vencido en su propia área: dos filas del mismo
// producto/lote/fecha que en papel se veían idénticas y nadie sabía cuál era
// cuál. La etiqueta va pegada al lote, que es la columna que se lee al buscar.
function loteCell(item) {
    const marca = item.is_vencidos ? ' · ÁREA VENCIDOS' : '';
    return `${item.lote || '—'}${marca}`;
}

function buildHojaTable(conteo, items, ciego) {
    const headerRow = HOJA_LABELS.map((label, i) => ({
        text: (i === 3 && ciego) ? '' : label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: (i === 2 || i === 3) ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortItems(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        return [
            { ...productCell(item), fillColor: bg },
            { text: loteCell(item), fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
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
        const fisicoTxt = item.fisico_cantidad != null
            ? (item.estado_item === 'SIN_UBICAR' ? '0 (no ubic.)' : String(item.fisico_cantidad))
            : '—';
        return [
            { ...productCell(item), fillColor: bg },
            { text: loteCell(item), fontSize: 7.5, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: String(item.sistema_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
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
const AJU_LABELS = ['Cód. ERP', 'Producto', 'Presentación', 'Lote', 'Vence', 'Sistema', 'Físico', 'Ajuste', 'Valor'];

const esAjuste = (i) => i.diferencia != null && i.diferencia !== 0;
const valorAjuste = (i) => (i.costo_unitario != null ? i.diferencia * Number(i.costo_unitario) : null);

// Orden por código: es como se teclea en el ERP, un renglón tras otro, sin
// tener que buscar el producto por nombre en cada línea.
function sortParaDigitar(items) {
    return [...items].sort((a, b) =>
        (a.erp_product_id ?? 0) - (b.erp_product_id ?? 0)
        || (a.lote || '').localeCompare(b.lote || '', 'es'));
}

function loteAjusteCell(item) {
    const marcas = [];
    if (item.is_vencidos) marcas.push('ÁREA VENCIDOS');
    // sistema 0 y sobrante: en el ERP esto no es ajustar una cantidad, es dar
    // de alta un lote que no existe. Es otro trámite y hay que verlo distinto.
    if (item.es_agregado_manual) marcas.push('ALTA DE LOTE');
    return `${item.lote || '—'}${marcas.length ? ` · ${marcas.join(' · ')}` : ''}`;
}

function buildAjusteSection(titulo, color, fill, items) {
    if (!items.length) return null;
    const totalQty = items.reduce((s, i) => s + i.diferencia, 0);
    const totalVal = items.reduce((s, i) => s + (valorAjuste(i) || 0), 0);

    const headerRow = AJU_LABELS.map((label, i) => ({
        text: label, fillColor: '#e0e0e0', bold: true, fontSize: 7.5, color: '#000',
        alignment: i >= 5 ? 'center' : 'left', margin: [4, 3, 4, 3],
    }));

    const body = sortParaDigitar(items).map((item, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        const val = valorAjuste(item);
        return [
            { text: String(item.erp_product_id ?? '—'), fontSize: 8, bold: true, fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.product_nombre || '—', fontSize: 7.5, fillColor: bg, margin: [4, 3, 4, 3] },
            { text: item.presentacion || '—', fontSize: 7, color: '#555', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: loteAjusteCell(item), fontSize: 7, color: '#333', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: fmtFecha(item.fecha_vencimiento), fontSize: 7, color: '#555', fillColor: bg, alignment: 'center', margin: [4, 3, 4, 3] },
            { text: String(item.sistema_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
            { text: String(item.fisico_cantidad), fontSize: 8, alignment: 'center', fillColor: bg, margin: [4, 3, 4, 3] },
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
            table: { headerRows: 1, dontBreakRows: true, widths: AJU_COL_WIDTHS, body: [headerRow, ...body] },
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
        { text: 'Documento para aplicar en el ERP — el portal no modifica existencias', fontSize: 8, color: '#555', margin: [0, 2, 0, 0] },
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

export function printAjustesConteo(conteo, items) {
    const ajustes = items.filter(esAjuste);
    const faltantes = ajustes.filter((i) => i.diferencia < 0);
    const sobrantes = ajustes.filter((i) => i.diferencia > 0);

    const content = [ajusteHeaderBlock(conteo, faltantes, sobrantes)];

    const aviso = avisoParcialBlock(conteo);
    if (aviso) content.push(aviso);

    if (!ajustes.length) {
        content.push({
            margin: [0, 16, 0, 0],
            text: 'Este conteo no arrojó diferencias: no hay ajuste que aplicar en el ERP.',
            fontSize: 10, bold: true, color: '#059669',
        });
    } else {
        const secFalt = buildAjusteSection('FALTANTES — ajuste de SALIDA en el ERP', '#dc2626', '#fef2f2', faltantes);
        const secSobr = buildAjusteSection('SOBRANTES — ajuste de ENTRADA en el ERP', '#2563eb', '#eff6ff', sobrantes);
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
        footer: footerFirmas('Aplicado en el ERP por', 'Fecha de aplicación'),
    };
    downloadPdf(docDefinition, `Ajuste_ERP_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

// Mismo contenido en CSV: para filtrar, ordenar o cargar en lote si el ERP lo
// admite, sin volver a teclear lo que ya está medido.
export function exportAjustesConteo(conteo, items) {
    const ajustes = sortParaDigitar(items.filter(esAjuste));
    const headers = [
        'Tipo', 'Codigo ERP', 'Codigo barras', 'Producto', 'Laboratorio', 'Presentacion',
        'Lote', 'Vence', 'Area', 'Alta de lote', 'Sistema', 'Fisico', 'Ajuste',
        'Costo unitario', 'Valor ajuste', 'Nota',
    ];
    const rows = ajustes.map((i) => [
        i.diferencia < 0 ? 'FALTANTE' : 'SOBRANTE',
        i.erp_product_id ?? '',
        i.codigo_barras ?? '',
        i.product_nombre ?? '',
        i.laboratorio_nombre ?? '',
        i.presentacion ?? '',
        i.lote ?? '',
        i.fecha_vencimiento ?? '',
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
    exportCsv(headers, rows, `Ajuste_ERP_${suc}_${String(conteo.id).slice(0, 8)}.csv`);
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
            avisoParcialBlock(conteo),
        ].filter(Boolean),
        footer: footerFirmas('Contado por', 'Revisado por'),
    };
    downloadPdf(docDefinition, `Conteo_${(conteo.branches?.name || 'sucursal').replace(/[^a-zA-Z0-9]/g, '_')}_Resultados.pdf`);
}
