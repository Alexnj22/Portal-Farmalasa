import React, { memo, useMemo, useState } from 'react';
import AvatarConEstado from '../../../components/common/AvatarConEstado';
import Button from '../../../components/common/Button';
import Badge from '../../../components/common/Badge';
import { CircleUserRound, Clock, Pencil, Flame, AlertTriangle, Building2, Plus, X as XIcon } from 'lucide-react';
import SearchInput from '../../../components/common/SearchInput';
import { useSearchToggle } from '../../../hooks/useSearchToggle';
import { AnimatePresence, motion } from 'framer-motion';
import { tokenMatch } from '../../../utils/searchUtils';
import { shortEmployeeName } from '../../../utils/nameUtils';

import {
    getRoleTheme, getDayConflictLocal, calculateEmployeeWeeklyHoursLocal, timeToMins,
    resolverTurnoDelDia, tramosDeLaJornada, descansoInsuficiente,
    HORAS_SEMANA_DIURNA, HORAS_JORNADA_DIURNA, DESCANSOS_POR_SEMANA, HORAS_ENTRE_JORNADAS,
} from '../../../utils/scheduleHelpers';
import { clickable } from '../../../utils/clickable';

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
// COBERTURA DEL DÍA — cuánta gente hay a cada hora, y quién queda solo
// ============================================================================
//
// Se reescribió el 2026-08-27 con aritmética de intervalos. Antes reservaba dos
// arreglos de 1.440 `Set` por día —2.880 × 7 = **20.160 `Set` por semana**— y
// recorría minuto a minuto el turno de cada persona. Y dependía de
// `weeklyRosters`, o sea que el cálculo entero se rehacía **en cada celda que
// se guardaba**.
//
// La cuenta es la misma: se ordenan los bordes de cada tramo y se barren. Lo
// que sale de acá son dos cosas distintas:
//
//   · `huecosCriticos` — horas de mucha venta con menos de tres personas.
//   · `avisos` — el almuerzo que deja la sala vacía o a una sola persona. Se
//     calculaba desde siempre y **la vista lo tiraba** (`onSalyAlertsUpdate`
//     era `() => {}`), así que era trabajo perdido y una función construida que
//     nadie veía.
const evaluarCoberturaDelDia = (dNum, horarios, turnos, ventasDelDia) => {
    // Un tramo por persona: cuándo entra, cuándo sale, y cuándo se va a comer.
    const tramos = [];
    horarios.forEach(horarioSemanal => {
        const r = resolverTurnoDelDia(horarioSemanal[dNum], turnos);
        if (!r.trabaja) return;
        const nombre = horarioSemanal.name || 'Personal';
        let ini = timeToMins(r.inicio);
        let fin = timeToMins(r.fin);
        if (fin < ini) fin += 1440;
        const t = { nombre, ini, fin, pausaIni: null, pausaFin: null };
        if (r.pausa) {
            let p = timeToMins(r.pausa.inicio);
            if (p < ini) p += 1440;
            t.pausaIni = p;
            t.pausaFin = p + r.pausa.minutos;
        }
        tramos.push(t);
    });

    if (tramos.length === 0) return { huecosCriticos: [], avisos: [] };

    // Cuántas personas hay ACTIVAS (dentro del turno y fuera de su pausa) en un
    // minuto dado, y quiénes están comiendo.
    const enElMinuto = (m) => {
        const activos = [], comiendo = [];
        for (const t of tramos) {
            for (const desfase of [0, 1440]) {       // el tramo puede haber cruzado
                const mm = m + desfase;
                if (mm < t.ini || mm >= t.fin) continue;
                if (t.pausaIni !== null && mm >= t.pausaIni && mm < t.pausaFin) comiendo.push(t.nombre);
                else activos.push(t.nombre);
            }
        }
        return { activos, comiendo };
    };

    // Los bordes: sólo ahí puede cambiar la cuenta. Con 10 personas son ~40
    // instantes, no 1.440.
    const bordes = new Set([0, 1440]);
    tramos.forEach(t => {
        [t.ini, t.fin, t.pausaIni, t.pausaFin].forEach(b => {
            if (b === null) return;
            bordes.add(((b % 1440) + 1440) % 1440);
        });
    });
    const instantes = [...bordes].sort((a, b) => a - b);

    // ── Huecos en las horas de más venta ────────────────────────────────────
    const huecosCriticos = [];
    (ventasDelDia || []).forEach(stat => {
        if (stat.color !== 'var(--txvol-critica)') return;
        const desde = stat.hour * 60, hasta = desde + 60;
        let minimo = Infinity;
        for (const m of instantes) {
            if (m < desde || m >= hasta) continue;
            minimo = Math.min(minimo, enElMinuto(m).activos.length);
        }
        minimo = Math.min(minimo, enElMinuto(desde).activos.length);
        if (minimo < 3) huecosCriticos.push({ time: formatHourCompact(stat.hour) });
    });

    // ── El almuerzo que deja la sala corta ──────────────────────────────────
    const avisos = [];
    for (let i = 0; i < instantes.length; i++) {
        const desde = instantes[i];
        const hasta = i + 1 < instantes.length ? instantes[i + 1] : 1440;
        if (hasta <= desde) continue;
        const { activos, comiendo } = enElMinuto(desde);
        if (comiendo.length === 0) continue;
        const duracion = hasta - desde;

        if (activos.length === 0) {
            avisos.push({
                tipo: 'danger',
                texto: `El almuerzo de ${formatNames(new Set(comiendo))} a las ${formatMins12h(desde)} deja la sala SIN NADIE por ${duracion} min.`,
            });
        } else if (activos.length === 1 && duracion >= 30) {
            avisos.push({
                tipo: 'warning',
                texto: `El almuerzo de ${formatNames(new Set(comiendo))} a las ${formatMins12h(desde)} deja a ${activos[0]} atendiendo solo por ${duracion} min. Conviene escalonarlo.`,
            });
        }
    }

    return { huecosCriticos, avisos };
};

// ============================================================================
// ⚡ FILA MEMOIZADA (UN EMPLEADO)
// ============================================================================
const EmployeeScheduleRow = memo(({ emp, roster, shifts, calendarDates, onEditCell, isReadOnly, apoyoDaysByDow }) => {
    let rawSchedule = roster || {};
    let sch = (typeof rawSchedule === 'string') ? JSON.parse(rawSchedule || '{}') : rawSchedule;
    
    // 🚨 CÁLCULO DE HORAS Y DÍAS LIBRES
    const hours = calculateEmployeeWeeklyHoursLocal(sch, shifts, emp.history, calendarDates);
    
    // El día lo resuelve `resolverTurnoDelDia` y no una copia local. La copia
    // que había acá exigía horas de inicio Y fin propias o del turno, que es
    // una de las cuatro lecturas que divergían. Ver `utils/turnoDelDia.js`.
    let daysOffCount = 0;
    calendarDates.forEach(date => {
        const dId = new Date(date + 'T00:00:00').getDay();
        if (!resolverTurnoDelDia(sch[dId], shifts).trabaja) daysOffCount++;
    });

    // 44 h la semana diurna y un día de descanso — RIT Art. 16 y 19. Estaban
    // escritos a mano en seis sitios; hoy salen de `utils/turnoDelDia.js`.
    const isHoursPerfect = hours === HORAS_SEMANA_DIURNA;
    const isHoursOver = hours > HORAS_SEMANA_DIURNA;
    const isHoursUnder = hours < HORAS_SEMANA_DIURNA;
    const isDaysOffPerfect = daysOffCount === DESCANSOS_POR_SEMANA;

    // Configuración visual de la barra de progreso
    let barColor = 'bg-success shadow-[var(--shadow-glow-chart-9-md)]'; // Estado Perfecto
    if (isHoursOver || daysOffCount === 0) {
        barColor = 'bg-danger shadow-[var(--shadow-glow-danger-md)]'; // Infracción Grave
    } else if (isHoursUnder || daysOffCount > 1) {
        barColor = 'bg-warning shadow-[var(--shadow-glow-warning-md)]'; // Falta rellenar
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
        <tr className="group/row relative transition-[z-index] duration-[var(--dur-fast)] hover:z-sidebar">
            <td className="p-0 sticky left-0 z-tabs align-top h-px group-hover/row:z-sidebar min-w-[156px] max-w-[156px] 2xl:min-w-[172px] 2xl:max-w-[172px]">
                <div className="min-h-[72px] h-full bg-surface-card border border-border-card shadow-[var(--shadow-glass-sm)] rounded-modal p-2.5 mx-1 flex items-center gap-2 transition-transform duration-[var(--dur-fast)] group-hover/row:scale-[1.01] overflow-hidden">
                    <div className="w-9 h-9 2xl:w-10 2xl:h-10 rounded-xl bg-surface-card border border-border-card shadow-[var(--shadow-shine)] overflow-hidden flex items-center justify-center shrink-0">
                        {emp.photo_url ? <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" /> : <CircleUserRound size={24} className="text-content-3" />}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <h4 className="font-black text-content text-body-sm 2xl:text-body truncate leading-tight mb-1" title={emp.name}>{shortName}</h4>
                        
                        <div className="flex items-center gap-1 mb-1.5 2xl:mb-2 w-full overflow-x-auto hide-scrollbar scroll-smooth">
                            {rolesArray.map((roleObj, idx) => {
                                const theme = getRoleTheme(roleObj.original);
                                return (
                                    <div key={idx} className={`w-fit px-1.5 py-0.5 rounded-md border text-micro 2xl:text-[7.5px] font-black uppercase tracking-widest transition-colors whitespace-nowrap shrink-0 ${theme.bg} ${theme.text} ${theme.border}`}>
                                        {roleObj.display}
                                    </div>
                                );
                            })}
                        </div>

                        {/* 🚨 NUEVO PANEL DE AUDITORÍA SEMANAL EN LA TARJETA */}
                        <div className="flex flex-col gap-1 w-full mt-auto">
                            <div className="flex justify-between items-end gap-1">
                                <p className="text-caption 2xl:text-label font-black uppercase tracking-widest flex items-center gap-1 shrink-0">
                                    <Clock size={10} className={isHoursPerfect ? 'text-success' : isHoursOver ? 'text-danger' : 'text-warning'} /> 
                                    <span className={isHoursPerfect ? 'text-success' : isHoursOver ? 'text-danger' : 'text-warning'}>{hours}h</span>
                                </p>
                                
                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                    {/* Validar Días Libres */}
                                    {!isDaysOffPerfect && (
                                        <span className={`text-micro 2xl:text-[7.5px] px-1.5 py-0.5 rounded font-black shadow-sm shrink-0 ${daysOffCount === 0 ? 'bg-danger/10 text-danger animate-pulse' : 'bg-warning/10 text-warning'}`}>
                                            {daysOffCount === 0 ? '⚠️ SIN DESCANSO' : `${daysOffCount} LIBRES`}
                                        </span>
                                    )}
                                    {/* Validar Horas */}
                                    {!isHoursPerfect && (
                                        <span className={`text-micro 2xl:text-[7.5px] px-1.5 py-0.5 rounded font-black shadow-sm shrink-0 ${isHoursOver ? 'bg-danger/10 text-danger animate-pulse' : 'bg-warning/10 text-warning'}`}>
                                            {isHoursOver ? `+${Number((hours - HORAS_SEMANA_DIURNA).toFixed(1))}h` : `${Number((hours - HORAS_SEMANA_DIURNA).toFixed(1))}h`}
                                        </span>
                                    )}
                                    {/* Todo Perfecto */}
                                    {isHoursPerfect && isDaysOffPerfect && (
                                        <Badge variant="success" size="sm" uppercase={false} className="shrink-0">✓ ÓPTIMO</Badge>
                                    )}
                                </div>
                            </div>
                            
                            <div className="h-1.5 bg-surface-card-hover/50 rounded-full overflow-hidden shadow-inner shrink-0">
                                <div className={`h-full rounded-full transition-all duration-[var(--dur-lento)] ${barColor}`} style={{ width: `${Math.min((hours / HORAS_SEMANA_DIURNA) * 100, 100)}%` }} />
                            </div>
                        </div>

                    </div>
                </div>
            </td>

            {calendarDates.map(date => {
                const dId = new Date(date + 'T00:00:00').getDay();
                const conf = getDayConflictLocal(date, emp.history);
                const dayData = sch[dId] || {};
                const r = resolverTurnoDelDia(dayData, shifts);
                const hasShift = r.trabaja;

                // El tope diario del reglamento son 8 h (7 si la jornada es
                // nocturna, Art. 16). Estaba escrito `8 * 60` a mano y sin la
                // excepción nocturna.
                const netShiftDurationHrs = hasShift
                    ? (r.minutosPagados / 60).toFixed(1).replace('.0', '')
                    : 0;
                const topeDiario = r.esJornadaNocturna ? 7 : HORAS_JORNADA_DIURNA;
                const isDailyOvertime = hasShift && r.minutosPagados > topeDiario * 60;

                const timeBlocks = tramosDeLaJornada(r).map(t => ({
                    type: t.tipo === 'pausa' ? 'lunch' : t.tipo === 'lactancia' ? 'lactation' : 'work',
                    start: t.inicio, end: t.fin,
                }));

                const apoyoBranch = apoyoDaysByDow?.[dId];

                return (
                    <td key={date} className={`p-0 align-top h-px ${(isReadOnly || apoyoBranch) ? 'cursor-default' : 'group/cell cursor-pointer relative z-base hover:z-sidebar-desktop active:scale-[0.98] transition-transform'}`} {...clickable((e) => {
                        if (conf || isReadOnly || apoyoBranch) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        onEditCell(emp.id, dId, date, dayData, rect);
                    })}>
                        <div className={`h-full rounded-2xl mx-0.5 p-1.5 relative transition-transform duration-[var(--dur-fast)] flex flex-col
                            ${(!isReadOnly && !apoyoBranch) ? 'group-hover/cell:scale-[1.03]' : ''}
                            ${apoyoBranch ? 'bg-chart-3/10 border border-chart-3/30 shadow-[var(--shadow-glow-chart-3)]' :
                              conf ? conf.bg + ' border border-dashed ' + conf.border :
                              hasShift ? 'bg-surface-card border border-divider shadow-[var(--shadow-elevation-xs)]' :
                              'border border-dashed border-divider bg-surface-card-hover/30'
                            }
                            ${!apoyoBranch && isDailyOvertime && hasShift ? '!border-danger/40 shadow-[var(--shadow-shine)]' : ''}
                        `}>

                            {/* Con el dedo no hay hover, así que un `opacity-0
                                group-hover` no existe: la celda respondía al toque pero
                                nada decía que fuera editable ANTES de tocarla. En el
                                teléfono se ve tenue y siempre; con mouse aparece al
                                pasar por encima. */}
                            {!conf && !isReadOnly && !apoyoBranch && (
                                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-brand text-white shadow-sm flex items-center justify-center opacity-60 md:opacity-0 md:group-hover/cell:opacity-100 focus-within:opacity-100 transition-all z-sidebar hover:bg-chart-1">
                                    <Pencil size={8} strokeWidth={2.5} />
                                </div>
                            )}

                            <div className="relative z-base w-full h-full flex flex-col">
                                {apoyoBranch ? (
                                    <div className="w-full flex-1 flex flex-col items-center justify-center gap-1">
                                        <Building2 size={11} className="text-chart-3-text" strokeWidth={2} />
                                        <span className="text-micro font-black uppercase tracking-widest text-chart-3-text">Apoyo</span>
                                        <span className="text-[6.5px] font-bold text-chart-3-text text-center leading-tight truncate px-1">{apoyoBranch}</span>
                                    </div>
                                ) : conf ? (
                                    <div className={`w-full flex-1 flex flex-col items-center justify-center ${conf.text}`}>
                                        <conf.icon className="w-4 h-4 2xl:w-[18px] 2xl:h-[18px] mb-1" strokeWidth={2.5} />
                                        <span className="text-[7.5px] 2xl:text-micro font-black uppercase text-center leading-tight truncate px-1">{conf.label}</span>
                                        {hasShift && (
                                            <span className="text-[6.5px] font-bold mt-1 opacity-60 truncate px-1 text-center leading-tight">
                                                {r.nombre} · {netShiftDurationHrs}h
                                            </span>
                                        )}
                                    </div>
                                ) : hasShift ? (
                                    <div className="flex flex-col h-full">
                                        <div className="flex items-start justify-between w-full mb-1">
                                            <span className="text-[7.5px] 2xl:text-micro font-black uppercase text-content bg-surface-card-hover border border-divider px-1 py-[1px] rounded truncate max-w-[70%]">
                                                {r.nombre}
                                            </span>
                                            <div data-surface={isDailyOvertime ? undefined : 'card'} className={`flex items-center gap-0.5 px-1 py-[1px] rounded border shadow-sm ${isDailyOvertime ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-surface-card-hover text-content-3'}`}>
                                                {isDailyOvertime && <Flame size={8} className="animate-pulse" />}
                                                <span className="text-micro 2xl:text-[7.5px] font-black tracking-tight">{netShiftDurationHrs}h</span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-[2px] mt-auto">
                                            {timeBlocks.map((block, idx) => {
                                                const isBreak = block.type !== 'work';
                                                const bgClass = block.type === 'lunch' ? 'bg-chart-4/10 text-chart-4-text border border-chart-4/30' : 
                                                                block.type === 'lactation' ? 'bg-chart-6/10 text-chart-6-text border border-chart-6/30' :
                                                                'text-content-2';
                                                
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
                                    <div className="w-full flex-1 flex flex-col items-center justify-center text-content-3">
                                        <span className="text-micro font-black uppercase tracking-widest">Descanso</span>
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
        <tr className="group/row relative transition-[z-index] duration-[var(--dur-fast)] hover:z-sidebar">
            <td className="p-0 sticky left-0 z-tabs align-top h-px group-hover/row:z-sidebar min-w-[156px] max-w-[156px] 2xl:min-w-[172px] 2xl:max-w-[172px]">
                <div className="min-h-[72px] h-full bg-chart-3/10 border border-chart-3/30 shadow-[var(--shadow-glass-2)] rounded-modal p-2.5 mx-1 flex items-center gap-2 transition-transform duration-[var(--dur-fast)] group-hover/row:scale-[1.01] overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-surface-card border border-chart-3/30 overflow-hidden flex items-center justify-center shrink-0">
                        {emp.photo_url ? <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" /> : <CircleUserRound size={22} className="text-chart-3/40" />}
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden gap-0.5">
                        <h4 className="font-black text-content text-body-sm truncate leading-tight" title={emp.name}>{shortName}</h4>
                        <div className="flex items-center gap-1">
                            <Building2 size={9} className="text-chart-3-text shrink-0" strokeWidth={2} />
                            <span className="text-micro font-bold text-chart-3-text truncate">{homeBranch?.name || 'Otra sucursal'}</span>
                        </div>
                        <div className="mt-0.5 px-1.5 py-[2px] bg-chart-3/10 border border-chart-3/30 rounded-full w-fit">
                            <span className="text-micro font-black uppercase tracking-widest text-chart-3-text">APOYO</span>
                        </div>
                    </div>
                    <Button variant="destructive" size="xs" icon={XIcon} title="Quitar cobertura" iconOnly onClick={onRemove} />
                </div>
            </td>

            {calendarDates.map(date => {
                const dId = new Date(date + 'T00:00:00').getDay();
                const coverageData = coverageDaysByDow?.[dId];
                const homeData = parsedHomeRoster[dId] || {};
                const displayData = coverageData || homeData;
                const isCoverageDay = Boolean(coverageData);

                const r = resolverTurnoDelDia(displayData, shifts);
                const hasShift = r.trabaja;
                const startStr = r.inicio;
                const endStr   = r.fin;
                const netHrs   = hasShift ? (r.minutosPagados / 60).toFixed(1).replace('.0', '') : '';

                return (
                    <td key={date} className="p-0 align-top h-px group/cell cursor-pointer relative z-base hover:z-sidebar-desktop active:scale-[0.98] transition-transform"
                        {...clickable(e => onEditCell(emp, dId, date, isCoverageDay ? coverageData : null, e.currentTarget.getBoundingClientRect(), homeBranch))}>
                        <div className={`h-full rounded-2xl mx-0.5 p-1.5 relative transition-transform duration-[var(--dur-fast)] flex flex-col group-hover/cell:scale-[1.03]
                            ${isCoverageDay
                                ? 'bg-chart-3/10 border border-chart-3/40 shadow-[var(--shadow-glow-chart-3-md)]'
                                : hasShift
                                    ? 'bg-surface-card border border-divider opacity-40'
                                    : 'border border-dashed border-divider bg-surface-card-hover/10 opacity-30'
                            }`}>
                            {/* Antes esto llevaba comillas dobles con un `${…}` adentro:
                                la interpolación se emitía LITERAL como nombre de clase y
                                el botón salía sin fondo ni color de ícono. */}
                            <div className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center transition-all z-sidebar shadow-sm
                                opacity-70 md:opacity-0 md:group-hover/cell:opacity-100 focus-within:opacity-100
                                ${isCoverageDay ? 'bg-chart-3-solid text-white' : 'bg-content-3 text-white'}`}>
                                {isCoverageDay ? <Pencil size={8} strokeWidth={2.5} /> : <Plus size={8} strokeWidth={2.5} />}
                            </div>

                            <div className="relative z-base w-full h-full flex flex-col">
                                {hasShift ? (
                                    <div className="flex flex-col h-full">
                                        <div className="flex items-start justify-between w-full mb-1">
                                            <span className={`text-[7.5px] font-black uppercase px-1 py-[1px] rounded border truncate max-w-[68%]
                                                ${isCoverageDay ? 'text-chart-3-text bg-chart-3/10 border-chart-3/30' : 'text-content-3 bg-surface-card-hover border-divider'}`}>
                                                {r.nombre}
                                            </span>
                                            <span className={`text-micro font-black px-1 py-[1px] rounded border
                                                ${isCoverageDay ? 'text-chart-3-text bg-chart-3/10 border-chart-3/30' : 'text-content-3 bg-surface-card-hover border-divider'}`}>
                                                {netHrs}h
                                            </span>
                                        </div>
                                        <div className={`text-micro font-bold font-mono tracking-tight mt-auto ${isCoverageDay ? 'text-chart-3-text' : 'text-content-3'}`}>
                                            {fmt12h(startStr)} - {fmt12h(endStr)}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full flex-1 flex items-center justify-center">
                                        {isCoverageDay
                                            ? <span className="text-[7.5px] font-black uppercase text-chart-3-text">Libre</span>
                                            : <span className="text-micro font-black text-content-3">—</span>
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
    handleEditCell, salesStats, isReadOnly,
    coveragesAtBranch = [], coveragesFromBranch = [], coverageRosters = {},
    addedCoverageEmpIds = new Set(), allEmployees = [], branches = [],
    currentBranchId, onAddCoverageEmployee, onRemoveCoverageEmployee, onEditCoverageCell,
}) => {
    const [showCoverageSearch, setShowCoverageSearch] = useState(false);
    const [coverageSearchTerm, setCoverageSearchTerm] = useState('');

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.
    const { containerProps: coverageSearchContainerRef } = useSearchToggle({
        active: showCoverageSearch,
        value: coverageSearchTerm,
        onClear: () => setCoverageSearchTerm(''),
        onClose: () => setShowCoverageSearch(false),
    });

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
            result[dNum] = evaluarCoberturaDelDia(
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

    /* Los avisos de cobertura de TODA la semana.
     *
     * Se calculaban desde siempre y la vista los tiraba: el padre pasaba
     * `onSalyAlertsUpdate={() => {}}`. O sea que el trabajo se hacía y el
     * resultado —«el almuerzo de Ana y Luis deja la sala sin nadie por 40
     * min»— no lo veía nadie. */
    const avisosDeLaSemana = useMemo(() => {
        const salida = [];
        calendarDates.forEach(date => {
            const dNum = new Date(date + 'T00:00:00').getDay();
            const dia = new Date(date + 'T00:00:00').toLocaleDateString('es-SV', { weekday: 'long' });
            (coverageByDay[dNum]?.avisos || []).forEach(a => salida.push({ ...a, dia }));
        });
        return salida;
    }, [coverageByDay, calendarDates]);

    /* RIT Art. 21 — entre el fin de una jornada y el inicio de la siguiente
     * deben mediar ocho horas. Con turnos rotativos es el reparo que más se
     * escapa: cerrar a las 22:00 y abrir a las 7:00 deja nueve, pero cerrar a
     * las 22:00 y entrar a las 6:00 deja ocho justas. Nadie lo miraba. */
    const descansoCorto = useMemo(() => {
        const salida = [];
        employeesInView.forEach(emp => {
            const raw = weeklyRosters[emp.id] || {};
            const sch = (typeof raw === 'string') ? JSON.parse(raw || '{}') : raw;
            const dias = calendarDates.map(fecha => ({
                fecha,
                resuelto: resolverTurnoDelDia(sch[new Date(fecha + 'T00:00:00').getDay()], shifts),
            }));
            descansoInsuficiente(dias).forEach(f => salida.push({ emp: shortEmployeeName(emp), ...f }));
        });
        return salida;
    }, [employeesInView, weeklyRosters, calendarDates, shifts]);

    const reparos = [
        ...descansoCorto.map(f => ({
            tipo: 'danger',
            texto: `${f.emp} sale y vuelve a entrar con ${f.horas} h de descanso. El reglamento pide ${HORAS_ENTRE_JORNADAS} (Art. 21).`,
        })),
        ...avisosDeLaSemana.map(a => ({ ...a, texto: `${a.dia.charAt(0).toUpperCase()}${a.dia.slice(1)}: ${a.texto}` })),
    ];

    return (
        <div className="w-full relative z-base shrink-0 mt-4">
            {/* Lo que la semana tiene mal, dicho antes de publicarla.
                Estos avisos se calculaban desde siempre y la vista los tiraba
                (`onSalyAlertsUpdate` era `() => {}`), así que el trabajo se
                hacía y el resultado no lo veía nadie. */}
            {reparos.length > 0 && (
                <div className="px-2 pb-3 flex flex-col gap-2">
                    {reparos.slice(0, 6).map((a, i) => (
                        <div key={i} data-surface="card" data-tono={a.tipo === 'danger' ? 'danger' : 'warning'}
                            className="flex items-start gap-2.5 px-3 py-2">
                            <AlertTriangle size={14} strokeWidth={2.5}
                                className={`shrink-0 mt-0.5 ${a.tipo === 'danger' ? 'text-danger-text' : 'text-warning'}`} />
                            <p className={`text-label font-bold leading-snug ${a.tipo === 'danger' ? 'text-danger-text' : 'text-warning-text'}`}>
                                {a.texto}
                            </p>
                        </div>
                    ))}
                    {reparos.length > 6 && (
                        <p className="text-caption font-bold text-content-3 px-1">
                            y {reparos.length - 6} aviso(s) más.
                        </p>
                    )}
                </div>
            )}
            <div id="schedule-table-scroll" className="overflow-x-auto hide-scrollbar pb-10 px-2 pt-4" style={{ overflowAnchor: 'none' }}>
                {/* ── Esta tabla se queda tabla en el teléfono, a propósito ──
                    El canon (DESIGN.md §32.8) manda que una lista de registros
                    caiga a fichas en el teléfono. Ésta NO es una lista de
                    registros: es una MATRIZ —personas por días de la semana— y
                    una matriz no tiene «una fila = un registro» que convertir.
                    Partirla en fichas obligaría a repetir el nombre de la
                    persona siete veces y perdería lo único que el calendario
                    sirve para ver: la semana completa de un vistazo.

                    Vive dentro de un `overflow-x-auto`, así que se arrastra de
                    lado y no desborda la página. `data-tabla="matriz"` lo
                    declara para el barrido: sin esa marca lo reporta como «cayó
                    a la tabla» en cada corrida, y un hallazgo que aparece
                    siempre y nunca se arregla es como se aprende a ignorar un
                    informe. */}
                <table data-tabla="matriz" className="w-full text-left border-separate border-spacing-y-2 border-spacing-x-1 min-w-full relative">
                    <thead className="relative z-sidebar-desktop">
                        <tr>
                            <th className="p-0 sticky left-0 z-dropdown min-w-[192px] max-w-[192px] 2xl:min-w-[208px] 2xl:max-w-[208px] bg-transparent align-bottom">
                                <div data-surface="card" className="pt-4 pb-2 px-3 mx-1 mb-2 mt-4 text-micro font-black uppercase text-content-3 tracking-widest flex flex-col items-center justify-center gap-1">
                                    Personal <span className="bg-surface-card px-2 py-0.5 rounded-lg text-content-3 border border-border-card">{HORAS_SEMANA_DIURNA}H / {DESCANSOS_POR_SEMANA} DESCANSO</span>
                                </div>
                            </th>
                            
                            {calendarDates.map((date) => {
                                const dNum = new Date(date + 'T00:00:00').getDay();
                                const coverageData = coverageByDay[dNum] || {};
                                const dayOverallStat = salesStats?.days?.find(d => d.day === dNum);
                                const dayColor = dayOverallStat?.color;

                                let headerBg = "bg-brand/5 border-brand/10 shadow-sm";
                                let headerTextColor = "text-content-3";
                                let dayTextColor = "text-content-3";
                                
                                if (dayColor === 'var(--txvol-critica)') { // Crítico (Rojo)
                                    headerBg = "bg-danger/10 border-danger/30 shadow-[var(--shadow-glow-danger-md)]";
                                    headerTextColor = "text-danger-text";
                                    dayTextColor = "text-danger-text";
                                } else if (dayColor === 'var(--txvol-pico)') { // Pico (Naranja)
                                    headerBg = "bg-warning/10 border-warning/30 shadow-[var(--shadow-glow-warning)]";
                                    headerTextColor = "text-warning-text";
                                    dayTextColor = "text-warning";
                                } else if (dayColor === 'var(--txvol-normal)') { // Normal (Azul)
                                    headerBg = "bg-chart-1/10 border-chart-1/30 shadow-[var(--shadow-glow-brand)]";
                                    headerTextColor = "text-brand-text";
                                    dayTextColor = "text-chart-1-text";
                                }

                                return (
                                    <th key={date} className="p-0 text-center min-w-[118px] 2xl:min-w-[132px] align-bottom group relative z-base hover:z-dropdown">
                                        <div className={`border shadow-sm rounded-3xl pt-4 pb-2 mx-1 mb-2 mt-4 flex flex-col items-center justify-center transition-[transform,box-shadow] duration-[var(--dur-fast)] relative group-hover:-translate-y-1 group-hover:shadow-md ${headerBg}`}>
                                            
                                            <div className="absolute bottom-[105%] left-0 right-0 flex justify-center px-1 z-content pointer-events-none">
                                                <div className="flex flex-wrap justify-center items-end gap-[3px] w-full max-h-[40px] overflow-hidden">
                                                    {coverageData?.huecosCriticos?.length > 0 && (
                                                        <>
                                                            {coverageData.huecosCriticos.map((gap, i) => (
                                                                <Badge key={i} variant="danger" tone="solid" size="sm">{gap.time}</Badge>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`text-micro uppercase font-black tracking-wider mb-0.5 ${dayTextColor}`}>
                                                {new Date(date + 'T00:00:00').toLocaleDateString('es-SV', { weekday: 'long' })}
                                            </div>
                                            <div className={`text-title font-black leading-none ${headerTextColor}`}>
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
                        <motion.tbody key="skeleton" className="relative z-base"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}>
                            {[...Array(employeesInView.length || 5)].map((_, idx) => (
                                <tr key={idx}>
                                    <td className="p-0 sticky left-0 z-content h-px">
                                        <div className="h-full min-h-[72px] skeleton rounded-modal mx-1 flex items-center gap-2.5 p-2.5" style={{ animationDelay: `${idx * 0.06}s` }}>
                                            <div className="w-10 h-10 rounded-xl bg-surface-card shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-2.5 bg-surface-card rounded-full w-3/4" />
                                                <div className="h-2 bg-surface-card rounded-full w-1/2" />
                                                <div className="h-1.5 bg-surface-card rounded-full w-full mt-1" />
                                            </div>
                                        </div>
                                    </td>
                                    {calendarDates.map((_, dIdx) => (
                                        <td key={dIdx} className="p-0 h-px">
                                            <div className="h-full min-h-[72px] skeleton rounded-2xl mx-0.5" style={{ animationDelay: `${(idx * 0.06) + (dIdx * 0.04)}s` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </motion.tbody>
                    ) : (
                        <motion.tbody key="data" className="relative z-base"
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
                                        <div className="flex-1 h-px bg-chart-3/30" />
                                        <span className="text-micro font-black uppercase tracking-widest text-chart-3-text flex items-center gap-1.5">
                                            <Building2 size={9} /> Personal de Apoyo
                                        </span>
                                        <div className="flex-1 h-px bg-chart-3/30" />
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
                                        <Button tone="chart-3" icon={Plus} onClick={() => setShowCoverageSearch(true)}>Agregar Personal de Apoyo</Button>
                                    ) : (
                                        <div {...coverageSearchContainerRef} data-surface="card" className="p-3">
                                            <div className="flex items-center gap-2 mb-2">
                                                <SearchInput
                                                    autoFocus
                                                    size="sm"
                                                    value={coverageSearchTerm}
                                                    onChange={setCoverageSearchTerm}
                                                    placeholder="Buscar empleado de otra sucursal..."
                                                    className="flex-1"
                                                />
                                                <Button variant="secondary" size="sm" icon={XIcon} iconOnly onClick={() => { setShowCoverageSearch(false); setCoverageSearchTerm(''); }} />
                                            </div>
                                            {coverageSearchResults.length > 0 ? (
                                                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                                                    {coverageSearchResults.map(e => {
                                                        const br = branches.find(b => String(b.id) === String(e.branchId || e.branch_id));
                                                        // Resultado de búsqueda: al pulsarlo AGREGA al empleado
                                                        // y cierra la lista. Es una acción de una sola vez, no un
                                                        // elemento con estado — por eso no lleva `aria-pressed`.
                                                        return (
                                                            <button key={e.id}
                                                                onClick={() => { onAddCoverageEmployee?.(e.id); setShowCoverageSearch(false); setCoverageSearchTerm(''); }}
                                                                className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-chart-3/10 transition-colors text-left w-full">
                                                                <div className="w-8 h-8 rounded-xl bg-surface-card-hover overflow-hidden shrink-0 flex items-center justify-center">
                                                                    {e.photo_url ? <AvatarConEstado emp={e} px={28} radio="rounded-full" marco="" /> : <CircleUserRound size={18} className="text-content-3" />}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-body-sm font-black text-content truncate" title={e.name}>{shortEmployeeName(e)}</p>
                                                                    <p className="text-caption text-chart-3-text font-bold truncate">{br?.name || 'Sin sucursal'}</p>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-label text-content-3 text-center py-2">
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