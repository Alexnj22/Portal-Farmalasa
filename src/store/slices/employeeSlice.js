import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, persistEmployees } from '../utils';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { OTRA_ESPECIALIDAD } from '../../utils/educationCatalogs';
import { isDependentAgeOnly, isDependentAgeInvalid, getDependentAge, MIN_DEPENDENT_AGE, MAX_DEPENDENT_AGE } from '../../utils/economicDependents';
import {
    codigoDeCarneLibre, duiDisponible,
    upsertEducationCatalogEntries, insertEmployee, updateEmployee, updateEmployeeReturning,
    fetchEmployeeRosterSchedule, insertEmployeeEventRaw, fetchAttendanceSince,
    insertAttendancePunch, deleteAttendancePunch, fetchAttendancePunchDetails, updateAttendancePunch,
} from '../../data/employees';
import { insertEmployeeBranches, deleteEmployeeBranches, upsertWeeklyRoster } from '../../data/system';
import { TERMINATION_REASONS, SIN_ASIGNAR } from '../../data/constants';
import { claveDeDia } from '../../utils/scheduleHelpers';

// education_specialty/profession son selects de catálogo con fallback a
// texto libre ("Otra..."). El sentinel llega si se eligió "Otra" pero no se
// tecleó nada — se trata como vacío. Nunca se fuerza mayúscula aquí: el
// texto libre ya llega en mayúscula desde el modal (CatalogOtherInput), y
// los valores de catálogo deben conservar su capitalización original.
const normalizeCatalogValue = (val) => {
    if (!val || val === OTRA_ESPECIALIDAD) return null;
    return val.trim();
};

// additional_skills: array de {skill, institution, hours} — descarta filas
// completamente vacías (agregadas con "+" pero nunca llenadas).
const normalizeAdditionalSkills = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(s => ({
            skill: normalizeCatalogValue(s?.skill),
            institution: normalizeCatalogValue(s?.institution),
            hours: s?.hours !== undefined && s?.hours !== null && s.hours !== '' ? parseFloat(s.hours) : null,
        }))
        .filter(s => s.skill || s.institution || s.hours != null);
};

// Registra el valor final en education_catalog_entries (upsert, ignora
// duplicados) para que quede disponible como opción real en el próximo
// registro — sin importar si ya existía o se acaba de escribir en "Otra...".
const upsertCatalogEntries = (rows) => {
    if (!rows.length) return;
    upsertEducationCatalogEntries(rows)
        .then(({ error }) => { if (error) console.warn('No se pudo registrar entrada de catálogo educativo:', error.message); });
};

// Maestría/Postgrado ya no es un education_level propio — es un complemento
// de UNIVERSITARIO (has_maestria/maestria_title), así que se registra aparte.
const registerCatalogEntry = (educationLevel, specialty, profession, maestriaTitle) => {
    const rows = [];
    if (specialty) {
        if (educationLevel === 'BACHILLERATO_TECNICO') rows.push({ category: 'BACHILLERATO_TECNICO_ESPECIALIDAD', value: specialty });
        else if (educationLevel === 'TECNICO_SUPERIOR') rows.push({ category: 'TECNICO_SUPERIOR_ESPECIALIDAD', value: specialty });
    }
    if (profession && educationLevel === 'UNIVERSITARIO') rows.push({ category: 'PROFESION_UNIVERSITARIA', value: profession });
    if (maestriaTitle) rows.push({ category: 'MAESTRIA_POSTGRADO', value: maestriaTitle });
    upsertCatalogEntries(rows);
};

// Un empleado puede tener varias enfermedades crónicas a la vez — lista libre,
// cada entrada es su propio valor de catálogo o texto libre ("Otra...").
const normalizeChronicConditions = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map(c => normalizeCatalogValue(c)).filter(Boolean);
};

// Enfermedad crónica / tipo de discapacidad son catálogos independientes de educación
// (misma tabla education_catalog_entries, categorías propias) — se registran aparte.
const registerMedicalCatalogEntries = (chronicConditions, disabilityType) => {
    const rows = [];
    for (const c of (chronicConditions || [])) rows.push({ category: 'ENFERMEDAD_CRONICA', value: c });
    if (disabilityType) rows.push({ category: 'TIPO_DISCAPACIDAD', value: disabilityType });
    upsertCatalogEntries(rows);
};

// Cada curso/habilidad adicional aporta hasta 2 entradas de catálogo:
// el curso/habilidad en sí y la institución que lo impartió.
const registerSkillCatalogEntries = (skills) => {
    if (!Array.isArray(skills)) return;
    const rows = [];
    for (const s of skills) {
        if (s?.skill) rows.push({ category: 'CURSO_HABILIDAD', value: s.skill });
        if (s?.institution) rows.push({ category: 'INSTITUCION_CAPACITACION', value: s.institution });
    }
    upsertCatalogEntries(rows);
};

// 🚨 COMPRESOR DE IMÁGENES NATIVO (Actualizado para mantener fondos transparentes)
const compressImage = (file, maxWidth = 400) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                
                // Solo reducimos si la imagen es muy grande, no la estiramos
                const scaleSize = maxWidth > img.width ? 1 : maxWidth / img.width;
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                
                // Dibujamos la imagen respetando la transparencia
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // 🚨 Usamos formato WebP que SÍ soporta transparencia y además comprime
                canvas.toBlob((blob) => {
                    if (!blob) { resolve(file); return; }
                    // Si un navegador muy viejo no soporta WebP, usamos PNG de respaldo
                    const finalType = blob.type || 'image/png';
                    const ext = finalType.includes('webp') ? '.webp' : '.png';
                    
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ext, { 
                        type: finalType, 
                        lastModified: Date.now() 
                    }));
                }, 'image/webp', 0.85); // 85% de calidad
            };
        };
    });
};

// Direcciones alternas: cada una es {department, municipality, address}
// completa (no solo texto libre) — se descartan las filas vacías (agregadas
// con el botón "+" pero nunca llenadas antes de guardar).
const normalizeExtraAddresses = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(a => ({
            department: (a?.department || '').trim(),
            municipality: (a?.municipality || '').trim(),
            address: (a?.address || '').trim().toUpperCase(),
        }))
        .filter(a => a.department || a.municipality || a.address);
};

// Herramientas y materiales que entrega el patrono (Art. 23 nº10 CT):
// {descripcion, cantidad, estado}. El numeral pide las TRES cosas —cantidad,
// calidad y estado—, así que una fila con sólo el nombre no cumple; pero
// tampoco se bloquea el alta por eso: se guarda lo que haya y el banner de
// pendientes lo recuerda. Se descartan las filas agregadas con "+" y nunca
// llenadas.
const normalizeHerramientas = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(h => ({
            descripcion: (h?.descripcion || '').trim().toUpperCase(),
            cantidad: (h?.cantidad === '' || h?.cantidad == null) ? null : Number(h.cantidad),
            estado: (h?.estado || '').trim(),
        }))
        .filter(h => h.descripcion || h.cantidad != null || h.estado)
        // Un `Number('abc')` es NaN y `JSON.stringify(NaN)` es `null`: la fila
        // llegaría a la base sin cantidad y sin que nadie se entere. Se
        // normaliza acá para que el jsonb guardado sea el que se ve.
        .map(h => ({ ...h, cantidad: Number.isFinite(h.cantidad) ? h.cantidad : null }));
};

// Contactos de emergencia, en plural.
//
// La lista guardada incluye al PRINCIPAL en la primera posición, y no sólo a
// los demás. Guardar sólo los extras dejaría la columna diciendo media verdad:
// quien la lea después —un aviso, una exportación— tendría que saber que le
// falta uno y de dónde sacarlo. Las columnas viejas se conservan porque son las
// que lee hoy el resto del portal; ésta es la lista completa.
const normalizeContactosEmergencia = (principal, extras) => {
    const uno = (c) => ({
        nombre: (c?.nombre || '').trim().toUpperCase(),
        parentesco: (c?.parentesco || '').trim(),
        telefono: (c?.telefono || '').trim(),
    });
    const lista = [];
    if (principal?.nombre || principal?.telefono) lista.push(uno(principal));
    for (const c of (Array.isArray(extras) ? extras : [])) {
        const n = uno(c);
        // Una fila agregada con «+» y nunca llenada no es un contacto.
        if (n.nombre || n.telefono) lista.push(n);
    }
    return lista;
};

// Dependientes económicos: {name, birth_date, relationship, department,
// municipality, address} — descarta filas totalmente vacías.
const normalizeEconomicDependents = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(d => ({
            name: (d?.name || '').trim().toUpperCase(),
            birth_date: d?.birth_date || null,
            age: getDependentAge(d),
            age_only: isDependentAgeOnly(d),
            relationship: (d?.relationship || '').trim(),
            department: (d?.department || '').trim(),
            municipality: (d?.municipality || '').trim(),
            address: (d?.address || '').trim().toUpperCase(),
        }))
        .filter(d => d.name || d.birth_date || d.age != null || d.relationship || d.department || d.municipality || d.address);
};

// DUI salvadoreño: formato 00000000-0 + dígito verificador (suma ponderada 9..2
// mod 10). Mismo algoritmo que isValidDUIAlgorithm en EmployeeFormModal — aquí
// BLOQUEA el guardado (el modal solo lo señala visualmente).
// El duplicado ya NO se busca en el padrón cargado. `dui` salió de
// `employees_safe` el 2026-08-24 —viajaba a cualquier sesión— y un padrón sin
// ese campo no encontraría jamás un choque: no fallaría al comprobar, guardaría,
// y el índice único `employees_dui_unique` tiraría un error crudo de Postgres en
// pantalla. Es exactamente lo que pasó con el código de carné, así que la
// pregunta la contesta el servidor por el mismo camino.
//
// El mensaje ya no dice de quién es el documento. No es una pérdida: decirlo le
// contaba a quien da de alta que esa persona está en la nómina, que es la misma
// razón por la que `carne_disponible` tampoco lo dice.
const validateDui = async (dui, excludeId = null) => {
    if (!dui) return;
    if (!/^\d{8}-\d$/.test(dui)) {
        throw new Error(`El DUI "${dui}" no tiene el formato correcto (00000000-0).`);
    }
    const digits = dui.replace(/\D/g, '').split('').map(Number);
    const verifier = digits.pop();
    const sum = digits.reduce((acc, d, i) => acc + d * (9 - i), 0);
    let calc = 10 - (sum % 10);
    if (calc === 10) calc = 0;
    if (calc !== verifier) {
        throw new Error(`El DUI "${dui}" no es válido (dígito verificador incorrecto).`);
    }
    // `null` es «no se pudo preguntar» y deja seguir: la red caída no puede
    // impedir dar de alta a alguien, y el índice único sigue siendo la última
    // palabra. Sólo un `false` explícito bloquea.
    if (await duiDisponible(dui, excludeId) === false) {
        throw new Error(`El DUI "${dui}" ya está registrado a nombre de otra persona.`);
    }
};

// Campos OPCIONALES con formato fijo: vacío es válido (queda pendiente y el
// banner "Información Pendiente" lo recuerda), pero si tienen contenido deben
// estar COMPLETOS — a medias no se guarda: o se completa, o se borra.
const validateOptionalFormats = (data) => {
    const digitsLen = (v) => String(v ?? '').replace(/\D/g, '').length;
    const checks = [
        ['phone', 8, 'El Teléfono'],
        ['emergency_contact_phone', 8, 'El Teléfono de Emergencia'],
        ['isss_number', 9, 'El Número ISSS'],
        ['afp_number', 12, 'El NUP (AFP)'],
    ];
    for (const [field, len, label] of checks) {
        const val = data[field];
        if (val === undefined || val === null || String(val).trim() === '') continue;
        if (digitsLen(val) !== len) {
            throw new Error(
                `${label} está incompleto (debe tener ${len} dígitos). ` +
                `Complétalo, o bórralo para guardarlo como pendiente.`
            );
        }
    }

    if (data.email && String(data.email).trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) {
        throw new Error('El Correo Electrónico no tiene un formato válido. Corrígelo, o bórralo para guardarlo como pendiente.');
    }

    // Numeración de El Salvador: 8 dígitos, celular inicia en 6/7, fijo en 2.
    const svPhoneChecks = [['phone', 'El Teléfono'], ['emergency_contact_phone', 'El Teléfono de Emergencia']];
    for (const [field, label] of svPhoneChecks) {
        const val = data[field];
        if (val === undefined || val === null || String(val).trim() === '') continue;
        const cleanDigits = digitsLen(val);
        if (cleanDigits === 8 && !/^[267]/.test(String(val).replace(/\D/g, ''))) {
            throw new Error(`${label} no es un número válido de El Salvador (debe iniciar en 2, 6 o 7).`);
        }
    }
    if (Array.isArray(data.extra_phones)) {
        for (const p of data.extra_phones) {
            if (!p || !String(p).trim()) continue;
            const cleanDigits = digitsLen(p);
            if (cleanDigits !== 8 || !/^[267]/.test(String(p).replace(/\D/g, ''))) {
                throw new Error('Uno de los teléfonos adicionales no es un número válido de El Salvador (8 dígitos, inicia en 2, 6 o 7).');
            }
        }
    }
    if (Array.isArray(data.emergency_contact_extra_phones)) {
        for (const p of data.emergency_contact_extra_phones) {
            if (!p || !String(p).trim()) continue;
            const cleanDigits = digitsLen(p);
            if (cleanDigits !== 8 || !/^[267]/.test(String(p).replace(/\D/g, ''))) {
                throw new Error('Uno de los teléfonos de emergencia adicionales no es un número válido de El Salvador (8 dígitos, inicia en 2, 6 o 7).');
            }
        }
    }

    // Dependientes económicos: se bloquea si la fecha de nacimiento es futura, o si se
    // eligió "solo edad" (sin fecha) y el valor no es un entero válido en rango humano
    // (sin rango de edad para la fecha exacta — a diferencia del empleado, un dependiente
    // puede ser un bebé o un adulto mayor).
    if (Array.isArray(data.economic_dependents)) {
        for (const dep of data.economic_dependents) {
            if (dep?.birth_date) {
                const bd = new Date(`${dep.birth_date}T00:00:00`);
                if (!isNaN(bd.getTime()) && bd > new Date()) {
                    throw new Error(`La Fecha de Nacimiento de "${dep.name || 'un dependiente'}" no puede ser futura.`);
                }
            } else if (isDependentAgeInvalid(dep)) {
                throw new Error(`La Edad de "${dep.name || 'un dependiente'}" debe ser un número entero entre ${MIN_DEPENDENT_AGE} y ${MAX_DEPENDENT_AGE}.`);
            }
        }
    }

    const namePattern = /^[A-Za-zÀ-ÖØ-öø-ÿÑñ'’\-\s.]+$/;
    const nameChecks = [['first_names', 'Los Nombres'], ['last_names', 'Los Apellidos']];
    for (const [field, label] of nameChecks) {
        const val = data[field];
        if (val === undefined || val === null || String(val).trim() === '') continue;
        const v = String(val).trim();
        if (v.length < 2 || !namePattern.test(v)) {
            throw new Error(`${label} solo pueden contener letras (mínimo 2 caracteres).`);
        }
    }

    // Fecha de nacimiento: ni futura ni una edad fuera de rango laboral real.
    if (data.birth_date) {
        const bd = new Date(`${data.birth_date}T00:00:00`);
        if (!isNaN(bd.getTime())) {
            const today = new Date();
            if (bd > today) throw new Error('La Fecha de Nacimiento no puede ser futura.');
            let age = today.getFullYear() - bd.getFullYear();
            const m = today.getMonth() - bd.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
            if (age < 16 || age > 90) throw new Error('La Fecha de Nacimiento resulta en una edad no válida (debe estar entre 16 y 90 años).');
        }
    }

    // "¿Actualmente estudiando?" no es real si la fecha estimada de fin ya pasó.
    if (data.is_studying && data.study_start_date && data.study_duration_years) {
        const [y, m] = data.study_start_date.split('-').map(Number);
        const totalMonths = (m - 1) + Math.round(parseFloat(data.study_duration_years) * 12);
        const endDate = new Date(y + Math.floor(totalMonths / 12), ((totalMonths % 12) + 12) % 12, 1);
        if (endDate < new Date()) {
            throw new Error('La carrera marcada como "actualmente estudiando" ya debería haber finalizado según el inicio y la duración indicados. Revisa las fechas.');
        }
    }

    // Tener maestría implica que la licenciatura ya finalizó — no puede seguir
    // "actualmente estudiando" el Universitario al mismo tiempo.
    if (data.is_studying && data.has_maestria) {
        throw new Error('No puede marcar "actualmente estudiando" en Universitario junto con "Tiene Maestría/Postgrado" — tener maestría implica que la licenciatura ya finalizó.');
    }

    if (data.maestria_is_studying && data.maestria_study_start_date && data.maestria_study_duration_years) {
        const [y, m] = data.maestria_study_start_date.split('-').map(Number);
        const totalMonths = (m - 1) + Math.round(parseFloat(data.maestria_study_duration_years) * 12);
        const endDate = new Date(y + Math.floor(totalMonths / 12), ((totalMonths % 12) + 12) % 12, 1);
        if (endDate < new Date()) {
            throw new Error('La maestría/postgrado marcada como "en curso" ya debería haber finalizado según el inicio y la duración indicados. Revisa las fechas.');
        }
    }

    if (data.base_salary !== undefined && data.base_salary !== null && String(data.base_salary).trim() !== '' && !(Number(data.base_salary) > 0)) {
        throw new Error('El Salario Base debe ser un número mayor a 0.');
    }

    if (data.weekly_contracted_hours !== undefined && data.weekly_contracted_hours !== null && String(data.weekly_contracted_hours).trim() !== '') {
        const hours = Number(data.weekly_contracted_hours);
        // Tope legal Art. 161 Código de Trabajo: jornada ordinaria semanal diurna = 44h.
        if (isNaN(hours) || hours < 1 || hours > 44) {
            throw new Error('Las Horas Semanales deben estar entre 1 y 44 (jornada ordinaria máxima según el Código de Trabajo).');
        }
    }

    if (data.contract_type === 'TEMPORAL' && data.contract_start_date && data.contract_end_date) {
        const start = new Date(`${data.contract_start_date}T00:00:00`);
        const end = new Date(`${data.contract_end_date}T00:00:00`);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
            throw new Error('La Fecha Fin de Contrato debe ser posterior a la Fecha de Inicio de Contrato.');
        }
    }

    // Nota: la fecha de vencimiento de la Acreditación SRS ya no vive en
    // srs_accreditation_expiry — vive en el documento subido (employee_documents,
    // categoría SRS, opcional / autocompletada por IA), así que no se exige aquí.

    // Art. 23.2 Código de Trabajo: el DUI es obligatorio en el contrato escrito;
    // en El Salvador no se tramita antes de los 18 años, así que para menores se
    // acepta "cualquier documento fehaciente" en su lugar (partida de nacimiento,
    // carné de minoridad). Solo se exige cuando el dato llega en el payload (los
    // updates parciales no siempre traen dui/birth_date).
    if (data.dui !== undefined || data.alt_identity_document !== undefined) {
        let isMinor = false;
        if (data.birth_date) {
            const bd = new Date(`${data.birth_date}T00:00:00`);
            if (!isNaN(bd.getTime())) {
                const today = new Date();
                let age = today.getFullYear() - bd.getFullYear();
                const m = today.getMonth() - bd.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
                isMinor = age < 18;
            }
        }
        if (isMinor) {
            if (!String(data.alt_identity_document ?? '').trim()) {
                throw new Error('El empleado es menor de edad: falta el Documento de Identidad Alternativo (partida de nacimiento, carné de minoridad).');
            }
        } else if (!String(data.dui ?? '').trim()) {
            throw new Error('El DUI es obligatorio (Art. 23.2 Código de Trabajo).');
        }
    }

    // Art. 25/23.4: un contrato a plazo sin base legal + motivo documentados
    // queda sin respaldo escrito si se disputa la validez del plazo.
    if (data.contract_type === 'TEMPORAL') {
        if (!data.contract_temporal_legal_basis) {
            throw new Error('Falta la Base Legal del Plazo (Art. 25) para un contrato Temporal.');
        }
        if (!String(data.contract_temporal_reason ?? '').trim()) {
            throw new Error('Falta el Motivo Concreto del contrato Temporal.');
        }
    }
};

// Valida el límite de headcount (max_limit) del cargo antes de asignarlo.
// Lanza HEADCOUNT_LIMIT si la plaza ya está ocupada. Se usa en alta, edición,
// recontratación y acciones RRHH (PROMOTION/TRANSFER) para cerrar las vías
// laterales que antes solo validaban en UI.
export const assertHeadcountAvailable = (state, roleId, branchId, excludeEmployeeId = null) => {
    if (!roleId) return;
    const roleConfig = state.roles.find(r => String(r.id) === String(roleId));
    if (!roleConfig || roleConfig.max_limit >= 99) return;

    const occupants = state.employees.filter(e => {
        if (e.status !== 'ACTIVO') return false;
        if (excludeEmployeeId != null && String(e.id) === String(excludeEmployeeId)) return false;
        if (String(e.role_id) !== String(roleId)) return false;
        if (roleConfig.scope === 'BRANCH') {
            return String(e.branch_id ?? e.branchId) === String(branchId);
        }
        return true; // GLOBAL
    });

    if (occupants.length >= roleConfig.max_limit) {
        const names = occupants.map(o => o.name).join(', ');
        throw new Error(
            `HEADCOUNT_LIMIT: El cargo "${roleConfig.name}" ` +
            `ya tiene ${roleConfig.max_limit} ocupante(s): ${names}. ` +
            `No se puede asignar este cargo.`
        );
    }
};

export const createEmployeeSlice = (set, get) => ({
    employees: safeJsonParse(localStorage.getItem(CACHE_KEYS.EMPLOYEES), []) || [],
    attendanceLoaded: false,

    setEmployees: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.employees) : updater;
        persistEmployees(next);
        return { employees: next };
    }),

    // 🚨 FUNCIÓN MAESTRA DE ARCHIVOS POR EMPLEADO
    uploadEmployeeFile: async (file, employeeId, folderPath = 'foto_perfil') => {
        if (!file || !employeeId) return null;
        try {
            const bucket = 'empleados'; 
            const fileExt = file.name.split(".").pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            
            const path = `${employeeId}/${folderPath}/${fileName}`;

            const { error } = await supabase.storage.from(bucket).upload(path, file, {
                cacheControl: '3600',
                upsert: true
            });
            
            if (error) throw error;

            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            console.error(`Error subiendo archivo al expediente:`, error.message);
            return null;
        }
    },

    // Sube los archivos nuevos (File en memoria, elegidos en la pestaña
    // Documentación) y conserva tal cual las entradas que ya tenían url (edición
    // sin cambios). Devuelve el array final listo para persistir en la columna
    // jsonb employee_documents — nunca incluye el File crudo.
    //
    // Tras subir, invoca el mismo edge function 'analyze-document' que ya usa
    // el expediente de sucursal (FormAddCustomDocument) para leer la fecha de
    // vencimiento directo de la imagen/PDF vía IA — solo rellena expiry_date si
    // el usuario no la tecleó a mano (misma regla: !docData.expDate). Best-effort:
    // si la IA falla, el documento se guarda igual, solo sin fecha detectada.
    uploadEmployeeDocuments: async (employeeId, docs) => {
        if (!Array.isArray(docs) || docs.length === 0) return [];
        const results = [];
        for (const doc of docs) {
            if (!doc?.category) continue;
            if (doc.file instanceof File) {
                const fileExt = doc.file.name.split('.').pop();
                const filePath = `employees/${employeeId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, doc.file);
                if (uploadError) { console.error('uploadEmployeeDocuments:', uploadError.message); continue; }
                const { data: publicUrlData } = supabase.storage.from('documents').getPublicUrl(filePath);

                let expiryDate = doc.expiry_date || null;
                let issueDate = null;
                try {
                    const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-document', {
                        body: { filePath, bucketName: 'documents' }
                    });
                    if (!aiError && aiResponse?.success && aiResponse.aiData) {
                        if (aiResponse.aiData.expDate && !expiryDate) expiryDate = aiResponse.aiData.expDate;
                        if (aiResponse.aiData.issueDate) issueDate = aiResponse.aiData.issueDate;
                    }
                } catch (aiErr) {
                    console.warn(`analyze-document falló para "${doc.category}":`, aiErr);
                }

                results.push({ category: doc.category, title: doc.title || doc.category, url: publicUrlData.publicUrl, expiry_date: expiryDate, issue_date: issueDate, uploaded_at: new Date().toISOString() });
            } else if (doc.url) {
                results.push({ category: doc.category, title: doc.title || doc.category, url: doc.url, expiry_date: doc.expiry_date || null, issue_date: doc.issue_date || null, uploaded_at: doc.uploaded_at || new Date().toISOString() });
            }
        }
        return results;
    },

    uploadFileToStorage: async (file, bucket = 'documents', folder = '') => {
        if (!file) return null;
        try {
            const fileExt = file.name.split(".").pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const path = folder ? `${String(folder).replace(/\/+$/, '')}/${fileName}` : fileName;
            const { error } = await supabase.storage.from(bucket).upload(path, file);
            if (error) throw error;
            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            console.error(`Error genérico de subida:`, error.message);
            return null;
        }
    },

    addEmployee: async (formData) => {
        try {
            const fNames = (formData.first_names || '').trim().toUpperCase();
            const lNames = (formData.last_names || '').trim().toUpperCase();

            // ── Enlazar con una ficha que ya existe ──────────────────────────
            //
            // El expediente se está rehaciendo desde cero, pero la gente NO es
            // nueva: cada persona ya tiene solicitudes, traslados, bolsas,
            // conteos y bitácoras colgando de su fila. Con `enlazar_con_id`,
            // esto NO crea una segunda ficha: escribe todo lo del formulario
            // SOBRE la que ya está.
            //
            // Por qué así y no creando la nueva y moviéndole el historial:
            // `employees.id` está referenciado por **129 columnas en ~70
            // tablas** (medido el 2026-08-26). Veinte son `ON DELETE CASCADE`
            // —entre ellas `approval_requests.employee_id`, o sea las
            // solicitudes— así que borrar la vieja BORRA el historial en vez de
            // conservarlo; otras quince son `RESTRICT` sobre tablas con filas y
            // harían fallar el borrado. Mover 129 columnas a mano es un
            // barrido donde la que se escapa no da error: queda huérfana o se
            // va en cascada, en silencio.
            //
            // Absorbiendo, el historial **no se mueve**: ya está donde tiene
            // que estar. Y el camino es uno que el portal ya recorre todos los
            // días —es exactamente un `UPDATE` de empleado, con su misma
            // policy, su mismo trigger de auditoría y sus mismas validaciones—,
            // no un camino nuevo que haya que probar.
            const absorbeA = formData.enlazar_con_id || null;
            const fichaAbsorbida = absorbeA
                ? get().employees.find(e => String(e.id) === String(absorbeA)) || null
                : null;
            if (absorbeA && !fichaAbsorbida) {
                throw new Error('La ficha que quieres enlazar ya no está en la lista. Recarga la pantalla y vuelve a elegirla.');
            }

            // El código es la credencial del carné: SOLO números (regla de negocio,
            // también validada por trigger en BD) y único entre empleados.
            const cleanCode = String(formData.code ?? '').trim() || null;
            if (cleanCode) {
                if (!/^\d+$/.test(cleanCode)) {
                    throw new Error('El código de empleado debe contener solo números.');
                }
                // Lo contesta el SERVIDOR. Cruzarlo contra la lista cargada dejó
                // de ser fiable cuando `code` salió de `employees_safe`: quien
                // no ve Ventas no recibe el campo, y una lista sin códigos no
                // encuentra ningún choque — «no encontré» se ve igual que «no
                // hay», y dos personas con el mismo código son dos con la misma
                // contraseña del portal.
                // Al absorber, la ficha destino se excluye: si no, su PROPIO
                // código y su PROPIO DUI se leerían como choque contra sí
                // misma y ninguna persona podría enlazarse conservando los
                // suyos.
                if (await codigoDeCarneLibre(cleanCode, absorbeA) === false) {
                    throw new Error(`El código "${cleanCode}" ya está asignado a otra persona.`);
                }
            }

            await validateDui(formData.dui || null, absorbeA);
            validateOptionalFormats(formData);

            const dbPayload = {
                first_names: fNames,
                last_names: lNames,
                username: formData.username ? formData.username.trim().toLowerCase() : null,
                code: cleanCode,
                
                role_id: formData.role_id ? parseInt(formData.role_id, 10) : null,
                secondary_role_id: formData.secondary_role_id ? parseInt(formData.secondary_role_id, 10) : null,
                suplente_id: formData.suplente_id || null,
                branch_id: formData.branch_id ? parseInt(formData.branch_id, 10) : null,
                
                gender: formData.gender || null,
                blood_type: formData.blood_type || null,
                marital_status: formData.marital_status || null,
                birth_date: formData.birth_date || null,
                dui: formData.dui || null,
                alt_identity_document: formData.alt_identity_document || null,
                alt_identity_document_type: formData.alt_identity_document_type || null,
                // Art. 23 nº2 CT: el numeral pide «número, LUGAR Y FECHA DE
                // EXPEDICIÓN», no sólo el número.
                dui_lugar_expedicion: formData.dui_lugar_expedicion ? formData.dui_lugar_expedicion.trim().toUpperCase() : null,
                dui_fecha_expedicion: formData.dui_fecha_expedicion || null,
                nationality: formData.nationality || null,
                phone: formData.phone || null,
                address: formData.address ? formData.address.trim().toUpperCase() : null,

                department: formData.department || null,
                municipality: formData.municipality || null,
                // Tercer nivel territorial: los 262 distritos de la
                // reestructuración municipal de 2024. Mismo catálogo que la
                // ficha fiscal del cliente.
                distrito: formData.distrito || null,
                education_level: formData.education_level || null,
                profession: normalizeCatalogValue(formData.profession),
                education_grade_completed: formData.education_grade_completed || null,
                education_specialty: normalizeCatalogValue(formData.education_specialty),
                is_studying: !!formData.is_studying,
                study_start_date: formData.is_studying ? (formData.study_start_date || null) : null,
                study_duration_years: (formData.is_studying && formData.study_duration_years) ? parseFloat(formData.study_duration_years) : null,
                has_maestria: formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && !!formData.has_maestria,
                maestria_title: (formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && formData.has_maestria) ? normalizeCatalogValue(formData.maestria_title) : null,
                maestria_is_studying: formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && !!formData.has_maestria && !!formData.maestria_is_studying,
                maestria_study_start_date: (formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && formData.has_maestria && formData.maestria_is_studying) ? (formData.maestria_study_start_date || null) : null,
                maestria_study_duration_years: (formData.education_level === 'UNIVERSITARIO' && !formData.is_studying && formData.has_maestria && formData.maestria_is_studying && formData.maestria_study_duration_years) ? parseFloat(formData.maestria_study_duration_years) : null,
                additional_skills: normalizeAdditionalSkills(formData.additional_skills),
                extra_phones: Array.isArray(formData.extra_phones) ? formData.extra_phones.map(p => (p || '').trim()).filter(Boolean) : [],
                extra_addresses: normalizeExtraAddresses(formData.extra_addresses),

                email: formData.email || null,
                emergency_contact_name: formData.emergency_contact_name ? formData.emergency_contact_name.trim().toUpperCase() : null,
                emergency_contact_phone: formData.emergency_contact_phone || null,
                emergency_contact_relationship: formData.emergency_contact_relationship || null,
                emergency_contact_extra_phones: Array.isArray(formData.emergency_contact_extra_phones) ? formData.emergency_contact_extra_phones.map(p => (p || '').trim()).filter(Boolean) : [],
                emergency_contacts: normalizeContactosEmergencia(
                    { nombre: formData.emergency_contact_name, parentesco: formData.emergency_contact_relationship, telefono: formData.emergency_contact_phone },
                    formData.contactos_extra ?? (formData.emergency_contacts || []).slice(1)),
                economic_dependents: normalizeEconomicDependents(formData.economic_dependents),
                chronic_conditions: normalizeChronicConditions(formData.chronic_conditions),
                has_disability: !!formData.has_disability,
                disability_type: formData.has_disability ? normalizeCatalogValue(formData.disability_type) : null,
                disability_grade: formData.has_disability ? (formData.disability_grade || null) : null,
                disability_has_certification: formData.has_disability && !!formData.disability_has_certification,

                contract_type: formData.contract_type || 'INDEFINIDO',
                contract_start_date: formData.contract_start_date || null,
                // TEMPORAL y SERVICIOS los dos tienen plazo. La base legal y el
                // motivo, en cambio, son del Art. 25 —que es laboral— así que
                // sólo aplican al temporal.
                contract_end_date: (formData.contract_type === 'TEMPORAL' || formData.contract_type === 'SERVICIOS')
                    ? (formData.contract_end_date || null) : null,
                contrato_prorrogas: Array.isArray(formData.contrato_prorrogas)
                    ? formData.contrato_prorrogas.filter(p => p?.hasta).map(p => ({
                        desde: p.desde || null, hasta: p.hasta, motivo: (p.motivo || '').trim(),
                      }))
                    : [],
                contract_temporal_legal_basis: formData.contract_type === 'TEMPORAL' ? (formData.contract_temporal_legal_basis || null) : null,
                contract_temporal_reason: formData.contract_type === 'TEMPORAL' ? (formData.contract_temporal_reason || null) : null,
                weekly_contracted_hours: formData.weekly_contracted_hours ? parseInt(formData.weekly_contracted_hours, 10) : 44,
                // Art. 23 nº13 CT: dónde y cuándo se FIRMÓ. No es el nº5
                // (`contract_start_date`, cuándo empieza a trabajar): se firma
                // un día y se empieza otro.
                contrato_lugar_celebracion: formData.contrato_lugar_celebracion ? formData.contrato_lugar_celebracion.trim().toUpperCase() : null,
                contrato_fecha_celebracion: formData.contrato_fecha_celebracion || null,
                // Art. 23 nº10 CT: «cantidad, calidad y estado» de lo que
                // entrega el patrono. Vacío es una lista vacía, no null — la
                // columna es NOT NULL y el CHECK exige que sea un array.
                herramientas_entregadas: normalizeHerramientas(formData.herramientas_entregadas),
                // Art. 23 nº9 desarmado en sus tres partes: la estipulación
                // (Art. 126, que decide el plazo del Art. 130), el medio y el
                // lugar. Ver `utils/contrato.js`.
                forma_estipulacion_salario: formData.forma_estipulacion_salario || null,
                medio_pago: formData.medio_pago || null,
                lugar_pago: formData.lugar_pago ? formData.lugar_pago.trim().toUpperCase() : null,
                // Art. 18: cuándo se remitió el tercer ejemplar. No aplica a
                // servicios profesionales — es un contrato civil.
                mtps_remitido_fecha: formData.mtps_remitido_fecha || null,
                isss_estado: formData.isss_estado || null,
                afp_estado: formData.afp_estado || null,
                base_salary: formData.base_salary ? parseFloat(formData.base_salary) : null,
                has_motorcycle: !!formData.has_motorcycle,
                has_car: !!formData.has_car,
                has_motorcycle_license: !!formData.has_motorcycle_license,
                has_car_license: !!formData.has_car_license,
                has_srs_accreditation: !!formData.has_srs_accreditation,
                srs_accreditation_expiry: formData.has_srs_accreditation ? (formData.srs_accreditation_expiry || null) : null,
                nursing_license_number: formData.nursing_license_number || null,
                // Las otras dos juntas. Médica y enfermería son del Consejo
                // Superior de Salud Pública; contaduría NO —es el CVPCPA— y por
                // eso son columnas separadas y no un «número de junta».
                medico_license_number: formData.medico_license_number || null,
                contador_license_number: formData.contador_license_number || null,
                // Acreditación de dependiente de farmacia (CSSP). Tiene trámite
                // de REacreditación: vence, y su comprobante lleva la fecha.
                tiene_acreditacion_dependiente: !!formData.tiene_acreditacion_dependiente,
                pharmacist_license_number: formData.pharmacist_license_number || null,
                hire_date: formData.hire_date || null,
                afp_number: formData.afp_number || null,
                isss_number: formData.isss_number || null,
                afp_institution: formData.afp_institution || null,
                bank_name: formData.bank_name || null,
                account_number: formData.account_number || null,
                account_type: formData.account_type || 'AHORRO',
                // Art. 23 nº9 CT: «forma, PERÍODO y lugar de pago». El banco y
                // la cuenta son la forma y el lugar; el período faltaba. Sin
                // valor por defecto: NULL es «no se pactó», y eso se ve.
                periodo_pago: formData.periodo_pago || null,
                
                kiosk_pin: formData.kiosk_pin || null,
                // La marca «todavía no tiene carné»: es lo que habilita
                // imprimirle uno de papel sin el permiso aparte.
                carne_pendiente: !!formData.carne_pendiente,
                status: 'ACTIVO',
            };

            // La foto se sube DESPUÉS (necesita el id de la fila), así que el
            // alta arranca con la columna en null y la llena en un segundo
            // paso. Al absorber eso sería un borrado: quien enlaza una ficha
            // sin adjuntar foto nueva no está pidiendo quitarle la que tenía,
            // y recuperar 46 fotos es un trabajo que nadie eligió. Si adjunta
            // una, el segundo paso la pisa igual.
            if (!absorbeA) dbPayload.photo_url = null;

            // Validar headcount del cargo seleccionado. Al absorber, la ficha
            // destino se excluye del conteo: esa persona YA ocupa la plaza, y
            // contarla otra vez haría que un cargo de un solo puesto rechace
            // enlazar justo a quien lo ocupa.
            assertHeadcountAvailable(get(), dbPayload.role_id, dbPayload.branch_id, absorbeA);

            const { data: newEmp, error } = absorbeA
                ? await updateEmployeeReturning(absorbeA, dbPayload)
                : await insertEmployee(dbPayload);
            if (error) {
                console.error(absorbeA ? 'Supabase UPDATE error:' : 'Supabase INSERT error:', error.message, error.details, error.hint);
                throw error;
            }
            registerCatalogEntry(dbPayload.education_level, dbPayload.education_specialty, dbPayload.profession, dbPayload.maestria_title);
            registerSkillCatalogEntries(dbPayload.additional_skills);
            registerMedicalCatalogEntries(dbPayload.chronic_conditions, dbPayload.disability_type);

            const uploadedFile = formData.file || formData.photo;
            if (uploadedFile && uploadedFile instanceof File) {
                // Comprimimos antes de subir
                const compressedPhoto = await compressImage(uploadedFile);
                const publicPhotoUrl = await get().uploadEmployeeFile(compressedPhoto, newEmp.id, 'foto_perfil');
                if (publicPhotoUrl) {
                    await updateEmployee(newEmp.id, { photo_url: publicPhotoUrl });
                    newEmp.photo_url = publicPhotoUrl;
                }
            }

            if (Array.isArray(formData.employee_documents) && formData.employee_documents.length > 0) {
                const uploadedDocs = await get().uploadEmployeeDocuments(newEmp.id, formData.employee_documents);
                await updateEmployee(newEmp.id, { employee_documents: uploadedDocs });
                newEmp.employee_documents = uploadedDocs;
            }

            // Asignar sucursales adicionales si aplica (empleados externos).
            // Al absorber hay que BORRAR las que tenía: la ficha vieja puede
            // traer las suyas y un insert a secas las sumaría en vez de
            // reemplazarlas, dejando a la persona con acceso a salas que el
            // formulario ya no dice. Es el mismo orden que usa `updateEmployee`.
            const assignedBranches = Array.isArray(formData.assigned_branch_ids) ? formData.assigned_branch_ids.map(Number).filter(Boolean) : [];
            if (absorbeA) await deleteEmployeeBranches(newEmp.id);
            if (assignedBranches.length > 0) {
                await insertEmployeeBranches(
                    assignedBranches.map(branch_id => ({ employee_id: newEmp.id, branch_id }))
                );
            }

            // Crear usuario Auth automáticamente (no bloquea la creación si falla).
            // La edge function genera una temporal aleatoria y la devuelve — hay que
            // capturarla aquí para mostrársela al admin (antes se descartaba y el
            // primer login era imposible sin un reset manual).
            let tempPassword = null;
            if (dbPayload.username) {
                try {
                    const { data: authResult, error: authError } =
                        await supabase.functions.invoke('set-employee-password', {
                            body: { username: dbPayload.username, password: '1234' }
                        });
                    if (authError) {
                        console.warn('Auth creation error:', authError);
                    } else if (!authResult?.ok) {
                        console.warn('Auth creation failed:', authResult);
                    } else {
                        tempPassword = authResult.tempPassword || null;
                    }
                } catch (authErr) {
                    console.warn('No se pudo crear usuario Auth:', authErr);
                }
            }

            // El asiento dice cuál de las dos cosas pasó, y al enlazar deja
            // escrito CON QUÉ ficha — que es el único rastro de que ese
            // expediente tuvo otro nombre antes. La fila no se duplicó, así que
            // sin esta línea la absorción sería indistinguible de una edición.
            await get().appendAuditLog(absorbeA ? 'PERSONAL_ENLAZADO' : 'PERSONAL_ASIGNADO', newEmp.id, {
                timeline_title: absorbeA
                    ? `Expediente enlazado: ${fichaAbsorbida.name} → ${newEmp.name}`
                    : `Nuevo Ingreso: ${newEmp.name}`,
                dimension: 'HR',
                branch_id: newEmp.branch_id,
                old_value: absorbeA ? `${fichaAbsorbida.name}${fichaAbsorbida.code ? ` · ${fichaAbsorbida.code}` : ''}` : undefined,
                new_value: absorbeA
                    ? 'Expediente rehecho sobre la ficha existente — historial conservado'
                    : 'Expediente creado'
            });
            
            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const roles = get().roles;
            const mainRoleName = roles.find(r => String(r.id) === String(newEmp.role_id))?.name || null;
            const secRoleName = roles.find(r => String(r.id) === String(newEmp.secondary_role_id))?.name || null;

            // Al absorber se parte de la entrada que ya estaba —no de
            // `dbPayload`— y por un motivo concreto: ese objeto lleva el código
            // de carné, el DUI, el sueldo y la cuenta bancaria, y esta lista se
            // persiste en `localStorage`. Volcarlo ahí devolvería al disco de
            // una computadora compartida exactamente lo que salió de
            // `employees_safe` el 2026-08-24. Se copian sólo los campos que esa
            // vista ya publica.
            const base = fichaAbsorbida || {};
            const appEmp = {
                ...base,
                ...newEmp,
                first_names: dbPayload.first_names,
                last_names: dbPayload.last_names,
                branchId: newEmp.branch_id,
                hireDate: dbPayload.hire_date,
                birthDate: dbPayload.birth_date,
                photo: newEmp.photo_url ? await getSignedFileUrl(newEmp.photo_url, 43200) : null,
                role: mainRoleName,
                secondary_role: secRoleName,
                assigned_branch_ids: assignedBranches,
                attendance: base.attendance || [],
                history: base.history || [],
                documents: base.documents || []
            };

            set((state) => {
                // Absorber REEMPLAZA, no agrega: un append dejaría dos tarjetas
                // de la misma persona en pantalla hasta la próxima recarga, que
                // es justo el duplicado que esto viene a cerrar.
                const next = absorbeA
                    ? state.employees.map(e => String(e.id) === String(newEmp.id) ? appEmp : e)
                    : [...state.employees, appEmp];
                persistEmployees(next);
                return { employees: next };
            });
            return { id: appEmp.id, username: dbPayload.username, tempPassword, enlazadoCon: fichaAbsorbida?.name || null };
        } catch (err) {
            console.error("Fallo al crear empleado:", err);
            throw err; // Re-lanzar el error original sin modificarlo
        }
    },

    updateEmployee: async (id, updatedData) => {
        try {
            const dbPayload = { ...updatedData };

            // Mismas reglas del código que en addEmployee: trim, único, y SOLO números.
            // Los códigos legacy no numéricos (SUPERADMIN, edwin, etc.) se toleran
            // mientras NO cambien — igual que el trigger de BD.
            if (dbPayload.code !== undefined) {
                dbPayload.code = String(dbPayload.code ?? '').trim() || null;
                if (dbPayload.code) {
                    const prevCode = (get().employees.find(e => String(e.id) === String(id))?.code || '').trim();
                    if (dbPayload.code !== prevCode && !/^\d+$/.test(dbPayload.code)) {
                        throw new Error('El código de empleado debe contener solo números.');
                    }
                    // Igual que en el alta: la unicidad la contesta el servidor.
                    if (await codigoDeCarneLibre(dbPayload.code, id) === false) {
                        throw new Error(`El código "${dbPayload.code}" ya está asignado a otra persona.`);
                    }
                }
            }

            if (dbPayload.dui !== undefined) {
                dbPayload.dui = String(dbPayload.dui ?? '').trim() || null;
                await validateDui(dbPayload.dui, id);
            }
            validateOptionalFormats(dbPayload);

            // branch_id: null/'' significa "quitar de la sucursal" (bolsa flotante) —
            // el mapeo anterior solo aceptaba valores truthy y el desasignar no se guardaba.
            if (updatedData.branch_id !== undefined || updatedData.branchId !== undefined) {
                const rawBranch = updatedData.branch_id !== undefined ? updatedData.branch_id : updatedData.branchId;
                dbPayload.branch_id = (rawBranch === null || rawBranch === '') ? null : parseInt(rawBranch, 10);
            }
            
            const uploadedFile = updatedData.file || updatedData.photo;
            if (uploadedFile instanceof File) {
                // Comprimimos antes de subir
                const compressedPhoto = await compressImage(uploadedFile);
                dbPayload.photo_url = await get().uploadEmployeeFile(compressedPhoto, id, 'foto_perfil');
            }

            if (updatedData.employee_documents !== undefined) {
                dbPayload.employee_documents = await get().uploadEmployeeDocuments(id, updatedData.employee_documents);
            }

            if (updatedData.role_id !== undefined) dbPayload.role_id = updatedData.role_id ? parseInt(updatedData.role_id, 10) : null;
            if (updatedData.secondary_role_id !== undefined) dbPayload.secondary_role_id = updatedData.secondary_role_id ? parseInt(updatedData.secondary_role_id, 10) : null;
            // Quitar el suplente llega como '' desde el select: '' no es un uuid y
            // rompería el insert, así que se guarda NULL («sin nadie elegido»).
            if (updatedData.suplente_id !== undefined) dbPayload.suplente_id = updatedData.suplente_id || null;
            
            if (updatedData.username) dbPayload.username = updatedData.username.trim().toLowerCase();
            if (updatedData.first_names) dbPayload.first_names = updatedData.first_names.trim().toUpperCase();
            if (updatedData.last_names) dbPayload.last_names = updatedData.last_names.trim().toUpperCase();
            if (updatedData.address !== undefined) dbPayload.address = updatedData.address ? updatedData.address.trim().toUpperCase() : null;
            if (updatedData.profession !== undefined) dbPayload.profession = normalizeCatalogValue(updatedData.profession);
            if (updatedData.emergency_contact_name !== undefined) dbPayload.emergency_contact_name = updatedData.emergency_contact_name ? updatedData.emergency_contact_name.trim().toUpperCase() : null;
            if (updatedData.education_specialty !== undefined) dbPayload.education_specialty = normalizeCatalogValue(updatedData.education_specialty);
            if (updatedData.weekly_contracted_hours) dbPayload.weekly_contracted_hours = parseInt(updatedData.weekly_contracted_hours, 10);
            if (updatedData.base_salary) dbPayload.base_salary = parseFloat(updatedData.base_salary);
            if (updatedData.contract_start_date !== undefined) dbPayload.contract_start_date = updatedData.contract_start_date || null;
            if (updatedData.has_motorcycle !== undefined) dbPayload.has_motorcycle = !!updatedData.has_motorcycle;
            if (updatedData.has_car !== undefined) dbPayload.has_car = !!updatedData.has_car;
            if (updatedData.has_motorcycle_license !== undefined) dbPayload.has_motorcycle_license = !!updatedData.has_motorcycle_license;
            if (updatedData.has_car_license !== undefined) dbPayload.has_car_license = !!updatedData.has_car_license;
            if (updatedData.has_srs_accreditation !== undefined || updatedData.srs_accreditation_expiry !== undefined) {
                const hasSrs = !!updatedData.has_srs_accreditation;
                dbPayload.has_srs_accreditation = hasSrs;
                dbPayload.srs_accreditation_expiry = hasSrs ? (updatedData.srs_accreditation_expiry || null) : null;
            }

            if (updatedData.is_studying !== undefined) {
                dbPayload.is_studying = !!updatedData.is_studying;
                dbPayload.study_start_date = dbPayload.is_studying ? (updatedData.study_start_date || null) : null;
                dbPayload.study_duration_years = dbPayload.is_studying && updatedData.study_duration_years ? parseFloat(updatedData.study_duration_years) : null;
            } else if (updatedData.study_duration_years !== undefined) {
                dbPayload.study_duration_years = updatedData.study_duration_years ? parseFloat(updatedData.study_duration_years) : null;
            }
            // "¿Actualmente estudiando?" (Universitario) y Maestría son mutuamente excluyentes
            // (tener maestría implica licenciatura terminada, y seguir cursándola implica que la
            // maestría no aplica todavía) — is_studying manda si por algún camino llegan ambos true.
            if (updatedData.has_maestria !== undefined || updatedData.maestria_title !== undefined || updatedData.maestria_is_studying !== undefined) {
                const isUniversitario = (updatedData.education_level ?? dbPayload.education_level) === 'UNIVERSITARIO';
                const isStudying = updatedData.is_studying !== undefined ? !!updatedData.is_studying : !!dbPayload.is_studying;
                const hasMaestria = isUniversitario && !isStudying && !!updatedData.has_maestria;
                dbPayload.has_maestria = hasMaestria;
                dbPayload.maestria_title = hasMaestria ? normalizeCatalogValue(updatedData.maestria_title) : null;
                dbPayload.maestria_is_studying = hasMaestria && !!updatedData.maestria_is_studying;
                dbPayload.maestria_study_start_date = (hasMaestria && updatedData.maestria_is_studying) ? (updatedData.maestria_study_start_date || null) : null;
                dbPayload.maestria_study_duration_years = (hasMaestria && updatedData.maestria_is_studying && updatedData.maestria_study_duration_years) ? parseFloat(updatedData.maestria_study_duration_years) : null;
            }
            if (updatedData.additional_skills !== undefined) {
                dbPayload.additional_skills = normalizeAdditionalSkills(updatedData.additional_skills);
            }
            if (updatedData.extra_phones !== undefined) {
                dbPayload.extra_phones = Array.isArray(updatedData.extra_phones) ? updatedData.extra_phones.map(p => (p || '').trim()).filter(Boolean) : [];
            }
            if (updatedData.extra_addresses !== undefined) {
                dbPayload.extra_addresses = normalizeExtraAddresses(updatedData.extra_addresses);
            }
            if (updatedData.emergency_contact_relationship !== undefined) dbPayload.emergency_contact_relationship = updatedData.emergency_contact_relationship || null;
            if (updatedData.emergency_contact_extra_phones !== undefined) {
                dbPayload.emergency_contact_extra_phones = Array.isArray(updatedData.emergency_contact_extra_phones) ? updatedData.emergency_contact_extra_phones.map(p => (p || '').trim()).filter(Boolean) : [];
            }
            if (updatedData.economic_dependents !== undefined) {
                dbPayload.economic_dependents = normalizeEconomicDependents(updatedData.economic_dependents);
            }
            if (updatedData.chronic_conditions !== undefined) dbPayload.chronic_conditions = normalizeChronicConditions(updatedData.chronic_conditions);
            if (updatedData.has_disability !== undefined || updatedData.disability_type !== undefined || updatedData.disability_grade !== undefined || updatedData.disability_has_certification !== undefined) {
                const hasDisability = !!updatedData.has_disability;
                dbPayload.has_disability = hasDisability;
                dbPayload.disability_type = hasDisability ? normalizeCatalogValue(updatedData.disability_type) : null;
                dbPayload.disability_grade = hasDisability ? (updatedData.disability_grade || null) : null;
                dbPayload.disability_has_certification = hasDisability && !!updatedData.disability_has_certification;
            }
            if (updatedData.afp_institution !== undefined) dbPayload.afp_institution = updatedData.afp_institution || null;
            if (updatedData.account_type !== undefined) dbPayload.account_type = updatedData.account_type || 'AHORRO';

            // Art. 23 CT — los cuatro que se agregaron el 2026-08-26. Se
            // normalizan acá igual que en el alta: si sólo se normalizara allá,
            // editar un expediente guardaría un formato distinto del que dejó
            // el alta y la misma columna tendría dos formas.
            if (updatedData.periodo_pago !== undefined) dbPayload.periodo_pago = updatedData.periodo_pago || null;
            if (updatedData.distrito !== undefined) dbPayload.distrito = updatedData.distrito || null;
            if (updatedData.forma_estipulacion_salario !== undefined) dbPayload.forma_estipulacion_salario = updatedData.forma_estipulacion_salario || null;
            if (updatedData.medio_pago !== undefined) dbPayload.medio_pago = updatedData.medio_pago || null;
            if (updatedData.lugar_pago !== undefined) dbPayload.lugar_pago = updatedData.lugar_pago ? updatedData.lugar_pago.trim().toUpperCase() : null;
            if (updatedData.mtps_remitido_fecha !== undefined) dbPayload.mtps_remitido_fecha = updatedData.mtps_remitido_fecha || null;
            if (updatedData.isss_estado !== undefined) dbPayload.isss_estado = updatedData.isss_estado || null;
            if (updatedData.afp_estado !== undefined) dbPayload.afp_estado = updatedData.afp_estado || null;
            if (updatedData.medico_license_number !== undefined) dbPayload.medico_license_number = updatedData.medico_license_number || null;
            if (updatedData.contador_license_number !== undefined) dbPayload.contador_license_number = updatedData.contador_license_number || null;
            if (updatedData.tiene_acreditacion_dependiente !== undefined) dbPayload.tiene_acreditacion_dependiente = !!updatedData.tiene_acreditacion_dependiente;
            if (updatedData.dui_lugar_expedicion !== undefined) dbPayload.dui_lugar_expedicion = updatedData.dui_lugar_expedicion ? updatedData.dui_lugar_expedicion.trim().toUpperCase() : null;
            if (updatedData.dui_fecha_expedicion !== undefined) dbPayload.dui_fecha_expedicion = updatedData.dui_fecha_expedicion || null;
            if (updatedData.contrato_lugar_celebracion !== undefined) dbPayload.contrato_lugar_celebracion = updatedData.contrato_lugar_celebracion ? updatedData.contrato_lugar_celebracion.trim().toUpperCase() : null;
            if (updatedData.contrato_fecha_celebracion !== undefined) dbPayload.contrato_fecha_celebracion = updatedData.contrato_fecha_celebracion || null;
            if (updatedData.herramientas_entregadas !== undefined) dbPayload.herramientas_entregadas = normalizeHerramientas(updatedData.herramientas_entregadas);
            
            if (updatedData.contrato_prorrogas !== undefined) {
                dbPayload.contrato_prorrogas = Array.isArray(updatedData.contrato_prorrogas)
                    ? updatedData.contrato_prorrogas.filter(p => p?.hasta).map(p => ({
                        desde: p.desde || null, hasta: p.hasta, motivo: (p.motivo || '').trim() }))
                    : [];
            }
            // Servicios profesionales también tiene plazo: sólo se limpia la
            // fecha de fin en los tipos que de verdad no la tienen.
            if (updatedData.contract_type && updatedData.contract_type !== 'TEMPORAL' && updatedData.contract_type !== 'SERVICIOS') {
                dbPayload.contract_end_date = null;
                dbPayload.contract_temporal_legal_basis = null;
                dbPayload.contract_temporal_reason = null;
            }

            delete dbPayload.id;
            // Sólo tiene sentido al dar de alta (lo lee `addEmployee`). Si
            // llegara acá sería una columna inexistente y PostgREST rechazaría
            // el UPDATE entero.
            // La lista se recompone SIEMPRE que se toque el contacto principal o
            // los extras: si sólo se recompusiera al tocar los extras, cambiarle
            // el teléfono al principal dejaría la lista con el número viejo y
            // nadie notaría la discrepancia.
            if (updatedData.contactos_extra !== undefined
                || updatedData.emergency_contact_name !== undefined
                || updatedData.emergency_contact_phone !== undefined
                || updatedData.emergency_contact_relationship !== undefined) {
                dbPayload.emergency_contacts = normalizeContactosEmergencia(
                    { nombre: updatedData.emergency_contact_name, parentesco: updatedData.emergency_contact_relationship, telefono: updatedData.emergency_contact_phone },
                    updatedData.contactos_extra ?? (updatedData.emergency_contacts || []).slice(1));
            }

            delete dbPayload.enlazar_con_id;
            // Sólo vive en el formulario: la columna es `emergency_contacts`.
            delete dbPayload.contactos_extra;
            delete dbPayload.branchId;
            delete dbPayload.photo;
            delete dbPayload.file;
            delete dbPayload.history;
            delete dbPayload.documents;
            delete dbPayload.attendance;
            delete dbPayload.role;
            delete dbPayload.main_role;
            delete dbPayload.secondary_role;
            delete dbPayload.sec_role;
            delete dbPayload.effectiveStatus;
            delete dbPayload.created_at;
            delete dbPayload.photoPreview;
            delete dbPayload.birthDate;
            delete dbPayload.hireDate;
            delete dbPayload.weeklySchedule;

            const newAssignedBranches = Array.isArray(dbPayload.assigned_branch_ids)
                ? dbPayload.assigned_branch_ids.map(Number).filter(Boolean)
                : null;
            delete dbPayload.assigned_branch_ids;

            // Validar headcount si se asigna un cargo (misma regla que en el alta)
            if (dbPayload.role_id) {
                const currentEmp = get().employees.find(e => String(e.id) === String(id));
                const targetBranch = dbPayload.branch_id !== undefined
                    ? dbPayload.branch_id
                    : (currentEmp?.branch_id ?? currentEmp?.branchId);
                assertHeadcountAvailable(get(), dbPayload.role_id, targetBranch, id);
            }

            const { data: updated, error } = await updateEmployeeReturning(id, dbPayload);
            if (error) throw error;
            if (dbPayload.education_specialty !== undefined || dbPayload.profession !== undefined || dbPayload.maestria_title !== undefined) {
                registerCatalogEntry(dbPayload.education_level ?? updated.education_level, dbPayload.education_specialty, dbPayload.profession, dbPayload.maestria_title);
            }
            if (dbPayload.additional_skills !== undefined) registerSkillCatalogEntries(dbPayload.additional_skills);
            if (dbPayload.chronic_conditions !== undefined || dbPayload.disability_type !== undefined) {
                registerMedicalCatalogEntries(dbPayload.chronic_conditions, dbPayload.disability_type);
            }

            // Sync branch assignments to junction table if provided
            if (newAssignedBranches !== null) {
                await deleteEmployeeBranches(id);
                if (newAssignedBranches.length > 0) {
                    await insertEmployeeBranches(
                        newAssignedBranches.map(branch_id => ({ employee_id: id, branch_id }))
                    );
                }
            }

            await get().appendAuditLog('EDITAR_EMPLEADO', id, {
                timeline_title: `Actualización de Personal: ${updated.name}`,
                dimension: 'HR',
                branch_id: updated.branch_id,
                new_value: 'Expediente modificado'
            });

            // Nombrar a quien te cubre reparte permisos mientras no estás, así que
            // deja su propio asiento en la bitácora en vez de quedar enterrado en
            // «Expediente modificado». El estado local todavía no se actualizó acá
            // abajo, así que `get().employees` conserva el valor anterior.
            if (updatedData.suplente_id !== undefined) {
                const antes = get().employees.find(e => String(e.id) === String(id))?.suplente_id ?? null;
                const ahora = dbPayload.suplente_id ?? null;
                if (String(antes ?? '') !== String(ahora ?? '')) {
                    const nombreDe = (empId) => (empId
                        ? get().employees.find(e => String(e.id) === String(empId))?.name || 'otra persona'
                        : null);
                    await get().appendAuditLog('EDITAR_EMPLEADO', id, {
                        timeline_title: ahora
                            ? `Cobertura por ausencia: a ${updated.name} lo cubre ${nombreDe(ahora)}`
                            : `Cobertura por ausencia: ${updated.name} queda sin nadie elegido`,
                        dimension: 'HR',
                        branch_id: updated.branch_id,
                        old_value: nombreDe(antes) || 'Sin nadie elegido',
                        new_value: nombreDe(ahora) || 'Sin nadie elegido'
                    });
                }
            }

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const roles = get().roles;
            const mainRoleName = roles.find(r => String(r.id) === String(updated.role_id))?.name || null;
            const secRoleName = roles.find(r => String(r.id) === String(updated.secondary_role_id))?.name || null;

            // Foto nueva: firmar para el estado local (photo_url en BD queda crudo)
            const signedPhoto = dbPayload.photo_url && updated.photo_url
                ? await getSignedFileUrl(updated.photo_url, 43200)
                : null;

            set((state) => {
                const next = state.employees.map((emp) => {
                    if (String(emp.id) !== String(id)) return emp;

                    return {
                        ...emp,
                        ...updated,
                        // `updated` es la fila completa post-UPDATE: branch_id null es real
                        // (desasignación), no un dato faltante — sin fallback al valor previo.
                        branchId: updated.branch_id,
                        photo: signedPhoto ?? emp.photo,
                        birthDate: updated.birth_date ?? emp.birthDate,
                        hireDate: updated.hire_date ?? emp.hireDate,
                        role: updated.role_id ? (mainRoleName || emp.role) : SIN_ASIGNAR,
                        secondary_role: updated.secondary_role_id ? (secRoleName !== null ? secRoleName : emp.secondary_role) : null
                    };
                });
                persistEmployees(next);
                return { employees: next };
            });
            return true;
        } catch (err) {
            console.error("Error actualizando empleado:", err);
            throw err; 
        }
    },

    rehireEmployee: async (id, rehireData) => {
        const emp = get().employees.find(e => String(e.id) === String(id));
        if (!emp) throw new Error("Empleado no encontrado");

        assertHeadcountAvailable(get(), parseInt(rehireData.role_id, 10), parseInt(rehireData.branch_id, 10), id);

        // Regenerar PIN desde su código
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(emp.code));
        const base64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
        const newPin = base64.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 8);

        // ── La fecha de fin NO se borra a ciegas ────────────────────────────
        //
        // Esto escribía `contract_end_date: null` SIEMPRE. Con un contrato
        // indefinido está bien —no tiene fin— pero recontratar a PLAZO dejaba
        // un temporal sin fecha de fin y sin base legal, y el Art. 25 presume
        // indefinido exactamente eso: un plazo sin justificar. O sea que el
        // portal producía un contrato que afirma algo que la ley no reconoce, y
        // sin dar ningún error.
        //
        // Y un contrato nuevo es un contrato nuevo: sus fechas de celebración
        // arrancan de cero, y con ellas el plazo del Art. 18. Antes no se
        // escribían, así que la ficha recontratada conservaba la firma del
        // contrato ANTERIOR — y el aviso del Ministerio contaba ocho días desde
        // una fecha que ya no correspondía a nada.
        const tipo = rehireData.contract_type || 'INDEFINIDO';
        const aPlazo = tipo === 'TEMPORAL';
        const dbPayload = {
            status: 'ACTIVO',
            branch_id: parseInt(rehireData.branch_id, 10),
            role_id: parseInt(rehireData.role_id, 10),
            secondary_role_id: rehireData.secondary_role_id ? parseInt(rehireData.secondary_role_id, 10) : null,
            hire_date: rehireData.hire_date,
            contract_type: tipo,
            weekly_contracted_hours: parseInt(rehireData.weekly_contracted_hours, 10) || 44,
            base_salary: rehireData.base_salary ? parseFloat(rehireData.base_salary) : null,
            contract_end_date: aPlazo ? (rehireData.contract_end_date || null) : null,
            contract_temporal_legal_basis: aPlazo ? (rehireData.contract_temporal_legal_basis || null) : null,
            contract_temporal_reason: aPlazo ? (rehireData.contract_temporal_reason || null) : null,
            // El contrato nuevo se firma de nuevo. Si el formulario no lo dice,
            // se toma la fecha de reingreso: es la que la persona puede
            // afirmar, y dejarla en blanco arrastraría la firma del contrato
            // viejo.
            contrato_fecha_celebracion: rehireData.contrato_fecha_celebracion || rehireData.hire_date || null,
            contrato_lugar_celebracion: rehireData.contrato_lugar_celebracion
                ? String(rehireData.contrato_lugar_celebracion).trim().toUpperCase()
                : (emp.contrato_lugar_celebracion || null),
            // El acuse es del contrato ANTERIOR: no vale para éste, y dejarlo
            // haría que el portal diga «ya se remitió» sobre algo que nunca se
            // remitió. Los ocho días del Art. 18 arrancan otra vez.
            mtps_remitido_fecha: null,
            kiosk_pin: newPin,
        };

        const { error } = await updateEmployee(id, dbPayload);
        if (error) throw error;

        // Levantar el ban de la cuenta Auth aplicado en la baja (best-effort)
        supabase.functions.invoke('disable-employee-auth', {
            body: { employeeId: id, action: 'enable' }
        }).catch(err => console.warn('No se pudo reactivar la cuenta Auth:', err));

        const roles = get().roles;
        const mainRoleName = roles.find(r => String(r.id) === String(dbPayload.role_id))?.name || null;

        await insertEmployeeEventRaw({
            employee_id: id,
            type: 'REHIRE',
            date: rehireData.hire_date,
            note: rehireData.notes || 'Recontratación',
            metadata: {
                previous_status: 'INACTIVO',
                new_role: mainRoleName,
                target_branch_id: dbPayload.branch_id,
            }
        });

        await get().appendAuditLog('RECONTRATACION', id, {
            timeline_title: `Recontratación: ${emp.name}`,
            dimension: 'HR',
            branch_id: dbPayload.branch_id,
            new_value: 'Recontratado',
            notas: rehireData.notes || ''
        });

        window.dispatchEvent(new CustomEvent('force-history-refresh'));

        set((state) => {
            const next = state.employees.map(e => {
                if (String(e.id) !== String(id)) return e;
                return { ...e, ...dbPayload, branchId: dbPayload.branch_id, hireDate: rehireData.hire_date, role: mainRoleName };
            });
            persistEmployees(next);
            return { employees: next };
        });

        return true;
    },

    vacationRecallEmployee: async (id, recallData) => {
        const emp = get().employees.find(e => String(e.id) === String(id));
        if (!emp) throw new Error("Empleado no encontrado");

        const { date, shift_id, reason, approved_by } = recallData;

        // 1. Reactivar ese día en employee_rosters (quitar LIBRE, asignar turno)
        const getMondayISO = (dateStr) => {
            const d = new Date(dateStr + 'T00:00:00');
            const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
            d.setDate(d.getDate() + diff);
            return d.toISOString().split('T')[0];
        };
        const weekStart = getMondayISO(date);
        // Domingo = "0" (ver `claveDeDia`). Con 7 el día reactivado quedaba en
        // una clave que ni la pantalla de horarios ni la planilla leen.
        const dayId   = claveDeDia(new Date(date + 'T00:00:00'));

        const { data: roster } = await fetchEmployeeRosterSchedule(id, weekStart);
        const raw = roster?.schedule_data || {};
        const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };
        sched[dayId] = { shiftId: shift_id, note: 'Ingreso en vacaciones' };
        await upsertWeeklyRoster({ employee_id: id, week_start_date: weekStart, schedule_data: sched });

        // 2. Calcular horas del turno para sumar a hours_owed
        const shifts = get().shifts || [];
        const shift = shifts.find(s => String(s.id) === String(shift_id));
        let hoursWorked = 0;
        if (shift?.start && shift?.end) {
            const [sh, sm] = shift.start.split(':').map(Number);
            const [eh, em] = shift.end.split(':').map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins < 0) mins += 24 * 60;
            hoursWorked = Math.round((mins / 60) * 10) / 10;
        }

        // 3. Incrementar hours_owed en employees
        const currentOwed = parseFloat(emp.hours_owed || 0);
        const newOwed = currentOwed + hoursWorked;
        await updateEmployee(id, { hours_owed: newOwed });

        // 4. Registrar en employee_events
        await insertEmployeeEventRaw({
            employee_id: id,
            type: 'VACATION_RECALL',
            date,
            note: reason || 'Ingreso durante período de vacaciones',
            metadata: {
                shift_id,
                hours_worked: hoursWorked,
                hours_owed_total: newOwed,
                approved_by,
                reason,
            }
        });

        await get().appendAuditLog('INGRESO_EN_VACACIONES', id, {
            timeline_title: `Ingreso en Vacaciones: ${emp.name}`,
            dimension: 'HR',
            branch_id: emp.branchId,
            new_value: `${hoursWorked}h — Horas debidas acumuladas: ${newOwed}h`,
            notas: reason
        });

        window.dispatchEvent(new CustomEvent('force-history-refresh'));

        set((state) => {
            const next = state.employees.map(e =>
                String(e.id) !== String(id) ? e : { ...e, hours_owed: newOwed }
            );
            persistEmployees(next);
            return { employees: next };
        });

        return { hoursWorked, newOwed };
    },

    // 🚨 SOFT DELETE: delega en registerEmployeeEvent(TERMINATION) para que exista
    // una sola vía de baja (evento + update de expediente + revocación de accesos).
    // `motivo` es la CLAVE del catálogo (`RENUNCIA`, `ABANDONO`…), que es lo que
    // se guarda en `metadata.terminationReason`. Antes era texto libre con
    // `'Baja general'` por omisión: un valor que no existe en el catálogo y que
    // dejaba el evento fuera de cualquier conteo por causa, sin fallar. Si no
    // resuelve, no se escribe y se avisa — mismo freno que PROMOTION.
    deleteEmployee: async (id, motivo, exitDate = null) => {
        const causa = TERMINATION_REASONS[motivo];
        if (!causa) {
            const e = new Error(`El motivo de baja "${motivo}" no existe en el catálogo.`);
            e.userFacing = true;
            throw e;
        }
        const fechaBaja = exitDate || new Date().toISOString().split('T')[0];
        const eventId = await get().registerEmployeeEvent(id, {
            type: 'TERMINATION',
            date: fechaBaja,
            terminationReason: motivo,
            note: `Motivo de salida: ${causa.label}`,
        });
        return !!eventId;
    },

    loadAttendanceLastDays: async (days = 15) => {
        const state = get();
        if (state.attendanceLoaded) return true;
        try {
            const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const { data: attData, error } = await fetchAttendanceSince(sinceISO);
            if (error) return false;

            const byEmp = new Map();
            (attData || []).forEach((a) => {
                const k = String(a.employee_id);
                if (!byEmp.has(k)) byEmp.set(k, []);
                byEmp.get(k).push(a);
            });

            set((state) => {
                const next = state.employees.map((e) => ({
                    ...e,
                    attendance: byEmp.get(String(e.id))?.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) || e.attendance || [],
                }));
                persistEmployees(next);
                return { employees: next, attendanceLoaded: true };
            });
            return true;
        } catch { return false; }
    },

    // Mezcla marcajes que llegaron por la vía del kiosco (RPC validado por
    // dispositivo, sin sesión) dentro del estado local de empleados.
    //
    // El kiosco no puede usar `loadAttendanceLastDays`: ése lee `attendance`
    // directo y sin sesión la policy lo rechaza — devolvía cero filas y el
    // motor resolvía «entrada» en cada escaneo porque creía que nadie había
    // marcado nunca.
    mergeKioskAttendance: (rows) => {
        const lista = Array.isArray(rows) ? rows : [];
        if (!lista.length) return;

        const porEmpleado = new Map();
        for (const r of lista) {
            const k = String(r.employee_id);
            if (!porEmpleado.has(k)) porEmpleado.set(k, []);
            porEmpleado.get(k).push(r);
        }

        set((state) => ({
            employees: state.employees.map((emp) => {
                const nuevos = porEmpleado.get(String(emp.id));
                if (!nuevos) return emp;

                const porId = new Map((emp.attendance || []).map((p) => [String(p.id), p]));
                for (const p of nuevos) porId.set(String(p.id), p);

                return {
                    ...emp,
                    attendance: [...porId.values()].sort(
                        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
                    ),
                };
            }),
        }));
    },

    getAllAttendance: () => {
        return (get().employees || []).flatMap((emp) =>
            (emp.attendance || []).map((att) => ({ ...att, employeeId: emp.id, id: `${emp.id}-${att.timestamp}` }))
        );
    },

    registerAttendance: async (employeeId, type, metadata = null) => {
        const timestamp = new Date().toISOString();

        const dbType = type;

        try {
            const { data: newPunch, error } = await insertAttendancePunch({ employee_id: employeeId, timestamp, type: dbType, details: metadata || {} });

            if (error) throw error;

            const state = get();
            const employee = state.employees.find(e => String(e.id) === String(employeeId));
            const employeeName = employee ? employee.name : 'Empleado Desconocido';
            const isKiosk = !!metadata?.audit_info;

            const kioskAuditInfo = metadata?.audit_info || null;
            const cleanDetails = { ...metadata };
            delete cleanDetails.audit_info;

            const PUNCH_LABELS = {
                IN: 'Entrada', OUT: 'Salida',
                OUT_LUNCH: 'Inicio Almuerzo', IN_LUNCH: 'Fin Almuerzo',
                OUT_LACTATION: 'Inicio Lactancia', IN_LACTATION: 'Fin Lactancia',
                OUT_EARLY: 'Salida anticipada', OUT_BUSINESS: 'Gestión externa',
                IN_RETURN: 'Regreso de Gestión', IN_EXTRA: 'Entrada Extra',
                OUT_EXTRA: 'Salida Extra',
            };
            const tipoMarcaje = PUNCH_LABELS[dbType] || dbType;

            state.appendAuditLog(
                `REGISTRO_ASISTENCIA`,
                employeeId,
                {
                    timeline_title: `Marcaje de ${tipoMarcaje}`,
                    dimension: 'OPERATIVE',
                    branch_id: employee?.branchId,
                    new_value: employeeName,
                    ...cleanDetails,
                    isKiosk,
                    kioskAuditInfo: isKiosk ? {
                        ...kioskAuditInfo,
                        employee_name: employeeName
                    } : null
                }
            ).catch(console.error);

            set((state) => {
                const next = state.employees.map(emp => {
                    if (String(emp.id) !== String(employeeId)) return emp;

                    const actualPunch = newPunch || { id: `local-${Date.now()}`, timestamp, type: dbType, details: metadata };

                    const exists = (emp.attendance || []).some(p => String(p.id) === String(actualPunch.id));
                    if (exists) return emp;

                    return {
                        ...emp,
                        attendance: [...(emp.attendance || []), actualPunch]
                    };
                });

                persistEmployees(next);
                return { employees: next };
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            return newPunch || { timestamp, type: dbType, details: metadata };

        } catch (err) {
            console.error("❌ Error al registrar asistencia:", err);
            throw new Error(err.message || "Fallo al registrar asistencia en la base de datos");
        }
    },

    insertAttendancePunchAt: async (employeeId, timestamp, type, details = {}) => {
        const { data: newPunch, error } = await insertAttendancePunch({ employee_id: employeeId, timestamp, type, details });
        if (error) throw error;

        set(state => ({
            employees: state.employees.map(emp => {
                if (String(emp.id) !== String(employeeId)) return emp;
                const exists = (emp.attendance || []).some(p => String(p.id) === String(newPunch.id));
                if (exists) return emp;
                const updated = [...(emp.attendance || []), newPunch]
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                return { ...emp, attendance: updated };
            })
        }));

        return newPunch;
    },

    // action: 'CONFIRM' | 'REJECT' | 'ADJUST'
    // options: { confirmedBy, confirmedByName, adjustedTimestamp }
    confirmAttendancePunch: async (punchId, employeeId, action, options = {}) => {
        const { confirmedBy, confirmedByName, adjustedTimestamp } = options;

        try {
            if (action === 'REJECT') {
                const { error } = await deleteAttendancePunch(punchId);
                if (error) throw error;

                set(state => ({
                    employees: state.employees.map(emp => {
                        if (String(emp.id) !== String(employeeId)) return emp;
                        return { ...emp, attendance: (emp.attendance || []).filter(p => String(p.id) !== String(punchId)) };
                    })
                }));

            } else {
                // CONFIRM or ADJUST — read current details first
                const { data: row, error: fetchErr } = await fetchAttendancePunchDetails(punchId);
                if (fetchErr) throw fetchErr;

                const newDetails = {
                    ...(row?.details || {}),
                    pendingHRReview: false,
                    confirmedBy: confirmedBy || null,
                    confirmedByName: confirmedByName || null,
                    confirmedAt: new Date().toISOString(),
                };

                const updatePayload = { details: newDetails };
                if (action === 'ADJUST' && adjustedTimestamp) {
                    updatePayload.timestamp = adjustedTimestamp;
                }

                const { error: updateErr } = await updateAttendancePunch(punchId, updatePayload);
                if (updateErr) throw updateErr;

                set(state => ({
                    employees: state.employees.map(emp => {
                        if (String(emp.id) !== String(employeeId)) return emp;
                        return {
                            ...emp,
                            attendance: (emp.attendance || []).map(p => {
                                if (String(p.id) !== String(punchId)) return p;
                                return {
                                    ...p,
                                    details: newDetails,
                                    ...(action === 'ADJUST' && adjustedTimestamp ? { timestamp: adjustedTimestamp } : {}),
                                };
                            })
                        };
                    })
                }));
            }

            get().appendAuditLog(
                action === 'REJECT' ? 'ATTENDANCE_PUNCH_REJECTED' : action === 'ADJUST' ? 'ATTENDANCE_PUNCH_ADJUSTED' : 'ATTENDANCE_PUNCH_CONFIRMED',
                employeeId,
                { punchId, action, confirmedBy, confirmedByName, adjustedTimestamp: adjustedTimestamp || null }
            ).catch(console.error);

        } catch (err) {
            console.error('❌ Error al confirmar marcaje:', err);
            throw err;
        }
    },
});