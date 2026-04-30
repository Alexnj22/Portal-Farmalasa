import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    FileText, AlertTriangle, Clock, CreditCard, Building2,
    Loader2, Search, X, Check, History, ChevronRight,
    ChevronDown, ChevronUp, CheckCircle2, Paperclip, ExternalLink, ChevronLeft, Copy
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';

const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const fmt = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NON_CASH_TYPES = ['tarjeta', 'credito', 'transferencia', 'bitcoin', 'cheque'];
const IMMEDIATE_TIPOS = ['tarjeta', 'transferencia', 'cheque', 'bitcoin'];
const CREDIT_TIPOS    = ['credito'];
const PAGE_SIZE = 10;

const TIPO_PAGO_COLORS = {
    tarjeta:       'bg-blue-50 text-blue-700 border-blue-200',
    credito:       'bg-purple-50 text-purple-700 border-purple-200',
    transferencia: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    bitcoin:       'bg-orange-50 text-orange-700 border-orange-200',
    cheque:        'bg-teal-50 text-teal-700 border-teal-200',
};

const TIPO_PAGO_HOVER = {
    tarjeta:       'hover:border-l-blue-400/50',
    credito:       'hover:border-l-purple-400/50',
    transferencia: 'hover:border-l-cyan-400/50',
    bitcoin:       'hover:border-l-orange-400/50',
    cheque:        'hover:border-l-teal-400/50',
};

const TIPO_PAGO_LABELS = {
    tarjeta:       'Tarjeta',
    credito:       'Crédito',
    transferencia: 'Transferencia',
    cheque:        'Cheque',
    bitcoin:       'Bitcoin',
};

const TIPO_PAGO_THEME = {
    tarjeta:       { card: 'border-blue-200',   header: 'from-blue-600 to-blue-500',     rowHover: 'hover:bg-blue-50/40 hover:border-l-blue-500',   expand: 'bg-blue-50/60 border-blue-100',   input: 'border-blue-200 focus:ring-blue-300',   btn: 'bg-blue-600 hover:bg-blue-700'   },
    credito:       { card: 'border-purple-200',  header: 'from-purple-600 to-purple-500', rowHover: 'hover:bg-purple-50/40 hover:border-l-purple-500', expand: 'bg-purple-50/60 border-purple-100', input: 'border-purple-200 focus:ring-purple-300', btn: 'bg-purple-600 hover:bg-purple-700' },
    transferencia: { card: 'border-cyan-200',    header: 'from-cyan-600 to-cyan-500',     rowHover: 'hover:bg-cyan-50/40 hover:border-l-cyan-500',    expand: 'bg-cyan-50/60 border-cyan-100',    input: 'border-cyan-200 focus:ring-cyan-300',    btn: 'bg-cyan-600 hover:bg-cyan-700'    },
    cheque:        { card: 'border-teal-200',    header: 'from-teal-600 to-teal-500',     rowHover: 'hover:bg-teal-50/40 hover:border-l-teal-500',    expand: 'bg-teal-50/60 border-teal-100',    input: 'border-teal-200 focus:ring-teal-300',    btn: 'bg-teal-600 hover:bg-teal-700'    },
    bitcoin:       { card: 'border-orange-200',  header: 'from-orange-500 to-orange-400', rowHover: 'hover:bg-orange-50/40 hover:border-l-orange-500', expand: 'bg-orange-50/60 border-orange-100', input: 'border-orange-200 focus:ring-orange-300', btn: 'bg-orange-500 hover:bg-orange-600' },
};

// SV time
function svNow() { return new Date(Date.now() - 6 * 3600_000); }

function timeAgo(fecha, hora) {
    const horaStr = hora?.length === 5 ? `${hora}:00` : hora;
    const dt = new Date(`${fecha}T${horaStr}-06:00`);
    const mins = Math.floor((Date.now() - dt.getTime()) / 60000);
    if (mins < 0) return '—';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${Math.floor(mins / 1440)}d`;
}

function monthOptions() {
    const opts = [];
    const now = svNow();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear(); const m = d.getMonth() + 1;
        const pad = n => String(n).padStart(2, '0');
        const last = new Date(y, m, 0).getDate();
        const label = d.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
        opts.push({ value: `${y}-${pad(m)}-01|${y}-${pad(m)}-${pad(last)}`, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return opts;
}

// ─── Sort hook ────────────────────────────────────────────────────────────────
function useSortable(defaultKey, defaultDir = 'asc') {
    const [sortKey, setSortKey] = useState(defaultKey);
    const [sortDir, setSortDir] = useState(defaultDir);
    const toggle = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };
    const sortFn = (arr, accessors) => {
        const fn = accessors[sortKey];
        if (!fn) return arr;
        return [...arr].sort((a, b) => {
            const av = fn(a), bv = fn(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1; if (bv == null) return -1;
            const cmp = typeof av === 'string' ? av.localeCompare(bv, 'es') : av - bv;
            return sortDir === 'asc' ? cmp : -cmp;
        });
    };
    return { sortKey, sortDir, toggle, sortFn };
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, iconClass, glowClass, title, subtitle }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            <div className="relative group flex flex-col items-center text-center">
                <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${glowClass}`} />
                <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${iconClass}`}>
                    <Icon size={40} strokeWidth={2} />
                </div>
                <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">{title}</h3>
                <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">{subtitle}</p>
            </div>
        </div>
    );
}

// ─── Solve Row ────────────────────────────────────────────────────────────────
function SolveRow({ colSpan, comment, setComment, onConfirm, onCancel, saving, placeholder }) {
    return (
        <tr>
            <td colSpan={colSpan} className="px-5 py-4 bg-emerald-50/60 border-t border-emerald-100">
                <div className="flex items-start gap-3 max-w-2xl">
                    <textarea
                        className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                        rows={2} autoFocus
                        placeholder={placeholder || 'Comentario (opcional)'}
                        value={comment} onChange={e => setComment(e.target.value)}
                    />
                    <div className="flex flex-col gap-2 shrink-0">
                        <button onClick={onConfirm} disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Confirmar
                        </button>
                        <button onClick={onCancel}
                            className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/80 hover:border-red-200 shadow transition-all hover:-translate-y-0.5">
                            <X size={12} /> Cancelar
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    );
}

// ─── Sortable Table Header ────────────────────────────────────────────────────
// cols: array of string (no sort) or { label, key } (sortable)
function AuditThead({ cols, sortKey, sortDir, onSort, firstPl = 'pl-8', lastPr = 'pr-8' }) {
    return (
        <thead>
            <tr className="bg-black/[0.02] border-b border-black/[0.04]">
                {cols.map((col, i) => {
                    const label = typeof col === 'string' ? col : col.label;
                    const key   = typeof col === 'string' ? null : col.key;
                    const active = key && sortKey === key;
                    return (
                        <th key={label}
                            onClick={key ? () => onSort?.(key) : undefined}
                            className={`p-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap
                                ${i === 0 ? firstPl : ''} ${i === cols.length - 1 ? lastPr : ''}
                                ${key ? 'cursor-pointer hover:text-slate-700 select-none' : ''}`}>
                            <span className="inline-flex items-center gap-1">
                                {label}
                                {key && (active
                                    ? (sortDir === 'asc'
                                        ? <ChevronUp size={10} className="text-[#007AFF]" />
                                        : <ChevronDown size={10} className="text-[#007AFF]" />)
                                    : <ChevronUp size={10} className="opacity-20" />
                                )}
                            </span>
                        </th>
                    );
                })}
            </tr>
        </thead>
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function Pagination({ page, total, onChange }) {
    if (total <= 1) return null;
    const pages = [];
    let start = Math.max(1, page - 2);
    let end   = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let p = start; p <= end; p++) pages.push(p);
    return (
        <div className="flex items-center justify-center gap-1.5 px-5 py-3 border-t border-black/[0.04]">
            <button onClick={() => onChange(page - 1)} disabled={page === 1}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-black/[0.05] disabled:opacity-30 transition-all">
                <ChevronLeft size={15} />
            </button>
            {pages.map(p => (
                <button key={p} onClick={() => onChange(p)}
                    className={`w-8 h-8 rounded-full text-[12px] font-bold transition-all ${
                        page === p
                            ? 'bg-[#007AFF] text-white shadow-[0_2px_8px_rgba(0,122,255,0.4)]'
                            : 'text-slate-500 hover:bg-black/[0.05]'
                    }`}>
                    {p}
                </button>
            ))}
            <button onClick={() => onChange(page + 1)} disabled={page === total}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-black/[0.05] disabled:opacity-30 transition-all">
                <ChevronRight size={15} />
            </button>
        </div>
    );
}

// ─── Tab: Anuladas ────────────────────────────────────────────────────────────
function TabAnuladas({ branches, filterBranch, searchTerm, currentUser }) {
    const [rows, setRows] = useState([]);
    const [resolved, setResolved] = useState([]);
    const [resolvedIds, setResolvedIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);
    const [solvingId, setSolvingId] = useState(null);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [page, setPage] = useState(1);
    const [historialPage, setHistorialPage] = useState(1);
    const { sortKey, sortDir, toggle, sortFn } = useSortable('fecha');

    const loadData = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado, codigo_generacion, recibido_mh')
            .or('estado.eq.NULA,estado.is.null,estado.eq.undefined')
            .order('tipo_documento', { ascending: false })
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));

        const [invoicesRes, resolutionsRes, historialRes] = await Promise.all([
            q,
            supabase.from('sales_invoice_resolutions').select('invoice_id'),
            supabase.from('sales_invoice_resolutions')
                .select('id, invoice_id, comment, resolved_by, resolved_at')
                .order('resolved_at', { ascending: false }),
        ]);

        const resolvedIdSet = new Set((resolutionsRes.data || []).map(r => r.invoice_id));
        const allIds = (historialRes.data || []).map(r => r.invoice_id);
        let invMap = {};
        if (allIds.length > 0) {
            const { data: d } = await supabase.from('sales_invoices')
                .select('id, correlativo, branch_id, tipo_documento, cliente, fecha, total')
                .in('id', allIds);
            for (const inv of (d || [])) invMap[inv.id] = inv;
        }

        setRows(invoicesRes.data || []);
        setResolvedIds(resolvedIdSet);
        setResolved((historialRes.data || []).map(r => ({ ...r, invoice: invMap[r.invoice_id] || null })));
        setLastRefresh(new Date());
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { const id = setInterval(loadData, 60_000); return () => clearInterval(id); }, [loadData]);

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const { data } = await supabase.from('sales_invoice_resolutions').insert({
            invoice_id: invoiceId, comment: comment.trim() || null, resolved_by: resolvedBy,
        }).select('id, invoice_id, comment, resolved_by, resolved_at');
        setResolvedIds(prev => new Set([...prev, invoiceId]));
        const newRec = data?.[0];
        if (newRec) {
            const inv = rows.find(r => r.id === invoiceId);
            setResolved(prev => [{ ...newRec, invoice: inv || null }, ...prev]);
        }
        useStaff.getState().appendAuditLog('SOLVENTAR_ANULACION', String(invoiceId), {
            correlativo: rows.find(r => r.id === invoiceId)?.correlativo,
            comment: comment.trim() || null,
        });
        setSolvingId(null); setComment(''); setSaving(false);
    };

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const SORT_ACCESSORS = {
        tipo:      r => r.tipo_documento,
        correlativo: r => r.correlativo,
        sucursal:  r => getBranch(r.branch_id),
        cliente:   r => r.cliente,
        fecha:     r => r.fecha + (r.hora || ''),
        total:     r => parseFloat(r.total || 0),
    };

    const filtered = useMemo(() => {
        const active = rows.filter(r => !resolvedIds.has(r.id));
        let list = !searchTerm ? active : active.filter(r => {
            const s = searchTerm.toLowerCase();
            return r.correlativo?.toLowerCase().includes(s) ||
                r.cliente?.toLowerCase().includes(s) ||
                r.codigo_generacion?.toLowerCase().includes(s);
        });
        const ccf = list.filter(r => r.tipo_documento === 'CCF');
        const rest = list.filter(r => r.tipo_documento !== 'CCF');
        return [...sortFn(ccf, SORT_ACCESSORS), ...sortFn(rest, SORT_ACCESSORS)];
    }, [rows, resolvedIds, searchTerm, sortKey, sortDir]);

    useEffect(() => { setPage(1); }, [filtered.length, searchTerm]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const historialTotalPages = Math.ceil(resolved.length / PAGE_SIZE);
    const historialPageRows = resolved.slice((historialPage - 1) * PAGE_SIZE, historialPage * PAGE_SIZE);

    const ccfCount = filtered.filter(r => r.tipo_documento === 'CCF').length;

    const COLS = [
        { label: 'Tipo / Correlativo', key: 'tipo' },
        { label: 'Sucursal', key: 'sucursal' },
        { label: 'Cliente', key: 'cliente' },
        { label: 'Fecha', key: 'fecha' },
        { label: 'Total', key: 'total' },
        'Tiempo',
        '',
    ];

    return (
        <div className="p-5 md:p-6 space-y-6">
            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: 'Pendientes',   value: filtered.length, icon: AlertTriangle, colors: filtered.length > 0 ? 'from-red-500 to-orange-400' : 'from-slate-400 to-slate-300' },
                    { label: 'CCF urgentes', value: ccfCount,        icon: AlertTriangle, colors: ccfCount > 0 ? 'from-red-600 to-red-400' : 'from-slate-400 to-slate-300' },
                    { label: 'Solventadas',  value: resolved.length, icon: CheckCircle2,  colors: resolved.length > 0 ? 'from-emerald-500 to-teal-400' : 'from-slate-400 to-slate-300' },
                ].map(({ label, value, icon: Icon, colors }) => (
                    <div key={label} className="relative overflow-hidden rounded-2xl bg-white border border-black/[0.06] shadow-sm p-4">
                        <div className={`absolute inset-0 bg-gradient-to-br ${colors} opacity-[0.07]`} />
                        <div className="relative">
                            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${colors} flex items-center justify-center mb-3 shadow-sm`}>
                                <Icon size={15} className="text-white" strokeWidth={2.5} />
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
                            <p className="text-[28px] font-black text-slate-800 leading-none">{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Refresh row */}
            <div className="flex items-center justify-between -mt-2">
                <div className="flex items-center gap-3">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Anulaciones pendientes</h3>
                    {ccfCount > 0 && <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">{ccfCount} CCF urgente{ccfCount > 1 ? 's' : ''}</span>}
                </div>
                {lastRefresh && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Act. {lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-emerald-500" glowClass="bg-emerald-500"
                    title="Todo está al día" subtitle="No hay anulaciones pendientes por atender en este momento." />
            ) : (
                <>
                    <div className="grid gap-2 md:grid-cols-2">
                        {pageRows.map(r => {
                            const isCCF = r.tipo_documento === 'CCF';
                            const isSolving = solvingId === r.id;
                            return (
                                <div key={r.id} className={`rounded-xl border-2 bg-white shadow-sm overflow-hidden transition-all duration-200 ${isSolving ? 'border-emerald-300' : isCCF ? 'border-red-200 hover:border-red-300 hover:shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'}`}>
                                    <div className="px-4 py-3">
                                        {/* Row 1: badges + time */}
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${isCCF ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_documento}</span>
                                                {(r.estado === null || r.estado === 'undefined') && <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-yellow-50 text-yellow-600 border border-yellow-200">Undef</span>}
                                                {!r.recibido_mh && <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-violet-50 text-violet-600 border border-violet-200">Sin MH</span>}
                                            </div>
                                            <span className={`text-[10px] font-bold shrink-0 ${isCCF ? 'text-red-400' : 'text-slate-400'}`}>{timeAgo(r.fecha, r.hora)}</span>
                                        </div>
                                        {/* Row 2: correlativo + meta */}
                                        <p className={`font-mono text-[13px] font-black leading-none mb-1.5 ${isCCF ? 'text-red-700' : 'text-slate-800'}`}>{r.correlativo}</p>
                                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                            {r.erp_invoice_id && <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">#{r.erp_invoice_id}</span>}
                                            <span className="text-[11px] font-semibold text-slate-600">{getBranch(r.branch_id)}</span>
                                            <span className="text-[10px] text-slate-400">·</span>
                                            <span className="text-[11px] font-semibold text-slate-600">{r.fecha}</span>
                                        </div>
                                        {r.cliente && <p className="text-[11px] text-slate-400 truncate mb-2">{r.cliente}</p>}
                                        {/* Row 3: total + action */}
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[14px] font-black ${isCCF ? 'text-red-700' : 'text-slate-800'}`}>{fmt(r.total)}</span>
                                            <button onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 ${isSolving ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-200'}`}>
                                                {isSolving ? <><X size={10} /> Cancelar</> : <><Check size={10} /> Solventar</>}
                                            </button>
                                        </div>
                                    </div>
                                    {isSolving && (
                                        <div className="border-t border-emerald-100 bg-emerald-50/60 px-4 py-3">
                                            <textarea
                                                className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none mb-2"
                                                rows={2} autoFocus
                                                placeholder="Comentario opcional…"
                                                value={comment} onChange={e => setComment(e.target.value)}
                                            />
                                            <button onClick={() => handleSolve(r.id)} disabled={saving}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow transition-all disabled:opacity-50">
                                                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Confirmar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <Pagination page={page} total={totalPages} onChange={p => { setPage(p); setSolvingId(null); }} />
                </>
            )}

            {/* Historial */}
            {!loading && resolved.length > 0 && (
                <div className="rounded-2xl border border-black/[0.06] overflow-hidden bg-white shadow-sm">
                    <button onClick={() => setShowHistorial(v => !v)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                <Check size={13} className="text-emerald-600" strokeWidth={3} />
                            </div>
                            <div className="text-left">
                                <p className="text-[13px] font-bold text-slate-700">{resolved.length} solventada{resolved.length !== 1 ? 's' : ''}</p>
                                <p className="text-[11px] text-slate-400">Historial de resoluciones</p>
                            </div>
                        </div>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${showHistorial ? 'rotate-180' : ''}`} />
                    </button>
                    {showHistorial && (
                        <div className="border-t border-black/[0.04]">
                            {historialPageRows.map((r, i) => {
                                const inv = r.invoice;
                                return (
                                    <div key={r.id} className={`flex items-start gap-4 px-5 py-4 hover:bg-black/[0.02] transition-colors ${i > 0 ? 'border-t border-black/[0.04]' : ''}`}>
                                        <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">{inv?.tipo_documento}</span>
                                                <span className="font-mono text-[12px] font-bold text-slate-700">{inv?.correlativo}</span>
                                                <span className="text-[12px] text-slate-500">{getBranch(inv?.branch_id)}</span>
                                                {inv?.total && <span className="text-[12px] font-bold text-slate-700 ml-auto">{fmt(inv.total)}</span>}
                                            </div>
                                            {r.comment && <p className="text-[12px] text-slate-500 mb-1">"{r.comment}"</p>}
                                            <p className="text-[11px] text-slate-400">
                                                Solventado por <span className="font-semibold text-slate-600">{r.resolved_by || '—'}</span>
                                                {r.resolved_at && <> · {new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                            <Pagination page={historialPage} total={historialTotalPages} onChange={setHistorialPage} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: Pendiente MH ────────────────────────────────────────────────────────
function TabPendienteMH({ branches, filterBranch, searchTerm, currentUser }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);
    const [solvingId, setSolvingId] = useState(null);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [expandedId, setExpandedId] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const { sortKey, sortDir, toggle, sortFn } = useSortable('fecha');

    const copyErpId = (erpId) => {
        if (!erpId) return;
        navigator.clipboard.writeText(String(erpId));
        setCopiedId(erpId);
        setTimeout(() => setCopiedId(null), 1500);
    };

    // Month-end alert
    const now = svNow();
    const todayStr = now.toISOString().slice(0, 10);
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
    const monthEndWarning = daysLeft <= 5;
    const monthEndCritical = daysLeft <= 2;

    const loadData = useCallback(async () => {
        setLoading(true);
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado')
            .is('recibido_mh', null)
            .not('estado', 'eq', 'NULA')
            .order('branch_id', { ascending: true })
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLastRefresh(new Date());
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { const id = setInterval(loadData, 120_000); return () => clearInterval(id); }, [loadData]);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        await supabase.from('sales_invoices').update({ recibido_mh: true }).eq('id', invoiceId);
        useStaff.getState().appendAuditLog('SOLVENTAR_PENDIENTE_MH', String(invoiceId), {
            correlativo: rows.find(r => r.id === invoiceId)?.correlativo,
            comment: comment.trim() || null,
            resolved_by: resolvedBy,
        });
        setRows(prev => prev.filter(r => r.id !== invoiceId));
        setSolvingId(null); setComment(''); setSaving(false);
    };

    const SORT_ACCESSORS = {
        tipo:       r => r.tipo_documento,
        correlativo: r => r.correlativo,
        sucursal:   r => getBranch(r.branch_id),
        cliente:    r => r.cliente,
        fecha:      r => r.fecha + (r.hora || ''),
        total:      r => parseFloat(r.total || 0),
    };

    const filtered = useMemo(() => {
        let list = rows;
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            list = list.filter(r =>
                r.correlativo?.toLowerCase().includes(s) ||
                r.cliente?.toLowerCase().includes(s) ||
                r.erp_invoice_id?.toString().includes(s)
            );
        }
        return sortFn(list, SORT_ACCESSORS);
    }, [rows, searchTerm, sortKey, sortDir]);

    useEffect(() => { setPage(1); }, [filtered.length, searchTerm, pageSize]);

    const totalPages = Math.ceil(filtered.length / pageSize);
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const ccfCount = filtered.filter(r => r.tipo_documento === 'CCF').length;

    const COLS = [
        { label: 'Tipo / Correlativo', key: 'tipo' },
        { label: 'Sucursal', key: 'sucursal' },
        { label: 'Cliente', key: 'cliente' },
        { label: 'Fecha', key: 'fecha' },
        { label: 'Total', key: 'total' },
        'Tiempo en espera',
        '',
    ];

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Stats strip — compact inline */}
            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { label: 'Pendientes MH', value: filtered.length, icon: Clock,         colors: filtered.length > 0 ? 'from-violet-500 to-purple-400' : 'from-slate-400 to-slate-300',        text: filtered.length > 0 ? 'text-violet-700' : 'text-slate-500', bg: filtered.length > 0 ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200' },
                    { label: 'CCF urgentes',  value: ccfCount,        icon: AlertTriangle, colors: ccfCount > 0 ? 'from-red-500 to-orange-400' : 'from-slate-400 to-slate-300',                    text: ccfCount > 0 ? 'text-red-700' : 'text-slate-500',           bg: ccfCount > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200' },
                    { label: 'Días restantes', value: daysLeft,       icon: History,       colors: daysLeft <= 2 ? 'from-red-500 to-red-400' : daysLeft <= 5 ? 'from-amber-500 to-orange-400' : 'from-emerald-500 to-teal-400', text: daysLeft <= 2 ? 'text-red-700' : daysLeft <= 5 ? 'text-amber-700' : 'text-emerald-700', bg: daysLeft <= 2 ? 'bg-red-50 border-red-200' : daysLeft <= 5 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200' },
                ].map(({ label, value, icon: Icon, colors, text, bg }) => (
                    <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${bg}`}>
                        <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${colors} flex items-center justify-center shrink-0`}>
                            <Icon size={11} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                        <span className={`text-[15px] font-black leading-none ${text}`}>{value}</span>
                    </div>
                ))}
                {lastRefresh && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">{lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Documentos pendientes</h3>
                <div className="flex items-center gap-1 bg-black/[0.04] rounded-full p-1">
                    {[10, 25, 50].map(n => (
                        <button key={n} onClick={() => { setPageSize(n); setPage(1); }}
                            className={`px-3 py-1 rounded-full text-[10px] font-black transition-all ${pageSize === n ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            {n}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-violet-500" glowClass="bg-violet-500"
                    title="Sin pendientes de MH" subtitle="Todos los documentos han sido recibidos y confirmados por el Ministerio de Hacienda." />
            ) : (() => {
                const ccfRows   = pageRows.filter(r => r.tipo_documento === 'CCF');
                const otherRows = pageRows.filter(r => r.tipo_documento !== 'CCF');
                const renderPill = (r) => {
                    const isCCF      = r.tipo_documento === 'CCF';
                    const isLate     = isCCF && r.fecha !== todayStr;
                    const isExpanded = expandedId === r.id;
                    const isSolving  = solvingId === r.id;
                    return (
                        <div key={r.id} className={`rounded-2xl border overflow-hidden transition-all duration-200 ${
                            isSolving  ? 'border-emerald-300 shadow-sm shadow-emerald-100' :
                            isExpanded ? (isCCF ? 'border-red-300 shadow-sm' : 'border-violet-300 shadow-sm shadow-violet-100') :
                            isCCF     ? 'border-red-200 bg-red-50/20 hover:border-red-300' :
                                        'border-slate-200 bg-white hover:border-violet-200'
                        }`}>
                            {/* ── Collapsed pill row ── */}
                            <div className="flex items-center gap-2 px-3 py-2.5">
                                {/* ID — tappable copy zone */}
                                <button
                                    onClick={() => copyErpId(r.erp_invoice_id)}
                                    title="Copiar ID"
                                    className={`flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-[11px] font-black transition-all active:scale-95 shrink-0 ${
                                        copiedId === r.erp_invoice_id
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : isCCF ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-violet-100/80 text-violet-700 hover:bg-violet-200'
                                    }`}>
                                    {copiedId === r.erp_invoice_id ? <Check size={9} /> : <Copy size={9} />}
                                    {r.erp_invoice_id ? `#${r.erp_invoice_id}` : '—'}
                                </button>

                                {/* Tipo badge */}
                                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase border shrink-0 ${isCCF ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_documento}</span>
                                {isCCF && isLate && <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase bg-red-100 text-red-700 border border-red-300 shrink-0"><AlertTriangle size={8} />Vencido</span>}

                                {/* Sucursal */}
                                <span className="text-[12px] font-semibold text-slate-700 truncate flex-1 min-w-0">{getBranch(r.branch_id)}</span>

                                {/* Fecha */}
                                <span className={`text-[11px] font-semibold shrink-0 ${isLate ? 'text-red-500' : 'text-slate-500'}`}>{r.fecha}</span>

                                {/* Time ago badge */}
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${isCCF ? 'bg-red-100 text-red-600' : 'bg-violet-100/80 text-violet-600'}`}>{timeAgo(r.fecha, r.hora)}</span>

                                {/* Expand toggle */}
                                <button onClick={() => { setExpandedId(isExpanded ? null : r.id); if (isExpanded) { setSolvingId(null); setComment(''); } }}
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-black/[0.05] transition-all shrink-0">
                                    <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>
                            </div>

                            {/* ── Expanded panel ── */}
                            {isExpanded && (
                                <div className={`border-t px-4 py-3 ${isCCF ? 'border-red-100 bg-red-50/30' : 'border-violet-100/60 bg-violet-50/20'}`}>
                                    {/* Info row */}
                                    <div className="flex items-center gap-4 flex-wrap mb-3">
                                        <div>
                                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Correlativo</p>
                                            <p className={`font-mono text-[13px] font-black ${isCCF ? 'text-red-700' : 'text-slate-800'}`}>{r.correlativo}</p>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Cliente</p>
                                            <p className="text-[12px] font-semibold text-slate-700 truncate">{r.cliente || '—'}</p>
                                        </div>
                                        <div className="shrink-0">
                                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Total</p>
                                            <p className={`text-[15px] font-black ${isCCF ? 'text-red-700' : 'text-slate-800'}`}>{fmt(r.total)}</p>
                                        </div>
                                    </div>

                                    {/* Solve section */}
                                    {!isSolving ? (
                                        <button onClick={() => { setSolvingId(r.id); setComment(''); }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm transition-all active:scale-95">
                                            <Check size={10} /> Solventar
                                        </button>
                                    ) : (
                                        <div className="flex items-start gap-3">
                                            <textarea
                                                className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                                                rows={2} autoFocus
                                                placeholder="Comentario opcional…"
                                                value={comment} onChange={e => setComment(e.target.value)}
                                            />
                                            <div className="flex flex-col gap-1.5 shrink-0">
                                                <button onClick={() => handleSolve(r.id)} disabled={saving}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow transition-all disabled:opacity-50">
                                                    {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar
                                                </button>
                                                <button onClick={() => { setSolvingId(null); setComment(''); }}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full text-[9px] font-black uppercase border border-slate-200 hover:border-red-200 transition-all">
                                                    <X size={10} /> Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                };
                return (
                    <div className="space-y-4">
                        {ccfRows.length > 0 && (
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 px-1">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-red-500">CCF urgentes</span>
                                    <span className="bg-red-100 text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full">{ccfRows.length}</span>
                                </div>
                                {ccfRows.map(renderPill)}
                            </div>
                        )}
                        {otherRows.length > 0 && (
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 px-1">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Documentos</span>
                                    <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">{otherRows.length}</span>
                                </div>
                                {otherRows.map(renderPill)}
                            </div>
                        )}
                        <Pagination page={page} total={totalPages} onChange={p => { setPage(p); setExpandedId(null); setSolvingId(null); }} />
                    </div>
                );
            })()}
        </div>
    );
}

// ─── Tab: Saltos ──────────────────────────────────────────────────────────────
function TabSaltos({ branches, filterBranch, currentUser }) {
    const [gaps, setGaps] = useState([]);
    const [nulls, setNulls] = useState([]);
    const [gapResolutions, setGapResolutions] = useState([]);
    const [nullResolvedIds, setNullResolvedIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [solvingGap, setSolvingGap] = useState(null);
    const [solvingNull, setSolvingNull] = useState(null);
    const [comment, setComment] = useState('');
    const [nullComment, setNullComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [nullSaving, setNullSaving] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const load = useCallback(async () => {
        setLoading(true);
        let qGaps  = supabase.from('sales_invoice_gaps').select('*');
        let qNulls = supabase.from('sales_invoice_nulls').select('*');
        if (filterBranch) { qGaps = qGaps.eq('branch_id', Number(filterBranch)); qNulls = qNulls.eq('branch_id', Number(filterBranch)); }
        const [{ data: gData }, { data: nData }, { data: rData }, { data: nrData }] = await Promise.all([
            qGaps, qNulls,
            supabase.from('sales_gap_resolutions').select('*').order('resolved_at', { ascending: false }),
            supabase.from('sales_null_resolutions').select('null_id'),
        ]);
        setGaps(gData || []);
        setNulls(nData || []);
        setGapResolutions(rData || []);
        setNullResolvedIds(new Set((nrData || []).map(r => r.null_id)));
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { load(); }, [load]);

    const gapKey = (g) => `${g.branch_id}__${g.tipo_documento}__${g.gap_from}__${g.gap_to}`;

    const resolvedGapKeys = useMemo(() =>
        new Set(gapResolutions.map(r => `${r.branch_id}__${r.tipo_documento}__${r.gap_from}__${r.gap_to}`)),
        [gapResolutions]
    );

    const pendingGaps = useMemo(() => gaps.filter(g => !resolvedGapKeys.has(gapKey(g))), [gaps, resolvedGapKeys]);
    const resolvedGaps = useMemo(() =>
        gapResolutions.map(r => ({
            ...r,
            gap: gaps.find(g => g.branch_id === r.branch_id && g.tipo_documento === r.tipo_documento && g.gap_from === r.gap_from && g.gap_to === r.gap_to) || null,
        })),
        [gapResolutions, gaps]
    );

    const handleSolveGap = async (gap) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const payload = { branch_id: gap.branch_id, tipo_documento: gap.tipo_documento, gap_from: gap.gap_from, gap_to: gap.gap_to, comment: comment.trim() || null, resolved_by: resolvedBy };
        const { data } = await supabase.from('sales_gap_resolutions').insert(payload).select('*');
        if (data?.[0]) setGapResolutions(prev => [data[0], ...prev]);
        useStaff.getState().appendAuditLog('SOLVENTAR_SALTO_CORRELATIVO', String(gap.branch_id), {
            tipo_documento: gap.tipo_documento, gap_from: gap.gap_from, gap_to: gap.gap_to,
            branch_name: getBranch(gap.branch_id), comment: comment.trim() || null,
        });
        setSolvingGap(null); setComment(''); setSaving(false);
    };

    const handleSolveNull = async (n) => {
        setNullSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        await supabase.from('sales_null_resolutions').insert({
            null_id: n.id, comment: nullComment.trim() || null, resolved_by: resolvedBy,
        });
        useStaff.getState().appendAuditLog('SOLVENTAR_CAMPO_NULO', String(n.id), {
            branch: getBranch(n.branch_id), correlativo: n.correlativo, campos: n.campos_nulos,
            comment: nullComment.trim() || null,
        });
        setNullResolvedIds(prev => new Set([...prev, n.id]));
        setSolvingNull(null); setNullComment(''); setNullSaving(false);
    };

    if (loading) return <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;

    const pad7 = n => String(n).padStart(7, '0');

    return (
        <div className="p-5 md:p-6 space-y-8">

            {/* ── Stats strip ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Saltos detectados', value: gaps.length,         icon: History,      urgent: gaps.length > 0,       colors: gaps.length > 0 ? 'from-orange-500 to-amber-400' : 'from-slate-400 to-slate-300' },
                    { label: 'Sin resolver',       value: pendingGaps.length,  icon: AlertTriangle, urgent: pendingGaps.length > 0, colors: pendingGaps.length > 0 ? 'from-red-500 to-orange-400' : 'from-emerald-500 to-teal-400' },
                    { label: 'Solventados',        value: resolvedGaps.length, icon: CheckCircle2,  urgent: false,                  colors: resolvedGaps.length > 0 ? 'from-emerald-500 to-teal-400' : 'from-slate-400 to-slate-300' },
                    { label: 'Campos nulos',       value: nulls.length,        icon: AlertTriangle, urgent: nulls.length > 0,       colors: nulls.length > 0 ? 'from-red-500 to-rose-400' : 'from-slate-400 to-slate-300' },
                ].map(({ label, value, icon: Icon, colors }) => (
                    <div key={label} className="relative overflow-hidden rounded-2xl bg-white border border-black/[0.06] shadow-sm p-4">
                        <div className={`absolute inset-0 bg-gradient-to-br ${colors} opacity-[0.07]`} />
                        <div className="relative">
                            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${colors} flex items-center justify-center mb-3 shadow-sm`}>
                                <Icon size={15} className="text-white" strokeWidth={2.5} />
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
                            <p className="text-[28px] font-black text-slate-800 leading-none">{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Saltos pendientes ── */}
            <div className="space-y-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Saltos en correlativos</h3>
                    {pendingGaps.length > 0 && (
                        <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-0.5 rounded-full">{pendingGaps.length} pendiente{pendingGaps.length !== 1 ? 's' : ''}</span>
                    )}
                </div>

                {pendingGaps.length === 0 ? (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
                        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                        <div>
                            <p className="text-[13px] font-bold text-emerald-700">Sin saltos detectados</p>
                            <p className="text-[12px] text-emerald-600">Los correlativos están en orden. No hay brechas.</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                        {pendingGaps.map((g, i) => {
                            const key = gapKey(g);
                            const isSolving = solvingGap === key;
                            const isCCF = g.tipo_documento === 'CCF';
                            return (
                                <div key={i} className={`rounded-xl border-2 bg-white shadow-sm transition-all duration-200 overflow-hidden ${isSolving ? 'border-emerald-300' : 'border-orange-200 hover:border-orange-300 hover:shadow-md'}`}>
                                    <div className="px-4 py-3">
                                        {/* Row 1: badges + count */}
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <div className="flex items-center gap-1">
                                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${isCCF ? 'bg-red-50 text-red-600 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{g.tipo_documento}</span>
                                                <span className="text-[12px] font-bold text-slate-700">{getBranch(g.branch_id)}</span>
                                            </div>
                                            <span className="text-[10px] font-black text-orange-500 shrink-0">{g.gap_count} faltante{g.gap_count !== 1 ? 's' : ''}</span>
                                        </div>

                                        {/* Sequence visualization */}
                                        <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 mb-2">
                                            <p className="font-mono text-[12px] font-black text-slate-700">{pad7(g.gap_from)}</p>
                                            <div className="flex-1 flex items-center gap-1">
                                                <div className="flex-1 border-t-2 border-dashed border-orange-300" />
                                                <AlertTriangle size={11} className="text-orange-400 shrink-0" />
                                                <div className="flex-1 border-t-2 border-dashed border-orange-300" />
                                            </div>
                                            <p className="font-mono text-[12px] font-black text-slate-700">{pad7(g.gap_to)}</p>
                                        </div>

                                        {/* Row 3: siguiente + solve */}
                                        <div className="flex items-center justify-between">
                                            {g.siguiente_correlativo ? (
                                                <p className="text-[10px] text-slate-400">
                                                    Sig: <span className="font-mono font-bold text-slate-600">{g.siguiente_correlativo}</span>
                                                </p>
                                            ) : <span />}
                                            <button onClick={() => { setSolvingGap(isSolving ? null : key); setComment(''); }}
                                                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 ${isSolving ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-200'}`}>
                                                {isSolving ? <><X size={10} /> Cancelar</> : <><Check size={10} /> Solventar</>}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Solve panel */}
                                    {isSolving && (
                                        <div className="border-t border-emerald-100 bg-emerald-50/60 px-4 py-3">
                                            <textarea
                                                className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none mb-2"
                                                rows={2} autoFocus
                                                placeholder="Comentario opcional…"
                                                value={comment} onChange={e => setComment(e.target.value)}
                                            />
                                            <button onClick={() => handleSolveGap(g)} disabled={saving}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow transition-all disabled:opacity-50">
                                                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Confirmar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Campos nulos ── */}
            <div className="space-y-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Campos indefinidos / nulos</h3>
                    {nulls.filter(n => !nullResolvedIds.has(n.id)).length > 0 && (
                        <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                            {nulls.filter(n => !nullResolvedIds.has(n.id)).length}
                        </span>
                    )}
                </div>
                {nulls.filter(n => !nullResolvedIds.has(n.id)).length === 0 ? (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
                        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                        <p className="text-[13px] font-bold text-emerald-700">Sin campos indefinidos</p>
                    </div>
                ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                        {nulls.filter(n => !nullResolvedIds.has(n.id)).map(n => {
                            const isSolving = solvingNull === n.id;
                            return (
                                <div key={n.id} className={`rounded-xl border-2 bg-white shadow-sm overflow-hidden transition-all duration-200 ${isSolving ? 'border-emerald-300' : 'border-red-200 hover:border-red-300 hover:shadow-md'}`}>
                                    <div className="px-4 py-3">
                                        {/* Row 1: branch + correlativo */}
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <p className="text-[12px] font-bold text-slate-700">{getBranch(n.branch_id)}</p>
                                            <p className="font-mono text-[11px] text-slate-400 truncate">{n.correlativo || n.erp_invoice_id || `ID ${n.id}`}{n.fecha ? ` · ${n.fecha}` : ''}</p>
                                        </div>
                                        {/* Campo pills */}
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {(n.campos_nulos || []).map(c => (
                                                <span key={c} className="text-[9px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-md border border-red-200">{c}</span>
                                            ))}
                                        </div>
                                        {/* Solve button */}
                                        <div className="flex justify-end">
                                            <button onClick={() => { setSolvingNull(isSolving ? null : n.id); setNullComment(''); }}
                                                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 ${isSolving ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-200'}`}>
                                                {isSolving ? <><X size={10} /> Cancelar</> : <><Check size={10} /> Solventar</>}
                                            </button>
                                        </div>
                                    </div>
                                    {isSolving && (
                                        <div className="border-t border-emerald-100 bg-emerald-50/60 px-4 py-3">
                                            <textarea
                                                className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none mb-2"
                                                rows={2} autoFocus
                                                placeholder="Comentario opcional…"
                                                value={nullComment} onChange={e => setNullComment(e.target.value)}
                                            />
                                            <button onClick={() => handleSolveNull(n)} disabled={nullSaving}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow transition-all disabled:opacity-50">
                                                {nullSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Confirmar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Historial solventados ── */}
            {resolvedGaps.length > 0 && (
                <div className="rounded-2xl border border-black/[0.06] overflow-hidden bg-white shadow-sm">
                    <button onClick={() => setShowHistorial(v => !v)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                <Check size={13} className="text-emerald-600" strokeWidth={3} />
                            </div>
                            <div className="text-left">
                                <p className="text-[13px] font-bold text-slate-700">{resolvedGaps.length} salto{resolvedGaps.length !== 1 ? 's' : ''} solventado{resolvedGaps.length !== 1 ? 's' : ''}</p>
                                <p className="text-[11px] text-slate-400">Historial de resoluciones</p>
                            </div>
                        </div>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${showHistorial ? 'rotate-180' : ''}`} />
                    </button>
                    {showHistorial && (
                        <div className="border-t border-black/[0.04]">
                            {resolvedGaps.map((r, i) => (
                                <div key={r.id} className={`flex items-start gap-4 px-5 py-4 hover:bg-black/[0.02] transition-colors ${i > 0 ? 'border-t border-black/[0.04]' : ''}`}>
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">{r.tipo_documento}</span>
                                            <span className="text-[13px] font-bold text-slate-700">{getBranch(r.branch_id)}</span>
                                            <span className="font-mono text-[11px] text-slate-400">{pad7(r.gap_from)} → {pad7(r.gap_to)}</span>
                                        </div>
                                        {r.comment && <p className="text-[12px] text-slate-500 mb-1">"{r.comment}"</p>}
                                        <p className="text-[11px] text-slate-400">
                                            Solventado por <span className="font-semibold text-slate-600">{r.resolved_by || '—'}</span>
                                            {r.resolved_at && <> · {new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: No Efectivo ─────────────────────────────────────────────────────────
function TabNoEfectivo({ branches, filterBranch, searchTerm, currentUser }) {
    const [pending, setPending] = useState([]);
    const [confirmedIds, setConfirmedIds] = useState(new Set());
    const [confirmed, setConfirmed] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = svNow();
        const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
        const last = new Date(y, now.getMonth() + 1, 0).getDate();
        return `${y}-${m}-01|${y}-${m}-${last}`;
    });
    const [confirmingId, setConfirmingId] = useState(null);
    const [confirmNotes, setConfirmNotes] = useState('');
    const [confirmFile, setConfirmFile] = useState(null);
    const [confirmSaving, setConfirmSaving] = useState(false);
    const fileInputRef = useRef(null);

    // Pending pagination: { [tipo]: page }
    const [pendingPages, setPendingPages] = useState({});
    const getPendingPage = (tipo) => pendingPages[tipo] || 1;
    const setPendingPage = (tipo, p) => setPendingPages(prev => ({ ...prev, [tipo]: p }));

    // Confirmed section
    const [filterConfirmedTipo, setFilterConfirmedTipo] = useState('');
    const [filterConfirmedBranch, setFilterConfirmedBranch] = useState('');
    const [showConfirmed, setShowConfirmed] = useState(false);
    const [confirmedPage, setConfirmedPage] = useState(1);

    // Confirmed sort
    const { sortKey: cSortKey, sortDir: cSortDir, toggle: cToggle, sortFn: cSortFn } = useSortable('confirmed_at', 'desc');

    const monthOpts = useMemo(() => monthOptions(), []);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [fini, ffin] = selectedMonth.split('|');
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, tipo_pago')
            .in('tipo_pago', NON_CASH_TYPES)
            .gte('fecha', fini).lte('fecha', ffin)
            .order('tipo_pago', { ascending: true })
            .order('fecha', { ascending: false });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));

        const [invoicesRes, confirmedIdsRes, historialRes] = await Promise.all([
            q,
            supabase.from('sales_payment_confirmations').select('invoice_id'),
            supabase.from('sales_payment_confirmations')
                .select('id, invoice_id, confirmed_by, confirmed_by_photo, confirmed_at, notes, proof_url, tipo_pago, branch_id')
                .order('confirmed_at', { ascending: false }),
        ]);

        const cidSet = new Set((confirmedIdsRes.data || []).map(r => r.invoice_id));
        const hData = historialRes.data || [];
        const hIds = hData.map(r => r.invoice_id);
        let invMap = {};
        if (hIds.length > 0) {
            const { data: d } = await supabase.from('sales_invoices')
                .select('id, correlativo, branch_id, tipo_documento, cliente, fecha, total, tipo_pago')
                .in('id', hIds);
            for (const inv of (d || [])) invMap[inv.id] = inv;
        }

        setPending(invoicesRes.data || []);
        setConfirmedIds(cidSet);
        setConfirmed(hData.map(r => ({ ...r, invoice: invMap[r.invoice_id] || null })));
        setLoading(false);
    }, [filterBranch, selectedMonth]);

    useEffect(() => { loadData(); }, [loadData]);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const pendingFiltered = useMemo(() => {
        const base = pending.filter(r => !confirmedIds.has(r.id));
        if (!searchTerm) return base;
        const s = searchTerm.toLowerCase();
        return base.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.tipo_pago?.toLowerCase().includes(s)
        );
    }, [pending, confirmedIds, searchTerm]);

    const byTipo = useMemo(() => {
        const groups = {};
        for (const r of pendingFiltered) {
            const t = r.tipo_pago?.toLowerCase() || 'otro';
            if (!groups[t]) groups[t] = [];
            groups[t].push(r);
        }
        return groups;
    }, [pendingFiltered]);

    // Reset pending pages when data changes
    useEffect(() => { setPendingPages({}); }, [pendingFiltered.length, searchTerm]);

    const CONFIRMED_SORT_ACCESSORS = {
        correlativo:   r => r.invoice?.correlativo,
        sucursal:      r => getBranch(r.branch_id),
        cliente:       r => r.invoice?.cliente,
        fecha:         r => r.invoice?.fecha,
        total:         r => parseFloat(r.invoice?.total || 0),
        confirmed_by:  r => r.confirmed_by,
        confirmed_at:  r => r.confirmed_at,
        tipo_pago:     r => r.tipo_pago,
    };

    const confirmedFiltered = useMemo(() => {
        let list = confirmed;
        if (filterConfirmedTipo) list = list.filter(r => r.tipo_pago?.toLowerCase() === filterConfirmedTipo);
        if (filterConfirmedBranch) list = list.filter(r => String(r.branch_id) === filterConfirmedBranch);
        return cSortFn(list, CONFIRMED_SORT_ACCESSORS);
    }, [confirmed, filterConfirmedTipo, filterConfirmedBranch, cSortKey, cSortDir]);

    useEffect(() => { setConfirmedPage(1); }, [confirmedFiltered.length, filterConfirmedTipo, filterConfirmedBranch]);

    const confirmedTotalPages = Math.ceil(confirmedFiltered.length / PAGE_SIZE);
    const confirmedPageRows = confirmedFiltered.slice((confirmedPage - 1) * PAGE_SIZE, confirmedPage * PAGE_SIZE);

    const handleConfirm = async (invoiceId) => {
        setConfirmSaving(true);
        const confirmedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const confirmedByPhoto = currentUser?.photo || currentUser?.photo_url || null;

        let proofUrl = null;
        if (confirmFile) {
            const ext = confirmFile.name.split('.').pop();
            const path = `invoices/${invoiceId}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, confirmFile);
            if (!upErr) {
                const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
                proofUrl = urlData?.publicUrl || null;
            }
        }

        const inv = pending.find(r => r.id === invoiceId);
        const payload = {
            invoice_id: invoiceId,
            confirmed_by: confirmedBy,
            confirmed_by_photo: confirmedByPhoto,
            notes: confirmNotes.trim() || null,
            proof_url: proofUrl,
            tipo_pago: inv?.tipo_pago,
            branch_id: inv?.branch_id,
        };

        const { data } = await supabase.from('sales_payment_confirmations').insert(payload).select('*');
        setConfirmedIds(prev => new Set([...prev, invoiceId]));
        if (data?.[0]) setConfirmed(prev => [{ ...data[0], invoice: inv || null }, ...prev]);

        useStaff.getState().appendAuditLog('CONFIRMAR_PAGO_NO_EFECTIVO', String(invoiceId), {
            correlativo: inv?.correlativo, tipo_pago: inv?.tipo_pago,
            branch_id: inv?.branch_id, has_proof: !!proofUrl,
        });

        setConfirmingId(null); setConfirmNotes(''); setConfirmFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setConfirmSaving(false);
    };

    const totalPending = useMemo(() => pendingFiltered.reduce((a, r) => a + parseFloat(r.total || 0), 0), [pendingFiltered]);

    const branchFilterOpts = useMemo(() => [
        { value: '', label: 'Todas las sucursales' },
        ...branches.filter(b => SALES_BRANCH_IDS.includes(b.id)).map(b => ({ value: String(b.id), label: b.name })),
    ], [branches]);

    const tipoFilterOpts = useMemo(() => [
        { value: '', label: 'Todos los tipos' },
        ...NON_CASH_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
    ], []);

    const CONFIRMED_COLS = [
        { label: 'Tipo Pago', key: 'tipo_pago' },
        { label: 'Correlativo', key: 'correlativo' },
        { label: 'Sucursal', key: 'sucursal' },
        { label: 'Cliente', key: 'cliente' },
        { label: 'Fecha', key: 'fecha' },
        { label: 'Total', key: 'total' },
        { label: 'Confirmado por', key: 'confirmed_by' },
        { label: 'Fecha conf.', key: 'confirmed_at' },
        'Comprobante',
        'Notas',
    ];

    return (
        <div>
            {/* Top bar */}
            <div className="px-5 pl-8 py-4 bg-white/40 border-b border-black/[0.04] flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-bold uppercase text-slate-500 tracking-widest">{pendingFiltered.length} pendientes</span>
                    <span className="text-[11px] font-bold text-blue-600">{fmt(totalPending)}</span>
                    {Object.entries(byTipo).map(([tipo, rows]) => (
                        <span key={tipo} className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${TIPO_PAGO_COLORS[tipo] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                            {tipo} {rows.length}
                        </span>
                    ))}
                </div>
                <div className="w-[170px] md:w-[200px]">
                    <LiquidSelect value={selectedMonth} onChange={setSelectedMonth} options={monthOpts} placeholder="Mes" compact />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : pendingFiltered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-blue-500" glowClass="bg-blue-500"
                    title="Sin pagos no-efectivo" subtitle="No hay transacciones pendientes de confirmar en este período." />
            ) : (
                <div className="p-4 md:p-6 space-y-5">
                    {/* ── Pagos inmediatos ── */}
                    {IMMEDIATE_TIPOS.filter(t => byTipo[t]?.length > 0).map(tipo => {
                        const theme = TIPO_PAGO_THEME[tipo] || TIPO_PAGO_THEME.tarjeta;
                        const tipoRows = byTipo[tipo] || [];
                        const tipoTotal = tipoRows.reduce((a, r) => a + parseFloat(r.total || 0), 0);
                        const tipoPg = getPendingPage(tipo);
                        const tipoTotalPages = Math.ceil(tipoRows.length / PAGE_SIZE);
                        const tipoPageRows = tipoRows.slice((tipoPg - 1) * PAGE_SIZE, tipoPg * PAGE_SIZE);
                        return (
                            <div key={tipo} className={`rounded-2xl border-2 overflow-hidden shadow-sm ${theme.card}`}>
                                {/* Bold colored header */}
                                <div className={`bg-gradient-to-r ${theme.header} px-6 py-4 flex items-center justify-between`}>
                                    <div className="flex items-center gap-3">
                                        <CreditCard size={20} className="text-white/80 shrink-0" />
                                        <h3 className="text-white font-black text-[15px] uppercase tracking-widest">
                                            {TIPO_PAGO_LABELS[tipo] || tipo}
                                        </h3>
                                        <span className="bg-white/25 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full">
                                            {tipoRows.length} transacci{tipoRows.length !== 1 ? 'ones' : 'ón'}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-white/60 text-[9px] font-bold uppercase tracking-widest">Total pendiente</div>
                                        <div className="text-white font-black text-[18px] leading-none mt-0.5">{fmt(tipoTotal)}</div>
                                    </div>
                                </div>
                                {/* Table */}
                                <table className="w-full text-left border-collapse">
                                    <AuditThead cols={['Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', '']} />
                                    <tbody className="divide-y divide-black/[0.03]">
                                        {tipoPageRows.map(r => {
                                            const isConfirming = confirmingId === r.id;
                                            return (
                                                <React.Fragment key={r.id}>
                                                    <tr className={`transition-colors duration-200 group border-l-4 border-transparent ${theme.rowHover}`}>
                                                        <td className="p-5 pl-6">
                                                            <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border bg-slate-50 text-slate-500 border-slate-200">{r.tipo_documento}</span>
                                                            <div className="font-mono text-[12px] text-slate-700 mt-1">{r.correlativo}</div>
                                                        </td>
                                                        <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                                        <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[160px] truncate">{r.cliente || '—'}</td>
                                                        <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                                        <td className="p-5 text-[14px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                                        <td className="p-5 pr-6 text-right">
                                                            <button onClick={() => { setConfirmingId(isConfirming ? null : r.id); setConfirmNotes(''); setConfirmFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                                                className={`text-white px-4 py-2 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto hover:-translate-y-0.5 ${theme.btn}`}>
                                                                <Check size={13} strokeWidth={2.5} /> Confirmar
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {isConfirming && (
                                                        <tr>
                                                            <td colSpan={6} className={`px-5 py-4 border-t ${theme.expand}`}>
                                                                <div className="flex items-start gap-3 max-w-3xl">
                                                                    <div className="flex-1 space-y-2">
                                                                        <textarea
                                                                            className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 resize-none ${theme.input}`}
                                                                            rows={2} autoFocus
                                                                            placeholder="Notas del pago — ej: referencia, últimos 4 dígitos, nombre del emisor…"
                                                                            value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                                                                        />
                                                                        <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                                                                            <Paperclip size={14} />
                                                                            {confirmFile ? (
                                                                                <span className="text-slate-700 font-bold">{confirmFile.name}</span>
                                                                            ) : (
                                                                                <span>Adjuntar comprobante (imagen o PDF)</span>
                                                                            )}
                                                                            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden"
                                                                                onChange={e => setConfirmFile(e.target.files?.[0] || null)} />
                                                                        </label>
                                                                    </div>
                                                                    <div className="flex flex-col gap-2 shrink-0">
                                                                        <button onClick={() => handleConfirm(r.id)} disabled={confirmSaving}
                                                                            className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50 ${theme.btn}`}>
                                                                            {confirmSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                                                                        </button>
                                                                        <button onClick={() => setConfirmingId(null)}
                                                                            className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/80 hover:border-red-200 shadow transition-all hover:-translate-y-0.5">
                                                                            <X size={12} /> Cancelar
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <Pagination page={tipoPg} total={tipoTotalPages} onChange={p => setPendingPage(tipo, p)} />
                            </div>
                        );
                    })}

                    {/* ── Ventas a Crédito ── */}
                    {CREDIT_TIPOS.filter(t => byTipo[t]?.length > 0).length > 0 && (
                        <>
                            <div className="flex items-center gap-3 pt-2">
                                <div className="flex-1 h-px bg-black/[0.07]" />
                                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Ventas a crédito</span>
                                <div className="flex-1 h-px bg-black/[0.07]" />
                            </div>
                            {CREDIT_TIPOS.filter(t => byTipo[t]?.length > 0).map(tipo => {
                                const theme = TIPO_PAGO_THEME[tipo] || TIPO_PAGO_THEME.tarjeta;
                                const tipoRows = byTipo[tipo] || [];
                                const tipoTotal = tipoRows.reduce((a, r) => a + parseFloat(r.total || 0), 0);
                                const tipoPg = getPendingPage(tipo);
                                const tipoTotalPages = Math.ceil(tipoRows.length / PAGE_SIZE);
                                const tipoPageRows = tipoRows.slice((tipoPg - 1) * PAGE_SIZE, tipoPg * PAGE_SIZE);
                                return (
                                    <div key={tipo} className={`rounded-2xl border-2 overflow-hidden shadow-sm ${theme.card}`}>
                                        <div className={`bg-gradient-to-r ${theme.header} px-6 py-4 flex items-center justify-between`}>
                                            <div className="flex items-center gap-3">
                                                <CreditCard size={20} className="text-white/80 shrink-0" />
                                                <h3 className="text-white font-black text-[15px] uppercase tracking-widest">
                                                    {TIPO_PAGO_LABELS[tipo] || tipo}
                                                </h3>
                                                <span className="bg-white/25 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full">
                                                    {tipoRows.length} transacci{tipoRows.length !== 1 ? 'ones' : 'ón'}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-white/60 text-[9px] font-bold uppercase tracking-widest">Total pendiente</div>
                                                <div className="text-white font-black text-[18px] leading-none mt-0.5">{fmt(tipoTotal)}</div>
                                            </div>
                                        </div>
                                        <table className="w-full text-left border-collapse">
                                            <AuditThead cols={['Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', '']} />
                                            <tbody className="divide-y divide-black/[0.03]">
                                                {tipoPageRows.map(r => {
                                                    const isConfirming = confirmingId === r.id;
                                                    return (
                                                        <React.Fragment key={r.id}>
                                                            <tr className={`transition-colors duration-200 group border-l-4 border-transparent ${theme.rowHover}`}>
                                                                <td className="p-5 pl-6">
                                                                    <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border bg-slate-50 text-slate-500 border-slate-200">{r.tipo_documento}</span>
                                                                    <div className="font-mono text-[12px] text-slate-700 mt-1">{r.correlativo}</div>
                                                                </td>
                                                                <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                                                <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[160px] truncate">{r.cliente || '—'}</td>
                                                                <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                                                <td className="p-5 text-[14px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                                                <td className="p-5 pr-6 text-right">
                                                                    <button onClick={() => { setConfirmingId(isConfirming ? null : r.id); setConfirmNotes(''); setConfirmFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                                                        className={`text-white px-4 py-2 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto hover:-translate-y-0.5 ${theme.btn}`}>
                                                                        <Check size={13} strokeWidth={2.5} /> Confirmar
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                            {isConfirming && (
                                                                <tr>
                                                                    <td colSpan={6} className={`px-5 py-4 border-t ${theme.expand}`}>
                                                                        <div className="flex items-start gap-3 max-w-3xl">
                                                                            <div className="flex-1 space-y-2">
                                                                                <textarea
                                                                                    className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 resize-none ${theme.input}`}
                                                                                    rows={2} autoFocus
                                                                                    placeholder="Notas del crédito — ej: referencia, plazo acordado, responsable…"
                                                                                    value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                                                                                />
                                                                                <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                                                                                    <Paperclip size={14} />
                                                                                    {confirmFile ? <span className="text-slate-700 font-bold">{confirmFile.name}</span> : <span>Adjuntar documento de crédito</span>}
                                                                                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden"
                                                                                        onChange={e => setConfirmFile(e.target.files?.[0] || null)} />
                                                                                </label>
                                                                            </div>
                                                                            <div className="flex flex-col gap-2 shrink-0">
                                                                                <button onClick={() => handleConfirm(r.id)} disabled={confirmSaving}
                                                                                    className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50 ${theme.btn}`}>
                                                                                    {confirmSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                                                                                </button>
                                                                                <button onClick={() => setConfirmingId(null)}
                                                                                    className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/80 hover:border-red-200 shadow transition-all hover:-translate-y-0.5">
                                                                                    <X size={12} /> Cancelar
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        <Pagination page={tipoPg} total={tipoTotalPages} onChange={p => setPendingPage(tipo, p)} />
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            {/* Confirmados */}
            {confirmed.length > 0 && (
                <div className="border-t border-black/[0.06]">
                    <button onClick={() => setShowConfirmed(v => !v)}
                        className="w-full flex items-center justify-between px-5 pl-8 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-black/[0.02] transition-colors">
                        <span className="flex items-center gap-2"><Check size={12} className="text-blue-500" strokeWidth={3} />{confirmed.length} confirmado{confirmed.length !== 1 ? 's' : ''}</span>
                        {showConfirmed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showConfirmed && (
                        <div>
                            <div className="px-5 pl-8 py-3 border-b border-black/[0.04] flex items-center gap-3 bg-black/[0.01]">
                                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest shrink-0">Filtrar:</span>
                                <div className="w-[160px]">
                                    <LiquidSelect value={filterConfirmedTipo} onChange={setFilterConfirmedTipo} options={tipoFilterOpts} placeholder="Tipo pago" compact />
                                </div>
                                <div className="w-[180px]">
                                    <LiquidSelect value={filterConfirmedBranch} onChange={setFilterConfirmedBranch} options={branchFilterOpts} placeholder="Sucursal" compact />
                                </div>
                                {(filterConfirmedTipo || filterConfirmedBranch) && (
                                    <button onClick={() => { setFilterConfirmedTipo(''); setFilterConfirmedBranch(''); }}
                                        className="text-[10px] font-bold text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                                        <X size={12} /> Limpiar
                                    </button>
                                )}
                                <span className="ml-auto text-[10px] text-slate-400">{confirmedFiltered.length} resultado{confirmedFiltered.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="w-full overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <AuditThead cols={CONFIRMED_COLS} sortKey={cSortKey} sortDir={cSortDir} onSort={cToggle} />
                                    <tbody className="divide-y divide-black/[0.03]">
                                        {confirmedPageRows.map(r => {
                                            const inv = r.invoice;
                                            const tipoPago = r.tipo_pago?.toLowerCase() || '';
                                            const dt = r.confirmed_at ? new Date(r.confirmed_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                                            return (
                                                <tr key={r.id} className="hover:bg-white/70 transition-colors border-l-4 border-transparent hover:border-l-blue-400/50">
                                                    <td className="p-5 pl-8">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${TIPO_PAGO_COLORS[tipoPago] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_pago}</span>
                                                    </td>
                                                    <td className="p-5">
                                                        <div className="font-mono text-[12px] text-slate-600">{inv?.correlativo || '—'}</div>
                                                    </td>
                                                    <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                                    <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[140px] truncate">{inv?.cliente || '—'}</td>
                                                    <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{inv?.fecha || '—'}</td>
                                                    <td className="p-5 text-[13px] font-bold text-slate-700 whitespace-nowrap">{fmt(inv?.total)}</td>
                                                    <td className="p-5">
                                                        <div className="flex items-center gap-2">
                                                            {r.confirmed_by_photo ? (
                                                                <img src={r.confirmed_by_photo} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0" />
                                                            ) : (
                                                                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-[10px] font-bold shrink-0">
                                                                    {r.confirmed_by?.charAt(0)?.toUpperCase() || '?'}
                                                                </div>
                                                            )}
                                                            <span className="text-[12px] font-semibold text-slate-700 whitespace-nowrap">{r.confirmed_by || '—'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-5 text-[12px] text-slate-400 whitespace-nowrap">{dt}</td>
                                                    <td className="p-5">
                                                        {r.proof_url ? (
                                                            <a href={r.proof_url} target="_blank" rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-800 transition-colors">
                                                                <Paperclip size={12} /> Ver <ExternalLink size={10} />
                                                            </a>
                                                        ) : <span className="text-[12px] text-slate-300 italic">Sin comprobante</span>}
                                                    </td>
                                                    <td className="p-5 pr-8 text-[12px] text-slate-500 max-w-[180px]">{r.notes || <span className="italic text-slate-300">—</span>}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <Pagination page={confirmedPage} total={confirmedTotalPages} onChange={setConfirmedPage} />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'anuladas',     label: 'Anuladas'     },
    { key: 'pendiente_mh', label: 'Pendiente MH' },
    { key: 'saltos',       label: 'Saltos'        },
    { key: 'no_efectivo',  label: 'No Efectivo'   },
];

export default function FacturacionView() {
    const branches = useStaff((state) => state.branches);
    const { user: currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState('anuladas');
    const [filterBranch, setFilterBranch] = useState('');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearch, setRawSearch] = useState('');
    const searchInputRef = useRef(null);

    const salesBranches = useMemo(
        () => branches.filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const openSearch = () => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 50); };
    const closeSearch = () => { setIsSearchMode(false); setRawSearch(''); };

    const hasSearch = activeTab !== 'saltos';

    const searchPlaceholder = {
        anuladas:     'Buscar correlativo o cliente...',
        pendiente_mh: 'Buscar correlativo o cliente...',
        no_efectivo:  'Buscar correlativo, cliente o método...',
    }[activeTab] || 'Buscar...';

    const filtersContent = (
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchMode ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input ref={searchInputRef} type="text" placeholder={searchPlaceholder}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearch} onChange={e => setRawSearch(e.target.value)} />
                {rawSearch && (
                    <button onClick={() => setRawSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all shrink-0"><X size={16} strokeWidth={2.5} /></button>
                )}
                <button onClick={closeSearch} className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* Normal mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[900px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

                {TABS.map(tab => (
                    <button key={tab.key} onClick={() => { setActiveTab(tab.key); closeSearch(); }}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${
                            activeTab === tab.key
                                ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                        }`}>
                        {tab.label}
                    </button>
                ))}

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

                <div className="w-[150px] md:w-[200px] overflow-visible h-full flex items-center">
                    <LiquidSelect value={filterBranch} onChange={setFilterBranch} options={branchOptions} placeholder="Todas" icon={Building2} compact />
                </div>

                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                <a href="https://clientesdte3.oss.com.sv/farma_salud/admin_factura_rangos.php" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-all hover:-translate-y-0.5 active:scale-95 shrink-0 whitespace-nowrap">
                    <ExternalLink size={12} /> Admin Facturas
                </a>

                {hasSearch && (
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
            icon={FileText}
            title="Facturación"
            liveIndicator={activeTab === 'anuladas' || activeTab === 'pendiente_mh'}
            filtersContent={filtersContent}
        >
            <div className={activeTab === 'anuladas' ? '' : 'hidden'}>
                <TabAnuladas branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} currentUser={currentUser} />
            </div>
            <div className={activeTab === 'pendiente_mh' ? '' : 'hidden'}>
                <TabPendienteMH branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} currentUser={currentUser} />
            </div>
            <div className={activeTab === 'saltos' ? '' : 'hidden'}>
                <TabSaltos branches={salesBranches} filterBranch={filterBranch} currentUser={currentUser} />
            </div>
            <div className={activeTab === 'no_efectivo' ? '' : 'hidden'}>
                <TabNoEfectivo branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} currentUser={currentUser} />
            </div>
        </GlassViewLayout>
    );
}
