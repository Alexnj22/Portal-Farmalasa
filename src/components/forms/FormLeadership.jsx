import React, { useMemo, useEffect } from 'react';
import { Search, User, MapPin, Briefcase, ArrowRightLeft, TrendingUp, Clock, ShieldCheck, CheckCircle2, FileText, AlertCircle, UserMinus, Award, Phone, CalendarDays } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect'; 

const getTenure = (dateString) => {
    if (!dateString) return 'N/A';
    const diffDays = Math.floor(Math.abs(new Date() - new Date(dateString)) / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    if (years > 0) return `${years}a ${months > 0 ? `${months}m` : ''}`;
    if (months > 0) return `${months}m`;
    return 'Reciente';
};

// Utilidad para ocultar scrollbars pero mantener el scroll
const hideScrollbarClass = "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]";

const FormLeadership = ({ formData, setFormData }) => {
    const employees = useStaff(state => state.employees);
    const branches = useStaff(state => state.branches);

    // 1. Detección del Ocupante Actual
    const currentAssigneeObj = useMemo(() => 
        employees.find(e => e.id === formData.currentAssignee), 
    [employees, formData.currentAssignee]);

    // 2. Auto-seleccionar al Titular Actual al abrir el modal
    useEffect(() => {
        if (formData.currentAssignee && !formData.selectedEmpId) {
            setFormData(prev => ({ ...prev, selectedEmpId: formData.currentAssignee }));
        }
        // Inicializar acción de salida por defecto
        if (currentAssigneeObj && !formData.outgoingAction) {
            setFormData(prev => ({ 
                ...prev, 
                outgoingAction: 'REASSIGN', 
                outgoingRole: 'Dependiente de Farmacia',
                outgoingBranch: prev.branch?.id || ''
            }));
        }
    }, [currentAssigneeObj, formData.currentAssignee, setFormData, formData.outgoingAction]);

    // 3. Buscador
    const filteredEmployees = useMemo(() => {
        const query = (formData.searchQuery || '').toLowerCase().trim();
        if (!query) return employees;
        return employees.filter(emp => 
            emp.name.toLowerCase().includes(query) ||
            (emp.role && emp.role.toLowerCase().includes(query))
        );
    }, [employees, formData.searchQuery]);

    const selectedEmp = useMemo(() => employees.find(e => e.id === formData.selectedEmpId), [employees, formData.selectedEmpId]);
    const empBranch = useMemo(() => branches.find(b => String(b.id) === String(selectedEmp?.branchId)), [branches, selectedEmp]);
    
    // 4. Lógica de Movimiento
    const moveType = useMemo(() => {
        if (!selectedEmp || !formData.branch) return 'NONE';
        const isSameBranch = String(selectedEmp.branchId) === String(formData.branch.id);
        const isSameRole = selectedEmp.role === formData.targetRole;
        if (isSameBranch && !isSameRole) return 'PROMOTION';
        if (!isSameBranch && isSameRole) return 'TRANSFER';
        if (!isSameBranch && !isSameRole) return 'TRANSFER_PROMOTION';
        return 'LATERAL';
    }, [selectedEmp, formData.branch, formData.targetRole]);

    useEffect(() => {
        if (formData.moveType !== moveType) setFormData(prev => ({ ...prev, moveType }));
    }, [moveType, formData.moveType, setFormData]);

    // Banderas de estado
    const isReplacing = currentAssigneeObj && selectedEmp && selectedEmp.id !== currentAssigneeObj.id;
    const isCurrentJefeSelected = currentAssigneeObj && selectedEmp && selectedEmp.id === currentAssigneeObj.id;
    const isNurse = (currentAssigneeObj?.role || '').toLowerCase().includes('enfermer');

    return (
        <div className="flex flex-col md:flex-row h-[70vh] min-h-[550px] w-auto overflow-hidden -mx-6 md:-mx-10 -my-6 bg-slate-50/20"> 
            
            {/* ====== PANEL IZQUIERDO: BUSCADOR ====== */}
            <div className="w-full md:w-[38%] flex flex-col border-r border-white/60 bg-white/20 backdrop-blur-xl relative z-20 shadow-[2px_0_20px_rgba(0,0,0,0.02)]">
                
                <div className="p-4 border-b border-white/60 bg-white/30 sticky top-0 z-30">
                    <div className="relative">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" strokeWidth={2.5}/>
                        <input 
                            type="text" 
                            placeholder="Buscar candidato..." 
                            className="w-full bg-white/40 backdrop-blur-md border border-white/80 rounded-[1.2rem] pl-10 pr-4 py-3 text-[13px] font-bold text-slate-800 placeholder:text-slate-500 outline-none focus:border-[#007AFF] focus:bg-white/70 focus:shadow-[0_8px_30px_rgba(0,122,255,0.15)] transition-all shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)]"
                            value={formData.searchQuery || ''}
                            onChange={(e) => setFormData({...formData, searchQuery: e.target.value})}
                        />
                    </div>
                </div>
                
                {/* 🚨 SCROLL OCULTO APLICADO */}
                <div className={`flex-1 overflow-y-auto p-3 space-y-2 relative z-10 bg-slate-50/10 ${hideScrollbarClass}`} style={{ WebkitOverflowScrolling: 'touch' }}>
                    {filteredEmployees.map(emp => {
                        const isSelected = formData.selectedEmpId === emp.id;
                        const isCurrentJefe = formData.currentAssignee === emp.id;

                        return (
                            <div 
                                key={emp.id} 
                                onClick={() => setFormData({...formData, selectedEmpId: emp.id})}
                                className={`flex flex-col gap-2 p-3 rounded-[1.2rem] cursor-pointer border relative transition-colors ${
                                    isSelected 
                                    ? 'bg-white/90 border-[#007AFF] shadow-[0_4px_15px_rgba(0,122,255,0.12)] ring-1 ring-[#007AFF]/20' 
                                    : 'bg-white/30 border-white/60 hover:bg-white/60 shadow-sm'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg overflow-hidden shrink-0 border-2 shadow-[inset_0_2px_5px_rgba(0,0,0,0.05)] ${isSelected ? 'border-[#007AFF] text-[#007AFF] bg-blue-50' : 'border-white text-slate-500 bg-white/80'}`}>
                                        {emp.photo ? <img src={emp.photo} alt="" className="w-full h-full object-cover"/> : emp.name.charAt(0)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] font-black truncate leading-tight ${isSelected ? 'text-[#007AFF]' : 'text-slate-800'}`}>{emp.name}</p>
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest truncate mt-0.5">{emp.role || 'Sin puesto'}</p>
                                    </div>
                                    {isSelected && <CheckCircle2 size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5}/>}
                                </div>
                                {isCurrentJefe && (
                                    <div className="bg-amber-100/80 backdrop-blur-sm text-amber-700 text-[8px] font-black uppercase tracking-widest text-center py-1 rounded-lg mt-1 w-full border border-amber-200/50">
                                        Titular Actual
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ====== PANEL DERECHO: LÓGICA Y ASIGNACIÓN ====== */}
            {/* 🚨 SCROLL OCULTO APLICADO AQUÍ TAMBIÉN */}
            <div className={`flex-1 flex flex-col bg-transparent overflow-y-auto relative p-6 md:p-8 ${hideScrollbarClass}`}>
                
                {!selectedEmp ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                        <User size={64} strokeWidth={1} className="text-slate-400 mb-4"/>
                        <p className="text-[16px] font-black text-slate-700 uppercase tracking-widest">Esperando Candidato</p>
                        <p className="text-[12px] font-bold text-slate-500 mt-2 max-w-[250px]">Elige a un colaborador de la lista lateral.</p>
                    </div>
                ) : (
                    <div className="w-full max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 pb-10">
                        
                        {/* 1. MINI-RESUMEN DEL EMPLEADO (EXPANDIDO) */}
                        <div className="bg-white/40 backdrop-blur-md border border-white/80 rounded-[1.5rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03),inset_0_2px_15px_rgba(255,255,255,0.6)] relative overflow-hidden">
                            <div className="flex items-center gap-4 relative z-10">
                                <div className="w-16 h-16 rounded-full border-[3px] border-white shadow-md overflow-hidden bg-slate-100 shrink-0">
                                    {selectedEmp.photo ? <img src={selectedEmp.photo} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-slate-400 font-black text-2xl">{selectedEmp.name.charAt(0)}</div>}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-black text-slate-800 leading-tight">{selectedEmp.name}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="bg-blue-50 text-[#007AFF] border border-blue-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">{selectedEmp.role || 'Sin Rol'}</span>
                                        <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><MapPin size={10}/> {empBranch?.name || 'Banca'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Fila de Datos Clave */}
                            <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-white/50 relative z-10">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shadow-sm shrink-0"><CalendarDays size={10} strokeWidth={2.5}/></div>
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Antigüedad</span>
                                        <span className="text-[11px] font-bold text-slate-700 mt-0.5">{getTenure(selectedEmp.hireDate || selectedEmp.hire_date)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shadow-sm shrink-0"><Phone size={10} strokeWidth={2.5}/></div>
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Contacto</span>
                                        <span className="text-[11px] font-bold text-slate-700 mt-0.5 truncate">{selectedEmp.phone || 'N/A'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ESTADO A: SI EL SELECCIONADO YA ES EL TITULAR */}
                        {isCurrentJefeSelected ? (
                            <div className="bg-amber-50/60 backdrop-blur-md border border-amber-200/80 rounded-[1.5rem] p-6 text-center shadow-sm">
                                <ShieldCheck size={32} className="text-amber-400 mx-auto mb-3" strokeWidth={2}/>
                                <h4 className="text-[14px] font-black text-amber-800 uppercase tracking-widest">Titular Actual</h4>
                                <p className="text-[11px] font-bold text-amber-700/80 mt-2 max-w-sm mx-auto leading-relaxed">
                                    Este colaborador ocupa actualmente el cargo de {formData.targetRole}. Para efectuar un relevo o cambio, selecciona a un candidato diferente en la lista.
                                </p>
                            </div>
                        ) : (
                        /* ESTADO B: SI EL SELECCIONADO ES NUEVO (Flujo de Cambio) */
                            <>
                                {/* 2. ANÁLISIS DE MOVIMIENTO */}
                                <div className="bg-white/40 border border-white rounded-[1.5rem] p-4 shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)]">
                                    <div className="flex items-center gap-3">
                                        {moveType === 'PROMOTION' && <TrendingUp size={20} className="text-[#007AFF] shrink-0" strokeWidth={2.5}/>}
                                        {moveType === 'TRANSFER' && <ArrowRightLeft size={20} className="text-[#007AFF] shrink-0" strokeWidth={2.5}/>}
                                        {moveType === 'TRANSFER_PROMOTION' && <Award size={20} className="text-purple-500 shrink-0" strokeWidth={2.5}/>}
                                        {moveType === 'LATERAL' && <Briefcase size={20} className="text-slate-500 shrink-0" strokeWidth={2.5}/>}
                                        <p className="text-[11px] font-bold text-slate-600 leading-tight">
                                            Asumirá como <strong className="text-[#007AFF]">{formData.targetRole}</strong>. 
                                            {moveType === 'PROMOTION' && ' Ascenso interno.'}
                                            {moveType === 'TRANSFER' && ' Traslado operativo.'}
                                            {moveType === 'TRANSFER_PROMOTION' && ' Traslado y ascenso.'}
                                            {moveType === 'LATERAL' && ' Movimiento lateral.'}
                                        </p>
                                    </div>
                                </div>

                                {/* 3. GESTIÓN DE RELEVO */}
                                {isReplacing && (
                                    <div className="bg-red-50/60 backdrop-blur-md border border-red-200/80 rounded-[1.5rem] p-5 shadow-sm relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-3 border-b border-red-200/50 pb-3">
                                            <UserMinus size={16} className="text-red-500" strokeWidth={2.5}/>
                                            <span className="text-[11px] font-black uppercase tracking-widest text-red-600">Relevo de Personal</span>
                                        </div>
                                        <p className="text-[11px] font-bold text-red-800/80 leading-relaxed mb-4">
                                            <strong className="text-red-700 font-black">{currentAssigneeObj.name}</strong> dejará la jefatura. ¿Qué deseas hacer con su perfil operativo?
                                        </p>
                                        
                                        <div className="space-y-3">
                                            <label className={`flex flex-col p-4 rounded-xl border cursor-pointer transition-all ${formData.outgoingAction === 'REASSIGN' ? 'bg-white/80 border-[#007AFF] shadow-md ring-1 ring-[#007AFF]/20' : 'bg-white/40 border-red-200/50 hover:bg-white/70'}`}>
                                                <div className="flex items-start gap-3">
                                                    <input type="radio" name="outgoingAction" className="w-4 h-4 mt-0.5 text-[#007AFF] accent-[#007AFF]" checked={formData.outgoingAction === 'REASSIGN'} onChange={() => setFormData({...formData, outgoingAction: 'REASSIGN'})} />
                                                    <div className="flex flex-col w-full">
                                                        <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest">Reasignar Cargo</span>
                                                        
                                                        {/* 🚨 INTEGRACIÓN DE LIQUIDSELECT PARA EL RELEVO */}
                                                        {formData.outgoingAction === 'REASSIGN' && (
                                                            <div className="mt-4 grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-top-2 w-full">
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">A Sucursal</label>
                                                                    <div className="rounded-2xl transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md border border-transparent">
                                                                        <LiquidSelect 
                                                                            options={branches.map(b => ({ value: b.id, label: b.name }))}
                                                                            value={formData.outgoingBranch || ''}
                                                                            onChange={(val) => setFormData({...formData, outgoingBranch: val?.target ? val.target.value : val})}
                                                                            placeholder="Selecciona destino..."
                                                                            clearable={false}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Nuevo Rol</label>
                                                                    <div className="rounded-2xl transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md border border-transparent">
                                                                        <LiquidSelect 
                                                                            options={[
                                                                                { value: 'Dependiente de Farmacia', label: 'Dependiente de Farmacia' },
                                                                                { value: 'Subjefe/a de Sala', label: 'Subjefe/a de Sala' },
                                                                                { value: 'Jefe/a de Sala', label: 'Jefe/a de Sala' },
                                                                                ...(isNurse ? [{ value: 'Regente de Enfermería', label: 'Regente de Enfermería' }] : [])
                                                                            ]}
                                                                            value={formData.outgoingRole || ''}
                                                                            onChange={(val) => setFormData({...formData, outgoingRole: val?.target ? val.target.value : val})}
                                                                            placeholder="Selecciona el rol..."
                                                                            clearable={false}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </label>

                                            <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${formData.outgoingAction === 'UNASSIGN' ? 'bg-white/80 border-amber-400 shadow-md ring-1 ring-amber-400/20' : 'bg-white/40 border-red-200/50 hover:bg-white/70'}`}>
                                                <input type="radio" name="outgoingAction" className="w-4 h-4 mt-0.5 text-amber-500 accent-amber-500" checked={formData.outgoingAction === 'UNASSIGN'} onChange={() => setFormData({...formData, outgoingAction: 'UNASSIGN'})} />
                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest leading-none">Quitar Asignación (Flotante)</span>
                                                    <span className="text-[10px] font-bold text-slate-500 mt-1.5 leading-tight">Quedará temporalmente "Sin Asignar" a disposición de RRHH.</span>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {/* 4. CONFIGURACIÓN DEL CARGO */}
                                <div className="space-y-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Configuración del Cargo</h3>
                                    
                                    <div className="flex p-1.5 bg-white/30 backdrop-blur-md border border-white/60 rounded-[1.2rem] shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                                        <button type="button" onClick={() => setFormData({...formData, isPermanent: true})} className={`flex-1 py-3 text-[11px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-all ${formData.isPermanent !== false ? 'bg-white text-slate-800 shadow-[0_4px_15px_rgba(0,0,0,0.08)]' : 'text-slate-500 hover:bg-white/50'}`}>
                                            <ShieldCheck size={14}/> Permanente
                                        </button>
                                        <button type="button" onClick={() => setFormData({...formData, isPermanent: false})} className={`flex-1 py-3 text-[11px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-all ${formData.isPermanent === false ? 'bg-amber-500 text-white shadow-[0_4px_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 hover:bg-white/50'}`}>
                                            <Clock size={14}/> Interinato
                                        </button>
                                    </div>

                                    {formData.isPermanent === false && (
                                        <div className="bg-white/50 backdrop-blur-md border border-amber-200/60 rounded-[1.5rem] p-5 shadow-sm animate-in slide-in-from-top-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1.5 ml-1">
                                                <AlertCircle size={12} strokeWidth={3}/> Fecha de Fin de Interinato
                                            </label>
                                            <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl">
                                                <LiquidDatePicker 
                                                    value={formData.interimEndDate || ''}
                                                    onChange={(date) => setFormData({...formData, interimEndDate: date})}
                                                    placeholder="Selecciona la fecha límite"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5 ml-1">
                                            <FileText size={12} strokeWidth={3}/> Observaciones / Motivo
                                        </label>
                                        <textarea 
                                            placeholder={formData.isPermanent === false ? "Ej. Cubre vacaciones de Mónica Castro..." : "Notas sobre la asignación (Opcional)..."}
                                            className={`w-full h-20 bg-white/40 backdrop-blur-md border border-white/80 rounded-[1.5rem] p-4 text-[12px] font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#007AFF] focus:bg-white/70 focus:shadow-[0_8px_30px_rgba(0,122,255,0.15)] transition-all resize-none shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)] ${hideScrollbarClass}`}
                                            value={formData.notes || ''}
                                            onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                        ></textarea>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormLeadership;