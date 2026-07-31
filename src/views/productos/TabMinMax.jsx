import React from 'react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import TabBarAction from '../../components/common/TabBarAction';
import { SkeletonText, EmptyState} from '../../components/common/StateViews';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, Loader2,
    Building2, Package, X, Download, Trash2,
    CheckCircle2, Check, Info, RotateCcw, ChevronRight, History,
    TrendingUp, TrendingDown, Layers, Settings2, Save, Clock, Upload, XCircle, Eye, EyeOff, BarChart2, FlaskConical, Search, MoreHorizontal, Filter,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import SegmentedControl from '../../components/common/SegmentedControl';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useAuth } from '../../context/AuthContext';
import { applyPresRule } from '../../utils/presentacion';
import { normXyz, sortedPres, smallestPres, formatUnits, formatDominant, hasDispatchRisk } from './tabminmax/helpers';
import { ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS, VISIBLE_STAT_KEYS } from './tabminmax/constants';
import CoverageBar from './tabminmax/CoverageBar';
import StockBar from './tabminmax/StockBar';
import AbcXyzBadge from './tabminmax/AbcXyzBadge';
import CarrilCards from '../../components/common/CarrilCards';
import CardSkeletons from './tabminmax/CardSkeletons';
import CostCards from './tabminmax/CostCards';
import DraftCostCard from './tabminmax/DraftCostCard';
import AbcXyzMatrix from './tabminmax/AbcXyzMatrix';
import RowActions from './tabminmax/RowActions';
import ExpandedPanel from './tabminmax/ExpandedPanel';
import ConfigPanel from './tabminmax/ConfigPanel';
import LabsPanel from './tabminmax/LabsPanel';
import { upsertStockParams } from '../../data/stockParams';
import { useMinMaxData } from './tabminmax/useMinMaxData';
import PortalInput from '../../components/common/PortalInput';
import { clickable } from '../../utils/clickable';
import PhotoLightbox from '../../components/common/PhotoLightbox';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import ModalShell from '../../components/common/ModalShell';

// ─── Animation presets ────────────────────────────────────────────────────────
// easeOutExpo — snappy entry, silky exit. Standard for Apple/Liquid Glass UIs.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];

// Acá vivían `chipAnim`, `ctaAnim` e `iconAnim`: tres escalas de hover/tap con
// framer-motion para los botones de la barra. Se fueron con ellos al migrar al
// `Button` canónico, que resuelve hover y tap con CSS y —a diferencia de estos—
// respeta los dos gates de movimiento (tema y `prefers-reduced-motion`).
// ─── Constants ────────────────────────────────────────────────────────────────
// ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS, VISIBLE_STAT_KEYS: extraídos a
// ./tabminmax/constants.js (Bloque 6.C, continuación) — importados arriba.

// Historial MIN/MAX: label + color por tipo de acción. Todas comparten la misma
// forma de datos (old_min/old_max/new_min/new_max) — un solo render las cubre.
const MINMAX_HISTORY_ACTION_META = {
    MINMAX_LIVE_EDIT:               { label: 'EN VIVO',        variante: 'success' },
    MINMAX_DRAFT_EDIT:              { label: 'BORRADOR',       variante: 'warning' },
    MINMAX_BODEGA_MANUAL_OVERRIDE:  { label: 'MANUAL BODEGA',  variante: 'neutral' },
    MINMAX_BODEGA_RESET_MANUAL:     { label: 'RESTAURADO',     variante: 'success' },
    MINMAX_UPDATED_FROM_PEDIDO:     { label: 'DESDE PEDIDOS',  variante: 'neutral' },
    MINMAX_RESET_CALC:              { label: 'RESTAURADO',     variante: 'success' },
    MINMAX_RESET_CLEAR:             { label: 'LIMPIADO',       variante: 'neutral' },
    MINMAX_DISCARD_DRAFT:           { label: 'DESCARTADO',     variante: 'neutral' },
    MINMAX_ZERO_OUT:                { label: 'PUESTO EN 0',    variante: 'danger' },
    MINMAX_LIVE_ZERO:               { label: 'PUESTO EN 0',    variante: 'danger' },
    MINMAX_ZERO_ALL_BRANCHES:       { label: '0 EN TODA LA RED', variante: 'danger' },
};

// STAT_CFGS, VISIBLE_STAT_KEYS: extraídos a ./tabminmax/constants.js (Bloque
// 6.C, continuación) — usados aquí (render de chips) y en useMinMaxData.js
// (inicializar contadores) — importados arriba.

// ABC_CFG, XYZ_CFG, normXyz, fmtMoney: extracted to ./tabminmax/constants.js
// y ./tabminmax/helpers.js (Bloque 6.C) — importados arriba.

// translateDbError, warnIfOutrageous: extraídos a useMinMaxData.js (Bloque
// 6.C, continuación) — solo los usa loadData/saveDraftCell/saveDraftPair.

// Pure validation: receives the edit + the current row object directly (no closure lookup)
// edit.pendingMin is set when the user Tab-ed from MIN → MAX within the same product;
// it holds the just-typed (but async-saving) MIN value so the cross-check stays accurate.
const validateEditForRow = (edit, row) => {
    if (!edit || !row) return null;
    const numVal = edit.value === '' ? null : parseInt(edit.value, 10);
    if (numVal === null || Number.isNaN(numVal)) return null;
    const isBodegaRow = row._erp_sucursal_id === 6;
    const hasDraftRow = row.draft_status === 'pending' && !isBodegaRow;
    let other;
    if (edit.field === 'max') {
        other = edit.pendingMin !== undefined
            ? (edit.pendingMin === '' ? 0 : (parseInt(edit.pendingMin, 10) || 0))
            : Number(hasDraftRow ? (row.draft_min ?? 0) : (row.effective_min ?? 0));
    } else {
        other = Number(hasDraftRow ? (row.draft_max ?? 0) : (row.effective_max ?? 0));
    }
    // Bodega: el valor manual no puede ser menor que la Σ de sucursales publicadas.
    // edit.bodegaPubMin/Max contiene el valor fresco leído de DB al abrir la celda;
    // row.pub_min puede ser stale si sucursales publicaron después del último fetch.
    if (isBodegaRow) {
        if (edit.field === 'min') {
            const floor = edit.bodegaPubMin ?? row.pub_min ?? 0;
            if (floor > 0 && numVal < floor)
                return `MIN de Bodega no puede ser menor a la Σ sucursales (${floor.toLocaleString()})`;
        }
        if (edit.field === 'max') {
            const floor = edit.bodegaPubMax ?? row.pub_max ?? 0;
            if (floor > 0 && numVal < floor)
                return `MAX de Bodega no puede ser menor a la Σ sucursales (${floor.toLocaleString()})`;
            if (edit.pendingMin !== undefined) {
                const pendMinNum = parseInt(edit.pendingMin, 10) || 0;
                const floorMin = edit.bodegaPubMin ?? row.pub_min ?? 0;
                if (floorMin > 0 && pendMinNum < floorMin)
                    return `MIN de Bodega no puede ser menor a la Σ sucursales (${floorMin.toLocaleString()})`;
            }
        }
    }
    if (edit.field === 'max') {
        if (numVal === 0 && other > 0)     return 'MAX no puede ser 0 cuando MIN > 0';
        if (numVal > 0 && numVal <= other) return 'MAX debe ser mayor al MIN';
        if (other === 0 && numVal > 1)     return 'Con MIN=0 solo se permite MAX=0 o MAX=1';
    } else {
        if (numVal > 0 && other === 0)                   return 'Con MAX=0 el MIN también debe ser 0';
        if (numVal > 0 && other > 0 && numVal >= other)  return 'MIN debe ser menor al MAX';
        if (numVal === 0 && other > 1)                   return 'Con MIN=0 el MAX no puede ser mayor a 1';
    }
    return null;
};

// netStockMap: { erp_product_id → net_sucursal_stock } fetched before calling
function exportCsv(rows, name, sucursalName, isBodega = false, netStockMap = {}, supplierMap = {}) {
    const SEP = ';';

    // Bodega: ordenar por laboratorio → producto
    const sorted = isBodega
        ? [...rows].sort((a, b) => {
            const la = (a.laboratorio_nombre || '').toLowerCase();
            const lb = (b.laboratorio_nombre || '').toLowerCase();
            return la < lb ? -1 : la > lb ? 1 : (a.product_name || '').localeCompare(b.product_name || '', 'es');
          })
        : rows;

    const h = isBodega
        ? ['Sucursal','Laboratorio','Producto','Clase','MIN','MAX','Presentación','Inventario actual','Cantidad a pedir','Proveedor','Alerta']
        : ['Sucursal','Laboratorio','Producto','Clase','MIN (und)','MAX (und)','Ventas 6 meses'];

    const lines = sorted.map(r => {
        const abc  = (r.draft_abc_class || r.abc_class || '');
        const xyz  = normXyz(r.draft_demand_variability || r.demand_variability);
        const minU = r.effective_min ?? 0;
        const maxU = r.effective_max ?? 0;

        if (isBodega) {
            // Presentación mayor disponible del producto
            const pres   = sortedPres(r.presentations || []);
            const best   = pres[0];
            const factor = best?.factor ?? 1;
            const tipo   = best ? best.tipo.trim() : 'und';

            let minPres = applyPresRule(minU, factor);
            let maxPres = applyPresRule(maxU, factor);
            const invPres = applyPresRule(Number(r.current_stock ?? 0), factor);

            // MIN y MAX no pueden quedar iguales tras conversión: MIN = MAX - 1
            if (maxPres > 0 && minPres === maxPres) minPres = maxPres - 1;

            const hasVal = maxU > 0 || minU > 0;

            const bodegaStock  = Number(r.current_stock ?? 0);
            const sucursalStock = Number(netStockMap[r.erp_product_id] ?? 0);
            const totalStock   = bodegaStock + sucursalStock;
            const vel          = Number(r.daily_velocity ?? 0);
            const daysCoverage = vel > 0 ? totalStock / vel : Infinity;
            // Bodega está bajo su propio MIN → no puede cumplir un ciclo de despacho completo
            const belowBodegaMin = minU > 0 && bodegaStock < minU;

            const alertLabel = (() => {
                if (bodegaStock === 0) return 'SIN STOCK';
                if (!hasVal) return 'SIN MIN/MAX';
                const hasVel = vel > 0 && isFinite(daysCoverage);
                const d = hasVel ? Math.round(daysCoverage) : null;
                if (belowBodegaMin) return d !== null ? `CRÍTICO (${d}d red)` : 'CRÍTICO';
                if (!hasVel) return '';
                if (daysCoverage < 14) return `CRÍTICO (${d}d)`;
                if (daysCoverage < 30) return `ATENCIÓN (${d}d)`;
                return '';
            })();

            const cantidadAPedir = hasVal ? Math.max(0, maxPres - invPres) : '';
            const proveedor = supplierMap[r.erp_product_id] || 'Sin registro';

            return [
                `"${(sucursalName||'').replace(/"/g,'""')}"`,
                `"${(r.laboratorio_nombre||'').replace(/"/g,'""')}"`,
                `"${(r.product_name||'').replace(/"/g,'""')}"`,
                `${abc}${xyz}`,
                hasVal ? minPres : '',
                hasVal ? maxPres : '',
                `"${tipo}"`,
                invPres,
                cantidadAPedir,
                `"${proveedor.replace(/"/g,'""')}"`,
                alertLabel,
            ].join(SEP);
        }

        return [
            `"${(sucursalName||'').replace(/"/g,'""')}"`,
            `"${(r.laboratorio_nombre||'').replace(/"/g,'""')}"`,
            `"${(r.product_name||'').replace(/"/g,'""')}"`,
            `${abc}${xyz}`,
            (maxU > 0 || minU > 0) ? minU : '',
            maxU > 0 ? maxU : '',
            r.units_sold_6m ?? 0,
        ].join(SEP);
    });

    // BOM + semicolon-separated + CRLF for Excel compatibility (Spanish locale)
    const blob = new Blob(['﻿' + [h.join(SEP), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `minmax_${name}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
}

// ─── ABC × XYZ Matrix ────────────────────────────────────────────────────────
// AbcXyzMatrix: extraído a ./tabminmax/AbcXyzMatrix.jsx (Bloque 6.C) —
// importado arriba.

// ─── RowActions — máx 3 elementos visibles + dropdown "Más" ──────────────────
// RowActions: extraído a ./tabminmax/RowActions.jsx (Bloque 6.C) —
// importado arriba.

// ─── Cost summary cards ───────────────────────────────────────────────────────

// CostCards, DraftCostCard, CardSkeletons: extracted to ./tabminmax/
// (Bloque 6.C) — importados arriba.

// ─── Helpers ─────────────────────────────────────────────────────────────────

// sortedPres, smallestPres, formatUnits, formatDominant: extraídos a
// ./tabminmax/helpers.js (Bloque 6.C) — importados arriba.
// ExpandedPanel: extraído a ./tabminmax/ExpandedPanel.jsx (Bloque 6.C) —
// importado arriba.

// ConfigPanel, LabsPanel: extraídos a ./tabminmax/ (Bloque 6.C) —
// importados arriba.

// ─── Main Component ───────────────────────────────────────────────────────────
// Bloque 6.C (continuación): el estado/fetch de este componente vive en el
// hook useMinMaxData (./tabminmax/useMinMaxData.js) — mismos nombres, misma
// lógica, extracción mecánica. Este archivo queda solo con el JSX.
export default function TabMinMax({ searchTerm = '', config, onConfigChange, lockedErpId }) {
    const cycleDays = config?.cycle_days ?? 45;

    const { hasPermission } = useAuth();
    const canManage = hasPermission('minmax', 'can_edit');

    const {
        selectedErp, setSelectedErp,
        filterAbc, setFilterAbc,
        filterXyz, setFilterXyz,
        filterAlert, setFilterAlert,
        data, setData,
        costSummary,
        draftCost,
        loading,
        calculating,
        calcMode,
        calcProgress,
        expandedId, setExpandedId,
        zoomPhoto, setZoomPhoto,
        configOpen, setConfigOpen,
        labsOpen, setLabsOpen,
        sortBy, setSortBy,
        sortDir, setSortDir,
        page, setPage,
        pageSize, setPageSize,
        publishing,
        filterDraft, setFilterDraft,
        filterSparse, setFilterSparse,
        filterDispatchRisk, setFilterDispatchRisk,
        hidingIds, setHidingIds,
        filterChangesOnly, setFilterChangesOnly,
        filterHidden, setFilterHidden,
        hiddenIds, setHiddenIds,
        skipBlurSave,
        publishConfirm, setPublishConfirm,
        discardConfirm, setDiscardConfirm,
        zeroAllConfirm, setZeroAllConfirm,
        calcularConfirm, setCalcularConfirm,
        discardRowConfirm, setDiscardRowConfirm,
        zeroOutConfirm, setZeroOutConfirm,
        discardingAll,
        hideFilteredConfirm, setHideFilteredConfirm,
        hidingFiltered,
        analysisConfig,
        configChanged, setConfigChanged,
        inlineDraftEdit, setInlineDraftEdit,
        toast, setToast,
        currentEmployee,
        historyRow, setHistoryRow,
        historyLogs,
        historyLoading,
        empPhotoMap,
        bodegaTooltip,
        toggleExpand,
        loadData,
        handleRecalcular,
        handleRecalcularAll,
        hasPublishedData, draftCount, sparseCount, changesCount, bodegaPendingCount, dispatchRiskCount, stats, criticalACount,
        zeroOutRow,
        handleZeroAllBranches,
        saveDraftCell,
        saveDraftPair,
        unhideProduct,
        unhideAll,
        resetToCalc,
        discardDraft,
        handleDiscardAll,
        openHistory,
        requestPublish,
        startDeferredPublish,
        hasActiveFilter, hasAnyFilter, clearAllFilters, isBodega, neverCalc,
        filtered, isSearchFuzzy, searchHiddenByFilter,
        filteredDraftIds,
        hideFiltered,
        filterLabel,
        handleSort,
        sorted,
        totalPages, pageRows,
        erpOptions,
        COLS,
        glass,
        openBodegaEdit,
        openBodegaTooltip,
        closeBodegaTooltip,
    } = useMinMaxData({ searchTerm, lockedErpId });

    // ─── Render ───────────────────────────────────────────────────────────────
    // Los filtros de estado, como UN control. Todos contestan la misma pregunta
    // —¿qué recorte de la lista quiero ver?— y estaban dibujados como ocho
    // interruptores independientes; en la práctica nadie combina "excesos" con
    // "sin historial", así que el select dice la verdad sobre cómo se usan.
    const estadoActivo = hasAnyFilter || filterHidden;
    const limpiarEstado = () => {
        setFilterAlert('all');
        setFilterAbc(p => (p === 'A' ? 'all' : p));
        setFilterSparse(false);
        setFilterDispatchRisk(false);
        setFilterHidden(false);
        setPage(1);
    };

    // Cada opción lleva su conteo, que es el dato por el que se elige: "261
    // excesos" pesa distinto que "2 excesos". Las que dan cero no se listan.
    const opcionesEstado = [
        ...STAT_CFGS.filter(c => VISIBLE_STAT_KEYS.includes(c.key))
            .map(cfg => ({ value: cfg.key, label: `${loading ? '–' : stats[cfg.key]} ${cfg.label}` })),
        ...(hasPublishedData && criticalACount > 0 && !loading
            ? [{ value: 'criticoA', label: `${criticalACount} Crítico A` }] : []),
        ...(sparseCount > 0 && !loading
            ? [{ value: 'sparse', label: `${sparseCount} Poca venta` }] : []),
        ...(!isBodega && dispatchRiskCount > 0 && !loading
            ? [{ value: 'riesgo', label: `${dispatchRiskCount} Riesgo regla` }] : []),
        ...(hiddenIds.size > 0
            ? [{ value: 'ocultos', label: `${hiddenIds.size} Ocultos` }] : []),
    ];

    // Cuál está puesto. El orden importa poco porque el select apaga los otros
    // al elegir, pero `filterHidden` va primero: es el único que AGREGA filas en
    // vez de recortarlas, así que manda sobre lo demás.
    const estadoSel = filterHidden ? 'ocultos'
        : filterSparse ? 'sparse'
        : filterDispatchRisk ? 'riesgo'
        : filterAlert !== 'all' ? filterAlert
        : filterAbc === 'A' ? 'criticoA'
        : '';

    const setEstadoSel = v => {
        limpiarEstado();
        if (v === 'criticoA') setFilterAbc('A');
        else if (v === 'sparse') setFilterSparse(true);
        else if (v === 'riesgo') setFilterDispatchRisk(true);
        else if (v === 'ocultos') setFilterHidden(true);
        else if (v) setFilterAlert(v);
    };

    // ── Las acciones de la vista, en la píldora (§17) ────────────────────
    // Estaban sueltas al lado: "CSV" con su rótulo, dos íconos pelados que abren
    // paneles, y DOS botones de calcular —"Todas las sucursales" y "Calcular"—
    // que son la misma acción con distinto alcance. El alcance ahora se elige
    // DENTRO del modal de confirmación, que es donde ya se explica qué va a pasar.
    const exportarCsv = async () => {
                            let netStockMap = {};
                            let supplierMap = {};
                            if (isBodega && filtered.length > 0) {
                                const ids = filtered.map(r => r.erp_product_id);
                                // Chunk input by 1000 so each RPC call returns ≤1000 rows (PostgREST cap)
                                const CHUNK = 1000;
                                const chunks = [];
                                for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
                                const [nsResults, spResults] = await Promise.all([
                                    Promise.all(chunks.map(c => supabase.rpc('get_sucursal_net_stock', { p_product_ids: c }))),
                                    Promise.all(chunks.map(c => supabase.rpc('get_top_supplier_per_product', { p_product_ids: c }))),
                                ]);
                                nsResults.forEach(r => { if (r.data) r.data.forEach(row => { netStockMap[row.erp_product_id] = row.net_stock; }); });
                                spResults.forEach(r => { if (r.data) r.data.forEach(row => { supplierMap[row.erp_product_id] = row.proveedor; }); });
                            }
                            exportCsv(filtered, ERP_NAMES[selectedErp], ERP_NAMES[selectedErp], isBodega, netStockMap, supplierMap);
                            };

    const accionesMinMax = [
        ...(isBodega ? [] : [{
            key: 'calcular', icon: RefreshCw, variant: 'primary',
            // El progreso vive en el rótulo: al recalcular TODAS las sucursales
            // esto dice por cuál va ("Bayer 3/7"), que es la única señal de que
            // sigue trabajando en una operación que tarda minutos.
            label: !calculating ? 'Calcular'
                : calcMode === 'all' && calcProgress
                    ? `${calcProgress.name} ${calcProgress.current}/${calcProgress.total}`
                    : 'Calculando…',
            disabled: !canManage || calculating || loading,
            onClick: () => setCalcularConfirm({ open: true, mode: 'single' }),
        }]),
        {
            key: 'descargar', icon: Download, label: 'Descargar', soloIcono: true,
            disabled: data.length === 0 || loading,
            onClick: exportarCsv,
        },
        {
            key: 'config', icon: Settings2, label: 'Configurar parámetros', soloIcono: true,
            disabled: !canManage, activo: configOpen,
            onClick: () => setConfigOpen(o => !o),
        },
        {
            key: 'labs', icon: FlaskConical, label: 'Laboratorios ocultos', soloIcono: true,
            disabled: !canManage, activo: labsOpen,
            onClick: () => setLabsOpen(o => !o),
        },
    ];

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4 w-full min-w-0">

            {/* ── Config panel ── */}
            {configOpen && config && (
                <ConfigPanel
                    config={config}
                    onSave={cfg => { onConfigChange?.(cfg); setConfigChanged(true); }}
                    onClose={() => setConfigOpen(false)}
                />
            )}

            {/* ── Labs panel ── */}
            {labsOpen && (
                <LabsPanel
                    onClose={() => setLabsOpen(false)}
                    onChanged={() => loadData(selectedErp)}
                />
            )}

            {/* ── Controls row ── */}
            {/* La fila NO envuelve. Cuando envolvía, la píldora se iba a su propia
                línea y ahí `shrink-0` la dejaba estirarse de borde a borde: se
                veía pegada a la izquierda y su cupo de ranuras nunca llegaba a
                agotarse, así que el control de desborde no aparecía jamás. El
                carril absorbe la falta de ancho deslizando las tarjetas. */}
            <div className="flex items-stretch gap-3 min-w-0">

                {/* LEFT: Cost cards */}
                <CarrilCards className="flex-1" ariaLabel="Resumen de costo del inventario">
                    {loading
                        ? <CardSkeletons isBodega={isBodega} />
                        : costSummary
                            ? <CostCards summary={costSummary} isBodega={isBodega} />
                            : null}
                    {!loading && draftCost && <DraftCostCard draftCost={draftCost} isBodega={isBodega} />}
                </CarrilCards>

                {/* §17 — esto era UNA píldora con un filtro (sucursal) y cinco
                    ACCIONES adentro (CSV, config, labs, recalcular ×2), todas
                    `motion.button` escritas a mano. Separado en lo que cada cosa
                    es: la barra filtra, los botones actúan. De paso se van cinco
                    usos de framer-motion, que §11 marca como "no agregar más". */}
                <div className="flex items-center gap-2 shrink-0 justify-end">

                    <FilterBar
                        // `clearAllFilters` y no una lista propia: el hook ya sabe
                        // cuáles son TODOS los filtros de esta vista, incluidos los
                        // que no tienen ranura visible (borrador, solo-cambios).
                        // Escribirlos otra vez acá era garantizar que se
                        // desincronizaran al agregar el siguiente.
                        onClear={() => { clearAllFilters(); setFilterHidden(false); setPage(1); }}
                        activeCount={[
                            filterAbc !== 'all', filterXyz !== 'all', filterAlert !== 'all',
                            filterSparse, filterDispatchRisk, filterHidden,
                            filterDraft, filterChangesOnly,
                        ].filter(Boolean).length}
                        acciones={accionesMinMax}
                    >
                        {!lockedErpId && (
                            <FilterBar.Section label="sucursal">
                                <FilterBar.Sucursal
                                    value={String(selectedErp)}
                                    onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); setSortBy('laboratorio'); setSortDir('asc'); setFilterDraft(false); setFilterHidden(false); } }}
                                    options={erpOptions}
                                />
                            </FilterBar.Section>
                        )}

                        {/* La clasificación: ranura que se abre con las barras.
                            Antes era un bloque de 124px entre la píldora y la tabla. */}
                        {!isBodega && (
                            <FilterBar.Section
                                active={filterAbc !== 'all' || filterXyz !== 'all'}
                                onClear={() => { setFilterAbc('all'); setFilterXyz('all'); setPage(1); }}
                                label="clasificación">
                                <AbcXyzMatrix
                                    data={data}
                                    filterAbc={filterAbc} setFilterAbc={setFilterAbc}
                                    filterXyz={filterXyz} setFilterXyz={setFilterXyz}
                                    loading={loading}
                                />
                            </FilterBar.Section>
                        )}

                        {/* Los ocho filtros de estado, en UN control.
                            Eran una tira suelta de 44px entre la matriz y la
                            tabla; después ocho chips en línea. Las dos formas
                            fallaban en lo mismo: contestan **una sola pregunta**
                            —¿qué estado quiero ver?— y estaban dibujadas como
                            ocho preguntas independientes. Como select, además,
                            elegir uno apaga a los otros, que es lo que la lista
                            hacía de todos modos. */}
                        {!neverCalc && opcionesEstado.length > 0 && (
                            <FilterBar.Section
                                active={estadoActivo}
                                onClear={limpiarEstado}
                                label="estado">
                                <FilterBar.Opciones
                                    icon={Filter}
                                    label="Estado"
                                    placeholder="Estado"
                                    ancho="150px"
                                    umbral={0}
                                    value={estadoSel}
                                    onChange={setEstadoSel}
                                    options={opcionesEstado}
                                />
                                {/* Pegado al select y no en el grupo de acciones:
                                    restaurar es lo único que se puede HACER con
                                    la opción "Ocultos", y a 300px de distancia no
                                    se leía como parte de ella. Solo existe con esa
                                    opción puesta — restaurar filas que no están en
                                    pantalla es un cambio a ciegas. */}
                                {filterHidden && hiddenIds.size > 0 && canManage && (
                                    <LiquidTooltip side="bottom"
                                        content={`Restaurar ${hiddenIds.size} oculto${hiddenIds.size === 1 ? '' : 's'}`}>
                                        <TabBarAction size="sm" soloIcono icon={RotateCcw}
                                            onClick={unhideAll}
                                            label={`Restaurar ${hiddenIds.size} oculto${hiddenIds.size === 1 ? '' : 's'}`} />
                                    </LiquidTooltip>
                                )}
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>
            </div>

            {configChanged && !calculating && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-chart-1/10 border border-chart-1/30 text-body-sm text-chart-1-text font-medium">
                    <Settings2 size={13} className="shrink-0 text-chart-1-text" />
                    <span className="flex-1">Configuración actualizada — recalculá para que los nuevos parámetros surtan efecto.</span>
                    <Button icon={RefreshCw} onClick={() => setCalcularConfirm({ open: true, mode: 'single' })}>Recalcular ahora</Button>
                    <Button variant="ghost" icon={X} iconOnly onClick={() => setConfigChanged(false)} />
                </div>
            )}


            {!loading && neverCalc && (
                <div data-surface="card" className={glass}>
                    <EmptyState
                        icon={Package}
                        title={`Sin datos para ${ERP_NAMES[selectedErp]}`}
                        subtitle={isBodega
                            ? 'Bodega se actualiza automáticamente cuando las sucursales publican sus MIN/MAX. Selecciona una sucursal para calcular.'
                            : `Haz clic en Calcular para analizar ${config?.analysis_days ?? 180} días de ventas y generar los MIN/MAX.`}
                        action={!isBodega ? (
                            <Button disabled={calculating} onClick={handleRecalcular}>{calculating ? <Loader2 size={14} className="animate-spin" /> : null}
                                Calcular {ERP_NAMES[selectedErp]}</Button>
                        ) : undefined}
                    />
                </div>
            )}

            {/* ── Filter bar — single row: [filter pill] [draft+publish] [clase A] ── */}
            {!neverCalc && (
                <div className="flex items-center gap-2.5 flex-wrap">

                    {/* La tira de filtros de estado vivía acá: 44px entre la
                        matriz y la tabla. Ahora es una ranura de la píldora, con
                        lo que los filtros dejan de estar en dos sitios. */}

                    {/* Draft pill + Publicar — liquid glass, integrado a la derecha */}
                    <AnimatePresence>
                    {draftCount > 0 && !loading && canManage && !isBodega && (
                        <motion.div
                            key="draft-pub-pill"
                            initial={{ opacity: 0, x: 12, scale: 0.95 }}
                            animate={{ opacity: 1, x: 0, scale: 1, transition: { duration: 0.28, ease: EASE_OUT_EXPO } }}
                            exit={{ opacity: 0, x: 12, scale: 0.95, transition: { duration: 0.18 } }}
                            className="flex items-center rounded-2xl overflow-hidden shrink-0"
                            style={{
                                background: 'var(--surface-card)',
                                backdropFilter: 'blur(24px)',
                                WebkitBackdropFilter: 'blur(24px)',
                                border: '1px solid var(--border-card)',
                                boxShadow: 'var(--shadow-glass-2)',
                            }}>
                            {/* Dot + count */}
                            <div className="flex items-center gap-1.5 px-3 py-2 shrink-0">
                                <span className="relative flex h-2 w-2 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chart-1 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-chart-1" />
                                </span>
                                <span className="text-label font-black text-content tabular-nums">{draftCount}</span>
                                <span className="text-caption text-content-3 font-medium">borrador{draftCount !== 1 ? 'es' : ''}</span>
                            </div>
                            <div className="h-4 w-px bg-divider shrink-0" />
                            {/* Solo borradores */}
                            <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                onClick={() => { setFilterDraft(f => !f); setFilterSparse(false); setFilterChangesOnly(false); }}
                                className={`flex items-center gap-1 px-2.5 py-2 text-caption font-semibold transition-[background-color,color] duration-100 whitespace-nowrap ${filterDraft ? 'bg-surface-card-hover/80 text-content font-bold' : 'text-content-2 hover:bg-surface-card-hover/60 hover:text-content'}`}>
                                {filterDraft ? <><X size={8} strokeWidth={2.5} className="shrink-0" /> Ver todos</> : 'Solo borradores'}
                            </motion.button>
                            {/* Solo cambios */}
                            {hasPublishedData && changesCount > 0 && (
                                <>
                                    <div className="h-4 w-px bg-divider shrink-0" />
                                    <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                        onClick={() => { setFilterChangesOnly(f => !f); setFilterDraft(false); setFilterSparse(false); }}
                                        className={`flex items-center gap-1 px-2.5 py-2 text-caption font-semibold transition-[background-color,color] duration-100 whitespace-nowrap ${filterChangesOnly ? 'bg-chart-3/20 text-chart-3-text font-bold' : 'text-content-2 hover:bg-surface-card-hover/60 hover:text-content'}`}>
                                        {filterChangesOnly ? <><X size={8} strokeWidth={2.5} className="shrink-0" /> Ver todos</> : `Cambios (${changesCount})`}
                                    </motion.button>
                                </>
                            )}
                            {/* Ocultar filtrados (7A.6) */}
                            {hasActiveFilter && filtered.length > 0 && (
                                <>
                                    <div className="h-4 w-px bg-divider shrink-0" />
                                    <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                        onClick={() => setHideFilteredConfirm(true)}
                                        disabled={hidingFiltered}
                                        className="flex items-center gap-1 px-2.5 py-2 text-caption font-semibold text-danger/70 hover:bg-danger/10 hover:text-danger-text transition-[background-color,color] duration-100 whitespace-nowrap disabled:opacity-50">
                                        {hidingFiltered ? <Loader2 size={9} className="animate-spin shrink-0" /> : <EyeOff size={9} className="shrink-0" />}
                                        Ocultar {filterLabel} ({filtered.length})
                                    </motion.button>
                                </>
                            )}
                            {/* Descartar */}
                            <>
                                <div className="h-4 w-px bg-divider shrink-0" />
                                <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                    onClick={() => setDiscardConfirm(true)}
                                    disabled={discardingAll}
                                    className="flex items-center gap-1 px-2.5 py-2 text-caption font-semibold text-danger/70 hover:bg-danger/10 hover:text-danger-text transition-[background-color,color] duration-100 whitespace-nowrap disabled:opacity-50">
                                    {discardingAll ? <Loader2 size={9} className="animate-spin shrink-0" /> : <Trash2 size={9} className="shrink-0" />}
                                    Descartar
                                </motion.button>
                            </>
                            {/* ─ Publicar liquid glass ─ */}
                            <div className="h-4 w-px bg-warning/30 shrink-0 mx-0.5" />
                            <div className="pr-1.5 pl-0.5 py-1.5">
                                <AnimatePresence mode="wait">
                                {hasActiveFilter && filteredDraftIds.length > 0 ? (
                                    <motion.button key="pub-filtered"
                                        initial={{ opacity: 0, scale: 0.88 }}
                                        animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 400, damping: 28 } }}
                                        exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.12 } }}
                                        whileHover={{ scale: 1.05, y: -1.5, transition: { type: 'spring', stiffness: 480, damping: 26 } }}
                                        whileTap={{ scale: 0.94, y: 0, transition: { duration: 0.07 } }}
                                        onClick={() => requestPublish(filteredDraftIds)}
                                        disabled={publishing}
                                        className="group relative overflow-hidden flex items-center gap-1.5 px-3.5 py-1.5 text-label font-bold rounded-xl disabled:opacity-60 disabled:pointer-events-none whitespace-nowrap"
                                        style={{
                                            background: 'var(--brand)',
                                            backdropFilter: 'blur(20px) saturate(180%)',
                                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                            border: '1px solid var(--border-input)',
                                            boxShadow: 'var(--shadow-glow-brand)',
                                            color: 'white',
                                        }}>
                                        <span className="sweep" aria-hidden="true" style={{ '--sweep-alpha': '.25' }} />
                                        {publishing ? <Loader2 size={10} className="animate-spin relative z-base" /> : <Upload size={10} className="relative z-base" />}
                                        <span className="relative z-base">Publicar {filterLabel} ({filteredDraftIds.length})</span>
                                    </motion.button>
                                ) : (
                                    <motion.button key="pub-all"
                                        initial={{ opacity: 0, scale: 0.88 }}
                                        animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 400, damping: 28 } }}
                                        exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.12 } }}
                                        whileHover={{ scale: 1.05, y: -1.5, transition: { type: 'spring', stiffness: 480, damping: 26 } }}
                                        whileTap={{ scale: 0.94, y: 0, transition: { duration: 0.07 } }}
                                        onClick={() => requestPublish()}
                                        disabled={publishing}
                                        className="group relative overflow-hidden flex items-center gap-1.5 px-3.5 py-1.5 text-label font-bold rounded-xl disabled:opacity-60 disabled:pointer-events-none whitespace-nowrap"
                                        style={{
                                            background: 'var(--brand)',
                                            backdropFilter: 'blur(20px) saturate(180%)',
                                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                            border: '1px solid var(--border-input)',
                                            boxShadow: 'var(--shadow-glow-brand)',
                                            color: 'white',
                                        }}>
                                        <span className="sweep" aria-hidden="true" style={{ '--sweep-alpha': '.25' }} />
                                        {publishing ? <Loader2 size={10} className="animate-spin relative z-base" /> : <Upload size={10} className="relative z-base" />}
                                        <span className="relative z-base">Publicar todo ({draftCount})</span>
                                    </motion.button>
                                )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}
                    </AnimatePresence>

                    {/* Bodega info chip — inline para no ocupar fila extra */}
                    {!loading && isBodega && (
                        <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-xl"
                             style={{
                                 background: 'var(--surface-card)',
                                 backdropFilter: 'blur(20px)',
                                 WebkitBackdropFilter: 'blur(20px)',
                                 border: '1px solid var(--border-card)',
                                 boxShadow: 'var(--shadow-glass-1)',
                             }}>
                            <Info size={10} className="text-chart-3-text shrink-0" />
                            <span className="text-caption text-content-2 whitespace-nowrap">MIN/MAX = Σ sucursales publicadas</span>
                            {bodegaPendingCount > 0 ? (
                                <>
                                    <div className="h-3.5 w-px bg-divider mx-0.5 shrink-0" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse inline-block shrink-0" />
                                    <span className="text-caption font-bold text-warning-text whitespace-nowrap">{bodegaPendingCount} pendiente{bodegaPendingCount !== 1 ? 's' : ''}</span>
                                </>
                            ) : hasPublishedData ? (
                                <>
                                    <div className="h-3.5 w-px bg-divider mx-0.5 shrink-0" />
                                    <CheckCircle2 size={9} className="text-success shrink-0" />
                                    <span className="text-caption font-bold text-success-text whitespace-nowrap">Al día</span>
                                </>
                            ) : null}
                        </div>
                    )}

                </div>
            )}

            {/* ── Table + Pagination ── */}
            {!neverCalc && (
                <>
                <motion.div
                    key={`table-page-${page}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } }}
                >
                {isSearchFuzzy && searchTerm && (
                    <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                )}
                <DataTable
                    columns={COLS}
                    sortKey={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    loading={loading}
                    empty={{
                        icon: Package,
                        message: searchHiddenByFilter
                            ? `"${searchTerm}" existe pero está fuera del filtro activo`
                            : 'Sin productos con ese filtro',
                        action: searchHiddenByFilter
                            ? { label: 'Quitar filtros y ver resultado', onClick: () => { setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); } }
                            : { label: 'Quitar filtros', onClick: () => { setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); } },
                    }}
                    minWidth="340px"
                >

                    {pageRows.map((row, rowIdx) => {
                        const isExpanded = expandedId === row.erp_product_id;
                        const alert      = ALERT[row.alert_status] ?? ALERT.ok;
                        const pres       = row.presentations || [];
                        const dead       = row.is_dead_stock;
                        const noHistory  = row.alert_status === 'no_data';
                        const stock      = Number(row.current_stock);
                        const minN       = Number(row.effective_min);
                        const maxN       = Number(row.effective_max);
                        const v30        = Number(row.velocity_30d ?? 0);
                        const v6m        = Number(row.daily_velocity ?? 0);
                        const canExpand  = stock > 0 || row.last_sale_date != null || row.is_catalog_only || (row.effective_min ?? 0) > 0 || (row.effective_max ?? 0) > 0 || v6m > 0;
                        const hasDraft   = row.draft_status === 'pending';
                        const isSparse   = row.draft_status === 'sparse_data';
                        const limitedData = hasDraft &&
                            row.draft_data_days != null &&
                            row.draft_data_days < (analysisConfig.analysis_days ?? 180);
                        const dispatchRisk = !isBodega && hasDispatchRisk(row.effective_max, row.dispatch_pres_factor, row.dispatch_multiplo);

                        return (
                            <React.Fragment key={row.erp_product_id}>
                                <DataRow
                                    index={rowIdx}
                                    onClick={canExpand ? () => toggleExpand(row.erp_product_id) : undefined}
                                    className={alert.row}
                                    data-product-row={row.erp_product_id}
                                >
                                    {/* Producto */}
                                    <DataCell align="left" className="!py-2.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {/* Product photo — click to zoom; alert dot badge */}
                                            <div
                                                className={`shrink-0 relative w-7 h-7 rounded-md overflow-visible bg-surface-card-hover/80 border border-divider flex items-center justify-center ${row.foto_url ? 'cursor-zoom-in' : ''}`}
                                                {...clickable(row.foto_url ? e => { e.stopPropagation(); setZoomPhoto(row.foto_url); } : undefined)}
                                                title={alert.label}
                                            >
                                                {row.foto_url
                                                    ? <img src={row.foto_url} alt="" className="w-full h-full object-contain rounded-md" />
                                                    : <Package size={13} className="text-content-3" />}
                                                {row.alert_status && row.alert_status !== 'ok' && (
                                                    <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-border-card shadow-sm shrink-0 ${alert.dot}`} />
                                                )}
                                            </div>
                                            <div className={`shrink-0 w-4 h-4 flex items-center justify-center ${!canExpand ? 'opacity-0' : ''}`}>
                                                <ChevronRight size={12} className={`text-content-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-body font-medium text-content truncate leading-tight">{row.product_name || '—'}</span>
                                                    {row.has_manual && <Badge variant="chart-3" size="sm" uppercase={false} className="shrink-0">MANUAL</Badge>}
                                                    {hasDraft && !isBodega && <Badge size="sm" uppercase={false}>BORRADOR</Badge>}
                                                    {hasDraft && isBodega && <Badge variant="warning" size="sm" uppercase={false} className="shrink-0">SUC. PEND.</Badge>}
                                                    {dispatchRisk && <Badge title="El MAX actual no alcanza el umbral de la regla de despacho — este producto nunca va a generar un pedido real así" variant="danger" size="sm" uppercase={false}>RIESGO REGLA</Badge>}
                                                    {isBodega && (
                                                        (hasDraft && Number(row.draft_min ?? 0) === 0 && Number(row.draft_max ?? 0) === 0) ||
                                                        (!hasDraft && Number(row.pub_min ?? 0) === 0 && Number(row.pub_max ?? 0) === 0 && row.has_manual)
                                                    ) && <Badge title="Retirado de MIN·MAX en todas las salas" variant="danger" size="sm" uppercase={false}>SIN SALAS</Badge>}
                                                    {limitedData && (
                                                        <Badge title={`Solo ${row.draft_data_days} días de historial de compras (ventana: ${analysisConfig.analysis_days} días)`} variant="warning" size="sm" uppercase={false}>{row.draft_data_days}d DATOS</Badge>
                                                    )}
                                                </div>
                                                {/* Stock actual inline */}
                                                {/* Stock + velocity — single compact row */}
                                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                    <Package size={10} className="text-content-3 shrink-0" />
                                                    <span className="text-label font-black tabular-nums text-content-2">
                                                        {formatUnits(stock, pres)}
                                                    </span>
                                                    {!dead && minN > 0 && stock < minN && (
                                                        <span className="text-micro font-bold text-warning-text">↓{(minN - stock).toLocaleString()}</span>
                                                    )}
                                                    {!dead && maxN > 0 && stock > maxN && (
                                                        <span className="text-micro font-bold text-chart-1-text">↑{(stock - maxN).toLocaleString()}</span>
                                                    )}
                                                    <span className="text-content-3 text-caption select-none mx-0.5">|</span>
                                                    {noHistory && (
                                                        <span className="text-caption text-warning-text font-semibold italic">Sin ventas</span>
                                                    )}
                                                    {isSparse && (
                                                        <span className="text-caption text-warning-text font-semibold flex items-center gap-0.5">
                                                            <AlertTriangle size={9} />
                                                            {Number(row.units_sold_6m) >= 10
                                                                ? `Mayorista: ${Number(row.units_sold_6m).toLocaleString()} uds.`
                                                                : Number(row.units_sold_6m) > 0
                                                                    ? `${Number(row.units_sold_6m).toLocaleString()} uds. 6m`
                                                                    : 'Sin ventas'
                                                            }
                                                            {row.last_sale_date && <span className="text-warning-text/70 ml-0.5">· {isBodega && row.last_sale_sucursal_id ? `${ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} ` : ''}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                                                        </span>
                                                    )}
                                                    {!dead && !noHistory && !isSparse && (
                                                        <span className="text-caption text-content-3 flex items-center gap-0.5 font-medium">
                                                            <BarChart2 size={9} className="text-content-3 shrink-0" />
                                                            {v6m.toFixed(2)}/día
                                                            {v30 > 0 && v30 > v6m * 1.1 && <TrendingUp size={9} className="text-success ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                            {v30 > 0 && v30 < v6m * 0.9 && <TrendingDown size={9} className="text-danger ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                            <span className="text-content-3 mx-0.5">·</span>
                                                            {Math.round(v6m * 30)}/mes
                                                            {Number(row.units_sold_6m) > 0 && <><span className="text-content-3 mx-0.5">·</span>{Number(row.units_sold_6m).toLocaleString()} vend.</>}
                                                            <span className="text-content-3 mx-0.5">·</span>
                                                            {row.last_sale_date
                                                                ? <span className="font-semibold text-content-2">{isBodega && row.last_sale_sucursal_id ? <span className="font-normal text-content-3">{ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} · </span> : null}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                                                : <span className="text-content-3 italic">sin venta</span>
                                                            }
                                                        </span>
                                                    )}
                                                    {(dead || noHistory) && (
                                                        <span className="text-caption font-semibold text-content-3">
                                                            {row.last_sale_date
                                                                ? <><span className="text-content-3">Últ.</span> {isBodega && row.last_sale_sucursal_id ? <span className="text-content-3">{ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} · </span> : null}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</>
                                                                : <span className="text-content-3 italic">sin ventas</span>
                                                            }
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </DataCell>

                                    {/* Laboratorio */}
                                    <DataCell hideBelow="lg" align="left" className="!py-2.5">
                                        <span className="text-label text-content-2 truncate block max-w-[160px]">
                                            {row.laboratorio_nombre || <span className="text-content-3">—</span>}
                                        </span>
                                    </DataCell>

                                    {/* Clase — show draft badge when no published value yet */}
                                    <DataCell hideBelow="sm" align="center" className="!py-2.5">
                                        {!row.abc_class && hasDraft
                                            ? <AbcXyzBadge abc={row.draft_abc_class} xyz={row.draft_demand_variability} />
                                            : (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <AbcXyzBadge abc={row.abc_class} xyz={row.demand_variability} />
                                                    {hasDraft && row.draft_abc_class && (
                                                        row.draft_abc_class !== row.abc_class ||
                                                        normXyz(row.draft_demand_variability) !== normXyz(row.demand_variability)
                                                    ) && (
                                                        <div className="flex items-center gap-0.5">
                                                            <span className="text-micro text-content-3">→</span>
                                                            <AbcXyzBadge abc={row.draft_abc_class} xyz={row.draft_demand_variability} />
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        }
                                    </DataCell>

                                    {/* MIN · MAX — combined cell; Tab/ArrowRight moves min→max */}
                                    <DataCell align="center" className="!py-2.5">
                                        <div className="flex flex-col items-center w-full">
                                        {(() => {
                                            const isEditMin = canManage && inlineDraftEdit?.productId === row.erp_product_id && inlineDraftEdit?.field === 'min';
                                            const isEditMax = canManage && inlineDraftEdit?.productId === row.erp_product_id && inlineDraftEdit?.field === 'max';
                                            const sep = <span className="text-content-3 mx-1 select-none text-label">·</span>;

                                            if (isEditMin) return (
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5">
                                                        <PortalInput
                                                            aria-label="Nuevo valor"
                                                            type="number"
                                                            min="0"
                                                            value={inlineDraftEdit.value}
                                                            onChange={e => setInlineDraftEdit(p => ({ ...p, value: e.target.value, error: undefined }))}
                                                            onFocus={e => e.target.select()}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Escape') { setInlineDraftEdit(null); return; }
                                                                if (e.key === 'Tab' || e.key === 'ArrowRight') {
                                                                    e.preventDefault(); skipBlurSave.current = true;
                                                                    if (inlineDraftEdit.value === '') { setInlineDraftEdit(null); return; }
                                                                    setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: hasDraft ? ((row.draft_max > 0 || row.draft_min > 0) ? String(row.draft_max ?? 0) : '') : ((row.effective_max > 0 || row.effective_min > 0) ? String(row.effective_max ?? 0) : ''), pendingMin: inlineDraftEdit.value });
                                                                    return;
                                                                }
                                                                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                                                                    e.preventDefault();
                                                                    if (inlineDraftEdit.value !== '') { const err = validateEditForRow(inlineDraftEdit, row); if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; } skipBlurSave.current = true; saveDraftCell(inlineDraftEdit); }
                                                                    const next = pageRows.slice(rowIdx + 1).find(r => !hiddenIds.has(r.erp_product_id));
                                                                    if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: next.draft_status === 'pending' ? ((next.draft_min > 0 || next.draft_max > 0) ? String(next.draft_min ?? 0) : '') : (next.is_dead_stock || next.is_catalog_only || (next.effective_min === null && !next.effective_max) ? '' : String(next.effective_min ?? 0)) });
                                                                    else setInlineDraftEdit(null); return;
                                                                }
                                                                if (e.key === 'ArrowUp') {
                                                                    e.preventDefault();
                                                                    if (inlineDraftEdit.value !== '') { const err = validateEditForRow(inlineDraftEdit, row); if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; } skipBlurSave.current = true; saveDraftCell(inlineDraftEdit); }
                                                                    const prev = [...pageRows.slice(0, rowIdx)].reverse().find(r => !hiddenIds.has(r.erp_product_id));
                                                                    if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: prev.draft_status === 'pending' ? ((prev.draft_min > 0 || prev.draft_max > 0) ? String(prev.draft_min ?? 0) : '') : (prev.is_dead_stock || prev.is_catalog_only || (prev.effective_min === null && !prev.effective_max) ? '' : String(prev.effective_min ?? 0)) });
                                                                    else setInlineDraftEdit(null); return;
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                if (skipBlurSave.current) { skipBlurSave.current = false; return; }
                                                                if (inlineDraftEdit.value === '') { setInlineDraftEdit(null); return; }
                                                                const err = validateEditForRow(inlineDraftEdit, row);
                                                                if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                                saveDraftCell(inlineDraftEdit);
                                                            }}
                                                            autoFocus
                                                            compact
                                                            className="w-20"
                                                            inputClassName="text-center font-black tabular-nums"
                                                        />
                                                        {sep}
                                                        <div data-surface={hasDraft ? undefined : 'card'} className={`min-w-[36px] text-center text-body-sm font-black tabular-nums rounded-md border-2 border-dashed px-1 py-0.5 ${hasDraft ? 'text-chart-1-text bg-chart-1/10 border-chart-1/40' : 'text-content-3 bg-surface-card-hover'}`}>{maxN > 0 ? maxN.toLocaleString() : '—'}</div>
                                                    </div>
                                                    {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && <div className={`text-micro font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-warning-text' : 'text-success-text'}`}>≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}</div>}
                                                    {(dead || noHistory) && <div className="text-micro text-warning-text font-semibold mt-0.5">⚠ Sin ventas 6 meses</div>}
                                                </div>
                                            );

                                            if (isEditMax) return (
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className={`min-w-[36px] text-center text-body-sm font-black tabular-nums rounded-md border-2 border-dashed px-1 py-0.5 ${hasDraft ? 'text-warning bg-warning/10 border-warning' : 'text-success-text bg-success/10 border-success'}`}>{inlineDraftEdit.pendingMin !== undefined ? (inlineDraftEdit.pendingMin === '' ? '—' : (parseInt(inlineDraftEdit.pendingMin, 10) || 0).toLocaleString()) : ((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—')}</div>
                                                        {sep}
                                                        <PortalInput
                                                            aria-label="Nuevo valor"
                                                            type="number"
                                                            min="0"
                                                            value={inlineDraftEdit.value}
                                                            onChange={e => setInlineDraftEdit(p => ({ ...p, value: e.target.value, error: undefined }))}
                                                            onFocus={e => e.target.select()}
                                                            onBlur={() => {
                                                            if (skipBlurSave.current) { skipBlurSave.current = false; return; }
                                                            if (inlineDraftEdit.value === '') { setInlineDraftEdit(null); return; }
                                                            const errB = validateEditForRow(inlineDraftEdit, row);
                                                            if (errB) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, errB, 'error'); setInlineDraftEdit(null); return; }
                                                            if (inlineDraftEdit.pendingMin !== undefined) { const { productId, sucursalId, pendingMin, value } = inlineDraftEdit; skipBlurSave.current = true; setInlineDraftEdit(null); saveDraftPair(productId, sucursalId, pendingMin, value, row.product_name); } else { saveDraftCell(inlineDraftEdit); }
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Escape') { setInlineDraftEdit(null); return; }
                                                                if (e.key === 'ArrowLeft') {
                                                                    e.preventDefault(); skipBlurSave.current = true;
                                                                    if (inlineDraftEdit.pendingMin !== undefined) { setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: inlineDraftEdit.pendingMin }); }
                                                                    // ArrowLeft desde MAX era el ÚNICO de los 5 caminos de guardado que
                                                                    // no validaba: guardaba MAX suelto y el par inválido (MAX≤MIN,
                                                                    // MAX=0 con MIN>0) recién explotaba en el publish, abortando el
                                                                    // lote entero. Ahora valida igual que blur/Enter/ArrowUp.
                                                                    else { if (inlineDraftEdit.value !== '') { const errL = validateEditForRow(inlineDraftEdit, row); if (errL) { useToastStore.getState().showToast(row.product_name, errL, 'error'); setInlineDraftEdit(null); return; } saveDraftCell(inlineDraftEdit); } setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: hasDraft ? ((row.draft_min > 0 || row.draft_max > 0) ? String(row.draft_min ?? 0) : '') : ((row.effective_min > 0 || row.effective_max > 0) ? String(row.effective_min ?? 0) : '') }); }
                                                                    return;
                                                                }
                                                                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                                                                    e.preventDefault();
                                                                    if (inlineDraftEdit.value === '') { const next = pageRows.slice(rowIdx + 1).find(r => !hiddenIds.has(r.erp_product_id)); if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: next.draft_status === 'pending' ? ((next.draft_min > 0 || next.draft_max > 0) ? String(next.draft_min ?? 0) : '') : (next.is_dead_stock || next.is_catalog_only || (next.effective_min === null && !next.effective_max) ? '' : String(next.effective_min ?? 0)) }); else setInlineDraftEdit(null); return; }
                                                                    const err = validateEditForRow(inlineDraftEdit, row); if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                                    skipBlurSave.current = true;
                                                                    const next = pageRows.slice(rowIdx + 1).find(r => !hiddenIds.has(r.erp_product_id));
                                                                    if (inlineDraftEdit.pendingMin !== undefined) { const { productId, sucursalId, pendingMin, value } = inlineDraftEdit; if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: next.draft_status === 'pending' ? ((next.draft_min > 0 || next.draft_max > 0) ? String(next.draft_min ?? 0) : '') : (next.is_dead_stock || next.is_catalog_only || (next.effective_min === null && !next.effective_max) ? '' : String(next.effective_min ?? 0)) }); else setInlineDraftEdit(null); saveDraftPair(productId, sucursalId, pendingMin, value, row.product_name); }
                                                                    else { saveDraftCell(inlineDraftEdit); if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: next.draft_status === 'pending' ? ((next.draft_min > 0 || next.draft_max > 0) ? String(next.draft_min ?? 0) : '') : (next.is_dead_stock || next.is_catalog_only || (next.effective_min === null && !next.effective_max) ? '' : String(next.effective_min ?? 0)) }); else setInlineDraftEdit(null); }
                                                                    return;
                                                                }
                                                                if (e.key === 'ArrowUp') {
                                                                    e.preventDefault();
                                                                    if (inlineDraftEdit.value === '') { const prev = [...pageRows.slice(0, rowIdx)].reverse().find(r => !hiddenIds.has(r.erp_product_id)); if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: prev.draft_status === 'pending' ? ((prev.draft_min > 0 || prev.draft_max > 0) ? String(prev.draft_min ?? 0) : '') : (prev.is_dead_stock || prev.is_catalog_only || (prev.effective_min === null && !prev.effective_max) ? '' : String(prev.effective_min ?? 0)) }); else setInlineDraftEdit(null); return; }
                                                                    const err = validateEditForRow(inlineDraftEdit, row); if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                                    skipBlurSave.current = true;
                                                                    const prev = [...pageRows.slice(0, rowIdx)].reverse().find(r => !hiddenIds.has(r.erp_product_id));
                                                                    if (inlineDraftEdit.pendingMin !== undefined) { const { productId, sucursalId, pendingMin, value } = inlineDraftEdit; if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: prev.draft_status === 'pending' ? ((prev.draft_min > 0 || prev.draft_max > 0) ? String(prev.draft_min ?? 0) : '') : (prev.is_dead_stock || prev.is_catalog_only || (prev.effective_min === null && !prev.effective_max) ? '' : String(prev.effective_min ?? 0)) }); else setInlineDraftEdit(null); saveDraftPair(productId, sucursalId, pendingMin, value, row.product_name); }
                                                                    else { saveDraftCell(inlineDraftEdit); if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: prev.draft_status === 'pending' ? ((prev.draft_min > 0 || prev.draft_max > 0) ? String(prev.draft_min ?? 0) : '') : (prev.is_dead_stock || prev.is_catalog_only || (prev.effective_min === null && !prev.effective_max) ? '' : String(prev.effective_min ?? 0)) }); else setInlineDraftEdit(null); }
                                                                    return;
                                                                }
                                                            }}
                                                            autoFocus
                                                            compact
                                                            className="w-20"
                                                            inputClassName="text-center font-black tabular-nums"
                                                        />
                                                    </div>
                                                    {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && <div className={`text-micro font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-chart-1-text' : 'text-success-text'}`}>≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}</div>}
                                                </div>
                                            );

                                            // ── Display (non-editing) ──
                                            // Bodega: openBodegaEdit (hook) hace fetch fresco antes de mostrar el
                                            // editor. Floor = max(min_units, draft_min) porque Bodega puede no estar
                                            // publicada pero ya tener un draft_min > 0 (Σ efectivo de sucursales via trigger).
                                            const openMinEdit = canManage ? e => { e.stopPropagation(); setExpandedId(null); if (isBodega) { openBodegaEdit(row, 'min', isBodega); return; } setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: hasDraft ? ((row.draft_min > 0 || row.draft_max > 0) ? String(row.draft_min ?? 0) : '') : ((dead || noHistory) ? '' : ((row.effective_min > 0 || row.effective_max > 0) ? String(row.effective_min ?? 0) : '')) }); } : undefined;
                                            const openMaxEdit = canManage ? e => { e.stopPropagation(); setExpandedId(null); if (isBodega) { openBodegaEdit(row, 'max', isBodega); return; } setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: hasDraft ? ((row.draft_max > 0 || row.draft_min > 0) ? String(row.draft_max ?? 0) : '') : ((dead || noHistory) ? '' : ((row.effective_max > 0 || row.effective_min > 0) ? String(row.effective_max ?? 0) : '')) }); } : undefined;

                                            const box = (val, colorCls, borderCls, clickFn) => (
                                                <div {...clickable(clickFn)}
                                                    className={`min-w-[36px] text-center text-body-sm font-black tabular-nums rounded-md border px-1 py-0.5 transition-colors duration-100 ${colorCls} ${borderCls} ${clickFn ? 'cursor-pointer hover:brightness-95' : ''}`}>
                                                    {val}
                                                </div>
                                            );

                                            if (hasDraft) return isBodega ? (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—', stock < minN ? 'text-warning-text bg-warning/10' : 'text-content-2 bg-surface-card', stock < minN ? 'border-warning/30' : 'border-border-card', openMinEdit)}
                                                        {sep}
                                                        {box(maxN > 0 ? maxN.toLocaleString() : '—', stock > maxN && maxN > 0 ? 'text-chart-1-text bg-chart-1/10' : 'text-content-3 bg-surface-card', stock > maxN && maxN > 0 ? 'border-chart-1/30' : 'border-border-card', openMaxEdit)}
                                                    </div>
                                                    {row.has_manual && (row.pub_min > 0 || row.pub_max > 0 || (row.draft_min ?? 0) > 0 || (row.draft_max ?? 0) > 0) && (
                                                        <div className="text-micro font-semibold text-chart-3-text tabular-nums">Σ {Math.max(row.pub_min ?? 0, row.draft_min ?? 0).toLocaleString()}·{Math.max(row.pub_max ?? 0, row.draft_max ?? 0).toLocaleString()}</div>
                                                    )}
                                                    <Badge
                                                        variant="warning" size="sm" uppercase={false}
                                                        title="Hover para ver sucursales pendientes"
                                                        className="gap-1 cursor-help select-none"
                                                        onMouseEnter={e => openBodegaTooltip(row.erp_product_id, e.currentTarget.getBoundingClientRect())}
                                                        onMouseLeave={closeBodegaTooltip}
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse inline-block shrink-0" />
                                                        {(row.draft_min ?? 0).toLocaleString()}·{(row.draft_max ?? 0).toLocaleString()}
                                                    </Badge>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((row.draft_min > 0 || row.draft_max > 0) ? (row.draft_min ?? 0).toLocaleString() : '—', 'text-warning-text bg-warning/10', 'border-warning/30', openMinEdit)}
                                                        {sep}
                                                        {box(row.draft_max > 0 ? row.draft_max.toLocaleString() : '—', 'text-chart-1-text bg-chart-1/10', 'border-chart-1/30', openMaxEdit)}
                                                    </div>
                                                    {(minN > 0 || maxN > 0) && <div className="text-micro text-content-3 tabular-nums">{minN.toLocaleString()} · {maxN.toLocaleString()} act.</div>}
                                                </div>
                                            );

                                            if (isSparse) return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—', 'text-warning-text bg-warning/10', 'border-dashed border-warning/40', openMinEdit)}
                                                        {sep}
                                                        {box(maxN > 0 ? maxN.toLocaleString() : '—', 'text-warning-text bg-warning/10', 'border-dashed border-warning/40', openMaxEdit)}
                                                    </div>
                                                    <div className="text-micro text-warning-text font-semibold">⚠ Confirmar</div>
                                                </div>
                                            );

                                            if ((minN === 0 && maxN === 0) || (row.effective_min === null && row.effective_max === null)) return (
                                                <div className="flex items-center gap-1">
                                                    {box('—', 'text-content-3 bg-surface-card', 'border-divider', openMinEdit)}
                                                    {sep}
                                                    {box('—', 'text-content-3 bg-surface-card', 'border-divider', openMaxEdit)}
                                                </div>
                                            );

                                            const pendingBadge = isBodega && row.has_pending_branches ? (
                                                <Badge
                                                    variant="warning" size="sm" uppercase={false}
                                                    title="Hover para ver sucursales pendientes"
                                                    className="gap-1 cursor-help select-none"
                                                    onMouseEnter={e => openBodegaTooltip(row.erp_product_id, e.currentTarget.getBoundingClientRect())}
                                                    onMouseLeave={closeBodegaTooltip}
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse inline-block shrink-0" />
                                                    Suc. pendientes
                                                </Badge>
                                            ) : null;

                                            if (isBodega && row.has_manual && (row.pub_min > 0 || row.pub_max > 0)) return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box(minN.toLocaleString(), stock < minN ? 'text-warning-text bg-warning/10' : 'text-content-2 bg-surface-card', stock < minN ? 'border-warning/30' : 'border-border-card', openMinEdit)}
                                                        {sep}
                                                        {box(maxN.toLocaleString(), stock > maxN && maxN > 0 ? 'text-chart-1-text bg-chart-1/10' : 'text-content-3 bg-surface-card', stock > maxN && maxN > 0 ? 'border-chart-1/30' : 'border-border-card', openMaxEdit)}
                                                    </div>
                                                    <div className="text-micro font-semibold text-chart-3-text tabular-nums">Σ {(row.pub_min ?? 0).toLocaleString()}·{(row.pub_max ?? 0).toLocaleString()}</div>
                                                    {pendingBadge}
                                                </div>
                                            );

                                            return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box(minN.toLocaleString(), stock < minN ? 'text-warning-text bg-warning/10' : 'text-content-2 bg-surface-card', stock < minN ? 'border-warning/30' : 'border-border-card', openMinEdit)}
                                                        {sep}
                                                        {box(maxN.toLocaleString(), stock > maxN && maxN > 0 ? 'text-chart-1-text bg-chart-1/10' : 'text-content-3 bg-surface-card', stock > maxN && maxN > 0 ? 'border-chart-1/30' : 'border-border-card', openMaxEdit)}
                                                    </div>
                                                    {pendingBadge}
                                                </div>
                                            );
                                        })()}
                                        </div>
                                    </DataCell>

                                    {/* Despacho — presentación catálogo siempre visible + regla + cantidades */}
                                    <DataCell hideBelow="md" align="center" className="!py-2 !px-2">
                                        {(() => {
                                            // 7A.7: dispMin/dispMax + applyRule calculan el MIN/MAX ya
                                            // redondeado por la regla de despacho — se muestran debajo del
                                            // badge de presentación/regla (solo cuando hay regla + presentación
                                            // real, para no mostrar un redondeo basado en factores default=1).
                                            const dispMin = (hasDraft && !isBodega) ? (row.draft_min ?? 0) : minN;
                                            const dispMax = (hasDraft && !isBodega) ? (row.draft_max ?? 0) : maxN;
                                            const hasPres = pres.length > 0;

                                            // Catalog presentation label (always shown)
                                            const sp = smallestPres(pres);
                                            const spTipo = sp?.tipo?.trim() ?? '';
                                            const isGenericUnit = !spTipo || spTipo.toLowerCase() === 'und' || spTipo.toLowerCase() === 'unidad';
                                            const capTipo = t => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'und';
                                            const displayTipo = capTipo(isGenericUnit ? (spTipo || 'und') : spTipo);
                                            const displayFactor = sp?.factor ?? 1;
                                            const displayDesc = sp?.descripcion ?? null;
                                            const factorInName = displayFactor > 1 && new RegExp(`\\b${displayFactor}\\b`).test(spTipo);
                                            const baseLabel = displayFactor > 1 && !factorInName
                                                ? `${displayTipo} ×${displayFactor}`
                                                : displayDesc
                                                ? `${displayTipo} ${displayDesc}`
                                                : displayTipo || 'und';

                                            // Dispatch rule — rounds quantities, always shown as note when present.
                                            // packSize ya viene resuelto por la RPC (factor de la presentación de
                                            // despacho × múltiplo), mismo cálculo que get_pedido_preview.
                                            const dpFactor = row.dispatch_pres_factor != null ? Number(row.dispatch_pres_factor) : null;
                                            const dpMultiplo = Number(row.dispatch_multiplo ?? 1);
                                            const dpTipo = row.dispatch_tipo || null;
                                            const hasRule = dpFactor != null;
                                            const packSize = hasRule ? dpFactor * dpMultiplo : 1;
                                            const ruleNote = hasRule
                                                ? `${capTipo(dpTipo)}${dpMultiplo > 1 ? ` ×${dpMultiplo}` : ''}`
                                                : null;

                                            const applyRule = (qty) => {
                                                if (!qty || qty <= 0 || !hasRule || packSize <= 1) return qty;
                                                const rounded = Math.round(qty / packSize) * packSize;
                                                return rounded > 0 ? rounded : packSize;
                                            };

                                            return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <Badge variant="neutral" uppercase={false} className="gap-1 whitespace-nowrap">
                                                        {baseLabel}
                                                        {ruleNote && <>
                                                            <span className="w-px h-2.5 bg-content-3 inline-block" />
                                                            <span className="text-micro font-semibold text-content-3">{ruleNote}</span>
                                                        </>}
                                                    </Badge>
                                                    {hasRule && hasPres && (
                                                        <LiquidTooltip content="MIN · MAX ya redondeado a la regla de despacho">
                                                            <span className="text-micro font-semibold text-content-3 tabular-nums">
                                                                {applyRule(dispMin).toLocaleString()} · {applyRule(dispMax).toLocaleString()}
                                                            </span>
                                                        </LiquidTooltip>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </DataCell>

                                    {/* Acciones */}
                                    <DataCell align="center" className="!py-2">
                                        <RowActions
                                            row={row}
                                            filterHidden={filterHidden}
                                            hasDraft={hasDraft}
                                            dead={dead}
                                            noHistory={noHistory}
                                            canManage={canManage}
                                            publishing={publishing}
                                            hidingIds={hidingIds}
                                            isBodegaRow={isBodega}
                                            onUnhide={async () => { await unhideProduct(row.erp_product_id); }}
                                            onHide={async () => {
                                                setHidingIds(prev => { const n = new Set(prev); n.add(row.erp_product_id); return n; });
                                                // Oculto queda en -/- PUBLICADO, no en un borrador de 0/0.
                                                // El borrador era inalcanzable —la tabla no lista ocultos y el
                                                // contador de borradores los saltea (useMinMaxData.js:298)— así
                                                // que quedaba pendiente para siempre y bloqueaba el recálculo
                                                // mensual de toda la sucursal.
                                                await upsertStockParams({
                                                    erp_product_id: row.erp_product_id,
                                                    erp_sucursal_id: row._erp_sucursal_id,
                                                    is_hidden: true,
                                                    min_units: null, max_units: null,
                                                    draft_min: null, draft_max: null, draft_status: 'none',
                                                    updated_at: new Date().toISOString(),
                                                });
                                                setHidingIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; });
                                                setHiddenIds(prev => { const n = new Set(prev); n.add(row.erp_product_id); return n; });
                                                setData(prev => prev.map(r => r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                                                    ? { ...r, is_hidden: true, min_units: null, max_units: null, draft_min: null, draft_max: null, draft_status: 'none' } : r));
                                                useStaff.getState().appendAuditLog('MINMAX_HIDE', String(row.erp_product_id), { product: row.product_name, sucursal_id: row._erp_sucursal_id });
                                            }}
                                            onZeroOut={() => {
                                                const cls = row.draft_abc_class || row.abc_class;
                                                if (cls === 'A' || cls === 'B') setZeroOutConfirm({ open: true, row, pendingCell: null, pendingPair: null });
                                                else zeroOutRow(row);
                                            }}
                                            onResetToCalc={() => resetToCalc(row)}
                                            onOpenHistory={() => openHistory(row)}
                                            onDiscardDraft={() => setDiscardRowConfirm({ open: true, row })}
                                            onPublish={(ids) => requestPublish(ids)}
                                            onZeroAllBranches={() => {
                                                const cls = row.draft_abc_class || row.abc_class;
                                                if (cls === 'A' || cls === 'B')
                                                    setZeroOutConfirm({ open: true, row, pendingCell: null, pendingPair: null, pendingZeroAll: true });
                                                else
                                                    setZeroAllConfirm({ open: true, row });
                                            }}
                                        />
                                    </DataCell>
                                </DataRow>

                                <tr data-expand-row={row.erp_product_id}>
                                    <td colSpan={COLS.length} className="p-0">
                                        <AnimatePresence initial={false}>
                                        {isExpanded && canExpand && (
                                            <motion.div
                                                key={`exp-${row.erp_product_id}`}
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
                                                transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.7, opacity: { duration: 0.15 } }}
                                                style={{ overflow: 'hidden', willChange: 'height' }}
                                            >
                                                <ExpandedPanel row={row} cycleDays={cycleDays} />
                                            </motion.div>
                                        )}
                                        </AnimatePresence>
                                    </td>
                                </tr>
                            </React.Fragment>
                        );
                    })}
                </DataTable>
                </motion.div>

                {!loading && sorted.length > 0 && (
                    <TablePagination
                        pageSize={pageSize}
                        onPageSizeChange={size => { setPageSize(size); setPage(1); }}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        total={data.length}
                        unit="productos"
                        filteredTotal={sorted.length < data.length ? sorted.length : undefined}
                    />
                )}
                </>
            )}

            {/* ── Bodega pending-branch tooltip ── */}
            {bodegaTooltip && bodegaTooltip.pending.length > 0 && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        top:  bodegaTooltip.rect.bottom + 6,
                        left: bodegaTooltip.rect.left + bodegaTooltip.rect.width / 2,
                        transform: 'translateX(-50%)',
                        zIndex: 10001,
                        pointerEvents: 'none',
                    }}
                    className="bg-surface-card backdrop-blur-md border border-warning/30 rounded-xl shadow-xl px-3 py-2 min-w-[148px]"
                >
                    <div className="text-micro font-bold text-warning uppercase tracking-wide mb-1.5">Sucursales pendientes</div>
                    {bodegaTooltip.pending.map(b => (
                        <div key={b.erp_sucursal_id} className="flex items-center justify-between gap-3">
                            <span className="text-caption text-content-2 font-medium">{ERP_NAMES[b.erp_sucursal_id] ?? `Suc. ${b.erp_sucursal_id}`}</span>
                            <span className="text-caption text-warning-text tabular-nums font-semibold">{(b.draft_min ?? 0).toLocaleString()}·{(b.draft_max ?? 0).toLocaleString()}</span>
                        </div>
                    ))}
                </div>,
                document.body
            )}

            {/* ── Toast notification (portal → fuera de backdrop-filter, siempre en viewport) ── */}
            {toast && createPortal(
                <div className={`fixed bottom-6 right-6 z-toast flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-2xl text-body font-semibold animate-in slide-in-from-bottom-2 ${toast.type === 'error' ? 'bg-danger-solid' : 'bg-brand'}`}>
                    {currentEmployee?.photo_url
                        ? <img src={currentEmployee.photo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-[var(--border-card)]" />
                        : <Info size={15} className="shrink-0" />}
                    <span>{toast.message}</span>
                    {toast.action && (
                        <Button variant="secondary" onClick={toast.action.onClick}>{toast.action.label}</Button>
                    )}
                    <Button variant="ghost" icon={X} iconOnly onClick={() => setToast(null)} />
                </div>,
                document.body
            )}

            {/* ── Historial MIN/MAX ── */}
            {/* `ModalShell` y no un overlay a mano (2026-07-30). Era el último modal
                escrito a mano del proyecto: su propio `fixed inset-0`, su propio
                scrim, su propio `backdrop-filter` en `style` y su propio
                `rounded-3xl` — sin `role="dialog"`, sin Escape, sin atrapar el
                foco y sin bloquear el scroll de atrás. Y como no pasaba por el
                canónico, se quedaba centrado en el teléfono mientras todos los
                demás pasaban a hoja. */}
            {/* El guard va AFUERA y no en `open`: los children de JSX se evalúan
                al crear el elemento, no al montarlo, así que `open={!!historyRow}`
                no protege nada — el cuerpo dereferencia `historyRow` y revienta
                con null. Es el mismo defecto que el refactor a ModalShell dejó en
                RequestsView y EmployeeDetailView. */}
            {historyRow && (
            <ModalShell
                open
                onClose={() => setHistoryRow(null)}
                maxWidthClass="max-w-md"
                zClass="z-tooltip"
                surface={null}
                ariaLabel="Historial de MIN/MAX">
                <div data-surface="modal" className="max-h-[82dvh] flex flex-col rounded-modal overflow-hidden">

                        {/* Header */}
                        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-divider shrink-0">
                            {/* Product photo */}
                            <div className="w-12 h-12 rounded-2xl bg-surface-card border border-divider shadow-sm overflow-hidden shrink-0 flex items-center justify-center">
                                {historyRow.foto_url
                                    ? <img src={historyRow.foto_url} alt="" className="w-full h-full object-contain" />
                                    : <Package size={22} className="text-content-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-body font-black text-content truncate leading-tight">{historyRow.product_name}</p>
                                <p className="text-caption text-content-3 font-medium mt-0.5">{ERP_NAMES[historyRow._erp_sucursal_id]} · Historial MIN/MAX</p>
                            </div>
                            <Button variant="secondary" size="sm" icon={X} iconOnly onClick={() => setHistoryRow(null)} />
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
                            {historyLoading && (
                                <div className="flex justify-center py-10"><SkeletonText lines={4} className="w-full max-w-md" /></div>
                            )}
                            {!historyLoading && historyLogs.length === 0 && (
                                <EmptyState compact icon={History} title="Sin cambios" />
                            )}
                            {!historyLoading && historyLogs.map(log => {
                                const d = log.details || {};
                                const empPhoto = empPhotoMap[log.user_name];
                                const sucName = log.action === 'MINMAX_ZERO_ALL_BRANCHES' ? 'Toda la red' : (ERP_NAMES[d.sucursal_id] || '');
                                const meta = MINMAX_HISTORY_ACTION_META[log.action] || { label: log.action, badge: 'bg-surface-card-hover text-content-3' };
                                const dt = new Date(log.created_at);
                                const dateStr = dt.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
                                const timeStr = dt.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
                                const fmt = v => v == null ? '—' : v;
                                return (
                                    <div key={log.id} data-surface="card" className="flex items-start gap-3 px-3.5 py-3">
                                        {/* Employee avatar */}
                                        <div className="w-8 h-8 rounded-full bg-surface-card-hover border border-divider overflow-hidden shrink-0 flex items-center justify-center mt-0.5">
                                            {empPhoto
                                                ? <img src={empPhoto} alt="" className="w-full h-full object-cover" />
                                                : <span className="text-caption font-black text-content-3">{log.user_name?.charAt(0)?.toUpperCase() || '?'}</span>}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                                <span className="text-label font-bold text-content-2 truncate">{log.user_name || 'Sistema'}</span>
                                                <span className="text-micro text-content-3 shrink-0 tabular-nums">{dateStr} · {timeStr}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <Badge variant={meta.variante} size="sm" className="shrink-0">{meta.label}</Badge>
                                                <span className="text-label text-content-2 tabular-nums">
                                                    <span className="text-micro text-content-3 font-bold mr-0.5">MIN</span>
                                                    {d.old_min !== d.new_min && <span className="text-content-3">{fmt(d.old_min)} → </span>}
                                                    <strong className="text-content">{fmt(d.new_min)}</strong>
                                                </span>
                                                <span className="text-label text-content-2 tabular-nums">
                                                    <span className="text-micro text-content-3 font-bold mr-0.5">MAX</span>
                                                    {d.old_max !== d.new_max && <span className="text-content-3">{fmt(d.old_max)} → </span>}
                                                    <strong className="text-content">{fmt(d.new_max)}</strong>
                                                </span>
                                                {sucName && <span className="text-micro text-content-3 ml-auto shrink-0">{sucName}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                </div>
            </ModalShell>
            )}

            <PhotoLightbox src={zoomPhoto} alt="Foto del producto" onClose={() => setZoomPhoto(null)} zClass="z-toast" />

            {/* ── Confirm publish modal ── */}
            <ConfirmModal
                isOpen={publishConfirm.open}
                onClose={() => setPublishConfirm({ open: false, ids: null, count: 0 })}
                onConfirm={() => startDeferredPublish(publishConfirm.ids, publishConfirm.count)}
                title={`¿Publicar ${publishConfirm.count} borrador${publishConfirm.count !== 1 ? 'es' : ''}?`}
                message={`Se aplicarán los valores MIN/MAX en ${ERP_NAMES[selectedErp]}. Tendrás 5 segundos para cancelar.`}
                confirmText="Publicar"
                cancelText="Cancelar"
                isDestructive={false}
            />

            {/* ── Confirm calcular modal ── */}
            <ConfirmModal
                isOpen={calcularConfirm.open}
                onClose={() => setCalcularConfirm({ open: false, mode: null })}
                onConfirm={() => { const m = calcularConfirm.mode; setCalcularConfirm({ open: false, mode: null }); m === 'all' ? handleRecalcularAll() : handleRecalcular(); }}
                title="¿Recalcular MIN/MAX?"
                // El ALCANCE se elige acá, no con dos botones distintos afuera.
                // "Calcular esta sucursal" y "calcular todas" son la misma acción
                // con distinto alcance: dos botones gemelos obligaban a leerlos
                // enteros para ver en qué se diferencian, y el destructivo —todas—
                // quedaba a un clic sin confirmar cuál se había apretado.
                message={
                    <div className="flex flex-col gap-3 text-left">
                        <SegmentedControl
                            size="sm"
                            label="Alcance del cálculo"
                            value={calcularConfirm.mode ?? 'single'}
                            onChange={m => setCalcularConfirm(c => ({ ...c, mode: m }))}
                            options={[
                                { value: 'single', label: ERP_NAMES[selectedErp] },
                                { value: 'all',    label: 'Todas las sucursales' },
                            ]}
                        />
                        <p className="text-body font-medium leading-relaxed text-content-3">
                            {calcularConfirm.mode === 'all'
                                ? 'Se generarán nuevos borradores para todas las sucursales. Los borradores existentes no publicados serán reemplazados.'
                                : `Se generarán nuevos borradores para ${ERP_NAMES[selectedErp]}. Los borradores actuales no publicados serán reemplazados.`}
                        </p>
                    </div>
                }
                confirmText="Calcular"
                cancelText="Cancelar"
                isDestructive={false}
            />

            {/* ── Confirm discard individual draft modal ── */}
            <ConfirmModal
                isOpen={discardRowConfirm.open}
                onClose={() => setDiscardRowConfirm({ open: false, row: null })}
                onConfirm={() => { const r = discardRowConfirm.row; setDiscardRowConfirm({ open: false, row: null }); discardDraft(r); }}
                title="¿Descartar borrador?"
                message={`"${discardRowConfirm.row?.product_name ?? ''}" volverá al MIN·MAX publicado actual. Esta acción no se puede deshacer.`}
                confirmText="Descartar"
                cancelText="Cancelar"
                isDestructive={true}
            />

            {/* ── Confirm poner 0 en producto de alta rotación ── */}
            <ConfirmModal
                isOpen={zeroOutConfirm.open}
                onClose={() => setZeroOutConfirm({ open: false, row: null, pendingCell: null, pendingPair: null, pendingZeroAll: false })}
                onConfirm={() => {
                    const { row, pendingCell, pendingPair, pendingZeroAll } = zeroOutConfirm;
                    setZeroOutConfirm({ open: false, row: null, pendingCell: null, pendingPair: null, pendingZeroAll: false });
                    if (pendingZeroAll) handleZeroAllBranches(row);
                    else if (pendingCell) saveDraftCell(pendingCell, { confirmed: true });
                    else if (pendingPair) saveDraftPair(...pendingPair, { confirmed: true });
                    else zeroOutRow(row);
                }}
                title={zeroOutConfirm.pendingZeroAll ? '¿Poner 0 en red — producto de alta rotación?' : '¿Poner 0 en producto de alta rotación?'}
                message={zeroOutConfirm.pendingZeroAll
                    ? `"${zeroOutConfirm.row?.product_name ?? ''}" es clase ${zeroOutConfirm.row?.draft_abc_class || zeroOutConfirm.row?.abc_class || '?'} con ${Number(zeroOutConfirm.row?.daily_velocity ?? 0).toFixed(1)} und/día. Quedará en 0/0 en todas las sucursales y bodega. Esta acción no se puede deshacer.`
                    : `"${zeroOutConfirm.row?.product_name ?? ''}" es clase ${zeroOutConfirm.row?.draft_abc_class || zeroOutConfirm.row?.abc_class || '?'} con ${Number(zeroOutConfirm.row?.daily_velocity ?? 0).toFixed(1)} und/día. ¿Confirmar MIN·MAX en 0?`}
                confirmText={zeroOutConfirm.pendingZeroAll ? '0 en red' : 'Poner 0'}
                cancelText="Cancelar"
                isDestructive={true}
            />

            {/* ── Confirm zero all branches modal (solo clase C / sin clase) ── */}
            <ConfirmModal
                isOpen={zeroAllConfirm.open}
                onClose={() => setZeroAllConfirm({ open: false, row: null })}
                onConfirm={() => { const r = zeroAllConfirm.row; setZeroAllConfirm({ open: false, row: null }); handleZeroAllBranches(r); }}
                title="¿Poner — / — en todas las salas?"
                message={`"${zeroAllConfirm.row?.product_name ?? ''}" quedará en 0/0 en todas las sucursales y bodega. Se publicará inmediatamente. Esta acción no se puede deshacer.`}
                confirmText="0 en red"
                cancelText="Cancelar"
                isDestructive={true}
            />

            {/* ── Confirm discard all modal ── */}
            <ConfirmModal
                isOpen={discardConfirm}
                onClose={() => setDiscardConfirm(false)}
                onConfirm={handleDiscardAll}
                title={`¿Descartar ${draftCount} borrador${draftCount !== 1 ? 'es' : ''}?`}
                message={`Los valores calculados de ${ERP_NAMES[selectedErp]} se descartarán y volverán al MIN/MAX publicado actual. Esta acción no se puede deshacer.`}
                confirmText="Descartar"
                cancelText="Cancelar"
                isDestructive={true}
                isProcessing={discardingAll}
            />

            {/* ── Confirm hide filtered modal (7A.6) ── */}
            <ConfirmModal
                isOpen={hideFilteredConfirm}
                onClose={() => setHideFilteredConfirm(false)}
                onConfirm={hideFiltered}
                title={`¿Ocultar ${filtered.length} producto${filtered.length !== 1 ? 's' : ''}?`}
                message={`Los productos de "${filterLabel}" en ${ERP_NAMES[selectedErp]} quedarán ocultos con MIN/MAX en borrador 0/0. Puedes revertirlo desde el filtro de ocultos.`}
                confirmText="Ocultar"
                cancelText="Cancelar"
                isDestructive={true}
                isProcessing={hidingFiltered}
            />
        </div>
    );
}
