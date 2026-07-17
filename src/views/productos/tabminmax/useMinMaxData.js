// Bloque 6.C (continuación) — hook de estado/fetch extraído de TabMinMax.jsx.
// Extracción mecánica: mismos nombres, misma lógica, sin cambios de
// comportamiento. Única desviación no textual: los 2 fetchers de tooltip de
// Bodega (antes duplicados inline en el JSX) y `_openBodegaEdit` se
// consolidan aquí en `openBodegaTooltip`/`closeBodegaTooltip`/`openBodegaEdit`.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { signPhotosDeep } from '../../../utils/storageFiles';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import { smartFilter } from '../../../utils/searchUtils';
import { normXyz, hasDispatchRisk } from './helpers';
import { ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS } from './constants';
import {
    upsertStockParams, upsertStockParamsBulk, updateStockParams, updateStockParamsBulk,
    fetchStockParams, fetchStockParamsUpdates, fetchStockConfig, fetchEmployeeByEmail,
    fetchEmployeesBasic, fetchAuditLogsForProduct, effectiveMinMax,
} from '../../../data/stockParams';

const translateDbError = (msg) => {
    if (!msg) return 'Error desconocido';
    if (/statement timeout|canceling statement/i.test(msg))
        return 'La consulta tardó demasiado. Intenta nuevamente.';
    if (/row-level security/i.test(msg))
        return 'Sin permisos para esta operación.';
    if (/unique constraint/i.test(msg))
        return 'Ya existe un registro con esos datos.';
    if (/foreign key constraint/i.test(msg))
        return 'No se puede eliminar: hay registros relacionados.';
    if (/not-null constraint/i.test(msg))
        return 'Falta un campo requerido.';
    if (/check constraint/i.test(msg))
        return 'Valor fuera del rango permitido.';
    return msg;
};

// Warns (but does NOT block) when a saved value is 4× above or 4× below the calculated reference.
const warnIfOutrageous = (field, numVal, row) => {
    if (!numVal || numVal <= 0 || !row) return;
    const calcRef = field === 'min' ? (row.calc_min ?? 0) : (row.calc_max ?? 0);
    if (calcRef <= 0) return;
    const label = field === 'min' ? 'MIN' : 'MAX';
    if (numVal > calcRef * 4) {
        const mult = Math.round(numVal / calcRef);
        useToastStore.getState().showToast(
            row.product_name || 'Producto',
            `${label} ${numVal} es ${mult}× el calculado (${calcRef}). Verifica que sea correcto.`,
            'info'
        );
    } else if (numVal * 4 < calcRef) {
        const mult = Math.round(calcRef / numVal);
        useToastStore.getState().showToast(
            row.product_name || 'Producto',
            `${label} ${numVal} está ${mult}× por debajo del calculado (${calcRef}). Verifica que sea correcto.`,
            'info'
        );
    }
};

export function useMinMaxData({ searchTerm = '', lockedErpId }) {
    const [selectedErp,  setSelectedErp]  = useState(lockedErpId ?? 5);

    useEffect(() => { if (lockedErpId) setSelectedErp(lockedErpId); }, [lockedErpId]);
    const [filterAbc,    setFilterAbc]    = useState('all');
    const [filterXyz,    setFilterXyz]    = useState('all');
    const [filterAlert,  setFilterAlert]  = useState('all');
    const [data,         setData]         = useState([]);
    const [costSummary,  setCostSummary]  = useState(null);
    const [draftCost,    setDraftCost]    = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [calculating,  setCalculating]  = useState(false);
    const [calcMode,     setCalcMode]     = useState('single'); // 'single' | 'all'
    const [calcProgress, setCalcProgress] = useState(null); // { current, total, name }
    const [expandedId,   setExpandedId]   = useState(null);
    const [zoomPhoto,    setZoomPhoto]    = useState(null);
    const [configOpen,   setConfigOpen]   = useState(false);
    const [labsOpen,     setLabsOpen]     = useState(false);
    const [sortBy,       setSortBy]       = useState('laboratorio');
    const [sortDir,      setSortDir]      = useState('asc');
    const [page,         setPage]         = useState(1);
    const [pageSize,     setPageSize]     = useState(25);
    const [publishing,   setPublishing]   = useState(false);
    const [filterDraft,       setFilterDraft]       = useState(false);
    const [filterSparse,      setFilterSparse]      = useState(false);
    const [filterDispatchRisk, setFilterDispatchRisk] = useState(false);
    const [hidingIds,         setHidingIds]         = useState(new Set());
    const [filterChangesOnly, setFilterChangesOnly] = useState(false);
    const [filterHidden,      setFilterHidden]      = useState(false);
    const [hiddenIds,       setHiddenIds]       = useState(new Set());
    const publishTimer     = useRef(null);
    const skipBlurSave     = useRef(false);
    const [publishConfirm,  setPublishConfirm]  = useState({ open: false, ids: null, count: 0 });
    const [discardConfirm,  setDiscardConfirm]  = useState(false);
    const [zeroAllConfirm,  setZeroAllConfirm]  = useState({ open: false, row: null });
    const [calcularConfirm, setCalcularConfirm] = useState({ open: false, mode: null });
    const [discardRowConfirm, setDiscardRowConfirm] = useState({ open: false, row: null });
    const [zeroOutConfirm,  setZeroOutConfirm]  = useState({ open: false, row: null, pendingCell: null, pendingPair: null, pendingZeroAll: false });
    const [discardingAll,  setDiscardingAll]  = useState(false);
    const [hideFilteredConfirm, setHideFilteredConfirm] = useState(false);
    const [hidingFiltered,      setHidingFiltered]      = useState(false);
    const [analysisConfig, setAnalysisConfig] = useState({ analysis_days: 180, approaching_pct: 20 });
    const analysisConfigRef = useRef({ analysis_days: 180, approaching_pct: 20 });
    useEffect(() => { analysisConfigRef.current = analysisConfig; }, [analysisConfig]);

    // Cleanup publish timer on unmount
    useEffect(() => () => clearTimeout(publishTimer.current), []);

    // hiddenIds se carga desde is_hidden en get_stock_analysis al hacer loadData
    const [configChanged,   setConfigChanged]   = useState(false);
    const [inlineDraftEdit, setInlineDraftEdit] = useState(null); // { productId, sucursalId, field:'min'|'max', value, error? }
    const [toast,           setToast]           = useState(null); // { message, type }
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const [historyRow,      setHistoryRow]      = useState(null);
    const [historyLogs,     setHistoryLogs]     = useState([]);
    const [historyLoading,  setHistoryLoading]  = useState(false);
    const [empPhotoMap,     setEmpPhotoMap]     = useState({});
    const [bodegaTooltip,   setBodegaTooltip]   = useState(null); // { productId, pending:[{erp_sucursal_id,draft_min,draft_max}], rect }
    const tooltipCancelRef = useRef(null); // cancela async in-flight si el mouse se va antes de que resuelva
    const loadRef = useRef(0);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4500);
        return () => clearTimeout(t);
    }, [toast]);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user?.email) return;
            fetchEmployeeByEmail(user.email)
                .then(async ({ data: emp }) => { if (emp) { await signPhotosDeep(emp); setCurrentEmployee(emp); } });
        });
    }, []);

    const toggleExpand = useCallback((id) => {
        setExpandedId(prev => prev === id ? null : id);
    }, []);

    useEffect(() => {
        if (!expandedId) return;
        // Wait for the height animation to finish (350ms), then scroll the panel into view
        const t = setTimeout(() => {
            document.querySelector(`[data-expand-row="${expandedId}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 380);
        return () => clearTimeout(t);
    }, [expandedId]);

    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true); setInlineDraftEdit(null); setExpandedId(null);
        try {
            // Una sola llamada JSON (Patrón C): el patrón anterior de count +
            // chunks con .range() RE-EJECUTABA get_stock_analysis una vez por
            // chunk — ~6 ejecuciones por load. El wrapper devuelve todo de un
            // solo, sin el cap de 1000 filas (json_agg, no jsonb_agg: 0.4s vs
            // 1.9s server-side por el spill a disco del jsonb de 4.6MB).
            const [rowsRes, costRes, draftRes, cfgRes] = await Promise.all([
                supabase.rpc('get_stock_analysis_jsonb',   { p_erp_sucursal_id: erpId }),
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: erpId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: erpId }),
                fetchStockConfig(),
            ]);
            if (rowsRes.error) throw rowsRes.error;
            if (costRes.error) throw costRes.error;
            if (rid !== loadRef.current) return;
            const mapped = (rowsRes.data || []).map(r => ({ ...r, _erp_sucursal_id: erpId }));
            setData(mapped);
            setHiddenIds(new Set(mapped.filter(r => r.is_hidden).map(r => r.erp_product_id)));
            setCostSummary(costRes.data  || null);
            setDraftCost(draftRes.data   || null);
            if (cfgRes.data) setAnalysisConfig(cfgRes.data);
        } catch (e) {
            if (rid === loadRef.current) useToastStore.getState().showToast(ERP_NAMES[erpId] ?? 'MinMax', translateDbError(e.message), 'error');
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); setFilterChangesOnly(false); setFilterDraft(false); setFilterSparse(false); }, [selectedErp, loadData]);

    // Sync de bodega: actualización quirúrgica de la fila inline cuando otro
    // usuario/el trigger escribe bodega. No recarga toda la tabla — solo
    // parchea el producto afectado en el estado local (preserva scroll y
    // cualquier edición en curso en otras filas).
    //
    // Antes era postgres_changes (push instantáneo) — se cambió a polling
    // por `updated_at` (Bloque 4.3): product_stock_params concentraba el
    // 99.8% del costo de decode de WAL de toda la publicación realtime
    // (~25% del CPU de la DB), y esta era su única suscripción real en todo
    // el proyecto (verificado: ningún otro archivo se conecta a este canal).
    // El polling solo trae LAS FILAS QUE CAMBIARON desde la última consulta
    // (`updated_at > cursor`, con índice por erp_sucursal_id) y les aplica
    // el mismo parche de arriba — el usuario nota como máximo POLL_MS de
    // demora en vez de instantáneo, pero el mecanismo de actualización es
    // idéntico (no full-reload).
    useEffect(() => {
        if (selectedErp !== 6) return;
        const POLL_MS = 5000;
        let cancelled = false;
        let cursor = new Date().toISOString();
        let cursorProductId = 0; // keyset: (updated_at, erp_product_id) — ver fetchStockParamsUpdates (B-1)

        const poll = async () => {
            const { data: rows, error } = await fetchStockParamsUpdates(6, cursor, cursorProductId);
            if (cancelled || error || !rows?.length) return;
            const last = rows[rows.length - 1];
            cursor = last.updated_at;
            cursorProductId = last.erp_product_id;

            const apMult = 1 + (analysisConfigRef.current.approaching_pct ?? 20) / 100;
            const byId = new Map(rows.map(u => [u.erp_product_id, u]));
            setData(prev => prev.map(row => {
                const u = byId.get(row.erp_product_id);
                if (!u) return row;
                const pubMin  = u.min_units  ?? 0;
                const pubMax  = u.max_units  ?? 0;
                const effMin  = effectiveMinMax(u.min_units, u.manual_min) ?? 0;
                const effMax  = effectiveMinMax(u.max_units, u.manual_max) ?? 0;
                const hasManual = u.manual_min !== null || u.manual_max !== null;
                const stock = Number(row.current_stock ?? 0);
                const alertStatus =
                    stock === 0                         ? 'out_of_stock' :
                    stock < effMin                      ? 'below_min'    :
                    stock < effMin * apMult             ? 'approaching'  :
                    effMax > 0 && stock > effMax        ? 'overstocked'  : 'ok';
                return { ...row, effective_min: effMin, effective_max: effMax,
                    pub_min: pubMin, pub_max: pubMax, has_manual: hasManual,
                    draft_status: u.draft_status ?? 'none',
                    draft_min: u.draft_min ?? null, draft_max: u.draft_max ?? null,
                    alert_status: alertStatus };
            }));
        };

        const timer = setInterval(poll, POLL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [selectedErp]);

    const fmtCalcError = msg => {
        if (!msg) return 'Error al calcular.';
        if (/timeout|canceling statement/i.test(msg))
            return 'El cálculo tardó demasiado. Intentá recalcular por sucursal en vez de todas a la vez.';
        return `Error al calcular: ${msg}`;
    };

    const handleRecalcular = async () => {
        const wasPublished = hasPublishedData;
        setCalculating(true); setCalcMode('single'); setConfigChanged(false);
        try {
            const { data: res, error: e } = await supabase.rpc('calculate_stock_params', { p_erp_sucursal_id: selectedErp });
            if (e) throw e;
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `${(res?.rows ?? 0).toLocaleString()} borradores generados`, 'success');
            await loadData(selectedErp);
            if (wasPublished) { setFilterChangesOnly(true); setFilterDraft(false); }
        } catch (e) { useToastStore.getState().showToast(ERP_NAMES[selectedErp], fmtCalcError(e.message), 'error'); }
        finally { setCalculating(false); }
    };

    const handleRecalcularAll = async () => {
        const wasPublished = hasPublishedData;
        setCalculating(true); setCalcMode('all'); setConfigChanged(false);
        const ids = ERP_ORDER.filter(id => id !== 6); // Bodega se actualiza sola vía trigger + publish_stock_params
        let totalRows = 0;
        const failed = [];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            setCalcProgress({ current: i + 1, total: ids.length, name: ERP_NAMES[id] });
            try {
                const { data: res, error: e } = await supabase.rpc('calculate_stock_params', { p_erp_sucursal_id: id });
                if (e) throw e;
                totalRows += res?.rows ?? 0;
            } catch {
                failed.push(ERP_NAMES[id]);
            }
        }
        setCalcProgress(null);
        if (failed.length > 0) {
            useToastStore.getState().showToast('Calcular', `Error en: ${failed.join(', ')}`, 'error');
        } else {
            useToastStore.getState().showToast('Todas las sucursales', `${totalRows.toLocaleString()} borradores generados`, 'success');
        }
        await loadData(selectedErp);
        if (wasPublished) { setFilterChangesOnly(true); setFilterDraft(false); }
        setCalculating(false);
    };

    const {
        hasPublishedData, draftCount, sparseCount, changesCount,
        bodegaPendingCount, dispatchRiskCount,
        stats,
        criticalACount,
    } = useMemo(() => {
        const statCounts = Object.fromEntries(STAT_CFGS.map(s => [s.key, 0]));
        let hasPublished = false, drafts = 0, sparse = 0, changes = 0, bPending = 0, dispatchRisk = 0;
        let firstCalc = null, firstDraftCalc = null;
        let critA = 0, critAOut = 0, critABelow = 0;
        for (const r of data) {
            // Los ocultos nunca aparecen en la tabla filtrada (filteredBase los excluye
            // incondicionalmente) — si se cuentan acá, el badge "N borradores" queda
            // desincronizado del filtro "Solo borradores" (ej. "1 borrador" pero 0 resultados).
            if (r.is_hidden) continue;
            if (r.published_by != null) hasPublished = true;
            if (r.draft_status === 'pending') {
                if (r._erp_sucursal_id === 6) {
                    bPending++;
                } else {
                    drafts++;
                    if (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max) changes++;
                }
            }
            if (r.draft_status === 'sparse_data') sparse++;
            if (r.alert_status in statCounts) statCounts[r.alert_status]++;
            if (hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo)) dispatchRisk++;
            if (!firstCalc && r.calculated_at && !r.is_dead_stock) firstCalc = r.calculated_at;
            if (!firstDraftCalc && r.draft_status === 'pending' && r.draft_calculated_at) firstDraftCalc = r.draft_calculated_at;
            if (r.abc_class === 'A') {
                if (r.alert_status === 'out_of_stock' || r.alert_status === 'below_min') critA++;
                if (r.alert_status === 'out_of_stock') critAOut++;
                if (r.alert_status === 'below_min') critABelow++;
            }
        }
        return {
            hasPublishedData: hasPublished,
            draftCount: drafts, sparseCount: sparse, changesCount: changes,
            bodegaPendingCount: bPending, dispatchRiskCount: dispatchRisk,
            stats: statCounts,
            lastCalcAt: firstCalc, lastDraftCalcAt: firstDraftCalc,
            criticalACount: critA, criticalAOut: critAOut, criticalABelow: critABelow,
        };
    }, [data]);

    const calcAlertStatus = (stock, effMin, effMax) => {
        const s  = Number(stock ?? 0);
        const mn = Number(effMin ?? 0);
        const mx = Number(effMax ?? 0);
        if (s === 0) return 'out_of_stock';
        if (mn > 0 && s < mn) return 'below_min';
        const mult = 1 + (analysisConfigRef.current.approaching_pct ?? 20) / 100;
        if (mn > 0 && s < mn * mult) return 'approaching';
        if (mx > 0 && s > mx) return 'overstocked';
        return 'ok';
    };

    const zeroOutRow = useCallback(async (row) => {
        if (hasPublishedData && row.draft_status !== 'pending') {
            const { error: e } = await upsertStockParams(
                { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, min_units: 0, max_units: 0, updated_at: new Date().toISOString() }
            );
            if (!e) {
                setData(prev => prev.map(r =>
                    r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                        ? { ...r, effective_min: 0, effective_max: 0 } : r
                ));
            }
            useStaff.getState().appendAuditLog('MINMAX_LIVE_ZERO', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: row._erp_sucursal_id,
                old_min: row.effective_min ?? 0, old_max: row.effective_max ?? 0,
                new_min: 0, new_max: 0,
            });
        } else {
            const { error: e } = await upsertStockParams(
                { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, draft_min: 0, draft_max: 0, draft_status: 'pending', updated_at: new Date().toISOString() }
            );
            if (!e) {
                setData(prev => prev.map(r =>
                    r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                        ? { ...r, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r
                ));
            }
            useStaff.getState().appendAuditLog('MINMAX_ZERO_OUT', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: row._erp_sucursal_id,
                old_min: row.draft_min ?? row.effective_min ?? 0, old_max: row.draft_max ?? row.effective_max ?? 0,
                new_min: 0, new_max: 0,
            });
        }
    }, [hasPublishedData]);

    const handleZeroAllBranches = useCallback(async (row) => {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.rpc('zero_out_product_all_branches', {
            p_erp_product_id: row.erp_product_id,
            p_published_by: user?.email ?? null,
        });
        if (error) {
            useToastStore.getState().showToast(row.product_name, error.message || 'Error al ejecutar', 'error');
            return;
        }
        setData(prev => prev.map(r =>
            r.erp_product_id === row.erp_product_id
                ? { ...r, min_units: 0, max_units: 0, draft_min: null, draft_max: null, draft_status: 'none', has_manual: false, effective_min: 0, effective_max: 0 }
                : r
        ));
        useToastStore.getState().showToast(row.product_name, 'Retirado de MIN·MAX en todas las salas', 'success');
        useStaff.getState().appendAuditLog('MINMAX_ZERO_ALL_BRANCHES', String(row.erp_product_id), {
            field: 'min+max', product: row.product_name,
            new_min: 0, new_max: 0,
        });
    }, []);

    const saveDraftCell = useCallback(async (edit, opts = {}) => {
        if (!edit) return;
        const numVal = edit.value === '' ? null : parseInt(edit.value, 10);
        if (Number.isNaN(numVal) && edit.value !== '') { setInlineDraftEdit(null); return; }
        const targetRow = data.find(r => r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId);

        // Confirmar si el valor pasa de >0 a 0 en producto clase A/B (salvo que ya fue confirmado)
        if (!opts.confirmed && numVal === 0) {
            const cls = targetRow?.draft_abc_class || targetRow?.abc_class;
            const curVal = edit.field === 'min'
                ? (targetRow?.draft_min ?? targetRow?.effective_min ?? 0)
                : (targetRow?.draft_max ?? targetRow?.effective_max ?? 0);
            if ((cls === 'A' || cls === 'B') && curVal > 0) {
                setInlineDraftEdit(null);
                setZeroOutConfirm({ open: true, row: targetRow, pendingCell: edit, pendingPair: null });
                return;
            }
        }
        const rowHasDraft  = targetRow?.draft_status === 'pending';
        const rowIsSparse  = targetRow?.draft_status === 'sparse_data';
        const saveLive = hasPublishedData && !rowHasDraft && !rowIsSparse;

        setInlineDraftEdit(null);

        // Bodega: siempre guarda en manual_min/manual_max (los draft son auto-gestionados por el trigger)
        if (targetRow?._erp_sucursal_id === 6) {
            const currentEffective = edit.field === 'min' ? (targetRow?.effective_min ?? 0) : (targetRow?.effective_max ?? 0);
            if (numVal === currentEffective) return; // Valor sin cambio — evita marcar como manual innecesariamente
            // Segunda línea de defensa: re-valida el floor (edit.bodegaPubMin/Max viene del fetch fresco de openBodegaEdit)
            const floor = edit.field === 'min' ? (edit.bodegaPubMin ?? targetRow?.pub_min ?? 0) : (edit.bodegaPubMax ?? targetRow?.pub_max ?? 0);
            if (floor > 0 && numVal < floor) {
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto',
                    `${edit.field === 'min' ? 'MIN' : 'MAX'} de Bodega no puede ser menor a la Σ sucursales (${floor.toLocaleString()})`, 'error');
                return;
            }
            const col    = edit.field === 'min' ? 'manual_min' : 'manual_max';
            const effCol = edit.field === 'min' ? 'effective_min' : 'effective_max';
            // Modelo aditivo: guardar el DELTA (excedente sobre el sum de sucursales).
            // effective = sum + delta. Si no hay excedente (numVal === floor), delta = null.
            const delta = numVal - floor;
            const deltaToStore = delta > 0 ? delta : null;
            const { error: e } = await upsertStockParams(
                { erp_product_id: edit.productId, erp_sucursal_id: 6, [col]: deltaToStore, updated_at: new Date().toISOString() }
            );
            if (e) { useToastStore.getState().showToast(targetRow?.product_name || 'Producto', e.message || 'Error al guardar', 'error'); return; }
            const newMinEff = edit.field === 'min' ? (numVal ?? 0) : (targetRow?.effective_min ?? 0);
            const newMaxEff = edit.field === 'max' ? (numVal ?? 0) : (targetRow?.effective_max ?? 0);
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== edit.productId || r._erp_sucursal_id !== 6) return r;
                return { ...r, [effCol]: numVal ?? 0, has_manual: deltaToStore !== null, alert_status: calcAlertStatus(r.current_stock, newMinEff, newMaxEff) };
            }));
            // Historial: siempre MIN+MAX juntos (estado completo, no el campo suelto) —
            // así una entrada sola alcanza para reconstruir el antes/después real.
            useStaff.getState().appendAuditLog('MINMAX_BODEGA_MANUAL_OVERRIDE', String(edit.productId), {
                field: 'min+max', product: targetRow?.product_name, sucursal_id: 6,
                old_min: targetRow?.effective_min ?? 0, old_max: targetRow?.effective_max ?? 0,
                new_min: newMinEff, new_max: newMaxEff,
                delta_min: edit.field === 'min' ? deltaToStore : (targetRow?.manual_min ?? null),
                delta_max: edit.field === 'max' ? deltaToStore : (targetRow?.manual_max ?? null),
                pub_sum_min: edit.field === 'min' ? floor : (targetRow?.pub_min ?? 0),
                pub_sum_max: edit.field === 'max' ? floor : (targetRow?.pub_max ?? 0),
            });
            return;
        }

        if (saveLive) {
            const col    = edit.field === 'min' ? 'min_units'    : 'max_units';
            const effCol = edit.field === 'min' ? 'effective_min' : 'effective_max';
            const newMin = edit.field === 'min' ? numVal : (targetRow?.effective_min ?? null);
            const newMax = edit.field === 'max' ? numVal : (targetRow?.effective_max ?? null);
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== edit.productId || r._erp_sucursal_id !== edit.sucursalId) return r;
                return { ...r, [effCol]: numVal, draft_status: 'none', alert_status: calcAlertStatus(r.current_stock, newMin, newMax) };
            }));
            const { error: e } = await upsertStockParams(
                { erp_product_id: edit.productId, erp_sucursal_id: edit.sucursalId, [col]: numVal, draft_status: 'none', draft_min: null, draft_max: null, updated_at: new Date().toISOString() }
            );
            if (e) {
                setData(prev => prev.map(r => r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId ? targetRow : r));
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', e.message || 'Error al guardar', 'error');
                return;
            }
            Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: edit.sucursalId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: edit.sucursalId }),
            ]).then(([{ data: cost }, { data: draft }]) => {
                if (cost)  setCostSummary(cost);
                if (draft) setDraftCost(draft);
            });
            useStaff.getState().appendAuditLog('MINMAX_LIVE_EDIT', String(edit.productId), {
                field: 'min+max', product: targetRow?.product_name, sucursal_id: edit.sucursalId,
                old_min: targetRow?.effective_min ?? 0, old_max: targetRow?.effective_max ?? 0,
                new_min: newMin ?? 0, new_max: newMax ?? 0,
            });
            warnIfOutrageous(edit.field, numVal, targetRow);
        } else {
            const col = edit.field === 'min' ? 'draft_min' : 'draft_max';
            const newMin = edit.field === 'min' ? numVal : (targetRow?.draft_min ?? targetRow?.effective_min ?? null);
            const newMax = edit.field === 'max' ? numVal : (targetRow?.draft_max ?? targetRow?.effective_max ?? null);
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== edit.productId || r._erp_sucursal_id !== edit.sucursalId) return r;
                return { ...r, [col]: numVal, draft_status: 'pending', alert_status: calcAlertStatus(r.current_stock, newMin, newMax) };
            }));
            const { error: e } = await upsertStockParams(
                { erp_product_id: edit.productId, erp_sucursal_id: edit.sucursalId, [col]: numVal, draft_status: 'pending', updated_at: new Date().toISOString() }
            );
            if (e) {
                setData(prev => prev.map(r => r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId ? targetRow : r));
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', e.message || 'Error al guardar', 'error');
                return;
            }
            Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: edit.sucursalId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: edit.sucursalId }),
            ]).then(([{ data: cost }, { data: draft }]) => {
                if (cost)  setCostSummary(cost);
                if (draft) setDraftCost(draft);
            });
            useStaff.getState().appendAuditLog('MINMAX_DRAFT_EDIT', String(edit.productId), {
                field: 'min+max', product: targetRow?.product_name, sucursal_id: edit.sucursalId,
                old_min: targetRow?.draft_min ?? targetRow?.effective_min ?? 0,
                old_max: targetRow?.draft_max ?? targetRow?.effective_max ?? 0,
                new_min: newMin ?? 0, new_max: newMax ?? 0,
            });
            warnIfOutrageous(edit.field, numVal, targetRow);
        }
    }, [data, hasPublishedData]);

    // Guarda MIN y MAX en una sola llamada a la BD (par atómico).
    const saveDraftPair = useCallback(async (productId, sucursalId, minValue, maxValue, productName, opts = {}) => {
        const minNum = minValue === '' ? null : parseInt(minValue, 10);
        const maxNum = maxValue === '' ? null : parseInt(maxValue, 10);
        if ((Number.isNaN(minNum) && minValue !== '') || (Number.isNaN(maxNum) && maxValue !== '')) return;
        const targetRow = data.find(r => r.erp_product_id === productId && r._erp_sucursal_id === sucursalId);

        // Confirmar si ambos quedan en 0 y el producto es clase A/B y antes tenía valores
        if (!opts.confirmed && (minNum === 0 || minNum === null) && (maxNum === 0 || maxNum === null)) {
            const cls = targetRow?.draft_abc_class || targetRow?.abc_class;
            const hadMin = (targetRow?.draft_min ?? targetRow?.effective_min ?? 0) > 0;
            const hadMax = (targetRow?.draft_max ?? targetRow?.effective_max ?? 0) > 0;
            if ((cls === 'A' || cls === 'B') && (hadMin || hadMax)) {
                setZeroOutConfirm({ open: true, row: targetRow, pendingCell: null, pendingPair: [productId, sucursalId, minValue, maxValue, productName] });
                return;
            }
        }

        // Bodega: par MIN+MAX siempre a manual_min/manual_max
        if (targetRow?._erp_sucursal_id === 6) {
            if (minNum === (targetRow?.effective_min ?? 0) && maxNum === (targetRow?.effective_max ?? 0)) return; // Sin cambio
            // Floor: targetRow.pub_min ya fue actualizado por _openBodegaEdit antes de que el usuario pudiera editar
            const floorMin = targetRow?.pub_min ?? 0;
            const floorMax = targetRow?.pub_max ?? 0;
            if (floorMin > 0 && (minNum ?? 0) < floorMin) {
                useToastStore.getState().showToast(productName || 'Producto', `MIN de Bodega no puede ser menor a la Σ sucursales (${floorMin.toLocaleString()})`, 'error');
                return;
            }
            if (floorMax > 0 && (maxNum ?? 0) < floorMax) {
                useToastStore.getState().showToast(productName || 'Producto', `MAX de Bodega no puede ser menor a la Σ sucursales (${floorMax.toLocaleString()})`, 'error');
                return;
            }
            // Modelo aditivo: guardar DELTA = total ingresado − sum sucursales.
            const deltaMin = minNum - floorMin;
            const deltaMax = maxNum - floorMax;
            const deltaMinStore = deltaMin > 0 ? deltaMin : null;
            const deltaMaxStore = deltaMax > 0 ? deltaMax : null;
            const { error: e } = await upsertStockParams({ erp_product_id: productId, erp_sucursal_id: 6, manual_min: deltaMinStore, manual_max: deltaMaxStore, updated_at: new Date().toISOString() });
            if (e) { useToastStore.getState().showToast(productName || 'Producto', e.message || 'Error al guardar', 'error'); return; }
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== productId || r._erp_sucursal_id !== 6) return r;
                return { ...r, effective_min: minNum ?? 0, effective_max: maxNum ?? 0, has_manual: deltaMinStore !== null || deltaMaxStore !== null, alert_status: calcAlertStatus(r.current_stock, minNum, maxNum) };
            }));
            useStaff.getState().appendAuditLog('MINMAX_BODEGA_MANUAL_OVERRIDE', String(productId), {
                field: 'min+max', product: productName, sucursal_id: 6,
                old_min: targetRow?.effective_min ?? 0, old_max: targetRow?.effective_max ?? 0,
                new_min: minNum, new_max: maxNum,
                delta_min: deltaMinStore, delta_max: deltaMaxStore,
                pub_sum_min: floorMin, pub_sum_max: floorMax,
            });
            return;
        }

        const rowHasDraft = targetRow?.draft_status === 'pending';
        const rowIsSparse = targetRow?.draft_status === 'sparse_data';
        const saveLive = hasPublishedData && !rowHasDraft && !rowIsSparse;
        // Safety cross-validation: max must be > min when both are positive
        if (minNum > 0 && maxNum > 0 && minNum >= maxNum) {
            useToastStore.getState().showToast(productName || 'Producto', 'MAX debe ser mayor al MIN', 'error');
            return;
        }
        if (saveLive) {
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== productId || r._erp_sucursal_id !== sucursalId) return r;
                return { ...r, effective_min: minNum, effective_max: maxNum, draft_status: 'none', alert_status: calcAlertStatus(r.current_stock, minNum, maxNum) };
            }));
            const { error: e } = await upsertStockParams({ erp_product_id: productId, erp_sucursal_id: sucursalId, min_units: minNum, max_units: maxNum, draft_status: 'none', draft_min: null, draft_max: null, updated_at: new Date().toISOString() });
            if (e) {
                setData(prev => prev.map(r => r.erp_product_id === productId && r._erp_sucursal_id === sucursalId ? targetRow : r));
                useToastStore.getState().showToast(productName || 'Producto', e.message || 'Error al guardar', 'error'); return;
            }
        } else {
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== productId || r._erp_sucursal_id !== sucursalId) return r;
                return { ...r, draft_min: minNum, draft_max: maxNum, draft_status: 'pending', alert_status: calcAlertStatus(r.current_stock, minNum, maxNum) };
            }));
            const { error: e } = await upsertStockParams({ erp_product_id: productId, erp_sucursal_id: sucursalId, draft_min: minNum, draft_max: maxNum, draft_status: 'pending', updated_at: new Date().toISOString() });
            if (e) {
                setData(prev => prev.map(r => r.erp_product_id === productId && r._erp_sucursal_id === sucursalId ? targetRow : r));
                useToastStore.getState().showToast(productName || 'Producto', e.message || 'Error al guardar', 'error'); return;
            }
        }
        Promise.all([
            supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: sucursalId }),
            supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: sucursalId }),
        ]).then(([{ data: cost }, { data: draft }]) => {
            if (cost) setCostSummary(cost);
            if (draft) setDraftCost(draft);
        });
        useStaff.getState().appendAuditLog(saveLive ? 'MINMAX_LIVE_EDIT' : 'MINMAX_DRAFT_EDIT', String(productId), {
            field: 'min+max', product: productName,
            old_min: saveLive ? (targetRow?.effective_min ?? 0) : (targetRow?.draft_min ?? targetRow?.effective_min ?? 0),
            old_max: saveLive ? (targetRow?.effective_max ?? 0) : (targetRow?.draft_max ?? targetRow?.effective_max ?? 0),
            new_min: minNum, new_max: maxNum, sucursal_id: sucursalId,
        });
        warnIfOutrageous('min', minNum, targetRow);
        warnIfOutrageous('max', maxNum, targetRow);
    }, [data, hasPublishedData]);

    const unhideProduct = useCallback(async (productId) => {
        await updateStockParams(productId, selectedErp, { is_hidden: false, updated_at: new Date().toISOString() });
        setHiddenIds(prev => { const n = new Set(prev); n.delete(productId); return n; });
        setData(prev => prev.map(r => r.erp_product_id === productId ? { ...r, is_hidden: false } : r));
        useStaff.getState().appendAuditLog('MINMAX_UNHIDE', String(productId), { sucursal_id: selectedErp });
    }, [selectedErp]);

    const unhideAll = useCallback(async () => {
        const ids = [...hiddenIds];
        if (!ids.length) return;
        await updateStockParamsBulk(ids, selectedErp, { is_hidden: false, updated_at: new Date().toISOString() });
        setHiddenIds(new Set());
        setData(prev => prev.map(r => ids.includes(r.erp_product_id) ? { ...r, is_hidden: false } : r));
        setFilterHidden(false);
        useStaff.getState().appendAuditLog('MINMAX_UNHIDE_ALL', 'batch', { count: ids.length, sucursal_id: selectedErp });
    }, [hiddenIds, selectedErp]);

    const resetToCalc = useCallback(async (row) => {
        // Bodega: "Restaurar" significa limpiar el override manual → vuelve a Σ sucursales automáticamente
        if (row._erp_sucursal_id === 6) {
            if (!row.has_manual) return;
            const { error: e } = await updateStockParams(row.erp_product_id, 6, { manual_min: null, manual_max: null, updated_at: new Date().toISOString() });
            if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${e.message}`, 'error'); return; }
            // Re-leer desde DB: pub_min local puede ser stale si sucursales publicaron después del último fetch
            const { data: fresh } = await fetchStockParams(row.erp_product_id, 6, 'min_units, max_units, draft_min, draft_max, draft_status');
            const newEff    = fresh?.min_units ?? fresh?.draft_min ?? 0;
            const newEffMax = fresh?.max_units ?? fresh?.draft_max ?? 0;
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== row.erp_product_id || r._erp_sucursal_id !== 6) return r;
                return { ...r,
                    effective_min: newEff, effective_max: newEffMax,
                    has_manual: false,
                    pub_min: Math.max(fresh?.min_units ?? 0, fresh?.draft_min ?? 0), pub_max: Math.max(fresh?.max_units ?? 0, fresh?.draft_max ?? 0),
                    draft_min: fresh?.draft_min ?? null, draft_max: fresh?.draft_max ?? null,
                    draft_status: fresh?.draft_status ?? 'none',
                    alert_status: calcAlertStatus(r.current_stock, newEff, newEffMax),
                };
            }));
            useToastStore.getState().showToast(row.product_name, 'Manual eliminado — Bodega vuelve a Σ sucursales', 'success');
            useStaff.getState().appendAuditLog('MINMAX_BODEGA_RESET_MANUAL', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: 6,
                old_min: row.effective_min ?? 0, old_max: row.effective_max ?? 0,
                new_min: newEff, new_max: newEffMax,
                restored_min: newEff, restored_max: newEffMax,
            });
            return;
        }
        if (row.calc_min == null && row.calc_max == null) {
            // Sin valores calculados: limpia borrador y manual dejando -- (null)
            const { error: e } = await updateStockParams(row.erp_product_id, row._erp_sucursal_id,
                { draft_min: null, draft_max: null, draft_status: 'none', manual_min: null, manual_max: null, updated_at: new Date().toISOString() });
            if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${e.message}`, 'error'); return; }
            setData(prev => prev.map(r =>
                r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                    ? { ...r, draft_min: null, draft_max: null, draft_status: 'none', manual_min: null, manual_max: null, has_manual: false, effective_min: null, effective_max: null, alert_status: calcAlertStatus(r.current_stock, null, null) } : r
            ));
            useToastStore.getState().showToast(row.product_name, 'Valores limpiados a —', 'success');
            useStaff.getState().appendAuditLog('MINMAX_RESET_CLEAR', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: row._erp_sucursal_id,
                old_min: row.draft_min ?? row.effective_min ?? 0, old_max: row.draft_max ?? row.effective_max ?? 0,
                new_min: null, new_max: null,
            });
            return;
        }
        const cMin = row.calc_min ?? 0;
        const cMax = row.calc_max ?? 0;
        const saveLive = hasPublishedData && row.draft_status !== 'pending';
        const upsertData = saveLive
            ? { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, min_units: cMin, max_units: cMax, manual_min: null, manual_max: null, updated_at: new Date().toISOString() }
            : { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, draft_min: cMin, draft_max: cMax, draft_status: 'pending', updated_at: new Date().toISOString() };
        const { error: e } = await upsertStockParams(upsertData);
        if (e) { useToastStore.getState().showToast(row.product_name, `Error al restaurar: ${e.message}`, 'error'); return; }
        setData(prev => prev.map(r => {
            if (r.erp_product_id !== row.erp_product_id || r._erp_sucursal_id !== row._erp_sucursal_id) return r;
            const newAlert = calcAlertStatus(r.current_stock, cMin, cMax);
            return saveLive
                ? { ...r, effective_min: cMin, effective_max: cMax, has_manual: false, alert_status: newAlert }
                : { ...r, draft_min: cMin, draft_max: cMax, draft_status: 'pending', alert_status: newAlert };
        }));
        useToastStore.getState().showToast(row.product_name, `Restaurado a MIN ${cMin} / MAX ${cMax} (calculado)`, 'success');
        useStaff.getState().appendAuditLog('MINMAX_RESET_CALC', String(row.erp_product_id), {
            field: 'min+max', product: row.product_name, sucursal_id: row._erp_sucursal_id, mode: saveLive ? 'live' : 'draft',
            old_min: saveLive ? (row.effective_min ?? 0) : (row.draft_min ?? row.effective_min ?? 0),
            old_max: saveLive ? (row.effective_max ?? 0) : (row.draft_max ?? row.effective_max ?? 0),
            new_min: cMin, new_max: cMax,
            calc_min: cMin, calc_max: cMax,
        });
    }, [hasPublishedData]);

    // Descarta el borrador de un producto individual: revierte draft al valor publicado actual.
    const discardDraft = useCallback(async (row) => {
        const revertMin = row.effective_min ?? 0;
        const revertMax = row.effective_max ?? 0;
        const { error: e } = await updateStockParams(row.erp_product_id, row._erp_sucursal_id,
            { draft_min: revertMin, draft_max: revertMax, draft_status: 'none', updated_at: new Date().toISOString() });
        if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${e.message}`, 'error'); return; }
        setData(prev => prev.map(r =>
            r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                ? { ...r, draft_min: revertMin, draft_max: revertMax, draft_status: 'none' } : r
        ));
        useStaff.getState().appendAuditLog('MINMAX_DISCARD_DRAFT', String(row.erp_product_id), {
            field: 'min+max', product: row.product_name, sucursal_id: row._erp_sucursal_id,
            old_min: row.draft_min ?? 0, old_max: row.draft_max ?? 0,
            new_min: revertMin, new_max: revertMax,
        });
    }, []);

    // Descarta todos los borradores de la sucursal actual usando el RPC discard_stock_drafts.
    const handleDiscardAll = useCallback(async () => {
        setDiscardingAll(true);
        const { data: count, error: e } = await supabase.rpc('discard_stock_drafts', { p_erp_sucursal_id: selectedErp });
        setDiscardingAll(false);
        setDiscardConfirm(false);
        if (e) { useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Error al descartar: ${e.message}`, 'error'); return; }
        useToastStore.getState().showToast(ERP_NAMES[selectedErp], `${count ?? 0} borradores descartados`, 'success');
        useStaff.getState().appendAuditLog('MINMAX_DISCARD_ALL', String(selectedErp), { sucursal: ERP_NAMES[selectedErp], count });
        await loadData(selectedErp);
    }, [selectedErp, loadData]);


    const openHistory = useCallback(async (row) => {
        setHistoryRow(row);
        setHistoryLogs([]);
        setHistoryLoading(true);
        // Toda acción que cambia MIN/MAX de este producto — incluye Bodega manual,
        // ediciones desde Pedidos y los "0 en red" (que no llevan sucursal_id propio
        // porque tocan TODAS las sucursales a la vez, por eso van con .or() aparte).
        const [{ data: logs }, { data: emps }] = await Promise.all([
            fetchAuditLogsForProduct([
                'MINMAX_LIVE_EDIT', 'MINMAX_DRAFT_EDIT',
                'MINMAX_BODEGA_MANUAL_OVERRIDE', 'MINMAX_BODEGA_RESET_MANUAL',
                'MINMAX_UPDATED_FROM_PEDIDO',
                'MINMAX_RESET_CALC', 'MINMAX_RESET_CLEAR', 'MINMAX_DISCARD_DRAFT',
                'MINMAX_ZERO_OUT', 'MINMAX_LIVE_ZERO', 'MINMAX_ZERO_ALL_BRANCHES',
                'MINMAX_REQUEST_APPROVED',
            ], row.erp_product_id, row._erp_sucursal_id),
            fetchEmployeesBasic(),
        ]);
        const photoMap = {};
        await signPhotosDeep(emps || []);
        (emps || []).forEach(e => { if (e.name) photoMap[e.name] = e.photo_url; });
        setHistoryLogs(logs || []);
        setEmpPhotoMap(photoMap);
        setHistoryLoading(false);
    }, []);

    const requestPublish = useCallback((ids = null) => {
        const count = ids ? ids.length : draftCount;
        setPublishConfirm({ open: true, ids: ids ?? null, count });
    }, [draftCount]);

    const handlePublish = useCallback(async (productIds = null) => {
        setPublishing(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const rpcParams = { p_erp_sucursal_id: selectedErp, p_published_by: user?.email ?? null };
            if (productIds) rpcParams.p_erp_product_ids = productIds;
            const { data: res, error: e } = await supabase.rpc('publish_stock_params', rpcParams);
            if (e) throw e;
            useStaff.getState().appendAuditLog('MINMAX_PUBLISH', String(selectedErp), {
                sucursal: ERP_NAMES[selectedErp],
                sucursal_id: selectedErp,
                published_by: user?.email ?? null,
                published_count: res?.published,
                scope: productIds ? 'selective' : 'all',
                product_ids: productIds ?? null,
            });
            await loadData(selectedErp);
            const n = res?.published ?? 0;
            const label = productIds ? `${n} producto${n !== 1 ? 's' : ''}` : `${n.toLocaleString()} borradores`;
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Publicó ${label} exitosamente`, 'success');
        } catch (e) { useToastStore.getState().showToast('Error al publicar', e.message, 'error'); }
        finally { setPublishing(false); }
    }, [selectedErp, loadData]);

    const startDeferredPublish = useCallback((ids, count) => {
        setPublishConfirm({ open: false, ids: null, count: 0 });
        const label = count === 1 ? 'borrador' : 'borradores';
        setToast({
            message: `Publicando ${count} ${label} en 5 s…`,
            type: 'info',
            action: {
                label: 'Cancelar',
                onClick: () => { clearTimeout(publishTimer.current); setToast(null); },
            },
        });
        publishTimer.current = setTimeout(async () => {
            setToast(null);
            await handlePublish(ids ?? undefined);
        }, 5000);
    }, [handlePublish]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const hasActiveFilter = filterAbc !== 'all' || filterXyz !== 'all' || filterAlert !== 'all' || searchTerm !== '';
    const hasAnyFilter    = hasActiveFilter || filterDraft || filterSparse || filterChangesOnly || filterDispatchRisk;
    const clearAllFilters = useCallback(() => {
        setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all');
        setFilterDraft(false); setFilterSparse(false); setFilterChangesOnly(false); setFilterDispatchRisk(false);
    }, []);
    const isBodega      = selectedErp === 6;
    const neverCalc     = data.length > 0 && data.filter(d => !d.is_catalog_only).every(d => d.is_dead_stock || d.alert_status === 'no_data');

    const filteredBase = useMemo(() => {
        if (filterHidden) return data.filter(r => hiddenIds.has(r.erp_product_id));
        return data.filter(r => {
            if (hiddenIds.has(r.erp_product_id))                                                                             return false;
            if (filterSparse && r.draft_status !== 'sparse_data')                                                            return false;
            if (filterDraft && r.draft_status !== 'pending')                                                                 return false;
            if (filterChangesOnly && !(r.draft_status === 'pending' && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max))) return false;
            if (filterDispatchRisk && !hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo))          return false;
            if (r.is_catalog_only && filterAlert !== 'no_data' && !searchTerm)                                               return false;
            if (filterAbc !== 'all' && (r.draft_abc_class || r.abc_class) !== filterAbc)                                    return false;
            if (filterXyz !== 'all' && normXyz(r.draft_demand_variability || r.demand_variability) !== filterXyz)           return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert)                                                     return false;
            return true;
        });
    }, [data, filterAbc, filterXyz, filterAlert, searchTerm, filterDraft, filterSparse, filterChangesOnly, filterDispatchRisk, hiddenIds, filterHidden]);

    const { filtered, isSearchFuzzy, searchHiddenByFilter } = useMemo(() => {
        if (!searchTerm) return { filtered: filteredBase, isSearchFuzzy: false, searchHiddenByFilter: false };
        const { results, isFuzzy } = smartFilter(
            searchTerm, filteredBase,
            r => [r.product_name, r.laboratorio_nombre]
        );
        // Si 0 resultados Y hay filtro de categoría activo, verificar si existen fuera del filtro
        const hasCategoryFilter = filterAbc !== 'all' || filterXyz !== 'all' || filterAlert !== 'all';
        const hiddenByFilter = hasCategoryFilter && results.length === 0 &&
            smartFilter(searchTerm, data.filter(r => !hiddenIds.has(r.erp_product_id)), r => [r.product_name, r.laboratorio_nombre]).results.length > 0;
        return { filtered: results, isSearchFuzzy: isFuzzy, searchHiddenByFilter: hiddenByFilter };
    }, [filteredBase, searchTerm, filterAbc, filterXyz, filterAlert, data, hiddenIds]);

    const filteredDraftIds = useMemo(
        () => hasActiveFilter ? filtered.filter(r => r.draft_status === 'pending').map(r => r.erp_product_id) : [],
        [filtered, hasActiveFilter]
    );

    // 7A.6: bulk-hide de todo lo filtrado — botón en la toolbar con
    // ConfirmModal (mismo patrón que "Descartar"), ver hideFilteredConfirm.
    const hideFiltered = useCallback(async () => {
        if (!filtered.length) return;
        setHidingFiltered(true);
        try {
            const ids = filtered.map(r => r.erp_product_id);
            // upsert en vez de update para que dead-stock products (sin fila en product_stock_params) también queden ocultos
            await upsertStockParamsBulk(
                ids.map(id => ({
                    erp_product_id: id,
                    erp_sucursal_id: selectedErp,
                    is_hidden: true,
                    draft_min: 0,
                    draft_max: 0,
                    draft_status: 'pending',
                    updated_at: new Date().toISOString(),
                }))
            );
            setHiddenIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
            setData(prev => prev.map(r =>
                ids.includes(r.erp_product_id) && r._erp_sucursal_id === selectedErp
                    ? { ...r, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r
            ));
            useStaff.getState().appendAuditLog('MINMAX_HIDE_FILTERED', 'batch', { count: ids.length, sucursal_id: selectedErp });
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Ocultó ${ids.length} producto${ids.length !== 1 ? 's' : ''}`, 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error al ocultar', e.message, 'error');
        } finally {
            setHidingFiltered(false);
            setHideFilteredConfirm(false);
        }
    }, [filtered, selectedErp]);
    const filterLabel = useMemo(() => {
        if (filterAbc !== 'all' && filterXyz === 'all' && filterAlert === 'all' && !searchTerm) return `Clase ${filterAbc}`;
        if (filterAlert !== 'all' && filterAbc === 'all' && filterXyz === 'all' && !searchTerm) return ALERT[filterAlert]?.label ?? filterAlert;
        if (searchTerm && filterAbc === 'all' && filterXyz === 'all' && filterAlert === 'all') return `"${searchTerm}"`;
        return 'Filtrados';
    }, [filterAbc, filterXyz, filterAlert, searchTerm]);

    const handleSort = useCallback((key) => {
        setSortBy(prev => {
            if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir('asc');
            return key;
        });
        setPage(1);
    }, []);

    const sorted = useMemo(() => {
        if (!sortBy) return filtered;
        return [...filtered].sort((a, b) => {
            let av, bv;
            if (sortBy === 'product_name')  { av = a.product_name || ''; bv = b.product_name || ''; }
            else if (sortBy === 'laboratorio') { av = a.laboratorio_nombre || ''; bv = b.laboratorio_nombre || ''; }
            else if (sortBy === 'abc_xyz') {
                av = `${a.draft_abc_class || a.abc_class || 'D'}${normXyz(a.draft_demand_variability || a.demand_variability)}`;
                bv = `${b.draft_abc_class || b.abc_class || 'D'}${normXyz(b.draft_demand_variability || b.demand_variability)}`;
            }
            else if (sortBy === 'current_stock') { av = Number(a.current_stock); bv = Number(b.current_stock); }
            else if (sortBy === 'coverage') {
                av = a.daily_velocity > 0 ? Number(a.current_stock) / Number(a.daily_velocity) : Infinity;
                bv = b.daily_velocity > 0 ? Number(b.current_stock) / Number(b.daily_velocity) : Infinity;
            }
            else if (sortBy === 'effective_min') { av = Number(a.effective_min); bv = Number(b.effective_min); }
            else if (sortBy === 'effective_max') { av = Number(a.effective_max); bv = Number(b.effective_max); }
            else if (sortBy === 'revenue_6m')    { av = Number(a.revenue_6m);    bv = Number(b.revenue_6m);    }
            else if (sortBy === 'ventas')        { av = Number(a.daily_velocity); bv = Number(b.daily_velocity); }
            else return 0;
            if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv, 'es') : bv.localeCompare(av, 'es');
            return sortDir === 'asc' ? av - bv : bv - av;
        });
    }, [filtered, sortBy, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows   = sorted.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => { setPage(1); }, [filterAbc, filterXyz, filterAlert, searchTerm, sortBy, sortDir, selectedErp, filterDraft, filterSparse, filterDispatchRisk, filterHidden]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    const COLS = [
        { key: 'product_name',  label: 'Producto',    align: 'left',   sortable: true, className: 'w-[30%]' },
        { key: 'laboratorio',   label: 'Laboratorio', align: 'left',   sortable: true, className: 'w-[18%]' },
        { key: 'abc_xyz',       label: 'Clase',       align: 'center', sortable: true, className: 'w-14' },
        { key: 'effective_min', label: 'MIN · MAX',   align: 'center', sortable: true, className: 'w-[150px]' },
        { key: 'presentacion',  label: 'Presentación', align: 'center', className: 'w-[130px]' },
        { key: 'acciones',      label: 'Acciones',    align: 'center', className: 'w-20' },
    ];

    const glass = 'rounded-2xl border border-white/60 backdrop-blur-sm';
    const glassStyle = { background: 'rgba(255,255,255,0.38)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' };

    // ── Bodega: editar celda (consolidado — antes `_openBodegaEdit`, definida
    // inline dentro de cada fila renderizada en el JSX) ──────────────────────
    const openBodegaEdit = useCallback(async (row, field, isBodegaCtx) => {
        const hasDraft  = row.draft_status === 'pending';
        const dead      = row.is_dead_stock;
        const noHistory = row.alert_status === 'no_data';
        const { data: fresh } = await fetchStockParams(row.erp_product_id, 6, 'min_units, max_units, draft_min, draft_max');
        const freshFloorMin = Math.max(fresh?.min_units ?? 0, fresh?.draft_min ?? 0);
        const freshFloorMax = Math.max(fresh?.max_units ?? 0, fresh?.draft_max ?? 0);
        if (freshFloorMin !== (row.pub_min ?? 0) || freshFloorMax !== (row.pub_max ?? 0)) {
            setData(prev => prev.map(r =>
                r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === 6
                    ? { ...r, pub_min: freshFloorMin, pub_max: freshFloorMax }
                    : r
            ));
        }
        const toastMsg = (freshFloorMin > 0 || freshFloorMax > 0)
            ? `Σ sucursales: MIN ${freshFloorMin.toLocaleString()} · MAX ${freshFloorMax.toLocaleString()} — ingresá el total de bodega (sum + excedente).`
            : 'Sin MIN/MAX en salas. Ingresá el excedente que debe quedar en bodega.';
        useToastStore.getState().showToast('Bodega', toastMsg, 'info');
        setInlineDraftEdit({
            productId: row.erp_product_id, sucursalId: row._erp_sucursal_id,
            field,
            value: (hasDraft && !isBodegaCtx) ? String(field === 'min' ? (row.draft_min ?? '') : (row.draft_max ?? '')) : ((dead || noHistory) ? '' : String(field === 'min' ? (row.effective_min ?? '') : (row.effective_max ?? ''))),
            bodegaPubMin: freshFloorMin,
            bodegaPubMax: freshFloorMax,
        });
    }, []);

    // ── Bodega: tooltip de sucursales pendientes (consolidado — antes 2
    // bloques onMouseEnter idénticos, duplicados inline en el JSX) ──────────
    const openBodegaTooltip = useCallback(async (productId, rect) => {
        if (bodegaTooltip?.productId === productId) return;
        tooltipCancelRef.current?.();
        let cancelled = false;
        tooltipCancelRef.current = () => { cancelled = true; };
        const { data: branches } = await supabase.rpc('get_product_branch_summary', { p_erp_product_id: productId });
        if (cancelled) return;
        const pending = (branches || []).filter(b => b.erp_sucursal_id !== 6 && b.draft_status === 'pending');
        setBodegaTooltip({ productId, pending, rect });
    }, [bodegaTooltip]);

    const closeBodegaTooltip = useCallback(() => {
        tooltipCancelRef.current?.();
        setBodegaTooltip(null);
    }, []);

    return {
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
    };
}
