import React from 'react';
import { Clock, Palmtree, Utensils, Baby, HeartPulse, FileText } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12'; // Ruta corregida
import { WEEK_DAYS } from '../../data/constants';

const formatTime12h = (timeString) => {
    if (!timeString) return '';
    const [hourStr, minStr] = timeString.split(':');
    let hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'P.M.' : 'A.M.';
    hour = hour % 12 || 12;
    return `${hour}:${minStr} ${ampm}`;
};

const Switch = ({ on, onToggle, disabled }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={[
            "relative inline-flex items-center flex-shrink-0 w-11 h-6 rounded-full border transition-colors duration-200",
            disabled ? "opacity-40 cursor-not-allowed bg-slate-200 border-slate-300" : (on ? "bg-[#007AFF] border-[#007AFF]/40" : "bg-black/10 border-black/10"),
        ].join(" ")}
    >
        <span className={["absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200", on ? "translate-x-5" : "translate-x-0"].join(" ")} />
    </button>
);

const FormPlanificador = ({ formData, setFormData, shifts }) => {
    const emp = formData.employee || {};
    const schedule = formData.schedule || {};
    const history = emp.history || [];

    const getDateOfDay = (dayId) => {
        if (!formData.weekStartDate) return '';
        const [y, m, d] = formData.weekStartDate.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const targetDiff = dayId === 0 ? 6 : dayId - 1;
        date.setDate(date.getDate() + targetDiff);
        return date.toISOString().split('T')[0];
    };

    const getConflict = (dayId) => {
        const dateStr = getDateOfDay(dayId);
        const event = history.find(ev => 
            ['VACATION', 'DISABILITY', 'PERMISSION'].includes(ev.type) &&
            ev.date <= dateStr &&
            (!ev.metadata?.endDate || ev.metadata.endDate >= dateStr)
        );
        if (!event) return null;
        
        const labels = { VACATION: 'Vacaciones', DISABILITY: 'Incapacidad', PERMISSION: 'Permiso' };
        const icons = { VACATION: Palmtree, DISABILITY: HeartPulse, PERMISSION: FileText };
        return { label: labels[event.type], icon: icons[event.type], note: event.note };
    };

    const handleDayChange = (dayId, field, value) => {
        setFormData(prev => ({
            ...prev,
            schedule: { ...prev.schedule, [dayId]: { ...(prev.schedule[dayId] || {}), [field]: value } }
        }));
    };

    const handleToggleDay = (dayId, isWorking) => {
        if (!isWorking) {
            setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, [dayId]: { shiftId: null, lunchTime: null, lactationTime: null } } }));
        } else {
            setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, [dayId]: { shiftId: '', lunchTime: null, lactationTime: null } } }));
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50/50 -mx-10 -my-8 p-10 relative">
            <div className="space-y-4 pt-4">
                {WEEK_DAYS.map(day => {
                    const conflict = getConflict(day.id);
                    const config = schedule[day.id] || {};
                    const isWorking = !!config.shiftId || config.shiftId === ''; 
                    
                    return (
                        <div key={day.id} className={`rounded-[2rem] border transition-all duration-300 overflow-hidden ${conflict ? 'bg-amber-50/50 border-amber-200' : isWorking ? 'bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] border-white' : 'bg-transparent border-slate-200 opacity-60 hover:opacity-100'}`}>
                            <div className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                                <div className="w-48 flex items-center justify-between flex-shrink-0">
                                    <div>
                                        <h4 className="text-[16px] font-black text-slate-800 uppercase tracking-widest">{day.name}</h4>
                                        <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${conflict ? 'text-amber-600' : isWorking ? 'text-[#007AFF]' : 'text-slate-400'}`}>
                                            {conflict ? `Bloqueado: ${conflict.label}` : isWorking ? 'Día Laboral' : 'Día Libre'}
                                        </p>
                                    </div>
                                    <Switch 
                                        disabled={!!conflict} 
                                        on={isWorking && !conflict} 
                                        onToggle={() => handleToggleDay(day.id, !isWorking)} 
                                    />
                                </div>

                                {conflict ? (
                                    <div className="flex-1 flex items-center gap-4 bg-white/60 p-4 rounded-2xl border border-amber-100">
                                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                                            <conflict.icon size={20} />
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black text-amber-800 uppercase tracking-widest">Colaborador no disponible</p>
                                            <p className="text-[10px] font-bold text-amber-600/70 uppercase">{conflict.label}: {conflict.note || 'Sin observaciones'}</p>
                                        </div>
                                    </div>
                                ) : isWorking ? (
                                    <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 border-t border-slate-100 md:border-t-0 md:border-l md:pl-6 pt-4 md:pt-0">
                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-2">
                                                <Clock size={12} className="text-[#007AFF]"/> Turno Base
                                            </label>
                                            <select 
                                                required
                                                className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-[12px] font-bold outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] transition-all"
                                                value={config.shiftId || ''}
                                                onChange={(e) => handleDayChange(day.id, 'shiftId', e.target.value ? parseInt(e.target.value) : '')}
                                            >
                                                <option value="" disabled>Seleccione un turno</option>
                                                {shifts.filter(s => s.branchId === emp.branchId).map(s => (
                                                    <option key={s.id} value={s.id}>{s.name} ({formatTime12h(s.start)} - {formatTime12h(s.end)})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                                    <Utensils size={12} className="text-orange-500"/> Almuerzo
                                                </label>
                                                <input 
                                                    type="checkbox" 
                                                    className="w-3.5 h-3.5 rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                                                    checked={!!config.lunchTime} 
                                                    onChange={(e) => handleDayChange(day.id, 'lunchTime', e.target.checked ? '12:00' : null)}
                                                />
                                            </div>
                                            {config.lunchTime ? (
                                                <TimePicker12 value={config.lunchTime} onChange={(v) => handleDayChange(day.id, 'lunchTime', v)} />
                                            ) : (
                                                <div className="h-[42px] rounded-2xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">Sin Almuerzo</div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                                    <Baby size={12} className="text-pink-500"/> Lactancia
                                                </label>
                                                <input 
                                                    type="checkbox" 
                                                    className="w-3.5 h-3.5 rounded text-pink-500 focus:ring-pink-500 cursor-pointer"
                                                    checked={!!config.lactationTime} 
                                                    onChange={(e) => handleDayChange(day.id, 'lactationTime', e.target.checked ? '15:00' : null)}
                                                />
                                            </div>
                                            {config.lactationTime ? (
                                                <TimePicker12 value={config.lactationTime} onChange={(v) => handleDayChange(day.id, 'lactationTime', v)} />
                                            ) : (
                                                <div className="h-[42px] rounded-2xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">No Aplica</div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center border-t border-slate-100 md:border-t-0 md:border-l md:pl-6 pt-4 md:pt-0">
                                        <div className="px-6 py-3 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-slate-400 flex items-center gap-3">
                                            <Palmtree size={18}/>
                                            <span className="text-[11px] font-black uppercase tracking-widest">Día de Descanso</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default FormPlanificador;