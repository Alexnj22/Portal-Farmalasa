import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronRight, ChevronDown, CheckCircle2,
    X, Package, Building2, AlertTriangle,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};

const STATUS_PILL = {
    confirmado:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    parcial:        'bg-amber-100 text-amber-700 border-amber-200',
    anulado:        'bg-red-100 text-red-700 border-red-200',
    pendiente:      'bg-slate-100 text-slate-500 border-slate-200',
    recibido:       'bg-emerald-100 text-emerald-700 border-emerald-200',
    con_diferencia: 'bg-amber-100 text-amber-700 border-amber-200',
};

const STATUS_LABEL = {
    confirmado: 'Confirmado', parcial: 'Parcial', anulado: 'Anulado',
    pendiente: 'Pendiente', recibido: 'Recibido', con_diferencia: 'Con diferencia',
};

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export default function TabHistorial() {
    const [pedidos, setPedidos]             = useState([]);
    const [loading, setLoading]             = useState(true);
    const [expanded, setExpanded]           = useState(null);
    const [items, setItems]                 = useState({});
    const [loadingItems, setLoadingItems]   = useState(false);
    const [modal, setModal]                 = useState(null);
    const [recepVals, setRecepVals]         = useState({});
    const [saving, setSaving]               = useState(false);
    const [saveError, setSaveError]         = useState(null);

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

    const loadItems = useCallback(async (pedidoId) => {
        if (items[pedidoId]) return;
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
    }, [items]);

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
            r => r.erp_sucursal_id === sucursalId && r.status === 'pendiente'
        );
        const vals = {};
        for (const r of rows) vals[r.id] = r.cantidad_asignada;
        setRecepVals(vals);
        setSaveError(null);
        setModal({ pedidoId, sucursalId, rows });
    }, [items]);

    const handleConfirmarRecepcion = useCallback(async () => {
        if (!modal) return;
        setSaving(true);
        setSaveError(null);
        const { pedidoId, sucursalId, rows } = modal;

        const p_items = rows.map(r => ({
            pedido_item_id:   r.id,
            cantidad_recibida: recepVals[r.id] ?? r.cantidad_asignada,
            nota_diferencia:  null,
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
            });

            // Update local items state
            setItems(prev => {
                const updated = (prev[pedidoId] || []).map(r => {
                    if (r.erp_sucursal_id !== sucursalId || r.status !== 'pendiente') return r;
                    const recibida = recepVals[r.id] ?? r.cantidad_asignada;
                    const hasDiff  = recibida !== r.cantidad_asignada;
                    return {
                        ...r,
                        cantidad_recibida: recibida,
                        status: hasDiff ? 'con_diferencia' : 'recibido',
                        received_at: new Date().toISOString(),
                    };
                });
                return { ...prev, [pedidoId]: updated };
            });

            setModal(null);
            loadPedidos();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [modal, recepVals, loadPedidos]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando historial…</span>
            </div>
        );
    }

    if (pedidos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <Package size={40} />
                <p className="font-medium text-[15px]">No hay pedidos generados todavía</p>
                <p className="text-[13px]">Usa la pestaña Generar para crear el primer pedido.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">
            {pedidos.map(p => {
                const isExp    = expanded === p.id;
                const pedItems = items[p.id] || [];

                // Group by sucursal
                const sucGroups = {};
                for (const row of pedItems) {
                    const s = row.erp_sucursal_id;
                    if (!sucGroups[s]) sucGroups[s] = [];
                    sucGroups[s].push(row);
                }

                return (
                    <div key={p.id} className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] overflow-hidden">
                        {/* Pedido header */}
                        <button
                            className="w-full flex items-center justify-between px-5 py-3 hover:bg-blue-50/30 transition-colors"
                            onClick={() => toggleExpand(p.id)}
                        >
                            <div className="flex items-center gap-3">
                                {isExp
                                    ? <ChevronDown size={16} className="text-slate-400" />
                                    : <ChevronRight size={16} className="text-slate-400" />
                                }
                                <span className="font-bold text-slate-700 text-[15px]">Pedido #{p.numero}</span>
                                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${STATUS_PILL[p.status] ?? ''}`}>
                                    {STATUS_LABEL[p.status] ?? p.status}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-[13px] text-slate-400">
                                {p.notes && (
                                    <span className="text-slate-500 truncate max-w-[220px] italic">"{p.notes}"</span>
                                )}
                                <span>{fmtDate(p.created_at)}</span>
                            </div>
                        </button>

                        {/* Expanded detail */}
                        {isExp && (
                            <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                                {loadingItems && pedItems.length === 0 ? (
                                    <div className="flex items-center gap-2 text-slate-400 py-4">
                                        <Loader2 size={16} className="animate-spin" />
                                        <span className="text-[13px]">Cargando items…</span>
                                    </div>
                                ) : Object.keys(sucGroups).length === 0 ? (
                                    <p className="text-[13px] text-slate-400 py-2">Sin items registrados.</p>
                                ) : (
                                    Object.entries(sucGroups).map(([sucId, rows]) => {
                                        const suc        = Number(sucId);
                                        const hasPending = rows.some(r => r.status === 'pendiente');
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
                                                    <tbody>
                                                        {rows.map(row => (
                                                            <tr key={row.id} className="border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                                                                <td className="px-3 py-2 text-slate-700 font-medium max-w-[200px]">
                                                                    <span className="block truncate">{row.products?.nombre}</span>
                                                                </td>
                                                                <td className="px-3 py-2 text-center text-slate-500 tabular-nums whitespace-nowrap">
                                                                    {row.cantidad_asignada} packs asignados
                                                                </td>
                                                                {row.cantidad_recibida !== null && (
                                                                    <td className="px-3 py-2 text-center text-slate-500 tabular-nums whitespace-nowrap">
                                                                        {row.cantidad_recibida} recibidos
                                                                    </td>
                                                                )}
                                                                <td className="px-2 py-2 text-center">
                                                                    {row.sin_stock && (
                                                                        <span className="text-[10px] text-red-500 font-medium">Sin stock</span>
                                                                    )}
                                                                    {row.revision_minmax && (
                                                                        <span className="text-[10px] text-amber-500 font-medium">Revisar Min/Max</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2 text-center">
                                                                    <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_PILL[row.status] ?? ''}`}>
                                                                        {STATUS_LABEL[row.status] ?? row.status}
                                                                    </span>
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
                                Confirmar recepción — {ERP_NAMES[modal.sucursalId]}
                            </h3>
                            <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 space-y-2 max-h-[55vh] overflow-y-auto">
                            <p className="text-[12px] text-slate-400 mb-3">
                                Ingresa la cantidad realmente recibida. Si coincide con lo asignado se marca como recibido; de lo contrario como "con diferencia".
                            </p>
                            {modal.rows.map(row => (
                                <div key={row.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                                    <span className="flex-1 text-[13px] text-slate-700 font-medium truncate">
                                        {row.products?.nombre}
                                    </span>
                                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                        asignado: {row.cantidad_asignada}
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={recepVals[row.id] ?? row.cantidad_asignada}
                                        onChange={e => setRecepVals(prev => ({
                                            ...prev,
                                            [row.id]: parseInt(e.target.value) || 0,
                                        }))}
                                        className="w-16 text-center border border-slate-200 rounded-lg px-1 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 tabular-nums"
                                    />
                                </div>
                            ))}
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
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
