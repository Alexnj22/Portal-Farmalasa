import React, { useState, useEffect, useMemo } from 'react';
import useBorrador from '../../hooks/useBorrador';
import { loadDraft, clearDraft } from '../../utils/draftUtils';
import { SENSITIVE_FIELDS } from '../../store/utils';
import { faltantesDelExpediente } from '../../utils/expediente';
import { aplicarDuiLeido, ROTULO_DUI } from '../../utils/duiLeido';
import { acreditacionesDe, pendientesPrevisionales, ESTADO_PREVISIONAL_OPTIONS } from '../../utils/acreditaciones';
import { estadoRemisionMtps, esContratoCivil, ART20_ADVERTENCIA,
         FORMA_ESTIPULACION_OPTIONS, PLAZO_DE_PAGO, MEDIO_PAGO_OPTIONS } from '../../utils/contrato';

// La clave del borrador del alta. Una sola, porque el alta es una sola: dos
// pestañas dando de alta a dos personas a la vez no es un caso real, y una
// clave por sesión dejaría borradores que nadie vuelve a ver.
const CLAVE_BORRADOR = 'alta_empleado';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import { User, Users, Briefcase, CreditCard, ShieldCheck, Phone, MapPin, Hash, Building2, Fingerprint, Lock, RefreshCw, AtSign, HeartPulse, Clock, DollarSign, GraduationCap, Camera, AlertCircle, RotateCcw, Trash2, Map as MapIcon, Navigation, AlertTriangle, CheckCircle2, Mail, Copy, Plus, X, Car, Bike, Globe, ShieldAlert, FileText, Link2, Wrench, CalendarClock, Loader2, Banknote } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '../../utils/inputStyles';
import { EL_SALVADOR_GEO, distritosDe } from '../../data/elSalvadorGeo';
import { NATIONALITY_OPTIONS } from '../../data/nationalities';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { supabase } from '../../supabaseClient';
import {
    codigoDeCarneLibre, duiDisponible, fetchCredenciales, fetchEducationCatalogEntries, fetchLastTerminationEvent,
} from '../../data/employees';
import { getStoragePathFromUrl } from '../../utils/storageFiles';
import { GRADO_BASICA_OPTIONS, OTRA_ESPECIALIDAD, isCatalogOther, buildCatalogOptions } from '../../utils/educationCatalogs';
import { getExpiryBadge, getExpiringDocuments, getNextAnnualidadCsspDueDate } from '../../utils/documentExpiry';
import { isDependentAgeOnly, isDependentAgeInvalid, getDependentAge, MIN_DEPENDENT_AGE, MAX_DEPENDENT_AGE } from '../../utils/economicDependents';
import { calcAge, MINOR_AGE } from '../../utils/ageUtils';
import { isValidDUIAlgorithm, maskDui } from '../../utils/duiUtils';
import FileField from '../common/FileField';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import { PROPS_CAMARA } from '../../utils/capturaDeFoto';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';

// ============================================================================
// 🚀 CATÁLOGOS Y CONSTANTES
// ============================================================================
// Campos de texto libre que se guardan siempre en mayúscula (información de
// ficha, no credenciales) — email/username/teléfonos/DUI quedan fuera.
const UPPERCASE_FIELDS = new Set(['first_names', 'last_names', 'address', 'emergency_contact_name']);

const GENDER_OPTIONS = [{ value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }];
const BLOOD_TYPE_OPTIONS = [{ value: 'O+', label: 'O+ (Positivo)' }, { value: 'O-', label: 'O- (Negativo)' }, { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' }, { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' }, { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' }];
const MARITAL_STATUS_OPTIONS = [{ value: 'SOLTERO', label: 'Soltero/a' }, { value: 'CASADO', label: 'Casado/a' }, { value: 'DIVORCIADO', label: 'Divorciado/a' }, { value: 'VIUDO', label: 'Viudo/a' }, { value: 'ACOMPAÑADO', label: 'Acompañado/a' }];
// «Prácticas» (contrato de aprendizaje, Art. 61-70) se quitó el 2026-08-26:
// el usuario confirmó que no contratan aprendices pagados. Ojo con la
// diferencia si alguna vez vuelve — el formulario de practicantes NO es esto:
// ése es una pasantía estudiantil (institución, tutor, convenio, horas
// requeridas), y el aprendizaje es un contrato LABORAL pagado, con salario
// mínimo reducido por año y registro ante el Ministerio de Trabajo.
//
// Se deja fuera de la lista pero el valor 'PRACTICAS' sigue reconociéndose al
// LEER una ficha vieja: quitarlo de golpe dejaría el tipo de contrato en blanco
// en quien lo tuviera, sin que nadie lo note.
const CONTRACT_TYPE_OPTIONS = [{ value: 'INDEFINIDO', label: 'Indefinido (Fijo)' }, { value: 'TEMPORAL', label: 'Temporal' }, { value: 'SERVICIOS', label: 'Servicios profesionales' }];
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
    { value: '44', label: 'Tiempo completo 44h' },
    { value: '22', label: 'Medio tiempo 22h' },
    { value: 'OTRO', label: 'Otro' },
];
const CATALOG_CATEGORIES = ['BACHILLERATO_TECNICO_ESPECIALIDAD', 'TECNICO_SUPERIOR_ESPECIALIDAD', 'PROFESION_UNIVERSITARIA', 'MAESTRIA_POSTGRADO', 'CURSO_HABILIDAD', 'INSTITUCION_CAPACITACION', 'ENFERMEDAD_CRONICA', 'TIPO_DISCAPACIDAD'];
// weekly_contracted_hours llega como number desde Postgres (integer) pero como
// string mientras se edita en el input — comparar siempre vía String() para
// que "Tiempo completo 44h"/"Medio tiempo 22h" se detecten sin importar el tipo.
const isCustomHours = (h) => h !== '' && h !== null && h !== undefined && String(h) !== '44' && String(h) !== '22';
// Sentinel para "Otro" recién elegido, antes de teclear un número — igual
// patrón que OTRA_ESPECIALIDAD: si usáramos '' aquí, isCustomHours('') sería
// false (por diseño, para no confundir "vacío" con "personalizado") y el
// select rebotaría de vuelta a "Tiempo completo 44h" apenas se eligiera Otro.
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
// Art. 23 nº10 CT: el numeral pide «cantidad, CALIDAD Y ESTADO». Es una lista
// cerrada y no texto libre porque el valor de este campo está en poder
// compararlo el día de la devolución, y «bueno», «Bueno» y «b» no se comparan.
const ESTADO_HERRAMIENTA_OPTIONS = [
    { value: 'NUEVO', label: 'Nuevo' },
    { value: 'BUENO', label: 'Bueno' },
    { value: 'USADO', label: 'Usado' },
    { value: 'DETERIORADO', label: 'Deteriorado' },
];
// Art. 23 nº9 CT: «forma, PERÍODO y lugar de pago».
const PERIODO_PAGO_OPTIONS = [
    { value: 'SEMANAL', label: 'Semanal' },
    { value: 'QUINCENAL', label: 'Quincenal' },
    { value: 'MENSUAL', label: 'Mensual' },
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
    { value: 'CONYUGE', label: 'Cónyuge / pareja' },
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
    { value: 'BASICA', label: 'Educación básica' },
    { value: 'BACHILLERATO_GENERAL', label: 'Bachillerato general' },
    { value: 'BACHILLERATO_TECNICO', label: 'Bachillerato técnico' },
    { value: 'TECNICO_SUPERIOR', label: 'Técnico superior' },
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
    { value: 'AHORRO',     label: 'Cuenta de ahorro' },
    { value: 'CORRIENTE',  label: 'Cuenta corriente' },
    { value: 'ELECTRONICA',label: 'Cuenta electrónica' },
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
        <label className="text-caption font-black uppercase tracking-widest text-content-2 ml-1 mb-1.5 flex items-center justify-between">
            <span>{label}</span>
            <Badge size="sm" icon={Lock} uppercase={false}>Acción RRHH</Badge>
        </label>
        <div className="flex items-center gap-2 w-full h-[40px] px-3 bg-surface-card-hover/60 border border-divider rounded-2xl cursor-not-allowed opacity-70">
            <Lock size={12} className="text-content-3 shrink-0" />
            <span className="text-body font-bold text-content-3 truncate">{value || '—'}</span>
        </div>
    </div>
);

const EmployeeFormModal = ({ formData, setFormData, branches, roles, isEditMode = false, activeTab: activeTabProp, onValidationChange }) => {

    const employees = useStaffStore(state => state.employees);
    // Se maneja con el dedo: decide si se ofrece la cámara para la foto oficial.
    const esTactil = useCoarsePointer();
    // Fallback sin uso real hoy: el único caller (UnifiedModal) siempre pasa
    // activeTab controlado. Sin setter porque no hay UI de tabs interna que lo dispare.
    const [localActiveTab] = useState('personal');
    const activeTab = activeTabProp !== undefined ? activeTabProp : localActiveTab;
    const [hasDraft, setHasDraft] = useState(false);

    // Especialidades/profesiones viven en education_catalog_entries — se
    // traen una vez al abrir el modal; "Otra..." agrega filas nuevas ahí
    // (employeeSlice.js) y quedan disponibles como opción real de inmediato.
    const [educationCatalog, setEducationCatalog] = useState(() => Object.fromEntries(CATALOG_CATEGORIES.map(c => [c, []])));
    useEffect(() => {
        let cancelled = false;
        fetchEducationCatalogEntries().then(({ data }) => {
            if (cancelled || !data) return;
            const grouped = Object.fromEntries(CATALOG_CATEGORIES.map(c => [c, []]));
            for (const row of data) { if (grouped[row.category]) grouped[row.category].push(row.value); }
            setEducationCatalog(grouped);
        });
        return () => { cancelled = true; };
    }, []);

    // El código de carné y el PIN ya no viajan con la fila del empleado: son la
    // credencial con la que se entra al portal (`login()` hace
    // `signInWithPassword(password: code)`), y publicarlos en `employees_safe`
    // significaba que cualquier empleado con sesión leía el de todos. Se piden
    // aparte, con la misma compuerta que gobierna editar personal.
    //
    // Sólo al EDITAR: al crear a alguien el código lo genera esta pantalla.
    useEffect(() => {
        if (!isEditMode || !formData?.id) return;
        let cancelled = false;
        fetchCredenciales([formData.id]).then((mapa) => {
            const cred = mapa.get(formData.id);
            if (cancelled || !cred) return;
            // `prev.code ?? ` y no al revés: si quien edita ya escribió un
            // código nuevo, la respuesta que llega después no se lo pisa.
            setFormData((prev) => ({
                ...prev,
                code: prev.code ?? cred.code ?? '',
                kiosk_pin: prev.kiosk_pin ?? cred.kiosk_pin ?? '',
            }));
        });
        return () => { cancelled = true; };
    }, [isEditMode, formData?.id, setFormData]);

    // Art. 28: si esta persona tiene una baja (TERMINATION) a menos de 1 año de
    // la fecha de contratación actual, no puede volver a estipularse período de
    // prueba — solo se necesita el evento más reciente para saberlo.
    const [lastTermination, setLastTermination] = useState(null);
    useEffect(() => {
        if (!isEditMode || !formData?.id) { setLastTermination(null); return; }
        let cancelled = false;
        fetchLastTerminationEvent(formData.id).then(({ data }) => {
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
            const parsed = loadDraft(CLAVE_BORRADOR);
            if (parsed && !formData?.id) {
                // ¿La persona del borrador ya está guardada? Entonces el
                // borrador es basura y ofrecerlo sólo confunde.
                //
                // El DUI ya NO viaja en el borrador (es un campo sensible), así
                // que la comparación queda por NOMBRE. Es más floja, y es el
                // precio aceptado: el caso que resuelve —alguien que completó
                // el alta y vuelve a abrir— se reconoce igual por nombre y
                // apellido, y el costo de fallar es ofrecer un botón de más, no
                // perder un dato.
                const isAlreadySaved = employees.some(emp =>
                    (parsed.first_names && parsed.last_names)
                    && emp.first_names?.trim().toLowerCase() === parsed.first_names?.trim().toLowerCase()
                    && emp.last_names?.trim().toLowerCase() === parsed.last_names?.trim().toLowerCase());

                if (isAlreadySaved) { clearDraft(CLAVE_BORRADOR); setHasDraft(false); }
                else if (parsed.first_names || parsed.last_names) setHasDraft(true);
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
                medico_license_number: '', contador_license_number: '',
                tiene_acreditacion_dependiente: false,
                employee_documents: [],
                department: '', municipality: '', distrito: '', education_level: '', profession: '',
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
                forma_estipulacion_salario: '', medio_pago: '', lugar_pago: '',
                mtps_remitido_fecha: '', contrato_prorrogas: [],
                isss_estado: '', afp_estado: '',
                // Art. 23 CT — los cuatro numerales que faltaban. Ninguno
                // arranca con un valor puesto: `contract_type` y
                // `weekly_contracted_hours` ya enseñaron que un default se
                // confunde con un dato (figuran en las 49 fichas y nadie los
                // escribió). Vacío se ve; 'QUINCENAL' preseleccionado, no.
                dui_lugar_expedicion: '', dui_fecha_expedicion: '',
                periodo_pago: '', contrato_lugar_celebracion: '', contrato_fecha_celebracion: '',
                herramientas_entregadas: [],
                // Enlazar con una ficha existente: sólo vive en el formulario,
                // no es una columna. `addEmployee` la lee para escribir SOBRE
                // esa ficha en vez de crear una segunda.
                enlazar_con_id: '',
                ...prev
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ── El borrador NO se lleva la credencial ni el dinero (2026-08-24) ────
     *
     * Esto guardaba `formData` ENTERO —sólo quitaba el archivo y la miniatura—,
     * o sea que el DUI, el ISSS, el AFP, el sueldo base, el banco, la cuenta y
     * el PIN del carné quedaban en `localStorage`, en claro, en la computadora
     * de quien estuviera dando de alta a alguien. Son exactamente los siete
     * campos de `SENSITIVE_FIELDS`, la lista que existe para eso y que
     * `persistEmployees` sí respeta al cachear el padrón: el MISMO repo tenía
     * las dos reglas en direcciones opuestas.
     *
     * Y `localStorage` sobrevive al cierre de sesión: lo lee cualquiera que se
     * siente después en esa máquina.
     *
     * Al pasar por `draftUtils` gana además el vencimiento a 24 h que la
     * versión a mano no tenía — un borrador de hace un mes seguía ahí,
     * ofreciéndose para restaurar. */
    const borradorSeguro = useMemo(() => {
        if (isEditMode || formData?.id) return null;
        if (!(formData?.first_names || formData?.last_names || formData?.dui)) return null;
        const limpio = { ...formData };
        delete limpio.file;
        delete limpio.photoPreview;
        for (const campo of SENSITIVE_FIELDS) delete limpio[campo];
        return limpio;
    }, [formData, isEditMode]);

    const { descartar: descartarBorrador } = useBorrador(
        CLAVE_BORRADOR, borradorSeguro, { activo: !isEditMode && !formData?.id },
    );

    const restoreDraft = () => {
        const parsed = loadDraft(CLAVE_BORRADOR);
        if (!parsed) { setHasDraft(false); return; }
        // El DUI y los datos de dinero NO están en el borrador a propósito
        // (ver arriba): se vuelven a escribir, que es el precio de no dejarlos
        // en el disco de una computadora compartida.
        setFormData(prev => ({ ...prev, ...parsed }));
        setHasDraft(false);
    };

    const discardDraft = () => {
        descartarBorrador();
        setHasDraft(false);
    };

    /* ── Lo que falta, que ya NO es lo que bloquea ──────────────────────────
     *
     * Desde que una ficha se puede guardar con sólo el nombre, este banner dejó
     * de ser un recordatorio menor y pasó a ser **la única señal** de que el
     * expediente está a medias. Por eso ahora se muestra también al DAR DE
     * ALTA: antes salía sólo en edición, que era cuando el formulario ya te
     * había obligado a llenar casi todo.
     *
     * La lista sale de `utils/expediente.js` y no de acá: la miran también el
     * listado de personal y —más adelante— quien decida si una ficha incompleta
     * se puede borrar. Tres pantallas con tres listas propias dirían cosas
     * distintas de la misma persona.
     */
    /* ── Lo que falta, sin el testamento ────────────────────────────────────
     *
     * Primera versión: los 23 faltantes en una sola línea, cada uno con su
     * «(Art. 23 nº1)» al lado. El usuario lo cortó de raíz —«ese testamento es
     * necesario? es too much»— y tenía razón dos veces:
     *
     *  1. En una ficha EN BLANCO no informa nada. Todo está pendiente porque
     *     todavía no se escribió nada: el formulario vacío YA es la lista, y
     *     repetirla arriba es ruido que se aprende a saltear. Por eso ahora no
     *     aparece hasta que la ficha tiene nombre — a partir de ahí un campo
     *     que falta sí se puede pasar por alto, que es cuando el aviso sirve.
     *
     *  2. El número de artículo es jerga de adentro. Es la misma regla que rige
     *     todo el resto del portal (no se nombra el ERP, no se dice «sync»): el
     *     artículo le importa a quien escribe el código, no a quien completa la
     *     ficha. Sigue estando, pero en el `title` de cada uno — a mano para
     *     quien lo necesite, fuera de la vista de quien no.
     */
    const pendientes = useMemo(() => faltantesDelExpediente(formData), [formData]);

    const vencimientos = useMemo(
        () => getExpiringDocuments(formData?.employee_documents || []).map(doc => ({
            campo: `venc_${doc.category}`,
            label: doc.daysLeft < 0
                ? `${doc.title || doc.category}: vencido`
                : `${doc.title || doc.category}: vence en ${doc.daysLeft} día${doc.daysLeft === 1 ? '' : 's'}`,
        })),
        [formData?.employee_documents]);

    // Antes del nombre no hay ficha que esté «incompleta»: hay una ficha que no
    // empezó.
    const fichaEmpezada = !!formData?.first_names?.trim() || !!formData?.last_names?.trim();

    // Distritos del municipio elegido. Si el municipio cambia, el distrito que
    // había deja de pertenecerle — se limpia en `handleSelectChange`, no acá:
    // un `useEffect` que borra un campo al ver otro cambiar borra también
    // cuando el formulario se HIDRATA con una ficha existente.
    const distritoOpts = useMemo(
        () => distritosDe(formData?.municipality).map(d => ({ value: d, label: d })),
        [formData?.municipality]);

    const municipioOpts = useMemo(() => {
        if (!formData?.department || !EL_SALVADOR_GEO[formData.department]) return [];
        return EL_SALVADOR_GEO[formData.department].map(m => ({ value: m, label: m }));
    }, [formData?.department]);

    // Código SOLO numérico (regla de negocio + trigger en BD): con dígitos no
    // existe ambigüedad de mayúsculas en el hash SHA-256 del PIN.
    //
    // Quién decide que está libre cambió: antes se cruzaba contra los códigos
    // de la lista cargada, y esa lista ya no los trae —el código es la
    // contraseña del portal—. Un `Set` vacío daba por libre CUALQUIER
    // candidato, o sea que el generador habría empezado a repetir códigos sin
    // avisar, y dos personas con el mismo código son dos con la misma
    // contraseña. Ahora pregunta al servidor candidato por candidato.
    const generateUniqueCode = async () => {
        for (let i = 0; i < 12; i++) {
            const candidate = String(Math.floor(1000 + Math.random() * 9000));
            if (await codigoDeCarneLibre(candidate) === true) return candidate;
        }
        // Ninguna respuesta afirmativa en 12 intentos: puede ser mala suerte o
        // que el servidor no esté contestando. No se inventa un código —sería
        // exactamente el fallo que esto evita—: se avisa y no se toca el campo.
        useToastStore.getState().showToast('No se pudo generar un código',
            'Escríbelo a mano y comprueba que no esté en uso.', 'error');
        return null;
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
        // Cambiar de municipio deja huérfano al distrito: el que estaba elegido
        // pertenece a otro municipio, y guardarlo así sería una dirección que
        // no existe. Se limpia acá —en el gesto que lo invalida— y no en un
        // `useEffect`, que también se dispararía al hidratar una ficha ya
        // guardada y borraría un dato bueno.
        if (name === 'municipality' && value !== formData?.municipality) {
            setFormData(prev => ({ ...prev, municipality: value, distrito: '' }));
            return;
        }
        if (name === 'department' && value !== formData?.department) {
            setFormData(prev => ({ ...prev, department: value, municipality: '', distrito: '' }));
            return;
        }
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
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

    // Contactos ADEMÁS del principal. Se leen de `contactos_extra` si alguien ya
    // los tocó en esta sesión, y si no de la fila guardada salteando el primero
    // —que es el principal y vive en sus propias columnas—. Sin estado extra ni
    // efecto de hidratación: un `useEffect` que copia de una a otra se dispara
    // también al abrir la ficha y pisa lo que se acaba de escribir.
    const contactosExtra = formData?.contactos_extra ?? (formData?.emergency_contacts || []).slice(1);
    const addContactoExtra = () => setFormData(prev => ({
        ...prev,
        contactos_extra: [...(prev.contactos_extra ?? (prev.emergency_contacts || []).slice(1)), { nombre: '', parentesco: '', telefono: '' }],
    }));
    const updateContactoExtra = (idx, patch) => setFormData(prev => {
        const base = prev.contactos_extra ?? (prev.emergency_contacts || []).slice(1);
        return { ...prev, contactos_extra: base.map((c, i) => i === idx ? { ...c, ...patch } : c) };
    });
    const removeContactoExtra = (idx) => setFormData(prev => {
        const base = prev.contactos_extra ?? (prev.emergency_contacts || []).slice(1);
        return { ...prev, contactos_extra: base.filter((_, i) => i !== idx) };
    });

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
    // Las juntas que le corresponden por cargo y profesión, y qué queda
    // pendiente con el ISSS y la AFP. Los dos salen de `utils/acreditaciones.js`
    // para que la pantalla y el banner de pendientes no puedan discrepar.
    const acreditacionesQueAplican = useMemo(
        () => acreditacionesDe({ cargo: selectedRoleName, profesion: formData?.profession }),
        [selectedRoleName, formData?.profession]);
    const pendientesDePrevision = useMemo(
        () => pendientesPrevisionales(formData),
        [formData]);

    const esMenorParaDocumentos = (() => {
        const edad = calcAge(formData?.birth_date);
        return edad !== null && edad < MINOR_AGE;
    })();
    // Se suben en la sección Acreditaciones, no en Documentación: ahí el
    // archivo es el que trae el número y el vencimiento.
    const EN_ACREDITACIONES = ['SRS', 'ENFERMERIA', 'MEDICO', 'CONTADURIA', 'DEPENDIENTE_FARMACIA'];
    const documentCategories = useMemo(() => [
        ...FIXED_DOCUMENT_CATEGORIES,
        ...(formData.has_motorcycle_license ? [{ key: 'LICENCIA_MOTO', label: 'Licencia de Motocicleta' }] : []),
        ...(formData.has_car_license ? [{ key: 'LICENCIA_CARRO', label: 'Licencia de Automóvil' }] : []),
        ...(isPharmacistRegent ? [{ key: 'SRS', label: 'Carné JVPQF — Regente / Químico Farmacéutico' }] : []),
        ...(isPharmacistRegent ? [{ key: 'ANUALIDAD_JVPQF', label: 'Anualidad JVPQF — solvencia del año en curso' }] : []),
        ...(isPharmacistRegent ? [{ key: 'CONTRATO_REGENCIA', label: 'Contrato de Regencia' }] : []),
        ...(isNursing ? [{ key: 'ENFERMERIA', label: 'Carné de Enfermería — JVPE' }] : []),
        ...(acreditacionesQueAplican.some(a => a.id === 'MEDICO') ? [{ key: 'MEDICO', label: 'Carné médico — JVPM' }] : []),
        ...(acreditacionesQueAplican.some(a => a.id === 'CONTADURIA') ? [{ key: 'CONTADURIA', label: 'Acreditación de Contaduría — CVPCPA' }] : []),
        ...(formData.tiene_acreditacion_dependiente ? [{ key: 'DEPENDIENTE_FARMACIA', label: 'Acreditación de dependiente de farmacia — CSSP' }] : []),
        ...(isNursing ? [{ key: 'ANUALIDAD_JVPE', label: 'Anualidad JVPE — solvencia del año en curso' }] : []),
        ...(formData.disability_has_certification ? [{ key: 'CERTIFICACION_DISCAPACIDAD', label: 'Certificación de Discapacidad — ISRI / CONAIPD' }] : []),
        // Art. 117 CT: el examen médico previo de un menor no es una buena
        // práctica, es requisito para admitirlo, y se repite cada año hasta los
        // 18. El aviso amarillo ya lo decía en la pestaña Personal; faltaba
        // dónde guardar la constancia. Con `expiry_date` entra además en el
        // aviso de vencimientos, que es lo que convierte «cada año» en algo que
        // alguien recuerda.
        //
        // La edad se calcula acá dentro y no se toma de `isMinor`: esa
        // constante se declara 200 líneas más abajo, y un `useMemo` corre su
        // callback durante ESTE render — leerla desde acá es un ReferenceError
        // por zona muerta temporal, no un `undefined` benigno. `pendientes`
        // hace lo mismo por el mismo motivo.
        ...(esMenorParaDocumentos ? [{ key: 'EXAMEN_MEDICO', label: 'Examen Médico Previo — Art. 117 (se repite cada año hasta los 18)' }] : []),
    ], [formData.has_motorcycle_license, formData.has_car_license, isPharmacistRegent, isNursing, formData.disability_has_certification, esMenorParaDocumentos, acreditacionesQueAplican, formData.tiene_acreditacion_dependiente]);

    const uploadFileToStorage = useStaffStore(state => state.uploadFileToStorage);
    const [analyzingDocs, setAnalyzingDocs] = useState({});
    // Lo que dijo el DUI, esperando que alguien lo confirme. NO se aplica solo:
    // un formulario que se llena y se guarda solo convierte un error de lectura
    // en un dato del expediente, y después nadie sabe si el DUI dice eso o si
    // lo dijo el modelo.
    // Un solo archivo con las dos caras, o dos archivos. Arranca en dos porque
    // es como llega la mayoría; el modo lo elige quien carga, no se adivina por
    // el tipo de archivo — un JPG puede traer las dos caras en una foto y un PDF
    // puede traer una sola.
    const [verPendientes, setVerPendientes] = useState(false);
    const [duiEnUnArchivo, setDuiEnUnArchivo] = useState(false);
    const [duiLeido, setDuiLeido] = useState(null);
    const [leyendoDui, setLeyendoDui] = useState(false);

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

    const handleDocFile = async (category, file) => {
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

            // ── El DUI se lee cuando están las DOS caras ────────────────────
            //
            // El número y el sexo están en el anverso; el domicilio, la
            // profesión, el estado familiar y el tipo de sangre, en el reverso.
            // Una sola llamada con las dos imágenes lee mejor que dos sueltas:
            // el modelo puede cruzar que sean del mismo documento, y dos
            // respuestas separadas habría que conciliarlas acá — conciliar es
            // adivinar.
            if (category === 'DUI_COMPLETO' && stored) {
                // Un archivo alcanza: `leer-dui` acepta uno o dos.
                setLeyendoDui(true);
                try {
                    const { data, error } = await supabase.functions.invoke('leer-dui', { body: { frente: stored } });
                    if (error || !data?.ok) {
                        useToastStore.getState().showToast(
                            'No se pudo leer el documento',
                            data?.error === 'NO_ES_DUI'
                                ? 'El archivo no parece un DUI. Revisa que traiga las dos caras.'
                                : 'Escribe los datos a mano; el documento quedó guardado.',
                            'warning');
                    } else {
                        setDuiLeido({ ...data.datos, nacionalidad: data.nacionalidad, numeroIlegible: data.numeroIlegible });
                    }
                } catch (errLectura) {
                    console.error('leer-dui:', errLectura);
                    useToastStore.getState().showToast('No se pudo leer el documento', 'Escribe los datos a mano; el documento quedó guardado.', 'warning');
                } finally {
                    setLeyendoDui(false);
                }
            }

            if (category === 'DUI_FRENTE' || category === 'DUI_REVERSO') {
                const otra = category === 'DUI_FRENTE' ? 'DUI_REVERSO' : 'DUI_FRENTE';
                const urlOtra = getDocEntry(otra).url;
                if (urlOtra && stored) {
                    const guardadaOtra = getStoragePathFromUrl(urlOtra);
                    setLeyendoDui(true);
                    try {
                        const caras = category === 'DUI_FRENTE'
                            ? { frente: stored, reverso: guardadaOtra }
                            : { frente: guardadaOtra, reverso: stored };
                        const { data, error } = await supabase.functions.invoke('leer-dui', { body: caras });
                        if (error || !data?.ok) {
                            // Que no se pueda leer NO es un error del alta: el
                            // documento ya quedó subido y los campos se teclean.
                            // Avisar con un error rojo asustaría por nada.
                            useToastStore.getState().showToast(
                                'No se pudo leer el documento',
                                data?.error === 'NO_ES_DUI'
                                    ? 'Las imágenes no parecen un DUI. Revisa que sean las dos caras.'
                                    : 'Escribe los datos a mano; el documento quedó guardado.',
                                'warning');
                        } else {
                            setDuiLeido({ ...data.datos, nacionalidad: data.nacionalidad, numeroIlegible: data.numeroIlegible });
                        }
                    } catch (errLectura) {
                        // Catch propio y no el de arriba: el documento YA se
                        // subió. Dejar que caiga al catch del alta diría «Error
                        // al subir documento», que manda a mirar donde no está
                        // el problema y además borraría la subida buena.
                        console.error('leer-dui:', errLectura);
                        useToastStore.getState().showToast(
                            'No se pudo leer el documento',
                            'Escribe los datos a mano; el documento quedó guardado.',
                            'warning');
                    } finally {
                        setLeyendoDui(false);
                    }
                }
            }
        } catch (err) {
            useToastStore.getState().showToast('Error al subir documento', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
            updateDoc(category, { url: null, file_name: '' });
        } finally {
            setAnalyzingDocs(prev => ({ ...prev, [category]: false }));
        }
    };

    const removeDocFile = (category) => updateDoc(category, { url: null, file_name: '' });

    const extraDocs = (formData.employee_documents || []).filter(d => d.category?.startsWith('EXTRA_'));
    const addExtraDoc = () => setFormData(prev => ({ ...prev, employee_documents: [...(prev.employee_documents || []), { category: `EXTRA_${Date.now()}`, title: '', file_name: '', url: null, expiry_date: '' }] }));
    const removeExtraDoc = (category) => setFormData(prev => ({ ...prev, employee_documents: (prev.employee_documents || []).filter(d => d.category !== category) }));

    // Herramientas y materiales (Art. 23 nº10). Se indexan por posición y no
    // por una clave inventada: la lista es corta, se edita entera de una y no
    // hay nada externo que las referencie.
    const addHerramienta = () => setFormData(prev => ({ ...prev, herramientas_entregadas: [...(prev.herramientas_entregadas || []), { descripcion: '', cantidad: '', estado: '' }] }));
    const updateHerramienta = (idx, patch) => setFormData(prev => ({
        ...prev,
        herramientas_entregadas: (prev.herramientas_entregadas || []).map((h, i) => i === idx ? { ...h, ...patch } : h),
    }));
    // Una prórroga arranca donde termina el contrato vigente: `desde` se toma
    // del fin actual y no se pide, porque es un dato que el portal ya sabe y
    // pedirlo invita a escribir uno que no coincide con la cadena.
    const agregarProrroga = () => setFormData(prev => ({
        ...prev,
        contrato_prorrogas: [...(prev.contrato_prorrogas || []), { desde: prev.contract_end_date || null, hasta: null, motivo: '' }],
    }));
    const actualizarProrroga = (idx, patch) => setFormData(prev => {
        const lista = (prev.contrato_prorrogas || []).map((p, i) => i === idx ? { ...p, ...patch } : p);
        // El fin del contrato pasa a ser el de la última prórroga con fecha: si
        // no, la ficha diría que venció mientras la prórroga dice que sigue.
        const ultima = [...lista].reverse().find(p => p.hasta);
        return { ...prev, contrato_prorrogas: lista, contract_end_date: ultima?.hasta ?? prev.contract_end_date };
    });
    const quitarProrroga = (idx) => setFormData(prev => ({
        ...prev, contrato_prorrogas: (prev.contrato_prorrogas || []).filter((_, i) => i !== idx),
    }));

    const removeHerramienta = (idx) => setFormData(prev => ({ ...prev, herramientas_entregadas: (prev.herramientas_entregadas || []).filter((_, i) => i !== idx) }));

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
                {/* Canónico `FileField` (2c, 2026-07-27). `busy` conserva el
                    "Subiendo y analizando con IA…" que este modal ya mostraba:
                    la subida dispara `analyze-document` y puede tardar varios
                    segundos, así que la fila tiene que decirlo. */}
                <FileField
                    accept=".pdf,.jpg,.jpeg,.png"
                    density="sm"
                    busy={isAnalyzing}
                    busyLabel="Subiendo y analizando con IA…"
                    url={doc.url}
                    name={doc.file_name}
                    onChange={f => f ? handleDocFile(category, f) : removeDocFile(category)}
                />
                {showExpiry && hasFile && !isAnalyzing && (
                    <div className="mt-2">
                        <label className="text-micro font-bold text-content-2 uppercase tracking-wide mb-1 flex items-center justify-between">
                            <span>Fecha de Vencimiento (opcional) — detectada por IA si el documento la trae</span>
                            {expiryBadge && <Badge variant={expiryBadge.variant} size="sm" uppercase={false} className="ml-1 shrink-0">{expiryBadge.label}</Badge>}
                        </label>
                        <div className="bg-surface-card rounded-xl border border-divider h-[36px] flex items-center px-1.5">
                            <LiquidDatePicker value={doc.expiry_date} onChange={(date) => updateDoc(category, { expiry_date: date })} />
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

    // El aviso de DUI repetido lo contesta el SERVIDOR desde el 2026-08-24, cuando
    // `dui` salió de `employees_safe`. Cruzarlo contra `employees` acá dejó de
    // funcionar y no de forma ruidosa: el padrón trae el campo sólo para quien
    // tiene la llave del expediente, así que para el resto `emp.dui` es
    // `undefined` y `some()` diría «no hay duplicado» siempre.
    //
    // Se pregunta con retardo y sólo con el número completo — es una consulta por
    // tecleo, no por letra. Y la respuesta se descarta si mientras tanto el campo
    // cambió: sin ese corte, la respuesta lenta de un número viejo pinta el aviso
    // sobre el número nuevo.
    const [isDuiDuplicate, setIsDuiDuplicate] = useState(false);
    useEffect(() => {
        const dui = formData?.dui;
        if (!dui || dui.length < 10) { setIsDuiDuplicate(false); return undefined; }
        let vigente = true;
        const t = setTimeout(async () => {
            const libre = await duiDisponible(dui, formData?.id ?? null);
            if (vigente) setIsDuiDuplicate(libre === false);
        }, 400);
        return () => { vigente = false; clearTimeout(t); };
    }, [formData?.dui, formData?.id]);

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
    // Un contrato civil de servicios profesionales tiene plazo: se pacta hasta
    // cuándo. Faltaba —y encima esto seguía nombrando 'PRACTICAS', que ya no
    // existe como tipo—, así que a un contrato de servicios no se le pedía
    // fecha de fin y quedaba abierto sin que nadie lo notara.
    const contractHasEndDate = formData?.contract_type === 'TEMPORAL' || esContratoCivil(formData?.contract_type);
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
    /* ── Qué apaga Guardar, y qué NO ────────────────────────────────────────
     *
     * Antes esto exigía DUI, género, estado civil, sala, cargo y código. El
     * resultado medido el 2026-08-26: **48 de las 49 fichas no se podían ni
     * abrir y guardar**, así que para anotarle el teléfono a alguien había que
     * traer primero su DUI. Es la forma exacta de
     * [[feedback_una_verificacion_que_traba_la_accion_no_se_hace]]: la regla
     * era correcta y el MOMENTO estaba mal, y el atajo que produce es dar de
     * alta a la persona con datos inventados.
     *
     * Pedido del usuario: «que se pueda guardar un empleado sin importar qué,
     * al menos como mínimo nombre… pero queda como borrador, los datos siguen
     * siendo requeridos». Así que la línea se movió:
     *
     *   BLOQUEA sólo lo que hace daño escribir mal — un dato con formato
     *   inválido (un DUI cuyo dígito verificador no cuadra, un teléfono que no
     *   es de El Salvador, una edad fuera de rango). Guardar eso ensucia el
     *   expediente y después nadie sabe si es un error o el dato real.
     *
     *   NO BLOQUEA lo que falta. Ausente es un estado legítimo del expediente
     *   —lo dice el propio Art. 23: el contrato se firma después—, y se ve en
     *   «Información Pendiente» y en la lista de personal.
     *
     * O sea: **vacío se guarda, mal escrito no.**
     */
    const isFormFullyValid = useMemo(() => {
        // Lo único imprescindible: sin nombre no hay a quién nombrar la ficha.
        if (!formData?.first_names?.trim() || firstNamesInvalid) return false;
        if (!formData?.last_names?.trim() || lastNamesInvalid) return false;

        // ── De acá abajo, TODO es «si está, que esté bien» ──────────────────
        // Ninguna condición exige presencia: cada una se dispara sólo cuando
        // el campo tiene contenido y el contenido no cuadra.
        if (!isMinor && (isDuiInvalid || isDuiDuplicate || isDuiIncomplete)) return false;
        if (birthDateInvalid) return false;

        // Un departamento sin municipio es una dirección a medias que después
        // no se puede resolver: o los dos, o ninguno.
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

        // «Otra…» sin especificar no es un dato: es el placeholder del catálogo
        // guardado como si fuera una respuesta.
        if (formData?.education_specialty === OTRA_ESPECIALIDAD) return false;
        if (formData?.profession === OTRA_ESPECIALIDAD) return false;
        if (formData?.has_maestria && formData?.maestria_title === OTRA_ESPECIALIDAD) return false;
        if (studyEndInPast || maestriaStudyEndInPast) return false;

        for (const dep of (formData?.economic_dependents || [])) {
            if (isDependentAgeInvalid(dep)) return false;
        }

        if (formData?.has_disability && formData?.disability_type === OTRA_ESPECIALIDAD) return false;

        if (salaryInvalid) return false;
        if (hoursInvalid) return false;
        if (contractDatesInvalid) return false;
        // El plazo sin base legal ni motivo escrito SÍ bloquea, y es la única
        // ausencia que lo hace: el Art. 25 presume indefinido un contrato a
        // plazo sin justificar, así que guardarlo así no deja «un dato
        // pendiente» — deja un contrato que dice algo que la ley no reconoce.
        if (temporalBasisMissing || temporalReasonMissing) return false;

        if (isssIncomplete) return false;
        if (afpIncomplete) return false;

        return true;
    }, [formData, firstNamesInvalid, lastNamesInvalid, isMinor,
        isDuiInvalid, isDuiDuplicate, isDuiIncomplete, birthDateInvalid,
        phoneHasError, emailInvalid, studyEndInPast, maestriaStudyEndInPast,
        salaryInvalid, hoursInvalid, contractDatesInvalid,
        temporalBasisMissing, temporalReasonMissing, isssIncomplete, afpIncomplete]);

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

    /* ── Enlazar con una ficha que ya existe ────────────────────────────────
     *
     * El expediente se está rehaciendo desde cero, pero la gente no es nueva:
     * cada persona ya tiene solicitudes, traslados, bolsas, conteos y bitácoras
     * colgando de su ficha. Elegir a alguien acá hace que lo escrito en este
     * formulario se guarde SOBRE esa ficha en vez de crear una segunda — o sea
     * que no hay historial que mover, porque nunca se despega.
     *
     * Sólo al dar de alta. En edición no tiene sentido: la ficha ya es una.
     */
    const fichasParaEnlazar = useMemo(() => {
        if (isEditMode) return [];
        const nombreDeSala = (id) => branches?.find(b => String(b.id) === String(id))?.name || 'Sin sala';
        const nombreDeCargo = (id) => roles?.find(r => String(r.id) === String(id))?.name || 'Sin cargo';
        return [...(employees || [])]
            .filter(e => e.status !== 'INACTIVO')
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'))
            .map(e => ({
                value: String(e.id),
                label: `${e.name} · ${nombreDeSala(e.branch_id ?? e.branchId)} · ${nombreDeCargo(e.role_id)}`,
            }));
    }, [employees, branches, roles, isEditMode]);

    const idAEnlazar = formData?.enlazar_con_id || '';
    const fichaAEnlazar = useMemo(
        () => (idAEnlazar ? (employees || []).find(e => String(e.id) === String(idAEnlazar)) || null : null),
        [employees, idAEnlazar]);

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

    // Quién lo cubre mientras no está. Sale de la tabla —nunca de una lista
    // escrita a mano— y excluye a la propia persona (la BD también lo prohíbe).
    const suplenteOpts = useMemo(() => (employees || [])
        .filter(e => e.status === 'ACTIVO' && String(e.id) !== String(formData?.id))
        .map(e => ({
            value: String(e.id),
            label: e.name || `${e.first_names || ''} ${e.last_names || ''}`.trim(),
            sublabel: e.role || undefined,
            avatar: e.photo || undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
        [employees, formData?.id]);

    const islandClass ="bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
    const islandHoverClass = "transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-glass-4)] hover:bg-surface-card";

    // 🚨 Propiedades base para que los selects floten libres del Modal
    const portalSelectProps = {
        menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
        menuPosition: "fixed",
        styles: { menuPortal: base => ({ ...base, zIndex: 99999 }) }
    };

    if (!formData) return null;

    return (
        <div className="flex flex-col w-full h-full relative z-base" onKeyDown={handleKeyDown}>

            {/* ALERTA DE BORRADOR (solo en creación) */}
            {!isEditMode && hasDraft && (
                <div className="mx-auto mb-4 bg-brand/10 border border-brand/30 p-3 rounded-2xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 w-full max-w-lg">
                    <div className="flex items-center gap-2 text-brand-text">
                        <RotateCcw size={16} strokeWidth={2.5} />
                        <span className="text-label font-bold">Tienes un borrador sin guardar.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" icon={Trash2} iconOnly onClick={discardDraft} />
                        <Button size="sm" onClick={restoreDraft}>Restaurar</Button>
                    </div>
                </div>
            )}

            {/* Contado y plegado, no enumerado. Ver el comentario de `pendientes`. */}
            {fichaEmpezada && (pendientes.length + vencimientos.length) > 0 && (
                <div className="mb-3 bg-warning/10 border border-warning/30 p-3 rounded-2xl shadow-sm animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <AlertCircle size={16} className="text-warning shrink-0" strokeWidth={2.5} />
                        <p className="text-label text-warning-text font-medium leading-tight flex-1 min-w-0">
                            <span className="font-black">{pendientes.length + vencimientos.length} pendiente{(pendientes.length + vencimientos.length) === 1 ? '' : 's'}</span>
                            {' '}en el expediente. Se puede guardar así y completarlo después.
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setVerPendientes(v => !v)}>
                            {verPendientes ? 'Ocultar' : 'Ver cuáles'}
                        </Button>
                    </div>
                    {verPendientes && (
                        <ul className="mt-3 flex flex-wrap gap-1.5 animate-in fade-in">
                            {[...pendientes, ...vencimientos].map(f => (
                                <li key={f.campo}
                                    title={f.art ? `Código de Trabajo, Art. ${f.art}` : undefined}
                                    className="text-micro font-bold bg-surface-card border border-border-card rounded-full px-2 py-0.5 text-content-2">
                                    {f.label}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* AVISO EN MODO EDICIÓN */}
            {isEditMode && (
                <div className="mb-4 bg-warning/10 border border-warning/30 p-3 rounded-2xl flex items-start gap-3 shadow-sm">
                    <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                    <p className="text-label text-warning-text font-medium leading-tight">
                        Los campos marcados con <span className="font-black">Acción RRHH</span> (sucursal, cargo, salario, contrato) solo se pueden modificar mediante una acción de personal desde el perfil del empleado.
                    </p>
                </div>
            )}

            {/* CONTENEDOR ANIMADO */}
            <div key={activeTab} className="w-full space-y-4 animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)] fill-mode-both">
                
                {/* TAB 1: DATOS PERSONALES */}
                {activeTab === 'personal' && (
                    <>
                        {/* ALERTA DE HOMÓNIMOS */}
                        {isHomonymWarning && (
                            <div className="bg-warning/10 border border-warning/30 p-3 rounded-2xl flex items-start gap-3 shadow-sm animate-in slide-in-from-top-4 mb-2">
                                <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                <div>
                                    <h4 className="text-label font-black uppercase tracking-widest text-warning-text">Posible Duplicado</h4>
                                    <p className="text-label text-warning-text font-medium leading-tight mt-0.5">Ya existe un empleado registrado con este mismo nombre completo. Si es la misma persona, enlázala abajo en vez de crear una ficha nueva. Si es otra (homónimo), sigue adelante.</p>
                                </div>
                            </div>
                        )}

                        {/* ENLAZAR CON UNA FICHA QUE YA EXISTE — sólo al dar de alta.
                            Ver el comentario de `fichasParaEnlazar`: esto NO crea una
                            segunda ficha, escribe sobre la elegida. Es la única forma
                            de conservar el historial sin moverlo, y mover el historial
                            sería mover 129 columnas repartidas en ~70 tablas. */}
                        {!isEditMode && (
                            <div className={`${islandClass} ${islandHoverClass}`}>
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20">
                                        <Link2 size={16} strokeWidth={2.5} />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content">¿Esta persona ya trabajaba aquí?</h4>
                                        <p className="text-label font-medium text-content-3 leading-snug mt-0.5">Enlázala con su ficha para que conserve sus solicitudes, traslados y todo lo que ya hizo. Déjalo vacío si es alguien que entra por primera vez.</p>
                                    </div>
                                </div>

                                <LiquidSelect
                                    value={formData.enlazar_con_id || ''}
                                    onChange={(val) => {
                                        // Su foto, su sala y su cargo vienen con él: son datos
                                        // que el portal YA tiene, y volver a pedirlos es pedir
                                        // que alguien acierte lo que está a un clic. Sólo llena
                                        // lo VACÍO, igual que el DUI — si quien carga ya eligió
                                        // otra sala manda ésa, porque puede estar trasladando a
                                        // la persona en el mismo movimiento.
                                        const ficha = (employees || []).find(e => String(e.id) === String(val));
                                        setFormData(prev => {
                                            const next = { ...prev, enlazar_con_id: val };
                                            if (!ficha) return next;
                                            if (!prev.branch_id) next.branch_id = ficha.branch_id ?? ficha.branchId ?? '';
                                            if (!prev.role_id) next.role_id = ficha.role_id ?? '';
                                            if (!prev.secondary_role_id) next.secondary_role_id = ficha.secondary_role_id ?? '';
                                            if (!prev.photoPreview && !prev.file) next.photoPreview = ficha.photo || ficha.photo_url || null;
                                            return next;
                                        });
                                    }}
                                    options={fichasParaEnlazar}
                                    placeholder="Buscar a la persona por su nombre..."
                                    icon={Users}
                                    {...portalSelectProps}
                                />

                                {fichaAEnlazar && (
                                    <div className="mt-3 bg-brand/10 border border-brand/30 p-3 rounded-2xl flex items-start gap-3 shadow-sm animate-in slide-in-from-top-2">
                                        <CheckCircle2 size={16} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                                        <p className="text-label text-content font-medium leading-snug">
                                            Al guardar, la ficha de <span className="font-black">{fichaAEnlazar.name}</span> queda con
                                            todo lo que escribiste aquí —nombre, documento, cargo, sala, contrato, sueldo, banco— y
                                            conserva su historial. <span className="font-black">No se crea un registro nuevo</span>, y
                                            lo que esa ficha tenía escrito antes se reemplaza.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── EL DOCUMENTO DE IDENTIDAD, AL INICIO ──────────────────
                            Pedido de Talento Humano: subirlo acá y no al final. El motivo
                            es que este documento LLENA MEDIA FICHA — el anverso trae el
                            número, los nombres, el sexo y las fechas; el reverso, el
                            domicilio, la profesión, el estado familiar y el tipo de sangre.
                            Medido el 2026-08-26: DUI, género y estado civil eran tres de
                            los cuatro campos por los que 48 de 49 fichas no se podían
                            guardar. Pedirlo al final obliga a teclear lo que el papel ya
                            dijo. Los documentos que NO alimentan ningún campo (CV, contrato
                            firmado) siguen en su pestaña. */}
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center justify-between mb-3 gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20">
                                        <Fingerprint size={16} strokeWidth={2.5} />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content">{isMinor ? altIdDocTypeLabel : 'DUI — los dos lados'}</h4>
                                        <p className="text-label font-medium text-content-3 leading-snug mt-0.5">
                                            {isMinor
                                                ? 'Súbelo y después escribe los datos: un documento alterno no tiene formato fijo.'
                                                : 'Sube las dos caras y el portal lee los datos. Tú confirmas antes de que entren.'}
                                        </p>
                                    </div>
                                </div>
                                {!(isMinor ? !!getDocEntry('DOCUMENTO_IDENTIDAD').url : (duiEnUnArchivo ? !!getDocEntry('DUI_COMPLETO').url : (!!getDocEntry('DUI_FRENTE').url && !!getDocEntry('DUI_REVERSO').url))) && (
                                    <Badge variant="warning" size="sm" className="shrink-0">Pendiente</Badge>
                                )}
                            </div>

                            {/* Talento Humano recibe el DUI de las dos formas: dos fotos
                                sueltas, o un solo PDF con las dos caras adentro. Obligar a
                                partir el PDF en dos imágenes sería trabajo manual para que el
                                portal pueda leerlo — al revés de para lo que existe. El
                                lector acepta uno o dos archivos. */}
                            {!isMinor && (
                                <div className="flex items-center gap-1.5 mb-3">
                                    {[{ v: false, l: 'Frente y reverso' }, { v: true, l: 'Un solo archivo' }].map(op => (
                                        <button key={String(op.v)} type="button"
                                            onClick={() => setDuiEnUnArchivo(op.v)}
                                            aria-pressed={duiEnUnArchivo === op.v}
                                            className={`min-h-[var(--tap-min)] px-3 rounded-full text-micro font-black uppercase tracking-wide border transition-all active:scale-[0.97] ${
                                                duiEnUnArchivo === op.v
                                                    ? 'bg-brand text-white border-brand shadow-[var(--shadow-glow-brand)]'
                                                    : 'bg-surface-card text-content-2 border-border-card hover:border-brand/40'}`}>
                                            {op.l}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {isMinor ? (
                                renderDocUploadArea('DOCUMENTO_IDENTIDAD')
                            ) : duiEnUnArchivo ? (
                                <div>
                                    <label className="text-micro font-bold text-content-2 uppercase tracking-wide mb-1 flex items-center justify-between">
                                        <span>Documento completo (las dos caras)</span>
                                        {!getDocEntry('DUI_COMPLETO').url && <span className="text-warning font-black">Pendiente</span>}
                                    </label>
                                    {renderDocUploadArea('DUI_COMPLETO')}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-micro font-bold text-content-2 uppercase tracking-wide mb-1 flex items-center justify-between">
                                            <span>Frente</span>
                                            {!getDocEntry('DUI_FRENTE').url && <span className="text-warning font-black">Pendiente</span>}
                                        </label>
                                        {renderDocUploadArea('DUI_FRENTE')}
                                    </div>
                                    <div>
                                        <label className="text-micro font-bold text-content-2 uppercase tracking-wide mb-1 flex items-center justify-between">
                                            <span>Reverso</span>
                                            {!getDocEntry('DUI_REVERSO').url && <span className="text-warning font-black">Pendiente</span>}
                                        </label>
                                        {renderDocUploadArea('DUI_REVERSO', { showExpiry: false })}
                                    </div>
                                </div>
                            )}

                            {leyendoDui && (
                                <p className="mt-3 text-label font-bold text-brand-text flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin" /> Leyendo el documento…
                                </p>
                            )}

                            {duiLeido && !leyendoDui && (() => {
                                const { parche, descartados } = aplicarDuiLeido(duiLeido, formData);
                                const campos = Object.keys(parche);
                                return (
                                    <div className="mt-3 bg-brand/10 border border-brand/30 p-3 rounded-2xl animate-in slide-in-from-top-2">
                                        <div className="flex items-start gap-3">
                                            <CheckCircle2 size={16} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                                            <div className="min-w-0 flex-1">
                                                {campos.length > 0 ? (
                                                    <>
                                                        <p className="text-label text-content font-medium leading-snug">
                                                            El documento dice <span className="font-black">{campos.length}</span> dato{campos.length === 1 ? '' : 's'} que
                                                            todavía no {campos.length === 1 ? 'está' : 'están'} en la ficha:
                                                        </p>
                                                        <ul className="mt-2 flex flex-wrap gap-1.5">
                                                            {campos.map(c => (
                                                                <li key={c} className="text-micro font-bold bg-surface-card border border-border-card rounded-full px-2 py-0.5 text-content-2">
                                                                    {ROTULO_DUI[c] || c}: <span className="text-content font-black">{String(parche[c])}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </>
                                                ) : (
                                                    <p className="text-label text-content font-medium leading-snug">
                                                        Lo que dice el documento ya está escrito en la ficha. No hay nada que completar.
                                                    </p>
                                                )}

                                                {duiLeido.numeroIlegible && (
                                                    <p className="mt-2 text-label text-warning-text font-medium leading-snug">
                                                        El número no se leyó bien —el dígito verificador no cuadra— así que hay que escribirlo a mano.
                                                    </p>
                                                )}
                                                {descartados.length > 0 && (
                                                    <p className="mt-2 text-label text-content-3 font-medium leading-snug">
                                                        No se usó: {descartados.join(' · ')}. Escríbelo a mano si corresponde.
                                                    </p>
                                                )}

                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {campos.length > 0 && (
                                                        <Button size="sm" icon={CheckCircle2} onClick={() => {
                                                            setFormData(prev => ({ ...prev, ...aplicarDuiLeido(duiLeido, prev).parche }));
                                                            setDuiLeido(null);
                                                        }}>Usar estos datos</Button>
                                                    )}
                                                    <Button variant="ghost" size="sm" onClick={() => setDuiLeido(null)}>Descartar</Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            {/* ÁREA DE FOTO DE PERFIL */}
                            <div className="flex flex-col sm:flex-row items-center gap-6 mb-6 pb-6 border-b border-divider">
                                <div className="relative group cursor-pointer shrink-0">
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl border-4 border-border-card shadow-[var(--shadow-elevation-md)] overflow-hidden bg-surface-card-hover flex items-center justify-center transition-transform group-hover:scale-105 duration-[var(--dur-slow)]">
                                        {formData.photoPreview || formData.photo || formData.photo_url ? (
                                            <img src={formData.photoPreview || formData.photo || formData.photo_url} alt="Perfil" className="w-full h-full object-cover" />
                                        ) : (
                                            <User size={36} className="text-content-3" strokeWidth={2} />
                                        )}
                                    </div>
                                    <div className="absolute inset-0 bg-scrim backdrop-blur-sm rounded-3xl flex items-center justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-slow)]">
                                        <Camera size={24} className="text-white" />
                                    </div>
                                    <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} id="photo-upload" />
                                    <label htmlFor="photo-upload" className="absolute inset-0 cursor-pointer"></label>
                                </div>
                                <div className="text-center sm:text-left">
                                    <h4 className="text-body-xl font-black text-content tracking-tight">Fotografía Oficial</h4>
                                    <p className="text-label font-medium text-content-3 max-w-[250px] leading-snug mt-1">Usa una imagen clara y profesional. Aparecerá en el portal web y el kiosko biométrico.</p>
                                    {/* Tocar el avatar abre el explorador de archivos: dentro
                                        de la app eso NUNCA ofrece la cámara, hace falta un
                                        input propio con `accept` comodín + `capture` juntos
                                        (ver `capturaDeFoto.js`). En escritorio no aparece
                                        porque ahí `capture` se ignora y sería el mismo
                                        diálogo dos veces. */}
                                    {esTactil && (
                                        <>
                                            <input type="file" {...PROPS_CAMARA} className="hidden"
                                                onChange={handlePhotoUpload} id="photo-camara" />
                                            <label htmlFor="photo-camara"
                                                className="mt-2 inline-flex items-center gap-1.5 h-[max(34px,var(--tap-min))] px-3.5 rounded-btn cursor-pointer
                                                    text-[12.5px] font-bold text-content bg-gradient-to-b from-surface-card to-surface-card-hover
                                                    border border-border-card shadow-sm hover:shadow-md transition-shadow duration-[var(--dur-base)]">
                                                <Camera size={14} strokeWidth={2.5} /> Tomar foto
                                            </label>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Nombres" name="first_names" value={formData.first_names} onChange={handleChange} required hasError={firstNamesInvalid} errorMessage="Solo letras" />
                                <PortalInput label="Apellidos" name="last_names" value={formData.last_names} onChange={handleChange} required hasError={lastNamesInvalid} errorMessage="Solo letras" />

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Nacionalidad</label>
                                    <LiquidSelect value={formData.nationality} onChange={(val) => handleSelectChange('nationality', val)} options={NATIONALITY_OPTIONS} placeholder="Nacionalidad..." icon={Globe} clearable={false} {...portalSelectProps} />
                                </div>

                                <div className="relative z-tabs">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Fecha de Nacimiento {employeeAge !== null && !birthDateInvalid && <span className={`font-bold normal-case tracking-normal ${isMinor ? 'text-warning' : 'text-content-3'}`}>· {employeeAge} años{isMinor ? ' · Menor de Edad' : ''}</span>}</span>
                                        {birthDateInvalid && <span className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md ml-1">{birthDateErrorMsg}</span>}
                                    </label>
                                    <div className={`bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${birthDateInvalid ? '!border-danger !bg-danger/10' : isMinor ? '!border-warning/40 !bg-warning/10' : 'border-divider'}`}>
                                        <LiquidDatePicker value={formData.birth_date} onChange={(date) => handleDateChange('birth_date', date)} />
                                    </div>
                                </div>

                                {!isMinor && (
                                    <PortalInput label="DUI" name="dui" value={formData.dui} onChange={handleChange} icon={Fingerprint} placeholder="00000000-0" maskType="DUI" required hasError={isDuiInvalid || isDuiDuplicate || isDuiIncomplete} errorMessage={duiErrorMsg} />
                                )}

                                {isMinor && (
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Tipo de Documento</label>
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
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Especifica el Tipo de Documento</label>
                                        <CatalogOtherInput
                                            value={formData.alt_identity_document_type}
                                            onChange={(val) => handleSelectChange('alt_identity_document_type', val)}
                                            inputHoverClass={inputHoverClass}
                                            placeholder="Ej. Carné Consular"
                                        />
                                    </div>
                                )}

                                {/* Art. 23 nº2 CT: el numeral pide «número, LUGAR Y FECHA DE
                                    EXPEDICIÓN», y sólo se guardaba el número. Van juntos al
                                    documento —da igual si es DUI o el alterno del menor—
                                    porque es el mismo dato del contrato. No bloquean Guardar:
                                    salen en «Información Pendiente», como el ISSS y el AFP. */}
                                <PortalInput
                                    label="Lugar de expedición del documento" name="dui_lugar_expedicion"
                                    value={formData.dui_lugar_expedicion} onChange={handleChange}
                                    icon={MapPin} placeholder="Ej. Chalatenango" />

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha de expedición</label>
                                    <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                        <LiquidDatePicker value={formData.dui_fecha_expedicion} onChange={(date) => handleDateChange('dui_fecha_expedicion', date)} />
                                    </div>
                                </div>

                                {isMinor && (
                                    <div className="md:col-span-2 bg-warning/10 border border-warning/30 rounded-2xl p-3 flex items-start gap-3 animate-in fade-in zoom-in-95">
                                        <ShieldAlert size={18} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                        <p className="text-label text-warning-text font-medium leading-tight">
                                            <span className="font-black">Menor de edad (16-17 años).</span> Por Ley (Art. 116-117 Código de Trabajo): prohibido asignar turno nocturno, y requiere examen médico previo gratuito antes de admitirlo (con repetición anual hasta los 18 años). En El Salvador el DUI no se tramita hasta los 18 — por eso se pide un documento alterno (partida de nacimiento, carné de minoridad).
                                        </p>
                                    </div>
                                )}

                                <PortalInput
                                    label="Teléfono"
                                    name="phone"
                                    type="tel"
                                    icon={Phone}
                                    value={formData.phone || ''}
                                    onChange={handleChange}
                                    maskType="PHONE"
                                    placeholder="0000-0000"
                                    hasError={phoneHasError}
                                    errorMessage={phoneErrorMsg}
                                    labelAction={
                                        <Button variant="ghost" size="xs" icon={Plus} onClick={addPhone}>Agregar</Button>
                                    }
                                />

                                <PortalInput label="Correo Electrónico" name="email" value={formData.email} onChange={handleChange} type="email" icon={Mail} placeholder="nombre@correo.com" hasError={emailInvalid} errorMessage="Correo inválido" />

                                {(formData.extra_phones || []).length > 0 && (
                                    <div className="md:col-span-2 flex flex-col gap-2">
                                        {(formData.extra_phones || []).map((ph, idx) => {
                                            const dLen = digitsLen(ph);
                                            const phErr = !!ph && dLen > 0 && (dLen < 8 || !isValidSVPhone(ph));
                                            return (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className={`relative flex-1 bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${phErr ? '!border-danger !bg-danger/10' : 'border-divider'}`}>
                                                        <div className="absolute left-3 text-content-3"><Phone size={14} strokeWidth={2.5} /></div>
                                                        <input type="tel" value={ph} onChange={(e) => updatePhone(idx, e.target.value)} placeholder="0000-0000"
                                                            className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                                    </div>
                                                    <Button variant="ghost" size="sm" icon={X} title="Quitar teléfono" iconOnly onClick={() => removePhone(idx)} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Género</span>
                                        {!formData.gender && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                    </label>
                                    <LiquidSelect invalid={!formData.gender} value={formData.gender} onChange={(val) => handleSelectChange('gender', val)} options={GENDER_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                </div>
                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Estado Civil</span>
                                        {!formData.marital_status && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                    </label>
                                    <LiquidSelect invalid={!formData.marital_status} value={formData.marital_status} onChange={(val) => handleSelectChange('marital_status', val)} options={MARITAL_STATUS_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                </div>
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Dirección Detallada" name="address" value={formData.address} onChange={handleChange} icon={MapPin} placeholder="Colonia, Calle, Número de Casa..." colSpan={2} />

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Departamento</label>
                                    <LiquidSelect value={formData.department} onChange={(val) => handleSelectChange('department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                </div>
                                <div className="relative z-base">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Municipio</span>
                                        {formData.department && !formData.municipality && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                    </label>
                                    <LiquidSelect invalid={formData.department && !formData.municipality} value={formData.municipality} onChange={(val) => handleSelectChange('municipality', val)} options={municipioOpts} placeholder={formData.department ? 'Municipio...' : 'Elija Depto.'} disabled={!formData.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                </div>

                                {/* El TERCER nivel. Desde la Ley Especial para la
                                    Reestructuración Municipal (vigente 1-may-2024) el país
                                    tiene 14 departamentos, 44 municipios y 262 distritos —
                                    los distritos son los municipios de antes. El catálogo
                                    ya existía: se construyó para la ficha fiscal del
                                    cliente, que es lo que pide el ERP. */}
                                <div className="relative z-base">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Distrito</span>
                                        {formData.municipality && !formData.distrito && <Badge variant="warning" uppercase={false}>Pendiente</Badge>}
                                    </label>
                                    <LiquidSelect value={formData.distrito} onChange={(val) => handleSelectChange('distrito', val)} options={distritoOpts} placeholder={formData.municipality ? 'Distrito...' : 'Elija municipio'} disabled={!formData.municipality} icon={Navigation} clearable={false} {...portalSelectProps} />
                                </div>

                                <div className="md:col-span-2 -mt-2">
                                    <Button variant="ghost" icon={Plus} onClick={addAddress}>Agregar Dirección Alterna</Button>
                                </div>

                                {(formData.extra_addresses || []).length > 0 && (
                                    <div className="md:col-span-2 flex flex-col gap-3">
                                        {(formData.extra_addresses || []).map((addr, idx) => {
                                            const altMunicipioOpts = addr.department && EL_SALVADOR_GEO[addr.department]
                                                ? EL_SALVADOR_GEO[addr.department].map(m => ({ value: m, label: m }))
                                                : [];
                                            return (
                                                <div key={idx} data-surface="card" className="p-3 bg-surface-card-hover/60">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Dirección Alterna {idx + 1}</span>
                                                        <Button variant="ghost" size="xs" icon={X} title="Quitar dirección" iconOnly onClick={() => removeAddress(idx)} />
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Departamento</label>
                                                            <LiquidSelect value={addr.department} onChange={(val) => updateAddress(idx, 'department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                                        </div>
                                                        <div>
                                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                                <span>Municipio</span>
                                                                {addr.department && !addr.municipality && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                                            </label>
                                                            <LiquidSelect invalid={addr.department && !addr.municipality} value={addr.municipality} onChange={(val) => updateAddress(idx, 'municipality', val)} options={altMunicipioOpts} placeholder={addr.department ? 'Municipio...' : 'Elija Depto.'} disabled={!addr.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Dirección Detallada</label>
                                                            <div className={`relative bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                                <div className="absolute left-3 text-content-3"><MapPin size={14} strokeWidth={2.5} /></div>
                                                                <input type="text" value={addr.address || ''} onChange={(e) => updateAddress(idx, 'address', e.target.value)} placeholder="Colonia, Calle, Número de Casa..."
                                                                    className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* ── OTROS CONTACTOS ───────────────────────────────────
                                Hasta hoy se podían guardar varios TELÉFONOS de UNA persona,
                                que no es lo mismo que varias personas. El de arriba sigue
                                siendo el principal y sigue viviendo en sus columnas —son las
                                que lee el resto del portal—; éstos se guardan en
                                `emergency_contacts` JUNTO CON ÉL, de modo que esa columna es
                                la lista completa y no una mitad. */}
                            <div className="mt-4 pt-4 border-t border-danger/30">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <p className="text-caption font-black uppercase tracking-widest text-danger/70 flex items-center gap-1.5">
                                        <Users size={12} strokeWidth={2.5} /> Otros contactos
                                    </p>
                                    <Button variant="ghost" icon={Plus} onClick={addContactoExtra}>Agregar contacto</Button>
                                </div>
                                {contactosExtra.length === 0 && (
                                    <p className="text-label text-content-3 font-medium">Sólo hay un contacto de emergencia.</p>
                                )}
                                <div className="flex flex-col gap-3">
                                    {contactosExtra.map((c, idx) => (
                                        <div key={idx} data-surface="card" className="p-3">
                                            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                                                <PortalInput aria-label="Nombre" compact value={c.nombre || ''}
                                                    onChange={(e) => updateContactoExtra(idx, { nombre: e.target.value })} placeholder="Nombre" />
                                                <div className="relative z-content">
                                                    <LiquidSelect value={c.parentesco || ''}
                                                        onChange={(val) => updateContactoExtra(idx, { parentesco: val })}
                                                        options={PARENTESCO_OPTIONS} placeholder="Parentesco…" {...portalSelectProps} />
                                                </div>
                                                <PortalInput aria-label="Teléfono" compact icon={Phone} maskType="PHONE"
                                                    value={c.telefono || ''}
                                                    onChange={(e) => updateContactoExtra(idx, { telefono: e.target.value })} placeholder="0000-0000" />
                                                <Button variant="ghost" icon={X} title="Quitar contacto" iconOnly onClick={() => removeContactoExtra(idx)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-chart-3/10 text-chart-3-text rounded-xl border border-chart-3/30 shadow-[var(--shadow-shine)]">
                                    <GraduationCap size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Nivel Académico</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative z-tabs">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Nivel Académico</label>
                                    <LiquidSelect value={formData.education_level} onChange={(val) => handleSelectChange('education_level', val)} options={EDUCATION_OPTIONS} placeholder="Nivel..." icon={GraduationCap} clearable={false} {...portalSelectProps} />
                                </div>

                                {formData.education_level === 'BASICA' && (
                                    <div className="relative z-content animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                            <span>Grado Finalizado</span>
                                            {!formData.education_grade_completed && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                        </label>
                                        <LiquidSelect invalid={!formData.education_grade_completed} value={formData.education_grade_completed} onChange={(val) => handleSelectChange('education_grade_completed', val)} options={GRADO_BASICA_OPTIONS} placeholder="Grado..." clearable={false} {...portalSelectProps} />
                                    </div>
                                )}

                                {LEVELS_WITH_SPECIALTY.includes(formData.education_level) && (() => {
                                    const specialtyOptions = formData.education_level === 'BACHILLERATO_TECNICO' ? bachilleratoTecnicoOptions : tecnicoSuperiorOptions;
                                    const isOtherSpecialty = isCatalogOther(formData.education_specialty, specialtyOptions);
                                    return (
                                        <>
                                            <div className="relative z-content animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Especialidad</span>
                                                    {!formData.education_specialty && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                                <div className="md:col-span-2 animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica la Especialidad</span>
                                                        {formData.education_specialty === OTRA_ESPECIALIDAD && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                            <div className="relative z-content animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Profesión / Título</span>
                                                    {!formData.profession && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                                <div className="md:col-span-2 animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica la Profesión / Título</span>
                                                        {formData.profession === OTRA_ESPECIALIDAD && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                    <div className="md:col-span-2 bg-chart-3/10 rounded-2xl p-3.5 border border-chart-3/30 animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                        <Checkbox
                                checked={!!formData.is_studying}
                                onChange={(v) => handleSelectChange('is_studying', v)}
                                label={<span className="text-label font-black text-chart-3-text uppercase tracking-wide">¿Actualmente estudiando?</span>}
                            />

                                        {!!formData.is_studying && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                <div>
                                                    <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 block">Mes de Inicio</label>
                                                    <div className="rounded-2xl h-[38px]">
                                                        <LiquidSelect value={formData.study_start_date ? formData.study_start_date.split('-')[1] : ''} onChange={(val) => handleStudyDateChange('month', val)} options={MONTH_OPTIONS} placeholder="Mes..." compact clearable={false} {...portalSelectProps} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 block">Año de Inicio</label>
                                                    <div className="rounded-2xl h-[38px]">
                                                        <LiquidSelect value={formData.study_start_date ? formData.study_start_date.split('-')[0] : ''} onChange={(val) => handleStudyDateChange('year', val)} options={YEAR_OPTIONS} placeholder="Año..." compact clearable={false} {...portalSelectProps} />
                                                    </div>
                                                </div>
                                                <PortalInput label="Duración (años)" name="study_duration_years" value={formData.study_duration_years} onChange={handleChange} type="number" placeholder="Ej. 2.5" hasError={studyEndInPast} />
                                            </div>
                                        )}
                                        {estimatedStudyEnd && (
                                            <p className={`text-caption font-bold mt-2 ml-1 ${studyEndInPast ? 'text-danger' : 'text-chart-3-text'}`}>
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
                                        <div className="md:col-span-2 bg-chart-3/10 rounded-2xl p-3.5 border border-chart-3/20 animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                            <Checkbox
                                checked={!!formData.has_maestria}
                                onChange={(v) => handleSelectChange('has_maestria', v)}
                                label={<span className="text-label font-black text-chart-3-text uppercase tracking-wide">¿Tiene Maestría / Postgrado?</span>}
                            />
                                            {!!formData.has_maestria && (
                                                <div className="mt-3 grid grid-cols-1 gap-3">
                                                    <div>
                                                        <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 flex items-center justify-between">
                                                            <span>Maestría / Postgrado</span>
                                                            {!formData.maestria_title && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                                            <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 block">Especifica la Maestría / Postgrado</label>
                                                            <CatalogOtherInput
                                                                value={formData.maestria_title}
                                                                onChange={(val) => handleSelectChange('maestria_title', val)}
                                                                inputHoverClass={inputHoverClass}
                                                                hasError={formData.maestria_title === OTRA_ESPECIALIDAD}
                                                                placeholder="Ej. Maestría en..."
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="pt-2 border-t border-chart-3/20">
                                                        <Checkbox
                                checked={!!formData.maestria_is_studying}
                                onChange={(v) => handleSelectChange('maestria_is_studying', v)}
                                label={<span className="text-label font-black text-chart-3-text uppercase tracking-wide">¿Maestría en curso?</span>}
                            />

                                                        {!!formData.maestria_is_studying && (
                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                                <div>
                                                                    <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 block">Mes de Inicio</label>
                                                                    <div className="rounded-2xl h-[38px]">
                                                                        <LiquidSelect value={formData.maestria_study_start_date ? formData.maestria_study_start_date.split('-')[1] : ''} onChange={(val) => handleMaestriaStudyDateChange('month', val)} options={MONTH_OPTIONS} placeholder="Mes..." compact clearable={false} {...portalSelectProps} />
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <label className="text-micro font-black uppercase tracking-widest text-chart-3-text ml-1 mb-1 block">Año de Inicio</label>
                                                                    <div className="rounded-2xl h-[38px]">
                                                                        <LiquidSelect value={formData.maestria_study_start_date ? formData.maestria_study_start_date.split('-')[0] : ''} onChange={(val) => handleMaestriaStudyDateChange('year', val)} options={YEAR_OPTIONS} placeholder="Año..." compact clearable={false} {...portalSelectProps} />
                                                                    </div>
                                                                </div>
                                                                <PortalInput label="Duración (años)" name="maestria_study_duration_years" value={formData.maestria_study_duration_years} onChange={handleChange} type="number" placeholder="Ej. 2" hasError={maestriaStudyEndInPast} />
                                                            </div>
                                                        )}
                                                        {estimatedMaestriaEnd && (
                                                            <p className={`text-caption font-bold mt-2 ml-1 ${maestriaStudyEndInPast ? 'text-danger' : 'text-chart-3-text'}`}>
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

                            <div className="mt-4 pt-4 border-t border-divider">
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">Cursos / Habilidades Adicionales</label>
                                <div className="flex flex-col gap-3">
                                    {(formData.additional_skills || []).map((entry, idx) => {
                                        const isOtherSkill = isCatalogOther(entry.skill, cursoHabilidadOptions);
                                        const isOtherInstitution = isCatalogOther(entry.institution, institucionOptions);
                                        return (
                                            <div key={idx} data-surface="card" className="p-3 bg-surface-card-hover/60">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Curso / Habilidad {idx + 1}</span>
                                                    <Button variant="ghost" size="xs" icon={X} title="Quitar" iconOnly onClick={() => removeSkill(idx)} />
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div className="md:col-span-2">
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Curso / Habilidad</label>
                                                        <CatalogSelect value={entry.skill} onChange={(val) => updateSkill(idx, 'skill', val)} options={cursoHabilidadOptions} portalSelectProps={portalSelectProps} inputHoverClass={inputHoverClass} placeholder="Curso/Habilidad..." />
                                                    </div>
                                                    {isOtherSkill && (
                                                        <div className="md:col-span-2">
                                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Especifica el Curso / Habilidad</label>
                                                            <CatalogOtherInput value={entry.skill} onChange={(val) => updateSkill(idx, 'skill', val)} inputHoverClass={inputHoverClass} placeholder="Especifica el curso o habilidad" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Institución</label>
                                                        <CatalogSelect value={entry.institution} onChange={(val) => updateSkill(idx, 'institution', val)} options={institucionOptions} portalSelectProps={portalSelectProps} inputHoverClass={inputHoverClass} placeholder="Institución..." />
                                                    </div>
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Horas Totales</label>
                                                        <input type="number" min="0" value={entry.hours || ''} onChange={(e) => updateSkill(idx, 'hours', e.target.value)} placeholder="Ej. 40"
                                                            className={`w-full h-[40px] px-4 bg-surface-card border border-divider rounded-2xl text-body-xl font-bold text-content-2 outline-none shadow-sm ${inputHoverClass}`} />
                                                    </div>
                                                    {isOtherInstitution && (
                                                        <div className="md:col-span-2">
                                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Especifica la Institución</label>
                                                            <CatalogOtherInput value={entry.institution} onChange={(val) => updateSkill(idx, 'institution', val)} inputHoverClass={inputHoverClass} placeholder="Especifica la institución" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <Button variant="ghost" icon={Plus} onClick={addSkill}>Agregar Curso / Habilidad</Button>
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-chart-9/10 text-chart-9-text rounded-xl border border-chart-9/20 shadow-[var(--shadow-shine)]">
                                    <Car size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Vehículos y licencias</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Checkbox
                                checked={!!formData.has_motorcycle}
                                onChange={(v) => handleSelectChange('has_motorcycle', v)}
                                label={<><Bike size={15} strokeWidth={2.5} className="text-content-3" /> <span className="text-label font-black text-content-2 uppercase tracking-wide">Posee Moto</span></>}
                            />
                                <Checkbox
                                checked={!!formData.has_car}
                                onChange={(v) => handleSelectChange('has_car', v)}
                                label={<><Car size={15} strokeWidth={2.5} className="text-content-3" /> <span className="text-label font-black text-content-2 uppercase tracking-wide">Posee Carro</span></>}
                            />
                                <Checkbox
                                checked={!!formData.has_motorcycle_license}
                                onChange={(v) => handleSelectChange('has_motorcycle_license', v)}
                                label={<><Bike size={15} strokeWidth={2.5} className="text-content-3" /> <span className="text-label font-black text-content-2 uppercase tracking-wide">Licencia de Motocicleta</span></>}
                            />
                                <Checkbox
                                checked={!!formData.has_car_license}
                                onChange={(v) => handleSelectChange('has_car_license', v)}
                                label={<><Car size={15} strokeWidth={2.5} className="text-content-3" /> <span className="text-label font-black text-content-2 uppercase tracking-wide">Licencia de Automóvil</span></>}
                            />
                            </div>
                            {(formData.has_motorcycle_license || formData.has_car_license) && (
                                <p className="text-micro text-content-3 font-bold mt-2 ml-1">La licencia se sube en la pestaña Documentos.</p>
                            )}
                        </div>

                        {/* ── ACREDITACIONES ────────────────────────────────────────
                            Pedido de Talento Humano: sacarlas de «Vehículos» y darles su
                            propia sección, con la acreditación que corresponde a la
                            profesión, la de dependiente de farmacia, y si ya tiene ISSS y
                            AFP.

                            Las tres juntas de salud son del Consejo Superior de Salud
                            Pública; contaduría NO —es el CVPCPA, otro organismo—, y por eso
                            cada una dice el suyo. Meterlas todas bajo «CSSP» mandaría a
                            quien vaya a verificar la cuarta al lugar equivocado.

                            Se DETECTAN por cargo y profesión, que ya están escritos: volver
                            a preguntar «¿es enfermero?» es pedir que alguien acierte algo
                            que el portal sabe. Lo que sí se pregunta es si la TIENE. */}
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20">
                                    <ShieldCheck size={16} strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Acreditaciones</h4>
                                    <p className="text-label font-medium text-content-3 leading-snug mt-0.5">
                                        El comprobante se sube aquí: de él salen el número y el vencimiento.
                                    </p>
                                </div>
                            </div>

                            {acreditacionesQueAplican.length === 0 && !formData.tiene_acreditacion_dependiente && (
                                <p className="text-label text-content-3 font-medium mb-4">
                                    Por el cargo y la profesión de esta persona no corresponde ninguna junta profesional.
                                    Si tiene la acreditación de dependiente de farmacia, márcala abajo.
                                </p>
                            )}

                            <div className="flex flex-col gap-3">
                                {acreditacionesQueAplican.map(a => (
                                    <div key={a.id} data-surface="card" className="p-3">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <div className="min-w-0">
                                                <p className="text-label font-black text-content uppercase tracking-wide">{a.label}</p>
                                                <p className="text-micro text-content-3 font-medium leading-snug">{a.organismo}</p>
                                            </div>
                                            {!formData[a.campo] && <Badge variant="warning" size="sm" className="shrink-0">Pendiente</Badge>}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                                            <PortalInput
                                                aria-label={`Número de ${a.junta}`} compact icon={Hash}
                                                value={formData[a.campo] || ''}
                                                onChange={(e) => handleSelectChange(a.campo, e.target.value)}
                                                placeholder={`N° ${a.junta}`} />
                                            {renderDocUploadArea(a.doc)}
                                        </div>
                                    </div>
                                ))}

                                {/* La acreditación de dependiente de farmacia es del CSSP y
                                    tiene trámite de REacreditación — o sea que vence, y por
                                    eso el comprobante lleva fecha. No depende de la
                                    profesión: la tiene quien atiende el mostrador. */}
                                <div data-surface="card" className="p-3">
                                    <Checkbox
                                        checked={!!formData.tiene_acreditacion_dependiente}
                                        onChange={(v) => handleSelectChange('tiene_acreditacion_dependiente', v)}
                                        label={<><ShieldCheck size={15} strokeWidth={2.5} className="text-content-3" /> <span className="text-label font-black text-content-2 uppercase tracking-wide">Acreditación de dependiente de farmacia</span></>}
                                    />
                                    {formData.tiene_acreditacion_dependiente && (
                                        <div className="mt-3 animate-in fade-in zoom-in-95">
                                            <p className="text-micro text-content-3 font-medium mb-2 leading-snug">
                                                La otorga el Consejo Superior de Salud Pública y se renueva: el comprobante lleva su vencimiento.
                                            </p>
                                            {renderDocUploadArea('DEPENDIENTE_FARMACIA')}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── ISSS Y AFP ────────────────────────────────────────
                                No se tramitan igual, y confundirlos hace que el portal le
                                pida a alguien un trámite que no puede hacer: al ISSS lo
                                inscribe el PATRONO; la AFP la elige el TRABAJADOR y sólo él
                                puede afiliarse. Por eso cada uno dice de quién es el
                                pendiente. */}
                            <div className="mt-4 pt-4 border-t border-divider">
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-3">ISSS y AFP</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">¿Ya tiene ISSS?</label>
                                        <LiquidSelect value={formData.isss_estado} onChange={(val) => handleSelectChange('isss_estado', val)} options={ESTADO_PREVISIONAL_OPTIONS} placeholder="Preguntar…" icon={ShieldCheck} {...portalSelectProps} />
                                    </div>
                                    <div className="relative z-content">
                                        <label className="text-caption fontetc-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">¿Ya tiene AFP?</label>
                                        <LiquidSelect value={formData.afp_estado} onChange={(val) => handleSelectChange('afp_estado', val)} options={ESTADO_PREVISIONAL_OPTIONS} placeholder="Preguntar…" icon={ShieldCheck} {...portalSelectProps} />
                                    </div>
                                </div>
                                {pendientesDePrevision.length > 0 && (
                                    <div className="mt-3 flex flex-col gap-2">
                                        {pendientesDePrevision.map(t => (
                                            <Notice key={t.clave} variant={t.estado === 'SIN_PREGUNTAR' ? 'info' : 'warning'} icon={AlertCircle}>
                                                <span className="font-black">{t.label}:</span>{' '}
                                                {t.estado === 'SIN_PREGUNTAR'
                                                    ? 'Todavía no se preguntó.'
                                                    : t.estado === 'EN_TRAMITE' ? 'En trámite.' : 'No tiene.'}{' '}
                                                {t.orientacion}
                                            </Notice>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-chart-9/10 text-chart-9-text rounded-xl border border-chart-9/20 shadow-[var(--shadow-shine)]">
                                    <Users size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Personas que Dependen Económicamente</h4>
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
                                            { value: 'employee', label: 'Mi dirección (empleado)' },
                                            ...(formData.economic_dependents || [])
                                                .map((d, i) => ({ d, i }))
                                                .filter(({ d, i }) => i !== idx && (d.address || d.department))
                                                .map(({ d, i }) => ({ value: `dep-${i}`, label: `Igual que ${d.name || `Persona ${i + 1}`}` })),
                                        ];
                                        return (
                                            <div key={idx} data-surface="card" className="p-3 bg-surface-card-hover/60">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Persona {idx + 1}</span>
                                                    <Button variant="ghost" size="xs" icon={X} title="Quitar persona" iconOnly onClick={() => removeDependent(idx)} />
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Nombre</label>
                                                        <div className={`relative bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                            <div className="absolute left-3 text-content-3"><User size={14} strokeWidth={2.5} /></div>
                                                            <input type="text" value={dep.name || ''} onChange={(e) => updateDependent(idx, 'name', e.target.value)} placeholder="Nombre completo"
                                                                className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                                                            <span className="flex items-center gap-1.5">
                                                                {depAgeOnly ? 'Edad' : 'Fecha de nacimiento'}
                                                                {depAgeInvalid && <span className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md shadow-sm border border-danger/30 normal-case tracking-normal">{dep.age === '' || dep.age == null ? 'Requerido' : `${MIN_DEPENDENT_AGE}-${MAX_DEPENDENT_AGE}`}</span>}
                                                            </span>
                                                            <Button variant="ghost" onClick={() => toggleDependentAgeMode(idx)}>{depAgeOnly ? 'Ingresar fecha' : 'No sé la fecha'}</Button>
                                                        </label>
                                                        {depAgeOnly ? (
                                                            <div className={`relative bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${depAgeInvalid ? '!border-danger !bg-danger/10' : 'border-divider'}`}>
                                                                <input type="number" min={MIN_DEPENDENT_AGE} max={MAX_DEPENDENT_AGE} step="1" value={dep.age ?? ''} onChange={(e) => updateDependent(idx, 'age', e.target.value)} placeholder="Edad en años"
                                                                    className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-4 pr-4" />
                                                            </div>
                                                        ) : (
                                                            <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                                <LiquidDatePicker value={dep.birth_date} onChange={(date) => updateDependent(idx, 'birth_date', date)} />
                                                            </div>
                                                        )}
                                                        {!depAgeOnly && depAge !== null && <span className="text-content-3 font-bold text-caption ml-1 mt-1 block">· {depAge} años</span>}
                                                    </div>
                                                    <div className="relative z-base">
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Parentesco</label>
                                                        <LiquidSelect value={dep.relationship} onChange={(val) => updateDependent(idx, 'relationship', val)} options={PARENTESCO_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                                    </div>

                                                    <div className="md:col-span-3 flex items-center justify-between -mb-1">
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 block">Dirección</label>
                                                        <div className="w-56">
                                                            <LiquidSelect value="" onChange={(val) => copyDependentAddress(idx, val)} options={copyOptions} placeholder="Copiar dirección de..." compact clearable={false} {...portalSelectProps} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Departamento</label>
                                                        <LiquidSelect value={dep.department} onChange={(val) => updateDependent(idx, 'department', val)} options={DEPARTAMENTOS_OPTS} placeholder="Departamento..." icon={MapIcon} clearable={false} {...portalSelectProps} />
                                                    </div>
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Distrito</label>
                                                        <LiquidSelect value={dep.municipality} onChange={(val) => updateDependent(idx, 'municipality', val)} options={depMunicipioOpts} placeholder={dep.department ? 'Municipio...' : 'Elija Depto.'} disabled={!dep.department} icon={Navigation} clearable={false} {...portalSelectProps} />
                                                    </div>
                                                    <div>
                                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Dirección Detallada</label>
                                                        <div className={`relative bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] ${inputHoverClass}`}>
                                                            <div className="absolute left-3 text-content-3"><MapPin size={14} strokeWidth={2.5} /></div>
                                                            <input type="text" value={dep.address || ''} onChange={(e) => updateDependent(idx, 'address', e.target.value)} placeholder="Colonia, Calle, Número de Casa..."
                                                                className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <Button variant="ghost" icon={Plus} onClick={addDependent}>Agregar Persona</Button>
                        </div>

                        <div className={`bg-danger/10 rounded-3xl p-4 md:p-5 border border-danger/30 shadow-[var(--shadow-elevation-xs)] transition-all duration-[var(--dur-slow)] hover:translate-y-[var(--lift-card)] hover:shadow-md`}>
                            <h4 className="text-body-sm font-black uppercase tracking-widest text-danger mb-4 flex items-center gap-2"><HeartPulse size={16} strokeWidth={2.5} /> Ficha Médica y Emergencia</h4>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="relative z-base">
                                    <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 block">Tipo de Sangre</label>
                                    <LiquidSelect value={formData.blood_type} onChange={(val) => handleSelectChange('blood_type', val)} options={BLOOD_TYPE_OPTIONS} placeholder="Vital..." clearable={false} {...portalSelectProps} />
                                </div>
                            </div>

                            <p className="text-caption font-black uppercase tracking-widest text-danger/70 mt-4 mb-3 pt-4 border-t border-danger/30 flex items-center gap-1.5">
                                <HeartPulse size={12} strokeWidth={2.5} /> Enfermedad Crónica / Condición Médica
                            </p>
                            {(formData.chronic_conditions || []).some(c => c && c !== OTRA_ESPECIALIDAD) && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {(formData.chronic_conditions || []).map((cond, idx) => {
                                        if (!cond || cond === OTRA_ESPECIALIDAD) return null;
                                        return (
                                            <span key={idx} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-surface-tab-active border border-danger/30 text-danger text-label font-bold shadow-sm animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                {cond}
                                                <Button variant="ghost" icon={X} title="Quitar condición" iconOnly onClick={() => removeChronicCondition(idx)} />
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
                                                <Button variant="ghost" icon={X} title="Quitar condición" iconOnly onClick={() => removeChronicCondition(idx)} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <Button variant="ghost" icon={Plus} onClick={addChronicCondition}>Agregar Condición</Button>

                            <p className="text-caption font-black uppercase tracking-widest text-danger/70 mt-4 mb-3 pt-4 border-t border-danger/30 flex items-center gap-1.5">
                                <ShieldCheck size={12} strokeWidth={2.5} /> Discapacidad
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Checkbox
                                checked={!!formData.has_disability}
                                onChange={(v) => handleSelectChange('has_disability', v)}
                                label={<span className="text-label font-black text-content-2 uppercase tracking-wide">¿Tiene alguna discapacidad?</span>}
                            />
                                {formData.has_disability && (() => {
                                    const isOtherDisability = isCatalogOther(formData.disability_type, tipoDiscapacidadOptions);
                                    return (
                                        <>
                                            <div className="relative z-base animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Tipo de Discapacidad</span>
                                                    {!formData.disability_type && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                            <div className="relative z-base animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 flex items-center justify-between">
                                                    <span>Grado</span>
                                                    {!formData.disability_grade && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                                </label>
                                                <LiquidSelect invalid={!formData.disability_grade} value={formData.disability_grade} onChange={(val) => handleSelectChange('disability_grade', val)} options={DISABILITY_GRADE_OPTIONS} placeholder="Grado..." clearable={false} {...portalSelectProps} />
                                            </div>
                                            <Checkbox
                                checked={!!formData.disability_has_certification}
                                onChange={(v) => handleSelectChange('disability_has_certification', v)}
                                label={<span className="text-label font-black text-content-2 uppercase tracking-wide">Cuenta con certificación (ISRI / CONAIPD)</span>}
                            />
                                            {isOtherDisability && (
                                                <div className="md:col-span-3 animate-in fade-in zoom-in-95 duration-[var(--dur-base)]">
                                                    <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 flex items-center justify-between">
                                                        <span>Especifica el Tipo de Discapacidad</span>
                                                        {formData.disability_type === OTRA_ESPECIALIDAD && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
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
                                                <p className="text-micro text-danger-text/90 font-bold -mt-1 ml-1 md:col-span-3">El documento correspondiente ya está disponible para subir en la pestaña Documentos.</p>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>

                            <p className="text-caption font-black uppercase tracking-widest text-danger/70 mt-4 mb-3 pt-4 border-t border-danger/30 flex items-center gap-1.5">
                                <Phone size={12} strokeWidth={2.5} /> Contacto de Emergencia
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <PortalInput label="Avisar a" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} placeholder="Nombre" />
                                <div className="relative z-base">
                                    <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 block">Parentesco</label>
                                    <LiquidSelect value={formData.emergency_contact_relationship} onChange={(val) => handleSelectChange('emergency_contact_relationship', val)} options={PARENTESCO_OPTIONS} placeholder="Seleccionar..." clearable={false} {...portalSelectProps} />
                                </div>

                                <div>
                                    <label className="text-caption font-black uppercase tracking-widest text-danger/80 ml-1 mb-1.5 flex items-center justify-between">
                                        <span>Teléfono de Emergencia {emergPhoneHasError && <span className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md ml-1">{emergPhoneErrorMsg}</span>}</span>
                                        <Button variant="ghost" icon={Plus} onClick={addEmergencyPhone}>Agregar</Button>
                                    </label>
                                    <div className={`relative bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] z-base border-divider ${inputHoverClass} ${emergPhoneHasError ? '!border-danger !bg-danger/10' : ''}`}>
                                        <div className="absolute left-3 text-content-3"><Phone size={14} strokeWidth={2.5} /></div>
                                        <input type="tel" name="emergency_contact_phone" value={formData.emergency_contact_phone || ''}
                                            onChange={(e) => { e.target.value = applyMask(e.target.value, 'PHONE'); handleChange(e); }}
                                            placeholder="0000-0000"
                                            className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                    </div>
                                </div>

                                {(formData.emergency_contact_extra_phones || []).length > 0 && (
                                    <div className="md:col-span-3 flex flex-col gap-2">
                                        {(formData.emergency_contact_extra_phones || []).map((ph, idx) => {
                                            const dLen = digitsLen(ph);
                                            const phErr = !!ph && dLen > 0 && (dLen < 8 || !isValidSVPhone(ph));
                                            return (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className={`relative flex-1 bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] ${inputHoverClass} ${phErr ? '!border-danger !bg-danger/10' : 'border-divider'}`}>
                                                        <div className="absolute left-3 text-content-3"><Phone size={14} strokeWidth={2.5} /></div>
                                                        <input type="tel" value={ph} onChange={(e) => updateEmergencyPhone(idx, e.target.value)} placeholder="0000-0000"
                                                            className="w-full h-full bg-transparent text-body-xl font-bold text-content-2 outline-none pl-9 pr-4" />
                                                    </div>
                                                    <Button variant="ghost" size="sm" icon={X} title="Quitar teléfono" iconOnly onClick={() => removeEmergencyPhone(idx)} />
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
                                        <LockedField label="Fecha de inicio de labores" value={formData.hire_date ? new Date(formData.hire_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'} />
                                    </>
                                ) : (
                                    <>
                                        <div className={`relative z-tabs ${isExterna ? 'md:col-span-2' : ''}`}>
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">Área de Trabajo <Badge variant="danger" uppercase={false}>Requerido</Badge></label>
                                            <LiquidSelect invalid={!formData.branch_id} value={formData.branch_id} onChange={(val) => { handleSelectChange('branch_id', val); if (!((branches||[]).find(b=>String(b.id)===String(val))?.type === 'EXTERNA')) setFormData(p=>({...p, assigned_branch_ids:[]})); }} options={branchOpts} placeholder="Seleccionar..." clearable={false} icon={Building2} {...portalSelectProps} />
                                        </div>
                                        {isExterna && (
                                            <div className="relative z-content md:col-span-2 animate-in fade-in slide-in-from-top-2 duration-[var(--dur-slow)]">
                                                <label className="text-caption font-black uppercase tracking-widest text-chart-9-text ml-1 mb-1.5 block">Farmacias Asignadas</label>
                                                <div className="flex flex-wrap gap-2 p-3 bg-chart-9/10 border border-chart-9/30 rounded-2xl min-h-[44px]">
                                                    {farmaciasOpts.map(opt => {
                                                        const assigned = (formData.assigned_branch_ids || []).map(String);
                                                        const isActive = assigned.includes(opt.value);
                                                        return (
                                                            <Button
                                                                size="xs"
                                                                tone="chart-9"
                                                                key={opt.value}
                                                                type="button"
                                                                onClick={() => setFormData(p => { const cur = (p.assigned_branch_ids || []).map(String); return { ...p, assigned_branch_ids: isActive ? cur.filter(id => id !== opt.value) : [...cur, opt.value] }; })}
                                                            >{opt.label}</Button>
                                                        );
                                                    })}
                                                </div>
                                                {(formData.assigned_branch_ids || []).length === 0 && <p className="text-micro text-chart-9-text font-bold mt-1.5 ml-1">Sin farmacias asignadas — el personal externo cubre todas por defecto.</p>}
                                            </div>
                                        )}
                                        <div className="relative z-tabs">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha de inicio de labores</label>
                                            <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                <LiquidDatePicker value={formData.hire_date} onChange={(date) => handleDateChange('hire_date', date)} />
                                            </div>
                                        </div>
                                        <div className="relative z-content">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">Cargo Principal <Badge variant="danger" uppercase={false}>Requerido</Badge></label>
                                            <LiquidSelect invalid={!formData.role_id} value={formData.role_id} onChange={(val) => handleSelectChange('role_id', val)} options={roleOpts} placeholder="Cargo..." clearable={false} icon={ShieldCheck} {...portalSelectProps} />
                                        </div>
                                        <div className="relative z-base">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Cargo Secundario (Apoyo)</label>
                                            <LiquidSelect value={formData.secondary_role_id} onChange={(val) => handleSelectChange('secondary_role_id', val)} options={roleOpts} placeholder="Opcional..." clearable={false} icon={ShieldCheck} {...portalSelectProps} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Quién se hace cargo mientras no está. A diferencia del cargo,
                            esto SÍ se edita en cualquier momento: no es un cambio de puesto,
                            es una instrucción de cobertura. */}
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Si no está, lo cubre</label>
                                    <LiquidSelect value={formData.suplente_id || ''} onChange={(val) => handleSelectChange('suplente_id', val || null)} options={suplenteOpts} placeholder="Nadie en particular..." icon={Users} {...portalSelectProps} />
                                </div>
                                <p className="text-caption text-content-3 font-medium leading-snug md:pt-6">
                                    Mientras esté de vacaciones o incapacidad, esta persona resuelve lo que le corresponde
                                    —solo lo que su cargo tenga marcado para delegar—. Al volver, la cobertura se apaga sola.
                                    {' '}Sin nadie elegido, sigue cubriendo quien esté arriba en el organigrama.
                                </p>
                            </div>
                        </div>

                        {formData.contract_type === 'SERVICIOS' && (
                            <div className="bg-danger/10 border border-danger/30 rounded-2xl p-3.5 flex items-start gap-3">
                                <ShieldAlert size={18} className="text-danger shrink-0 mt-0.5" strokeWidth={2.5} />
                                <p className="text-label text-danger-text font-medium leading-tight">
                                    <span className="font-black">Riesgo legal — "Servicios profesionales" con subordinación.</span> El Art. 20 del Código de Trabajo presume un contrato laboral real (con derecho a aguinaldo, vacaciones, ISSS e indemnización) cuando hay subordinación — horario, cargo y sucursal asignados, como en este expediente. Un juez laboral puede reclasificarlo sin importar la etiqueta del contrato. Usa este tipo solo para relaciones genuinamente independientes, sin horario ni supervisión directa.
                                </p>
                            </div>
                        )}

                        {formData.contract_type === 'PRACTICAS' && (
                            <div className="bg-chart-1/10 border border-chart-1/30 rounded-2xl p-3.5 flex items-start gap-3">
                                <GraduationCap size={18} className="text-chart-1-text shrink-0 mt-0.5" strokeWidth={2.5} />
                                <p className="text-label text-chart-1-text font-medium leading-tight">
                                    <span className="font-black">Contrato de Aprendizaje (Art. 61-70 CT).</span> Requiere forma escrita y aprobación/inscripción ante el Ministerio de Trabajo (Art. 61) para ser válido como tal — si no se tramita, se presume relación laboral ordinaria. Salario mínimo reducido: no menor al 50% del mínimo legal durante el primer año, 75% durante el segundo, 100% desde el tercero (Art. 69). Ninguna de las partes incurre en responsabilidad por la terminación del contrato al llegar a su fin (Art. 68).
                                </p>
                            </div>
                        )}

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className={`grid grid-cols-1 gap-4 ${contractHasEndDate ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                                {isEditMode ? (
                                    <>
                                        <LockedField label="Tipo de contrato" value={CONTRACT_TYPE_OPTIONS.find(o => o.value === formData.contract_type)?.label || formData.contract_type} />
                                        <LockedField label="Fecha de contratación" value={formData.contract_start_date ? new Date(formData.contract_start_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'} />
                                    </>
                                ) : (
                                    <>
                                        <div className="relative z-tabs">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Tipo de contrato</label>
                                            <LiquidSelect value={formData.contract_type} onChange={(val) => handleSelectChange('contract_type', val)} options={CONTRACT_TYPE_OPTIONS} clearable={false} icon={Briefcase} {...portalSelectProps} />
                                        </div>
                                        <div className="relative z-tabs">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha de contratación</label>
                                            <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                <LiquidDatePicker value={formData.contract_start_date} onChange={(date) => handleDateChange('contract_start_date', date)} />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {contractHasEndDate && (
                                    <div className="relative z-tabs animate-in fade-in zoom-in-95">
                                        <label className="text-caption font-black uppercase tracking-widest text-warning ml-1 mb-1.5 flex items-center justify-between">
                                            <span>Fecha Fin de Contrato {contractDatesInvalid && <Badge variant="danger" uppercase={false} className="ml-1">Debe ser posterior al inicio</Badge>}</span>
                                            {!formData.contract_end_date && <Badge variant="danger" uppercase={false}>Obligatorio</Badge>}
                                        </label>
                                        <div className={`bg-warning/10 rounded-2xl border shadow-sm flex items-center h-[40px] px-1.5 ${contractDatesInvalid ? '!border-danger !bg-danger/10' : 'border-warning/30'}`}>
                                            <LiquidDatePicker value={formData.contract_end_date} onChange={(date) => handleDateChange('contract_end_date', date)} />
                                        </div>
                                    </div>
                                )}

                                {esContratoCivil(formData.contract_type) && (
                                    <div className="md:col-span-3 animate-in fade-in zoom-in-95">
                                        <Notice variant="warning" icon={ShieldAlert}>
                                            <span className="font-black">{ART20_ADVERTENCIA}</span>
                                            {' '}Además: se le retiene el <span className="font-black">10% de renta</span>, y
                                            no lleva ISSS ni AFP a cargo de la empresa, ni aguinaldo, ni vacaciones, ni
                                            indemnización. Tampoco se remite al Ministerio de Trabajo.
                                        </Notice>
                                    </div>
                                )}

                                {formData.contract_type === 'TEMPORAL' && (
                                    <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in zoom-in-95">
                                        <div className="relative z-content">
                                            <label className="text-caption font-black uppercase tracking-widest text-warning ml-1 mb-1.5 flex items-center justify-between">
                                                <span>Base Legal del Plazo (Art. 25)</span>
                                                {temporalBasisMissing && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                                            </label>
                                            <LiquidSelect invalid={temporalBasisMissing} value={formData.contract_temporal_legal_basis} onChange={(val) => handleSelectChange('contract_temporal_legal_basis', val)} options={TEMPORAL_LEGAL_BASIS_OPTIONS} placeholder="Seleccionar base legal..." clearable={false} {...portalSelectProps} />
                                        </div>
                                        <PortalInput label="Motivo Concreto" name="contract_temporal_reason" value={formData.contract_temporal_reason} onChange={handleChange} placeholder="Ej. Cobertura de incapacidad de la titular del puesto" required hasError={temporalReasonMissing} errorMessage="Requerido para justificar el plazo" />
                                        <p className="md:col-span-2 text-caption text-warning-text/80 font-medium -mt-2 ml-1">La base legal es un catálogo cerrado (solo hay 2 según el Art. 25); el motivo concreto lo redacta la empresa caso por caso — queda como respaldo escrito si el plazo se disputa.</p>
                                    </div>
                                )}
                            </div>

                            {probationInfo && (
                                <div className="mt-4 pt-4 border-t border-divider">
                                    {probationInfo.exempt ? (
                                        <p className="text-caption font-bold text-content-3 flex items-center gap-1.5"><ShieldCheck size={12} className="text-success" /> Recontratación antes de 1 año: no aplica período de prueba (Art. 28, último párrafo).</p>
                                    ) : probationInfo.inProbation ? (
                                        <p className="text-caption font-bold text-brand-text flex items-center gap-1.5 bg-brand/5 border border-brand/20 rounded-xl px-3 py-2 w-fit">
                                            <Clock size={12} /> En Período de Prueba — vence el {probationInfo.probationEnd.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })} (Art. 28: 30 días desde la fecha de contratación)
                                        </p>
                                    ) : null}
                                </div>
                            )}

                            <div className={`grid grid-cols-1 gap-4 mt-4 ${hoursMode === 'OTRO' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                                {/* La jornada NO se le fija a un contrato civil. Fijarle
                                    horas a alguien por servicios profesionales es escribir el
                                    indicio de subordinación del Art. 20 dentro del propio
                                    contrato — y ese artículo presume contrato de trabajo con
                                    prestar servicios más de dos días seguidos o probando
                                    subordinación. Talento Humano pidió «horas mensuales»; la
                                    respuesta de la ley es que no hay horas. */}
                                {!esContratoCivil(formData.contract_type) && (
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Horas semanales</label>
                                        <LiquidSelect value={hoursMode} onChange={handleHoursModeChange} options={HOURS_OPTIONS} clearable={false} icon={Clock} {...portalSelectProps} />
                                    </div>
                                )}
                                {hoursMode === 'OTRO' && (
                                    <div className="relative z-content animate-in fade-in zoom-in-95">
                                        <PortalInput label="Horas (Otro)" name="weekly_contracted_hours" value={formData.weekly_contracted_hours === OTRO_HOURS_SENTINEL ? '' : formData.weekly_contracted_hours} onChange={handleChange} type="number" icon={Clock} placeholder="Ej. 36" hasError={hoursInvalid} errorMessage={`Entre ${MIN_WEEKLY_HOURS} y ${MAX_WEEKLY_HOURS}`} />
                                    </div>
                                )}
                                {isEditMode
                                    ? <LockedField label={esContratoCivil(formData.contract_type) ? "Honorario" : "Salario Base"} value={formData.base_salary ? formatMoney(formData.base_salary) : '—'} />
                                    : <PortalInput label={esContratoCivil(formData.contract_type) ? "Honorario" : "Salario Base"} name="base_salary" value={formData.base_salary} onChange={handleChange} inputMode="decimal" maskType="DECIMAL" icon={DollarSign} placeholder="0.00" prefix="$" hasError={salaryInvalid} errorMessage="Debe ser mayor a 0" />
                                }
                            </div>

                            {/* Art. 23 nº13 CT — «lugar y fecha de celebración del
                                contrato». No es el nº5 («la fecha en que se iniciará el
                                trabajo», que es la de arriba): se firma un día y se
                                empieza otro, y en una disputa la que cuenta para el
                                plazo es ésta. Por eso son dos campos y no uno derivado. */}
                            <div className="mt-4 pt-4 border-t border-divider">
                                <div className="flex items-center gap-2 mb-3">
                                    <CalendarClock size={14} className="text-content-3" strokeWidth={2.5} />
                                    <p className="text-caption font-black uppercase tracking-widest text-content-3">Dónde y cuándo se firmó</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Art. 23 nº9 — «forma, PERÍODO y lugar de pago». Vivía en
                                        Nómina, junto al banco y la cuenta, y no es un dato
                                        bancario: es una cláusula del contrato, y además la que
                                        decide cuándo el pago se vuelve exigible (Art. 130). */}
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Cada cuánto se le paga</label>
                                        <LiquidSelect value={formData.periodo_pago} onChange={(val) => handleSelectChange('periodo_pago', val)} options={PERIODO_PAGO_OPTIONS} placeholder="Seleccionar período…" icon={CalendarClock} {...portalSelectProps} />
                                    </div>
                                    <PortalInput
                                        label="Lugar de la firma" name="contrato_lugar_celebracion"
                                        value={formData.contrato_lugar_celebracion} onChange={handleChange}
                                        icon={MapPin} placeholder="Ej. Chalatenango" />
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha de la firma</label>
                                        <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                            <LiquidDatePicker value={formData.contrato_fecha_celebracion} onChange={(date) => handleDateChange('contrato_fecha_celebracion', date)} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── CÓMO SE PAGA (Art. 23 nº9) ────────────────────────
                                Talento Humano lo pidió como «forma, período y lugar», que
                                es como lo nombra el numeral. Al mirar la ley resultaron ser
                                cosas distintas: la FORMA DE ESTIPULACIÓN es un catálogo
                                cerrado del Art. 126 y decide cuándo el pago se vuelve
                                exigible (Art. 130); el MEDIO es otra cosa, y la ley no lo
                                enumera —pide moneda de curso legal y prohíbe vales—. */}
                            <div className="mt-4 pt-4 border-t border-divider">
                                <div className="flex items-center gap-2 mb-3">
                                    <Banknote size={14} className="text-content-3" strokeWidth={2.5} />
                                    <p className="text-caption font-black uppercase tracking-widest text-content-3">Cómo se paga</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Forma de estipulación</label>
                                        <LiquidSelect value={formData.forma_estipulacion_salario} onChange={(val) => handleSelectChange('forma_estipulacion_salario', val)} options={FORMA_ESTIPULACION_OPTIONS} placeholder="Seleccionar…" icon={Clock} {...portalSelectProps} />
                                        {/* El plazo del Art. 130 al lado de la opción elegida:
                                            es lo que vuelve esto una decisión y no un
                                            desplegable más. */}
                                        {PLAZO_DE_PAGO[formData.forma_estipulacion_salario] && (
                                            <p className="text-micro text-content-3 font-medium mt-1 ml-1 leading-snug">
                                                Se vuelve exigible: {PLAZO_DE_PAGO[formData.forma_estipulacion_salario]}
                                            </p>
                                        )}
                                    </div>
                                    <div className="relative z-content">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Medio de pago</label>
                                        <LiquidSelect value={formData.medio_pago} onChange={(val) => handleSelectChange('medio_pago', val)} options={MEDIO_PAGO_OPTIONS} placeholder="Seleccionar…" icon={Banknote} {...portalSelectProps} />
                                        <p className="text-micro text-content-3 font-medium mt-1 ml-1 leading-snug">
                                            El salario se paga en moneda de curso legal. No se puede pagar con vales, fichas ni cupones.
                                        </p>
                                    </div>
                                    <PortalInput
                                        label="Lugar de pago" name="lugar_pago"
                                        value={formData.lugar_pago} onChange={handleChange}
                                        icon={MapPin} placeholder="Ej. Salud 1" colSpan={2} />
                                </div>
                            </div>

                            {/* ── EL EJEMPLAR DEL MINISTERIO (Art. 18) ──────────────
                                Tres ejemplares, y el tercero a la Dirección General de
                                Trabajo dentro de los OCHO días siguientes a la celebración,
                                modificación o prórroga. El mismo artículo dice que omitirlo
                                NO afecta la validez del contrato: por eso esto es un aviso
                                con cuenta regresiva y no un candado. Un candado sobre algo
                                que la ley no anula produce el atajo, no el cumplimiento. */}
                            {/* ── PRÓRROGAS ─────────────────────────────────────────
                                Se acumulan, no se pisan: cada prórroga vuelve a disparar los
                                8 días del Art. 18, y en una disputa importa la cadena
                                completa — un contrato prorrogado cinco veces sobre labor
                                permanente es exactamente lo que el Art. 25 presume
                                indefinido. Guardar sólo la última borraría esa evidencia. */}
                            {contractHasEndDate && (
                                <div className="mt-4 pt-4 border-t border-divider">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                                            <CalendarClock size={12} strokeWidth={2.5} /> Prórrogas
                                        </p>
                                        <Button variant="ghost" icon={Plus} onClick={agregarProrroga}
                                            disabled={!formData.contract_end_date}
                                            title={formData.contract_end_date ? 'Registrar una prórroga' : 'Primero la fecha de fin'}>
                                            Prorrogar
                                        </Button>
                                    </div>
                                    {/* La ley NO dice cuándo se puede prorrogar y cuándo no:
                                        no hay ningún artículo que limite el número de
                                        prórrogas de un contrato individual. Lo que condiciona
                                        es OTRA cosa, y es más importante — el Art. 25 sólo
                                        acepta el plazo si la labor es transitoria, temporal o
                                        eventual. Prorrogar NO cura ese defecto: un contrato a
                                        plazo sobre labor permanente sigue presumido
                                        indefinido, se prorrogue una vez o cinco. */}
                                    {(formData.contrato_prorrogas || []).length >= 2 && !esContratoCivil(formData.contract_type) && (
                                        <Notice variant="warning" icon={AlertTriangle} className="mb-3">
                                            Van {(formData.contrato_prorrogas || []).length} prórrogas. La ley no las limita en número,
                                            pero el Art. 25 sólo acepta el plazo si la labor es transitoria: prorrogar no convierte en
                                            temporal un puesto permanente, y encadenar plazos sobre uno lo presume indefinido.
                                        </Notice>
                                    )}
                                    {esContratoCivil(formData.contract_type) && (formData.contrato_prorrogas || []).length >= 2 && (
                                        <Notice variant="warning" icon={ShieldAlert} className="mb-3">
                                            Van {(formData.contrato_prorrogas || []).length} prórrogas. Cuanto más se extiende una
                                            relación de servicios profesionales, más pesa la presunción del Art. 20: si además cumple
                                            horario y tiene jefe, la figura correcta es un contrato de trabajo.
                                        </Notice>
                                    )}
                                    {(formData.contrato_prorrogas || []).length === 0 ? (
                                        <p className="text-label text-content-3 font-medium">Sin prórrogas.</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {(formData.contrato_prorrogas || []).map((pr, idx) => (
                                                <div key={idx} data-surface="card" className="p-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                                                        <div className="relative z-content">
                                                            <label className="text-micro font-bold text-content-2 uppercase tracking-wide mb-1 block">Nuevo fin</label>
                                                            <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                                <LiquidDatePicker value={pr.hasta} onChange={(date) => actualizarProrroga(idx, { hasta: date })} />
                                                            </div>
                                                        </div>
                                                        <PortalInput aria-label="Motivo" compact value={pr.motivo || ''}
                                                            onChange={(e) => actualizarProrroga(idx, { motivo: e.target.value })}
                                                            placeholder="Motivo de la prórroga" />
                                                        <Button variant="ghost" icon={X} title="Quitar prórroga" iconOnly onClick={() => quitarProrroga(idx)} />
                                                    </div>
                                                    <p className="text-micro text-content-3 font-medium mt-2 leading-snug">
                                                        Desde {pr.desde || '—'}.{' '}
                                                        {esContratoCivil(formData.contract_type)
                                                            ? 'Un contrato de servicios profesionales es civil: su prórroga no se remite al Ministerio de Trabajo.'
                                                            : 'Prorrogar vuelve a abrir los 8 días para remitir el ejemplar al Ministerio (Art. 18).'}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {(() => {
                                const mtps = estadoRemisionMtps(formData);
                                if (!mtps.aplica) {
                                    return (
                                        <p className="mt-4 pt-4 border-t border-divider text-label text-content-3 font-medium leading-snug">
                                            <span className="font-black">Ministerio de Trabajo:</span> {mtps.motivo}
                                        </p>
                                    );
                                }
                                return (
                                    <div className="mt-4 pt-4 border-t border-divider">
                                        <div className="flex items-center gap-2 mb-3">
                                            <FileText size={14} className="text-content-3" strokeWidth={2.5} />
                                            <p className="text-caption font-black uppercase tracking-widest text-content-3">Ejemplar del Ministerio de Trabajo</p>
                                        </div>
                                        {mtps.remitido ? (
                                            <Notice variant="success" icon={CheckCircle2}>
                                                Remitido el {new Date(mtps.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}.
                                            </Notice>
                                        ) : (
                                            <Notice variant={mtps.vencido ? 'danger' : 'warning'} icon={AlertTriangle}>
                                                {mtps.vencido
                                                    ? `El plazo venció hace ${Math.abs(mtps.diasRestantes)} día${Math.abs(mtps.diasRestantes) === 1 ? '' : 's'}. Se remite igual: no haberlo hecho a tiempo no invalida el contrato.`
                                                    : `Quedan ${mtps.diasRestantes} día${mtps.diasRestantes === 1 ? '' : 's'} para remitir el tercer ejemplar (hasta el ${new Date(mtps.limite + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long' })}).`}
                                            </Notice>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 items-start">
                                            <div className="relative z-content">
                                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha en que se remitió</label>
                                                <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass}`}>
                                                    <LiquidDatePicker value={formData.mtps_remitido_fecha} onChange={(date) => handleDateChange('mtps_remitido_fecha', date)} />
                                                </div>
                                            </div>
                                            {/* El acuse sellado, adjunto. La fecha sola dice que
                                                se mandó; el papel es lo que lo prueba. */}
                                            <div>
                                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Acuse sellado</label>
                                                {renderDocUploadArea('ACUSE_MTPS', { showExpiry: false })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Art. 23 nº10 CT — «cantidad, calidad y estado de las
                            herramientas y materiales que el patrono proporcione». Son
                            las tres cosas juntas: sin el estado de entrega no hay con
                            qué comparar el día que se devuelven, que es para lo que el
                            numeral existe. */}
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center justify-between mb-4 gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20">
                                        <Wrench size={16} strokeWidth={2.5} />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Herramientas y Materiales Entregados</h4>
                                        <p className="text-label font-medium text-content-3 leading-snug mt-0.5">Lo que la empresa le entrega y tiene que devolver: gabacha, llaves, teléfono, lector. Anota en qué estado se entregó.</p>
                                    </div>
                                </div>
                                <Button variant="ghost" icon={Plus} onClick={addHerramienta}>Agregar</Button>
                            </div>

                            {(formData.herramientas_entregadas || []).length === 0 ? (
                                <div data-surface="card" className="p-4 text-center">
                                    <Wrench size={20} className="text-content-3 mx-auto mb-2" strokeWidth={2} />
                                    <p className="text-label text-content-2 font-bold">No se le entregó nada todavía</p>
                                    <p className="text-micro text-content-3 font-medium mt-0.5 leading-snug">
                                        Gabacha, llaves, teléfono, lector… lo que tenga que devolver el día que se vaya.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Cada renglón es una ENTREGA, no una fila de tabla: la
                                        cantidad al frente y el estado como distintivos que se
                                        tocan, que es como se lee un acta. Los distintivos
                                        llevan blanco de dedo de 44pt (§32), así que la entrega
                                        se puede anotar desde el teléfono.

                                        Y cuando falta alguno de los tres, LO DICE: el Art. 23
                                        nº10 pide cantidad, calidad y estado, y sin el estado de
                                        entrega no hay con qué comparar el día que se devuelve —
                                        que es para lo que el numeral existe. */}
                                    <div className="flex flex-col gap-2">
                                        {(formData.herramientas_entregadas || []).map((item, idx) => {
                                            const incompleto = !item.descripcion || item.cantidad === '' || item.cantidad == null || !item.estado;
                                            return (
                                                <div key={idx} data-surface="card" className="p-3">
                                                    <div className="flex items-start gap-3">
                                                        <div className="shrink-0 w-14">
                                                            <PortalInput
                                                                aria-label="Cantidad" compact type="number" inputMode="numeric"
                                                                value={item.cantidad ?? ''}
                                                                onChange={(e) => updateHerramienta(idx, { cantidad: e.target.value })}
                                                                placeholder="1" />
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex flex-col gap-2">
                                                            <PortalInput
                                                                aria-label="Qué se entregó" compact
                                                                value={item.descripcion || ''}
                                                                onChange={(e) => updateHerramienta(idx, { descripcion: e.target.value })}
                                                                placeholder="Qué se entregó" />
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {ESTADO_HERRAMIENTA_OPTIONS.map(op => (
                                                                    <button
                                                                        key={op.value} type="button"
                                                                        onClick={() => updateHerramienta(idx, { estado: op.value })}
                                                                        aria-pressed={item.estado === op.value}
                                                                        className={`min-h-[var(--tap-min)] px-3 rounded-full text-micro font-black uppercase tracking-wide border transition-all active:scale-[0.97] ${
                                                                            item.estado === op.value
                                                                                ? 'bg-brand text-white border-brand shadow-[var(--shadow-glow-brand)]'
                                                                                : 'bg-surface-card text-content-2 border-border-card hover:border-brand/40'}`}>
                                                                        {op.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <Button variant="ghost" icon={X} title="Quitar" iconOnly onClick={() => removeHerramienta(idx)} />
                                                    </div>
                                                    {incompleto && (
                                                        <p className="text-micro text-warning-text font-bold mt-2 leading-snug">
                                                            Falta la cantidad, la descripción o el estado. Sin el estado de entrega no hay con qué comparar el día que se devuelve.
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-micro text-content-3 font-bold mt-3">
                                        {(formData.herramientas_entregadas || []).length} entrega{(formData.herramientas_entregadas || []).length === 1 ? '' : 's'} registrada{(formData.herramientas_entregadas || []).length === 1 ? '' : 's'}.
                                    </p>
                                </>
                            )}
                        </div>
                    </>
                )}

                {/* TAB 3: NÓMINA Y ACCESOS */}
                {activeTab === 'nomina' && (
                    <>
                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-success/10 text-success rounded-xl border border-success/30 shadow-[var(--shadow-shine)]">
                                    <CreditCard size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Cuentas y Retenciones</h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <PortalInput label="Número ISSS" name="isss_number" value={formData.isss_number} onChange={handleChange} icon={Hash} placeholder="9 dígitos" maskType="ISSS" hasError={isssIncomplete} errorMessage="Debe tener 9 dígitos" />
                                {/* El NUP quedó homologado al DUI en enero de 2023: es con el
                                    número de DUI que uno se afilia y hace cualquier trámite de
                                    pensiones. Así que dejó de ser un campo que se teclea — se
                                    muestra el DUI, que se captura en Datos Personales y ahí sí
                                    se le comprueba el dígito verificador.

                                    El valor viejo NO se borra ni se pisa: si una ficha trae un
                                    NUP anterior distinto del DUI, se sigue viendo. Borrarlo
                                    sería decidir por alguien que ese número ya no importa. */}
                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">NUP (AFP)</label>
                                    <div className={`bg-surface-card-hover rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-3 gap-2`}>
                                        <Hash size={14} className="text-content-3 shrink-0" strokeWidth={2.5} />
                                        <span className="text-body-xl font-bold text-content-2 truncate">
                                            {formData.dui || '—'}
                                        </span>
                                    </div>
                                    <p className="text-micro text-content-3 font-medium mt-1 ml-1 leading-snug">
                                        Es el DUI: desde enero de 2023 el NUP quedó homologado al documento de identidad.
                                        {formData.afp_number ? ` NUP anterior registrado: ${formData.afp_number}.` : ''}
                                    </p>
                                </div>

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Institución AFP</label>
                                    <LiquidSelect value={formData.afp_institution} onChange={(val) => handleSelectChange('afp_institution', val)} options={AFP_OPTIONS} placeholder="Crecer o Confía..." icon={Hash} clearable={false} {...portalSelectProps} />
                                </div>

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Banco (Planilla)</label>
                                    <LiquidSelect value={formData.bank_name} onChange={(val) => handleSelectChange('bank_name', val)} options={BANKS_OPTIONS} placeholder="Seleccionar banco…" icon={Building2} clearable={false} {...portalSelectProps} />
                                </div>

                                <div className="relative z-content">
                                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Tipo de Cuenta</label>
                                    <LiquidSelect value={formData.account_type} onChange={(val) => handleSelectChange('account_type', val)} options={ACCOUNT_TYPE_OPTIONS} placeholder="Tipo de cuenta..." icon={CreditCard} clearable={false} {...portalSelectProps} />
                                </div>

                                <PortalInput label="Número de Cuenta" name="account_number" value={formData.account_number} onChange={handleChange} icon={CreditCard} placeholder="0000-0000-00" maskType="ACCOUNT" />

                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className={`${islandClass} ${islandHoverClass}`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-chart-8-solid text-white rounded-xl shadow-[var(--shadow-shine)]"><AtSign size={16} strokeWidth={2.5} /></div>
                                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Login de App Móvil</h4>
                                </div>
                                <PortalInput label="Usuario (Auto-generado)" name="username" value={formData.username} onChange={handleChange} readOnly={true} icon={User} />
                            </div>

                            <div className={`bg-brand/5 rounded-3xl p-4 md:p-5 border border-brand/20 shadow-[var(--shadow-glow-brand)] transition-all hover:translate-y-[var(--lift-card)] hover:shadow-md`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-brand text-white rounded-xl shadow-[var(--shadow-glow-brand)]"><Lock size={16} strokeWidth={2.5} /></div>
                                    <h4 className="text-body-sm font-black uppercase tracking-widest text-brand-text">Seguridad Kiosko</h4>
                                </div>
                                <div>
                                    {/* El botón de regenerar iba DENTRO del campo, encimado
                                        en absoluto. Va afuera, al lado — misma decisión que
                                        con el ojo de ver/ocultar contraseña (v2.156.0): el
                                        canónico dibuja el campo, la acción es su hermana. */}
                                    <div className="flex items-end gap-2">
                                        <div className="flex-1">
                                            <PortalInput
                                                label="Cod. Empleado" name="code" required
                                                value={formData.code} inputMode="numeric" placeholder="Ej. 1024"
                                                inputClassName="font-black"
                                                onChange={(e) => { e.target.value = e.target.value.replace(/\D/g, ''); handleChange(e); }}
                                            />
                                        </div>
                                        {/* `generateUniqueCode` pregunta al servidor si el
                                            candidato está libre, así que hay que esperarla: sin
                                            el await el campo se llenaba con una Promise. */}
                                        <Button tone="chart-1" icon={RefreshCw} iconOnly aria-label="Generar un código nuevo"
                                            onClick={async () => {
                                                const nuevo = await generateUniqueCode();
                                                if (nuevo) setFormData(p => ({ ...p, code: nuevo }));
                                            }} />
                                    </div>
                                    <p className="text-micro font-bold text-brand-text mt-2 ml-1 flex items-center gap-1"><ShieldCheck size={12} /> Solo números — codificado vía SHA-256 para el carnet.</p>

                                    {/* PIN derivado del código (se recalcula en vivo al escribir) */}
                                    {formData.kiosk_pin && (
                                        <div className="mt-3 animate-in fade-in">
                                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">PIN del Carné (SHA-256)</label>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-[40px] bg-chart-8 rounded-2xl flex items-center justify-center px-4 text-body-lg font-black tracking-[0.3em] text-white shadow-[var(--shadow-shine)] select-all">
                                                    {formData.kiosk_pin}
                                                </div>
                                                <Button variant="secondary" icon={Copy} title="Copiar PIN" iconOnly onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(formData.kiosk_pin);
                                                            useToastStore.getState().showToast('PIN Copiado', `${formData.kiosk_pin} está en el portapapeles.`, 'success');
                                                        } catch { /* sin permiso de clipboard */ }
                                                    }} />
                                            </div>
                            <p className="text-micro font-bold text-content-3 mt-1.5 ml-1">Este es el valor del código de barras del carné.</p>
                                        </div>
                                    )}

                                    {/* El carné de PAPEL, para el que todavía no
                                        tiene el de plástico. La marca es lo que
                                        habilita imprimirlo al dar de alta sin el
                                        permiso aparte — el trámite del ingreso no
                                        se traba esperando un permiso. */}
                                    <div className="mt-4 pt-4 border-t border-brand/20">
                                        <Checkbox size="sm"
                                            checked={!!formData.carne_pendiente}
                                            onChange={(v) => setFormData(p => ({ ...p, carne_pendiente: v }))}
                                            label={<span className="text-caption font-black uppercase tracking-widest text-content-2">Todavía no tiene carné</span>}
                                        />
                                        <p className="text-micro font-bold text-content-3 mt-1.5 ml-1">
                                            {isEditMode
                                                ? 'Puedes imprimirle un carné de papel desde su perfil. Vale hasta medianoche.'
                                                : 'Al guardar se le imprime un carné de papel en la ticketera. Vale hasta medianoche de hoy.'}
                                        </p>
                                    </div>
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
                                <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20">
                                    <FileText size={16} strokeWidth={2.5} />
                                </div>
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Documentación del Expediente</h4>
                            </div>

                            {/* Documento de identidad: DUI (Frente+Reverso, un solo documento) para
                                adultos; documento alterno con selector de tipo (Art. 23.2) para
                                menores — agrupado aparte para que no se lea como 2 archivos
                                independientes. La imagen NO bloquea el alta del empleado (a
                                diferencia del campo de texto DUI/documento alterno, que sí es
                                obligatorio) — si falta, queda marcada "Pendiente". */}
                            <div data-surface="card" className="p-3 bg-surface-card-hover/60 mb-4 flex items-start gap-3">
                                <Fingerprint size={16} className="text-content-3 shrink-0 mt-0.5" strokeWidth={2.5} />
                                <p className="text-label text-content-2 font-medium leading-snug">
                                    El {isMinor ? 'documento de identidad' : 'DUI'} se sube en <span className="font-black">Datos Personales</span>, al inicio.
                                    Está ahí y no aquí porque el documento llena media ficha: de él salen el número, el género,
                                    el estado familiar, la fecha de nacimiento y la dirección.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {documentCategories.filter(cat => !EN_ACREDITACIONES.includes(cat.key)).map(cat => (
                                    <div key={cat.key} data-surface="card" className="p-3 bg-surface-card-hover/60">
                                        <label className="text-caption font-black uppercase tracking-widest text-content-3 mb-2 block">{cat.label}</label>
                                        {cat.key === 'SRS' && (
                                            <PortalInput label="Número de Carné JVPQF" name="pharmacist_license_number" value={formData.pharmacist_license_number} onChange={handleChange} icon={Hash} placeholder="N° JVPQF" colSpan={1} />
                                        )}
                                        {cat.key === 'ENFERMERIA' && (
                                            <PortalInput label="Número de Carné JVPE" name="nursing_license_number" value={formData.nursing_license_number} onChange={handleChange} icon={Hash} placeholder="N° JVPE" colSpan={1} />
                                        )}
                                        {(cat.key === 'ANUALIDAD_JVPQF' || cat.key === 'ANUALIDAD_JVPE') && (
                                            <p className="text-micro text-content-3 font-bold mb-2">Comprobante de pago del año en curso (recibo/mandamiento de pago cancelado) — trámite distinto al carné, se renueva cada año. Fecha límite CSSP: 31 de marzo (igual para todos los profesionales de salud inscritos) — se autocompleta al subir el recibo si no escribes otra fecha.</p>
                                        )}
                                        {renderDocUploadArea(cat.key)}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={`${islandClass} ${islandHoverClass}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Otros Documentos</h4>
                                <Button variant="ghost" icon={Plus} onClick={addExtraDoc}>Agregar Documento</Button>
                            </div>
                            {extraDocs.length === 0 && <p className="text-label text-content-3 font-medium">Sin documentos adicionales.</p>}
                            <div className="flex flex-col gap-3">
                                {/* La tarjeta de cada documento era
                                    `p-3 rounded-2xl border border-divider bg-surface-card-hover/60`:
                                    la superficie de tarjeta reconstruida a mano. El radio fijo
                                    (`rounded-2xl`) además ignoraba el tema — en Solid las tarjetas
                                    son más tensas. */}
                                {extraDocs.map(doc => (
                                    <div key={doc.category} data-surface="card" className="p-3">
                                        <div className="flex items-center justify-between mb-2 gap-2">
                                            {/* Era el ÚNICO campo subrayado del portal. El subrayado evitaba
                                                anidar caja dentro de caja —vive dentro de una tarjeta—, pero
                                                una tarjeta que contiene campos es lo normal en todas las demás
                                                vistas, y un patrón que existe una sola vez no es un patrón. */}
                                            <PortalInput
                                                aria-label="Nombre del documento" className="flex-1" compact
                                                value={doc.title}
                                                onChange={(e) => updateDoc(doc.category, { title: e.target.value })}
                                                placeholder="Nombre del documento"
                                            />
                                            <Button variant="ghost" icon={X} title="Quitar documento" iconOnly onClick={() => removeExtraDoc(doc.category)} />
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