import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, BellRing, Check, AlertTriangle, AlertCircle, CheckCircle2,
    Megaphone, ChevronRight, ChevronDown, Trash2, X, ArrowRight, ArrowUpRight, Undo2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { iconoDeTipo } from '../../constants/tipoIconos';
import { shortEmployeeName } from '../../utils/nameUtils';
import Contador from './Contador';
import LiquidAvatar from './LiquidAvatar';
import NotificacionDetalle from './NotificacionDetalle';

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
};

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
    // Borrados en ventana de deshacer: [{ key, ids: string[], isAll }]
    const [pendingDeletes, setPendingDeletes] = useState([]);
    const rootRef = useRef(null);
    const seenIdsRef = useRef(null);
    const prevUnreadRef = useRef(0);
    const confirmTimerRef = useRef(null);
    const deleteTimersRef = useRef(new Map());

    const canSeeAnnouncements = hasPermission('emp_announcements', 'can_view');
    const canApprove          = hasPermission('requests', 'can_approve');
    const canApproveMinMax    = hasPermission('minmax', 'can_approve');

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

    /* Una notificación que tiene una solicitud detrás se DESPLIEGA en el sitio;
       el resto sigue llevando a su pantalla como siempre.

       El aviso cuenta lo que pasó en tres renglones y ahí se acaba: qué producto
       se descarta, de qué factura habla o de cuánto a cuánto va un Min/Max no
       cabían. Desplegar es lo que convierte «avisame» en «mostrame», y sin salir
       de la campana no se pierde el resto de la bandeja.

       Salir sigue estando: el detalle desplegado trae su propio «Ver en
       Solicitudes», que es donde la solicitud vive con su historial completo. */
    const puedeExpandir = (n) => Boolean(n.metadata?.request_id);

    const alternarExpansion = (id) => setExpandidas(prev => {
        const s = new Set(prev);
        s.has(id) ? s.delete(id) : s.add(id);
        return s;
    });

    const handleNotifClick = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        if (puedeExpandir(n)) { alternarExpansion(n.id); return; }
        if (n.link) {
            setIsOpen(false);
            navigate(n.link);
        }
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
    // Cada tipo con SU permiso: quien aprueba solicitudes de personal no es
    // necesariamente quien aprueba un ajuste de Min/Max. Usar `requests` para
    // los dos habría mostrado botones que el servidor rechaza.
    const PERMISO_POR_TIPO = {
        REQUEST_PENDING: canApprove,
        MINMAX_PENDING:  canApproveMinMax,
    };

    const puedeDecidir = (n) =>
        PERMISO_POR_TIPO[n.type] === true
        && !!n.metadata?.request_id && !n.metadata?.resuelta;

    const RESUELTA_LABEL = { APPROVED: 'Aprobada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada' };

    const irADecidir = (n, accion) => {
        if (!n.read_at) markNotificationRead(n.id);
        setIsOpen(false);
        const base = (n.link || '/requests').split('?')[0];
        navigate(`${base}?solicitud=${n.metadata.request_id}&accion=${accion}`);
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
                        // Móvil: `fixed` anclado a los bordes de la PANTALLA, no
                        // al botón. Estaba `absolute right-0` con un ancho de
                        // `100vw - 2rem`: como la campana no está pegada al borde
                        // derecho, el panel se extendía hacia la izquierda y salía
                        // de la pantalla. Medido en iPhone 13: x = -36px, o sea
                        // que el título se leía "otificaciones". Es lo que el
                        // usuario reportó como "al abrir las notificaciones se
                        // corta".
                        //
                        // Y `max-h` + scroll propio: con varias notificaciones el
                        // panel crecía hasta pasarse por abajo, donde tampoco hay
                        // forma de alcanzarlo.
                        className={`z-bell-dropdown origin-top-right
                            ${isDesktop
                                ? 'absolute right-0 top-[3.25rem] w-[380px]'
                                : `fixed left-2 right-2 top-[calc(3.5rem+var(--sa-top))] w-auto
                                   max-h-[calc(100vh-5rem-var(--sa-top))] overflow-y-auto overscroll-contain`}`}
                    >
                        <div data-surface="dropdown" className="overflow-hidden transform-gpu">
                            {/* Shimmer superior */}
                            <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-brand/40 to-transparent animate-shimmer" style={{ animationDuration: '4s' }} />
                            </div>

                            {/* ── Header ── */}
                            <div className={`flex items-center justify-between pl-5 pr-3 pt-4 pb-3 border-b ${cx.headerBorder}`}>
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
                                <div className={`relative flex items-center justify-between pl-5 pr-3 py-2.5 border-b ${cx.headerBorder} ${cx.undoStrip}`}>
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
                                    onClick={() => { setIsOpen(false); navigate('/my-announcements'); }}
                                    className={`w-full flex items-center gap-3 px-5 py-3 text-left border-b transition-colors group/ann
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

                            {/* ── Lista ── */}
                            <div className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                                                    : (n.link ? (ACTION_LABEL[n.type] || 'Ver') : null);

                                                const expandible = puedeExpandir(n);
                                                const abierta    = expandidas.has(n.id);
                                                // Interactiva es la que hace ALGO al tocarla: desplegarse
                                                // o llevar a su pantalla. De eso depende el realce, que
                                                // es la promesa de que se puede tocar.
                                                const interactiva = expandible || Boolean(n.link);
                                                const quien    = n.created_by ? empleadosPorId.get(String(n.created_by)) : null;
                                                const sucursal = n.branch_id ? sucursalesPorId.get(String(n.branch_id)) : null;

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
                                                            aria-expanded={expandible ? abierta : undefined}
                                                            // Este botón no es una pieza de la tarjeta: es su
                                                            // cara. Sin ceder el filo, la animación al apuntar
                                                            // corre SU rectángulo y corta la tarjeta justo
                                                            // arriba de Aprobar/Rechazar. Ver `index.css`.
                                                            data-filo="ceder"
                                                            className={`relative w-full flex items-start gap-3 pl-3.5 pr-9 py-3 text-left
                                                                ${interactiva ? 'cursor-pointer' : 'cursor-default'}`}
                                                        >
                                                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${sev ? (isDark ? sev.oscuro : sev.claro) : tintForType(n.type, n.metadata, isDark)}`}>
                                                                <Icon size={16} strokeWidth={2} />
                                                            </div>
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
                                                                {n.body && (
                                                                    <p className={`text-body-sm font-medium leading-snug mt-0.5 ${abierta ? '' : 'line-clamp-3'} ${cx.rowBody}`}>{n.body}</p>
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
                                                                            <LiquidAvatar
                                                                                src={quien.photo || quien.photo_url}
                                                                                alt=""
                                                                                fallbackText={quien.name}
                                                                                className="w-5 h-5 rounded-full shrink-0 text-micro"
                                                                            />
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
                                                                    {/* En una fila que se despliega, el verbo tiene que
                                                                        decir QUÉ hace el toque. «Revisar solicitud →»
                                                                        prometía irse a otra pantalla, y eso ahora lo
                                                                        ofrece el enlace de abajo del detalle. */}
                                                                    {expandible ? (
                                                                        <span className={`inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest
                                                                            ${unread && !abierta ? (isDark ? 'text-chart-1-text' : 'text-brand-text') : cx.chipMuted}`}>
                                                                            {abierta ? 'Ocultar' : 'Ver detalle'}
                                                                            <ChevronDown size={11} strokeWidth={3}
                                                                                className={`transition-transform duration-[var(--dur-base)] ${abierta ? 'rotate-180' : ''}`} />
                                                                        </span>
                                                                    ) : actionLabel && (
                                                                        <span className={`inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest transition-transform
                                                                            ${resuelta ? cx.chipMuted : `group-hover:translate-x-0.5 ${unread ? (isDark ? 'text-chart-1-text' : 'text-brand-text') : cx.chipMuted}`}`}>
                                                                            {actionLabel}
                                                                            {/* La flecha promete "esto lleva a algún lado".
                                                                                En una solicitud ya decidida no lleva a nada
                                                                                que haya que hacer. */}
                                                                            {!resuelta && <ArrowRight size={10} strokeWidth={3} />}
                                                                        </span>
                                                                    )}
                                                                    {/* El estado de una solicitud ya decidida se pierde
                                                                        al cambiar el verbo por «Ver detalle»: sin esto,
                                                                        una aprobada y una pendiente se leen igual. */}
                                                                    {expandible && resuelta && (
                                                                        <span className={`text-caption font-black uppercase tracking-widest ${cx.chipMuted}`}>
                                                                            {RESUELTA_LABEL[resuelta] || 'Resuelta'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>

                                                        {/* ── El detalle, desplegado ─────────────────────────
                                                            Lo que hay que ver para decidir: las líneas de
                                                            producto de un ajuste, la factura de una
                                                            modificación, el MIN/MAX de antes y el propuesto,
                                                            las fotos de evidencia y el motivo escrito.
                                                            Se monta SOLO al abrirla — el contenido pesa y no
                                                            tiene por qué viajar por cada fila de la lista. */}
                                                        {abierta && (
                                                            <div className={`relative px-3.5 pb-3 pt-2 border-t ${cx.headerBorder}`}>
                                                                <NotificacionDetalle notif={n} />
                                                                {/* La salida. La campana muestra la solicitud;
                                                                    Solicitudes es donde vive, con su historial
                                                                    y el resto de la bandeja al lado. */}
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); irASolicitudes(n); }}
                                                                    className={`mt-2 inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest px-2 py-1.5 -ml-2 rounded-xl transition-colors
                                                                        ${isDark ? 'text-chart-1-text hover:bg-chart-1/10' : 'text-brand-text hover:bg-chart-1/10'}`}
                                                                >
                                                                    Ver en Solicitudes
                                                                    <ArrowUpRight size={11} strokeWidth={3} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Decidir sin salir de la campana.
                                                            No repiten el flujo de decisión: llevan AL diálogo
                                                            de esa solicitud. Duplicarlo acá significaría dos
                                                            copias de la misma regla —el rechazo exige motivo,
                                                            la aprobación de facturación avisa que va al ERP—
                                                            y tarde o temprano una se queda vieja.
                                                            Además es lo que funciona en iPhone: iOS ignora
                                                            los botones de acción de una notificación web. */}
                                                        {puedeDecidir(n) && (
                                                            // El `-mt-1` recupera el aire que deja el renglón de
                                                            // la hora; con el detalle abierto ese renglón no es
                                                            // el vecino de arriba, así que subir los botones los
                                                            // pegaría al enlace de salida.
                                                            <div className={`relative flex items-stretch gap-2 px-3.5 pb-3 ${abierta ? '' : '-mt-1'}`}>
                                                                {/* `soft` y no relleno sólido: es el caso que
                                                                    nombra DESIGN.md §15.2 — dos acciones de
                                                                    categoría juntas donde ninguna manda. Y
                                                                    ninguna es destructiva acá: abren el
                                                                    diálogo, no deciden.

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
                                                                    onClick={(e) => { e.stopPropagation(); irADecidir(n, 'aprobar'); }}
                                                                >
                                                                    Aprobar
                                                                </Button>
                                                                <Button
                                                                    size="xs"
                                                                    tone="danger"
                                                                    soft
                                                                    icon={X}
                                                                    className="flex-1 min-w-0"
                                                                    onClick={(e) => { e.stopPropagation(); irADecidir(n, 'rechazar'); }}
                                                                >
                                                                    Rechazar
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
        </div>
    );
};

export default NotificationBell;
