import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2,
    X, Package, Building2, AlertTriangle, Ban, RefreshCw,
    ArrowDown, Clock, CheckCheck, TrendingDown,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import ConfirmModal from '../../components/common/ConfirmModal';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE = 50;

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
    { key: 'todos',      label: 'Todos',               icon: null          },
    { key: 'confirmado', label: 'Pendiente recepción',  icon: Clock         },
    { key: 'parcial',    label: 'Con diferencias',      icon: TrendingDown  },
    { key: 'completado', label: 'Completados',          icon: CheckCheck    },
    { key: 'anulado',    label: 'Anulados',             icon: Ban           },
];

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// ─── Summary stat card ────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
    const cls = {
        blue:    'bg-blue-50    border-blue-100   text-blue-700',
        amber:   'bg-amber-50   border-amber-100  text-amber-700',
        emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
        red:     'bg-red-50     border-red-100    text-red-600',
        slate:   'bg-slate-50   border-slate-100  text-slate-500',
    }[color];
    return (
        <div className={`rounded-xl border px-4 py-2.5 flex flex-col items-center ${cls}`}>
            <span className="text-xl font-black tabular-nums leading-none">{value}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</span>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TabHistorial({ searchTerm = '' }) {
    const [pedidos,      setPedidos]      = useState([]);
    const [loading,      setLoading]      = useState(true);
    const [loadingMore,  setLoadingMore]  = useState(false);
    const [hasMore,      setHasMore]      = useState(false);
    const [page,         setPage]         = useState(0);
    const [filterTab,    setFilterTab]    = useState('todos');
    const [expanded,     setExpanded]     = useState(null);
    const [items,        setItems]        = useState({});
    const [loadingItems, setLoadingItems] = useState(false);
    const [modal,        setModal]        = useState(null);
    const [recepVals,    setRecepVals]    = useState({});
    const [notaVals,     setNotaVals]     = useState({});
    const [saving,       setSaving]       = useState(false);
    const [saveError,    setSaveError]    = useState(null);
    const [anulando,     setAnulando]     = useState(null);
    const [confirmAnul,  setConfirmAnul]  = useState(null); // { id, numero }
    const [anulError,    setAnulError]    = useState(null);

    // ── Load (initial or refresh) ─────────────────────────────────────────────
    const loadPedidos = useCallback(async (reset = true) => {
        if (reset) { setLoading(true); setPedidos([]); setPage(0); }
        else setLoadingMore(true);

        const currentPage = reset ? 0 : page + 1;
        const from = currentPage * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        const { data } = await supabase
            .from('pedidos')
            .select('id, numero, created_at, status, notes')
            .order('created_at', { ascending: false })
            .range(from, to);

        const rows = data || [];
        if (reset) setPedidos(rows);
        else { setPedidos(prev => [...prev, ...rows]); setPage(currentPage); }

        setHasMore(rows.length === PAGE_SIZE);
        if (reset) setLoading(false);
        else setLoadingMore(false);
    }, [page]);

    useEffect(() => { loadPedidos(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Items ─────────────────────────────────────────────────────────────────
    const fetchPedidoItems = useCallback(async (pedidoId) => {
        setLoadingItems(true);
        const { data } = await supabase
            .from('pedido_items')
            .select(`
                id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
                cantidad_asignada, cantidad_recibida,
                sin_stock, revision_minmax,
                status, nota_diferencia, received_at,
                products ( nombre )
            `)
            .eq('pedido_id', pedidoId)
            .range(0, 9999);
        setItems(prev => ({ ...prev, [pedidoId]: data || [] }));
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
            // Refresh just this pedido's status
            const { data } = await supabase
                .from('pedidos').select('id, numero, created_at, status, notes')
                .eq('id', pedidoId).single();
            if (data) setPedidos(prev => prev.map(p => p.id === pedidoId ? data : p));
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [modal, recepVals, notaVals, fetchPedidoItems]);

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
        } catch (e) {
            setAnulError(e.message);
            setConfirmAnul(null);
        } finally {
            setAnulando(null);
        }
    }, [confirmAnul]);

    // ── Filtered list ─────────────────────────────────────────────────────────
    const filtered = pedidos
        .filter(p => filterTab === 'todos' || p.status === filterTab)
        .filter(p => {
            if (!searchTerm.trim()) return true;
            const q = searchTerm.toLowerCase();
            return String(p.numero).includes(q) || (p.notes || '').toLowerCase().includes(q);
        });

    // Stats (from all loaded pedidos, not filtered)
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
            {pedidos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1">
                    <StatCard label="Pendientes" value={counts.confirmado ?? 0} color="blue"    />
                    <StatCard label="Diferencias" value={counts.parcial    ?? 0} color="amber"   />
                    <StatCard label="Completados" value={counts.completado ?? 0} color="emerald" />
                    <StatCard label="Anulados"    value={counts.anulado    ?? 0} color="red"     />
                    <div className="flex items-center gap-1.5 ml-auto">
                        <button
                            onClick={() => loadPedidos(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-[12px] transition-colors"
                        >
                            <RefreshCw size={13} />
                            Actualizar
                        </button>
                    </div>
                </div>
            )}

            {/* ── Filter tabs ───────────────────────────────────────────── */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/70 w-fit flex-wrap">
                {FILTER_TABS.map(ft => {
                    const cnt = ft.key === 'todos' ? pedidos.length : (counts[ft.key] ?? 0);
                    return (
                        <button
                            key={ft.key}
                            onClick={() => setFilterTab(ft.key)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                                filterTab === ft.key
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {ft.label}
                            <span className="ml-1.5 text-[10px] text-slate-400">({cnt})</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Error de anulación ────────────────────────────────────── */}
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
                    {filterTab === 'todos' && (
                        <p className="text-[13px]">Usa la pestaña Generar para crear el primer pedido.</p>
                    )}
                </div>
            )}

            {/* ── Pedido cards ───────────────────────────────────────────── */}
            {filtered.map(p => {
                const isExp     = expanded === p.id;
                const pedItems  = items[p.id] || [];
                const canAnul   = p.status === 'confirmado' || p.status === 'parcial';

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

                // Quick stats for expanded header
                const totalItems    = pedItems.length;
                const itemsPending  = pedItems.filter(r => r.status === 'pendiente').length;
                const itemsDiff     = pedItems.filter(r => r.status === 'con_diferencia').length;

                return (
                    <div
                        key={p.id}
                        className="rounded-2xl border border-slate-200/60 bg-white/70 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,0,0,0.05)] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50/20 transition-colors">
                            <button
                                className="flex items-center gap-3 flex-1 text-left"
                                onClick={() => toggleExpand(p.id)}
                            >
                                <div className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${isExp ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                    {isExp
                                        ? <ChevronDown size={14} className="text-blue-500" />
                                        : <ChevronRight size={14} className="text-slate-400" />
                                    }
                                </div>
                                <span className="font-bold text-slate-800 text-[15px]">Pedido #{p.numero}</span>
                                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_PILL[p.status] ?? ''}`}>
                                    {STATUS_LABEL[p.status] ?? p.status}
                                </span>
                                {isExp && totalItems > 0 && (
                                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                        <span>{totalItems} productos</span>
                                        {itemsPending  > 0 && <span className="text-blue-500">{itemsPending} pendientes</span>}
                                        {itemsDiff     > 0 && <span className="text-amber-500">{itemsDiff} con diferencia</span>}
                                    </div>
                                )}
                                {!isExp && p.notes && (
                                    <span className="text-slate-400 text-[13px] truncate max-w-[220px] italic">"{p.notes}"</span>
                                )}
                            </button>
                            <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-[12px] text-slate-400 whitespace-nowrap hidden sm:block">{fmtDate(p.created_at)}</span>
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

                        {/* Expanded detail */}
                        {isExp && (
                            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                                {p.notes && (
                                    <p className="text-[12px] text-slate-500 italic border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/60">
                                        Nota: "{p.notes}"
                                    </p>
                                )}
                                {loadingItems && pedItems.length === 0 ? (
                                    <div className="flex items-center gap-2 text-slate-400 py-4">
                                        <Loader2 size={16} className="animate-spin" />
                                        <span className="text-[13px]">Cargando ítems…</span>
                                    </div>
                                ) : sucGroups.length === 0 ? (
                                    <p className="text-[13px] text-slate-400 py-2">Sin ítems registrados.</p>
                                ) : (
                                    sucGroups.map(([sucId, rows]) => {
                                        const suc         = Number(sucId);
                                        const pendingRows = rows.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0);
                                        const hasPending  = pendingRows.length > 0;
                                        const normalRows  = rows.filter(r => !r.sin_stock && !r.revision_minmax);
                                        const specialRows = rows.filter(r => r.sin_stock || r.revision_minmax);
                                        const difCount    = rows.filter(r => r.status === 'con_diferencia').length;

                                        return (
                                            <div key={suc} className="border border-slate-100 rounded-xl overflow-hidden">
                                                {/* Sucursal header */}
                                                <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50/60">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Building2 size={14} className="text-slate-400" />
                                                        <span className="font-semibold text-[13px] text-slate-700">
                                                            {ERP_NAMES[suc] ?? `Sucursal ${suc}`}
                                                        </span>
                                                        <span className="text-[11px] text-slate-400">· {rows.length} productos</span>
                                                        {difCount > 0 && (
                                                            <span className="text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
                                                                {difCount} con diferencia
                                                            </span>
                                                        )}
                                                    </div>
                                                    {hasPending && (
                                                        <button
                                                            onClick={() => openRecepcion(p.id, suc)}
                                                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                                        >
                                                            <ArrowDown size={11} />
                                                            Confirmar recepción
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Items table */}
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-[12px] min-w-[500px]">
                                                        <thead>
                                                            <tr className="bg-[#0052CC]/[0.04] border-b border-[#0052CC]/[0.09]">
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Producto</th>
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-24">Asignado</th>
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-24">Recibido</th>
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-20">Δ Dif.</th>
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Nota</th>
                                                                <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center w-24">Estado</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {normalRows.map(row => {
                                                                const diff = row.cantidad_recibida !== null
                                                                    ? row.cantidad_recibida - row.cantidad_asignada
                                                                    : null;
                                                                return (
                                                                    <tr key={row.id} className={`border-t border-[#0052CC]/[0.06] transition-colors ${
                                                                        row.status === 'con_diferencia' ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-[#0052CC]/[0.025]'
                                                                    }`}>
                                                                        <td className="px-3 py-2 font-medium text-slate-700 max-w-[200px]">
                                                                            <span className="block truncate">{row.products?.nombre}</span>
                                                                        </td>
                                                                        <td className="px-3 py-2 text-center text-slate-500 tabular-nums">
                                                                            {row.cantidad_asignada}
                                                                        </td>
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
                                                                            ) : (
                                                                                <span className="text-slate-200">—</span>
                                                                            )}
                                                                        </td>
                                                                        <td className="px-3 py-2 text-slate-400 text-[11px] italic max-w-[160px]">
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

                                                            {/* Sin stock / revision rows — muted, colspan */}
                                                            {specialRows.map(row => (
                                                                <tr key={row.id} className="border-t border-slate-100 opacity-45">
                                                                    <td className="px-3 py-2 text-slate-600 font-medium max-w-[200px]">
                                                                        <span className="block truncate">{row.products?.nombre}</span>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-center" colSpan={4}>
                                                                        {row.sin_stock
                                                                            ? <span className="text-[11px] text-slate-400">Sin stock en Bodega</span>
                                                                            : <span className="text-[11px] text-amber-500">Revisión Min/Max</span>
                                                                        }
                                                                    </td>
                                                                    <td className="px-3 py-2 text-center">
                                                                        <span className="px-1.5 py-0.5 rounded-full border text-[10px] font-semibold bg-slate-100 text-slate-400 border-slate-200">
                                                                            {row.sin_stock ? 'Sin stock' : 'Revisión'}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* ── Load more ─────────────────────────────────────────────── */}
            {hasMore && !loading && (
                <div className="flex justify-center pt-2">
                    <button
                        onClick={() => loadPedidos(false)}
                        disabled={loadingMore}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[13px] font-medium transition-colors disabled:opacity-50 shadow-sm"
                    >
                        {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <ArrowDown size={14} />}
                        Cargar más pedidos
                    </button>
                </div>
            )}

            {/* ── Reception modal ───────────────────────────────────────── */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="font-bold text-slate-800 text-[16px]">
                                    Recepción — {ERP_NAMES[modal.sucursalId] ?? `Sucursal ${modal.sucursalId}`}
                                </h3>
                                <p className="text-[12px] text-slate-400 mt-0.5">
                                    Ajusta la cantidad realmente recibida por producto.
                                </p>
                            </div>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                                <X size={18} />
                            </button>
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
                                            <span className="flex-1 text-[13px] text-slate-700 font-semibold truncate">
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
                                                    type="number"
                                                    min={0}
                                                    value={recibida}
                                                    onChange={e => setRecepVals(prev => ({
                                                        ...prev, [row.id]: parseInt(e.target.value) || 0,
                                                    }))}
                                                    className={`w-16 text-center border rounded-lg px-1 py-1 text-[13px] font-semibold focus:outline-none tabular-nums ${
                                                        hasDiff
                                                            ? 'border-amber-400 bg-amber-50 focus:border-amber-500'
                                                            : 'border-slate-200 focus:border-blue-400'
                                                    }`}
                                                />
                                            </div>
                                        </div>
                                        {hasDiff && (
                                            <input
                                                type="text"
                                                placeholder="Nota sobre la diferencia (opcional)…"
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
                            <button
                                onClick={() => setModal(null)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmarRecepcion}
                                disabled={saving}
                                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 text-[13px] transition-colors disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                Confirmar recepción
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Confirm anular modal ──────────────────────────────────── */}
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
        </div>
    );
}
