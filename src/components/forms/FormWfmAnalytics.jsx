import React, { useState, useEffect, useMemo, memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { supabase } from '../../supabaseClient';
import { Loader2, Activity, Users, DollarSign, Calendar as CalendarIcon, MousePointerClick, TrendingUp, Sparkles, Building2 } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// 🚀 IMPORTANTE: Importamos el parser robusto que usamos en el otro componente
import { parseTimeFlexible, timeToMins } from '../../utils/scheduleHelpers';

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
    const [selectedBranch, setSelectedBranch] = useState(branches?.[0]?.id ? String(branches[0].id) : '');
    const [timeRange, setTimeRange] = useState('30'); // '0' significa "Hoy"

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

                const { data, error } = await supabase
                    .from('branch_hourly_sales')
                    .select('*')
                    .eq('branch_id', selectedBranch)
                    .gte('sale_date', queryStr)
                    .order('sale_date', { ascending: false })
                    .limit(10000);

                if (error) throw error;
                setSalesData(data || []);
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

        let openH = 7; let closeH = 18; 
        const currentBranch = branches.find(b => String(b.id) === String(selectedBranch));
        
        if (currentBranch) {
            let sch = currentBranch.weekly_hours || currentBranch.settings?.schedule;
            if (typeof sch === 'string') {
                try { sch = JSON.parse(sch); } catch(e) { sch = null; }
            }

            if (sch && typeof sch === 'object') {
                let minOpen = 1440; let maxClose = 0;
                Object.values(sch).forEach(d => {
                    if (d && d.isOpen !== false && !d.isClosed && !d.isOff) {
                        const cleanStart = String(d.start || d.open || '').replace(/[^0-9:]/g, '').trim();
                        const cleanEnd = String(d.end || d.close || '').replace(/[^0-9:]/g, '').trim();
                        
                        if (cleanStart && cleanEnd) {
                            const oMins = timeToMins(cleanStart);
                            let cMins = timeToMins(cleanEnd);
                            if (cMins < oMins) cMins += 1440;

                            if (oMins < minOpen) minOpen = oMins;
                            if (cMins > maxClose) maxClose = cMins;
                        }
                    }
                });
                if (minOpen < 1440) openH = Math.floor(minOpen / 60);
                if (maxClose > 0) closeH = Math.ceil(maxClose / 60) - 1;
            }
        }
        if (closeH <= openH) closeH = openH + 11; 

        const validSalesData = salesData.filter(row => {
            const hour = Number(row.sale_hour);
            return hour >= openH && hour <= closeH;
        });

        if (validSalesData.length === 0) return [];

        const todayStr = new Date().toISOString().split('T')[0];

        // Staffing-based color thresholds (10 min/tx → 6 tx/hr per employee)
        // Days view uses peak hourly avg → consistent with hours view
        const applyColorsStatistical = (arr) => {
            return arr.map(item => {
                const v = item.avgTransactions;
                let fill = '#e2e8f0';                // ≤4  muerta   — 1 persona ociosa
                if      (v > 18) fill = '#FF2D55';  // >18 crítica  — 3+ personas
                else if (v > 12) fill = '#FF9500';  // >12 pico     — 2-3 personas
                else if (v >  4) fill = '#007AFF';  // >4  normal   — 1-2 personas
                return { ...item, fill };
            });
        };

        // ====================================================================
        // VISTA: DÍAS DE LA SEMANA 
        // ====================================================================
        if (activeView === 'DAYS') {
            const hourlyByDow = {};
            const uniqueDatesMap = {};
            const salesByDow = {};

            DAYS_ORDER.forEach(d => {
                hourlyByDow[d] = {};
                uniqueDatesMap[d] = new Set();
                salesByDow[d] = 0;
            });

            validSalesData.forEach(row => {
                const d = new Date(row.sale_date + 'T00:00:00').getDay();
                const h = Number(row.sale_hour);
                if (hourlyByDow[d] !== undefined) {
                    hourlyByDow[d][h] = (hourlyByDow[d][h] || 0) + Number(row.transaction_count || 0);
                    salesByDow[d] += Number(row.total_sales || 0);
                    uniqueDatesMap[d].add(row.sale_date);
                }
            });

            // Days: color = P75 of hourly averages for that DOW (robust to single-hour outliers)
            const finalDays = DAYS_ORDER.map(d => {
                const dc = uniqueDatesMap[d].size || 1;
                const hrs = [];
                for (let h = openH; h <= closeH; h++) hrs.push(Math.round((hourlyByDow[d][h] || 0) / dc));
                hrs.sort((a, b) => a - b);
                const p75 = hrs[Math.floor(hrs.length * 0.75)] || 0;
                const avgSales = salesByDow[d] / dc;
                return { dayOfWeek: d, displayLabel: DAYS_MAP[d], avgTransactions: p75, avgSales, uniqueDates: Array.from(uniqueDatesMap[d]) };
            });

            return applyColorsStatistical(finalDays);

        } else {
            // ====================================================================
            // VISTA: HORAS GENERALES O DE UN DÍA ESPECÍFICO
            // ====================================================================
            const filteredData = activeView === 'GENERAL_HOURS'
                ? validSalesData
                : validSalesData.filter(row => new Date(row.sale_date + 'T00:00:00').getDay() === activeView);

            const uniqueDatesCount = new Set(filteredData.map(d => d.sale_date)).size || 1;
            const hourlyMap = {};

            for (let h = openH; h <= closeH; h++) {
                hourlyMap[h] = { hour: h, displayLabel: formatHourAMPM(h), totalTrans: 0, totalSales: 0, datesInHour: new Set() };
            }

            filteredData.forEach(row => {
                const h = Number(row.sale_hour);
                if (hourlyMap[h]) {
                    hourlyMap[h].totalTrans += Number(row.transaction_count || 0);
                    hourlyMap[h].totalSales += Number(row.total_sales || 0);
                    hourlyMap[h].datesInHour.add(row.sale_date);
                }
            });

            const isTodayView = timeRange === '0';

            const finalHours = Object.values(hourlyMap).map(item => {
                const dateCount = isTodayView ? 1 : uniqueDatesCount; 
                const avgTrans = isTodayView ? item.totalTrans : Math.round(item.totalTrans / dateCount);
                const avgSales = isTodayView ? item.totalSales : (item.totalSales / dateCount);

                const datesArray = Array.from(item.datesInHour);
                const tooltipDate = isTodayView ? todayStr : 
                                   (datesArray.length === 1 ? datesArray[0] : null); 

                return { ...item, avgTransactions: avgTrans, avgSales, tooltipDate };
            }).sort((a, b) => a.hour - b.hour);

            return applyColorsStatistical(finalHours);
        }
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
                dateLabel = `Datos de Hoy (${new Date().toISOString().split('T')[0]})`;
            } else if (data.uniqueDates?.length === 1 || data.tooltipDate) {
                const d = data.uniqueDates?.[0] || data.tooltipDate;
                dateLabel = `Fecha: ${d}`;
            } else if (activeView !== 'DAYS' && isHistoricalView) {
                dateLabel = `Promedio (${DAYS_MAP[activeView]} Histórico)`;
            }

            return (
                <div className="bg-slate-800/90 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-[inset_0_1px_4px_rgba(255,255,255,0.1),0_10px_30px_rgba(0,0,0,0.1)] border border-slate-700/60 w-max z-[100] animate-in fade-in duration-300 transform-gpu">
                    <p className="font-black text-[10px] uppercase tracking-widest text-slate-400 mb-1 leading-none">{branchName}</p>
                    <p className="font-extrabold text-[12px] uppercase tracking-tight text-white mb-2 pb-1.5 border-b border-slate-700">{activeView === 'DAYS' ? 'Día' : 'Hora'}: {data.displayLabel}</p>
                    
                    <div className="flex flex-col gap-2 mb-2">
                        <p className="text-[13px] font-bold flex items-center gap-2.5">
                            <Users size={16} className="text-[#FF9500]" /> 
                            {data.avgTransactions} {timeRange === '0' ? 'Tx Registradas' : 'Tx Promedio'}
                        </p>
                        <p className="text-[13px] font-bold flex items-center gap-2.5">
                            <DollarSign size={16} className="text-emerald-400" /> 
                            ${data.avgSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} 
                        </p>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-700 flex flex-col gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{dateLabel}</span>
                        {activeView === 'DAYS' && isHistoricalView && (
                            <div className="flex items-center gap-1.5 text-[#007AFF]">
                                <MousePointerClick size={12} />
                                <span className="text-[9px] font-black uppercase tracking-widest">Clic para ver horas</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full flex flex-col gap-6 animate-in fade-in duration-700">
            {/* CONTROLES SUPERIORES (HEATMAP HEADER PILL STYLE) */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white/70 backdrop-blur-xl p-3.5 sm:p-4 rounded-full border border-white/80 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] transform-gpu hover:-translate-y-0.5 transition-transform duration-500">
                <div className="w-full sm:w-auto flex items-center gap-3">
                     <div className="relative group/saly w-11 h-11 flex items-center justify-center rounded-full shrink-0 border-0 shadow-[0_0_15px_rgba(52,211,153,0.3)] hover:shadow-[0_0_25px_rgba(52,211,153,0.6)] transition-shadow duration-500">
                        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400 via-cyan-500 to-indigo-500 rounded-full opacity-30 group-hover/saly:opacity-100 transition-opacity duration-500 group-hover/saly:animate-spin [animation-duration:4s]"></div>
                        <div className="absolute inset-[1px] bg-white rounded-full border border-white/50"></div>
                        <TrendingUp size={20} strokeWidth={2.5} className="text-cyan-500 group-hover/saly:text-indigo-500 relative z-10 transition-colors duration-300" />
                    </div>
                    
                    <div className="w-full sm:w-[250px] overflow-visible group/branch hover:-translate-y-0.5 transition-transform duration-300">
                        <LiquidSelect value={selectedBranch} onChange={setSelectedBranch} options={branchOptions} clearable={false} compact icon={Building2} />
                    </div>
                </div>

                {/* FILTROS DE RANGO (PILL TABS) */}
                <div className="flex items-center bg-slate-50 rounded-full p-1 border border-slate-200/80 shadow-inner w-full sm:w-auto h-[48px] justify-between">
                    {[
                        { value: '0', label: 'Hoy' },
                        { value: '30', label: '30 Días' },
                        { value: '90', label: '3 Meses' },
                        { value: '180', label: '6 Meses' },
                        { value: '365', label: '1 Año' }
                    ].map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={(e) => { e.preventDefault(); setTimeRange(opt.value); }}
                            className={`flex-1 sm:flex-initial h-full px-4 md:px-5 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all duration-300 transform-gpu ${timeRange === opt.value ? 'bg-white text-[#007AFF] shadow-md scale-[1.02]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 border-transparent hover:-translate-y-0.5 hover:shadow-md'}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* GRÁFICA PRINCIPAL (GLASS CONTAINER) */}
            <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] p-6 border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_8px_40px_rgba(0,0,0,0.06)] relative min-h-[380px] flex flex-col transform-gpu hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_12px_60px_rgba(0,0,0,0.1)] transition-all duration-700">

                {/* CABECERA DE GRÁFICA Y CONTROLES (TABS PILL STYLE) */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="relative group/calendar w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-shadow duration-500 shadow-[0_3px_10px_rgba(0,122,255,0.15)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.3)]">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#007AFF] to-[#005CE6] rounded-full opacity-100 group-hover/calendar:scale-110 transition-transform duration-300"></div>
                            <CalendarIcon size={18} strokeWidth={2.5} className="text-white relative z-10 transition-colors duration-300" />
                        </div>
                        <h3 className="text-[16px] font-black text-slate-800 uppercase tracking-tight leading-none group-hover/branch:text-[#007AFF] transition-colors">
                            {activeView === 'DAYS' ? 'Afluencia Histórica por Día' :
                                activeView === 'GENERAL_HOURS' ? (timeRange === '0' ? 'Afluencia por Hora (Hoy)' : 'Afluencia General (Hr)') :
                                    `Afluencia por Hora - ${DAYS_MAP[activeView]}`}
                        </h3>
                    </div>

                    <div className="flex flex-col items-end gap-2.5">
                        {/* FILA 1: SEMANA | GENERAL (PILL TABS) */}
                        <div className="flex items-center bg-slate-50/70 p-1 rounded-full border border-slate-200 shadow-inner w-max">
                            {timeRange !== '0' && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); setActiveView('DAYS'); }}
                                    className={`px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${activeView === 'DAYS' ? 'bg-white text-[#007AFF] shadow-md scale-[1.02]' : 'text-slate-500 hover:text-slate-800'}`}
                                >
                                    Semana
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); setActiveView('GENERAL_HOURS'); }}
                                className={`px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${activeView === 'GENERAL_HOURS' ? 'bg-white text-[#007AFF] shadow-md scale-[1.02]' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                {timeRange === '0' ? 'Horas de Hoy' : 'General (Hr)'}
                            </button>
                        </div>

                        {/* FILA 2: L M M J V S D (Se oculta si el filtro es de hoy) (PILL TABS) */}
                        {timeRange !== '0' && (
                            <div className="flex items-center bg-slate-50/70 p-1 rounded-full border border-slate-200 shadow-inner w-max gap-0.5">
                                {DAYS_ORDER.map(d => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); setActiveView(d); }}
                                        title={DAYS_MAP[d]}
                                        className={`w-9 h-8 rounded-full text-[11px] font-black uppercase transition-all duration-300 flex items-center justify-center ${activeView === d ? 'bg-[#007AFF] text-white shadow-md scale-110 z-10' : 'text-slate-500 hover:text-slate-900 hover:bg-white/60'}`}
                                    >
                                        {['D', 'L', 'M', 'M', 'J', 'V', 'S'][d]}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 relative z-10">
                        <Loader2 size={36} strokeWidth={2.5} className="animate-spin text-[#007AFF]" />
                        <p className="text-[11px] font-black uppercase tracking-widest animate-pulse">Analizando operaciones con Sparkles...</p>
                    </div>
                ) : chartData.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-slate-400 text-[11px] font-bold uppercase tracking-widest relative z-10">
                        <Activity size={32} />
                         No hay datos de ventas registrados para este período.
                    </div>
                ) : (
                    <div className="w-full h-[280px] mt-auto relative z-10">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} transform-gpu>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                <XAxis dataKey="displayLabel" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#64748B' }} dy={12} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748B' }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Bar
                                    dataKey="avgTransactions"
                                    radius={[5, 5, 0, 0]}
                                    onClick={handleBarClick}
                                    cursor={activeView === 'DAYS' ? 'pointer' : 'default'}
                                    className="transform-gpu transition-all duration-300 hover:opacity-90"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
                
                {/* Sparkles de fondo sutiles para efecto liquidglass */}
                <div className="absolute bottom-6 right-6 text-[#FF9500]/15 pointer-events-none group-hover:scale-110 transition-transform duration-700">
                    <Sparkles size={100} strokeWidth={0.5} />
                </div>
            </div>

            {/* LEYENDA DEL HEATMAP (GLASS PILL STYLE) */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 bg-white/70 backdrop-blur-xl rounded-full py-3.5 px-6 border border-white/80 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] mt-2 transition-shadow duration-500 hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_30px_rgba(0,0,0,0.1)]">
                <div className="flex items-center gap-2.5 text-[10px] sm:text-[11px] font-extrabold text-slate-600 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#e2e8f0] shadow-sm"></div> Valle / Muerta</div>
                <div className="flex items-center gap-2.5 text-[10px] sm:text-[11px] font-extrabold text-slate-600 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#007AFF] shadow-sm"></div> Tráfico Normal</div>
                <div className="flex items-center gap-2.5 text-[10px] sm:text-[11px] font-extrabold text-slate-600 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#FF9500] shadow-sm"></div> Hora Pico (Aviso)</div>
                <div className="flex items-center gap-2.5 text-[10px] sm:text-[11px] font-extrabold text-slate-600 uppercase tracking-widest"><div className="w-3.5 h-3.5 rounded-full bg-[#FF2D55] shadow-sm"></div> Hora Crítica</div>
            </div>
        </div>
    );
};

export default memo(FormWfmAnalytics);