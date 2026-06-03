import React, { memo } from 'react';
import { TrendingUp, ChevronLeft, BarChart2 } from 'lucide-react';

const ScheduleChart = ({
    chartTitle,
    chartView,
    setChartView,
    isLoadingSales,
    currentChartData,
    openModal
}) => {
    return (
        <div className="bg-white/[0.14] backdrop-blur-2xl border border-white/60 rounded-2xl px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.85)] flex flex-col h-full hover:bg-white/[0.22] hover:shadow-[0_6px_24px_rgba(0,0,0,0.09)] transition-all duration-300 group/chart relative overflow-visible z-10">

            {/* Header: title + legend + toggle — compact single row */}
            <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-black text-slate-700 tracking-tight whitespace-nowrap">
                        <TrendingUp size={10} strokeWidth={2.5} className="text-cyan-500 shrink-0" />
                        {chartTitle}
                    </span>
                    {/* Legend inline */}
                    <div className="hidden md:flex items-center gap-2">
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#e2e8f0]" /><span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest">Muerta</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#0052CC]" /><span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest">Normal</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#F79009]" /><span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest">Pico</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-[#FF2D55]" /><span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest">Crítica</span></div>
                    </div>
                </div>

                {/* Días / Horas toggle */}
                <div className="flex items-center bg-white/60 p-0.5 rounded-full border border-white/80 shadow-[inset_0_1px_4px_rgba(0,0,0,0.03)] h-6 shrink-0">
                    {typeof chartView === 'number' && (
                        <button onClick={() => setChartView('DAYS')}
                            className="px-2 h-full text-[7.5px] font-black uppercase tracking-widest rounded-full text-slate-500 hover:text-slate-800 flex items-center gap-0.5 hover:bg-white/50 active:scale-[0.97] transition-all">
                            <ChevronLeft size={8} strokeWidth={3} />Días
                        </button>
                    )}
                    <button onClick={() => setChartView('HOURS')}
                        className={`px-2.5 h-full text-[7.5px] font-black uppercase tracking-widest rounded-full transition-all active:scale-[0.97] ${chartView === 'HOURS' ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
                        Horas
                    </button>
                    <button onClick={() => setChartView('DAYS')}
                        className={`px-2.5 h-full text-[7.5px] font-black uppercase tracking-widest rounded-full transition-all active:scale-[0.97] ${chartView === 'DAYS' ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
                        Días
                    </button>
                </div>
            </div>

            {/* Bars — flex-1 fills remaining height, no labels below (tooltips only) */}
            <div className="flex items-end gap-1.5 flex-1 w-full relative overflow-visible">
                <div className="absolute inset-0 flex flex-col justify-between opacity-15 pointer-events-none z-0">
                    <div className="border-t border-dashed border-slate-400 w-full" />
                    <div className="border-t border-dashed border-slate-400 w-full" />
                </div>

                {isLoadingSales ? (
                    <div className="absolute inset-0 flex items-end gap-1.5 z-10">
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className="flex-1 h-full flex items-end">
                                <div className="w-full skeleton rounded-t-[5px]"
                                    style={{ height: `${30 + (i % 3) * 20 + (i % 2) * 10}%` }} />
                            </div>
                        ))}
                    </div>
                ) : currentChartData.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-300 z-10">
                        <BarChart2 size={18} strokeWidth={1.5} />
                        <span className="text-[8px] font-black uppercase tracking-widest">Sin historial</span>
                    </div>
                ) : (
                    currentChartData.map((item, i) => (
                        <div key={i}
                            onClick={() => { if (chartView === 'DAYS') setChartView(item.day); }}
                            className={`flex-1 flex flex-col justify-end items-center group/bar h-full relative overflow-visible ${chartView === 'DAYS' ? 'cursor-pointer' : ''}`}>

                            {/* Tooltip */}
                            <div className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-2 py-1.5 rounded-xl shadow-xl opacity-0 group-hover/bar:opacity-100 transition-all duration-150 pointer-events-none w-max z-[100] translate-y-1 group-hover/bar:-translate-y-0 border border-white/10">
                                <p className="font-black text-[7.5px] uppercase tracking-widest text-slate-400">{item.label}</p>
                                <p className="text-[10px] font-bold flex items-center gap-1 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                                    {item.avg} Tx
                                </p>
                                {chartView === 'DAYS' && (
                                    <p className="text-[6.5px] text-[#0052CC] font-black uppercase tracking-widest mt-0.5">Clic → horas</p>
                                )}
                            </div>

                            {/* Bar */}
                            <div
                                className={`w-full transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/bar:opacity-90 group-hover/bar:shadow-sm origin-bottom z-10 ${chartView === 'DAYS' ? 'rounded-t-[5px] group-hover/bar:scale-y-[1.04]' : 'rounded-t-[4px] group-hover/bar:-translate-y-px'}`}
                                style={{ height: item.height, backgroundColor: item.color }}
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default memo(ScheduleChart);
