import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    FileText, AlertTriangle, Clock, CreditCard, Building2,
    Loader2, BadgeAlert, Search, X, Check, History
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';

const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const fmt = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function timeAgo(fecha, hora) {
    const horaStr = hora?.length === 5 ? `${hora}:00` : hora;
    const dt = new Date(`${fecha}T${horaStr}-06:00`);
    const mins = Math.floor((Date.now() - dt.getTime()) / 60000);
    if (mins < 0) return '—';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${Math.floor(mins / 1440)}d`;
}

// ─── Tab: Anuladas ────────────────────────────────────────────────────────────
function TabAnuladas({ branches, filterBranch, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [resolvedIds, setResolvedIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);
    const [solvingId, setSolvingId] = useState(null);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);

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
        const [invoicesRes, resolvedRes] = await Promise.all([
            q,
            supabase.from('sales_invoice_resolutions').select('invoice_id'),
        ]);
        setRows(invoicesRes.data || []);
        setResolvedIds(new Set((resolvedRes.data || []).map(r => r.invoice_id)));
        setLastRefresh(new Date());
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => {
        const id = setInterval(loadData, 60_000);
        return () => clearInterval(id);
    }, [loadData]);

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        await supabase.from('sales_invoice_resolutions').insert({
            invoice_id: invoiceId,
            comment: comment.trim() || null,
        });
        setResolvedIds(prev => new Set([...prev, invoiceId]));
        setSolvingId(null);
        setComment('');
        setSaving(false);
    };

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

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
        <div className="space-y-0">
            <div className="px-4 md:px-8 py-4 bg-white/40 border-b border-white/90 flex items-center justify-between">
                <div className="flex items-center gap-4 text-[10px] md:text-[11px] font-black uppercase text-slate-500 tracking-widest">
                    <span>{filtered.length} pendientes</span>
                    {ccf.length > 0 && (
                        <span className="flex items-center gap-1.5 text-red-600">
                            <AlertTriangle size={11} />
                            {ccf.length} CCF urgente{ccf.length > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {lastRefresh ? `Act. ${lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-24 text-slate-500">
                    <BadgeAlert size={40} className="mx-auto mb-3 text-emerald-400" />
                    <p className="font-medium text-emerald-600">Sin anulaciones pendientes</p>
                    <p className="text-sm mt-1">Todas las facturas están correctas</p>
                </div>
            ) : (
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                        <thead className="bg-white/40">
                            <tr>
                                {['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Tiempo', ''].map(h => (
                                    <th key={h} className="px-4 md:px-8 py-4 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.12em] border-b border-white/40 whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/50">
                            {[...ccf, ...cof].map(r => {
                                const isUrgent = r.tipo_documento === 'CCF';
                                const isUndefined = r.estado === null || r.estado === 'undefined';
                                const isPendingMH = !r.recibido_mh;
                                const isSolving = solvingId === r.id;
                                return (
                                    <React.Fragment key={r.id}>
                                        <tr className="group hover:bg-[#007AFF]/[0.04] transition-colors duration-200">
                                            <td className="px-4 md:px-8 py-4">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${isUrgent ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                                                        {r.tipo_documento}
                                                    </span>
                                                    {isUndefined && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-yellow-50 text-yellow-600 border border-yellow-100">
                                                            UNDEFINED
                                                        </span>
                                                    )}
                                                    {isPendingMH && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-violet-50 text-violet-600 border border-violet-100">
                                                            Pendiente MH
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="font-mono text-[11px] text-slate-700 mt-1 group-hover:text-[#007AFF] transition-colors">{r.correlativo}</div>
                                                <div className="font-mono text-[10px] text-slate-400 mt-0.5">{r.erp_invoice_id || '—'}</div>
                                            </td>
                                            <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                            <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden lg:table-cell max-w-[180px] truncate">{r.cliente || '—'}</td>
                                            <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                            <td className="px-4 md:px-8 py-4 text-[12px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                            <td className="px-4 md:px-8 py-4">
                                                <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-bold ${isUrgent ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                                                    {timeAgo(r.fecha, r.hora)}
                                                </span>
                                            </td>
                                            <td className="px-4 md:px-8 py-4 text-right">
                                                <button
                                                    onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                    className="inline-flex items-center justify-center gap-1.5 px-3 md:px-4 py-1.5 md:py-2 bg-white/70 hover:bg-emerald-50 text-slate-500 hover:text-emerald-600 rounded-full font-bold text-[9px] md:text-[10px] uppercase tracking-widest transition-all duration-300 shadow-sm border border-white/80 hover:border-emerald-200 hover:shadow-md hover:-translate-y-0.5 active:scale-95 whitespace-nowrap"
                                                >
                                                    <Check size={12} strokeWidth={2.5} />
                                                    <span className="hidden sm:inline">Solventar</span>
                                                </button>
                                            </td>
                                        </tr>
                                        {isSolving && (
                                            <tr>
                                                <td colSpan={7} className="px-4 md:px-8 py-4 bg-emerald-50/60 border-t border-emerald-100">
                                                    <div className="flex items-start gap-3 max-w-2xl">
                                                        <textarea
                                                            className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                                                            rows={2}
                                                            placeholder="Comentario (opcional)"
                                                            value={comment}
                                                            onChange={e => setComment(e.target.value)}
                                                            autoFocus
                                                        />
                                                        <div className="flex flex-col gap-2 shrink-0">
                                                            <button
                                                                onClick={() => handleSolve(r.id)}
                                                                disabled={saving}
                                                                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow transition-all hover:-translate-y-0.5 disabled:opacity-50"
                                                            >
                                                                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                                Confirmar
                                                            </button>
                                                            <button
                                                                onClick={() => setSolvingId(null)}
                                                                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/80 hover:border-red-200 shadow transition-all hover:-translate-y-0.5"
                                                            >
                                                                <X size={12} />
                                                                Cancelar
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
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLastRefresh(new Date());
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => {
        const id = setInterval(loadData, 120_000);
        return () => clearInterval(id);
    }, [loadData]);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.erp_invoice_id?.toString().includes(s)
        );
    }, [rows, searchTerm]);

    const ccf = filtered.filter(r => r.tipo_documento === 'CCF');
    const fac = filtered.filter(r => r.tipo_documento !== 'CCF');

    return (
        <div className="space-y-0">
            <div className="px-4 md:px-8 py-4 bg-white/40 border-b border-white/90 flex items-center justify-between">
                <div className="flex items-center gap-4 text-[10px] md:text-[11px] font-black uppercase text-slate-500 tracking-widest">
                    <span className="text-violet-600">{filtered.length} pendientes MH</span>
                    {ccf.length > 0 && (
                        <span className="flex items-center gap-1.5 text-red-600">
                            <AlertTriangle size={11} />
                            {ccf.length} CCF
                        </span>
                    )}
                </div>
                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {lastRefresh ? `Act. ${lastRefresh.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-24 text-slate-500">
                    <Clock size={40} className="mx-auto mb-3 text-violet-400" />
                    <p className="font-medium text-violet-600">Sin pendientes de MH</p>
                    <p className="text-sm mt-1">Todos los documentos han sido recibidos por el MH</p>
                </div>
            ) : (
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                        <thead className="bg-white/40">
                            <tr>
                                {['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Total', 'Tiempo en espera'].map(h => (
                                    <th key={h} className="px-4 md:px-8 py-4 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.12em] border-b border-white/40 whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/50">
                            {[...ccf, ...fac].map(r => {
                                const isUrgent = r.tipo_documento === 'CCF';
                                return (
                                    <tr key={r.id} className="group hover:bg-violet-50/30 transition-colors duration-200">
                                        <td className="px-4 md:px-8 py-4">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${isUrgent ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                                                    {r.tipo_documento}
                                                </span>
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-violet-50 text-violet-600 border border-violet-100">
                                                    Pendiente MH
                                                </span>
                                            </div>
                                            <div className="font-mono text-[11px] text-slate-700 mt-1 group-hover:text-violet-600 transition-colors">{r.correlativo}</div>
                                            <div className="font-mono text-[10px] text-slate-400 mt-0.5">{r.erp_invoice_id || '—'}</div>
                                        </td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden lg:table-cell max-w-[180px] truncate">{r.cliente || '—'}</td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                        <td className="px-4 md:px-8 py-4 text-[12px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
                                        <td className="px-4 md:px-8 py-4">
                                            <span className="inline-flex px-2 py-1 rounded-lg text-[10px] font-bold bg-violet-50 text-violet-600">
                                                {timeAgo(r.fecha, r.hora)}
                                            </span>
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

// ─── Tab: Saltos de Correlativo ───────────────────────────────────────────────
function TabSaltos({ branches, filterBranch }) {
    const [gaps, setGaps] = useState([]);
    const [nulls, setNulls] = useState([]);
    const [loading, setLoading] = useState(true);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            let qGaps  = supabase.from('sales_invoice_gaps').select('*');
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

// ─── Tab: No Efectivo ─────────────────────────────────────────────────────────
const NON_CASH_TYPES = ['tarjeta', 'credito', 'transferencia', 'bitcoin', 'cheque'];

const TIPO_PAGO_COLORS = {
    tarjeta:       'bg-blue-50 text-blue-700 border-blue-100',
    credito:       'bg-purple-50 text-purple-700 border-purple-100',
    transferencia: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    bitcoin:       'bg-orange-50 text-orange-700 border-orange-100',
    cheque:        'bg-teal-50 text-teal-700 border-teal-100',
};

function TabNoEfectivo({ branches, filterBranch, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date(Date.now() - 6 * 3600_000);
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const last = new Date(y, now.getMonth() + 1, 0).getDate();
        return `${y}-${m}-01|${y}-${m}-${last}`;
    });

    const monthOpts = useMemo(() => {
        const opts = [];
        const now = new Date(Date.now() - 6 * 3600_000);
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const pad = (n) => String(n).padStart(2, '0');
            const last = new Date(y, m, 0).getDate();
            const label = d.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
            opts.push({
                value: `${y}-${pad(m)}-01|${y}-${pad(m)}-${pad(last)}`,
                label: label.charAt(0).toUpperCase() + label.slice(1),
            });
        }
        return opts;
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [fini, ffin] = selectedMonth.split('|');
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, tipo_pago')
            .in('tipo_pago', NON_CASH_TYPES)
            .gte('fecha', fini)
            .lte('fecha', ffin)
            .order('fecha', { ascending: false })
            .order('hora', { ascending: false });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        const { data } = await q;
        setRows(data || []);
        setLoading(false);
    }, [filterBranch, selectedMonth]);

    useEffect(() => { loadData(); }, [loadData]);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Sucursal ${id}`;

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        const s = searchTerm.toLowerCase();
        return rows.filter(r =>
            r.correlativo?.toLowerCase().includes(s) ||
            r.cliente?.toLowerCase().includes(s) ||
            r.tipo_pago?.toLowerCase().includes(s)
        );
    }, [rows, searchTerm]);

    const totalAmount = useMemo(() => filtered.reduce((acc, r) => acc + parseFloat(r.total || 0), 0), [filtered]);

    const byType = useMemo(() => {
        const m = {};
        for (const r of filtered) {
            const t = r.tipo_pago?.toLowerCase() || 'otro';
            if (!m[t]) m[t] = { count: 0, total: 0 };
            m[t].count++;
            m[t].total += parseFloat(r.total || 0);
        }
        return m;
    }, [filtered]);

    return (
        <div className="space-y-0">
            <div className="px-4 md:px-8 py-4 bg-white/40 border-b border-white/90 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 text-[10px] md:text-[11px] font-black uppercase text-slate-500 tracking-widest flex-wrap">
                    <span>{filtered.length} transacciones</span>
                    <span className="text-blue-600">{fmt(totalAmount)} total</span>
                    {Object.entries(byType).map(([tipo, s]) => (
                        <span key={tipo} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${TIPO_PAGO_COLORS[tipo] || 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                            {tipo} ({s.count})
                        </span>
                    ))}
                </div>
                <div className="w-[160px] md:w-[200px]">
                    <LiquidSelect
                        value={selectedMonth}
                        onChange={setSelectedMonth}
                        options={monthOpts}
                        placeholder="Mes"
                        compact
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-24 text-slate-500">
                    <CreditCard size={40} className="mx-auto mb-3 text-blue-300" />
                    <p className="font-medium text-slate-600">Sin pagos no-efectivo en este período</p>
                </div>
            ) : (
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                        <thead className="bg-white/40">
                            <tr>
                                {['Tipo / Correlativo', 'Sucursal', 'Cliente', 'Fecha', 'Método', 'Total'].map(h => (
                                    <th key={h} className="px-4 md:px-8 py-4 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.12em] border-b border-white/40 whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/50">
                            {filtered.map(r => {
                                const tipoPagoKey = r.tipo_pago?.toLowerCase() || '';
                                return (
                                    <tr key={r.id} className="group hover:bg-blue-50/20 transition-colors duration-200">
                                        <td className="px-4 md:px-8 py-4">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border bg-slate-50 text-slate-500 border-slate-100">
                                                {r.tipo_documento}
                                            </span>
                                            <div className="font-mono text-[11px] text-slate-700 mt-1 group-hover:text-blue-600 transition-colors">{r.correlativo}</div>
                                        </td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden md:table-cell">{getBranch(r.branch_id)}</td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-600 hidden lg:table-cell max-w-[180px] truncate">{r.cliente || '—'}</td>
                                        <td className="px-4 md:px-8 py-4 text-[11px] md:text-xs text-slate-500 whitespace-nowrap">{r.fecha}</td>
                                        <td className="px-4 md:px-8 py-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${TIPO_PAGO_COLORS[tipoPagoKey] || 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                                                {r.tipo_pago}
                                            </span>
                                        </td>
                                        <td className="px-4 md:px-8 py-4 text-[12px] font-bold text-slate-800 whitespace-nowrap">{fmt(r.total)}</td>
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
    { key: 'anuladas',    label: 'Anuladas',        icon: AlertTriangle, color: 'text-red-500'    },
    { key: 'pendiente_mh',label: 'Pendiente MH',    icon: Clock,         color: 'text-violet-500' },
    { key: 'saltos',      label: 'Saltos',           icon: History,       color: 'text-orange-500' },
    { key: 'no_efectivo', label: 'No Efectivo',      icon: CreditCard,    color: 'text-blue-500'   },
];

export default function FacturacionView() {
    const branches = useStaff((state) => state.branches);
    const [activeTab, setActiveTab] = useState('anuladas');
    const [filterBranch, setFilterBranch] = useState('');
    const [rawSearch, setRawSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);

    const salesBranches = useMemo(
        () => branches.filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() => [
        { value: '', label: 'Todas las sucursales' },
        ...salesBranches.map(b => ({ value: String(b.id), label: b.name })),
    ], [salesBranches]);

    const openSearch = () => setSearchOpen(true);
    const closeSearch = () => { setSearchOpen(false); setRawSearch(''); };

    const hasSearch = !['saltos'].includes(activeTab);

    const filtersContent = (
        <div className="flex items-center gap-2 w-full overflow-x-auto scrollbar-hide px-4 md:px-6 py-2">
            {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                    <button
                        key={tab.key}
                        onClick={() => { setActiveTab(tab.key); setRawSearch(''); setSearchOpen(false); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all duration-300 shrink-0 ${
                            isActive
                                ? 'bg-white/80 text-slate-800 shadow-md border border-white/90'
                                : 'text-slate-500 hover:bg-white/40 hover:text-slate-700'
                        }`}
                    >
                        <Icon size={12} strokeWidth={2.5} className={isActive ? tab.color : ''} />
                        <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                );
            })}

            <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />

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

            {hasSearch && (
                <>
                    <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                    {searchOpen ? (
                        <div className="flex items-center gap-2 bg-white/80 rounded-full px-3 py-1.5 border border-white/90 shadow-sm">
                            <Search size={14} className="text-slate-400 shrink-0" />
                            <input
                                autoFocus
                                value={rawSearch}
                                onChange={e => setRawSearch(e.target.value)}
                                placeholder="Buscar..."
                                className="bg-transparent text-[12px] text-slate-700 outline-none w-32 md:w-48 placeholder:text-slate-400"
                            />
                            <button onClick={closeSearch} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <button onClick={openSearch}
                            className="w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transform-gpu relative">
                            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                            {rawSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                        </button>
                    )}
                </>
            )}
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
                <TabAnuladas
                    branches={salesBranches}
                    filterBranch={filterBranch}
                    searchTerm={rawSearch}
                />
            </div>
            <div className={activeTab === 'pendiente_mh' ? '' : 'hidden'}>
                <TabPendienteMH
                    branches={salesBranches}
                    filterBranch={filterBranch}
                    searchTerm={rawSearch}
                />
            </div>
            <div className={activeTab === 'saltos' ? '' : 'hidden'}>
                <TabSaltos
                    branches={salesBranches}
                    filterBranch={filterBranch}
                />
            </div>
            <div className={activeTab === 'no_efectivo' ? '' : 'hidden'}>
                <TabNoEfectivo
                    branches={salesBranches}
                    filterBranch={filterBranch}
                    searchTerm={rawSearch}
                />
            </div>
        </GlassViewLayout>
    );
}
