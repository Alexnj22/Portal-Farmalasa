import React, { useMemo } from 'react';
import LiquidDatePicker from '../common/LiquidDatePicker';

const InputLabel = ({ children }) => (
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

function periodLabel(start, end) {
    if (!start || !end) return '';
    const s = new Date(start + 'T12:00:00');
    const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
    const m = cap(s.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' }));
    if (s.getDate() === 1)  return `Primera Quincena de ${m}`;
    if (s.getDate() === 16) return `Segunda Quincena de ${m}`;
    return `${s.toLocaleDateString('es-SV')} — ${new Date(end + 'T12:00:00').toLocaleDateString('es-SV')}`;
}

const FormNewPayrollPeriod = ({ formData = {}, setFormData }) => {
    const { start_date = '', end_date = '', pay_date = '' } = formData;
    const name = useMemo(() => periodLabel(start_date, end_date), [start_date, end_date]);

    return (
        <div className="space-y-5">
            {name && (
                <div className="bg-[#007AFF]/8 border border-[#007AFF]/15 rounded-2xl px-4 py-2.5">
                    <p className="text-[11px] font-black text-[#007AFF]">{name}</p>
                </div>
            )}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <InputLabel>Inicio del período</InputLabel>
                    <LiquidDatePicker value={start_date} onChange={val => setFormData(f => ({ ...f, start_date: val }))} />
                </div>
                <div>
                    <InputLabel>Fin del período</InputLabel>
                    <LiquidDatePicker value={end_date} onChange={val => setFormData(f => ({ ...f, end_date: val }))} />
                </div>
            </div>
            <div>
                <InputLabel>Fecha de pago</InputLabel>
                <LiquidDatePicker value={pay_date} onChange={val => setFormData(f => ({ ...f, pay_date: val }))} />
            </div>
        </div>
    );
};

export default FormNewPayrollPeriod;
