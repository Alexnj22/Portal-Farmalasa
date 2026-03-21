import React, { useMemo, useCallback, memo } from 'react';
import { Clock, Palmtree, Utensils, Baby, HeartPulse, FileText, Building2, AlertTriangle, CheckCircle2, CalendarOff, ArrowRight, Check } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12'; 
import LiquidSelect from '../../components/common/LiquidSelect';
import { WEEK_DAYS } from '../../data/constants';
import { useStaffStore as useStaff } from '../../store/staffStore';

// --------------------------------------------------------
// HELPERS DE TIEMPO Y LÓGICA
// --------------------------------------------------------
const formatCompactTime = (timeString) => {
    if (!timeString) return '';
    const parts = timeString.split(':');
    let hour = parseInt(parts[0], 10);
    const minStr = parts[1];
    const ampm = hour >= 12 ? 'pm' : 'am';
    hour = hour % 12 || 12;
    return minStr === '00' ? `${hour}${ampm}` : `${hour}:${minStr}${ampm}`;
};

const timeToMins = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

const minsToTime = (mins) => {
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    if (h < 0) h += 24;
    if (h >= 24) h -= 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// --------------------------------------------------------
// 🎨 COMPONENTES DE UI PERSONALIZADOS
// --------------------------------------------------------
const Switch = memo(({ on, onToggle, disabled }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex items-center flex-shrink-0 w-10 h-5 md:w-11 md:h-6 rounded-full border-2 transition-all duration-300 ease-in-out cursor-pointer ${
            disabled ? "opacity-50 cursor-not-allowed bg-white/40 border-white/50" 
            : on ? "bg-[#007AFF] border-[#007AFF] shadow-[0_2px_8px_rgba(0,122,255,0.3)]" : "bg-slate-200 border-slate-200 hover:bg-slate-300 hover:border-slate-300"
        }`}
    >
        <span className={`absolute top-[1px] left-[1px] w-3 h-3 md:w-4 md:h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-in-out ${on ? "translate-x-5 md:translate-x-6" : "translate-x-0"}`} />
    </button>
));

const BeautifulCheckbox = memo(({ checked, onChange, theme }) => {
    const isOrange = theme === 'orange';
    const activeBg = isOrange ? 'bg-orange-500' : 'bg-pink-500';
    const shadowHover = isOrange ? 'hover:shadow-[0_2px_8px_rgba(249,115,22,0.3)]' : 'hover:shadow-[0_2px_8px_rgba(236,72,153,0.3)]';

    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`w-4 h-4 rounded-[4px] flex items-center justify-center transition-all duration-200 border cursor-pointer outline-none ${
                checked 
                ? `${activeBg} border-transparent shadow-sm scale-110` 
                : `bg-white/60 border-slate-300 ${shadowHover} hover:bg-white`
            }`}
        >
            {checked && <Check size={11} strokeWidth={4} className="text-white" />}
        </button>
    );
});

// ============================================================================
// 🚀 COMPONENTE FILA DE DÍA
// ============================================================================
const DayRow = memo(({ 
    day, conflict, config, isWorking, isMultiBranch, 
    branchOptions, shiftOptions, shiftObj, empBaseBranchId, 
    onToggle, onChange 
}) => {

    let lunchWarning = null;
    let lactationWarning = null;
    let realEndMins = 0;
    let startMins = 0;
    let originalEndMins = 0;

    if (shiftObj) {
        startMins = timeToMins(shiftObj.start_time || shiftObj.start);
        originalEndMins = timeToMins(shiftObj.end_time || shiftObj.end);
        realEndMins = originalEndMins;
        
        if (config.lunchTime) {
            const lunchMins = timeToMins(config.lunchTime);
            if (lunchMins < 660 || lunchMins > 900) lunchWarning = "Solo permitido de 11:00 AM a 3:00 PM.";
            else if (lunchMins <= startMins || lunchMins >= originalEndMins) lunchWarning = "Debe estar dentro del turno laboral.";
        }

        if (config.lactationTime) {
            const lacMins = timeToMins(config.lactationTime);
            realEndMins += 60; 

            if (lacMins < startMins - 60) lactationWarning = "Ilegal: Más de 1h antes del ingreso.";
            else if (lacMins > originalEndMins) lactationWarning = "Absurdo: Después de salida.";
        }
    }

    // 🚨 BANDERA DE MODIFICACIÓN: ¿El horario real es diferente al del turno base?
    const isPhysicalScheduleModified = shiftObj && (realEndMins !== originalEndMins);

    const handleLunchToggle = (checked) => {
        if (!checked) return onChange(day.id, 'lunchTime', null);
        if (shiftObj) {
            const sMins = timeToMins(shiftObj.start_time || shiftObj.start);
            const eMins = timeToMins(shiftObj.end_time || shiftObj.end);
            let midMins = sMins + Math.floor((eMins - sMins) / 2);
            if (midMins < 660) midMins = 720; 
            else if (midMins > 900) midMins = 780; 
            onChange(day.id, 'lunchTime', minsToTime(midMins));
        } else onChange(day.id, 'lunchTime', '12:00');
    };

    const handleLactationToggle = (checked) => {
        if (!checked) return onChange(day.id, 'lactationTime', null);
        if (shiftObj) onChange(day.id, 'lactationTime', shiftObj.end_time || shiftObj.end);
        else onChange(day.id, 'lactationTime', '15:00');
    };

    return (
        <div className={`rounded-[1.2rem] border transition-all duration-200 overflow-visible flex flex-col ${
            conflict ? `${conflict.bg} ${conflict.border} shadow-sm` 
            : isWorking ? 'bg-white/60 shadow-[0_4px_12px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.9)] border-white/80' 
            : 'bg-white/20 border-white/40 hover:bg-white/40'
        }`}>
            <div className="p-3.5 flex flex-col xl:flex-row xl:items-start gap-4 md:gap-5">
                
                {/* BLOQUE 1: SWITCH Y DÍA */}
                <div className="w-full xl:w-36 flex items-center justify-between xl:mt-2.5 flex-shrink-0">
                    <div>
                        <h4 className="text-[13px] md:text-[14px] font-black text-slate-800 uppercase tracking-widest">{day.name}</h4>
                        <p className={`text-[8px] font-bold uppercase tracking-widest mt-0.5 ${conflict ? conflict.text : isWorking ? 'text-[#007AFF]' : 'text-slate-400'}`}>
                            {conflict ? conflict.label : isWorking ? 'Día Laboral' : 'Día de Descanso'}
                        </p>
                    </div>
                    <Switch disabled={!!conflict} on={isWorking && !conflict} onToggle={() => onToggle(day.id, !isWorking, empBaseBranchId)} />
                </div>

                {/* BLOQUE 2: CONFIGURACIÓN O CONFLICTO */}
                {conflict ? (
                    <div className={`flex-1 flex items-center gap-3 bg-white/50 p-2.5 rounded-xl border ${conflict.border} xl:mt-1`}>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${conflict.iconBg} ${conflict.text}`}>
                            <conflict.icon size={16} strokeWidth={2.5}/>
                        </div>
                        <div>
                            <p className={`text-[9.5px] font-black uppercase tracking-widest leading-tight ${conflict.textDark}`}>Día Bloqueado Administrativamente</p>
                            <p className={`text-[8.5px] font-bold uppercase mt-0.5 leading-tight ${conflict.text}`}>{conflict.label} {conflict.note ? `- ${conflict.note}` : ''}</p>
                        </div>
                    </div>
                ) : isWorking ? (
                    <div className="flex-1 flex flex-col gap-2.5 xl:border-l xl:border-slate-200/50 xl:pl-5 pt-3 xl:pt-0 border-t border-slate-200/50 xl:border-t-0 overflow-visible">
                        
                        <div className={`grid grid-cols-1 md:grid-cols-2 ${isMultiBranch ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 overflow-visible`}>
                            {/* SUCURSAL */}
                            {isMultiBranch && (
                                <div className="lg:col-span-1 overflow-visible">
                                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5">
                                        <Building2 size={12} className="text-indigo-500"/> Ubicación
                                    </label>
                                    <LiquidSelect 
                                        value={String(config.branchId || empBaseBranchId || '')}
                                        onChange={(val) => onChange(day.id, 'branchId', val)}
                                        options={branchOptions}
                                        placeholder="SELECCIONE..."
                                        clearable={false}
                                    />
                                </div>
                            )}

                            {/* TURNO */}
                            <div className="lg:col-span-1 overflow-visible z-[100]">
                                <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5">
                                    <Clock size={12} className={!config.shiftId ? 'text-red-500 animate-pulse' : 'text-[#007AFF]'}/> Turno Asignado
                                </label>
                                <LiquidSelect 
                                    value={String(config.shiftId || '')}
                                    onChange={(val) => onChange(day.id, 'shiftId', val ? parseInt(val) : '')}
                                    options={shiftOptions}
                                    placeholder={!config.shiftId ? "FALTA TURNO" : "SELECCIONE..."}
                                    clearable={false}
                                    className={!config.shiftId ? "[&>div]:border-red-300 [&>div]:bg-red-50" : ""}
                                />
                            </div>

                            {/* ALMUERZO */}
                            <div className="lg:col-span-1 flex flex-col justify-start">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <Utensils size={12} className="text-orange-500"/> Almuerzo (-1h)
                                    </label>
                                    <BeautifulCheckbox checked={!!config.lunchTime} onChange={handleLunchToggle} theme="orange" />
                                </div>
                                {config.lunchTime ? (
                                    <div className="flex flex-col gap-1">
                                        <div className={`h-[34px] ${lunchWarning ? '[&_input]:border-red-400 [&_input]:bg-red-50 [&_input]:text-red-700' : ''}`}>
                                            <TimePicker12 value={config.lunchTime} onChange={(v) => onChange(day.id, 'lunchTime', v)} />
                                        </div>
                                        {lunchWarning && (
                                            <div className="mt-0.5 flex items-start gap-1 bg-red-50 border border-red-200 px-1 py-0.5 rounded animate-in zoom-in-95">
                                                <AlertTriangle size={8} className="text-red-500 shrink-0 mt-[1px]"/>
                                                <span className="text-[7.5px] font-black text-red-600 uppercase leading-tight">{lunchWarning}</span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="h-[34px] rounded-[10px] bg-white/40 border border-dashed border-slate-300 flex items-center justify-center text-[8px] font-bold text-slate-300 uppercase tracking-widest shadow-inner">Sin Almuerzo</div>
                                )}
                            </div>

                            {/* LACTANCIA */}
                            <div className="lg:col-span-1 flex flex-col justify-start">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <Baby size={12} className="text-pink-500"/> Lactancia (+1h)
                                    </label>
                                    <BeautifulCheckbox checked={!!config.lactationTime} onChange={handleLactationToggle} theme="pink" />
                                </div>
                                {config.lactationTime ? (
                                    <div className="flex flex-col gap-1">
                                        <div className={`h-[34px] ${lactationWarning ? '[&_input]:border-red-400 [&_input]:bg-red-50 [&_input]:text-red-700' : ''}`}>
                                            <TimePicker12 value={config.lactationTime} onChange={(v) => onChange(day.id, 'lactationTime', v)} />
                                        </div>
                                        {lactationWarning && (
                                            <div className="mt-0.5 flex items-start gap-1 bg-red-50 border border-red-200 px-1 py-0.5 rounded animate-in zoom-in-95">
                                                <AlertTriangle size={8} className="text-red-500 shrink-0 mt-[1px]"/>
                                                <span className="text-[7.5px] font-black text-red-600 uppercase leading-tight">{lactationWarning}</span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="h-[34px] rounded-[10px] bg-white/40 border border-dashed border-slate-300 flex items-center justify-center text-[8px] font-bold text-slate-300 uppercase tracking-widest shadow-inner">No Aplica</div>
                                )}
                            </div>
                        </div>

                        {/* 🚨 BANNER HORARIO REAL (SOLO VISIBLE SI HAY MODIFICACIÓN LÓGICA) */}
                        {isPhysicalScheduleModified && (
                            <div className="w-full flex items-center gap-3 bg-slate-50/60 border border-slate-200/50 p-2 rounded-xl mt-0.5 animate-in fade-in zoom-in-95 duration-300">
                                <div className="flex items-center gap-1.5 text-[8.5px] text-slate-600 border-r border-slate-200 pr-2.5">
                                    <Clock size={10} className="text-slate-400"/> 
                                    <span className="font-black uppercase tracking-widest text-slate-500">Horario Físico Real:</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[9.5px] font-black text-slate-800">{formatCompactTime(minsToTime(startMins))}</span>
                                    <ArrowRight size={10} className="text-slate-300"/>
                                    <span className={`text-[9.5px] font-black ${config.lactationTime ? 'text-pink-600' : 'text-slate-800'}`}>
                                        {formatCompactTime(minsToTime(realEndMins))}
                                    </span>
                                    {config.lactationTime && (
                                        <span className="text-[7.5px] font-bold text-pink-600 bg-pink-50 px-1.5 py-0.5 rounded uppercase tracking-widest border border-pink-100 ml-1">
                                            Salida extendida (+1h)
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center xl:border-l xl:border-slate-200/50 xl:pl-6 pt-3 xl:pt-0 border-t border-slate-200/50 xl:border-t-0">
                        <div className="w-full xl:w-auto px-5 py-2 rounded-[1rem] bg-white/40 border border-dashed border-slate-300/80 text-slate-400 flex justify-center items-center gap-2 shadow-inner">
                            <Palmtree size={14} strokeWidth={2.5}/>
                            <span className="text-[9.5px] font-black uppercase tracking-widest">Día de Descanso</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

// ============================================================================
// 🚀 COMPONENTE PRINCIPAL
// ============================================================================
const FormPlanificador = ({ formData, setFormData, shifts }) => {
    const { branches } = useStaff();
    const emp = formData.employee || {};
    const schedule = formData.schedule || {};
    const history = emp.history || [];

    const isMonthlyLimitedRole = emp.role && (emp.role.toUpperCase().includes('REGENTE') || emp.role.toUpperCase().includes('FARMACOVIGILANCIA') || emp.role.toUpperCase().includes('AUDITOR'));
    const isMultiBranch = isMonthlyLimitedRole || (emp.assigned_branches && emp.assigned_branches.length > 1);
    const maxHours = isMonthlyLimitedRole ? 176 : 44;
    const baseBranchId = emp.branch_id || emp.branchId;

    const getDateOfDay = useCallback((dayId) => {
        if (!formData.weekStartDate) return '';
        const [y, m, d] = formData.weekStartDate.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const targetDiff = dayId === 0 ? 6 : dayId - 1;
        date.setDate(date.getDate() + targetDiff);
        return date.toISOString().split('T')[0];
    }, [formData.weekStartDate]);

    const getConflict = useCallback((dayId) => {
        const dateStr = getDateOfDay(dayId);
        const event = history.find(ev => ['VACATION', 'DISABILITY', 'PERMISSION', 'HOLIDAY'].includes(ev.type) && ev.date <= dateStr && (!ev.metadata?.endDate || ev.metadata.endDate >= dateStr));
        if (!event) return null;
        
        const configs = {
            VACATION: { label: 'Vacaciones', icon: Palmtree, bg: 'bg-amber-50/70', border: 'border-amber-200/60', text: 'text-amber-600', textDark: 'text-amber-800', iconBg: 'bg-amber-100' },
            DISABILITY: { label: 'Incapacidad', icon: HeartPulse, bg: 'bg-red-50/70', border: 'border-red-200/60', text: 'text-red-600', textDark: 'text-red-800', iconBg: 'bg-red-100' },
            PERMISSION: { label: 'Permiso', icon: FileText, bg: 'bg-purple-50/70', border: 'border-purple-200/60', text: 'text-purple-600', textDark: 'text-purple-800', iconBg: 'bg-purple-100' },
            HOLIDAY: { label: 'Asueto', icon: CalendarOff, bg: 'bg-indigo-50/70', border: 'border-indigo-200/60', text: 'text-indigo-600', textDark: 'text-indigo-800', iconBg: 'bg-indigo-100' }
        };
        return { ...configs[event.type], note: event.note };
    }, [history, getDateOfDay]);

    const branchOptions = useMemo(() => branches.map(b => ({
        value: String(b.id), 
        label: `${b.name} ${String(b.id) === String(baseBranchId) ? '(Base)' : ''}`
    })), [branches, baseBranchId]);

    const shiftsByBranch = useMemo(() => {
        const dict = {};
        shifts.forEach(s => {
            const bId = String(s.branchId || s.branch_id);
            if (!dict[bId]) dict[bId] = [];
            dict[bId].push({
                value: String(s.id),
                label: `${s.name} (${formatCompactTime(s.start_time || s.start)} - ${formatCompactTime(s.end_time || s.end)})`
            });
        });
        return dict;
    }, [shifts]);

    const currentStats = useMemo(() => {
        let totalHours = 0;
        let daysOff = 0;

        WEEK_DAYS.forEach(day => {
            const conflict = getConflict(day.id);
            const config = schedule[day.id] || {};
            const isWorking = !!config.shiftId || config.shiftId === '';

            if (conflict || !isWorking) {
                daysOff++;
            } else if (config.shiftId) {
                const shift = shifts.find(s => String(s.id) === String(config.shiftId));
                if (shift && (shift.start_time || shift.start)) {
                    const start = shift.start_time || shift.start;
                    const end = shift.end_time || shift.end;
                    const [h1, m1] = start.split(':').map(Number);
                    const [h2, m2] = end.split(':').map(Number);
                    
                    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
                    if (mins < 0) mins += 1440; 
                    if (config.lunchTime) mins -= 60; 
                    if (config.lactationTime) mins += 60; 

                    totalHours += (mins / 60);
                }
            }
        });

        return { hours: Number(totalHours.toFixed(1)), daysOff, isExcess: totalHours > maxHours, noDaysOff: daysOff === 0 };
    }, [schedule, shifts, maxHours, getConflict]);

    const handleDayChange = useCallback((dayId, field, value) => {
        setFormData(prev => {
            const currentDaySchedule = prev.schedule[dayId] || {};
            let newDaySchedule = { ...currentDaySchedule, [field]: value };
            if (field === 'branchId') newDaySchedule.shiftId = '';
            return { ...prev, schedule: { ...prev.schedule, [dayId]: newDaySchedule } };
        });
    }, [setFormData]);

    const handleToggleDay = useCallback((dayId, isWorking, activeBaseBranchId) => {
        if (!isWorking) {
            setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, [dayId]: { shiftId: null, branchId: null, lunchTime: null, lactationTime: null } } }));
        } else {
            setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, [dayId]: { shiftId: '', branchId: activeBaseBranchId, lunchTime: null, lactationTime: null } } }));
        }
    }, [setFormData]);

    return (
        <div className="flex flex-col h-full -mx-6 -my-6 p-4 md:-mx-10 md:-my-8 md:p-10 relative z-10">
            
            {/* 🚨 DASHBOARD COMPACTO Y ELEGANTE */}
            <div className="bg-white/60 backdrop-blur-md p-3 md:p-4 rounded-[1.2rem] border border-white/80 shadow-[0_2px_15px_rgba(0,0,0,0.02),inset_0_1px_1px_rgba(255,255,255,0.9)] mb-4 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <div className="flex-1 w-full">
                    <div className="flex justify-between items-end mb-1.5">
                        <div>
                            <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                                <Clock size={12} className={currentStats.isExcess ? 'text-red-500' : 'text-[#007AFF]'}/>
                                Horas Asignadas
                            </h3>
                            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                                {isMonthlyLimitedRole ? 'Límite Mensual (Especial)' : 'Límite Semanal Estándar'}
                            </p>
                        </div>
                        <div className="text-right">
                            <span className={`text-[18px] font-black leading-none ${currentStats.isExcess ? 'text-red-500' : 'text-slate-800'}`}>{currentStats.hours}h</span>
                            <span className="text-[10px] font-bold text-slate-400"> / {maxHours}h</span>
                        </div>
                    </div>
                    <div className="h-1.5 bg-white/50 rounded-full overflow-hidden shadow-inner border border-white/80">
                        <div className={`h-full rounded-full transition-all duration-500 ease-out ${currentStats.isExcess ? 'bg-red-500' : 'bg-[#007AFF]'}`} style={{ width: `${Math.min((currentStats.hours / maxHours) * 100, 100)}%` }}></div>
                    </div>
                </div>

                <div className="flex flex-wrap md:flex-col gap-1.5 shrink-0 w-full md:w-auto">
                    {currentStats.isExcess && (
                        <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-600 px-2 py-1 rounded-[8px] shadow-sm animate-in fade-in">
                            <AlertTriangle size={10} strokeWidth={2.5}/>
                            <span className="text-[8px] font-black uppercase tracking-widest">Exceso (+{Number((currentStats.hours - maxHours).toFixed(1))}h)</span>
                        </div>
                    )}
                    {currentStats.noDaysOff && (
                        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 text-amber-600 px-2 py-1 rounded-[8px] shadow-sm animate-in fade-in">
                            <AlertTriangle size={10} strokeWidth={2.5}/>
                            <span className="text-[8px] font-black uppercase tracking-widest">Sin días de descanso</span>
                        </div>
                    )}
                    {!currentStats.isExcess && !currentStats.noDaysOff && (
                        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-600 px-2 py-1 rounded-[8px] shadow-sm animate-in fade-in">
                            <CheckCircle2 size={10} strokeWidth={2.5}/>
                            <span className="text-[8px] font-black uppercase tracking-widest">Programación Óptima</span>
                        </div>
                    )}
                </div>
            </div>

            {/* LISTA DE DÍAS OPTIMIZADA */}
            <div className="space-y-3 relative z-10 pb-4">
                {WEEK_DAYS.map(day => {
                    const conflict = getConflict(day.id);
                    const config = schedule[day.id] || {};
                    const isWorking = !!config.shiftId || config.shiftId === ''; 
                    const activeBranchIdForDay = config.branchId || baseBranchId;
                    
                    const shiftObj = config.shiftId ? shifts.find(s => String(s.id) === String(config.shiftId)) : null;

                    return (
                        <DayRow 
                            key={day.id}
                            day={day}
                            conflict={conflict}
                            config={config}
                            isWorking={isWorking}
                            isMultiBranch={isMultiBranch}
                            empBaseBranchId={baseBranchId}
                            branchOptions={branchOptions}
                            shiftOptions={shiftsByBranch[activeBranchIdForDay] || []}
                            shiftObj={shiftObj}
                            onToggle={handleToggleDay}
                            onChange={handleDayChange}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default FormPlanificador;