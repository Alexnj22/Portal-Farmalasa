import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Target, Plus, History, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import FilterBar from '../../components/common/FilterBar';
import ListRow from '../../components/common/ListRow';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { Skeleton, SkeletonText, EmptyState } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchMetasHistorico } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { agruparHistoricoPorMes, ymLabelCorto, TRAMO_CFG } from './metasUtils';

// Las dos gráficas arrastran `recharts` (95 kB gzip) y esta es la última de las
// cinco pestañas de Metas, así que viajan en su propio chunk. Leer el encabezado
// de `GraficasHistorico.jsx` antes de tocarlo.
const GraficasHistorico = lazy(() => import('./GraficasHistorico'));

// La espera del chunk, con la forma de lo que va a reemplazar: las dos tarjetas
// con su título, su línea de resumen y el área del dibujo de 210px. Sin esto la
// tabla saltaría hacia abajo cuando las gráficas aparecen.
const EsqueletoGraficas = () => (
    <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((i) => (
            <div key={i} data-surface="card" className="p-5">
                <Skeleton w="40%" h={10} />
                <Skeleton w="70%" h={11} className="mt-2" />
                <Skeleton h={210} rounded="0.75rem" className="mt-3" />
            </div>
        ))}
    </div>
);

const COLS = [
    { key: 'mes',    label: 'Mes' },
    { key: 'sala',   label: 'Sala' },
    { key: 'meta',   label: 'Meta',         align: 'right' },
    { key: 'venta',  label: 'Vendido',      align: 'right' },
    { key: 'pct',    label: 'Cumplimiento', align: 'right' },
    { key: 'bono',   label: 'Bono' },
];

const fmtPct = (v) => formatPct(v);

export default function TabHistorico({ salaNombre, canEdit, onAgregarMeta, reloadKey, searchTerm, onClearSearch }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [salaFilter, setSalaFilter] = useState('');
    const [soloConMeta, setSoloConMeta] = useState(false);
    // Ver la nota del mismo contador en TabTablero: es la salida del error.
    const [intento, setIntento] = useState(0);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch tras guardar una meta
        setError(null);
        fetchMetasHistorico()
            .then((data) => { if (alive) { setRows(data); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el histórico')); setLoading(false); } });
        return () => { alive = false; };
    }, [reloadKey, intento]);

    const salaOpts = useMemo(() => {
        const ids = [...new Set(rows.map((r) => r.branch_id))];
        return ids.map((id) => ({ value: String(id), label: salaNombre(id) }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [rows, salaNombre]);

    const filtered = useMemo(() => {
        let base = rows;
        if (salaFilter) base = base.filter((r) => String(r.branch_id) === salaFilter);
        if (soloConMeta) base = base.filter((r) => r.monto_meta != null);
        if (searchTerm?.trim()) {
            const q = searchTerm.trim().toLowerCase();
            base = base.filter((r) => (salaNombre(r.branch_id) || '').toLowerCase().includes(q));
        }
        return base;
    }, [rows, salaFilter, soloConMeta, searchTerm, salaNombre]);

    // El agrupado por mes vive fuera del archivo de las gráficas —matemática
    // pura, sin `recharts` detrás— justamente para poder preguntar acá si hay
    // material que dibujar antes de decidir bajar la librería.
    const datosGrafica = useMemo(() => agruparHistoricoPorMes(filtered), [filtered]);

    // El buscador del header también recorta esta lista, así que cuenta como
    // filtro para decidir QUÉ vacío mostrar — pero no para el «limpiar» de la
    // píldora, que por §17 solo suelta lo que la píldora misma puso.
    const hayFiltro = !!salaFilter || soloConMeta || !!searchTerm?.trim();
    const limpiarFiltros = useCallback(() => { setSalaFilter(''); setSoloConMeta(false); }, []);
    const limpiarTodo = useCallback(() => { limpiarFiltros(); onClearSearch?.(); }, [limpiarFiltros, onClearSearch]);

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <FilterBar
                    activeCount={(salaFilter ? 1 : 0) + (soloConMeta ? 1 : 0)}
                    onClear={limpiarFiltros}
                    acciones={canEdit ? [{
                        key: 'agregar', icon: Plus, label: 'Agregar meta', variant: 'primary',
                        onClick: () => onAgregarMeta(null, null),
                    }] : []}
                >
                    <FilterBar.Section active={!!salaFilter} onClear={() => setSalaFilter('')} label="sala">
                        <FilterBar.Sucursal
                            value={salaFilter || null}
                            onChange={(v) => setSalaFilter(v || '')}
                            options={salaOpts}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section active={soloConMeta} onClear={() => setSoloConMeta(false)} label="metas">
                        <FilterBar.Opciones
                            label="Qué meses mostrar"
                            value={soloConMeta ? 'CON_META' : 'TODOS'}
                            onChange={(v) => setSoloConMeta(v === 'CON_META')}
                            options={[
                                { value: 'TODOS', label: 'Todos los meses' },
                                { value: 'CON_META', label: 'Solo con meta' },
                            ]}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && (
                <EmptyState
                    compact icon={AlertTriangle}
                    iconClass="text-danger" glowClass="bg-danger/30"
                    title="No se pudo cargar el histórico"
                    subtitle={error}
                    action={<Button variant="secondary" icon={RefreshCw} onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>}
                />
            )}

            {/* Las gráficas van ENCIMA de la tabla: contestan «cómo venimos» de
                un vistazo, y la tabla está para buscar un mes concreto. Leen las
                mismas filas ya filtradas, así que el recorte de la píldora las
                alcanza igual que a la tabla.

                Con menos de dos meses no hay nada que dibujar, y esa cuenta se
                hace ACÁ: si la hiciera el componente de las gráficas, habría que
                bajar los 95 kB de `recharts` para enterarse de que no se iban a
                usar — y el esqueleto aparecería para desaparecer sin dibujo. */}
            {!loading && !error && datosGrafica.length >= 2 && (
                <Suspense fallback={<EsqueletoGraficas />}>
                    <GraficasHistorico datos={datosGrafica} />
                </Suspense>
            )}

            {/* Teléfono: una fila por mes-sala (la tabla no reflowa, §32). El
                vacío también es de acá: `DataTable` trae el suyo, pero vive en
                la rama de escritorio, así que en el teléfono la lista quedaba
                en blanco sin decir por qué. */}
            <div className="md:hidden space-y-2">
                {loading ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={5} /></div>
                ) : (!error && filtered.length === 0) ? (
                    <EmptyState
                        compact icon={hayFiltro ? Search : Target}
                        title={hayFiltro ? 'Sin resultados' : 'Sin meses en el histórico'}
                        subtitle={hayFiltro
                            ? 'Ningún mes coincide con el recorte aplicado.'
                            : 'El cumplimiento aparece cuando cada mes tiene su meta registrada.'}
                        action={hayFiltro
                            ? <Button variant="secondary" onClick={limpiarTodo}>Limpiar los filtros</Button>
                            : canEdit ? <Button variant="primary" icon={Plus} onClick={() => onAgregarMeta(null, null)}>Agregar meta</Button> : undefined}
                    />
                ) : filtered.map((r) => {
                    const tramo = TRAMO_CFG[r.bono_tier];
                    return (
                        <ListRow
                            key={`${r.year_month}-${r.branch_id}`}
                            icon={History}
                            title={`${salaNombre(r.branch_id)} · ${ymLabelCorto(r.year_month)}`}
                            subtitle={r.monto_meta != null
                                ? `Meta ${formatMoney(r.monto_meta)} · vendido ${formatMoney(r.venta_total)}`
                                : `Vendido ${formatMoney(r.venta_total)}`}
                            trailing={(
                                <span className="flex flex-col items-end gap-1">
                                    {r.monto_meta != null
                                        ? <>
                                            <span className={`text-body-sm font-black tabular-nums ${tramo?.textCls || ''}`}>{fmtPct(r.pct_cumplimiento)}</span>
                                            {tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>}
                                          </>
                                        : <Badge variant="neutral" size="sm">Sin meta</Badge>}
                                </span>
                            )}
                        />
                    );
                })}
            </div>

            <div className="hidden md:block">
                {/* El vacío de la tabla también distingue «no hay nada» de «tu
                    recorte no encontró nada» (§18.1): con filtros puestos la
                    salida es soltarlos, no registrar una meta. */}
                <DataTable columns={COLS} loading={loading} empty={hayFiltro ? {
                    icon: Search,
                    message: 'Sin resultados',
                    subtext: 'Ningún mes del histórico coincide con el recorte aplicado.',
                    action: { label: 'Limpiar los filtros', onClick: limpiarTodo },
                } : {
                    icon: Target,
                    message: 'Sin meses en el histórico',
                    subtext: canEdit
                        ? 'Agrega las metas de meses anteriores y el cumplimiento se calcula solo con las ventas del portal.'
                        : 'El cumplimiento aparece cuando cada mes tiene su meta registrada.',
                    action: canEdit ? { label: 'Agregar meta', onClick: () => onAgregarMeta(null, null) } : undefined,
                }}>
                    {filtered.map((r, i) => {
                        const tramo = TRAMO_CFG[r.bono_tier];
                        return (
                            <DataRow key={`${r.year_month}-${r.branch_id}`} index={i}>
                                <DataCell><span className="text-body-sm font-black text-content-2 whitespace-nowrap">{ymLabelCorto(r.year_month)}</span></DataCell>
                                <DataCell><span className="text-body-sm font-bold">{salaNombre(r.branch_id)}</span></DataCell>
                                <DataCell align="right">
                                    <span className="text-body-sm font-semibold tabular-nums text-content-2">
                                        {r.monto_meta != null ? formatMoney(r.monto_meta) : <span className="opacity-30">—</span>}
                                    </span>
                                </DataCell>
                                <DataCell align="right"><span className="text-body-sm font-black tabular-nums">{formatMoney(r.venta_total)}</span></DataCell>
                                <DataCell align="right">
                                    {r.pct_cumplimiento != null
                                        ? <span className={`text-body-sm font-black tabular-nums ${tramo?.textCls || ''}`}>{fmtPct(r.pct_cumplimiento)}</span>
                                        : <span className="opacity-30 text-body-sm">—</span>}
                                </DataCell>
                                <DataCell>
                                    {r.monto_meta != null
                                        ? (tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>)
                                        : <Badge variant="neutral" size="sm">Sin meta</Badge>}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </div>
        </div>
    );
}
