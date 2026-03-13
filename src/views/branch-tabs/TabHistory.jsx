import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X, Search, Download, Clock, FileText, Users, Eye, FileOutput, Printer, CheckCircle2, AlertTriangle, Settings, Building2, Wallet, Calendar, ChevronRight } from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';

// ============================================================================
// 🎨 MOTOR DE TEMAS (Colores e Iconos dinámicos)
// ============================================================================
const getThemeForAction = (action, isDoc, isSynthetic) => {
    if (isSynthetic) return { icon: Building2, bg: 'bg-orange-50', text: 'text-orange-500', border: 'border-orange-200', dot: 'bg-orange-500', shadow: 'shadow-[0_4px_20px_rgba(249,115,22,0.15)]' };
    if (isDoc) return { icon: FileText, bg: 'bg-blue-50', text: 'text-[#007AFF]', border: 'border-[#007AFF]/20', dot: 'bg-[#007AFF]', shadow: 'shadow-[0_4px_20px_rgba(0,122,255,0.15)]' };

    switch (action) {
        case 'PAGO_REGISTRADO':
            return { icon: Wallet, bg: 'bg-emerald-50', text: 'text-emerald-500', border: 'border-emerald-200', dot: 'bg-emerald-500', shadow: 'shadow-[0_4px_20px_rgba(16,185,129,0.15)]' };
        case 'ALERTA_SISTEMA':
        case 'INSPECTION_RECORDED':
            return { icon: AlertTriangle, bg: 'bg-red-50', text: 'text-red-500', border: 'border-red-200', dot: 'bg-red-500', shadow: 'shadow-[0_4px_20px_rgba(239,68,68,0.15)]' };
        case 'EDITAR_SUCURSAL':
        case 'APERTURA_OFICIAL':
        case 'VINCULAR_KIOSCO':
        case 'REVOCAR_KIOSCO':
        case 'CREAR_TURNO_CATALOGO':
        case 'ELIMINAR_TURNO':
            return { icon: Settings, bg: 'bg-indigo-50', text: 'text-indigo-500', border: 'border-indigo-200', dot: 'bg-indigo-500', shadow: 'shadow-[0_4px_20px_rgba(99,102,241,0.15)]' };
        case 'PERSONAL_ASIGNADO':
        case 'EDITAR_EMPLEADO':
        case 'ELIMINAR_EMPLEADO':
        case 'ACCION_RRHH':
        case 'ASIGNAR_TURNO_SEMANAL':
        case 'REGISTRO_ASISTENCIA':
            return { icon: Users, bg: 'bg-purple-50', text: 'text-purple-500', border: 'border-purple-200', dot: 'bg-purple-500', shadow: 'shadow-[0_4px_20px_rgba(168,85,247,0.15)]' };
        default:
            return { icon: CheckCircle2, bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400', shadow: 'shadow-sm' };
    }
};

const TabHistory = ({ liveBranch, history = [], isLoadingHistory, employees = [], openModal }) => {
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [showAllHistory, setShowAllHistory] = useState(false);

    const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
    const hoverTimeoutRef = useRef(null);

    // ACORDEÓN CONTINUO
    const [collapsedYears, setCollapsedYears] = useState({});
    const [collapsedMonths, setCollapsedMonths] = useState({});

    const openDateStr = liveBranch?.opening_date || liveBranch?.openingDate;

    const safeJsonParse = (str, fallback) => {
        try { return JSON.parse(str); } catch (e) { return fallback; }
    };

    // 1. COMBINAR CON EL EVENTO SINTÉTICO
    const syntheticHistory = useMemo(() => {
        let combined = Array.isArray(history) ? [...history] : [];
        if (openDateStr) {
            const safeDateStr = openDateStr.includes('T') ? openDateStr : `${openDateStr}T08:00:00`;
            if (!combined.some(item => item.action === 'APERTURA_OFICIAL' && item.isSynthetic)) {
                combined.push({
                    isSynthetic: true,
                    sortDate: new Date(safeDateStr),
                    action: 'APERTURA_OFICIAL',
                    name: 'Inauguración de la Sucursal',
                    actor_name: 'SISTEMA'
                });
            }
        }
        return combined.sort((a, b) => b.sortDate - a.sortDate);
    }, [history, openDateStr]);

    const getActionLabel = (item) => {
        if (item.isSynthetic) return item.action?.replace(/_/g, ' ');
        if (item.isDoc) return 'ARCHIVO HISTÓRICO';

        const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
        if (parsedDetails.dimension) return parsedDetails.dimension;

        if (item.action === 'PAGO_REGISTRADO') return 'PAGO REGISTRADO';
        if (item.action === 'EDITAR_SUCURSAL') return 'ACTUALIZACIÓN DE DATOS';
        return item.action?.replace(/_/g, ' ') || 'REGISTRO DE SISTEMA';
    };

    // 2. FILTRADO MULTIPLE
    const filteredHistory = useMemo(() => {
        let result = syntheticHistory;

        if (typeFilter !== 'ALL') {
            result = result.filter(item => {
                const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
                let itemDim = parsedDetails.dimension;

                if (!itemDim) {
                    if (item.isDoc) itemDim = 'LEGAL';
                    else if (item.action === 'PAGO_REGISTRADO') itemDim = 'FINANCE';
                    else if (item.action === 'EDITAR_SUCURSAL' || item.action === 'APERTURA_OFICIAL') itemDim = 'OPERATIVE';
                    else if (['PERSONAL_ASIGNADO', 'EDITAR_EMPLEADO', 'ELIMINAR_EMPLEADO', 'ACCION_RRHH'].includes(item.action)) itemDim = 'HR';
                    else itemDim = 'OTHER';
                }
                return itemDim === typeFilter;
            });
        }

        if (dateFilter.start || dateFilter.end) {
            result = result.filter(item => {
                const itemDate = item.sortDate;
                const start = dateFilter.start ? new Date(`${dateFilter.start}T00:00:00`) : new Date('2000-01-01');
                const end = dateFilter.end ? new Date(`${dateFilter.end}T23:59:59`) : new Date('2100-01-01');
                return itemDate >= start && itemDate <= end;
            });
        } else if (!showAllHistory && searchQuery.trim() === '') {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            result = result.filter(item => item.sortDate >= oneYearAgo);
        }

        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            result = result.filter(item => {
                const actionLabel = getActionLabel(item).toLowerCase();
                let itemName = (item.name || '').toLowerCase();
                const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
                if (parsedDetails.timeline_title) itemName = parsedDetails.timeline_title.toLowerCase();

                const actorName = (item.user_name || item.user_email || item.actor_name || 'Sistema').toLowerCase();
                return actionLabel.includes(query) || itemName.includes(query) || actorName.includes(query);
            });
        }
        return result;
    }, [syntheticHistory, typeFilter, dateFilter, searchQuery, showAllHistory]);

    // 3. AGRUPACIÓN
    const groupedHistory = useMemo(() => {
        const groups = {};
        filteredHistory.forEach(item => {
            const date = new Date(item.sortDate);
            const year = date.getFullYear().toString();
            const monthId = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const monthName = date.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase();

            if (!groups[year]) groups[year] = { months: {} };
            if (!groups[year].months[monthId]) groups[year].months[monthId] = { name: monthName, events: [] };

            groups[year].months[monthId].events.push(item);
        });

        return Object.keys(groups).sort((a, b) => b - a).map(year => {
            const sortedMonths = Object.keys(groups[year].months).sort((a, b) => b.localeCompare(a)).map(monthId => ({
                id: monthId,
                name: groups[year].months[monthId].name,
                events: groups[year].months[monthId].events
            }));
            return { year, months: sortedMonths };
        });
    }, [filteredHistory]);

    const toggleYear = (year) => setCollapsedYears(prev => ({ ...prev, [year]: !prev[year] }));
    const toggleMonth = (monthId) => setCollapsedMonths(prev => ({ ...prev, [monthId]: !prev[monthId] }));

    const isFilteringActive = dateFilter.start || dateFilter.end || searchQuery.trim() !== '' || typeFilter !== 'ALL';
    const printHistory = isFilteringActive ? filteredHistory : syntheticHistory;

    // INTERACCIONES
    const handleMouseEnter = () => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); setIsDownloadMenuOpen(true); };
    const handleMouseLeave = () => { hoverTimeoutRef.current = setTimeout(() => setIsDownloadMenuOpen(false), 300); };
    const handlePrintVisualReport = () => window.print();
    const handlePreviewDocument = (url, title) => { if (openModal) openModal('viewDocument', { url, title }); };

    const handleExportHistory = () => {
        if (printHistory.length === 0) return;
        const headers = ['Fecha', 'Hora', 'Acción', 'Descripción', 'Realizado por'];
        const rows = printHistory.map(item => {
            const dateObj = new Date(item.sortDate);
            const dStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tStr = (dateObj.getHours() === 0 && dateObj.getMinutes() === 0) ? 'N/A' : dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true });
            const action = getActionLabel(item);

            let desc = item.name || 'Registro del Sistema';
            const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});

            if (parsedDetails.timeline_title) desc = parsedDetails.timeline_title;
            else if (item.action === 'PAGO_REGISTRADO' && parsedDetails.servicio) desc = `Pago de ${parsedDetails.servicio} registrado ($${parsedDetails.monto})`;

            let actor = item.isSynthetic || item.isDoc ? 'Administrador' : (item.user_name || item.user_email || 'Sistema');
            return `"${dStr}","${tStr}","${action}","${desc.replace(/"/g, '""')}","${actor.replace(/"/g, '""')}"`;
        });
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Historial_${liveBranch?.name}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const renderPrintPortal = () => {
        return createPortal(
            <div id="print-report-container" className="hidden print:block w-full bg-white text-slate-900 font-sans p-6 md:p-10 max-w-[1200px] mx-auto">
                <div className="border-b-[3px] border-slate-900 pb-3 mb-4 flex justify-between items-end">
                    <div><h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none mb-1">Historial Operativo</h1><h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest leading-none">Sucursal: <span className="text-[#007AFF]">{liveBranch?.name || 'No especificada'}</span></h2></div>
                    <div className="text-right"><p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Fecha de Emisión</p><p className="text-xs font-black text-slate-900 leading-none">{new Date().toLocaleDateString('es-ES')}</p></div>
                </div>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b-2 border-slate-800 text-[9px] text-slate-600 uppercase tracking-widest">
                            <th className="py-2 px-2 w-[120px]">Fecha / Hora</th><th className="py-2 px-2 w-[140px]">Acción</th><th className="py-2 px-2">Descripción del Evento</th><th className="py-2 px-2 w-[200px]">Realizado Por / Doc</th>
                        </tr>
                    </thead>
                    <tbody className="text-[10px]">
                        {printHistory.map((item, idx) => {
                            const dateObj = new Date(item.sortDate);

                            let itemTitle = item.name || 'Registro del sistema';
                            const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
                            if (parsedDetails.timeline_title) itemTitle = parsedDetails.timeline_title;
                            else if (item.action === 'PAGO_REGISTRADO' && parsedDetails.servicio) itemTitle = `Pago ${parsedDetails.servicio} ($${parsedDetails.monto})`;

                            return (
                                <tr key={idx} className="border-b border-slate-200 break-inside-avoid">
                                    <td className="py-2.5 px-2 font-bold">{dateObj.toLocaleDateString('es-ES')}</td>
                                    <td className="py-2.5 px-2 text-[8px] uppercase tracking-widest">{getActionLabel(item)}</td>
                                    <td className="py-2.5 px-2 font-bold text-slate-800">{itemTitle}</td>
                                    <td className="py-2.5 px-2 font-bold text-slate-600">{item.isDoc ? 'DOCUMENTO' : (item.user_name || 'SISTEMA')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>,
            document.body
        );
    };

    let globalEventIndex = 0;

    return (
        <div className="space-y-6 relative h-full flex flex-col">
            <style>{`@media print { #root { display: none !important; } body { background: white !important; margin: 0; padding: 0; } #print-report-container { display: block !important; position: static !important; } @page { margin: 10mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`}</style>
            {renderPrintPortal()}

            {/* HEADER CONTROLS */}
            <div className="relative z-[100] flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6 pb-6 border-b border-white/60 no-print">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Historia de Sucursal</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Expediente Centralizado Interactivo</p>
                </div>

                <div className="flex items-center bg-white/40 backdrop-blur-[40px] border border-white/90 shadow-sm p-1.5 rounded-full w-full xl:w-max overflow-visible">
                    <div className="relative z-[9999]" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                        <button className="h-9 px-4 flex items-center gap-2 text-slate-500 hover:bg-white hover:text-[#007AFF] rounded-full transition-all font-black text-[10px] uppercase tracking-widest">
                            <Download size={14} strokeWidth={2.5} /> <span className="hidden sm:inline">Exportar</span>
                        </button>
                        <div className={`absolute top-[100%] left-0 pt-2 transition-all duration-300 ${isDownloadMenuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-2'}`}>
                            <div className="w-[190px] bg-white/90 backdrop-blur-xl border border-white/90 shadow-xl rounded-2xl p-1.5 flex flex-col gap-1">
                                <button onClick={() => { handlePrintVisualReport(); setIsDownloadMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[11px] font-bold text-slate-700 hover:bg-[#007AFF]/10 hover:text-[#007AFF] rounded-xl transition-colors"><Printer size={14} strokeWidth={2.5} /> PDF</button>
                                <button onClick={() => { handleExportHistory(); setIsDownloadMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[11px] font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-colors"><FileOutput size={14} strokeWidth={2.5} /> CSV</button>
                            </div>
                        </div>
                    </div>
                    <div className="w-px h-5 bg-slate-300/40 mx-1.5"></div>

                    <div className="flex items-center overflow-hidden transition-all duration-500 min-w-[320px]">
                        {!isSearchOpen ? (
                            <div className="flex items-center gap-2 w-full animate-in fade-in slide-in-from-left-4">
                                <Filter size={14} className="text-[#007AFF] ml-1.5 shrink-0" strokeWidth={2.5} />

                                <div className="relative flex items-center">
                                    <select
                                        value={typeFilter}
                                        onChange={(e) => setTypeFilter(e.target.value)}
                                        className="appearance-none bg-white/50 hover:bg-white border border-slate-200/60 rounded-full pl-3 pr-6 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600 outline-none cursor-pointer shadow-sm transition-all focus:border-[#007AFF]/50"
                                    >
                                        <option value="ALL">Todo</option>
                                        <option value="LEGAL">Legal</option>
                                        <option value="HR">Personal</option>
                                        <option value="OPERATIVE">Operativo</option>
                                        <option value="FINANCE">Finanzas</option>
                                    </select>
                                    <ChevronRight size={10} className="absolute right-2 text-slate-400 pointer-events-none rotate-90" strokeWidth={3} />
                                </div>

                                <div className="w-px h-4 bg-slate-300/50 mx-1"></div>

                                <div className="flex-1 w-[90px]"><LiquidDatePicker value={dateFilter.start} onChange={(v) => setDateFilter({ ...dateFilter, start: v })} placeholder="Desde" compact /></div>
                                <span className="text-slate-400 font-black">-</span>
                                <div className="flex-1 w-[90px]"><LiquidDatePicker value={dateFilter.end} onChange={(v) => setDateFilter({ ...dateFilter, end: v })} placeholder="Hasta" compact /></div>

                                {(dateFilter.start || dateFilter.end || typeFilter !== 'ALL') && (
                                    <button onClick={() => { setDateFilter({ start: '', end: '' }); setTypeFilter('ALL'); }} className="h-7 w-7 flex items-center justify-center bg-red-50 text-red-500 rounded-full ml-1 hover:bg-red-500 hover:text-white transition-colors">
                                        <X size={12} strokeWidth={3} />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center w-full bg-white rounded-full px-3 py-1.5 border border-slate-100 h-9">
                                <input type="text" autoFocus placeholder="Buscar en historial..." className="w-full bg-transparent border-none text-[11px] font-bold outline-none" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                                {searchQuery && <button onClick={() => setSearchQuery('')} className="h-6 w-6 flex items-center justify-center bg-slate-100 text-slate-400 rounded-full"><X size={12} strokeWidth={3} /></button>}
                            </div>
                        )}
                    </div>
                    <div className="w-px h-5 bg-slate-300/40 mx-1.5"></div>
                    <button onClick={() => { setIsSearchOpen(!isSearchOpen); if (isSearchOpen) setSearchQuery(''); }} className={`h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border ${isSearchOpen ? 'bg-red-50 text-red-500 border-red-200/50' : 'bg-white text-[#007AFF] border-white shadow-sm'}`}>
                        {isSearchOpen ? <><X size={14} strokeWidth={2.5} /> Cerrar</> : <><Search size={14} strokeWidth={2.5} /> Buscar</>}
                    </button>
                </div>
            </div>

            {/* ============================================================================ */}
            {/* 🚨 TIMELINE ACORDEÓN CONTINUO (PADDINGS ULTRA REDUCIDOS Y MATEMÁTICOS)       */}
            {/* ============================================================================ */}
            <div className="relative w-full max-w-5xl mx-auto py-2 z-0 no-print flex-1">

                {/* LÍNEA CENTRAL */}
                <div className="absolute left-[20px] md:left-1/2 top-0 bottom-0 w-[2px] bg-white/60 shadow-[0_0_10px_rgba(255,255,255,1)] md:-translate-x-1/2 rounded-full"></div>

                {isLoadingHistory ? (
                    <div className="text-center py-20 opacity-50 relative z-10"><Clock className="animate-spin text-[#007AFF] mx-auto mb-4" size={32} /> Cargando...</div>
                ) : filteredHistory.length === 0 ? (
                    <div className="text-center py-20 opacity-60 relative z-10"><FileText className="text-slate-300 mx-auto mb-4" size={48} /> Sin registros en esta sucursal</div>
                ) : (
                    <div className="relative z-10 w-full">
                        {groupedHistory.map((yearGroup) => {
                            const isYearCollapsed = collapsedYears[yearGroup.year] || false;
                            const isYearOpen = !isYearCollapsed;

                            return (
                                <div key={yearGroup.year} className="w-full mb-4">

                                    {/* PÍLDORA DE AÑO */}
                                    <div className="relative flex justify-center items-center w-full mb-4 group">
                                        <button
                                            onClick={() => toggleYear(yearGroup.year)}
                                            className={`relative z-20 flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-[13px] tracking-widest transition-all duration-300 hover:scale-105 active:scale-95 border backdrop-blur-xl ${isYearOpen
                                                    ? 'bg-[#007AFF]/10 text-[#007AFF] border-white shadow-[0_10px_30px_rgba(0,122,255,0.2)]'
                                                    : 'bg-white/50 text-slate-600 border-white/60 shadow-[0_4px_15px_rgba(0,0,0,0.04)] hover:bg-[#007AFF]/5 hover:text-[#007AFF] hover:border-white hover:shadow-[0_8px_25px_rgba(0,122,255,0.15)]'
                                                }`}                                        >
                                            <Calendar size={15} strokeWidth={2.5} /> AÑO {yearGroup.year}
                                            <ChevronRight size={16} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isYearOpen ? 'rotate-90 text-[#007AFF]' : 'text-slate-400'}`} />
                                        </button>
                                        <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-slate-200/80 -z-10 md:hidden"></div>
                                    </div>

                                    {/* 🚨 CONTENEDOR DEL AÑO (Matemática perfecta de CSS) */}
                                    <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isYearOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                        <div className={`overflow-hidden transition-all duration-500 ${isYearOpen ? 'px-2 -mx-2 pb-2 -mb-2' : 'px-0 mx-0 pb-0 mb-0'}`}>

                                            {yearGroup.months.map((monthGroup) => {
                                                const isMonthCollapsed = collapsedMonths[monthGroup.id] || false;
                                                const isMonthOpen = !isMonthCollapsed;

                                                return (
                                                    <div key={monthGroup.id} className="w-full mt-2 mb-2">

                                                        {/* PÍLDORA DE MES */}
                                                        <div className="relative flex justify-center items-center w-full mb-4 group">
                                                            <button
                                                                onClick={() => toggleMonth(monthGroup.id)}
                                                                className={`relative z-20 flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-[10px] tracking-widest transition-all duration-300 hover:scale-105 active:scale-95 border ${isMonthOpen ? 'bg-white text-[#007AFF] border-white shadow-[0_8px_20px_rgba(0,122,255,0.15)]' : 'bg-white/50 backdrop-blur-md text-slate-500 border-white/60 hover:text-slate-700 shadow-sm'}`}
                                                            >
                                                                {monthGroup.name}
                                                                <ChevronRight size={12} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isMonthOpen ? 'rotate-90 text-[#007AFF]' : 'text-slate-400'}`} />
                                                            </button>
                                                            <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-slate-200/80 -z-10 md:hidden"></div>
                                                        </div>

                                                        {/* 🚨 CONTENEDOR DEL MES (Matemática exacta para colapso a 0 sin cortar sombras) */}
                                                        <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isMonthOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                                            <div className={`overflow-hidden transition-all duration-500 ${isMonthOpen ? 'px-6 -mx-6 pb-8 -mb-8 pt-2 -mt-2' : 'px-0 mx-0 pb-0 mb-0 pt-0 mt-0'}`}>
                                                                <div className="space-y-4 py-1">
                                                                    {monthGroup.events.map((item) => {
                                                                        globalEventIndex++;
                                                                        const isLeftDesktop = globalEventIndex % 2 !== 0;

                                                                        const isDoc = item.isDoc;
                                                                        const isSynthetic = item.isSynthetic;
                                                                        const actionLabel = getActionLabel(item);
                                                                        const theme = getThemeForAction(item.action, isDoc, isSynthetic);

                                                                        const dateObj = new Date(item.sortDate);
                                                                        const dateStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }).toUpperCase();
                                                                        const timeStr = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true });

                                                                        let itemTitle = item.name || 'Configuración Modificada';
                                                                        let oldVal = null;
                                                                        let newVal = null;

                                                                        const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});

                                                                        if (parsedDetails.timeline_title) {
                                                                            itemTitle = parsedDetails.timeline_title;
                                                                            oldVal = parsedDetails.old_value;
                                                                            newVal = parsedDetails.new_value;
                                                                        } else if (item.action === 'PAGO_REGISTRADO' && parsedDetails.servicio) {
                                                                            itemTitle = `Pago de ${parsedDetails.servicio}`;
                                                                            newVal = `Monto: $${parsedDetails.monto}`;
                                                                        }

                                                                        let actorName = item.user_name || item.actor_name || 'SISTEMA';
                                                                        let actorPhotoUrl = null;
                                                                        const isSystemOrAdmin = actorName.toUpperCase() === 'SISTEMA' || actorName.toUpperCase() === 'ADMIN' || actorName.toUpperCase() === 'ADMINISTRADOR' || isSynthetic;

                                                                        if (isSystemOrAdmin) {
                                                                            actorName = 'SISTEMA';
                                                                            actorPhotoUrl = '/LogoFLS.svg';
                                                                        } else {
                                                                            const matchingEmp = employees.find(e =>
                                                                                (e.email && item.user_email && e.email === item.user_email) ||
                                                                                (e.name && item.user_name && e.name.toLowerCase() === item.user_name.toLowerCase()) ||
                                                                                (e.id && item.user_id && String(e.id) === String(item.user_id))
                                                                            );
                                                                            if (matchingEmp?.photo || matchingEmp?.photo_url) {
                                                                                actorPhotoUrl = matchingEmp.photo || matchingEmp.photo_url;
                                                                            }
                                                                        }

                                                                        return (
                                                                            <div key={item.id} className={`relative flex flex-col md:flex-row justify-between items-start md:items-center w-full group animate-in slide-in-from-bottom-4 fade-in duration-500 ${!isLeftDesktop ? 'md:flex-row-reverse' : ''}`}>

                                                                                {/* LADO A: FECHA */}
                                                                                <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 mb-3 md:mb-0 z-20 ${isLeftDesktop ? 'md:text-right md:pr-12' : 'md:text-left md:pl-12'}`}>
                                                                                    <div className="inline-flex items-center gap-2">
                                                                                        <span className="text-[14px] font-black text-slate-700 drop-shadow-sm">{dateStr}</span>
                                                                                        {timeStr !== '12:00 a. m.' && <span className="text-[10px] font-bold text-slate-500 bg-white/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]">{timeStr}</span>}
                                                                                    </div>
                                                                                </div>

                                                                                {/* CENTRO: PUNTO */}
                                                                                <div className="absolute left-[20px] md:left-1/2 top-1 md:top-auto w-10 h-10 flex items-center justify-center -translate-x-[20px] md:-translate-x-1/2 z-30 group-hover:scale-125 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
                                                                                    <div className={`absolute inset-0 rounded-full opacity-30 animate-pulse ${theme.dot}`}></div>
                                                                                    <div className={`w-4 h-4 rounded-full border-[3px] border-white shadow-sm relative ${theme.dot} ${theme.shadow}`}></div>
                                                                                </div>

                                                                                {/* LADO B: TARJETA LIQUID GLASS PREMIUM */}
                                                                                <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 z-20 ${isLeftDesktop ? 'md:pl-12' : 'md:pr-12'}`}>
                                                                                    <div className={`relative overflow-hidden bg-white/50 backdrop-blur-[50px] backdrop-saturate-[200%] border border-white/80 rounded-[1.5rem] p-5 transition-all duration-500 hover:bg-white hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,1)] shadow-[0_4px_20px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.7)] text-left`}>

                                                                                        <theme.icon className={`absolute -bottom-6 -right-6 w-36 h-36 opacity-[0.03] -rotate-12 ${theme.text} pointer-events-none transition-transform duration-700 group-hover:scale-125 group-hover:-rotate-6`} strokeWidth={1} />

                                                                                        <div className="relative z-10">
                                                                                            <div className="mb-3">
                                                                                                <span className={`px-2.5 py-1 rounded-[6px] text-[8px] font-black uppercase tracking-widest border shadow-[0_2px_10px_rgba(0,0,0,0.05)] ${theme.bg} ${theme.text} ${theme.border}`}>
                                                                                                    {actionLabel}
                                                                                                </span>
                                                                                            </div>

                                                                                            <h4 className="text-[14px] md:text-[15px] font-black text-slate-800 leading-tight mb-2">
                                                                                                {itemTitle}
                                                                                            </h4>

                                                                                            {(oldVal || newVal) && (
                                                                                                <div className="flex flex-col gap-1 mt-2">
                                                                                                    {oldVal && <span className="text-[10px] font-bold text-slate-400 line-through truncate">Antes: {oldVal}</span>}
                                                                                                    {newVal && <span className={`text-[10px] font-bold truncate ${item.severity === 'CRITICAL' ? 'text-red-500' : 'text-[#007AFF]'}`}>Nuevo: {newVal}</span>}
                                                                                                </div>
                                                                                            )}

                                                                                            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/80">
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <div className="w-6 h-6 rounded-full bg-slate-200/80 border border-white flex items-center justify-center text-slate-500 text-[10px] font-black shadow-inner uppercase overflow-hidden shrink-0">
                                                                                                        {actorPhotoUrl ? (
                                                                                                            <img
                                                                                                                src={actorPhotoUrl}
                                                                                                                alt={actorName}
                                                                                                                className={`w-full h-full ${isSystemOrAdmin ? 'object-contain p-0.5' : 'object-cover'}`}
                                                                                                            />
                                                                                                        ) : (
                                                                                                            actorName.charAt(0)
                                                                                                        )}
                                                                                                    </div>
                                                                                                    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest leading-none drop-shadow-sm truncate max-w-[120px] md:max-w-none">{actorName}</span>
                                                                                                </div>

                                                                                                {/* 🚨 BOTÓN "VER DOC" ESTILO LIQUID GLASS PERO SUTIL (GHOST) */}
                                                                                                {(isDoc && item.file_url) || parsedDetails.file_url ? (
                                                                                                    <button onClick={() => handlePreviewDocument(item.file_url || parsedDetails.file_url, itemTitle)} className="flex items-center justify-center gap-1.5 text-[#007AFF] bg-white/40 backdrop-blur-md border border-white/60 hover:bg-white hover:border-white px-3 py-1.5 rounded-full font-black text-[8px] uppercase tracking-widest transition-all active:scale-95 shadow-[0_2px_8px_rgba(0,122,255,0.05)] hover:shadow-[0_6px_15px_rgba(0,122,255,0.2)] hover:-translate-y-0.5 shrink-0">
                                                                                                        <Eye size={12} strokeWidth={2.5} /> Ver Doc
                                                                                                    </button>
                                                                                                ) : null}
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!showAllHistory && syntheticHistory.length > filteredHistory.length && !dateFilter.start && !dateFilter.end && searchQuery === '' && typeFilter === 'ALL' && (
                    <div className="pt-8 text-center animate-in fade-in duration-500 relative z-10">
                        <button onClick={() => setShowAllHistory(true)} className="px-6 h-10 bg-white/80 backdrop-blur-md border border-white hover:border-[#007AFF]/30 text-slate-600 font-black text-[10px] uppercase tracking-widest hover:text-[#007AFF] hover:shadow-[0_8px_20px_rgba(0,122,255,0.15)] hover:-translate-y-1 transition-all rounded-full active:scale-95 shadow-sm inline-flex items-center justify-center gap-2">
                            Cargar historial completo
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TabHistory;