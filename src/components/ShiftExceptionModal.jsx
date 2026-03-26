import React, { useState, useEffect } from 'react';
import { X, Calendar as CalendarIcon, Clock, Save, ShieldAlert, Utensils, Baby, Info } from 'lucide-react';
import { useStaffStore } from '../store/staffStore';

const ShiftExceptionModal = ({ employee, onClose }) => {
    const { shifts, updateEmployee } = useStaffStore();
    
    // Fijamos la fecha a HOY
    const todayObj = new Date();
    const todayStr = todayObj.toISOString().split('T')[0];

    // Obtenemos el turno original de HOY para mostrarlo
    const jsDay = todayObj.getDay();
    const dbDay = jsDay === 0 ? 7 : jsDay;
    const originalDayConfig = employee.weeklySchedule?.[dbDay];
    const originalShift = shifts.find(s => s.id.toString() === originalDayConfig?.shiftId?.toString());
    
    // Revisamos si YA tiene una excepción hoy
    const existingException = (employee.exceptions || []).find(ex => ex.date === todayStr);

    // Estados del formulario (Si hay excepción previa, la cargamos. Si no, cargamos los datos de su turno original)
    const [customStart, setCustomStart] = useState(existingException?.customStart || originalShift?.start || '08:00');
    const [customEnd, setCustomEnd] = useState(existingException?.customEnd || originalShift?.end || '17:00');
    
    const [hasLunch, setHasLunch] = useState(!!(existingException?.lunchTime || originalDayConfig?.lunchTime));
    const [lunchTime, setLunchTime] = useState(existingException?.lunchTime || originalDayConfig?.lunchTime || '12:00');

    const [hasLactation, setHasLactation] = useState(!!(existingException?.lactationTime || originalDayConfig?.lactationTime));
    const [lactationTime, setLactationTime] = useState(existingException?.lactationTime || originalDayConfig?.lactationTime || '16:00');
    
    const [note, setNote] = useState(existingException?.note || '');

    const formatTime12h = (time24) => {
        if (!time24) return 'N/A';
        let [h, m] = time24.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    const handleSave = (e) => {
        e.preventDefault();

        const newException = {
            id: existingException?.id || Date.now().toString(),
            date: todayStr,
            isCustom: true,
            customStart,
            customEnd,
            lunchTime: hasLunch ? lunchTime : null,
            lactationTime: hasLactation ? lactationTime : null,
            note: note || 'Cambio manual de turno para el día de hoy'
        };

        const filteredExceptions = (employee.exceptions || []).filter(ex => ex.date !== todayStr);

        updateEmployee(employee.id, {
            ...employee,
            exceptions: [...filteredExceptions, newException]
        });

        onClose();
    };

    const handleRemoveException = () => {
        if (!window.confirm("¿Deseas eliminar la excepción y regresar a su horario normal de hoy?")) return;
        const filteredExceptions = (employee.exceptions || []).filter(ex => ex.date !== todayStr);
        updateEmployee(employee.id, { ...employee, exceptions: filteredExceptions });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col">
                
                {/* HEADER */}
                <div className="bg-slate-900 p-6 flex items-center justify-between text-white">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center font-black text-xl">
                            {employee.name.charAt(0)}
                        </div>
                        <div>
                            <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
                                Excepción para HOY <ShieldAlert size={18} className="text-orange-400"/>
                            </h2>
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{employee.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-red-500 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 bg-slate-50">
                    
                    {/* COLUMNA IZQUIERDA: RESUMEN ORIGINAL (Ocupa 2/5 del ancho) */}
                    <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-slate-200 bg-white">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <CalendarIcon size={14} className="text-slate-400"/> Turno Original (Hoy)
                        </h3>
                        
                        <div className="space-y-4">
                            <div>
                                <p className="text-sm font-black text-slate-800 uppercase">{originalShift?.name || 'Día Libre'}</p>
                                <p className="text-xs font-bold text-slate-500 mt-1">
                                    {originalShift ? `${formatTime12h(originalShift.start)} - ${formatTime12h(originalShift.end)}` : 'Sin horario asignado'}
                                </p>
                            </div>

                            <div className="pt-4 border-t border-slate-100 space-y-3">
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="flex items-center gap-1.5 text-slate-400"><Utensils size={12}/> Almuerzo</span>
                                    <span className="text-slate-600">{originalDayConfig?.lunchTime ? formatTime12h(originalDayConfig.lunchTime) : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="flex items-center gap-1.5 text-slate-400"><Baby size={12}/> Lactancia</span>
                                    <span className="text-slate-600">{originalDayConfig?.lactationTime ? formatTime12h(originalDayConfig.lactationTime) : 'N/A'}</span>
                                </div>
                            </div>

                            {existingException && (
                                <div className="mt-8 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                                        <Info size={12}/> Excepción Activa
                                    </p>
                                    <p className="text-xs text-orange-800 font-medium">Este empleado ya tiene un horario modificado para el día de hoy.</p>
                                    <button 
                                        onClick={handleRemoveException}
                                        className="mt-3 w-full bg-white text-red-600 border border-red-200 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-50"
                                    >
                                        Revertir al Original
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* COLUMNA DERECHA: FORMULARIO DE EXCEPCIÓN (Ocupa 3/5 del ancho) */}
                    <div className="p-6 md:p-8 col-span-3">
                        <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Clock size={14} className="text-blue-600"/> Definir Nuevo Horario Especial
                        </h3>
                        
                        <form onSubmit={handleSave} className="space-y-5">
                            {/* ENTRADA Y SALIDA */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Hora Entrada</label>
                                    <input 
                                        type="time" 
                                        required
                                        className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold text-blue-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Hora Salida</label>
                                    <input 
                                        type="time" 
                                        required
                                        className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold text-blue-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                                        value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* ALMUERZO Y LACTANCIA */}
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className={`p-4 rounded-xl border-2 transition-all ${hasLunch ? 'border-orange-400 bg-orange-50/30' : 'border-slate-100 bg-white'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer mb-3">
                                        <input 
                                            type="checkbox" 
                                            checked={hasLunch} 
                                            onChange={(e) => setHasLunch(e.target.checked)}
                                            className="w-4 h-4 accent-orange-500"
                                        />
                                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5"><Utensils size={12}/> Almuerzo</span>
                                    </label>
                                    <input 
                                        type="time" 
                                        disabled={!hasLunch}
                                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-sm font-bold text-orange-700 outline-none focus:border-orange-500 disabled:opacity-50 disabled:bg-slate-50 transition-all"
                                        value={lunchTime} onChange={(e) => setLunchTime(e.target.value)}
                                    />
                                </div>

                                <div className={`p-4 rounded-xl border-2 transition-all ${hasLactation ? 'border-pink-400 bg-pink-50/30' : 'border-slate-100 bg-white'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer mb-3">
                                        <input 
                                            type="checkbox" 
                                            checked={hasLactation} 
                                            onChange={(e) => setHasLactation(e.target.checked)}
                                            className="w-4 h-4 accent-pink-500"
                                        />
                                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5"><Baby size={12}/> Lactancia</span>
                                    </label>
                                    <input 
                                        type="time" 
                                        disabled={!hasLactation}
                                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-sm font-bold text-pink-700 outline-none focus:border-pink-500 disabled:opacity-50 disabled:bg-slate-50 transition-all"
                                        value={lactationTime} onChange={(e) => setLactationTime(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* NOTA */}
                            <div className="pt-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Motivo (Opcional)</label>
                                <input 
                                    type="text" 
                                    placeholder="Ej: Cubriendo vacante sucursal norte..."
                                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 outline-none focus:border-blue-500 transition-all"
                                    value={note} onChange={(e) => setNote(e.target.value)}
                                />
                            </div>
                            
                            <button type="submit" className="w-full mt-2 bg-blue-600 text-white font-black text-xs uppercase tracking-widest py-4 rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95 flex items-center justify-center gap-2">
                                <Save size={16} /> Aplicar Excepción a HOY
                            </button>
                        </form>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ShiftExceptionModal;