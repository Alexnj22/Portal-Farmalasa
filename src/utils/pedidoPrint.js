// ─── Pedido print utility ────────────────────────────────────────────────────
// Generates a print window matching the format of the GAS PDF document.
// Columns: Producto | Presentación | Lote(s) | Cant.
// Supports: preview data, saved snapshots, and historical pedido_items.

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

function lotesHtml(lotes) {
    if (!lotes || !lotes.length) return '<span style="color:#cbd5e1;font-size:10px;">—</span>';
    return lotes.map(l => {
        const vence = fmtVence(l.fecha_vencimiento);
        const color = venceColor(l.fecha_vencimiento);
        return `<span style="display:inline-flex;align-items:center;gap:3px;margin:1px 2px;padding:1px 6px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:9px;font-size:9px;white-space:nowrap;">` +
            `<b style="color:#475569;">${esc(l.lote) || '—'}</b>` +
            (vence ? `<span style="color:${color};">${esc(vence)}</span>` : '') +
            `<span style="color:#3b82f6;font-weight:700;">${l.take}pk</span>` +
            `</span>`;
    }).join('');
}

function rowsToHtml(rows) {
    if (!rows.length) {
        return '<tr><td colspan="4" style="text-align:center;color:#94a3b8;font-size:11px;padding:10px 8px;">Sin productos enviados</td></tr>';
    }
    return rows.map((r, i) => {
        const sinStock = r.sin_stock || r.qty === 0;
        const bg = sinStock ? 'background:#fff7ed;opacity:0.7;' : (i % 2 === 1 ? 'background:#f8fafc;' : '');
        const abBadge = r.es_antibiotico
            ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#ede9fe;border:1px solid #c4b5fd;font-size:8px;font-weight:700;color:#7c3aed;margin-left:3px;vertical-align:middle;">AB</span>`
            : '';
        const ssBadge = sinStock
            ? `<span style="margin-left:4px;font-size:8px;color:#f97316;background:#fff7ed;border:1px solid #fed7aa;padding:0 4px;border-radius:4px;">sin stock</span>`
            : '';
        return `<tr style="${bg}">
            <td style="padding:4px 8px;font-size:11px;color:#1e293b;border-right:1px solid #f1f5f9;">${esc(r.product_name)}${abBadge}${ssBadge}</td>
            <td style="padding:4px 8px;font-size:10px;color:#64748b;border-right:1px solid #f1f5f9;white-space:nowrap;">${esc(r.presentacion_tipo) || '—'}</td>
            <td style="padding:4px 8px;font-size:10px;border-right:1px solid #f1f5f9;">${sinStock ? '' : lotesHtml(r.lotes)}</td>
            <td style="padding:4px 8px;font-size:13px;font-weight:700;color:${sinStock ? '#f97316' : '#1e293b'};text-align:center;">${sinStock ? '—' : r.qty}</td>
        </tr>`;
    }).join('');
}

function buildSection(sec, fecha, meta = {}) {
    const totalPacks = sec.rows.reduce((t, r) => t + r.qty, 0);
    const footerParts = [];
    if (sec.sinCount > 0) footerParts.push(`Productos sin existencia en bodega: <b>${sec.sinCount}</b>`);
    if (sec.revCount > 0) footerParts.push(`A revisar min/max: <b>${sec.revCount}</b>`);
    const footerRow = footerParts.length
        ? `<tr style="background:#fef9c3;"><td colspan="4" style="padding:5px 8px;font-size:10px;color:#92400e;border-top:1px solid #fde68a;">${footerParts.join(' &nbsp;·&nbsp; ')}</td></tr>`
        : '';

    const sigCell = (nombre, label) => {
        const nameHtml = nombre
            ? `<div style="font-size:11px;font-weight:700;color:#1e293b;margin-bottom:3px;">${esc(nombre)}</div>`
            : '<div style="height:18px;"></div>';
        return `<td style="border-top:1px solid #334155;padding-top:4px;text-align:center;font-size:10px;color:#475569;width:25%;">${nameHtml}${label}</td>`;
    };

    return `
<div style="page-break-after:always;margin-bottom:32px;">
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:10px;">
    <thead>
      <tr style="background:#0052CC;color:white;">
        <th colspan="3" style="padding:9px 12px;font-size:13px;font-weight:700;text-align:left;">
          Destino: Farmacia Farmalasa — ${esc(sec.nombre)}
        </th>
        <th style="padding:9px 12px;font-size:11px;font-weight:400;text-align:right;white-space:nowrap;">${esc(fecha)}</th>
      </tr>
      <tr style="background:#eff6ff;">
        <th colspan="4" style="padding:4px 12px;font-size:10px;color:#2563eb;text-align:left;font-weight:400;">
          Origen: Bodega Central &nbsp;·&nbsp; ${sec.rows.length} producto(s) &nbsp;·&nbsp; ${totalPacks} packs
        </th>
      </tr>
      <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
        <th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:36%;">Producto</th>
        <th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:13%;">Presentación</th>
        <th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.05em;">Lote(s)</th>
        <th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:center;color:#475569;text-transform:uppercase;letter-spacing:.05em;width:56px;">Cant.</th>
      </tr>
    </thead>
    <tbody>
      ${rowsToHtml(sec.rows)}
      ${footerRow}
    </tbody>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-top:24px;">
    <tr>
      ${sigCell(meta.responsable ?? null, 'Responsable')}
      ${sigCell(meta.revisor    ?? null, 'Revisa')}
      <td style="border-top:1px solid #334155;padding-top:4px;text-align:center;font-size:10px;color:#475569;width:25%;"><div style="height:18px;"></div>Autoriza</td>
      <td style="border:1px solid #334155;padding:20px 12px;text-align:center;font-size:10px;color:#475569;width:25%;">Sello</td>
    </tr>
  </table>
</div>`;
}

function openPrintWindow(sections, title, meta = {}) {
    const fecha     = fmtFechaLarga(new Date());
    const totalPks  = sections.reduce((t, s) => t + s.rows.reduce((rt, r) => rt + r.qty, 0), 0);
    const totalProds = sections.reduce((t, s) => t + s.rows.length, 0);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:16px;color:#1e293b;background:#fff;}
  @media print{body{padding:4px;}.no-print{display:none!important;}}
</style>
</head>
<body>
<div class="no-print" style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#0052CC;color:#fff;border-radius:8px;margin-bottom:18px;">
  <div>
    <span style="font-size:15px;font-weight:700;">📦 ${esc(title)}</span>
    <span style="font-size:11px;opacity:.8;margin-left:12px;">${sections.length} sucursal(es) · ${totalProds} productos · ${totalPks} packs</span>
  </div>
  <button onclick="window.print()" style="background:#fff;color:#0052CC;border:none;padding:8px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">🖨 Imprimir</button>
</div>
${sections.map(s => buildSection(s, fecha, meta)).join('')}
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

export function printFromPreview(grouped, sortedSucIds, getAdjusted, title) {
    const sections = sortedSucIds.map(sucId => {
        const g = grouped[sucId] || { normal: [], revision: [], sinStock: [] };
        const rows = [...g.normal, ...g.revision].map(row => {
            const qty = getAdjusted(row);
            return {
                product_name:     row.product_name,
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
    openPrintWindow(sections, title ?? 'Vista previa del pedido');
}

export function printFromSnapshot(snapshot) {
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
    openPrintWindow(sections, snapshot.nombre ?? 'Borrador guardado');
}

export function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}) {
    const sections = sucGroups.map(([sucId, rows]) => {
        const printRows = rows
            .map(r => ({
                product_name:     r.products?.nombre ?? '?',
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
