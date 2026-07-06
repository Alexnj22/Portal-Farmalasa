import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, BellRing, CheckCheck, ClipboardList, Package, BarChart2,
    Megaphone, ChevronRight, Trash2, X, ArrowRight, Undo2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';

// ── Apariencia por tipo de notificación ──────────────────────────────────────
const iconForType = (type = '') => {
    if (type.startsWith('PEDIDO'))  return Package;
    if (type.startsWith('MINMAX'))  return BarChart2;
    if (type.startsWith('REQUEST')) return ClipboardList;
    return Bell;
};

const tintForType = (type = '', metadata = {}, isDark = false) => {
    if (isDark) {
        if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-amber-400/10 text-amber-300 border-amber-300/20';
        if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
            return metadata?.status === 'REJECTED'
                ? 'bg-red-400/10 text-red-300 border-red-300/20'
                : 'bg-emerald-400/10 text-emerald-300 border-emerald-300/20';
        }
        if (type.startsWith('PEDIDO')) return 'bg-blue-400/10 text-blue-300 border-blue-300/20';
        return 'bg-white/8 text-white/60 border-white/10';
    }
    if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-amber-50 text-amber-600 border-amber-100';
    if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
        return metadata?.status === 'REJECTED'
            ? 'bg-red-50 text-red-500 border-red-100'
            : 'bg-emerald-50 text-emerald-600 border-emerald-100';
    }
    if (type.startsWith('PEDIDO')) return 'bg-blue-50 text-[#0052CC] border-blue-100';
    return 'bg-slate-100 text-slate-500 border-slate-200/70';
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
    <div className={`absolute bottom-0 inset-x-0 h-[2px] ${isDark ? 'bg-white/10' : 'bg-slate-200/70'}`}>
        <motion.div
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: UNDO_MS / 1000, ease: 'linear' }}
            style={{ transformOrigin: 'left' }}
            className="h-full bg-[#0052CC]"
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
            if (rec.isAll) deleteAllNotifications();
            else deleteNotificationsByIds(rec.ids);
        }
        setPendingDeletes(prev => prev.filter(e => e.key !== key));
    };

    const scheduleDelete = (ids, isAll = false) => {
        if (!ids.length) return;
        const key = `${isAll ? 'all' : 'one'}-${Date.now()}`;
        setPendingDeletes(prev => [...prev, { key, ids, isAll }]);
        deleteTimersRef.current.set(key, { ids, isAll, timer: setTimeout(() => commitDelete(key), UNDO_MS) });
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
    const cx = isDark ? {
        panel: 'bg-[#0A0F1C]/90 backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_2px_15px_rgba(255,255,255,0.05)]',
        headerBorder: 'border-white/[0.07]',
        title: 'text-white/90',
        rowHover: 'hover:bg-white/[0.06]',
        rowUnread: 'bg-blue-400/[0.07]',
        rowTitle: 'text-white/90', rowTitleRead: 'text-white/60',
        rowBody: 'text-white/50',
        rowTime: 'text-white/40',
        iconBtn: 'text-white/45 hover:text-white/90 hover:bg-white/10',
        emptyIconBox: 'bg-white/[0.06] border-white/10 text-white/40',
        emptyTitle: 'text-white/80', emptySub: 'text-white/45',
        chipMuted: 'text-white/40',
        undoStrip: 'bg-white/[0.05]',
        undoText: 'text-white/60',
        undoBtn: 'text-blue-300 hover:bg-blue-400/10 border-blue-300/25',
    } : {
        panel: 'bg-white/60 backdrop-blur-[20px] backdrop-saturate-[150%] border border-white/90 shadow-[0_30px_80px_rgba(0,0,0,0.15),0_15px_30px_rgba(0,0,0,0.1),inset_0_2px_15px_rgba(255,255,255,0.8)]',
        headerBorder: 'border-slate-200/60',
        title: 'text-slate-800',
        rowHover: 'hover:bg-white/70',
        rowUnread: 'bg-blue-50/50',
        rowTitle: 'text-slate-800', rowTitleRead: 'text-slate-600',
        rowBody: 'text-slate-500',
        rowTime: 'text-slate-500',
        iconBtn: 'text-slate-500 hover:text-slate-700 hover:bg-white/80',
        emptyIconBox: 'bg-white/80 border-white text-[#0052CC]/50',
        emptyTitle: 'text-slate-700', emptySub: 'text-slate-500',
        chipMuted: 'text-slate-500',
        undoStrip: 'bg-slate-50/80',
        undoText: 'text-slate-600',
        undoBtn: 'text-[#0052CC] hover:bg-blue-50 border-blue-200/70',
    };

    const undoButton = (key, label = 'Deshacer') => (
        <button
            onClick={() => undoDelete(key)}
            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-xl border transition-colors ${cx.undoBtn}`}
        >
            <Undo2 size={12} strokeWidth={2.5} />
            {label}
        </button>
    );

    return (
        <div ref={rootRef} className="relative">
            {isDesktop && totalBadge > 0 && (
                <div className={`absolute -inset-3 rounded-[2rem] blur-xl pointer-events-none ${hasUrgentAnn ? 'bg-red-500/30' : 'bg-[#0052CC]/20'}`} />
            )}

            {/* ── Botón campana ── */}
            <button
                onClick={() => setIsOpen(o => !o)}
                title="Notificaciones"
                aria-label="Notificaciones"
                className={`relative flex items-center justify-center w-11 h-11 rounded-[1.25rem] backdrop-blur-2xl border
                    hover:-translate-y-0.5 hover:scale-105 active:scale-[0.97] active:translate-y-0 transition-all duration-200
                    ${isDark
                        ? `shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]
                           ${hasUrgentAnn ? 'bg-red-400/15 border-red-300/30' : 'bg-white/[0.08] border-white/[0.14] hover:bg-white/[0.14]'}`
                        : `shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.06)]
                           ${hasUrgentAnn
                               ? 'bg-red-50/90 border-red-300/80 hover:shadow-[0_12px_40px_rgba(239,68,68,0.3),inset_0_1px_0_rgba(255,255,255,1)]'
                               : 'bg-white/75 border-blue-200/80 hover:shadow-[0_12px_40px_rgba(0,82,204,0.22),inset_0_1px_0_rgba(255,255,255,1)]'}`}`}
            >
                {!isDark && <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/80 to-transparent rounded-t-[1.25rem] pointer-events-none" />}
                {totalBadge > 0 ? (
                    <BellRing size={18} strokeWidth={2}
                        className={`relative z-10 transition-colors
                            ${hasUrgentAnn ? (isDark ? 'text-red-300 animate-wiggle' : 'text-red-500 animate-wiggle') : (isDark ? 'text-blue-300' : 'text-[#0052CC]')}
                            ${justRang && !hasUrgentAnn ? 'animate-wiggle' : ''}`} />
                ) : (
                    <Bell size={18} strokeWidth={2} className={`relative z-10 ${isDark ? 'text-white/45' : 'text-slate-400'}`} />
                )}
                {totalBadge > 0 && (
                    <>
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center z-20 shadow-[0_2px_8px_rgba(239,68,68,0.5)]">
                            {totalBadge > 9 ? '9+' : totalBadge}
                        </span>
                        <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full animate-ping opacity-60 z-10 bg-red-400" />
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
                        className={`absolute z-[400] origin-top-right
                            ${isDesktop ? 'right-0 top-[3.25rem] w-[380px]' : 'right-0 top-[3.25rem] w-[calc(100vw-2rem)] max-w-[380px]'}`}
                    >
                        <div className={`rounded-[1.75rem] overflow-hidden transform-gpu ${cx.panel}`}>
                            {/* Shimmer superior */}
                            <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#0052CC]/40 to-transparent animate-shimmer" style={{ animationDuration: '4s' }} />
                            </div>

                            {/* ── Header ── */}
                            <div className={`flex items-center justify-between pl-5 pr-3 pt-4 pb-3 border-b ${cx.headerBorder}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[14px] font-black tracking-tight ${cx.title}`}>Notificaciones</span>
                                    {unreadNotifs.length > 0 && (
                                        <span className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                                            {unreadNotifs.length > 99 ? '99+' : unreadNotifs.length}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-0.5">
                                    {unreadNotifs.length > 0 && !confirmClear && !pendingAll && (
                                        <button
                                            onClick={() => markAllNotificationsRead()}
                                            title="Marcar todas como leídas"
                                            className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1.5 rounded-xl transition-colors ${isDark ? 'text-blue-300 hover:bg-blue-400/10' : 'text-[#0052CC] hover:bg-blue-50'}`}
                                        >
                                            <CheckCheck size={13} strokeWidth={2.5} />
                                            Leídas
                                        </button>
                                    )}
                                    {notifications.length > 0 && !pendingAll && (
                                        confirmClear ? (
                                            <button
                                                onClick={handleClearAll}
                                                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors animate-in fade-in zoom-in-95 duration-150"
                                            >
                                                <Trash2 size={12} strokeWidth={2.5} />
                                                ¿Borrar todo?
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleClearAll}
                                                title="Borrar todas"
                                                className={`p-1.5 rounded-xl transition-colors ${isDark ? 'text-white/40 hover:text-red-300 hover:bg-red-400/10' : 'text-slate-500 hover:text-red-500 hover:bg-red-50'}`}
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
                                    <span className={`text-[12px] font-semibold ${cx.undoText}`}>
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
                                            ? (isDark ? 'bg-red-400/[0.08] border-red-300/15 hover:bg-red-400/[0.14]' : 'bg-red-50/70 border-red-100 hover:bg-red-50')
                                            : (isDark ? 'bg-blue-400/[0.06] border-blue-300/10 hover:bg-blue-400/[0.12]' : 'bg-blue-50/50 border-blue-100/60 hover:bg-blue-50')}`}
                                >
                                    <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0
                                        ${hasUrgentAnn
                                            ? (isDark ? 'bg-red-400/10 text-red-300 border-red-300/20' : 'bg-red-100 text-red-500 border-red-200')
                                            : (isDark ? 'bg-blue-400/10 text-blue-300 border-blue-300/20' : 'bg-blue-100/70 text-[#0052CC] border-blue-200/70')}`}>
                                        <Megaphone size={16} strokeWidth={2} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] font-bold leading-tight ${hasUrgentAnn ? (isDark ? 'text-red-300' : 'text-red-600') : cx.rowTitle}`}>
                                            {annUnread} aviso{annUnread > 1 ? 's' : ''} sin leer{hasUrgentAnn ? ' · URGENTE' : ''}
                                        </p>
                                        <p className={`text-[11px] font-medium mt-0.5 ${cx.rowBody}`}>Comunicados de la empresa</p>
                                    </div>
                                    <ChevronRight size={16} className={`flex-shrink-0 transition-transform group-hover/ann:translate-x-0.5 ${isDark ? 'text-white/40' : 'text-slate-500'}`} />
                                </button>
                            )}

                            {/* ── Lista ── */}
                            <div className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                {notifications.length === 0 ? (
                                    <div className="relative flex flex-col items-center justify-center py-12 px-6 text-center">
                                        <div className="absolute w-28 h-28 rounded-full bg-[#0052CC]/10 blur-2xl" />
                                        <div className={`relative w-14 h-14 rounded-[1.25rem] border shadow-[0_8px_24px_rgba(0,82,204,0.10),inset_0_1px_0_rgba(255,255,255,0.6)] flex items-center justify-center mb-4 ${cx.emptyIconBox}`}>
                                            <Bell size={22} strokeWidth={1.5} />
                                        </div>
                                        <p className={`relative text-[14px] font-bold ${cx.emptyTitle}`}>Todo al día</p>
                                        <p className={`relative text-[12px] font-medium mt-1 ${cx.emptySub}`}>Cuando algo requiera tu atención, aparecerá aquí.</p>
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
                                                            <span className={`text-[12px] font-semibold truncate pr-3 ${cx.undoText}`}>
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
                                                            ${isFlash ? (isDark ? 'bg-blue-400/[0.14]' : 'bg-blue-100/70') : unread ? cx.rowUnread : ''}`}
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
                                                                <p className={`text-[13px] leading-snug ${unread ? `font-bold ${cx.rowTitle}` : `font-semibold ${cx.rowTitleRead}`}`}>
                                                                    {n.title}
                                                                </p>
                                                                {n.body && (
                                                                    <p className={`text-[12px] font-medium leading-snug mt-0.5 line-clamp-2 ${cx.rowBody}`}>{n.body}</p>
                                                                )}
                                                                <div className="flex items-center gap-2 mt-1.5">
                                                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${cx.rowTime}`}>{timeAgo(n.created_at)}</span>
                                                                    {actionLabel && (
                                                                        <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest transition-transform group-hover:translate-x-0.5
                                                                            ${unread ? (isDark ? 'text-blue-300' : 'text-[#0052CC]') : cx.chipMuted}`}>
                                                                            {actionLabel}
                                                                            <ArrowRight size={10} strokeWidth={3} />
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {unread && <span className="w-2 h-2 rounded-full bg-[#0052CC] flex-shrink-0 mt-2 shadow-[0_0_6px_rgba(0,82,204,0.6)]" />}
                                                        </button>
                                                        {/* Borrar individual — visible al hover en desktop, siempre tenue en touch */}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); scheduleDelete([n.id]); }}
                                                            title="Borrar"
                                                            aria-label="Borrar notificación"
                                                            className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all opacity-60 lg:opacity-0 lg:group-hover:opacity-100 ${cx.iconBtn} hover:!text-red-500`}
                                                        >
                                                            <X size={13} strokeWidth={2.5} />
                                                        </button>
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
