import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    TrendingUp, TrendingDown, Users, Package, FileText,
    Clock, Building2, Loader2, ChevronDown,
    ChevronUp, Search, X, Trophy, Star, ChevronRight, ChevronLeft,
    ArrowUp, ArrowDown, Minus, Info, ChevronsUpDown
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';
import PeriodPicker from '../components/common/PeriodPicker';

// ─── Constants ────────────────────────────────────────────────────────────────
const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const PAGE_SIZE = 50;

const fmt    = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) => parseInt(n || 0).toLocaleString('en-US');
const fmtPct = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

const CANCELLED_ESTADOS = ['NULA', 'DTE INVALIDADO EN MH'];

function fmtQty(n) {
    const f = parseFloat(n || 0);
    return f % 1 === 0 ? String(f) : f.toFixed(3).replace(/\.?0+$/, '');
}

function currentMonthRange() {
    const now = new Date(Date.now() - 6 * 3600_000);
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const pad = (n) => String(n).padStart(2, '0');
    const lastDay = new Date(y, m, 0).getDate();
    return { fini: `${y}-${pad(m)}-01`, ffin: `${y}-${pad(m)}-${pad(lastDay)}`, label: `${y}-${pad(m)}` };
}

function monthOptions(count = 12) {
    const opts = [];
    const now = new Date(Date.now() - 6 * 3600_000);
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const pad = (n) => String(n).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();
        const label = d.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
        opts.push({
            value: `${y}-${pad(m)}-01|${y}-${pad(m)}-${pad(lastDay)}`,
            label: label.charAt(0).toUpperCase() + label.slice(1),
        });
    }
    return opts;
}

function computePrevRange(fini, ffin) {
    const s = new Date(fini + 'T12:00:00');
    const numDays = Math.round((new Date(ffin + 'T12:00:00') - s) / 86400000) + 1;
    const prevEnd = new Date(s); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(s); prevStart.setDate(prevStart.getDate() - numDays);
    const toStr = d => d.toISOString().split('T')[0];
    return { prevFini: toStr(prevStart), prevFfin: toStr(prevEnd) };
}

function fmtShort(dateStr) {
    if (!dateStr) return '';
    const [, m, d] = dateStr.split('-');
    return `${parseInt(d)}/${parseInt(m)}`;
}

const PAGE_SIZE_OPTIONS = [
    { value: '25',  label: '25 filas' },
    { value: '50',  label: '50 filas' },
    { value: '100', label: '100 filas' },
];

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
        <div className="flex items-center gap-1.5 py-2">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                <ChevronLeft size={12} strokeWidth={2.5} /> Ant.
            </button>
            <div className="flex items-center gap-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <span key={`e${i}`} className="w-6 text-center text-slate-300 text-[12px] font-bold select-none">·</span>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-full text-[12px] font-black transition-all duration-200 ${
                                p === page
                                    ? 'bg-[#007AFF] text-white shadow-md shadow-blue-200 scale-110'
                                    : 'text-slate-500 hover:bg-white hover:border hover:border-slate-200 hover:shadow-sm hover:text-slate-800'
                            }`}>{p}</button>
                )}
            </div>
            <button disabled={page >= total} onClick={() => onChange(page + 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                Sig. <ChevronRight size={12} strokeWidth={2.5} />
            </button>
        </div>
    );
}

// Stat card with % change vs previous period + optional sub label
function StatCard({ label, value, pct, sub, icon: Icon, grad, text, onClick, active }) {
    const isFilter = !!onClick;
    return (
        <div
            onClick={onClick}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border select-none transition-all
                ${isFilter ? 'cursor-pointer hover:shadow-md' : 'cursor-default bg-white'}
                ${active
                    ? 'border-amber-400 ring-2 ring-amber-200 shadow-md bg-amber-50'
                    : isFilter
                        ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50'
                        : 'border-slate-100 bg-white'
                }`}
        >
            <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                <Icon size={11} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none mb-0.5">{label}</span>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className={`text-[15px] font-black leading-none ${text}`}>{value}</span>
                    {pct !== null && pct !== undefined && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-black ${pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {pct >= 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                            {Math.abs(pct).toFixed(1)}%
                        </span>
                    )}
                </div>
                {sub && <span className="text-[9px] text-slate-400 font-medium leading-none mt-0.5">{sub}</span>}
            </div>
            {isFilter && !active && <ChevronDown size={11} className="text-amber-400 ml-0.5 shrink-0" />}
            {active && <X size={11} className="text-amber-500 ml-0.5 shrink-0" />}
        </div>
    );
}

// Sortable column header button
function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
    const active = sortCol === col;
    return (
        <th className={`px-4 py-3 select-none ${className}`}>
            <button onClick={() => onSort(col)}
                className="flex items-center gap-1 group text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors">
                {label}
                {active
                    ? sortDir === 'asc'
                        ? <ChevronUp size={10} className="text-[#007AFF]" />
                        : <ChevronDown size={10} className="text-[#007AFF]" />
                    : <ChevronsUpDown size={10} className="opacity-25 group-hover:opacity-60" />
                }
            </button>
        </th>
    );
}

// ─── Tab: Ventas ──────────────────────────────────────────────────────────────
function TabVentas({ branches, filterBranch, searchTerm, monthRange, employees }) {
    const [rows, setRows]             = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [totalAmount, setTotalAmount] = useState(0);
    const [totalPuntos, setTotalPuntos] = useState(0);
    const [filterPuntos, setFilterPuntos] = useState(false);
    const [puntosCount, setPuntosCount] = useState(0);
    const [prevStats, setPrevStats]   = useState({ count: 0, sum: 0 });
    const [page, setPage]             = useState(1);
    const [pageSize, setPageSize]     = useState(50);
    const [sortCol, setSortCol]       = useState('fecha');
    const [sortDir, setSortDir]       = useState('desc');
    const [expandedId, setExpandedId] = useState(null);
    const [itemsCache, setItemsCache] = useState({});
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingItems, setLoadingItems] = useState(false);
    const [loadingRows, setLoadingRows]   = useState(true);

    const [fini, ffin] = monthRange.split('|');
    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;
    const isSearching = searchTerm?.trim().length > 0;

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(e.code, e));
        return m;
    }, [employees]);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
        setPage(1);
    };

    const prevMonthRange = useMemo(() => computePrevRange(fini, ffin), [fini, ffin]);

    // Stats: current + same days last month for % change
    const fetchStats = useCallback(async () => {
        setLoadingStats(true);
        const isCurrentMonth = fini === currentMonthRange().fini;
        const branchId = filterBranch ? Number(filterBranch) : -1;
        const branchFilter = filterBranch ? Number(filterBranch) : null;
        const { prevFini, prevFfin } = prevMonthRange;

        const [cur, prev, puntosCur, puntosPrev] = await Promise.all([
            isCurrentMonth
                ? supabase.rpc('get_ventas_stats', { p_fini: fini, p_ffin: ffin, p_branch_id: branchFilter })
                : supabase.from('ventas_monthly_stats').select('total_count, total_sum')
                    .eq('mes', fini).eq('branch_id', branchId).eq('cod_vendedor', '').single(),
            supabase.rpc('get_ventas_stats', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter }),
            supabase.rpc('get_puntos_canjeados', { p_fini: fini,    p_ffin: ffin,    p_branch_id: branchFilter }),
            supabase.rpc('get_puntos_canjeados', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter }),
        ]);

        const s    = isCurrentMonth ? (cur.data?.[0] || {}) : (cur.data || {});
        const prevS = prev.data?.[0] || {};
        setTotalCount(parseInt(s.total_count || 0));
        setTotalAmount(parseFloat(s.total_sum || 0));
        setTotalPuntos(parseFloat(puntosCur.data || 0));
        setPrevStats({
            count:  parseInt(prevS.total_count || 0),
            sum:    parseFloat(prevS.total_sum || 0),
            puntos: parseFloat(puntosPrev.data || 0),
        });
        setLoadingStats(false);
    }, [fini, ffin, filterBranch, prevMonthRange]);

    // 6-month history for tooltip

    // Rows: paginado con sort o búsqueda en BD sin paginación
    const fetchRows = useCallback(async () => {
        setLoadingRows(true);
        let fetched = [];

        if (filterPuntos && !isSearching) {
            const { data } = await supabase.rpc('get_ventas_con_puntos', {
                p_fini:      fini,
                p_ffin:      ffin,
                p_branch_id: filterBranch ? Number(filterBranch) : null,
                p_offset:    (page - 1) * pageSize,
                p_limit:     pageSize,
                p_sort_col:  sortCol,
                p_sort_dir:  sortDir,
            });
            fetched = data || [];
            setPuntosCount(fetched.length > 0 ? Number(fetched[0].total_count) : 0);
        } else {
            const asc = sortDir === 'asc';
            let q = supabase
                .from('sales_invoices')
                .select('id, branch_id, erp_invoice_id, correlativo, tipo_documento, fecha, hora, cliente, cod_vendedor, tipo_pago, subtotal, iva, total, estado')
                .gte('fecha', fini).lte('fecha', ffin)
                .order(sortCol, { ascending: asc });
            if (sortCol === 'fecha') q = q.order('hora', { ascending: asc });
            if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
            if (isSearching) {
                const s = searchTerm.trim();
                q = q.or(`erp_invoice_id.ilike.%${s}%,correlativo.ilike.%${s}%,cliente.ilike.%${s}%`).limit(200);
            } else {
                q = q.range((page - 1) * pageSize, page * pageSize - 1);
            }
            const { data } = await q;
            fetched = data || [];
        }

        setRows(fetched);
        setLoadingRows(false);

        // Prefetch items for visible rows in background
        const uncached = fetched.map(r => r.id).filter(id => !itemsCache[id]);
        if (uncached.length > 0) {
            supabase.from('sales_invoice_items')
                .select('invoice_id, erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea')
                .in('invoice_id', uncached)
                .order('total_linea', { ascending: false })
                .then(({ data: items }) => {
                    if (!items) return;
                    const grouped = {};
                    for (const it of items) {
                        if (!grouped[it.invoice_id]) grouped[it.invoice_id] = [];
                        grouped[it.invoice_id].push(it);
                    }
                    setItemsCache(prev => ({ ...prev, ...grouped }));
                });
        }
    }, [fini, ffin, filterBranch, filterPuntos, page, pageSize, sortCol, sortDir, isSearching, searchTerm]);

    useEffect(() => { fetchStats(); }, [fetchStats]);
    useEffect(() => { fetchRows(); }, [fetchRows]);
    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch, filterPuntos, isSearching, pageSize]);

    const toggleRow = useCallback(async (invoiceId) => {
        if (expandedId === invoiceId) { setExpandedId(null); return; }
        setExpandedId(invoiceId);
        if (itemsCache[invoiceId]) return;
        setLoadingItems(true);
        const { data } = await supabase
            .from('sales_invoice_items')
            .select('erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea')
            .eq('invoice_id', invoiceId)
            .order('total_linea', { ascending: false });
        setItemsCache(prev => ({ ...prev, [invoiceId]: data || [] }));
        setLoadingItems(false);
    }, [expandedId, itemsCache]);

    const totalPages = isSearching ? 1 : Math.ceil((filterPuntos ? puntosCount : totalCount) / pageSize);
    const avgTicket  = totalCount > 0 ? totalAmount / totalCount : 0;

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Stats strip */}
            <div className="flex items-center gap-2 flex-wrap">
                {loadingStats ? (
                    [120, 160, 140, 150].map(w => (
                        <div key={w} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-white">
                            <div className="w-6 h-6 rounded-lg bg-slate-200 animate-pulse shrink-0" />
                            <div className={`h-3 rounded-full bg-slate-200 animate-pulse`} style={{ width: w * 0.45 }} />
                            <div className={`h-4 rounded-full bg-slate-200 animate-pulse`} style={{ width: w * 0.55 }} />
                        </div>
                    ))
                ) : (() => {
                    const pctCount  = prevStats.count  > 0 ? ((totalCount  - prevStats.count)  / prevStats.count)  * 100 : null;
                    const pctSum    = prevStats.sum    > 0 ? ((totalAmount  - prevStats.sum)    / prevStats.sum)    * 100 : null;
                    const pctAvg    = prevStats.sum > 0 && prevStats.count > 0
                        ? (((totalAmount/totalCount) - (prevStats.sum/prevStats.count)) / (prevStats.sum/prevStats.count)) * 100 : null;
                    const pctPuntos = prevStats.puntos > 0 ? ((totalPuntos  - prevStats.puntos) / prevStats.puntos) * 100 : null;
                    return [
                        { label: 'Facturas',       value: fmtNum(totalCount), pct: pctCount,  icon: FileText,   grad: 'from-blue-500 to-indigo-500',  text: 'text-blue-700',    sub: prevStats.count  ? `${fmtNum(prevStats.count)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Total Ventas',   value: fmt(totalAmount),   pct: pctSum,    icon: TrendingUp, grad: 'from-emerald-500 to-teal-400', text: 'text-emerald-700', sub: prevStats.sum    ? `${fmt(prevStats.sum)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Ticket Prom.',   value: fmt(avgTicket),     pct: pctAvg,    icon: TrendingUp, grad: 'from-slate-500 to-slate-400',  text: 'text-slate-700',   sub: prevStats.sum && prevStats.count ? `${fmt(prevStats.sum/prevStats.count)}` : undefined },
                        { label: 'Pts. Canjeados', value: fmt(totalPuntos),   pct: pctPuntos, icon: Star,       grad: 'from-amber-500 to-orange-400', text: 'text-amber-700',   sub: prevStats.puntos ? `${fmt(prevStats.puntos)}` : undefined, onClick: () => setFilterPuntos(v => !v), active: filterPuntos },
                    ].map(card => <StatCard key={card.label} {...card} />);
                })()}
            </div>

            {loadingRows && rows.length === 0 ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <tbody>
                            {Array.from({ length: 10 }).map((_, i) => (
                                <tr key={i} className="border-b border-slate-50 last:border-0">
                                    <td className="px-4 py-3"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden sm:table-cell"><div className="h-3 w-12 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3"><div className="h-3 w-32 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden sm:table-cell"><div className="h-3 w-16 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 text-right"><div className="h-3 w-16 rounded-full bg-slate-100 animate-pulse ml-auto" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : !loadingRows && rows.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <TrendingUp size={40} className="mx-auto mb-3" />
                    <p className="font-medium">{isSearching ? 'Sin resultados para esa búsqueda' : 'Sin ventas para este período'}</p>
                </div>
            ) : (
                <>
                    <div className={`rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm transition-opacity duration-150 ${loadingRows ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-gradient-to-b from-white/95 to-white/80 backdrop-blur-xl border-b border-white/60 shadow-[0_1px_0_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.04)]">
                                    <SortTh label="Fecha"       col="fecha"          sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left py-3.5" />
                                    <SortTh label="ID"          col="correlativo"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left hidden md:table-cell py-3.5" />
                                    <SortTh label="Tipo"        col="tipo_documento" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left hidden sm:table-cell py-3.5" />
                                    <SortTh label="Sucursal"    col="branch_id"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left hidden lg:table-cell py-3.5" />
                                    <SortTh label="Vendedor"    col="cod_vendedor"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left hidden md:table-cell py-3.5" />
                                    <SortTh label="Cliente"     col="cliente"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left py-3.5" />
                                    <SortTh label="Método pago" col="tipo_pago"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left hidden sm:table-cell py-3.5" />
                                    <SortTh label="Total"       col="total"          sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right py-3.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => {
                                    const isCancelled = CANCELLED_ESTADOS.includes(r.estado);
                                    const isCCF = r.tipo_documento === 'CCF' || r.tipo_documento === 'COF';
                                    const isExpanded = expandedId === r.id;
                                    const cachedItems = itemsCache[r.id];
                                    const noData = cachedItems && cachedItems.length === 0;
                                    const emp = empMap.get(r.cod_vendedor);
                                    const tipoBadgeColor = r.tipo_documento === 'CCF'
                                        ? 'bg-red-50 text-red-600'
                                        : r.tipo_documento === 'FCF'
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'bg-slate-100 text-slate-500';
                                    return (
                                        <React.Fragment key={r.id}>
                                            <tr onClick={() => toggleRow(r.id)}
                                                className={`border-t border-black/[0.04] cursor-pointer transition-colors ${isCancelled ? 'opacity-50 bg-red-50/30 hover:bg-red-50/50' : isExpanded ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'}`}>
                                                {/* Fecha */}
                                                <td className="px-4 py-2.5">
                                                    <p className={`text-[12px] font-bold text-slate-700 ${isCancelled ? 'line-through' : ''}`}>{r.fecha}</p>
                                                    {r.hora && <p className="text-[10px] text-slate-400">{r.hora?.slice(0, 5)}</p>}
                                                    {isCancelled && <span className="text-[8px] font-black uppercase tracking-widest text-red-400">ANULADA</span>}
                                                </td>
                                                {/* ID */}
                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    {r.erp_invoice_id && <p className={`font-mono text-[11px] font-black text-slate-500 ${isCancelled ? 'line-through' : ''}`}>#{r.erp_invoice_id}</p>}
                                                    <p className="font-mono text-[10px] text-slate-400">{r.correlativo}</p>
                                                </td>
                                                {/* Tipo documento */}
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    {r.tipo_documento
                                                        ? <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${tipoBadgeColor}`}>{r.tipo_documento}</span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>
                                                {/* Sucursal */}
                                                <td className="px-4 py-2.5 hidden lg:table-cell">
                                                    <span className="text-[11px] text-slate-600">{getBranch(r.branch_id)}</span>
                                                </td>
                                                {/* Vendedor */}
                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    <div className="flex items-center gap-2">
                                                        {emp ? (
                                                            <LiquidAvatar src={emp.photo_url || emp.photo} fallbackText={emp.first_names}
                                                                className="w-6 h-6 rounded-full shrink-0" />
                                                        ) : (
                                                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                                <Users size={11} className="text-slate-400" />
                                                            </div>
                                                        )}
                                                        <span className="text-[11px] text-slate-600 truncate max-w-[100px]">
                                                            {emp ? emp.first_names : (r.cod_vendedor || '—')}
                                                        </span>
                                                    </div>
                                                </td>
                                                {/* Cliente */}
                                                <td className="px-4 py-2.5">
                                                    <p className="text-[12px] text-slate-700 truncate max-w-[160px]">{r.cliente || '—'}</p>
                                                </td>
                                                {/* Método pago */}
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    {r.tipo_pago
                                                        ? <span className="text-[11px] text-slate-600 font-medium">{r.tipo_pago}</span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>
                                                {/* Total */}
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <p className={`text-[13px] font-black ${isCancelled ? 'line-through text-slate-400' : isCCF ? 'text-red-700' : 'text-slate-800'}`}>{fmt(r.total)}</p>
                                                        <ChevronDown size={12}
                                                            className={`transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-blue-400' : noData ? 'text-slate-200' : 'text-slate-400'}`} />
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="border-t border-blue-100/60">
                                                    <td colSpan={8} className="px-5 py-4 bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 backdrop-blur-sm">
                                                        {loadingItems && !cachedItems ? (
                                                            <div className="flex items-center gap-2 text-[11px] text-slate-400 py-1">
                                                                <Loader2 size={12} className="animate-spin text-blue-400" /> Cargando productos...
                                                            </div>
                                                        ) : noData ? (
                                                            <div className="flex items-center gap-2 text-[11px] text-slate-400 py-1">
                                                                <Info size={12} className="text-slate-300 shrink-0" />
                                                                Esta sucursal no tiene detalle de productos sincronizado desde el ERP.
                                                            </div>
                                                        ) : (
                                                            (() => {
                                                                // Deduplicate: exact same (erp_product_id/descripcion, presentacion, precio_unitario, total_linea) → keep one
                                                                const seen = new Set();
                                                                const deduped = (cachedItems || []).filter(it => {
                                                                    const sig = `${it.erp_product_id ?? it.descripcion}|${it.presentacion ?? ''}|${it.precio_unitario}|${it.total_linea}`;
                                                                    if (seen.has(sig)) return false;
                                                                    seen.add(sig);
                                                                    return true;
                                                                });
                                                                // Discount items (ERP id=-999 = DESCPUNTO)
                                                                const discountItems = deduped.filter(it => it.erp_product_id === -999);
                                                                const regularItems  = deduped.filter(it => it.erp_product_id !== -999 && it.descripcion);
                                                                const discountAmt   = discountItems.reduce((s, it) => s + Math.abs(parseFloat(it.total_linea || 0)), 0);
                                                                // Arithmetic fallback: if no discount item found but sum > total
                                                                const regularSum = regularItems.reduce((s, it) => s + parseFloat(it.total_linea || 0), 0);
                                                                const arithmeticDiscount = regularSum - parseFloat(r.total || 0);
                                                                const finalDiscount = discountItems.length > 0 ? discountAmt : (arithmeticDiscount > 0.01 ? arithmeticDiscount : 0);
                                                                return (
                                                                    <table className="w-full text-[11px]">
                                                                        <thead>
                                                                            <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                                                                                <th className="text-left pb-2">Producto</th>
                                                                                <th className="text-right pb-2">Cant.</th>
                                                                                <th className="text-right pb-2 hidden sm:table-cell">Precio Unit.</th>
                                                                                <th className="text-right pb-2">Total</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-100/60">
                                                                            {regularItems.map((it, idx) => (
                                                                                <tr key={idx} className="hover:bg-white/50 transition-colors">
                                                                                    <td className="py-2 pr-4">
                                                                                        <p className="font-semibold text-slate-700 leading-tight">{it.descripcion}</p>
                                                                                        {it.presentacion && <p className="text-[10px] text-slate-400 mt-0.5">{it.presentacion}</p>}
                                                                                    </td>
                                                                                    <td className="py-2 text-right font-bold text-slate-600">{fmtQty(it.cantidad)}</td>
                                                                                    <td className="py-2 text-right text-slate-500 hidden sm:table-cell">{fmt(it.precio_unitario)}</td>
                                                                                    <td className="py-2 text-right font-black text-slate-700">{fmt(it.total_linea)}</td>
                                                                                </tr>
                                                                            ))}
                                                                            {finalDiscount > 0 && (
                                                                                <tr className="bg-amber-50/60 hover:bg-amber-50 transition-colors">
                                                                                    <td className="py-2 pr-4" colSpan={2}>
                                                                                        <div className="flex items-center gap-1.5">
                                                                                            <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md">PUNTOS</span>
                                                                                            <p className="font-semibold text-amber-700 leading-tight">Descuento por puntos</p>
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className="py-2 text-right text-amber-500 hidden sm:table-cell">—</td>
                                                                                    <td className="py-2 text-right font-black text-amber-600">-{fmt(finalDiscount)}</td>
                                                                                </tr>
                                                                            )}
                                                                        </tbody>
                                                                    </table>
                                                                );
                                                            })()
                                                        )}
                                                        {/* IVA breakdown for CCF/COF */}
                                                        {(r.tipo_documento === 'CCF' || r.tipo_documento === 'COF') && r.subtotal != null && (
                                                            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                                                                <div className="flex flex-col gap-0.5 min-w-[180px]">
                                                                    <div className="flex justify-between gap-6 text-[11px] text-slate-500">
                                                                        <span>Subtotal (sin IVA)</span>
                                                                        <span className="font-semibold text-slate-700">{fmt(r.subtotal)}</span>
                                                                    </div>
                                                                    <div className="flex justify-between gap-6 text-[11px] text-slate-500">
                                                                        <span>IVA (13%)</span>
                                                                        <span className="font-semibold text-slate-700">{fmt(r.iva)}</span>
                                                                    </div>
                                                                    <div className="flex justify-between gap-6 text-[12px] font-black text-slate-800 border-t border-slate-200 pt-1 mt-0.5">
                                                                        <span>Total</span>
                                                                        <span>{fmt(r.total)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1 border-t border-black/[0.04] bg-slate-50/50">
                        <div className="w-[130px]">
                            <LiquidSelect value={String(pageSize)}
                                onChange={v => { setPageSize(Number(v)); setPage(1); }}
                                options={PAGE_SIZE_OPTIONS} clearable={false} compact />
                        </div>
                        <SmartPagination page={page} total={totalPages} onChange={setPage} />
                        <span className="text-[10px] text-slate-400 font-semibold w-[130px] text-right">
                            {isSearching ? `${rows.length} resultados` : `${fmtNum(totalCount)} total`}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, employees, searchTerm, monthRange }) {
    const [rows, setRows]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [expanded, setExpanded]       = useState(null);
    const [expandedData, setExpandedData] = useState([]);
    const [loadingExpand, setLoadingExpand] = useState(false);
    const [prevRankMap, setPrevRankMap]     = useState(new Map());
    const [prevVendStats, setPrevVendStats] = useState({ sum: 0, count: 0 });

    const [fini, ffin] = monthRange.split('|');

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(e.code, e));
        return m;
    }, [employees]);

    const fetchVendedores = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase.rpc('get_vendedores_resumen', {
            p_fini: fini, p_ffin: ffin,
            p_branch_id: filterBranch ? Number(filterBranch) : null,
        });
        setRows((data || []).map(r => ({
            branch_id: r.branch_id,
            cod_vendedor: r.cod_vendedor,
            total: parseFloat(r.total_ventas || 0),
            count: parseInt(r.total_facturas || 0),
        })));
        setLoading(false);
    }, [fini, ffin, filterBranch]);

    useEffect(() => { fetchVendedores(); }, [fetchVendedores]);

    useEffect(() => {
        const { prevFini, prevFfin } = computePrevRange(fini, ffin);
        supabase.rpc('get_ventas_stats', {
            p_fini: prevFini, p_ffin: prevFfin,
            p_branch_id: filterBranch ? Number(filterBranch) : null,
        }).then(({ data }) => {
            const s = data?.[0] || {};
            setPrevVendStats({ sum: parseFloat(s.total_sum || 0), count: parseInt(s.total_count || 0) });
        });
    }, [fini, ffin, filterBranch]);

    // Carga ranking del mes anterior para flechas de tendencia
    useEffect(() => {
        const d = new Date(fini + 'T12:00');
        d.setMonth(d.getMonth() - 1);
        const prevMes = d.toISOString().split('T')[0].slice(0, 7) + '-01';
        const branchId = filterBranch ? Number(filterBranch) : -1;
        const SKIP = new Set(['1000', '125']);
        supabase.from('ventas_monthly_stats')
            .select('cod_vendedor, total_sum')
            .eq('mes', prevMes).eq('branch_id', branchId).neq('cod_vendedor', '')
            .then(({ data }) => {
                const byVend = new Map();
                for (const r of (data || [])) {
                    const cur = byVend.get(r.cod_vendedor) || { cod_vendedor: r.cod_vendedor, total: 0 };
                    cur.total += parseFloat(r.total_sum || 0);
                    byVend.set(r.cod_vendedor, cur);
                }
                const ranked = [...byVend.values()]
                    .filter(v => !SKIP.has(v.cod_vendedor))
                    .sort((a, b) => b.total - a.total);
                const m = new Map();
                ranked.forEach((v, i) => m.set(v.cod_vendedor, i + 1));
                setPrevRankMap(m);
            });
    }, [fini, filterBranch]);

    const toggleExpand = async (cod) => {
        if (expanded === cod) { setExpanded(null); return; }
        setExpanded(cod);
        setLoadingExpand(true);
        const { data } = await supabase.rpc('get_vendedor_diario', {
            p_cod_vendedor: cod, p_fini: fini, p_ffin: ffin,
        });
        const byDate = new Map();
        for (const d of (data || [])) {
            const cur = byDate.get(d.fecha) || { fecha: d.fecha, total: 0, count: 0, branches: [] };
            cur.total += parseFloat(d.total_ventas || 0);
            cur.count += parseInt(d.total_facturas || 0);
            cur.branches.push({ branch_id: d.branch_id, total: parseFloat(d.total_ventas || 0) });
            byDate.set(d.fecha, cur);
        }
        setExpandedData([...byDate.values()]);
        setLoadingExpand(false);
    };

    const getBranchName = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;
    const SPECIAL_CODES = { '1000': 'Administración', '125': 'Domicilio' };

    const { knownRows, unknownByBranch } = useMemo(() => {
        const s = searchTerm.toLowerCase();
        const consolidatedMap = new Map();
        const unknownMap = new Map();
        for (const r of rows) {
            const emp = empMap.get(r.cod_vendedor);
            const specialName = SPECIAL_CODES[r.cod_vendedor];
            if (emp || specialName) {
                const cur = consolidatedMap.get(r.cod_vendedor) || {
                    cod_vendedor: r.cod_vendedor, total: 0, count: 0, branchIds: [],
                    emp: emp || null, specialName: specialName || null,
                };
                cur.total += r.total;
                cur.count += r.count;
                if (!cur.branchIds.includes(r.branch_id)) cur.branchIds.push(r.branch_id);
                consolidatedMap.set(r.cod_vendedor, cur);
            } else {
                const cur = unknownMap.get(r.branch_id) || { branch_id: r.branch_id, total: 0, count: 0 };
                cur.total += r.total;
                cur.count += r.count;
                unknownMap.set(r.branch_id, cur);
            }
        }
        const known = [...consolidatedMap.values()]
            .sort((a, b) => b.total - a.total)
            .filter(r => {
                if (!s) return true;
                const name = r.specialName || (r.emp ? `${r.emp.first_names} ${r.emp.last_names}` : '');
                return name.toLowerCase().includes(s) || r.cod_vendedor?.toLowerCase().includes(s);
            });
        return { knownRows: known, unknownByBranch: unknownMap };
    }, [rows, searchTerm, empMap]);

    const totalVentas   = rows.reduce((s, r) => s + r.total, 0);
    const totalFacturas = rows.reduce((s, r) => s + r.count, 0);

    const TrendBadge = ({ cod, currentRank }) => {
        const prev = prevRankMap.get(cod);
        if (prev == null) return null;
        const diff = prev - currentRank;
        if (diff === 0) return <Minus size={12} className="text-slate-400" />;
        if (diff > 0) return (
            <span className="flex items-center gap-0.5 text-emerald-600 text-[10px] font-black">
                <ArrowUp size={10} />{diff}
            </span>
        );
        return (
            <span className="flex items-center gap-0.5 text-red-500 text-[10px] font-black">
                <ArrowDown size={10} />{Math.abs(diff)}
            </span>
        );
    };

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats */}
            <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const periodLabel = `${fmtShort(prevFini)}→${fmtShort(prevFfin)}`;
                    const pctSum   = prevVendStats.sum   > 0 ? ((totalVentas   - prevVendStats.sum)   / prevVendStats.sum)   * 100 : null;
                    const pctCount = prevVendStats.count > 0 ? ((totalFacturas - prevVendStats.count) / prevVendStats.count) * 100 : null;
                    return [
                        { label: 'Vendedores',   value: knownRows.length,      icon: Users,      grad: 'from-blue-500 to-indigo-500',  text: 'text-blue-700',    pct: null,     sub: undefined },
                        { label: 'Total Ventas', value: fmt(totalVentas),       icon: TrendingUp, grad: 'from-emerald-500 to-teal-400', text: 'text-emerald-700', pct: pctSum,   sub: prevVendStats.sum   > 0 ? `${fmt(prevVendStats.sum)} · ${periodLabel}`   : undefined },
                        { label: 'Facturas',     value: fmtNum(totalFacturas),  icon: FileText,   grad: 'from-slate-500 to-slate-400',  text: 'text-slate-700',   pct: pctCount, sub: prevVendStats.count > 0 ? `${fmtNum(prevVendStats.count)} · ${periodLabel}` : undefined },
                    ].map(card => <StatCard key={card.label} {...card} />);
                })()}
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-black/[0.06] text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="text-left px-4 py-3 w-10">#</th>
                                <th className="text-left px-4 py-3">Vendedor</th>
                                <th className="text-left px-4 py-3 hidden md:table-cell">Sucursal</th>
                                <th className="text-right px-4 py-3">Facturas</th>
                                <th className="text-right px-4 py-3">Total</th>
                                <th className="text-right px-4 py-3 hidden md:table-cell">Ticket Prom.</th>
                                <th className="px-4 py-3 w-8" />
                            </tr>
                        </thead>
                        <tbody>
                            {knownRows.map((r, i) => {
                                const isOpen   = expanded === r.cod_vendedor;
                                const ticket   = r.count > 0 ? r.total / r.count : 0;
                                const pct      = totalVentas > 0 ? (r.total / totalVentas) * 100 : 0;
                                const baseBranchId = r.emp?.branch_id ?? r.branchIds[0];
                                const displayName  = r.specialName || (r.emp ? `${r.emp.first_names} ${r.emp.last_names}` : r.cod_vendedor);

                                return (
                                    <React.Fragment key={r.cod_vendedor}>
                                        <tr className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
                                            onClick={() => toggleExpand(r.cod_vendedor)}>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1.5">
                                                    {i === 0 ? <Trophy size={15} className="text-yellow-500" />
                                                        : i === 1 ? <Trophy size={15} className="text-slate-400" />
                                                        : i === 2 ? <Trophy size={15} className="text-amber-600" />
                                                        : <span className="text-xs text-slate-400 font-bold w-4 text-center">{i + 1}</span>}
                                                    <TrendBadge cod={r.cod_vendedor} currentRank={i + 1} />
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    {r.emp ? (
                                                        <LiquidAvatar src={r.emp.photo_url || r.emp.photo}
                                                            fallbackText={r.emp.first_names}
                                                            className="w-8 h-8 rounded-full shrink-0" />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                            <Users size={14} className="text-slate-400" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="font-semibold text-slate-800 text-[13px]">{displayName}</p>
                                                        <p className="text-[10px] text-slate-400">Cód. {r.cod_vendedor}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-[12px]">
                                                {getBranchName(baseBranchId)}
                                                {r.branchIds.filter(id => id !== baseBranchId).map(id => (
                                                    <span key={id} className="ml-1 text-[10px] text-orange-500 font-semibold">+{getBranchName(id)}</span>
                                                ))}
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold text-slate-700 text-[12px]">{fmtNum(r.count)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <p className="font-black text-slate-800 text-[13px]">{fmt(r.total)}</p>
                                                <div className="mt-1 h-1 rounded-full bg-slate-100">
                                                    <div className="h-1 rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right hidden md:table-cell text-slate-500 text-[12px]">{fmt(ticket)}</td>
                                            <td className="px-4 py-3">
                                                {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="border-t border-slate-100">
                                                <td colSpan={7} className="px-4 py-3 bg-slate-50/80">
                                                    {loadingExpand ? (
                                                        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
                                                    ) : (
                                                        <div>
                                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Ventas diarias</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {expandedData.map(d => {
                                                                    const cross = d.branches.filter(b => b.branch_id !== baseBranchId);
                                                                    return (
                                                                        <div key={d.fecha} className={`border rounded-xl px-3 py-2 text-xs ${cross.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-200'}`}>
                                                                            <p className="text-slate-500 mb-0.5">{new Date(d.fecha + 'T12:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</p>
                                                                            <p className="font-black text-slate-800">{fmt(d.total)}</p>
                                                                            <p className="text-slate-400">{d.count} fact.</p>
                                                                            {cross.map(b => (
                                                                                <p key={b.branch_id} className="text-orange-500 font-semibold mt-0.5">{getBranchName(b.branch_id)}: {fmt(b.total)}</p>
                                                                            ))}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {[...unknownByBranch.values()].map(u => (
                                <tr key={`u-${u.branch_id}`} className="border-t border-orange-100 bg-orange-50/30">
                                    <td className="px-4 py-3"><span className="text-[10px] text-orange-300 font-bold">—</span></td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                                                <Users size={14} className="text-orange-400" />
                                            </div>
                                            <p className="font-semibold text-orange-600 text-[13px]">Cód. Incorrecto — {getBranchName(u.branch_id)}</p>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-slate-400 text-[12px]">—</td>
                                    <td className="px-4 py-3 text-right text-slate-500 text-[12px]">{fmtNum(u.count)}</td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-600 text-[13px]">{fmt(u.total)}</td>
                                    <td className="px-4 py-3 text-right hidden md:table-cell text-slate-400 text-[12px]">{u.count > 0 ? fmt(u.total / u.count) : '—'}</td>
                                    <td className="px-4 py-3" />
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

        </div>
    );
}

// ─── Tab: Productos ───────────────────────────────────────────────────────────
function TabProductos({ filterBranch, searchTerm, monthRange }) {
    const [rows, setRows]           = useState([]);
    const [loading, setLoading]     = useState(true);
    const [sortCol, setSortCol]     = useState('total');
    const [sortDir, setSortDir]     = useState('desc');
    const [prevProdStats, setPrevProdStats] = useState({ sum: 0 });

    const [fini, ffin] = monthRange.split('|');

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
    };

    const fetchProductos = useCallback(async () => {
        setLoading(true);

        // Get invoice IDs — always query all branches since items only exist for some
        let qInv = supabase
            .from('sales_invoices')
            .select('id')
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")')
            .gte('fecha', fini).lte('fecha', ffin);
        // Note: filterBranch intentionally ignored here — item data only exists for certain branches
        const { data: invoices } = await qInv;
        const ids = (invoices || []).map(i => i.id);
        if (ids.length === 0) { setRows([]); setLoading(false); return; }

        // Fetch items in chunks of 1000, including precio_unitario for cost matching
        const CHUNK = 1000;
        const itemsAll = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
            const { data: items } = await supabase
                .from('sales_invoice_items')
                .select('erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea')
                .in('invoice_id', ids.slice(i, i + CHUNK));
            if (items) itemsAll.push(...items);
        }
        if (itemsAll.length === 0) { setRows([]); setLoading(false); return; }

        // Aggregate by product + presentacion (different presentations = different units)
        const agg = new Map();
        for (const item of itemsAll) {
            const key = `${item.erp_product_id || item.descripcion}||${item.presentacion || ''}`;
            const cur = agg.get(key) || {
                erp_product_id: item.erp_product_id,
                descripcion: item.descripcion,
                presentacion: item.presentacion,
                cantidad: 0,
                total: 0,
                lineas: 0,
                precioProm: 0,
                _precioSum: 0,
            };
            cur.cantidad   += parseFloat(item.cantidad || 0);
            cur.total      += parseFloat(item.total_linea || 0);
            cur.lineas     += 1;
            cur._precioSum += parseFloat(item.precio_unitario || 0);
            agg.set(key, cur);
        }
        for (const v of agg.values()) {
            v.precioProm = v.lineas > 0 ? v._precioSum / v.lineas : 0;
        }

        // Fetch costs from product_precios for all known product IDs
        const productIds = [...agg.values()]
            .map(v => v.erp_product_id)
            .filter(Boolean);
        let costMap = new Map(); // productId -> [{ costo, vineta, id_presentacion }]
        if (productIds.length > 0) {
            const PCHUNK = 500;
            for (let i = 0; i < productIds.length; i += PCHUNK) {
                const { data: precios } = await supabase
                    .from('product_precios')
                    .select('product_id, costo, vineta, id_presentacion')
                    .eq('activo', true)
                    .in('product_id', productIds.slice(i, i + PCHUNK));
                for (const p of (precios || [])) {
                    const arr = costMap.get(p.product_id) || [];
                    arr.push({ costo: parseFloat(p.costo || 0), vineta: parseFloat(p.vineta || 0) });
                    costMap.set(p.product_id, arr);
                }
            }
        }

        // Match cost to each product by finding the vineta closest to avg precio_unitario
        const rows = [...agg.values()].map(v => {
            const precios = costMap.get(v.erp_product_id) || [];
            let costo_unitario = null;
            if (precios.length === 1) {
                costo_unitario = precios[0].costo;
            } else if (precios.length > 1) {
                // Pick the one whose vineta is closest to avg sale price
                const best = precios.reduce((a, b) =>
                    Math.abs(b.vineta - v.precioProm) < Math.abs(a.vineta - v.precioProm) ? b : a
                );
                costo_unitario = best.costo;
            }
            const costo_total = costo_unitario != null ? v.cantidad * costo_unitario : null;
            const utilidad    = costo_total != null ? v.total - costo_total : null;
            const margen      = utilidad != null && v.total > 0 ? (utilidad / v.total) * 100 : null;
            return { ...v, costo_unitario, costo_total, utilidad, margen };
        });

        rows.sort((a, b) => b.total - a.total);
        setRows(rows.slice(0, 100));
        setLoading(false);
    }, [fini, ffin]);

    useEffect(() => { fetchProductos(); }, [fetchProductos]);

    useEffect(() => {
        const { prevFini, prevFfin } = computePrevRange(fini, ffin);
        supabase.rpc('get_ventas_stats', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: null })
            .then(({ data }) => {
                const s = data?.[0] || {};
                setPrevProdStats({ sum: parseFloat(s.total_sum || 0) });
            });
    }, [fini, ffin]);

    const filtered = useMemo(() => {
        let list = rows;
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            list = list.filter(r => r.descripcion?.toLowerCase().includes(s) || r.presentacion?.toLowerCase().includes(s));
        }
        return [...list].sort((a, b) => {
            const asc = sortDir === 'asc' ? 1 : -1;
            const av = a[sortCol] ?? -Infinity;
            const bv = b[sortCol] ?? -Infinity;
            return typeof av === 'string' ? av.localeCompare(bv) * asc : (av - bv) * asc;
        });
    }, [rows, searchTerm, sortCol, sortDir]);

    const maxTotal    = rows[0]?.total || 1;
    const totIngresos = filtered.reduce((s, r) => s + r.total, 0);
    const totUtilidad = filtered.filter(r => r.utilidad != null).reduce((s, r) => s + r.utilidad, 0);
    const totCosto    = filtered.filter(r => r.costo_total != null).reduce((s, r) => s + r.costo_total, 0);
    const margenGlobal = totIngresos > 0 ? (totUtilidad / totIngresos) * 100 : 0;

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats */}
            <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const pctIngresos = prevProdStats.sum > 0 ? ((totIngresos - prevProdStats.sum) / prevProdStats.sum) * 100 : null;
                    return [
                        { label: 'Ingresos', value: fmt(totIngresos),     icon: TrendingUp,   grad: 'from-blue-500 to-indigo-500',   text: 'text-blue-700',    pct: pctIngresos, sub: prevProdStats.sum > 0 ? `${fmt(prevProdStats.sum)} · ${fmtShort(prevFini)}→${fmtShort(prevFfin)}` : undefined },
                        { label: 'Costo',    value: fmt(totCosto),        icon: TrendingDown, grad: 'from-red-500 to-orange-400',    text: 'text-red-700',     pct: null,        sub: undefined },
                        { label: 'Utilidad', value: fmt(totUtilidad),     icon: TrendingUp,   grad: 'from-emerald-500 to-teal-400',  text: 'text-emerald-700', pct: null,        sub: undefined },
                        { label: 'Margen',   value: fmtPct(margenGlobal), icon: Star,         grad: 'from-amber-500 to-yellow-400',  text: 'text-amber-700',   pct: null,        sub: undefined },
                    ].map(card => <StatCard key={card.label} {...card} />);
                })()}
            </div>

            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-blue-700 font-medium">
                <Info size={13} className="text-blue-400 shrink-0" />
                El costo se obtiene de la lista de precios activa más cercana al precio de venta promedio. Solo aplica a sucursales con detalle de productos.
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Package size={40} className="mx-auto mb-3" />
                    <p className="font-medium">Sin datos para este período</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-white/80 backdrop-blur-xl border-b border-black/[0.06]">
                                <th className="text-left px-4 py-3 w-8 text-[10px] font-black uppercase tracking-widest text-slate-500">#</th>
                                <SortTh label="Producto"  col="descripcion" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left" />
                                <SortTh label="Unidades"  col="cantidad"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right hidden md:table-cell" />
                                <SortTh label="Ingresos"  col="total"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                                <SortTh label="Costo Est." col="costo_total" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right hidden lg:table-cell" />
                                <SortTh label="Utilidad"  col="utilidad"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right hidden sm:table-cell" />
                                <SortTh label="Margen"    col="margen"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r, i) => {
                                const pct    = (r.total / maxTotal) * 100;
                                const margin = r.margen;
                                const marginColor = margin == null ? 'text-slate-300'
                                    : margin >= 25 ? 'text-emerald-600'
                                    : margin >= 10 ? 'text-amber-600'
                                    : 'text-red-600';
                                return (
                                    <tr key={r.erp_product_id || i} className="border-t border-black/[0.04] hover:bg-slate-50/60 transition-colors">
                                        <td className="px-4 py-3">
                                            {i === 0 ? <Star size={15} className="text-yellow-500 fill-yellow-400" />
                                                : <span className="text-[11px] text-slate-400 font-bold">{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-3 max-w-[220px]">
                                            <p className="font-semibold text-slate-800 text-[12px] leading-tight">{r.descripcion}</p>
                                            {r.presentacion && <p className="text-[10px] text-slate-400 mt-0.5">{r.presentacion}</p>}
                                            <div className="mt-1.5 h-1 rounded-full bg-slate-100">
                                                <div className="h-1 rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-[12px] font-semibold text-slate-600 hidden md:table-cell">{fmtNum(r.cantidad)}</td>
                                        <td className="px-4 py-3 text-right font-black text-slate-800 text-[13px]">{fmt(r.total)}</td>
                                        <td className="px-4 py-3 text-right text-[12px] text-slate-500 hidden lg:table-cell">
                                            {r.costo_total != null ? fmt(r.costo_total) : <span className="text-slate-200">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right text-[12px] font-bold hidden sm:table-cell">
                                            {r.utilidad != null
                                                ? <span className={r.utilidad >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(r.utilidad)}</span>
                                                : <span className="text-slate-200">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {margin != null
                                                ? <span className={`text-[12px] font-black ${marginColor}`}>{fmtPct(margin)}</span>
                                                : <span className="text-slate-200 text-[12px]">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'ventas',     label: 'Ventas',     icon: FileText },
    { key: 'vendedores', label: 'Vendedores', icon: Users },
    { key: 'productos',  label: 'Productos',  icon: Package },
];

export default function VentasView() {
    const { branches, employees } = useStaff();
    const { user: currentUser }   = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const VALID_TABS = new Set(['ventas', 'vendedores', 'productos']);
    const activeTab = VALID_TABS.has(searchParams.get('tab')) ? searchParams.get('tab') : 'ventas';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });
    const [filterBranch, setFilterBranch] = useState('');
    const [monthRange, setMonthRange]   = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearch, setRawSearch]     = useState('');
    const searchInputRef = useRef(null);

    const salesBranches = useMemo(() =>
        (branches || []).filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const openSearch  = () => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 50); };
    const closeSearch = () => { setIsSearchMode(false); setRawSearch(''); };

    const searchPlaceholder =
        activeTab === 'ventas'     ? 'Buscar correlativo o cliente...' :
        activeTab === 'vendedores' ? 'Buscar vendedor...' :
                                     'Buscar producto...';

    const filtersContent = (
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input ref={searchInputRef} type="text" placeholder={searchPlaceholder}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch} onChange={e => setRawSearch(e.target.value)} />
                {rawSearch && (
                    <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={closeSearch}
                    className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[900px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

                {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button key={tab.key} onClick={() => { setActiveTab(tab.key); closeSearch(); }}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                                activeTab === tab.key
                                    ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                            }`}>
                            <Icon size={12} strokeWidth={2.5} />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    );
                })}

                <div className="h-6 w-px bg-white/40 mx-0.5 shrink-0 hidden sm:block" />

                {/* Quick period tabs */}
                {(() => {
                    const nowMs = Date.now() - 6 * 3600_000;
                    const sv    = new Date(nowMs);
                    const p     = n => String(n).padStart(2, '0');
                    const y = sv.getUTCFullYear(), m = sv.getUTCMonth(), d = sv.getUTCDate();
                    const todayStr  = `${y}-${p(m+1)}-${p(d)}`;
                    const dFromMon  = (sv.getUTCDay() + 6) % 7;
                    const mon       = new Date(nowMs - dFromMon * 86400_000);
                    const weekStart = `${mon.getUTCFullYear()}-${p(mon.getUTCMonth()+1)}-${p(mon.getUTCDate())}`;
                    const monthStart = `${y}-${p(m+1)}-01`;
                    return [
                        { label: 'Hoy',  value: `${todayStr}|${todayStr}` },
                        { label: 'Sem.', value: `${weekStart}|${todayStr}` },
                        { label: 'Mes',  value: `${monthStart}|${todayStr}` },
                    ].map(qt => (
                        <button key={qt.label} onClick={() => setMonthRange(qt.value)}
                            className={`px-2.5 h-8 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-200 shrink-0 border ${
                                monthRange === qt.value
                                    ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white/70 hover:text-slate-700 hover:shadow-sm'
                            }`}>
                            {qt.label}
                        </button>
                    ));
                })()}

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                <div className="w-[130px] md:w-[170px] overflow-visible h-full flex items-center">
                    <LiquidSelect value={filterBranch} onChange={setFilterBranch}
                        options={branchOptions} placeholder="Todas" icon={Building2} compact />
                </div>

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                <div className="w-[170px] md:w-[210px] overflow-visible h-full flex items-center">
                    <PeriodPicker value={monthRange} onChange={setMonthRange} />
                </div>

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                <button onClick={openSearch}
                    className="w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transform-gpu relative">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={TrendingUp} title="Ventas" filtersContent={filtersContent}>
            <div className={activeTab === 'ventas' ? '' : 'hidden'}>
                <TabVentas branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} monthRange={monthRange} employees={employees} />
            </div>
            <div className={activeTab === 'vendedores' ? '' : 'hidden'}>
                <TabVendedores branches={salesBranches} filterBranch={filterBranch}
                    employees={employees} searchTerm={rawSearch} monthRange={monthRange} />
            </div>
            <div className={activeTab === 'productos' ? '' : 'hidden'}>
                <TabProductos filterBranch={filterBranch} searchTerm={rawSearch} monthRange={monthRange} />
            </div>
        </GlassViewLayout>
    );
}
