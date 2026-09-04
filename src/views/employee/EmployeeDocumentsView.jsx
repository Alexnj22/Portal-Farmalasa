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
    FileText, Palmtree, RefreshCw,
    AlertCircle, CheckCircle2, Clock, XCircle, Paperclip,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchOwnApprovalRequests } from '../../data/employeeSelfService';
import GlassViewLayout from '../../components/GlassViewLayout';
import PeriodPicker from '../../components/common/PeriodPicker';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import VisorDeDocumento from '../../components/common/VisorDeDocumento';
import { getExpiryBadge } from '../../utils/documentExpiry';
import {
    nombreDeDocumento, grupoDeCategoria, iconoDeCategoria,
    tinteDeCategoria, descripcionDelArchivo,
} from '../../utils/documentosDelExpediente';

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

// ─── Un hecho del documento ────────────────────────────────────────────────
//
// Rótulo arriba, valor abajo. Es el mismo par que ya usa el resto del portal
// (`text-micro` en versalitas para el rótulo, cuerpo para el valor), y va como
// componente porque acá se repiten hasta cinco por ficha: escritos a mano, el
// tercero termina con otro gris.
const Dato = ({ rotulo, children, tono = 'text-content' }) => (
    <div className="min-w-0">
        <p className="text-micro font-black uppercase tracking-widest text-content-3">{rotulo}</p>
        <p className={`text-body-sm font-bold truncate ${tono}`}>{children}</p>
    </div>
);

// ─── Componente DocCard ────────────────────────────────────────────────────
//
// ── La ficha dice QUÉ es el documento, no de qué lista salió (2026-09-04) ──
//
// Reportado con una captura: una ficha titulada «Del expediente» con la palabra
// `DUI_COMPLETO` en letra chica abajo a la derecha. Los dos lados mal a la vez —
// el título era la categoría interna del portal y el nombre real estaba
// degradado a pie de página, con la clave cruda de la base como texto.
//
// Hoy el título es el nombre del documento (`nombreDeDocumento`, que sale del
// catálogo compartido y nunca devuelve una clave) y debajo va el grupo: por qué
// esta persona tiene ese papel. «Del expediente» dejó de ser un título porque no
// nombra nada: todos lo son.
//
// ── Y se abre acá, no en otra pestaña ─────────────────────────────────────
//
// Pedido del usuario: *«que lo pueda abrir en un modal grande para ver bien el
// documento»*. La ficha entera es el control —no un botón «Ver» adentro— porque
// dos afordancias para la misma acción se leen como dos acciones: es la regla
// escrita en `OjoDeTarjeta`, y el ojo de arriba a la derecha es lo que lo
// anuncia antes de tocar. Una ficha SIN archivo no es un botón: no hay nada que
// abrir, y un control que no hace nada es peor que ninguno.
const DocCard = ({ doc, alAbrir }) => {
    const cfg    = DOC_CFG[doc.type] || DEFAULT_CFG;
    // Los cuatro documentos del expediente de una persona dibujaban la MISMA
    // carpeta, porque el ícono salía de `doc.type` y ahí todos son
    // `EXPEDIENTE`. Un DUI, un carné de junta y una copia del ISSS no son la
    // misma clase de papel, y el ícono es lo primero que se mira.
    const delExpediente = doc.type === 'EXPEDIENTE';
    const DocIcon = delExpediente ? iconoDeCategoria(doc.meta?.categoria) : cfg.Icon;
    const tinte   = delExpediente ? tinteDeCategoria(doc.meta?.categoria) : cfg;

    // ── El estado que se muestra es el MÁS URGENTE ────────────────────────
    // Un carné vencido con la píldora «En tu expediente» en azul dice que todo
    // está en orden. El vencimiento gana: es lo único de esta ficha que pide
    // hacer algo. `getExpiryBadge` es el mismo cálculo que usan el expediente y
    // el aviso de vencimientos — sin él serían tres umbrales que se separan.
    const vence  = getExpiryBadge(doc.meta?.expiryDate);
    const base   = STATUS_CFG[doc.status] || { label: doc.status, Icon: AlertCircle, variante: 'neutral' };
    const status = vence
        ? { label: vence.label, Icon: vence.variant === 'danger' ? XCircle : Clock, variante: vence.variant }
        : base;
    const StatusIcon = status.Icon;

    const title = delExpediente
        ? doc.meta.nombre
        : (doc.type === 'CERTIFICATE' && doc.meta?.certificateType
            ? (CERT_LABELS[doc.meta.certificateType] || cfg.label)
            : cfg.label);

    // La segunda línea: de qué clase de documento se trata. En el expediente es
    // el grupo del catálogo («Identidad», «Cada año»); en una solicitud es el
    // tipo, que en esos casos NO es el título.
    // Sin «· Del expediente» pegado detrás: la píldora de la derecha ya lo dice,
    // y en el teléfono ese sufijo era lo único que se veía —«Identidad · De…»,
    // «ISSS y AFP · Del…»—, o sea que el truncado se comía el grupo, que es el
    // dato, para dejar la mitad de una redundancia.
    const bajada = delExpediente
        ? (grupoDeCategoria(doc.meta.categoria) || 'Del expediente')
        : (title === cfg.label ? 'Solicitud' : cfg.label);

    const periodo = doc.meta?.startDate
        ? `${fmtDate(doc.meta.startDate)}${doc.meta.endDate ? ` — ${fmtDate(doc.meta.endDate)}` : ''}`
        : null;

    // ── Los hechos, en el orden en que se preguntan ───────────────────────
    // Se arman como lista y no como JSX suelto para que la ficha de una
    // incapacidad y la de un DUI tengan la misma forma aunque no tengan los
    // mismos datos: lo que falta no deja un hueco, deja una celda menos.
    const datos = [];
    if (periodo) datos.push({ rotulo: delExpediente ? 'Vigencia' : 'Período', valor: periodo });
    if (doc.meta?.permissionDates?.length) {
        datos.push({ rotulo: 'Días', valor: `${doc.meta.permissionDates.length} día${doc.meta.permissionDates.length !== 1 ? 's' : ''}` });
    }
    datos.push({
        rotulo: delExpediente ? 'Guardado' : 'Solicitado',
        valor: new Date(doc.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }),
    });
    if (doc.meta?.issueDate) datos.push({ rotulo: 'Emitido', valor: fmtDate(doc.meta.issueDate) });
    if (doc.meta?.expiryDate) {
        datos.push({
            rotulo: 'Vence', valor: fmtDate(doc.meta.expiryDate),
            tono: vence ? (vence.variant === 'danger' ? 'text-danger-text' : 'text-warning-text') : 'text-content',
        });
    }
    if (doc.meta?.versiones > 0) {
        datos.push({
            rotulo: 'Anteriores',
            valor: `${doc.meta.versiones} versi${doc.meta.versiones === 1 ? 'ón' : 'ones'}`,
        });
    }

    const abre = !!doc.meta?.docUrl;
    const Tag  = abre ? 'button' : 'div';

    return (
        <Tag
            type={abre ? 'button' : undefined}
            onClick={abre ? () => alAbrir(doc) : undefined}
            // `data-interactive` pone el gel al presionar y el destello al
            // apuntar; el `<button>` nativo ya trae el contrato de teclado, así
            // que no hace falta `clickable()`.
            data-interactive={abre ? '' : undefined}
            data-surface="card"
            aria-label={abre ? `Ver ${title}` : undefined}
            className={`group h-full w-full text-left p-4 md:p-5 ${abre ? '' : 'cursor-default'}`}
        >
            <div className="flex items-start gap-3 h-full">
                {/* Squircle de ícono — la única pieza con color. §17.0: identifica
                    la categoría de un vistazo; el fondo y el borde de la ficha, no. */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tinte.iconBg}`}>
                    {/* eslint-disable-next-line react-hooks/static-components -- `DocIcon` elige entre los íconos ya importados de `documentosDelExpediente`, no crea un componente */}
                    <DocIcon size={16} className={tinte.iconCls} strokeWidth={2} />
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                            <p className="text-body font-bold text-content leading-tight">{title}</p>
                            <p className="text-caption text-content-3 font-medium mt-0.5 truncate">{bajada}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant={status.variante} size="sm" icon={StatusIcon}>{status.label}</Badge>
                            {abre && <OjoDeTarjeta />}
                        </div>
                    </div>

                    {/* La nota de quien pidió, y la de quien resolvió. La segunda
                        faltaba: `approver_note` se traía de la base y no se
                        dibujaba en ningún lado, así que un rechazo no decía por
                        qué — que es justo el único caso en que hay algo que leer. */}
                    {doc.note && (
                        <p className="text-label text-content-3 font-medium leading-relaxed mb-2 line-clamp-2">{doc.note}</p>
                    )}
                    {doc.approver_note && (
                        <p className="text-label text-content-2 font-medium leading-relaxed mb-2 line-clamp-2">
                            <span className="font-black uppercase tracking-wide text-content-3">Respuesta · </span>
                            {doc.approver_note}
                        </p>
                    )}

                    {/* Los hechos. Dos columnas: en 148px de ancho útil una sola
                        deja la ficha larguísima y tres cortan los rótulos. */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        {datos.map(d => (
                            <Dato key={d.rotulo} rotulo={d.rotulo} tono={d.tono}>{d.valor}</Dato>
                        ))}
                    </div>

                    {/* El archivo: qué se va a abrir. Sin él la ficha no es un
                        botón, y decirlo es la mitad del dato. */}
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-divider text-caption font-medium text-content-3">
                        <Paperclip size={11} className="shrink-0" />
                        <span className="truncate">
                            {abre ? descripcionDelArchivo(doc.meta.docName, doc.meta.docUrl) : 'Sin archivo adjunto'}
                        </span>
                    </div>
                </div>
            </div>
        </Tag>
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
    // El documento abierto en el visor. `null` = ninguno.
    const [viendo, setViendo] = useState(null);


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
    //
    // Lo que se lleva de cada fila es lo que la ficha muestra, y nada más: el
    // NOMBRE canónico (`nombreDeDocumento`, no `title` crudo — 4 de los 8
    // documentos de producción lo tienen guardado como la clave), la categoría
    // para resolver el grupo, y las tres fechas. `historial` no viaja entero:
    // sólo cuántas versiones hay, que es lo que cabe en una ficha.
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
                meta: {
                    docUrl: d.url,
                    nombre: nombreDeDocumento(d),
                    categoria: d.category || null,
                    // El nombre del archivo es un dato del archivo, no del
                    // documento: si la fila no lo trae, se dice que hay un
                    // adjunto y ya. Antes acá caía el `title`, que es lo que
                    // ponía `DUI_COMPLETO` en el renglón del archivo.
                    docName: d.file_name || null,
                    issueDate: d.issue_date || null,
                    expiryDate: d.expiry_date || null,
                    versiones: Array.isArray(d.historial) ? d.historial.length : 0,
                },
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
                d.approver_note,
                DOC_CFG[d.type]?.label,
                // El nombre que se VE. Buscar «dui» no encontraba nada porque
                // la lista sólo miraba el nombre del archivo y el rótulo del
                // tipo, y ninguno de los dos dice «DUI».
                d.meta?.nombre,
                grupoDeCategoria(d.meta?.categoria),
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
                                <DocCard doc={doc} alAbrir={setViendo} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── El documento, acá mismo ───────────────────────────────────
                `VisorDeDocumento` es el canónico y ya resolvía todo lo que hace
                falta: firma la URL del bucket privado, decide por el
                CONTENIDO —no por la extensión— si es imagen o PDF, y ofrece
                descargar o abrir aparte. Sin `onEditado` a propósito: acá la
                persona MIRA su expediente, no lo corrige; recortar y volver a
                subir es trabajo de Talento Humano y vive en la ficha. */}
            {viendo && (
                <VisorDeDocumento
                    url={viendo.meta.docUrl}
                    nombre={viendo.type === 'EXPEDIENTE'
                        ? viendo.meta.nombre
                        : (viendo.meta.docName || 'Documento adjunto')}
                    alCerrar={() => setViendo(null)}
                />
            )}
        </GlassViewLayout>
    );
};

export default EmployeeDocumentsView;
