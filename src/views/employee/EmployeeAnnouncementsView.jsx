import React, { useMemo, useState, memo, useRef } from 'react';
import { Bell, Globe, Building2, User, ChevronDown, ChevronUp, CheckCircle2, Flame, Clock, Search, X, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import GlassViewLayout from '../../components/GlassViewLayout';

const TABS = [
    { key: 'UNREAD', label: 'Sin Leer' },
    { key: 'READ',   label: 'Leídos'   },
    { key: 'URGENT', label: 'Urgentes' },
];

const AnnouncementCard = memo(({ ann, userId, onRead }) => {
    const [expanded, setExpanded] = useState(false);

    const isRead = (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(userId)
    );

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

    const [tab, setTab]                   = useState('UNREAD');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [searchQuery, setSearchQuery]   = useState('');
    const searchInputRef                  = useRef(null);
    const isStoreLoading = employees.length === 0 && announcements.length === 0;

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
        UNREAD: myAnnouncements.filter(a => !readCheck(a)).length,
        READ:   myAnnouncements.filter(a => readCheck(a)).length,
        URGENT: myAnnouncements.filter(a => a.priority === 'URGENT').length,
    }), [myAnnouncements, user?.id]);

    const filtered = useMemo(() => {
        let list = myAnnouncements;
        if (tab === 'UNREAD') list = list.filter(a => !readCheck(a));
        else if (tab === 'READ')   list = list.filter(a => readCheck(a));
        else if (tab === 'URGENT') list = list.filter(a => a.priority === 'URGENT');
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(a =>
                a.title?.toLowerCase().includes(q) || a.message?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [myAnnouncements, tab, user?.id, searchQuery]);

    const handleRead = (id) => {
        if (user?.id) markAnnouncementAsRead(id, user.id);
    };

    const filtersContent = (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 overflow-hidden w-max max-w-full transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchMode ? 'max-w-[600px] opacity-100 px-3 gap-2' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0'}`}>
                <Search size={16} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar avisos..."
                    className="bg-transparent border-none outline-none text-[13px] font-bold text-slate-700 w-[200px] sm:w-[280px] placeholder:text-slate-400"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="p-1 text-slate-400 hover:text-red-500 transition-all active:scale-95 shrink-0">
                        <X size={14} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={() => { setIsSearchMode(false); setSearchQuery(''); }} className="w-9 h-9 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] ml-1">
                    <ChevronRight size={16} strokeWidth={2.5} />
                </button>
            </div>
            {/* Tab mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0' : 'max-w-[600px] opacity-100 pl-2 pr-2 md:pr-3 gap-1 md:gap-1.5'}`}>
                {TABS.map(t => {
                    const isActive = tab === t.key;
                    const count = counts[t.key];
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                                isActive ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                            }`}
                        >
                            {t.label}
                            {count > 0 && (
                                <span className={`w-4 h-4 flex items-center justify-center text-[8px] font-black text-white rounded-full border-2 border-white shadow-sm ${isActive ? 'bg-slate-400' : t.key === 'UNREAD' || t.key === 'URGENT' ? 'bg-red-500' : 'bg-slate-400'}`}>
                                    {count > 9 ? '9+' : count}
                                </span>
                            )}
                        </button>
                    );
                })}
                <div className="w-px h-6 bg-slate-200/60 mx-1 shrink-0" />
                <button onClick={() => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
                    className={`relative w-9 h-9 md:w-10 md:h-10 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 active:scale-95`}>
                    <Search size={15} strokeWidth={2.5} />
                    {searchQuery && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Bell} title="Mis Avisos" filtersContent={filtersContent} transparentBody={true}>
            <div className="pb-8">
                {isStoreLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-in fade-in duration-300">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="animate-pulse bg-white/60 backdrop-blur-md border border-white/60 rounded-[2.5rem] p-6 space-y-4">
                                <div className="flex gap-2">
                                    <div className="bg-slate-200/80 rounded-full h-4 w-4" />
                                    <div className="bg-slate-200/80 rounded-md h-4 w-20" />
                                </div>
                                <div className="space-y-2">
                                    <div className="bg-slate-200/80 rounded-full h-5 w-3/4" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-full" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-2/3" />
                                </div>
                                <div className="bg-slate-200/80 rounded-full h-2 w-full" />
                                <div className="pt-3 border-t border-white/60 flex justify-between">
                                    <div className="bg-slate-200/80 rounded-full h-3 w-24" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-12" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <CheckCircle2 size={48} strokeWidth={1} className="text-emerald-300" />
                        <p className="text-[15px] font-bold text-slate-600">
                            {searchQuery ? 'Sin resultados' : tab === 'UNREAD' ? 'Todo al día' : tab === 'URGENT' ? 'Sin avisos urgentes' : 'Sin avisos'}
                        </p>
                        <p className="text-[12px] text-slate-400">
                            {searchQuery ? `No hay avisos que coincidan con "${searchQuery}".` : tab === 'UNREAD' ? 'No tienes avisos sin leer.' : 'No hay avisos en esta categoría.'}
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
                            />
                        ))}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeAnnouncementsView;
