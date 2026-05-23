import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Building2, Package, AlertTriangle, X, DollarSign,
    ChevronLeft, ChevronRight, AlertCircle, Truck, Archive, PackageX,
    TrendingDown, TrendingUp, CheckCircle2, CircleDashed,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const SUC_COLORS = {
    1: 'bg-blue-50 text-blue-700 border-blue-200',
    2: 'bg-violet-50 text-violet-700 border-violet-200',
    3: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    4: 'bg-amber-50 text-amber-700 border-amber-200',
    5: 'bg-rose-50 text-rose-700 border-rose-200',
    7: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    6: 'bg-slate-50 text-slate-600 border-slate-200',
};

const PAGE_SIZES = [25, 50, 100];

const MODES = [
    {
        key:    'sin_venta',
        label:  'Sin Venta',
        sub:    'con min/max, sin rotación 6m',
        Icon:   PackageX,
        rpc:    'get_no_sales_products',
        activeBg:   'bg-orange-50 border-orange-300 shadow-orange-100/80 -translate-y-px',
        inactiveBg: 'bg-white border-slate-200 hover:border-orange-200 hover:bg-orange-50/30',
        numColor:   'text-orange-600',
        iconColor:  'text-orange-500',
    },
    {
        key:    'sin_gestion',
        label:  'Sin Min/Max',
        sub:    'se venden pero sin parámetros',
        Icon:   AlertTriangle,
        rpc:    'get_products_sold_no_minmax',
        activeBg:   'bg-amber-50 border-amber-300 shadow-amber-100/80 -translate-y-px',
        inactiveBg: 'bg-white border-slate-200 hover:border-amber-200 hover:bg-amber-50/30',
        numColor:   'text-amber-600',
        iconColor:  'text-amber-500',
    },
    {
        key:    'stock_ret',
        label:  'Stock Retenido',
        sub:    'stock físico sin venta 6m',
        Icon:   Archive,
        rpc:    'get_stagnant_inventory',
        activeBg:   'bg-slate-100 border-slate-300 shadow-slate-100/80 -translate-y-px',
        inactiveBg: 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50',
        numColor:   'text-slate-700',
        iconColor:  'text-slate-500',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1_000)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSuggestion(row) {
    const stock  = Number(row.current_stock);
    if (!stock) return null;
    const soldIn = row.sold_in || [];
    let daysToExpiry = null;
    if (row.fecha_vencimiento_min)
        daysToExpiry = Math.floor((new Date(row.fecha_vencimiento_min) - new Date()) / 86_400_000);
    if (daysToExpiry !== null && daysToExpiry < 0)
        return { label: `Vencido hace ${Math.abs(daysToExpiry)}d`, detail: 'Producto vencido — dar de baja o liquidar', icon: AlertCircle, cls: 'bg-red-100 text-red-800 border-red-300' };
    if (daysToExpiry !== null && daysToExpiry <= 30)
        return { label: `Vence en ${daysToExpiry}d`, detail: 'No transferir — gestionar baja o liquidación', icon: AlertCircle, cls: 'bg-red-50 text-red-700 border-red-200' };
    const urgentExpiry = daysToExpiry !== null && daysToExpiry <= 90;
    if (soldIn.length === 0)
        return { label: 'Sin demanda', detail: urgentExpiry ? 'Liquidar antes de vencer' : 'Enviar a Bodega o dar de baja', icon: Archive, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200' };
    const best = soldIn[0], bestUnits = Number(best.units), bestName = ERP_NAMES[best.esid] || `Suc.${best.esid}`;
    if (bestUnits < 5)
        return { label: 'Baja demanda', detail: `Máx. ${bestUnits} und/6m en ${bestName} — enviar a Bodega`, icon: Archive, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200' };
    if (bestUnits < 20)
        return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · traslado posible${urgentExpiry ? ' (urgente)' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200' };
    return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · transferir${urgentExpiry ? ' urgente' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

// ─── SmartPagination ──────────────────────────────────────────────────────────

function SmartPagination({ page, total, onChange }) {
    if (total <= 1) return null;
    const buildPages = () => {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        const left  = Math.max(2, page - 1);
        const right = Math.min(total - 1, page + 1);
        if (left > 2) pages.push('…');
        for (let i = left; i <= right; i++) pages.push(i);
        if (right < total - 1) pages.push('…');
        pages.push(total);
        return pages;
    };
    return (
        <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold transition-all border disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 bg-white border-slate-200 hover:border-slate-300 hover:text-slate-700 shadow-sm">
                <ChevronLeft size={12} strokeWidth={2.5} /> Ant.
            </button>
            <div className="flex items-center gap-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <span key={`e${i}`} className="w-6 text-center text-[12px] font-bold select-none text-slate-300">·</span>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-full text-[12px] font-black transition-all duration-200 border ${
                                p === page
                                    ? 'bg-[#0052CC] text-white shadow-md shadow-blue-200/50 scale-110 border-[#0052CC]'
                                    : 'text-slate-500 border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm hover:text-slate-800'
                            }`}>{p}</button>
                )}
            </div>
            <button disabled={page >= total} onClick={() => onChange(page + 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold transition-all border disabled:opacity-30 disabled:cursor-not-allowed text-slate-500 bg-white border-slate-200 hover:border-slate-300 hover:text-slate-700 shadow-sm">
                Sig. <ChevronRight size={12} strokeWidth={2.5} />
            </button>
        </div>
    );
}

// ─── SortTh ───────────────────────────────────────────────────────────────────

function SortTh({ field, label, sortField, sortDir, onSort, className = '' }) {
    const active = sortField === field;
    return (
        <th onClick={() => onSort(field)}
            className={`px-4 py-3.5 text-[10px] font-black uppercase tracking-widest cursor-pointer select-none transition-colors whitespace-nowrap ${
                active ? 'text-[#0052CC]' : 'text-slate-400 hover:text-slate-600'
            } ${className}`}>
            <span className="flex items-center gap-1.5">
                {label}
                <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-30'}`}>
                    {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </span>
            </span>
        </th>
    );
}

// ─── Sub-filter cards ─────────────────────────────────────────────────────────

function SinVentaFilters({ data, filterMode, onFilter, loading }) {
    const counts = useMemo(() => ({
        con_stock:     data.filter(r => Number(r.current_stock) > 0).length,
        otras_suc:     data.filter(r => (r.sold_in || []).length > 0).length,
        sin_historial: data.filter(r => (r.sold_in || []).length === 0).length,
    }), [data]);

    const CARDS = [
        { id: 'con_stock', Icon: PackageX, label: 'Con stock retenido', sub: 'sin venta aquí',
          activeBg: 'bg-orange-50 border-orange-300 -translate-y-px', inactiveBg: 'bg-white border-slate-200 hover:border-orange-200 hover:bg-orange-50/40',
          iconColor: 'text-orange-500', numColor: n => n > 0 ? 'text-orange-600' : 'text-slate-300' },
        { id: 'otras_suc', Icon: TrendingDown, label: 'Vendido en otras', sub: 'demanda en la red',
          activeBg: 'bg-blue-50 border-blue-300 -translate-y-px', inactiveBg: 'bg-white border-slate-200 hover:border-blue-200 hover:bg-blue-50/40',
          iconColor: 'text-blue-500', numColor: n => n > 0 ? 'text-blue-600' : 'text-slate-300' },
        { id: 'sin_historial', Icon: Archive, label: 'Sin historial', sub: 'sin ventas en la red',
          activeBg: 'bg-slate-100 border-slate-300 -translate-y-px', inactiveBg: 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50',
          iconColor: 'text-slate-400', numColor: n => n > 0 ? 'text-slate-600' : 'text-slate-300' },
    ];

    return (
        <>
            {CARDS.map(c => {
                const active = filterMode === c.id;
                return (
                    <button key={c.id} onClick={() => onFilter(c.id)} disabled={loading}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[155px] shadow-sm disabled:opacity-40 ${active ? c.activeBg : c.inactiveBg}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-white' : 'bg-slate-50'}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0">
                            <div className={`text-[20px] font-black leading-none tabular-nums ${c.numColor(counts[c.id])}`}>
                                {loading ? <span className="text-slate-200">–</span> : counts[c.id].toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">{c.label}</div>
                            <div className="text-[9px] text-slate-400">{c.sub}</div>
                        </div>
                        {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>
                );
            })}
        </>
    );
}

function StockRetFilters({ data, filterMode, onFilter, loading }) {
    const counts = useMemo(() => ({
        con_minmax: data.filter(r => r.in_minmax).length,
        sin_minmax: data.filter(r => !r.in_minmax).length,
    }), [data]);

    const CARDS = [
        { id: 'con_minmax', Icon: CheckCircle2, label: 'Con Min/Max', sub: 'tiene parámetros asignados',
          activeBg: 'bg-emerald-50 border-emerald-300 -translate-y-px', inactiveBg: 'bg-white border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/40',
          iconColor: 'text-emerald-500', numColor: n => n > 0 ? 'text-emerald-600' : 'text-slate-300' },
        { id: 'sin_minmax', Icon: CircleDashed, label: 'Sin Min/Max', sub: 'sin parámetros asignados',
          activeBg: 'bg-red-50 border-red-200 -translate-y-px', inactiveBg: 'bg-white border-slate-200 hover:border-red-200 hover:bg-red-50/30',
          iconColor: 'text-red-400', numColor: n => n > 0 ? 'text-red-600' : 'text-slate-300' },
    ];

    return (
        <>
            {CARDS.map(c => {
                const active = filterMode === c.id;
                return (
                    <button key={c.id} onClick={() => onFilter(c.id)} disabled={loading}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[155px] shadow-sm disabled:opacity-40 ${active ? c.activeBg : c.inactiveBg}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-white' : 'bg-slate-50'}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0">
                            <div className={`text-[20px] font-black leading-none tabular-nums ${c.numColor(counts[c.id])}`}>
                                {loading ? <span className="text-slate-200">–</span> : counts[c.id].toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">{c.label}</div>
                            <div className="text-[9px] text-slate-400">{c.sub}</div>
                        </div>
                        {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>
                );
            })}
        </>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabGestionStock({ searchTerm = '' }) {
    const [mode,        setMode]        = useState('sin_venta');
    const [selectedErp, setSelectedErp] = useState(5);
    const [filterMode,  setFilterMode]  = useState('con_stock');

    // One data store per view — keyed so switching back doesn't re-fetch
    const [sinVenta,   setSinVenta]   = useState([]);
    const [sinGestion, setSinGestion] = useState([]);
    const [stockRet,   setStockRet]   = useState([]);

    const [loadingMap,   setLoadingMap]   = useState({ sin_venta: false, sin_gestion: false, stock_ret: false });
    const [refreshingMap, setRefreshingMap] = useState({ sin_venta: false, sin_gestion: false, stock_ret: false });
    const [errorMap,     setErrorMap]     = useState({ sin_venta: null, sin_gestion: null, stock_ret: null });

    const [page,      setPage]      = useState(1);
    const [pageSize,  setPageSize]  = useState(25);
    const [sortField, setSortField] = useState('product_name');
    const [sortDir,   setSortDir]   = useState('asc');

    const loadRefs = useRef({ sin_venta: 0, sin_gestion: 0, stock_ret: 0 });
    const dataRefs = useRef({ sin_venta: [], sin_gestion: [], stock_ret: [] });

    const setterFor = (m) => m === 'sin_venta' ? setSinVenta : m === 'sin_gestion' ? setSinGestion : setStockRet;
    const dataFor   = (m) => m === 'sin_venta' ? sinVenta    : m === 'sin_gestion' ? sinGestion    : stockRet;

    const handleSort = useCallback((field) => {
        setSortField(prev => {
            if (prev === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir('asc');
            return field;
        });
        setPage(1);
    }, []);

    // Reset default sort when mode changes
    useEffect(() => {
        if (mode === 'sin_gestion') { setSortField('revenue'); setSortDir('desc'); }
        else if (mode === 'stock_ret') { setSortField('cost_value'); setSortDir('desc'); }
        else { setSortField('product_name'); setSortDir('asc'); }
        setPage(1);
    }, [mode]);

    const tk = {
        card:             'bg-white border-slate-200/80 shadow-[0_4px_24px_rgba(0,82,204,0.10)]',
        thead:            'bg-gradient-to-r from-[#0052CC]/[0.07] to-[#0052CC]/[0.03] border-b border-[#0052CC]/[0.12]',
        rowBorder:        'border-t border-slate-100',
        rowHover:         'hover:bg-[#0052CC]/[0.03]',
        skeleton:         'bg-slate-200/70',
        emptyBg:          'bg-white border-slate-200/80',
        filterPill:       'bg-white border-slate-200/80 shadow-[0_2px_12px_rgba(0,82,204,0.08)]',
        filterBtn:        'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
        filterDivider:    'bg-slate-100',
        pageSizeActive:   'bg-[#0052CC] text-white border-[#0052CC] shadow-sm',
        pageSizeInactive: 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
        totalText:        'text-slate-400',
    };

    const loadMode = useCallback(async (erpId, m) => {
        const rid = ++loadRefs.current[m];
        setErrorMap(prev => ({ ...prev, [m]: null }));
        setPage(1);
        const setter = setterFor(m);
        if (dataRefs.current[m].length === 0) setLoadingMap(prev => ({ ...prev, [m]: true }));
        else setRefreshingMap(prev => ({ ...prev, [m]: true }));

        const rpcName = MODES.find(mx => mx.key === m).rpc;
        try {
            const BATCH = 1000;
            let all = [], from = 0;
            while (true) {
                const { data: rows, error: e } = await supabase
                    .rpc(rpcName, { p_erp_sucursal_id: erpId })
                    .range(from, from + BATCH - 1);
                if (e) throw e;
                if (rid !== loadRefs.current[m]) return;
                all = [...all, ...(rows || [])];
                dataRefs.current[m] = all;
                setter([...all]);
                if (!rows || rows.length < BATCH) break;
                from += BATCH;
            }
        } catch (e) {
            if (rid === loadRefs.current[m]) setErrorMap(prev => ({ ...prev, [m]: e.message }));
        } finally {
            if (rid === loadRefs.current[m]) {
                setLoadingMap(prev => ({ ...prev, [m]: false }));
                setRefreshingMap(prev => ({ ...prev, [m]: false }));
            }
        }
    }, []);

    // When sucursal changes: clear all and reload all 3 modes
    useEffect(() => {
        dataRefs.current = { sin_venta: [], sin_gestion: [], stock_ret: [] };
        setSinVenta([]); setSinGestion([]); setStockRet([]);
        setFilterMode('con_stock');
        MODES.forEach(m => loadMode(erpId, m.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedErp]);

    // Alias for the effect above
    const erpId = selectedErp;

    useEffect(() => { setPage(1); }, [filterMode, searchTerm, pageSize]);

    // Active dataset
    const activeData      = dataFor(mode);
    const activeLoading   = loadingMap[mode];
    const activeRefreshing = refreshingMap[mode];
    const activeError     = errorMap[mode];

    // Filtered + sorted
    const filtered = useMemo(() => {
        let rows = activeData;

        if (mode === 'sin_venta') {
            if      (filterMode === 'con_stock')     rows = rows.filter(r => Number(r.current_stock) > 0);
            else if (filterMode === 'otras_suc')     rows = rows.filter(r => (r.sold_in || []).length > 0);
            else if (filterMode === 'sin_historial') rows = rows.filter(r => (r.sold_in || []).length === 0);
        } else if (mode === 'stock_ret') {
            if      (filterMode === 'con_minmax') rows = rows.filter(r => r.in_minmax);
            else if (filterMode === 'sin_minmax') rows = rows.filter(r => !r.in_minmax);
        }

        const q = (searchTerm || '').toLowerCase();
        if (q) rows = rows.filter(r => r.product_name?.toLowerCase().includes(q));

        return [...rows].sort((a, b) => {
            if (sortField === 'product_name') {
                const cmp = (a.product_name || '').localeCompare(b.product_name || '', 'es');
                return sortDir === 'asc' ? cmp : -cmp;
            }
            const av = Number(a[sortField] || 0), bv = Number(b[sortField] || 0);
            return sortDir === 'asc' ? av - bv : bv - av;
        });
    }, [activeData, mode, filterMode, searchTerm, sortField, sortDir]);

    const totalCost     = useMemo(() => activeData.reduce((s, r) => s + Number(r.cost_value || 0), 0), [activeData]);
    const filteredCost  = useMemo(() => filtered.reduce((s, r) => s + Number(r.cost_value || 0), 0), [filtered]);
    const totalRevenue  = useMemo(() => activeData.reduce((s, r) => s + Number(r.revenue || 0), 0), [activeData]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageRows   = filtered.slice((page - 1) * pageSize, page * pageSize);
    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Filters row: stat cards (left) + filter pill (right) ── */}
            <div className="flex items-start gap-3 flex-wrap">

                {/* Left: summary + cost/revenue + sub-filter cards */}
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">

                    {/* Total count card */}
                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[130px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#0052CC]/[0.07]">
                            <Package size={15} className="text-[#0052CC]/50" />
                        </div>
                        <div className="text-left min-w-0">
                            <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                                {activeLoading ? <span className="text-slate-200">–</span> : activeData.length.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">
                                {mode === 'sin_venta' ? 'Sin venta (6m)' : mode === 'sin_gestion' ? 'Sin Min/Max' : 'Stock retenido'}
                            </div>
                            <div className="text-[9px] text-slate-400">en la sucursal activa</div>
                        </div>
                    </div>

                    {/* Costo retenido (sin_venta + stock_ret) */}
                    {mode !== 'sin_gestion' && (
                        <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[145px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-orange-50">
                                <DollarSign size={15} className="text-orange-500" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-[22px] font-black leading-none tabular-nums text-orange-600">
                                    {activeLoading ? <span className="text-slate-200">–</span> : fmtMoney(totalCost)}
                                </div>
                                <div className="text-[10px] font-bold leading-tight text-slate-600">Costo retenido</div>
                                {filteredCost > 0 && filteredCost !== totalCost
                                    ? <div className="text-[9px] text-orange-400">{fmtMoney(filteredCost)} en filtro</div>
                                    : <div className="text-[9px] text-slate-400">total sucursal</div>
                                }
                            </div>
                        </div>
                    )}

                    {/* Revenue (sin_gestion) */}
                    {mode === 'sin_gestion' && (
                        <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[145px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-50">
                                <TrendingUp size={15} className="text-amber-500" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-[22px] font-black leading-none tabular-nums text-amber-600">
                                    {activeLoading ? <span className="text-slate-200">–</span> : fmtMoney(totalRevenue)}
                                </div>
                                <div className="text-[10px] font-bold leading-tight text-slate-600">Revenue 6m</div>
                                <div className="text-[9px] text-slate-400">sin parámetros min/max</div>
                            </div>
                        </div>
                    )}

                    {/* Sub-filter cards — only for modes that have them */}
                    {mode !== 'sin_gestion' && <div className="w-px h-14 self-center hidden sm:block bg-slate-100" />}
                    {mode === 'sin_venta' && (
                        <SinVentaFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'todos' : id)} loading={activeLoading} />
                    )}
                    {mode === 'stock_ret' && (
                        <StockRetFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'todos' : id)} loading={activeLoading} />
                    )}
                </div>

                {/* Right: filter pill — mode selector + sucursal */}
                <div className={`flex items-center rounded-2xl border transition-all duration-300 shrink-0 overflow-visible ${tk.filterPill}`}>

                    {/* Mode pills */}
                    <div className="flex items-center gap-0.5 px-2.5 py-2">
                        {MODES.map(m => {
                            const active = mode === m.key;
                            const count  = m.key === 'sin_venta' ? sinVenta.length : m.key === 'sin_gestion' ? sinGestion.length : stockRet.length;
                            return (
                                <button key={m.key}
                                    onClick={() => { setMode(m.key); setFilterMode(m.key === 'sin_venta' ? 'con_stock' : 'todos'); }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all whitespace-nowrap ${
                                        active ? 'bg-[#0052CC]/[0.10] text-[#0052CC]' : tk.filterBtn
                                    }`}>
                                    {m.label}
                                    <span className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-tight ${
                                        active ? 'bg-[#0052CC] text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        {loadingMap[m.key] ? '…' : count.toLocaleString()}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className={`h-5 w-px shrink-0 ${tk.filterDivider}`} />

                    {/* Sucursal */}
                    {activeRefreshing && <div className="pl-2"><Loader2 size={13} className="animate-spin text-slate-300" /></div>}
                    <div className="px-2 py-2 overflow-visible" style={{ width: '170px' }}>
                        <LiquidSelect
                            value={String(selectedErp)}
                            onChange={v => { if (v) setSelectedErp(Number(v)); }}
                            options={erpOptions}
                            icon={Building2}
                            clearable={false}
                            compact
                        />
                    </div>
                </div>
            </div>

            {/* ── Error ── */}
            {activeError && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
                    <AlertTriangle size={14} /> {activeError}
                    <button onClick={() => loadMode(selectedErp, mode)} className="ml-auto text-red-500 hover:text-red-700 font-bold">Reintentar</button>
                </div>
            )}

            {/* ── Table ── */}
            {activeLoading && activeData.length === 0 ? (
                <div className={`rounded-2xl border overflow-hidden ${tk.card}`}>
                    <table className="min-w-full">
                        <tbody>
                            {Array.from({ length: 10 }).map((_, i) => (
                                <tr key={i} className={`border-l-[3px] border-l-transparent ${i > 0 ? tk.rowBorder : ''}`}>
                                    <td className="px-4 py-3.5">
                                        <div className="space-y-2">
                                            <div className={`h-[13px] rounded-full animate-pulse ${tk.skeleton}`} style={{ width: `${140 + (i * 23) % 80}px` }} />
                                            <div className={`h-2.5 rounded-full animate-pulse ${tk.skeleton}`} style={{ width: `${50 + (i * 17) % 50}px` }} />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 hidden sm:table-cell"><div className={`h-4 w-14 rounded-full animate-pulse ml-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5 hidden sm:table-cell"><div className={`h-4 w-20 rounded-full animate-pulse ml-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5 hidden md:table-cell"><div className={`h-6 w-24 rounded-full animate-pulse mx-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5"><div className={`h-5 w-28 rounded-full animate-pulse ${tk.skeleton}`} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filtered.length === 0 ? (
                <div className={`rounded-2xl border py-20 text-center ${tk.emptyBg}`}>
                    <Package size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium text-slate-400">
                        {activeData.length === 0 ? '¡Sin productos para este criterio!' : 'Sin productos con ese filtro'}
                    </p>
                    {activeData.length > 0 && filterMode !== 'todos' && (
                        <button onClick={() => setFilterMode('todos')} className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">Ver todos</button>
                    )}
                </div>
            ) : (
                <div className={`rounded-2xl border overflow-hidden transition-opacity duration-300 ${tk.card} ${activeRefreshing ? 'opacity-60' : 'opacity-100'}`}>
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">

                            {/* ── Sin Venta table ── */}
                            {mode === 'sin_venta' && (
                                <>
                                <thead className={`sticky top-0 z-10 ${tk.thead}`}>
                                    <tr>
                                        <SortTh field="product_name"  label="Producto"       sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left" />
                                        <SortTh field="current_stock" label="Stock aquí"      sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                        <SortTh field="min_qty"       label="Min / Max"        sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center hidden md:table-cell" />
                                        <SortTh field="cost_value"    label="Costo retenido"  sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                        <th className="px-4 py-3.5 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Sugerencia</th>
                                        <th className="px-4 py-3.5 text-left  text-[10px] font-black uppercase tracking-widest text-slate-400">Vendido en (6m)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map(row => {
                                        const stock    = Number(row.current_stock);
                                        const cost     = Number(row.cost_value || 0);
                                        const soldIn   = row.sold_in || [];
                                        const hasStock = stock > 0;
                                        const sug      = hasStock ? getSuggestion(row) : null;
                                        return (
                                            <tr key={row.erp_product_id}
                                                style={{ borderLeftColor: hasStock ? '#f97316' : 'transparent' }}
                                                className={`border-l-[3px] ${tk.rowBorder} ${tk.rowHover} transition-colors ${hasStock ? 'bg-orange-50/20' : ''}`}>
                                                <td className="px-4 py-3.5">
                                                    <span className="text-[13.5px] font-semibold text-slate-800 block truncate leading-snug max-w-[280px]">{row.product_name || '—'}</span>
                                                    {row.fecha_vencimiento_min && (() => {
                                                        const exp = new Date(row.fecha_vencimiento_min);
                                                        const expired = exp < new Date();
                                                        return <span className={`text-[9px] mt-0.5 block font-semibold ${expired ? 'text-red-500' : 'text-slate-400'}`}>
                                                            {expired ? 'Vencido: ' : 'Vence: '}{exp.toLocaleDateString('es-SV', { day:'numeric', month:'short', year:'numeric' })}
                                                        </span>;
                                                    })()}
                                                </td>
                                                <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                    {hasStock ? <><span className="text-[13px] font-bold text-orange-600 tabular-nums">{stock.toLocaleString()}</span><span className="text-[10px] text-orange-400 ml-1">und</span></> : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 text-center whitespace-nowrap hidden md:table-cell">
                                                    {row.min_qty != null || row.max_qty != null
                                                        ? <span className="text-[11px] font-bold tabular-nums text-slate-600">{row.min_qty ?? '—'}<span className="text-slate-300 mx-1">/</span>{row.max_qty ?? '—'}</span>
                                                        : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                    {cost > 0 ? <span className="text-[12px] font-bold text-orange-700 tabular-nums">{fmtMoney(cost)}</span> : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 text-center hidden md:table-cell">
                                                    {sug ? <span title={sug.detail} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border cursor-default ${sug.cls}`}><sug.icon size={9} className="shrink-0" /><span className="truncate max-w-[110px]">{sug.label}</span></span>
                                                         : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        {soldIn.length === 0
                                                            ? <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full italic">Sin historial</span>
                                                            : soldIn.map(s => (
                                                                <span key={s.esid} title={`$${Number(s.rev).toLocaleString('en-US', { maximumFractionDigits: 0 })} en ingresos`}
                                                                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-default ${SUC_COLORS[s.esid] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                                    {ERP_NAMES[s.esid] || `Suc.${s.esid}`}<span className="opacity-50 font-normal">·</span><span className="tabular-nums opacity-80">{Number(s.units).toLocaleString()}</span>
                                                                </span>
                                                            ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                </>
                            )}

                            {/* ── Sin Gestión ERP table ── */}
                            {mode === 'sin_gestion' && (
                                <>
                                <thead className={`sticky top-0 z-10 ${tk.thead}`}>
                                    <tr>
                                        <SortTh field="product_name" label="Producto"          sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left" />
                                        <SortTh field="units_sold"   label="Und. vendidas (6m)" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                        <SortTh field="revenue"      label="Revenue (6m)"       sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map(row => (
                                        <tr key={row.erp_product_id} className={`border-l-[3px] border-l-amber-300 ${tk.rowBorder} ${tk.rowHover} transition-colors bg-amber-50/10`}>
                                            <td className="px-4 py-3.5">
                                                <span className="text-[13.5px] font-semibold text-slate-800 block truncate leading-snug max-w-[380px]">{row.product_name || '—'}</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                <span className="text-[13px] font-bold text-amber-600 tabular-nums">{Number(row.units_sold).toLocaleString()}</span>
                                                <span className="text-[10px] text-amber-400 ml-1">und</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                                <span className="text-[13px] font-bold text-slate-700 tabular-nums">{fmtMoney(row.revenue)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                </>
                            )}

                            {/* ── Stock Retenido table ── */}
                            {mode === 'stock_ret' && (
                                <>
                                <thead className={`sticky top-0 z-10 ${tk.thead}`}>
                                    <tr>
                                        <SortTh field="product_name"  label="Producto"       sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-left" />
                                        <SortTh field="current_stock" label="Stock aquí"      sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                        <SortTh field="cost_value"    label="Costo retenido"  sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                        <th className="px-4 py-3.5 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell whitespace-nowrap">Min/Max</th>
                                        <th className="px-4 py-3.5 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Sugerencia</th>
                                        <th className="px-4 py-3.5 text-left  text-[10px] font-black uppercase tracking-widest text-slate-400">Vendido en (6m)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map(row => {
                                        const stock  = Number(row.current_stock);
                                        const cost   = Number(row.cost_value || 0);
                                        const soldIn = row.sold_in || [];
                                        const sug    = getSuggestion(row);
                                        return (
                                            <tr key={row.erp_product_id}
                                                style={{ borderLeftColor: row.in_minmax ? '#10b981' : '#f87171' }}
                                                className={`border-l-[3px] ${tk.rowBorder} ${tk.rowHover} transition-colors`}>
                                                <td className="px-4 py-3.5">
                                                    <span className="text-[13.5px] font-semibold text-slate-800 block truncate leading-snug max-w-[280px]">{row.product_name || '—'}</span>
                                                    {row.fecha_vencimiento_min && (() => {
                                                        const exp = new Date(row.fecha_vencimiento_min);
                                                        const expired = exp < new Date();
                                                        return <span className={`text-[9px] mt-0.5 block font-semibold ${expired ? 'text-red-500' : 'text-slate-400'}`}>
                                                            {expired ? 'Vencido: ' : 'Vence: '}{exp.toLocaleDateString('es-SV', { day:'numeric', month:'short', year:'numeric' })}
                                                        </span>;
                                                    })()}
                                                </td>
                                                <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                    <span className="text-[13px] font-bold text-slate-700 tabular-nums">{stock.toLocaleString()}</span>
                                                    <span className="text-[10px] text-slate-400 ml-1">und</span>
                                                </td>
                                                <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                    {cost > 0 ? <span className="text-[12px] font-bold text-orange-700 tabular-nums">{fmtMoney(cost)}</span> : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5 text-center hidden md:table-cell">
                                                    {row.in_minmax
                                                        ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 size={9} />Con Min/Max</span>
                                                        : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200"><CircleDashed size={9} />Sin Min/Max</span>}
                                                </td>
                                                <td className="px-4 py-3.5 text-center hidden md:table-cell">
                                                    {sug ? <span title={sug.detail} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border cursor-default ${sug.cls}`}><sug.icon size={9} className="shrink-0" /><span className="truncate max-w-[110px]">{sug.label}</span></span>
                                                         : <span className="text-[11px] text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        {soldIn.length === 0
                                                            ? <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full italic">Sin historial</span>
                                                            : soldIn.map(s => (
                                                                <span key={s.esid} title={`$${Number(s.rev).toLocaleString('en-US', { maximumFractionDigits: 0 })} en ingresos`}
                                                                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-default ${SUC_COLORS[s.esid] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                                    {ERP_NAMES[s.esid] || `Suc.${s.esid}`}<span className="opacity-50 font-normal">·</span><span className="tabular-nums opacity-80">{Number(s.units).toLocaleString()}</span>
                                                                </span>
                                                            ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                </>
                            )}

                        </table>
                    </div>
                </div>
            )}

            {/* ── Pagination ── */}
            {!activeLoading && filtered.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {PAGE_SIZES.map(size => (
                            <button key={size} onClick={() => { setPageSize(size); setPage(1); }}
                                className={`px-3 h-7 rounded-full text-[10px] font-bold transition-all border ${pageSize === size ? tk.pageSizeActive : tk.pageSizeInactive}`}>
                                {size}
                            </button>
                        ))}
                    </div>
                    <SmartPagination page={page} total={totalPages} onChange={setPage} />
                    <span className={`text-[10px] font-semibold w-[80px] text-right ${tk.totalText}`}>
                        {filtered.length.toLocaleString()} total
                    </span>
                </div>
            )}
        </div>
    );
}
