import React, { useState, useMemo, useRef, useCallback } from 'react';
import BotonIA from '../../components/common/BotonIA';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import { AiThinkingState } from '../../components/common/StateViews';
import { createPortal } from 'react-dom';
import { Filter, Search, Download, Clock, FileText, Users, Eye, FileOutput, Printer, CheckCircle2, AlertTriangle, Settings, Building2, Wallet, ChevronRight, Sparkles, ArrowLeft } from 'lucide-react';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidSelect from '../../components/common/LiquidSelect';
import { useAuth } from '@nucleo/context/AuthContext';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { hora12 } from '@nucleo/utils/hora';
// 🚨 IMPORTACIÓN ESTANDARIZADA
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { rotuloDelRegistro, lecturaDelRegistro } from '@nucleo/utils/historialDeSucursal';
import { analizarHistorial } from '@nucleo/data/ia';
import { exportCsv } from '@nucleo/utils/csvExport';
import { registrarEgreso } from '@nucleo/data/egreso';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import AvatarConEstado from '../../components/common/AvatarConEstado';

// `audit_log_de_sucursal` devuelve como mucho los 200 registros más recientes
// de la bitácora (su `LIMIT 200`). Si llegan exactamente 200, hay más que no
// se ven, y «Cargar historial completo» tiene que decirlo en vez de prometer
// todo el historial.
const TOPE_DE_LA_BITACORA = 200;

const NOMBRES_DE_SISTEMA = ['SISTEMA', 'ADMIN', 'ADMINISTRADOR'];

/**
 * Quién hizo un registro. `audit_logs.user_id` es la FICHA (`employees.id`),
 * así que se busca primero por id —lo único que no cambia—, después por
 * correo y recién al final por nombre, que se escribe distinto según quién lo
 * guardó. Los documentos versionados (`branch_documents`) no guardan autor.
 */
function actorDelRegistro(item, employees) {
    if (item.isSynthetic) return { sistema: true, emp: null, nombre: 'Sistema' };
    const lista = employees || [];
    const nombreCrudo = String(item.user_name || item.actor_name || '').trim();
    const emp = (item.user_id != null && item.user_id !== '' && lista.find(e => String(e.id) === String(item.user_id)))
        || (item.user_email && lista.find(e => e.email && e.email === item.user_email))
        || (nombreCrudo && lista.find(e => e.name && e.name.toLowerCase() === nombreCrudo.toLowerCase()))
        || null;
    if (emp) return { sistema: false, emp, nombre: emp.name };
    if (nombreCrudo && !NOMBRES_DE_SISTEMA.includes(nombreCrudo.toUpperCase())) {
        return { sistema: false, emp: null, nombre: nombreCrudo };
    }
    if (item.user_email) return { sistema: false, emp: null, nombre: item.user_email };
    if (item.isDoc) return { sistema: false, emp: null, nombre: null };
    return { sistema: true, emp: null, nombre: 'Sistema' };
}

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
        case 'DATOS_DEL_DUI_ACTUALIZADOS':
        case 'ELIMINAR_EMPLEADO':
        case 'ACCION_RRHH':
        case 'ASIGNAR_TURNO_SEMANAL':
        case 'REGISTRO_ASISTENCIA':
            return { icon: Users, bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30', dot: 'bg-chart-3', shadow: 'shadow-[var(--shadow-glow-chart-3)]' , variante: 'chart-3' };
        default:
            return { icon: CheckCircle2, bg: 'bg-surface-card-hover', text: 'text-content-3', border: 'border-divider', dot: 'bg-content-3', shadow: 'shadow-sm' , variante: 'neutral' };
    }
};

const TabHistory = ({ liveBranch, history: propHistory = [], isLoadingHistory, historyError = null, employees = [], openModal }) => {
    const { hasPermission } = useAuth();
    const canDownload = hasPermission('branches_descargar');
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
                    name: 'Inauguración de la sucursal',
                    actor_name: 'SISTEMA'
                });
            }
        }
        return combined.sort((a, b) => b.sortDate - a.sortDate);
    }, [propHistory, openDateStr]);

    // El rótulo sale del núcleo (`historialDeSucursal`), el mismo de la app.
    const getActionLabel = useCallback((item) => rotuloDelRegistro(item), []);

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
            const itemName = lecturaDelRegistro(item).titulo;
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
            const monthName = date.toLocaleDateString('es-SV', { month: 'long' }).toUpperCase();
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
    const topeAlcanzado = useMemo(
        () => (Array.isArray(propHistory) ? propHistory : []).filter(i => i.isLog).length >= TOPE_DE_LA_BITACORA,
        [propHistory]
    );
    const printHistory = isFilteringActive ? filteredHistory : syntheticHistory;

    // INTERACCIONES
    const handleMouseEnter = () => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); setIsDownloadMenuOpen(true); };
    const handleMouseLeave = () => { hoverTimeoutRef.current = setTimeout(() => setIsDownloadMenuOpen(false), 300); };
    // El reporte impreso (o guardado como PDF) también es una salida de datos:
    // se anota igual que el CSV.
    const handlePrintVisualReport = () => {
        registrarEgreso('branches', {
            formato: 'pdf',
            filas: printHistory.length,
            detalle: { reporte: 'historial_de_sucursal', sucursal: liveBranch?.id ?? null, filtrado: !!isFilteringActive },
        });
        window.print();
    };
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
                const date = fechaTexto(item.sortDate);
                return {
                    fecha: date,
                    accion: getActionLabel(item),
                    detalle: lecturaDelRegistro(item).titulo,
                    usuario: item.user_name || item.actor_name || 'Sistema'
                };
            }).slice(0, 150);

            const { data: aiResponse, error: aiError } = await analizarHistorial({
                branchName: liveBranch?.name || 'la sucursal',
                historyData: JSON.stringify(compressedHistory),
            });

            if (aiError) throw new Error(aiError.message);
            if (!aiResponse?.success) throw new Error("Fallo en la generación del resumen.");

            setAiSummaryData(aiResponse.aiSummary);

        } catch (error) {
            console.error("Error al generar resumen IA:", error);
            setAiSummaryData("No se pudo analizar el historial. Revisa la conexión e intenta de nuevo.");
        } finally {
            setIsGeneratingAi(false);
        }
    };

    // `exportCsv` canónico: el archivo sale con BOM y separador `;` como todos
    // los del portal, y queda anotado en `export_log` con el módulo. El autor
    // es el de cada registro —nombre completo, como todo lo que sale del
    // portal—, no «Administrador» fijo.
    const handleExportHistory = () => {
        if (printHistory.length === 0) return;
        const headers = ['Fecha', 'Hora', 'Acción', 'Descripción', 'Realizado por'];
        const rows = printHistory.map(item => {
            const dateObj = new Date(item.sortDate);
            const dStr = dateObj.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tStr = (dateObj.getHours() === 0 && dateObj.getMinutes() === 0) ? 'N/A' : hora12(dateObj);
            const action = getActionLabel(item);
            const lectura = lecturaDelRegistro(item);
            const desc = lectura.nuevo ? `${lectura.titulo} (${lectura.nuevo})` : lectura.titulo;
            const actor = actorDelRegistro(item, employees).nombre || 'No registrado';
            return [dStr, tStr, action, desc, actor];
        });
        exportCsv(headers, rows, `Historial_${liveBranch?.name || 'sucursal'}.csv`, 'branches');
    };

    const renderPrintPortal = () => {
        return createPortal(
            <div id="print-report-container" className="hidden print:block w-full bg-surface-card text-content font-sans p-6 md:p-10 max-w-[1200px] mx-auto">
                <div className="border-b-[3px] border-slate-900 pb-3 mb-4 flex justify-between items-end">
                    <div><h1 className="text-2xl font-black uppercase tracking-tighter text-content leading-none mb-1">Historial Operativo</h1><h2 className="text-sm font-bold text-content-2 uppercase tracking-widest leading-none">Sucursal: <span className="text-brand-text">{liveBranch?.name || 'No especificada'}</span></h2></div>
                    <div className="text-right"><p className="text-micro font-bold text-content-3 uppercase tracking-widest mb-0.5">Fecha de Emisión</p><p className="text-xs font-black text-content leading-none">{fechaTexto(hoySV())}</p></div>
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
                            const lecturaImpresa = lecturaDelRegistro(item);
                            const itemTitle = lecturaImpresa.nuevo ? `${lecturaImpresa.titulo} (${lecturaImpresa.nuevo})` : lecturaImpresa.titulo;
                            return (
                                <tr key={idx} className="border-b border-divider break-inside-avoid">
                                    <td className="py-2.5 px-2 font-bold">{dateObj.toLocaleDateString('es-SV')}</td>
                                    <td className="py-2.5 px-2 text-micro uppercase tracking-widest">{getActionLabel(item)}</td>
                                    <td className="py-2.5 px-2 font-bold text-content">{itemTitle}</td>
                                    <td className="py-2.5 px-2 font-bold text-content-2">{actorDelRegistro(item, employees).nombre || (item.isDoc ? 'DOCUMENTO' : 'SISTEMA')}</td>
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


    return (
        <div className="space-y-6 relative h-full flex flex-col">
            <style>{`@media print { #root { display: none !important; } body { background: white !important; margin: 0; padding: 0; } #print-report-container { display: block !important; position: static !important; } @page { margin: 10mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`}</style>
            {renderPrintPortal()}
            
            {/* HEADER CONTROLS */}
            <div className="relative z-modal flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 pb-5 border-b border-divider no-print">
                <div>
                    <h3 className="text-title-sm font-black text-content tracking-tight">Historial</h3>
                    <p className="text-body-sm text-content-3">Lo que cambió en esta sucursal, lo más reciente arriba.</p>
                </div>

                {/* §17 (2026-07-30): esta barra llevaba en `trailingActions` el
                    filtro de tipo, el rango de fechas y su reset. O sea que la
                    píldora del HEADER estaba filtrando, que es exactamente lo que
                    §17 dice que no hace — y en el teléfono esos tres controles
                    quedaban tras un ícono rotulado "Filtros y acciones" arriba de
                    todo, que se va con el scroll. Ahora el header es navegación y
                    buscador, y filtros y acciones viven juntos en `FilterBar`. */}
                <ViewTabBar
                    searchValue={searchQuery}
                    onSearchChange={setSearchQuery}
                    placeholder="Buscar en historial..."
                />
            </div>

            {/* §17: los filtros del historial y sus acciones, en una sola píldora.
                El botón de IA y el menú de exportar van por `accionesExtra` porque
                no son un descriptor de botón: el primero es una pieza bespoke con
                su gradiente giratorio, el segundo un desplegable con dos formatos. */}
            <div className="flex justify-end mb-4 no-print">
                <FilterBar
                    onClear={() => { setDateFilter({ start: '', end: '' }); setTypeFilter('ALL'); }}
                    activeCount={[typeFilter !== 'ALL', !!(dateFilter.start || dateFilter.end)].filter(Boolean).length}
                    title="Filtros del historial"
                    accionesExtra={(
                        <div className="flex items-center gap-1.5">
                            {/* 🤖 BOTÓN MAESTRO DE IA ESTANDARIZADO 🤖 */}
                            <BotonIA
                                className="z-sidebar animate-in zoom-in-95"
                                activo={aiMode}
                                disabled={printHistory.length === 0 && !aiMode}
                                onClick={aiMode ? () => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); } : generateGlobalAiSummary}
                                etiqueta="Resumen inteligente del historial"
                                etiquetaActiva="Cerrar el resumen de IA"
                            />

                            {/* `branches_descargar` (canon 2026-08-03): el reporte y el
                                CSV se llevan el historial de la sucursal fuera del portal. */}
                            {canDownload && (
                            <div className="relative z-toast" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                                <Button variant="ghost" size="sm" icon={Download}>
                                    <span className="hidden sm:inline">Exportar</span>
                                </Button>
                                <div className={`absolute top-[100%] left-0 pt-2 transition-all duration-[var(--dur-slow)] ${isDownloadMenuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-2'}`}>
                                    <div data-surface="dropdown" className="w-[160px] p-1.5 flex flex-col gap-1">
                                        <Button icon={Printer} onClick={() => { handlePrintVisualReport(); setIsDownloadMenuOpen(false); }}>Reporte PDF</Button>
                                        <Button tone="success" icon={FileOutput} onClick={() => { handleExportHistory(); setIsDownloadMenuOpen(false); }}>Datos CSV</Button>
                                    </div>
                                </div>
                            </div>
                            )}
                        </div>
                    )}
                >
                    <FilterBar.Section active={typeFilter !== 'ALL'} onClear={() => setTypeFilter('ALL')} label="tipo">
                        <Filter size={12} className="text-content-3 shrink-0" strokeWidth={2.5} />
                        <div className="w-[150px]">
                            <LiquidSelect value={typeFilter} onChange={(value) => setTypeFilter(value)}
                                options={[{ value: 'ALL', label: 'Todo' }, { value: 'LEGAL', label: 'Legal' }, { value: 'HR', label: 'Personal' }, { value: 'OPERATIVE', label: 'Operativo' }, { value: 'FINANCE', label: 'Finanzas' }]}
                                clearable={false} compact bare />
                        </div>
                    </FilterBar.Section>

                    {/* D3.11: un `RangeDatePicker` en vez de dos `LiquidDatePicker`
                        coordinados a mano. `months={1}` porque el panel de dos meses
                        (596px) es de pedir vacaciones, no de filtrar. */}
                    <FilterBar.Section active={!!(dateFilter.start || dateFilter.end)}
                        onClear={() => setDateFilter({ start: '', end: '' })} label="fecha">
                        <div className="w-[200px]">
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
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {/* ============================================================================ */}
            {/* 🎭 CONTENEDOR DE TRANSICIÓN FLUIDA ENTRE MODO NORMAL Y MODO IA               */}
            {/* ============================================================================ */}
            <div className="relative w-full max-w-4xl py-2 flex-1">
                
                {/* 🤖 VISTA DE INTELIGENCIA ARTIFICIAL (DIAGNÓSTICO) */}
                <div inert={!(aiMode) ? true : undefined} className={`transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] transform w-full ${aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>
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
                                    <AiThinkingState size="sm" title="Sintetizando historial" className="mb-2" />
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
                                <div data-surface="card" className="w-full max-w-3xl text-left p-6 md:p-8 relative z-base animate-in slide-in-from-bottom-4 duration-[var(--dur-lento)]">
                                    {aiSummaryData?.split('\n').map((paragraph, index) => (
                                        <div key={index} className="relative mb-6 last:mb-0 group/p">
                                            <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[var(--shadow-glow-chart-3-md)] transition-all duration-[var(--dur-slow)]"></div>
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
                <div inert={aiMode ? true : undefined} className={`transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] transform w-full ${!aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 -translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>
                    
                    {/* Una sola columna (2026-10-29). La línea de tiempo alternada
                        —fecha a un lado, tarjeta al otro— dejaba media pantalla
                        vacía en cada renglón y obligaba a mover el ojo de lado a
                        lado para leer qué pasó y cuándo. Ahora cada registro dice
                        las dos cosas en el mismo renglón. */}
                    {isLoadingHistory ? (
                        <div className="space-y-3 pt-5">
                            {[1, 2, 3].map((i) => (
                                <div key={i} data-surface="card" className="p-4 space-y-2.5">
                                    <div className="h-4 skeleton rounded-full w-1/2" />
                                    <div className="h-3 skeleton rounded-full w-1/3" />
                                </div>
                            ))}
                        </div>
                    ) : historyError && propHistory.length === 0 ? (
                        <div className="pt-5">
                            <Notice variant="danger" icon={AlertTriangle}>{historyError}</Notice>
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="py-16 text-center">
                            <FileText className="text-content-3 mx-auto mb-3" size={36} strokeWidth={1.5} aria-hidden="true" />
                            <p className="text-body font-bold text-content-2">Sin registros</p>
                            <p className="text-body-sm text-content-3 mt-1">Cuando se edite la sucursal, sus cambios aparecen aquí.</p>
                        </div>
                    ) : (
                        <div className="pt-5">
                            {isHistorySearchFuzzy && searchQuery && (
                                <Notice variant="warning" icon={Search} className="mb-4">
                                    Resultados similares para &ldquo;{searchQuery}&rdquo; — no se encontraron coincidencias exactas
                                </Notice>
                            )}
                            {groupedHistory.map((yearGroup) => {
                                const isYearOpen = !collapsedYears[yearGroup.year];
                                return (
                                    <section key={yearGroup.year} className="mb-6 last:mb-0">
                                        <button type="button" onClick={() => toggleYear(yearGroup.year)} aria-expanded={isYearOpen}
                                            className="flex items-center gap-2 min-h-[var(--tap-min)] text-title-sm font-black text-content tabular-nums transition-colors duration-[var(--dur-fast)] hover:text-brand-text active:scale-[0.97]">
                                            <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true"
                                                className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isYearOpen ? 'rotate-90' : ''}`} />
                                            {yearGroup.year}
                                        </button>

                                        {isYearOpen && yearGroup.months.map((monthGroup) => {
                                            const isMonthOpen = !collapsedMonths[monthGroup.id];
                                            return (
                                                <div key={monthGroup.id} className="mt-2">
                                                    <button type="button" onClick={() => toggleMonth(monthGroup.id)} aria-expanded={isMonthOpen}
                                                        className="flex items-center gap-1.5 min-h-[var(--tap-min)] pl-1 text-caption font-black text-content-3 uppercase tracking-widest transition-colors duration-[var(--dur-fast)] hover:text-content-2">
                                                        <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true"
                                                            className={`transition-transform duration-[var(--dur-base)] ${isMonthOpen ? 'rotate-90' : ''}`} />
                                                        {monthGroup.name}
                                                        <span className="font-bold normal-case tracking-normal">· {monthGroup.events.length}</span>
                                                    </button>

                                                    {isMonthOpen && (
                                                        // La línea vertical es un trazo detrás de los puntos, no
                                                        // un `border-l` (que el canon reserva y el gate prohíbe).
                                                        <ol className="relative ml-[11px] pl-5 space-y-3 py-1">
                                                            <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full bg-divider" />
                                                            {monthGroup.events.map((item) => {
                                                                const theme = getThemeForAction(item.action, item.isDoc, item.isSynthetic);
                                                                const lectura = lecturaDelRegistro(item);
                                                                const dateObj = new Date(item.sortDate);
                                                                const dia = dateObj.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
                                                                const hora = hora12(dateObj);
                                                                const conHora = hora !== hora12('00:00');

                                                                // Id → correo → nombre (`actorDelRegistro`), y el
                                                                // nombre CORTO del canónico junto a su foto.
                                                                const actor = actorDelRegistro(item, employees);
                                                                const actorName = actor.sistema
                                                                    ? 'Sistema'
                                                                    : actor.nombre ? shortEmployeeName(actor.emp || actor.nombre) : 'Autor no registrado';

                                                                return (
                                                                    <li key={item.id} className="relative">
                                                                        <span aria-hidden="true"
                                                                            className={`absolute -left-[25px] top-5 w-3 h-3 rounded-full ${theme.dot}`} />
                                                                        <article data-surface="card" className="p-4">
                                                                            <div className="flex items-start justify-between gap-3">
                                                                                <div className="min-w-0">
                                                                                    <p className={`text-body font-black leading-snug ${lectura.critico ? 'text-danger-text' : 'text-content'}`}>{lectura.titulo}</p>
                                                                                    {(lectura.antes || lectura.nuevo) && (
                                                                                        <p className="mt-1 text-body-sm text-content-2 break-words">
                                                                                            {lectura.antes && <span className="text-content-3 line-through mr-2">{lectura.antes}</span>}
                                                                                            {lectura.nuevo}
                                                                                        </p>
                                                                                    )}
                                                                                </div>
                                                                                <time dateTime={dateObj.toISOString()} className="shrink-0 text-right text-caption text-content-3 tabular-nums leading-tight">
                                                                                    <span className="block font-bold text-content-2">{dia}</span>
                                                                                    {conHora && <span className="block">{hora}</span>}
                                                                                </time>
                                                                            </div>
                                                                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                                                                                <Badge variant={theme.variante || 'neutral'} size="sm" uppercase={false}>{getActionLabel(item)}</Badge>
                                                                                <span className="inline-flex items-center gap-1.5 min-w-0 text-caption font-semibold text-content-2">
                                                                                    {actor.sistema ? (
                                                                                        <img src="/Logo192.png" alt="" className="w-5 h-5 rounded-full object-contain" />
                                                                                    ) : actor.nombre ? (
                                                                                        <AvatarConEstado emp={actor.emp || { id: item.user_id ?? null, name: actor.nombre }} px={20} radio="rounded-full" marco="" />
                                                                                    ) : null}
                                                                                    <span className="truncate max-w-[180px]">{actorName}</span>
                                                                                </span>
                                                                                {lectura.archivo && (
                                                                                    <Button variant="ghost" size="sm" icon={Eye} className="ml-auto"
                                                                                        onClick={() => handlePreviewDocument(lectura.archivo, lectura.titulo)}>Ver documento</Button>
                                                                                )}
                                                                            </div>
                                                                        </article>
                                                                    </li>
                                                                );
                                                            })}
                                                        </ol>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </section>
                                );
                            })}
                        </div>
                    )}

                    {!showAllHistory && syntheticHistory.length > filteredHistory.length && !dateFilter.start && !dateFilter.end && searchQuery === '' && typeFilter === 'ALL' && (
                        <div className="pt-8 text-center animate-in fade-in duration-[var(--dur-lento)] relative z-base">
                            <Button variant="secondary" onClick={() => setShowAllHistory(true)}>
                                {topeAlcanzado ? `Cargar los ${TOPE_DE_LA_BITACORA} más recientes` : 'Cargar historial completo'}
                            </Button>
                        </div>
                    )}
                    {topeAlcanzado && (showAllHistory || dateFilter.start || dateFilter.end || searchQuery !== '' || typeFilter !== 'ALL') && !isLoadingHistory && (
                        <div className="pt-6 relative z-base">
                            <Notice variant="info" icon={Clock}>
                                Se muestran los {TOPE_DE_LA_BITACORA} movimientos más recientes de la bitácora de esta sucursal. Los anteriores no se cargan en esta vista.
                            </Notice>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TabHistory;