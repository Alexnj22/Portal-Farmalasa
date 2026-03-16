import React, { useMemo } from 'react';
import { UploadCloud, Users, ShieldCheck, AlertCircle, Award } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';

const FormPharmacyRegent = ({ formData, setFormData, onClose }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};

    const possibleRegents = useMemo(() => {
        return employees.filter(emp => {
            const role = (emp.role || '').toUpperCase();
            return role.includes('REGENTE') && !role.includes('ENFERMER');
        });
    }, [employees]);

    // Opciones formateadas para LiquidSelect
    const regentOptions = useMemo(() => {
        return possibleRegents.map(emp => ({
            value: emp.id,
            label: `${emp.name} ${emp.branchId && String(emp.branchId) !== String(formData.id) ? '(En otra sede)' : ''}`
        }));
    }, [possibleRegents, formData.id]);

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: {
                ...(formData.settings || {}),
                legal: { ...legalData, [field]: value }
            }
        });
    };

    // ==========================================
    // ESTADO VACÍO (SIN REGENTES)
    // ==========================================
    if (possibleRegents.length === 0) {
        return (
            <div className="bg-red-50/80 backdrop-blur-xl border border-red-200/80 p-8 rounded-[2rem] flex flex-col items-center text-center shadow-[0_8px_30px_rgba(239,68,68,0.12)] animate-in fade-in slide-in-from-bottom-4 duration-500 m-2">
                <div className="w-16 h-16 bg-white rounded-[1.5rem] shadow-sm border border-red-100 flex items-center justify-center text-red-500 mb-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-red-400/10 animate-pulse"></div>
                    <AlertCircle size={28} strokeWidth={2} className="relative z-10" />
                </div>
                <h3 className="text-[16px] font-black text-red-900 mb-2 tracking-tight">Ningún Profesional Disponible</h3>
                <p className="text-[12px] font-bold text-red-700/80 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Regente Farmacéutico en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <button 
                    type="button" 
                    onClick={onClose} 
                    className="px-8 py-3.5 bg-white text-red-600 font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 transition-all duration-300 shadow-sm hover:shadow-[0_8px_20px_rgba(239,68,68,0.3)] hover:-translate-y-0.5 active:scale-95"
                >
                    Entendido, Cerrar
                </button>
            </div>
        );
    }

    // ==========================================
    // FORMULARIO PRINCIPAL
    // ==========================================
    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2 pt-2">
            
            {/* TARJETA CONTENEDOR PADRE (Efecto Hover Liquid Glass aplicado) */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/80 p-6 md:p-8 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,122,255,0.08)] hover:-translate-y-1 hover:bg-white/60 transition-all duration-500 transform-gpu space-y-6">
                
                {/* CABECERA DE LA TARJETA */}
                <div className="flex items-center gap-3 mb-2 border-b border-white/60 pb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#007AFF] border border-blue-100 flex items-center justify-center shadow-sm">
                        <Award size={20} strokeWidth={2.5}/>
                    </div>
                    <div>
                        <h4 className="text-[13px] font-black uppercase tracking-widest text-slate-800 leading-none mb-1">
                            Regencia Farmacéutica
                        </h4>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Asignación y Credenciales JVQF
                        </p>
                    </div>
                </div>

                {/* FILA 1: SELECT (AHORA OCUPA TODO EL ANCHO PARA NO CORTAR NOMBRES) */}
                <div className="group/select">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-[#007AFF] transition-colors">
                        Regente Asignado
                    </label>
                    <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-[1.5rem]">
                        <LiquidSelect 
                            value={legalData.regentEmployeeId || ""} 
                            onChange={(val) => updateLegalField('regentEmployeeId', val)} 
                            options={regentOptions} 
                            placeholder="Seleccionar regente..."
                            icon={Users}
                        />
                    </div>
                </div>

                {/* FILA 2: FECHA Y CREDENCIAL (AMBOS ALINEADOS A 50PX DE ALTURA) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
                    
                    {/* FECHA VENCIMIENTO CREDENCIAL */}
                    <div className="group/date flex flex-col justify-end">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/date:text-[#007AFF] transition-colors">
                            Vencimiento Credencial JVQF
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl h-[50px] bg-white/60 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] flex items-center border border-slate-200/80 hover:border-[#007AFF]/40 focus-within:border-[#007AFF] overflow-hidden">
                             <div className="w-full relative -top-0.5">
                                <LiquidDatePicker 
                                    value={legalData.regentCredentialExp || ""} 
                                    onChange={(val) => updateLegalField('regentCredentialExp', val)} 
                                    placeholder="Seleccionar..." 
                                />
                            </div>
                        </div>
                    </div>

                    {/* UPLOAD CREDENCIAL (CAJA COMPACTA H-[50px]) */}
                    <div className="flex flex-col justify-end">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block">
                            Credencial JVQF (PDF/IMG)
                        </label>
                        <div className={`relative group border border-dashed rounded-2xl h-[50px] px-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer overflow-hidden ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'bg-blue-50/50 border-blue-300 hover:bg-blue-50/80' : 'bg-slate-50/50 border-slate-300 hover:bg-white hover:border-[#007AFF]/50'}`}>
                            <input 
                                type="file" 
                                accept="application/pdf,image/*" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                                onChange={(e) => updateLegalField('regentCredentialFile', e.target.files?.[0] || null)} 
                            />
                            
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-105 ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'bg-white text-[#007AFF] border border-blue-200' : 'bg-white text-slate-400 border border-slate-100 group-hover:text-[#007AFF] group-hover:border-blue-200'}`}>
                                 {legalData.regentCredentialFile || legalData.regentCredentialUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16} strokeWidth={2} />}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <p className={`text-[11px] font-black tracking-tight truncate ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'text-[#007AFF]' : 'text-slate-600'}`}>
                                    {legalData.regentCredentialFile ? legalData.regentCredentialFile.name : legalData.regentCredentialUrl ? "Credencial guardada" : "Subir documento..."}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FILA 3: UPLOAD INSCRIPCIÓN (OCUPA TODO EL ANCHO PARA DESTACAR) */}
                <div className="pt-4 border-t border-slate-100/60 mt-4">
                    <label className="text-[10px] font-black text-purple-600/80 uppercase tracking-widest ml-1 mb-2 block">
                        Inscripción de Regencia (PDF)
                    </label>
                    <div className={`relative group border-2 border-dashed rounded-[1.5rem] p-4 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-4 cursor-pointer overflow-hidden ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'bg-purple-50/50 border-purple-300 hover:bg-purple-50/80' : 'bg-slate-50/50 border-slate-300 hover:bg-purple-50/30 hover:border-purple-300/60'}`}>
                        <input 
                            type="file" 
                            accept=".pdf,image/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                            onChange={(e) => updateLegalField('regentInscriptionFile', e.target.files?.[0] || null)} 
                        />
                        
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-105 ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'bg-white text-purple-600 border border-purple-200' : 'bg-white text-slate-400 border border-slate-100 group-hover:text-purple-500 group-hover:border-purple-200'}`}>
                             {legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? <ShieldCheck size={20} strokeWidth={2}/> : <UploadCloud size={20} strokeWidth={1.5} />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-black tracking-tight truncate ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'text-purple-700' : 'text-slate-600'}`}>
                                {legalData.regentInscriptionFile ? legalData.regentInscriptionFile.name : legalData.regentInscriptionUrl ? "Inscripción guardada" : "Toca para subir documento"}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                {legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'Reemplazar archivo' : 'Solo formato PDF'}
                            </p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default FormPharmacyRegent;