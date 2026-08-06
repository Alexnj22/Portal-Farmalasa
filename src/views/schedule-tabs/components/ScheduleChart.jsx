import React, { memo } from 'react';
import Button from '../../../components/common/Button';
import { TrendingUp, ChevronLeft, BarChart2, Maximize2 } from 'lucide-react';
import SegmentedControl from '../../../components/common/SegmentedControl';
import { clickable } from '../../../utils/clickable';

const ScheduleChart = ({
    chartTitle,
    chartView,
    setChartView,
    isLoadingSales,
    currentChartData,
    openModal
}) => {
    return (
        <div data-surface="card" className="border border-border-card rounded-2xl px-4 py-1.5 shadow-[var(--shadow-glass-1)] flex flex-col h-full min-h-[80px] hover:shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-slow)] group/chart relative overflow-visible z-base">

            {/* Header: title + legend + toggle — compact single row */}
            <div className="flex items-center justify-between gap-3 mb-0.5 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-black text-content-2 tracking-tight whitespace-nowrap">
                        <TrendingUp size={10} strokeWidth={2.5} className="text-chart-9-text shrink-0" />
                        {chartTitle}
                    </span>
                    {/* Legend inline */}
                    <div className="hidden md:flex items-center gap-2">
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-txvol-muerta" /><span className="text-[6.5px] font-bold text-content-2 uppercase tracking-widest">Muerta</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-txvol-normal" /><span className="text-[6.5px] font-bold text-content-2 uppercase tracking-widest">Normal</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-txvol-pico" /><span className="text-[6.5px] font-bold text-content-2 uppercase tracking-widest">Pico</span></div>
                        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-txvol-critica" /><span className="text-[6.5px] font-bold text-content-2 uppercase tracking-widest">Crítica</span></div>
                    </div>
                </div>

                {/* Días / Horas toggle + expand (inline, no overlap) */}
                <div className="flex items-center gap-1 shrink-0">
                    <div className="flex items-center bg-surface-card p-0.5 rounded-full border border-border-card shadow-[var(--shadow-shine)] h-6">
                        {typeof chartView === 'number' && (
                            <Button variant="secondary" icon={ChevronLeft} onClick={() => setChartView('DAYS')}>Días</Button>
                        )}
                        <SegmentedControl
                            label="Escala del gráfico"
                            size="sm"
                            tone="neutro"
                            value={chartView}
                            onChange={setChartView}
                            options={[{ value: 'HOURS', label: 'Horas' }, { value: 'DAYS', label: 'Días' }]}
                        />
                    </div>
                    <div className="opacity-0 group-hover/chart:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-base)]">
                        <Button tone="chart-1" size="xs" icon={Maximize2} title="Expandir Análisis" iconOnly onClick={() => openModal && openModal('viewWfmAnalytics')} />
                    </div>
                </div>
            </div>

            {/* Bars — flex-1, labels inside each bar */}
            <div className="flex items-end gap-[3px] flex-1 w-full relative overflow-visible">
                <div className="absolute inset-0 flex flex-col justify-between opacity-15 pointer-events-none z-0">
                    <div className="border-t border-dashed border-divider w-full" />
                    <div className="border-t border-dashed border-divider w-full" />
                </div>

                {isLoadingSales ? (
                    <div className="absolute inset-0 flex items-end gap-1.5 z-base">
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className="flex-1 h-full flex items-end">
                                <div className="w-full skeleton rounded-t-[5px]"
                                    style={{ height: `${30 + (i % 3) * 20 + (i % 2) * 10}%` }} />
                            </div>
                        ))}
                    </div>
                ) : currentChartData.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-content-3 z-base">
                        <BarChart2 size={18} strokeWidth={1.5} />
                        <span className="text-micro font-black uppercase tracking-widest">Sin historial</span>
                    </div>
                ) : (
                    currentChartData.map((item, i) => (
                        <div key={i}
                            {...clickable(() => { if (chartView === 'DAYS') setChartView(item.day); })}
                            className={`flex-1 flex flex-col justify-end items-center group/bar h-full relative overflow-visible ${chartView === 'DAYS' ? 'cursor-pointer' : ''}`}>

                            {/* Tooltip */}
                            <div data-surface="tooltip" className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 px-2 py-1.5 opacity-0 group-hover/bar:opacity-100 focus-within:opacity-100 transition-all duration-[var(--dur-fast)] pointer-events-none w-max z-modal translate-y-1 group-hover/bar:-translate-y-0">
                                <p className="font-black text-micro uppercase tracking-widest text-content-tooltip-2">{item.label}</p>
                                <p className="text-caption font-bold flex items-center gap-1 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                                    {item.avg} Tx
                                </p>
                                {chartView === 'DAYS' && (
                                    <p className="text-[6.5px] text-brand-text font-black uppercase tracking-widest mt-0.5">Clic → horas</p>
                                )}
                            </div>

                            {/* Bar with label inside */}
                            <div
                                className={`relative w-full transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] group-hover/bar:opacity-90 group-hover/bar:shadow-sm origin-bottom z-base overflow-hidden ${chartView === 'DAYS' ? 'rounded-t-[5px] group-hover/bar:scale-y-[1.04]' : 'rounded-t-[4px] group-hover/bar:-translate-y-px'}`}
                                style={{ height: item.height, backgroundColor: item.color }}>
                                <span className="absolute bottom-0.5 inset-x-0 text-center text-micro font-black text-white/90 leading-none pointer-events-none">
                                    {item.label}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default memo(ScheduleChart);
