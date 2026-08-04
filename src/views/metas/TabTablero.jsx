import React, { useEffect, useMemo, useState } from 'react';
import { Target, TrendingUp, Gauge, BarChart3, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import { SkeletonText } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchMetasDashboard } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA, TRAMO_CFG } from './metasUtils';

const fmtPct = (v) => formatPct(v);

// La barra de avance lleva la regla del bono DIBUJADA: la marca ámbar es el
// umbral del medio bono (95%) y la verde el del completo (100%). El rombo es
// dónde cierra el mes según la proyección. Escala 0–110% de la meta para que
// pasarse de la meta también se vea.
function BarraAvance({ pct, pctProyectado, cerrado }) {
    const escala = (v) => Math.max(0, Math.min(110, v ?? 0)) / 110 * 100;
    return (
        <div>
            <div className="relative h-2.5 rounded-full bg-surface-card-hover mt-4 mb-1.5">
                <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1 transition-all" style={{ width: `${escala(pct)}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-warning/80" style={{ left: `${escala(95)}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-success" style={{ left: `${escala(100)}%` }} />
                {!cerrado && pctProyectado != null && (
                    <span
                        className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-surface-card border-2 border-chart-1"
                        style={{ left: `${escala(pctProyectado)}%` }}
                    />
                )}
            </div>
            <div className="flex justify-between text-micro font-bold text-content-3">
                <span>$0</span>
                <span className="text-warning-text">95%</span>
                <span className="text-success-text">meta</span>
            </div>
        </div>
    );
}

export default function TabTablero({ salaNombre, canEdit, onAgregarMeta, reloadKey, bonificacionesActivas, searchTerm }) {
    const ymActual = ymHoySV();
    const ymMax = ymSumar(ymActual, 1);
    const [ym, setYm] = useState(ymActual);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch al cambiar de mes
        setError(null);
        fetchMetasDashboard(ym)
            .then((data) => { if (alive) { setRows(data); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar las metas')); setLoading(false); } });
        return () => { alive = false; };
    }, [ym, reloadKey]);

    const esMesActual = ym === ymActual;
    const cerrado = ym < ymActual;

    const visibles = useMemo(() => {
        if (!searchTerm?.trim()) return rows;
        const q = searchTerm.trim().toLowerCase();
        return rows.filter((r) => (salaNombre(r.branch_id) || '').toLowerCase().includes(q));
    }, [rows, searchTerm, salaNombre]);

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

            <CarrilCards ariaLabel="Resumen de metas">
                <StatCard
                    icon={Target} label="Meta del mes"
                    value={resumen.meta > 0 ? formatMoney(resumen.meta) : '—'}
                    sub={resumen.conMeta > 0 ? `${resumen.conMeta} sala${resumen.conMeta !== 1 ? 's' : ''} con meta` : 'sin metas este mes'}
                    iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                    loading={loading}
                />
                <StatCard
                    icon={TrendingUp} label={cerrado ? 'Vendido en el mes' : 'Vendido'}
                    value={formatMoney(resumen.vendidoConMeta)}
                    valueCls="text-content"
                    sub={resumen.meta > 0 ? `${fmtPct(resumen.vendidoConMeta / resumen.meta * 100)} de la meta` : 'salas con meta'}
                    iconBg="bg-success/10" iconCls="text-success-text"
                    loading={loading}
                />
                {esMesActual && (
                    <StatCard
                        icon={Gauge} label="Proyección de cierre"
                        value={resumen.meta > 0 ? formatMoney(resumen.proy) : '—'}
                        valueCls="text-chart-1-text"
                        sub={resumen.meta > 0 ? `${fmtPct(resumen.proy / resumen.meta * 100)} de la meta` : undefined}
                        iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                        loading={loading}
                    />
                )}
                <StatCard
                    icon={BarChart3} label="Semáforo"
                    value={resumen.conMeta > 0
                        ? `${resumen.tiers.completo} · ${resumen.tiers.medio} · ${resumen.tiers.nada}`
                        : '—'}
                    sub={resumen.sinMeta > 0 ? `+${resumen.sinMeta} sin meta` : 'completo · medio · sin bono'}
                    loading={loading}
                />
            </CarrilCards>

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div data-surface="card" className="inline-flex items-center gap-1 px-2 py-1.5">
                    <button
                        type="button" aria-label="Mes anterior"
                        onClick={() => setYm((v) => ymSumar(v, -1))}
                        disabled={ym <= YM_INICIO_HISTORIA}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-content-3 hover:text-brand-text hover:bg-brand/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    ><ChevronLeft size={16} strokeWidth={2.5} /></button>
                    <span className="text-body-sm font-black px-1 whitespace-nowrap">{ymLabel(ym)}</span>
                    <button
                        type="button" aria-label="Mes siguiente"
                        onClick={() => setYm((v) => ymSumar(v, 1))}
                        disabled={ym >= ymMax}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-content-3 hover:text-brand-text hover:bg-brand/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    ><ChevronRight size={16} strokeWidth={2.5} /></button>
                    {esMesActual && rows[0] && (
                        <span className="text-caption font-bold text-content-3 pr-2 whitespace-nowrap tabular-nums">
                            día {rows[0].dias_transcurridos} de {rows[0].dias_mes}
                        </span>
                    )}
                </div>
                {canEdit && (
                    <Button variant="secondary" icon={Plus} onClick={() => onAgregarMeta(ym, null)}>Agregar meta</Button>
                )}
            </div>

            {error && (
                <div data-surface="card" className="p-8 text-center">
                    <p className="text-body-sm font-bold text-danger-text">{error}</p>
                </div>
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
                                    </div>
                                    {sinMeta
                                        ? <Badge variant="neutral" size="sm">Sin meta</Badge>
                                        : r.estado !== 'oficial'
                                            ? <Badge variant="warning" size="sm">Pendiente de aprobar</Badge>
                                            : tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>}
                                </div>

                                {sinMeta ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 py-4">
                                        <p className="text-label font-semibold text-content-3 max-w-[240px]">
                                            Esta sala todavía no tiene meta para {ymLabel(ym).toLowerCase()}.
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
                {!loading && !error && visibles.length === 0 && (
                    <div data-surface="card" className="p-8 text-center md:col-span-2 xl:col-span-3">
                        <Target size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm font-bold text-content-3">Sin resultados para &ldquo;{searchTerm}&rdquo;</p>
                    </div>
                )}
            </div>
        </div>
    );
}
