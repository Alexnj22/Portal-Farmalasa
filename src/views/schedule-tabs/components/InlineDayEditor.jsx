import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Bot, Clock, Flame, AlertTriangle } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect'; 
import TimePicker12 from '../../../components/common/TimePicker12'; 
import { useStaffStore } from '../../../store/staffStore'; 
import { timeToMins, formatHourAMPM } from '../../../utils/scheduleHelpers';

// Helper para convertir 24h string ("16:00") a 12h string ("4:00 pm")
const formatTime12hStr = (time24) => {
    if (!time24) return '';
    const [h, m] = time24.split(':');
    let hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'pm' : 'am';
    hour = hour % 12 || 12;
    return `${hour}:${m} ${ampm}`;
};

const InlineDayEditor = memo(({ employee, dateStr, dayId, currentData, shifts, filterBranch, onClose, onSave, anchorRect }) => {
    const { branches } = useStaffStore(); 

    const [shiftId, setShiftId] = useState(() => {
        if (currentData?.shiftId) return String(currentData.shiftId);
        if (currentData?.isOff) return 'OFF';
        return '';
    });
    
    const [customStart, setCustomStart] = useState(currentData?.customStart || '');
    const [customEnd, setCustomEnd] = useState(currentData?.customEnd || '');
    const [hasLunch, setHasLunch] = useState(currentData?.hasLunch || false);
    const [lunchStart, setLunchStart] = useState(currentData?.lunchStart || '12:00');
    const [hasLactation, setHasLactation] = useState(currentData?.hasLactation || false);
    const [lactationStart, setLactationStart] = useState(currentData?.lactationStart || '15:00');

    const [pos, setPos] = useState({ top: -9999, left: -9999, opacity: 0 });
    const popoverRef = useRef(null);

    // 🚨 NUEVO: Referencia para rastrear cuando el usuario cambia el select manualmente
    const prevShiftIdRef = useRef(shiftId);

    const showTimePickers = shiftId !== 'OFF' && shiftId !== 'NO_SHIFTS';

    // ============================================================================
    // 🧠 CÁLCULO DE HORAS EN TIEMPO REAL (HORA LABORAL EFECTIVA)
    // ============================================================================
    const netHours = useMemo(() => {
        if (!customStart || !customEnd || !showTimePickers) return null;
        let sMins = timeToMins(customStart);
        let eMins = timeToMins(customEnd);
        if (eMins < sMins) eMins += 1440; 
        
        const grossMins = eMins - sMins;
        const lunchMins = hasLunch ? 60 : 0; 
        
        // Lactancia no resta horas pagadas, solo el almuerzo.
        const paidMins = grossMins - lunchMins; 
        return (paidMins / 60).toFixed(1).replace('.0', '');
    }, [customStart, customEnd, hasLunch, showTimePickers]);

    // ============================================================================
    // 🧠 AUDITORÍA SALY: SENTIDO COMÚN DE HORARIOS (LÍMITES LÓGICOS)
    // ============================================================================
    const timeAuditErrors = useMemo(() => {
        const errors = [];
        if (!showTimePickers || !customStart || !customEnd) return errors;

        const sMins = timeToMins(customStart);
        let eMins = timeToMins(customEnd);
        if (eMins < sMins) eMins += 1440; // Ajuste si cruza medianoche

        if (sMins === eMins && customStart !== '') {
            errors.push("La hora de entrada y salida no pueden ser iguales.");
            return errors;
        }

        // Regla General: El receso debe estar entre 1 hora antes de entrar y la hora de salida.
        const minValid = sMins - 60;
        const maxValid = eMins;

        const getAdjustedMins = (tStr) => {
            let m = timeToMins(tStr);
            // Si el turno cruzó medianoche y el receso es en la madrugada
            if (eMins > 1440 && m < sMins) m += 1440;
            return m;
        };

        if (hasLunch && lunchStart) {
            const lMins = getAdjustedMins(lunchStart);
            
            // 🚨 REGLA ESTRICTA DE ALMUERZO: Solo entre 11:00 AM (660) y 2:30 PM (870)
            if (lMins < 660 || lMins > 870) {
                errors.push(`El horario de almuerzo solo está permitido entre las 11:00 am y las 2:30 pm.`);
            } else if (lMins < minValid || lMins > maxValid) {
                // Sigue verificando que además tenga sentido con el turno
                errors.push(`El almuerzo (${formatTime12hStr(lunchStart)}) está fuera de los límites de este turno.`);
            }
        }

        if (hasLactation && lactationStart) {
            const lacMins = getAdjustedMins(lactationStart);
            // La lactancia no tiene ventana estricta universal, solo debe encajar en el turno
            if (lacMins < minValid || lacMins > maxValid) {
                errors.push(`La lactancia (${formatTime12hStr(lactationStart)}) está fuera de los límites lógicos del turno.`);
            }
        }

        if (hasLunch && hasLactation && lunchStart === lactationStart) {
            errors.push("El almuerzo y la lactancia no pueden chocar a la misma hora.");
        }

        return errors;
    }, [showTimePickers, customStart, customEnd, hasLunch, lunchStart, hasLactation, lactationStart]);

    // ============================================================================
    // 🧠 CEREBRO DE SALY: EXTRACCIÓN DEL HORARIO DIARIO DE LA SUCURSAL
    // ============================================================================
    const branchLimits = useMemo(() => {
        let minO = 1440; 
        let maxC = 0;
        let isClosedToday = false;
        let hasValidHours = false;

        const b = branches?.find(br => String(br.id) === String(filterBranch));
        if (b) {
            let sch = b.weekly_hours || b.settings?.schedule;
            if (typeof sch === 'string') {
                try { sch = JSON.parse(sch); } catch(e) { sch = null; }
            }

            if (sch && typeof sch === 'object') {
                const dayConfig = sch[dayId]; 
                
                if (dayConfig && !dayConfig.isClosed && !dayConfig.isOff && dayConfig.isOpen !== false) {
                    const cleanStart = String(dayConfig.start || dayConfig.open || '').replace(/[^0-9:]/g, '').trim();
                    const cleanEnd = String(dayConfig.end || dayConfig.close || '').replace(/[^0-9:]/g, '').trim();

                    if (cleanStart && cleanEnd) {
                        minO = timeToMins(cleanStart);
                        maxC = timeToMins(cleanEnd);
                        if (maxC < minO) maxC += 1440;
                        hasValidHours = true;
                    }
                } else if (dayConfig && (dayConfig.isClosed || dayConfig.isOff || dayConfig.isOpen === false)) {
                    isClosedToday = true;
                    hasValidHours = true; 
                }
            }
        }
        
        return { minOpen: minO, maxClose: maxC, isClosedToday, hasValidHours, branchName: b?.name || 'la sucursal' };
    }, [branches, filterBranch, dayId]);


    // ============================================================================
    // 🧠 CEREBRO DE SALY: FILTRO INTELIGENTE DEL CATÁLOGO
    // ============================================================================
    const filteredShifts = useMemo(() => {
        if (!shifts || !filterBranch) return [];
        
        const globalShifts = shifts.filter(s => {
            const isGlobal = !s.branch_id && !s.branchId || String(s.branch_id) === 'null' || String(s.branchId) === 'null';
            const isActive = s.is_active !== false && s.isActive !== false;
            return isGlobal && isActive;
        });

        if (!branchLimits.hasValidHours || branchLimits.isClosedToday) return [];

        return globalShifts.filter(s => {
            const sStartMins = timeToMins(s.start_time?.substring(0, 5) || s.start);
            let sEndMins = timeToMins(s.end_time?.substring(0, 5) || s.end);
            if (sEndMins < sStartMins) sEndMins += 1440;

            return sStartMins >= branchLimits.minOpen && sEndMins <= branchLimits.maxClose;
        });
    }, [shifts, filterBranch, branchLimits]);

    // 🚨 CORRECCIÓN: Actualización de horas vinculada al cambio manual del select
    useEffect(() => {
        if (shiftId !== prevShiftIdRef.current) {
            if (shiftId && shiftId !== 'OFF' && shiftId !== 'NO_SHIFTS') {
                const template = filteredShifts.find(s => String(s.id) === String(shiftId));
                if (template) {
                    setCustomStart(template.start_time?.substring(0, 5) || template.start);
                    setCustomEnd(template.end_time?.substring(0, 5) || template.end);
                }
            }
            prevShiftIdRef.current = shiftId;
        }
    }, [shiftId, filteredShifts]);

    useEffect(() => {
        if (popoverRef.current && anchorRect) {
            const popRect = popoverRef.current.getBoundingClientRect();
            
            let left = anchorRect.left + 10;
            let top;

            if (anchorRect.top > window.innerHeight / 2) {
                top = anchorRect.top - popRect.height - 10;
            } else {
                top = anchorRect.bottom + 10; 
            }

            if (top < 10) top = 10;
            if (top + popRect.height > window.innerHeight) {
                top = window.innerHeight - popRect.height - 10;
            }

            if (left + popRect.width > window.innerWidth) {
                left = window.innerWidth - popRect.width - 10;
            }

            setPos({ top, left, opacity: 1 });
        }
    }, [anchorRect, shiftId, hasLunch, hasLactation, timeAuditErrors.length]);

    useEffect(() => {
        const handleScroll = () => onClose();
        const tableScroll = document.getElementById('schedule-table-scroll');
        if (tableScroll) tableScroll.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            if (tableScroll) tableScroll.removeEventListener('scroll', handleScroll);
            window.removeEventListener('scroll', handleScroll);
        };
    }, [onClose]);

    const handleSave = () => {
        const isOffSelected = shiftId === 'OFF';
        const finalShiftId = (isOffSelected || shiftId === 'NO_SHIFTS') ? '' : shiftId;
        const finalIsOff = isOffSelected || (!finalShiftId && !customStart);

        onSave(dayId, {
            shiftId: finalShiftId, 
            customStart: finalIsOff ? '' : customStart, 
            customEnd: finalIsOff ? '' : customEnd, 
            hasLunch: finalIsOff ? false : hasLunch, 
            lunchStart: (hasLunch && !finalIsOff) ? lunchStart : null,
            hasLactation: finalIsOff ? false : hasLactation, 
            lactationStart: (hasLactation && !finalIsOff) ? lactationStart : null, 
            isOff: finalIsOff
        });
        onClose();
    };

    const shiftOptions = useMemo(() => {
        const baseOptions = [{ value: 'OFF', label: 'Libre / Descanso' }];

        if (!branchLimits.hasValidHours) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: '⚠️ Sin Horario Operativo' }];
        }
        if (branchLimits.isClosedToday) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: '🔒 Sucursal Cerrada Hoy' }];
        }
        if (filteredShifts.length === 0) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: '⚠️ Ningún turno global encaja' }];
        }

        return [
            ...baseOptions, 
            ...filteredShifts.map(s => {
                const startRaw = s.start_time?.substring(0, 5) || s.start?.substring(0, 5) || '';
                const endRaw = s.end_time?.substring(0, 5) || s.end?.substring(0, 5) || '';
                
                const startFormatted = formatTime12hStr(startRaw);
                const endFormatted = formatTime12hStr(endRaw);

                return { 
                    value: String(s.id), 
                    label: `${s.name} (${startFormatted} - ${endFormatted})` 
                };
            })
        ];
    }, [filteredShifts, branchLimits]);

    const isSaveDisabled = shiftId === 'NO_SHIFTS' || (!shiftId && !customStart) || timeAuditErrors.length > 0;

    return createPortal(
        <>
            <style>{`
                .editor-scrollbar::-webkit-scrollbar { width: 6px; }
                .editor-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .editor-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(148, 163, 184, 0.4); border-radius: 10px; }
            `}</style>
            
            <div className="fixed inset-0 z-[9990]" onClick={(e) => { e.stopPropagation(); onClose(); }}></div>

            <div
                ref={popoverRef}
                style={{ top: pos.top, left: pos.left, opacity: pos.opacity, visibility: pos.opacity === 0 ? 'hidden' : 'visible' }}
                className="fixed z-[9991] w-[290px] max-h-[85vh] bg-white/95 backdrop-blur-3xl rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,0.3)] border border-white transition-opacity duration-200 flex flex-col cursor-default transform-gpu overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-white/50 shrink-0 z-40">
                    <div>
                        <p className="text-[11px] font-black text-[#007AFF] uppercase tracking-widest leading-none mb-1">{new Date(dateStr + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' })}</p>
                        <p className="text-[14px] font-bold text-slate-700 leading-none">{new Date(dateStr + 'T00:00:00').getDate()}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-500 flex items-center justify-center transition-colors active:scale-95"><X size={16} strokeWidth={3} /></button>
                </div>

                <div className="px-4 pt-4 pb-2 shrink-0 relative z-[9999]">
                    <div className={`group/select hover:shadow-md transition-shadow duration-300 rounded-full relative ${shiftId === 'NO_SHIFTS' ? 'ring-2 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]' : ''}`}>
                        <LiquidSelect 
                            value={shiftId} 
                            onChange={setShiftId} 
                            options={shiftOptions} 
                            placeholder="Seleccionar Turno..." 
                            clearable={false} 
                            compact 
                        />
                    </div>
                </div>

                <div className="px-4 pb-4 space-y-4 overflow-y-auto editor-scrollbar flex-1 relative z-10">
                    
                    {shiftId === 'NO_SHIFTS' && (
                        <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl flex gap-2.5 animate-in zoom-in duration-300">
                            <Bot size={16} className="text-rose-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div>
                                <h4 className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-1">Auditoría Saly</h4>
                                {branchLimits.isClosedToday ? (
                                    <p className="text-[11px] font-medium text-rose-600/80 leading-snug">
                                        La sucursal está configurada como <strong>cerrada</strong> este día. Selecciona "Libre" o ajusta el horario en Configuración.
                                    </p>
                                ) : !branchLimits.hasValidHours ? (
                                    <p className="text-[11px] font-medium text-rose-600/80 leading-snug">
                                        Faltan los horarios operativos de {branchLimits.branchName}.
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-medium text-rose-600/80 leading-snug">
                                        El horario de hoy es de {formatHourAMPM(Math.floor(branchLimits.minOpen/60))} a {formatHourAMPM(Math.floor(branchLimits.maxClose/60))}. Ningún turno del catálogo encaja aquí.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {showTimePickers && (
                        <div className={`flex flex-col gap-3 p-3 bg-slate-50 border rounded-2xl shadow-[inset_0_1px_4px_rgba(0,0,0,0.02)] relative z-10 animate-in zoom-in-95 duration-200 ${timeAuditErrors.length > 0 ? 'border-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : 'border-slate-100'}`}>
                            
                            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                    <Clock size={10} /> Cálculo de Horas
                                </span>
                                {netHours !== null && timeAuditErrors.length === 0 && (
                                    <div className={`px-2 py-[2px] rounded border text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm transition-all duration-300 ${Number(netHours) > 8 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                                        {Number(netHours) > 8 && <Flame size={10} className="animate-pulse" />}
                                        {netHours}H TOTALES
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="group/time hover:-translate-y-0.5 transition-transform duration-300">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block group-hover/time:text-[#007AFF] transition-colors">Entrada</label>
                                    <TimePicker12 value={customStart} onChange={setCustomStart} />
                                </div>
                                <div className="group/time hover:-translate-y-0.5 transition-transform duration-300">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block group-hover/time:text-[#007AFF] transition-colors">Salida</label>
                                    <TimePicker12 value={customEnd} onChange={setCustomEnd} />
                                </div>
                            </div>
                        </div>
                    )}

                    {showTimePickers && (
                        <div className="space-y-3 relative z-10 animate-in fade-in duration-300">
                            
                            <div 
                                onClick={() => setHasLunch(!hasLunch)}
                                className="flex items-center justify-between bg-white border border-orange-100 p-3 rounded-2xl shadow-sm hover:shadow-md hover:border-orange-300 transition-all duration-300 group/row cursor-pointer"
                            >
                                <div className="flex items-center gap-2.5 pointer-events-none">
                                    <input 
                                        type="checkbox" 
                                        checked={hasLunch} 
                                        readOnly 
                                        className="w-4 h-4 rounded text-orange-500 border-orange-200 focus:ring-orange-500 transition-transform group-hover/row:scale-110" 
                                    />
                                    <span className="text-[12px] font-bold text-orange-600 group-hover/row:text-orange-700 transition-colors">Almuerzo</span>
                                </div>
                                {hasLunch && (
                                    <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-300" onClick={(e) => e.stopPropagation()}>
                                        <TimePicker12 value={lunchStart} onChange={setLunchStart} />
                                    </div>
                                )}
                            </div>

                            <div 
                                onClick={() => setHasLactation(!hasLactation)}
                                className="flex items-center justify-between bg-white border border-pink-100 p-3 rounded-2xl shadow-sm hover:shadow-md hover:border-pink-300 transition-all duration-300 group/row cursor-pointer"
                            >
                                <div className="flex items-center gap-2.5 pointer-events-none">
                                    <input 
                                        type="checkbox" 
                                        checked={hasLactation} 
                                        readOnly 
                                        className="w-4 h-4 rounded text-pink-500 border-pink-200 focus:ring-pink-500 transition-transform group-hover/row:scale-110" 
                                    />
                                    <span className="text-[12px] font-bold text-pink-600 group-hover/row:text-pink-700 transition-colors">Lactancia</span>
                                </div>
                                {hasLactation && (
                                    <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-300" onClick={(e) => e.stopPropagation()}>
                                        <TimePicker12 value={lactationStart} onChange={setLactationStart} />
                                    </div>
                                )}
                            </div>
                            
                        </div>
                    )}

                    {timeAuditErrors.length > 0 && (
                        <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl flex gap-2.5 animate-in slide-in-from-bottom-2 duration-300 shadow-sm mt-2">
                            <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div className="flex flex-col gap-1.5">
                                <h4 className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-0.5">Error de Lógica</h4>
                                {timeAuditErrors.map((err, i) => (
                                    <p key={i} className="text-[11px] font-medium text-rose-600/90 leading-snug">
                                        {err}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-slate-100 bg-white/50 shrink-0 z-30">
                    <button 
                        onClick={handleSave} 
                        disabled={isSaveDisabled}
                        className={`w-full py-3.5 text-[12px] font-black uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-2
                        ${isSaveDisabled 
                            ? 'bg-slate-100 text-slate-400 border border-slate-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.05)] cursor-not-allowed' 
                            : 'bg-gradient-to-r from-[#007AFF] to-[#005CE6] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 active:translate-y-0'}`}
                    >
                        {shiftId === 'OFF' ? 'Asignar Descanso' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
});

export default InlineDayEditor;