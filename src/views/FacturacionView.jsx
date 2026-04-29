import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    FileText, AlertTriangle, Clock, CreditCard, Building2,
    Loader2, Search, X, Check, History, ChevronRight,
    ChevronDown, ChevronUp, CheckCircle2, Paperclip, ExternalLink
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';

const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const fmt = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NON_CASH_TYPES = ['tarjeta', 'credito', 'transferencia', 'bitcoin', 'cheque'];
const TIPO_PAGO_ORDER = ['tarjeta', 'credito', 'transferencia', 'cheque', 'bitcoin'];

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
    const now = new Date(Date.now() - 6 * 3600_000);
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

// ─── Solve Row (shared expand pattern) ───────────────────────────────────────
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

// ─── Audit Table Wrappers ─────────────────────────────────────────────────────
function AuditThead({ cols, firstPl = 'pl-8', lastPr = 'pr-8' }) {
    return (
        <thead>
            <tr className="bg-black/[0.02] border-b border-black/[0.04]">
                {cols.map((c, i) => (
                    <th key={c} className={`p-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap ${i === 0 ? firstPl : ''} ${i === cols.length - 1 ? lastPr : ''}`}>
                        {c}
                    </th>
                ))}
            </tr>
        </thead>
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

    const filtered = useMemo(() => {
        const active = rows.filter(r => !resolvedIds.has(r.id));
        if (!searchTerm) return active;
        const s = searchTerm.toLowerCase();
        return active.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.codigo_generacion?.toLowerCase().includes(s)
        );
    }, [rows, resolvedIds, searchTerm]);

    const ccf = filtered.filter(r => r.tipo_documento === 'CCF');
    const cof = filtered.filter(r => r.tipo_documento !== 'CCF');

    return (
        <div>
            <div className="px-5 pl-8 py-4 bg-white/40 border-b border-black/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-4 text-[11px] font-bold uppercase text-slate-500 tracking-widest">
                    <span>{filtered.length} pendientes</span>
                    {ccf.length > 0 && (
                        <span className="flex items-center gap-1.5 text-red-600">
                            <AlertTriangle size={11} />{ccf.length} CCF urgente{ccf.length > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {lastRefresh ? `Act. ${lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-emerald-500" glowClass="bg-emerald-500"
                    title="Todo está al día" subtitle="No hay anulaciones pendientes por atender en este momento." />
            ) : (
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <AuditThead cols={['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Tiempo', '']} />
                        <tbody className="divide-y divide-black/[0.03]">
                            {[...ccf, ...cof].map(r => {
                                const isUrgent = r.tipo_documento === 'CCF';
                                const isSolving = solvingId === r.id;
                                return (
                                    <React.Fragment key={r.id}>
                                        <tr className={`hover:bg-white/70 transition-colors duration-200 group border-l-4 border-transparent ${isUrgent ? 'hover:border-l-red-400/50' : 'hover:border-l-[#007AFF]/50'}`}>
                                            <td className="p-5 pl-8">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${isUrgent ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_documento}</span>
                                                    {(r.estado === null || r.estado === 'undefined') && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-yellow-50 text-yellow-600 border border-yellow-200">UNDEFINED</span>}
                                                    {!r.recibido_mh && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-violet-50 text-violet-600 border border-violet-200">Pendiente MH</span>}
                                                </div>
                                                <div className="font-mono text-[12px] text-slate-700 mt-1 group-hover:text-[#007AFF] transition-colors">{r.correlativo}</div>
                                            </td>
                                            <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                            <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[180px] truncate">{r.cliente || '—'}</td>
                                            <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                            <td className="p-5 text-[14px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                            <td className="p-5">
                                                <span className={`inline-flex px-2 py-1 rounded-lg text-[11px] font-bold ${isUrgent ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>{timeAgo(r.fecha, r.hora)}</span>
                                            </td>
                                            <td className="p-5 pr-8 text-right">
                                                <button onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                    className="bg-white text-emerald-600 border border-slate-200 px-4 py-2 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-emerald-400 hover:bg-emerald-50 transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto">
                                                    <Check size={13} strokeWidth={2.5} /> Solventar
                                                </button>
                                            </td>
                                        </tr>
                                        {isSolving && (
                                            <SolveRow colSpan={7} comment={comment} setComment={setComment}
                                                onConfirm={() => handleSolve(r.id)} onCancel={() => setSolvingId(null)}
                                                saving={saving} placeholder="Comentario opcional — ej: cliente canceló, error de sistema…" />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && resolved.length > 0 && (
                <div className="border-t border-black/[0.04]">
                    <button onClick={() => setShowHistorial(v => !v)}
                        className="w-full flex items-center justify-between px-5 pl-8 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-black/[0.02] transition-colors">
                        <span className="flex items-center gap-2"><Check size={12} className="text-emerald-500" strokeWidth={3} />{resolved.length} solventada{resolved.length !== 1 ? 's' : ''}</span>
                        {showHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showHistorial && (
                        <div className="w-full overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <AuditThead cols={['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Solventado por', 'Cuándo', 'Comentario']} />
                                <tbody className="divide-y divide-black/[0.03]">
                                    {resolved.map(r => {
                                        const inv = r.invoice;
                                        const dt = r.resolved_at ? new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                                        return (
                                            <tr key={r.id} className="hover:bg-white/70 transition-colors border-l-4 border-transparent hover:border-l-emerald-400/50">
                                                <td className="p-5 pl-8">
                                                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 border border-emerald-200">{inv?.tipo_documento}</span>
                                                    <div className="font-mono text-[12px] text-slate-500 mt-1">{inv?.correlativo}</div>
                                                </td>
                                                <td className="p-5 text-[13px] text-slate-500 hidden md:table-cell">{getBranch(inv?.branch_id)}</td>
                                                <td className="p-5 text-[13px] text-slate-500 hidden lg:table-cell max-w-[160px] truncate">{inv?.cliente || '—'}</td>
                                                <td className="p-5 text-[13px] text-slate-400 whitespace-nowrap">{inv?.fecha}</td>
                                                <td className="p-5 text-[13px] font-bold text-slate-600 whitespace-nowrap">{fmt(inv?.total)}</td>
                                                <td className="p-5 text-[13px] font-semibold text-emerald-700 whitespace-nowrap">{r.resolved_by || '—'}</td>
                                                <td className="p-5 text-[12px] text-slate-400 whitespace-nowrap">{dt}</td>
                                                <td className="p-5 pr-8 text-[12px] text-slate-500 max-w-[220px]">{r.comment || <span className="italic text-slate-300">Sin comentario</span>}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: Pendiente MH ────────────────────────────────────────────────────────
function TabPendienteMH({ branches, filterBranch, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);

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

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.erp_invoice_id?.toString().includes(s)
        );
    }, [rows, searchTerm]);

    return (
        <div>
            <div className="px-5 pl-8 py-4 bg-white/40 border-b border-black/[0.04] flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-violet-600 tracking-widest">{filtered.length} pendientes MH</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {lastRefresh ? `Act. ${lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-violet-500" glowClass="bg-violet-500"
                    title="Sin pendientes de MH" subtitle="Todos los documentos han sido recibidos y confirmados por el Ministerio de Hacienda." />
            ) : (
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <AuditThead cols={['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Tiempo en espera']} />
                        <tbody className="divide-y divide-black/[0.03]">
                            {filtered.map(r => {
                                const isUrgent = r.tipo_documento === 'CCF';
                                return (
                                    <tr key={r.id} className="hover:bg-white/70 transition-colors duration-200 group border-l-4 border-transparent hover:border-l-violet-400/50">
                                        <td className="p-5 pl-8">
                                            <div className="flex items-center gap-2">
                                                <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${isUrgent ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_documento}</span>
                                                <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-violet-50 text-violet-600 border border-violet-200">Pendiente MH</span>
                                            </div>
                                            <div className="font-mono text-[12px] text-slate-700 mt-1 group-hover:text-violet-600 transition-colors">{r.correlativo}</div>
                                        </td>
                                        <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                        <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[180px] truncate">{r.cliente || '—'}</td>
                                        <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                        <td className="p-5 text-[14px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                        <td className="p-5">
                                            <span className="inline-flex px-2 py-1 rounded-lg text-[11px] font-bold bg-violet-50 text-violet-600">{timeAgo(r.fecha, r.hora)}</span>
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

// ─── Tab: Saltos ──────────────────────────────────────────────────────────────
function TabSaltos({ branches, filterBranch, currentUser }) {
    const [gaps, setGaps] = useState([]);
    const [nulls, setNulls] = useState([]);
    const [gapResolutions, setGapResolutions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [solvingGap, setSolvingGap] = useState(null);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const load = useCallback(async () => {
        setLoading(true);
        let qGaps  = supabase.from('sales_invoice_gaps').select('*');
        let qNulls = supabase.from('sales_invoice_nulls').select('*');
        if (filterBranch) { qGaps = qGaps.eq('branch_id', Number(filterBranch)); qNulls = qNulls.eq('branch_id', Number(filterBranch)); }
        const [{ data: gData }, { data: nData }, { data: rData }] = await Promise.all([
            qGaps, qNulls,
            supabase.from('sales_gap_resolutions').select('*').order('resolved_at', { ascending: false }),
        ]);
        setGaps(gData || []);
        setNulls(nData || []);
        setGapResolutions(rData || []);
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { load(); }, [load]);

    const gapKey = (g) => `${g.branch_id}__${g.tipo_documento}__${g.gap_from}__${g.gap_to}`;

    const resolvedGapKeys = useMemo(() =>
        new Set(gapResolutions.map(r => `${r.branch_id}__${r.tipo_documento}__${r.gap_from}__${r.gap_to}`)),
        [gapResolutions]
    );

    const pendingGaps = useMemo(() => gaps.filter(g => !resolvedGapKeys.has(gapKey(g))), [gaps, resolvedGapKeys]);
    const resolvedGaps = useMemo(() => {
        return gapResolutions.map(r => ({
            ...r,
            gap: gaps.find(g => g.branch_id === r.branch_id && g.tipo_documento === r.tipo_documento && g.gap_from === r.gap_from && g.gap_to === r.gap_to) || null,
        }));
    }, [gapResolutions, gaps]);

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

    if (loading) return <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;

    return (
        <div className="p-5 md:p-6 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className={`border rounded-2xl p-4 ${pendingGaps.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className={`text-xs font-medium mb-1 ${pendingGaps.length > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>Saltos pendientes</p>
                    <p className={`text-2xl font-bold ${pendingGaps.length > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{pendingGaps.length}</p>
                </div>
                <div className={`border rounded-2xl p-4 ${nulls.length > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className={`text-xs font-medium mb-1 ${nulls.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>Campos indefinidos</p>
                    <p className={`text-2xl font-bold ${nulls.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{nulls.length}</p>
                </div>
            </div>

            {/* Saltos pendientes */}
            <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Saltos en correlativos</p>
                {pendingGaps.length === 0 ? (
                    <EmptyState icon={CheckCircle2} iconClass="text-emerald-500" glowClass="bg-emerald-500"
                        title="Sin saltos detectados" subtitle="Los correlativos están en orden. No hay brechas detectadas." />
                ) : (
                    <div className="rounded-2xl border border-orange-200 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-orange-50/80 border-b border-orange-100 text-[11px] font-bold uppercase tracking-widest text-orange-700">
                                    <th className="px-5 py-3">Sucursal</th>
                                    <th className="px-5 py-3">Tipo</th>
                                    <th className="px-5 py-3">Desde</th>
                                    <th className="px-5 py-3">Hasta</th>
                                    <th className="px-5 py-3 text-right">Faltantes</th>
                                    <th className="px-5 py-3 hidden md:table-cell">Siguiente</th>
                                    <th className="px-5 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-orange-100">
                                {pendingGaps.map((g, i) => {
                                    const key = gapKey(g);
                                    const isSolving = solvingGap === key;
                                    return (
                                        <React.Fragment key={i}>
                                            <tr className="hover:bg-orange-50/40 transition-colors border-l-4 border-transparent hover:border-l-orange-400/60">
                                                <td className="px-5 py-3 text-[13px] text-slate-600">{getBranch(g.branch_id)}</td>
                                                <td className="px-5 py-3"><span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md">{g.tipo_documento}</span></td>
                                                <td className="px-5 py-3 font-mono text-[12px] text-slate-700">{String(g.gap_from).padStart(7, '0')}</td>
                                                <td className="px-5 py-3 font-mono text-[12px] text-slate-700">{String(g.gap_to).padStart(7, '0')}</td>
                                                <td className="px-5 py-3 text-right font-bold text-orange-700">{g.gap_count}</td>
                                                <td className="px-5 py-3 font-mono text-[11px] text-slate-400 hidden md:table-cell">{g.siguiente_correlativo}</td>
                                                <td className="px-5 py-3 text-right">
                                                    <button onClick={() => { setSolvingGap(isSolving ? null : key); setComment(''); }}
                                                        className="bg-white text-emerald-600 border border-slate-200 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest hover:border-emerald-400 hover:bg-emerald-50 transition-all shadow-sm active:scale-95 flex items-center gap-1.5 ml-auto">
                                                        <Check size={11} strokeWidth={2.5} /> Solventar
                                                    </button>
                                                </td>
                                            </tr>
                                            {isSolving && (
                                                <tr>
                                                    <td colSpan={7} className="px-5 py-4 bg-emerald-50/60 border-t border-emerald-100">
                                                        <div className="flex items-start gap-3 max-w-2xl">
                                                            <textarea
                                                                className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                                                                rows={2} autoFocus
                                                                placeholder="Comentario — ej: factura física encontrada, numeración externa, etc."
                                                                value={comment} onChange={e => setComment(e.target.value)}
                                                            />
                                                            <div className="flex flex-col gap-2 shrink-0">
                                                                <button onClick={() => handleSolveGap(g)} disabled={saving}
                                                                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50">
                                                                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                                                                </button>
                                                                <button onClick={() => setSolvingGap(null)}
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
                    </div>
                )}
            </div>

            {/* Campos nulos */}
            <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Campos indefinidos / nulos</p>
                {nulls.length === 0 ? (
                    <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">Sin registros con campos indefinidos</p>
                ) : (
                    <div className="rounded-2xl border border-red-200 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead><tr className="bg-red-50 text-[11px] font-bold uppercase tracking-widest text-red-700">
                                <th className="px-5 py-3">Sucursal</th><th className="px-5 py-3">Correlativo</th>
                                <th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Campos nulos</th>
                            </tr></thead>
                            <tbody className="divide-y divide-red-100">
                                {nulls.map(n => (
                                    <tr key={n.id} className="hover:bg-red-50/40 transition-colors">
                                        <td className="px-5 py-3 text-[13px] text-slate-600">{getBranch(n.branch_id)}</td>
                                        <td className="px-5 py-3 font-mono text-[12px]">{n.correlativo || n.erp_invoice_id || `ID ${n.id}`}</td>
                                        <td className="px-5 py-3 text-[13px] text-slate-600">{n.fecha || '—'}</td>
                                        <td className="px-5 py-3"><div className="flex flex-wrap gap-1">{(n.campos_nulos || []).map(c => <span key={c} className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-md">{c}</span>)}</div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Historial de saltos solventados */}
            {resolvedGaps.length > 0 && (
                <div className="border border-black/[0.06] rounded-2xl overflow-hidden">
                    <button onClick={() => setShowHistorial(v => !v)}
                        className="w-full flex items-center justify-between px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-black/[0.02] transition-colors">
                        <span className="flex items-center gap-2"><Check size={12} className="text-emerald-500" strokeWidth={3} />{resolvedGaps.length} salto{resolvedGaps.length !== 1 ? 's' : ''} solventado{resolvedGaps.length !== 1 ? 's' : ''}</span>
                        {showHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showHistorial && (
                        <table className="w-full text-left border-collapse">
                            <AuditThead cols={['Sucursal', 'Tipo', 'Desde', 'Hasta', 'Solventado por', 'Cuándo', 'Comentario']} />
                            <tbody className="divide-y divide-black/[0.03]">
                                {resolvedGaps.map(r => (
                                    <tr key={r.id} className="hover:bg-white/70 transition-colors border-l-4 border-transparent hover:border-l-emerald-400/50">
                                        <td className="p-5 pl-8 text-[13px] text-slate-600">{getBranch(r.branch_id)}</td>
                                        <td className="p-5"><span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">{r.tipo_documento}</span></td>
                                        <td className="p-5 font-mono text-[12px] text-slate-600">{String(r.gap_from).padStart(7, '0')}</td>
                                        <td className="p-5 font-mono text-[12px] text-slate-600">{String(r.gap_to).padStart(7, '0')}</td>
                                        <td className="p-5 text-[13px] font-semibold text-emerald-700">{r.resolved_by || '—'}</td>
                                        <td className="p-5 text-[12px] text-slate-400 whitespace-nowrap">{r.resolved_at ? new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                        <td className="p5 pr-8 text-[12px] text-slate-500">{r.comment || <span className="italic text-slate-300">Sin comentario</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
        const now = new Date(Date.now() - 6 * 3600_000);
        const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
        const last = new Date(y, now.getMonth() + 1, 0).getDate();
        return `${y}-${m}-01|${y}-${m}-${last}`;
    });
    const [confirmingId, setConfirmingId] = useState(null);
    const [confirmNotes, setConfirmNotes] = useState('');
    const [confirmFile, setConfirmFile] = useState(null);
    const [confirmSaving, setConfirmSaving] = useState(false);
    const fileInputRef = useRef(null);

    // Confirmed table filters
    const [filterConfirmedTipo, setFilterConfirmedTipo] = useState('');
    const [filterConfirmedBranch, setFilterConfirmedBranch] = useState('');
    const [showConfirmed, setShowConfirmed] = useState(false);

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

    const confirmedFiltered = useMemo(() => {
        let list = confirmed;
        if (filterConfirmedTipo) list = list.filter(r => r.tipo_pago?.toLowerCase() === filterConfirmedTipo);
        if (filterConfirmedBranch) list = list.filter(r => String(r.branch_id) === filterConfirmedBranch);
        return list;
    }, [confirmed, filterConfirmedTipo, filterConfirmedBranch]);

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
                <div className="space-y-0">
                    {TIPO_PAGO_ORDER.filter(t => byTipo[t]?.length > 0).map(tipo => {
                        const rows = byTipo[tipo] || [];
                        const tipoTotal = rows.reduce((a, r) => a + parseFloat(r.total || 0), 0);
                        return (
                            <div key={tipo}>
                                {/* Group header */}
                                <div className="px-5 pl-8 py-3 bg-black/[0.015] border-y border-black/[0.04] flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${TIPO_PAGO_COLORS[tipo] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{tipo}</span>
                                        <span className="text-[12px] font-semibold text-slate-600">{rows.length} transacciones</span>
                                    </div>
                                    <span className="text-[13px] font-bold text-slate-700">{fmt(tipoTotal)}</span>
                                </div>
                                {/* Table */}
                                <table className="w-full text-left border-collapse">
                                    <AuditThead cols={['Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', '']} />
                                    <tbody className="divide-y divide-black/[0.03]">
                                        {rows.map(r => {
                                            const isConfirming = confirmingId === r.id;
                                            return (
                                                <React.Fragment key={r.id}>
                                                    <tr className={`hover:bg-white/70 transition-colors duration-200 group border-l-4 border-transparent ${TIPO_PAGO_HOVER[tipo] || 'hover:border-l-[#007AFF]/50'}`}>
                                                        <td className="p-5 pl-8">
                                                            <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border bg-slate-50 text-slate-500 border-slate-200">{r.tipo_documento}</span>
                                                            <div className="font-mono text-[12px] text-slate-700 mt-1 group-hover:text-blue-600 transition-colors">{r.correlativo}</div>
                                                        </td>
                                                        <td className="p-5 text-[13px] text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                                        <td className="p-5 text-[13px] text-slate-600 hidden lg:table-cell max-w-[160px] truncate">{r.cliente || '—'}</td>
                                                        <td className="p-5 text-[13px] text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                                        <td className="p-5 text-[14px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                                        <td className="p-5 pr-8 text-right">
                                                            <button onClick={() => { setConfirmingId(isConfirming ? null : r.id); setConfirmNotes(''); setConfirmFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                                                className="bg-white text-blue-600 border border-slate-200 px-4 py-2 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-blue-400 hover:bg-blue-50 transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto">
                                                                <Check size={13} strokeWidth={2.5} /> Confirmar
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {isConfirming && (
                                                        <tr>
                                                            <td colSpan={6} className="px-5 py-4 bg-blue-50/50 border-t border-blue-100">
                                                                <div className="flex items-start gap-3 max-w-3xl">
                                                                    <div className="flex-1 space-y-2">
                                                                        <textarea
                                                                            className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                                                                            rows={2} autoFocus
                                                                            placeholder="Notas del pago — ej: referencia de transferencia, últimos 4 dígitos tarjeta, etc."
                                                                            value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                                                                        />
                                                                        <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-slate-500 hover:text-blue-600 transition-colors">
                                                                            <Paperclip size={14} />
                                                                            {confirmFile ? (
                                                                                <span className="text-blue-600">{confirmFile.name}</span>
                                                                            ) : (
                                                                                <span>Adjuntar comprobante (imagen o PDF)</span>
                                                                            )}
                                                                            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden"
                                                                                onChange={e => setConfirmFile(e.target.files?.[0] || null)} />
                                                                        </label>
                                                                    </div>
                                                                    <div className="flex flex-col gap-2 shrink-0">
                                                                        <button onClick={() => handleConfirm(r.id)} disabled={confirmSaving}
                                                                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50">
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
                            </div>
                        );
                    })}
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
                            {/* Filters for confirmed table */}
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
                                    <AuditThead cols={['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Confirmado por', 'Fecha conf.', 'Comprobante', 'Notas']} />
                                    <tbody className="divide-y divide-black/[0.03]">
                                        {confirmedFiltered.map(r => {
                                            const inv = r.invoice;
                                            const tipoPago = r.tipo_pago?.toLowerCase() || '';
                                            const dt = r.confirmed_at ? new Date(r.confirmed_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                                            return (
                                                <tr key={r.id} className="hover:bg-white/70 transition-colors border-l-4 border-transparent hover:border-l-blue-400/50">
                                                    <td className="p-5 pl-8">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${TIPO_PAGO_COLORS[tipoPago] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.tipo_pago}</span>
                                                        <div className="font-mono text-[12px] text-slate-600 mt-1">{inv?.correlativo || '—'}</div>
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
                <TabPendienteMH branches={salesBranches} filterBranch={filterBranch} searchTerm={rawSearch} />
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
