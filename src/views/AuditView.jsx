import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    Clock, ShieldCheck, Search, Globe,
    Database, Trash2, AlertCircle,
    ListFilter, ChevronLeft, ChevronRight, Hash,
    ArrowUpDown, ArrowDown, ArrowUp,
    Radio, Power, Check, Download, X,
    MonitorSmartphone, AlertTriangle, Info
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidDatePicker from '../components/common/LiquidDatePicker';

const ACTION_OPTIONS = [
    { value: "ALL", label: "Todas" },
    { value: "REGISTRO_ASISTENCIA", label: "Asistencias" },
    { value: "CREAR_EMPLEADO", label: "Creaciones" },
    { value: "EDITAR_EMPLEADO", label: "Ediciones" },
    { value: "ELIMINAR_EMPLEADO", label: "Eliminaciones" },
];

// ============================================================================
// 🎨 FUNCIONES AUXILIARES (MODO PRO)
// ============================================================================
const getSeverityInfo = (severity) => {
    switch (severity) {
        case 'CRITICAL':
            return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100', icon: <AlertCircle size={12} /> };
        case 'WARNING':
            return { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', icon: <AlertTriangle size={12} /> };
        case 'INFO':
        default:
            return { color: 'text-[#007AFF]', bg: 'bg-[#007AFF]/10', border: 'border-[#007AFF]/20', icon: <Info size={12} /> };
    }
};

const getSourceIcon = (source) => {
    if (source === 'KIOSK') return <MonitorSmartphone size={10} className="md:w-3 md:h-3 text-purple-500" />;
    if (source === 'SYSTEM') return <Database size={10} className="md:w-3 md:h-3 text-slate-500" />;
    return <Globe size={10} className="md:w-3 md:h-3 text-[#007AFF]" />; // ADMIN_PANEL
};

// ============================================================================
// 🚀 FILA DE TABLA ULTRA EFICIENTE (Pura)
// ============================================================================
const AuditRow = memo(({ log, openModal, userPhoto }) => {
    // 🚨 MEJORA: Ahora usamos la Severidad real de la base de datos para los colores
    const severityInfo = useMemo(() => getSeverityInfo(log.severity), [log.severity]);
    const logDate = useMemo(() => new Date(log.created_at), [log.created_at]);
    return (
        <tr className="group hover:bg-[#007AFF]/[0.04] transition-colors duration-300">
            <td className="px-4 md:px-8 py-4">
                <div className="text-[11px] md:text-xs font-black text-slate-800 uppercase tracking-tight transition-colors group-hover:text-[#007AFF]">
                    {logDate.toLocaleDateString()}
                </div>
                <div className="text-[9px] md:text-[10px] font-bold text-slate-500 mt-1 flex flex-col md:flex-row md:items-center gap-1 md:gap-1.5 font-mono">
                    <span className="flex items-center gap-1"><Clock size={10} className="md:w-3 md:h-3" /> {logDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="hidden md:inline mx-1 text-slate-400/50">|</span>
                    {/* 🚨 MEJORA: Muestra si fue Kiosco o Panel */}
                    <span className="flex items-center gap-1">
                        {getSourceIcon(log.source)}
                        <span className="truncate max-w-[100px] md:max-w-[150px]">
                            {log.device_name || (log.source === 'ADMIN_PANEL' ? 'Panel Web' : 'Sistema')}
                        </span>
                    </span>
                </div>
            </td>
            <td className="px-4 md:px-8 py-4">
                <div className="flex items-center gap-2 md:gap-3">
                    <div className="h-7 w-7 md:h-9 md:w-9 rounded-full bg-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.04)] flex items-center justify-center text-slate-600 font-black text-[10px] md:text-[11px] uppercase border border-white shrink-0 group-hover:shadow-md transition-all overflow-visible">
                        {userPhoto ? (
                            <img src={userPhoto} alt={log.user_name} className="w-full h-full object-cover" />
                        ) : (
                            log.user_name?.charAt(0) || '?'
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] md:text-[13px] font-bold text-slate-700 truncate max-w-[120px] md:max-w-none leading-tight">
                            {log.user_name || 'Sistema/Anónimo'}
                        </span>
                        {/* 🚨 MEJORA: Muestra la sucursal debajo del nombre si existe */}
                        {log.branch_name && (
                            <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate max-w-[120px]">
                                {log.branch_name}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="px-4 md:px-8 py-4">
                <span className={`inline-flex items-center gap-1 md:gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest border transition-transform group-hover:scale-[1.02] bg-white/60 backdrop-blur-sm whitespace-nowrap ${severityInfo.color} ${severityInfo.border}`}>
                    {severityInfo.icon} <span className="hidden sm:inline">{log.action?.replace(/_/g, ' ') || 'ACCIÓN'}</span>
                </span>
            </td>
            <td className="px-4 md:px-8 py-4 text-right">
                <button
                    onClick={() => openModal('viewAuditDetail', log)}
                    className="inline-flex items-center justify-center gap-2 w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-2 bg-white/70 hover:bg-white text-slate-600 hover:text-[#007AFF] rounded-full font-bold text-[10px] uppercase tracking-widest transition-all duration-300 shadow-sm border border-white/80 hover:shadow-md hover:-translate-y-0.5 active:scale-95"
                    title="Ver Detalles"
                >
                    <Database size={14} className="md:w-3 md:h-3" /> <span className="hidden md:inline">Detalles</span>
                </button>
            </td>
        </tr>
    );
});

// ============================================================================
// VISTA PRINCIPAL
// ============================================================================
const AuditView = ({ openModal }) => {
    const storeAuditLog = useStaff(state => state.auditLog);
    const auditLog = storeAuditLog || [];
    const fetchAuditLogs = useStaff(state => state.fetchAuditLogs);

    // 👇 NUEVO: Traemos empleados y creamos un diccionario rápido de fotos
    const employees = useStaff(state => state.employees) || [];
    const employeePhotoMap = useMemo(() => {
        const map = {};
        employees.forEach(e => {
            const pic = e.photo || e.photo_url;
            if (e.id && pic) map[e.id] = pic;
        });
        return map;
    }, [employees]);

    const [isSearchMode, setIsSearchMode] = useState(false);
    const [rawSearchTerm, setRawSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [actionFilter, setActionFilter] = useState('ALL');

    const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const [isLive, setIsLive] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isActionPickerOpen, setIsActionPickerOpen] = useState(false);
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // Cerramos cualquier popover o buscador activo en la píldora
                if (isSearchMode) setIsSearchMode(false);
                if (isActionPickerOpen) setIsActionPickerOpen(false);
                if (isDatePickerOpen) setIsDatePickerOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchMode, isActionPickerOpen, isDatePickerOpen]);

    useEffect(() => {
        // 🚨 FIX: Disparamos el fetch SIEMPRE al montar la vista para asegurar datos frescos de Supabase, ignorando la caché local.
        fetchAuditLogs();

        let interval;
        if (isLive) {
            interval = setInterval(() => { fetchAuditLogs(); }, 10000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isLive, fetchAuditLogs]); // 🚨 IMPORTANTE: Eliminamos auditLog.length de las dependencias.

    useEffect(() => {
        const timerId = setTimeout(() => { setDebouncedSearchTerm(rawSearchTerm); }, 300);
        return () => clearTimeout(timerId);
    }, [rawSearchTerm]);

    useEffect(() => { setCurrentPage(1); }, [debouncedSearchTerm, startDate, endDate, actionFilter]);

    const handleSort = useCallback((key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    }, []);

    const clearFilters = useCallback(() => {
        setRawSearchTerm(''); setDebouncedSearchTerm('');
        setStartDate(''); setEndDate(''); setActionFilter('ALL');
    }, []);

    // 🚨 MEJORA: Búsqueda avanzada que incluye dispositivos y sucursales
    const processedLogs = useMemo(() => {
        if (!Array.isArray(auditLog)) return [];

        let result = auditLog.filter(log => {
            const searchLower = debouncedSearchTerm.toLowerCase();
            const matchesSearch =
                (log.user_name?.toLowerCase() || '').includes(searchLower) ||
                (log.action?.toLowerCase() || '').includes(searchLower) ||
                (log.branch_name?.toLowerCase() || '').includes(searchLower) ||
                (log.device_name?.toLowerCase() || '').includes(searchLower);

            const matchesType = actionFilter === 'ALL' || log.action === actionFilter;

            let matchesDate = true;
            if (startDate || endDate) {
                const logDateStr = new Date(log.created_at).toISOString().split('T')[0];
                if (startDate && logDateStr < startDate) matchesDate = false;
                if (endDate && logDateStr > endDate) matchesDate = false;
            }
            return matchesSearch && matchesType && matchesDate;
        });

        result.sort((a, b) => {
            let aValue = a[sortConfig.key] || '';
            let bValue = b[sortConfig.key] || '';
            if (sortConfig.key === 'created_at') {
                aValue = new Date(a.created_at || 0).getTime();
                bValue = new Date(b.created_at || 0).getTime();
            } else {
                aValue = aValue.toString().toLowerCase();
                bValue = bValue.toString().toLowerCase();
            }
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return result;
    }, [auditLog, debouncedSearchTerm, actionFilter, startDate, endDate, sortConfig]);

    // 🚨 MEJORA: Exportación CSV con TODAS las columnas nuevas
    const exportToCSV = useCallback(() => {
        setIsExporting(true);
        setTimeout(() => {
            const escape = (text) => `"${String(text || '').replace(/"/g, '""')}"`;
            const headers = [
                "Fecha", "Hora", "Usuario", "Acción", "Severidad",
                "Origen", "Sucursal", "Dispositivo", "Método de Ingreso",
                "ID Objetivo", "Detalles JSON"
            ];

            const rows = processedLogs.map(log => {
                const dateObj = new Date(log.created_at);
                return [
                    escape(dateObj.toLocaleDateString()),
                    escape(dateObj.toLocaleTimeString()),
                    escape(log.user_name),
                    escape(log.action),
                    escape(log.severity),
                    escape(log.source),
                    escape(log.branch_name),
                    escape(log.device_name),
                    escape(log.input_method),
                    escape(log.target_id),
                    escape(JSON.stringify(log.details || {}))
                ].join(",");
            });
            const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `auditoria_completa_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => setIsExporting(false), 1000);
        }, 100);
    }, [processedLogs]);

    const totalItems = processedLogs.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    const paginatedLogs = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return processedLogs.slice(startIndex, startIndex + itemsPerPage);
    }, [processedLogs, currentPage, itemsPerPage]);

    const hasActiveFilters = debouncedSearchTerm !== '' || startDate !== '' || endDate !== '' || actionFilter !== 'ALL';

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <ArrowUpDown size={14} className="text-slate-300 group-hover:text-slate-400 opacity-50 transition-colors" />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-[#007AFF]" /> : <ArrowDown size={14} className="text-[#007AFF]" />;
    };

const filtersContent = (
        <div
            // 🚨 CONTENEDOR DINÁMICO: "w-max" abraza el contenido y "max-w-full" evita que se rompa en móviles.
            className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}
        >
            {/* =========================================================
                ESTADO 1: MODO BÚSQUEDA (Animación Reparada)
                ========================================================= */}
            <div
                className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden
                transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left
                ${isSearchMode ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"
                    }`}
            >
                <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    type="text"
                    placeholder="Buscar usuario, equipo, acción..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
                    value={rawSearchTerm}
                    onChange={(e) => setRawSearchTerm(e.target.value)}
                    ref={(input) => { if (input && isSearchMode) setTimeout(() => input.focus(), 100) }}
                />
                {rawSearchTerm && (
                    <button
                        onClick={() => setRawSearchTerm("")}
                        className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0"
                    >
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button
                    onClick={() => { setIsSearchMode(false); setRawSearchTerm(""); }}
                    className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"
                    title="Cerrar Búsqueda"
                >
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {/* =========================================================
                ESTADO 2: MODO NORMAL (Píldoras y Fechas)
                ========================================================= */}
            <div
                className={`flex items-center h-full shrink-0 transform-gpu overflow-visible
                transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right
                ${isSearchMode ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-3 gap-3"
                    }`}
            >
                <div className="flex items-center min-w-0 flex-1">
                    {/* ESTADO COLAPSADO DE ACCIONES */}
                    <div className={`flex items-center overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isActionPickerOpen ? "max-w-0 opacity-0 pointer-events-none gap-0 pr-0" : "max-w-[400px] opacity-100 gap-2 md:gap-3 pr-2 md:pr-3"}`}>
                        <button
                            type="button"
                            onClick={() => setIsActionPickerOpen(true)}
                            className={`px-3 md:px-5 h-9 rounded-full flex items-center gap-2 md:gap-3 transition-all duration-300 group whitespace-nowrap border shrink-0 ${actionFilter !== "ALL"
                                ? "bg-white text-slate-800 border-white shadow-md"
                                : "bg-transparent text-slate-600 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"
                                }`}
                            title="Cambiar tipo de acción"
                        >
                            <ListFilter
                                size={16}
                                className={`transition-transform duration-200 transform-gpu md:w-[18px] md:h-[18px] ${actionFilter !== 'ALL' ? 'text-[#007AFF]' : 'group-hover:scale-110'}`}
                            />
                            <span className="text-[11px] md:text-[12px] font-bold uppercase tracking-wider">
                                {ACTION_OPTIONS.find((o) => o.value === actionFilter)?.label || "Acciones"}
                            </span>
                        </button>
                    </div>

                    {/* ESTADO EXPANDIDO DE ACCIONES */}
                    <div className={`flex items-center overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isActionPickerOpen ? "max-w-[800px] opacity-100 ml-1 pr-1 gap-2" : "max-w-0 opacity-0 pointer-events-none m-0 p-0 gap-0"}`}>
                        {ACTION_OPTIONS.map((opt) => {
                            const isActive = actionFilter === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                        setActionFilter(opt.value);
                                        setIsActionPickerOpen(false);
                                    }}
                                    className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${isActive
                                        ? "bg-white text-slate-800 border-white shadow-md scale-[1.02]"
                                        : "bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}

                        <button
                            type="button"
                            onClick={() => setIsActionPickerOpen(false)}
                            className="w-9 h-9 rounded-full bg-white/50 border border-white/60 hover:bg-red-50 hover:border-red-200 hover:text-red-500 text-slate-500 flex items-center justify-center transition-all duration-300 hover:shadow-md shrink-0 ml-1 hover:-translate-y-0.5"
                            title="Cerrar"
                        >
                            <X size={14} strokeWidth={2.5} />
                        </button>
                    </div>
                </div>

                {/* FILTROS DERECHA (Fechas, Basurero Global y Botón de Búsqueda) */}
                <div
                    className={`flex items-center shrink-0 border-l transform-gpu overflow-visible
                    transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right border-slate-200/60
                    ${isActionPickerOpen
                            ? "max-w-0 opacity-0 scale-95 pointer-events-none ml-0 pl-0 border-transparent m-0"
                            : "max-w-[600px] opacity-100 scale-100 ml-3 md:ml-4 pl-3 md:pl-4 gap-2 md:gap-4"
                        }`}
                >
                    <div className={`flex items-center gap-1 shrink-0 px-2 py-1 rounded-2xl transition-all duration-300 group relative z-10 border w-auto ${startDate || endDate || isDatePickerOpen
                        ? 'bg-white border-white shadow-md'
                        : 'bg-transparent border-transparent hover:shadow-md hover:bg-white hover:border-white/90 hover:-translate-y-0.5'
                        }`}>
                        
                        {/* 🚨 Aquí cambiamos a "Inicio" */}
                        <LiquidDatePicker
                            value={startDate}
                            onChange={setStartDate}
                            placeholder="Inicio"
                            onOpenChange={setIsDatePickerOpen}
                        />

                        <span className="text-slate-300 font-bold group-hover:text-slate-400 transition-colors mx-1">-</span>

                        {/* 🚨 Aquí cambiamos a "Fin" */}
                        <LiquidDatePicker
                            value={endDate}
                            onChange={setEndDate}
                            placeholder="Fin"
                            onOpenChange={setIsDatePickerOpen}
                        />
                    </div>

                    {/* BOTÓN LIMPIAR TODO */}
                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                clearFilters();
                            }}
                            className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/70 border border-white/90 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 flex items-center justify-center transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5 shrink-0 animate-in zoom-in-50 duration-300"
                            title="Limpiar todos los filtros"
                        >
                            <Trash2 size={15} strokeWidth={2.5} />
                        </button>
                    )}

                    <button
                        onClick={() => setIsSearchMode(true)}
                        className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu"
                        title="Buscar por texto"
                    >
                        <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                        {rawSearchTerm && (
                            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
    return (
        <GlassViewLayout
            icon={ShieldCheck}
            title="Auditoría de Sistema"
            liveIndicator={isLive}
            filtersContent={filtersContent}
        >
            <div className="px-4 md:px-8 py-4 md:py-5 bg-white/40 border-b border-white/90 flex justify-between items-center">
                <div className="flex items-center gap-2 text-[10px] md:text-[11px] font-bold uppercase text-slate-600 tracking-widest">
                    <Hash size={12} className="text-[#007AFF] md:w-3 md:h-3" />
                    {totalItems} <span className="hidden sm:inline">Registros</span>
                </div>

                <div className="flex items-center gap-2 md:gap-3">
                    <button
                        onClick={() => setIsLive(!isLive)}
                        className={`hidden md:flex items-center gap-2 px-4 py-2 font-bold text-[10px] uppercase tracking-widest rounded-full border transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-95 ${isLive ? 'bg-red-500 text-white border-red-600 hover:bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-white/80 text-slate-500 border-slate-200/60 hover:bg-white hover:text-[#007AFF]'}`}
                    >
                        {isLive ? <Radio size={12} className="animate-pulse" /> : <Power size={12} />}
                        <span>{isLive ? 'En Vivo' : 'En Vivo (OFF)'}</span>
                    </button>

                    <button
                        onClick={exportToCSV}
                        disabled={processedLogs.length === 0 || isExporting}
                        className={`flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 font-bold text-[9px] md:text-[10px] uppercase tracking-widest rounded-full border shadow-sm transition-all hover:shadow hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed group active:scale-95 ${isExporting ? 'bg-emerald-50/90 text-emerald-600 border-emerald-200/50' : 'bg-white/80 hover:bg-white text-slate-600 border-slate-200/60 hover:text-[#007AFF]'}`}
                    >
                        {isExporting ? <Check size={12} className="text-emerald-500" /> : <Download size={12} className="group-hover:-translate-y-0.5 transition-transform" />}
                        <span>{isExporting ? 'Ok' : 'Exportar'}</span>
                    </button>
                </div>
            </div>

            <div className="w-full overflow-x-auto scrollbar-hide">
                <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                    <thead className="bg-white/40">
                        <tr>
                            <th onClick={() => handleSort('created_at')} className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] md:tracking-[0.15em] cursor-pointer hover:bg-white/30 transition-colors group select-none border-b border-white/40">
                                <div className="flex items-center gap-2">Origen / Hora <SortIcon columnKey="created_at" /></div>
                            </th>
                            <th onClick={() => handleSort('user_name')} className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] md:tracking-[0.15em] cursor-pointer hover:bg-white/30 transition-colors group select-none border-b border-white/40">
                                <div className="flex items-center gap-2">Usuario <SortIcon columnKey="user_name" /></div>
                            </th>
                            <th onClick={() => handleSort('action')} className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] md:tracking-[0.15em] cursor-pointer hover:bg-white/30 transition-colors group select-none border-b border-white/40">
                                <div className="flex items-center gap-2">Acción <SortIcon columnKey="action" /></div>
                            </th>
                            <th className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] md:tracking-[0.15em] text-right border-b border-white/40">
                                Detalles
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/50 font-sans">
                        {paginatedLogs.length > 0 ? (
                            paginatedLogs.map((log) => {
                                // 🚨 MAGIA PRO: Si es de kiosco, la foto suele estar en el target_id
                                const foundPhoto = employeePhotoMap[log.user_id] || employeePhotoMap[log.target_id];

                                return (
                                    <AuditRow
                                        key={log.id}
                                        log={log}
                                        openModal={openModal}
                                        userPhoto={foundPhoto}
                                    />
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan="4" className="py-24 text-center">
                                    <div className="flex flex-col items-center justify-center opacity-70 px-4">
                                        <div className="bg-white/60 p-4 md:p-5 rounded-full mb-4 border border-white/80 shadow-sm">
                                            <ListFilter size={28} className="text-slate-500 md:w-9 md:h-9" />
                                        </div>
                                        <p className="text-[14px] md:text-[15px] font-bold text-slate-700">No hay registros</p>
                                        <p className="text-[10px] md:text-xs font-medium text-slate-500 mt-1 max-w-[200px] md:max-w-none text-center">Limpia los filtros o cambia la búsqueda.</p>
                                        <button
                                            onClick={clearFilters}
                                            className="mt-6 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-[#007AFF] hover:text-[#0066CC] hover:bg-white/80 px-4 py-2 rounded-full transition-all border border-white/60 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                                        >
                                            Limpiar Filtros
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalItems > 0 && (
                <div className="px-4 md:px-8 py-4 md:py-5 bg-white/50 border-t border-white/90 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-start">
                        <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mostrar</span>
                        <select
                            className="bg-white/80 backdrop-blur-md border border-white/80 rounded-full px-2 md:px-3 py-1.5 text-[10px] md:text-[11px] font-bold text-slate-700 outline-none hover:border-[#007AFF]/50 cursor-pointer shadow-sm uppercase tracking-wider transition-colors"
                            value={itemsPerPage}
                            onChange={(e) => {
                                setItemsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                        >
                            <option value={15}>15 Filas</option>
                            <option value={30}>30 Filas</option>
                            <option value={50}>50 Filas</option>
                            <option value={100}>100 Filas</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-4 md:gap-6 w-full sm:w-auto justify-between sm:justify-end">
                        <span className="text-[9px] md:text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                            Pág {currentPage} de {totalPages || 1}
                        </span>

                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setCurrentPage(prev => Math.max(prev - 1, 1));
                                }}
                                disabled={currentPage === 1}
                                className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center bg-white/80 backdrop-blur-md border border-white/80 rounded-full shadow-sm text-slate-700 hover:text-[#007AFF] hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow hover:-translate-y-0.5 active:scale-95 transform-gpu"
                            >
                                <ChevronLeft size={14} className="md:w-4 md:h-4" strokeWidth={2.5} />
                            </button>
                            <button
                                onClick={() => {
                                    setCurrentPage(prev => Math.min(prev + 1, totalPages));
                                }}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center bg-white/80 backdrop-blur-md border border-white/80 rounded-full shadow-sm text-slate-700 hover:text-[#007AFF] hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow hover:-translate-y-0.5 active:scale-95 transform-gpu"
                            >
                                <ChevronRight size={14} className="md:w-4 md:h-4" strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </GlassViewLayout>
    );
};

export default AuditView;