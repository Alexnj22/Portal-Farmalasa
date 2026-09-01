import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, BellRing, Check, AlertTriangle, AlertCircle, CheckCircle2,
    Megaphone, ChevronRight, ChevronDown, Trash2, X, ArrowRight, Undo2,
    ArrowLeftRight, Ban, Eye,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { iconoDeTipo } from '../../constants/tipoIconos';
import { MODULO_QUE_DECIDE } from '../../constants/solicitudModulos';
import { shortEmployeeName } from '../../utils/nameUtils';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useDecidirSolicitud } from '../../hooks/useDecidirSolicitud';
import useCortesDeAvisos, { AVISOS_DE_CORTE } from '../../hooks/useCortesDeAvisos';
import useResolverCorte from '../../hooks/useResolverCorte';
import { seConfirmaDeUnClic } from '../../utils/cortesDiagnostico';
import { esAvisoDeMinMax, cargarFilaDeAviso, paraDecidir } from '../../data/solicitudDeAviso';
import Contador from './Contador';
import AvatarConEstado from './AvatarConEstado';
import NotificacionDetalle from './NotificacionDetalle';
import { AnilloDeMeta, CuerpoDeCierreDeMeta, CuerpoDeCierreDeEmpresa } from './CierreDeMeta';
import { datosDeCierreDeMeta, datosDeCierreDeEmpresa } from '../../utils/cierreDeMeta';

/* El diálogo canónico de la solicitud, para el rechazo.
 *
 * Rechazar EXIGE motivo, y el campo con su validación —y el detalle de lo que
 * se está rechazando arriba— ya viven en `ModalSolicitud`. Escribir acá una
 * ventanita con un textarea habría sido una segunda copia de esa regla, y la
 * primera que se quedaría vieja: la de la campana, que nadie mira.
 *
 * Va por `lazy` porque la campana viaja en el chunk que se baja SIEMPRE y este
 * diálogo sólo hace falta al apretar «Rechazar». */
const ModalSolicitud = lazy(() =>
    import('../../views/solicitudes/TarjetaSolicitud').then(m => ({ default: m.ModalSolicitud })));

/* El detalle del corte, por el mismo motivo y con el mismo trato: un corte con
 * diferencia NO se confirma a ciegas, y descartar exige motivo. Las dos cosas
 * ya viven en `CorteDetalleModal`, que es el único sitio donde se firma con la
 * cifra, de dónde sale y qué revisar a la vista. */
const CorteDetalleModal = lazy(() => import('../cortes/CorteDetalleModal'));

// ── Apariencia por tipo de notificación ──────────────────────────────────────
// El ícono sale del catálogo compartido (`constants/tipoIconos`). Antes se
// resolvía acá por prefijo y seis tipos que sí se envían —anulación, cambio de
// cliente, de forma de pago, de vendedor, de turno, y los mensajes del sistema—
// caían todos al ícono genérico de campana, aunque cinco de ellos ya tenían
// ícono propio en RequestsView.
const iconForType = iconoDeTipo;

// ── La severidad la dice el ÍCONO, no un emoji dentro del título ────────────
// Los avisos que escribe la base traen su severidad como emoji al principio
// («⚠️ El barrido de Hacienda terminó con fallas»), y el panel la ignoraba: el
// ícono salía del TIPO, así que una alerta de fallas se dibujaba con la campana
// genérica y el aviso quedaba diciendo dos veces lo mismo — una en emoji y
// otra, mal, en ícono. Reportado como «mejorá cómo se ven».
//
// Se lee el emoji, se usa para elegir ícono y tono, y se quita del texto. El
// título arranca en su primera palabra y la severidad se ve donde se mira
// primero. No hace falta un mapa por tipo: quien escribe el aviso ya la declaró.
const SEVERIDAD = [
    { re: /^(🚨|❌|⛔)/u,  Icono: AlertCircle,   claro: 'bg-danger/10 text-danger border-danger/30',   oscuro: 'bg-danger/10 text-danger-text border-danger/40' },
    { re: /^(⚠️|⚠)/u,     Icono: AlertTriangle, claro: 'bg-warning/10 text-warning border-warning/30', oscuro: 'bg-warning/10 text-warning-text border-warning/40' },
    { re: /^(✅|✔️)/u,     Icono: CheckCircle2,  claro: 'bg-success/10 text-success border-success/25', oscuro: 'bg-success/10 text-success-text border-success/20' },
];
const severidadDelTitulo = (titulo = '') =>
    SEVERIDAD.find(s => s.re.test(titulo.trim())) || null;
const tituloSinEmoji = (titulo = '') =>
    titulo.replace(/^\s*(?:🚨|❌|⛔|⚠️|⚠|✅|✔️)\s*/u, '');

const tintForType = (type = '', metadata = {}, isDark = false) => {
    if (isDark) {
        if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-warning/10 text-warning-text border-warning/40';
        if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
            return metadata?.status === 'REJECTED'
                ? 'bg-danger/10 text-danger-text border-danger/40'
                : 'bg-success/10 text-success-text border-success/20';
        }
        if (type.startsWith('PEDIDO')) return 'bg-chart-1/10 text-chart-1-text border-chart-1/40';
        return 'bg-surface-card text-white/60 border-border-card';
    }
    if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-warning/10 text-warning border-warning/30';
    if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
        return metadata?.status === 'REJECTED'
            ? 'bg-danger/10 text-danger border-danger/30'
            : 'bg-success/10 text-success border-success/30';
    }
    if (type.startsWith('PEDIDO')) return 'bg-chart-1/10 text-brand-text border-chart-1/30';
    return 'bg-surface-card-hover text-content-3 border-border-card/70';
};

// Tipos que esperan una acción del usuario → chip con verbo específico;
// el resto de filas con link muestran "Ver" (indicador de que son clickeables)
const ACTION_LABEL = {
    REQUEST_PENDING: 'Revisar solicitud',
    MINMAX_PENDING:  'Revisar solicitud',
    PEDIDO_LLEGADA:  'Confirmar recepción',
    PEDIDO_REENVIO:  'Confirmar llegada',
    PEDIDO_PROBLEMA: 'Ver detalle',
    CORTE_NUEVO:     'Revisar el corte',
    DEPOSITO_BANCO:  'Ver el depósito',
};

/* El recordatorio de las 7:30 nombra UNO o VARIOS cortes según lo que haya
 * quedado colgado, así que su etiqueta no puede ser fija: es el verbo que
 * promete lo que pasa al tocar la fila, y prometer «los cortes» sobre uno solo
 * es la misma clase de mentira chica que un botón que no hace lo que dice. */
const etiquetaDeAccion = (n) =>
    n.type === 'CORTE_PENDIENTE'
        ? (n.metadata?.cuantas === 1 ? 'Resolver el corte' : 'Resolver los cortes')
        : ACTION_LABEL[n.type];

/* Los dos avisos que existen para PEDIR una decisión — y que por eso se van de
 * la campana en cuanto la decisión se toma. Son los únicos: el resto de los
 * avisos de solicitud CUENTAN lo que pasó (`REQUEST_RESOLVED`,
 * `REQUEST_DECIDED`, `MINMAX_DECIDED`) y ésos se quedan, porque son la
 * respuesta que alguien estaba esperando. */
const PIDE_DECISION = new Set(['REQUEST_PENDING', 'MINMAX_PENDING']);

const UNDO_MS = 3000;

const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)  return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `Hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`;
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

// Barra de cuenta regresiva de la ventana Deshacer (3s, lineal)
const UndoProgress = ({ isDark }) => (
    <div className={`absolute bottom-0 inset-x-0 h-[2px] ${isDark ? 'bg-surface-card' : 'bg-surface-card-hover/70'}`}>
        <motion.div
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: UNDO_MS / 1000, ease: 'linear' }}
            style={{ transformOrigin: 'left' }}
            className="h-full bg-brand"
        />
    </div>
);

/* ── El cuerpo del aviso, y saber si se está cortando ──────────────────────
 *
 * La tarjeta muestra tres renglones. Un aviso del sistema puede tener seis
 * —«El barrido de Hacienda no corrió anoche» tiene 200 caracteres— y hasta hoy
 * no había forma de leer el resto: el control para desplegar existía sólo para
 * las solicitudes, o sea que el aviso más largo del portal era el único que no
 * se podía abrir.
 *
 * Se MIDE el párrafo en vez de contar caracteres: que un texto entre en tres
 * renglones depende del ANCHO —el mismo aviso entra en el panel de escritorio y
 * se corta en el teléfono—, así que un umbral por largo pondría el control
 * donde no hace falta, y un control que al tocarlo no despliega nada se lee
 * como que la tarjeta está rota.
 *
 * Avisa hacia arriba en vez de resolverlo acá porque el control no puede vivir
 * dentro de la tarjeta: su cara ya es un <button> y un botón adentro de otro no
 * es HTML válido. Va abajo, junto a «Ver detalle» — la misma lección que ese
 * control ya había dejado. */
const CuerpoDeNotificacion = ({ id, texto, recortar, clase, onRecorte }) => {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        // Desplegado no se puede medir: sin el recorte, el alto del contenido y
        // el de la caja coinciden y la medición diría «entra». Se conserva la
        // última medición, que es la que decidió mostrar el control.
        if (!el || !recortar) return undefined;
        const medir = () => onRecorte(id, el.scrollHeight - el.clientHeight > 1);
        medir();
        if (typeof ResizeObserver === 'undefined') return undefined;
        // Girar el teléfono cambia el ancho y con él la respuesta.
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [id, texto, recortar, onRecorte]);

    return (
        <p ref={ref} className={`text-body-sm font-medium leading-snug mt-0.5 ${recortar ? 'line-clamp-3' : ''} ${clase}`}>
            {texto}
        </p>
    );
};

// ============================================================================
// 🔔 Campana de notificaciones — canal personal (sistema → ti).
// Los AVISOS siguen en /my-announcements; aquí solo una fila fijada si hay
// sin leer. El feed lo monta useNotificationsChannel() UNA vez en AppLayout.
// Borrar = DELETE real en BD, pero con ventana de 3s para deshacer: el commit
// se agenda con los IDs capturados y "Deshacer" cancela el timer.
// ============================================================================
const NotificationBell = ({ variant = 'desktop' }) => {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { isDark } = useTheme();

    const todasLasNotifs = useStaff(s => s.notifications || []);
    const announcements = useStaff(s => s.announcements || []);
    const roles = useStaff(s => s.roles || []);
    const employees = useStaff(s => s.employees || []);
    const branches = useStaff(s => s.branches || []);
    const markNotificationRead = useStaff(s => s.markNotificationRead);
    const marcarAvisoResuelto = useStaff(s => s.marcarAvisoDeSolicitudResuelto);
    const markAllNotificationsRead = useStaff(s => s.markAllNotificationsRead);
    const deleteNotificationsByIds = useStaff(s => s.deleteNotificationsByIds);
    const deleteAllNotifications = useStaff(s => s.deleteAllNotifications);

    const [isOpen, setIsOpen] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [justRang, setJustRang] = useState(false);
    const [flashIds, setFlashIds] = useState(() => new Set());
    // Qué filas están desplegadas. Un `Set` y no un solo id: cerrar una para
    // abrir otra obliga a re-leer el aviso anterior para comparar dos
    // solicitudes, que es justo lo que se hace cuando llegan tres seguidas.
    const [expandidas, setExpandidas] = useState(() => new Set());
    // Qué cuerpos NO entran en los tres renglones de la tarjeta. Lo reporta
    // cada párrafo al medirse; acá sólo decide si la fila lleva control para
    // desplegarse. Ver `CuerpoDeNotificacion`.
    const [cuerposCortados, setCuerposCortados] = useState(() => new Set());
    // Borrados en ventana de deshacer: [{ key, ids: string[], isAll }]
    const [pendingDeletes, setPendingDeletes] = useState([]);
    const rootRef = useRef(null);
    const seenIdsRef = useRef(null);
    const prevUnreadRef = useRef(0);
    const confirmTimerRef = useRef(null);
    const deleteTimersRef = useRef(new Map());

    const canSeeAnnouncements = hasPermission('emp_announcements', 'can_view');

    /* Lo ya decidido se va de la campana.
     *
     * Un `REQUEST_PENDING` / `MINMAX_PENDING` existe para PEDIR una decisión.
     * Tomada la decisión, el aviso no tiene nada que pedir: quedarse en la lista
     * lo único que hace es competir por atención con lo que sí falta atender.
     * Decisión del usuario, 2026-08-11: «si una solicitud ya se confirmó o
     * rechazó, en notificaciones ya no debe de salir».
     *
     * Se filtra por `metadata.resuelta`, que escribe el trigger
     * `marcar_notificacion_solicitud_resuelta` en el instante de la decisión —y
     * que desde hoy llega en vivo, porque el canal también escucha UPDATE.
     *
     * NO alcanza con mirar `type`: los avisos que CUENTAN el desenlace
     * (`REQUEST_RESOLVED`, `REQUEST_DECIDED`) también llevan `resuelta` en su
     * metadata, y ésos son justamente los que hay que conservar — son la
     * respuesta que esperaba quien pidió.
     *
     * La fila queda en la base y se la lleva «Borrar todas», que borra por
     * fecha del lado del servidor. */
    const notifications = useMemo(
        () => todasLasNotifs.filter(n =>
            !(PIDE_DECISION.has(n.type) && n.metadata?.resuelta)),
        [todasLasNotifs]
    );

    const pendingIds = useMemo(() => {
        const s = new Set();
        pendingDeletes.forEach(e => e.ids.forEach(id => s.add(id)));
        return s;
    }, [pendingDeletes]);
    const pendingAll = pendingDeletes.find(e => e.isAll) || null;
    const pendingEntryByNotifId = useMemo(() => {
        const m = new Map();
        pendingDeletes.forEach(e => { if (!e.isAll) e.ids.forEach(id => m.set(id, e)); });
        return m;
    }, [pendingDeletes]);

    const unreadNotifs = useMemo(
        () => notifications.filter(n => !n.read_at && !pendingIds.has(n.id)),
        [notifications, pendingIds]
    );

    // ── Quién y dónde, sin abrir nada ────────────────────────────────────────
    // Las dos salen de la fila de la notificación: `created_by` es quien la
    // originó y `branch_id` la sala de la que habla. Ya estaban en la tabla —lo
    // que faltaba era leerlas (ver `fetchNotifications`)— así que la cara y la
    // sucursal no cuestan ni una consulta más.
    const empleadosPorId = useMemo(() => {
        const m = new Map();
        employees.forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);
    // El podio de la empresa necesita la ficha para pintar la cara. Va como
    // función y no como Map para no obligar al componente de la tarjeta a
    // conocer la forma del store.
    const buscarEmpleadoPorId = useCallback(
        (id) => empleadosPorId.get(String(id)) || null, [empleadosPorId]);
    const sucursalesPorId = useMemo(() => {
        const m = new Map();
        branches.forEach(b => m.set(String(b.id), b.name));
        return m;
    }, [branches]);

    const unreadAnnouncements = useMemo(() => {
        if (!user || !canSeeAnnouncements) return [];
        return announcements.filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            if (!announcementAppliesToUser(a, user, roles)) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        });
    }, [announcements, user, roles, canSeeAnnouncements]);

    const annUnread = unreadAnnouncements.length;
    const hasUrgentAnn = unreadAnnouncements.some(a => a.priority === 'URGENT');
    const totalBadge = unreadNotifs.length + annUnread;

    // ── Borrar con ventana de deshacer ──────────────────────────────────────
    // Los IDs viven junto al timer en el ref: el commit es un side-effect
    // puro del timeout, nunca dentro de un updater de estado (StrictMode-safe).
    const commitDelete = (key) => {
        const rec = deleteTimersRef.current.get(key);
        if (rec) {
            deleteTimersRef.current.delete(key);
            if (rec.isAll) deleteAllNotifications(rec.cutoff);
            else deleteNotificationsByIds(rec.ids);
        }
        setPendingDeletes(prev => prev.filter(e => e.key !== key));
    };

    // Solo se invoca desde handlers de click (nunca durante el render) — el
    // compiler no puede verificarlo estáticamente y lo marca igual.
    const scheduleDelete = (ids, isAll = false) => {
        if (!ids.length) return;
        const key = `${isAll ? 'all' : 'one'}-${Date.now()}`; // eslint-disable-line react-hooks/purity
        // Corte de tiempo capturado AHORA (antes de la ventana de deshacer) para
        // que "borrar todas" no arrastre algo que llegue por realtime durante
        // los 3s — mismo contrato que el borrado individual por IDs.
        const cutoff = new Date().toISOString();
        setPendingDeletes(prev => [...prev, { key, ids, isAll }]);
        deleteTimersRef.current.set(key, { ids, isAll, cutoff, timer: setTimeout(() => commitDelete(key), UNDO_MS) });
    };

    const undoDelete = (key) => {
        const rec = deleteTimersRef.current.get(key);
        if (rec) clearTimeout(rec.timer);
        deleteTimersRef.current.delete(key);
        setPendingDeletes(prev => prev.filter(e => e.key !== key));
    };

    useEffect(() => () => {
        // Al desmontar (logout) se cancelan las ventanas abiertas: no se borra
        deleteTimersRef.current.forEach(rec => clearTimeout(rec.timer));
        deleteTimersRef.current.clear();
    }, []);

    // ── Realtime: campanazo + flash en filas recién llegadas ────────────────
    useEffect(() => {
        if (seenIdsRef.current === null) {
            if (notifications.length > 0 || !user) {
                seenIdsRef.current = new Set(notifications.map(n => n.id));
            }
            return;
        }
        const fresh = notifications.filter(n => !seenIdsRef.current.has(n.id));
        if (!fresh.length) return;
        fresh.forEach(n => seenIdsRef.current.add(n.id));
        setFlashIds(prev => {
            const next = new Set(prev);
            fresh.forEach(n => next.add(n.id));
            return next;
        });
        const t = setTimeout(() => {
            setFlashIds(prev => {
                const next = new Set(prev);
                fresh.forEach(n => next.delete(n.id));
                return next;
            });
        }, 4000);
        return () => clearTimeout(t);
    }, [notifications, user]);

    useEffect(() => {
        if (unreadNotifs.length > prevUnreadRef.current) {
            setJustRang(true);
            const t = setTimeout(() => setJustRang(false), 1600);
            prevUnreadRef.current = unreadNotifs.length;
            return () => clearTimeout(t);
        }
        prevUnreadRef.current = unreadNotifs.length;
    }, [unreadNotifs.length]);

    // ── Cerrar con clic fuera / Escape ───────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setIsOpen(false); };
        const onKey  = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [isOpen]);

    useEffect(() => { if (!isOpen) setConfirmClear(false); }, [isOpen]);

    /* Tocar la tarjeta LLEVA a Solicitudes; el detalle se abre con su propio
       botón.

       Antes el toque hacía las dos cosas según el aviso: los que tenían una
       solicitud detrás se desplegaban y el resto navegaba. O sea que el gesto
       más obvio de la pantalla significaba dos cosas distintas y ninguna se
       podía predecir desde afuera — y la que más se quería, salir a la bandeja,
       era la que NO pasaba justamente en los avisos que importan.

       Pedido del usuario (2026-08-14): «al clickear me debe llevar a
       solicitudes; para ver el detalle sólo al clickear en ver detalle». */
    const puedeExpandir = (n) => Boolean(n.metadata?.request_id);

    const alternarExpansion = (id) => setExpandidas(prev => {
        const s = new Set(prev);
        s.has(id) ? s.delete(id) : s.add(id);
        return s;
    });

    // Estable a propósito: viaja como prop a cada párrafo y ahí vive dentro de
    // un efecto. Si cambiara en cada pintada, el efecto se volvería a montar
    // solo. Y devuelve el MISMO Set cuando la respuesta no cambió —que es
    // siempre, después de la primera medición— para no repintar la lista.
    const marcarCuerpoCortado = useCallback((id, cortado) => {
        setCuerposCortados(prev => {
            if (prev.has(id) === cortado) return prev;
            const s = new Set(prev);
            cortado ? s.add(id) : s.delete(id);
            return s;
        });
    }, []);

    const handleNotifClick = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        if (n.link || n.metadata?.request_id) irASolicitudes(n);
    };

    // El enlace de salida del detalle. `n.link` ya trae la forma correcta para
    // cada familia —incluida `minmax:<id>`, que es otra tabla—; el respaldo sólo
    // cubre avisos viejos, escritos antes de que el enlace se guardara.
    const irASolicitudes = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        setIsOpen(false);
        navigate(n.link || `/requests?solicitud=${n.metadata?.request_id ?? ''}`);
    };

    /* Una notificación de solicitud pendiente puede decidirse desde acá, pero
       solo si quien mira puede aprobar: sin el permiso, los botones llevarían a
       un diálogo que el servidor va a rechazar. `request_id` lo escribe el
       trigger `notificar_solicitud_creada`; las notificaciones viejas no lo
       tienen y siguen comportándose como antes. */
    // `resuelta` la escribe el trigger `marcar_notificacion_solicitud_resuelta`
    // en el momento en que la solicitud deja de estar PENDING. Sin eso, el aviso
    // seguía ofreciendo Aprobar/Rechazar sobre algo ya decidido —la notificación
    // es una fila aparte de la solicitud y aprobar no la tocaba—, y el botón
    // llevaba a un diálogo que el servidor rechaza con 409.
    /* Cada solicitud con SU permiso, y desde v2.576.0 eso ya no es «uno por
     * pantalla» sino uno por FAMILIA: quien puede anular una factura no
     * necesariamente puede aprobar un descarte de inventario. El aviso trae el
     * tipo en `metadata.request_type`, así que se resuelve por solicitud y no
     * por una bandera calculada una vez para todas.
     *
     * `MODULO_QUE_DECIDE` es el mismo mapa que usa la bandeja y el espejo de
     * `modulo_de_aprobacion()` en Postgres. Lo que no figura ahí cae en el
     * módulo del ámbito, igual que en la policy: `MINMAX_PENDING` siempre es de
     * Min/Max, y un `REQUEST_PENDING` sin tipo reconocido es de la sala. */
    const moduloDelAviso = (n) => {
        if (n.type === 'MINMAX_PENDING') return 'requests_minmax';
        if (n.type !== 'REQUEST_PENDING') return null;
        return MODULO_QUE_DECIDE[n.metadata?.request_type] ?? 'requests';
    };

    /* Un traslado NO se decide desde acá, y desde que la campana aplica de
       verdad eso dejó de ser un detalle de gusto: confirmarlo relee la
       existencia de la sala de origen justo antes de despachar. Aprobarlo por
       fuera lo marcaría APROBADO **sin mover nada** y lo haría desaparecer de
       las tres pestañas de Traslados. Es la misma exclusión que ya hacía
       `ModalSolicitud` (`decidible = … && !esTraslado`); acá faltaba, y no daba
       daño sólo porque el botón llevaba a ese diálogo, que se negaba. */
    const esTraslado = (n) => n.metadata?.request_type === 'INVENTORY_TRANSFER_REQUEST';

    const puedeDecidir = (n) => {
        if (esTraslado(n)) return false;
        const modulo = moduloDelAviso(n);
        return !!modulo && hasPermission(modulo, 'can_approve')
            && !!n.metadata?.request_id && !n.metadata?.resuelta;
    };

    const trasladoPorResolver = (n) =>
        n.type === 'REQUEST_PENDING' && esTraslado(n) && !n.metadata?.resuelta
        && hasPermission('traslados', 'can_approve');

    /* `ADVANCED` es la solicitud que uno aprobó y pasó al siguiente nivel: sigue
     * pendiente para otra persona, pero para quien mira este aviso ya está
     * hecha. Dice «Aprobada» porque describe SU decisión, y es transitorio — al
     * cerrarse la solicitud el trigger lo pisa con el estado final, así que este
     * mismo aviso termina diciendo en qué terminó todo. */
    const RESUELTA_LABEL = {
        APPROVED: 'Aprobada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada',
        ADVANCED: 'Aprobada',
    };

    /* ── Decidir DESDE la campana, no en otra pantalla ──────────────────────
     *
     * Hasta v2.601.x estos dos botones no decidían: navegaban a
     * `/requests?solicitud=…&accion=aprobar`, que abría el diálogo con la
     * decisión desplegada y ahí había que apretar otra vez. Tres toques y un
     * cambio de pantalla para decir que sí. Pedido del usuario (2026-08-14):
     * «al dar aprobar o rechazar debe aplicarse» y «si confirmo la solicitud
     * debe confirmarse de un solo».
     *
     * La REGLA no se copia: `useDecidirSolicitud` es la misma que usa la
     * bandeja —con la RPC propia de Min/Max, la bitácora, el aviso a quien
     * pidió y el apagado del propio aviso—. Acá sólo se resuelve qué se decide
     * y con qué gesto.
     *
     * Rechazar SÍ abre ventana: exige motivo, y el campo con su validación —y
     * el detalle de lo que se rechaza arriba— ya existen en `ModalSolicitud`.
     */
    const [decidiendoId, setDecidiendoId] = useState(null);
    const [rechazo, setRechazo] = useState(null);   // { req } — el diálogo de motivo

    const cerrarRechazo = useCallback(() => setRechazo(null), []);
    const { decidir, ocupado: decidiendo } = useDecidirSolicitud({ onAplicado: cerrarRechazo });

    /* ── El corte de caja, resuelto desde el aviso ──────────────────────────
     *
     * Mismo trato que una solicitud, con una diferencia que NO se puede perder:
     * un corte que cuadra al centavo se confirma de un clic, pero uno CON
     * diferencia abre el detalle —hay que ver cuánto es, de dónde sale la cifra
     * y qué revisar antes de firmar—. Esa regla no se reescribe acá: es
     * `seConfirmaDeUnClic`, la misma que aplica la tarjeta.
     *
     * Y el corte NO sale del aviso: el aviso trae su id y el corte se relee.
     * Una fila de `notifications` es la foto del momento en que se capturó, así
     * que ofrecer «Confirmar» sobre ella dejaría el botón vivo después de que
     * otra persona lo resolvió. */
    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches || []) m[b.id] = b.name;
        return m;
    }, [branches]);
    const { porId: cortesPorId, recargar: recargarCortes } = useCortesDeAvisos(notifications, isOpen);
    const { resolver: resolverElCorte, ocupadoId: corteOcupado } =
        useResolverCorte({ nombreSala, origen: 'campana' });
    const puedeResolverCortes = hasPermission('cortes_caja', 'can_edit');
    const [corteAbierto, setCorteAbierto] = useState(null);   // { corte, modo }
    const [montarDetalleCorte, setMontarDetalleCorte] = useState(false);

    /* El corte del aviso, sólo si de verdad hay algo que resolver: el cierre
     * del día (Z) no se confirma, y uno ya resuelto tampoco.
     *
     * Sirve para los dos avisos que nombran un corte. El recordatorio de las
     * 7:30 trae `corte_id` únicamente cuando quedó uno solo, así que con varios
     * esto devuelve nulo solo —sin condición aparte— y la fila queda con su
     * link a la pantalla. */
    const corteResoluble = (n) => {
        if (!AVISOS_DE_CORTE.has(n.type) || !puedeResolverCortes) return null;
        const c = cortesPorId.get(String(n.metadata?.corte_id));
        return c && c.tipo === 'C' && c.estado === 'PENDIENTE' ? c : null;
    };

    const abrirCorte = (n, corte, modo) => {
        if (!n.read_at) markNotificationRead(n.id);
        // El panel se cierra por lo mismo que con el rechazo: el detalle se
        // dibuja por fuera de la campana y encimados quedan dos superficies
        // peleando por el mismo toque.
        setIsOpen(false);
        setMontarDetalleCorte(true);
        setCorteAbierto({ corte, modo });
    };

    const confirmarCorteDesdeElAviso = async (n, corte) => {
        if (corteOcupado) return;
        if (!seConfirmaDeUnClic(corte)) { abrirCorte(n, corte, 'confirmar'); return; }
        if (!n.read_at) markNotificationRead(n.id);
        if (await resolverElCorte(corte, 'CONFIRMADO')) recargarCortes();
    };

    /* La solicitud no viaja en el aviso: el aviso trae su id. Se pide al
     * apretar y no al pintar la lista — prefetchear doce solicitudes para que
     * quizá se decida una es pagar doce viajes por adelantado. */
    const traerSolicitud = async (n) => {
        try {
            const fila = await cargarFilaDeAviso(n);
            if (!fila) {
                useToastStore.getState().showToast('Ya no está',
                    'Esta solicitud ya no está disponible.', 'error');
                return null;
            }
            return paraDecidir(fila, esAvisoDeMinMax(n));
        } catch (err) {
            useToastStore.getState().showToast('No se pudo',
                mensajeAmigable(err, 'No se pudo abrir la solicitud.'), 'error');
            return null;
        }
    };

    /* Y antes de aplicar, se mira el estado REAL.
     *
     * El aviso es una fila aparte de la solicitud: otra pestaña —u otra
     * persona— pudo resolverla y esta campana seguiría ofreciendo los dos
     * botones. La base lo frena igual (el UPDATE va condicionado a PENDING),
     * pero rebotar sin decir por qué se lee como que el botón no hace nada. */
    const yaResuelta = (n, req) => {
        if (req.status === 'PENDING') return false;
        useToastStore.getState().showToast('Ya estaba resuelta',
            'Alguien más la decidió mientras tanto.', 'info');
        marcarAvisoResuelto(n.metadata.request_id, req.status);
        return true;
    };

    /* Sin `try { … } finally { setDecidiendoId(null) }`, y no es cuestión de
     * gusto: medido con eslint el 2026-08-14, un `try/finally` acá hacía que el
     * compilador de React ABANDONARA el componente entero —`react-hooks/purity`
     * dejaba de reportar en todo el archivo, que es cómo se nota—. La campana
     * vive en `AppLayout` y se redibuja con cada notificación de cada pantalla:
     * no es el lugar donde regalar la memoización.
     *
     * Y tampoco hace falta: ni `traerSolicitud` ni `decidir` lanzan —la primera
     * atrapa lo suyo, la segunda devuelve `false`—, que es el mismo contrato del
     * que depende la bandeja desde hace meses. Un `finally` acá sería una red
     * para una caída que no existe, a cambio de apagar la optimización. */
    const aprobarDesdeElAviso = async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        // Sin `aceptadas`: desde la campana se aprueba COMPLETO. Dejar líneas
        // afuera es una edición y vive en el diálogo, que es donde se ven los
        // renglones y se puede recortar la cantidad.
        if (req && !yaResuelta(n, req)) {
            await decidir({ req, modo: 'approve', nota: '', aceptadas: null });
        }
        setDecidiendoId(null);
    };

    const rechazarDesdeElAviso = async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        if (req && !yaResuelta(n, req)) {
            // El panel se cierra: el diálogo se dibuja por fuera de la campana
            // —tiene que sobrevivir a que ésta se cierre— y dejarlos encimados
            // deja dos superficies compitiendo por el mismo toque.
            setIsOpen(false);
            setRechazo({ req, accion: 'reject' });
        }
        setDecidiendoId(null);
    };

    /* El traslado abre el MISMO diálogo, sin decisión desplegada.
     *
     * Hasta el 2026-08-15 este botón decía «Resolver en Traslados» y navegaba a
     * esa pantalla: la campana avisaba de algo que después había que ir a
     * buscar. Ahora el diálogo canónico trae adentro el bloque que confirma o
     * rechaza —el mismo de la tarjeta del tablero, que relee la existencia de la
     * sala de origen—, así que no hay a dónde ir.
     *
     * Sigue sin pasar por `decidir`, y ésa es la parte que no cambió: aprobarlo
     * con `approveRequest` lo marcaría APROBADO sin mover un solo producto. */
    const resolverTrasladoDesdeElAviso = async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        if (req && !yaResuelta(n, req)) {
            setIsOpen(false);
            setRechazo({ req, accion: null });
        }
        setDecidiendoId(null);
    };

    const handleClearAll = () => {
        clearTimeout(confirmTimerRef.current);
        if (!confirmClear) {
            setConfirmClear(true);
            confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3500);
            return;
        }
        setConfirmClear(false);
        // Captura los visibles AHORA; lo que llegue durante la ventana no se toca
        scheduleDelete(notifications.filter(n => !pendingIds.has(n.id)).map(n => n.id), true);
    };

    if (!user) return null;

    const isDesktop = variant === 'desktop';

    // ── Paleta según tema ────────────────────────────────────────────────────
    // `panel` ya no fija bg/blur/border/shadow a mano (violaba "cero
    // backdrop-filter" de Solid Modern en solid/solid-dark) — se resuelve con
    // data-surface="dropdown" en el contenedor real (gana por cascade layers).
    // El resto de `cx` sigue binario por isDark: cubre correctamente los 4
    // temas porque isDark ya es true en dark Y solid-dark (ThemeContext).
    const cx = isDark ? {
        headerBorder: 'border-white/[0.07]',
        title: 'text-white/90',
        // El realce va en un VELO absoluto sobre la tarjeta, no en la tarjeta:
        // `[data-surface="card"]` fija su fondo desde `index.css`, que va sin
        // `@layer` y le gana a cualquier utilidad de Tailwind — un
        // `hover:bg-*` ahí no pinta nada (mismo motivo por el que existe
        // `data-tono`). Y por eso es `group-hover`: el velo no recibe el
        // puntero, lo recibe la tarjeta.
        rowHover: 'group-hover:opacity-100',
        veloHover: 'bg-white/[0.06]',
        rowUnread: 'bg-chart-1/[0.07]',
        rowTitle: 'text-white/90', rowTitleRead: 'text-white/60',
        rowBody: 'text-white/50',
        rowTime: 'text-white/40',
        iconBtn: 'text-white/45 hover:text-white/90 hover:bg-surface-card',
        emptyIconBox: 'bg-white/[0.06] border-border-card text-white/40',
        emptyTitle: 'text-white/80', emptySub: 'text-white/45',
        chipMuted: 'text-white/40',
        undoStrip: 'bg-white/[0.05]',
        undoText: 'text-white/60',
        undoBtn: 'text-chart-1-text hover:bg-chart-1/10 border-chart-1/40',
    } : {
        headerBorder: 'border-border-card/60',
        title: 'text-content',
        rowHover: 'group-hover:opacity-100',
        veloHover: 'bg-brand/[0.06]',
        rowUnread: 'bg-chart-1/10',
        rowTitle: 'text-content', rowTitleRead: 'text-content-2',
        rowBody: 'text-content-3',
        rowTime: 'text-content-3',
        iconBtn: 'text-content-3 hover:text-content-2 hover:bg-surface-card',
        emptyIconBox: 'bg-surface-card border-border-card text-brand-text/50',
        emptyTitle: 'text-content-2', emptySub: 'text-content-3',
        chipMuted: 'text-content-3',
        undoStrip: 'bg-surface-card-hover/80',
        undoText: 'text-content-2',
        undoBtn: 'text-brand-text hover:bg-chart-1/10 border-chart-1/30',
    };

    const undoButton = (key, label = 'Deshacer') => (
        <Button variant="ghost" icon={Undo2} className={cx.undoBtn} onClick={() => undoDelete(key)}>{label}</Button>
    );

    return (
        <div ref={rootRef} className="relative">
            {isDesktop && totalBadge > 0 && (
                <div className={`absolute -inset-3 rounded-modal blur-xl pointer-events-none ${hasUrgentAnn ? 'bg-danger/30' : 'bg-brand/20'}`} />
            )}

            {/* ── Botón campana ── */}
            <button
                onClick={() => setIsOpen(o => !o)}
                aria-label="Notificaciones"
                // §1.5 · sin vidrio propio: la campana vive dentro del encabezado,
                // que ya es una superficie de vidrio, y una anidada queda a 1.02:1
                // de su contenedor. El material lo pone el borde y el relleno.
                className={`relative flex items-center justify-center w-11 h-11 rounded-2xl border
                    hover:translate-y-[var(--lift-hover)] hover:scale-105 active:scale-[0.97] active:translate-y-0 transition-all duration-[var(--dur-base)]
                    ${isDark
                        ? `shadow-[var(--shadow-glass-3)]
                           ${hasUrgentAnn ? 'bg-danger/15 border-danger/40' : 'bg-white/[0.08] border-white/[0.14] hover:bg-white/[0.14]'}`
                        : `shadow-[var(--shadow-glass-3)]
                           ${hasUrgentAnn
                               ? 'bg-danger/10 border-danger/40 hover:shadow-[var(--shadow-glass-4)]'
                               : 'bg-surface-card border-chart-1/30 hover:shadow-[var(--shadow-glass-4)]'}`}`}
            >
                {/* Sheen del botón: ya no va detrás de `!isDark` (eso cubría dark y
                    solid-dark, pero dejaba el reflejo puesto en `solid`, que es claro
                    pero tampoco tiene glass). El token lo decide por tema. */}
                <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-[1.25rem] pointer-events-none" style={{ background: 'linear-gradient(to bottom, var(--btn-sheen), transparent)' }} />
                {totalBadge > 0 ? (
                    <BellRing size={18} strokeWidth={2}
                        className={`relative z-base transition-colors
                            ${hasUrgentAnn ? (isDark ? 'text-danger-text animate-wiggle' : 'text-danger animate-wiggle') : (isDark ? 'text-chart-1-text' : 'text-brand-text')}
                            ${justRang && !hasUrgentAnn ? 'animate-wiggle' : ''}`} />
                ) : (
                    <Bell size={18} strokeWidth={2} className={`relative z-base ${isDark ? 'text-white/45' : 'text-content-3'}`} />
                )}
                {totalBadge > 0 && (
                    <>
                        <Contador valor={totalBadge}
                            className="absolute -top-1.5 -right-1.5 z-content shadow-[var(--shadow-glow-danger)]"
                            aria-label={`${totalBadge} sin leer`} />
                        <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full animate-ping opacity-60 z-base bg-danger" />
                    </>
                )}
            </button>

            {/* ── Panel ── */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="notif-panel"
                        initial={{ opacity: 0, scale: 0.97, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: -6 }}
                        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                        /* Móvil: `fixed` anclado a los bordes de la PANTALLA, no
                           al botón. Estaba `absolute right-0` con un ancho de
                           `100vw - 2rem`: como la campana no está pegada al borde
                           derecho, el panel se extendía hacia la izquierda y salía
                           de la pantalla. Medido en iPhone 13: x = -36px, o sea
                           que el título se leía "otificaciones".

                           ── UN solo recorrido vertical (2026-08-14) ───────────
                           Acá había un `overflow-y-auto overscroll-contain`, y la
                           lista de adentro tenía otro, y el detalle desplegado un
                           tercero. Medido en WebKit iPhone 13 con doce avisos y
                           uno abierto: DOS contenedores anidados desbordando a la
                           vez (la lista 1,617px, el detalle 199px), los dos con el
                           encadenamiento cortado. El dedo caía sobre el detalle,
                           lo llevaba hasta su fondo y ahí se quedaba: `contain`
                           impide que el gesto siga en el padre, así que no había
                           forma de pasar de largo el aviso abierto. Es lo que el
                           usuario reportó como «me falla el scroll en móvil».

                           Ahora el panel es una columna que NO hace scroll y la
                           lista es el único que lo hace. `100dvh` y no `100vh`:
                           en iOS Safari `vh` es el viewport GRANDE —con las
                           barras retraídas—, así que un techo en `vh` deja el pie
                           del panel debajo de la barra inferior. */
                        className={`z-bell-dropdown origin-top-right flex
                            ${isDesktop
                                ? 'absolute right-0 top-[3.25rem] w-[380px] max-h-[min(72vh,560px)]'
                                : `fixed left-2 right-2 top-[calc(3.5rem+var(--sa-top))] w-auto
                                   max-h-[calc(100dvh-4.5rem-var(--sa-top)-var(--sa-bottom))]`}`}
                    >
                        <div data-surface="dropdown" className="overflow-hidden transform-gpu flex flex-col min-h-0 w-full">
                            {/* Shimmer superior */}
                            <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-brand/40 to-transparent animate-shimmer" style={{ animationDuration: '4s' }} />
                            </div>

                            {/* ── Header ── */}
                            <div className={`shrink-0 flex items-center justify-between pl-5 pr-3 pt-4 pb-3 border-b ${cx.headerBorder}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`text-body-lg font-black tracking-tight ${cx.title}`}>Notificaciones</span>
                                    {unreadNotifs.length > 0 && (
                                        <Contador valor={unreadNotifs.length} max={99} size="md"
                                            aria-label={`${unreadNotifs.length} notificación${unreadNotifs.length === 1 ? '' : 'es'} sin leer`} />
                                    )}
                                </div>
                                <div className="flex items-center gap-0.5">
                                    {unreadNotifs.length > 0 && !confirmClear && !pendingAll && (
                                        <button
                                            onClick={() => markAllNotificationsRead()}
                                            title="Marcar todas como leídas"
                                            className={`flex items-center gap-1 text-caption font-black uppercase tracking-widest px-2 py-1.5 rounded-xl transition-colors ${isDark ? 'text-chart-1-text hover:bg-chart-1/10' : 'text-brand-text hover:bg-chart-1/10'}`}
                                        >
                                            <Check size={13} strokeWidth={2.5} />
                                            Leídas
                                        </button>
                                    )}
                                    {notifications.length > 0 && !pendingAll && (
                                        confirmClear ? (
                                            <Button variant="destructive" icon={Trash2} onClick={handleClearAll}>¿Borrar todo?</Button>
                                        ) : (
                                            <button
                                                onClick={handleClearAll}
                                                title="Borrar todas"
                                                className={`p-1.5 rounded-xl transition-colors ${isDark ? 'text-white/40 hover:text-danger-text hover:bg-danger/10' : 'text-content-3 hover:text-danger hover:bg-danger/10'}`}
                                            >
                                                <Trash2 size={14} strokeWidth={2} />
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            {/* ── Franja Deshacer (borrado masivo) ── */}
                            {pendingAll && (
                                <div className={`shrink-0 relative flex items-center justify-between pl-5 pr-3 py-2.5 border-b ${cx.headerBorder} ${cx.undoStrip}`}>
                                    <span className={`text-body-sm font-semibold ${cx.undoText}`}>
                                        Borrando {pendingAll.ids.length} notificación{pendingAll.ids.length > 1 ? 'es' : ''}…
                                    </span>
                                    {undoButton(pendingAll.key)}
                                    <UndoProgress isDark={isDark} />
                                </div>
                            )}

                            {/* ── Fila fijada: avisos sin leer ── */}
                            {annUnread > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); navigate('/mis-avisos'); }}
                                    className={`shrink-0 w-full flex items-center gap-3 px-5 py-3 text-left border-b transition-colors group/ann
                                        ${hasUrgentAnn
                                            ? (isDark ? 'bg-danger/[0.08] border-danger/40 hover:bg-danger/[0.14]' : 'bg-danger/10 border-danger/30 hover:bg-danger/10')
                                            : (isDark ? 'bg-chart-1/[0.06] border-chart-1/40 hover:bg-chart-1/[0.12]' : 'bg-chart-1/10 border-chart-1/30 hover:bg-chart-1/10')}`}
                                >
                                    <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0
                                        ${hasUrgentAnn
                                            ? (isDark ? 'bg-danger/10 text-danger-text border-danger/40' : 'bg-danger/10 text-danger border-danger/30')
                                            : (isDark ? 'bg-chart-1/10 text-chart-1-text border-chart-1/40' : 'bg-chart-1/10 text-brand-text border-chart-1/30')}`}>
                                        <Megaphone size={16} strokeWidth={2} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-body font-bold leading-tight ${hasUrgentAnn ? (isDark ? 'text-danger-text' : 'text-danger') : cx.rowTitle}`}>
                                            {annUnread} aviso{annUnread > 1 ? 's' : ''} sin leer{hasUrgentAnn ? ' · URGENTE' : ''}
                                        </p>
                                        <p className={`text-label font-medium mt-0.5 ${cx.rowBody}`}>Comunicados de la empresa</p>
                                    </div>
                                    <ChevronRight size={16} className={`flex-shrink-0 transition-transform group-hover/ann:translate-x-0.5 ${isDark ? 'text-white/40' : 'text-content-3'}`} />
                                </button>
                            )}

                            {/* ── Lista — el ÚNICO contenedor que hace scroll ── */}
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                {notifications.length === 0 ? (
                                    <div className="relative flex flex-col items-center justify-center py-12 px-6 text-center">
                                        <div className="absolute w-28 h-28 rounded-full bg-brand/10 blur-2xl" />
                                        <div className={`relative w-14 h-14 rounded-2xl border shadow-[var(--shadow-glass-2)] flex items-center justify-center mb-4 ${cx.emptyIconBox}`}>
                                            <Bell size={22} strokeWidth={1.5} />
                                        </div>
                                        <p className={`relative text-body-lg font-bold ${cx.emptyTitle}`}>Todo al día</p>
                                        <p className={`relative text-body-sm font-medium mt-1 ${cx.emptySub}`}>Cuando algo requiera tu atención, aparecerá aquí.</p>
                                    </div>
                                ) : (
                                    /* ── Cada aviso es una TARJETA, no una franja (2026-08-11) ──
                                       Eran filas planas separadas por una línea, y en una fila plana
                                       los botones de decisión no tienen dónde estar adentro: quedaban
                                       colgando entre dos avisos y se leían como si no fueran de
                                       ninguno. Reportado dos veces con captura — «los botones quedan
                                       afuera del recuadro de la card de la notificación».

                                       El corte entre avisos lo daba `divide-y`, y eso sigue resuelto:
                                       ahora lo dan el borde y el aire de cada tarjeta, que además
                                       dicen dónde EMPIEZA y dónde TERMINA cada una — que es lo que
                                       una línea sola no puede decir. */
                                    <div className="p-2 flex flex-col gap-2">
                                        <AnimatePresence initial={false}>
                                            {notifications.map(n => {
                                                const sev  = severidadDelTitulo(n.title);
                                                const Icon = sev ? sev.Icono : iconForType(n.type);
                                                const unread = !n.read_at;
                                                const isFlash = flashIds.has(n.id);
                                                const pendingOne = pendingEntryByNotifId.get(n.id);
                                                const inPendingAll = pendingAll?.ids.includes(n.id);
                                                // Una solicitud ya decidida no se "revisa": el verbo tiene
                                                // que decir en qué terminó, no invitar a algo que ya pasó.
                                                const resuelta    = n.metadata?.resuelta;
                                                const actionLabel = resuelta
                                                    ? (RESUELTA_LABEL[resuelta] || 'Resuelta')
                                                    : (n.link ? (etiquetaDeAccion(n) || 'Ver') : null);

                                                // Dos motivos para desplegar una tarjeta, y sólo el
                                                // primero existía: el detalle de una solicitud, y un
                                                // cuerpo que no entra en tres renglones. El segundo
                                                // dejaba sin leer justo a los avisos del sistema, que
                                                // son los que más texto tienen.
                                                const tieneDetalle = puedeExpandir(n);
                                                const abierta      = expandidas.has(n.id);
                                                const cuerpoCortado = cuerposCortados.has(n.id);
                                                const expandible    = tieneDetalle || cuerpoCortado;
                                                // Interactiva es la que hace ALGO al tocarla, y desde que
                                                // el toque es uno solo eso significa «lleva a su
                                                // pantalla». De eso depende el realce, que es la promesa
                                                // de que se puede tocar.
                                                const interactiva = Boolean(n.link || n.metadata?.request_id);
                                                const quien    = n.created_by ? empleadosPorId.get(String(n.created_by)) : null;
                                                const sucursal = n.branch_id ? sucursalesPorId.get(String(n.branch_id)) : null;
                                                const corte    = corteResoluble(n);
                                                /* El cierre de mes de una sala se dibuja en vez de leerse.
                                                   Devuelve `null` para un aviso viejo o para un mes que
                                                   cerró sin meta, y ahí la fila queda como siempre. */
                                                const cierre   = datosDeCierreDeMeta(n);
                                                /* Y su gemelo de administración, que mira las seis salas
                                                   a la vez. Comparten el anillo y nada más. */
                                                const empresa  = datosDeCierreDeEmpresa(n);
                                                const conAnillo = cierre || empresa;

                                                // Fila en ventana de deshacer (borrado individual)
                                                if (pendingOne) {
                                                    return (
                                                        <motion.div
                                                            key={n.id}
                                                            layout="position"
                                                            exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                                                            // La tarjeta borrada conserva la forma de las
                                                            // demás: en una lista con aire entre tarjetas,
                                                            // una franja a ancho completo se lee como que
                                                            // la lista se rompió, no como un aviso en
                                                            // espera de deshacerse.
                                                            className={`relative flex items-center justify-between pl-4 pr-3 py-3
                                                                rounded-card overflow-hidden ${cx.undoStrip}`}
                                                        >
                                                            <span className={`text-body-sm font-semibold truncate pr-3 ${cx.undoText}`}>
                                                                Notificación borrada
                                                            </span>
                                                            {undoButton(pendingOne.key)}
                                                            <UndoProgress isDark={isDark} />
                                                        </motion.div>
                                                    );
                                                }

                                                return (
                                                    <motion.div
                                                        key={n.id}
                                                        layout="position"
                                                        initial={isFlash ? { opacity: 0, y: -10 } : false}
                                                        animate={{ opacity: inPendingAll ? 0.35 : 1, y: 0 }}
                                                        exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                                                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                                                        data-surface="card"
                                                        className={`relative group overflow-hidden
                                                            ${inPendingAll ? 'pointer-events-none' : ''}`}
                                                    >
                                                        {/* El estado de la tarjeta —sin leer, recién
                                                            llegada— y el realce al apuntarla. Van en velos
                                                            porque el fondo de la tarjeta lo fija
                                                            `index.css` (ver `cx.rowHover`). Dos capas y no
                                                            una: así apuntar una tarjeta sin leer SUMA
                                                            realce en vez de reemplazar su tinte. */}
                                                        <div aria-hidden="true"
                                                            className={`absolute inset-0 pointer-events-none transition-colors duration-[var(--dur-lento)]
                                                                ${isFlash ? (isDark ? 'bg-chart-1/[0.14]' : 'bg-chart-1/10') : unread ? cx.rowUnread : ''}`} />
                                                        <div aria-hidden="true"
                                                            className={`absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-[var(--dur-base)]
                                                                ${cx.veloHover} ${interactiva ? cx.rowHover : ''}`} />

                                                        <button
                                                            onClick={() => handleNotifClick(n)}
                                                            // Este botón no es una pieza de la tarjeta: es su
                                                            // cara. Sin ceder el filo, la animación al apuntar
                                                            // corre SU rectángulo y corta la tarjeta justo
                                                            // arriba de Aprobar/Rechazar. Ver `index.css`.
                                                            data-filo="ceder"
                                                            className={`relative w-full flex items-start gap-3 pl-3.5 pr-9 py-3 text-left
                                                                ${interactiva ? 'cursor-pointer' : 'cursor-default'}`}
                                                        >
                                                            {conAnillo ? (
                                                                <AnilloDeMeta pct={conAnillo.pct} isDark={isDark} />
                                                            ) : (
                                                                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${sev ? (isDark ? sev.oscuro : sev.claro) : tintForType(n.type, n.metadata, isDark)}`}>
                                                                    <Icon size={16} strokeWidth={2} />
                                                                </div>
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                {/* El punto va PEGADO al título, no en la esquina.
                                                                    Arriba a la derecha competía por el mismo sitio
                                                                    que la ✕ y no se leía como «este es nuevo», sino
                                                                    como un adorno suelto. */}
                                                                <p className={`text-body leading-snug ${unread ? `font-bold ${cx.rowTitle}` : `font-semibold ${cx.rowTitleRead}`}`}>
                                                                    {unread && (
                                                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand align-middle mr-1.5 -mt-0.5 shadow-[var(--shadow-glow-brand-sm)]" />
                                                                    )}
                                                                    {tituloSinEmoji(n.title)}
                                                                </p>
                                                                {/* Con montos, las cifras se dibujan y el párrafo
                                                                    sobra: diría en palabras lo mismo que está
                                                                    arriba en números. Sin montos el `body` ya
                                                                    viene escrito en porcentaje y se deja tal
                                                                    cual —redactarlo otra vez acá sería copiar
                                                                    la regla que decide quién ve dólares—, y
                                                                    debajo se le suma igual el puesto entre las
                                                                    salas, que no habla de dinero. */}
                                                                {(!conAnillo || (cierre && cierre.venta == null)) && n.body && (
                                                                    <CuerpoDeNotificacion
                                                                        id={n.id}
                                                                        texto={n.body}
                                                                        recortar={!abierta}
                                                                        clase={cx.rowBody}
                                                                        onRecorte={marcarCuerpoCortado}
                                                                    />
                                                                )}
                                                                {cierre && (
                                                                    <CuerpoDeCierreDeMeta
                                                                        datos={cierre}
                                                                        claseTenue={cx.rowBody}
                                                                        isDark={isDark}
                                                                        buscarEmpleado={buscarEmpleadoPorId}
                                                                    />
                                                                )}
                                                                {empresa && (
                                                                    <CuerpoDeCierreDeEmpresa
                                                                        datos={empresa}
                                                                        claseTenue={cx.rowBody}
                                                                        isDark={isDark}
                                                                        buscarEmpleado={buscarEmpleadoPorId}
                                                                    />
                                                                )}

                                                                {/* ── De quién y de qué sala ──────────────────────
                                                                    El nombre viaja adentro del cuerpo («QA Testing
                                                                    solicita…»), pero ahí es una palabra más en un
                                                                    párrafo de tres renglones: no se distingue de
                                                                    un vistazo y la sala no aparecía en ninguna
                                                                    parte. Acá van como dato, con la cara adelante
                                                                    —que es lo que de verdad se reconoce— y sin
                                                                    costar una consulta: las dos salen de la fila. */}
                                                                {(quien || sucursal) && (
                                                                    <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                                                                        {quien && (
                                                                            <AvatarConEstado emp={quien} px={20} radio="rounded-full" marco="" />
                                                                        )}
                                                                        <span className={`text-caption font-bold truncate ${cx.rowTitleRead}`}>
                                                                            {quien ? shortEmployeeName(quien) : sucursal}
                                                                        </span>
                                                                        {quien && sucursal && (
                                                                            <span className={`text-caption font-medium truncate ${cx.rowTime}`}>· {sucursal}</span>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                <div className="flex items-center gap-2 mt-1.5">
                                                                    {/* La hora es contexto, no acción: en mayúsculas y con
                                                                        tracking ancho competía de igual a igual con «VER»,
                                                                        y son cosas de peso distinto. */}
                                                                    <span className={`text-caption font-medium ${cx.rowTime}`}>{timeAgo(n.created_at)}</span>
                                                                    {/* El verbo del TOQUE, y ahora el toque es uno solo:
                                                                        salir a Solicitudes. «Ver detalle» dejó de vivir
                                                                        acá —era una palabra dentro del botón grande, o
                                                                        sea que no se podía tocar por su cuenta— y bajó a
                                                                        la fila de controles como botón de verdad. */}
                                                                    {actionLabel && (
                                                                        <span className={`inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest transition-transform
                                                                            ${resuelta ? cx.chipMuted : `group-hover:translate-x-0.5 ${unread ? (isDark ? 'text-chart-1-text' : 'text-brand-text') : cx.chipMuted}`}`}>
                                                                            {actionLabel}
                                                                            {/* La flecha promete "esto lleva a algún lado".
                                                                                En una solicitud ya decidida no lleva a nada
                                                                                que haya que hacer. */}
                                                                            {!resuelta && <ArrowRight size={10} strokeWidth={3} />}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>

                                                        {/* ── «Ver detalle», ahora un control de verdad ──────
                                                            Era una palabra DENTRO del botón grande de la
                                                            tarjeta, así que no se podía tocar por su cuenta:
                                                            el mismo toque servía para leer el detalle y para
                                                            nada más. Acá es un botón, al ancho de la tarjeta
                                                            y con la altura mínima de toque que garantiza
                                                            `--tap-min` — que es lo que lo hace usable con el
                                                            pulgar. */}
                                                        {expandible && (
                                                            <div className={`relative px-3.5 pb-2.5 ${resuelta ? '' : '-mt-1'} flex items-center gap-2`}>
                                                                {/* `secondary` y no `ghost`: en `ghost` era texto con
                                                                    un ícono al lado —medido en iPhone 13, se leía como
                                                                    un rótulo centrado y no como algo que se toca— y el
                                                                    pedido era justamente que el detalle tenga SU
                                                                    control. Con relleno propio se distingue de la
                                                                    tarjeta sin competirle a Aprobar/Rechazar, que son
                                                                    los únicos con color. */}
                                                                <Button
                                                                    size="xs"
                                                                    variant="secondary"
                                                                    icon={abierta ? ChevronDown : Eye}
                                                                    className="flex-1 min-w-0"
                                                                    aria-expanded={abierta}
                                                                    onClick={(e) => { e.stopPropagation(); alternarExpansion(n.id); }}
                                                                >
                                                                    {/* El rótulo nombra lo que se despliega. En un
                                                                        aviso del sistema no hay ningún «detalle» que
                                                                        abrir: lo que falta es el resto del mensaje. */}
                                                                    {tieneDetalle
                                                                        ? (abierta ? 'Ocultar detalle'  : 'Ver detalle')
                                                                        : (abierta ? 'Ocultar mensaje'  : 'Ver mensaje completo')}
                                                                </Button>
                                                                {/* El estado de una solicitud ya decidida: sin
                                                                    esto, una aprobada y una pendiente se leen
                                                                    igual una vez que el verbo dejó de decirlo. */}
                                                                {resuelta && (
                                                                    <span className={`shrink-0 text-caption font-black uppercase tracking-widest ${cx.chipMuted}`}>
                                                                        {RESUELTA_LABEL[resuelta] || 'Resuelta'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* ── El detalle, desplegado ─────────────────────────
                                                            Lo que hay que ver para decidir: las líneas de
                                                            producto de un ajuste, la factura de una
                                                            modificación, el MIN/MAX de antes y el propuesto,
                                                            las fotos de evidencia y el motivo escrito.
                                                            Se monta SOLO al abrirla — el contenido pesa y no
                                                            tiene por qué viajar por cada fila de la lista. */}
                                                        {abierta && tieneDetalle && (
                                                            <div className={`relative px-3.5 pb-3 pt-2 border-t ${cx.headerBorder}`}>
                                                                <NotificacionDetalle notif={n} />
                                                            </div>
                                                        )}

                                                        {/* ── Decidir acá mismo ──────────────────────────────
                                                            Aprobar aplica de una: un toque y listo, sin pasar
                                                            por otra pantalla ni por un segundo «confirmar».
                                                            Rechazar abre el diálogo canónico, porque exige
                                                            motivo — y ahí arriba se ve lo que se rechaza.

                                                            La regla no está duplicada: las dos llaman a
                                                            `useDecidirSolicitud`, la misma que usa la bandeja.
                                                            Lo que cambia es el gesto, no lo que pasa. */}
                                                        {puedeDecidir(n) && (
                                                            <div className={`relative flex items-stretch gap-2 px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                                                                {/* `soft` y no relleno sólido: es el caso que
                                                                    nombra DESIGN.md §15.2 — dos acciones de
                                                                    categoría juntas donde ninguna manda.

                                                                    Van al ANCHO de la tarjeta, mitad y mitad.
                                                                    Antes se sangraban 68px para alinearse con
                                                                    el texto y el par no entraba: en el panel
                                                                    angosto «Rechazar» se salía del cuadro. Dos
                                                                    acciones del mismo peso repartidas por igual
                                                                    no dependen del largo de su etiqueta. */}
                                                                <Button
                                                                    size="xs"
                                                                    tone="success"
                                                                    soft
                                                                    icon={Check}
                                                                    className="flex-1 min-w-0"
                                                                    loading={decidiendoId === n.id && decidiendo}
                                                                    disabled={!!decidiendoId && decidiendoId !== n.id}
                                                                    onClick={(e) => { e.stopPropagation(); aprobarDesdeElAviso(n); }}
                                                                >
                                                                    Aprobar
                                                                </Button>
                                                                <Button
                                                                    size="xs"
                                                                    tone="danger"
                                                                    soft
                                                                    icon={X}
                                                                    className="flex-1 min-w-0"
                                                                    disabled={!!decidiendoId}
                                                                    onClick={(e) => { e.stopPropagation(); rechazarDesdeElAviso(n); }}
                                                                >
                                                                    Rechazar
                                                                </Button>
                                                            </div>
                                                        )}

                                                        {/* ── El corte, resuelto acá mismo ───────────────────
                                            «Confirmar» cierra el corte que cuadra al centavo de
                                            un toque; el que tiene diferencia abre el detalle con
                                            la cifra delante, porque firmar un faltante sin verlo
                                            no es un atajo, es otra cosa. «Descartar» siempre
                                            abre: exige decir por qué. */}
                                        {corte && (
                                            <div className={`relative flex items-stretch gap-2 px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                                                <Button
                                                    size="xs"
                                                    tone="success"
                                                    soft
                                                    icon={Check}
                                                    className="flex-1 min-w-0"
                                                    loading={corteOcupado === corte.id}
                                                    disabled={!!corteOcupado && corteOcupado !== corte.id}
                                                    onClick={(e) => { e.stopPropagation(); confirmarCorteDesdeElAviso(n, corte); }}
                                                >
                                                    Confirmar
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    tone="danger"
                                                    soft
                                                    icon={Ban}
                                                    className="flex-1 min-w-0"
                                                    disabled={!!corteOcupado}
                                                    onClick={(e) => { e.stopPropagation(); abrirCorte(n, corte, 'descartar'); }}
                                                >
                                                    Descartar
                                                </Button>
                                            </div>
                                        )}

                                        {/* El traslado abre su solicitud con el bloque que
                                                            confirma o rechaza adentro. Un solo botón y no dos:
                                                            confirmarlo relee la existencia de la sala de origen y
                                                            puede resultar que ya no alcance, así que prometer
                                                            «Aprobar» desde acá sería prometer lo que no se sabe. */}
                                                        {trasladoPorResolver(n) && (
                                                            <div className={`relative px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                                                                <Button
                                                                    size="xs"
                                                                    soft
                                                                    icon={ArrowLeftRight}
                                                                    className="w-full"
                                                                    loading={decidiendoId === n.id}
                                                                    disabled={!!decidiendoId}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        resolverTrasladoDesdeElAviso(n);
                                                                    }}
                                                                >
                                                                    Revisar el traslado
                                                                </Button>
                                                            </div>
                                                        )}
                                                        {/* Borrar individual — visible al hover en desktop, siempre tenue en touch.
                                                            Va ANCLADO arriba a la derecha: el texto ya le
                                                            reservaba el hueco con su `pr-10`, pero al botón le
                                                            faltaba el posicionamiento, así que caía al flujo y
                                                            aparecía suelto abajo a la izquierda de la tarjeta,
                                                            debajo de Aprobar/Rechazar. */}
                                                        <Button variant="ghost" icon={X} title="Borrar" iconOnly
                                                            className={`absolute top-1.5 right-1.5 z-base ${cx.iconBtn}`}
                                                            onClick={(e) => { e.stopPropagation(); scheduleDelete([n.id]); }} />
                                                    </motion.div>
                                                );
                                            })}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── El motivo del rechazo ──────────────────────────────────────
                Va acá afuera, hermano del panel y no adentro: el diálogo cierra
                la campana al abrirse, y montado dentro del `isOpen` se
                desmontaría con ella —el modal que lee el estado que lo abre se
                vacía al cerrarlo—.

                Es el diálogo canónico de la solicitud, no una ventanita propia:
                trae el detalle arriba, el campo de motivo con su obligatoriedad
                y el mismo `onDecidir`. `canApprove` va en `true` porque para
                llegar hasta acá ya se evaluó `puedeDecidir`. */}
            {rechazo && (
                <Suspense fallback={null}>
                    <ModalSolicitud
                        key={rechazo.req.id}
                        req={rechazo.req}
                        canApprove
                        employeesById={empleadosPorId}
                        accionInicial={rechazo.accion}
                        ocupado={decidiendo}
                        onCerrar={() => !decidiendo && setRechazo(null)}
                        onDecidir={decidir}
                        /* El traslado lo aplica una Edge Function y su aviso
                           tiene fila propia: el disparador de la base lo marca
                           resuelto, pero eso llega por realtime y el panel
                           todavía ofrecería el botón. Se apaga acá, igual que
                           hace `useDecidirSolicitud` con el resto. */
                        onResuelto={(estado) => marcarAvisoResuelto(rechazo.req.id, estado)}
                    />
                </Suspense>
            )}

            {/* El detalle del corte, hermano del panel por el mismo motivo. Se
                queda montado con `corte` en nulo —igual que en el módulo y en
                el Inicio—: es lo que le deja hacer su salida en vez de
                desaparecer de golpe. */}
            {montarDetalleCorte && (
                <Suspense fallback={null}>
                    <CorteDetalleModal
                        corte={corteAbierto?.corte ?? null}
                        nombreSala={nombreSala}
                        modoInicial={corteAbierto?.modo ?? null}
                        origen="campana"
                        onClose={() => setCorteAbierto(null)}
                        onResuelto={recargarCortes}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default NotificationBell;
