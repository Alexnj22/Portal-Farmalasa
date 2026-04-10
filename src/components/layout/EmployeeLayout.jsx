import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, ClipboardList, Bell, User, LogOut, Building2, Sparkles } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';

const NAV_ITEMS = [
    { id: 'home',          label: 'Inicio',       icon: Home },
    { id: 'requests',      label: 'Solicitudes',  icon: ClipboardList },
    { id: 'announcements', label: 'Avisos',        icon: Bell },
    { id: 'profile',       label: 'Mi Perfil',    icon: User },
];

const EmployeeLayout = ({ user, handleLogout, children, isOverlayActive = false }) => {
    const blurClasses = isOverlayActive ? 'pointer-events-none select-none scale-[0.98] blur-[2px]' : 'scale-100 blur-0';
    const navigate = useNavigate();
    const location = useLocation();
    const announcements = useStaffStore(s => s.announcements);
    const branches = useStaffStore(s => s.branches);

    const [isMobile, setIsMobile] = useState(false);
    const navRef = useRef(null);
    const itemRefs = useRef(new Map());
    const [pill, setPill] = useState({ top: 0, height: 44, show: false });
    const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

    const active = location.pathname.split('/')[1] || 'home';
    const branch = branches.find(b => String(b.id) === String(user?.branchId));

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 1024);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    const recomputePill = () => {
        const navEl = navRef.current;
        const activeEl = itemRefs.current.get(active);
        if (!navEl || !activeEl) {
            setPill(prev => prev.show ? prev : lastGoodPillRef.current);
            return;
        }
        const navRect = navEl.getBoundingClientRect();
        const actRect = activeEl.getBoundingClientRect();
        const top = Math.max(0, actRect.top - navRect.top);
        const height = Math.max(40, actRect.height);
        const next = { top, height, show: true };
        lastGoodPillRef.current = next;
        setPill(next);
    };

    useLayoutEffect(() => {
        const raf = requestAnimationFrame(recomputePill);
        return () => cancelAnimationFrame(raf);
    }, [active]);

    useLayoutEffect(() => {
        const r1 = requestAnimationFrame(recomputePill);
        const t = setTimeout(recomputePill, 300);
        return () => { cancelAnimationFrame(r1); clearTimeout(t); };
    }, [isMobile]);

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
        <div className="flex w-full h-full bg-[#F2F2F7] lg:bg-transparent font-sans overflow-hidden relative">

            {/* ── Sidebar Desktop ── */}
            <aside className={`hidden lg:flex flex-col shrink-0 w-[15.5rem] my-2 ml-2 relative transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${blurClasses}`}>
                {/* Glow layers */}
                <div className="absolute inset-y-0 left-0 -z-10 w-full pointer-events-none">
                    <div className="absolute -inset-4 rounded-[2.6rem] bg-[#0A2A5E]/30 blur-2xl opacity-55" />
                    <div className="absolute -inset-6 rounded-[3.2rem] bg-[#061F49]/25 blur-3xl opacity-35" />
                </div>

                {/* Panel */}
                <div className="flex-1 rounded-[2.5rem] overflow-hidden flex flex-col border border-white/10 bg-gradient-to-b from-[#0A2A5E] via-[#061F49] to-[#041636] shadow-[0_30px_90px_rgba(0,0,0,0.4)]">
                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                    {/* Logo */}
                    <div className="p-6 pb-4 border-b border-white/10 flex items-center gap-4">
                        <div className="bg-gradient-to-tr from-[#1D7AFC] to-[#5856D6] p-2.5 rounded-[1.25rem] shadow-[0_14px_30px_rgba(29,122,252,0.35)] flex-shrink-0 relative group hover:scale-105 transition-all">
                            <Building2 className="text-white" size={22} strokeWidth={1.5} />
                            <Sparkles size={12} className="absolute -top-1 -right-1 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div>
                            <h1 className="text-white font-bold text-[15px] leading-tight tracking-tight">Portal</h1>
                            <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.15em]">La Salud & La Popular</p>
                        </div>
                    </div>

                    {/* Nav */}
                    <nav ref={navRef} className="flex-1 px-4 py-5 space-y-1 overflow-y-auto relative">
                        <div
                            className={`absolute left-4 right-4 rounded-[1rem] bg-white/10 border border-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.25)] backdrop-blur-md transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] pointer-events-none ${pill.show ? 'opacity-100' : 'opacity-0'}`}
                            style={{ top: pill.top, height: pill.height, position: 'absolute' }}
                        >
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-[#1D7AFC]/15 via-transparent to-transparent rounded-[1rem]" />
                        </div>

                        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                            const isActive = active === id;
                            return (
                                <button
                                    key={id}
                                    ref={el => { if (el) itemRefs.current.set(id, el); else itemRefs.current.delete(id); }}
                                    onClick={() => navigate(`/${id}`)}
                                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[1rem] transition-all duration-300 relative text-left ${isActive ? 'text-white' : 'text-white/75 hover:text-white hover:translate-x-1 hover:bg-white/[0.08]'} active:scale-[0.99]`}
                                >
                                    <div className="relative z-10 flex-shrink-0">
                                        <Icon size={20} strokeWidth={isActive ? 2 : 1.5} className={`transition-all duration-300 ${isActive ? 'text-[#1D7AFC] scale-110' : 'text-white/65'}`} />
                                        {id === 'announcements' && unreadCount > 0 && (
                                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center z-20">
                                                {unreadCount > 9 ? '9+' : unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`text-[14px] flex-1 whitespace-nowrap relative z-10 transition-colors ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* Footer usuario */}
                    <div className="p-4 border-t border-white/10 bg-black/10 relative">
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                        <div className="flex items-center gap-2">
                            <button onClick={() => navigate('/profile')} className="flex-1 flex items-center gap-3 hover:bg-white/10 p-2 -m-2 rounded-[1rem] transition-all duration-300 text-left group active:scale-[0.98]">
                                <div className="h-10 w-10 rounded-[1rem] bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0 group-hover:border-[#1D7AFC]/50 transition-all">
                                    {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} strokeWidth={1.5} className="text-white/70" />}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-[13px] font-semibold text-white truncate group-hover:text-[#9CC7FF] transition-colors">{user?.name}</p>
                                    <p className="text-[10px] text-white/60 uppercase font-bold tracking-widest truncate">{branch?.name || user?.role || 'Empleado'}</p>
                                </div>
                            </button>
                            <button onClick={handleLogout} className="p-2.5 text-white/60 hover:text-red-300 hover:bg-red-500/20 rounded-[1rem] transition-all flex-shrink-0 hover:scale-105 active:scale-95" title="Cerrar Sesión">
                                <LogOut size={18} strokeWidth={1.5} />
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ── Contenido principal ── */}
            <main className={`flex-1 flex flex-col overflow-hidden relative z-20 transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${blurClasses}`}>
                {/* Header móvil */}
                <div className="lg:hidden px-4 pt-3 pb-2 shrink-0">
                    <div className="flex items-center justify-between bg-white/70 backdrop-blur-2xl border border-white/60 rounded-[1.5rem] px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full overflow-hidden bg-slate-100 border-2 border-white shadow-sm flex-shrink-0">
                                {user?.photo
                                    ? <img src={user.photo} className="w-full h-full object-cover" alt="" />
                                    : <div className="w-full h-full flex items-center justify-center text-slate-400 font-black text-sm">{user?.name?.charAt(0)}</div>
                                }
                            </div>
                            <div>
                                <p className="text-[13px] font-black text-slate-800 leading-tight">{user?.name?.split(' ')[0]}</p>
                                <p className="text-[10px] font-bold text-slate-400">{branch?.name || user?.role || 'Empleado'}</p>
                            </div>
                        </div>
                        <button onClick={handleLogout} className="p-2.5 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-100 text-slate-400 hover:text-red-500 transition-all active:scale-95">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>

                {/* Área de contenido */}
                <div className="flex-1 overflow-y-auto pb-20 lg:pb-4 lg:pr-2 lg:pt-2">
                    <div key={active} className="h-full w-full animate-in fade-in duration-300">
                        {children}
                    </div>
                </div>
            </main>

            {/* ── Nav inferior móvil ── */}
            <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${blurClasses}`}>
                <div className="flex items-center justify-around bg-white/80 backdrop-blur-2xl border border-white/60 rounded-[1.75rem] shadow-[0_-4px_30px_rgba(0,0,0,0.06)] px-2 py-2">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                        const isActive = active === id;
                        return (
                            <button key={id} onClick={() => navigate(`/${id}`)} className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-[1.25rem] transition-all duration-200 flex-1 ${isActive ? 'bg-[#007AFF]/10' : 'hover:bg-slate-100/60'}`}>
                                <div className="relative">
                                    <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} className={isActive ? 'text-[#007AFF]' : 'text-slate-400'} />
                                    {id === 'announcements' && unreadCount > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${isActive ? 'text-[#007AFF]' : 'text-slate-400'}`}>{label}</span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
};

export default EmployeeLayout;
