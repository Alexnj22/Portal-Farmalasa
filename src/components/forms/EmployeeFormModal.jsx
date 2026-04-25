import React, { useState, useEffect, useMemo, memo } from 'react';
import { User, Briefcase, CreditCard, ShieldCheck, Phone, MapPin, Hash, Building2, Fingerprint, Lock, RefreshCw, AtSign, HeartPulse, Clock, DollarSign, GraduationCap, Camera, AlertCircle, RotateCcw, Trash2, Map as MapIcon, Navigation, AlertTriangle, CheckCircle2 } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect'; 
import LiquidDatePicker from '../common/LiquidDatePicker'; 
import { EL_SALVADOR_GEO } from '../../data/elSalvadorGeo'; 
import { useStaffStore } from '../../store/staffStore';

// ============================================================================
// 🚀 CATÁLOGOS Y CONSTANTES
// ============================================================================
const GENDER_OPTIONS = [{ value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }];
const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];
const CONTRACT_TYPE_OPTIONS = [{ value: 'INDEFINIDO', label: 'Indefinido (Fijo)' }, { value: 'TEMPORAL', label: 'Temporal / Plazo Fijo' }, { value: 'MEDIO_TIEMPO', label: 'Medio Tiempo (Part-Time)' }, { value: 'SERVICIOS', label: 'Servicios Profesionales' }];
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
// 🚀 HELPERS & VALIDACIONES
// ============================================================================
const generateHashCorto = async (valor) => {
    if (!valor || valor.toString().trim() === '-') return '';
    const texto = valor.toString();
    const encoder = new TextEncoder();
    const data = encoder.encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const base64 = btoa(String.fromCharCode.apply(null, hashArray));
    return base64.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 8);
};

const applyMask = (value, type) => {
    if (!value) return '';
    let v = value.replace(/\D/g, ''); 
    if (type === 'DUI') {
        if (v.length > 8) return `${v.substring(0, 8)}-${v.substring(8, 9)}`;
        return v;
    }
    if (type === 'PHONE') {
        if (v.length > 4) return `${v.substring(0, 4)}-${v.substring(4, 8)}`;
        return v;
    }
    if (type === 'ISSS' && v.length > 9) return v.substring(0, 9);
    if (type === 'AFP' && v.length > 12) return v.substring(0, 12);
    return v;
};

const isValidDUIAlgorithm = (dui) => {
    if (!dui) return true; 
    const cleanDui = dui.replace(/\D/g, '');
    if (cleanDui.length !== 9) return true; 
    
    const digits = cleanDui.split('').map(Number);
    const verifier = digits.pop();
    
    let sum = 0;
    for (let i = 0; i < 8; i++) {
        sum += digits[i] * (9 - i);
    }
    
    let calcVerifier = 10 - (sum % 10);
    if (calcVerifier === 10) calcVerifier = 0;
    
    return calcVerifier === verifier;
};

// ============================================================================
// 🚀 COMPONENTES REUTILIZABLES
// ============================================================================
const PortalInput = memo(({ icon: Icon, label, name, value, onChange, type = "text", placeholder, colSpan = 1, required = false, helperText, prefix, readOnly = false, maskType, hasError, errorMessage }) => {
    const handleInputChange = (e) => {
        let val = e.target.value;
        if (maskType) val = applyMask(val, maskType);
        e.target.value = val;
        onChange(e);
    };

    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50";
    const errorClasses = hasError || (required && !value?.trim()) ? '!border-red-400 !bg-red-50/50' : '';

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span>{label} {helperText && <span className="text-[8px] text-[#007AFF] ml-1">{helperText}</span>}</span>
                {required && !value?.trim() && !hasError && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                {hasError && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md shadow-sm border border-red-300 flex items-center gap-1"><AlertCircle size={10} /> {errorMessage}</span>}
            </label>
            <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] z-10 ${readOnly ? 'opacity-80 cursor-not-allowed bg-slate-100/50 border-slate-200/50' : `border-slate-200/80 ${inputHoverClass} ${errorClasses}`}`}>
                {Icon && <div className="absolute left-3 text-slate-400"><Icon size={14} strokeWidth={2.5} /></div>}
                {prefix && <div className="absolute left-3 text-slate-400 font-black text-[13px]">{prefix}</div>}
                <input
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={readOnly}
                    className={`w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none ${Icon ? 'pl-9 pr-4' : prefix ? 'pl-8 pr-4' : 'px-4'}`}
                />
                {readOnly && <Lock size={12} className="absolute right-3 text-slate-400" />}
            </div>
        </div>
    );
});

// ============================================================================
// 🚀 COMPONENTE PRINCIPAL
// ============================================================================
// Locked field shown for HR-action-only fields in edit mode
const LockedField = ({ label, value, colSpan = 1 }) => (
    <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 mb-1.5 flex items-center justify-between">
            <span>{label}</span>
            <span className="text-[8px] font-black text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                <Lock size={8} strokeWidth={3} /> Acción RRHH
            </span>
        </label>
        <div className="flex items-center gap-2 w-full h-[40px] px-3 bg-slate-50/60 border border-slate-200/50 rounded-[1rem] cursor-not-allowed opacity-70">
            <Lock size={12} className="text-slate-300 shrink-0" />
            <span className="text-[13px] font-bold text-slate-500 truncate">{value || '—'}</span>
        </div>
    </div>
);

const EmployeeFormModal = ({ formData, setFormData, branches, roles, isEditMode = false, activeTab: activeTabProp, setActiveTab: setActiveTabProp }) => {

    const employees = useStaffStore(state => state.employees);
    const [localActiveTab, setLocalActiveTab] = useState('personal');
    const activeTab = activeTabProp !== undefined ? activeTabProp : localActiveTab;
    const setActiveTab = setActiveTabProp || setLocalActiveTab;
    const [hasDraft, setHasDraft] = useState(false);

    // Skip draft logic in edit mode
    useEffect(() => {
        const checkDraft = () => {
            if (isEditMode) return;
            const draftStr = localStorage.getItem('wfm_employee_draft');
            if (draftStr && !formData?.id) {
                try {
                    const parsed = JSON.parse(draftStr);
                    const draftDuiClean = parsed.dui ? parsed.dui.replace(/\D/g, '') : '';
                    
                    // Comprobamos si el empleado del borrador ya está guardado en el sistema
                    const isAlreadySaved = employees.some(emp => {
                        const empDuiClean = emp.dui ? emp.dui.replace(/\D/g, '') : '';
                        const isSameDui = draftDuiClean && empDuiClean === draftDuiClean;
                        const isSameName = (parsed.first_names && parsed.last_names) && 
                                           (emp.first_names?.trim().toLowerCase() === parsed.first_names?.trim().toLowerCase() && 
                                            emp.last_names?.trim().toLowerCase() === parsed.last_names?.trim().toLowerCase());
                        return isSameDui || isSameName;
                    });

                    if (isAlreadySaved) {
                        // El usuario ya se guardó, destruimos el borrador
                        localStorage.removeItem('wfm_employee_draft');
                        setHasDraft(false);
                    } else if (parsed.first_names || parsed.last_names || parsed.dui) {
                        setHasDraft(true);
                    }
                } catch (e) {
                    console.error("Error validando borrador:", e);
                }
            }
        };

        checkDraft();
    }, [employees, formData?.id, isEditMode]);

    useEffect(() => {
        if (!formData?.code) { 
            setFormData(prev => ({
                first_names: '', last_names: '', username: '', phone: '', address: '', dui: '', birth_date: '',
                gender: '', blood_type: '', marital_status: '', emergency_contact_name: '', emergency_contact_phone: '',
                department: '', municipality: '', education_level: '', profession: '',
                code: `EMP${Math.floor(1000 + Math.random() * 9000)}`, 
                branch_id: prev?.branchId || prev?.branch_id || '', 
                role_id: '', secondary_role_id: '', 
                hire_date: prev?.hireDate || prev?.hire_date || new Date().toISOString().split('T')[0], 
                kiosk_pin: '', photoPreview: null, file: null,
                contract_type: 'INDEFINIDO', contract_end_date: '', weekly_contracted_hours: '44', base_salary: '',
                afp_number: '', isss_number: '', bank_name: '', account_number: '',
                ...prev 
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (isEditMode) return;
        if (!formData?.id && (formData?.first_names || formData?.last_names || formData?.dui)) {
            const dataToSave = { ...formData };
            delete dataToSave.file; 
            delete dataToSave.photoPreview; 
            localStorage.setItem('wfm_employee_draft', JSON.stringify(dataToSave));
        }
    }, [formData]);

    const restoreDraft = () => {
        try {
            const draftStr = localStorage.getItem('wfm_employee_draft');
            if (draftStr) {
                const parsed = JSON.parse(draftStr);
                setFormData(prev => ({ ...prev, ...parsed }));
                setHasDraft(false);
            }
        } catch(e) { console.error("Error leyendo borrador", e); }
    };

    const discardDraft = () => {
        localStorage.removeItem('wfm_employee_draft');
        setHasDraft(false);
    };

    const municipioOpts = useMemo(() => {
        if (!formData?.department || !EL_SALVADOR_GEO[formData.department]) return [];
        return EL_SALVADOR_GEO[formData.department].map(m => ({ value: m, label: m }));
    }, [formData?.department]);

    const generateUniqueCode = () => `EMP${Math.floor(1000 + Math.random() * 9000)}`;

    useEffect(() => {
        const updatePin = async () => {
            if (formData?.code) {
                const pin = await generateHashCorto(formData.code);
                if(pin !== formData.kiosk_pin) setFormData(p => ({ ...p, kiosk_pin: pin }));
            }
        };
        updatePin();
    }, [formData?.code]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
            if ((name === 'first_names' || name === 'last_names') && (!prev.id)) {
                const f = (name === 'first_names' ? value : prev.first_names || '').trim().toLowerCase().split(/\s+/)[0] || '';
                const l = (name === 'last_names' ? value : prev.last_names || '').trim().toLowerCase().split(/\s+/)[0] || '';
                let un = f && l ? `${f}.${l}` : f || l;
                newData.username = un.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]/g, '');
            }
            return newData;
        });
    };

    const handleSelectChange = (name, value) => {
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
            if (name === 'department') newData.municipality = '';
            if (name === 'contract_type' && value !== 'TEMPORAL') newData.contract_end_date = '';
            if (name === 'contract_type' && value === 'MEDIO_TIEMPO') newData.weekly_contracted_hours = '22';
            if (name === 'contract_type' && value !== 'MEDIO_TIEMPO' && prev.weekly_contracted_hours === '22') newData.weekly_contracted_hours = '44';
            return newData;
        });
    };

    const handleDateChange = (name, dateString) => setFormData(prev => ({ ...prev, [name]: dateString }));

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

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); 
        }
    };

    const isDuiDuplicate = useMemo(() => {
        if (!formData?.dui || formData.dui.length < 10) return false;
        return employees.some(emp => emp.dui === formData.dui && String(emp.id) !== String(formData.id));
    }, [formData?.dui, formData?.id, employees]);

    const isDuiInvalid = formData?.dui?.length === 10 && !isValidDUIAlgorithm(formData.dui);

    let duiErrorMsg = null;
    if (isDuiDuplicate) duiErrorMsg = "DUI Ya Registrado";
    else if (isDuiInvalid) duiErrorMsg = "DUI Inválido";

    const isHomonymWarning = useMemo(() => {
        if (!formData?.first_names || !formData?.last_names) return false;
        
        const normalizeStr = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const currentFullName = `${normalizeStr(formData.first_names)} ${normalizeStr(formData.last_names)}`;
        
        return employees.some(emp => {
            if (String(emp.id) === String(formData.id)) return false; 
            const empName = normalizeStr(emp.name);
            return empName === currentFullName;
        });
    }, [formData?.first_names, formData?.last_names, formData?.id, employees]);

    const AREA_TYPE_LABEL = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };
    const TYPE_ORDER_EMP = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
    const branchOpts = TYPE_ORDER_EMP.flatMap(type => {
        const group = (branches || []).filter(b => (b.type || 'FARMACIA') === type);
        if (!group.length) return [];
        return [
            { value: `__header_${type}`, label: AREA_TYPE_LABEL[type], isSeparator: true },
            ...group.map(b => ({ value: String(b.id), label: b.name })),
        ];
    });

    // Farmacias disponibles para asignar a externos
    const farmaciasOpts = (branches || [])
        .filter(b => (b.type || 'FARMACIA') === 'FARMACIA')
        .map(b => ({ value: String(b.id), label: b.name }));

    const selectedBranch = (branches || []).find(b => String(b.id) === String(formData.branch_id));
    const isExterna = selectedBranch?.type === 'EXTERNA';
    const roleOpts = roles?.map(r => ({ value: String(r.id), label: r.name })) || [];

    const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white/80";
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50";

    // 🚨 Propiedades base para que los selects floten libres del Modal
    const portalSelectProps = {
        menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
        menuPosition: "fixed",
        styles: { menuPortal: base => ({ ...base, zIndex: 99999 }) }
    };

    if (!formData) return null;

    return (
        <div className="flex flex-col w-full h-full relative z-10" onKeyDown={handleKeyDown}>

            {/* ALERTA DE BORRADOR (solo en creación) */}
            {!isEditMode && hasDraft && (
                <div className="mx-auto mb-4 bg-[#007AFF]/10 border border-[#007AFF]/30 p-3 rounded-2xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 w-full max-w-lg backdrop-blur-md">
                    <div className="flex items-center gap-2 text-[#007AFF]">
                        <RotateCcw size={16} strokeWidth={2.5} />
                        <span className="text-[11px] font-bold">Tienes un borrador sin guardar.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={discardDraft} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/50 text-slate-400 hover:text-red-500 transition-colors shadow-sm border border-white"><Trash2 size={14}/></button>
                        <button type="button" onClick={restoreDraft} className="px-3 h-8 bg-[#007AFF] text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-md">Restaurar</button>
                    </div>
                </div>
            )}

            {/* AVISO EN MODO EDICIÓN */}
            {isEditMode && (
                <div className="mb-4 bg-amber-50/80 border border-amber-200/80 p-3 rounded-2xl flex items-start gap-3 shadow-sm">
                    <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                    <p className="text-[11px] text-amber-700 font-medium leading-tight">
                        Los campos marcados con <span className="font-black">Acción RRHH</span> (sucursal, cargo, salario, contrato) solo se pueden modificar mediante una acción de personal desde el perfil del empleado.
                    </p>
                </div>
            )}

            {/* CONTENEDOR ANIMADO */}
            <div key={activeTab} className="w-full space-y-4 animate-in fade-in zoom-in-95 duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] fill-mode-both">
                
                {/* TAB 1: DATOS PERSONALES */}
                {activeTab === 'personal' && (
                    <>
                        {/* ALERTA DE HOMÓNIMOS */}
                        {isHomonymWarning && (
                            <div className="bg-amber-50/80 backdrop-blur-md border border-amber-200/80 p-3 rounded-2xl flex items-start gap-3 shadow-sm animate-in slide-in-from-top-4 mb-2">
                                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                <div>
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-amber-700">Posible Duplicado</h4>
                                    <p className="text-[11px] text-amber-600 font-medium leading-tight mt-0.5">Ya existe un colaborador registrado con este mismo nombre completo. Verifica si es una persona diferente (Homónimo).</p>
                                </div>
                            </div>
                        )}

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            {/* ÁREA DE FOTO DE PERFIL */}
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
                                    <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} id="photo-upload" />
                                    <label htmlFor="photo-upload" className="absolute inset-0 cursor-pointer"></label>
                                </div>
                                <div className="text-center sm:text-left">
                                    <h4 className="text-[16px] font-black text-slate-800 tracking-tight">Fotografía Oficial</h4>
                                    <p className="text-[11px] font-medium text-slate-500 max-w-[250px] leading-snug mt-1">Usa una imagen clara y profesional. Aparecerá en el portal web y el kiosko biométrico.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Nombres" name="first_names" value={formData.first_names} onChange={handleChange} required />
                                <PortalInput label="Apellidos" name="last_names" value={formData.last_names} onChange={handleChange} required />
                                <PortalInput label="DUI" name="dui" value={formData.dui} onChange={handleChange} icon={Fingerprint} placeholder="00000000-0" maskType="DUI" hasError={isDuiInvalid || isDuiDuplicate} errorMessage={duiErrorMsg} />
                                
                                <div className="relative z-30">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Fecha de Nacimiento</label>
                                    <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                        <LiquidDatePicker value={formData.birth_date} onChange={(date) => handleDateChange('birth_date', date)} placeholder="Seleccionar Fecha" />
                                    </div>
                                </div>
                                <PortalInput label="Teléfono" name="phone" value={formData.phone} onChange={handleChange} type="tel" icon={Phone} placeholder="0000-0000" maskType="PHONE" />
                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Género</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.gender} onChange={(val) => handleSelectChange('gender', val)} options={GENDER_OPTIONS} placeholder="Seleccionar..." {...portalSelectProps} />
                                    </div>
                                </div>
                            </div>
                        </div>

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
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative z-10">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nivel Académico</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.education_level} onChange={(val) => handleSelectChange('education_level', val)} options={EDUCATION_OPTIONS} placeholder="Nivel..." icon={GraduationCap} {...portalSelectProps} />
                                    </div>
                                </div>
                                <PortalInput label="Profesión / Título" name="profession" value={formData.profession} onChange={handleChange} icon={GraduationCap} placeholder="Ej. Lic. en Farmacia" />
                                <div className="relative z-0">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Estado Civil</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.marital_status} onChange={(val) => handleSelectChange('marital_status', val)} options={MARITAL_STATUS_OPTIONS} placeholder="Opcional..." {...portalSelectProps} />
                                    </div>
                                </div>
                            </div>
                        </div>

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
                    </>
                )}

                {/* TAB 2: LABORAL & CONTRATO */}
                {activeTab === 'laboral' && (
                    <>
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {isEditMode ? (
                                    <>
                                        <LockedField label="Área de Trabajo" value={selectedBranch?.name || formData.branch_id} />
                                        <LockedField label="Cargo Principal" value={roles?.find(r => String(r.id) === String(formData.role_id))?.name || formData.role} />
                                        <LockedField label="Cargo Secundario" value={roles?.find(r => String(r.id) === String(formData.secondary_role_id))?.name || formData.secondary_role || 'Sin cargo secundario'} />
                                        <LockedField label="Fecha de Contratación" value={formData.hire_date ? new Date(formData.hire_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'} />
                                    </>
                                ) : (
                                    <>
                                        <div className={`relative z-30 ${isExterna ? 'md:col-span-2' : ''}`}>
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">Área de Trabajo <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span></label>
                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.branch_id ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                                <LiquidSelect value={formData.branch_id} onChange={(val) => { handleSelectChange('branch_id', val); if (!((branches||[]).find(b=>String(b.id)===String(val))?.type === 'EXTERNA')) setFormData(p=>({...p, assigned_branch_ids:[]})); }} options={branchOpts} placeholder="Seleccionar..." clearable={false} icon={Building2} {...portalSelectProps} />
                                            </div>
                                        </div>
                                        {isExterna && (
                                            <div className="relative z-20 md:col-span-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-teal-600 ml-1 mb-1.5 block">Farmacias Asignadas</label>
                                                <div className="flex flex-wrap gap-2 p-3 bg-teal-50/50 border border-teal-200/60 rounded-[1rem] min-h-[44px]">
                                                    {farmaciasOpts.map(opt => {
                                                        const assigned = (formData.assigned_branch_ids || []).map(String);
                                                        const isActive = assigned.includes(opt.value);
                                                        return (
                                                            <button key={opt.value} type="button"
                                                                onClick={() => setFormData(p => { const cur = (p.assigned_branch_ids || []).map(String); return { ...p, assigned_branch_ids: isActive ? cur.filter(id => id !== opt.value) : [...cur, opt.value] }; })}
                                                                className={`px-3 h-7 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all duration-200 ${isActive ? 'bg-teal-500 text-white border-teal-400 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-teal-300 hover:text-teal-600'}`}
                                                            >{opt.label}</button>
                                                        );
                                                    })}
                                                </div>
                                                {(formData.assigned_branch_ids || []).length === 0 && <p className="text-[9px] text-teal-500 font-bold mt-1.5 ml-1">Sin farmacias asignadas — el personal externo cubre todas por defecto.</p>}
                                            </div>
                                        )}
                                        <div className="relative z-30">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Fecha de Contratación</label>
                                            <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                <LiquidDatePicker value={formData.hire_date} onChange={(date) => handleDateChange('hire_date', date)} placeholder="Seleccionar fecha" />
                                            </div>
                                        </div>
                                        <div className="relative z-20">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">Cargo Principal <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span></label>
                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.role_id ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                                <LiquidSelect value={formData.role_id} onChange={(val) => handleSelectChange('role_id', val)} options={roleOpts} placeholder="Cargo..." clearable={false} icon={ShieldCheck} {...portalSelectProps} />
                                            </div>
                                        </div>
                                        <div className="relative z-10">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Cargo Secundario (Apoyo)</label>
                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                <LiquidSelect value={formData.secondary_role_id} onChange={(val) => handleSelectChange('secondary_role_id', val)} options={roleOpts} placeholder="Opcional..." clearable={true} icon={ShieldCheck} {...portalSelectProps} />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {isEditMode ? (
                                    <LockedField label="Tipo de Contrato" value={CONTRACT_TYPE_OPTIONS.find(o => o.value === formData.contract_type)?.label || formData.contract_type} />
                                ) : (
                                    <div className="relative z-30">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Tipo de Contrato</label>
                                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                            <LiquidSelect value={formData.contract_type} onChange={(val) => handleSelectChange('contract_type', val)} options={CONTRACT_TYPE_OPTIONS} clearable={false} icon={Briefcase} {...portalSelectProps} />
                                        </div>
                                    </div>
                                )}

                                {formData.contract_type === 'TEMPORAL' ? (
                                    <div className="relative z-30 animate-in fade-in zoom-in-95">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-1.5 flex items-center justify-between">
                                            Fecha Fin de Contrato <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">Obligatorio</span>
                                        </label>
                                        <div className={`bg-amber-50/30 rounded-[1rem] border border-amber-200 shadow-sm flex items-center h-[40px] px-1.5`}>
                                            <LiquidDatePicker value={formData.contract_end_date} onChange={(date) => handleDateChange('contract_end_date', date)} placeholder="Obligatorio para temporales" />
                                        </div>
                                    </div>
                                ) : <div className="hidden md:block" />}

                                <PortalInput label="Horas Semanales (WFM)" name="weekly_contracted_hours" value={formData.weekly_contracted_hours} onChange={handleChange} type="number" icon={Clock} placeholder="44" />
                                {isEditMode
                                    ? <LockedField label="Salario Base" value={formData.base_salary ? `$${Number(formData.base_salary).toFixed(2)}` : '—'} />
                                    : <PortalInput label="Salario Base" name="base_salary" value={formData.base_salary} onChange={handleChange} type="number" icon={DollarSign} placeholder="0.00" prefix="$" />
                                }
                            </div>
                        </div>
                    </>
                )}

                {/* TAB 3: NÓMINA & ACCESOS */}
                {activeTab === 'nomina' && (
                    <>
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-[0.8rem] border border-emerald-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                                    <CreditCard size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Cuentas y Retenciones</h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Número ISSS" name="isss_number" value={formData.isss_number} onChange={handleChange} icon={Hash} placeholder="9 dígitos" maskType="ISSS" />
                                <PortalInput label="NUP (AFP)" name="afp_number" value={formData.afp_number} onChange={handleChange} icon={Hash} placeholder="12 dígitos" maskType="AFP" />
                                
                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Banco (Planilla)</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.bank_name} onChange={(val) => handleSelectChange('bank_name', val)} options={BANKS_OPTIONS} placeholder="Seleccionar Banco..." icon={Building2} {...portalSelectProps} />
                                    </div>
                                </div>

                                <PortalInput label="Número de Cuenta" name="account_number" value={formData.account_number} onChange={handleChange} icon={CreditCard} placeholder="0000-0000-00" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className={`${islandClass} ${islandHoverClass}`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-slate-800 text-white rounded-[0.8rem] shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]"><AtSign size={16} strokeWidth={2.5} /></div>
                                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Login de App Móvil</h4>
                                </div>
                                <PortalInput label="Usuario (Auto-generado)" name="username" value={formData.username} onChange={handleChange} readOnly={true} icon={User} />
                            </div>

                            <div className={`bg-[#007AFF]/5 rounded-[1.5rem] p-4 md:p-5 border border-[#007AFF]/20 shadow-[0_8px_30px_rgba(0,122,255,0.05)] transition-all hover:-translate-y-1 hover:shadow-md`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-[#007AFF] text-white rounded-[0.8rem] shadow-[0_4px_12px_rgba(0,122,255,0.3)]"><Lock size={16} strokeWidth={2.5} /></div>
                                    <h4 className="text-[12px] font-black uppercase tracking-widest text-[#007AFF]">Seguridad Kiosko</h4>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">Cod. Empleado <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">Requerido</span></label>
                                    <div className="relative">
                                        <input type="text" name="code" value={formData.code} onChange={handleChange} className={`w-full bg-white border border-slate-200/80 rounded-[1rem] px-4 h-[40px] text-[13px] font-black text-slate-700 outline-none uppercase shadow-sm transition-all duration-300 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50 hover:shadow-md ${!formData.code?.trim() ? '!border-red-400 !bg-red-50/50' : ''}`} />
                                        <button type="button" onClick={() => setFormData(p => ({...p, code: generateUniqueCode()}))} className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-[#007AFF] hover:bg-blue-50 rounded-lg transition-colors"><RefreshCw size={14} strokeWidth={2.5} /></button>
                                    </div>
                                    <p className="text-[9px] font-bold text-[#007AFF] mt-2 ml-1 flex items-center gap-1"><ShieldCheck size={12} /> Codificado vía SHA-256 para el carnet.</p>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default EmployeeFormModal;