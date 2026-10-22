import React from 'react';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { problemaDeQuincena, quincenaPorDefecto, rotuloDePeriodo } from '@nucleo/utils/planilla';

const InputLabel = ({ children }) => (
    <p className="text-caption font-black text-content-3 uppercase tracking-widest mb-1.5 ml-1">{children}</p>
);

// Una quincena va del 1 al 15 o del 16 al último día del mes (decisión del
// dueño, 2026-10-22). Elegir cualquier día del inicio propone la quincena
// entera que lo contiene; el fin se puede tocar, pero si no cierra la quincena
// se avisa acá y `createPayrollPeriod` no la guarda (la base tampoco).
const FormNewPayrollPeriod = ({ formData = {}, setFormData }) => {
    const { start_date = '', end_date = '', pay_date = '' } = formData;
    const problema = (start_date || end_date) ? problemaDeQuincena(start_date, end_date) : null;
    const name = start_date && end_date && !problema ? rotuloDePeriodo(start_date, end_date) : '';

    return (
        <div className="space-y-5">
            {name && (
                <div className="bg-brand/8 border border-brand/15 rounded-2xl px-4 py-2.5">
                    <p className="text-label font-black text-brand-text">{name}</p>
                </div>
            )}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <InputLabel>Inicio del período</InputLabel>
                    <LiquidDatePicker value={start_date} onChange={val => setFormData(f => ({ ...f, ...(val ? quincenaPorDefecto(val) : { start_date: val }) }))} />
                </div>
                <div>
                    <InputLabel>Fin del período</InputLabel>
                    <LiquidDatePicker value={end_date} onChange={val => setFormData(f => ({ ...f, end_date: val }))} />
                </div>
            </div>
            {problema && <p className="text-caption font-bold text-danger-text ml-1">{problema}</p>}
            <div>
                <InputLabel>Fecha de pago</InputLabel>
                <LiquidDatePicker value={pay_date} onChange={val => setFormData(f => ({ ...f, pay_date: val }))} />
            </div>
        </div>
    );
};

export default FormNewPayrollPeriod;
