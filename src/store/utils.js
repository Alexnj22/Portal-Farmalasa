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
export const SENSITIVE_FIELDS = ['kiosk_pin', 'dui', 'dui_lugar_expedicion', 'dui_fecha_expedicion', 'dui_fecha_vencimiento', 'isss_number', 'afp_number', 'base_salary', 'account_number', 'bank_name'];

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
            return { ...safe, history: [], documents: [], attendance: (emp.attendance || []).filter(a => a.timestamp >= yesterday) };
        });
        localStorage.setItem(CACHE_KEYS.EMPLOYEES, JSON.stringify(light));
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