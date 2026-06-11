import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2, PackageCheck,
    AlertTriangle, X, Package, Building2, TrendingDown, CheckCheck,
    CalendarDays,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const STATUS_PILL = {
    enviado:    'bg-indigo-100 text-indigo-700 border-indigo-200',
    parcial:    'bg-amber-100  text-amber-700  border-amber-200',
    completado: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    anulado:    'bg-red-100    text-red-600    border-red-200',
};

const STATUS_LABEL = {
    enviado:    'En camino',
    parcial:    'Con diferencias',
    completado: 'Completado',
    anulado:    'Anulado',
};

const FILTER_TABS = [
    { key: 'enviado',    label: 'Pendientes de recepción', icon: Package   },
    { key: 'parcial',    label: 'Con diferencias',          icon: TrendingDown },
    { key: 'completado', label: 'Completados',              icon: CheckCheck },
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

function LotePills({ lotes }) {
    if (!lotes?.length) return null;
    const today = new Date();
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {lotes.map((l, i) => {
                const fv       = l.fecha_vencimiento ? new Date(l.fecha_vencimiento) : null;
                const daysLeft = fv ? Math.floor((fv - today) / 86_400_000) : null;
                const expCls   = daysLeft === null ? 'text-slate-400'
                    : daysLeft < 30  ? 'text-red-500 font-semibold'
                    : daysLeft < 90  ? 'text-amber-500'
                    : 'text-emerald-600';
                return (
                    <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                        <span className="text-slate-500 font-medium">{l.lote || '—'}</span>
                        {fv && <span className={expCls}>{fmtMes(l.fecha_vencimiento)}</span>}
                    </span>
                );
            })}
        </div>
    );
}

export default function TabRecepcion({ searchTerm = '', refreshKey = 0 }) {
    const { user } = useAuth();

    const [erpSucursalId, setErpSucursalId] = useState(null);
    const [branchName,    setBranchName]    = useState('');
    const [pedidos,       setPedidos]       = useState([]);
    const [loading,       setLoading]       = useState(true);
    const [expanded,      setExpanded]      = useState(null);
    const [items,         setItems]         = useState({});
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [filterTab,     setFilterTab]     = useState('enviado');
    const [modal,         setModal]         = useState(null);
    const [recepVals,     setRecepVals]     = useState({});
    const [notaVals,      setNotaVals]      = useState({});
    const [saving,        setSaving]        = useState(false);
    const [saveError,     setSaveError]     = useState(null);

    // Resolve employee → branch → erp_sucursal_id on mount
    useEffect(() => {
        if (!user?.id) return;
        (async () => {
            const { data: emp } = await supabase
                .from('employees')
                .select('branch_id')
                .eq('user_id', user.id)
                .single();
            if (!emp?.branch_id) { setLoading(false); return; }

            const { data: mapRow } = await supabase
                .from('erp_sucursal_map')
                .select('erp_sucursal_id')
                .eq('branch_id', emp.branch_id)
                .eq('es_bodega', false)
                .single();
            if (!mapRow) { setLoading(false); return; }

            setErpSucursalId(mapRow.erp_sucursal_id);
            setBranchName(ERP_NAMES[mapRow.erp_sucursal_id] ?? `Sucursal ${mapRow.erp_sucursal_id}`);
        })();
    }, [user?.id]);

    const loadPedidos = useCallback(async (sucId) => {
        if (!sucId) return;
        setLoading(true);
        const { data } = await supabase
            .from('pedidos')
            .select('id, numero, created_at, status, notes, enviado_at')
            .contains('sucursal_ids', [sucId])
            .in('status', ['enviado', 'parcial', 'completado'])
            .order('created_at', { ascending: false })
            .range(0, 99);
        setPedidos(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { if (erpSucursalId) loadPedidos(erpSucursalId); }, [erpSucursalId, loadPedidos]);
    useEffect(() => { if (refreshKey > 0 && erpSucursalId) loadPedidos(erpSucursalId); }, [refreshKey]); // eslint-disable-line

    // Load items for a specific pedido, filtered to this branch's sucursal
    const fetchItems = useCallback(async (pedidoId) => {
        if (!erpSucursalId) return;
        setLoadingItems(true);
        const { data } = await supabase
            .from('pedido_items')
            .select(`
                id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
                cantidad_asignada, cantidad_recibida,
                sin_stock, revision_minmax,
                status, nota_diferencia, received_at, lotes_asignados,
                products ( nombre, es_antibiotico ),
                presentaciones ( tipo )
            `)
            .eq('pedido_id', pedidoId)
            .eq('erp_sucursal_id', erpSucursalId)
            .range(0, 999);
        setItems(prev => ({ ...prev, [pedidoId]: data || [] }));
        setLoadingItems(false);
    }, [erpSucursalId]);

    const toggleExpand = useCallback(async (pedidoId) => {
        if (expanded === pedidoId) { setExpanded(null); return; }
        setExpanded(pedidoId);
        if (!items[pedidoId]) await fetchItems(pedidoId);
    }, [expanded, items, fetchItems]);

    // Open reception modal for a pending pedido
    const openModal = useCallback((pedidoId) => {
        const rows = (items[pedidoId] || []).filter(
            r => r.status === 'pendiente' && r.cantidad_asignada > 0
        );
        if (!rows.length) return;
        const vals = {}, notas = {};
        for (const r of rows) { vals[r.id] = r.cantidad_asignada; notas[r.id] = ''; }
        setRecepVals(vals); setNotaVals(notas); setSaveError(null);
        setModal({ pedidoId, rows });
    }, [items]);

    const handleTodoRecibido = useCallback(() => {
        if (!modal) return;
        const vals = {}, notas = {};
        for (const r of modal.rows) { vals[r.id] = r.cantidad_asignada; notas[r.id] = ''; }
        setRecepVals(vals); setNotaVals(notas);
    }, [modal]);

    const handleConfirmar = useCallback(async () => {
        if (!modal || !erpSucursalId) return;
        setSaving(true); setSaveError(null);
        const { pedidoId, rows } = modal;
        const p_items = rows.map(r => ({
            pedido_item_id:    r.id,
            cantidad_recibida: recepVals[r.id] ?? r.cantidad_asignada,
            nota_diferencia:   notaVals[r.id] || null,
        }));
        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id:   pedidoId,
                p_sucursal_id: erpSucursalId,
                p_items,
                p_received_by: user?.id ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedidoId, {
                sucursal_id: erpSucursalId, items_count: p_items.length,
            });

            // Notify bodega if any differences
            const hasDiff = p_items.some(
                (it, i) => it.cantidad_recibida < rows[i].cantidad_asignada
            );
            if (hasDiff) {
                try {
                    const { data: bodegaMap } = await supabase
                        .from('erp_sucursal_map')
                        .select('branch_id')
                        .eq('es_bodega', true)
                        .single();
                    if (bodegaMap?.branch_id) {
                        const pedido = pedidos.find(p => p.id === pedidoId);
                        const num    = pedido?.numero ?? '?';
                        const title  = `Diferencias en Pedido #${num} — ${branchName}`;
                        const msg    = `La recepción del pedido #${num} en ${branchName} tiene diferencias de cantidad. Revisá el historial para ver los detalles.`;
                        await supabase.from('announcements').insert({
                            title, message: msg,
                            target_type: 'BRANCH', target_value: [bodegaMap.branch_id],
                            read_by: [], is_archived: false, created_by: user?.id ?? null,
                            priority: 'NORMAL',
                            metadata: { pedido_id: pedidoId, numero: num, sucursal_id: erpSucursalId },
                        });
                        supabase.functions.invoke('send-push-notification', {
                            body: { title, message: msg, url: '/pedidos?tab=historial', target_type: 'BRANCH', target_value: [bodegaMap.branch_id] },
                        }).catch(() => {});
                    }
                } catch { /* non-fatal */ }
            }

            setModal(null);
            await fetchItems(pedidoId);
            // Refresh pedido status
            const { data: updated } = await supabase
                .from('pedidos')
                .select('id, numero, created_at, status, notes, enviado_at')
                .eq('id', pedidoId).single();
            if (updated) setPedidos(prev => prev.map(p => p.id === pedidoId ? updated : p));
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [modal, recepVals, notaVals, erpSucursalId, user, pedidos, branchName, fetchItems]);

    // Filter & search
    const filtered = pedidos
        .filter(p => p.status === filterTab)
        .filter(p => {
            if (!searchTerm.trim()) return true;
            const q = searchTerm.toLowerCase();
            return String(p.numero).includes(q) || (p.notes || '').toLowerCase().includes(q);
        });

    const counts = pedidos.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando pedidos…</span>
            </div>
        );
    }

    if (!erpSucursalId) {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
                <Building2 size={32} className="opacity-40" />
                <p className="text-[13px]">Tu cuenta no está asociada a una sucursal con mapeo ERP.</p>
                <p className="text-[11px] text-slate-300">Contactá al administrador del sistema.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">

            {/* Branch badge */}
            <div className="flex items-center gap-2">
                <Building2 size={14} className="text-blue-500" />
                <span className="text-[12px] font-semibold text-slate-600">{branchName}</span>
                <span className="text-[11px] text-slate-400">— Pedidos asignados a esta sucursal</span>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {FILTER_TABS.map(ft => {
                    const cnt   = counts[ft.key] ?? 0;
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
                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${isAct ? 'bg-white/20' : 'bg-slate-100'}`}>
                                {cnt}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Empty state */}
            {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-300">
                    <PackageCheck size={32} className="opacity-50" />
                    <p className="text-[13px] text-slate-400">
                        {filterTab === 'enviado' ? 'No hay pedidos en camino para esta sucursal.' : 'Sin pedidos en este estado.'}
                    </p>
                </div>
            )}

            {/* Pedido cards */}
            {filtered.map(pedido => {
                const isExp    = expanded === pedido.id;
                const rowItems = items[pedido.id] || [];
                const pending  = rowItems.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0);
                const received = rowItems.filter(r => r.status !== 'pendiente');

                return (
                    <div key={pedido.id} className={GLASS}>
                        {/* Header row */}
                        <button
                            onClick={() => toggleExpand(pedido.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 transition-colors rounded-2xl"
                        >
                            <span className="text-[13px] font-bold text-slate-700 tabular-nums">
                                #{pedido.numero}
                            </span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {STATUS_LABEL[pedido.status] ?? pedido.status}
                            </span>
                            <span className="text-[11px] text-slate-400 ml-auto">{fmtDate(pedido.enviado_at ?? pedido.created_at)}</span>
                            {isExp
                                ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                                : <ChevronRight size={14} className="text-slate-400 shrink-0" />
                            }
                        </button>

                        {/* Expanded content */}
                        {isExp && (
                            <div className="border-t border-slate-100 px-4 pb-4 space-y-3">
                                {loadingItems && !items[pedido.id] ? (
                                    <div className="flex items-center gap-2 py-4 text-slate-400">
                                        <Loader2 size={14} className="animate-spin" />
                                        <span className="text-[12px]">Cargando ítems…</span>
                                    </div>
                                ) : (
                                    <>
                                        {/* Pending items */}
                                        {pending.length > 0 && (
                                            <div className="space-y-1 pt-3">
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                                                    Productos por recibir ({pending.length})
                                                </p>
                                                {pending.map(r => (
                                                    <div key={r.id} className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-100">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[12px] font-medium text-slate-700 truncate">
                                                                {r.products?.nombre ?? '?'}
                                                                {r.products?.es_antibiotico && (
                                                                    <span className="ml-1 text-[8px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1 py-0.5 rounded-full">AB</span>
                                                                )}
                                                            </p>
                                                            <p className="text-[10px] text-slate-400">{r.presentaciones?.tipo ?? '—'}</p>
                                                            {r.lotes_asignados?.length > 0 && <LotePills lotes={r.lotes_asignados} />}
                                                        </div>
                                                        <span className="text-[13px] font-bold text-blue-700 tabular-nums shrink-0">
                                                            {r.cantidad_asignada} pk
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Already received items */}
                                        {received.length > 0 && (
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                                                    Recibidos ({received.length})
                                                </p>
                                                {received.map(r => {
                                                    const diff = (r.cantidad_recibida ?? r.cantidad_asignada) < r.cantidad_asignada;
                                                    return (
                                                        <div key={r.id} className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[12px] font-medium text-slate-700 truncate">
                                                                    {r.products?.nombre ?? '?'}
                                                                </p>
                                                                {r.nota_diferencia && (
                                                                    <p className="text-[10px] text-amber-600 mt-0.5">{r.nota_diferencia}</p>
                                                                )}
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <span className={`text-[12px] font-bold tabular-nums ${diff ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                                    {r.cantidad_recibida ?? r.cantidad_asignada}
                                                                    {diff && <span className="text-[10px] text-slate-400 ml-0.5">/ {r.cantidad_asignada}</span>}
                                                                </span>
                                                                {diff && <AlertTriangle size={11} className="text-amber-500 inline ml-1" />}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Action button */}
                                        {pedido.status === 'enviado' && pending.length > 0 && (
                                            <button
                                                onClick={() => openModal(pedido.id)}
                                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold transition-colors"
                                            >
                                                <PackageCheck size={14} />
                                                Confirmar recepción ({pending.length} productos)
                                            </button>
                                        )}

                                        {pedido.status === 'completado' && (
                                            <div className="flex items-center gap-2 py-2 text-emerald-600">
                                                <CheckCircle2 size={14} />
                                                <span className="text-[12px] font-semibold">Pedido completamente recibido</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Reception modal */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
                            <div>
                                <h3 className="text-[14px] font-bold text-slate-800">Confirmar recepción</h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">{branchName} · {modal.rows.length} productos</p>
                            </div>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Items list */}
                        <div className="overflow-y-auto max-h-[60vh] px-5 py-3 space-y-3">
                            {modal.rows.map(r => {
                                const received = recepVals[r.id] ?? r.cantidad_asignada;
                                const diff     = received < r.cantidad_asignada;
                                return (
                                    <div key={r.id} className="space-y-1.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-semibold text-slate-700 leading-snug">{r.products?.nombre ?? '?'}</p>
                                                <p className="text-[10px] text-slate-400">{r.presentaciones?.tipo ?? '—'} · Asignado: <b>{r.cantidad_asignada}</b> pk</p>
                                                {r.lotes_asignados?.length > 0 && <LotePills lotes={r.lotes_asignados} />}
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    onClick={() => setRecepVals(v => ({ ...v, [r.id]: Math.max(0, (v[r.id] ?? r.cantidad_asignada) - 1) }))}
                                                    className="w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-[14px] font-bold flex items-center justify-center"
                                                >−</button>
                                                <input
                                                    type="number" min="0" max={r.cantidad_asignada}
                                                    value={received}
                                                    onChange={e => setRecepVals(v => ({ ...v, [r.id]: Math.max(0, Math.min(r.cantidad_asignada, Number(e.target.value))) }))}
                                                    className={`w-14 text-center text-[13px] font-bold rounded-lg border py-1 focus:outline-none focus:ring-1 ${
                                                        diff
                                                            ? 'border-amber-300 text-amber-700 bg-amber-50 focus:ring-amber-400'
                                                            : 'border-emerald-300 text-emerald-700 bg-emerald-50 focus:ring-emerald-400'
                                                    }`}
                                                />
                                                <button
                                                    onClick={() => setRecepVals(v => ({ ...v, [r.id]: Math.min(r.cantidad_asignada, (v[r.id] ?? r.cantidad_asignada) + 1) }))}
                                                    className="w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-[14px] font-bold flex items-center justify-center"
                                                >+</button>
                                            </div>
                                        </div>
                                        {diff && (
                                            <input
                                                type="text"
                                                placeholder="Motivo de la diferencia (opcional)"
                                                value={notaVals[r.id] ?? ''}
                                                onChange={e => setNotaVals(v => ({ ...v, [r.id]: e.target.value }))}
                                                className="w-full text-[11px] rounded-lg border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-amber-300"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-4 border-t border-slate-100 space-y-2">
                            {saveError && (
                                <div className="flex items-center gap-2 text-red-600 text-[11px] bg-red-50 rounded-lg px-3 py-2">
                                    <AlertTriangle size={12} />
                                    {saveError}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleTodoRecibido}
                                    className="flex-1 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-[12px] font-medium hover:bg-slate-50 transition-colors"
                                >
                                    Todo recibido
                                </button>
                                <button
                                    onClick={handleConfirmar}
                                    disabled={saving}
                                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {saving ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
                                    {saving ? 'Guardando…' : 'Confirmar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
