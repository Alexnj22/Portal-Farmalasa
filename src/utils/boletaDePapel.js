// El papel de la boleta de pago: el HTML que imprime el portal y que la app
// convierte en PDF para compartir. Vive en el núcleo para que los dos papeles
// sean el MISMO — una copia en la app nacería distinta (la app ya pintaba las
// horas extra como si fueran dólares).
import { formatMoney } from './formatNumber';
import { fechaTexto } from './fecha';
import { montoEnLetras, partidasDeBoleta, rotuloDePeriodo } from './planilla';

const round2 = (n) => parseFloat((n || 0).toFixed(2));

export const PRINT_CSS = `
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:16px;color:#000}
  h2{text-align:center;font-size:13px;margin:0;letter-spacing:1px}
  h3{text-align:center;font-size:12px;margin:2px 0 10px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-bottom:8px}
  .lbl{font-weight:bold;font-size:10px}
  hr{border:none;border-top:1px solid #000;margin:6px 0}
  table{width:100%;border-collapse:collapse;font-size:10px}
  td{padding:1px 3px}
  .right{text-align:right}
  .sec{font-weight:bold;font-size:10px;text-decoration:underline;margin:4px 0 2px}
  .tot{font-weight:bold;border-top:1px solid #000}
  .sig{margin-top:40px;display:flex;justify-content:space-between}
  .sig div{text-align:center;width:45%;border-top:1px solid #000;padding-top:4px;font-size:10px}
  .pb{page-break-after:always}
  @media print{body{padding:8px}}
`;

// Auditoría 2026-07 Fase 3: escapa texto libre/de negocio antes de interpolarlo
// en el HTML crudo de impresión (document.write) — mismo patrón ya usado en
// FormNovedad.jsx. Sin esto, un viaticos_detail/edit_history.reason con
// HTML/script se ejecutaba en la ventana de impresión (misma origin que la app).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function buildBoletaHTML(entry, period, branches) {
    const emp    = entry.employee || {};
    const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
    // El sueldo diario y por hora salen del núcleo: la boleta de la app usa
    // la misma regla para convertir las horas en dinero.
    const { diario: daily, porHora: hourly } = partidasDeBoleta(entry, emp.base_salary);
    const fd = (d) => d ? fechaTexto(d, {day:'2-digit',month:'long',year:'numeric'}).toUpperCase() : '—';
    return `
<div class="grid2">
  <div><span class="lbl">PATRONO:</span> JOSE RUTILIO ALEMAN VASQUEZ</div>
  <div><span class="lbl">EMPLEADO:</span> ${esc((emp.name||'').toUpperCase())}</div>
  <div><span class="lbl">CARGO:</span> ${esc(emp.role||'—')}</div>
  <div><span class="lbl">DEPARTAMENTO:</span> ${esc(emp.department||'—')}</div>
  <div><span class="lbl">SUCURSAL:</span> ${esc(branch?.name||'—')}</div>
  <div><span class="lbl">FECHA DE INGRESO:</span> ${fd(emp.hire_date||emp.hireDate)}</div>
  <div><span class="lbl">PERÍODO:</span> ${rotuloDePeriodo(period.start_date,period.end_date).toUpperCase()}</div>
  <div><span class="lbl">SUELDO DIARIO:</span> ${formatMoney(daily)}</div>
  <div><span class="lbl">FECHA DE PAGO:</span> ${period.pay_date?fd(period.pay_date):'—'}</div>
  <div><span class="lbl">CUENTA ELECTRÓNICA:</span> ${esc(emp.account_number||'—')}</div>
  <div><span class="lbl">SUELDO BASE MENSUAL:</span> ${formatMoney(parseFloat(emp.base_salary||0))}</div>
  <div><span class="lbl">TIPO DE JORNADA:</span> TIEMPO COMPLETO</div>
  <div><span class="lbl">SUELDO POR HORA:</span> ${formatMoney(hourly, { decimales: 4 })}</div>
  <div><span class="lbl">FORMA DE PAGO:</span> ${emp.bank_name ? 'DEPÓSITO EN ' + esc(emp.bank_name.toUpperCase()) : 'EFECTIVO / NO ESPECIFICADO'}</div>
</div>
<hr/>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 30px">
  <div>
    <div class="sec">INGRESOS SUJETOS A RETENCIÓN</div>
    <table>
      <tr><td>DÍAS TRABAJADOS:</td><td class="right">${round2(entry.days_worked)}</td></tr>
      <tr><td>SALARIO ORDINARIO: ${round2(entry.days_worked)} X ${formatMoney(daily)} =</td><td class="right">${formatMoney(round2(entry.ordinary_salary))} +</td></tr>
      <tr class="tot"><td>SUBTOTAL:</td><td class="right">A ${formatMoney(round2(entry.subtotal_a))} +</td></tr>
    </table><br/>
    <div class="sec">OTROS INGRESOS NO SUJETOS A RETENCIONES</div>
    <table>
      <tr><td>HORAS NOCT. ORDINARIAS (25%):</td><td class="right">${formatMoney(round2(entry.night_hours_ordinary*hourly*0.25))} +</td></tr>
      <tr><td>HORAS NOCT. EXTRAORDINARIAS (50%):</td><td class="right">${formatMoney(round2(entry.night_hours_extra*hourly*0.50))} +</td></tr>
      <tr><td>HORAS EXTRA DIURNAS:</td><td class="right">${formatMoney(round2(entry.extra_hours_diurnal*hourly*2))} +</td></tr>
      <tr><td>HORAS EXTRA NOCTURNAS (×2.25):</td><td class="right">${formatMoney(round2(entry.extra_hours_nocturnal*hourly*2.25))} +</td></tr>
      <tr><td>RECARGO DE ASUETOS:</td><td class="right">${formatMoney(round2(entry.holiday_surcharge))} +</td></tr>
      <tr><td>BONIFICACIONES:</td><td class="right">${formatMoney(round2(entry.bonifications))} +</td></tr>
      <tr><td>BONO VACACIONAL (30%):</td><td class="right">${formatMoney(round2(entry.vacation_bonus))} +</td></tr>
      <tr><td>VIÁTICOS:</td><td class="right">${formatMoney(round2(entry.viaticos||0))} +</td></tr>
      <tr class="tot"><td>SUBTOTAL:</td><td class="right">B ${formatMoney(round2(entry.subtotal_b))}</td></tr>
    </table>
  </div>
  <div>
    <div class="sec">RETENCIONES</div>
    <table>
      <tr><td>ISSS: ${formatMoney(round2(entry.ordinary_salary))} X 3% =</td><td class="right">${formatMoney(round2(entry.isss_deduction))} -</td></tr>
      <tr><td>AFP: ${formatMoney(round2(entry.ordinary_salary))} X 7.25% =</td><td class="right">${formatMoney(round2(entry.afp_deduction))} -</td></tr>
      <tr><td>RENTA:</td><td class="right">${formatMoney(round2(entry.renta_deduction))} -</td></tr>
    </table><br/>
    <div class="sec">OTROS DESCUENTOS</div>
    <table>
      <tr><td>ORDEN DE DESCUENTO:</td><td class="right">${formatMoney(round2(entry.order_discount))} -</td></tr>
      <tr><td>OTROS DESCUENTOS:</td><td class="right">${formatMoney(round2(entry.other_discounts))} -</td></tr>
      <tr><td>ADELANTO SALARIAL:</td><td class="right">${formatMoney(round2(entry.salary_advance))} -</td></tr>
      <tr style="height:12px"><td></td><td></td></tr>
      <tr class="tot"><td>TOTAL RETENCIONES Y DESCUENTOS:</td><td class="right">C ${formatMoney(round2(entry.total_deductions))} -</td></tr>
    </table>
  </div>
</div>
<hr/>
<div style="font-weight:bold;font-size:12px;text-align:center;margin:6px 0">
  LÍQUIDO A RECIBIR (A −C) + B: ${formatMoney(round2(entry.net_pay))}
</div>
<div style="text-align:center;font-size:10px">CANTIDAD EN LETRAS: ${montoEnLetras(entry.net_pay)}</div>
<hr/>
${entry.viaticos_detail?`<div style="font-size:10px;margin:4px 0"><b>CONCEPTO DE VIÁTICOS:</b> ${esc(entry.viaticos_detail)}</div>`:''}
${(entry.edit_history||[]).length>0?`<div style="font-size:9px;color:#555;margin-top:4px">Boleta editada. Última edición: ${esc(entry.edit_history[entry.edit_history.length-1]?.by)} — ${esc(entry.edit_history[entry.edit_history.length-1]?.reason)}</div>`:''}
<div class="sig"><div>F. ____________________<br/>PATRONO</div><div>F. ____________________<br/>EMPLEADO</div></div>`;
}

/** El documento completo de una o varias boletas, una por página. */
export function documentoDeBoletas(entries, period, branches) {
    const secciones = entries.map((e, i) => `<div class="${i === entries.length - 1 ? '' : 'pb'}"><h2>BOLETA DE PAGO</h2><h3>FARMACIA LA SALUD</h3>${buildBoletaHTML(e, period, branches)}</div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PRINT_CSS}</style></head><body>${secciones}</body></html>`;
}
