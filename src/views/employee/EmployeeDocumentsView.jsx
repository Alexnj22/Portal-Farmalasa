import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    FolderOpen, Search, X, ExternalLink, FileCheck, Stethoscope,
    FileText, Palmtree, RefreshCw, Filter, Calendar, ChevronDown, ChevronRight,
    Download, Eye, AlertCircle, CheckCircle2, Clock, XCircle, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabaseClient';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';

// ─── Configuración por tipo ────────────────────────────────────────────────
const DOC_CFG = {
    DISABILITY: {
        label: 'Incapacidad', Icon: Stethoscope,
        bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200',
        iconBg: 'bg-red-100', accent: 'bg-red-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(239,68,68,0.12)]',
    },
    CERTIFICATE: {
        label: 'Constancia', Icon: FileCheck,
        bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200',
        iconBg: 'bg-blue-100', accent: 'bg-blue-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(59,130,246,0.12)]',
    },
    VACATION: {
        label: 'Vacaciones', Icon: Palmtree,
        bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200',
        iconBg: 'bg-emerald-100', accent: 'bg-emerald-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]',
    },
    PERMIT: {
        label: 'Permiso', Icon: FileText,
        bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200',
        iconBg: 'bg-amber-100', accent: 'bg-amber-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(245,158,11,0.12)]',
    },
    SHIFT_CHANGE: {
        label: 'Cambio Turno', Icon: RefreshCw,
        bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200',
        iconBg: 'bg-cyan-100', accent: 'bg-cyan-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(6,182,212,0.12)]',
    },
};
const DEFAULT_CFG = {
    label: 'Documento', Icon: FileText,
    bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200',
    iconBg: 'bg-slate-100', accent: 'bg-slate-400',
    glow: 'hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]',
};

const STATUS_CFG = {
    APPROVED:  { label: 'Aprobada',  Icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    PENDING:   { label: 'Pendiente', Icon: Clock,         cls: 'bg-amber-100  text-amber-700  border-amber-200'   },
    REJECTED:  { label: 'Rechazada', Icon: XCircle,       cls: 'bg-red-100    text-red-600    border-red-200'     },
    CANCELLED: { label: 'Cancelada', Icon: X,             cls: 'bg-slate-100  text-slate-500  border-slate-200'   },
};

const CERT_LABELS = {
    LABORAL:  'Constancia Laboral',
    SALARIO:  'Constancia de Salario',
    BANCARIA: 'Constancia Bancaria',
};

const fmtDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

const parseMeta = (m) =>
    typeof m === 'object' && m ? m : (() => { try { return JSON.parse(m); } catch { return {}; } })();

// ─── TABS ──────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'ALL',         label: 'Todos'       },
    { key: 'DISABILITY',  label: 'Incapacidades' },
    { key: 'CERTIFICATE', label: 'Constancias' },
    { key: 'PERMIT',      label: 'Permisos'    },
];

// ─── Componente DocCard ────────────────────────────────────────────────────
const DocCard = ({ doc }) => {
    const cfg    = DOC_CFG[doc.type] || DEFAULT_CFG;
    const DocIcon = cfg.Icon;
    const status = STATUS_CFG[doc.status] || { label: doc.status, Icon: AlertCircle, cls: 'bg-slate-100 text-slate-500 border-slate-200' };
    const StatusIcon = status.Icon;

    const title = doc.type === 'CERTIFICATE' && doc.meta?.certificateType
        ? (CERT_LABELS[doc.meta.certificateType] || cfg.label)
        : cfg.label;

    const period = doc.meta?.startDate
        ? `${fmtDate(doc.meta.startDate)}${doc.meta.endDate ? ` — ${fmtDate(doc.meta.endDate)}` : ''}`
        : doc.meta?.permissionDates?.length
            ? `${doc.meta.permissionDates.length} día${doc.meta.permissionDates.length !== 1 ? 's' : ''} seleccionado${doc.meta.permissionDates.length !== 1 ? 's' : ''}`
            : null;

    return (
        <div className={`group relative bg-white/60 backdrop-blur-xl border rounded-[1.75rem] p-5 transition-all duration-300 hover:-translate-y-1 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ${cfg.glow} ${cfg.border} overflow-hidden`}>

            {/* Accent bar izquierda */}
            <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${cfg.accent} opacity-60`} />

            <div className="flex items-start gap-4 pl-3">
                {/* Ícono */}
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${cfg.iconBg} border ${cfg.border} shadow-sm`}>
                    <DocIcon size={18} className={cfg.text} strokeWidth={1.8} />
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                        <div>
                            <p className={`text-[13px] font-black ${cfg.text} leading-tight`}>{title}</p>
                            {period && (
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5 flex items-center gap-1">
                                    <Calendar size={9} />
                                    {period}
                                </p>
                            )}
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border flex-shrink-0 ${status.cls}`}>
                            <StatusIcon size={9} strokeWidth={2.5} />
                            {status.label}
                        </span>
                    </div>

                    {/* Nota */}
                    {doc.note && (
                        <p className="text-[11px] text-slate-500 font-medium leading-relaxed mb-2 line-clamp-2">{doc.note}</p>
                    )}

                    {/* Footer: fecha + archivo */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mt-2 pt-2 border-t border-slate-100/80">
                        <p className="text-[10px] text-slate-400 font-medium">
                            Solicitado el {new Date(doc.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>

                        {doc.meta?.docUrl ? (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 font-medium truncate max-w-[120px]">
                                    {doc.meta.docName || 'Documento adjunto'}
                                </span>
                                <a
                                    href={doc.meta.docUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all duration-200 hover:-translate-y-0.5 active:scale-95 ${cfg.bg} ${cfg.border} ${cfg.text}`}
                                >
                                    <Eye size={10} strokeWidth={2.5} />
                                    Ver
                                </a>
                            </div>
                        ) : (
                            <span className="text-[10px] text-slate-300 font-medium italic">Sin archivo adjunto</span>
                        )}
                    </div>

                    {/* Días de permiso */}
                    {doc.meta?.permissionDates?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {doc.meta.permissionDates.slice(0, 5).map((d, i) => (
                                <span key={i} className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                                    {fmtDate(d)}
                                </span>
                            ))}
                            {doc.meta.permissionDates.length > 5 && (
                                <span className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-slate-100 text-slate-500 border border-slate-200">
                                    +{doc.meta.permissionDates.length - 5} más
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Vista principal ───────────────────────────────────────────────────────
const EmployeeDocumentsView = () => {
    const { user } = useAuth();

    const [allDocs, setAllDocs]       = useState([]);
    const [loading, setLoading]       = useState(true);
    const [tab, setTab]               = useState('ALL');
    const [search, setSearch]         = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef              = useRef(null);
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo]     = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    useEffect(() => {
        if (!user?.id) return;
        setLoading(true);
        supabase
            .from('approval_requests')
            .select('id, type, status, metadata, created_at, note')
            .eq('employee_id', user.id)
            .order('created_at', { ascending: false })
            .then(({ data }) => {
                const parsed = (data || []).map(r => ({ ...r, meta: parseMeta(r.metadata) }));
                // Documentos relevantes: constancias + cualquier solicitud con archivo adjunto
                setAllDocs(parsed.filter(r => r.meta?.docUrl || r.type === 'CERTIFICATE'));
                setLoading(false);
            });
    }, [user?.id]);

    // Conteos por tipo para tabs
    const counts = useMemo(() => {
        const c = { ALL: allDocs.length };
        TABS.slice(1).forEach(t => { c[t.key] = allDocs.filter(d => d.type === t.key).length; });
        return c;
    }, [allDocs]);

    const filtered = useMemo(() => {
        let list = allDocs;
        if (tab !== 'ALL') list = list.filter(d => d.type === tab);
        if (filterStatus) list = list.filter(d => d.status === filterStatus);
        if (filterFrom)   list = list.filter(d => d.created_at.slice(0,10) >= filterFrom);
        if (filterTo)     list = list.filter(d => d.created_at.slice(0,10) <= filterTo);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter(d =>
                (d.note || '').toLowerCase().includes(q) ||
                (DOC_CFG[d.type]?.label || '').toLowerCase().includes(q) ||
                (d.meta?.docName || '').toLowerCase().includes(q) ||
                (CERT_LABELS[d.meta?.certificateType] || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [allDocs, tab, filterStatus, filterFrom, filterTo, search]);

    const hasFilters = filterStatus || filterFrom || filterTo;

    const clearFilters = useCallback(() => {
        setFilterStatus(''); setFilterFrom(''); setFilterTo('');
    }, []);

    // ── Filter bar ────────────────────────────────────────────────────────
    const renderFilters = () => (
        <div className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>
            {/* MODO BÚSQUEDA */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${searchOpen ? 'max-w-[800px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar documento..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[200px] sm:w-[350px] md:w-[500px] placeholder:text-slate-400 focus:ring-0"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    ref={(input) => { if (input && searchOpen) setTimeout(() => input.focus(), 100); }}
                />
                {search && (
                    <button onClick={() => setSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={() => { setSearchOpen(false); setSearch(''); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2" title="Cerrar">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>
            {/* MODO NORMAL */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${searchOpen ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-3 gap-1 md:gap-1.5'}`}>
                {TABS.filter(t => counts[t.key] > 0 || t.key === 'ALL').map(t => {
                    const isActive = tab === t.key;
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${isActive ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'}`}>
                            {t.label}{counts[t.key] > 0 && t.key !== 'ALL' ? ` · ${counts[t.key]}` : ''}
                        </button>
                    );
                })}
                <div className="w-px h-5 bg-slate-200/60 mx-1 shrink-0" />
                <button onClick={() => setFilterOpen(v => !v)}
                    className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${filterOpen || hasFilters ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'}`}>
                    <Filter size={10} strokeWidth={2.5} />
                    Filtrar
                    {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-[#007AFF] flex-shrink-0" />}
                </button>
                <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                <button onClick={() => setSearchOpen(true)}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu"
                    title="Buscar documentos">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {search && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={FolderOpen}
            title="Mis Documentos"
            filtersContent={renderFilters()}
            transparentBody={true}
            fixedScrollMode={false}
        >
            <div className="px-2 md:px-0 pb-10 space-y-4">

                {/* Panel filtros avanzados */}
                {filterOpen && (
                    <div className="bg-white/60 backdrop-blur-2xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                                <Filter size={10} /> Filtros avanzados
                            </p>
                            {hasFilters && (
                                <button onClick={clearFilters} className="flex items-center gap-1 text-[10px] font-black text-red-500 hover:text-red-700 transition-colors">
                                    <X size={10} strokeWidth={2.5} /> Limpiar
                                </button>
                            )}
                        </div>

                        {/* Rango de fechas */}
                        <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Período de solicitud</p>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                    <LiquidDatePicker value={filterFrom} onChange={setFilterFrom} />
                                </div>
                                <span className="text-slate-300 text-[12px] font-bold shrink-0">→</span>
                                <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                    <LiquidDatePicker value={filterTo} onChange={setFilterTo} />
                                </div>
                            </div>
                        </div>

                        {/* Estado */}
                        <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Estado</p>
                            <div className="flex flex-wrap gap-1.5">
                                {[{ key: '', label: 'Todos' }, ...Object.entries(STATUS_CFG).map(([k, v]) => ({ key: k, label: v.label }))].map(s => (
                                    <button
                                        key={s.key}
                                        onClick={() => setFilterStatus(s.key)}
                                        className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95 ${filterStatus === s.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats rápidos */}
                {!loading && allDocs.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        {[
                            { label: 'Total',         value: allDocs.length,                                               color: 'text-slate-700',    bg: 'bg-white/60'       },
                            { label: 'Incapacidades', value: allDocs.filter(d => d.type === 'DISABILITY').length,           color: 'text-red-600',      bg: 'bg-red-50/80'      },
                            { label: 'Constancias',   value: allDocs.filter(d => d.type === 'CERTIFICATE').length,          color: 'text-blue-600',     bg: 'bg-blue-50/80'     },
                            { label: 'Con Archivo',   value: allDocs.filter(d => d.meta?.docUrl).length,                   color: 'text-emerald-600',  bg: 'bg-emerald-50/80'  },
                        ].map(s => (
                            <div key={s.label} className={`${s.bg} backdrop-blur-sm border border-white/80 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]`}>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[22px] font-black leading-none ${s.color}`}>{s.value}</p>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{s.label}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Contenido */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="animate-pulse bg-white/60 rounded-[1.75rem] h-36 border border-white/80" style={{ animationDelay: `${i * 80}ms` }} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-500">
                        <div className="w-20 h-20 rounded-[2rem] bg-white/60 border border-white/80 flex items-center justify-center mb-4 shadow-sm">
                            <FolderOpen size={32} className="text-slate-300" strokeWidth={1.5} />
                        </div>
                        <p className="text-[15px] font-black text-slate-500 mb-1">
                            {search || hasFilters ? 'Sin resultados' : 'Sin documentos aún'}
                        </p>
                        <p className="text-[11px] text-slate-400 font-medium text-center max-w-xs">
                            {search || hasFilters
                                ? 'Intenta con otros filtros o términos de búsqueda.'
                                : 'Aquí aparecerán tus constancias, boletas de incapacidad y otros documentos adjuntos a tus solicitudes.'}
                        </p>
                        {(search || hasFilters) && (
                            <button
                                onClick={() => { setSearch(''); clearFilters(); setTab('ALL'); }}
                                className="mt-4 px-4 py-2 rounded-2xl bg-white/60 border border-white/80 text-[11px] font-black text-slate-600 hover:bg-white transition-all hover:-translate-y-0.5 active:scale-95"
                            >
                                Limpiar filtros
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                        {filtered.map((doc, i) => (
                            <div key={doc.id} className="animate-in fade-in slide-in-from-bottom-3 duration-300" style={{ animationDelay: `${i * 40}ms` }}>
                                <DocCard doc={doc} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeDocumentsView;
