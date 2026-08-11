import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import CuerpoDialogo from '../components/common/CuerpoDialogo';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Inbox, Check, X, ChevronDown,
    User, ClipboardList,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle,
    Search, ArrowLeftRight, Plus, Eye,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { smartFilter } from '../utils/searchUtils';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import RangeDatePicker from '../components/common/RangeDatePicker';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { REQUEST_TYPES, REQUEST_STATUS, esOperativa, adaptarMinMax } from '../store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests, decidirMinMax } from '../data/minmaxRequests';
import { ERP_NAMES } from '../constants/erp';
import { ICONO_POR_TIPO } from '../constants/tipoIconos';
import PortalTextarea from '../components/common/PortalTextarea';
import ModalShell from '../components/common/ModalShell';
import DetalleSolicitud from './solicitudes/DetalleSolicitud';
import { resumenMovimiento, esMovimiento, lineasDe, esParcial } from './solicitudes/movimientoTexto';

const CREATABLE_TYPES = [
    { key: 'VACATION',     icon: Palmtree },
    { key: 'PERMIT',       icon: FileText },
    { key: 'SHIFT_CHANGE', icon: RefreshCw },
    { key: 'OVERTIME',     icon: Coffee },
    { key: 'ADVANCE',      icon: DollarSign },
    { key: 'CERTIFICATE',  icon: FileCheck },
];

// El mapa vivía acá y se mudó a `constants/tipoIconos` (2026-08-01): la campana
// de notificaciones necesita los mismos íconos para los mismos tipos, y tener
// dos listas era garantía de que se desincronizaran.
const TYPE_ICONS = ICONO_POR_TIPO;

// Acá vivía `TYPE_COLORS` (tokenizado en T7, AUDITORIA-TEMA-2026-07.md): un color de relleno por cada tipo de solicitud —
// chart-1, chart-3, chart-4, chart-6, chart-8, chart-9, success, warning,
// danger— aplicado al círculo, al borde de la tarjeta, al resplandor del hover,
// al encabezado de sección y a cada bloque de detalle.
//
// Se fue por dos motivos, y el segundo es el que manda:
//
//  1. §6 dice que un `chart-N` solo se usa cuando el color distingue una
//     CATEGORÍA que el usuario reconoce, y que `chart-8` es de los cuatro que
//     "no se usan para nada nuevo". Acá el color no distinguía nada: el tipo ya
//     está escrito con todas sus letras y tiene su ícono.
//  2. Con nueve tintes compitiendo, **el color dejaba de significar estado**.
//     Una tarjeta rechazada y una de vacaciones se distinguían por matiz, y el
//     dato que de verdad importa —pendiente, aprobada, rechazada— quedaba
//     escondido en un punto de 8px.
//
// El canon queda: superficie neutra (`data-surface="card"`), el tipo se lee por
// ícono + nombre, y **el color se reserva para el estado**, en su insignia.

// El detalle por tipo —y el `IdVenta` que vivía acá— se mudó a
// `solicitudes/DetalleSolicitud.jsx` el 2026-08-10. Estaba escrito dos veces,
// acá y en `EmployeeRequestsView`, y las dos copias ya se habían separado: esta
// cubría 10 tipos y la otra 2. Con un solo archivo, el tipo nuevo aparece en los
// dos lados.

const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
const fmtDateFull = (iso) => !iso ? '—' : new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

// One-line summary shown in collapsed state
const CompactSummary = ({ req }) => {
    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    if (req.type === 'VACATION' && meta.startDate)
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}</span>;
    if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeName)
        return <span className="text-caption text-content-3">↔ {meta.targetEmployeeName.split(' ')[0]}{meta.date ? ` · ${fmtDate(meta.date)}` : ''}</span>;
    if (req.type === 'DISABILITY' && meta.startDate) {
        const days = meta.days || (meta.endDate ? Math.max(1, Math.round((new Date(meta.endDate+'T00:00:00') - new Date(meta.startDate+'T00:00:00')) / 86400000) + 1) : null);
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}{days ? ` · ${days}d` : ''}</span>;
    }
    if (req.type === 'PERMIT') {
        const dates = meta.permissionDates || [];
        if (dates.length) return <span className="text-caption text-content-3">{dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} días`}</span>;
    }
    if (req.type === 'ADVANCE' && meta.amount)
        return <span className="text-caption text-content-3">${Number(meta.amount).toLocaleString('es-SV')}</span>;
    if (req.type === 'CERTIFICATE' && meta.certificateType) {
        const labels = { LABORAL: 'Laboral', SALARIO: 'Salario', BANCARIA: 'Bancaria' };
        return <span className="text-caption text-content-3">{labels[meta.certificateType] || meta.certificateType}</span>;
    }
    if (req.type === 'ANNULMENT_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo}{meta.reason ? ` · ${meta.reason}` : ''}</span>;
    if (req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {meta.current_pago} → {meta.new_pago}</span>;
    // Por NOMBRE, no por código: «no quiero el código, quiero las fotos y
    // nombre» (usuario, 2026-08-10). Un `#140` no dice quién atendió.
    if (req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {(meta.current_vendor_name || 'Sin vendedor').split(' ')[0]} → {(meta.new_vendor_name || '').split(' ')[0]}</span>;
    if (req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {(meta.current_cliente || 'Sin nombre').split(' ')[0]} → {(meta.new_client_name || '').split(' ')[0]}</span>;
    // Los tres que mueven producto. Sin esta rama caían al `req.note`, o sea que
    // un descarte se resumía con el texto libre de quien lo pidió —«inyectorio»—
    // y el producto, que es lo que se está por sacar de la sala, no aparecía.
    if (esMovimiento(req.type))
        return <span className="text-caption text-content-3 truncate max-w-[220px]">{resumenMovimiento(meta)}</span>;
    if (req.type === 'MINMAX_CHANGE_REQUEST')
        return <span className="text-caption text-content-3 truncate max-w-[220px]">{meta.producto ?? `#${meta.erp_product_id}`} · MIN {meta.min_actual ?? '—'}→{meta.min_pedido ?? '—'}</span>;
    if (req.note) return <span className="text-caption text-content-3 italic truncate max-w-[160px]">&ldquo;{req.note}&rdquo;</span>;
    return null;
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
//
// La tarjeta DICE, el modal MUESTRA.
//
// Antes se desplegaba en el sitio, y traía tres problemas encima:
//
//  1. Las tarjetas viven en una rejilla de hasta 3 columnas. Desplegar una
//     empujaba toda su fila, con un `max-h-[900px]` de salto.
//  2. Lo que hay que mostrar no entra en un tercio de ancho —la tabla de
//     líneas, las fotos, y sobre todo la decisión por línea, que necesita una
//     casilla por renglón—. En el teléfono era inusable.
//  3. Era un `<button>` con más botones adentro, y por eso hacía falta `inert`
//     para que el teclado no cayera en controles escondidos.
//
// Y falta lo que la tarjeta NO decía: su tipo. El nombre del tipo vivía sólo en
// el encabezado del grupo, así que una tarjeta mirada sola no lo tenía, y el
// ícono caía al genérico en los tres tipos de inventario. Ahora el tipo se lee
// en la tarjeta misma, por ícono y por nombre — **nunca por color**: el color
// sigue reservado al estado, que es la decisión que ya tomó la auditoría de
// tema y que nueve tintes compitiendo habían roto.
const RequestCard = memo(({ req, onOpen }) => {
    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3' };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;
    const typeConf = REQUEST_TYPES[req.type] || { label: req.type };
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';
    const parcial    = esParcial(req);

    return (
        <button data-surface="card" onClick={() => onOpen(req)}
            className={`w-full text-left px-4 py-3.5 flex items-center gap-3 overflow-hidden transform-gpu
                hover:bg-surface-card-hover/40 active:scale-[0.99]
                transition-[background-color,transform,border-color] duration-[var(--dur-base)]
                ${isUrgent ? '!border-danger' : isRejected ? '!border-danger/30' : ''}`}>

            {/* El ícono dice el tipo; el color, el estado. */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-card-hover border border-divider">
                <TypeIcon size={15} strokeWidth={2} className="text-content-2" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {req.employee && (
                        <span className="text-body font-semibold text-content truncate leading-tight max-w-[160px]">
                            {req.employee.name}
                        </span>
                    )}
                    <span className={`flex items-center gap-1 text-caption font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                        {parcial ? 'Aprobada parcial' : statConf.label}
                    </span>
                    {isUrgent && <span className="text-micro font-black text-danger animate-pulse shrink-0">URGENTE</span>}
                </div>

                {/* El tipo, escrito. Una tarjeta fuera de su grupo no lo tenía. */}
                <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-0.5 truncate">
                    {typeConf.label}
                </p>

                <div className="flex items-center gap-1.5 flex-wrap">
                    <CompactSummary req={req} />
                    <span className="text-micro text-content-3 shrink-0">{fmtDateFull(req.created_at)}</span>
                </div>
            </div>

            <Eye size={14} strokeWidth={2.5} className="text-content-3 flex-shrink-0" />
        </button>
    );
});
RequestCard.displayName = 'RequestCard';

// ─── El modal de una solicitud ────────────────────────────────────────────────
//
// Ver primero, decidir después. El diálogo de aprobar/rechazar era una ventana
// aparte que se abría SIN haber mostrado nunca qué se estaba aprobando — y el
// enlace de la campana con `&accion=aprobar` iba derecho ahí. O sea que el
// camino más corto hasta una decisión era el que menos información daba.
//
// Acá la decisión vive DENTRO del detalle: se despliega debajo de lo que se
// está mirando, como hace la fila de un traslado, en vez de taparlo con otra
// ventana encima.
const ModalSolicitud = ({ req, canApprove, employeesById, onCerrar, onDecidir, ocupado, accionInicial }) => {
    const [modo, setModo]   = useState(accionInicial ?? null);   // null | 'approve' | 'reject'
    const [nota, setNota]   = useState('');
    const navigate          = useNavigate();
    const bloqueDecision    = useRef(null);

    const meta      = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const lineas    = lineasDe(meta);
    const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
    const decidible  = req.status === 'PENDING' && canApprove && !esTraslado;

    /* Qué entra y cuánto.
     *
     * Son DOS ajustes distintos y hacían falta los dos: quitar renglones enteros
     * («quitar unos») y bajarle la cantidad a uno que sí entra («modificar
     * unos»). Con sólo lo primero, que de 4 unidades pedidas entraran 2 obligaba
     * a rechazar la línea completa y pedir que la mandaran de nuevo.
     *
     * La cantidad se ofrece incluso con UNA sola línea: ahí no hay nada que
     * elegir entre renglones, pero sí cuánto de ese renglón entra. Las casillas,
     * en cambio, sólo aparecen con más de una — con una sola, desmarcarla es
     * rechazar, y para eso está su botón. */
    const editable = decidible && esMovimiento(req.type);
    const porLinea = editable && lineas.length > 1;

    const [seleccion, setSeleccion] = useState(() => new Set(lineas.map((_, i) => i)));
    const [cantidades, setCantidades] = useState(
        () => new Map(lineas.map((l, i) => [i, Number(l.cantidad) || 0])));

    const alternar = (i) => setSeleccion(prev => {
        const s = new Set(prev);
        s.has(i) ? s.delete(i) : s.add(i);
        return s;
    });
    const fijarCantidad = (i, n) => setCantidades(prev => {
        const tope = Number(lineas[i]?.cantidad) || 0;
        const m = new Map(prev);
        m.set(i, Math.max(1, Math.min(tope, n)));   // nunca 0 ni más de lo pedido
        return m;
    });

    const fuera    = lineas.length - seleccion.size;
    const recortes = [...seleccion].filter(i => (cantidades.get(i) ?? 0) < (Number(lineas[i]?.cantidad) || 0)).length;
    // «Parcial» es cualquier cosa que no sea exactamente lo que pidieron: falta
    // un renglón, o falta cantidad en alguno.
    const parcial  = editable && seleccion.size > 0 && (fuera > 0 || recortes > 0);

    // Aprobar sin nada seleccionado no es aprobar: es rechazar con otro nombre,
    // y se dice en vez de dejar apretar un botón que no hace lo que promete.
    const nadaSeleccionado = porLinea && seleccion.size === 0;

    const faltaMotivo = (modo === 'reject' && !nota.trim())
                     || (modo === 'approve' && parcial && !nota.trim());

    const confirmar = () => onDecidir({
        req, modo, nota: nota.trim(),
        // Qué entra y cuánto — sólo cuando de verdad se cambió algo. Van los
        // ÍNDICES con su cantidad, nunca las líneas: el servidor las resuelve
        // contra lo que se guardó al crear la solicitud.
        aceptadas: parcial
            ? [...seleccion].sort((a, b) => a - b)
                .map(i => ({ i, cantidad: cantidades.get(i) ?? (Number(lineas[i]?.cantidad) || 0) }))
            : null,
    });

    /* En el teléfono el detalle es más alto que la pantalla, así que al entrar en
     * modo decisión —y al dejar una línea afuera— el motivo que HABILITA el botón
     * queda debajo del pliegue. Sin esto se ve un botón apagado y ninguna pista
     * de por qué: hay que adivinar que abajo hay un campo obligatorio.
     * Se trae a la vista en vez de esperar que alguien deslice a buscarlo. */
    useEffect(() => {
        if (modo === null) return;
        bloqueDecision.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [modo, parcial, nadaSeleccionado]);

    const statConf = REQUEST_STATUS[req.status] || { label: req.status };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-xl" zClass="z-toast"
            closeOnEsc={!ocupado} surface={null}
            ariaLabel={`Solicitud de ${REQUEST_TYPES[req.type]?.label ?? req.type}`}>
            <CuerpoDialogo
                titulo={REQUEST_TYPES[req.type]?.label ?? req.type}
                subtitulo={`${req.employee?.name ?? 'Sin nombre'} · ${fmtDateFull(req.created_at)} · ${esParcial(req) ? 'Aprobada parcial' : statConf.label}`}
                icono={TypeIcon}
                anchoEscritorio="max-w-xl"
                pie={<>
                    {decidible && modo === null && (
                        <>
                            <Button tone="success" icon={Check} disabled={ocupado}
                                onClick={() => { setModo('approve'); setNota(''); }}>Aprobar</Button>
                            <Button variant="destructive" icon={X} disabled={ocupado}
                                onClick={() => { setModo('reject'); setNota(''); }}>Rechazar</Button>
                        </>
                    )}
                    {decidible && modo !== null && (
                        <>
                            <Button onClick={confirmar} loading={ocupado}
                                disabled={faltaMotivo || nadaSeleccionado}
                                tone={modo === 'approve' ? 'success' : 'danger'}
                                icon={modo === 'approve' ? Check : X}>
                                {modo === 'approve'
                                    ? (parcial ? 'Aplicar lo marcado' : 'Aprobar completo')
                                    : 'Confirmar rechazo'}
                            </Button>
                            <Button variant="ghost" disabled={ocupado} onClick={() => { setModo(null); setNota(''); }}>
                                Volver
                            </Button>
                        </>
                    )}
                    {esTraslado && req.status === 'PENDING' && (
                        <Button icon={ArrowLeftRight} onClick={() => navigate('/traslados')}>
                            Resolver en Traslados
                        </Button>
                    )}
                    {/* «Cerrar» sólo cuando no se está decidiendo: al lado de
                        «Volver» son dos salidas para lo mismo, y en el teléfono
                        empujan el pie a tres botones en dos renglones. */}
                    {modo === null && (
                        <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                    )}
                </>}
            >
                <div className="space-y-3 text-left max-h-[60vh] overflow-y-auto pr-1">
                    {/* Un traslado se resuelve en su pantalla, no acá. Y no es un
                        detalle de gusto: confirmarlo relee la existencia de la
                        sala de origen justo antes de despachar y ofrece los
                        motivos de rechazo que la base valida. Aprobarlo desde
                        acá lo marcaba APROBADO **sin mover nada** y lo hacía
                        desaparecer de las tres pestañas de Traslados. */}
                    {esTraslado && req.status === 'PENDING' && (
                        <Notice variant="info" icon={ArrowLeftRight}>
                            Este traslado se confirma o se rechaza en la pantalla de Traslados,
                            donde se revisa la existencia de la sala antes de enviarlo.
                        </Notice>
                    )}

                    <DetalleSolicitud req={req} employeesById={employeesById}
                        seleccion={porLinea && modo === 'approve' ? seleccion : undefined}
                        onToggle={porLinea && modo === 'approve' ? alternar : undefined}
                        onCantidad={editable && modo === 'approve' ? fijarCantidad : undefined}
                        cantidades={editable && modo === 'approve' ? cantidades : undefined} />

                    {modo === 'approve' && editable && (
                        <div>
                            <Notice variant={nadaSeleccionado ? 'danger' : parcial ? 'warning' : 'info'} icon={Check}>
                                {nadaSeleccionado
                                    ? 'No dejaste ninguna línea marcada. Si no entra nada, rechazá la solicitud.'
                                    : parcial
                                        ? [
                                            fuera > 0 && (fuera === 1
                                                ? 'Queda 1 producto afuera'
                                                : `Quedan ${fuera} productos afuera`),
                                            recortes > 0 && (recortes === 1
                                                ? 'a 1 le bajaste la cantidad'
                                                : `a ${recortes} les bajaste la cantidad`),
                                          ].filter(Boolean).join(' y ') + '. Contá por qué abajo.'
                                        : 'Entra todo lo que se pidió, completo.'}
                            </Notice>
                        </div>
                    )}

                    {modo !== null && (
                        <div ref={bloqueDecision}>
                            <label className="text-label font-black uppercase tracking-widest text-content-2 mb-1.5 block">
                                {modo === 'reject' ? 'Motivo de rechazo'
                                    : parcial ? 'Por qué no entra todo'
                                    : 'Nota para quien la envió'}
                                {(modo === 'reject' || parcial) && <span className="text-danger ml-1">*</span>}
                            </label>
                            <PortalTextarea
                                value={nota}
                                onChange={e => setNota(e.target.value)}
                                rows={3}
                                placeholder={modo === 'approve' && !parcial ? 'Opcional...' : 'Explicá el motivo...'}
                                readOnly={ocupado}
                                textareaClassName="disabled:opacity-50"
                            />
                        </div>
                    )}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
};

// ─── Vista principal ───────────────────────────────────────────────────────────
/**
 * El centro de solicitudes, en dos ámbitos que comparten TODO el diseño y no
 * comparten NADA de permisos.
 *
 *   · `sucursal`   — lo que pasa en la sala: descartes, cargas, traslados,
 *                    Min/Max y cambios a facturación. La ve toda la sala.
 *   · `personales` — lo que pasa con una persona: vacaciones, permiso,
 *                    incapacidad, anticipo, constancia. Sólo Talento Humano.
 *
 * Un solo componente y no dos archivos: el usuario pidió «mismo estilo/diseño,
 * pero con fin distinto», y dos copias del mismo diseño se separan en cuanto
 * alguien mejora una. Lo que cambia es el MÓDULO de permisos y qué tipos
 * entran — y las dos cosas salen de este parámetro, así que no hay forma de que
 * una vista lea con el permiso de la otra.
 */
const RequestsView = ({ ambito = 'sucursal' }) => {
    const esSucursal = ambito !== 'personales';
    const MODULO     = esSucursal ? 'requests' : 'requests_personales';

    const { user, hasPermission, getScope } = useAuth();
    const canApprove = hasPermission(MODULO, 'can_approve');
    const canCreate  = hasPermission(MODULO, 'can_edit');

    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const requests       = useStaff(s => s.requests);
    const employees      = useStaff(s => s.employees);
    const holidays       = useStaff(s => s.holidays);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);
    const createRequest  = useStaff(s => s.createRequest);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const employeeOptions = useMemo(() =>
        (employees || [])
            .filter(e => e.status !== 'INACTIVO')
            .map(e => ({ value: String(e.id), label: e.name }))
    , [employees]);

    /* Min/Max vive en OTRA tabla, con otras columnas y otro ciclo — pero para
     * quien mira la sala es una solicitud más, y tenerla en otra pantalla era
     * parte de lo que había que arreglar: «que no se tenga que andar perdido
     * buscando en varios lados». Se trae y se adapta a la forma común.
     *
     * Sólo en el ámbito de sucursal: un ajuste de Min/Max no es asunto personal
     * de nadie. Y el RLS ya recorta cuáles — con `requests.can_view` se ven las
     * de la propia sala, sin que eso abra el módulo de Min/Max. */
    const [minmax, setMinmax] = useState([]);
    useEffect(() => {
        // El ámbito personal no las pide; y no hace falta vaciar el estado al
        // salir, porque `delAmbito` sólo las mezcla cuando `esSucursal`.
        if (!esSucursal) return;
        let vivo = true;
        // `fetchAllRows` devuelve **el array**, no `{ data, error }` — devolverlo
        // desestructurado daba `undefined`, la lista quedaba vacía y la pantalla
        // se veía igual que si no hubiera ni una solicitud de Min/Max. Cero
        // filas y cero datos se ven idénticos: lo delató que el grupo no
        // apareciera habiendo dos filas en la base.
        fetchAllMinMaxChangeRequests()
            .then(filas => {
                if (filas === null) { console.error('RequestsView: fetch min/max falló'); return; }
                if (vivo) setMinmax((filas ?? []).map(f => adaptarMinMax(f, id => ERP_NAMES[id])));
            })
            .catch(e => console.error('RequestsView: fetch min/max failed:', e?.message ?? e));
        return () => { vivo = false; };
    }, [esSucursal]);

    /* El corte por ámbito. Una solicitud personal NO puede aparecer en el centro
     * de la sala aunque el RLS la dejara pasar, y al revés: son dos pantallas
     * con dos permisos, y mezclarlas acá volvería decorativo el corte del
     * servidor. */
    const delAmbito = useMemo(() => {
        const propias = (requests ?? []).filter(r => esOperativa(r.type) === esSucursal);
        return esSucursal ? [...propias, ...minmax] : propias;
    }, [requests, minmax, esSucursal]);

    const [statusFilter,      setStatusFilter]      = useState('PENDING');
    const [rawSearch,         setRawSearch]         = useState('');
    const [collapsedSections, setCollapsedSections] = useState(new Set());
    // Una sola ventana: la que muestra la solicitud. La decisión se despliega
    // adentro. Antes eran dos estados (`actionModal` + `actionNote`) para una
    // ventana que se abría SIN haber mostrado nunca qué se estaba decidiendo.
    const [abierta,           setAbierta]           = useState(null); // { req, accionInicial }
    const [isActioning,       setIsActioning]       = useState(false);

    // ── Crear solicitud a nombre de un empleado (RRHH) ──────────────────────
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createEmployeeId, setCreateEmployeeId] = useState('');
    const [createType,      setCreateType]      = useState('VACATION');
    const [createPayload,   setCreatePayload]   = useState({});
    const [createNote,      setCreateNote]      = useState('');
    const [isCreatingReq,   setIsCreatingReq]   = useState(false);

    const openCreateModal = (employeeId = '') => {
        setCreateEmployeeId(employeeId ? String(employeeId) : '');
        setCreateType('VACATION');
        setCreatePayload({});
        setCreateNote('');
        setCreateModalOpen(true);
    };

    // Deep-link desde EmployeeDetailView ("+ Nueva Solicitud" de un empleado puntual)
    useEffect(() => {
        if (location.state?.prefillEmployeeId) {
            openCreateModal(location.state.prefillEmployeeId); // eslint-disable-line react-hooks/set-state-in-effect -- abre el modal por deep-link al montar
            navigate(location.pathname, { replace: true });
        }
    }, [location.state?.prefillEmployeeId, location.pathname, navigate]);

    /* Deep-link desde la notificación: `?solicitud=<id>` abre esa solicitud, y
       `&accion=aprobar|rechazar` la abre con su decisión ya desplegada.
       Es lo que convierte el aviso en «acá está» en vez de «andá a buscarla»,
       y es el camino que usa iPhone, donde iOS no dibuja los botones de acción
       de una notificación web.

       Antes `accion` abría el diálogo de decisión A SECAS: se llegaba desde la
       campana a un «¿aprobar?» sin haber visto una sola línea de lo que se
       aprobaba. Ahora abre la solicitud —con su detalle— y deja la decisión
       lista abajo, que es el mismo atajo sin el punto ciego.

       Se espera a que `requests` tenga la solicitud: la campana es global y la
       lista puede llegar después. Los parámetros se limpian recién cuando se
       encontró, para que un render temprano no los descarte. */
    useEffect(() => {
        const id = searchParams.get('solicitud');
        if (!id) return;
        const req = delAmbito.find(r => String(r.id) === String(id));
        if (!req) return;

        const accion = searchParams.get('accion');
        setAbierta({ // eslint-disable-line react-hooks/set-state-in-effect -- abre la solicitud por deep-link
            req,
            accionInicial: accion === 'aprobar' ? 'approve' : accion === 'rechazar' ? 'reject' : null,
        });
        // Sin esto la solicitud podría quedar escondida tras el filtro activo.
        if (req.status !== statusFilter) setStatusFilter(req.status);

        const limpio = new URLSearchParams(searchParams);
        limpio.delete('solicitud');
        limpio.delete('accion');
        setSearchParams(limpio, { replace: true });
    }, [searchParams, setSearchParams, delAmbito, statusFilter]);

    const handleCreateRequest = async () => {
        if (!createEmployeeId || !createNote.trim()) return;
        setIsCreatingReq(true);
        const result = await createRequest(createEmployeeId, createType, createPayload, createNote.trim());
        setIsCreatingReq(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[createType]?.label} registrada.`, 'success');
            setCreateModalOpen(false);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud.', 'error');
        }
    };

    useEffect(() => {
        const apId = canApprove ? user?.id : null;
        const brId = getScope(MODULO) === 'BRANCH' ? user?.branchId : null;
        fetchRequests(null, brId, apId);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests, MODULO]);

    useEffect(() => {
        const handler = () => {
            const apId = canApprove ? user?.id : null;
            const brId = getScope(MODULO) === 'BRANCH' ? user?.branchId : null;
            fetchRequests(null, brId, apId);
        };
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests, MODULO]);


    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    /* Quién ve qué.
     *
     * Con `can_approve` la bandeja es la de UNO: lo que le toca decidir. La
     * consulta ya recortó a `approver_id = yo` o sin asignar, y estos filtros lo
     * repiten para el estado.
     *
     * **Sin `can_approve` la bandeja es la de la SALA**: quien sólo mira no
     * tiene «asignadas a mí», así que aplicarle el mismo filtro le vaciaba la
     * pantalla entera — que es exactamente lo que le pasaba al jefe de sala. Lo
     * que puede ver ya lo decidió el RLS; acá sólo se ordena.
     *
     * El cambio de turno es la excepción y se queda como estaba: en su primer
     * nivel lo contesta el compañero, no una jefatura, y no es asunto de nadie
     * más. */
    /* Quién puede decidir ESTA solicitud. No alcanza un `canApprove` único: en
     * el centro conviven tres familias con tres dueños distintos, y confundirlos
     * sería repartir poder sin querer.
     *
     *   · Min/Max  → `minmax.can_approve` (su RPC lo cobra igual del lado del
     *                servidor; acá sólo se evita ofrecer un botón que va a
     *                rebotar).
     *   · Traslado → NADIE desde acá: se confirma en Traslados, que relee la
     *                existencia de la sala antes de despachar.
     *   · El resto → el módulo del ámbito.
     */
    const puedeDecidir = (req) => {
        if (!req) return false;
        if (req.type === 'MINMAX_CHANGE_REQUEST')      return hasPermission('minmax', 'can_approve');
        if (req.type === 'INVENTORY_TRANSFER_REQUEST') return false;
        return canApprove;
    };

    const soloMira = !canApprove;

    const visible = (r) => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        if (soloMira) return true;
        if (r.status === 'PENDING') return !r.approver || String(r.approver?.id) === myId;
        return String(r.approver?.id) === myId;
    };

    const pendingCount = delAmbito.filter(r => r.status === 'PENDING' && visible(r)).length;

    const statusFiltered = delAmbito.filter(r => {
        if (!visible(r)) return false;
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        return true;
    });

    /* La búsqueda miraba SÓLO el nombre de quien pidió. En una bandeja donde ya
     * conviven descartes, cargas y facturación, lo que uno busca es el producto
     * o el número de factura — y ninguno de los dos estaba. */
    const { results: baseFiltered, isFuzzy: isReqSearchFuzzy } = !rawSearch.trim()
        ? { results: statusFiltered, isFuzzy: false }
        : smartFilter(rawSearch, statusFiltered, r => [
            r.employee?.name,
            r.metadata?.correlativo,
            r.metadata?.branch_name,
            ...lineasDe(r.metadata).map(i => i.descripcion),
        ]);

    /* El orden de la cola.
     *
     * Lo pendiente va con **lo más viejo arriba**: es una cola que alguien vacía,
     * y con el orden que traía la consulta (lo más nuevo primero, que es el de un
     * muro de novedades) lo que más llevaba esperando se hundía justo por haber
     * esperado. Lo ya resuelto va al revés, porque ahí uno busca lo que acaba de
     * pasar. Es además el orden que ya usa Traslados en sus tres pestañas. */
    const ordenar = (lista) => [...lista].sort((a, b) =>
        a.status === 'PENDING' && b.status === 'PENDING'
            ? new Date(a.created_at) - new Date(b.created_at)
            : new Date(b.created_at) - new Date(a.created_at));

    const groupedByType = Object.entries(
        baseFiltered.reduce((acc, r) => {
            const t = r.type || 'OTHER';
            if (!acc[t]) acc[t] = [];
            acc[t].push(r);
            return acc;
        }, {})
    ).map(([tipo, cards]) => [tipo, ordenar(cards)]);

    const toggleSection = (type) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            next.has(type) ? next.delete(type) : next.add(type);
            return next;
        });
    };

    /**
     * La decisión, con o sin líneas afuera.
     *
     * `aceptadas` son los índices que SÍ entran, y sólo llega cuando se dejó
     * algo afuera. Viaja hasta la Edge Function, que es la que valida los
     * índices contra las líneas guardadas y aplica nada más esas: si el
     * navegador mandara las líneas mismas, estaría eligiendo qué se mueve.
     */
    const handleDecidir = async ({ req, modo, nota, aceptadas }) => {
        if (modo === 'reject' && !nota) return;
        setIsActioning(true);

        // Min/Max se resuelve por su propia RPC y con su propio permiso. No pasa
        // por `approveRequest` porque no vive en `approval_requests`.
        if (req.type === 'MINMAX_CHANGE_REQUEST') {
            const r = await decidirMinMax(req._minmax?.id ?? req.id, modo === 'approve', nota);
            setIsActioning(false);
            if (r.ok) {
                useToastStore.getState().showToast('Listo',
                    modo === 'approve' ? 'Ajuste de Min/Max aplicado.' : 'Ajuste de Min/Max rechazado.', 'success');
                setAbierta(null);
                setMinmax(prev => prev.map(x => x.id === req.id
                    ? { ...x, status: modo === 'approve' ? 'APPROVED' : 'REJECTED', approver_note: nota || null }
                    : x));
            } else {
                useToastStore.getState().showToast('No se pudo', r.error ?? 'Error al resolver el ajuste.', 'error');
            }
            return;
        }

        const ok = modo === 'approve'
            ? await approveRequest(req.id, user.id, nota, null, aceptadas)
            : await rejectRequest(req.id, user.id, nota);
        setIsActioning(false);
        if (ok) {
            useToastStore.getState().showToast(
                'Listo',
                modo === 'approve'
                    ? (aceptadas ? `Se aplicaron ${aceptadas.length} líneas; el resto quedó rechazado.` : 'Solicitud aprobada.')
                    : 'Solicitud rechazada.',
                'success');
            setAbierta(null);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo procesar la acción.', 'error');
        }
    };

    const STATUS_TABS = [
        { key: 'PENDING',  label: 'Pendientes' },
        { key: 'APPROVED', label: 'Aprobadas'  },
        { key: 'REJECTED', label: 'Rechazadas' },
        { key: 'ALL',      label: 'Todas'       },
    ];

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. El botón de crear
    // pasa a TabBarAction (variante primaria) y pierde el gradiente + halo que
    // tenía escritos a mano; el contador de pendientes viaja en el label del tab.
    const filtersContent = (
        <ViewTabBar
            tabs={STATUS_TABS.map(t => ({
                key: t.key,
                label: t.key === 'PENDING' && pendingCount > 0 ? `${t.label} · ${pendingCount}` : t.label,
            }))}
            activeTab={statusFilter}
            onTabChange={setStatusFilter}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar empleado..."
        />
    );

    // §17: la acción vive en la píldora del CUERPO, no en el header. Esta vista
    // no tenía `FilterBar` —sus estados son pestañas, no filtros— así que la
    // píldora existe justo para esto: es el lugar donde el usuario busca lo que
    // puede hacer, y en el teléfono es lo único que no se va con el scroll.
    const filtrosCuerpo = canCreate ? (
        <FilterBar acciones={[{
            key: 'nueva', icon: Plus, label: 'Nueva Solicitud', variant: 'primary',
            onClick: () => openCreateModal(),
        }]} />
    ) : null;

    return (
        <GlassViewLayout icon={esSucursal ? Inbox : Palmtree}
            title={esSucursal ? 'Solicitudes de Sucursal' : 'Solicitudes Personales'}
            filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 px-2 md:px-0 pb-8 space-y-6">
                {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

                {isLoadingReqs ? (
                    <div className="space-y-6">
                        {Array.from({ length: 2 }).map((_, si) => (
                            <section key={si}>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-6 h-6 skeleton rounded-lg" />
                                    <div className="h-3 w-24 skeleton rounded-full" />
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} data-surface="card" className="p-4 flex items-center gap-3">
                                            <div className="w-9 h-9 skeleton rounded-full shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-3 w-28 skeleton rounded-full" />
                                                <div className="h-2.5 w-20 skeleton rounded-full" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : baseFiltered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)]">
                        <div className="relative group flex flex-col items-center text-center">
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-brand' : statusFilter === 'APPROVED' ? 'bg-success' : statusFilter === 'REJECTED' ? 'bg-danger' : 'bg-content-3'}`} />
                            <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-lento)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${statusFilter === 'PENDING' ? 'text-brand-text' : statusFilter === 'APPROVED' ? 'text-success' : statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'}`}>
                                {statusFilter === 'PENDING' ? <CheckCircle2 size={40} strokeWidth={2} /> : <ClipboardList size={40} strokeWidth={2} />}
                            </div>
                            <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                            </h3>
                            <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                                {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Sin solicitudes en esta categoría.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                    {isReqSearchFuzzy && rawSearch.trim() && (
                        <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{rawSearch.trim()}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                    )}
                    {groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} aria-expanded={!isCollapsed}
                                    // El encabezado ES el control que pliega el
                                    // grupo y medía 24px de alto. Mismo caso —y
                                    // misma salida— que el de Laboratorios: acá
                                    // el tamaño no es el diseño, era un descuido.
                                    // `--tap-min` vale 0 en escritorio, así que
                                    // ahí no cambia nada.
                                    className="w-full flex items-center gap-2 mb-3 min-h-[var(--tap-min)] transition-transform duration-[var(--dur-fast)] active:scale-[0.99]">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-divider bg-surface-card-hover text-content-2">
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className="text-label font-black uppercase tracking-widest text-content-2">{typeConf.label}</h3>
                                    <span className="text-caption font-bold text-content-3">{cards.length}</span>
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-content-3 transition-transform duration-[var(--dur-slow)] flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                                </button>

                                <div inert={isCollapsed ? true : undefined} className={`transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[9999px] opacity-100 overflow-visible'}`}>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pb-2">
                                        {cards.map(req => (
                                            <RequestCard key={req.id} req={req}
                                                onOpen={(r) => setAbierta({ req: r, accionInicial: null })}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                    </>
                )}
            </div>

            {/* ModalShell: escrito a mano no atrapaba el foco, no cerraba con
                Escape y no se anunciaba como diálogo (auditoría 2026-07-29).

                El `abierta &&` NO es defensivo de más: sin él la vista CRASHEA.
                Los hijos de un elemento JSX se evalúan al CREARLO, no cuando el
                padre decide pintarlos, así que leer `abierta.req` corre en cada
                render — incluido el primero, cuando vale `null`. Ya pasó una vez:
                el modal a mano SÍ tenía la guarda y se perdió al pasarlo a
                `ModalShell` en v2.183.0, porque `open={!!x}` LEE como si
                condicionara los hijos y no los condiciona.

                `key` por id y la fila releída del store: al decidir, el store
                reemplaza la solicitud, y sin releerla el modal seguiría mostrando
                la foto vieja —sin su constancia de aplicado— hasta cerrarlo. */}
            {abierta && (
                <ModalSolicitud
                    key={abierta.req.id}
                    req={delAmbito.find(r => r.id === abierta.req.id) ?? abierta.req}
                    canApprove={puedeDecidir(abierta.req)}
                    employeesById={employeesById}
                    accionInicial={abierta.accionInicial}
                    ocupado={isActioning}
                    onCerrar={() => !isActioning && setAbierta(null)}
                    onDecidir={handleDecidir}
                />
            )}

            <ModalShell open={createModalOpen} onClose={() => !isCreatingReq && setCreateModalOpen(false)} maxWidthClass="max-w-lg" zClass="z-toast" closeOnEsc={!isCreatingReq} surface={null} ariaLabel="Nueva solicitud">
                    <CuerpoDialogo
                        titulo="Nueva solicitud"
                        subtitulo="A nombre de un empleado"
                        icono={ClipboardList}
                        anchoEscritorio="max-w-lg"
                        pie={<>
                            <Button disabled={!canCreate || isCreatingReq || !createEmployeeId || !createNote.trim()}
                                loading={isCreatingReq} icon={Check}
                                onClick={handleCreateRequest}>Enviar</Button>
                            <Button variant="secondary" disabled={isCreatingReq}
                                onClick={() => !isCreatingReq && setCreateModalOpen(false)}>Cancelar</Button>
                        </>}
                    >
                        <div className="space-y-4 text-left">

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Empleado <span className="text-danger">*</span></p>
                            <LiquidSelect
                                value={createEmployeeId}
                                onChange={setCreateEmployeeId}
                                options={employeeOptions}
                                placeholder="Seleccionar empleado..."
                                icon={User}
                                compact
                                clearable={false}
                            />
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Tipo</p>
                            <div className="flex flex-wrap gap-2">
                                {CREATABLE_TYPES.map(({ key, icon: Icon }) => {
                                    const conf = REQUEST_TYPES[key];
                                    return (
                                        <Button
                                            variant="secondary"
                                            icon={Icon}
                                            key={key}
                                            type="button"
                                            onClick={() => { setCreateType(key); setCreatePayload({}); }}
                                        >{conf.label}</Button>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">
                                {createType === 'VACATION' ? 'Período de Vacaciones' :
                                 createType === 'PERMIT'   ? 'Días de Permiso' :
                                 'Fecha'}
                            </p>
                            {createType === 'VACATION' ? (
                                <RangeDatePicker
                                    startDate={createPayload.startDate || ''}
                                    endDate={createPayload.endDate || ''}
                                    onRangeChange={(s, e) => setCreatePayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                    holidays={holidays}
                                    defaultDays={15}
                                    label="vacaciones"
                                />
                            ) : (
                                <LiquidDatePicker
                                    value={createPayload.date || ''}
                                    onChange={(v) => setCreatePayload(prev => ({ ...prev, date: v }))}
                                    placeholder="Seleccionar fecha"
                                    holidays={holidays}
                                />
                            )}
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo / Descripción <span className="text-danger">*</span></p>
                            <PortalTextarea
                                value={createNote}
                                onChange={e => setCreateNote(e.target.value)}
                                rows={3}
                                placeholder="Describe la solicitud..."
                                readOnly={isCreatingReq}
                                textareaClassName="disabled:opacity-50"
                            />
                        </div>

                        </div>
                    </CuerpoDialogo>
            </ModalShell>
        </GlassViewLayout>
    );
};

export default RequestsView;
