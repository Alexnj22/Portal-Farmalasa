import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Button from '../components/common/Button';
import TabBarAction from '../components/common/TabBarAction';
import ViewTabBar from '../components/common/ViewTabBar';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    Clock, ShieldCheck, Search, Globe,
    Database, AlertCircle, ListFilter, Hash,
    Radio, Power, Check, Download,
    MonitorSmartphone, AlertTriangle, Info
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import FilterBar from '../components/common/FilterBar';
import TablePagination from '../components/common/TablePagination';
import LiquidSelect from '../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { smartFilter } from '../utils/searchUtils';
import Badge from '../components/common/Badge';

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
            return { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30', icon: <AlertCircle size={12} />, variante: 'danger' };
        case 'WARNING':
            return { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', icon: <AlertTriangle size={12} />, variante: 'warning' };
        case 'INFO':
        default:
            return { color: 'text-brand-text', bg: 'bg-brand/10', border: 'border-brand/20', icon: <Info size={12} />, variante: 'info' };
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
                <Badge variant={severityInfo.variante || 'neutral'} size="sm">
                    {severityInfo.icon} <span className="hidden sm:inline">{log.action?.replace(/_/g, ' ') || 'ACCIÓN'}</span>
                </Badge>
            </DataCell>
            <DataCell align="right">
                <Button variant="secondary" size="sm" icon={Database} title="Ver Detalles" onClick={() => openModal('viewAuditDetail', log)}><span className="hidden md:inline">Detalles</span></Button>
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
    // 25 y no 15: es el primer valor de `PAGE_SIZE_OPTIONS`, la escala del
    // canónico. Con 15 el selector de tamaño quedaba sin opción que coincidiera
    // y se veía vacío — un tamaño de página propio por vista es justo la
    // divergencia que `TablePagination` vino a cerrar.
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [isLive, setIsLive] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Acá vivía un `isDatePickerOpen` con su listener global de Escape. Era
    // mecanismo fingido: cerrar ese estado no cerraba el calendario, porque el
    // calendario es dueño de su propio abierto/cerrado — `onOpenChange` solo
    // avisa. Se fue con los datepickers al cuerpo.

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


// D3.9 (2026-07-27): barra reescrita a mano → canónico.
// El "selector de acciones" era una píldora que se expandía EN LÍNEA en una fila
// de 5 opciones, colapsando el resto de la barra: un tercer estado propio, y un
// dropdown escrito a mano — justo lo que la regla del proyecto prohíbe
// (feedback_liquid_select: nunca un dropdown nuevo). Con 5 opciones eso es un
// LiquidSelect, que es lo que ya usan Facturación y Monitor en su barra. Al
// cambiarlo desaparece el tercer estado y la vista queda como las otras doce.
//
// §17 (v2.99.1): los tres filtros que vivían acá —acciones y el rango de
// fechas— bajaron al CUERPO. El header es de las pestañas y el buscador; acá
// solo quedan las dos ACCIONES de la vista, que antes eran `<button>` crudos
// dentro de la tabla, cada uno con su propio relleno, su glow y su forma.
const filtersContent = (
    <ViewTabBar
        searchValue={rawSearchTerm}
        onSearchChange={setRawSearchTerm}
        placeholder="Buscar por usuario, acción o detalle..."
        trailingActions={
            <>
                <TabBarAction
                    icon={isLive ? Radio : Power}
                    tone={isLive ? 'danger' : 'brand'}
                    variant={isLive ? 'primary' : 'quiet'}
                    onClick={() => setIsLive(!isLive)}>
                    {isLive ? 'En vivo' : 'En vivo (off)'}
                </TabBarAction>
                <TabBarAction
                    icon={isExporting ? Check : Download}
                    tone={isExporting ? 'success' : 'brand'}
                    disabled={processedLogs.length === 0 || isExporting}
                    onClick={exportToCSV}>
                    {isExporting ? 'Listo' : 'Exportar'}
                </TabBarAction>
            </>
        }
    />
);

// ── Cuerpo: la barra de filtros (§17) ────────────────────────────────────
// Orden de ranuras: entidad (acción) → tiempo (rango). No hay ámbito acá: la
// auditoría es del sistema entero, no de una sucursal.
const filtrosCuerpo = (
    <FilterBar
        onClear={clearFilters}
        activeCount={[actionFilter !== 'ALL', !!startDate, !!endDate].filter(Boolean).length}
    >
        <FilterBar.Section active={actionFilter !== 'ALL'} onClear={() => setActionFilter('ALL')} label="acción">
            <div className="w-[170px]">
                <LiquidSelect
                    value={actionFilter}
                    onChange={val => setActionFilter(val || 'ALL')}
                    options={ACTION_OPTIONS}
                    icon={ListFilter}
                    placeholder="Acciones"
                    compact bare clearable={false}
                />
            </div>
        </FilterBar.Section>

        <FilterBar.Section active={!!startDate || !!endDate}
            onClear={() => { setStartDate(''); setEndDate(''); }} label="fecha">
            <div className="flex items-center gap-1">
                <LiquidDatePicker compact shortcuts value={startDate} onChange={setStartDate} placeholder="Inicio" />
                <span className="text-content-3 font-bold mx-0.5">-</span>
                <LiquidDatePicker compact shortcuts value={endDate} onChange={setEndDate} placeholder="Fin" />
            </div>
        </FilterBar.Section>
    </FilterBar>
);
    return (
        <GlassViewLayout
            icon={ShieldCheck}
            title="Auditoría de Sistema"
            liveIndicator={isLive}
            filtersContent={filtersContent}
        >
            {/* Cuenta a la izquierda, barra de filtros a la derecha (§17) */}
            <div className="px-4 md:px-8 py-4 bg-surface-card border-b border-border-card flex justify-between items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-caption md:text-label font-bold uppercase text-content-2 tracking-widest">
                    <Hash size={12} className="text-brand-text md:w-3 md:h-3" />
                    {totalItems} <span className="hidden sm:inline">Registros</span>
                </div>
                {filtrosCuerpo}
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
                    message: 'Sin registros',
                    subtext: 'Limpia los filtros o cambia la búsqueda.',
                    action: { label: 'Limpiar Filtros', onClick: clearFilters },
                }}
                // §17.2 — la paginación NUNCA se escribe a mano. Esta era tres
                // islas separadas por `justify-between`, con "Pág 1 de 52" pero
                // sin decir cuántos registros se están viendo, y en móvil se
                // partía en dos filas. El canónico dice el RANGO (`1–15 de 320`),
                // que responde "dónde estoy" y "cuánto hay" a la vez.
                footer={totalItems > 0 ? (
                    <TablePagination
                        page={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        pageSize={itemsPerPage}
                        onPageSizeChange={val => { setItemsPerPage(Number(val)); setCurrentPage(1); }}
                        total={totalItems}
                        unit="registros"
                    />
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