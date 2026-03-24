import React, { memo, useMemo, useEffect } from 'react';
import { CircleUserRound, Clock, Pencil, Flame, AlertTriangle } from 'lucide-react';

import { getRoleTheme, getDayConflictLocal, getTimeBlocks, calculateEmployeeWeeklyHoursLocal, timeToMins } from '../../../utils/scheduleHelpers'; 

// ============================================================================
// 🛠️ ICONOS CUSTOM
// ============================================================================
const IconLunch = ({ className, size = 12 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M11 2v13"/>
        <path d="M7 2v7c0 2.2 1.8 4 4 4"/>
        <path d="M15 2v13"/>
        <path d="M15 15h6"/>
        <path d="M21 2v13c0 2.2-1.8 4-4 4h-2"/>
    </svg>
);

const IconLactation = ({ className, size = 12 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
        <line x1="9" y1="9" x2="9.01" y2="9"/>
        <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
);

const formatMins12h = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const formatHourCompact = (h) => {
    const period = h >= 12 ? 'pm' : 'am';
    const hour12 = h % 12 || 12;
    return `${hour12}${period}`;
};

const formatNames = (setOfNames) => {
    const arr = Array.from(setOfNames);
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    const last = arr.pop();
    return arr.join(', ') + ' y ' + last;
};

// 🚨 FUNCIÓN PARA ACORTAR NOMBRES LARGOS
const formatShortName = (fullName) => {
    if (!fullName) return 'Personal';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
    if (parts.length >= 3) return `${parts[0]} ${parts[2]}`;
    return fullName;
};

// ============================================================================
// 🧠 CEREBRO DE SALY (EVALÚA HUECOS DIARIOS)
// ============================================================================
const evaluateDayCoverage = (dNum, allSchedules, shifts, daySalesStats) => {
    const coverageByHour = {};
    for (let h = 0; h < 24; h++) coverageByHour[h] = 0;
    
    const activeStaffNamesByMinute = new Array(1440).fill(null).map(() => new Set()); 
    const employeesOnLunch = new Array(1440).fill(null).map(() => new Set());
    let scheduledPeopleCount = 0;

    allSchedules.forEach(empSch => {
        const dayData = empSch[dNum];
        if (!dayData || dayData.isOff) return;

        const shift = shifts.find(s => String(s.id) === String(dayData.shiftId));
        const startStr = dayData.customStart || shift?.start_time?.substring(0, 5) || shift?.start;
        const endStr = dayData.customEnd || shift?.end_time?.substring(0, 5) || shift?.end;
        
        if (!startStr || !endStr) return;
        scheduledPeopleCount++;

        let startMins = timeToMins(startStr);
        let endMins = timeToMins(endStr);
        if (endMins < startMins) endMins += 1440;

        const empName = empSch.name || 'Personal';

        let startH = Math.floor(startMins / 60);
        let endH = Math.floor(endMins / 60);
        for (let h = startH; h < endH; h++) {
            let actualH = h >= 24 ? h - 24 : h;
            coverageByHour[actualH] += 1;
        }

        for (let m = startMins; m < endMins; m++) {
            let actualM = m >= 1440 ? m - 1440 : m;
            activeStaffNamesByMinute[actualM].add(empName);
        }

        if (dayData.hasLunch && dayData.lunchStart) {
            let lStart = timeToMins(dayData.lunchStart);
            let lEnd = lStart + 60; 
            for (let m = lStart; m < lEnd; m++) {
                let actualM = m >= 1440 ? m - 1440 : m;
                activeStaffNamesByMinute[actualM].delete(empName); 
                employeesOnLunch[actualM].add(empName); 
            }
        }
    });

    let rawGaps = [];
    let copilotAlerts = [];
    
    if (daySalesStats && daySalesStats.length > 0) {
        daySalesStats.forEach(stat => {
            const h = stat.hour;
            let minActiveInHour = 999;
            for(let m = h * 60; m < (h + 1) * 60; m++) {
                const count = activeStaffNamesByMinute[m].size;
                if (count < minActiveInHour) minActiveInHour = count;
            }
            if (minActiveInHour === 999) minActiveInHour = 0;
            
            if (stat.color === '#FF2D55' && minActiveInHour < 3) {
                rawGaps.push(h);
            }
        });
    }

    let criticalGaps = [];
    if (rawGaps.length > 0) {
        rawGaps = [...new Set(rawGaps)].sort((a, b) => a - b);
        criticalGaps = rawGaps.map(h => ({ 
            time: formatHourCompact(h) 
        }));
    }

    if (scheduledPeopleCount > 0) {
        let blocks = [];
        let currentBlock = null;

        for(let m = 0; m <= 1440; m++) {
            let activeNames = m < 1440 ? activeStaffNamesByMinute[m] : new Set();
            let eaters = m < 1440 ? employeesOnLunch[m] : new Set();
            let activeCount = activeNames.size;

            let stateKey = 'normal';
            let survivorName = null;

            if (eaters.size > 0) {
                if (activeCount === 0) {
                    stateKey = 'empty';
                } else if (activeCount === 1) {
                    stateKey = 'alone';
                    survivorName = Array.from(activeNames)[0]; 
                }
            }

            if (currentBlock && (currentBlock.stateKey !== stateKey || currentBlock.survivorName !== survivorName)) {
                blocks.push(currentBlock);
                currentBlock = null;
            }

            if (stateKey !== 'normal') {
                if (!currentBlock) {
                    currentBlock = {
                        startMin: m,
                        duration: 0,
                        stateKey: stateKey,
                        survivorName: survivorName,
                        eaters: new Set()
                    };
                }
                currentBlock.duration++;
                eaters.forEach(e => currentBlock.eaters.add(e));
            }
        }

        blocks.forEach(b => {
            const namesStr = formatNames(b.eaters);
            const timeStr = formatMins12h(b.startMin);

            if (b.stateKey === 'empty' && b.duration > 0) {
                copilotAlerts.push({
                    type: 'danger',
                    emp: null,
                    msg: `¡ALERTA CRÍTICA! El almuerzo de ${namesStr} a las ${timeStr} deja la sucursal COMPLETAMENTE VACÍA por ${b.duration} min.`
                });
            } else if (b.stateKey === 'alone' && b.duration >= 30) {
                const survivorStr = b.survivorName || '1 persona';
                copilotAlerts.push({
                    type: 'warning',
                    emp: null,
                    msg: `Riesgo Operativo: El almuerzo de ${namesStr} a las ${timeStr} deja a ${survivorStr} sin apoyo atendiendo por ${b.duration} min continuos. Se sugiere escalonar.`
                });
            }
        });
    }

    return { criticalGaps, copilotAlerts };
};

// ============================================================================
// ⚡ FILA MEMOIZADA (UN EMPLEADO)
// ============================================================================
const EmployeeScheduleRow = memo(({ emp, roster, shifts, calendarDates, onEditCell, isReadOnly }) => {
    let rawSchedule = roster || {};
    let sch = (typeof rawSchedule === 'string') ? JSON.parse(rawSchedule || '{}') : rawSchedule;
    
    // 🚨 CÁLCULO DE HORAS Y DÍAS LIBRES
    const hours = calculateEmployeeWeeklyHoursLocal(sch, shifts, emp.history, calendarDates);
    
    let daysOffCount = 0;
    calendarDates.forEach(date => {
        const dId = new Date(date + 'T00:00:00').getDay();
        const dayData = sch[dId] || {};
        const shift = shifts.find(s => String(s.id) === String(dayData.shiftId));
        const startStr = dayData.customStart || shift?.start_time?.substring(0, 5) || shift?.start;
        const endStr = dayData.customEnd || shift?.end_time?.substring(0, 5) || shift?.end;
        
        // Si tiene marcado isOff explícitamente, o no tiene turno asignado
        const hasShift = !dayData.isOff && startStr && endStr;
        if (!hasShift) daysOffCount++;
    });

    const isHoursPerfect = hours === 44;
    const isHoursOver = hours > 44;
    const isHoursUnder = hours < 44;
    const isDaysOffPerfect = daysOffCount === 1;

    // Configuración visual de la barra de progreso
    let barColor = 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]'; // Estado Perfecto
    if (isHoursOver || daysOffCount === 0) {
        barColor = 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'; // Infracción Grave
    } else if (isHoursUnder || daysOffCount > 1) {
        barColor = 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]'; // Falta rellenar
    }

    const shortName = formatShortName(emp.name);

    // 🚨 PARSER INTELIGENTE DE CARGOS Y CONTRACCIONES
    const rolesArray = useMemo(() => {
        const rawRoles = [];
        
        const addRoles = (roleData) => {
            if (!roleData) return;
            const rName = typeof roleData === 'object' ? roleData.name : roleData;
            if (rName) {
                const splitRoles = String(rName).split(/[,|]/).map(r => r.trim()).filter(Boolean);
                rawRoles.push(...splitRoles);
            }
        };

        addRoles(emp.role);
        addRoles(emp.secondary_role || emp.secondaryRole);

        const uniqueRoles = [];
        const seen = new Set();
        
        for (const raw of rawRoles) {
            const upper = raw.toUpperCase();
            let display = upper;
            
            if (upper.includes('SUBJEFE') || upper.includes('SUB JEFE')) {
                display = 'SUBJEFE';
            } else if (upper.includes('JEFE') || upper.includes('JEFA')) {
                display = 'JEFE';
            } else if (upper.includes('SUPERVISOR')) {
                display = 'SUPERVISOR';
            } else if (upper.includes('DEPENDIENTE')) {
                display = 'DEPENDIENTE';
            } else if (upper.includes('REGENTE DE ENFERMER')) {
                display = 'REG. ENFERMERÍA';
            } else if (upper === 'REGENTE') {
                display = 'REGENTE';
            } else if (upper.includes('AUXILIAR DE BODEGA')) {
                display = 'AUX. BODEGA';
            } else if (upper.includes('AUXILIAR DE SERVICIOS')) {
                display = 'AUX. SERVICIOS';
            } else if (upper.includes('TECNICO DE MANTENIMIENTO') || upper.includes('TÉCNICO DE MANTENIMIENTO')) {
                display = 'TÉC. MANTENIMIENTO';
            } else if (upper.includes('ASISTENTE DE LOGISTICA')) {
                display = 'ASIST. LOGÍSTICA';
            } else if (upper.includes('ASISTENTE DE MAYOREO')) {
                display = 'ASIST. MAYOREO';
            } else if (upper.includes('REFERENTE DE FARMACO')) {
                display = 'REF. FARMACOVIGILANCIA';
            } else if (upper.includes('AGENTE DE ATENCION')) {
                display = 'AGENTE DIGITAL';
            } else if (upper.includes('REPARTIDOR')) {
                display = 'REPARTIDOR';
            } else if (upper.includes('MEDICO') || upper.includes('MÉDICO')) {
                display = 'MÉDICO';
            } else if (upper.includes('GERENTE')) {
                display = 'GERENTE';
            } else if (upper.includes('ADMINISTRADOR')) {
                display = 'ADMINISTRADOR';
            }

            if (!seen.has(display)) {
                seen.add(display);
                uniqueRoles.push({ original: raw, display: display });
            }
        }

        if (uniqueRoles.length === 0) return [{ original: 'Colaborador', display: 'COLABORADOR' }];

        const totalChars = uniqueRoles.reduce((sum, r) => sum + r.display.length, 0) + (uniqueRoles.length - 1) * 2;
        if (totalChars > 26) {
            return uniqueRoles.map(r => {
                let d = r.display;
                d = d.replace(' ENFERMERÍA', ' ENF.');
                d = d.replace(' FARMACOVIGILANCIA', ' FARMACO.');
                d = d.replace(' MANTENIMIENTO', ' MANT.');
                d = d.replace(' LOGÍSTICA', ' LOG.');
                return { original: r.original, display: d };
            });
        }

        return uniqueRoles;
    }, [emp.role, emp.secondary_role, emp.secondaryRole]);

    return (
        <tr className="group/row relative transition-all duration-300 hover:z-50">
            <td className="p-0 sticky left-0 z-30 align-top group-hover/row:z-50 min-w-[240px] max-w-[240px] 2xl:min-w-[260px] 2xl:max-w-[260px]">
                <div className="min-h-[85px] h-full bg-white/60 backdrop-blur-3xl border border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] rounded-[2rem] p-3 mx-1 flex items-center gap-3 transition-all duration-300 group-hover/row:bg-white/95 group-hover/row:shadow-[0_20px_40px_rgba(0,0,0,0.12)] overflow-hidden">
                    <div className="w-10 h-10 2xl:w-12 2xl:h-12 rounded-xl bg-slate-100 overflow-hidden border border-white shadow-sm flex items-center justify-center shrink-0">
                        {emp.photo_url ? <img src={emp.photo_url} className="w-full h-full object-cover" alt="" /> : <CircleUserRound size={24} className="text-slate-300" />}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <h4 className="font-black text-slate-800 text-[12px] 2xl:text-[13px] truncate leading-tight mb-1 group-hover/row:text-[#007AFF] transition-colors" title={emp.name}>{shortName}</h4>
                        
                        <div className="flex items-center gap-1 mb-1.5 2xl:mb-2 w-full overflow-x-auto hide-scrollbar scroll-smooth">
                            {rolesArray.map((roleObj, idx) => {
                                const theme = getRoleTheme(roleObj.original);
                                return (
                                    <div key={idx} className={`w-fit px-1.5 py-0.5 rounded-[6px] border text-[7px] 2xl:text-[7.5px] font-black uppercase tracking-widest transition-colors whitespace-nowrap shrink-0 ${theme.bg} ${theme.text} ${theme.border}`}>
                                        {roleObj.display}
                                    </div>
                                );
                            })}
                        </div>

                        {/* 🚨 NUEVO PANEL DE AUDITORÍA SEMANAL EN LA TARJETA */}
                        <div className="flex flex-col gap-1 w-full mt-auto">
                            <div className="flex justify-between items-end gap-1">
                                <p className="text-[10px] 2xl:text-[11px] font-black uppercase tracking-widest flex items-center gap-1 shrink-0">
                                    <Clock size={10} className={isHoursPerfect ? 'text-emerald-500' : isHoursOver ? 'text-red-500' : 'text-amber-500'} /> 
                                    <span className={isHoursPerfect ? 'text-emerald-600' : isHoursOver ? 'text-red-600' : 'text-amber-600'}>{hours}h</span>
                                </p>
                                
                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                    {/* Validar Días Libres */}
                                    {!isDaysOffPerfect && (
                                        <span className={`text-[7px] 2xl:text-[7.5px] px-1.5 py-0.5 rounded font-black shadow-sm shrink-0 ${daysOffCount === 0 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-amber-100 text-amber-600'}`}>
                                            {daysOffCount === 0 ? '⚠️ SIN DESCANSO' : `${daysOffCount} LIBRES`}
                                        </span>
                                    )}
                                    {/* Validar Horas */}
                                    {!isHoursPerfect && (
                                        <span className={`text-[7px] 2xl:text-[7.5px] px-1.5 py-0.5 rounded font-black shadow-sm shrink-0 ${isHoursOver ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-amber-100 text-amber-600'}`}>
                                            {isHoursOver ? `+${Number((hours - 44).toFixed(1))}h` : `${Number((hours - 44).toFixed(1))}h`}
                                        </span>
                                    )}
                                    {/* Todo Perfecto */}
                                    {isHoursPerfect && isDaysOffPerfect && (
                                        <span className="text-[7px] 2xl:text-[7.5px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-black shadow-sm flex items-center gap-0.5 shrink-0">
                                            ✓ ÓPTIMO
                                        </span>
                                    )}
                                </div>
                            </div>
                            
                            <div className="h-1.5 bg-slate-200/50 rounded-full overflow-hidden shadow-inner shrink-0">
                                <div className={`h-full rounded-full transition-all duration-1000 ${barColor}`} style={{ width: `${Math.min((hours / 44) * 100, 100)}%` }} />
                            </div>
                        </div>

                    </div>
                </div>
            </td>

            {calendarDates.map(date => {
                const dId = new Date(date + 'T00:00:00').getDay();
                const conf = getDayConflictLocal(date, emp.history);
                const dayData = sch[dId] || {};
                const shift = shifts.find(s => String(s.id) === String(dayData.shiftId));

                const startStr = dayData.customStart || shift?.start_time?.substring(0, 5) || shift?.start;
                const endStr = dayData.customEnd || shift?.end_time?.substring(0, 5) || shift?.end;
                const hasShift = !dayData.isOff && startStr && endStr;

                let netShiftDurationHrs = 0;
                let isDailyOvertime = false;
                if (hasShift) {
                    let sMins = timeToMins(startStr);
                    let eMins = timeToMins(endStr);
                    if (eMins < sMins) eMins += 1440; 
                    
                    const grossMins = eMins - sMins;
                    const lunchMins = dayData.hasLunch ? 60 : 0; 
                    
                    const paidMins = grossMins - lunchMins; 
                    netShiftDurationHrs = (paidMins / 60).toFixed(1).replace('.0', '');
                    isDailyOvertime = paidMins > (8 * 60); 
                }

                const timeBlocks = hasShift ? getTimeBlocks(startStr, endStr, dayData.hasLunch, dayData.lunchStart, dayData.hasLactation, dayData.lactationStart) : [];

                return (
                    <td key={date} className={`p-0 align-top ${isReadOnly ? 'cursor-default' : 'group/cell cursor-pointer relative z-10 hover:z-[60]'}`} onClick={(e) => {
                        if (conf || isReadOnly) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        onEditCell(emp.id, dId, date, dayData, rect);
                    }}>
                        <div className={`min-h-[85px] h-full rounded-[1.2rem] mx-0.5 p-1.5 relative transition-all duration-300 flex flex-col 
                            ${!isReadOnly ? 'group-hover/cell:-translate-y-1 group-hover/cell:shadow-md' : ''}
                            ${conf ? conf.bg + ' border border-dashed ' + conf.border : 
                              hasShift ? `bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] ${!isReadOnly ? 'group-hover/cell:border-[#007AFF]/40' : ''}` : 
                              `border border-dashed border-slate-300/60 bg-slate-50/30 backdrop-blur-sm ${!isReadOnly ? 'group-hover/cell:bg-blue-50/50 group-hover/cell:border-[#007AFF]/40' : ''}`
                            }
                            ${isDailyOvertime && hasShift ? `!border-red-300 shadow-[inset_0_0_15px_rgba(239,68,68,0.1)] ${!isReadOnly ? 'group-hover/cell:!border-red-400' : ''}` : ''}
                        `}>
                            
                            {!conf && !isReadOnly && (
                                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#007AFF] text-white shadow-sm flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-all z-50 hover:bg-blue-600">
                                    <Pencil size={8} strokeWidth={2.5} />
                                </div>
                            )}
                            
                            <div className="relative z-10 w-full h-full flex flex-col">
                                {conf ? (
                                    <div className={`w-full flex-1 flex flex-col items-center justify-center ${conf.text}`}>
                                        <conf.icon className="w-4 h-4 2xl:w-[18px] 2xl:h-[18px] mb-1" strokeWidth={2.5} />
                                        <span className="text-[7.5px] 2xl:text-[8px] font-black uppercase text-center leading-tight truncate px-1">{conf.label}</span>
                                    </div>
                                ) : hasShift ? (
                                    <div className="flex flex-col h-full">
                                        <div className="flex items-start justify-between w-full mb-1">
                                            <span className="text-[7.5px] 2xl:text-[8px] font-black uppercase text-slate-800 bg-slate-100 border border-slate-200 px-1 py-[1px] rounded truncate max-w-[70%]">
                                                {shift?.name || 'Manual'}
                                            </span>
                                            <div className={`flex items-center gap-0.5 px-1 py-[1px] rounded border shadow-sm ${isDailyOvertime ? 'bg-red-50 border-red-200 text-red-600' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                                {isDailyOvertime && <Flame size={7} className="animate-pulse" />}
                                                <span className="text-[7px] 2xl:text-[7.5px] font-black tracking-tight">{netShiftDurationHrs}h</span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-[2px] mt-auto">
                                            {timeBlocks.map((block, idx) => {
                                                const isBreak = block.type !== 'work';
                                                const bgClass = block.type === 'lunch' ? 'bg-orange-50/80 text-orange-600 border border-orange-100/50' : 
                                                                block.type === 'lactation' ? 'bg-pink-50/80 text-pink-600 border border-pink-100/50' : 
                                                                'text-slate-700';
                                                
                                                return (
                                                    <div key={idx} className={`text-[8.5px] 2xl:text-[9.5px] font-bold font-mono tracking-tight flex items-center justify-between whitespace-nowrap ${isBreak ? 'px-1 py-[2px] rounded shadow-sm' : 'px-1 py-[2px]'} ${bgClass}`}>
                                                        <span className="truncate">{formatMins12h(block.start)} - {formatMins12h(block.end)}</span>
                                                        {isBreak && (
                                                            <div className="flex items-center justify-center opacity-80 pl-1 shrink-0">
                                                                {block.type === 'lunch' ? <IconLunch size={9}/> : <IconLactation size={9}/>}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`w-full flex-1 flex flex-col items-center justify-center text-slate-400 transition-colors ${!isReadOnly ? 'group-hover/cell:text-[#007AFF]' : ''}`}>
                                        <span className="text-[8px] font-black uppercase tracking-widest">Descanso</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </td>
                );
            })}
        </tr>
    );
}, (prev, next) => {
    return prev.emp.id === next.emp.id && 
           prev.roster === next.roster && 
           prev.calendarDates === next.calendarDates && 
           prev.shifts === next.shifts &&
           prev.isReadOnly === next.isReadOnly;
});

// ============================================================================
// 🚀 VISTA PRINCIPAL DEL CALENDARIO
// ============================================================================
const ScheduleCalendar = ({ isLoading, calendarDates, employeesInView, weeklyRosters, shifts, handleEditCell, salesStats, onSalyAlertsUpdate, isReadOnly }) => {
    
    const allSchedulesArray = useMemo(() => {
        return employeesInView.map(emp => {
            let rawSchedule = weeklyRosters[emp.id] || {}; 
            let parsed = (typeof rawSchedule === 'string') ? JSON.parse(rawSchedule || '{}') : rawSchedule;
            parsed.name = emp.name; 
            return parsed;
        });
    }, [employeesInView, weeklyRosters]);

    useEffect(() => {
        let weeklyCopilotAlerts = [];
        for (let dNum = 0; dNum < 7; dNum++) {
            const daySalesData = salesStats?.specificHours?.[dNum] || [];
            const result = evaluateDayCoverage(dNum, allSchedulesArray, shifts, daySalesData);
            if (result.copilotAlerts && result.copilotAlerts.length > 0) {
                const dayName = new Date(calendarDates[dNum] + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' });
                const alertsWithDay = result.copilotAlerts.map(a => ({...a, msg: `[${dayName.toUpperCase()}] ${a.msg}`}));
                weeklyCopilotAlerts = [...weeklyCopilotAlerts, ...alertsWithDay];
            }
        }
        
        if (onSalyAlertsUpdate) {
            onSalyAlertsUpdate(weeklyCopilotAlerts);
        }
    }, [allSchedulesArray, shifts, salesStats, calendarDates, onSalyAlertsUpdate]);

    return (
        <div className="w-full relative z-10 shrink-0 mt-4">
            <div id="schedule-table-scroll" className="overflow-x-auto hide-scrollbar pb-10 px-2 pt-4">
                <table className="w-full text-left border-separate border-spacing-y-2 border-spacing-x-1 min-w-full relative">
                    <thead className="relative z-[60]">
                        <tr>
                            <th className="p-0 sticky left-0 z-[70] min-w-[240px] max-w-[240px] 2xl:min-w-[260px] 2xl:max-w-[260px] bg-transparent align-bottom">
                                <div className="bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[0_4px_15px_rgba(0,0,0,0.03)] rounded-[1.5rem] p-3 mx-1 mb-2 mt-4 text-[9px] font-black uppercase text-slate-500 tracking-widest flex items-center justify-between">
                                    Personal <span className="bg-white/80 px-2 py-0.5 rounded-lg text-slate-400 border border-white">44H / 1 DESCANSO</span>
                                </div>
                            </th>
                            
                            {calendarDates.map((date) => {
                                const dNum = new Date(date + 'T00:00:00').getDay();
                                
                                const daySalesData = salesStats?.specificHours?.[dNum] || [];
                                const coverageData = evaluateDayCoverage(dNum, allSchedulesArray, shifts, daySalesData);

                                const dayOverallStat = salesStats?.days?.find(d => d.day === dNum);
                                const dayColor = dayOverallStat?.color;

                                let headerBg = "bg-slate-50/50 border-slate-200 shadow-sm";
                                let headerTextColor = "text-slate-500";
                                let dayTextColor = "text-slate-400";
                                
                                if (dayColor === '#FF2D55') { // Crítico (Rojo)
                                    headerBg = "bg-rose-50 border-rose-200 shadow-[0_4px_15px_rgba(244,63,94,0.05)]";
                                    headerTextColor = "text-rose-800";
                                    dayTextColor = "text-rose-500";
                                } else if (dayColor === '#FF9500') { // Pico (Naranja)
                                    headerBg = "bg-amber-50 border-amber-200 shadow-[0_4px_15px_rgba(245,158,11,0.05)]";
                                    headerTextColor = "text-amber-800";
                                    dayTextColor = "text-amber-600";
                                } else if (dayColor === '#007AFF') { // Normal (Azul)
                                    headerBg = "bg-blue-50 border-blue-200 shadow-[0_4px_15px_rgba(0,122,255,0.05)]";
                                    headerTextColor = "text-[#007AFF]";
                                    dayTextColor = "text-blue-500";
                                }

                                return (
                                    <th key={date} className="p-0 text-center min-w-[135px] 2xl:min-w-[150px] align-bottom group relative z-10 hover:z-[70]">
                                        <div className={`backdrop-blur-xl border shadow-sm rounded-[1.5rem] pt-4 pb-2 mx-1 mb-2 mt-4 flex flex-col items-center justify-center transition-all duration-300 relative group-hover:-translate-y-1 group-hover:shadow-md ${headerBg}`}>
                                            
                                            <div className="absolute bottom-[105%] left-0 right-0 flex justify-center px-1 z-20 pointer-events-none">
                                                <div className="flex flex-wrap justify-center items-end gap-[3px] w-full max-h-[40px] overflow-hidden">
                                                    {coverageData?.criticalGaps?.length > 0 && (
                                                        <>
                                                            {coverageData.criticalGaps.map((gap, i) => (
                                                                <span key={i} className="text-[6.5px] 2xl:text-[7px] font-black uppercase text-white bg-rose-500 border border-rose-600 px-1.5 py-[2px] rounded-md shadow-sm shrink-0 whitespace-nowrap">
                                                                    {gap.time}
                                                                </span>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`text-[9px] uppercase font-black tracking-wider mb-0.5 ${dayTextColor}`}>
                                                {new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' })}
                                            </div>
                                            <div className={`text-[20px] font-black leading-none ${headerTextColor}`}>
                                                {new Date(date + 'T00:00:00').getDate()}
                                            </div>
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="relative z-10">
                        {isLoading ? (
                            [...Array(4)].map((_, idx) => (
                                <tr key={idx} className="animate-pulse">
                                    <td className="p-0 sticky left-0 z-20">
                                        <div className="h-[90px] bg-white/40 rounded-[1.5rem] mx-1"></div>
                                    </td>
                                    {[...Array(7)].map((_, dIdx) => (
                                        <td key={dIdx} className="p-0"><div className="h-[90px] bg-white/20 rounded-[1.5rem] mx-1"></div></td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            employeesInView.map(emp => (
                                <EmployeeScheduleRow
                                    key={emp.id}
                                    emp={emp}
                                    roster={weeklyRosters[emp.id]}
                                    shifts={shifts}
                                    calendarDates={calendarDates}
                                    onEditCell={handleEditCell}
                                    isReadOnly={isReadOnly}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default memo(ScheduleCalendar);