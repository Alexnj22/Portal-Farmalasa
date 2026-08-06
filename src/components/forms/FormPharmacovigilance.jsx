import React, { useMemo } from 'react';
import Button from '../common/Button';
import { Users, ShieldCheck, FileText, AlertCircle } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidSelect from '../common/LiquidSelect';
import FileField from '../common/FileField';

const FormPharmacovigilance = ({ formData, setFormData, onClose }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};

    const possibleReferents = useMemo(() => {
        return employees.filter(emp => (emp.role || '').toUpperCase().includes('REFERENTE'));
    }, [employees]);

    // Convertimos a formato para LiquidSelect
    const referentOptions = useMemo(() => {
        return possibleReferents.map(emp => ({
            value: emp.id,
            label: `${emp.name} ${emp.branchId && String(emp.branchId) !== String(formData.id) ? '(En otra sede)' : ''}`
        }));
    }, [possibleReferents, formData.id]);

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
    // ESTADO VACÍO (SIN REFERENTES)
    // ==========================================
    if (possibleReferents.length === 0) {
        return (
            <div className="bg-warning/10 border border-warning/30 p-8 rounded-modal flex flex-col items-center text-center shadow-[var(--shadow-glow-warning)] animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)] m-2">
                <div className="w-16 h-16 bg-surface-card rounded-3xl shadow-sm border border-warning/30 flex items-center justify-center text-warning mb-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-warning/10 animate-pulse"></div>
                    <AlertCircle size={28} strokeWidth={2} className="relative z-base" />
                </div>
                <h3 className="text-body-xl font-black text-warning-text mb-2 tracking-tight">Ningún Referente Disponible</h3>
                <p className="text-body-sm font-bold text-warning-text/80 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Referente de Farmacovigilancia en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <Button tone="warning" onClick={onClose}>Entendido, Cerrar</Button>
            </div>
        );
    }

    // ==========================================
    // FORMULARIO PRINCIPAL
    // ==========================================
    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)] pb-2 pt-2">
            
            {/* TARJETA CONTENEDOR PADRE */}
            <div data-surface="card" className="p-6 md:p-8 hover:bg-surface-card transition-all duration-[var(--dur-lento)] transform-gpu space-y-6">
                
                {/* CABECERA DE LA TARJETA */}
                <div className="flex items-center gap-3 mb-2 border-b border-border-card pb-4">
                    <div className="w-10 h-10 rounded-xl bg-chart-3/10 text-chart-3-text border border-chart-3/20 flex items-center justify-center shadow-sm">
                        <ShieldCheck size={20} strokeWidth={2.5}/>
                    </div>
                    <div>
                        <h4 className="text-body font-black uppercase tracking-widest text-content leading-none mb-1">
                            Control de Farmacovigilancia
                        </h4>
                        <p className="text-caption font-bold text-content-3 uppercase tracking-widest">
                            Asignación y Autorización SRS
                        </p>
                    </div>
                </div>

                {/* SELECT DEL REFERENTE */}
                <div className="group/select">
                    <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-chart-3-text transition-colors">
                        Referente Técnico Asignado
                    </label>
                    <div className="transition-all duration-[var(--dur-slow)] transform-gpu hover:translate-y-[var(--lift-card)] hover:shadow-md rounded-3xl">
                        <LiquidSelect 
                            value={legalData.farmacovigilanciaId || ""} 
                            onChange={(val) => updateLegalField('farmacovigilanciaId', val)} 
                            options={referentOptions} 
                            placeholder="Seleccionar referente..."
                            icon={Users}
                        />
                    </div>
                    
                    {/* NOTA INFORMATIVA */}
                    <div className="mt-3 flex items-start gap-2.5 bg-chart-3/10 p-3.5 rounded-2xl border border-chart-3/20 shadow-[var(--shadow-shine)]">
                         <FileText size={14} className="text-chart-3-text shrink-0 mt-0.5" strokeWidth={2.5}/>
                         <p className="text-caption text-chart-3-text font-bold leading-relaxed">
                            El referente elabora y envía los reportes semestrales a la Dirección General de Medicamentos.
                         </p>
                    </div>
                </div>

                {/* Migrado al canónico `FileField` (2c, 2026-07-27). Nota: el
                    texto decía "Máx 5MB" y el código rechazaba a los 10 MB —
                    ahora el límite es una sola prop y el aviso se deriva de
                    ella, así que no pueden volver a desincronizarse. */}
                <FileField
                    label="Autorización de la SRS (PDF/IMG)"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    maxSizeMB={10}
                    file={legalData.farmacovigilanciaAuthFile}
                    url={legalData.farmacovigilanciaAuthUrl}
                    onChange={f => updateLegalField('farmacovigilanciaAuthFile', f)}
                />

            </div>

        </div>
    );
};

export default FormPharmacovigilance;