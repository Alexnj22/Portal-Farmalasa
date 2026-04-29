import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    TrendingUp, AlertTriangle, Users, Package,
    RefreshCw, Clock, Building2, Loader2, ChevronDown,
    ChevronUp, BarChart2, ShoppingCart, DollarSign,
    FileX, BadgeAlert, Search, X, Trophy, Star
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';

// ─── Constants ────────────────────────────────────────────────────────────────
const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const fmt = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) => parseInt(n || 0).toLocaleString('en-US');

function timeAgo(fecha, hora) {
    const dt = new Date(`${fecha}T${hora}`);
    const now = new Date(Date.now() - 6 * 3600_000); // CST
    const mins = Math.floor((now - dt) / 60000);
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${Math.floor(mins / 1440)}d`;
}

function currentMonthRange() {
    const now = new Date(Date.now() - 6 * 3600_000);
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const pad = (n) => String(n).padStart(2, '0');
    const lastDay = new Date(y, m, 0).getDate();
    return { fini: `${y}-${pad(m)}-01`, ffin: `${y}-${pad(m)}-${pad(lastDay)}`, label: `${y}-${pad(m)}` };
}

function monthOptions() {
    const opts = [];
    const now = new Date(Date.now() - 6 * 3600_000);
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const pad = (n) => String(n).padStart(2, '0');
        const lastDay = new Date(y, m, 0).getDate();
        const label = d.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
        opts.push({
            value: `${y}-${pad(m)}-01|${y}-${pad(m)}-${pad(lastDay)}`,
            label: label.charAt(0).toUpperCase() + label.slice(1)
        });
    }
    return opts;
}

// ─── Tab: Anulaciones ─────────────────────────────────────────────────────────
function TabAnulaciones({ branches, filterBranch }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);
    const [search, setSearch] = useState('');

    const fetch = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, cliente, fecha, hora, total, estado, cod_vendedor, codigo_generacion')
            .eq('estado', 'NULA')
            .order('tipo_documento', { ascending: false }) // CCF antes que COF
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLastRefresh(new Date());
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { fetch(); }, [fetch]);
    useEffect(() => {
        const id = setInterval(fetch, 60_000);
        return () => clearInterval(id);
    }, [fetch]);

    const filtered = useMemo(() => {
        if (!search) return rows;
        const s = search.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.codigo_generacion?.toLowerCase().includes(s)
        );
    }, [rows, search]);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    const ccf = filtered.filter(r => r.tipo_documento === 'CCF');
    const cof = filtered.filter(r => r.tipo_documento !== 'CCF');

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                    <p className="text-xs text-red-500 font-medium mb-1">Total Pendientes</p>
                    <p className="text-2xl font-bold text-red-700">{rows.length}</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                    <p className="text-xs text-orange-500 font-medium mb-1">CCF Urgentes</p>
                    <p className="text-2xl font-bold text-orange-700">{rows.filter(r => r.tipo_documento === 'CCF').length}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hidden md:block">
                    <p className="text-xs text-slate-500 font-medium mb-1">Última actualización</p>
                    <p className="text-sm font-semibold text-slate-700">
                        {lastRefresh ? lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar correlativo, cliente o código..."
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-blue-400"
                />
                {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <BadgeAlert size={40} className="mx-auto mb-3 text-emerald-400" />
                    <p className="font-medium text-emerald-600">Sin anulaciones pendientes</p>
                    <p className="text-sm mt-1">Todas las facturas están correctas</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {ccf.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold text-red-600 uppercase tracking-wider">CCF — Urgente</span>
                                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{ccf.length}</span>
                            </div>
                            <AnulacionTable rows={ccf} getBranch={getBranch} urgent />
                        </div>
                    )}
                    {cof.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Consumidor Final</span>
                                <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">{cof.length}</span>
                            </div>
                            <AnulacionTable rows={cof} getBranch={getBranch} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AnulacionTable({ rows, getBranch, urgent }) {
    return (
        <div className={`rounded-2xl border overflow-hidden ${urgent ? 'border-red-200' : 'border-slate-200'}`}>
            <table className="w-full text-sm">
                <thead>
                    <tr className={`text-xs font-semibold uppercase tracking-wide ${urgent ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
                        <th className="text-left px-4 py-3">Correlativo</th>
                        <th className="text-left px-4 py-3 hidden md:table-cell">Sucursal</th>
                        <th className="text-left px-4 py-3 hidden lg:table-cell">Cliente</th>
                        <th className="text-left px-4 py-3">Fecha</th>
                        <th className="text-right px-4 py-3">Total</th>
                        <th className="text-right px-4 py-3">Tiempo</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r.id} className={`border-t ${urgent ? 'border-red-100 hover:bg-red-50/50' : 'border-slate-100 hover:bg-slate-50/50'} transition-colors`}>
                            <td className="px-4 py-3 font-mono text-xs">{r.correlativo}</td>
                            <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-xs">{getBranch(r.branch_id)}</td>
                            <td className="px-4 py-3 hidden lg:table-cell text-slate-600 text-xs truncate max-w-[180px]">{r.cliente || '—'}</td>
                            <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{r.fecha}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(r.total)}</td>
                            <td className="px-4 py-3 text-right">
                                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {timeAgo(r.fecha, r.hora)}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, employees }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(null);
    const [expandedData, setExpandedData] = useState([]);
    const [loadingExpand, setLoadingExpand] = useState(false);
    const [monthRange, setMonthRange] = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });

    const [fini, ffin] = monthRange.split('|');

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(`${e.branch_id}::${e.code}`, e));
        return m;
    }, [employees]);

    const fetchVendedores = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoices')
            .select('branch_id, cod_vendedor, total, id')
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")')
            .gte('fecha', fini)
            .lte('fecha', ffin);
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;

        const agg = new Map();
        for (const row of (data || [])) {
            const key = `${row.branch_id}::${row.cod_vendedor}`;
            const cur = agg.get(key) || { branch_id: row.branch_id, cod_vendedor: row.cod_vendedor, total: 0, count: 0 };
            cur.total += parseFloat(row.total || 0);
            cur.count += 1;
            agg.set(key, cur);
        }

        const sorted = [...agg.values()].sort((a, b) => b.total - a.total);
        setRows(sorted);
        setLoading(false);
    }, [fini, ffin, filterBranch]);

    useEffect(() => { fetchVendedores(); }, [fetchVendedores]);

    const toggleExpand = async (key, branchId, cod) => {
        if (expanded === key) { setExpanded(null); return; }
        setExpanded(key);
        setLoadingExpand(true);
        const { data } = await supabase
            .from('sales_invoices')
            .select('fecha, total, tipo_documento, estado')
            .eq('branch_id', branchId)
            .eq('cod_vendedor', cod)
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")')
            .gte('fecha', fini)
            .lte('fecha', ffin)
            .order('fecha');
        // Group by day
        const byDay = new Map();
        for (const row of (data || [])) {
            const cur = byDay.get(row.fecha) || { fecha: row.fecha, total: 0, count: 0 };
            cur.total += parseFloat(row.total || 0);
            cur.count += 1;
            byDay.set(row.fecha, cur);
        }
        setExpandedData([...byDay.values()]);
        setLoadingExpand(false);
    };

    const getBranchName = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    const totalVentas = rows.reduce((s, r) => s + r.total, 0);
    const totalFacturas = rows.reduce((s, r) => s + r.count, 0);

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Month filter */}
            <div className="flex items-center gap-3 flex-wrap">
                <LiquidSelect
                    value={monthRange}
                    onChange={setMonthRange}
                    options={monthOptions()}
                    placeholder="Seleccionar mes..."
                    icon={Clock}
                    clearable={false}
                    compact
                />
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs text-blue-500 font-medium mb-1">Vendedores activos</p>
                    <p className="text-2xl font-bold text-blue-700">{rows.length}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                    <p className="text-xs text-emerald-500 font-medium mb-1">Total ventas</p>
                    <p className="text-2xl font-bold text-emerald-700">{fmt(totalVentas)}</p>
                </div>
                <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
                    <p className="text-xs text-violet-500 font-medium mb-1">Total facturas</p>
                    <p className="text-2xl font-bold text-violet-700">{fmtNum(totalFacturas)}</p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <th className="text-left px-4 py-3 w-8">#</th>
                                <th className="text-left px-4 py-3">Vendedor</th>
                                <th className="text-left px-4 py-3 hidden md:table-cell">Sucursal</th>
                                <th className="text-right px-4 py-3">Facturas</th>
                                <th className="text-right px-4 py-3">Total Ventas</th>
                                <th className="text-right px-4 py-3 hidden md:table-cell">Ticket Prom.</th>
                                <th className="px-4 py-3 w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const key = `${r.branch_id}::${r.cod_vendedor}`;
                                const emp = empMap.get(key);
                                const isOpen = expanded === key;
                                const ticket = r.count > 0 ? r.total / r.count : 0;
                                const pct = totalVentas > 0 ? (r.total / totalVentas) * 100 : 0;

                                return (
                                    <React.Fragment key={key}>
                                        <tr
                                            className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
                                            onClick={() => toggleExpand(key, r.branch_id, r.cod_vendedor)}
                                        >
                                            <td className="px-4 py-3">
                                                {i === 0 ? <Trophy size={16} className="text-yellow-500" />
                                                    : i === 1 ? <Trophy size={16} className="text-slate-400" />
                                                    : i === 2 ? <Trophy size={16} className="text-amber-600" />
                                                    : <span className="text-xs text-slate-400 font-medium">{i + 1}</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    {emp ? (
                                                        <LiquidAvatar employee={emp} size={32} />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                                                            <Users size={14} className="text-slate-400" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="font-medium text-slate-800 text-sm">
                                                            {emp ? `${emp.first_names} ${emp.last_names}` : `Vendedor ${r.cod_vendedor}`}
                                                        </p>
                                                        <p className="text-xs text-slate-400">Cód. {r.cod_vendedor}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-xs">{getBranchName(r.branch_id)}</td>
                                            <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtNum(r.count)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div>
                                                    <span className="font-bold text-slate-800">{fmt(r.total)}</span>
                                                    <div className="mt-1 h-1 rounded-full bg-slate-100">
                                                        <div className="h-1 rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right hidden md:table-cell text-slate-600">{fmt(ticket)}</td>
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
                                                            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Ventas diarias</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {expandedData.map(d => (
                                                                    <div key={d.fecha} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs">
                                                                        <p className="text-slate-500">{new Date(d.fecha + 'T12:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</p>
                                                                        <p className="font-bold text-slate-800">{fmt(d.total)}</p>
                                                                        <p className="text-slate-400">{d.count} fact.</p>
                                                                    </div>
                                                                ))}
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
            )}
        </div>
    );
}

// ─── Tab: Productos ───────────────────────────────────────────────────────────
function TabProductos({ filterBranch }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [monthRange, setMonthRange] = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });

    const [fini, ffin] = monthRange.split('|');

    const fetchProductos = useCallback(async () => {
        setLoading(true);
        // Get invoice IDs for the period/branch
        let qInv = supabase
            .from('sales_invoices')
            .select('id')
            .not('estado', 'in', '("NULA","DTE INVALIDADO EN MH")')
            .gte('fecha', fini)
            .lte('fecha', ffin);
        if (filterBranch) qInv = qInv.eq('branch_id', Number(filterBranch));
        const { data: invoices } = await qInv;
        const ids = (invoices || []).map(i => i.id);

        if (ids.length === 0) { setRows([]); setLoading(false); return; }

        // Paginate items in chunks of 1000 IDs
        const CHUNK = 1000;
        const itemsAll = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const { data: items } = await supabase
                .from('sales_invoice_items')
                .select('erp_product_id, descripcion, presentacion, cantidad, total_linea')
                .in('invoice_id', chunk);
            if (items) itemsAll.push(...items);
        }

        // Aggregate
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
            };
            cur.cantidad += parseInt(item.cantidad || 0);
            cur.total += parseFloat(item.total_linea || 0);
            cur.lineas += 1;
            agg.set(key, cur);
        }

        const sorted = [...agg.values()].sort((a, b) => b.total - a.total).slice(0, 100);
        setRows(sorted);
        setLoading(false);
    }, [fini, ffin, filterBranch]);

    useEffect(() => { fetchProductos(); }, [fetchProductos]);

    const filtered = useMemo(() => {
        if (!search) return rows;
        const s = search.toLowerCase();
        return rows.filter(r => r.descripcion?.toLowerCase().includes(s) || r.presentacion?.toLowerCase().includes(s));
    }, [rows, search]);

    const maxTotal = filtered[0]?.total || 1;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <LiquidSelect
                    value={monthRange}
                    onChange={setMonthRange}
                    options={monthOptions()}
                    placeholder="Seleccionar mes..."
                    icon={Clock}
                    clearable={false}
                    compact
                />
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar producto..."
                        className="w-full pl-8 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-blue-400"
                    />
                    {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Package size={40} className="mx-auto mb-3" />
                    <p>Sin datos para este período</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <th className="text-left px-4 py-3 w-8">#</th>
                                <th className="text-left px-4 py-3">Producto</th>
                                <th className="text-right px-4 py-3 hidden md:table-cell">Unidades</th>
                                <th className="text-right px-4 py-3">Total Vendido</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r, i) => {
                                const pct = (r.total / maxTotal) * 100;
                                return (
                                    <tr key={r.erp_product_id || i} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                                        <td className="px-4 py-3">
                                            {i === 0 ? <Star size={15} className="text-yellow-500 fill-yellow-400" />
                                                : <span className="text-xs text-slate-400 font-medium">{i + 1}</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-slate-800">{r.descripcion}</p>
                                            {r.presentacion && <p className="text-xs text-slate-400 mt-0.5">{r.presentacion}</p>}
                                        </td>
                                        <td className="px-4 py-3 text-right hidden md:table-cell font-medium text-slate-700">{fmtNum(r.cantidad)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="font-bold text-slate-800">{fmt(r.total)}</span>
                                            <div className="mt-1 h-1 rounded-full bg-slate-100">
                                                <div className="h-1 rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                                            </div>
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
    { key: 'anulaciones', label: 'Anulaciones', icon: AlertTriangle },
    { key: 'vendedores',  label: 'Vendedores',  icon: Users },
    { key: 'productos',   label: 'Productos',   icon: Package },
];

export default function VentasView() {
    const { branches, employees } = useStaff();
    const [activeTab, setActiveTab] = useState('anulaciones');
    const [filterBranch, setFilterBranch] = useState('');

    const salesBranches = useMemo(() =>
        (branches || []).filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const filtersContent = (
        <div className="flex items-center bg-white/40 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-visible">

            {/* Tabs */}
            <div className="flex items-center gap-1 px-1 md:px-2 h-full">
                {TABS.map(t => {
                    const Icon = t.icon;
                    const active = activeTab === t.key;
                    return (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`flex items-center gap-1.5 h-10 md:h-11 px-3 md:px-4 rounded-full text-[11px] md:text-[12px] font-black uppercase tracking-widest transition-all duration-300 shrink-0 ${
                                active
                                    ? 'bg-[#007AFF] text-white shadow-[0_3px_8px_rgba(0,122,255,0.4)] hover:shadow-[0_6px_16px_rgba(0,122,255,0.4)] hover:scale-105 active:scale-95'
                                    : 'bg-white/60 text-slate-500 hover:bg-white hover:text-slate-700 border border-white shadow-sm hover:-translate-y-0.5'
                            }`}
                        >
                            <Icon size={13} strokeWidth={2.5} />
                            <span className="hidden sm:inline">{t.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Divider */}
            <div className="h-8 w-px bg-white/40 mx-1 md:mx-2 shrink-0" />

            {/* Branch select */}
            <div className="w-[160px] md:w-[220px] overflow-visible h-full flex items-center px-1">
                <LiquidSelect
                    value={filterBranch}
                    onChange={setFilterBranch}
                    options={branchOptions}
                    placeholder="Todas las sucursales"
                    icon={Building2}
                    compact
                />
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={TrendingUp}
            title="Ventas"
            liveIndicator={activeTab === 'anulaciones'}
            filtersContent={filtersContent}
        >

            {activeTab === 'anulaciones' && (
                <TabAnulaciones
                    branches={salesBranches}
                    filterBranch={filterBranch}
                />
            )}
            {activeTab === 'vendedores' && (
                <TabVendedores
                    branches={salesBranches}
                    filterBranch={filterBranch}
                    employees={employees}
                />
            )}
            {activeTab === 'productos' && (
                <TabProductos
                    filterBranch={filterBranch}
                />
            )}
        </GlassViewLayout>
    );
}
