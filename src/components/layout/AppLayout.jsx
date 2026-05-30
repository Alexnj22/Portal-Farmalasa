import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Activity, Copy, CheckCircle2,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, BellRing, LayoutDashboard,
    TrendingUp, Tag, Gift, Users, Package, DollarSign, FileText, BarChart2, PenLine, Receipt, Target, FlaskConical
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getHourlyCode, getSuPinSuffix } from '../../utils/helpers';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
const MODULE_MAP = {
    overview:          { path: '/overview',        label: 'Dashboard',                icon: LayoutDashboard },
    emp_home:          { path: '/home',           label: 'Inicio',                   icon: Home          },
    emp_requests:      { path: '/my-requests',    label: 'Mis Solicitudes',          icon: ClipboardList },
    emp_announcements: { path: '/my-announcements',label: 'Mis Avisos',              icon: Bell          },
    emp_profile:       { path: '/profile',         label: 'Mi Perfil',               icon: User          },
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
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icon: TrendingUp },
    metas:             { path: '/metas',            label: 'Metas',                    icon: Target     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icon: FileText   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icon: Receipt    },
    encuesta:          { path: '/encuesta',         label: 'Clima Organizacional',     icon: BarChart2  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icon: PenLine    },
    promociones:       { path: '/promociones',      label: 'Promociones',              icon: Tag,          comingSoon: true },
    bonificaciones:    { path: '/bonificaciones',   label: 'Bonificaciones',           icon: Gift,         comingSoon: true },
    entrevistas:       { path: '/entrevistas',      label: 'Entrevistas',              icon: Users,        comingSoon: true },
    productos:         { path: '/productos',        label: 'Productos',                icon: Package       },
    laboratorios:      { path: '/laboratorios',     label: 'Laboratorios',             icon: FlaskConical  },
    pedidos:           { path: '/pedidos',          label: 'Pedidos a Sucursales',     icon: ClipboardList },
};

// ── Grupos del menú (define el orden y agrupación) ──────────────────────────
// Cuando un grupo tiene 1 solo módulo visible → se muestra como ítem plano (sin cabecera).
// Cuando tiene 2+ módulos visibles → se muestra como grupo colapsable.
const MENU_GROUPS = [
    { key: 'overview',      label: 'Dashboard',     icon: LayoutDashboard, modules: ['overview']                          },
    { key: 'inicio',        label: 'Inicio',        icon: Home,          modules: ['emp_home']                            },
    { key: 'personal',      label: 'Personal',      icon: User,          modules: ['staff_list', 'payroll']               },
    { key: 'horarios',      label: 'Horarios y Turnos', icon: Calendar,  modules: ['schedules']                           },
    { key: 'solicitudes',   label: 'Solicitudes',   icon: ClipboardList, modules: ['emp_requests', 'requests']            },
    { key: 'avisos',        label: 'Avisos',         icon: Bell,          modules: ['emp_announcements', 'announcements']  },
    { key: 'documentos',    label: 'Documentos',    icon: FolderOpen,    modules: ['emp_documents']                       },
    { key: 'asistencia',    label: 'Asistencia',    icon: Monitor,       modules: ['monitor', 'time_audit']               },
    { key: 'planificacion', label: 'Planificación', icon: Palmtree,      modules: ['vacation_plan']                       },
    { key: 'estructura',    label: 'Estructura',    icon: Building2,     modules: ['branches', 'roles']                   },
    { key: 'sistema',       label: 'Sistema',       icon: Lock,          modules: ['permissions', 'auditview']            },
    { key: 'comercial',    label: 'Comercial',     icon: TrendingUp,    modules: ['ventas', 'metas', 'facturacion', 'cotizaciones', 'promociones', 'bonificaciones'] },
    { key: 'rrhh',         label: 'RRHH',          icon: Users,         modules: ['entrevistas', 'encuesta_admin'] },
    { key: 'inventario',   label: 'Inventario',    icon: Package,       modules: ['productos', 'laboratorios', 'pedidos'] },
];

// Self-service module keys (for bottom tabs logic)
const SELF_KEYS = ['emp_home', 'emp_requests', 'emp_announcements', 'emp_profile', 'emp_documents'];

const AppLayout = ({ children, isOverlayActive = false, handleLogout }) => {
    const { user, hasPermission, systemRole } = useAuth();
    const branches = useStaff((state) => state.branches);
    const announcements = useStaff((state) => state.announcements);
    const navigate = useNavigate();
    const location = useLocation();

    const [isMobile, setIsMobile] = useState(false);
    const [isWide, setIsWide] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [openGroups, setOpenGroups] = useState({});  // groupKey → bool

    const [authPin, setAuthPin] = useState(getHourlyCode());
    const [suSuffix, setSuSuffix] = useState(getSuPinSuffix());
    const [isCopied, setIsCopied] = useState(false);
    const [isSuCopied, setIsSuCopied] = useState(false);

    // Flyout tooltip (desktop compact mode)
    const [flyout, setFlyout] = useState(null); // { type:'item'|'group', label, items?, x, y }
    const flyoutTimerRef = useRef(null);
    const asideRef = useRef(null);

    const navRef = useRef(null);
    const groupHeaderRefs = useRef(new Map()); // groupKey → DOM el (for pill in compact mode)
    const itemRefs = useRef(new Map());
    const [pill, setPill] = useState({ top: 0, height: 44, show: false });
    const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

    // Current active path segment
    const activePath = location.pathname;
    const activeId = activePath.split('/')[1] || '';

    const cargoLabel = (() => {
        if (typeof user?.role === 'string' && isNaN(Number(user.role))) return user.role;
        const map = { SUPERADMIN: 'Super Admin', ADMIN: 'Administrador', EMPLEADO: 'Colaborador' };
        return map[systemRole] || systemRole || '';
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
        if (isMobile) setIsSidebarOpen(false);
        else setIsSidebarOpen(isWide);
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

    // ── Construir grupos visibles con permisos ──
    const visibleGroups = useMemo(() => {
        return MENU_GROUPS.map(g => {
            const visibleModules = g.modules
                .filter(key => MODULE_MAP[key]?.comingSoon || hasPermission(key, 'can_view'))
                .map(key => ({ key, ...MODULE_MAP[key] }));
            return { ...g, visibleModules };
        }).filter(g => g.visibleModules.length > 0);
    }, [hasPermission]);

    // Auto-open the group that contains the active route, close the rest
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // ── Flyout helpers ──
    const openFlyout = useCallback((data) => {
        clearTimeout(flyoutTimerRef.current);
        setFlyout(data);
    }, []);
    const closeFlyout = useCallback(() => {
        flyoutTimerRef.current = setTimeout(() => setFlyout(null), 80);
    }, []);

    // ── Alerts & badges ──
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
        });
    }, [announcements, user]);

    const unreadCount = unreadAnnouncements.length;
    const hasUrgentUnread = unreadAnnouncements.some(a => a.priority === 'URGENT');

    const getBadge = (key) => {
        if (key === 'emp_announcements' && unreadCount > 0) return unreadCount;
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

    // Bell: show for users who can receive announcements
    const showBell = hasPermission('emp_announcements', 'can_view');
    const isOnAnnouncements = activeId === 'my-announcements';

    const isExpanded = isMobile ? isSidebarOpen : isSidebarOpen;
    const blurClasses = isOverlayActive
        ? 'pointer-events-none select-none scale-[0.98] blur-[2px]'
        : 'scale-100 blur-0';

    // ── Pill animation ──
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

    // Bottom tabs: only for users who have ONLY self-service modules
    const allModuleKeys = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => !m.comingSoon).map(m => m.key)),
    [visibleGroups]);
    const hasSelfOnly = allModuleKeys.length > 0 && allModuleKeys.every(k => SELF_KEYS.includes(k));
    const selfItems = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => SELF_KEYS.includes(m.key))),
    [visibleGroups]);

    // ── Render a single nav item button ──
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

        const navItemInactive   = 'text-white/60 hover:text-white/90 hover:bg-white/[0.06]';
        const iconActiveColor   = 'text-white';
        const iconInactiveColor = 'text-white/45 group-hover:text-white/75';
        const accentBarInactive = 'bg-white/20';
        const accentBarActive   = 'bg-gradient-to-b from-white/85 via-white/60 to-white/25';

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
                className={`w-full flex items-center gap-2.5 rounded-[1rem] transition-all duration-300 group relative text-left
                    ${indent ? 'px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5' : 'px-3 py-3 xl:px-4 xl:py-3.5'}
                    ${isActive ? 'text-white' : navItemInactive}
                    active:scale-[0.99]`}
            >
                {/* Left accent for subitems */}
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
                        <span className="absolute -top-1 -right-1 relative flex h-2 w-2">
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

    // ── Render a group (with header + collapsible children) ──
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
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 xl:px-4 xl:py-3 rounded-[1rem] transition-all duration-300 group text-left
                        ${hasActiveChild
                            ? 'text-white'
                            : 'text-white/60 hover:text-white/90 hover:bg-white/[0.06]'}
                        active:scale-[0.99]`}
                >
                    <GroupIcon
                        size={20}
                        strokeWidth={hasActiveChild ? 2 : 1.5}
                        className={`flex-shrink-0 transition-all duration-300 ${hasActiveChild
                            ? 'text-white scale-110'
                            : 'text-white/42 group-hover:text-white/72 group-hover:scale-110'}`}
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
        <div className="flex w-full min-h-[100dvh] font-sans overflow-hidden relative">

            {/* ── Global ambient orbs ── */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
                <div className="fls-orb-portal absolute rounded-full" style={{ width:'80vw', height:'80vw', top:'-30%', left:'-20%', background:'radial-gradient(circle, rgba(110,70,230,0.32) 0%, transparent 68%)', filter:'blur(55px)', animation:'flsOrb1 11s ease-in-out infinite alternate', willChange:'transform' }} />
                <div className="fls-orb-portal absolute rounded-full" style={{ width:'65vw', height:'65vw', top:'0%', right:'-25%', background:'radial-gradient(circle, rgba(60,100,240,0.24) 0%, transparent 68%)', filter:'blur(55px)', animation:'flsOrb2 13s ease-in-out infinite alternate', willChange:'transform' }} />
                <div className="fls-orb-portal absolute rounded-full" style={{ width:'90vw', height:'90vw', bottom:'-45%', left:'0%', background:'radial-gradient(circle, rgba(150,90,240,0.22) 0%, transparent 68%)', filter:'blur(65px)', animation:'flsOrb1 16s ease-in-out 2s infinite alternate', willChange:'transform' }} />
                <div className="fls-orb-portal absolute rounded-full" style={{ width:'50vw', height:'50vw', top:'30%', left:'60%', background:'radial-gradient(circle, rgba(90,150,255,0.18) 0%, transparent 68%)', filter:'blur(45px)', animation:'flsOrb2 9s ease-in-out 1s infinite alternate', willChange:'transform' }} />
                <div className="fls-orb-portal absolute rounded-full" style={{ width:'35vw', height:'35vw', top:'55%', left:'35%', background:'radial-gradient(circle, rgba(200,130,255,0.15) 0%, transparent 68%)', filter:'blur(38px)', animation:'flsOrb1 7s ease-in-out 3s infinite alternate', willChange:'transform' }} />
            </div>

            {/* Mobile backdrop */}
            {isMobile && isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-[#030B1C]/40 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* ── Sidebar ── */}
            <motion.aside
                ref={asideRef}
                layout
                initial={false}
                animate={isMobile ? { x: isSidebarOpen ? 0 : 'calc(-100% - 16px)' } : {}}
                transition={{ layout: { duration: 0.22, ease: [0.4, 0, 0.2, 1] }, x: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } }}
                className={`fixed lg:relative z-50 lg:z-[60] h-[calc(100dvh-16px)] lg:h-auto
                    ${isMobile
                        ? 'w-[85%] max-w-[280px] left-2'
                        : (isSidebarOpen ? 'w-[15rem] xl:w-[16.5rem] 2xl:w-[18rem] ml-[max(env(safe-area-inset-left,8px),8px)]' : 'w-[4.5rem] xl:w-[5rem] ml-[max(env(safe-area-inset-left,8px),8px)]')}
                    flex flex-col shrink-0
                    my-[max(env(safe-area-inset-top,8px),8px)] mb-[max(env(safe-area-inset-bottom,8px),8px)] ${blurClasses}`}
            >
                {/* ── Ambient glow layers ── */}
                <div className="sidebar-ambient absolute inset-y-0 left-0 w-full -z-10 pointer-events-none">
                    <div className="absolute top-0 left-0 right-0 h-2/3 rounded-t-[2.6rem] bg-slate-500/[0.06] blur-3xl" />
                    <div className="absolute -inset-5 right-0 rounded-[3.5rem] bg-black/35 blur-[45px] opacity-80" />
                    <div className="absolute -inset-10 right-[-4px] rounded-[5rem] bg-black/20 blur-[70px] opacity-50" />
                </div>

                {/* ── Glass container ── */}
                <div data-surface="sidebar" className="absolute inset-y-0 left-0 w-full z-10 rounded-[2.5rem] overflow-hidden flex flex-col
                    bg-[#0f172a]/92 backdrop-blur-xl
                    border border-white/[0.09]
                    shadow-[inset_1px_0_0_rgba(255,255,255,0.09),inset_0_1px_0_rgba(255,255,255,0.13),0_0_0_1px_rgba(0,0,0,0.5),0_32px_64px_rgba(0,0,0,0.35)]">

                    {/* Depth layers */}
                    <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/[0.05] to-transparent pointer-events-none z-0" />
                    <div className="absolute left-0 inset-y-0 w-[1px] bg-gradient-to-b from-white/25 via-white/8 to-white/2 pointer-events-none z-0" />
                    <div className="absolute right-0 inset-y-0 w-[1px] bg-gradient-to-b from-white/5 via-transparent to-transparent pointer-events-none z-0" />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/25 to-transparent pointer-events-none z-0" />

                    {/* ── Logo header ── */}
                    <div className={`relative z-10 flex items-center border-b border-white/[0.07]
                        ${isExpanded ? 'px-4 py-3.5 justify-between' : 'px-2 py-3.5 justify-center'}`}>
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent pointer-events-none" />

                        <div className="flex items-center gap-3 relative z-10">
                            <div className="relative group/logo flex-shrink-0 cursor-pointer"
                                onClick={() => navigate('/')}>
                                <div className="absolute -inset-1.5 rounded-[1.5rem] blur-lg opacity-0 group-hover/logo:opacity-100 transition-all duration-500 bg-white/8" />
                                <div className={`relative flex items-center justify-center rounded-[1.25rem] overflow-hidden
                                    transition-all duration-300 group-hover/logo:scale-105
                                    bg-white/10 border border-white/15
                                    shadow-[0_4px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.2)]
                                    group-hover/logo:border-white/25 group-hover/logo:bg-white/15
                                    ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'}`}>
                                    <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none rounded-t-[1.25rem]" />
                                    <img src="/LogoFLS.svg" alt="FLS"
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
                    <nav ref={navRef} className="relative z-10 flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
                        {/* Active pill */}
                        <div
                            className={`absolute left-2 right-2 rounded-[0.875rem] transform-gpu transition-opacity duration-200 pointer-events-none
                                bg-gradient-to-r from-white/[0.11] to-white/[0.04]
                                border border-white/[0.10]
                                shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_-1px_0_rgba(0,0,0,0.12)]
                                ${pill.show ? 'opacity-100' : 'opacity-0'}`}
                            style={{ top: pill.top, height: pill.height }}
                        >
                            <div className="absolute left-0 inset-y-[18%] w-[2px] rounded-full bg-gradient-to-b from-white/80 via-white/50 to-white/15" />
                        </div>

                        {visibleGroups.map(g => renderGroup(g))}
                    </nav>

                    {/* ── Footer ── */}
                    <div className="relative z-10 px-3 pb-4 pt-3 border-t border-white/[0.07] flex flex-col gap-2.5">
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

                        {isExpanded ? (
                            <>
                                {/* PIN row — expanded */}
                                {hasPermission('kiosk_pin', 'can_view') && (
                                    <div className={`grid gap-1.5 ${hasPermission('su_pin', 'can_view') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                        {/* PIN card */}
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
                                        {/* SU-PIN card */}
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
                                <div className="flex items-center gap-2 group/user">
                                    <button onClick={() => navigate('/profile')}
                                        className="flex-1 flex items-center gap-3 p-2 -mx-1 rounded-[1rem] text-left transition-all duration-200 active:scale-[0.98] hover:bg-white/[0.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                                        type="button">
                                        <div className="h-9 w-9 rounded-[0.85rem] overflow-hidden flex-shrink-0 flex items-center justify-center transition-all border border-white/12 shadow-[0_4px_12px_rgba(0,0,0,0.4)] bg-white/[0.08] text-white/55 group-hover/user:border-white/20">
                                            {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} strokeWidth={1.5} />}
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <p className="text-[13px] font-semibold truncate transition-colors leading-tight text-white/80 group-hover/user:text-white">{user?.name || 'Usuario'}</p>
                                        </div>
                                    </button>
                                    <button onClick={handleLogout}
                                        className="p-2 rounded-[0.85rem] border border-transparent transition-all flex-shrink-0 hover:scale-105 active:scale-[0.97] text-white/40 hover:text-red-400 hover:bg-red-500/[0.14] hover:border-red-500/[0.18]"
                                        type="button">
                                        <LogOut size={16} strokeWidth={1.8} />
                                    </button>
                                </div>
                            </>
                        ) : (
                            /* Icon column compact */
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
                                <button onClick={() => navigate('/profile')} type="button"
                                    onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
                                        openFlyout({ type: 'user', x, y: rect.top + rect.height / 2 });
                                    }}
                                    onMouseLeave={closeFlyout}
                                    className="w-11 h-11 rounded-[1.1rem] overflow-hidden flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-[0.97]
                                        bg-white/[0.08] border border-white/[0.12] text-white/55
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_rgba(0,0,0,0.3)]
                                        hover:bg-white/[0.14] hover:border-white/[0.20] hover:shadow-[0_6px_18px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.18)]">
                                    {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={17} strokeWidth={1.5} />}
                                </button>
                                <button onClick={handleLogout} type="button"
                                    className="w-11 h-11 rounded-[1.1rem] flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-[0.97]
                                        bg-red-500/[0.08] border border-red-500/[0.12] text-red-400/60
                                        hover:text-red-300 hover:bg-red-500/[0.18] hover:border-red-500/[0.22]
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_4px_14px_rgba(239,68,68,0.2),inset_0_1px_0_rgba(255,255,255,0.12)]">
                                    <LogOut size={15} strokeWidth={1.8} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </motion.aside>

            {/* ── Main content ── */}
            <motion.main layout initial={false} transition={{ layout: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } }} className={`flex-1 flex flex-col overflow-hidden relative z-20 ${blurClasses}`}>
                {/* Mobile top bar */}
                <div className="lg:hidden px-4 pt-[max(env(safe-area-inset-top,12px),12px)] pb-2 relative z-40 w-full shrink-0">
                    <div className="flex items-center justify-between rounded-[2rem] p-2 pl-5 transition-all duration-300 border
                        bg-white/60 backdrop-blur-[40px] border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.9)]">
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
                            {showBell && unreadCount > 0 && (
                                <button
                                    onClick={() => navigate('/my-announcements')}
                                    className={`relative w-11 h-11 rounded-[1.4rem] border shadow-sm active:scale-[0.97] transition-all flex items-center justify-center hover:shadow-md
                                        ${hasUrgentUnread ? 'bg-red-50 border-red-200' : 'bg-white border-white/60'}`}
                                >
                                    <BellRing
                                        size={18}
                                        strokeWidth={2}
                                        className={hasUrgentUnread ? 'text-red-500 animate-wiggle' : 'text-[#0052CC]'}
                                    />
                                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm z-10">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                    <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-red-400 animate-ping opacity-60" />
                                </button>
                            )}
                            <button onClick={() => navigate('/profile')} className="w-11 h-11 rounded-[1.4rem] shadow-md overflow-hidden active:scale-[0.97] transition-all flex items-center justify-center relative group hover:shadow-lg border bg-white border-white">
                                <div className="absolute inset-0 bg-[#0052CC]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} className="text-slate-400" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className={`flex-1 overflow-hidden relative bg-transparent rounded-[2.5rem] lg:pt-2 pb-4 lg:pr-2 px-2 lg:px-0 mt-2 lg:mt-0 ${hasSelfOnly && isMobile ? 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))]' : ''}`}>
                    {/* Desktop global bell */}
                    {showBell && !isMobile && !isOnAnnouncements && unreadCount > 0 && (
                        <div className="absolute top-4 right-5 z-[200] hidden lg:block">
                            <div className={`absolute -inset-3 rounded-[2rem] blur-xl pointer-events-none
                                ${hasUrgentUnread ? 'bg-red-500/30' : 'bg-[#0052CC]/20'}`} />
                            {hasUrgentUnread && (
                                <span className="absolute inset-0 rounded-[1.25rem] bg-red-400/25 animate-ping" style={{ animationDuration: '1.5s' }} />
                            )}
                            <button
                                onClick={() => navigate('/my-announcements')}
                                className={`relative flex items-center justify-center w-11 h-11 rounded-[1.25rem]
                                    backdrop-blur-2xl border
                                    shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.06)]
                                    hover:-translate-y-0.5 hover:scale-105 active:scale-[0.97] active:translate-y-0
                                    transition-all duration-200
                                    ${hasUrgentUnread
                                        ? 'bg-red-50/90 border-red-300/80 hover:shadow-[0_12px_40px_rgba(239,68,68,0.3),inset_0_1px_0_rgba(255,255,255,1)]'
                                        : 'bg-white/75 border-blue-200/80 hover:shadow-[0_12px_40px_rgba(0,82,204,0.22),inset_0_1px_0_rgba(255,255,255,1)]'}`}
                            >
                                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/80 to-transparent rounded-t-[1.25rem] pointer-events-none" />
                                <div className={`absolute inset-0 rounded-[1.25rem] pointer-events-none
                                    ${hasUrgentUnread ? 'bg-gradient-to-br from-red-500/10 via-transparent to-transparent' : 'bg-gradient-to-br from-[#0052CC]/8 via-transparent to-transparent'}`} />
                                <BellRing
                                    size={18}
                                    strokeWidth={2}
                                    className={`relative z-10 transition-colors ${hasUrgentUnread ? 'text-red-500 animate-[wiggle_0.4s_ease-in-out_infinite]' : 'text-[#0052CC]'}`}
                                />
                                <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-white text-[9px] font-black rounded-full flex items-center justify-center z-20
                                    ${hasUrgentUnread
                                        ? 'bg-red-500 shadow-[0_2px_8px_rgba(239,68,68,0.6)]'
                                        : 'bg-red-500 shadow-[0_2px_8px_rgba(239,68,68,0.4)]'}`}>
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                                <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full animate-ping opacity-60 z-10 bg-red-400" />
                            </button>
                        </div>
                    )}
                    <div key={activeId} className="h-full w-full animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] fill-mode-both">
                        {children}
                    </div>
                </div>
            </motion.main>

            {/* ── Bottom tabs (solo para usuarios con solo autogestión) ── */}
            {hasSelfOnly && (
                <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-[max(env(safe-area-inset-bottom,16px),16px)] transition-all duration-500 ${blurClasses}`}>
                    <div className="flex items-center justify-around rounded-[1.75rem] px-2 py-2 border
                        bg-white/80 backdrop-blur-2xl border-white/60 shadow-[0_-4px_30px_rgba(0,0,0,0.06)]">
                        {selfItems.map(({ key, path, label, icon: Icon }) => { // eslint-disable-line no-unused-vars
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

            {/* ── Flyout tooltip (desktop compact mode only) ── */}
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
                                <span className="text-[13px] font-semibold whitespace-nowrap text-white leading-none pr-1">{flyout.label}</span>
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
        </div>
        </LayoutGroup>
    );
};

export default AppLayout;
