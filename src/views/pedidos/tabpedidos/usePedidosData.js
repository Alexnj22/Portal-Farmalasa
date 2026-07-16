// Bloque 6.C (continuación) — hook de estado/fetch extraído de TabPedidos.jsx.
// Extracción mecánica: mismos nombres, misma lógica, sin cambios de
// comportamiento.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../../supabaseClient';
import { signPhotosDeep } from '../../../utils/storageFiles';
import { useAuth } from '../../../context/AuthContext';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import { notifyBranch } from '../../../utils/notify';
import { tokenMatch } from '../../../utils/searchUtils';
import { ERP_NAMES } from '../../../constants/erp';
import { printFromPedidoItems, getExactPageGroups } from '../../../utils/pedidoPrint';
import { PAUSE_REASONS } from './constants';
import { getBranchStage, currentMonthRange } from './helpers';
import {
    fetchEmployeeBranchId, fetchSucursalIdForBranch, fetchBodegaBranchId, fetchBranchIdForSucursal,
    fetchBranchInfoForSucursal, fetchBranchNamesForSucursales, fetchApoyoForPedidos, fetchApoyoForPedido,
    fetchActiveRutas, fetchRutaLocations, upsertRutaLocation, updateRutaPedidoEntregado,
    fetchPedidoItemsAll, fetchPedidoItemEventosAll, fetchPedidoItemsPendientesIds,
    fetchPedidoItemsFaltaElectrolit, fetchPedidoItemsFaltaEspeciales, updatePedidoItemsFaltaCaja,
    fetchPedidoSucursalStatus, updatePedidoSucursalStatus, fetchPausaHistorial, fetchAttendancePunches,
} from '../../../data/pedidos';

const ERP_ORDER = [5, 1, 2, 3, 4, 7];

export function usePedidosData({ searchTerm = '' }) {
    const { user, getScope, hasPermission } = useAuth();
    const isBranch = getScope('pedidos') === 'BRANCH';
    const canEdit  = hasPermission('pedidos', 'can_edit');

    // Employee store for name/photo lookups
    const storeEmployees = useStaff(s => s.employees);
    const empMap = useMemo(() => {
        const m = new Map();
        (storeEmployees || []).forEach(e => m.set(e.id, e));
        return m;
    }, [storeEmployees]);

    const [erpSucursalId, setErpSucursalId] = useState(null);
    const [branchName,    setBranchName]    = useState('');
    const [filterSuc,     setFilterSuc]     = useState('');
    const [filterStatus,  setFilterStatus]  = useState('all');
    const [filterDate,    setFilterDate]    = useState(() => currentMonthRange());

    const [activeRows,  setActiveRows]  = useState([]);
    const [loading,     setLoading]     = useState(true);

    const [expanded,     setExpanded]     = useState(null);
    const [expandedMeta, setExpandedMeta] = useState(null);
    const expandedMetaRef = useRef(null);
    useEffect(() => { expandedMetaRef.current = expandedMeta; }, [expandedMeta]);

    const [items,         setItems]         = useState({});
    const [eventosMap,    setEventosMap]    = useState({});
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [llegadaStatus, setLlegadaStatus] = useState({});
    const [erpStatus,     setErpStatus]     = useState({});
    const [busyAction,    setBusyAction]    = useState(null);
    const [busyLifecycle, setBusyLifecycle] = useState(null);
    const [crearRutaOpen, setCrearRutaOpen] = useState(null); // null | string[] (keys pre-seleccionados)
    const [modal,         setModal]         = useState(null);
    const [rutaMapOpen,   setRutaMapOpen]   = useState(null); // ruta obj para RutaMapModal

    // Rutas activas: mapa pedidoId → { ruta, stop, driverOnline }
    const [pedidoRutaMap, setPedidoRutaMap] = useState(new Map());

    const [llegadaModal,         setLlegadaModal]         = useState(null); // { pedidoId, sucId, key, rows }
    const [reenvioLlegadaModal,  setReenvioLlegadaModal]  = useState(null); // { pedidoId, sucId, key, ciclo, cajasCiclo }
    const [reenviarConfirmModal, setReenviarConfirmModal] = useState(null); // { pedidoId, sucId, numero, cajas, electrolits, especiales }
    const [finalizarModal,     setFinalizarModal]      = useState(null); // { pedidoId, sucId, numero, key, rows }
    const [newAlert,      setNewAlert]      = useState(null);

    // Pause modal
    const [pauseModal,   setPauseModal]   = useState(null);
    const [pauseHistory, setPauseHistory] = useState([]);
    const [pauseRazon,   setPauseRazon]   = useState('almuerzo');
    const [pauseComment, setPauseComment] = useState('');
    const [kioskLunch,   setKioskLunch]   = useState(false);

    // Apoyo
    const [apoyoMap,   setApoyoMap]   = useState({}); // cardKey → [{id, name, photo_url}]
    const [apoyoModal, setApoyoModal] = useState(null); // { pedidoId, sucId, cardKey }

    // Card stats (for collapsed pill display)
    const [cardStats,  setCardStats]  = useState({}); // cardKey → { enviados, sinStock, porRegla }

    // ── Cargar rutas activas ──────────────────────────────────────────────────

    // ── Branch ERP ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!isBranch || !user?.id) return;
        (async () => {
            const { data: emp, error: empErr } = await fetchEmployeeBranchId(user.id);
            if (empErr) console.error('fetch employee branch_id failed:', empErr.message);
            if (!emp?.branch_id) return;
            const { data: mapRow, error: mapErr } = await fetchSucursalIdForBranch(emp.branch_id);
            if (mapErr) console.error('fetch erp_sucursal_map failed:', mapErr.message);
            if (!mapRow) return;
            setErpSucursalId(mapRow.erp_sucursal_id);
            setFilterSuc(mapRow.erp_sucursal_id);
            setBranchName(ERP_NAMES[mapRow.erp_sucursal_id] ?? `Sucursal ${mapRow.erp_sucursal_id}`);
        })();
    }, [isBranch, user?.id]);

    // ── Loaders ───────────────────────────────────────────────────────────────

    const loadActive = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_pedidos_en_curso');
        if (error) { console.error('loadActive: get_pedidos_en_curso failed:', error.message); return []; }
        setActiveRows(data ?? []);
        const rows = data ?? [];
        const stats = {};
        rows.forEach(row => {
            stats[`act_${row.pedido_id}_${row.erp_sucursal_id}`] = { enviados: 0, sinStock: 0, porRegla: 0, agotamiento: 0 };
        });
        const ids = [...new Set(rows.map(r => r.pedido_id))];
        if (ids.length) {
            const { data: statRows, error: statErr } = await supabase.rpc('get_pedido_item_stats', { p_pedido_ids: ids });
            if (statErr) console.error('loadActive: get_pedido_item_stats failed:', statErr.message);
            (statRows ?? []).forEach(s => {
                const k = `act_${s.pedido_id}_${s.erp_sucursal_id}`;
                stats[k] = { enviados: s.enviados, sinStock: s.sin_stock, porRegla: s.por_regla, agotamiento: s.agotamiento ?? 0, pendientes: s.pendientes ?? 0 };
            });
        }
        setCardStats(stats);
        return rows;
    }, []);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await loadActive();
            setLoading(false);
        })();
    }, []); // eslint-disable-line

    // Auto-load items for pedidos parciales so DifSection always shows item details
    useEffect(() => {
        const parciales = activeRows.filter(r => r.pedido_status === 'parcial');
        if (!parciales.length) return;
        parciales.forEach(r => {
            const key = `act_${r.pedido_id}_${r.erp_sucursal_id}`;
            if (!items[key]) fetchItems(key, r.pedido_id, r.erp_sucursal_id);
        });
    }, [activeRows]); // eslint-disable-line

    // Batch-load apoyo for ALL users whenever activeRows changes (branch + bodega)
    useEffect(() => {
        if (!activeRows.length) return;
        (async () => {
            const ids = [...new Set(activeRows.map(r => r.pedido_id))];
            if (!ids.length) return;
            // Branch: filter to their sucursal only; bodega: load all sucursales
            const { data } = await fetchApoyoForPedidos(ids, isBranch && erpSucursalId ? erpSucursalId : null);
            await signPhotosDeep(data || []);
            if (!data) return;
            const map = {};
            data.forEach(r => {
                const key = `act_${r.pedido_id}_${r.erp_sucursal_id}`;
                if (!map[key]) map[key] = { preparacion: [], recepcion: [] };
                const t = r.tipo ?? 'preparacion';
                if (!map[key][t]) map[key][t] = [];
                if (!map[key][t].find(e => e.id === r.employee_id)) {
                    map[key][t].push({ id: r.employee_id, ...r.employees });
                }
            });
            setApoyoMap(prev => ({ ...prev, ...map }));
        })();
    }, [isBranch, erpSucursalId, activeRows]);

    // ── Realtime ──────────────────────────────────────────────────────────────

    useEffect(() => {
        const ch = supabase.channel('tab-pedidos-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (payload) => {
                loadActive();
                loadActiveRutas(); // rutas/ruta_pedidos pueden no estar en la pub; pedidos sí
                const s = payload.new?.status;
                if (isBranch && s === 'enviado') {
                    const ids = payload.new?.sucursal_ids ?? [];
                    if (erpSucursalId && ids.includes(erpSucursalId)) {
                        setNewAlert({ numero: payload.new.numero });
                        setTimeout(() => setNewAlert(null), 8000);
                    }
                }
                const meta = expandedMetaRef.current;
                const affectedId = payload.new?.id ?? payload.old?.id;
                if (meta && meta.pedidoId === affectedId) fetchItems(expanded, meta.pedidoId, meta.sucId);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_sucursal_status' }, () => { loadActive(); })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedido_item_eventos' }, (payload) => {
                const { pedido_id, erp_sucursal_id } = payload.new ?? {};
                if (!pedido_id) return;
                const key = `act_${pedido_id}_${erp_sucursal_id}`;
                fetchItems(key, pedido_id, erp_sucursal_id);
                loadActive();
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedido_items' }, (payload) => {
                const { pedido_id, erp_sucursal_id } = payload.new ?? {};
                if (!pedido_id) return;
                const key = `act_${pedido_id}_${erp_sucursal_id}`;
                fetchItems(key, pedido_id, erp_sucursal_id);
            })
            .subscribe();
        return () => supabase.removeChannel(ch);
        // fetchItems/loadActiveRutas quedan fuera: se declaran más abajo en el archivo
        // (forward reference) y sus propias deps (isBranch/erpSucursalId; loadActiveRutas
        // no tiene ninguna) rara vez cambian durante la vida de este componente, así que
        // el riesgo real de closure obsoleta es bajo — mover su declaración antes de este
        // efecto en un archivo de 3900+ líneas queda fuera de alcance de este barrido de lint.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadActive, isBranch, erpSucursalId, expanded]);

    // ── Rutas activas: mapa pedidoId → { ruta, stop, driverOnline } ──────────
    const loadingRutasRef = useRef(false);
    const loadActiveRutas = useCallback(async () => {
        if (loadingRutasRef.current) return;
        loadingRutasRef.current = true;
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const { data, error } = await fetchActiveRutas(todayStart.toISOString());
        if (error) console.error('loadActiveRutas: fetch rutas failed:', error.message);
        if (!data?.length) { setPedidoRutaMap(new Map()); loadingRutasRef.current = false; return; }

        const rutaIds = data.map(r => r.id);
        const allStops = data.flatMap(r => r.ruta_pedidos ?? []);
        const sucIds   = [...new Set(allStops.map(s => s.erp_sucursal_id))];

        const [{ data: locs, error: locsErr }, { data: sucData, error: sucErr }] = await Promise.all([
            fetchRutaLocations(rutaIds),
            sucIds.length
                ? fetchBranchNamesForSucursales(sucIds)
                : Promise.resolve({ data: [] }),
        ]);
        if (locsErr) console.error('loadActiveRutas: fetch ruta_locations failed:', locsErr.message);
        if (sucErr) console.error('loadActiveRutas: fetch erp_sucursal_map failed:', sucErr.message);

        const onlineMap  = Object.fromEntries((locs ?? []).map(l => {
            const ageMin = (Date.now() - new Date(l.updated_at).getTime()) / 60000;
            return [l.ruta_id, ageMin < 3];
        }));
        const sucNameMap = Object.fromEntries((sucData ?? []).map(s => [s.erp_sucursal_id, s.branch?.name]));

        const map = new Map();
        data.forEach(ruta => {
            const enriched = (ruta.ruta_pedidos ?? []).map(s => ({
                ...s, suc_name: sucNameMap[s.erp_sucursal_id] ?? `Suc. ${s.erp_sucursal_id}`,
            }));
            enriched.forEach(stop => {
                map.set(stop.pedido_id, { ruta: { ...ruta, ruta_pedidos: enriched }, stop, driverOnline: onlineMap[ruta.id] ?? false });
            });
        });
        setPedidoRutaMap(map);
        loadingRutasRef.current = false;
    }, []);

    useEffect(() => { loadActiveRutas(); }, [loadActiveRutas]);
    useEffect(() => {
        const ch = supabase.channel('pedido-rutas-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas' }, () => { loadActiveRutas(); loadActive(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ruta_pedidos' }, () => { loadActiveRutas(); loadActive(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ruta_locations' }, loadActiveRutas)
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [loadActiveRutas, loadActive]);

    // ── GPS background persistente — conductor con ruta en_ruta ──────────────
    // Corre independiente del RutaMapModal: pantalla apagada o modal cerrado
    const bgGpsWatchRef    = useRef(null);
    const bgGpsIntervalRef = useRef(null);
    const bgGpsPosRef      = useRef(null);
    useEffect(() => {
        // Solo activo si el usuario es conductor de una ruta en_ruta hoy
        const entry = [...pedidoRutaMap.values()]
            .find(v => v.ruta.conductor_id && String(v.ruta.conductor_id) === String(user?.id) && v.ruta.status === 'en_ruta');

        if (!entry) {
            // Limpiar si ya no hay ruta activa
            if (bgGpsWatchRef.current !== null) {
                navigator.geolocation?.clearWatch(bgGpsWatchRef.current);
                bgGpsWatchRef.current = null;
            }
            if (bgGpsIntervalRef.current) { clearInterval(bgGpsIntervalRef.current); bgGpsIntervalRef.current = null; }
            return;
        }

        const rutaId = entry.ruta.id;
        const isNative = !!(window.Capacitor?.isNativePlatform?.());

        const startBg = async () => {
            try {
                if (isNative) {
                    const { BackgroundGeolocation } = await import(/* @vite-ignore */ '@capacitor-community/background-geolocation');
                    bgGpsWatchRef.current = await BackgroundGeolocation.addWatcher(
                        { backgroundTitle: 'Ruta activa', backgroundMessage: 'Rastreando tu posición.', requestPermissions: true, stale: false, distanceFilter: 20 },
                        (loc) => { if (loc) bgGpsPosRef.current = { lat: loc.latitude, lng: loc.longitude }; }
                    );
                } else if (navigator.geolocation) {
                    bgGpsWatchRef.current = navigator.geolocation.watchPosition(
                        (p) => { bgGpsPosRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }; },
                        (err) => console.warn('[BG-GPS]', err.code),
                        { enableHighAccuracy: true, maximumAge: 10000 },
                    );
                }
                // Escribir a DB cada 30s
                bgGpsIntervalRef.current = setInterval(async () => {
                    const pos = bgGpsPosRef.current;
                    if (!pos) return;
                    await upsertRutaLocation(rutaId, pos.lat, pos.lng).then(() => {}, () => {});
                }, 30_000);
            } catch (e) { console.warn('[BG-GPS] start error:', e); }
        };

        startBg();
        return () => {
            if (bgGpsWatchRef.current !== null) {
                if (isNative) {
                    import(/* @vite-ignore */ '@capacitor-community/background-geolocation')
                        .then(({ BackgroundGeolocation }) => BackgroundGeolocation.removeWatcher({ id: bgGpsWatchRef.current }))
                        .catch(() => {});
                } else {
                    navigator.geolocation?.clearWatch(bgGpsWatchRef.current);
                }
                bgGpsWatchRef.current = null;
            }
            if (bgGpsIntervalRef.current) { clearInterval(bgGpsIntervalRef.current); bgGpsIntervalRef.current = null; }
        };
    }, [pedidoRutaMap, user?.id]);

    // ── Fetch items ───────────────────────────────────────────────────────────

    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return;
        setLoadingItems(true);
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);
        try {

        // Paginated fetch — pedidos con >1000 items existen en producción
        const allItemRows = await fetchPedidoItemsAll(pedidoId, sucFilter) ?? [];

        const lcPromise = (sucFilter && isBranch)
            ? fetchPedidoSucursalStatus(pedidoId, sucFilter, 'recibido_erp_at, llegada_fisica_at')
            : Promise.resolve({ data: null });

        const apoyoQ = fetchApoyoForPedido(pedidoId, sucFilter);

        // Paginated eventos fetch (cap-safe)
        const allEvRows = await fetchPedidoItemEventosAll(pedidoId, sucFilter) ?? [];

        const [{ data: lcRow, error: lcErr }, { data: apoyoRows, error: apoyoErr }] = await Promise.all([lcPromise, apoyoQ]);
        if (lcErr) throw lcErr;
        if (apoyoErr) throw apoyoErr;
        await signPhotosDeep(apoyoRows || []);
        const resolved = allItemRows.map(row => ({
            ...row,
            presentations: (row.products?.product_precios || [])
                .filter(pp => pp.activo !== false)
                .map(pp => ({ factor: pp.factor, tipo: pp.presentaciones?.tipo }))
                .filter(p => p.tipo && p.factor >= 1),
            tiene_dispatch_label: !!(row.products?.dispatch_rules?.[0]?.dispatch_label),
        }));
        setItems(prev => ({ ...prev, [key]: resolved }));
        setEventosMap(prev => ({ ...prev, [key]: allEvRows }));
        const apoyoByTipo = { preparacion: [], recepcion: [] };
        (apoyoRows || []).forEach(r => {
            const t = r.tipo ?? 'preparacion';
            if (!apoyoByTipo[t]) apoyoByTipo[t] = [];
            apoyoByTipo[t].push({ id: r.employee_id, ...r.employees });
        });
        setApoyoMap(prev => ({ ...prev, [key]: apoyoByTipo }));
        if (lcRow) {
            setErpStatus(prev => ({ ...prev, [key]: !!lcRow.recibido_erp_at }));
            setLlegadaStatus(prev => ({ ...prev, [key]: !!lcRow.llegada_fisica_at }));
        }
        return resolved;
        } catch (err) {
            console.error('[fetchItems] error:', err?.message ?? err);
            return [];
        } finally {
            setLoadingItems(false);
        }
    }, [isBranch, erpSucursalId]);

    const toggleExpand = useCallback(async (key, pedidoId, sucId) => {
        if (expanded === key) { setExpanded(null); setExpandedMeta(null); return; }
        setExpanded(key);
        setExpandedMeta({ pedidoId, sucId });
        if (!items[key]) await fetchItems(key, pedidoId, sucId);
    }, [expanded, items, fetchItems]);

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    const handleLifecycle = useCallback(async (pedidoId, sucId, stage, razon = null, numero = null) => {
        const key = `lc_${pedidoId}_${sucId}`;
        setBusyLifecycle(key);
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: user?.id ?? null, p_razon: razon });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId, { sucursal_id: sucId, razon });
            loadActive();
            if (stage === 'iniciar' && numero != null) {
                fetchBranchInfoForSucursal(sucId).then(({ data: m }) => {
                    if (!m?.branch_id) return;
                    // Informativo: campana sin push
                    notifyBranch(m.branch_id, { type: 'PEDIDO_TRACKING', title: `Pedido #${numero} en preparación`, body: `Bodega ha iniciado la preparación de tu pedido #${numero}. Te avisaremos cuando salga en camino.`, link: '/pedidos' });
                }).catch(() => {});
            }
        } catch (e) { console.error('Lifecycle error:', e); } finally { setBusyLifecycle(null); }
    }, [user, loadActive]);

    const [anularModal,      setAnularModal]      = useState(null); // { pedidoId, numero, requiresReason }
    const [busyAnular,       setBusyAnular]       = useState(false);

    const [printingPdf,      setPrintingPdf]      = useState(null);
    const [programarModal,   setProgramarModal]   = useState(null); // { pedidoId, sucId, numero, currentAt, historial }
    const [savingProgramar,  setSavingProgramar]  = useState(false);

    const handleProgramarEntrega = useCallback(async (newIso) => {
        if (!programarModal) return;
        const { pedidoId, sucId, historial } = programarModal;
        setSavingProgramar(true);
        try {
            const emp    = empMap.get(user?.id);
            const entry  = { programada_at: newIso, registrado_at: new Date().toISOString(), por: user?.id ?? null, nombre: emp?.name ?? null };
            const newHist = [...(historial ?? []), entry];
            const { error } = await updatePedidoSucursalStatus(pedidoId, sucId,
                { entrega_programada_at: newIso, entrega_programada_historial: newHist });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_ENTREGA_PROGRAMADA', pedidoId, { sucursal_id: sucId, entrega_at: newIso });
            setProgramarModal(null);
            await loadActive();
        } catch (e) { console.error(e); } finally { setSavingProgramar(false); }
    }, [programarModal, user, empMap, loadActive]);

    const handlePrintPdf = useCallback(async (pedidoId, pedidoNumero, sucId, cardKey, codigo) => {
        setPrintingPdf(pedidoId);
        try {
            let rows = items[cardKey];
            if (!rows) rows = await fetchItems(cardKey, pedidoId, sucId);
            await printFromPedidoItems(pedidoNumero, [[sucId, rows ?? []]], {}, codigo ?? `${pedidoNumero}`);
        } catch (e) { console.error('PDF error:', e); } finally { setPrintingPdf(null); }
    }, [items, fetchItems]);

    const openPauseModal = useCallback(async (pedidoId, sucId) => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [{ data: histData, error: histErr }, { data: punchData, error: punchErr }] = await Promise.all([
                fetchPausaHistorial(pedidoId, sucId),
                user?.id
                    ? fetchAttendancePunches(user.id, todayStart.toISOString())
                    : Promise.resolve({ data: [] }),
            ]);
            if (histErr) throw histErr;
            if (punchErr) throw punchErr;

            const history = histData ?? [];
            const punches = punchData ?? [];
            const onKioskLunch = punches.length > 0 && punches[0].type === 'OUT_LUNCH';
            const alreadyUsedAlmuerzo = history.some(h => h.razon?.toLowerCase().includes('almuerzo'));

            setKioskLunch(onKioskLunch);
            setPauseHistory(history);
            setPauseRazon(onKioskLunch && !alreadyUsedAlmuerzo ? 'almuerzo' : 'insumos');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        } catch (e) {
            console.error('openPauseModal error:', e);
            // Abre el modal aunque falle la detección de kiosko
            setPauseHistory([]);
            setKioskLunch(false);
            setPauseRazon('insumos');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        }
    }, [user?.id]);

    const confirmPause = useCallback(async () => {
        if (!pauseModal) return;
        const reason = PAUSE_REASONS.find(r => r.key === pauseRazon);
        let razon = reason?.label ?? pauseRazon;
        if (pauseComment.trim()) razon += ` — ${pauseComment.trim()}`;
        await handleLifecycle(pauseModal.pedidoId, pauseModal.sucId, 'pausar', razon);
        setPauseModal(null);
    }, [pauseModal, pauseRazon, pauseComment, handleLifecycle]);

    const handleApoyoSuccess = useCallback((emp, cardKey, tipo = 'preparacion') => {
        setApoyoMap(prev => {
            const existing = prev[cardKey] ?? { preparacion: [], recepcion: [] };
            const bucket   = existing[tipo] ?? [];
            if (bucket.find(e => e.id === emp.id)) return prev;
            return { ...prev, [cardKey]: { ...existing, [tipo]: [...bucket, { id: emp.id, name: emp.name, photo_url: emp.photo_url }] } };
        });
        loadActive();
    }, [loadActive]);

    const handleAnular = useCallback(async (motivo = null) => {
        if (!anularModal) return;
        setBusyAnular(true);
        try {
            const { error } = await supabase.rpc('anular_pedido', {
                p_pedido_id:  anularModal.pedidoId,
                p_anulado_por: user?.id ?? null,
                p_motivo:     motivo || null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_ANULADO', anularModal.pedidoId, { numero: anularModal.numero, motivo });
            useToastStore.getState().showToast(`Pedido #${anularModal.numero} anulado`, motivo ? `Motivo: ${motivo}` : 'El pedido fue anulado correctamente.', 'success');
            setAnularModal(null);
            await loadActive();
        } catch (e) {
            useToastStore.getState().showToast('Error al anular', e.message ?? 'Ocurrió un error.', 'error');
        } finally {
            setBusyAnular(false);
        }
    }, [anularModal, user, loadActive]);

    // ── Reception ─────────────────────────────────────────────────────────────

    const openFinalizarModal = useCallback(async (pedidoId, sucId, numero, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        setBusyAction(`finalizar_load_${key}`);
        try {
            const [rowsResult, pssResult] = await Promise.all([
                items[key] ? Promise.resolve(items[key]) : fetchItems(key, pedidoId, sucId),
                fetchPedidoSucursalStatus(pedidoId, sucId, 'paginas'),
            ]);
            setFinalizarModal({
                pedidoId, sucId, numero, key,
                rows:    rowsResult ?? [],
                paginas: pssResult.data?.paginas ?? null,
            });
        } catch (e) { console.error('openFinalizarModal:', e); } finally { setBusyAction(null); }
    }, [busyAction, items, fetchItems]);

    const handleFinalizarConCajas = useCallback(async ({ totalCajas, cajaMap, paginaItems }) => {
        if (!finalizarModal) return;
        const { pedidoId, sucId } = finalizarModal;
        const allRows = finalizarModal.rows ?? [];
        // Contar cajas Electrolit: solo los que despachan por CAJA (625ml)
        const cajasElectrolit = allRows
            .filter(r =>
                (r.products?.nombre ?? '').toLowerCase().includes('electrolit') &&
                (r.dispatch_tipo ?? '').toUpperCase() === 'CAJA'
            )
            .reduce((sum, r) => sum + Math.round((r.cantidad_asignada ?? 0) / (Number(r.dispatch_factor) || 1)), 0);

        // Cajas especiales: E1, E2… por unidad
        let eCounter = 1;
        const cajasEspeciales = allRows
            .filter(r => r.caja_especial === true && (r.cantidad_asignada ?? 0) > 0)
            .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
            .flatMap(r => Array.from({ length: r.cantidad_asignada }, () => ({
                label: `E${eCounter++}`,
                erp_product_id: r.erp_product_id,
                product_name:   r.products?.nombre ?? '',
            })));

        setFinalizarModal(null);
        setBusyAction('finalizar');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'finalizar', p_user_id: user?.id ?? null,
            });
            await updatePedidoSucursalStatus(pedidoId, sucId,
                { total_cajas: totalCajas, caja_map: cajaMap, pagina_items: paginaItems, cajas_electrolit: cajasElectrolit, cajas_especiales: cajasEspeciales });
            useStaff.getState().appendAuditLog('PEDIDO_FINALIZADO', pedidoId, { totalCajas, cajasElectrolit, cajasEspeciales: cajasEspeciales.length, cajas: Object.keys(cajaMap).length });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [finalizarModal, user, loadActive]);

    const handleLlegada = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        let rows = items[key];
        if (!rows) {
            setBusyAction('llegada');
            rows = await fetchItems(key, pedidoId, sucId);
            setBusyAction(null);
        }
        setLlegadaModal({ pedidoId, sucId, key, rows: rows ?? [] });
    }, [busyAction, items, fetchItems]);

    const handleLlegadaConfirm = useCallback(async ({ cajasDanadas, cajasFaltantes, nota, electrolitFaltantes = null, especialesLlegadas = null, cajasExtra = 0, cajasExtraNotas = null }) => {
        if (!llegadaModal) return;
        const { pedidoId, sucId, key, rows } = llegadaModal;
        setLlegadaModal(null);
        setBusyAction('llegada');
        try {
            // 1. Determinar tipo global
            const hasFalta  = cajasFaltantes.length > 0;
            const hasDanada = cajasDanadas.length > 0;
            const tipo = hasFalta && hasDanada ? 'mixto'
                       : hasFalta              ? 'falta_caja'
                       : hasDanada             ? 'caja_danada'
                       :                         'completa';

            // 2. Marcar items de cajas faltantes como falta_caja: true
            if (hasFalta) {
                const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'caja_map, pagina_items');
                if (pssErr) throw pssErr;
                const cajaMapDb     = pss?.caja_map    ?? {};
                const paginaItemsDb = pss?.pagina_items ?? {};

                let missingIds = [];
                if (Object.keys(paginaItemsDb).length > 0) {
                    const missingPages = cajasFaltantes.flatMap(n => cajaMapDb[String(n)] ?? []);
                    missingIds = missingPages.flatMap(p => paginaItemsDb[String(p)] ?? []);
                } else if (Object.keys(cajaMapDb).length > 0) {
                    // pagina_items vacío (pedido legacy) — recomputar con el mismo método del PDF y persistir
                    const pageGroups = await getExactPageGroups(sucId, rows);
                    const recomputed = {};
                    pageGroups.forEach((pg, idx) => { recomputed[String(idx + 1)] = pg.ids; });
                    await updatePedidoSucursalStatus(pedidoId, sucId, { pagina_items: recomputed });
                    const missingPages = cajasFaltantes.flatMap(n => cajaMapDb[String(n)] ?? []);
                    missingIds = missingPages.flatMap(p => recomputed[String(p)] ?? []);
                } else {
                    // Sin caja_map ni pagina_items — conservador: bloquear todos los ítems pendientes
                    const { data: allPending, error: allPendingErr } = await fetchPedidoItemsPendientesIds(pedidoId, sucId);
                    if (allPendingErr) throw allPendingErr;
                    missingIds = (allPending || []).map(r => r.id);
                }
                if (missingIds.length > 0) {
                    await updatePedidoItemsFaltaCaja(missingIds, true);
                }
            }

            // 2b. Marcar items de Electrolit faltantes como falta_caja: true
            if ((electrolitFaltantes ?? 0) > 0 && rows.length > 0) {
                const faltaElecItems = rows
                    .filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit') && !r.falta_caja && r.status !== 'recibido')
                    .slice(0, electrolitFaltantes);
                if (faltaElecItems.length > 0) {
                    await updatePedidoItemsFaltaCaja(faltaElecItems.map(r => r.id), true);
                }
            }

            // 2c. Marcar items de cajas especiales faltantes como falta_caja: true
            if (especialesLlegadas && Object.values(especialesLlegadas).some(v => v === 'faltante') && rows.length > 0) {
                const faltaLabels = new Set(Object.entries(especialesLlegadas).filter(([, v]) => v === 'faltante').map(([k]) => k));
                let ec = 1;
                const faltaIds = new Set();
                [...rows]
                    .filter(r => r.caja_especial && (r.cantidad_asignada ?? 0) > 0 && r.status !== 'recibido')
                    .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
                    .forEach(r => {
                        for (let i = 0; i < (r.cantidad_asignada ?? 1); i++) {
                            if (faltaLabels.has(`E${ec}`)) faltaIds.add(r.id);
                            ec++;
                        }
                    });
                if (faltaIds.size > 0) {
                    await updatePedidoItemsFaltaCaja([...faltaIds], true);
                }
            }

            // 3. Confirmar llegada física
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'confirmar_llegada', p_user_id: user?.id ?? null,
            });

            // 4. Guardar metadata de llegada
            await updatePedidoSucursalStatus(pedidoId, sucId, {
                llegada_tipo:  tipo,
                llegada_nota:  nota || null,
                falta_cajas:   cajasFaltantes,
                cajas_danadas: cajasDanadas,
                ...((hasFalta || hasDanada) ? { falta_caja_at: new Date().toISOString() } : {}),
                ...(electrolitFaltantes !== null ? {
                    electrolit_ok:        electrolitFaltantes === 0,
                    electrolit_faltantes: electrolitFaltantes,
                } : {}),
                ...(especialesLlegadas !== null ? { cajas_especiales_llegadas: especialesLlegadas } : {}),
            });

            useStaff.getState().appendAuditLog('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { tipo, cajasFaltantes, cajasDanadas, cajasExtra, cajasExtraNotas });
            setLlegadaStatus(prev => ({ ...prev, [key]: true }));

            // 5a. Notificar bodega si hay problema en cajas físicas
            if (tipo !== 'completa') {
                fetchBodegaBranchId().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const parts = [];
                    if (cajasDanadas.length > 0)  parts.push(`caja${cajasDanadas.length > 1 ? 's' : ''} dañada${cajasDanadas.length > 1 ? 's' : ''} ${cajasDanadas.map(n => `#${n}`).join(', ')}`);
                    if (cajasFaltantes.length > 0) parts.push(`caja${cajasFaltantes.length > 1 ? 's' : ''} faltante${cajasFaltantes.length > 1 ? 's' : ''} ${cajasFaltantes.map(n => `#${n}`).join(', ')}`);
                    const title   = `Problema en llegada — ${branchName}`;
                    const message = `${branchName} reporta: ${parts.join(' y ')}.${nota ? ' ' + nota : ''}`;
                    // Accionable para bodega (requiere reenvío) → con push
                    notifyBranch(b.branch_id, { type: 'PEDIDO_PROBLEMA', title, body: message, link: '/pedidos', push: true });
                }).catch(() => {});
            }

            // 5b. Notificar bodega si faltan cajas de Electrolit
            if ((electrolitFaltantes ?? 0) > 0) {
                fetchBodegaBranchId().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const cnt = electrolitFaltantes;
                    const title   = `Electrolit faltante — ${branchName}`;
                    const message = `${branchName} reporta ${cnt} caja${cnt > 1 ? 's' : ''} de Electrolit que no llegaron.`;
                    notifyBranch(b.branch_id, { type: 'PEDIDO_PROBLEMA', title, body: message, link: '/pedidos', push: true });
                }).catch(() => {});
            }

            // 5c. Notificar si cajas de más
            if (cajasExtra > 0) {
                fetchBodegaBranchId().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const notas = cajasExtraNotas ? Object.values(cajasExtraNotas).filter(Boolean) : [];
                    const title   = `Cajas de más — ${branchName}`;
                    const message = `${branchName} reporta ${cajasExtra} caja${cajasExtra > 1 ? 's' : ''} extra no esperada${cajasExtra > 1 ? 's' : ''}.${notas.length ? ' ' + notas.join(', ') : ''}`;
                    // Informativo: campana sin push
                    notifyBranch(b.branch_id, { type: 'PEDIDO_TRACKING', title, body: message, link: '/pedidos' });
                }).catch(() => {});
            }

            // 5d. Notificar si faltan cajas especiales
            if (especialesLlegadas && Object.values(especialesLlegadas).some(v => v === 'faltante')) {
                fetchBodegaBranchId().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const faltanE = Object.entries(especialesLlegadas).filter(([, v]) => v === 'faltante').map(([k]) => k);
                    const title   = `Caja especial faltante — ${branchName}`;
                    const message = `${branchName} reporta caja${faltanE.length > 1 ? 's' : ''} especial${faltanE.length > 1 ? 'es' : ''} no recibida${faltanE.length > 1 ? 's' : ''}: ${faltanE.join(', ')}.`;
                    notifyBranch(b.branch_id, { type: 'PEDIDO_PROBLEMA', title, body: message, link: '/pedidos', push: true });
                }).catch(() => {});
            }

            await loadActive();
            await fetchItems(key, pedidoId, sucId);
        } catch (e) { console.error('llegada confirm:', e); } finally { setBusyAction(null); }
    }, [llegadaModal, user, branchName, loadActive, fetchItems]);

    const handleReenviarCaja = useCallback(async (pedidoId, sucId, numero, cajasFaltantes, electrolitsFaltantes = 0, especialesFaltantes = []) => {
        setBusyAction('reenvio');
        try {
            const now = new Date().toISOString();
            // Leer historial actual para calcular ciclo
            const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'reenvios_historial');
            if (pssErr) throw pssErr;
            const historial = pss?.reenvios_historial ?? [];
            const ciclo     = historial.length + 1;
            const nuevoCiclo = { ciclo, cajas: cajasFaltantes, electrolits: electrolitsFaltantes, especiales: especialesFaltantes, sent_at: now, sent_by: user?.id ?? null, arrived_at: null, arrived_tipo: null, cajas_ok: [], cajas_danadas: [], cajas_aun_faltantes: [] };

            await updatePedidoSucursalStatus(pedidoId, sucId, {
                reenvio_bodega_at:  now,
                reenvio_por:        user?.id ?? null,
                reenvios_historial: [...historial, nuevoCiclo],
            });

            useStaff.getState().appendAuditLog('PEDIDO_REENVIO_CAJA', pedidoId, { sucursal_id: sucId, ciclo, cajas: cajasFaltantes });

            fetchBranchIdForSucursal(sucId).then(({ data: m }) => {
                if (!m?.branch_id) return;
                const cajasStr = cajasFaltantes.map(n => `#${n}`).join(', ');
                // Accionable (deben confirmar llegada) → con push
                notifyBranch(m.branch_id, { type: 'PEDIDO_REENVIO', title: `Reenvío en camino — pedido #${numero}`, body: `La caja ${cajasStr} del pedido #${numero} ya salió de bodega. Confirma la llegada cuando la recibas.`, link: '/pedidos', push: true });
            }).catch(() => {});
            await loadActive();
            setCrearRutaOpen([`${pedidoId}__${sucId}`]);
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    // Abre el modal de confirmación de llegada de reenvío (sustituye el botón ciego anterior)
    const handleSegundaLlegada = useCallback((pedidoId, sucId, key, reenviosHistorial, faltaCajasLegacy = [], cajaMap = {}) => {
        const historial = reenviosHistorial ?? [];
        const cicloIdx  = historial.findIndex(c => !c.arrived_at);
        const ciclo     = cicloIdx >= 0 ? historial[cicloIdx] : historial[historial.length - 1];
        if (!ciclo) {
            if (faltaCajasLegacy.length > 0) {
                setReenvioLlegadaModal({ pedidoId, sucId, key, ciclo: 1, cajasCiclo: faltaCajasLegacy, electrolitCount: 0, especialesList: [], historial: [], cajaMap });
            } else {
                useToastStore.getState().showToast('Sin reenvío pendiente', 'No hay ciclo de reenvío registrado para confirmar.', 'info');
            }
            return;
        }
        setReenvioLlegadaModal({
            pedidoId, sucId, key,
            ciclo:           ciclo.ciclo,
            cajasCiclo:      ciclo.cajas       ?? [],
            electrolitCount: ciclo.electrolits ?? 0,
            especialesList:  ciclo.especiales  ?? [],
            historial,
            cajaMap,
        });
    }, []);

    const handleReenvioLlegadaConfirm = useCallback(async ({ cajasOk, cajasDanadas, cajasFaltantes, nota, electrolitOk = true, especialesAun = [] }) => {
        if (!reenvioLlegadaModal) return;
        const { pedidoId, sucId, key, ciclo, historial, electrolitCount = 0, especialesList = [] } = reenvioLlegadaModal;
        setReenvioLlegadaModal(null);
        setBusyAction('segunda_llegada');
        try {
            const now = new Date().toISOString();
            const hasFalta = cajasFaltantes.length > 0;
            const arrived_tipo = hasFalta && cajasDanadas.length > 0 ? 'mixto'
                               : hasFalta                            ? 'falta_caja'
                               : cajasDanadas.length > 0             ? 'caja_danada'
                               :                                        'ok';

            // Actualizar el ciclo correspondiente en el historial
            const nuevoHistorial = historial.map(c =>
                c.ciclo === ciclo
                    ? { ...c, arrived_at: now, arrived_tipo, arrived_por: user?.id ?? null, cajas_ok: cajasOk, cajas_danadas: cajasDanadas, cajas_aun_faltantes: cajasFaltantes, nota: nota || null }
                    : c
            );

            await updatePedidoSucursalStatus(pedidoId, sucId, {
                segunda_llegada_at: now,
                reenvios_historial: nuevoHistorial,
                falta_cajas: hasFalta ? cajasFaltantes : [],
                // Escribir estado electrolit al DB cuando estaban en este ciclo de reenvío
                ...(electrolitCount > 0 ? { electrolit_ok: electrolitOk === true, electrolit_faltantes: electrolitOk ? 0 : electrolitCount } : {}),
            });

            useStaff.getState().appendAuditLog('PEDIDO_REENVIO_LLEGADA', pedidoId, { ciclo, arrived_tipo, cajasOk, cajasDanadas, cajasFaltantes });

            // Cargar mapa de páginas + estado actual de especiales para merge
            const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId,
                'caja_map, pagina_items, cajas_recibidas, cajas_danadas, cajas_especiales_llegadas');
            if (pssErr) throw pssErr;
            const cajaMapDb     = pss?.caja_map    ?? {};
            const paginaItemsDb = pss?.pagina_items ?? {};

            const getItemIds = (cajas) => {
                if (!Object.keys(paginaItemsDb).length) return [];
                return cajas.flatMap(n => (cajaMapDb[String(n)] ?? []).flatMap(p => paginaItemsDb[String(p)] ?? []));
            };

            // Limpiar falta_caja en ítems de cajas que SÍ llegaron (OK o dañadas)
            const cajasLlegaron = [...cajasOk, ...cajasDanadas];
            if (cajasLlegaron.length > 0) {
                const llegadaIds = getItemIds(cajasLlegaron);
                if (llegadaIds.length > 0) {
                    await updatePedidoItemsFaltaCaja(llegadaIds, false);
                }
            }

            // Mantener falta_caja: true solo en cajas que AÚN no llegaron
            if (hasFalta) {
                const mIds = getItemIds(cajasFaltantes);
                if (mIds.length > 0) await updatePedidoItemsFaltaCaja(mIds, true);
            }

            // Limpiar falta_caja en electrolits si llegaron en este reenvío
            if (electrolitCount > 0 && electrolitOk) {
                const { data: faltaElec, error: faltaElecErr } = await fetchPedidoItemsFaltaElectrolit(pedidoId, sucId);
                if (faltaElecErr) throw faltaElecErr;
                const elecIds = (faltaElec || []).filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit')).map(r => r.id);
                if (elecIds.length > 0) await updatePedidoItemsFaltaCaja(elecIds, false);
            }

            // Especiales: actualizar cajas_especiales_llegadas en DB + limpiar falta_caja en items
            const espLlegaron = (especialesList ?? []).filter(l => !especialesAun.includes(l));
            if (espLlegaron.length > 0 || especialesAun.length > 0) {
                // Merge: marcar las que llegaron como 'ok', las aún faltantes siguen 'faltante'
                const mergedEsp = { ...(pss?.cajas_especiales_llegadas ?? {}) };
                for (const label of espLlegaron)  mergedEsp[label] = 'ok';
                for (const label of especialesAun) mergedEsp[label] = 'faltante';
                await updatePedidoSucursalStatus(pedidoId, sucId, { cajas_especiales_llegadas: mergedEsp });

                // Limpiar falta_caja en items de especiales que sí llegaron
                if (espLlegaron.length > 0) {
                    const { data: faltaEsp, error: faltaEspErr } = await fetchPedidoItemsFaltaEspeciales(pedidoId, sucId);
                    if (faltaEspErr) throw faltaEspErr;
                    if ((faltaEsp ?? []).length > 0) {
                        // Si todas llegaron → limpiar todos; si algunas aún faltan → limpiar solo las que llegaron (proporcionalmente)
                        const idsToClean = especialesAun.length === 0
                            ? faltaEsp.map(r => r.id)
                            : faltaEsp.slice(0, Math.round(faltaEsp.length * espLlegaron.length / (especialesList ?? []).length)).map(r => r.id);
                        if (idsToClean.length > 0) await updatePedidoItemsFaltaCaja(idsToClean, false);
                    }
                }
            }

            // Notificar bodega si aún hay pendientes de reenvío
            const hayAunPendiente = hasFalta || !electrolitOk || especialesAun.length > 0;
            if (hayAunPendiente) {
                fetchBranchIdForSucursal(sucId).then(({ data: m }) => {
                    if (!m?.branch_id) return;
                    const partes = [];
                    if (hasFalta) partes.push(`Cajas: ${cajasFaltantes.map(n => `#${n}`).join(', ')}`);
                    if (!electrolitOk) partes.push('Electrolit aún pendiente');
                    if (especialesAun.length > 0) partes.push(`Especiales: ${especialesAun.join(', ')}`);
                    notifyBranch(m.branch_id, { type: 'PEDIDO_PROBLEMA', title: `Aún hay pendientes — reenvío ${ciclo}`, body: `${branchName} reporta que aún no llegó: ${partes.join(' | ')}. Se requiere otro envío.`, link: '/pedidos', push: true });
                }).catch(() => {});
            }

            await loadActive();
            const freshItems = await fetchItems(key, pedidoId, sucId);

            // Auto-abrir RecepcionModal para los ítems de las cajas/especiales/electrolits que sí llegaron
            const pendingArrived  = (freshItems || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja);
            const hasFaltaItemsNow = (freshItems || []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
            if (pendingArrived.length > 0) {
                const pedidoRow = activeRows.find(r => r.pedido_id === pedidoId && r.erp_sucursal_id === sucId);
                setModal({
                    pedido: { id: pedidoId, numero: pedidoRow?.numero ?? null, codigo: pedidoRow?.codigo ?? null },
                    sucId, key,
                    rows:           pendingArrived,
                    cajaDanada:     cajasDanadas,
                    cajaMap:        cajaMapDb,
                    paginaItems:    paginaItemsDb,
                    cajasRecibidas: pss?.cajas_recibidas ?? [],
                    faltaCajas:     hasFalta ? cajasFaltantes : [],
                    hasFaltaItems:  hasFaltaItemsNow,
                });
            }
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [reenvioLlegadaModal, user, branchName, loadActive, fetchItems, activeRows]);

    const handleEntregarStop = useCallback(async (stopId, rutaId, sucId) => {
        try {
            const { error } = await updateRutaPedidoEntregado(stopId, user?.id);
            if (error) throw error;
            useStaff.getState().appendAuditLog('RUTA_PARADA_ENTREGADA', stopId, { sucursal_id: sucId });
            const { data: mapa, error: mapaErr } = await fetchBranchIdForSucursal(sucId);
            if (mapaErr) throw mapaErr;
            if (mapa?.branch_id) {
                // Llegada física = accionable → con push
                notifyBranch(mapa.branch_id, { type: 'PEDIDO_LLEGADA', title: 'Conductor llegó a tu sucursal', body: 'Confirma la recepción de tu pedido.', link: '/pedidos', push: true });
            }
            loadActiveRutas();
        } catch (e) { console.error(e); }
    }, [user, loadActiveRutas]);

    const handleMarkErp = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        setBusyAction('erp');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId });
            setErpStatus(prev => ({ ...prev, [key]: true }));
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [busyAction, user, loadActive]);

    const openModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja);
        if (!rows.length) return;
        const hasFaltaItems = (loaded || []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        const activeRow  = activeRows.find(r => r.pedido_id === pedidoId && r.erp_sucursal_id === sucId);
        // cajas_danadas y falta_cajas son ahora arrays independientes (soporta 'mixto')
        const cajaDanada = activeRow?.cajas_danadas ?? [];
        const faltaCajas = activeRow?.falta_cajas   ?? [];
        const cajaMap    = activeRow?.caja_map       ?? {};

        // Load pagina_items + cajas_recibidas only when caja_map is available
        let paginaItems = {}, cajasRecibidas = [];
        if (Object.keys(cajaMap).length > 0) {
            const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'pagina_items, cajas_recibidas');
            if (pssErr) console.error('openModal: fetch pedido_sucursal_status failed:', pssErr.message);
            paginaItems    = pss?.pagina_items    ?? {};
            cajasRecibidas = pss?.cajas_recibidas ?? [];
        }

        const especialesLlegadas = activeRow?.cajas_especiales_llegadas ?? {};
        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada, cajaMap, paginaItems, cajasRecibidas, faltaCajas, hasFaltaItems, especialesLlegadas });
    }, [fetchItems, activeRows]);

    const openReenvioModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada: [] });
    }, [fetchItems]);

    const handleReportarDiferencias = useCallback(async (pedidoId, sucId) => {
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'reportar_diferencias', p_user_id: user?.id ?? null,
            });
        } catch (e) { console.error('lifecycle reportar_diferencias:', e); }
        useStaff.getState().appendAuditLog('PEDIDO_DIFERENCIAS_REPORTADAS', pedidoId, { sucursal_id: sucId });
        // loadActive() lo llama el caller (onConfirmed) para no duplicar el fetch
    }, [user]);

    // 7A.1: cierre de bodega tras resolver todas las diferencias — llamado
    // desde DifSection.jsx (bloque "Cierre de bodega").
    const handleCorregirBodega = useCallback(async (pedidoId, sucId, nota) => {
        setBusyAction('corr_bodega');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'corregir_bodega', p_user_id: user?.id ?? null, p_nota: nota || null,
            });
            useStaff.getState().appendAuditLog('PEDIDO_CORREGIDO_BODEGA', pedidoId, { sucursal_id: sucId, nota });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    // 7A.1: confirmación de sucursal tras el "Marcar corregido" de bodega —
    // llamado desde DifSection.jsx (bloque "Cierre de bodega").
    const handleConfirmarCorreccion = useCallback(async (pedidoId, sucId) => {
        setBusyAction('confirmar_corr');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'confirmar_correccion', p_user_id: user?.id ?? null,
            });
            useStaff.getState().appendAuditLog('PEDIDO_CORRECCION_CONFIRMADA', pedidoId, { sucursal_id: sucId });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    const handleResolverItem = useCallback(async (pedidoId, sucId, itemId, action, tipo, nota) => {
        setBusyAction(`res_${itemId}`);
        try {
            const { error } = await supabase.rpc('resolve_pedido_item', {
                p_item_id: itemId, p_action: action,
                p_user_id: user?.id ?? null,
                p_tipo:    tipo ?? null,
                p_nota:    nota ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_RESOLUCION_${action.toUpperCase()}`, pedidoId, { item_id: itemId, tipo, nota });
            const key = `act_${pedidoId}_${sucId}`;
            await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);
        } catch (e) { console.error('resolverItem:', e); } finally { setBusyAction(null); }
    }, [user, loadActive, fetchItems]);

    // ── Derived ───────────────────────────────────────────────────────────────

    const searchLower   = useMemo(() => searchTerm.toLowerCase(), [searchTerm]);
    const filterOptions = useMemo(() => ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` })), []);

    const hasObservacion = useCallback((r) =>
        r.pedido_status === 'parcial' ||
        (r.llegada_tipo && r.llegada_tipo !== 'completa') ||
        (r.falta_cajas?.length  > 0) ||
        (r.cajas_danadas?.length > 0),
    []);

    // Group activeRows by pedido to detect if ALL sucursales for a pedido are preparado
    const pedidoStageMap = useMemo(() => {
        const map = new Map();
        activeRows.forEach(row => {
            const prev = map.get(row.pedido_id) ?? { allFinalized: true, anyActive: false, anyFinalized: false };
            map.set(row.pedido_id, {
                allFinalized:  prev.allFinalized  && !!row.finalizado_at,
                anyActive:     prev.anyActive     || (!!row.iniciado_at && !row.finalizado_at),
                anyFinalized:  prev.anyFinalized  || !!row.finalizado_at,
            });
        });
        return map;
    }, [activeRows]);

    // En ruta (transito) → procesando → con observación → erp
    const STAGE_ORDER = { transito: 0, preparando: 1, contando: 2, pausado: 3, preparado: 4, sin_iniciar: 5, erp: 7 };

    const filteredRows = useMemo(() => {
        let rows = activeRows;
        // guard cliente para branch: nunca mostrar datos de otra sucursal aunque la query DB llegue tarde
        if (isBranch && erpSucursalId) rows = rows.filter(r => r.erp_sucursal_id === erpSucursalId);
        if (filterSuc) rows = rows.filter(r => r.erp_sucursal_id === Number(filterSuc));

        if (filterStatus === 'completado') {
            rows = rows.filter(r => r.pedido_status === 'completado');
        } else if (filterStatus === 'observacion') {
            rows = rows.filter(r => hasObservacion(r) && r.pedido_status !== 'completado');
        } else if (filterStatus !== 'all') {
            rows = rows.filter(r => r.pedido_status === filterStatus);
        } else {
            // Ocultar completados sin problemas; mantener los que tienen diferencias/observación
            rows = rows.filter(r => r.pedido_status !== 'completado' || hasObservacion(r));
        }

        if (filterDate) {
            const [desde, hasta] = filterDate.split('|');
            rows = rows.filter(r => {
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
        }
        if (searchLower) rows = rows.filter(r => String(r.numero).includes(searchLower) || tokenMatch(searchLower, r.notes));
        const uid = String(user?.id ?? '');
        return [...rows].sort((a, b) => {
            // 1. Mío primero — lo inicié o lo creé yo
            const mineA = uid && (String(a.iniciado_por) === uid || String(a.created_by) === uid);
            const mineB = uid && (String(b.iniciado_por) === uid || String(b.created_by) === uid);
            if (mineA !== mineB) return mineA ? -1 : 1;
            // 2. Stage
            const stageA = getBranchStage(a, a.pedido_status);
            const stageB = getBranchStage(b, b.pedido_status);
            const baseA = STAGE_ORDER[stageA] ?? 5;
            const baseB = STAGE_ORDER[stageB] ?? 5;
            const sa = (hasObservacion(a) && baseA > 0 && baseA < 7) ? 6 : baseA;
            const sb = (hasObservacion(b) && baseB > 0 && baseB < 7) ? 6 : baseB;
            // 3. Fecha más reciente
            return sa !== sb ? sa - sb : new Date(b.created_at) - new Date(a.created_at);
        });
    }, [activeRows, filterSuc, filterStatus, filterDate, searchLower, hasObservacion, user]); // eslint-disable-line

    const sucursalCounts = useMemo(() => {
        const [desde, hasta] = (filterDate ?? '').split('|');
        // branch: solo muestra su propia sucursal en las cards de stats
        const baseRows = (isBranch && erpSucursalId)
            ? activeRows.filter(r => r.erp_sucursal_id === erpSucursalId)
            : activeRows;
        return ERP_ORDER.map(id => {
            const rows = baseRows.filter(r => {
                if (r.erp_sucursal_id !== id) return false;
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
            return { id, name: ERP_NAMES[id] ?? `Suc. ${id}`, total: rows.length };
        }).filter(s => s.total > 0);
    }, [activeRows, filterDate, isBranch, erpSucursalId]);

    // Agrupa filteredRows: rutas primero (con sus rows hijas), luego normales
    const renderGroups = useMemo(() => {
        const groups = [];
        const addedRutas = new Set();
        const normalRows = [];
        for (const row of filteredRows) {
            const ri = pedidoRutaMap.get(row.pedido_id);
            if (ri) {
                if (!addedRutas.has(ri.ruta.id)) {
                    addedRutas.add(ri.ruta.id);
                    const rutaRows = filteredRows.filter(r => pedidoRutaMap.get(r.pedido_id)?.ruta.id === ri.ruta.id);
                    groups.push({ isRuta: true, ruta: ri.ruta, driverOnline: ri.driverOnline, rows: rutaRows });
                }
            } else {
                normalRows.push(row);
            }
        }
        if (normalRows.length) groups.push({ isRuta: false, ruta: null, rows: normalRows });
        // Ruta donde soy conductor va al tope
        const uid = String(user?.id ?? '');
        groups.sort((a, b) => {
            if (!a.isRuta || !b.isRuta) return 0;
            const aMe = uid && String(a.ruta?.conductor_id) === uid;
            const bMe = uid && String(b.ruta?.conductor_id) === uid;
            return aMe === bMe ? 0 : aMe ? -1 : 1;
        });
        return groups;
    }, [filteredRows, pedidoRutaMap, user]);

    return {
        user, isBranch, canEdit,
        erpSucursalId, branchName,
        filterSuc, setFilterSuc,
        filterStatus, setFilterStatus,
        filterDate, setFilterDate,
        activeRows,
        loading,
        expanded,
        items,
        eventosMap,
        loadingItems,
        llegadaStatus,
        erpStatus,
        busyAction,
        busyLifecycle,
        crearRutaOpen, setCrearRutaOpen,
        modal, setModal,
        rutaMapOpen, setRutaMapOpen,
        pedidoRutaMap,
        llegadaModal, setLlegadaModal,
        reenvioLlegadaModal, setReenvioLlegadaModal,
        reenviarConfirmModal, setReenviarConfirmModal,
        finalizarModal, setFinalizarModal,
        newAlert, setNewAlert,
        pauseModal, setPauseModal,
        pauseHistory,
        pauseRazon, setPauseRazon,
        pauseComment, setPauseComment,
        kioskLunch,
        apoyoMap,
        apoyoModal, setApoyoModal,
        cardStats,
        anularModal, setAnularModal,
        busyAnular,
        printingPdf,
        programarModal, setProgramarModal,
        savingProgramar,
        empMap,
        loadActive,
        loadActiveRutas,
        fetchItems,
        toggleExpand,
        handleLifecycle,
        handleProgramarEntrega,
        handlePrintPdf,
        openPauseModal,
        confirmPause,
        handleApoyoSuccess,
        handleAnular,
        openFinalizarModal,
        handleFinalizarConCajas,
        handleLlegada,
        handleLlegadaConfirm,
        handleReenviarCaja,
        handleSegundaLlegada,
        handleReenvioLlegadaConfirm,
        handleEntregarStop,
        handleMarkErp,
        openModal,
        openReenvioModal,
        handleReportarDiferencias,
        handleCorregirBodega,
        handleConfirmarCorreccion,
        handleResolverItem,
        filterOptions,
        hasObservacion,
        pedidoStageMap,
        filteredRows,
        sucursalCounts,
        renderGroups,
    };
}
