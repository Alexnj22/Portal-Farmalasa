import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    TrendingUp, AlertTriangle, Users, Package,
    Clock, Building2, Loader2, ChevronDown,
    ChevronUp, BadgeAlert, Search, X, Trophy, Star, ChevronRight, History
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
    const horaStr = hora?.length === 5 ? `${hora}:00` : hora;
    const dt = new Date(`${fecha}T${horaStr}-06:00`); // hora almacenada en CST
    const mins = Math.floor((Date.now() - dt.getTime()) / 60000);
    if (mins < 0) return '—';
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
function TabAnulaciones({ branches, filterBranch, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado, cod_vendedor, codigo_generacion')
            .or('estado.eq.NULA,estado.is.null,estado.eq.undefined')
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
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.codigo_generacion?.toLowerCase().includes(s)
        );
    }, [rows, searchTerm]);

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
                        <th className="text-left px-4 py-3 hidden sm:table-cell">ID Venta</th>
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
                            <td className="px-4 py-3 hidden sm:table-cell font-mono text-xs text-slate-500">{r.erp_invoice_id || '—'}</td>
                            <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-xs">{getBranch(r.branch_id)}</td>
                            <td className="px-4 py-3 hidden lg:table-cell text-slate-600 text-xs truncate max-w-[180px]">{r.cliente || '—'}</td>
                            <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{r.fecha}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(r.total)}</td>
                            <td className="px-4 py-3 text-right space-y-1">
                                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {timeAgo(r.fecha, r.hora)}
                                </span>
                                {(r.estado === null || r.estado === 'undefined') && (
                                    <span className="block text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-md text-center">UNDEFINED</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, employees, searchTerm }) {
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

    const filteredRows = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r => {
            const emp = empMap.get(`${r.branch_id}::${r.cod_vendedor}`);
            const name = emp ? `${emp.first_names} ${emp.last_names}`.toLowerCase() : '';
            return name.includes(s) || r.cod_vendedor?.toLowerCase().includes(s);
        });
    }, [rows, searchTerm, empMap]);

    const totalVentas = filteredRows.reduce((s, r) => s + r.total, 0);
    const totalFacturas = filteredRows.reduce((s, r) => s + r.count, 0);

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
                            {filteredRows.map((r, i) => {
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
function TabProductos({ filterBranch, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
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
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r => r.descripcion?.toLowerCase().includes(s) || r.presentacion?.toLowerCase().includes(s));
    }, [rows, searchTerm]);

    const maxTotal = filtered[0]?.total || 1;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex items-center gap-3">
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

// ─── Tab: Integridad ─────────────────────────────────────────────────────────
function TabIntegridad({ branches, filterBranch }) {
    const [gaps, setGaps] = useState([]);
    const [nulls, setNulls] = useState([]);
    const [loading, setLoading] = useState(true);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            let qGaps = supabase.from('sales_invoice_gaps').select('*');
            let qNulls = supabase.from('sales_invoice_nulls').select('*');
            if (filterBranch) {
                qGaps  = qGaps.eq('branch_id', Number(filterBranch));
                qNulls = qNulls.eq('branch_id', Number(filterBranch));
            }
            const [{ data: gData }, { data: nData }] = await Promise.all([qGaps, qNulls]);
            setGaps(gData || []);
            setNulls(nData || []);
            setLoading(false);
        };
        load();
    }, [filterBranch]);

    if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className={`border rounded-2xl p-4 ${gaps.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className={`text-xs font-medium mb-1 ${gaps.length > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>Saltos en correlativos</p>
                    <p className={`text-2xl font-bold ${gaps.length > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{gaps.length}</p>
                </div>
                <div className={`border rounded-2xl p-4 ${nulls.length > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className={`text-xs font-medium mb-1 ${nulls.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>Campos indefinidos</p>
                    <p className={`text-2xl font-bold ${nulls.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{nulls.length}</p>
                </div>
            </div>

            {/* Saltos */}
            <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Saltos en correlativos</p>
                {gaps.length === 0 ? (
                    <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">Sin saltos detectados</p>
                ) : (
                    <div className="rounded-2xl border border-orange-200 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-orange-50 text-xs font-semibold uppercase tracking-wide text-orange-700">
                                    <th className="text-left px-4 py-3">Sucursal</th>
                                    <th className="text-left px-4 py-3">Tipo</th>
                                    <th className="text-left px-4 py-3">Desde</th>
                                    <th className="text-left px-4 py-3">Hasta</th>
                                    <th className="text-right px-4 py-3">Faltantes</th>
                                    <th className="text-left px-4 py-3 hidden md:table-cell">Siguiente</th>
                                </tr>
                            </thead>
                            <tbody>
                                {gaps.map((g, i) => (
                                    <tr key={i} className="border-t border-orange-100 hover:bg-orange-50/50 transition-colors">
                                        <td className="px-4 py-3 text-xs text-slate-600">{getBranch(g.branch_id)}</td>
                                        <td className="px-4 py-3"><span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md">{g.tipo_documento}</span></td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{String(g.gap_from).padStart(7, '0')}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{String(g.gap_to).padStart(7, '0')}</td>
                                        <td className="px-4 py-3 text-right font-bold text-orange-700">{g.gap_count}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400 hidden md:table-cell">{g.siguiente_correlativo}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Nulos */}
            <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Campos indefinidos / nulos</p>
                {nulls.length === 0 ? (
                    <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">Sin registros con campos indefinidos</p>
                ) : (
                    <div className="rounded-2xl border border-red-200 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-red-50 text-xs font-semibold uppercase tracking-wide text-red-700">
                                    <th className="text-left px-4 py-3">Sucursal</th>
                                    <th className="text-left px-4 py-3">Correlativo</th>
                                    <th className="text-left px-4 py-3">Fecha</th>
                                    <th className="text-left px-4 py-3">Campos nulos</th>
                                </tr>
                            </thead>
                            <tbody>
                                {nulls.map((n) => (
                                    <tr key={n.id} className="border-t border-red-100 hover:bg-red-50/50 transition-colors">
                                        <td className="px-4 py-3 text-xs text-slate-600">{getBranch(n.branch_id)}</td>
                                        <td className="px-4 py-3 font-mono text-xs">{n.correlativo || n.erp_invoice_id || `ID ${n.id}`}</td>
                                        <td className="px-4 py-3 text-xs text-slate-600">{n.fecha || '—'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {(n.campos_nulos || []).map(c => (
                                                    <span key={c} className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-md">{c}</span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Tab: Cambios ─────────────────────────────────────────────────────────────
function TabCambios({ branches, filterBranch }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [limit, setLimit] = useState(50);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const load = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoice_changelog')
            .select('id, invoice_id, branch_id, tipo_documento, campo, valor_anterior, valor_nuevo, detected_at, codigo_generacion')
            .order('detected_at', { ascending: false })
            .limit(limit);
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLoading(false);
    }, [filterBranch, limit]);

    useEffect(() => { load(); }, [load]);

    const FIELD_LABELS = { estado: 'Estado', tipo_pago: 'Tipo Pago' };

    const BADGE = {
        estado: { old: 'bg-orange-100 text-orange-700', new: 'bg-emerald-100 text-emerald-700' },
        tipo_pago: { old: 'bg-slate-100 text-slate-600', new: 'bg-blue-100 text-blue-700' },
    };

    const badge = (campo, which, value) => {
        const colors = BADGE[campo]?.[which] || 'bg-slate-100 text-slate-600';
        return (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${colors}`}>
                {value || '—'}
            </span>
        );
    };

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs text-blue-500 font-medium mb-1">Cambios registrados</p>
                    <p className="text-2xl font-bold text-blue-700">{rows.length}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <p className="text-xs text-slate-500 font-medium mb-1">Mostrando últimos</p>
                    <p className="text-2xl font-bold text-slate-700">{limit}</p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : rows.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <History size={40} className="mx-auto mb-3" />
                    <p className="font-medium">Sin cambios registrados</p>
                    <p className="text-sm mt-1">Los cambios en estado y tipo de pago aparecerán aquí</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <th className="text-left px-4 py-3">Cuando</th>
                                <th className="text-left px-4 py-3 hidden md:table-cell">Sucursal</th>
                                <th className="text-left px-4 py-3">Correlativo</th>
                                <th className="text-left px-4 py-3 hidden sm:table-cell">Campo</th>
                                <th className="text-left px-4 py-3">Anterior</th>
                                <th className="text-left px-4 py-3">Nuevo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const dt = new Date(r.detected_at);
                                const dtStr = dt.toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                                return (
                                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{dtStr}</td>
                                        <td className="px-4 py-3 text-xs text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                                            <p>{r.tipo_documento || '—'} #{r.invoice_id}</p>
                                            {r.codigo_generacion && <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{r.codigo_generacion}</p>}
                                        </td>
                                        <td className="px-4 py-3 hidden sm:table-cell">
                                            <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md uppercase">
                                                {FIELD_LABELS[r.campo] || r.campo}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">{badge(r.campo, 'old', r.valor_anterior)}</td>
                                        <td className="px-4 py-3">{badge(r.campo, 'new', r.valor_nuevo)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {rows.length === limit && (
                        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-center">
                            <button
                                onClick={() => setLimit(l => l + 50)}
                                className="text-xs font-semibold text-[#007AFF] hover:underline">
                                Cargar más
                            </button>
                        </div>
                    )}
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
    { key: 'integridad',  label: 'Integridad',  icon: BadgeAlert },
    { key: 'cambios',     label: 'Cambios',     icon: History },
];

export default function VentasView() {
    const { branches, employees } = useStaff();
    const [activeTab, setActiveTab] = useState('anulaciones');
    const [filterBranch, setFilterBranch] = useState('');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearch, setRawSearch] = useState('');
    const searchInputRef = useRef(null);

    const salesBranches = useMemo(() =>
        (branches || []).filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const openSearch = () => {
        setIsSearchMode(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    const closeSearch = () => {
        setIsSearchMode(false);
        setRawSearch('');
    };

    const filtersContent = (
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={
                        activeTab === 'anulaciones' ? 'Buscar correlativo o cliente...' :
                        activeTab === 'vendedores'  ? 'Buscar vendedor...' :
                        'Buscar producto...'
                    }
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch}
                    onChange={e => setRawSearch(e.target.value)}
                />
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

                {/* Tab pills */}
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)}
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

                {/* Divider */}
                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                {/* Branch select */}
                <div className="w-[150px] md:w-[200px] overflow-visible h-full flex items-center">
                    <LiquidSelect
                        value={filterBranch}
                        onChange={setFilterBranch}
                        options={branchOptions}
                        placeholder="Todas"
                        icon={Building2}
                        compact
                    />
                </div>

                {/* Search button — hidden for tabs without text search */}
                {!['integridad', 'cambios'].includes(activeTab) && (
                    <>
                        <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                        <button onClick={openSearch}
                            className="w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transform-gpu relative">
                            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                            {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                        </button>
                    </>
                )}
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
                    searchTerm={rawSearch}
                />
            )}
            {activeTab === 'vendedores' && (
                <TabVendedores
                    branches={salesBranches}
                    filterBranch={filterBranch}
                    employees={employees}
                    searchTerm={rawSearch}
                />
            )}
            {activeTab === 'productos' && (
                <TabProductos
                    filterBranch={filterBranch}
                    searchTerm={rawSearch}
                />
            )}
            {activeTab === 'integridad' && (
                <TabIntegridad
                    branches={salesBranches}
                    filterBranch={filterBranch}
                />
            )}
            {activeTab === 'cambios' && (
                <TabCambios
                    branches={salesBranches}
                    filterBranch={filterBranch}
                />
            )}
        </GlassViewLayout>
    );
}
