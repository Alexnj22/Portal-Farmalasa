import React, { useMemo } from 'react';
import Button from '../common/Button';
import { UploadCloud, Users, ShieldCheck, AlertCircle, Award } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';
import FileField from '../common/FileField';

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
            <div className="bg-danger/10 border border-danger/30 p-8 rounded-modal flex flex-col items-center text-center shadow-[var(--shadow-glow-danger)] animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)] m-2">
                <div className="w-16 h-16 bg-surface-card rounded-3xl shadow-sm border border-danger/30 flex items-center justify-center text-danger mb-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-danger/10 animate-pulse"></div>
                    <AlertCircle size={28} strokeWidth={2} className="relative z-base" />
                </div>
                <h3 className="text-body-xl font-black text-danger-text mb-2 tracking-tight">Ningún Profesional Disponible</h3>
                <p className="text-body-sm font-bold text-danger-text/80 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Regente Farmacéutico en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <Button variant="destructive" onClick={onClose}>Entendido, Cerrar</Button>
            </div>
        );
    }

    // ==========================================
    // FORMULARIO PRINCIPAL
    // ==========================================
    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)] pb-2 pt-2">
            
            {/* TARJETA CONTENEDOR PADRE (Efecto Hover Liquid Glass aplicado) */}
            <div data-surface="card" className="p-6 md:p-8 hover:bg-surface-card transition-all duration-[var(--dur-lento)] transform-gpu space-y-6">
                
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
                    <div className="transition-all duration-[var(--dur-slow)] transform-gpu hover:translate-y-[var(--lift-card)] hover:shadow-md rounded-3xl">
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
                        <div className="transition-all duration-[var(--dur-slow)] transform-gpu hover:translate-y-[var(--lift-card)] hover:shadow-md rounded-2xl h-[50px] bg-surface-card focus-within:bg-surface-card focus-within:shadow-[var(--shadow-ring-brand)] flex items-center border border-divider hover:border-brand/40 focus-within:border-brand overflow-hidden">
                             <div className="w-full relative -top-0.5">
                                <LiquidDatePicker 
                                    value={legalData.regentCredentialExp || ""} 
                                    onChange={(val) => updateLegalField('regentCredentialExp', val)} 
                                    placeholder="Seleccionar..." 
                                />
                            </div>
                        </div>
                    </div>

                    {/* Credencial — canónico `FileField` (2c, 2026-07-27).
                        `density="sm"` reemplaza el `h-[50px]` fijo que tenía. */}
                    <div className="flex flex-col justify-end">
                        <FileField
                            label="Credencial JVQF (PDF/IMG)"
                            accept="application/pdf,image/*"
                            density="sm"
                            file={legalData.regentCredentialFile}
                            url={legalData.regentCredentialUrl}
                            onChange={f => updateLegalField('regentCredentialFile', f)}
                        />
                    </div>
                </div>

                {/* Inscripción de Regencia — canónico `FileField` (2c). */}
                <div className="pt-4 border-t border-divider mt-4">
                    <FileField
                        label="Inscripción de Regencia (PDF)"
                        accept=".pdf,image/*"
                        file={legalData.regentInscriptionFile}
                        url={legalData.regentInscriptionUrl}
                        onChange={f => updateLegalField('regentInscriptionFile', f)}
                        hint="Solo formato PDF"
                    />
                </div>

            </div>
        </div>
    );
};

export default FormPharmacyRegent;