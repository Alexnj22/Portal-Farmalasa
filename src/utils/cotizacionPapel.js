// El papel de una cotización: el HTML que el portal abre para imprimir y que la
// app convierte en PDF para compartir. Vivía en `views/CotizacionesView.jsx`;
// se mudó para que los dos papeles sean el MISMO. Lleva colores fijos a
// propósito: el papel no tiene tema (excepción declarada en el design-gate).
import { formatMoney, formatQty } from './formatNumber';
import { fechaTexto } from './fecha';
import { desgloseConIva, totalesDeCotizacion } from './cotizacion';

const fmt    = (n) => formatMoney(n || 0);
const fmtD   = (d) => d ? fechaTexto(d, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// Auditoría 2026-07 Fase 3: escapa texto libre/de negocio antes de interpolarlo
// en el HTML crudo de impresión (document.write) — mismo patrón ya usado en
// FormNovedad.jsx. Sin esto, un customer_name/notes con HTML/script se
// ejecutaba en la ventana de impresión (misma origin que la app).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const buildPrintHTML = (cot, itemsArr, branchName) => {
    const applies = cot.applies_retention;
    // La misma cuenta que la pantalla (antes era una segunda copia escrita a mano).
    const { base, iva, retention: ret, total } = totalesDeCotizacion(itemsArr, applies);
    const isCCF   = cot.document_type === 'CCF';

    const lineRows = itemsArr.map((it, i) => {
        const dsg = desgloseConIva(parseFloat(it.precio_unitario || 0), parseFloat(it.cantidad || 1));
        return `
        <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:7px 5px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
            <td style="padding:7px 5px;font-size:12px;font-weight:600;">${esc(it.product_nombre)}</td>
            <td style="padding:7px 5px;text-align:center;font-size:11px;color:#374151;">${it.presentacion_desc || '—'}</td>
            <td style="padding:7px 5px;text-align:center;font-size:12px;">${formatQty(it.cantidad, { decimalesMax: 3 })}</td>
            ${isCCF ? `
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.unitSinIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.subtotalSinIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.subtotalIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(dsg.total)}</td>
            ` : `
            <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(it.precio_unitario)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(it.subtotal)}</td>
            `}
        </tr>`;
    }).join('');

    const headers = isCCF
        ? `<th style="text-align:center;width:30px;">#</th><th>Producto</th><th style="text-align:center;">Pres.</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P.Unit s/IVA</th><th style="text-align:right;">Subtotal s/IVA</th><th style="text-align:right;">IVA 13%</th><th style="text-align:right;">Total</th>`
        : `<th style="text-align:center;width:30px;">#</th><th>Producto</th><th style="text-align:center;">Pres.</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P.Unitario</th><th style="text-align:right;">Subtotal</th>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>${esc(cot.numero)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;color:#111827;background:#fff;font-size:12px}
  @page{size:letter;margin:14mm 12mm 18mm 12mm}
  .page{width:100%;max-width:740px;margin:0 auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:3px solid #1d4ed8;margin-bottom:16px}
  .brand{font-size:20px;font-weight:900;color:#1d4ed8;letter-spacing:-0.5px}
  .brand-sub{font-size:11px;color:#6b7280;margin-top:2px}
  .cot-num{font-size:18px;font-weight:900;color:#1d4ed8}
  .meta{display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap}
  .meta-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;min-width:130px}
  .meta-title{font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;font-weight:700;margin-bottom:3px}
  .meta-value{font-size:12px;font-weight:700;color:#1e293b}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1d4ed8;color:#fff;padding:8px 5px;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;text-align:left}
  tbody tr:nth-child(even){background:#f8fafc}
  .totals{width:${isCCF ? '380' : '280'}px;margin-left:auto;margin-top:10px;border-top:2px solid #e2e8f0}
  .totals td{padding:4px 6px;font-size:12px}
  .totals .grand td{font-size:14px;font-weight:900;color:#1d4ed8;border-top:2px solid #1d4ed8;padding-top:7px}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase}
  .badge-ccf{background:#dbeafe;color:#1d4ed8}
  .badge-cof{background:#f0fdf4;color:#15803d}
  .footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end}
  .sign-line{text-align:center;border-top:1px solid #374151;padding-top:4px;font-size:10px;color:#374151;min-width:140px}
  .footer-note{font-size:10px;color:#9ca3af;max-width:300px}
  .notes-box{margin-top:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:5px;padding:8px 12px;font-size:11px;color:#92400e}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div>
      <div class="brand">FARMACIA LA SALUD</div>
      <div class="brand-sub">${esc(branchName || 'La Popular')}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af">Cotización</div>
      <div class="cot-num">${esc(cot.numero)}</div>
      <div style="font-size:11px;color:#374151;margin-top:3px">${fmtD(cot.fecha)}</div>
    </div>
  </div>
  <div class="meta">
    <div class="meta-block" style="flex:2">
      <div class="meta-title">Cliente</div>
      <div class="meta-value">${esc(cot.customer_name)}</div>
      ${cot.customer_nit ? `<div style="font-size:10px;color:#64748b">NIT: ${esc(cot.customer_nit)}</div>` : ''}
    </div>
    <div class="meta-block">
      <div class="meta-title">Documento</div>
      <div class="meta-value"><span class="badge ${cot.document_type === 'CCF' ? 'badge-ccf' : 'badge-cof'}">${cot.document_type}</span></div>
    </div>
    <div class="meta-block">
      <div class="meta-title">Forma de pago</div>
      <div class="meta-value">${{EFECTIVO:'Efectivo',TARJETA:'Tarjeta',TRANSFERENCIA:'Transferencia',CHEQUE:'Cheque'}[cot.payment_type]||cot.payment_type}</div>
    </div>
    ${cot.created_by_name ? `<div class="meta-block"><div class="meta-title">Preparado por</div><div class="meta-value">${esc(cot.created_by_name)}</div></div>` : ''}
  </div>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <table class="totals">
    <tbody>
      <tr><td style="color:#6b7280">Subtotal s/IVA</td><td style="text-align:right">${fmt(base)}</td></tr>
      <tr><td style="color:#6b7280">IVA 13%</td><td style="text-align:right">${fmt(iva)}</td></tr>
      ${applies ? `<tr><td style="color:#d97706">Retención 1%</td><td style="text-align:right;color:#d97706">-${fmt(ret)}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL A PAGAR</td><td style="text-align:right">${fmt(total)}</td></tr>
    </tbody>
  </table>
  ${cot.notes ? `<div class="notes-box"><strong>Notas:</strong> ${esc(cot.notes)}</div>` : ''}
  <div class="footer">
    <div class="footer-note">
      Cotización válida por 15 días. Precios ${isCCF ? 'más' : 'incluyen'} IVA 13%.
      ${applies ? '<br/>Sujeto a retención 1% (Art. 158 Código Tributario).' : ''}
    </div>
    <div class="sign-line">Firma y sello del cliente</div>
  </div>
</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};</script>
</body>
</html>`;
};
