import React, { useState, useMemo, useRef, useCallback } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import ViewTabBar from '../../components/common/ViewTabBar';
import { AiThinkingState } from '../../components/common/StateViews';
import { createPortal } from 'react-dom';
import { Filter, X, Search, Download, Clock, FileText, Users, Eye, FileOutput, Printer, CheckCircle2, AlertTriangle, Settings, Building2, Wallet, Calendar, ChevronRight, Sparkles, Activity, ArrowLeft } from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidSelect from '../../components/common/LiquidSelect';
import { smartFilter } from '../../utils/searchUtils';
// 🚨 IMPORTACIÓN ESTANDARIZADA
import { supabase } from '../../supabaseClient'; 

// ============================================================================
// 🎨 MOTOR DE TEMAS (Colores e Iconos dinámicos)
// ============================================================================
const getThemeForAction = (action, isDoc, isSynthetic) => {
    if (isSynthetic) return { icon: Building2, bg: 'bg-chart-4/10', text: 'text-chart-4-text', border: 'border-chart-4/30', dot: 'bg-chart-4', shadow: 'shadow-[var(--shadow-glow-chart-4)]' , variante: 'chart-4' };
    if (isDoc) return { icon: FileText, bg: 'bg-chart-1/10', text: 'text-brand-text', border: 'border-brand/20', dot: 'bg-brand', shadow: 'shadow-[var(--shadow-glow-brand)]' , variante: 'chart-1' };

    switch (action) {
        case 'PAGO_REGISTRADO':
            return { icon: Wallet, bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', dot: 'bg-success', shadow: 'shadow-[var(--shadow-glow-success)]' , variante: 'success' };
        case 'ALERTA_SISTEMA':
        case 'INSPECTION_RECORDED':
            return { icon: AlertTriangle, bg: 'bg-danger/10', text: 'text-danger-text', border: 'border-danger/30', dot: 'bg-danger', shadow: 'shadow-[var(--shadow-glow-danger)]' , variante: 'danger' };
        case 'EDITAR_SUCURSAL':
        case 'APERTURA_OFICIAL':
        case 'VINCULAR_KIOSCO':
        case 'REVOCAR_KIOSCO':
        case 'CREAR_TURNO_CATALOGO':
        case 'ELIMINAR_TURNO':
            return { icon: Settings, bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30', dot: 'bg-chart-3', shadow: 'shadow-[var(--shadow-glow-chart-3-lg)]' , variante: 'chart-3' };
        case 'PERSONAL_ASIGNADO':
        case 'EDITAR_EMPLEADO':
        case 'ELIMINAR_EMPLEADO':
        case 'ACCION_RRHH':
        case 'ASIGNAR_TURNO_SEMANAL':
        case 'REGISTRO_ASISTENCIA':
            return { icon: Users, bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30', dot: 'bg-chart-3', shadow: 'shadow-[var(--shadow-glow-chart-3)]' , variante: 'chart-3' };
        default:
            return { icon: CheckCircle2, bg: 'bg-surface-card-hover', text: 'text-content-3', border: 'border-divider', dot: 'bg-content-3', shadow: 'shadow-sm' , variante: 'neutral' };
    }
};

const TabHistory = ({ liveBranch, history: propHistory = [], isLoadingHistory, employees = [], openModal }) => {
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [showAllHistory, setShowAllHistory] = useState(false);
    
    // 🤖 ESTADOS PARA EL MODO INTELIGENCIA ARTIFICIAL GLOBAL
    const [aiMode, setAiMode] = useState(false);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [aiSummaryData, setAiSummaryData] = useState(null);

    const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
    const hoverTimeoutRef = useRef(null);

    const [collapsedYears, setCollapsedYears] = useState({});
    const [collapsedMonths, setCollapsedMonths] = useState({});

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    const openDateStr = liveBranch?.opening_date || liveBranch?.openingDate;

    const safeJsonParse = (str, fallback) => {
        try { return JSON.parse(str); } catch { return fallback; }
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

    const getActionLabel = useCallback((item) => {
        if (item.isSynthetic) return item.action?.replace(/_/g, ' ');
        if (item.isDoc) return 'ARCHIVO HISTÓRICO';
        const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
        if (parsedDetails.dimension) return parsedDetails.dimension;
        if (item.action === 'PAGO_REGISTRADO') return 'PAGO REGISTRADO';
        if (item.action === 'EDITAR_SUCURSAL') return 'ACTUALIZACIÓN DE DATOS';
        return item.action?.replace(/_/g, ' ') || 'REGISTRO DE SISTEMA';
    }, []);

    // FILTRADO MULTIPLE
    const filteredHistoryRaw = useMemo(() => {
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

        if (!searchQuery.trim()) return { results: result, isFuzzy: false };
        return smartFilter(searchQuery, result, item => {
            const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
            const itemName = parsedDetails.timeline_title || item.name || '';
            const actorName = item.user_name || item.user_email || item.actor_name || 'Sistema';
            return [getActionLabel(item), itemName, actorName];
        });
    }, [syntheticHistory, typeFilter, dateFilter, searchQuery, showAllHistory, getActionLabel]);
    const { results: filteredHistory, isFuzzy: isHistorySearchFuzzy } = filteredHistoryRaw;

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
            <div id="print-report-container" className="hidden print:block w-full bg-surface-card text-content font-sans p-6 md:p-10 max-w-[1200px] mx-auto">
                <div className="border-b-[3px] border-slate-900 pb-3 mb-4 flex justify-between items-end">
                    <div><h1 className="text-2xl font-black uppercase tracking-tighter text-content leading-none mb-1">Historial Operativo</h1><h2 className="text-sm font-bold text-content-2 uppercase tracking-widest leading-none">Sucursal: <span className="text-brand-text">{liveBranch?.name || 'No especificada'}</span></h2></div>
                    <div className="text-right"><p className="text-micro font-bold text-content-3 uppercase tracking-widest mb-0.5">Fecha de Emisión</p><p className="text-xs font-black text-content leading-none">{new Date().toLocaleDateString('es-ES')}</p></div>
                </div>
                <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-brand/5">
                        <tr className="border-b border-brand/10 text-caption text-content-3 font-black uppercase tracking-[0.15em]">
                            <th className="py-2 px-2 w-[120px]">Fecha / Hora</th><th className="py-2 px-2 w-[140px]">Acción</th><th className="py-2 px-2">Descripción del Evento</th><th className="py-2 px-2 w-[200px]">Realizado Por / Doc</th>
                        </tr>
                    </thead>
                    <tbody className="text-caption">
                        {printHistory.map((item, idx) => {
                            const dateObj = new Date(item.sortDate);
                            let itemTitle = item.name || 'Registro del sistema';
                            const parsedDetails = typeof item.details === 'string' ? safeJsonParse(item.details, {}) : (item.details || {});
                            if (parsedDetails.timeline_title) itemTitle = parsedDetails.timeline_title;
                            else if (item.action === 'PAGO_REGISTRADO' && parsedDetails.servicio) itemTitle = `Pago ${parsedDetails.servicio} ($${parsedDetails.monto})`;
                            return (
                                <tr key={idx} className="border-b border-divider break-inside-avoid">
                                    <td className="py-2.5 px-2 font-bold">{dateObj.toLocaleDateString('es-ES')}</td>
                                    <td className="py-2.5 px-2 text-micro uppercase tracking-widest">{getActionLabel(item)}</td>
                                    <td className="py-2.5 px-2 font-bold text-content">{itemTitle}</td>
                                    <td className="py-2.5 px-2 font-bold text-content-2">{item.isDoc ? 'DOCUMENTO' : (item.user_name || 'SISTEMA')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                </div>
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
            <div className="relative z-modal flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6 pb-6 border-b border-border-card no-print">
                <div>
                    <h3 className="font-black text-content uppercase tracking-tight text-lg">Historia de Sucursal</h3>
                    <p className="text-label font-bold text-content-3 uppercase tracking-widest">Expediente Centralizado Interactivo</p>
                </div>

                {/* D3.9 (2026-07-27): esta barra estaba reescrita a mano y con
                    renderizado condicional (isSearchOpen ? A : B) en vez de las dos
                    mitades colapsables — por eso su forma no calzaba con las otras
                    doce. Ahora sale del canónico; todos los controles (IA, exportar,
                    filtro de tipo, rango de fechas y reset) van en `trailingActions`. */}
                <ViewTabBar
                    searchValue={searchQuery}
                    onSearchChange={setSearchQuery}
                    placeholder="Buscar en historial..."
                    trailingActions={
                        <>
                            {/* 🤖 BOTÓN MAESTRO DE IA ESTANDARIZADO (A LA IZQUIERDA) 🤖 */}
                            <button 
                                onClick={aiMode ? () => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); } : generateGlobalAiSummary}
                                disabled={printHistory.length === 0 && !aiMode}
                                className={`relative group/ai-btn w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-all duration-500 border-0 shadow-[var(--shadow-glow-chart-3-md)] hover:shadow-[var(--shadow-glow-chart-3-lg)] z-sidebar animate-in zoom-in-95 ${(printHistory.length === 0 && !aiMode) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:-translate-y-1 active:scale-[0.97]'}`}
                                title={aiMode ? "Cerrar Resumen IA" : "Resumen Inteligente del Historial"}
                            >
                                {aiMode ? (
                                    <div className="absolute inset-[1px] bg-chart-3/10 backdrop-blur-sm rounded-full z-0 flex items-center justify-center border border-chart-3/30">
                                        <X size={16} strokeWidth={3} className="text-chart-3-text group-hover/ai-btn:text-chart-3-text transition-colors" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 rounded-full opacity-20 group-hover/ai-btn:opacity-100 transition-all duration-500 group-hover/ai-btn:animate-spin [animation-duration:3s]"></div>
                                        <div className="absolute inset-[1px] bg-surface-card backdrop-blur-sm rounded-full z-0 group-hover/ai-btn:bg-surface-card transition-colors duration-300"></div>
                                        <div className="absolute inset-0 border border-chart-3/30 rounded-full group-hover/ai-btn:border-purple-400 transition-colors z-base"></div>
                                        <Sparkles size={18} strokeWidth={2.5} className="text-chart-3-text group-hover/ai-btn:animate-pulse z-content relative" />
                                    </>
                                )}
                            </button>
                            <div className="relative z-toast" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                                <Button variant="ghost" size="sm" icon={Download}>
                                    <span className="hidden sm:inline">Exportar</span>
                                </Button>
                                <div className={`absolute top-[100%] left-0 pt-2 transition-all duration-300 ${isDownloadMenuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-2'}`}>
                                    <div className="w-[160px] bg-surface-card backdrop-blur-xl border border-border-card shadow-xl rounded-2xl p-1.5 flex flex-col gap-1">
                                        <Button icon={Printer} onClick={() => { handlePrintVisualReport(); setIsDownloadMenuOpen(false); }}>Reporte PDF</Button>
                                        <Button tone="success" icon={FileOutput} onClick={() => { handleExportHistory(); setIsDownloadMenuOpen(false); }}>Datos CSV</Button>
                                    </div>
                                </div>
                            </div>
                            <Filter size={14} className="text-brand-text ml-1 shrink-0 hidden sm:block" strokeWidth={2.5} />
                            <div className="w-[140px] sm:w-[160px] shrink-0">
                                <div className="w-[140px] sm:w-[160px] shrink-0">
                                    <LiquidSelect value={typeFilter} onChange={(value) => setTypeFilter(value)} options={[{ value: 'ALL', label: 'Todo' }, { value: 'LEGAL', label: 'Legal' }, { value: 'HR', label: 'Personal' }, { value: 'OPERATIVE', label: 'Operativo' }, { value: 'FINANCE', label: 'Finanzas' }]} clearable={false} />
                                </div>
                            </div>

                            <div className="w-px h-5 bg-content-3/40 mx-1 shrink-0"></div>

                            {/* D3.11 (2026-07-27): esto eran DOS LiquidDatePicker
                                coordinados a mano —"Desde" y "Hasta"— que es
                                exactamente el trabajo de RangeDatePicker. Uno de los
                                10 rangos escritos así en el proyecto. Un control en
                                vez de dos: se arrastra en vez de abrir dos
                                calendarios y acordarse del primero, y libera ~140px
                                de barra. `months={1}` porque el panel de dos meses
                                (596px) es de pedir vacaciones, no de filtrar. */}
                            <div className="w-[200px] shrink-0">
                                <RangeDatePicker
                                    startDate={dateFilter.start}
                                    endDate={dateFilter.end}
                                    onRangeChange={(start, end) => setDateFilter({ start, end })}
                                    months={1}
                                    compact
                                    shortcuts
                                    placeholder="Cualquier fecha"
                                    label="historial"
                                />
                            </div>

                            {(dateFilter.start || dateFilter.end || typeFilter !== 'ALL') && (
                                <Button variant="destructive" size="sm" icon={X} iconOnly onClick={() => { setDateFilter({ start: '', end: '' }); setTypeFilter('ALL'); }} />
                            )}
                        </>
                    }
                />
            </div>

            {/* ============================================================================ */}
            {/* 🎭 CONTENEDOR DE TRANSICIÓN FLUIDA ENTRE MODO NORMAL Y MODO IA               */}
            {/* ============================================================================ */}
            <div className="relative w-full max-w-5xl mx-auto py-2 flex-1">
                
                {/* 🤖 VISTA DE INTELIGENCIA ARTIFICIAL (DIAGNÓSTICO) */}
                <div inert={!(aiMode) ? true : undefined} className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>
                    <div data-surface="card" className="border-chart-3/30 p-8 md:p-12 relative overflow-hidden">
                        
                        {/* 🔮 Esferas de Energía Animatedas de Fondo */}
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                            <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-chart-3/20 blur-[80px] rounded-full animate-pulse [animation-duration:4s]"></div>
                            <div className="absolute top-[50%] -right-[10%] w-[70%] h-[70%] bg-chart-3/20 blur-[80px] rounded-full animate-pulse [animation-duration:5s] delay-300"></div>
                            <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] bg-chart-9/20 blur-[80px] rounded-full animate-pulse [animation-duration:6s] delay-700"></div>
                        </div>

                        <div className="relative z-base flex flex-col items-center justify-center text-center">
                            
                            <div className="relative w-16 h-16 flex items-center justify-center mb-6">
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:4s] blur-[5px] opacity-70"></div>
                                <div className="relative w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-inner border border-border-card">
                                    <Sparkles size={28} className="text-white" strokeWidth={2} />
                                </div>
                            </div>
                            
                            <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight mb-2">Diagnóstico Operativo Inteligente</h2>
                            <p className="text-sm font-bold text-chart-3-text/80 uppercase tracking-widest mb-10">Análisis basado en {printHistory.length} registros del historial</p>

                            {isGeneratingAi ? (
                                /* SKELETON DE CARGA NEURONAL */
                                <div data-surface="card" className="w-full max-w-3xl text-left p-6 md:p-8 animate-pulse relative z-base">
                                    <AiThinkingState size="sm" title="Sintetizando Historial" className="mb-2" />
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
                                <div data-surface="card" className="w-full max-w-3xl text-left p-6 md:p-8 relative z-base animate-in slide-in-from-bottom-4 duration-500">
                                    {aiSummaryData?.split('\n').map((paragraph, index) => (
                                        <div key={index} className="relative mb-6 last:mb-0 group/p">
                                            <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[var(--shadow-glow-chart-3-md)] transition-all duration-300"></div>
                                            <p className="text-body md:text-subtitle font-medium text-content-2 leading-relaxed text-justify pl-5">
                                                {paragraph.split('**').map((text, i) => (
                                                    i % 2 === 1 ? <strong key={i} className="font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent drop-shadow-sm">{text}</strong> : text
                                                ))}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <Button variant="secondary" icon={ArrowLeft} onClick={() => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 300); }}>Regresar a línea de tiempo</Button>
                        </div>
                    </div>
                </div>

                {/* 🏢 VISTA NORMAL DE LÍNEA DE TIEMPO (HISTORIAL) */}
                <div inert={aiMode ? true : undefined} className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${!aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 -translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>
                    
                    {/* Línea Central Estética */}
                    <div className="absolute left-[20px] md:left-1/2 top-0 bottom-0 w-[2px] bg-divider md:-translate-x-1/2 rounded-full"></div>

                    {isLoadingHistory ? (
                        /* SKELETON DE LÍNEA DE TIEMPO */
                        <div className="w-full space-y-12 relative z-base pt-10">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className={`flex flex-col md:flex-row items-center w-full ${i % 2 === 0 ? 'md:flex-row-reverse' : ''}`}>
                                    <div className={`hidden md:block w-[45%] ${i % 2 === 0 ? 'text-left pl-12' : 'text-right pr-12'}`}>
                                        <div className={`h-4 skeleton rounded-full w-24 ${i % 2 === 0 ? 'mr-auto' : 'ml-auto'}`} />
                                    </div>
                                    <div className="absolute left-[20px] md:left-1/2 w-8 h-8 skeleton rounded-full border-4 border-white -translate-x-[20px] md:-translate-x-1/2 z-tabs" />
                                    <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 ${i % 2 === 0 ? 'md:pr-12' : 'md:pl-12'}`}>
                                        <div className="h-32 bg-surface-card border border-border-card rounded-3xl p-5 w-full space-y-3">
                                            <div className="h-3 skeleton rounded-full w-1/3" />
                                            <div className="h-5 skeleton rounded-full w-3/4" />
                                            <div className="h-3 skeleton rounded-full w-1/2 mt-2" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="text-center py-20 opacity-60 relative z-base"><FileText className="text-content-3 mx-auto mb-4" size={48} /> Sin registros en esta sucursal</div>
                    ) : (
                        <div className="relative z-base w-full pt-2">
                            {isHistorySearchFuzzy && searchQuery && (
                                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                                    <Search size={12} strokeWidth={2.5} className="shrink-0" />
                                    Resultados similares para &ldquo;{searchQuery}&rdquo; — no se encontraron coincidencias exactas
                                </div>
                            )}
                            {groupedHistory.map((yearGroup) => {
                                const isYearCollapsed = collapsedYears[yearGroup.year] || false;
                                const isYearOpen = !isYearCollapsed;

                                return (
                                    <div key={yearGroup.year} className="w-full mb-4">

                                        <div className="relative flex justify-center items-center w-full mb-4 group">
                                            <Button
                                                variant="primary"
                                                icon={Calendar}
                                                onClick={() => toggleYear(yearGroup.year)}
                                            >AÑO {yearGroup.year}</Button>
                                            <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-surface-card-hover/80 -z-base md:hidden"></div>
                                        </div>

                                        <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isYearOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                            <div className={`overflow-hidden transition-all duration-500 ${isYearOpen ? 'px-2 -mx-2 pb-2 -mb-2' : 'px-0 mx-0 pb-0 mb-0'}`}>

                                                {yearGroup.months.map((monthGroup) => {
                                                    const isMonthCollapsed = collapsedMonths[monthGroup.id] || false;
                                                    const isMonthOpen = !isMonthCollapsed;

                                                    return (
                                                        <div key={monthGroup.id} className="w-full mt-2 mb-2">

                                                            <div className="relative flex justify-center items-center w-full mb-4 group">
                                                                <Button
                                                                    variant="secondary"
                                                                    icon={ChevronRight}
                                                                    onClick={() => toggleMonth(monthGroup.id)}
                                                                >{monthGroup.name}</Button>
                                                                <div className="absolute left-[20px] md:left-1/2 w-[30px] md:w-0 h-[2px] bg-surface-card-hover/80 -z-base md:hidden"></div>
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
                                                                                actorPhotoUrl = '/Logo192.png';
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

                                                                                    <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 mb-3 md:mb-0 z-content ${isLeftDesktop ? 'md:text-right md:pr-12' : 'md:text-left md:pl-12'}`}>
                                                                                        <div className="inline-flex items-center gap-2">
                                                                                            <span className="text-body-lg font-black text-content-2 drop-shadow-sm">{dateStr}</span>
                                                                                            {timeStr !== '12:00 a. m.' && <Badge uppercase={false}>{timeStr}</Badge>}
                                                                                        </div>
                                                                                    </div>

                                                                                    <div className="absolute left-[20px] md:left-1/2 top-1 md:top-auto w-10 h-10 flex items-center justify-center -translate-x-[20px] md:-translate-x-1/2 z-tabs group-hover:scale-125 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]">
                                                                                        <div className={`absolute inset-0 rounded-full opacity-30 animate-pulse ${theme.dot}`}></div>
                                                                                        <div className={`w-4 h-4 rounded-full border-[3px] border-white shadow-sm relative ${theme.dot} ${theme.shadow}`}></div>
                                                                                    </div>

                                                                                    <div className={`w-full md:w-[45%] pl-[50px] md:pl-0 z-content ${isLeftDesktop ? 'md:pl-12' : 'md:pr-12'}`}>
                                                                                        <div data-surface="card" className={`relative overflow-hidden p-5 transition-all duration-500 hover:bg-surface-card-hover text-left`}>

                                                                                            <theme.icon className={`absolute -bottom-6 -right-6 w-36 h-36 opacity-[0.03] -rotate-12 ${theme.text} pointer-events-none transition-transform duration-700 group-hover:scale-125 group-hover:-rotate-6`} strokeWidth={1} />

                                                                                            <div className="relative z-base">
                                                                                                <div className="mb-3">
                                                                                                    <Badge variant={theme.variante || 'neutral'}>{actionLabel}</Badge>
                                                                                                </div>

                                                                                                <h4 className="text-body-lg md:text-subtitle font-black text-content leading-tight mb-2">
                                                                                                    {itemTitle}
                                                                                                </h4>

                                                                                                {(oldVal || newVal) && (
                                                                                                    <div className="flex flex-col gap-1 mt-2">
                                                                                                        {oldVal && <span className="text-caption font-bold text-content-3 line-through truncate">Antes: {oldVal}</span>}
                                                                                                        {newVal && <span className={`text-caption font-bold truncate ${item.severity === 'CRITICAL' ? 'text-danger-text' : 'text-brand-text'}`}>Nuevo: {newVal}</span>}
                                                                                                    </div>
                                                                                                )}

                                                                                                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-card">
                                                                                                    <div className="flex items-center gap-2">
                                                                                                        <div className="w-6 h-6 rounded-full bg-surface-card-hover/80 border border-white flex items-center justify-center text-content-3 text-caption font-black shadow-inner uppercase overflow-hidden shrink-0">
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
                                                                                                        <span className="text-micro font-black text-content-2 uppercase tracking-widest leading-none drop-shadow-sm truncate max-w-[120px] md:max-w-none">{actorName}</span>
                                                                                                    </div>

                                                                                                    {(isDoc && item.file_url) || parsedDetails.file_url ? (
                                                                                                        <Button variant="secondary" icon={Eye} onClick={() => handlePreviewDocument(item.file_url || parsedDetails.file_url, itemTitle)}>Ver Doc</Button>
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
                        <div className="pt-8 text-center animate-in fade-in duration-500 relative z-base">
                            <Button variant="secondary" onClick={() => setShowAllHistory(true)}>Cargar historial completo</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TabHistory;