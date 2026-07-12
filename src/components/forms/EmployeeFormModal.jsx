import React, { useState, useEffect, useMemo } from 'react';
import { User, Users, Briefcase, CreditCard, ShieldCheck, Phone, MapPin, Hash, Building2, Fingerprint, Lock, RefreshCw, AtSign, HeartPulse, Clock, DollarSign, GraduationCap, Camera, AlertCircle, RotateCcw, Trash2, Map as MapIcon, Navigation, AlertTriangle, CheckCircle2, Mail, Copy, Plus, X, Car, Bike, Globe, ShieldAlert, Upload, FileText, Loader2 } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '../../utils/inputStyles';
import { EL_SALVADOR_GEO } from '../../data/elSalvadorGeo';
import { NATIONALITY_OPTIONS } from '../../data/nationalities';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { supabase } from '../../supabaseClient';
import { getStoragePathFromUrl } from '../../utils/storageFiles';
import { GRADO_BASICA_OPTIONS, OTRA_ESPECIALIDAD, isCatalogOther, buildCatalogOptions } from '../../utils/educationCatalogs';
import { getExpiryBadge, getExpiringDocuments, getNextAnnualidadCsspDueDate } from '../../utils/documentExpiry';
import { isDependentAgeOnly, isDependentAgeInvalid, getDependentAge, MIN_DEPENDENT_AGE, MAX_DEPENDENT_AGE } from '../../utils/economicDependents';
import { calcAge, MINOR_AGE } from '../../utils/ageUtils';
import { isValidDUIAlgorithm, maskDui } from '../../utils/duiUtils';

// ============================================================================
// 🚀 CATÁLOGOS Y CONSTANTES
// ============================================================================
// Campos de texto libre que se guardan siempre en mayúscula (información de
// ficha, no credenciales) — email/username/teléfonos/DUI quedan fuera.
const UPPERCASE_FIELDS = new Set(['first_names', 'last_names', 'address', 'emergency_contact_name']);

const GENDER_OPTIONS = [{ value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }];
const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];
const CONTRACT_TYPE_OPTIONS = [{ value: 'INDEFINIDO', label: 'Indefinido (Fijo)' }, { value: 'TEMPORAL', label: 'Temporal' }, { value: 'PRACTICAS', label: 'Prácticas / Aprendizaje' }, { value: 'SERVICIOS', label: 'Servicios Profesionales' }];
// "Prácticas" = Contrato de Aprendizaje (Art. 61-70 CT): igual que Temporal
// tiene fecha de fin obligatoria, pero su base legal no es el Art. 25 (plazo
// fijo) sino el régimen especial de aprendices — por eso NO usa
// TEMPORAL_LEGAL_BASIS_OPTIONS/contract_temporal_reason. Art. 61 exige forma
// escrita + aprobación/inscripción ante el Ministerio de Trabajo; Art. 69 fija
// salario mínimo reducido (50% año 1, 75% año 2, 100% desde año 3); Art. 68
// exime de responsabilidad por terminación a ambas partes.
// "Medio Tiempo" ya no es un tipo de contrato — es una configuración de horas
// semanales (ver HOURS_OPTIONS), independiente del tipo de contrato.
const HOURS_OPTIONS = [
    { value: '44', label: 'Tiempo Completo 44h' },
    { value: '22', label: 'Medio Tiempo 22h' },
    { value: 'OTRO', label: 'Otro' },
];
const CATALOG_CATEGORIES = ['BACHILLERATO_TECNICO_ESPECIALIDAD', 'TECNICO_SUPERIOR_ESPECIALIDAD', 'PROFESION_UNIVERSITARIA', 'MAESTRIA_POSTGRADO', 'CURSO_HABILIDAD', 'INSTITUCION_CAPACITACION', 'ENFERMEDAD_CRONICA', 'TIPO_DISCAPACIDAD'];
// weekly_contracted_hours llega como number desde Postgres (integer) pero como
// string mientras se edita en el input — comparar siempre vía String() para
// que "Tiempo Completo 44h"/"Medio Tiempo 22h" se detecten sin importar el tipo.
const isCustomHours = (h) => h !== '' && h !== null && h !== undefined && String(h) !== '44' && String(h) !== '22';
// Sentinel para "Otro" recién elegido, antes de teclear un número — igual
// patrón que OTRA_ESPECIALIDAD: si usáramos '' aquí, isCustomHours('') sería
// false (por diseño, para no confundir "vacío" con "personalizado") y el
// select rebotaría de vuelta a "Tiempo Completo 44h" apenas se eligiera Otro.
const OTRO_HOURS_SENTINEL = '__OTRO_HORAS__';
// Tope legal: jornada ordinaria semanal diurna, Art. 161 Código de Trabajo
// (44h; la nocturna es 39h pero no distinguimos turno aquí). Sin mínimo legal
// para tiempo parcial, se deja 1 como piso solo para evitar valores absurdos.
const MIN_WEEKLY_HOURS = 1;
const MAX_WEEKLY_HOURS = 44;
// Art. 25 Código de Trabajo: un contrato a plazo/Temporal SOLO es válido si cae
// en una de estas dos bases legales — no hay una tercera opción por ley. El
// motivo concreto (texto libre) sí es abierto y lo define la empresa caso por
// caso, pero la base legal es un catálogo cerrado.
const TEMPORAL_LEGAL_BASIS_OPTIONS = [
    { value: 'TRANSITORIO_EVENTUAL', label: 'Labor transitoria, temporal o eventual por su naturaleza (Art. 25 lit. a)' },
    { value: 'TERMINACION_NEGOCIO', label: 'Circunstancia que terminará el negocio total o parcial (Art. 25 lit. b)' },
];
// Art. 28: hasta 30 días de prueba desde que inicia labores (fecha de
// contratación). Si se recontrata a la misma persona antes de 1 año, no puede
// volver a estipularse período de prueba.
const PROBATION_DAYS = 30;
const PROBATION_EXEMPTION_DAYS = 365;
// Documentación del expediente — slots siempre visibles (CV, Contrato, DUI
// frente/reverso). El resto son condicionales según lo marcado en Personal:
// Licencia de Moto/Carro solo si se activó "Posee Licencia" respectiva; el
// carné JVPQF (Regente/Químico Farmacéutico) y su "Contrato de Regencia" se
// muestran si el Cargo o la Profesión indican Regente/Químico Farmacéutico
// (o si se activa el checkbox manual, que queda como override); el carné de
// Enfermería (JVPE) se muestra si el Cargo o la Profesión contienen
// "enfermer". Carné y Anualidad son slots SEPARADOS a propósito: el carné es
// la tarjeta física (se reemite rara vez — pérdida/deterioro/cambio de
// categoría), la anualidad es el pago recurrente cada año calendario que
// mantiene la autorización solvente (puede acumularse mora de varios años sin
// que el carné físico cambie) — ver reference_sv_pharma_health_regulations
// (memoria) para el porqué de JVPQF/JVPE, la distinción con la SRS (que
// regula el establecimiento, no al profesional) y la corrección 2026-07-06
// sobre carné≠anualidad. El resto de documentos usa la lista abierta
// "+ Agregar Documento" (categoría EXTRA_<ts>).
const FIXED_DOCUMENT_CATEGORIES = [
    { key: 'CV', label: 'Currículum Vitae (CV)' },
    { key: 'CONTRATO', label: 'Contrato de Trabajo Firmado' },
];
// El documento de identidad (DUI frente/reverso para adultos, o el documento
// alterno para menores — Art. 23.2) se renderiza aparte del resto, en un
// único bloque agrupado, para que quede claro que son partes del MISMO
// documento y no archivos independientes.
const ALT_ID_DOCUMENT_TYPE_OPTIONS = [
    { value: 'PARTIDA_NACIMIENTO', label: 'Partida de Nacimiento' },
    { value: 'CARNET_MINORIDAD', label: 'Carné de Minoridad' },
    { value: 'PASAPORTE', label: 'Pasaporte' },
    { value: OTRA_ESPECIALIDAD, label: 'Otro documento legal...' },
];
// Compartido entre "Avisar a" (Ficha Médica) y Personas Dependientes.
const PARENTESCO_OPTIONS = [
    { value: 'CONYUGE', label: 'Cónyuge / Pareja' },
    { value: 'HIJO_A', label: 'Hijo/a' },
    { value: 'PADRE', label: 'Padre' },
    { value: 'MADRE', label: 'Madre' },
    { value: 'HERMANO_A', label: 'Hermano/a' },
    { value: 'ABUELO_A', label: 'Abuelo/a' },
    { value: 'NIETO_A', label: 'Nieto/a' },
    { value: 'SUEGRO_A', label: 'Suegro/a' },
    { value: 'CUNADO_A', label: 'Cuñado/a' },
    { value: 'TIO_A', label: 'Tío/a' },
    { value: 'SOBRINO_A', label: 'Sobrino/a' },
    { value: 'PRIMO_A', label: 'Primo/a' },
    { value: 'OTRO', label: 'Otro' },
];
// Escala de 3 niveles usada en El Salvador (ISRI / Encuesta Nacional de Salud) para
// clasificar severidad de discapacidad — no es un catálogo abierto, es una escala fija.
const DISABILITY_GRADE_OPTIONS = [
    { value: 'LEVE', label: 'Leve' },
    { value: 'MODERADA', label: 'Moderada' },
    { value: 'SEVERA', label: 'Severa' },
];
// "Universitario" ya no distingue Estudiante/Graduado como niveles separados
// — eso lo define el toggle "¿Actualmente estudiando?" de abajo. Maestría /
// Postgrado tampoco es un nivel aparte: requiere estudio universitario previo,
// así que es un complemento ("¿Tiene Maestría / Postgrado?") que solo aparece
// dentro de Universitario, no un Nivel Académico independiente.
const EDUCATION_OPTIONS = [
    { value: 'BASICA', label: 'Educación Básica' },
    { value: 'BACHILLERATO_GENERAL', label: 'Bachillerato General' },
    { value: 'BACHILLERATO_TECNICO', label: 'Bachillerato Técnico' },
    { value: 'TECNICO_SUPERIOR', label: 'Técnico Superior' },
    { value: 'UNIVERSITARIO', label: 'Universitario' },
];
// Niveles donde el select de Especialidad aplica
const LEVELS_WITH_SPECIALTY = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR'];
// Niveles donde "¿Actualmente estudiando?" siempre se muestra
const LEVELS_WITH_STUDY_TOGGLE = ['BACHILLERATO_TECNICO', 'TECNICO_SUPERIOR', 'UNIVERSITARIO'];
// Niveles donde el campo Profesión/Título se muestra — Bachillerato Técnico y
// Técnico Superior quedan fuera: su "título" ya es la especialidad de arriba,
// no una profesión aparte.
const LEVELS_WITH_PROFESSION = ['UNIVERSITARIO'];

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

// Rango laboral válido: 16-90 (calcAge compartido en utils/ageUtils.js).
const MIN_WORK_AGE = 16;
const MAX_WORK_AGE = 90;

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
    if (type === 'DUI') return maskDui(value);
    let v = value.replace(/\D/g, '');
    if (type === 'PHONE') {
        if (v.length > 4) return `${v.substring(0, 4)}-${v.substring(4, 8)}`;
        return v;
    }
    if (type === 'ISSS' && v.length > 9) return v.substring(0, 9);
    if (type === 'AFP' && v.length > 12) return v.substring(0, 12);
    return v;
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

const EmployeeFormModal = ({ formData, setFormData, branches, roles, isEditMode = false, activeTab: activeTabProp, onValidationChange }) => {

    const employees = useStaffStore(state => state.employees);
    const [localActiveTab, setLocalActiveTab] = useState('personal');
    const activeTab = activeTabProp !== undefined ? activeTabProp : localActiveTab;
    const [hasDraft, setHasDraft] = useState(false);

    // Especialidades/profesiones viven en education_catalog_entries — se
    // traen una vez al abrir el modal; "Otra..." agrega filas nuevas ahí
    // (employeeSlice.js) y quedan disponibles como opción real de inmediato.
    const [educationCatalog, setEducationCatalog] = useState(() => Object.fromEntries(CATALOG_CATEGORIES.map(c => [c, []])));
    useEffect(() => {
        let cancelled = false;
        supabase.from('education_catalog_entries').select('category, value').order('value').then(({ data }) => {
            if (cancelled || !data) return;
            const grouped = Object.fromEntries(CATALOG_CATEGORIES.map(c => [c, []]));
            for (const row of data) { if (grouped[row.category]) grouped[row.category].push(row.value); }
            setEducationCatalog(grouped);
        });
        return () => { cancelled = true; };
    }, []);

    // Art. 28: si esta persona tiene una baja (TERMINATION) a menos de 1 año de
    // la fecha de contratación actual, no puede volver a estipularse período de
    // prueba — solo se necesita el evento más reciente para saberlo.
    const [lastTermination, setLastTermination] = useState(null);
    useEffect(() => {
        if (!isEditMode || !formData?.id) { setLastTermination(null); return; }
        let cancelled = false;
        supabase.from('employee_events').select('date')
            .eq('employee_id', formData.id).eq('type', 'TERMINATION')
            .order('date', { ascending: false }).limit(1).then(({ data }) => {
                if (!cancelled) setLastTermination(data?.[0] || null);
            });
        return () => { cancelled = true; };
    }, [isEditMode, formData?.id]);

    const probationInfo = useMemo(() => {
        if (!formData?.hire_date) return null;
        const hireDate = new Date(formData.hire_date + 'T00:00:00');
        if (isNaN(hireDate.getTime())) return null;
        if (lastTermination?.date) {
            const termDate = new Date(lastTermination.date + 'T00:00:00');
            const daysSinceTermination = (hireDate - termDate) / 86400000;
            if (daysSinceTermination >= 0 && daysSinceTermination < PROBATION_EXEMPTION_DAYS) {
                return { exempt: true };
            }
        }
        const probationEnd = new Date(hireDate);
        probationEnd.setDate(probationEnd.getDate() + PROBATION_DAYS);
        return { exempt: false, inProbation: new Date() <= probationEnd, probationEnd };
    }, [formData?.hire_date, lastTermination]);

    const bachilleratoTecnicoOptions = useMemo(() => buildCatalogOptions(educationCatalog.BACHILLERATO_TECNICO_ESPECIALIDAD, 'Otra especialidad...'), [educationCatalog]);
    const tecnicoSuperiorOptions = useMemo(() => buildCatalogOptions(educationCatalog.TECNICO_SUPERIOR_ESPECIALIDAD, 'Otra especialidad...'), [educationCatalog]);
    const profesionesUniversitariasOptions = useMemo(() => buildCatalogOptions(educationCatalog.PROFESION_UNIVERSITARIA, 'Otra profesión...'), [educationCatalog]);
    const maestriaPostgradoOptions = useMemo(() => buildCatalogOptions(educationCatalog.MAESTRIA_POSTGRADO, 'Otra maestría/postgrado...'), [educationCatalog]);
    const cursoHabilidadOptions = useMemo(() => buildCatalogOptions(educationCatalog.CURSO_HABILIDAD, 'Otro curso/habilidad...'), [educationCatalog]);
    const institucionOptions = useMemo(() => buildCatalogOptions(educationCatalog.INSTITUCION_CAPACITACION, 'Otra institución...'), [educationCatalog]);
    const enfermedadCronicaOptions = useMemo(() => buildCatalogOptions(educationCatalog.ENFERMEDAD_CRONICA, 'Otra condición médica...'), [educationCatalog]);
    const tipoDiscapacidadOptions = useMemo(() => buildCatalogOptions(educationCatalog.TIPO_DISCAPACIDAD, 'Otro tipo de discapacidad...'), [educationCatalog]);

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
                first_names: '', last_names: '', username: '', phone: '', extra_phones: [], email: '', address: '', extra_addresses: [], dui: '', alt_identity_document: '', alt_identity_document_type: '', birth_date: '', nationality: 'Salvadoreña',
                gender: '', blood_type: '', marital_status: '', emergency_contact_name: '', emergency_contact_phone: '',
                emergency_contact_relationship: '', emergency_contact_extra_phones: [], economic_dependents: [],
                chronic_conditions: [], has_disability: false, disability_type: '', disability_grade: '', disability_has_certification: false,
                has_motorcycle: false, has_car: false, has_motorcycle_license: false, has_car_license: false, has_srs_accreditation: false,
                nursing_license_number: '', pharmacist_license_number: '',
                employee_documents: [],
                department: '', municipality: '', education_level: '', profession: '',
                education_grade_completed: '', education_specialty: '', is_studying: false,
                study_start_date: '', study_duration_years: '', additional_skills: [],
                has_maestria: false, maestria_title: '',
                maestria_is_studying: false, maestria_study_start_date: '', maestria_study_duration_years: '',
                code: String(Math.floor(1000 + Math.random() * 9000)),
                branch_id: prev?.branchId || prev?.branch_id || '', 
                role_id: '', secondary_role_id: '', 
                hire_date: prev?.hireDate || prev?.hire_date || new Date().toISOString().split('T')[0], 
                kiosk_pin: '', photoPreview: null, file: null,
                contract_type: 'INDEFINIDO', contract_start_date: prev?.hireDate || prev?.hire_date || new Date().toISOString().split('T')[0],
                contract_end_date: '', contract_temporal_legal_basis: '', contract_temporal_reason: '', weekly_contracted_hours: '44', base_salary: '',
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
    }, [formData, isEditMode]);

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
        // Documento de identidad (imagen): no bloquea el alta, pero se marca como
        // pendiente si no se pudo completar al crear el expediente.
        const age = calcAge(formData?.birth_date);
        const minor = age !== null && age < MINOR_AGE;
        const docs = formData?.employee_documents || [];
        const hasIdDoc = minor
            ? docs.some(d => d.category === 'DOCUMENTO_IDENTIDAD' && d.url)
            : docs.some(d => d.category === 'DUI_FRENTE' && d.url) && docs.some(d => d.category === 'DUI_REVERSO' && d.url);
        if (!hasIdDoc) items.push('DUI (Documento)');
        // Documentos por vencer/vencidos — cualquier categoría (RTS 11.02.04:24
        // §6.3.1 exige acreditación vigente para TODO el personal, no solo
        // Regente/Enfermería). No bloquea Guardar (es "Pendiente", no "Requerido").
        getExpiringDocuments(docs).forEach(doc => {
            const label = doc.daysLeft < 0 ? `${doc.title || doc.category}: vencido` : `${doc.title || doc.category}: vence en ${doc.daysLeft} día${doc.daysLeft === 1 ? '' : 's'}`;
            items.push(label);
        });
        return items;
    }, [isEditMode, formData?.dui, formData?.birth_date, formData?.isss_number, formData?.afp_number, formData?.employee_documents]);

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
        // formData.kiosk_pin queda fuera a propósito: el guard `pin !== formData.kiosk_pin`
        // ya evita bucles, pero incluirlo dispararía el efecto también cuando ESTE mismo
        // efecto acaba de escribirlo — solo debe re-derivar el pin cuando cambia el code.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            if (name === 'has_disability' && !value) {
                newData.disability_type = '';
                newData.disability_grade = '';
                newData.disability_has_certification = false;
            }
            if (name === 'contract_type' && value !== 'TEMPORAL' && value !== 'PRACTICAS') {
                newData.contract_end_date = '';
            }
            if (name === 'contract_type' && value !== 'TEMPORAL') {
                newData.contract_temporal_legal_basis = '';
                newData.contract_temporal_reason = '';
            }
            if (name === 'education_level') {
                newData.education_grade_completed = '';
                newData.education_specialty = '';
                if (!LEVELS_WITH_PROFESSION.includes(value)) newData.profession = '';
                if (!LEVELS_WITH_STUDY_TOGGLE.includes(value)) {
                    newData.is_studying = false;
                    newData.study_start_date = '';
                    newData.study_duration_years = '';
                }
                // Maestría/Postgrado solo tiene sentido sobre estudio universitario
                if (value !== 'UNIVERSITARIO') {
                    newData.has_maestria = false;
                    newData.maestria_title = '';
                    newData.maestria_is_studying = false;
                    newData.maestria_study_start_date = '';
                    newData.maestria_study_duration_years = '';
                }
            }
            // "¿Actualmente estudiando?" (Universitario) y "¿Tiene Maestría?" son mutuamente
            // excluyentes: tener maestría implica que la licenciatura ya finalizó, y seguir
            // cursando la licenciatura implica que la maestría todavía no aplica. Activar
            // uno apaga y oculta el otro.
            if (name === 'has_maestria') {
                if (value) {
                    newData.is_studying = false;
                    newData.study_start_date = '';
                    newData.study_duration_years = '';
                } else {
                    newData.maestria_title = '';
                    newData.maestria_is_studying = false;
                    newData.maestria_study_start_date = '';
                    newData.maestria_study_duration_years = '';
                }
            }
            if (name === 'is_studying') {
                if (value) {
                    newData.has_maestria = false;
                    newData.maestria_title = '';
                    newData.maestria_is_studying = false;
                    newData.maestria_study_start_date = '';
                    newData.maestria_study_duration_years = '';
                } else {
                    newData.study_start_date = '';
                    newData.study_duration_years = '';
                }
            }
            if (name === 'maestria_is_studying' && !value) {
                newData.maestria_study_start_date = '';
                newData.maestria_study_duration_years = '';
            }
            return newData;
        });
    };

    // Horas Semanales: 44/22 se guardan directo; "Otro" solo cambia el modo de
    // UI (deriva de si weekly_contracted_hours ya es un valor distinto de 44/22,
    // sin estado interno propio) y limpia el campo para que el usuario tecleé.
    const handleHoursModeChange = (mode) => {
        setFormData(prev => ({
            ...prev,
            weekly_contracted_hours: mode === 'OTRO' ? (isCustomHours(prev.weekly_contracted_hours) ? prev.weekly_contracted_hours : OTRO_HOURS_SENTINEL) : mode,
        }));
    };

    const handleStudyDateChange = (part, value) => {
        setFormData(prev => {
            const [y, m] = (prev.study_start_date || `${CURRENT_YEAR}-01`).split('-');
            const newY = part === 'year' ? value : y;
            const newM = part === 'month' ? value : m;
            return { ...prev, study_start_date: `${newY}-${newM}-01` };
        });
    };

    const handleMaestriaStudyDateChange = (part, value) => {
        setFormData(prev => {
            const [y, m] = (prev.maestria_study_start_date || `${CURRENT_YEAR}-01`).split('-');
            const newY = part === 'year' ? value : y;
            const newM = part === 'month' ? value : m;
            return { ...prev, maestria_study_start_date: `${newY}-${newM}-01` };
        });
    };

    const calcEstimatedEnd = (startDate, durationYears) => {
        if (!startDate || !durationYears) return null;
        const [y, m] = startDate.split('-').map(Number);
        const totalMonths = (m - 1) + Math.round(Number(durationYears) * 12);
        const endYear = y + Math.floor(totalMonths / 12);
        const endMonth = ((totalMonths % 12) + 12) % 12;
        return { date: new Date(endYear, endMonth, 1), label: `${MESES[endMonth]} ${endYear}` };
    };

    const estimatedStudyEndDate = useMemo(
        () => calcEstimatedEnd(formData?.study_start_date, formData?.study_duration_years),
        [formData?.study_start_date, formData?.study_duration_years]
    );

    const estimatedStudyEnd = estimatedStudyEndDate?.label || null;
    // No es real seguir "actualmente estudiando" si la fecha estimada de fin ya pasó.
    const studyEndInPast = !!formData?.is_studying && !!estimatedStudyEndDate && estimatedStudyEndDate.date < new Date();

    const estimatedMaestriaEndDate = useMemo(
        () => calcEstimatedEnd(formData?.maestria_study_start_date, formData?.maestria_study_duration_years),
        [formData?.maestria_study_start_date, formData?.maestria_study_duration_years]
    );

    const estimatedMaestriaEnd = estimatedMaestriaEndDate?.label || null;
    const maestriaStudyEndInPast = !!formData?.maestria_is_studying && !!estimatedMaestriaEndDate && estimatedMaestriaEndDate.date < new Date();

    const addSkill = () => setFormData(prev => ({ ...prev, additional_skills: [...(prev.additional_skills || []), { skill: '', institution: '', hours: '' }] }));
    const updateSkill = (idx, field, value) => setFormData(prev => {
        const arr = [...(prev.additional_skills || [])];
        arr[idx] = { ...(arr[idx] || {}), [field]: value };
        return { ...prev, additional_skills: arr };
    });
    const removeSkill = (idx) => setFormData(prev => ({ ...prev, additional_skills: (prev.additional_skills || []).filter((_, i) => i !== idx) }));

    const addEmergencyPhone = () => setFormData(prev => ({ ...prev, emergency_contact_extra_phones: [...(prev.emergency_contact_extra_phones || []), ''] }));
    const updateEmergencyPhone = (idx, value) => setFormData(prev => {
        const arr = [...(prev.emergency_contact_extra_phones || [])]; arr[idx] = applyMask(value, 'PHONE'); return { ...prev, emergency_contact_extra_phones: arr };
    });
    const removeEmergencyPhone = (idx) => setFormData(prev => ({ ...prev, emergency_contact_extra_phones: (prev.emergency_contact_extra_phones || []).filter((_, i) => i !== idx) }));

    // Un empleado puede tener varias enfermedades crónicas simultáneas — lista libre,
    // cada entrada es su propio catálogo con fallback "Otra...".
    const addChronicCondition = () => setFormData(prev => ({ ...prev, chronic_conditions: [...(prev.chronic_conditions || []), ''] }));
    const updateChronicCondition = (idx, value) => setFormData(prev => {
        const arr = [...(prev.chronic_conditions || [])];
        arr[idx] = value;
        return { ...prev, chronic_conditions: arr };
    });
    const removeChronicCondition = (idx) => setFormData(prev => ({ ...prev, chronic_conditions: (prev.chronic_conditions || []).filter((_, i) => i !== idx) }));

    const addDependent = () => setFormData(prev => ({ ...prev, economic_dependents: [...(prev.economic_dependents || []), { name: '', birth_date: '', age: '', age_only: false, relationship: '', address: '', department: '', municipality: '' }] }));
    const updateDependent = (idx, field, value) => setFormData(prev => {
        const arr = [...(prev.economic_dependents || [])];
        const val = (field === 'name' || field === 'address') ? value.toUpperCase() : value;
        const entry = { ...(arr[idx] || {}), [field]: val };
        if (field === 'department') entry.municipality = '';
        arr[idx] = entry;
        return { ...prev, economic_dependents: arr };
    });
    // Toggle entre fecha de nacimiento exacta y solo edad estimada (cuando no se conoce la fecha).
    const toggleDependentAgeMode = (idx) => setFormData(prev => {
        const arr = [...(prev.economic_dependents || [])];
        const cur = arr[idx];
        if (!cur) return prev;
        const nextAgeOnly = !isDependentAgeOnly(cur);
        arr[idx] = { ...cur, age_only: nextAgeOnly, birth_date: nextAgeOnly ? '' : cur.birth_date, age: nextAgeOnly ? cur.age : '' };
        return { ...prev, economic_dependents: arr };
    });
    const removeDependent = (idx) => setFormData(prev => ({ ...prev, economic_dependents: (prev.economic_dependents || []).filter((_, i) => i !== idx) }));
    // Copia dirección del empleado o de otro dependiente ya cargado (mismo hogar) — evita re-teclear.
    const copyDependentAddress = (idx, sourceKey) => setFormData(prev => {
        const arr = [...(prev.economic_dependents || [])];
        let source = null;
        if (sourceKey === 'employee') {
            source = { address: prev.address || '', department: prev.department || '', municipality: prev.municipality || '' };
        } else if (sourceKey?.startsWith('dep-')) {
            const dep = arr[parseInt(sourceKey.slice(4), 10)];
            if (dep) source = { address: dep.address || '', department: dep.department || '', municipality: dep.municipality || '' };
        }
        if (!source || !arr[idx]) return prev;
        arr[idx] = { ...arr[idx], ...source };
        return { ...prev, economic_dependents: arr };
    });

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

    // Documentación: slots fijos + lista abierta "Otros Documentos". El archivo
    // se sube al bucket privado 'documents' EN EL MOMENTO de elegirlo (no se
    // espera a Guardar) y se manda de inmediato al edge function
    // analyze-document (mismo motor IA del expediente de sucursal) para leer la
    // fecha de vencimiento impresa en el propio documento — así el campo se
    // autocompleta sin tener que reabrir la ficha. Solo se pisa si el usuario
    // no había tecleado una fecha a mano.
    const selectedRoleName = roles?.find(r => String(r.id) === String(formData.role_id))?.name || '';
    // Enfermería: por Cargo (como antes) O por Profesión — cubre tanto al
    // "Regente de Enfermeria" (cargo) como a cualquier empleado cuya profesión
    // universitaria sea "Licenciatura en Enfermería" aunque su cargo no lo diga.
    const isNursingRole = /enfermer/i.test(selectedRoleName);
    const isNursingProfession = /enfermer/i.test(formData.profession || '');
    const isNursing = isNursingRole || isNursingProfession;
    // Regente/Químico Farmacéutico: por Cargo "Regente" (excluyendo "Regente de
    // Enfermeria", que es otra profesión) O por Profesión "Química y Farmacia"
    // (catálogo: "Doctorado en Química y Farmacia" — no confundir con
    // "Ingeniería Química", que no habilita para regentar). El checkbox manual
    // has_srs_accreditation se conserva como override para casos no cubiertos
    // por cargo/profesión.
    const isPharmacistRegentRole = /regente/i.test(selectedRoleName) && !/enfermer/i.test(selectedRoleName);
    const isPharmacistProfession = /qu[ií]mic.*farmac|farmac.*qu[ií]mic/i.test(formData.profession || '');
    const isPharmacistRegent = isPharmacistRegentRole || isPharmacistProfession || !!formData.has_srs_accreditation;
    const documentCategories = useMemo(() => [
        ...FIXED_DOCUMENT_CATEGORIES,
        ...(formData.has_motorcycle_license ? [{ key: 'LICENCIA_MOTO', label: 'Licencia de Motocicleta' }] : []),
        ...(formData.has_car_license ? [{ key: 'LICENCIA_CARRO', label: 'Licencia de Automóvil' }] : []),
        ...(isPharmacistRegent ? [{ key: 'SRS', label: 'Carné JVPQF — Regente / Químico Farmacéutico' }] : []),
        ...(isPharmacistRegent ? [{ key: 'ANUALIDAD_JVPQF', label: 'Anualidad JVPQF — solvencia del año en curso' }] : []),
        ...(isPharmacistRegent ? [{ key: 'CONTRATO_REGENCIA', label: 'Contrato de Regencia' }] : []),
        ...(isNursing ? [{ key: 'ENFERMERIA', label: 'Carné de Enfermería — JVPE' }] : []),
        ...(isNursing ? [{ key: 'ANUALIDAD_JVPE', label: 'Anualidad JVPE — solvencia del año en curso' }] : []),
        ...(formData.disability_has_certification ? [{ key: 'CERTIFICACION_DISCAPACIDAD', label: 'Certificación de Discapacidad — ISRI / CONAIPD' }] : []),
    ], [formData.has_motorcycle_license, formData.has_car_license, isPharmacistRegent, isNursing, formData.disability_has_certification]);

    const uploadFileToStorage = useStaffStore(state => state.uploadFileToStorage);
    const [analyzingDocs, setAnalyzingDocs] = useState({});

    const getDocEntry = (category) => (formData.employee_documents || []).find(d => d.category === category)
        || { category, title: documentCategories.find(c => c.key === category)?.label || category, file_name: '', url: null, expiry_date: '' };

    const updateDoc = (category, patch) => setFormData(prev => {
        const list = [...(prev.employee_documents || [])];
        const idx = list.findIndex(d => d.category === category);
        const base = idx >= 0 ? list[idx] : { category, title: documentCategories.find(c => c.key === category)?.label || category, file_name: '', url: null, expiry_date: '' };
        const updated = { ...base, ...patch };
        if (idx >= 0) list[idx] = updated; else list.push(updated);
        return { ...prev, employee_documents: list };
    });

    const handleDocFileChange = async (category, e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        updateDoc(category, { file_name: file.name, url: null });
        setAnalyzingDocs(prev => ({ ...prev, [category]: true }));
        try {
            const folder = formData?.id ? `employees/${formData.id}/documents` : 'employee-documents/unassigned';
            const url = await uploadFileToStorage(file, 'documents', folder);
            if (!url) throw new Error('La subida no devolvió una URL.');
            const stored = getStoragePathFromUrl(url);
            let expiryDate = getDocEntry(category).expiry_date || null;
            if (stored) {
                const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-document', {
                    body: { filePath: stored.path, bucketName: stored.bucket }
                });
                if (!aiError && aiResponse?.success && aiResponse.aiData?.expDate && !expiryDate) {
                    expiryDate = aiResponse.aiData.expDate;
                }
            }
            // Anualidad JVPQF/JVPE: fecha límite fija del CSSP (31 de marzo, igual para
            // todos los profesionales de salud inscritos, ver reference_sv_pharma_health_regulations)
            // — se autocompleta solo si no hay fecha ya escrita a mano ni detectada por IA en el recibo.
            if (!expiryDate && (category === 'ANUALIDAD_JVPQF' || category === 'ANUALIDAD_JVPE')) {
                expiryDate = getNextAnnualidadCsspDueDate();
            }
            updateDoc(category, { url, file_name: file.name, expiry_date: expiryDate });
        } catch (err) {
            useToastStore.getState().showToast('Error al subir documento', err.message || 'Intenta de nuevo.', 'error');
            updateDoc(category, { url: null, file_name: '' });
        } finally {
            setAnalyzingDocs(prev => ({ ...prev, [category]: false }));
        }
    };

    const removeDocFile = (category) => updateDoc(category, { url: null, file_name: '' });

    const extraDocs = (formData.employee_documents || []).filter(d => d.category?.startsWith('EXTRA_'));
    const addExtraDoc = () => setFormData(prev => ({ ...prev, employee_documents: [...(prev.employee_documents || []), { category: `EXTRA_${Date.now()}`, title: '', file_name: '', url: null, expiry_date: '' }] }));
    const removeExtraDoc = (category) => setFormData(prev => ({ ...prev, employee_documents: (prev.employee_documents || []).filter(d => d.category !== category) }));

    // Aviso visual de vencimiento — la fecha puede venir tecleada a mano o
    // detectada por IA (analyze-document, se completa recién al Guardar y se
    // ve al reabrir el expediente). Umbrales y cálculo en utils/documentExpiry
    // (compartido con StaffManagementView para no duplicar umbrales).

    // Bloque de subida reutilizado por los slots fijos, el documento de
    // identidad (DUI/alterno) y "Otros Documentos" — mismo estado
    // analizando/cargado/vacío y mismo campo de vencimiento opcional.
    const renderDocUploadArea = (category, { showExpiry = true } = {}) => {
        const doc = getDocEntry(category);
        const isAnalyzing = !!analyzingDocs[category];
        const hasFile = !!doc.url;
        const expiryBadge = getExpiryBadge(doc.expiry_date);
        return (
            <>
                {isAnalyzing ? (
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-[#0052CC]/30 h-[40px] px-3">
                        <Loader2 size={14} className="text-[#0052CC] shrink-0 animate-spin" />
                        <span className="text-[12px] font-bold text-[#0052CC] truncate flex-1">Subiendo y analizando con IA…</span>
                    </div>
                ) : hasFile ? (
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/80 h-[40px] px-3">
                        <FileText size={14} className="text-[#0052CC] shrink-0" />
                        <span className="text-[12px] font-bold text-slate-700 truncate flex-1">{doc.file_name || 'Documento cargado'}</span>
                        <button type="button" onClick={() => removeDocFile(category)} title="Quitar" className="text-slate-400 hover:text-red-500 shrink-0"><X size={14} /></button>
                    </div>
                ) : (
                    <label className="flex items-center justify-center gap-2 h-[40px] rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-[#0052CC]/40 hover:text-[#0052CC] cursor-pointer transition-colors">
                        <Upload size={14} /> <span className="text-[11px] font-bold">Subir archivo</span>
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleDocFileChange(category, e)} />
                    </label>
                )}
                {showExpiry && hasFile && !isAnalyzing && (
                    <div className="mt-2">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1 flex items-center justify-between">
                            <span>Fecha de Vencimiento (opcional) — detectada por IA si el documento la trae</span>
                            {expiryBadge && <span className={`ml-1 shrink-0 px-1.5 py-0.5 rounded-md border font-black normal-case tracking-normal ${expiryBadge.className}`}>{expiryBadge.label}</span>}
                        </label>
                        <div className="bg-white rounded-xl border border-slate-200/80 h-[36px] flex items-center px-1.5">
                            <LiquidDatePicker value={doc.expiry_date} onChange={(date) => updateDoc(category, { expiry_date: date })} placeholder="Sin vencimiento" />
                        </div>
                    </div>
                )}
            </>
        );
    };

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

    const salaryInvalid = formData?.base_salary !== '' && formData?.base_salary !== undefined && formData?.base_salary !== null && !(Number(formData.base_salary) > 0);
    const hoursMode = isCustomHours(formData?.weekly_contracted_hours) ? 'OTRO' : String(formData?.weekly_contracted_hours || '44');
    const customHoursNum = Number(formData?.weekly_contracted_hours);
    const hoursInvalid = hoursMode === 'OTRO' && (formData?.weekly_contracted_hours === '' || isNaN(customHoursNum) || customHoursNum < MIN_WEEKLY_HOURS || customHoursNum > MAX_WEEKLY_HOURS);
    const contractHasEndDate = formData?.contract_type === 'TEMPORAL' || formData?.contract_type === 'PRACTICAS';
    const contractDatesInvalid = contractHasEndDate && !!formData?.contract_start_date && !!formData?.contract_end_date
        && new Date(`${formData.contract_end_date}T00:00:00`) <= new Date(`${formData.contract_start_date}T00:00:00`);
    // Art. 25/23.4: un contrato a plazo sin la base legal + motivo documentados
    // queda sin respaldo si se disputa — la ley presume indefinido cualquier
    // labor permanente, así que el plazo necesita justificación por escrito.
    const temporalBasisMissing = formData?.contract_type === 'TEMPORAL' && !formData?.contract_temporal_legal_basis;
    const temporalReasonMissing = formData?.contract_type === 'TEMPORAL' && !formData?.contract_temporal_reason?.trim();

    const employeeAge = calcAge(formData?.birth_date);
    const birthDateInFuture = !!formData?.birth_date && new Date(formData.birth_date + 'T00:00:00') > new Date();
    const birthDateOutOfRange = employeeAge !== null && (employeeAge < MIN_WORK_AGE || employeeAge > MAX_WORK_AGE);
    const birthDateInvalid = birthDateInFuture || birthDateOutOfRange;
    const birthDateErrorMsg = birthDateInFuture ? 'Fecha futura' : birthDateOutOfRange ? `Edad debe ser ${MIN_WORK_AGE}-${MAX_WORK_AGE}` : null;
    // Menor de edad (16-17): en El Salvador el DUI se tramita hasta los 18, así
    // que Art. 23.2 permite sustituirlo por "cualquier documento fehaciente"
    // (partida de nacimiento, carné de minoridad). También aplican Art. 116-117:
    // prohibido el trabajo nocturno y examen médico previo obligatorio.
    const isMinor = employeeAge !== null && employeeAge < MINOR_AGE;
    const altIdMissing = isMinor && !formData?.alt_identity_document?.trim();

    // Validez integral del formulario: cualquier campo marcado en rojo en
    // CUALQUIER pestaña (no solo la que está visible) bloquea Guardar — a
    // pedido explícito del usuario, tras notar que el botón aparecía habilitado
    // con el DUI vacío marcado "Requerido". Se reporta al padre (UnifiedModal)
    // vía onValidationChange, igual que ya hace FormNovedad con isFormValid.
    const isFormFullyValid = useMemo(() => {
        if (!formData?.first_names?.trim() || firstNamesInvalid) return false;
        if (!formData?.last_names?.trim() || lastNamesInvalid) return false;

        if (isMinor) {
            if (altIdMissing) return false;
        } else if (!formData?.dui?.trim() || isDuiInvalid || isDuiDuplicate || isDuiIncomplete) {
            return false;
        }
        if (birthDateInvalid) return false;

        if (!formData?.gender) return false;
        if (!formData?.marital_status) return false;
        if (formData?.department && !formData?.municipality) return false;
        for (const addr of (formData?.extra_addresses || [])) {
            if (addr.department && !addr.municipality) return false;
        }

        if (phoneHasError) return false;
        for (const ph of (formData?.extra_phones || [])) {
            const dLen = digitsLen(ph);
            if (!!ph && dLen > 0 && (dLen < 8 || !isValidSVPhone(ph))) return false;
        }
        if (emailInvalid) return false;

        if (formData?.education_level === 'BASICA' && !formData?.education_grade_completed) return false;
        if (LEVELS_WITH_SPECIALTY.includes(formData?.education_level)
            && (!formData?.education_specialty || formData.education_specialty === OTRA_ESPECIALIDAD)) return false;
        if (LEVELS_WITH_PROFESSION.includes(formData?.education_level)
            && (!formData?.profession || formData.profession === OTRA_ESPECIALIDAD)) return false;
        if (formData?.education_level === 'UNIVERSITARIO' && !formData?.is_studying && formData?.has_maestria
            && (!formData?.maestria_title || formData.maestria_title === OTRA_ESPECIALIDAD)) return false;
        if (studyEndInPast || maestriaStudyEndInPast) return false;

        for (const dep of (formData?.economic_dependents || [])) {
            if (isDependentAgeInvalid(dep)) return false;
        }

        if (formData?.has_disability && (!formData?.disability_type || formData.disability_type === OTRA_ESPECIALIDAD || !formData?.disability_grade)) return false;

        if (!formData?.branch_id) return false;
        if (!formData?.role_id) return false;

        if (salaryInvalid) return false;
        if (hoursInvalid) return false;
        if (contractDatesInvalid) return false;
        if (temporalBasisMissing || temporalReasonMissing) return false;

        if (isssIncomplete) return false;
        if (afpIncomplete) return false;

        if (!formData?.code?.trim()) return false;

        return true;
    }, [
        formData?.first_names, formData?.last_names, firstNamesInvalid, lastNamesInvalid,
        isMinor, altIdMissing, formData?.dui, isDuiInvalid, isDuiDuplicate, isDuiIncomplete,
        birthDateInvalid, formData?.gender, formData?.marital_status,
        formData?.department, formData?.municipality, formData?.extra_addresses,
        phoneHasError, formData?.extra_phones, emailInvalid,
        formData?.education_level, formData?.education_grade_completed, formData?.education_specialty,
        formData?.profession, formData?.is_studying, formData?.has_maestria, formData?.maestria_title,
        studyEndInPast, maestriaStudyEndInPast, formData?.economic_dependents,
        formData?.has_disability, formData?.disability_type, formData?.disability_grade,
        formData?.branch_id, formData?.role_id,
        salaryInvalid, hoursInvalid, contractDatesInvalid, temporalBasisMissing, temporalReasonMissing,
        isssIncomplete, afpIncomplete, formData?.code,
    ]);

    useEffect(() => {
        onValidationChange?.(isFormFullyValid);
    }, [isFormFullyValid, onValidationChange]);

    // Nombre a mostrar para el tipo de documento elegido en Personal — si el
    // valor no matchea ninguna opción del catálogo, es el texto libre de
    // "Otro documento legal..." tecleado por el usuario, se muestra tal cual.
    const altIdDocTypeLabel = (() => {
        const val = formData?.alt_identity_document_type;
        if (!val || val === OTRA_ESPECIALIDAD) return 'Documento de Identidad';
        return ALT_ID_DOCUMENT_TYPE_OPTIONS.find(o => o.value === val)?.label || val;
    })();

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

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nacionalidad</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.nationality} onChange={(val) => handleSelectChange('nationality', val)} options={NATIONALITY_OPTIONS} placeholder="Nacionalidad..." icon={Globe} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                <div className="relative z-30">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Fecha de Nacimiento {employeeAge !== null && !birthDateInvalid && <span className={`font-bold normal-case tracking-normal ${isMinor ? 'text-amber-600' : 'text-slate-400'}`}>· {employeeAge} años{isMinor ? ' · Menor de Edad' : ''}</span>}</span>
                                        {birthDateInvalid && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md ml-1">{birthDateErrorMsg}</span>}
                                    </label>
                                    <div className={`bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${birthDateInvalid ? '!border-red-400 !bg-red-50/50' : isMinor ? '!border-amber-300 !bg-amber-50/40' : 'border-slate-200/80'}`}>
                                        <LiquidDatePicker value={formData.birth_date} onChange={(date) => handleDateChange('birth_date', date)} placeholder="Seleccionar Fecha" />
                                    </div>
                                </div>

                                {!isMinor && (
                                    <PortalInput label="DUI" name="dui" value={formData.dui} onChange={handleChange} icon={Fingerprint} placeholder="00000000-0" maskType="DUI" required hasError={isDuiInvalid || isDuiDuplicate || isDuiIncomplete} errorMessage={duiErrorMsg} />
                                )}

                                {isMinor && (
                                    <div className="relative z-20">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Tipo de Documento</label>
                                        <CatalogSelect
                                            value={formData.alt_identity_document_type}
                                            onChange={(val) => handleSelectChange('alt_identity_document_type', val)}
                                            options={ALT_ID_DOCUMENT_TYPE_OPTIONS}
                                            portalSelectProps={portalSelectProps}
                                            inputHoverClass={inputHoverClass}
                                            placeholder="Selecciona el tipo..."
                                        />
                                    </div>
                                )}

                                {isMinor && (
                                    <PortalInput label="Número de Documento" name="alt_identity_document" value={formData.alt_identity_document} onChange={handleChange} icon={Fingerprint} placeholder="Número según el documento elegido" required hasError={altIdMissing} errorMessage="Requerido para menores sin DUI" />
                                )}

                                {isMinor && isCatalogOther(formData.alt_identity_document_type, ALT_ID_DOCUMENT_TYPE_OPTIONS) && (
                                    <div className="md:col-span-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Especifica el Tipo de Documento</label>
                                        <CatalogOtherInput
                                            value={formData.alt_identity_document_type}
                                            onChange={(val) => handleSelectChange('alt_identity_document_type', val)}
                                            inputHoverClass={inputHoverClass}
                                            placeholder="Ej. Carné Consular"
                                        />
                                    </div>
                                )}

                                {isMinor && (
                                    <div className="md:col-span-2 bg-amber-50/70 border border-amber-200/70 rounded-2xl p-3 flex items-start gap-3 animate-in fade-in zoom-in-95">
                                        <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                        <p className="text-[11px] text-amber-700 font-medium leading-tight">
                                            <span className="font-black">Menor de edad (16-17 años).</span> Por Ley (Art. 116-117 Código de Trabajo): prohibido asignar turno nocturno, y requiere examen médico previo gratuito antes de admitirlo (con repetición anual hasta los 18 años). En El Salvador el DUI no se tramita hasta los 18 — por eso se pide un documento alterno (partida de nacimiento, carné de minoridad).
                                        </p>
                                    </div>
                                )}

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
                                            className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
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
                                                            className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
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
                                                                    className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
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

                                {LEVELS_WITH_SPECIALTY.includes(formData.education_level) && (() => {
                                    const specialtyOptions = formData.education_level === 'BACHILLERATO_TECNICO' ? bachilleratoTecnicoOptions : tecnicoSuperiorOptions;
                                    const isOtherSpecialty = isCatalogOther(formData.education_specialty, specialtyOptions);
                                    return (
                                        <>
                                            <div className="relative z-20 animate-in fade-in zoom-in-95 duration-200">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Especialidad</span>
                                                    {!formData.education_specialty && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                </label>
                                                <CatalogSelect
                                                    value={formData.education_specialty}
                                                    onChange={(val) => handleSelectChange('education_specialty', val)}
                                                    options={specialtyOptions}
                                                    portalSelectProps={portalSelectProps}
                                                    inputHoverClass={inputHoverClass}
                                                    hasError={!formData.education_specialty}
                                                    placeholder="Especialidad..."
                                                />
                                            </div>
                                            {isOtherSpecialty && (
                                                <div className="md:col-span-2 animate-in fade-in zoom-in-95 duration-200">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica la Especialidad</span>
                                                        {formData.education_specialty === OTRA_ESPECIALIDAD && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                    </label>
                                                    <CatalogOtherInput
                                                        value={formData.education_specialty}
                                                        onChange={(val) => handleSelectChange('education_specialty', val)}
                                                        inputHoverClass={inputHoverClass}
                                                        hasError={formData.education_specialty === OTRA_ESPECIALIDAD}
                                                        placeholder="Especifica la especialidad"
                                                    />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}

                                {LEVELS_WITH_PROFESSION.includes(formData.education_level) && (() => {
                                    const isOtherProfession = isCatalogOther(formData.profession, profesionesUniversitariasOptions);
                                    return (
                                        <>
                                            <div className="relative z-20 animate-in fade-in zoom-in-95 duration-200">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Profesión / Título</span>
                                                    {!formData.profession && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                </label>
                                                <CatalogSelect
                                                    value={formData.profession}
                                                    onChange={(val) => handleSelectChange('profession', val)}
                                                    options={profesionesUniversitariasOptions}
                                                    portalSelectProps={portalSelectProps}
                                                    inputHoverClass={inputHoverClass}
                                                    hasError={!formData.profession}
                                                    placeholder="Profesión / Título..."
                                                />
                                            </div>
                                            {isOtherProfession && (
                                                <div className="md:col-span-2 animate-in fade-in zoom-in-95 duration-200">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica la Profesión / Título</span>
                                                        {formData.profession === OTRA_ESPECIALIDAD && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                    </label>
                                                    <CatalogOtherInput
                                                        value={formData.profession}
                                                        onChange={(val) => handleSelectChange('profession', val)}
                                                        inputHoverClass={inputHoverClass}
                                                        hasError={formData.profession === OTRA_ESPECIALIDAD}
                                                        placeholder="Ej. Lic. en Farmacia"
                                                    />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}

                                {LEVELS_WITH_STUDY_TOGGLE.includes(formData.education_level) && !(formData.education_level === 'UNIVERSITARIO' && formData.has_maestria) && (
                                    <div className="md:col-span-2 bg-indigo-50/40 rounded-[1.25rem] p-3.5 border border-indigo-100/60 animate-in fade-in zoom-in-95 duration-200">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={!!formData.is_studying} onChange={(e) => handleSelectChange('is_studying', e.target.checked)} className="w-4 h-4 rounded accent-[#0052CC]" />
                                            <span className="text-[11px] font-black text-indigo-700 uppercase tracking-wide">¿Actualmente estudiando?</span>
                                        </label>

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
                                                <PortalInput label="Duración (años)" name="study_duration_years" value={formData.study_duration_years} onChange={handleChange} type="number" placeholder="Ej. 2.5" hasError={studyEndInPast} />
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

                                {formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && (() => {
                                    const isOtherMaestria = isCatalogOther(formData.maestria_title, maestriaPostgradoOptions);
                                    return (
                                        <div className="md:col-span-2 bg-purple-50/40 rounded-[1.25rem] p-3.5 border border-purple-100/60 animate-in fade-in zoom-in-95 duration-200">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={!!formData.has_maestria} onChange={(e) => handleSelectChange('has_maestria', e.target.checked)} className="w-4 h-4 rounded accent-purple-600" />
                                                <span className="text-[11px] font-black text-purple-700 uppercase tracking-wide">¿Tiene Maestría / Postgrado?</span>
                                            </label>
                                            {!!formData.has_maestria && (
                                                <div className="mt-3 grid grid-cols-1 gap-3">
                                                    <div>
                                                        <label className="text-[9px] font-black uppercase tracking-widest text-purple-500 ml-1 mb-1 flex items-center justify-between">
                                                            <span>Maestría / Postgrado</span>
                                                            {!formData.maestria_title && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>}
                                                        </label>
                                                        <CatalogSelect
                                                            value={formData.maestria_title}
                                                            onChange={(val) => handleSelectChange('maestria_title', val)}
                                                            options={maestriaPostgradoOptions}
                                                            portalSelectProps={portalSelectProps}
                                                            inputHoverClass={inputHoverClass}
                                                            hasError={!formData.maestria_title}
                                                            placeholder="Maestría / Postgrado..."
                                                        />
                                                    </div>
                                                    {isOtherMaestria && (
                                                        <div>
                                                            <label className="text-[9px] font-black uppercase tracking-widest text-purple-500 ml-1 mb-1 block">Especifica la Maestría / Postgrado</label>
                                                            <CatalogOtherInput
                                                                value={formData.maestria_title}
                                                                onChange={(val) => handleSelectChange('maestria_title', val)}
                                                                inputHoverClass={inputHoverClass}
                                                                hasError={formData.maestria_title === OTRA_ESPECIALIDAD}
                                                                placeholder="Ej. Maestría en..."
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="pt-2 border-t border-purple-100/60">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input type="checkbox" checked={!!formData.maestria_is_studying} onChange={(e) => handleSelectChange('maestria_is_studying', e.target.checked)} className="w-4 h-4 rounded accent-purple-600" />
                                                            <span className="text-[11px] font-black text-purple-700 uppercase tracking-wide">¿Maestría en curso?</span>
                                                        </label>

                                                        {!!formData.maestria_is_studying && (
                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                                <div>
                                                                    <label className="text-[9px] font-black uppercase tracking-widest text-purple-500 ml-1 mb-1 block">Mes de Inicio</label>
                                                                    <div className="rounded-[1rem] h-[38px]">
                                                                        <LiquidSelect value={formData.maestria_study_start_date ? formData.maestria_study_start_date.split('-')[1] : ''} onChange={(val) => handleMaestriaStudyDateChange('month', val)} options={MONTH_OPTIONS} placeholder="Mes..." compact clearable={false} {...portalSelectProps} />
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <label className="text-[9px] font-black uppercase tracking-widest text-purple-500 ml-1 mb-1 block">Año de Inicio</label>
                                                                    <div className="rounded-[1rem] h-[38px]">
                                                                        <LiquidSelect value={formData.maestria_study_start_date ? formData.maestria_study_start_date.split('-')[0] : ''} onChange={(val) => handleMaestriaStudyDateChange('year', val)} options={YEAR_OPTIONS} placeholder="Año..." compact clearable={false} {...portalSelectProps} />
                                                                    </div>
                                                                </div>
                                                                <PortalInput label="Duración (años)" name="maestria_study_duration_years" value={formData.maestria_study_duration_years} onChange={handleChange} type="number" placeholder="Ej. 2" hasError={maestriaStudyEndInPast} />
                                                            </div>
                                                        )}
                                                        {estimatedMaestriaEnd && (
                                                            <p className={`text-[10px] font-bold mt-2 ml-1 ${maestriaStudyEndInPast ? 'text-red-600' : 'text-purple-600'}`}>
                                                                {maestriaStudyEndInPast
                                                                    ? `Finalizó en ${estimatedMaestriaEnd} — no puede seguir "en curso"`
                                                                    : `Finaliza aprox.: ${estimatedMaestriaEnd}`}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-200/50">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Cursos / Habilidades Adicionales</label>
                                <div className="flex flex-col gap-3">
                                    {(formData.additional_skills || []).map((entry, idx) => {
                                        const isOtherSkill = isCatalogOther(entry.skill, cursoHabilidadOptions);
                                        const isOtherInstitution = isCatalogOther(entry.institution, institucionOptions);
                                        return (
                                            <div key={idx} className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Curso / Habilidad {idx + 1}</span>
                                                    <button type="button" onClick={() => removeSkill(idx)} title="Quitar"
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                        <X size={13} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div className="md:col-span-2">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Curso / Habilidad</label>
                                                        <CatalogSelect value={entry.skill} onChange={(val) => updateSkill(idx, 'skill', val)} options={cursoHabilidadOptions} portalSelectProps={portalSelectProps} inputHoverClass={inputHoverClass} placeholder="Curso/Habilidad..." />
                                                    </div>
                                                    {isOtherSkill && (
                                                        <div className="md:col-span-2">
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Especifica el Curso / Habilidad</label>
                                                            <CatalogOtherInput value={entry.skill} onChange={(val) => updateSkill(idx, 'skill', val)} inputHoverClass={inputHoverClass} placeholder="Especifica el curso o habilidad" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Institución</label>
                                                        <CatalogSelect value={entry.institution} onChange={(val) => updateSkill(idx, 'institution', val)} options={institucionOptions} portalSelectProps={portalSelectProps} inputHoverClass={inputHoverClass} placeholder="Institución..." />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Horas Totales</label>
                                                        <input type="number" min="0" value={entry.hours || ''} onChange={(e) => updateSkill(idx, 'hours', e.target.value)} placeholder="Ej. 40"
                                                            className={`w-full h-[40px] px-4 bg-white border border-slate-200/80 rounded-[1rem] text-[16px] font-bold text-slate-700 outline-none shadow-sm ${inputHoverClass}`} />
                                                    </div>
                                                    {isOtherInstitution && (
                                                        <div className="md:col-span-2">
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Especifica la Institución</label>
                                                            <CatalogOtherInput value={entry.institution} onChange={(val) => updateSkill(idx, 'institution', val)} inputHoverClass={inputHoverClass} placeholder="Especifica la institución" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <button type="button" onClick={addSkill} className="mt-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC] hover:text-blue-700 transition-colors">
                                    <Plus size={12} strokeWidth={3} /> Agregar Curso / Habilidad
                                </button>
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-teal-50 text-teal-600 rounded-[0.8rem] border border-teal-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                                    <Car size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Vehículo y Acreditaciones</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                    <input type="checkbox" checked={!!formData.has_motorcycle} onChange={(e) => handleSelectChange('has_motorcycle', e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                                    <Bike size={15} strokeWidth={2.5} className="text-slate-400" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Posee Moto</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                    <input type="checkbox" checked={!!formData.has_car} onChange={(e) => handleSelectChange('has_car', e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                                    <Car size={15} strokeWidth={2.5} className="text-slate-400" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Posee Carro</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                    <input type="checkbox" checked={!!formData.has_motorcycle_license} onChange={(e) => handleSelectChange('has_motorcycle_license', e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                                    <Bike size={15} strokeWidth={2.5} className="text-slate-400" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Licencia de Motocicleta</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                    <input type="checkbox" checked={!!formData.has_car_license} onChange={(e) => handleSelectChange('has_car_license', e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                                    <Car size={15} strokeWidth={2.5} className="text-slate-400" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Licencia de Automóvil</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 md:col-span-2">
                                    <input type="checkbox" checked={!!formData.has_srs_accreditation} onChange={(e) => handleSelectChange('has_srs_accreditation', e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                                    <ShieldCheck size={15} strokeWidth={2.5} className="text-slate-400" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Carné JVPQF (Regente / Químico Farmacéutico)</span>
                                </label>
                            </div>
                            {(formData.has_motorcycle_license || formData.has_car_license || isPharmacistRegent || isNursing) && (
                                <p className="text-[9px] text-teal-600 font-bold mt-2 ml-1">El documento correspondiente ya está disponible para subir en la pestaña Documentos{(isPharmacistRegent && !formData.has_srs_accreditation) || (isNursing && !isNursingRole) ? ' (detectado automáticamente por Cargo/Profesión)' : ''}.</p>
                            )}
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-cyan-50 text-cyan-600 rounded-[0.8rem] border border-cyan-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                                    <Users size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Personas que Dependen Económicamente</h4>
                            </div>

                            {(formData.economic_dependents || []).length > 0 && (
                                <div className="flex flex-col gap-3 mb-3">
                                    {(formData.economic_dependents || []).map((dep, idx) => {
                                        const depMunicipioOpts = dep.department && EL_SALVADOR_GEO[dep.department]
                                            ? EL_SALVADOR_GEO[dep.department].map(m => ({ value: m, label: m }))
                                            : [];
                                        const depAgeOnly = isDependentAgeOnly(dep);
                                        const depAgeInvalid = isDependentAgeInvalid(dep);
                                        const depAge = depAgeOnly ? getDependentAge(dep) : calcAge(dep.birth_date);
                                        const copyOptions = [
                                            { value: 'employee', label: 'Mi Dirección (Empleado)' },
                                            ...(formData.economic_dependents || [])
                                                .map((d, i) => ({ d, i }))
                                                .filter(({ d, i }) => i !== idx && (d.address || d.department))
                                                .map(({ d, i }) => ({ value: `dep-${i}`, label: `Igual que ${d.name || `Persona ${i + 1}`}` })),
                                        ];
                                        return (
                                            <div key={idx} className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Persona {idx + 1}</span>
                                                    <button type="button" onClick={() => removeDependent(idx)} title="Quitar persona"
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                        <X size={13} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nombre</label>
                                                        <div className={`relative bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                            <div className="absolute left-3 text-slate-400"><User size={14} strokeWidth={2.5} /></div>
                                                            <input type="text" value={dep.name || ''} onChange={(e) => updateDependent(idx, 'name', e.target.value)} placeholder="Nombre completo"
                                                                className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                                                            <span className="flex items-center gap-1.5">
                                                                {depAgeOnly ? 'Edad' : 'Fecha de Nacimiento'}
                                                                {depAgeInvalid && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200 normal-case tracking-normal">{dep.age === '' || dep.age == null ? 'Requerido' : `${MIN_DEPENDENT_AGE}-${MAX_DEPENDENT_AGE}`}</span>}
                                                            </span>
                                                            <button type="button" onClick={() => toggleDependentAgeMode(idx)}
                                                                className="text-[#0052CC] font-bold normal-case tracking-normal hover:text-blue-700 transition-colors">
                                                                {depAgeOnly ? 'Ingresar fecha' : 'No sé la fecha'}
                                                            </button>
                                                        </label>
                                                        {depAgeOnly ? (
                                                            <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${depAgeInvalid ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                                                <input type="number" min={MIN_DEPENDENT_AGE} max={MAX_DEPENDENT_AGE} step="1" value={dep.age ?? ''} onChange={(e) => updateDependent(idx, 'age', e.target.value)} placeholder="Edad en años"
                                                                    className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-4 pr-4" />
                                                            </div>
                                                        ) : (
                                                            <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                                <LiquidDatePicker value={dep.birth_date} onChange={(date) => updateDependent(idx, 'birth_date', date)} placeholder="Seleccionar Fecha" />
                                                            </div>
                                                        )}
                                                        {!depAgeOnly && depAge !== null && <span className="text-slate-400 font-bold text-[10px] ml-1 mt-1 block">· {depAge} años</span>}
                                                    </div>
                                                    <div className="relative z-10">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Parentesco</label>
                                                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                            <LiquidSelect value={dep.relationship} onChange={(val) => updateDependent(idx, 'relationship', val)} options={PARENTESCO_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                                        </div>
                                                    </div>

                                                    <div className="md:col-span-3 flex items-center justify-between -mb-1">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 block">Dirección</label>
                                                        <div className="w-56">
                                                            <LiquidSelect value="" onChange={(val) => copyDependentAddress(idx, val)} options={copyOptions} placeholder="Copiar dirección de..." compact clearable={false} {...portalSelectProps} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Departamento</label>
                                                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                            <LiquidSelect value={dep.department} onChange={(val) => updateDependent(idx, 'department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Distrito</label>
                                                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                            <LiquidSelect value={dep.municipality} onChange={(val) => updateDependent(idx, 'municipality', val)} options={depMunicipioOpts} placeholder={dep.department ? 'Distrito...' : 'Elija Depto.'} disabled={!dep.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Dirección Detallada</label>
                                                        <div className={`relative bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                            <div className="absolute left-3 text-slate-400"><MapPin size={14} strokeWidth={2.5} /></div>
                                                            <input type="text" value={dep.address || ''} onChange={(e) => updateDependent(idx, 'address', e.target.value)} placeholder="Colonia, Calle, Número de Casa..."
                                                                className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <button type="button" onClick={addDependent} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC] hover:text-blue-700 transition-colors">
                                <Plus size={12} strokeWidth={3} /> Agregar Persona
                            </button>
                        </div>

                        <div className={`bg-red-50/50 rounded-[1.5rem] p-4 md:p-5 border border-red-100/50 shadow-[0_8px_30px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md`}>
                            <h4 className="text-[12px] font-black uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2"><HeartPulse size={16} strokeWidth={2.5} /> Ficha Médica y Emergencia</h4>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="relative z-10">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 block">Tipo de Sangre</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.blood_type} onChange={(val) => handleSelectChange('blood_type', val)} options={BLOOD_TYPE_OPTIONS} placeholder="Vital..." clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>
                            </div>

                            <p className="text-[10px] font-black uppercase tracking-widest text-red-400/70 mt-4 mb-3 pt-4 border-t border-red-100/70 flex items-center gap-1.5">
                                <HeartPulse size={12} strokeWidth={2.5} /> Enfermedad Crónica / Condición Médica
                            </p>
                            {(formData.chronic_conditions || []).some(c => c && c !== OTRA_ESPECIALIDAD) && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {(formData.chronic_conditions || []).map((cond, idx) => {
                                        if (!cond || cond === OTRA_ESPECIALIDAD) return null;
                                        return (
                                            <span key={idx} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-white border border-red-200 text-red-600 text-[11px] font-bold shadow-sm animate-in fade-in zoom-in-95 duration-200">
                                                {cond}
                                                <button type="button" onClick={() => removeChronicCondition(idx)} title="Quitar condición"
                                                    className="w-5 h-5 flex items-center justify-center rounded-full text-red-300 hover:text-white hover:bg-red-500 transition-colors">
                                                    <X size={11} strokeWidth={2.5} />
                                                </button>
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                            {(formData.chronic_conditions || []).some(c => !c || c === OTRA_ESPECIALIDAD) && (
                                <div className="flex flex-col gap-2 mb-3">
                                    {(formData.chronic_conditions || []).map((cond, idx) => {
                                        if (cond && cond !== OTRA_ESPECIALIDAD) return null;
                                        const isOtherChronic = isCatalogOther(cond, enfermedadCronicaOptions);
                                        return (
                                            <div key={idx} className="flex items-start gap-2">
                                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    <CatalogSelect
                                                        value={cond}
                                                        onChange={(val) => updateChronicCondition(idx, val)}
                                                        options={enfermedadCronicaOptions}
                                                        portalSelectProps={portalSelectProps}
                                                        inputHoverClass={inputHoverClass}
                                                        placeholder="Seleccionar..."
                                                    />
                                                    {isOtherChronic && (
                                                        <CatalogOtherInput
                                                            value={cond}
                                                            onChange={(val) => updateChronicCondition(idx, val)}
                                                            inputHoverClass={inputHoverClass}
                                                            placeholder="Especifica la enfermedad/condición"
                                                        />
                                                    )}
                                                </div>
                                                <button type="button" onClick={() => removeChronicCondition(idx)} title="Quitar condición"
                                                    className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                    <X size={14} strokeWidth={2.5} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <button type="button" onClick={addChronicCondition} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC] hover:text-blue-700 transition-colors">
                                <Plus size={12} strokeWidth={3} /> Agregar Condición
                            </button>

                            <p className="text-[10px] font-black uppercase tracking-widest text-red-400/70 mt-4 mb-3 pt-4 border-t border-red-100/70 flex items-center gap-1.5">
                                <ShieldCheck size={12} strokeWidth={2.5} /> Discapacidad
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-red-100/70 bg-white/60 md:col-span-3">
                                    <input type="checkbox" checked={!!formData.has_disability} onChange={(e) => handleSelectChange('has_disability', e.target.checked)} className="w-4 h-4 rounded accent-red-500" />
                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">¿Tiene alguna discapacidad?</span>
                                </label>
                                {formData.has_disability && (() => {
                                    const isOtherDisability = isCatalogOther(formData.disability_type, tipoDiscapacidadOptions);
                                    return (
                                        <>
                                            <div className="relative z-10 animate-in fade-in zoom-in-95 duration-200">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Tipo de Discapacidad</span>
                                                    {!formData.disability_type && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200 normal-case tracking-normal">Requerido</span>}
                                                </label>
                                                <CatalogSelect
                                                    value={formData.disability_type}
                                                    onChange={(val) => handleSelectChange('disability_type', val)}
                                                    options={tipoDiscapacidadOptions}
                                                    portalSelectProps={portalSelectProps}
                                                    inputHoverClass={inputHoverClass}
                                                    hasError={!formData.disability_type}
                                                    placeholder="Tipo..."
                                                />
                                            </div>
                                            <div className="relative z-10 animate-in fade-in zoom-in-95 duration-200">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Grado</span>
                                                    {!formData.disability_grade && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200 normal-case tracking-normal">Requerido</span>}
                                                </label>
                                                <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!formData.disability_grade ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                                    <LiquidSelect value={formData.disability_grade} onChange={(val) => handleSelectChange('disability_grade', val)} options={DISABILITY_GRADE_OPTIONS} placeholder="Grado..." clearable={false} {...portalSelectProps} />
                                                </div>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-2xl border border-red-100/70 bg-white/60">
                                                <input type="checkbox" checked={!!formData.disability_has_certification} onChange={(e) => handleSelectChange('disability_has_certification', e.target.checked)} className="w-4 h-4 rounded accent-red-500 shrink-0" />
                                                <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Cuenta con certificación (ISRI / CONAIPD)</span>
                                            </label>
                                            {isOtherDisability && (
                                                <div className="md:col-span-3 animate-in fade-in zoom-in-95 duration-200">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica el Tipo de Discapacidad</span>
                                                        {formData.disability_type === OTRA_ESPECIALIDAD && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200 normal-case tracking-normal">Requerido</span>}
                                                    </label>
                                                    <CatalogOtherInput
                                                        value={formData.disability_type}
                                                        onChange={(val) => handleSelectChange('disability_type', val)}
                                                        inputHoverClass={inputHoverClass}
                                                        hasError={formData.disability_type === OTRA_ESPECIALIDAD}
                                                        placeholder="Especifica el tipo de discapacidad"
                                                    />
                                                </div>
                                            )}
                                            {formData.disability_has_certification && (
                                                <p className="text-[9px] text-red-500/80 font-bold -mt-1 ml-1 md:col-span-3">El documento correspondiente ya está disponible para subir en la pestaña Documentos.</p>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>

                            <p className="text-[10px] font-black uppercase tracking-widest text-red-400/70 mt-4 mb-3 pt-4 border-t border-red-100/70 flex items-center gap-1.5">
                                <Phone size={12} strokeWidth={2.5} /> Contacto de Emergencia
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <PortalInput label="Avisar a" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} placeholder="Nombre" />
                                <div className="relative z-10">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 block">Parentesco</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.emergency_contact_relationship} onChange={(val) => handleSelectChange('emergency_contact_relationship', val)} options={PARENTESCO_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-red-500/80 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Teléfono de Emergencia {emergPhoneHasError && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md ml-1">{emergPhoneErrorMsg}</span>}</span>
                                        <button type="button" onClick={addEmergencyPhone} className="text-[#0052CC] hover:text-blue-700 flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider transition-colors">
                                            <Plus size={11} strokeWidth={3} /> Agregar
                                        </button>
                                    </label>
                                    <div className={`relative bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] z-10 border-slate-200/80 ${inputHoverClass} ${emergPhoneHasError ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                        <div className="absolute left-3 text-slate-400"><Phone size={14} strokeWidth={2.5} /></div>
                                        <input type="tel" name="emergency_contact_phone" value={formData.emergency_contact_phone || ''}
                                            onChange={(e) => { e.target.value = applyMask(e.target.value, 'PHONE'); handleChange(e); }}
                                            placeholder="0000-0000"
                                            className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                    </div>
                                </div>

                                {(formData.emergency_contact_extra_phones || []).length > 0 && (
                                    <div className="md:col-span-3 flex flex-col gap-2">
                                        {(formData.emergency_contact_extra_phones || []).map((ph, idx) => {
                                            const dLen = digitsLen(ph);
                                            const phErr = !!ph && dLen > 0 && (dLen < 8 || !isValidSVPhone(ph));
                                            return (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className={`relative flex-1 bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${phErr ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                                        <div className="absolute left-3 text-slate-400"><Phone size={14} strokeWidth={2.5} /></div>
                                                        <input type="tel" value={ph} onChange={(e) => updateEmergencyPhone(idx, e.target.value)} placeholder="0000-0000"
                                                            className="w-full h-full bg-transparent text-[16px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                                                    </div>
                                                    <button type="button" onClick={() => removeEmergencyPhone(idx)} title="Quitar teléfono"
                                                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                                                        <X size={14} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
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
                                                <LiquidSelect value={formData.secondary_role_id} onChange={(val) => handleSelectChange('secondary_role_id', val)} options={roleOpts} placeholder="Opcional..." clearable={false} icon={ShieldCheck} {...portalSelectProps} />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {formData.contract_type === 'SERVICIOS' && (
                            <div className="bg-red-50/70 border border-red-200/70 rounded-2xl p-3.5 flex items-start gap-3">
                                <ShieldAlert size={18} className="text-red-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                <p className="text-[11px] text-red-700 font-medium leading-tight">
                                    <span className="font-black">Riesgo legal — "Servicios Profesionales" con subordinación.</span> El Art. 20 del Código de Trabajo presume un contrato laboral real (con derecho a aguinaldo, vacaciones, ISSS e indemnización) cuando hay subordinación — horario, cargo y sucursal asignados, como en este expediente. Un juez laboral puede reclasificarlo sin importar la etiqueta del contrato. Usa este tipo solo para relaciones genuinamente independientes, sin horario ni supervisión directa.
                                </p>
                            </div>
                        )}

                        {formData.contract_type === 'PRACTICAS' && (
                            <div className="bg-blue-50/70 border border-blue-200/70 rounded-2xl p-3.5 flex items-start gap-3">
                                <GraduationCap size={18} className="text-blue-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                <p className="text-[11px] text-blue-700 font-medium leading-tight">
                                    <span className="font-black">Contrato de Aprendizaje (Art. 61-70 CT).</span> Requiere forma escrita y aprobación/inscripción ante el Ministerio de Trabajo (Art. 61) para ser válido como tal — si no se tramita, se presume relación laboral ordinaria. Salario mínimo reducido: no menor al 50% del mínimo legal durante el primer año, 75% durante el segundo, 100% desde el tercero (Art. 69). Ninguna de las partes incurre en responsabilidad por la terminación del contrato al llegar a su fin (Art. 68).
                                </p>
                            </div>
                        )}

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className={`grid grid-cols-1 gap-4 ${contractHasEndDate ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                                {isEditMode ? (
                                    <>
                                        <LockedField label="Tipo de Contrato" value={CONTRACT_TYPE_OPTIONS.find(o => o.value === formData.contract_type)?.label || formData.contract_type} />
                                        <LockedField label="Fecha de Inicio de Contrato" value={formData.contract_start_date ? new Date(formData.contract_start_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'} />
                                    </>
                                ) : (
                                    <>
                                        <div className="relative z-30">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Tipo de Contrato</label>
                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                                <LiquidSelect value={formData.contract_type} onChange={(val) => handleSelectChange('contract_type', val)} options={CONTRACT_TYPE_OPTIONS} clearable={false} icon={Briefcase} {...portalSelectProps} />
                                            </div>
                                        </div>
                                        <div className="relative z-30">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Fecha de Inicio de Contrato</label>
                                            <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                <LiquidDatePicker value={formData.contract_start_date} onChange={(date) => handleDateChange('contract_start_date', date)} placeholder="Seleccionar fecha" />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {contractHasEndDate && (
                                    <div className="relative z-30 animate-in fade-in zoom-in-95">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-1.5 flex items-center justify-between">
                                            <span>Fecha Fin de Contrato {contractDatesInvalid && <span className="text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-md ml-1">Debe ser posterior al inicio</span>}</span>
                                            {!formData.contract_end_date && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">Obligatorio</span>}
                                        </label>
                                        <div className={`bg-amber-50/30 rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${contractDatesInvalid ? '!border-red-400 !bg-red-50/50' : 'border-amber-200'}`}>
                                            <LiquidDatePicker value={formData.contract_end_date} onChange={(date) => handleDateChange('contract_end_date', date)} placeholder="Obligatorio para temporales/prácticas" />
                                        </div>
                                    </div>
                                )}

                                {formData.contract_type === 'TEMPORAL' && (
                                    <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in zoom-in-95">
                                        <div className="relative z-20">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-1.5 flex items-center justify-between">
                                                <span>Base Legal del Plazo (Art. 25)</span>
                                                {temporalBasisMissing && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">Requerido</span>}
                                            </label>
                                            <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${temporalBasisMissing ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                                <LiquidSelect value={formData.contract_temporal_legal_basis} onChange={(val) => handleSelectChange('contract_temporal_legal_basis', val)} options={TEMPORAL_LEGAL_BASIS_OPTIONS} placeholder="Seleccionar base legal..." clearable={false} {...portalSelectProps} />
                                            </div>
                                        </div>
                                        <PortalInput label="Motivo Concreto" name="contract_temporal_reason" value={formData.contract_temporal_reason} onChange={handleChange} placeholder="Ej. Cobertura de incapacidad de la titular del puesto" required hasError={temporalReasonMissing} errorMessage="Requerido para justificar el plazo" />
                                        <p className="md:col-span-2 text-[10px] text-amber-600/80 font-medium -mt-2 ml-1">La base legal es un catálogo cerrado (solo hay 2 según el Art. 25); el motivo concreto lo redacta la empresa caso por caso — queda como respaldo escrito si el plazo se disputa.</p>
                                    </div>
                                )}
                            </div>

                            {probationInfo && (
                                <div className="mt-4 pt-4 border-t border-slate-200/50">
                                    {probationInfo.exempt ? (
                                        <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><ShieldCheck size={12} className="text-emerald-500" /> Recontratación antes de 1 año: no aplica período de prueba (Art. 28, último párrafo).</p>
                                    ) : probationInfo.inProbation ? (
                                        <p className="text-[10px] font-bold text-[#0052CC] flex items-center gap-1.5 bg-[#0052CC]/5 border border-[#0052CC]/20 rounded-xl px-3 py-2 w-fit">
                                            <Clock size={12} /> En Período de Prueba — vence el {probationInfo.probationEnd.toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' })} (Art. 28: 30 días desde la fecha de contratación)
                                        </p>
                                    ) : null}
                                </div>
                            )}

                            <div className={`grid grid-cols-1 gap-4 mt-4 ${hoursMode === 'OTRO' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Horas Semanales</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={hoursMode} onChange={handleHoursModeChange} options={HOURS_OPTIONS} clearable={false} icon={Clock} {...portalSelectProps} />
                                    </div>
                                </div>
                                {hoursMode === 'OTRO' && (
                                    <div className="relative z-20 animate-in fade-in zoom-in-95">
                                        <PortalInput label="Horas (Otro)" name="weekly_contracted_hours" value={formData.weekly_contracted_hours === OTRO_HOURS_SENTINEL ? '' : formData.weekly_contracted_hours} onChange={handleChange} type="number" icon={Clock} placeholder="Ej. 36" hasError={hoursInvalid} errorMessage={`Entre ${MIN_WEEKLY_HOURS} y ${MAX_WEEKLY_HOURS}`} />
                                    </div>
                                )}
                                {isEditMode
                                    ? <LockedField label="Salario Base" value={formData.base_salary ? `$${Number(formData.base_salary).toFixed(2)}` : '—'} />
                                    : <PortalInput label="Salario Base" name="base_salary" value={formData.base_salary} onChange={handleChange} type="number" icon={DollarSign} placeholder="0.00" prefix="$" hasError={salaryInvalid} errorMessage="Debe ser mayor a 0" />
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
                                        <LiquidSelect value={formData.afp_institution} onChange={(val) => handleSelectChange('afp_institution', val)} options={AFP_OPTIONS} placeholder="Crecer o Confía..." icon={Hash} clearable={false} {...portalSelectProps} />
                                    </div>
                                </div>

                                <div className="relative z-20">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Banco (Planilla)</label>
                                    <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                        <LiquidSelect value={formData.bank_name} onChange={(val) => handleSelectChange('bank_name', val)} options={BANKS_OPTIONS} placeholder="Seleccionar Banco..." icon={Building2} clearable={false} {...portalSelectProps} />
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
                                            className={`w-full bg-white border border-slate-200/80 rounded-[1rem] px-4 h-[40px] text-[16px] font-black text-slate-700 outline-none shadow-sm transition-all duration-300 focus-within:ring-4 focus-within:ring-[#0052CC]/10 focus-within:border-[#0052CC]/50 hover:shadow-md ${!formData.code?.trim() ? '!border-red-400 !bg-red-50/50' : ''}`} />
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

                {/* TAB 4: DOCUMENTACIÓN */}
                {activeTab === 'documentos' && (
                    <>
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-[#0052CC]/10 text-[#0052CC] rounded-[0.8rem] border border-[#0052CC]/20">
                                    <FileText size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Documentación del Expediente</h4>
                            </div>

                            {/* Documento de identidad: DUI (Frente+Reverso, un solo documento) para
                                adultos; documento alterno con selector de tipo (Art. 23.2) para
                                menores — agrupado aparte para que no se lea como 2 archivos
                                independientes. La imagen NO bloquea el alta del empleado (a
                                diferencia del campo de texto DUI/documento alterno, que sí es
                                obligatorio) — si falta, queda marcada "Pendiente". */}
                            <div className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 mb-4">
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">{isMinor ? altIdDocTypeLabel : 'DUI'}</label>
                                    {!(isMinor ? !!getDocEntry('DOCUMENTO_IDENTIDAD').url : (!!getDocEntry('DUI_FRENTE').url && !!getDocEntry('DUI_REVERSO').url)) && (
                                        <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 shrink-0">Pendiente</span>
                                    )}
                                </div>
                                {isMinor ? (
                                    renderDocUploadArea('DOCUMENTO_IDENTIDAD')
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1 flex items-center justify-between">
                                                <span>Frente</span>
                                                {!getDocEntry('DUI_FRENTE').url && <span className="text-amber-600 font-black">Pendiente</span>}
                                            </label>
                                            {renderDocUploadArea('DUI_FRENTE')}
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1 flex items-center justify-between">
                                                <span>Reverso</span>
                                                {!getDocEntry('DUI_REVERSO').url && <span className="text-amber-600 font-black">Pendiente</span>}
                                            </label>
                                            {renderDocUploadArea('DUI_REVERSO', { showExpiry: false })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {documentCategories.map(cat => (
                                    <div key={cat.key} className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">{cat.label}</label>
                                        {cat.key === 'SRS' && (
                                            <PortalInput label="Número de Carné JVPQF" name="pharmacist_license_number" value={formData.pharmacist_license_number} onChange={handleChange} icon={Hash} placeholder="N° JVPQF" colSpan={1} />
                                        )}
                                        {cat.key === 'ENFERMERIA' && (
                                            <PortalInput label="Número de Carné JVPE" name="nursing_license_number" value={formData.nursing_license_number} onChange={handleChange} icon={Hash} placeholder="N° JVPE" colSpan={1} />
                                        )}
                                        {(cat.key === 'ANUALIDAD_JVPQF' || cat.key === 'ANUALIDAD_JVPE') && (
                                            <p className="text-[9px] text-slate-400 font-bold mb-2">Comprobante de pago del año en curso (recibo/mandamiento de pago cancelado) — trámite distinto al carné, se renueva cada año. Fecha límite CSSP: 31 de marzo (igual para todos los profesionales de salud inscritos) — se autocompleta al subir el recibo si no escribes otra fecha.</p>
                                        )}
                                        {renderDocUploadArea(cat.key)}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Otros Documentos</h4>
                                <button type="button" onClick={addExtraDoc} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC] hover:text-blue-700 transition-colors">
                                    <Plus size={12} strokeWidth={3} /> Agregar Documento
                                </button>
                            </div>
                            {extraDocs.length === 0 && <p className="text-[11px] text-slate-400 font-medium">Sin documentos adicionales.</p>}
                            <div className="flex flex-col gap-3">
                                {extraDocs.map(doc => (
                                    <div key={doc.category} className="p-3 rounded-2xl border border-slate-200/70 bg-slate-50/60">
                                        <div className="flex items-center justify-between mb-2 gap-2">
                                            <input type="text" value={doc.title} onChange={(e) => updateDoc(doc.category, { title: e.target.value })} placeholder="Nombre del documento"
                                                className="flex-1 bg-transparent text-[16px] font-bold text-slate-700 outline-none border-b border-slate-200 pb-1" />
                                            <button type="button" onClick={() => removeExtraDoc(doc.category)} title="Quitar documento" className="text-slate-400 hover:text-red-500 shrink-0"><X size={14} /></button>
                                        </div>
                                        {renderDocUploadArea(doc.category)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>

        </div>
    );
};

export default EmployeeFormModal;