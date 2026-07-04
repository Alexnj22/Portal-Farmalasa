import React, { useState, useEffect, useMemo, memo } from 'react';
import { User, Briefcase, CreditCard, ShieldCheck, Phone, MapPin, Hash, Building2, Fingerprint, Lock, RefreshCw, AtSign, HeartPulse, Clock, DollarSign, GraduationCap, Camera, AlertCircle, RotateCcw, Trash2, Map as MapIcon, Navigation, AlertTriangle, CheckCircle2, Mail, Copy, Plus, X, BookOpen } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { EL_SALVADOR_GEO } from '../../data/elSalvadorGeo';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    GRADO_BASICA_OPTIONS, OTRA_ESPECIALIDAD,
    BACHILLERATO_TECNICO_ESPECIALIDADES, TECNICO_SUPERIOR_ESPECIALIDADES,
} from '../../utils/educationCatalogs';

// ============================================================================
// 🚀 CATÁLOGOS Y CONSTANTES
// ============================================================================
// Campos de texto libre que se guardan siempre en mayúscula (información de
// ficha, no credenciales) — email/username/teléfonos/DUI quedan fuera.
const UPPERCASE_FIELDS = new Set(['first_names', 'last_names', 'address', 'profession', 'emergency_contact_name']);

const GENDER_OPTIONS = [{ value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }];
const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];
const CONTRACT_TYPE_OPTIONS = [{ value: 'INDEFINIDO', label: 'Indefinido (Fijo)' }, { value: 'TEMPORAL', label: 'Temporal / Plazo Fijo' }, { value: 'MEDIO_TIEMPO', label: 'Medio Tiempo (Part-Time)' }, { value: 'SERVICIOS', label: 'Servicios Profesionales' }];
const EDUCATION_OPTIONS = [
    { value: 'BASICA', label: 'Educación Básica' },
    { value: 'BACHILLERATO_GENERAL', label: 'Bachillerato General' },
    { value: 'BACHILLERATO_TECNICO', label: 'Bachillerato Técnico' },
    { value: 'TECNICO_SUPERIOR', label: 'Técnico Superior' },
    { value: 'UNIVERSITARIO_E', label: 'Universitario (Estudiante)' },
    { value: 'UNIVERSITARIO_G', label: 'Universitario (Graduado)' },
    { value: 'MAESTRIA', label: 'Maestría / Postgrado' },
];
// Niveles donde el select de Especialidad aplica
const LEVELS_WITH_SPECIALTY = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR'];
// Niveles donde "¿Actualmente estudiando?" tiene sentido
const LEVELS_WITH_STUDY_TOGGLE = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR', 'MAESTRIA'];
// Niveles donde el campo Profesión/Título se muestra — Bachillerato Técnico
// queda fuera: su "título" ya es la especialidad, no una profesión aparte.
const LEVELS_WITH_PROFESSION = ['TECNICO_SUPERIOR', 'UNIVERSITARIO_E', 'UNIVERSITARIO_G', 'MAESTRIA'];

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_OPTIONS = MESES.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 12 }, (_, i) => CURRENT_YEAR + 1 - i).map(y => ({ value: String(y), label: String(y) }));

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '');

// Numeración de El Salvador: 8 dígitos, celular inicia en 6/7, fijo en 2.
// (No valida contra un rango exacto por operador — solo el primer dígito.)
const isValidSVPhone = (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length !== 8) return false;
    return /^[267]/.test(digits);
};

// Nombres/Apellidos: solo letras (con acentos/Ñ), espacios, guiones y apóstrofes;
// mínimo 2 caracteres. Cubre "apellido de casada" (ej. "Pérez de García") sin
// necesitar un campo aparte — es texto libre normal.
const isValidPersonName = (val) => {
    const v = (val || '').trim();
    if (v.length < 2) return false;
    return /^[A-Za-zÀ-ÖØ-öø-ÿÑñ'’\-\s.]+$/.test(v);
};

// Edad real en años a partir de una fecha "YYYY-MM-DD". Rango laboral válido: 16-90.
const MIN_WORK_AGE = 16;
const MAX_WORK_AGE = 90;
const calcAge = (birthDateStr) => {
    if (!birthDateStr) return null;
    const bd = new Date(birthDateStr + 'T00:00:00');
    if (isNaN(bd.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age;
};

const AFP_OPTIONS = [
    { value: 'CRECER', label: 'AFP Crecer' },
    { value: 'CONFIA', label: 'AFP Confía' },
];
const ACCOUNT_TYPE_OPTIONS = [
    { value: 'AHORRO',     label: 'Cuenta de Ahorro' },
    { value: 'CORRIENTE',  label: 'Cuenta Corriente' },
    { value: 'ELECTRONICA',label: 'Cuenta Electrónica' },
];

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
    if (type === 'ACCOUNT') return value.replace(/[^0-9-]/g, '').substring(0, 25);
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

    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#0052CC]/40 focus-within:ring-4 focus-within:ring-[#0052CC]/10 focus-within:border-[#0052CC]/50";
    const errorClasses = hasError || (required && !value?.trim()) ? '!border-red-400 !bg-red-50/50' : '';

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span>{label} {helperText && <span className="text-[8px] text-[#0052CC] ml-1">{helperText}</span>}</span>
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

// Select de especialidad con fallback a texto libre ("Otra especialidad...").
// key={education_level} en el caller para que se remonte limpio al cambiar de nivel.
const SpecialtySelector = ({ value, onChange, options, portalSelectProps, inputHoverClass, hasError }) => {
    const knownValues = useMemo(() => options.map(o => o.value), [options]);
    const [isOther, setIsOther] = useState(() => !!value && !knownValues.includes(value));

    const selectValue = isOther ? OTRA_ESPECIALIDAD : value;

    return (
        <div className="flex flex-col sm:flex-row gap-2">
            <div className={`flex-1 rounded-[1rem] h-[40px] ${inputHoverClass} ${hasError && !isOther ? '!border-red-400 !bg-red-50/50' : ''}`}>
                <LiquidSelect
                    value={selectValue}
                    onChange={(val) => {
                        if (val === OTRA_ESPECIALIDAD) { setIsOther(true); onChange(''); }
                        else { setIsOther(false); onChange(val); }
                    }}
                    options={options}
                    placeholder="Especialidad..."
                    clearable={false}
                    {...portalSelectProps}
                />
            </div>
            {isOther && (
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value.toUpperCase())}
                    placeholder="Especifica la especialidad"
                    className={`flex-1 h-[40px] px-4 bg-white border rounded-[1rem] text-[13px] font-bold text-slate-700 outline-none shadow-sm ${inputHoverClass} ${hasError ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}
                />
            )}
        </div>
    );
};

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

const EmployeeFormModal = ({ formData, setFormData, branches, roles, isEditMode = false, activeTab: activeTabProp }) => {

    const employees = useStaffStore(state => state.employees);
    const [localActiveTab, setLocalActiveTab] = useState('personal');
    const activeTab = activeTabProp !== undefined ? activeTabProp : localActiveTab;
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
                first_names: '', last_names: '', username: '', phone: '', extra_phones: [], email: '', address: '', extra_addresses: [], dui: '', birth_date: '',
                gender: '', blood_type: '', marital_status: '', emergency_contact_name: '', emergency_contact_phone: '',
                department: '', municipality: '', education_level: '', profession: '',
                education_grade_completed: '', education_specialty: '', is_studying: false,
                study_start_date: '', study_duration_years: '', additional_skills: [],
                code: String(Math.floor(1000 + Math.random() * 9000)),
                branch_id: prev?.branchId || prev?.branch_id || '', 
                role_id: '', secondary_role_id: '', 
                hire_date: prev?.hireDate || prev?.hire_date || new Date().toISOString().split('T')[0], 
                kiosk_pin: '', photoPreview: null, file: null,
                contract_type: 'INDEFINIDO', contract_end_date: '', weekly_contracted_hours: '44', base_salary: '',
                afp_number: '', isss_number: '', afp_institution: '', bank_name: '', account_number: '', account_type: 'AHORRO',
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

    const pendingItems = useMemo(() => {
        if (!isEditMode) return [];
        const items = [];
        if (!formData?.dui) items.push('DUI');
        if (!formData?.birth_date) items.push('Fecha de Nacimiento');
        if (!formData?.isss_number && !formData?.afp_number) items.push('ISSS o AFP');
        return items;
    }, [isEditMode, formData?.dui, formData?.birth_date, formData?.isss_number, formData?.afp_number]);

    const municipioOpts = useMemo(() => {
        if (!formData?.department || !EL_SALVADOR_GEO[formData.department]) return [];
        return EL_SALVADOR_GEO[formData.department].map(m => ({ value: m, label: m }));
    }, [formData?.department]);

    // Código SOLO numérico (regla de negocio + trigger en BD): con dígitos no
    // existe ambigüedad de mayúsculas en el hash SHA-256 del PIN. Verifica
    // contra los códigos existentes para no colisionar con el índice único.
    const generateUniqueCode = () => {
        const taken = new Set(employees.map(e => (e.code || '').trim()));
        for (let i = 0; i < 50; i++) {
            const candidate = String(Math.floor(1000 + Math.random() * 9000));
            if (!taken.has(candidate)) return candidate;
        }
        return Date.now().toString().slice(-6);
    };

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
        const { name } = e.target;
        const value = UPPERCASE_FIELDS.has(name) ? e.target.value.toUpperCase() : e.target.value;
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
            if (name === 'education_level') {
                newData.education_grade_completed = '';
                newData.education_specialty = '';
                if (value === 'BASICA' || value === 'BACHILLERATO_GENERAL') newData.profession = '';
                if (value === 'UNIVERSITARIO_E') newData.is_studying = true;
                else if (!LEVELS_WITH_STUDY_TOGGLE.includes(value)) newData.is_studying = false;
                if (!LEVELS_WITH_STUDY_TOGGLE.includes(value) && value !== 'UNIVERSITARIO_E') {
                    newData.study_start_date = '';
                    newData.study_duration_years = '';
                }
            }
            return newData;
        });
    };

    const handleStudyDateChange = (part, value) => {
        setFormData(prev => {
            const [y, m] = (prev.study_start_date || `${CURRENT_YEAR}-01`).split('-');
            const newY = part === 'year' ? value : y;
            const newM = part === 'month' ? value : m;
            return { ...prev, study_start_date: `${newY}-${newM}-01` };
        });
    };

    const estimatedStudyEndDate = useMemo(() => {
        if (!formData?.study_start_date || !formData?.study_duration_years) return null;
        const [y, m] = formData.study_start_date.split('-').map(Number);
        const totalMonths = (m - 1) + Math.round(Number(formData.study_duration_years) * 12);
        const endYear = y + Math.floor(totalMonths / 12);
        const endMonth = ((totalMonths % 12) + 12) % 12;
        return { date: new Date(endYear, endMonth, 1), label: `${MESES[endMonth]} ${endYear}` };
    }, [formData?.study_start_date, formData?.study_duration_years]);

    const estimatedStudyEnd = estimatedStudyEndDate?.label || null;
    // No es real seguir "actualmente estudiando" si la fecha estimada de fin ya pasó.
    const studyEndInPast = !!formData?.is_studying && !!estimatedStudyEndDate && estimatedStudyEndDate.date < new Date();

    const addSkill = () => setFormData(prev => ({ ...prev, additional_skills: [...(prev.additional_skills || []), ''] }));
    const updateSkill = (idx, value) => setFormData(prev => {
        const arr = [...(prev.additional_skills || [])]; arr[idx] = value.toUpperCase(); return { ...prev, additional_skills: arr };
    });
    const removeSkill = (idx) => setFormData(prev => ({ ...prev, additional_skills: (prev.additional_skills || []).filter((_, i) => i !== idx) }));

    const addPhone = () => setFormData(prev => ({ ...prev, extra_phones: [...(prev.extra_phones || []), ''] }));
    const updatePhone = (idx, value) => setFormData(prev => {
        const arr = [...(prev.extra_phones || [])]; arr[idx] = applyMask(value, 'PHONE'); return { ...prev, extra_phones: arr };
    });
    const removePhone = (idx) => setFormData(prev => ({ ...prev, extra_phones: (prev.extra_phones || []).filter((_, i) => i !== idx) }));

    const addAddress = () => setFormData(prev => ({ ...prev, extra_addresses: [...(prev.extra_addresses || []), { department: '', municipality: '', address: '' }] }));
    const updateAddress = (idx, field, value) => setFormData(prev => {
        const arr = [...(prev.extra_addresses || [])];
        const entry = { ...(arr[idx] || {}) };
        entry[field] = field === 'address' ? value.toUpperCase() : value;
        if (field === 'department') entry.municipality = '';
        arr[idx] = entry;
        return { ...prev, extra_addresses: arr };
    });
    const removeAddress = (idx) => setFormData(prev => ({ ...prev, extra_addresses: (prev.extra_addresses || []).filter((_, i) => i !== idx) }));

    const handleDateChange = (name, dateString) => setFormData(prev => ({ ...prev, [name]: dateString }));

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
        if (!ALLOWED_TYPES.includes(file.type)) {
            useToastStore.getState().showToast('Archivo inválido', 'Solo se permiten imágenes JPG, PNG o WEBP.', 'error');
            return;
        }
        if (file.size > MAX_SIZE) {
            useToastStore.getState().showToast('Archivo muy grande', 'La foto no debe superar 5 MB.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            setFormData(prev => ({ ...prev, file: file, photoPreview: reader.result }));
        };
        reader.readAsDataURL(file);
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
    const isDuiIncomplete = !!formData?.dui && formData.dui.length > 0 && formData.dui.length < 10;

    // Avisos de longitud para campos opcionales con formato fijo
    const digitsLen = (v) => (v || '').replace(/\D/g, '').length;
    const phoneIncomplete = !!formData?.phone && digitsLen(formData.phone) > 0 && digitsLen(formData.phone) < 8;
    const phoneBadPrefix   = !!formData?.phone && digitsLen(formData.phone) === 8 && !isValidSVPhone(formData.phone);
    const phoneHasError    = phoneIncomplete || phoneBadPrefix;
    const phoneErrorMsg    = phoneIncomplete ? 'Incompleto' : phoneBadPrefix ? 'Debe iniciar en 2, 6 o 7' : null;
    const emergPhoneIncomplete = !!formData?.emergency_contact_phone && digitsLen(formData.emergency_contact_phone) > 0 && digitsLen(formData.emergency_contact_phone) < 8;
    const emergPhoneBadPrefix  = !!formData?.emergency_contact_phone && digitsLen(formData.emergency_contact_phone) === 8 && !isValidSVPhone(formData.emergency_contact_phone);
    const emergPhoneHasError   = emergPhoneIncomplete || emergPhoneBadPrefix;
    const emergPhoneErrorMsg  = emergPhoneIncomplete ? 'Incompleto' : emergPhoneBadPrefix ? 'Debe iniciar en 2, 6 o 7' : null;
    const isssIncomplete = !!formData?.isss_number && formData.isss_number.length !== 9;
    const afpIncomplete = !!formData?.afp_number && formData.afp_number.length !== 12;
    const emailInvalid = !!formData?.email && !isValidEmail(formData.email);
    const firstNamesInvalid = !!formData?.first_names && !isValidPersonName(formData.first_names);
    const lastNamesInvalid  = !!formData?.last_names && !isValidPersonName(formData.last_names);

    const employeeAge = calcAge(formData?.birth_date);
    const birthDateInFuture = !!formData?.birth_date && new Date(formData.birth_date + 'T00:00:00') > new Date();
    const birthDateOutOfRange = employeeAge !== null && (employeeAge < MIN_WORK_AGE || employeeAge > MAX_WORK_AGE);
    const birthDateInvalid = birthDateInFuture || birthDateOutOfRange;
    const birthDateErrorMsg = birthDateInFuture ? 'Fecha futura' : birthDateOutOfRange ? `Edad debe ser ${MIN_WORK_AGE}-${MAX_WORK_AGE}` : null;

    let duiErrorMsg = null;
    if (isDuiDuplicate) duiErrorMsg = "DUI Ya Registrado";
    else if (isDuiInvalid) duiErrorMsg = "DUI Inválido";
    else if (isDuiIncomplete) duiErrorMsg = "Incompleto";

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
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#0052CC]/40 focus-within:ring-4 focus-within:ring-[#0052CC]/10 focus-within:border-[#0052CC]/50";

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
                <div className="mx-auto mb-4 bg-[#0052CC]/10 border border-[#0052CC]/30 p-3 rounded-2xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 w-full max-w-lg backdrop-blur-md">
                    <div className="flex items-center gap-2 text-[#0052CC]">
                        <RotateCcw size={16} strokeWidth={2.5} />
                        <span className="text-[11px] font-bold">Tienes un borrador sin guardar.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={discardDraft} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/50 text-slate-400 hover:text-red-500 transition-colors shadow-sm border border-white"><Trash2 size={14}/></button>
                        <button type="button" onClick={restoreDraft} className="px-3 h-8 bg-[#0052CC] text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-[0.97] transition-all shadow-md">Restaurar</button>
                    </div>
                </div>
            )}

            {/* DATOS PENDIENTES EN MODO EDICIÓN */}
            {isEditMode && pendingItems.length > 0 && (
                <div className="mb-3 bg-red-50/90 border border-red-200/80 p-3 rounded-2xl flex items-start gap-3 shadow-sm animate-in slide-in-from-top-2">
                    <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-0.5">Información Pendiente</p>
                        <p className="text-[11px] text-red-600 font-medium leading-tight">
                            Completa los siguientes campos: <span className="font-black">{pendingItems.join(' • ')}</span>
                        </p>
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
                                    <p className="text-[11px] text-amber-600 font-medium leading-tight mt-0.5">Ya existe un empleado registrado con este mismo nombre completo. Verifica si es una persona diferente (Homónimo).</p>
                                </div>
                            </div>
                        )}

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            {/* ÁREA DE FOTO DE PERFIL */}
                            <div className="flex flex-col sm:flex-row items-center gap-6 mb-6 pb-6 border-b border-slate-200/50">
                                <div className="relative group cursor-pointer shrink-0">
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-[1.5rem] border-4 border-white shadow-[0_4px_15px_rgba(0,0,0,0.08)] overflow-hidden bg-slate-100 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                                        {formData.photoPreview || formData.photo || formData.photo_url ? (
                                            <img src={formData.photoPreview || formData.photo || formData.photo_url} alt="Perfil" className="w-full h-full object-cover" />
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
                                <PortalInput label="Nombres" name="first_names" value={formData.first_names} onChange={handleChange} required hasError={firstNamesInvalid} errorMessage="Solo letras" />
                                <PortalInput label="Apellidos" name="last_names" value={formData.last_names} onChange={handleChange} required hasError={lastNamesInvalid} errorMessage="Solo letras" />
                                <PortalInput label="DUI" name="dui" value={formData.dui} onChange={handleChange} icon={Fingerprint} placeholder="00000000-0" maskType="DUI" hasError={isDuiInvalid || isDuiDuplicate || isDuiIncomplete} errorMessage={duiErrorMsg} />

                                <div className="relative z-30">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Fecha de Nacimiento {employeeAge !== null && !birthDateInvalid && <span className="text-slate-400 font-bold normal-case tracking-normal">· {employeeAge} años</span>}</span>
                                        {birthDateInvalid && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md ml-1">{birthDateErrorMsg}</span>}
                                    </label>
                                    <div className={`bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${birthDateInvalid ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                        <LiquidDatePicker value={formData.birth_date} onChange={(date) => handleDateChange('birth_date', date)} placeholder="Seleccionar Fecha" />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Teléfono {phoneHasError && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md ml-1">{phoneErrorMsg}</span>}</span>
                                        <button type="button" onClick={addPhone} className="text-[#0052CC] hover:text-blue-700 flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider transition-colors">
                                            <Plus size={11} strokeWidth={3} /> Agregar
                                        </button>
                                    </label>
                                    <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] z-10 border-slate-200/80 ${inputHoverClass} ${phoneHasError ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                        <div className="absolute left-3 text-slate-400"><Phone size={14} strokeWidth={2.5} /></div>
                                        <input type="tel" name="phone" value={formData.phone || ''}
                                            onChange={(e) => { e.target.value = applyMask(e.target.value, 'PHONE'); handleChange(e); }}
                                            placeholder="0000-0000"
                                            className="w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                    </div>
                                </div>

                                <PortalInput label="Correo Electrónico" name="email" value={formData.email} onChange={handleChange} type="email" icon={Mail} placeholder="nombre@correo.com" hasError={emailInvalid} errorMessage="Correo inválido" />

                                {(formData.extra_phones || []).length > 0 && (
                                    <div className="md:col-span-2 flex flex-col gap-2">
                                        {(formData.extra_phones || []).map((ph, idx) => {
                                            const dLen = digitsLen(ph);
                                            const phErr = !!ph && dLen > 0 && (dLen < 8 || !isValidSVPhone(ph));
                                            return (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className={`relative flex-1 bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${phErr ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                                        <div className="absolute left-3 text-slate-400"><Phone size={14} strokeWidth={2.5} /></div>
                                                        <input type="tel" value={ph} onChange={(e) => updatePhone(idx, e.target.value)} placeholder="0000-0000"
                                                            className="w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                                    </div>
                                                    <button type="button" onClick={() => removePhone(idx)} title="Quitar teléfono"
                                                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                        <X size={14} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Género</span>
                                        {!formData.gender && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                    </label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.gender ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                        <LiquidSelect value={formData.gender} onChange={(val) => handleSelectChange('gender', val)} options={GENDER_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>
                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Estado Civil</span>
                                        {!formData.marital_status && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                    </label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.marital_status ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                        <LiquidSelect value={formData.marital_status} onChange={(val) => handleSelectChange('marital_status', val)} options={MARITAL_STATUS_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Dirección Detallada" name="address" value={formData.address} onChange={handleChange} icon={MapPin} placeholder="Colonia, Calle, Número de Casa..." colSpan={2} />

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Departamento</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.department} onChange={(val) => handleSelectChange('department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>
                                <div className="relative z-10">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Distrito</span>
                                        {formData.department && !formData.municipality && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                    </label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${formData.department && !formData.municipality ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                        <LiquidSelect value={formData.municipality} onChange={(val) => handleSelectChange('municipality', val)} options={municipioOpts} placeholder={formData.department ? 'Distrito...' : 'Elija Depto.'} disabled={!formData.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                <div className="md:col-span-2 -mt-2">
                                    <button type="button" onClick={addAddress} className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-[#0052CC] hover:text-blue-700 transition-colors">
                                        <Plus size={11} strokeWidth={3} /> Agregar Dirección Alterna
                                    </button>
                                </div>

                                {(formData.extra_addresses || []).length > 0 && (
                                    <div className="md:col-span-2 flex flex-col gap-3">
                                        {(formData.extra_addresses || []).map((addr, idx) => {
                                            const altMunicipioOpts = addr.department && EL_SALVADOR_GEO[addr.department]
                                                ? EL_SALVADOR_GEO[addr.department].map(m => ({ value: m, label: m }))
                                                : [];
                                            return (
                                                <div key={idx} className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Dirección Alterna {idx + 1}</span>
                                                        <button type="button" onClick={() => removeAddress(idx)} title="Quitar dirección"
                                                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                            <X size={13} strokeWidth={2.5} />
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Departamento</label>
                                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                                <LiquidSelect value={addr.department} onChange={(val) => updateAddress(idx, 'department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                                <span>Distrito</span>
                                                                {addr.department && !addr.municipality && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                            </label>
                                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${addr.department && !addr.municipality ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                                                <LiquidSelect value={addr.municipality} onChange={(val) => updateAddress(idx, 'municipality', val)} options={altMunicipioOpts} placeholder={addr.department ? 'Distrito...' : 'Elija Depto.'} disabled={!addr.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                                            </div>
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Dirección Detallada</label>
                                                            <div className={`relative bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                                <div className="absolute left-3 text-slate-400"><MapPin size={14} strokeWidth={2.5} /></div>
                                                                <input type="text" value={addr.address || ''} onChange={(e) => updateAddress(idx, 'address', e.target.value)} placeholder="Colonia, Calle, Número de Casa..."
                                                                    className="w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-[0.8rem] border border-indigo-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                                    <GraduationCap size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Nivel Académico</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative z-30">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nivel Académico</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.education_level} onChange={(val) => handleSelectChange('education_level', val)} options={EDUCATION_OPTIONS} placeholder="Nivel..." icon={GraduationCap} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                {formData.education_level === 'BASICA' && (
                                    <div className="relative z-20 animate-in fade-in zoom-in-95 duration-200">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                            <span>Grado Finalizado</span>
                                            {!formData.education_grade_completed && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                        </label>
                                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.education_grade_completed ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                            <LiquidSelect value={formData.education_grade_completed} onChange={(val) => handleSelectChange('education_grade_completed', val)} options={GRADO_BASICA_OPTIONS} placeholder="Grado..." clearable={false} {...portalSelectProps} />
                                        </div>
                                    </div>
                                )}

                                {LEVELS_WITH_SPECIALTY.includes(formData.education_level) && (
                                    <div className="relative z-20 animate-in fade-in zoom-in-95 duration-200">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                            <span>Especialidad</span>
                                            {!formData.education_specialty && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                        </label>
                                        <SpecialtySelector
                                            key={formData.education_level}
                                            value={formData.education_specialty}
                                            onChange={(val) => handleSelectChange('education_specialty', val)}
                                            options={formData.education_level === 'BACHILLERATO_TECNICO' ? BACHILLERATO_TECNICO_ESPECIALIDADES : TECNICO_SUPERIOR_ESPECIALIDADES}
                                            portalSelectProps={portalSelectProps}
                                            inputHoverClass={inputHoverClass}
                                            hasError={!formData.education_specialty}
                                        />
                                    </div>
                                )}

                                {LEVELS_WITH_PROFESSION.includes(formData.education_level) && (
                                    <PortalInput label="Profesión / Título" name="profession" value={formData.profession} onChange={handleChange} icon={BookOpen} placeholder="Ej. Lic. en Farmacia" required colSpan={2} />
                                )}

                                {(LEVELS_WITH_STUDY_TOGGLE.includes(formData.education_level) || formData.education_level === 'UNIVERSITARIO_E') && (
                                    <div className="md:col-span-2 bg-indigo-50/40 rounded-[1.25rem] p-3.5 border border-indigo-100/60 animate-in fade-in zoom-in-95 duration-200">
                                        {formData.education_level !== 'UNIVERSITARIO_E' ? (
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={!!formData.is_studying} onChange={(e) => handleSelectChange('is_studying', e.target.checked)} className="w-4 h-4 rounded accent-[#0052CC]" />
                                                <span className="text-[11px] font-black text-indigo-700 uppercase tracking-wide">¿Actualmente estudiando?</span>
                                            </label>
                                        ) : (
                                            <p className="text-[11px] font-black text-indigo-700 uppercase tracking-wide">Datos de la carrera en curso</p>
                                        )}

                                        {!!formData.is_studying && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                <div>
                                                    <label className="text-[9px] font-black uppercase tracking-widest text-indigo-500 ml-1 mb-1 block">Mes de Inicio</label>
                                                    <div className="rounded-[1rem] h-[38px]">
                                                        <LiquidSelect value={formData.study_start_date ? formData.study_start_date.split('-')[1] : ''} onChange={(val) => handleStudyDateChange('month', val)} options={MONTH_OPTIONS} placeholder="Mes..." compact clearable={false} {...portalSelectProps} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[9px] font-black uppercase tracking-widest text-indigo-500 ml-1 mb-1 block">Año de Inicio</label>
                                                    <div className="rounded-[1rem] h-[38px]">
                                                        <LiquidSelect value={formData.study_start_date ? formData.study_start_date.split('-')[0] : ''} onChange={(val) => handleStudyDateChange('year', val)} options={YEAR_OPTIONS} placeholder="Año..." compact clearable={false} {...portalSelectProps} />
                                                    </div>
                                                </div>
                                                <PortalInput label="Duración (años)" name="study_duration_years" value={formData.study_duration_years} onChange={handleChange} type="number" placeholder="Ej. 2.5" hasError={studyEndInPast} errorMessage="Revisa fechas" />
                                            </div>
                                        )}
                                        {estimatedStudyEnd && (
                                            <p className={`text-[10px] font-bold mt-2 ml-1 ${studyEndInPast ? 'text-red-600' : 'text-indigo-600'}`}>
                                                {studyEndInPast
                                                    ? `Finalizó en ${estimatedStudyEnd} — no puede seguir "actualmente estudiando"`
                                                    : `Finaliza aprox.: ${estimatedStudyEnd}`}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-200/50">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Cursos / Habilidades Adicionales</label>
                                <div className="flex flex-col gap-2">
                                    {(formData.additional_skills || []).map((skill, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                            <input type="text" value={skill} onChange={(e) => updateSkill(idx, e.target.value)} placeholder="Ej. Curso de atención al cliente"
                                                className={`flex-1 h-[38px] px-4 bg-white border border-slate-200/80 rounded-[1rem] text-[13px] font-bold text-slate-700 outline-none shadow-sm ${inputHoverClass}`} />
                                            <button type="button" onClick={() => removeSkill(idx)} title="Quitar"
                                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                <X size={14} strokeWidth={2.5} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button type="button" onClick={addSkill} className="mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC] hover:text-blue-700 transition-colors">
                                    <Plus size={12} strokeWidth={3} /> Agregar Curso / Habilidad
                                </button>
                            </div>
                        </div>

                        <div className={`bg-red-50/50 rounded-[1.5rem] p-4 md:p-5 border border-red-100/50 shadow-[0_8px_30px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md`}>
                            <h4 className="text-[12px] font-black uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2"><HeartPulse size={16} strokeWidth={2.5} /> Ficha Médica y Emergencia</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="col-span-1 relative z-10">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 block">Tipo de Sangre</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.blood_type} onChange={(val) => handleSelectChange('blood_type', val)} options={BLOOD_TYPE_OPTIONS} placeholder="Vital..." clearLabel="Ninguno" {...portalSelectProps} />
                                    </div>
                                </div>
                                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <PortalInput label="Avisar a (Nombre)" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} placeholder="Familiar o Pareja" />
                                    <PortalInput label="Teléfono de Emergencia" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} placeholder="0000-0000" maskType="PHONE" hasError={emergPhoneHasError} errorMessage={emergPhoneErrorMsg} />
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
                                                <LiquidSelect value={formData.secondary_role_id} onChange={(val) => handleSelectChange('secondary_role_id', val)} options={roleOpts} placeholder="Opcional..." clearable={true} clearLabel="Ninguno" icon={ShieldCheck} {...portalSelectProps} />
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

                {/* TAB 3: NÓMINA Y ACCESOS */}
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
                                <PortalInput label="Número ISSS" name="isss_number" value={formData.isss_number} onChange={handleChange} icon={Hash} placeholder="9 dígitos" maskType="ISSS" hasError={isssIncomplete} errorMessage="Debe tener 9 dígitos" />
                                <PortalInput label="NUP (AFP)" name="afp_number" value={formData.afp_number} onChange={handleChange} icon={Hash} placeholder="12 dígitos" maskType="AFP" hasError={afpIncomplete} errorMessage="Debe tener 12 dígitos" />

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Institución AFP</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.afp_institution} onChange={(val) => handleSelectChange('afp_institution', val)} options={AFP_OPTIONS} placeholder="Crecer o Confía..." icon={Hash} clearLabel="Ninguno" {...portalSelectProps} />
                                    </div>
                                </div>

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Banco (Planilla)</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.bank_name} onChange={(val) => handleSelectChange('bank_name', val)} options={BANKS_OPTIONS} placeholder="Seleccionar Banco..." icon={Building2} clearLabel="Ninguno" {...portalSelectProps} />
                                    </div>
                                </div>

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Tipo de Cuenta</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.account_type} onChange={(val) => handleSelectChange('account_type', val)} options={ACCOUNT_TYPE_OPTIONS} placeholder="Tipo de cuenta..." icon={CreditCard} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                <PortalInput label="Número de Cuenta" name="account_number" value={formData.account_number} onChange={handleChange} icon={CreditCard} placeholder="0000-0000-00" maskType="ACCOUNT" />
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

                            <div className={`bg-[#0052CC]/5 rounded-[1.5rem] p-4 md:p-5 border border-[#0052CC]/20 shadow-[0_8px_30px_rgba(0,82,204,0.05)] transition-all hover:-translate-y-1 hover:shadow-md`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-[#0052CC] text-white rounded-[0.8rem] shadow-[0_4px_12px_rgba(0,82,204,0.3)]"><Lock size={16} strokeWidth={2.5} /></div>
                                    <h4 className="text-[12px] font-black uppercase tracking-widest text-[#0052CC]">Seguridad Kiosko</h4>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">Cod. Empleado <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">Requerido</span></label>
                                    <div className="relative">
                                        <input type="text" name="code" value={formData.code} inputMode="numeric" placeholder="Ej. 1024"
                                            onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, ''); handleChange(e); }}
                                            className={`w-full bg-white border border-slate-200/80 rounded-[1rem] px-4 h-[40px] text-[13px] font-black text-slate-700 outline-none shadow-sm transition-all duration-300 focus-within:ring-4 focus-within:ring-[#0052CC]/10 focus-within:border-[#0052CC]/50 hover:shadow-md ${!formData.code?.trim() ? '!border-red-400 !bg-red-50/50' : ''}`} />
                                        <button type="button" onClick={() => setFormData(p => ({...p, code: generateUniqueCode()}))} className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-[#0052CC] hover:bg-blue-50 rounded-lg transition-colors"><RefreshCw size={14} strokeWidth={2.5} /></button>
                                    </div>
                                    <p className="text-[9px] font-bold text-[#0052CC] mt-2 ml-1 flex items-center gap-1"><ShieldCheck size={12} /> Solo números — codificado vía SHA-256 para el carnet.</p>

                                    {/* PIN derivado del código (se recalcula en vivo al escribir) */}
                                    {formData.kiosk_pin && (
                                        <div className="mt-3 animate-in fade-in">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">PIN del Carné (SHA-256)</label>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-[40px] bg-slate-800 rounded-[1rem] flex items-center justify-center px-4 text-[14px] font-black tracking-[0.3em] text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] select-all">
                                                    {formData.kiosk_pin}
                                                </div>
                                                <button type="button"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(formData.kiosk_pin);
                                                            useToastStore.getState().showToast('PIN Copiado', `${formData.kiosk_pin} está en el portapapeles.`, 'success');
                                                        } catch { /* sin permiso de clipboard */ }
                                                    }}
                                                    className="w-10 h-10 shrink-0 flex items-center justify-center bg-white border border-slate-200 rounded-[1rem] text-slate-500 hover:text-[#0052CC] hover:border-[#0052CC]/40 hover:shadow-md transition-all active:scale-[0.97]"
                                                    title="Copiar PIN">
                                                    <Copy size={15} strokeWidth={2.5} />
                                                </button>
                                            </div>
                                            <p className="text-[9px] font-bold text-slate-400 mt-1.5 ml-1">Este es el valor del código de barras del carné.</p>
                                        </div>
                                    )}
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