import React, { useState, useRef, useEffect } from 'react';
import Button from './Button';
import { createPortal } from 'react-dom';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';

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
    selectedDates = [],
    // ── D3.11 (2026-07-27) ─────────────────────────────────────────────
    // `compact`: el campo cerrado usaba texto de 16px en negrita, al lado de
    // tabs de 10px. Por eso "DD/MM/AAAA" se salía de su caja en la barra de
    // Historia de Sucursal y hubo que darle 168px. En compacto baja a 12px y
    // el control entra en ~118px. Va por prop, apagado por defecto, para no
    // encoger los usos de formulario sin querer.
    compact = false,
    // `shortcuts`: lo que más se hace con un filtro de fecha no es elegir un
    // día suelto, es "hoy" o "hace 30 días". Sin esto son entre 4 y 12 clics.
    // Se pasa una lista; `true` usa el juego por defecto. En un campo de
    // nacimiento o de vencimiento no tiene sentido, por eso no es automático.
    shortcuts = null,
}) => {
    const esTactil = useCoarsePointer();
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
        // Sincroniza los campos internos (día/mes/año) desde el prop `value` controlado
        if (value && typeof value === 'string' && value.includes('-')) {
            const parts = value.split('-');
            if (parts.length === 3) {
                setYVal(parts[0]); setMVal(parts[1]); setDVal(parts[2]); // eslint-disable-line react-hooks/set-state-in-effect
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
                setViewDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1)); // eslint-disable-line react-hooks/set-state-in-effect -- posiciona el calendario al abrir según el rango resaltado
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

    // Solo emite onChange cuando los 3 campos forman una fecha completa y
    // válida. Antes, cualquier estado incompleto (ej. solo el día tecleado)
    // caía al `else` y emitía onChange('') — eso disparaba el useEffect que
    // sincroniza dVal/mVal/yVal desde `value`, y como el valor quedaba vacío,
    // el efecto reseteaba los 3 campos locales a '' en CADA pulsación,
    // haciendo imposible teclear una fecha manualmente (solo funcionaba
    // eligiendo día/mes/año desde el calendario visual, que setea los 3 a la
    // vez). Mientras la fecha esté incompleta, simplemente no se emite nada —
    // el valor anterior del padre se conserva hasta que la nueva fecha quede
    // completa y válida.
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

    // Juego por defecto para filtros. `dias: 0` es hoy; negativos van al pasado.
    const SHORTCUTS_DEFAULT = [
        { label: 'Hoy', dias: 0 },
        { label: 'Ayer', dias: -1 },
        { label: 'Hace 7 días', dias: -7 },
        { label: 'Hace 30 días', dias: -30 },
        { label: 'Inicio de mes', inicioMes: true },
    ];
    const atajos = shortcuts === true ? SHORTCUTS_DEFAULT : (Array.isArray(shortcuts) ? shortcuts : null);

    const aplicarAtajo = (a) => {
        const d = new Date();
        if (a.inicioMes) d.setDate(1);
        else d.setDate(d.getDate() + (a.dias || 0));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        onChange(iso);
        setDVal(String(d.getDate()).padStart(2, '0'));
        setMVal(String(d.getMonth() + 1).padStart(2, '0'));
        setYVal(String(d.getFullYear()));
        setViewDate(d);
        setIsOpen(false);
    };

    // ── D3.12 (2026-07-27): variante táctil ───────────────────────────────
    // En un teléfono un popover anclado no funciona: se sale de la pantalla, los
    // días quedan de 32px cuando el dedo necesita 44, y con el teclado abierto
    // no entra. Es el mismo calendario y los mismos tokens —el portal entero se
    // ve igual, que era la condición— pero presentado como hoja inferior:
    // ancho completo, arrastre para cerrar, y respeta el área segura del iPhone.
    const envolver = (contenido) => esTactil ? (
        <div className="fixed inset-0 z-confirm flex items-end animate-in fade-in duration-200">
            <button type="button" aria-label="Cerrar" onClick={() => setIsOpen(false)}
                className="absolute inset-0 bg-scrim backdrop-blur-[2px]" />
            <div data-surface="sheet"
                className="relative w-full rounded-t-modal rounded-b-none px-4 pt-3 font-sans
                    animate-in slide-in-from-bottom duration-300
                    pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="w-10 h-1 rounded-full bg-content-3/30 mx-auto mb-3" />
                {contenido}
            </div>
        </div>
    ) : (
        <div
            ref={popoverRef}
            style={{ top: coords.top, left: coords.left, transform: coords.transform }}
            className={`absolute z-confirm animate-in fade-in zoom-in-95 duration-300 ${coords.origin}`}
        >
            <div data-surface="dropdown" className="p-4 md:p-5 w-[280px] font-sans">
                {contenido}
            </div>
        </div>
    );

    const popoverContent = isOpen && envolver(
        <>

                {atajos && (
                    <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-divider">
                        {/* `key` faltaba (salen de un `.map()`) y todos eran
                            `primary`: cinco rellenos azules seguidos, cada uno
                            gritando ser la acción principal. Son atajos —
                            secundarios y chicos. */}
                        {atajos.map(a => (
                            <Button key={a.label} size="sm" variant="secondary" onClick={() => aplicarAtajo(a)}>{a.label}</Button>
                        ))}
                    </div>
                )}

                <div className="flex justify-between items-center mb-5 px-1">
                    <Button variant="secondary" icon={ChevronLeft} iconOnly onClick={handlePrev} />
                    {/* D3.11: el salto a mes/año YA existía —el título ciclaba
                        days→months→years al hacer clic— pero se veía como texto
                        plano, así que nadie lo encontraba: para una fecha de
                        nacimiento la gente apretaba `‹` unas 300 veces. Ahora son
                        dos botones con chevron, cada uno directo a su modo. */}
                    <div className="flex items-center gap-1">
                        {currentMode === 'days' && (
                            <>
                                <Button variant="secondary" onClick={() => setCurrentMode('months')}>{MONTHS_SHORT[currentMonth]} <ChevronDown size={12} strokeWidth={3} className="opacity-60" /></Button>
                                <Button variant="secondary" onClick={() => setCurrentMode('years')}>{currentYear} <ChevronDown size={12} strokeWidth={3} className="opacity-60" /></Button>
                            </>
                        )}
                        {currentMode === 'months' && (
                            <Button variant="secondary" onClick={() => setCurrentMode('years')}>{currentYear} <ChevronDown size={12} strokeWidth={3} className="opacity-60" /></Button>
                        )}
                        {currentMode === 'years' && (
                            <span className="text-body-sm font-black text-content-2 uppercase tracking-widest px-3 py-1.5">
                                {startYear} - {startYear + 9}
                            </span>
                        )}
                    </div>
                    <Button variant="secondary" icon={ChevronRight} iconOnly onClick={handleNext} />
                </div>

                {currentMode === 'days' && (
                    <div className="animate-in fade-in duration-300" onMouseLeave={() => setHoverDate(null)}>
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {DAYS.map(d => <div key={d} className="text-center text-caption font-black text-content-2 uppercase tracking-wider">{d}</div>)}
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

                                // El fallback del `var()` era el mismo rgba que el token
                                // vino a reemplazar: nunca se usaba (el token está
                                // definido en `:root`) y falseaba el barrido de color.
                                let wrapperStyle = {};
                                if (inBetween) {
                                    wrapperStyle.backgroundColor = 'var(--state-selected-overlay)';
                                } else if (drawStart && drawEnd && drawStart.getTime() !== drawEnd.getTime()) {
                                    if (isStartBoundary) wrapperStyle.background = 'linear-gradient(90deg, transparent 50%, var(--state-selected-overlay) 50%)';
                                    if (isEndBoundary) wrapperStyle.background = 'linear-gradient(90deg, var(--state-selected-overlay) 50%, transparent 50%)';
                                }

                                // 🎨 APLICACIÓN DE ESTILOS (Prioridad: Seleccionado > Rango > Asueto)
                                let btnClass = (esTactil ? "w-11 h-11" : "w-8 h-8") + " mx-auto flex items-center justify-center rounded-full text-body-sm font-bold transition-all relative z-base ";
                                if (isSolidDot) {
                                    btnClass += "bg-brand text-white shadow-[var(--shadow-glow-brand)] scale-110";
                                } else if (inBetween) {
                                    btnClass += "text-brand-text hover:bg-surface-card-hover hover:shadow-sm";
                                } else if (holiday) {
                                    // 🚨 Estilo de Asueto
                                    btnClass += "text-danger font-black bg-danger/10 hover:bg-danger/20";
                                } else {
                                    btnClass += isToday
                                        ? "text-brand-text font-black hover:bg-surface-card-hover ring-1 ring-brand/30"
                                        : "text-content-2 hover:bg-surface-card-hover hover:text-brand-text";
                                }

                                return (
                                    <div 
                                        key={day} 
                                        className={`w-full ${esTactil ? "h-12" : "h-9"} flex items-center justify-center relative cursor-pointer`}
                                        style={wrapperStyle} 
                                        onMouseEnter={() => setHoverDate(cellDate)}
                                        title={holiday ? holiday.name : undefined} // Tooltip nativo para asuetos
                                    >
                                        <button type="button" onClick={() => handleDaySelect(day)} className={btnClass}>
                                            {day}
                                        </button>
                                        {/* Puntito decorativo inferior para asuetos */}
                                        {holiday && !isSolidDot && !inBetween && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-danger"></div>
                                        )}
                                        {/* Puntito para hoy */}
                                        {isToday && !isSolidDot && !holiday && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-brand"></div>
                                        )}
                                        {/* Puntito para días ya seleccionados (PERMISO) */}
                                        {selectedDates.includes(`${String(currentYear)}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`) && !isSolidDot && (
                                            <div className="absolute bottom-0 w-1 h-1 rounded-full bg-success"></div>
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
                            return <button key={month} type="button" onClick={() => handleMonthSelect(index)} className={`py-3 rounded-2xl text-body-sm font-bold transition-all transform-gpu uppercase tracking-wide ${isSelected ? 'bg-brand text-white shadow-lg scale-105' : 'text-content-2 hover:bg-surface-card-hover hover:text-brand-text'}`}>{month}</button>;
                        })}
                    </div>
                )}

                {currentMode === 'years' && (
                    <div className="grid grid-cols-3 gap-3 animate-in fade-in zoom-in-95 duration-300">
                        {years.map((year) => {
                            const isSelected = yVal === String(year);
                            const isOutRange = year < startYear || year > startYear + 9;
                            return <button key={year} type="button" onClick={() => handleYearSelect(year)} className={`py-3 rounded-2xl text-body-sm font-bold transition-all transform-gpu ${isSelected ? 'bg-brand text-white shadow-lg scale-105' : isOutRange ? 'text-content-3 opacity-50' : 'text-content-2 hover:bg-surface-card-hover hover:text-brand-text'}`}>{year}</button>;
                        })}
                    </div>
                )}
        </>
    );

    const IconToRender = CustomIcon || CalendarIcon;
    const hasValue = dVal || mVal || yVal;

    // ── Táctil: el campo NO es un campo ──────────────────────────────────
    // Reportado por el usuario: "en móvil el selector de fecha no funciona, al
    // tocar abre el teclado y el selector del portal no se ve bien". Y era
    // literal: los tres DD/MM/AAAA son `<input>`, así que tocarlos enfoca y el
    // sistema levanta el teclado numérico — que tapa media pantalla y, con
    // ella, la hoja del calendario que acababa de abrirse.
    //
    // Con el dedo nadie teclea `15/07/2026` teniendo un calendario con días de
    // 44px al lado. Así que en táctil los tres campos se renderizan como TEXTO
    // y el control entero es el disparador de la hoja. En escritorio no cambia
    // nada: ahí escribir la fecha sí es más rápido que navegar el calendario.
    //
    // Es la misma regla que ya aprendió `Switch` —sin `onChange` renderiza un
    // `<span>`, no un `<button>`—: si el control no se va a usar como campo,
    // no debe SER un campo. Un input de solo lectura seguiría enfocándose.
    const trioTactil = (
        <span className={`flex items-center flex-1 font-bold ${compact ? 'text-body-sm' : 'text-body-xl'}
            ${hasValue ? 'text-content' : 'text-content-3'}`}>
            {hasValue ? `${dVal || 'DD'}/${mVal || 'MM'}/${yVal || 'AAAA'}` : 'DD/MM/AAAA'}
        </span>
    );

    const trioEscritorio = (
        <div className="flex items-center flex-1">
            <input ref={dRef} type="text" inputMode="numeric" placeholder="DD" maxLength={2} value={dVal} onChange={handleD} onKeyDown={(e) => handleKeyDown(e, dVal, null, mRef)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('days'); }} className={`bg-transparent border-none outline-none font-bold text-center placeholder:text-content-3 ${compact ? "w-[20px] text-body-sm" : "w-[26px] text-body-xl"} ${dVal ? 'text-content' : ''}`} />
            <span className="text-content-3 font-medium mx-0.5 pointer-events-none">/</span>
            <input ref={mRef} type="text" inputMode="numeric" placeholder="MM" maxLength={2} value={mVal} onChange={handleM} onKeyDown={(e) => handleKeyDown(e, mVal, dRef, yRef)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('months'); }} className={`bg-transparent border-none outline-none font-bold text-center placeholder:text-content-3 ${compact ? "w-[22px] text-body-sm" : "w-[28px] text-body-xl"} ${mVal ? 'text-content' : ''}`} />
            <span className="text-content-3 font-medium mx-0.5 pointer-events-none">/</span>
            <input ref={yRef} type="text" inputMode="numeric" placeholder="AAAA" maxLength={4} value={yVal} onChange={handleY} onKeyDown={(e) => handleKeyDown(e, yVal, mRef, null)} onClick={(e) => e.stopPropagation()} onFocus={() => { if(!isOpen) openPicker(); setCurrentMode('years'); }} className={`bg-transparent border-none outline-none font-bold text-center placeholder:text-content-3 ${compact ? "w-[35px] text-body-sm" : "w-[44px] text-body-xl"} ${yVal ? 'text-content' : ''}`} />
        </div>
    );

    return (
        <>
            <div
                ref={containerRef}
                // En táctil el contenedor ES el botón: sin esto el foco de
                // teclado no llegaba a un control que ya no tiene inputs.
                role={esTactil ? 'button' : undefined}
                tabIndex={esTactil ? 0 : undefined}
                aria-haspopup={esTactil ? 'dialog' : undefined}
                aria-expanded={esTactil ? isOpen : undefined}
                aria-label={esTactil ? (hasValue ? `Fecha ${dVal}/${mVal}/${yVal}, cambiar` : 'Elegir fecha') : undefined}
                onKeyDown={esTactil ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } } : undefined}
                className={`w-full h-full flex items-center gap-1 rounded-xl transition-all hover:bg-surface-card-hover group/picker focus-within:bg-surface-card-hover
                    ${esTactil ? 'cursor-pointer min-h-[44px]' : 'cursor-text'}
                    ${compact ? "px-2.5 min-w-[112px]" : "px-3 md:px-4 min-w-[140px]"}`}
                onClick={() => {
                    if (!isOpen) openPicker();
                    if (esTactil) return;
                    if (!dVal) dRef.current?.focus(); else if (!mVal) mRef.current?.focus(); else if (!yVal) yRef.current?.focus();
                }}>
                <IconToRender size={14} className={hasValue ? "text-brand-text" : "text-content-3 group-hover/picker:text-brand-text transition-colors shrink-0 mr-1.5"} strokeWidth={2.5} />
                {esTactil ? trioTactil : trioEscritorio}
                {hasValue && (
                    <div role="button" onClick={(e) => { e.stopPropagation(); onChange(''); setDVal(''); setMVal(''); setYVal(''); }} className={`flex items-center justify-center rounded-full hover:bg-danger/10 text-content-3 hover:text-danger transition-all shrink-0 cursor-pointer ${esTactil ? 'w-11 h-11 -mr-2' : 'w-6 h-6'}`} title="Borrar fecha">
                        <X size={14} strokeWidth={3} />
                    </div>
                )}
            </div>
            {isOpen && createPortal(popoverContent, document.body)}
        </>
    );
};

export default LiquidDatePicker;