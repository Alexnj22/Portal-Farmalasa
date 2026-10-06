import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Switch from '../../components/common/Switch';
import { smartFilter } from '@nucleo/utils/searchUtils';
import {
    ClipboardList,
    Package,
    TriangleAlert,
    Check, Search, PackageX, Repeat,
} from 'lucide-react';
import { useToastStore } from '@nucleo/store/toastStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '@nucleo/context/AuthContext';
import { printPerSucursal, buildPedidoCodigo, fefoProject, getExactPageGroups } from '@nucleo/utils/pedidoPrint';
import { ERP_NAMES, SUCURSALES } from '@nucleo/constants/erp';
import { confirmarPedido, fetchActiveEmployeesBasic, fetchPedidoIdsSinceExcluding, fetchPedidoItemsForPrintCapture, fetchPedidoNumero, fetchPedidoSucursalStatusForPedidos, fetchTableroParaGenerarPedido, fetchVistaPreviaDePedido, iniciarCodigosDeSucursalesDelPedido, tieneEtiquetaDeDespacho, updatePedidoSucursalStatus } from '@nucleo/data/pedidos';
import LiquidTooltip from '../../components/common/LiquidTooltip';

function friendlyError(e) {
    const msg = e?.message || String(e);
    if (/statement timeout|canceling statement/i.test(msg))
        return 'El cálculo tardó demasiado. Intenta seleccionando menos sucursales a la vez.';
    if (/Failed to fetch|NetworkError|network/i.test(msg))
        return 'Error de conexión. Verifica tu internet e intenta de nuevo.';
    if (/abastecida|nada que pedir/i.test(msg))
        return msg;
    return 'Ocurrió un error al generar el pedido. Intenta de nuevo.';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTimeSince(iso) {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
    if (d === 0) return 'hoy';
    if (d === 1) return 'ayer';
    if (d < 14)  return `hace ${d}d`;
    if (d < 60)  return `hace ${Math.floor(d / 7)}sem`;
    return `hace ${Math.floor(d / 30)}m`;
}

const SIN_BODEGA_COLS = [
    { key: 'product_name',    label: 'Producto',    align: 'left',  sortable: true },
    { key: 'laboratorio',     label: 'Laboratorio', align: 'left',  sortable: true },
    { key: 'sucursales',      label: 'Solicitan',   align: 'left'                  },
    { key: 'total_necesidad', label: 'Total',       align: 'center', sortable: true, hideBelow: 'sm' },
    { key: 'total_ventas_6m', label: 'Ventas 6m',  align: 'center', sortable: true, hideBelow: 'sm' },
];

// ── Main component ───────────────────────────────────────────────────────────
export default function TabGenerar({ searchTerm = '' }) {
    const { user } = useAuth();
    const showToast = useToastStore(s => s.showToast);

    const [selected,   setSelected]   = useState(new Set());
    const [globalMode, setGlobalMode] = useState(false);

    const [confirming, setConfirming] = useState(false);
    const [error,      setError]      = useState(null);

    const [dashStats,   setDashStats]   = useState([]);
    const [dashLoading, setDashLoading] = useState(true);

    const [sinBodega,     setSinBodega]     = useState([]);
    const [sinBodegaLoad, setSinBodegaLoad] = useState(false);
    const [sinSortKey,    setSinSortKey]    = useState('total_necesidad');
    const [sinSortDir,    setSinSortDir]    = useState('desc');
    const [sinPage,       setSinPage]       = useState(1);
    const [sinPageSize,   setSinPageSize]   = useState(25);

    const [employees, setEmployees] = useState([]);

    // ── Dashboard stats + sin-bodega en UNA llamada ────────────
    // get_pedido_generar_dashboard computa el esqueleto pesado (inv_dedup +
    // necesidades + bodega_net) UNA vez y devuelve {stats, sin_bodega} —
    // antes eran 2 RPCs que recomputaban lo mismo (~800ms de servidor por
    // carga vs ~320ms). Salida verificada idéntica a las funciones
    // originales. JSONB escalar: sin el cap max-rows=1000 de PostgREST.
    const refreshStats = useCallback(() => {
        setDashLoading(true);
        setSinBodegaLoad(true);
        fetchTableroParaGenerarPedido({ p_sucursal_ids: SUCURSALES })
            .then(({ data }) => {
                setDashStats(Array.isArray(data?.stats) ? data.stats : []);
                setSinBodega(Array.isArray(data?.sin_bodega) ? data.sin_bodega : []);
            })
            .catch(() => { setDashStats([]); setSinBodega([]); })
            .finally(() => { setDashLoading(false); setSinBodegaLoad(false); });
    }, []);

    useEffect(() => { refreshStats(); }, [refreshStats]);

    // ── Empleados (para trazabilidad en handleGenerarDirecto) ──
    useEffect(() => {
        fetchActiveEmployeesBasic().then(({ data }) => setEmployees(data || []));
    }, []);

    // ── Sucursal toggle ────────────────────────────────────────
    const toggleSuc = useCallback((id) => {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    }, []);

    // ── Generar directo: calcula + confirma final + imprime ────
    const handleGenerarDirecto = useCallback(async () => {
        if (selected.size === 0) return;
        setConfirming(true); setError(null);
        try {
            const rpcParams = globalMode
                ? { p_sucursal_ids: SUCURSALES, p_target_ids: [...selected] }
                : { p_sucursal_ids: [...selected] };
            const { data, error: rpcErr } = await fetchVistaPreviaDePedido(rpcParams);
            if (rpcErr) throw rpcErr;
            const rows = Array.isArray(data) ? data : [];
            if (rows.length === 0) {
                const msg = 'Las sucursales seleccionadas están abastecidas — no hay nada que pedir.';
                setError(msg);
                showToast('Sin necesidades', msg, 'info');
                return;
            }
            const pItems = rows.map(row => ({
                erp_sucursal_id:       row.erp_sucursal_id,
                erp_product_id:        row.erp_product_id,
                erp_presentacion_id:   row.erp_presentacion_id,
                cantidad_asignada:     row.cantidad_asignada,
                sin_stock:             row.sin_stock,
                revision_minmax:       row.revision_minmax,
                agotamiento:           row.agotamiento ?? false,
                stock_packs_snapshot:  Number(row.stock_packs),
                max_qty_snapshot:      row.max_qty,
                min_qty_snapshot:      row.min_qty,
                urgencia_pct_snapshot: row.urgencia_pct,
                lotes_asignados:       fefoProject(row.lotes_bodega, row.cantidad_asignada),
                factor:                row.factor,
                dispatch_tipo:         row.dispatch_tipo,
                dispatch_factor:       row.dispatch_factor,
                // confirm_pedido ya lo leía del payload, pero nadie se lo mandaba:
                // el COALESCE lo dejaba en 1 para todo el catálogo aunque la regla
                // dijera otra cosa (391 reglas tienen un múltiplo distinto de 1).
                dispatch_multiplo:     row.dispatch_multiplo ?? 1,
                caja_especial:         row.caja_especial ?? false,
            }));
            const esEmpleado = employees.some(e => e.id === user?.id);
            const { data: pedidoId, error: confErr } = await confirmarPedido({
                p_created_by:     user?.id ?? null,
                p_notes:          null,
                p_items:          pItems,
                p_responsable_id: esEmpleado ? user.id : null,
                p_revisado_por:   null,
                p_sucursal_ids:   [...selected],
            }, { directo: true });
            if (confErr) throw confErr;
            const { data: ped } = await fetchPedidoNumero(pedidoId);

            const map = {};
            for (const row of rows) {
                const s = row.erp_sucursal_id;
                if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [], agotamiento: [] };
                if (row.sin_stock)            map[s].sinStock.push(row);
                else if (row.revision_minmax) map[s].revision.push(row);
                else if (row.agotamiento)     map[s].agotamiento.push(row);
                else                          map[s].normal.push(row);
            }
            const sucIds     = SUCURSALES.filter(id => map[id]);
            const meta       = { responsable: user?.name ?? null, revisor: null, generadoPor: user?.name ?? null, pedidoNumero: ped?.numero };

            // Numero por sucursal por mes: cuántos pedidos previos tiene cada sucursal este mes + 1
            const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
            const { data: pedidosMes } = await fetchPedidoIdsSinceExcluding(monthStart, pedidoId);
            const pedidoIdsMes = (pedidosMes ?? []).map(p => p.id);
            const countsBySuc = {};
            for (const id of sucIds) countsBySuc[id] = 1;
            if (pedidoIdsMes.length > 0) {
                const { data: sucRecs } = await fetchPedidoSucursalStatusForPedidos(pedidoIdsMes, sucIds);
                for (const r of (sucRecs ?? [])) {
                    if (countsBySuc[r.erp_sucursal_id] !== undefined) countsBySuc[r.erp_sucursal_id]++;
                }
            }

            const codigoFn   = buildPedidoCodigo(countsBySuc, new Date(), globalMode ? SUCURSALES.length : sucIds.length);
            const codigosMap = {};
            for (const id of sucIds) codigosMap[id] = codigoFn(id);

            iniciarCodigosDeSucursalesDelPedido({
                p_pedido_id: pedidoId,
                p_codigos:   sucIds.map(id => ({ erp_sucursal_id: id, codigo: codigosMap[id] })),
            }).then(() => {}).catch(() => {});

            printPerSucursal(map, sucIds, r => r.cantidad_asignada, codigoFn, meta);

            // Capturar grupos de páginas en background para que Finalizar sea instantáneo
            ;(async () => {
                let capturadas = 0;
                try {
                    for (const sid of sucIds) {
                        const rawItems = await fetchPedidoItemsForPrintCapture(pedidoId, sid);
                        if (!rawItems?.length) continue;
                        // `tiene_dispatch_label` no es columna de pedido_items: sale de la
                        // regla de despacho y se deriva acá igual que en usePedidosData.
                        // isAdicional() lo necesita para reconocer las cajas de Electrolit;
                        // sin él la captura las cuenta como filas de la tabla numerada y las
                        // hojas guardadas dejan de coincidir con el PDF que se imprimió.
                        const itemsConLabel = rawItems.map(r => ({
                            ...r,
                            tiene_dispatch_label: tieneEtiquetaDeDespacho(r),
                        }));
                        const groups = await getExactPageGroups(sid, itemsConLabel);
                        if (groups.length) {
                            await updatePedidoSucursalStatus(pedidoId, sid, { paginas: groups });
                            capturadas++;
                        }
                    }
                } catch (e) {
                    // Ya NO en silencio. Este bloque se quedó callado cuando le
                    // falló al pedido #97 —460 productos, un pedido real— y el
                    // pedido siguió sin saber qué producto va en qué hoja hasta
                    // que alguien lo finalizara. El respaldo existe, pero
                    // enterarse recién ahí es enterarse tarde.
                    console.error('[pedidos] captura de hojas:', e);
                }
                if (capturadas < sucIds.length) {
                    showToast(
                        'Las hojas quedaron a medias',
                        'Se van a recalcular al finalizar. Si puedes, deja esta pestaña abierta '
                        + 'unos segundos después de generar.',
                        'warning',
                    );
                }
            })();

            showToast(
                `Pedido #${ped?.numero} confirmado`,
                `${pItems.length} productos en ${sucIds.length} sucursal${sucIds.length > 1 ? 'es' : ''}. PDF listo para imprimir.`,
                'success',
            );
            setSelected(new Set());
            refreshStats();
        } catch (e) {
            const msg = friendlyError(e);
            setError(msg);
            showToast('Error al generar el pedido', msg, 'error');
        } finally {
            setConfirming(false);
        }
    }, [selected, globalMode, employees, user, refreshStats, showToast]);

    // ── Derived maps ───────────────────────────────────────────
    const statMap = useMemo(() => {
        const m = {};
        for (const s of dashStats) m[s.erp_sucursal_id] = s;
        return m;
    }, [dashStats]);

    // Todas las sucursales siempre visibles; las que no tienen MIN/MAX publicado
    // se muestran como "pendiente" — inactivas, no seleccionables.
    const visibleSucursales = SUCURSALES;

    const isSucPending = (id) => {
        if (dashLoading) return false;
        const s = statMap[id];
        return !s || ((s.con_bodega_productos ?? 0) + (s.sin_bodega_productos ?? 0)) === 0;
    };

    // Las que se pueden elegir de verdad: una sucursal sin MIN/MAX publicado
    // se pinta inactiva y no entra ni en la acción ni en el rótulo del botón.
    const sucursalesElegibles = visibleSucursales.filter(id => !isSucPending(id));
    const todasElegiblesSeleccionadas = sucursalesElegibles.length > 0
        && sucursalesElegibles.every(id => selected.has(id));

    const toggleAll = () => {
        setSelected(todasElegiblesSeleccionadas ? new Set() : new Set(sucursalesElegibles));
    };

    // urgLevel: 'high' ≥65% depleción · 'mid' ≥40% · 'low' <40% · 'none' sin datos
    const getUrgLevel = (stat) => {
        const pct = stat?.avg_urgencia_pct;
        if (pct == null) return 'none';
        if (pct >= 65) return 'high';
        if (pct >= 40) return 'mid';
        return 'low';
    };

    // ── Sin-bodega — client-side filter + sort + paginate ─────
    const { results: sinFiltered, isFuzzy: isSinFuzzy } = useMemo(() => {
        const { results, isFuzzy } = !searchTerm.trim()
            ? { results: sinBodega, isFuzzy: false }
            : smartFilter(searchTerm, sinBodega, r => [r.product_name, r.laboratorio]);
        const dir = sinSortDir === 'asc' ? 1 : -1;
        const sorted = [...results].sort((a, b) => {
            if (sinSortKey === 'product_name' || sinSortKey === 'laboratorio') {
                return (a[sinSortKey] || '').localeCompare(b[sinSortKey] || '', 'es') * dir;
            }
            return (Number(a[sinSortKey] || 0) - Number(b[sinSortKey] || 0)) * dir;
        });
        return { results: sorted, isFuzzy };
    }, [sinBodega, searchTerm, sinSortKey, sinSortDir]);

    const sinTotalPages     = Math.max(1, Math.ceil(sinFiltered.length / sinPageSize));
    const filteredSinBodega = sinFiltered.slice((sinPage - 1) * sinPageSize, sinPage * sinPageSize);

    useEffect(() => { setSinPage(1); }, [searchTerm, sinSortKey, sinSortDir]);

    const handleSinSort = useCallback((key) => {
        setSinSortKey(prev => {
            if (prev === key) { setSinSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSinSortDir('asc'); return key;
        });
        setSinPage(1);
    }, []);

    const productosElegidos = useMemo(
        () => [...selected].reduce((acc, id) => acc + (statMap[id]?.con_bodega_productos ?? 0), 0),
        [selected, statMap],
    );

    // ── Dashboard screen ────────────────────────────────────────
    return (
        <div className="space-y-5 p-4">


            {/* ── Sucursal selector ──────────────────────────── */}
            {/* Rediseño 2026-10-06. Antes cada tarjeta pintaba su FONDO con el
                color de la urgencia: con las seis entre 43% y 67% las seis
                salían naranjas, así que todo se leía como alerta y la tarjeta
                elegida no se distinguía de las demás. Hoy el fondo es neutro y
                el color se reserva para dos cosas: la barra de urgencia (que
                es un dato) y el borde de la elegida (que es el estado). */}
            <div data-surface="card" className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                    <div className="min-w-0">
                        <h3 className="font-semibold text-content text-subtitle">Sucursales a reponer</h3>
                        <p className="text-label text-content-3 mt-0.5">
                            La urgencia es cuánto le falta a cada sala para llegar a su máximo.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Un `<label>` envolviendo el interruptor: el texto
                            también lo acciona y el blanco de dedo crece solo. */}
                        <label className="inline-flex items-center gap-2 text-body-sm text-content-2 cursor-pointer select-none min-h-[var(--tap-min)]">
                            <Switch size="sm" variant="chart-3" checked={globalMode}
                                onChange={setGlobalMode} label="Distribución global de bodega" />
                            Distribución global
                        </label>
                        {/* El rótulo se calculaba sobre TODAS las sucursales y la acción
                            sólo sobre las seleccionables: con una pendiente de MIN/MAX
                            el botón decía «Seleccionar todas» aunque ya estuvieran todas
                            las elegibles marcadas, y volver a apretarlo no hacía nada. */}
                        <Button variant="secondary" size="sm" onClick={toggleAll}>
                            {todasElegiblesSeleccionadas ? 'Quitar la selección' : 'Seleccionar todas'}
                        </Button>
                    </div>
                </div>

                {globalMode && (
                    <Notice variant="info" className="mb-3">
                        La bodega se distribuye considerando las necesidades de TODAS las sucursales, pero el pedido solo incluye las marcadas.
                    </Notice>
                )}

                {/* ── Sucursal cards ─────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {visibleSucursales.map((id) => {
                        const stat      = statMap[id];
                        const isOn      = selected.has(id);
                        const pending   = isSucPending(id);
                        const urgLevel  = getUrgLevel(stat);
                        const urgPct    = stat?.avg_urgencia_pct ?? null;

                        if (pending) {
                            return (
                                <div
                                    key={id}
                                    data-surface="card" className="relative flex flex-col gap-2 p-3 text-left bg-surface-card-hover/60 opacity-60 cursor-not-allowed"
                                >
                                    <span className="text-body font-bold leading-tight text-content-3">{ERP_NAMES[id]}</span>
                                    {dashLoading ? (
                                        <div className="h-5 w-20 rounded-lg bg-surface-card-hover animate-pulse" />
                                    ) : (
                                        <Badge variant="warning" size="sm" uppercase={false} className="self-start">Pendiente MIN/MAX</Badge>
                                    )}
                                </div>
                            );
                        }

                        // Literales, no `bg-${x}`: Tailwind escanea texto.
                        const urgBar  = urgLevel === 'high' ? 'bg-danger-solid'
                            : urgLevel === 'mid' ? 'bg-warning-solid' : 'bg-success-solid';
                        const urgText = urgLevel === 'high' ? 'text-danger-text'
                            : urgLevel === 'mid' ? 'text-warning-text' : 'text-success-text';

                        const stateCls = isOn
                            ? 'suc-pop border-chart-1/70 ring-2 ring-chart-1/45 shadow-[var(--shadow-glass-3)] bg-[var(--card-tint-base)]'
                            : 'border-divider bg-[var(--card-tint-base-soft)] hover:border-content-3/30 hover:shadow-[var(--shadow-elevation-sm)]';

                        const ultimo = stat ? fmtTimeSince(stat.last_pedido_at) : null;
                        const dias = stat?.last_pedido_at
                            ? Math.floor((Date.now() - new Date(stat.last_pedido_at)) / 86_400_000)
                            : null;
                        const ultimoCls = dias == null ? 'text-content-3'
                            : dias <= 7 ? 'text-success-text'
                            : dias <= 14 ? 'text-warning-text' : 'text-danger-text';

                        return (
                            <button
                                key={id}
                                aria-pressed={isOn}
                                onClick={() => toggleSuc(id)}
                                // El acuse del toque: elegir sucursales es LO que se
                                // hace en esta pestaña. Va afuera de `stateCls` para
                                // que también acuse la que ya está elegida —
                                // des-elegir es la mitad del control.
                                className={`relative flex flex-col gap-2 rounded-2xl p-3 border text-left transition-all duration-[var(--dur-base)] active:scale-[0.98] ${stateCls}`}
                            >
                                <span className="flex items-start justify-between gap-2">
                                    <span className="text-body font-bold leading-tight text-content">
                                        {ERP_NAMES[id]}
                                    </span>
                                    {/* La casilla está SIEMPRE: vacía dice «se puede
                                        elegir», llena dice «elegida». Antes sólo
                                        aparecía al marcar. */}
                                    <span aria-hidden="true"
                                        className={`shrink-0 w-5 h-5 rounded-full border grid place-items-center transition-colors duration-[var(--dur-base)] ${isOn ? 'bg-chart-1 border-chart-1' : 'border-divider bg-surface-card'}`}>
                                        {isOn && <Check size={12} strokeWidth={3} className="text-white" />}
                                    </span>
                                </span>

                                {stat && !dashLoading ? (
                                    <>
                                        {urgPct != null && (
                                            <span className="block">
                                                <span className="flex items-baseline justify-between gap-2 text-caption">
                                                    <span className="text-content-3">Urgencia</span>
                                                    <span className={`font-bold tabular-nums ${urgText}`}>{urgPct}%</span>
                                                </span>
                                                {/* El ancho ES el dato (§32.8 regla 1). */}
                                                <span data-medida="dato" className="mt-1 block h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                    <span className={`block h-full rounded-full ${urgBar}`}
                                                        style={{ width: `${Math.min(100, Math.max(0, urgPct))}%` }} />
                                                </span>
                                            </span>
                                        )}
                                        <span className="flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5 text-caption">
                                            {/* Los glifos ✓/✗ eran texto: no escalan con
                                                el tipo ni los lee un lector de pantalla. */}
                                            <span className="inline-flex items-center gap-2 tabular-nums font-semibold">
                                                <span className="inline-flex items-center gap-0.5 text-success-text">
                                                    <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                                                    {stat.con_bodega_productos ?? 0}
                                                    <span className="sr-only"> con stock en Bodega</span>
                                                </span>
                                                <span className="inline-flex items-center gap-0.5 text-danger-text">
                                                    <PackageX size={11} aria-hidden="true" />
                                                    {stat.sin_bodega_productos ?? 0}
                                                    <span className="sr-only"> sin stock en Bodega</span>
                                                </span>
                                            </span>
                                            <span className={`whitespace-nowrap ${ultimoCls}`}>
                                                <span className="sr-only">Último pedido: </span>
                                                {ultimo ?? 'sin pedidos'}
                                            </span>
                                        </span>
                                    </>
                                ) : (
                                    <span className="block space-y-2">
                                        <span className="block h-3 w-full rounded bg-surface-card-hover animate-pulse" />
                                        <span className="block h-3 w-2/3 rounded bg-surface-card-hover animate-pulse" />
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* ── Generar ────────────────────────────────── */}
                {/* Pie con el resumen a la izquierda y la acción a la derecha:
                    centrado y solo, el botón apagado se leía como un adorno. */}
                <div className="mt-4 pt-4 border-t border-divider flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-body-sm text-content-3">
                        {selected.size === 0
                            ? 'Elige al menos una sucursal para generar el pedido.'
                            : `${selected.size} sucursal${selected.size > 1 ? 'es' : ''} · ${productosElegidos.toLocaleString()} producto${productosElegidos === 1 ? '' : 's'} con stock en Bodega`}
                    </span>
                    <Button tone="success" size="lg" onClick={handleGenerarDirecto} icon={ClipboardList}
                        className="w-full sm:w-auto"
                        disabled={confirming || selected.size === 0} loading={confirming}>
                        {confirming ? 'Confirmando…' : 'Generar y confirmar'}
                    </Button>
                    {/* `Notice` y no un span con su ícono a mano: es el canónico
                        del aviso inline (§15.6). */}
                    {error && <Notice variant="danger" className="w-full">{error}</Notice>}
                </div>
            </div>

            {isSinFuzzy && searchTerm && (
                <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
            )}
            {/* ── Sin-bodega table (DataTable estándar) ────── */}
            <DataTable
                columns={SIN_BODEGA_COLS}
                sortKey={sinSortKey}
                sortDir={sinSortDir}
                onSort={handleSinSort}
                loading={sinBodegaLoad}
                empty={{
                    icon: Package,
                    message: searchTerm
                        ? `Sin resultados para "${searchTerm}"`
                        : 'No hay productos sin stock en Bodega',
                }}
                minWidth="560px"
                toolbar={(
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <TriangleAlert size={15} className="text-danger shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-content text-body-lg">Productos sin stock en Bodega</span>
                        {sinBodega.length > 0 && (
                            <Badge variant="danger" size="sm" uppercase={false}>{sinBodega.length.toLocaleString()}</Badge>
                        )}
                        <span className="basis-full text-label text-content-3">
                            Lo que piden las sucursales y Bodega no tiene para despachar.
                        </span>
                    </div>
                )}
            >
                {filteredSinBodega.map((row, i) => (
                    <DataRow key={row.erp_product_id} index={i}>
                        <DataCell className="text-body font-semibold text-content">
                            {row.product_name}
                        </DataCell>
                        <DataCell className="text-body-sm text-content-3">{row.laboratorio || '—'}</DataCell>
                        <DataCell>
                            <div className="flex flex-wrap gap-1">
                                {(row.sucursales || []).map(s => (
                                    <LiquidTooltip key={s.erp_sucursal_id} content={`${ERP_NAMES[s.erp_sucursal_id]}: necesita ${s.reponer}${s.ventas_6m > 0 ? ` · ${Math.round(s.ventas_6m)} ventas en 6m` : ''}`}>
                                        <span
                                            className="inline-flex items-center gap-1 text-caption px-2 py-0.5 rounded-full bg-surface-card-hover whitespace-nowrap">
                                            <span className="font-medium text-content-2">{ERP_NAMES[s.erp_sucursal_id]}</span>
                                            <span className="text-danger-text font-semibold tabular-nums">{s.reponer}</span>
                                            {s.ventas_6m > 0 && (
                                                <span className="text-content-3 inline-flex items-center gap-0.5">
                                                    <Repeat size={9} aria-hidden="true" />
                                                    <span className="text-micro font-semibold">{Math.round(s.ventas_6m)}</span>
                                                </span>
                                            )}
                                        </span>
                                    </LiquidTooltip>
                                ))}
                            </div>
                        </DataCell>
                        <DataCell align="center" hideBelow="sm">
                            <span className="text-body font-bold text-content tabular-nums">{row.total_necesidad}</span>
                        </DataCell>
                        <DataCell align="center" hideBelow="sm">
                            {row.total_ventas_6m > 0 ? (
                                <span className="text-body-sm text-content-2 font-semibold tabular-nums">
                                    {Math.round(row.total_ventas_6m).toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-label text-content-3">—</span>
                            )}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {!sinBodegaLoad && sinFiltered.length > 0 && (
                <TablePagination
                    pageSize={sinPageSize}
                    onPageSizeChange={setSinPageSize}
                    page={sinPage}
                    totalPages={sinTotalPages}
                    onPageChange={setSinPage}
                    total={sinFiltered.length}
                />
            )}
        </div>
    );
}
