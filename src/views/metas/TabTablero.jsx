import React, { useEffect, useMemo, useState } from 'react';
import { Target, TrendingUp, Gauge, BarChart3, Plus, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import BarraAvance from './BarraAvance';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import GraficaMes from './GraficaMes';
import RankingVendedores from './RankingVendedores';
import { fetchMetasDashboard, fetchMetasRows, fetchMesEnCurso } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA, TRAMO_CFG } from './metasUtils';

const fmtPct = (v) => formatPct(v);

export default function TabTablero({ salaNombre, canEdit, onAgregarMeta, reloadKey, bonificacionesActivas, searchTerm, onClearSearch, salaOptions }) {
    const ymActual = ymHoySV();
    const ymMax = ymSumar(ymActual, 1);
    const [ym, setYm] = useState(ymActual);
    const [rows, setRows] = useState([]);
    // Las dos mitades de la meta (venta y recuperación de gastos) para poder
    // mostrar el desglose. Vienen aparte y no de `get_metas_dashboard` porque
    // cambiarle las columnas a ese RPC obliga a recrearlo, y lo consumen además
    // el widget de la sala y el bono.
    const [desglose, setDesglose] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Contador de reintentos: es lo que le da SALIDA al estado de error (§18.1
    // — un vacío sin acción es una pantalla muerta). Solo cambia de valor para
    // re-disparar el efecto.
    const [intento, setIntento] = useState(0);

    // El mes en curso: cómo va y quién vende. Vive aparte del tablero porque
    // responde otra pregunta y se pide por sala — '' es todas juntas.
    const [salaMes, setSalaMes] = useState('');
    const [vistaMes, setVistaMes] = useState('dias');
    const [mes, setMes] = useState(null);
    const [cargandoMes, setCargandoMes] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch al cambiar de mes
        setError(null);
        Promise.all([fetchMetasDashboard(ym), fetchMetasRows([ym]).catch(() => [])])
            .then(([data, filas]) => {
                if (!alive) return;
                setRows(data);
                const d = {};
                for (const f of filas) {
                    if (Number(f.monto_recuperacion) > 0) {
                        d[f.branch_id] = { base: Number(f.monto_base), recuperacion: Number(f.monto_recuperacion) };
                    }
                }
                setDesglose(d);
                setLoading(false);
            })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar las metas')); setLoading(false); } });
        return () => { alive = false; };
    }, [ym, reloadKey, intento]);

    const esMesActual = ym === ymActual;
    const cerrado = ym < ymActual;

    // Solo tiene sentido para el mes en curso: «cómo va» y «quién está
    // vendiendo» son preguntas del presente. En un mes cerrado la respuesta ya
    // está en la tarjeta y en el Histórico.
    useEffect(() => {
        if (!esMesActual) { setMes(null); return; }
        let alive = true;
        setCargandoMes(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton al cambiar de sala
        fetchMesEnCurso(salaMes || null)
            .then((d) => { if (alive) { setMes(d); setCargandoMes(false); } })
            // Sin esto la sección no aparece y el resto del tablero sigue vivo:
            // es un agregado, no el contenido principal.
            .catch(() => { if (alive) { setMes(null); setCargandoMes(false); } });
        return () => { alive = false; };
    }, [esMesActual, salaMes, reloadKey, intento]);

    // El filtro de sala de la píldora recorta la vista ENTERA: las tarjetas y
    // las gráficas de abajo. Un filtro que solo tocara una sección dejaría a la
    // píldora diciendo que no hay ninguno puesto (DESIGN.md §17).
    const visibles = useMemo(() => {
        let base = rows;
        if (salaMes) base = base.filter((r) => String(r.branch_id) === salaMes);
        if (searchTerm?.trim()) {
            const q = searchTerm.trim().toLowerCase();
            base = base.filter((r) => (salaNombre(r.branch_id) || '').toLowerCase().includes(q));
        }
        return base;
    }, [rows, salaMes, searchTerm, salaNombre]);

    const resumen = useMemo(() => {
        const conMeta = rows.filter((r) => r.monto_meta != null);
        const meta = conMeta.reduce((s, r) => s + Number(r.monto_meta), 0);
        const vendidoConMeta = conMeta.reduce((s, r) => s + Number(r.venta_acumulada || 0), 0);
        const proy = conMeta.reduce((s, r) => s + Number(r.proyeccion || 0), 0);
        const tiers = { completo: 0, medio: 0, nada: 0 };
        conMeta.forEach((r) => { if (tiers[r.bono_tier] != null) tiers[r.bono_tier] += 1; });
        return { meta, vendidoConMeta, proy, tiers, conMeta: conMeta.length, sinMeta: rows.length - conMeta.length };
    }, [rows]);

    return (
        <div className="space-y-4">
            {!bonificacionesActivas && (
                <Notice variant="warning">
                    Bonificaciones suspendidas — el bono se muestra solo como referencia.
                </Notice>
            )}

            {/* Dos columnas: tarjetas a la izquierda, píldora a la derecha —
                el layout de §17.0, el mismo de Personal. En renglones separados
                la píldora se queda un renglón entero para sí sola, y además el
                reparto de ancho de `FilterBar` deja de funcionar: mide la FILA y
                le reserva sitio al carril que tiene al lado, así que si el
                carril está en otro renglón le descuenta 314px a cambio de nada. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <CarrilCards className="flex-1" ariaLabel="Resumen de metas">
                <StatCard
                    icon={Target} label="Meta del mes"
                    value={resumen.meta > 0 ? formatMoney(resumen.meta) : '—'}
                    sub={resumen.conMeta > 0 ? `${resumen.conMeta} sala${resumen.conMeta !== 1 ? 's' : ''} con meta` : 'sin metas este mes'}
                    iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                    loading={loading}
                />
                {/* §17.0 — el rótulo nombra la métrica en dos palabras y el
                    matiz baja al `sub`: en una tarjeta de 148px «Proyección de
                    cierre» salía «Proyección de cie…», que ya no nombra nada. */}
                <StatCard
                    icon={TrendingUp} label="Vendido"
                    value={formatMoney(resumen.vendidoConMeta)}
                    valueCls="text-content"
                    sub={resumen.meta > 0
                        ? `${fmtPct(resumen.vendidoConMeta / resumen.meta * 100)} de la meta`
                        : cerrado ? 'en el mes' : 'salas con meta'}
                    iconBg="bg-success/10" iconCls="text-success-text"
                    loading={loading}
                />
                {esMesActual && (
                    <StatCard
                        icon={Gauge} label="Proyección"
                        value={resumen.meta > 0 ? formatMoney(resumen.proy) : '—'}
                        valueCls="text-chart-1-text"
                        sub={resumen.meta > 0 ? `${fmtPct(resumen.proy / resumen.meta * 100)} de la meta` : 'al cierre del mes'}
                        iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                        loading={loading}
                    />
                )}
                <StatCard
                    icon={BarChart3} label="Semáforo"
                    value={resumen.conMeta > 0
                        ? `${resumen.tiers.completo} · ${resumen.tiers.medio} · ${resumen.tiers.nada}`
                        : '—'}
                    sub={resumen.sinMeta > 0 ? `+${resumen.sinMeta} sin meta` : 'completo · medio · nada'}
                    loading={loading}
                />
            </CarrilCards>

            {/* §17 — los filtros de la vista y sus acciones, en UNA píldora.
                Antes esto era un `justify-between` con un stepper escrito a mano
                a la izquierda y el botón suelto a la derecha, y eso costaba tres
                cosas además de verse distinto al resto del portal: en táctil
                nada de esto llegaba a la barra flotante (`FilterBar` ES esa
                barra, §17.3), no había forma de volver al mes actual, y las
                flechas se anunciaban «botón, botón» — `PeriodStepper` arma su
                nombre accesible con `unit`. */}
            <div className="flex justify-end min-w-0">
                <FilterBar
                    title="Filtros de metas"
                    activeCount={(esMesActual ? 0 : 1) + (salaMes ? 1 : 0)}
                    onClear={() => { setYm(ymActual); setSalaMes(''); }}
                    acciones={canEdit ? [{
                        key: 'agregar', icon: Plus, label: 'Agregar meta', variant: 'primary',
                        onClick: () => onAgregarMeta(ym, null),
                    }] : []}
                    // El día del mes no es un filtro ni un botón: es el dato que
                    // le da sentido a la proyección (un 40% al día 4 y al día 28
                    // no dicen lo mismo). Va por la escotilla de §17.
                    accionesExtra={esMesActual && rows[0] ? (
                        <Badge variant="neutral" size="sm">
                            día {rows[0].dias_transcurridos} de {rows[0].dias_mes}
                        </Badge>
                    ) : null}
                >
                    <FilterBar.Section active={!esMesActual} onClear={() => setYm(ymActual)} label="mes">
                        <PeriodStepper
                            unit="mes"
                            label={ymLabel(ym)}
                            isCurrent={esMesActual}
                            onPrev={() => setYm((v) => ymSumar(v, -1))}
                            onNext={() => setYm((v) => ymSumar(v, 1))}
                            onReset={() => setYm(ymActual)}
                            resetLabel="Ir al mes actual"
                            prevDisabled={ym <= YM_INICIO_HISTORIA}
                            nextDisabled={ym >= ymMax}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section active={!!salaMes} onClear={() => setSalaMes('')} label="sala">
                        <FilterBar.Sucursal
                            value={salaMes || null}
                            onChange={(v) => setSalaMes(v || '')}
                            options={salaOptions || []}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            </div>

            {error && (
                <EmptyState
                    compact icon={AlertTriangle}
                    iconClass="text-danger" glowClass="bg-danger/30"
                    title="No se pudieron cargar las metas"
                    subtitle={error}
                    action={<Button variant="secondary" icon={RefreshCw} onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>}
                />
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {loading
                    ? [1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} data-surface="card" className="p-5"><SkeletonText lines={4} /></div>
                    ))
                    : visibles.map((r) => {
                        const tramo = TRAMO_CFG[r.bono_tier];
                        const sinMeta = r.monto_meta == null;
                        return (
                            <article key={r.branch_id} data-surface="card" className="p-5 flex flex-col">
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <div>
                                        <h2 className="text-body font-black leading-tight">{salaNombre(r.branch_id)}</h2>
                                        <p className="text-label font-semibold text-content-3 mt-0.5 tabular-nums">
                                            {sinMeta
                                                ? <>Vendido {cerrado ? 'en el mes' : 'este mes'} <strong className="text-content-2">{formatMoney(r.venta_acumulada)}</strong></>
                                                : <>Meta <strong className="text-content-2">{formatMoney(r.monto_meta)}</strong></>}
                                        </p>
                                        {/* De qué está hecha la meta. Solo cuando trae un
                                            gasto adentro: en el resto de los meses sería
                                            repetir el mismo número dos veces. Es información
                                            administrativa — la sala no la ve en su widget. */}
                                        {!sinMeta && desglose[r.branch_id] && (
                                            <p className="text-micro font-semibold text-content-3 mt-0.5 tabular-nums">
                                                {formatMoney(desglose[r.branch_id].base)} de venta
                                                {' + '}
                                                <span className="text-chart-1-text font-black">
                                                    {formatMoney(desglose[r.branch_id].recuperacion)}
                                                </span>
                                                {' por gastos'}
                                            </p>
                                        )}
                                    </div>
                                    {sinMeta
                                        ? <Badge variant="neutral" size="sm">Sin meta</Badge>
                                        : r.estado !== 'oficial'
                                            ? <Badge variant="warning" size="sm">Pendiente de aprobar</Badge>
                                            : tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>}
                                </div>

                                {sinMeta ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 py-4">
                                        {/* §26.1 — «todavía» promete algo que la app
                                            no sabe; el vacío se dice y ya. */}
                                        <p className="text-label font-semibold text-content-3 max-w-[240px]">
                                            Sin meta para {ymLabel(ym).toLowerCase()}
                                        </p>
                                        {canEdit && (
                                            <Button variant="primary" icon={Plus} onClick={() => onAgregarMeta(ym, r.branch_id)}>
                                                Agregar meta
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-baseline gap-2 flex-wrap">
                                            <span className="text-2xl font-black tabular-nums tracking-tight">{formatMoney(r.venta_acumulada)}</span>
                                            <span className="text-body-sm font-black text-chart-1-text tabular-nums">{fmtPct(r.pct_cumplimiento)}</span>
                                            <span className="text-label font-semibold text-content-3">vendido</span>
                                        </div>
                                        <BarraAvance pct={Number(r.pct_cumplimiento)} pctProyectado={Number(r.pct_proyectado)} cerrado={cerrado} />
                                        {!cerrado && r.proyeccion != null && (
                                            <p className="mt-3 text-label font-semibold text-content-2 tabular-nums">
                                                Cierra en <strong>{formatMoney(r.proyeccion)}</strong>
                                                {' → '}<strong className={tramo?.textCls || ''}>{fmtPct(r.pct_proyectado)}</strong>
                                                {r.bono_tier === 'medio' && (
                                                    <span className="text-content-3"> · le faltan {formatMoney(Math.max(0, r.monto_meta - r.proyeccion))} para el 100%</span>
                                                )}
                                                {r.bono_tier === 'nada' && (
                                                    <span className="text-content-3"> · le faltan {formatMoney(Math.max(0, r.monto_meta * 0.95 - r.proyeccion))} para el 95%</span>
                                                )}
                                            </p>
                                        )}
                                        {cerrado && (
                                            <p className="mt-3 text-label font-semibold text-content-2 tabular-nums">
                                                Cerró en <strong className={tramo?.textCls || ''}>{fmtPct(r.pct_cumplimiento)}</strong> de la meta
                                            </p>
                                        )}
                                    </>
                                )}
                            </article>
                        );
                    })}
            </div>

            {/* §18.1 — el vacío por FILTRO y el vacío por falta de datos son
                mensajes distintos y salidas distintas: uno se resuelve soltando
                la búsqueda, el otro no tiene nada que soltar. */}
            {!loading && !error && visibles.length === 0 && (
                searchTerm?.trim() ? (
                    <EmptyState
                        compact icon={Search}
                        title="Sin resultados"
                        subtitle={`Ninguna sala coincide con "${searchTerm.trim()}".`}
                        action={onClearSearch && (
                            <Button variant="secondary" onClick={onClearSearch}>Limpiar la búsqueda</Button>
                        )}
                    />
                ) : (
                    <EmptyState
                        compact icon={Target}
                        title="Sin salas para este mes"
                        subtitle="Cuando una sala registre ventas, su tarjeta aparece acá."
                    />
                )
            )}

            {/* Cómo va el mes y quién lo está vendiendo. Debajo de las tarjetas
                porque es el detalle de lo que ellas resumen, y solo para el mes
                en curso. El selector es de esta sección, no de la vista: manda
                sobre las dos tarjetas de abajo y sobre nada más. */}
            {esMesActual && (
                <section className="space-y-4 pt-2">
                    <h2 className="text-body font-black">Cómo va {ymLabel(ym).toLowerCase()}</h2>

                    {cargandoMes ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                            <div data-surface="card" className="p-5"><SkeletonText lines={6} /></div>
                            <div data-surface="card" className="p-5"><SkeletonText lines={6} /></div>
                        </div>
                    ) : mes ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                            <GraficaMes data={mes} vista={vistaMes} onVista={setVistaMes} />
                            <RankingVendedores data={mes} />
                        </div>
                    ) : null}
                </section>
            )}
        </div>
    );
}
