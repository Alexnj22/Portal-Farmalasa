import React, { useMemo, useState } from 'react';
import { Bell, Globe, Building2, User, ChevronDown, ChevronUp, CheckCircle2, Flame } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';

const PRIORITY_STYLES = {
    URGENT: 'border-red-300 bg-red-50/60',
    HIGH:   'border-orange-200 bg-orange-50/40',
    NORMAL: 'border-white/60 bg-white/60',
};

const AnnouncementRow = ({ ann, userId, onRead }) => {
    const [expanded, setExpanded] = useState(false);

    const isRead = (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(userId)
    );

    const handleExpand = () => {
        setExpanded(v => !v);
        if (!isRead) onRead(ann.id);
    };

    const badgeEl = ann.targetType === 'GLOBAL'
        ? <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded-md border border-[#007AFF]/20"><Globe size={9} /> Global</span>
        : ann.targetType === 'BRANCH'
        ? <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"><Building2 size={9} /> Sucursal</span>
        : <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-200"><User size={9} /> Personal</span>;

    return (
        <div className={`rounded-[1.75rem] border backdrop-blur-xl shadow-sm transition-all ${PRIORITY_STYLES[ann.priority] || PRIORITY_STYLES.NORMAL}`}>
            <button className="w-full p-4 flex items-start gap-3 text-left" onClick={handleExpand}>
                <div className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${isRead ? 'bg-slate-300' : 'bg-[#007AFF]'}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        {badgeEl}
                        {ann.priority === 'URGENT' && (
                            <span className="flex items-center gap-1 text-[9px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-md border border-red-200">
                                <Flame size={9} /> Urgente
                            </span>
                        )}
                    </div>
                    <p className={`text-[13px] font-black leading-tight ${isRead ? 'text-slate-500' : 'text-slate-800'}`}>{ann.title}</p>
                    {!expanded && (
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{ann.message}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                        {new Date(ann.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                </div>
                {expanded
                    ? <ChevronUp size={15} className="text-slate-400 flex-shrink-0 mt-1" />
                    : <ChevronDown size={15} className="text-slate-400 flex-shrink-0 mt-1" />
                }
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 duration-200">
                    <div className="bg-white/70 rounded-[1.25rem] border border-white/80 p-3">
                        <p className="text-[13px] text-slate-700 leading-relaxed">{ann.message}</p>
                    </div>
                    {isRead && (
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-2 px-1">
                            <CheckCircle2 size={11} className="text-emerald-500" /> Leído
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

const EmployeeAnnouncementsView = () => {
    const { user } = useAuth();
    const announcements = useStaffStore(s => s.announcements);
    const markAnnouncementAsRead = useStaffStore(s => s.markAnnouncementAsRead);

    const myAnnouncements = useMemo(() => {
        if (!user) return [];
        return (announcements || []).filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            return (
                a.targetType === 'GLOBAL' ||
                (a.targetType === 'BRANCH' && (a.targetValue || []).includes(String(user.branchId))) ||
                (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)))
            );
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [announcements, user]);

    const unreadCount = useMemo(() =>
        myAnnouncements.filter(a =>
            !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user?.id)
            )
        ).length
    , [myAnnouncements, user]);

    const handleRead = (id) => {
        if (user?.id) markAnnouncementAsRead(id, user.id);
    };

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-black text-slate-800 flex items-center gap-2">
                    <Bell size={18} className="text-[#007AFF]" strokeWidth={2.5} />
                    Avisos
                </h2>
                {unreadCount > 0 && (
                    <span className="text-[10px] font-black text-white bg-red-500 px-2.5 py-1 rounded-full">
                        {unreadCount} sin leer
                    </span>
                )}
            </div>

            {myAnnouncements.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-3 text-slate-400">
                    <CheckCircle2 size={44} strokeWidth={1} className="text-emerald-300" />
                    <p className="text-[14px] font-bold text-slate-600">Sin avisos nuevos</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {myAnnouncements.map(ann => (
                        <AnnouncementRow key={ann.id} ann={ann} userId={user?.id} onRead={handleRead} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default EmployeeAnnouncementsView;
