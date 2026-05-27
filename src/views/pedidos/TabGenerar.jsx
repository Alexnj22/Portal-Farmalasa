import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, RefreshCw, Building2, ClipboardList, CheckCircle2,
    Package, AlertTriangle, Info, ChevronDown, ChevronRight, Clock,
    FlaskConical,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES = [5, 1, 2, 3, 4, 7];

function UrgenciaBar({ pct }) {
    const color = pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#10b981';
    return (
        <div className="flex items-center gap-1.5 justify-center">
            <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
            </div>
            <span className="text-[11px] text-slate-400">{pct}%</span>
        </div>
    );
}

function RulesTag({ row }) {
    if (!row.tiene_regla_despacho) return null;
    const parts = [];
    if (row.regla_multiplo > 1) parts.push(`×${row.regla_multiplo}`);
    if (row.regla_blister  > 1) parts.push(`blister×${row.regla_blister}`);
    if (row.regla_solo_cajas)   parts.push('solo cajas');
    if (parts.length === 0) return null;
    return (
        <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200 font-medium whitespace-nowrap">
            {parts.join(' ')}
        </span>
    );
}

function fmtSyncedAt(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

function fmtMesAnio(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('es-SV', { month: 'short', year: '2-digit' });
}

// Allocates packs from FEFO-ordered lotes up to `qty` and renders compact pills.
function LotesPill({ lotes, qty }) {
    if (!lotes || lotes.length === 0 || qty <= 0) return null;
    const today = new Date();
    let remaining = qty;
    const usados = [];
    for (const lot of lotes) {
        if (remaining <= 0) break;
        const take = Math.min(Number(lot.packs), remaining);
        if (take > 0) { usados.push({ ...lot, take }); remaining -= take; }
    }
    if (usados.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {usados.map((lot, i) => {
                const fv       = lot.fecha_vencimiento ? new Date(lot.fecha_vencimiento) : null;
                const daysLeft = fv ? Math.floor((fv - today) / 86_400_000) : null;
                const expCls   = daysLeft === null ? 'text-slate-400'
                    : daysLeft < 30  ? 'text-red-500 font-semibold'
                    : daysLeft < 90  ? 'text-amber-500'
                    : 'text-emerald-600';
                return (
                    <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                        <span className="text-slate-500 font-medium">{lot.lote || '—'}</span>
                        {fv && <span className={expCls}>{fmtMesAnio(lot.fecha_vencimiento)}</span>}
                        <span className="text-blue-600 font-semibold">{lot.take}p</span>
                    </span>
                );
            })}
            {remaining > 0 && (
                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 border border-red-200 text-red-500 font-medium">
                    {remaining}p sin lote disponible
                </span>
            )}
        </div>
    );
}

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const TABLE_HEAD = (
    <thead>
        <tr className="text-[11px] text-slate-400 uppercase tracking-wide bg-slate-50/40">
            <th className="text-left px-4 py-2 font-medium">Producto</th>
            <th className="text-left px-3 py-2 font-medium">Presentación</th>
            <th className="text-center px-3 py-2 font-medium">Stock</th>
            <th className="text-center px-3 py-2 font-medium">Max</th>
            <th className="text-center px-3 py-2 font-medium">Necesidad</th>
            <th className="text-center px-3 py-2 font-medium">En Bodega</th>
            <th className="text-center px-3 py-2 font-medium">Asignar</th>
            <th className="text-center px-3 py-2 font-medium">Urgencia</th>
        </tr>
    </thead>
);

export default function TabGenerar() {
    const { user } = useAuth();
    const [selected, setSelected]           = useState(new Set(SUCURSALES));
    const [preview, setPreview]             = useState(null);
    const [loading, setLoading]             = useState(false);
    const [notes, setNotes]                 = useState('');
    const [confirming, setConfirming]       = useState(false);
    const [confirmed, setConfirmed]         = useState(null);
    const [adjustments, setAdjustments]     = useState({});
    const [error, setError]                 = useState(null);
    const [syncedAt, setSyncedAt]           = useState(null);
    const [revisionOpen, setRevisionOpen]   = useState({});
    const [sinStockOpen, setSinStockOpen]   = useState({});

    useEffect(() => {
        supabase
            .from('erp_minmax')
            .select('synced_at')
            .order('synced_at', { ascending: false })
            .limit(1)
            .single()
            .then(({ data }) => setSyncedAt(data?.synced_at ?? null));
    }, []);

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

    const getKey      = (row) => `${row.erp_sucursal_id}_${row.erp_product_id}_${row.erp_presentacion_id}`;
    const getAdjusted = useCallback((row) => {
        const k = getKey(row);
        return adjustments[k] !== undefined ? adjustments[k] : row.cantidad_asignada;
    }, [adjustments]);

    const setAdjusted = useCallback((row, val) => {
        setAdjustments(prev => ({ ...prev, [getKey(row)]: Math.max(0, val) }));
    }, []);

    const toggleRevision = useCallback((sucId) => {
        setRevisionOpen(prev => ({ ...prev, [sucId]: !(prev[sucId] ?? true) }));
    }, []);

    const toggleSinStock = useCallback((sucId) => {
        setSinStockOpen(prev => ({ ...prev, [sucId]: !(prev[sucId] ?? false) }));
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
            const rows = data || [];
            // Open revision sections by default, close sinStock sections
            const initRevision = {};
            const initSinStock = {};
            for (const id of SUCURSALES) {
                initRevision[id] = true;
                initSinStock[id] = false;
            }
            setRevisionOpen(initRevision);
            setSinStockOpen(initSinStock);
            setPreview(rows);
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
            if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [] };
            if (row.sin_stock)        map[s].sinStock.push(row);
            else if (row.revision_minmax) map[s].revision.push(row);
            else                      map[s].normal.push(row);
        }
        return map;
    }, [preview]);

    const sortedSucIds = useMemo(
        () => grouped ? SUCURSALES.filter(id => grouped[id]) : [],
        [grouped],
    );

    const globalTotals = useMemo(() => {
        if (!grouped) return null;
        let sucursales = 0, productos = 0, packs = 0;
        for (const id of sortedSucIds) {
            sucursales++;
            const all = [...grouped[id].normal, ...grouped[id].revision, ...grouped[id].sinStock];
            productos += all.length;
            packs     += all.reduce((s, r) => s + getAdjusted(r), 0);
        }
        return { sucursales, productos, packs };
    }, [grouped, sortedSucIds, adjustments]);

    const handleConfirmar = useCallback(async () => {
        if (!preview || preview.length === 0) return;
        setConfirming(true);
        setError(null);
        try {
            const items = preview.map(row => ({
                erp_sucursal_id:       row.erp_sucursal_id,
                erp_product_id:        row.erp_product_id,
                erp_presentacion_id:   row.erp_presentacion_id,
                cantidad_asignada:     getAdjusted(row),
                sin_stock:             row.sin_stock,
                revision_minmax:       row.revision_minmax,
                stock_packs_snapshot:  Number(row.stock_packs),
                max_qty_snapshot:      row.max_qty,
                min_qty_snapshot:      row.min_qty,
                urgencia_pct_snapshot: row.urgencia_pct,
            }));

            const { data: pedidoId, error: rpcErr } = await supabase.rpc('confirm_pedido', {
                p_created_by: user?.id ?? null,
                p_notes:      notes || null,
                p_items:      items,
            });
            if (rpcErr) throw rpcErr;

            const { data: ped } = await supabase
                .from('pedidos').select('numero').eq('id', pedidoId).single();

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
    }, [preview, notes, selected, getAdjusted, user]);

    const renderRow = (row, variant = 'normal') => {
        const adj = getAdjusted(row);
        const k   = getKey(row);
        const overStock = adj > Number(row.bodega_stock_packs) && Number(row.bodega_stock_packs) > 0;
        const isRevision = variant === 'revision';
        const isSinStock = variant === 'sinStock';

        return (
            <tr
                key={k}
                className={`border-t border-slate-50 transition-colors ${
                    isSinStock  ? 'bg-slate-50/40 opacity-60' :
                    isRevision  ? 'bg-amber-50/30 hover:bg-amber-50/60' :
                                  'hover:bg-blue-50/30'
                }`}
            >
                <td className="px-4 py-2 font-medium text-slate-700 max-w-[240px]">
                    <div className="flex items-start gap-1.5 min-w-0">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="block truncate text-[13px]">{row.product_name}</span>
                                {row.es_antibiotico && (
                                    <span title="Antibiótico" className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 border border-violet-200">
                                        <FlaskConical size={9} className="text-violet-600" />
                                    </span>
                                )}
                                <RulesTag row={row} />
                            </div>
                            {row.ventas_6m > 0 && (
                                <span className="text-[10px] text-slate-400 mt-0.5 block tabular-nums">
                                    ↻ {Number(row.ventas_6m).toLocaleString('es-SV')} u/6m
                                </span>
                            )}
                            {!isSinStock && (
                                <LotesPill lotes={row.lotes_bodega} qty={adj} />
                            )}
                        </div>
                    </div>
                </td>
                <td className="px-3 py-2 text-slate-500 text-[13px] whitespace-nowrap">{row.presentacion_tipo}</td>
                <td className="px-3 py-2 text-center text-slate-600 tabular-nums text-[13px]">{row.stock_packs}</td>
                <td className="px-3 py-2 text-center text-slate-600 tabular-nums text-[13px]">{row.max_qty}</td>
                <td className="px-3 py-2 text-center font-semibold text-orange-600 tabular-nums text-[13px]">{row.cantidad_reponer}</td>
                <td className="px-3 py-2 text-center text-slate-500 tabular-nums text-[13px]">{row.bodega_stock_packs}</td>
                <td className="px-3 py-2 text-center">
                    {isSinStock ? (
                        <span className="text-[11px] font-medium text-slate-400">Sin stock</span>
                    ) : (
                        <div className="flex items-center justify-center gap-1">
                            <input
                                type="number"
                                min={0}
                                value={adj}
                                onChange={e => setAdjusted(row, parseInt(e.target.value) || 0)}
                                className={`w-16 text-center border rounded-lg px-1 py-0.5 text-[13px] focus:outline-none tabular-nums ${
                                    isRevision
                                        ? 'border-amber-300 bg-amber-50 focus:border-amber-500'
                                        : 'border-slate-200 focus:border-blue-400'
                                }`}
                            />
                            {overStock && (
                                <AlertTriangle
                                    size={12}
                                    className="text-amber-500 flex-shrink-0"
                                    title="Supera el stock disponible en Bodega"
                                />
                            )}
                        </div>
                    )}
                </td>
                <td className="px-3 py-2">
                    <UrgenciaBar pct={row.urgencia_pct} />
                </td>
            </tr>
        );
    };

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
            <div className={`${GLASS} p-4`}>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-700 text-[15px]">Sucursales a reponer</h3>
                    <div className="flex items-center gap-3">
                        {syncedAt && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                <Clock size={11} />
                                Min/Max sincronizado: {fmtSyncedAt(syncedAt)}
                            </span>
                        )}
                        <button
                            onClick={toggleAll}
                            className="text-[12px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
                        >
                            {selected.size === SUCURSALES.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                        </button>
                    </div>
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
                    Necesidad = Max − Stock actual en packs. El stock de Bodega se distribuye ponderado por urgencia y rotación de ventas de los últimos 6 meses (↻ u/6m). Las reglas de despacho (múltiplos, blíster) redondean hacia abajo.
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

            {loading && (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-[14px]">Calculando necesidades de reposición…</span>
                </div>
            )}

            {preview && preview.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
                    <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-semibold text-emerald-700 text-[15px]">Todas las sucursales están abastecidas</p>
                    <p className="text-emerald-600 text-[13px] mt-1">
                        No hay necesidad de reposición para las sucursales seleccionadas.
                    </p>
                </div>
            )}

            {/* Per-sucursal preview */}
            {sortedSucIds.map(suc => {
                const { normal, revision, sinStock } = grouped[suc];
                const totalPacks = [...normal, ...revision, ...sinStock].reduce((s, r) => s + getAdjusted(r), 0);
                const isRevOpen  = revisionOpen[suc] ?? true;
                const isSinOpen  = sinStockOpen[suc] ?? false;

                return (
                    <div key={suc} className={`${GLASS} overflow-hidden`}>
                        {/* Sucursal header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                            <div className="flex items-center gap-2">
                                <Building2 size={16} className="text-blue-500" />
                                <span className="font-semibold text-slate-700">{ERP_NAMES[suc]}</span>
                                <span className="text-[12px] text-slate-400">
                                    · {normal.length + revision.length + sinStock.length} productos · {totalPacks} packs asignados
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {revision.length > 0 && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                        {revision.length} a revisar
                                    </span>
                                )}
                                {sinStock.length > 0 && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                                        {sinStock.length} sin stock
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Normal rows */}
                        {normal.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    {TABLE_HEAD}
                                    <tbody>
                                        {normal.map(row => renderRow(row, 'normal'))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Revision section */}
                        {revision.length > 0 && (
                            <>
                                <button
                                    onClick={() => toggleRevision(suc)}
                                    className="w-full flex items-center gap-2 px-4 py-2 bg-amber-50/60 border-t border-amber-100 hover:bg-amber-100/50 transition-colors text-left"
                                >
                                    {isRevOpen
                                        ? <ChevronDown size={14} className="text-amber-600 flex-shrink-0" />
                                        : <ChevronRight size={14} className="text-amber-600 flex-shrink-0" />
                                    }
                                    <span className="text-[12px] font-medium text-amber-700">
                                        {revision.length} {revision.length === 1 ? 'producto' : 'productos'} con bodega disponible pero cantidad insuficiente para un multiplo completo — puedes ajustar manualmente
                                    </span>
                                </button>
                                {isRevOpen && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            {TABLE_HEAD}
                                            <tbody>
                                                {revision.map(row => renderRow(row, 'revision'))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Sin stock section */}
                        {sinStock.length > 0 && (
                            <>
                                <button
                                    onClick={() => toggleSinStock(suc)}
                                    className="w-full flex items-center gap-2 px-4 py-2 bg-slate-50/60 border-t border-slate-100 hover:bg-slate-100/50 transition-colors text-left"
                                >
                                    {isSinOpen
                                        ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                                        : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                                    }
                                    <span className="text-[12px] font-medium text-slate-500">
                                        {sinStock.length} {sinStock.length === 1 ? 'producto' : 'productos'} sin stock en Bodega (se registran en el pedido como referencia)
                                    </span>
                                </button>
                                {isSinOpen && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            {TABLE_HEAD}
                                            <tbody>
                                                {sinStock.map(row => renderRow(row, 'sinStock'))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })}

            {/* Global summary + Notes + Confirm */}
            {globalTotals && sortedSucIds.length > 0 && (
                <div className={`${GLASS} p-4 space-y-3`}>
                    {/* Summary bar */}
                    <div className="flex items-center gap-4 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
                        <Package size={16} className="text-blue-500 flex-shrink-0" />
                        <div className="flex items-center gap-5 text-[13px] font-medium text-blue-700 flex-1">
                            <span>{globalTotals.sucursales} sucursal{globalTotals.sucursales !== 1 ? 'es' : ''}</span>
                            <span className="text-blue-300">·</span>
                            <span>{globalTotals.productos} productos</span>
                            <span className="text-blue-300">·</span>
                            <span className="font-bold">{globalTotals.packs} packs en total</span>
                        </div>
                    </div>

                    {/* Notes */}
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
                        {error && (
                            <span className="text-[13px] text-red-600 flex items-center gap-1">
                                <AlertTriangle size={14} /> {error}
                            </span>
                        )}
                        <div className="ml-auto">
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
                </div>
            )}
        </div>
    );
}
