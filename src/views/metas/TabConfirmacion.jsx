import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Undo2, Sparkles, CalendarCheck, AlertTriangle, RefreshCw, Search, Minus, Plus, ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import {
    fetchMetasRows, fetchMetasHistorico, generarPropuestas,
    confirmarMeta, aprobarMeta, devolverMeta,
    fetchAutorizadores, aprobarMetaPorAutorizacion,
} from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, ymLabelCorto, diaHoySV, TRAMO_CFG } from './metasUtils';

// Un toque = 1% sobre la propuesta, y el recorrido se topa en ±10%: más que eso
// no es ajustar una meta, es escribir otra — y para eso está devolverla.
const PASO_FACTOR = 0.01;
const PASOS_MAX = 10;

const ESTADO_CFG = {
    propuesta:             { label: 'Propuesta',              variante: 'chart-1' },
    confirmada_supervisor: { label: 'Espera aprobación',      variante: 'warning' },
    devuelta:              { label: 'Devuelta',               variante: 'danger' },
    oficial:               { label: 'Oficial',                variante: 'success' },
};

// El ciclo del mes siguiente: el supervisor ajusta y confirma, el gerente
// aprueba o devuelve con nota. También muestra el mes en curso si quedó
// alguna meta sin oficializar (el sistema nunca la oficializa solo).
export default function TabConfirmacion({ salaNombre, canEdit, canApprove, reloadKey, onChanged, searchTerm, onClearSearch, diaPropuesta = 25 }) {
    const { showToast } = useToastStore();
    const ymActual = ymHoySV();
    const ymSig = ymSumar(ymActual, 1);

    const [rows, setRows] = useState([]);
    const [historico, setHistorico] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // id → pasos de ajuste sobre la propuesta. Se guardan los PASOS y no el
    // monto: el supervisor no teclea una cifra, corre la exigencia.
    const [ajustes, setAjustes] = useState({});
    const [devolviendo, setDevolviendo] = useState(null); // id → abre el campo de nota
    const [notaDev, setNotaDev] = useState('');
    const [autorizando, setAutorizando] = useState(null); // id → abre el registro de autorización
    const [notaAut, setNotaAut] = useState('');
    const [quienAut, setQuienAut] = useState('');
    const [autorizadores, setAutorizadores] = useState([]);
    const [busy, setBusy] = useState(null);       // id (o 'generar') en vuelo

    const cargar = () => {
        let alive = true;
        setLoading(true);  
        setError(null);
        Promise.all([fetchMetasRows([ymActual, ymSig]), fetchMetasHistorico()])
            .then(([r, h]) => { if (alive) { setRows(r); setHistorico(h); setAjustes({}); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el flujo')); setLoading(false); } });
        return () => { alive = false; };
    };
    useEffect(cargar, [reloadKey, ymActual, ymSig]);

    // La lista de gerentes se pide una vez: alimenta el selector de «quién
    // autorizó» y también resuelve el nombre en las metas ya asentadas.
    useEffect(() => {
        let alive = true;
        fetchAutorizadores()
            .then((a) => { if (alive) setAutorizadores(a); })
            .catch(() => { /* sin lista: el botón queda sin opciones y no se puede registrar */ });
        return () => { alive = false; };
    }, []);

    // Contexto por sala, derivado del histórico ya calculado: el mismo mes del
    // año pasado, el promedio de los últimos 3 meses cerrados y en cuánto cerró
    // el mes pasado — que es el dato con el que uno decide si el monto propuesto
    // es alcanzable o no.
    const ymPasado = ymSumar(ymActual, -1);
    const contexto = useMemo(() => {
        const porSala = {};
        const ult3 = [ymSumar(ymActual, -1), ymSumar(ymActual, -2), ymSumar(ymActual, -3)];
        for (const h of historico) {
            const c = (porSala[h.branch_id] ||= { anioPasado: null, tres: [] });
            if (h.year_month === ymSumar(ymSig, -12)) c.anioPasado = Number(h.venta_total);
            if (ult3.includes(h.year_month)) c.tres.push(Number(h.venta_total));
            if (h.year_month === ymPasado) {
                c.pctPasado = h.pct_cumplimiento != null ? Number(h.pct_cumplimiento) : null;
                c.tierPasado = h.bono_tier || null;
                c.metaPasada = h.monto_meta != null ? Number(h.monto_meta) : null;
            }
        }
        for (const c of Object.values(porSala)) {
            c.prom3 = c.tres.length ? c.tres.reduce((s, v) => s + v, 0) / c.tres.length : null;
        }
        return porSala;
    }, [historico, ymActual, ymSig, ymPasado]);

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

    // El mes siguiente no se muestra antes de que el portal lo proponga: hasta
    // el día `dia_propuesta` no hay nada que confirmar ahí, y la sección salía
    // igual, con un vacío que invitaba a generar las metas de un mes cuyos datos
    // de cálculo todavía no existen (pedido del usuario 2026-08-04: «apenas es 4
    // de agosto, cómo se va a calcular algo ya»).
    const mostrarMesSig = hayDelMesSig || diaHoySV() >= diaPropuesta;

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
        // La base es lo que propuso el portal; si la meta se creó a mano, ella
        // misma. El ajuste corre desde ahí, no desde un campo en blanco.
        const base = Number(r.monto_propuesto ?? r.monto_meta ?? 0);
        const pasos = ajustes[r.id] ?? 0;
        const montoNum = base > 0 ? Math.round(base * (1 + PASO_FACTOR * pasos) * 100) / 100 : 0;
        const mover = (d) => setAjustes((a) => ({
            ...a, [r.id]: Math.max(-PASOS_MAX, Math.min(PASOS_MAX, pasos + d)),
        }));

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
                    {/* En cuánto cerró el mes pasado: es con lo que uno decide si
                        el monto propuesto es alcanzable. Sin meta ese mes no hay
                        porcentaje que mostrar, y decirlo es más honesto que un
                        guion suelto. */}
                    <div className="col-span-2">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">
                            Cerró {ymLabelCorto(ymPasado)}
                        </p>
                        {ctx.pctPasado != null ? (
                            <p className="text-body-sm font-black tabular-nums">
                                <span className={TRAMO_CFG[ctx.tierPasado]?.textCls || ''}>{formatPct(ctx.pctPasado)}</span>
                                <span className="text-content-3 font-semibold"> de su meta de {formatMoney(ctx.metaPasada)}</span>
                            </p>
                        ) : (
                            <p className="text-body-sm font-semibold text-content-3">Ese mes no tuvo meta</p>
                        )}
                    </div>
                    {r.monto_propuesto != null && (
                        <div className="col-span-2">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3">Propuesta del sistema</p>
                            <p className="text-body-sm font-black tabular-nums text-chart-1-text">{formatMoney(r.monto_propuesto)}</p>
                        </div>
                    )}
                </div>

                {editable ? (
                    /* No se teclea el monto: se corre la exigencia. Un campo libre
                       invita a inventar una cifra redonda y pierde el cálculo que
                       hay detrás; acá cada toque es 1% sobre la propuesta y el
                       monto se ve en dinero, con sus separadores. */
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Meta a confirmar</p>
                        <p className="text-xl font-black tabular-nums mt-0.5">{formatMoney(montoNum)}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Button variant="secondary" size="sm" icon={Minus}
                                disabled={busy != null || pasos <= -PASOS_MAX}
                                onClick={() => mover(-1)}>
                                Menos exigente
                            </Button>
                            <Button variant="secondary" size="sm" icon={Plus}
                                disabled={busy != null || pasos >= PASOS_MAX}
                                onClick={() => mover(1)}>
                                Más exigente
                            </Button>
                            {pasos !== 0 && (
                                <Badge variant={pasos > 0 ? 'warning' : 'neutral'} size="sm">
                                    {pasos > 0 ? '+' : ''}{pasos}% sobre la propuesta
                                </Badge>
                            )}
                        </div>
                    </div>
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
                    {/* El camino para cuando el gerente autoriza de palabra y no
                        entra al portal. Solo aparece a quien NO puede aprobar:
                        el que sí puede, aprueba y listo. */}
                    {!canApprove && canEdit && r.estado === 'confirmada_supervisor' && (
                        <Button variant="secondary" icon={ShieldCheck} disabled={busy != null}
                            onClick={() => { setAutorizando(autorizando === r.id ? null : r.id); setNotaAut(''); setQuienAut(''); }}>
                            Registrar autorización del gerente
                        </Button>
                    )}
                </div>

                {autorizando === r.id && (
                    <div data-surface="card" data-tono="warning" className="mt-3 p-3 space-y-2">
                        <p className="text-label font-semibold text-content-2">
                            Esto la deja oficial. Queda asentado que la ejecutaste vos con
                            autorización de quien elijas, y a esa persona le llega el aviso.
                        </p>
                        <LiquidSelect
                            value={quienAut} onChange={setQuienAut}
                            options={autorizadores.map((a) => ({ value: a.id, label: a.name }))}
                            placeholder="¿Quién autorizó?"
                        />
                        <PortalInput
                            label="¿Cómo lo autorizó?" name={`nota-aut-${r.id}`}
                            value={notaAut} onChange={(e) => setNotaAut(e.target.value)}
                            placeholder="Ej. lo aprobó por teléfono el 4 de agosto" required
                        />
                        <Button
                            variant="primary" icon={ShieldCheck}
                            disabled={busy != null || !quienAut || !notaAut.trim()}
                            onClick={() => accion(
                                () => aprobarMetaPorAutorizacion({ id: r.id, autorizoPor: quienAut, nota: notaAut.trim() }),
                                r.id, 'METAS_APROBAR_POR_AUTORIZACION',
                                { sala: salaNombre(r.branch_id), mes: r.year_month, monto: r.monto_meta,
                                  autorizo: autorizadores.find((a) => a.id === quienAut)?.name, nota: notaAut.trim() },
                                'Meta oficial', 'Quedó registrada con la autorización, y a quien autorizó le llegó el aviso.',
                            )}
                        >
                            Dejar oficial con esta autorización
                        </Button>
                    </div>
                )}

                {r.estado === 'oficial' && r.autorizado_por && (
                    <p className="mt-3 text-label font-semibold text-content-3">
                        Oficial por autorización de <strong className="text-content-2">
                            {autorizadores.find((a) => a.id === r.autorizado_por)?.name || 'la gerencia'}
                        </strong>
                        {r.autorizado_nota ? ` — ${r.autorizado_nota}` : ''}
                    </p>
                )}

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

            {mostrarMesSig && (
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
                            subtitle={`El día ${diaPropuesta} el portal las propone solo, con las ventas de los meses cerrados.`}
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
            )}

            {/* Antes del día de la propuesta y sin nada pendiente del mes en
                curso, la pestaña quedaría en blanco. Decir cuándo aparece algo
                es la respuesta a la pregunta que uno se hace mirándola. */}
            {!mostrarMesSig && pendientesTodas.length === 0 && (
                <EmptyState
                    compact icon={CalendarCheck}
                    title="Sin metas por confirmar"
                    subtitle={`Las de ${ymLabel(ymSig).toLowerCase()} se proponen solas el día ${diaPropuesta}.`}
                />
            )}
        </div>
    );
}
