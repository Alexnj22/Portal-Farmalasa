import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    TrendingUp, TrendingDown, Users, Package, FileText,
    Clock, Building2, Loader2, ChevronDown,
    ChevronUp, Search, X, Trophy, Star, ChevronRight, ChevronLeft,
    ArrowUp, ArrowDown, Minus, Info
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';

// ─── Constants ────────────────────────────────────────────────────────────────
const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const PAGE_SIZE = 50;
const fmt    = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) => parseInt(n || 0).toLocaleString('en-US');
const fmtPct = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

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

function Pagination({ page, total, onChange }) {
    if (total <= 1) return null;
    return (
        <div className="flex items-center justify-center gap-2 py-2">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="w-8 h-8 rounded-full flex items-center justify-center border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronLeft size={14} />
            </button>
            <span className="text-[12px] font-bold text-slate-500">
                {page} / {total}
            </span>
            <button disabled={page >= total} onClick={() => onChange(page + 1)}
                className="w-8 h-8 rounded-full flex items-center justify-center border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

// ─── Tab: Ventas ──────────────────────────────────────────────────────────────
function TabVentas({ branches, filterBranch, searchTerm }) {
    const [rows, setRows]         = useState([]);
    const [loading, setLoading]   = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const [totalAmount, setTotalAmount] = useState(0);
    const [page, setPage]         = useState(1);
    const [expandedId, setExpandedId]     = useState(null);
    const [itemsCache, setItemsCache]     = useState({});
    const [loadingItems, setLoadingItems] = useState(false);
    const [monthRange, setMonthRange] = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });

    const [fini, ffin] = monthRange.split('|');
    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const fetchVentas = useCallback(async () => {
        setLoading(true);
        // Get total count + sum server-side (avoids 1000-row cap on client aggregation)
        let qStats = supabase
            .from('sales_invoices')
            .select('total.sum()', { count: 'exact' })
            .gte('fecha', fini).lte('fecha', ffin)
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")');
        if (filterBranch) qStats = qStats.eq('branch_id', Number(filterBranch));
        const { data: statsData, count } = await qStats;
        setTotalCount(count || 0);
        setTotalAmount(parseFloat(statsData?.[0]?.sum || 0));

        // Get paginated rows
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, erp_invoice_id, correlativo, tipo_documento, fecha, hora, cliente, tipo_pago, subtotal, iva, total')
            .gte('fecha', fini).lte('fecha', ffin)
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")')
            .order('fecha', { ascending: false })
            .order('hora', { ascending: false })
            .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLoading(false);
    }, [fini, ffin, filterBranch, page]);

    useEffect(() => { fetchVentas(); }, [fetchVentas]);
    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch]);

    const toggleRow = useCallback(async (invoiceId) => {
        if (expandedId === invoiceId) { setExpandedId(null); return; }
        setExpandedId(invoiceId);
        if (itemsCache[invoiceId]) return;
        setLoadingItems(true);
        const { data } = await supabase
            .from('sales_invoice_items')
            .select('descripcion, presentacion, cantidad, precio_unitario, total_linea')
            .eq('invoice_id', invoiceId)
            .order('total_linea', { ascending: false });
        setItemsCache(prev => ({ ...prev, [invoiceId]: data || [] }));
        setLoadingItems(false);
    }, [expandedId, itemsCache]);

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.erp_invoice_id?.toLowerCase().includes(s)
        );
    }, [rows, searchTerm]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const avgTicket  = totalCount > 0 ? totalAmount / totalCount : 0;

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex items-center gap-3">
                <LiquidSelect value={monthRange} onChange={v => { setMonthRange(v); setPage(1); }}
                    options={monthOptions()} placeholder="Seleccionar mes..." icon={Clock} clearable={false} compact />
            </div>

            {/* Stats strip */}
            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { label: 'Facturas',      value: fmtNum(totalCount),  icon: FileText,   grad: 'from-blue-500 to-indigo-500',    text: 'text-blue-700' },
                    { label: 'Total Ventas',  value: fmt(totalAmount),    icon: TrendingUp, grad: 'from-emerald-500 to-teal-400',  text: 'text-emerald-700' },
                    { label: 'Ticket Prom.',  value: fmt(avgTicket),      icon: TrendingUp, grad: 'from-slate-500 to-slate-400',   text: 'text-slate-700' },
                ].map(({ label, value, icon: Icon, grad, text }) => (
                    <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-white">
                        <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                            <Icon size={11} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                        <span className={`text-[15px] font-black leading-none ${text}`}>{value}</span>
                    </div>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <TrendingUp size={40} className="mx-auto mb-3" />
                    <p className="font-medium">Sin ventas para este período</p>
                </div>
            ) : (
                <>
                    <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-black/[0.06]">
                                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Fecha</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hidden md:table-cell">ID / Correlativo</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hidden lg:table-cell">Sucursal</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cliente</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hidden sm:table-cell">Tipo</th>
                                    <th className="text-right px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => {
                                    const isCCF = r.tipo_documento === 'CCF';
                                    const isExpanded = expandedId === r.id;
                                    const items = itemsCache[r.id] || [];
                                    return (
                                        <React.Fragment key={r.id}>
                                            <tr onClick={() => toggleRow(r.id)}
                                                className={`border-t border-black/[0.04] cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'}`}>
                                                <td className="px-4 py-2.5">
                                                    <p className="text-[12px] font-bold text-slate-700">{r.fecha}</p>
                                                    {r.hora && <p className="text-[10px] text-slate-400">{r.hora?.slice(0, 5)}</p>}
                                                </td>
                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    {r.erp_invoice_id && <p className="font-mono text-[11px] font-black text-slate-500">#{r.erp_invoice_id}</p>}
                                                    <p className="font-mono text-[10px] text-slate-400">{r.correlativo}</p>
                                                </td>
                                                <td className="px-4 py-2.5 text-[11px] text-slate-600 hidden lg:table-cell">{getBranch(r.branch_id)}</td>
                                                <td className="px-4 py-2.5">
                                                    <p className="text-[12px] text-slate-700 truncate max-w-[180px]">{r.cliente || '—'}</p>
                                                </td>
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${isCCF ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{r.tipo_documento}</span>
                                                    {r.tipo_pago && <p className="text-[10px] text-slate-400 mt-0.5">{r.tipo_pago}</p>}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <p className={`text-[13px] font-black ${isCCF ? 'text-red-700' : 'text-slate-800'}`}>{fmt(r.total)}</p>
                                                        <ChevronDown size={12} className={`text-slate-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="border-t border-blue-100">
                                                    <td colSpan={6} className="px-4 py-3 bg-blue-50/40">
                                                        {loadingItems && items.length === 0 ? (
                                                            <div className="flex items-center gap-2 text-[11px] text-slate-400 py-1">
                                                                <Loader2 size={12} className="animate-spin" /> Cargando productos...
                                                            </div>
                                                        ) : items.length === 0 ? (
                                                            <p className="text-[11px] text-slate-400 py-1">Sin detalle de productos disponible.</p>
                                                        ) : (
                                                            <table className="w-full text-[11px]">
                                                                <thead>
                                                                    <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                                                        <th className="text-left pb-1.5">Producto</th>
                                                                        <th className="text-right pb-1.5">Cant.</th>
                                                                        <th className="text-right pb-1.5 hidden sm:table-cell">Precio Unit.</th>
                                                                        <th className="text-right pb-1.5">Total</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-blue-100">
                                                                    {items.map((it, idx) => (
                                                                        <tr key={idx}>
                                                                            <td className="py-1.5 pr-4">
                                                                                <p className="font-semibold text-slate-700 leading-tight">{it.descripcion}</p>
                                                                                {it.presentacion && <p className="text-[10px] text-slate-400">{it.presentacion}</p>}
                                                                            </td>
                                                                            <td className="py-1.5 text-right font-bold text-slate-600">{it.cantidad}</td>
                                                                            <td className="py-1.5 text-right text-slate-500 hidden sm:table-cell">{fmt(it.precio_unitario)}</td>
                                                                            <td className="py-1.5 text-right font-black text-slate-700">{fmt(it.total_linea)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
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
                    <Pagination page={page} total={totalPages} onChange={setPage} />
                </>
            )}
        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, employees, searchTerm }) {
    const [rows, setRows]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [expanded, setExpanded]       = useState(null);
    const [expandedData, setExpandedData] = useState([]);
    const [loadingExpand, setLoadingExpand] = useState(false);
    const [monthRange, setMonthRange]   = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });
    // Historical rankings
    const [historial, setHistorial]     = useState(null);
    const [loadingHist, setLoadingHist] = useState(false);
    const [showHist, setShowHist]       = useState(false);

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

    // Load historical rankings for last 6 months
    const loadHistorial = useCallback(async () => {
        setLoadingHist(true);
        const months = monthOptions(6);
        const results = await Promise.all(months.map(async (m) => {
            const [f, l] = m.value.split('|');
            const { data } = await supabase.rpc('get_vendedores_resumen', {
                p_fini: f, p_ffin: l,
                p_branch_id: filterBranch ? Number(filterBranch) : null,
            });
            const byVend = new Map();
            for (const r of (data || [])) {
                const cur = byVend.get(r.cod_vendedor) || { cod_vendedor: r.cod_vendedor, total: 0, count: 0 };
                cur.total += parseFloat(r.total_ventas || 0);
                cur.count += parseInt(r.total_facturas || 0);
                byVend.set(r.cod_vendedor, cur);
            }
            const ranked = [...byVend.values()]
                .filter(v => v.cod_vendedor !== '1000' && v.cod_vendedor !== '125')
                .sort((a, b) => b.total - a.total)
                .map((v, i) => ({ ...v, rank: i + 1 }));
            return { label: m.label, value: m.value, ranked };
        }));
        setHistorial(results);
        setLoadingHist(false);
    }, [filterBranch]);

    useEffect(() => {
        if (showHist) loadHistorial();
    }, [showHist, loadHistorial]);

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

    // Build rank map from previous month (historial[1]) for trend arrows
    const prevRankMap = useMemo(() => {
        if (!historial || historial.length < 2) return new Map();
        const m = new Map();
        for (const v of historial[1].ranked) m.set(v.cod_vendedor, v.rank);
        return m;
    }, [historial]);

    const totalVentas   = rows.reduce((s, r) => s + r.total, 0);
    const totalFacturas = rows.reduce((s, r) => s + r.count, 0);

    const TrendBadge = ({ cod, currentRank }) => {
        const prev = prevRankMap.get(cod);
        if (!showHist || prev == null) return null;
        const diff = prev - currentRank; // positive = improved (lower rank number)
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
            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
                <LiquidSelect value={monthRange} onChange={v => { setMonthRange(v); setExpanded(null); }}
                    options={monthOptions()} placeholder="Seleccionar mes..." icon={Clock} clearable={false} compact />
                <button onClick={() => setShowHist(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${showHist ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                    <TrendingUp size={12} /> Historial
                </button>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { label: 'Vendedores',   value: knownRows.length,       icon: Users,      grad: 'from-blue-500 to-indigo-500',  text: 'text-blue-700' },
                    { label: 'Total Ventas', value: fmt(totalVentas),        icon: TrendingUp, grad: 'from-emerald-500 to-teal-400', text: 'text-emerald-700' },
                    { label: 'Facturas',     value: fmtNum(totalFacturas),   icon: FileText,   grad: 'from-slate-500 to-slate-400',  text: 'text-slate-700' },
                ].map(({ label, value, icon: Icon, grad, text }) => (
                    <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-white">
                        <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                            <Icon size={11} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                        <span className={`text-[15px] font-black leading-none ${text}`}>{value}</span>
                    </div>
                ))}
                {unknownByBranch.size > 0 && (
                    <span className="text-[10px] text-orange-500 font-bold ml-2">{unknownByBranch.size} suc. con cód. incorrecto</span>
                )}
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

            {/* ── Historial Rankings ── */}
            {showHist && (
                <div className="rounded-2xl border border-black/[0.07] bg-white shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-black/[0.05] bg-slate-50/60 flex items-center gap-2">
                        <TrendingUp size={14} className="text-slate-500" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Ranking histórico · últimos 6 meses</span>
                    </div>
                    {loadingHist ? (
                        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
                    ) : historial ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[700px]">
                                <thead>
                                    <tr className="border-b border-black/[0.05]">
                                        <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 w-52">Vendedor</th>
                                        {historial.map((m, i) => (
                                            <th key={i} className="text-center px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                                                {m.label.split(' ')[0].slice(0, 3)} {m.label.split(' ').pop()}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Build unified vendor list from most recent month */}
                                    {(historial[0]?.ranked || []).slice(0, 20).map(v => {
                                        const emp = empMap.get(v.cod_vendedor);
                                        const name = SPECIAL_CODES[v.cod_vendedor] ||
                                            (emp ? `${emp.first_names} ${emp.last_names}` : `Cód. ${v.cod_vendedor}`);
                                        return (
                                            <tr key={v.cod_vendedor} className="border-t border-black/[0.04] hover:bg-slate-50/50 transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        {emp ? (
                                                            <LiquidAvatar src={emp.photo_url || emp.photo}
                                                                fallbackText={emp.first_names}
                                                                className="w-6 h-6 rounded-full shrink-0" />
                                                        ) : (
                                                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                                <Users size={11} className="text-slate-400" />
                                                            </div>
                                                        )}
                                                        <span className="text-[12px] font-semibold text-slate-700 truncate max-w-[140px]">{name}</span>
                                                    </div>
                                                </td>
                                                {historial.map((m, mi) => {
                                                    const mEntry = m.ranked.find(x => x.cod_vendedor === v.cod_vendedor);
                                                    const rank   = mEntry?.rank;
                                                    const prevRank = historial[mi + 1]?.ranked.find(x => x.cod_vendedor === v.cod_vendedor)?.rank;
                                                    const diff = prevRank != null && rank != null ? prevRank - rank : null;
                                                    const rankColor = rank === 1 ? 'text-yellow-600 font-black' : rank === 2 ? 'text-slate-500 font-black' : rank === 3 ? 'text-amber-600 font-black' : 'text-slate-600 font-bold';
                                                    return (
                                                        <td key={mi} className="px-3 py-2.5 text-center">
                                                            {rank != null ? (
                                                                <div className="flex flex-col items-center gap-0.5">
                                                                    <span className={`text-[13px] ${rankColor}`}>#{rank}</span>
                                                                    {diff != null && (
                                                                        diff > 0 ? <span className="flex items-center text-[9px] font-black text-emerald-600"><ArrowUp size={8} />{diff}</span>
                                                                        : diff < 0 ? <span className="flex items-center text-[9px] font-black text-red-500"><ArrowDown size={8} />{Math.abs(diff)}</span>
                                                                        : <Minus size={8} className="text-slate-300" />
                                                                    )}
                                                                    <span className="text-[10px] text-slate-400">{fmt(mEntry.total)}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-200 text-[11px]">—</span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

// ─── Tab: Productos ───────────────────────────────────────────────────────────
function TabProductos({ filterBranch, searchTerm }) {
    const [rows, setRows]       = useState([]);
    const [loading, setLoading] = useState(true);
    const [monthRange, setMonthRange] = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });

    const [fini, ffin] = monthRange.split('|');

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

        // Aggregate by product
        const agg = new Map();
        for (const item of itemsAll) {
            const key = item.erp_product_id || item.descripcion;
            const cur = agg.get(key) || {
                erp_product_id: item.erp_product_id,
                descripcion: item.descripcion,
                presentacion: item.presentacion,
                cantidad: 0,
                total: 0,
                lineas: 0,
                precioProm: 0, // weighted avg precio_unitario for cost matching
                _precioSum: 0,
            };
            cur.cantidad   += parseInt(item.cantidad || 0);
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

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r => r.descripcion?.toLowerCase().includes(s) || r.presentacion?.toLowerCase().includes(s));
    }, [rows, searchTerm]);

    const maxTotal   = filtered[0]?.total || 1;
    const totIngresos = filtered.reduce((s, r) => s + r.total, 0);
    const totUtilidad = filtered.filter(r => r.utilidad != null).reduce((s, r) => s + r.utilidad, 0);
    const totCosto    = filtered.filter(r => r.costo_total != null).reduce((s, r) => s + r.costo_total, 0);
    const margenGlobal = totIngresos > 0 ? (totUtilidad / totIngresos) * 100 : 0;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <LiquidSelect value={monthRange} onChange={setMonthRange}
                    options={monthOptions()} placeholder="Seleccionar mes..." icon={Clock} clearable={false} compact />
            </div>

            {/* Stats */}
            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { label: 'Ingresos',  value: fmt(totIngresos),   icon: TrendingUp,   grad: 'from-blue-500 to-indigo-500',   text: 'text-blue-700' },
                    { label: 'Costo',     value: fmt(totCosto),      icon: TrendingDown, grad: 'from-red-500 to-orange-400',    text: 'text-red-700' },
                    { label: 'Utilidad',  value: fmt(totUtilidad),   icon: TrendingUp,   grad: 'from-emerald-500 to-teal-400',  text: 'text-emerald-700' },
                    { label: 'Margen',    value: fmtPct(margenGlobal), icon: Star,        grad: 'from-amber-500 to-yellow-400',  text: 'text-amber-700' },
                ].map(({ label, value, icon: Icon, grad, text }) => (
                    <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-white">
                        <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                            <Icon size={11} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                        <span className={`text-[15px] font-black leading-none ${text}`}>{value}</span>
                    </div>
                ))}
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
                        <thead>
                            <tr className="bg-slate-50 border-b border-black/[0.06] text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="text-left px-4 py-3 w-8">#</th>
                                <th className="text-left px-4 py-3">Producto</th>
                                <th className="text-right px-4 py-3 hidden md:table-cell">Unidades</th>
                                <th className="text-right px-4 py-3">Ingresos</th>
                                <th className="text-right px-4 py-3 hidden lg:table-cell">Costo Est.</th>
                                <th className="text-right px-4 py-3 hidden sm:table-cell">Utilidad</th>
                                <th className="text-right px-4 py-3">Margen</th>
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
    const [activeTab, setActiveTab]     = useState('ventas');
    const [filterBranch, setFilterBranch] = useState('');
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

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                <div className="w-[150px] md:w-[200px] overflow-visible h-full flex items-center">
                    <LiquidSelect value={filterBranch} onChange={setFilterBranch}
                        options={branchOptions} placeholder="Todas" icon={Building2} compact />
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
                <TabVentas branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} />
            </div>
            <div className={activeTab === 'vendedores' ? '' : 'hidden'}>
                <TabVendedores branches={salesBranches} filterBranch={filterBranch}
                    employees={employees} searchTerm={rawSearch} />
            </div>
            <div className={activeTab === 'productos' ? '' : 'hidden'}>
                <TabProductos filterBranch={filterBranch} searchTerm={rawSearch} />
            </div>
        </GlassViewLayout>
    );
}
