import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Calendar, ClipboardList, Bell, User, LogOut, Building2 } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';

const NAV_ITEMS = [
    { id: 'home',          label: 'Inicio',      icon: Home },
    { id: 'schedule',      label: 'Horario',     icon: Calendar },
    { id: 'requests',      label: 'Solicitudes', icon: ClipboardList },
    { id: 'announcements', label: 'Avisos',      icon: Bell },
    { id: 'profile',       label: 'Perfil',      icon: User },
];

const EmployeeLayout = ({ user, handleLogout, children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const announcements = useStaffStore(s => s.announcements);
    const branches = useStaffStore(s => s.branches);

    const active = location.pathname.split('/')[1] || 'home';

    const branch = branches.find(b => String(b.id) === String(user?.branchId));

    const unreadCount = useMemo(() => {
        if (!user) return 0;
        return (announcements || []).filter(a => {
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
        }).length;
    }, [announcements, user]);

    return (
        <div className="flex flex-col h-full w-full">
            {/* ── Header ── */}
            <header className="flex-shrink-0 z-40 px-4 pt-3 pb-2">
                <div className="flex items-center justify-between bg-white/70 backdrop-blur-2xl border border-white/60 rounded-[1.5rem] px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center gap-3">
                        <div className="relative w-10 h-10 rounded-full overflow-hidden bg-slate-100 border-2 border-white shadow-sm flex-shrink-0">
                            {user?.photo ? (
                                <img src={user.photo} className="w-full h-full object-cover" alt="Avatar" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-400 font-black text-sm">
                                    {user?.name?.charAt(0)}
                                </div>
                            )}
                        </div>
                        <div>
                            <p className="text-[13px] font-black text-slate-800 leading-tight">{user?.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                <Building2 size={9} /> {branch?.name || user?.role || 'Empleado'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2.5 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-100 text-slate-400 hover:text-red-500 transition-all active:scale-95"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </header>

            {/* ── Contenido ── */}
            <main className="flex-1 overflow-y-auto pb-24">
                {children}
            </main>

            {/* ── Nav inferior ── */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4">
                <div className="flex items-center justify-around bg-white/80 backdrop-blur-2xl border border-white/60 rounded-[1.75rem] shadow-[0_-4px_30px_rgba(0,0,0,0.06)] px-2 py-2">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                        const isActive = active === id;
                        return (
                            <button
                                key={id}
                                onClick={() => navigate(`/${id}`)}
                                className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-[1.25rem] transition-all duration-200 flex-1 ${
                                    isActive ? 'bg-[#007AFF]/10' : 'hover:bg-slate-100/60'
                                }`}
                            >
                                <div className="relative">
                                    <Icon
                                        size={20}
                                        strokeWidth={isActive ? 2.5 : 1.8}
                                        className={isActive ? 'text-[#007AFF]' : 'text-slate-400'}
                                    />
                                    {id === 'announcements' && unreadCount > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${isActive ? 'text-[#007AFF]' : 'text-slate-400'}`}>
                                    {label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
};

export default EmployeeLayout;
