import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Button from '../components/common/Button';
import TabBarAction from '../components/common/TabBarAction';
import ViewTabBar from '../components/common/ViewTabBar';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    Clock, ShieldCheck, Search, Globe,
    Database, Trash2, AlertCircle,
    ListFilter, ChevronLeft, ChevronRight, Hash,
    Radio, Power, Check, Download, X,
    MonitorSmartphone, AlertTriangle, Info
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import LiquidSelect from '../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { smartFilter } from '../utils/searchUtils';

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
            return { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30', icon: <AlertCircle size={12} /> };
        case 'WARNING':
            return { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', icon: <AlertTriangle size={12} /> };
        case 'INFO':
        default:
            return { color: 'text-brand-text', bg: 'bg-brand/10', border: 'border-brand/20', icon: <Info size={12} /> };
    }
};

const getSourceIcon = (source) => {
    if (source === 'KIOSK') return <MonitorSmartphone size={10} className="md:w-3 md:h-3 text-chart-3-text" />;
    if (source === 'SYSTEM') return <Database size={10} className="md:w-3 md:h-3 text-content-3" />;
    return <Globe size={10} className="md:w-3 md:h-3 text-brand-text" />; // ADMIN_PANEL
};

// ============================================================================
// 🚀 FILA DE TABLA ULTRA EFICIENTE (Pura)
// ============================================================================
const AuditRow = memo(({ log, openModal, userPhoto }) => {
    // 🚨 MEJORA: Ahora usamos la Severidad real de la base de datos para los colores
    const severityInfo = useMemo(() => getSeverityInfo(log.severity), [log.severity]);
    const logDate = useMemo(() => new Date(log.created_at), [log.created_at]);
    return (
        <DataRow>
            <DataCell>
                <div className="text-label md:text-xs font-black text-content uppercase tracking-tight transition-colors group-hover:text-brand-text">
                    {logDate.toLocaleDateString()}
                </div>
                <div className="text-micro md:text-caption font-bold text-content-3 mt-1 flex flex-col md:flex-row md:items-center gap-1 md:gap-1.5 font-mono">
                    <span className="flex items-center gap-1"><Clock size={10} className="md:w-3 md:h-3" /> {logDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                    <span className="hidden md:inline mx-1 text-content-3/50">|</span>
                    {/* 🚨 MEJORA: Muestra si fue Kiosco o Panel */}
                    <span className="flex items-center gap-1">
                        {getSourceIcon(log.source)}
                        <span className="truncate max-w-[100px] md:max-w-[150px]">
                            {log.device_name || (log.source === 'ADMIN_PANEL' ? 'Panel Web' : 'Sistema')}
                        </span>
                    </span>
                </div>
            </DataCell>
            <DataCell>
                <div className="flex items-center gap-2 md:gap-3">
                    <div className="h-7 w-7 md:h-9 md:w-9 rounded-full bg-surface-card shadow-[var(--shadow-elevation-xs)] flex items-center justify-center text-content-2 font-black text-caption md:text-label uppercase border border-border-card shrink-0 group-hover:shadow-md transition-all overflow-visible">
                        {userPhoto ? (
                            <img src={userPhoto} alt={log.user_name} className="w-full h-full object-cover" />
                        ) : (
                            log.user_name?.charAt(0) || '?'
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-label md:text-body font-bold text-content-2 truncate max-w-[120px] md:max-w-none leading-tight">
                            {log.user_name || 'Sistema/Anónimo'}
                        </span>
                        {/* 🚨 MEJORA: Muestra la sucursal debajo del nombre si existe */}
                        {log.branch_name && (
                            <span className="text-micro md:text-micro font-bold text-content-2 uppercase tracking-widest mt-0.5 truncate max-w-[120px]">
                                {log.branch_name}
                            </span>
                        )}
                    </div>
                </div>
            </DataCell>
            <DataCell>
                <span className={`inline-flex items-center gap-1 md:gap-1.5 px-2 py-1 md:px-2.5 md:py-1.5 rounded-lg text-micro md:text-micro font-black uppercase tracking-widest border transition-transform group-hover:scale-[1.02] bg-surface-card backdrop-blur-sm whitespace-nowrap ${severityInfo.color} ${severityInfo.border}`}>
                    {severityInfo.icon} <span className="hidden sm:inline">{log.action?.replace(/_/g, ' ') || 'ACCIÓN'}</span>
                </span>
            </DataCell>
            <DataCell align="right">
                <button
                    onClick={() => openModal('viewAuditDetail', log)}
                    className="inline-flex items-center justify-center gap-2 w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-2 bg-surface-card hover:bg-surface-card-hover text-content-2 hover:text-brand-text rounded-full font-bold text-caption uppercase tracking-widest transition-all duration-300 shadow-sm border border-border-card hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97]"
                    title="Ver Detalles"
                >
                    <Database size={14} className="md:w-3 md:h-3" /> <span className="hidden md:inline">Detalles</span>
                </button>
            </DataCell>
        </DataRow>
    );
});

const EMPTY_ARRAY = [];

const AuditView = ({ openModal }) => {
    const storeAuditLog = useStaff(state => state.auditLog);
    const auditLog = storeAuditLog || EMPTY_ARRAY;
    const fetchAuditLogs = useStaff(state => state.fetchAuditLogs);

    // 👇 NUEVO: Traemos empleados y creamos un diccionario rápido de fotos
    const employees = useStaff(state => state.employees) || EMPTY_ARRAY;
    const employeePhotoMap = useMemo(() => {
        const map = {};
        employees.forEach(e => {
            const pic = e.photo || e.photo_url;
            if (e.id && pic) map[e.id] = pic;
        });
        return map;
    }, [employees]);

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
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // El buscador lo cierra ViewTabBar; acá solo queda el datepicker.
                if (isDatePickerOpen) setIsDatePickerOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDatePickerOpen]);

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

    useEffect(() => { setCurrentPage(1); }, [debouncedSearchTerm, startDate, endDate, actionFilter]); // eslint-disable-line react-hooks/set-state-in-effect -- resetea paginación al cambiar filtros

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

    const processedLogsBase = useMemo(() => {
        if (!Array.isArray(auditLog)) return [];
        return auditLog.filter(log => {
            const matchesType = actionFilter === 'ALL' || log.action === actionFilter;
            let matchesDate = true;
            if (startDate || endDate) {
                const logDateStr = new Date(log.created_at).toISOString().split('T')[0];
                if (startDate && logDateStr < startDate) matchesDate = false;
                if (endDate && logDateStr > endDate) matchesDate = false;
            }
            return matchesType && matchesDate;
        });
    }, [auditLog, actionFilter, startDate, endDate]);

    const { results: processedLogs, isFuzzy: isLogSearchFuzzy } = useMemo(() => {
        const base = processedLogsBase.slice().sort((a, b) => {
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
        if (!debouncedSearchTerm.trim()) return { results: base, isFuzzy: false };
        return smartFilter(debouncedSearchTerm, base, log => [log.user_name, log.action, log.branch_name, log.device_name]);
    }, [processedLogsBase, debouncedSearchTerm, sortConfig]);

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

// D3.9 (2026-07-27): barra reescrita a mano → canónico.
// El "selector de acciones" era una píldora que se expandía EN LÍNEA en una fila
// de 5 opciones, colapsando el resto de la barra: un tercer estado propio, y un
// dropdown escrito a mano — justo lo que la regla del proyecto prohíbe
// (feedback_liquid_select: nunca un dropdown nuevo). Con 5 opciones eso es un
// LiquidSelect, que es lo que ya usan Facturación y Monitor en su barra. Al
// cambiarlo desaparece el tercer estado y la vista queda como las otras doce.
const filtersContent = (
    <ViewTabBar
        searchValue={rawSearchTerm}
        onSearchChange={setRawSearchTerm}
        placeholder="Buscar por usuario, acción o detalle..."
        trailingActions={
            <>
                <div className="w-[150px] md:w-[180px] shrink-0">
                    <LiquidSelect
                        value={actionFilter}
                        onChange={setActionFilter}
                        options={ACTION_OPTIONS}
                        icon={ListFilter}
                        placeholder="Acciones"
                        compact bare clearable={false}
                    />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <LiquidDatePicker compact shortcuts value={startDate} onChange={setStartDate}
                        placeholder="Inicio" onOpenChange={setIsDatePickerOpen} />
                    <span className="text-content-3 font-bold mx-0.5">-</span>
                    <LiquidDatePicker compact shortcuts value={endDate} onChange={setEndDate}
                        placeholder="Fin" onOpenChange={setIsDatePickerOpen} />
                </div>
                {hasActiveFilters && (
                    <TabBarAction icon={Trash2} tone="danger" onClick={clearFilters} label="Limpiar todos los filtros" />
                )}
            </>
        }
    />
);
    return (
        <GlassViewLayout
            icon={ShieldCheck}
            title="Auditoría de Sistema"
            liveIndicator={isLive}
            filtersContent={filtersContent}
        >
            <div className="px-4 md:px-8 py-4 md:py-5 bg-surface-card border-b border-border-card flex justify-between items-center">
                <div className="flex items-center gap-2 text-caption md:text-label font-bold uppercase text-content-2 tracking-widest">
                    <Hash size={12} className="text-brand-text md:w-3 md:h-3" />
                    {totalItems} <span className="hidden sm:inline">Registros</span>
                </div>

                <div className="flex items-center gap-2 md:gap-3">
                    <button
                        onClick={() => setIsLive(!isLive)}
                        className={`hidden md:flex items-center gap-2 px-4 py-2 font-bold text-caption uppercase tracking-widest rounded-full border transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-[0.97] ${isLive ? 'bg-danger-solid text-white border-danger hover:bg-danger-hover shadow-[var(--shadow-glow-danger-md)]' : 'bg-surface-card text-content-3 border-divider hover:bg-surface-card-hover hover:text-brand-text'}`}
                    >
                        {isLive ? <Radio size={12} className="animate-pulse" /> : <Power size={12} />}
                        <span>{isLive ? 'En Vivo' : 'En Vivo (OFF)'}</span>
                    </button>

                    <button
                        onClick={exportToCSV}
                        disabled={processedLogs.length === 0 || isExporting}
                        className={`flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 font-bold text-micro md:text-caption uppercase tracking-widest rounded-btn border shadow-sm transition-all hover:shadow hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed group active:scale-[0.97] ${isExporting ? 'bg-success/10 text-success border-success/30' : 'bg-surface-card hover:bg-surface-card-hover text-content-2 border-divider hover:text-brand-text'}`}
                    >
                        {isExporting ? <Check size={12} className="text-success" /> : <Download size={12} className="group-hover:-translate-y-0.5 transition-transform" />}
                        <span>{isExporting ? 'Ok' : 'Exportar'}</span>
                    </button>
                </div>
            </div>

            <DataTable
                columns={[
                    { key: 'created_at', label: 'Origen / Hora', sortable: true },
                    { key: 'user_name',  label: 'Usuario',       sortable: true },
                    { key: 'action',     label: 'Acción',        sortable: true },
                    { key: 'details',    label: 'Detalles',      align: 'right' },
                ]}
                sortKey={sortConfig.key}
                sortDir={sortConfig.direction}
                onSort={handleSort}
                loading={false}
                empty={{
                    icon: ListFilter,
                    message: 'No hay registros',
                    subtext: 'Limpia los filtros o cambia la búsqueda.',
                    action: { label: 'Limpiar Filtros', onClick: clearFilters },
                }}
                footer={totalItems > 0 ? (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
                        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-start">
                            <span className="text-micro md:text-caption font-bold text-content-3 uppercase tracking-widest">Mostrar</span>
                            <div className="w-[110px]">
                                <LiquidSelect
                                    value={itemsPerPage}
                                    onChange={val => { setItemsPerPage(Number(val)); setCurrentPage(1); }}
                                    options={[
                                        { value: 15, label: '15 Filas' },
                                        { value: 30, label: '30 Filas' },
                                        { value: 50, label: '50 Filas' },
                                        { value: 100, label: '100 Filas' },
                                    ]}
                                    clearable={false}
                                    compact
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-4 md:gap-6 w-full sm:w-auto justify-between sm:justify-end">
                            <span className="text-micro md:text-caption font-bold text-content-2 uppercase tracking-widest">Pág {currentPage} de {totalPages || 1}</span>
                            <div className="flex gap-2">
                                <Button variant="secondary" shape="pill" size="sm" icon={ChevronLeft} disabled={currentPage === 1} iconOnly onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} />
                                <Button variant="secondary" shape="pill" size="sm" icon={ChevronRight} disabled={currentPage === totalPages || totalPages === 0} iconOnly onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} />
                            </div>
                        </div>
                    </div>
                ) : null}
            >
                {isLogSearchFuzzy && debouncedSearchTerm && (
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                        <Search size={12} strokeWidth={2.5} className="shrink-0" />
                        Resultados similares para &ldquo;{debouncedSearchTerm}&rdquo; — no se encontraron coincidencias exactas
                    </div>
                )}
                {paginatedLogs.map((log) => {
                    const foundPhoto = employeePhotoMap[log.user_id] || employeePhotoMap[log.target_id];
                    return (
                        <AuditRow key={log.id} log={log} openModal={openModal} userPhoto={foundPhoto} />
                    );
                })}
            </DataTable>
        </GlassViewLayout>
    );
};

export default AuditView;