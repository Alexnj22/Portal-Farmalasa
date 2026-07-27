import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import { supabase } from '../../supabaseClient';
import { smartFilter } from '../../utils/searchUtils';
import {
    Loader2, BarChart2, Clock, Truck, PackageCheck,
    Pause, TrendingUp, Building2, RefreshCw,
} from 'lucide-react';
import { ERP_NAMES } from '../../constants/erp';

const GLASS = 'rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[var(--shadow-glow-brand)]';

const RANGES = [
    { key: '7d',  label: 'Últimos 7 días',  days: 7  },
    { key: '30d', label: 'Últimos 30 días', days: 30 },
    { key: '90d', label: 'Últimos 90 días', days: 90 },
];

function toDateStr(date) {
    return date.toISOString().split('T')[0];
}

function fmtMin(min) {
    if (min == null || min < 0) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function avg(arr) {
    const valid = arr.filter(v => v != null && v >= 0);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

function StatCard({ icon: Icon, label, value, color = 'blue', sub = null }) {
    const colors = {
        blue:    'text-chart-1-text bg-chart-1/10 border-chart-1/30',
        teal:    'text-chart-9-text bg-chart-9/10 border-chart-9/20',
        indigo:  'text-chart-3-text bg-chart-3/10 border-chart-3/30',
        amber:   'text-warning bg-warning/10 border-warning/30',
        emerald: 'text-success bg-success/10 border-success/30',
        violet:  'text-chart-3-text bg-chart-3/10 border-chart-3/20',
    };
    return (
        <div className={`${GLASS} px-4 py-3 flex items-center gap-3`}>
            <span className={`p-2 rounded-xl border ${colors[color]}`}>
                <Icon size={16} />
            </span>
            <div>
                <p className="text-label text-content-3">{label}</p>
                <p className="text-title-sm font-bold text-content-2 leading-tight">{value}</p>
                {sub && <p className="text-caption text-content-3">{sub}</p>}
            </div>
        </div>
    );
}

export default function TabMetricas({ searchTerm = '' }) {
    const [range,       setRange]       = useState('30d');
    const [kpis,        setKpis]        = useState([]);
    const [razones,     setRazones]     = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [refreshing,  setRefreshing]  = useState(false);

    const load = useCallback(async (days) => {
        setRefreshing(true);
        try {
            const hasta  = toDateStr(new Date());
            const desdeD = new Date();
            desdeD.setDate(desdeD.getDate() - days);
            const desde = toDateStr(desdeD);

            const [{ data: kData, error: e1 }, { data: rData, error: e2 }] = await Promise.all([
                supabase.rpc('get_pedido_kpis',          { p_desde: desde, p_hasta: hasta }),
                supabase.rpc('get_pausa_razones_stats',  { p_desde: desde, p_hasta: hasta }),
            ]);
            if (e1) throw e1;
            if (e2) throw e2;
            setKpis(kData ?? []);
            setRazones(rData ?? []);
        } catch (err) {
            console.error('[TabMetricas]', err?.message ?? err);
            setKpis([]);
            setRazones([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        const days = RANGES.find(r => r.key === range)?.days ?? 30;
        load(days);
    }, [range, load]);

    // Métricas globales
    const totalPedidos  = new Set(kpis.map(k => k.pedido_id)).size;
    const avgPrep       = fmtMin(avg(kpis.map(k => k.tiempo_prep_neto_min)));
    const avgTransito   = fmtMin(avg(kpis.map(k => k.tiempo_transito_min)));
    const avgRecuento   = fmtMin(avg(kpis.map(k => k.tiempo_recuento_min)));
    const avgPausado    = fmtMin(avg(kpis.map(k => k.tiempo_pausado_min)));
    const totalPausas   = kpis.reduce((s, k) => s + (k.num_pausas ?? 0), 0);

    // Métricas por sucursal
    const sucursalGroups = kpis.reduce((acc, k) => {
        const id = k.erp_sucursal_id;
        if (!acc[id]) acc[id] = [];
        acc[id].push(k);
        return acc;
    }, {});

    const sucursalStats = Object.entries(sucursalGroups)
        .map(([idStr, rows]) => ({
            id:           Number(idStr),
            nombre:       ERP_NAMES[Number(idStr)] ?? `Suc. ${idStr}`,
            pedidos:      new Set(rows.map(r => r.pedido_id)).size,
            avgPrep:      avg(rows.map(r => r.tiempo_prep_neto_min)),
            avgPausado:   avg(rows.map(r => r.tiempo_pausado_min)),
            avgTransito:  avg(rows.map(r => r.tiempo_transito_min)),
            avgRecuento:  avg(rows.map(r => r.tiempo_recuento_min)),
            numPausas:    rows.reduce((s, r) => s + (r.num_pausas ?? 0), 0),
        }))
        .sort((a, b) => b.pedidos - a.pedidos);

    const filteredSucs = useMemo(() => {
        if (!searchTerm.trim()) return sucursalStats;
        return smartFilter(searchTerm, sucursalStats, s => [s.nombre]).results;
    }, [sucursalStats, searchTerm]);

    if (loading) {
        return (
            <div className="py-16"><SkeletonText lines={5} /></div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart2 size={14} className="text-chart-1-text" />
                    <span className="text-body-sm font-semibold text-content-2">Métricas de eficiencia</span>
                </div>
                <Button variant="ghost" icon={RefreshCw} disabled={refreshing} onClick={() => load(RANGES.find(r => r.key === range)?.days ?? 30)}>Refrescar</Button>
            </div>

            {/* Selector de rango */}
            <div className="flex gap-1.5">
                {RANGES.map(r => (
                    <button
                        key={r.key}
                        onClick={() => setRange(r.key)}
                        className={`text-label px-3 py-1.5 rounded-full border font-medium transition-colors ${
                            range === r.key
                                ? 'bg-chart-1-solid text-white border-chart-1'
                                : 'bg-surface-card text-content-3 border-divider hover:border-divider hover:text-content-2'
                        }`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>

            {kpis.length === 0 ? (
                <div className={`${GLASS} flex flex-col items-center justify-center py-12 gap-2 text-content-3`}>
                    <BarChart2 size={32} className="opacity-40" />
                    <p className="text-body">Sin datos para el período seleccionado.</p>
                    <p className="text-label text-content-3">Los tiempos se registran al despachar y recibir pedidos.</p>
                </div>
            ) : (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <StatCard icon={TrendingUp}   label="Pedidos con datos" value={totalPedidos}   color="blue"    />
                        <StatCard icon={Clock}        label="Prep. neto prom."  value={avgPrep}        color="violet"  sub="sin contar pausas" />
                        <StatCard icon={Truck}        label="Tránsito prom."    value={avgTransito}    color="indigo"  />
                        <StatCard icon={PackageCheck} label="Recuento prom."    value={avgRecuento}    color="teal"    />
                        <StatCard icon={Pause}        label="Pausa prom."       value={avgPausado}     color="amber"   sub={`${totalPausas} pausas totales`} />
                    </div>

                    {/* Tabla por sucursal */}
                    <div className={GLASS}>
                        <div className="px-4 py-3 border-b border-divider">
                            <p className="text-body-sm font-semibold text-content-2 flex items-center gap-2">
                                <Building2 size={13} className="text-content-3" />
                                Por sucursal
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-label">
                                <thead>
                                    <tr className="border-b border-divider">
                                        <th className="text-left px-4 py-2.5 font-semibold text-content-3">Sucursal</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-content-3">Pedidos</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-chart-3-text">Prep. neto</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-warning">Pausa</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-chart-3-text">Tránsito</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-chart-9-text">Recuento</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-content-3">Pausas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSucs.map(s => (
                                        <tr key={s.id} className="border-b border-divider hover:bg-surface-card-hover/50 transition-colors">
                                            <td className="px-4 py-2.5 font-semibold text-content-2">{s.nombre}</td>
                                            <td className="px-3 py-2.5 text-center text-content-2 tabular-nums">{s.pedidos}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-chart-3-text tabular-nums">{fmtMin(s.avgPrep)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-warning tabular-nums">{fmtMin(s.avgPausado)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-chart-3-text tabular-nums">{fmtMin(s.avgTransito)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-chart-9-text tabular-nums">{fmtMin(s.avgRecuento)}</td>
                                            <td className="px-3 py-2.5 text-center tabular-nums">
                                                {s.numPausas > 0 ? (
                                                    <span className="inline-flex items-center gap-0.5 text-warning font-semibold">
                                                        <Pause size={9} />
                                                        {s.numPausas}
                                                    </span>
                                                ) : (
                                                    <span className="text-content-3">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Razones de pausa */}
                    {razones.length > 0 && (
                        <div className={GLASS}>
                            <div className="px-4 py-3 border-b border-divider">
                                <p className="text-body-sm font-semibold text-content-2 flex items-center gap-2">
                                    <Pause size={13} className="text-warning" />
                                    Razones de pausa
                                </p>
                            </div>
                            <div className="px-4 py-3 space-y-2">
                                {razones.map(r => (
                                    <div key={r.razon} className="flex items-center gap-3">
                                        <span className="text-body-sm text-content-2 font-medium flex-1">{r.razon}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-label font-bold text-warning tabular-nums w-6 text-right">{r.conteo}</span>
                                            <div className="w-24 h-2 bg-surface-card-hover rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-warning rounded-full"
                                                    style={{ width: `${Math.min(100, (r.conteo / razones[0].conteo) * 100)}%` }}
                                                />
                                            </div>
                                            {r.min_promedio != null && (
                                                <span className="text-caption text-content-3 w-14 text-right tabular-nums">
                                                    ~{fmtMin(r.min_promedio)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
