import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, Loader2,
    Building2, Package, X, Download, Trash2,
    CheckCircle2, Check, Info, RotateCcw, ChevronRight, History,
    TrendingUp, TrendingDown, Layers, Settings2, Save, Clock, Upload, XCircle, Eye, EyeOff, BarChart2, FlaskConical, Search, MoreHorizontal,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useAuth } from '../../context/AuthContext';
import { applyPresRule } from '../../utils/presentacion';
import { normXyz, sortedPres, smallestPres, formatUnits, formatDominant, hasDispatchRisk } from './tabminmax/helpers';
import { ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS, VISIBLE_STAT_KEYS } from './tabminmax/constants';
import CoverageBar from './tabminmax/CoverageBar';
import StockBar from './tabminmax/StockBar';
import AbcXyzBadge from './tabminmax/AbcXyzBadge';
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

// ─── Animation presets ────────────────────────────────────────────────────────
// easeOutExpo — snappy entry, silky exit. Standard for Apple/Liquid Glass UIs.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];

// Chip / pill — instant color via CSS, scale muy sutil y rápido
const chipAnim = {
    whileHover: { scale: 1.025, transition: { duration: 0.1, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.96,  transition: { duration: 0.05 } },
};
// CTA button (Calcular, Publicar)
const ctaAnim = {
    whileHover: { scale: 1.02,  transition: { duration: 0.1, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.97,  transition: { duration: 0.05 } },
};
// Icon button — easeOut consistente (sin spring underdamped que rebotaba)
const iconAnim = {
    whileHover: { scale: 1.07, transition: { duration: 0.1, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.88, transition: { duration: 0.05 } },
};
// ─── Constants ────────────────────────────────────────────────────────────────
// ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS, VISIBLE_STAT_KEYS: extraídos a
// ./tabminmax/constants.js (Bloque 6.C, continuación) — importados arriba.

// Historial MIN/MAX: label + color por tipo de acción. Todas comparten la misma
// forma de datos (old_min/old_max/new_min/new_max) — un solo render las cubre.
const MINMAX_HISTORY_ACTION_META = {
    MINMAX_LIVE_EDIT:               { label: 'EN VIVO',        badge: 'bg-emerald-50 text-emerald-600' },
    MINMAX_DRAFT_EDIT:              { label: 'BORRADOR',       badge: 'bg-amber-50 text-amber-600' },
    MINMAX_BODEGA_MANUAL_OVERRIDE:  { label: 'MANUAL BODEGA',  badge: 'bg-violet-50 text-violet-600' },
    MINMAX_BODEGA_RESET_MANUAL:     { label: 'RESTAURADO',     badge: 'bg-emerald-50 text-emerald-600' },
    MINMAX_UPDATED_FROM_PEDIDO:     { label: 'DESDE PEDIDOS',  badge: 'bg-sky-50 text-sky-600' },
    MINMAX_RESET_CALC:              { label: 'RESTAURADO',     badge: 'bg-emerald-50 text-emerald-600' },
    MINMAX_RESET_CLEAR:             { label: 'LIMPIADO',       badge: 'bg-slate-100 text-slate-500' },
    MINMAX_DISCARD_DRAFT:           { label: 'DESCARTADO',     badge: 'bg-slate-100 text-slate-500' },
    MINMAX_ZERO_OUT:                { label: 'PUESTO EN 0',    badge: 'bg-red-50 text-red-600' },
    MINMAX_LIVE_ZERO:               { label: 'PUESTO EN 0',    badge: 'bg-red-50 text-red-600' },
    MINMAX_ZERO_ALL_BRANCHES:       { label: '0 EN TODA LA RED', badge: 'bg-red-50 text-red-600' },
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
        glass, glassStyle,
        openBodegaEdit,
        openBodegaTooltip,
        closeBodegaTooltip,
    } = useMinMaxData({ searchTerm, lockedErpId });

    // ─── Render ───────────────────────────────────────────────────────────────
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
            <div className="flex items-start gap-3 flex-wrap">

                {/* LEFT: Cost cards */}
                <div className="flex items-center gap-2.5 flex-wrap">
                    {loading
                        ? <CardSkeletons isBodega={isBodega} />
                        : costSummary
                            ? <CostCards summary={costSummary} isBodega={isBodega} />
                            : null}
                    {!loading && draftCost && <DraftCostCard draftCost={draftCost} isBodega={isBodega} />}
                </div>

                <div className="flex-1" />

                {/* RIGHT: pill — glassmorphism, siempre rounded-2xl completo */}
                <div className="flex items-center shrink-0 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.07),inset_0_1px_0_rgba(255,255,255,0.92)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.11),inset_0_1px_0_rgba(255,255,255,0.95)] transition-shadow duration-300"
                     style={{
                         background: 'rgba(255,255,255,0.70)',
                         backdropFilter: 'blur(20px) saturate(180%)',
                         WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                         border: '1px solid rgba(255,255,255,0.82)',
                     }}>

                    {/* Buttons section — sin bg propio, el glass del outer cubre */}
                    <div className="flex items-center overflow-visible">

                        {/* Branch selector */}
                        {!lockedErpId && <div className="px-2 py-2 overflow-visible" style={{ width: '175px' }}>
                            <LiquidSelect
                                value={String(selectedErp)}
                                onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); setSortBy('laboratorio'); setSortDir('asc'); setFilterDraft(false); setFilterHidden(false); } }}
                                options={erpOptions} icon={Building2} clearable={false} compact
                            />
                        </div>}

                        {/* Active ABC/XYZ filter badge + clear */}
                        {(filterAbc !== 'all' || filterXyz !== 'all') && (
                            <>
                                <div className="h-5 w-px bg-slate-200/60 shrink-0" />
                                <button onClick={() => { setFilterAbc('all'); setFilterXyz('all'); setPage(1); }}
                                    className="mx-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-[11px] font-black text-blue-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors shrink-0">
                                    {filterAbc !== 'all' ? filterAbc : '·'}{filterXyz !== 'all' ? filterXyz : ''}
                                    <X size={9} strokeWidth={3} />
                                </button>
                            </>
                        )}

                        <div className="h-5 w-px bg-slate-200/60 shrink-0" />

                        {/* CSV */}
                        <motion.button onClick={async () => {
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
                        }}
                            disabled={data.length === 0 || loading}
                            title="Exportar CSV"
                            {...chipAnim}
                            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30">
                            <Download size={12} /> CSV
                        </motion.button>

                        <div className="h-5 w-px bg-slate-200/60 shrink-0" />

                        {/* Config — solo can_edit (guardar hace RLS raw error si no) */}
                        <motion.button onClick={() => setConfigOpen(o => !o)}
                            disabled={!canManage}
                            title={canManage ? 'Configurar parámetros' : 'Necesitás permiso de edición en Min/Max'}
                            {...iconAnim}
                            className={`px-3 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none ${configOpen ? 'text-[#0052CC]' : 'text-slate-500 hover:text-slate-600'}`}>
                            <Settings2 size={13} />
                        </motion.button>

                        <div className="h-5 w-px bg-slate-200/60 shrink-0" />

                        {/* Labs visibility — solo can_edit (guardar hace RLS raw error si no) */}
                        <motion.button onClick={() => setLabsOpen(o => !o)}
                            disabled={!canManage}
                            title={canManage ? 'Laboratorios ocultos en MinMax' : 'Necesitás permiso de edición en Min/Max'}
                            {...iconAnim}
                            className={`px-3 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none ${labsOpen ? 'text-[#0052CC]' : 'text-slate-500 hover:text-slate-600'}`}>
                            <FlaskConical size={13} />
                        </motion.button>

                        {!isBodega && (
                            <>
                                <div className="h-5 w-px bg-slate-200/60 shrink-0" />

                                {/* Todas las sucursales — oculto en Bodega (se actualiza sola vía trigger) */}
                                <motion.button onClick={() => setCalcularConfirm({ open: true, mode: 'all' })} disabled={!canManage || calculating || loading}
                                    title="Recalcular todas las sucursales (Bodega se actualiza sola)"
                                    {...chipAnim}
                                    className="inline-flex items-center justify-center gap-1.5 min-w-[100px] px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:pointer-events-none">
                                    {calculating && calcMode === 'all'
                                        ? <><Loader2 size={11} className="animate-spin" /> {calcProgress ? `${calcProgress.name} ${calcProgress.current}/${calcProgress.total}` : 'Calculando…'}</>
                                        : <><Layers size={11} /> Todas las sucursales</>}
                                </motion.button>
                            </>
                        )}
                    </div>

                    {/* Calcular — blue right cap (oculto para Bodega: se actualiza sola) */}
                    {!isBodega && (
                        <>
                            <div className="self-stretch w-px bg-slate-200/60 shrink-0" />
                            <motion.button onClick={() => setCalcularConfirm({ open: true, mode: 'single' })} disabled={!canManage || calculating || loading}
                                {...ctaAnim}
                                className="self-stretch inline-flex items-center justify-center gap-1.5 min-w-[110px] px-4 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 transition-colors rounded-r-2xl disabled:opacity-60 disabled:pointer-events-none">
                                {calculating && calcMode === 'single'
                                    ? <><Loader2 size={12} className="animate-spin" /> Calculando…</>
                                    : <><RefreshCw size={12} /> Calcular</>}
                            </motion.button>
                        </>
                    )}
                </div>
            </div>

            {/* ── ABC × XYZ Matrix + info strip ── */}
            {!isBodega && (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-stretch">
                    <AbcXyzMatrix
                        data={data}
                        filterAbc={filterAbc} setFilterAbc={setFilterAbc}
                        filterXyz={filterXyz} setFilterXyz={setFilterXyz}
                        loading={loading}
                    />
                    {config && <div className={`${glass} px-4 py-3 flex flex-col gap-2 text-[10px] text-slate-500 min-w-[200px]`} style={glassStyle}>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Fórmula actual</span>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-4">
                                <span className="font-semibold text-slate-600">MAX (objetivo)</span>
                                <span className="font-black text-slate-800">{cycleDays} días</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-600 inline-block" /> MIN (X)</span>
                                <span className="font-black text-slate-700">{config?.reorder_x_days ?? 7}d</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /> MIN (Y)</span>
                                <span className="font-black text-slate-500">{config?.reorder_y_days ?? 10}d</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> MIN (Z)</span>
                                <span className="font-black text-slate-500">{config?.reorder_z_days ?? 15}d</span>
                            </div>
                            <div className="h-px bg-slate-100 my-0.5" />
                            <div className="flex items-center justify-between gap-4">
                                <span>Ventana histórica</span>
                                <span className="font-bold text-slate-600">{config?.analysis_days ?? 180}d</span>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-auto pt-2 leading-snug">
                            XYZ: X≤percentil {config?.xyz_x_percentile ?? 5} · Y≤percentil {config?.xyz_y_percentile ?? 35} · Z=resto (relativo a cada sucursal)<br />
                            ABC: A&lt;{config?.abc_a_pct ?? 70}% revenue · B&lt;{config?.abc_b_pct ?? 90}%
                        </p>
                    </div>}
                </div>
            )}


            {configChanged && !calculating && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[12px] text-blue-700 font-medium">
                    <Settings2 size={13} className="shrink-0 text-blue-500" />
                    <span className="flex-1">Configuración actualizada — recalculá para que los nuevos parámetros surtan efecto.</span>
                    <button onClick={() => setCalcularConfirm({ open: true, mode: 'single' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-lg transition-colors">
                        <RefreshCw size={10} /> Recalcular ahora
                    </button>
                    <button onClick={() => setConfigChanged(false)} className="text-blue-300 hover:text-blue-500"><X size={12} /></button>
                </div>
            )}


            {!loading && neverCalc && (
                <div className={`${glass} py-16 text-center`} style={glassStyle}>
                    <Package size={36} className="opacity-30 mx-auto mb-4 text-slate-500" />
                    <p className="text-[15px] font-bold text-slate-700 mb-2">Sin datos para {ERP_NAMES[selectedErp]}</p>
                    <p className="text-[12px] text-slate-500 mb-6 max-w-sm mx-auto leading-relaxed">
                        {isBodega
                            ? 'Bodega se actualiza automáticamente cuando las sucursales publican sus MIN/MAX. Seleccioná una sucursal, calculá y publicá sus borradores.'
                            : `Haz clic en Calcular para analizar ${config?.analysis_days ?? 180} días de ventas y generar los parámetros MIN/MAX con clasificación ABC×XYZ.`}
                    </p>
                    {!isBodega && (
                        <button onClick={handleRecalcular} disabled={calculating}
                            className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-bold text-white bg-[#0052CC] rounded-xl shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60">
                            {calculating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Calcular {ERP_NAMES[selectedErp]}
                        </button>
                    )}
                </div>
            )}

            {/* ── Filter bar — single row: [filter pill] [draft+publish] [clase A] ── */}
            {!neverCalc && (
                <div className="flex items-center gap-2.5 flex-wrap">

                    {/* Left: scrollable status filter pill */}
                    <div className="overflow-x-auto min-w-0 flex-1 pb-0.5">
                    <motion.div
                        className="flex items-center rounded-2xl overflow-hidden self-start transition-shadow duration-300 w-max"
                        whileHover={{ boxShadow: '0 12px 40px rgba(0,82,204,0.11), inset 0 1px 0 rgba(255,255,255,0.95)' }}
                        style={{
                            background: 'rgba(255,255,255,0.58)',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            border: '1px solid rgba(255,255,255,0.85)',
                            boxShadow: '0 8px 32px rgba(0,82,204,0.07), inset 0 1px 0 rgba(255,255,255,0.92)',
                        }}>
                        {STAT_CFGS.filter(cfg => VISIBLE_STAT_KEYS.includes(cfg.key)).map((cfg, i) => {
                            const active = filterAlert === cfg.key;
                            return (
                                <React.Fragment key={cfg.key}>
                                    {i > 0 && <div className="h-5 w-px bg-slate-200/50 shrink-0" />}
                                    <motion.button
                                        whileTap={{ scale: 0.88, transition: { duration: 0.06 } }}
                                        onClick={() => setFilterAlert(prev => prev === cfg.key ? 'all' : cfg.key)}
                                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold select-none whitespace-nowrap backdrop-blur-sm
                                            transition-[background-color,border-color,color,box-shadow] duration-100
                                            ${active
                                                ? cfg.chipActive + ' font-bold border shadow-[0_2px_10px_rgba(0,0,0,0.09),inset_0_1px_0_rgba(255,255,255,0.88)]'
                                                : 'text-slate-500 border border-transparent hover:bg-white/55 hover:text-slate-700'}`}>
                                        <motion.span
                                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`}
                                            animate={active ? { scale: [1, 1.5, 1] } : { scale: 1 }}
                                            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                                        />
                                        <span className={`tabular-nums font-black text-[11px] ${active ? '' : 'text-slate-700'}`}>
                                            {loading ? '–' : stats[cfg.key]}
                                        </span>
                                        <span>{cfg.label}</span>
                                        <AnimatePresence>
                                        {active && (
                                            <motion.span key="x" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.5 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.13 }}>
                                                <X size={9} className="ml-0.5" />
                                            </motion.span>
                                        )}
                                        </AnimatePresence>
                                    </motion.button>
                                </React.Fragment>
                            );
                        })}

                        {/* Clase A — urgente, visible cuando hay datos publicados */}
                        {hasPublishedData && criticalACount > 0 && !loading && (
                            <>
                                <div className="h-5 w-px bg-slate-200/50 shrink-0" />
                                <motion.button
                                    whileTap={{ scale: 0.88, transition: { duration: 0.06 } }}
                                    onClick={() => { setFilterAbc(prev => prev === 'A' ? 'all' : 'A'); setPage(1); }}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold select-none whitespace-nowrap backdrop-blur-sm
                                        transition-[background-color,border-color,color,box-shadow] duration-100
                                        ${filterAbc === 'A'
                                            ? 'bg-rose-50/90 text-rose-700 font-bold border border-rose-200/70 shadow-[0_2px_10px_rgba(0,0,0,0.09),inset_0_1px_0_rgba(255,255,255,0.88)]'
                                            : 'text-slate-500 border border-transparent hover:bg-white/55 hover:text-slate-700'}`}>
                                    <AlertTriangle size={9} className={`shrink-0 ${filterAbc === 'A' ? 'text-rose-500' : 'text-rose-400'}`} />
                                    <span className="font-black">A</span>
                                    <span className="tabular-nums font-black text-[11px]">{criticalACount}</span>
                                    <AnimatePresence>
                                    {filterAbc === 'A' && (
                                        <motion.span key="x" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.5 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.13 }}>
                                            <X size={9} className="ml-0.5" />
                                        </motion.span>
                                    )}
                                    </AnimatePresence>
                                </motion.button>
                            </>
                        )}

                        {/* Revisar (pocos datos) — mismo estilo que otros chips */}
                        <AnimatePresence>
                        {sparseCount > 0 && !loading && (
                            <motion.div key="sparse" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.2, ease: EASE_OUT_EXPO }} className="flex items-center overflow-hidden shrink-0">
                                <div className="h-5 w-px bg-slate-200/50 shrink-0" />
                                <motion.button
                                    whileTap={{ scale: 0.88, transition: { duration: 0.06 } }}
                                    onClick={() => { setFilterSparse(f => !f); setFilterDraft(false); setFilterChangesOnly(false); setFilterAlert('all'); }}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold select-none whitespace-nowrap backdrop-blur-sm
                                        transition-[background-color,border-color,color,box-shadow] duration-100
                                        ${filterSparse
                                            ? 'bg-orange-50/90 text-orange-700 font-bold border border-orange-200/70 shadow-[0_2px_10px_rgba(0,0,0,0.09),inset_0_1px_0_rgba(255,255,255,0.88)]'
                                            : 'text-slate-500 border border-transparent hover:bg-white/55 hover:text-slate-700'}`}>
                                    <motion.span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${filterSparse ? 'bg-orange-400' : 'bg-orange-300'}`}
                                        animate={filterSparse ? { scale: [1, 1.5, 1] } : { scale: 1 }}
                                        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                                    />
                                    <span className={`tabular-nums font-black text-[11px] ${filterSparse ? '' : 'text-slate-700'}`}>{sparseCount}</span>
                                    <span>Revisar</span>
                                    <AnimatePresence>
                                    {filterSparse && (
                                        <motion.span key="x" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.5 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.13 }}>
                                            <X size={9} className="ml-0.5" />
                                        </motion.span>
                                    )}
                                    </AnimatePresence>
                                </motion.button>
                            </motion.div>
                        )}
                        </AnimatePresence>

                        {/* Riesgo de regla de despacho: el MAX configurado no alcanza el 40%
                            de la unidad de despacho del producto ni en el mejor caso (repunte
                            completo desde 0) — nunca va a generar un pedido real. Solo aplica
                            a sucursales de venta (Bodega no despacha "a sí misma"). */}
                        <AnimatePresence>
                        {!isBodega && dispatchRiskCount > 0 && !loading && (
                            <motion.div key="dispatch-risk" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.2, ease: EASE_OUT_EXPO }} className="flex items-center overflow-hidden shrink-0">
                                <div className="h-5 w-px bg-slate-200/50 shrink-0" />
                                <motion.button
                                    whileTap={{ scale: 0.88, transition: { duration: 0.06 } }}
                                    onClick={() => { setFilterDispatchRisk(f => !f); setFilterDraft(false); setFilterSparse(false); setFilterChangesOnly(false); setFilterAlert('all'); }}
                                    title="MAX configurado por debajo del umbral de la regla de despacho — nunca va a generar un pedido real con este valor"
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold select-none whitespace-nowrap backdrop-blur-sm
                                        transition-[background-color,border-color,color,box-shadow] duration-100
                                        ${filterDispatchRisk
                                            ? 'bg-rose-50/90 text-rose-700 font-bold border border-rose-200/70 shadow-[0_2px_10px_rgba(0,0,0,0.09),inset_0_1px_0_rgba(255,255,255,0.88)]'
                                            : 'text-slate-500 border border-transparent hover:bg-white/55 hover:text-slate-700'}`}>
                                    <motion.span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${filterDispatchRisk ? 'bg-rose-400' : 'bg-rose-300'}`}
                                        animate={filterDispatchRisk ? { scale: [1, 1.5, 1] } : { scale: 1 }}
                                        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                                    />
                                    <span className={`tabular-nums font-black text-[11px] ${filterDispatchRisk ? '' : 'text-slate-700'}`}>{dispatchRiskCount}</span>
                                    <span>Riesgo regla</span>
                                    <AnimatePresence>
                                    {filterDispatchRisk && (
                                        <motion.span key="x" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.5 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.13 }}>
                                            <X size={9} className="ml-0.5" />
                                        </motion.span>
                                    )}
                                    </AnimatePresence>
                                </motion.button>
                            </motion.div>
                        )}
                        </AnimatePresence>

                        {/* Limpiar — siempre rojo cuando hay filtro activo */}
                        <AnimatePresence>
                        {hasAnyFilter && (
                            <motion.div key="clear-all" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.15, ease: EASE_OUT_EXPO }} className="flex items-center overflow-hidden shrink-0">
                                <div className="h-5 w-px bg-rose-200/60 shrink-0" />
                                <motion.button
                                    whileTap={{ scale: 0.88, transition: { duration: 0.06 } }}
                                    onClick={clearAllFilters}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-rose-600 bg-rose-50/80 border border-rose-200/70 shadow-[0_2px_8px_rgba(244,63,94,0.10)] backdrop-blur-sm whitespace-nowrap
                                        transition-[background-color,box-shadow] duration-100 hover:bg-rose-100/80 hover:shadow-[0_2px_12px_rgba(244,63,94,0.18)]">
                                    <X size={10} strokeWidth={2.5} />
                                    Limpiar
                                </motion.button>
                            </motion.div>
                        )}
                        </AnimatePresence>

                        {/* N ocultos toggle */}
                        <AnimatePresence>
                        {hiddenIds.size > 0 && (
                            <motion.div key="hidden-toggle" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.2, ease: EASE_OUT_EXPO }} className="flex items-center overflow-hidden shrink-0">
                                <div className="h-5 w-px bg-slate-200/50 shrink-0" />
                                <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => setFilterHidden(f => !f)}
                                    className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap ${filterHidden ? 'bg-violet-50/90 text-violet-700 font-bold' : 'text-slate-500 hover:text-slate-600'}`}>
                                    <Eye size={10} className="shrink-0" />
                                    {hiddenIds.size} oculto{hiddenIds.size !== 1 ? 's' : ''}
                                    <AnimatePresence>
                                    {filterHidden && (
                                        <motion.span key="x" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.5 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.13 }}>
                                            <X size={9} className="ml-0.5" />
                                        </motion.span>
                                    )}
                                    </AnimatePresence>
                                </motion.button>
                                {filterHidden && (
                                    <>
                                        <div className="h-5 w-px bg-violet-200/60 shrink-0" />
                                        <motion.button
                                            whileTap={{ scale: 0.92 }}
                                            onClick={unhideAll}
                                            className="flex items-center gap-1 px-3 py-2.5 text-[11px] font-bold text-violet-600 hover:text-violet-800 transition-colors whitespace-nowrap">
                                            Mostrar todos
                                        </motion.button>
                                    </>
                                )}
                            </motion.div>
                        )}
                        </AnimatePresence>
                    </motion.div>
                    </div>

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
                                background: 'rgba(255,255,255,0.72)',
                                backdropFilter: 'blur(24px)',
                                WebkitBackdropFilter: 'blur(24px)',
                                border: '1px solid rgba(255,255,255,0.85)',
                                boxShadow: '0 4px 20px rgba(0,82,204,0.07), inset 0 1px 0 rgba(255,255,255,0.92)',
                            }}>
                            {/* Dot + count */}
                            <div className="flex items-center gap-1.5 px-3 py-2 shrink-0">
                                <span className="relative flex h-2 w-2 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                                </span>
                                <span className="text-[11px] font-black text-slate-800 tabular-nums">{draftCount}</span>
                                <span className="text-[10px] text-slate-500 font-medium">borrador{draftCount !== 1 ? 'es' : ''}</span>
                            </div>
                            <div className="h-4 w-px bg-slate-200/70 shrink-0" />
                            {/* Solo borradores */}
                            <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                onClick={() => { setFilterDraft(f => !f); setFilterSparse(false); setFilterChangesOnly(false); }}
                                className={`flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold transition-[background-color,color] duration-100 whitespace-nowrap ${filterDraft ? 'bg-slate-100/80 text-slate-800 font-bold' : 'text-slate-600 hover:bg-slate-100/60 hover:text-slate-800'}`}>
                                {filterDraft ? <><X size={8} strokeWidth={2.5} className="shrink-0" /> Ver todos</> : 'Solo borradores'}
                            </motion.button>
                            {/* Solo cambios */}
                            {hasPublishedData && changesCount > 0 && (
                                <>
                                    <div className="h-4 w-px bg-slate-200/70 shrink-0" />
                                    <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                        onClick={() => { setFilterChangesOnly(f => !f); setFilterDraft(false); setFilterSparse(false); }}
                                        className={`flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold transition-[background-color,color] duration-100 whitespace-nowrap ${filterChangesOnly ? 'bg-violet-100/70 text-violet-800 font-bold' : 'text-slate-600 hover:bg-slate-100/60 hover:text-slate-800'}`}>
                                        {filterChangesOnly ? <><X size={8} strokeWidth={2.5} className="shrink-0" /> Ver todos</> : `Cambios (${changesCount})`}
                                    </motion.button>
                                </>
                            )}
                            {/* Ocultar filtrados (7A.6) */}
                            {hasActiveFilter && filtered.length > 0 && (
                                <>
                                    <div className="h-4 w-px bg-slate-200/70 shrink-0" />
                                    <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                        onClick={() => setHideFilteredConfirm(true)}
                                        disabled={hidingFiltered}
                                        className="flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold text-rose-400 hover:bg-rose-50/80 hover:text-rose-600 transition-[background-color,color] duration-100 whitespace-nowrap disabled:opacity-50">
                                        {hidingFiltered ? <Loader2 size={9} className="animate-spin shrink-0" /> : <EyeOff size={9} className="shrink-0" />}
                                        Ocultar {filterLabel} ({filtered.length})
                                    </motion.button>
                                </>
                            )}
                            {/* Descartar */}
                            <>
                                <div className="h-4 w-px bg-slate-200/70 shrink-0" />
                                <motion.button whileTap={{ scale: 0.91, transition: { duration: 0.06 } }}
                                    onClick={() => setDiscardConfirm(true)}
                                    disabled={discardingAll}
                                    className="flex items-center gap-1 px-2.5 py-2 text-[10px] font-semibold text-rose-400 hover:bg-rose-50/80 hover:text-rose-600 transition-[background-color,color] duration-100 whitespace-nowrap disabled:opacity-50">
                                    {discardingAll ? <Loader2 size={9} className="animate-spin shrink-0" /> : <Trash2 size={9} className="shrink-0" />}
                                    Descartar
                                </motion.button>
                            </>
                            {/* ─ Publicar liquid glass ─ */}
                            <div className="h-4 w-px bg-amber-200/70 shrink-0 mx-0.5" />
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
                                        className="relative overflow-hidden flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold rounded-xl disabled:opacity-60 disabled:pointer-events-none whitespace-nowrap"
                                        style={{
                                            background: '#0052CC',
                                            backdropFilter: 'blur(20px) saturate(180%)',
                                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                            border: '1px solid rgba(0,52,153,0.30)',
                                            boxShadow: '0 4px 16px rgba(0,82,204,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                                            color: 'white',
                                        }}>
                                        <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12 pointer-events-none"
                                            animate={{ x: ['-160%', '160%'] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'linear', repeatDelay: 2.5 }} />
                                        {publishing ? <Loader2 size={10} className="animate-spin relative z-10" /> : <Upload size={10} className="relative z-10" />}
                                        <span className="relative z-10">Publicar {filterLabel} ({filteredDraftIds.length})</span>
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
                                        className="relative overflow-hidden flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold rounded-xl disabled:opacity-60 disabled:pointer-events-none whitespace-nowrap"
                                        style={{
                                            background: '#0052CC',
                                            backdropFilter: 'blur(20px) saturate(180%)',
                                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                            border: '1px solid rgba(0,52,153,0.30)',
                                            boxShadow: '0 4px 16px rgba(0,82,204,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                                            color: 'white',
                                        }}>
                                        <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12 pointer-events-none"
                                            animate={{ x: ['-160%', '160%'] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'linear', repeatDelay: 2.5 }} />
                                        {publishing ? <Loader2 size={10} className="animate-spin relative z-10" /> : <Upload size={10} className="relative z-10" />}
                                        <span className="relative z-10">Publicar todo ({draftCount})</span>
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
                                 background: 'rgba(255,255,255,0.72)',
                                 backdropFilter: 'blur(20px)',
                                 WebkitBackdropFilter: 'blur(20px)',
                                 border: '1px solid rgba(255,255,255,0.82)',
                                 boxShadow: '0 2px 10px rgba(109,40,217,0.05), inset 0 1px 0 rgba(255,255,255,0.92)',
                             }}>
                            <Info size={10} className="text-violet-500 shrink-0" />
                            <span className="text-[10px] text-slate-600 whitespace-nowrap">MIN/MAX = Σ sucursales publicadas</span>
                            {bodegaPendingCount > 0 ? (
                                <>
                                    <div className="h-3.5 w-px bg-slate-200/70 mx-0.5 shrink-0" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block shrink-0" />
                                    <span className="text-[10px] font-bold text-amber-700 whitespace-nowrap">{bodegaPendingCount} pendiente{bodegaPendingCount !== 1 ? 's' : ''}</span>
                                </>
                            ) : hasPublishedData ? (
                                <>
                                    <div className="h-3.5 w-px bg-slate-200/70 mx-0.5 shrink-0" />
                                    <CheckCircle2 size={9} className="text-emerald-500 shrink-0" />
                                    <span className="text-[10px] font-bold text-emerald-700 whitespace-nowrap">Al día</span>
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
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
                        <Search size={12} strokeWidth={2.5} className="shrink-0" />
                        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                    </div>
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
                    minWidth="860px"
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
                                                className={`shrink-0 relative w-7 h-7 rounded-md overflow-visible bg-slate-50/80 border border-slate-100 flex items-center justify-center ${row.foto_url ? 'cursor-zoom-in' : ''}`}
                                                onClick={row.foto_url ? e => { e.stopPropagation(); setZoomPhoto(row.foto_url); } : undefined}
                                                title={alert.label}
                                            >
                                                {row.foto_url
                                                    ? <img src={row.foto_url} alt="" className="w-full h-full object-contain rounded-md" />
                                                    : <Package size={13} className="text-slate-400" />}
                                                {row.alert_status && row.alert_status !== 'ok' && (
                                                    <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-white shadow-sm shrink-0 ${alert.dot}`} />
                                                )}
                                            </div>
                                            <div className={`shrink-0 w-4 h-4 flex items-center justify-center ${!canExpand ? 'opacity-0' : ''}`}>
                                                <ChevronRight size={12} className={`text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-[13px] font-medium text-slate-800 truncate leading-tight">{row.product_name || '—'}</span>
                                                    {row.has_manual && <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>}
                                                    {hasDraft && !isBodega && <span className="shrink-0 text-[8px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">BORRADOR</span>}
                                                    {hasDraft && isBodega && <span className="shrink-0 text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">SUC. PEND.</span>}
                                                    {dispatchRisk && <span className="shrink-0 text-[8px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full" title="El MAX actual no alcanza el umbral de la regla de despacho — este producto nunca va a generar un pedido real así">RIESGO REGLA</span>}
                                                    {isBodega && (
                                                        (hasDraft && Number(row.draft_min ?? 0) === 0 && Number(row.draft_max ?? 0) === 0) ||
                                                        (!hasDraft && Number(row.pub_min ?? 0) === 0 && Number(row.pub_max ?? 0) === 0 && row.has_manual)
                                                    ) && <span className="shrink-0 text-[8px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full" title="Retirado de MIN·MAX en todas las salas">SIN SALAS</span>}
                                                    {limitedData && (
                                                        <span title={`Solo ${row.draft_data_days} días de historial de compras (ventana: ${analysisConfig.analysis_days} días)`}
                                                            className="shrink-0 text-[8px] font-black text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full cursor-help">
                                                            {row.draft_data_days}d DATOS
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Stock actual inline */}
                                                {/* Stock + velocity — single compact row */}
                                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                    <Package size={10} className="text-slate-400 shrink-0" />
                                                    <span className="text-[11px] font-black tabular-nums text-slate-700">
                                                        {formatUnits(stock, pres)}
                                                    </span>
                                                    {!dead && minN > 0 && stock < minN && (
                                                        <span className="text-[9px] font-bold text-orange-400">↓{(minN - stock).toLocaleString()}</span>
                                                    )}
                                                    {!dead && maxN > 0 && stock > maxN && (
                                                        <span className="text-[9px] font-bold text-blue-400">↑{(stock - maxN).toLocaleString()}</span>
                                                    )}
                                                    <span className="text-slate-200 text-[10px] select-none mx-0.5">|</span>
                                                    {noHistory && (
                                                        <span className="text-[10px] text-yellow-600 font-semibold italic">Sin ventas</span>
                                                    )}
                                                    {isSparse && (
                                                        <span className="text-[10px] text-orange-600 font-semibold flex items-center gap-0.5">
                                                            <AlertTriangle size={9} />
                                                            {Number(row.units_sold_6m) >= 10
                                                                ? `Mayorista: ${Number(row.units_sold_6m).toLocaleString()} uds.`
                                                                : Number(row.units_sold_6m) > 0
                                                                    ? `${Number(row.units_sold_6m).toLocaleString()} uds. 6m`
                                                                    : 'Sin ventas'
                                                            }
                                                            {row.last_sale_date && <span className="text-orange-400 ml-0.5">· {isBodega && row.last_sale_sucursal_id ? `${ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} ` : ''}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                                                        </span>
                                                    )}
                                                    {!dead && !noHistory && !isSparse && (
                                                        <span className="text-[10px] text-slate-500 flex items-center gap-0.5 font-medium">
                                                            <BarChart2 size={9} className="text-slate-400 shrink-0" />
                                                            {v6m.toFixed(2)}/día
                                                            {v30 > 0 && v30 > v6m * 1.1 && <TrendingUp size={9} className="text-emerald-500 ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                            {v30 > 0 && v30 < v6m * 0.9 && <TrendingDown size={9} className="text-red-400 ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                            <span className="text-slate-500 mx-0.5">·</span>
                                                            {Math.round(v6m * 30)}/mes
                                                            {Number(row.units_sold_6m) > 0 && <><span className="text-slate-500 mx-0.5">·</span>{Number(row.units_sold_6m).toLocaleString()} vend.</>}
                                                            <span className="text-slate-500 mx-0.5">·</span>
                                                            {row.last_sale_date
                                                                ? <span className="font-semibold text-slate-600">{isBodega && row.last_sale_sucursal_id ? <span className="font-normal text-slate-500">{ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} · </span> : null}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                                                : <span className="text-slate-500 italic">sin venta</span>
                                                            }
                                                        </span>
                                                    )}
                                                    {(dead || noHistory) && (
                                                        <span className="text-[10px] font-semibold text-slate-500">
                                                            {row.last_sale_date
                                                                ? <><span className="text-slate-500">Últ.</span> {isBodega && row.last_sale_sucursal_id ? <span className="text-slate-500">{ERP_NAMES[row.last_sale_sucursal_id] ?? `Suc.${row.last_sale_sucursal_id}`} · </span> : null}{new Date(row.last_sale_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</>
                                                                : <span className="text-slate-500 italic">sin ventas</span>
                                                            }
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </DataCell>

                                    {/* Laboratorio */}
                                    <DataCell align="left" className="!py-2.5">
                                        <span className="text-[11px] text-slate-700 truncate block max-w-[160px]">
                                            {row.laboratorio_nombre || <span className="text-slate-500">—</span>}
                                        </span>
                                    </DataCell>

                                    {/* Clase — show draft badge when no published value yet */}
                                    <DataCell align="center" className="!py-2.5">
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
                                                            <span className="text-[8px] text-slate-500">→</span>
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
                                            const sep = <span className="text-slate-500 mx-1 select-none text-[11px]">·</span>;

                                            if (isEditMin) return (
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5">
                                                        <input autoFocus type="number" min="0"
                                                            value={inlineDraftEdit.value}
                                                            onChange={e => setInlineDraftEdit(p => ({ ...p, value: e.target.value, error: undefined }))}
                                                            onFocus={e => e.target.select()}
                                                            onBlur={() => {
                                                                if (skipBlurSave.current) { skipBlurSave.current = false; return; }
                                                                if (inlineDraftEdit.value === '') { setInlineDraftEdit(null); return; }
                                                                const err = validateEditForRow(inlineDraftEdit, row);
                                                                if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                                saveDraftCell(inlineDraftEdit);
                                                            }}
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
                                                            onClick={e => e.stopPropagation()}
                                                            className={`min-w-[36px] w-14 text-center text-[16px] font-black rounded-md px-1 py-0.5 focus:outline-none border-2 ${hasDraft ? 'text-amber-800 bg-amber-50 border-amber-400' : 'text-emerald-800 bg-emerald-50 border-emerald-400'}`} />
                                                        {sep}
                                                        <div className={`min-w-[36px] text-center text-[12px] font-black tabular-nums rounded-md border-2 border-dashed px-1 py-0.5 ${hasDraft ? 'text-blue-500 bg-blue-50 border-blue-300' : 'text-slate-500 bg-slate-50 border-slate-300'}`}>{maxN > 0 ? maxN.toLocaleString() : '—'}</div>
                                                    </div>
                                                    {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && <div className={`text-[9px] font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-amber-700' : 'text-emerald-700'}`}>≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}</div>}
                                                    {(dead || noHistory) && <div className="text-[8px] text-yellow-600 font-semibold mt-0.5">⚠ Sin ventas 6 meses</div>}
                                                </div>
                                            );

                                            if (isEditMax) return (
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className={`min-w-[36px] text-center text-[12px] font-black tabular-nums rounded-md border-2 border-dashed px-1 py-0.5 ${hasDraft ? 'text-amber-600 bg-amber-50 border-amber-400' : 'text-emerald-700 bg-emerald-50 border-emerald-400'}`}>{inlineDraftEdit.pendingMin !== undefined ? (inlineDraftEdit.pendingMin === '' ? '—' : (parseInt(inlineDraftEdit.pendingMin, 10) || 0).toLocaleString()) : ((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—')}</div>
                                                        {sep}
                                                        <input autoFocus type="number" min="0"
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
                                                                    else { if (inlineDraftEdit.value !== '') saveDraftCell(inlineDraftEdit); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: hasDraft ? ((row.draft_min > 0 || row.draft_max > 0) ? String(row.draft_min ?? 0) : '') : ((row.effective_min > 0 || row.effective_max > 0) ? String(row.effective_min ?? 0) : '') }); }
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
                                                            onClick={e => e.stopPropagation()}
                                                            className={`min-w-[36px] w-14 text-center text-[16px] font-black rounded-md px-1 py-0.5 focus:outline-none border-2 ${hasDraft ? 'text-blue-800 bg-blue-50 border-blue-400' : 'text-emerald-800 bg-emerald-50 border-emerald-400'}`} />
                                                    </div>
                                                    {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && <div className={`text-[9px] font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-blue-700' : 'text-emerald-700'}`}>≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}</div>}
                                                </div>
                                            );

                                            // ── Display (non-editing) ──
                                            // Bodega: openBodegaEdit (hook) hace fetch fresco antes de mostrar el
                                            // editor. Floor = max(min_units, draft_min) porque Bodega puede no estar
                                            // publicada pero ya tener un draft_min > 0 (Σ efectivo de sucursales via trigger).
                                            const openMinEdit = canManage ? e => { e.stopPropagation(); setExpandedId(null); if (isBodega) { openBodegaEdit(row, 'min', isBodega); return; } setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: hasDraft ? ((row.draft_min > 0 || row.draft_max > 0) ? String(row.draft_min ?? 0) : '') : ((dead || noHistory) ? '' : ((row.effective_min > 0 || row.effective_max > 0) ? String(row.effective_min ?? 0) : '')) }); } : undefined;
                                            const openMaxEdit = canManage ? e => { e.stopPropagation(); setExpandedId(null); if (isBodega) { openBodegaEdit(row, 'max', isBodega); return; } setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: hasDraft ? ((row.draft_max > 0 || row.draft_min > 0) ? String(row.draft_max ?? 0) : '') : ((dead || noHistory) ? '' : ((row.effective_max > 0 || row.effective_min > 0) ? String(row.effective_max ?? 0) : '')) }); } : undefined;

                                            const box = (val, colorCls, borderCls, clickFn) => (
                                                <div onClick={clickFn}
                                                    className={`min-w-[36px] text-center text-[12px] font-black tabular-nums rounded-md border px-1 py-0.5 transition-colors duration-100 ${colorCls} ${borderCls} ${clickFn ? 'cursor-pointer hover:brightness-95' : ''}`}>
                                                    {val}
                                                </div>
                                            );

                                            if (hasDraft) return isBodega ? (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—', stock < minN ? 'text-orange-600 bg-orange-50' : 'text-slate-600 bg-white/70', stock < minN ? 'border-orange-200' : 'border-slate-200', openMinEdit)}
                                                        {sep}
                                                        {box(maxN > 0 ? maxN.toLocaleString() : '—', stock > maxN && maxN > 0 ? 'text-blue-600 bg-blue-50' : 'text-slate-500 bg-white/70', stock > maxN && maxN > 0 ? 'border-blue-200' : 'border-slate-200', openMaxEdit)}
                                                    </div>
                                                    {row.has_manual && (row.pub_min > 0 || row.pub_max > 0 || (row.draft_min ?? 0) > 0 || (row.draft_max ?? 0) > 0) && (
                                                        <div className="text-[8px] font-semibold text-violet-500 tabular-nums">Σ {Math.max(row.pub_min ?? 0, row.draft_min ?? 0).toLocaleString()}·{Math.max(row.pub_max ?? 0, row.draft_max ?? 0).toLocaleString()}</div>
                                                    )}
                                                    <span
                                                        title="Hover para ver sucursales pendientes"
                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold text-amber-700 bg-amber-50 border border-amber-200/80 cursor-help select-none"
                                                        onMouseEnter={e => openBodegaTooltip(row.erp_product_id, e.currentTarget.getBoundingClientRect())}
                                                        onMouseLeave={closeBodegaTooltip}
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block shrink-0" />
                                                        {(row.draft_min ?? 0).toLocaleString()}·{(row.draft_max ?? 0).toLocaleString()}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((row.draft_min > 0 || row.draft_max > 0) ? (row.draft_min ?? 0).toLocaleString() : '—', 'text-amber-700 bg-amber-50', 'border-amber-200', openMinEdit)}
                                                        {sep}
                                                        {box(row.draft_max > 0 ? row.draft_max.toLocaleString() : '—', 'text-blue-700 bg-blue-50', 'border-blue-200', openMaxEdit)}
                                                    </div>
                                                    {(minN > 0 || maxN > 0) && <div className="text-[9px] text-slate-500 tabular-nums">{minN.toLocaleString()} · {maxN.toLocaleString()} act.</div>}
                                                </div>
                                            );

                                            if (isSparse) return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box((minN > 0 || maxN > 0) ? minN.toLocaleString() : '—', 'text-orange-500 bg-orange-50', 'border-dashed border-orange-300', openMinEdit)}
                                                        {sep}
                                                        {box(maxN > 0 ? maxN.toLocaleString() : '—', 'text-orange-500 bg-orange-50', 'border-dashed border-orange-300', openMaxEdit)}
                                                    </div>
                                                    <div className="text-[8px] text-orange-500 font-semibold">⚠ Confirmar</div>
                                                </div>
                                            );

                                            if ((minN === 0 && maxN === 0) || (row.effective_min === null && row.effective_max === null)) return (
                                                <div className="flex items-center gap-1">
                                                    {box('—', 'text-slate-500 bg-white/60', 'border-slate-100', openMinEdit)}
                                                    {sep}
                                                    {box('—', 'text-slate-500 bg-white/60', 'border-slate-100', openMaxEdit)}
                                                </div>
                                            );

                                            const pendingBadge = isBodega && row.has_pending_branches ? (
                                                <span
                                                    title="Hover para ver sucursales pendientes"
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold text-amber-700 bg-amber-50 border border-amber-200/80 cursor-help select-none"
                                                    onMouseEnter={e => openBodegaTooltip(row.erp_product_id, e.currentTarget.getBoundingClientRect())}
                                                    onMouseLeave={closeBodegaTooltip}
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block shrink-0" />
                                                    Suc. pendientes
                                                </span>
                                            ) : null;

                                            if (isBodega && row.has_manual && (row.pub_min > 0 || row.pub_max > 0)) return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box(minN.toLocaleString(), stock < minN ? 'text-orange-600 bg-orange-50' : 'text-slate-600 bg-white/70', stock < minN ? 'border-orange-200' : 'border-slate-200', openMinEdit)}
                                                        {sep}
                                                        {box(maxN.toLocaleString(), stock > maxN && maxN > 0 ? 'text-blue-600 bg-blue-50' : 'text-slate-500 bg-white/70', stock > maxN && maxN > 0 ? 'border-blue-200' : 'border-slate-200', openMaxEdit)}
                                                    </div>
                                                    <div className="text-[8px] font-semibold text-violet-500 tabular-nums">Σ {(row.pub_min ?? 0).toLocaleString()}·{(row.pub_max ?? 0).toLocaleString()}</div>
                                                    {pendingBadge}
                                                </div>
                                            );

                                            return (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="flex items-center gap-1">
                                                        {box(minN.toLocaleString(), stock < minN ? 'text-orange-600 bg-orange-50' : 'text-slate-600 bg-white/70', stock < minN ? 'border-orange-200' : 'border-slate-200', openMinEdit)}
                                                        {sep}
                                                        {box(maxN.toLocaleString(), stock > maxN && maxN > 0 ? 'text-blue-600 bg-blue-50' : 'text-slate-500 bg-white/70', stock > maxN && maxN > 0 ? 'border-blue-200' : 'border-slate-200', openMaxEdit)}
                                                    </div>
                                                    {pendingBadge}
                                                </div>
                                            );
                                        })()}
                                        </div>
                                    </DataCell>

                                    {/* Despacho — presentación catálogo siempre visible + regla + cantidades */}
                                    <DataCell align="center" className="!py-2 !px-2">
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
                                                    <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border leading-tight bg-slate-100 text-slate-600 border-slate-200 gap-1 whitespace-nowrap">
                                                        {baseLabel}
                                                        {ruleNote && <>
                                                            <span className="w-px h-2.5 bg-slate-300 inline-block" />
                                                            <span className="text-[9px] font-semibold text-slate-500">{ruleNote}</span>
                                                        </>}
                                                    </span>
                                                    {hasRule && hasPres && (
                                                        <span
                                                            className="text-[9px] font-semibold text-slate-500 tabular-nums"
                                                            title="MIN · MAX ya redondeado a la regla de despacho">
                                                            {applyRule(dispMin).toLocaleString()} · {applyRule(dispMax).toLocaleString()}
                                                        </span>
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
                                                await upsertStockParams(
                                                    { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending', updated_at: new Date().toISOString() }
                                                );
                                                setHidingIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; });
                                                setHiddenIds(prev => { const n = new Set(prev); n.add(row.erp_product_id); return n; });
                                                setData(prev => prev.map(r => r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                                                    ? { ...r, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r));
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
                    className="bg-white/95 backdrop-blur-md border border-amber-200 rounded-xl shadow-xl px-3 py-2 min-w-[148px]"
                >
                    <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wide mb-1.5">Sucursales pendientes</div>
                    {bodegaTooltip.pending.map(b => (
                        <div key={b.erp_sucursal_id} className="flex items-center justify-between gap-3">
                            <span className="text-[10px] text-slate-600 font-medium">{ERP_NAMES[b.erp_sucursal_id] ?? `Suc. ${b.erp_sucursal_id}`}</span>
                            <span className="text-[10px] text-amber-500 tabular-nums font-semibold">{(b.draft_min ?? 0).toLocaleString()}·{(b.draft_max ?? 0).toLocaleString()}</span>
                        </div>
                    ))}
                </div>,
                document.body
            )}

            {/* ── Toast notification (portal → fuera de backdrop-filter, siempre en viewport) ── */}
            {toast && createPortal(
                <div className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-2xl text-[13px] font-semibold animate-in slide-in-from-bottom-2 ${toast.type === 'error' ? 'bg-red-600' : 'bg-[#0052CC]'}`}>
                    {currentEmployee?.photo_url
                        ? <img src={currentEmployee.photo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-white/40" />
                        : <Info size={15} className="shrink-0" />}
                    <span>{toast.message}</span>
                    {toast.action && (
                        <button onClick={toast.action.onClick}
                            className="ml-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/35 text-[11px] font-bold transition-colors shrink-0">
                            {toast.action.label}
                        </button>
                    )}
                    <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0">
                        <X size={12} />
                    </button>
                </div>,
                document.body
            )}

            {/* ── Historial MIN/MAX ── */}
            {historyRow && createPortal(
                <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4" onClick={() => setHistoryRow(null)}>
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    {/* Card */}
                    <div className="relative z-10 w-full max-w-md max-h-[82vh] flex flex-col rounded-3xl border border-white/70 shadow-[0_32px_80px_rgba(0,0,0,0.18)] overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(40px) saturate(200%)' }}
                        onClick={e => e.stopPropagation()}>

                        {/* Header */}
                        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100/80 shrink-0">
                            {/* Product photo */}
                            <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden shrink-0 flex items-center justify-center">
                                {historyRow.foto_url
                                    ? <img src={historyRow.foto_url} alt="" className="w-full h-full object-contain" />
                                    : <Package size={22} className="text-slate-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-black text-slate-800 truncate leading-tight">{historyRow.product_name}</p>
                                <p className="text-[10px] text-slate-500 font-medium mt-0.5">{ERP_NAMES[historyRow._erp_sucursal_id]} · Historial MIN/MAX</p>
                            </div>
                            <button onClick={() => setHistoryRow(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-600 transition-colors shrink-0">
                                <X size={14} />
                            </button>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
                            {historyLoading && (
                                <div className="flex justify-center py-10">
                                    <Loader2 size={22} className="animate-spin text-slate-400" />
                                </div>
                            )}
                            {!historyLoading && historyLogs.length === 0 && (
                                <div className="flex flex-col items-center gap-2 py-10">
                                    <History size={28} className="text-slate-400" />
                                    <p className="text-[12px] text-slate-500">Sin cambios registrados aún</p>
                                </div>
                            )}
                            {!historyLoading && historyLogs.map(log => {
                                const d = log.details || {};
                                const empPhoto = empPhotoMap[log.user_name];
                                const sucName = log.action === 'MINMAX_ZERO_ALL_BRANCHES' ? 'Toda la red' : (ERP_NAMES[d.sucursal_id] || '');
                                const meta = MINMAX_HISTORY_ACTION_META[log.action] || { label: log.action, badge: 'bg-slate-100 text-slate-500' };
                                const dt = new Date(log.created_at);
                                const dateStr = dt.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
                                const timeStr = dt.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
                                const fmt = v => v == null ? '—' : v;
                                return (
                                    <div key={log.id} className="flex items-start gap-3 bg-white/70 border border-white/80 rounded-2xl px-3.5 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
                                        {/* Employee avatar */}
                                        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center mt-0.5">
                                            {empPhoto
                                                ? <img src={empPhoto} alt="" className="w-full h-full object-cover" />
                                                : <span className="text-[10px] font-black text-slate-500">{log.user_name?.charAt(0)?.toUpperCase() || '?'}</span>}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                                <span className="text-[11px] font-bold text-slate-700 truncate">{log.user_name || 'Sistema'}</span>
                                                <span className="text-[9px] text-slate-500 shrink-0 tabular-nums">{dateStr} · {timeStr}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${meta.badge}`}>{meta.label}</span>
                                                <span className="text-[11px] text-slate-600 tabular-nums">
                                                    <span className="text-[9px] text-slate-500 font-bold mr-0.5">MIN</span>
                                                    {d.old_min !== d.new_min && <span className="text-slate-500">{fmt(d.old_min)} → </span>}
                                                    <strong className="text-slate-800">{fmt(d.new_min)}</strong>
                                                </span>
                                                <span className="text-[11px] text-slate-600 tabular-nums">
                                                    <span className="text-[9px] text-slate-500 font-bold mr-0.5">MAX</span>
                                                    {d.old_max !== d.new_max && <span className="text-slate-500">{fmt(d.old_max)} → </span>}
                                                    <strong className="text-slate-800">{fmt(d.new_max)}</strong>
                                                </span>
                                                {sucName && <span className="text-[9px] text-slate-500 ml-auto shrink-0">{sucName}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Photo zoom overlay ── */}
            {zoomPhoto && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
                    onClick={() => setZoomPhoto(null)}>
                    <motion.img
                        src={zoomPhoto}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        className="max-w-[320px] max-h-[320px] rounded-2xl shadow-2xl object-contain cursor-zoom-out"
                        onClick={e => e.stopPropagation()}
                    />
                </div>,
                document.body
            )}

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
                title={calcularConfirm.mode === 'all' ? '¿Recalcular todas las sucursales?' : `¿Recalcular ${ERP_NAMES[selectedErp]}?`}
                message={calcularConfirm.mode === 'all'
                    ? 'Se generarán nuevos borradores para todas las sucursales. Los borradores existentes no publicados serán reemplazados.'
                    : `Se generarán nuevos borradores para ${ERP_NAMES[selectedErp]}. Los borradores actuales no publicados serán reemplazados.`}
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
                message={`Los productos de "${filterLabel}" en ${ERP_NAMES[selectedErp]} quedarán ocultos con MIN/MAX en borrador 0/0. Podés revertirlo desde el filtro de ocultos.`}
                confirmText="Ocultar"
                cancelText="Cancelar"
                isDestructive={true}
                isProcessing={hidingFiltered}
            />
        </div>
    );
}
