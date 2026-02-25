import React, { useState } from 'react';
import { 
    CalendarDays, Clock, LayoutList, LayoutGrid, 
    ChevronLeft, ArrowRight, Palmtree, Utensils, Baby,
    ClipboardList, X, Save, Info, Building2
} from 'lucide-react';

// Hooks y Helpers
import { useStaff } from '../context/StaffContext';
import { 
    getStartOfWeek, formatDate, getEffectiveBranchId, 
    calculateTotalWeeklyHours, getScheduleForDate, 
    getDaySegments, minsToTime, formatTime12h 
} from '../utils/helpers';
import { WEEK_DAYS } from '../data/constants';
import TimePicker12 from '../components/common/TimePicker12';
import BranchChips from '../components/common/BranchChips';

const SchedulesView = () => {
    const { employees, shifts, branches, updateEmployee } = useStaff();
    
    // Estados de UI
    const [activeTab, setActiveTab] = useState('planner'); 
    const [viewMode, setViewMode] = useState('list'); 
    const [filterBranch, setFilterBranch] = useState('ALL');
    const [startDate, setStartDate] = useState(getStartOfWeek(new Date().toISOString()));
    
    // Estado para el modal de planificación
    const [plannerModalOpen, setPlannerModalOpen] = useState(false);
    const [plannerEmp, setPlannerEmp] = useState(null);
    const [tempSchedule, setTempSchedule] = useState({});

    // --- LÓGICA DE NAVEGACIÓN SEMANAL ---
    const changeWeek = (days) => {
        const newDate = new Date(startDate);
        newDate.setDate(newDate.getDate() + days);
        setStartDate(getStartOfWeek(newDate.toISOString()));
    };

    const calendarDates = Array.from({length: 7}).map((_, i) => { 
        const d = new Date(startDate); 
        d.setDate(d.getDate() + i); 
        return d.toISOString().split('T')[0]; 
    });

    // --- MANEJO DEL PLANIFICADOR ---
    const openPlanner = (emp) => {
        setPlannerEmp(emp);
        setTempSchedule(emp.weeklySchedule || {});
        setPlannerModalOpen(true);
    };

    const handleDayChange = (dayId, field, value) => {
        setTempSchedule(prev => ({
            ...prev,
            [dayId]: { ...prev[dayId], [field]: value }
        }));
    };

    const saveSchedule = () => {
        updateEmployee(plannerEmp.id, { weeklySchedule: tempSchedule });
        setPlannerModalOpen(false);
    };

    // Filtros
    const employeesInView = employees.filter(e => 
        filterBranch === 'ALL' || getEffectiveBranchId(e) === parseInt(filterBranch)
    );

    return (
        <div className="p-4 md:p-8 bg-slate-50 min-h-full animate-in fade-in duration-500">
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <CalendarDays className="text-blue-600" /> Planificador de Turnos
                    </h1>
                    <p className="text-slate-500 text-sm font-medium">Gestión de horarios para las 6 sucursales</p>
                </div>
                
                <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                    <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}><LayoutList size={20}/></button>
                    <button onClick={() => setViewMode('calendar')} className={`p-2 rounded-lg ${viewMode === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}><LayoutGrid size={20}/></button>
                </div>
            </header>

            <div className="mb-8">
                <BranchChips branches={branches} selectedBranch={filterBranch} onSelect={setFilterBranch} />
            </div>

            {viewMode === 'calendar' ? (
                /* VISTA CALENDARIO VISUAL */
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <button onClick={() => changeWeek(-7)} className="p-2 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all"><ChevronLeft size={20}/></button>
                            <span className="font-bold text-slate-700 uppercase tracking-tighter text-sm">Semana: {formatDate(startDate)}</span>
                            <button onClick={() => changeWeek(7)} className="p-2 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all"><ArrowRight size={20}/></button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-6 border-b border-r bg-slate-50 w-48 sticky left-0 z-10 text-[10px] font-black uppercase text-slate-400 tracking-widest">Colaborador</th>
                                    {calendarDates.map(date => (
                                        <th key={date} className="p-4 border-b bg-slate-50 text-center min-w-[150px]">
                                            <div className="text-[10px] uppercase font-black text-slate-400">{new Date(date).toLocaleDateString('es-ES', { weekday: 'short' })}</div>
                                            <div className="text-lg font-black text-slate-800">{new Date(date).getDate()}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {employeesInView.map(emp => (
                                    <tr key={emp.id} className="hover:bg-slate-50/50">
                                        <td className="p-6 border-r bg-white sticky left-0 z-10 shadow-sm">
                                            <p className="font-bold text-slate-800 text-xs">{emp.name}</p>
                                            <p className="text-[10px] text-blue-600 font-bold uppercase">{calculateTotalWeeklyHours(emp.weeklySchedule, shifts)}h semanales</p>
                                        </td>
                                        {calendarDates.map(date => {
                                            const conf = getScheduleForDate(emp, date, shifts);
                                            const segments = getDaySegments(conf);
                                            return (
                                                <td key={date} className="p-2 border-r border-slate-50 h-40">
                                                    {conf ? (
                                                        <div className="flex flex-col h-full gap-1">
                                                            {segments.map((seg, i) => (
                                                                <div key={i} className={`text-[9px] p-1.5 rounded-lg border font-bold uppercase flex flex-col justify-center ${seg.type === 'work' ? 'bg-blue-50 text-blue-700 border-blue-100 flex-1' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                                                                    <span>{seg.label}</span>
                                                                    <span className="opacity-60">{minsToTime(seg.start)} - {minsToTime(seg.end)}</span>
                                                                </div>
                                                            ))}
                                                            {conf.lactationTime && (
                                                                <div className="text-[9px] p-1.5 rounded-lg border font-bold uppercase flex items-center gap-1 bg-pink-50 text-pink-700 border-pink-100">
                                                                    <Baby size={10}/> {conf.lactationTime}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : <div className="h-full flex items-center justify-center text-slate-200"><Palmtree size={20}/></div>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* VISTA LISTA DE GESTIÓN */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {employeesInView.map(emp => (
                        <div key={emp.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex gap-3">
                                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-400 border border-slate-200 overflow-hidden">
                                        {emp.photo ? <img src={emp.photo} className="w-full h-full object-cover" /> : emp.name.charAt(0)}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm">{emp.name}</h4>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase">{emp.role}</p>
                                    </div>
                                </div>
                                <button onClick={() => openPlanner(emp)} className="p-2 bg-slate-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-sm"><ClipboardList size={18}/></button>
                            </div>
                            <div className="pt-4 border-t border-slate-50 flex justify-between items-end">
                                <div>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Carga Semanal</p>
                                    <p className={`text-xl font-black ${calculateTotalWeeklyHours(emp.weeklySchedule, shifts) > 44 ? 'text-red-500' : 'text-slate-700'}`}>
                                        {calculateTotalWeeklyHours(emp.weeklySchedule, shifts)}h <span className="text-[10px] text-slate-300">/ 44h</span>
                                    </p>
                                </div>
                                <div className="flex -space-x-2">
                                    {WEEK_DAYS.map(d => (
                                        <div key={d.id} className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-bold ${emp.weeklySchedule?.[d.id]?.shiftId ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                            {d.name.charAt(0)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* MODAL PLANIFICADOR */}
            {plannerModalOpen && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-300">
                        <div className="bg-slate-900 p-8 flex justify-between items-center text-white">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20"><ClipboardList size={24}/></div>
                                <div>
                                    <h3 className="text-xl font-black uppercase tracking-tighter">Planificar Semana</h3>
                                    <p className="text-blue-400 text-xs font-bold uppercase tracking-widest">{plannerEmp?.name}</p>
                                </div>
                            </div>
                            <button onClick={() => setPlannerModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-all"><X size={24}/></button>
                        </div>
                        <div className="p-8 max-h-[60vh] overflow-y-auto scrollbar-hide">
                            <table className="w-full text-left">
                                <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b">
                                    <tr>
                                        <th className="pb-4">Día</th>
                                        <th className="pb-4">Turno Asignado</th>
                                        <th className="pb-4">Hora Almuerzo</th>
                                        <th className="pb-4">Hora Lactancia (Opcional)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {WEEK_DAYS.map(day => {
                                        const config = tempSchedule[day.id] || {};
                                        return (
                                            <tr key={day.id}>
                                                <td className="py-4 font-bold text-slate-700 text-sm uppercase">{day.name}</td>
                                                <td className="py-4 pr-4">
                                                    <select 
                                                        className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                                        value={config.shiftId || ''}
                                                        onChange={(e) => handleDayChange(day.id, 'shiftId', parseInt(e.target.value))}
                                                    >
                                                        <option value="">— Día Libre —</option>
                                                        {shifts.filter(s => s.branchId === plannerEmp.branchId).map(s => (
                                                            <option key={s.id} value={s.id}>{s.name} ({formatTime12h(s.start)} - {formatTime12h(s.end)})</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="py-4 pr-4">
                                                    <div className="flex gap-2">
                                                        <TimePicker12 value={config.lunchTime || '12:00'} onChange={(v) => handleDayChange(day.id, 'lunchTime', v)} />
                                                    </div>
                                                </td>
                                                <td className="py-4">
                                                    <div className="flex items-center gap-3">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input 
                                                                type="checkbox" 
                                                                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                                                                checked={!!config.lactationTime} 
                                                                onChange={(e) => handleDayChange(day.id, 'lactationTime', e.target.checked ? '15:00' : null)}
                                                            />
                                                            <span className="text-xs font-bold text-slate-500">Aplica</span>
                                                        </label>
                                                        {config.lactationTime && (
                                                            <TimePicker12 value={config.lactationTime} onChange={(v) => handleDayChange(day.id, 'lactationTime', v)} />
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-8 bg-slate-50 border-t flex justify-between items-center">
                            <div className="flex items-center gap-2 text-slate-500">
                                <Info size={16}/>
                                <p className="text-[10px] font-bold uppercase tracking-wider">Asegúrate de no exceder las 44h semanales.</p>
                            </div>
                            <button onClick={saveSchedule} className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-3 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-500/20 transition-all active:scale-95">Guardar Cambios</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SchedulesView;