import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
    DollarSign, Plus, ChevronDown, Printer, CheckCircle2, Banknote,
    Building2, Search, Edit2, AlertTriangle, Clock, Users,
    FileText, Download, X, Save, ChevronRight, Eye, RotateCcw,
} from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { calcPayrollEntry } from '../store/slices/payrollSlice';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const round2 = (n) => parseFloat((n || 0).toFixed(2));

function numberToWords(n) {
    const ones  = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve'];
    const tens  = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const hundreds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
    if (n === 0) return 'cero';
    if (n < 0) return 'menos ' + numberToWords(-n);
    let s = '';
    if (n >= 1000) { s += numberToWords(Math.floor(n / 1000)) + ' mil '; n %= 1000; }
    if (n >= 100)  { s += hundreds[Math.floor(n / 100)] + ' '; n %= 100; }
    if (n >= 20)   { s += tens[Math.floor(n / 10)] + (n % 10 ? ' y ' + ones[n % 10] : '') + ' '; n = 0; }
    else if (n > 0){ s += ones[n] + ' '; n = 0; }
    return s.trim();
}

function amountInWords(amount) {
    const total   = Math.round(amount * 100);
    const dollars = Math.floor(total / 100);
    const cents   = total % 100;
    const words   = numberToWords(dollars).toUpperCase();
    return `${words} CON ${cents.toString().padStart(2,'0')}/100`;
}

function periodLabel(start, end) {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end   + 'T12:00:00');
    const day1 = s.getDate();
    const monthName = s.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
    if (day1 === 1) return `Primera Quincena de ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`;
    if (day1 === 16) return `Segunda Quincena de ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`;
    return `${s.toLocaleDateString('es-SV')} — ${e.toLocaleDateString('es-SV')}`;
}

const STATUS_META = {
    DRAFT:    { label: 'Borrador',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
    APPROVED: { label: 'Aprobada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    PAID:     { label: 'Pagada',   color: 'bg-blue-50 text-blue-700 border-blue-200' },
};

// ─── Print helpers ────────────────────────────────────────────────────────────
function printBoleta(entry, period, branches) {
    const emp     = entry.employee || {};
    const branch  = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
    const daily   = round2((emp.base_salary || 0) / 30);
    const hourly  = round2(daily / 8);
    const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase() : '—';
    const hireD   = emp.hire_date || emp.hireDate;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 20px; color: #000; }
  h2 { text-align:center; font-size:13px; margin:0; letter-spacing:1px; }
  h3 { text-align:center; font-size:12px; margin:2px 0 10px; }
  .num { position:absolute; right:20px; top:20px; font-size:11px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; margin-bottom:8px; }
  .label { font-weight:bold; font-size:10px; }
  hr { border:none; border-top:1px solid #000; margin:6px 0; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  td { padding:1px 3px; }
  .right { text-align:right; }
  .section-title { font-weight:bold; font-size:10px; text-decoration:underline; margin:4px 0 2px; }
  .total-line { font-weight:bold; border-top:1px solid #000; }
  .sig { margin-top:40px; display:flex; justify-content:space-between; }
  .sig div { text-align:center; width:45%; border-top:1px solid #000; padding-top:4px; font-size:10px; }
  @media print { body { padding: 8px; } }
</style></head><body>
<div style="position:relative">
  <div class="num">N° —</div>
  <h2>BOLETA DE PAGO</h2>
  <h3>FARMACIA LA SALUD</h3>
</div>
<div class="grid2">
  <div><span class="label">PATRONO:</span> JOSE RUTILIO ALEMAN VASQUEZ</div>
  <div><span class="label">EMPLEADO:</span> ${(emp.name || '').toUpperCase()}</div>
  <div><span class="label">CARGO:</span> ${emp.role || '—'}</div>
  <div><span class="label">DEPARTAMENTO:</span> ${emp.department || '—'}</div>
  <div><span class="label">SUCURSAL:</span> ${branch?.name || '—'}</div>
  <div><span class="label">FECHA DE INGRESO:</span> ${hireD ? new Date(hireD + 'T12:00:00').toLocaleDateString('es-SV', {day:'2-digit',month:'long',year:'numeric'}).toUpperCase() : '—'}</div>
  <div><span class="label">PERÍODO:</span> ${periodLabel(period.start_date, period.end_date).toUpperCase()}</div>
  <div><span class="label">SUELDO DIARIO:</span> $${daily.toFixed(2)}</div>
  <div><span class="label">FECHA DE PAGO:</span> ${period.pay_date ? fmtDate(period.pay_date) : '—'}</div>
  <div><span class="label">CUENTA ELECTRÓNICA:</span> ${emp.account_number || '—'}</div>
  <div><span class="label">SUELDO BASE MENSUAL:</span> $${parseFloat(emp.base_salary || 0).toFixed(2)}</div>
  <div><span class="label">TIPO DE JORNADA:</span> TIEMPO COMPLETO</div>
  <div><span class="label">SUELDO POR HORA:</span> $${hourly.toFixed(4)}</div>
  <div><span class="label">FORMA DE PAGO:</span> DEPÓSITO EN ${(emp.bank_name || '').toUpperCase()}</div>
</div>
<hr/>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 30px;">
  <div>
    <div class="section-title">INGRESOS SUJETOS A RETENCIÓN</div>
    <table>
      <tr><td>DÍAS TRABAJADOS:</td><td class="right">${round2(entry.days_worked)}</td></tr>
      <tr><td>SALARIO ORDINARIO: ${round2(entry.days_worked)} X $${daily.toFixed(2)} =</td><td class="right">$${round2(entry.ordinary_salary).toFixed(2)} +</td></tr>
      <tr class="total-line"><td>SUBTOTAL:</td><td class="right">A $${round2(entry.subtotal_a).toFixed(2)} +</td></tr>
    </table>
    <br/>
    <div class="section-title">OTROS INGRESOS NO SUJETOS A RETENCIONES</div>
    <table>
      <tr><td>HORAS NOCTURNAS ORDINARIAS (25%):</td><td class="right">${round2(entry.night_hours_ordinary)} X $${(hourly*0.25).toFixed(4)} = $${round2(entry.night_hours_ordinary*hourly*0.25).toFixed(2)} +</td></tr>
      <tr><td>HORAS NOCT. EXTRAORDINARIAS (50%):</td><td class="right">${round2(entry.night_hours_extra)} X $${(hourly*0.50).toFixed(4)} = $${round2(entry.night_hours_extra*hourly*0.50).toFixed(2)} +</td></tr>
      <tr><td>HORAS EXTRA DIURNAS:</td><td class="right">${round2(entry.extra_hours_diurnal)} X $${(hourly*2).toFixed(4)} = $${round2(entry.extra_hours_diurnal*hourly*2).toFixed(2)} +</td></tr>
      <tr><td>HORAS EXTRA NOCTURNAS:</td><td class="right">${round2(entry.extra_hours_nocturnal)} X $${(hourly*2).toFixed(4)} = $${round2(entry.extra_hours_nocturnal*hourly*2).toFixed(2)} +</td></tr>
      <tr><td>RECARGO DE ASUETOS:</td><td class="right">$${round2(entry.holiday_surcharge).toFixed(2)} +</td></tr>
      <tr><td>BONIFICACIONES:</td><td class="right">$${round2(entry.bonifications).toFixed(2)} +</td></tr>
      <tr><td>BONO VACACIONAL SOBRE SALARIO (30%):</td><td class="right">$${round2(entry.vacation_bonus).toFixed(2)} +</td></tr>
      <tr><td>VIÁTICOS:</td><td class="right"></td></tr>
      <tr class="total-line"><td>SUBTOTAL:</td><td class="right">B $${round2(entry.subtotal_b).toFixed(2)}</td></tr>
    </table>
  </div>
  <div>
    <div class="section-title">RETENCIONES</div>
    <table>
      <tr><td>ISSS: $${round2(entry.ordinary_salary).toFixed(2)} X 3% =</td><td class="right">$${round2(entry.isss_deduction).toFixed(2)} -</td></tr>
      <tr><td>AFP: $${round2(entry.ordinary_salary).toFixed(2)} X 7.25% =</td><td class="right">$${round2(entry.afp_deduction).toFixed(2)} -</td></tr>
      <tr><td>RENTA: $${round2(entry.ordinary_salary - entry.isss_deduction - entry.afp_deduction).toFixed(2)} =</td><td class="right">$${round2(entry.renta_deduction).toFixed(2)} -</td></tr>
    </table>
    <br/>
    <div class="section-title">OTROS DESCUENTOS</div>
    <table>
      <tr><td>ORDEN DE DESCUENTO:</td><td class="right">$${round2(entry.order_discount).toFixed(2)} -</td></tr>
      <tr><td>OTROS DESCUENTOS:</td><td class="right">$${round2(entry.other_discounts).toFixed(2)} -</td></tr>
      <tr><td>ADELANTO SALARIAL:</td><td class="right">$${round2(entry.salary_advance).toFixed(2)} -</td></tr>
      <tr style="height:12px"><td></td><td></td></tr>
      <tr class="total-line"><td>TOTAL RETENCIONES Y DESCUENTOS:</td><td class="right">C $${round2(entry.total_deductions).toFixed(2)} -</td></tr>
    </table>
  </div>
</div>
<hr/>
<div style="font-weight:bold;font-size:12px;text-align:center;margin:6px 0;">
  LÍQUIDO A RECIBIR (A -C) + B: $${round2(entry.net_pay).toFixed(2)}
</div>
<div style="text-align:center;font-size:10px;">CANTIDAD EN LETRAS: ${amountInWords(entry.net_pay)}</div>
<hr/>
${entry.viaticos_detail ? `<div style="font-size:10px;margin:4px 0;"><b>CONCEPTO DE VIÁTICOS Y BONIFICACIÓN:</b><br/>${entry.viaticos_detail}</div>` : ''}
${(entry.edit_history||[]).length > 0 ? `<div style="font-size:9px;color:#555;margin-top:4px;">Boleta editada. Última edición: ${entry.edit_history[entry.edit_history.length-1]?.by} — ${entry.edit_history[entry.edit_history.length-1]?.reason}</div>` : ''}
<div class="sig">
  <div>F. ____________________<br/>PATRONO</div>
  <div>F. ____________________<br/>EMPLEADO</div>
</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=820,height=900');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
}

function printGlobalPlanilla(entries, period, branches) {
    const rows = entries.map(e => {
        const emp    = e.employee || {};
        const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
        return `<tr>
          <td>${emp.name || '—'}</td>
          <td>${branch?.name || '—'}</td>
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

    const totalNet = entries.reduce((s, e) => s + round2(e.net_pay), 0);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body { font-family:Arial,sans-serif; font-size:9px; margin:20px; }
  h2,h3 { text-align:center; margin:2px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th { background:#000; color:#fff; padding:3px 4px; font-size:8px; }
  td { border:1px solid #ccc; padding:2px 4px; }
  .right { text-align:right; }
  .total { font-weight:bold; background:#eee; }
  @media print { body { margin:8px; } }
</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2>
<h3>${periodLabel(period.start_date, period.end_date).toUpperCase()}</h3>
<table>
  <thead><tr>
    <th>Empleado</th><th>Sucursal</th><th>Días</th>
    <th>Sal. Ordinario</th><th>Extras/Otros</th>
    <th>ISSS</th><th>AFP</th><th>Renta</th>
    <th>Total Desc.</th><th>Líquido</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total">
    <td colspan="9" class="right">TOTAL A PAGAR:</td>
    <td class="right">$${totalNet.toFixed(2)}</td>
  </tr></tfoot>
</table>
<br/><div style="font-size:10px;">Total en letras: ${amountInWords(totalNet)}</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=1100,height=700');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
}

// ─── Edit entry modal ─────────────────────────────────────────────────────────
function EditEntryModal({ entry, onSave, onClose, user }) {
    const emp     = entry.employee || {};
    const daily   = round2((emp.base_salary || 0) / 30);
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
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const preview = useMemo(() => calcPayrollEntry(emp, form.days_worked, form), [emp, form]);

    const field = (key, label, step = '0.01') => (
        <div key={key}>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5 block">{label}</label>
            <input
                type="number" step={step} min="0"
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
            />
        </div>
    );

    const handleSave = async () => {
        if (!reason.trim()) {
            useToastStore.getState().showToast('Error', 'Escribe el motivo de la edición.', 'error');
            return;
        }
        setSaving(true);
        await onSave(entry.id, form, user?.name || user?.id, reason);
        setSaving(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <div>
                        <h3 className="text-[14px] font-black text-slate-800">Editar Entrada</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">{emp.name} — Salario diario: ${daily.toFixed(2)}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X size={16} /></button>
                </div>

                <div className="p-6 grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5 block">Días Trabajados</label>
                        <input type="number" step="0.5" min="0" max="16"
                            value={form.days_worked}
                            onChange={e => setForm(f => ({ ...f, days_worked: parseFloat(e.target.value) || 0 }))}
                            className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-[13px] font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                        />
                    </div>

                    <div className="col-span-2 text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2">Horas adicionales</div>
                    {field('night_hours_ordinary',  'Hrs. Nocturnas Ord. (25%)')}
                    {field('night_hours_extra',     'Hrs. Noct. Extra (50%)')}
                    {field('extra_hours_diurnal',   'Hrs. Extra Diurnas')}
                    {field('extra_hours_nocturnal', 'Hrs. Extra Nocturnas')}

                    <div className="col-span-2 text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2">Otros ingresos</div>
                    {field('holiday_surcharge', 'Recargo de Asuetos ($)')}
                    {field('bonifications',     'Bonificaciones ($)')}
                    {field('vacation_bonus',    'Bono Vacacional ($)')}
                    {field('viaticos',          'Viáticos ($)')}
                    <div className="col-span-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5 block">Detalle de Viáticos</label>
                        <input type="text" value={form.viaticos_detail}
                            onChange={e => setForm(f => ({ ...f, viaticos_detail: e.target.value }))}
                            placeholder="Ej: Por 1 visita de supervisión $10.00"
                            className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                        />
                    </div>

                    <div className="col-span-2 text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2">Descuentos adicionales</div>
                    {field('order_discount',  'Orden de Descuento ($)')}
                    {field('other_discounts', 'Otros Descuentos ($)')}
                    {field('salary_advance',  'Adelanto Salarial ($)')}

                    {/* Preview */}
                    <div className="col-span-2 bg-slate-50 rounded-2xl p-4 border border-slate-100 mt-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Vista previa</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-[9px] text-slate-500">Subtotal A</p><p className="text-[13px] font-black text-slate-800">{fmt(preview.subtotal_a)}</p></div>
                            <div><p className="text-[9px] text-slate-500">Desc. total</p><p className="text-[13px] font-black text-red-600">{fmt(preview.total_deductions)}</p></div>
                            <div><p className="text-[9px] text-slate-500">Líquido</p><p className="text-[15px] font-black text-emerald-700">{fmt(preview.net_pay)}</p></div>
                        </div>
                    </div>

                    {/* Edit reason */}
                    <div className="col-span-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5 block">Motivo de edición <span className="text-red-500">*</span></label>
                        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Ej: Corrección de días por permiso autorizado"
                            className="w-full border border-amber-300 rounded-xl px-3 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                        />
                    </div>
                </div>

                <div className="flex gap-3 p-6 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50 transition-colors">Cancelar</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-2xl bg-[#007AFF] text-white text-[11px] font-black hover:bg-[#0062CC] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                        <Save size={13} strokeWidth={2.5} />
                        {saving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── New period modal ─────────────────────────────────────────────────────────
function NewPeriodModal({ branches, onSave, onClose }) {
    const today   = new Date();
    const day     = today.getDate();
    const year    = today.getFullYear();
    const month   = today.getMonth();
    const defaultStart = day <= 15
        ? `${year}-${String(month + 1).padStart(2,'0')}-01`
        : `${year}-${String(month + 1).padStart(2,'0')}-16`;
    const defaultEnd = day <= 15
        ? `${year}-${String(month + 1).padStart(2,'0')}-15`
        : new Date(year, month + 1, 0).toISOString().split('T')[0];

    const [form, setForm]   = useState({ start_date: defaultStart, end_date: defaultEnd, pay_date: '', branch_id: '' });
    const [saving, setSaving] = useState(false);

    const name = useMemo(() => {
        if (!form.start_date || !form.end_date) return '';
        return periodLabel(form.start_date, form.end_date);
    }, [form.start_date, form.end_date]);

    const handleSave = async () => {
        if (!form.start_date || !form.end_date) return;
        setSaving(true);
        await onSave({ ...form, name, period_type: 'QUINCENA' });
        setSaving(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <h3 className="text-[14px] font-black text-slate-800">Nueva Quincena</h3>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100"><X size={16} /></button>
                </div>
                <div className="p-6 grid gap-4">
                    {name && <div className="bg-blue-50 rounded-2xl px-4 py-2 text-[11px] font-black text-blue-700 border border-blue-200">{name}</div>}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Inicio del período</label>
                            <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30" />
                        </div>
                        <div>
                            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Fin del período</label>
                            <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Fecha de pago</label>
                        <input type="date" value={form.pay_date} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30" />
                    </div>
                </div>
                <div className="flex gap-3 p-6 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-2xl bg-[#007AFF] text-white text-[11px] font-black hover:bg-[#0062CC] flex items-center justify-center gap-2 disabled:opacity-50">
                        <Plus size={13} strokeWidth={2.5} />
                        {saving ? 'Creando...' : 'Crear Período'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────
const PayrollView = () => {
    const employees              = useStaffStore(s => s.employees);
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
    const [search,        setSearch]        = useState('');
    const [showNewPeriod, setShowNewPeriod] = useState(false);
    const [editEntry,     setEditEntry]     = useState(null);
    const [generating,    setGenerating]    = useState(false);
    const [confirming,    setConfirming]    = useState(null); // { action, label }

    const { showToast } = useToastStore();

    // Load periods on mount
    React.useEffect(() => { fetchPayrollPeriods(); }, []);

    // Load entries when period changes
    React.useEffect(() => {
        if (activePeriod) fetchPayrollEntries(activePeriod.id);
    }, [activePeriod?.id]);

    const filteredEntries = useMemo(() => {
        return payrollEntries.filter(e => {
            const emp = e.employee || {};
            if (filterBranch && String(emp.branchId || emp.branch_id) !== filterBranch) return false;
            if (search && !(emp.name || '').toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [payrollEntries, filterBranch, search]);

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
        } catch(e) {
            showToast('Error', e.message || 'No se pudo generar la planilla.', 'error');
        }
        setGenerating(false);
    };

    const handleStatusChange = async (status) => {
        if (!activePeriod) return;
        try {
            await updatePayrollPeriodStatus(activePeriod.id, status);
            setActivePeriod(p => ({ ...p, status }));
            const labels = { APPROVED: 'aprobada', PAID: 'marcada como pagada' };
            showToast('Listo', `Planilla ${labels[status] || status}.`, 'success');
        } catch(e) {
            showToast('Error', 'No se pudo actualizar el estado.', 'error');
        }
        setConfirming(null);
    };

    const handleEditSave = async (entryId, form, by, reason) => {
        const ok = await updatePayrollEntry(entryId, form, by, reason);
        if (ok) showToast('Guardado', 'Entrada actualizada.', 'success');
        else    showToast('Error', 'No se pudo guardar.', 'error');
    };

    const isPaid     = activePeriod?.status === 'PAID';
    const isApproved = activePeriod?.status === 'APPROVED';
    const isDraft    = activePeriod?.status === 'DRAFT' || !activePeriod?.status;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-100">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-500 rounded-[1.2rem] shadow-lg shadow-emerald-500/30">
                            <DollarSign size={20} strokeWidth={2.5} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-[15px] font-black text-slate-800 tracking-tight">Nómina</h1>
                            <p className="text-[10px] text-slate-500 font-medium">Planillas quincenales</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {activePeriod && payrollEntries.length > 0 && (
                            <>
                                <button onClick={() => printGlobalPlanilla(filteredEntries, activePeriod, branches)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 transition-colors">
                                    <Printer size={13} strokeWidth={2.5} /> Planilla Global
                                </button>
                                <button onClick={() => {
                                    const rows = filteredEntries.map(e => {
                                        const emp = e.employee || {};
                                        return `${emp.name || ''},${emp.bank_name || ''},${emp.account_number || ''},${emp.account_type || ''},${round2(e.net_pay).toFixed(2)}`;
                                    }).join('\n');
                                    const blob = new Blob([`Nombre,Banco,Cuenta,Tipo,Monto\n${rows}`], { type: 'text/csv' });
                                    const url  = URL.createObjectURL(blob);
                                    const a    = document.createElement('a');
                                    a.href     = url;
                                    a.download = `planilla-banco-${activePeriod.name}.csv`;
                                    a.click();
                                }} className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 transition-colors">
                                    <Download size={13} strokeWidth={2.5} /> Lista Banco
                                </button>
                            </>
                        )}
                        {activePeriod && isDraft && payrollEntries.length > 0 && (
                            <button onClick={() => setConfirming({ action: 'APPROVED', label: 'aprobar' })}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-emerald-500 text-white text-[10px] font-black hover:bg-emerald-600 transition-colors">
                                <CheckCircle2 size={13} strokeWidth={2.5} /> Aprobar Planilla
                            </button>
                        )}
                        {activePeriod && isApproved && (
                            <button onClick={() => setConfirming({ action: 'PAID', label: 'marcar como pagada' })}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-blue-500 text-white text-[10px] font-black hover:bg-blue-600 transition-colors">
                                <Banknote size={13} strokeWidth={2.5} /> Marcar Pagada
                            </button>
                        )}
                        <button onClick={() => setShowNewPeriod(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#007AFF] text-white text-[10px] font-black hover:bg-[#0062CC] transition-colors">
                            <Plus size={13} strokeWidth={2.5} /> Nueva Quincena
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
                {/* Sidebar: period list */}
                <div className="w-72 shrink-0 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 mb-3">Períodos</p>
                    {payrollPeriods.length === 0 && (
                        <div className="text-center py-8 text-slate-400 text-[11px]">Sin períodos aún</div>
                    )}
                    {payrollPeriods.map(p => {
                        const meta = STATUS_META[p.status] || STATUS_META.DRAFT;
                        const active = activePeriod?.id === p.id;
                        return (
                            <button key={p.id} onClick={() => setActivePeriod(p)}
                                className={`w-full text-left p-4 rounded-2xl border transition-all ${active ? 'bg-[#007AFF]/5 border-[#007AFF]/30 shadow-sm' : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm'}`}>
                                <p className={`text-[11px] font-black leading-tight ${active ? 'text-[#007AFF]' : 'text-slate-800'}`}>{p.name}</p>
                                <div className="flex items-center justify-between mt-1.5">
                                    <p className="text-[9px] text-slate-400">{p.pay_date ? `Pago: ${new Date(p.pay_date + 'T12:00:00').toLocaleDateString('es-SV')}` : 'Sin fecha de pago'}</p>
                                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border ${meta.color}`}>{meta.label}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                    {!activePeriod ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                            <DollarSign size={40} className="mb-3 opacity-30" />
                            <p className="text-[13px] font-bold">Selecciona o crea un período</p>
                        </div>
                    ) : (
                        <>
                            {/* Period header */}
                            <div className="bg-white rounded-3xl border border-slate-100 p-5 mb-4 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className="text-[15px] font-black text-slate-800">{activePeriod.name}</h2>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            {activePeriod.start_date} → {activePeriod.end_date}
                                            {activePeriod.pay_date && ` · Pago: ${activePeriod.pay_date}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {(STATUS_META[activePeriod.status] || STATUS_META.DRAFT) && (
                                            <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl border ${(STATUS_META[activePeriod.status] || STATUS_META.DRAFT).color}`}>
                                                {(STATUS_META[activePeriod.status] || STATUS_META.DRAFT).label}
                                            </span>
                                        )}
                                        {(isDraft || isApproved) && (
                                            <button onClick={handleGenerate} disabled={generating}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
                                                <RotateCcw size={12} strokeWidth={2.5} className={generating ? 'animate-spin' : ''} />
                                                {generating ? 'Generando...' : payrollEntries.length > 0 ? 'Regenerar' : 'Generar Planilla'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Totals strip */}
                                {payrollEntries.length > 0 && (
                                    <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
                                        {[
                                            { label: 'Sal. Ordinario', value: totals.grossA,  color: 'text-slate-800' },
                                            { label: 'Extras / Otros', value: totals.extrasB,  color: 'text-blue-700' },
                                            { label: 'Deducciones',    value: totals.deducts,  color: 'text-red-600' },
                                            { label: 'Total a Pagar',  value: totals.net,      color: 'text-emerald-700' },
                                        ].map(t => (
                                            <div key={t.label} className="text-center">
                                                <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">{t.label}</p>
                                                <p className={`text-[15px] font-black ${t.color} mt-0.5`}>{fmt(t.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Filters */}
                            <div className="flex gap-3 mb-4">
                                <div className="relative flex-1 max-w-xs">
                                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
                                    <input value={search} onChange={e => setSearch(e.target.value)}
                                        placeholder="Buscar empleado..."
                                        className="w-full pl-8 pr-4 py-2 rounded-2xl border border-slate-200 bg-white text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30" />
                                </div>
                                <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                                    className="px-3 py-2 rounded-2xl border border-slate-200 bg-white text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30">
                                    <option value="">Todas las sucursales</option>
                                    {branches.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                                </select>
                            </div>

                            {/* Table */}
                            {isLoadingPayroll ? (
                                <div className="text-center py-12 text-slate-400 text-[12px]">Cargando...</div>
                            ) : filteredEntries.length === 0 ? (
                                <div className="text-center py-12 text-slate-400 text-[12px]">
                                    {payrollEntries.length === 0 ? 'Genera la planilla para ver los datos.' : 'Sin resultados.'}
                                </div>
                            ) : (
                                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[10px]">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-100">
                                                    {['Empleado','Sucursal','Días','Sal. Ord.','Extras','ISSS','AFP','Renta','Desc. Total','Líquido',''].map(h => (
                                                        <th key={h} className="px-3 py-3 text-left font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {filteredEntries.map(e => {
                                                    const emp    = e.employee || {};
                                                    const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
                                                    const edited = e.status === 'EDITED';
                                                    return (
                                                        <tr key={e.id} className={`group hover:bg-slate-50/50 transition-colors ${edited ? 'bg-amber-50/30' : ''}`}>
                                                            <td className="px-3 py-3 font-black text-slate-800 whitespace-nowrap">
                                                                {emp.name || '—'}
                                                                {edited && <span className="ml-1 text-[8px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200">editado</span>}
                                                            </td>
                                                            <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{branch?.name || '—'}</td>
                                                            <td className="px-3 py-3 font-bold text-slate-700 text-right">{round2(e.days_worked)}</td>
                                                            <td className="px-3 py-3 font-bold text-slate-700 text-right">{fmt(e.ordinary_salary)}</td>
                                                            <td className="px-3 py-3 font-bold text-blue-600 text-right">{fmt(e.subtotal_b)}</td>
                                                            <td className="px-3 py-3 text-slate-500 text-right">{fmt(e.isss_deduction)}</td>
                                                            <td className="px-3 py-3 text-slate-500 text-right">{fmt(e.afp_deduction)}</td>
                                                            <td className="px-3 py-3 text-slate-500 text-right">{fmt(e.renta_deduction)}</td>
                                                            <td className="px-3 py-3 font-bold text-red-600 text-right">{fmt(e.total_deductions)}</td>
                                                            <td className="px-3 py-3 font-black text-emerald-700 text-right whitespace-nowrap">{fmt(e.net_pay)}</td>
                                                            <td className="px-3 py-3">
                                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button onClick={() => printBoleta(e, activePeriod, branches)}
                                                                        title="Imprimir boleta"
                                                                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                                                                        <Printer size={12} strokeWidth={2.5} />
                                                                    </button>
                                                                    {!isPaid && (
                                                                        <button onClick={() => setEditEntry(e)}
                                                                            title="Editar"
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
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Confirm modal */}
            {confirming && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-6 text-center">
                        <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" strokeWidth={2} />
                        <h3 className="text-[14px] font-black text-slate-800 mb-1">¿Confirmar acción?</h3>
                        <p className="text-[11px] text-slate-500 mb-6">Vas a <b>{confirming.label}</b> la planilla <b>{activePeriod?.name}</b>. Esta acción queda registrada.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirming(null)} className="flex-1 py-2.5 rounded-2xl border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50">Cancelar</button>
                            <button onClick={() => handleStatusChange(confirming.action)}
                                className="flex-1 py-2.5 rounded-2xl bg-[#007AFF] text-white text-[11px] font-black hover:bg-[#0062CC]">Confirmar</button>
                        </div>
                    </div>
                </div>
            )}

            {showNewPeriod && <NewPeriodModal branches={branches} onSave={async (data) => { await createPayrollPeriod(data); setShowNewPeriod(false); }} onClose={() => setShowNewPeriod(false)} />}
            {editEntry && <EditEntryModal entry={editEntry} user={user} onSave={handleEditSave} onClose={() => setEditEntry(null)} />}
        </div>
    );
};

export default PayrollView;
