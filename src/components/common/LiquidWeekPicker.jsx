import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAY_HEADERS  = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const POPOVER_W    = 272;
const POPOVER_H    = 340;

const getMonday = (date) => {
    const d   = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * LiquidWeekPicker
 * Props:
 *   selectedWeekStart  Date  — Monday of the currently selected week
 *   onChange           fn    — called with the Monday Date of the picked week
 *   children                 — trigger element (rendered inside a clickable wrapper)
 */
const LiquidWeekPicker = ({ selectedWeekStart, onChange, children }) => {
    const [isOpen,    setIsOpen]    = useState(false);
    const [viewDate,  setViewDate]  = useState(() => selectedWeekStart ? new Date(selectedWeekStart) : new Date());
    const [hoverWeek, setHoverWeek] = useState(null);
    const [coords,    setCoords]    = useState({ top: 0, left: 0, transform: 'translateX(-50%)', origin: 'origin-top' });

    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (selectedWeekStart) setViewDate(new Date(selectedWeekStart));
    }, [selectedWeekStart]);

    useEffect(() => {
        if (!isOpen) return;
        const onOutside = (e) => {
            if (!popoverRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target))
                setIsOpen(false);
        };
        const onScroll = () => setIsOpen(false);
        const onKey    = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onOutside);
        window.addEventListener('scroll', onScroll, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onOutside);
            window.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    const openPicker = () => {
        if (!triggerRef.current) return;
        const rect  = triggerRef.current.getBoundingClientRect();
        let top     = rect.bottom + window.scrollY + 8;
        let left    = rect.left   + window.scrollX + rect.width / 2;
        let transform = 'translateX(-50%)';
        let origin    = 'origin-top';

        if (window.innerHeight - rect.bottom < POPOVER_H && rect.top > POPOVER_H) {
            top    = rect.top + window.scrollY - POPOVER_H - 8;
            origin = 'origin-bottom';
        }
        if (left + POPOVER_W / 2 > window.innerWidth - 20) {
            left      = rect.right + window.scrollX;
            transform = 'translateX(-100%)';
        } else if (left - POPOVER_W / 2 < 20) {
            left      = rect.left + window.scrollX;
            transform = 'translateX(0)';
        }

        setCoords({ top, left, transform, origin });
        setIsOpen(v => !v);
    };

    const selectWeek = (anyDateInWeek) => {
        onChange(getMonday(anyDateInWeek));
        setIsOpen(false);
    };

    const month      = viewDate.getMonth();
    const year       = viewDate.getFullYear();
    const firstDay   = new Date(year, month, 1).getDay();           // 0=Dom
    const offset     = firstDay === 0 ? 6 : firstDay - 1;           // Mon-start offset
    const daysInMon  = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((offset + daysInMon) / 7) * 7;

    const cells = Array.from({ length: totalCells }, (_, i) => {
        const n = i - offset + 1;
        return (n >= 1 && n <= daysInMon) ? new Date(year, month, n) : null;
    });

    const todayT    = (() => { const t = new Date(); t.setHours(0,0,0,0); return t.getTime(); })();
    const selMonday = selectedWeekStart ? getMonday(selectedWeekStart) : null;
    const todMonday = getMonday(new Date());

    const sameWeek = (mondayA, mondayB) =>
        mondayA && mondayB && mondayA.getTime() === mondayB.getTime();

    const popover = (
        <div
            ref={popoverRef}
            style={{ position: 'absolute', top: coords.top, left: coords.left, transform: coords.transform, zIndex: 99999 }}
            className={`animate-in fade-in zoom-in-95 duration-200 ${coords.origin}`}
        >
            <div className="p-4 w-[272px] bg-white/80 backdrop-blur-[28px] backdrop-saturate-[200%] border border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.7)] rounded-[2rem]">

                {/* ── Header mes ── */}
                <div className="flex items-center justify-between mb-3 px-1">
                    <button type="button"
                        onClick={() => setViewDate(new Date(year, month - 1, 1))}
                        className="p-1.5 hover:bg-white/80 rounded-full text-slate-500 transition-all active:scale-90">
                        <ChevronLeft size={14} strokeWidth={3} />
                    </button>
                    <span className="text-[12px] font-black text-slate-700 uppercase tracking-widest">
                        {MONTHS_SHORT[month]} {year}
                    </span>
                    <button type="button"
                        onClick={() => setViewDate(new Date(year, month + 1, 1))}
                        className="p-1.5 hover:bg-white/80 rounded-full text-slate-500 transition-all active:scale-90">
                        <ChevronRight size={14} strokeWidth={3} />
                    </button>
                </div>

                {/* ── Cabeceras días ── */}
                <div className="grid grid-cols-7 mb-1">
                    {DAY_HEADERS.map(d => (
                        <div key={d} className="text-center text-[9px] font-black text-slate-400 uppercase tracking-wider py-1">
                            {d}
                        </div>
                    ))}
                </div>

                {/* ── Filas de semanas ── */}
                <div className="space-y-0.5" onMouseLeave={() => setHoverWeek(null)}>
                    {Array.from({ length: totalCells / 7 }, (_, wi) => {
                        const row       = cells.slice(wi * 7, wi * 7 + 7);
                        const firstCell = row.find(c => c !== null);
                        if (!firstCell) return null;
                        const rowMonday = getMonday(firstCell);
                        const isHov     = sameWeek(rowMonday, hoverWeek);
                        const isSel     = sameWeek(rowMonday, selMonday);
                        const isNow     = sameWeek(rowMonday, todMonday);

                        return (
                            <div key={wi}
                                className={`grid grid-cols-7 rounded-xl cursor-pointer transition-all duration-150 ${
                                    isSel ? 'bg-slate-800 shadow-[0_4px_12px_rgba(0,0,0,0.2)]' :
                                    isHov ? 'bg-slate-100' :
                                    isNow ? 'ring-1 ring-inset ring-slate-300' : ''
                                }`}
                                onMouseEnter={() => setHoverWeek(rowMonday)}
                                onClick={() => selectWeek(firstCell)}
                            >
                                {row.map((cell, ci) => {
                                    const isToday = cell && cell.getTime() === todayT;
                                    return (
                                        <div key={ci} className="flex items-center justify-center h-8 relative">
                                            {cell && (
                                                <>
                                                    <span className={`text-[12px] font-bold leading-none ${
                                                        isSel   ? 'text-white font-black' :
                                                        isToday ? 'text-slate-900 font-black' :
                                                        isHov   ? 'text-slate-700' :
                                                                  'text-slate-500'
                                                    }`}>
                                                        {cell.getDate()}
                                                    </span>
                                                    {isToday && !isSel && (
                                                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-slate-700" />
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                {/* ── Botón semana actual ── */}
                <button type="button"
                    onClick={() => selectWeek(new Date())}
                    className="mt-3 w-full text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 hover:bg-slate-50 py-2 rounded-xl transition-all">
                    Semana actual
                </button>
            </div>
        </div>
    );

    return (
        <>
            <div ref={triggerRef} onClick={openPicker} className="cursor-pointer select-none">
                {children}
            </div>
            {isOpen && createPortal(popover, document.body)}
        </>
    );
};

export default LiquidWeekPicker;
