import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import LiquidTooltip from '../components/common/LiquidTooltip';
import {
    TrendingUp, TrendingDown, Users, Package, FileText,
    Clock, Building2, Loader2, ChevronDown,
    ChevronUp, Search, X, Trophy, Star, ChevronRight, ChevronLeft,
    ArrowUp, ArrowDown, Minus, Info, ChevronsUpDown, Eye, EyeOff, FlaskConical
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';
import PeriodPicker from '../components/common/PeriodPicker';
import { DataTable, DataRow, DataCell, useExpandStyle } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import { smartFilter, normSearch } from '../utils/searchUtils';
import { shortEmployeeName } from '../utils/nameUtils';
import { fetchAllRows } from '../utils/supabaseUtils';

// ─── Constants ────────────────────────────────────────────────────────────────
const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const PAGE_SIZE = 50;

const fmt    = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) => parseInt(n || 0).toLocaleString('en-US');
const fmtPct = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

const CANCELLED_ESTADOS = ['NULA', 'DTE INVALIDADO EN MH'];
// Only these changelog campos are surfaced in the row indicator
const RELEVANT_CAMPOS = new Set(['tipo_pago', 'recibido_mh']);
const CAMPO_LABELS = { tipo_pago: 'Forma de pago', recibido_mh: 'Sello MH' };
const fmtCampoVal = (campo, val) => {
    if (val == null) return 'Sin registro';
    if (campo === 'recibido_mh') return val === true || val === 'true' ? 'Recibido' : `Recibido (${val})`;
    return String(val);
};

function fmtQty(n) {
    const f = parseFloat(n || 0);
    return f % 1 === 0 ? String(f) : f.toFixed(3).replace(/\.?0+$/, '');
}

function fmtDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}

function currentMonthRange() {
    const now = new Date(Date.now() - 6 * 3600_000);
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    // Use today as ffin so the comparison period is "same days last month", not full-month-vs-full-month
    return { fini: `${y}-${pad(m)}-01`, ffin: `${y}-${pad(m)}-${pad(d)}`, label: `${y}-${pad(m)}` };
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
    const pad = n => String(n).padStart(2, '0');
    // Mirror: same day numbers shifted back one calendar month.
    // May 5-9 → Apr 5-9. May 1-31 → Apr 1-30. Mar 31 → Feb 28. Jan 5 → Dec 5.
    const shiftBack = (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        const lastDay = new Date(py, pm, 0).getDate(); // last day of prev month
        return `${py}-${pad(pm)}-${pad(Math.min(d, lastDay))}`;
    };
    return { prevFini: shiftBack(fini), prevFfin: shiftBack(ffin) };
}

function fmtShort(dateStr) {
    if (!dateStr) return '';
    const [, m, d] = dateStr.split('-');
    return `${parseInt(d)}/${parseInt(m)}`;
}

function countDays(fini, ffin) {
    return Math.round((new Date(ffin + 'T12:00:00') - new Date(fini + 'T12:00:00')) / 86400000) + 1;
}

// Compare by daily average (total/days) so months with different lengths are fair
function dailyPct(curTotal, curDays, prevTotal, prevDays) {
    if (!prevTotal || !prevDays || !curDays) return null;
    const curAvg  = curTotal  / curDays;
    const prevAvg = prevTotal / prevDays;
    return ((curAvg - prevAvg) / prevAvg) * 100;
}

// Returns "HH:MM:00" in CST if ffin is today, null for past ranges (no cutoff needed)
function currentHoraCorte(ffin) {
    const nowSV   = new Date(Date.now() - 6 * 3600_000);
    const pad     = n => String(n).padStart(2, '0');
    const todaySV = `${nowSV.getUTCFullYear()}-${pad(nowSV.getUTCMonth() + 1)}-${pad(nowSV.getUTCDate())}`;
    if (ffin !== todaySV) return null;
    return `${pad(nowSV.getUTCHours())}:${pad(nowSV.getUTCMinutes())}:00`;
}

function FilterControls({
    monthRange, setMonthRange,
    filterBranch, setFilterBranch,
    branchOptions,
    filterAnuladas, setFilterAnuladas,
    filterAntibiotico, setFilterAntibiotico,
    showAntibiotico,
    filterLab, setFilterLab,
    labOptions,
    branchLocked,
}) {
    const defaultRange = (() => { const r = currentMonthRange(); return `${r.fini}|${r.ffin}`; })();

    const handlePeriodChange = (val) => setMonthRange(val);

    const resetAll = () => {
        setFilterBranch('');
        setMonthRange(defaultRange);
        setFilterAnuladas(false);
        setFilterAntibiotico(false);
        setFilterLab?.('');
    };

    const hasActiveFilters = !!filterBranch || monthRange !== defaultRange || filterAnuladas || filterAntibiotico || !!filterLab;

    const selectedBranch = branchOptions.find(o => String(o.value) === String(filterBranch));
    const branchW = selectedBranch
        ? Math.max(130, Math.min(250, 86 + selectedBranch.label.length * 8))
        : 145;

    const showLab = !!setFilterLab && labOptions?.length > 0;
    const selectedLab = showLab ? labOptions.find(o => String(o.value) === String(filterLab)) : null;
    const labW = selectedLab
        ? Math.max(130, Math.min(250, 86 + selectedLab.label.length * 8))
        : 165;

    const dateDirty = monthRange !== defaultRange;

    return (
        <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 shrink-0 overflow-visible">

            {/* Branch select + individual clear */}
            {!branchLocked && <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: branchW + 'px' }}>
                    <LiquidSelect value={filterBranch} onChange={setFilterBranch}
                        options={branchOptions} placeholder="Todas" icon={Building2} compact bare />
                </div>
                {filterBranch && (
                    <button onClick={() => setFilterBranch('')} title="Quitar sucursal"
                        className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-colors shrink-0">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>}

            {showLab && <>
            <div className="h-5 w-px bg-slate-100 shrink-0" />

            {/* Laboratorio select + individual clear */}
            <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: labW + 'px' }}>
                    <LiquidSelect value={filterLab} onChange={setFilterLab}
                        options={labOptions} placeholder="Laboratorio" icon={FlaskConical} compact bare />
                </div>
                {filterLab && (
                    <button onClick={() => setFilterLab('')} title="Quitar laboratorio"
                        className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-colors shrink-0">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>
            </>}

            <div className="h-5 w-px bg-slate-100 shrink-0" />

            {/* Period picker + individual clear */}
            <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible">
                    <PeriodPicker value={monthRange} onChange={handlePeriodChange} />
                </div>
                {dateDirty && (
                    <button onClick={() => setMonthRange(defaultRange)} title="Quitar fecha"
                        className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-colors shrink-0">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>

            <div className="h-5 w-px bg-slate-100 shrink-0" />

            {/* Toggle filters */}
            <div className="flex items-center gap-1 px-2">
                <button onClick={() => setFilterAnuladas(v => !v)}
                    className={`flex items-center gap-1 px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-widest border transition-[background-color,color,border-color] duration-200 whitespace-nowrap shrink-0 ${
                        filterAnuladas
                            ? 'bg-red-100 border-red-200 text-red-700 shadow-sm'
                            : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-50 hover:border-slate-200 hover:text-slate-600'
                    }`}>
                    Anuladas
                    {filterAnuladas && <X size={9} strokeWidth={3} />}
                </button>

                {showAntibiotico && (
                    <button onClick={() => setFilterAntibiotico(v => !v)}
                        className={`flex items-center gap-1 px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-widest border transition-[background-color,color,border-color] duration-200 whitespace-nowrap shrink-0 ${
                            filterAntibiotico
                                ? 'bg-rose-100 border-rose-200 text-rose-700 shadow-sm'
                                : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-50 hover:border-slate-200 hover:text-slate-600'
                        }`}>
                        Receta Médica
                        {filterAntibiotico && <X size={9} strokeWidth={3} />}
                    </button>
                )}
            </div>

            {/* Clear all */}
            {hasActiveFilters && (
                <>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                    <button onClick={resetAll} title="Limpiar todos los filtros"
                        className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-colors duration-200 shrink-0">
                        <X size={11} strokeWidth={3} />
                    </button>
                </>
            )}
        </div>
    );
}


// Stat card with % change vs previous period + optional sub label
function StatCard({ label, value, pct, sub, icon: Icon, grad, text, onClick, active, blurred, conIva }) {
    const isFilter = !!onClick;
    const card = (
        <div
            onClick={onClick}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border select-none transition-[box-shadow,border-color,background-color]
                ${isFilter ? 'cursor-pointer hover:shadow-md' : conIva != null ? 'cursor-help bg-white' : 'cursor-default bg-white'}
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
                <div className={`flex items-baseline gap-1.5 flex-wrap transition-[filter] duration-300 ${blurred ? 'blur-sm select-none' : ''}`}>
                    <span className={`text-[15px] font-black leading-none ${text}`}>{blurred ? '••••••' : value}</span>
                    {!blurred && pct !== null && pct !== undefined && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-black ${pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {pct >= 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                            {Math.abs(pct).toFixed(1)}%
                        </span>
                    )}
                </div>
                {sub && <span className={`text-[9px] text-slate-400 font-medium leading-none mt-0.5 transition-all duration-300 ${blurred ? 'blur-sm select-none' : ''}`}>{blurred ? '••' : sub}</span>}
            </div>
            {isFilter && !active && <ChevronDown size={11} className="text-amber-400 ml-0.5 shrink-0" />}
            {active && <X size={11} className="text-amber-500 ml-0.5 shrink-0" />}
        </div>
    );
    if (conIva == null || blurred) return card;
    return (
        <LiquidTooltip content={
            <div className="whitespace-nowrap">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total con IVA</p>
                <p className="text-[13px] font-black text-slate-800">{fmt(conIva)}</p>
            </div>
        }>
            {card}
        </LiquidTooltip>
    );
}

// Sortable column header button
function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
    const active = sortCol === col;
    return (
        <th className={`px-2 py-3 select-none ${className}`}>
            <button onClick={() => onSort(col)}
                className={`group flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all duration-150 ${
                    active
                        ? 'text-[#0052CC] bg-blue-50'
                        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
                }`}>
                {label}
                <span className={`transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {active
                        ? sortDir === 'asc'
                            ? <ChevronUp size={10} />
                            : <ChevronDown size={10} />
                        : <ChevronsUpDown size={10} />
                    }
                </span>
            </button>
        </th>
    );
}

// ─── Tab: Ventas ──────────────────────────────────────────────────────────────
function TabVentas({ branches, filterBranch, setFilterBranch, searchTerm, monthRange, setMonthRange, employees, branchOptions, privacyMode }) {
    const { getScope } = useAuth();
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
    const [pricesCache, setPricesCache] = useState({});
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingItems, setLoadingItems] = useState(false);
    const [loadingRows, setLoadingRows]   = useState(true);
    const [antibioticIds, setAntibioticIds] = useState(new Set());
    const [filterAntibiotico, setFilterAntibiotico] = useState(false);
    const [abInvoiceIds, setAbInvoiceIds] = useState(null); // null=not loaded, []|[ids]=loaded
    const [filterAnuladas, setFilterAnuladas] = useState(false);
    const [changelogCache, setChangelogCache] = useState({});
    const fetchRowsRef = useRef(0);

    useEffect(() => {
        supabase.from('products').select('id').eq('es_antibiotico', true)
            .then(({ data }) => { if (data) setAntibioticIds(new Set(data.map(p => p.id))); });
    }, []);

    useEffect(() => {
        if (!filterAntibiotico || antibioticIds.size === 0) { setAbInvoiceIds(null); return; }
        const ids = [...antibioticIds];
        supabase.from('sales_invoice_items').select('invoice_id').in('erp_product_id', ids)
            .then(({ data }) => {
                const uniq = [...new Set((data || []).map(i => i.invoice_id))];
                setAbInvoiceIds(uniq);
            });
    }, [filterAntibiotico, antibioticIds]);

    const [fini, ffin] = monthRange.split('|');
    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;
    const isSearching = searchTerm?.trim().length > 0;

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(e.code, e));
        return m;
    }, [employees]);

    const abInvoicesSet = useMemo(() => {
        const s = new Set();
        Object.entries(itemsCache).forEach(([invoiceId, items]) => {
            if ((items || []).some(it => antibioticIds.has(it.erp_product_id)))
                s.add(Number(invoiceId));
        });
        return s;
    }, [itemsCache, antibioticIds]);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
        setPage(1);
    };

    const prevMonthRange = useMemo(() => computePrevRange(fini, ffin), [fini, ffin]);

    // Suma puntos canjeados (erp_product_id=0, deduplicado por factura tomando el
    // total_linea mayor) para un set de IDs de factura ya filtrado — mismo cálculo
    // que el RPC get_puntos_canjeados pero sobre una lista arbitraria de IDs.
    const sumPuntosForIds = async (ids) => {
        if (!ids.length) return 0;
        const { data } = await supabase
            .from('sales_invoice_items')
            .select('invoice_id, total_linea')
            .eq('erp_product_id', 0)
            .in('invoice_id', ids);
        const maxByInvoice = new Map();
        for (const r of (data || [])) {
            const cur = maxByInvoice.get(r.invoice_id);
            if (cur === undefined || Number(r.total_linea) > cur) maxByInvoice.set(r.invoice_id, Number(r.total_linea));
        }
        return [...maxByInvoice.values()].reduce((a, b) => a + b, 0);
    };

    // Stats: RPC rápido (usa sales_daily_stats pre-agregado) para el caso normal.
    // Anuladas / antibiótico / búsqueda no tienen parámetro en el RPC (y romperían
    // el pre-agregado diario, que solo cubre ventas válidas) — para esos filtros
    // se agrega en el cliente con exactamente los mismos filtros que fetchRows.
    const fetchStats = useCallback(async () => {
        setLoadingStats(true);
        const branchFilter = filterBranch ? Number(filterBranch) : null;
        const horaCorte = currentHoraCorte(ffin);
        const hasSpecialFilter = filterAnuladas || filterAntibiotico || isSearching;

        if (hasSpecialFilter) {
            if (filterAntibiotico && abInvoiceIds === null) { setLoadingStats(false); return; } // aún cargando ids
            if (filterAntibiotico && abInvoiceIds.length === 0) {
                setTotalCount(0); setTotalAmount(0); setTotalPuntos(0);
                setPrevStats({ count: 0, sum: 0, puntos: 0 });
                setLoadingStats(false);
                return;
            }
            // fetchAllRows evita el cap silencioso de 1000 filas de PostgREST — con
            // filtros amplios (búsqueda de texto, antibióticos en rangos largos) el
            // total de facturas coincidentes puede superar 1000, y antes de este fix
            // la SUMA/puntos se calculaban solo sobre las primeras 1000 aunque el
            // conteo mostrado (count exact) sí fuera el real — monto silenciosamente
            // incorrecto en pantalla.
            const invoices = await fetchAllRows(() => {
                let q = supabase.from('sales_invoices').select('id, total')
                    .gte('fecha', fini).lte('fecha', ffin);
                if (branchFilter) q = q.eq('branch_id', branchFilter);
                if (filterAnuladas) q = q.in('estado', CANCELLED_ESTADOS);
                else q = q.not('estado', 'in', `(${CANCELLED_ESTADOS.join(',')})`);
                if (filterAntibiotico) q = q.in('id', abInvoiceIds);
                if (isSearching) {
                    const s = searchTerm.trim();
                    q = q.or(`erp_invoice_id.ilike.%${s}%,correlativo.ilike.%${s}%,cliente.ilike.%${s}%`);
                }
                return q;
            }) || [];
            const sum = invoices.reduce((acc, r) => acc + Number(r.total || 0), 0);
            const puntos = await sumPuntosForIds(invoices.map(r => r.id));

            setTotalCount(invoices.length);
            setTotalAmount(sum);
            setTotalPuntos(puntos);
            // Sin comparativo de período anterior para vistas filtradas — evita un %
            // engañoso que compare universos distintos (ej. "anuladas" vs "todo el mes pasado").
            setPrevStats({ count: 0, sum: 0, puntos: 0 });
            setLoadingStats(false);
            return;
        }

        const { prevFini, prevFfin } = prevMonthRange;
        const [cur, prev, puntosCur, puntosPrev] = await Promise.all([
            supabase.rpc('get_ventas_stats', { p_fini: fini,    p_ffin: ffin,    p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_ventas_stats', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_puntos_canjeados', { p_fini: fini,    p_ffin: ffin,    p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_puntos_canjeados', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter, p_hora_corte: horaCorte }),
        ]);

        const s    = cur.data?.[0] || {};
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
    }, [fini, ffin, filterBranch, prevMonthRange, filterAnuladas, filterAntibiotico, abInvoiceIds, isSearching, searchTerm]);

    // 6-month history for tooltip

    // Rows: paginado con sort o búsqueda en BD sin paginación
    const fetchRows = useCallback(async () => {
        const rid = ++fetchRowsRef.current;
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
            setPuntosCount(fetched.length > 0 ? Number(fetched[0].n) : 0);
        } else {
            const asc = sortDir === 'asc';
            let q = supabase
                .from('sales_invoices')
                .select('id, branch_id, erp_invoice_id, correlativo, tipo_documento, fecha, hora, cliente, cod_vendedor, tipo_pago, subtotal, iva, total, estado, recibido_mh, has_puntos')
                .gte('fecha', fini).lte('fecha', ffin)
                .order(sortCol, { ascending: asc });
            if (sortCol === 'fecha') q = q.order('hora', { ascending: asc });
            if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
            if (filterAnuladas) q = q.in('estado', CANCELLED_ESTADOS);
            if (filterAntibiotico && abInvoiceIds !== null) {
                if (abInvoiceIds.length === 0) {
                    if (rid === fetchRowsRef.current) { setRows([]); setLoadingRows(false); }
                    return;
                }
                q = q.in('id', abInvoiceIds);
            }
            if (isSearching) {
                const s = searchTerm.trim();
                q = q.or(`erp_invoice_id.ilike.%${s}%,correlativo.ilike.%${s}%,cliente.ilike.%${s}%`).limit(200);
            } else {
                q = q.range((page - 1) * pageSize, page * pageSize - 1);
            }
            const { data } = await q;
            fetched = data || [];
        }

        if (rid !== fetchRowsRef.current) return;
        setRows(fetched);
        setLoadingRows(false);

        const fetchedIds = fetched.map(r => r.id);
        const currentRid = rid;

        // Prefetch items for visible rows in background
        const uncached = fetchedIds.filter(id => !itemsCache[id]);
        if (uncached.length > 0) {
            supabase.from('sales_invoice_items')
                .select('invoice_id, erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
                .in('invoice_id', uncached)
                .order('total_linea', { ascending: false })
                .then(({ data: items }) => {
                    if (!items || fetchRowsRef.current !== currentRid) return;
                    const grouped = {};
                    for (const it of items) {
                        if (!grouped[it.invoice_id]) grouped[it.invoice_id] = [];
                        grouped[it.invoice_id].push(it);
                    }
                    setItemsCache(prev => ({ ...prev, ...grouped }));

                    // Also prefetch prices for all unique erp_product_ids in this batch
                    const erpIds = [...new Set(items.map(it => it.erp_product_id).filter(id => id && id !== -999))];
                    const uncachedErpIds = erpIds.filter(id => !(id in pricesCache));
                    if (uncachedErpIds.length) {
                        supabase.from('product_precios')
                            .select('product_id, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7')
                            .eq('activo', true)
                            .in('product_id', uncachedErpIds)
                            .then(({ data: priceRows }) => {
                                const pg = {};
                                // Pre-seed so IDs with no rows are marked "attempted" and won't re-fetch
                                for (const id of uncachedErpIds) pg[id] = [];
                                for (const p of (priceRows || [])) {
                                    if (!pg[p.product_id]) pg[p.product_id] = [];
                                    pg[p.product_id].push(p);
                                }
                                setPricesCache(prev => ({ ...prev, ...pg }));
                            });
                    }
                });
        }

        // Prefetch changelog for visible rows in background
        const uncachedChg = fetchedIds.filter(id => !(id in changelogCache));
        if (uncachedChg.length > 0) {
            const init = Object.fromEntries(uncachedChg.map(id => [id, []]));
            setChangelogCache(prev => ({ ...init, ...prev }));
            supabase.from('sales_invoice_changelog')
                .select('invoice_id, campo, valor_anterior, valor_nuevo')
                .in('invoice_id', uncachedChg)
                .then(({ data: logs }) => {
                    if (!logs || fetchRowsRef.current !== currentRid) return;
                    const grouped = Object.fromEntries(uncachedChg.map(id => [id, []]));
                    for (const c of logs) grouped[c.invoice_id].push(c);
                    setChangelogCache(prev => ({ ...prev, ...grouped }));
                });
        }
    }, [fini, ffin, filterBranch, filterPuntos, filterAnuladas, filterAntibiotico, abInvoiceIds, page, pageSize, sortCol, sortDir, isSearching, searchTerm]);

    useEffect(() => { fetchStats(); }, [fetchStats]);
    useEffect(() => { fetchRows(); }, [fetchRows]);
    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch, filterPuntos, filterAnuladas, filterAntibiotico, isSearching, pageSize]);

    const fetchPricesForIds = useCallback((erpIds) => {
        const uncachedIds = erpIds.filter(id => !(id in pricesCache));
        if (!uncachedIds.length) return;
        supabase.from('product_precios')
            .select('product_id, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7')
            .eq('activo', true)
            .in('product_id', uncachedIds)
            .then(({ data: priceRows }) => {
                const grouped = {};
                // Pre-seed with empty arrays so IDs with no rows are marked as "attempted"
                for (const id of uncachedIds) grouped[id] = [];
                for (const p of (priceRows || [])) {
                    if (!grouped[p.product_id]) grouped[p.product_id] = [];
                    grouped[p.product_id].push(p);
                }
                setPricesCache(prev => ({ ...prev, ...grouped }));
            });
    }, [pricesCache]);

    const toggleRow = useCallback(async (invoiceId) => {
        if (expandedId === invoiceId) { setExpandedId(null); return; }
        setExpandedId(invoiceId);

        // Items already cached — still ensure prices are fetched for any gap
        if (itemsCache[invoiceId]) {
            const erpIds = [...new Set((itemsCache[invoiceId] || [])
                .map(it => it.erp_product_id).filter(id => id && id !== -999))];
            fetchPricesForIds(erpIds);
            return;
        }

        setLoadingItems(true);
        const { data } = await supabase
            .from('sales_invoice_items')
            .select('erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
            .eq('invoice_id', invoiceId)
            .order('total_linea', { ascending: false });
        setItemsCache(prev => ({ ...prev, [invoiceId]: data || [] }));
        setLoadingItems(false);

        const erpIds = [...new Set((data || []).map(it => it.erp_product_id).filter(id => id && id !== -999))];
        fetchPricesForIds(erpIds);
    }, [expandedId, itemsCache, fetchPricesForIds]);

    const totalPages = isSearching ? 1 : Math.ceil((filterPuntos ? puntosCount : totalCount) / pageSize);
    const avgTicket  = totalCount > 0 ? totalAmount / totalCount : 0;

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Stats strip + inline filters */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                {loadingStats ? (
                    [120, 160, 140, 150].map(w => (
                        <div key={w} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-white">
                            <div className="w-6 h-6 rounded-lg skeleton shrink-0" />
                            <div className="h-3 skeleton" style={{ width: w * 0.45 }} />
                            <div className="h-4 skeleton" style={{ width: w * 0.55 }} />
                        </div>
                    ))
                ) : (() => {
                    const { prevFini: pf, prevFfin: pff } = prevMonthRange;
                    const curDays  = countDays(fini, ffin);
                    const prevDays = countDays(pf, pff);
                    const pctCount  = dailyPct(totalCount,  curDays, prevStats.count,  prevDays);
                    const pctSum    = dailyPct(totalAmount,  curDays, prevStats.sum,    prevDays);
                    const pctAvg    = prevStats.sum > 0 && prevStats.count > 0
                        ? (((totalAmount/totalCount) - (prevStats.sum/prevStats.count)) / (prevStats.sum/prevStats.count)) * 100 : null;
                    const pctPuntos = dailyPct(totalPuntos,  curDays, prevStats.puntos, prevDays);
                    return [
                        { label: 'Facturas',       value: fmtNum(totalCount), pct: pctCount,  icon: FileText,   grad: 'from-blue-500 to-indigo-500',  text: 'text-blue-700',    sub: prevStats.count  ? `${fmtNum(prevStats.count)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Total Ventas',   value: fmt(totalAmount),   pct: pctSum,    icon: TrendingUp, grad: 'from-emerald-500 to-teal-400', text: 'text-emerald-700', sub: prevStats.sum    ? `${fmt(prevStats.sum)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Ticket Prom.',   value: fmt(avgTicket),     pct: pctAvg,    icon: TrendingUp, grad: 'from-slate-500 to-slate-400',  text: 'text-slate-700',   sub: prevStats.sum && prevStats.count ? `${fmt(prevStats.sum/prevStats.count)}` : undefined },
                        { label: 'Pts. Canjeados', value: fmt(totalPuntos),   pct: pctPuntos, icon: Star,       grad: 'from-amber-500 to-orange-400', text: 'text-amber-700',   sub: prevStats.puntos ? `${fmt(prevStats.puntos)}` : undefined, onClick: () => setFilterPuntos(v => !v), active: filterPuntos },
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode} />);
                })()}
                </div>
                <FilterControls
                    monthRange={monthRange} setMonthRange={setMonthRange}
                    filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    branchOptions={branchOptions}
                    filterAnuladas={filterAnuladas} setFilterAnuladas={setFilterAnuladas}
                    filterAntibiotico={filterAntibiotico} setFilterAntibiotico={setFilterAntibiotico}
                    showAntibiotico={antibioticIds.size > 0}
                    branchLocked={getScope('ventas') === 'BRANCH'}
                />
            </div>

            <DataTable
                columns={[
                    { key: 'fecha',      label: 'Fecha',        sortable: true },
                    { key: 'id',         label: 'ID',           sortable: true, hideBelow: 'md' },
                    { key: 'tipo',       label: 'Tipo',         sortable: true, hideBelow: 'sm' },
                    { key: 'sucursal',   label: 'Sucursal',     sortable: true, hideBelow: 'lg' },
                    { key: 'vendedor',   label: 'Vendedor',     sortable: true, hideBelow: 'md' },
                    { key: 'cliente',    label: 'Cliente',      sortable: true },
                    { key: 'metodo',     label: 'Método pago',  sortable: true, hideBelow: 'sm' },
                    { key: 'total',      label: 'Total',        sortable: true, align: 'right' },
                ]}
                sortKey={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loadingRows && rows.length === 0}
                skeletonRows={10}
                empty={{ icon: TrendingUp, message: isSearching ? 'Sin resultados para esa búsqueda' : 'Sin ventas para este período' }}
                minWidth="700px"
            >
                {rows.map((r, i) => {
                    const isCancelled = CANCELLED_ESTADOS.includes(r.estado);
                    const isExpanded  = expandedId === r.id;
                    const cachedItems = itemsCache[r.id];
                    const noData      = cachedItems && cachedItems.length === 0;
                    const emp         = empMap.get(r.cod_vendedor);
                    const changes     = changelogCache[r.id] ?? [];
                    const relevantChanges = changes.filter(c => RELEVANT_CAMPOS.has(c.campo));
                    const tipoBadgeColor = r.tipo_documento === 'CCF'
                        ? 'bg-red-50 text-red-600'
                        : r.tipo_documento === 'FCF'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-slate-100 text-slate-500';
                    return (
                        <React.Fragment key={r.id}>
                            <DataRow
                                index={i}
                                onClick={() => toggleRow(r.id)}
                                className={isCancelled ? 'opacity-50 bg-red-50/30' : isExpanded ? 'bg-blue-50/50' : ''}
                            >
                                <DataCell>
                                    <p className={`text-[12px] font-bold text-slate-700 ${isCancelled ? 'line-through' : ''}`}>{r.fecha}</p>
                                    {r.hora && <p className="text-[10px] text-slate-400">{r.hora?.slice(0, 5)}</p>}
                                    {isCancelled
                                        ? <span className="text-[8px] font-black uppercase tracking-widest text-red-400">ANULADA</span>
                                        : r.recibido_mh === null && <span className="text-[8px] font-black uppercase tracking-widest text-orange-400">Pdte. MH</span>}
                                </DataCell>
                                <DataCell hideBelow="md">
                                    {r.erp_invoice_id && <p className={`font-mono text-[11px] font-black text-slate-500 ${isCancelled ? 'line-through' : ''}`}>#{r.erp_invoice_id}</p>}
                                    <p className="font-mono text-[10px] text-slate-400">{r.correlativo}</p>
                                </DataCell>
                                <DataCell hideBelow="sm">
                                    {r.tipo_documento
                                        ? <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${tipoBadgeColor}`}>{r.tipo_documento}</span>
                                        : <span className="text-slate-300">—</span>}
                                </DataCell>
                                <DataCell hideBelow="lg">
                                    <span className="text-[11px] text-slate-600">{getBranch(r.branch_id)}</span>
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <div className="flex items-center gap-2">
                                        {emp ? (
                                            <LiquidAvatar src={emp.photo || emp.photo_url} fallbackText={emp.first_names} className="w-6 h-6 rounded-full shrink-0" />
                                        ) : (
                                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                <Users size={11} className="text-slate-400" />
                                            </div>
                                        )}
                                        <span className="text-[11px] text-slate-600 truncate max-w-[100px]">
                                            {emp ? emp.first_names : (r.cod_vendedor || '—')}
                                        </span>
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <p className="text-[12px] text-slate-700 truncate max-w-[160px]">{r.cliente || '—'}</p>
                                    {(r.has_puntos || filterPuntos || abInvoicesSet.has(r.id)) && (
                                        <div className="flex gap-1 flex-wrap mt-0.5">
                                            {(r.has_puntos || filterPuntos) && (
                                                <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">Puntos</span>
                                            )}
                                            {abInvoicesSet.has(r.id) && (
                                                <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-600">Receta Médica</span>
                                            )}
                                        </div>
                                    )}
                                </DataCell>
                                <DataCell hideBelow="sm">
                                    {r.tipo_pago
                                        ? <span className="text-[11px] text-slate-600 font-medium">{r.tipo_pago}</span>
                                        : <span className="text-slate-300">—</span>}
                                </DataCell>
                                <DataCell align="right">
                                    <div className="flex items-center justify-end gap-2">
                                        {relevantChanges.length > 0 && (
                                            <LiquidTooltip content={
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-2">Cambios registrados</p>
                                                    {relevantChanges.map((c, ci) => (
                                                        <div key={ci} className="flex items-baseline gap-2 py-1 border-b border-slate-100 last:border-0">
                                                            <span className="text-[11px] font-bold text-slate-600 shrink-0">{CAMPO_LABELS[c.campo] ?? c.campo}:</span>
                                                            <span className="text-[11px] text-slate-400 line-through">{fmtCampoVal(c.campo, c.valor_anterior)}</span>
                                                            <span className="text-[11px] font-semibold text-slate-700">→ {fmtCampoVal(c.campo, c.valor_nuevo)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            } className="shrink-0">
                                                <div onClick={e => e.stopPropagation()}
                                                    className="w-4 h-4 rounded-full bg-amber-100 hover:bg-amber-200 flex items-center justify-center cursor-default transition-colors">
                                                    <span className="text-[9px] font-black text-amber-600 leading-none">!</span>
                                                </div>
                                            </LiquidTooltip>
                                        )}
                                        <p className={`text-[13px] font-black ${isCancelled ? 'line-through text-slate-400' : 'text-slate-800'}`}>{fmt(r.total)}</p>
                                        <ChevronDown size={12}
                                            className={`transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-blue-400' : noData ? 'text-slate-200' : 'text-slate-400'}`} />
                                    </div>
                                </DataCell>
                            </DataRow>
                            {isExpanded && (
                                <tr className="border-t border-blue-100/60">
                                    <td colSpan={8}
                                        className="px-5 py-4 bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/20">
                                        {loadingItems && !cachedItems ? (
                                            <div className="flex items-center gap-2 text-[11px] py-1 text-slate-400">
                                                <Loader2 size={12} className="animate-spin text-blue-400" /> Cargando productos...
                                            </div>
                                        ) : noData ? (
                                            <div className="flex items-center gap-2 text-[11px] py-1 text-slate-400">
                                                <Info size={12} className="shrink-0 text-slate-300" />
                                                Esta sucursal no tiene detalle de productos sincronizado desde el ERP.
                                            </div>
                                        ) : (
                                            (() => {
                                                const seen = new Set();
                                                const deduped = (cachedItems || []).filter(it => {
                                                    const sig = `${it.erp_product_id ?? it.descripcion}|${it.presentacion ?? ''}|${it.precio_unitario}|${it.total_linea}|${it.lote ?? ''}`;
                                                    if (seen.has(sig)) return false;
                                                    seen.add(sig);
                                                    return true;
                                                });
                                                const discountItems = deduped.filter(it => it.erp_product_id === -999);
                                                const regularItems  = deduped.filter(it => it.erp_product_id !== -999 && it.descripcion);
                                                const discountAmt   = discountItems.reduce((s, it) => s + Math.abs(parseFloat(it.total_linea || 0)), 0);
                                                const regularSum    = regularItems.reduce((s, it) => s + parseFloat(it.total_linea || 0), 0);
                                                const arithmeticDiscount = regularSum - parseFloat(r.total || 0);
                                                const finalDiscount = discountItems.length > 0 ? discountAmt : (arithmeticDiscount > 0.01 ? arithmeticDiscount : 0);
                                                const hdrTxt = 'text-slate-400';
                                                const nameTxt = 'text-slate-700';
                                                const numTxt = 'text-slate-500';
                                                const dividerCls = 'border-slate-100/80';
                                                const rowHoverCls = 'hover:bg-white/70';
                                                return (
                                                    <table className="w-full border-collapse">
                                                        <thead>
                                                            <tr className={`border-b ${dividerCls}`}>
                                                                <th className={`text-left text-[9px] font-semibold uppercase tracking-wider pb-1.5 pl-2 pr-2 ${hdrTxt}`}>Producto</th>
                                                                <th className={`text-right text-[9px] font-semibold uppercase tracking-wider pb-1.5 w-12 ${hdrTxt}`}>Cant.</th>
                                                                <th className={`text-right text-[9px] font-semibold uppercase tracking-wider pb-1.5 w-20 hidden sm:table-cell ${hdrTxt}`}>P. Unit.</th>
                                                                <th className={`text-right text-[9px] font-semibold uppercase tracking-wider pb-1.5 w-16 ${hdrTxt}`}>Tipo</th>
                                                                <th className={`text-right text-[9px] font-semibold uppercase tracking-wider pb-1.5 w-20 ${hdrTxt}`}>Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {regularItems.map((it, idx) => {
                                                                // undefined = not yet fetched; [] = fetched, no catalog entry
                                                                const cachedEntry = pricesCache[it.erp_product_id];
                                                                const productPriceRows = cachedEntry || [];
                                                                const pricesFetched = Array.isArray(cachedEntry);
                                                                // Try every price row for this product; pick the tier whose
                                                                // price is closest to the actual sale price (lowest diff).
                                                                // We don't match by id_presentacion because ERP sales and
                                                                // catalog use different ID namespaces.
                                                                const salePrice = parseFloat(it.precio_unitario);
                                                                const tierCandidates = productPriceRows
                                                                    .map(row => detectTier(salePrice, row))
                                                                    .filter(Boolean);
                                                                const tier = tierCandidates.length === 0 ? null :
                                                                    tierCandidates.reduce((best, t) =>
                                                                        (t.diff ?? Infinity) < (best.diff ?? Infinity) ? t : best
                                                                    );
                                                                const noPrice = pricesFetched && productPriceRows.length === 0;
                                                                return (
                                                                    <tr key={idx} className={`transition-colors ${rowHoverCls}`}>
                                                                        <td className="py-1 pl-2 pr-2">
                                                                            <div className={`text-[11px] font-semibold leading-snug ${nameTxt}`}>{it.descripcion}</div>
                                                                            {(antibioticIds.has(it.erp_product_id) || it.presentacion || it.lote || it.fecha_vencimiento) && (
                                                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                                                    {antibioticIds.has(it.erp_product_id) && <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-600">Receta Médica</span>}
                                                                                    {it.presentacion && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-400">{it.presentacion}</span>}
                                                                                    {it.lote && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-500 font-mono">L:{it.lote}</span>}
                                                                                    {it.fecha_vencimiento && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md font-mono bg-slate-100 text-slate-500">Vence {it.fecha_vencimiento}</span>}
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                        <td className={`py-1 text-right text-[10px] font-bold whitespace-nowrap ${numTxt}`}>{fmtQty(it.cantidad)}u</td>
                                                                        <td className="py-1 text-right text-[10px] whitespace-nowrap hidden sm:table-cell text-slate-400">{fmt(it.precio_unitario)}</td>
                                                                        <td className="py-1 text-right whitespace-nowrap">
                                                                            {tier ? (
                                                                                <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 ${tier.color}`}>
                                                                                    {tier.label}
                                                                                    {tier.num != null && <span className="opacity-50 font-bold">{tier.num}</span>}
                                                                                </span>
                                                                            ) : noPrice ? (
                                                                                <span className="text-[9px] text-slate-300">—</span>
                                                                            ) : null}
                                                                        </td>
                                                                        <td className={`py-1 text-right text-[11px] font-black whitespace-nowrap ${nameTxt}`}>{fmt(it.total_linea)}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                            {finalDiscount > 0 && (
                                                                <tr className="border-t border-amber-100">
                                                                    <td className="pt-1.5 pb-1 pl-2 pr-2" colSpan={3}>
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-md">PUNTOS</span>
                                                                            <span className="text-[11px] font-semibold text-amber-700">Descuento por puntos</span>
                                                                        </div>
                                                                    </td>
                                                                    <td />
                                                                    <td className="pt-1.5 pb-1 text-right text-[11px] font-black text-amber-600">-{fmt(finalDiscount)}</td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                );
                                            })()
                                        )}
                                        {(r.tipo_documento === 'CCF' || r.tipo_documento === 'COF') && r.subtotal != null && (
                                            <div className="mt-3 pt-3 border-t flex justify-end border-slate-100">
                                                <div className="flex flex-col gap-0.5 min-w-[180px]">
                                                    <div className="flex justify-between gap-6 text-[11px] text-slate-500">
                                                        <span>Subtotal (sin IVA)</span>
                                                        <span className="font-semibold text-slate-700">{fmt(r.subtotal)}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-6 text-[11px] text-slate-500">
                                                        <span>IVA (13%)</span>
                                                        <span className="font-semibold text-slate-700">{fmt(r.iva)}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-6 text-[12px] font-black border-t pt-1 mt-0.5 text-slate-800 border-slate-200">
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
            </DataTable>

            {!loadingRows && rows.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={isSearching ? rows.length : (filterPuntos ? puntosCount : totalCount)}
                    unit={isSearching ? 'resultados' : 'ventas'}
                />
            )}

        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, setFilterBranch, employees, searchTerm, monthRange, setMonthRange, branchOptions, privacyMode }) {
    const { getScope } = useAuth();
    const [rows, setRows]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [expanded, setExpanded]       = useState(null);
    const [expandedData, setExpandedData] = useState([]);
    const [loadingExpand, setLoadingExpand] = useState(false);

    useEffect(() => { if (privacyMode) setExpanded(null); }, [privacyMode]);
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
        const horaCorte = currentHoraCorte(ffin);
        supabase.rpc('get_ventas_stats', {
            p_fini: prevFini, p_ffin: prevFfin,
            p_branch_id: filterBranch ? Number(filterBranch) : null,
            p_hora_corte: horaCorte,
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

    const { knownRows, unknownByBranch, isVendSearchFuzzy } = useMemo(() => {
        const s = searchTerm;
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
        const allKnown = [...consolidatedMap.values()].sort((a, b) => b.total - a.total);
        const { results: known, isFuzzy: isVendFuzzy } = !s.trim()
            ? { results: allKnown, isFuzzy: false }
            : smartFilter(s, allKnown, r => [r.specialName || (r.emp ? `${r.emp.first_names} ${r.emp.last_names}` : ''), r.cod_vendedor]);
        return { knownRows: known, unknownByBranch: unknownMap, isVendSearchFuzzy: isVendFuzzy };
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
            {/* Stats + inline filters */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const periodLabel = `${fmtShort(prevFini)}→${fmtShort(prevFfin)}`;
                    const curDaysV  = countDays(fini, ffin);
                    const prevDaysV = countDays(prevFini, prevFfin);
                    const pctSum   = dailyPct(totalVentas,   curDaysV, prevVendStats.sum,   prevDaysV);
                    const pctCount = dailyPct(totalFacturas, curDaysV, prevVendStats.count, prevDaysV);
                    return [
                        { label: 'Vendedores',   value: knownRows.length,      icon: Users,      grad: 'from-blue-500 to-indigo-500',  text: 'text-blue-700',    pct: null,     sub: undefined },
                        { label: 'Total Ventas', value: fmt(totalVentas),       icon: TrendingUp, grad: 'from-emerald-500 to-teal-400', text: 'text-emerald-700', pct: pctSum,   sub: prevVendStats.sum   > 0 ? `${fmt(prevVendStats.sum)} · ${periodLabel}`   : undefined },
                        { label: 'Facturas',     value: fmtNum(totalFacturas),  icon: FileText,   grad: 'from-slate-500 to-slate-400',  text: 'text-slate-700',   pct: pctCount, sub: prevVendStats.count > 0 ? `${fmtNum(prevVendStats.count)} · ${periodLabel}` : undefined },
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode} />);
                })()}
                </div>
                <FilterControls monthRange={monthRange} setMonthRange={setMonthRange} filterBranch={filterBranch} setFilterBranch={setFilterBranch} branchOptions={branchOptions} branchLocked={getScope('ventas') === 'BRANCH'} />
            </div>

            <DataTable
                columns={[
                    { key: 'rank',     label: '#' },
                    { key: 'vendedor', label: 'Vendedor' },
                    { key: 'sucursal', label: 'Sucursal', hideBelow: 'md' },
                    { key: 'facturas', label: 'Facturas', align: 'right' },
                    { key: 'total',    label: 'Total',    align: 'right' },
                    { key: 'ticket',   label: 'Ticket Prom.', align: 'right', hideBelow: 'md' },
                    { key: 'expand',   label: '' },
                ]}
                loading={loading}
                skeletonRows={6}
                empty={{ icon: Users, message: 'Sin datos de vendedores para este período' }}
                minWidth="520px"
            >
                {knownRows.map((r, i) => {
                    const isOpen       = expanded === r.cod_vendedor;
                    const ticket       = r.count > 0 ? r.total / r.count : 0;
                    const pct          = totalVentas > 0 ? (r.total / totalVentas) * 100 : 0;
                    const baseBranchId = r.emp?.branch_id ?? r.branchIds[0];
                    const displayName  = r.specialName || (r.emp ? `${r.emp.first_names} ${r.emp.last_names}` : r.cod_vendedor);
                    const expandBg     = 'bg-gradient-to-br from-blue-50/30 via-white/40 to-slate-50/20';
                    const expandBorder = 'border-blue-100/60';
                    const cardNormal   = 'bg-white border-slate-200';
                    const cardCross    = 'bg-orange-50 border-orange-200';

                    return (
                        <React.Fragment key={r.cod_vendedor}>
                            <DataRow index={i} onClick={privacyMode ? undefined : () => toggleExpand(r.cod_vendedor)} className={isOpen ? 'bg-blue-50/30' : ''}>
                                <DataCell>
                                    <div className="flex items-center gap-1.5">
                                        {i === 0 ? <Trophy size={15} className="text-yellow-500" />
                                            : i === 1 ? <Trophy size={15} className="text-slate-400" />
                                            : i === 2 ? <Trophy size={15} className="text-amber-600" />
                                            : <span className="text-xs text-slate-400 font-bold w-4 text-center">{i + 1}</span>}
                                        <TrendBadge cod={r.cod_vendedor} currentRank={i + 1} />
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <div className="flex items-center gap-2.5">
                                        {r.emp ? (
                                            <LiquidAvatar src={r.emp.photo || r.emp.photo_url}
                                                fallbackText={r.emp.first_names}
                                                className="w-8 h-8 rounded-full shrink-0" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                <Users size={14} className="text-slate-400" />
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-semibold text-[13px]">{displayName}</p>
                                            <p className="text-[10px] text-slate-400">Cód. {r.cod_vendedor}</p>
                                        </div>
                                    </div>
                                </DataCell>
                                <DataCell hideBelow="md" className="text-[12px]">
                                    {getBranchName(baseBranchId)}
                                    {r.branchIds.filter(id => id !== baseBranchId).map(id => (
                                        <span key={id} className="ml-1 text-[10px] text-orange-500 font-semibold">+{getBranchName(id)}</span>
                                    ))}
                                </DataCell>
                                <DataCell align="right" className="font-semibold text-[12px]">{fmtNum(r.count)}</DataCell>
                                <DataCell align="right">
                                    <div className={`transition-all duration-300 ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                        <p className="font-black text-[13px]">{privacyMode ? '••••••' : fmt(r.total)}</p>
                                        <div className="mt-1 h-1 rounded-full bg-slate-100">
                                            <div className="h-1 rounded-full bg-blue-400 transition-all" style={{ width: privacyMode ? '0%' : `${pct}%` }} />
                                        </div>
                                    </div>
                                </DataCell>
                                <DataCell align="right" hideBelow="md" className="text-[12px]">{fmt(ticket)}</DataCell>
                                <DataCell>
                                    <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-400' : 'text-slate-400'}`} />
                                </DataCell>
                            </DataRow>
                            {isOpen && !privacyMode && (
                                <tr className={`border-t ${expandBorder}`}>
                                    <td colSpan={7}
                                        className={`px-4 py-3 ${expandBg}`}>
                                        {loadingExpand ? (
                                            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
                                        ) : (
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-slate-400">Ventas diarias</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {expandedData.map(d => {
                                                        const cross = d.branches.filter(b => b.branch_id !== baseBranchId);
                                                        return (
                                                            <div key={d.fecha} className={`border rounded-xl px-3 py-2 text-xs ${cross.length > 0 ? cardCross : cardNormal}`}>
                                                                <p className="mb-0.5 text-slate-500">{new Date(d.fecha + 'T12:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</p>
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
                    <DataRow key={`u-${u.branch_id}`} className="bg-orange-50/30">
                        <DataCell><span className="text-[10px] text-orange-300 font-bold">—</span></DataCell>
                        <DataCell>
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                                    <Users size={14} className="text-orange-400" />
                                </div>
                                <p className="font-semibold text-orange-600 text-[13px]">Cód. Incorrecto — {getBranchName(u.branch_id)}</p>
                            </div>
                        </DataCell>
                        <DataCell hideBelow="md" className="text-[12px]">—</DataCell>
                        <DataCell align="right" className="text-[12px]">{fmtNum(u.count)}</DataCell>
                        <DataCell align="right" className="font-bold text-[13px]"><span className={`transition-all duration-300 ${privacyMode ? 'blur-sm select-none' : ''}`}>{privacyMode ? '••••••' : fmt(u.total)}</span></DataCell>
                        <DataCell align="right" hideBelow="md" className="text-[12px]">{u.count > 0 ? fmt(u.total / u.count) : '—'}</DataCell>
                        <DataCell />
                    </DataRow>
                ))}
            </DataTable>

        </div>
    );
}

// ─── Tab: Productos ───────────────────────────────────────────────────────────
const DRILL_TIERS = [
    { key: 'vip',         label: 'VIP',     color: 'bg-violet-100 text-violet-700',   num: 3 },
    { key: 'clinica',     label: 'Clínica', color: 'bg-sky-100 text-sky-700',         num: 4 },
    { key: 'mayoreo',     label: 'Mayoreo', color: 'bg-orange-100 text-orange-700',   num: 5 },
    { key: 'premium',     label: 'Premium', color: 'bg-amber-100 text-amber-700',     num: 6 },
    { key: 'descuento_1', label: 'Desc.',   color: 'bg-emerald-100 text-emerald-700', num: 2 },
    { key: 'precio_7',    label: 'P7',      color: 'bg-teal-100 text-teal-700',       num: 7 },
    { key: 'vineta',      label: 'Viñeta',  color: 'bg-slate-100 text-slate-600',     num: 1 },
];
const DRILL_TIER_ORDER = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'];
const PAGO_STYLE = {
    efectivo:      'bg-emerald-50 text-emerald-700',
    tarjeta:       'bg-blue-50 text-blue-700',
    credito:       'bg-amber-50 text-amber-700',
    transferencia: 'bg-purple-50 text-purple-700',
    cheque:        'bg-zinc-100 text-zinc-600',
    bitcoin:       'bg-orange-50 text-orange-600',
};
function detectTier(precioUnitario, preciosRow, tiers = DRILL_TIERS) {
    if (!preciosRow || !precioUnitario) return null;
    const p = parseFloat(precioUnitario);
    // Prices may be stored with or without IVA; try both and take the closest match.
    const candidates = tiers
        .map(t => {
            const gross = parseFloat(preciosRow[t.key] || 0);
            if (!gross) return null;
            const net   = gross / 1.13;
            const diff  = Math.min(Math.abs(gross - p) / gross, Math.abs(net - p) / net);
            return { ...t, diff };
        })
        .filter(Boolean);
    if (!candidates.length) return null;
    const best = candidates.reduce((a, b) => b.diff < a.diff ? b : a);
    if (best.diff > 0.10) return { label: 'Especial', color: 'bg-rose-100 text-rose-600' };
    return best;
}

// Normalize a presentacion name for loose matching: "UNIDAD 1x1" → "UNIDAD 1X1"
function presKey(tipo, descripcion) {
    return `${tipo ?? ''} ${descripcion ?? ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
}

// Find the price record active on a given date (YYYY-MM-DD) from a pre-filtered list.
function findHistFromList(list, fechaStr) {
    const matches = (list || []).filter(h => {
        const from  = h.valid_from.slice(0, 10);
        const until = h.valid_until ? h.valid_until.slice(0, 10) : null;
        return from <= fechaStr && (until === null || until > fechaStr);
    });
    return matches.sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;
}

// Find the price record that was active on a given date (YYYY-MM-DD string).
// valid_from/valid_until are UTC ISO timestamps — we compare date prefix only.
function findHistPrices(history, idPresentacion, fechaStr) {
    return findHistFromList((history || []).filter(h => h.id_presentacion === idPresentacion), fechaStr);
}

// Find the earliest price change AFTER a given date for a given id_presentacion list.
function findFirstChangeSince(history, idPresentaciones, fechaStr) {
    const ids = Array.isArray(idPresentaciones) ? idPresentaciones : [idPresentaciones];
    const later = (history || [])
        .filter(h => ids.includes(h.id_presentacion) && h.valid_from.slice(0, 10) > fechaStr)
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    return later[0]?.valid_from ?? null;
}

function UltimaVentaCell({ row, filterBranch, branches }) {
    const fecha  = row.ultima_venta;
    const porSuc = row.ultima_venta_por_suc || [];

    if (!fecha) {
        return <span className="text-[10px] text-slate-300 italic">Sin ventas</span>;
    }

    const days  = Math.floor((Date.now() - new Date(fecha + 'T12:00:00')) / 86_400_000);
    const color = days > 365 ? 'text-red-500' : days > 180 ? 'text-orange-500' : 'text-slate-600';
    const label = fmtDate(fecha);

    if (filterBranch) {
        return (
            <div>
                <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-[9px] text-slate-400">hace {days}d</span>
            </div>
        );
    }

    // All branches
    const byBranch = porSuc.filter(s => s.fecha);
    if (byBranch.length <= 1) {
        const name = byBranch.length === 1
            ? (branches.find(b => b.id === Number(byBranch[0].branch_id))?.name || `Suc. ${byBranch[0].branch_id}`)
            : '';
        return (
            <div>
                <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                {name && <span className="block text-[9px] text-slate-400">{name}</span>}
            </div>
        );
    }

    const tipContent = (
        <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Última venta por suc.</p>
            {byBranch.map(s => {
                const name = branches.find(b => b.id === Number(s.branch_id))?.name || `Suc. ${s.branch_id}`;
                const d = Math.floor((Date.now() - new Date(s.fecha + 'T12:00:00')) / 86_400_000);
                const c = d > 365 ? 'text-red-500' : d > 180 ? 'text-orange-500' : 'text-[#0052CC]';
                return (
                    <div key={s.branch_id} className="flex items-center justify-between gap-6 whitespace-nowrap">
                        <span className="text-[12px] font-semibold text-slate-700">{name}</span>
                        <span className={`text-[12px] font-black tabular-nums ${c}`}>{fmtDate(s.fecha)}</span>
                    </div>
                );
            })}
        </div>
    );
    return (
        <LiquidTooltip content={tipContent}>
            <div className="cursor-help">
                <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-[9px] text-slate-400">{byBranch.length} suc. ⓘ</span>
            </div>
        </LiquidTooltip>
    );
}

function TabProductos({ filterBranch, setFilterBranch, searchTerm, monthRange, setMonthRange, branchOptions, privacyMode }) {
    const { maxPriceLevel, getScope, user: currentUser } = useAuth();
    const allowedDrillTiers = useMemo(() => {
        if (!maxPriceLevel) return DRILL_TIERS;
        const maxIdx = DRILL_TIER_ORDER.indexOf(maxPriceLevel);
        if (maxIdx === -1) return DRILL_TIERS;
        return DRILL_TIERS.filter(t => DRILL_TIER_ORDER.indexOf(t.key) <= maxIdx);
    }, [maxPriceLevel]);
    const branches = useStaff(s => s.branches);
    const employees = useStaff(s => s.employees);
    const [rows, setRows]           = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState(null);
    const [sortCol, setSortCol]     = useState('neto');
    const [sortDir, setSortDir]     = useState('desc');
    const [filterLab, setFilterLab] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const [prevProdStats, setPrevProdStats] = useState({ sum: 0 });
    const [page, setPage]           = useState(1);
    const [pageSize, setPageSize]   = useState(50);
    const [expandedKey, setExpandedKey]   = useState(null);
    const [drillData,     setDrillData]     = useState([]);
    const [drillPage,     setDrillPage]     = useState(1);
    const [drillPageSize, setDrillPageSize] = useState(25);

    useEffect(() => { if (privacyMode) setExpandedKey(null); }, [privacyMode]);
    const [drillLoading, setDrillLoading] = useState(false);
    const [drillSortCol, setDrillSortCol] = useState('fecha');
    const [drillSortDir, setDrillSortDir] = useState('desc');
    const [drillFilters, setDrillFilters] = useState({ tipodoc: '', changed: false });
    const [drillMonthly, setDrillMonthly] = useState([]);
    const productsCache = useRef(new Map()); // keyed by `${fini}|${ffin}|${branch}`
    const drillCache    = useRef(new Map()); // keyed by `${productId}|${fini}|${ffin}|${branch}`
    const [fini, ffin] = monthRange.split('|');

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
        setPage(1);
    };
    const handleDrillSort = (col) => {
        if (drillSortCol === col) setDrillSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setDrillSortCol(col); setDrillSortDir('desc'); }
        setDrillPage(1);
    };

    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch, searchTerm, pageSize, filterLab, showHidden]);

    // Ocultar producto es global y permanente (no como el buscador, que es solo
    // para encontrar) — por defecto la vista excluye los ocultos; showHidden
    // invierte a "solo ocultos" para poder revisarlos/destaparlos.
    const hiddenCount = useMemo(() => rows.filter(r => r.oculto_en_ventas).length, [rows]);
    const visibleBaseRows = useMemo(() =>
        rows.filter(r => showHidden ? r.oculto_en_ventas : !r.oculto_en_ventas),
        [rows, showHidden]
    );

    const labOptions = useMemo(() => {
        const seen = new Map();
        for (const r of visibleBaseRows) {
            if (r.laboratorio_id != null && !seen.has(r.laboratorio_id)) {
                seen.set(r.laboratorio_id, r.laboratorio_nombre || `Lab. ${r.laboratorio_id}`);
            }
        }
        return [...seen.entries()]
            .map(([value, label]) => ({ value: String(value), label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [visibleBaseRows]);

    // Close drill-down and clear drill cache whenever period/branch changes
    useEffect(() => {
        setExpandedKey(null);
        setDrillData([]);
        drillCache.current.clear();
    }, [fini, ffin, filterBranch]);

    // Reset drill sort/filter/page when a new product is expanded
    useEffect(() => {
        setDrillSortCol('fecha'); setDrillSortDir('desc');
        setDrillFilters({ tipodoc: '', changed: false });
        setDrillMonthly([]);
        setDrillPage(1);
    }, [expandedKey]);

    const fetchProductos = useCallback(async (isRetry = false) => {
        const cacheKey = `${fini}|${ffin}|${filterBranch ?? ''}`;
        // ppv6: bump de versión de la key — ppv5 guardaba filas sin
        // oculto_por/oculto_at (agregados para trackear quién ocultó cada
        // producto). Mismo patrón que los bumps anteriores (ppv3→ppv4→ppv5):
        // sin esto, caché sin vencer (TTL 20 min) mostraría esos campos como
        // undefined tras el deploy. ppv2/ppv3/ppv4 son versiones aún más viejas.
        const lsKey    = `ppv6_${cacheKey}`;
        const TTL_MS   = 20 * 60 * 1000; // 20 minutes

        // Cache only applies when not searching — search results are never cached
        if (!searchTerm) {
            // 1. In-memory cache (survives filter changes within same session)
            if (productsCache.current.has(cacheKey)) {
                setRows(productsCache.current.get(cacheKey));
                setLoading(false);
                return;
            }
            // 2. localStorage cache (survives navigation away and back)
            try {
                const stored = localStorage.getItem(lsKey);
                if (stored) {
                    const { data, ts } = JSON.parse(stored);
                    if (Date.now() - ts < TTL_MS) {
                        productsCache.current.set(cacheKey, data);
                        setRows(data);
                        setLoading(false);
                        return;
                    }
                    localStorage.removeItem(lsKey);
                }
            } catch (_) { /* localStorage unavailable or corrupted — proceed to fetch */ }
        }

        setLoading(true);
        setError(null);
        try {
            // get_product_sales_agg no pagina server-side — sin esto, PostgREST
            // trunca en silencio a 1000 filas (cap conocido, ver CLAUDE.md). Con
            // 1,618 productos vendidos solo en julio (sin filtrar sucursal), el
            // cap ya se estaba activando: se ocultaban ~600+ productos reales
            // (los de menor rotación, por el ORDER BY neto DESC) sin ningún aviso.
            const rpcParams = {
                p_fini:      fini,
                p_ffin:      ffin,
                p_branch_id: filterBranch ? Number(filterBranch) : null,
                ...(searchTerm ? { p_search: normSearch(searchTerm) || searchTerm } : {}),
            };
            // Una sola llamada JSONB (Patrón C): fetchAllRows re-ejecutaba el RPC
            // completo (~1-2s) por cada página de 1000 filas.
            const { data: presData, error: presErr } = await supabase.rpc('get_product_sales_agg_jsonb', rpcParams);
            if (presErr) throw presErr;
            if (presData === null) throw new Error('No se pudo cargar productos');
            if (!presData.length) { setRows([]); setLoading(false); return; }

            // Cost now comes from the RPC — no separate fetch needed
            const allRows = presData.map(item => {
                const qty         = parseFloat(item.cantidad     || 0);
                const neto        = parseFloat(item.neto         || 0);
                const costo_total = item.costo_total != null ? parseFloat(item.costo_total) : null;
                const utilidad    = costo_total != null ? neto - costo_total : null;
                const margen      = utilidad != null && neto > 0 ? (utilidad / neto) * 100 : null;
                const costo_unitario = costo_total != null && qty > 0 ? costo_total / qty : null;
                const presentaciones = (item.presentaciones || []).map(p => ({
                    presentacion: p.presentacion || '',
                    cantidad:     parseFloat(p.cantidad || 0),
                    neto:         parseFloat(p.neto     || 0),
                    factor:       parseInt(p.factor     || 1, 10),
                }));
                // Total in base units: each presentation quantity × its ERP factor.
                // e.g. 2 CAJA(×10) + 6 UNIDAD(×1) = 26, not 8.
                const cantidad_base = presentaciones.length > 0
                    ? presentaciones.reduce((s, p) => s + p.cantidad * p.factor, 0)
                    : qty;
                return {
                    erp_product_id: item.erp_product_id,
                    descripcion:    item.descripcion,
                    laboratorio_id:     item.laboratorio_id ?? null,
                    laboratorio_nombre: item.laboratorio_nombre || null,
                    cantidad: qty, cantidad_base, neto, costo_total, costo_unitario, utilidad, margen, presentaciones,
                    ultima_venta:        item.ultima_venta        || null,
                    ultima_venta_por_suc: item.ultima_venta_por_suc || [],
                    oculto_en_ventas: !!item.oculto_en_ventas,
                    oculto_por: item.oculto_en_ventas
                        ? { first_names: item.oculto_por_first_names || null, last_names: item.oculto_por_last_names || null }
                        : null,
                    oculto_at: item.oculto_at || null,
                };
            });

            // Only persist browse results to cache (not search results)
            if (!searchTerm) {
                productsCache.current.set(cacheKey, allRows);
                try {
                    Object.keys(localStorage)
                        // ppv2_/ppv3_/ppv4_/ppv5_ = versiones de esquema viejas (siempre se purgan);
                        // ppv6_ = caché actual, solo se purga si venció su TTL.
                        .filter(k => k.startsWith('ppv2_') || k.startsWith('ppv3_') || k.startsWith('ppv4_') || k.startsWith('ppv5_') || (k.startsWith('ppv6_') && k !== lsKey))
                        .forEach(k => {
                            if (k.startsWith('ppv2_') || k.startsWith('ppv3_') || k.startsWith('ppv4_') || k.startsWith('ppv5_')) { localStorage.removeItem(k); return; }
                            try { const e = JSON.parse(localStorage.getItem(k)); if (Date.now() - e.ts > TTL_MS) localStorage.removeItem(k); } catch (_) {}
                        });
                    localStorage.setItem(lsKey, JSON.stringify({ data: allRows, ts: Date.now() }));
                } catch (_) { /* quota exceeded or unavailable — in-memory cache still works */ }
            }

            setRows(allRows);
            setLoading(false);
        } catch (err) {
            if (!isRetry) {
                // Auto-retry once after 1.5 s — handles transient network/PostgREST blips
                // Keep spinner running so the user sees continuous loading, not a flash of error
                setTimeout(() => fetchProductos(true), 1500);
            } else {
                setError(err.message || 'Error al cargar productos');
                setLoading(false);
            }
        }
    }, [fini, ffin, filterBranch, searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchProductos(); }, [fetchProductos]);

    // Ocultar/mostrar producto en Ventas > Productos — global (para todos los
    // usuarios), vía products.oculto_en_ventas. No afecta Catálogo/Inventario.
    // Usa un RPC (no un update directo) para que oculto_por quede resuelto
    // server-side con auth_employee_id() — mismo patrón que created_by en
    // crear_conteo_inventario — en vez de que el cliente pudiera enviar
    // cualquier valor arbitrario en un update directo a la tabla.
    const toggleOculto = useCallback(async (row) => {
        const nextVal = !row.oculto_en_ventas;
        const { error: e } = await supabase.rpc('toggle_producto_oculto_ventas', {
            p_erp_product_id: row.erp_product_id,
            p_oculto: nextVal,
        });
        if (e) { useToastStore.getState().showToast('Error', e.message, 'error'); return; }
        // Optimista: el nombre exacto (first_names/last_names) se confirma en el
        // próximo fetch; mientras tanto se parte user.name igual que lo hace
        // shortEmployeeName, así el tooltip no queda vacío hasta el reload.
        const [firstGuess, ...restGuess] = (currentUser?.name || '').trim().split(/\s+/);
        const oculto_por = nextVal ? { first_names: firstGuess || null, last_names: restGuess.join(' ') || null } : null;
        const oculto_at  = nextVal ? new Date().toISOString() : null;
        const patchRow = (r) => r.erp_product_id === row.erp_product_id ? { ...r, oculto_en_ventas: nextVal, oculto_por, oculto_at } : r;

        setRows(prev => prev.map(patchRow));
        // Mantiene la caché en memoria Y en localStorage consistente con lo que ya
        // se ve — si no, un reload (memoria se pierde, localStorage sobrevive) o un
        // cambio de filtro que reuse la caché mostraría el estado viejo. Bug real
        // encontrado: el toggle solo actualizaba productsCache.current (memoria);
        // localStorage seguía con oculto_en_ventas desactualizado, así que un F5
        // revivía el producto oculto hasta que el TTL de 20 min expirara.
        const cacheKey = `${fini}|${ffin}|${filterBranch ?? ''}`;
        if (productsCache.current.has(cacheKey)) {
            productsCache.current.set(cacheKey, productsCache.current.get(cacheKey).map(patchRow));
        }
        try {
            const lsKey = `ppv6_${cacheKey}`;
            const stored = localStorage.getItem(lsKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                parsed.data = (parsed.data || []).map(patchRow);
                localStorage.setItem(lsKey, JSON.stringify(parsed));
            }
        } catch (_) { /* localStorage unavailable or corrupted — in-memory cache still fixed */ }
        useStaff.getState().appendAuditLog(nextVal ? 'OCULTAR_PRODUCTO_VENTAS' : 'MOSTRAR_PRODUCTO_VENTAS', String(row.erp_product_id), { producto: row.descripcion });
        useToastStore.getState().showToast(nextVal ? 'Producto oculto' : 'Producto visible', nextVal ? 'Ya no aparecerá en Ventas > Productos.' : 'Vuelve a aparecer en Ventas > Productos.', 'success');
    }, [fini, ffin, filterBranch, currentUser]);

    const fetchDrillDown = useCallback(async (productId) => {
        const cacheKey = `${productId}|${fini}|${ffin}|${filterBranch ?? ''}`;
        if (drillCache.current.has(cacheKey)) {
            const c = drillCache.current.get(cacheKey);
            setDrillData(c.data);
            setDrillMonthly(c.monthly);
            setDrillLoading(false);
            return;
        }
        setDrillLoading(true);
        setDrillData([]);
        try {
            const [{ data, error: e }, { data: precios }, { data: history }, { data: monthly }] = await Promise.all([
                supabase.rpc('get_product_drill_lines', {
                    p_erp_product_id: productId,
                    p_fini:           fini,
                    p_ffin:           ffin,
                    p_branch_id:      filterBranch ? Number(filterBranch) : null,
                }),
                supabase.from('product_precios')
                    .select('id_presentacion, descripcion, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7, presentaciones(tipo)')
                    .eq('product_id', productId)
                    .eq('activo', true),
                supabase.from('product_precios_history')
                    .select('id_presentacion, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7, valid_from, valid_until, presentaciones(tipo)')
                    .eq('product_id', productId)
                    .order('valid_from', { ascending: false }),
                supabase.rpc('get_product_trend', {
                    p_erp_product_id: productId,
                    p_branch_id:      filterBranch ? Number(filterBranch) : null,
                }),
            ]);
            if (e) throw e;
            const preciosMap = new Map((precios || []).map(p => [p.id_presentacion, p]));
            // Secondary lookup by presentation name — handles ERP duplicate IDs
            // (e.g. "UNIDAD 1x1" stored as id=1 in product_precios but id=102 in sales)
            const preciosNameMap = new Map();
            for (const p of (precios || [])) {
                const k = presKey(p.presentaciones?.tipo, p.descripcion);
                if (k) preciosNameMap.set(k, p);
            }
            // descripcion lives in product_precios (per-product), not in presentaciones (catalog)
            const presDescMap = new Map((precios || []).map(p => [p.id_presentacion, p.descripcion]));
            // Group history by name for the same reason
            const histNameMap = new Map();
            for (const h of (history || [])) {
                const k = presKey(h.presentaciones?.tipo, presDescMap.get(h.id_presentacion));
                if (k) { if (!histNameMap.has(k)) histNameMap.set(k, []); histNameMap.get(k).push(h); }
            }
            const fallbackCurr = (precios || []).length === 1 ? precios[0] : null;

            const mappedData = (data || []).map(row => {
                const idPres    = row.id_presentacion;
                const saleKey   = (row.presentacion || '').toUpperCase().replace(/\s+/g, ' ').trim();
                const currPrices = preciosMap.get(idPres) ?? preciosNameMap.get(saleKey) ?? fallbackCurr;
                const histById   = findHistPrices(history || [], idPres, row.fecha);
                const histByName = histById ? null : findHistFromList(histNameMap.get(saleKey) || [], row.fecha);
                const histPrices = histById ?? histByName;
                const resolvedHistId = histById ? idPres
                    : histByName ? (histNameMap.get(saleKey) || [])[0]?.id_presentacion
                    : idPres;
                // RPC normalizes everything to s/IVA; multiply back for non-CCF display (COF carries IVA)
                const isCCFLike      = row.tipo_documento === 'CCF';
                const precio_display = isCCFLike ? parseFloat(row.precio_unitario) : parseFloat(row.precio_unitario) * 1.13;
                const neto_display   = isCCFLike ? parseFloat(row.neto)           : parseFloat(row.neto)           * 1.13;
                const tier        = detectTier(precio_display, histPrices ?? currPrices, allowedDrillTiers);
                const currentTier = detectTier(precio_display, currPrices, allowedDrillTiers);
                const tierChanged   = !!(histPrices && currPrices && tier?.label !== currentTier?.label);
                const tierChangedAt = tierChanged
                    ? findFirstChangeSince(history || [], [idPres, resolvedHistId], row.fecha)
                    : null;
                return {
                    id:               row.item_id,
                    fecha:            row.fecha,
                    erp_invoice_id:   row.erp_invoice_id,
                    correlativo:      row.correlativo,
                    presentacion:     row.presentacion,
                    id_presentacion:  idPres,
                    cantidad:         row.cantidad,
                    precio_unitario:  row.precio_unitario,
                    precio_display,
                    neto:             row.neto,
                    neto_display,
                    cliente:          row.cliente,
                    branch_id:        row.branch_id,
                    tipo_documento:   row.tipo_documento,
                    cod_vendedor:     row.cod_vendedor,
                    tipo_pago:        row.tipo_pago,
                    lote:             row.lote,
                    fecha_vencimiento: row.fecha_vencimiento,
                    tier, currentTier, tierChanged, tierChangedAt,
                };
            });
            const mappedMonthly = (monthly || []).map(m => ({
                month:    m.month,
                neto:     parseFloat(m.neto     || 0),
                cantidad: parseFloat(m.cantidad || 0),
            }));
            drillCache.current.set(cacheKey, { data: mappedData, monthly: mappedMonthly });
            setDrillData(mappedData);
            setDrillMonthly(mappedMonthly);
        } catch (err) {
            console.error(err);
        } finally {
            setDrillLoading(false);
        }
    }, [fini, ffin, filterBranch]);

    const toggleExpand = (key, productId) => {
        if (expandedKey === key) { setExpandedKey(null); return; }
        setExpandedKey(key);
        if (productId != null) fetchDrillDown(productId);
    };

    const filteredDrill = useMemo(() => {
        let list = drillData;
        if (drillFilters.tipodoc) list = list.filter(l => l.tipo_documento === drillFilters.tipodoc);
        if (drillFilters.changed) list = list.filter(l => l.tierChanged);
        return [...list].sort((a, b) => {
            const dir = drillSortDir === 'asc' ? 1 : -1;
            const av = a[drillSortCol], bv = b[drillSortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
        });
    }, [drillData, drillFilters, drillSortCol, drillSortDir]);

    useEffect(() => {
        const { prevFini, prevFfin } = computePrevRange(fini, ffin);
        // Use the same source as the current period so both totals match
        // (sii.total_linea, erp_product_id IS NOT NULL). Using get_ventas_stats
        // (si.total) caused a mismatch because it includes non-product lines
        // (discounts, adjustments, etc.). get_product_sales_total suma server-side
        // sobre get_product_sales_agg — antes se descargaba el dataset completo
        // del período anterior (~1-2MB) solo para sumar neto en el cliente.
        const prevParams = { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: filterBranch ? Number(filterBranch) : null };
        (async () => {
            const { data: total } = await supabase.rpc('get_product_sales_total', prevParams);
            setPrevProdStats({ sum: parseFloat(total || 0) });
        })();
    }, [fini, ffin, filterBranch]);

    // filtered + sorted — busca en TODO el dataset, no solo en la página visible
    const { results: filtered, isFuzzy: isProdFuzzy } = useMemo(() => {
        const { results, isFuzzy } = !searchTerm
            ? { results: visibleBaseRows, isFuzzy: false }
            : smartFilter(searchTerm, visibleBaseRows, r => [r.descripcion, ...(r.presentaciones || []).map(p => p.presentacion)]);
        const labFiltered = filterLab ? results.filter(r => String(r.laboratorio_id) === String(filterLab)) : results;
        const sorted = [...labFiltered].sort((a, b) => {
            const asc = sortDir === 'asc' ? 1 : -1;
            const av = a[sortCol];
            const bv = b[sortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return typeof av === 'string' ? av.localeCompare(bv) * asc : (av - bv) * asc;
        });
        return { results: sorted, isFuzzy };
    }, [visibleBaseRows, searchTerm, sortCol, sortDir, filterLab]);

    // KPIs sobre el período completo, acotados por laboratorio si hay filtro activo
    // (no afectados por búsqueda — el buscador es para encontrar, el filtro para acotar)
    const labFilteredRows = useMemo(() =>
        filterLab ? visibleBaseRows.filter(r => String(r.laboratorio_id) === String(filterLab)) : visibleBaseRows,
        [visibleBaseRows, filterLab]
    );
    const maxNeto      = labFilteredRows.reduce((m, r) => Math.max(m, r.neto), 0) || 1;
    const totNeto      = labFilteredRows.reduce((s, r) => s + r.neto, 0);
    const totCosto     = labFilteredRows.filter(r => r.costo_total != null).reduce((s, r) => s + r.costo_total, 0);
    const totUtilidad  = labFilteredRows.filter(r => r.utilidad    != null).reduce((s, r) => s + r.utilidad,    0);
    const margenGlobal = totNeto > 0 ? (totUtilidad / totNeto) * 100 : 0;
    const totNetoConIva = totNeto * 1.13;

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats + inline filters */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const curDaysP  = countDays(fini, ffin);
                    const prevDaysP = countDays(prevFini, prevFfin);
                    // La comparación vs. período anterior (prevProdStats) viene de un RPC
                    // sin filtro por laboratorio — se oculta con filterLab activo para no
                    // comparar un total acotado contra uno de todos los laboratorios.
                    const pctIngresos = filterLab ? null : dailyPct(totNeto, curDaysP, prevProdStats.sum, prevDaysP);
                    return [
                        { label: 'Total s/IVA',  value: fmt(totNeto),       icon: TrendingUp,   grad: 'from-blue-500 to-indigo-500',   text: 'text-blue-700',    pct: pctIngresos, sub: !filterLab && prevProdStats.sum > 0 ? `${fmt(prevProdStats.sum)} · ${fmtShort(prevFini)}→${fmtShort(prevFfin)}` : undefined, conIva: totNetoConIva },
                        { label: 'Costo',         value: fmt(totCosto),      icon: TrendingDown, grad: 'from-red-500 to-orange-400',    text: 'text-red-700',     pct: null,        sub: undefined },
                        { label: 'Utilidad',      value: fmt(totUtilidad),   icon: TrendingUp,   grad: 'from-emerald-500 to-teal-400',  text: 'text-emerald-700', pct: null,        sub: undefined },
                        { label: 'Margen',        value: fmtPct(margenGlobal), icon: Star,       grad: 'from-amber-500 to-yellow-400',  text: 'text-amber-700',   pct: null,        sub: undefined },
                        ...(hiddenCount > 0 || showHidden ? [
                            { label: 'Ocultos', value: fmtNum(hiddenCount), icon: showHidden ? Eye : EyeOff, grad: 'from-slate-500 to-slate-400', text: 'text-slate-700', pct: null, sub: showHidden ? 'Viendo solo ocultos' : undefined, onClick: () => setShowHidden(v => !v), active: showHidden },
                        ] : []),
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode && card.label !== 'Ocultos'} />);
                })()}
                </div>
                <FilterControls monthRange={monthRange} setMonthRange={setMonthRange} filterBranch={filterBranch} setFilterBranch={setFilterBranch} branchOptions={branchOptions} branchLocked={getScope('ventas') === 'BRANCH'} filterLab={filterLab} setFilterLab={setFilterLab} labOptions={labOptions} />
            </div>

            {error && (
                <div className="text-center py-16 text-red-400">
                    <Package size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">{error}</p>
                    <button onClick={fetchProductos} className="mt-3 text-[11px] font-bold text-blue-500 hover:underline">Reintentar</button>
                </div>
            )}
            {isProdFuzzy && searchTerm && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
                    <Search size={12} strokeWidth={2.5} className="shrink-0" />
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </div>
            )}
            {!error && (
            <DataTable
                columns={[
                    { key: 'rank',         label: '#' },
                    { key: 'descripcion',  label: 'Producto',      sortable: true },
                    { key: 'laboratorio_nombre', label: 'Laboratorio', sortable: true, hideBelow: 'md' },
                    { key: 'cantidad',     label: 'Unidades',      sortable: true, align: 'right', hideBelow: 'md' },
                    { key: 'neto',         label: 'Total s/IVA',   sortable: true, align: 'right' },
                    { key: 'costo_total',  label: 'Costo',         sortable: true, align: 'right', hideBelow: 'lg' },
                    { key: 'utilidad',     label: 'Utilidad',      sortable: true, align: 'right', hideBelow: 'sm' },
                    { key: 'margen',       label: 'Margen',        sortable: true, align: 'right' },
                    { key: 'ultima_venta', label: 'Última venta',  sortable: true, align: 'right', hideBelow: 'lg' },
                    { key: '_oculto',      label: '',              align: 'center', className: 'w-10' },
                ]}
                sortKey={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loading}
                skeletonRows={10}
                empty={{ icon: Package, message: searchTerm ? `Sin resultados para "${searchTerm}"` : showHidden ? 'No hay productos ocultos' : 'Sin datos para este período' }}
                minWidth="640px"
            >
                {paginated.map((r, i) => {
                                const globalIdx  = (page - 1) * pageSize + i;
                                const rowKey     = r.erp_product_id != null ? String(r.erp_product_id) : `desc::${r.descripcion}`;
                                const isExpanded = expandedKey === rowKey;
                                const pct        = (r.neto / maxNeto) * 100;
                                const margin     = r.margen;
                                const marginColor = margin == null ? 'text-slate-300'
                                    : margin >= 25 ? 'text-emerald-600'
                                    : margin >= 10 ? 'text-amber-600'
                                    : 'text-red-600';
                                return (
                                    <React.Fragment key={rowKey}>
                                    <DataRow index={i} onClick={privacyMode ? undefined : () => toggleExpand(rowKey, r.erp_product_id)}
                                        className={isExpanded ? 'bg-blue-50/40' : ''}>
                                        <DataCell className="text-[11px] font-bold">
                                            {globalIdx === 0 ? <Star size={15} className="text-yellow-500 fill-yellow-400" />
                                                : <span className="text-slate-400">{globalIdx + 1}</span>}
                                        </DataCell>
                                        <DataCell className="max-w-[220px]">
                                            <div className="flex items-start gap-1.5">
                                                <div className="flex-1 min-w-0">
                                                    <p className={`font-semibold text-[12px] leading-tight ${r.neto === 0 ? 'text-slate-400' : ''}`}>{r.descripcion}</p>
                                                    {r.presentaciones?.length > 0 && (
                                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                                            {r.presentaciones.length === 1
                                                                ? r.presentaciones[0].presentacion || 'sin presentación'
                                                                : `${r.presentaciones.length} presentaciones`}
                                                        </p>
                                                    )}
                                                    {r.neto === 0 && (
                                                        <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full mt-1 inline-block">Sin ventas en período</span>
                                                    )}
                                                    {r.neto > 0 && (
                                                    <div className="mt-1.5 h-1 rounded-full bg-slate-100">
                                                        <div className="h-1 rounded-full bg-blue-400 transition-all" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    )}
                                                </div>
                                                <ChevronDown size={13} className={`shrink-0 mt-0.5 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-blue-400' : 'text-slate-300'}`} />
                                            </div>
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-[11px] text-slate-500 font-semibold truncate max-w-[140px]">
                                            {r.laboratorio_nombre || <span className="opacity-30">—</span>}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="md" className="text-[12px] font-semibold">
                                            {(() => {
                                                const pres = r.presentaciones || [];
                                                if (pres.length === 0) return fmtNum(r.cantidad_base);
                                                return (
                                                    <LiquidTooltip content={
                                                        <div className="space-y-1 whitespace-nowrap">
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Desglose por presentación</p>
                                                            {pres.map((p, i) => {
                                                                const f = p.factor || 1;
                                                                const sub = p.cantidad * f;
                                                                return (
                                                                    <div key={`${p.presentacion}-${i}`} className="flex items-center justify-between gap-4 text-[11px]">
                                                                        <span className="font-semibold text-slate-600">{fmtQty(p.cantidad)} {p.presentacion || 'u'}</span>
                                                                        <span className="text-slate-400 tabular-nums">{f > 1 ? `× ${f} = ${fmtNum(sub)} u` : `= ${fmtNum(sub)} u`}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                            {pres.length > 1 && (
                                                                <div className="flex items-center justify-between gap-4 text-[11px] font-black text-slate-800 border-t border-slate-100 pt-1 mt-1.5">
                                                                    <span>Total</span>
                                                                    <span className="tabular-nums">{fmtNum(r.cantidad_base)} u</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    }>
                                                        <span className="cursor-help">{fmtNum(r.cantidad_base)}</span>
                                                    </LiquidTooltip>
                                                );
                                            })()}
                                        </DataCell>
                                        <DataCell align="right" className="font-black text-[13px]">
                                            {privacyMode ? (
                                                <span className="transition-all duration-300 blur-sm select-none">••••••</span>
                                            ) : (
                                                <LiquidTooltip content={
                                                    <div className="whitespace-nowrap">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total con IVA</p>
                                                        <p className="text-[13px] font-black text-slate-800">{fmt(r.neto * 1.13)}</p>
                                                    </div>
                                                }>
                                                    <span className="cursor-help">{fmt(r.neto)}</span>
                                                </LiquidTooltip>
                                            )}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg" className="text-[12px]">
                                            <span className={`transition-all duration-300 ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                                {privacyMode ? '••••••' : r.costo_total != null ? fmt(r.costo_total) : <span className="opacity-30">—</span>}
                                            </span>
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm" className="text-[12px] font-bold">
                                            <span className={`transition-all duration-300 ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                                {privacyMode ? '••••••' : r.utilidad != null
                                                    ? <span className={r.utilidad >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(r.utilidad)}</span>
                                                    : <span className="opacity-30">—</span>}
                                            </span>
                                        </DataCell>
                                        <DataCell align="right">
                                            {margin != null
                                                ? <span className={`text-[12px] font-black ${marginColor}`}>{fmtPct(margin)}</span>
                                                : <span className="opacity-30 text-[12px]">—</span>}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg">
                                            <UltimaVentaCell row={r} filterBranch={filterBranch} branches={branches} />
                                        </DataCell>
                                        <DataCell align="center">
                                            <LiquidTooltip content={
                                                showHidden
                                                    ? <div className="whitespace-nowrap">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Mostrar de nuevo</p>
                                                        <p className="text-[11px] text-slate-600">
                                                            Oculto por <span className="font-bold text-slate-800">{shortEmployeeName(r.oculto_por)}</span>
                                                            {r.oculto_at && ` el ${new Date(r.oculto_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                                                        </p>
                                                      </div>
                                                    : 'Ocultar producto (para todos)'
                                            }>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleOculto(r); }}
                                                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                                                        showHidden
                                                            ? 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                                                            : 'text-slate-300 hover:text-red-500 hover:bg-red-50'
                                                    }`}
                                                >
                                                    {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                            </LiquidTooltip>
                                        </DataCell>
                                    </DataRow>
                                    {isExpanded && !privacyMode && (
                                        <tr className="bg-gradient-to-b from-blue-50/25 to-slate-50/10">
                                            <td colSpan={10}
                                                className="px-4 py-4">
                                                {drillLoading ? (
                                                    <div className="flex items-center gap-2 text-[12px] text-slate-400 py-3">
                                                        <Loader2 size={14} className="animate-spin" /> Cargando detalle...
                                                    </div>
                                                ) : (
                                                    <div className="space-y-4">
                                                        {/* Presentaciones breakdown */}
                                                        {r.presentaciones?.length > 1 && (
                                                            <div>
                                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Por presentación</p>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {r.presentaciones.map(p => (
                                                                        <div key={p.presentacion} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                                                                            <span className="text-[11px] font-semibold text-slate-600">{p.presentacion || '(sin pres.)'}</span>
                                                                            <span className="text-[11px] font-black text-slate-800">{fmtQty(p.cantidad)} u</span>
                                                                            {p.factor > 1 && (
                                                                                <span className="text-[10px] font-semibold text-blue-500">= {fmtQty(p.cantidad * p.factor)} base</span>
                                                                            )}
                                                                            <span className="text-[10px] text-slate-400">{fmt(p.neto)}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Charts: branch rotation + 3-month trend */}
                                                        {(() => {
                                                            const showBranch = !filterBranch && drillData.length > 0;
                                                            const showTrend  = drillMonthly.length > 0;
                                                            if (!showBranch && !showTrend) return null;

                                                            // Branch rotation aggregated from drill data
                                                            const branchAgg = showBranch ? (() => {
                                                                const netoMap = {}, cantMap = {};
                                                                const factorMap = Object.fromEntries((r.presentaciones || []).map(p => [p.presentacion, p.factor || 1]));
                                                                for (const l of drillData) {
                                                                    const f = factorMap[l.presentacion] || 1;
                                                                    netoMap[l.branch_id] = (netoMap[l.branch_id] || 0) + l.neto;
                                                                    cantMap[l.branch_id] = (cantMap[l.branch_id] || 0) + parseFloat(l.cantidad || 0) * f;
                                                                }
                                                                const entries = Object.entries(netoMap).sort((a, b) => b[1] - a[1]);
                                                                const total   = entries.reduce((s, [, v]) => s + v, 0);
                                                                return { entries, total, cantMap };
                                                            })() : null;

                                                            // Trend bar heights
                                                            const maxTrend = showTrend ? Math.max(...drillMonthly.map(m => m.neto), 1) : 1;

                                                            const BRANCH_COLORS = ['bg-indigo-400','bg-blue-400','bg-violet-400','bg-sky-400','bg-purple-400','bg-cyan-400'];
                                                            return (
                                                                <div className={`grid gap-3 mb-1 ${showBranch && showTrend ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                                                                    {/* Branch rotation */}
                                                                    {showBranch && (
                                                                        <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/50 p-4 shadow-sm">
                                                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Ventas por sucursal</p>
                                                                            <div className="space-y-2.5">
                                                                                {branchAgg.entries.map(([bid, neto], ci) => {
                                                                                    const pct   = branchAgg.total > 0 ? (neto / branchAgg.total) * 100 : 0;
                                                                                    const name  = branches.find(b => b.id === Number(bid))?.name || `Suc. ${bid}`;
                                                                                    const color = BRANCH_COLORS[ci % BRANCH_COLORS.length];
                                                                                    const cant  = branchAgg.cantMap[bid] || 0;
                                                                                    return (
                                                                                        <div key={bid}>
                                                                                            <div className="flex justify-between items-center mb-1">
                                                                                                <span className="text-[10px] text-slate-600 font-semibold truncate max-w-[150px]">{name}</span>
                                                                                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                                                                                    <span className="text-[9px] text-slate-400 font-semibold tabular-nums">{fmtQty(cant)} und</span>
                                                                                                    <span className="text-[10px] font-black text-slate-700">{fmt(neto)}</span>
                                                                                                    <span className="text-[9px] font-black text-white px-1.5 py-0.5 rounded-full bg-indigo-500">{pct.toFixed(0)}%</span>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                                                                                <div className={`h-2 rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Trend */}
                                                                    {showTrend && (
                                                                        <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/50 p-4 shadow-sm">
                                                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Tendencia mensual</p>
                                                                            <div className="flex items-end gap-1.5" style={{ height: 80 }}>
                                                                                {drillMonthly.map((m, i) => {
                                                                                    const barPct = (m.neto / maxTrend) * 100;
                                                                                    const prev   = drillMonthly[i - 1];
                                                                                    const change = prev && prev.neto > 0 ? ((m.neto - prev.neto) / prev.neto) * 100 : null;
                                                                                    const monthLabel = new Date(m.month + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short' });
                                                                                    const isLatest = i === drillMonthly.length - 1;
                                                                                    const isUp = change !== null && change >= 0;
                                                                                    return (
                                                                                        <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full group/bar cursor-default">
                                                                                            <div className="text-[8px] font-black h-3.5 flex items-center">
                                                                                                {change !== null
                                                                                                    ? <span className={isUp ? 'text-emerald-500' : 'text-red-400'}>{isUp ? '▲' : '▼'}{Math.abs(change).toFixed(0)}%</span>
                                                                                                    : <span />}
                                                                                            </div>
                                                                                            <div className="w-full flex flex-col justify-end rounded-t-lg overflow-hidden" style={{ height: 44 }}>
                                                                                                <div
                                                                                                    className={`w-full transition-all duration-500 rounded-t-lg ${isLatest ? 'bg-gradient-to-t from-blue-500 to-blue-400' : 'bg-gradient-to-t from-blue-200 to-blue-100'}`}
                                                                                                    style={{ height: `${Math.max(barPct, 5)}%` }}
                                                                                                />
                                                                                            </div>
                                                                                            <span className="text-[9px] text-slate-500 capitalize leading-none mt-1">{monthLabel}</span>
                                                                                            <span className="text-[8px] font-black text-slate-600 leading-none">{fmt(m.neto)}</span>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Individual sales table */}
                                                        {drillData.length > 0 && (() => {
                                                            const docOpts  = [...new Set(drillData.map(l => l.tipo_documento).filter(Boolean))];
                                                            const drillFactorMap = Object.fromEntries((r.presentaciones || []).map(p => [p.presentacion, p.factor || 1]));
                                                            const totCant  = filteredDrill.reduce((s, l) => s + parseFloat(l.cantidad || 0) * (drillFactorMap[l.presentacion] || 1), 0);
                                                            const totNeto  = filteredDrill.reduce((s, l) => s + parseFloat(l.neto_display ?? l.neto ?? 0), 0);
                                                            const drillTotalPages = Math.max(1, Math.ceil(filteredDrill.length / drillPageSize));
                                                            const paginatedDrill  = filteredDrill.slice((drillPage - 1) * drillPageSize, drillPage * drillPageSize);
                                                            const DH = ({ col, label, right }) => {
                                                                const active = drillSortCol === col;
                                                                return (
                                                                    <th onClick={() => handleDrillSort(col)}
                                                                        className={`px-3 py-2 font-black text-[9px] uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${active ? 'text-blue-600' : 'text-slate-400'} hover:text-slate-700`}>
                                                                        <span className="inline-flex items-center gap-0.5">
                                                                            {label}
                                                                            {active
                                                                                ? (drillSortDir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)
                                                                                : <ChevronsUpDown size={9} className="opacity-30" />}
                                                                        </span>
                                                                    </th>
                                                                );
                                                            };
                                                            const pill = (val, field, label) => {
                                                                const active = drillFilters[field] === val;
                                                                return (
                                                                    <button key={val} onClick={() => { setDrillFilters(f => ({ ...f, [field]: active ? '' : val })); setDrillPage(1); }}
                                                                        className={`px-2 py-0.5 rounded-full text-[9px] font-black border transition-[background-color,border-color,color] ${active ? 'bg-[#0052CC] text-white border-[#0052CC]' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}>
                                                                        {label ?? val}
                                                                    </button>
                                                                );
                                                            };
                                                            return (
                                                                <div>
                                                                    {/* Filter chips */}
                                                                    {(() => {
                                                                        const changedCount = drillData.filter(l => l.tierChanged).length;
                                                                        const hasAnyFilter = drillFilters.tipodoc || drillFilters.changed;
                                                                        return (docOpts.length > 1 || changedCount > 0) && (
                                                                            <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                                                                {docOpts.length > 1 && docOpts.map(v => pill(v, 'tipodoc'))}
                                                                                {changedCount > 0 && (
                                                                                    <>
                                                                                        {docOpts.length > 1 && <span className="text-slate-200">|</span>}
                                                                                        <button onClick={() => { setDrillFilters(f => ({ ...f, changed: !f.changed })); setDrillPage(1); }}
                                                                                            className={`px-2 py-0.5 rounded-full text-[9px] font-black border transition-[background-color,border-color,color] flex items-center gap-1 ${drillFilters.changed ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-600 border-amber-300 hover:border-amber-500'}`}>
                                                                                            ⚠ precio cambió ({changedCount})
                                                                                        </button>
                                                                                    </>
                                                                                )}
                                                                                {hasAnyFilter && (
                                                                                    <button onClick={() => { setDrillFilters({ tipodoc: '', changed: false }); setDrillPage(1); }}
                                                                                        className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-red-50 text-red-400 hover:bg-red-500 hover:text-white border border-red-200 transition-colors">
                                                                                        ✕ limpiar
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })()}

                                                                    {/* Totals summary */}
                                                                    <div className="flex items-center gap-3 mb-2">
                                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                                            {filteredDrill.length} venta{filteredDrill.length !== 1 ? 's' : ''}{drillData.length >= 300 ? '+' : ''}
                                                                        </p>
                                                                        <span className="text-slate-200">·</span>
                                                                        <p className="text-[10px] font-black text-slate-600">{fmtQty(totCant)} <span className="font-medium text-slate-400">unidades</span></p>
                                                                        <span className="text-slate-200">·</span>
                                                                        <p className="text-[11px] font-black text-emerald-700">{fmt(totNeto)} <span className="text-[9px] font-medium text-slate-400">total</span></p>
                                                                    </div>

                                                                    {/* Table */}
                                                                    <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-sm overflow-x-auto">
                                                                        <table className="min-w-full text-[11px]">
                                                                            <thead className="bg-slate-50 border-b border-slate-200">
                                                                                <tr>
                                                                                    <DH col="fecha"          label="Fecha" />
                                                                                    <DH col="correlativo"    label="Correlativo" />
                                                                                    <DH col="tipo_documento" label="Doc" />
                                                                                    <DH col="tipo_pago"      label="Pago" />
                                                                                    <DH col="cod_vendedor"   label="Vendedor" />
                                                                                    <DH col="cliente"        label="Cliente" />
                                                                                    {!filterBranch && <DH col="branch_id" label="Suc." />}
                                                                                    <DH col="presentacion"     label="Presentación" />
                                                                                    <th className="px-3 py-2 font-black text-[9px] uppercase tracking-wide text-slate-400 text-left whitespace-nowrap">Lote</th>
                                                                                    <th className="px-3 py-2 font-black text-[9px] uppercase tracking-wide text-slate-400 text-left whitespace-nowrap hidden lg:table-cell">Vence</th>
                                                                                    <DH col="precio_display"   label="P. Unit." right />
                                                                                    <DH col="cantidad"         label="Cant." right />
                                                                                    <DH col="neto_display"     label="Total" right />
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-slate-100">
                                                                                {paginatedDrill.map((line, li) => {
                                                                                    const emp        = employees?.find(e => e.code === line.cod_vendedor);
                                                                                    const empName    = emp ? (emp.name || `${emp.first_names ?? ''} ${emp.last_names ?? ''}`.trim()) : (line.cod_vendedor || '—');
                                                                                    const empShort   = empName.split(' ').filter(Boolean).slice(0, 2).join(' ');
                                                                                    const empInit    = empName[0]?.toUpperCase() || '?';
                                                                                    const branchName = branches.find(b => b.id === line.branch_id)?.name || `Suc. ${line.branch_id}`;
                                                                                    const pagoStyle  = PAGO_STYLE[line.tipo_pago] ?? 'bg-slate-100 text-slate-500';
                                                                                    const docStyle   = line.tipo_documento === 'CCF' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';
                                                                                    return (
                                                                                        <tr key={li} className="hover:bg-blue-50/30 transition-colors">
                                                                                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{fmtShort(line.fecha)}</td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap">
                                                                                                <div className="flex flex-col leading-tight">
                                                                                                    <span className="font-mono text-slate-700 text-[11px]">{line.correlativo || '—'}</span>
                                                                                                    {line.erp_invoice_id && (
                                                                                                        <span className="font-mono text-[9px] text-slate-400">#{line.erp_invoice_id}</span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap">
                                                                                                {line.tipo_documento && <span className={`text-[9px] font-black px-1.5 py-[2px] rounded-md ${docStyle}`}>{line.tipo_documento}</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap">
                                                                                                {line.tipo_pago && <span className={`text-[9px] font-semibold px-1.5 py-[2px] rounded-md ${pagoStyle}`}>{line.tipo_pago}</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap">
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <LiquidAvatar src={emp?.photo || emp?.photo_url} fallbackText={emp?.first_names} className="w-5 h-5 rounded-full shrink-0" />
                                                                                                    <span className="text-slate-600 text-[11px]">{empShort}</span>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate">{line.cliente || '—'}</td>
                                                                                            {!filterBranch && <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{branchName}</td>}
                                                                                            <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{line.presentacion || '—'}</td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap">
                                                                                                {line.lote
                                                                                                    ? <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-500">{line.lote}</span>
                                                                                                    : <span className="text-slate-300">—</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 whitespace-nowrap hidden lg:table-cell">
                                                                                                {line.fecha_vencimiento
                                                                                                    ? <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-600">{line.fecha_vencimiento}</span>
                                                                                                    : <span className="text-slate-300">—</span>}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                                                                <div className="flex flex-col items-end gap-0.5">
                                                                                                    <span className="text-[11px] font-semibold text-slate-700">{fmt(line.precio_display)}</span>
                                                                                                    {line.tier && (
                                                                                                        <div className="relative group/tier inline-flex items-center gap-1">
                                                                                                            <span className={`text-[9px] font-black px-1.5 py-[2px] rounded-md inline-flex items-center gap-1 ${line.tier.color}`}>
                                                                                                                {line.tier.label}
                                                                                                                {line.tier.num != null && <span className="opacity-50 font-bold">{line.tier.num}</span>}
                                                                                                            </span>
                                                                                                            {line.tierChanged && (
                                                                                                                <>
                                                                                                                    <span className="text-amber-500 text-[11px] cursor-help leading-none">⚠</span>
                                                                                                                    <div className="absolute bottom-full right-0 mb-1.5 z-50 hidden group-hover/tier:block w-max max-w-[220px] bg-slate-800 text-white text-[10px] leading-relaxed rounded-xl px-3 py-2 shadow-xl pointer-events-none">
                                                                                                                        <p className="font-black text-amber-300 mb-0.5">Precio cambió</p>
                                                                                                                        {line.tierChangedAt && (
                                                                                                                            <p className="text-slate-300">
                                                                                                                                {new Date(line.tierChangedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                                                                            </p>
                                                                                                                        )}
                                                                                                                        <p className="mt-1">Al vender: <strong className="text-white">{line.tier.label}</strong></p>
                                                                                                                        <p>Hoy: <strong className="text-white">{line.currentTier?.label ?? '—'}</strong></p>
                                                                                                                    </div>
                                                                                                                </>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">{fmtQty(line.cantidad)}</td>
                                                                                            <td className="px-3 py-2 text-right font-black text-slate-800 whitespace-nowrap">{fmt(line.neto_display)}</td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                            <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                                                                                <tr>
                                                                                    <td colSpan={!filterBranch ? 11 : 10} className="px-3 py-2 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                                                                                        Total {filteredDrill.length < drillData.length ? `(filtrado)` : ''}
                                                                                    </td>
                                                                                    <td className="px-3 py-2 text-right font-black text-slate-700">{fmtQty(totCant)}</td>
                                                                                    <td className="px-3 py-2 text-right font-black text-emerald-700">{fmt(totNeto)}</td>
                                                                                </tr>
                                                                            </tfoot>
                                                                        </table>
                                                                    </div>
                                                                    {drillTotalPages > 1 && (
                                                                        <div className="px-2 pt-2">
                                                                            <TablePagination
                                                                                pageSize={drillPageSize}
                                                                                onPageSizeChange={s => { setDrillPageSize(s); setDrillPage(1); }}
                                                                                page={drillPage}
                                                                                totalPages={drillTotalPages}
                                                                                onPageChange={setDrillPage}
                                                                                total={filteredDrill.length}
                                                                                unit="ventas"
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                );
                            })}
            </DataTable>
            )}

            {!error && !loading && rows.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={rows.length}
                    unit="productos"
                    filteredTotal={searchTerm ? filtered.length : undefined}
                />
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
    const branches = useStaff(s => s.branches);
    const employees = useStaff(s => s.employees);
    const { user: currentUser, hasPermission, getScope } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // Pestañas filtradas según permisos
    const VALID_TABS = new Set(['ventas', 'vendedores', 'productos']);
    const allowedTabs = TABS.filter(t => hasPermission(`ventas_tab_${t.key}`));
    const defaultTab  = allowedTabs[0]?.key ?? 'ventas';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID_TABS.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });
    const [filterBranch, setFilterBranch] = useState(
        getScope('ventas') === 'BRANCH' ? String(currentUser?.branchId || '') : ''
    );
    const [monthRange, setMonthRange]   = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearch, setRawSearch]     = useState('');
    const [privacyMode, setPrivacyMode] = useState(false);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const salesBranches = useMemo(() =>
        (branches || []).filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const openSearch  = () => setIsSearchMode(true);
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
                <Search size={18} className="text-[#0052CC] shrink-0" strokeWidth={2.5} />
                <input ref={(el) => { if (el && isSearchMode) setTimeout(() => el.focus(), 100) }} type="text" placeholder={searchPlaceholder}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch} onChange={e => setRawSearch(e.target.value)} />
                {rawSearch && (
                    <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={closeSearch}
                    className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[900px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

                {allowedTabs.map(tab => {
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

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                <button onClick={() => setPrivacyMode(v => !v)}
                    className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] transform-gpu border ${
                        privacyMode
                            ? 'bg-slate-700 text-white border-slate-700 shadow-[0_3px_8px_rgba(0,0,0,0.25)]'
                            : 'bg-white/50 text-slate-500 border-white/80 hover:bg-white hover:shadow-md hover:text-slate-700'
                    }`}>
                    {privacyMode ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
                </button>
                <button onClick={openSearch}
                    className="w-10 h-10 md:w-11 md:h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-300 hover:bg-[#003D99] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu relative">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={TrendingUp} title="Ventas" filtersContent={filtersContent}>
            {/* Ventas: always mounted — it owns the PeriodPicker and stats cards */}
            <div className={activeTab === 'ventas' ? '' : 'hidden'}>
                <TabVentas branches={salesBranches} filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    employees={employees} branchOptions={branchOptions} privacyMode={privacyMode} />
            </div>

            {/* Vendedores + Productos: unmount when not active so their useEffects don't
                fire on every filter change while the user is on a different tab.
                localStorage cache in TabProductos ensures instant return on re-visit. */}
            {activeTab === 'vendedores' && (
                <TabVendedores branches={salesBranches} filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    employees={employees} searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    branchOptions={branchOptions} privacyMode={privacyMode} />
            )}
            {activeTab === 'productos' && (
                <TabProductos filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    branchOptions={branchOptions} privacyMode={privacyMode} />
            )}
        </GlassViewLayout>
    );
}
