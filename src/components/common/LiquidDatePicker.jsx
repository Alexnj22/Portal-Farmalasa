import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAYS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 350; 

const LiquidDatePicker = ({
    value,
    onChange,
    onOpenChange,
    mode = "full",
    icon: CustomIcon,
    highlightRangeEnd = null,
    highlightRangeStart = null,
    holidays = [],
    selectedDates = []
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [currentMode, setCurrentMode] = useState(mode === 'full' ? 'days' : mode === 'month' ? 'months' : 'years');
    const [viewDate, setViewDate] = useState(new Date()); 
    const [hoverDate, setHoverDate] = useState(null); 
    
    const [dVal, setDVal] = useState('');
    const [mVal, setMVal] = useState('');
    const [yVal, setYVal] = useState('');
    
    const [coords, setCoords] = useState({ top: 0, left: 0, origin: 'origin-top' });

    const containerRef = useRef(null);
    const popoverRef = useRef(null);
    const dRef = useRef(null);
    const mRef = useRef(null);
    const yRef = useRef(null);

    useEffect(() => {
        if (value && typeof value === 'string' && value.includes('-')) {
            const parts = value.split('-');
            if (parts.length === 3) {
                setYVal(parts[0]); setMVal(parts[1]); setDVal(parts[2]);
                setViewDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
            }
        } else {
            setDVal(''); setMVal(''); setYVal('');
        }
    }, [value]);

    useEffect(() => {
        if (isOpen && !value) {
            let targetDateStr = highlightRangeStart || highlightRangeEnd;
            if (targetDateStr && targetDateStr.includes('-')) {
                const parts = targetDateStr.split('-');
                setViewDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1));
            }
        }
    }, [isOpen, value, highlightRangeStart, highlightRangeEnd]);

    useEffect(() => {
        const handleScroll = () => { setIsOpen(false); if (onOpenChange) onOpenChange(false); };
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target) &&
                containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
                if (onOpenChange) onOpenChange(false);
            }
        };
        const handleKeyDown = (event) => { if (event.key === 'Escape') { setIsOpen(false); if (onOpenChange) onOpenChange(false); } };

        if (isOpen) {
            window.addEventListener('scroll', handleScroll, true);
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown); 
        }
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown); 
        };
    }, [isOpen, onOpenChange]); 

    const openPicker = () => {
        if (!isOpen && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            let finalTop = rect.bottom + window.scrollY + 10;
            let finalLeft = rect.left + window.scrollX + (rect.width / 2);
            let transformOrigin = 'origin-top';
            let transformStyle = 'translateX(-50%)';

            if (window.innerHeight - rect.bottom < POPOVER_HEIGHT && rect.top > POPOVER_HEIGHT) {
                finalTop = rect.top + window.scrollY - POPOVER_HEIGHT - 10;
                transformOrigin = 'origin-bottom';
            }

            if (finalLeft + (POPOVER_WIDTH / 2) > window.innerWidth - 20) {
                finalLeft = rect.right + window.scrollX;
                transformStyle = 'translateX(-100%)';
            } else if (finalLeft - (POPOVER_WIDTH / 2) < 20) {
                finalLeft = rect.left + window.scrollX;
                transformStyle = 'translateX(0)';
            }

            setCoords({ top: finalTop, left: finalLeft, transform: transformStyle, origin: transformOrigin });
            
            if (yVal.length === 4 && !mVal) setCurrentMode('months');
            else if (yVal.length === 4 && mVal && !dVal) setCurrentMode('days');
            else setCurrentMode(mode === 'full' ? 'days' : mode === 'month' ? 'months' : 'years');
            
            setIsOpen(true);
            if (onOpenChange) onOpenChange(true);
        }
    };

    const checkAndEmit = (d, m, y) => {
        if (d.length === 2 && m.length === 2 && y.length === 4) {
            const dn = parseInt(d, 10); const mn = parseInt(m, 10); const yn = parseInt(y, 10);
            if (dn > 0 && dn <= 31 && mn > 0 && mn <= 12 && yn >= 1900) {
                const testDate = new Date(yn, mn - 1, dn);
                if (testDate.getFullYear() === yn && testDate.getMonth() === mn - 1 && testDate.getDate() === dn) {
                    onChange(`${y}-${m}-${d}`);
                    setIsOpen(false);
                }
            }
        } else {
            onChange('');
        }
    };

    const handleD = (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (!isOpen) openPicker();
        if (val.length >= 2) {
            const d = val.slice(0, 2); setDVal(d);
            if (val.length > 2) {
                const m = val.slice(2, 4); const y = val.slice(4, 8);
                setMVal(m); setYVal(y);
                if (y.length === 4) { checkAndEmit(d, m, y); yRef.current?.focus(); }
                else if (m.length === 2) { yRef.current?.focus(); checkAndEmit(d, m, yVal); }
                else mRef.current?.focus();
            } else {
                if (!mVal) mRef.current?.focus(); else if (!yVal) yRef.current?.focus();
                checkAndEmit(d, mVal, yVal);
            }
        } else { setDVal(val); checkAndEmit(val, mVal, yVal); }
    };

    const handleM = (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (!isOpen) openPicker();
        if (val.length >= 2) {
            const m = val.slice(0, 2); setMVal(m);
            if (!yVal) yRef.current?.focus(); else if (!dVal) dRef.current?.focus();
            if (yVal.length === 4) setViewDate(new Date(parseInt(yVal, 10), parseInt(m, 10) - 1, 1));
            checkAndEmit(dVal, m, yVal);
        } else { setMVal(val); checkAndEmit(dVal, val, yVal); }
    };

    const handleY = (e) => {
        let val = e.target.value.replace(/\D/g, '');
        const y = val.slice(0, 4); setYVal(y);
        if (y.length === 4) {
            const yn = parseInt(y, 10);
            if (yn >= 1900) {
                setViewDate(new Date(yn, mVal ? parseInt(mVal, 10) - 1 : 0, 1));
                if (!mVal) mRef.current?.focus(); else if (!dVal) dRef.current?.focus(); else checkAndEmit(dVal, mVal, y);
            }
        } else { checkAndEmit(dVal, mVal, val); }
    };

    const handleKeyDown = (e, currentVal, prevRef, nextRef) => {
        if (e.key === 'Backspace' && currentVal === '') { e.preventDefault(); prevRef?.current?.focus(); }
        if (e.key === 'ArrowRight' && e.target.selectionStart === currentVal.length) { e.preventDefault(); nextRef?.current?.focus(); }
        if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) { e.preventDefault(); prevRef?.current?.focus(); }
    };

    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();
    const startYear = Math.floor(currentYear / 10) * 10;
    const years = Array.from({ length: 12 }, (_, i) => startYear - 1 + i);

    const handleDaySelect = (day) => {
        const dd = String(day).padStart(2, '0');
        const mm = String(currentMonth + 1).padStart(2, '0');
        const yy = String(currentYear);
        setDVal(dd); setMVal(mm); setYVal(yy);
        onChange(`${yy}-${mm}-${dd}`);
        setIsOpen(false);
        if (onOpenChange) onOpenChange(false);
    };

    const handleMonthSelect = (monthIndex) => {
        setMVal(String(monthIndex + 1).padStart(2, '0')); setYVal(String(currentYear)); 
        setViewDate(new Date(currentYear, monthIndex, 1)); setCurrentMode('days'); dRef.current?.focus(); 
    };

    const handleYearSelect = (year) => {
        setYVal(String(year)); setViewDate(new Date(year, currentMonth, 1));
        setCurrentMode('months'); mRef.current?.focus(); 
    };

    const handlePrev = () => {
        if (currentMode === 'days') setViewDate(new Date(currentYear, currentMonth - 1, 1));
        else if (currentMode === 'months') setViewDate(new Date(currentYear - 1, currentMonth, 1));
        else setViewDate(new Date(currentYear - 10, currentMonth, 1));
    };
    const handleNext = () => {
        if (currentMode === 'days') setViewDate(new Date(currentYear, currentMonth + 1, 1));
        else if (currentMode === 'months') setViewDate(new Date(currentYear + 1, currentMonth, 1));
        else setViewDate(new Date(currentYear + 10, currentMonth, 1));
    };

    // 🧠 MOTORES DE SOMBREADO Y ASUETOS
    let anchorObj = null;  
    let currentValObj = null; 
    let hoverObj = hoverDate ? new Date(hoverDate.getTime()) : null;

    if (highlightRangeEnd) anchorObj = new Date(highlightRangeEnd + 'T12:00:00');
    else if (highlightRangeStart) anchorObj = new Date(highlightRangeStart + 'T12:00:00');
    if (value) currentValObj = new Date(value + 'T12:00:00');

    if (anchorObj) anchorObj.setHours(0,0,0,0);
    if (currentValObj) currentValObj.setHours(0,0,0,0);
    if (hoverObj) hoverObj.setHours(0,0,0,0);

    let drawStart = null;
    let drawEnd = null;

    if (anchorObj) {
        if (hoverObj) {
            drawStart = new Date(Math.min(anchorObj.getTime(), hoverObj.getTime()));
            drawEnd = new Date(Math.max(anchorObj.getTime(), hoverObj.getTime()));
        } else if (currentValObj) {
            drawStart = new Date(Math.min(anchorObj.getTime(), currentValObj.getTime()));
            drawEnd = new Date(Math.max(anchorObj.getTime(), currentValObj.getTime()));
        }
    }

    // 🚨 Función para buscar asuetos
    const getHolidayInfo = (day, month, year) => {
        if (!holidays || holidays.length === 0) return null;
        const mm = String(month + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const md = `${mm}-${dd}`;
        const ymd = `${year}-${mm}-${dd}`;
        
        return holidays.find(h => {
            if (h.is_recurring) return h.holiday_date.endsWith(md);
            return h.holiday_date === ymd;
        });
    };

    const popoverContent = isOpen && (
        <div
            ref={popoverRef}
            style={{ top: coords.top, left: coords.left, transform: coords.transform }}
            className={`absolute z-[99999] animate-in fade-in zoom-in-95 duration-300 ${coords.origin}`}
        >
            <div className="p-4 md:p-5 w-[280px] bg-white/70 backdrop-blur-[25px] backdrop-saturate-[200%] border border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.7)] rounded-[2rem] font-sans transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform-gpu hover:scale-[1.04] hover:-translate-y-1">
                
                <div className="flex justify-between items-center mb-5 px-1">
                    <button type="button" onClick={handlePrev} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] active:scale-95"><ChevronLeft size={16} strokeWidth={3} /></button>
                    <button type="button" onClick={() => { if (currentMode === 'days') setCurrentMode('months'); else if (currentMode === 'months') setCurrentMode('years'); }} className="text-[12px] md:text-[13px] font-black text-slate-700 uppercase tracking-widest hover:text-[#007AFF] transition-colors px-3 py-1.5 rounded-xl hover:bg-white/50 active:scale-95 disabled:opacity-50" disabled={currentMode === 'years'}>
                        {currentMode === 'days' && `${MONTHS_SHORT[currentMonth]} ${currentYear}`}
                        {currentMode === 'months' && `${currentYear}`}
                        {currentMode === 'years' && `${startYear} - ${startYear + 9}`}
                    </button>
                    <button type="button" onClick={handleNext} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] active:scale-95"><ChevronRight size={16} strokeWidth={3} /></button>
                </div>

                {currentMode === 'days' && (
                    <div className="animate-in fade-in duration-300" onMouseLeave={() => setHoverDate(null)}>
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {DAYS.map(d => <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">{d}</div>)}
                        </div>
                        
                        <div className="grid grid-cols-7 gap-y-1 gap-x-0 relative">
                            {Array.from({ length: new Date(currentYear, currentMonth, 1).getDay() }).map((_, i) => <div key={`empty-${i}`} />)}
                            
                            {Array.from({ length: new Date(currentYear, currentMonth + 1, 0).getDate() }).map((_, i) => {
                                const day = i + 1;
                                const cellDate = new Date(currentYear, currentMonth, day);
                                cellDate.setHours(0,0,0,0);
                                const cellTime = cellDate.getTime();
                                
                                const isStartBoundary = drawStart && cellTime === drawStart.getTime();
                                const isEndBoundary = drawEnd && cellTime === drawEnd.getTime();
                                const inBetween = drawStart && drawEnd && cellTime > drawStart.getTime() && cellTime < drawEnd.getTime();
                                
                                const isSolidDot = isStartBoundary || isEndBoundary || (currentValObj && cellTime === currentValObj.getTime());

                                const todayObj = new Date();
                                todayObj.setHours(0, 0, 0, 0);
                                const isToday = cellTime === todayObj.getTime();

                                // 🚨 DETECCIÓN DE ASUETO
                                const holiday = getHolidayInfo(day, currentMonth, currentYear);

                                let wrapperStyle = {};
                                if (inBetween) {
                                    wrapperStyle.backgroundColor = 'rgba(0, 122, 255, 0.20)'; 
                                } else if (drawStart && drawEnd && drawStart.getTime() !== drawEnd.getTime()) {
                                    if (isStartBoundary) wrapperStyle.background = 'linear-gradient(90deg, transparent 50%, rgba(0, 122, 255, 0.20) 50%)';
                                    if (isEndBoundary) wrapperStyle.background = 'linear-gradient(90deg, rgba(0, 122, 255, 0.20) 50%, transparent 50%)';
                                }

                                // 🎨 APLICACIÓN DE ESTILOS (Prioridad: Seleccionado > Rango > Asueto)
                                let btnClass = "w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all relative z-10 ";
                                if (isSolidDot) {
                                    btnClass += "bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.4)] scale-110";
                                } else if (inBetween) {
                                    btnClass += "text-[#007AFF] hover:bg-white hover:shadow-sm";
                                } else if (holiday) {
                                    // 🚨 Estilo de Asueto (Rojo claro)
                                    btnClass += "text-red-500 font-black bg-red-50/80 hover:bg-red-100";
                                } else {
                                    btnClass += isToday
                                        ? "text-[#007AFF] font-black hover:bg-slate-100 ring-1 ring-[#007AFF]/40"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-[#007AFF]";
                                }

                                return (
                                    <div 
                                        key={day} 
                                        className="w-full h-9 flex items-center justify-center relative cursor-pointer" 
                                        style={wrapperStyle} 
                                        onMouseEnter={() => setHoverDate(cellDate)}
                                        title={holiday ? holiday.name : undefined} // Tooltip nativo para asuetos
                                    >
                                        <button type="button" onClick={() => handleDaySelect(day)} className={btnClass}>
                                            {day}
                                        </button>
                                        {/* Puntito rojo decorativo inferior para asuetos */}
                                        {holiday && !isSolidDot && !inBetween && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-red-400"></div>
                                        )}
                                        {/* Puntito azul para hoy */}
                                        {isToday && !isSolidDot && !holiday && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-[#007AFF]"></div>
                                        )}
                                        {/* Puntito verde para días ya seleccionados (PERMISO) */}
                                        {selectedDates.includes(`${String(currentYear)}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`) && !isSolidDot && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-emerald-500"></div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {currentMode === 'months' && (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                        {MONTHS_SHORT.map((month, index) => {
                            const isSelected = mVal === String(index + 1).padStart(2, '0') && yVal === String(currentYear);
                            return <button key={month} type="button" onClick={() => handleMonthSelect(index)} className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu uppercase tracking-wide ${isSelected ? 'bg-[#007AFF] text-white shadow-lg scale-105' : 'text-slate-600 hover:bg-white hover:text-[#007AFF]'}`}>{month}</button>;
                        })}
                    </div>
                )}

                {currentMode === 'years' && (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                        {years.map((year) => {
                            const isSelected = yVal === String(year);
                            const isOutRange = year < startYear || year > startYear + 9;
                            return <button key={year} type="button" onClick={() => handleYearSelect(year)} className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu ${isSelected ? 'bg-[#007AFF] text-white shadow-lg scale-105' : isOutRange ? 'text-slate-400 opacity-50' : 'text-slate-600 hover:bg-white hover:text-[#007AFF]'}`}>{year}</button>;
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    const IconToRender = CustomIcon || CalendarIcon;
    const hasValue = dVal || mVal || yVal;

    return (
        <>
            <div ref={containerRef} className="w-full h-full flex items-center gap-1 px-3 md:px-4 rounded-xl transition-all hover:bg-white/40 group/picker min-w-[140px] cursor-text focus-within:bg-white/50" onClick={() => { if(!isOpen) openPicker(); if (!dVal) dRef.current?.focus(); else if (!mVal) mRef.current?.focus(); else if (!yVal) yRef.current?.focus(); }}>
                <IconToRender size={14} className={hasValue ? "text-[#007AFF]" : "text-slate-400 group-hover/picker:text-[#007AFF] transition-colors shrink-0 mr-1.5"} strokeWidth={2.5} />
                <div className="flex items-center flex-1">
                    <input ref={dRef} type="text" inputMode="numeric" placeholder="DD" maxLength={2} value={dVal} onChange={handleD} onKeyDown={(e) => handleKeyDown(e, dVal, null, mRef)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('days'); }} className={`w-[26px] bg-transparent border-none outline-none text-[12px] md:text-[13px] font-bold text-center placeholder:text-slate-300 ${dVal ? 'text-slate-800' : ''}`} />
                    <span className="text-slate-300 font-medium mx-0.5 pointer-events-none">/</span>
                    <input ref={mRef} type="text" inputMode="numeric" placeholder="MM" maxLength={2} value={mVal} onChange={handleM} onKeyDown={(e) => handleKeyDown(e, mVal, dRef, yRef)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('months'); }} className={`w-[28px] bg-transparent border-none outline-none text-[12px] md:text-[13px] font-bold text-center placeholder:text-slate-300 ${mVal ? 'text-slate-800' : ''}`} />
                    <span className="text-slate-300 font-medium mx-0.5 pointer-events-none">/</span>
                    <input ref={yRef} type="text" inputMode="numeric" placeholder="AAAA" maxLength={4} value={yVal} onChange={handleY} onKeyDown={(e) => handleKeyDown(e, yVal, mRef, null)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('years'); }} className={`w-[44px] bg-transparent border-none outline-none text-[12px] md:text-[13px] font-bold text-center placeholder:text-slate-300 ${yVal ? 'text-slate-800' : ''}`} />
                </div>
                {hasValue && (
                    <div role="button" onClick={(e) => { e.stopPropagation(); onChange(''); setDVal(''); setMVal(''); setYVal(''); }} className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all shrink-0 cursor-pointer" title="Borrar fecha">
                        <X size={14} strokeWidth={3} />
                    </div>
                )}
            </div>
            {isOpen && createPortal(popoverContent, document.body)}
        </>
    );
};

export default LiquidDatePicker;