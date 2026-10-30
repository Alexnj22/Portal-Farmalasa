import * as almacen from '@plataforma/almacen';
// src/store/utils.js

export const makeId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

// `dui_lugar_expedicion` y `dui_fecha_expedicion` entran con el DUI y no
// aparte: los tres son el MISMO dato del Art. 23 nº2 (número, lugar y fecha de
// expedición del documento de identidad), y por eso los tres se leen por
// `get_employee_identidad` y ninguno está en `employees_safe`. Dejar afuera de
// esta lista a dos de los tres pondría en el disco de una computadora
// compartida la mitad del documento — que es la misma media medida que el
// 2026-08-24 dejó el DUI completo en el borrador mientras `persistEmployees` sí
// lo filtraba.
// `alt_identity_document` entró el 2026-09-03, y su ausencia era el mismo
// defecto que este comentario ya denunciaba una línea más arriba: es el
// documento de identidad de un MENOR de edad —lo que el Art. 23 nº2 le pide en
// lugar del DUI, porque en El Salvador no se tramita hasta los 18—, o sea
// exactamente el mismo dato para la persona a la que más conviene protegerlo. El
// DUI de un adulto se borraba del disco y el del menor se quedaba. Lo encontró
// la prueba que cruza esta lista contra `CAMPOS_TRAS_LLAVE`.
// `code` entró el 2026-10-14: el código de carné ES la contraseña de la cuenta
// de carné (`signInWithPassword({ password: code })`). Quedaba en claro en el
// borrador del alta —al enlazar, el de una persona ACTIVA— y en el padrón
// cacheado de todo el que ve Ventas. El arranque lo vuelve a pegar desde
// `get_vendedores` en cada carga, así que el caché no lo necesita.
export const SENSITIVE_FIELDS = ['code', 'kiosk_pin', 'dui', 'alt_identity_document', 'dui_lugar_expedicion', 'dui_fecha_expedicion', 'dui_fecha_vencimiento', 'isss_number', 'afp_number', 'base_salary', 'account_number', 'bank_name'];

// ── Las diez que la sesión ya NO puede escribir ────────────────────────────
//
// Desde el 2026-09-03 `authenticated` no tiene INSERT ni UPDATE sobre estas
// columnas de `employees`: se escriben por `guardar_datos_protegidos_de_empleado`,
// que le pide la llave que corresponde a cada tanda —el sueldo y la cuenta piden
// `staff_salary.can_edit`, la identidad previsional pide `staff_detail.can_edit`—
// en vez de la única que había antes, `staff_list.can_edit`.
//
// **Mandarlas en el `update` normal ya no falla en silencio: falla fuerte**, con
// `permission denied for column …`, y se lleva puesto el guardado entero. Por eso
// el reparto vive acá y lo usan los cinco caminos que escriben una ficha (alta,
// edición, recontratación, novedad y reversión de novedad) en vez de repetirse.
//
// `code` NO está en la lista: su llave siempre fue `staff_list.can_edit`, que es
// justo lo que la policy de fila exige, y además es NOT NULL —sacarlo del INSERT
// dejaría el alta sin poder crear a nadie—. `kiosk_pin` tampoco: hoy lo deriva un
// trigger de Postgres a partir del código, así que mandarlo es inofensivo y
// además inútil.
export const CAMPOS_TRAS_LLAVE = [
    'base_salary', 'bank_name', 'account_number',
    'dui', 'alt_identity_document', 'isss_number', 'afp_number',
    'dui_lugar_expedicion', 'dui_fecha_expedicion', 'dui_fecha_vencimiento',
];

/**
 * Parte un payload de ficha en las dos mitades que van por caminos distintos.
 *
 * Devuelve `{ dbPayload, protegido }`. `protegido` es `null` cuando no hay nada
 * que mandar por la RPC, para que quien llama no haga un viaje de más.
 *
 * `undefined` no viaja en ninguna de las dos: en un `update` de supabase-js se
 * cae solo al serializar, y en el patch de la RPC significaría «poner en null»,
 * que es lo contrario de «no lo toqué».
 */
// ── Sólo viajan las columnas que `employees` TIENE ──────────────────────────
//
// El formulario de edición arranca como `{ ...empleadoDelStore }`, y esa fila
// trae cosas que la tabla no tiene: las marcas que pone `fetchBoot`
// (`identidad_conocida`, `salario_conocido`) y las columnas calculadas de
// `employees_safe` (el escalón `rango` y el rol de compatibilidad). Con UNA
// sola en el `update`, PostgREST rechaza el guardado entero con `PGRST204
// Could not find the '…' column` — y como la parte protegida ya se escribió
// por la RPC, la ficha queda guardada por la mitad.
//
// Pasó desde el 2026-09-03 (v2.971.3 agregó las marcas) hasta el 2026-10-13:
// ningún `EDITAR_EMPLEADO` en la bitácora en ese lapso.
//
// Es una lista BLANCA y no una de «lo que sobra» a propósito: la de sobrantes
// se queda corta el día que el store agregue otra marca, y vuelve el mismo
// defecto sin aviso. Esta no se puede desincronizar en silencio:
// `tests/unit/camposTrasLlave.test.js` la exige IDÉNTICA a la fila de
// `employees` en `src/types/database.ts` (los tipos de producción), así que una
// columna nueva + `npm run tipos:base` hace fallar la prueba hasta agregarla.
export const COLUMNAS_DE_EMPLOYEES = new Set([
    'account_number', 'account_type', 'acreditaciones', 'additional_skills', 'address',
    'afp_estado', 'afp_institution', 'apellido_preferido', 'afp_number', 'alt_identity_document',
    'alt_identity_document_type', 'bank_name', 'base_salary', 'birth_date', 'blocked_at',
    'blocked_by', 'blocked_reason', 'blocked_until', 'blood_type', 'branch_id',
    'carne_dependiente_url', 'carne_pendiente', 'chronic_conditions', 'code',
    'contador_license_number', 'contract_end_date', 'contract_start_date',
    'contract_temporal_legal_basis', 'contract_temporal_reason', 'contract_type',
    'contrato_fecha_celebracion', 'contrato_lugar_celebracion', 'contrato_prorrogas',
    'created_at', 'department', 'disability_grade', 'disability_has_certification',
    'disability_type', 'distrito', 'dui', 'dui_fecha_expedicion', 'dui_fecha_vencimiento',
    'dui_lugar_expedicion', 'economic_dependents', 'education_grade_completed',
    'education_level', 'education_specialty', 'email', 'emergency_contact_extra_phones',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
    'emergency_contacts', 'employee_documents', 'exceptions', 'extra_addresses',
    'extra_emails', 'extra_phones', 'first_names', 'forma_estipulacion_salario', 'gender',
    'has_car', 'has_car_license', 'has_disability', 'has_maestria', 'has_motorcycle',
    'has_motorcycle_license', 'has_srs_accreditation', 'herramientas_entregadas',
    'hire_date', 'hours_owed', 'id', 'is_studying', 'isss_estado', 'isss_number',
    'kiosk_pin', 'last_names', 'lugar_nacimiento', 'lugar_pago', 'maestria_is_studying',
    'maestria_study_duration_years', 'maestria_study_start_date', 'maestria_title',
    'marital_status', 'medico_license_number', 'medio_pago', 'mtps_remitido_fecha',
    'municipality', 'name', 'nationality', 'nombre_elegido_el', 'nombre_preferido', 'nursing_license_number', 'periodo_pago',
    'pharmacist_license_number', 'phone', 'photo_url', 'profession', 'role_id',
    'secondary_role_id', 'shift_id', 'srs_accreditation_expiry', 'status',
    'study_duration_years', 'study_start_date', 'suplente_id',
    'tiene_acreditacion_dependiente', 'tipo_ficha', 'username', 'weekly_contracted_hours',
    'weekly_schedule',
]);

export const partirPorLlave = (payload) => {
    const dbPayload = {};
    for (const [campo, valor] of Object.entries(payload || {})) {
        if (COLUMNAS_DE_EMPLOYEES.has(campo)) dbPayload[campo] = valor;
    }
    const protegido = {};
    for (const campo of CAMPOS_TRAS_LLAVE) {
        // Se borra de las dos mitades aunque sea `undefined`: en el `update` se
        // caería solo al serializar, pero dejar la clave ahí hace que este
        // reparto sea difícil de comprobar, y una prueba que no puede afirmar
        // «esta clave no está» tampoco puede cazar el día que sí esté con valor.
        if (dbPayload[campo] !== undefined) protegido[campo] = dbPayload[campo];
        delete dbPayload[campo];
    }
    return { dbPayload, protegido: Object.keys(protegido).length ? protegido : null };
};

export const CACHE_KEYS = {
    BRANCHES: "sb_cache_branches_v1",
    EMPLOYEES: "sb_cache_employees_v1",
    SHIFTS: "sb_cache_shifts_v1",
    ROLES: "sb_cache_roles_v1",
    ANNOUNCEMENTS: "sb_cache_announcements_v1",
    AUDIT: "sb_cache_audit_v1",
    HOLIDAYS: "sb_cache_holidays_v1", // 🚨 NUEVA LLAVE AÑADIDA PARA ASUETOS
    AT: "sb_cache_staff_at_v1"
};

// Persiste empleados en localStorage filtrando campos sensibles e histórico pesado
export const persistEmployees = (employees) => {
    try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const light = employees.map(emp => {
            const safe = { ...emp };
            SENSITIVE_FIELDS.forEach(f => delete safe[f]);
            // `identidad_conocida` y `salario_conocido` NO son secretos —son la
            // marca de que el servidor contestó por esta persona— pero viajan
            // con los campos que
            // acaban de borrarse, y sin ellos MIENTEN: la fila hidratada del
            // caché diría «sé que esta persona no tiene DUI» sobre un DUI que
            // se borró acá mismo. Es la misma trampa que el `historialCompleto`
            // resuelve para el aro de la foto. Fuera del disco, la pantalla
            // vuelve a «no sé», que es la verdad hasta que `fetchBoot` conteste.
            delete safe.identidad_conocida;
            delete safe.salario_conocido;
            return { ...safe, history: [], documents: [], attendance: (emp.attendance || []).filter(a => a.timestamp >= yesterday) };
        });
        almacen.guardar(CACHE_KEYS.EMPLOYEES, JSON.stringify(light));
    } catch (e) {
        console.warn('⚠️ Alerta de Memoria LocalStorage:', e);
    }
    return employees;
};

export const safeJsonParse = (s, fallback = null) => {
    try { return JSON.parse(s); } catch { return fallback; }
};

export const normalizeWeeklyHours = (weeklyHours) => {
    const src = weeklyHours || {};
    const out = {};
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
        const v = (src?.[d] ?? src?.[d === 0 ? 7 : d]) || {};
        const start = typeof v.start === "string" ? v.start : "";
        const end = typeof v.end === "string" ? v.end : "";
        const isOpen = typeof v.isOpen === "boolean" ? v.isOpen : false;
        out[d] = { isOpen, start: isOpen ? start : "", end: isOpen ? end : "" };
    });
    return out;
};

export const normalizeBranchPayloadFromModal = (data = {}) => {
  const out = { ...(data || {}) };

  // ids / name
  if (!out.id && out.branchId) out.id = out.branchId;
  delete out.branchId;

  if (typeof out.branchName === "string" && !out.name) out.name = out.branchName;
  delete out.branchName;

  // weekly hours normalize
  if (out.branchSchedule) {
    out.weeklyHours = normalizeWeeklyHours(out.branchSchedule);
    delete out.branchSchedule;
  } else if (out.weeklyHours) {
    out.weeklyHours = normalizeWeeklyHours(out.weeklyHours);
  } else if (out.weekly_hours) {
    // si viene de BD con snake_case
    out.weeklyHours = normalizeWeeklyHours(
      typeof out.weekly_hours === "string" ? safeJsonParse(out.weekly_hours, {}) : out.weekly_hours
    );
  }

  // phone alias
  if (out.phoneFixed && !out.phone) out.phone = out.phoneFixed;
  delete out.phoneFixed;

  // --- settings: NO PISAR ---
  const existingSettings = typeof out.settings === "string" ? safeJsonParse(out.settings, {}) : (out.settings || {});

  // si vienen propertyType/rent sueltos, aplicarlos sin borrar el resto
  const propertyType = out.propertyType || existingSettings.propertyType || 'OWNED';
  const rent = propertyType === 'RENTED'
    ? (out.rent ?? existingSettings.rent ?? null)
    : null;

  out.settings = {
    ...existingSettings,
    propertyType,
    // 🚨 CORRECCIÓN: Si es OWNED, debe guardar el null, no revivir el rent anterior.
    rent: rent,
  };

  delete out.propertyType;
  delete out.rent;

  // 🛡️ MEJORA PRO: vacíos o espacios en blanco a null
  ["name", "address", "phone", "cell", "openingDate", "opening_date"].forEach((k) => {
    if (typeof out[k] === "string" && out[k].trim() === "") {
        out[k] = null;
    }
  });

  return out;
};