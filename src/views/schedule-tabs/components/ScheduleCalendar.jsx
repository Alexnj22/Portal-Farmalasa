import React, { memo, useMemo, useEffect, useState } from 'react';
import { CircleUserRound, Clock, Pencil, Flame, AlertTriangle, Building2, Plus, X as XIcon, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { tokenMatch } from '../../../utils/searchUtils';
import { shortEmployeeName } from '../../../utils/nameUtils';

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
const EmployeeScheduleRow = memo(({ emp, roster, shifts, calendarDates, onEditCell, isReadOnly, apoyoDaysByDow }) => {
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

    const shortName = shortEmployeeName(emp);

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

        if (uniqueRoles.length === 0) return [{ original: 'Empleado', display: 'EMPLEADO' }];

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
        <tr className="group/row relative transition-[z-index] duration-150 hover:z-50">
            <td className="p-0 sticky left-0 z-30 align-top h-px group-hover/row:z-50 min-w-[156px] max-w-[156px] 2xl:min-w-[172px] 2xl:max-w-[172px]">
                <div className="min-h-[72px] h-full bg-white/60 backdrop-blur-xl border border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] rounded-[2rem] p-2.5 mx-1 flex items-center gap-2 transition-transform duration-150 group-hover/row:scale-[1.01] overflow-hidden">
                    <div className="w-9 h-9 2xl:w-10 2xl:h-10 rounded-xl bg-white/30 backdrop-blur-md border border-white/60 shadow-[inset_0_1px_4px_rgba(255,255,255,0.7)] overflow-hidden flex items-center justify-center shrink-0">
                        {emp.photo_url ? <img src={emp.photo_url} className="w-full h-full object-cover" alt="" /> : <CircleUserRound size={24} className="text-slate-300" />}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <h4 className="font-black text-slate-800 text-[12px] 2xl:text-[13px] truncate leading-tight mb-1" title={emp.name}>{shortName}</h4>
                        
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

                const apoyoBranch = apoyoDaysByDow?.[dId];

                return (
                    <td key={date} className={`p-0 align-top h-px ${(isReadOnly || apoyoBranch) ? 'cursor-default' : 'group/cell cursor-pointer relative z-10 hover:z-[60]'}`} onClick={(e) => {
                        if (conf || isReadOnly || apoyoBranch) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        onEditCell(emp.id, dId, date, dayData, rect);
                    }}>
                        <div className={`h-full rounded-[1.2rem] mx-0.5 p-1.5 relative transition-transform duration-150 flex flex-col
                            ${(!isReadOnly && !apoyoBranch) ? 'group-hover/cell:scale-[1.03]' : ''}
                            ${apoyoBranch ? 'bg-violet-50 border border-violet-200 shadow-[0_2px_8px_rgba(139,92,246,0.08)]' :
                              conf ? conf.bg + ' border border-dashed ' + conf.border :
                              hasShift ? 'bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)]' :
                              'border border-dashed border-slate-300/60 bg-slate-50/30 backdrop-blur-sm'
                            }
                            ${!apoyoBranch && isDailyOvertime && hasShift ? '!border-red-300 shadow-[inset_0_0_15px_rgba(239,68,68,0.1)]' : ''}
                        `}>

                            {!conf && !isReadOnly && !apoyoBranch && (
                                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#0052CC] text-white shadow-sm flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-all z-50 hover:bg-blue-600">
                                    <Pencil size={8} strokeWidth={2.5} />
                                </div>
                            )}

                            <div className="relative z-10 w-full h-full flex flex-col">
                                {apoyoBranch ? (
                                    <div className="w-full flex-1 flex flex-col items-center justify-center gap-1">
                                        <Building2 size={11} className="text-violet-400" strokeWidth={2} />
                                        <span className="text-[7px] font-black uppercase tracking-widest text-violet-600">Apoyo</span>
                                        <span className="text-[6.5px] font-bold text-violet-400 text-center leading-tight truncate px-1">{apoyoBranch}</span>
                                    </div>
                                ) : conf ? (
                                    <div className={`w-full flex-1 flex flex-col items-center justify-center ${conf.text}`}>
                                        <conf.icon className="w-4 h-4 2xl:w-[18px] 2xl:h-[18px] mb-1" strokeWidth={2.5} />
                                        <span className="text-[7.5px] 2xl:text-[8px] font-black uppercase text-center leading-tight truncate px-1">{conf.label}</span>
                                        {hasShift && (
                                            <span className="text-[6.5px] font-bold mt-1 opacity-60 truncate px-1 text-center leading-tight">
                                                {shift?.name || 'Manual'} · {netShiftDurationHrs}h
                                            </span>
                                        )}
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
                                    <div className="w-full flex-1 flex flex-col items-center justify-center text-slate-400">
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
           prev.isReadOnly === next.isReadOnly &&
           prev.apoyoDaysByDow === next.apoyoDaysByDow;
});

// ============================================================================
// 🔀 FILA DE EMPLEADO DE COBERTURA (OTRA SUCURSAL)
// ============================================================================
const fmt12h = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
};

const CoverageEmployeeRow = memo(({ emp, homeBranch, homeRoster, coverageDaysByDow, calendarDates, shifts, onEditCell, onRemove }) => {
    const shortName = shortEmployeeName(emp);
    const parsedHomeRoster = useMemo(() => {
        if (!homeRoster) return {};
        return typeof homeRoster === 'string' ? JSON.parse(homeRoster || '{}') : homeRoster;
    }, [homeRoster]);

    return (
        <tr className="group/row relative transition-[z-index] duration-150 hover:z-50">
            <td className="p-0 sticky left-0 z-30 align-top h-px group-hover/row:z-50 min-w-[156px] max-w-[156px] 2xl:min-w-[172px] 2xl:max-w-[172px]">
                <div className="min-h-[72px] h-full bg-indigo-50/80 backdrop-blur-xl border border-indigo-200/60 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(99,102,241,0.06)] rounded-[2rem] p-2.5 mx-1 flex items-center gap-2 transition-transform duration-150 group-hover/row:scale-[1.01] overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-white/60 border border-indigo-200/60 overflow-hidden flex items-center justify-center shrink-0">
                        {emp.photo_url ? <img src={emp.photo_url} className="w-full h-full object-cover" alt="" /> : <CircleUserRound size={22} className="text-indigo-200" />}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden gap-0.5">
                        <h4 className="font-black text-slate-800 text-[12px] truncate leading-tight" title={emp.name}>{shortName}</h4>
                        <div className="flex items-center gap-1">
                            <Building2 size={9} className="text-indigo-400 shrink-0" strokeWidth={2} />
                            <span className="text-[9px] font-bold text-indigo-500 truncate">{homeBranch?.name || 'Otra sucursal'}</span>
                        </div>
                        <div className="mt-0.5 px-1.5 py-[2px] bg-indigo-100 border border-indigo-200/80 rounded-full w-fit">
                            <span className="text-[7px] font-black uppercase tracking-widest text-indigo-600">APOYO</span>
                        </div>
                    </div>
                    <button onClick={onRemove} className="w-7 h-7 rounded-full bg-white/70 hover:bg-red-50 text-slate-400 hover:text-red-500 flex items-center justify-center transition-colors shrink-0" title="Quitar cobertura">
                        <XIcon size={12} strokeWidth={2.5} />
                    </button>
                </div>
            </td>

            {calendarDates.map(date => {
                const dId = new Date(date + 'T00:00:00').getDay();
                const coverageData = coverageDaysByDow?.[dId];
                const homeData = parsedHomeRoster[dId] || {};
                const displayData = coverageData || homeData;
                const isCoverageDay = Boolean(coverageData);

                const shift = shifts.find(s => String(s.id) === String(displayData?.shiftId));
                const startStr = displayData?.customStart || shift?.start_time?.substring(0, 5) || shift?.start;
                const endStr   = displayData?.customEnd   || shift?.end_time?.substring(0, 5)   || shift?.end;
                const hasShift = !displayData?.isOff && startStr && endStr;

                const netHrs = (() => {
                    if (!hasShift) return '';
                    let s = timeToMins(startStr), e = timeToMins(endStr);
                    if (e < s) e += 1440;
                    const paid = e - s - (displayData?.hasLunch ? 60 : 0);
                    return (paid / 60).toFixed(1).replace('.0', '');
                })();

                return (
                    <td key={date} className="p-0 align-top h-px group/cell cursor-pointer relative z-10 hover:z-[60]"
                        onClick={e => onEditCell(emp, dId, date, isCoverageDay ? coverageData : null, e.currentTarget.getBoundingClientRect(), homeBranch)}>
                        <div className={`h-full rounded-[1.2rem] mx-0.5 p-1.5 relative transition-transform duration-150 flex flex-col group-hover/cell:scale-[1.03]
                            ${isCoverageDay
                                ? 'bg-indigo-50 border border-indigo-300 shadow-[0_2px_8px_rgba(99,102,241,0.10)]'
                                : hasShift
                                    ? 'bg-white/50 border border-slate-200/50 opacity-40'
                                    : 'border border-dashed border-slate-200/40 bg-slate-50/10 opacity-30'
                            }`}>
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-all z-50 shadow-sm
                                ${isCoverageDay ? 'bg-indigo-500 text-white' : 'bg-slate-400 text-white'}">
                                {isCoverageDay ? <Pencil size={8} strokeWidth={2.5} /> : <Plus size={8} strokeWidth={2.5} />}
                            </div>

                            <div className="relative z-10 w-full h-full flex flex-col">
                                {hasShift ? (
                                    <div className="flex flex-col h-full">
                                        <div className="flex items-start justify-between w-full mb-1">
                                            <span className={`text-[7.5px] font-black uppercase px-1 py-[1px] rounded border truncate max-w-[68%]
                                                ${isCoverageDay ? 'text-indigo-700 bg-indigo-100 border-indigo-200' : 'text-slate-400 bg-slate-50 border-slate-100'}`}>
                                                {shift?.name || 'Manual'}
                                            </span>
                                            <span className={`text-[7px] font-black px-1 py-[1px] rounded border
                                                ${isCoverageDay ? 'text-indigo-500 bg-indigo-50 border-indigo-100' : 'text-slate-300 bg-slate-50 border-slate-100'}`}>
                                                {netHrs}h
                                            </span>
                                        </div>
                                        <div className={`text-[8px] font-bold font-mono tracking-tight mt-auto ${isCoverageDay ? 'text-indigo-600' : 'text-slate-300'}`}>
                                            {fmt12h(startStr)} - {fmt12h(endStr)}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full flex-1 flex items-center justify-center">
                                        {isCoverageDay
                                            ? <span className="text-[7.5px] font-black uppercase text-indigo-400">Libre</span>
                                            : <span className="text-[8px] font-black text-slate-200">—</span>
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    </td>
                );
            })}
        </tr>
    );
});

// ============================================================================
// 🚀 VISTA PRINCIPAL DEL CALENDARIO
// ============================================================================
const ScheduleCalendar = memo(({
    isLoading, calendarDates, employeesInView, weeklyRosters, shifts,
    handleEditCell, salesStats, onSalyAlertsUpdate, isReadOnly,
    coveragesAtBranch = [], coveragesFromBranch = [], coverageRosters = {},
    addedCoverageEmpIds = new Set(), allEmployees = [], branches = [],
    currentBranchId, onAddCoverageEmployee, onRemoveCoverageEmployee, onEditCoverageCell,
}) => {
    const [showCoverageSearch, setShowCoverageSearch] = useState(false);
    const [coverageSearchTerm, setCoverageSearchTerm] = useState('');

    const allSchedulesArray = useMemo(() => {
        return employeesInView.map(emp => {
            let rawSchedule = weeklyRosters[emp.id] || {};
            const parsed = (typeof rawSchedule === 'string') ? JSON.parse(rawSchedule || '{}') : rawSchedule;
            return { ...parsed, name: emp.name };
        });
    }, [employeesInView, weeklyRosters]);

    // Compute coverage once per dep-change; reused in both thead and copilot effect.
    const coverageByDay = useMemo(() => {
        const result = {};
        calendarDates.forEach(date => {
            const dNum = new Date(date + 'T00:00:00').getDay();
            result[dNum] = evaluateDayCoverage(
                dNum, allSchedulesArray, shifts,
                salesStats?.specificHours?.[dNum] || []
            );
        });
        return result;
    }, [allSchedulesArray, shifts, salesStats, calendarDates]);

    // Coverage employees to show in the calendar
    const coverageEmpIds = useMemo(() => {
        const fromDb = new Set((coveragesAtBranch || []).map(e => e.employee_id));
        const added  = addedCoverageEmpIds instanceof Set ? addedCoverageEmpIds : new Set(addedCoverageEmpIds);
        return [...new Set([...fromDb, ...added])];
    }, [coveragesAtBranch, addedCoverageEmpIds]);

    const coverageEmployeesData = useMemo(() => {
        return coverageEmpIds.map(empId => {
            const emp = allEmployees.find(e => e.id === empId);
            if (!emp) return null;
            const homeBranch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
            const homeRoster = coverageRosters[empId] || {};
            const coverageDaysByDow = {};
            (coveragesAtBranch || []).filter(c => c.employee_id === empId)
                .forEach(c => { coverageDaysByDow[c.day_of_week] = c.schedule_data; });
            return { emp, homeBranch, homeRoster, coverageDaysByDow };
        }).filter(Boolean);
    }, [coverageEmpIds, allEmployees, branches, coverageRosters, coveragesAtBranch]);

    // "Apoyo" days by employee id for the home-branch badge
    const apoyoByEmp = useMemo(() => {
        const map = {};
        (coveragesFromBranch || []).forEach(c => {
            const targetBranch = branches.find(b => String(b.id) === String(c.coverage_branch_id));
            if (!map[c.employee_id]) map[c.employee_id] = {};
            map[c.employee_id][c.day_of_week] = targetBranch?.name || 'Otra sucursal';
        });
        return map;
    }, [coveragesFromBranch, branches]);

    // Coverage employee search results
    const coverageSearchResults = useMemo(() => {
        if (!coverageSearchTerm.trim()) return [];
        const alreadyAdded = new Set(coverageEmpIds);
        return (allEmployees || []).filter(e => {
            if (String(e.branchId || e.branch_id) === String(currentBranchId)) return false;
            if (alreadyAdded.has(e.id)) return false;
            if ((e.status || '').toUpperCase() === 'INACTIVO') return false;
            return tokenMatch(coverageSearchTerm, e.name);
        }).slice(0, 8);
    }, [coverageSearchTerm, coverageEmpIds, allEmployees, currentBranchId]);

    useEffect(() => {
        let weeklyCopilotAlerts = [];
        calendarDates.forEach(date => {
            const dNum = new Date(date + 'T00:00:00').getDay();
            const result = coverageByDay[dNum];
            if (result?.copilotAlerts?.length > 0) {
                const dayName = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' });
                weeklyCopilotAlerts = [
                    ...weeklyCopilotAlerts,
                    ...result.copilotAlerts.map(a => ({ ...a, msg: `[${dayName.toUpperCase()}] ${a.msg}` }))
                ];
            }
        });
        if (onSalyAlertsUpdate) onSalyAlertsUpdate(weeklyCopilotAlerts);
    }, [coverageByDay, calendarDates, onSalyAlertsUpdate]);

    return (
        <div className="w-full relative z-10 shrink-0 mt-4">
            <div id="schedule-table-scroll" className="overflow-x-auto hide-scrollbar pb-10 px-2 pt-4" style={{ overflowAnchor: 'none' }}>
                <table className="w-full text-left border-separate border-spacing-y-2 border-spacing-x-1 min-w-full relative">
                    <thead className="relative z-[60]">
                        <tr>
                            <th className="p-0 sticky left-0 z-[70] min-w-[192px] max-w-[192px] 2xl:min-w-[208px] 2xl:max-w-[208px] bg-transparent align-bottom">
                                <div className="bg-white/50 backdrop-blur-2xl border border-white/80 shadow-[0_4px_15px_rgba(0,0,0,0.03)] rounded-[1.5rem] pt-4 pb-2 px-3 mx-1 mb-2 mt-4 text-[9px] font-black uppercase text-slate-500 tracking-widest flex flex-col items-center justify-center gap-1">
                                    Personal <span className="bg-white/80 px-2 py-0.5 rounded-lg text-slate-400 border border-white">44H / 1 DESCANSO</span>
                                </div>
                            </th>
                            
                            {calendarDates.map((date) => {
                                const dNum = new Date(date + 'T00:00:00').getDay();
                                const coverageData = coverageByDay[dNum] || {};
                                const dayOverallStat = salesStats?.days?.find(d => d.day === dNum);
                                const dayColor = dayOverallStat?.color;

                                let headerBg = "bg-[#0052CC]/5 border-[#0052CC]/10 shadow-sm";
                                let headerTextColor = "text-slate-500";
                                let dayTextColor = "text-slate-400";
                                
                                if (dayColor === '#FF2D55') { // Crítico (Rojo)
                                    headerBg = "bg-rose-50 border-rose-200 shadow-[0_4px_15px_rgba(244,63,94,0.05)]";
                                    headerTextColor = "text-rose-800";
                                    dayTextColor = "text-rose-500";
                                } else if (dayColor === '#F79009') { // Pico (Naranja)
                                    headerBg = "bg-amber-50 border-amber-200 shadow-[0_4px_15px_rgba(245,158,11,0.05)]";
                                    headerTextColor = "text-amber-800";
                                    dayTextColor = "text-amber-600";
                                } else if (dayColor === '#0052CC') { // Normal (Azul)
                                    headerBg = "bg-blue-50 border-blue-200 shadow-[0_4px_15px_rgba(0,82,204,0.05)]";
                                    headerTextColor = "text-[#0052CC]";
                                    dayTextColor = "text-blue-500";
                                }

                                return (
                                    <th key={date} className="p-0 text-center min-w-[118px] 2xl:min-w-[132px] align-bottom group relative z-10 hover:z-[70]">
                                        <div className={`backdrop-blur-xl border shadow-sm rounded-[1.5rem] pt-4 pb-2 mx-1 mb-2 mt-4 flex flex-col items-center justify-center transition-[transform,box-shadow] duration-150 relative group-hover:-translate-y-1 group-hover:shadow-md ${headerBg}`}>
                                            
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
                    <AnimatePresence mode="wait" initial={false}>
                    {isLoading ? (
                        <motion.tbody key="skeleton" className="relative z-10"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}>
                            {[...Array(employeesInView.length || 5)].map((_, idx) => (
                                <tr key={idx}>
                                    <td className="p-0 sticky left-0 z-20 h-px">
                                        <div className="h-full min-h-[72px] skeleton rounded-[2rem] mx-1 flex items-center gap-2.5 p-2.5" style={{ animationDelay: `${idx * 0.06}s` }}>
                                            <div className="w-10 h-10 rounded-xl bg-white/25 shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-2.5 bg-white/20 rounded-full w-3/4" />
                                                <div className="h-2 bg-white/15 rounded-full w-1/2" />
                                                <div className="h-1.5 bg-white/10 rounded-full w-full mt-1" />
                                            </div>
                                        </div>
                                    </td>
                                    {calendarDates.map((_, dIdx) => (
                                        <td key={dIdx} className="p-0 h-px">
                                            <div className="h-full min-h-[72px] skeleton rounded-[1.2rem] mx-0.5" style={{ animationDelay: `${(idx * 0.06) + (dIdx * 0.04)}s` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </motion.tbody>
                    ) : (
                        <motion.tbody key="data" className="relative z-10"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
                            {employeesInView.map(emp => (
                                <EmployeeScheduleRow
                                    key={emp.id}
                                    emp={emp}
                                    roster={weeklyRosters[emp.id]}
                                    shifts={shifts}
                                    calendarDates={calendarDates}
                                    onEditCell={handleEditCell}
                                    isReadOnly={isReadOnly}
                                    apoyoDaysByDow={apoyoByEmp[emp.id]}
                                />
                            ))}

                            {/* ── Separador + filas de cobertura ── */}
                            {coverageEmployeesData.length > 0 && (
                                <tr><td colSpan={calendarDates.length + 1} className="pt-4 pb-1 px-2">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-px bg-indigo-200/60" />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
                                            <Building2 size={9} /> Personal de Apoyo
                                        </span>
                                        <div className="flex-1 h-px bg-indigo-200/60" />
                                    </div>
                                </td></tr>
                            )}

                            {coverageEmployeesData.map(({ emp, homeBranch, homeRoster, coverageDaysByDow }) => (
                                <CoverageEmployeeRow
                                    key={emp.id}
                                    emp={emp}
                                    homeBranch={homeBranch}
                                    homeRoster={homeRoster}
                                    coverageDaysByDow={coverageDaysByDow}
                                    calendarDates={calendarDates}
                                    shifts={shifts}
                                    onEditCell={onEditCoverageCell}
                                    onRemove={() => onRemoveCoverageEmployee?.(emp.id)}
                                />
                            ))}

                            {/* ── Botón agregar personal de apoyo ── */}
                            {!isReadOnly && (
                                <tr><td colSpan={calendarDates.length + 1} className="pt-3 pb-6 px-1">
                                    {!showCoverageSearch ? (
                                        <button
                                            onClick={() => setShowCoverageSearch(true)}
                                            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-slate-300/50 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all duration-200 text-[10px] font-black uppercase tracking-widest"
                                        >
                                            <Plus size={13} strokeWidth={2.5} /> Agregar Personal de Apoyo
                                        </button>
                                    ) : (
                                        <div className="bg-white/90 backdrop-blur-xl border border-slate-200 rounded-2xl p-3 shadow-lg">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                                                    <Search size={12} className="text-slate-400 shrink-0" />
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={coverageSearchTerm}
                                                        onChange={e => setCoverageSearchTerm(e.target.value)}
                                                        placeholder="Buscar empleado de otra sucursal..."
                                                        className="flex-1 bg-transparent text-[16px] text-slate-700 outline-none placeholder:text-slate-400"
                                                    />
                                                </div>
                                                <button onClick={() => { setShowCoverageSearch(false); setCoverageSearchTerm(''); }}
                                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors shrink-0">
                                                    <XIcon size={14} />
                                                </button>
                                            </div>
                                            {coverageSearchResults.length > 0 ? (
                                                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                                                    {coverageSearchResults.map(e => {
                                                        const br = branches.find(b => String(b.id) === String(e.branchId || e.branch_id));
                                                        return (
                                                            <button key={e.id}
                                                                onClick={() => { onAddCoverageEmployee?.(e.id); setShowCoverageSearch(false); setCoverageSearchTerm(''); }}
                                                                className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-indigo-50 transition-colors text-left w-full">
                                                                <div className="w-8 h-8 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                                                    {e.photo_url ? <img src={e.photo_url} className="w-full h-full object-cover" alt="" /> : <CircleUserRound size={18} className="text-slate-300" />}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-[12px] font-black text-slate-800 truncate">{e.name}</p>
                                                                    <p className="text-[10px] text-indigo-500 font-bold truncate">{br?.name || 'Sin sucursal'}</p>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-[11px] text-slate-400 text-center py-2">
                                                    {coverageSearchTerm.trim() ? 'No se encontraron empleados' : 'Escribe el nombre del empleado'}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </td></tr>
                            )}
                        </motion.tbody>
                    )}
                    </AnimatePresence>
                </table>
            </div>
        </div>
    );
});

export default memo(ScheduleCalendar);