import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Badge from '../../components/common/Badge';
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';
import ViewTabBar from '../../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import FilterBar from '../../components/common/FilterBar';
import { tokenMatch } from '../../utils/searchUtils';
import {
    FolderOpen, Search, X, FileCheck, Stethoscope,
    FileText, Palmtree, RefreshCw, Calendar,
    Eye, AlertCircle, CheckCircle2, Clock, XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchOwnApprovalRequests } from '../../data/employeeSelfService';
import { openStoredFile } from '../../utils/storageFiles';
import GlassViewLayout from '../../components/GlassViewLayout';
import PeriodPicker from '../../components/common/PeriodPicker';

// ─── Configuración por tipo ────────────────────────────────────────────────
//
// El color de la categoría vive en el SQUIRCLE del ícono y en ningún otro
// lado. Hasta el 2026-09-04 cada tipo además teñía el borde de la tarjeta
// (`border-danger/30`) y le pisaba la sombra de hover con un `--shadow-glow-*`:
// las dos cosas reemplazan lo que trae `data-surface="card"` —el borde del tema
// y las seis capas del lente— así que la misma tarjeta se dibujaba con seis
// materiales distintos según el tipo de documento. Es la regla de §17.0 dicha
// para una tarjeta de contenido: el ícono lleva color, el fondo y el borde no.
const DOC_CFG = {
    DISABILITY:   { label: 'Incapacidad',     Icon: Stethoscope, iconBg: 'bg-danger/10',  iconCls: 'text-danger-text'  },
    CERTIFICATE:  { label: 'Constancia',      Icon: FileCheck,   iconBg: 'bg-chart-1/10', iconCls: 'text-chart-1-text' },
    VACATION:     { label: 'Vacaciones',      Icon: Palmtree,    iconBg: 'bg-success/10', iconCls: 'text-success-text' },
    PERMIT:       { label: 'Permiso',         Icon: FileText,    iconBg: 'bg-warning/10', iconCls: 'text-warning-text' },
    EXPEDIENTE:   { label: 'Del expediente',  Icon: FolderOpen,  iconBg: 'bg-brand/10',   iconCls: 'text-brand-text'   },
    SHIFT_CHANGE: { label: 'Cambio de turno', Icon: RefreshCw,   iconBg: 'bg-chart-9/10', iconCls: 'text-chart-9-text' },
};
const DEFAULT_CFG = {
    label: 'Documento', Icon: FileText,
    iconBg: 'bg-surface-card-hover', iconCls: 'text-content-3',
};

const STATUS_CFG = {
    // Los del expediente no son una solicitud: no se aprueban ni se rechazan,
    // simplemente están. Sin un estado propio caerían en el `|| { label:
    // undefined }` de abajo y la tarjeta mostraría una píldora vacía.
    EN_EXPEDIENTE: { label: 'En tu expediente', Icon: FolderOpen, variante: 'brand' },
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
    { key: 'EXPEDIENTE',  label: 'Del expediente' },
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

    // Los dos ramos del pie eran el MISMO bloque escrito dos veces: sólo
    // cambiaba el rótulo por defecto del archivo. Y el del expediente abría
    // `doc.meta.docUrl` sin preguntar si existía.
    const archivo = doc.meta?.docUrl
        ? (doc.meta.docName || (doc.type === 'EXPEDIENTE' ? 'Documento' : 'Documento adjunto'))
        : null;

    return (
        <div data-surface="card" className="h-full p-4 md:p-5">
            <div className="flex items-start gap-3 h-full">
                {/* Squircle de ícono — la única pieza con el color del tipo */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cfg.iconBg}`}>
                    <DocIcon size={16} className={cfg.iconCls} strokeWidth={2} />
                </div>

                {/* Columna de texto en COLUMNA y el pie con `mt-auto`: la grilla
                    iguala el alto de la fila, así que sin esto una ficha sin
                    nota queda con su pie a media caja y un vacío de 150px
                    debajo — al lado de otra cuyo pie está abajo del todo. La
                    fecha y el archivo son la línea base de la ficha; que se
                    alineen entre hermanas es lo que hace que la fila se lea
                    como una fila. */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
                        <div className="min-w-0">
                            <p className="text-body font-bold text-content leading-tight">{title}</p>
                            {period && (
                                <p className="text-caption text-content-3 font-medium mt-0.5 flex items-center gap-1">
                                    <Calendar size={11} />
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

                    {/* Días de permiso — van ANTES del pie: son parte de lo que
                        el documento dice, no de la línea de fecha y archivo.
                        Colgados debajo del separador quedaban fuera de la ficha
                        que la línea cierra. */}
                    {doc.meta?.permissionDates?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                            {doc.meta.permissionDates.slice(0, 5).map((d, i) => (
                                <Badge key={i} size="sm" uppercase={false}>{fmtDate(d)}</Badge>
                            ))}
                            {doc.meta.permissionDates.length > 5 && (
                                <Badge size="sm" uppercase={false}>+{doc.meta.permissionDates.length - 5} más</Badge>
                            )}
                        </div>
                    )}

                    {/* Footer: fecha + archivo */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mt-auto pt-3 border-t border-divider">
                        <p className="text-caption text-content-3 font-medium">
                            {doc.type === 'EXPEDIENTE' ? 'Guardado el ' : 'Solicitado el '}
                            {new Date(doc.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>

                        {archivo ? (
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-caption text-content-3 font-medium truncate max-w-[140px]">
                                    {archivo}
                                </span>
                                <Button variant="secondary" size="sm" icon={Eye}
                                    onClick={() => openStoredFile(doc.meta.docUrl)}>Ver</Button>
                            </div>
                        ) : (
                            <span className="text-caption text-content-3 font-medium italic">Sin archivo adjunto</span>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};

// ─── Vista principal ───────────────────────────────────────────────────────
const EmployeeDocumentsView = () => {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);

    const [allDocs, setAllDocs]       = useState([]);
    const [loading, setLoading]       = useState(true);
    const [search, setSearch]         = useState('');
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo]     = useState('');
    const [filterStatus, setFilterStatus] = useState('');


    useEffect(() => {
        if (!user?.id) return;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
        // Devuelve el ARRAY —ya paginado—, no `{ data }`.
        fetchOwnApprovalRequests(user.id)
            .then((rows) => {
                const parsed = (rows || []).map(r => ({ ...r, meta: parseMeta(r.metadata) }));
                // Documentos relevantes: constancias + cualquier solicitud con archivo adjunto
                setAllDocs(parsed.filter(r => r.meta?.docUrl || r.type === 'CERTIFICATE'));
                setLoading(false);
            })
            .catch((e) => { console.error('EmployeeDocumentsView: documentos falló:', e?.message ?? e); setLoading(false); });
    }, [user?.id]);

    // ── Y los que ya están en el expediente ────────────────────────────────
    //
    // La pantalla se llama «Mis documentos» y hasta el 2026-09-04 mostraba sólo
    // SOLICITUDES con adjunto. Para las 43 personas a las que se les acaba de
    // encender salía vacía, porque no pueden crear solicitudes personales —el
    // módulo está apagado— así que la pantalla prometía algo que no tenía.
    //
    // El DUI, el contrato y las constancias que Talento Humano guardó SÍ los
    // tiene todo el mundo. Y desde que las rutas llevan el id del dueño y la
    // policy de Storage lo respeta (2026-09-03/04), la persona puede abrir los
    // suyos: antes esto habría sido dibujar un botón que la base iba a rechazar.
    //
    // Salen del store y no de una consulta nueva: `fetchBoot` ya trae la ficha
    // propia, y para el resto de la empresa `employees_safe` no publica nada que
    // esta persona no pudiera ver igual.
    const docsDelExpediente = useMemo(() => {
        const mia = (employees || []).find(e => String(e.id) === String(user?.id));
        return (mia?.employee_documents || [])
            .filter(d => d?.url)
            .map((d, i) => ({
                id: `expediente-${i}`,
                type: 'EXPEDIENTE',
                status: 'EN_EXPEDIENTE',
                note: null,
                created_at: d.uploaded_at || d.issue_date || mia?.hire_date || new Date().toISOString(),
                meta: { docUrl: d.url, docName: d.title || d.category || d.file_name || 'Documento' },
            }));
    }, [employees, user?.id]);

    // Una sola lista: la persona no distingue «solicitud con adjunto» de
    // «documento del expediente», y no tiene por qué.
    const todos = useMemo(() => [...docsDelExpediente, ...allDocs], [docsDelExpediente, allDocs]);

    // ── Los conteos van en la PESTAÑA, y en ningún otro lado ───────────────
    //
    // Acá vivía una fila de cuatro baldosas escritas a mano —«Total»,
    // «Incapacidades», «Constancias», «Con archivo»— con fondo de color propio
    // y sin `data-surface`. Se retiró entera, y no sólo por el material:
    //
    //  · **Tres de las cuatro repetían la pestaña de al lado.** §17.0 es
    //    explícito: un desglose por categoría dibujado como métricas contesta
    //    UNA pregunta —qué recorte quiero ver— disfrazada de N, y su lugar es
    //    la fila de pestañas con el conteo en cada una. Que es donde ya estaba.
    //  · **Contaban `allDocs` y no `todos`**, o sea que dejaban afuera los del
    //    expediente. Y la fila entera se escondía con `allDocs.length === 0`:
    //    para quien sólo tiene documentos del expediente —las 43 personas de
    //    arriba— no se dibujaba ninguna.
    //
    // `Contador` devuelve `null` en cero, así que una pestaña vacía no dibuja
    // un «0»: es la misma burbuja que usa el resto del portal (§16.2), en vez
    // del `· N` pegado al rótulo que había acá.
    const counts = useMemo(() => {
        const c = { ALL: todos.length };
        TABS.slice(1).forEach(t => { c[t.key] = todos.filter(d => d.type === t.key).length; });
        return c;
    }, [todos]);

    // Una pestaña vacía no se dibuja, así que la lista que se le pasa al hook
    // tiene que ser ÉSA y no `TABS`: su contrato es «las visibles AHORA». Con la
    // lista entera, un `?tab=PERMIT` sin permisos guardados dejaba la vista
    // filtrando por una pestaña que no estaba en la fila —ninguna píldora
    // encendida en escritorio, y en el teléfono un `LiquidSelect` con un valor
    // que no está entre sus opciones—. Se corrige sola cuando llegan los datos:
    // `activa` se deriva de la dirección en cada render, no se guarda.
    const pestanas = useMemo(
        () => TABS.filter(t => counts[t.key] > 0 || t.key === 'ALL')
            .map(t => ({ ...t, cuenta: counts[t.key] })),
        [counts],
    );

    const [tab, setTab] = usePestanaEnUrl(pestanas, 'ALL');

    const filtered = useMemo(() => {
        let list = todos;
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
    }, [todos, tab, filterStatus, filterFrom, filterTo, search]);

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
            tabs={pestanas}
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
            {/* `PeriodPicker` y no dos `LiquidDatePicker` coordinados a mano: trae los
                atajos que acá se piden todo el tiempo —este mes, mes anterior,
                últimos 3 y 6 meses— y ocupa una ranura en vez de dos. Su contrato
                es un solo string `"desde|hasta"`, así que la vista lo arma y lo
                parte; el estado sigue siendo dos campos porque el filtrado los usa
                por separado. */}
            <FilterBar.Section active={!!filterFrom || !!filterTo}
                onClear={() => { setFilterFrom(''); setFilterTo(''); }} label="período">
                <PeriodPicker
                    value={filterFrom || filterTo ? `${filterFrom}|${filterTo}` : ''}
                    onChange={(v) => {
                        const [desde, hasta] = (v || '').split('|');
                        setFilterFrom(desde || '');
                        setFilterTo(hasta || '');
                    }}
                    placeholder="Cualquier fecha"
                />
            </FilterBar.Section>

            {/* Cinco opciones (Todos + los 4 estados): `FilterBar.Opciones` las
                resuelve como select solo. En segmentado se comían la píldora. */}
            <FilterBar.Section active={!!filterStatus} onClear={() => setFilterStatus('')} label="estado">
                <FilterBar.Opciones
                    label="Estado"
                    icon={FileCheck}
                    value={filterStatus}
                    onChange={setFilterStatus}
                    options={[{ value: '', label: 'Todos' },
                        ...Object.entries(STATUS_CFG).map(([k, v]) => ({ value: k, label: v.label }))]}
                />
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <GlassViewLayout
            icon={FolderOpen}
            title="Mis documentos"
            filtersContent={renderFilters()}
            transparentBody
        >
            <div className="p-4 md:p-6 space-y-4">

                {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                <div className="flex justify-end">{filtrosCuerpo}</div>

                {/* Contenido */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="skeleton rounded-card h-36" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={search || hasFilters ? Search : FolderOpen}
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                        {filtered.map((doc, i) => (
                            <div key={doc.id} className="animate-stagger-child" style={{ '--stagger-delay': `${Math.min(i, 8) * 40}ms` }}>
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
