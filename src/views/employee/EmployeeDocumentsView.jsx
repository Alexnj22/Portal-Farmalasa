import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { tokenMatch } from '../../utils/searchUtils';
import {
    FolderOpen, Search, X, ExternalLink, FileCheck, Stethoscope,
    FileText, Palmtree, RefreshCw, Filter, Calendar, ChevronDown, ChevronRight,
    Download, Eye, AlertCircle, CheckCircle2, Clock, XCircle, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchOwnApprovalRequests } from '../../data/employeeSelfService';
import { openStoredFile } from '../../utils/storageFiles';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';

// ─── Configuración por tipo ────────────────────────────────────────────────
const DOC_CFG = {
    DISABILITY: {
        label: 'Incapacidad', Icon: Stethoscope,
        bg: 'bg-danger/10', text: 'text-red-700', border: 'border-danger/30',
        iconBg: 'bg-danger/10', accent: 'bg-red-500',
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
        bg: 'bg-success/10', text: 'text-emerald-700', border: 'border-success/30',
        iconBg: 'bg-success/10', accent: 'bg-emerald-500',
        glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]',
    },
    PERMIT: {
        label: 'Permiso', Icon: FileText,
        bg: 'bg-warning/10', text: 'text-amber-700', border: 'border-warning/30',
        iconBg: 'bg-warning/10', accent: 'bg-amber-500',
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
    bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-slate-200',
    iconBg: 'bg-surface-card-hover', accent: 'bg-content-3',
    glow: 'hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]',
};

const STATUS_CFG = {
    APPROVED:  { label: 'Aprobada',  Icon: CheckCircle2, cls: 'bg-success/10 text-emerald-700 border-success/30' },
    PENDING:   { label: 'Pendiente', Icon: Clock,         cls: 'bg-warning/10  text-amber-700  border-warning/30'   },
    REJECTED:  { label: 'Rechazada', Icon: XCircle,       cls: 'bg-danger/10    text-danger    border-danger/30'     },
    CANCELLED: { label: 'Cancelada', Icon: X,             cls: 'bg-surface-card-hover  text-content-3  border-slate-200'   },
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
    const status = STATUS_CFG[doc.status] || { label: doc.status, Icon: AlertCircle, cls: 'bg-surface-card-hover text-content-3 border-slate-200' };
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
        <div className={`group relative bg-surface-card backdrop-blur-xl border rounded-[1.75rem] p-5 transition-all duration-300 hover:-translate-y-1 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ${cfg.glow} ${cfg.border} overflow-hidden`}>

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
                                <p className="text-[10px] text-content-3 font-medium mt-0.5 flex items-center gap-1">
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
                        <p className="text-[11px] text-content-3 font-medium leading-relaxed mb-2 line-clamp-2">{doc.note}</p>
                    )}

                    {/* Footer: fecha + archivo */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mt-2 pt-2 border-t border-slate-100/80">
                        <p className="text-[10px] text-content-3 font-medium">
                            Solicitado el {new Date(doc.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>

                        {doc.meta?.docUrl ? (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-content-3 font-medium truncate max-w-[120px]">
                                    {doc.meta.docName || 'Documento adjunto'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => openStoredFile(doc.meta.docUrl)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${cfg.bg} ${cfg.border} ${cfg.text}`}
                                >
                                    <Eye size={10} strokeWidth={2.5} />
                                    Ver
                                </button>
                            </div>
                        ) : (
                            <span className="text-[10px] text-content-3 font-medium italic">Sin archivo adjunto</span>
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
                                <span className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-surface-card-hover text-content-3 border border-slate-200">
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
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
        fetchOwnApprovalRequests(user.id)
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
            list = list.filter(d => tokenMatch(search,
                d.note,
                DOC_CFG[d.type]?.label,
                d.meta?.docName,
                CERT_LABELS[d.meta?.certificateType]
            ));
        }
        return list;
    }, [allDocs, tab, filterStatus, filterFrom, filterTo, search]);

    const hasFilters = filterStatus || filterFrom || filterTo;

    const clearFilters = useCallback(() => {
        setFilterStatus(''); setFilterFrom(''); setFilterTo('');
    }, []);

    // ── Filter bar ────────────────────────────────────────────────────────
    const renderFilters = () => (
        <div className={`flex items-center bg-surface-card backdrop-blur-2xl backdrop-saturate-[180%] border border-border-card shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>
            {/* MODO BÚSQUEDA */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${searchOpen ? 'max-w-[800px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-brand shrink-0" strokeWidth={2.5} />
                <input
                    ref={(input) => { searchInputRef.current = input; if (input && searchOpen) setTimeout(() => input.focus(), 100); }}
                    type="text"
                    placeholder="Buscar documento..."
                    className="flex-1 bg-transparent border-none outline-none text-[16px] md:text-[16px] font-bold text-content-2 w-[200px] sm:w-[350px] md:w-[500px] placeholder:text-content-3 focus:ring-0"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <button onClick={() => setSearch('')} className="p-1 text-content-3 hover:text-danger transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={() => { setSearchOpen(false); setSearch(''); }} className="w-11 h-11 rounded-full bg-transparent hover:bg-white text-content-3 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-brand hover:-translate-y-0.5 ml-2" title="Cerrar">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>
            {/* MODO NORMAL */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${searchOpen ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-3 gap-1 md:gap-1.5'}`}>
                {TABS.filter(t => counts[t.key] > 0 || t.key === 'ALL').map(t => {
                    const isActive = tab === t.key;
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${isActive ? 'bg-white text-content border-white shadow-md scale-[1.02]' : 'bg-transparent text-content-3 border-transparent hover:bg-white hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-border-card'}`}>
                            {t.label}{counts[t.key] > 0 && t.key !== 'ALL' ? ` · ${counts[t.key]}` : ''}
                        </button>
                    );
                })}
                <div className="w-px h-5 bg-surface-card-hover/60 mx-1 shrink-0" />
                <button onClick={() => setFilterOpen(v => !v)}
                    className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${filterOpen || hasFilters ? 'bg-white text-content border-white shadow-md scale-[1.02]' : 'bg-transparent text-content-3 border-transparent hover:bg-white hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-border-card'}`}>
                    <Filter size={10} strokeWidth={2.5} />
                    Filtrar
                    {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
                </button>
                <div className="h-6 w-px bg-surface-card mx-1 shrink-0" />
                <button onClick={() => setSearchOpen(true)}
                    className="relative w-11 h-11 bg-brand text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
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
                    <div className="bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-content-3 uppercase tracking-widest flex items-center gap-1.5">
                                <Filter size={10} /> Filtros avanzados
                            </p>
                            {hasFilters && (
                                <button onClick={clearFilters} className="flex items-center gap-1 text-[10px] font-black text-danger hover:text-red-700 transition-colors">
                                    <X size={10} strokeWidth={2.5} /> Limpiar
                                </button>
                            )}
                        </div>

                        {/* Rango de fechas */}
                        <div>
                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-2">Período de solicitud</p>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                    <LiquidDatePicker value={filterFrom} onChange={setFilterFrom} />
                                </div>
                                <span className="text-content-3 text-[12px] font-bold shrink-0">→</span>
                                <div className="flex-1 bg-white border border-slate-200 rounded-xl h-10 overflow-hidden">
                                    <LiquidDatePicker value={filterTo} onChange={setFilterTo} />
                                </div>
                            </div>
                        </div>

                        {/* Estado */}
                        <div>
                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-2">Estado</p>
                            <div className="flex flex-wrap gap-1.5">
                                {[{ key: '', label: 'Todos' }, ...Object.entries(STATUS_CFG).map(([k, v]) => ({ key: k, label: v.label }))].map(s => (
                                    <button
                                        key={s.key}
                                        onClick={() => setFilterStatus(s.key)}
                                        className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-[0.97] ${filterStatus === s.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-content-3 border-slate-200 hover:border-slate-300'}`}
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
                            { label: 'Total',         value: allDocs.length,                                               color: 'text-content-2',    bg: 'bg-surface-card'       },
                            { label: 'Incapacidades', value: allDocs.filter(d => d.type === 'DISABILITY').length,           color: 'text-danger',      bg: 'bg-danger/10'      },
                            { label: 'Constancias',   value: allDocs.filter(d => d.type === 'CERTIFICATE').length,          color: 'text-blue-600',     bg: 'bg-blue-50/80'     },
                            { label: 'Con Archivo',   value: allDocs.filter(d => d.meta?.docUrl).length,                   color: 'text-success',  bg: 'bg-success/10'  },
                        ].map(s => (
                            <div key={s.label} className={`${s.bg} backdrop-blur-sm border border-border-card rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]`}>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[22px] font-black leading-none ${s.color}`}>{s.value}</p>
                                    <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mt-0.5">{s.label}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Contenido */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="skeleton rounded-[1.75rem] h-36" style={{ '--stagger-delay': `${i * 80}ms` }} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-500">
                        <div className="w-20 h-20 rounded-[2rem] bg-surface-card border border-border-card flex items-center justify-center mb-4 shadow-sm">
                            <FolderOpen size={32} className="text-content-3" strokeWidth={1.5} />
                        </div>
                        <p className="text-[15px] font-black text-content-3 mb-1">
                            {search || hasFilters ? 'Sin resultados' : 'Sin documentos aún'}
                        </p>
                        <p className="text-[11px] text-content-3 font-medium text-center max-w-xs">
                            {search || hasFilters
                                ? 'Intenta con otros filtros o términos de búsqueda.'
                                : 'Aquí aparecerán tus constancias, boletas de incapacidad y otros documentos adjuntos a tus solicitudes.'}
                        </p>
                        {(search || hasFilters) && (
                            <button
                                onClick={() => { setSearch(''); clearFilters(); setTab('ALL'); }}
                                className="mt-4 px-4 py-2 rounded-2xl bg-surface-card border border-border-card text-[11px] font-black text-content-2 hover:bg-white transition-all hover:-translate-y-0.5 active:scale-[0.97]"
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
