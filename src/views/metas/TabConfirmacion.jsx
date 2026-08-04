import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Undo2, Sparkles, CalendarCheck, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
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
export default function TabConfirmacion({ salaNombre, canEdit, canApprove, reloadKey, onChanged, searchTerm, onClearSearch }) {
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

    // El buscador de la barra es UNO solo para las tres pestañas, así que acá
    // también tiene que filtrar: si no, escribir el nombre de una sala no
    // cambia nada y el control miente.
    const coincide = useCallback(
        (r) => {
            const q = searchTerm?.trim().toLowerCase();
            if (!q) return true;
            return (salaNombre(r.branch_id) || '').toLowerCase().includes(q);
        },
        [searchTerm, salaNombre],
    );

    const delMesSig = rows.filter((r) => r.year_month === ymSig && coincide(r));
    // El aviso cuenta TODAS las pendientes del mes: es un hecho del mes, no del
    // filtro. Las tarjetas de abajo sí siguen al buscador.
    const pendientesTodas = rows.filter((r) => r.year_month === ymActual && r.estado !== 'oficial');
    const pendientesActual = pendientesTodas.filter(coincide);
    // Sin filtrar: distingue «no hay propuestas» de «el buscador las escondió».
    const hayDelMesSig = rows.some((r) => r.year_month === ymSig);

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
        return (
            <EmptyState
                compact icon={AlertTriangle}
                iconClass="text-danger" glowClass="bg-danger/30"
                title="No se pudo cargar el flujo"
                subtitle={error}
                action={<Button variant="secondary" icon={RefreshCw} onClick={cargar}>Reintentar</Button>}
            />
        );
    }

    return (
        <div className="space-y-6">
            {pendientesTodas.length > 0 && (
                <section className="space-y-3">
                    <Notice variant="warning" icon={CalendarCheck}>
                        {ymLabel(ymActual)} ya empezó y {pendientesTodas.length === 1
                            ? 'una meta sigue sin oficializar'
                            : `${pendientesTodas.length} metas siguen sin oficializar`} — las salas la ven como pendiente.
                    </Notice>
                    {pendientesActual.length === 0 ? (
                        <EmptyState
                            compact icon={Search}
                            title="Sin resultados"
                            subtitle={`Ninguna de las ${pendientesTodas.length} metas sin oficializar coincide con "${searchTerm?.trim()}".`}
                            action={onClearSearch && (
                                <Button variant="secondary" onClick={onClearSearch}>Limpiar la búsqueda</Button>
                            )}
                        />
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {pendientesActual.map((r) => <FilaMeta key={r.id} r={r} />)}
                        </div>
                    )}
                </section>
            )}

            <section className="space-y-3">
                {/* El encabezado solo cuando hay algo que encabezar: con la
                    sección vacía, el `EmptyState` ya dice de qué mes habla, y el
                    h2 quedaba colgado arriba a la izquierda repitiéndolo. */}
                {delMesSig.length > 0 && (
                    <h2 className="text-body font-black">Metas de {ymLabel(ymSig).toLowerCase()}</h2>
                )}

                {/* «Generar propuestas» vive DENTRO del vacío y no suelto en el
                    encabezado: es la salida de ese estado (§18.1), y las dos
                    condiciones eran la misma —sin metas del mes siguiente no hay
                    nada que listar—, así que el botón nunca aparecía sin esta
                    tarjeta debajo. Suelto arriba se leía como una acción de la
                    sección entera. */}
                {delMesSig.length === 0 ? (
                    hayDelMesSig ? (
                        <EmptyState
                            compact icon={Search}
                            title="Sin resultados"
                            subtitle={`Hay metas para ${ymLabel(ymSig).toLowerCase()}, pero ninguna coincide con "${searchTerm?.trim()}".`}
                            action={onClearSearch && (
                                <Button variant="secondary" onClick={onClearSearch}>Limpiar la búsqueda</Button>
                            )}
                        />
                    ) : (
                        <EmptyState
                            compact icon={CalendarCheck}
                            title={`Sin metas para ${ymLabel(ymSig).toLowerCase()}`}
                            subtitle="El día 25 el portal las propone solo, con las ventas de los meses cerrados."
                            action={canEdit && (
                                <Button
                                    variant="primary" icon={Sparkles} disabled={busy != null}
                                    onClick={() => accion(
                                        async () => { const n = await generarPropuestas(); if (!n) throw new Error('No había nada que proponer'); },
                                        'generar', 'METAS_GENERAR_PROPUESTAS', { mes: ymSig },
                                        'Propuestas listas', 'Revisa cada sala, ajusta el monto si hace falta y confirma.',
                                    )}
                                >
                                    {busy === 'generar' ? 'Calculando…' : 'Generar propuestas ahora'}
                                </Button>
                            )}
                        />
                    )
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {delMesSig.map((r) => <FilaMeta key={r.id} r={r} />)}
                    </div>
                )}
            </section>
        </div>
    );
}
