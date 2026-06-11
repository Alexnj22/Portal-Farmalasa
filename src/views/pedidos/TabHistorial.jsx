import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2,
    X, Package, Building2, AlertTriangle, Ban, ArrowDown,
    Clock, CheckCheck, TrendingDown, FlaskConical, Printer,
    BookMarked, Trash2, CalendarDays,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import ConfirmModal from '../../components/common/ConfirmModal';
import { printFromPedidoItems, printFromSnapshot } from '../../utils/pedidoPrint';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE = 50;
const GLASS     = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const STATUS_PILL = {
    confirmado:     'bg-blue-100 text-blue-700 border-blue-200',
    parcial:        'bg-amber-100 text-amber-700 border-amber-200',
    completado:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    anulado:        'bg-red-100 text-red-600 border-red-200',
    pendiente:      'bg-slate-100 text-slate-500 border-slate-200',
    recibido:       'bg-emerald-100 text-emerald-700 border-emerald-200',
    con_diferencia: 'bg-amber-100 text-amber-700 border-amber-200',
};

const STATUS_LABEL = {
    confirmado:     'Pendiente recepción',
    parcial:        'Con diferencias',
    completado:     'Completado',
    anulado:        'Anulado',
    pendiente:      'Pendiente',
    recibido:       'Recibido',
    con_diferencia: 'Con diferencia',
};

const FILTER_TABS = [
    { key: 'todos',      label: 'Todos',               icon: null         },
    { key: 'confirmado', label: 'Pendiente recepción',  icon: Clock        },
    { key: 'parcial',    label: 'Con diferencias',      icon: TrendingDown },
    { key: 'completado', label: 'Completados',          icon: CheckCheck   },
    { key: 'anulado',    label: 'Anulados',             icon: Ban          },
];

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function fmtMes(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-SV', { month: 'short', year: '2-digit' });
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
    const cls = {
        blue:    'bg-blue-50    border-blue-100   text-blue-700',
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
    const [recepVals,        setRecepVals]        = useState({});
    const [notaVals,         setNotaVals]         = useState({});
    const [saving,           setSaving]           = useState(false);
    const [saveError,        setSaveError]        = useState(null);
    const [anulando,         setAnulando]         = useState(null);
    const [confirmAnul,      setConfirmAnul]      = useState(null);
    const [anulError,        setAnulError]        = useState(null);
    const [filterDesde,      setFilterDesde]      = useState('');
    const [filterHasta,      setFilterHasta]      = useState('');
    const [snapshots,        setSnapshots]        = useState([]);
    const [snapsLoading,     setSnapsLoading]     = useState(false);
    const [snapsOpen,        setSnapsOpen]        = useState(false);
    const [confirmDelSnap,   setConfirmDelSnap]   = useState(null);
    const [deletingSnap,     setDeletingSnap]     = useState(false);
    const [totalCounts,      setTotalCounts]      = useState(null);

    // ── Section toggle helpers ─────────────────────────────────────────────────
    const isSecOpen = (key, def) => sectionOpen[key] ?? def;
    const toggleSec = useCallback((key, def) => {
        setSectionOpen(prev => ({ ...prev, [key]: !(prev[key] ?? def) }));
    }, []);

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
            .select('id, numero, created_at, status, notes')
            .order('created_at', { ascending: false });
        if (desde) q = q.gte('created_at', desde);
        if (hasta) q = q.lte('created_at', hasta + 'T23:59:59');
        q = q.range(0, PAGE_SIZE - 1);
        const { data } = await q;
        const rows = data || [];
        setPedidos(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setLoading(false);
        if (rows.length) loadSucursales(rows.map(p => p.id));
    }, [loadSucursales]);

    // ── Load more ──────────────────────────────────────────────────────────────
    const loadMore = useCallback(async () => {
        setLoadingMore(true);
        const nextPage = page + 1;
        const from = nextPage * PAGE_SIZE;
        let q = supabase
            .from('pedidos')
            .select('id, numero, created_at, status, notes')
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
        if (rows.length) loadSucursales(rows.map(p => p.id));
    }, [page, loadSucursales, filterDesde, filterHasta]);

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
        const statuses = ['confirmado', 'parcial', 'completado', 'anulado'];
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

    // ── Fetch items + lotes for expanded pedido ────────────────────────────────
    const fetchPedidoItems = useCallback(async (pedidoId) => {
        setLoadingItems(true);
        const { data } = await supabase
            .from('pedido_items')
            .select(`
                id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
                cantidad_asignada, cantidad_recibida,
                sin_stock, revision_minmax,
                status, nota_diferencia, received_at,
                lotes_asignados,
                products ( nombre, es_antibiotico ),
                presentaciones ( tipo )
            `)
            .eq('pedido_id', pedidoId)
            .range(0, 9999);

        const rows = data || [];
        setItems(prev => ({ ...prev, [pedidoId]: rows }));

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
    }, []);

    const toggleExpand = useCallback(async (pedidoId) => {
        if (expanded === pedidoId) { setExpanded(null); return; }
        setExpanded(pedidoId);
        if (!items[pedidoId]) await fetchPedidoItems(pedidoId);
    }, [expanded, items, fetchPedidoItems]);

    // ── Reception modal ───────────────────────────────────────────────────────
    const openRecepcion = useCallback((pedidoId, sucursalId) => {
        const rows = (items[pedidoId] || []).filter(
            r => r.erp_sucursal_id === sucursalId && r.status === 'pendiente' && r.cantidad_asignada > 0
        );
        if (!rows.length) return;
        const vals = {}, notas = {};
        for (const r of rows) { vals[r.id] = r.cantidad_asignada; notas[r.id] = ''; }
        setRecepVals(vals); setNotaVals(notas); setSaveError(null);
        setModal({ pedidoId, sucursalId, rows });
    }, [items]);

    const handleConfirmarRecepcion = useCallback(async () => {
        if (!modal) return;
        setSaving(true); setSaveError(null);
        const { pedidoId, sucursalId, rows } = modal;
        const p_items = rows.map(r => ({
            pedido_item_id:    r.id,
            cantidad_recibida: recepVals[r.id] ?? r.cantidad_asignada,
            nota_diferencia:   notaVals[r.id] || null,
        }));
        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedidoId, p_sucursal_id: sucursalId, p_items,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedidoId, {
                sucursal_id: sucursalId, items_count: p_items.length,
            });
            setModal(null);
            await fetchPedidoItems(pedidoId);
            const { data } = await supabase
                .from('pedidos').select('id, numero, created_at, status, notes')
                .eq('id', pedidoId).single();
            if (data) setPedidos(prev => prev.map(p => p.id === pedidoId ? data : p));
            reloadCounts();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [modal, recepVals, notaVals, fetchPedidoItems, reloadCounts]);

    // ── Anular ────────────────────────────────────────────────────────────────
    const doAnular = useCallback(async () => {
        if (!confirmAnul) return;
        setAnulando(confirmAnul.id); setAnulError(null);
        try {
            const { error } = await supabase.rpc('anular_pedido', { p_pedido_id: confirmAnul.id });
            if (error) throw error;
            useStaff.getState().appendAuditLog('ANULAR_PEDIDO', confirmAnul.id, { numero: confirmAnul.numero });
            setItems(prev => { const n = { ...prev }; delete n[confirmAnul.id]; return n; });
            const { data } = await supabase
                .from('pedidos').select('id, numero, created_at, status, notes')
                .eq('id', confirmAnul.id).single();
            if (data) setPedidos(prev => prev.map(p => p.id === confirmAnul.id ? data : p));
            setConfirmAnul(null);
            reloadCounts();
        } catch (e) {
            setAnulError(e.message);
            setConfirmAnul(null);
        } finally {
            setAnulando(null);
        }
    }, [confirmAnul, reloadCounts]);

    // ── Todo recibido exacto ──────────────────────────────────────────────────
    const handleTodoRecibido = useCallback(() => {
        if (!modal) return;
        const vals = {}, notas = {};
        for (const r of modal.rows) { vals[r.id] = r.cantidad_asignada; notas[r.id] = ''; }
        setRecepVals(vals);
        setNotaVals(notas);
    }, [modal]);

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
                    <StatCard label="Pendientes"  value={(totalCounts ?? counts).confirmado ?? 0} color="blue"    />
                    <StatCard label="Diferencias" value={(totalCounts ?? counts).parcial    ?? 0} color="amber"   />
                    <StatCard label="Completados" value={(totalCounts ?? counts).completado ?? 0} color="emerald" />
                    <StatCard label="Anulados"    value={(totalCounts ?? counts).anulado    ?? 0} color="red"     />
                </div>
            )}

            {/* ── Date range filter ─────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
                <CalendarDays size={13} className="text-slate-400 shrink-0" />
                <input
                    type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)}
                    className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                />
                <span className="text-[11px] text-slate-400">—</span>
                <input
                    type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)}
                    className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                />
                {(filterDesde || filterHasta) && (
                    <button onClick={() => { setFilterDesde(''); setFilterHasta(''); }}
                        className="text-[11px] text-slate-400 hover:text-red-500 transition-colors flex items-center gap-0.5">
                        <X size={11} /> Limpiar
                    </button>
                )}
            </div>

            {/* ── Filter pills ──────────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {FILTER_TABS.map(ft => {
                    const cnt   = ft.key === 'todos' ? pedidos.length : (counts[ft.key] ?? 0);
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
                const canAnul  = p.status === 'confirmado' || p.status === 'parcial';
                const sucIds   = pedidoSucursales[p.id] ?? [];

                // Group items by sucursal
                const sucMap = {};
                for (const row of pedItems) {
                    const s = row.erp_sucursal_id;
                    if (!sucMap[s]) sucMap[s] = [];
                    sucMap[s].push(row);
                }
                const sucGroups = [
                    ...ERP_ORDER.filter(id => sucMap[id]).map(id => [id, sucMap[id]]),
                    ...Object.keys(sucMap).map(Number).filter(id => !ERP_ORDER.includes(id)).map(id => [id, sucMap[id]]),
                ];

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
                                    </div>
                                    {p.notes && (
                                        <p className="text-slate-400 text-[12px] truncate italic mt-0.5">"{p.notes}"</p>
                                    )}
                                </div>
                            </button>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                <span className="text-[12px] text-slate-400 whitespace-nowrap hidden sm:block">{fmtDate(p.created_at)}</span>
                                {isExp && sucGroups.length > 0 && (
                                    <button
                                        onClick={e => { e.stopPropagation(); printFromPedidoItems(p.numero, sucGroups); }}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                                        title="Imprimir pedido completo"
                                    >
                                        <Printer size={11} /> Imprimir
                                    </button>
                                )}
                                {canAnul && (
                                    <button
                                        onClick={() => setConfirmAnul({ id: p.id, numero: p.numero })}
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
                                {loadingItems && pedItems.length === 0 ? (
                                    <div className="flex items-center gap-2 text-slate-400 py-4">
                                        <Loader2 size={16} className="animate-spin" />
                                        <span className="text-[13px]">Cargando ítems…</span>
                                    </div>
                                ) : sucGroups.length === 0 ? (
                                    <p className="text-[13px] text-slate-400 py-2">Sin ítems registrados.</p>
                                ) : (
                                    sucGroups.map(([sucId, rows]) => {
                                        const suc        = Number(sucId);
                                        const sucKey     = `${p.id}_${suc}`;
                                        const isSucOpen  = isSecOpen(`${sucKey}_suc`, true);

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
                                                        {hasPending && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); openRecepcion(p.id, suc); }}
                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                                            >
                                                                <ArrowDown size={11} />
                                                                Confirmar recepción
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                printFromPedidoItems(p.numero, [[suc, rows]]);
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
                                                                                    const rowLotes = pedLotes[row.erp_product_id] ?? [];
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
                                                                                            <td className="px-3 py-2 text-slate-400 text-[11px] italic max-w-[140px]">
                                                                                                {row.nota_diferencia
                                                                                                    ? <span className="block truncate">"{row.nota_diferencia}"</span>
                                                                                                    : <span className="text-slate-200">—</span>
                                                                                                }
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
                                                                        <table className="w-full text-[12px] min-w-[360px]">
                                                                            <thead>
                                                                                <tr className="bg-red-50/60 border-b border-red-100">
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-left">Producto</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-center w-20">Necesitaba</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 text-center w-28">Razón</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {sinRows.map(row => (
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
                                                                                        <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{row.cantidad_asignada ?? '—'}</td>
                                                                                        <td className="px-3 py-2 text-center">
                                                                                            <span className="text-[11px] text-red-500 font-medium">Sin stock en Bodega</span>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
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
                                                                        <table className="w-full text-[12px] min-w-[360px]">
                                                                            <thead>
                                                                                <tr className="bg-amber-50/60 border-b border-amber-100">
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-left">Producto</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-center w-20">Necesitaba</th>
                                                                                    <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-500 text-center w-40">Razón</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {revRows.map(row => (
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
                                                                                        <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{row.cantidad_asignada ?? '—'}</td>
                                                                                        <td className="px-3 py-2 text-center">
                                                                                            <span className="text-[11px] text-amber-600 font-medium">Stock insuficiente para múltiplo</span>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </>
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

            {/* ── Reception modal ────────────────────────────────────────── */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-slate-800 text-[16px]">
                                    Recepción — {ERP_NAMES[modal.sucursalId] ?? `Sucursal ${modal.sucursalId}`}
                                </h3>
                                <p className="text-[12px] text-slate-400 mt-0.5">
                                    Ajusta la cantidad realmente recibida por producto.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleTodoRecibido}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                    title="Marcar todo como recibido exactamente"
                                >
                                    <CheckCircle2 size={12} /> Todo exacto
                                </button>
                                <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 space-y-2.5 max-h-[55vh] overflow-y-auto">
                            {modal.rows.map(row => {
                                const recibida = recepVals[row.id] ?? row.cantidad_asignada;
                                const hasDiff  = recibida !== row.cantidad_asignada;
                                const delta    = recibida - row.cantidad_asignada;
                                return (
                                    <div key={row.id} className={`rounded-xl px-3 py-3 border transition-colors ${
                                        hasDiff ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'
                                    }`}>
                                        <div className="flex items-center gap-3 mb-1.5">
                                            <span className="flex-1 text-[13px] text-slate-700 font-semibold">
                                                {row.products?.nombre}
                                            </span>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <span className="text-[11px] text-slate-400">asignado: <b>{row.cantidad_asignada}</b></span>
                                                {hasDiff && (
                                                    <span className={`text-[11px] font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                        {delta > 0 ? '+' : ''}{delta}
                                                    </span>
                                                )}
                                                <input
                                                    type="number" min={0} value={recibida}
                                                    onChange={e => setRecepVals(prev => ({ ...prev, [row.id]: parseInt(e.target.value) || 0 }))}
                                                    className={`w-16 text-center border rounded-lg px-1 py-1 text-[13px] font-semibold focus:outline-none tabular-nums ${
                                                        hasDiff ? 'border-amber-400 bg-amber-50 focus:border-amber-500' : 'border-slate-200 focus:border-blue-400'
                                                    }`}
                                                />
                                            </div>
                                        </div>
                                        {hasDiff && (
                                            <input
                                                type="text" placeholder="Nota sobre la diferencia (opcional)…"
                                                value={notaVals[row.id] ?? ''}
                                                onChange={e => setNotaVals(prev => ({ ...prev, [row.id]: e.target.value }))}
                                                className="w-full text-[12px] border border-amber-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 bg-white placeholder-slate-300"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {saveError && (
                            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-600 text-[12px]">
                                <AlertTriangle size={14} /> {saveError}
                            </div>
                        )}

                        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                            <button onClick={() => setModal(null)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmarRecepcion} disabled={saving}
                                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 text-[13px] transition-colors disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                Confirmar recepción
                            </button>
                        </div>
                    </div>
                </div>
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

            {/* ── Confirm anular ──────────────────────────────────────────── */}
            <ConfirmModal
                isOpen={!!confirmAnul}
                onClose={() => setConfirmAnul(null)}
                onConfirm={doAnular}
                title={`Anular Pedido #${confirmAnul?.numero}`}
                message="Se cancelarán todos los ítems pendientes. Esta acción no se puede deshacer."
                confirmText="Sí, anular pedido"
                cancelText="Cancelar"
                isDestructive
                isProcessing={!!anulando}
            />

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
        </div>
    );
}
