import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import AvatarConEstado from '../../../components/common/AvatarConEstado';
import Button from '../../../components/common/Button';
import Checkbox from '../../../components/common/Checkbox';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bot, Clock, Flame, AlertTriangle, CircleUserRound, Building2 } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect'; 
import TimePicker12 from '../../../components/common/TimePicker12'; 
import { useStaffStore } from '../../../store/staffStore'; 
import { timeToMins, formatHourAMPM, resolverTurnoDelDia, reparosDelDia } from '../../../utils/scheduleHelpers';
import ModalShell from '../../../components/common/ModalShell';
import HojaMovil from '../../../components/common/HojaMovil';
import useMediaQuery from '../../../hooks/useMediaQuery';
import { CORTE_TELEFONO } from '../../../components/common/usarExpediente';
import { clickable } from '../../../utils/clickable';
import { shortEmployeeName } from '../../../utils/nameUtils';
import { rotuloCampo } from '../../../utils/rotuloDeCampo';

// Helper para convertir 24h string ("16:00") a 12h string ("4:00 pm")
const formatTime12hStr = (time24) => {
    if (!time24) return '';
    const [h, m] = time24.split(':');
    let hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'pm' : 'am';
    hour = hour % 12 || 12;
    return `${hour}:${m} ${ampm}`;
};

const InlineDayEditor = memo(({ employee, dateStr, dayId, currentData, shifts, filterBranch, onClose, onSave, anchorRect, coverageMeta }) => {
    const branches = useStaffStore(s => s.branches);
    // El mismo corte que usa el resto del portal. Con un `useMediaQuery` propio
    // habría un ancho donde la celda es ficha y el editor se abre como popover.
    const enTelefono = useMediaQuery(CORTE_TELEFONO);

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

    const [pos, setPos] = useState({ top: -9999, left: -9999 });
    const [isVisible, setIsVisible] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    const popoverRef = useRef(null);

    // 🚨 NUEVO: Referencia para rastrear cuando el usuario cambia el select manualmente
    const prevShiftIdRef = useRef(shiftId);

    const showTimePickers = shiftId !== 'OFF' && shiftId !== 'NO_SHIFTS';

    // ── El día, resuelto ────────────────────────────────────────────────────
    // Sale de `resolverTurnoDelDia`, igual que la pantalla, el kiosco y la
    // planilla. Antes acá había una copia con su propia aritmética.
    const resuelto = useMemo(() => resolverTurnoDelDia({
        shiftId: showTimePickers ? shiftId : '',
        customStart, customEnd,
        hasLunch, lunchStart,
        hasLactation, lactationStart,
        isOff: !showTimePickers,
    }, shifts), [shiftId, customStart, customEnd, hasLunch, lunchStart, hasLactation, lactationStart, showTimePickers, shifts]);

    const netHours = resuelto.trabaja
        ? (resuelto.minutosPagados / 60).toFixed(1).replace('.0', '')
        : null;

    // ── El horario de atención de la sala ese día ────────────────────────────
    const branchLimits = useMemo(() => {
        let minO = 1440; 
        let maxC = 0;
        let isClosedToday = false;
        let hasValidHours = false;

        const b = branches?.find(br => String(br.id) === String(filterBranch));
        if (b) {
            let sch = b.weekly_hours || b.settings?.schedule;
            if (typeof sch === 'string') {
                try { sch = JSON.parse(sch); } catch { sch = null; }
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


    // ── Los turnos del catálogo que caben en el horario de la sala ───────────
    /* Lo que el reglamento no deja pasar en este día.
     *
     * Antes esto era una ventana FIJA: la pausa sólo se aceptaba entre las
     * 11:00 y las 14:30, un número escrito acá sin fuente. El reglamento
     * interno (Art. 18) tiene pausas a las 12:00, 13:00, 18:00 y 19:00 — o sea
     * que este editor rechazaba las pausas del PROPIO reglamento, y un turno de
     * cierre no podía tener descanso.
     *
     * Y la comparación entre almuerzo y lactancia era de IGUALDAD, así que
     * 12:00 contra 12:30 pasaba. El reglamento dice que la interrupción «no
     * podrá ser utilizada en la hora de almuerzo»: es solapamiento.
     *
     * También revisa contra el horario de atención de la sala, que hasta hoy
     * sólo se miraba para filtrar el desplegable: las horas escritas a mano
     * se guardaban fuera del horario sin una queja. */
    const reparos = useMemo(() => {
        if (!showTimePickers) return [];
        if (customStart && customEnd && timeToMins(customStart) === timeToMins(customEnd)) {
            return ['La hora de entrada y la de salida no pueden ser la misma.'];
        }
        return reparosDelDia(resuelto, branchLimits.hasValidHours && !branchLimits.isClosedToday
            ? { horaDeApertura: branchLimits.minOpen, horaDeCierre: branchLimits.maxClose }
            : {});
    }, [resuelto, showTimePickers, customStart, customEnd, branchLimits]);

    const filteredShifts = useMemo(() => {
        if (!shifts || !filterBranch) return [];
        
        const globalShifts = shifts.filter(s => {
            const isGlobal = !s.branch_id && !s.branchId || String(s.branch_id) === 'null' || String(s.branchId) === 'null';
            const isActive = s.is_active !== false && s.isActive !== false;
            return isGlobal && isActive;
        });

        if (!branchLimits.hasValidHours || branchLimits.isClosedToday) return [];

        const inRange = globalShifts.filter(s => {
            const sStartMins = timeToMins(s.start_time?.substring(0, 5) || s.start);
            let sEndMins = timeToMins(s.end_time?.substring(0, 5) || s.end);
            if (sEndMins < sStartMins) sEndMins += 1440;
            return sStartMins >= branchLimits.minOpen && sEndMins <= branchLimits.maxClose;
        });

        // Deduplicate by name+start+end — same grouping key as TabShifts catalog
        const seen = new Map();
        return inRange.filter(s => {
            const key = `${s.name}_${s.start_time || s.start}_${s.end_time || s.end}`;
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
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
                    // Y su PAUSA. Desde el 2026-08-27 el turno del catálogo la
                    // trae, así que asignarlo la deja puesta en vez de obligar a
                    // marcarla a mano en cada una de las 329 celdas de la semana.
                    if (template.lunch_start) {
                        setHasLunch(true);
                        setLunchStart(String(template.lunch_start).substring(0, 5));
                    }
                     
                }
            }
            prevShiftIdRef.current = shiftId;
        }
    }, [shiftId, filteredShifts]);

    useEffect(() => {
        if (enTelefono || !popoverRef.current || !anchorRect) return;
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

        setPos({ top, left });  
        // Give browser one frame to paint at scale(0.96) before animating in
        requestAnimationFrame(() => requestAnimationFrame(() => setIsVisible(true)));
    }, [anchorRect, shiftId, hasLunch, hasLactation, reparos.length, enTelefono]);

    /* Se cierra si la TABLA se desplaza, porque el popover queda anclado a una
     * celda que se movió. Ya NO se cierra con el scroll de la ventana:
     *
     *   window.addEventListener('scroll', () => onClose())
     *
     * En un teléfono eso lo cerraba con cualquier cosa —abrir el teclado del
     * selector de hora desplaza la ventana— y lo escrito se perdía sin guardar
     * y sin avisar. En el teléfono el editor es una hoja inferior, que no está
     * anclada a nada, así que no hay motivo para cerrarla al desplazarse. */
    useEffect(() => {
        if (enTelefono) return;
        const alDesplazar = () => onClose();
        const tabla = document.getElementById('schedule-table-scroll');
        if (tabla) tabla.addEventListener('scroll', alDesplazar, { passive: true });
        return () => { if (tabla) tabla.removeEventListener('scroll', alDesplazar); };
    }, [onClose, enTelefono]);

    const handleClose = () => {
        setIsExiting(true);
    };

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
        const baseOptions = [{ value: 'OFF', label: 'Libre / descanso' }];

        if (!branchLimits.hasValidHours) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: 'La sala no tiene horario' }];
        }
        if (branchLimits.isClosedToday) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: 'La sala cierra este día' }];
        }
        if (filteredShifts.length === 0) {
            return [...baseOptions, { value: 'NO_SHIFTS', label: 'Ningún turno cabe en este horario' }];
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

    const isSaveDisabled = shiftId === 'NO_SHIFTS' || (!shiftId && !customStart) || reparos.length > 0;

    const encabezado = (
        <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-surface-card overflow-hidden border border-border-card shadow-sm flex items-center justify-center shrink-0">
                {employee?.photo_url
                    ? <AvatarConEstado emp={employee} px={28} radio="rounded-full" marco="" />
                    : <CircleUserRound size={18} className="text-content-3" strokeWidth={1.5} />}
            </div>
            <div className="min-w-0">
                <p className="text-body font-black text-content truncate leading-tight" title={employee?.name}>{shortEmployeeName(employee)}</p>
                <p className="text-caption font-black text-brand-text uppercase tracking-widest leading-none mt-0.5 capitalize">
                    {new Date(dateStr + 'T00:00:00').toLocaleDateString('es-SV', { weekday: 'long' })}{' '}
                    <span className="text-content-3 font-bold">{new Date(dateStr + 'T00:00:00').getDate()}</span>
                </p>
            </div>
        </div>
    );

    const avisoDeCobertura = coverageMeta && (
        <div className="mx-4 mt-3 px-3 py-2 bg-chart-3/10 border border-chart-3/30 rounded-2xl flex gap-2 items-start shrink-0">
            <Building2 size={13} className="text-chart-3-text shrink-0 mt-0.5" strokeWidth={2.5} />
            <p className="text-caption font-bold text-chart-3-text leading-snug">
                Este turno sobreescribirá el horario de <strong>{coverageMeta.homeBranchName}</strong> para este día.
            </p>
        </div>
    );

    const cuerpo = (
        <>
                <div className="px-4 pt-4 pb-2 shrink-0 relative z-toast">
                    <div className={`group/select hover:shadow-md transition-shadow duration-[var(--dur-slow)] rounded-full relative ${shiftId === 'NO_SHIFTS' ? 'ring-2 ring-danger/45 shadow-[var(--shadow-glow-danger-md)]' : ''}`}>
                        <LiquidSelect 
                            value={shiftId} 
                            onChange={setShiftId} 
                            options={shiftOptions} 
                            placeholder="Seleccionar turno…" 
                            clearable={false} 
                            compact 
                        />
                    </div>
                </div>

                <div className="px-4 pb-4 space-y-4 overflow-y-auto hide-scrollbar flex-1 relative z-base">
                    
                    {shiftId === 'NO_SHIFTS' && (
                        <div className="bg-danger/10 border border-danger/30 p-3 rounded-2xl flex gap-2.5 animate-in zoom-in duration-[var(--dur-slow)]">
                            <Bot size={16} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div>
                                <h4 className="text-caption font-black text-danger-text uppercase tracking-widest mb-1">No se puede asignar</h4>
                                {branchLimits.isClosedToday ? (
                                    <p className="text-label font-medium text-danger-text/80 leading-snug">
                                        La sala está configurada como <strong>cerrada</strong> este día. Elige «Libre / descanso», o cámbiale el horario de atención en Sucursales.
                                    </p>
                                ) : !branchLimits.hasValidHours ? (
                                    <p className="text-label font-medium text-danger-text/80 leading-snug">
                                        Falta configurarle el horario de atención a {branchLimits.branchName}.
                                    </p>
                                ) : (
                                    <p className="text-label font-medium text-danger-text/80 leading-snug">
                                        La sala atiende de {formatHourAMPM(Math.floor(branchLimits.minOpen/60))} a {formatHourAMPM(Math.floor(branchLimits.maxClose/60))}. Ningún turno del catálogo cabe ahí.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {showTimePickers && (
                        <div data-surface="card" data-tono={reparos.length > 0 ? 'danger' : undefined}
                    className="flex flex-col gap-3 p-3 relative z-base animate-in zoom-in-95 duration-[var(--dur-base)]">
                            
                            <div className="flex items-center justify-between border-b border-divider pb-2">
                                <span className="text-micro font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                                    <Clock size={10} /> Horas del día
                                </span>
                                {netHours !== null && reparos.length === 0 && (
                                    <div className={`px-2 py-[2px] rounded border text-micro font-black uppercase tracking-widest flex items-center gap-1 shadow-sm transition-all duration-[var(--dur-slow)] ${Number(netHours) > 8 ? 'bg-danger/10 text-danger border-danger/30' : 'bg-success/10 text-success border-success/30'}`}>
                                        {Number(netHours) > 8 && <Flame size={10} className="animate-pulse" />}
                                        {netHours} h pagadas
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="group/time hover:translate-y-[var(--lift-hover)] transition-transform duration-[var(--dur-slow)]">
                                    <label className={`${rotuloCampo('text-content-2')} group-hover/time:text-brand-text transition-colors`}>Entrada</label>
                                    <TimePicker12 value={customStart} onChange={setCustomStart} />
                                </div>
                                <div className="group/time hover:translate-y-[var(--lift-hover)] transition-transform duration-[var(--dur-slow)]">
                                    <label className={`${rotuloCampo('text-content-2')} group-hover/time:text-brand-text transition-colors`}>Salida</label>
                                    <TimePicker12 value={customEnd} onChange={setCustomEnd} />
                                </div>
                            </div>
                        </div>
                    )}

                    {showTimePickers && (
                        <div className="space-y-3 relative z-base animate-in fade-in duration-[var(--dur-slow)]">
                            
                            <div 
                                {...clickable(() => setHasLunch(!hasLunch))}
                                className="flex items-center justify-between bg-surface-card-hover border border-chart-4/30 p-3 rounded-2xl hover:border-chart-4/40 transition-all duration-[var(--dur-slow)] group/row cursor-pointer"
                            >
                                <div className="flex items-center gap-2.5 pointer-events-none">
                                    <Checkbox checked={hasLunch} size="sm" />
                                    <span className="text-body-sm font-bold text-chart-4-text group-hover/row:text-chart-4-text transition-colors">Almuerzo</span>
                                </div>
                                {hasLunch && (
                                    <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-[var(--dur-slow)]" {...clickable((e) => e.stopPropagation())}>
                                        <TimePicker12 value={lunchStart} onChange={setLunchStart} />
                                    </div>
                                )}
                            </div>

                            <div 
                                {...clickable(() => setHasLactation(!hasLactation))}
                                className="flex items-center justify-between bg-surface-card-hover border border-chart-6/20 p-3 rounded-2xl hover:border-chart-6/40 transition-all duration-[var(--dur-slow)] group/row cursor-pointer"
                            >
                                <div className="flex items-center gap-2.5 pointer-events-none">
                                    <Checkbox checked={hasLactation} size="sm" />
                                    <span className="text-body-sm font-bold text-chart-6-text group-hover/row:text-chart-6-text transition-colors">Lactancia</span>
                                </div>
                                {hasLactation && (
                                    <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-[var(--dur-slow)]" {...clickable((e) => e.stopPropagation())}>
                                        <TimePicker12 value={lactationStart} onChange={setLactationStart} />
                                    </div>
                                )}
                            </div>
                            
                        </div>
                    )}

                    {reparos.length > 0 && (
                        <div className="bg-danger/10 border border-danger/30 p-3 rounded-2xl flex gap-2.5 animate-in slide-in-from-bottom-2 duration-[var(--dur-slow)] shadow-sm mt-2">
                            <AlertTriangle size={16} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div className="flex flex-col gap-1.5">
                                <h4 className="text-caption font-black text-danger-text uppercase tracking-widest mb-0.5">Revisa esto antes de guardar</h4>
                                {reparos.map((err, i) => (
                                    <p key={i} className="text-label font-medium text-danger-text/90 leading-snug">
                                        {err}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
        </>
    );


    const pieDeGuardar = (
        <Button size="lg" onClick={handleSave} disabled={isSaveDisabled} className="w-full">
            {shiftId === 'OFF' ? 'Asignar descanso' : 'Guardar cambios'}
        </Button>
    );

    /* En el teléfono NO es un popover.
     *
     * Era uno de 290px anclado a una celda de una matriz que se arrastra de
     * lado, encajado contra el borde con `window.innerHeight - 10` —o sea
     * ignorando el área segura— y que se cerraba con cualquier desplazamiento
     * de la ventana. Abrir el teclado del selector de hora desplaza la ventana:
     * el editor se cerraba solo y lo escrito se perdía.
     *
     * `ModalShell align="bottom"` + `HojaMovil` es el cuerpo canónico
     * (DESIGN.md §32): nace en gota del punto que se tocó, resuelve el área
     * segura y no está anclada a nada que se pueda mover. */
    if (enTelefono) {
        return (
            <ModalShell
                open={!isExiting}
                onClose={handleClose}
                align="bottom"
                maxWidthClass="max-w-none"
                surface={null}
                ariaLabel={`Horario de ${shortEmployeeName(employee)}`}
            >
                <HojaMovil
                    titulo={shortEmployeeName(employee)}
                    subtitulo={`${new Date(dateStr + 'T00:00:00').toLocaleDateString('es-SV', { weekday: 'long' })} ${new Date(dateStr + 'T00:00:00').getDate()}`}
                    icono={Clock}
                >
                    {avisoDeCobertura}
                    <div className="max-h-[60vh] overflow-y-auto hide-scrollbar">
                        {cuerpo}
                    </div>
                    <div className="pt-3">{pieDeGuardar}</div>
                </HojaMovil>
            </ModalShell>
        );
    }

    return createPortal(
        <>
            <div className="fixed inset-0 z-popover" onClick={(e) => { e.stopPropagation(); handleClose(); }}></div>

            <motion.div
                ref={popoverRef}
                style={{ top: pos.top, left: pos.left, visibility: pos.top === -9999 ? 'hidden' : 'visible' }}
                animate={isVisible && !isExiting ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                onAnimationComplete={() => { if (isExiting) onClose(); }}
                data-surface="dropdown"
                className="fixed z-popover w-[290px] max-h-[85vh] flex flex-col cursor-default transform-gpu overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center gap-3 px-4 py-3 border-b border-border-card bg-surface-card shrink-0 z-header">
                    {encabezado}
                    <Button variant="ghost" size="sm" icon={X} iconOnly onClick={handleClose} />
                </div>

                {avisoDeCobertura}

                {cuerpo}

                <div className="p-3 border-t border-border-card bg-surface-card shrink-0 z-tabs">
                    {pieDeGuardar}
                </div>
            </motion.div>
        </>,
        document.body
    );
});

export default InlineDayEditor;
