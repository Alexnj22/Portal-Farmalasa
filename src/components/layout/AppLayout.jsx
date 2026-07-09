import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Activity, Copy, CheckCircle2,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, LayoutDashboard, Cake,
    TrendingUp, Tag, Gift, Users, Package, DollarSign, FileText, BarChart2, PenLine, Receipt, Target, FlaskConical, Smartphone,
    PackageMinus, ShoppingCart
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { getHourlyCode, getSuPinSuffix } from '../../utils/helpers';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { useToastStore } from '../../store/toastStore';
import { useSyncMonitor } from '../../hooks/useSyncMonitor';
import { useNotificationsChannel } from '../../hooks/useNotificationsChannel';
import NotificationBell from '../common/NotificationBell';
import SidebarSyncStatus from '../common/SidebarSyncStatus';
import { APP_VERSION } from '../../version';
import PushPromptBanner from '../common/PushPromptBanner';
import OfflineBanner from '../common/OfflineBanner';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
const MODULE_MAP = {
    overview:          { path: '/overview',        label: 'Dashboard',                icon: LayoutDashboard },
    emp_home:          { path: '/home',            label: 'Inicio',                   icon: Home          },
    emp_requests:      { path: '/my-requests',    label: 'Mis Solicitudes',          icon: ClipboardList },
    emp_announcements: { path: '/my-announcements',label: 'Mis Avisos',               icon: Bell          },
    emp_profile:       { path: '/profile',         label: 'Mi Perfil',                icon: User          },
    emp_documents:     { path: '/my-documents',   label: 'Mis Documentos',           icon: FolderOpen    },
    staff_list:        { path: '/dashboard',       label: 'Listado',                  icon: User          },
    monitor:           { path: '/monitor',         label: 'Monitor Real-Time',        icon: Monitor       },
    time_audit:        { path: '/audit',           label: 'Auditoría de Tiempos',     icon: AlertTriangle },
    schedules:         { path: '/schedules',       label: 'Horarios y Turnos',        icon: Calendar      },
    requests:          { path: '/requests',        label: 'Gestión de Solicitudes',   icon: ClipboardList },
    vacation_plan:     { path: '/vacation-plan',   label: 'Plan de Vacaciones',       icon: Palmtree      },
    payroll:           { path: '/payroll',          label: 'Nómina',                   icon: DollarSign    },
    branches:          { path: '/branches',        label: 'Sucursales',               icon: Building2     },
    roles:             { path: '/roles',           label: 'Cargos / Organigrama',     icon: ShieldCheck   },
    announcements:     { path: '/announcements',   label: 'Gestionar Avisos',         icon: Megaphone     },
    permissions:       { path: '/permissions',     label: 'Permisos de Acceso',       icon: Lock          },
    auditview:         { path: '/auditview',       label: 'Auditoría General',        icon: Activity      },
    ios_test:          { path: '/ios-test',        label: 'Prueba iOS',               icon: Smartphone    },
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icon: TrendingUp },
    metas:             { path: '/metas',            label: 'Metas',                    icon: Target     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icon: FileText   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icon: Receipt    },
    encuesta:          { path: '/encuesta',         label: 'Clima Organizacional',     icon: BarChart2  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icon: PenLine    },
    promociones:       { path: '/promociones',      label: 'Promociones',              icon: Tag        },
    bonificaciones:    { path: '/bonificaciones',   label: 'Bonificaciones',           icon: Gift,         comingSoon: true },
    entrevistas:       { path: '/entrevistas',      label: 'Entrevistas',              icon: Users,        comingSoon: true },
    productos:         { path: '/productos',        label: 'Productos',                icon: Package       },
    laboratorios:      { path: '/laboratorios',     label: 'Laboratorios',             icon: FlaskConical  },
    pedidos:           { path: '/pedidos',          label: 'Pedidos a Sucursales',     icon: ClipboardList },
    minmax:            { path: '/minmax',           label: 'Min / Max',                icon: BarChart2     },
    ventas_perdidas:   { path: '/ventas-perdidas',  label: 'Ventas Perdidas',          icon: PackageMinus  },
    compras:           { path: '/compras',           label: 'Compras',                  icon: ShoppingCart  },
};

// ── Grupos del menú (define el orden y agrupación) ──────────────────────────
const MENU_GROUPS = [
    { key: 'overview',      label: 'Dashboard',     icon: LayoutDashboard, modules: ['overview']                          },
    { key: 'inicio',        label: 'Inicio',        icon: Home,          modules: ['emp_home']                          },
    { key: 'personal',      label: 'Personal',      icon: User,          modules: ['staff_list', 'payroll']               },
    { key: 'horarios',      label: 'Horarios y Turnos', icon: Calendar,  modules: ['schedules']                           },
    { key: 'solicitudes',   label: 'Solicitudes',   icon: ClipboardList, modules: ['emp_requests', 'requests']            },
    { key: 'avisos',        label: 'Avisos',         icon: Bell,          modules: ['emp_announcements', 'announcements']  },
    { key: 'documentos',    label: 'Documentos',    icon: FolderOpen,    modules: ['emp_documents']                       },
    { key: 'asistencia',    label: 'Asistencia',    icon: Monitor,       modules: ['monitor', 'time_audit']               },
    { key: 'planificacion', label: 'Planificación', icon: Palmtree,      modules: ['vacation_plan']                       },
    { key: 'estructura',    label: 'Estructura',    icon: Building2,     modules: ['branches', 'roles']                   },
    { key: 'sistema',       label: 'Sistema',       icon: Lock,          modules: ['permissions', 'auditview', 'ios_test'] },
    { key: 'comercial',    label: 'Comercial',     icon: TrendingUp,    modules: ['ventas', 'metas', 'facturacion', 'cotizaciones', 'promociones', 'bonificaciones'] },
    { key: 'rrhh',         label: 'RRHH',          icon: Users,         modules: ['entrevistas', 'encuesta_admin'] },
    { key: 'inventario',   label: 'Inventario',    icon: Package,       modules: ['productos', 'laboratorios', 'pedidos', 'minmax', 'ventas_perdidas', 'compras'] },
];

const SELF_KEYS = ['emp_home', 'emp_requests', 'emp_announcements', 'emp_profile', 'emp_documents'];

const AppLayout = ({ children, isOverlayActive = false, handleLogout }) => {
    const { user, hasPermission, isSU } = useAuth();
    const branches = useStaff((state) => state.branches || []);
    const announcements = useStaff((state) => state.announcements || []);
    const roles = useStaff((state) => state.roles || []);
    const employees = useStaff((state) => state.employees || []);

    // ¿Hoy es el cumpleaños de quien inició sesión? — vive en el layout (no en
    // una vista puntual como el Dashboard o Inicio) para que se note sin
    // importar en qué módulo aterrice al entrar (admin, empleado, etc.).
    const myEmp = useMemo(() => employees.find(e => String(e.id) === String(user?.id)), [employees, user?.id]);
    const myBirthDate = myEmp?.birth_date;
    const myBirthday = useMemo(() => {
        if (!myBirthDate) return null;
        const bDate = new Date(myBirthDate + 'T12:00:00');
        const today = new Date();
        if (bDate.getMonth() !== today.getMonth() || bDate.getDate() !== today.getDate()) return null;
        return { turningAge: today.getFullYear() - bDate.getFullYear() };
    }, [myBirthDate]);

    useEffect(() => {
        if (!myBirthday || !user?.id) return;
        const todayKey = new Date().toLocaleDateString('en-CA');
        const flagKey = `birthday_toast_${user.id}_${todayKey}`;
        if (localStorage.getItem(flagKey)) return;
        localStorage.setItem(flagKey, '1');
        const firstName = user?.name?.split(' ')[0] || '';
        useToastStore.getState().showToast(
            `¡Feliz cumpleaños, ${firstName}! 🎂`,
            `Hoy cumples ${myBirthday.turningAge} años — todo el equipo de Farmacias La Popular y La Salud te desea un día increíble.`,
            'birthday',
            'light',
            10000
        );
    }, [myBirthday, user?.id, user?.name]);

    const [vpPending, setVpPending] = useState(0);
    useEffect(() => {
        const load = async () => {
            const { count } = await supabase
                .from('ventas_perdidas')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pendiente');
            setVpPending(count || 0);
        };
        load();
        const ch = supabase.channel('vp-badge')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas_perdidas' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, []);
    const navigate = useNavigate();
    const location = useLocation();

    useSyncMonitor();
    useNotificationsChannel();

    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
    const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
    const [openGroups, setOpenGroups] = useState({});


    const [authPin, setAuthPin] = useState(getHourlyCode());
    const [suSuffix, setSuSuffix] = useState(getSuPinSuffix());
    const [isCopied, setIsCopied] = useState(false);
    const [isSuCopied, setIsSuCopied] = useState(false);

    const [flyout, setFlyout] = useState(null); 
    const flyoutTimerRef = useRef(null);
    const asideRef = useRef(null);

    const navRef = useRef(null);
    const groupHeaderRefs = useRef(new Map()); 
    const itemRefs = useRef(new Map());
    const [pill, setPill] = useState({ top: 0, height: 44, show: false });
    const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

    const activePath = location.pathname;
    const activeId = activePath.split('/')[1] || '';

    const cargoLabel = (() => {
        if (isSU) return 'Super Admin';
        if (typeof user?.role === 'string' && isNaN(Number(user.role))) return user.role;
        const sr = user?.systemRole;
        return { ADMIN: 'Administrador', EMPLEADO: 'Empleado' }[sr] || sr || '';
    })();

    useEffect(() => {
        const check = () => {
            setIsMobile(window.innerWidth < 1024);
            setIsWide(window.innerWidth >= 1280);
        };
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    useEffect(() => {
        if (!isMobile) return;
        const html = document.documentElement;
        const body = document.body;
        const root = document.getElementById('root');
        html.style.setProperty('overflow', 'auto', 'important');
        html.style.setProperty('height', 'auto', 'important');
        html.style.setProperty('overscroll-behavior', 'auto', 'important');
        body.style.setProperty('overflow', 'auto', 'important');
        body.style.setProperty('height', 'auto', 'important');
        body.style.setProperty('overscroll-behavior', 'auto', 'important');
        if (root) {
            root.style.setProperty('overflow', 'visible', 'important');
            root.style.setProperty('height', 'auto', 'important');
            root.style.setProperty('overscroll-behavior', 'auto', 'important');
        }
        return () => {
            ['overflow', 'height', 'overscroll-behavior'].forEach(p => html.style.removeProperty(p));
            ['overflow', 'height', 'overscroll-behavior'].forEach(p => body.style.removeProperty(p));
            if (root) ['overflow', 'height', 'overscroll-behavior'].forEach(p => root.style.removeProperty(p));
        };
    }, [isMobile]);

    useEffect(() => {
        if (isMobile) setIsSidebarOpen(false);
        else setIsSidebarOpen(true);
    }, [isMobile, isWide]);

    useEffect(() => {
        const handler = (e) => setIsSidebarOpen(e.detail);
        window.addEventListener('set-sidebar', handler);
        return () => window.removeEventListener('set-sidebar', handler);
    }, []);

    useEffect(() => {
        const timer = setInterval(() => {
            setAuthPin(getHourlyCode());
            setSuSuffix(getSuPinSuffix());
        }, 10000);
        return () => clearInterval(timer);
    }, []);

    const visibleGroups = useMemo(() => {
        return MENU_GROUPS.map(g => {
            const visibleModules = g.modules
                .filter(key => MODULE_MAP[key]?.comingSoon || hasPermission(key, 'can_view'))
                .map(key => ({ key, ...MODULE_MAP[key] }));
            return { ...g, visibleModules };
        }).filter(g => g.visibleModules.length > 0);
    }, [hasPermission]);

    useEffect(() => {
        const next = {};
        visibleGroups.forEach(g => {
            if (g.visibleModules.length >= 2) {
                const hasActive = g.visibleModules.some(m => {
                    const seg = m.path.replace(/^\//, '').split('/')[0];
                    return activeId === seg || activePath.startsWith(m.path + '/');
                });
                next[g.key] = hasActive;
            }
        });
        setOpenGroups(next);
    }, [activeId, visibleGroups]);

    const toggleGroup = (key) => setOpenGroups(prev => {
        const isOpen = !!prev[key];
        const next = {};
        visibleGroups.forEach(g => {
            if (g.visibleModules.length >= 2) {
                const isActiveGroup = g.visibleModules.some(
                    m => m.path.replace(/^\//, '').split('/')[0] === activeId
                );
                next[g.key] = (isActiveGroup && g.key !== key) ? true : false;
            }
        });
        next[key] = !isOpen;
        return next;
    });

    const openFlyout = useCallback((data) => {
        clearTimeout(flyoutTimerRef.current);
        setFlyout(data);
    }, []);
    const closeFlyout = useCallback(() => {
        flyoutTimerRef.current = setTimeout(() => setFlyout(null), 80);
    }, []);

    const hasBranchAlerts = useMemo(() => {
        return branches.some(branch => {
            if (!branch.address || (!branch.phone && !branch.cell)) return true;
            if (branch.propertyType === 'RENTED') {
                const endStr = branch.rent?.contract?.endDate;
                if (!endStr) return true;
                return Math.ceil((new Date(endStr) - new Date()) / (1000 * 60 * 60 * 24)) <= 30;
            }
            return false;
        });
    }, [branches]);

    const unreadAnnouncements = useMemo(() => {
        if (!user) return [];
        return announcements.filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            if (!announcementAppliesToUser(a, user, roles)) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        });
    }, [announcements, user, roles]);

    const unreadCount = unreadAnnouncements.length;

    const getBadge = (key) => {
        if (key === 'emp_announcements' && unreadCount > 0) return unreadCount;
        if (key === 'ventas_perdidas'   && vpPending   > 0) return vpPending;
        return 0;
    };
    const getAlert = (key) => key === 'branches' && hasBranchAlerts;

    const handleCopyPin = () => {
        navigator.clipboard.writeText(authPin);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleCopySuPin = () => {
        navigator.clipboard.writeText(`${authPin}${suSuffix}`);
        setIsSuCopied(true);
        setTimeout(() => setIsSuCopied(false), 2000);
    };


    const isExpanded = isSidebarOpen;
    const blurClasses = isOverlayActive ? 'pointer-events-none select-none scale-[0.98] blur-[2px]' : '';

    const recomputePill = () => {
        const navEl = navRef.current;
        let activeEl = itemRefs.current.get(activeId);

        const parentGroup = visibleGroups.find(g =>
            g.visibleModules.length >= 2 &&
            g.visibleModules.some(m => m.path.replace(/^\//, '').split('/')[0] === activeId)
        );
        if (parentGroup) {
            const groupVisible = isExpanded && (openGroups[parentGroup.key] ?? false);
            if (!groupVisible) {
                activeEl = groupHeaderRefs.current.get(parentGroup.key) ?? activeEl;
            }
        } else if (!activeEl || activeEl.getBoundingClientRect().height < 4) {
            const fallback = visibleGroups.find(g =>
                g.visibleModules.length >= 2 &&
                g.visibleModules.some(m => m.path.replace(/^\//, '').split('/')[0] === activeId)
            );
            if (fallback) activeEl = groupHeaderRefs.current.get(fallback.key) ?? activeEl;
        }

        if (!navEl || !activeEl) {
            const isKnownRoute = visibleGroups.some(g =>
                g.visibleModules.some(m => {
                    const seg = m.path.replace(/^\//, '').split('/')[0];
                    return activeId === seg || activePath.startsWith(m.path + '/');
                })
            );
            if (!isKnownRoute) {
                setPill(prev => ({ ...prev, show: false }));
                return;
            }
            setPill(prev => prev.show ? prev : lastGoodPillRef.current);
            return;
        }
        const navRect = navEl.getBoundingClientRect();
        const actRect = activeEl.getBoundingClientRect();
        const top = Math.max(0, actRect.top - navRect.top + navEl.scrollTop);
        const height = Math.max(40, actRect.height);
        const next = { top, height, show: true };
        lastGoodPillRef.current = next;
        setPill(next);
    };

    useLayoutEffect(() => {
        const ANIM_MS = 320;
        let raf;
        let start = null;
        const loop = (ts) => {
            if (!start) start = ts;
            recomputePill();
            if (ts - start < ANIM_MS) raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [activeId, openGroups, isExpanded]);

    useLayoutEffect(() => {
        const r1 = requestAnimationFrame(recomputePill);
        const r2 = requestAnimationFrame(() => requestAnimationFrame(recomputePill));
        const t = setTimeout(recomputePill, 520);
        return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
    }, [isSidebarOpen, isMobile]);

    useEffect(() => {
        const navEl = navRef.current;
        if (!navEl) return;
        const ro = new ResizeObserver(() => recomputePill());
        ro.observe(navEl);
        window.addEventListener('resize', recomputePill);
        return () => { ro.disconnect(); window.removeEventListener('resize', recomputePill); };
    }, []);

    // Scroll nav to keep active item visible after submenu animation finishes
    useEffect(() => {
        const t = setTimeout(() => {
            const navEl = navRef.current;
            const activeEl = itemRefs.current.get(activeId);
            if (!navEl || !activeEl) return;
            const navRect = navEl.getBoundingClientRect();
            const actRect = activeEl.getBoundingClientRect();
            const elTop    = actRect.top    - navRect.top + navEl.scrollTop;
            const elBottom = actRect.bottom - navRect.top + navEl.scrollTop;
            if (elBottom > navEl.scrollTop + navEl.clientHeight) {
                navEl.scrollTo({ top: elBottom - navEl.clientHeight + 8, behavior: 'smooth' });
            } else if (elTop < navEl.scrollTop) {
                navEl.scrollTo({ top: elTop - 8, behavior: 'smooth' });
            }
        }, 330);
        return () => clearTimeout(t);
    }, [openGroups, activeId]);

    const allModuleKeys = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => !m.comingSoon).map(m => m.key)),
    [visibleGroups]);
    const hasSelfOnly = allModuleKeys.length > 0 && allModuleKeys.every(k => SELF_KEYS.includes(k));
    const selfItems = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => SELF_KEYS.includes(m.key))),
    [visibleGroups]);

    const renderNavItem = (module, indent = false) => {
        const { key, path, label, icon: Icon, comingSoon } = module;
        const pathSeg = path.replace(/^\//, '').split('/')[0];
        const isActive = !comingSoon && (activeId === pathSeg || activePath.startsWith(path + '/'));
        const badge = getBadge(key);
        const alert = getAlert(key);

        const handleMouseEnter = (!isMobile && !isExpanded && !comingSoon) ? (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
            openFlyout({ type: 'item', label, path, icon: Icon, x, y: rect.top + rect.height / 2, badge, alert, isActive });
        } : undefined;

        const navItemInactive   = 'text-white/60 hover:text-white/95 hover:bg-white/[0.08] hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]';
        const iconActiveColor   = 'text-violet-200';
        const iconInactiveColor = 'text-white/42 group-hover:text-white/80';
        const accentBarInactive = 'bg-white/20';
        const accentBarActive   = 'bg-gradient-to-b from-violet-300 via-indigo-400 to-blue-400 shadow-[0_0_10px_rgba(139,92,246,0.7)]';

        if (comingSoon) {
            return (
                <div
                    key={key}
                    className={`w-full flex items-center gap-2.5 rounded-[1rem] relative
                        ${indent ? 'px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5' : 'px-3 py-3 xl:px-4 xl:py-3.5'}
                        opacity-50 cursor-default select-none`}
                >
                    <div className="relative z-10 flex-shrink-0">
                        <Icon size={indent ? 16 : 20} strokeWidth={1.5} className="text-white/35" />
                    </div>
                    {isExpanded && (
                        <>
                            <span className="text-[12px] xl:text-[13px] font-medium flex-1 whitespace-nowrap text-white/45">{label}</span>
                            <span className="text-[9px] font-black uppercase tracking-wider text-amber-600/70 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                Próximamente
                            </span>
                        </>
                    )}
                </div>
            );
        }

        return (
            <button
                key={key}
                ref={(!indent || isExpanded) ? (el => { if (el) itemRefs.current.set(pathSeg, el); else itemRefs.current.delete(pathSeg); }) : null}
                onClick={() => { navigate(path); if (isMobile) setIsSidebarOpen(false); setFlyout(null); }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={(!isMobile && !isExpanded) ? closeFlyout : undefined}
                type="button"
                className={`w-full flex items-center gap-2.5 rounded-[1rem] transition-all duration-200 group relative text-left overflow-hidden
                    ${indent ? 'px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5' : 'px-3 py-3 xl:px-4 xl:py-3.5'}
                    ${isActive ? 'text-white' : navItemInactive}
                    active:scale-[0.99] active:translate-y-0`}
            >
                <span className="absolute inset-0 overflow-hidden rounded-[1rem] pointer-events-none">
                    <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                </span>

                {indent && (
                    <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full transition-all ${isActive ? accentBarActive : accentBarInactive}`} />
                )}

                <div className="relative z-10 flex-shrink-0">
                    <Icon
                        size={indent ? 16 : 20}
                        strokeWidth={isActive ? 2 : 1.5}
                        className={`transition-all duration-300 ${isActive ? `${iconActiveColor} scale-110` : `${iconInactiveColor} group-hover:scale-110`}`}
                    />
                    {!isExpanded && alert && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                        </span>
                    )}
                    {!isExpanded && badge > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center z-20">
                            {badge > 9 ? '9+' : badge}
                        </span>
                    )}
                </div>

                {isExpanded && (
                    <>
                        <span className={`text-[12px] xl:text-[13px] flex-1 whitespace-nowrap relative z-10 transition-colors ${isActive ? 'font-semibold' : 'font-medium'}`}>
                            {label}
                        </span>
                        {alert && (
                            <span className="relative z-10 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                            </span>
                        )}
                        {badge > 0 && (
                            <span className="relative z-10 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                                {badge > 9 ? '9+' : badge}
                            </span>
                        )}
                    </>
                )}
            </button>
        );
    };

    const renderGroup = (group) => {
        const { key, label, icon: GroupIcon, visibleModules } = group;

        if (visibleModules.length === 1) {
            return renderNavItem(visibleModules[0], false);
        }

        const isOpen = openGroups[key] ?? false;
        const hasActiveChild = visibleModules.some(m => {
            const seg = m.path.replace(/^\//, '').split('/')[0];
            return activeId === seg || activePath.startsWith(m.path + '/');
        });
        const groupBadge = visibleModules.reduce((sum, m) => sum + getBadge(m.key), 0);
        const groupAlert = visibleModules.some(m => getAlert(m.key));

        return (
            <div key={key} className="space-y-0.5">
                <button
                    ref={el => {
                        if (el) groupHeaderRefs.current.set(key, el);
                        else groupHeaderRefs.current.delete(key);
                    }}
                    onClick={() => toggleGroup(key)}
                    onMouseEnter={(!isMobile && !isExpanded) ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
                        openFlyout({
                            type: 'group', label, x, y: rect.top + rect.height / 2,
                            items: visibleModules.map(m => ({
                                ...m,
                                isActive: activeId === m.path.replace(/^\//, '').split('/')[0] || activePath.startsWith(m.path + '/'),
                                badge: getBadge(m.key),
                                alert: getAlert(m.key),
                            })),
                        });
                    } : undefined}
                    onMouseLeave={(!isMobile && !isExpanded) ? closeFlyout : undefined}
                    type="button"
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 xl:px-4 xl:py-3 rounded-[1rem] transition-all duration-200 group text-left overflow-hidden
                        ${hasActiveChild
                            ? 'text-white'
                            : 'text-white/60 hover:text-white/95 hover:bg-white/[0.08] hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'}
                        active:scale-[0.99] active:translate-y-0`}
                >
                    <span className="absolute inset-0 overflow-hidden rounded-[1rem] pointer-events-none">
                        <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                    </span>
                    <GroupIcon
                        size={20}
                        strokeWidth={hasActiveChild ? 2 : 1.5}
                        className={`flex-shrink-0 transition-all duration-300 ${hasActiveChild
                            ? 'text-violet-200 scale-110'
                            : 'text-white/42 group-hover:text-white/80 group-hover:scale-110'}`}
                    />
                    {isExpanded && (
                        <>
                            <span className={`text-[12px] xl:text-[13px] flex-1 whitespace-nowrap transition-colors ${hasActiveChild ? 'font-semibold' : 'font-medium'}`}>
                                {label}
                            </span>
                            {!isOpen && groupBadge > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                                    {groupBadge > 9 ? '9+' : groupBadge}
                                </span>
                            )}
                            {!isOpen && groupAlert && (
                                <span className="relative flex h-2 w-2 flex-shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                </span>
                            )}
                            <ChevronDown
                                size={14}
                                strokeWidth={2.5}
                                className={`transition-transform duration-300 flex-shrink-0 text-white/40 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                            />
                        </>
                    )}
                </button>

                <div
                    className={`grid transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]
                        ${isExpanded && isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}
                >
                    <div className="overflow-hidden">
                        <div className="pl-3 space-y-0.5 pb-1 pt-0.5">
                            {visibleModules.map(m => renderNavItem(m, true))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <LayoutGroup>
            <div className="flex w-full font-sans relative lg:h-[100dvh] lg:overflow-hidden">

                {/* ── Global ambient orbs ── */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'70vw', height:'70vw', top:'-15%', left:'-15%', background:'radial-gradient(circle, rgba(110,70,230,0.45) 0%, rgba(130,80,240,0.20) 40%, transparent 70%)', filter:'blur(35px)' }} />
                    <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'55vw', height:'55vw', top:'-5%', right:'-20%', background:'radial-gradient(circle, rgba(60,100,240,0.38) 0%, rgba(80,120,255,0.15) 40%, transparent 70%)', filter:'blur(30px)' }} />
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'80vw', height:'80vw', bottom:'-35%', left:'-10%', background:'radial-gradient(circle, rgba(150,80,240,0.35) 0%, rgba(160,100,250,0.12) 40%, transparent 70%)', filter:'blur(40px)', animationDelay:'4s', animationDuration:'18s' }} />
                    <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'45vw', height:'45vw', top:'25%', right:'5%', background:'radial-gradient(circle, rgba(90,150,255,0.32) 0%, rgba(100,160,255,0.12) 40%, transparent 70%)', filter:'blur(28px)', animationDelay:'2s', animationDuration:'14s' }} />
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'30vw', height:'30vw', top:'50%', left:'38%', background:'radial-gradient(circle, rgba(200,120,255,0.28) 0%, rgba(210,130,255,0.10) 40%, transparent 70%)', filter:'blur(22px)', animationDelay:'6s', animationDuration:'11s' }} />
                </div>

                {/* Mobile backdrop */}
                {isMobile && isSidebarOpen && (
                    <div
                        className="fixed inset-0 bg-[#030B1C]/40 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* ── Sidebar ── */}
                <aside
                    ref={asideRef}
                    className={`fixed lg:relative z-50 lg:z-[60] h-[calc(100dvh-16px)] lg:h-auto flex flex-col shrink-0
                        my-[max(env(safe-area-inset-top,8px),8px)] mb-[max(env(safe-area-inset-bottom,8px),8px)]
                        ${isMobile
                            ? `w-[85%] max-w-[280px] left-2 transition-transform duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${isSidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%_+_16px)]'}`
                            : `${isSidebarOpen ? 'w-[15rem] xl:w-[16.5rem] 2xl:w-[18rem]' : 'w-[4.5rem] xl:w-[5rem]'} ml-[max(env(safe-area-inset-left,8px),8px)] transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]`}
                        ${blurClasses}`}
                >
                    <div className="sidebar-ambient absolute inset-y-0 left-0 w-full -z-10 pointer-events-none">
                        <div className="absolute top-0 left-0 right-0 h-2/3 rounded-t-[2.6rem] bg-slate-500/[0.06] blur-3xl" />
                        <div className="absolute -inset-5 right-0 rounded-[3.5rem] bg-black/35 blur-[45px] opacity-80" />
                        <div className="absolute -inset-10 right-[-4px] rounded-[5rem] bg-black/20 blur-[70px] opacity-50" />
                    </div>

                    {/* ── Glass container ── */}
                    <div data-surface="sidebar" className="absolute inset-y-0 left-0 w-full z-10 rounded-[2.5rem] overflow-hidden flex flex-col
                        bg-[#07031a]/80 backdrop-blur-2xl
                        border border-white/[0.10]
                        shadow-[inset_1px_0_0_rgba(255,255,255,0.10),inset_0_1px_0_rgba(255,255,255,0.15),0_0_0_1px_rgba(0,0,0,0.5),0_32px_64px_rgba(0,0,0,0.40)]">

                        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2.5rem]" style={{ zIndex: 0 }}>
                            <div className="animate-ambient-drift absolute rounded-full" style={{ width:'220px', height:'220px', top:'-10%', left:'-30%', background:'radial-gradient(circle, rgba(139,92,246,0.28) 0%, transparent 70%)', filter:'blur(20px)', animationDuration:'14s' }} />
                            <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'170px', height:'170px', bottom:'8%', right:'-25%', background:'radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 70%)', filter:'blur(16px)', animationDuration:'18s', animationDelay:'5s' }} />
                            <div className="animate-ambient-drift absolute rounded-full" style={{ width:'130px', height:'130px', top:'42%', right:'-15%', background:'radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 70%)', filter:'blur(14px)', animationDuration:'11s', animationDelay:'2s' }} />
                        </div>

                        <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/[0.06] to-transparent pointer-events-none z-[1]" />
                        <div className="absolute left-0 inset-y-0 w-[1px] bg-gradient-to-b from-white/30 via-white/10 to-white/3 pointer-events-none z-[1]" />
                        <div className="absolute right-0 inset-y-0 w-[1px] bg-gradient-to-b from-white/8 via-transparent to-transparent pointer-events-none z-[1]" />
                        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/30 to-transparent pointer-events-none z-[1]" />

                        <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden z-[2] pointer-events-none">
                            <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-violet-300/80 to-transparent animate-shimmer" style={{ animationDuration: '4s', animationTimingFunction: 'ease-in-out' }} />
                        </div>

                        {/* ── Logo header ── */}
                        <div className={`relative z-10 flex items-center border-b border-white/[0.06]
                            ${isExpanded ? 'px-4 py-3.5 justify-between' : 'px-2 py-3.5 justify-center'}`}>
                            <div className="absolute inset-0 bg-gradient-to-b from-violet-500/[0.06] to-transparent pointer-events-none" />
                            <div className="absolute bottom-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent animate-shimmer" style={{ animationDuration: '5s', animationDelay: '1.5s', animationTimingFunction: 'ease-in-out' }} />
                            </div>

                            <div className="flex items-center gap-3 relative z-10">
                                <div className="relative group/logo flex-shrink-0 cursor-pointer" onClick={() => navigate('/')}>
                                    <div className="absolute -inset-2 rounded-[1.75rem] blur-xl opacity-30 group-hover/logo:opacity-70 transition-all duration-500 bg-gradient-to-tr from-violet-500/50 to-blue-500/40" />
                                    <div className={`relative flex items-center justify-center rounded-[1.25rem] overflow-hidden
                                        transition-all duration-300 group-hover/logo:scale-105
                                        bg-white/12 border border-violet-300/20
                                        shadow-[0_4px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.2)]
                                        group-hover/logo:border-violet-300/35 group-hover/logo:bg-white/18
                                        ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'}`}>
                                        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none rounded-t-[1.25rem]" />
                                        <img src="/Logo192.png" alt="FLS"
                                            className={`object-contain relative z-10 transition-transform duration-300 group-hover/logo:scale-105 ${isExpanded ? 'w-6 h-6' : 'w-7 h-7'}`} />
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="animate-in fade-in zoom-in-95 duration-300 origin-left min-w-0">
                                        <h1 className="font-black text-[15px] leading-tight tracking-tight text-white">Portal</h1>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] mt-0.5 leading-snug text-white/50">La Salud & La Popular</p>
                                    </div>
                                )}
                            </div>

                            {isExpanded && (
                                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                    className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-[0.97]
                                        bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.09] hover:border-white/[0.18] text-white/50 hover:text-white/80
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)]">
                                    {isMobile ? <X size={16} strokeWidth={2} /> : <ChevronLeft size={16} strokeWidth={2} />}
                                </button>
                            )}
                        </div>

                        {/* ── Nav ── */}
                        <nav ref={navRef} className="relative z-10 flex-1 min-h-0 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                            <div
                                className={`absolute left-2 right-2 rounded-[0.875rem] transform-gpu transition-opacity duration-200 pointer-events-none
                                    bg-gradient-to-r from-violet-500/[0.22] via-indigo-400/[0.14] to-blue-500/[0.08]
                                    border border-violet-300/[0.20]
                                    shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_28px_rgba(139,92,246,0.22),0_4px_16px_rgba(0,0,0,0.30)]
                                    ${pill.show ? 'opacity-100' : 'opacity-0'}`}
                                style={{ top: pill.top, height: pill.height }}
                            >
                                <div className="absolute left-0 inset-y-[15%] w-[2px] rounded-full bg-gradient-to-b from-violet-300 via-indigo-400 to-blue-400 shadow-[0_0_10px_rgba(139,92,246,0.8),0_0_20px_rgba(139,92,246,0.4)]" />
                            </div>

                            {visibleGroups.map(g => renderGroup(g))}
                        </nav>

                        {/* ── Footer ── */}
                        <div className="relative z-10 px-3 pb-4 pt-3 border-t border-white/[0.07] flex flex-col gap-2.5">
                            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

                            {isExpanded ? (
                                <>
                                    {hasPermission('kiosk_pin', 'can_view') && (
                                        <div className={`grid gap-1.5 ${hasPermission('su_pin', 'can_view') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                            <button onClick={handleCopyPin}
                                                className="group/pin flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 cursor-pointer outline-none transition-all border bg-white/[0.06] border-white/[0.09] hover:bg-white/[0.11] hover:border-white/[0.14] hover:scale-[1.02] active:scale-[0.98]"
                                                title="Copiar PIN">
                                                <div className="flex items-center gap-1 mb-0.5">
                                                    <CheckCircle2 size={10} className="text-white/42 group-hover/pin:text-emerald-400 transition-colors" strokeWidth={2} />
                                                    <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">PIN</span>
                                                </div>
                                                <div className="relative h-4 flex items-center justify-center w-full">
                                                    <span className={`absolute text-[12px] font-black tracking-widest font-mono transition-all duration-300 text-white ${isCopied ? 'opacity-0 scale-75' : 'opacity-100 scale-100 group-hover/pin:opacity-0 group-hover/pin:scale-90'}`}>{authPin}</span>
                                                    <Copy size={12} className={`absolute transition-all duration-300 text-white/50 ${isCopied ? 'opacity-0 scale-75' : 'opacity-0 scale-90 group-hover/pin:opacity-100 group-hover/pin:scale-100'}`} />
                                                    <CheckCircle2 size={12} className={`absolute text-emerald-400 transition-all duration-300 ${isCopied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} />
                                                </div>
                                            </button>
                                            
                                            {hasPermission('su_pin', 'can_view') && (
                                                <button onClick={handleCopySuPin}
                                                    className="group/supin flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2 cursor-pointer outline-none transition-all border bg-white/[0.06] border-white/[0.09] hover:bg-violet-500/[0.12] hover:border-violet-400/[0.18] hover:scale-[1.02] active:scale-[0.98]"
                                                    title="Copiar código SU">
                                                    <div className="flex items-center gap-1 mb-0.5">
                                                        <CheckCircle2 size={10} className="text-white/40 group-hover/supin:text-violet-400 transition-colors" strokeWidth={2} />
                                                        <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">SU</span>
                                                    </div>
                                                    <div className="relative h-4 flex items-center justify-center w-full">
                                                        <span className={`absolute text-[12px] font-black text-violet-300 tracking-widest font-mono transition-all duration-300 ${isSuCopied ? 'opacity-0 scale-75' : 'opacity-100 scale-100 group-hover/supin:opacity-0 group-hover/supin:scale-90'}`}>{authPin}{suSuffix}</span>
                                                        <Copy size={12} className={`absolute text-violet-300/55 transition-all duration-300 ${isSuCopied ? 'opacity-0 scale-75' : 'opacity-0 scale-90 group-hover/supin:opacity-100 group-hover/supin:scale-100'}`} />
                                                        <CheckCircle2 size={12} className={`absolute text-emerald-400 transition-all duration-300 ${isSuCopied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} />
                                                    </div>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    
                                    <SidebarSyncStatus />

                                    {/* ── AQUÍ ESTABA EL ERROR: Div de usuario y cierres corregidos ── */}
                                    <div className="flex items-center gap-2 group/user">
                                        <button onClick={() => navigate('/profile')}
                                            className="flex-1 flex items-center gap-3 p-2 -mx-1 rounded-[1rem] text-left transition-all duration-200 active:scale-[0.98] hover:bg-white/[0.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                                            type="button">
                                            <div className="relative h-9 w-9 flex-shrink-0">
                                                <div className="h-9 w-9 rounded-[0.85rem] overflow-hidden flex items-center justify-center transition-all border border-white/12 shadow-[0_4px_12px_rgba(0,0,0,0.4)] bg-white/[0.08] text-white/55 group-hover/user:border-white/20">
                                                    {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} strokeWidth={1.5} />}
                                                </div>
                                                {myBirthday && (
                                                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 border-2 border-[#07031a] shadow-sm flex items-center justify-center animate-bounce z-10" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                                        <Cake size={9} className="text-white" />
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex-1 overflow-hidden">
                                                <p className="text-[13px] font-semibold truncate transition-colors leading-tight text-white/80 group-hover/user:text-white">{user?.name || 'Usuario'}{myBirthday ? ' 🎂' : ''}</p>
                                            </div>
                                        </button>
                                        <button onClick={handleLogout}
                                            className="p-2 rounded-[0.85rem] border border-transparent transition-all flex-shrink-0 hover:scale-105 active:scale-[0.97] text-white/40 hover:text-red-400 hover:bg-red-500/[0.14] hover:border-red-500/[0.18]"
                                            type="button">
                                            <LogOut size={16} strokeWidth={1.8} />
                                        </button>
                                    </div>

                                    <p className="text-center text-[9px] font-medium text-white/20 tracking-wider pt-1">
                                        Edwin Nunez · v{APP_VERSION}
                                    </p>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-3 py-1 animate-in fade-in duration-500">
                                    {!isMobile && (
                                        <button onClick={() => setIsSidebarOpen(true)}
                                            className="w-10 h-10 rounded-[1rem] flex items-center justify-center mb-1 transition-all hover:scale-105 active:scale-[0.97]
                                                bg-white/[0.07] border border-white/[0.09] text-white/35 hover:text-white/70 hover:bg-white/[0.12] hover:border-white/[0.15]
                                                shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)]">
                                            <ChevronRight size={17} strokeWidth={2} />
                                        </button>
                                    )}
                                    {hasPermission('kiosk_pin', 'can_view') && (
                                        <button onClick={handleCopyPin}
                                            className="relative w-11 h-11 rounded-[1.1rem] flex items-center justify-center overflow-hidden group transition-all hover:scale-105 active:scale-[0.97]
                                                bg-white/[0.07] border border-white/[0.09] text-white/45 hover:bg-white/[0.13] hover:border-white/[0.15]
                                                shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)]"
                                            title="PIN">
                                            {isCopied ? <CheckCircle2 size={17} className="text-emerald-400" /> : (
                                                <>
                                                    <CheckCircle2 size={17} className="transition-all duration-300 group-hover:opacity-0 group-hover:scale-50 absolute" />
                                                    <span className="absolute opacity-0 scale-150 group-hover:opacity-100 group-hover:scale-100 transition-all font-mono text-[11px] font-black text-white/90">{authPin}</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                    {hasPermission('su_pin', 'can_view') && (
                                        <button onClick={handleCopySuPin}
                                            className="relative w-11 h-11 rounded-[1.1rem] flex items-center justify-center overflow-hidden group
                                                bg-white/[0.07] border border-white/[0.09]
                                                text-violet-300/70 hover:bg-violet-500/[0.12] hover:border-violet-400/[0.18]
                                                shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_4px_14px_rgba(139,92,246,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]
                                                hover:scale-105 active:scale-[0.97] transition-all"
                                            title="PIN SU">
                                            {isSuCopied ? <CheckCircle2 size={17} className="text-emerald-400" /> : (
                                                <>
                                                    <CheckCircle2 size={17} className="transition-all duration-300 group-hover:opacity-0 group-hover:scale-50 absolute" />
                                                    <span className="absolute opacity-0 scale-150 group-hover:opacity-100 group-hover:scale-100 transition-all font-mono text-[10px] font-black text-violet-200">{authPin}{suSuffix}</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                    <div className="relative w-11 h-11">
                                        <button onClick={() => navigate('/profile')} type="button"
                                            onMouseEnter={(e) => {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
                                                openFlyout({ type: 'user', x, y: rect.top + rect.height / 2 });
                                            }}
                                            onMouseLeave={closeFlyout}
                                            className="w-11 h-11 rounded-[1.1rem] overflow-hidden flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-[0.97]
                                                bg-white/[0.08] border border-white/[0.12] text-white/55
                                                shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_rgba(0,0,0,0.4)]
                                                hover:bg-white/[0.14] hover:border-white/[0.20] hover:shadow-[0_6px_18px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.18)]">
                                            {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={17} strokeWidth={1.5} />}
                                        </button>
                                        {myBirthday && (
                                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 border-2 border-[#07031a] shadow-sm flex items-center justify-center animate-bounce z-10 pointer-events-none" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                                <Cake size={9} className="text-white" />
                                            </span>
                                        )}
                                    </div>
                                    <button onClick={handleLogout} type="button"
                                        className="w-11 h-11 rounded-[1.1rem] flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-[0.97]
                                            bg-red-500/[0.08] border border-red-500/[0.12] text-red-400/60
                                            hover:text-red-300 hover:bg-red-500/[0.18] hover:border-red-500/[0.22]
                                            shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_4px_14px_rgba(239,68,68,0.2),inset_0_1px_0_rgba(255,255,255,0.12)]">
                                        <LogOut size={15} strokeWidth={1.8} />
                                    </button>
                                    <span className="text-[8px] font-medium text-white/18 tracking-wider">v{APP_VERSION}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </aside>

                {/* ── Main content ── */}
                <main className={`flex-1 flex flex-col relative z-20 lg:overflow-hidden ${blurClasses}`}>
                    <div
                        className="lg:hidden fixed left-0 right-0 z-40 border-b border-white/25"
                        style={{
                            top: 'env(safe-area-inset-top, 0px)',
                            background: 'rgba(221,216,255,0.88)',
                            backdropFilter: 'blur(40px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                            boxShadow: '0 4px 20px rgba(110,70,220,0.10)',
                        }}
                    >
                        <div className="flex items-center justify-between px-4 py-2.5">
                            <div className="flex items-center gap-4">
                                <button onClick={() => setIsSidebarOpen(true)} className="active:scale-[0.97] transition-[color,transform] text-[#030B1C] hover:text-[#0052CC]">
                                    <Menu size={22} strokeWidth={2.5} />
                                </button>
                                <div className="w-px h-6 rounded-full bg-slate-300/50" />
                                <div className="flex flex-col justify-center">
                                    <h1 className="text-[14px] font-black leading-none tracking-tight text-slate-800">Portal</h1>
                                    <p className="text-[8px] font-bold uppercase tracking-[0.2em] mt-0.5 text-[#0052CC]">La Salud</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <NotificationBell variant="mobile" />
                                <div className="relative w-11 h-11">
                                    <button onClick={() => navigate('/profile')} className="w-11 h-11 rounded-[1.4rem] shadow-md overflow-hidden active:scale-[0.97] transition-all flex items-center justify-center relative group hover:shadow-lg border bg-white border-white">
                                        <div className="absolute inset-0 bg-[#0052CC]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} className="text-slate-400" />}
                                    </button>
                                    {myBirthday && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 border-2 border-white shadow-sm flex items-center justify-center animate-bounce z-10 pointer-events-none" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                            <Cake size={9} className="text-white" />
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        className="lg:hidden shrink-0 w-full"
                        style={{ height: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
                    />

                    {/* Content */}
                    <div id="main-scroll" className={`lg:flex-1 lg:min-h-0 lg:overflow-hidden relative bg-transparent lg:pt-2 pb-4 lg:pr-2 px-2 lg:px-0 ${hasSelfOnly && isMobile ? 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))]' : ''}`}>
                        {!isMobile && (
                            <div className="absolute top-4 right-5 z-[200] hidden lg:block">
                                <NotificationBell variant="desktop" />
                            </div>
                        )}
                        <div key={activeId} className="lg:h-full w-full animate-route-enter">
                            {children}
                        </div>
                    </div>
                </main>

                {/* ── Bottom tabs ── */}
                {hasSelfOnly && (
                    <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-[max(env(safe-area-inset-bottom,16px),16px)] transition-all duration-500 ${blurClasses}`}>
                        <div className="flex items-center justify-around rounded-[1.75rem] px-2 py-2 border
                            bg-white/80 backdrop-blur-2xl border-white/60 shadow-[0_-4px_30px_rgba(0,0,0,0.06)]">
                            {selfItems.map(({ key, path, label, icon: Icon }) => { 
                                const pathSeg = path.replace(/^\//, '').split('/')[0];
                                const isActive = activeId === pathSeg;
                                const badge = getBadge(key);
                                return (
                                    <button key={key} onClick={() => navigate(path)} className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-[1.25rem] transition-all duration-200 flex-1 ${isActive ? 'bg-[#0052CC]/10' : 'hover:bg-slate-100/60'}`}>
                                        <div className="relative">
                                            <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} className={isActive ? 'text-[#0052CC]' : 'text-slate-400'} />
                                            {badge > 0 && (
                                                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                                    {badge > 9 ? '9+' : badge}
                                                </span>
                                            )}
                                        </div>
                                        <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${isActive ? 'text-[#0052CC]' : 'text-slate-400'}`}>{label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </nav>
                )}

                {/* ── Flyout tooltip ── */}
                {!isMobile && flyout && (
                    <div
                        className="fixed z-[300] pointer-events-auto"
                        style={{ left: flyout.x, top: flyout.y, transform: 'translateY(-50%)' }}
                        onMouseEnter={() => clearTimeout(flyoutTimerRef.current)}
                        onMouseLeave={closeFlyout}
                    >
                        {flyout.type === 'item' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-150">
                                <button
                                    onClick={() => { navigate(flyout.path); setFlyout(null); }}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[1rem]
                                        backdrop-blur-2xl backdrop-saturate-150 border shadow-[0_8px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]
                                        transition-all duration-150 active:scale-[0.97] group/fi
                                        ${flyout.isActive
                                            ? 'bg-[#1A3560]/85 border-[#2D5499]/60'
                                            : 'bg-[#0D2040]/80 border-[#1E3A6E]/60 hover:bg-[#1A3560]/85 hover:border-[#2D5499]/60'}`}
                                    type="button"
                                >
                                    <div className={`w-8 h-8 rounded-[0.65rem] flex items-center justify-center flex-shrink-0
                                        ${flyout.isActive ? 'bg-[#4D94FF]/25' : 'bg-white/8 group-hover/fi:bg-[#4D94FF]/20'}`}>
                                        <flyout.icon
                                            size={16}
                                            strokeWidth={flyout.isActive ? 2 : 1.5}
                                            className={flyout.isActive ? 'text-[#7DB8FF]' : 'text-white/55 group-hover/fi:text-[#7DB8FF]'}
                                        />
                                    </div>
                                    <span className="text-[13px] font-semibold whitespace-nowrap text-white Bone pr-1">{flyout.label}</span>
                                    {flyout.badge > 0 && (
                                        <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                            {flyout.badge > 9 ? '9+' : flyout.badge}
                                        </span>
                                    )}
                                    {flyout.alert && (
                                        <span className="relative flex h-2 w-2 flex-shrink-0">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                        </span>
                                    )}
                                    {flyout.isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#4D94FF] shadow-[0_0_6px_rgba(77,148,255,0.8)] flex-shrink-0" />}
                                </button>
                            </div>
                        ) : flyout.type === 'group' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-150 min-w-[220px]">
                                <div className="relative rounded-[1.4rem] overflow-hidden
                                    bg-[#0A1628]/80 backdrop-blur-2xl backdrop-saturate-150
                                    border border-white/12
                                    shadow-[0_16px_48px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]">

                                    <div className="px-4 pt-3.5 pb-2.5 border-b border-white/8 flex items-center gap-2">
                                        <div className="w-[3px] h-3.5 rounded-full bg-gradient-to-b from-[#7DB8FF] to-[#4D94FF] shadow-[0_0_6px_rgba(77,148,255,0.6)]" />
                                        <span className="text-white/60 text-[10px] font-black uppercase tracking-[0.18em]">{flyout.label}</span>
                                    </div>

                                    <div className="p-1.5 space-y-0.5">
                                        {flyout.items.map(m => {
                                            const MIcon = m.icon;
                                            if (m.comingSoon) return (
                                                <div key={m.key}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.85rem] opacity-50 cursor-default select-none"
                                                >
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/6">
                                                        <MIcon size={14} strokeWidth={1.5} className="text-white/40" />
                                                    </div>
                                                    <span className="text-[13px] font-medium text-white/40 flex-1 whitespace-nowrap">{m.label}</span>
                                                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                        Próximamente
                                                    </span>
                                                </div>
                                            );
                                            return (
                                                <button
                                                    key={m.key}
                                                    onClick={() => { navigate(m.path); setFlyout(null); }}
                                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.85rem] transition-all duration-150 text-left group/fi active:scale-[0.97]
                                                        ${m.isActive
                                                            ? 'bg-[#1A3560] text-white border border-[#2D5499]/50'
                                                            : 'text-white hover:bg-[#1A3560]'}`}
                                                >
                                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-150
                                                        ${m.isActive
                                                            ? 'bg-[#4D94FF]/25 shadow-[0_2px_8px_rgba(77,148,255,0.25)]'
                                                            : 'bg-white/8 group-hover/fi:bg-white/14'}`}>
                                                        <MIcon
                                                            size={14}
                                                            strokeWidth={m.isActive ? 2 : 1.5}
                                                            className={m.isActive ? 'text-[#7DB8FF]' : 'text-white/70 group-hover/fi:text-white'}
                                                        />
                                                    </div>
                                                    <span className="text-[13px] font-medium whitespace-nowrap flex-1">{m.label}</span>
                                                    {m.isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#4D94FF] shadow-[0_0_6px_rgba(77,148,255,0.8)] flex-shrink-0" />}
                                                    {m.badge > 0 && (
                                                        <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                                            {m.badge > 9 ? '9+' : m.badge}
                                                        </span>
                                                    )}
                                                    {m.alert && (
                                                        <span className="relative flex h-2 w-2 flex-shrink-0">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : flyout.type === 'user' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-150">
                                <button
                                    onClick={() => { navigate('/profile'); setFlyout(null); }}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-[1rem]
                                        bg-[#0D2040]/80 backdrop-blur-2xl backdrop-saturate-150 border border-[#1E3A6E]/60
                                        shadow-[0_8px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]
                                        hover:bg-[#1A3560]/85 hover:border-[#2D5499]/60 transition-all duration-150 active:scale-[0.97]"
                                    type="button"
                                >
                                    <div className="w-9 h-9 rounded-[0.75rem] overflow-hidden flex-shrink-0 border border-white/20 bg-white/10 flex items-center justify-center">
                                        {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={17} className="text-[#7DB8FF]" />}
                                    </div>
                                    <div className="flex flex-col items-start pr-1">
                                        <span className="text-[13px] font-semibold text-[#7DB8FF] whitespace-nowrap leading-tight">{user?.name || 'Usuario'}</span>
                                        <span className="text-[11px] text-[#7DB8FF]/60 whitespace-nowrap max-w-[140px] truncate leading-tight mt-0.5">{cargoLabel}</span>
                                    </div>
                                </button>
                            </div>
                        ) : null}
                    </div>
                )}
                
                {/* Bottom safe-area glass strip */}
                <div
                    className="lg:hidden fixed bottom-0 left-0 right-0 z-10 pointer-events-none"
                    style={{
                        height: 'env(safe-area-inset-bottom, 0px)',
                        background: 'rgba(221,216,255,0.72)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                    }}
                />
            </div>

            <PushPromptBanner />
            <OfflineBanner />

        </LayoutGroup>
    );
};

export default AppLayout;