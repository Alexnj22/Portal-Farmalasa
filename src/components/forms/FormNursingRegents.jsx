import React, { useMemo } from 'react';
import { EmptyState } from '../common/StateViews';
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
            <div className="bg-surface-card backdrop-blur-xl border border-border-card p-6 rounded-modal shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-md)] hover:-translate-y-1 hover:bg-surface-card transition-all duration-500 transform-gpu space-y-5">
                <div className="flex items-center gap-2 mb-2">
                    <Award size={16} className="text-brand-text" strokeWidth={2.5}/>
                    <h4 className="text-label font-black uppercase tracking-widest text-content">
                        Permiso de Servicios de Enfermería
                    </h4>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="group/input">
                        <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/input:text-brand-text transition-colors">
                            N° Permiso / Licencia
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl">
                            <input 
                                type="text" 
                                className="w-full px-5 py-3.5 h-[50px] rounded-2xl bg-surface-card border border-divider outline-none focus:border-brand focus:bg-surface-card focus:shadow-[var(--shadow-ring-brand)] hover:border-brand/40 hover:bg-surface-card-hover transition-all text-body-xl font-bold text-content shadow-sm placeholder:text-content-3 placeholder:font-medium" 
                                placeholder="Ej: ENF-2026-001"
                                value={legalData.nursingServicePermit || ""} 
                                onChange={(e) => updateLegalField('nursingServicePermit', e.target.value)} 
                            />
                        </div>
                    </div>
                    
                    <div className="group/date flex flex-col justify-end">
                        <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/date:text-brand-text transition-colors">
                            Vencimiento Permiso
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl h-[50px] bg-surface-card focus-within:bg-surface-card focus-within:shadow-[var(--shadow-ring-brand)] flex items-center border border-divider hover:border-brand/40 focus-within:border-brand overflow-hidden">
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
                    <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-2 block">
                        Permiso Físico (PDF/IMG)
                    </label>
                    <div className={`relative group border-2 border-dashed rounded-3xl p-4 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-4 cursor-pointer overflow-hidden ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'bg-chart-1/10 border-chart-1/40 hover:bg-chart-1/10' : 'bg-surface-card-hover/50 border-divider hover:bg-brand/5 hover:border-brand/50'}`}>
                        <input type="file" accept="application/pdf,image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-base" onChange={(e) => updateLegalField('nursingServicePermitFile', e.target.files?.[0] || null)} />
                        
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-all duration-300 group-hover:scale-105 ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'bg-surface-card text-brand-text border border-chart-1/30' : 'bg-surface-card text-content-3 group-hover:text-brand-text'}`}>
                             {legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? <ShieldCheck size={20} strokeWidth={2}/> : <UploadCloud size={20} strokeWidth={1.5} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-body-sm font-black tracking-tight truncate ${legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'text-brand-text' : 'text-content-2'}`}>
                                {legalData.nursingServicePermitFile ? legalData.nursingServicePermitFile.name : legalData.nursingServicePermitUrl ? "Archivo adjunto guardado" : "Toca para subir documento"}
                            </p>
                            <p className="text-micro font-bold text-content-2 uppercase tracking-widest mt-0.5">
                                {legalData.nursingServicePermitFile || legalData.nursingServicePermitUrl ? 'Reemplazar archivo' : 'PDF, JPG o PNG (Máx 5MB)'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 📝 ARREGLO DE ENFERMEROS (CONTENEDOR GLOBAL) */}
            <div>
                <div className="flex items-center justify-between mb-4 px-2 mt-8">
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content flex items-center gap-2">
                        <Users size={16} className="text-brand-text"/> Profesionales Asignados
                    </h4>
                    <button type="button" onClick={addNurse} className="text-caption font-black bg-surface-card border border-brand/20 text-brand-text hover:bg-brand hover:text-white px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all duration-300 active:scale-[0.97] uppercase tracking-widest shadow-sm hover:shadow-[var(--shadow-glow-brand)] hover:-translate-y-0.5">
                        <Plus size={14} strokeWidth={2.5}/> Añadir Profesional
                    </button>
                </div>
                
                <div className="space-y-6">
                    {nursingRegents.map((nurse, index) => (
                        /* TARJETA PADRE 2 (DINÁMICA) */
                        <div key={nurse.id || index} className="bg-surface-card backdrop-blur-xl border border-border-card p-5 md:p-6 rounded-modal relative group shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-md)] hover:-translate-y-1 hover:bg-surface-card transition-all duration-500 transform-gpu">
                            
                            <button type="button" onClick={() => removeNurse(index)} className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center bg-white border border-danger/30 text-danger rounded-full shadow-sm hover:bg-danger-solid hover:text-white hover:border-danger transition-all duration-300 opacity-0 group-hover:opacity-100 focus-within:opacity-100 z-content active:scale-[0.97] hover:scale-110">
                                <Trash2 size={14} strokeWidth={2.5}/>
                            </button>
                            
                            <div className="space-y-5">
                                {/* SELECT DEL EMPLEADO */}
                                <div className="group/select">
                                    <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-brand-text transition-colors">
                                        Empleado en Planilla
                                    </label>
                                    <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-3xl">
                                        <LiquidSelect 
                                            value={nurse.employeeId} 
                                            onChange={(val) => updateNurse(index, 'employeeId', val)} 
                                            options={nurseOptions} 
                                            placeholder="Seleccionar..."
                                            icon={Users}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-divider pt-5">
                                    {/* Upload Carnet */}
                                    <div className="space-y-1.5">
                                        <label className="text-micro font-black text-content-3 uppercase tracking-widest ml-1 block">Carné JVQE (PDF/IMG)</label>
                                        <div className={`relative group/btn border-2 border-dashed rounded-2xl p-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer ${nurse.carneFile || nurse.carneUrl ? 'bg-chart-1/10 border-chart-1/30 hover:bg-chart-1/10' : 'bg-surface-card-hover/50 border-divider hover:bg-brand/5 hover:border-brand/40'}`}>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-base" onChange={(e) => updateNurse(index, 'carneFile', e.target.files?.[0] || null)} />
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 group-hover/btn:scale-105 ${nurse.carneFile || nurse.carneUrl ? 'bg-surface-card text-brand-text shadow-sm border-chart-1/30' : 'bg-surface-card text-content-3 border-divider group-hover/btn:text-brand-text'}`}>
                                                {nurse.carneFile || nurse.carneUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16}/>}
                                            </div>
                                            <p className="text-caption font-black text-content-2 truncate transition-colors group-hover/btn:text-brand-text">
                                                {nurse.carneFile ? nurse.carneFile.name : nurse.carneUrl ? "Archivo guardado" : "Subir carné..."}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Upload Licencia */}
                                    <div className="space-y-1.5">
                                        <label className="text-micro font-black text-content-3 uppercase tracking-widest ml-1 block">Licencia Regencia (PDF)</label>
                                        <div className={`relative group/btn border-2 border-dashed rounded-2xl p-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer ${nurse.licenciaFile || nurse.licenciaUrl ? 'bg-chart-1/10 border-chart-1/30 hover:bg-chart-1/10' : 'bg-surface-card-hover/50 border-divider hover:bg-brand/5 hover:border-brand/40'}`}>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-base" onChange={(e) => updateNurse(index, 'licenciaFile', e.target.files?.[0] || null)} />
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 group-hover/btn:scale-105 ${nurse.licenciaFile || nurse.licenciaUrl ? 'bg-surface-card text-brand-text shadow-sm border-chart-1/30' : 'bg-surface-card text-content-3 border-divider group-hover/btn:text-brand-text'}`}>
                                                {nurse.licenciaFile || nurse.licenciaUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16}/>}
                                            </div>
                                            <p className="text-caption font-black text-content-2 truncate transition-colors group-hover/btn:text-brand-text">
                                                {nurse.licenciaFile ? nurse.licenciaFile.name : nurse.licenciaUrl ? "Archivo guardado" : "Subir licencia..."}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* ZONA DE ANUALIDAD */}
                                <div className="bg-gradient-to-br from-warning/10 to-warning/20 p-4 rounded-2xl border border-warning/30 shadow-inner mt-2 transition-all duration-500 hover:shadow-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Receipt size={14} className="text-warning" strokeWidth={2.5}/>
                                        <h5 className="text-caption font-black uppercase tracking-widest text-warning-text">Control de Anualidad</h5>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        {/* Upload Anualidad */}
                                        <div className="flex flex-col justify-end">
                                            <label className="text-micro font-black text-warning/80 uppercase tracking-widest ml-1 mb-1 block">Recibo de Pago</label>
                                            <div className={`relative group/btn h-[46px] border border-dashed rounded-xl px-2.5 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-2 cursor-pointer ${nurse.anualidadFile || nurse.anualidadUrl ? 'bg-warning/10 border-warning/40 hover:bg-warning/10' : 'bg-surface-card border-warning/30 hover:bg-surface-card-hover hover:border-warning'}`}>
                                                <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer z-base" onChange={(e) => updateNurse(index, 'anualidadFile', e.target.files?.[0] || null)} />
                                                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border transition-transform duration-300 group-hover/btn:scale-105 ${nurse.anualidadFile || nurse.anualidadUrl ? 'bg-surface-card text-warning shadow-sm border-warning/30' : 'bg-surface-card text-warning border-warning/30 group-hover/btn:text-warning'}`}>
                                                    {nurse.anualidadFile || nurse.anualidadUrl ? <CheckCircle2 size={14} strokeWidth={2.5}/> : <UploadCloud size={14}/>}
                                                </div>
                                                <p className="text-caption font-black text-warning-text truncate transition-colors group-hover/btn:text-warning-text">
                                                    {nurse.anualidadFile ? nurse.anualidadFile.name : nurse.anualidadUrl ? "Recibo guardado" : "Subir recibo PDF..."}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Fecha Anualidad */}
                                        <div className="group/date-amber flex flex-col justify-end">
                                            <label className="text-micro font-black text-warning/80 uppercase tracking-widest ml-1 mb-1 block group-focus-within/date-amber:text-warning-text transition-colors">Vencimiento</label>
                                            <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-xl h-[46px] bg-surface-card focus-within:bg-surface-card focus-within:shadow-[var(--shadow-glow-warning-sm)] flex items-center border border-warning/30 hover:border-warning focus-within:border-warning overflow-hidden">
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
                        <div onClick={addNurse} className="cursor-pointer border-2 border-dashed border-divider rounded-modal transition-all duration-500 hover:-translate-y-1 hover:shadow-md mt-4">
                            <EmptyState compact icon={Plus} title="Sin profesionales asignados"
                                subtitle="Hacé clic aquí o en Añadir Profesional para comenzar." />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormNursingRegents;