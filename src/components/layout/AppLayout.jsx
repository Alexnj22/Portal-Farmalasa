import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Sparkles, Activity, Copy, CheckCircle2,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, BellRing, LayoutDashboard
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getHourlyCode } from '../../utils/helpers';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
const MODULE_MAP = {
    overview:          { path: '/overview',        label: 'Dashboard',                icon: LayoutDashboard },
    emp_home:          { path: '/home',           label: 'Inicio',                   icon: Home          },
    emp_requests:      { path: '/my-requests',    label: 'Mis Solicitudes',          icon: ClipboardList },
    emp_announcements: { path: '/my-announcements',label: 'Mis Avisos',              icon: Bell          },
    emp_profile:       { path: '/profile',         label: 'Mi Perfil',               icon: User          },
    emp_documents:     { path: '/my-documents',   label: 'Mis Documentos',           icon: FolderOpen    },
    staff_list:        { path: '/dashboard',       label: 'Listado de Personal',      icon: User          },
    monitor:           { path: '/monitor',         label: 'Monitor Real-Time',        icon: Monitor       },
    time_audit:        { path: '/audit',           label: 'Auditoría de Tiempos',     icon: AlertTriangle },
    schedules:         { path: '/schedules',       label: 'Horarios y Turnos',        icon: Calendar      },
    requests:          { path: '/requests',        label: 'Gestión de Solicitudes',   icon: ClipboardList },
    vacation_plan:     { path: '/vacation-plan',   label: 'Plan de Vacaciones',       icon: Palmtree      },
    branches:          { path: '/branches',        label: 'Sucursales',               icon: Building2     },
    roles:             { path: '/roles',           label: 'Cargos / Organigrama',     icon: ShieldCheck   },
    announcements:     { path: '/announcements',   label: 'Gestionar Avisos',         icon: Megaphone     },
    permissions:       { path: '/permissions',     label: 'Permisos de Acceso',       icon: Lock          },
    auditview:         { path: '/auditview',       label: 'Auditoría General',        icon: Activity      },
};

// ── Grupos del menú (define el orden y agrupación) ──────────────────────────
// Cuando un grupo tiene 1 solo módulo visible → se muestra como ítem plano (sin cabecera).
// Cuando tiene 2+ módulos visibles → se muestra como grupo colapsable.
const MENU_GROUPS = [
    { key: 'overview',      label: 'Dashboard',     icon: LayoutDashboard, modules: ['overview']                          },
    { key: 'inicio',        label: 'Inicio',        icon: Home,          modules: ['emp_home']                            },
    { key: 'personal',      label: 'Personal',      icon: User,          modules: ['staff_list']                          },
    { key: 'horarios',      label: 'Horarios y Turnos', icon: Calendar,  modules: ['schedules']                           },
    { key: 'solicitudes',   label: 'Solicitudes',   icon: ClipboardList, modules: ['emp_requests', 'requests']            },
    { key: 'avisos',        label: 'Avisos',         icon: Bell,          modules: ['emp_announcements', 'announcements']  },
    { key: 'documentos',    label: 'Documentos',    icon: FolderOpen,    modules: ['emp_documents']                       },
    { key: 'asistencia',    label: 'Asistencia',    icon: Monitor,       modules: ['monitor', 'time_audit']               },
    { key: 'planificacion', label: 'Planificación', icon: Palmtree,      modules: ['vacation_plan']                       },
    { key: 'estructura',    label: 'Estructura',    icon: Building2,     modules: ['branches', 'roles']                   },
    { key: 'sistema',       label: 'Sistema',       icon: Lock,          modules: ['permissions', 'auditview']            },
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
    const [isCopied, setIsCopied] = useState(false);

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
        const timer = setInterval(() => setAuthPin(getHourlyCode()), 10000);
        return () => clearInterval(timer);
    }, []);

    // ── Construir grupos visibles con permisos ──
    const visibleGroups = useMemo(() => {
        return MENU_GROUPS.map(g => {
            const visibleModules = g.modules
                .filter(key => hasPermission(key, 'can_view'))
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
                // Keep active group open only when opening a DIFFERENT group (accordion)
                // Allow the active group to close itself when clicked directly
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

    // Bell: show for users who can receive announcements
    const showBell = hasPermission('emp_announcements', 'can_view');
    const isOnAnnouncements = activeId === 'my-announcements';

    // Expanded when sidebar is open. NO hover-expand on desktop.
    const isExpanded = isMobile ? isSidebarOpen : isSidebarOpen;
    const blurClasses = isOverlayActive
        ? 'pointer-events-none select-none scale-[0.98] blur-[2px]'
        : 'scale-100 blur-0';

    // ── Pill animation ──
    const recomputePill = () => {
        const navEl = navRef.current;
        let activeEl = itemRefs.current.get(activeId);

        // If active item is inside a group, check whether that group is open
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
            // Compact mode: top-level item ref missing
            const fallback = visibleGroups.find(g =>
                g.visibleModules.length >= 2 &&
                g.visibleModules.some(m => m.path.replace(/^\//, '').split('/')[0] === activeId)
            );
            if (fallback) activeEl = groupHeaderRefs.current.get(fallback.key) ?? activeEl;
        }

        if (!navEl || !activeEl) {
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
        // Track pill every frame for the full animation duration so it stays sticky
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
        visibleGroups.flatMap(g => g.visibleModules.map(m => m.key)),
    [visibleGroups]);
    const hasSelfOnly = allModuleKeys.length > 0 && allModuleKeys.every(k => SELF_KEYS.includes(k));
    const selfItems = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => SELF_KEYS.includes(m.key))),
    [visibleGroups]);

    // ── Render a single nav item button ──
    const renderNavItem = (module, indent = false) => {
        const { key, path, label, icon: Icon } = module;
        const pathSeg = path.replace(/^\//, '').split('/')[0];
        const isActive = activeId === pathSeg || activePath.startsWith(path + '/');
        const badge = getBadge(key);
        const alert = getAlert(key);

        const handleMouseEnter = (!isMobile && !isExpanded) ? (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
            openFlyout({ type: 'item', label, path, icon: Icon, x, y: rect.top + rect.height / 2, badge, alert, isActive });
        } : undefined;

        return (
            <button
                key={key}
                // In compact mode, indented children are hidden — don't overwrite group header refs
                ref={(!indent || isExpanded) ? (el => { if (el) itemRefs.current.set(pathSeg, el); else itemRefs.current.delete(pathSeg); }) : null}
                onClick={() => { navigate(path); if (isMobile) setIsSidebarOpen(false); setFlyout(null); }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={(!isMobile && !isExpanded) ? closeFlyout : undefined}
                type="button"
                className={`w-full flex items-center gap-3 rounded-[1rem] transition-all duration-300 group relative text-left
                    ${indent ? 'px-3 py-2.5 ml-2' : 'px-4 py-3.5'}
                    ${isActive ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/[0.08]'}
                    active:scale-[0.99]`}
            >
                {/* Left accent for subitems */}
                {indent && (
                    <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full transition-all ${isActive ? 'bg-[#1D7AFC]' : 'bg-white/20'}`} />
                )}

                <div className="relative z-10 flex-shrink-0">
                    <Icon
                        size={indent ? 16 : 20}
                        strokeWidth={isActive ? 2 : 1.5}
                        className={`transition-all duration-300 ${isActive ? 'text-[#1D7AFC] scale-110' : 'text-white/55 group-hover:text-white group-hover:scale-110'}`}
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
                        <span className={`text-[13px] flex-1 whitespace-nowrap relative z-10 transition-colors ${isActive ? 'font-semibold' : 'font-medium'}`}>
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

        // Single item → render flat (no group header)
        if (visibleModules.length === 1) {
            return renderNavItem(visibleModules[0], false);
        }

        // Multi-item → collapsible group
        const isOpen = openGroups[key] ?? false;
        const hasActiveChild = visibleModules.some(m => {
            const seg = m.path.replace(/^\//, '').split('/')[0];
            return activeId === seg || activePath.startsWith(m.path + '/');
        });
        // Total unread badge for group when collapsed
        const groupBadge = visibleModules.reduce((sum, m) => sum + getBadge(m.key), 0);
        const groupAlert = visibleModules.some(m => getAlert(m.key));

        return (
            <div key={key} className="space-y-0.5">
                {/* Group header button */}
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
                    className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-[1rem] transition-all duration-300 group text-left
                        ${hasActiveChild ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/[0.08]'}
                        active:scale-[0.99]`}
                >
                    <GroupIcon
                        size={20}
                        strokeWidth={hasActiveChild ? 2 : 1.5}
                        className={`flex-shrink-0 transition-all duration-300 ${hasActiveChild ? 'text-[#1D7AFC] scale-110' : 'text-white/55 group-hover:text-white group-hover:scale-110'}`}
                    />
                    {isExpanded && (
                        <>
                            <span className={`text-[14px] flex-1 whitespace-nowrap transition-colors ${hasActiveChild ? 'font-semibold' : 'font-medium'}`}>
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
                                className={`text-white/40 transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                            />
                        </>
                    )}
                </button>

                {/* Children (animated) */}
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
        <div className="flex w-full min-h-[100dvh] bg-[#F2F2F7] lg:bg-transparent font-sans overflow-hidden relative">

            {/* Mobile backdrop */}
            {isMobile && isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-[#0A2A5E]/40 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* ── Sidebar ── */}
            <aside
                ref={asideRef}
                className={`fixed lg:relative z-50 lg:z-[60] h-[calc(100dvh-16px)] lg:h-auto
                    ${isMobile
                        ? (isSidebarOpen ? 'translate-x-0 w-[85%] max-w-[320px] left-2 shadow-2xl' : '-translate-x-[120%] w-[85%] max-w-[320px] left-2 shadow-none')
                        : (isSidebarOpen ? 'w-[19rem] ml-[max(env(safe-area-inset-left,8px),8px)]' : 'w-[5.5rem] ml-[max(env(safe-area-inset-left,8px),8px)]')}
                    transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] flex flex-col shrink-0
                    my-[max(env(safe-area-inset-top,8px),8px)] mb-[max(env(safe-area-inset-bottom,8px),8px)] ${blurClasses}`}
            >
                {/* ── Ambient glow layers ── */}
                <div className="absolute inset-y-0 left-0 w-full -z-10 pointer-events-none">
                    <div className="absolute -inset-3 rounded-[2.8rem] bg-[#1D7AFC]/12 blur-2xl" />
                    <div className="absolute -inset-6 rounded-[3.4rem] bg-[#0A2A5E]/40 blur-3xl opacity-80" />
                    <div className="absolute -inset-10 rounded-[4rem] bg-[#041636]/50 blur-[60px] opacity-60" />
                    <div className="absolute -inset-14 rounded-[5rem] bg-black/30 blur-[80px] opacity-40" />
                </div>

                {/* ── Glass container ── */}
                <div className="absolute inset-y-0 left-0 w-full z-10 rounded-[2.5rem] overflow-hidden flex flex-col
                    bg-[#081428]/96
                    backdrop-blur-3xl
                    border border-white/14
                    shadow-[0_32px_80px_rgba(0,0,0,0.6),0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.3),inset_1px_0_0_rgba(255,255,255,0.08)]
                    transition-shadow duration-500 hover:shadow-[0_40px_100px_rgba(0,0,0,0.65),0_12px_32px_rgba(29,122,252,0.12),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.3),inset_1px_0_0_rgba(255,255,255,0.1)]">

                    {/* Specular top sheen */}
                    <div className="absolute inset-x-0 top-0 h-[28%] bg-gradient-to-b from-white/10 via-white/4 to-transparent pointer-events-none z-0" />
                    {/* Left edge highlight */}
                    <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-white/35 via-white/12 to-white/3 pointer-events-none z-0" />
                    {/* Right edge shadow */}
                    <div className="absolute right-0 inset-y-0 w-px bg-gradient-to-b from-black/20 via-black/10 to-transparent pointer-events-none z-0" />
                    {/* Bottom fade */}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 to-transparent pointer-events-none z-0" />

                    {/* ── Logo header ── */}
                    <div className={`relative z-10 border-b border-white/10 flex items-center
                        ${isExpanded ? 'px-5 py-4 justify-between' : 'px-3 py-4 justify-center'}`}>
                        {/* Subtle header glow */}
                        <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

                        <div className="flex items-center gap-3 relative z-10">
                            {/* Logo mark */}
                            <div className="relative group/logo flex-shrink-0 cursor-pointer"
                                onClick={() => navigate('/')}>
                                {/* Logo glow */}
                                <div className="absolute -inset-1.5 rounded-[1.5rem] bg-[#1D7AFC]/30 blur-md opacity-0 group-hover/logo:opacity-100 transition-all duration-500" />
                                <div className={`relative flex items-center justify-center rounded-[1.25rem] overflow-hidden
                                    bg-white/12 backdrop-blur-sm
                                    border border-white/20
                                    shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(0,0,0,0.2)]
                                    transition-all duration-300 group-hover/logo:scale-105 group-hover/logo:shadow-[0_12px_32px_rgba(29,122,252,0.35),inset_0_1px_0_rgba(255,255,255,0.35)]
                                    group-hover/logo:border-white/30
                                    ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'}`}>
                                    {/* Inner sheen */}
                                    <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent pointer-events-none rounded-t-[1.25rem]" />
                                    <img src="/LogoFLS.svg" alt="FLS"
                                        className={`object-contain relative z-10 transition-transform duration-300 group-hover/logo:scale-105 ${isExpanded ? 'w-6 h-6' : 'w-7 h-7'}`} />
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="animate-in fade-in zoom-in-95 duration-300 origin-left overflow-hidden">
                                    <h1 className="text-white font-black text-[15px] leading-tight tracking-tight whitespace-nowrap drop-shadow-sm">Portal</h1>
                                    <p className="text-white/50 text-[10px] font-bold uppercase tracking-[0.18em] whitespace-nowrap mt-0.5">La Salud & La Popular</p>
                                </div>
                            )}
                        </div>

                        {isExpanded && (
                            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center
                                    bg-white/6 hover:bg-white/15
                                    border border-white/10 hover:border-white/22
                                    text-white/50 hover:text-white
                                    shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]
                                    hover:shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]
                                    transition-all duration-200 active:scale-95">
                                {isMobile ? <X size={16} strokeWidth={2} /> : <ChevronLeft size={16} strokeWidth={2} />}
                            </button>
                        )}
                    </div>

                    {/* ── Nav ── */}
                    <nav ref={navRef} className="relative z-10 flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-hide">
                        {/* Active pill */}
                        <div
                            className={`absolute left-3 right-3 rounded-[1rem] transform-gpu transition-opacity duration-200 pointer-events-none
                                bg-[#1A3560]/90
                                border border-[#2D5499]/50
                                shadow-[0_4px_20px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)]
                                ${pill.show ? 'opacity-100' : 'opacity-0'}`}
                            style={{ top: pill.top, height: pill.height }}
                        >
                            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/8 to-transparent rounded-t-[1rem]" />
                            <div className="absolute left-0 inset-y-[20%] w-[3px] rounded-full bg-gradient-to-b from-[#5BA8FF] via-[#1D7AFC] to-[#1D7AFC]/50 shadow-[0_0_10px_rgba(29,122,252,0.8)]" />
                            <div className="absolute inset-0 bg-gradient-to-r from-[#1D7AFC]/10 via-transparent to-transparent rounded-[1rem]" />
                        </div>

                        {visibleGroups.map(g => renderGroup(g))}
                    </nav>

                    {/* ── Footer ── */}
                    <div className="relative z-10 px-4 pb-4 pt-3 border-t border-white/8 flex flex-col gap-2.5">
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

                        {isExpanded && (
                            /* Status + PIN row */
                            <div className="flex items-center justify-between
                                rounded-xl px-3 py-2
                                bg-white/5 border border-white/8
                                shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]
                                hover:bg-white/8 hover:border-white/12 transition-all">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                    </span>
                                    <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">En Línea</span>
                                </div>
                                {hasPermission('kiosk_pin', 'can_view') && (
                                    <>
                                        <div className="h-3.5 w-px bg-white/10" />
                                        <button onClick={handleCopyPin} className="flex items-center gap-1.5 group/pin cursor-pointer outline-none hover:scale-105 transition-transform" title="Copiar PIN">
                                            <CheckCircle2 size={13} className="text-[#1D7AFC]" strokeWidth={2} />
                                            <div className="relative w-12 flex items-center justify-center">
                                                <span className={`absolute text-[12px] font-black text-white tracking-widest font-mono transition-all duration-300 ${isCopied ? 'opacity-0 scale-50' : 'opacity-100 scale-100 group-hover/pin:opacity-0 group-hover/pin:scale-90'}`}>{authPin}</span>
                                                <Copy size={13} className={`absolute text-white/80 transition-all duration-300 ${isCopied ? 'opacity-0 scale-50' : 'opacity-0 scale-90 group-hover/pin:opacity-100 group-hover/pin:scale-100'}`} />
                                                <CheckCircle2 size={13} className={`absolute text-emerald-400 transition-all duration-300 ${isCopied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                                            </div>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {isExpanded ? (
                            /* User row expanded */
                            <div className="flex items-center gap-2 group/user">
                                <button onClick={() => navigate('/profile')}
                                    className="flex-1 flex items-center gap-3 p-2 -mx-1 rounded-[1rem] text-left
                                        hover:bg-white/8 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]
                                        transition-all duration-200 active:scale-[0.98]"
                                    type="button">
                                    <div className="h-9 w-9 rounded-[0.85rem] overflow-hidden flex-shrink-0
                                        border border-white/15 shadow-[0_4px_12px_rgba(0,0,0,0.3)]
                                        bg-white/10 flex items-center justify-center text-white/70
                                        group-hover/user:border-[#1D7AFC]/40 transition-all">
                                        {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} strokeWidth={1.5} />}
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <p className="text-[13px] font-semibold text-white/90 truncate group-hover/user:text-white transition-colors leading-tight">{user?.name || 'Usuario'}</p>
                                        <p className="text-[10px] text-white/45 uppercase font-bold tracking-wider truncate mt-0.5">{user?.role || systemRole || 'Sistema'}</p>
                                    </div>
                                </button>
                                <button onClick={handleLogout}
                                    className="p-2 rounded-[0.85rem] text-white/40 hover:text-red-300 hover:bg-red-500/15
                                        border border-transparent hover:border-red-500/20
                                        transition-all flex-shrink-0 hover:scale-105 active:scale-95"
                                    type="button">
                                    <LogOut size={16} strokeWidth={1.8} />
                                </button>
                            </div>
                        ) : (
                            /* Icon column compact */
                            <div className="flex flex-col items-center gap-3 py-1 animate-in fade-in duration-500">
                                {!isMobile && (
                                    <button onClick={() => setIsSidebarOpen(true)}
                                        className="w-10 h-10 rounded-[1rem] flex items-center justify-center mb-1
                                            bg-white/6 border border-white/10
                                            text-white/50 hover:text-white hover:bg-white/14 hover:border-white/20
                                            shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.18)]
                                            hover:scale-105 active:scale-95 transition-all">
                                        <ChevronRight size={17} strokeWidth={2} />
                                    </button>
                                )}
                                {hasPermission('kiosk_pin', 'can_view') && (
                                    <button onClick={handleCopyPin}
                                        className="relative w-11 h-11 rounded-[1.1rem] flex items-center justify-center overflow-hidden group
                                            bg-white/6 border border-white/12
                                            text-[#1D7AFC] hover:bg-white/12 hover:border-white/20
                                            shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_4px_14px_rgba(29,122,252,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]
                                            hover:scale-105 active:scale-95 transition-all"
                                        title="PIN">
                                        {isCopied ? <CheckCircle2 size={17} className="text-emerald-400" /> : (
                                            <>
                                                <CheckCircle2 size={17} className="transition-all duration-300 group-hover:opacity-0 group-hover:scale-50 absolute" />
                                                <span className="absolute opacity-0 scale-150 group-hover:opacity-100 group-hover:scale-100 transition-all font-mono text-[11px] font-black text-white">{authPin}</span>
                                            </>
                                        )}
                                        {!isCopied && (
                                            <span className="absolute top-1.5 right-1.5 flex h-2 w-2 group-hover:hidden">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                                            </span>
                                        )}
                                    </button>
                                )}
                                <button onClick={() => navigate('/profile')} type="button"
                                    className="w-11 h-11 rounded-[1.1rem] overflow-hidden flex items-center justify-center
                                        bg-white/10 border border-white/14
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_12px_rgba(0,0,0,0.25)]
                                        hover:bg-white/18 hover:border-white/25 hover:shadow-[0_6px_18px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]
                                        hover:-translate-y-0.5 active:scale-[0.97] transition-all text-white/75">
                                    {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={17} strokeWidth={1.5} />}
                                </button>
                                <button onClick={handleLogout} type="button"
                                    className="w-11 h-11 rounded-[1.1rem] flex items-center justify-center
                                        bg-red-500/8 border border-white/10
                                        text-red-300/70 hover:text-red-200 hover:bg-red-500/18 hover:border-red-500/25
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_4px_14px_rgba(239,68,68,0.2),inset_0_1px_0_rgba(255,255,255,0.12)]
                                        hover:-translate-y-0.5 active:scale-[0.97] transition-all">
                                    <LogOut size={15} strokeWidth={1.8} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* ── Main content ── */}
            <main className={`flex-1 flex flex-col overflow-hidden relative z-20 transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${blurClasses}`}>
                {/* Mobile top bar */}
                <div className="lg:hidden px-4 pt-[max(env(safe-area-inset-top,12px),12px)] pb-2 relative z-40 w-full shrink-0">
                    <div className="flex items-center justify-between bg-white/60 backdrop-blur-[40px] border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.9)] rounded-[2rem] p-2 pl-5 transition-all duration-300">
                        <div className="flex items-center gap-4">
                            <button onClick={() => setIsSidebarOpen(true)} className="text-[#0A2A5E] hover:text-[#007AFF] active:scale-90 transition-transform">
                                <Menu size={22} strokeWidth={2.5} />
                            </button>
                            <div className="w-px h-6 bg-slate-300/50 rounded-full" />
                            <div className="flex flex-col justify-center">
                                <h1 className="text-[14px] font-black text-slate-800 leading-none tracking-tight">Portal</h1>
                                <p className="text-[8px] font-bold text-[#007AFF] uppercase tracking-[0.2em] mt-0.5">La Salud</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {showBell && unreadCount > 0 && (
                                <button
                                    onClick={() => navigate('/my-announcements')}
                                    className={`relative w-11 h-11 rounded-[1.4rem] border shadow-sm active:scale-95 transition-all flex items-center justify-center hover:shadow-md
                                        ${hasUrgentUnread ? 'bg-red-50 border-red-200' : 'bg-white border-white/60'}`}
                                >
                                    <BellRing
                                        size={18}
                                        strokeWidth={2}
                                        className={hasUrgentUnread ? 'text-red-500 animate-wiggle' : 'text-[#007AFF]'}
                                    />
                                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm z-10">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                    <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-red-400 animate-ping opacity-60" />
                                </button>
                            )}
                            <button onClick={() => navigate('/profile')} className="w-11 h-11 rounded-[1.4rem] bg-white border border-white shadow-md overflow-hidden active:scale-95 transition-all flex items-center justify-center relative group hover:shadow-lg">
                                <div className="absolute inset-0 bg-[#007AFF]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : <User size={18} className="text-slate-400" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden relative bg-transparent rounded-[2.5rem] lg:pt-2 pb-4 lg:pr-2 px-2 lg:px-0 mt-2 lg:mt-0">
                    {/* Desktop global bell — liquid glass, top-right corner */}
                    {showBell && !isMobile && !isOnAnnouncements && unreadCount > 0 && (
                        <div className="absolute top-4 right-5 z-[200] hidden lg:block">
                            {/* Ambient glow */}
                            <div className={`absolute -inset-3 rounded-[2rem] blur-xl pointer-events-none
                                ${hasUrgentUnread ? 'bg-red-500/30' : 'bg-[#007AFF]/20'}`} />
                            {/* Extra pulse ring for urgent */}
                            {hasUrgentUnread && (
                                <span className="absolute inset-0 rounded-[1.25rem] bg-red-400/25 animate-ping" style={{ animationDuration: '1.5s' }} />
                            )}
                            <button
                                onClick={() => navigate('/my-announcements')}
                                className={`relative flex items-center justify-center w-11 h-11 rounded-[1.25rem]
                                    backdrop-blur-2xl border
                                    shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.06)]
                                    hover:-translate-y-0.5 hover:scale-105 active:scale-95 active:translate-y-0
                                    transition-all duration-200
                                    ${hasUrgentUnread
                                        ? 'bg-red-50/90 border-red-300/80 hover:shadow-[0_12px_40px_rgba(239,68,68,0.3),inset_0_1px_0_rgba(255,255,255,1)]'
                                        : 'bg-white/75 border-blue-200/80 hover:shadow-[0_12px_40px_rgba(0,122,255,0.22),inset_0_1px_0_rgba(255,255,255,1)]'}`}
                            >
                                {/* Inner sheen */}
                                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/80 to-transparent rounded-t-[1.25rem] pointer-events-none" />
                                {/* Color tint */}
                                <div className={`absolute inset-0 rounded-[1.25rem] pointer-events-none
                                    ${hasUrgentUnread ? 'bg-gradient-to-br from-red-500/10 via-transparent to-transparent' : 'bg-gradient-to-br from-[#007AFF]/8 via-transparent to-transparent'}`} />

                                <BellRing
                                    size={18}
                                    strokeWidth={2}
                                    className={`relative z-10 transition-colors ${hasUrgentUnread ? 'text-red-500 animate-[wiggle_0.4s_ease-in-out_infinite]' : 'text-[#007AFF]'}`}
                                />
                                <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-white text-[9px] font-black rounded-full flex items-center justify-center z-20
                                    ${hasUrgentUnread
                                        ? 'bg-red-500 shadow-[0_2px_8px_rgba(239,68,68,0.6)]'
                                        : 'bg-red-500 shadow-[0_2px_8px_rgba(239,68,68,0.4)]'}`}>
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                                <span className={`absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full animate-ping opacity-60 z-10
                                    ${hasUrgentUnread ? 'bg-red-400' : 'bg-red-400'}`} />
                            </button>
                        </div>
                    )}
                    <div key={activeId} className="h-full w-full animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] fill-mode-both">
                        {children}
                    </div>
                </div>
            </main>

            {/* ── Bottom tabs (solo para usuarios con solo autogestión) ── */}
            {hasSelfOnly && (
                <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 transition-all duration-500 ${blurClasses}`}>
                    <div className="flex items-center justify-around bg-white/80 backdrop-blur-2xl border border-white/60 rounded-[1.75rem] shadow-[0_-4px_30px_rgba(0,0,0,0.06)] px-2 py-2">
                        {selfItems.map(({ key, path, label, icon: Icon }) => {
                            const pathSeg = path.replace(/^\//, '').split('/')[0];
                            const isActive = activeId === pathSeg;
                            const badge = getBadge(key);
                            return (
                                <button key={key} onClick={() => navigate(path)} className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-[1.25rem] transition-all duration-200 flex-1 ${isActive ? 'bg-[#007AFF]/10' : 'hover:bg-slate-100/60'}`}>
                                    <div className="relative">
                                        <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} className={isActive ? 'text-[#007AFF]' : 'text-slate-400'} />
                                        {badge > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                                                {badge > 9 ? '9+' : badge}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${isActive ? 'text-[#007AFF]' : 'text-slate-400'}`}>{label}</span>
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
                        /* ── Simple item flyout — clickable with icon ── */
                        <div className="relative animate-in fade-in slide-in-from-left-2 duration-150">
                            <button
                                onClick={() => { navigate(flyout.path); setFlyout(null); }}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-[1rem]
                                    bg-[#0D2040] border shadow-[0_8px_28px_rgba(0,0,0,0.55)]
                                    transition-all duration-150 active:scale-[0.97] group/fi
                                    ${flyout.isActive
                                        ? 'border-[#2D5499]/60 bg-[#1A3560]'
                                        : 'border-[#1E3A6E]/70 hover:bg-[#1A3560] hover:border-[#2D5499]/60'}`}
                                type="button"
                            >
                                <div className={`w-8 h-8 rounded-[0.65rem] flex items-center justify-center flex-shrink-0
                                    ${flyout.isActive ? 'bg-[#1D7AFC]/25' : 'bg-white/8 group-hover/fi:bg-[#1D7AFC]/20'}`}>
                                    <flyout.icon
                                        size={16}
                                        strokeWidth={flyout.isActive ? 2 : 1.5}
                                        className={flyout.isActive ? 'text-[#5BA8FF]' : 'text-white/55 group-hover/fi:text-[#5BA8FF]'}
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
                                {flyout.isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#1D7AFC] shadow-[0_0_6px_rgba(29,122,252,0.8)] flex-shrink-0" />}
                            </button>
                        </div>
                    ) : (
                        /* ── Group flyout panel ── */
                        <div className="relative animate-in fade-in slide-in-from-left-2 duration-150 min-w-[220px]">
                            <div className="relative rounded-[1.4rem] overflow-hidden
                                bg-[#0D2040]
                                border border-[#1E3A6E]/70
                                shadow-[0_16px_48px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]">

                                {/* Group label header */}
                                <div className="px-4 pt-3.5 pb-2.5 border-b border-white/8 flex items-center gap-2">
                                    <div className="w-[3px] h-3.5 rounded-full bg-gradient-to-b from-[#5BA8FF] to-[#1D7AFC] shadow-[0_0_6px_rgba(29,122,252,0.6)]" />
                                    <span className="text-white/60 text-[10px] font-black uppercase tracking-[0.18em]">{flyout.label}</span>
                                </div>

                                {/* Items */}
                                <div className="p-1.5 space-y-0.5">
                                    {flyout.items.map(m => {
                                        const MIcon = m.icon;
                                        return (
                                            <button
                                                key={m.key}
                                                onClick={() => { navigate(m.path); setFlyout(null); }}
                                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.85rem] transition-all duration-150 text-left group/fi active:scale-[0.97]
                                                    ${m.isActive
                                                        ? 'bg-[#1A3560] text-white border border-[#2D5499]/50'
                                                        : 'text-white/60 hover:text-white hover:bg-[#1A3560]/60'}`}
                                            >
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-150
                                                    ${m.isActive
                                                        ? 'bg-[#1D7AFC]/25 shadow-[0_2px_8px_rgba(29,122,252,0.25)]'
                                                        : 'bg-white/6 group-hover/fi:bg-white/12'}`}>
                                                    <MIcon
                                                        size={14}
                                                        strokeWidth={m.isActive ? 2 : 1.5}
                                                        className={m.isActive ? 'text-[#5BA8FF]' : 'text-white/45 group-hover/fi:text-white'}
                                                    />
                                                </div>
                                                <span className="text-[13px] font-medium whitespace-nowrap flex-1">{m.label}</span>
                                                {m.isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#1D7AFC] shadow-[0_0_6px_rgba(29,122,252,0.8)] flex-shrink-0" />}
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
                    )}
                </div>
            )}
        </div>
    );
};

export default AppLayout;
