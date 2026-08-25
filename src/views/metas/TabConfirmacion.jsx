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
    fetchMetasRows, fetchMetasHistorico, explicarMetasPropuestas, generarPropuestas,
    confirmarMeta, confirmarMetasLote, aprobarMeta, devolverMeta,
    fetchAutorizadores, aprobarMetaPorAutorizacion,
    aprobarMetasLote, aprobarMetasPorAutorizacionLote,
} from '../../data/metas';
import ExplicacionMeta from './ExplicacionMeta';
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
    // El cálculo de la propuesta por mes y por sala: `{ [ym]: { [branch_id]: … } }`.
    // Es la MISMA fuente que el panel «De dónde sale», y por eso el contexto de
    // la tarjeta no puede decir un mes distinto del que usó la fórmula.
    const [calc, setCalc] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // id → pasos de ajuste sobre la propuesta. Se guardan los PASOS y no el
    // monto: el supervisor no teclea una cifra, corre la exigencia.
    const [ajustes, setAjustes] = useState({});
    const [devolviendo, setDevolviendo] = useState(null); // id → abre el campo de nota
    const [notaDev, setNotaDev] = useState('');
    const [autorizando, setAutorizando] = useState(null); // id → abre el registro de autorización
    const [loteAut, setLoteAut] = useState(null);         // { mes, ids, cuantas, total } → el mismo registro, para todo el grupo
    const [notaAut, setNotaAut] = useState('');
    const [quienAut, setQuienAut] = useState('');
    const [autorizadores, setAutorizadores] = useState([]);
    const [busy, setBusy] = useState(null);       // id (o 'generar') en vuelo

    const cargar = () => {
        let alive = true;
        setLoading(true);  
        setError(null);
        // Dos meses y dos llamadas: el cálculo de un mes depende del mes, así
        // que el contexto de una tarjeta de agosto y el de una de septiembre no
        // son el mismo objeto ni miran los mismos meses base.
        Promise.all([
            fetchMetasRows([ymActual, ymSig]),
            fetchMetasHistorico(),
            explicarMetasPropuestas(ymActual),
            explicarMetasPropuestas(ymSig),
        ])
            .then(([r, h, cAct, cSig]) => {
                if (!alive) return;
                const porMes = {};
                for (const [ym, lista] of [[ymActual, cAct], [ymSig, cSig]]) {
                    porMes[ym] = Object.fromEntries((lista || []).map((x) => [x.branch_id, x]));
                }
                setRows(r); setHistorico(h); setCalc(porMes); setAjustes({});
                // Los paneles abiertos apuntan a filas que acaban de cambiar de
                // estado: dejarlos abiertos sería ofrecer una acción sobre algo
                // que ya no está.
                setLoteAut(null); setAutorizando(null); setDevolviendo(null);
                setLoading(false);
            })
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

    // El histórico indexado por sala Y mes, para que cada tarjeta pregunte por
    // SU mes. Antes había un solo juego de meses para las dos secciones: el
    // «mismo mes del año pasado» salía siempre de `ymSig - 12` y el «cerró» de
    // `ymActual - 1`, así que una tarjeta del mes en curso mostraba el año
    // pasado del mes que VIENE. Los otros dos datos ya no salen de acá —
    // vienen de `calc`, que es la misma cuenta que hizo la propuesta.
    const histIdx = useMemo(() => {
        const m = new Map();
        for (const h of historico) m.set(`${h.branch_id}|${h.year_month}`, h);
        return m;
    }, [historico]);

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

    // La BASE de venta que se va a confirmar, con el ajuste de exigencia
    // aplicado. Vive acá y no dentro de la tarjeta para que «Confirmar todas»
    // mande EXACTAMENTE lo que cada tarjeta muestra — si se calculara dos veces,
    // un día divergen.
    //
    // Corre sobre `monto_base` y NUNCA sobre `monto_meta`: la meta puede traer
    // la recuperación de un gasto adentro, y aplicarle el ±1% multiplicaría
    // también ese gasto, que no se negocia. Y arranca de la base actual, no de
    // la propuesta original: una meta reabierta por un gasto ya venía ajustada.
    const montoDe = useCallback((r) => {
        const base = Number(r.monto_base ?? r.monto_propuesto ?? 0);
        const pasos = ajustes[r.id] ?? 0;
        return base > 0 ? Math.round(base * (1 + PASO_FACTOR * pasos) * 100) / 100 : 0;
    }, [ajustes]);

    // Lo que la sala va a perseguir: la base ajustada más lo que ya traiga de
    // gastos. Es el número del rótulo de los botones, porque es el que significa
    // algo; lo que viaja al servidor sigue siendo la base.
    const recuperacionDe = (r) => Number(r.monto_recuperacion || 0);
    const metaDe = useCallback((r) => montoDe(r) + recuperacionDe(r), [montoDe]);

    const esConfirmable = useCallback(
        (r) => canEdit && ['propuesta', 'devuelta'].includes(r.estado) && montoDe(r) > 0,
        [canEdit, montoDe],
    );

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

    // Acciones del grupo, en el encabezado del grupo sobre el que actúan — el
    // mismo sitio que «Aprobar todo» en Asistencia. Llevan la cuenta y el total
    // en el rótulo: mover seis metas de golpe no puede ser un botón mudo.
    // Con una sola fila no aparecen: para eso está el botón de la tarjeta.
    const AccionesDelGrupo = ({ filas, mes }) => {
        const porConfirmar = filas.filter(esConfirmable);
        const porAprobar = filas.filter((r) => r.estado === 'confirmada_supervisor');
        const totalConfirmar = porConfirmar.reduce((s, r) => s + metaDe(r), 0);
        const totalAprobar = porAprobar.reduce((s, r) => s + Number(r.monto_meta || 0), 0);

        const verConfirmar = porConfirmar.length >= 2;
        // Quien puede aprobar, aprueba. Quien no, registra la autorización — y
        // la pide UNA vez para todas, no seis veces el mismo dato.
        const verAprobar = canApprove && porAprobar.length >= 2;
        const verAutorizar = !canApprove && canEdit && porAprobar.length >= 2;
        if (!verConfirmar && !verAprobar && !verAutorizar) return null;

        const idsAprobar = porAprobar.map((r) => r.id);
        const detalleAprobar = {
            mes, cuantas: porAprobar.length, total: totalAprobar,
            salas: porAprobar.map((r) => salaNombre(r.branch_id)).join(', '),
        };

        return (
            <>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                    {verConfirmar && (
                        <Button
                            variant="primary" icon={CheckCircle2} disabled={busy != null}
                            onClick={() => accion(
                                () => confirmarMetasLote(porConfirmar.map((r) => ({ id: r.id, monto: montoDe(r) }))),
                                'lote-confirmar', 'METAS_CONFIRMAR_LOTE',
                                { mes, cuantas: porConfirmar.length, total: totalConfirmar,
                                  salas: porConfirmar.map((r) => `${salaNombre(r.branch_id)}=${montoDe(r)}`).join(', ') },
                                'Metas confirmadas',
                                `${porConfirmar.length} salas · ${formatMoney(totalConfirmar)}. Al confirmar todas, le llega al gerente.`,
                            )}
                        >
                            {busy === 'lote-confirmar'
                                ? 'Confirmando…'
                                : `Confirmar las ${porConfirmar.length} · ${formatMoney(totalConfirmar)}`}
                        </Button>
                    )}
                    {verAprobar && (
                        <Button
                            variant="primary" icon={CheckCircle2} disabled={busy != null}
                            onClick={() => accion(
                                () => aprobarMetasLote(idsAprobar),
                                'lote-aprobar', 'METAS_APROBAR_LOTE', detalleAprobar,
                                'Metas aprobadas',
                                `${porAprobar.length} salas quedaron oficiales. Cada una ve la suya.`,
                            )}
                        >
                            {busy === 'lote-aprobar'
                                ? 'Aprobando…'
                                : `Aprobar las ${porAprobar.length} · ${formatMoney(totalAprobar)}`}
                        </Button>
                    )}
                    {verAutorizar && (
                        <Button
                            variant="secondary" icon={ShieldCheck} disabled={busy != null}
                            onClick={() => {
                                setAutorizando(null);
                                setLoteAut(loteAut?.mes === mes ? null : { mes, ids: idsAprobar, cuantas: porAprobar.length, total: totalAprobar });
                                setNotaAut(''); setQuienAut('');
                            }}
                        >
                            {`Registrar la autorización de las ${porAprobar.length}`}
                        </Button>
                    )}
                </div>

                {loteAut?.mes === mes && (
                    <div data-surface="card" data-tono="warning" className="w-full mt-3 p-3 space-y-2">
                        <p className="text-label font-semibold text-content-2">
                            Esto deja oficiales las {loteAut.cuantas} metas de golpe
                            ({formatMoney(loteAut.total)}). Queda asentado que las ejecutaste vos
                            con autorización de quien elijas, y a esa persona le llega el aviso.
                        </p>
                        <LiquidSelect
                            value={quienAut} onChange={setQuienAut}
                            options={autorizadores.map((a) => ({ value: a.id, label: a.name }))}
                            placeholder="¿Quién autorizó?"
                        />
                        <PortalInput
                            label="¿Cómo lo autorizó?" name={`nota-aut-lote-${mes}`}
                            value={notaAut} onChange={(e) => setNotaAut(e.target.value)}
                            placeholder="Ej. las aprobó por teléfono el 5 de agosto" required
                        />
                        <Button
                            variant="primary" icon={ShieldCheck}
                            disabled={busy != null || !quienAut || !notaAut.trim()}
                            onClick={() => accion(
                                () => aprobarMetasPorAutorizacionLote({
                                    ids: loteAut.ids, autorizoPor: quienAut, nota: notaAut.trim(),
                                }),
                                'lote-autorizar', 'METAS_APROBAR_POR_AUTORIZACION_LOTE',
                                { ...detalleAprobar,
                                  autorizo: autorizadores.find((a) => a.id === quienAut)?.name,
                                  nota: notaAut.trim() },
                                'Metas oficiales',
                                `${loteAut.cuantas} salas quedaron registradas con esa autorización, y a quien autorizó le llegó el aviso.`,
                            )}
                        >
                            {busy === 'lote-autorizar'
                                ? 'Registrando…'
                                : `Dejar oficiales las ${loteAut.cuantas} con esta autorización`}
                        </Button>
                    </div>
                )}
            </>
        );
    };

    const FilaMeta = ({ r }) => {
        const es = ESTADO_CFG[r.estado] || ESTADO_CFG.propuesta;
        // El cálculo de ESTA tarjeta: el de su mes y su sala.
        const c = calc[r.year_month]?.[r.branch_id] || null;
        const anioPasado = histIdx.get(`${r.branch_id}|${ymSumar(r.year_month, -12)}`);
        const meses = c?.meses_base || [];
        const promMeses = meses.length ? Number(c.suma_venta) / meses.length : null;
        const hayProyectado = meses.some((m) => m.proyectado);
        const editable = canEdit && ['propuesta', 'devuelta'].includes(r.estado);
        // En «espera aprobación» el monto también se puede mover: quien aprueba
        // —o quien registra la autorización del gerente— puede ajustarlo antes
        // de dejarlo oficial (pedido del usuario, 2026-08-05). Si lo cambia, el
        // servidor le avisa al supervisor, porque su número dejó de ser el que
        // confirmó.
        const ajustable = r.estado === 'confirmada_supervisor' && (canApprove || canEdit);
        // La base es lo que propuso el portal; si la meta se creó a mano, ella
        // misma. El ajuste corre desde ahí, no desde un campo en blanco.
        const pasos = ajustes[r.id] ?? 0;
        const montoNum = montoDe(r);
        const recuperacion = recuperacionDe(r);
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
                    {/* El mismo mes DE ESTA tarjeta, un año antes — no un mes
                        fijo: la sección del mes en curso y la del que viene
                        comparten componente. */}
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">Mismo mes, año pasado</p>
                        <p className="text-body-sm font-black tabular-nums">
                            {anioPasado?.venta_total != null ? formatMoney(anioPasado.venta_total) : '—'}
                        </p>
                    </div>
                    {/* Los MISMOS tres meses que usó la fórmula, no «los últimos
                        3 cerrados»: con el mes en curso adentro, un promedio de
                        otro trío explicaría una propuesta que no es ésta. */}
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">
                            {meses.length ? `Promedio ${meses.map((m) => ymLabelCorto(m.ym).split(' ')[0]).join('·')}` : 'Promedio 3 meses'}
                        </p>
                        <p className="text-body-sm font-black tabular-nums">
                            {promMeses != null ? formatMoney(promMeses) : '—'}
                            {hayProyectado && <span className="text-content-3 font-semibold"> · uno proyectado</span>}
                        </p>
                    </div>
                    {/* En cuánto viene el mes anterior: es con lo que uno decide
                        si el monto propuesto es alcanzable, y es EXACTAMENTE el
                        mes del que sale el factor. Si todavía no cerró se dice
                        así: «cerró» sobre un mes en curso sería falso, y era lo
                        que confundía — la tarjeta de septiembre hablaba de julio
                        mientras la fórmula ya contaba agosto. */}
                    <div className="col-span-2">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">
                            {c?.ym_ultimo
                                ? `${c.ultimo_proyectado ? 'Va cerrando' : 'Cerró'} ${ymLabelCorto(c.ym_ultimo)}`
                                : 'Mes anterior'}
                        </p>
                        {c?.pct_ultimo != null ? (
                            <p className="text-body-sm font-black tabular-nums">
                                <span className={TRAMO_CFG[c.tramo_ultimo]?.textCls || ''}>{formatPct(c.pct_ultimo)}</span>
                                {c.meta_ultimo != null && (
                                    <span className="text-content-3 font-semibold"> de su meta de {formatMoney(c.meta_ultimo)}</span>
                                )}
                            </p>
                        ) : (
                            <p className="text-body-sm font-semibold text-content-3">
                                {c ? 'Ese mes no tuvo meta' : '—'}
                            </p>
                        )}
                    </div>
                    {r.monto_propuesto != null && (
                        <div className="col-span-2">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3">Propuesta del sistema</p>
                            <p className="text-body-sm font-black tabular-nums text-chart-1-text">{formatMoney(r.monto_propuesto)}</p>
                            <ExplicacionMeta
                                branchId={r.branch_id}
                                yearMonth={r.year_month}
                                montoPropuesto={r.monto_propuesto}
                                datos={c}
                            />
                        </div>
                    )}
                </div>

                {editable || ajustable ? (
                    /* No se teclea el monto: se corre la exigencia. Un campo libre
                       invita a inventar una cifra redonda y pierde el cálculo que
                       hay detrás; acá cada toque es 1% sobre la propuesta y el
                       monto se ve en dinero, con sus separadores. */
                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">
                            {ajustable ? 'Meta a aprobar' : 'Meta a confirmar'}
                        </p>
                        <p className="text-xl font-black tabular-nums mt-0.5">{formatMoney(montoNum + recuperacion)}</p>
                        {/* Al ajustar en «espera aprobación» se está cambiando un
                            número que otra persona ya confirmó. Decirlo acá evita
                            que se entere por la notificación. */}
                        {ajustable && pasos !== 0 && (
                            <p className="text-micro font-semibold text-warning-text mt-0.5">
                                Cambiaste lo que confirmó el supervisor — le va a llegar el aviso.
                            </p>
                        )}
                        {/* De qué está hecha, y que la exigencia corre solo sobre
                            la venta: el gasto no se negocia. */}
                        {recuperacion > 0 && (
                            <p className="text-micro font-semibold text-content-3 tabular-nums mt-0.5">
                                {formatMoney(montoNum)} de venta
                                {' + '}
                                <span className="text-chart-1-text font-black">{formatMoney(recuperacion)}</span>
                                {' por gastos'}
                            </p>
                        )}
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
                        {recuperacion > 0 && (
                            <p className="text-micro font-semibold text-content-3 tabular-nums mt-0.5">
                                {formatMoney(r.monto_base)} de venta
                                {' + '}
                                <span className="text-chart-1-text font-black">{formatMoney(recuperacion)}</span>
                                {' por gastos'}
                            </p>
                        )}
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
                                    // Solo se manda el monto si de verdad se movió: mandarlo
                                    // siempre haría que el servidor lo lea como un ajuste y
                                    // le avisara al supervisor de un cambio que no hubo.
                                    () => aprobarMeta({ id: r.id, monto: pasos !== 0 ? montoNum : null }),
                                    r.id, 'METAS_APROBAR',
                                    { sala: salaNombre(r.branch_id), mes: r.year_month,
                                      monto: montoNum + recuperacion, ajustado: pasos !== 0 ? `${pasos}%` : undefined },
                                    'Meta aprobada',
                                    pasos !== 0
                                        ? `${salaNombre(r.branch_id)} quedó oficial en ${formatMoney(montoNum + recuperacion)}. Al supervisor le llegó el aviso del cambio.`
                                        : `${salaNombre(r.branch_id)} quedó oficial.`,
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
                            onClick={() => {
                                setLoteAut(null);   // dos paneles abiertos a la vez piden lo mismo dos veces
                                setAutorizando(autorizando === r.id ? null : r.id);
                                setNotaAut(''); setQuienAut('');
                            }}>
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
                                () => aprobarMetaPorAutorizacion({
                                    id: r.id, autorizoPor: quienAut, nota: notaAut.trim(),
                                    monto: pasos !== 0 ? montoNum : null,
                                }),
                                r.id, 'METAS_APROBAR_POR_AUTORIZACION',
                                { sala: salaNombre(r.branch_id), mes: r.year_month,
                                  monto: montoNum + recuperacion, ajustado: pasos !== 0 ? `${pasos}%` : undefined,
                                  autorizo: autorizadores.find((a) => a.id === quienAut)?.name, nota: notaAut.trim() },
                                'Meta oficial',
                                pasos !== 0
                                    ? `Quedó en ${formatMoney(montoNum + recuperacion)} con esa autorización. Al supervisor le llegó el aviso del cambio.`
                                    : 'Quedó registrada con la autorización, y a quien autorizó le llegó el aviso.',
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    {pendientesActual.length > 0 && (
                        <div className="flex flex-wrap justify-end">
                            <AccionesDelGrupo filas={pendientesActual} mes={ymActual} />
                        </div>
                    )}
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
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h2 className="text-body font-black">Metas de {ymLabel(ymSig).toLowerCase()}</h2>
                        <AccionesDelGrupo filas={delMesSig} mes={ymSig} />
                    </div>
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
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
