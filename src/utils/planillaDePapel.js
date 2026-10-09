// La planilla de pago impresa (global o de una sala), escrita una vez para el
// portal (`PayrollView`, que la abre en una ventana de impresión) y la app
// (`app/nomina.js`, que la convierte en PDF). Vivía dentro de la vista.
// Los colores son de PAPEL (negro, gris de rejilla): no hay tema en una hoja.
import { formatMoney } from './formatNumber';
import { montoEnLetras, rotuloDePeriodo } from './planilla';

const round2 = (n) => parseFloat((n || 0).toFixed(2));

const PLANILLA_CSS = `
  body{font-family:Arial,sans-serif;font-size:9px;margin:20px}
  h2,h3,h4{text-align:center;margin:2px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#000;color:#fff;padding:3px 4px;font-size:8px}
  td{border:1px solid #ccc;padding:2px 4px}
  .right{text-align:right}
  .total{font-weight:bold;background:#eee}
  .pb{page-break-after:always}
  @media print{body{margin:8px}}
`;

function filas(entries, branches) {
    return entries.map(e => {
        const emp    = e.employee || {};
        const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
        return `<tr>
          <td>${emp.name||'—'}</td><td>${branch?.name||'Otras áreas'}</td>
          <td class="right">${round2(e.days_worked)}</td>
          <td class="right">${formatMoney(round2(e.ordinary_salary))}</td>
          <td class="right">${formatMoney(round2(e.subtotal_b))}</td>
          <td class="right">${formatMoney(round2(e.isss_deduction))}</td>
          <td class="right">${formatMoney(round2(e.afp_deduction))}</td>
          <td class="right">${formatMoney(round2(e.renta_deduction))}</td>
          <td class="right">${formatMoney(round2(e.total_deductions))}</td>
          <td class="right"><b>${formatMoney(round2(e.net_pay))}</b></td>
        </tr>`;
    }).join('');
}

const encabezado = () => `<tr><th>Empleado</th><th>Sucursal</th><th>Días</th><th>Sal. Ordinario</th><th>Extras/Otros</th><th>ISSS</th><th>AFP</th><th>Renta</th><th>Total Desc.</th><th>Líquido</th></tr>`;

/**
 * La planilla impresa. Con `sala` (la sucursal o `null` para «Otras áreas")
 * es la de esa sala; sin `sala`, la global.
 */
export function documentoDePlanilla(entries, period, branches, { sala } = {}) {
    const totalNet = entries.reduce((s, e) => s + round2(e.net_pay), 0);
    const deSala = sala !== undefined;
    const titulo = sala?.name || 'Otras áreas';
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PLANILLA_CSS}</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2>
<h3>${rotuloDePeriodo(period.start_date, period.end_date).toUpperCase()}</h3>
${deSala ? `<h4>${titulo.toUpperCase()}</h4>` : ''}
<table><thead>${encabezado()}</thead><tbody>${filas(entries, branches)}</tbody>
<tfoot><tr class="total"><td colspan="9" class="right">${deSala ? `TOTAL ${titulo.toUpperCase()}:` : 'TOTAL A PAGAR:'}</td><td class="right">${formatMoney(totalNet)}</td></tr></tfoot></table>
<br/><div style="font-size:10px">Total en letras: ${montoEnLetras(totalNet)}</div>
</body></html>`;
}
