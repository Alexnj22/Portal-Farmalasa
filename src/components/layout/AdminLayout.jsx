import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Monitor, Calendar,
    Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Sparkles, Activity,
    Copy, CheckCircle2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getHourlyCode } from '../../utils/helpers';
import { useStaffStore as useStaff } from '../../store/staffStore';

const AdminLayout = ({ children, view, setView, isOverlayActive = false, handleLogout }) => {
    const { user } = useAuth();
    const branches = useStaff(state => state.branches);

    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [authPin, setAuthPin] = useState(getHourlyCode());

    // Estado para animación de Copy
    const [isCopied, setIsCopied] = useState(false);

    const navRef = useRef(null);
    const itemRefs = useRef(new Map());

    const [pill, setPill] = useState({ top: 0, height: 44, show: false });
    const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

    const hasBranchAlerts = useMemo(() => {
        return branches.some(branch => {
            if (!branch.address || (!branch.phone && !branch.cell)) return true;
            if (branch.propertyType === 'RENTED') {
                const endStr = branch.rent?.contract?.endDate;
                if (!endStr) return true;
                const diffTime = Math.ceil((new Date(endStr) - new Date()) / (1000 * 60 * 60 * 24));
                if (diffTime <= 30) return true;
            }
            return false;
        });
    }, [branches]);

    useEffect(() => {
        const timer = setInterval(() => setAuthPin(getHourlyCode()), 10000);
        return () => clearInterval(timer);
    }, []);

    const handleCopyPin = () => {
        navigator.clipboard.writeText(authPin);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const menuItems = useMemo(
        () => [
            { id: 'dashboard', label: 'Personal', icon: User },
            { id: 'monitor', label: 'Monitor Real-Time', icon: Monitor },
            { id: 'audit', label: 'Auditoría de Tiempos', icon: AlertTriangle },
            { id: 'schedules', label: 'Horarios y Turnos', icon: Calendar },
            { id: 'branches', label: 'Gestión de Sucursales', icon: Building2 },
            { id: 'roles', label: 'Cargos / Organigrama', icon: ShieldCheck },
            { id: 'announcements', label: 'Avisos', icon: Megaphone },
            { id: 'auditview', label: 'Auditoría', icon: Activity },
        ],
        []
    );

    const blurClasses = isOverlayActive
        ? 'pointer-events-none select-none scale-[0.98] blur-[2px]'
        : 'scale-100 blur-0';

    const recomputePill = () => {
        const navEl = navRef.current;
        const activeEl = itemRefs.current.get(view);

        if (!navEl || !activeEl) {
            setPill((prev) => (prev.show ? prev : lastGoodPillRef.current));
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
    }, [view]);

    useLayoutEffect(() => {
        const r1 = requestAnimationFrame(recomputePill);
        const r2 = requestAnimationFrame(() => requestAnimationFrame(recomputePill));
        const t = setTimeout(recomputePill, 520);
        return () => {
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2);
            clearTimeout(t);
        };
    }, [isSidebarOpen]);

    useEffect(() => {
        const navEl = navRef.current;
        if (!navEl) return;
        const ro = new ResizeObserver(() => recomputePill());
        ro.observe(navEl);
        const onWinResize = () => recomputePill();
        window.addEventListener('resize', onWinResize);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', onWinResize);
        };
    }, []);

    return (
        <div className="flex h-screen bg-transparent font-sans overflow-hidden relative">
            {/* SIDEBAR */}
            <aside className={`${isSidebarOpen ? 'w-[19rem]' : 'w-[5.5rem]'} transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] flex flex-col z-30 relative shrink-0 ml-2 my-2 ${blurClasses}`}>

                <div className="absolute inset-y-0 left-0 right-0 -z-10 pointer-events-none">
                    <div className="absolute -inset-4 rounded-[2.6rem] bg-[#0A2A5E]/30 blur-2xl opacity-55" />
                    <div className="absolute -inset-6 rounded-[3.2rem] bg-[#061F49]/25 blur-3xl opacity-35" />
                    <div className="absolute -inset-8 rounded-[3.6rem] bg-black/20 blur-3xl opacity-25" />
                </div>

                <div className={['absolute inset-0', 'rounded-[2.5rem] overflow-hidden flex flex-col', 'border border-white/10', 'bg-gradient-to-b from-[#0A2A5E] via-[#061F49] to-[#041636]', 'shadow-[0_30px_90px_rgba(0,0,0,0.40),0_14px_34px_rgba(0,0,0,0.22)]', 'transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]'].join(' ')}>

                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-white/18 via-white/6 to-transparent opacity-80" />

                    {/* HEADER SIDEBAR (Icono de cierre elegante) */}
                    <div className={['p-6 pb-4 border-b border-white/10 relative', isSidebarOpen ? 'flex items-center justify-between' : 'flex items-center justify-center'].join(' ')}>

                        <div className="flex items-center gap-4">
                            <div className="bg-gradient-to-tr from-[#1D7AFC] to-[#5856D6] p-2.5 rounded-[1.25rem] shadow-[0_14px_30px_rgba(29,122,252,0.35)] flex-shrink-0 relative group cursor-pointer">
                                <Building2 className="text-white" size={24} strokeWidth={1.5} />
                                <Sparkles size={12} className="absolute -top-1 -right-1 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>

                            {isSidebarOpen && (
                                <div className="animate-in fade-in zoom-in-95 duration-300 origin-left overflow-hidden">
                                    <h1 className="text-white font-bold text-[16px] leading-tight tracking-tight whitespace-nowrap">Portal</h1>
                                    <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.15em] whitespace-nowrap">La Salud & La Popular</p>
                                </div>
                            )}
                        </div>

                        {/* Botón de cierre estético */}
                        {isSidebarOpen && (
                            <button
                                onClick={() => setIsSidebarOpen(false)}
                                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all active:scale-95 border border-white/5"
                                title="Ocultar menú"
                            >
                                <ChevronLeft size={18} strokeWidth={2} />
                            </button>
                        )}
                    </div>

                    <nav ref={navRef} className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto scrollbar-hide relative">
                        <div className={['absolute left-4 right-4', 'rounded-[1rem]', 'bg-white/10 border border-white/10', 'shadow-[0_10px_24px_rgba(0,0,0,0.25)]', 'backdrop-blur-md', 'transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]', pill.show ? 'opacity-100' : 'opacity-0'].join(' ')} style={{ top: pill.top, height: pill.height }}>
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-[#1D7AFC]/15 via-transparent to-transparent rounded-[1rem]" />
                        </div>

                        {menuItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = view === item.id;
                            const showItemAlert = item.id === 'branches' && hasBranchAlerts;

                            return (
                                <button key={item.id} ref={(el) => { if (el) itemRefs.current.set(item.id, el); else itemRefs.current.delete(item.id); }} onClick={() => setView(item.id)} type="button" className={['w-full flex items-center gap-3 px-4 py-3.5 rounded-[1rem]', 'transition-all duration-300 group relative overflow-hidden', 'text-left', isActive ? 'text-white' : 'text-white/75 hover:text-white', 'hover:bg-white/[0.06]', 'active:scale-[0.99]'].join(' ')}>
                                    <div className="relative z-10 flex-shrink-0">
                                        <Icon size={20} strokeWidth={isActive ? 2 : 1.5} className={`transition-colors duration-300 ${isActive ? 'text-[#1D7AFC]' : 'text-white/65 group-hover:text-white'}`} />
                                        {!isSidebarOpen && showItemAlert && (
                                            <span className="absolute -top-1 -right-1 flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>
                                        )}
                                    </div>

                                    {isSidebarOpen && (
                                        <>
                                            <span className={`text-[14px] flex-1 whitespace-nowrap relative z-10 ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                                            {showItemAlert && (
                                                <span className="relative z-10 flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span></span>
                                            )}
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="p-4 border-t border-white/10 bg-black/10 relative flex flex-col gap-3">
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

                        {/* PIN EXPANDIDO */}
                        {isSidebarOpen && (
                            <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between animate-in fade-in duration-500">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></span>
                                    </span>
                                    <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">En Línea</span>
                                </div>

                                <div className="h-4 w-px bg-white/10"></div>

                                <button onClick={handleCopyPin} className="flex items-center gap-2 group/pin cursor-pointer outline-none relative" title="Copiar PIN">
                                    <ShieldCheck size={14} className="text-[#1D7AFC]" strokeWidth={2} />
                                    <div className="relative w-12 flex items-center justify-center">
                                        <span className={`absolute text-[13px] font-black text-white tracking-widest font-mono transition-all duration-300 ${isCopied ? 'opacity-0 scale-50' : 'opacity-100 scale-100 group-hover/pin:opacity-0 group-hover/pin:scale-90'}`}>{authPin}</span>
                                        <Copy size={14} className={`absolute text-white/80 transition-all duration-300 ${isCopied ? 'opacity-0 scale-50' : 'opacity-0 scale-90 group-hover/pin:opacity-100 group-hover/pin:scale-100'}`} />
                                        <CheckCircle2 size={15} className={`absolute text-emerald-400 transition-all duration-300 ${isCopied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                                    </div>
                                </button>
                            </div>
                        )}

                        {/* PERFIL */}
                        {isSidebarOpen ? (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setView('profile')} className="flex-1 flex items-center gap-3 hover:bg-white/10 p-2 -m-2 rounded-[1rem] transition-all duration-300 text-left group active:scale-[0.98]" title="Ver mi perfil" type="button">
                                    <div className="h-10 w-10 rounded-[1rem] bg-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.20)] border border-white/10 flex items-center justify-center text-white/70 overflow-hidden flex-shrink-0 group-hover:border-[#1D7AFC]/30 transition-colors">
                                        {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="Foto" /> : <User size={20} strokeWidth={1.5} />}
                                    </div>
                                    <div className="flex-1 overflow-hidden transition-all duration-300">
                                        <p className="text-[13px] font-semibold text-white truncate group-hover:text-[#9CC7FF] transition-colors">{user?.name || 'Administrador'}</p>
                                        <p className="text-[10px] text-white/60 uppercase font-bold tracking-widest truncate">{user?.role || user?.userType || 'Sistema'}</p>
                                    </div>
                                </button>
                                <button onClick={handleLogout} className="p-2.5 text-white/60 hover:text-red-300 hover:bg-red-500/10 rounded-[1rem] transition-all flex-shrink-0" title="Cerrar Sesión" type="button">
                                    <LogOut size={18} strokeWidth={1.5} />
                                </button>
                            </div>
                        ) : (
                            /* MENU COMPACTO (Cerrado) */
                            <div className="flex flex-col items-center gap-4 py-2 animate-in fade-in duration-500">

                                <button onClick={() => setIsSidebarOpen(true)} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all active:scale-95 mb-2 border border-white/5" title="Mostrar menú">
                                    <ChevronRight size={18} strokeWidth={2} />
                                </button>

                                {/* PIN COMPACTO (Hover muestra el código) */}
                                <button onClick={handleCopyPin} className="relative w-11 h-11 rounded-[1.25rem] bg-white/5 border border-white/10 shadow-sm hover:bg-white/15 transition-all active:scale-95 flex items-center justify-center text-[#1D7AFC] group overflow-hidden" title="Ver / Copiar PIN">
                                    {isCopied ? (
                                        <CheckCircle2 size={18} className="text-emerald-400" />
                                    ) : (
                                        <>
                                            <ShieldCheck size={18} className="transition-all duration-300 group-hover:opacity-0 group-hover:scale-50 absolute" />
                                            <span className="absolute opacity-0 scale-150 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 font-mono text-[11px] font-black text-white">
                                                {authPin}
                                            </span>
                                        </>
                                    )}
                                    {!isCopied && (
                                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2 group-hover:hidden transition-opacity duration-300">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"></span>
                                        </span>
                                    )}
                                </button>

                                <button onClick={() => setView('profile')} type="button" title="Perfil" className="w-11 h-11 rounded-[1.25rem] bg-white/10 border border-white/10 shadow-[0_12px_28px_rgba(0,0,0,0.22)] hover:bg-white/15 hover:border-white/15 transition-all active:scale-[0.98] flex items-center justify-center text-white/75">
                                    {user?.photo ? <img src={user.photo} className="w-full h-full object-cover rounded-[1.25rem]" alt="Foto" /> : <User size={18} strokeWidth={1.5} />}
                                </button>

                                <button onClick={handleLogout} type="button" title="Cerrar Sesión" className="w-11 h-11 rounded-[1.25rem] bg-red-500/10 border border-white/10 shadow-[0_12px_28px_rgba(0,0,0,0.22)] hover:bg-red-500/15 hover:border-white/15 transition-all active:scale-[0.98] flex items-center justify-center text-red-200">
                                    <LogOut size={16} strokeWidth={1.6} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>
            <main className={`flex-1 flex flex-col overflow-hidden relative z-20 pt-2 pb-4 pr-2 transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${blurClasses}`}>
                <div className="flex-1 overflow-hidden relative bg-transparent rounded-[2.5rem]">
                    <div key={view} className="h-full w-full animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] fill-mode-both">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;