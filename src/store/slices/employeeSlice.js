import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, persistEmployees } from '../utils';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { OTRA_ESPECIALIDAD } from '../../utils/educationCatalogs';

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
    supabase.from('education_catalog_entries').upsert(rows, { onConflict: 'category,value', ignoreDuplicates: true })
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

// Dependientes económicos: {name, birth_date, relationship, department,
// municipality, address} — descarta filas totalmente vacías.
const normalizeEconomicDependents = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(d => ({
            name: (d?.name || '').trim().toUpperCase(),
            birth_date: d?.birth_date || null,
            relationship: (d?.relationship || '').trim(),
            department: (d?.department || '').trim(),
            municipality: (d?.municipality || '').trim(),
            address: (d?.address || '').trim().toUpperCase(),
        }))
        .filter(d => d.name || d.birth_date || d.relationship || d.department || d.municipality || d.address);
};

// DUI salvadoreño: formato 00000000-0 + dígito verificador (suma ponderada 9..2
// mod 10). Mismo algoritmo que isValidDUIAlgorithm en EmployeeFormModal — aquí
// BLOQUEA el guardado (el modal solo lo señala visualmente).
const validateDui = (dui, employees, excludeId = null) => {
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
    const dup = employees.find(e =>
        (excludeId == null || String(e.id) !== String(excludeId)) && e.dui === dui
    );
    if (dup) throw new Error(`El DUI "${dui}" ya está registrado a nombre de ${dup.name}.`);
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

    // Dependientes económicos: solo se bloquea si la fecha de nacimiento es futura
    // (sin rango de edad — a diferencia del empleado, un dependiente puede ser un bebé o un adulto mayor).
    if (Array.isArray(data.economic_dependents)) {
        for (const dep of data.economic_dependents) {
            if (!dep?.birth_date) continue;
            const bd = new Date(`${dep.birth_date}T00:00:00`);
            if (!isNaN(bd.getTime()) && bd > new Date()) {
                throw new Error(`La Fecha de Nacimiento de "${dep.name || 'un dependiente'}" no puede ser futura.`);
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

    if (data.has_srs_accreditation && !data.srs_accreditation_expiry) {
        throw new Error('Falta la Fecha de Vencimiento de la Acreditación SRS.');
    }

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

            // El código es la credencial del carné: SOLO números (regla de negocio,
            // también validada por trigger en BD) y único entre empleados.
            const cleanCode = String(formData.code ?? '').trim() || null;
            if (cleanCode) {
                if (!/^\d+$/.test(cleanCode)) {
                    throw new Error('El código de empleado debe contener solo números.');
                }
                const dup = get().employees.find(e =>
                    (e.code || '').trim().toUpperCase() === cleanCode.toUpperCase()
                );
                if (dup) throw new Error(`El código "${cleanCode}" ya está asignado a ${dup.name}.`);
            }

            validateDui(formData.dui || null, get().employees);
            validateOptionalFormats(formData);

            const dbPayload = {
                first_names: fNames,
                last_names: lNames,
                username: formData.username ? formData.username.trim().toLowerCase() : null,
                code: cleanCode,
                
                role_id: formData.role_id ? parseInt(formData.role_id, 10) : null,
                secondary_role_id: formData.secondary_role_id ? parseInt(formData.secondary_role_id, 10) : null,
                branch_id: formData.branch_id ? parseInt(formData.branch_id, 10) : null,
                
                gender: formData.gender || null,
                blood_type: formData.blood_type || null,
                marital_status: formData.marital_status || null,
                birth_date: formData.birth_date || null,
                dui: formData.dui || null,
                alt_identity_document: formData.alt_identity_document || null,
                nationality: formData.nationality || null,
                phone: formData.phone || null,
                address: formData.address ? formData.address.trim().toUpperCase() : null,

                department: formData.department || null,
                municipality: formData.municipality || null,
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
                economic_dependents: normalizeEconomicDependents(formData.economic_dependents),

                contract_type: formData.contract_type || 'INDEFINIDO',
                contract_start_date: formData.contract_start_date || null,
                contract_end_date: formData.contract_type === 'TEMPORAL' ? (formData.contract_end_date || null) : null,
                contract_temporal_legal_basis: formData.contract_type === 'TEMPORAL' ? (formData.contract_temporal_legal_basis || null) : null,
                contract_temporal_reason: formData.contract_type === 'TEMPORAL' ? (formData.contract_temporal_reason || null) : null,
                weekly_contracted_hours: formData.weekly_contracted_hours ? parseInt(formData.weekly_contracted_hours, 10) : 44,
                base_salary: formData.base_salary ? parseFloat(formData.base_salary) : null,
                has_motorcycle: !!formData.has_motorcycle,
                has_car: !!formData.has_car,
                has_motorcycle_license: !!formData.has_motorcycle_license,
                has_car_license: !!formData.has_car_license,
                has_srs_accreditation: !!formData.has_srs_accreditation,
                srs_accreditation_expiry: formData.has_srs_accreditation ? (formData.srs_accreditation_expiry || null) : null,
                hire_date: formData.hire_date || null,
                afp_number: formData.afp_number || null,
                isss_number: formData.isss_number || null,
                afp_institution: formData.afp_institution || null,
                bank_name: formData.bank_name || null,
                account_number: formData.account_number || null,
                account_type: formData.account_type || 'AHORRO',
                
                kiosk_pin: formData.kiosk_pin || null,
                status: 'ACTIVO',
                photo_url: null,
            };

            // Validar headcount del cargo seleccionado
            assertHeadcountAvailable(get(), dbPayload.role_id, dbPayload.branch_id);

            const { data: newEmp, error } = await supabase.from("employees").insert([dbPayload]).select().single();
            if (error) {
                console.error('Supabase INSERT error:', error.message, error.details, error.hint);
                throw error;
            }
            registerCatalogEntry(dbPayload.education_level, dbPayload.education_specialty, dbPayload.profession, dbPayload.maestria_title);
            registerSkillCatalogEntries(dbPayload.additional_skills);

            const uploadedFile = formData.file || formData.photo;
            if (uploadedFile && uploadedFile instanceof File) {
                // Comprimimos antes de subir
                const compressedPhoto = await compressImage(uploadedFile);
                const publicPhotoUrl = await get().uploadEmployeeFile(compressedPhoto, newEmp.id, 'foto_perfil');
                if (publicPhotoUrl) {
                    await supabase.from("employees").update({ photo_url: publicPhotoUrl }).eq("id", newEmp.id);
                    newEmp.photo_url = publicPhotoUrl;
                }
            }

            // Asignar sucursales adicionales si aplica (empleados externos)
            const assignedBranches = Array.isArray(formData.assigned_branch_ids) ? formData.assigned_branch_ids.map(Number).filter(Boolean) : [];
            if (assignedBranches.length > 0) {
                await supabase.from('employee_branches').insert(
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

            await get().appendAuditLog('PERSONAL_ASIGNADO', newEmp.id, {
                timeline_title: `Nuevo Ingreso: ${newEmp.name}`,
                dimension: 'HR',
                branch_id: newEmp.branch_id,
                new_value: `Expediente creado`
            });
            
            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const roles = get().roles;
            const mainRoleName = roles.find(r => String(r.id) === String(newEmp.role_id))?.name || null;
            const secRoleName = roles.find(r => String(r.id) === String(newEmp.secondary_role_id))?.name || null;

            const appEmp = {
                ...newEmp,
                branchId: newEmp.branch_id,
                hireDate: newEmp.hire_date,
                birthDate: newEmp.birth_date,
                photo: newEmp.photo_url ? await getSignedFileUrl(newEmp.photo_url, 43200) : null,
                role: mainRoleName,
                secondary_role: secRoleName,
                assigned_branch_ids: assignedBranches,
                attendance: [],
                history: [],
                documents: []
            };

            set((state) => {
                const next = [...state.employees, appEmp];
                persistEmployees(next);
                return { employees: next };
            });
            return { id: appEmp.id, username: dbPayload.username, tempPassword };
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
                    const dup = get().employees.find(e =>
                        String(e.id) !== String(id) &&
                        (e.code || '').trim().toUpperCase() === dbPayload.code.toUpperCase()
                    );
                    if (dup) throw new Error(`El código "${dbPayload.code}" ya está asignado a ${dup.name}.`);
                }
            }

            if (dbPayload.dui !== undefined) {
                dbPayload.dui = String(dbPayload.dui ?? '').trim() || null;
                validateDui(dbPayload.dui, get().employees, id);
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

            if (updatedData.role_id !== undefined) dbPayload.role_id = updatedData.role_id ? parseInt(updatedData.role_id, 10) : null;
            if (updatedData.secondary_role_id !== undefined) dbPayload.secondary_role_id = updatedData.secondary_role_id ? parseInt(updatedData.secondary_role_id, 10) : null;
            
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
            if (updatedData.afp_institution !== undefined) dbPayload.afp_institution = updatedData.afp_institution || null;
            if (updatedData.account_type !== undefined) dbPayload.account_type = updatedData.account_type || 'AHORRO';
            
            if (updatedData.contract_type && updatedData.contract_type !== 'TEMPORAL') {
                dbPayload.contract_end_date = null;
                dbPayload.contract_temporal_legal_basis = null;
                dbPayload.contract_temporal_reason = null;
            }

            delete dbPayload.id;
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

            const { data: updated, error } = await supabase.from("employees").update(dbPayload).eq("id", id).select().single();
            if (error) throw error;
            if (dbPayload.education_specialty !== undefined || dbPayload.profession !== undefined || dbPayload.maestria_title !== undefined) {
                registerCatalogEntry(dbPayload.education_level ?? updated.education_level, dbPayload.education_specialty, dbPayload.profession, dbPayload.maestria_title);
            }
            if (dbPayload.additional_skills !== undefined) registerSkillCatalogEntries(dbPayload.additional_skills);

            // Sync branch assignments to junction table if provided
            if (newAssignedBranches !== null) {
                await supabase.from('employee_branches').delete().eq('employee_id', id);
                if (newAssignedBranches.length > 0) {
                    await supabase.from('employee_branches').insert(
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
                        role: updated.role_id ? (mainRoleName || emp.role) : 'Sin Asignar',
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

        const dbPayload = {
            status: 'ACTIVO',
            branch_id: parseInt(rehireData.branch_id, 10),
            role_id: parseInt(rehireData.role_id, 10),
            secondary_role_id: rehireData.secondary_role_id ? parseInt(rehireData.secondary_role_id, 10) : null,
            hire_date: rehireData.hire_date,
            contract_type: rehireData.contract_type || 'INDEFINIDO',
            weekly_contracted_hours: parseInt(rehireData.weekly_contracted_hours, 10) || 44,
            base_salary: rehireData.base_salary ? parseFloat(rehireData.base_salary) : null,
            contract_end_date: null,
            kiosk_pin: newPin,
        };

        const { error } = await supabase.from('employees').update(dbPayload).eq('id', id);
        if (error) throw error;

        // Levantar el ban de la cuenta Auth aplicado en la baja (best-effort)
        supabase.functions.invoke('disable-employee-auth', {
            body: { employeeId: id, action: 'enable' }
        }).catch(err => console.warn('No se pudo reactivar la cuenta Auth:', err));

        const roles = get().roles;
        const mainRoleName = roles.find(r => String(r.id) === String(dbPayload.role_id))?.name || null;

        await supabase.from('employee_events').insert([{
            employee_id: id,
            type: 'REHIRE',
            date: rehireData.hire_date,
            note: rehireData.notes || 'Recontratación',
            metadata: {
                previous_status: 'INACTIVO',
                new_role: mainRoleName,
                target_branch_id: dbPayload.branch_id,
            }
        }]);

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
        const _rawDay = new Date(date + 'T00:00:00').getDay();
        const dayId   = _rawDay === 0 ? 7 : _rawDay;

        const { data: roster } = await supabase
            .from('employee_rosters').select('schedule_data')
            .eq('employee_id', id).eq('week_start_date', weekStart).maybeSingle();
        const raw = roster?.schedule_data || {};
        const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };
        sched[dayId] = { shiftId: shift_id, note: 'Ingreso en vacaciones' };
        await supabase.from('employee_rosters').upsert(
            { employee_id: id, week_start_date: weekStart, schedule_data: sched },
            { onConflict: 'employee_id, week_start_date' }
        );

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
        await supabase.from('employees').update({ hours_owed: newOwed }).eq('id', id);

        // 4. Registrar en employee_events
        await supabase.from('employee_events').insert([{
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
        }]);

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
    deleteEmployee: async (id, reason = 'Baja general', exitDate = null) => {
        const fechaBaja = exitDate || new Date().toISOString().split('T')[0];
        const eventId = await get().registerEmployeeEvent(id, {
            type: 'TERMINATION',
            date: fechaBaja,
            terminationReason: reason,
            note: `Motivo de salida: ${reason}`,
        });
        return !!eventId;
    },

    loadAttendanceLastDays: async (days = 15) => {
        const state = get();
        if (state.attendanceLoaded) return true;
        try {
            const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const { data: attData, error } = await supabase.from("attendance").select("*").gte("timestamp", sinceISO);
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

    getAllAttendance: () => {
        return (get().employees || []).flatMap((emp) =>
            (emp.attendance || []).map((att) => ({ ...att, employeeId: emp.id, id: `${emp.id}-${att.timestamp}` }))
        );
    },

    registerAttendance: async (employeeId, type, metadata = null) => {
        const timestamp = new Date().toISOString();

        const dbType = type;

        try {
            const { data: newPunch, error } = await supabase
                .from("attendance")
                .insert([{ employee_id: employeeId, timestamp, type: dbType, details: metadata || {} }])
                .select()
                .single();

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
                OUT_EARLY: 'Salida Anticipada', OUT_BUSINESS: 'Gestión Externa',
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
        const { data: newPunch, error } = await supabase
            .from('attendance')
            .insert([{ employee_id: employeeId, timestamp, type, details }])
            .select()
            .single();
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
                const { error } = await supabase.from('attendance').delete().eq('id', punchId);
                if (error) throw error;

                set(state => ({
                    employees: state.employees.map(emp => {
                        if (String(emp.id) !== String(employeeId)) return emp;
                        return { ...emp, attendance: (emp.attendance || []).filter(p => String(p.id) !== String(punchId)) };
                    })
                }));

            } else {
                // CONFIRM or ADJUST — read current details first
                const { data: row, error: fetchErr } = await supabase
                    .from('attendance').select('details').eq('id', punchId).single();
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

                const { error: updateErr } = await supabase
                    .from('attendance').update(updatePayload).eq('id', punchId);
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