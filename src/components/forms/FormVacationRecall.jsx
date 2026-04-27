import React, { useMemo } from 'react';
import { AlertTriangle, Calendar, Clock, FileText, Palmtree } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidAvatar from '../common/LiquidAvatar';
import { useStaffStore } from '../../store/staffStore';
import { formatDate } from '../../utils/helpers';

const FormVacationRecall = ({ formData, setFormData }) => {
    const { shifts } = useStaffStore();

    const emp = formData?.employee;

    // Detectar el rango de vacaciones activo desde el historial
    const activeVacation = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return (emp?.history || []).find(h =>
            h.type === 'VACATION' &&
            h.date <= today &&
            (h.metadata?.endDate >= today || !h.metadata?.endDate) &&
            h.metadata?.status !== 'CANCELLED'
        );
    }, [emp]);

    const vacStart = activeVacation?.date || formData?.vacStart;
    const vacEnd   = activeVacation?.metadata?.endDate || formData?.vacEnd;

    const shiftOptions = useMemo(() =>
        (shifts || []).map(s => ({ value: String(s.id), label: `${s.name} (${s.start} – ${s.end})` })),
        [shifts]
    );

    const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

    const inputClass = "w-full bg-white border border-slate-200 rounded-[1rem] px-4 py-2.5 text-[13px] font-semibold text-slate-700 outline-none focus:border-[#007AFF]/50 focus:ring-2 focus:ring-[#007AFF]/10 resize-none";
    const labelClass = "text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block";

    return (
        <div className="space-y-4">
            {/* Alerta */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">Ingreso durante Vacaciones</p>
                    <p className="text-[11px] text-amber-700/80 mt-0.5 leading-snug">
                        Este colaborador está de vacaciones. Al autorizar su ingreso, las horas trabajadas quedarán registradas como <b>horas debidas</b> a su favor.
                    </p>
                </div>
            </div>

            {/* Info empleado */}
            {emp && (
                <div className="bg-white/70 border border-white/80 rounded-2xl p-4 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
                        <LiquidAvatar src={emp.photo_url || emp.photo} alt={emp.name} fallbackText={emp.name} className="w-full h-full" />
                    </div>
                    <div>
                        <p className="text-[13px] font-black text-slate-800">{emp.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            <Palmtree size={10} className="text-emerald-500" strokeWidth={2.5} />
                            <span className="text-[10px] text-emerald-600 font-bold">
                                Vacaciones: {vacStart ? formatDate(vacStart) : '—'} → {vacEnd ? formatDate(vacEnd) : '—'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Fecha de ingreso */}
            <div>
                <label className={labelClass}>Fecha de Ingreso</label>
                <LiquidDatePicker
                    value={formData?.recall_date || ''}
                    onChange={val => set('recall_date', val)}
                    icon={Calendar}
                    placeholder="Seleccionar fecha..."
                />
                {vacStart && vacEnd && formData?.recall_date &&
                    (formData.recall_date < vacStart || formData.recall_date > vacEnd) && (
                    <p className="text-[10px] text-red-500 font-bold mt-1 ml-1">
                        ⚠ La fecha debe estar dentro del período de vacaciones ({formatDate(vacStart)} – {formatDate(vacEnd)})
                    </p>
                )}
            </div>

            {/* Turno a asignar */}
            <div>
                <label className={labelClass}>Turno a Trabajar</label>
                <LiquidSelect
                    value={formData?.recall_shift_id || ''}
                    onChange={val => set('recall_shift_id', val)}
                    options={shiftOptions}
                    placeholder="Seleccionar turno..."
                    icon={Clock}
                    menuPosition="fixed"
                />
            </div>

            {/* Motivo */}
            <div>
                <label className={labelClass}>Motivo / Autorización</label>
                <textarea
                    rows={3}
                    className={inputClass}
                    placeholder="Ej: Urgencia operativa, cobertura de sucursal, evento especial..."
                    value={formData?.recall_reason || ''}
                    onChange={e => set('recall_reason', e.target.value)}
                />
            </div>

            {/* Nota informativa */}
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 flex gap-2">
                <FileText size={13} className="text-blue-400 shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-[10px] text-blue-600 leading-snug">
                    Las horas trabajadas se calcularán automáticamente según el turno seleccionado y se acumularán en el saldo de horas debidas del colaborador.
                </p>
            </div>
        </div>
    );
};

export default FormVacationRecall;
