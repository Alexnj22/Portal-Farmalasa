import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAYS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 350; 

/**
 * @param {string} mode - "full" (DD/MM/AAAA), "month" (MM/AAAA), "year" (AAAA)
 */
const LiquidDatePicker = ({ value, onChange, placeholder = "Seleccionar", onOpenChange, mode = "full" }) => {
    const [isOpen, setIsOpen] = useState(false);
    // currentMode gestiona la navegación interna (días -> meses -> años)
    const [currentMode, setCurrentMode] = useState(mode === 'full' ? 'days' : mode === 'month' ? 'months' : 'years');
    const [viewDate, setViewDate] = useState(value ? new Date(value + (value.length === 7 ? '-01' : value.length === 4 ? '-01-01' : '') + 'T12:00:00') : new Date());
    
    const [coords, setCoords] = useState({ top: 0, left: 0, origin: 'origin-top' });

    const buttonRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        const handleScroll = () => { setIsOpen(false); if (onOpenChange) onOpenChange(false); };
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target) &&
                buttonRef.current && !buttonRef.current.contains(event.target)) {
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
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
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
            
            // Al abrir, resetear la vista según el modo solicitado
            setCurrentMode(mode === 'full' ? 'days' : mode === 'month' ? 'months' : 'years');
            setIsOpen(true);
            if (onOpenChange) onOpenChange(true);
        } else {
            setIsOpen(false);
            if (onOpenChange) onOpenChange(false);
        }
    };

    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();
    const startYear = Math.floor(currentYear / 10) * 10;
    const years = Array.from({ length: 12 }, (_, i) => startYear - 1 + i);

    // --- MANEJADORES DE SELECCIÓN ---
    const handleDaySelect = (day) => {
        const mm = String(currentMonth + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        onChange(`${currentYear}-${mm}-${dd}`);
        setIsOpen(false);
        if (onOpenChange) onOpenChange(false);
    };

    const handleMonthSelect = (monthIndex) => {
        if (mode === 'month') {
            const mm = String(monthIndex + 1).padStart(2, '0');
            onChange(`${currentYear}-${mm}`);
            setIsOpen(false);
            if (onOpenChange) onOpenChange(false);
        } else {
            setViewDate(new Date(currentYear, monthIndex, 1));
            setCurrentMode('days');
        }
    };

    const handleYearSelect = (year) => {
        if (mode === 'year') {
            onChange(`${year}`);
            setIsOpen(false);
            if (onOpenChange) onOpenChange(false);
        } else {
            setViewDate(new Date(year, currentMonth, 1));
            setCurrentMode('months');
        }
    };

    const handlePrev = () => {
        if (currentMode === 'days') setViewDate(new Date(currentYear, currentMonth - 1, 1));
        if (currentMode === 'months') setViewDate(new Date(currentYear - 1, currentMonth, 1));
        if (currentMode === 'years') setViewDate(new Date(currentYear - 10, currentMonth, 1));
    };

    const handleNext = () => {
        if (currentMode === 'days') setViewDate(new Date(currentYear, currentMonth + 1, 1));
        if (currentMode === 'months') setViewDate(new Date(currentYear + 1, currentMonth, 1));
        if (currentMode === 'years') setViewDate(new Date(currentYear + 10, currentMonth, 1));
    };

    // --- FORMATEO DE EXHIBICIÓN ---
    const getDisplayText = () => {
        if (!value) return placeholder;
        const parts = value.split('-');
        if (mode === 'month') return `${MONTHS[parseInt(parts[1]) - 1]} ${parts[0]}`;
        if (mode === 'year') return value;
        return parts.reverse().join('/');
    };

    const popoverContent = isOpen && (
        <div
            ref={popoverRef}
            style={{ top: coords.top, left: coords.left, transform: coords.transform }}
            className={`absolute z-[99999] animate-in fade-in zoom-in-95 duration-300 ${coords.origin}`}
        >
            <div className="p-4 md:p-5 w-[280px] bg-white/60 backdrop-blur-[20px] backdrop-saturate-[300%] border border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.7)] rounded-[2rem] font-sans transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform-gpu hover:scale-[1.04] hover:-translate-y-1">
                
                <div className="flex justify-between items-center mb-5 px-1">
                    <button type="button" onClick={handlePrev} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] active:scale-95">
                        <ChevronLeft size={16} strokeWidth={3} />
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            if (currentMode === 'days') setCurrentMode('months');
                            else if (currentMode === 'months') setCurrentMode('years');
                        }}
                        className="text-[12px] md:text-[13px] font-black text-slate-700 uppercase tracking-widest hover:text-[#007AFF] transition-colors px-3 py-1.5 rounded-xl hover:bg-white/50 active:scale-95 disabled:opacity-50"
                        disabled={currentMode === 'years'}
                    >
                        {currentMode === 'days' && `${MONTHS[currentMonth]} ${currentYear}`}
                        {currentMode === 'months' && `${currentYear}`}
                        {currentMode === 'years' && `${startYear} - ${startYear + 9}`}
                    </button>

                    <button type="button" onClick={handleNext} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] active:scale-95">
                        <ChevronRight size={16} strokeWidth={3} />
                    </button>
                </div>

                {currentMode === 'days' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {DAYS.map(d => (
                                <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-y-2 gap-x-1">
                            {Array.from({ length: new Date(currentYear, currentMonth, 1).getDay() }).map((_, i) => <div key={`empty-${i}`} />)}
                            {Array.from({ length: new Date(currentYear, currentMonth + 1, 0).getDate() }).map((_, i) => {
                                const day = i + 1;
                                const isSelected = mode === 'full' && value && parseInt(value.split('-')[2]) === day && parseInt(value.split('-')[1]) === currentMonth + 1 && parseInt(value.split('-')[0]) === currentYear;
                                return (
                                    <button key={day} type="button" onClick={() => handleDaySelect(day)} className={`w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all transform-gpu ${isSelected ? 'bg-[#007AFF] text-white shadow-lg scale-105' : 'text-slate-600 hover:bg-white hover:text-[#007AFF]'}`}>{day}</button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {currentMode === 'months' && (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                        {MONTHS_SHORT.map((month, index) => {
                            const isSelected = mode === 'month' && value && parseInt(value.split('-')[1]) === index + 1 && parseInt(value.split('-')[0]) === currentYear;
                            return (
                                <button key={month} type="button" onClick={() => handleMonthSelect(index)} className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu uppercase tracking-wide ${isSelected ? 'bg-[#007AFF] text-white shadow-lg scale-105' : 'text-slate-600 hover:bg-white hover:text-[#007AFF]'}`}>{month}</button>
                            );
                        })}
                    </div>
                )}

                {currentMode === 'years' && (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                        {years.map((year) => {
                            const isSelected = mode === 'year' && value === String(year);
                            const isOutRange = year < startYear || year > startYear + 9;
                            return (
                                <button key={year} type="button" onClick={() => handleYearSelect(year)} className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu ${isSelected ? 'bg-[#007AFF] text-white shadow-lg scale-105' : isOutRange ? 'text-slate-400 opacity-50' : 'text-slate-600 hover:bg-white hover:text-[#007AFF]'}`}>{year}</button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <button ref={buttonRef} type="button" onClick={openPicker} className="flex items-center gap-2 cursor-pointer px-3 md:px-4 py-1.5 md:py-2 rounded-xl transition-all hover:bg-white/40 group/picker active:scale-95 w-full min-w-[120px]">
                <CalendarIcon size={14} className={value ? "text-[#007AFF]" : "text-slate-400 group-hover/picker:text-[#007AFF] transition-colors shrink-0"} />
                <span className={`flex-1 text-left text-[11px] md:text-[12px] font-bold ${value ? 'text-[#007AFF]' : 'text-slate-500'} uppercase tracking-wider truncate`}>
                    {getDisplayText()}
                </span>
                {value && <div role="button" onClick={(e) => { e.stopPropagation(); onChange(''); }} className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-[#007AFF]/10 text-[#007AFF]/50 hover:text-[#007AFF] transition-all shrink-0"><X size={14} strokeWidth={3} /></div>}
            </button>
            {isOpen && createPortal(popoverContent, document.body)}
        </>
    );
};

export default LiquidDatePicker;