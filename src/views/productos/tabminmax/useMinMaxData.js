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
import { ERP_NAMES, ERP_ORDER, ALERT, STAT_CFGS, AJUSTE_CFGS } from './constants';
import {
    upsertStockParams, upsertStockParamsReturning, upsertStockParamsBulk, updateStockParams, updateStockParamsBulk,
    fetchAjustesManuales,
    fetchStockParams, fetchStockParamsUpdates, fetchStockConfig, fetchEmployeeByEmail,
    fetchEmployeesBasic, fetchAuditLogsForProduct, effectiveMinMaxPair,
} from '../../../data/stockParams';
import { fetchSolicitudesDeProducto } from '../../../data/minmaxRequests';

// Warns (but does NOT block) when a saved value is 4× above or 4× below the calculated reference.
import { mensajeAmigable } from '../../../utils/errorMessages';
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

/**
 * En cuál de los cuatro estados está un ajuste puesto por una persona.
 *
 * `a_mano` es el más flojo y los otros tres son SELLADOS: vienen de una
 * solicitud aprobada o de un motivo declarado. Esa separación es la misma que
 * hace el freno de publicar, y hasta el 2026-09-04 no existía acá: bastaba
 * `manual_at` + un borrador distinto para gritar EN CONFLICTO, o sea que
 * cualquier fila que alguien tocó alguna vez y que el cálculo vuelve a proponer
 * salía marcada. En Salud 2 eran **59 de 65 filas**, y un indicador que marca
 * casi todo no indica nada.
 *
 * (La otra mitad de ese arreglo está en la base: publicar ahora limpia
 * `manual_at`, así que la firma describe el número de HOY y no cualquier cosa
 * que se hizo hace tres meses. Eran 926 filas arrastrando una firma vieja.)
 *
 * El orden importa: «volvió a moverse» gana sobre «en conflicto» porque dice
 * algo más fuerte —el motivo que se declaró dejó de ser cierto— y quien lo mire
 * va a querer resolver eso antes que el desacuerdo de números.
 */
export const estadoAjuste = (r) => {
    if (!r?._manual_at) return null;

    // Sin sello, la fila sólo dice «este número lo puso una persona y todavía no
    // se publicó encima». Es información, no una decisión pendiente: el cálculo
    // del mes que viene la va a reemplazar como a cualquier otra.
    if (!r._ajuste_solicitud_id && !r._manual_motivo) return 'a_mano';

    // El motivo era «ya no rota» y el producto volvió a venderse después de que
    // alguien lo dijera. `last_sale_date` es una fecha sin hora: se compara
    // contra el DÍA del ajuste para no hacerla retroceder al leerla como UTC.
    if (r._manual_motivo === 'ya_no_rota' && r.last_sale_date) {
        const diaAjuste = String(r._manual_at).slice(0, 10);
        if (String(r.last_sale_date).slice(0, 10) > diaAjuste) return 'volvio_a_moverse';
    }

    // El cálculo propone algo distinto de lo que quedó vigente. Puede venir de
    // un borrador sin publicar o del último valor calculado.
    const hayBorradorDistinto = r.draft_status === 'pending'
        && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max);
    const calculoDistinto = r.calc_min != null
        && (r.calc_min !== r.effective_min || r.calc_max !== r.effective_max);
    if (hayBorradorDistinto || calculoDistinto) return 'en_conflicto';

    return 'respetado';
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
    const [filterAjuste,      setFilterAjuste]      = useState('all');   // all | en_conflicto | volvio_a_moverse | respetado | any
    const [motivoRow,         setMotivoRow]         = useState(null);
    const [guardandoMotivo,   setGuardandoMotivo]   = useState(false);
    const [filterHidden,      setFilterHidden]      = useState(false);
    const [hiddenIds,       setHiddenIds]       = useState(new Set());
    const publishTimer     = useRef(null);
    const skipBlurSave     = useRef(false);
    const [publishConfirm,  setPublishConfirm]  = useState({
        open: false, ids: null, count: 0, modo: 'todos',
        idsTodos: [], idsSinAjuste: [], ajustadas: 0, ajustePor: null, ajusteAt: null,
    });
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
    const [historySolicitudes, setHistorySolicitudes] = useState([]);
    // La fila cuyo MAX no alcanza la regla de despacho, mientras se mira su
    // detalle. Vive acá y no en el JSX porque este hook es donde está TODO el
    // estado de la vista — `TabMinMax.jsx` quedó sólo con el render.
    const [reglaRow,       setReglaRow]       = useState(null);
    const [aplicandoRegla, setAplicandoRegla] = useState(false);
    const [historyLoading,  setHistoryLoading]  = useState(false);
    const [empPhotoMap,     setEmpPhotoMap]     = useState({});
    const [bodegaTooltip,   setBodegaTooltip]   = useState(null); // { productId, pending:[{erp_sucursal_id,draft_min,draft_max}], rect }
    const tooltipCancelRef = useRef(null); // cancela async in-flight si el mouse se va antes de que resuelva
    const loadRef = useRef(0);

    // F3.2 — get_inventory_cost_summary + get_draft_cost_estimate se disparaban
    // las DOS en cada celda guardada: ~200 ms de base de datos por edición, y
    // editando con el teclado (Enter salta de fila) eso es una ráfaga. Los dos
    // recalculan un total de la SUCURSAL, así que solo importa el último: se
    // debouncean. El tiempo se elige para que el total ya esté actualizado
    // cuando alguien deja de teclear y mira el encabezado.
    const costTimer = useRef(null);
    const refreshCosts = useCallback((sucursalId) => {
        if (costTimer.current) clearTimeout(costTimer.current);
        costTimer.current = setTimeout(() => {
            costTimer.current = null;
            Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: sucursalId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: sucursalId }),
            ]).then(([{ data: cost }, { data: draft }]) => {
                if (cost)  setCostSummary(cost);
                if (draft) setDraftCost(draft);
            });
        }, 900);
    }, []);

    useEffect(() => () => { if (costTimer.current) clearTimeout(costTimer.current); }, []);

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
            // Los ajustes a mano van aparte del RPC grande: agregarle columnas
            // obliga a recrearlo entero (cambia el tipo de retorno) y es la
            // consulta más pesada de la vista. Son pocas filas y las cubre
            // `idx_psp_manual_at`.
            const [rowsRes, costRes, draftRes, cfgRes, ajustesRes] = await Promise.all([
                supabase.rpc('get_stock_analysis_jsonb',   { p_erp_sucursal_id: erpId }),
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: erpId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: erpId }),
                fetchStockConfig(),
                fetchAjustesManuales(erpId),
            ]);
            if (rowsRes.error) throw rowsRes.error;
            if (costRes.error) throw costRes.error;
            if (rid !== loadRef.current) return;
            const ajustes = new Map((ajustesRes?.data || []).map(a => [a.erp_product_id, a]));
            const mapped = (rowsRes.data || []).map(r => {
                const a = ajustes.get(r.erp_product_id);
                return {
                    ...r,
                    _erp_sucursal_id: erpId,
                    _manual_at:     a?.manual_at     ?? null,
                    _manual_por:    a?.manual_por    ?? null,
                    _manual_motivo: a?.manual_motivo ?? null,
                    _manual_nota:   a?.manual_nota   ?? null,
                    _manual_cliente_unidades: a?.manual_cliente_unidades ?? null,
                    _manual_cliente_dias:     a?.manual_cliente_dias     ?? null,
                    // Lo que FRENA a la publicación y al recálculo: una solicitud
                    // aprobada. `manual_at` sólo dice que alguien tocó la fila —
                    // corregir un borrador durante la revisión del mes es trabajo
                    // de ese ciclo, no una excepción permanente.
                    _ajuste_solicitud_id: a?.ajuste_solicitud_id ?? null,
                };
            });
            setData(mapped);
            setHiddenIds(new Set(mapped.filter(r => r.is_hidden).map(r => r.erp_product_id)));
            setCostSummary(costRes.data  || null);
            setDraftCost(draftRes.data   || null);
            if (cfgRes.data) setAnalysisConfig(cfgRes.data);
        } catch (e) {
            if (rid === loadRef.current) useToastStore.getState().showToast(ERP_NAMES[erpId] ?? 'MinMax', mensajeAmigable(e), 'error');
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
                const efPar   = effectiveMinMaxPair(u);
                const effMin  = efPar.min ?? 0;
                const effMax  = efPar.max ?? 0;
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

    // El timeout tiene consejo propio (recalcular de a una sucursal), así que se
    // resuelve acá; todo lo demás baja al traductor canónico, que nunca deja
    // pasar el texto crudo de Postgres.
    const fmtCalcError = err => {
        const crudo = typeof err === 'string' ? err : (err?.message || '');
        if (/timeout|canceling statement/i.test(crudo))
            return 'El cálculo tardó demasiado. Intenta recalcular por sucursal en vez de todas a la vez.';
        return mensajeAmigable(err, 'No se pudo calcular. Intenta de nuevo.');
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
        } catch (e) { useToastStore.getState().showToast(ERP_NAMES[selectedErp], fmtCalcError(e), 'error'); }
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
        stats, ajusteStats, ajusteCount,
        criticalACount,
    } = useMemo(() => {
        const statCounts = Object.fromEntries(STAT_CFGS.map(s => [s.key, 0]));
        const ajusteCounts = Object.fromEntries(AJUSTE_CFGS.map(a => [a.key, 0]));
        let ajustadas = 0;
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
            const est = estadoAjuste(r);
            if (est) { ajustadas++; ajusteCounts[est]++; }
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
            ajusteStats: ajusteCounts, ajusteCount: ajustadas,
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
        // Ya no hace falta pedir el usuario: la RPC resuelve published_by con
        // auth.email() (F4.2), asi que este getUser() era un round-trip para nada.
        const { error } = await supabase.rpc('zero_out_product_all_branches', {
            p_erp_product_id: row.erp_product_id,
        });
        if (error) {
            useToastStore.getState().showToast(row.product_name, mensajeAmigable(error), 'error');
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
            // F2.6: `.select()` de vuelta para poder registrar el delta que NO se
            // editó. get_stock_analysis no devuelve manual_min/manual_max, así que
            // el `targetRow?.manual_min` de abajo era SIEMPRE undefined y el log
            // guardaba null en la mitad no tocada del par.
            const { data: guardada, error: e } = await upsertStockParamsReturning(
                { erp_product_id: edit.productId, erp_sucursal_id: 6, [col]: deltaToStore, updated_at: new Date().toISOString() },
                'manual_min, manual_max, min_units, max_units'
            );
            if (e) { useToastStore.getState().showToast(targetRow?.product_name || 'Producto', mensajeAmigable(e), 'error'); return; }
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
                delta_min: edit.field === 'min' ? deltaToStore : (guardada?.manual_min ?? null),
                delta_max: edit.field === 'max' ? deltaToStore : (guardada?.manual_max ?? null),
                pub_sum_min: edit.field === 'min' ? floor : (guardada?.min_units ?? targetRow?.pub_min ?? 0),
                pub_sum_max: edit.field === 'max' ? floor : (guardada?.max_units ?? targetRow?.pub_max ?? 0),
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
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', mensajeAmigable(e), 'error');
                return;
            }
            refreshCosts(edit.sucursalId);
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
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', mensajeAmigable(e), 'error');
                return;
            }
            refreshCosts(edit.sucursalId);
            useStaff.getState().appendAuditLog('MINMAX_DRAFT_EDIT', String(edit.productId), {
                field: 'min+max', product: targetRow?.product_name, sucursal_id: edit.sucursalId,
                old_min: targetRow?.draft_min ?? targetRow?.effective_min ?? 0,
                old_max: targetRow?.draft_max ?? targetRow?.effective_max ?? 0,
                new_min: newMin ?? 0, new_max: newMax ?? 0,
            });
            warnIfOutrageous(edit.field, numVal, targetRow);
        }
    }, [data, hasPublishedData, refreshCosts]);

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
            if (e) { useToastStore.getState().showToast(productName || 'Producto', mensajeAmigable(e), 'error'); return; }
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
                useToastStore.getState().showToast(productName || 'Producto', mensajeAmigable(e), 'error'); return;
            }
        } else {
            setData(prev => prev.map(r => {
                if (r.erp_product_id !== productId || r._erp_sucursal_id !== sucursalId) return r;
                return { ...r, draft_min: minNum, draft_max: maxNum, draft_status: 'pending', alert_status: calcAlertStatus(r.current_stock, minNum, maxNum) };
            }));
            const { error: e } = await upsertStockParams({ erp_product_id: productId, erp_sucursal_id: sucursalId, draft_min: minNum, draft_max: maxNum, draft_status: 'pending', updated_at: new Date().toISOString() });
            if (e) {
                setData(prev => prev.map(r => r.erp_product_id === productId && r._erp_sucursal_id === sucursalId ? targetRow : r));
                useToastStore.getState().showToast(productName || 'Producto', mensajeAmigable(e), 'error'); return;
            }
        }
        refreshCosts(sucursalId);
        useStaff.getState().appendAuditLog(saveLive ? 'MINMAX_LIVE_EDIT' : 'MINMAX_DRAFT_EDIT', String(productId), {
            field: 'min+max', product: productName,
            old_min: saveLive ? (targetRow?.effective_min ?? 0) : (targetRow?.draft_min ?? targetRow?.effective_min ?? 0),
            old_max: saveLive ? (targetRow?.effective_max ?? 0) : (targetRow?.draft_max ?? targetRow?.effective_max ?? 0),
            new_min: minNum, new_max: maxNum, sucursal_id: sucursalId,
        });
        warnIfOutrageous('min', minNum, targetRow);
        warnIfOutrageous('max', maxNum, targetRow);
    }, [data, hasPublishedData, refreshCosts]);

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
            if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${mensajeAmigable(e)}`, 'error'); return; }
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
            if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${mensajeAmigable(e)}`, 'error'); return; }
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
        if (e) { useToastStore.getState().showToast(row.product_name, `Error al restaurar: ${mensajeAmigable(e)}`, 'error'); return; }
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
        if (e) { useToastStore.getState().showToast(row.product_name, `Error: ${mensajeAmigable(e)}`, 'error'); return; }
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

    /**
     * Qué se lleva «Descartar», contado ACÁ y no después.
     *
     * `discard_stock_drafts` limpia `draft_status IN ('pending','sparse_data')`,
     * o sea DOS cosas: los borradores que la pantalla lista, y las filas de
     * «datos escasos» —productos con una o dos ventas en seis meses, que no
     * aparecen en esa lista y tienen su propio filtro—. El diálogo prometía 38
     * y el aviso volvía con 735, que es como se lee un botón que hizo algo que
     * nadie pidió (reportado el 2026-09-04: «ese aviso me asustó»).
     *
     * Los ocultos entran igual: el RPC no los filtra, así que contarlos afuera
     * dejaría un resto sin explicar.
     */
    const aDescartar = useMemo(() => {
        let borradores = 0, sinDatos = 0;
        for (const r of data) {
            if (r._erp_sucursal_id !== selectedErp) continue;
            if (r.draft_status === 'pending')     borradores++;
            if (r.draft_status === 'sparse_data') sinDatos++;
        }
        return { borradores, sinDatos, total: borradores + sinDatos };
    }, [data, selectedErp]);

    // Descarta todos los borradores de la sucursal actual usando el RPC discard_stock_drafts.
    const handleDiscardAll = useCallback(async () => {
        setDiscardingAll(true);
        const { data: count, error: e } = await supabase.rpc('discard_stock_drafts', { p_erp_sucursal_id: selectedErp });
        setDiscardingAll(false);
        setDiscardConfirm(false);
        if (e) { useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Error al descartar: ${mensajeAmigable(e)}`, 'error'); return; }
        const total = count ?? 0;
        // El desglose sólo se afirma si CUADRA con lo que el servidor dice haber
        // tocado. Si no cuadra —otra sesión publicó en el medio, un recálculo
        // entró recién— se informa el total a secas: un desglose que no suma
        // sería la misma sorpresa con más palabras.
        const cuadra = aDescartar.total === total && aDescartar.sinDatos > 0;
        useToastStore.getState().showToast(
            ERP_NAMES[selectedErp],
            cuadra
                ? `Se descartaron ${aDescartar.borradores.toLocaleString()} borradores · y ${aDescartar.sinDatos.toLocaleString()} productos sin ventas para calcular, que vuelven solos`
                : `Se descartaron ${total.toLocaleString()} borradores`,
            cuadra ? 'info' : 'success',
        );
        useStaff.getState().appendAuditLog('MINMAX_DISCARD_ALL', String(selectedErp), {
            sucursal: ERP_NAMES[selectedErp], count,
            borradores: aDescartar.borradores, sin_datos: aDescartar.sinDatos,
        });
        await loadData(selectedErp);
    }, [selectedErp, loadData, aDescartar]);


    const openHistory = useCallback(async (row) => {
        setHistoryRow(row);
        setHistoryLogs([]);
        setHistoryLoading(true);
        // Toda acción que cambia MIN/MAX de este producto — incluye Bodega manual,
        // ediciones desde Pedidos y los "0 en red" (que no llevan sucursal_id propio
        // porque tocan TODAS las sucursales a la vez, por eso van con .or() aparte).
        // La bitácora de la aprobación trae quién pidió y quién decidió, pero NO
        // el motivo que se escribió al pedir: ese vive en la solicitud, y se
        // cruza por `request_id`. Sin él, la única respuesta a «¿por qué este
        // número?» era el `title` del badge, que en un teléfono no existe.
        const [{ data: logs }, { data: emps }, { data: sols }] = await Promise.all([
            fetchAuditLogsForProduct([
                'MINMAX_LIVE_EDIT', 'MINMAX_DRAFT_EDIT',
                'MINMAX_BODEGA_MANUAL_OVERRIDE', 'MINMAX_BODEGA_RESET_MANUAL',
                'MINMAX_UPDATED_FROM_PEDIDO',
                'MINMAX_RESET_CALC', 'MINMAX_RESET_CLEAR', 'MINMAX_DISCARD_DRAFT',
                'MINMAX_ZERO_OUT', 'MINMAX_LIVE_ZERO', 'MINMAX_ZERO_ALL_BRANCHES',
                'MINMAX_REQUEST_APPROVED', 'MINMAX_MOTIVO_AJUSTE',
            ], row.erp_product_id, row._erp_sucursal_id),
            fetchEmployeesBasic(),
            fetchSolicitudesDeProducto(row.erp_product_id, row._erp_sucursal_id),
        ]);
        /* El índice de personas, por las CUATRO claves con las que aparece una
         * firma. El mapa lleva la ficha entera y no sólo la foto: sin `id`,
         * `AvatarConEstado` no puede pintar el aro de estado.
         *
         * Cuatro claves porque la misma persona se nombra distinto según de
         * dónde salga la firma (medido el 2026-09-04):
         *
         *   employees.name                → «EDWIN ALEXANDER NUNEZ JOYA»
         *   audit_logs.user_name          → «EDWIN NUÑEZ» (lo que se escribió ese día)
         *   product_stock_params.manual_por → «edwin.nunez@farmalasa.app» (auth.email())
         *
         * Un índice por nombre acertaba en una de las tres, y el modo de falla es
         * el de siempre: no hay error, sale la inicial en un círculo y el nombre
         * crudo. Se ve como si esa persona no tuviera foto cargada.
         *
         * El `id` es la clave BUENA —`audit_logs.user_id` es el id del empleado,
         * verificado— y las otras tres son la red para lo que sólo trae texto.
         */
        const photoMap = {};
        await signPhotosDeep(emps || []);
        (emps || []).forEach(e => {
            [e.id, e.name, e.username, e.email].forEach(k => {
                if (k) photoMap[String(k).trim().toLowerCase()] = e;
            });
        });
        setHistoryLogs(logs || []);
        setHistorySolicitudes(sols || []);
        setEmpPhotoMap(photoMap);
        setHistoryLoading(false);
    }, []);

    /**
     * Guarda el porqué de un ajuste. `manual_at` y `manual_por` NO se mandan
     * desde acá: los pone el trigger con el dato de la sesión, así que quien
     * edita no puede firmar en nombre de otro.
     *
     * La base puede rechazar «ya no rota» a quien no decide sobre todas las
     * salas. Ese rechazo se muestra tal cual: es una regla, no un error.
     */
    const guardarMotivo = useCallback(async (patch) => {
        const row = motivoRow;
        if (!row) return;
        setGuardandoMotivo(true);
        try {
            const { error: e } = await updateStockParams(row.erp_product_id, row._erp_sucursal_id, {
                ...patch,
                updated_at: new Date().toISOString(),
            });
            if (e) throw e;
            setData(prev => prev.map(r =>
                (r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id)
                    ? {
                        ...r,
                        _manual_motivo: patch.manual_motivo,
                        _manual_nota:   patch.manual_nota,
                        _manual_cliente_unidades: patch.manual_cliente_unidades,
                        _manual_cliente_dias:     patch.manual_cliente_dias,
                        // Un motivo recién puesto marca la fila aunque nadie
                        // haya tocado el número — es lo que hace el trigger.
                        _manual_at: r._manual_at ?? (patch.manual_motivo ? new Date().toISOString() : null),
                    }
                    : r));
            useStaff.getState().appendAuditLog('MINMAX_MOTIVO_AJUSTE', String(row.erp_product_id), {
                product: row.product_name, sucursal_id: row._erp_sucursal_id,
                motivo: patch.manual_motivo, nota: patch.manual_nota,
                cliente_unidades: patch.manual_cliente_unidades, cliente_dias: patch.manual_cliente_dias,
            });
            setMotivoRow(null);
        } catch (e) {
            useToastStore.getState().showToast(row.product_name || 'Producto', mensajeAmigable(e), 'error');
        } finally {
            setGuardandoMotivo(false);
        }
    }, [motivoRow]);

    /**
     * Arma la confirmación de publicar CON lo que hay que saber antes de
     * decidir, no después.
     *
     * `publish_stock_params` tiene dos modos y la diferencia importa: el
     * barrido (sin ids) deja quieta toda fila con `manual_at`, y la publicación
     * dirigida a productos concretos sí la pisa —«porque alguien los eligió uno
     * por uno», dice su comentario—. Hasta hoy la pantalla mandaba siempre el
     * barrido y el resultado se enteraba en un toast: «Publicó 0 borradores ·
     * 38 sin tocar, las ajustó alguien a mano».
     *
     * Ese aviso además leía al revés lo que había pasado. `manual_at` marca
     * quién tocó el número VIGENTE, meses atrás; el borrador que se está
     * publicando lo puede haber tecleado una persona hace veinte minutos, y no
     * deja marca de ninguna clase. Medido en Salud 1 el 2026-09-02: alguien
     * editó 38 borradores a mano durante 45 minutos, apretó Publicar, y el
     * portal frenó los 38 nombrando «alguien» a quien estaba esperando.
     *
     * Así que el alcance se elige acá, viendo el número y el nombre.
     */
    const requestPublish = useCallback((ids = null) => {
        const soloEstos = ids ? new Set(ids) : null;
        // Mismo criterio que `draftCount` — ocultos fuera, Bodega aparte — para
        // que el título del diálogo no discuta con el badge del botón.
        const alcance = data.filter(r =>
            !r.is_hidden
            && r.draft_status === 'pending'
            && r._erp_sucursal_id !== 6
            && (!soloEstos || soloEstos.has(r.erp_product_id)));
        // Frenadas = las que el barrido NO va a tocar, que desde el 2026-09-04
        // son las SELLADAS: vinieron de una solicitud aprobada, o alguien
        // declaró un motivo. Contar `_manual_at` acá sobraba por mucho —de 416
        // filas frenadas, 365 eran la revisión del mes anterior— y hacía que el
        // diálogo pidiera decidir sobre algo que ya no está en juego.
        const ajustadas = alcance.filter(r => r._ajuste_solicitud_id || r._manual_motivo);
        const ultimo = ajustadas.reduce(
            (a, r) => (!a || String(r._manual_at) > String(a._manual_at) ? r : a), null);
        setPublishConfirm({
            open: true,
            ids: ids ?? null,
            count: alcance.length,
            modo: 'todos',
            idsTodos:     alcance.map(r => r.erp_product_id),
            idsSinAjuste: alcance.filter(r => !r._ajuste_solicitud_id && !r._manual_motivo).map(r => r.erp_product_id),
            ajustadas:    ajustadas.length,
            ajustePor:    ultimo?._manual_por ?? null,
            ajusteAt:     ultimo?._manual_at  ?? null,
        });
    }, [data]);

    /**
     * `dejadasAparte` son las que NO se mandaron porque quien publicó eligió
     * dejarlas. Viaja aparte de `omitidas_por_ajuste_manual` a propósito: la
     * base cuenta lo que ELLA frenó, y con ids explícitos no frena nada. Sin
     * este número, elegir «sólo las 9 sin ajuste» y ver «Publicó 9 productos»
     * no se distingue de que hubiera 9 nomás.
     */
    const handlePublish = useCallback(async (productIds = null, dejadasAparte = 0) => {
        setPublishing(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const rpcParams = { p_erp_sucursal_id: selectedErp };   // sin p_published_by (F4.2: muerto)
            if (productIds) rpcParams.p_erp_product_ids = productIds;
            const { data: res, error: e } = await supabase.rpc('publish_stock_params', rpcParams);
            if (e) throw e;
            useStaff.getState().appendAuditLog('MINMAX_PUBLISH', String(selectedErp), {
                sucursal: ERP_NAMES[selectedErp],
                sucursal_id: selectedErp,
                published_by: user?.email ?? null,
                published_count: res?.published,
                omitidas_por_ajuste_manual: res?.omitidas_por_ajuste_manual ?? 0,
                dejadas_aparte: dejadasAparte,
                scope: productIds ? 'selective' : 'all',
                product_ids: productIds ?? null,
            });
            await loadData(selectedErp);
            const n        = res?.published ?? 0;
            const frenadas = res?.omitidas_por_ajuste_manual ?? 0;
            // «Borradores» siempre, aunque se hayan mandado ids: es la palabra
            // que usa esta pantalla. Decir «3 productos» acá obliga a traducir.
            const label = `${n.toLocaleString()} borrador${n !== 1 ? 'es' : ''}`;
            // Lo que quedó quieto se DICE, y se dice de quién fue la decisión.
            // Callarlo haría leer «publicó todo» donde no publicó todo, que es
            // el silencio con el que desaparecieron 567 ajustes sin que nadie lo
            // notara; nombrarlo mal —«las ajustó alguien a mano» sobre borradores
            // que acababa de teclear quien publicaba— es el error contrario.
            //
            // `frenadas` es la rama que ya casi no ocurre: el diálogo manda ids
            // explícitos, y con ids la base no frena nada. Queda por si alguien
            // publica sin pasar por ahí.
            const cola = dejadasAparte > 0
                ? ` · ${dejadasAparte.toLocaleString()} quedaron igual, como elegiste`
                : frenadas > 0
                    ? ` · ${frenadas.toLocaleString()} no, vienen de una solicitud`
                    : '';
            useToastStore.getState().showToast(
                ERP_NAMES[selectedErp],
                `Se publicaron ${label}${cola}`,
                (frenadas > 0 || dejadasAparte > 0) ? 'info' : 'success',
            );
        } catch (e) { useToastStore.getState().showToast('Error al publicar', mensajeAmigable(e), 'error'); }
        finally { setPublishing(false); }
    }, [selectedErp, loadData]);

    const startDeferredPublish = useCallback((ids, count, dejadasAparte = 0) => {
        setPublishConfirm({
            open: false, ids: null, count: 0, modo: 'todos',
            idsTodos: [], idsSinAjuste: [], ajustadas: 0, ajustePor: null, ajusteAt: null,
        });
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
            await handlePublish(ids ?? undefined, dejadasAparte);
        }, 5000);
    }, [handlePublish]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const hasActiveFilter = filterAbc !== 'all' || filterXyz !== 'all' || filterAlert !== 'all' || searchTerm !== '';
    const hasAnyFilter    = hasActiveFilter || filterDraft || filterSparse || filterChangesOnly || filterDispatchRisk || filterAjuste !== 'all';
    const clearAllFilters = useCallback(() => {
        setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all');
        setFilterDraft(false); setFilterSparse(false); setFilterChangesOnly(false); setFilterDispatchRisk(false);
        setFilterAjuste('all');
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
            if (filterAjuste !== 'all') {
                const est = estadoAjuste(r);
                if (filterAjuste === 'any' ? !est : est !== filterAjuste)                                                    return false;
            }
            if (r.is_catalog_only && filterAlert !== 'no_data' && !searchTerm)                                               return false;
            if (filterAbc !== 'all' && (r.draft_abc_class || r.abc_class) !== filterAbc)                                    return false;
            if (filterXyz !== 'all' && normXyz(r.draft_demand_variability || r.demand_variability) !== filterXyz)           return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert)                                                     return false;
            return true;
        });
    }, [data, filterAbc, filterXyz, filterAlert, searchTerm, filterDraft, filterSparse, filterChangesOnly, filterDispatchRisk, filterAjuste, hiddenIds, filterHidden]);

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
            //
            // Oculto queda en -/- PUBLICADO, no en un borrador de 0/0. El borrador
            // era inalcanzable —la tabla no lista ocultos y el contador de borradores
            // los saltea a propósito (ver el `continue` de arriba)— así que quedaba
            // pendiente para siempre, y calculate_stock_params se salta la sucursal
            // ENTERA ante un solo pendiente: eso dejó el recálculo mensual sin correr
            // desde junio en las 6 sucursales.
            await upsertStockParamsBulk(
                ids.map(id => ({
                    erp_product_id: id,
                    erp_sucursal_id: selectedErp,
                    is_hidden: true,
                    min_units: null,
                    max_units: null,
                    draft_min: null,
                    draft_max: null,
                    draft_status: 'none',
                    updated_at: new Date().toISOString(),
                }))
            );
            setHiddenIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
            setData(prev => prev.map(r =>
                ids.includes(r.erp_product_id) && r._erp_sucursal_id === selectedErp
                    ? { ...r, is_hidden: true, min_units: null, max_units: null, draft_min: null, draft_max: null, draft_status: 'none' } : r
            ));
            useStaff.getState().appendAuditLog('MINMAX_HIDE_FILTERED', 'batch', { count: ids.length, sucursal_id: selectedErp });
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Ocultó ${ids.length} producto${ids.length !== 1 ? 's' : ''}`, 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error al ocultar', mensajeAmigable(e), 'error');
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
    useEffect(() => { setPage(1); }, [filterAbc, filterXyz, filterAlert, searchTerm, sortBy, sortDir, selectedErp, filterDraft, filterSparse, filterDispatchRisk, filterAjuste, filterHidden]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // `hideBelow` es la estrategia del portal para pantallas angostas (§32): la
    // tabla no se reflowea a tarjetas, deja caer columnas. Estas seis no
    // declaraban NINGUNA, así que la tabla pedía `minWidth: 860px` y en un
    // teléfono había que arrastrarla de lado: se veía el nombre del producto y
    // para leer su MIN/MAX —el dato de la vista— había que desplazar.
    //
    // Lo que queda en un teléfono es lo que la vista existe para contestar:
    // qué producto, cuánto MIN/MAX, y qué hacer con él.
    const COLS = [
        { key: 'product_name',  label: 'Producto',    align: 'left',   sortable: true, className: 'w-[30%]' },
        // `2xl`: a 1280 las seis columnas pedían 975px contra los 892 del marco y la
        // de **Acciones** —«Poner 0 · Restaurar · Más»— quedaba fuera. El laboratorio
        // ocupa el 18% del ancho, es contexto del producto y además tiene filtro
        // propio arriba; los botones de la fila no se alcanzaban de ninguna forma.
        { key: 'laboratorio',   label: 'Laboratorio', align: 'left',   sortable: true, className: 'w-[18%]', hideBelow: '2xl' },
        { key: 'abc_xyz',       label: 'Clase',       align: 'center', sortable: true, className: 'w-14',    hideBelow: 'sm' },
        { key: 'effective_min', label: 'MIN · MAX',   align: 'center', sortable: true, className: 'w-[150px]' },
        { key: 'presentacion',  label: 'Presentación', align: 'center', className: 'w-[130px]', hideBelow: 'md' },
        { key: 'acciones',      label: 'Acciones',    align: 'center', className: 'w-20' },
    ];

    // `glassStyle` era `background: rgba(255,255,255,.38)` — blanco FIJO, así
    // que en los dos temas oscuros estas superficies quedaban blancas. Y al ir
    // en `style` inline no lo veía el barrido de clases: solo lo pescó el gate
    // por el `rgba` crudo. Ahora el vidrio sale de `data-surface="card"`, que
    // sigue al tema; queda solo el radio.
    const glass = 'rounded-2xl';

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
            ? `Σ sucursales: MIN ${freshFloorMin.toLocaleString()} · MAX ${freshFloorMax.toLocaleString()} — ingresa el total de bodega (sum + excedente).`
            : 'Sin MIN/MAX en salas. Ingresa el excedente que debe quedar en bodega.';
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
        const { data: branches, error: branchesErr } = await supabase.rpc('get_product_branch_summary', { p_erp_product_id: productId });
        if (cancelled) return;
        // Un tooltip vacío por error se lee como "no hay nada pendiente".
        if (branchesErr) console.error('[minmax] get_product_branch_summary', branchesErr.message);
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
        filterAjuste, setFilterAjuste, ajusteStats, ajusteCount,
        motivoRow, setMotivoRow, guardarMotivo, guardandoMotivo,
        hidingIds, setHidingIds,
        filterChangesOnly, setFilterChangesOnly,
        filterHidden, setFilterHidden,
        hiddenIds, setHiddenIds,
        skipBlurSave,
        publishConfirm, setPublishConfirm,
        discardConfirm, setDiscardConfirm, aDescartar,
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
        historyLogs, historySolicitudes,
        reglaRow, setReglaRow, aplicandoRegla, setAplicandoRegla,
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
    };
}
