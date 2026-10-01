import React, { lazy, Suspense, useState, useEffect, useMemo, memo } from 'react';
import SegmentedControl from '../common/SegmentedControl';
import { fetchBranchHourlySalesRange } from '@nucleo/data/dashboard';
import { afluencia } from '@nucleo/utils/afluencia';
import { nivelDeVolumen } from '@nucleo/utils/inicio';
import { fetchVentasSinProducto } from '@nucleo/data/ventas';
import AvisoSinProducto from '../common/AvisoSinProducto';
import { Loader2, Activity, Users, DollarSign, Calendar as CalendarIcon, MousePointerClick, TrendingUp, Sparkles, Building2 } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// 🚀 IMPORTANTE: Importamos el parser robusto que usamos en el otro componente
import { useAuth } from '@nucleo/context/AuthContext';
import { AiThinkingState } from '../common/StateViews';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';

// El dibujo arrastra `recharts` (95 kB gzip): 95 de los 119 kB que pesaba este
// modal. Leer el encabezado de `GraficaAfluencia.jsx` antes de tocarlo.
const GraficaAfluencia = lazy(() => import('./GraficaAfluencia'));

const DAYS_MAP = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];

// 🛠️ Función Helper para formato AM/PM
const formatHourAMPM = (hour) => {
    const ampm = hour >= 12 ? 'pm' : 'am';
    const h = hour % 12 || 12;
    return `${h}:00 ${ampm}`;
};

const FormWfmAnalytics = ({ branches }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [salesData, setSalesData] = useState([]);
    const [branchName, setBranchName] = useState('');
    /* El alcance es el de Horarios, que es de donde se abre esta pantalla.
     * Sin alcance sobre todas, arranca —y se queda— en la sala propia. */
    const { user, getScope } = useAuth();
    const puedeElegirSucursal = getScope('schedules') === 'ALL';
    const [selectedBranch, setSelectedBranch] = useState(() =>
        !puedeElegirSucursal && user?.branchId
            ? String(user.branchId)
            : (branches?.[0]?.id ? String(branches[0].id) : ''));
    const [timeRange, setTimeRange] = useState('30'); // '0' significa "Hoy"
    // Lo que en esta ventana NO es venta de productos. La gráfica de horas se
    // dibuja por CANTIDAD de transacciones, así que un cobro suelto no le mueve
    // el color a ninguna barra — pero el tooltip y la lectura de la sala sí
    // hablan de dinero, y una comisión de $428 a las 10:17 hace parecer que esa
    // hora vendió. Por eso el aviso va acá aunque el heatmap no se mueva.
    const [sinProducto, setSinProducto] = useState(null);

    // ESTADO DE LA VISTA: 'DAYS', 'GENERAL_HOURS', o número de día (0-6)
    const [activeView, setActiveView] = useState('DAYS');

    const branchOptions = useMemo(() => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

    // Actualizar nombre de sucursal para Tooltip
    useEffect(() => {
        const branch = branches.find(b => String(b.id) === String(selectedBranch));
        setBranchName(branch?.name || '');
    }, [selectedBranch, branches]);

    // 🚀 AUTO-CAMBIO DE VISTA: Si es "Hoy" (0), forzar la vista de horas. Si no, volver a "DAYS"
    useEffect(() => {
        if (timeRange === '0') {
            setActiveView('GENERAL_HOURS');
        } else {
            setActiveView('DAYS');
        }
    }, [timeRange]);

    useEffect(() => {
        if (!selectedBranch) return;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const today = new Date();
                const yearToday = today.getFullYear();
                const monthToday = String(today.getMonth() + 1).padStart(2, '0');
                const dayToday = String(today.getDate()).padStart(2, '0');
                const todayStr = `${yearToday}-${monthToday}-${dayToday}`;

                let queryStr = todayStr; // Por defecto es Hoy

                if (timeRange !== '0') {
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - parseInt(timeRange));
                    const yearStart = startDate.getFullYear();
                    const monthStart = String(startDate.getMonth() + 1).padStart(2, '0');
                    const dayStart = String(startDate.getDate()).padStart(2, '0');
                    queryStr = `${yearStart}-${monthStart}-${dayStart}`;
                }

                // Paginada (2026-10-01): con `.limit(10000)` PostgREST igual cortaba en
                // 1000, y de la MÁS RECIENTE hacia atrás — «1 año» mostraba unos 75 días.
                const { data, error } = await fetchBranchHourlySalesRange(selectedBranch, queryStr);

                if (error) throw error;
                setSalesData(data || []);

                // Misma ventana exacta que la gráfica —de `queryStr` a hoy— para
                // que el aviso hable de lo que se está viendo y no de otro rango.
                // Va en su propio `try`: si el aviso falla, la analítica se pinta
                // igual. Sin el permiso el servidor devuelve `null` y no se pinta.
                try {
                    setSinProducto(await fetchVentasSinProducto({
                        fini: queryStr, ffin: todayStr, branchId: selectedBranch,
                    }));
                } catch (e) {
                    console.error('AvisoSinProducto (analítica):', e.message);
                    setSinProducto(null);
                }
            } catch (err) {
                console.error("Error cargando analítica WFM:", err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [selectedBranch, timeRange]);

    // 🚀 MOTOR DE CÁLCULO ESTADÍSTICO DINÁMICO (CAMPANA DE GAUSS / PERCENTILES)
    const chartData = useMemo(() => {
        if (!salesData.length) return [];

        // El cálculo vive en el núcleo (`utils/afluencia`), el mismo de la app y
        // del widget del tablero. Acá sólo se le ponen los nombres del dibujo.
        const currentBranch = branches.find(b => String(b.id) === String(selectedBranch));
        const isTodayView = timeRange === '0';
        const { items, fechas } = afluencia(salesData, currentBranch, {
            vista: activeView === 'DAYS' ? 'dias' : activeView === 'GENERAL_HOURS' ? 'horas' : activeView,
            hoy: isTodayView,
        });
        if (!fechas) return [];
        const fill = (v) => `var(--txvol-${nivelDeVolumen(v)})`;

        if (activeView === 'DAYS') {
            return items.map(it => ({
                dayOfWeek: it.dia, displayLabel: DAYS_MAP[it.dia],
                avgTransactions: it.tickets, avgSales: it.ventas, uniqueDates: it.fechas, fill: fill(it.tickets),
            }));
        }
        const todayStr = hoySV();
        return items.map(it => ({
            hour: it.hora, displayLabel: formatHourAMPM(it.hora),
            avgTransactions: it.tickets, avgSales: it.ventas,
            tooltipDate: isTodayView ? todayStr : (it.fechas.length === 1 ? it.fechas[0] : null),
            fill: fill(it.tickets),
        }));
    }, [salesData, activeView, timeRange, branches, selectedBranch]);

    const handleBarClick = (data) => {
        if (activeView === 'DAYS' && data?.dayOfWeek !== undefined) {
            setActiveView(data.dayOfWeek);
        }
    };

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const isHistoricalView = timeRange !== '0';
            
            let dateLabel = "Promedio Histórico";
            if (timeRange === '0') {
                dateLabel = `Datos de Hoy (${hoySV()})`;
            } else if (data.uniqueDates?.length === 1 || data.tooltipDate) {
                const d = data.uniqueDates?.[0] || data.tooltipDate;
                dateLabel = `Fecha: ${d}`;
            } else if (activeView !== 'DAYS' && isHistoricalView) {
                dateLabel = `Promedio (${DAYS_MAP[activeView]} Histórico)`;
            }

            return (
                <div data-surface="tooltip" className="p-3.5 w-max z-modal animate-in fade-in duration-[var(--dur-slow)] transform-gpu">
                    <p className="font-black text-caption uppercase tracking-widest text-content-tooltip-2 mb-1 leading-none">{branchName}</p>
                    <p className="font-extrabold text-body-sm uppercase tracking-tight text-content-tooltip mb-2 pb-1.5 border-b border-white/15">{activeView === 'DAYS' ? 'Día' : 'Hora'}: {data.displayLabel}</p>
                    
                    <div className="flex flex-col gap-2 mb-2">
                        <p className="text-body font-bold flex items-center gap-2.5">
                            <Users size={16} className="text-[#F79009]" /> 
                            {data.avgTransactions} {timeRange === '0' ? 'Tx Registradas' : 'Tx Promedio'}
                        </p>
                        <p className="text-body font-bold flex items-center gap-2.5">
                            <DollarSign size={16} className="text-success" /> 
                            {formatMoney(data.avgSales)} 
                        </p>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-divider flex flex-col gap-1.5">
                        <span className="text-micro font-black uppercase tracking-widest text-content-tooltip-2">{dateLabel}</span>
                        {activeView === 'DAYS' && isHistoricalView && (
                            <div className="flex items-center gap-1.5 text-brand-text">
                                <MousePointerClick size={12} />
                                <span className="text-micro font-black uppercase tracking-widest">Clic para ver horas</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full flex flex-col gap-6 animate-in fade-in duration-[var(--dur-lento)]">
            {/* CONTROLES SUPERIORES · §20.2 · CARRIL — grupo de controles en una caja
                redondeada. El lift pasa de `--lift-card` a `--lift-track`, que es el
                que corresponde a esta superficie (§20.3). */}
            <div data-surface="tab-track" className="flex flex-col sm:flex-row gap-4 items-center justify-between p-3.5 sm:p-4 transform-gpu hover:translate-y-[var(--lift-track)] transition-transform duration-[var(--dur-lento)]">
                <div className="w-full sm:w-auto flex items-center gap-3">
                     <div className="relative group/saly w-11 h-11 flex items-center justify-center rounded-full shrink-0 border-0 shadow-[var(--shadow-glow-chart-9-md)] hover:shadow-[var(--shadow-glow-chart-9-lg)] transition-shadow duration-[var(--dur-lento)]">
                        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400 via-cyan-500 to-indigo-500 rounded-full opacity-30 group-hover/saly:opacity-100 transition-opacity duration-[var(--dur-lento)] group-hover/saly:animate-spin [animation-duration:4s]"></div>
                        <div className="absolute inset-[1px] bg-surface-card rounded-full border border-border-card"></div>
                        <TrendingUp size={20} strokeWidth={2.5} className="text-chart-9-text group-hover/saly:text-chart-3-text relative z-base transition-colors duration-[var(--dur-slow)]" />
                    </div>
                    
                    {/* Se abre desde Horarios, así que responde a su alcance.
                        Ofrecía las sucursales del catálogo sin preguntarle al
                        permiso: con alcance de una sala se podía mirar la
                        afluencia y las ventas por hora de las demás. */}
                    {puedeElegirSucursal && (
                        <div className="w-full sm:w-[250px] overflow-visible group/branch hover:translate-y-[var(--lift-hover)] transition-transform duration-[var(--dur-slow)]">
                            <LiquidSelect value={selectedBranch} onChange={setSelectedBranch} options={branchOptions} clearable={false} compact icon={Building2} />
                        </div>
                    )}
                </div>

                {/* FILTROS DE RANGO (PILL TABS) */}
                <div className="flex items-center bg-surface-card-hover rounded-full p-1 border border-divider shadow-inner w-full sm:w-auto h-[48px] justify-between">
                    <SegmentedControl
                        label="Rango de tiempo"
                        value={timeRange}
                        onChange={setTimeRange}
                        options={[
                            { value: '0',   label: 'Hoy' },
                            { value: '30',  label: '30 días' },
                            { value: '90',  label: '3 meses' },
                            { value: '180', label: '6 meses' },
                            { value: '365', label: '1 año' },
                        ]}
                    />
                </div>
            </div>

            {/* GRÁFICA PRINCIPAL (GLASS CONTAINER) */}
            <div data-surface="card" className="p-6 relative min-h-[380px] flex flex-col transform-gpu transition-all duration-[var(--dur-lento)]">

                {/* CABECERA DE GRÁFICA Y CONTROLES (TABS PILL STYLE) */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="relative group/calendar w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-shadow duration-[var(--dur-lento)] shadow-[var(--shadow-glow-brand)] hover:shadow-[var(--shadow-glow-brand)]">
                            <div className="absolute inset-0 bg-gradient-to-br from-brand to-brand-hover rounded-full opacity-100 group-hover/calendar:scale-110 transition-transform duration-[var(--dur-slow)]"></div>
                            <CalendarIcon size={18} strokeWidth={2.5} className="text-white relative z-base transition-colors duration-[var(--dur-slow)]" />
                        </div>
                        <h3 className="text-body-xl font-black text-content uppercase tracking-tight leading-none group-hover/branch:text-brand-text transition-colors">
                            {activeView === 'DAYS' ? 'Afluencia Histórica por Día' :
                                activeView === 'GENERAL_HOURS' ? (timeRange === '0' ? 'Afluencia por Hora (Hoy)' : 'Afluencia General (Hr)') :
                                    `Afluencia por Hora - ${DAYS_MAP[activeView]}`}
                        </h3>
                    </div>

                    <div className="flex flex-col items-end gap-2.5">
                        {/* FILA 1: SEMANA | GENERAL (PILL TABS) */}
                        {/* La fila de abajo (los 7 días) YA era un `SegmentedControl`
                            y ésta seguía siendo dos `<button>` sueltos — las dos
                            controlan el MISMO `activeView`. Se separan en dos grupos a
                            propósito: 2 + 7 opciones no entran en una fila, y cada
                            `label` dice cuál es cuál. */}
                        <SegmentedControl
                            size="sm"
                            label="Vista del análisis"
                            value={activeView === 'GENERAL_HOURS' ? 'GENERAL_HOURS' : (activeView === 'DAYS' ? 'DAYS' : null)}
                            onChange={setActiveView}
                            options={[
                                ...(timeRange !== '0' ? [{ value: 'DAYS', label: 'Semana' }] : []),
                                { value: 'GENERAL_HOURS', label: timeRange === '0' ? 'Horas de Hoy' : 'General (Hr)' },
                            ]}
                        />

                        {/* FILA 2: L M M J V S D (Se oculta si el filtro es de hoy) (PILL TABS) */}
                        {timeRange !== '0' && (
                            <div className="flex items-center bg-surface-card-hover/70 p-1 rounded-full border border-divider shadow-inner w-max gap-0.5">
                                <SegmentedControl
                                    size="sm"
                                    options={DAYS_ORDER.map(d => ({ value: d, label: ['D','L','M','M','J','V','S'][d] }))}
                                    value={activeView} onChange={setActiveView} label="Día de la semana" />
                            </div>
                        )}
                    </div>
                </div>

                {isLoading ? (
                    <AiThinkingState title="Analizando la operación" className="flex-1 relative z-base" />
                ) : chartData.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-content-2 text-label font-bold uppercase tracking-widest relative z-base">
                        <Activity size={32} />
                         No hay datos de ventas registrados para este período.
                    </div>
                ) : (
                    <div className="w-full h-[280px] mt-auto relative z-base">
                        {/* El mismo estado de espera que la consulta de ventas: la
                            descarga del chunk corre en paralelo con ella, así que
                            las dos esperas se leen como una. */}
                        <Suspense fallback={<AiThinkingState title="Analizando la operación" size="sm" className="h-full" />}>
                            <GraficaAfluencia
                                data={chartData}
                                tooltip={<CustomTooltip />}
                                onBarClick={handleBarClick}
                                barCursor={activeView === 'DAYS' ? 'pointer' : 'default'}
                            />
                        </Suspense>
                    </div>
                )}
                
                {/* Sparkles de fondo sutiles para efecto liquidglass */}
                <div className="absolute bottom-6 right-6 text-[#F79009]/15 pointer-events-none group-hover:scale-110 transition-transform duration-[var(--dur-lento)]">
                    <Sparkles size={100} strokeWidth={0.5} />
                </div>
            </div>

            {/* Debajo del dibujo y encima de la leyenda: se lee después de ver las
                barras, que es cuando uno se pregunta por qué esa hora saltó. */}
            <AvisoSinProducto datos={sinProducto} contexto="Lo que se dibuja aquí" className="mt-2" />

            {/* LEYENDA DEL HEATMAP · §20.2 · misma caja redondeada que los controles
                de arriba, así que el mismo CARRIL — que además los empareja: eran dos
                píldoras gemelas con dos materiales escritos por separado. */}
            <div data-surface="tab-track" className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 py-3.5 px-6 mt-2">
                <div className="flex items-center gap-2.5 text-caption sm:text-label font-extrabold text-content-2 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#64748b] shadow-sm"></div> Valle / Muerta</div>
                <div className="flex items-center gap-2.5 text-caption sm:text-label font-extrabold text-content-2 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-brand shadow-sm"></div> Tráfico Normal</div>
                <div className="flex items-center gap-2.5 text-caption sm:text-label font-extrabold text-content-2 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#F79009] shadow-sm"></div> Hora Pico (Aviso)</div>
                <div className="flex items-center gap-2.5 text-caption sm:text-label font-extrabold text-content-2 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#FF2D55] shadow-sm"></div> Hora Crítica</div>
            </div>
        </div>
    );
};

export default memo(FormWfmAnalytics);