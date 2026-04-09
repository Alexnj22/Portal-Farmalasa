import React, { useMemo, useState, memo } from 'react';
import { Bell, Globe, Building2, User, ChevronDown, ChevronUp, CheckCircle2, Flame, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import GlassViewLayout from '../../components/GlassViewLayout';

const TABS = [
    { key: 'ALL',    label: 'Todos'    },
    { key: 'UNREAD', label: 'Sin Leer' },
    { key: 'READ',   label: 'Leídos'   },
    { key: 'URGENT', label: 'Urgentes' },
];

const AnnouncementCard = memo(({ ann, userId, onRead, employees }) => {
    const [expanded, setExpanded] = useState(false);

    const isRead = (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(userId)
    );

    const readIds = (ann.readBy || []).map(r =>
        String(typeof r === 'object' ? r.employeeId : r)
    );
    const totalExpected = (() => {
        if (ann.targetType === 'GLOBAL')
            return (employees || []).filter(e => e.status === 'ACTIVO').length;
        if (ann.targetType === 'BRANCH') {
            const bids = (ann.targetValue || []).map(String);
            return (employees || []).filter(e =>
                e.status === 'ACTIVO' && bids.includes(String(e.branch_id || e.branchId))
            ).length;
        }
        if (ann.targetType === 'EMPLOYEE') return (ann.targetValue || []).length;
        return 1;
    })();
    const readPercentage = totalExpected > 0
        ? Math.round((readIds.length / totalExpected) * 100) : 0;

    const handleClick = () => {
        setExpanded(v => !v);
        if (!isRead) onRead(ann.id);
    };

    const isUrgent = ann.priority === 'URGENT';

    const badgeEl = ann.targetType === 'GLOBAL'
        ? <span className="flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20"><Globe size={11} strokeWidth={2} /> Global</span>
        : ann.targetType === 'BRANCH'
        ? <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-emerald-200/50"><Building2 size={11} strokeWidth={2} /> Sucursal</span>
        : <span className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-orange-200/50"><User size={11} strokeWidth={2} /> Personal</span>;

    return (
        <div
            className={`p-6 rounded-[2.5rem] border flex flex-col gap-4 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu cursor-pointer hover:-translate-y-1 ${
                isUrgent
                    ? 'border-red-300 shadow-[0_8px_30px_rgba(239,68,68,0.12)] hover:shadow-[0_12px_40px_rgba(239,68,68,0.2)] bg-white/90 backdrop-blur-xl'
                    : isRead
                    ? 'border-white/40 opacity-80 hover:opacity-100 shadow-sm bg-white/40 backdrop-blur-md hover:shadow-md'
                    : 'border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] bg-white/60 backdrop-blur-2xl'
            }`}
            onClick={handleClick}
        >
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRead ? 'bg-slate-300' : isUrgent ? 'bg-red-500' : 'bg-[#007AFF]'}`} />
                {isUrgent && (
                    <span className="flex items-center gap-1 text-white bg-red-500 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest shadow-sm shadow-red-500/30 animate-pulse">
                        <Flame size={11} strokeWidth={2.5} /> Urgente
                    </span>
                )}
                {badgeEl}
            </div>

            {/* Title + message */}
            <div>
                <h4 className={`font-black text-[16px] leading-tight mb-1.5 tracking-tight ${isRead ? 'text-slate-500' : 'text-slate-800'}`}>
                    {ann.title}
                </h4>
                <p className={`text-[13px] leading-relaxed font-medium ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'} ${isRead ? 'text-slate-400' : 'text-slate-600'}`}>
                    {ann.message}
                </p>
            </div>

            {/* Read progress bar */}
            <div className="space-y-1.5">
                <div className={`flex justify-between text-[10px] font-bold uppercase tracking-widest ${isUrgent ? 'text-red-400' : 'text-slate-400'}`}>
                    <span>Progreso de lectura</span>
                    <span className={readPercentage === 100 ? 'text-emerald-500' : isUrgent && readPercentage < 100 ? 'text-red-500' : 'text-[#007AFF]'}>
                        {readPercentage}%
                    </span>
                </div>
                <div className={`w-full rounded-full h-2 overflow-hidden border ${isUrgent ? 'bg-red-50/50 border-red-200/50' : 'bg-white/50 border-white/60'}`}>
                    <div
                        className={`h-full rounded-full transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] ${readPercentage === 100 ? 'bg-emerald-500' : isUrgent ? 'bg-red-500' : 'bg-[#007AFF]'}`}
                        style={{ width: `${readPercentage}%` }}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-white/60">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Clock size={11} />
                    {new Date(ann.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex items-center gap-2">
                    {isRead && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <CheckCircle2 size={10} strokeWidth={2.5} /> Leído
                        </span>
                    )}
                    {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>
            </div>
        </div>
    );
});

const EmployeeAnnouncementsView = () => {
    const { user } = useAuth();
    const announcements = useStaffStore(s => s.announcements);
    const employees     = useStaffStore(s => s.employees);
    const markAnnouncementAsRead = useStaffStore(s => s.markAnnouncementAsRead);

    const [tab, setTab] = useState('ALL');

    const readCheck = (ann) => (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(user?.id)
    );

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
        }).sort((a, b) => {
            if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
            if (b.priority === 'URGENT' && a.priority !== 'URGENT') return 1;
            return new Date(b.date) - new Date(a.date);
        });
    }, [announcements, user]);

    const counts = useMemo(() => ({
        ALL:    myAnnouncements.length,
        UNREAD: myAnnouncements.filter(a => !readCheck(a)).length,
        READ:   myAnnouncements.filter(a => readCheck(a)).length,
        URGENT: myAnnouncements.filter(a => a.priority === 'URGENT').length,
    }), [myAnnouncements, user?.id]);

    const filtered = useMemo(() => {
        if (tab === 'UNREAD') return myAnnouncements.filter(a => !readCheck(a));
        if (tab === 'READ')   return myAnnouncements.filter(a => readCheck(a));
        if (tab === 'URGENT') return myAnnouncements.filter(a => a.priority === 'URGENT');
        return myAnnouncements;
    }, [myAnnouncements, tab, user?.id]);

    const handleRead = (id) => {
        if (user?.id) markAnnouncementAsRead(id, user.id);
    };

    const filtersContent = (
        <div className="flex items-center bg-white/70 backdrop-blur-md border border-white/80 rounded-[1.5rem] p-1 shadow-sm gap-1">
            {TABS.map(t => (
                <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`relative px-3 py-1.5 rounded-[1.2rem] text-[12px] font-bold transition-all duration-200 flex items-center gap-1.5 ${
                        tab === t.key ? 'bg-[#007AFF] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                    }`}
                >
                    {t.label}
                    {counts[t.key] > 0 && (
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                            tab === t.key ? 'bg-white/30 text-white'
                            : t.key === 'UNREAD' || t.key === 'URGENT' ? 'bg-red-100 text-red-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                            {counts[t.key]}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );

    return (
        <GlassViewLayout icon={Bell} title="Mis Avisos" filtersContent={filtersContent}>
            <div className="pt-32 md:pt-28 px-4 md:px-6 pb-8">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <CheckCircle2 size={48} strokeWidth={1} className="text-emerald-300" />
                        <p className="text-[15px] font-bold text-slate-600">
                            {tab === 'UNREAD' ? 'Todo al día' : tab === 'URGENT' ? 'Sin avisos urgentes' : 'Sin avisos'}
                        </p>
                        <p className="text-[12px] text-slate-400">
                            {tab === 'UNREAD' ? 'No tienes avisos sin leer.' : 'No hay avisos en esta categoría.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {filtered.map(ann => (
                            <AnnouncementCard
                                key={ann.id}
                                ann={ann}
                                userId={user?.id}
                                onRead={handleRead}
                                employees={employees}
                            />
                        ))}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeAnnouncementsView;
