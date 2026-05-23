import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Building2, Package, AlertTriangle, X, DollarSign,
    ChevronLeft, ChevronRight, AlertCircle, Truck, Archive, PackageX,
    TrendingDown,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1_000)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSuggestion(row) {
    const stock = Number(row.current_stock);
    if (!stock) return null;
    const soldIn = row.sold_in || [];
    const today  = new Date();
    let daysToExpiry = null;
    if (row.fecha_vencimiento_min) {
        daysToExpiry = Math.floor((new Date(row.fecha_vencimiento_min) - today) / 86_400_000);
    }
    if (daysToExpiry !== null && daysToExpiry <= 30) {
        return { label: `Vence en ${daysToExpiry}d`, detail: 'No transferir — gestionar baja o liquidación', icon: AlertCircle, cls: 'bg-red-50 text-red-700 border-red-200' };
    }
    const urgentExpiry = daysToExpiry !== null && daysToExpiry <= 90;
    if (soldIn.length === 0) {
        return { label: 'Sin demanda', detail: urgentExpiry ? 'Liquidar antes de vencer' : 'Enviar a Bodega o dar de baja', icon: Archive, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200' };
    }
    const best      = soldIn[0];
    const bestUnits = Number(best.units);
    const bestName  = ERP_NAMES[best.esid] || `Suc.${best.esid}`;
    if (bestUnits < 5) {
        return { label: 'Baja demanda', detail: `Máx. ${bestUnits} und/6m en ${bestName} — enviar a Bodega`, icon: Archive, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200' };
    }
    if (bestUnits < 20) {
        return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · traslado posible${urgentExpiry ? ' (urgente)' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · transferir${urgentExpiry ? ' urgente' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

// ─── SmartPagination (same as TabCatalogo, Liquid theme) ──────────────────────

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

// ─── SinVentaStatCards ────────────────────────────────────────────────────────

function SinVentaStatCards({ counts, loading, filterMode, onFilter }) {
    const CARDS = [
        {
            id:         'con_stock',
            Icon:       PackageX,
            label:      'Con stock retenido',
            sub:        'sin venta aquí',
            activeBg:   'bg-orange-50 border-orange-300 shadow-orange-100/80 -translate-y-px',
            inactiveBg: 'bg-white border-slate-200 hover:border-orange-200 hover:bg-orange-50/40',
            iconActive: 'bg-white',
            iconInact:  'bg-orange-50',
            iconColor:  'text-orange-500',
            numColor:   (n) => n > 0 ? 'text-orange-600' : 'text-slate-300',
        },
        {
            id:         'otras_suc',
            Icon:       TrendingDown,
            label:      'Vendido en otras',
            sub:        'demanda en la red',
            activeBg:   'bg-blue-50 border-blue-300 shadow-blue-100/80 -translate-y-px',
            inactiveBg: 'bg-white border-slate-200 hover:border-blue-200 hover:bg-blue-50/40',
            iconActive: 'bg-white',
            iconInact:  'bg-blue-50',
            iconColor:  'text-blue-500',
            numColor:   (n) => n > 0 ? 'text-blue-600' : 'text-slate-300',
        },
        {
            id:         'sin_historial',
            Icon:       Archive,
            label:      'Sin historial',
            sub:        'sin ventas en la red',
            activeBg:   'bg-slate-100 border-slate-300 shadow-slate-100/80 -translate-y-px',
            inactiveBg: 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50',
            iconActive: 'bg-white',
            iconInact:  'bg-slate-50',
            iconColor:  'text-slate-400',
            numColor:   (n) => n > 0 ? 'text-slate-600' : 'text-slate-300',
        },
    ];

    return (
        <div className="flex gap-3 flex-wrap">

            {/* Info card — total */}
            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[140px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#0052CC]/[0.07]">
                    <Package size={15} className="text-[#0052CC]/50" />
                </div>
                <div className="text-left min-w-0">
                    <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                        {loading ? <span className="text-slate-200">–</span> : counts.total.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-bold leading-tight text-slate-600">Sin venta (6m)</div>
                    <div className="text-[9px] text-slate-400">en la sucursal activa</div>
                </div>
            </div>

            <div className="w-px h-14 self-center hidden sm:block bg-slate-100" />

            {/* Filter cards */}
            {CARDS.map(c => {
                const active = filterMode === c.id;
                return (
                    <button key={c.id} onClick={() => onFilter(c.id)} disabled={loading}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[160px] shadow-sm disabled:opacity-40 disabled:cursor-wait ${
                            active ? c.activeBg : c.inactiveBg
                        }`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? c.iconActive : c.iconInact}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0">
                            <div className={`text-[22px] font-black leading-none tabular-nums ${c.numColor(c.id === 'con_stock' ? counts.con_stock : c.id === 'otras_suc' ? counts.otras_suc : counts.sin_historial)}`}>
                                {loading ? <span className="text-slate-200">–</span> : (c.id === 'con_stock' ? counts.con_stock : c.id === 'otras_suc' ? counts.otras_suc : counts.sin_historial).toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">{c.label}</div>
                            <div className="text-[9px] text-slate-400">{c.sub}</div>
                        </div>
                        {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>
                );
            })}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabSinVenta({ searchTerm = '' }) {
    const [selectedErp, setSelectedErp] = useState(5);
    const [filterMode,  setFilterMode]  = useState('con_stock');
    const [data,        setData]        = useState([]);
    const [loading,     setLoading]     = useState(false);
    const [error,       setError]       = useState(null);
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(25);
    const loadRef = useRef(0);

    // ── Theme tokens — Liquid (same as TabCatalogo default) ───────────────────
    const tk = {
        card:            'bg-white border-slate-200/80 shadow-[0_4px_24px_rgba(0,82,204,0.10)]',
        thead:           'bg-gradient-to-r from-[#0052CC]/[0.07] to-[#0052CC]/[0.03] border-b border-[#0052CC]/[0.12]',
        rowBorder:       'border-t border-slate-100',
        rowHover:        'hover:bg-[#0052CC]/[0.03]',
        skeleton:        'bg-slate-200/70',
        emptyBg:         'bg-white border-slate-200/80',
        filterPill:      'bg-white border-slate-200/80 shadow-[0_2px_12px_rgba(0,82,204,0.08)]',
        pageSizeActive:  'bg-[#0052CC] text-white border-[#0052CC] shadow-sm',
        pageSizeInactive:'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
        totalText:       'text-slate-400',
    };

    // ── Data loading ──────────────────────────────────────────────────────────
    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true); setError(null); setPage(1);
        try {
            const { data: rows, error: e } = await supabase
                .rpc('get_no_sales_products', { p_erp_sucursal_id: erpId })
                .range(0, 9999);
            if (e) throw e;
            if (rid !== loadRef.current) return;
            setData(rows || []);
        } catch (e) {
            if (rid === loadRef.current) setError(e.message);
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); }, [selectedErp, loadData]);
    useEffect(() => { setPage(1); }, [filterMode, searchTerm, pageSize]);

    // ── Derived ───────────────────────────────────────────────────────────────
    const counts = useMemo(() => ({
        total:         data.length,
        con_stock:     data.filter(r => Number(r.current_stock) > 0).length,
        otras_suc:     data.filter(r => (r.sold_in || []).length > 0).length,
        sin_historial: data.filter(r => (r.sold_in || []).length === 0).length,
    }), [data]);

    const totalRetainedCost = useMemo(() =>
        data.reduce((acc, r) => acc + Number(r.cost_value || 0), 0), [data]);

    const filtered = useMemo(() => {
        let rows = data;
        if      (filterMode === 'con_stock')     rows = rows.filter(r => Number(r.current_stock) > 0);
        else if (filterMode === 'otras_suc')     rows = rows.filter(r => (r.sold_in || []).length > 0);
        else if (filterMode === 'sin_historial') rows = rows.filter(r => (r.sold_in || []).length === 0);
        const q = searchTerm.toLowerCase();
        if (q) rows = rows.filter(r => r.product_name?.toLowerCase().includes(q));
        return rows;
    }, [data, filterMode, searchTerm]);

    const filteredCost = useMemo(() =>
        filtered.reduce((a, r) => a + Number(r.cost_value || 0), 0), [filtered]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageRows   = filtered.slice((page - 1) * pageSize, page * pageSize);
    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Stats + filter pill row ── */}
            <div className="flex items-start gap-3 flex-wrap">

                {/* Stat cards — act as filters */}
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                    <SinVentaStatCards
                        counts={counts}
                        loading={loading}
                        filterMode={filterMode}
                        onFilter={(id) => setFilterMode(prev => prev === id ? 'todos' : id)}
                    />
                </div>

                {/* Filter pill — sucursal selector */}
                <div className={`flex items-center rounded-2xl border transition-all duration-300 shrink-0 overflow-visible ${tk.filterPill}`}>
                    <div className="px-2.5 py-2 overflow-visible" style={{ width: '185px' }}>
                        <LiquidSelect
                            value={String(selectedErp)}
                            onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterMode('con_stock'); } }}
                            options={erpOptions}
                            icon={Building2}
                            clearable={false}
                            compact
                        />
                    </div>
                </div>
            </div>

            {/* ── Cost banner ── */}
            {!loading && totalRetainedCost > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-orange-50 border border-orange-200">
                    <DollarSign size={14} className="text-orange-400 shrink-0" />
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[20px] font-black text-orange-700 tabular-nums">{fmtMoney(totalRetainedCost)}</span>
                        <span className="text-[11px] text-orange-500 font-semibold">retenidos sin mover en {ERP_NAMES[selectedErp]}</span>
                    </div>
                    {filteredCost > 0 && filteredCost !== totalRetainedCost && (
                        <span className="ml-auto text-[10px] text-orange-400 font-semibold shrink-0">
                            {fmtMoney(filteredCost)} en filtro
                        </span>
                    )}
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
                    <AlertTriangle size={14} /> {error}
                    <button onClick={() => loadData(selectedErp)} className="ml-auto text-red-500 hover:text-red-700 font-bold">Reintentar</button>
                </div>
            )}

            {/* ── Table ── */}
            {loading ? (
                /* Skeleton */
                <div className={`rounded-2xl border overflow-hidden ${tk.card}`}>
                    <table className="min-w-full">
                        <tbody>
                            {Array.from({ length: 8 }).map((_, i) => (
                                <tr key={i} className={`border-l-[3px] border-l-transparent ${i > 0 ? tk.rowBorder : ''}`}>
                                    <td className="px-4 py-3.5">
                                        <div className="space-y-2">
                                            <div className={`h-[13px] rounded-full animate-pulse ${tk.skeleton}`} style={{ width: `${140 + (i * 23) % 60}px` }} />
                                            <div className={`h-2.5 rounded-full animate-pulse ${tk.skeleton}`} style={{ width: `${60 + (i * 17) % 40}px` }} />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 hidden sm:table-cell"><div className={`h-4 w-16 rounded-full animate-pulse ml-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5 hidden sm:table-cell"><div className={`h-4 w-20 rounded-full animate-pulse ml-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5 hidden md:table-cell"><div className={`h-6 w-24 rounded-full animate-pulse mx-auto ${tk.skeleton}`} /></td>
                                    <td className="px-4 py-3.5"><div className={`h-5 w-32 rounded-full animate-pulse ${tk.skeleton}`} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filtered.length === 0 ? (
                /* Empty state */
                <div className={`rounded-2xl border py-20 text-center ${tk.emptyBg}`}>
                    <Package size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium text-slate-400">
                        {data.length === 0
                            ? `¡Todos los productos tienen ventas en ${ERP_NAMES[selectedErp]}!`
                            : 'Sin productos con ese filtro'}
                    </p>
                    {data.length > 0 && filterMode !== 'todos' && (
                        <button onClick={() => setFilterMode('todos')}
                            className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">
                            Ver todos
                        </button>
                    )}
                </div>
            ) : (
                /* Data table */
                <div className={`rounded-2xl border overflow-hidden ${tk.card}`}>
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">
                            <thead className={`sticky top-0 z-10 ${tk.thead}`}>
                                <tr>
                                    <th className="px-4 py-3.5 text-left   text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Producto</th>
                                    <th className="px-4 py-3.5 text-right  text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap hidden sm:table-cell">Stock aquí</th>
                                    <th className="px-4 py-3.5 text-right  text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap hidden sm:table-cell">Costo retenido</th>
                                    <th className="px-4 py-3.5 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap hidden md:table-cell">Sugerencia</th>
                                    <th className="px-4 py-3.5 text-left   text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Vendido en (últimos 6m)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.map((row) => {
                                    const stock     = Number(row.current_stock);
                                    const cost      = Number(row.cost_value || 0);
                                    const soldIn    = row.sold_in || [];
                                    const hasStock  = stock > 0;
                                    const noHistory = soldIn.length === 0;
                                    const sug       = hasStock ? getSuggestion(row) : null;
                                    return (
                                        <tr key={row.erp_product_id}
                                            style={{ borderLeftColor: hasStock ? '#f97316' : 'transparent' }}
                                            className={`border-l-[3px] ${tk.rowBorder} ${tk.rowHover} transition-colors ${hasStock ? 'bg-orange-50/20' : ''}`}>

                                            {/* Producto */}
                                            <td className="px-4 py-3.5">
                                                <div className="min-w-0">
                                                    <span className="text-[13.5px] font-semibold text-slate-800 block truncate leading-snug max-w-[300px]">
                                                        {row.product_name || '—'}
                                                    </span>
                                                    {row.fecha_vencimiento_min && (
                                                        <span className="text-[9px] text-slate-400 mt-0.5 block">
                                                            Vence: {new Date(row.fecha_vencimiento_min).toLocaleDateString('es-SV', { day:'numeric', month:'short', year:'numeric' })}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Stock */}
                                            <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                {hasStock ? (
                                                    <>
                                                        <span className="text-[13px] font-bold text-orange-600 tabular-nums">{stock.toLocaleString()}</span>
                                                        <span className="text-[10px] text-orange-400 ml-1">und</span>
                                                    </>
                                                ) : (
                                                    <span className="text-[11px] text-slate-200">—</span>
                                                )}
                                            </td>

                                            {/* Costo retenido */}
                                            <td className="px-4 py-3.5 text-right whitespace-nowrap hidden sm:table-cell">
                                                {cost > 0 ? (
                                                    <span className="text-[12px] font-bold text-orange-700 tabular-nums">{fmtMoney(cost)}</span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-200">—</span>
                                                )}
                                            </td>

                                            {/* Sugerencia */}
                                            <td className="px-4 py-3.5 text-center hidden md:table-cell">
                                                {sug ? (
                                                    <span title={sug.detail}
                                                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border cursor-default ${sug.cls}`}>
                                                        <sug.icon size={9} className="shrink-0" />
                                                        <span className="truncate max-w-[110px]">{sug.label}</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-200">—</span>
                                                )}
                                            </td>

                                            {/* Vendido en */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {noHistory ? (
                                                        <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full italic">
                                                            Sin historial
                                                        </span>
                                                    ) : soldIn.map(s => (
                                                        <span key={s.esid}
                                                            title={`$${Number(s.rev).toLocaleString('en-US', { maximumFractionDigits: 0 })} en ingresos`}
                                                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-default ${SUC_COLORS[s.esid] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                            {ERP_NAMES[s.esid] || `Suc.${s.esid}`}
                                                            <span className="opacity-50 font-normal">·</span>
                                                            <span className="tabular-nums opacity-80">{Number(s.units).toLocaleString()}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Pagination — identical structure to TabCatalogo ── */}
            {!loading && filtered.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {PAGE_SIZES.map(size => (
                            <button key={size}
                                onClick={() => { setPageSize(size); setPage(1); }}
                                className={`px-3 h-7 rounded-full text-[10px] font-bold transition-all border ${
                                    pageSize === size ? tk.pageSizeActive : tk.pageSizeInactive
                                }`}>
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
