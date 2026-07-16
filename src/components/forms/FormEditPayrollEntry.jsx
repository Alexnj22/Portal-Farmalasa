import React, { useMemo, useEffect, useState } from 'react';
import { Info, Clock, CreditCard, CalendarOff } from 'lucide-react';
import { calcPayrollEntry } from '../../store/slices/payrollSlice';
import { fetchOvertimeBankRows } from '../../data/payroll';

const fmt    = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const round2 = (n) => parseFloat((n || 0).toFixed(2));

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

const glassInput = "w-full h-10 px-3 bg-white/60 border border-slate-200/80 hover:border-[#0052CC]/40 focus:border-[#0052CC]/50 focus:ring-4 focus:ring-[#0052CC]/10 rounded-[1rem] text-[16px] outline-none font-bold text-slate-800 transition-all duration-300 placeholder-slate-400 placeholder:font-normal";

const NocturnalLegalInfo = () => (
    <div className="relative group inline-flex items-center ml-1.5">
        <Info size={11} className="text-indigo-400 cursor-help" strokeWidth={2} />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-3 py-2.5 text-[10px] leading-relaxed shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
            <p className="font-black text-indigo-300 mb-1.5">Art. 168 — Código de Trabajo SV</p>
            <p className="text-slate-500 mb-1.5">Jornada nocturna: 19:00 – 06:00</p>
            <p className="text-slate-200">• Hrs. ordinarias nocturnas: <span className="text-indigo-300 font-bold">+25% recargo</span> sobre tarifa diurna</p>
            <p className="text-slate-200">• Hrs. extra nocturnas: <span className="text-indigo-300 font-bold">×2.25</span> (OT 100% + 25% noct.)</p>
            <p className="text-slate-200">• Jornada noct. máx: 7h/día, 39h/sem</p>
            <p className="text-slate-200">• Si &gt;4h son nocturnas → turno nocturno</p>
        </div>
    </div>
);

const EMPTY_OBJ = {};

const FormEditPayrollEntry = ({ formData = {}, setFormData }) => {
    const entry = formData._entry || EMPTY_OBJ;
    const emp   = entry.employee || EMPTY_OBJ;
    const daily = round2((emp.base_salary || 0) / 30);

    // Bank state per subtype: { diurnal: number|null, nocturnal: number|null }
    const [otBank,    setOtBank]    = useState(null); // null = loading
    // Diurnal split inputs
    const [dPayInput, setDPayInput] = useState('');
    const [dCompInput,setDCompInput]= useState('');
    // Nocturnal split inputs
    const [nPayInput, setNPayInput] = useState('');
    const [nCompInput,setNCompInput]= useState('');
    const [otApplied, setOtApplied] = useState(false);

    useEffect(() => {
        if (!emp.id) return;
        fetchOvertimeBankRows(emp.id)
            .then(({ data }) => {
                let diurnal = 0, nocturnal = 0;
                for (const row of data || []) {
                    const sign = row.type === 'EARNED' ? 1 : -1;
                    if (row.subtype === 'NOCTURNAL') nocturnal += sign * row.hours;
                    else                             diurnal   += sign * row.hours;
                }
                setOtBank({
                    diurnal:   parseFloat(Math.max(0, diurnal).toFixed(2)),
                    nocturnal: parseFloat(Math.max(0, nocturnal).toFixed(2)),
                });
            });
    }, [emp.id]);

    const dPay  = parseFloat(dPayInput)  || 0;
    const dComp = parseFloat(dCompInput) || 0;
    const nPay  = parseFloat(nPayInput)  || 0;
    const nComp = parseFloat(nCompInput) || 0;
    const dUsed = round2(dPay + dComp);
    const nUsed = round2(nPay + nComp);
    const dLeft = round2((otBank?.diurnal   || 0) - dUsed);
    const nLeft = round2((otBank?.nocturnal || 0) - nUsed);
    const dError = dUsed > (otBank?.diurnal   || 0) || dPay < 0 || dComp < 0;
    const nError = nUsed > (otBank?.nocturnal || 0) || nPay < 0 || nComp < 0;
    const hasBank = otBank && (otBank.diurnal > 0 || otBank.nocturnal > 0);

    const handleApplyOT = () => {
        if (dError || nError) return;
        if (dUsed === 0 && nUsed === 0) return;
        setFormData(f => ({
            ...f,
            extra_hours_diurnal:   dPay > 0 ? round2((f.extra_hours_diurnal   || entry.extra_hours_diurnal   || 0) + dPay) : (f.extra_hours_diurnal   ?? entry.extra_hours_diurnal   ?? 0),
            extra_hours_nocturnal: nPay > 0 ? round2((f.extra_hours_nocturnal || entry.extra_hours_nocturnal || 0) + nPay) : (f.extra_hours_nocturnal ?? entry.extra_hours_nocturnal ?? 0),
            _otBank: {
                dPay, dComp, nPay, nComp,
                diurnal: otBank?.diurnal, nocturnal: otBank?.nocturnal,
            },
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
    [emp, formData, entry.days_worked]);

    return (
        <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 bg-[#0052CC]/5 border border-[#0052CC]/15 rounded-2xl px-4 py-2.5">
                <p className="text-[11px] font-black text-[#0052CC]">
                    {emp.name} — Salario diario: ${daily.toFixed(2)}
                </p>
            </div>

            {/* OT Bank widget */}
            {hasBank && !otApplied && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-3">
                    <div className="flex items-center gap-2">
                        <Clock size={13} className="text-amber-500 flex-shrink-0" strokeWidth={2.5} />
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Banco de Horas Extra</p>
                    </div>
                    <p className="text-[9px] text-amber-500">Distribuye cada tipo — puedes pagar una parte y compensar el resto.</p>

                    {/* Diurnal section */}
                    {otBank.diurnal > 0 && (
                        <div className="bg-white/70 border border-amber-100 rounded-xl p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">HE Diurnas</p>
                                <span className="text-[13px] font-black text-amber-800">{otBank.diurnal.toFixed(1)}h</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[8px] font-black text-amber-600 mb-1 flex items-center gap-1"><CreditCard size={8} strokeWidth={2.5} /> Pagar (h)</p>
                                    <input type="number" step="0.5" min="0" max={otBank.diurnal} value={dPayInput} onChange={e => setDPayInput(e.target.value)} placeholder="0"
                                        className="w-full h-8 px-2.5 bg-white border border-amber-200 focus:border-amber-400 rounded-lg text-[16px] font-black text-amber-900 outline-none" />
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-blue-500 mb-1 flex items-center gap-1"><CalendarOff size={8} strokeWidth={2.5} /> Compensar (h)</p>
                                    <input type="number" step="0.5" min="0" max={otBank.diurnal} value={dCompInput} onChange={e => setDCompInput(e.target.value)} placeholder="0"
                                        className="w-full h-8 px-2.5 bg-white border border-blue-200 focus:border-blue-400 rounded-lg text-[16px] font-black text-blue-900 outline-none" />
                                </div>
                            </div>
                            {dUsed > 0 && (
                                <p className={`text-[9px] font-black ${dError ? 'text-red-500' : 'text-slate-500'}`}>
                                    {dError ? 'Excede el saldo diurno' : `Quedan en banco: ${dLeft.toFixed(1)}h`}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Nocturnal section */}
                    {otBank.nocturnal > 0 && (
                        <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-600">HE Nocturnas <span className="text-indigo-400 font-bold normal-case">(×2.25 si se pagan)</span></p>
                                <span className="text-[13px] font-black text-indigo-800">{otBank.nocturnal.toFixed(1)}h</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[8px] font-black text-indigo-600 mb-1 flex items-center gap-1"><CreditCard size={8} strokeWidth={2.5} /> Pagar (h)</p>
                                    <input type="number" step="0.5" min="0" max={otBank.nocturnal} value={nPayInput} onChange={e => setNPayInput(e.target.value)} placeholder="0"
                                        className="w-full h-8 px-2.5 bg-white border border-indigo-200 focus:border-indigo-400 rounded-lg text-[16px] font-black text-indigo-900 outline-none" />
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-blue-500 mb-1 flex items-center gap-1"><CalendarOff size={8} strokeWidth={2.5} /> Compensar (h)</p>
                                    <input type="number" step="0.5" min="0" max={otBank.nocturnal} value={nCompInput} onChange={e => setNCompInput(e.target.value)} placeholder="0"
                                        className="w-full h-8 px-2.5 bg-white border border-blue-200 focus:border-blue-400 rounded-lg text-[16px] font-black text-blue-900 outline-none" />
                                </div>
                            </div>
                            {nUsed > 0 && (
                                <p className={`text-[9px] font-black ${nError ? 'text-red-500' : 'text-slate-500'}`}>
                                    {nError ? 'Excede el saldo nocturno' : `Quedan en banco: ${nLeft.toFixed(1)}h`}
                                </p>
                            )}
                        </div>
                    )}

                    <button type="button" onClick={handleApplyOT}
                        disabled={dError || nError || (dUsed === 0 && nUsed === 0)}
                        className="w-full py-2 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                        Aplicar distribución
                    </button>
                </div>
            )}
            {otApplied && (
                <div className="col-span-2 space-y-1.5">
                    {dPay  > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5"><p className="text-[11px] font-black text-emerald-700">✓ {dPay.toFixed(1)}h diurnas → Hrs. Extra Diurnas (se pagan en esta planilla).</p></div>}
                    {nPay  > 0 && <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-2.5"><p className="text-[11px] font-black text-indigo-700">✓ {nPay.toFixed(1)}h nocturnas → Hrs. Extra Nocturnas ×2.25 (se pagan en esta planilla).</p></div>}
                    {(dComp > 0 || nComp > 0) && <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5"><p className="text-[11px] font-black text-blue-700">✓ {(dComp + nComp).toFixed(1)}h marcadas como tiempo compensado.</p></div>}
                    {(dLeft > 0 || nLeft > 0) && <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5"><p className="text-[11px] font-black text-amber-700">{(dLeft + nLeft).toFixed(1)}h permanecen en banco para la siguiente quincena.</p></div>}
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
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-3 flex items-center">
                    Horas adicionales <NocturnalLegalInfo />
                </p>
            </div>
            {numField('night_hours_ordinary',  'Hrs. Nocturnas Ord. (25%)')}
            {numField('night_hours_extra',     'Hrs. Noct. Extra (50%)')}
            {numField('extra_hours_diurnal',   'Hrs. Extra Diurnas')}
            {numField('extra_hours_nocturnal', 'Hrs. Extra Nocturnas')}

            <div className="col-span-2 pt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-3">Otros ingresos</p>
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
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-3">Descuentos adicionales</p>
            </div>
            {numField('order_discount',  'Orden de Descuento ($)')}
            {numField('other_discounts', 'Otros Descuentos ($)')}
            {numField('salary_advance',  'Adelanto Salarial ($)')}

            {/* Live preview */}
            <div className="col-span-2 bg-white/60 rounded-2xl p-4 border border-slate-200/60 mt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-3">Vista previa</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p className="text-[9px] text-slate-500">Subtotal A</p>
                        <p className="text-[14px] font-black text-slate-800">{fmt(preview.subtotal_a)}</p>
                    </div>
                    <div>
                        <p className="text-[9px] text-slate-500">Deducciones</p>
                        <p className="text-[14px] font-black text-red-600">{fmt(preview.total_deductions)}</p>
                    </div>
                    <div>
                        <p className="text-[9px] text-slate-500">Líquido</p>
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
                    className="w-full h-10 px-3 bg-amber-50/80 border border-amber-300/60 hover:border-amber-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-300/20 rounded-[1rem] text-[16px] outline-none font-bold text-slate-800 transition-all duration-300"
                />
            </div>
        </div>
    );
};

export default FormEditPayrollEntry;
