import React, { memo } from 'react';
import { TrendingUp, Maximize2, ChevronLeft, ArrowRight, Loader2, BarChart2, Building2, Save, CheckCircle, X } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect';

const WEEK_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const fmtWeek = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const s = new Date(y, m - 1, d);
    const e = new Date(y, m - 1, d + 6);
    const d1 = String(s.getDate()).padStart(2,'0'), m1 = WEEK_MONTHS[s.getMonth()];
    const d2 = String(e.getDate()).padStart(2,'0'), m2 = WEEK_MONTHS[e.getMonth()];
    return m1 !== m2 ? `${d1} ${m1} – ${d2} ${m2}` : `${d1}–${d2} ${m1}`;
};

const LEGEND = [
    { color: '#cbd5e1', label: 'Muerta' },
    { color: '#0052CC', label: 'Normal' },
    { color: '#F79009', label: 'Pico'   },
    { color: '#FF2D55', label: 'Crítica'},
];

const ScheduleChart = ({
    chartView, setChartView,
    isLoadingSales,
    currentChartData,
    filterBranch, setFilterBranch,
    validBranches,
    startDate, changeWeek, isDefaultWeek,
    handleResetFilters,
    canPublish,
    weekIsPublished, isPublishing, isPastWeek, hasEmployees,
    onPublish,
    openModal,
}) => {
    const isSpecificDay = typeof chartView === 'number';
    const showEveryOther = chartView === 'HOURS' && currentChartData.length > 10;

    return (
        <div className="group/chart bg-white/[0.14] backdrop-blur-2xl border border-white/60 rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white/[0.20] hover:shadow-[0_6px_24px_rgba(0,0,0,0.09)] transition-all duration-300 relative overflow-visible">

            {/* Shimmer top edge */}
            <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none z-10 rounded-t-2xl">
                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent animate-shimmer"
                    style={{ animationDuration: '4s' }} />
            </div>

            {/* ── Header ── */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-wrap relative z-10">

                {/* Left: icon + title + view toggle */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-5 h-5 rounded-full bg-cyan-50 border border-cyan-100/60 text-cyan-600 flex items-center justify-center shrink-0">
                        <TrendingUp size={10} strokeWidth={2.5} />
                    </div>
                    <span className="text-[10.5px] font-black text-slate-700 tracking-tight whitespace-nowrap">
                        {isSpecificDay
                            ? `Horas · ${currentChartData[0] ? (currentChartData[0].label?.slice(0,-1) || '') : ''}`
                            : 'Tx promedio · últimos 3 meses'}
                    </span>

                    {/* Días / Horas toggle */}
                    <div className="flex items-center bg-white/50 border border-white/70 rounded-full p-0.5 h-[22px] ml-1 shrink-0">
                        {isSpecificDay && (
                            <button onClick={() => setChartView('DAYS')}
                                className="px-1.5 h-full text-[7px] font-black uppercase tracking-widest rounded-full text-slate-500 hover:text-slate-800 hover:bg-white/60 flex items-center gap-0.5 transition-all active:scale-[0.97]">
                                <ChevronLeft size={7} strokeWidth={3} />Días
                            </button>
                        )}
                        <button onClick={() => setChartView('DAYS')}
                            className={`px-2 h-full text-[7px] font-black uppercase tracking-widest rounded-full transition-all active:scale-[0.97]
                                ${chartView === 'DAYS' ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
                            Días
                        </button>
                        <button onClick={() => setChartView('HOURS')}
                            className={`px-2 h-full text-[7px] font-black uppercase tracking-widest rounded-full transition-all active:scale-[0.97]
                                ${chartView === 'HOURS' ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
                            Horas
                        </button>
                    </div>
                </div>

                {/* Right: branch | week nav | publish | expand */}
                <div className="flex items-center shrink-0 gap-0">

                    {/* Branch selector */}
                    <div className="px-1 overflow-visible">
                        <LiquidSelect
                            value={filterBranch} onChange={setFilterBranch}
                            options={(validBranches || []).map(b => ({ value: String(b.id), label: b.name }))}
                            compact clearable={false} icon={Building2} bare
                        />
                    </div>

                    <div className="h-4 w-px bg-white/50 shrink-0 mx-0.5" />

                    {/* Week navigator */}
                    <div className="group/week flex items-center overflow-visible cursor-default">
                        <div className="w-0 opacity-0 overflow-hidden group-hover/week:w-6 group-hover/week:opacity-100 group-hover/week:ml-0.5 transition-all duration-300">
                            <button onClick={() => changeWeek(-7)}
                                className="w-5 h-5 rounded-full flex items-center justify-center text-slate-500 hover:bg-white/70 active:scale-[0.97] transition-all">
                                <ChevronLeft size={11} strokeWidth={2.5} />
                            </button>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 whitespace-nowrap">
                            <span className={`text-[6px] font-black uppercase tracking-[0.18em] leading-none mb-0.5 ${!isDefaultWeek ? 'text-amber-500' : 'text-slate-500'}`}>
                                {!isDefaultWeek ? 'Filtrada' : 'Semana actual'}
                            </span>
                            <span className={`text-[9.5px] font-black uppercase tracking-tight leading-none ${!isDefaultWeek ? 'text-amber-600' : 'text-slate-800'}`}>
                                {fmtWeek(startDate)}
                            </span>
                        </div>
                        <div className="w-0 opacity-0 overflow-hidden group-hover/week:w-6 group-hover/week:opacity-100 group-hover/week:mr-0.5 transition-all duration-300">
                            <button onClick={() => changeWeek(7)}
                                className="w-5 h-5 rounded-full flex items-center justify-center text-slate-500 hover:bg-white/70 active:scale-[0.97] transition-all">
                                <ArrowRight size={11} strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>

                    {/* Reset week */}
                    {!isDefaultWeek && (
                        <>
                            <div className="h-4 w-px bg-white/50 shrink-0 mx-0.5" />
                            <button onClick={handleResetFilters} title="Volver a semana actual"
                                className="mx-1 w-5 h-5 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        </>
                    )}

                    {/* Publish */}
                    {canPublish && (
                        <>
                            <div className="h-4 w-px bg-white/50 shrink-0 mx-0.5" />
                            <button
                                onClick={weekIsPublished ? undefined : onPublish}
                                disabled={isPublishing || !hasEmployees || isPastWeek}
                                className={`mx-1.5 flex items-center gap-1 px-2.5 py-1 rounded-full text-[8.5px] font-black uppercase tracking-widest transition-all duration-200 shrink-0 border
                                    ${weekIsPublished
                                        ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-700 cursor-default'
                                        : 'bg-[#0052CC] border-[#003D99]/60 text-white shadow-[0_2px_8px_rgba(0,82,204,0.35)] hover:bg-[#003D99] hover:shadow-[0_4px_14px_rgba(0,82,204,0.5)] hover:scale-105 active:scale-[0.97]'}
                                    ${(!hasEmployees || isPastWeek) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                {isPublishing
                                    ? <Loader2 size={9} strokeWidth={3} className="animate-spin" />
                                    : weekIsPublished
                                        ? <CheckCircle size={9} strokeWidth={2.5} />
                                        : <Save size={9} strokeWidth={2.5} />}
                                <span className="hidden sm:inline">
                                    {isPublishing ? '...' : weekIsPublished ? 'Publicado' : 'Publicar'}
                                </span>
                            </button>
                        </>
                    )}

                    {/* Expand */}
                    <div className="ml-1 opacity-0 group-hover/chart:opacity-100 transition-opacity duration-200">
                        <button onClick={() => openModal?.('viewWfmAnalytics')}
                            className="w-5 h-5 rounded-full bg-white/80 text-[#0052CC] border border-blue-100 shadow-sm flex items-center justify-center hover:bg-blue-50 hover:scale-105 transition-all">
                            <Maximize2 size={9} strokeWidth={2.5} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Heatmap ── */}
            <div className="px-4 pb-3 relative z-10">
                {isLoadingSales ? (
                    <div className="flex items-center gap-[3px] h-[44px]">
                        {Array.from({ length: chartView === 'DAYS' ? 7 : 11 }).map((_, i) => (
                            <div key={i} className="flex-1 skeleton rounded-md h-[28px]" style={{ animationDelay: `${i * 0.05}s` }} />
                        ))}
                    </div>
                ) : currentChartData.length === 0 ? (
                    <div className="flex items-center justify-center h-[44px] gap-2 text-slate-300">
                        <BarChart2 size={14} strokeWidth={1.5} />
                        <span className="text-[8.5px] font-black uppercase tracking-widest">Sin historial de ventas</span>
                    </div>
                ) : (
                    <div className="flex items-end gap-[3px] overflow-visible">
                        {currentChartData.map((item, i) => {
                            const bg = item.avg === 0 ? '#cbd5e1' : item.color;
                            const op = item.avg === 0 ? 0.45 : 0.88;
                            const showLabel = !showEveryOther || i % 2 === 0;
                            return (
                                <div key={i}
                                    onClick={chartView === 'DAYS' && typeof item.day !== 'undefined' ? () => setChartView(item.day) : undefined}
                                    className={`flex-1 flex flex-col items-center gap-[3px] group/cell relative overflow-visible
                                        ${chartView === 'DAYS' ? 'cursor-pointer' : 'cursor-default'}`}>

                                    {/* Tooltip */}
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-2 py-1.5 rounded-xl shadow-xl opacity-0 group-hover/cell:opacity-100 transition-all duration-150 pointer-events-none w-max z-[100] translate-y-1 group-hover/cell:translate-y-0 border border-white/10">
                                        <p className="text-[7.5px] font-black uppercase tracking-wider text-slate-400">{item.label}</p>
                                        <p className="text-[10px] font-bold flex items-center gap-1 mt-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: bg }} />
                                            {item.avg} Tx promedio
                                        </p>
                                        {chartView === 'DAYS' && (
                                            <p className="text-[6.5px] text-[#0052CC] font-black uppercase tracking-widest mt-0.5">Clic → ver horas</p>
                                        )}
                                    </div>

                                    {/* Heatmap cell */}
                                    <div
                                        className="w-full rounded-[5px] transition-all duration-200 group-hover/cell:scale-y-[1.12] group-hover/cell:opacity-100 origin-bottom"
                                        style={{ height: '28px', backgroundColor: bg, opacity: op }}
                                    />

                                    {/* Label */}
                                    <span className={`text-[6px] font-bold text-slate-400 leading-none transition-colors group-hover/cell:text-slate-600 ${showLabel ? '' : 'invisible'}`}>
                                        {item.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Legend */}
                <div className="flex items-center gap-3 mt-2.5">
                    {LEGEND.map(l => (
                        <div key={l.label} className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                            <span className="text-[6.5px] font-bold text-slate-400 uppercase tracking-widest">{l.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default memo(ScheduleChart);
