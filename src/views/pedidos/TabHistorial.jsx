import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2,
    X, Package, Building2, AlertTriangle, Ban,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7];

const STATUS_PILL = {
    // Pedido-level
    confirmado:     'bg-blue-100 text-blue-700 border-blue-200',
    parcial:        'bg-amber-100 text-amber-700 border-amber-200',
    completado:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    anulado:        'bg-red-100 text-red-600 border-red-200',
    // Item-level
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
    { key: 'todos',      label: 'Todos' },
    { key: 'confirmado', label: 'Pendiente recepción' },
    { key: 'parcial',    label: 'Con diferencias' },
    { key: 'completado', label: 'Completados' },
    { key: 'anulado',    label: 'Anulados' },
];

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export default function TabHistorial({ searchTerm = '' }) {
    const [pedidos, setPedidos]           = useState([]);
    const [loading, setLoading]           = useState(true);
    const [filterTab, setFilterTab]       = useState('todos');
    const [expanded, setExpanded]         = useState(null);
    const [items, setItems]               = useState({});
    const [loadingItems, setLoadingItems] = useState(false);
    const [modal, setModal]               = useState(null);   // { pedidoId, sucursalId, rows }
    const [recepVals, setRecepVals]       = useState({});     // itemId → cantidad_recibida
    const [notaVals, setNotaVals]         = useState({});     // itemId → nota_diferencia
    const [saving, setSaving]             = useState(false);
    const [saveError, setSaveError]       = useState(null);
    const [anulando, setAnulando]         = useState(null);   // pedido id being cancelled

    const loadPedidos = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('pedidos')
            .select('id, numero, created_at, status, notes')
            .order('created_at', { ascending: false })
            .range(0, 99);
        setPedidos(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { loadPedidos(); }, [loadPedidos]);

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

    const loadItems = useCallback(async (pedidoId) => {
        if (items[pedidoId]) return;
        await fetchPedidoItems(pedidoId);
    }, [items, fetchPedidoItems]);

    const toggleExpand = useCallback(async (pedidoId) => {
        if (expanded === pedidoId) {
            setExpanded(null);
        } else {
            setExpanded(pedidoId);
            await loadItems(pedidoId);
        }
    }, [expanded, loadItems]);

    const openRecepcion = useCallback((pedidoId, sucursalId) => {
        const rows = (items[pedidoId] || []).filter(
            r => r.erp_sucursal_id === sucursalId
              && r.status === 'pendiente'
              && r.cantidad_asignada > 0
        );
        if (rows.length === 0) return;
        const vals = {};
        const notas = {};
        for (const r of rows) {
            vals[r.id]  = r.cantidad_asignada;
            notas[r.id] = '';
        }
        setRecepVals(vals);
        setNotaVals(notas);
        setSaveError(null);
        setModal({ pedidoId, sucursalId, rows });
    }, [items]);

    const handleConfirmarRecepcion = useCallback(async () => {
        if (!modal) return;
        setSaving(true);
        setSaveError(null);
        const { pedidoId, sucursalId, rows } = modal;

        const p_items = rows.map(r => ({
            pedido_item_id:    r.id,
            cantidad_recibida: recepVals[r.id] ?? r.cantidad_asignada,
            nota_diferencia:   notaVals[r.id] || null,
        }));

        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id:   pedidoId,
                p_sucursal_id: sucursalId,
                p_items,
            });
            if (error) throw error;

            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedidoId, {
                sucursal_id: sucursalId,
                items_count: p_items.length,
            });

            setModal(null);
            // Force refetch of items (invalidate cache) and pedido list
            await fetchPedidoItems(pedidoId);
            await loadPedidos();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [modal, recepVals, notaVals, fetchPedidoItems, loadPedidos]);

    const handleAnular = useCallback(async (pedidoId, numeroPedido) => {
        if (!window.confirm(`¿Anular el Pedido #${numeroPedido}? Se cancelarán todos los items pendientes.`)) return;
        setAnulando(pedidoId);
        try {
            const { error } = await supabase.rpc('anular_pedido', { p_pedido_id: pedidoId });
            if (error) throw error;

            useStaff.getState().appendAuditLog('ANULAR_PEDIDO', pedidoId, { numero: numeroPedido });

            // Invalidate items cache and refresh pedidos
            setItems(prev => { const n = { ...prev }; delete n[pedidoId]; return n; });
            await loadPedidos();
        } catch (e) {
            window.alert(e.message);
        } finally {
            setAnulando(null);
        }
    }, [loadPedidos]);

    const filtered = pedidos
        .filter(p => filterTab === 'todos' || p.status === filterTab)
        .filter(p => {
            if (!searchTerm.trim()) return true;
            const q = searchTerm.toLowerCase();
            return String(p.numero).includes(q) || (p.notes || '').toLowerCase().includes(q);
        });

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
            {/* Filter tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/70 w-fit">
                {FILTER_TABS.map(ft => (
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
                        {ft.key !== 'todos' && (
                            <span className="ml-1.5 text-[10px] text-slate-400">
                                ({pedidos.filter(p => p.status === ft.key).length})
                            </span>
                        )}
                    </button>
                ))}
            </div>

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

            {filtered.map(p => {
                const isExp    = expanded === p.id;
                const pedItems = items[p.id] || [];
                const canAnul  = p.status === 'confirmado' || p.status === 'parcial';

                // Group by sucursal, sorted by ERP_ORDER
                const sucMap = {};
                for (const row of pedItems) {
                    const s = row.erp_sucursal_id;
                    if (!sucMap[s]) sucMap[s] = [];
                    sucMap[s].push(row);
                }
                const sucGroups = ERP_ORDER
                    .filter(id => sucMap[id])
                    .map(id => [id, sucMap[id]]);
                // Include any sucursal IDs not in ERP_ORDER at the end
                for (const id of Object.keys(sucMap).map(Number)) {
                    if (!ERP_ORDER.includes(id)) sucGroups.push([id, sucMap[id]]);
                }

                return (
                    <div
                        key={p.id}
                        className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] overflow-hidden"
                    >
                        {/* Pedido header */}
                        <div className="flex items-center justify-between px-5 py-3 hover:bg-blue-50/20 transition-colors">
                            <button
                                className="flex items-center gap-3 flex-1 text-left"
                                onClick={() => toggleExpand(p.id)}
                            >
                                {isExp
                                    ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                                    : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                                }
                                <span className="font-bold text-slate-700 text-[15px]">Pedido #{p.numero}</span>
                                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${STATUS_PILL[p.status] ?? ''}`}>
                                    {STATUS_LABEL[p.status] ?? p.status}
                                </span>
                                {p.notes && (
                                    <span className="text-slate-400 text-[13px] truncate max-w-[220px] italic">"{p.notes}"</span>
                                )}
                            </button>
                            <div className="flex items-center gap-3">
                                <span className="text-[13px] text-slate-400 whitespace-nowrap">{fmtDate(p.created_at)}</span>
                                {canAnul && (
                                    <button
                                        onClick={() => handleAnular(p.id, p.numero)}
                                        disabled={anulando === p.id}
                                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                                    >
                                        {anulando === p.id
                                            ? <Loader2 size={11} className="animate-spin" />
                                            : <Ban size={11} />
                                        }
                                        Anular
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Expanded detail */}
                        {isExp && (
                            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                                {loadingItems && pedItems.length === 0 ? (
                                    <div className="flex items-center gap-2 text-slate-400 py-4">
                                        <Loader2 size={16} className="animate-spin" />
                                        <span className="text-[13px]">Cargando items…</span>
                                    </div>
                                ) : sucGroups.length === 0 ? (
                                    <p className="text-[13px] text-slate-400 py-2">Sin items registrados.</p>
                                ) : (
                                    sucGroups.map(([sucId, rows]) => {
                                        const suc        = Number(sucId);
                                        // Only show "Confirmar recepción" if there are actionable pending items
                                        const pendingRows = rows.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0);
                                        const hasPending  = pendingRows.length > 0;

                                        // Separate normal from sin_stock/revision items for display
                                        const normalRows  = rows.filter(r => !r.sin_stock && !r.revision_minmax);
                                        const specialRows = rows.filter(r => r.sin_stock || r.revision_minmax);

                                        return (
                                            <div key={suc} className="border border-slate-100 rounded-xl overflow-hidden">
                                                <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50/60">
                                                    <div className="flex items-center gap-2">
                                                        <Building2 size={14} className="text-slate-400" />
                                                        <span className="font-semibold text-[13px] text-slate-700">
                                                            {ERP_NAMES[suc] ?? `Sucursal ${suc}`}
                                                        </span>
                                                        <span className="text-[11px] text-slate-400">
                                                            · {rows.length} productos
                                                        </span>
                                                    </div>
                                                    {hasPending && (
                                                        <button
                                                            onClick={() => openRecepcion(p.id, suc)}
                                                            className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                                        >
                                                            Confirmar recepción
                                                        </button>
                                                    )}
                                                </div>

                                                <table className="w-full text-[12px]">
                                                    <thead>
                                                        <tr className="bg-[#0052CC]/[0.04] border-b border-[#0052CC]/[0.09]">
                                                            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Producto</th>
                                                            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center">Asignado</th>
                                                            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center">Recibido</th>
                                                            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">Nota</th>
                                                            <th className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center">Estado</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {normalRows.map(row => (
                                                            <tr key={row.id} className="border-t border-[#0052CC]/[0.06] hover:bg-[#0052CC]/[0.032] transition-colors">
                                                                <td className="px-3 py-2 text-slate-700 font-medium max-w-[200px]">
                                                                    <span className="block truncate">{row.products?.nombre}</span>
                                                                </td>
                                                                <td className="px-3 py-2 text-center text-slate-500 tabular-nums whitespace-nowrap">
                                                                    {row.cantidad_asignada} asignados
                                                                </td>
                                                                {row.cantidad_recibida !== null && (
                                                                    <td className="px-3 py-2 text-center text-slate-500 tabular-nums whitespace-nowrap">
                                                                        {row.cantidad_recibida} recibidos
                                                                    </td>
                                                                )}
                                                                {row.nota_diferencia && (
                                                                    <td className="px-3 py-2 text-slate-400 text-[11px] italic max-w-[160px]">
                                                                        <span className="block truncate">"{row.nota_diferencia}"</span>
                                                                    </td>
                                                                )}
                                                                <td className="px-3 py-2 text-center">
                                                                    <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_PILL[row.status] ?? ''}`}>
                                                                        {STATUS_LABEL[row.status] ?? row.status}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}

                                                        {/* Sin stock / revisión items at bottom, muted */}
                                                        {specialRows.map(row => (
                                                            <tr key={row.id} className="border-t border-[#0052CC]/[0.06] opacity-50">
                                                                <td className="px-3 py-2 text-slate-600 font-medium max-w-[200px]">
                                                                    <span className="block truncate">{row.products?.nombre}</span>
                                                                </td>
                                                                <td className="px-3 py-2 text-center" colSpan={3}>
                                                                    {row.sin_stock
                                                                        ? <span className="text-[11px] text-slate-400">Sin stock en Bodega</span>
                                                                        : <span className="text-[11px] text-amber-500">Revisión Min/Max</span>
                                                                    }
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Recepción modal */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800 text-[16px]">
                                Recepción — {ERP_NAMES[modal.sucursalId] ?? `Sucursal ${modal.sucursalId}`}
                            </h3>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 space-y-3 max-h-[55vh] overflow-y-auto">
                            <p className="text-[12px] text-slate-400">
                                Ingresa la cantidad realmente recibida. Si difiere de lo asignado, agrega una nota opcional.
                            </p>
                            {modal.rows.map(row => {
                                const recibida  = recepVals[row.id] ?? row.cantidad_asignada;
                                const hasDiff   = recibida !== row.cantidad_asignada;
                                return (
                                    <div key={row.id} className={`rounded-xl px-3 py-2.5 border transition-colors ${hasDiff ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                                        <div className="flex items-center gap-3 mb-1.5">
                                            <span className="flex-1 text-[13px] text-slate-700 font-medium truncate">
                                                {row.products?.nombre}
                                            </span>
                                            <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                                asignado: {row.cantidad_asignada}
                                            </span>
                                            <input
                                                type="number"
                                                min={0}
                                                value={recibida}
                                                onChange={e => setRecepVals(prev => ({
                                                    ...prev,
                                                    [row.id]: parseInt(e.target.value) || 0,
                                                }))}
                                                className={`w-16 text-center border rounded-lg px-1 py-1 text-[13px] focus:outline-none tabular-nums ${
                                                    hasDiff
                                                        ? 'border-amber-400 bg-amber-50 focus:border-amber-500'
                                                        : 'border-slate-200 focus:border-blue-400'
                                                }`}
                                            />
                                        </div>
                                        {hasDiff && (
                                            <input
                                                type="text"
                                                placeholder="Nota sobre la diferencia (opcional)…"
                                                value={notaVals[row.id] ?? ''}
                                                onChange={e => setNotaVals(prev => ({ ...prev, [row.id]: e.target.value }))}
                                                className="w-full text-[12px] border border-amber-200 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 bg-white placeholder-slate-300"
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
                                {saving
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : <CheckCircle2 size={14} />
                                }
                                Confirmar recepción
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
