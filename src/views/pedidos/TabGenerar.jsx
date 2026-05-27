import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, RefreshCw, Building2, ClipboardList, CheckCircle2,
    Package, AlertTriangle, Info, ChevronDown, ChevronRight, Clock,
    FlaskConical, ArrowLeft, TriangleAlert, TrendingUp, Search,
    ChevronLeft,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE  = 20;

// ── Small helpers ────────────────────────────────────────────────────────────

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
    return new Date(iso).toLocaleDateString('es-SV', { month: 'short', year: '2-digit' });
}

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

// ── Custom tooltip for stacked bar ──────────────────────────────────────────
function BarTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const con = payload.find(p => p.dataKey === 'con_bodega_packs')?.value ?? 0;
    const sin = payload.find(p => p.dataKey === 'sin_bodega_packs')?.value ?? 0;
    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-[12px]">
            <p className="font-semibold text-slate-700 mb-1">{label}</p>
            <p className="text-emerald-600">Con stock Bodega: <span className="font-bold">{con.toLocaleString()}</span> packs</p>
            <p className="text-red-500">Sin stock Bodega: <span className="font-bold">{sin.toLocaleString()}</span> packs</p>
            <p className="text-slate-500 mt-1 border-t border-slate-100 pt-1">Total: <span className="font-bold">{(con + sin).toLocaleString()}</span> packs</p>
        </div>
    );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function TabGenerar() {
    const { user } = useAuth();

    // Sucursal selection — default ALL deselected
    const [selected, setSelected] = useState(new Set());

    // Preview (distribution result)
    const [preview,       setPreview]       = useState(null);
    const [loading,       setLoading]       = useState(false);
    const [notes,         setNotes]         = useState('');
    const [confirming,    setConfirming]    = useState(false);
    const [confirmed,     setConfirmed]     = useState(null);
    const [adjustments,   setAdjustments]   = useState({});
    const [error,         setError]         = useState(null);
    const [syncedAt,      setSyncedAt]      = useState(null);
    const [revisionOpen,  setRevisionOpen]  = useState({});
    const [sinStockOpen,  setSinStockOpen]  = useState({});

    // Dashboard data
    const [dashStats,     setDashStats]     = useState([]);  // [{erp_sucursal_id, necesidad_packs, con_bodega_packs, sin_bodega_packs}]
    const [dashLoading,   setDashLoading]   = useState(true);

    // Sin-bodega table
    const [sinBodega,     setSinBodega]     = useState([]);
    const [sinBodegaTotal,setSinBodegaTotal]= useState(0);
    const [sinBodegaPage, setSinBodegaPage] = useState(0);
    const [sinBodegaLoad, setSinBodegaLoad] = useState(false);
    const [sinBodegaSearch, setSinBodegaSearch] = useState('');

    // ── Synced-at ──────────────────────────────────────────────
    useEffect(() => {
        supabase
            .from('erp_minmax').select('synced_at')
            .order('synced_at', { ascending: false }).limit(1).single()
            .then(({ data }) => setSyncedAt(data?.synced_at ?? null));
    }, []);

    // ── Dashboard stats (all sucursales by default) ────────────
    useEffect(() => {
        setDashLoading(true);
        Promise.all([
            supabase.rpc('get_pedido_sucursal_stats', { p_sucursal_ids: SUCURSALES }),
            supabase.rpc('get_pedido_sin_bodega_count', { p_sucursal_ids: SUCURSALES }),
        ]).then(([statsRes, countRes]) => {
            setDashStats(statsRes.data || []);
            setSinBodegaTotal(countRes.data ?? 0);
            setDashLoading(false);
        });
    }, []);

    // ── Sin-bodega page load ───────────────────────────────────
    useEffect(() => {
        setSinBodegaLoad(true);
        supabase
            .rpc('get_pedido_sin_bodega', {
                p_sucursal_ids: SUCURSALES,
                p_limit:        PAGE_SIZE,
                p_offset:       sinBodegaPage * PAGE_SIZE,
            })
            .then(({ data }) => {
                setSinBodega(data || []);
                setSinBodegaLoad(false);
            });
    }, [sinBodegaPage]);

    // ── Sucursal toggle ────────────────────────────────────────
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

    // ── Preview adjustments ────────────────────────────────────
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

    // ── Calcular preview ───────────────────────────────────────
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
            const initRevision = {};
            const initSinStock = {};
            for (const id of SUCURSALES) { initRevision[id] = true; initSinStock[id] = false; }
            setRevisionOpen(initRevision);
            setSinStockOpen(initSinStock);
            setPreview(rows);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [selected]);

    // ── Grouped preview ────────────────────────────────────────
    const grouped = useMemo(() => {
        if (!preview) return null;
        const map = {};
        for (const row of preview) {
            const s = row.erp_sucursal_id;
            if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [] };
            if (row.sin_stock)             map[s].sinStock.push(row);
            else if (row.revision_minmax)  map[s].revision.push(row);
            else                           map[s].normal.push(row);
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

    // ── Confirm ────────────────────────────────────────────────
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

    // ── Chart data ─────────────────────────────────────────────
    const chartData = useMemo(() => {
        const statMap = {};
        for (const s of dashStats) statMap[s.erp_sucursal_id] = s;
        return SUCURSALES.map(id => ({
            name:             ERP_NAMES[id],
            con_bodega_packs: statMap[id]?.con_bodega_packs ?? 0,
            sin_bodega_packs: statMap[id]?.sin_bodega_packs ?? 0,
            necesidad_packs:  statMap[id]?.necesidad_packs  ?? 0,
            total_productos:  statMap[id]?.total_productos   ?? 0,
        }));
    }, [dashStats]);

    // ── Stat map for sucursal cards ────────────────────────────
    const statMap = useMemo(() => {
        const m = {};
        for (const s of dashStats) m[s.erp_sucursal_id] = s;
        return m;
    }, [dashStats]);

    // ── Filtered sin-bodega (client-side search on current page) ─
    const filteredSinBodega = useMemo(() => {
        if (!sinBodegaSearch.trim()) return sinBodega;
        const q = sinBodegaSearch.toLowerCase();
        return sinBodega.filter(r =>
            r.product_name.toLowerCase().includes(q) ||
            r.laboratorio.toLowerCase().includes(q)
        );
    }, [sinBodega, sinBodegaSearch]);

    // ── Row renderer (preview table) ───────────────────────────
    const renderRow = (row, variant = 'normal') => {
        const adj = getAdjusted(row);
        const k   = getKey(row);
        const overStock = adj > Number(row.bodega_stock_packs) && Number(row.bodega_stock_packs) > 0;
        const isRevision = variant === 'revision';
        const isSinStock = variant === 'sinStock';
        return (
            <tr key={k} className={`border-t border-slate-50 transition-colors ${
                isSinStock ? 'bg-slate-50/40 opacity-60' :
                isRevision ? 'bg-amber-50/30 hover:bg-amber-50/60' :
                             'hover:bg-blue-50/30'
            }`}>
                <td className="px-4 py-2 font-medium text-slate-700 max-w-[240px]">
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
                            <span className="text-[10px] text-slate-400 tabular-nums">
                                ↻ {Number(row.ventas_6m).toLocaleString('es-SV')} u/6m
                            </span>
                        )}
                        {!isSinStock && <LotesPill lotes={row.lotes_bodega} qty={adj} />}
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
                                type="number" min={0} value={adj}
                                onChange={e => setAdjusted(row, parseInt(e.target.value) || 0)}
                                className={`w-16 text-center border rounded-lg px-1 py-0.5 text-[13px] focus:outline-none tabular-nums ${
                                    isRevision
                                        ? 'border-amber-300 bg-amber-50 focus:border-amber-500'
                                        : 'border-slate-200 focus:border-blue-400'
                                }`}
                            />
                            {overStock && <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" title="Supera el stock disponible en Bodega" />}
                        </div>
                    )}
                </td>
                <td className="px-3 py-2"><UrgenciaBar pct={row.urgencia_pct} /></td>
            </tr>
        );
    };

    // ── Confirmed screen ────────────────────────────────────────
    if (confirmed) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Pedido #{confirmed.numero} generado</h3>
                <p className="text-slate-500 text-[14px]">Puedes ver el estado en la pestaña Historial.</p>
                <button onClick={() => setConfirmed(null)}
                    className="mt-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                    Nuevo pedido
                </button>
            </div>
        );
    }

    // ── Preview screen ──────────────────────────────────────────
    if (preview) {
        return (
            <div className="space-y-4 p-4">
                {/* Back + header */}
                <div className="flex items-center justify-between">
                    <button onClick={() => { setPreview(null); setAdjustments({}); }}
                        className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors font-medium">
                        <ArrowLeft size={15} /> Volver al resumen
                    </button>
                    {error && (
                        <span className="text-[13px] text-red-600 flex items-center gap-1">
                            <AlertTriangle size={14} /> {error}
                        </span>
                    )}
                </div>

                {preview.length === 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
                        <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
                        <p className="font-semibold text-emerald-700 text-[15px]">Todas las sucursales están abastecidas</p>
                    </div>
                )}

                {sortedSucIds.map(suc => {
                    const { normal, revision, sinStock } = grouped[suc];
                    const totalPacks = [...normal, ...revision, ...sinStock].reduce((s, r) => s + getAdjusted(r), 0);
                    const isRevOpen  = revisionOpen[suc] ?? true;
                    const isSinOpen  = sinStockOpen[suc] ?? false;
                    return (
                        <div key={suc} className={`${GLASS} overflow-hidden`}>
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
                            {normal.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full">{TABLE_HEAD}<tbody>{normal.map(r => renderRow(r, 'normal'))}</tbody></table>
                                </div>
                            )}
                            {revision.length > 0 && (
                                <>
                                    <button onClick={() => toggleRevision(suc)}
                                        className="w-full flex items-center gap-2 px-4 py-2 bg-amber-50/60 border-t border-amber-100 hover:bg-amber-100/50 transition-colors text-left">
                                        {isRevOpen ? <ChevronDown size={14} className="text-amber-600 flex-shrink-0" /> : <ChevronRight size={14} className="text-amber-600 flex-shrink-0" />}
                                        <span className="text-[12px] font-medium text-amber-700">
                                            {revision.length} {revision.length === 1 ? 'producto' : 'productos'} con bodega disponible pero cantidad insuficiente para un multiplo completo
                                        </span>
                                    </button>
                                    {isRevOpen && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full">{TABLE_HEAD}<tbody>{revision.map(r => renderRow(r, 'revision'))}</tbody></table>
                                        </div>
                                    )}
                                </>
                            )}
                            {sinStock.length > 0 && (
                                <>
                                    <button onClick={() => toggleSinStock(suc)}
                                        className="w-full flex items-center gap-2 px-4 py-2 bg-slate-50/60 border-t border-slate-100 hover:bg-slate-100/50 transition-colors text-left">
                                        {isSinOpen ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                                        <span className="text-[12px] font-medium text-slate-500">
                                            {sinStock.length} {sinStock.length === 1 ? 'producto' : 'productos'} sin stock en Bodega
                                        </span>
                                    </button>
                                    {isSinOpen && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full">{TABLE_HEAD}<tbody>{sinStock.map(r => renderRow(r, 'sinStock'))}</tbody></table>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}

                {globalTotals && sortedSucIds.length > 0 && (
                    <div className={`${GLASS} p-4 space-y-3`}>
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
                        <div>
                            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Notas (opcional)</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                placeholder="Observaciones sobre este pedido…" rows={2}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 bg-white/80 resize-none" />
                        </div>
                        <div className="flex items-center justify-end">
                            <button onClick={handleConfirmar} disabled={confirming}
                                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                {confirming ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
                                Confirmar pedido
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Dashboard screen ────────────────────────────────────────
    return (
        <div className="space-y-5 p-4">

            {/* ── Sucursal selector ──────────────────────────── */}
            <div className={GLASS + ' p-4'}>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-slate-700 text-[15px]">Selecciona las sucursales a reponer</h3>
                    <div className="flex items-center gap-3">
                        {syncedAt && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                <Clock size={11} />
                                Min/Max: {fmtSyncedAt(syncedAt)}
                            </span>
                        )}
                        <button onClick={toggleAll}
                            className="text-[12px] text-blue-600 hover:text-blue-700 font-medium transition-colors">
                            {selected.size === SUCURSALES.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                        </button>
                    </div>
                </div>
                <p className="text-[11px] text-slate-400 mb-3 flex items-center gap-1">
                    <Info size={11} />
                    Por defecto ninguna está seleccionada. Elige las que quieres reponer y luego calcula el pedido.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {SUCURSALES.map(id => {
                        const stat     = statMap[id];
                        const isOn     = selected.has(id);
                        const needPct  = stat ? Math.round((stat.sin_bodega_packs / Math.max(stat.necesidad_packs, 1)) * 100) : null;
                        const urgColor = needPct == null ? '' : needPct >= 50 ? 'text-red-500' : needPct >= 25 ? 'text-amber-500' : 'text-emerald-500';
                        return (
                            <button key={id} onClick={() => toggleSuc(id)}
                                className={`relative flex flex-col items-center gap-1 rounded-xl px-3 py-3 border-2 transition-all duration-150 text-center group ${
                                    isOn
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200'
                                        : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:shadow-sm'
                                }`}>
                                <Building2 size={18} className={isOn ? 'text-blue-100' : 'text-slate-400 group-hover:text-blue-400'} />
                                <span className={`text-[12px] font-bold leading-tight ${isOn ? 'text-white' : 'text-slate-700'}`}>
                                    {ERP_NAMES[id]}
                                </span>
                                {stat && !dashLoading ? (
                                    <div className={`text-[10px] font-medium mt-0.5 ${isOn ? 'text-blue-100' : urgColor}`}>
                                        {stat.necesidad_packs.toLocaleString()} packs
                                    </div>
                                ) : (
                                    <div className="h-3 w-12 rounded bg-slate-100 animate-pulse mt-0.5" />
                                )}
                                {isOn && (
                                    <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center">
                                        <CheckCircle2 size={10} className="text-blue-600" />
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Calculate button */}
                <div className="mt-4 flex items-center gap-3">
                    <button onClick={handleCalcular}
                        disabled={loading || selected.size === 0}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition-all duration-150 ${
                            selected.size === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-200'
                        }`}>
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {loading ? 'Calculando…' : `Calcular pedido${selected.size > 0 ? ` (${selected.size} sucursal${selected.size > 1 ? 'es' : ''})` : ''}`}
                    </button>
                    {error && (
                        <span className="text-[13px] text-red-600 flex items-center gap-1">
                            <AlertTriangle size={14} /> {error}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Necesidad por sucursal chart ───────────────── */}
            <div className={GLASS + ' p-4'}>
                <h3 className="font-semibold text-slate-700 text-[14px] mb-1">Necesidad de reposición por sucursal</h3>
                <p className="text-[11px] text-slate-400 mb-4">
                    Packs necesarios en total vs los que tienen stock disponible en Bodega.
                </p>
                {dashLoading ? (
                    <div className="h-48 flex items-center justify-center">
                        <Loader2 size={20} className="animate-spin text-slate-300" />
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={chartData} barCategoryGap="30%" layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
                            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => v.toLocaleString()} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} width={72} />
                            <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(0,82,204,0.04)' }} />
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                                formatter={(value) => value === 'con_bodega_packs' ? 'Con stock en Bodega' : 'Sin stock en Bodega'} />
                            <Bar dataKey="con_bodega_packs" name="con_bodega_packs" stackId="a" fill="#10b981" radius={[0,0,0,0]} />
                            <Bar dataKey="sin_bodega_packs" name="sin_bodega_packs" stackId="a" fill="#f87171" radius={[0,4,4,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* ── Productos sin stock en Bodega ──────────────── */}
            <div className={GLASS + ' overflow-hidden'}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                    <div className="flex items-center gap-2">
                        <TriangleAlert size={15} className="text-red-500" />
                        <span className="font-semibold text-slate-700 text-[14px]">Productos sin stock en Bodega</span>
                        {sinBodegaTotal > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200 font-semibold">
                                {sinBodegaTotal.toLocaleString()} productos
                            </span>
                        )}
                    </div>
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={sinBodegaSearch}
                            onChange={e => setSinBodegaSearch(e.target.value)}
                            placeholder="Buscar producto…"
                            className="pl-7 pr-3 py-1.5 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white w-44"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-[11px] text-slate-400 uppercase tracking-wide bg-slate-50/40">
                                <th className="text-left px-4 py-2 font-medium">Producto</th>
                                <th className="text-left px-3 py-2 font-medium">Laboratorio</th>
                                <th className="text-left px-3 py-2 font-medium">Sucursales que solicitan</th>
                                <th className="text-center px-3 py-2 font-medium">Total packs</th>
                                <th className="text-center px-3 py-2 font-medium">Ventas 6m</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sinBodegaLoad ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="border-t border-slate-50">
                                        <td colSpan={5} className="px-4 py-3">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                                        </td>
                                    </tr>
                                ))
                            ) : filteredSinBodega.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-[13px]">
                                        No se encontraron productos
                                    </td>
                                </tr>
                            ) : filteredSinBodega.map(row => (
                                <tr key={row.erp_product_id} className="border-t border-slate-50 hover:bg-red-50/20 transition-colors">
                                    <td className="px-4 py-2.5 max-w-[220px]">
                                        <span className="block truncate text-[13px] font-medium text-slate-700">{row.product_name}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">{row.laboratorio}</td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex flex-wrap gap-1">
                                            {(row.sucursales || []).map(s => (
                                                <span key={s.erp_sucursal_id}
                                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 whitespace-nowrap">
                                                    <span className="font-medium text-slate-600">{ERP_NAMES[s.erp_sucursal_id]}</span>
                                                    <span className="text-red-500 font-semibold">{s.reponer}p</span>
                                                    {s.ventas_6m > 0 && (
                                                        <span className="text-slate-400">↻{Math.round(s.ventas_6m)}</span>
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        <span className="text-[13px] font-bold text-red-600 tabular-nums">{row.total_necesidad}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        {row.total_ventas_6m > 0 ? (
                                            <span className="flex items-center justify-center gap-1 text-[12px] text-emerald-600 font-medium tabular-nums">
                                                <TrendingUp size={11} />
                                                {Math.round(row.total_ventas_6m).toLocaleString()}
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-slate-300">—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {sinBodegaTotal > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/40">
                        <span className="text-[12px] text-slate-500">
                            {sinBodegaPage * PAGE_SIZE + 1}–{Math.min((sinBodegaPage + 1) * PAGE_SIZE, sinBodegaTotal)} de {sinBodegaTotal.toLocaleString()} productos
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setSinBodegaPage(p => Math.max(0, p - 1))}
                                disabled={sinBodegaPage === 0}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-[12px] text-slate-600 px-2 font-medium">
                                {sinBodegaPage + 1} / {Math.ceil(sinBodegaTotal / PAGE_SIZE)}
                            </span>
                            <button
                                onClick={() => setSinBodegaPage(p => p + 1)}
                                disabled={(sinBodegaPage + 1) * PAGE_SIZE >= sinBodegaTotal}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-blue-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
