import React, { memo } from 'react';
import { TrendingUp, Maximize2, ChevronLeft, Loader2, BarChart2 } from 'lucide-react';

const ScheduleChart = ({
    chartTitle,
    chartView,
    setChartView,
    isLoadingSales,
    currentChartData,
    filterBranch,
    branches,
    openModal
}) => {
    return (
        <div className="col-span-1 lg:col-span-2 bg-white/40 backdrop-blur-3xl backdrop-saturate-[180%] border border-white/80 rounded-[2rem] p-4 shadow-[inset_0_2px_15px_rgba(255,255,255,0.7),0_10px_40px_rgba(0,0,0,0.05)] flex flex-col justify-between hover:shadow-[0_15px_50px_rgba(0,0,0,0.08)] transition-all duration-300 group/chart relative overflow-visible min-h-[180px] z-10">
            
            <div className="absolute top-3 right-3 opacity-0 group-hover/chart:opacity-100 transition-opacity duration-200 z-20">
                <button onClick={() => openModal && openModal("viewWfmAnalytics")} className="w-7 h-7 rounded-full bg-white/90 backdrop-blur-md text-[#007AFF] border border-blue-100 shadow-md flex items-center justify-center hover:bg-blue-50 hover:scale-105 active:scale-95 transition-all duration-200" title="Expandir Análisis">
                    <Maximize2 size={12} strokeWidth={2.5} />
                </button>
            </div>

            <div className="flex items-center justify-between mb-4 pr-10 relative z-10">
                <h3 className="text-[13px] font-black text-slate-800 tracking-tight flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-cyan-50 text-cyan-600 flex items-center justify-center shadow-sm border border-cyan-100/50">
                        <TrendingUp size={12} strokeWidth={2.5} />
                    </div>
                    {chartTitle}
                </h3>

                <div className="flex items-center bg-white/60 p-0.5 rounded-full border border-white shadow-[inset_0_1px_4px_rgba(0,0,0,0.03)] h-7">
                    {typeof chartView === 'number' && (
                        <button onClick={() => setChartView('DAYS')} className="px-2.5 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full transition-all duration-200 text-slate-500 hover:text-slate-800 flex items-center gap-1 hover:bg-white/50 active:scale-95">
                            <ChevronLeft size={10} strokeWidth={3} /> Volver a Días
                        </button>
                    )}
                    <button onClick={() => setChartView('HOURS')} className={`px-3 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full transition-all duration-200 active:scale-95 ${chartView === 'HOURS' ? 'bg-white text-[#007AFF] shadow-sm scale-[1.02]' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>Horas</button>
                    <button onClick={() => setChartView('DAYS')} className={`px-3 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full transition-all duration-200 active:scale-95 ${chartView === 'DAYS' ? 'bg-white text-[#007AFF] shadow-sm scale-[1.02]' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>Días</button>
                </div>
            </div>

            <div className="flex flex-col w-full border-b border-slate-200/60 pb-1.5 relative z-10 flex-1 mt-4">
                {/* 🚨 Aseguramos overflow-visible aquí también para el tooltip */}
                <div className="flex items-end gap-1.5 h-[80px] w-full relative overflow-visible">
                    <div className="absolute inset-0 flex flex-col justify-between opacity-20 pointer-events-none z-0 pb-[1px]">
                        <div className="border-t border-dashed border-slate-400 w-full h-px"></div>
                        <div className="border-t border-dashed border-slate-400 w-full h-px"></div>
                    </div>
                    
                    {isLoadingSales ? (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                            <Loader2 size={20} className="animate-spin text-[#007AFF]" />
                        </div>
                    ) : currentChartData.length === 0 ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 p-4 text-center animate-in fade-in duration-300">
                            <BarChart2 size={24} strokeWidth={1.5} className="text-slate-300" />
                            <p className="text-[9px] md:text-[10px] font-black text-[#007AFF]/60 uppercase tracking-widest leading-snug">Sin historial de ventas</p>
                        </div>
                    ) : (
                        currentChartData.map((item, i) => (
                            <div
                                key={i}
                                onClick={() => { if (chartView === 'DAYS') setChartView(item.day); }}
                                className={`flex-1 flex flex-col justify-end items-center group relative h-full overflow-visible ${chartView === 'DAYS' ? 'cursor-pointer' : ''}`}
                            >
                                {/* 🚨 Tooltip blindado: z-[100] y position adjustment */}
                                <div className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-2.5 py-1.5 rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none w-max z-[100] translate-y-2 group-hover:-translate-y-1 flex flex-col items-center border border-white/10">
                                    <p className="font-black text-[8px] uppercase tracking-widest text-slate-400 mb-1 border-b border-white/10 pb-0.5 px-2">{chartView === 'DAYS' ? 'Día' : 'Hora'}: {item.label}</p>
                                    <p className="text-[11px] font-bold flex items-center gap-1.5 mt-0.5">
                                        <span className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: item.color }}></span>
                                        {item.avg} Tx / Promedio
                                    </p>
                                    {chartView === 'DAYS' && (
                                        <p className="text-[7px] text-[#007AFF] font-black uppercase tracking-widest mt-1 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Clic para ver horas</p>
                                    )}
                                </div>

                                <div
                                    className={`w-full transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu group-hover:opacity-80 group-hover:shadow-md origin-bottom shadow-sm z-10 ${chartView === 'DAYS' ? 'rounded-t-[6px] group-hover:scale-y-[1.05]' : 'rounded-t-[4px] group-hover:-translate-y-[2px]'}`}
                                    style={{ height: item.height, backgroundColor: item.color }}
                                ></div>
                                
                                <span className="text-[7px] md:text-[7.5px] font-bold text-slate-400 mt-1 absolute -bottom-4 opacity-80 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:text-cyan-500 transition-all duration-200 whitespace-nowrap z-10">
                                    {item.label}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4 justify-center md:justify-start relative z-10">
                <div className="flex items-center gap-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest"><div className="w-2 h-2 rounded-full bg-[#e2e8f0]"></div> Muerta</div>
                <div className="flex items-center gap-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest"><div className="w-2 h-2 rounded-full bg-[#007AFF]"></div> Normal</div>
                <div className="flex items-center gap-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest"><div className="w-2 h-2 rounded-full bg-[#FF9500]"></div> Pico</div>
                <div className="flex items-center gap-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest"><div className="w-2 h-2 rounded-full bg-[#FF2D55]"></div> Crítica</div>
            </div>
        </div>
    );
};

export default memo(ScheduleChart);