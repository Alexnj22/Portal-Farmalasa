import React, { useMemo, useEffect, useState } from 'react';
import PortalInput from '../common/PortalInput';
import Button from '../common/Button';
import { Clock, CreditCard, CalendarOff } from 'lucide-react';
import { calcPayrollEntry } from '../../store/slices/payrollSlice';
import { fetchOvertimeBankRows } from '../../data/payroll';
import NocturnalLegalInfo from '../common/NocturnalLegalInfo';
import { formatMoney } from '../../utils/formatNumber';

const fmt    = (n) => formatMoney(n || 0);
const round2 = (n) => parseFloat((n || 0).toFixed(2));

// `InputLabel` y `glassInput` vivían acá: la etiqueta y el campo de PortalInput
// reescritos clase por clase. Los dos se fueron con el último campo migrado
// (2026-07-28). Los cuatro `<input>` del banco de horas pasaron al canónico el
// 2026-07-28: eran `PortalInput compact` con `tono`, sin etiqueta visible. La
// nota anterior decía que quedaban afuera a propósito — se escribió antes de
// que `label` fuera opcional, que era lo único que los dejaba fuera.


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

    // 2026-07-27: era `<InputLabel>` + `<input className={glassInput}>`, o sea el
    // canónico reconstruido a mano. Ahora sale de PortalInput; los 7 campos de
    // este formulario se benefician de una sola línea.
    const numField = (key, label) => (
        <PortalInput
            key={key}
            name={key}
            label={label}
            type="number"
            value={String(formData[key] ?? entry[key] ?? 0)}
            onChange={e => setFormData(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
            inputClassName="tabular-nums"
        />
    );

    const preview = useMemo(() =>
        calcPayrollEntry(emp, formData.days_worked ?? entry.days_worked ?? 15, formData),
    [emp, formData, entry.days_worked]);

    return (
        <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 bg-brand/5 border border-brand/15 rounded-2xl px-4 py-2.5">
                <p className="text-label font-black text-brand-text">
                    {emp.name} — Salario diario: ${daily.toFixed(2)}
                </p>
            </div>

            {/* OT Bank widget */}
            {hasBank && !otApplied && (
                <div className="col-span-2 bg-warning/10 border border-warning/30 rounded-2xl p-3.5 space-y-3">
                    <div className="flex items-center gap-2">
                        <Clock size={13} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                        <p className="text-micro font-black uppercase tracking-widest text-warning">Banco de Horas Extra</p>
                    </div>
                    <p className="text-micro text-warning-text">Distribuye cada tipo — puedes pagar una parte y compensar el resto.</p>

                    {/* Diurnal section */}
                    {otBank.diurnal > 0 && (
                        <div className="bg-surface-card border border-warning/30 rounded-xl p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-micro font-black uppercase tracking-widest text-warning-text">HE Diurnas</p>
                                <span className="text-body font-black text-warning-text">{otBank.diurnal.toFixed(1)}h</span>
                            </div>
                            {/* Estos cuatro NO pasan por PortalInput a propósito. El
                                color del borde no es decoración: dice de qué bolsa
                                sale la hora (diurna ámbar, nocturna chart-3) y qué se
                                hace con ella (compensar, chart-1). El canónico no
                                tiene eje de color, así que migrarlos borraría el dato.
                                Su `max` además es dinámico —el saldo del banco— que es
                                justo lo que se habría perdido antes de v2.115.0. */}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-micro font-black text-warning mb-1 flex items-center gap-1"><CreditCard size={8} strokeWidth={2.5} /> Pagar (h)</p>
                                    <PortalInput
                                        aria-label="Horas diurnas a pagar" compact tono="warning"
                                        type="number" step="0.5" min="0" max={otBank.diurnal}
                                        value={dPayInput} onChange={e => setDPayInput(e.target.value)}
                                        placeholder="0" inputClassName="font-black"
                                    />
                                </div>
                                <div>
                                    <p className="text-micro font-black text-chart-1-text mb-1 flex items-center gap-1"><CalendarOff size={8} strokeWidth={2.5} /> Compensar (h)</p>
                                    <PortalInput
                                        aria-label="Horas diurnas a compensar" compact tono="chart-1"
                                        type="number" step="0.5" min="0" max={otBank.diurnal}
                                        value={dCompInput} onChange={e => setDCompInput(e.target.value)}
                                        placeholder="0" inputClassName="font-black"
                                    />
                                </div>
                            </div>
                            {dUsed > 0 && (
                                <p className={`text-micro font-black ${dError ? 'text-danger' : 'text-content-3'}`}>
                                    {dError ? 'Excede el saldo diurno' : `Quedan en banco: ${dLeft.toFixed(1)}h`}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Nocturnal section */}
                    {otBank.nocturnal > 0 && (
                        <div className="bg-chart-3/10 border border-chart-3/30 rounded-xl p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="text-micro font-black uppercase tracking-widest text-chart-3-text">HE Nocturnas <span className="text-chart-3-text font-bold normal-case">(×2.25 si se pagan)</span></p>
                                <span className="text-body font-black text-chart-3-text">{otBank.nocturnal.toFixed(1)}h</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-micro font-black text-chart-3-text mb-1 flex items-center gap-1"><CreditCard size={8} strokeWidth={2.5} /> Pagar (h)</p>
                                    <PortalInput
                                        aria-label="Horas nocturnas a pagar" compact tono="chart-3"
                                        type="number" step="0.5" min="0" max={otBank.nocturnal}
                                        value={nPayInput} onChange={e => setNPayInput(e.target.value)}
                                        placeholder="0" inputClassName="font-black"
                                    />
                                </div>
                                <div>
                                    <p className="text-micro font-black text-chart-1-text mb-1 flex items-center gap-1"><CalendarOff size={8} strokeWidth={2.5} /> Compensar (h)</p>
                                    <PortalInput
                                        aria-label="Horas nocturnas a compensar" compact tono="chart-1"
                                        type="number" step="0.5" min="0" max={otBank.nocturnal}
                                        value={nCompInput} onChange={e => setNCompInput(e.target.value)}
                                        placeholder="0" inputClassName="font-black"
                                    />
                                </div>
                            </div>
                            {nUsed > 0 && (
                                <p className={`text-micro font-black ${nError ? 'text-danger' : 'text-content-3'}`}>
                                    {nError ? 'Excede el saldo nocturno' : `Quedan en banco: ${nLeft.toFixed(1)}h`}
                                </p>
                            )}
                        </div>
                    )}

                    <Button tone="warning" disabled={dError || nError || (dUsed === 0 && nUsed === 0)} onClick={handleApplyOT}>Aplicar distribución</Button>
                </div>
            )}
            {otApplied && (
                <div className="col-span-2 space-y-1.5">
                    {dPay  > 0 && <div className="bg-success/10 border border-success/30 rounded-2xl px-4 py-2.5"><p className="text-label font-black text-success-text">✓ {dPay.toFixed(1)}h diurnas → Hrs. Extra Diurnas (se pagan en esta planilla).</p></div>}
                    {nPay  > 0 && <div className="bg-chart-3/10 border border-chart-3/30 rounded-2xl px-4 py-2.5"><p className="text-label font-black text-chart-3-text">✓ {nPay.toFixed(1)}h nocturnas → Hrs. Extra Nocturnas ×2.25 (se pagan en esta planilla).</p></div>}
                    {(dComp > 0 || nComp > 0) && <div className="bg-chart-1/10 border border-chart-1/30 rounded-2xl px-4 py-2.5"><p className="text-label font-black text-chart-1-text">✓ {(dComp + nComp).toFixed(1)}h marcadas como tiempo compensado.</p></div>}
                    {(dLeft > 0 || nLeft > 0) && <div className="bg-warning/10 border border-warning/30 rounded-2xl px-4 py-2.5"><p className="text-label font-black text-warning-text">{(dLeft + nLeft).toFixed(1)}h permanecen en banco para la siguiente quincena.</p></div>}
                </div>
            )}

            {/* `InputLabel` + `<input className={glassInput}>` es PortalInput
                reconstruido a mano, igual que los 7 de `numField`. El `aria-label`
                se va porque ya no hace falta: la etiqueta queda asociada por
                `<label for>`. Y `min`/`max`/`step` sobreviven — antes del arreglo
                de v2.115.0 este campo habría perdido su tope de 16 días. */}
            <PortalInput
                colSpan={2}
                name="days_worked"
                label="Días Trabajados"
                type="number" step="0.5" min="0" max="16"
                value={String(formData.days_worked ?? entry.days_worked ?? 15)}
                onChange={e => setFormData(f => ({ ...f, days_worked: parseFloat(e.target.value) || 0 }))}
                inputClassName="tabular-nums"
            />

            <div className="col-span-2 pt-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3 flex items-center">
                    Horas adicionales <NocturnalLegalInfo />
                </p>
            </div>
            {numField('night_hours_ordinary',  'Hrs. Nocturnas Ord. (25%)')}
            {numField('night_hours_extra',     'Hrs. Noct. Extra (50%)')}
            {numField('extra_hours_diurnal',   'Hrs. Extra Diurnas')}
            {numField('extra_hours_nocturnal', 'Hrs. Extra Nocturnas')}

            <div className="col-span-2 pt-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3">Otros ingresos</p>
            </div>
            {numField('holiday_surcharge', 'Recargo de Asuetos ($)')}
            {numField('bonifications',     'Bonificaciones ($)')}
            {numField('vacation_bonus',    'Bono Vacacional ($)')}
            {numField('viaticos',          'Viáticos ($)')}
            <PortalInput
                colSpan={2}
                name="viaticos_detail"
                label="Detalle de Viáticos"
                value={formData.viaticos_detail ?? entry.viaticos_detail ?? ''}
                onChange={e => setFormData(f => ({ ...f, viaticos_detail: e.target.value }))}
                placeholder="Ej: Por 1 visita de supervisión $10.00"
            />

            <div className="col-span-2 pt-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3">Descuentos adicionales</p>
            </div>
            {numField('order_discount',  'Orden de Descuento ($)')}
            {numField('other_discounts', 'Otros Descuentos ($)')}
            {numField('salary_advance',  'Adelanto Salarial ($)')}

            {/* Live preview */}
            <div data-surface="card" className="col-span-2 p-4 mt-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3">Vista previa</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p className="text-micro text-content-3">Subtotal A</p>
                        <p className="text-body-lg font-black text-content">{fmt(preview.subtotal_a)}</p>
                    </div>
                    <div>
                        <p className="text-micro text-content-3">Deducciones</p>
                        <p className="text-body-lg font-black text-danger">{fmt(preview.total_deductions)}</p>
                    </div>
                    <div>
                        <p className="text-micro text-content-3">Líquido</p>
                        <p className="text-body-xl font-black text-success-text">{fmt(preview.net_pay)}</p>
                    </div>
                </div>
            </div>

            {/* Edit reason */}
            {/* El asterisco rojo a mano era una convención inventada acá; el
                canónico ya marca "Requerido" en su badge cuando falta, que es
                lo que el resto del portal muestra. */}
            <PortalInput
                colSpan={2}
                name="_reason"
                label="Motivo de edición"
                required
                value={formData._reason || ''}
                onChange={e => setFormData(f => ({ ...f, _reason: e.target.value }))}
                placeholder="Ej: Corrección de días por permiso autorizado"
            />
        </div>
    );
};

export default FormEditPayrollEntry;
