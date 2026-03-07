import React, { useState } from 'react';
import { ShieldAlert, BookOpen, Building2, Trash2, ListTodo, Info } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { formatTime12h } from '../../utils/helpers';

const FormTurnos = ({ formData, setFormData, branches, shifts, deleteShift }) => {
    const [listBranchFilter, setListBranchFilter] = useState('ALL');

    const selectedBranch = branches.find(b => String(b.id) === String(formData.newShiftBranch));
    let bMin = "23:59";
    let bMax = "00:00";
    let hasOpen = false;

    if (selectedBranch?.weeklyHours) {
        Object.values(selectedBranch.weeklyHours).forEach(d => {
            if(d.isOpen && d.start && d.end) {
                hasOpen = true;
                if(d.start < bMin) bMin = d.start;
                if(d.end > bMax) bMax = d.end;
            }
        });
    }

    let isInvalidTime = false;
    let errorMessage = "";

    if (formData.newShiftStart && formData.newShiftEnd) {
        if (formData.newShiftStart >= formData.newShiftEnd) {
            isInvalidTime = true;
            errorMessage = "La hora de salida debe ser posterior a la de entrada.";
        } else if (hasOpen && (formData.newShiftStart < bMin || formData.newShiftEnd > bMax)) {
            isInvalidTime = true;
            errorMessage = `El turno debe estar dentro del horario operativo de la sucursal (${formatTime12h(bMin)} - ${formatTime12h(bMax)}).`;
        }
    } else if (formData.newShiftStart || formData.newShiftEnd) {
        isInvalidTime = true;
        errorMessage = "Debe completar ambas horas (entrada y salida) para crear el turno.";
    }

    const visibleShifts = shifts.filter(s => listBranchFilter === 'ALL' || String(s.branchId) === String(listBranchFilter));

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            <div className="space-y-6">
                <div className={`p-6 rounded-[2rem] border transition-colors duration-300 ${isInvalidTime ? 'bg-red-50/50 border-red-200' : 'bg-blue-50/50 border-blue-100'}`}>
                    <h4 className={`text-[12px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 ${isInvalidTime ? 'text-red-600' : 'text-blue-800'}`}>
                        {isInvalidTime ? <ShieldAlert size={16}/> : <BookOpen size={16} />}
                        Crear Nuevo Turno
                    </h4>
                    
                    <div className="space-y-5">
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sucursal Asignada</label>
                            <select 
                                required 
                                className="mt-2 w-full p-3.5 rounded-2xl border border-slate-200 outline-none focus:border-[#007AFF] bg-white shadow-sm text-sm font-bold text-slate-700" 
                                value={formData.newShiftBranch || ''} 
                                onChange={e => setFormData({ ...formData, newShiftBranch: e.target.value })}
                            >
                                <option value="" disabled>Seleccionar Sucursal</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                        
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nombre del Turno</label>
                            <input 
                                required 
                                placeholder="Ej: Mañana 8am-4pm" 
                                className="mt-2 w-full p-3.5 rounded-2xl border border-slate-200 outline-none focus:border-[#007AFF] shadow-sm text-sm font-bold text-slate-700" 
                                value={formData.newShiftName || ''} 
                                onChange={e => setFormData({ ...formData, newShiftName: e.target.value })} 
                            />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Hora de Entrada</label>
                                <TimePicker12 value={formData.newShiftStart || ''} onChange={v => setFormData({ ...formData, newShiftStart: v })} />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Hora de Salida</label>
                                <TimePicker12 value={formData.newShiftEnd || ''} onChange={v => setFormData({ ...formData, newShiftEnd: v })} />
                            </div>
                        </div>

                        {isInvalidTime && (
                            <div className="p-4 bg-red-100 text-red-700 rounded-2xl text-[11px] font-medium border border-red-200 leading-relaxed animate-in fade-in slide-in-from-top-2">
                                <strong className="font-black block mb-1">Horario Inválido</strong>
                                {errorMessage}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-5 bg-slate-50 border border-slate-100 rounded-3xl flex gap-3 text-slate-500 shadow-sm">
                    <Info size={20} className="flex-shrink-0" />
                    <p className="text-[11px] font-medium leading-relaxed">Este turno estará disponible únicamente para los empleados asignados a la sucursal seleccionada.</p>
                </div>
            </div>

            <div className="flex flex-col h-full bg-slate-50 rounded-[2rem] border border-slate-100 p-6 overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                    <h4 className="text-[12px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                        <ListTodo size={16} className="text-[#007AFF]"/> Turnos Existentes
                    </h4>
                    <select 
                        className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none shadow-sm"
                        value={listBranchFilter}
                        onChange={(e) => setListBranchFilter(e.target.value)}
                    >
                        <option value="ALL">Todas</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
                    {visibleShifts.length > 0 ? (
                        visibleShifts.map(shift => {
                            const bName = branches.find(b => b.id === shift.branchId)?.name || 'Desconocida';
                            return (
                                <div key={shift.id} className="bg-white p-4 rounded-[1.25rem] border border-slate-100 shadow-sm flex items-center justify-between group hover:border-[#007AFF]/30 transition-colors">
                                    <div>
                                        <p className="text-[13px] font-black text-slate-800 mb-0.5">{shift.name}</p>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            <span className="text-[#007AFF]">{formatTime12h(shift.start)} - {formatTime12h(shift.end)}</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1"><Building2 size={10}/> {bName}</span>
                                        </div>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            if(window.confirm(`¿Eliminar permanentemente el turno "${shift.name}"?`)){
                                                deleteShift(shift.id);
                                            }
                                        }}
                                        className="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white"
                                        title="Eliminar turno"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            );
                        })
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3 opacity-60">
                            <BookOpen size={32} strokeWidth={1.5} />
                            <p className="text-[10px] font-black uppercase tracking-widest">No hay turnos registrados</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormTurnos;