import React, { useMemo, useCallback, useState, useEffect, useRef } from "react";
import {
    Building2, MapPin, Phone, Smartphone, Clock, Edit3, Trash2, Plus,
    Users, Eye, Monitor, AlertTriangle, CheckCircle2, Info, AlertCircle,
    Search, Filter, ListFilter, X, ArrowUpRight, Copy, MessageCircle, Loader2, ChevronRight,
    Scale, Zap
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { formatTime12h } from "../utils/helpers";
import ConfirmModal from "../components/common/ConfirmModal";
import AlertModal from "../components/common/AlertModal";
import GlassViewLayout from '../components/GlassViewLayout';
import { useToastStore } from '../store/toastStore';

const FILTER_OPTIONS = [
    { value: "ALL", label: "Todas las Sucursales" },
    { value: "ALERTS", label: "Con Alertas" },
    { value: "INACTIVE", label: "Inactivas" },
    { value: "RENTED", label: "Alquiladas" },
    { value: "OWNED", label: "Propias" },
];

const safeParse = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

// Clase de utilidad para elementos interactivos tipo "glass" dentro de la tarjeta
const CLASS_INTERACTIVE_GLASS_ELEMENT = "bg-white/50 backdrop-blur-md border border-white/90 shadow-[0_4px_15px_rgba(0,0,0,0.02),inset_0_2px_10px_rgba(255,255,255,0.8)] cursor-pointer transition-all duration-300 hover:bg-white/80 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,1)] hover:-translate-y-0.5 active:scale-95";

const BranchesView = ({ openModal, setView, setActiveBranch }) => {
    const branches = useStaff(state => state.branches);
    const employees = useStaff(state => state.employees);
    const deleteBranch = useStaff(state => state.deleteBranch);
    const getBranchKiosks = useStaff(state => state.getBranchKiosks);

    const [kiosksCount, setKiosksCount] = useState({});
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, branch: null });
    const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '', type: 'error' });

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('ALL');

    const [isSearchActive, setIsSearchActive] = useState(false);
    const [isFilterPickerOpen, setIsFilterPickerOpen] = useState(false);

    const [now, setNow] = useState(new Date());
    
    const isMobile = useMemo(() => /Mobi|Android|iPhone/i.test(navigator.userAgent), []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isSearchActive) { setIsSearchActive(false); setSearchTerm(''); }
                if (isFilterPickerOpen) setIsFilterPickerOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchActive, isFilterPickerOpen]);

    useEffect(() => {
        let isMounted = true;
        const refreshData = async () => {
            setNow(new Date());
            if (branches.length > 0) {
                try {
                    const results = await Promise.all(
                        branches.map(branch => getBranchKiosks(branch.id).then(devices => ({
                            id: branch.id, count: devices ? devices.length : 0
                        })))
                    );
                    if (isMounted) {
                        const newCounts = {};
                        results.forEach(res => { newCounts[res.id] = res.count; });
                        setKiosksCount(newCounts);
                    }
                } catch (error) { console.error("Error cargando kioscos", error); }
            }
        };
        refreshData();
        const timer = setInterval(refreshData, 60000); 
        return () => { isMounted = false; clearInterval(timer); };
    }, [branches, getBranchKiosks]);

    const employeesByBranch = useMemo(() => {
        const m = new Map();
        (employees || []).forEach((e) => {
            const k = String(e.branchId || e.branch_id);
            m.set(k, (m.get(k) || 0) + 1);
        });
        return m;
    }, [employees]);

    const isScheduleDefined = useCallback((branch) => {
        const weekly = branch?.weeklyHours || branch?.weekly_hours;
        if (!weekly || Object.keys(weekly).length === 0) return false;
        return Object.values(weekly).some(day => day.isOpen && day.start && day.end);
    }, []);

    const isBranchOpenNow = useCallback((branch) => {
        const weekly = branch?.weeklyHours || branch?.weekly_hours; 
        if (!weekly || Object.keys(weekly).length === 0) return { status: 'UNKNOWN', label: 'Horario no definido' };

        const currentDayIndex = now.getDay(); 
        const currentDayInfo = weekly[String(currentDayIndex)];

        if (!currentDayInfo || currentDayInfo.isOpen === false) return { status: 'CLOSED', label: 'Cerrado hoy' };
        if (!currentDayInfo.start || !currentDayInfo.end) return { status: 'UNKNOWN', label: 'Horario incompleto' };

        const currentTimeString = now.toTimeString().slice(0, 5); 
        if (currentTimeString >= currentDayInfo.start && currentTimeString < currentDayInfo.end) {
            return { status: 'OPEN', label: 'Abierto ahora' };
        } else {
            return { status: 'CLOSED', label: 'Cerrado ahora' };
        }
    }, [now]);

    const getTodaySchedule = useCallback((branch) => {
        const weekly = branch?.weeklyHours || branch?.weekly_hours; 
        if (!weekly || Object.keys(weekly).length === 0) return "No definido";
        
        const currentDayInfo = weekly[String(now.getDay())];
        if (!currentDayInfo || currentDayInfo.isOpen === false) return "CERRADO";
        if (!currentDayInfo.start || !currentDayInfo.end) return "No definido";

        return `${formatTime12h(currentDayInfo.start)} - ${formatTime12h(currentDayInfo.end)}`;
    }, [now]);

    const getProfileCompletion = useCallback((branch) => {
        const settings = safeParse(branch.settings);
        const legal = settings.legal || {};
        const rent = settings.rent || { contract: {} };
        const services = settings.services || {};
        const pType = branch.propertyType || settings.propertyType || null; 

        let legalScore = 0;
        if (legal.regentEmployeeId) legalScore += 33.3;
        if (legal.pharmacovigilanceEmployeeId) legalScore += 33.3;
        if (legal.srsPermit) legalScore += 33.4;

        let propertyScore = 0;
        if (pType === 'OWNED') propertyScore = 100;
        else if (pType === 'RENTED') {
            if (rent.landlordName) propertyScore += 25;
            if (rent.amount) propertyScore += 25;
            if (rent.contract?.startDate) propertyScore += 25;
            if (rent.contract?.termMonths) propertyScore += 25;
        }

        let serviceScore = 0;
        if (services.light?.provider || services.light?.account) serviceScore += 50;
        if (services.water?.provider || services.water?.account) serviceScore += 50;

        return { legal: Math.round(legalScore), property: Math.round(propertyScore), services: Math.round(serviceScore) };
    }, []);

    const getAlertStatus = useCallback((branch) => {
        const alerts = [];
        const settings = safeParse(branch.settings);
        const legalData = settings.legal || {};
        const pType = branch.propertyType || settings.propertyType || null;

        if (!pType) alerts.push({ level: 'warning', message: 'Inmueble no definido', icon: Info });
        else if (pType === 'RENTED') {
            const endDateStr = branch.rent?.contract?.endDate || settings.rent?.contract?.endDate;
            if (!endDateStr) alerts.push({ level: 'warning', message: 'Falta Contrato', icon: Info });
            else {
                const diffTime = Math.ceil((new Date(endDateStr) - new Date()) / (1000 * 60 * 60 * 24));
                if (diffTime < 0) alerts.push({ level: 'critical', message: 'Contrato Vencido', icon: AlertTriangle });
                else if (diffTime <= 30) alerts.push({ level: 'warning', message: `Contrato vence en ${diffTime} días`, icon: AlertTriangle });
            }
        }

        if (!legalData.srsPermit) alerts.push({ level: 'warning', message: 'Falta Permiso SRS', icon: Info });
        if (!legalData.regentEmployeeId) alerts.push({ level: 'critical', message: 'Sin Regente Asignado', icon: AlertTriangle });
        if (!branch.address || (!branch.phone && !branch.cell)) alerts.push({ level: 'warning', message: 'Datos Incompletos', icon: Info });
        if (!isScheduleDefined(branch)) alerts.push({ level: 'critical', message: 'Sin Horarios', icon: AlertTriangle });

        // 🚨 Estilo base de tarjeta (glass unificado para todas)
        const baseCardStyles = 'bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.05),inset_0_2px_15px_rgba(255,255,255,0.7)]';

        if (alerts.length === 0) {
            return {
                hasAlerts: false, message: 'Operativa',
                cardStyles: baseCardStyles,
                badgeStyles: 'hidden', icon: CheckCircle2, list: []
            };
        }

        const hasCritical = alerts.some(a => a.level === 'critical');
        return {
            hasAlerts: true, message: alerts.length > 1 ? `${alerts.length} ALERTAS` : alerts[0].message,
            cardStyles: baseCardStyles, // Ya no aplicamos bordes rojos/ámbares aquí
            badgeStyles: hasCritical ? 'bg-red-500 text-white shadow-[0_4px_15px_rgba(239,68,68,0.4)] border-red-400' : 'bg-amber-400 text-white shadow-[0_4px_15px_rgba(245,158,11,0.4)] border-amber-300',
            icon: hasCritical ? AlertTriangle : AlertCircle, list: alerts
        };
    }, [isScheduleDefined]);

    const filteredBranches = useMemo(() => {
        return branches.filter(b => {
            const matchesSearch = b.name.toLowerCase().includes(searchTerm.toLowerCase()) || (b.address && b.address.toLowerCase().includes(searchTerm.toLowerCase()));
            if (!matchesSearch) return false;

            const count = employeesByBranch.get(String(b.id)) || 0;
            const activeK = kiosksCount[b.id] || 0;
            const isInactive = count === 0 && activeK === 0;
            const alert = getAlertStatus(b);
            const pType = b.propertyType || safeParse(b.settings)?.propertyType;

            if (filterStatus === 'ALERTS' && !alert.hasAlerts) return false;
            if (filterStatus === 'INACTIVE' && !isInactive) return false;
            if (filterStatus === 'RENTED' && pType !== 'RENTED') return false;
            if (filterStatus === 'OWNED' && pType !== 'OWNED') return false;

            return true;
        });
    }, [branches, searchTerm, filterStatus, employeesByBranch, kiosksCount, getAlertStatus]);

    const handleViewProfile = (branch) => {
        if (setActiveBranch) setActiveBranch(branch);
        if (setView) setView('branch-detail');
    };

    const handleDeleteClick = useCallback((branch, count) => {
        if (!branch) return;
        if (count > 0) {
            setAlertDialog({ isOpen: true, title: 'Operación Bloqueada', message: `No se puede eliminar "${branch.name}" porque tiene ${count} empleado(s) asignado(s). Reasígnalos o dalos de baja primero.`, type: 'error' });
            return;
        }
        setConfirmDialog({ isOpen: true, branch });
    }, []);

    const executeDelete = async () => {
        if (!confirmDialog.branch) return;
        try {
            await deleteBranch(confirmDialog.branch.id);
            useToastStore.getState().showToast('Sucursal Eliminada', `La sucursal ${confirmDialog.branch.name} ha sido borrada del sistema.`, 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error de Sistema', 'No se pudo eliminar la sucursal. Intenta nuevamente.', 'error');
        } finally {
            setConfirmDialog({ isOpen: false, branch: null });
        }
    };

    const handlePhoneAction = (e, phone, type) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        const cleanPhone = phone.replace(/\D/g, ''); 
        if (isMobile) { window.location.href = `tel:${cleanPhone}`; } 
        else { navigator.clipboard.writeText(phone); useToastStore.getState().showToast('Copiado', `Número ${type} copiado al portapapeles.`, 'success'); }
    };

    const handleWhatsAppAction = (e, phone) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 8) cleanPhone = `503${cleanPhone}`; 
        window.open(`https://wa.me/${cleanPhone}`, '_blank');
    };

    const renderFiltersContent = () => (
        <div className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchActive ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input type="text" placeholder="Buscar sucursal o dirección..." className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} ref={(input) => { if (input && isSearchActive) setTimeout(() => input.focus(), 100) }} />
                {searchTerm && <button onClick={() => setSearchTerm("")} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                <button onClick={() => { setIsSearchActive(false); setSearchTerm(""); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"><ChevronRight size={18} strokeWidth={2.5} /></button>
            </div>

            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchActive ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-3 gap-3"}`}>
                <div className="flex items-center min-w-0 flex-1">
                    <div className={`flex items-center overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isFilterPickerOpen ? "max-w-0 opacity-0 pointer-events-none gap-0 pr-0" : "max-w-[400px] opacity-100 gap-2 md:gap-3 pr-2 md:pr-3"}`}>
                        <button type="button" onClick={() => setIsFilterPickerOpen(true)} className={`px-3 md:px-5 h-9 rounded-full flex items-center gap-2 md:gap-3 transition-all duration-300 group whitespace-nowrap border shrink-0 ${filterStatus !== "ALL" ? "bg-white text-slate-800 border-white shadow-md" : "bg-transparent text-slate-600 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"}`}>
                            <Filter size={16} className={`transition-transform duration-200 transform-gpu md:w-[18px] md:h-[18px] ${filterStatus !== 'ALL' ? 'text-[#007AFF]' : 'group-hover:scale-110'}`} />
                            <span className="text-[11px] md:text-[12px] font-bold uppercase tracking-wider">{FILTER_OPTIONS.find((o) => o.value === filterStatus)?.label || "Sucursales"}</span>
                        </button>
                    </div>

                    <div className={`flex items-center overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isFilterPickerOpen ? "max-w-[800px] opacity-100 ml-1 pr-1 gap-2" : "max-w-0 opacity-0 pointer-events-none m-0 p-0 gap-0"}`}>
                        {FILTER_OPTIONS.map((opt) => (
                            <button key={opt.value} type="button" onClick={() => { setFilterStatus(opt.value); setIsFilterPickerOpen(false); }} className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${filterStatus === opt.value ? "bg-white text-slate-800 border-white shadow-md scale-[1.02]" : "bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"}`}>
                                {opt.label}
                            </button>
                        ))}
                        <button type="button" onClick={() => setIsFilterPickerOpen(false)} className="w-9 h-9 rounded-full bg-white/50 border border-white/60 hover:bg-red-50 hover:border-red-200 hover:text-red-500 text-slate-500 flex items-center justify-center transition-all duration-300 hover:shadow-md shrink-0 ml-1 hover:-translate-y-0.5"><X size={14} strokeWidth={2.5} /></button>
                    </div>
                </div>

                <div className={`flex items-center shrink-0 border-l transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right border-slate-200/60 ${isFilterPickerOpen ? "max-w-0 opacity-0 scale-95 pointer-events-none ml-0 pl-0 border-transparent m-0" : "max-w-[600px] opacity-100 scale-100 ml-3 md:ml-4 pl-3 md:pl-4 gap-2 md:gap-4"}`}>
                    {filterStatus !== "ALL" && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setFilterStatus("ALL"); }} className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/70 border border-white/90 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 flex items-center justify-center transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5 shrink-0 animate-in zoom-in-50 duration-300" title="Limpiar todos los filtros"><Trash2 size={15} strokeWidth={2.5} /></button>
                    )}
                    <button onClick={() => setIsSearchActive(true)} className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu" title="Buscar sucursal">
                        <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                        {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
                    </button>
                    <button type="button" onClick={() => openModal?.("newBranch")} className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-white text-[#007AFF] font-black text-[10px] md:text-[11px] uppercase tracking-widest shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_15px_rgba(0,122,255,0.15)] border border-white hover:border-[#007AFF]/30 hover:-translate-y-0.5 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap">
                        <Plus size={16} strokeWidth={2.5} />
                        <span className="hidden sm:inline">Nueva Sucursal</span>
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <>
            <ConfirmModal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen: false, branch: null })} onConfirm={executeDelete} title={`¿Eliminar "${confirmDialog.branch?.name}"?`} message="Esta acción eliminará permanentemente la sucursal y toda su configuración operativa del sistema." confirmText="Sí, eliminar sucursal" />
            <AlertModal isOpen={alertDialog.isOpen} onClose={() => setAlertDialog({ isOpen: false, title: '', message: '', type: 'error' })} title={alertDialog.title} message={alertDialog.message} type={alertDialog.type} />

            <GlassViewLayout icon={Building2} title="Sucursales" filtersContent={renderFiltersContent()} transparentBody={true}>
                <div className="w-full flex-1 pb-12">
                    {filteredBranches.length === 0 ? (
                        <div className="py-24 text-center flex flex-col items-center justify-center opacity-60">
                            <div className="bg-white/60 p-5 rounded-full mb-4 shadow-sm border border-white/80"><ListFilter size={32} className="text-slate-500" /></div>
                            <h3 className="text-[16px] font-bold text-slate-700">No se encontraron resultados</h3>
                            <p className="text-[14px] text-slate-500 mt-1 font-medium">Prueba cambiando los filtros o el término de búsqueda.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 auto-rows-max pt-4 px-2">
                            {filteredBranches.map((branch) => {
                                const count = employeesByBranch.get(String(branch.id)) || 0;
                                const activeKiosks = kiosksCount[branch.id] || 0;
                                const pct = Math.min(Math.round((count / 20) * 100), 100);
                                const deleteDisabled = count > 0;

                                const alertStatus = getAlertStatus(branch);
                                const isInactive = count === 0 && activeKiosks === 0;
                                const currentStatus = isBranchOpenNow(branch);
                                const todaySchedule = getTodaySchedule(branch);
                                const completion = getProfileCompletion(branch);
                                const scheduleDefined = isScheduleDefined(branch);

                                return (
                                    <div key={branch.id} className={`group relative rounded-[2.5rem] transition-all duration-500 flex flex-col h-full transform-gpu ${alertStatus.cardStyles} ${isInactive ? 'opacity-80 grayscale-[30%] hover:grayscale-0 hover:opacity-100' : 'hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(0,0,0,0.1),inset_0_2px_15px_rgba(255,255,255,0.8)]'}`}>

                                        {/* ZONA TOP-RIGHT: BOTONES FLOTANTES Y ALERTA */}
                                        <div className="absolute top-5 right-5 flex items-center gap-1.5 z-30">
                                            
                                            {/* Micro-toolbar oculto por defecto, interactivo al hover */}
                                            <div className="flex items-center gap-0.5 opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 bg-white/80 backdrop-blur-md p-1 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.1)] hover:bg-white border border-white hover:scale-105">
                                                <button onClick={(e) => { e.stopPropagation(); handleViewProfile(branch); }} className="w-7 h-7 rounded-full text-slate-400 hover:text-[#007AFF] hover:bg-[#007AFF]/10 flex items-center justify-center transition-all" title="Ver Perfil">
                                                    <Eye size={14} strokeWidth={2.5}/>
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); openModal?.("editBranch", branch); }} className="w-7 h-7 rounded-full text-slate-400 hover:text-amber-500 hover:bg-amber-50 flex items-center justify-center transition-all" title="Ajustes Generales">
                                                    <Edit3 size={14} strokeWidth={2.5}/>
                                                </button>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteClick(branch, count); }} disabled={deleteDisabled} className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${deleteDisabled ? 'text-slate-300 opacity-50 cursor-not-allowed' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`} title={deleteDisabled ? "Reasigna al personal primero" : "Eliminar Sucursal"}>
                                                    <Trash2 size={14} strokeWidth={2.5} />
                                                </button>
                                            </div>

                                            {/* Alerta */}
                                            {alertStatus.hasAlerts && (
                                                <div className="relative group/badge flex items-center justify-center ml-1">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all cursor-help border ${alertStatus.badgeStyles}`}>
                                                        <alertStatus.icon size={14} strokeWidth={2.5} />
                                                    </div>

                                                    <div className="absolute top-full mt-2 right-0 w-max max-w-[200px] bg-slate-900/90 backdrop-blur-xl text-white p-3.5 rounded-[1.2rem] shadow-[0_20px_40px_rgba(0,0,0,0.3)] opacity-0 invisible group-hover/badge:opacity-100 group-hover/badge:visible transition-all duration-300 translate-y-2 group-hover/badge:translate-y-0 border border-white/10 z-50">
                                                        <p className="text-[8px] text-slate-400 uppercase tracking-widest mb-2 font-black border-b border-white/10 pb-1.5">Problemas Detectados</p>
                                                        <div className="space-y-2.5">
                                                            {alertStatus.list.map((al, idx) => (
                                                                <div key={idx} className="flex items-start gap-2 text-[10px] font-bold">
                                                                    <al.icon size={12} className={`mt-0.5 shrink-0 ${al.level === 'critical' ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} strokeWidth={2.5}/>
                                                                    <span className="leading-tight text-white/90">{al.message}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-6 flex-1 flex flex-col gap-4 mt-2 relative">
                                            {/* HEADER */}
                                            <div className="flex items-start gap-3">
                                                <button onClick={() => handleViewProfile(branch)} className="flex items-center gap-4 min-w-0 text-left group/header focus:outline-none w-full pr-[140px]">
                                                    <div className="w-14 h-14 rounded-[1.25rem] bg-white border border-white/90 text-[#007AFF] shadow-[0_8px_20px_rgba(0,0,0,0.04),inset_0_2px_10px_rgba(255,255,255,1)] flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover/header:scale-105 group-hover/header:shadow-[0_12px_25px_rgba(0,0,0,0.08)]">
                                                        <Building2 size={26} strokeWidth={1.5} />
                                                    </div>
                                                    
                                                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                        <div className="flex items-center gap-2">
                                                            <h3 className="text-[18px] font-bold text-slate-800 leading-tight group-hover/header:text-[#007AFF] transition-colors duration-300 line-clamp-2">
                                                                {branch.name}
                                                            </h3>
                                                            
                                                            <div className="relative group/status flex items-center justify-center p-1.5 cursor-help shrink-0">
                                                                {isInactive ? (
                                                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)] shrink-0"></span>
                                                                ) : currentStatus.status === 'OPEN' ? (
                                                                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300 shrink-0"></span>
                                                                )}
                                                                
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2.5 py-1.5 bg-slate-800/90 backdrop-blur-xl text-white text-[9px] font-black uppercase tracking-widest rounded-lg shadow-xl opacity-0 invisible group-hover/status:opacity-100 group-hover/status:visible transition-all duration-300 translate-y-1 group-hover/status:translate-y-0 z-50 pointer-events-none border border-white/10">
                                                                    {isInactive ? 'Inactiva' : currentStatus.status === 'OPEN' ? 'Abierta Ahora' : 'Cerrada Ahora'}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-slate-800/90"></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            </div>

                                            {/* CUERPO CENTRAL */}
                                            <div className="flex flex-col gap-2.5 mt-2">
                                                {/* 🚨 Usamos la clase unificada CLASS_INTERACTIVE_GLASS_ELEMENT aquí */}
                                                <a href={branch.settings?.location?.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ') || branch.name)}`} target="_blank" rel="noreferrer" className={`group/map flex items-start gap-3 p-3.5 rounded-[1.25rem] ${CLASS_INTERACTIVE_GLASS_ELEMENT}`} title="Abrir en Maps">
                                                    <div className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 group-hover/map:scale-110 group-hover/map:text-[#007AFF] border border-slate-100"><MapPin size={16} strokeWidth={2.5}/></div>
                                                    <div className="flex-1 flex justify-between items-start gap-2 pr-1">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">Direccional, Departamento <ArrowUpRight size={10} className="transition-transform duration-300 group-hover/map:translate-x-0.5 group-hover/map:-translate-y-0.5" /></p>
                                                            <p className="text-[12px] font-semibold text-slate-700 leading-snug break-words">{[branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ') || "No registrada"}</p>
                                                        </div>
                                                        <div className="shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
                                                            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText([branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ')); useToastStore.getState().showToast('Copiado', 'Dirección copiada.', 'success');}} className="p-1.5 rounded-md bg-black/[0.03] text-slate-500 hover:text-slate-800 hover:bg-white hover:border-slate-200 border border-transparent hover:scale-105 hover:shadow-sm transition-all" title="Copiar"><Copy size={12} /></button>
                                                        </div>
                                                    </div>
                                                </a>

                                                <div className="grid grid-cols-2 gap-2.5">
                                                    {/* 🚨 Usamos la clase unificada CLASS_INTERACTIVE_GLASS_ELEMENT aquí */}
                                                    <button onClick={(e) => handlePhoneAction(e, branch.phone, 'Fijo')} className={`group/phone flex items-center gap-2.5 p-3 rounded-[1.25rem] relative text-left w-full ${CLASS_INTERACTIVE_GLASS_ELEMENT}`}>
                                                        <div className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-500 border border-slate-100 flex items-center justify-center shrink-0 transition-all duration-300 group-hover/phone:scale-110 group-hover/phone:text-[#007AFF]"><Phone size={14} strokeWidth={2.5}/></div>
                                                        <div className="min-w-0 flex-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fijo</p><p className="text-[12px] font-bold text-slate-700 truncate">{branch.phone || "—"}</p></div>
                                                    </button>
                                                    {/* 🚨 Usamos la clase unificada CLASS_INTERACTIVE_GLASS_ELEMENT aquí */}
                                                    <button onClick={(e) => handlePhoneAction(e, branch.cell, 'Celular')} className={`group/cell flex items-center gap-2.5 p-3 rounded-[1.25rem] relative text-left w-full pr-10 ${CLASS_INTERACTIVE_GLASS_ELEMENT}`}>
                                                        <div className="w-8 h-8 rounded-lg bg-white shadow-sm text-slate-500 border border-slate-100 flex items-center justify-center shrink-0 transition-all duration-300 group-hover/cell:scale-110 group-hover/cell:text-[#007AFF]"><Smartphone size={14} strokeWidth={2.5}/></div>
                                                        <div className="min-w-0 flex-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Celular</p><p className="text-[12px] font-bold text-slate-700 truncate">{branch.cell || "—"}</p></div>
                                                        {branch.cell && <div onClick={(e) => handleWhatsAppAction(e, branch.cell)} className="absolute right-2 w-7 h-7 bg-emerald-50 text-emerald-500 rounded-md flex items-center justify-center shadow-sm opacity-0 group-hover/cell:opacity-100 transition-all hover:bg-emerald-500 hover:text-white" title="Abrir WhatsApp"><MessageCircle size={14} strokeWidth={2.5} /></div>}
                                                    </button>
                                                </div>
                                                
                                                {/* 🚨 El botón de horario ya usa CLASS_INTERACTIVE_GLASS_ELEMENT pero cambia fondo condicionalmente. Lo mantenemos pero ajustando sombra/hover */}
                                                <button type="button" onClick={(e) => { e.stopPropagation(); openModal?.('editBranchHorarios', branch); }} className={`group/horario w-full rounded-[1.25rem] px-4 py-3 border flex items-center justify-between transition-all duration-300 active:scale-95 ${!scheduleDefined ? 'bg-red-50/80 border-red-200 shadow-[0_4px_15px_rgba(239,68,68,0.1)] hover:bg-red-50 hover:shadow-sm' : 'bg-white/40 backdrop-blur-md border-white/90 shadow-[0_4px_15px_rgba(0,0,0,0.02),inset_0_2px_10px_rgba(255,255,255,0.6)] hover:bg-white/60 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,1)] hover:-translate-y-0.5'}`} title="Configurar Horarios">
                                                    <div className="flex items-center gap-2">
                                                        <Clock size={14} className={`transition-colors duration-300 ${!scheduleDefined ? 'text-red-500' : 'text-slate-500 group-hover/horario:text-[#007AFF]'}`} strokeWidth={2.5} />
                                                        <span className={`text-[10px] font-black uppercase tracking-widest transition-colors duration-300 ${!scheduleDefined ? 'text-red-500' : 'text-slate-500 group-hover/horario:text-slate-700'}`}>
                                                            {!scheduleDefined ? 'Falta Horario' : 'Horario (Hoy)'}
                                                        </span>
                                                    </div>                                
                                                    <span className={`font-bold text-[12px] tracking-tight ${!scheduleDefined ? 'text-red-600' : todaySchedule === 'CERRADO' ? 'px-2 py-0.5 bg-slate-200/60 text-slate-500 rounded-md text-[9px] uppercase tracking-widest' : 'text-slate-800'}`}>
                                                        {!scheduleDefined ? 'Definir' : todaySchedule}
                                                    </span>
                                                </button>
                                            </div>

                                            {/* 🚨 PÍLDORAS UNIFICADAS: Ahora usan CLASS_INTERACTIVE_GLASS_ELEMENT */}
                                            <div className="grid grid-cols-3 gap-2 mt-auto pt-1">
                                                {/* Legal */}
                                                <button type="button" onClick={(e) => { e.stopPropagation(); openModal?.('editBranchLegal', branch); }} className={`group/prog flex flex-col justify-center gap-1.5 p-2.5 min-h-[48px] rounded-[1rem] text-left cursor-pointer ${CLASS_INTERACTIVE_GLASS_ELEMENT}`} title="Completar datos legales">
                                                    <div className="flex items-center justify-between w-full">
                                                        <Scale size={12} strokeWidth={2.5} className={`transition-colors duration-300 ${completion.legal === 0 ? 'text-red-500' : completion.legal === 100 ? 'text-slate-400 group-hover/prog:text-slate-600' : 'text-amber-500'}`} />
                                                        <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${completion.legal === 0 ? 'text-red-500/80' : 'text-slate-400 group-hover/prog:text-slate-700'}`}>Legal</span>
                                                    </div>
                                                    {completion.legal < 100 && (
                                                        <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden border border-white/50">
                                                            <div className={`h-full transition-all duration-500 ${completion.legal === 0 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${Math.max(completion.legal, 5)}%` }} />
                                                        </div>
                                                    )}
                                                </button>

                                                {/* Local */}
                                                <button type="button" onClick={(e) => { e.stopPropagation(); openModal?.('editBranchInmueble', branch); }} className={`group/prog flex flex-col justify-center gap-1.5 p-2.5 min-h-[48px] rounded-[1rem] text-left cursor-pointer ${CLASS_INTERACTIVE_GLASS_ELEMENT}`} title="Completar datos de inmueble">
                                                    <div className="flex items-center justify-between w-full">
                                                        <Building2 size={12} strokeWidth={2.5} className={`transition-colors duration-300 ${completion.property === 0 ? 'text-red-500' : completion.property === 100 ? 'text-slate-400 group-hover/prog:text-slate-600' : 'text-amber-500'}`} />
                                                        <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${completion.property === 0 ? 'text-red-500/80' : 'text-slate-400 group-hover/prog:text-slate-700'}`}>Local</span>
                                                    </div>
                                                    {completion.property < 100 && (
                                                        <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden border border-white/50">
                                                            <div className={`h-full transition-all duration-500 ${completion.property === 0 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${Math.max(completion.property, 5)}%` }} />
                                                        </div>
                                                    )}
                                                </button>

                                                {/* Servicios */}
                                                <button type="button" onClick={(e) => { e.stopPropagation(); openModal?.('editBranchServicios', branch); }} className={`group/prog flex flex-col justify-center gap-1.5 p-2.5 min-h-[48px] rounded-[1rem] text-left cursor-pointer ${CLASS_INTERACTIVE_GLASS_ELEMENT}`} title="Completar servicios básicos">
                                                    <div className="flex items-center justify-between w-full">
                                                        <Zap size={12} strokeWidth={2.5} className={`transition-colors duration-300 ${completion.services === 0 ? 'text-red-500' : completion.services === 100 ? 'text-slate-400 group-hover/prog:text-slate-600' : 'text-amber-500'}`} />
                                                        <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${completion.services === 0 ? 'text-red-500/80' : 'text-slate-400 group-hover/prog:text-slate-700'}`}>Serv.</span>
                                                    </div>
                                                    {completion.services < 100 && (
                                                        <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden border border-white/50">
                                                            <div className={`h-full transition-all duration-500 ${completion.services === 0 ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${Math.max(completion.services, 5)}%` }} />
                                                        </div>
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="px-6 py-4 bg-white/30 backdrop-blur-xl border-t border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] flex items-center justify-between shrink-0 rounded-b-[2.5rem]">
                                            <button 
                                                type="button"
                                                onClick={() => openModal && openModal("viewBranchEmployees", branch)}
                                                className="flex flex-col gap-1.5 w-1/2 items-start group/personal hover:bg-white/60 p-2 -ml-2 -my-2 rounded-xl transition-all cursor-pointer text-left"
                                                title="Ver Listado de Personal"
                                            >
                                                <div className="flex items-center gap-2 text-slate-400 transition-colors duration-300 group-hover/personal:text-slate-600">
                                                    <Users size={14} className="transition-transform duration-300 group-hover/personal:scale-110 group-hover/personal:text-[#007AFF]" strokeWidth={2.5}/>
                                                    <span className="text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 group-hover/personal:text-slate-600">Personal</span>
                                                </div>
                                                <div className="flex items-center gap-3 w-full pr-4">
                                                    <div className="flex-1 h-1.5 bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] rounded-full overflow-hidden border border-white/80">
                                                        <div className="h-full bg-gradient-to-r from-[#007AFF] to-[#00C6FF]" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-[14px] font-black text-slate-800 leading-none">{count}</span>
                                                </div>
                                            </button>

                                            <div className="w-px h-8 bg-slate-200/60 mx-2"></div>

                                            <button type="button" onClick={() => openModal && openModal("manageKiosks", branch)} className="flex flex-col gap-1.5 w-1/2 items-end group/kiosk hover:bg-white/60 p-2 -mr-2 -my-2 rounded-xl transition-all cursor-pointer" title="Gestionar Kioscos">
                                                <div className="flex items-center gap-2 text-slate-400 transition-colors duration-300 group-hover/kiosk:text-slate-600">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest">Kioscos</span>
                                                    <Monitor size={14} className="transition-transform duration-300 group-hover/kiosk:scale-110 group-hover/kiosk:text-indigo-500" strokeWidth={2.5}/>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[14px] font-black leading-none ${activeKiosks > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>{activeKiosks} <span className="text-[10px] font-bold text-slate-400">/ 3</span></span>
                                                    <div className={`w-2 h-2 rounded-full border ${activeKiosks > 0 ? 'bg-emerald-400 border-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-white shadow-inner border-slate-200'}`} />
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </GlassViewLayout>
        </>
    );
};

export default BranchesView;