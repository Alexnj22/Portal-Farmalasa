import React, { useState } from 'react';
import LiquidModal from './common/LiquidModal';
import ConfirmModal from './common/ConfirmModal';
import { X, Calendar as CalendarIcon, Clock, Save, ShieldAlert, Utensils, Baby, Info } from 'lucide-react';
import { useStaffStore } from '../store/staffStore';
import { fetchPublishedRosterWithId, updateEmployeeRosterById } from '../data/system';

const ShiftExceptionModal = ({ employee, onClose }) => {
    const { shifts, updateEmployee } = useStaffStore();
    const [isSaving, setIsSaving] = useState(false);
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
    
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

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);

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

        // 1. Write to employee.exceptions[] — kiosk reads this for real-time punch decisions
        const filteredExceptions = (employee.exceptions || []).filter(ex => ex.date !== todayStr);
        await updateEmployee(employee.id, {
            ...employee,
            exceptions: [...filteredExceptions, newException]
        });

        // 2. Also patch the published roster for today — consolidate-timesheets reads this
        //    for accurate timesheet generation. We find the current week's roster and update
        //    the dayKey with customStart/customEnd (and flip isOff if it was a day off).
        try {
            const todayDate  = new Date(todayStr + 'T12:00:00');
            const dow        = todayDate.getDay();               // 0=Sun … 6=Sat
            const diffToMon  = (dow + 6) % 7;                   // days back to Monday
            const monDate    = new Date(todayDate);
            monDate.setDate(monDate.getDate() - diffToMon);
            const weekStart  = monDate.toISOString().split('T')[0];
            const dayKey     = String(dow);

            const { data: roster } = await fetchPublishedRosterWithId(employee.id, weekStart);

            if (roster) {
                const updatedSchedule = {
                    ...(roster.schedule_data || {}),
                    [dayKey]: {
                        ...(roster.schedule_data?.[dayKey] || {}),
                        isOff: false,           // activates coverage even on a day off
                        customStart,
                        customEnd,
                        lunchTime: hasLunch ? lunchTime : (roster.schedule_data?.[dayKey]?.lunchTime ?? null),
                        lactationTime: hasLactation ? lactationTime : (roster.schedule_data?.[dayKey]?.lactationTime ?? null),
                        exceptionNote: newException.note,
                        exceptionDate: todayStr,
                    },
                };
                await updateEmployeeRosterById(roster.id, { schedule_data: updatedSchedule, updated_at: new Date().toISOString() });
            }
        } catch (err) {
            console.error('ShiftExceptionModal: roster patch failed', err);
            // Non-blocking — kiosk still works via employee.exceptions
        }

        setIsSaving(false);
        onClose();
    };

    const handleRemoveException = async () => {
        setConfirmRemoveOpen(false);

        // 1. Clear from employee.exceptions[]
        const filteredExceptions = (employee.exceptions || []).filter(ex => ex.date !== todayStr);
        await updateEmployee(employee.id, { ...employee, exceptions: filteredExceptions });

        // 2. Restore roster day to original (remove customStart/End/isOff override)
        try {
            const todayDate = new Date(todayStr + 'T12:00:00');
            const dow       = todayDate.getDay();
            const diffToMon = (dow + 6) % 7;
            const monDate   = new Date(todayDate);
            monDate.setDate(monDate.getDate() - diffToMon);
            const weekStart = monDate.toISOString().split('T')[0];
            const dayKey    = String(dow);

            const { data: roster } = await fetchPublishedRosterWithId(employee.id, weekStart);

            if (roster?.schedule_data?.[dayKey]) {
                const day = { ...roster.schedule_data[dayKey] };
                delete day.customStart;
                delete day.customEnd;
                delete day.exceptionNote;
                delete day.exceptionDate;
                // Restore isOff based on whether the day originally had a shift
                if (!day.shiftId || day.shiftId === 'LIBRE') day.isOff = true;

                await updateEmployeeRosterById(roster.id, {
                    schedule_data: { ...roster.schedule_data, [dayKey]: day },
                    updated_at: new Date().toISOString(),
                });
            }
        } catch (err) {
            console.error('ShiftExceptionModal: roster restore failed', err);
        }

        onClose();
    };

    return (
        <>
        <LiquidModal open onClose={onClose} maxWidth="max-w-3xl" zClass="z-50" ariaLabel={`Excepción para hoy — ${employee.name}`}>

                {/* HEADER — franja siempre oscura a propósito (acento de estado urgente,
                    no reactiva al tema), pero con contraste correcto para el subtítulo */}
                <div className="bg-slate-900 p-6 flex items-center justify-between text-white">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-brand rounded-full flex items-center justify-center font-black text-xl">
                            {employee.name.charAt(0)}
                        </div>
                        <div>
                            <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
                                Excepción para HOY <ShieldAlert size={18} className="text-orange-400"/>
                            </h2>
                            <p className="text-white/60 text-xs font-bold uppercase tracking-widest">{employee.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-danger rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 bg-transparent">

                    {/* COLUMNA IZQUIERDA: RESUMEN ORIGINAL (Ocupa 2/5 del ancho) */}
                    <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-divider bg-surface-card">
                        <h3 className="text-[10px] font-black text-content-2 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <CalendarIcon size={14} className="text-content-3"/> Turno Original (Hoy)
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <p className="text-sm font-black text-content uppercase">{originalShift?.name || 'Día Libre'}</p>
                                <p className="text-xs font-bold text-content-3 mt-1">
                                    {originalShift ? `${formatTime12h(originalShift.start)} - ${formatTime12h(originalShift.end)}` : 'Sin horario asignado'}
                                </p>
                            </div>

                            <div className="pt-4 border-t border-divider space-y-3">
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="flex items-center gap-1.5 text-content-3"><Utensils size={12}/> Almuerzo</span>
                                    <span className="text-content-2">{originalDayConfig?.lunchTime ? formatTime12h(originalDayConfig.lunchTime) : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="flex items-center gap-1.5 text-content-3"><Baby size={12}/> Lactancia</span>
                                    <span className="text-content-2">{originalDayConfig?.lactationTime ? formatTime12h(originalDayConfig.lactationTime) : 'N/A'}</span>
                                </div>
                            </div>

                            {existingException && (
                                <div className="mt-8 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                                    <p className="text-[10px] font-black text-warning uppercase tracking-widest mb-2 flex items-center gap-1">
                                        <Info size={12}/> Excepción Activa
                                    </p>
                                    <p className="text-xs text-warning font-medium">Este empleado ya tiene un horario modificado para el día de hoy.</p>
                                    <button
                                        onClick={() => setConfirmRemoveOpen(true)}
                                        className="mt-3 w-full bg-surface-card text-danger border border-danger/30 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-danger/10"
                                    >
                                        Revertir al Original
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* COLUMNA DERECHA: FORMULARIO DE EXCEPCIÓN (Ocupa 3/5 del ancho) */}
                    <div className="p-6 md:p-8 col-span-3">
                        <h3 className="text-[10px] font-black text-brand uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Clock size={14} className="text-brand"/> Definir Nuevo Horario Especial
                        </h3>

                        <form onSubmit={handleSave} className="space-y-5">
                            {/* ENTRADA Y SALIDA */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-content-2 uppercase tracking-widest mb-1.5 block">Hora Entrada</label>
                                    <input
                                        type="time"
                                        required
                                        data-surface="input"
                                        className="w-full p-3 text-sm font-bold text-brand outline-none focus:outline focus:outline-2 focus:outline-brand/30 transition-all"
                                        value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-content-2 uppercase tracking-widest mb-1.5 block">Hora Salida</label>
                                    <input
                                        type="time"
                                        required
                                        data-surface="input"
                                        className="w-full p-3 text-sm font-bold text-brand outline-none focus:outline focus:outline-2 focus:outline-brand/30 transition-all"
                                        value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* ALMUERZO Y LACTANCIA */}
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className={`p-4 rounded-xl border-2 transition-all ${hasLunch ? 'border-warning bg-warning/10' : 'border-divider bg-surface-card'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer mb-3">
                                        <input
                                            type="checkbox"
                                            checked={hasLunch}
                                            onChange={(e) => setHasLunch(e.target.checked)}
                                            className="w-4 h-4 accent-warning"
                                        />
                                        <span className="text-[10px] font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5"><Utensils size={12}/> Almuerzo</span>
                                    </label>
                                    <input
                                        type="time"
                                        disabled={!hasLunch}
                                        data-surface="input"
                                        className="w-full p-2 text-sm font-bold text-warning outline-none focus:outline focus:outline-2 focus:outline-warning/30 disabled:opacity-50 transition-all"
                                        value={lunchTime} onChange={(e) => setLunchTime(e.target.value)}
                                    />
                                </div>

                                <div className={`p-4 rounded-xl border-2 transition-all ${hasLactation ? 'border-pink-400 bg-pink-50/30' : 'border-divider bg-surface-card'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer mb-3">
                                        <input
                                            type="checkbox"
                                            checked={hasLactation}
                                            onChange={(e) => setHasLactation(e.target.checked)}
                                            className="w-4 h-4 accent-pink-500"
                                        />
                                        <span className="text-[10px] font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5"><Baby size={12}/> Lactancia</span>
                                    </label>
                                    <input
                                        type="time"
                                        disabled={!hasLactation}
                                        data-surface="input"
                                        className="w-full p-2 text-sm font-bold text-pink-600 outline-none focus:outline focus:outline-2 focus:outline-pink-300 disabled:opacity-50 transition-all"
                                        value={lactationTime} onChange={(e) => setLactationTime(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* NOTA */}
                            <div className="pt-2">
                                <label className="text-[10px] font-black text-content-2 uppercase tracking-widest mb-1 block">Motivo (Opcional)</label>
                                <input
                                    type="text"
                                    placeholder="Ej: Cubriendo vacante sucursal norte..."
                                    data-surface="input"
                                    className="w-full p-3 text-sm font-medium text-content outline-none focus:outline focus:outline-2 focus:outline-brand/30 transition-all"
                                    value={note} onChange={(e) => setNote(e.target.value)}
                                />
                            </div>

                            <button type="submit" disabled={isSaving} className="w-full mt-2 bg-brand text-white font-black text-xs uppercase tracking-widest py-4 rounded-xl hover:bg-brand-hover transition-all shadow-lg shadow-brand/20 active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                                <Save size={16} /> {isSaving ? 'Guardando…' : 'Aplicar Excepción a HOY'}
                            </button>
                        </form>
                    </div>

                </div>
        </LiquidModal>

        <ConfirmModal
            isOpen={confirmRemoveOpen}
            onClose={() => setConfirmRemoveOpen(false)}
            onConfirm={handleRemoveException}
            title="¿Revertir al horario original?"
            message="Se eliminará la excepción y el empleado regresará a su horario normal de hoy."
            confirmText="Sí, revertir"
            isDestructive
        />
        </>
    );
};

export default ShiftExceptionModal;