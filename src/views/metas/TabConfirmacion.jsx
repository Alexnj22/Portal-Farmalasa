import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Undo2, Sparkles, CalendarCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney } from '../../utils/formatNumber';
import {
    fetchMetasRows, fetchMetasHistorico, generarPropuestas,
    confirmarMeta, aprobarMeta, devolverMeta,
} from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, ymLabelCorto } from './metasUtils';

const ESTADO_CFG = {
    propuesta:             { label: 'Propuesta',              variante: 'chart-1' },
    confirmada_supervisor: { label: 'Espera aprobación',      variante: 'warning' },
    devuelta:              { label: 'Devuelta',               variante: 'danger' },
    oficial:               { label: 'Oficial',                variante: 'success' },
};

// El ciclo del mes siguiente: el supervisor ajusta y confirma, el gerente
// aprueba o devuelve con nota. También muestra el mes en curso si quedó
// alguna meta sin oficializar (el sistema nunca la oficializa solo).
export default function TabConfirmacion({ salaNombre, canEdit, canApprove, reloadKey, onChanged }) {
    const { showToast } = useToastStore();
    const ymActual = ymHoySV();
    const ymSig = ymSumar(ymActual, 1);

    const [rows, setRows] = useState([]);
    const [historico, setHistorico] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [montos, setMontos] = useState({});     // id → monto editado (texto)
    const [devolviendo, setDevolviendo] = useState(null); // id → abre el campo de nota
    const [notaDev, setNotaDev] = useState('');
    const [busy, setBusy] = useState(null);       // id (o 'generar') en vuelo

    const cargar = () => {
        let alive = true;
        setLoading(true);  
        setError(null);
        Promise.all([fetchMetasRows([ymActual, ymSig]), fetchMetasHistorico()])
            .then(([r, h]) => { if (alive) { setRows(r); setHistorico(h); setMontos({}); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el flujo')); setLoading(false); } });
        return () => { alive = false; };
    };
    useEffect(cargar, [reloadKey, ymActual, ymSig]);

    // Contexto por sala, derivado del histórico ya calculado: el mismo mes del
    // año pasado y el promedio de los últimos 3 meses cerrados.
    const contexto = useMemo(() => {
        const porSala = {};
        const ult3 = [ymSumar(ymActual, -1), ymSumar(ymActual, -2), ymSumar(ymActual, -3)];
        for (const h of historico) {
            const c = (porSala[h.branch_id] ||= { anioPasado: null, tres: [] });
            if (h.year_month === ymSumar(ymSig, -12)) c.anioPasado = Number(h.venta_total);
            if (ult3.includes(h.year_month)) c.tres.push(Number(h.venta_total));
        }
        for (const c of Object.values(porSala)) {
            c.prom3 = c.tres.length ? c.tres.reduce((s, v) => s + v, 0) / c.tres.length : null;
        }
        return porSala;
    }, [historico, ymActual, ymSig]);

    const delMesSig = rows.filter((r) => r.year_month === ymSig);
    const pendientesActual = rows.filter((r) => r.year_month === ymActual && r.estado !== 'oficial');

    const accion = async (fn, id, auditAction, auditDetails, okTitle, okBody) => {
        setBusy(id);
        try {
            await fn();
            useStaffStore.getState().appendAuditLog(auditAction, String(id), auditDetails);
            showToast(okTitle, okBody, 'success');
            onChanged?.();
            cargar();
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setBusy(null);
        }
    };

    const FilaMeta = ({ r }) => {
        const es = ESTADO_CFG[r.estado] || ESTADO_CFG.propuesta;
        const ctx = contexto[r.branch_id] || {};
        const editable = canEdit && ['propuesta', 'devuelta'].includes(r.estado);
        const montoActual = montos[r.id] ?? String(r.monto_meta ?? '');
        const montoNum = parseFloat(String(montoActual).replace(/,/g, ''));

        return (
            <article data-surface="card" className="p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                    <div>
                        <h3 className="text-body font-black leading-tight">{salaNombre(r.branch_id)}</h3>
                        <p className="text-caption font-bold text-content-3 uppercase tracking-widest mt-0.5">{ymLabelCorto(r.year_month)}</p>
                    </div>
                    <Badge variant={es.variante} size="sm">{es.label}</Badge>
                </div>

                {r.estado === 'devuelta' && r.nota_devolucion && (
                    <Notice variant="danger" className="mb-3">{r.nota_devolucion}</Notice>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Mismo mes, año pasado</p>
                        <p className="text-body-sm font-black tabular-nums">{ctx.anioPasado != null ? formatMoney(ctx.anioPasado) : '—'}</p>
                    </div>
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Promedio 3 meses</p>
                        <p className="text-body-sm font-black tabular-nums">{ctx.prom3 != null ? formatMoney(ctx.prom3) : '—'}</p>
                    </div>
                    {r.monto_propuesto != null && (
                        <div className="col-span-2">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3">Propuesta del sistema</p>
                            <p className="text-body-sm font-black tabular-nums text-chart-1-text">{formatMoney(r.monto_propuesto)}</p>
                        </div>
                    )}
                </div>

                {editable ? (
                    <PortalInput
                        label="Meta a confirmar" name={`monto-${r.id}`} prefix="$" type="number"
                        value={montoActual}
                        onChange={(e) => setMontos((m) => ({ ...m, [r.id]: e.target.value }))}
                    />
                ) : (
                    <div className="mb-1">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Meta</p>
                        <p className="text-xl font-black tabular-nums">{formatMoney(r.monto_meta)}</p>
                    </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                    {editable && (
                        <Button
                            variant="primary" icon={CheckCircle2}
                            disabled={busy != null || !Number.isFinite(montoNum) || montoNum <= 0}
                            onClick={() => accion(
                                () => confirmarMeta({ id: r.id, monto: montoNum }),
                                r.id, 'METAS_CONFIRMAR', { sala: salaNombre(r.branch_id), mes: r.year_month, monto: montoNum },
                                'Meta confirmada', `${salaNombre(r.branch_id)} · ${formatMoney(montoNum)}. Al confirmar todas, le llega al gerente.`,
                            )}
                        >
                            {busy === r.id ? 'Confirmando…' : 'Confirmar'}
                        </Button>
                    )}
                    {canApprove && r.estado === 'confirmada_supervisor' && (
                        <>
                            <Button
                                variant="primary" icon={CheckCircle2} disabled={busy != null}
                                onClick={() => accion(
                                    () => aprobarMeta(r.id),
                                    r.id, 'METAS_APROBAR', { sala: salaNombre(r.branch_id), mes: r.year_month, monto: r.monto_meta },
                                    'Meta aprobada', `${salaNombre(r.branch_id)} quedó oficial.`,
                                )}
                            >
                                {busy === r.id ? 'Aprobando…' : 'Aprobar'}
                            </Button>
                            <Button variant="secondary" icon={Undo2} disabled={busy != null}
                                onClick={() => { setDevolviendo(devolviendo === r.id ? null : r.id); setNotaDev(''); }}>
                                Devolver
                            </Button>
                        </>
                    )}
                </div>

                {devolviendo === r.id && (
                    <div className="mt-3 space-y-2">
                        <PortalInput
                            label="¿Por qué se devuelve?" name={`nota-dev-${r.id}`}
                            value={notaDev} onChange={(e) => setNotaDev(e.target.value)}
                            placeholder="Ej. la meta quedó baja para la temporada" required
                        />
                        <Button
                            variant="destructive" icon={Undo2}
                            disabled={busy != null || !notaDev.trim()}
                            onClick={() => accion(
                                () => devolverMeta({ id: r.id, nota: notaDev.trim() }),
                                r.id, 'METAS_DEVOLVER', { sala: salaNombre(r.branch_id), mes: r.year_month, nota: notaDev.trim() },
                                'Meta devuelta', 'Le llega la nota al supervisor para que la revise.',
                            )}
                        >
                            Devolver con esta nota
                        </Button>
                    </div>
                )}
            </article>
        );
    };

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} data-surface="card" className="p-5"><SkeletonText lines={5} /></div>)}
            </div>
        );
    }
    if (error) {
        return <div data-surface="card" className="p-8 text-center"><p className="text-body-sm font-bold text-danger-text">{error}</p></div>;
    }

    return (
        <div className="space-y-6">
            {pendientesActual.length > 0 && (
                <section className="space-y-3">
                    <Notice variant="warning" icon={CalendarCheck}>
                        {ymLabel(ymActual)} ya empezó y {pendientesActual.length === 1
                            ? 'una meta sigue sin oficializar'
                            : `${pendientesActual.length} metas siguen sin oficializar`} — las salas la ven como pendiente.
                    </Notice>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {pendientesActual.map((r) => <FilaMeta key={r.id} r={r} />)}
                    </div>
                </section>
            )}

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h2 className="text-body font-black">Metas de {ymLabel(ymSig).toLowerCase()}</h2>
                    {canEdit && delMesSig.length === 0 && (
                        <Button
                            variant="primary" icon={Sparkles} disabled={busy != null}
                            onClick={() => accion(
                                async () => { const n = await generarPropuestas(); if (!n) throw new Error('No había nada que proponer'); },
                                'generar', 'METAS_GENERAR_PROPUESTAS', { mes: ymSig },
                                'Propuestas listas', 'Revisa cada sala, ajusta el monto si hace falta y confirma.',
                            )}
                        >
                            {busy === 'generar' ? 'Calculando…' : 'Generar propuestas'}
                        </Button>
                    )}
                </div>

                {delMesSig.length === 0 ? (
                    <div data-surface="card" className="p-10 text-center">
                        <CalendarCheck size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm font-bold text-content-3 max-w-md mx-auto">
                            Todavía no hay metas para {ymLabel(ymSig).toLowerCase()}. El día 25 el
                            portal las propone solo{canEdit ? ', o genéralas ahora con el botón' : ''}.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {delMesSig.map((r) => <FilaMeta key={r.id} r={r} />)}
                    </div>
                )}
            </section>
        </div>
    );
}
