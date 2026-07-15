import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tokenMatch } from '../../utils/searchUtils';
import { supabase } from '../../supabaseClient';
import { signPhotosDeep } from '../../utils/storageFiles';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, PackageCheck, PackageX, Play, Home,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag, ShieldAlert, UserCircle2,
    Coffee, Users, Clock, ClipboardList, Bell, MessageSquare,
    UserPlus, ScanLine, Inbox, AlertCircle, CheckSquare, FileDown, Box, Zap, Map as MapIcon,
    CalendarClock, Ban, Star, Search, Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { notifyBranch } from '../../utils/notify';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import RecepcionModal from './RecepcionModal';
import PedidoModal from './PedidoModal';
import LlegadaModal from './LlegadaModal';
import ReenvioLlegadaModal from './ReenvioLlegadaModal';
import FinalizarCajasModal from './FinalizarCajasModal';
import CrearRutaModal    from './CrearRutaModal';
import RutaMapModal      from './RutaMapModal';
import ProgramarEntregaModal from './ProgramarEntregaModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import PeriodPicker from '../../components/common/PeriodPicker';
import { printFromPedidoItems, getExactPageGroups } from '../../utils/pedidoPrint';
import { StageAnim } from './tabpedidos/StageAnims';
import EmpChip from './tabpedidos/EmpChip';
import StagePill from './tabpedidos/StagePill';
import SucPill from './tabpedidos/SucPill';
import PauseModal from './tabpedidos/PauseModal';
import AnularModal from './tabpedidos/AnularModal';
import ApoioScanModal from './tabpedidos/ApoioScanModal';
import { PAUSE_REASONS } from './tabpedidos/constants';
import { fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage, currentMonthRange } from './tabpedidos/helpers';
import ItemSections from './tabpedidos/ItemSections';
import LifecycleTimeline from './tabpedidos/LifecycleTimeline';
import DifSection from './tabpedidos/DifSection';
import PostCompletionSection from './tabpedidos/PostCompletionSection';
import ReceptionActions from './tabpedidos/ReceptionActions';
import FilterPill from './tabpedidos/FilterPill';
import {
    fetchEmployeeBranchId, fetchSucursalIdForBranch, fetchBodegaBranchId, fetchBranchIdForSucursal,
    fetchBranchInfoForSucursal, fetchBranchNamesForSucursales, fetchApoyoForPedidos, fetchApoyoForPedido,
    fetchActiveRutas, fetchRutaLocations, upsertRutaLocation, updateRutaStatus, updateRutaPedidoEntregado,
    fetchPedidoItemsAll, fetchPedidoItemEventosAll, fetchPedidoItemsPendientesIds,
    fetchPedidoItemsFaltaElectrolit, fetchPedidoItemsFaltaEspeciales, updatePedidoItemsFaltaCaja,
    fetchPedidoSucursalStatus, updatePedidoSucursalStatus, fetchPausaHistorial, fetchAttendancePunches,
} from '../../data/pedidos';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE = 30;
const MINI_PAGE = 15;
const DONE_STATUSES = ['completado', 'parcial', 'anulado'];

const SUC_COLORS = {
    1: 'bg-blue-100 text-blue-700 border-blue-200',
    2: 'bg-violet-100 text-violet-700 border-violet-200',
    3: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    4: 'bg-amber-100 text-amber-700 border-amber-200',
    5: 'bg-rose-100 text-rose-700 border-rose-200',
    6: 'bg-slate-100 text-slate-600 border-slate-200',
    7: 'bg-teal-100 text-teal-700 border-teal-200',
};

const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',     color: 'slate',   icon: Package      },
    preparando:  { label: 'En preparación',  color: 'blue',    icon: Activity     },
    pausado:     { label: 'Pausado',         color: 'amber',   icon: Pause        },
    preparado:   { label: 'Listo p/ envío',  color: 'violet',  icon: CheckCircle2 },
    transito:    { label: 'En tránsito',     color: 'indigo',  icon: Truck        },
    contando:    { label: 'Cajas recibidas', color: 'teal',    icon: PackageCheck },
    erp:         { label: 'Sis. Ventas',      color: 'emerald', icon: Database     },
};

const COLOR_CLS = {
    slate:   { bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-200'   },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200'  },
    teal:    { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'    },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

const PEDIDO_PILL  = { confirmado: 'bg-blue-100 text-blue-700 border-blue-200', enviado: 'bg-indigo-100 text-indigo-700 border-indigo-200', parcial: 'bg-amber-100 text-amber-700 border-amber-200', completado: 'bg-emerald-100 text-emerald-700 border-emerald-200', anulado: 'bg-red-100 text-red-600 border-red-200' };
const PEDIDO_LABEL = { confirmado: 'Por despachar', enviado: 'En ruta', parcial: 'Con diferencias', completado: 'Completado', anulado: 'Anulado' };

// PAUSE_REASONS: extraído a ./tabpedidos/constants.js (Bloque 6.C) —
// importado arriba.

// ─── Helpers ─────────────────────────────────────────────────────────────────

// fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage, calcSolicitado,
// fmtRegla, currentMonthRange: extraídos a ./tabpedidos/helpers.js (Bloque
// 6.C) — importados arriba (calcSolicitado y fmtRegla solo se usan dentro
// de los componentes ya extraídos, no hace falta reimportarlos acá).

// ItemSection/ItemSections, LifecycleTimeline/PauseBadge, DifSection,
// PostCompletionSection, ReceptionActions, FilterPill: extraídos a
// ./tabpedidos/ (Bloque 6.C) — importados arriba.

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPedidos({ searchTerm = '' }) {
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

    // Sin caller hoy — gap conocido de producto (plan 7A.1: backend completo
    // desde 2026-06-21, falta botón/modal de entrada en la UI). No borrar.
    // eslint-disable-next-line no-unused-vars
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

    // Mismo gap que handleCorregirBodega — ver 7A.1. No borrar.
    // eslint-disable-next-line no-unused-vars
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

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 gap-2 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando pedidos…</span>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            <AnimatePresence>
                {newAlert && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[12px] font-semibold shadow-sm">
                        <Send size={13} />¡Nuevo pedido #{newAlert.numero} en camino a {branchName}!
                        <button onClick={() => setNewAlert(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={13} /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── FILTROS + CARDS SUCURSALES ─────────────────────────── */}
            <div>
                {/* Fila única: cards por sucursal (izq) + FilterPill (der) */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {/* Bodega / alcance todos: card clicable por sucursal */}
                    {!isBranch && sucursalCounts.map(({ id, name, total }) => {
                        const active = filterSuc === String(id);
                        return (
                            <button
                                key={id}
                                onClick={() => setFilterSuc(v => v === String(id) ? '' : String(id))}
                                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${
                                    active
                                        ? 'bg-indigo-50 border-indigo-300 shadow-md shadow-indigo-100/80 -translate-y-px'
                                        : 'bg-white border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/40'
                                }`}
                            >
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-white' : 'bg-indigo-50'}`}>
                                    <Building2 size={15} className="text-indigo-600" />
                                </div>
                                <div className="text-left">
                                    <div className={`text-[22px] font-black leading-none tabular-nums ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{total}</div>
                                    <div className="text-[10px] font-bold text-slate-600">{name}</div>
                                    <div className="text-[9px] text-slate-500">pedidos este mes</div>
                                </div>
                                {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                            </button>
                        );
                    })}
                    {/* Sucursal (BRANCH): card propia, solo informativa */}
                    {isBranch && sucursalCounts.length > 0 && (() => {
                        const own = sucursalCounts[0];
                        return (
                            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50">
                                    <Building2 size={15} className="text-indigo-600" />
                                </div>
                                <div className="text-left">
                                    <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">{own.total}</div>
                                    <div className="text-[10px] font-bold text-slate-600">{own.name}</div>
                                    <div className="text-[9px] text-slate-500">pedidos este mes</div>
                                </div>
                            </div>
                        );
                    })()}
                    <div className="ml-auto">
                        <FilterPill isBranch={isBranch} filterSuc={filterSuc} setFilterSuc={setFilterSuc} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOptions={filterOptions} filterDate={filterDate} setFilterDate={setFilterDate} />
                    </div>
                </div>

                {filteredRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[260px] animate-in fade-in zoom-in-95 duration-700">
                        <div className="relative flex flex-col items-center text-center">
                            <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-20 bg-blue-400" />
                            <div className="relative z-10 w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-4 bg-white/70 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] text-blue-400">
                                <Inbox size={34} strokeWidth={1.5} />
                            </div>
                            <h3 className="font-bold text-[18px] text-slate-700 tracking-tight">Sin pedidos activos</h3>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                    {renderGroups.map((group) => {
                        // Dentro de una ruta: no-entregadas primero (por orden), entregadas al fondo
                        const displayRows = group.isRuta
                            ? [...group.rows].sort((a, b) => {
                                const sa = pedidoRutaMap.get(a.pedido_id)?.stop;
                                const sb = pedidoRutaMap.get(b.pedido_id)?.stop;
                                const doneA = sa?.entregado_at ? 1 : 0;
                                const doneB = sb?.entregado_at ? 1 : 0;
                                if (doneA !== doneB) return doneA - doneB;
                                return (sa?.orden_entrega ?? 99) - (sb?.orden_entrega ?? 99);
                            })
                            : group.rows;
                        const cards = displayRows.map(row => {
                            const stage      = getBranchStage(row, row.pedido_status);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isExp      = expanded === cardKey;
                            const lcKey      = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy   = busyLifecycle === lcKey;

                            const canActuar = canEdit && !isBranch; // GESTIONAR + Alcance TODOS

                            const canIniciar       = canActuar && !isBranch && stage === 'sin_iniciar' && row.pedido_status === 'confirmado';
                            const canPausar        = canActuar && !isBranch && stage === 'preparando';
                            const canReanudar      = canActuar && !isBranch && stage === 'pausado';
                            // Botón aparece por sucursal cuando esa ya está lista (preparado), sin esperar a las demás
                            const canMarcarEnRuta  = canActuar && !isBranch && stage === 'preparado' && row.pedido_status === 'confirmado';

                            const creator      = row.created_by               ? empMap.get(row.created_by)               : null;
                            const iniciador    = row.iniciado_por             ? empMap.get(row.iniciado_por)             : null;
                            const finalizador  = row.finalizado_por           ? empMap.get(row.finalizado_por)           : null;
                            const enviador     = row.enviado_por              ? empMap.get(row.enviado_por)              : null;
                            const llegadaEmp   = row.llegada_fisica_por       ? empMap.get(row.llegada_fisica_por)       : null;
                            const conteoEmp    = row.conteo_por               ? empMap.get(row.conteo_por)               : null;
                            const erpEmp       = row.recibido_erp_por         ? empMap.get(row.recibido_erp_por)         : null;
                            const difsEmp      = row.diferencias_reportadas_por ? empMap.get(row.diferencias_reportadas_por) : null;
                            const corrConfEmp  = row.confirmado_correccion_por  ? empMap.get(row.confirmado_correccion_por)  : null;
                            const reenvioEmp   = row.reenvio_por                ? empMap.get(row.reenvio_por)                : null;

                            const elapsedPrep  = stage === 'preparando' ? fmtMin(Math.max(0, (elapsed(row.iniciado_at) ?? 0) - (row.min_pausado_total ?? 0))) : null;
                            const elapsedPause = stage === 'pausado'    ? fmtMin(elapsed(row.pausado_at)) : null;
                            const elapsedTrans = stage === 'transito'   ? fmtMin(elapsed(row.finalizado_at)) : null;

                            const apoyoBucket  = apoyoMap[cardKey] ?? { preparacion: [], recepcion: [] };
                            const prepApoyo    = apoyoBucket.preparacion ?? [];
                            const recepApoyo   = apoyoBucket.recepcion   ?? [];
                            const isApoyoBodega = prepApoyo.some(a => a.id === user?.id);

                            const canFinalizar = canActuar && !isBranch && stage === 'preparando';

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            const canAnular = canActuar && !isBranch
                                && row.pedido_status === 'confirmado'
                                && !(pedidoStageMap.get(row.pedido_id)?.anyFinalized);

                            // Solo fade cuando completado: parcial queda visible (pendiente corrección)
                            const isFadedOut = row.pedido_status === 'completado' && !!row.recibido_erp_at;  // sutil: solo baja un poco la opacidad

                            return (
                                <motion.div
                                    key={cardKey}
                                    layout
                                    initial={{ opacity: 0, scale: 0.97 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                    className={`${GLASS} cursor-pointer select-none ${
                                        stage === 'pausado'
                                            ? 'ring-2 ring-amber-400 shadow-[0_4px_20px_rgba(251,191,36,0.25)]'
                                            : hasObservacion(row) && row.pedido_status !== 'completado'
                                                ? 'ring-2 ring-orange-400 shadow-[0_4px_20px_rgba(249,115,22,0.18)]'
                                                : isFadedOut
                                                    ? 'opacity-80'
                                                    : ''
                                    }`}
                                    style={{ overflow: 'visible' }}
                                    onClick={() => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                >
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                                        {stage === 'pausado' && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-white shrink-0 shadow-sm animate-pulse">
                                                ⏸ Pausado
                                            </span>
                                        )}
                                        <span className="text-[13px] font-black text-slate-800 tabular-nums shrink-0">
                                            {row.codigo ?? `#${row.numero}`}
                                        </span>
                                        <SucPill sucId={row.erp_sucursal_id} />
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[row.pedido_status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                            {PEDIDO_LABEL[row.pedido_status] ?? row.pedido_status}
                                        </span>
                                        <span className="ml-auto text-[10px] text-slate-500 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                        {isExp ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-[11px] text-slate-600 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                {cardStats[cardKey].enviados} enviados
                                            </span>
                                            {(cardStats[cardKey].agotamiento ?? 0) > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    {cardStats[cardKey].agotamiento} stock insuf.
                                                </span>
                                            )}
                                            {cardStats[cardKey].sinStock > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    {cardStats[cardKey].sinStock} sin stock
                                                </span>
                                            )}
                                            {cardStats[cardKey].porRegla > 0 && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    <AlertTriangle size={9} />{cardStats[cardKey].porRegla} por regla
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Apoyo preparación (bodega) */}
                                    {prepApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide shrink-0">Prep:</span>
                                            {prepApoyo.map(a => (
                                                <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-white border border-slate-200 shadow-sm">
                                                    {a.photo_url
                                                        ? <img src={a.photo_url} alt={a.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                                                        : <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0"><UserCircle2 size={10} className="text-slate-500" /></span>
                                                    }
                                                    <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">{a.name}</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Lifecycle Timeline */}
                                    <div className="border-t border-slate-100 px-3 pt-2 pb-1.5">
                                        {(() => {
                                            const rutaInfo = pedidoRutaMap.get(row.pedido_id);
                                            const rtStop   = rutaInfo?.stop ?? null;
                                            const rtCond   = rutaInfo?.ruta?.conductor_id ? empMap.get(rutaInfo.ruta.conductor_id) ?? null : null;
                                            return (
                                                <LifecycleTimeline row={row} stage={stage} creatorEmp={creator} iniciadorEmp={iniciador} finalizadorEmp={finalizador} enviadorEmp={enviador} llegadaEmp={llegadaEmp} conteoEmp={conteoEmp} reenvioEmp={reenvioEmp} erpEmp={erpEmp} difsEmp={difsEmp} corrConfEmp={corrConfEmp} receptionApoyo={recepApoyo} isBranch={isBranch} empMap={empMap} pauses={row.pauses ?? []} rutaStop={rtStop} rutaCondEmp={rtCond} />
                                            );
                                        })()}
                                    </div>

                                    {/* Actions + status strip */}
                                    <div className="flex items-center gap-2 px-3 pb-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                        {row.total_cajas > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 tabular-nums shrink-0">
                                                <Box size={10} className="text-slate-500 shrink-0" />
                                                {row.total_cajas} caja{row.total_cajas !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                        {(row.cajas_electrolit ?? 0) > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 tabular-nums shrink-0">
                                                <Inbox size={10} className="text-slate-400 shrink-0" />
                                                {row.cajas_electrolit} Electrolit
                                            </span>
                                        )}
                                        {row.electrolit_ok === false && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                <Zap size={8} className="shrink-0" />
                                                {(row.electrolit_faltantes ?? 0) > 0
                                                    ? `${row.electrolit_faltantes} Electrolit faltante${row.electrolit_faltantes > 1 ? 's' : ''}`
                                                    : 'Electrolit faltante'}
                                            </span>
                                        )}
                                        {(row.cajas_especiales ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 tabular-nums shrink-0">
                                                <Star size={10} className="text-slate-500 shrink-0" />
                                                {row.cajas_especiales.length} caja{row.cajas_especiales.length > 1 ? 's' : ''} especial{row.cajas_especiales.length > 1 ? 'es' : ''}
                                            </span>
                                        )}
                                        {(row.cajas_danadas ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                                                <AlertTriangle size={8} /> Dañada{row.cajas_danadas.length > 1 ? 's' : ''}: {row.cajas_danadas.map(n => `#${n}`).join(', ')}
                                            </span>
                                        )}
                                        {(row.falta_cajas ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                                                <Package size={8} /> Faltante{row.falta_cajas.length > 1 ? 's' : ''}: {row.falta_cajas.map(n => `#${n}`).join(', ')}
                                            </span>
                                        )}
                                        {row.pedido_status === 'parcial' && !(row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0) && row.pedido_status !== 'completado' && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                <ClipboardList size={8} /> Difs. pendientes
                                            </span>
                                        )}
                                        {elapsedPrep  && <span className="text-[10px] text-slate-600 tabular-nums">{elapsedPrep}</span>}
                                        {elapsedPause && (
                                            <span className="text-[10px] text-amber-700 font-semibold tabular-nums animate-pulse">
                                                {elapsedPause} en pausa
                                            </span>
                                        )}
                                        {elapsedTrans && <span className="text-[10px] text-indigo-600 tabular-nums">{elapsedTrans} en ruta</span>}
                                        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                                            {canApoyo && !isApoyoBodega && (
                                                <button
                                                    onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}
                                                    disabled={isLCBusy}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-[0.97] transition-all disabled:opacity-50"
                                                >
                                                    <UserPlus size={10} />Apoyo
                                                </button>
                                            )}
                                            {canActuar && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}
                                                    disabled={printingPdf === row.pedido_id}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-[0.97] transition-all disabled:opacity-50"
                                                >
                                                    {printingPdf === row.pedido_id ? <Loader2 size={10} className="animate-spin" /> : <FileDown size={10} />}PDF
                                                </button>
                                            )}
                                            {canActuar && !isBranch && stage === 'preparado' && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); setProgramarModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, currentAt: row.entrega_programada_at ?? null, historial: row.entrega_programada_historial ?? [] }); }}
                                                    className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl active:scale-[0.97] transition-all ${row.entrega_programada_at ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}`}
                                                >
                                                    <CalendarClock size={10} />
                                                    {row.entrega_programada_at ? fmtEntrega(row.entrega_programada_at) : 'Programar'}
                                                </button>
                                            )}
                                            {/* Entregué — conductor, junto a PDF para ahorrar espacio */}
                                            {pedidoRutaMap.has(row.pedido_id) && (() => {
                                                const { ruta, stop } = pedidoRutaMap.get(row.pedido_id);
                                                const isConductorHere = !!(user?.id && ruta.conductor_id && user.id === ruta.conductor_id);
                                                if (!isConductorHere || !!stop?.entregado_at || ruta.status !== 'en_ruta') return null;
                                                return (
                                                    <button onClick={e => { e.stopPropagation(); handleEntregarStop(stop.id, ruta.id, stop.erp_sucursal_id); }}
                                                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all shadow-sm">
                                                        <CheckCircle2 size={10} />Entregué
                                                    </button>
                                                );
                                            })()}
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}   disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}               disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)} disabled={isLCBusy || busyAction === `finalizar_load_${cardKey}`} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{(isLCBusy || busyAction === `finalizar_load_${cardKey}`) ? <Loader2 size={11} className="animate-spin" /> : <><Flag size={10} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}  disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</button>}
                                            {canAnular && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-red-100 text-red-600 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Ban size={10} />Anular
                                                </button>
                                            )}
                                            {canMarcarEnRuta && <button onClick={() => setCrearRutaOpen([])} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-[0.97] transition-all shadow-sm"><Truck size={10} />Crear Ruta</button>}
                                            {(() => {
                                                const hasElecFaltantes = (row.electrolit_faltantes ?? 0) > 0 && row.electrolit_ok !== true;
                                                const hasEspFaltantes  = Object.values(row.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante');
                                                const hasPendingFalta  = (row.falta_cajas ?? []).length > 0 || hasElecFaltantes || hasEspFaltantes;
                                                const reenvioEnCamino  = (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at);
                                                const rutaActiva       = pedidoRutaMap.get(row.pedido_id)?.ruta;
                                                const conductorEnRuta  = rutaActiva?.status === 'en_ruta' && !rutaActiva?.vuelta_base_at;
                                                if (!canActuar || isBranch || !hasPendingFalta || reenvioEnCamino) return null;
                                                if (conductorEnRuta) return (
                                                    <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white/70 cursor-not-allowed" title="El conductor aún está en ruta. Esperá a que marque vuelta a base.">
                                                        <Truck size={10} className="text-slate-500" />Esperando vuelta conductor
                                                    </div>
                                                );
                                                const espFaltList = Object.entries(row.cajas_especiales_llegadas ?? {}).filter(([, v]) => v === 'faltante').map(([k]) => k);
                                                return (
                                                    <button onClick={() => setReenviarConfirmModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, cajas: row.falta_cajas ?? [], electrolits: hasElecFaltantes ? (row.electrolit_faltantes ?? 0) : 0, especiales: espFaltList })} disabled={busyAction === 'reenvio'} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">
                                                        {busyAction === 'reenvio' ? <Loader2 size={10} className="animate-spin" /> : <><Truck size={10} />Reenviar caja</>}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </div>


                                    {/* Entrega estimada — visible en sucursal cuando hay programación y el pedido no ha llegado */}
                                    {isBranch && row.entrega_programada_at && stage !== 'erp' && stage !== 'contando' && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-indigo-100 bg-indigo-50/60">
                                            <CalendarClock size={11} className="text-indigo-500 shrink-0" />
                                            <span className="text-[10px] font-semibold text-indigo-700">Entrega estimada:</span>
                                            <span className="text-[10px] font-bold text-indigo-600">{fmtEntrega(row.entrega_programada_at)}</span>
                                        </div>
                                    )}

                                    {/* Recepción — enviado, o parcial con reenvío aún en camino */}
                                    {isBranch && erpSucursalId && (row.pedido_status === 'enviado' || (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at)) && stage !== 'erp' && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <ReceptionActions
                                                llegadaOk={!!llegadaStatus[cardKey] || !!row.llegada_fisica_at}
                                                erpOk={!!erpStatus[cardKey] || !!row.recibido_erp_at}
                                                llegadaEmp={llegadaEmp}
                                                erpEmp={erpEmp}
                                                cardApoyo={recepApoyo}
                                                pendientesCount={cardStats[cardKey]?.pendientes ?? 0}
                                                onMarkLlegada={() => handleLlegada(row.pedido_id, erpSucursalId, cardKey)}
                                                onOpenRecibir={() => openModal(row.pedido_id, row.numero, row.codigo, erpSucursalId, cardKey)}
                                                onOpenReenvioModal={() => openReenvioModal(row.pedido_id, row.numero, row.codigo, erpSucursalId, cardKey)}
                                                onSegundaLlegada={() => handleSegundaLlegada(row.pedido_id, erpSucursalId, cardKey, row.reenvios_historial ?? [], row.falta_cajas ?? [], row.caja_map ?? {})}
                                                onApoyo={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: erpSucursalId, cardKey, tipo: 'recepcion' })}
                                                busy={busyAction}
                                                llegadaTipo={row.llegada_tipo}
                                                reenviosHistorial={row.reenvios_historial ?? []}
                                                faltaCajas={row.falta_cajas ?? []}
                                                cajasDanadas={row.cajas_danadas ?? []}
                                                reenvioBodygaAt={row.reenvio_bodega_at ?? null}
                                                segundaLlegadaAt={row.segunda_llegada_at ?? null}
                                                hasFaltaItems={(items[cardKey] ?? []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0)}
                                            />
                                        </div>
                                    )}

                                    {/* Diferencias — visible cuando parcial o completado con diffs en historial */}
                                    {(row.pedido_status === 'parcial' || (row.pedido_status === 'completado' && (items[cardKey] ?? []).some(r => r.error_tipo))) && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <DifSection
                                                row={row}
                                                difItems={(items[cardKey] ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo)}
                                                eventos={eventosMap[cardKey] ?? []}
                                                isBranch={isBranch}
                                                busyAction={busyAction}
                                                empMap={empMap}
                                                readOnly={row.pedido_status === 'completado'}
                                                onNeedItems={() => fetchItems(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                                itemsLoaded={!!items[cardKey]}
                                                onResolver={(itemId, action, tipo, nota) =>
                                                    handleResolverItem(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, itemId, action, tipo, nota)
                                                }
                                            />
                                        </div>
                                    )}

                                    {/* Resumen post-completado */}
                                    {row.pedido_status === 'completado' && row.llegada_tipo && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <PostCompletionSection
                                                row={row}
                                                cardKey={cardKey}
                                                difItems={(items[cardKey] ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo)}
                                                empMap={empMap}
                                                onNeedItems={() => fetchItems(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                                itemsLoaded={!!items[cardKey]}
                                            />
                                        </div>
                                    )}

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden" onClick={e => e.stopPropagation()}>
                                                <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        });
                        if (group.isRuta) {
                            const { ruta, driverOnline: dl } = group;
                            const entregadas = ruta.ruta_pedidos.filter(rp => rp.entregado_at).length;
                            const total = ruta.ruta_pedidos.length;
                            const isConductorRuta = !!(user?.id && ruta.conductor_id && String(user.id) === String(ruta.conductor_id));
                            const pct = total > 0 ? Math.round((entregadas / total) * 100) : 0;
                            const isCompletada = ruta.status === 'completada';
                            const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true }) : null;
                            const conductorEmp = ruta.conductor_id ? empMap.get(ruta.conductor_id) : null;
                            return (
                                <div key={ruta.id} className={`rounded-2xl border overflow-hidden bg-white/70 shadow-[0_2px_16px_rgba(99,102,241,0.08)] ${isCompletada ? 'border-slate-200/80' : 'border-indigo-200/80'}`}>
                                    {/* Header sin color — glass */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100/80 bg-white/60" onClick={e => e.stopPropagation()}>
                                        {/* Foto/icono conductor */}
                                        <div className="relative shrink-0">
                                            {conductorEmp?.photo
                                                ? <img src={conductorEmp.photo} alt={conductorEmp.name} className="w-7 h-7 rounded-xl object-cover border border-slate-200" />
                                                : <div className={`w-7 h-7 rounded-xl flex items-center justify-center border ${isCompletada ? 'bg-slate-100 border-slate-200' : 'bg-indigo-50 border-indigo-100'}`}>
                                                    <Truck size={13} className={isCompletada ? 'text-slate-500' : 'text-indigo-600'} />
                                                  </div>
                                            }
                                            {dl && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[13px] font-black ${isCompletada ? 'text-slate-600' : 'text-indigo-800'}`}>Ruta #{ruta.numero}</span>
                                                {isCompletada
                                                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                        ✓ Completada{ruta.vuelta_base_at ? ` · ${fmtT(ruta.vuelta_base_at)}` : ''}
                                                      </span>
                                                    : dl && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">🟢 En vivo</span>
                                                }
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[11px] text-slate-500">{ruta.conductor_nombre}</span>
                                                <span className="text-[10px] text-slate-500 tabular-nums">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
                                                            loadActiveRutas();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo iniciar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Play size={9} fill="currentColor" />Iniciar
                                                </button>
                                            )}
                                            {isConductorRuta && ruta.status === 'en_ruta' && entregadas === total && total > 0 && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
                                                            loadActiveRutas(); loadActive();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo completar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Home size={9} />Base
                                                </button>
                                            )}
                                            {!isCompletada && (
                                                <button
                                                    onClick={() => setRutaMapOpen(ruta)}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 active:scale-[0.97] transition-all"
                                                >
                                                    <MapIcon size={9} />Mapa
                                                </button>
                                            )}
                                        </div>
                                        {/* Barra de progreso solo cuando activa */}
                                        {!isCompletada && (
                                            <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                                                <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                            </div>
                                        )}
                                    </div>
                                    {/* Cards hijas — con layout animation */}
                                    <div className="p-2.5 flex flex-col gap-2">
                                        <AnimatePresence initial={false} mode="popLayout">
                                            {cards}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            );
                        }
                        return <div key="normal" className="space-y-2.5">{cards}</div>;
                    })}
                    </div>
                )}
            </div>

            {/* ── Modals ─────────────────────────────────────────────────── */}

            <LlegadaModal
                open={!!llegadaModal}
                onClose={() => setLlegadaModal(null)}
                onConfirm={handleLlegadaConfirm}
                items={llegadaModal?.rows ?? []}
                pedidoNumero={llegadaModal ? activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.numero : null}
                cajaMap={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.caja_map ?? {}) : {}}
                totalCajas={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.total_cajas ?? 0) : 0}
                cajasElectrolit={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId && r.erp_sucursal_id === llegadaModal.sucId)?.cajas_electrolit ?? 0) : 0}
                cajasEspeciales={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId && r.erp_sucursal_id === llegadaModal.sucId)?.cajas_especiales ?? []) : []}
                draftKey={llegadaModal ? `llegada_${llegadaModal.pedidoId}_${llegadaModal.sucId}` : null}
            />

            <ReenvioLlegadaModal
                open={!!reenvioLlegadaModal}
                onClose={() => setReenvioLlegadaModal(null)}
                onConfirm={handleReenvioLlegadaConfirm}
                pedidoNumero={reenvioLlegadaModal ? activeRows.find(r => r.pedido_id === reenvioLlegadaModal.pedidoId)?.numero : null}
                cajasCiclo={reenvioLlegadaModal?.cajasCiclo      ?? []}
                electrolitCount={reenvioLlegadaModal?.electrolitCount ?? 0}
                especialesList={reenvioLlegadaModal?.especialesList   ?? []}
                cicloNum={reenvioLlegadaModal?.ciclo ?? 1}
                cajaMap={reenvioLlegadaModal?.cajaMap ?? {}}
            />

            <FinalizarCajasModal
                open={!!finalizarModal}
                onClose={() => setFinalizarModal(null)}
                onConfirm={handleFinalizarConCajas}
                items={finalizarModal?.rows ?? []}
                sucId={finalizarModal?.sucId}
                pedidoNumero={finalizarModal?.numero}
                paginas={finalizarModal?.paginas ?? null}
                draftKey={finalizarModal ? `finalizar_${finalizarModal.pedidoId}_${finalizarModal.sucId}` : null}
            />

            {anularModal && (
                <AnularModal
                    modal={anularModal}
                    onCancel={() => setAnularModal(null)}
                    onConfirm={handleAnular}
                    busy={busyAnular}
                />
            )}

            {pauseModal && (
                <PauseModal
                    modal={pauseModal}
                    history={pauseHistory}
                    kioskLunch={kioskLunch}
                    razonSel={pauseRazon}    setRazonSel={setPauseRazon}
                    comment={pauseComment}   setComment={setPauseComment}
                    onCancel={() => setPauseModal(null)}
                    onConfirm={confirmPause}
                    busy={busyLifecycle === `lc_${pauseModal.pedidoId}_${pauseModal.sucId}`}
                />
            )}

            <ApoioScanModal
                open={!!apoyoModal}
                onClose={() => setApoyoModal(null)}
                pedidoId={apoyoModal?.pedidoId}
                sucId={apoyoModal?.sucId}
                currentUserId={user?.id}
                tipo={apoyoModal?.tipo ?? 'preparacion'}
                existingApoyo={(apoyoMap[apoyoModal?.cardKey] ?? { preparacion: [], recepcion: [] })[apoyoModal?.tipo ?? 'preparacion'] ?? []}
                onSuccess={(emp) => handleApoyoSuccess(emp, apoyoModal?.cardKey, apoyoModal?.tipo ?? 'preparacion')}
            />

            {modal && (
                <RecepcionModal
                    open={!!modal}
                    onClose={() => setModal(null)}
                    pedido={modal.pedido}
                    sucursalId={modal.sucId}
                    sucursalNombre={branchName}
                    rows={modal.rows}
                    cajaDanada={modal.cajaDanada   ?? []}
                    cajaMap={modal.cajaMap         ?? {}}
                    paginaItems={modal.paginaItems  ?? {}}
                    cajasRecibidas={modal.cajasRecibidas ?? []}
                    faltaCajas={modal.faltaCajas     ?? []}
                    hasFaltaItems={modal.hasFaltaItems ?? false}
                    especialesLlegadas={modal.especialesLlegadas ?? {}}
                    onConfirmed={async ({ hasDiff, allDone }) => {
                        const { pedido, sucId, key } = modal;
                        setModal(null);
                        if (allDone) {
                            await handleMarkErp(pedido.id, sucId, key);
                            // Re-fetch items to get accurate con_diferencia count
                            const loaded = await fetchItems(key, pedido.id, sucId);
                            const realHasDiff = hasDiff || (loaded || []).some(r => r.status === 'con_diferencia');
                            if (realHasDiff) await handleReportarDiferencias(pedido.id, sucId);
                            fetchBodegaBranchId().then(({ data: b }) => {
                                if (!b?.branch_id) return;
                                const title   = realHasDiff
                                    ? `Problemas en pedido #${pedido.numero} — ${branchName}`
                                    : `Pedido #${pedido.numero} confirmado — ${branchName}`;
                                const message = realHasDiff
                                    ? `${branchName} reporta diferencias en la recepción del pedido #${pedido.numero}. Revisá y marcalo como corregido.`
                                    : `${branchName} confirmó la recepción del pedido #${pedido.numero} sin novedades.`;
                                // Con diferencias = accionable (push); sin novedades = solo campana
                                notifyBranch(b.branch_id, { type: realHasDiff ? 'PEDIDO_PROBLEMA' : 'PEDIDO_TRACKING', title, body: message, link: '/pedidos', push: realHasDiff });
                            }).catch(() => {});
                        } else {
                            // Partial box confirmed — reload items before active so DifSection gets fresh data
                            await fetchItems(key, pedido.id, sucId);
                        }
                        await loadActive();
                    }}
                />
            )}

            {/* ── Crear Ruta modal ───────────────────────────────────────────────── */}
            <CrearRutaModal
                open={crearRutaOpen !== null}
                initialKeys={crearRutaOpen ?? []}
                onClose={() => setCrearRutaOpen(null)}
                onCreated={() => { setCrearRutaOpen(null); loadActive(); }}
            />

            {rutaMapOpen && (
                <RutaMapModal
                    ruta={rutaMapOpen}
                    open={!!rutaMapOpen}
                    onClose={() => setRutaMapOpen(null)}
                    currentUserId={user?.id}
                />
            )}

            <ProgramarEntregaModal
                open={!!programarModal}
                onClose={() => setProgramarModal(null)}
                numero={programarModal?.numero}
                currentAt={programarModal?.currentAt}
                historial={programarModal?.historial ?? []}
                empMap={empMap}
                onConfirm={handleProgramarEntrega}
                saving={savingProgramar}
            />

            {/* ── Confirmación Reenviar Caja ─────────────────────────────────────── */}
            {reenviarConfirmModal && (
                <PedidoModal open onClose={() => setReenviarConfirmModal(null)} maxWidth="max-w-xs">
                    <div className="px-5 pt-5 pb-4 border-b border-white/40">
                        <h3 className="text-[15px] font-black text-slate-800">¿Confirmar reenvío?</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">Pedido #{reenviarConfirmModal.numero}</p>
                    </div>
                    <div className="px-5 py-4 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Pendiente de enviar:</p>
                        {reenviarConfirmModal.cajas.length > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Box size={13} className="text-rose-500 shrink-0" />
                                <span>Caja{reenviarConfirmModal.cajas.length > 1 ? 's' : ''}: {reenviarConfirmModal.cajas.map(n => `#${n}`).join(', ')}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.electrolits > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Inbox size={13} className="text-amber-500 shrink-0" />
                                <span>{reenviarConfirmModal.electrolits} Electrolit faltante{reenviarConfirmModal.electrolits > 1 ? 's' : ''}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.especiales.length > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Star size={13} className="text-violet-500 shrink-0" />
                                <span>Especial{reenviarConfirmModal.especiales.length > 1 ? 'es' : ''}: {reenviarConfirmModal.especiales.join(', ')}</span>
                            </div>
                        )}
                    </div>
                    <div className="px-5 pb-5 pt-2 flex gap-2 justify-end border-t border-white/40">
                        <button onClick={() => setReenviarConfirmModal(null)} className="text-[12px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100/80 transition-all">
                            Cancelar
                        </button>
                        <button
                            disabled={busyAction === 'reenvio'}
                            onClick={() => {
                                const { pedidoId, sucId, numero, cajas, electrolits, especiales } = reenviarConfirmModal;
                                setReenviarConfirmModal(null);
                                handleReenviarCaja(pedidoId, sucId, numero, cajas, electrolits, especiales);
                            }}
                            className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                        >
                            {busyAction === 'reenvio' ? <Loader2 size={12} className="animate-spin" /> : <><Truck size={12} />Confirmar reenvío</>}
                        </button>
                    </div>
                </PedidoModal>
            )}
        </div>
    );
}
