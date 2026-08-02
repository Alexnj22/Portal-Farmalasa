import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, BellRing, CheckCheck,
    Megaphone, ChevronRight, Trash2, X, ArrowRight, Undo2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { iconoDeTipo } from '../../constants/tipoIconos';
import Contador from './Contador';

// ── Apariencia por tipo de notificación ──────────────────────────────────────
// El ícono sale del catálogo compartido (`constants/tipoIconos`). Antes se
// resolvía acá por prefijo y seis tipos que sí se envían —anulación, cambio de
// cliente, de forma de pago, de vendedor, de turno, y los mensajes del sistema—
// caían todos al ícono genérico de campana, aunque cinco de ellos ya tenían
// ícono propio en RequestsView.
const iconForType = iconoDeTipo;

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

    const notifications = useStaff(s => s.notifications || []);
    const announcements = useStaff(s => s.announcements || []);
    const roles = useStaff(s => s.roles || []);
    const markNotificationRead = useStaff(s => s.markNotificationRead);
    const markAllNotificationsRead = useStaff(s => s.markAllNotificationsRead);
    const deleteNotificationsByIds = useStaff(s => s.deleteNotificationsByIds);
    const deleteAllNotifications = useStaff(s => s.deleteAllNotifications);

    const [isOpen, setIsOpen] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [justRang, setJustRang] = useState(false);
    const [flashIds, setFlashIds] = useState(() => new Set());
    // Borrados en ventana de deshacer: [{ key, ids: string[], isAll }]
    const [pendingDeletes, setPendingDeletes] = useState([]);
    const rootRef = useRef(null);
    const seenIdsRef = useRef(null);
    const prevUnreadRef = useRef(0);
    const confirmTimerRef = useRef(null);
    const deleteTimersRef = useRef(new Map());

    const canSeeAnnouncements = hasPermission('emp_announcements', 'can_view');

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

    const handleNotifClick = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        if (n.link) {
            setIsOpen(false);
            navigate(n.link);
        }
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
        rowHover: 'hover:bg-white/[0.06]',
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
        rowHover: 'hover:bg-surface-card',
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
                className={`relative flex items-center justify-center w-11 h-11 rounded-2xl backdrop-blur-2xl border
                    hover:translate-y-[var(--lift-hover)] hover:scale-105 active:scale-[0.97] active:translate-y-0 transition-all duration-200
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
                                : `fixed left-2 right-2 top-[calc(3.5rem+env(safe-area-inset-top,0px))] w-auto
                                   max-h-[calc(100vh-5rem-env(safe-area-inset-top,0px))] overflow-y-auto overscroll-contain`}`}
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
                                            <CheckCheck size={13} strokeWidth={2.5} />
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
                                    <div className="py-1.5">
                                        <AnimatePresence initial={false}>
                                            {notifications.map(n => {
                                                const Icon = iconForType(n.type);
                                                const unread = !n.read_at;
                                                const isFlash = flashIds.has(n.id);
                                                const pendingOne = pendingEntryByNotifId.get(n.id);
                                                const inPendingAll = pendingAll?.ids.includes(n.id);
                                                const actionLabel = n.link ? (ACTION_LABEL[n.type] || 'Ver') : null;

                                                // Fila en ventana de deshacer (borrado individual)
                                                if (pendingOne) {
                                                    return (
                                                        <motion.div
                                                            key={n.id}
                                                            layout="position"
                                                            exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                                                            className={`relative flex items-center justify-between pl-5 pr-3 py-3 ${cx.undoStrip}`}
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
                                                        className={`relative group transition-colors duration-500
                                                            ${inPendingAll ? 'pointer-events-none' : ''}
                                                            ${isFlash ? (isDark ? 'bg-chart-1/[0.14]' : 'bg-chart-1/10') : unread ? cx.rowUnread : ''}`}
                                                    >
                                                        <button
                                                            onClick={() => handleNotifClick(n)}
                                                            className={`w-full flex items-start gap-3 pl-5 pr-10 py-3 text-left transition-colors
                                                                ${n.link ? `cursor-pointer ${cx.rowHover}` : 'cursor-default'}`}
                                                        >
                                                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${tintForType(n.type, n.metadata, isDark)}`}>
                                                                <Icon size={16} strokeWidth={2} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className={`text-body leading-snug ${unread ? `font-bold ${cx.rowTitle}` : `font-semibold ${cx.rowTitleRead}`}`}>
                                                                    {n.title}
                                                                </p>
                                                                {n.body && (
                                                                    <p className={`text-body-sm font-medium leading-snug mt-0.5 line-clamp-2 ${cx.rowBody}`}>{n.body}</p>
                                                                )}
                                                                <div className="flex items-center gap-2 mt-1.5">
                                                                    <span className={`text-caption font-bold uppercase tracking-wider ${cx.rowTime}`}>{timeAgo(n.created_at)}</span>
                                                                    {actionLabel && (
                                                                        <span className={`inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest transition-transform group-hover:translate-x-0.5
                                                                            ${unread ? (isDark ? 'text-chart-1-text' : 'text-brand-text') : cx.chipMuted}`}>
                                                                            {actionLabel}
                                                                            <ArrowRight size={10} strokeWidth={3} />
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {unread && <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0 mt-2 shadow-[var(--shadow-glow-brand-sm)]" />}
                                                        </button>
                                                        {/* Borrar individual — visible al hover en desktop, siempre tenue en touch */}
                                                        <Button variant="ghost" icon={X} title="Borrar" iconOnly className={cx.iconBtn} onClick={(e) => { e.stopPropagation(); scheduleDelete([n.id]); }} />
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
