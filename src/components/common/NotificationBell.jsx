import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, ClipboardList, Package, BarChart2, Megaphone, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ── Icono por tipo de notificación ──────────────────────────────────────────
const iconForType = (type = '') => {
    if (type.startsWith('PEDIDO'))  return Package;
    if (type.startsWith('MINMAX'))  return BarChart2;
    if (type.startsWith('REQUEST')) return ClipboardList;
    return Bell;
};

const tintForType = (type = '', metadata = {}) => {
    if (type === 'REQUEST_PENDING') return 'bg-amber-50 text-amber-600 border-amber-100';
    if (type === 'REQUEST_DECIDED') {
        return metadata?.status === 'REJECTED'
            ? 'bg-red-50 text-red-500 border-red-100'
            : 'bg-emerald-50 text-emerald-600 border-emerald-100';
    }
    if (type.startsWith('PEDIDO')) return 'bg-blue-50 text-[#0052CC] border-blue-100';
    if (type.startsWith('MINMAX')) return 'bg-violet-50 text-violet-600 border-violet-100';
    return 'bg-slate-100 text-slate-500 border-slate-200/70';
};

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

// ============================================================================
// 🔔 Campana de notificaciones (canal personal). Los AVISOS siguen viviendo
// en /my-announcements — aquí solo se muestra una fila fijada si hay sin leer.
// El feed de datos lo monta useNotificationsChannel() UNA vez en AppLayout.
// ============================================================================
const NotificationBell = ({ variant = 'desktop' }) => {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();

    const notifications = useStaff(s => s.notifications || []);
    const announcements = useStaff(s => s.announcements || []);
    const markNotificationRead = useStaff(s => s.markNotificationRead);
    const markAllNotificationsRead = useStaff(s => s.markAllNotificationsRead);

    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef(null);

    const canSeeAnnouncements = hasPermission('emp_announcements', 'can_view');

    const unreadNotifs = useMemo(() => notifications.filter(n => !n.read_at), [notifications]);

    const unreadAnnouncements = useMemo(() => {
        if (!user || !canSeeAnnouncements) return [];
        return announcements.filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            const applies =
                a.targetType === 'GLOBAL' ||
                (a.targetType === 'BRANCH' && (a.targetValue || []).includes(String(user.branchId))) ||
                (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)));
            if (!applies) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        });
    }, [announcements, user, canSeeAnnouncements]);

    const annUnread = unreadAnnouncements.length;
    const hasUrgentAnn = unreadAnnouncements.some(a => a.priority === 'URGENT');
    const totalBadge = unreadNotifs.length + annUnread;

    // Cerrar con clic fuera / Escape
    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setIsOpen(false); };
        const onKey  = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [isOpen]);

    const handleNotifClick = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        setIsOpen(false);
        if (n.link) navigate(n.link);
    };

    if (!user) return null;

    const isDesktop = variant === 'desktop';

    const bellButton = (
        <button
            onClick={() => setIsOpen(o => !o)}
            title="Notificaciones"
            className={`relative flex items-center justify-center w-11 h-11 rounded-[1.25rem] backdrop-blur-2xl border
                shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.06)]
                hover:-translate-y-0.5 hover:scale-105 active:scale-[0.97] active:translate-y-0 transition-all duration-200
                ${hasUrgentAnn
                    ? 'bg-red-50/90 border-red-300/80 hover:shadow-[0_12px_40px_rgba(239,68,68,0.3),inset_0_1px_0_rgba(255,255,255,1)]'
                    : 'bg-white/75 border-blue-200/80 hover:shadow-[0_12px_40px_rgba(0,82,204,0.22),inset_0_1px_0_rgba(255,255,255,1)]'}`}
        >
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/80 to-transparent rounded-t-[1.25rem] pointer-events-none" />
            {totalBadge > 0 ? (
                <BellRing size={18} strokeWidth={2}
                    className={`relative z-10 transition-colors ${hasUrgentAnn ? 'text-red-500 animate-[wiggle_0.4s_ease-in-out_infinite]' : 'text-[#0052CC]'}`} />
            ) : (
                <Bell size={18} strokeWidth={2} className="relative z-10 text-slate-400" />
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
    );

    return (
        <div ref={rootRef} className="relative">
            {isDesktop && totalBadge > 0 && (
                <div className={`absolute -inset-3 rounded-[2rem] blur-xl pointer-events-none ${hasUrgentAnn ? 'bg-red-500/30' : 'bg-[#0052CC]/20'}`} />
            )}
            {bellButton}

            {isOpen && (
                <div className={`absolute z-[400] animate-in fade-in slide-in-from-top-2 duration-200
                    ${isDesktop
                        ? 'right-0 top-[3.25rem] w-[380px]'
                        : 'right-0 top-[3.25rem] w-[calc(100vw-2rem)] max-w-[380px]'}`}
                >
                    <div className="rounded-[1.75rem] overflow-hidden bg-white/90 backdrop-blur-2xl border border-white/80
                        shadow-[0_24px_70px_rgba(0,0,0,0.18),0_8px_24px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">

                        {/* Header */}
                        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <span className="text-[14px] font-black text-slate-800 tracking-tight">Notificaciones</span>
                                {unreadNotifs.length > 0 && (
                                    <span className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                                        {unreadNotifs.length > 99 ? '99+' : unreadNotifs.length}
                                    </span>
                                )}
                            </div>
                            {unreadNotifs.length > 0 && (
                                <button
                                    onClick={() => markAllNotificationsRead()}
                                    className="flex items-center gap-1 text-[11px] font-bold text-[#0052CC] hover:text-[#003d99] px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                                >
                                    <CheckCheck size={13} strokeWidth={2.5} />
                                    Marcar todas
                                </button>
                            )}
                        </div>

                        {/* Fila fijada: avisos sin leer */}
                        {annUnread > 0 && (
                            <button
                                onClick={() => { setIsOpen(false); navigate('/my-announcements'); }}
                                className={`w-full flex items-center gap-3 px-5 py-3 text-left border-b transition-colors
                                    ${hasUrgentAnn ? 'bg-red-50/70 border-red-100 hover:bg-red-50' : 'bg-blue-50/50 border-blue-100/60 hover:bg-blue-50'}`}
                            >
                                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0
                                    ${hasUrgentAnn ? 'bg-red-100 text-red-500 border-red-200' : 'bg-blue-100/70 text-[#0052CC] border-blue-200/70'}`}>
                                    <Megaphone size={16} strokeWidth={2} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[13px] font-bold leading-tight ${hasUrgentAnn ? 'text-red-600' : 'text-slate-700'}`}>
                                        {annUnread} aviso{annUnread > 1 ? 's' : ''} sin leer{hasUrgentAnn ? ' · URGENTE' : ''}
                                    </p>
                                    <p className="text-[11px] font-medium text-slate-500 mt-0.5">Comunicados de la empresa</p>
                                </div>
                                <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                            </button>
                        )}

                        {/* Lista */}
                        <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain">
                            {notifications.length === 0 ? (
                                <div className="relative flex flex-col items-center justify-center py-12 px-6 text-center">
                                    <div className="absolute w-28 h-28 rounded-full bg-[#0052CC]/10 blur-2xl" />
                                    <div className="relative w-14 h-14 rounded-[1.25rem] bg-white/80 border border-white shadow-[0_8px_24px_rgba(0,82,204,0.10),inset_0_1px_0_rgba(255,255,255,1)] flex items-center justify-center mb-4">
                                        <Bell size={22} strokeWidth={1.5} className="text-[#0052CC]/50" />
                                    </div>
                                    <p className="relative text-[14px] font-bold text-slate-700">Todo al día</p>
                                    <p className="relative text-[12px] font-medium text-slate-500 mt-1">Cuando algo requiera tu atención, aparecerá aquí.</p>
                                </div>
                            ) : (
                                <div className="py-1.5">
                                    {notifications.map(n => {
                                        const Icon = iconForType(n.type);
                                        const unread = !n.read_at;
                                        return (
                                            <button
                                                key={n.id}
                                                onClick={() => handleNotifClick(n)}
                                                className={`w-full flex items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50/80
                                                    ${unread ? 'bg-blue-50/40' : ''}`}
                                            >
                                                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${tintForType(n.type, n.metadata)}`}>
                                                    <Icon size={16} strokeWidth={2} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-[13px] leading-snug ${unread ? 'font-bold text-slate-800' : 'font-semibold text-slate-600'}`}>
                                                        {n.title}
                                                    </p>
                                                    {n.body && (
                                                        <p className="text-[12px] font-medium text-slate-500 leading-snug mt-0.5 line-clamp-2">{n.body}</p>
                                                    )}
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                                                </div>
                                                {unread && <span className="w-2 h-2 rounded-full bg-[#0052CC] flex-shrink-0 mt-2 shadow-[0_0_6px_rgba(0,82,204,0.6)]" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
