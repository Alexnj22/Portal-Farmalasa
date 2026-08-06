// src/components/common/RangeDatePicker.jsx

import React, { useState, useRef, useEffect, useCallback } from 'react';
import AsaHoja from './AsaHoja';
import Badge from './Badge';
import Button from './Button';
import { createPortal } from 'react-dom';
import useCoarsePointer from '../../hooks/useCoarsePointer';
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

const MonthGrid = ({ year, month, startDate, endDate, onDayMouseDown, onDayMouseUp, onDayHover, holidays, onPrev, onNext, selectedRanges = [], esTactil = false }) => {
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
                    <Button variant="secondary" icon={ChevronLeft} iconOnly onClick={onPrev} />
                ) : <div className="w-7" />}
                <p className="text-body-sm font-black uppercase tracking-widest text-content-2">
                    {MONTHS[month]} {year}
                </p>
                {onNext ? (
                    <Button variant="secondary" icon={ChevronRight} iconOnly onClick={onNext} />
                ) : <div className="w-7" />}
            </div>
            <div className="grid grid-cols-7 mb-2">
                {DAYS_SHORT.map(d => (
                    <div key={d} className="text-center text-caption font-black uppercase tracking-widest text-content-3 py-1">{d}</div>
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

                    // 32px es cómodo con mouse; con el dedo el mínimo es 44 (WCAG 2.5.8).
                    let btnClass = (esTactil ? 'w-11 h-11 ' : 'w-8 h-8 ') + 'mx-auto flex items-center justify-center rounded-full text-body-sm font-bold transition-all relative z-base select-none ';
                    if (holiday) {
                        btnClass += 'text-danger bg-danger/10 cursor-not-allowed opacity-70';
                    } else if (isStart || isEnd) {
                        btnClass += 'bg-brand text-white shadow-[var(--shadow-glow-brand)] scale-110 cursor-pointer';
                    } else if (isAnyRangeStart || isAnyRangeEnd) {
                        btnClass += 'bg-success-solid text-white shadow-[var(--shadow-glow-success-md)] scale-105 cursor-pointer';
                    } else if (inRange) {
                        btnClass += 'text-brand-text font-black cursor-pointer hover:bg-surface-card-hover hover:shadow-sm';
                    } else if (isInAnyRange) {
                        btnClass += 'text-success font-black cursor-pointer hover:bg-surface-card-hover hover:shadow-sm';
                    } else if (isToday) {
                        btnClass += 'text-brand-text font-black ring-1 ring-brand/30 cursor-pointer hover:bg-surface-card-hover';
                    } else {
                        btnClass += 'text-content-2 cursor-pointer hover:bg-surface-card-hover hover:text-brand-text';
                    }

                    return (
                        <div
                            key={day}
                            className={`${esTactil ? 'h-12' : 'h-9'} flex items-center justify-center relative ${wrapBg}`}
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
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-brand z-base" />
                            )}
                            {holiday && (
                                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-danger z-base" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// D3.11 (2026-07-27) · corregido el mismo día.
// RangeDatePicker no tenía entrada por teclado — un rango NO se podía completar
// sin mouse (WCAG 2.1.1). LiquidDatePicker sí la tenía; acá se replica.
//
// ESTE COMPONENTE VA ACÁ AFUERA A PROPÓSITO. La primera versión lo definía
// DENTRO de RangeDatePicker: React trata cada render como un tipo de componente
// nuevo, así que desmontaba y remontaba el input en cada tecla y el foco se
// perdía al primer caracter. Medido: tras escribir "15/07/2026", activeElement
// era BODY. Eso es lo que se sentía como "lento y no renderiza bien".
const aTexto = (v) => (v ? v.split('-').reverse().join('/') : '');

const TeclaFecha = ({ valor, onSet, etiqueta }) => {
    const [txt, setTxt] = useState(() => aTexto(valor));
    // Sincronizar el prop con el estado DURANTE el render, no en un efecto: un
    // useEffect acá dispara un segundo render por cada cambio del calendario
    // (react-hooks/set-state-in-effect lo marca, y con razón — es justo el tipo
    // de render en cascada que hace sentir lento a un control).
    const [valorPrevio, setValorPrevio] = useState(valor);
    if (valor !== valorPrevio) {
        setValorPrevio(valor);
        setTxt(aTexto(valor));
    }

    const commit = (raw) => {
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return;
        const [, d, mo, y] = m;
        const dd = String(d).padStart(2, '0'), mm = String(mo).padStart(2, '0');
        if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return;
        onSet(`${y}-${mm}-${dd}`);
    };

    // Se autoformatea al tipear: 15072026 → 15/07/2026, sin pelear con el cursor.
    const alEscribir = (e) => {
        const solo = e.target.value.replace(/\D/g, '').slice(0, 8);
        const partes = [solo.slice(0, 2), solo.slice(2, 4), solo.slice(4, 8)].filter(Boolean);
        const v = partes.join('/');
        setTxt(v);
        commit(v);
    };

    return (
        <input
            type="text" inputMode="numeric" aria-label={etiqueta} placeholder="DD/MM/AAAA"
            value={txt} onChange={alEscribir} onBlur={(e) => commit(e.target.value)}
            className="w-[104px] bg-surface-card-hover border border-border-card rounded-lg px-2 py-1
                text-body-sm font-bold text-content text-center placeholder:text-content-3
                tabular-nums outline-none focus:border-brand transition-colors"
        />
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
    // ── D3.11 (2026-07-27) ─────────────────────────────────────────────
    // `months`: el panel de dos meses (596px) es correcto para pedir vacaciones
    // pero pesado para un filtro de toolbar. Con `months={1}` queda en ~320px.
    months = 2,
    // `compact`: el disparador cerrado, para barras de vista.
    compact = false,
    // `shortcuts`: los rangos que de verdad se piden en un filtro. Sin esto hay
    // que navegar el calendario hasta para "los últimos 7 días".
    shortcuts = null,
}) => {
    const esTactil = useCoarsePointer();
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

    // D3.12 (2026-07-27): con el dedo, un toque dispara mousedown Y mouseup sobre
    // el MISMO día, así que caía en `start === end` y auto-calculaba defaultDays
    // (15 días) en vez de dejar elegir el fin. En táctil se selecciona con dos
    // toques: el primero fija el inicio, el segundo el fin.
    const handleDayTap = useCallback((dayStr) => {
        setRangeConfirmed(false);
        if (!draftStart || (draftStart && draftEnd)) {
            setDraftStart(dayStr);
            setDraftEnd(null);
            setSelecting('end');
            return;
        }
        const ini = draftStart <= dayStr ? draftStart : dayStr;
        const fin = draftStart <= dayStr ? dayStr : draftStart;
        setDraftStart(ini);
        setDraftEnd(fin);
        setSelecting('start');
    }, [draftStart, draftEnd]);

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

    const SHORTCUTS_DEFAULT = [
        { label: 'Últimos 7 días', dias: 7 },
        { label: 'Últimos 30 días', dias: 30 },
        { label: 'Este mes', esteMes: true },
        { label: 'Mes pasado', mesPasado: true },
        { label: 'Este año', esteAnio: true },
    ];
    const atajos = shortcuts === true ? SHORTCUTS_DEFAULT : (Array.isArray(shortcuts) ? shortcuts : null);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const aplicarAtajo = (a) => {
        const hoy = new Date();
        let ini, fin;
        if (a.esteMes)        { ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1); fin = hoy; }
        else if (a.mesPasado) { ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
                                fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
        else if (a.esteAnio)  { ini = new Date(hoy.getFullYear(), 0, 1); fin = hoy; }
        else                  { ini = new Date(); ini.setDate(ini.getDate() - (a.dias - 1)); fin = hoy; }
        setDraftStart(iso(ini)); setDraftEnd(iso(fin));
        onRangeChange?.(iso(ini), iso(fin));
        setIsOpen(false);
    };

    const popup = isOpen && createPortal(
        <>
            <div className="fixed inset-0 z-tooltip bg-scrim backdrop-blur-[2px]" onClick={handleClose} />
            {/* D3.12 (2026-07-27): en táctil, hoja inferior a ancho completo en vez
                de panel flotante. El panel medía 557px de alto en una ventana útil de
                664px — entraba raspando, y con el teclado abierto no entraba. Mismo
                calendario y mismos tokens: cambia la presentación, no el material. */}
            <div
                ref={popupRef}
                data-surface={esTactil ? "sheet" : "dropdown"}
                className={esTactil
                    ? `fixed z-toast left-0 right-0 bottom-0 w-full rounded-t-modal rounded-b-none
                       px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]
                       max-h-[88vh] overflow-y-auto animate-in slide-in-from-bottom duration-[var(--dur-slow)]`
                    : 'fixed z-toast p-6 max-w-[calc(100vw-32px)]'}
                style={esTactil ? undefined : { ...popupStyle, width: months === 1 ? '332px' : '596px', maxWidth: 'calc(100vw - 32px)' }}
                onMouseLeave={() => !rangeConfirmed && selecting === 'end' && setHoverDate(null)}
            >
                {esTactil && <AsaHoja className="mb-3" />}
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-brand/10 text-brand-text rounded-xl">
                            <CalendarDays size={16} strokeWidth={2.5} />
                        </div>
                        <div>
                            <p className="text-body-sm font-black uppercase tracking-widest text-content-2">
                                {multiRange ? 'Selecciona períodos de apoyo' : (selecting === 'start' ? 'Selecciona el primer día' : 'Ajusta la fecha de fin')}
                            </p>
                            {multiRange ? (
                                <p className="text-caption text-content-3 font-bold">
                                    {selectedRanges.length > 0
                                        ? `${selectedRanges.length} período${selectedRanges.length !== 1 ? 's' : ''} seleccionado${selectedRanges.length !== 1 ? 's' : ''}`
                                        : 'Arrastra para seleccionar períodos'}
                                </p>
                            ) : esTactil ? (
                                /* En táctil los dos extremos se MUESTRAN, no se
                                   escriben. Tocarlos enfocaba un input y el sistema
                                   levantaba el teclado — que en un panel de 557px
                                   dentro de una ventana útil de 664px tapa el propio
                                   calendario que uno vino a usar. Y con el dedo nadie
                                   teclea una fecha teniendo días de 44px al lado.
                                   El acceso sin mouse que justificaba estos campos
                                   (WCAG 2.1.1) lo da el calendario, que en táctil se
                                   completa con dos toques. */
                                <p className="text-body-sm font-black text-content tabular-nums mt-1">
                                    {aTexto(draftStart) || 'DD/MM/AAAA'}
                                    <span className="text-content-3 mx-1.5">→</span>
                                    {aTexto(draftEnd) || 'DD/MM/AAAA'}
                                </p>
                            ) : (
                                /* D3.11: los dos extremos, escribibles. Antes el rango
                                   NO se podía completar sin mouse (WCAG 2.1.1) — había
                                   que navegar el calendario sí o sí. */
                                <div className="flex items-center gap-1.5 mt-1">
                                    <TeclaFecha valor={draftStart} etiqueta="Fecha de inicio"
                                        onSet={(v) => { setDraftStart(v); setSelecting('end'); }} />
                                    <span className="text-content-3 font-black">→</span>
                                    <TeclaFecha valor={draftEnd} etiqueta="Fecha de fin"
                                        onSet={(v) => setDraftEnd(v)} />
                                </div>
                            )}
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" icon={X} iconOnly onClick={handleClose} />
                </div>

                {atajos && (
                    <div className="flex flex-wrap gap-1.5 mb-5 pb-5 border-b border-divider">
                        {/* `key` faltaba: los atajos salen de un `.map()` y React
                            los reordenaba sin poder identificarlos. El migrador de
                            botones tira los atributos que no entiende — es el
                            mismo fallo de los 11 badges de v2.76.0. */}
                        {atajos.map(a => (
                            <Button key={a.label} size="sm" variant="secondary" onClick={() => aplicarAtajo(a)}>{a.label}</Button>
                        ))}
                    </div>
                )}

                {/* Calendars */}
                <div className="flex gap-4">
                    <MonthGrid
                        year={viewYear} month={viewMonth}
                        startDate={draftStart} endDate={draftEnd}
                        onDayMouseDown={esTactil ? () => {} : handleDayMouseDown}
                        onDayMouseUp={esTactil ? handleDayTap : handleDayMouseUp}
                        onDayHover={handleDayHover}
                        holidays={holidays}
                        onPrev={handlePrev}
                        onNext={(months === 1 || esTactil) ? handleNext : undefined}
                        selectedRanges={selectedRanges}
                        esTactil={esTactil}
                    />
                    {months !== 1 && !esTactil && <div className="w-px bg-divider self-stretch shrink-0" />}
                    {months !== 1 && !esTactil && <MonthGrid
                        year={secondYear} month={secondMonth}
                        startDate={draftStart} endDate={draftEnd}
                        onDayMouseDown={handleDayMouseDown}
                        onDayMouseUp={handleDayMouseUp}
                        onDayHover={handleDayHover}
                        holidays={holidays}
                        onNext={handleNext}
                        selectedRanges={selectedRanges}
                    />}
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-divider flex items-center justify-between gap-3">
                    {(() => {
                        let cls = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-black transition-all ';
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
                    <Button icon={Check} disabled={!multiRange && (!draftStart || !draftEnd)} onClick={handleConfirm}>{multiRange ? 'Listo' : 'Confirmar rango'}</Button>
                </div>
            </div>
        </>,
        document.body
    );

    return (
        <>
            {/* Mismo caso que `PeriodPicker`: sin teclado no se podía abrir. */}
            <div ref={triggerRef} onClick={handleOpen}
                role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={isOpen}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); handleOpen(); }
                }}
                className="cursor-pointer rounded-input focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                {multiRange ? (
                    <div data-surface="input" className={`flex items-center gap-2 ${compact ? 'h-11 px-2.5 rounded-full' : 'h-[40px] px-3'} transition-all ${isOpen ? 'outline outline-2 outline-brand/30' : ''}`}>
                        <CalendarDays size={14} className={selectedRanges.length > 0 ? 'text-success' : 'text-content-3'} strokeWidth={2.5} />
                        <p className={`text-body-sm font-bold ${selectedRanges.length > 0 ? 'text-content-2' : 'text-content-3'}`}>
                            {selectedRanges.length > 0
                                ? `${selectedRanges.length} período${selectedRanges.length !== 1 ? 's' : ''} seleccionado${selectedRanges.length !== 1 ? 's' : ''}`
                                : placeholder}
                        </p>
                    </div>
                ) : (
                    <div data-surface="input" className={`flex items-center ${compact ? 'gap-2 h-11 px-3 rounded-full' : 'gap-3 h-[48px] px-4'} transition-all ${isOpen ? 'outline outline-2 outline-brand/30' : ''}`}>
                        <CalendarDays size={14} className={startDate ? 'text-brand-text' : 'text-content-3'} strokeWidth={2.5} />
                        <span className={`flex-1 text-body font-bold truncate ${startDate && endDate ? 'text-content-2' : 'text-content-3'}`}>
                            {startDate && endDate
                                ? `${formatDisplay(startDate)} → ${formatDisplay(endDate)}`
                                : startDate
                                ? `${formatDisplay(startDate)} → selecciona fin`
                                : placeholder}
                        </span>
                        {startDate && endDate && (
                            <Badge variant="info" uppercase={false}>{Math.round((new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86400000) + 1}d</Badge>
                        )}
                    </div>
                )}
            </div>
            {multiRange && selectedRanges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedRanges.map((range, i) => (
                        <Badge key={i} variant="success" uppercase={false} className="gap-1">
                            {range.start === range.end ? formatDisplay(range.start) : `${formatDisplay(range.start)} → ${formatDisplay(range.end)}`}
                            <Button variant="ghost" onClick={(e) => {
                                    e.stopPropagation();
                                    const next = selectedRanges.filter((_, idx) => idx !== i);
                                    setSelectedRanges(next);
                                    onMultiChange && onMultiChange(next);
                                }}>×</Button>
                        </Badge>
                    ))}
                </div>
            )}
            {popup}
        </>
    );
};

export default RangeDatePicker;
