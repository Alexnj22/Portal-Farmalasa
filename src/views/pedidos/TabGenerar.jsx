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
    Check, Search, PackageX, Repeat, RotateCcw, Download, FileText, X,
} from 'lucide-react';
import { EmptyState } from '../../components/common/StateViews';
import PedidoModal from './PedidoModal';
import { resumenPorSala } from './logicaDeRutas';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '@nucleo/context/AuthContext';
import { printPerSucursal, getExactPageGroups } from '@nucleo/utils/pedidoPrint';
import { confirmarPedidoDirecto, vistaPreviaDePedido } from '@nucleo/data/accionesDePedido';
import { nivelDeUrgenciaDeSala, salaSinMinMaxPublicado, urgenciaDeSala } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES, SUCURSALES } from '@nucleo/constants/erp';
import { fetchActiveEmployeesBasic, fetchPedidoItemsForPrintCapture, fetchTableroParaGenerarPedido, tieneEtiquetaDeDespacho, updatePedidoSucursalStatus } from '@nucleo/data/pedidos';
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
    // `<= 0`: una fecha apenas en el futuro (reloj del equipo, zona horaria)
    // daba «hace -1 días».
    if (d <= 0) return 'hoy';
    if (d === 1) return 'ayer';
    // Palabras completas: «hace 3m» se leía como minutos.
    if (d < 14)  return `hace ${d} días`;
    if (d < 60)  return `hace ${Math.floor(d / 7)} semanas`;
    return `hace ${Math.floor(d / 30)} meses`;
}

// Los cortes de urgencia (productos bajo mínimo que Bodega puede mandar) y el
// % de la barra salen del núcleo (`urgenciaDeSala`, `nivelDeUrgenciaDeSala`
// en `utils/tableroDePedidos`): la app pinta las mismas salas con los mismos
// colores.

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
    // Un error al leer el tablero NO es «no hay nada»: antes dejaba las seis
    // salas como «Pendiente MIN/MAX» y la tabla como «No hay productos sin
    // stock», dos afirmaciones falsas sobre una lectura que no llegó.
    const [dashError,   setDashError]   = useState(null);

    // El paso intermedio antes de confirmar (resumen por sala) y, después,
    // los PDF por sala. `null` = cerrado.
    //   { paso: 'resumen', rows, sucursales, global }
    //   { paso: 'pdfs', numero, map, sucIds, codigoFn, meta, estado: {sid: 'idle'|'preparando'|'enviado'|'error'} }
    const [flujo,      setFlujo]      = useState(null);
    const [preparando, setPreparando] = useState(false);

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
        setDashError(null);
        fetchTableroParaGenerarPedido({ p_sucursal_ids: SUCURSALES })
            .then(({ data, error: e }) => {
                if (e) throw e;
                setDashStats(Array.isArray(data?.stats) ? data.stats : []);
                setSinBodega(Array.isArray(data?.sin_bodega) ? data.sin_bodega : []);
            })
            .catch((e) => {
                setDashStats([]); setSinBodega([]);
                setDashError(mensajeAmigable(e, 'No se pudo leer cómo están las sucursales. Intenta de nuevo.'));
            })
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

    // ── Paso 1: calcular y mostrar el resumen por sala ─────────
    // Antes «Generar y confirmar» pasaba de las tarjetas al pedido confirmado
    // sin mostrar qué se iba a mandar. Ahora se calcula la vista previa, se
    // muestra por sala, y recién «Confirmar» la guarda — la MISMA vista previa,
    // así que lo que se ve es lo que se confirma.
    const handlePrepararResumen = useCallback(async () => {
        if (selected.size === 0) return;
        setPreparando(true); setError(null);
        try {
            // La vista previa: núcleo (`vistaPreviaDePedido`), la misma de la app.
            const rows = await vistaPreviaDePedido({ salas: [...selected], globalMode });
            if (rows.length === 0) {
                const msg = 'Las sucursales seleccionadas están abastecidas — no hay nada que pedir.';
                setError(msg);
                showToast('Sin necesidades', msg, 'info');
                return;
            }
            setFlujo({ paso: 'resumen', rows, sucursales: [...selected], global: globalMode });
        } catch (e) {
            const msg = friendlyError(e);
            setError(msg);
            showToast('Error al calcular el pedido', msg, 'error');
        } finally {
            setPreparando(false);
        }
    }, [selected, globalMode, showToast]);

    // ── Un PDF de una sala ─────────────────────────────────────
    // `printPerSucursal` con UNA sala por llamada: el navegador deja pasar una
    // descarga por clic y bloquea las que vienen detrás de la primera. Antes se
    // disparaban todas cada 150 ms sin esperar, y el aviso decía «PDF listo»
    // aunque de la segunda en adelante no bajara ninguna.
    const descargarSala = useCallback(async (sid) => {
        const f = flujo;
        if (!f || f.paso !== 'pdfs') return;
        setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'preparando' } });
        try {
            await printPerSucursal(f.map, [sid], r => r.cantidad_asignada, f.codigoFn, f.meta);
            setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'enviado' } });
        } catch (e) {
            console.error('[TabGenerar] PDF de sala:', e);
            setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'error' } });
        }
    }, [flujo]);

    // ── Paso 2: confirmar lo que se vio ────────────────────────
    const handleConfirmar = useCallback(async () => {
        if (!flujo || flujo.paso !== 'resumen') return;
        const { rows, sucursales, global } = flujo;
        setConfirming(true); setError(null);
        try {
            // Confirmar, numerar y poner los códigos de sala: núcleo
            // (`confirmarPedidoDirecto`), lo mismo que hace la app. Confirma la
            // MISMA vista previa del resumen. El número se reintenta una vez y,
            // si no llega, se dice «el pedido», nunca «Pedido #undefined» (que
            // además viajaba al encabezado del PDF).
            const esEmpleado = employees.some(e => e.id === user?.id);
            const gen = await confirmarPedidoDirecto({
                rows, salas: sucursales, globalMode: global,
                userId: user?.id ?? null, responsableId: esEmpleado ? user.id : null,
            });
            const { pedidoId, numero, map, sucIds, codigoFn, items: pItems } = gen;
            const rotulo = numero != null ? `Pedido #${numero}` : 'El pedido';
            const meta   = { responsable: user?.name ?? null, revisor: null, generadoPor: user?.name ?? null, pedidoNumero: numero ?? undefined };

            // Los códigos de sala son los que llevan los PDF y los que se buscan
            // después: el error ya no se descarta.
            if (gen.codigosError) {
                showToast('Los códigos de las salas no se guardaron',
                    'El pedido quedó confirmado. Avisa al equipo de sistemas para asignarlos.', 'warning');
            }

            // Capturar grupos de páginas en background para que Finalizar sea instantáneo
            ;(async () => {
                let capturadas = 0;
                for (const sid of sucIds) {
                    try {
                        const rawItems = await fetchPedidoItemsForPrintCapture(pedidoId, sid);
                        if (!rawItems?.length) { capturadas++; continue; }
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
                        if (!groups.length) continue;
                        // Sólo cuenta la que se GUARDÓ: antes `capturadas++` iba
                        // después de una escritura cuyo `error` nadie miraba, así
                        // que un rechazo se contaba como captura y el aviso de
                        // abajo no salía.
                        const { error: guardarErr } = await updatePedidoSucursalStatus(pedidoId, sid, { paginas: groups });
                        if (guardarErr) { console.error('[pedidos] guardar hojas sala', sid, guardarErr); continue; }
                        capturadas++;
                    } catch (e) {
                        // Ya NO en silencio. Este bloque se quedó callado cuando le
                        // falló al pedido #97 —460 productos, un pedido real— y el
                        // pedido siguió sin saber qué producto va en qué hoja hasta
                        // que alguien lo finalizara.
                        console.error('[pedidos] captura de hojas sala', sid, e);
                    }
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
                `${rotulo} confirmado`,
                `${pItems.length} productos en ${sucIds.length} sucursal${sucIds.length > 1 ? 'es' : ''}.`,
                'success',
            );
            const estado = Object.fromEntries(sucIds.map(id => [id, 'idle']));
            const siguiente = { paso: 'pdfs', numero, map, sucIds, codigoFn, meta, estado };
            setFlujo(siguiente);
            setSelected(new Set());
            refreshStats();

            // Con UNA sala, la descarga sale sola (el navegador deja pasar la
            // primera). Con varias, una por clic desde la lista.
            if (sucIds.length === 1) {
                const sid = sucIds[0];
                setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'preparando' } });
                try {
                    await printPerSucursal(map, [sid], r => r.cantidad_asignada, codigoFn, meta);
                    setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'enviado' } });
                } catch (e) {
                    console.error('[TabGenerar] PDF:', e);
                    setFlujo(prev => prev && { ...prev, estado: { ...prev.estado, [sid]: 'error' } });
                }
            }
        } catch (e) {
            const msg = friendlyError(e);
            setError(msg);
            setFlujo(null);
            showToast('Error al generar el pedido', msg, 'error');
        } finally {
            setConfirming(false);
        }
    }, [flujo, employees, user, refreshStats, showToast]);

    const resumen = useMemo(
        () => (flujo?.paso === 'resumen' ? resumenPorSala(flujo.rows) : []),
        [flujo],
    );

    // ── Derived maps ───────────────────────────────────────────
    const statMap = useMemo(() => {
        const m = {};
        for (const s of dashStats) m[s.erp_sucursal_id] = s;
        return m;
    }, [dashStats]);

    // Todas las sucursales siempre visibles; las que no tienen MIN/MAX publicado
    // se muestran como "pendiente" — inactivas, no seleccionables.
    const visibleSucursales = SUCURSALES;

    // Sin MIN·MAX publicado no se elige: núcleo (`salaSinMinMaxPublicado`).
    // Con el tablero caído no se marca ninguna como pendiente: no se sabe.
    const isSucPending = (id) => !dashLoading && !dashError && salaSinMinMaxPublicado(statMap[id]);

    // Las que se pueden elegir de verdad: una sucursal sin MIN/MAX publicado
    // se pinta inactiva y no entra ni en la acción ni en el rótulo del botón.
    const sucursalesElegibles = visibleSucursales.filter(id => !isSucPending(id));
    const todasElegiblesSeleccionadas = sucursalesElegibles.length > 0
        && sucursalesElegibles.every(id => selected.has(id));

    const toggleAll = () => {
        setSelected(todasElegiblesSeleccionadas ? new Set() : new Set(sucursalesElegibles));
    };

    // La urgencia se mide en PRODUCTOS bajo su mínimo que Bodega puede mandar
    // (2026-10-06): núcleo (`nivelDeUrgenciaDeSala`), con los cortes y el porqué.
    // Sin los campos nuevos —la consulta vieja— cae al porcentaje de antes.
    const getUrgLevel = (stat) => nivelDeUrgenciaDeSala(stat);

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
                            La urgencia sube con los productos bajo su mínimo que Bodega puede mandar.
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
                {dashError ? (
                    <EmptyState
                        compact
                        icon={TriangleAlert}
                        iconClass="text-danger-text"
                        title="No se pudieron cargar las sucursales"
                        subtitle={dashError}
                        action={<Button variant="secondary" icon={RotateCcw} onClick={refreshStats}>Reintentar</Button>}
                    />
                ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {visibleSucursales.map((id) => {
                        const stat      = statMap[id];
                        const isOn      = selected.has(id);
                        const pending   = isSucPending(id);
                        const urgLevel  = getUrgLevel(stat);
                        const urgPct    = urgenciaDeSala(stat);

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
                                                {stat.bajo_min_productos != null && (
                                                    <span className="mt-1 block text-caption text-content-3 tabular-nums">
                                                        {stat.bajo_min_productos} bajo mínimo
                                                        {stat.en_cero_productos > 0 && ` · ${stat.en_cero_productos} en cero`}
                                                    </span>
                                                )}
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
                                                {/* Rotulado: un «hoy» suelto no decía de qué era. */}
                                                {ultimo ? `Último pedido ${ultimo}` : 'Sin pedidos aún'}
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
                )}

                {/* ── Generar ────────────────────────────────── */}
                {/* Pie con el resumen a la izquierda y la acción a la derecha:
                    centrado y solo, el botón apagado se leía como un adorno. */}
                <div className="mt-4 pt-4 border-t border-divider flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-body-sm text-content-3">
                        {selected.size === 0
                            ? 'Elige al menos una sucursal para generar el pedido.'
                            : `${selected.size} sucursal${selected.size > 1 ? 'es' : ''} · ${productosElegidos.toLocaleString()} producto${productosElegidos === 1 ? '' : 's'} con stock en Bodega`}
                    </span>
                    <Button tone="success" size="lg" onClick={handlePrepararResumen} icon={ClipboardList}
                        className="w-full sm:w-auto"
                        disabled={preparando || confirming || selected.size === 0 || !!dashError} loading={preparando}>
                        {preparando ? 'Calculando…' : 'Generar y confirmar'}
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
                empty={dashError ? {
                    icon: TriangleAlert,
                    message: 'No se pudo cargar esta lista. Usa «Reintentar» arriba.',
                } : {
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

            <PasoDeConfirmacion
                flujo={flujo}
                resumen={resumen}
                confirming={confirming}
                onVolver={() => setFlujo(null)}
                onConfirmar={handleConfirmar}
                onDescargar={descargarSala}
            />
        </div>
    );
}

// ── El paso entre las tarjetas y el pedido confirmado ──────────────────────
// Un solo diálogo con dos momentos: el RESUMEN por sala (Confirmar / Volver) y,
// ya confirmado, los PDF por sala, cada uno con su botón y su estado. El
// estado dice «Descarga iniciada» y no «Descargado»: el navegador no avisa si
// el archivo terminó de bajar, y la pantalla no promete lo que no sabe.
const ESTADO_PDF = {
    idle:       null,
    preparando: { label: 'Preparando…',       variante: 'neutral' },
    enviado:    { label: 'Descarga iniciada', variante: 'success' },
    error:      { label: 'No se pudo',        variante: 'danger'  },
};

function PasoDeConfirmacion({ flujo, resumen, confirming, onVolver, onConfirmar, onDescargar }) {
    const abierto = !!flujo;
    const esResumen = flujo?.paso === 'resumen';
    const cerrar = confirming ? () => {} : onVolver;
    const tot = resumen.reduce((a, s) => ({
        renglones: a.renglones + s.renglones, unidades: a.unidades + s.unidades,
    }), { renglones: 0, unidades: 0 });
    return (
        <PedidoModal open={abierto} onClose={cerrar} maxWidth="max-w-lg"
            ariaLabel={esResumen ? 'Resumen del pedido' : 'PDF por sala'}>
            <PedidoModal.Header className="px-5 pt-5 pb-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-body-xl font-black text-content leading-tight">
                            {esResumen ? 'Revisa antes de confirmar'
                                : flujo?.numero != null ? `Pedido #${flujo.numero} confirmado` : 'Pedido confirmado'}
                        </h3>
                        <p className="text-label text-content-3 mt-0.5">
                            {esResumen
                                ? `${resumen.length} sala${resumen.length !== 1 ? 's' : ''} · ${tot.renglones.toLocaleString()} renglones · ${tot.unidades.toLocaleString()} unidades`
                                : (flujo?.sucIds?.length ?? 0) > 1
                                    ? 'Descarga el PDF de cada sala. El navegador deja pasar una descarga por clic.'
                                    : 'El PDF de la sala se está descargando.'}
                        </p>
                    </div>
                    <Button variant="ghost" icon={X} iconOnly title="Cerrar" disabled={confirming} onClick={cerrar} />
                </div>
            </PedidoModal.Header>
            <PedidoModal.Body className="px-5 py-3">
                {esResumen ? (
                    <ul className="space-y-2">
                        {resumen.map(s => (
                            <li key={s.erp_sucursal_id} data-surface="card" className="px-3 py-2.5">
                                <p className="text-body font-bold text-content">{ERP_NAMES[s.erp_sucursal_id] ?? `Sucursal ${s.erp_sucursal_id}`}</p>
                                <p className="text-caption text-content-3 tabular-nums mt-0.5">
                                    {s.renglones.toLocaleString()} {s.renglones === 1 ? 'renglón' : 'renglones'}
                                    {' · '}{s.unidades.toLocaleString()} unidad{s.unidades !== 1 ? 'es' : ''}
                                </p>
                                {(s.revision > 0 || s.sinStock > 0 || s.agotamiento > 0) && (
                                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                                        {s.revision > 0 && <Badge variant="warning" size="sm" uppercase={false}>{s.revision} en revisión</Badge>}
                                        {s.agotamiento > 0 && <Badge variant="chart-3" size="sm" uppercase={false}>{s.agotamiento} por agotamiento</Badge>}
                                        {s.sinStock > 0 && <Badge variant="danger" size="sm" uppercase={false}>{s.sinStock} sin stock en Bodega</Badge>}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <ul className="space-y-2">
                        {(flujo?.sucIds ?? []).map(sid => {
                            const est = flujo.estado?.[sid] ?? 'idle';
                            const chip = ESTADO_PDF[est];
                            return (
                                <li key={sid} data-surface="card" className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                                    <FileText size={16} className="text-content-3 shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-body font-bold text-content">{ERP_NAMES[sid] ?? `Sucursal ${sid}`}</span>
                                        <span className="block text-caption text-content-3 tabular-nums">{flujo.codigoFn?.(sid)}.pdf</span>
                                    </span>
                                    {chip && <Badge variant={chip.variante} size="sm" uppercase={false}>{chip.label}</Badge>}
                                    <Button variant="secondary" icon={Download} loading={est === 'preparando'}
                                        onClick={() => onDescargar(sid)}>
                                        {est === 'idle' ? 'Descargar' : 'Otra vez'}
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </PedidoModal.Body>
            <PedidoModal.Footer className="flex justify-end gap-2">
                {esResumen ? (
                    <>
                        <Button variant="secondary" disabled={confirming} onClick={onVolver}>Volver</Button>
                        <Button tone="success" icon={Check} loading={confirming} onClick={onConfirmar}>
                            {confirming ? 'Confirmando…' : 'Confirmar'}
                        </Button>
                    </>
                ) : (
                    <Button variant="secondary" onClick={onVolver}>Listo</Button>
                )}
            </PedidoModal.Footer>
        </PedidoModal>
    );
}
