import React, { useMemo } from 'react';
import { Plus, Trash2, UploadCloud, ShieldCheck, Users, Award, Receipt, CheckCircle2 } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';

const FormNursingRegents = ({ formData, setFormData }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};
    const nursingRegents = legalData.nursingRegents || [];

    // Opciones para el LiquidSelect
    const nurseOptions = useMemo(() => {
        return employees
            .filter(emp => (emp.role || '').toUpperCase().includes('ENFERMER'))
            .map(emp => ({ value: emp.id, label: emp.name }));
    }, [employees]);

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: { ...(formData.settings || {}), legal: { ...legalData, [field]: value } }
        });
    };

    const addNurse = () => updateLegalField('nursingRegents', [...nursingRegents, { id: Date.now(), employeeId: '', anualidadExp: '' }]);
    
    const removeNurse = (index) => {
        const newArr = [...nursingRegents];
        newArr.splice(index, 1);
        updateLegalField('nursingRegents', newArr);
    };

    const updateNurse = (index, field, value) => {
        const newArr = [...nursingRegents];
        newArr[index] = { ...newArr[index], [field]: value };
        updateLegalField('nursingRegents', newArr);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2 pt-2">

            {/* 📝 PERMISO DEL ESTABLECIMIENTO (TARJETA PADRE 1) */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/80 p-6 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/60 transition-all duration-500 transform-gpu space-y-5">
                <div className="flex items-center gap-2 mb-2">
                    <Award size={16} className="text-[#007AFF]" strokeWidth={2.5}/>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                        Permiso de Servicios de Enfermería
                    </h4>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="group/input">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/input:text-[#007AFF] transition-colors">
                            N° Permiso / Licencia
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl">
                            <input 
                                type="text" 
                                className="w-full px-5 py-3.5 h-[50px] rounded-2xl bg-white/60 border border-slate-200/80 outline-none focus:border-[#007AFF] focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] hover:border-[#007AFF]/40 hover:bg-white transition-all text-[13px] font-bold text-slate-800 shadow-sm placeholder:text-slate-400 placeholder:font-medium" 
                                placeholder="Ej: ENF-2026-001"
                                value={legalData.nursingServicePermit || ""} 
                                onChange={(e) => updateLegalField('nursingServicePermit', e.target.value)} 
                            />
                        </div>
                    </div>
                    
                    <div className="group/date flex flex-col justify-end">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/date:text-[#007AFF] transition-colors">
                            Vencimiento Permiso
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl h-[50px] bg-white/60 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] flex items-center border border-slate-200/80 hover:border-[#007AFF]/40 focus-within:border-[#007AFF] overflow-hidden">
                             <div className="w-full relative -top-0.5">
                                <LiquidDatePicker 
                                    value={legalData.nursingServicePermitExp || ""} 
                                    onChange={(val) => updateLegalField('nursingServicePermitExp', val)} 
                                    placeholder="Seleccionar..." 
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* UPLOAD FILE */}
                <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
                        Permiso Físico (PDF/IMG)
                    </label>
                    <div className={`relative group border-2 border-dashed rounded-[1.5rem] p-4 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-4 cursor-pointer overflow-hidden ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'bg-blue-50/50 border-blue-300 hover:bg-blue-50' : 'bg-slate-50/50 border-slate-300 hover:bg-[#007AFF]/5 hover:border-[#007AFF]/50'}`}>
                        <input type="file" accept="application/pdf,image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => updateLegalField('nursingServicePermitFile', e.target.files?.[0] || null)} />
                        
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-all duration-300 group-hover:scale-105 ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'bg-white text-[#007AFF] border border-blue-100' : 'bg-white text-slate-400 group-hover:text-[#007AFF]'}`}>
                             {legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? <ShieldCheck size={20} strokeWidth={2}/> : <UploadCloud size={20} strokeWidth={1.5} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-black tracking-tight truncate ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'text-[#007AFF]' : 'text-slate-600'}`}>
                                {legalData.nursingServicePermitFile ? legalData.nursingServicePermitFile.name : legalData.nursingServicePermitUrl ? "Archivo adjunto guardado" : "Toca para subir documento"}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                {legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'Reemplazar archivo' : 'PDF, JPG o PNG (Máx 5MB)'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 📝 ARREGLO DE ENFERMEROS (CONTENEDOR GLOBAL) */}
            <div>
                <div className="flex items-center justify-between mb-4 px-2 mt-8">
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                        <Users size={16} className="text-[#007AFF]"/> Profesionales Asignados
                    </h4>
                    <button type="button" onClick={addNurse} className="text-[10px] font-black bg-white border border-[#007AFF]/20 text-[#007AFF] hover:bg-[#007AFF] hover:text-white px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all duration-300 active:scale-95 uppercase tracking-widest shadow-sm hover:shadow-[0_4px_12px_rgba(0,122,255,0.2)] hover:-translate-y-0.5">
                        <Plus size={14} strokeWidth={2.5}/> Añadir Profesional
                    </button>
                </div>
                
                <div className="space-y-6">
                    {nursingRegents.map((nurse, index) => (
                        /* TARJETA PADRE 2 (DINÁMICA) */
                        <div key={nurse.id || index} className="bg-white/40 backdrop-blur-xl border border-white/80 p-5 md:p-6 rounded-[2rem] relative group shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/70 transition-all duration-500 transform-gpu">
                            
                            <button type="button" onClick={() => removeNurse(index)} className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center bg-white border border-red-200 text-red-400 rounded-full shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-all duration-300 opacity-0 group-hover:opacity-100 z-20 active:scale-95 hover:scale-110">
                                <Trash2 size={14} strokeWidth={2.5}/>
                            </button>
                            
                            <div className="space-y-5">
                                {/* SELECT DEL COLABORADOR */}
                                <div className="group/select">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-[#007AFF] transition-colors">
                                        Colaborador en Planilla
                                    </label>
                                    <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-[1.5rem]">
                                        <LiquidSelect 
                                            value={nurse.employeeId} 
                                            onChange={(val) => updateNurse(index, 'employeeId', val)} 
                                            options={nurseOptions} 
                                            placeholder="Seleccionar..."
                                            icon={Users}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-5">
                                    {/* Upload Carnet */}
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1 block">Carné JVQE (PDF/IMG)</label>
                                        <div className={`relative group/btn border-2 border-dashed rounded-2xl p-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer ${nurse.carneFile || nurse.carneUrl ? 'bg-blue-50/40 border-blue-200 hover:bg-blue-50/80' : 'bg-slate-50/50 border-slate-200 hover:bg-[#007AFF]/5 hover:border-[#007AFF]/40'}`}>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => updateNurse(index, 'carneFile', e.target.files?.[0] || null)} />
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 group-hover/btn:scale-105 ${nurse.carneFile || nurse.carneUrl ? 'bg-white text-[#007AFF] shadow-sm border-blue-100' : 'bg-white text-slate-400 border-slate-100 group-hover/btn:text-[#007AFF]'}`}>
                                                {nurse.carneFile || nurse.carneUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16}/>}
                                            </div>
                                            <p className="text-[10px] font-black text-slate-600 truncate transition-colors group-hover/btn:text-[#007AFF]">
                                                {nurse.carneFile ? nurse.carneFile.name : nurse.carneUrl ? "Archivo guardado" : "Subir carné..."}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Upload Licencia */}
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1 block">Licencia Regencia (PDF)</label>
                                        <div className={`relative group/btn border-2 border-dashed rounded-2xl p-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer ${nurse.licenciaFile || nurse.licenciaUrl ? 'bg-blue-50/40 border-blue-200 hover:bg-blue-50/80' : 'bg-slate-50/50 border-slate-200 hover:bg-[#007AFF]/5 hover:border-[#007AFF]/40'}`}>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => updateNurse(index, 'licenciaFile', e.target.files?.[0] || null)} />
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 group-hover/btn:scale-105 ${nurse.licenciaFile || nurse.licenciaUrl ? 'bg-white text-[#007AFF] shadow-sm border-blue-100' : 'bg-white text-slate-400 border-slate-100 group-hover/btn:text-[#007AFF]'}`}>
                                                {nurse.licenciaFile || nurse.licenciaUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16}/>}
                                            </div>
                                            <p className="text-[10px] font-black text-slate-600 truncate transition-colors group-hover/btn:text-[#007AFF]">
                                                {nurse.licenciaFile ? nurse.licenciaFile.name : nurse.licenciaUrl ? "Archivo guardado" : "Subir licencia..."}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* ZONA DE ANUALIDAD */}
                                <div className="bg-gradient-to-br from-amber-50/80 to-amber-100/30 p-4 rounded-2xl border border-amber-200/60 shadow-inner mt-2 transition-all duration-500 hover:shadow-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Receipt size={14} className="text-amber-500" strokeWidth={2.5}/>
                                        <h5 className="text-[10px] font-black uppercase tracking-widest text-amber-700">Control de Anualidad</h5>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        {/* Upload Anualidad */}
                                        <div className="flex flex-col justify-end">
                                            <label className="text-[9px] font-black text-amber-600/80 uppercase tracking-widest ml-1 mb-1 block">Recibo de Pago</label>
                                            <div className={`relative group/btn h-[46px] border border-dashed rounded-xl px-2.5 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-2 cursor-pointer ${nurse.anualidadFile || nurse.anualidadUrl ? 'bg-amber-100/50 border-amber-300 hover:bg-amber-100' : 'bg-white/60 border-amber-200 hover:bg-white hover:border-amber-400'}`}>
                                                <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => updateNurse(index, 'anualidadFile', e.target.files?.[0] || null)} />
                                                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border transition-transform duration-300 group-hover/btn:scale-105 ${nurse.anualidadFile || nurse.anualidadUrl ? 'bg-white text-amber-500 shadow-sm border-amber-100' : 'bg-white text-amber-400 border-amber-100 group-hover/btn:text-amber-600'}`}>
                                                    {nurse.anualidadFile || nurse.anualidadUrl ? <CheckCircle2 size={14} strokeWidth={2.5}/> : <UploadCloud size={14}/>}
                                                </div>
                                                <p className="text-[10px] font-black text-amber-800 truncate transition-colors group-hover/btn:text-amber-900">
                                                    {nurse.anualidadFile ? nurse.anualidadFile.name : nurse.anualidadUrl ? "Recibo guardado" : "Subir recibo PDF..."}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Fecha Anualidad */}
                                        <div className="group/date-amber flex flex-col justify-end">
                                            <label className="text-[9px] font-black text-amber-600/80 uppercase tracking-widest ml-1 mb-1 block group-focus-within/date-amber:text-amber-700 transition-colors">Vencimiento</label>
                                            <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-xl h-[46px] bg-white/60 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(245,158,11,0.15)] flex items-center border border-amber-200 hover:border-amber-400 focus-within:border-amber-500 overflow-hidden">
                                                 <div className="w-full relative -top-0.5">
                                                    <LiquidDatePicker 
                                                        value={nurse.anualidadExp || ""} 
                                                        onChange={(val) => updateNurse(index, 'anualidadExp', val)} 
                                                        placeholder="Seleccionar..." 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    ))}
                    
                    {nursingRegents.length === 0 && (
                        <div className="py-10 text-center border-2 border-dashed border-slate-300 rounded-[2rem] bg-white/40 backdrop-blur-sm mt-4 transition-all duration-500 hover:bg-white/60 hover:-translate-y-1 hover:shadow-md cursor-pointer transform-gpu" onClick={addNurse}>
                            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-[#007AFF] mx-auto mb-3 shadow-[0_4px_12px_rgba(0,122,255,0.15)] border border-blue-100">
                                <Plus size={20} strokeWidth={2.5}/>
                            </div>
                            <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">Sin profesionales asignados</p>
                            <p className="text-[10px] font-bold text-slate-500 mt-1">Haz clic aquí o en "Añadir Profesional" para comenzar.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormNursingRegents;