import React, { useState, useEffect, useCallback, useMemo } from 'react';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import Button from '../../components/common/Button';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { supabase } from '../../supabaseClient';
import { smartFilter } from '../../utils/searchUtils';
import {
    Loader2, BarChart2, Clock, Truck, PackageCheck,
    Pause, TrendingUp, Building2, RefreshCw,
} from 'lucide-react';
import { ERP_NAMES } from '../../constants/erp';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';

const COLS_SUCURSAL = [
    { key: 'sucursal',  label: 'Sucursal' },
    { key: 'pedidos',   label: 'Pedidos',    align: 'center' },
    { key: 'prep',      label: 'Prep. neto', align: 'center' },
    { key: 'pausa',     label: 'Pausa',      align: 'center' },
    { key: 'transito',  label: 'Tránsito',   align: 'center' },
    { key: 'recuento',  label: 'Recuento',   align: 'center' },
    { key: 'pausas',    label: 'Pausas',     align: 'center' },
];

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
                <SegmentedControl
                    size="sm" tone="chart-1"
                    options={RANGES.map(r => ({ value: r.key, label: r.label }))}
                    value={range} onChange={setRange} label="Rango" />
            </div>

            {kpis.length === 0 ? (
                <div className={GLASS}>
                    <EmptyState
                        compact
                        icon={BarChart2}
                        title="Sin datos para el período"
                        subtitle="Los tiempos se registran al despachar y recibir pedidos."
                    />
                </div>
            ) : (
                <>
                    {/* Summary cards */}
                    <CarrilCards ariaLabel="Métricas de pedidos">
                        <StatCard icon={TrendingUp}   label="Con datos" value={totalPedidos} iconBg="bg-chart-1/10" iconCls="text-chart-1-text"    />
                        <StatCard icon={Clock}        label="Prep. neto prom."  value={avgPrep} iconBg="bg-chart-3/10" iconCls="text-chart-3-text"  sub="sin contar pausas" />
                        <StatCard icon={Truck}        label="Tránsito prom."    value={avgTransito} iconBg="bg-chart-3/10" iconCls="text-chart-3-text"  />
                        <StatCard icon={PackageCheck} label="Recuento prom."    value={avgRecuento} iconBg="bg-chart-9/10" iconCls="text-chart-9-text"    />
                        <StatCard icon={Pause}        label="Pausa prom."       value={avgPausado} iconBg="bg-warning/10" iconCls="text-warning-text"   sub={`${totalPausas} pausas totales`} />
                    </CarrilCards>

                    {/* Tabla por sucursal */}
                    <div className={GLASS}>
                        <div className="px-4 py-3 border-b border-divider">
                            <p className="text-body-sm font-semibold text-content-2 flex items-center gap-2">
                                <Building2 size={13} className="text-content-3" />
                                Por sucursal
                            </p>
                        </div>
                        {/* Siete columnas de números no entran en 390px. En el
                            teléfono cada sucursal cae a ficha: el nombre arriba,
                            los pedidos a la derecha —que es el número por el que
                            se abre esta pantalla— y los dos tiempos que más se
                            miran en la línea de contexto. El ancla se declara
                            porque acá no hay ninguna columna alineada a la
                            derecha, y sin eso la inferencia tomaría la última,
                            que es el conteo de pausas. `plano` porque la sección
                            ya vive dentro de su propia tarjeta con encabezado. */}
                        <DataTable
                            columns={COLS_SUCURSAL}
                            plano dense minWidth="640px"
                            movil={{ identidad: 'sucursal', ancla: 'pedidos', chips: ['prep', 'transito'] }}
                        >
                            {filteredSucs.map((s, i) => (
                                <DataRow key={s.id} index={i}>
                                    <DataCell className="font-semibold text-content-2">{s.nombre}</DataCell>
                                    <DataCell align="center" className="text-content-2 tabular-nums">{s.pedidos}</DataCell>
                                    <DataCell align="center" className="font-medium text-chart-3-text tabular-nums">{fmtMin(s.avgPrep)}</DataCell>
                                    <DataCell align="center" className="font-medium text-warning tabular-nums">{fmtMin(s.avgPausado)}</DataCell>
                                    <DataCell align="center" className="font-medium text-chart-3-text tabular-nums">{fmtMin(s.avgTransito)}</DataCell>
                                    <DataCell align="center" className="font-medium text-chart-9-text tabular-nums">{fmtMin(s.avgRecuento)}</DataCell>
                                    <DataCell align="center" className="tabular-nums">
                                        {s.numPausas > 0 ? (
                                            <span className="inline-flex items-center gap-0.5 text-warning font-semibold">
                                                <Pause size={9} />
                                                {s.numPausas}
                                            </span>
                                        ) : (
                                            <span className="text-content-3">—</span>
                                        )}
                                    </DataCell>
                                </DataRow>
                            ))}
                        </DataTable>
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
