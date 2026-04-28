import React, { useMemo } from 'react';
import { calcPayrollEntry } from '../../store/slices/payrollSlice';

const fmt    = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const round2 = (n) => parseFloat((n || 0).toFixed(2));

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

const glassInput = "w-full h-10 px-3 bg-white/60 border border-slate-200/80 hover:border-[#007AFF]/40 focus:border-[#007AFF]/50 focus:ring-4 focus:ring-[#007AFF]/10 rounded-[1rem] text-[13px] outline-none font-bold text-slate-800 transition-all duration-300 placeholder-slate-400 placeholder:font-normal";

const FormEditPayrollEntry = ({ formData = {}, setFormData }) => {
    const entry = formData._entry || {};
    const emp   = entry.employee || {};
    const daily = round2((emp.base_salary || 0) / 30);

    const numField = (key, label) => (
        <div key={key}>
            <InputLabel>{label}</InputLabel>
            <input
                type="number" step="0.01" min="0"
                value={formData[key] ?? entry[key] ?? 0}
                onChange={e => setFormData(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                className={glassInput}
            />
        </div>
    );

    const preview = useMemo(() =>
        calcPayrollEntry(emp, formData.days_worked ?? entry.days_worked ?? 15, formData),
    [emp, formData]);

    return (
        <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 bg-[#007AFF]/5 border border-[#007AFF]/15 rounded-2xl px-4 py-2.5">
                <p className="text-[11px] font-black text-[#007AFF]">
                    {emp.name} — Salario diario: ${daily.toFixed(2)}
                </p>
            </div>

            <div className="col-span-2">
                <InputLabel>Días Trabajados</InputLabel>
                <input
                    type="number" step="0.5" min="0" max="16"
                    value={formData.days_worked ?? entry.days_worked ?? 15}
                    onChange={e => setFormData(f => ({ ...f, days_worked: parseFloat(e.target.value) || 0 }))}
                    className={glassInput}
                />
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
                <input
                    type="text"
                    value={formData.viaticos_detail ?? entry.viaticos_detail ?? ''}
                    onChange={e => setFormData(f => ({ ...f, viaticos_detail: e.target.value }))}
                    placeholder="Ej: Por 1 visita de supervisión $10.00"
                    className={glassInput}
                />
            </div>

            <div className="col-span-2 pt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Descuentos adicionales</p>
            </div>
            {numField('order_discount',  'Orden de Descuento ($)')}
            {numField('other_discounts', 'Otros Descuentos ($)')}
            {numField('salary_advance',  'Adelanto Salarial ($)')}

            {/* Live preview */}
            <div className="col-span-2 bg-white/60 rounded-2xl p-4 border border-slate-200/60 mt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Vista previa</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p className="text-[9px] text-slate-400">Subtotal A</p>
                        <p className="text-[14px] font-black text-slate-800">{fmt(preview.subtotal_a)}</p>
                    </div>
                    <div>
                        <p className="text-[9px] text-slate-400">Deducciones</p>
                        <p className="text-[14px] font-black text-red-600">{fmt(preview.total_deductions)}</p>
                    </div>
                    <div>
                        <p className="text-[9px] text-slate-400">Líquido</p>
                        <p className="text-[16px] font-black text-emerald-700">{fmt(preview.net_pay)}</p>
                    </div>
                </div>
            </div>

            {/* Edit reason */}
            <div className="col-span-2">
                <InputLabel>Motivo de edición <span className="text-red-400">*</span></InputLabel>
                <input
                    type="text"
                    value={formData._reason || ''}
                    onChange={e => setFormData(f => ({ ...f, _reason: e.target.value }))}
                    placeholder="Ej: Corrección de días por permiso autorizado"
                    className="w-full h-10 px-3 bg-amber-50/80 border border-amber-300/60 hover:border-amber-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-300/20 rounded-[1rem] text-[13px] outline-none font-bold text-slate-800 transition-all duration-300"
                />
            </div>
        </div>
    );
};

export default FormEditPayrollEntry;
