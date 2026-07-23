// src/components/common/RangeDatePicker.jsx

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS_SHORT = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

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

const MonthGrid = ({ year, month, startDate, endDate, onDayMouseDown, onDayMouseUp, onDayHover, holidays, onPrev, onNext, selectedRanges = [] }) => {
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
                        className="p-1.5 hover:bg-surface-card-hover rounded-full transition-colors text-content-3 hover:text-brand">
                        <ChevronLeft size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
                <p className="text-[12px] font-black uppercase tracking-widest text-content-2">
                    {MONTHS[month]} {year}
                </p>
                {onNext ? (
                    <button type="button" onClick={onNext}
                        className="p-1.5 hover:bg-surface-card-hover rounded-full transition-colors text-content-3 hover:text-brand">
                        <ChevronRight size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
            </div>
            <div className="grid grid-cols-7 mb-2">
                {DAYS_SHORT.map(d => (
                    <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-content-3 py-1">{d}</div>
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
                                wrapBg = 'bg-gradient-to-r from-transparent to-brand/[0.12]';
                            else if (isEnd && cellDate.getTime() === rangeE.getTime())
                                wrapBg = 'bg-gradient-to-l from-transparent to-brand/[0.12]';
                            else if (inRange)
                                wrapBg = 'bg-brand/[0.12]';
                        }
                    }

                    // Rangos confirmados (multiRange)
                    const isInAnyRange = selectedRanges.some(r => dayStr > r.start && dayStr < r.end);
                    const isAnyRangeStart = selectedRanges.some(r => r.start === dayStr);
                    const isAnyRangeEnd = selectedRanges.some(r => r.end === dayStr);
                    if (!wrapBg && selectedRanges.length > 0) {
                        const isSingleSel = isAnyRangeStart && isAnyRangeEnd;
                        if (!isSingleSel) {
                            if (isAnyRangeStart) wrapBg = 'bg-gradient-to-r from-transparent to-success/[0.15]';
                            else if (isAnyRangeEnd) wrapBg = 'bg-gradient-to-l from-transparent to-success/[0.15]';
                            else if (isInAnyRange) wrapBg = 'bg-success/[0.15]';
                        }
                    }

                    let btnClass = 'w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all relative z-10 select-none ';
                    if (holiday) {
                        btnClass += 'text-danger bg-danger/10 cursor-not-allowed opacity-70';
                    } else if (isStart || isEnd) {
                        btnClass += 'bg-brand text-white shadow-[0_4px_12px_rgba(0,82,204,0.4)] scale-110 cursor-pointer';
                    } else if (isAnyRangeStart || isAnyRangeEnd) {
                        btnClass += 'bg-success text-white shadow-[0_4px_12px_rgba(18,183,106,0.4)] scale-105 cursor-pointer';
                    } else if (inRange) {
                        btnClass += 'text-brand font-black cursor-pointer hover:bg-surface-card-hover hover:shadow-sm';
                    } else if (isInAnyRange) {
                        btnClass += 'text-success font-black cursor-pointer hover:bg-surface-card-hover hover:shadow-sm';
                    } else if (isToday) {
                        btnClass += 'text-brand font-black ring-1 ring-brand/40 cursor-pointer hover:bg-surface-card-hover';
                    } else {
                        btnClass += 'text-content-2 cursor-pointer hover:bg-surface-card-hover hover:text-brand';
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
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-brand z-10" />
                            )}
                            {holiday && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-danger z-10" />
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
    label = 'período',
    multiRange = false,
    onMultiChange,
    initialRanges = [],
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selecting, setSelecting] = useState('start');
    const [rangeConfirmed, setRangeConfirmed] = useState(false);
    const [draftStart, setDraftStart] = useState(startDate || null);
    const [draftEnd, setDraftEnd] = useState(endDate || null);
    const [, setHoverDate] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [selectedRanges, setSelectedRanges] = useState(initialRanges);
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
        if (multiRange) {
            setSelectedRanges(initialRanges || []);
            setDraftStart(null);
            setDraftEnd(null);
        } else {
            setDraftStart(startDate || null);
            setDraftEnd(endDate || null);
        }
        setSelecting('start');
        setRangeConfirmed(false);
        setHoverDate(null);
        const base = startDate || (initialRanges[0]?.start);
        if (base) {
            const d = new Date(base + 'T12:00:00');
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
        if (multiRange) {
            // Click en día ya seleccionado → quitar ese rango
            if (start === end) {
                const existingIdx = selectedRanges.findIndex(r => dayStr >= r.start && dayStr <= r.end);
                if (existingIdx >= 0) {
                    const next = selectedRanges.filter((_, i) => i !== existingIdx);
                    setSelectedRanges(next);
                    onMultiChange && onMultiChange(next);
                    setDraftStart(null); setDraftEnd(null); setDragStart(null);
                    return;
                }
            }
            const hasOverlap = selectedRanges.some(r => start <= r.end && end >= r.start);
            if (hasOverlap) {
                useToastStore.getState().showToast('Fechas duplicadas', 'El período seleccionado se solapa con uno ya registrado.', 'error');
                setDraftStart(null); setDraftEnd(null); setDragStart(null); setIsDragging(false);
                return;
            }
            const next = [...selectedRanges, { start, end }];
            setSelectedRanges(next);
            onMultiChange && onMultiChange(next);
            setDraftStart(null);
            setDraftEnd(null);
        } else {
            let finalEnd = end;
            if (start === end) {
                // Click simple — auto-calcular defaultDays
                const d = new Date(start + 'T12:00:00');
                d.setDate(d.getDate() + (defaultDays - 1));
                finalEnd = d.toISOString().split('T')[0];
                onRangeChange(start, finalEnd);
            }
            setDraftStart(start);
            setDraftEnd(finalEnd);
            setRangeConfirmed(true);
        }
        setDragStart(null);
    }, [isDragging, dragStart, multiRange, selectedRanges, onMultiChange, defaultDays, onRangeChange]);

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
        if (!multiRange && draftStart && draftEnd) {
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
            <div className="fixed inset-0 z-[9998] bg-scrim backdrop-blur-[2px]" onClick={handleClose} />
            <div
                ref={popupRef}
                data-surface="dropdown"
                className="fixed z-[9999] p-6 w-[580px] max-w-[calc(100vw-32px)]"
                style={{ ...popupStyle, width: '596px', maxWidth: 'calc(100vw - 32px)' }}
                onMouseLeave={() => !rangeConfirmed && selecting === 'end' && setHoverDate(null)}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-brand/10 text-brand rounded-xl">
                            <CalendarDays size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                            <p className="text-[12px] font-black uppercase tracking-widest text-content-2">
                                {multiRange ? 'Selecciona períodos de apoyo' : (selecting === 'start' ? 'Selecciona el primer día' : 'Ajusta la fecha de fin')}
                            </p>
                            <p className="text-[10px] text-content-3 font-bold">
                                {multiRange
                                    ? (selectedRanges.length > 0 ? `${selectedRanges.length} período${selectedRanges.length !== 1 ? 's' : ''} seleccionado${selectedRanges.length !== 1 ? 's' : ''}` : 'Arrastra para seleccionar períodos')
                                    : (draftStart && draftEnd ? `${formatDisplay(draftStart)} → ${formatDisplay(draftEnd)}` : 'Haz click en el calendario')}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={handleClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-card-hover hover:bg-surface-card text-content-3 transition-colors">
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
                        selectedRanges={selectedRanges}
                    />
                    <div className="w-px bg-divider self-stretch shrink-0" />
                    <MonthGrid
                        year={secondYear} month={secondMonth}
                        startDate={draftStart} endDate={draftEnd}
                        onDayMouseDown={handleDayMouseDown}
                        onDayMouseUp={handleDayMouseUp}
                        onDayHover={handleDayHover}
                        holidays={holidays}
                        onNext={handleNext}
                        selectedRanges={selectedRanges}
                    />
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-divider flex items-center justify-between gap-3">
                    {(() => {
                        let cls = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition-all ';
                        let badgeText;
                        if (multiRange) {
                            if (selectedRanges.length === 0) {
                                cls += 'bg-surface-card-hover text-content-3 border border-divider';
                                badgeText = 'Sin períodos seleccionados';
                            } else {
                                const total = selectedRanges.reduce((sum, r) => {
                                    return sum + Math.round((new Date(r.end + 'T12:00:00') - new Date(r.start + 'T12:00:00')) / 86400000) + 1;
                                }, 0);
                                cls += 'bg-success/10 text-success border border-success/30';
                                badgeText = `✓ ${selectedRanges.length} período${selectedRanges.length !== 1 ? 's' : ''} · ${total} días`;
                            }
                        } else if (daysCount === 0) {
                            cls += 'bg-surface-card-hover text-content-3 border border-divider';
                            badgeText = 'Sin período seleccionado';
                        } else if (daysCount === defaultDays) {
                            cls += 'bg-success/10 text-success border border-success/30';
                            badgeText = `✓ ${daysCount} días de ${label}`;
                        } else if (daysCount < defaultDays) {
                            cls += 'bg-warning/10 text-warning border border-warning/30 animate-pulse';
                            badgeText = `⚠ Faltan ${defaultDays - daysCount} días (mínimo ${defaultDays})`;
                        } else {
                            cls += 'bg-warning/10 text-warning border border-warning/30 animate-pulse';
                            badgeText = `⚠ ${daysCount} días — máximo recomendado: ${defaultDays}`;
                        }
                        return <div className={cls}>{badgeText}</div>;
                    })()}
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={!multiRange && (!draftStart || !draftEnd)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition-all hover:-translate-y-0.5 active:scale-[0.97] shadow-[0_4px_12px_rgba(0,82,204,0.3)]">
                        <Check size={14} strokeWidth={3} /> {multiRange ? 'Listo' : 'Confirmar rango'}
                    </button>
                </div>
            </div>
        </>,
        document.body
    );

    return (
        <>
            <div ref={triggerRef} onClick={handleOpen} className="cursor-pointer">
                {multiRange ? (
                    <div data-surface="input" className={`flex items-center gap-2 h-[40px] px-3 transition-all ${isOpen ? 'outline outline-2 outline-brand/30' : ''}`}>
                        <CalendarDays size={14} className={selectedRanges.length > 0 ? 'text-success' : 'text-content-3'} strokeWidth={2.5} />
                        <p className={`text-[12px] font-bold ${selectedRanges.length > 0 ? 'text-content-2' : 'text-content-3'}`}>
                            {selectedRanges.length > 0
                                ? `${selectedRanges.length} período${selectedRanges.length !== 1 ? 's' : ''} seleccionado${selectedRanges.length !== 1 ? 's' : ''}`
                                : placeholder}
                        </p>
                    </div>
                ) : (
                    <div data-surface="input" className={`flex items-center gap-3 h-[48px] px-4 transition-all ${isOpen ? 'outline outline-2 outline-brand/30' : ''}`}>
                        <CalendarDays size={14} className={startDate ? 'text-brand' : 'text-content-3'} strokeWidth={2.5} />
                        <span className={`flex-1 text-[13px] font-bold truncate ${startDate && endDate ? 'text-content-2' : 'text-content-3'}`}>
                            {startDate && endDate
                                ? `${formatDisplay(startDate)} → ${formatDisplay(endDate)}`
                                : startDate
                                ? `${formatDisplay(startDate)} → selecciona fin`
                                : placeholder}
                        </span>
                        {startDate && endDate && (
                            <span className="shrink-0 text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                                {Math.round((new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86400000) + 1}d
                            </span>
                        )}
                    </div>
                )}
            </div>
            {multiRange && selectedRanges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedRanges.map((range, i) => (
                        <span key={i} className="flex items-center gap-1 px-2.5 py-1 bg-success/10 text-success border border-success/30 rounded-full text-[10px] font-bold">
                            {range.start === range.end ? formatDisplay(range.start) : `${formatDisplay(range.start)} → ${formatDisplay(range.end)}`}
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const next = selectedRanges.filter((_, idx) => idx !== i);
                                    setSelectedRanges(next);
                                    onMultiChange && onMultiChange(next);
                                }}
                                className="ml-0.5 text-success/70 hover:text-danger transition-colors font-black leading-none">×</button>
                        </span>
                    ))}
                </div>
            )}
            {popup}
        </>
    );
};

export default RangeDatePicker;
