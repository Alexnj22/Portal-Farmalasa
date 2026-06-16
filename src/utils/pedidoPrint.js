// ─── Pedido print utility ─────────────────────────────────────────────────────
// B&W optimized. Blob URL + @page margin:0 eliminates browser header/footer.
// Real <table><thead> layout: thead repeats natively on every printed page (Chrome),
// no manual row-counting needed. break-inside:avoid on <tr> keeps rows intact.
// qty is always in PACKS (cajas/frascos/blisters), not units.

const ERP_NAMES_DEFAULT = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES_ORDER   = [5, 1, 2, 3, 4, 7];
const SUCURSAL_CODES     = { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'S4', 5: 'PO', 6: 'BO', 7: 'S5' };
const TOTAL_NON_BODEGA   = 6;

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

// Una sola línea por lote (sin stack vertical) — la fila completa de la tabla es el lote.
function loteCellHtml(lot) {
    if (!lot) return '<span style="font-size:9px;color:#999;">—</span>';
    const count = lot.take ?? lot.cantidad ?? lot.packs ?? '?';
    const vence = fmtVence(lot.fecha_vencimiento);
    const parts = [];
    if (lot.lote) parts.push(`<b>${esc(lot.lote)}</b>`);
    if (vence)  parts.push(`<i>${esc(vence)}</i>`);
    parts.push(`<b>${count}pk</b>`);
    return `<span style="font-size:8.5px;word-break:break-word;">${parts.join('&nbsp;·&nbsp;')}</span>`;
}

function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (a.laboratorio || '').localeCompare(b.laboratorio || '', 'es')
        || (a.product_name || '').localeCompare(b.product_name || '', 'es')
    );
}

// Tabla real con <thead>: el navegador repite el encabezado en cada hoja impresa
// automáticamente (sin contar filas a mano). Orden: Laboratorio, Producto,
// Presentación, Cantidad, Lote, Check.
const COLGROUP = `<colgroup>
  <col style="width:16%"><col style="width:31%"><col style="width:13%"><col style="width:9%"><col style="width:25%"><col style="width:6%">
</colgroup>`;
const TH_S = 'padding:3px 5px;font-size:7.5px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid #bbb;overflow:hidden;text-align:left;vertical-align:middle;';
const TD_S = 'padding:2px 5px;border-right:1px solid #ddd;font-size:9px;word-break:break-word;overflow:hidden;min-height:16px;text-align:left;vertical-align:middle;';
const BADGE_AB    = 'display:inline-block;margin-left:4px;padding:1px 4px;border:1.3px solid #000;border-radius:2px;font-size:6.5px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;vertical-align:middle;line-height:1.3;';
const BADGE_REGLA = 'display:inline-block;margin-left:4px;width:11px;height:11px;border:1.3px solid #000;border-radius:50%;font-size:7px;font-weight:800;line-height:11px;text-align:center;vertical-align:middle;';

function colHeaderHtml() {
    return `<thead><tr style="background:#e0e0e0;border-bottom:2px solid #999;">
  <th style="${TH_S}">Laboratorio</th>
  <th style="${TH_S}">Producto</th>
  <th style="${TH_S}">Presentación</th>
  <th style="${TH_S}text-align:center;">Cant.</th>
  <th style="${TH_S}">Lote</th>
  <th style="${TH_S}border-right:none;text-align:center;">✓</th>
</tr></thead>`;
}

// Un producto con varios lotes genera varias filas (una por lote), por fila completa
// en lugar de apilarlas dentro de una sola celda. Lab/Producto/Presentación/Cant solo
// se imprimen en la primera fila; las filas de continuación quedan vacías ahí.
function productRowsHtml(r, idx) {
    const bg        = idx % 2 === 1 ? 'background:#f2f2f2;' : 'background:#fff;';
    const abBadge   = r.es_antibiotico ? `<span style="${BADGE_AB}">Bajo Receta</span>` : '';
    const reglaBadge = r.tiene_regla ? `<span style="${BADGE_REGLA}" title="Regla de despacho aplicada">R</span>` : '';
    const lts = (r.lotes && r.lotes.length) ? r.lotes : [null];

    return lts.map((lot, li) => {
        const first      = li === 0;
        const rowBorder  = first ? 'border-top:1px solid #ccc;' : 'border-top:1px dashed #ddd;';
        return `<tr style="${bg}${rowBorder}break-inside:avoid;page-break-inside:avoid;">
  <td style="${TD_S}font-size:8px;color:#333;">${first ? (esc(r.laboratorio) || '—') : ''}</td>
  <td style="${TD_S}font-size:9.5px;">${first ? `${esc(r.product_name)}${abBadge}${reglaBadge}` : ''}</td>
  <td style="${TD_S}font-size:8px;color:#333;">${first ? (esc(r.presentacion_tipo) || '—') : ''}</td>
  <td style="${TD_S}text-align:center;font-size:11px;font-weight:700;">${first ? r.qty : ''}</td>
  <td style="${TD_S}">${loteCellHtml(lot)}</td>
  <td style="${TD_S}border-right:none;text-align:center;"><span style="display:inline-block;width:11px;height:11px;border:1.5px solid #555;border-radius:2px;"></span></td>
</tr>`;
    }).join('');
}

function buildSection(sec, fecha, isLast) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);
    const pageBreak  = isLast ? '' : 'break-after:page;page-break-after:always;';

    const footerParts = [];
    if (sec.sinCount > 0) footerParts.push(`Sin stock en Bodega: <b>${sec.sinCount} producto(s)</b>`);
    if (sec.revCount  > 0) footerParts.push(`Sin asignación (revisar): <b>${sec.revCount}</b>`);
    const footer = footerParts.length
        ? `<div style="padding:4px 8px;font-size:9px;color:#000;background:#ebebeb;border-top:2px dashed #888;">${footerParts.join('&nbsp;·&nbsp;')}</div>`
        : '';

    const bodyRows = sec.rows.length
        ? sortRows(sec.rows).map((r, i) => productRowsHtml(r, i)).join('')
        : `<tr><td colspan="6" style="padding:10px;text-align:center;font-size:10px;color:#555;">Sin productos para esta sucursal</td></tr>`;

    return `
<div style="${pageBreak}margin-bottom:10px;">
  <div style="width:100%;border:1px solid #999;border-bottom:none;">
    <div style="background:#000;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:5px 10px;">
      <span style="font-size:11.5px;font-weight:700;letter-spacing:.01em;">Farmacia Farmalasa &mdash; ${esc(sec.nombre)}</span>
      <span style="font-size:9px;font-weight:400;white-space:nowrap;">${sec.rows.length} productos &nbsp;·&nbsp; ${totalPacks} packs &nbsp;·&nbsp; ${esc(fecha)}</span>
    </div>
    <table style="width:100%;table-layout:fixed;border-collapse:collapse;">
      ${COLGROUP}
      ${colHeaderHtml()}
      <tbody>${bodyRows}</tbody>
    </table>
    ${footer}
  </div>
</div>`;
}

function buildSignatures(meta = {}) {
    const responsable  = meta.responsable || meta.generadoPor || null;
    const generadoLine = meta.generadoPor
        ? `<p style="font-size:8.5px;color:#333;margin:0 0 8px;">Generado por: <b style="color:#000;">${esc(meta.generadoPor)}</b>&nbsp; · &nbsp;${esc(fmtFechaLarga(new Date()))}</p>`
        : `<p style="font-size:8.5px;color:#333;margin:0 0 8px;">${esc(fmtFechaLarga(new Date()))}</p>`;

    const nameLine = (nombre) => nombre
        ? `<div style="font-size:10px;font-weight:700;color:#000;margin-bottom:4px;">${esc(nombre)}</div>`
        : `<div style="height:28px;"></div>`;

    return `
<div class="sig-block">
  ${generadoLine}
  <table style="width:100%;border-collapse:separate;border-spacing:10px 0;">
    <tbody>
    <tr>
      <td style="width:28%;text-align:center;vertical-align:bottom;padding:0 4px;">
        ${nameLine(responsable)}
        <div style="border-top:1.5px solid #000;padding-top:5px;font-size:9px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.05em;">Responsable</div>
      </td>
      <td style="width:28%;text-align:center;vertical-align:bottom;padding:0 4px;">
        ${nameLine(meta.revisor ?? null)}
        <div style="border-top:1.5px solid #000;padding-top:5px;font-size:9px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.05em;">Revisado por</div>
      </td>
      <td style="width:22%;text-align:center;vertical-align:bottom;padding:0 4px;">
        <div style="height:28px;"></div>
        <div style="border-top:1.5px solid #000;padding-top:5px;font-size:9px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.05em;">Autoriza</div>
      </td>
      <td style="width:22%;vertical-align:bottom;padding:0 4px;">
        <div style="border:1.5px solid #000;border-radius:5px;height:52px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#555;letter-spacing:.08em;text-transform:uppercase;">Sello</div>
      </td>
    </tr>
    </tbody>
  </table>
</div>`;
}

// Blob URL: browser shows <title> instead of "about:srcdoc".
// @page margin:0: removes ALL browser header/footer (URL, page numbers, date).
function printHtml(html) {
    const blob    = new Blob([html], { type: 'text/html;charset=utf-8' });
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
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (_) {
            cleanup();
            return;
        }
        try { iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true }); } catch (_) { /* noop */ }
        setTimeout(cleanup, 120_000);
    };

    iframe.src = blobUrl;
}

function openPrintWindow(sections, title, meta = {}) {
    const fecha = fmtFechaLarga(new Date());

    const last = sections.length ? sections[sections.length - 1] : null;
    const head = sections.length > 1
        ? sections.slice(0, -1).map(s => buildSection(s, fecha, false)).join('\n')
        : '';
    const lastHtml = last ? buildSection(last, fecha, true) : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  @page{size:letter portrait;margin:0;}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;font-size:10px;padding:10mm 9mm 12mm;}
  table{border-collapse:collapse;}
  td,th{vertical-align:bottom;}
  .sig-block{
    margin-top:20px;
    padding-top:10px;
    border-top:2px solid #000;
    page-break-inside:avoid;
    break-inside:avoid;
    break-before:avoid;
  }
</style>
</head>
<body>
${head}
<div style="display:flex;flex-direction:column;min-height:calc(100vh - 14mm);">
  ${lastHtml}
  <div style="flex:1 0 auto;"></div>
  ${buildSignatures(meta)}
</div>
</body>
</html>`;

    printHtml(html);
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
                    tiene_regla:       !!row.tiene_regla_despacho,
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
                tiene_regla:       !!row.tiene_regla_despacho,
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
                tiene_regla:       !!row.tiene_regla_despacho,
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
        const sent = rows.filter(r => !r.sin_stock);
        const printRows = sent.map(r => ({
            product_name:      r.products?.nombre ?? '?',
            laboratorio:       r.products?.laboratorios?.nombre ?? '',
            presentacion_tipo: r.presentaciones?.tipo ?? '',
            es_antibiotico:    r.products?.es_antibiotico ?? false,
            tiene_regla:       false,
            qty:               r.cantidad_asignada ?? 0,
            // lotes_asignados from DB may have {cantidad} or {packs} instead of {take}
            lotes:             Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
        }));
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
