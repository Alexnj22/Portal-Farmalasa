// src/components/common/PeriodPicker.jsx
// Date range picker with presets for the ventas/facturación filter bar.
// value format: "YYYY-MM-DD|YYYY-MM-DD"  (same as monthRange in VentasView)

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';

const MONTHS     = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SH  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAYS_SHORT = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

// ── helpers ──────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');

function svToday() {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${pad(sv.getUTCMonth() + 1)}-${pad(sv.getUTCDate())}`;
}

function buildPresets() {
    const nowMs = Date.now() - 6 * 3600_000;
    const sv = new Date(nowMs);
    const y = sv.getUTCFullYear();
    const m = sv.getUTCMonth();
    const d = sv.getUTCDate();
    const today = `${y}-${pad(m + 1)}-${pad(d)}`;

    const daysFromMon = (sv.getUTCDay() + 6) % 7;
    const mon = new Date(nowMs - daysFromMon * 86400_000);
    const weekStart = `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;

    const monthStart   = `${y}-${pad(m + 1)}-01`;
    const monthLastDay = new Date(y, m + 1, 0).getDate();
    const monthEnd     = `${y}-${pad(m + 1)}-${pad(monthLastDay)}`;

    const pM = m === 0 ? 11 : m - 1;
    const pY = m === 0 ? y - 1 : y;
    const prevStart   = `${pY}-${pad(pM + 1)}-01`;
    const prevLastDay = new Date(pY, pM + 1, 0).getDate();
    const prevEnd     = `${pY}-${pad(pM + 1)}-${pad(prevLastDay)}`;

    const m3 = ((m - 2) % 12 + 12) % 12;
    const y3 = m - 2 < 0 ? y - 1 : y;
    const threeStart = `${y3}-${pad(m3 + 1)}-01`;

    const quick = [
        { label: 'Hoy',             start: today,      end: today },
        { label: 'Esta semana',     start: weekStart,  end: today },
        { label: 'Este mes',        start: monthStart, end: today },
        { label: 'Mes completo',    start: monthStart, end: monthEnd },
        { label: 'Mes anterior',    start: prevStart,  end: prevEnd },
        { label: 'Últimos 3 meses', start: threeStart, end: today },
        { label: 'Este año',        start: `${y}-01-01`, end: `${y}-12-31` },
    ];

    const months = [];
    for (let i = 0; i < 13; i++) {
        const mi   = ((m - i) % 12 + 12) % 12;
        const yi   = m - i < 0 ? y - 1 : y;
        const last = new Date(yi, mi + 1, 0).getDate();
        months.push({
            label: `${MONTHS_SH[mi]} ${yi}`,
            start: `${yi}-${pad(mi + 1)}-01`,
            end:   `${yi}-${pad(mi + 1)}-${pad(last)}`,
        });
    }

    return { quick, months };
}

function formatDisplay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// ── MonthGrid ─────────────────────────────────────────────────────────────────

function MonthGrid({ year, month, startDate, endDate, onDayMouseDown, onDayMouseUp, onDayHover, onPrev, onNext }) {
    const firstDay   = new Date(year, month, 1).getDay();
    const offset     = (firstDay + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const toStr = d => `${year}-${pad(month + 1)}-${pad(d)}`;

    const todayStr = svToday();

    return (
        <div className="flex-1 min-w-[220px]">
            <div className="flex items-center justify-between mb-3">
                {onPrev ? (
                    <button type="button" onClick={onPrev}
                        className="p-1.5 hover:bg-white/60 rounded-full transition-colors text-slate-500 hover:text-[#007AFF]">
                        <ChevronLeft size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-700">
                    {MONTHS[month]} {year}
                </p>
                {onNext ? (
                    <button type="button" onClick={onNext}
                        className="p-1.5 hover:bg-white/60 rounded-full transition-colors text-slate-500 hover:text-[#007AFF]">
                        <ChevronRight size={14} strokeWidth={3} />
                    </button>
                ) : <div className="w-7" />}
            </div>
            <div className="grid grid-cols-7 mb-1">
                {DAYS_SHORT.map(d => (
                    <div key={d} className="text-center text-[9px] font-black uppercase tracking-widest text-slate-400 py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7">
                {Array.from({ length: offset }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day    = i + 1;
                    const dayStr = toStr(day);
                    const isStart = dayStr === startDate;
                    const isEnd   = dayStr === endDate;
                    const isToday = dayStr === todayStr;

                    let inRange = false;
                    let wrapBg  = '';
                    if (startDate && endDate && startDate !== endDate) {
                        const s = startDate < endDate ? startDate : endDate;
                        const e = startDate < endDate ? endDate   : startDate;
                        inRange = dayStr > s && dayStr < e;
                        if (!isStart && !isEnd) {
                            if (isStart) wrapBg = 'bg-gradient-to-r from-transparent to-blue-100';
                            else if (isEnd) wrapBg = 'bg-gradient-to-l from-transparent to-blue-100';
                            else if (inRange) wrapBg = 'bg-blue-100';
                        }
                    }

                    let btnCls = 'w-8 h-8 mx-auto flex items-center justify-center rounded-full text-[12px] font-bold transition-all relative z-10 select-none cursor-pointer ';
                    if (isStart || isEnd) {
                        btnCls += 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.4)] scale-110';
                    } else if (inRange) {
                        btnCls += 'text-[#007AFF] font-black hover:bg-white hover:shadow-sm';
                    } else if (isToday) {
                        btnCls += 'text-[#007AFF] font-black ring-1 ring-[#007AFF]/40 hover:bg-slate-100';
                    } else {
                        btnCls += 'text-slate-600 hover:bg-slate-100 hover:text-[#007AFF]';
                    }

                    return (
                        <div key={day}
                            className={`h-9 flex items-center justify-center relative ${wrapBg}`}
                            onMouseEnter={() => onDayHover(dayStr)}>
                            <button type="button"
                                onMouseDown={e => { e.preventDefault(); onDayMouseDown(dayStr); }}
                                onMouseUp={() => onDayMouseUp(dayStr)}
                                className={btnCls}>
                                {day}
                            </button>
                            {isToday && !isStart && !isEnd && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#007AFF] z-10" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── PeriodPicker ──────────────────────────────────────────────────────────────

export default function PeriodPicker({ value, onChange, placeholder = 'Período...' }) {
    const [fini, ffin] = value ? value.split('|') : ['', ''];

    const [isOpen,     setIsOpen]     = useState(false);
    const [draftStart, setDraftStart] = useState(fini  || null);
    const [draftEnd,   setDraftEnd]   = useState(ffin  || null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart,  setDragStart]  = useState(null);
    const [viewYear,   setViewYear]   = useState(() => fini ? parseInt(fini.split('-')[0]) : new Date().getFullYear());
    const [viewMonth,  setViewMonth]  = useState(() => fini ? parseInt(fini.split('-')[1]) - 1 : new Date().getMonth());
    const [popupStyle, setPopupStyle] = useState({});

    const triggerRef = useRef(null);
    const popupRef   = useRef(null);

    const secondMonth = viewMonth === 11 ? 0  : viewMonth + 1;
    const secondYear  = viewMonth === 11 ? viewYear + 1 : viewYear;

    // Sync draft when value changes externally
    useEffect(() => {
        const [s, e] = value ? value.split('|') : ['', ''];
        setDraftStart(s || null);
        setDraftEnd(e || null);
    }, [value]);

    const open = () => {
        const [s] = value ? value.split('|') : ['', ''];
        if (s) {
            const parts = s.split('-');
            setViewYear(parseInt(parts[0]));
            setViewMonth(parseInt(parts[1]) - 1);
        } else {
            const now = new Date();
            setViewYear(now.getFullYear());
            setViewMonth(now.getMonth());
        }
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const popH = 460;
            const popW = 780;
            let top  = rect.bottom + window.scrollY + 8;
            let left = rect.left + window.scrollX;
            if (rect.bottom + popH > window.innerHeight) top = rect.top + window.scrollY - popH - 8;
            if (left + popW > window.innerWidth) left = window.innerWidth - popW - 16;
            if (left < 8) left = 8;
            setPopupStyle({ top, left });
        }
        setIsOpen(true);
    };

    const close = () => setIsOpen(false);

    const confirm = (s, e) => {
        onChange(`${s}|${e}`);
        setIsOpen(false);
    };

    const handlePreset = (s, e) => {
        setDraftStart(s);
        setDraftEnd(e);
        confirm(s, e);
    };

    const handleDayMouseDown = useCallback(dayStr => {
        setIsDragging(true);
        setDragStart(dayStr);
        setDraftStart(dayStr);
        setDraftEnd(dayStr);
    }, []);

    const handleDayMouseUp = useCallback(dayStr => {
        if (!isDragging) return;
        setIsDragging(false);
        const s = dragStart <= dayStr ? dragStart : dayStr;
        const e = dragStart <= dayStr ? dayStr    : dragStart;
        setDraftStart(s);
        setDraftEnd(e);
        setDragStart(null);
    }, [isDragging, dragStart]);

    const handleDayHover = useCallback(dayStr => {
        if (isDragging && dragStart) {
            setDraftStart(dragStart <= dayStr ? dragStart : dayStr);
            setDraftEnd  (dragStart <= dayStr ? dayStr    : dragStart);
        }
    }, [isDragging, dragStart]);

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
        const handler = e => {
            if (popupRef.current && !popupRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)) close();
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

    const presets = isOpen ? buildPresets() : null;

    const popup = isOpen && createPortal(
        <>
            <div className="fixed inset-0 z-[9998] bg-slate-900/20 backdrop-blur-[2px]" onClick={close} />
            <div ref={popupRef}
                className="fixed z-[9999] bg-white/85 backdrop-blur-md border border-white/60 rounded-[2rem] shadow-[0_20px_60px_rgba(0,0,0,0.14)] p-6"
                style={{ ...popupStyle, width: '780px', maxWidth: 'calc(100vw - 32px)' }}>

                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-[#007AFF]/10 text-[#007AFF] rounded-xl">
                            <CalendarDays size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                            <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">Seleccionar período</p>
                            <p className="text-[10px] text-slate-400 font-bold">
                                {draftStart && draftEnd
                                    ? `${formatDisplay(draftStart)} → ${formatDisplay(draftEnd)} · ${daysCount} día${daysCount !== 1 ? 's' : ''}`
                                    : 'Elige un preset o arrastra en el calendario'}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={close}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors">
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>

                <div className="flex gap-5">
                    {/* Presets */}
                    <div className="flex flex-col w-[148px] shrink-0 gap-0.5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Accesos rápidos</p>
                        {presets.quick.map(p => {
                            const active = draftStart === p.start && draftEnd === p.end;
                            return (
                                <button key={p.label} type="button" onClick={() => handlePreset(p.start, p.end)}
                                    className={`text-left px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                                        active
                                            ? 'bg-[#007AFF] text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)]'
                                            : 'text-slate-600 hover:bg-white hover:text-[#007AFF] hover:shadow-sm'
                                    }`}>
                                    {p.label}
                                </button>
                            );
                        })}

                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-3 mb-1 px-1">Meses</p>
                        <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[176px] pr-0.5">
                            {presets.months.map(p => {
                                const active = draftStart === p.start && draftEnd === p.end;
                                return (
                                    <button key={p.label} type="button" onClick={() => handlePreset(p.start, p.end)}
                                        className={`text-left px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                            active
                                                ? 'bg-[#007AFF] text-white'
                                                : 'text-slate-500 hover:bg-white hover:text-[#007AFF]'
                                        }`}>
                                        {p.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="w-px bg-white/40 self-stretch shrink-0" />

                    {/* Calendars */}
                    <div className="flex gap-4 flex-1">
                        <MonthGrid
                            year={viewYear} month={viewMonth}
                            startDate={draftStart} endDate={draftEnd}
                            onDayMouseDown={handleDayMouseDown}
                            onDayMouseUp={handleDayMouseUp}
                            onDayHover={handleDayHover}
                            onPrev={handlePrev}
                        />
                        <div className="w-px bg-white/30 self-stretch shrink-0" />
                        <MonthGrid
                            year={secondYear} month={secondMonth}
                            startDate={draftStart} endDate={draftEnd}
                            onDayMouseDown={handleDayMouseDown}
                            onDayMouseUp={handleDayMouseUp}
                            onDayHover={handleDayHover}
                            onNext={handleNext}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-white/30 flex items-center justify-end gap-3">
                    <button type="button" onClick={close}
                        className="px-4 py-2 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-100 transition-all uppercase tracking-widest">
                        Cancelar
                    </button>
                    <button type="button"
                        disabled={!draftStart || !draftEnd}
                        onClick={() => confirm(draftStart, draftEnd)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] hover:bg-[#005CE6] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition-all hover:-translate-y-0.5 active:scale-95 shadow-[0_4px_12px_rgba(0,122,255,0.3)]">
                        <Check size={14} strokeWidth={3} /> Aplicar
                    </button>
                </div>
            </div>
        </>,
        document.body
    );

    return (
        <>
            <div ref={triggerRef} onClick={open}
                className="flex items-center gap-2 h-full px-3 cursor-pointer rounded-[1rem] transition-all hover:bg-white/60 group">
                <CalendarDays size={13}
                    className={fini ? 'text-[#007AFF]' : 'text-slate-400 group-hover:text-[#007AFF] transition-colors'}
                    strokeWidth={2.5} />
                <span className={`text-[12px] font-bold truncate whitespace-nowrap ${fini && ffin ? 'text-slate-700' : 'text-slate-400'}`}>
                    {fini && ffin ? `${formatDisplay(fini)} → ${formatDisplay(ffin)}` : placeholder}
                </span>
            </div>
            {popup}
        </>
    );
}
