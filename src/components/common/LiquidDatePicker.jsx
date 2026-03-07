import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react'; // 🚨 IMPORTAMOS LA 'X'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAYS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

const LiquidDatePicker = ({ value, onChange, placeholder = "DD/MM/AAAA", onOpenChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState('days');
    const [viewDate, setViewDate] = useState(value ? new Date(value + 'T12:00:00') : new Date());
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const buttonRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        const handleScroll = () => {
            setIsOpen(false);
            if (onOpenChange) onOpenChange(false);
        };
        const handleClickOutside = (event) => {
            if (
                popoverRef.current && !popoverRef.current.contains(event.target) &&
                buttonRef.current && !buttonRef.current.contains(event.target)
            ) {
                setIsOpen(false);
                if (onOpenChange) onOpenChange(false);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
                if (onOpenChange) onOpenChange(false);
            }
        };

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
            setCoords({
                top: rect.bottom + window.scrollY + 10,
                left: rect.left + window.scrollX + (rect.width / 2)
            });
            setViewDate(value ? new Date(value + 'T12:00:00') : new Date());
            setMode('days');
            setIsOpen(true);
            if (onOpenChange) onOpenChange(true);
        } else {
            setIsOpen(false);
            if (onOpenChange) onOpenChange(false);
        }
    };

    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

    const startYear = Math.floor(currentYear / 10) * 10;
    const years = Array.from({ length: 12 }, (_, i) => startYear - 1 + i);

    const handleDaySelect = (day) => {
        const newDate = new Date(currentYear, currentMonth, day);
        const yyyy = newDate.getFullYear();
        const mm = String(newDate.getMonth() + 1).padStart(2, '0');
        const dd = String(newDate.getDate()).padStart(2, '0');
        onChange(`${yyyy}-${mm}-${dd}`);
        setIsOpen(false);
        if (onOpenChange) onOpenChange(false);
    };

    const handleMonthSelect = (monthIndex) => {
        setViewDate(new Date(currentYear, monthIndex, 1));
        setMode('days');
    };

    const handleYearSelect = (year) => {
        setViewDate(new Date(year, currentMonth, 1));
        setMode('months');
    };

    const handlePrev = () => {
        if (mode === 'days') setViewDate(new Date(currentYear, currentMonth - 1, 1));
        if (mode === 'months') setViewDate(new Date(currentYear - 1, currentMonth, 1));
        if (mode === 'years') setViewDate(new Date(currentYear - 10, currentMonth, 1));
    };

    const handleNext = () => {
        if (mode === 'days') setViewDate(new Date(currentYear, currentMonth + 1, 1));
        if (mode === 'months') setViewDate(new Date(currentYear + 1, currentMonth, 1));
        if (mode === 'years') setViewDate(new Date(currentYear + 10, currentMonth, 1));
    };

    // 🚨 FUNCIÓN PARA LIMPIAR LA FECHA
    const handleClearDate = (e) => {
        e.stopPropagation(); // Evita que el clic abra el calendario
        onChange(''); // Envía un valor vacío al formulario
    };

    const displayValue = value ? value.split('-').reverse().join('/') : '';

    const popoverContent = isOpen && (
        <div
            ref={popoverRef}
            style={{ top: coords.top, left: coords.left, transform: 'translateX(-50%)' }}
            className="absolute p-4 md:p-5 w-[280px] bg-white/40 backdrop-blur-[10px] backdrop-saturate-[300%] border border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.1),inset_0_2px_10px_rgba(255,255,255,0.5)] rounded-[2rem] z-[9999] animate-in fade-in zoom-in-95 duration-200 origin-top font-sans"
        >
            <div className="flex justify-between items-center mb-5 px-1">
                <button type="button" onClick={handlePrev} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] hover:shadow-sm active:scale-95">
                    <ChevronLeft size={16} strokeWidth={3} />
                </button>

                <button
                    type="button"
                    onClick={() => {
                        if (mode === 'days') setMode('months');
                        if (mode === 'months') setMode('years');
                    }}
                    className="text-[12px] md:text-[13px] font-black text-slate-700 uppercase tracking-widest hover:text-[#007AFF] transition-colors px-3 py-1.5 rounded-xl hover:bg-white/50 active:scale-95"
                    disabled={mode === 'years'}
                >
                    {mode === 'days' && `${MONTHS[currentMonth]} ${currentYear}`}
                    {mode === 'months' && `${currentYear}`}
                    {mode === 'years' && `${startYear} - ${startYear + 9}`}
                </button>

                <button type="button" onClick={handleNext} className="p-2 hover:bg-white/80 rounded-full transition-colors text-slate-500 hover:text-[#007AFF] hover:shadow-sm active:scale-95">
                    <ChevronRight size={16} strokeWidth={3} />
                </button>
            </div>

            {mode === 'days' && (
                <div className="animate-in fade-in duration-300">
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {DAYS.map(d => (
                            <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">{d}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-2 gap-x-1">
                        {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const isSelected = value && parseInt(value.split('-')[2]) === day && parseInt(value.split('-')[1]) === currentMonth + 1 && parseInt(value.split('-')[0]) === currentYear;
                            const isToday = new Date().getDate() === day && new Date().getMonth() === currentMonth && new Date().getFullYear() === currentYear;

                            return (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => handleDaySelect(day)}
                                    className={`w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all transform-gpu ${isSelected
                                            ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.4)] scale-105'
                                            : isToday
                                                ? 'bg-blue-50/80 text-[#007AFF] border border-blue-200 font-black'
                                                : 'text-slate-600 hover:bg-white hover:shadow-sm hover:scale-110 hover:text-[#007AFF]'
                                        }`}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {mode === 'months' && (
                <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                    {MONTHS_SHORT.map((month, index) => {
                        const isCurrentMonth = new Date().getMonth() === index && new Date().getFullYear() === currentYear;
                        return (
                            <button
                                key={month}
                                type="button"
                                onClick={() => handleMonthSelect(index)}
                                className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu uppercase tracking-wide ${isCurrentMonth
                                        ? 'bg-blue-50/80 text-[#007AFF] border border-blue-200 shadow-sm font-black'
                                        : 'text-slate-600 hover:bg-white hover:shadow-md hover:scale-105 hover:text-[#007AFF]'
                                    }`}
                            >
                                {month}
                            </button>
                        );
                    })}
                </div>
            )}

            {mode === 'years' && (
                <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                    {years.map((year) => {
                        const isCurrentYear = new Date().getFullYear() === year;
                        const isOutRange = year < startYear || year > startYear + 9;
                        return (
                            <button
                                key={year}
                                type="button"
                                onClick={() => handleYearSelect(year)}
                                className={`py-3 rounded-2xl text-[12px] font-bold transition-all transform-gpu ${isCurrentYear
                                        ? 'bg-blue-50/80 text-[#007AFF] border border-blue-200 shadow-sm font-black'
                                        : isOutRange
                                            ? 'text-slate-400 opacity-50 hover:opacity-100 hover:bg-white/50'
                                            : 'text-slate-600 hover:bg-white hover:shadow-md hover:scale-105 hover:text-[#007AFF]'
                                    }`}
                            >
                                {year}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={openPicker}
                className="flex items-center gap-2 cursor-pointer px-3 md:px-4 py-1.5 md:py-2 rounded-xl transition-all hover:bg-white/40 group/picker active:scale-95 w-full min-w-[120px]"
            >
                <CalendarIcon size={14} className={value ? "text-[#007AFF]" : "text-slate-400 group-hover/picker:text-[#007AFF] transition-colors shrink-0"} />
                <span className={`flex-1 text-left text-[11px] md:text-[12px] font-bold ${value ? 'text-[#007AFF]' : 'text-slate-500'} uppercase tracking-wider truncate`}>
                    {displayValue || placeholder}
                </span>

                {/* 🚨 BOTÓN DE LIMPIAR (Solo aparece si hay un valor seleccionado) */}
                {value && (
                    <div 
                        role="button"
                        tabIndex={0}
                        onClick={handleClearDate}
                        className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-[#007AFF]/10 text-[#007AFF]/50 hover:text-[#007AFF] transition-all duration-200 shrink-0"
                        title="Borrar fecha"
                    >
                        <X size={14} strokeWidth={3} />
                    </div>
                )}
            </button>

            {isOpen && createPortal(popoverContent, document.body)}
        </>
    );
};

export default LiquidDatePicker;