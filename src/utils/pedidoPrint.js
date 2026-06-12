// ─── Pedido print utility ─────────────────────────────────────────────────────
// Columns: Producto | Laboratorio | Presentación | Lote(s) | Cant. | ✓
// Compact layout, single signatures block at document end.

const ERP_NAMES_DEFAULT = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES_ORDER = [5, 1, 2, 3, 4, 7];

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
        return `<span style="margin-right:8px;font-size:9px;white-space:nowrap;">${parts.join(' ')}</span>`;
    }).join('');
}

function rowsToHtml(rows) {
    if (!rows.length) {
        return '<tr><td colspan="6" style="text-align:center;color:#94a3b8;font-size:10px;padding:8px 6px;">Sin productos enviados</td></tr>';
    }
    return rows.map((r, i) => {
        const sinStock = r.sin_stock || r.qty === 0;
        const bg = sinStock ? 'background:#fff7ed;opacity:0.7;' : (i % 2 === 1 ? 'background:#f8fafc;' : '');
        const abBadge = r.es_antibiotico
            ? `<span style="display:inline-block;margin-left:4px;padding:0 4px;border-radius:3px;background:#ede9fe;border:1px solid #c4b5fd;font-size:7px;font-weight:700;color:#6d28d9;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle;line-height:14px;">ANTIBIÓTICO</span>`
            : '';
        const ssBadge = sinStock
            ? `<span style="margin-left:4px;font-size:8px;color:#f97316;background:#fff7ed;border:1px solid #fed7aa;padding:0 4px;border-radius:3px;">sin stock</span>`
            : '';
        return `<tr style="${bg}">
            <td style="padding:2px 6px;font-size:10px;color:#1e293b;border-right:1px solid #f1f5f9;">${esc(r.product_name)}${abBadge}${ssBadge}</td>
            <td style="padding:2px 6px;font-size:9px;color:#64748b;border-right:1px solid #f1f5f9;white-space:nowrap;">${esc(r.laboratorio) || '—'}</td>
            <td style="padding:2px 6px;font-size:9px;color:#64748b;border-right:1px solid #f1f5f9;white-space:nowrap;">${esc(r.presentacion_tipo) || '—'}</td>
            <td style="padding:2px 6px;font-size:9px;border-right:1px solid #f1f5f9;">${sinStock ? '' : lotesText(r.lotes)}</td>
            <td style="padding:2px 6px;font-size:12px;font-weight:700;color:${sinStock ? '#f97316' : '#1e293b'};text-align:center;border-right:1px solid #f1f5f9;">${sinStock ? '—' : r.qty}</td>
            <td style="padding:2px 6px;text-align:center;width:22px;"><span style="display:inline-block;width:12px;height:12px;border:1px solid #94a3b8;border-radius:2px;"></span></td>
        </tr>`;
    }).join('');
}

function buildSection(sec, fecha, isLast) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);
    const footerParts = [];
    if (sec.sinCount > 0) footerParts.push(`Sin existencia: <b>${sec.sinCount}</b>`);
    if (sec.revCount > 0) footerParts.push(`A revisar: <b>${sec.revCount}</b>`);
    const footerRow = footerParts.length
        ? `<tr style="background:#fef9c3;"><td colspan="6" style="padding:3px 6px;font-size:9px;color:#92400e;border-top:1px solid #fde68a;">${footerParts.join(' &nbsp;·&nbsp; ')}</td></tr>`
        : '';

    // A2: page-break only between sections, never after the last one
    const pageBreak = isLast ? '' : 'page-break-after:always;';

    return `
<div style="${pageBreak}margin-bottom:20px;">
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
    <thead>
      <tr style="background:#0052CC;color:white;">
        <th colspan="4" style="padding:6px 10px;font-size:12px;font-weight:700;text-align:left;">
          Farmacia Farmalasa — ${esc(sec.nombre)}
          <span style="font-size:9px;font-weight:400;margin-left:8px;opacity:.85;">${sec.rows.length} producto(s) · ${totalPacks} packs · ${esc(fecha)}</span>
        </th>
        <th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:#bfdbfe;">Cant.</th>
        <th style="padding:6px 10px;font-size:10px;font-weight:700;text-align:center;color:#bfdbfe;">✓</th>
      </tr>
      <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:30%;">Producto</th>
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:14%;">Laboratorio</th>
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:10%;">Presentación</th>
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;">Lote(s)</th>
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:center;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:44px;">Cant.</th>
        <th style="padding:3px 6px;font-size:9px;font-weight:700;text-align:center;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:28px;">✓</th>
      </tr>
    </thead>
    <tbody>
      ${rowsToHtml(sec.rows)}
      ${footerRow}
    </tbody>
  </table>
</div>`;
}

// Always rendered — even without responsable/revisor the sheet needs
// signature lines and the Sello box for physical reception.
function buildSignatures(meta = {}) {
    const sigCell = (nombre, label) => {
        const nameHtml = nombre
            ? `<div style="font-size:11px;font-weight:700;color:#1e293b;margin-bottom:4px;">${esc(nombre)}</div>`
            : '<div style="height:20px;"></div>';
        return `<td style="border-top:1px solid #334155;padding-top:5px;text-align:center;font-size:10px;color:#475569;width:25%;">${nameHtml}${label}</td>`;
    };
    return `
<table class="sig-block" style="width:100%;border-collapse:collapse;margin-top:28px;">
  <tr>
    ${sigCell(meta.responsable ?? null, 'Responsable')}
    ${sigCell(meta.revisor    ?? null, 'Revisado por')}
    <td style="border-top:1px solid #334155;padding-top:5px;text-align:center;font-size:10px;color:#475569;width:25%;"><div style="height:20px;"></div>Autoriza</td>
    <td style="border:1px solid #334155;padding:18px 10px;text-align:center;font-size:10px;color:#475569;width:25%;">Sello</td>
  </tr>
</table>`;
}

function openPrintWindow(sections, title, meta = {}) {
    const fecha      = fmtFechaLarga(new Date());
    const totalPks   = sections.reduce((t, s) => t + s.rows.reduce((rt, r) => rt + r.qty, 0), 0);
    const totalProds = sections.reduce((t, s) => t + s.rows.length, 0);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;}
  @page{size:letter portrait;margin:10mm 9mm;}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:12px;color:#1e293b;background:#fff;}
  thead{display:table-header-group;}
  tr{page-break-inside:avoid;}
  .sig-block{page-break-inside:avoid;}
  @media print{
    body{padding:0;}
    .no-print{display:none!important;}
  }
</style>
</head>
<body>
<div class="no-print" style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#0052CC;color:#fff;border-radius:8px;margin-bottom:14px;">
  <div>
    <span style="font-size:14px;font-weight:700;">📦 ${esc(title)}</span>
    <span style="font-size:10px;opacity:.8;margin-left:10px;">${sections.length} sucursal(es) · ${totalProds} productos · ${totalPks} packs</span>
  </div>
  <button onclick="window.print()" style="background:#fff;color:#0052CC;border:none;padding:6px 16px;border-radius:6px;font-weight:700;cursor:pointer;font-size:11px;">🖨 Imprimir</button>
</div>
${sections.map((s, i) => buildSection(s, fecha, i === sections.length - 1)).join('')}
${buildSignatures(meta)}
<script>window.print();<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
        URL.revokeObjectURL(url);
        alert('El navegador bloqueó la ventana de impresión.\nPermite ventanas emergentes para este sitio e intenta de nuevo.');
        return;
    }
    win.addEventListener('unload', () => URL.revokeObjectURL(url), { once: true });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function printFromPreview(grouped, sortedSucIds, getAdjusted, title, meta = {}) {
    const sections = sortedSucIds.map(sucId => {
        const g = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const rows = [...g.normal, ...g.revision].map(row => {
            const qty = getAdjusted(row);
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
            revCount: g.revision.length,
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

export function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}) {
    const sections = sucGroups.map(([sucId, rows]) => {
        const printRows = rows
            .map(r => ({
                product_name:     r.products?.nombre ?? '?',
                laboratorio:      r.products?.laboratorios?.nombre ?? '',
                presentacion_tipo: r.presentaciones?.tipo ?? '',
                es_antibiotico:   r.products?.es_antibiotico ?? false,
                qty:              r.cantidad_asignada ?? 0,
                sin_stock:        r.sin_stock ?? false,
                lotes:            Array.isArray(r.lotes_asignados) ? r.lotes_asignados : [],
            }));
        return {
            sucId,
            nombre:   ERP_NAMES_DEFAULT[sucId] ?? `Sucursal ${sucId}`,
            rows:     printRows,
            sinCount: rows.filter(r => r.sin_stock).length,
            revCount: rows.filter(r => r.revision_minmax && !r.sin_stock).length,
        };
    });
    openPrintWindow(sections, `Pedido #${pedidoNumero}`, meta);
}
