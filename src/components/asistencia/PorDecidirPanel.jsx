/* Lo que Talento Humano tiene que decidir de la quincena (reglas de pago del
 * 2026-11-23, `utils/reglasDePago.js`):
 *
 *  · las horas de más de cada día: a pago o al banco (CT Art. 169/170). Sin
 *    decidir, la planilla no las paga ni las banca;
 *  · las semanas en que se propone perder el pago del descanso: más de 10 min
 *    tarde en la semana o una ausencia sin justificar (RIT Arts. 25 y 26,
 *    CT Art. 171). Sin confirmar, no descuenta nada.
 *
 * Vive en Auditoría de tiempos, que es donde Talento Humano ya revisa la
 * quincena: no es un módulo nuevo. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Scale, Loader2 } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import AvatarConEstado from '../common/AvatarConEstado';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import {
    fetchTimesheetsForPeriod, fetchDecisionesDeDescanso, decidirHorasExtra, decidirDescansoSemanal,
} from '@nucleo/data/payroll';
import {
    semanasConDescansoEnDuda, motivoDelDescanso, lunesDe, domingoDe, claseDeDia,
    DECISION_EXTRA, DECISION_DESCANSO,
} from '@nucleo/utils/reglasDePago';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';

const horas = (h) => `${Number(h).toFixed(2).replace(/\.?0+$/, '')} h`;
const CLASE = { ASUETO: 'Asueto', DESCANSO: 'Día de descanso' };

export default function PorDecidirPanel({ desde, hasta, empleados, canEdit, enDemo = false }) {
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const showToast = useToastStore(s => s.showToast);
    const [dias, setDias] = useState([]);
    const [decisiones, setDecisiones] = useState([]);
    const [ocupado, setOcupado] = useState(null);
    const [error, setError] = useState(null);

    // `version` sube después de cada decisión y vuelve a leer.
    const [version, setVersion] = useState(0);
    const cargar = useCallback(() => setVersion(v => v + 1), []);
    useEffect(() => {
        if (enDemo) return undefined;
        let cancelado = false;
        const lunes = lunesDe(desde);
        Promise.all([fetchTimesheetsForPeriod(lunes, hasta), fetchDecisionesDeDescanso(lunes, hasta)])
            .then(([ts, dec]) => {
                if (cancelado) return;
                if (ts.error || dec.error) { setError(mensajeAmigable(ts.error || dec.error)); return; }
                setError(null);
                setDias(ts.data || []);
                setDecisiones(dec.data || []);
            });
        return () => { cancelado = true; };
    }, [desde, hasta, enDemo, version]);

    const porId = useMemo(() => new Map((empleados || []).map(e => [String(e.id), e])), [empleados]);

    // Sólo las personas que la vista está mostrando (filtro de sucursal).
    const extras = useMemo(() => dias
        .filter(d => String(d.work_date).slice(0, 10) >= desde && Number(d.overtime_hours) > 0 && !d.extra_decision)
        .filter(d => porId.has(String(d.employee_id))), [dias, desde, porId]);
    const semanas = useMemo(() => semanasConDescansoEnDuda(dias, decisiones, { desde, hasta })
        .filter(s => !s.decision && porId.has(String(s.employee_id))), [dias, decisiones, desde, hasta, porId]);

    const decidirExtra = async (dia, decision) => {
        setOcupado(`x-${dia.id}`);
        const { error: e } = await decidirHorasExtra([dia.id], decision);
        setOcupado(null);
        if (e) { showToast('No se guardó', mensajeAmigable(e), 'error'); return; }
        await appendAuditLog('DECIDIR_HORAS_EXTRA', dia.id, {
            employee_id: dia.employee_id, fecha: dia.work_date, horas: dia.overtime_hours, decision,
            regla: 'CT Art. 169/170',
        });
        showToast('Listo', decision === DECISION_EXTRA.PAGO ? 'Esas horas se pagan en la planilla.' : 'Esas horas van al banco de horas.', 'success');
        cargar();
    };

    const decidirSemana = async (s, decision) => {
        setOcupado(`s-${s.employee_id}-${s.semana}`);
        const { error: e } = await decidirDescansoSemanal({
            employeeId: s.employee_id, semana: s.semana, decision, motivo: s.motivo, minutosTarde: s.minutosTarde,
        });
        setOcupado(null);
        if (e) { showToast('No se guardó', mensajeAmigable(e), 'error'); return; }
        await appendAuditLog('DECIDIR_DESCANSO_SEMANAL', s.employee_id, {
            semana: s.semana, decision, motivo: s.motivo, minutos_tarde: s.minutosTarde,
            regla: 'RIT Arts. 25 y 26, CT Art. 171',
        });
        showToast('Listo', decision === DECISION_DESCANSO.PIERDE ? 'Se descuenta el descanso de esa semana.' : 'La semana queda justificada.', 'success');
        cargar();
    };

    if (enDemo || (!error && extras.length === 0 && semanas.length === 0)) return null;

    const Persona = ({ id }) => {
        const emp = porId.get(String(id));
        return (
            <div className="flex items-center gap-2 min-w-0">
                {emp && <AvatarConEstado emp={emp} px={28} marco="" />}
                <span className="text-label font-bold text-content truncate">{emp ? shortEmployeeName(emp) : '—'}</span>
            </div>
        );
    };

    return (
        <div className="bg-warning/10 border border-warning/30 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-warning/30 flex items-center gap-2">
                <Scale size={14} className="text-warning-text" strokeWidth={2.5} />
                <span className="text-label font-black text-warning-text uppercase tracking-widest">Por decidir</span>
                <Badge variant="warning" tone="solid" size="sm" uppercase={false}>{extras.length + semanas.length}</Badge>
            </div>
            {error && <p className="px-5 py-3 text-label text-danger-text">{error}</p>}

            {extras.length > 0 && (
                <div className="divide-y divide-warning/20">
                    <p className="px-5 pt-3 pb-1 text-caption text-content-2">
                        Horas de más. Decide si se pagan con su recargo o van al banco de horas.
                    </p>
                    {extras.map(d => {
                        const clase = claseDeDia(d);
                        const busy = ocupado === `x-${d.id}`;
                        return (
                            <div key={d.id} className="px-5 py-3 flex flex-wrap items-center gap-3 justify-between">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <Persona id={d.employee_id} />
                                    <span className="text-caption text-content-2">
                                        {fechaTexto(d.work_date, { weekday: 'long', day: 'numeric', month: 'long' })} · {horas(d.overtime_hours)} de más
                                        {Number(d.nocturnal_overtime_hours) > 0 && ` (${horas(d.nocturnal_overtime_hours)} de noche)`}
                                        {CLASE[clase] && ` · ${CLASE[clase]}`}
                                    </span>
                                </div>
                                {canEdit && (
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decidirExtra(d, DECISION_EXTRA.PAGO)}>
                                            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Pagar'}
                                        </Button>
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decidirExtra(d, DECISION_EXTRA.BANCO)}>
                                            Al banco
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {semanas.length > 0 && (
                <div className="divide-y divide-warning/20 border-t border-warning/20">
                    <p className="px-5 pt-3 pb-1 text-caption text-content-2">
                        Descanso semanal en duda. Si lo confirmas, se descuenta el pago del descanso de esa semana. Los minutos tarde nunca se descuentan.
                    </p>
                    {semanas.map(s => {
                        const busy = ocupado === `s-${s.employee_id}-${s.semana}`;
                        return (
                            <div key={`${s.employee_id}-${s.semana}`} className="px-5 py-3 flex flex-wrap items-center gap-3 justify-between">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <Persona id={s.employee_id} />
                                    <span className="text-caption text-content-2">
                                        Semana del {fechaTexto(s.semana, { day: 'numeric', month: 'short' })} al {fechaTexto(domingoDe(s.semana), { day: 'numeric', month: 'short' })} · {motivoDelDescanso(s)}
                                    </span>
                                </div>
                                {canEdit && (
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decidirSemana(s, DECISION_DESCANSO.PIERDE)}>
                                            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Pierde el descanso'}
                                        </Button>
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decidirSemana(s, DECISION_DESCANSO.JUSTIFICADO)}>
                                            Justificar
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
