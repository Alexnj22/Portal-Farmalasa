// src/components/common/PeriodPicker.jsx
// Month-level + Day-level range picker with preset shortcuts

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SH   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAYS_SH     = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

const pad = n => String(n).padStart(2, '0');

function svNow() {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return { y: sv.getUTCFullYear(), m: sv.getUTCMonth(), d: sv.getUTCDate() };
}

function svToday() {
    const { y, m, d } = svNow();
    return `${y}-${pad(m + 1)}-${pad(d)}`;
}

const mStart = (y, m) => `${y}-${pad(m + 1)}-01`;
const mEnd   = (y, m) => `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
const mKey   = (y, m) => y * 12 + m;

function daysAgo(n) {
    const { y, m, d } = svNow();
    const dt = new Date(Date.UTC(y, m, d - n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function buildPresets() {
    const { y, m } = svNow();
    const today = svToday();
    const pM = m === 0 ? 11 : m - 1;
    const pY = m === 0 ? y - 1 : y;
    const m3 = ((m - 2) % 12 + 12) % 12;
    const y3 = m - 2 < 0 ? y - 1 : y;
    return [
        { label: 'Hoy',             start: today,        end: today        },
        { label: 'Este mes',        start: mStart(y, m), end: mEnd(y, m)   },
        { label: 'Mes anterior',    start: mStart(pY, pM), end: mEnd(pY, pM) },
        { label: 'Últimos 3 meses', start: mStart(y3, m3), end: mEnd(y, m) },
        { label: 'Últimos 6 meses', start: daysAgo(180),   end: today      },
        { label: 'Este año',        start: `${y}-01-01`, end: `${y}-12-31` },
    ];
}

function formatDisplay(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function labelFromRange(s, e) {
    if (!s || !e) return null;
    const hit = buildPresets().find(p => p.start === s && p.end === e);
    if (hit) return hit.label;
    const [sy, sm] = s.split('-');
    const [ey, em] = e.split('-');
    const eLastDay = pad(new Date(+ey, +em, 0).getDate());
    if (s.endsWith('-01') && e.endsWith(`-${eLastDay}`)) {
        if (sy === ey && sm === em) return `${MONTHS_SH[+sm - 1]} ${sy}`;
        if (sy === ey) return `${MONTHS_SH[+sm - 1]} – ${MONTHS_SH[+em - 1]} ${sy}`;
        return `${MONTHS_SH[+sm - 1]} ${sy} – ${MONTHS_SH[+em - 1]} ${ey}`;
    }
    if (s === e) return formatDisplay(s);
    return `${formatDisplay(s)} → ${formatDisplay(e)}`;
}

// ── Day calendar sub-component ────────────────────────────────────────────────

function DayGrid({ year, month, startDate, endDate, hoverDate, onDayClick, onDayHover, onPrev, onNext }) {
    const firstDay    = new Date(year, month, 1).getDay();
    const offset      = (firstDay + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr    = svToday();
    const toStr       = d => `${year}-${pad(month + 1)}-${pad(d)}`;

    const previewEnd   = hoverDate && startDate && !endDate
        ? (hoverDate >= startDate ? hoverDate : startDate)
        : endDate;
    const previewStart = hoverDate && startDate && !endDate && hoverDate < startDate
        ? hoverDate : startDate;

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
                {onPrev
                    ? <button type="button" onClick={onPrev} className="w-6 h-6 rounded-full hover:bg-surface-card-hover flex items-center justify-center text-content-3 hover:text-brand transition-all"><ChevronLeft size={12} strokeWidth={3} /></button>
                    : <div className="w-6" />}
                <p className="text-[10px] font-black uppercase tracking-widest text-content-2">
                    {MONTHS_SH[month]} {year}
                </p>
                {onNext
                    ? <button type="button" onClick={onNext} className="w-6 h-6 rounded-full hover:bg-surface-card-hover flex items-center justify-center text-content-3 hover:text-brand transition-all"><ChevronRight size={12} strokeWidth={3} /></button>
                    : <div className="w-6" />}
            </div>

            <div className="grid grid-cols-7 mb-1">
                {DAYS_SH.map(d => (
                    <div key={d} className="text-center text-[8.5px] font-black uppercase tracking-wider text-content-2 py-0.5">{d}</div>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {Array.from({ length: offset }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day    = i + 1;
                    const dayStr = toStr(day);
                    const isStart = dayStr === previewStart;
                    const isEnd   = dayStr === previewEnd;
                    const isToday = dayStr === todayStr;
                    const isSingle = isStart && isEnd;

                    let inRange = false;
                    let wrapBg  = '';
                    if (previewStart && previewEnd && previewStart !== previewEnd) {
                        const s = previewStart < previewEnd ? previewStart : previewEnd;
                        const e = previewStart < previewEnd ? previewEnd   : previewStart;
                        inRange = dayStr > s && dayStr < e;
                        if (!isSingle) {
                            if (isStart && previewStart <= previewEnd) wrapBg = 'bg-gradient-to-r from-transparent to-brand/15';
                            else if (isStart) wrapBg = 'bg-gradient-to-l from-transparent to-brand/15';
                            else if (isEnd   && previewStart <= previewEnd) wrapBg = 'bg-gradient-to-l from-transparent to-brand/15';
                            else if (isEnd) wrapBg = 'bg-gradient-to-r from-transparent to-brand/15';
                            else if (inRange) wrapBg = 'bg-brand/[0.12]';
                        }
                    }

                    let btnCls = 'w-7 h-7 mx-auto flex items-center justify-center rounded-full text-[11px] font-bold transition-all z-10 relative ';
                    if (isStart || isEnd) {
                        btnCls += 'bg-brand text-white shadow-[0_2px_8px_rgba(0,82,204,0.45)] scale-110 cursor-pointer';
                    } else if (inRange) {
                        btnCls += 'text-brand font-black cursor-pointer hover:bg-surface-card-hover';
                    } else if (isToday) {
                        btnCls += 'text-brand font-black ring-1 ring-brand/40 cursor-pointer hover:bg-surface-card-hover';
                    } else {
                        btnCls += 'text-content-2 cursor-pointer hover:bg-surface-card-hover hover:text-brand';
                    }

                    return (
                        <div key={day}
                            className={`h-8 flex items-center justify-center relative ${wrapBg}`}
                            onMouseEnter={() => onDayHover(dayStr)}>
                            <button type="button" onClick={() => onDayClick(dayStr)} className={btnCls}>
                                {day}
                            </button>
                            {isToday && !isStart && !isEnd && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-brand z-20" />
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

    const [isOpen,    setIsOpen]    = useState(false);
    const [selMode,   setSelMode]   = useState('month'); // 'month' | 'day'

    // Month-mode hover highlight
    const [, setMonthHovering] = useState(null);

    // Day-mode picking state
    const [dayPhase,      setDayPhase]      = useState('idle'); // 'idle' | 'picking-end'
    const [dayDraftStart, setDayDraftStart] = useState(null);
    const [dayDraftEnd,   setDayDraftEnd]   = useState(null);
    const [dayHover,      setDayHover]      = useState(null);

    // Shared calendar navigation
    const [viewYear,  setViewYear]  = useState(() => fini ? parseInt(fini) : new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState(() => fini ? parseInt(fini.split('-')[1]) - 1 : new Date().getMonth());

    const [popStyle, setPopStyle] = useState({});
    const triggerRef = useRef(null);
    const popRef     = useRef(null);

    const { y: curY, m: curM } = svNow();

    const secondMonth = viewMonth === 11 ? 0  : viewMonth + 1;
    const secondYear  = viewMonth === 11 ? viewYear + 1 : viewYear;

    // Sincroniza el draft interno desde el prop `value` controlado
    useEffect(() => {
        const [s, e] = value ? value.split('|') : ['', ''];
        if (s) setViewYear(parseInt(s)); // eslint-disable-line react-hooks/set-state-in-effect
        setDayDraftStart(s || null);
        setDayDraftEnd(e || null);
        setDayPhase('idle');
    }, [value]);

    const open = () => {
        const y = fini ? parseInt(fini) : curY;
        const m = fini ? parseInt(fini.split('-')[1]) - 1 : curM;
        setViewYear(y);
        setViewMonth(m);
        setMonthHovering(null);
        setDayPhase('idle');
        setDayHover(null);
        setDayDraftStart(fini || null);
        setDayDraftEnd(ffin || null);
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const PH = selMode === 'day' ? 560 : 480;
            const PW = 460;
            let top  = rect.bottom + window.scrollY + 8;
            let left = rect.left + window.scrollX;
            if (rect.bottom + PH > window.innerHeight) top = rect.top + window.scrollY - PH - 8;
            if (left + PW > window.innerWidth) left = window.innerWidth - PW - 16;
            if (left < 8) left = 8;
            setPopStyle({ top, left });
        }
        setIsOpen(true);
    };

    const close = useCallback(() => {
        setIsOpen(false);
        setMonthHovering(null);
        setDayPhase('idle');
        setDayHover(null);
    }, []);

    const confirm = useCallback((s, e) => { onChange(`${s}|${e}`); close(); }, [onChange, close]);

    const handlePreset = (s, e) => confirm(s, e);

    // ── Month-mode handlers ───────────────────────────────────────────────────
    // Single click = apply full month immediately
    const handleMonthClick = (y, m) => confirm(mStart(y, m), mEnd(y, m));

    const getMonthState = (y, m) => {
        const k = mKey(y, m);
        if (fini && ffin) {
            const sY = parseInt(fini.substring(0, 4));
            const sM = parseInt(fini.substring(5, 7)) - 1;
            const eY = parseInt(ffin.substring(0, 4));
            const eM = parseInt(ffin.substring(5, 7)) - 1;
            const sk = mKey(sY, sM);
            const ek = mKey(eY, eM);
            return { isStart: k === sk, isEnd: k === ek, inRange: k > sk && k < ek, isSingle: sk === ek };
        }
        return { isStart: false, isEnd: false, inRange: false, isSingle: false };
    };

    // ── Day-mode handlers ─────────────────────────────────────────────────────
    const handleDayClick = useCallback((dayStr) => {
        if (dayPhase === 'idle') {
            setDayDraftStart(dayStr);
            setDayDraftEnd(null);
            setDayPhase('picking-end');
            setDayHover(null);
        } else {
            const s = dayStr <= dayDraftStart ? dayStr : dayDraftStart;
            const e = dayStr <= dayDraftStart ? dayDraftStart : dayStr;
            setDayDraftStart(s);
            setDayDraftEnd(e);
            setDayPhase('idle');
            confirm(s, e);
        }
    }, [dayPhase, dayDraftStart, confirm]);

    const handleDayHover = useCallback((dayStr) => {
        if (dayPhase === 'picking-end') setDayHover(dayStr);
    }, [dayPhase]);

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
        const h = e => {
            if (popRef.current && !popRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)) close();
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [isOpen, close]);

    const presets = buildPresets();
    const rangeLabel = labelFromRange(fini, ffin);

    // Helper: header subtitle text
    const subtitle = () => {
        if (dayPhase === 'picking-end') return `Desde ${formatDisplay(dayDraftStart)} — elige la fecha final`;
        return rangeLabel || 'Elige un acceso rápido o selecciona manualmente';
    };

    const popup = isOpen && createPortal(
        <>
            <div className="fixed inset-0 z-[9998] bg-scrim backdrop-blur-[2px]" onClick={close} />
            <div ref={popRef}
                className="fixed z-[9999]"
                style={{ ...popStyle, width: '460px', maxWidth: 'calc(100vw - 32px)' }}>
                <div data-surface="dropdown" className="overflow-hidden">

                    {/* Header */}
                    <div className="flex items-center justify-between px-5 pt-5 pb-3">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
                                <CalendarDays size={15} className="text-brand" strokeWidth={2.5} />
                            </div>
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-widest text-content-2 leading-tight">
                                    Seleccionar período
                                </p>
                                <p className={`text-[10px] font-bold leading-tight mt-0.5 transition-colors ${
                                    dayPhase === 'picking-end' ? 'text-brand animate-pulse' : 'text-content-3'
                                }`}>
                                    {subtitle()}
                                </p>
                            </div>
                        </div>
                        <button type="button" onClick={close}
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-surface-card-hover hover:bg-surface-card text-content-3 hover:text-content-2 transition-all shadow-sm shrink-0">
                            <X size={12} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Presets */}
                    <div className="px-5 pb-3">
                        <p className="text-[8.5px] font-black uppercase tracking-[0.12em] text-content-3 mb-2">
                            Accesos rápidos
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                            {presets.map(p => {
                                const active = dayPhase === 'idle' && fini === p.start && ffin === p.end;
                                return (
                                    <button key={p.label} type="button" onClick={() => handlePreset(p.start, p.end)}
                                        className={`px-2 py-2 rounded-[0.875rem] text-[10.5px] font-bold transition-all text-center leading-tight
                                            ${active
                                                ? 'bg-brand text-white shadow-[0_2px_8px_rgba(0,82,204,0.4)] scale-[1.03]'
                                                : 'bg-surface-card-hover text-content-2 hover:bg-surface-card hover:text-brand hover:shadow-md hover:-translate-y-0.5 border border-border-card'
                                            }`}>
                                        {p.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Mode toggle */}
                    <div className="flex items-center gap-3 px-5 mb-3">
                        <div className="flex-1 h-px bg-divider" />
                        <div className="flex items-center bg-surface-card-hover rounded-full p-0.5 border border-border-card shadow-sm">
                            {[{ key: 'month', label: 'Por mes' }, { key: 'day', label: 'Por días' }].map(opt => (
                                <button key={opt.key} type="button"
                                    onClick={() => { setSelMode(opt.key); setDayPhase('idle'); setDayHover(null); }}
                                    className={`px-3 py-1 rounded-full text-[9.5px] font-black transition-all ${
                                        selMode === opt.key
                                            ? 'bg-brand text-white shadow-sm'
                                            : 'text-content-3 hover:text-content-2'
                                    }`}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 h-px bg-divider" />
                    </div>

                    {/* Month grid */}
                    {selMode === 'month' && (
                        <div className="px-5 pb-5">
                            <div className="flex items-center justify-between mb-3">
                                <button type="button" onClick={() => setViewYear(y => y - 1)}
                                    className="w-7 h-7 rounded-full bg-surface-card-hover hover:bg-surface-card flex items-center justify-center text-content-3 hover:text-brand transition-all shadow-sm">
                                    <ChevronLeft size={13} strokeWidth={3} />
                                </button>
                                <span className="text-[12px] font-black text-content-2 tracking-wide">{viewYear}</span>
                                <button type="button" onClick={() => setViewYear(y => y + 1)}
                                    disabled={viewYear >= curY + 1}
                                    className="w-7 h-7 rounded-full bg-surface-card-hover hover:bg-surface-card flex items-center justify-center text-content-3 hover:text-brand transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed">
                                    <ChevronRight size={13} strokeWidth={3} />
                                </button>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                                {MONTHS_SH.map((label, mi) => {
                                    const { isStart, isEnd, inRange, isSingle } = getMonthState(viewYear, mi);
                                    const isCurrent = viewYear === curY && mi === curM;
                                    const isFuture  = mKey(viewYear, mi) > mKey(curY, curM);

                                    let cellCls = 'relative h-10 flex items-center justify-center rounded-2xl text-[11px] font-bold transition-all select-none ';
                                    if (isStart || isEnd) {
                                        cellCls += 'bg-brand text-white shadow-[0_3px_10px_rgba(0,82,204,0.45)] scale-105 z-10 ';
                                    } else if (inRange) {
                                        cellCls += 'bg-brand/[0.12] text-brand font-black ';
                                    } else if (isFuture) {
                                        cellCls += 'text-content-3 cursor-not-allowed ';
                                    } else if (isCurrent) {
                                        cellCls += 'text-brand font-black ring-1 ring-brand/40 cursor-pointer hover:bg-surface-card-hover hover:shadow-sm ';
                                    } else {
                                        cellCls += 'text-content-2 cursor-pointer hover:bg-surface-card-hover hover:text-brand hover:shadow-sm ';
                                    }

                                    let stripCls = '';
                                    if (inRange) stripCls = 'absolute inset-y-0 inset-x-0 bg-brand/10 rounded-none';
                                    else if (isStart && !isSingle) stripCls = 'absolute inset-y-0 right-0 left-1/2 bg-brand/10';
                                    else if (isEnd   && !isSingle) stripCls = 'absolute inset-y-0 left-0 right-1/2 bg-brand/10';

                                    return (
                                        <button key={mi} type="button"
                                            disabled={isFuture}
                                            onClick={() => !isFuture && handleMonthClick(viewYear, mi)}
                                            onMouseEnter={() => !isFuture && setMonthHovering({ y: viewYear, m: mi })}
                                            onMouseLeave={() => setMonthHovering(null)}
                                            className={cellCls}>
                                            {stripCls && <div className={stripCls} />}
                                            <span className="relative z-10">{label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Day calendar */}
                    {selMode === 'day' && (
                        <div className="px-5 pb-5" onMouseLeave={() => dayPhase === 'picking-end' && setDayHover(null)}>
                            <div className="flex gap-3">
                                <DayGrid
                                    year={viewYear} month={viewMonth}
                                    startDate={dayDraftStart} endDate={dayDraftEnd}
                                    hoverDate={dayHover}
                                    onDayClick={handleDayClick}
                                    onDayHover={handleDayHover}
                                    onPrev={handlePrev}
                                />
                                <div className="w-px bg-divider self-stretch shrink-0" />
                                <DayGrid
                                    year={secondYear} month={secondMonth}
                                    startDate={dayDraftStart} endDate={dayDraftEnd}
                                    hoverDate={dayHover}
                                    onDayClick={handleDayClick}
                                    onDayHover={handleDayHover}
                                    onNext={handleNext}
                                />
                            </div>
                            {dayPhase === 'picking-end' && (
                                <div className="mt-3 flex items-center justify-between">
                                    <p className="text-[10px] font-bold text-brand animate-pulse">
                                        Selecciona la fecha de fin
                                    </p>
                                    <button type="button" onClick={() => { setDayPhase('idle'); setDayDraftStart(null); setDayHover(null); }}
                                        className="text-[9.5px] font-bold text-content-3 hover:text-content-2 transition-colors">
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </>,
        document.body
    );

    return (
        <>
            <div ref={triggerRef} onClick={open}
                className="flex items-center gap-2 h-full px-3 cursor-pointer rounded-[1rem] transition-all hover:bg-surface-card-hover group">
                <CalendarDays size={13}
                    className={fini ? 'text-brand' : 'text-content-3 group-hover:text-brand transition-colors'}
                    strokeWidth={2.5} />
                <span className={`text-[12px] font-bold truncate whitespace-nowrap ${fini && ffin ? 'text-content-2' : 'text-content-3'}`}>
                    {fini && ffin ? (rangeLabel || `${formatDisplay(fini)} → ${formatDisplay(ffin)}`) : placeholder}
                </span>
            </div>
            {popup}
        </>
    );
}
