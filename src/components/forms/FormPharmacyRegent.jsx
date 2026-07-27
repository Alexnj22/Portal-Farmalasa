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
            <div className="bg-danger/10 backdrop-blur-xl border border-danger/30 p-8 rounded-[2rem] flex flex-col items-center text-center shadow-[var(--shadow-glow-danger)] animate-in fade-in slide-in-from-bottom-4 duration-500 m-2">
                <div className="w-16 h-16 bg-surface-card rounded-[1.5rem] shadow-sm border border-danger/30 flex items-center justify-center text-danger mb-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-danger/10 animate-pulse"></div>
                    <AlertCircle size={28} strokeWidth={2} className="relative z-10" />
                </div>
                <h3 className="text-body-xl font-black text-danger-text mb-2 tracking-tight">Ningún Profesional Disponible</h3>
                <p className="text-body-sm font-bold text-danger-text/80 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Regente Farmacéutico en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <button 
                    type="button" 
                    onClick={onClose} 
                    className="px-8 py-3.5 bg-surface-card text-danger font-black text-label uppercase tracking-widest rounded-2xl hover:bg-danger-solid hover:text-white border border-danger/30 hover:border-danger transition-all duration-300 shadow-sm hover:shadow-[var(--shadow-glow-danger)] hover:-translate-y-0.5 active:scale-[0.97]"
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
            <div className="bg-surface-card backdrop-blur-xl border border-border-card p-6 md:p-8 rounded-[2rem] shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-glow-brand)] hover:-translate-y-1 hover:bg-surface-card transition-all duration-500 transform-gpu space-y-6">
                
                {/* CABECERA DE LA TARJETA */}
                <div className="flex items-center gap-3 mb-2 border-b border-border-card pb-4">
                    <div className="w-10 h-10 rounded-xl bg-chart-1/10 text-brand-text border border-chart-1/30 flex items-center justify-center shadow-sm">
                        <Award size={20} strokeWidth={2.5}/>
                    </div>
                    <div>
                        <h4 className="text-body font-black uppercase tracking-widest text-content leading-none mb-1">
                            Regencia Farmacéutica
                        </h4>
                        <p className="text-caption font-bold text-content-3 uppercase tracking-widest">
                            Asignación y Credenciales JVQF
                        </p>
                    </div>
                </div>

                {/* FILA 1: SELECT (AHORA OCUPA TODO EL ANCHO PARA NO CORTAR NOMBRES) */}
                <div className="group/select">
                    <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-brand-text transition-colors">
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
                        <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/date:text-brand-text transition-colors">
                            Vencimiento Credencial JVQF
                        </label>
                        <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-2xl h-[50px] bg-surface-card focus-within:bg-surface-card focus-within:shadow-[var(--shadow-ring-brand)] flex items-center border border-divider hover:border-brand/40 focus-within:border-brand overflow-hidden">
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
                        <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block">
                            Credencial JVQF (PDF/IMG)
                        </label>
                        <div className={`relative group border border-dashed rounded-2xl h-[50px] px-3 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-3 cursor-pointer overflow-hidden ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'bg-chart-1/10 border-chart-1/40 hover:bg-chart-1/10' : 'bg-surface-card-hover/50 border-divider hover:bg-surface-card-hover hover:border-brand/50'}`}>
                            <input 
                                type="file" 
                                accept="application/pdf,image/*" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                                onChange={(e) => updateLegalField('regentCredentialFile', e.target.files?.[0] || null)} 
                            />
                            
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-105 ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'bg-surface-card text-brand-text border border-chart-1/30' : 'bg-surface-card text-content-3 border border-divider group-hover:text-brand-text group-hover:border-chart-1/30'}`}>
                                 {legalData.regentCredentialFile || legalData.regentCredentialUrl ? <ShieldCheck size={16} strokeWidth={2}/> : <UploadCloud size={16} strokeWidth={2} />}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <p className={`text-label font-black tracking-tight truncate ${legalData.regentCredentialFile || legalData.regentCredentialUrl ? 'text-brand-text' : 'text-content-2'}`}>
                                    {legalData.regentCredentialFile ? legalData.regentCredentialFile.name : legalData.regentCredentialUrl ? "Credencial guardada" : "Subir documento..."}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FILA 3: UPLOAD INSCRIPCIÓN (OCUPA TODO EL ANCHO PARA DESTACAR) */}
                <div className="pt-4 border-t border-divider mt-4">
                    <label className="text-caption font-black text-chart-3-text/80 uppercase tracking-widest ml-1 mb-2 block">
                        Inscripción de Regencia (PDF)
                    </label>
                    <div className={`relative group border-2 border-dashed rounded-[1.5rem] p-4 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-4 cursor-pointer overflow-hidden ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'bg-chart-3/10 border-chart-3/50 hover:bg-chart-3/10' : 'bg-surface-card-hover/50 border-divider hover:bg-chart-3/10 hover:border-chart-3/40'}`}>
                        <input 
                            type="file" 
                            accept=".pdf,image/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                            onChange={(e) => updateLegalField('regentInscriptionFile', e.target.files?.[0] || null)} 
                        />
                        
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-105 ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'bg-surface-card text-chart-3-text border border-chart-3/30' : 'bg-surface-card text-content-3 border border-divider group-hover:text-chart-3-text group-hover:border-chart-3/30'}`}>
                             {legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? <ShieldCheck size={20} strokeWidth={2}/> : <UploadCloud size={20} strokeWidth={1.5} />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <p className={`text-body-sm font-black tracking-tight truncate ${legalData.regentInscriptionFile || legalData.regentInscriptionUrl ? 'text-chart-3-text' : 'text-content-2'}`}>
                                {legalData.regentInscriptionFile ? legalData.regentInscriptionFile.name : legalData.regentInscriptionUrl ? "Inscripción guardada" : "Toca para subir documento"}
                            </p>
                            <p className="text-micro font-bold text-content-2 uppercase tracking-widest mt-0.5">
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