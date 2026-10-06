import React, { useState, useEffect, useCallback, useMemo } from 'react';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import { EmptyState } from '../../components/common/StateViews';
import { useSearchParams } from 'react-router-dom';
import { smartFilter } from '@nucleo/utils/searchUtils';
import {
    BarChart2, Clock, Truck, PackageCheck,
    Pause, ClipboardList, Building2, RefreshCw, Search,
} from 'lucide-react';
import { ERP_NAMES } from '@nucleo/constants/erp';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { fetchIndicadoresDePedidos, fetchRazonesDePausa } from '@nucleo/data/pedidos';
import { indicadoresDePedidos, minutosLegibles } from '@nucleo/utils/tableroDePedidos';
import { PAUSE_REASONS } from '@nucleo/constants/pedidos';

// Rediseño 2026-10-06 — la pestaña no seguía el canon de las demás vistas:
// un encabezado propio («Métricas de eficiencia» + «Refrescar» suelto), el
// rango en su propio renglón, cada columna de la tabla en un color distinto
// sin que el color significara nada, y los motivos de pausa con la CLAVE
// cruda («interrupcion», sin tilde). Hoy es la fila de §17.0 —carril de
// tarjetas + `FilterBar` con el rango como ranura y «Actualizar» como acción—
// y dos `DataTable` con los números en neutro.

const COLS_SUCURSAL = [
    { key: 'sucursal',  label: 'Sucursal' },
    { key: 'pedidos',   label: 'Pedidos',    align: 'center' },
    { key: 'prep',      label: 'Prep. neto', align: 'center' },
    { key: 'pausa',     label: 'Pausa',      align: 'center' },
    { key: 'transito',  label: 'Tránsito',   align: 'center' },
    { key: 'recuento',  label: 'Recuento',   align: 'center' },
    { key: 'pausas',    label: 'Pausas',     align: 'center' },
];

const COLS_RAZONES = [
    { key: 'razon',    label: 'Motivo' },
    { key: 'conteo',   label: 'Veces' },
    { key: 'promedio', label: 'Duración prom.', align: 'right' },
];

// La base guarda la CLAVE del motivo; el rótulo es el del modal de pausa.
const ROTULO_RAZON = Object.fromEntries(PAUSE_REASONS.map(r => [r.key, r.label]));
const rotuloRazon = (razon) => ROTULO_RAZON[razon] ?? razon;

// Los rótulos eran «Últimos NN días»: tres veces la misma palabra para decir
// lo que el rótulo del control («Rango») ya dice, y 270px de riel que no
// entran en un teléfono de 390px. El número y la unidad alcanzan.
const RANGES = [
    { key: '7d',  label: '7 días',  days: 7  },
    { key: '30d', label: '30 días', days: 30 },
    { key: '90d', label: '90 días', days: 90 },
];

function toDateStr(date) {
    return date.toISOString().split('T')[0];
}

// El formato de minutos y los promedios son del núcleo (`indicadoresDePedidos`):
// la app nativa muestra las mismas métricas.
const fmtMin = minutosLegibles;

export default function TabMetricas({ searchTerm = '' }) {
    // El rango vive en la dirección, como la pestaña: F5 no lo devuelve a 30.
    const [params, setParams] = useSearchParams();
    const range = RANGES.some(r => r.key === params.get('rango')) ? params.get('rango') : '30d';
    const setRange = useCallback((key) => setParams(p => {
        if (key === '30d') p.delete('rango'); else p.set('rango', key);
        return p;
    }, { replace: true }), [setParams]);

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
                fetchIndicadoresDePedidos({ p_desde: desde, p_hasta: hasta }),
                fetchRazonesDePausa({ p_desde: desde, p_hasta: hasta }),
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

    const days = RANGES.find(r => r.key === range)?.days ?? 30;
    useEffect(() => { load(days); }, [days, load]);

    // Métricas globales y por sucursal — núcleo.
    const ind = indicadoresDePedidos(kpis, (id) => ERP_NAMES[id] ?? `Suc. ${id}`);
    const sucursalStats = ind.porSucursal;

    const filteredSucs = useMemo(() => {
        if (!searchTerm.trim()) return sucursalStats;
        return smartFilter(searchTerm, sucursalStats, s => [s.nombre]).results;
    }, [sucursalStats, searchTerm]);

    const maxConteo = razones[0]?.conteo || 1;
    const sinDatos  = !loading && kpis.length === 0;

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {/* ── Indicadores y filtros — una fila (§17.0) ── */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Tiempos de los pedidos">
                    <StatCard icon={ClipboardList} label="Pedidos" value={ind.pedidos} loading={loading}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={`últimos ${days} días`} />
                    <StatCard icon={Clock} label="Preparación" value={fmtMin(ind.prep)} loading={loading}
                        sub="promedio, sin pausas" />
                    <StatCard icon={Truck} label="Tránsito" value={fmtMin(ind.transito)} loading={loading}
                        sub="de bodega a la sala" />
                    <StatCard icon={PackageCheck} label="Recuento" value={fmtMin(ind.recuento)} loading={loading}
                        sub="de la llegada al ingreso" />
                    <StatCard icon={Pause} label="Pausas" value={fmtMin(ind.pausado)} loading={loading}
                        sub={`${ind.pausas} en total`} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar
                        onClear={() => setRange('30d')}
                        activeCount={range !== '30d' ? 1 : 0}
                        acciones={[{ key: 'actualizar', icon: RefreshCw, label: 'Actualizar', soloIcono: true,
                            disabled: refreshing, onClick: () => load(days) }]}
                    >
                        <FilterBar.Section active={range !== '30d'} onClear={() => setRange('30d')} label="período">
                            <SegmentedControl
                                size="sm" tone="brand" label="Período"
                                options={RANGES.map(r => ({ value: r.key, label: r.label }))}
                                value={range} onChange={setRange} />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {sinDatos ? (
                <div data-surface="card">
                    <EmptyState
                        compact
                        icon={BarChart2}
                        title="Sin tiempos registrados"
                        subtitle={`No hay pedidos despachados en los últimos ${days} días. Prueba con un período más largo.`}
                    />
                </div>
            ) : (
                <>
                    {/* ── Por sucursal ── */}
                    {/* Siete columnas de números no entran en 390px. En el
                        teléfono cada sucursal cae a ficha: el nombre arriba,
                        los pedidos a la derecha —que es el número por el que
                        se abre esta pantalla— y los dos tiempos que más se
                        miran en la línea de contexto. El ancla se declara
                        porque acá no hay ninguna columna alineada a la
                        derecha, y sin eso la inferencia tomaría la última,
                        que es el conteo de pausas. */}
                    {/* §26.2 — el vacío por búsqueda se arregla borrando el
                        término; el vacío de verdad, despachando pedidos. */}
                    <DataTable
                        columns={COLS_SUCURSAL}
                        dense minWidth="640px"
                        loading={loading}
                        toolbar={(
                            <span className="flex items-center gap-2 text-body font-semibold text-content">
                                <Building2 size={15} className="text-content-3" aria-hidden="true" />
                                Por sucursal
                            </span>
                        )}
                        empty={searchTerm.trim()
                            ? { icon: Search, message: `Ninguna sucursal coincide con "${searchTerm}"` }
                            : { icon: Building2, message: 'Sin sucursales con tiempos' }}
                        movil={{ identidad: 'sucursal', ancla: 'pedidos', chips: ['prep', 'transito'] }}
                    >
                        {filteredSucs.map((s, i) => (
                            <DataRow key={s.id} index={i}>
                                <DataCell className="font-semibold text-content">{s.nombre}</DataCell>
                                <DataCell align="center" className="text-content tabular-nums font-semibold">{s.pedidos}</DataCell>
                                <DataCell align="center" className="text-content-2 tabular-nums">{fmtMin(s.prep)}</DataCell>
                                <DataCell align="center" className="text-content-2 tabular-nums">{fmtMin(s.pausado)}</DataCell>
                                <DataCell align="center" className="text-content-2 tabular-nums">{fmtMin(s.transito)}</DataCell>
                                <DataCell align="center" className="text-content-2 tabular-nums">{fmtMin(s.recuento)}</DataCell>
                                <DataCell align="center" className="text-content-2 tabular-nums">
                                    {s.pausas > 0 ? s.pausas : <span className="text-content-3">—</span>}
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>

                    {/* ── Motivos de pausa ── */}
                    {razones.length > 0 && (
                        <DataTable
                            columns={COLS_RAZONES}
                            dense minWidth="420px"
                            toolbar={(
                                <span className="flex items-center gap-2 text-body font-semibold text-content">
                                    <Pause size={15} className="text-content-3" aria-hidden="true" />
                                    Motivos de pausa
                                </span>
                            )}
                            empty={{ icon: Pause, message: 'Sin pausas en el período' }}
                            movil={{ identidad: 'razon', ancla: 'promedio', chips: ['conteo'] }}
                        >
                            {razones.map((r, i) => (
                                <DataRow key={r.razon} index={i}>
                                    <DataCell className="font-semibold text-content">{rotuloRazon(r.razon)}</DataCell>
                                    <DataCell>
                                        <span className="flex items-center gap-2">
                                            <span className="text-content tabular-nums font-semibold w-6 text-right">{r.conteo}</span>
                                            {/* El ancho ES el dato (§32.8 regla 1). */}
                                            <span data-medida="dato" className="flex-1 max-w-[220px] h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                <span className="block h-full rounded-full bg-chart-1"
                                                    style={{ width: `${Math.min(100, (r.conteo / maxConteo) * 100)}%` }} />
                                            </span>
                                        </span>
                                    </DataCell>
                                    <DataCell align="right" className="text-content-2 tabular-nums">
                                        {r.min_promedio != null ? fmtMin(r.min_promedio) : '—'}
                                    </DataCell>
                                </DataRow>
                            ))}
                        </DataTable>
                    )}
                </>
            )}
        </div>
    );
}
