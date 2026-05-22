import React, { useMemo, useEffect, useState } from 'react';
import { Info, Clock, CreditCard, CalendarOff } from 'lucide-react';
import { calcPayrollEntry } from '../../store/slices/payrollSlice';
import { supabase } from '../../supabaseClient';

const fmt    = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const round2 = (n) => parseFloat((n || 0).toFixed(2));

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

const glassInput = "w-full h-10 px-3 bg-white/60 border border-slate-200/80 hover:border-[#0052CC]/40 focus:border-[#0052CC]/50 focus:ring-4 focus:ring-[#0052CC]/10 rounded-[1rem] text-[13px] outline-none font-bold text-slate-800 transition-all duration-300 placeholder-slate-400 placeholder:font-normal";

const NocturnalLegalInfo = () => (
    <div className="relative group inline-flex items-center ml-1.5">
        <Info size={11} className="text-indigo-400 cursor-help" strokeWidth={2} />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-3 py-2.5 text-[10px] leading-relaxed shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
            <p className="font-black text-indigo-300 mb-1.5">Art. 168 — Código de Trabajo SV</p>
            <p className="text-slate-300 mb-1.5">Jornada nocturna: 19:00 – 06:00</p>
            <p className="text-slate-200">• Hrs. ordinarias nocturnas: <span className="text-indigo-300 font-bold">+25% recargo</span> sobre tarifa diurna</p>
            <p className="text-slate-200">• Hrs. extra nocturnas: <span className="text-indigo-300 font-bold">×2.25</span> (OT 100% + 25% noct.)</p>
            <p className="text-slate-200">• Jornada noct. máx: 7h/día, 39h/sem</p>
            <p className="text-slate-200">• Si &gt;4h son nocturnas → turno nocturno</p>
        </div>
    </div>
);

const FormEditPayrollEntry = ({ formData = {}, setFormData }) => {
    const entry = formData._entry || {};
    const emp   = entry.employee || {};
    const daily = round2((emp.base_salary || 0) / 30);

    const [otBankHours, setOtBankHours] = useState(null); // null = loading
    const [otPayInput,  setOtPayInput]  = useState('');
    const [otCompInput, setOtCompInput] = useState('');
    const [otApplied,   setOtApplied]   = useState(false);

    useEffect(() => {
        if (!emp.id) return;
        supabase.from('overtime_bank').select('hours, type').eq('employee_id', emp.id)
            .then(({ data }) => {
                let pending = 0;
                for (const row of data || []) {
                    if (row.type === 'EARNED') pending += row.hours;
                    else                       pending -= row.hours;
                }
                setOtBankHours(parseFloat(Math.max(0, pending).toFixed(2)));
            });
    }, [emp.id]);

    const otPay  = parseFloat(otPayInput)  || 0;
    const otComp = parseFloat(otCompInput) || 0;
    const otUsed = round2(otPay + otComp);
    const otLeft = round2((otBankHours || 0) - otUsed);
    const otError = otUsed > (otBankHours || 0) || (otPay < 0) || (otComp < 0);

    const handleApplyOT = () => {
        if (otError || otUsed === 0) return;
        setFormData(f => ({
            ...f,
            extra_hours_diurnal: otPay > 0
                ? round2((f.extra_hours_diurnal || entry.extra_hours_diurnal || 0) + otPay)
                : (f.extra_hours_diurnal ?? entry.extra_hours_diurnal ?? 0),
            _otBankPayHours:  otPay  > 0 ? otPay  : undefined,
            _otBankCompHours: otComp > 0 ? otComp : undefined,
        }));
        setOtApplied(true);
    };

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
            <div className="col-span-2 bg-[#0052CC]/5 border border-[#0052CC]/15 rounded-2xl px-4 py-2.5">
                <p className="text-[11px] font-black text-[#0052CC]">
                    {emp.name} — Salario diario: ${daily.toFixed(2)}
                </p>
            </div>

            {/* OT Bank widget */}
            {otBankHours !== null && otBankHours > 0 && !otApplied && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Clock size={13} className="text-amber-500 flex-shrink-0" strokeWidth={2.5} />
                            <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Banco de Horas Extra</p>
                        </div>
                        <span className="text-[18px] font-black text-amber-800 leading-none">
                            {otBankHours.toFixed(1)}<span className="text-[10px] font-bold ml-1">h disponibles</span>
                        </span>
                    </div>
                    <p className="text-[9px] text-amber-500">Distribuye las horas — puedes pagar una parte y compensar el resto.</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 mb-1 flex items-center gap-1">
                                <CreditCard size={9} strokeWidth={2.5} /> Pagar (h)
                            </p>
                            <input type="number" step="0.5" min="0" max={otBankHours}
                                value={otPayInput}
                                onChange={e => setOtPayInput(e.target.value)}
                                placeholder="0"
                                className="w-full h-9 px-3 bg-white border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 rounded-xl text-[13px] font-black text-amber-900 outline-none transition-all" />
                        </div>
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-1 flex items-center gap-1">
                                <CalendarOff size={9} strokeWidth={2.5} /> Tiempo comp. (h)
                            </p>
                            <input type="number" step="0.5" min="0" max={otBankHours}
                                value={otCompInput}
                                onChange={e => setOtCompInput(e.target.value)}
                                placeholder="0"
                                className="w-full h-9 px-3 bg-white border border-blue-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 rounded-xl text-[13px] font-black text-blue-900 outline-none transition-all" />
                        </div>
                    </div>
                    {otUsed > 0 && (
                        <div className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-[10px] font-black ${otError ? 'bg-red-100 text-red-600 border border-red-200' : 'bg-white/70 text-slate-600 border border-amber-100'}`}>
                            <span>Usadas: {otUsed.toFixed(1)}h · Quedan en banco: {otError ? '—' : `${otLeft.toFixed(1)}h`}</span>
                            {otError && <span className="text-red-500">Excede el saldo</span>}
                        </div>
                    )}
                    <button type="button" onClick={handleApplyOT}
                        disabled={otError || otUsed === 0}
                        className="w-full py-2 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                        Aplicar distribución
                    </button>
                </div>
            )}
            {otApplied && (
                <div className="col-span-2 space-y-1.5">
                    {otPay > 0 && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5">
                            <p className="text-[11px] font-black text-emerald-700">
                                ✓ {otPay.toFixed(1)}h añadidas a Hrs. Extra Diurnas — se pagarán en esta planilla.
                            </p>
                        </div>
                    )}
                    {otComp > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5">
                            <p className="text-[11px] font-black text-blue-700">
                                ✓ {otComp.toFixed(1)}h marcadas como tiempo compensado — quedan en banco para programar.
                            </p>
                        </div>
                    )}
                    {otLeft > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5">
                            <p className="text-[11px] font-black text-amber-700">
                                {otLeft.toFixed(1)}h permanecen en banco para la siguiente quincena.
                            </p>
                        </div>
                    )}
                </div>
            )}

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
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center">
                    Horas adicionales <NocturnalLegalInfo />
                </p>
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
