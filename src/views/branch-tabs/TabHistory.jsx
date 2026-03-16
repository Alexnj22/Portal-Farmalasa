import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X, Search, Download, Clock, FileText, Users, Eye, FileOutput, Printer, CheckCircle2, AlertTriangle, Settings, Building2, Wallet, Calendar, ChevronRight, Sparkles, Activity, ArrowLeft } from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidSelect from '../../components/common/LiquidSelect';
import { useStaffStore as useStaff } from '../../store/staffStore';

// 🚨 IMPORTACIÓN ESTANDARIZADA
import { supabase } from '../../supabaseClient'; 

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

const TabHistory = ({ liveBranch, history: propHistory = [], isLoadingHistory, employees = [], openModal }) => {
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [showAllHistory, setShowAllHistory] = useState(false);
    
    // 🤖 ESTADOS PARA EL MODO INTELIGENCIA ARTIFICIAL GLOBAL
    const [aiMode, setAiMode] = useState(false);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [aiSummaryData, setAiSummaryData] = useState(null);

    const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
    const hoverTimeoutRef = useRef(null);

    const [collapsedYears, setCollapsedYears] = useState({});
    const [collapsedMonths, setCollapsedMonths] = useState({});

    const openDateStr = liveBranch?.opening_date || liveBranch?.openingDate;

    const safeJsonParse = (str, fallback) => {
        try { return JSON.parse(str); } catch (e) { return fallback; }
    };

    // COMBINAR CON EVENTO SINTÉTICO
    const syntheticHistory = useMemo(() => {
        let combined = Array.isArray(propHistory) ? [...propHistory] : [];
        if (openDateStr) {
            const safeDateStr = openDateStr.includes('T') ? openDateStr : `${openDateStr}T08:00:00`;
            if (!combined.some(item => item.action === 'APERTURA_OFICIAL' && item.isSynthetic)) {
                combined.push({
                    id: 'synthetic-opening',
                    isSynthetic: true,
                    sortDate: new Date(safeDateStr),
                    action: 'APERTURA_OFICIAL',
                    name: 'Inauguración de la Sucursal',
                    actor_name: 'SISTEMA'
                });
            }
        }
        return combined.sort((a, b) => b.sortDate - a.sortDate);
    }, [propHistory, openDateStr]);

    const getActionLabel = (item) => {
        if (item.isSynthetic) return item.action?.replace(/_/g, ' ');
        if (item.isDoc) return 'ARCHIVO HISTÓRICO';
        const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
        if (parsedDetails.dimension) return parsedDetails.dimension;
        if (item.action === 'PAGO_REGISTRADO') return 'PAGO REGISTRADO';
        if (item.action === 'EDITAR_SUCURSAL') return 'ACTUALIZACIÓN DE DATOS';
        return item.action?.replace(/_/g, ' ') || 'REGISTRO DE SISTEMA';
    };

    // FILTRADO MULTIPLE
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

    // AGRUPACIÓN PARA EL ACORDEÓN
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

    // ========================================================================
    // 🤖 FUNCIÓN MAESTRA: GENERAR RESUMEN GERENCIAL CON IA
    // ========================================================================
    const generateGlobalAiSummary = async () => {
        if (printHistory.length === 0) return;
        
        setAiMode(true);
        setIsGeneratingAi(true);
        
        try {
            const compressedHistory = printHistory.map(item => {
                const date = new Date(item.sortDate).toLocaleDateString('es-ES');
                const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
                return {
                    fecha: date,
                    accion: getActionLabel(item),
                    detalle: parsedDetails.timeline_title || item.name || 'Registro del sistema',
                    usuario: item.user_name || item.actor_name || 'Sistema'
                };
            }).slice(0, 150);

            const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-history', {
                body: { 
                    branchName: liveBranch?.name || 'la sucursal', 
                    historyData: JSON.stringify(compressedHistory) 
                } 
            });

            if (aiError) throw new Error(aiError.message);
            if (!aiResponse?.success) throw new Error("Fallo en la generación del resumen.");

            setAiSummaryData(aiResponse.aiSummary);

        } catch (error) {
            console.error("Error al generar resumen IA:", error);
            setAiSummaryData("Ocurrió un error al intentar analizar el historial. Por favor, revisa tu conexión o intenta de nuevo más tarde.");
        } finally {
            setIsGeneratingAi(false);
        }
    };

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

                {/* CONTENEDOR PRINCIPAL TIPO PÍLDORA */}
                <div
                    className={`flex items-center bg-white/40 backdrop-blur-[40px] backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-full xl:w-max overflow-visible`}
                >
                    {isSearchOpen ? (
                        <div className={`flex items-center w-full h-full px-4 md:px-5 gap-3 animate-in fade-in slide-in-from-right-4 duration-500`}>
                            <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                            <input autoFocus type="text" placeholder="Buscar en historial..." className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 min-w-[200px] xl:w-[600px] placeholder:text-slate-400 focus:ring-0" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                            {searchQuery && (<button onClick={() => setSearchQuery("")} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>)}
                            <button onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2">
                                <ChevronRight size={18} strokeWidth={2.5} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between w-full h-full pl-2 pr-2 md:pr-3 animate-in fade-in slide-in-from-left-4 duration-500">
                            <div className="flex items-center gap-1 md:gap-2 h-full py-0.5">
                                
                                {/* 🤖 BOTÓN MAESTRO DE IA ESTANDARIZADO (A LA IZQUIERDA) 🤖 */}
                                <button 
                                    onClick={aiMode ? () => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); } : generateGlobalAiSummary}
                                    disabled={printHistory.length === 0 && !aiMode}
                                    className={`relative group/ai-btn w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-all duration-500 border-0 shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] z-50 animate-in zoom-in-95 ${(printHistory.length === 0 && !aiMode) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:-translate-y-1 active:scale-95'}`}
                                    title={aiMode ? "Cerrar Resumen IA" : "Resumen Inteligente del Historial"}
                                >
                                    {aiMode ? (
                                        <div className="absolute inset-[1px] bg-indigo-50 backdrop-blur-sm rounded-full z-0 flex items-center justify-center border border-indigo-200">
                                            <X size={16} strokeWidth={3} className="text-indigo-400 group-hover/ai-btn:text-indigo-600 transition-colors" />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 rounded-full opacity-20 group-hover/ai-btn:opacity-100 transition-all duration-500 group-hover/ai-btn:animate-spin [animation-duration:3s]"></div>
                                            <div className="absolute inset-[1px] bg-white/90 backdrop-blur-sm rounded-full z-0 group-hover/ai-btn:bg-white/95 transition-colors duration-300"></div>
                                            <div className="absolute inset-0 border border-purple-200/50 rounded-full group-hover/ai-btn:border-purple-400 transition-colors z-10"></div>
                                            <Sparkles size={18} strokeWidth={2.5} className="text-purple-600 group-hover/ai-btn:animate-pulse z-20 relative" />
                                        </>
                                    )}
                                </button>

                                <div className="w-px h-5 bg-slate-300/40 mx-1 shrink-0"></div>

                                <div className="relative z-[9999]" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                                    <button className="h-9 px-3 flex items-center gap-2 text-slate-500 hover:bg-white hover:text-[#007AFF] rounded-full transition-all font-black text-[10px] uppercase tracking-widest shrink-0">
                                        <Download size={14} strokeWidth={2.5} /> <span className="hidden sm:inline">Exportar</span>
                                    </button>
                                    <div className={`absolute top-[100%] left-0 pt-2 transition-all duration-300 ${isDownloadMenuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-2'}`}>
                                        <div className="w-[160px] bg-white/90 backdrop-blur-xl border border-white/90 shadow-xl rounded-2xl p-1.5 flex flex-col gap-1">
                                            <button onClick={() => { handlePrintVisualReport(); setIsDownloadMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[10px] font-bold text-slate-700 hover:bg-[#007AFF]/10 hover:text-[#007AFF] rounded-xl transition-colors"><Printer size={14} strokeWidth={2.5} /> Reporte PDF</button>
                                            <button onClick={() => { handleExportHistory(); setIsDownloadMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[10px] font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-colors"><FileOutput size={14} strokeWidth={2.5} /> Datos CSV</button>
                                        </div>
                                    </div>
                                </div>

                                <div className="w-px h-5 bg-slate-300/40 mx-1 shrink-0"></div>

                                <Filter size={14} className="text-[#007AFF] ml-1 shrink-0 hidden sm:block" strokeWidth={2.5} />
                                <div className="w-[140px] sm:w-[160px] shrink-0">
                                    <div className="w-[140px] sm:w-[160px] shrink-0">
                                        <LiquidSelect value={typeFilter} onChange={(value) => setTypeFilter(value)} options={[{ value: 'ALL', label: 'Todo' }, { value: 'LEGAL', label: 'Legal' }, { value: 'HR', label: 'Personal' }, { value: 'OPERATIVE', label: 'Operativo' }, { value: 'FINANCE', label: 'Finanzas' }]} clearable={false} />
                                    </div>
                                </div>

                                <div className="w-px h-5 bg-slate-300/40 mx-1 shrink-0"></div>

                                <div className="flex-1 w-[90px] shrink-0"><LiquidDatePicker value={dateFilter.start} onChange={(v) => setDateFilter({ ...dateFilter, start: v })} placeholder="Desde" compact /></div>
                                <span className="text-slate-400 font-black shrink-0">-</span>
                                <div className="flex-1 w-[90px] shrink-0"><LiquidDatePicker value={dateFilter.end} onChange={(v) => setDateFilter({ ...dateFilter, end: v })} placeholder="Hasta" compact /></div>

                                {(dateFilter.start || dateFilter.end || typeFilter !== 'ALL') && (
                                    <button onClick={() => { setDateFilter({ start: '', end: '' }); setTypeFilter('ALL'); }} className="h-8 w-8 flex items-center justify-center bg-red-50 text-red-500 rounded-full ml-1 hover:bg-red-500 hover:text-white transition-colors shrink-0 shadow-sm">
                                        <X size={12} strokeWidth={3} />
                                    </button>
                                )}
                            </div>

                            <div className={`flex items-center transition-all duration-500 ease-in-out origin-right max-w-[100px] opacity-100 scale-100 ml-2 pl-3 md:pl-4 border-l border-slate-300/30 shrink-0`}>
                                <button onClick={() => setIsSearchOpen(true)} className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu">
                                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ============================================================================ */}
            {/* 🎭 CONTENEDOR DE TRANSICIÓN FLUIDA ENTRE MODO NORMAL Y MODO IA               */}
            {/* ============================================================================ */}
            <div className="relative w-full max-w-5xl mx-auto py-2 flex-1">
                
                {/* 🤖 VISTA DE INTELIGENCIA ARTIFICIAL (DIAGNÓSTICO) */}
                <div className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${aiMode ? 'opacity-100 translate-y-0 relative z-20' : 'opacity-0 translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-10'}`}>
                    <div className="bg-white/80 backdrop-blur-3xl border border-indigo-100/50 rounded-[2.5rem] p-8 md:p-12 shadow-[0_20px_60px_rgba(0,0,0,0.05),inset_0_2px_20px_rgba(255,255,255,0.8)] relative overflow-hidden">
                        
                        {/* 🔮 Esferas de Energía Animatedas de Fondo */}
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                            <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-indigo-500/20 blur-[80px] rounded-full animate-pulse [animation-duration:4s]"></div>
                            <div className="absolute top-[50%] -right-[10%] w-[70%] h-[70%] bg-purple-500/20 blur-[80px] rounded-full animate-pulse [animation-duration:5s] delay-300"></div>
                            <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] bg-cyan-400/20 blur-[80px] rounded-full animate-pulse [animation-duration:6s] delay-700"></div>
                        </div>

                        <div className="relative z-10 flex flex-col items-center justify-center text-center">
                            
                            <div className="relative w-16 h-16 flex items-center justify-center mb-6">
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:4s] blur-[5px] opacity-70"></div>
                                <div className="relative w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-inner border border-white/30">
                                    <Sparkles size={30} className="text-white" strokeWidth={2} />
                                </div>
                            </div>
                            
                            <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight mb-2">Diagnóstico Operativo Inteligente</h2>
                            <p className="text-sm font-bold text-indigo-400/80 uppercase tracking-widest mb-10">Análisis basado en {printHistory.length} registros del historial</p>

                            {isGeneratingAi ? (
                                /* SKELETON DE CARGA NEURONAL */
                                <div className="w-full max-w-3xl text-left bg-white/40 backdrop-blur-md border border-white/50 rounded-3xl p-6 md:p-8 shadow-sm animate-pulse relative z-10">
                                    <div className="flex flex-col items-center justify-center mb-8">
                                        <div className="relative w-12 h-12 flex items-center justify-center mb-3">
                                            <div className="absolute inset-0 border-2 border-indigo-200/50 rounded-full animate-ping [animation-duration:2s]"></div>
                                            <div className="absolute inset-1 border-t-2 border-b-2 border-purple-500 rounded-full animate-spin [animation-duration:1.5s]"></div>
                                            <div className="absolute inset-3 border-l-2 border-r-2 border-cyan-400 rounded-full animate-spin [animation-duration:2.5s] direction-reverse"></div>
                                        </div>
                                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">Sintetizando Historial...</p>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="h-3 bg-indigo-200/50 rounded-full w-3/4 mb-2"></div>
                                        <div className="h-3 bg-indigo-200/50 rounded-full w-full mb-2"></div>
                                        <div className="h-3 bg-indigo-200/50 rounded-full w-5/6 mb-6"></div>
                                        <div className="h-3 bg-purple-200/50 rounded-full w-full mb-2"></div>
                                        <div className="h-3 bg-purple-200/50 rounded-full w-4/5 mb-2"></div>
                                        <div className="h-3 bg-purple-200/50 rounded-full w-2/3"></div>
                                    </div>
                                </div>
                            ) : (
                                /* RESULTADO DE LA IA */
                                <div className="w-full max-w-3xl text-left bg-white/60 backdrop-blur-md border border-white/60 rounded-3xl p-6 md:p-8 shadow-sm relative z-10 animate-in slide-in-from-bottom-4 duration-500">
                                    {aiSummaryData?.split('\n').map((paragraph, index) => (
                                        <div key={index} className="relative mb-6 last:mb-0 group/p">
                                            <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-300"></div>
                                            <p className="text-[13px] md:text-[15px] font-medium text-slate-700 leading-relaxed text-justify pl-5">
                                                {paragraph.split('**').map((text, i) => (
                                                    i % 2 === 1 ? <strong key={i} className="font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent drop-shadow-sm">{text}</strong> : text
                                                ))}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button 
                                onClick={() => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 300); }}
                                className="mt-10 flex items-center gap-2 px-6 py-3 rounded-full bg-white/80 text-indigo-500 font-black text-[11px] uppercase tracking-widest border border-indigo-100 hover:bg-white hover:text-indigo-700 hover:shadow-[0_8px_20px_rgba(168,85,247,0.15)] transition-all active:scale-95 z-10 relative"
                            >
                                <ArrowLeft size={16} strokeWidth={2.5} /> Regresar a línea de tiempo
                            </button>
                        </div>
                    </div>
                </div>

                {/* 🏢 VISTA NORMAL DE LÍNEA DE TIEMPO (HISTORIAL) */}
                <div className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${!aiMode ? 'opacity-100 translate-y-0 relative z-20' : 'opacity-0 -translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-10'}`}>
                    
                    {/* Línea Central Estética */}
                    <div className="absolute left-[20px] md:left-1/2 top-0 bottom-0 w-[2px] bg-white/60 shadow-[0_0_10px_rgba(255,255,255,1)] md:-translate-x-1/2 rounded-full"></div>

                    {isLoadingHistory ? (
                        /* SKELETON DE LÍNEA DE TIEMPO */
                        <div className="w-full space-y-12 relative z-10 pt-10">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className={`flex flex-col md:flex-row items-center w-full opacity-50 animate-pulse ${i % 2 === 0 ? 'md:flex-row-reverse' : ''}`}>
                                    <div className={`hidden md:block w-[45%] ${i % 2 === 0 ? 'text-left pl-12' : 'text-right pr-12'}`}>
                                        <div className={`h-4 bg-slate-300/60 rounded w-24 ${i % 2 === 0 ? 'mr-auto' : 'ml-auto'}`}></div>
                                    </div>
                                    <div className="absolute left-[20px] md:left-1/2 w-8 h-8 rounded-full bg-slate-200/80 border-4 border-white -translate-x-[20px] md:-translate-x-1/2 z-30"></div>
                                    <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 ${i % 2 === 0 ? 'md:pr-12' : 'md:pl-12'}`}>
                                        <div className="h-32 bg-white/40 border border-white/50 rounded-[1.5rem] p-5 w-full">
                                            <div className="h-3 bg-slate-300/50 rounded w-1/3 mb-4"></div>
                                            <div className="h-5 bg-slate-300/60 rounded w-3/4 mb-3"></div>
                                            <div className="h-3 bg-slate-300/50 rounded w-1/2 mt-5"></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="text-center py-20 opacity-60 relative z-10"><FileText className="text-slate-300 mx-auto mb-4" size={48} /> Sin registros en esta sucursal</div>
                    ) : (
                        <div className="relative z-10 w-full pt-2">
                            {groupedHistory.map((yearGroup) => {
                                const isYearCollapsed = collapsedYears[yearGroup.year] || false;
                                const isYearOpen = !isYearCollapsed;

                                return (
                                    <div key={yearGroup.year} className="w-full mb-4">

                                        <div className="relative flex justify-center items-center w-full mb-4 group">
                                            <button onClick={() => toggleYear(yearGroup.year)} className={`relative z-20 flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-[13px] tracking-widest transition-all duration-300 hover:scale-105 active:scale-95 border backdrop-blur-xl ${isYearOpen ? 'bg-[#007AFF]/10 text-[#007AFF] border-white shadow-[0_10px_30px_rgba(0,122,255,0.2)]' : 'bg-white/50 text-slate-600 border-white/60 shadow-[0_4px_15px_rgba(0,0,0,0.04)] hover:bg-[#007AFF]/5 hover:text-[#007AFF] hover:border-white hover:shadow-[0_8px_25px_rgba(0,122,255,0.15)]'}`}>
                                                <Calendar size={15} strokeWidth={2.5} /> AÑO {yearGroup.year}
                                                <ChevronRight size={16} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isYearOpen ? 'rotate-90 text-[#007AFF]' : 'text-slate-400'}`} />
                                            </button>
                                            <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-slate-200/80 -z-10 md:hidden"></div>
                                        </div>

                                        <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isYearOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                            <div className={`overflow-hidden transition-all duration-500 ${isYearOpen ? 'px-2 -mx-2 pb-2 -mb-2' : 'px-0 mx-0 pb-0 mb-0'}`}>

                                                {yearGroup.months.map((monthGroup) => {
                                                    const isMonthCollapsed = collapsedMonths[monthGroup.id] || false;
                                                    const isMonthOpen = !isMonthCollapsed;

                                                    return (
                                                        <div key={monthGroup.id} className="w-full mt-2 mb-2">

                                                            <div className="relative flex justify-center items-center w-full mb-4 group">
                                                                <button onClick={() => toggleMonth(monthGroup.id)} className={`relative z-20 flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-[10px] tracking-widest transition-all duration-300 hover:scale-105 active:scale-95 border ${isMonthOpen ? 'bg-white text-[#007AFF] border-white shadow-[0_8px_20px_rgba(0,122,255,0.15)]' : 'bg-white/50 backdrop-blur-md text-slate-500 border-white/60 hover:text-slate-700 shadow-sm'}`}>
                                                                    {monthGroup.name}
                                                                    <ChevronRight size={12} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isMonthOpen ? 'rotate-90 text-[#007AFF]' : 'text-slate-400'}`} />
                                                                </button>
                                                                <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-slate-200/80 -z-10 md:hidden"></div>
                                                            </div>

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

                                                                                    <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 mb-3 md:mb-0 z-20 ${isLeftDesktop ? 'md:text-right md:pr-12' : 'md:text-left md:pl-12'}`}>
                                                                                        <div className="inline-flex items-center gap-2">
                                                                                            <span className="text-[14px] font-black text-slate-700 drop-shadow-sm">{dateStr}</span>
                                                                                            {timeStr !== '12:00 a. m.' && <span className="text-[10px] font-bold text-slate-500 bg-white/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]">{timeStr}</span>}
                                                                                        </div>
                                                                                    </div>

                                                                                    <div className="absolute left-[20px] md:left-1/2 top-1 md:top-auto w-10 h-10 flex items-center justify-center -translate-x-[20px] md:-translate-x-1/2 z-30 group-hover:scale-125 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
                                                                                        <div className={`absolute inset-0 rounded-full opacity-30 animate-pulse ${theme.dot}`}></div>
                                                                                        <div className={`w-4 h-4 rounded-full border-[3px] border-white shadow-sm relative ${theme.dot} ${theme.shadow}`}></div>
                                                                                    </div>

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
        </div>
    );
};

export default TabHistory;