import React, { useMemo, memo } from 'react';
import { User, Phone, MapPin, Building2, CreditCard, HeartPulse, GraduationCap, Camera, AlertCircle, FileText, Map as MapIcon, Navigation } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import { EL_SALVADOR_GEO } from '../../data/elSalvadorGeo';

// ============================================================================
// 🚀 CATÁLOGOS (Solo los necesarios para edición básica)
// ============================================================================
const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];
const EDUCATION_OPTIONS = [{ value: 'BACHILLERATO', label: 'Bachillerato' }, { value: 'TECNICO', label: 'Técnico Superior' }, { value: 'UNIVERSITARIO_E', label: 'Universitario (Estudiante)' }, { value: 'UNIVERSITARIO_G', label: 'Universitario (Graduado)' }, { value: 'MAESTRIA', label: 'Maestría / Postgrado' }];

const BANKS_OPTIONS = [
    { value: 'Banco Agrícola', label: 'Banco Agrícola' },
    { value: 'Banco Cuscatlán', label: 'Banco Cuscatlán' },
    { value: 'BAC Credomatic', label: 'BAC Credomatic' },
    { value: 'Banco Davivienda', label: 'Banco Davivienda' },
    { value: 'Banco Promerica', label: 'Banco Promerica' },
    { value: 'Banco Hipotecario', label: 'Banco Hipotecario' },
    { value: 'Banco de Fomento Agropecuario', label: 'Banco Fomento Agropecuario' },
    { value: 'Banco Azul', label: 'Banco Azul' },
    { value: 'Banco Industrial', label: 'Banco Industrial' },
    { value: 'Sistema Fedecrédito', label: 'Sistema Fedecrédito' },
    { value: 'Otro', label: 'Otro...' }
];

const DEPARTAMENTOS_OPTS = Object.keys(EL_SALVADOR_GEO).map(d => ({ value: d, label: d }));

// ============================================================================
// 🚀 HELPERS
// ============================================================================
const applyMask = (value, type) => {
    if (!value) return '';
    let v = value.replace(/\D/g, ''); 
    if (type === 'PHONE') {
        if (v.length > 4) return `${v.substring(0, 4)}-${v.substring(4, 8)}`;
        return v;
    }
    return v;
};

// ============================================================================
// 🚀 COMPONENTE INPUT
// ============================================================================
const PortalInput = memo(({ icon: Icon, label, name, value, onChange, type = "text", placeholder, colSpan = 1, required = false, maskType }) => {
    const handleInputChange = (e) => {
        let val = e.target.value;
        if (maskType) val = applyMask(val, maskType);
        e.target.value = val;
        onChange(e);
    };

    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50";
    const errorClasses = (required && !value?.trim()) ? '!border-red-400 !bg-red-50/50' : '';

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span>{label}</span>
                {required && !value?.trim() && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
            </label>
            <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] z-10 border-slate-200/80 ${inputHoverClass} ${errorClasses}`}>
                {Icon && <div className="absolute left-3 text-slate-400"><Icon size={14} strokeWidth={2.5} /></div>}
                <input
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    className={`w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none ${Icon ? 'pl-9 pr-4' : 'px-4'}`}
                />
            </div>
        </div>
    );
});

// ============================================================================
// 🚀 COMPONENTE PRINCIPAL
// ============================================================================
const EditEmployeeBasicModal = ({ formData, setFormData }) => {
    
    // 🚨 SEGURIDAD: Evitar submit accidental con Enter
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') e.preventDefault(); 
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name, value) => {
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
            if (name === 'department') newData.municipality = '';
            return newData;
        });
    };

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData(prev => ({ ...prev, file: file, photoPreview: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const municipioOpts = useMemo(() => {
        if (!formData?.department || !EL_SALVADOR_GEO[formData.department]) return [];
        return EL_SALVADOR_GEO[formData.department].map(m => ({ value: m, label: m }));
    }, [formData?.department]);

    // Clases UI "Liquid Glass"
    const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white/80";
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50";

    const portalSelectProps = {
        menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
        menuPosition: "fixed",
        styles: { menuPortal: base => ({ ...base, zIndex: 99999 }) }
    };

    if (!formData) return null;

    return (
        <div className="flex flex-col w-full h-full relative z-10 overflow-visible space-y-4" onKeyDown={handleKeyDown}>
            
            {/* 🚨 AVISO DEL CEREBRO DE AUDITORÍA */}
            <div className="mx-auto mb-2 bg-[#007AFF]/5 border border-[#007AFF]/20 p-3.5 rounded-2xl flex items-start gap-3 shadow-sm w-full backdrop-blur-md">
                <FileText size={18} className="text-[#007AFF] shrink-0 mt-0.5" strokeWidth={2.5} />
                <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-[#007AFF]">Actualización de Ficha</h4>
                    <p className="text-[11px] text-slate-600 font-medium leading-tight mt-0.5">Estás modificando información básica. Si necesitas cambiar <b>Salarios, Cargos o Sucursales</b>, por favor utiliza las opciones de <b>Acción de Personal</b> en el perfil del empleado.</p>
                </div>
            </div>

            {/* 1. ISLA: FOTO Y NOMBRES */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex flex-col sm:flex-row items-center gap-6 mb-6 pb-6 border-b border-slate-200/50">
                    <div className="relative group cursor-pointer shrink-0">
                        <div className="w-20 h-20 md:w-24 md:h-24 rounded-[1.5rem] border-4 border-white shadow-[0_4px_15px_rgba(0,0,0,0.08)] overflow-hidden bg-slate-100 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                            {formData.photoPreview || formData.photo_url || formData.photo ? (
                                <img src={formData.photoPreview || formData.photo_url || formData.photo} alt="Perfil" className="w-full h-full object-cover" />
                            ) : (
                                <User size={36} className="text-slate-300" strokeWidth={2} />
                            )}
                        </div>
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm rounded-[1.5rem] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <Camera size={24} className="text-white" />
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} id="photo-upload-basic" />
                        <label htmlFor="photo-upload-basic" className="absolute inset-0 cursor-pointer"></label>
                    </div>
                    <div className="text-center sm:text-left flex-1">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <PortalInput label="Nombres" name="first_names" value={formData.first_names} onChange={handleChange} required />
                            <PortalInput label="Apellidos" name="last_names" value={formData.last_names} onChange={handleChange} required />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <PortalInput label="Teléfono" name="phone" value={formData.phone} onChange={handleChange} type="tel" icon={Phone} placeholder="0000-0000" maskType="PHONE" />
                    
                    <div className="relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Estado Civil</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.marital_status} onChange={(val) => handleSelectChange('marital_status', val)} options={MARITAL_STATUS_OPTIONS} placeholder="Seleccionar..." {...portalSelectProps} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. ISLA: DIRECCIÓN Y ESTUDIOS */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-20"> 
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Departamento</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.department} onChange={(val) => handleSelectChange('department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} {...portalSelectProps} />
                        </div>
                    </div>
                    <div className="relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Municipio / Distrito</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.municipality} onChange={(val) => handleSelectChange('municipality', val)} options={municipioOpts} placeholder={formData.department ? 'Distrito...' : 'Elija Depto.'} disabled={!formData.department} icon={Navigation} {...portalSelectProps} />
                        </div>
                    </div>
                    <PortalInput label="Dirección Detallada" name="address" value={formData.address} onChange={handleChange} icon={MapPin} placeholder="Colonia, Calle, Número de Casa..." colSpan={2} />
                    
                    <div className="relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nivel Académico</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.education_level} onChange={(val) => handleSelectChange('education_level', val)} options={EDUCATION_OPTIONS} placeholder="Nivel..." icon={GraduationCap} {...portalSelectProps} />
                        </div>
                    </div>
                    <PortalInput label="Profesión / Título" name="profession" value={formData.profession} onChange={handleChange} icon={GraduationCap} placeholder="Ej. Lic. en Farmacia" />
                </div>
            </div>

            {/* 3. ISLA: BANCO (PLANILLA) */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-[0.8rem] border border-emerald-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <CreditCard size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Depósito de Planilla</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Banco</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.bank_name} onChange={(val) => handleSelectChange('bank_name', val)} options={BANKS_OPTIONS} placeholder="Seleccionar Banco..." icon={Building2} {...portalSelectProps} />
                        </div>
                    </div>
                    <PortalInput label="Número de Cuenta" name="account_number" value={formData.account_number} onChange={handleChange} icon={CreditCard} placeholder="0000-0000-00" />
                </div>
            </div>

            {/* 4. ISLA: SALUD Y EMERGENCIA */}
            <div className={`bg-red-50/50 rounded-[1.5rem] p-4 md:p-5 border border-red-100/50 shadow-[0_8px_30px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md`}>
                <h4 className="text-[12px] font-black uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2"><HeartPulse size={16} strokeWidth={2.5} /> Ficha Médica y Emergencia</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="col-span-1 relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 block">Tipo de Sangre</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect value={formData.blood_type} onChange={(val) => handleSelectChange('blood_type', val)} options={BLOOD_TYPE_OPTIONS} placeholder="Vital..." {...portalSelectProps} />
                        </div>
                    </div>
                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <PortalInput label="Avisar a (Nombre)" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} placeholder="Familiar o Pareja" />
                        <PortalInput label="Teléfono de Emergencia" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} placeholder="0000-0000" maskType="PHONE" />
                    </div>
                </div>
            </div>
            
        </div>
    );
};

export default EditEmployeeBasicModal;