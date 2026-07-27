import React, { useMemo, useState, useLayoutEffect, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // 🚨 1. IMPORTAMOS EL ROUTER
import {
    MapPin, Users, Monitor, Clock, Phone, CalendarClock, Building2, ShieldCheck, Briefcase, Edit3,
    Scale, Zap, ChevronRight, X, SlidersHorizontal, CircleUserRound, FolderOpen, ArrowLeft
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { formatTime12h } from '../utils/helpers';
import { WEEK_DAYS } from '../data/constants';

import TabHistory from './branch-tabs/TabHistory';
import TabExpediente from './branch-tabs/TabExpediente';
import TabExpenses from './branch-tabs/TabExpenses';
import TabStaff from './branch-tabs/TabStaff';

import GlassViewLayout from '../components/GlassViewLayout';
import { useAuth } from '../context/AuthContext';

// ============================================================================
// 🚀 COMPONENTE PRINCIPAL
// ============================================================================
const BranchDetailView = ({ branch, setActiveEmployee, openModal }) => {
    const navigate = useNavigate(); // 🚨 2. INICIALIZAMOS NAVEGACIÓN
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('branches', 'can_edit');
    const employees = useStaff(s => s.employees);
    const getBranchKiosks = useStaff(s => s.getBranchKiosks);
    const branches = useStaff(s => s.branches);
    const getBranchHistory = useStaff(s => s.getBranchHistory);
    
    const [activeTab, setActiveTab] = useState('history');
    const [, setKioskCount] = useState(0);

    const [history, setHistory] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    
    const [refreshKey, setRefreshKey] = useState(0);
    const [isEditMode, setIsEditMode] = useState(false);

    const [showProfile, setShowProfile] = useState(false);
    const hoverTimeoutRef = useRef(null);

    const [, setShowSideNav] = useState(false);
    const sentinelRef = useRef(null);


    const liveBranch = useMemo(() => {
        return branches.find(b => String(b.id) === String(branch?.id)) || branch;
    }, [branches, branch]);

    const branchType = liveBranch?.type || 'FARMACIA';
    const isFarmacia = branchType === 'FARMACIA';
    const isBodega   = branchType === 'BODEGA';
    const hasKiosk   = isFarmacia || isBodega;
    const hasLegal   = isFarmacia;
    const hasServices = isFarmacia;
    const hasPhone   = isFarmacia || isBodega;

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => setShowSideNav(!entry.isIntersecting),
            { rootMargin: "-80px 0px 0px 0px" }
        );
        if (sentinelRef.current) observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let isMounted = true;
        const loadKiosks = async () => {
            if (liveBranch?.id) {
                const devices = await getBranchKiosks(liveBranch.id);
                const activeDevices = devices ? devices.filter(d => d.status === 'ACTIVE') : [];
                if (isMounted) setKioskCount(activeDevices.length);
            }
        };
        loadKiosks();
        return () => { isMounted = false; };
    }, [liveBranch?.id, getBranchKiosks]);

    useEffect(() => {
        const handleForceRefresh = () => {
            setTimeout(() => setRefreshKey(prev => prev + 1), 500);
        };
        window.addEventListener('force-history-refresh', handleForceRefresh);
        return () => window.removeEventListener('force-history-refresh', handleForceRefresh);
    }, []);

    useEffect(() => {
        let isMounted = true;
        const fetchHistory = async () => {
            if (!liveBranch?.id) return;
            if (history.length === 0) setIsLoadingHistory(true);
            const data = await getBranchHistory(liveBranch.id);
            if (isMounted) {
                setHistory(data || []);
                setIsLoadingHistory(false);
            }
        };
        fetchHistory();
        return () => { isMounted = false; };
        // history.length queda fuera a propósito: solo se lee para decidir si mostrar
        // el spinner (skip si ya hay datos de un refresh anterior) — incluirlo
        // dispararía un refetch en bucle cada vez que este mismo efecto actualiza history.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveBranch?.id, refreshKey, getBranchHistory]);

    const currentStaff = useMemo(() => {
        return (employees || []).filter(e =>
            (String(e.branchId) === String(liveBranch?.id) || String(e.branch_id) === String(liveBranch?.id)) &&
            (e.status || '').toUpperCase() !== 'INACTIVO'
        );
    }, [employees, liveBranch?.id]);

    // 🚨 3. RE-ENRUTAMOS AL PERFIL DEL EMPLEADO MEDIANTE URL
    const goToProfile = (emp) => {
        if (emp) {
            if (setActiveEmployee) setActiveEmployee(emp);
            navigate(`/dashboard/empleado/${emp.id}`);
        }
    };

    const getTabAlert = (tabId) => {
        const legalData = liveBranch?.settings?.legal || {};

        if (tabId === 'staff' && isFarmacia) {
            const hasJefe = currentStaff.some(e => String(e.role || '').toUpperCase().includes('JEFE') && !String(e.role || '').toUpperCase().includes('SUB'));
            const hasSubjefe = currentStaff.some(e => String(e.role || '').toUpperCase().includes('SUB'));
            const hasRegente = !!legalData.regentEmployeeId;
            const hasReferente = !!legalData.pharmacovigilanceEmployeeId;
            const hasInjections = legalData.injections === true;
            const hasNurse = (legalData.nurses || []).length > 0;
            if (!hasJefe || !hasRegente || !hasReferente || (hasInjections && !hasNurse)) return 'critical';
            if (!hasSubjefe) return 'warning';
            return null;
        }

        if (tabId === 'dossier' && isFarmacia) {
            const getExpStatus = (dateStr) => {
                if (!dateStr) return 'critical';
                const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
                if (diff < 0) return 'critical';
                if (diff <= 45) return 'warning';
                return 'ok';
            };
            const checks = [
                !legalData.srsPermitUrl ? 'critical' : getExpStatus(legalData.srsExpiration),
                !legalData.regentCredentialUrl ? 'critical' : getExpStatus(legalData.regentCredentialExp),
                !legalData.farmacovigilanciaAuthUrl ? 'critical' : getExpStatus(legalData.pharmacovigilanceExp)
            ];
            if (checks.includes('critical')) return 'critical';
            if (checks.includes('warning')) return 'warning';
            return null;
        }

        if (tabId === 'expenses' && (isFarmacia || isBodega)) {
            const rentData = liveBranch?.settings?.rent || {};
            const svcData = liveBranch?.settings?.services || {};
            if (liveBranch?.propertyType === 'RENTED' && !rentData.contract?.documentUrl) return 'warning';
            if (isFarmacia && (!svcData.light?.provider || !svcData.water?.provider)) return 'warning';
            return null;
        }

        return null;
    };

    const groupedSchedule = useMemo(() => {
        let raw = liveBranch?.weekly_hours || liveBranch?.weeklyHours || {};
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }

        const grouped = [];
        let currentGroup = null;

        WEEK_DAYS.forEach((day, index) => {
            const data = raw[String(day.id)] || {};
            const isOpen = data.isOpen !== false && !!data.start && !!data.end;
            const timeStr = isOpen ? `${formatTime12h(data.start)} - ${formatTime12h(data.end)}` : 'Cerrado';

            if (!currentGroup) {
                currentGroup = { days: [day.name], timeStr, isOpen, startIndex: index, endIndex: index };
            } else if (currentGroup.timeStr === timeStr) {
                currentGroup.days.push(day.name);
                currentGroup.endIndex = index;
            } else {
                grouped.push(currentGroup);
                currentGroup = { days: [day.name], timeStr, isOpen, startIndex: index, endIndex: index };
            }
        });
        if (currentGroup) grouped.push(currentGroup);

        return grouped.map(g => {
            let label = '';
            if (g.days.length === 1) label = g.days[0];
            else if (g.days.length === 2) label = `${g.days[0]} y ${g.days[1]}`;
            else label = `${g.days[0]} a ${g.days[g.days.length - 1]}`;

            const jsDay = new Date().getDay();
            // WEEK_DAYS: Mon=0, Tue=1, ..., Sat=5, Sun=6 (JS: Sun=0, Mon=1, ..., Sat=6)
            const todayIdx = jsDay === 0 ? 6 : jsDay - 1;
            const isToday = todayIdx >= g.startIndex && todayIdx <= g.endIndex;

            return { label, timeStr: g.timeStr, isOpen: g.isOpen, isToday };
        });
    }, [liveBranch]);

    const todaySchedule = useMemo(() => {
        const todayGroup = groupedSchedule.find(g => g.isToday);
        return todayGroup ? todayGroup : { label: 'Hoy', timeStr: 'No definido', isOpen: false, isToday: true };
    }, [groupedSchedule]);

    const TABS = [
        { id: 'history',  label: 'Historial',   icon: Clock,      show: true },
        { id: 'staff',    label: 'Personal',     icon: Users,      show: true },
        { id: 'dossier',  label: 'Expediente',   icon: FolderOpen, show: hasLegal },
        { id: 'expenses', label: 'Gastos',        icon: Briefcase,  show: isFarmacia || isBodega },
    ].filter(t => t.show);

    const tabsRef = useRef(null);
    const tabBtnRefs = useRef(new Map());
    const [pill, setPill] = useState({ left: 8, width: 0, show: false });

    useLayoutEffect(() => {
        if (isEditMode || showProfile) {
            setPill(p => ({ ...p, show: false })); // mide posición real del tab activo (getBoundingClientRect) antes de pintar
            return;
        }
        const wrap = tabsRef.current;
        const btn = tabBtnRefs.current.get(activeTab);
        if (!wrap || !btn) return setPill((p) => ({ ...p, show: false }));
        const w = wrap.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        setPill({ left: b.left - w.left, width: b.width, show: true });
    }, [activeTab, isEditMode, showProfile]);

    const handleMouseEnter = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setShowProfile(true);
    };

    const handleMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setShowProfile(false);
        }, 300);
    };

    const renderHeaderActions = () => {
        return (
            <div className={`flex items-center overflow-x-auto hide-scrollbar backdrop-blur-2xl backdrop-saturate-[180%] border border-border-card shadow-[var(--shadow-glass-sm)] hover:shadow-[var(--shadow-glass-md)] rounded-header h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-colors duration-500 transform-gpu shrink-0 w-max max-w-full hover:-translate-y-[2px] ${showProfile ? 'bg-surface-card' : 'bg-surface-card'}`}>

                {showProfile ? (
                    <div className="flex items-center gap-3 md:gap-4 px-2 md:px-4 h-full animate-in fade-in zoom-in-95 duration-300 w-max" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-chart-1/10 text-brand-text flex items-center justify-center shrink-0"><MapPin size={14} strokeWidth={2.5} /></div>
                            <div className="flex flex-col">
                                <span className="text-micro font-black text-content-2 uppercase tracking-widest">Ubicación</span>
                                <span className="text-label font-bold text-content-2 truncate max-w-[150px]">{liveBranch.address || "No registrada"}</span>
                            </div>
                        </div>
                        <div className="w-px h-6 bg-divider shrink-0"></div>
                        {hasPhone && (
                            <>
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0"><Phone size={14} strokeWidth={2.5} /></div>
                                    <div className="flex flex-col">
                                        <span className="text-micro font-black text-content-2 uppercase tracking-widest">Contacto</span>
                                        <span className="text-label font-bold text-content-2 truncate max-w-[100px]">{liveBranch.phone || liveBranch.cell || "N/A"}</span>
                                    </div>
                                </div>
                                <div className="w-px h-6 bg-divider shrink-0"></div>
                            </>
                        )}
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-warning/10 text-warning flex items-center justify-center shrink-0"><CalendarClock size={14} strokeWidth={2.5} /></div>
                            <div className="flex flex-col">
                                <span className="text-micro font-black text-content-2 uppercase tracking-widest">Horario ({todaySchedule.label})</span>
                                <span className="text-label font-bold text-content-2 truncate max-w-[120px]">{todaySchedule.timeStr}</span>
                            </div>
                        </div>
                        <div className="w-px h-6 bg-divider shrink-0"></div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-chart-3/10 text-chart-3-text flex items-center justify-center shrink-0"><CircleUserRound size={14} strokeWidth={2.5} /></div>
                            <div className="flex flex-col">
                                <span className="text-micro font-black text-content-2 uppercase tracking-widest">Personal</span>
                                <span className="text-label font-bold text-content-2 truncate max-w-[150px]">{currentStaff.length} Activos</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center h-full shrink-0 transform-gpu origin-right animate-in fade-in zoom-in-95 duration-300">

                        <div inert={isEditMode ? true : undefined} className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isEditMode ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[800px] opacity-100'}`}>
                            <div ref={tabsRef} className="flex items-center gap-1 md:gap-2 pr-1 md:pr-2 w-max relative">
                                <div
                                    className="absolute top-0 bottom-0 bg-white rounded-full shadow-[var(--shadow-elevation-sm)] transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                                    style={{ left: `${pill.left}px`, width: `${pill.width}px`, opacity: pill.show ? 1 : 0 }}
                                ></div>

                                {TABS.map(tab => {
                                    const Icon = tab.icon;
                                    const isActive = activeTab === tab.id;
                                    const alertStatus = getTabAlert(tab.id);

                                    return (
                                        <button
                                            key={tab.id}
                                            ref={(el) => tabBtnRefs.current.set(tab.id, el)}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`relative flex items-center justify-center gap-2 py-2.5 px-4 text-caption md:text-label font-black uppercase tracking-widest transition-all duration-300 z-base rounded-full shrink-0 border border-transparent ${isActive
                                                    ? 'text-brand-text'
                                                    : 'text-content-3 hover:bg-surface-card-hover hover:text-content hover:shadow-sm hover:-translate-y-0.5 hover:border-border-card'
                                                }`}
                                        >
                                            <Icon size={14} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-brand-text' : ''} />
                                            <span className="hidden xl:inline">{tab.label}</span>

                                            {alertStatus === 'critical' && <span className={`absolute top-1.5 right-2 w-2 h-2 bg-danger rounded-full shadow-[var(--shadow-glow-danger-md)] animate-pulse border ${isActive ? 'border-border-card' : 'border-transparent'}`}></span>}
                                            {alertStatus === 'warning' && <span className={`absolute top-1.5 right-2 w-2 h-2 bg-warning rounded-full shadow-[var(--shadow-glow-warning-md)] border ${isActive ? 'border-border-card' : 'border-transparent'}`}></span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {canEdit && (
                        <div inert={!isEditMode ? true : undefined} className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${!isEditMode ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-[800px] opacity-100'}`}>
                            <div className="flex items-center gap-1 md:gap-1.5 ml-1 pr-1 w-max">
                                <button onClick={() => openModal && openModal('editBranch', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-content hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><Edit3 size={13} /> General</button>
                                <button onClick={() => openModal && openModal('editBranchHorarios', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-warning hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><CalendarClock size={13} /> Horarios</button>
                                <button onClick={() => openModal && openModal('editBranchInmueble', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-chart-4-text hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><Building2 size={13} /> Local</button>
                                {hasServices && <button onClick={() => openModal && openModal('editBranchServicios', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-success hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><Zap size={13} /> Serv.</button>}
                                {hasLegal && <button onClick={() => openModal && openModal('editBranchLegal', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-chart-3-text hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><Scale size={13} /> Legal</button>}
                                {hasKiosk && <button onClick={() => openModal && openModal('manageKiosks', liveBranch)} className="px-4 h-9 md:h-10 rounded-full text-caption font-black uppercase tracking-wider bg-transparent text-content-3 hover:bg-surface-card-hover hover:text-brand-hover hover:shadow-sm hover:-translate-y-0.5 flex items-center gap-1.5 transition-all shrink-0"><Monitor size={13} /> Kioscos</button>}
                            </div>
                        </div>
                        )}

                        <div className="w-px h-6 md:h-8 bg-content-3/30 mx-1.5 shrink-0"></div>

                        {canEdit && <button
                            onClick={() => setIsEditMode(!isEditMode)}
                            className={`flex items-center justify-center shrink-0 w-11 h-11 rounded-full transition-all duration-300 transform-gpu active:scale-[0.97] shadow-sm hover:shadow-md hover:-translate-y-0.5 ${isEditMode
                                    ? 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger-solid hover:text-white'
                                    : 'bg-surface-card text-brand-text border border-border-card hover:border-brand/30'
                                }`}
                            title={isEditMode ? "Cerrar edición" : "Configurar sucursal"}
                        >
                            {isEditMode ? <X size={16} strokeWidth={2.5} /> : <SlidersHorizontal size={16} strokeWidth={2.5} />}
                        </button>}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <GlassViewLayout
                icon={null}
                title={
                    <div className="flex items-center gap-3 md:gap-4">
                        {/* 🚨 4. EL BOTÓN "VOLVER" AHORA USA EL ROUTER DIRECTO */}
                        <button 
                            onClick={() => navigate('/branches')} 
                            className="relative group/back w-11 h-11 flex items-center justify-center rounded-full shrink-0 active:scale-[0.97] transition-all duration-300 border border-divider shadow-[var(--shadow-elevation-sm)] hover:shadow-[var(--shadow-glow-brand)] hover:-translate-y-0.5 z-sidebar bg-surface-card"
                            title="Volver a Sucursales"
                        >
                            <div className="absolute inset-0 bg-gradient-to-tr from-brand/20 to-chart-5/20 rounded-full opacity-0 group-hover/back:opacity-100 transition-opacity duration-300"></div>
                            <ArrowLeft size={18} strokeWidth={2.5} className="text-content-3 group-hover/back:text-brand-text transition-colors relative z-base" />
                        </button>

                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl md:rounded-2xl bg-brand text-white flex items-center justify-center shadow-[var(--shadow-glow-brand)] shrink-0">
                            <Building2 size={20} className="md:w-6 md:h-6" strokeWidth={1.5} />
                        </div>

                        <div
                            className="flex flex-col items-start gap-1 cursor-pointer group/title relative transition-all"
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-title md:text-title-lg font-black text-content leading-none tracking-tight">{liveBranch?.name || "Detalle de Sucursal"}</span>
                                <div className={`flex items-center justify-center w-2 h-2 md:w-2.5 md:h-2.5 rounded-full shadow-sm ${todaySchedule.isOpen ? 'bg-success shadow-[var(--shadow-glow-chart-2-md)] animate-pulse' : 'bg-content-3'}`} title={todaySchedule.isOpen ? 'Operativa' : 'Cerrada'}></div>

                                <div className={`flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full border shadow-sm transition-all duration-300 ml-0.5 md:ml-1 ${showProfile ? 'bg-brand border-brand text-white translate-x-1' : 'bg-brand/10 border-brand/20 text-brand-text group-hover/title:translate-x-0.5'}`}>
                                    <ChevronRight size={12} strokeWidth={3} className="transition-transform duration-300" />
                                </div>
                            </div>
                            <span className="text-micro md:text-caption font-bold text-content-2 uppercase tracking-widest">
                                {(liveBranch?.openingDate || liveBranch?.opening_date)
                                    ? `Inaugurada en ${new Date(liveBranch.openingDate || liveBranch.opening_date).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`
                                    : 'Fecha de inauguración pendiente'}
                            </span>
                        </div>
                    </div>
                }
                filtersContent={renderHeaderActions()}
                transparentBody={true}
            >
                <div className="w-full flex-1 flex flex-col relative z-base pb-12">
                    <div ref={sentinelRef} className="absolute -top-10 h-1 w-full pointer-events-none" aria-hidden="true" />

                    <div className="bg-surface-card backdrop-blur-[20px] backdrop-saturate-[180%] rounded-header border border-border-card shadow-[var(--shadow-glass-3)] p-6 md:p-8 min-h-[700px] relative overflow-hidden flex flex-col w-full mt-2">
                        <div key={activeTab} className="animate-view-enter flex-1 flex flex-col">
                        {activeTab === 'history' && (
                            <TabHistory liveBranch={liveBranch} history={history} isLoadingHistory={isLoadingHistory} employees={employees} openModal={openModal} />
                        )}

                        {activeTab === 'staff' && (
                            <TabStaff liveBranch={liveBranch} currentStaff={currentStaff} employees={employees} goToProfile={goToProfile} openModal={openModal} />
                        )}

                        {activeTab === 'dossier' && (
                            <TabExpediente liveBranch={liveBranch} openModal={openModal} />
                        )}
                        {activeTab === 'expenses' && (
                            <TabExpenses liveBranch={liveBranch} openModal={openModal} branchType={branchType} />
                        )}
                        </div>
                    </div>
                </div>
            </GlassViewLayout>
        </>
    );
};

export default BranchDetailView;