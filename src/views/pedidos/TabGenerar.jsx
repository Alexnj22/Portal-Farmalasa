import React, { useState, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, RefreshCw, Building2, ClipboardList, CheckCircle2,
    Package, AlertTriangle, Info,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES = [5, 1, 2, 3, 4, 7]; // Excluding Bodega (6)

function UrgenciaBar({ pct }) {
    const color = pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#10b981';
    return (
        <div className="flex items-center gap-1.5 justify-center">
            <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="text-[11px] text-slate-400">{pct}%</span>
        </div>
    );
}

export default function TabGenerar() {
    const [selected, setSelected]       = useState(new Set(SUCURSALES));
    const [preview, setPreview]         = useState(null);
    const [loading, setLoading]         = useState(false);
    const [notes, setNotes]             = useState('');
    const [confirming, setConfirming]   = useState(false);
    const [confirmed, setConfirmed]     = useState(null);
    const [adjustments, setAdjustments] = useState({});
    const [error, setError]             = useState(null);

    const toggleSuc = useCallback((id) => {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
        setPreview(null);
        setAdjustments({});
    }, []);

    const toggleAll = useCallback(() => {
        setSelected(prev => prev.size === SUCURSALES.length ? new Set() : new Set(SUCURSALES));
        setPreview(null);
        setAdjustments({});
    }, []);

    const getKey = (row) => `${row.erp_sucursal_id}_${row.erp_product_id}_${row.erp_presentacion_id}`;

    const getAdjusted = useCallback((row) => {
        const k = getKey(row);
        return adjustments[k] !== undefined ? adjustments[k] : row.cantidad_asignada;
    }, [adjustments]);

    const setAdjusted = useCallback((row, val) => {
        const k = getKey(row);
        setAdjustments(prev => ({ ...prev, [k]: Math.max(0, val) }));
    }, []);

    const handleCalcular = useCallback(async () => {
        if (selected.size === 0) return;
        setLoading(true);
        setPreview(null);
        setAdjustments({});
        setError(null);
        try {
            const { data, error: rpcErr } = await supabase
                .rpc('get_pedido_preview', { p_sucursal_ids: [...selected] })
                .range(0, 9999);
            if (rpcErr) throw rpcErr;
            setPreview(data || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [selected]);

    const grouped = useMemo(() => {
        if (!preview) return null;
        const map = {};
        for (const row of preview) {
            const s = row.erp_sucursal_id;
            if (!map[s]) map[s] = [];
            map[s].push(row);
        }
        return map;
    }, [preview]);

    const totals = useMemo(() => {
        if (!grouped) return {};
        const t = {};
        for (const [suc, rows] of Object.entries(grouped)) {
            t[suc] = {
                productos: rows.length,
                packs: rows.reduce((s, r) => s + getAdjusted(r), 0),
                sinStock: rows.filter(r => r.sin_stock).length,
                revision: rows.filter(r => r.revision_minmax).length,
            };
        }
        return t;
    }, [grouped, adjustments]);

    const handleConfirmar = useCallback(async () => {
        if (!preview || preview.length === 0) return;
        setConfirming(true);
        setError(null);
        try {
            const empId = useStaff.getState().currentEmployee?.id;
            const items = preview.map(row => ({
                erp_sucursal_id:     row.erp_sucursal_id,
                erp_product_id:      row.erp_product_id,
                erp_presentacion_id: row.erp_presentacion_id,
                cantidad_asignada:   getAdjusted(row),
                sin_stock:           row.sin_stock,
                revision_minmax:     row.revision_minmax,
            }));

            const { data: pedidoId, error: rpcErr } = await supabase.rpc('confirm_pedido', {
                p_created_by: empId ?? null,
                p_notes:      notes || null,
                p_items:      items,
            });
            if (rpcErr) throw rpcErr;

            const { data: ped } = await supabase.from('pedidos').select('numero').eq('id', pedidoId).single();

            useStaff.getState().appendAuditLog('GENERAR_PEDIDO', pedidoId, {
                sucursales:  [...selected],
                items_count: items.length,
                numero:      ped?.numero,
            });

            setConfirmed({ id: pedidoId, numero: ped?.numero });
            setPreview(null);
            setNotes('');
            setAdjustments({});
        } catch (e) {
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    }, [preview, notes, selected, getAdjusted]);

    if (confirmed) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Pedido #{confirmed.numero} generado</h3>
                <p className="text-slate-500 text-[14px]">Puedes ver el estado en la pestaña Historial.</p>
                <button
                    onClick={() => setConfirmed(null)}
                    className="mt-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                >
                    Nuevo pedido
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">
            {/* Sucursal selector */}
            <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-700 text-[15px]">Sucursales a reponer</h3>
                    <button
                        onClick={toggleAll}
                        className="text-[12px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
                    >
                        {selected.size === SUCURSALES.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {SUCURSALES.map(id => (
                        <button
                            key={id}
                            onClick={() => toggleSuc(id)}
                            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-all ${
                                selected.has(id)
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                        >
                            {ERP_NAMES[id]}
                        </button>
                    ))}
                </div>
                <p className="mt-3 text-[12px] text-slate-400 flex items-center gap-1">
                    <Info size={12} />
                    La cantidad a reponer se calcula como: Max − Stock actual (en packs comerciales).
                    El stock de Bodega se distribuye proporcionalmente por urgencia.
                </p>
            </div>

            {/* Actions row */}
            <div className="flex items-center justify-end gap-3">
                {error && (
                    <span className="text-[13px] text-red-600 flex items-center gap-1">
                        <AlertTriangle size={14} /> {error}
                    </span>
                )}
                <button
                    onClick={handleCalcular}
                    disabled={loading || selected.size === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                    {loading
                        ? <Loader2 size={16} className="animate-spin" />
                        : <RefreshCw size={16} />
                    }
                    Calcular preview
                </button>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-[14px]">Calculando necesidades de reposición…</span>
                </div>
            )}

            {/* Empty result */}
            {preview && preview.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
                    <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-semibold text-emerald-700 text-[15px]">Todas las sucursales están abastecidas</p>
                    <p className="text-emerald-600 text-[13px] mt-1">
                        No hay necesidad de reposición para las sucursales seleccionadas.
                    </p>
                </div>
            )}

            {/* Per-sucursal preview tables */}
            {grouped && Object.entries(grouped).map(([sucId, rows]) => {
                const suc = Number(sucId);
                const tot = totals[suc] || {};
                return (
                    <div key={suc} className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                            <div className="flex items-center gap-2">
                                <Building2 size={16} className="text-blue-500" />
                                <span className="font-semibold text-slate-700">{ERP_NAMES[suc]}</span>
                                <span className="text-[12px] text-slate-400">
                                    · {tot.productos} productos · {tot.packs} packs asignados
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {tot.sinStock > 0 && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                                        {tot.sinStock} sin stock en bodega
                                    </span>
                                )}
                                {tot.revision > 0 && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">
                                        {tot.revision} revisar min/max
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead>
                                    <tr className="text-[11px] text-slate-400 uppercase tracking-wide bg-slate-50/40">
                                        <th className="text-left px-4 py-2 font-medium">Producto</th>
                                        <th className="text-left px-3 py-2 font-medium">Presentación</th>
                                        <th className="text-center px-3 py-2 font-medium">Stock actual</th>
                                        <th className="text-center px-3 py-2 font-medium">Max</th>
                                        <th className="text-center px-3 py-2 font-medium">Necesidad</th>
                                        <th className="text-center px-3 py-2 font-medium">En Bodega</th>
                                        <th className="text-center px-3 py-2 font-medium">Asignar</th>
                                        <th className="text-center px-3 py-2 font-medium">Urgencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => {
                                        const adj = getAdjusted(row);
                                        const k   = getKey(row);
                                        return (
                                            <tr
                                                key={k}
                                                className={`border-t border-slate-50 hover:bg-blue-50/30 transition-colors ${row.sin_stock ? 'opacity-50' : ''}`}
                                            >
                                                <td className="px-4 py-2 font-medium text-slate-700 max-w-[200px]">
                                                    <span className="block truncate">{row.product_name}</span>
                                                </td>
                                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.presentacion_tipo}</td>
                                                <td className="px-3 py-2 text-center text-slate-600 tabular-nums">{row.stock_packs}</td>
                                                <td className="px-3 py-2 text-center text-slate-600 tabular-nums">{row.max_qty}</td>
                                                <td className="px-3 py-2 text-center font-semibold text-orange-600 tabular-nums">{row.cantidad_reponer}</td>
                                                <td className="px-3 py-2 text-center text-slate-500 tabular-nums">{row.bodega_stock_packs}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {row.sin_stock ? (
                                                        <span className="text-[11px] font-medium text-red-500">Sin stock</span>
                                                    ) : row.revision_minmax ? (
                                                        <span className="text-[11px] font-medium text-amber-500">Revisar</span>
                                                    ) : (
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={adj}
                                                            onChange={e => setAdjusted(row, parseInt(e.target.value) || 0)}
                                                            className="w-16 text-center border border-slate-200 rounded-lg px-1 py-0.5 text-[13px] focus:outline-none focus:border-blue-400 tabular-nums"
                                                        />
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <UrgenciaBar pct={row.urgencia_pct} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

            {/* Notes + Confirm */}
            {grouped && Object.keys(grouped).length > 0 && (
                <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] p-4 space-y-3">
                    <div>
                        <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                            Notas (opcional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Observaciones sobre este pedido…"
                            rows={2}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 bg-white/80 resize-none"
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <p className="text-[12px] text-slate-400 flex items-center gap-1">
                            <Package size={12} />
                            {preview?.length ?? 0} líneas de producto en total
                        </p>
                        <button
                            onClick={handleConfirmar}
                            disabled={confirming}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                            {confirming
                                ? <Loader2 size={16} className="animate-spin" />
                                : <ClipboardList size={16} />
                            }
                            Confirmar pedido
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
