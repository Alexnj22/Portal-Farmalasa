import React, { useMemo } from 'react';
import Button from '../common/Button';
import { EmptyState } from '../common/StateViews';
import { Plus, Trash2, UploadCloud, ShieldCheck, Users, Award, Receipt, CheckCircle2 } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';
import FileField from '../common/FileField';
import PortalInput from '../common/PortalInput';

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
            <div data-surface="card" className="p-6 hover:bg-surface-card transition-all duration-500 transform-gpu space-y-5">
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
                            <PortalInput
                                aria-label="N° de permiso del servicio de enfermería"
                                type="text"
                                value={legalData.nursingServicePermit || ""}
                                onChange={(e) => updateLegalField('nursingServicePermit', e.target.value)}
                                placeholder="Ej: ENF-2026-001"
                                tono="brand"
                                inputClassName="text-body-xl font-bold text-content"
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

                {/* Permiso Físico — canónico `FileField` (2c, 2026-07-27). */}
                <FileField
                    label="Permiso Físico (PDF/IMG)"
                    accept="application/pdf,image/*"
                    maxSizeMB={5}
                    file={legalData.nursingServicePermitFile}
                    url={legalData.nursingServicePermitUrl}
                    onChange={f => updateLegalField('nursingServicePermitFile', f)}
                />
            </div>

            {/* 📝 ARREGLO DE ENFERMEROS (CONTENEDOR GLOBAL) */}
            <div>
                <div className="flex items-center justify-between mb-4 px-2 mt-8">
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content flex items-center gap-2">
                        <Users size={16} className="text-brand-text"/> Profesionales Asignados
                    </h4>
                    <Button icon={Plus} onClick={addNurse}>Añadir Profesional</Button>
                </div>
                
                <div className="space-y-6">
                    {nursingRegents.map((nurse, index) => (
                        /* TARJETA PADRE 2 (DINÁMICA) */
                        <div key={nurse.id || index} data-surface="card" className="p-5 md:p-6 relative group hover:bg-surface-card transition-all duration-500 transform-gpu">
                            
                            <Button variant="destructive" size="sm" icon={Trash2} iconOnly onClick={() => removeNurse(index)} />
                            
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
                                    <FileField
                                        label="Carné JVQE (PDF/IMG)"
                                        accept=".pdf,image/*"
                                        density="sm"
                                        file={nurse.carneFile}
                                        url={nurse.carneUrl}
                                        onChange={f => updateNurse(nurse.id, 'carneFile', f)}
                                    />

                                    <FileField
                                        label="Licencia Regencia (PDF)"
                                        accept=".pdf,image/*"
                                        density="sm"
                                        file={nurse.licenciaFile}
                                        url={nurse.licenciaUrl}
                                        onChange={f => updateNurse(nurse.id, 'licenciaFile', f)}
                                    />
                                </div>

                                {/* ZONA DE ANUALIDAD */}
                                <div className="bg-gradient-to-br from-warning/10 to-warning/20 p-4 rounded-2xl border border-warning/30 shadow-inner mt-2 transition-all duration-500 hover:shadow-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Receipt size={14} className="text-warning" strokeWidth={2.5}/>
                                        <h5 className="text-caption font-black uppercase tracking-widest text-warning-text">Control de Anualidad</h5>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        
                                        <div className="flex flex-col justify-end">
                                            <FileField
                                                label="Recibo de Pago"
                                                accept=".pdf,image/*"
                                                density="sm"
                                                emptyState="pending"
                                                file={nurse.anualidadFile}
                                                url={nurse.anualidadUrl}
                                                onChange={f => updateNurse(nurse.id, 'anualidadFile', f)}
                                            />
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