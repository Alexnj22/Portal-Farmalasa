import React, { useState, useMemo, useRef } from 'react';
import {
    DollarSign, Plus, Printer, CheckCircle2, Banknote,
    Building2, Search, Edit2, AlertTriangle, RotateCcw,
    Download, X, Save, ListFilter,
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { calcPayrollEntry } from '../store/slices/payrollSlice';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import LiquidAvatar from '../components/common/LiquidAvatar';
import ModalShell from '../components/common/ModalShell';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt    = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const round2 = (n) => parseFloat((n || 0).toFixed(2));

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

const glassInput = "w-full h-10 px-3 bg-white/60 border border-slate-200/80 hover:border-[#007AFF]/40 focus:border-[#007AFF]/50 focus:ring-4 focus:ring-[#007AFF]/10 rounded-[1rem] text-[13px] outline-none font-bold text-slate-800 transition-all duration-300 placeholder-slate-400 placeholder:font-normal";

// Role hierarchy by DB id — lower index = more senior
const ROLE_HIERARCHY = [2,3,11,12,13,22,19,20,8,23,24,9,14,16,17,18,15,26,30,27];
const roleOrder = (emp) => {
    const idx = ROLE_HIERARCHY.indexOf(Number(emp?.role_id ?? emp?.roleId));
    return idx === -1 ? 999 : idx;
};

const STATUS_META = {
    DRAFT:    { label: 'Borrador',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
    APPROVED: { label: 'Aprobada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    PAID:     { label: 'Pagada',   color: 'bg-blue-50 text-blue-700 border-blue-200' },
};

// ─── Number to words ──────────────────────────────────────────────────────────
function numberToWords(n) {
    const ones = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve'];
    const tens = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const hunds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
    if (n === 0) return 'cero';
    if (n < 0) return 'menos ' + numberToWords(-n);
    let s = '';
    if (n >= 1000) { s += numberToWords(Math.floor(n / 1000)) + ' mil '; n %= 1000; }
    if (n >= 100)  { s += hunds[Math.floor(n / 100)] + ' '; n %= 100; }
    if (n >= 20)   { s += tens[Math.floor(n / 10)] + (n % 10 ? ' y ' + ones[n % 10] : '') + ' '; n = 0; }
    else if (n > 0){ s += ones[n] + ' '; }
    return s.trim();
}
function amountInWords(amount) {
    const total = Math.round(amount * 100);
    return `${numberToWords(Math.floor(total / 100)).toUpperCase()} CON ${String(total % 100).padStart(2,'0')}/100`;
}
function periodLabel(start, end) {
    const s = new Date(start + 'T12:00:00');
    const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
    const m = cap(s.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' }));
    if (s.getDate() === 1)  return `Primera Quincena de ${m}`;
    if (s.getDate() === 16) return `Segunda Quincena de ${m}`;
    return `${s.toLocaleDateString('es-SV')} — ${new Date(end + 'T12:00:00').toLocaleDateString('es-SV')}`;
}

// ─── Print helpers ────────────────────────────────────────────────────────────
const PRINT_CSS = `
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

function buildBoletaHTML(entry, period, branches) {
    const emp    = entry.employee || {};
    const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
    const daily  = round2((emp.base_salary || 0) / 30);
    const hourly = round2(daily / 8);
    const fd = (d) => d ? new Date(d+'T12:00:00').toLocaleDateString('es-SV',{day:'2-digit',month:'long',year:'numeric'}).toUpperCase() : '—';
    return `
<div class="grid2">
  <div><span class="lbl">PATRONO:</span> JOSE RUTILIO ALEMAN VASQUEZ</div>
  <div><span class="lbl">EMPLEADO:</span> ${(emp.name||'').toUpperCase()}</div>
  <div><span class="lbl">CARGO:</span> ${emp.role||'—'}</div>
  <div><span class="lbl">DEPARTAMENTO:</span> ${emp.department||'—'}</div>
  <div><span class="lbl">SUCURSAL:</span> ${branch?.name||'—'}</div>
  <div><span class="lbl">FECHA DE INGRESO:</span> ${fd(emp.hire_date||emp.hireDate)}</div>
  <div><span class="lbl">PERÍODO:</span> ${periodLabel(period.start_date,period.end_date).toUpperCase()}</div>
  <div><span class="lbl">SUELDO DIARIO:</span> $${daily.toFixed(2)}</div>
  <div><span class="lbl">FECHA DE PAGO:</span> ${period.pay_date?fd(period.pay_date):'—'}</div>
  <div><span class="lbl">CUENTA ELECTRÓNICA:</span> ${emp.account_number||'—'}</div>
  <div><span class="lbl">SUELDO BASE MENSUAL:</span> $${parseFloat(emp.base_salary||0).toFixed(2)}</div>
  <div><span class="lbl">TIPO DE JORNADA:</span> TIEMPO COMPLETO</div>
  <div><span class="lbl">SUELDO POR HORA:</span> $${hourly.toFixed(4)}</div>
  <div><span class="lbl">FORMA DE PAGO:</span> DEPÓSITO EN ${(emp.bank_name||'').toUpperCase()}</div>
</div>
<hr/>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 30px">
  <div>
    <div class="sec">INGRESOS SUJETOS A RETENCIÓN</div>
    <table>
      <tr><td>DÍAS TRABAJADOS:</td><td class="right">${round2(entry.days_worked)}</td></tr>
      <tr><td>SALARIO ORDINARIO: ${round2(entry.days_worked)} X $${daily.toFixed(2)} =</td><td class="right">$${round2(entry.ordinary_salary).toFixed(2)} +</td></tr>
      <tr class="tot"><td>SUBTOTAL:</td><td class="right">A $${round2(entry.subtotal_a).toFixed(2)} +</td></tr>
    </table><br/>
    <div class="sec">OTROS INGRESOS NO SUJETOS A RETENCIONES</div>
    <table>
      <tr><td>HORAS NOCT. ORDINARIAS (25%):</td><td class="right">$${round2(entry.night_hours_ordinary*hourly*0.25).toFixed(2)} +</td></tr>
      <tr><td>HORAS NOCT. EXTRAORDINARIAS (50%):</td><td class="right">$${round2(entry.night_hours_extra*hourly*0.50).toFixed(2)} +</td></tr>
      <tr><td>HORAS EXTRA DIURNAS:</td><td class="right">$${round2(entry.extra_hours_diurnal*hourly*2).toFixed(2)} +</td></tr>
      <tr><td>HORAS EXTRA NOCTURNAS:</td><td class="right">$${round2(entry.extra_hours_nocturnal*hourly*2).toFixed(2)} +</td></tr>
      <tr><td>RECARGO DE ASUETOS:</td><td class="right">$${round2(entry.holiday_surcharge).toFixed(2)} +</td></tr>
      <tr><td>BONIFICACIONES:</td><td class="right">$${round2(entry.bonifications).toFixed(2)} +</td></tr>
      <tr><td>BONO VACACIONAL (30%):</td><td class="right">$${round2(entry.vacation_bonus).toFixed(2)} +</td></tr>
      <tr><td>VIÁTICOS:</td><td class="right">$${round2(entry.viaticos||0).toFixed(2)} +</td></tr>
      <tr class="tot"><td>SUBTOTAL:</td><td class="right">B $${round2(entry.subtotal_b).toFixed(2)}</td></tr>
    </table>
  </div>
  <div>
    <div class="sec">RETENCIONES</div>
    <table>
      <tr><td>ISSS: $${round2(entry.ordinary_salary).toFixed(2)} X 3% =</td><td class="right">$${round2(entry.isss_deduction).toFixed(2)} -</td></tr>
      <tr><td>AFP: $${round2(entry.ordinary_salary).toFixed(2)} X 7.25% =</td><td class="right">$${round2(entry.afp_deduction).toFixed(2)} -</td></tr>
      <tr><td>RENTA:</td><td class="right">$${round2(entry.renta_deduction).toFixed(2)} -</td></tr>
    </table><br/>
    <div class="sec">OTROS DESCUENTOS</div>
    <table>
      <tr><td>ORDEN DE DESCUENTO:</td><td class="right">$${round2(entry.order_discount).toFixed(2)} -</td></tr>
      <tr><td>OTROS DESCUENTOS:</td><td class="right">$${round2(entry.other_discounts).toFixed(2)} -</td></tr>
      <tr><td>ADELANTO SALARIAL:</td><td class="right">$${round2(entry.salary_advance).toFixed(2)} -</td></tr>
      <tr style="height:12px"><td></td><td></td></tr>
      <tr class="tot"><td>TOTAL RETENCIONES Y DESCUENTOS:</td><td class="right">C $${round2(entry.total_deductions).toFixed(2)} -</td></tr>
    </table>
  </div>
</div>
<hr/>
<div style="font-weight:bold;font-size:12px;text-align:center;margin:6px 0">
  LÍQUIDO A RECIBIR (A −C) + B: $${round2(entry.net_pay).toFixed(2)}
</div>
<div style="text-align:center;font-size:10px">CANTIDAD EN LETRAS: ${amountInWords(entry.net_pay)}</div>
<hr/>
${entry.viaticos_detail?`<div style="font-size:10px;margin:4px 0"><b>CONCEPTO DE VIÁTICOS:</b> ${entry.viaticos_detail}</div>`:''}
${(entry.edit_history||[]).length>0?`<div style="font-size:9px;color:#555;margin-top:4px">Boleta editada. Última edición: ${entry.edit_history[entry.edit_history.length-1]?.by} — ${entry.edit_history[entry.edit_history.length-1]?.reason}</div>`:''}
<div class="sig"><div>F. ____________________<br/>PATRONO</div><div>F. ____________________<br/>EMPLEADO</div></div>`;
}

function openPrintWindow(html, w = 840, h = 920) {
    const win = window.open('', '_blank', `width=${w},height=${h}`);
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
}

function printBoleta(entry, period, branches) {
    const body = buildBoletaHTML(entry, period, branches);
    openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PRINT_CSS}</style></head><body><h2>BOLETA DE PAGO</h2><h3>FARMACIA LA SALUD</h3>${body}</body></html>`);
}

function printBoletasBatch(entries, period, branches) {
    const sections = entries.map((e, i) => {
        const isLast = i === entries.length - 1;
        return `<div class="${isLast?'':'pb'}"><h2>BOLETA DE PAGO</h2><h3>FARMACIA LA SALUD</h3>${buildBoletaHTML(e, period, branches)}</div>`;
    }).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PRINT_CSS}</style></head><body>${sections}</body></html>`);
}

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

function planillaTableRows(entries, branches) {
    return entries.map(e => {
        const emp    = e.employee || {};
        const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
        return `<tr>
          <td>${emp.name||'—'}</td><td>${branch?.name||'Otras áreas'}</td>
          <td class="right">${round2(e.days_worked)}</td>
          <td class="right">$${round2(e.ordinary_salary).toFixed(2)}</td>
          <td class="right">$${round2(e.subtotal_b).toFixed(2)}</td>
          <td class="right">$${round2(e.isss_deduction).toFixed(2)}</td>
          <td class="right">$${round2(e.afp_deduction).toFixed(2)}</td>
          <td class="right">$${round2(e.renta_deduction).toFixed(2)}</td>
          <td class="right">$${round2(e.total_deductions).toFixed(2)}</td>
          <td class="right"><b>$${round2(e.net_pay).toFixed(2)}</b></td>
        </tr>`;
    }).join('');
}

function planillaHeaderRow() {
    return `<tr><th>Empleado</th><th>Sucursal</th><th>Días</th><th>Sal. Ordinario</th><th>Extras/Otros</th><th>ISSS</th><th>AFP</th><th>Renta</th><th>Total Desc.</th><th>Líquido</th></tr>`;
}

function printGlobalPlanilla(entries, period, branches) {
    const totalNet = entries.reduce((s, e) => s + round2(e.net_pay), 0);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PLANILLA_CSS}</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2><h3>${periodLabel(period.start_date,period.end_date).toUpperCase()}</h3>
<table><thead>${planillaHeaderRow()}</thead><tbody>${planillaTableRows(entries,branches)}</tbody>
<tfoot><tr class="total"><td colspan="9" class="right">TOTAL A PAGAR:</td><td class="right">$${totalNet.toFixed(2)}</td></tr></tfoot></table>
<br/><div style="font-size:10px">Total en letras: ${amountInWords(totalNet)}</div>
</body></html>`;
    openPrintWindow(html, 1100, 700);
}

function printBranchPlanilla(branchEntries, branch, period, branches) {
    const totalNet = branchEntries.reduce((s, e) => s + round2(e.net_pay), 0);
    const title    = branch?.name || 'Otras áreas';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PLANILLA_CSS}</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2>
<h3>${periodLabel(period.start_date,period.end_date).toUpperCase()}</h3>
<h4>${title.toUpperCase()}</h4>
<table><thead>${planillaHeaderRow()}</thead><tbody>${planillaTableRows(branchEntries,branches)}</tbody>
<tfoot><tr class="total"><td colspan="9" class="right">TOTAL ${title.toUpperCase()}:</td><td class="right">$${totalNet.toFixed(2)}</td></tr></tfoot></table>
<br/><div style="font-size:10px">Total en letras: ${amountInWords(totalNet)}</div>
</body></html>`;
    openPrintWindow(html, 1100, 700);
}

// ─── Edit entry form (no ModalShell — rendered inside parent's ModalShell) ───
function EditEntryForm({ entry, user, onSave, onClose }) {
    const emp   = entry.employee || {};
    const daily = round2((emp.base_salary || 0) / 30);
    const [form, setForm] = useState({
        days_worked:           entry.days_worked,
        night_hours_ordinary:  entry.night_hours_ordinary,
        night_hours_extra:     entry.night_hours_extra,
        extra_hours_diurnal:   entry.extra_hours_diurnal,
        extra_hours_nocturnal: entry.extra_hours_nocturnal,
        holiday_surcharge:     entry.holiday_surcharge,
        bonifications:         entry.bonifications,
        vacation_bonus:        entry.vacation_bonus,
        viaticos:              entry.viaticos,
        viaticos_detail:       entry.viaticos_detail || '',
        order_discount:        entry.order_discount,
        other_discounts:       entry.other_discounts,
        salary_advance:        entry.salary_advance,
    });
    const [reason,  setReason]  = useState('');
    const [saving,  setSaving]  = useState(false);

    const preview = useMemo(() => calcPayrollEntry(emp, form.days_worked, form), [emp, form]);
    const numField = (key, label) => (
        <div key={key}>
            <InputLabel>{label}</InputLabel>
            <input type="number" step="0.01" min="0" value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                className={glassInput} />
        </div>
    );

    const handleSave = async () => {
        if (!reason.trim()) { useToastStore.getState().showToast('Error', 'Escribe el motivo de la edición.', 'error'); return; }
        setSaving(true);
        await onSave(entry.id, form, user?.name || user?.id, reason);
        setSaving(false);
        onClose();
    };

    return (
        <>
            {/* Header */}
            <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-xl">
                            <Edit2 size={18} className="text-amber-600" strokeWidth={2} />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-900 text-[16px] tracking-tight">Editar Entrada</h3>
                            <p className="text-[11px] text-slate-500 mt-0.5">{emp.name} — Salario diario: ${daily.toFixed(2)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors"><X size={18} strokeWidth={2} /></button>
                </div>
            </div>

            {/* Body */}
            <div className="bg-white/40 backdrop-blur-md p-6 max-h-[65vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <InputLabel>Días Trabajados</InputLabel>
                        <input type="number" step="0.5" min="0" max="16" value={form.days_worked}
                            onChange={e => setForm(f => ({ ...f, days_worked: parseFloat(e.target.value) || 0 }))}
                            className={glassInput} />
                    </div>

                    <div className="col-span-2 pt-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Horas adicionales</p>
                    </div>
                    {numField('night_hours_ordinary',  'Hrs. Nocturnas Ord. (25%)')}
                    {numField('night_hours_extra',     'Hrs. Noct. Extra (50%)')}
                    {numField('extra_hours_diurnal',   'Hrs. Extra Diurnas')}
                    {numField('extra_hours_nocturnal', 'Hrs. Extra Nocturnas')}

                    <div className="col-span-2 pt-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Otros ingresos</p>
                    </div>
                    {numField('holiday_surcharge', 'Recargo de Asuetos ($)')}
                    {numField('bonifications',     'Bonificaciones ($)')}
                    {numField('vacation_bonus',    'Bono Vacacional ($)')}
                    {numField('viaticos',          'Viáticos ($)')}
                    <div className="col-span-2">
                        <InputLabel>Detalle de Viáticos</InputLabel>
                        <input type="text" value={form.viaticos_detail}
                            onChange={e => setForm(f => ({ ...f, viaticos_detail: e.target.value }))}
                            placeholder="Ej: Por 1 visita de supervisión $10.00"
                            className={glassInput} />
                    </div>

                    <div className="col-span-2 pt-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Descuentos adicionales</p>
                    </div>
                    {numField('order_discount',  'Orden de Descuento ($)')}
                    {numField('other_discounts', 'Otros Descuentos ($)')}
                    {numField('salary_advance',  'Adelanto Salarial ($)')}

                    {/* Preview strip */}
                    <div className="col-span-2 bg-white/60 rounded-2xl p-4 border border-slate-200/60 mt-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Vista previa</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-[9px] text-slate-400">Subtotal A</p><p className="text-[14px] font-black text-slate-800">{fmt(preview.subtotal_a)}</p></div>
                            <div><p className="text-[9px] text-slate-400">Deducciones</p><p className="text-[14px] font-black text-red-600">{fmt(preview.total_deductions)}</p></div>
                            <div><p className="text-[9px] text-slate-400">Líquido</p><p className="text-[16px] font-black text-emerald-700">{fmt(preview.net_pay)}</p></div>
                        </div>
                    </div>

                    {/* Edit reason */}
                    <div className="col-span-2">
                        <InputLabel>Motivo de edición <span className="text-red-400">*</span></InputLabel>
                        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Ej: Corrección de días por permiso autorizado"
                            className="w-full h-10 px-3 bg-amber-50/80 border border-amber-300/60 hover:border-amber-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-300/20 rounded-[1rem] text-[13px] outline-none font-bold text-slate-800 transition-all duration-300" />
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="bg-white/60 backdrop-blur-xl px-8 py-5 border-t border-black/[0.04] flex gap-3">
                <button onClick={onClose} className="flex-1 h-12 rounded-[1.25rem] border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50 transition-all">Cancelar</button>
                <button onClick={handleSave} disabled={saving}
                    className="flex-1 h-12 bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_8px_20px_rgba(0,122,255,0.25)] text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-40">
                    <Save size={14} strokeWidth={2.5} />
                    {saving ? 'Guardando…' : 'Guardar Cambios'}
                </button>
            </div>
        </>
    );
}

// ─── New period form (no ModalShell) ─────────────────────────────────────────
function NewPeriodForm({ onSave, onClose }) {
    const today = new Date();
    const day = today.getDate(), year = today.getFullYear(), month = today.getMonth();
    const defaultStart = day <= 15
        ? `${year}-${String(month+1).padStart(2,'0')}-01`
        : `${year}-${String(month+1).padStart(2,'0')}-16`;
    const defaultEnd = day <= 15
        ? `${year}-${String(month+1).padStart(2,'0')}-15`
        : new Date(year, month+1, 0).toISOString().split('T')[0];

    const [form, setForm]   = useState({ start_date: defaultStart, end_date: defaultEnd, pay_date: '' });
    const [saving, setSaving] = useState(false);

    const name = useMemo(() => form.start_date && form.end_date ? periodLabel(form.start_date, form.end_date) : '', [form.start_date, form.end_date]);

    const handleSave = async () => {
        if (!form.start_date || !form.end_date) return;
        setSaving(true);
        await onSave({ ...form, name, period_type: 'QUINCENA' });
        setSaving(false);
        onClose();
    };

    return (
        <>
            {/* Header */}
            <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#007AFF]/10 rounded-xl">
                            <Plus size={18} className="text-[#007AFF]" strokeWidth={2.5} />
                        </div>
                        <h3 className="font-black text-slate-900 text-[16px] tracking-tight">Nueva Quincena</h3>
                    </div>
                    <button onClick={onClose} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors"><X size={18} strokeWidth={2} /></button>
                </div>
            </div>

            {/* Body */}
            <div className="bg-white/40 backdrop-blur-md p-6 space-y-5">
                {name && (
                    <div className="bg-[#007AFF]/8 border border-[#007AFF]/15 rounded-2xl px-4 py-2.5">
                        <p className="text-[11px] font-black text-[#007AFF]">{name}</p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <InputLabel>Inicio del período</InputLabel>
                        <LiquidDatePicker value={form.start_date} onChange={val => setForm(f => ({ ...f, start_date: val }))} />
                    </div>
                    <div>
                        <InputLabel>Fin del período</InputLabel>
                        <LiquidDatePicker value={form.end_date} onChange={val => setForm(f => ({ ...f, end_date: val }))} />
                    </div>
                </div>
                <div>
                    <InputLabel>Fecha de pago</InputLabel>
                    <LiquidDatePicker value={form.pay_date} onChange={val => setForm(f => ({ ...f, pay_date: val }))} />
                </div>
            </div>

            {/* Footer */}
            <div className="bg-white/60 backdrop-blur-xl px-8 py-5 border-t border-black/[0.04] flex gap-3">
                <button onClick={onClose} className="flex-1 h-12 rounded-[1.25rem] border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50 transition-all">Cancelar</button>
                <button onClick={handleSave} disabled={saving || !form.start_date || !form.end_date}
                    className="flex-1 h-12 bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_8px_20px_rgba(0,122,255,0.25)] text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-40">
                    <Plus size={14} strokeWidth={2.5} />
                    {saving ? 'Creando…' : 'Crear Período'}
                </button>
            </div>
        </>
    );
}

// ─── Branch-grouped table ─────────────────────────────────────────────────────
function BranchGroupedTable({ entries, branches, isPaid, period, onPrint, onEdit }) {
    const grouped = useMemo(() => {
        const map = new Map();
        for (const e of entries) {
            const emp = e.employee || {};
            const bid = String(emp.branchId || emp.branch_id || '');
            const key = bid || '__none__';
            if (!map.has(key)) map.set(key, { branch: branches.find(b => String(b.id) === bid) || null, entries: [] });
            map.get(key).entries.push(e);
        }
        return [...map.values()]
            .sort((a, b) => {
                if (!a.branch) return 1;
                if (!b.branch) return -1;
                return a.branch.name.localeCompare(b.branch.name);
            })
            .map(g => ({ ...g, entries: [...g.entries].sort((a, b) => roleOrder(a.employee) - roleOrder(b.employee)) }));
    }, [entries, branches]);

    const COLS = ['Empleado', 'Días', 'Sal. Ord.', 'Extras', 'ISSS', 'AFP', 'Renta', 'Desc. Total', 'Líquido', ''];
    let rowIdx = 0;

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {grouped.map(({ branch, entries: grp }, gi) => {
                const branchNet = grp.reduce((s, e) => s + round2(e.net_pay), 0);
                const branchName = branch?.name || 'Otras áreas';
                return (
                    <div key={branch?.id || '__none__'}
                        className="backdrop-blur-[30px] rounded-[2.5rem] bg-white/40 border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500"
                        style={{ animationDelay: `${gi * 80}ms` }}>

                        {/* Branch header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60 bg-white/20 flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-xl flex items-center justify-center shadow-[0_3px_8px_rgba(0,122,255,0.3)]">
                                    <Building2 size={14} className="text-white" strokeWidth={2} />
                                </div>
                                <div>
                                    <p className="text-[13px] font-black text-slate-800 tracking-tight">{branchName}</p>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{grp.length} empleado{grp.length !== 1 ? 's' : ''}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 ml-auto">
                                {/* Print all boletas for this branch */}
                                <button
                                    onClick={() => printBoletasBatch(grp, period, branches)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all shadow-sm"
                                    title="Imprimir todas las boletas de esta sucursal">
                                    <Printer size={11} strokeWidth={2.5} /> Boletas
                                </button>
                                {/* Print branch planilla */}
                                <button
                                    onClick={() => printBranchPlanilla(grp, branch, period, branches)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all shadow-sm"
                                    title="Imprimir planilla de esta sucursal">
                                    <Printer size={11} strokeWidth={2.5} /> Planilla
                                </button>

                                <div className="w-px h-5 bg-white/50 mx-1" />

                                <div className="text-right">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Total a pagar</p>
                                    <p className="text-[15px] font-black text-emerald-700">{fmt(branchNet)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-[10px]">
                                <thead>
                                    <tr className="border-b border-white/40">
                                        {COLS.map(h => (
                                            <th key={h} className="px-4 py-3 text-left font-black uppercase tracking-widest text-slate-400 whitespace-nowrap first:pl-6 last:pr-6">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/30">
                                    {grp.map((e) => {
                                        const emp    = e.employee || {};
                                        const edited = e.status === 'EDITED';
                                        const delay  = rowIdx++ * 25;
                                        return (
                                            <tr key={e.id}
                                                className={`group hover:bg-white/50 transition-colors animate-in fade-in duration-300 ${edited ? 'bg-amber-50/20' : ''}`}
                                                style={{ animationDelay: `${delay}ms` }}>
                                                <td className="px-4 py-3 pl-6 whitespace-nowrap">
                                                    <div className="flex items-center gap-3">
                                                        <LiquidAvatar src={emp.photo || emp.photo_url} alt={emp.name} fallbackText={emp.name} className="w-8 h-8 rounded-xl shrink-0" />
                                                        <div>
                                                            <p className="font-black text-slate-800 text-[11px] leading-tight">{emp.name || '—'}</p>
                                                            {emp.role && <p className="text-[9px] text-slate-400 font-medium leading-tight">{emp.role}</p>}
                                                            {edited && <span className="text-[8px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200 inline-block mt-0.5">editado</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 font-bold text-slate-700 text-right">{round2(e.days_worked)}</td>
                                                <td className="px-4 py-3 font-bold text-slate-700 text-right">{fmt(e.ordinary_salary)}</td>
                                                <td className="px-4 py-3 font-bold text-blue-600 text-right">{fmt(e.subtotal_b)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-right">{fmt(e.isss_deduction)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-right">{fmt(e.afp_deduction)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-right">{fmt(e.renta_deduction)}</td>
                                                <td className="px-4 py-3 font-bold text-red-600 text-right">{fmt(e.total_deductions)}</td>
                                                <td className="px-4 py-3 font-black text-emerald-700 text-right whitespace-nowrap text-[11px]">{fmt(e.net_pay)}</td>
                                                <td className="px-4 py-3 pr-6">
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => onPrint(e)} title="Imprimir boleta individual"
                                                            className="p-1.5 rounded-lg hover:bg-white/80 text-slate-400 hover:text-slate-700 transition-colors">
                                                            <Printer size={12} strokeWidth={2.5} />
                                                        </button>
                                                        {!isPaid && (
                                                            <button onClick={() => onEdit(e)} title="Editar"
                                                                className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors">
                                                                <Edit2 size={12} strokeWidth={2.5} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────
const PayrollView = () => {
    const branches               = useStaffStore(s => s.branches);
    const user                   = useStaffStore(s => s.user);
    const payrollPeriods         = useStaffStore(s => s.payrollPeriods);
    const payrollEntries         = useStaffStore(s => s.payrollEntries);
    const isLoadingPayroll       = useStaffStore(s => s.isLoadingPayroll);
    const fetchPayrollPeriods    = useStaffStore(s => s.fetchPayrollPeriods);
    const createPayrollPeriod    = useStaffStore(s => s.createPayrollPeriod);
    const updatePayrollPeriodStatus = useStaffStore(s => s.updatePayrollPeriodStatus);
    const fetchPayrollEntries    = useStaffStore(s => s.fetchPayrollEntries);
    const generatePayrollEntries = useStaffStore(s => s.generatePayrollEntries);
    const updatePayrollEntry     = useStaffStore(s => s.updatePayrollEntry);

    const [activePeriod,  setActivePeriod]  = useState(null);
    const [filterBranch,  setFilterBranch]  = useState('');
    const [filterStatus,  setFilterStatus]  = useState('ALL');
    const [isSearchMode,  setIsSearchMode]  = useState(false);
    const [searchTerm,    setSearchTerm]    = useState('');
    const [showNewPeriod, setShowNewPeriod] = useState(false);
    const [editEntry,     setEditEntry]     = useState(null);
    const [generating,    setGenerating]    = useState(false);
    const [confirming,    setConfirming]    = useState(null);
    const searchInputRef = useRef(null);

    const { showToast } = useToastStore();

    React.useEffect(() => { fetchPayrollPeriods(); }, []);
    React.useEffect(() => { if (activePeriod) fetchPayrollEntries(activePeriod.id); }, [activePeriod?.id]);

    const branchOptions = useMemo(() => [
        { value: '', label: 'Todas las sucursales' },
        ...branches.map(b => ({ value: String(b.id), label: b.name })),
    ], [branches]);

    const statusOptions = [
        { value: 'ALL', label: 'Todos los estados' }, { value: 'DRAFT', label: 'Borrador' },
        { value: 'APPROVED', label: 'Aprobada' },     { value: 'PAID',  label: 'Pagada'   },
    ];

    const filteredPeriods = useMemo(() =>
        payrollPeriods.filter(p => filterStatus === 'ALL' || (p.status || 'DRAFT') === filterStatus),
    [payrollPeriods, filterStatus]);

    const filteredEntries = useMemo(() =>
        payrollEntries.filter(e => {
            const emp = e.employee || {};
            if (filterBranch && String(emp.branchId || emp.branch_id) !== filterBranch) return false;
            if (searchTerm && !(emp.name || '').toLowerCase().includes(searchTerm.toLowerCase())) return false;
            return true;
        }),
    [payrollEntries, filterBranch, searchTerm]);

    const totals = useMemo(() => ({
        grossA:  filteredEntries.reduce((s, e) => s + round2(e.subtotal_a), 0),
        extrasB: filteredEntries.reduce((s, e) => s + round2(e.subtotal_b), 0),
        deducts: filteredEntries.reduce((s, e) => s + round2(e.total_deductions), 0),
        net:     filteredEntries.reduce((s, e) => s + round2(e.net_pay), 0),
    }), [filteredEntries]);

    const handleGenerate = async () => {
        if (!activePeriod) return;
        setGenerating(true);
        try {
            await generatePayrollEntries(activePeriod.id, filterBranch || null);
            showToast('Generado', 'Planilla generada correctamente.', 'success');
        } catch(e) { showToast('Error', e.message || 'No se pudo generar la planilla.', 'error'); }
        setGenerating(false);
    };

    const handleStatusChange = async (status) => {
        if (!activePeriod) return;
        try {
            await updatePayrollPeriodStatus(activePeriod.id, status);
            setActivePeriod(p => ({ ...p, status }));
            showToast('Listo', `Planilla ${status === 'APPROVED' ? 'aprobada' : 'marcada como pagada'}.`, 'success');
        } catch { showToast('Error', 'No se pudo actualizar el estado.', 'error'); }
        setConfirming(null);
    };

    const handleEditSave = async (entryId, form, by, reason) => {
        const ok = await updatePayrollEntry(entryId, form, by, reason);
        if (ok) showToast('Guardado', 'Entrada actualizada.', 'success');
        else    showToast('Error', 'No se pudo guardar.', 'error');
    };

    const downloadCSV = () => {
        const rows = filteredEntries.map(e => {
            const emp = e.employee || {};
            return `${emp.name||''},${emp.bank_name||''},${emp.account_number||''},${emp.account_type||''},${round2(e.net_pay).toFixed(2)}`;
        }).join('\n');
        const blob = new Blob([`Nombre,Banco,Cuenta,Tipo,Monto\n${rows}`], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `planilla-banco-${activePeriod.name}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const isPaid     = activePeriod?.status === 'PAID';
    const isApproved = activePeriod?.status === 'APPROVED';
    const isDraft    = !activePeriod?.status || activePeriod?.status === 'DRAFT';

    const filtersContent = (
        <div className="flex items-center bg-white/20 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu overflow-hidden w-max max-w-full">
            {/* Search mode */}
            <div className={`flex items-center gap-2 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isSearchMode ? 'max-w-[700px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
                <div className="flex items-center bg-white/60 backdrop-blur-md rounded-full px-4 h-10 gap-2 min-w-[240px] border border-white/80 shadow-sm">
                    <Search size={14} className="text-slate-400 shrink-0" strokeWidth={2.5} />
                    <input ref={searchInputRef} type="text" placeholder="Buscar empleado…" value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="bg-transparent outline-none text-[12px] font-semibold text-slate-700 placeholder-slate-400 w-full" />
                    {searchTerm && <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={13} strokeWidth={2.5} /></button>}
                </div>
                <button onClick={() => { setIsSearchMode(false); setSearchTerm(''); }}
                    className="px-4 h-10 rounded-full bg-white/60 backdrop-blur-md text-slate-500 hover:text-slate-800 hover:bg-white text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border border-white/60 hover:shadow-sm active:scale-95">
                    Cancelar
                </button>
            </div>
            {/* Normal mode */}
            <div className={`flex items-center gap-1 md:gap-2 h-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[1200px] opacity-100'}`}>
                <div className="w-[185px] overflow-visible hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
                    <LiquidSelect value={filterBranch} onChange={val => setFilterBranch(val||'')} options={branchOptions} placeholder="Todas las sucursales" compact clearable={false} icon={Building2} />
                </div>
                <div className="w-px h-6 bg-white/50 mx-1 shrink-0" />
                <div className="w-[160px] overflow-visible hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
                    <LiquidSelect value={filterStatus} onChange={val => setFilterStatus(val||'ALL')} options={statusOptions} compact clearable={false} icon={ListFilter} />
                </div>
                <div className="w-px h-6 bg-white/50 mx-1 shrink-0" />
                <button onClick={() => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu" title="Buscar">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <>
            <GlassViewLayout icon={DollarSign} title="Nómina" filtersContent={filtersContent} transparentBody={true} fixedScrollMode={true}>
                <div className="flex flex-col lg:flex-row items-start gap-6 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                    {/* ── Sidebar: Períodos ── */}
                    <div className="w-full lg:w-[280px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8">
                        <div className="backdrop-blur-[30px] rounded-[2.5rem] p-5 bg-white/40 border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)]">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Períodos</p>
                                <button onClick={() => setShowNewPeriod(true)}
                                    className="w-8 h-8 bg-[#007AFF] text-white rounded-xl flex items-center justify-center shadow-[0_3px_8px_rgba(0,122,255,0.35)] hover:scale-110 hover:-rotate-3 transition-transform active:scale-95">
                                    <Plus size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                            {filteredPeriods.length === 0 ? (
                                <p className="text-center py-10 text-slate-400 text-[11px] font-medium">Sin períodos aún</p>
                            ) : (
                                <div className="space-y-2">
                                    {filteredPeriods.map((p, i) => {
                                        const meta   = STATUS_META[p.status] || STATUS_META.DRAFT;
                                        const active = activePeriod?.id === p.id;
                                        return (
                                            <button key={p.id} onClick={() => setActivePeriod(p)}
                                                className="w-full text-left p-3.5 rounded-2xl border transition-all duration-300 animate-in fade-in"
                                                style={{ animationDelay: `${i*40}ms`, background: active?'rgba(0,122,255,0.08)':'rgba(255,255,255,0.5)', borderColor: active?'rgba(0,122,255,0.25)':'rgba(255,255,255,0.7)', boxShadow: active?'0 4px 16px rgba(0,122,255,0.12)':'none' }}>
                                                <p className={`text-[11px] font-black leading-tight ${active?'text-[#007AFF]':'text-slate-800'}`}>{p.name}</p>
                                                <div className="flex items-center justify-between mt-1.5">
                                                    <p className="text-[9px] text-slate-400">{p.pay_date ? `Pago: ${new Date(p.pay_date+'T12:00:00').toLocaleDateString('es-SV')}` : 'Sin fecha de pago'}</p>
                                                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border ${meta.color}`}>{meta.label}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Main content ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 space-y-5">
                        {!activePeriod ? (
                            <div className="backdrop-blur-[30px] rounded-[2.5rem] p-12 bg-white/40 border border-white/80 flex flex-col items-center justify-center text-center animate-in fade-in duration-500">
                                <div className="w-16 h-16 bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-2xl flex items-center justify-center shadow-[0_8px_24px_rgba(0,122,255,0.3)] mb-4">
                                    <DollarSign size={28} className="text-white" strokeWidth={1.5} />
                                </div>
                                <p className="text-[15px] font-black text-slate-700 uppercase tracking-tight">Selecciona un período</p>
                                <p className="text-[12px] text-slate-400 mt-1">O crea una nueva quincena con el botón +</p>
                            </div>
                        ) : (
                            <>
                                {/* Period summary card */}
                                <div className="backdrop-blur-[30px] rounded-[2.5rem] p-6 bg-white/40 border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <h2 className="text-[16px] font-black text-slate-800 tracking-tight">{activePeriod.name}</h2>
                                            <p className="text-[10px] text-slate-400 mt-0.5">{activePeriod.start_date} → {activePeriod.end_date}{activePeriod.pay_date && ` · Pago: ${activePeriod.pay_date}`}</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl border uppercase tracking-widest ${(STATUS_META[activePeriod.status]||STATUS_META.DRAFT).color}`}>
                                                {(STATUS_META[activePeriod.status]||STATUS_META.DRAFT).label}
                                            </span>
                                            {(isDraft||isApproved) && (
                                                <button onClick={handleGenerate} disabled={generating}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all disabled:opacity-50 shadow-sm">
                                                    <RotateCcw size={12} strokeWidth={2.5} className={generating?'animate-spin':''} />
                                                    {generating ? 'Generando…' : payrollEntries.length > 0 ? 'Regenerar' : 'Generar Planilla'}
                                                </button>
                                            )}
                                            {payrollEntries.length > 0 && (
                                                <>
                                                    {/* Print ALL boletas in batch */}
                                                    <button onClick={() => printBoletasBatch(filteredEntries, activePeriod, branches)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all shadow-sm">
                                                        <Printer size={12} strokeWidth={2.5} /> Todas las Boletas
                                                    </button>
                                                    {/* Global planilla */}
                                                    <button onClick={() => printGlobalPlanilla(filteredEntries, activePeriod, branches)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all shadow-sm">
                                                        <Printer size={12} strokeWidth={2.5} /> Planilla Global
                                                    </button>
                                                    <button onClick={downloadCSV}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-[10px] font-black text-slate-600 hover:bg-white transition-all shadow-sm">
                                                        <Download size={12} strokeWidth={2.5} /> CSV Banco
                                                    </button>
                                                </>
                                            )}
                                            {isDraft && payrollEntries.length > 0 && (
                                                <button onClick={() => setConfirming({ action:'APPROVED', label:'aprobar' })}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black transition-all shadow-[0_3px_8px_rgba(34,197,94,0.35)]">
                                                    <CheckCircle2 size={12} strokeWidth={2.5} /> Aprobar
                                                </button>
                                            )}
                                            {isApproved && (
                                                <button onClick={() => setConfirming({ action:'PAID', label:'marcar como pagada' })}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#007AFF] hover:bg-[#0066CC] text-white text-[10px] font-black transition-all shadow-[0_3px_8px_rgba(0,122,255,0.35)]">
                                                    <Banknote size={12} strokeWidth={2.5} /> Marcar Pagada
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {payrollEntries.length > 0 && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-white/60">
                                            {[
                                                { label:'Sal. Ordinario', value:totals.grossA,  color:'text-slate-800' },
                                                { label:'Extras / Otros', value:totals.extrasB, color:'text-blue-700'  },
                                                { label:'Deducciones',    value:totals.deducts,  color:'text-red-600'  },
                                                { label:'Total a Pagar',  value:totals.net,      color:'text-emerald-700' },
                                            ].map(t => (
                                                <div key={t.label} className="text-center bg-white/40 rounded-2xl py-3 px-2 border border-white/60">
                                                    <p className="text-[8px] text-slate-400 uppercase tracking-widest font-black">{t.label}</p>
                                                    <p className={`text-[16px] font-black ${t.color} mt-0.5`}>{fmt(t.value)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Entries */}
                                {isLoadingPayroll ? (
                                    <div className="backdrop-blur-[30px] rounded-[2.5rem] p-12 bg-white/40 border border-white/80 text-center text-slate-400 text-[12px]">Cargando planilla…</div>
                                ) : filteredEntries.length === 0 ? (
                                    <div className="backdrop-blur-[30px] rounded-[2.5rem] p-12 bg-white/40 border border-white/80 text-center text-slate-400 text-[12px] animate-in fade-in duration-500">
                                        {payrollEntries.length === 0 ? 'Genera la planilla para ver los datos.' : 'Sin resultados para los filtros actuales.'}
                                    </div>
                                ) : (
                                    <BranchGroupedTable
                                        entries={filteredEntries}
                                        branches={branches}
                                        isPaid={isPaid}
                                        period={activePeriod}
                                        onPrint={(e) => printBoleta(e, activePeriod, branches)}
                                        onEdit={(e) => setEditEntry(e)}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </GlassViewLayout>

            {/* ── Modal: Nueva quincena ── */}
            <ModalShell open={showNewPeriod} onClose={() => setShowNewPeriod(false)} maxWidthClass="max-w-md" zClass="z-[110]">
                <NewPeriodForm
                    onSave={async (data) => { await createPayrollPeriod(data); setShowNewPeriod(false); }}
                    onClose={() => setShowNewPeriod(false)}
                />
            </ModalShell>

            {/* ── Modal: Editar entrada ── */}
            <ModalShell open={!!editEntry} onClose={() => setEditEntry(null)} maxWidthClass="max-w-2xl" zClass="z-[110]">
                {editEntry && (
                    <EditEntryForm
                        entry={editEntry}
                        user={user}
                        onSave={handleEditSave}
                        onClose={() => setEditEntry(null)}
                    />
                )}
            </ModalShell>

            {/* ── Modal: Confirmar estado ── */}
            <ModalShell open={!!confirming} onClose={() => setConfirming(null)} maxWidthClass="max-w-sm" zClass="z-[110]">
                {confirming && (
                    <>
                        <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-100 rounded-xl">
                                        <AlertTriangle size={18} className="text-amber-600" strokeWidth={2} />
                                    </div>
                                    <h3 className="font-black text-slate-900 text-[16px] tracking-tight">¿Confirmar acción?</h3>
                                </div>
                                <button onClick={() => setConfirming(null)} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors"><X size={18} strokeWidth={2} /></button>
                            </div>
                        </div>
                        <div className="bg-white/40 backdrop-blur-md px-8 py-6">
                            <p className="text-[13px] text-slate-600 mb-6">Vas a <b>{confirming.label}</b> la planilla <b>{activePeriod?.name}</b>. Esta acción queda registrada.</p>
                            <div className="flex gap-3">
                                <button onClick={() => setConfirming(null)} className="flex-1 h-12 rounded-[1.25rem] border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50 transition-all">Cancelar</button>
                                <button onClick={() => handleStatusChange(confirming.action)}
                                    className="flex-1 h-12 bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_8px_20px_rgba(0,122,255,0.25)] text-white rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest transition-all">
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </ModalShell>
        </>
    );
};

export default PayrollView;
