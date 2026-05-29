import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, RefreshCw, Building2, ClipboardList, CheckCircle2,
    Package, AlertTriangle, Info, ChevronDown, ChevronRight, Clock,
    FlaskConical, ArrowLeft, TriangleAlert, TrendingUp,
    ChevronLeft, Minus, Plus, Printer, RefreshCcw, Save,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { printFromPreview, fefoProject } from '../../utils/pedidoPrint';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const SUCURSALES   = [5, 1, 2, 3, 4, 7];
const PAGE_PREV    = 30;   // preview per-sucursal page size

// ── Helpers ──────────────────────────────────────────────────────────────────

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
                        <span className="text-blue-600 font-semibold">{lot.take}pk</span>
                    </span>
                );
            })}
            {remaining > 0 && (
                <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 border border-red-200 text-red-500 font-medium">
                    {remaining}pk sin lote
                </span>
            )}
        </div>
    );
}


const SIN_BODEGA_COLS = [
    { key: 'product_name',    label: 'Producto',    align: 'left',  sortable: true },
    { key: 'laboratorio',     label: 'Laboratorio', align: 'left',  sortable: true },
    { key: 'sucursales',      label: 'Solicitan',   align: 'left'                  },
    { key: 'total_necesidad', label: 'Total',       align: 'center', sortable: true, hideBelow: 'sm' },
    { key: 'total_ventas_6m', label: 'Ventas 6m',  align: 'center', sortable: true, hideBelow: 'sm' },
];

// Paginación pequeña reutilizable (preview por sucursal)
function MiniPager({ page, total, pageSize, onChange }) {
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50/30">
            <span className="text-[11px] text-slate-400">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total}
            </span>
            <div className="flex items-center gap-1">
                <button onClick={() => onChange(Math.max(0, page - 1))} disabled={page === 0}
                    className="p-1 rounded border border-slate-200 text-slate-500 hover:border-blue-300 disabled:opacity-30 transition-colors">
                    <ChevronLeft size={13} />
                </button>
                <span className="text-[11px] px-2 text-slate-600">{page + 1}/{totalPages}</span>
                <button onClick={() => onChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                    className="p-1 rounded border border-slate-200 text-slate-500 hover:border-blue-300 disabled:opacity-30 transition-colors">
                    <ChevronRight size={13} />
                </button>
            </div>
        </div>
    );
}

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const SUC_ANIM_CSS = `
@keyframes suc-pop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.09); }
  70%  { transform: scale(0.96); }
  100% { transform: scale(1); }
}
.suc-pop { animation: suc-pop 0.28s cubic-bezier(0.22,1,0.36,1) both; }
`;

const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500';
const TABLE_HEAD = (
    <thead>
        <tr className="bg-[#0052CC]/[0.04] border-b border-[#0052CC]/[0.09]">
            <th className={`${TH} text-left`}>Producto</th>
            <th className={`${TH} text-left px-3`}>Presentación</th>
            <th className={`${TH} text-center px-3`}>Stock</th>
            <th className={`${TH} text-center px-3`}>Max</th>
            <th className={`${TH} text-center px-3`}>Necesidad</th>
            <th className={`${TH} text-center px-3`}>En Bodega</th>
            <th className={`${TH} text-center px-3`}>Asignar</th>
            <th className={`${TH} text-center px-3`}>Urgencia</th>
        </tr>
    </thead>
);

// ── Main component ───────────────────────────────────────────────────────────
export default function TabGenerar({ searchTerm = '' }) {
    const { user } = useAuth();

    // Sucursal selection — default ALL deselected
    const [selected, setSelected] = useState(new Set());

    // Preview
    const [preview,      setPreview]      = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [notes,        setNotes]        = useState('');
    const [confirming,   setConfirming]   = useState(false);
    const [confirmed,    setConfirmed]    = useState(null);
    const [adjustments,  setAdjustments]  = useState({});
    const [error,        setError]        = useState(null);
    const [syncedAt,     setSyncedAt]     = useState(null);
    const [savingSnap,   setSavingSnap]   = useState(false);

    // Preview per-sucursal collapse + pagination
    const [sucCollapsed, setSucCollapsed] = useState({});
    const [sucPage,      setSucPage]      = useState({});
    // Revision / sinStock collapsible
    const [revisionOpen, setRevisionOpen] = useState({});
    const [sinStockOpen, setSinStockOpen] = useState({});

    // Dashboard
    const [dashStats,    setDashStats]    = useState([]);
    const [dashLoading,  setDashLoading]  = useState(true);

    // Sin-bodega table — all data loaded once, sorted+paginated client-side
    const [sinBodega,    setSinBodega]    = useState([]);
    const [sinBodegaLoad, setSinBodegaLoad] = useState(false);
    const [sinSortKey,   setSinSortKey]   = useState('total_necesidad');
    const [sinSortDir,   setSinSortDir]   = useState('desc');
    const [sinPage,      setSinPage]      = useState(1);
    const [sinPageSize,  setSinPageSize]  = useState(25);

    // ── Synced-at ──────────────────────────────────────────────
    useEffect(() => {
        supabase.from('erp_minmax').select('synced_at')
            .order('synced_at', { ascending: false }).limit(1).single()
            .then(({ data }) => setSyncedAt(data?.synced_at ?? null));
    }, []);

    // ── Dashboard stats ────────────────────────────────────────
    useEffect(() => {
        setDashLoading(true);
        supabase.rpc('get_pedido_sucursal_stats', { p_sucursal_ids: SUCURSALES })
            .then(({ data }) => { setDashStats(data || []); setDashLoading(false); });
    }, []);

    // ── Sin-bodega — load all once for client-side sort/filter ─
    useEffect(() => {
        setSinBodegaLoad(true);
        supabase.rpc('get_pedido_sin_bodega', {
            p_sucursal_ids: SUCURSALES,
            p_limit:        9999,
            p_offset:       0,
        }).then(({ data }) => { setSinBodega(data || []); setSinBodegaLoad(false); });
    }, []);

    // ── Sucursal toggle ────────────────────────────────────────
    const toggleSuc = useCallback((id) => {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
        setPreview(null); setAdjustments({});
    }, []);

    const toggleAll = useCallback(() => {
        setSelected(prev => prev.size === SUCURSALES.length ? new Set() : new Set(SUCURSALES));
        setPreview(null); setAdjustments({});
    }, []);

    // ── Adjustments ────────────────────────────────────────────
    const getKey      = (row) => `${row.erp_sucursal_id}_${row.erp_product_id}_${row.erp_presentacion_id}`;
    const getAdjusted = useCallback((row) => {
        const k = getKey(row);
        return adjustments[k] !== undefined ? adjustments[k] : row.cantidad_asignada;
    }, [adjustments]);
    const setAdjusted = useCallback((row, val) => {
        setAdjustments(prev => ({ ...prev, [getKey(row)]: Math.max(0, val) }));
    }, []);

    // ── Preview section toggles ────────────────────────────────
    const toggleSucCollapse = useCallback((sucId) => {
        setSucCollapsed(prev => ({ ...prev, [sucId]: !prev[sucId] }));
    }, []);
    const toggleRevision = useCallback((sucId) => {
        setRevisionOpen(prev => ({ ...prev, [sucId]: !(prev[sucId] ?? true) }));
    }, []);
    const toggleSinStock = useCallback((sucId) => {
        setSinStockOpen(prev => ({ ...prev, [sucId]: !(prev[sucId] ?? false) }));
    }, []);

    // ── Calculate ──────────────────────────────────────────────
    const handleCalcular = useCallback(async () => {
        if (selected.size === 0) return;
        setLoading(true); setPreview(null); setAdjustments({}); setError(null);
        setSucCollapsed({}); setSucPage({});
        try {
            // range(0, 49999) avoids the PostgREST 1000-row default cap
            const { data, error: rpcErr } = await supabase
                .rpc('get_pedido_preview', { p_sucursal_ids: [...selected] })
                .range(0, 49999);
            if (rpcErr) throw rpcErr;
            const rows = data || [];
            const initRev = {}, initSin = {};
            for (const id of SUCURSALES) { initRev[id] = true; initSin[id] = false; }
            setRevisionOpen(initRev); setSinStockOpen(initSin);
            setPreview(rows);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [selected]);

    // ── Guardar borrador ───────────────────────────────────────
    const handleGuardarBorrador = useCallback(async () => {
        const nombre = `Borrador ${new Date().toLocaleDateString('es-SV')} — ${[...selected].map(id => ERP_NAMES[id]).join(', ')}`;
        setSavingSnap(true);
        try {
            await supabase.rpc('save_pedido_snapshot', { p_sucursal_ids: [...selected], p_nombre: nombre });
        } finally {
            setSavingSnap(false);
        }
    }, [selected]);

    // ── Grouped preview ────────────────────────────────────────
    const grouped = useMemo(() => {
        if (!preview) return null;
        const q = searchTerm.toLowerCase();
        const map = {};
        for (const row of preview) {
            if (q && !row.product_name.toLowerCase().includes(q)) continue;
            const s = row.erp_sucursal_id;
            if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [] };
            if (row.sin_stock)            map[s].sinStock.push(row);
            else if (row.revision_minmax) map[s].revision.push(row);
            else                          map[s].normal.push(row);
        }
        return map;
    }, [preview, searchTerm]);

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
        setConfirming(true); setError(null);
        try {
            const items = preview.map(row => {
                const adj = getAdjusted(row);
                return {
                    erp_sucursal_id:       row.erp_sucursal_id,
                    erp_product_id:        row.erp_product_id,
                    erp_presentacion_id:   row.erp_presentacion_id,
                    cantidad_asignada:     adj,
                    sin_stock:             row.sin_stock,
                    revision_minmax:       row.revision_minmax,
                    stock_packs_snapshot:  Number(row.stock_packs),
                    max_qty_snapshot:      row.max_qty,
                    min_qty_snapshot:      row.min_qty,
                    urgencia_pct_snapshot: row.urgencia_pct,
                    lotes_asignados:       fefoProject(row.lotes_bodega, adj),
                };
            });
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
            setPreview(null); setNotes(''); setAdjustments({});
        } catch (e) {
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    }, [preview, notes, selected, getAdjusted, user]);

    const statMap = useMemo(() => {
        const m = {};
        for (const s of dashStats) m[s.erp_sucursal_id] = s;
        return m;
    }, [dashStats]);

    // Rank sucursales 0–5 by total_productos desc (0 = most products = most urgent)
    const urgRank = useMemo(() => {
        const sorted = [...SUCURSALES].sort(
            (a, b) => (statMap[b]?.total_productos ?? 0) - (statMap[a]?.total_productos ?? 0)
        );
        const r = {};
        sorted.forEach((id, i) => { r[id] = i; });
        return r;
    }, [statMap]);

    // ── Sin-bodega — client-side filter + sort + paginate ─────
    const sinFiltered = useMemo(() => {
        let rows = sinBodega;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter(r =>
                r.product_name?.toLowerCase().includes(q) ||
                r.laboratorio?.toLowerCase().includes(q)
            );
        }
        const dir = sinSortDir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            if (sinSortKey === 'product_name' || sinSortKey === 'laboratorio') {
                return (a[sinSortKey] || '').localeCompare(b[sinSortKey] || '', 'es') * dir;
            }
            return (Number(a[sinSortKey] || 0) - Number(b[sinSortKey] || 0)) * dir;
        });
    }, [sinBodega, searchTerm, sinSortKey, sinSortDir]);

    const sinTotalPages    = Math.max(1, Math.ceil(sinFiltered.length / sinPageSize));
    const filteredSinBodega = sinFiltered.slice((sinPage - 1) * sinPageSize, sinPage * sinPageSize);

    useEffect(() => { setSinPage(1); }, [searchTerm, sinSortKey, sinSortDir]);

    const handleSinSort = useCallback((key) => {
        setSinSortKey(prev => {
            if (prev === key) { setSinSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSinSortDir('asc'); return key;
        });
        setSinPage(1);
    }, []);

    // ── Row renderer ───────────────────────────────────────────
    const renderRow = useCallback((row, variant = 'normal') => {
        const adj        = getAdjusted(row);
        const k          = getKey(row);
        const isSinStock = variant === 'sinStock';
        const isRevision = variant === 'revision';
        const isFullyCovered = row.cantidad_asignada >= row.cantidad_reponer && row.cantidad_asignada > 0;
        const hasAdjusted    = adjustments[k] !== undefined;
        // Show editable input when: sin_stock=false AND (not fully covered OR user has already adjusted)
        const showInput  = !isSinStock && (!isFullyCovered || hasAdjusted);
        const overStock  = adj > Number(row.bodega_stock_packs) && Number(row.bodega_stock_packs) > 0;

        return (
            <tr key={k} className={`border-t border-[#0052CC]/[0.06] transition-colors ${
                isSinStock ? 'bg-slate-50/40 opacity-55' :
                isRevision ? 'bg-amber-50/30 hover:bg-amber-50/60' :
                             'hover:bg-[#0052CC]/[0.032]'
            }`}>
                <td className="px-4 py-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] font-medium text-slate-700">{row.product_name}</span>
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
                    ) : showInput ? (
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
                            {overStock && <AlertTriangle size={12} className="text-amber-500" title="Supera el stock en Bodega" />}
                        </div>
                    ) : (
                        // Fully covered — read-only with checkmark, click to enable edit
                        <button
                            onClick={() => setAdjusted(row, adj)}
                            title="Clic para ajustar manualmente"
                            className="flex items-center justify-center gap-1 mx-auto group">
                            <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                            <span className="text-[13px] font-semibold text-emerald-600 tabular-nums">{adj}</span>
                        </button>
                    )}
                </td>
                <td className="px-3 py-2"><UrgenciaBar pct={row.urgencia_pct} /></td>
            </tr>
        );
    }, [adjustments, getAdjusted, setAdjusted]);

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
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <button onClick={() => { setPreview(null); setAdjustments({}); }}
                        className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors font-medium">
                        <ArrowLeft size={15} /> Volver al resumen
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                        {searchTerm && (
                            <span className="text-[12px] text-slate-500">
                                Filtrando: <b>"{searchTerm}"</b>
                            </span>
                        )}
                        {error && (
                            <span className="text-[13px] text-red-600 flex items-center gap-1">
                                <AlertTriangle size={14} /> {error}
                            </span>
                        )}
                        <button
                            onClick={handleCalcular}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                            Recalcular
                        </button>
                        <button
                            onClick={handleGuardarBorrador}
                            disabled={savingSnap}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                            {savingSnap ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            Guardar borrador
                        </button>
                        <button
                            onClick={() => printFromPreview(grouped, sortedSucIds, getAdjusted,
                                `Pedido ${new Date().toLocaleDateString('es-SV')} — ${[...selected].map(id => ERP_NAMES[id]).join(', ')}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-slate-800 text-white hover:bg-slate-700 transition-colors"
                        >
                            <Printer size={13} /> Imprimir
                        </button>
                    </div>
                </div>

                {preview.length === 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
                        <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
                        <p className="font-semibold text-emerald-700 text-[15px]">Todas las sucursales están abastecidas</p>
                    </div>
                )}

                {sortedSucIds.map(suc => {
                    const { normal, revision, sinStock } = grouped[suc];
                    const totalPacks  = [...normal, ...revision, ...sinStock].reduce((s, r) => s + getAdjusted(r), 0);
                    const isCollapsed = sucCollapsed[suc] ?? false;
                    const isRevOpen   = revisionOpen[suc] ?? true;
                    const isSinOpen   = sinStockOpen[suc] ?? false;
                    const pg          = sucPage[suc] ?? 0;
                    const pageNormal  = normal.slice(pg * PAGE_PREV, (pg + 1) * PAGE_PREV);

                    return (
                        <div key={suc} className={`${GLASS} overflow-hidden`}>
                            {/* Header — always visible */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                                <button
                                    onClick={() => toggleSucCollapse(suc)}
                                    className="flex items-center gap-2 min-w-0 text-left hover:opacity-70 transition-opacity">
                                    {isCollapsed
                                        ? <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />
                                        : <ChevronDown  size={15} className="text-slate-400 flex-shrink-0" />}
                                    <Building2 size={15} className="text-blue-500 flex-shrink-0" />
                                    <span className="font-semibold text-slate-700">{ERP_NAMES[suc]}</span>
                                    <span className="text-[12px] text-slate-400 whitespace-nowrap">
                                        · {normal.length + revision.length + sinStock.length} productos · {totalPacks} asignados
                                    </span>
                                </button>
                                <div className="flex items-center gap-2 flex-shrink-0">
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

                            {!isCollapsed && (
                                <>
                                    {/* Normal rows */}
                                    {normal.length > 0 && (
                                        <>
                                            <div className="overflow-x-auto">
                                                <table className="w-full">
                                                    {TABLE_HEAD}
                                                    <tbody>{pageNormal.map(r => renderRow(r, 'normal'))}</tbody>
                                                </table>
                                            </div>
                                            <MiniPager
                                                page={pg} total={normal.length} pageSize={PAGE_PREV}
                                                onChange={p => setSucPage(prev => ({ ...prev, [suc]: p }))}
                                            />
                                        </>
                                    )}

                                    {/* Revision */}
                                    {revision.length > 0 && (
                                        <>
                                            <button onClick={() => toggleRevision(suc)}
                                                className="w-full flex items-center gap-2 px-4 py-2 bg-amber-50/60 border-t border-amber-100 hover:bg-amber-100/50 transition-colors text-left">
                                                {isRevOpen
                                                    ? <ChevronDown  size={13} className="text-amber-600 flex-shrink-0" />
                                                    : <ChevronRight size={13} className="text-amber-600 flex-shrink-0" />}
                                                <span className="text-[12px] font-medium text-amber-700">
                                                    {revision.length} {revision.length === 1 ? 'producto' : 'productos'} con bodega disponible insuficiente para un multiplo — puedes ajustar manualmente
                                                </span>
                                            </button>
                                            {isRevOpen && (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full">{TABLE_HEAD}<tbody>{revision.map(r => renderRow(r, 'revision'))}</tbody></table>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Sin stock */}
                                    {sinStock.length > 0 && (
                                        <>
                                            <button onClick={() => toggleSinStock(suc)}
                                                className="w-full flex items-center gap-2 px-4 py-2 bg-slate-50/60 border-t border-slate-100 hover:bg-slate-100/50 transition-colors text-left">
                                                {isSinOpen
                                                    ? <ChevronDown  size={13} className="text-slate-400 flex-shrink-0" />
                                                    : <ChevronRight size={13} className="text-slate-400 flex-shrink-0" />}
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
                                </>
                            )}
                        </div>
                    );
                })}

                {/* Global confirm */}
                {globalTotals && sortedSucIds.length > 0 && (
                    <div className={`${GLASS} p-4 space-y-3`}>
                        <div className="flex items-center gap-4 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
                            <Package size={16} className="text-blue-500 flex-shrink-0" />
                            <div className="flex items-center gap-5 text-[13px] font-medium text-blue-700 flex-1">
                                <span>{globalTotals.sucursales} sucursal{globalTotals.sucursales !== 1 ? 'es' : ''}</span>
                                <span className="text-blue-300">·</span>
                                <span>{globalTotals.productos} productos</span>
                                <span className="text-blue-300">·</span>
                                <span className="font-bold">{globalTotals.packs} productos en total</span>
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
                    Por defecto ninguna está seleccionada. Elige las sucursales a reponer y calcula el pedido.
                </p>

                <style>{SUC_ANIM_CSS}</style>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {SUCURSALES.map((id) => {
                        const stat     = statMap[id];
                        const isOn  = selected.has(id);
                        const rank  = urgRank[id] ?? 5;
                        const urgColor  = rank < 2 ? 'text-red-500'   : rank < 4 ? 'text-amber-500' : 'text-emerald-500';
                        const urgBorder = !isOn && stat
                            ? rank < 2 ? 'border-red-200 hover:border-red-300'
                            : rank < 4 ? 'border-amber-200 hover:border-amber-300'
                            : 'border-emerald-200 hover:border-emerald-300'
                            : 'border-slate-200 hover:border-blue-300';
                        return (
                            <button key={id} onClick={() => toggleSuc(id)}
                                className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-3 border-2 text-center group ${
                                    isOn
                                        ? 'suc-pop bg-slate-800 border-slate-700 text-white shadow-lg shadow-slate-300/50'
                                        : `bg-white transition-all duration-200 ${urgBorder} text-slate-700 hover:shadow-sm`
                                }`}>
                                {/* Urgency rank badge */}
                                <span className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black leading-none ${
                                    isOn
                                        ? 'bg-white/20 text-white'
                                        : rank < 2 ? 'bg-red-100 text-red-600'
                                        : rank < 4 ? 'bg-amber-100 text-amber-600'
                                        : 'bg-emerald-100 text-emerald-600'
                                }`}>
                                    {rank + 1}
                                </span>
                                <Building2 size={18} className={isOn ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-600'} />
                                <span className={`text-[12px] font-bold leading-tight mb-1 ${isOn ? 'text-white' : 'text-slate-700'}`}>
                                    {ERP_NAMES[id]}
                                </span>
                                {stat && !dashLoading ? (<>
                                    <div className={`flex items-center gap-1 text-[10px] font-semibold ${isOn ? 'text-slate-300' : 'text-emerald-500'}`}>
                                        <span className="text-[9px] font-black">✓</span>
                                        {stat.con_bodega_packs.toLocaleString()}
                                    </div>
                                    <div className={`flex items-center gap-1 text-[10px] font-semibold ${isOn ? 'text-rose-300' : 'text-red-500'}`}>
                                        <span className="text-[9px] font-black">✗</span>
                                        {stat.sin_bodega_packs.toLocaleString()}
                                    </div>
                                </>) : (
                                    <div className="h-6 w-12 rounded bg-slate-100 animate-pulse mt-1" />
                                )}
                                {isOn && (
                                    <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center">
                                        <CheckCircle2 size={10} className="text-white" />
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-4 flex flex-col items-center gap-2">
                    <button onClick={handleCalcular}
                        disabled={loading || selected.size === 0}
                        className={`flex items-center gap-2.5 px-10 py-3.5 rounded-2xl font-bold text-[15px] transition-all duration-200 ${
                            selected.size === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-slate-900 text-white hover:bg-slate-800 shadow-[0_4px_20px_rgba(15,23,42,0.22)] hover:shadow-[0_8px_28px_rgba(15,23,42,0.30)] hover:-translate-y-0.5 active:scale-[0.98]'
                        }`}>
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <ClipboardList size={18} />}
                        {loading
                            ? 'Generando…'
                            : `Generar pedido${selected.size > 0 ? ` (${selected.size} sucursal${selected.size > 1 ? 'es' : ''})` : ''}`}
                    </button>
                    {error && (
                        <span className="text-[13px] text-red-600 flex items-center gap-1">
                            <AlertTriangle size={14} /> {error}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Productos sin stock en Bodega ──────────────── */}
            <div className={GLASS + ' px-4 py-3 flex items-center gap-2'}>
                <TriangleAlert size={15} className="text-red-500" />
                <span className="font-semibold text-slate-700 text-[14px]">Productos sin stock en Bodega</span>
                {sinBodega.length > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200 font-semibold">
                        {sinBodega.length.toLocaleString()} productos
                    </span>
                )}
                {searchTerm && (
                    <span className="ml-auto text-[11px] text-slate-400">"{searchTerm}"</span>
                )}
            </div>

            {/* ── Sin-bodega table (DataTable estándar) ────── */}
            <DataTable
                columns={SIN_BODEGA_COLS}
                sortKey={sinSortKey}
                sortDir={sinSortDir}
                onSort={handleSinSort}
                loading={sinBodegaLoad}
                empty={{
                    icon: Package,
                    message: searchTerm
                        ? `Sin resultados para "${searchTerm}"`
                        : 'No hay productos sin stock en Bodega',
                }}
                minWidth="560px"
            >
                {filteredSinBodega.map((row, i) => (
                    <DataRow key={row.erp_product_id} index={i}>
                        <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">
                            {row.product_name}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-500">{row.laboratorio || '—'}</td>
                        <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                                {(row.sucursales || []).map(s => (
                                    <span key={s.erp_sucursal_id}
                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 whitespace-nowrap"
                                        title={`${ERP_NAMES[s.erp_sucursal_id]}: necesita ${s.reponer}${s.ventas_6m > 0 ? ` · ${Math.round(s.ventas_6m)} ventas en 6m` : ''}`}>
                                        <span className="font-medium text-slate-600">{ERP_NAMES[s.erp_sucursal_id]}</span>
                                        <span className="text-red-500 font-semibold">{s.reponer}</span>
                                        {s.ventas_6m > 0 && (
                                            <span className="text-slate-400 flex items-center gap-0.5">
                                                ↻<span className="text-[8px] font-semibold">{Math.round(s.ventas_6m)}</span>
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                            <span className="text-[13px] font-bold text-red-600 tabular-nums">{row.total_necesidad}</span>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                            {row.total_ventas_6m > 0 ? (
                                <span className="inline-flex items-center justify-center gap-1 text-[12px] text-emerald-600 font-semibold tabular-nums">
                                    <TrendingUp size={11} />
                                    {Math.round(row.total_ventas_6m).toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-[11px] text-slate-300">—</span>
                            )}
                        </td>
                    </DataRow>
                ))}
            </DataTable>

            {!sinBodegaLoad && sinFiltered.length > 0 && (
                <TablePagination
                    pageSize={sinPageSize}
                    onPageSizeChange={setSinPageSize}
                    page={sinPage}
                    totalPages={sinTotalPages}
                    onPageChange={setSinPage}
                    total={sinFiltered.length}
                />
            )}
        </div>
    );
}
