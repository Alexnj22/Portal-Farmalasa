import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2,
    X, Package, Building2, AlertTriangle, Ban, ArrowDown,
    Clock, CheckCheck, TrendingDown, FlaskConical, Printer,
    BookMarked, Trash2, CalendarDays, Send, Search, PackagePlus,
    Play, Pause, Flag, Database,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import ConfirmModal from '../../components/common/ConfirmModal';
import ModalShell from '../../components/common/ModalShell';
import { printFromPedidoItems, printFromSnapshot } from '../../utils/pedidoPrint';
import RecepcionModal, { EmpChip } from './RecepcionModal';

const PEDIDO_FIELDS = 'id, numero, created_at, created_by, status, notes, responsable_id, revisado_por, anulado_por, motivo_anulacion, enviado_por, enviado_at';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE = 50;
const GLASS     = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const STATUS_PILL = {
    confirmado:     'bg-blue-100 text-blue-700 border-blue-200',
    enviado:        'bg-indigo-100 text-indigo-700 border-indigo-200',
    parcial:        'bg-amber-100 text-amber-700 border-amber-200',
    completado:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    anulado:        'bg-red-100 text-red-600 border-red-200',
    pendiente:      'bg-slate-100 text-slate-500 border-slate-200',
    recibido:       'bg-emerald-100 text-emerald-700 border-emerald-200',
    con_diferencia: 'bg-amber-100 text-amber-700 border-amber-200',
};

const STATUS_LABEL = {
    confirmado:     'Por despachar',
    enviado:        'En camino',
    parcial:        'Con diferencias',
    completado:     'Completado',
    anulado:        'Anulado',
    pendiente:      'Pendiente',
    recibido:       'Recibido',
    con_diferencia: 'Con diferencia',
};

const FILTER_TABS = [
    { key: 'todos',      label: 'Todos',            icon: null         },
    { key: 'confirmado', label: 'Por despachar',    icon: Clock        },
    { key: 'enviado',    label: 'En camino',        icon: Send         },
    { key: 'parcial',    label: 'Con diferencias',  icon: TrendingDown },
    { key: 'completado', label: 'Completados',      icon: CheckCheck   },
    { key: 'anulado',    label: 'Anulados',         icon: Ban          },
];

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function fmtElapsed(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    const ms = new Date(toIso) - new Date(fromIso);
    if (ms < 0) return null;
    const totalMin = Math.floor(ms / 60000);
    if (totalMin === 0) return '<1m';
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

function fmtMes(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-SV', { month: 'short', year: '2-digit' });
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
    const cls = {
        blue:    'bg-blue-50    border-blue-100   text-blue-700',
        indigo:  'bg-indigo-50  border-indigo-100 text-indigo-700',
        amber:   'bg-amber-50   border-amber-100  text-amber-700',
        emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
        red:     'bg-red-50     border-red-100    text-red-600',
    }[color];
    return (
        <div className={`rounded-xl border px-4 py-2.5 flex flex-col items-center ${cls}`}>
            <span className="text-xl font-black tabular-nums leading-none">{value}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</span>
        </div>
    );
}

// ─── Lote pill ────────────────────────────────────────────────────────────────
function LotePills({ lotes }) {
    if (!lotes || lotes.length === 0) return null;
    const today = new Date();
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {lotes.map((lot, i) => {
                const fv       = lot.fecha_vencimiento ? new Date(lot.fecha_vencimiento) : null;
                const daysLeft = fv ? Math.floor((fv - today) / 86_400_000) : null;
                const expCls   = daysLeft === null ? 'text-slate-400'
                    : daysLeft < 30  ? 'text-red-500 font-semibold'
                    : daysLeft < 90  ? 'text-amber-500'
                    : 'text-emerald-600';
                return (
                    <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                        <span className="text-slate-500 font-medium">{lot.lote || '—'}</span>
                        {fv && <span className={expCls}>{fmtMes(lot.fecha_vencimiento)}</span>}
                    </span>
                );
            })}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TabHistorial({ searchTerm = '', refreshKey = 0 }) {
    const { user } = useAuth();

    const [pedidos,          setPedidos]          = useState([]);
    const [loading,          setLoading]          = useState(true);
    const [loadingMore,      setLoadingMore]      = useState(false);
    const [hasMore,          setHasMore]          = useState(false);
    const [page,             setPage]             = useState(0);
    const [filterTab,        setFilterTab]        = useState('todos');
    const [expanded,         setExpanded]         = useState(null);
    const [items,            setItems]            = useState({});
    const [loadingItems,     setLoadingItems]     = useState(false);
    const [pedidoSucursales, setPedidoSucursales] = useState({}); // { pedidoId: [sucId, …] }
    const [lotes,            setLotes]            = useState({}); // { pedidoId: { productId: [{lote, fecha_vencimiento}] } }
    const [sectionOpen,      setSectionOpen]      = useState({}); // { key: bool }
    const [modal,            setModal]            = useState(null);
    const [empMap,           setEmpMap]           = useState({});   // { empId: {id,name,photo_url} }
    const [firmasMap,        setFirmasMap]        = useState({});   // { pedidoId: [{erp_sucursal_id, employees}] }
    const [extrasMap,        setExtrasMap]        = useState({});   // { pedidoId: [extra,…] }
    const [itemSearch,       setItemSearch]       = useState('');
    const [searchOpen,       setSearchOpen]       = useState(false);
    const [anulando,         setAnulando]         = useState(null);
    const [confirmAnul,      setConfirmAnul]      = useState(null);
    const [anulMotivo,       setAnulMotivo]       = useState('');
    const [anulError,        setAnulError]        = useState(null);
    const [enviando,         setEnviando]         = useState(null);
    const [filterDesde,      setFilterDesde]      = useState('');
    const [filterHasta,      setFilterHasta]      = useState('');
    const [snapshots,        setSnapshots]        = useState([]);
    const [snapsLoading,     setSnapsLoading]     = useState(false);
    const [snapsOpen,        setSnapsOpen]        = useState(false);
    const [confirmDelSnap,   setConfirmDelSnap]   = useState(null);
    const [deletingSnap,     setDeletingSnap]     = useState(false);
    const [totalCounts,      setTotalCounts]      = useState(null);
    const [lifecycleMap,     setLifecycleMap]     = useState({}); // { pedidoId: { sucId: {...} } }
    const [updatingLifecycle, setUpdatingLifecycle] = useState({}); // { 'pedidoId_sucId': bool }
    const [pauseModal,       setPauseModal]       = useState(null); // { pedidoId, sucId } | null
    const [pauseRazonSel,    setPauseRazonSel]    = useState('almuerzo');
    const [pauseRazonText,   setPauseRazonText]   = useState('');

    // ── Section toggle helpers ─────────────────────────────────────────────────
    const isSecOpen = (key, def) => sectionOpen[key] ?? def;
    const toggleSec = useCallback((key, def) => {
        setSectionOpen(prev => ({ ...prev, [key]: !(prev[key] ?? def) }));
    }, []);

    // ── Empleados (nombre + foto) para responsable/envió/recibió ──────────────
    const requestedEmpIds = useRef(new Set());
    const loadEmployees = useCallback(async (ids) => {
        const missing = [...new Set(ids.filter(Boolean))].filter(id => !requestedEmpIds.current.has(id));
        if (!missing.length) return;
        missing.forEach(id => requestedEmpIds.current.add(id));
        const { data } = await supabase
            .from('employees')
            .select('id, name, photo_url')
            .in('id', missing);
        if (data?.length) {
            setEmpMap(prev => ({ ...prev, ...Object.fromEntries(data.map(e => [e.id, e])) }));
        }
    }, []);

    const loadEmpsFromPedidos = useCallback((rows) => {
        loadEmployees(rows.flatMap(p => [p.responsable_id, p.revisado_por, p.created_by, p.enviado_por, p.anulado_por]));
    }, [loadEmployees]);

    // ── Load sucursal chips for a batch of pedidos ─────────────────────────────
    const loadSucursales = useCallback(async (pedidoIds) => {
        if (!pedidoIds.length) return;
        const { data } = await supabase
            .from('pedido_items')
            .select('pedido_id, erp_sucursal_id')
            .in('pedido_id', pedidoIds)
            .range(0, 9999);
        const map = {};
        for (const row of (data || [])) {
            if (!map[row.pedido_id]) map[row.pedido_id] = new Set();
            map[row.pedido_id].add(row.erp_sucursal_id);
        }
        setPedidoSucursales(prev => ({
            ...prev,
            ...Object.fromEntries(
                Object.entries(map).map(([k, v]) => [k, [...v].sort()])
            ),
        }));
    }, []);

    // ── Reset load ────────────────────────────────────────────────────────────
    const resetLoad = useCallback(async (desde, hasta) => {
        setLoading(true);
        setPedidos([]);
        setPage(0);
        setHasMore(false);
        setPedidoSucursales({});
        let q = supabase
            .from('pedidos')
            .select(PEDIDO_FIELDS)
            .order('created_at', { ascending: false });
        if (desde) q = q.gte('created_at', desde);
        if (hasta) q = q.lte('created_at', hasta + 'T23:59:59');
        q = q.range(0, PAGE_SIZE - 1);
        const { data } = await q;
        const rows = data || [];
        setPedidos(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setLoading(false);
        if (rows.length) { loadSucursales(rows.map(p => p.id)); loadEmpsFromPedidos(rows); }
    }, [loadSucursales, loadEmpsFromPedidos]);

    // ── Load more ──────────────────────────────────────────────────────────────
    const loadMore = useCallback(async () => {
        setLoadingMore(true);
        const nextPage = page + 1;
        const from = nextPage * PAGE_SIZE;
        let q = supabase
            .from('pedidos')
            .select(PEDIDO_FIELDS)
            .order('created_at', { ascending: false });
        if (filterDesde) q = q.gte('created_at', filterDesde);
        if (filterHasta) q = q.lte('created_at', filterHasta + 'T23:59:59');
        q = q.range(from, from + PAGE_SIZE - 1);
        const { data } = await q;
        const rows = data || [];
        setPedidos(prev => [...prev, ...rows]);
        setPage(nextPage);
        setHasMore(rows.length === PAGE_SIZE);
        setLoadingMore(false);
        if (rows.length) { loadSucursales(rows.map(p => p.id)); loadEmpsFromPedidos(rows); }
    }, [page, loadSucursales, loadEmpsFromPedidos, filterDesde, filterHasta]);

    // Initial load
    useEffect(() => { resetLoad('', ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Refresh when tab becomes active
    useEffect(() => {
        if (refreshKey > 0) resetLoad(filterDesde, filterHasta);
    }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reload when date filters change
    useEffect(() => { resetLoad(filterDesde, filterHasta); }, [filterDesde, filterHasta]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load snapshots on mount
    const loadSnapshots = useCallback(async () => {
        setSnapsLoading(true);
        const { data } = await supabase
            .from('pedidos_snapshots')
            .select('id, nombre, sucursal_ids, created_at, total_filas, total_packs, datos')
            .order('created_at', { ascending: false })
            .range(0, 49);
        setSnapshots(data || []);
        setSnapsLoading(false);
    }, []);

    useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

    // ── Accurate DB-level counts (not limited to loaded page) ─────────────────
    const reloadCounts = useCallback(async () => {
        const statuses = ['confirmado', 'enviado', 'parcial', 'completado', 'anulado'];
        const results = await Promise.all(statuses.map(async (status) => {
            let q = supabase.from('pedidos')
                .select('id', { count: 'exact', head: true })
                .eq('status', status);
            if (filterDesde) q = q.gte('created_at', filterDesde);
            if (filterHasta) q = q.lte('created_at', filterHasta + 'T23:59:59');
            const { count } = await q;
            return [status, count ?? 0];
        }));
        setTotalCounts(Object.fromEntries(results));
    }, [filterDesde, filterHasta]);

    useEffect(() => { reloadCounts(); }, [reloadCounts]);

    // ── Fetch items + lotes + firmas + extras for expanded pedido ─────────────
    const fetchPedidoItems = useCallback(async (pedidoId) => {
        setLoadingItems(true);
        const [{ data }, { data: firmaRows }, { data: extraRows }, { data: lifecycleRows }] = await Promise.all([
            supabase
                .from('pedido_items')
                .select(`
                    id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
                    cantidad_asignada, cantidad_recibida,
                    sin_stock, revision_minmax,
                    max_qty_snapshot, stock_packs_snapshot,
                    status, nota_diferencia, error_tipo, received_at, received_by,
                    lotes_asignados,
                    products ( nombre, es_antibiotico, laboratorios ( nombre ) ),
                    presentaciones ( tipo )
                `)
                .eq('pedido_id', pedidoId)
                .range(0, 9999),
            supabase
                .from('pedido_recepcion_firmas')
                .select('erp_sucursal_id, created_at, employees:employee_id ( id, name, photo_url )')
                .eq('pedido_id', pedidoId),
            supabase
                .from('pedido_recepcion_extras')
                .select('id, erp_sucursal_id, erp_product_id, cantidad, nota, created_at, products:erp_product_id ( nombre )')
                .eq('pedido_id', pedidoId),
            supabase
                .from('pedido_sucursal_status')
                .select('erp_sucursal_id, codigo, iniciado_at, iniciado_por, pausado_at, pausa_razon, reanudado_at, finalizado_at, finalizado_por, recibido_erp_at, recibido_erp_por')
                .eq('pedido_id', pedidoId),
        ]);

        const rows = data || [];
        setItems(prev => ({ ...prev, [pedidoId]: rows }));
        setFirmasMap(prev => ({ ...prev, [pedidoId]: firmaRows || [] }));
        setExtrasMap(prev => ({ ...prev, [pedidoId]: extraRows || [] }));

        // Index lifecycle by sucursal
        const lcByS = {};
        for (const row of (lifecycleRows || [])) lcByS[row.erp_sucursal_id] = row;
        setLifecycleMap(prev => ({ ...prev, [pedidoId]: lcByS }));
        loadEmployees([
            ...rows.map(r => r.received_by),
            ...(lifecycleRows || []).flatMap(r => [r.iniciado_por, r.finalizado_por, r.recibido_erp_por]),
        ]);

        // Load current bodega lote info for these products
        const productIds = [...new Set(rows.map(r => r.erp_product_id))];
        if (productIds.length) {
            const { data: loteData } = await supabase
                .from('inventory')
                .select('erp_product_id, lote, fecha_vencimiento')
                .eq('erp_sucursal_id', 6)
                .eq('is_vencidos', false)
                .gt('cantidad', 0)
                .in('erp_product_id', productIds);

            const loteMap = {};
            for (const lot of (loteData || [])) {
                if (!loteMap[lot.erp_product_id]) loteMap[lot.erp_product_id] = [];
                loteMap[lot.erp_product_id].push(lot);
            }
            for (const id of Object.keys(loteMap)) {
                // Sort FEFO
                loteMap[id].sort((a, b) => {
                    if (!a.fecha_vencimiento) return 1;
                    if (!b.fecha_vencimiento) return -1;
                    return new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento);
                });
                // Deduplicate lote codes
                const seen = new Set();
                loteMap[id] = loteMap[id].filter(l => {
                    const k = `${l.lote}_${l.fecha_vencimiento}`;
                    if (seen.has(k)) return false;
                    seen.add(k); return true;
                });
            }
            setLotes(prev => ({ ...prev, [pedidoId]: loteMap }));
        }

        setLoadingItems(false);
    }, [loadEmployees]);

    const toggleExpand = useCallback(async (pedidoId) => {
        if (expanded === pedidoId) { setExpanded(null); return; }
        setExpanded(pedidoId);
        setItemSearch(''); setSearchOpen(false);
        if (!items[pedidoId]) await fetchPedidoItems(pedidoId);
    }, [expanded, items, fetchPedidoItems]);

    // ── Reception modal (unificado) ───────────────────────────────────────────
    const openRecepcion = useCallback((pedidoId, sucursalId) => {
        const rows = (items[pedidoId] || []).filter(
            r => r.erp_sucursal_id === sucursalId && r.status === 'pendiente' && r.cantidad_asignada > 0
        );
        if (!rows.length) return;
        const pedido = pedidos.find(p => p.id === pedidoId);
        setModal({ pedido: { id: pedidoId, numero: pedido?.numero ?? '?' }, sucursalId, rows });
    }, [items, pedidos]);

    const handleRecepcionConfirmed = useCallback(async () => {
        const pedidoId = modal?.pedido?.id;
        setModal(null);
        if (!pedidoId) return;
        await fetchPedidoItems(pedidoId);
        const { data } = await supabase
            .from('pedidos').select(PEDIDO_FIELDS)
            .eq('id', pedidoId).single();
        if (data) setPedidos(prev => prev.map(p => p.id === pedidoId ? data : p));
        reloadCounts();
    }, [modal, fetchPedidoItems, reloadCounts]);

    // ── Anular ────────────────────────────────────────────────────────────────
    const doAnular = useCallback(async () => {
        if (!confirmAnul) return;
        setAnulando(confirmAnul.id); setAnulError(null);
        try {
            const { error } = await supabase.rpc('anular_pedido', {
                p_pedido_id:   confirmAnul.id,
                p_anulado_por: user?.id ?? null,
                p_motivo:      anulMotivo.trim() || null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('ANULAR_PEDIDO', confirmAnul.id, {
                numero: confirmAnul.numero,
                motivo: anulMotivo.trim() || null,
            });
            setItems(prev => { const n = { ...prev }; delete n[confirmAnul.id]; return n; });
            const { data } = await supabase
                .from('pedidos').select(PEDIDO_FIELDS)
                .eq('id', confirmAnul.id).single();
            if (data) setPedidos(prev => prev.map(p => p.id === confirmAnul.id ? data : p));
            setConfirmAnul(null);
            setAnulMotivo('');
            reloadCounts();
        } catch (e) {
            setAnulError(e.message);
        } finally {
            setAnulando(null);
        }
    }, [confirmAnul, anulMotivo, user, reloadCounts]);

    // ── Borrar snapshot ────────────────────────────────────────────────────────
    const doDeleteSnap = useCallback(async () => {
        if (!confirmDelSnap) return;
        setDeletingSnap(true);
        await supabase.from('pedidos_snapshots').delete().eq('id', confirmDelSnap.id);
        useStaff.getState().appendAuditLog('ELIMINAR_BORRADOR_PEDIDO', confirmDelSnap.id, {
            nombre: confirmDelSnap.nombre,
        });
        setConfirmDelSnap(null);
        setDeletingSnap(false);
        loadSnapshots();
    }, [confirmDelSnap, loadSnapshots]);

    // ── Marcar como enviado ───────────────────────────────────────────────────
    const handleMarcarEnviado = useCallback(async (pedido) => {
        setEnviando(pedido.id);
        try {
            const { error } = await supabase.rpc('marcar_pedido_enviado', {
                p_pedido_id:   pedido.id,
                p_enviado_por: user?.id ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('MARCAR_PEDIDO_ENVIADO', pedido.id, { numero: pedido.numero });

            // Notificar sucursales afectadas
            try {
                const sucIds = pedidoSucursales[pedido.id] ?? [];
                if (sucIds.length > 0) {
                    const { data: branchRows } = await supabase
                        .from('erp_sucursal_map')
                        .select('branch_id')
                        .in('erp_sucursal_id', sucIds)
                        .eq('es_bodega', false);
                    const branchIds = (branchRows || []).map(r => r.branch_id).filter(Boolean);
                    if (branchIds.length > 0) {
                        const title = `Pedido #${pedido.numero} en camino`;
                        const msg   = `El pedido #${pedido.numero} fue despachado desde Bodega Central. Revisá los productos cuando lleguen a tu sucursal.`;
                        await supabase.from('announcements').insert({
                            title, message: msg,
                            target_type: 'BRANCH', target_value: branchIds,
                            read_by: [], is_archived: false, created_by: user?.id ?? null,
                            priority: 'NORMAL',
                            metadata: { pedido_id: pedido.id, numero: pedido.numero },
                        });
                        supabase.functions.invoke('send-push-notification', {
                            body: { title, message: msg, url: '/pedidos', target_type: 'BRANCH', target_value: branchIds },
                        }).catch(() => {});
                    }
                }
            } catch { /* no-fatal */ }

            const { data } = await supabase
                .from('pedidos').select(PEDIDO_FIELDS)
                .eq('id', pedido.id).single();
            if (data) setPedidos(prev => prev.map(p => p.id === pedido.id ? data : p));
            reloadCounts();
        } catch (e) {
            // Muestra el error en anulError (mismo banner) para no agregar más estado
            setAnulError(`Error al marcar enviado: ${e.message}`);
        } finally {
            setEnviando(null);
        }
    }, [user, pedidoSucursales, reloadCounts]);

    // ── Lifecycle actions (Iniciar / Pausar / Reanudar / Finalizar / Recibir ERP)
    const handleLifecycleAction = useCallback(async (pedidoId, sucursalId, stage, razon = null) => {
        const key = `${pedidoId}_${sucursalId}`;
        setUpdatingLifecycle(prev => ({ ...prev, [key]: true }));
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id:   pedidoId,
                p_sucursal_id: sucursalId,
                p_stage:       stage,
                p_user_id:     user?.id ?? null,
                p_razon:       razon,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog(
                `PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId,
                { sucursal_id: sucursalId, razon },
            );
            // Reload lifecycle for this pedido
            const { data: lcRows } = await supabase
                .from('pedido_sucursal_status')
                .select('erp_sucursal_id, codigo, iniciado_at, iniciado_por, pausado_at, pausa_razon, reanudado_at, finalizado_at, finalizado_por, recibido_erp_at, recibido_erp_por')
                .eq('pedido_id', pedidoId);
            const lcByS = {};
            for (const row of (lcRows || [])) lcByS[row.erp_sucursal_id] = row;
            setLifecycleMap(prev => ({ ...prev, [pedidoId]: lcByS }));
            loadEmployees((lcRows || []).flatMap(r => [r.iniciado_por, r.finalizado_por, r.recibido_erp_por]));
        } catch (e) {
            setAnulError(`Error: ${e.message}`);
        } finally {
            setUpdatingLifecycle(prev => ({ ...prev, [key]: false }));
        }
    }, [user, loadEmployees]);

    // ── Meta para impresión (nombres de empleados; columna real: name) ────────
    const loadPedidoMeta = useCallback(async (pedido) => {
        const ids = [pedido.responsable_id, pedido.revisado_por, pedido.created_by].filter(Boolean);
        if (!ids.length) return {};
        const { data } = await supabase
            .from('employees')
            .select('id, name')
            .in('id', ids);
        const map = Object.fromEntries((data || []).map(e => [e.id, e.name]));
        const generadoPor = map[pedido.created_by] ?? null;
        return {
            responsable: map[pedido.responsable_id] ?? generadoPor,
            revisor:     map[pedido.revisado_por]   ?? null,
            generadoPor,
        };
    }, []);

    // ── Filtered / counts ─────────────────────────────────────────────────────
    const filtered = pedidos
        .filter(p => filterTab === 'todos' || p.status === filterTab)
        .filter(p => {
            if (!searchTerm.trim()) return true;
            const q = searchTerm.toLowerCase();
            return String(p.numero).includes(q) || (p.notes || '').toLowerCase().includes(q);
        });

    const counts = pedidos.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1; return acc;
    }, {});

    // ── Render ────────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando historial…</span>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">

            {/* ── Stats bar ──────────────────────────────────────────────── */}
            {(pedidos.length > 0 || totalCounts) && (
                <div className="flex flex-wrap gap-2">
                    <StatCard label="Por despachar" value={(totalCounts ?? counts).confirmado ?? 0} color="blue"    />
                    <StatCard label="En camino"     value={(totalCounts ?? counts).enviado    ?? 0} color="indigo"  />
                    <StatCard label="Diferencias"   value={(totalCounts ?? counts).parcial    ?? 0} color="amber"   />
                    <StatCard label="Completados"   value={(totalCounts ?? counts).completado ?? 0} color="emerald" />
                    <StatCard label="Anulados"      value={(totalCounts ?? counts).anulado    ?? 0} color="red"     />
                </div>
            )}

            {/* ── Filter pill estándar: estados + rango de fechas ──────── */}
            <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-sm flex-wrap w-fit max-w-full">
                <div className="flex items-center gap-1 px-2 py-1.5 flex-wrap">
                    {FILTER_TABS.map(ft => {
                        const cnt   = ft.key === 'todos'
                            ? ((totalCounts ? Object.values(totalCounts).reduce((s, v) => s + v, 0) : null) ?? pedidos.length)
                            : ((totalCounts ?? counts)[ft.key] ?? 0);
                        const isAct = filterTab === ft.key;
                        return (
                            <button
                                key={ft.key}
                                onClick={() => setFilterTab(ft.key)}
                                className={`flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full border font-medium transition-colors ${
                                    isAct
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                                }`}
                            >
                                {ft.icon && <ft.icon size={11} />}
                                {ft.label}
                                <span className={`text-[10px] ${isAct ? 'text-blue-200' : 'text-slate-400'}`}>({cnt})</span>
                            </button>
                        );
                    })}
                </div>
                <div className="h-5 w-px bg-slate-100 shrink-0" />
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <CalendarDays size={13} className="text-slate-400 shrink-0" />
                    <input
                        type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)}
                        className="text-[12px] border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                    />
                    <span className="text-[11px] text-slate-400">—</span>
                    <input
                        type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)}
                        className="text-[12px] border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                    />
                </div>
                {(filterDesde || filterHasta) && (
                    <>
                        <div className="h-5 w-px bg-slate-100 shrink-0" />
                        <button onClick={() => { setFilterDesde(''); setFilterHasta(''); }}
                            className="flex items-center gap-1 px-3 py-2 text-[11px] text-slate-400 hover:text-red-500 transition-colors whitespace-nowrap">
                            <X size={11} /> Limpiar
                        </button>
                    </>
                )}
            </div>

            {/* ── Error anulación ────────────────────────────────────────── */}
            {anulError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[12px]">
                    <AlertTriangle size={14} /> {anulError}
                    <button onClick={() => setAnulError(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={12} /></button>
                </div>
            )}

            {/* ── Empty state ────────────────────────────────────────────── */}
            {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                    <Package size={40} />
                    <p className="font-medium text-[15px]">
                        {filterTab === 'todos'
                            ? 'No hay pedidos generados todavía'
                            : `No hay pedidos con estado "${STATUS_LABEL[filterTab] ?? filterTab}"`
                        }
                    </p>
                </div>
            )}

            {/* ── Pedido cards ───────────────────────────────────────────── */}
            {filtered.map(p => {
                const isExp    = expanded === p.id;
                const pedItems = items[p.id] || [];
                const canAnul  = ['confirmado', 'enviado', 'parcial'].includes(p.status);
                const sucIds   = pedidoSucursales[p.id] ?? [];

                // Group items by sucursal (todos — para imprimir)
                const groupBySuc = (rows) => {
                    const m = {};
                    for (const row of rows) {
                        const s = row.erp_sucursal_id;
                        if (!m[s]) m[s] = [];
                        m[s].push(row);
                    }
                    return [
                        ...ERP_ORDER.filter(id => m[id]).map(id => [id, m[id]]),
                        ...Object.keys(m).map(Number).filter(id => !ERP_ORDER.includes(id)).map(id => [id, m[id]]),
                    ];
                };
                const sucGroupsAll = groupBySuc(pedItems);
                // Lupa: filtra el detalle visible sin afectar la impresión
                const q = isExp ? itemSearch.trim().toLowerCase() : '';
                const sucGroups = q
                    ? groupBySuc(pedItems.filter(r => (r.products?.nombre || '').toLowerCase().includes(q)))
                    : sucGroupsAll;

                const respEmp   = empMap[p.responsable_id] ?? empMap[p.created_by] ?? null;
                const envioEmp  = p.enviado_por ? empMap[p.enviado_por] : null;
                const anuloEmp  = p.anulado_por ? empMap[p.anulado_por] : null;
                const pedFirmas = firmasMap[p.id] ?? [];
                const pedExtras = extrasMap[p.id] ?? [];

                return (
                    <div key={p.id} className={GLASS + ' overflow-hidden'}>

                        {/* ── Card header ───────────────────────────────── */}
                        <div className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50/20 transition-colors">
                            <button
                                className="flex items-center gap-3 flex-1 text-left min-w-0"
                                onClick={() => toggleExpand(p.id)}
                            >
                                <div className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${isExp ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                    {isExp
                                        ? <ChevronDown  size={14} className="text-blue-500" />
                                        : <ChevronRight size={14} className="text-slate-400" />
                                    }
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-slate-800 text-[15px]">Pedido #{p.numero}</span>
                                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_PILL[p.status] ?? ''}`}>
                                            {STATUS_LABEL[p.status] ?? p.status}
                                        </span>
                                        {/* Sucursal chips */}
                                        {sucIds.map(sid => (
                                            <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-medium flex-shrink-0">
                                                {ERP_NAMES[sid] ?? `Suc ${sid}`}
                                            </span>
                                        ))}
                                        {/* B4: no-enviados badge (shows once items are loaded) */}
                                        {pedItems.length > 0 && (() => {
                                            const n = pedItems.filter(r => r.sin_stock || r.revision_minmax).length;
                                            return n > 0 ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-700 font-semibold flex-shrink-0">
                                                    {n} no enviado{n !== 1 ? 's' : ''}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                    {/* Responsables con foto */}
                                    {(respEmp || envioEmp || anuloEmp) && (
                                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                            {respEmp  && <EmpChip emp={respEmp}  sub="responsable" />}
                                            {envioEmp && <EmpChip emp={envioEmp} sub={`envió · ${fmtDate(p.enviado_at)}`} />}
                                            {anuloEmp && <EmpChip emp={anuloEmp} sub="anuló" />}
                                        </div>
                                    )}
                                    {p.notes && (
                                        <p className="text-slate-400 text-[12px] truncate italic mt-0.5">"{p.notes}"</p>
                                    )}
                                </div>
                            </button>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                <span className="text-[12px] text-slate-400 whitespace-nowrap hidden sm:block">{fmtDate(p.created_at)}</span>
                                {isExp && sucGroupsAll.length > 0 && (
                                    <button
                                        onClick={async e => {
                                            e.stopPropagation();
                                            const meta = await loadPedidoMeta(p);
                                            printFromPedidoItems(p.numero, sucGroupsAll, meta);
                                        }}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                                        title="Imprimir pedido completo"
                                    >
                                        <Printer size={11} /> Imprimir
                                    </button>
                                )}
                                {p.status === 'confirmado' && (
                                    <button
                                        onClick={() => handleMarcarEnviado(p)}
                                        disabled={enviando === p.id}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                                    >
                                        {enviando === p.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                                        Marcar enviado
                                    </button>
                                )}
                                {canAnul && (
                                    <button
                                        onClick={() => { setConfirmAnul({ id: p.id, numero: p.numero }); setAnulMotivo(''); setAnulError(null); }}
                                        disabled={anulando === p.id}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                                    >
                                        {anulando === p.id ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
                                        Anular
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* ── Expanded detail ────────────────────────────── */}
                        {isExp && (
                            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                                {/* Lupa expansible — busca productos dentro del pedido */}
                                {pedItems.length > 0 && (
                                    <div className="flex items-center justify-end">
                                        {searchOpen ? (
                                            <div className="relative w-full max-w-[280px]">
                                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                                                <input
                                                    autoFocus
                                                    type="text" placeholder="Buscar producto en este pedido…"
                                                    value={itemSearch}
                                                    onChange={e => setItemSearch(e.target.value)}
                                                    className="w-full text-[12px] border border-slate-200 rounded-lg pl-7 pr-7 py-1.5 focus:outline-none focus:border-blue-400 bg-white placeholder-slate-300"
                                                />
                                                <button
                                                    onClick={() => { setSearchOpen(false); setItemSearch(''); }}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setSearchOpen(true)}
                                                title="Buscar producto en este pedido"
                                                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-300 transition-colors">
                                                <Search size={13} />
                                            </button>
                                        )}
                                    </div>
                                )}
                                {loadingItems && pedItems.length === 0 ? (
                                    <div className="flex items-center gap-2 text-slate-400 py-4">
                                        <Loader2 size={16} className="animate-spin" />
                                        <span className="text-[13px]">Cargando ítems…</span>
                                    </div>
                                ) : sucGroups.length === 0 ? (
                                    <p className="text-[13px] text-slate-400 py-2">
                                        {q ? `Sin resultados para "${itemSearch}".` : 'Sin ítems registrados.'}
                                    </p>
                                ) : (
                                    sucGroups.map(([sucId, rows]) => {
                                        const suc        = Number(sucId);
                                        const sucKey     = `${p.id}_${suc}`;
                                        const isSucOpen  = isSecOpen(`${sucKey}_suc`, true);
                                        const allRows    = sucGroupsAll.find(([id]) => Number(id) === suc)?.[1] ?? rows;
                                        const sucFirmas  = pedFirmas.filter(f => f.erp_sucursal_id === suc).map(f => f.employees).filter(Boolean);
                                        const sucExtras  = pedExtras.filter(e => e.erp_sucursal_id === suc);
                                        // Fallback para pedidos viejos sin firmas: received_by de los ítems
                                        const recibioEmps = sucFirmas.length > 0 ? sucFirmas
                                            : [...new Set(rows.map(r => r.received_by).filter(Boolean))]
                                                .map(id => empMap[id]).filter(Boolean);

                                        const sentRows    = rows.filter(r => !r.sin_stock && !r.revision_minmax);
                                        const sinRows     = rows.filter(r => r.sin_stock);
                                        const revRows     = rows.filter(r => r.revision_minmax && !r.sin_stock);
                                        const isSentOpen  = isSecOpen(`${sucKey}_sent`, true);
                                        const isSinOpen   = isSecOpen(`${sucKey}_sin`, false);
                                        const isRevOpen   = isSecOpen(`${sucKey}_rev`, false);

                                        const pendingRows = sentRows.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0);
                                        const hasPending  = pendingRows.length > 0;
                                        const difCount    = sentRows.filter(r => r.status === 'con_diferencia').length;
                                        const pedLotes    = lotes[p.id] ?? {};

                                        // Lifecycle para esta sucursal
                                        const lifecycle     = lifecycleMap[p.id]?.[suc] ?? {};
                                        const lcKey         = `${p.id}_${suc}`;
                                        const lcBusy        = !!updatingLifecycle[lcKey];
                                        const isPausado     = !!lifecycle.pausado_at && !lifecycle.reanudado_at;
                                        const canIniciar    = p.status === 'confirmado' && !lifecycle.iniciado_at;
                                        const canPausar     = p.status === 'confirmado' && !!lifecycle.iniciado_at && !lifecycle.finalizado_at && !isPausado;
                                        const canReanudar   = isPausado && !lifecycle.finalizado_at;
                                        const canFinalizar  = p.status === 'confirmado' && !!lifecycle.iniciado_at && !lifecycle.finalizado_at && !isPausado;
                                        const erpRecibido   = !!lifecycle.recibido_erp_at;

                                        // Tiempos entre etapas
                                        const dtGenToIni   = fmtElapsed(p.created_at,           lifecycle.iniciado_at);
                                        const dtIniToPause = fmtElapsed(lifecycle.iniciado_at,   lifecycle.pausado_at);
                                        const dtPauseToRes = fmtElapsed(lifecycle.pausado_at,    lifecycle.reanudado_at);
                                        const dtIniToFin   = fmtElapsed(lifecycle.reanudado_at ?? lifecycle.iniciado_at, lifecycle.finalizado_at);
                                        const dtFinToEnv   = fmtElapsed(lifecycle.finalizado_at, p.enviado_at);
                                        const dtEnvToRec   = sucFirmas[0]
                                            ? fmtElapsed(p.enviado_at, sucFirmas[0]?.created_at)
                                            : null;
                                        const dtRecToErp   = fmtElapsed(
                                            sucFirmas[0]?.created_at,
                                            lifecycle.recibido_erp_at
                                        );

                                        return (
                                            <div key={suc} className="border border-slate-100 rounded-xl overflow-hidden">

                                                {/* Sucursal header — collapsible */}
                                                <button
                                                    onClick={() => toggleSec(`${sucKey}_suc`, true)}
                                                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50/60 hover:bg-slate-100/50 transition-colors text-left"
                                                >
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isSucOpen ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                                            {isSucOpen
                                                                ? <ChevronDown  size={12} className="text-blue-500" />
                                                                : <ChevronRight size={12} className="text-slate-400" />
                                                            }
                                                        </div>
                                                        <Building2 size={14} className="text-slate-400" />
                                                        <span className="font-semibold text-[13px] text-slate-700">
                                                            {ERP_NAMES[suc] ?? `Sucursal ${suc}`}
                                                        </span>
                                                        {lifecycle.codigo && (
                                                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 tracking-wide">
                                                                {lifecycle.codigo}
                                                            </span>
                                                        )}
                                                        {isPausado && (
                                                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                                                <Pause size={9} /> Pausado{lifecycle.pausa_razon ? ` · ${lifecycle.pausa_razon}` : ''}
                                                            </span>
                                                        )}
                                                        <span className="text-[11px] text-slate-400">· {sentRows.length} enviados</span>
                                                        {difCount > 0 && (
                                                            <span className="text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
                                                                {difCount} con diferencia
                                                            </span>
                                                        )}
                                                        {sinRows.length > 0 && (
                                                            <span className="text-[11px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100">
                                                                {sinRows.length} sin stock
                                                            </span>
                                                        )}
                                                        {revRows.length > 0 && (
                                                            <span className="text-[11px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-full border border-slate-100">
                                                                {revRows.length} revisión
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                                        {/* Lifecycle action buttons */}
                                                        {canIniciar && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); handleLifecycleAction(p.id, suc, 'iniciar'); }}
                                                                disabled={lcBusy}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                                                            >
                                                                {lcBusy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                                                                Iniciar
                                                            </button>
                                                        )}
                                                        {canPausar && (
                                                            <button
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    setPauseRazonSel('almuerzo');
                                                                    setPauseRazonText('');
                                                                    setPauseModal({ pedidoId: p.id, sucId: suc });
                                                                }}
                                                                disabled={lcBusy}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
                                                            >
                                                                <Pause size={11} />
                                                                Pausar
                                                            </button>
                                                        )}
                                                        {canReanudar && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); handleLifecycleAction(p.id, suc, 'reanudar'); }}
                                                                disabled={lcBusy}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                                                            >
                                                                {lcBusy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                                                                Reanudar
                                                            </button>
                                                        )}
                                                        {canFinalizar && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); handleLifecycleAction(p.id, suc, 'finalizar'); }}
                                                                disabled={lcBusy}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                                            >
                                                                {lcBusy ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
                                                                Finalizar
                                                            </button>
                                                        )}
                                                        {hasPending && p.status === 'enviado' && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); openRecepcion(p.id, suc); }}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                                            >
                                                                <ArrowDown size={11} />
                                                                Confirmar recepción
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={async e => {
                                                                e.stopPropagation();
                                                                const meta = await loadPedidoMeta(p);
                                                                printFromPedidoItems(p.numero, [[suc, allRows]], meta, lifecycle.codigo ?? null);
                                                            }}
                                                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                                                            title="Imprimir esta sucursal"
                                                        >
                                                            <Printer size={11} />
                                                        </button>
                                                    </div>
                                                </button>

                                                {isSucOpen && (
                                                    <div>
                                                        {/* ── Timeline de lifecycle ──────────────── */}
                                                        {(lifecycle.iniciado_at || lifecycle.finalizado_at || lifecycle.recibido_erp_at || p.enviado_at) && (
                                                            <div className="flex items-center gap-1 px-3 py-2 border-t border-slate-100 bg-slate-50/40 flex-wrap">
                                                                <Clock size={10} className="text-slate-300 flex-shrink-0" />
                                                                {/* Generado */}
                                                                <span className="text-[9px] text-slate-400 whitespace-nowrap">
                                                                    Gen: {fmtTime(p.created_at)}
                                                                </span>
                                                                {/* → Iniciado */}
                                                                {lifecycle.iniciado_at && (<>
                                                                    {dtGenToIni && <span className="text-[9px] text-slate-300">→{dtGenToIni}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <Play size={8} />
                                                                        {empMap[lifecycle.iniciado_por]?.name?.split(' ')[0] ?? fmtTime(lifecycle.iniciado_at)}
                                                                    </span>
                                                                </>)}
                                                                {/* → Pausado */}
                                                                {lifecycle.pausado_at && (<>
                                                                    {dtIniToPause && <span className="text-[9px] text-slate-300">→{dtIniToPause}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <Pause size={8} />
                                                                        {lifecycle.pausa_razon ?? fmtTime(lifecycle.pausado_at)}
                                                                    </span>
                                                                    {lifecycle.reanudado_at && (<>
                                                                        {dtPauseToRes && <span className="text-[9px] text-slate-300">→{dtPauseToRes}→</span>}
                                                                        <span className="inline-flex items-center gap-0.5 text-[9px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                            <Play size={8} />
                                                                            {fmtTime(lifecycle.reanudado_at)}
                                                                        </span>
                                                                    </>)}
                                                                </>)}
                                                                {/* → Finalizado */}
                                                                {lifecycle.finalizado_at && (<>
                                                                    {dtIniToFin && <span className="text-[9px] text-slate-300">→{dtIniToFin}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <Flag size={8} />
                                                                        {empMap[lifecycle.finalizado_por]?.name?.split(' ')[0] ?? fmtTime(lifecycle.finalizado_at)}
                                                                    </span>
                                                                </>)}
                                                                {/* → Enviado */}
                                                                {p.enviado_at && (<>
                                                                    {dtFinToEnv && <span className="text-[9px] text-slate-300">→{dtFinToEnv}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <Send size={8} />
                                                                        {fmtTime(p.enviado_at)}
                                                                    </span>
                                                                </>)}
                                                                {/* → Recibido */}
                                                                {sucFirmas[0]?.created_at && (<>
                                                                    {dtEnvToRec && <span className="text-[9px] text-slate-300">→{dtEnvToRec}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <CheckCircle2 size={8} />
                                                                        {fmtTime(sucFirmas[0].created_at)}
                                                                    </span>
                                                                </>)}
                                                                {/* → ERP */}
                                                                {lifecycle.recibido_erp_at && (<>
                                                                    {dtRecToErp && <span className="text-[9px] text-slate-300">→{dtRecToErp}→</span>}
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                                        <Database size={8} />
                                                                        ERP {fmtTime(lifecycle.recibido_erp_at)}
                                                                    </span>
                                                                </>)}
                                                                {/* Botón ERP si ya recibido físico pero no en ERP */}
                                                                {sucFirmas.length > 0 && !lifecycle.recibido_erp_at && (
                                                                    <button
                                                                        onClick={e => { e.stopPropagation(); handleLifecycleAction(p.id, suc, 'recibir_erp'); }}
                                                                        disabled={lcBusy}
                                                                        className="inline-flex items-center gap-0.5 text-[9px] bg-white border border-violet-200 text-violet-600 hover:bg-violet-50 px-1.5 py-0.5 rounded-full whitespace-nowrap transition-colors disabled:opacity-50"
                                                                    >
                                                                        {lcBusy ? <Loader2 size={8} className="animate-spin" /> : <Database size={8} />}
                                                                        Recibir en ERP
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* ── Productos enviados ─────────────────── */}
                                                        {sentRows.length > 0 && (
                                                            <>
                                                                <button
                                                                    onClick={() => toggleSec(`${sucKey}_sent`, true)}
                                                                    className="w-full flex items-center gap-2 px-3 py-2 border-t border-slate-100 bg-white/60 hover:bg-slate-50/60 transition-colors text-left"
                                                                >
                                                                    {isSentOpen
                                                                        ? <ChevronDown  size={12} className="text-slate-400" />
                                                                        : <ChevronRight size={12} className="text-slate-400" />
                                                                    }
                                                                    <span className="text-[11px] font-semibold text-slate-600">
                                                                        Productos enviados ({sentRows.length})
                                                                    </span>
                                                                </button>
                                                                {isSentOpen && (
                                                                    <div className="overflow-x-auto">
                                                                        <table className="w-full text-[12px] min-w-[500px]">
                                                                            <thead>
                                                                                <tr className="bg-[#0052CC]/[0.04] border-b border-[#0052CC]/[0.09]">
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Producto</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-20">Asignado</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-20">Recibido</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-16">Δ Dif.</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Nota</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-24">Estado</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {sentRows.map(row => {
                                                                                    const diff = row.cantidad_recibida !== null
                                                                                        ? row.cantidad_recibida - row.cantidad_asignada
                                                                                        : null;
                                                                                    const rowLotes = row.lotes_asignados ?? pedLotes[row.erp_product_id] ?? [];
                                                                                    return (
                                                                                        <tr key={row.id} className={`border-t border-[#0052CC]/[0.06] transition-colors ${
                                                                                            row.status === 'con_diferencia' ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-[#0052CC]/[0.025]'
                                                                                        }`}>
                                                                                            <td className="px-3 py-2 font-medium text-slate-700">
                                                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                                                    <span>{row.products?.nombre}</span>
                                                                                                    {row.products?.es_antibiotico && (
                                                                                                        <span title="Antibiótico" className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 border border-violet-200">
                                                                                                            <FlaskConical size={9} className="text-violet-600" />
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                                <LotePills lotes={rowLotes} />
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{row.cantidad_asignada}</td>
                                                                                            <td className="px-3 py-2 text-center tabular-nums">
                                                                                                {row.cantidad_recibida !== null
                                                                                                    ? <span className="font-semibold text-slate-700">{row.cantidad_recibida}</span>
                                                                                                    : <span className="text-slate-300">—</span>
                                                                                                }
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-center tabular-nums">
                                                                                                {diff !== null && diff !== 0 ? (
                                                                                                    <span className={`font-semibold ${diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                                                                        {diff > 0 ? '+' : ''}{diff}
                                                                                                    </span>
                                                                                                ) : <span className="text-slate-200">—</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-slate-400 text-[11px] italic max-w-[160px]">
                                                                                                {(row.error_tipo || row.nota_diferencia) ? (
                                                                                                    <span className="block truncate">
                                                                                                        {row.error_tipo && (
                                                                                                            <span className="not-italic text-[9px] font-bold uppercase text-amber-600 mr-1">[{row.error_tipo}]</span>
                                                                                                        )}
                                                                                                        {row.nota_diferencia ? `"${row.nota_diferencia}"` : ''}
                                                                                                    </span>
                                                                                                ) : <span className="text-slate-200">—</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-center">
                                                                                                <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_PILL[row.status] ?? ''}`}>
                                                                                                    {STATUS_LABEL[row.status] ?? row.status}
                                                                                                </span>
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}

                                                        {/* ── Sin stock en Bodega ─────────────────── */}
                                                        {sinRows.length > 0 && (
                                                            <>
                                                                <button
                                                                    onClick={() => toggleSec(`${sucKey}_sin`, false)}
                                                                    className="w-full flex items-center gap-2 px-3 py-2 border-t border-red-100 bg-red-50/40 hover:bg-red-50/70 transition-colors text-left"
                                                                >
                                                                    {isSinOpen
                                                                        ? <ChevronDown  size={12} className="text-red-400" />
                                                                        : <ChevronRight size={12} className="text-red-400" />
                                                                    }
                                                                    <span className="text-[11px] font-semibold text-red-600">
                                                                        Sin stock en Bodega ({sinRows.length})
                                                                    </span>
                                                                    <span className="text-[11px] text-red-400">— no se enviaron</span>
                                                                </button>
                                                                {isSinOpen && (
                                                                    <div className="overflow-x-auto">
                                                                        <table className="w-full text-[12px] min-w-[480px]">
                                                                            <thead>
                                                                                <tr className="bg-red-50/60 border-b border-red-100">
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-left">Producto</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-left w-28">Laboratorio</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-center w-20">Necesidad</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-center w-28">Razón</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {sinRows.map(row => {
                                                                                    const nec = row.max_qty_snapshot != null && row.stock_packs_snapshot != null
                                                                                        ? Math.max(0, row.max_qty_snapshot - Math.floor(Number(row.stock_packs_snapshot)))
                                                                                        : (row.cantidad_asignada ?? '—');
                                                                                    return (
                                                                                    <tr key={row.id} className="border-t border-red-50 hover:bg-red-50/50 transition-colors opacity-70">
                                                                                        <td className="px-3 py-2 font-medium text-slate-700">
                                                                                            <div className="flex items-center gap-1.5">
                                                                                                <span>{row.products?.nombre}</span>
                                                                                                {row.products?.es_antibiotico && (
                                                                                                    <span title="Antibiótico" className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 border border-violet-200">
                                                                                                        <FlaskConical size={9} className="text-violet-600" />
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        </td>
                                                                                        <td className="px-3 py-2 text-slate-400 text-[11px]">{row.products?.laboratorios?.nombre ?? '—'}</td>
                                                                                        <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{nec}</td>
                                                                                        <td className="px-3 py-2 text-center">
                                                                                            <span className="text-[11px] text-red-500 font-medium">Sin stock en Bodega</span>
                                                                                        </td>
                                                                                    </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}

                                                        {/* ── Revisión Min/Max ─────────────────────── */}
                                                        {revRows.length > 0 && (
                                                            <>
                                                                <button
                                                                    onClick={() => toggleSec(`${sucKey}_rev`, false)}
                                                                    className="w-full flex items-center gap-2 px-3 py-2 border-t border-amber-100 bg-amber-50/40 hover:bg-amber-50/70 transition-colors text-left"
                                                                >
                                                                    {isRevOpen
                                                                        ? <ChevronDown  size={12} className="text-amber-500" />
                                                                        : <ChevronRight size={12} className="text-amber-500" />
                                                                    }
                                                                    <span className="text-[11px] font-semibold text-amber-700">
                                                                        No enviados — revisión ({revRows.length})
                                                                    </span>
                                                                    <span className="text-[11px] text-amber-500">— bodega insuficiente para un múltiplo</span>
                                                                </button>
                                                                {isRevOpen && (
                                                                    <div className="overflow-x-auto">
                                                                        <table className="w-full text-[12px] min-w-[480px]">
                                                                            <thead>
                                                                                <tr className="bg-amber-50/60 border-b border-amber-100">
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-left">Producto</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-left w-28">Laboratorio</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-center w-20">Necesidad</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-center w-40">Razón</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {revRows.map(row => {
                                                                                    const nec = row.max_qty_snapshot != null && row.stock_packs_snapshot != null
                                                                                        ? Math.max(0, row.max_qty_snapshot - Math.floor(Number(row.stock_packs_snapshot)))
                                                                                        : (row.cantidad_asignada ?? '—');
                                                                                    return (
                                                                                    <tr key={row.id} className="border-t border-amber-50 hover:bg-amber-50/60 transition-colors opacity-75">
                                                                                        <td className="px-3 py-2 font-medium text-slate-700">
                                                                                            <div className="flex items-center gap-1.5">
                                                                                                <span>{row.products?.nombre}</span>
                                                                                                {row.products?.es_antibiotico && (
                                                                                                    <span title="Antibiótico" className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 border border-violet-200">
                                                                                                        <FlaskConical size={9} className="text-violet-600" />
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        </td>
                                                                                        <td className="px-3 py-2 text-slate-400 text-[11px]">{row.products?.laboratorios?.nombre ?? '—'}</td>
                                                                                        <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{nec}</td>
                                                                                        <td className="px-3 py-2 text-center">
                                                                                            <span className="text-[11px] text-amber-600 font-medium">Stock insuficiente para múltiplo</span>
                                                                                        </td>
                                                                                    </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                        {/* ── Recepción: extras + responsables con foto ── */}
                                                        {(sucExtras.length > 0 || recibioEmps.length > 0) && (
                                                            <div className="px-3 py-2.5 border-t border-slate-100 bg-slate-50/40 space-y-2">
                                                                {sucExtras.length > 0 && (
                                                                    <div className="space-y-1">
                                                                        <p className="flex items-center gap-1 text-[10px] font-semibold text-violet-500 uppercase tracking-wide">
                                                                            <PackagePlus size={11} /> Llegaron sin estar en el pedido ({sucExtras.length})
                                                                        </p>
                                                                        {sucExtras.map(ex => (
                                                                            <div key={ex.id} className="flex items-center gap-2 py-1 px-2.5 rounded-lg bg-violet-50/70 border border-violet-100">
                                                                                <span className="flex-1 text-[12px] font-medium text-slate-700 truncate">{ex.products?.nombre ?? '?'}</span>
                                                                                {ex.nota && <span className="text-[10px] text-slate-400 italic truncate max-w-[160px]">"{ex.nota}"</span>}
                                                                                <span className="text-[12px] font-bold text-violet-600 tabular-nums shrink-0">{ex.cantidad} pk</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {recibioEmps.length > 0 && (
                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Recibido por:</span>
                                                                        {recibioEmps.map(emp => <EmpChip key={emp.id} emp={emp} />)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* ── Load more ──────────────────────────────────────────────── */}
            {hasMore && !loading && (
                <div className="flex justify-center pt-2">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[13px] font-medium transition-colors disabled:opacity-50 shadow-sm"
                    >
                        {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <ArrowDown size={14} />}
                        Cargar más pedidos
                    </button>
                </div>
            )}

            {/* ── Reception modal — unificado ───────────────────────────── */}
            {modal && (
                <RecepcionModal
                    open={!!modal}
                    onClose={() => setModal(null)}
                    pedido={modal.pedido}
                    sucursalId={modal.sucursalId}
                    sucursalNombre={ERP_NAMES[modal.sucursalId] ?? `Sucursal ${modal.sucursalId}`}
                    rows={modal.rows}
                    onConfirmed={handleRecepcionConfirmed}
                />
            )}

            {/* ── Borradores guardados ────────────────────────────────────── */}
            <div className={GLASS + ' overflow-hidden'}>
                <button
                    onClick={() => setSnapsOpen(o => !o)}
                    className="w-full flex items-center gap-2 px-5 py-3.5 hover:bg-blue-50/20 transition-colors text-left"
                >
                    {snapsOpen
                        ? <ChevronDown  size={14} className="text-slate-400" />
                        : <ChevronRight size={14} className="text-slate-400" />}
                    <BookMarked size={15} className="text-indigo-500" />
                    <span className="font-semibold text-slate-700 text-[14px]">Borradores guardados</span>
                    {snapshots.length > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold">
                            {snapshots.length}
                        </span>
                    )}
                </button>
                {snapsOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {snapsLoading ? (
                            <div className="flex items-center gap-2 px-5 py-4 text-slate-400">
                                <Loader2 size={14} className="animate-spin" />
                                <span className="text-[13px]">Cargando borradores…</span>
                            </div>
                        ) : snapshots.length === 0 ? (
                            <div className="px-5 py-6 text-center text-slate-400 text-[13px]">
                                No hay borradores guardados. Usa "Guardar borrador" en la vista de preview.
                            </div>
                        ) : snapshots.map(snap => (
                            <div key={snap.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/60 transition-colors">
                                <div className="min-w-0">
                                    <p className="font-medium text-slate-700 text-[13px] truncate">{snap.nombre}</p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        {fmtDate(snap.created_at)} &nbsp;·&nbsp; {snap.total_filas} productos &nbsp;·&nbsp; {snap.total_packs} packs
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                                    <button
                                        onClick={() => printFromSnapshot(snap)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-white transition-colors"
                                    >
                                        <Printer size={11} /> Imprimir
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelSnap(snap)}
                                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                        title="Eliminar borrador"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Modal anular con motivo (ModalShell, centrado) ──────────── */}
            {confirmAnul && (
                <ModalShell open={!!confirmAnul} onClose={() => { setConfirmAnul(null); setAnulMotivo(''); setAnulError(null); }} maxWidthClass="max-w-sm">
                    <div className="w-full rounded-2xl bg-white shadow-2xl p-6 space-y-4">
                        <h3 className="font-bold text-slate-800 text-[16px]">
                            Anular Pedido #{confirmAnul.numero}
                        </h3>
                        <p className="text-[13px] text-slate-500">
                            Se cancelarán todos los ítems pendientes. Esta acción no se puede deshacer.
                        </p>
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                Motivo <span className="font-normal normal-case">(opcional)</span>
                            </label>
                            <textarea
                                value={anulMotivo}
                                onChange={e => setAnulMotivo(e.target.value)}
                                placeholder="Describe el motivo de la anulación…"
                                rows={3}
                                className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-400 resize-none bg-white"
                            />
                        </div>
                        {anulError && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[12px]">
                                <AlertTriangle size={13} /> {anulError}
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setConfirmAnul(null); setAnulMotivo(''); setAnulError(null); }}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={doAnular}
                                disabled={!!anulando}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 text-[13px] transition-colors disabled:opacity-50"
                            >
                                {anulando ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                                Sí, anular
                            </button>
                        </div>
                    </div>
                </ModalShell>
            )}

            {/* ── Confirm borrar snapshot ─────────────────────────────────── */}
            <ConfirmModal
                isOpen={!!confirmDelSnap}
                onClose={() => setConfirmDelSnap(null)}
                onConfirm={doDeleteSnap}
                title="Eliminar borrador"
                message={`¿Eliminar el borrador "${confirmDelSnap?.nombre}"?`}
                confirmText="Eliminar"
                cancelText="Cancelar"
                isDestructive
                isProcessing={deletingSnap}
            />

            {/* ── Pausa reason modal ──────────────────────────────────────── */}
            {pauseModal && (
                <ModalShell onClose={() => setPauseModal(null)}>
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
                        <h3 className="font-bold text-slate-800 text-[16px]">¿Por qué pausas este despacho?</h3>
                        <p className="text-[12px] text-slate-400">
                            {ERP_NAMES[pauseModal.sucId] ?? `Sucursal ${pauseModal.sucId}`}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { key: 'almuerzo',      label: 'Almuerzo' },
                                { key: 'actividades',   label: 'Otras actividades' },
                                { key: 'interrupcion',  label: 'Interrupción temporal' },
                                { key: 'otro',          label: 'Otro…' },
                            ].map(opt => (
                                <button
                                    key={opt.key}
                                    onClick={() => setPauseRazonSel(opt.key)}
                                    className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors text-left ${
                                        pauseRazonSel === opt.key
                                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {pauseRazonSel === 'otro' && (
                            <input
                                type="text"
                                value={pauseRazonText}
                                onChange={e => setPauseRazonText(e.target.value)}
                                placeholder="Describe la razón…"
                                className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 bg-white"
                                autoFocus
                            />
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                onClick={() => setPauseModal(null)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    const razonLabel = {
                                        almuerzo:    'Almuerzo',
                                        actividades: 'Otras actividades',
                                        interrupcion:'Interrupción temporal',
                                    };
                                    const razon = pauseRazonSel === 'otro'
                                        ? (pauseRazonText.trim() || 'Otro')
                                        : (razonLabel[pauseRazonSel] ?? pauseRazonSel);
                                    handleLifecycleAction(pauseModal.pedidoId, pauseModal.sucId, 'pausar', razon);
                                    setPauseModal(null);
                                }}
                                disabled={pauseRazonSel === 'otro' && !pauseRazonText.trim()}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 text-[13px] transition-colors disabled:opacity-50"
                            >
                                <Pause size={13} /> Confirmar pausa
                            </button>
                        </div>
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
