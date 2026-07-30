import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Badge from '../../components/common/Badge';
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import { tokenMatch } from '../../utils/searchUtils';
import {
    FolderOpen, Search, X, ExternalLink, FileCheck, Stethoscope,
    FileText, Palmtree, RefreshCw, Calendar, ChevronDown, ChevronRight,
    Download, Eye, AlertCircle, CheckCircle2, Clock, XCircle, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchOwnApprovalRequests } from '../../data/employeeSelfService';
import { openStoredFile } from '../../utils/storageFiles';
import GlassViewLayout from '../../components/GlassViewLayout';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import SegmentedControl from '../../components/common/SegmentedControl';

// ─── Configuración por tipo ────────────────────────────────────────────────
const DOC_CFG = {
    DISABILITY: {
        label: 'Incapacidad', Icon: Stethoscope,
        bg: 'bg-danger/10', text: 'text-danger-text', border: 'border-danger/30',
        iconBg: 'bg-danger/10', accent: 'bg-danger',
        glow: 'hover:shadow-[var(--shadow-glow-danger)]',
    },
    CERTIFICATE: {
        label: 'Constancia', Icon: FileCheck,
        bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30',
        iconBg: 'bg-chart-1/10', accent: 'bg-chart-1',
        glow: 'hover:shadow-[var(--shadow-glow-chart-1)]',
    },
    VACATION: {
        label: 'Vacaciones', Icon: Palmtree,
        bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30',
        iconBg: 'bg-success/10', accent: 'bg-success',
        glow: 'hover:shadow-[var(--shadow-glow-success)]',
    },
    PERMIT: {
        label: 'Permiso', Icon: FileText,
        bg: 'bg-warning/10', text: 'text-warning-text', border: 'border-warning/30',
        iconBg: 'bg-warning/10', accent: 'bg-warning',
        glow: 'hover:shadow-[var(--shadow-glow-warning)]',
    },
    SHIFT_CHANGE: {
        label: 'Cambio Turno', Icon: RefreshCw,
        bg: 'bg-chart-9/10', text: 'text-chart-9-text', border: 'border-chart-9/30',
        iconBg: 'bg-chart-9/10', accent: 'bg-chart-9',
        glow: 'hover:shadow-[var(--shadow-glow-chart-9-lg)]',
    },
};
const DEFAULT_CFG = {
    label: 'Documento', Icon: FileText,
    bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-divider',
    iconBg: 'bg-surface-card-hover', accent: 'bg-content-3',
    glow: 'hover:shadow-[var(--shadow-elevation-md)]',
};

const STATUS_CFG = {
    APPROVED:  { label: 'Aprobada',  Icon: CheckCircle2, variante: 'success' },
    PENDING:   { label: 'Pendiente', Icon: Clock,        variante: 'warning' },
    REJECTED:  { label: 'Rechazada', Icon: XCircle,      variante: 'danger'  },
    CANCELLED: { label: 'Cancelada', Icon: X,            variante: 'neutral' },
};

const CERT_LABELS = {
    LABORAL:  'Constancia Laboral',
    SALARIO:  'Constancia de Salario',
    BANCARIA: 'Constancia Bancaria',
};

const fmtDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })
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
    const status = STATUS_CFG[doc.status] || { label: doc.status, Icon: AlertCircle, variante: 'neutral' };
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
        <div data-surface="card" className={`group relative p-5 transition-all duration-300 ${cfg.glow} ${cfg.border} overflow-hidden`}>

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
                            <p className={`text-body font-black ${cfg.text} leading-tight`}>{title}</p>
                            {period && (
                                <p className="text-caption text-content-3 font-medium mt-0.5 flex items-center gap-1">
                                    <Calendar size={9} />
                                    {period}
                                </p>
                            )}
                        </div>
                        <Badge variant={status.variante} size="sm" icon={StatusIcon}>{status.label}</Badge>
                    </div>

                    {/* Nota */}
                    {doc.note && (
                        <p className="text-label text-content-3 font-medium leading-relaxed mb-2 line-clamp-2">{doc.note}</p>
                    )}

                    {/* Footer: fecha + archivo */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mt-2 pt-2 border-t border-divider">
                        <p className="text-caption text-content-3 font-medium">
                            Solicitado el {new Date(doc.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>

                        {doc.meta?.docUrl ? (
                            <div className="flex items-center gap-1.5">
                                <span className="text-caption text-content-3 font-medium truncate max-w-[120px]">
                                    {doc.meta.docName || 'Documento adjunto'}
                                </span>
                                <Button variant="ghost" icon={Eye} className={`${cfg.bg} ${cfg.border} ${cfg.text}`} onClick={() => openStoredFile(doc.meta.docUrl)}>Ver</Button>
                            </div>
                        ) : (
                            <span className="text-caption text-content-3 font-medium italic">Sin archivo adjunto</span>
                        )}
                    </div>

                    {/* Días de permiso */}
                    {doc.meta?.permissionDates?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {doc.meta.permissionDates.slice(0, 5).map((d, i) => (
                                <Badge key={i} variant={cfg.variante} size="sm" uppercase={false}>{fmtDate(d)}</Badge>
                            ))}
                            {doc.meta.permissionDates.length > 5 && (
                                <Badge size="sm" uppercase={false}>+{doc.meta.permissionDates.length - 5} más</Badge>
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
    // D3.9 (2026-07-27): esta barra estaba reescrita a mano, como en otras 12
    // vistas. Cada copia traía sus propios aros de foco, su colapso sin `inert`
    // y su reveal sin foco — las tres cosas que costaron A16, A17 y A18. Ahora
    // sale del canónico: el estado del toggle, el contrato de Escape/click
    // afuera y la accesibilidad viven en un solo lugar.
    const renderFilters = () => (
        <ViewTabBar
            tabs={TABS.filter(t => counts[t.key] > 0 || t.key === 'ALL').map(t => ({
                key: t.key,
                label: `${t.label}${counts[t.key] > 0 && t.key !== 'ALL' ? ` · ${counts[t.key]}` : ''}`,
            }))}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar documento..."
        />
    );

    // ── Cuerpo: la barra de filtros (§17) ─────────────────────────────────
    // Los filtros vivían sueltos en un panel desplegable propio, detrás de un
    // botón "Filtrar": sin orden de ranuras, sin limpiar-todo en el lugar
    // canónico y con el panel empujando la lista hacia abajo al abrirse.
    // `FilterBar` ya trae el colapso —y en móvil lo hace mejor, como hoja
    // inferior—, así que el toggle sobraba.
    const filtrosCuerpo = (
        <FilterBar
            onClear={clearFilters}
            activeCount={[!!filterStatus, !!filterFrom, !!filterTo].filter(Boolean).length}
        >
            <FilterBar.Section active={!!filterFrom || !!filterTo}
                onClear={() => { setFilterFrom(''); setFilterTo(''); }} label="período">
                <div className="flex items-center gap-2">
                    <div className="w-[130px]">
                        <LiquidDatePicker compact shortcuts value={filterFrom} onChange={setFilterFrom} placeholder="Desde" />
                    </div>
                    <span className="text-content-3 text-body-sm font-bold shrink-0">→</span>
                    <div className="w-[130px]">
                        <LiquidDatePicker compact shortcuts value={filterTo} onChange={setFilterTo} placeholder="Hasta" />
                    </div>
                </div>
            </FilterBar.Section>

            <FilterBar.Section active={!!filterStatus} onClear={() => setFilterStatus('')} label="estado">
                <SegmentedControl
                    size="sm"
                    options={[{ value: '', label: 'Todos' },
                        ...Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))]}
                    value={filterStatus} onChange={setFilterStatus} label="Estado" />
            </FilterBar.Section>
        </FilterBar>
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

                {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                <div className="flex justify-end">{filtrosCuerpo}</div>

                {/* Stats rápidos */}
                {!loading && allDocs.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        {[
                            { label: 'Total',         value: allDocs.length,                                               color: 'text-content-2',    bg: 'bg-surface-card'       },
                            { label: 'Incapacidades', value: allDocs.filter(d => d.type === 'DISABILITY').length,           color: 'text-danger',      bg: 'bg-danger/10'      },
                            { label: 'Constancias',   value: allDocs.filter(d => d.type === 'CERTIFICATE').length,          color: 'text-chart-1-text',     bg: 'bg-chart-1/10'     },
                            { label: 'Con Archivo',   value: allDocs.filter(d => d.meta?.docUrl).length,                   color: 'text-success',  bg: 'bg-success/10'  },
                        ].map(s => (
                            <div key={s.label} className={`${s.bg} backdrop-blur-sm border border-border-card rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[var(--shadow-elevation-xs)]`}>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-title-lg font-black leading-none ${s.color}`}>{s.value}</p>
                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mt-0.5">{s.label}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Contenido */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="skeleton rounded-card h-36" style={{ '--stagger-delay': `${i * 80}ms` }} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={FolderOpen}
                        title={search || hasFilters ? 'Sin resultados' : 'Sin documentos aún'}
                        subtitle={search || hasFilters
                            ? 'Intenta con otros filtros o términos de búsqueda.'
                            : 'Aquí aparecerán tus constancias, boletas de incapacidad y otros documentos adjuntos a tus solicitudes.'}
                        action={(search || hasFilters) && (
                            <Button variant="secondary" icon={X}
                                onClick={() => { setSearch(''); clearFilters(); setTab('ALL'); }}>
                                Limpiar filtros
                            </Button>
                        )}
                    />
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
