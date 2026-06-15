// ─── Pedido print utility ─────────────────────────────────────────────────────
// Columns: Producto | Laboratorio | Presentación | Lote(s) | Cant. | ✓
// Prints via hidden iframe (no new tab, no URL in page header/footer thanks to
// @page margin:0). Rows sorted by laboratorio + producto. Single signatures
// block at document end with "Generado por".

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

function daysLeft(iso) {
    if (!iso) return null;
    return Math.floor((new Date(iso) - new Date()) / 86_400_000);
}

function venceColor(iso) {
    const d = daysLeft(iso);
    if (d === null) return '#94a3b8';
    if (d < 30) return '#ef4444';
    if (d < 90) return '#f97316';
    return '#16a34a';
}

// Compact lotes: single line with separator, no pill background
function lotesText(lotes) {
    if (!lotes || !lotes.length) return '<span style="color:#cbd5e1;font-size:9px;">—</span>';
    return lotes.map(l => {
        const vence = fmtVence(l.fecha_vencimiento);
        const color = venceColor(l.fecha_vencimiento);
        const parts = [];
        if (l.lote) parts.push(`<b style="color:#475569;">${esc(l.lote)}</b>`);
        if (vence)  parts.push(`<span style="color:${color};">${esc(vence)}</span>`);
        parts.push(`<b style="color:#3b82f6;">${l.take}pk</b>`);
        return `<span style="margin-right:7px;font-size:8px;white-space:nowrap;">${parts.join(' ')}</span>`;
    }).join('');
}

// Sort: laboratorio asc, then producto asc (alphabetical, es locale)
function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (a.laboratorio || '').localeCompare(b.laboratorio || '', 'es')
        || (a.product_name || '').localeCompare(b.product_name || '', 'es')
    );
}

function rowsToHtml(rows) {
    if (!rows.length) {
        return '<tr><td colspan="6" style="text-align:center;color:#94a3b8;font-size:10px;padding:8px 6px;">Sin productos enviados</td></tr>';
    }
    return sortRows(rows).map((r, i) => {
        const bg = i % 2 === 1 ? 'background:#f8fafc;' : '';
        const abBadge = r.es_antibiotico
            ? `<span style="display:inline-block;margin-left:4px;padding:0 4px;border-radius:3px;background:#ede9fe;border:1px solid #c4b5fd;font-size:7px;font-weight:700;color:#6d28d9;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle;line-height:13px;">AB</span>`
            : '';
        const bb = 'border-bottom:1px solid #e2e8f0;';
        // Columnas: Producto | Laboratorio | Cant. | Presentación | Lote(s) | ✓
        return `<tr style="${bg}">
            <td style="${bb}padding:3px 6px;font-size:10px;color:#1e293b;border-right:1px solid #f1f5f9;">${esc(r.product_name)}${abBadge}</td>
            <td style="${bb}padding:3px 5px;font-size:8px;color:#64748b;border-right:1px solid #f1f5f9;">${esc(r.laboratorio) || '—'}</td>
            <td style="${bb}padding:3px 5px;font-size:13px;font-weight:800;color:#1e293b;text-align:center;border-right:1px solid #f1f5f9;">${r.qty}</td>
            <td style="${bb}padding:3px 5px;font-size:8px;color:#64748b;border-right:1px solid #f1f5f9;">${esc(r.presentacion_tipo) || '—'}</td>
            <td style="${bb}padding:3px 5px;font-size:8px;border-right:1px solid #f1f5f9;">${lotesText(r.lotes)}</td>
            <td style="${bb}padding:3px 4px;text-align:center;width:22px;"><span style="display:inline-block;width:12px;height:12px;border:1.5px solid #94a3b8;border-radius:2px;"></span></td>
        </tr>`;
    }).join('');
}

function buildSection(sec, fecha, isLast) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);
    const footerParts = [];
    if (sec.sinCount > 0) footerParts.push(`Sin stock en Bodega: <b>${sec.sinCount} productos</b>`);
    if (sec.revCount > 0) footerParts.push(`Sin asignación (revisar): <b>${sec.revCount}</b>`);
    const footerRow = footerParts.length
        ? `<tr style="background:#fef9c3;"><td colspan="6" style="padding:4px 8px;font-size:9px;color:#92400e;border-top:1.5px solid #fde68a;">${footerParts.join(' &nbsp;·&nbsp; ')}</td></tr>`
        : '';

    // page-break only between sections, never after the last one
    const pageBreak = isLast ? '' : 'page-break-after:always;';

    const TH = 'padding:4px 5px;font-size:8px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;';

    return `
<div style="${pageBreak}margin-bottom:18px;">
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
    <thead>
      <tr style="background:#0052CC;color:white;">
        <th colspan="3" style="padding:7px 10px;font-size:12px;font-weight:700;text-align:left;">
          Farmacia Farmalasa — ${esc(sec.nombre)}
          <span style="font-size:9px;font-weight:400;margin-left:8px;opacity:.85;">${sec.rows.length} producto(s) · ${totalPacks} packs · ${esc(fecha)}</span>
        </th>
        <th colspan="3" style="padding:7px 8px;text-align:right;">
          <span style="font-size:9px;font-weight:700;color:#bfdbfe;">Cant.&nbsp;&nbsp;&nbsp;✓</span>
        </th>
      </tr>
      <tr style="background:#f1f5f9;border-bottom:2px solid #cbd5e1;">
        <th style="${TH}text-align:left;width:38%;">Producto</th>
        <th style="${TH}text-align:left;width:13%;">Laboratorio</th>
        <th style="${TH}text-align:center;width:42px;">Cant.</th>
        <th style="${TH}text-align:left;width:8%;">Presentación</th>
        <th style="${TH}text-align:left;">Lote(s)</th>
        <th style="${TH}text-align:center;width:24px;">✓</th>
      </tr>
    </thead>
    <tbody>
      ${rowsToHtml(sec.rows)}
      ${footerRow}
    </tbody>
  </table>
</div>`;
}

function buildSignatures(meta = {}) {
    const responsable = meta.responsable || meta.generadoPor || null;
    const generadoLine = meta.generadoPor
        ? `<p style="font-size:9px;color:#94a3b8;margin:0 0 6px;">Generado por: <b style="color:#475569;">${esc(meta.generadoPor)}</b> &nbsp;·&nbsp; ${esc(fmtFechaLarga(new Date()))}</p>`
        : '';

    const sigLine = (nombre) => nombre
        ? `<div style="font-size:11px;font-weight:700;color:#1e293b;margin-bottom:6px;">${esc(nombre)}</div>`
        : `<div style="height:36px;"></div>`;

    return `
<div class="sig-block">
  ${generadoLine}
  <table style="width:100%;border-collapse:separate;border-spacing:12px 0;">
    <tr>
      <td style="width:30%;text-align:center;vertical-align:bottom;padding:0 8px;">
        ${sigLine(responsable)}
        <div style="border-top:1.5px solid #334155;padding-top:6px;font-size:10px;font-weight:700;color:#475569;">Responsable</div>
      </td>
      <td style="width:30%;text-align:center;vertical-align:bottom;padding:0 8px;">
        ${sigLine(meta.revisor ?? null)}
        <div style="border-top:1.5px solid #334155;padding-top:6px;font-size:10px;font-weight:700;color:#475569;">Revisado por</div>
      </td>
      <td style="width:20%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:36px;"></div>
        <div style="border-top:1.5px solid #334155;padding-top:6px;font-size:10px;font-weight:700;color:#475569;">Autoriza</div>
      </td>
      <td style="width:20%;vertical-align:bottom;padding:0 8px;">
        <div style="border:1.5px solid #cbd5e1;border-radius:6px;height:56px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#cbd5e1;letter-spacing:.05em;">SELLO</div>
      </td>
    </tr>
  </table>
</div>`;

// Hidden-iframe printing: no new tab, and with @page margin:0 the browser
// omits its header/footer (URL + page numbers) entirely.
function printHtml(html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    iframe.onload = () => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (err) {
            iframe.remove();
            return;
        }
        // Cleanup after the print dialog closes (afterprint isn't reliable cross-browser)
        const cleanup = () => iframe.remove();
        try { iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true }); } catch (err) { /* noop */ }
        setTimeout(cleanup, 120_000);
    };
    iframe.srcdoc = html;
}

function openPrintWindow(sections, title, meta = {}) {
    const fecha = fmtFechaLarga(new Date());

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;}
  @page{size:letter portrait;margin:0;}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:10mm 9mm 52mm;color:#1e293b;background:#fff;}
  thead{display:table-header-group;}
  tr{page-break-inside:avoid;}
  .sig-block{
    position:fixed;
    bottom:10mm;
    left:9mm;
    right:9mm;
    background:#fff;
    border-top:1px solid #e2e8f0;
    padding-top:10px;
    page-break-inside:avoid;
  }
</style>
</head>
<body>
${sections.map((s, i) => buildSection(s, fecha, i === sections.length - 1)).join('')}
${buildSignatures(meta)}
</body>
</html>`;

    printHtml(html);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a function (sucId) => codigo string in the format xx-aabbcc-d-yy.
 * d: 1=solo esa sucursal, 2=varias, 3=todas las sucursales no-bodega.
 */
export function buildPedidoCodigo(numero, date, nSelected) {
    const nn      = String(numero ?? 0).padStart(2, '0');
    const d       = date instanceof Date ? date : new Date();
    const dd      = String(d.getDate()).padStart(2, '0');
    const mm      = String(d.getMonth() + 1).padStart(2, '0');
    const yy      = String(d.getFullYear()).slice(-2);
    const aabbcc  = `${dd}${mm}${yy}`;
    const dist    = nSelected >= TOTAL_NON_BODEGA ? '3' : nSelected > 1 ? '2' : '1';
    return (sucId) => `${nn}-${aabbcc}-${dist}-${SUCURSAL_CODES[sucId] ?? `S${sucId}`}`;
}

/**
 * Prints one PDF window per sucursal, staggered 1 s apart.
 * codigoFn: (sucId) => string — used as the suggested PDF filename.
 */
export function printPerSucursal(grouped, sortedSucIds, getAdjusted, codigoFn, meta = {}) {
    sortedSucIds.forEach((sucId, idx) => {
        setTimeout(() => {
            const g    = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
            const rows = [...g.normal, ...g.revision].map(row => {
                const qty = getAdjusted(row);
                return {
                    product_name:      row.product_name,
                    laboratorio:       row.laboratorio ?? '',
                    presentacion_tipo: row.presentacion_tipo,
                    es_antibiotico:    row.es_antibiotico,
                    qty,
                    lotes: fefoProject(row.lotes_bodega, qty),
                };
            }).filter(r => r.qty > 0);  // excluir sin asignación (sin_stock o revision sin stock)
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
            const qty = getAdjusted(row);
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
            rows:     mapped.filter(r => r.qty > 0),
            sinCount: g.sinStock.length,
            revCount: mapped.filter(r => r.qty === 0).length,
        };
    });
    openPrintWindow(sections, title ?? 'Vista previa del pedido', meta);
}

export function printFromSnapshot(snapshot, meta = {}) {
    const datos = Array.isArray(snapshot.datos) ? snapshot.datos : [];
    const byS = {};
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
                product_name:     row.product_name,
                laboratorio:      row.laboratorio ?? '',
                presentacion_tipo: row.presentacion_tipo,
                es_antibiotico:   row.es_antibiotico,
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
        // Exclude sin_stock rows from the PDF
        const sent = rows.filter(r => !r.sin_stock);
        const printRows = sent.map(r => ({
            product_name:      r.products?.nombre ?? '?',
            laboratorio:       r.products?.laboratorios?.nombre ?? '',
            presentacion_tipo: r.presentaciones?.tipo ?? '',
            es_antibiotico:    r.products?.es_antibiotico ?? false,
            qty:               r.cantidad_asignada ?? 0,
            sin_stock:         false,
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
