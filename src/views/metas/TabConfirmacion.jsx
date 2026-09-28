import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tokenMatch } from '../../utils/searchUtils';
import { CheckCircle2, Undo2, Sparkles, CalendarCheck, AlertTriangle, RefreshCw, Search, Minus, Plus, ShieldCheck, TrendingUp, TrendingDown, Store, Target, RotateCcw } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
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
import { ymHoySV, ymSumar, ymLabel, ymLabelCorto, diaHoySV, TRAMO_CFG } from '../../utils/metasUtils';

// Un toque = 1% sobre la propuesta, y el recorrido se topa en ±10%: más que eso
// no es ajustar una meta, es escribir otra — y para eso está devolverla.
const PASO_FACTOR = 0.01;
const PASOS_MAX = 10;

// La base de venta sobre la que corre el ajuste (ver `montoDe`).
const baseDe = (r) => Number(r.monto_base ?? r.monto_propuesto ?? 0);

// El relleno de la barra de la meta anterior, del color de cómo le fue — el
// mismo reparto que `TRAMO_CFG` y que el alfiler de `BarraAvance`.
const RELLENO_TRAMO = { completo: 'bg-success', medio: 'bg-warning', nada: 'bg-danger' };

// Un color por sala en la barra de la meta general, en orden fijo. Son los
// cinco categóricos con color propio (2, 5 y 7 están retirados, DESIGN.md §6)
// más un gris claro para la sexta. NO `chart-8`: es un alias de `content-3` y
// la clase no se pintaba — Salud 4 salió como un hueco en la barra y sin
// punto en la leyenda (reporte del usuario, 2026-09-28).
const COLORES_SALA = ['bg-chart-1', 'bg-chart-3', 'bg-chart-4', 'bg-chart-6', 'bg-chart-9', 'bg-content-2'];

const ESTADO_CFG = {
    propuesta:             { label: 'Propuesta',              variante: 'chart-1' },
    confirmada_supervisor: { label: 'Espera aprobación',      variante: 'warning' },
    devuelta:              { label: 'Devuelta',               variante: 'danger' },
    oficial:               { label: 'Oficial',                variante: 'success' },
};

// El ciclo del mes siguiente: el supervisor ajusta y confirma, el gerente
// aprueba o devuelve con nota. También muestra el mes en curso si quedó
// alguna meta sin oficializar (el sistema nunca la oficializa solo).
export default function TabConfirmacion({ salaNombre, canEdit, canApprove, reloadKey, onChanged, searchTerm, onClearSearch, diaPropuesta = 28 }) {
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
            if (!searchTerm?.trim()) return true;
            return tokenMatch(searchTerm, salaNombre(r.branch_id));
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
        const base = baseDe(r);
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

    // La bitácora la anota cada función de datos al guardar (D3): acá sólo van
    // los detalles legibles como su `contexto`.
    const accion = async (fn, id, okTitle, okBody) => {
        setBusy(id);
        try {
            await fn();
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
    // Se llaman como FUNCIONES y no como componentes (`<FilaMeta />`): un
    // componente declarado dentro de otro es un tipo nuevo en cada render, y
    // React lo desmonta y lo vuelve a montar — el campo de la nota perdía el
    // foco a cada tecla y el deslizador de la meta se soltaba a mitad del
    // arrastre.
    const accionesDelGrupo = (filas, mes) => {
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
                                () => confirmarMetasLote(porConfirmar.map((r) => ({ id: r.id, monto: montoDe(r) })),
                                    { mes, total: totalConfirmar,
                                      salas: porConfirmar.map((r) => `${salaNombre(r.branch_id)}=${montoDe(r)}`).join(', ') }),
                                'lote-confirmar',
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
                                () => aprobarMetasLote(idsAprobar, detalleAprobar),
                                'lote-aprobar',
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
                                }, { ...detalleAprobar,
                                     autorizo: autorizadores.find((a) => a.id === quienAut)?.name }),
                                'lote-autorizar',
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

    // Lo que muestra cada tarjeta como su meta: la ajustada mientras se puede
    // mover, la guardada cuando ya no. La meta general suma ESTO, para que el
    // total de arriba y las tarjetas de abajo no puedan decir cosas distintas.
    const metaMostrada = useCallback((r) => {
        const movible = (canEdit && ['propuesta', 'devuelta'].includes(r.estado))
            || (r.estado === 'confirmada_supervisor' && (canApprove || canEdit));
        return movible ? metaDe(r) : Number(r.monto_meta || 0);
    }, [canEdit, canApprove, metaDe]);

    // El color de cada sala sale de su lugar en la lista COMPLETA de salas, no
    // del filtro: si el buscador deja tres, cada una conserva el suyo.
    const colorSala = useMemo(() => {
        const ids = [...new Set(rows.map((r) => r.branch_id))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        return new Map(ids.map((id, i) => [id, COLORES_SALA[i % COLORES_SALA.length]]));
    }, [rows]);

    // La meta general del mes, arriba del grupo: la suma de las salas, contra
    // qué se compara, y de qué salas está hecha. Las acciones del grupo viven
    // acá porque «confirmar todas» es confirmar ESTE número (pedido del
    // usuario, 2026-09-28). Se llama como función y no como componente: un
    // componente declarado dentro de otro se remonta en cada render.
    const resumenGeneral = (filas, mes) => {
        const total = filas.reduce((s, r) => s + metaMostrada(r), 0);
        let anterior = 0, vendido = 0, anio = 0, prom = 0, ymAnt = null, proy = false;
        for (const r of filas) {
            const c = calc[mes]?.[r.branch_id];
            if (c?.meta_ultimo != null) {
                anterior += Number(c.meta_ultimo);
                if (c.pct_ultimo != null) vendido += Number(c.meta_ultimo) * Number(c.pct_ultimo) / 100;
                ymAnt = ymAnt || c.ym_ultimo;
                proy = proy || !!c.ultimo_proyectado;
            }
            const h = histIdx.get(`${r.branch_id}|${ymSumar(mes, -12)}`);
            if (h?.venta_total != null) anio += Number(h.venta_total);
            const n = c?.meses_base?.length;
            if (n) prom += Number(c.suma_venta) / n;
        }
        const mesDe = (ym) => ymLabel(ym).split(' ')[0].toLowerCase();
        const dif = anterior > 0 ? Math.round((total - anterior) * 100) / 100 : null;
        const pctAnt = anterior > 0 ? (vendido / anterior) * 100 : null;
        const tramoAnt = pctAnt == null ? null : pctAnt >= 100 ? 'completo' : pctAnt >= 95 ? 'medio' : 'nada';
        const refs = [
            ymAnt && { key: 'ant', rotulo: `Meta general de ${mesDe(ymAnt)}`, valor: anterior,
              nota: pctAnt != null ? `${proy ? 'Lleva' : 'Cumplió'} ${formatPct(pctAnt)}` : null, relleno: vendido, tramo: tramoAnt },
            anio > 0 && { key: 'anio', rotulo: `Venta de ${ymLabel(ymSumar(mes, -12)).toLowerCase()}`, valor: anio, nota: 'El mismo mes, un año antes' },
            prom > 0 && { key: 'prom', rotulo: 'Venta promedio por mes', valor: prom, nota: 'Los tres meses de la propuesta' },
        ].filter(Boolean);
        const tope = Math.max(total, ...refs.map((x) => x.valor)) * 1.04 || 1;
        const xDe = (v) => `${Math.max(0, Math.min(100, (v / tope) * 100))}%`;
        const porSala = [...filas].sort((a, b) => metaMostrada(b) - metaMostrada(a));

        return (
            <div data-surface="card" className="p-5 md:p-6 space-y-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                        <p className="flex items-center gap-2 text-micro font-black uppercase tracking-widest text-content-3">
                            <Target size={14} className="text-chart-1-text" aria-hidden />
                            Meta general · {ymLabel(mes).toLowerCase()}
                        </p>
                        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mt-1.5">
                            <p className="text-4xl font-black tabular-nums leading-none">{formatMoney(total)}</p>
                            {dif != null && dif !== 0 && (
                                <Badge variant={dif > 0 ? 'chart-1' : 'neutral'} icon={dif > 0 ? TrendingUp : TrendingDown}>
                                    {formatMoney(Math.abs(dif))} {dif > 0 ? 'más' : 'menos'} que {mesDe(ymAnt)}
                                </Badge>
                            )}
                        </div>
                        <p className="text-label font-semibold text-content-3 mt-1.5">
                            {filas.length === 1 ? 'Una sala' : `${filas.length} salas`}
                            {searchTerm?.trim() ? ' (las que coinciden con la búsqueda)' : ''}
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        {accionesDelGrupo(filas, mes)}
                    </div>
                </div>

                {/* De qué salas está hecha: una barra partida, cada tramo del
                    ancho de su meta. */}
                {total > 0 && filas.length > 1 && (
                    <div>
                        <div data-medida="dato" className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                            {porSala.map((r) => (
                                <span key={r.id}
                                    className={`${colorSala.get(r.branch_id)} transition-[flex-grow] duration-[var(--dur-slow)] ease-[var(--ease-out)] motion-reduce:transition-none`}
                                    style={{ flexGrow: metaMostrada(r), flexBasis: 0 }} />
                            ))}
                        </div>
                        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                            {porSala.map((r) => (
                                <li key={r.id} className="flex items-center gap-1.5 text-label font-semibold text-content-2">
                                    <span aria-hidden className={`size-2.5 rounded-sm ${colorSala.get(r.branch_id)}`} />
                                    {salaNombre(r.branch_id)}
                                    <span className="font-black tabular-nums text-content-1">{formatMoney(metaMostrada(r))}</span>
                                    <span className="text-content-3 tabular-nums">{formatPct((metaMostrada(r) / total) * 100, { decimales: 0 })}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Contra qué se compara, en la misma escala; la raya es la meta
                    general de arriba. */}
                {refs.length > 0 && (
                    <ul className="grid gap-3 md:grid-cols-3">
                        {refs.map((x) => (
                            <li key={x.key} data-surface="card" className="p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-label font-bold text-content-2 truncate">{x.rotulo}</span>
                                    <span className="text-label font-black tabular-nums shrink-0">{formatMoney(x.valor)}</span>
                                </div>
                                <div data-medida="dato" className="relative h-2 mt-2 rounded-full bg-surface-card-hover">
                                    <span className="absolute inset-y-0 left-0 rounded-full bg-content-3/35" style={{ width: xDe(x.valor) }} />
                                    {x.relleno != null && (
                                        <span className={`absolute inset-y-0 left-0 rounded-full ${RELLENO_TRAMO[x.tramo] || 'bg-content-3'}`} style={{ width: xDe(x.relleno) }} />
                                    )}
                                    <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-chart-1 transition-[left] duration-[var(--dur-slow)] ease-[var(--ease-out)] motion-reduce:transition-none" style={{ left: xDe(total) }} />
                                </div>
                                {x.nota && <p className="text-micro font-semibold text-content-3 mt-1.5">{x.nota}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    const filaMeta = (r) => {
        const es = ESTADO_CFG[r.estado] || ESTADO_CFG.propuesta;
        // El cálculo de ESTA tarjeta: el de su mes y su sala.
        const c = calc[r.year_month]?.[r.branch_id] || null;
        const anioPasado = histIdx.get(`${r.branch_id}|${ymSumar(r.year_month, -12)}`);
        const meses = c?.meses_base || [];
        const promMeses = meses.length ? Number(c.suma_venta) / meses.length : null;
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

        // La meta que se está decidiendo, y contra qué se compara. Todo se
        // dice en PALABRAS y en dinero: «meta +3.6%» o «Exigencia» obligaban a
        // adivinar contra qué era el porcentaje (pedido del usuario, 2026-09-28:
        // «eso qué es? no lo entiendo»).
        const metaAhora = editable || ajustable ? montoNum + recuperacion : Number(r.monto_meta || 0);
        const metaAnterior = c?.meta_ultimo != null ? Number(c.meta_ultimo) : null;
        const mesDe = (ym) => ymLabel(ym).split(' ')[0].toLowerCase();
        const difAnterior = metaAnterior > 0 && metaAhora > 0
            ? Math.round((metaAhora - metaAnterior) * 100) / 100 : null;
        const mesProyectado = meses.find((m) => m.proyectado)?.ym;
        // Lo vendido contra la meta del mes anterior: el relleno de su barra.
        const vendidoAnterior = metaAnterior != null && c?.pct_ultimo != null
            ? metaAnterior * Number(c.pct_ultimo) / 100 : null;

        // Las barras comparan todo en la MISMA escala, y la raya punteada de
        // cada una es la meta nueva: al subir o bajar, la raya se corre y se ve
        // contra qué queda por encima o por debajo, sin leer un número.
        const barras = [
            {
                key: 'nueva', nueva: true,
                rotulo: `Meta de ${mesDe(r.year_month)}`,
                valor: metaAhora,
                nota: editable || ajustable ? 'La que vas a confirmar' : 'La de este mes',
            },
            {
                key: 'anterior',
                rotulo: c?.ym_ultimo ? `Meta de ${mesDe(c.ym_ultimo)}` : 'Meta del mes anterior',
                valor: metaAnterior,
                relleno: vendidoAnterior,
                tramo: c?.tramo_ultimo,
                nota: c?.pct_ultimo != null
                    ? `${c.ultimo_proyectado ? 'Lleva' : 'Cumplió'} ${formatPct(c.pct_ultimo)}${c.ultimo_proyectado ? ', el mes no ha cerrado' : ''}`
                    : (c ? 'Ese mes no tuvo meta' : null),
            },
            {
                key: 'anio',
                rotulo: `Venta de ${ymLabel(ymSumar(r.year_month, -12)).toLowerCase()}`,
                valor: anioPasado?.venta_total != null ? Number(anioPasado.venta_total) : null,
                nota: 'El mismo mes, un año antes',
            },
            {
                key: 'prom',
                rotulo: meses.length >= 2
                    ? `Venta promedio ${mesDe(meses[0].ym)}–${mesDe(meses[meses.length - 1].ym)}`
                    : 'Venta promedio 3 meses',
                valor: promMeses,
                nota: mesProyectado ? `${ymLabel(mesProyectado).split(' ')[0]} estimado: todavía no cierra` : 'Por mes',
            },
        ];
        const tope = Math.max(...barras.map((x) => x.valor || 0)) * 1.04 || 1;
        const xDe = (v) => `${Math.max(0, Math.min(100, (v / tope) * 100))}%`;
        // Qué tan lejos queda cada referencia de la meta nueva, en dinero. Se
        // muestra al pasar o tocar el renglón: siempre a la vista era ruido.
        const contraNueva = (v) => {
            if (!(v > 0) || !(metaAhora > 0)) return null;
            const d = Math.round((metaAhora - v) * 100) / 100;
            if (d === 0) return 'Igual que la meta nueva';
            return `La meta nueva queda ${formatMoney(Math.abs(d))} ${d > 0 ? 'arriba' : 'abajo'}`;
        };

        return (
            <article key={r.id} data-surface="card" className="p-5 flex flex-col gap-4">
                <header className="flex items-center gap-3">
                    <span className="size-10 shrink-0 rounded-xl bg-chart-1/10 text-chart-1-text grid place-items-center">
                        <Store size={18} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-body font-black leading-tight truncate">{salaNombre(r.branch_id)}</h3>
                        <p className="text-caption font-bold text-content-3 uppercase tracking-widest mt-0.5">{ymLabelCorto(r.year_month)}</p>
                    </div>
                    <Badge variant={es.variante} size="sm">{es.label}</Badge>
                </header>

                {r.estado === 'devuelta' && r.nota_devolucion && (
                    <Notice variant="danger">{r.nota_devolucion}</Notice>
                )}

                {/* El número de la tarjeta, grande, y su distancia a la meta del
                    mes anterior en una ficha con flecha: sube o baja de un
                    vistazo. */}
                <div>
                    <p className="text-micro font-black uppercase tracking-widest text-content-3">
                        {editable ? 'Meta a confirmar' : ajustable ? 'Meta a aprobar' : 'Meta'}
                    </p>
                    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mt-1">
                        <p className="text-3xl font-black tabular-nums leading-none">{formatMoney(metaAhora)}</p>
                        {difAnterior != null && difAnterior !== 0 && (
                            <Badge variant={difAnterior > 0 ? 'chart-1' : 'neutral'} icon={difAnterior > 0 ? TrendingUp : TrendingDown}>
                                {formatMoney(Math.abs(difAnterior))} {difAnterior > 0 ? 'más' : 'menos'} que {mesDe(c.ym_ultimo)}
                            </Badge>
                        )}
                    </div>
                    {/* De qué está hecha: el gasto no se negocia. */}
                    {recuperacion > 0 && (
                        <p className="text-micro font-semibold text-content-3 tabular-nums mt-1.5">
                            {formatMoney(editable || ajustable ? montoNum : r.monto_base)} de venta
                            {' + '}
                            <span className="text-chart-1-text font-black">{formatMoney(recuperacion)}</span>
                            {' por gastos'}
                        </p>
                    )}
                    {/* Al ajustar en «espera aprobación» se está cambiando un
                        número que otra persona ya confirmó. */}
                    {ajustable && pasos !== 0 && (
                        <p className="text-micro font-semibold text-warning-text mt-1">
                            Cambiaste lo que confirmó el supervisor — le va a llegar el aviso.
                        </p>
                    )}
                </div>

                {/* La comparación, dibujada. */}
                <div data-surface="card" className="p-3.5">
                    <ul className="space-y-3">
                        {barras.map((x) => {
                            const dif = x.nueva ? null : contraNueva(x.valor);
                            return (
                                <li key={x.key} tabIndex={dif ? 0 : undefined}
                                    aria-label={dif ? `${x.rotulo}: ${x.valor != null ? formatMoney(x.valor) : 'sin dato'}. ${dif}` : undefined}
                                    className="group rounded-lg">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className={`text-label font-bold truncate ${x.nueva ? 'text-content-1' : 'text-content-2'}`}>{x.rotulo}</span>
                                        <span className={`text-label font-black tabular-nums shrink-0 ${x.nueva ? 'text-chart-1-text' : ''}`}>
                                            {x.valor != null ? formatMoney(x.valor) : '—'}
                                        </span>
                                    </div>
                                    <div data-medida="dato" className="relative h-2.5 mt-1.5 rounded-full bg-surface-card-hover">
                                        {x.valor != null && (
                                            <span
                                                className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)] motion-reduce:transition-none ${x.nueva ? 'bg-chart-1' : 'bg-content-3/35'}`}
                                                style={{ width: xDe(x.valor) }}
                                            />
                                        )}
                                        {/* Lo que se vendió contra esa meta, en el color de cómo le fue. */}
                                        {x.relleno != null && (
                                            <span
                                                className={`absolute inset-y-0 left-0 rounded-full ${RELLENO_TRAMO[x.tramo] || 'bg-content-3'}`}
                                                style={{ width: xDe(x.relleno) }}
                                            />
                                        )}
                                        {!x.nueva && metaAhora > 0 && (
                                            <span
                                                aria-hidden
                                                className="absolute -inset-y-1 w-0.5 rounded-full bg-chart-1 transition-[left] duration-[var(--dur-slow)] ease-[var(--ease-out)] motion-reduce:transition-none"
                                                style={{ left: xDe(metaAhora) }}
                                            />
                                        )}
                                    </div>
                                    {(x.nota || dif) && (
                                        <p className="text-micro font-semibold text-content-3 mt-1 truncate">
                                            <span className={dif ? 'group-hover:hidden group-focus:hidden' : ''}>{x.nota}</span>
                                            {dif && <span className="hidden group-hover:inline group-focus:inline text-chart-1-text font-black">{dif}</span>}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="flex items-center gap-1.5 text-micro font-semibold text-content-3 mt-3">
                        <span aria-hidden className="inline-block w-0.5 h-3 rounded-full bg-chart-1" />
                        La raya es la meta nueva · toca un renglón para ver la diferencia
                    </p>
                </div>

                {(editable || ajustable) && (
                    /* No se teclea el monto: se sube o se baja de a 1% sobre la
                       propuesta. La regla de abajo dibuja dónde está dentro del
                       ±10% permitido. */
                    <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="secondary" size="sm" icon={Minus} className="w-full"
                                disabled={busy != null || pasos <= -PASOS_MAX}
                                onClick={() => mover(-1)}>
                                Bajar 1%
                            </Button>
                            <Button variant="secondary" size="sm" icon={Plus} className="w-full"
                                disabled={busy != null || pasos >= PASOS_MAX}
                                onClick={() => mover(1)}>
                                Subir 1%
                            </Button>
                        </div>
                        {/* El deslizador: se arrastra o se toca en cualquier
                            punto, de a 1%. Lo que se ve es la pista dibujada; lo
                            que recibe el dedo, el teclado y el lector de pantalla
                            es el `range` nativo encima, transparente. */}
                        <div className="relative mx-1 min-h-[var(--tap-min)] flex items-center">
                            <div data-medida="dato" className="relative h-1.5 w-full rounded-full bg-surface-card-hover" aria-hidden>
                                <span
                                    className="absolute inset-y-0 rounded-full bg-chart-1/50"
                                    style={pasos >= 0
                                        ? { left: '50%', width: `${(pasos / PASOS_MAX) * 50}%` }
                                        : { right: '50%', width: `${(-pasos / PASOS_MAX) * 50}%` }}
                                />
                                <span className="absolute -inset-y-1 left-1/2 w-px bg-content-3/60" />
                                <span
                                    className={`absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-card shadow-md transition-[left] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none ${pasos === 0 ? 'bg-content-2' : 'bg-chart-1'}`}
                                    style={{ left: `${50 + (pasos / PASOS_MAX) * 50}%` }}
                                />
                            </div>
                            <input
                                type="range" min={-PASOS_MAX} max={PASOS_MAX} step={1}
                                value={pasos}
                                disabled={busy != null}
                                onChange={(e) => setAjustes((a) => ({ ...a, [r.id]: Number(e.target.value) }))}
                                aria-label="Ajuste sobre la propuesta del sistema"
                                aria-valuetext={pasos === 0 ? 'Igual a la propuesta' : `${pasos > 0 ? 'más' : 'menos'} ${Math.abs(pasos)} por ciento`}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-grab active:cursor-grabbing disabled:cursor-not-allowed"
                            />
                        </div>
                        <div className="flex justify-between text-micro font-bold text-content-3 tabular-nums -mt-1 mx-1" aria-hidden>
                            <span>−10%</span><span>Propuesta</span><span>+10%</span>
                        </div>
                        {/* Cuánto se movió, en dinero, justo debajo del
                            deslizador — y ahí mismo la salida de vuelta. */}
                        <div data-surface="card" className="flex items-center justify-between gap-3 px-3 py-2">
                            {pasos === 0 ? (
                                <p className="text-label font-semibold text-content-3 py-1.5">
                                    Igual a la propuesta del sistema
                                </p>
                            ) : (
                                <p className="text-label font-semibold text-content-2 min-w-0">
                                    <span className={`font-black tabular-nums ${pasos > 0 ? 'text-chart-1-text' : 'text-content-1'}`}>
                                        {pasos > 0 ? '+' : '−'}{formatMoney(Math.abs(montoNum - baseDe(r)))}
                                    </span>
                                    <span className="text-content-3"> · {Math.abs(pasos)}% {pasos > 0 ? 'más' : 'menos'} que la propuesta</span>
                                </p>
                            )}
                            {pasos !== 0 && (
                                <Button variant="ghost" size="sm" icon={RotateCcw} className="shrink-0"
                                    onClick={() => setAjustes((x) => ({ ...x, [r.id]: 0 }))}>
                                    Restablecer
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {r.monto_propuesto != null && (
                    <div className="border-t border-border-card pt-3">
                        <p className="flex items-center gap-1.5 text-label font-semibold text-content-3">
                            <Sparkles size={14} className="text-chart-1-text" aria-hidden />
                            Propuesta del sistema
                            <span className="font-black tabular-nums text-content-1 ml-auto">{formatMoney(r.monto_propuesto)}</span>
                        </p>
                        <ExplicacionMeta
                            branchId={r.branch_id}
                            yearMonth={r.year_month}
                            montoPropuesto={r.monto_propuesto}
                            datos={c}
                        />
                    </div>
                )}

                <div className="flex flex-wrap gap-2 mt-auto pt-1">
                    {editable && (
                        <Button
                            variant="primary" icon={CheckCircle2} className="flex-1"
                            disabled={busy != null || !Number.isFinite(montoNum) || montoNum <= 0}
                            onClick={() => accion(
                                () => confirmarMeta({ id: r.id, monto: montoNum },
                                    { sala: salaNombre(r.branch_id), mes: r.year_month }),
                                r.id,
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
                                    () => aprobarMeta({ id: r.id, monto: pasos !== 0 ? montoNum : null },
                                        { sala: salaNombre(r.branch_id), mes: r.year_month,
                                          monto: montoNum + recuperacion, ajustado: pasos !== 0 ? `${pasos}%` : undefined }),
                                    r.id,
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
                    <div data-surface="card" data-tono="warning" className="p-3 space-y-2">
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
                                }, { sala: salaNombre(r.branch_id), mes: r.year_month,
                                     monto: montoNum + recuperacion, ajustado: pasos !== 0 ? `${pasos}%` : undefined,
                                     autorizo: autorizadores.find((a) => a.id === quienAut)?.name }),
                                r.id,
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
                    <p className="text-label font-semibold text-content-3">
                        Oficial por autorización de <strong className="text-content-2">
                            {autorizadores.find((a) => a.id === r.autorizado_por)?.name || 'la gerencia'}
                        </strong>
                        {r.autorizado_nota ? ` — ${r.autorizado_nota}` : ''}
                    </p>
                )}

                {devolviendo === r.id && (
                    <div className="space-y-2">
                        <PortalInput
                            label="¿Por qué se devuelve?" name={`nota-dev-${r.id}`}
                            value={notaDev} onChange={(e) => setNotaDev(e.target.value)}
                            placeholder="Ej. la meta quedó baja para la temporada" required
                        />
                        <Button
                            variant="destructive" icon={Undo2}
                            disabled={busy != null || !notaDev.trim()}
                            onClick={() => accion(
                                () => devolverMeta({ id: r.id, nota: notaDev.trim() },
                                    { sala: salaNombre(r.branch_id), mes: r.year_month }),
                                r.id,
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
                    {pendientesActual.length > 0 && resumenGeneral(pendientesActual, ymActual)}
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
                            {pendientesActual.map(filaMeta)}
                        </div>
                    )}
                </section>
            )}

            {mostrarMesSig && (
            <section className="space-y-3">
                {/* El encabezado solo cuando hay algo que encabezar: con la
                    sección vacía, el `EmptyState` ya dice de qué mes habla, y el
                    h2 quedaba colgado arriba a la izquierda repitiéndolo. */}
                {delMesSig.length > 0 && resumenGeneral(delMesSig, ymSig)}

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
                            subtitle={`El día ${diaPropuesta} el portal las propone solo, con el ritmo de los últimos 3 meses — el que está por cerrar entra proyectado.`}
                            action={canEdit && (
                                <Button
                                    variant="primary" icon={Sparkles} disabled={busy != null}
                                    onClick={() => accion(
                                        async () => { const n = await generarPropuestas({ mes: ymSig }); if (!n) throw new Error('No había nada que proponer'); },
                                        'generar',
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
                        {delMesSig.map(filaMeta)}
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
