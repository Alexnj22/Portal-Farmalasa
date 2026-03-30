// src/components/common/RangeDatePicker.jsx

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_SHORT = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

const addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
};

const formatDisplay = (dateStr) => {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

const getHolidayInfo = (day, month, year, holidays) => {
    if (!holidays?.length) return null;
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = `${mm}-${dd}`;
    const ymd = `${year}-${mm}-${dd}`;
    return holidays.find(h => h.is_recurring ? h.holiday_date.endsWith(md) : h.holiday_date === ymd) || null;
};

const MonthGrid = ({ year, month, startDate, endDate, onDayMouseDown, onDayMouseUp, onDayHover, holidays, onPrev, onNext }) => {
    const firstDay = new Date(year, month, 1).getDay();
    const offset = (firstDay + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const toStr = (d) => {
        const mm = String(month + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        return `${year}-${mm}-${dd}`;
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rangeEnd = endDate;

    return (
        <div className="flex-1 min-w-[240px]">
            <div className="flex items-center justify-between mb-4">
                {onPrev ? (
                    <button type="button" onClick={onPrev}
                        className="p-1.5 hover:bg-white/60 rounded-full transition-colors text-slate-500 hover:text-[#007AFF]">
                        <ChevronLeft size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
                <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">
                    {MONTHS[month]} {year}
                </p>
                {onNext ? (
                    <button type="button" onClick={onNext}
                        className="p-1.5 hover:bg-white/60 rounded-full transition-colors text-slate-500 hover:text-[#007AFF]">
                        <ChevronRight size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
            </div>
            <div className="grid grid-cols-7 mb-2">
                {DAYS_SHORT.map(d => (
                    <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-slate-500 py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7">
                {Array.from({ length: offset }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dayStr = toStr(day);
                    const cellDate = new Date(dayStr + 'T12:00:00');
                    cellDate.setHours(0, 0, 0, 0);
                    const holiday = getHolidayInfo(day, month, year, holidays);
                    const isStart = dayStr === startDate;
                    const isEnd = dayStr === endDate;
                    const isToday = cellDate.getTime() === today.getTime();
                    const isSingleDay = isStart && isEnd;

                    let inRange = false;
                    let wrapBg = '';
                    if (startDate && rangeEnd && startDate !== rangeEnd) {
                        const s = new Date(startDate + 'T12:00:00'); s.setHours(0, 0, 0, 0);
                        const e = new Date(rangeEnd + 'T12:00:00'); e.setHours(0, 0, 0, 0);
                        const [rangeS, rangeE] = s <= e ? [s, e] : [e, s];
                        inRange = cellDate > rangeS && cellDate < rangeE;

                        if (!isSingleDay) {
                            if (isStart && cellDate.getTime() === rangeS.getTime())
                                wrapBg = 'bg-gradient-to-r from-transparent to-blue-100';
                            else if (isEnd && cellDate.getTime() === rangeE.getTime())
                                wrapBg = 'bg-gradient-to-l from-transparent to-blue-100';
                            else if (inRange)
                                wrapBg = 'bg-blue-100';
                        }
                    }

                    let btnClass = 'w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all relative z-10 select-none ';
                    if (holiday) {
                        btnClass += 'text-red-400 bg-red-50 cursor-not-allowed opacity-70';
                    } else if (isStart || isEnd) {
                        btnClass += 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.4)] scale-110 cursor-pointer';
                    } else if (inRange) {
                        btnClass += 'text-[#007AFF] font-black cursor-pointer hover:bg-white hover:shadow-sm';
                    } else if (isToday) {
                        btnClass += 'text-[#007AFF] font-black ring-1 ring-[#007AFF]/40 cursor-pointer hover:bg-slate-100';
                    } else {
                        btnClass += 'text-slate-600 cursor-pointer hover:bg-slate-100 hover:text-[#007AFF]';
                    }

                    return (
                        <div
                            key={day}
                            className={`h-9 flex items-center justify-center relative ${wrapBg}`}
                            onMouseEnter={() => !holiday && onDayHover(dayStr)}
                        >
                            <button
                                type="button"
                                disabled={!!holiday}
                                onMouseDown={(e) => { e.preventDefault(); !holiday && onDayMouseDown(dayStr); }}
                                onMouseUp={() => !holiday && onDayMouseUp(dayStr)}
                                className={btnClass}
                                title={holiday ? holiday.name : undefined}
                            >
                                {day}
                            </button>
                            {isToday && !isStart && !isEnd && !holiday && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#007AFF] z-10" />
                            )}
                            {holiday && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-red-400 z-10" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const RangeDatePicker = ({
    startDate,
    endDate,
    onRangeChange,
    holidays = [],
    defaultDays = 15,
    placeholder = 'Seleccionar período',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selecting, setSelecting] = useState('start');
    const [rangeConfirmed, setRangeConfirmed] = useState(false);
    const [draftStart, setDraftStart] = useState(startDate || null);
    const [draftEnd, setDraftEnd] = useState(endDate || null);
    const [hoverDate, setHoverDate] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [viewYear, setViewYear] = useState(() => {
        const base = startDate ? new Date(startDate + 'T12:00:00') : new Date();
        return base.getFullYear();
    });
    const [viewMonth, setViewMonth] = useState(() => {
        const base = startDate ? new Date(startDate + 'T12:00:00') : new Date();
        return base.getMonth();
    });

    const triggerRef = useRef(null);
    const popupRef = useRef(null);
    const [popupStyle, setPopupStyle] = useState({});

    const secondMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const secondYear = viewMonth === 11 ? viewYear + 1 : viewYear;

    const handleOpen = () => {
        setDraftStart(startDate || null);
        setDraftEnd(endDate || null);
        setSelecting('start');
        setRangeConfirmed(false);
        setHoverDate(null);
        if (startDate) {
            const d = new Date(startDate + 'T12:00:00');
            setViewYear(d.getFullYear());
            setViewMonth(d.getMonth());
        } else {
            const now = new Date();
            setViewYear(now.getFullYear());
            setViewMonth(now.getMonth());
        }
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const popH = 440;
            const popW = 596;
            let top = rect.bottom + window.scrollY + 8;
            let left = rect.left + window.scrollX;
            if (rect.bottom + popH > window.innerHeight) {
                top = rect.top + window.scrollY - popH - 8;
            }
            if (left + popW > window.innerWidth) {
                left = window.innerWidth - popW - 16;
            }
            setPopupStyle({ top, left });
        }
        setIsOpen(true);
    };

    const handleDayMouseDown = useCallback((dayStr) => {
        setIsDragging(true);
        setDragStart(dayStr);
        setDraftStart(dayStr);
        setDraftEnd(dayStr);
        setRangeConfirmed(false);
        setSelecting('end');
    }, []);

    const handleDayMouseUp = useCallback((dayStr) => {
        if (!isDragging) return;
        setIsDragging(false);
        const start = dragStart <= dayStr ? dragStart : dayStr;
        const end   = dragStart <= dayStr ? dayStr   : dragStart;
        setDraftStart(start);
        setDraftEnd(end);
        setRangeConfirmed(true);
        setDragStart(null);
    }, [isDragging, dragStart]);

    const handleDayHover = useCallback((dayStr) => {
        setHoverDate(dayStr);
        if (isDragging && dragStart) {
            const start = dragStart <= dayStr ? dragStart : dayStr;
            const end   = dragStart <= dayStr ? dayStr   : dragStart;
            setDraftStart(start);
            setDraftEnd(end);
        }
    }, [isDragging, dragStart]);

    const handleConfirm = () => {
        if (draftStart && draftEnd) {
            onRangeChange(draftStart, draftEnd);
        }
        setIsOpen(false);
    };

    const handleClose = () => setIsOpen(false);

    const handlePrev = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };

    const handleNext = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => {
            if (popupRef.current && !popupRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    useEffect(() => {
        if (!isDragging) return;
        const cancel = () => { setIsDragging(false); setDragStart(null); };
        document.addEventListener('mouseup', cancel);
        return () => document.removeEventListener('mouseup', cancel);
    }, [isDragging]);

    const daysCount = draftStart && draftEnd
        ? Math.round((new Date(draftEnd + 'T12:00:00') - new Date(draftStart + 'T12:00:00')) / 86400000) + 1
        : 0;

    const popup = isOpen && createPortal(
        <>
            <div className="fixed inset-0 z-[9998] bg-slate-900/20 backdrop-blur-[2px]" onClick={handleClose} />
            <div
                ref={popupRef}
                className="fixed z-[9999] bg-white/80 backdrop-blur-md border border-white/60 rounded-[2rem] shadow-[0_20px_60px_rgba(0,0,0,0.12)] p-6 w-[580px] max-w-[calc(100vw-32px)]"
                style={{ ...popupStyle, width: '596px', maxWidth: 'calc(100vw - 32px)' }}
                onMouseLeave={() => !rangeConfirmed && selecting === 'end' && setHoverDate(null)}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-[#007AFF]/10 text-[#007AFF] rounded-xl">
                            <CalendarDays size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                            <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">
                                {selecting === 'start' ? 'Selecciona el primer día' : 'Ajusta la fecha de fin'}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold">
                                {draftStart && draftEnd
                                    ? `${formatDisplay(draftStart)} → ${formatDisplay(draftEnd)}`
                                    : 'Haz click en el calendario'}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={handleClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors">
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Calendars */}
                <div className="flex gap-4">
                    <MonthGrid
                        year={viewYear} month={viewMonth}
                        startDate={draftStart} endDate={draftEnd}
                        onDayMouseDown={handleDayMouseDown}
                        onDayMouseUp={handleDayMouseUp}
                        onDayHover={handleDayHover}
                        holidays={holidays}
                        onPrev={handlePrev}
                    />
                    <div className="w-px bg-white/30 self-stretch shrink-0" />
                    <MonthGrid
                        year={secondYear} month={secondMonth}
                        startDate={draftStart} endDate={draftEnd}
                        onDayMouseDown={handleDayMouseDown}
                        onDayMouseUp={handleDayMouseUp}
                        onDayHover={handleDayHover}
                        holidays={holidays}
                        onNext={handleNext}
                    />
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-white/30 flex items-center justify-between gap-3">
                    {(() => {
                        let cls = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition-all ';
                        let label;
                        if (daysCount === 0) {
                            cls += 'bg-slate-100/80 text-slate-400 border border-slate-200';
                            label = 'Sin período seleccionado';
                        } else if (daysCount === 15) {
                            cls += 'bg-emerald-100/80 text-emerald-700 border border-emerald-200';
                            label = '✓ 15 días de vacaciones';
                        } else if (daysCount < 15) {
                            cls += 'bg-orange-100/80 text-orange-600 border border-orange-200 animate-pulse';
                            label = `⚠ Faltan ${15 - daysCount} días (mínimo 15)`;
                        } else {
                            cls += 'bg-orange-100/80 text-orange-600 border border-orange-200 animate-pulse';
                            label = `⚠ ${daysCount} días — máximo recomendado: 15`;
                        }
                        return <div className={cls}>{label}</div>;
                    })()}
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={!draftStart || !draftEnd}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] hover:bg-[#005CE6] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition-all hover:-translate-y-0.5 active:scale-95 shadow-[0_4px_12px_rgba(0,122,255,0.3)]">
                        <Check size={14} strokeWidth={3} /> Confirmar rango
                    </button>
                </div>
            </div>
        </>,
        document.body
    );

    return (
        <>
            <div ref={triggerRef} className="flex gap-2 cursor-pointer" onClick={handleOpen}>
                <div className={`flex-1 flex items-center gap-2 h-[40px] px-3 bg-white/50 border rounded-[1rem] transition-all hover:bg-white/80 hover:border-[#007AFF]/40 ${isOpen ? 'border-[#007AFF]/50 ring-4 ring-[#007AFF]/10' : 'border-white/80'}`}>
                    <CalendarDays size={14} className={startDate ? 'text-[#007AFF]' : 'text-slate-400'} strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5">Inicio</p>
                        <p className={`text-[12px] font-bold truncate ${startDate ? 'text-slate-700' : 'text-slate-400'}`}>
                            {startDate ? formatDisplay(startDate) : 'DD/MM/AAAA'}
                        </p>
                    </div>
                </div>
                <div className={`flex-1 flex items-center gap-2 h-[40px] px-3 bg-white/50 border rounded-[1rem] transition-all hover:bg-white/80 hover:border-[#007AFF]/40 ${isOpen ? 'border-[#007AFF]/50 ring-4 ring-[#007AFF]/10' : 'border-white/80'}`}>
                    <CalendarDays size={14} className={endDate ? 'text-[#007AFF]' : 'text-slate-400'} strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5">Fin</p>
                        <p className={`text-[12px] font-bold truncate ${endDate ? 'text-slate-700' : 'text-slate-400'}`}>
                            {endDate ? formatDisplay(endDate) : 'DD/MM/AAAA'}
                        </p>
                    </div>
                </div>
            </div>
            {popup}
        </>
    );
};

export default RangeDatePicker;
