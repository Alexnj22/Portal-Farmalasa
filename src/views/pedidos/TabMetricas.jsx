import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { smartFilter } from '../../utils/searchUtils';
import {
    Loader2, BarChart2, Clock, Truck, PackageCheck,
    Pause, TrendingUp, Building2, RefreshCw,
} from 'lucide-react';
import { ERP_NAMES } from '../../constants/erp';

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

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
        blue:    'text-blue-600 bg-blue-50 border-blue-100',
        teal:    'text-teal-600 bg-teal-50 border-teal-100',
        indigo:  'text-indigo-600 bg-indigo-50 border-indigo-100',
        amber:   'text-amber-600 bg-amber-50 border-amber-100',
        emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
        violet:  'text-violet-600 bg-violet-50 border-violet-100',
    };
    return (
        <div className={`${GLASS} px-4 py-3 flex items-center gap-3`}>
            <span className={`p-2 rounded-xl border ${colors[color]}`}>
                <Icon size={16} />
            </span>
            <div>
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="text-[18px] font-bold text-slate-700 leading-tight">{value}</p>
                {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
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
            <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Calculando métricas…</span>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart2 size={14} className="text-blue-500" />
                    <span className="text-[12px] font-semibold text-slate-600">Métricas de eficiencia</span>
                </div>
                <button
                    onClick={() => load(RANGES.find(r => r.key === range)?.days ?? 30)}
                    disabled={refreshing}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                    Refrescar
                </button>
            </div>

            {/* Selector de rango */}
            <div className="flex gap-1.5">
                {RANGES.map(r => (
                    <button
                        key={r.key}
                        onClick={() => setRange(r.key)}
                        className={`text-[11px] px-3 py-1.5 rounded-full border font-medium transition-colors ${
                            range === r.key
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                        }`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>

            {kpis.length === 0 ? (
                <div className={`${GLASS} flex flex-col items-center justify-center py-12 gap-2 text-slate-500`}>
                    <BarChart2 size={32} className="opacity-40" />
                    <p className="text-[13px]">Sin datos para el período seleccionado.</p>
                    <p className="text-[11px] text-slate-500">Los tiempos se registran al despachar y recibir pedidos.</p>
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
                        <div className="px-4 py-3 border-b border-slate-100">
                            <p className="text-[12px] font-semibold text-slate-600 flex items-center gap-2">
                                <Building2 size={13} className="text-slate-400" />
                                Por sucursal
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left px-4 py-2.5 font-semibold text-slate-500">Sucursal</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-slate-500">Pedidos</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-violet-600">Prep. neto</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-amber-600">Pausa</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-indigo-600">Tránsito</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-teal-600">Recuento</th>
                                        <th className="text-center px-3 py-2.5 font-semibold text-slate-500">Pausas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSucs.map(s => (
                                        <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-2.5 font-semibold text-slate-700">{s.nombre}</td>
                                            <td className="px-3 py-2.5 text-center text-slate-600 tabular-nums">{s.pedidos}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-violet-700 tabular-nums">{fmtMin(s.avgPrep)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-amber-600 tabular-nums">{fmtMin(s.avgPausado)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-indigo-700 tabular-nums">{fmtMin(s.avgTransito)}</td>
                                            <td className="px-3 py-2.5 text-center font-medium text-teal-700 tabular-nums">{fmtMin(s.avgRecuento)}</td>
                                            <td className="px-3 py-2.5 text-center tabular-nums">
                                                {s.numPausas > 0 ? (
                                                    <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                                                        <Pause size={9} />
                                                        {s.numPausas}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500">—</span>
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
                            <div className="px-4 py-3 border-b border-slate-100">
                                <p className="text-[12px] font-semibold text-slate-600 flex items-center gap-2">
                                    <Pause size={13} className="text-amber-500" />
                                    Razones de pausa
                                </p>
                            </div>
                            <div className="px-4 py-3 space-y-2">
                                {razones.map(r => (
                                    <div key={r.razon} className="flex items-center gap-3">
                                        <span className="text-[12px] text-slate-600 font-medium flex-1">{r.razon}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[11px] font-bold text-amber-600 tabular-nums w-6 text-right">{r.conteo}</span>
                                            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-amber-400 rounded-full"
                                                    style={{ width: `${Math.min(100, (r.conteo / razones[0].conteo) * 100)}%` }}
                                                />
                                            </div>
                                            {r.min_promedio != null && (
                                                <span className="text-[10px] text-slate-500 w-14 text-right tabular-nums">
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
