import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Monitor, Calendar,
  Building2, ShieldCheck, LogOut, Menu, X,
  User, Megaphone, AlertTriangle, Sparkles
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getHourlyCode } from '../../utils/helpers';

const AdminLayout = ({ children, view, setView, isOverlayActive = false }) => {
  const { user, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [authPin, setAuthPin] = useState(getHourlyCode());

  // ✅ refs para píldora animada (SIEMPRE basada en `view`, nunca hover)
  const navRef = useRef(null);
  const itemRefs = useRef(new Map());

  // ✅ guardamos última posición válida para NO “brincar”
  const [pill, setPill] = useState({ top: 0, height: 44, show: false });
  const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

  useEffect(() => {
    const timer = setInterval(() => setAuthPin(getHourlyCode()), 10000);
    return () => clearInterval(timer);
  }, []);

  const menuItems = useMemo(
    () => [
      { id: 'monitor', label: 'Monitor Real-Time', icon: Monitor },
      { id: 'dashboard', label: 'Panel de Control', icon: LayoutDashboard },
      { id: 'audit', label: 'Auditoría de Tiempos', icon: AlertTriangle },
      { id: 'schedules', label: 'Horarios y Turnos', icon: Calendar },
      { id: 'branches', label: 'Gestión de Sucursales', icon: Building2 },
      { id: 'roles', label: 'Cargos', icon: ShieldCheck },
      { id: 'announcements', label: 'Avisos', icon: Megaphone },
    ],
    []
  );

  const blurClasses = isOverlayActive
    ? 'opacity-40 saturate-[0.85] brightness-[0.92] pointer-events-none select-none scale-[0.995]'
    : 'opacity-100 saturate-100 brightness-100 scale-100';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen bg-transparent font-sans overflow-hidden relative">
      {/* SIDEBAR */}
      <aside
        className={`${isSidebarOpen ? 'w-72' : 'w-24'} transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] flex flex-col z-30 relative ${blurClasses}`}
      >
        {/* ✅ ambient glow */}
        <div className="absolute inset-y-2 left-2 right-2 -z-10 pointer-events-none">
          <div className="absolute -inset-4 rounded-[2.6rem] bg-[#0A2A5E]/30 blur-2xl opacity-55" />
          <div className="absolute -inset-6 rounded-[3.2rem] bg-[#061F49]/25 blur-3xl opacity-35" />
          <div className="absolute -inset-8 rounded-[3.6rem] bg-black/20 blur-3xl opacity-25" />
        </div>

        {/* ✅ panel sólido ejecutivo (navy) */}
        <div
          className={[
            'absolute inset-y-2 left-2 right-2',
            'rounded-[2rem] overflow-hidden flex flex-col',
            'border border-white/10',
            'bg-gradient-to-b from-[#0A2A5E] via-[#061F49] to-[#041636]',
            'shadow-[0_30px_90px_rgba(0,0,0,0.40),0_14px_34px_rgba(0,0,0,0.22)]',
            'transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]',
            'hover:-translate-y-[2px]',
            'hover:shadow-[0_40px_120px_rgba(0,0,0,0.46),0_18px_44px_rgba(0,0,0,0.26)]',
          ].join(' ')}
        >
          {/* hairlines */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-white/18 via-white/6 to-transparent opacity-80" />

          {/* Header sidebar */}
          <div
            className={[
              'p-6 border-b border-white/10 relative',
              isSidebarOpen ? 'flex items-center gap-4' : 'flex items-center justify-center',
            ].join(' ')}
          >
            <div className="bg-gradient-to-tr from-[#1D7AFC] to-[#5856D6] p-2.5 rounded-[1.25rem] shadow-[0_14px_30px_rgba(29,122,252,0.35)] flex-shrink-0 relative group cursor-pointer">
              <Building2 className="text-white" size={24} strokeWidth={1.5} />
              <Sparkles
                size={12}
                className="absolute -top-1 -right-1 text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>

            {isSidebarOpen && (
              <div className="animate-in fade-in zoom-in-95 duration-300 origin-left overflow-hidden">
                <h1 className="text-white font-bold text-[15px] leading-tight tracking-tight whitespace-nowrap">
                  Portal
                </h1>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.15em] whitespace-nowrap">
                  La Salud & La Popular
                </p>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav ref={navRef} className="flex-1 px-3 py-6 space-y-1 overflow-y-auto scrollbar-hide relative">
            {/* ✅ PÍLDORA ÚNICA animada (NO hover) */}
            <div
              className={[
                'absolute left-3 right-3',
                'rounded-[1rem]',
                'bg-white/10 border border-white/10',
                'shadow-[0_10px_24px_rgba(0,0,0,0.25)]',
                'backdrop-blur-md',
                'transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]',
                pill.show ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
              style={{ top: pill.top, height: pill.height }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#1D7AFC]/15 via-transparent to-transparent rounded-[1rem]" />
            </div>

            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;

              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(item.id, el);
                    else itemRefs.current.delete(item.id);
                  }}
                  onClick={() => setView(item.id)}
                  type="button"
                  className={[
                    'w-full flex items-center gap-3 px-4 py-3 rounded-[1rem]',
                    'transition-all duration-300 group relative overflow-hidden',
                    'text-left',
                    isActive ? 'text-white' : 'text-white/75 hover:text-white',
                    'hover:bg-white/[0.06]',
                    'hover:shadow-[0_10px_22px_rgba(0,0,0,0.18)]',
                    'hover:-translate-y-[1px]',
                    'active:translate-y-0',
                    'active:scale-[0.99]',
                  ].join(' ')}
                >
                  {/* sheen */}
                  <span className="pointer-events-none absolute -inset-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/18 to-transparent rotate-12 blur-md" />
                  </span>

                  {/* soft ring */}
                  <span className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="absolute inset-0 rounded-[1rem] ring-1 ring-white/10" />
                  </span>

                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2 : 1.5}
                    className={`flex-shrink-0 transition-colors duration-300 relative z-10 ${
                      isActive ? 'text-[#1D7AFC]' : 'text-white/65 group-hover:text-white'
                    }`}
                  />

                  {isSidebarOpen && (
                    <span className={`text-[14px] flex-1 whitespace-nowrap relative z-10 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer user */}
          <div className="p-4 border-t border-white/10 bg-black/10 relative">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

            {/* ✅ OPEN: layout actual (perfil + logout a la derecha) */}
            {isSidebarOpen ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('profile')}
                  className="flex-1 flex items-center gap-3 hover:bg-white/10 p-2 -m-2 rounded-[1rem] transition-all duration-300 text-left group active:scale-[0.98]"
                  title="Ver mi perfil"
                  type="button"
                >
                  <div className="h-10 w-10 rounded-[1rem] bg-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.20)] border border-white/10 flex items-center justify-center text-white/70 overflow-hidden flex-shrink-0 group-hover:border-[#1D7AFC]/30 transition-colors">
                    {user?.photo ? (
                      <img src={user.photo} className="w-full h-full object-cover" alt="Foto" />
                    ) : (
                      <User size={20} strokeWidth={1.5} />
                    )}
                  </div>

                  <div className="flex-1 overflow-hidden transition-all duration-300">
                    <p className="text-[13px] font-semibold text-white truncate group-hover:text-[#9CC7FF] transition-colors">
                      {user?.name || 'Administrador'}
                    </p>
                    <p className="text-[10px] text-white/60 uppercase font-bold tracking-widest truncate">
                      {user?.role || user?.userType || 'Sistema'}
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    logout();
                    setView('login');
                  }}
                  className="p-2.5 text-white/60 hover:text-red-300 hover:bg-red-500/10 rounded-[1rem] transition-all flex-shrink-0"
                  title="Cerrar Sesión"
                  type="button"
                >
                  <LogOut size={18} strokeWidth={1.5} />
                </button>
              </div>
            ) : (
              /* ✅ COLLAPSED: perfil arriba, logout abajo */
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => setView('profile')}
                  type="button"
                  title="Perfil"
                  className="w-12 h-12 rounded-[1.25rem] bg-white/10 border border-white/10 shadow-[0_12px_28px_rgba(0,0,0,0.22)] hover:bg-white/15 hover:border-white/15 transition-all active:scale-[0.98] flex items-center justify-center text-white/75"
                >
                  {user?.photo ? (
                    <img src={user.photo} className="w-full h-full object-cover rounded-[1.25rem]" alt="Foto" />
                  ) : (
                    <User size={20} strokeWidth={1.5} />
                  )}
                </button>

                <button
                  onClick={() => {
                    logout();
                    setView('login');
                  }}
                  type="button"
                  title="Cerrar Sesión"
                  className="w-12 h-12 rounded-[1.25rem] bg-red-500/10 border border-white/10 shadow-[0_12px_28px_rgba(0,0,0,0.22)] hover:bg-red-500/15 hover:border-white/15 transition-all active:scale-[0.98] flex items-center justify-center text-red-200"
                >
                  <LogOut size={18} strokeWidth={1.6} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* cast shadow hacia main */}
        <div className="pointer-events-none absolute top-2 bottom-2 right-[-14px] w-10 z-10">
          <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/12 to-transparent blur-2xl opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A2A5E]/30 via-[#0A2A5E]/12 to-transparent blur-3xl opacity-70" />
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-20 pt-2 pr-2 pb-2">
        <header className={`h-16 glass-surface-sm rounded-t-[2rem] flex items-center justify-between px-6 mx-2 mb-2 z-20 shrink-0 ${blurClasses}`}>
          <button
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="p-2 hover:bg-black/5 rounded-[1rem] text-slate-500 transition-colors active:scale-95"
            type="button"
          >
            {isSidebarOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-purple-50/80 backdrop-blur-md border border-purple-100 px-4 py-1.5 rounded-full hidden md:flex items-center gap-2 shadow-sm">
              <ShieldCheck size={14} className="text-purple-600" strokeWidth={2} />
              <span className="text-[10px] font-bold text-purple-600/80 uppercase tracking-widest">
                Auth PIN
              </span>
              <div className="h-4 w-px bg-purple-200 mx-1"></div>
              <span className="text-[13px] font-black text-purple-700 tracking-[0.2em] font-mono">
                {authPin}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-full border border-slate-100 shadow-sm">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Conectado Localmente
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-white/40 backdrop-blur-md rounded-b-[2rem] border border-white/60 shadow-sm mx-2 scrollbar-hide relative">
          <div
            key={view}
            className="h-full animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] fill-mode-both"
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;